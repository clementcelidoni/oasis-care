import type { DefinitionAgent } from "./types.ts";

/**
 * DIRECTION — l'agent qui n'a aucune donnée à lui.
 *
 * Déplacé tel quel de `definitions.ts` (§11V). Pas une virgule n'a
 * bougé : un déplacement qui reformule une limite la change, et une
 * limite changée sans qu'on s'en aperçoive est le pire résultat
 * possible d'un rangement.
 *
 * Ses mots-clés viennent, eux aussi tels quels, de la quatrième règle
 * de `app/api/oasis-ai/aiguillage.ts`. Ils sont les plus généraux du
 * lot, et c'est pour cela que l'aiguilleur essaie la Direction EN
 * DERNIER : « la situation » ne doit gagner contre « facture en
 * retard » sous aucun prétexte.
 */
export const AGENT_DIRECTION: DefinitionAgent = {
  cle: "executive",
  libelle: "Direction",
  mission:
    "Coordonne les autres agents et classe ce qui compte : il n'a aucune donnée à lui, " +
    "il agrège les leurs.",
  responsabilites:
    "Coordonne les trois autres et classe ce qu'il faut faire aujourd'hui. Ne produit aucun " +
    "chiffre qui lui soit propre : chaque ligne de son brief porte le nom de l'agent qui l'a calculée.",
  limites: [
    "N'écrit rien : aucun outil d'action ne lui appartient.",
    "Ne prévoit pas le chiffre d'affaires — une prévision est une estimation, et elle est interdite.",
    "Son classement est pondéré par des poids choisis, rendus avec chaque ligne pour être contestés.",
    "Ne lit JAMAIS la base directement : il interroge les spécialistes et n'utilise que leurs sorties structurées.",
  ],
  droitsAttendus: ["projects.read"],
  motsCles: [
    "que dois-je faire",
    "priorit",
    "brief",
    "aujourd'hui",
    "aujourd hui",
    "situation",
    "résum",
    "resum",
    "quoi de neuf",
    "urgent",
  ],
};
