import type { CleAgentModele } from "../types.ts";

/**
 * §11Y — LES AGENTS QUE LA SPEC NOMME ET QUI N'ONT RIEN DERRIÈRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE LISTE EXISTE PLUTÔT QU'UN SILENCE
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est le même mécanisme que `OUTILS_SPEC_SANS_SERVICE` (tools.ts),
 * et c'est volontairement le même : ce dépôt traite déjà « la spec le
 * demande et il n'y a rien derrière » en le NOMMANT, avec le motif, à
 * côté de ce qui existe. On ne réinvente pas une seconde manière.
 *
 * Un agent absent de tout fichier serait indiscernable d'un agent
 * oublié. Un dirigeant qui a lu la spec cherchera « Marché » ; lui
 * montrer le silence est pire que lui montrer « pas encore, et voici
 * ce qui manque ». Le développeur suivant, lui, se demanderait s'il
 * doit le construire — et la réponse est écrite ici, avec ce qu'il
 * faudrait livrer AVANT.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI A DÉCIDÉ DES QUATRE
 * ══════════════════════════════════════════════════════════════════
 *
 * UN AGENT SANS DONNÉES EST UNE FAÇADE, ET UNE FAÇADE EST PIRE QUE
 * RIEN. Elle rend une phrase polie que personne ne peut contredire, et
 * elle consomme un appel de modèle pour la produire. Ce produit vient
 * d'en payer le prix une fois : l'architecture IA a été livrée
 * entièrement branchée sur du vide, et il a fallu un second chantier
 * pour la relier.
 *
 * Le critère n'est donc PAS « la table est vide ». Les six agents
 * construits lisent des tables presque vides eux aussi — cette base a
 * huit jours. Le critère est : « existe-t-il trois questions de
 * paysagiste auxquelles cet agent répondrait par un fait, et que
 * personne d'autre ne sert déjà ? » Les quatre ci-dessous ratent ce
 * test, chacun pour une raison différente, et les quatre raisons sont
 * écrites.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ELLE NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle n'entre PAS dans la migration 0082. `ai_is_supported_agent`
 * continue de refuser ces quatre noms, et c'est le bon comportement :
 * on ne doit pas pouvoir fixer un plafond de coût ni choisir un modèle
 * pour un agent qui n'existe pas. Une ligne de réglage pour un agent
 * inexistant est une ligne morte qui donne l'illusion d'un réglage
 * actif.
 */

export type AgentSansDonnees = {
  cle: CleAgentModele;
  /** Son nom français, pour l'écran. Le même que `LIBELLES_AGENT`. */
  libelle: string;
  /**
   * POURQUOI IL N'EST PAS CONSTRUIT — mesuré, pas supposé.
   *
   * En une phrase que le dirigeant peut lire. Le détail long vit dans
   * les commentaires du sondage, pas dans une propriété affichée.
   */
  motif: string;
  /**
   * CE QU'IL FAUDRAIT LIVRER D'ABORD, dans l'ordre.
   *
   * C'est la partie utile de la déclaration : « pas encore » sans
   * condition de levée est un refus définitif déguisé en délai.
   */
  aLivrerDabord: readonly string[];
};

