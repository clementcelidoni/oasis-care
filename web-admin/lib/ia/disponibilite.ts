import { NIVEAUX, VARIABLES_MODELE, type EtatRouteur, type Niveau } from "./modeles.ts";

/**
 * ==================================================================
 * LE CONTRÔLE DE DISPONIBILITÉ — ET POURQUOI SA PLACE EST ICI
 * ==================================================================
 *
 * C'est dans le Control Center, et nulle part ailleurs, qu'on doit
 * apprendre qu'un identifiant de modèle est faux. Le dépôt appelle
 * « gpt-5.6 » à quinze endroits ; les trois déclinaisons `-luna`,
 * `-terra`, `-sol` n'ont jamais été confrontées à l'API.
 *
 * Sans ce contrôle, un nom faux se découvre de la pire façon : une
 * décision de facturation lancée un matin, un 404 au milieu d'un appel
 * d'agent, et un message d'erreur qui ne dit pas que le problème est un
 * nom de modèle.
 *
 * ------------------------------------------------------------------
 * IL NE PART PAS TOUT SEUL, ET C'EST UN CHANGEMENT
 * ------------------------------------------------------------------
 * L'écran d'Oasis Care Pro lançait ces trois requêtes À CHAQUE
 * AFFICHAGE, sur la clé de l'éditeur, depuis une page cliente. Ici la
 * même page sera ouverte par plusieurs administrateurs, plusieurs fois
 * par jour : le déclenchement est donc EXPLICITE — un bouton, un
 * paramètre d'URL — et la page se charge sans rien appeler.
 *
 * Ce n'est pas de l'économie de bouts de chandelle. Un diagnostic qui
 * part tout seul finit par ne plus être lu, et il coûte au moment
 * précis où l'on regarde l'écran parce que quelque chose ne va pas.
 *
 * ------------------------------------------------------------------
 * TROIS ÉTATS, ET LE TROISIÈME EST LE PLUS IMPORTANT
 * ------------------------------------------------------------------
 *   disponible      L'API connaît cet identifiant. Constat positif.
 *   introuvable     L'API répond 404. C'est un CONSTAT, pas une panne :
 *                   le nom est faux, ou ce compte n'a pas accès au
 *                   modèle. Il faut agir.
 *   non_verifiable  On ne SAIT PAS : pas de clé, réseau coupé, quota
 *                   dépassé, clé refusée. Ni un oui ni un non.
 *
 * Confondre « introuvable » et « non vérifiable » serait la seule vraie
 * façon de rater la cible : un écran qui afficherait « modèle
 * indisponible » parce que la clé manque enverrait quelqu'un corriger
 * un nom parfaitement correct. C'est le même refus que celui qui
 * gouverne tout le reste de cette application — un inconnu ne se
 * déguise pas en zéro, ni en non.
 *
 * ------------------------------------------------------------------
 * CETTE FONCTION NE LÈVE JAMAIS, ET NE MONTRE JAMAIS LA CLÉ
 * ------------------------------------------------------------------
 * Aucune exception n'en sort : un diagnostic qui tombe en panne n'est
 * pas un diagnostic. Et aucun `detail` n'est construit par recopie d'un
 * corps de réponse — seulement à partir du code HTTP et du NOM de
 * l'erreur. Un corps de réponse peut contenir l'URL appelée, un
 * en-tête, parfois davantage ; ce texte finit à l'écran.
 */

export type EtatModele = "disponible" | "introuvable" | "non_verifiable";

export type VerificationModele = {
  niveau: Niveau;
  /** L'identifiant testé, tel que ce serveur le résoudrait. */
  modele: string;
  etat: EtatModele;
  /** Une phrase française, affichable telle quelle. */
  detail: string;
  /** Le code HTTP obtenu, ou `null` si la requête n'a pas abouti. */
  statutHttp: number | null;
  /** La variable d'environnement qui corrigerait ce niveau. */
  variableDeCorrection: string;
};

export type RapportDisponibilite = {
  /** Quand la vérification a eu lieu, en ISO 8601. */
  verifieLe: string;
  /** Vrai si une clé serveur était disponible pour interroger l'API. */
  cleConfiguree: boolean;
  tousDisponibles: boolean;
  auMoinsUnIntrouvable: boolean;
  auMoinsUnNonVerifiable: boolean;
  /** Un résultat par niveau, dans l'ordre economy → advanced. */
  modeles: VerificationModele[];
};

/**
 * Le nom de la variable qui porte la clé.
 *
 * Volontairement le nom standard du SDK OpenAI, et SANS préfixe
 * `NEXT_PUBLIC_` : c'est ce détail, et lui seul, qui empêche Next.js de
 * recopier le secret dans le paquet JavaScript envoyé au navigateur.
 *
 * LE CONTROL CENTER A SA PROPRE CLÉ, ou n'en a pas. Il n'y a aucun
 * moyen de lire celle d'Oasis Care Pro d'ici, et il ne faut pas en
 * chercher un : deux applications, deux environnements. Sans clé, les
 * trois niveaux ressortent « non vérifiable » — jamais « introuvable ».
 */
export const VARIABLE_CLE_OPENAI = "OPENAI_API_KEY";

