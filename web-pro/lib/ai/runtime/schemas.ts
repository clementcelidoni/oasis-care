import { z } from "zod";
import { CONFIANCES, centimes, lireConfiance, nombreLisible, type Confiance } from "./types.ts";

/**
 * §11V — ÉTAPE 9-12 : LES SORTIES STRUCTURÉES (spec p. 13).
 *
 * ══════════════════════════════════════════════════════════════════
 * « NE PAS PARSER DU TEXTE LIBRE LORSQUE DES DONNÉES STRUCTURÉES SONT
 * NÉCESSAIRES » (p. 13)
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce fichier tient cette phrase. Un agent ne rend pas un paragraphe
 * dont on extrairait « 38 450 € » à coups d'expression régulière : il
 * rend un objet dont `montantCents` est un entier, et le seul code qui
 * lit ce montant est celui qui l'écrit en base.
 *
 * ─── TROIS RÈGLES QUI TRAVERSENT TOUT LE FICHIER ───
 *
 *   1. L'ARGENT EST EN CENTIMES ENTIERS, ET IL EST NULLABLE. « On ne
 *      sait pas chiffrer » et « ça ne vaut rien » sont deux phrases
 *      opposées ; `ai_decisions.financial_impact_cents` est nullable
 *      exactement pour cela (0072), et le schéma le suit. Aucun
 *      `?? 0` n'existe dans ce fichier.
 *
 *   2. AUCUNE BORNE DANS LE SCHÉMA, TOUTES LES BORNES À LA LECTURE.
 *      `z.array(...).max(5)` ne se traduit pas en JSON Schema strict :
 *      la borne disparaît côté modèle mais reste côté Zod, et une
 *      sixième recommandation ferait alors ÉCHOUER tout l'appel — on
 *      aurait payé un raisonnement complet pour recevoir une exception.
 *      Les bornes sont donc appliquées par `normaliser*`, qui coupe et
 *      le dit, comme `elaguer` le fait pour le contexte.
 *
 *   3. LES CLÉS FACULTATIVES SONT `.nullable()`, JAMAIS `.optional()`.
 *      Le mode strict des sorties structurées OpenAI exige que toutes
 *      les clés soient présentes ; une clé absente y est une erreur de
 *      schéma, pas un défaut. Même règle que `tools.ts`.
 *
 * ─── POURQUOI `priority` EST UN ENTIER DE 0 À 100 ───
 *
 * La spec p. 13 écrit `priority` sans dire son échelle. La base, elle,
 * l'a déjà tranchée : `ai_decisions.priority int check (between 0 and
 * 100)`. Un énuméré `low | medium | high` obligerait à une table de
 * conversion entre le modèle et la base — donc à un endroit où « high »
 * vaudrait 80 aujourd'hui et 90 demain, sans que rien ne casse et sans
 * que personne ne s'en aperçoive. On prend l'échelle de la base.
 */

// ==================================================================
// 1. Les vocabulaires fermés
// ==================================================================

/**
 * Les catégories de `ai_decisions` (0072), recopiées.
 *
 * `coherence.test.ts` échoue si elles divergent de `lib/ai/types.ts`.
 * On ne peut pas importer l'original : il tire `@/components/ui` pour
 * une histoire de couleurs.
 */
export const CATEGORIES_DECISION = [
  "urgent",
  "important",
  "opportunite",
  "optimisation",
  "information",
] as const;
export type CategorieDecision = (typeof CATEGORIES_DECISION)[number];

/** La provenance d'un chiffre (spec p. 17, « MARKET DATA »). */
export const ORIGINES_DONNEE = [
  "INTERNAL",
  "PUBLIC_VERIFIED",
  "PUBLIC_ESTIMATED",
  "AI_INFERENCE",
  "INSUFFICIENT_DATA",
] as const;
export type OrigineDonnee = (typeof ORIGINES_DONNEE)[number];

// ==================================================================
// 2. La proposition d'action — p. 13-14
// ==================================================================

