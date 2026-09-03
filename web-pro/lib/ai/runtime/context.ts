import { createHash } from "node:crypto";
import { OasisAIToolRegistry, registreOutils, type OutilOasis } from "./tools.ts";
import type { CleAgentModele, IdentiteAppel, Permission } from "./types.ts";

/**
 * §11V — ÉTAPE 7 : `AgentContextBuilder` (spec p. 20-22).
 *
 * ══════════════════════════════════════════════════════════════════
 * « CHAQUE AGENT REÇOIT SEULEMENT LE CONTEXTE UTILE »
 * ══════════════════════════════════════════════════════════════════
 *
 * Finance reçoit revenus, factures, règlements, dépenses, objectifs.
 * Pas des photos de plantes. La spec p. 20 le dit en une ligne ; ce
 * fichier en fait une propriété du code.
 *
 * ─── LA MINIMISATION EST UNE RÈGLE DE SÉCURITÉ, PAS UNE OPTIMISATION ───
 *
 * On lit parfois la minimisation comme une affaire de coût : moins de
 * contexte, moins de jetons, moins cher. C'est vrai, et c'est
 * accessoire. Ce qui compte est que TOUT CE QUI ENTRE DANS LE CONTEXTE
 * SORT DE L'ENTREPRISE : il part chez un fournisseur tiers, il peut
 * atterrir dans une trace, et il peut ressortir dans une réponse
 * adressée à quelqu'un qui n'avait pas le droit de le lire.
 *
 * Trois conséquences, toutes appliquées ici :
 *
 *   1. UN PLAN PAR AGENT, FERMÉ. `PLANS` dit, agent par agent, quelles
 *      sources sont lues. Il n'y a aucun chemin « lire n'importe
 *      quoi » : le plan nomme des OUTILS du registre, et le registre
 *      seul connaît les noms de fonctions.
 *
 *   2. JAMAIS TOUTE LA BASE (p. 20). Aucune source du plan ne rend
 *      « tous les clients », « toutes les photos », « tous les
 *      documents ». `getClientContext` prend UN client ; il n'existe
 *      aucun `listAllCustomers`. Le retrieval est ciblé, et la cible
 *      vient de l'appelant, pas du modèle.
 *
 *   3. UN ÉLAGAGE À LA SORTIE. Même une source légitime peut ramener
 *      un champ qui n'a rien à faire chez un tiers — une note interne,
 *      une pièce jointe, une URL signée. `elaguer` les retire par nom
 *      de clé, borne les tableaux et coupe les textes trop longs. Ce
 *      n'est pas une seconde barrière contre un attaquant : c'est une
 *      barrière contre nous-mêmes, le jour où quelqu'un ajoutera une
 *      colonne `photo_url` à une fonction existante.
 *
 * ─── CE QUE LE CONTEXTE PORTE TOUJOURS (p. 21-22) ───
 *
 *   organizationId · workspaceId · userId · permissions
 *
 * Les quatre, obligatoires, non nullables. Ils ne sont pas là pour
 * décorer : `permissionsManquantes` en découle, et une source dont la
 * permission manque N'EST PAS APPELÉE — on ne tente pas, on nomme le
 * droit qui manque. Un agent qui interroge malgré tout obtiendrait un
 * refus RLS, c'est-à-dire une vue partielle, c'est-à-dire une réponse
 * fausse plutôt qu'incomplète.
 */

// ==================================================================
// 1. Ce que l'appelant demande
// ==================================================================

/**
 * La cible du retrieval.
 *
 * ELLE VIENT DE L'APPELANT, jamais du modèle : c'est l'écran qui sait
 * quel devis est ouvert. Un identifiant choisi par le modèle serait un
 * identifiant deviné, et `ai_quote_price_analysis` relirait
 * l'organisation d'un devis qui n'est pas le bon.
 */
export type CibleContexte = {
  quoteId?: string | null;
  projectId?: string | null;
  customerId?: string | null;
  gardenId?: string | null;
  /** Bornes de période, AAAA-MM-JJ. `null` = les défauts de 0073. */
  du?: string | null;
  au?: string | null;
};

export type DemandeContexte = {
  agent: CleAgentModele;
  identite: IdentiteAppel;
  cible?: CibleContexte;
  /**
   * Restreindre encore le plan à ces outils. Utile quand une question
   * n'a besoin que d'une source : payer la lecture des cinq autres,
   * puis les envoyer au modèle, serait exactement l'inverse du sujet.
   */
  sourcesDemandees?: readonly string[];
};

