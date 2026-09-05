import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Y — LES DEUX OUTILS PROPRES À L'AGENT MATÉRIEL.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Le catalogue est PARTAGÉ, plusieurs agents s'écrivent en même temps,
 * et deux mains dans le même tableau font un des deux travaux perdu à
 * la fusion. Le constructeur écrit son outil chez lui ; l'intégration
 * le verse au catalogue.
 *
 * Les entrées ci-dessous sont complètes, typées `OutilOasis`, et prêtes
 * à être collées dans `OUTILS_LECTURE`. Elles ne sont PAS enregistrées
 * au registre tant que l'intégration ne l'a pas fait, et c'est
 * délibéré : `tools.test.ts` échouerait, à juste titre, sur un outil
 * dont la fonction SQL n'est encore dans aucune migration.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES TROIS GESTES D'INTÉGRATION, ET ILS VONT ENSEMBLE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. `supabase/migrations/0082_agents_ia.sql` reçoit le corps de
 *      `outils/fleet.sql`, tel quel — les DEUX fonctions.
 *   2. `runtime/tools.ts` reçoit `OUTIL_FLEET_SNAPSHOT` et
 *      `OUTIL_FLEET_EQUIPMENT` dans `OUTILS_LECTURE`.
 *   3. `supabase/tests/agents_ia.sql` reçoit `outils/fleet.epreuve.sql`.
 *
 * DANS LE MÊME COMMIT. Le geste 2 sans le geste 1 déclare un outil dont
 * la fonction n'existe pas — le défaut que l'en-tête de `tools.ts`
 * décrit comme le plus silencieux du lot.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'UN GESTE NE FAIT PAS : `getFleetCosts` RESTE « ABSENT »
 * ══════════════════════════════════════════════════════════════════
 *
 * `OUTILS_SPEC_SANS_SERVICE` porte `getFleetCosts` à l'état « absent »,
 * avec la phrase « le matériel est suivi, son coût d'usage ne l'est
 * pas ». CETTE LIGNE NE DOIT PAS CHANGER, et c'est le point le plus
 * important de ce fichier.
 *
 * Ces deux outils ne livrent PAS les coûts de flotte. Ils livrent les
 * échéances, la disponibilité et l'entretien SAISI — ce qui est l'autre
 * moitié de la mission. Le coût d'usage (carburant, coût au kilomètre
 * ou à l'heure, amortissement, refacturation au chantier) n'a AUCUN
 * schéma dans ce produit, et la seule chose qu'on puisse en faire est de
 * continuer à le dire.
 *
 * C'est aussi ce qui explique le nom des outils. Ni l'un ni l'autre ne
 * s'appelle `getFleetCosts` : un outil qui porterait ce nom en ne
 * rendant que des factures d'entretien ferait croire que la question
 * « combien me coûte ce camion » a une réponse ici.
 */

/**
 * L'ÉTAT DU PARC ET CE QUI EXPIRE.
 *
 * ─── POURQUOI IL EXISTE, ALORS QUE `searchEntities` EST LÀ ───
 *
 * `searchEntities` délègue à `global_search`, qui N'INDEXE PAS le
 * matériel : aucune fonction `ai_*` de la base ne contient le mot
 * `equipment`. L'agent Matériel n'avait donc, avant ce fichier,
 * STRICTEMENT AUCUNE source — pas une source pauvre, pas une source
 * partielle : aucune. C'est ce qui le distinguait d'un agent à
 * compléter et d'une façade.
 *
 * ─── CE QUE LE MODÈLE N'A PAS À CALCULER ───
 *
 * `equipment_due_dates` rend déjà `days_left` (un entier de jours) et
 * `state` ('overdue', 'dueSoon', 'planned'), calculés à la date de
 * PARIS. Le modèle ignore le fuseau ; une soustraction de dates faite
 * par lui se tromperait d'un jour deux fois par an, et sur un contrôle
 * technique un jour compte. La frontière déterministe de la p. 11 est
 * ici tenue par le SCHÉMA, pas par une consigne.
 */
