/**
 * §11Y — TRADUIRE EN FRANÇAIS L'ÉCHEC D'UN RÉGLAGE D'AGENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE SÉPARÉMENT DE `agentActions.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * `agentActions.ts` porte `"use server"` : l'importer depuis un test
 * entraîne `next/cache` et le client Supabase serveur, c'est-à-dire
 * tout un environnement pour éprouver une suite de `if` sur une chaîne
 * de caractères. La traduction est une fonction PURE ; elle est donc
 * sortie ici, où un test peut la tenir.
 *
 * Ce n'est pas un détail d'outillage. La branche la plus importante de
 * ce fichier — celle du décalage entre le code et la base — se
 * déclenche sur un message d'erreur de PostgreSQL, c'est-à-dire sur du
 * texte écrit par quelqu'un d'autre. Une correspondance de sous-chaîne
 * qui ne serait jamais rejouée contre la VRAIE chaîne est une branche
 * morte qui a l'air d'un garde-fou. Le test associé rejoue le message
 * relevé en production, mot pour mot.
 */

/**
 * Les cinq contraintes qui appellent `ai_is_supported_agent`.
 *
 * Relevées dans `pg_constraint` sur la base de production, et non
 * déduites : `ai_action_approvals` ne suit pas la règle de nommage des
 * quatre autres (`..._requested_by_agent_check`), ce qu'on n'aurait pas
 * deviné. Elles terminent toutes par `_agent_check`, et c'est cette
 * terminaison — pas la liste — que la détection emploie : une sixième
 * table portant la même contrainte serait couverte sans qu'on y pense.
 */
export const CONTRAINTES_AGENT_SUPPORTE: readonly string[] = Object.freeze([
  "ai_action_approvals_requested_by_agent_check",
  "ai_actions_agent_check",
  "ai_agent_settings_agent_check",
  "ai_decisions_agent_check",
  "ai_model_overrides_agent_check",
]);

/**
 * Le code applicatif connaît-il un agent que la base refuse encore ?
 *
 * VRAI veut dire : la migration 0082 n'est pas appliquée sur cette
 * base, alors que le code qui tourne devant elle propose les dix
 * agents. C'est un état de DÉPLOIEMENT, pas une faute de l'utilisateur,
 * et surtout pas un droit manquant — d'où un message à part.
 */
export function estAgentInconnuDeLaBase(message: string): boolean {
  if (!message) return false;
  // Deux formes, parce que la couche HTTP ne rend pas toujours la même.
  // PostgREST remonte le message de PostgreSQL tel quel — c'est la
  // seconde condition, vérifiée en production. La première couvre le
  // cas où c'est la DÉFINITION de la contrainte qui remonte (certaines
  // versions l'incluent dans `details`), et où le nom de la fonction
  // apparaît alors en clair.
  return (
    message.includes("ai_is_supported_agent") ||
    (message.includes("check constraint") && message.includes("_agent_check"))
  );
}

/**
 * Le message montré à l'utilisateur quand un réglage d'agent échoue.
 *
 * L'ORDRE DES BRANCHES COMPTE. Le droit manquant passe en premier
 * parce que c'est le cas de loin le plus fréquent et le seul que
 * l'utilisateur puisse résoudre lui-même (en demandant à un
 * administrateur). Le décalage de base passe avant le repli, parce que
 * le repli rend le message brut de PostgreSQL — lisible par un
 * développeur, opaque pour un dirigeant.
 */
export function messageEchecReglage(message: string): string {
  if (!message) return "Le réglage n'a pas pu être enregistré.";

  if (message.includes("row-level security")) {
    return "Seul un administrateur règle ce que la machine a le droit de faire. Demandez-le-lui.";
  }

  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Les réglages d'Oasis ne sont pas encore installés sur cette base.";
  }

  // ══════════════════════════════════════════════════════════════
  // LE CODE ET LA BASE PEUVENT NE PAS ÊTRE DE LA MÊME GÉNÉRATION
  // ══════════════════════════════════════════════════════════════
  //
  // `ai_is_supported_agent` acceptait quatre agents (0072) et en
  // accepte dix (0082). L'écran des réglages, lui, affiche les dix dès
  // que le CODE est déployé. Déployer le code sans la migration est
  // donc un état possible — et dans cet état, déplacer le curseur d'un
  // des six nouveaux agents échoue sur une contrainte `check`.
  //
  // Sans cette branche l'utilisateur lit « violates check constraint
  // "ai_agent_settings_agent_check" » : une phrase qui ne nomme ni
  // l'agent, ni la cause, ni le geste. On ne peut pas RÉPARER le
  // décalage ici — appliquer une migration n'est pas le travail d'un
  // formulaire — mais on peut refuser en le NOMMANT, ce que ce produit
  // exige partout ailleurs d'un droit manquant.
  //
  // Le message nomme aussi ce qui MARCHE ENCORE. « Rien ne fonctionne »
  // et « six agents sur dix ne sont pas encore en base » appellent deux
  // réactions très différentes de celui qui lit.
  if (estAgentInconnuDeLaBase(message)) {
    return (
      "Cet agent existe dans l'application mais pas encore dans la base : la mise à jour " +
      "0082 n'y est pas appliquée. Le réglage n'a pas été enregistré. Les agents Direction, " +
      "Finance, Facturation et Devis & prix restent réglables."
    );
  }

  return message;
}