/**
 * Ce que l'agent PROPOSE, et rien de plus.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE SCHÉMA N'EST JAMAIS ENVOYÉ AU MODÈLE, ET C'EST DÉLIBÉRÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Il valide ce que NOUS construisons à partir d'un APPEL D'OUTIL. La
 * proposition d'action n'emprunte pas la sortie structurée : elle
 * emprunte les outils des familles `proposition` et `moteur`, dont le
 * schéma de paramètres est déjà déclaré dans `tools.ts`, agent par
 * agent, avec sa permission et son risque.
 *
 * La raison est technique autant que conceptuelle. Technique : le mode
 * strict des sorties structurées OpenAI exige `additionalProperties:
 * false` partout, et un dictionnaire libre — ce que `parameters` est
 * forcément — ne peut pas s'y exprimer. Conceptuelle : un outil
 * déclaré est un contrat vérifié à l'appel ; un champ `parameters` dans
 * une sortie de texte serait un contrat que personne ne vérifie.
 *
 * ─── CE QUI N'EST PAS DANS CE SCHÉMA, ET POURQUOI ───
 *
 * Il n'y a ni `risque`, ni `permission`, ni `requiresConfirmation`, ni
 * `organizationId`. Les trois premiers viennent d'`ai_action_catalog`
 * (0072) et le quatrième de la session. Les laisser au modèle
 * reviendrait à lui laisser dire « cette facture de 20 000 € est un
 * risque faible et ne demande pas de confirmation » — et
 * `OasisActionEngine` le croirait.
 *
 * `montantCents` EST dans le schéma, et c'est différent : ce n'est pas
 * une appréciation, c'est un chiffre que les outils ont rendu et que le
 * modèle recopie. Le moteur s'en sert pour le plafond d'autopilote, et
 * `ai_may_autoexecute` refuse quand il manque sur une action qui engage
 * de l'argent (0072) — un montant omis ne vaut donc jamais zéro.
 */
export const PropositionActionSchema = z.object({
  actionType: z
    .string()
    .describe(
      "Le type d'action, tel qu'il figure au catalogue d'Oasis. N'invente jamais un type : " +
        "si l'action que tu voudrais proposer n'y est pas, dis-le en toutes lettres.",
    ),
  resume: z
    .string()
    .describe("Ce que l'action ferait, en une phrase, pour l'humain qui va cliquer."),
  parameters: z
    .record(z.string(), z.unknown())
    .describe("Les paramètres de l'action. Aucun identifiant inventé : ils viennent des outils."),
  cibleType: z
    .string()
    .nullable()
    .describe("Le type de l'entité visée (customer, project, quote, invoice…), ou null."),
  cibleId: z.string().nullable().describe("L'identifiant de l'entité visée (UUID), ou null."),
  montantCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "L'argent engagé, EN CENTIMES ENTIERS, tel qu'un outil l'a rendu. null quand aucun outil " +
        "ne l'a chiffré — jamais 0 pour « je ne sais pas ».",
    ),
});

export type PropositionAction = z.infer<typeof PropositionActionSchema>;

// ==================================================================
// 3. DecisionRecommendation — le type nommé par la spec p. 13
// ==================================================================

/**
 * `DecisionRecommendation { title, summary, priority, confidence,
 * estimatedImpact, reasons, suggestedAction }` (p. 13).
 *
 * Les sept champs y sont, dans cet ordre. `estimatedImpact` est le seul
 * qui se dédouble, et il le fait parce que la base le demande :
 * `ai_decisions` porte `estimated_impact text` (« 10 chantiers, 38 450 €
 * prêts à facturer ») ET `financial_impact_cents bigint` nullable. Un
 * champ unique obligerait à extraire le nombre de la phrase — c'est-à-dire
 * à parser du texte libre, ce que la page 13 interdit deux lignes plus
 * haut.
 */
