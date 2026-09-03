import type { SourceEnvironnement } from "./configuration.ts";
import { lireCleOpenAI } from "./credentials.ts";
import { VARIABLES_ENVIRONNEMENT_MODELE, routeurModeles, type AIModelRouter } from "./router.ts";
import { NIVEAUX_MODELE, type NiveauModele } from "./types.ts";

/**
 * §11V — LE CONTRÔLE DE DISPONIBILITÉ DES MODÈLES.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le dépôt appelle « gpt-5.6 » tout court à quinze endroits. La famille
 * existe donc. Les trois déclinaisons que la spec p. 2 nomme —
 * `-sol`, `-terra`, `-luna` — N'ONT PAS PU ÊTRE VÉRIFIÉES contre l'API
 * au moment d'écrire ce socle.
 *
 * Sans ce fichier, un nom faux se découvrirait de la pire des façons :
 * une décision de facturation lancée un matin, une erreur 404 renvoyée
 * par l'API au milieu d'un appel d'agent, et un message d'erreur qui ne
 * dit pas que le problème est un nom de modèle. Avec ce fichier, un
 * écran d'administration l'annonce à froid, avec la variable
 * d'environnement à poser pour corriger.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS ÉTATS, ET LE TROISIÈME EST LE PLUS IMPORTANT
 * ══════════════════════════════════════════════════════════════════
 *
 *   disponible      L'API connaît cet identifiant. Constat positif.
 *
 *   introuvable     L'API répond 404. C'est un CONSTAT, pas une panne :
 *                   le nom est faux, ou le compte n'a pas accès à ce
 *                   modèle. Il faut agir.
 *
 *   non_verifiable  On ne SAIT PAS. Pas de clé, réseau coupé, quota
 *                   dépassé, clé refusée. Ce n'est ni un oui ni un non.
 *
 * Confondre « introuvable » et « non vérifiable » serait la seule vraie
 * façon de rater la cible. Un écran qui afficherait « modèle
 * indisponible » parce que la clé manque enverrait quelqu'un corriger
 * un nom de modèle parfaitement correct.
 *
 * ══════════════════════════════════════════════════════════════════
 * CETTE FONCTION NE LÈVE JAMAIS
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucune exception ne sort d'ici — ni sur clé absente, ni sur réseau
 * mort, ni sur réponse illisible. Un diagnostic qui tombe en panne
 * n'est pas un diagnostic. Chaque échec devient un état
 * `non_verifiable` accompagné de sa raison en français.
 *
 * Et jamais la clé n'apparaît dans un `detail` : les messages sont
 * construits ici, à partir du code HTTP et du nom de l'erreur, jamais
 * par recopie d'un corps de réponse.
 */

/** Ce qu'on peut dire d'un identifiant de modèle. */
export type EtatModele = "disponible" | "introuvable" | "non_verifiable";

export type VerificationModele = {
  niveau: NiveauModele;
  /** L'identifiant testé, tel que le routeur le rendrait. */
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
  /** Vrai seulement si les trois identifiants sont confirmés. */
  tousDisponibles: boolean;
  /** Vrai si au moins un identifiant est formellement introuvable. */
  auMoinsUnIntrouvable: boolean;
  /** Vrai si au moins un identifiant n'a pas pu être vérifié. */
  auMoinsUnNonVerifiable: boolean;
  /** Un résultat par niveau, dans l'ordre economy → advanced. */
  modeles: VerificationModele[];
};

export type OptionsVerification = {
  /** Le routeur à interroger. Par défaut celui du processus. */
  routeur?: AIModelRouter;
  /** L'environnement où lire la clé. Par défaut `process.env`. */
  env?: SourceEnvironnement;
  /** Une clé explicite, qui court-circuite l'environnement. */
  cle?: string;
  /** La base de l'API. Par défaut l'API publique d'OpenAI. */
  baseURL?: string;
  /** Le `fetch` à utiliser. Injectable pour les tests. */
  fetchImpl?: typeof fetch;
  /** Le délai au-delà duquel on renonce, en millisecondes. */
  timeoutMs?: number;
};

const BASE_API_PAR_DEFAUT = "https://api.openai.com/v1";

