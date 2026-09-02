import { createClient } from "@/lib/supabase/server";

/**
 * §EXEMPLES — « Que dois-je faire aujourd'hui ? » → « Oasis Daily ».
 *
 * CETTE PAGE N'APPELLE PAS LE MODÈLE. Oasis Daily est une liste de
 * faits datés qui existent déjà en base : les interventions du jour,
 * les devis à relancer, les factures en retard. Les faire reformuler
 * par un modèle coûterait de l'argent, ajouterait une latence, et
 * introduirait un risque d'invention là où il n'y a que des dates à
 * lire.
 *
 * « L'IA doit être profondément intégrée. Pas uniquement un chatbot »
 * ne veut pas dire « faire passer chaque écran par un modèle ». Ici, la
 * bonne intégration, c'est que la MÊME fonction serve l'écran et
 * l'assistant : `ai_get_daily_priorities`. Les deux disent donc
 * exactement la même chose, et l'écran continue de fonctionner quand
 * l'assistant est indisponible.
 */

export type DailyPriorities = {
  date: string;
  interventionsDuJour: { titre: string; debut: string; statut: string; client: string | null }[];
  devisARelancer: { numero: string; titre: string; envoyeLe: string; client: string | null }[];
  devisQuiExpirent: { numero: string; valableJusquAu: string }[];
  facturesEnRetard: {
    numero: string;
    echeance: string;
    resteADevoir: number;
    client: string | null;
  }[];
  chantiersEnRetard: { numero: string; nom: string; finPrevue: string }[];
  pointagesAValider: { nombre?: number; heures?: number };
  receptionsAttendues: { commande: string; attendueLe: string }[];
  /**
   * Vrai quand la liste n'a PAS pu être établie.
   *
   * Distinct d'une liste vide, et c'est tout l'objet du champ : « rien
   * à signaler » et « je n'ai pas pu regarder » ne sont pas la même
   * phrase, surtout quand elles portent sur des factures en retard.
   */
  failed?: boolean;
};

const EMPTY: DailyPriorities = {
  date: "",
  interventionsDuJour: [],
  devisARelancer: [],
  devisQuiExpirent: [],
  facturesEnRetard: [],
  chantiersEnRetard: [],
  pointagesAValider: {},
  receptionsAttendues: [],
  failed: false,
};

/**
 * « RIEN À SIGNALER » ET « JE N'AI PAS PU REGARDER » NE SONT PAS LA MÊME
 * PHRASE.
 *
 * La version précédente rendait `EMPTY` dans les deux cas. Une erreur
 * SQL, une fonction absente parce qu'une migration n'a pas été lancée,
 * une coupure réseau : l'écran affichait « Rien ne réclame votre
 * attention aujourd'hui ». C'est le pire message possible — il est
 * rassurant, il a l'air d'une réponse, et il porte sur des factures en
 * retard et des interventions du jour qu'on ne verra donc pas.
 *
 * Le drapeau `failed` remonte jusqu'à l'écran, qui dit alors qu'il n'a
 * pas pu établir la liste.
 */
export async function getDailyPriorities(organizationId: string): Promise<DailyPriorities> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_get_daily_priorities", {
    p_organization_id: organizationId,
  });

  if (error) {
    console.error("priorités du jour :", error.message);
    return { ...EMPTY, failed: true };
  }
  if (!data) return { ...EMPTY, failed: true };
  return { ...EMPTY, ...(data as Partial<DailyPriorities>) };
}

/** Combien de choses réclament une action aujourd'hui. */
export function urgentCount(daily: DailyPriorities): number {
  return (
    daily.interventionsDuJour.length +
    daily.devisARelancer.length +
    daily.devisQuiExpirent.length +
    daily.facturesEnRetard.length +
    daily.chantiersEnRetard.length +
    daily.receptionsAttendues.length +
    ((daily.pointagesAValider.nombre ?? 0) > 0 ? 1 : 0)
  );
}