// ==================================================================
// 2. Ce que le builder rend
// ==================================================================

export type SourceLue = {
  /** Le nom de l'outil du registre. */
  outil: string;
  /** La fonction Postgres réellement appelée. */
  rpc: string;
  /** `false` quand la lecture a échoué : la donnée est absente, pas vide. */
  ok: boolean;
  /** Le motif de l'échec, en français. */
  motif: string | null;
};

export type AgentContext = {
  agent: CleAgentModele;

  // Les quatre champs de la page 21-22, dans cet ordre.
  organizationId: string;
  workspaceId: string;
  userId: string;
  permissions: readonly Permission[];

  /**
   * Les données, élaguées, prêtes à partir. Une clé par outil lu.
   *
   * `Record<string, unknown>` et non un type par agent : la forme vient
   * du SQL de 0073, elle change avec lui, et la retyper ici créerait
   * une seconde vérité qui mentirait à la première migration suivante.
   */
  donnees: Record<string, unknown>;

  /** Ce qui a été lu, et ce qui a échoué. Pour `data_sources` (0072). */
  sources: readonly SourceLue[];

  /**
   * Les droits qui manquent pour compléter le plan de cet agent.
   *
   * NON VIDE NE VEUT PAS DIRE « ÉCHEC ». Un Finance Agent sans
   * `quotes.read` peut encore parler créances. Ce qu'il ne peut pas
   * faire, c'est se taire là-dessus : l'agent DOIT porter cette liste
   * dans sa réponse, comme `ai_finance_snapshot` porte déjà
   * `droitsManquants`.
   */
  permissionsManquantes: readonly Permission[];

  /**
   * Vrai quand AUCUNE source requise n'a pu être lue. L'agent ne doit
   * pas être appelé : payer un modèle pour raisonner sur rien produit
   * une réponse confiante et vide.
   */
  vide: boolean;

  /** Spec p. 21 : `dataSnapshotTimestamp`. ISO 8601. */
  dateArreteDonnees: string;

  /**
   * L'empreinte des données sources, telle que `ai_cache_lookup` (0076)
   * l'exige POUR LIRE. Elle couvre les données élaguées ET la liste des
   * sources : deux contextes qui n'ont pas lu les mêmes choses ne
   * partagent pas d'entrée de cache, même si le peu qu'ils ont lu
   * coïncide.
   */
  empreinte: string;

  /** La taille de ce qui partira, en caractères. Alimente `contextSize`. */
  tailleCaracteres: number;
};

// ==================================================================
// 3. LE PLAN — ce que chaque agent a le droit de recevoir
// ==================================================================

type EtapePlan = {
  /** Le nom d'un outil du registre. Le `rpc` en découle. */
  outil: string;
  /**
   * `true` : sans cette source, l'agent n'a rien à dire.
   * `false` : elle enrichit, son absence se mentionne.
   */
  requis: boolean;
  /** Les arguments, dérivés de la cible. `null` = étape non applicable. */
  arguments: (cible: CibleContexte) => Record<string, unknown> | null;
};

const PERIODE = (cible: CibleContexte) => ({
  p_from: cible.du ?? null,
  p_to: cible.au ?? null,
});

/**
 * LA TABLE DE LA PAGE 20, AGENT PAR AGENT.
 *
 * Elle est délibérément courte. Chaque ligne ajoutée est une donnée de
 * plus qui sort de l'entreprise à chaque appel ; la question à se poser
 * avant d'en ajouter une est « l'agent peut-il répondre sans ? », pas
 * « est-ce que ça pourrait servir ? ».
 *
 * Les dix agents que la spec p. 5 nomme sans que ce produit les
 * construise n'ont PAS de plan. Ce n'est pas un oubli : un plan pour un
 * agent inexistant est un plan que personne n'a relu.
 */