export const AGENTS_SANS_DONNEES: readonly AgentSansDonnees[] = Object.freeze([
  {
    cle: "sales",
    libelle: "Commerce",
    motif:
      "Le schéma commercial est complet — étapes d'opportunité, probabilité, date de clôture, " +
      "motif de perte — mais il n'a jamais servi : aucune opportunité, aucune activité, aucun " +
      "contact, un seul devis décidé dix-neuf secondes après son envoi. Et la seule part qui " +
      "aurait de la matière est DÉJÀ livrée deux fois : la Direction calcule en SQL les devis " +
      "sans réponse et ceux qui expirent, et l'action « relancer un devis » appartient au " +
      "chiffrage. Un agent Commerce ferait une seconde source de vérité sur le même chiffre.",
    aLivrerDabord: [
      "De l'usage réel du module Opportunités — l'écran existe, personne ne l'a rempli.",
      "Un arbitrage : la relance de devis reste-t-elle au chiffrage, ou passe-t-elle au commerce ? " +
        "Tant qu'il n'est pas tranché, construire cet agent fabrique le doublon.",
    ],
  },
  {
    cle: "market",
    libelle: "Marché",
    motif:
      "C'est le seul des quatorze dont la spec nomme une source EXTERNE — recherche web côté " +
      "serveur, p. 16 — et cette capacité n'est pas commencée : les vingt et un outils du " +
      "registre sont tous des fonctions Supabase. Aucune table ne stocke de donnée externe, " +
      "donc il n'existe même pas d'endroit où écrire la source, la date, l'url et la fraîcheur " +
      "que la page 16 rend obligatoires. Le repli sur l'historique interne est déjà servi par " +
      "le chiffrage (`getHistoricalProjectComparisons`), qui refuse correctement en dessous de " +
      "cinq comparables.",
    aLivrerDabord: [
      "Une capacité de recherche web côté serveur, avec une table de citations et un cache daté — " +
        "sans persistance, la traçabilité exigée p. 16 est intenable.",
      "Des prix fournisseurs réellement saisis : c'est la seule donnée de marché qu'une " +
        "entreprise possède légitimement.",
      "Un CRM alimenté, avec des motifs de perte : c'est là, et nulle part ailleurs, qu'on " +
        "apprend pourquoi on perd face à un concurrent.",
    ],
  },
  {
    cle: "risk",
    libelle: "Risques",
    motif:
      "La spec ne le décrit nulle part — deux mentions en trente-cinq pages, aucune section, " +
      "et il est absent du tableau d'administration p. 26. Ses quatre axes plausibles tombent " +
      "un par un : les impayés sont déjà rendus par la Finance et la Facturation ; une dérive " +
      "de marge est une dérivée et il n'y a qu'un point ; la concentration client vaudrait " +
      "100 % par construction sur un seul client — un chiffre exact qui ne décrit rien ; et " +
      "les retards en cascade n'ont pas de SCHÉMA, aucune dépendance entre tâches n'existe.",
    aLivrerDabord: [
      "Des règlements réellement saisis : tant qu'aucun paiement n'est enregistré, « impayé » " +
        "est indécidable, et zéro ne se distingue pas de je-ne-sais-pas.",
      "Des dates de fin prévues sur les chantiers et les phases : sans promesse, pas de retard.",
      "Un modèle de dépendance entre tâches, qui n'existe pas : sans lui, « cascade » est un mot.",
      "Un seuil de refus explicite, sur le modèle du chiffrage : pas de verdict de risque en " +
        "dessous de N clients et N mois.",
    ],
  },
  {
    cle: "classification",
    libelle: "Classement",
    motif:
      "Ce n'est pas un agent, et la spec ne le range pas parmi les treize à créer : c'est une " +
      "étape de pré-traitement à bas coût (p. 31). Elle est DÉJÀ construite et testée — " +
      "`runtime/preprocessing.ts`, règles déterministes avant le modèle, découpe en lots, " +
      "double filtre anti-hallucination. Ce qui manque n'est pas du code, c'est un corpus : " +
      "zéro activité CRM, et la catégorie est de toute façon posée à la saisie par un menu " +
      "déroulant sous contrainte fermée. La règle déterministe traiterait 100 % du corpus et " +
      "le modèle ne serait jamais appelé.",
    aLivrerDabord: [
      "Des activités CRM saisies en volume — la spec en suppose mille, la base entière en " +
        "compte environ quarante de prose, et ce sont des libellés d'articles.",
      "Une raison de classer qui ne soit pas déjà tranchée à la saisie : une importation " +
        "d'e-mails ou de notes vocales, où le type n'est pas choisi dans un menu.",
      "Un écran qui consomme le classement, ce qui n'existe nulle part.",
    ],
  },
]);

/** Vrai si cet agent est déclaré sans données (donc jamais construit). */
export function estAgentSansDonnees(valeur: unknown): boolean {
  return (
    typeof valeur === "string" && AGENTS_SANS_DONNEES.some((entree) => entree.cle === valeur)
  );
}
