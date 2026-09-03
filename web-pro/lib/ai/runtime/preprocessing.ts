import { SEUIL_CONTEXTE_STANDARD_CARACTERES } from "../model/router.ts";
import { empreinteDe, serialiserStable, type AgentContext } from "./context.ts";
import { sommerCouts } from "./cost.ts";
import { OasisAgentRunner, type Executeur } from "./run.ts";
import {
  type Confiance,
  type IdentiteAppel,
  type SortieModele,
} from "./types.ts";

/**
 * §11V — ÉTAPE 13 : LUNA POUR LA CLASSIFICATION ET LE PRÉ-TRAITEMENT
 * (spec p. 3, p. 29).
 *
 *     1000 CRM activities ↓ classification ↓ GPT-5.6 Luna ↓
 *     structured categories
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER EMPÊCHE
 * ══════════════════════════════════════════════════════════════════
 *
 * Classer mille éléments est le seul travail du produit où le NOMBRE
 * d'appels compte plus que leur prix unitaire. Trois façons de s'y
 * ruiner, toutes évitées ici :
 *
 *   1. UN APPEL PAR ÉLÉMENT. Mille appels au lieu de dix. Le lot
 *      existe pour ça, et il est la raison d'être du fichier plus que
 *      la classification elle-même.
 *
 *   2. UN MODÈLE POUR CE QU'UNE RÈGLE SAIT FAIRE. Une activité dont le
 *      type est déjà `email` en base n'a pas besoin d'être classée par
 *      un modèle de langage. Les règles déterministes passent AVANT, et
 *      les éléments qu'elles traitent ne partent jamais chez le
 *      fournisseur — ni comme jetons, ni comme donnée.
 *
 *   3. UNE ESCALADE PAR ÉLÉMENT INCERTAIN. C'est le piège de la page 7
 *      appliqué à mille éléments : cent éléments douteux
 *      deviendraient cent appels au modèle avancé. Ici, les incertains
 *      sont REGROUPÉS et repassés en UN lot, une seule fois.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LA CLASSIFICATION N'EST PAS UN DES QUATRE AGENTS
 * ══════════════════════════════════════════════════════════════════
 *
 * `classification` figure dans la table de la page 5 au niveau
 * `economy`, et dans `AGENTS_MODELE`, mais pas dans
 * `ai_is_supported_agent` (0072) : elle ne prend aucune décision et
 * n'exécute aucune action. Elle COÛTE, en revanche, et
 * `ai_usage_events` accepte délibérément son nom — c'est la seule
 * table de la Phase 11V dont l'agent est libre, précisément pour que
 * cette dépense-là ne disparaisse pas du budget.
 */

/** L'agent, au sens du routeur et du journal. Jamais au sens de 0072. */
export const AGENT_CLASSIFICATION = "classification";

/**
 * Le PLAFOND D'ÉLÉMENTS par appel. Cent.
 *
 * Ni un — ce serait mille appels — ni mille : un échec au 998ᵉ élément
 * ferait tout recommencer. Cent est le compromis entre le nombre
 * d'appels et le coût d'un échec.
 *
 * Ce n'est PLUS la seule contrainte de découpe : voir
 * `BUDGET_CARACTERES_LOT`, qui est en pratique la contraignante.
 */
export const TAILLE_LOT = 100;

/**
 * LE BUDGET DE CARACTÈRES D'UN LOT, ET POURQUOI IL EST DÉRIVÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE SCÉNARIO CANONIQUE DE LA SPEC NE TOURNAIT PAS SUR LUNA
 * ══════════════════════════════════════════════════════════════════
 *
 * « 1000 CRM activities → classification → GPT-5.6 Luna » (p. 29).
 * L'agent `classification` est bien configuré `economy` (p. 5) — mais
 * `AIModelRouter` pose un PLANCHER ABSOLU de niveau au-delà de
 * `SEUIL_CONTEXTE_STANDARD_CARACTERES` caractères de contexte. Cent
 * notes d'activité réelles pèsent environ quinze mille caractères : le
 * plancher relevait donc CHAQUE lot sur `standard`, et le niveau
 * économique était inatteignable pour la seule charge de travail qui
 * l'exige. Rien ne le signalait — la taille de lot vivait ici, le seuil
 * vivait dans le routeur, et les deux ne se connaissaient pas.
 *
 * D'où cette constante DÉRIVÉE du seuil plutôt que posée en dur. Le
 * lien est maintenant écrit une seule fois : si quelqu'un déplace le
 * plancher du routeur, la découpe suit, et le scénario reste sur Luna.
 *
 * ─── POURQUOI DÉCOUPER PLUTÔT QU'EXEMPTER ───
 *
 * On aurait pu poser un « ignorer le plancher de taille » dans le
 * contexte de routage. Ce serait un contournement à la discrétion de
 * l'appelant — donc, à terme, un contournement invoqué partout. Le
 * plancher garde ici tout son sens : un ÉLÉMENT SEUL plus gros que le
 * budget part bien sur `standard`, et c'est juste — quinze mille
 * caractères de prose ne se classent pas comme cent lignes courtes. Ce
 * qu'on refuse, c'est de fabriquer artificiellement ce cas en empilant
 * cent éléments courts.
 *
 * Le comparateur du routeur est STRICT (« > seuil ») : un lot pesant
 * exactement ce budget reste donc économique.
 */