export const DecisionRecommendationSchema = z.object({
  title: z.string().describe("Le titre, court, qui dit QUOI FAIRE. 200 caractères au plus."),
  summary: z.string().describe("Ce qu'il se passe et pourquoi ça compte, en deux ou trois phrases."),
  priority: z
    .number()
    .int()
    .describe("De 0 à 100. 100 = à traiter aujourd'hui. Une valeur hors bornes sera ramenée."),
  category: z.enum(CATEGORIES_DECISION).describe("urgent, important, opportunite, optimisation ou information."),
  confidence: z
    .enum(CONFIANCES)
    .describe(
      "high, medium, low ou insufficient_data. « insufficient_data » n'est PAS une confiance " +
        "faible : c'est l'absence de données. Dans ce cas, estimatedImpactCents DOIT être null.",
    ),
  estimatedImpact: z
    .string()
    .describe("L'impact en clair, tel qu'on l'affichera. Exemple : « 10 chantiers, 38 450 € HT à facturer »."),
  estimatedImpactCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "L'impact chiffré, EN CENTIMES ENTIERS, uniquement s'il vient d'un outil. null sinon. " +
        "Ne le déduis pas d'une phrase, ne l'arrondis pas, ne le convertis pas.",
    ),
  reasons: z
    .array(z.string())
    .describe("Pourquoi tu conclus cela. Une raison par élément, chacune vérifiable dans les données lues."),
  /**
   * Le POINTEUR vers l'action, pas l'action elle-même.
   *
   * C'est exactement ce que porte `ai_decisions.available_actions`
   * (0072) : un type et un libellé, dont `ai_open_decision` vérifie
   * qu'ils existent au catalogue. Les paramètres, eux, passent par
   * l'appel d'outil — voir `PropositionActionSchema` plus haut.
   */
  suggestedActionType: z
    .string()
    .nullable()
    .describe(
      "Le type d'action du catalogue qu'il faudrait déclencher, ou null. N'invente pas de type : " +
        "si tu veux réellement la déclencher, appelle l'outil correspondant.",
    ),
  suggestedActionLabel: z
    .string()
    .nullable()
    .describe("Le libellé du bouton à montrer, ou null."),
});

export type DecisionRecommendation = z.infer<typeof DecisionRecommendationSchema>;

// ==================================================================
// 4. La sortie d'un agent spécialisé
// ==================================================================

/**
 * Ce que Finance, Facturation et Devis & prix rendent.
 *
 * ─── `ambigu` EST DÉCLARÉ PAR L'AGENT, JAMAIS DEVINÉ ───
 *
 * C'est le second déclencheur d'escalade de la page 7 (« still
 * ambiguous »), et `escalation.ts` s'y fie. La plomberie ne peut pas
 * l'inférer d'un texte sans le parser — donc sans retomber dans ce que
 * la page 13 interdit. Il est ici, en booléen, et l'instruction de
 * chaque agent explique quand le lever.
 *
 * ─── `donneesManquantes` N'EST PAS DÉCORATIF ───
 *
 * `AgentContext.permissionsManquantes` dit quels DROITS manquent ; ceci
 * dit quelles DONNÉES manquent — un coût non saisi, un objectif de
 * marge jamais posé. Les deux se disent à l'utilisateur, et aucun ne se
 * remplace par un zéro.
 */
export const AnalyseAgentSchema = z.object({
  resume: z.string().describe("La réponse, en français, brève, orientée « quoi faire »."),
  confidence: z
    .enum(CONFIANCES)
    .describe("Ta confiance dans CETTE analyse, toutes recommandations confondues."),
  ambigu: z
    .boolean()
    .describe(
      "true seulement si la situation reste réellement ambiguë après avoir lu les outils — " +
        "deux lectures défendables des mêmes chiffres. Une donnée qui manque n'est pas une " +
        "ambiguïté : c'est insufficient_data.",
    ),
  recommandations: z
    .array(DecisionRecommendationSchema)
    .describe("Ce que tu recommandes. Vide quand il n'y a rien à recommander — n'invente pas."),
  donneesManquantes: z
    .array(z.string())
    .describe("Ce qui manquerait pour conclure, nommé précisément. Vide si rien ne manque."),
});

export type AnalyseAgent = z.infer<typeof AnalyseAgentSchema>;