const PLANS: Partial<Record<CleAgentModele, readonly EtapePlan[]>> = {
  // p. 20 : « revenues, invoices, payments, expenses, targets ». Pas de
  // photos de plantes, pas de fiches clients, pas de jardins.
  finance: [
    { outil: "getCompanyMetrics", requis: true, arguments: PERIODE },
    { outil: "getMarginBreakdown", requis: false, arguments: PERIODE },
    { outil: "analyzeProjectMargin", requis: false, arguments: () => ({}) },
  ],

  billing: [{ outil: "getUnbilledProjects", requis: true, arguments: () => ({}) }],

  quotePricing: [
    // ─── LE PORTEFEUILLE, QUI NE DÉPEND D'AUCUNE CIBLE ───
    //
    // Sans lui, cet agent ne pouvait STRUCTURELLEMENT pas répondre dès
    // qu'aucun devis n'était désigné : `getQuote` était sa seule source
    // requise, ses arguments valaient `null` sans `quoteId`, le contexte
    // ressortait vide et le runner refusait avant d'appeler le modèle.
    // Or `/api/oasis-ai/brief` n'envoie aucune cible — le spécialiste
    // Devis rapportait donc « rien à dire » à CHAQUE brief, quelle que
    // soit la situation commerciale, et la Direction en concluait à
    // l'absence de sujet. Une panne silencieuse, et dans le sens
    // rassurant.
    //
    // `ai_get_daily_priorities` (0058, 0066) rend déjà « devis à
    // relancer » et « devis qui expirent ». C'est exactement le
    // portefeuille qu'il faut, il est déterministe, et il ne coûte
    // aucune fonction nouvelle.
    { outil: "getDailyPriorities", requis: true, arguments: () => ({}) },
    {
      // NON REQUIS, désormais. Un devis désigné rend l'analyse complète ;
      // sans lui, l'agent travaille sur son portefeuille. `sources` dit
      // laquelle des deux situations on est dans, et les instructions
      // le répètent au modèle.
      outil: "getQuote",
      requis: false,
      arguments: (cible) => (cible.quoteId ? { p_quote_id: cible.quoteId } : null),
    },
    {
      outil: "getHistoricalProjectComparisons",
      requis: false,
      arguments: (cible) => (cible.quoteId ? { p_quote_id: cible.quoteId } : null),
    },
    {
      // Les quantités mesurées sur le plan, SEULEMENT si un jardin est
      // désigné. Aucune photo n'en fait partie : la fonction rend des
      // surfaces et des comptes.
      outil: "getDigitalTwinQuantities",
      requis: false,
      arguments: (cible) => (cible.gardenId ? { p_garden_id: cible.gardenId } : null),
    },
  ],

  // p. 8 : l'Executive Agent « ne doit PAS récupérer toute la base
  // directement. Il utilise les résultats structurés des agents
  // spécialisés ». Son plan ne contient donc aucune source primaire.
  executive: [
    { outil: "getExecutiveBrief", requis: true, arguments: () => ({}) },
    { outil: "getDailyPriorities", requis: false, arguments: () => ({}) },
  ],
};

/** Les agents pour lesquels un contexte peut être construit aujourd'hui. */
export const AGENTS_AVEC_PLAN = Object.freeze(Object.keys(PLANS) as CleAgentModele[]);

// ==================================================================
// 4. L'ÉLAGAGE — la barrière contre nous-mêmes
// ==================================================================

/**
 * Les clés qui ne partent JAMAIS chez le fournisseur.
 *
 * La comparaison se fait sur le nom de clé mis en minuscules, par
 * inclusion : `photoUrl`, `photo_url`, `mainPhoto` et `photos` tombent
 * tous sur « photo ». C'est volontairement grossier — un faux positif
 * coûte une donnée manquante, un faux négatif coûte une photo de
 * chantier partie chez un tiers.
 */
export const CLES_INTERDITES: readonly string[] = Object.freeze([
  "photo",
  "image",
  "thumbnail",
  "vignette",
  "avatar",
  "document",
  "fichier",
  "attachment",
  "piecejointe",
  "piece_jointe",
  "signature",
  "base64",
  "storagepath",
  "storage_path",
  "signedurl",
  "signed_url",
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "iban",
  "bic",
  "rib",
]);

/** Au-delà, un texte n'est plus une donnée : c'est un document. */
export const LONGUEUR_TEXTE_MAX = 2_000;
/** Le plafond par défaut d'un tableau, quand l'outil n'en déclare pas. */
export const ELEMENTS_MAX_DEFAUT = 50;
/** La profondeur au-delà de laquelle on cesse de descendre. */
export const PROFONDEUR_MAX = 8;