export const BUDGET_CARACTERES_LOT = SEUIL_CONTEXTE_STANDARD_CARACTERES;

export type ElementAClasser = {
  id: string;
  /** Le texte à classer, DÉJÀ élagué par l'appelant. */
  texte: string;
};

export type ClassementElement = {
  id: string;
  categorie: string;
  confiance: Confiance;
  /** `regle` quand aucun modèle n'a été appelé pour cet élément. */
  origine: "regle" | "modele";
};

/**
 * Une règle déterministe.
 *
 * Rend une catégorie, ou `null` quand elle ne sait pas. Elle ne rend
 * jamais « autre » par défaut : une règle qui répond toujours empêche
 * le modèle de servir, et range tout le corpus dans une catégorie
 * fourre-tout que personne ne relit.
 */
export type RegleClassement = (element: ElementAClasser) => string | null;

export type ResultatPreTraitement = {
  classements: readonly ClassementElement[];
  /** Combien d'éléments n'ont JAMAIS quitté le serveur. */
  parRegle: number;
  parModele: number;
  /** Combien d'éléments incertains ont été repassés en un second lot. */
  repasses: number;
  /** Combien d'éléments n'ont pas pu être classés du tout. */
  nonClasses: number;
  appelsModele: number;
  coutEstimeCents: number | null;
  avertissements: readonly string[];
};

/**
 * Ce que le modèle doit rendre pour un lot.
 *
 * `SortieModele.donnees` porte cette forme ; l'appelant (étape 9-12 ou
 * un écran) fournit l'`executer` qui la produit avec un schéma Zod et
 * les structured outputs de la page 13.
 */
export type SortieLot = {
  classements: { id: string; categorie: string; confiance?: string }[];
};

export type DemandePreTraitement = {
  identite: IdentiteAppel;
  elements: readonly ElementAClasser[];
  /** Les catégories admises. Fermées : un modèle libre en invente. */
  categories: readonly string[];
  /** Les règles qui passent avant le modèle. */
  regles?: readonly RegleClassement[];
  /** Classer un lot. Rend l'exécuteur que le runner appellera avec le modèle retenu. */
  executerLot: (lot: readonly ElementAClasser[], contexte: AgentContext) => Executeur;
  /** Pour rattacher la dépense à une décision (p. 18). */
  decisionId?: string | null;
};

export class ServicePreTraitement {
  readonly #runner: OasisAgentRunner;
  readonly #tailleLot: number;
  readonly #budgetCaracteres: number;

  constructor(
    runner: OasisAgentRunner,
    options: { tailleLot?: number; budgetCaracteres?: number } = {},
  ) {
    this.#runner = runner;
    this.#tailleLot = options.tailleLot ?? TAILLE_LOT;
    this.#budgetCaracteres = options.budgetCaracteres ?? BUDGET_CARACTERES_LOT;
  }

  /** La découpe réellement appliquée. Une seule règle, deux appelants. */
  #lots(elements: readonly ElementAClasser[]): ElementAClasser[][] {
    return decouperParBudget(elements, this.#budgetCaracteres, this.#tailleLot);
  }