// ==================================================================
// 5. La sortie de la Direction — p. 9 et 29
// ==================================================================

/**
 * « Top 5 décisions » (p. 9), à partir des sorties STRUCTURÉES des
 * spécialistes (p. 8).
 *
 * `agentsConsultes` n'est pas de la décoration : la page 8 interdit à
 * la Direction de lire la base elle-même, et ce champ est ce qui rend
 * la règle VÉRIFIABLE côté écran — chaque ligne du brief porte le nom
 * de l'agent qui l'a calculée, exactement comme `ai_executive_brief`
 * (0073) le fait déjà en SQL.
 */
export const SortieExecutiveSchema = z.object({
  resume: z.string().describe("Le brief, en trois phrases au plus."),
  confidence: z.enum(CONFIANCES),
  ambigu: z.boolean(),
  decisions: z
    .array(DecisionRecommendationSchema)
    .describe("Les décisions classées, la plus urgente d'abord. Cinq au plus."),
  agentsConsultes: z
    .array(z.string())
    .describe("Les agents spécialisés que tu as réellement interrogés pour ce brief."),
  donneesManquantes: z.array(z.string()),
});

export type SortieExecutive = z.infer<typeof SortieExecutiveSchema>;

// ==================================================================
// 6. LES BORNES, APPLIQUÉES À LA LECTURE
// ==================================================================

/** `ai_decisions.title` est borné à 200 par `ai_clean_text` (0069). */
export const LONGUEUR_TITRE_MAX = 200;
/** `ai_decisions.description` : 2 000, même fonction. */
export const LONGUEUR_RESUME_MAX = 2_000;
/** « Top 5 décisions » (p. 9). */
export const DECISIONS_EXECUTIVE_MAX = 5;
/** Au-delà, une liste de recommandations n'est plus une liste : c'est un rapport. */
export const RECOMMANDATIONS_MAX = 10;
/** Une raison qui dépasse ça est un paragraphe déguisé. */
export const RAISONS_MAX = 8;
export const LONGUEUR_RAISON_MAX = 400;

function couper(valeur: string, max: number): string {
  const propre = valeur.trim();
  return propre.length <= max ? propre : `${propre.slice(0, max - 1)}…`;
}

/**
 * La priorité, ramenée dans l'échelle de la base.
 *
 * On RAMÈNE plutôt qu'on refuse : une priorité à 140 est une erreur
 * d'échelle du modèle, pas une réponse fausse, et jeter l'analyse
 * entière pour cela coûterait un appel complet. Un nombre illisible,
 * lui, vaut 50 — le défaut de la colonne (0072).
 */
export function bornerPriorite(valeur: unknown): number {
  // `nombreLisible` et non `Number` : `Number(null)` vaut 0, et une
  // priorité absente tomberait alors au FOND du brief au lieu de
  // prendre le défaut de la colonne. Le tri de `normaliserBrief` en
  // aurait fait la dernière ligne — un enterrement silencieux.
  const n = nombreLisible(valeur);
  if (n === null) return 50;
  return Math.min(100, Math.max(0, Math.trunc(n)));
}

/** Ce qu'une normalisation a dû corriger. Remonte en avertissement. */
export type CorrectionSortie = string;

/** La profondeur au-delà de laquelle on cesse de chercher un montant. */
const PROFONDEUR_MONTANTS_MAX = 10;

/**
 * TOUS LES MONTANTS QUE LES DONNÉES LUES CONTIENNENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ANNUAIRE CONTRE LEQUEL ON VÉRIFIE CE QUE LE MODÈLE ANNONCE
 * ══════════════════════════════════════════════════════════════════
 *
 * Les fonctions SQL de 0058, 0073 et 0076 nomment leurs montants par
 * une convention constante : la clé finit par « cents »
 * (`impactCents`, `financial_impact_cents`, `caEncaisseTtcCents`…).
 * C'est cette convention qu'on suit, et rien d'autre : ramasser TOUS
 * les nombres ferait passer une quantité de plants pour un montant, et
 * l'annuaire ne vérifierait plus rien.
 *
 * On collecte AUSSI la valeur absolue : `ai_finance_margin_breakdown`
 * rend des écarts négatifs, et un modèle qui rapporte « 12 400 € de
 * marge perdue » là où la base écrit -1 240 000 dit la même chose.
 *
 * Le tableau est parcouru en ENTIER, sans plafond d'éléments : c'est un
 * annuaire de vérification, pas un contexte envoyé au modèle. Seule la
 * profondeur est bornée, contre un objet cyclique.
 */