export const OUTIL_FLEET_SNAPSHOT: OutilOasis = {
  nom: "getFleetSnapshot",
  famille: "lecture",
  agent: "fleet",
  rpc: "ai_fleet_snapshot",
  // L'organisation vient de la SESSION. Le schéma ci-dessous ne la
  // nomme pas, et il ne peut donc pas la laisser choisir au modèle.
  injecteOrganisation: true,
  permission: "projects.read",
  // « aiGuard » et non « rls », et c'est exact plutôt que coutumier :
  // `ai_fleet_snapshot` ouvre sur `perform public.ai_guard(...,
  // 'projects.read')`, qui LÈVE. C'est capital ici : sans ce droit, la
  // RLS masquerait les quatre tables et la fonction rendrait « aucun
  // matériel enregistré » — un mensonge rassurant, indiscernable d'un
  // parc réellement vide. Le refus doit être une exception nommée.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // Du prix : le coût d'acquisition saisi, le cumul d'entretien
  // réellement dépensé, et leur rapport — tous additionnés et divisés
  // par le SQL. Pas de « marge » : rien ici n'est rapproché d'une vente.
  fournit: ["prix"],
  maxElements: 50,
  description:
    "État du parc matériel : effectifs par statut et par catégorie, disponibilité (affectées, " +
    "au dépôt, à l'atelier, immobilisées), échéances triées par urgence sur une fenêtre de " +
    "30 jours par défaut, et entretien réellement dépensé par machine. " +
    "LIS « parc.vide » AVANT TOUT LE RESTE : quand il vaut true, aucune machine n'a jamais été " +
    "saisie, les compteurs d'échéances valent null et tu dois répondre « aucun matériel " +
    "enregistré » en renvoyant vers /materiel. Ne dis JAMAIS « 0 échéance en retard » dans ce " +
    "cas : « personne n'a saisi de machine » et « tout est à jour » sont deux phrases opposées. " +
    "Même règle pour « echeances.suivies » à false : des machines existent, aucune échéance " +
    "n'est saisie, donc rien ne permet de dire que le parc est en règle. " +
    "« machinesSansEcheance » compte les engins hors de tout suivi : cite-le, il nuance les " +
    "autres chiffres. " +
    "Le retard n'est jamais coupé par la fenêtre : une échéance dépassée y figure toujours. " +
    "« auDepot » veut dire « aucune affectation saisie », pas une position géographique. " +
    "LE BLOC « nonMesurable » EST UN REFUS, PAS UNE NOTE : ni carburant, ni coût au kilomètre " +
    "ou à l'heure, ni amortissement, ni géolocalisation, ni refacturation au chantier " +
    "n'existent dans ce produit. N'estime aucun de ces chiffres.",
  parametres: z.object({
    // `.nullable()` et non `.optional()` : le mode strict des sorties
    // structurées exige que toutes les clés soient présentes.
    p_days: z
      .number()
      .int()
      .nullable()
      .describe(
        "Fenêtre en jours pour les échéances à venir, 1 à 366. Null = 30. " +
          "Une valeur hors bornes est ramenée dedans. Les retards sortent quelle que soit la fenêtre.",
      ),
  }),
};

/**
 * LA FICHE D'UNE MACHINE, RÉSOLUTION COMPRISE.
 *
 * ─── POURQUOI LA RÉSOLUTION EST DANS L'OUTIL ───
 *
 * Parce que `searchEntities` ne sait pas retrouver « le Master » : le
 * matériel n'est pas indexé. Deux réponses étaient possibles — écrire un
 * quatrième outil de recherche propre au matériel, ce qui aurait donné
 * DEUX manières de chercher une entité dans ce produit et un modèle qui
 * hésite entre les deux ; ou porter la résolution ici. C'est le second
 * choix, et il tient en une phrase : l'outil accepte un fragment de nom,
 * de plaque, de numéro interne, de marque ou de modèle — et
 * l'identifiant lui-même, que l'écran `/materiel/[id]` a sous la main.
 *
 * ─── L'AMBIGUÏTÉ EST UNE RÉPONSE, PAS UNE ERREUR ───
 *
 * Deux tondeuses qui répondent au même fragment rendent `trouve: false`
 * et la LISTE des candidats. Choisir la première serait rendre la fiche
 * d'une machine en la faisant passer pour l'autre — et rien, dans la
 * réponse, ne permettrait de s'en apercevoir.
 */
export const OUTIL_FLEET_EQUIPMENT: OutilOasis = {
  nom: "getEquipmentRecord",
  famille: "lecture",
  agent: "fleet",
  rpc: "ai_fleet_equipment",
  injecteOrganisation: true,
  permission: "projects.read",
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  fournit: ["prix"],
  maxElements: 25,
  description:
    "Fiche d'UNE machine, trouvée à partir d'un fragment de son nom, de sa plaque, de son " +
    "numéro interne, de sa marque ou de son modèle — ou de son identifiant. Rend l'identité, " +
    "le statut, l'affectation ouverte, le compteur AVEC sa date de relevé, le prix d'achat, " +
    "le cumul d'entretien et son journal, et les échéances qui courent. " +
    "N'UTILISE PAS « searchEntities » POUR TROUVER UNE MACHINE : il n'indexe pas le matériel. " +
    "Cet outil fait la recherche lui-même. " +
    "QUAND « trouve » VAUT false, LIS « motif » : « parcVide » à true veut dire qu'aucune " +
    "machine n'est enregistrée dans l'entreprise — ce n'est pas « je n'ai pas trouvé celle-ci ». " +
    "Plusieurs candidats : demande laquelle, n'en choisis jamais une. " +
    "LE COMPTEUR DATE DU DERNIER PASSAGE À L'ATELIER, pas d'aujourd'hui : cite toujours " +
    "« releveLe » avec la valeur, et n'extrapole aucune usure ni aucune panne à venir. " +
    "Un compteur ou un coût à null veut dire « non relevé » ou « non saisi », jamais zéro. " +
    "L'affectation est une SAISIE, pas une position : aucune géolocalisation n'existe.",
  parametres: z.object({
    p_query: z
      .string()
      .min(1)
      .describe(
        "Fragment du nom, de la plaque, du numéro interne, de la marque ou du modèle — " +
          "ou l'identifiant (UUID) de la machine.",
      ),
  }),
};

/** Les deux, pour l'intégration et pour les tests. */
export const OUTILS_MATERIEL: readonly OutilOasis[] = Object.freeze([
  OUTIL_FLEET_SNAPSHOT,
  OUTIL_FLEET_EQUIPMENT,
]);
