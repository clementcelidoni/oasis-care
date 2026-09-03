import { normaliserCleAgent } from "../model/types.ts";
import type { CleAgentModele } from "./types.ts";

/**
 * §11V — L'AUTONOMIE, LUE DANS `ai_agent_settings` (0072).
 *
 * ══════════════════════════════════════════════════════════════════
 * CINQ NIVEAUX, ET CE QUE CHACUN CHANGE VRAIMENT
 * ══════════════════════════════════════════════════════════════════
 *
 *   0 · observe      L'agent lit, il ne dit rien. Aucune recommandation
 *                    n'est rendue à l'utilisateur, aucune décision n'est
 *                    ouverte. Il ne coûte pourtant pas rien : c'est le
 *                    niveau où l'on regarde ce qu'il TROUVERAIT avant de
 *                    le laisser parler.
 *
 *   1 · advise       LE DÉFAUT (0072). Il recommande. Il n'écrit rien,
 *                    pas même une ligne d'`ai_actions`.
 *
 *   2 · prepare      Il peut enregistrer une action et demander une
 *                    validation. Personne n'exécute : le oui marque
 *                    l'accord, le geste se fait à la main.
 *
 *   3 · confirm_to_execute
 *                    Comme 2, ET Oasis exécute lui-même après le oui.
 *                    C'est ici que la différence entre 2 et 3 se joue —
 *                    pas sur ce qui est PROPOSÉ, sur ce qui est FAIT
 *                    quand l'humain a répondu.
 *
 *   4 · authorized_autopilot
 *                    Il peut agir sans qu'on lui réponde, et seulement
 *                    si `ai_may_autoexecute` (0072) dit oui à ses douze
 *                    conditions.
 *
 * ─── POURQUOI CE FICHIER NE DÉCIDE RIEN À LA PLACE DE POSTGRES ───
 *
 * Il ne fait que LIRE le niveau et dire ce qu'il permet. Le refus qui
 * compte reste celui de la base : `ai_guard`, la RLS, et surtout
 * `ai_may_autoexecute`, qui vérifie douze conditions et tombe du côté
 * fermé sur la moindre erreur. Ce fichier existe pour éviter un
 * aller-retour et pour NOMMER le réglage à changer — « votre agent est
 * au niveau 1 » est une phrase actionnable ; « permission denied » ne
 * l'est pas.
 *
 * ─── LE DÉFAUT EN CAS D'ÉCHEC DE LECTURE ───
 *
 * `allumé au niveau 1`, exactement ce que 0072 sème. Ce n'est pas un
 * assouplissement : le niveau 1 n'autorise AUCUNE écriture. Tomber du
 * côté « il répond aux questions mais n'agit pas » quand la table est
 * illisible est le bon côté — et c'est déjà le choix de la fonction
 * Edge, qu'on ne change pas en migrant.
 */

export const NIVEAUX_AUTONOMIE = [0, 1, 2, 3, 4] as const;
export type NiveauAutonomie = (typeof NIVEAUX_AUTONOMIE)[number];

export const CLES_AUTONOMIE: Record<NiveauAutonomie, string> = {
  0: "observe",
  1: "advise",
  2: "prepare",
  3: "confirm_to_execute",
  4: "authorized_autopilot",
};

export const LIBELLES_AUTONOMIE: Record<NiveauAutonomie, string> = {
  0: "Observe",
  1: "Recommande",
  2: "Prépare",
  3: "Exécute après confirmation",
  4: "Autopilote autorisé",
};

/** Ce que l'entreprise a réglé pour UN agent. */
export type ReglageAgent = {
  agent: CleAgentModele;
  actif: boolean;
  niveau: NiveauAutonomie;
  /** Vrai quand la valeur vient d'un défaut et non de la base. */
  parDefaut: boolean;
};

/** Le réglage retenu quand la table est illisible ou muette. */
export const REGLAGE_PAR_DEFAUT = Object.freeze({
  actif: true,
  niveau: 1 as NiveauAutonomie,
});

export function estNiveauAutonomie(valeur: unknown): valeur is NiveauAutonomie {
  return (
    typeof valeur === "number" &&
    Number.isInteger(valeur) &&
    (NIVEAUX_AUTONOMIE as readonly number[]).includes(valeur)
  );
}

/**
 * Le niveau lu depuis la base, ramené dans l'échelle.
 *
 * PAS DE `?? 0` NI DE `?? 4`. Une valeur illisible rend le DÉFAUT (1),
 * qui est le seul niveau dont on sait qu'il ne fait rien de dangereux
 * et ne bloque rien d'utile. Zéro rendrait un agent muet sans que
 * personne comprenne pourquoi ; quatre lui donnerait les clés.
 */
export function lireNiveauAutonomie(valeur: unknown): NiveauAutonomie {
  // `Number()` EST LE PIÈGE ICI, et il vaut la peine de l'écrire.
  // `Number(null)`, `Number("")`, `Number(false)` et `Number([])`
  // valent tous ZÉRO — c'est-à-dire « Observe », l'agent qui se tait.
  // Une valeur absente n'est pas un choix de l'entreprise : la colonne
  // est `not null default 1` (0072), donc un `null` qui arriverait ici
  // ne vient pas de la table mais d'une lecture qui a mal tourné, et il
  // doit rendre le défaut plutôt que faire taire un agent sans que
  // personne comprenne pourquoi. On refuse donc tout ce qui n'est pas
  // un nombre ou une chaîne non vide AVANT de convertir.
  if (typeof valeur !== "number" && typeof valeur !== "string") {
    return REGLAGE_PAR_DEFAUT.niveau;
  }
  if (typeof valeur === "string" && valeur.trim().length === 0) {
    return REGLAGE_PAR_DEFAUT.niveau;
  }
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return REGLAGE_PAR_DEFAUT.niveau;
  const entier = Math.trunc(n);
  if (!estNiveauAutonomie(entier)) return REGLAGE_PAR_DEFAUT.niveau;
  return entier;
}