export function montantsDansLesDonnees(valeur: unknown): Set<number> {
  const montants = new Set<number>();
  const vus = new Set<object>();

  const descendre = (v: unknown, cle: string | null, profondeur: number): void => {
    if (profondeur > PROFONDEUR_MONTANTS_MAX) return;

    if (typeof v === "number" || typeof v === "string") {
      if (cle === null) return;
      const normalisee = cle.toLowerCase().replace(/[^a-z]/g, "");
      if (!normalisee.endsWith("cents")) return;
      const montant = centimes(v);
      if (montant === null) return;
      montants.add(montant);
      montants.add(Math.abs(montant));
      return;
    }

    if (typeof v !== "object" || v === null) return;
    if (vus.has(v)) return;
    vus.add(v);

    if (Array.isArray(v)) {
      // Un élément de tableau hérite de la clé du tableau : `impactsCents:
      // [1200, 3400]` doit compter, et il existe.
      for (const element of v) descendre(element, cle, profondeur + 1);
      return;
    }

    for (const [k, sousValeur] of Object.entries(v as Record<string, unknown>)) {
      descendre(sousValeur, k, profondeur + 1);
    }
  };

  descendre(valeur, null, 0);
  return montants;
}

export type SortieNormalisee<T> = {
  valeur: T;
  corrections: readonly CorrectionSortie[];
};

/**
 * Une recommandation, ramenée à ce que la base accepte.
 *
 * ─── LE CAS QUI COMPTE : `insufficient_data` AVEC UN MONTANT ───
 *
 * `ai_decisions` porte une CONTRAINTE là-dessus (0072) : une conclusion
 * tirée de données insuffisantes ne peut pas porter de montant, parce
 * que le montant serait alors une estimation inventée (p. 2). Un modèle
 * qui produit les deux se ferait donc refuser son insertion.
 *
 * On DÉGRADE plutôt qu'on refuse, et le sens du choix compte : c'est le
 * MONTANT qu'on jette, jamais la confiance. Garder « 38 450 € » et
 * relever la confiance à « low » pour faire passer la ligne serait
 * exactement la fabrication que la contrainte interdit ; garder la
 * confiance et jeter le montant dit la vérité — « je ne sais pas
 * chiffrer » — et la correction est remontée en avertissement.
 */
