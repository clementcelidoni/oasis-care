import type { DayNote, Team } from "@/lib/field/types";

/**
 * Ce que le serveur prépare pour l'écran, et rien de plus.
 *
 * Le planning croise cinq tables — interventions, équipes, salariés,
 * clients, sites — pour répondre à trois questions du matin : quoi,
 * qui, où. Les recoller dans le composant client obligerait à lui
 * envoyer les cinq tables entières ; on lui envoie les réponses.
 */

/** Une équipe et les prénoms qui la composent. Le chef d'abord. */
export type EquipeVue = Team & {
  membres: string[];
};

/** L'adresse d'un chantier, prête à lire et prête à ouvrir. */
export type SiteVue = {
  id: string;
  name: string;
  adresse: string | null;
  /** Vers une carte, quand on sait où c'est. Jamais deviné. */
  carteHref: string | null;
};

/** Une note de journée, avec le nom de qui l'a écrite. */
export type NoteVue = DayNote & {
  auteur: string | null;
};

/** Ce que le formulaire de création propose. */
export type OptionsCreation = {
  projets: { id: string; number: string; name: string }[];
  clients: { id: string; display_name: string }[];
};
