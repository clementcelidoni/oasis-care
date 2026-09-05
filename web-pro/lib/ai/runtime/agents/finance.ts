import type { DefinitionAgent } from "./types.ts";

/**
 * FINANCE — les trois chiffres d'affaires, les marges, les créances.
 *
 * Déplacé tel quel de `definitions.ts` (§11V), mots-clés compris (la
 * troisième règle de `app/api/oasis-ai/aiguillage.ts`).
 */
export const AGENT_FINANCE: DefinitionAgent = {
  cle: "finance",
  libelle: "Finance",
  mission:
    "Chiffre d'affaires signé, facturé et encaissé, marges réalisées, créances et trésorerie observée.",
  responsabilites:
    "Surveille les trois chiffres d'affaires — signé, facturé, encaissé — la marge estimée contre " +
    "la marge réelle, les créances et les retards.",
  limites: [
    "N'écrit rien.",
    "Un droit manquant rend « null » et se nomme : jamais zéro.",
    "Quatre des sept dimensions de marge sont déduites faute de champ dédié, et la réponse le dit.",
  ],
  droitsAttendus: ["projects.read", "quotes.read", "invoice.create"],
  motsCles: [
    "chiffre d'affaires",
    "chiffre d affaires",
    "marge",
    "tresorerie",
    "trésorerie",
    "créance",
    "creance",
    "rentabilit",
    "dépense",
    "depense",
    "objectif",
    "budget",
  ],
};
