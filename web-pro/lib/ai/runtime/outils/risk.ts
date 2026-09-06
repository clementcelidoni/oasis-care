import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Z — L'OUTIL PROPRE À L'AGENT RISQUES.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Même raison que les six qui l'ont précédé : le catalogue est PARTAGÉ,
 * deux constructeurs écrivent en même temps, et deux mains dans le même
 * tableau font un des deux travaux perdu à la fusion.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN SEUL GESTE D'INTÉGRATION, PARCE QUE LE SQL EST DÉJÀ POSÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_risk_snapshot` vit dans `supabase/migrations/0088_agents_derniers.sql`
 * et son épreuve dans `supabase/tests/agents_derniers.sql`. Il reste
 * donc à verser `OUTIL_RISK_SNAPSHOT` dans `OUTILS_LECTURE`
 * (`runtime/tools.ts`), par un import.
 *
 * Tant que ce n'est pas fait, `tools.test.ts` §8 échoue en disant
 * « déclaré dans outils/risk.ts et AU REGISTRE nulle part ». C'est
 * exact, et c'est le rôle de ce test.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÈGLE QUE CET AGENT EXISTE POUR TENIR : MESURÉ ≠ DÉDUIT
 * ══════════════════════════════════════════════════════════════════
 *
 * « Trois factures dépassent leur échéance » se MESURE. « Ce client
 * paiera sans doute en retard » se DÉDUIT. Les deux phrases se
 * ressemblent et n'ont pas la même valeur ; un agent qui les mélange
 * fait passer une intuition pour un relevé, et le dirigeant appelle un
 * client sur une intuition en croyant appeler sur un relevé.
 *
 * LA FONCTION NE REND QUE DES MESURES, et elle le DIT champ par champ :
 * chacun de ses cinq blocs porte `nature: 'mesure'`, et
 * `regleDEtiquetage` rappelle dans la réponse elle-même que toute
 * phrase qui ne sort pas d'un de ces champs est une déduction à
 * annoncer comme telle. La règle vit donc dans la DONNÉE et pas
 * seulement dans un prompt — un réglage qui cesserait un jour
 * d'injecter les limites n'emporterait pas la règle avec lui.
 *
 * La description ci-dessous porte la même règle, pour la raison qui
 * vaut aussi côté Marché : elle est ce que le modèle lit AVANT d'avoir
 * vu la réponse.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL NE RECOMPTE PAS, ET POURQUOI IL EXIGE TROIS DROITS
 * ══════════════════════════════════════════════════════════════════
 *
 * Les factures échues sont LUES dans `ai_billing_candidates` (sa
 * section 4), jamais recomptées. Deux comptes du même encours dans le
 * même produit finiraient un jour par différer, et personne ne saurait
 * lequel croire — c'est exactement le doublon que le découpage des
 * agents existe pour éviter.
 *
 * Conséquence directe : la fonction exige les TROIS mêmes droits que
 * celle qu'elle appelle — `projects.read`, `invoice.create`,
 * `quotes.read` — et elle les exige AVANT de lire, plutôt que de
 * laisser l'appel échouer plus bas sur un message qui parlerait de la
 * Facturation et pas du Risque.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI `invoice.create` : C'EST MESURÉ, PAS CHOISI AU JUGÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Trois droits lèvent, le champ `permission` n'en accepte qu'un, et il
 * ne sert pas à décrire la fonction : il sert à ne PAS offrir au modèle
 * un outil qui échouera. Le bon choix est celui qui filtre exactement.
 *
 * Relevé dans `role_permissions` : neuf rôles portent `projects.read`,
 * six portent `quotes.read`, DEUX portent `invoice.create`
 * (`accounting` et `manager`) — et ces deux-là portent aussi les deux
 * autres. `invoice.create` est donc le droit qui décide seul, et le
 * déclarer ici retire l'outil à exactement l'ensemble des comptes qui
 * échoueraient. C'est aussi cohérent avec `getUnbilledProjects`, qui
 * déclare le même droit pour la même fonction sous-jacente.
 */
export const OUTIL_RISK_SNAPSHOT: OutilOasis = {
  nom: "getRiskSnapshot",
  famille: "lecture",
  agent: "risk",
  rpc: "ai_risk_snapshot",
  // L'organisation vient de la SESSION, jamais du modèle.
  injecteOrganisation: true,
  permission: "invoice.create",
  // Trois `perform public.ai_guard(...)` en ouverture : le refus est
  // une exception nommée, jamais une vue partielle.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // Le seul montant rendu est le reste dû ÉCHU, et il est LU chez la
  // Facturation plutôt que recalculé. La concentration, elle, est un
  // ratio sans euros : ni montant ni nom de client.
  fournit: ["totalFacture"],
  description:
    "Ce qui se mesure du risque, et rien de plus : concentration du chiffre d'affaires facturé " +
    "(un ratio, sans euros ni nom de client), encours échu LU chez la Facturation, " +
    "comportement de paiement, tenue des délais, et l'état du schéma pour la cascade de " +
    "retards. " +
    "TOUT CE QUE REND CET OUTIL EST UNE MESURE — chaque bloc porte « nature: mesure ». Toute " +
    "phrase que tu ajoutes et qui ne sort pas d'un de ces champs est une DÉDUCTION, et tu dois " +
    "l'annoncer comme telle, avec le fait mesuré qui la porte. Écris « je mesure trois factures " +
    "échues » puis « j'en déduis, sans certitude, que… » : ne fais jamais passer la seconde " +
    "pour la première. " +
    "LA PHRASE « AUCUN RISQUE DÉTECTÉ » EST INTERDITE, en toutes lettres. Sur ces tables elle " +
    "voudrait dire « je n'ai rien à lire » et serait comprise comme « tout va bien ». Dis ce " +
    "que tu as regardé, ce que tu y as trouvé, et ce que tu n'as pas pu regarder. " +
    "AUCUN SCORE, AUCUNE NOTE, AUCUN FEU TRICOLORE, AUCUNE PROBABILITÉ CHIFFRÉE : un score " +
    "mélange mesures et déductions dans un seul nombre et fait disparaître la distinction que " +
    "cet outil existe pour tenir. " +
    "LIS LES CHAMPS « motif » ET « mesurable » AVANT DE CONCLURE. Sous le seuil, la fonction " +
    "rend null et le motif : ce null veut dire « trop peu d'observations pour conclure », " +
    "jamais « zéro ». " +
    "Zéro facture en retard ne veut pas dire que les clients paient : lis " +
    "« facturesNonEncoreEchues » et « echeancesDejaArrivees ». Zéro règlement enregistré veut " +
    "dire qu'on ne peut PAS distinguer une facture impayée d'une facture payée hors logiciel. " +
    "Aucune date de fin prévue veut dire « aucune référence », pas « aucun retard ». " +
    "La cascade de retards est vérifiée sur le schéma à chaque appel : tant que " +
    "« calculable » est faux, c'est une fonctionnalité absente et non une donnée manquante. " +
    "Le bloc « nonMesurable » nomme ce qui appartient à d'autres : la marge et sa dérive à la " +
    "Finance, le reste dû d'un client nommé à l'agent Clients, les échéances du parc au " +
    "Matériel, les devis qui expirent au Chiffrage. Renvoie-y plutôt que de recalculer.",
  // Aucun paramètre, et c'est délibéré : une fenêtre de dates choisie
  // par le modèle permettrait de rétrécir la période jusqu'à passer
  // sous — ou au-dessus — d'un seuil, donc de faire dire à la fonction
  // ce qu'on veut y lire. Les dénominateurs sont posés par le SQL.
  parametres: z.object({}),
};