function cleInterdite(cle: string): boolean {
  const normalisee = cle.toLowerCase();
  return CLES_INTERDITES.some((interdite) => normalisee.includes(interdite));
}

/**
 * Retirer ce qui ne doit pas partir, et borner le reste.
 *
 * Rend une valeur NOUVELLE : rien n'est modifié sur place, parce que la
 * valeur d'origine est celle qui a servi à l'audit, et la corrompre
 * ferait mentir le journal.
 */
export function elaguer(valeur: unknown, maxElements = ELEMENTS_MAX_DEFAUT, profondeur = 0): unknown {
  if (profondeur > PROFONDEUR_MAX) return "[profondeur maximale atteinte]";

  if (valeur === null || valeur === undefined) return null;

  if (typeof valeur === "string") {
    return valeur.length > LONGUEUR_TEXTE_MAX
      ? `${valeur.slice(0, LONGUEUR_TEXTE_MAX)}… [texte tronqué]`
      : valeur;
  }

  if (typeof valeur === "number" || typeof valeur === "boolean") return valeur;

  if (Array.isArray(valeur)) {
    const gardes = valeur
      .slice(0, maxElements)
      .map((element) => elaguer(element, maxElements, profondeur + 1));
    if (valeur.length > maxElements) {
      // On DIT combien on a coupé. Un tableau silencieusement tronqué
      // ferait conclure au modèle « il n'y a que 50 dossiers », et la
      // conclusion serait fausse d'une manière invérifiable.
      gardes.push(`[${valeur.length - maxElements} élément(s) non transmis]`);
    }
    return gardes;
  }

  if (typeof valeur === "object") {
    const sortie: Record<string, unknown> = {};
    for (const [cle, sousValeur] of Object.entries(valeur as Record<string, unknown>)) {
      if (cleInterdite(cle)) continue;
      sortie[cle] = elaguer(sousValeur, maxElements, profondeur + 1);
    }
    return sortie;
  }

  // Fonction, symbole, bigint : rien de tout cela ne vient d'un jsonb.
  return null;
}

// ==================================================================
// 5. L'EMPREINTE
// ==================================================================

/**
 * Une sérialisation STABLE : les clés triées, à toute profondeur.
 *
 * Sans le tri, deux lectures identiques de Postgres pourraient rendre
 * les mêmes clés dans un ordre différent et produire deux empreintes
 * différentes — le cache raterait toujours, sans que rien ne le
 * signale. C'est le genre de panne qui ne se voit que sur la facture.
 */
export function serialiserStable(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "null";
  if (typeof valeur !== "object") return JSON.stringify(valeur) ?? "null";
  if (Array.isArray(valeur)) return `[${valeur.map(serialiserStable).join(",")}]`;

  const entrees = Object.entries(valeur as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cle, v]) => `${JSON.stringify(cle)}:${serialiserStable(v)}`);
  return `{${entrees.join(",")}}`;
}

export function empreinteDe(donnees: unknown, sources: readonly string[]): string {
  return createHash("sha256")
    .update(serialiserStable({ sources: [...sources].sort(), donnees }))
    .digest("hex");
}

// ==================================================================
// 6. LE BUILDER
// ==================================================================

/**
 * Le port de lecture.
 *
 * Une seule opération : appeler une fonction Postgres nommée par le
 * registre, avec les arguments préparés ici. L'adaptateur réel est dans
 * `supabase.ts` ; les tests en fournissent un faux, et n'ouvrent donc
 * ni socket ni transaction.
 */
export type PortLectureSource = (appel: {
  rpc: string;
  arguments: Record<string, unknown>;
}) => Promise<{ ok: true; donnees: unknown } | { ok: false; message: string }>;

export type OptionsBuilder = {
  registre?: OasisAIToolRegistry;
  /** L'horloge. Injectable pour que la date d'arrêté soit vérifiable. */
  maintenant?: () => Date;
};

export class AgentContextBuilder {
  readonly #lire: PortLectureSource;
  readonly #registre: OasisAIToolRegistry;
  readonly #maintenant: () => Date;

  constructor(lire: PortLectureSource, options: OptionsBuilder = {}) {
    this.#lire = lire;
    this.#registre = options.registre ?? registreOutils();
    this.#maintenant = options.maintenant ?? (() => new Date());
  }

  /** Les étapes prévues pour un agent, avant tout filtre. */
  plan(agent: CleAgentModele): readonly EtapePlan[] {
    return PLANS[agent] ?? [];
  }