  async classer(demande: DemandePreTraitement): Promise<ResultatPreTraitement> {
    const categoriesAdmises = new Set(demande.categories);
    const regles = demande.regles ?? [];
    const avertissements: string[] = [];
    const classements = new Map<string, ClassementElement>();
    const couts: (number | null)[] = [];
    let appelsModele = 0;

    // ---- 1. Les règles, AVANT le modèle -------------------------------
    const restants: ElementAClasser[] = [];
    for (const element of demande.elements) {
      let categorie: string | null = null;
      for (const regle of regles) {
        const trouvee = regle(element);
        if (trouvee !== null && categoriesAdmises.has(trouvee)) {
          categorie = trouvee;
          break;
        }
      }
      if (categorie === null) restants.push(element);
      else classements.set(element.id, { id: element.id, categorie, confiance: "high", origine: "regle" });
    }
    const parRegle = classements.size;

    // ---- 2. Le modèle économique, par lots ----------------------------
    const incertains: ElementAClasser[] = [];
    for (const lot of this.#lots(restants)) {
      const resultat = await this.#classerUnLot(demande, lot, categoriesAdmises, false);
      appelsModele += resultat.appels;
      couts.push(resultat.coutCents);
      avertissements.push(...resultat.avertissements);

      for (const element of lot) {
        const classement = resultat.parId.get(element.id);
        if (classement === undefined) continue;
        // UN ÉLÉMENT DOUTEUX N'EST PAS ESCALADÉ SEUL. Il rejoint la
        // file des incertains, qui repassera en un lot unique.
        if (classement.confiance === "low" || classement.confiance === "insufficient_data") {
          incertains.push(element);
          continue;
        }
        classements.set(element.id, classement);
      }
    }

    // ---- 3. UN SEUL repassage des incertains --------------------------
    //
    // Pas de boucle : ce qui reste douteux après deux lectures restera
    // douteux à la troisième, et la troisième coûterait le prix du
    // modèle avancé multiplié par le nombre d'éléments.
    let repasses = 0;
    if (incertains.length > 0) {
      repasses = incertains.length;
      for (const lot of this.#lots(incertains)) {
        const resultat = await this.#classerUnLot(demande, lot, categoriesAdmises, true);
        appelsModele += resultat.appels;
        couts.push(resultat.coutCents);
        avertissements.push(...resultat.avertissements);
        for (const [id, classement] of resultat.parId) classements.set(id, classement);
      }
    }

    const nonClasses = demande.elements.length - classements.size;
    if (nonClasses > 0) {
      // On le DIT. Un corpus partiellement classé présenté comme classé
      // ferait conclure « il n'y a que 940 activités ».
      avertissements.push(
        `${nonClasses} élément(s) n'ont pas pu être classés : ils sont absents du résultat, pas rangés ailleurs.`,
      );
    }

    return {
      classements: [...classements.values()],
      parRegle,
      parModele: classements.size - parRegle,
      repasses,
      nonClasses,
      appelsModele,
      coutEstimeCents: sommerCouts(couts),
      avertissements,
    };
  }

  async #classerUnLot(
    demande: DemandePreTraitement,
    lot: readonly ElementAClasser[],
    categoriesAdmises: ReadonlySet<string>,
    repassage: boolean,
  ): Promise<{
    parId: Map<string, ClassementElement>;
    appels: number;
    coutCents: number | null;
    avertissements: readonly string[];
  }> {
    const contexte = contexteDeLot(demande.identite, lot);

    const resultat = await this.#runner.executer({
      contexte,
      // Classer n'engage rien : un mauvais rangement se corrige d'un
      // clic. Le repli vers un modèle plus faible est donc acceptable
      // ici, contrairement à une analyse de devis.
      criticite: "ordinaire",
      routage: {
        // Le repassage annonce l'ambiguïté au routeur, qui monte alors
        // d'un cran — c'est la seule montée prévue de tout le
        // pré-traitement.
        complexity: repassage ? "complex" : "simple",
      },
      cache: null,
      decisionId: demande.decisionId ?? null,
      executer: demande.executerLot(lot, contexte),
    });

    const parId = new Map<string, ClassementElement>();
    if (!resultat.ok) {
      return {
        parId,
        appels: resultat.tentatives.length,
        coutCents: resultat.coutEstimeCents,
        avertissements: [
          `Lot de ${lot.length} élément(s) non classé : ${resultat.message}`,
          ...resultat.avertissements,
        ],
      };
    }

    for (const brut of lireClassements(resultat.sortie)) {
      // DEUX FILTRES, ET LES DEUX COMPTENT. Un identifiant que le lot
      // ne contenait pas est une hallucination ; une catégorie hors
      // liste en est une autre. Les accepter rangerait des éléments
      // inexistants dans des cases inventées.
      if (!lot.some((element) => element.id === brut.id)) continue;
      if (!categoriesAdmises.has(brut.categorie)) continue;
      parId.set(brut.id, { ...brut, origine: "modele" });
    }

    return {
      parId,
      // Une tentative, plus une par escalade. Le repli n'ajoute pas de
      // tour ici : il remplace la tentative en échec, déjà comptée
      // dans la branche `!ok`.
      appels: 1 + resultat.escalades.length,
      coutCents: resultat.coutEstimeCents,
      avertissements: resultat.avertissements,
    };
  }
}

// ==================================================================
// Aides
// ==================================================================

export function decouper<T>(elements: readonly T[], taille: number): T[][] {
  if (taille <= 0) throw new Error("Taille de lot invalide.");
  const lots: T[][] = [];
  for (let i = 0; i < elements.length; i += taille) lots.push(elements.slice(i, i + taille));
  return lots;
}