export function normaliserRecommandation(
  brute: DecisionRecommendation,
  montantsConnus?: ReadonlySet<number>,
): SortieNormalisee<DecisionRecommendation> {
  const corrections: CorrectionSortie[] = [];

  const confidence: Confiance = lireConfiance(brute.confidence);

  let montant = centimes(brute.estimatedImpactCents);
  if (confidence === "insufficient_data" && montant !== null) {
    corrections.push(
      `« ${couper(brute.title, 60)} » annonçait des données insuffisantes ET un impact chiffré : ` +
        "le montant a été retiré, la confiance conservée.",
    );
    montant = null;
  }

  // ─── LA FRONTIÈRE DÉTERMINISTE, VÉRIFIÉE ET PAS SEULEMENT DEMANDÉE ──
  //
  // Page 11-12 : « ne pas utiliser GPT pour calculer marge, TVA, CA,
  // prix ». Jusqu'ici, la règle ne tenait que par une phrase
  // d'instruction (`CONSIGNE_FRONTIERE_DETERMINISTE`) — et le montant
  // affiché sur l'écran d'accueil, « 38 450 € à facturer », sortait du
  // modèle alors que la requête qui l'a produit était dans le même
  // objet, à portée de comparaison.
  //
  // Un montant qui ne figure pas TEL QUEL dans les données lues est
  // donc retiré. On jette le CHIFFRE, jamais la recommandation : le
  // texte `estimatedImpact` reste, la correction est remontée en
  // avertissement, et l'utilisateur garde une phrase honnête plutôt
  // qu'un nombre inventé.
  //
  // Conséquence assumée : une AGRÉGATION faite par le modèle — deux
  // lignes additionnées — est retirée elle aussi. C'est exactement ce
  // que la page 12 demande (« pas recalculer les données
  // fondamentales ») : si la somme compte, elle doit venir du SQL.
  if (montantsConnus !== undefined && montant !== null && !montantsConnus.has(montant)) {
    corrections.push(
      `« ${couper(brute.title, 60)} » annonçait un impact de ${montant} centimes introuvable dans ` +
        "les données lues : le montant a été retiré (il n'a pas été calculé par Oasis, mais par le modèle).",
    );
    montant = null;
  }

  const raisons = brute.reasons
    .filter((r) => typeof r === "string" && r.trim().length > 0)
    .map((r) => couper(r, LONGUEUR_RAISON_MAX));
  if (raisons.length > RAISONS_MAX) {
    corrections.push(
      `« ${couper(brute.title, 60)} » portait ${raisons.length} raisons : les ${RAISONS_MAX} premières ont été conservées.`,
    );
  }

  return {
    valeur: {
      title: couper(brute.title, LONGUEUR_TITRE_MAX),
      summary: couper(brute.summary, LONGUEUR_RESUME_MAX),
      priority: bornerPriorite(brute.priority),
      category: brute.category,
      confidence,
      estimatedImpact: couper(brute.estimatedImpact, LONGUEUR_RESUME_MAX),
      estimatedImpactCents: montant,
      reasons: raisons.slice(0, RAISONS_MAX),
      // UN LIBELLÉ SANS TYPE NE VAUT RIEN : il produirait un bouton qui
      // ne sait pas quoi déclencher. Les deux tombent ensemble.
      suggestedActionType: texteOuNull(brute.suggestedActionType, LONGUEUR_TITRE_MAX),
      suggestedActionLabel:
        texteOuNull(brute.suggestedActionType, LONGUEUR_TITRE_MAX) === null
          ? null
          : texteOuNull(brute.suggestedActionLabel, LONGUEUR_TITRE_MAX),
    },
    corrections,
  };
}

function texteOuNull(valeur: unknown, max: number): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre.length === 0 ? null : couper(propre, max);
}

/**
 * Une proposition d'action, relue.
 *
 * On ne vérifie PAS ici que `actionType` existe au catalogue : c'est le
 * travail d'`OasisActionEngine`, qui a la base sous la main. Ce qu'on
 * fait ici est plus modeste et strictement local — retirer une
 * proposition creuse (pas de type) plutôt que la laisser voyager
 * jusqu'à produire un « action inconnue » trois couches plus loin.
 */
export function normaliserProposition(
  brute: PropositionAction | null,
): PropositionAction | null {
  if (brute === null || typeof brute !== "object") return null;
  const type = typeof brute.actionType === "string" ? brute.actionType.trim() : "";
  if (type.length === 0) return null;

  return {
    actionType: type,
    resume: couper(brute.resume ?? "", LONGUEUR_TITRE_MAX),
    parameters:
      typeof brute.parameters === "object" && brute.parameters !== null && !Array.isArray(brute.parameters)
        ? brute.parameters
        : {},
    cibleType: typeof brute.cibleType === "string" && brute.cibleType.trim() ? brute.cibleType.trim() : null,
    cibleId: typeof brute.cibleId === "string" && brute.cibleId.trim() ? brute.cibleId.trim() : null,
    montantCents: centimes(brute.montantCents),
  };
}