export function lireCleOpenAI(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const brut = env[VARIABLE_CLE_OPENAI];
  if (typeof brut !== "string") return undefined;
  const valeur = brut.trim();
  return valeur.length > 0 ? valeur : undefined;
}

const BASE_API_PAR_DEFAUT = "https://api.openai.com/v1";

/**
 * Six secondes. Assez pour une API qui répond normalement, assez peu
 * pour qu'un écran d'administration ne reste pas bloqué : trois modèles
 * interrogés EN PARALLÈLE, donc six secondes au pire, pas dix-huit.
 */
const TIMEOUT_PAR_DEFAUT_MS = 6_000;

export type OptionsVerification = {
  env?: Readonly<Record<string, string | undefined>>;
  cle?: string;
  baseURL?: string;
  /** Injectable pour les tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function verifierDisponibilite(
  etat: EtatRouteur,
  options: OptionsVerification = {},
): Promise<RapportDisponibilite> {
  const env = options.env ?? process.env;
  const cle = options.cle ?? lireCleOpenAI(env);
  const verifieLe = new Date().toISOString();

  const aTester = NIVEAUX.map((niveau) => ({ niveau, modele: etat.modeles[niveau] }));

  if (cle === undefined) {
    return assembler(
      verifieLe,
      false,
      aTester.map(({ niveau, modele }) => ({
        niveau,
        modele,
        etat: "non_verifiable" as const,
        detail:
          "Aucune clé OpenAI dans l'environnement du Control Center : l'existence de cet identifiant n'a pas pu être vérifiée.",
        statutHttp: null,
        variableDeCorrection: VARIABLES_MODELE[niveau],
      })),
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseURL = (options.baseURL ?? BASE_API_PAR_DEFAUT).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_PAR_DEFAUT_MS;

  const modeles = await Promise.all(
    aTester.map(({ niveau, modele }) =>
      verifierUn(niveau, modele, { fetchImpl, baseURL, cle, timeoutMs }),
    ),
  );

  return assembler(verifieLe, true, modeles);
}

function assembler(
  verifieLe: string,
  cleConfiguree: boolean,
  modeles: VerificationModele[],
): RapportDisponibilite {
  return {
    verifieLe,
    cleConfiguree,
    tousDisponibles: modeles.every((m) => m.etat === "disponible"),
    auMoinsUnIntrouvable: modeles.some((m) => m.etat === "introuvable"),
    auMoinsUnNonVerifiable: modeles.some((m) => m.etat === "non_verifiable"),
    modeles,
  };
}

type ContexteRequete = {
  fetchImpl: typeof fetch;
  baseURL: string;
  cle: string;
  timeoutMs: number;
};

async function verifierUn(
  niveau: Niveau,
  modele: string,
  contexte: ContexteRequete,
): Promise<VerificationModele> {
  const base = { niveau, modele, variableDeCorrection: VARIABLES_MODELE[niveau] };

  let reponse: Response;
  try {
    reponse = await contexte.fetchImpl(
      `${contexte.baseURL}/models/${encodeURIComponent(modele)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${contexte.cle}`, Accept: "application/json" },
        signal: AbortSignal.timeout(contexte.timeoutMs),
      },
    );
  } catch (erreur) {
    return {
      ...base,
      etat: "non_verifiable",
      detail: `L'API n'a pas répondu (${nommerErreur(erreur)}) : l'existence de cet identifiant n'a pas pu être vérifiée.`,
      statutHttp: null,
    };
  }

  const statutHttp = reponse.status;

  if (reponse.ok) {
    return { ...base, etat: "disponible", detail: "L'API confirme cet identifiant.", statutHttp };
  }

  if (statutHttp === 404) {
    return {
      ...base,
      etat: "introuvable",
      detail: `L'API ne connaît pas « ${modele} » (404). Corrigez-le avec la variable ${base.variableDeCorrection}, ou vérifiez que ce compte a accès à ce modèle.`,
      statutHttp,
    };
  }

  if (statutHttp === 401 || statutHttp === 403) {
    return {
      ...base,
      etat: "non_verifiable",
      detail: `La clé du Control Center a été refusée (${statutHttp}) : l'existence de cet identifiant n'a pas pu être vérifiée.`,
      statutHttp,
    };
  }

  if (statutHttp === 429) {
    return {
      ...base,
      etat: "non_verifiable",
      detail:
        "Quota ou cadence dépassés (429) : l'existence de cet identifiant n'a pas pu être vérifiée.",
      statutHttp,
    };
  }

  return {
    ...base,
    etat: "non_verifiable",
    detail: `L'API a répondu ${statutHttp} : l'existence de cet identifiant n'a pas pu être vérifiée.`,
    statutHttp,
  };
}

/** Le NOM d'une erreur, jamais son contenu. */
function nommerErreur(erreur: unknown): string {
  if (erreur instanceof DOMException && erreur.name === "TimeoutError") return "délai dépassé";
  if (erreur instanceof Error && erreur.name === "AbortError") return "requête interrompue";
  if (erreur instanceof Error && erreur.name.length > 0) return erreur.name;
  return "erreur inconnue";
}