/**
 * Ce que pèse l'enveloppe d'un lot vide : `{"elements":[]}`.
 *
 * Mesurée, pas comptée à la main — `serialiserStable` est la SEULE
 * autorité sur la taille, puisque c'est elle qui produit
 * `AgentContext.tailleCaracteres`, donc `contextSize`, donc le niveau.
 */
const ENVELOPPE_LOT = serialiserStable({ elements: [] as unknown[] }).length;

/** Ce qu'un élément ajoute à la sérialisation du lot, virgule comprise. */
function poidsSerialise(element: ElementAClasser): number {
  return serialiserStable({ id: element.id, texte: element.texte }).length;
}

/**
 * Découper en respectant D'ABORD un budget de caractères, ENSUITE un
 * plafond d'éléments.
 *
 * Les deux bornes ont des raisons différentes et toutes deux valables :
 * le budget garde le lot sous le plancher de niveau du routeur (voir
 * `BUDGET_CARACTERES_LOT`), le plafond borne ce qu'un échec fait
 * recommencer. La plus contraignante des deux gagne, élément par
 * élément.
 *
 * UN ÉLÉMENT PLUS GROS QUE LE BUDGET PART SEUL, dans son propre lot, et
 * dépassera donc le plancher : c'est délibéré, et c'est la seule
 * réponse honnête — on ne peut pas rendre petit ce qui est gros, et
 * prétendre le contraire enverrait un mur de texte au modèle le moins
 * capable.
 */
export function decouperParBudget(
  elements: readonly ElementAClasser[],
  budgetCaracteres: number,
  tailleMax: number,
): ElementAClasser[][] {
  if (tailleMax <= 0) throw new Error("Taille de lot invalide.");
  if (budgetCaracteres <= 0) throw new Error("Budget de lot invalide.");

  const lots: ElementAClasser[][] = [];
  let courant: ElementAClasser[] = [];
  let poids = ENVELOPPE_LOT;

  for (const element of elements) {
    // La virgule de séparation n'existe qu'à partir du deuxième élément.
    const ajout = poidsSerialise(element) + (courant.length === 0 ? 0 : 1);
    const depasse = courant.length > 0 && poids + ajout > budgetCaracteres;
    const plein = courant.length >= tailleMax;

    if (depasse || plein) {
      lots.push(courant);
      courant = [];
      poids = ENVELOPPE_LOT;
      courant.push(element);
      poids += poidsSerialise(element);
      continue;
    }

    courant.push(element);
    poids += ajout;
  }

  if (courant.length > 0) lots.push(courant);
  return lots;
}

/**
 * Le contexte d'un lot.
 *
 * Il ne passe PAS par `AgentContextBuilder` : il n'y a aucune source à
 * lire, les éléments sont fournis par l'appelant. L'empreinte porte
 * donc sur le lot lui-même, ce qui rend le cache utilisable si un jour
 * on décide de mettre en cache une classification.
 */
export function contexteDeLot(
  identite: IdentiteAppel,
  lot: readonly ElementAClasser[],
): AgentContext {
  const donnees = { elements: lot.map((e) => ({ id: e.id, texte: e.texte })) };
  return {
    // `classification` n'est pas un agent de 0072 ; c'est une clé de la
    // table p. 5, et le routeur la connaît.
    agent: "classification",
    organizationId: identite.organizationId,
    workspaceId: identite.workspaceId,
    userId: identite.userId,
    permissions: identite.permissions,
    donnees,
    sources: [],
    permissionsManquantes: [],
    vide: lot.length === 0,
    dateArreteDonnees: new Date().toISOString(),
    empreinte: empreinteDe(donnees, ["lot"]),
    tailleCaracteres: serialiserStable(donnees).length,
  };
}

function lireClassements(sortie: SortieModele): { id: string; categorie: string; confiance: Confiance }[] {
  const donnees = sortie.donnees;
  if (typeof donnees !== "object" || donnees === null) return [];
  const brut = (donnees as { classements?: unknown }).classements;
  if (!Array.isArray(brut)) return [];

  const sortis: { id: string; categorie: string; confiance: Confiance }[] = [];
  for (const entree of brut) {
    if (typeof entree !== "object" || entree === null) continue;
    const r = entree as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const categorie = typeof r.categorie === "string" ? r.categorie : null;
    if (id === null || categorie === null) continue;
    sortis.push({
      id,
      categorie,
      // Le doute descend : une confiance absente vaut « données
      // insuffisantes », donc l'élément repassera.
      confiance:
        r.confiance === "high" || r.confiance === "medium" || r.confiance === "low"
          ? r.confiance
          : "insufficient_data",
    });
  }
  return sortis;
}