/** L'analyse d'un spécialiste, bornée. */
export function normaliserAnalyse(
  brute: AnalyseAgent,
  montantsConnus?: ReadonlySet<number>,
): SortieNormalisee<AnalyseAgent> {
  const corrections: CorrectionSortie[] = [];
  const recommandations: DecisionRecommendation[] = [];

  for (const brut of brute.recommandations.slice(0, RECOMMANDATIONS_MAX)) {
    const { valeur, corrections: c } = normaliserRecommandation(brut, montantsConnus);
    recommandations.push(valeur);
    corrections.push(...c);
  }
  if (brute.recommandations.length > RECOMMANDATIONS_MAX) {
    corrections.push(
      `L'agent a rendu ${brute.recommandations.length} recommandations : les ${RECOMMANDATIONS_MAX} premières ont été conservées.`,
    );
  }

  return {
    valeur: {
      resume: couper(brute.resume, LONGUEUR_RESUME_MAX),
      confidence: lireConfiance(brute.confidence),
      ambigu: brute.ambigu === true,
      recommandations,
      donneesManquantes: brute.donneesManquantes
        .filter((d) => typeof d === "string" && d.trim().length > 0)
        .map((d) => couper(d, LONGUEUR_RAISON_MAX)),
    },
    corrections,
  };
}

/**
 * Le brief de la Direction, borné à cinq décisions.
 *
 * Le tri est fait ICI, sur `priority`, et pas laissé au modèle : « la
 * plus urgente d'abord » est une consigne qu'un modèle suit presque
 * toujours, et « presque » suffit à faire remonter une information
 * au-dessus d'une urgence un matin sur dix. Le tri est stable — deux
 * décisions de même priorité gardent l'ordre du modèle, qui a vu les
 * détails que le tri ignore.
 */
export function normaliserBrief(
  brute: SortieExecutive,
  montantsConnus?: ReadonlySet<number>,
): SortieNormalisee<SortieExecutive> {
  const corrections: CorrectionSortie[] = [];
  const toutes: DecisionRecommendation[] = [];

  for (const brut of brute.decisions) {
    const { valeur, corrections: c } = normaliserRecommandation(brut, montantsConnus);
    toutes.push(valeur);
    corrections.push(...c);
  }

  const classees = toutes
    .map((d, index) => ({ d, index }))
    .sort((a, b) => b.d.priority - a.d.priority || a.index - b.index)
    .map(({ d }) => d);

  if (classees.length > DECISIONS_EXECUTIVE_MAX) {
    corrections.push(
      `Le brief portait ${classees.length} décisions : les ${DECISIONS_EXECUTIVE_MAX} plus prioritaires ont été conservées.`,
    );
  }

  return {
    valeur: {
      resume: couper(brute.resume, LONGUEUR_RESUME_MAX),
      confidence: lireConfiance(brute.confidence),
      ambigu: brute.ambigu === true,
      decisions: classees.slice(0, DECISIONS_EXECUTIVE_MAX),
      agentsConsultes: brute.agentsConsultes
        .filter((a) => typeof a === "string" && a.trim().length > 0)
        .map((a) => a.trim()),
      donneesManquantes: brute.donneesManquantes
        .filter((d) => typeof d === "string" && d.trim().length > 0)
        .map((d) => couper(d, LONGUEUR_RAISON_MAX)),
    },
    corrections,
  };
}

// ==================================================================
// 7. Relire une sortie qui n'est pas venue du schéma
// ==================================================================

/**
 * Une sortie qui a fait l'aller-retour par `jsonb` (le cache de 0076)
 * ou par le réseau n'est plus typée : Zod la revalide.
 *
 * Rend `null` plutôt que de lever : côté cache, une entrée illisible
 * est un défaut de cache — on repaie l'appel — et c'est toujours mieux
 * que de servir un objet à moitié vrai dont la confiance aurait disparu
 * en route.
 */
export function relireAnalyse(valeur: unknown): AnalyseAgent | null {
  const resultat = AnalyseAgentSchema.safeParse(valeur);
  return resultat.success ? normaliserAnalyse(resultat.data).valeur : null;
}

export function relireBrief(valeur: unknown): SortieExecutive | null {
  const resultat = SortieExecutiveSchema.safeParse(valeur);
  return resultat.success ? normaliserBrief(resultat.data).valeur : null;
}
