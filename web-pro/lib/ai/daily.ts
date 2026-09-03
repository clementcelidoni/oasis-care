import { createClient } from "@/lib/supabase/server";
import {
  readBriefItem,
  readConfidence,
  readStringArray,
  readText,
  type BriefItem,
  type DailyRubrique,
  type OasisDaily,
} from "@/lib/ai/types";

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

// ==================================================================
// §11V OASIS DAILY — le briefing du matin
// ==================================================================
//
// C'EST LE PREMIER CRITÈRE DE VALIDATION DE LA SPEC (p. 49) : « Je dois
// pouvoir ouvrir Oasis Care Pro le matin et voir OASIS DAILY avec de
// vraies recommandations basées sur les données. »
//
// La fonction `ai_oasis_daily` (0073) fait tout le travail : elle
// compose `ai_get_daily_priorities` (les sept listes de faits datés) et
// `ai_executive_brief` (le classement et les montants), et regroupe le
// tout en rubriques. Elle rend AUSSI, dans `sources.prioritesDuJour`,
// la charge utile des priorités — d'où un seul aller-retour ici plutôt
// que deux.
//
// AUCUN MODÈLE N'EST APPELÉ. Le briefing est du SQL. Le faire reformuler
// par un modèle coûterait de l'argent, ajouterait une latence, et
// introduirait un risque d'invention là où il n'y a que des dates et des
// sommes à lire. L'écran continue donc de fonctionner sans clé OpenAI.

export type OasisDailyResult = {
  briefing: OasisDaily;
  /**
   * Les sept listes de faits, telles que les affichait déjà cet écran.
   * Elles viennent de la même réponse, donc elles ne peuvent pas
   * diverger du briefing qui les résume.
   */
  priorities: DailyPriorities;
};

const EMPTY_BRIEFING: OasisDaily = {
  date: null,
  salutation: "Bonjour",
  droitsManquants: [],
  rubriques: [],
  confiance: "insufficient_data",
  note: null,
  failed: false,
  failureReason: null,
};

/**
 * Le briefing du matin, ou la raison pour laquelle il n'y en a pas.
 *
 * TROIS ISSUES, ET ELLES NE SE CONFONDENT PAS :
 *
 *   • `failed: false`, des rubriques  → il y a de quoi dire ;
 *   • `failed: false`, aucune rubrique → il n'y a rien à signaler, et
 *     c'est une bonne nouvelle qu'on peut afficher comme telle ;
 *   • `failed: true`                   → on n'a PAS PU regarder. Ce
 *     n'est pas « rien à signaler » : ça porte sur des factures en
 *     retard et des chantiers à facturer.
 *
 * LE REPLI EST DÉLIBÉRÉ. Tant que les migrations 0072 et 0073 ne sont
 * pas passées, `ai_oasis_daily` n'existe pas en base. Plutôt qu'un
 * écran vide, on retombe sur `ai_get_daily_priorities`, qui est en
 * production depuis 0058 : les sept listes s'affichent, et le briefing
 * dit franchement qu'il n'a pas pu être établi. Un écran dégradé qui se
 * nomme vaut mieux qu'un écran mort.
 */
export async function getOasisDaily(organizationId: string): Promise<OasisDailyResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_oasis_daily", {
    p_organization_id: organizationId,
  });

  if (error || !data) {
    if (error) console.error("Oasis Daily :", error.message);
    const priorities = await getDailyPriorities(organizationId);
    return {
      briefing: {
        ...EMPTY_BRIEFING,
        failed: true,
        failureReason: friendlyBriefingError(error?.message),
      },
      priorities,
    };
  }

  const payload = data as Record<string, unknown>;
  const sources = (payload.sources ?? {}) as Record<string, unknown>;

  return {
    briefing: {
      date: readText(payload.date),
      salutation: readText(payload.salutation) ?? "Bonjour",
      droitsManquants: readStringArray(payload.droitsManquants),
      rubriques: readRubriques(payload.rubriques),
      confiance: readConfidence(payload.confiance),
      note: readText(payload.note),
      failed: false,
      failureReason: null,
    },
    priorities: { ...EMPTY, ...((sources.prioritesDuJour ?? {}) as Partial<DailyPriorities>) },
  };
}

function readRubriques(value: unknown): DailyRubrique[] {
  if (!Array.isArray(value)) return [];
  const rubriques: DailyRubrique[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const titre = readText(row.titre);
    if (!titre) continue;

    const elements: BriefItem[] = [];
    if (Array.isArray(row.elements)) {
      for (const element of row.elements) {
        const item = readBriefItem(element);
        if (item) elements.push(item);
      }
    }
    // Une rubrique dont aucune ligne n'est lisible ne s'affiche pas :
    // un titre suivi de rien ressemble à un écran cassé.
    if (elements.length === 0) continue;

    rubriques.push({
      code: readText(row.code) ?? titre.toUpperCase(),
      titre,
      elements,
    });
  }
  return rubriques;
}

/**
 * Pourquoi le briefing n'a pas pu être établi, en français.
 *
 * « function public.ai_oasis_daily(uuid) does not exist » ne dit rien à
 * un chef d'entreprise, et surtout ne lui dit pas si c'est grave ni ce
 * qu'il peut faire.
 */
function friendlyBriefingError(message: string | undefined): string {
  if (!message) return "Le briefing n'a pas pu être établi.";
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return (
      "Les analyses d'Oasis ne sont pas encore installées sur cette base. " +
      "Les priorités du jour ci-dessous, elles, restent à jour."
    );
  }
  if (message.includes("droit") || message.includes("permission")) {
    return message;
  }
  return "Le briefing n'a pas pu être établi. Les priorités du jour ci-dessous restent à jour.";
}

/** Combien de recommandations le briefing porte, toutes rubriques confondues. */
export function briefingCount(briefing: OasisDaily): number {
  return briefing.rubriques.reduce((total, rubrique) => total + rubrique.elements.length, 0);
}

/** Combien de faits datés réclament un geste aujourd'hui. */
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
