import type { DefinitionAgent } from "./types.ts";

/**
 * FACTURATION — ce qui est fait et pas encore facturé.
 *
 * Déplacé tel quel de `definitions.ts` (§11V), mots-clés compris (la
 * PREMIÈRE règle de `app/api/oasis-ai/aiguillage.ts` — c'est elle qui
 * doit gagner sur « devis » dans « facturer un devis signé », et c'est
 * pour cela que l'aiguilleur l'essaie avant toutes les autres).
 */
export const AGENT_FACTURATION: DefinitionAgent = {
  cle: "billing",
  libelle: "Facturation",
  mission:
    "Chantiers terminés, interventions clôturées, devis signés sans facture, factures en retard.",
  responsabilites:
    "Repère les chantiers terminés, les interventions clôturées et les devis acceptés qui " +
    "n'ont pas de facture, et prépare les brouillons après confirmation.",
  limites: [
    "Crée des BROUILLONS. N'émet aucun numéro de facture, n'envoie rien, n'encaisse rien.",
    "Acomptes et situations de travaux n'existent pas dans ce modèle de données : ils sont " +
      "rendus « indisponibles », pas comptés à zéro.",
    "Exige projects.read, invoice.create et quotes.read ; sans eux il refuse de conclure, " +
      "parce qu'une vue partielle donnerait une réponse fausse et non pas incomplète.",
  ],
  droitsAttendus: ["projects.read", "quotes.read", "invoice.create"],
  motsCles: [
    "factur",
    "à facturer",
    "impay",
    "encaiss",
    // §11Z — « relance de paiement » A SON PLURIEL DEPUIS CE CHANTIER.
    // L'aiguilleur cherche une sous-chaîne CONTIGUË : un « s » à la fin
    // d'une locution est gratuit, mais un « s » sur le PREMIER mot casse
    // tout. Mesuré en rejouant le vrai aiguilleur : « Où en sont mes
    // relances de paiement ? » ne correspondait à rien et tombait à la
    // Direction.
    "relance de paiement",
    "relances de paiement",
    // ══════════════════════════════════════════════════════════════════
    // §11Z — « avoir » NU A ÉTÉ RETIRÉ : IL AVALAIT « SAVOIR »
    // ══════════════════════════════════════════════════════════════════
    //
    // La Facturation est PREMIÈRE dans l'ORDRE, et l'aiguillage compare
    // des sous-chaînes. Le mot nu « avoir » est contenu dans « savoir » :
    // toute question formulée « je voudrais savoir… » ou « j'aimerais
    // savoir… » — la tournure la plus courante du français parlé —
    // partait donc à la Facturation, quel que soit le sujet.
    //
    // MESURÉ en rejouant le vrai aiguilleur, avant correction :
    //   billing | Je voudrais savoir d'où viennent mes clients
    //   billing | Peux-tu me faire savoir quels sont mes risques ?
    //   billing | J'aimerais savoir mon taux de transformation
    //   billing | Je voudrais savoir combien de plantes il me reste
    //
    // Le défaut est antérieur à §11Z, mais il y devient déterminant : il
    // neutralisait à lui seul les trois placements dans l'ORDRE que ce
    // chantier a justifiés et éprouvés.
    //
    // ET LA RÈGLE ANTI-VOL NE L'ATTRAPAIT PAS. `anomaliesDAiguillage`
    // compare les mots-clés ENTRE EUX ; « avoir » n'est la sous-chaîne
    // d'aucun autre mot-clé déclaré, donc elle restait verte pendant que
    // le vol se produisait. Un contrôle contre les mots français
    // fréquents a été ajouté dans `agents/classification.ts` — c'est lui
    // qui refuserait ce mot aujourd'hui.
    "un avoir",
    "note de crédit",
    "brouillon de facture",
  ],
};
