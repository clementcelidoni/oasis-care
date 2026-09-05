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
    "relance de paiement",
    "avoir",
    "brouillon de facture",
  ],
};