// ==================================================================
// Ce que chaque niveau permet
// ==================================================================

/** L'agent a-t-il le droit de dire quelque chose à l'utilisateur ? */
export function peutRecommander(reglage: ReglageAgent): boolean {
  return reglage.actif && reglage.niveau >= 1;
}

/** Peut-il enregistrer une action et demander une validation ? */
export function peutPreparerUneAction(reglage: ReglageAgent): boolean {
  return reglage.actif && reglage.niveau >= 2;
}

/** Oasis exécute-t-il lui-même, une fois le oui obtenu ? */
export function peutExecuterApresAccord(reglage: ReglageAgent): boolean {
  return reglage.actif && reglage.niveau >= 3;
}

/**
 * Peut-il agir SANS qu'on lui réponde ?
 *
 * Vrai ici ne suffit jamais : `ai_may_autoexecute` a le dernier mot, et
 * ses douze conditions comprennent le plafond de montant, la fenêtre
 * horaire, les listes blanches et le droit de l'utilisateur. Cette
 * fonction sert seulement à ne pas interroger la base pour rien.
 */
export function peutAgirSeul(reglage: ReglageAgent): boolean {
  return reglage.actif && reglage.niveau === 4;
}

/**
 * Le refus, en français, avec le réglage à changer.
 *
 * Un agent éteint et un agent au niveau 1 ne se disent pas pareil : le
 * premier a été éteint exprès, le second n'a simplement jamais été
 * relevé. Confondre les deux ferait chercher le mauvais interrupteur.
 */
export function motifRefusAction(reglage: ReglageAgent, libelleAgent: string): string {
  if (!reglage.actif) {
    return (
      `L'agent « ${libelleAgent} » est éteint pour cette entreprise. ` +
      "Rallumez-le depuis « Oasis AI › Agents » ; rien n'est cassé, c'est un réglage."
    );
  }
  return (
    `L'agent « ${libelleAgent} » est au niveau d'autonomie ${reglage.niveau} ` +
    `(${LIBELLES_AUTONOMIE[reglage.niveau]}) : il ne prépare pas d'action. ` +
    "Pour qu'il en prépare, réglez-le au niveau 2 ou plus depuis « Oasis AI › Agents » — " +
    "le curseur d'autonomie y vit, pas dans les automatisations."
  );
}

// ==================================================================
// La lecture
// ==================================================================

/**
 * Le port de lecture de `ai_agent_settings`.
 *
 * Il rend une ligne par agent connu, ou lève. L'adaptateur réel est
 * dans `supabase.ts` ; les tests en fournissent un faux et n'ouvrent
 * donc aucune connexion.
 */
export type PortReglagesAgents = (
  organizationId: string,
) => Promise<readonly { agent: string; enabled: unknown; autonomy_level: unknown }[]>;

/**
 * Les réglages des agents d'une organisation.
 *
 * `agents` est la liste de CEUX QU'ON DEMANDE, et la réponse en porte
 * exactement autant : un agent absent de la table reçoit le défaut,
 * marqué `parDefaut`. Rendre une carte plus courte que demandée
 * obligerait chaque appelant à gérer l'absence — et l'un d'eux
 * l'oublierait.
 */
export async function lireReglagesAgents(
  organizationId: string,
  agents: readonly CleAgentModele[],
  port: PortReglagesAgents,
  signaler: (message: string) => void = (m) => console.error(m),
): Promise<Record<string, ReglageAgent>> {
  const carte: Record<string, ReglageAgent> = {};
  for (const agent of agents) {
    carte[agent] = {
      agent,
      actif: REGLAGE_PAR_DEFAUT.actif,
      niveau: REGLAGE_PAR_DEFAUT.niveau,
      parDefaut: true,
    };
  }

  let lignes: readonly { agent: string; enabled: unknown; autonomy_level: unknown }[];
  try {
    lignes = await port(organizationId);
  } catch (erreur) {
    // On ne relève pas l'exception : un réglage illisible doit produire
    // « il répond mais n'agit pas », pas « Oasis est en panne ». Mais
    // le silence serait pire — une entreprise réglée au niveau 3 dont
    // les agents cessent d'exécuter sans un mot chercherait longtemps.
    signaler(
      `réglages d'autonomie illisibles pour l'organisation ${organizationId} (${
        erreur instanceof Error ? erreur.message : String(erreur)
      }) : tous les agents retombent au niveau 1, où ils ne peuvent rien écrire.`,
    );
    return carte;
  }

  for (const ligne of lignes) {
    // LA BASE ÉCRIT `quote_pricing`, LA SPEC `quotePricing`. Sans cette
    // normalisation, la ligne de la base ne rejoindrait jamais la clé
    // demandée et l'agent de chiffrage resterait au niveau 1 quoi que
    // l'entreprise règle — une panne muette, du bon côté par accident,
    // et impossible à diagnostiquer depuis l'écran.
    const cle = normaliserCleAgent(ligne.agent);
    if (cle === null) continue;

    // Une ligne pour un agent qu'on n'a pas demandé est IGNORÉE, jamais
    // ajoutée : sinon un cinquième agent apparu en base entrerait dans
    // le produit sans qu'aucune ligne de code ne l'ait décidé.
    const cible = carte[cle];
    if (cible === undefined) continue;

    carte[cle] = {
      agent: cible.agent,
      actif: ligne.enabled !== false,
      niveau: lireNiveauAutonomie(ligne.autonomy_level),
      parDefaut: false,
    };
  }

  return carte;
}