/**
 * Six secondes. Assez pour une API qui répond normalement, assez peu
 * pour qu'un écran d'administration ne reste pas bloqué : trois modèles
 * interrogés en parallèle, donc six secondes au pire, pas dix-huit.
 */
const TIMEOUT_PAR_DEFAUT_MS = 6_000;

/**
 * La variable d'environnement qui corrige l'identifiant d'un niveau.
 *
 * Empruntée au routeur, pas recopiée : deux listes de noms de variables
 * qui divergent, c'est un écran qui conseille de poser une variable que
 * plus personne ne lit.
 */
const VARIABLES_CORRECTION = VARIABLES_ENVIRONNEMENT_MODELE;

/**
 * Interroge l'API pour dire si les trois identifiants configurés
 * existent réellement.
 *
 * Les trois requêtes partent ensemble : elles sont indépendantes, et un
 * écran d'administration ne doit pas attendre trois allers-retours en
 * file.
 */
export async function verifierDisponibiliteModeles(
  options: OptionsVerification = {},
): Promise<RapportDisponibilite> {
  const routeur = options.routeur ?? routeurModeles();
  const env = options.env ?? process.env;
  const cle = options.cle ?? lireCleOpenAI(env);
  const verifieLe = new Date().toISOString();

  const modelesParNiveau = NIVEAUX_MODELE.map((niveau) => ({
    niveau,
    modele: routeur.modelePourNiveau(niveau),
  }));

  if (cle === undefined) {
    // Le cas le plus fréquent en développement, et il ne doit surtout
    // pas ressembler à une panne.
    return assembler(
      verifieLe,
      false,
      modelesParNiveau.map(({ niveau, modele }) => ({
        niveau,
        modele,
        etat: "non_verifiable" as const,
        detail:
          "Aucune clé OpenAI côté serveur : l'existence de cet identifiant n'a pas pu être vérifiée.",
        statutHttp: null,
        variableDeCorrection: VARIABLES_CORRECTION[niveau],
      })),
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseURL = (options.baseURL ?? BASE_API_PAR_DEFAUT).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_PAR_DEFAUT_MS;

  const modeles = await Promise.all(
    modelesParNiveau.map(({ niveau, modele }) =>
      verifierUnModele(niveau, modele, { fetchImpl, baseURL, cle, timeoutMs }),
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

async function verifierUnModele(
  niveau: NiveauModele,
  modele: string,
  contexte: ContexteRequete,
): Promise<VerificationModele> {
  const base = {
    niveau,
    modele,
    variableDeCorrection: VARIABLES_CORRECTION[niveau],
  };

  let reponse: Response;
  try {
    reponse = await contexte.fetchImpl(
      `${contexte.baseURL}/models/${encodeURIComponent(modele)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${contexte.cle}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(contexte.timeoutMs),
      },
    );
  } catch (erreur) {
    // Réseau, DNS, délai dépassé, `fetch` absent : on ne sait pas, et
    // c'est tout ce qu'on a le droit de dire.
    return {
      ...base,
      etat: "non_verifiable",
      detail: `L'API n'a pas répondu (${nommerErreur(erreur)}) : l'existence de cet identifiant n'a pas pu être vérifiée.`,
      statutHttp: null,
    };
  }

  const statutHttp = reponse.status;

  if (reponse.ok) {
    return {
      ...base,
      etat: "disponible",
      detail: "L'API confirme cet identifiant.",
      statutHttp,
    };
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
      detail: `La clé serveur a été refusée (${statutHttp}) : l'existence de cet identifiant n'a pas pu être vérifiée.`,
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

/**
 * Le NOM d'une erreur, jamais son contenu.
 *
 * Un corps de réponse ou un message d'exception peut contenir l'URL
 * appelée, un en-tête, parfois davantage. Ce diagnostic finit à l'écran
 * et dans un journal : il n'emporte que la catégorie.
 */
function nommerErreur(erreur: unknown): string {
  if (erreur instanceof DOMException && erreur.name === "TimeoutError") return "délai dépassé";
  if (erreur instanceof Error && erreur.name === "AbortError") return "requête interrompue";
  if (erreur instanceof Error && erreur.name.length > 0) return erreur.name;
  return "erreur inconnue";
}