  async construire(demande: DemandeContexte): Promise<AgentContext> {
    const { agent, identite } = demande;
    const cible = demande.cible ?? {};

    // LA DATE D'ARRÊTÉ EST PRISE AVANT LA PREMIÈRE LECTURE, jamais
    // après. Une date posée à la fin daterait la réponse, pas les
    // données : entre les deux, un devis a pu être signé.
    const dateArreteDonnees = this.#maintenant().toISOString();

    const etapes = this.plan(agent).filter(
      (etape) =>
        demande.sourcesDemandees === undefined || demande.sourcesDemandees.includes(etape.outil),
    );

    const donnees: Record<string, unknown> = {};
    const sources: SourceLue[] = [];
    const manquantes = new Set<Permission>();
    let requisLu = 0;
    let requisTotal = 0;

    for (const etape of etapes) {
      const outil = this.#registre.chercher(etape.outil);
      if (outil === null || outil.rpc === undefined) {
        // Un plan qui nomme un outil absent du registre est une faute
        // de programmation, pas une donnée manquante. On le dit fort :
        // en silence, l'agent répondrait « je n'ai pas trouvé ».
        throw new Error(
          `Plan de l'agent « ${agent} » : l'outil « ${etape.outil} » n'existe pas dans le registre, ou n'est pas une lecture.`,
        );
      }

      if (etape.requis) requisTotal += 1;

      // ---- Le droit, AVANT l'appel ----------------------------------
      if (outil.permission !== null && !identite.permissions.includes(outil.permission)) {
        manquantes.add(outil.permission);
        sources.push({
          outil: outil.nom,
          rpc: outil.rpc,
          ok: false,
          motif: `Droit « ${outil.permission} » manquant : la source n'a pas été interrogée.`,
        });
        continue;
      }

      // ---- Les arguments --------------------------------------------
      const args = etape.arguments(cible);
      if (args === null) {
        sources.push({
          outil: outil.nom,
          rpc: outil.rpc,
          ok: false,
          motif: "Cible absente : cette source n'était pas applicable à la demande.",
        });
        continue;
      }

      // L'ORGANISATION EST POSÉE ICI, PAR LE SERVEUR. Elle n'est jamais
      // passée par l'appelant du modèle ni lue dans les arguments.
      const argumentsComplets = outil.injecteOrganisation
        ? { p_organization_id: identite.organizationId, ...args }
        : args;

      const resultat = await this.#lire({ rpc: outil.rpc, arguments: argumentsComplets });

      if (!resultat.ok) {
        sources.push({ outil: outil.nom, rpc: outil.rpc, ok: false, motif: resultat.message });
        continue;
      }

      donnees[outil.nom] = elaguer(resultat.donnees, outil.maxElements ?? ELEMENTS_MAX_DEFAUT);
      sources.push({ outil: outil.nom, rpc: outil.rpc, ok: true, motif: null });
      if (etape.requis) requisLu += 1;
    }

    const serialise = serialiserStable(donnees);

    return {
      agent,
      organizationId: identite.organizationId,
      workspaceId: identite.workspaceId,
      userId: identite.userId,
      permissions: identite.permissions,
      donnees,
      sources,
      permissionsManquantes: [...manquantes],
      // « Vide » = aucune source requise n'a répondu. Un agent sans
      // étape requise (cas qui n'existe pas aujourd'hui) n'est jamais
      // vide : on ne peut pas conclure à l'absence de ce qu'on n'a pas
      // demandé.
      vide: requisTotal > 0 && requisLu === 0,
      dateArreteDonnees,
      empreinte: empreinteDe(
        donnees,
        sources.map((s) => `${s.outil}:${s.ok ? "ok" : "ko"}`),
      ),
      tailleCaracteres: serialise.length,
    };
  }
}

/**
 * Les outils réellement offerts au modèle pour ce contexte.
 *
 * Deux minimisations, et elles sont jumelles : le contexte porte ce que
 * l'agent doit SAVOIR, ceci porte ce qu'il peut FAIRE. La seconde suit
 * les mêmes droits que la première.
 */
export function outilsPourContexte(
  contexte: AgentContext,
  registre: OasisAIToolRegistry = registreOutils(),
): readonly OutilOasis[] {
  return registre.pourAgent(contexte.agent, contexte.permissions);
}
