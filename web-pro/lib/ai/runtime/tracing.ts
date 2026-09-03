import type { CleAgentModele } from "./types.ts";

/**
 * §11V — ÉTAPE 17 : LE TRACING (spec p. 24).
 *
 * ══════════════════════════════════════════════════════════════════
 * « Tracer : agent, handoffs, tools, latency, errors, approvals.
 *   MAIS : NE PAS mettre de secrets ni données personnelles inutiles
 *   dans les traces. » (p. 24)
 * ══════════════════════════════════════════════════════════════════
 *
 * Ces deux phrases se contredisent si on active le tracing par défaut
 * de l'Agents SDK : celui-ci envoie les ENTRÉES et les SORTIES de
 * chaque appel — donc, ici, des montants de devis, des noms de clients,
 * des adresses de chantier — à un service tiers. Le socle (étapes 3-6)
 * avait donc laissé l'interrupteur fermé en attendant ce filtrage.
 * Le voici.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS MODES, PARCE QU'IL Y A TROIS SITUATIONS RÉELLES
 * ══════════════════════════════════════════════════════════════════
 *
 *   `off`     (DÉFAUT) — rien n'est tracé, rien ne sort. C'est le seul
 *             réglage qu'on peut poser à la place du propriétaire des
 *             données sans lui demander.
 *
 *   `local`   — les spans sont résumés dans le JOURNAL DU SERVEUR, une
 *             ligne par span, sans aucune charge utile. Rien ne quitte
 *             la machine. C'est ce qu'on veut pour comprendre « quel
 *             agent a appelé quel outil, combien de temps, quelle
 *             erreur » — c'est-à-dire exactement la liste de la p. 24.
 *
 *   `openai`  — l'exportateur du SDK, vers le tableau de bord OpenAI.
 *             Il faut le vouloir, et il reste sous `traceIncludeSensitiveData:
 *             false`, ce qui coupe les entrées/sorties à la source.
 *
 * ══════════════════════════════════════════════════════════════════
 * `traceIncludeSensitiveData` EST LE VRAI INTERRUPTEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Le SDK expose ce réglage sur `RunConfig` : à `false`, il crée quand
 * même les spans — nom d'agent, nom d'outil, durée, erreur, handoff —
 * mais N'Y MET PAS les entrées ni les sorties. C'est précisément la
 * découpe que la page 24 demande, et elle est faite par le SDK, en
 * amont, pas par un filtre à nous qui laisserait passer le champ qu'on
 * n'a pas prévu.
 *
 * Il existe une variable pour le rallumer (`OASIS_AI_TRACING_DONNEES=on`),
 * parce qu'il y a des jours où l'on cherche pourquoi un modèle a
 * répondu ce qu'il a répondu. Elle est signalée dans `etatTracing()`
 * comme un réglage anormal, et elle ne se combine PAS silencieusement
 * avec le mode `openai` : la combinaison est refusée, avec sa raison.
 * Déboguer sur sa propre machine est une chose ; envoyer les devis
 * d'un client chez un tiers en est une autre.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'IMPORTE PAS LE SDK
 * ══════════════════════════════════════════════════════════════════
 *
 * Même découpe que `tools.ts` / `toolsSdk.ts` : la politique est ici,
 * pure et éprouvée par `node --test` ; le branchement au SDK est dans
 * `tracingSdk.ts`, qu'aucun test n'importe. On peut donc vérifier
 * qu'un nom de client ne passe pas dans une trace sans charger 66 Mo
 * de dépendances ni ouvrir une socket.
 */

export const VARIABLE_MODE_TRACING = "OASIS_AI_TRACING";
export const VARIABLE_DONNEES_TRACING = "OASIS_AI_TRACING_DONNEES";

export const MODES_TRACING = ["off", "local", "openai"] as const;
export type ModeTracing = (typeof MODES_TRACING)[number];

export type SourceEnvironnement = Readonly<Record<string, string | undefined>>;

/**
 * Le mode, lu dans l'environnement.
 *
 * Une valeur inconnue vaut `off` ET produit une anomalie. Retomber sur
 * `local` « pour rendre service » ferait écrire dans les journaux d'une
 * machine dont le propriétaire a tapé « on » en croyant activer
 * l'export ; retomber sur `openai` enverrait ses données dehors sur une
 * faute de frappe. `off` est le seul défaut qu'on puisse défendre.
 *
 * `on` est accepté comme alias de `local` : c'est la valeur que le
 * socle (étapes 3-6) reconnaissait déjà, et une variable posée avant
 * cette étape ne doit pas cesser de marcher en silence.
 */
export function lireModeTracing(env: SourceEnvironnement = process.env): ModeTracing {
  const brut = (env[VARIABLE_MODE_TRACING] ?? "").trim().toLowerCase();
  if (brut === "" || brut === "off" || brut === "false" || brut === "0") return "off";
  if (brut === "local" || brut === "on" || brut === "true" || brut === "1") return "local";
  if (brut === "openai") return "openai";
  return "off";
}

export type AnomalieTracing = {
  variable: string;
  valeur: string;
  raison: string;
};

export type EtatTracing = {
  mode: ModeTracing;
  /** Vrai quand le SDK ne doit produire aucun span. */
  desactive: boolean;
  /** Vrai quand les entrées/sorties des appels entrent dans les spans. */
  donneesSensibles: boolean;
  anomalies: readonly AnomalieTracing[];
};

/**
 * L'état complet, anomalies comprises.
 *
 * Rendu à l'écran d'administration (p. 26) : un tracing qu'on croit
 * actif et qui ne l'est pas coûte une demi-journée le jour où l'on
 * cherche une trace qui n'existe pas.
 */
export function etatTracing(env: SourceEnvironnement = process.env): EtatTracing {
  const anomalies: AnomalieTracing[] = [];

  const brut = (env[VARIABLE_MODE_TRACING] ?? "").trim();
  const mode = lireModeTracing(env);
  if (
    brut !== "" &&
    !["off", "false", "0", "local", "on", "true", "1", "openai"].includes(brut.toLowerCase())
  ) {
    anomalies.push({
      variable: VARIABLE_MODE_TRACING,
      valeur: brut,
      raison: `Valeur inconnue : le tracing reste désactivé. Attendu : ${MODES_TRACING.join(", ")}.`,
    });
  }

  const demandeDonnees = (env[VARIABLE_DONNEES_TRACING] ?? "").trim().toLowerCase() === "on";
  let donneesSensibles = false;

  if (demandeDonnees && mode === "off") {
    anomalies.push({
      variable: VARIABLE_DONNEES_TRACING,
      valeur: "on",
      raison: `Sans effet : ${VARIABLE_MODE_TRACING} vaut « off », donc aucune trace n'est produite.`,
    });
  } else if (demandeDonnees && mode === "openai") {
    // REFUSÉ, ET C'EST LE SEUL REFUS DUR DE CE FICHIER. Le mode
    // `openai` envoie les spans à un tiers ; y ajouter les entrées et
    // les sorties reviendrait à lui envoyer les devis et les noms de
    // clients d'une entreprise. Personne ne doit pouvoir obtenir cela
    // en posant deux variables d'environnement.
    anomalies.push({
      variable: VARIABLE_DONNEES_TRACING,
      valeur: "on",
      raison:
        "Refusé avec l'export OpenAI : les entrées et sorties contiennent des montants et des " +
        "noms de clients, et ne doivent pas partir chez un tiers. Utilisez le mode « local ».",
    });
  } else if (demandeDonnees) {
    donneesSensibles = true;
    anomalies.push({
      variable: VARIABLE_DONNEES_TRACING,
      valeur: "on",
      raison:
        "Les entrées et sorties des appels entrent dans les traces locales. Réglage de débogage : " +
        "à retirer une fois le diagnostic fini.",
    });
  }

  return { mode, desactive: mode === "off", donneesSensibles, anomalies };
}

// ==================================================================
// Ce qui accompagne une exécution
// ==================================================================

/**
 * Les métadonnées attachées à une trace.
 *
 * ─── CE QU'ELLES NE CONTIENNENT PAS ───
 *
 * Ni identifiant d'utilisateur, ni identifiant d'organisation en mode
 * `openai`. Un UUID d'entreprise n'est pas anonyme : croisé avec
 * n'importe quoi d'autre, il désigne une société. La page 24 dit
 * « données personnelles INUTILES » — or, pour lire une trace, savoir
 * QUEL agent a tourné et COMBIEN DE TEMPS suffit ; savoir CHEZ QUI ne
 * sert qu'en local, où l'on est déjà chez soi.
 *
 * `correlation` est un identifiant tiré au sort par requête. Il permet
 * de recoller les spans d'un même appel sans nommer personne.
 */
export type MetadonneesTrace = Readonly<Record<string, string>>;

export function metadonneesTrace(appel: {
  agent: CleAgentModele | string;
  mode: ModeTracing;
  criticite: string;
  correlation: string;
  organizationId?: string;
}): MetadonneesTrace {
  const base: Record<string, string> = {
    agent: String(appel.agent),
    criticite: appel.criticite,
    correlation: appel.correlation,
    produit: "oasis-care-pro",
  };
  if (appel.mode === "local" && appel.organizationId !== undefined) {
    base.organisation = appel.organizationId;
  }
  return Object.freeze(base);
}

/** Ce qu'on passe au `RunConfig` du SDK. */
export type ParametresTrace = {
  tracingDisabled: boolean;
  traceIncludeSensitiveData: boolean;
  workflowName: string;
  groupId: string;
  traceMetadata: MetadonneesTrace;
};

export function parametresTrace(appel: {
  agent: CleAgentModele | string;
  criticite: string;
  correlation: string;
  organizationId?: string;
  env?: SourceEnvironnement;
}): ParametresTrace {
  const etat = etatTracing(appel.env ?? process.env);
  return {
    tracingDisabled: etat.desactive,
    traceIncludeSensitiveData: etat.donneesSensibles,
    // Le nom du flux est celui de l'agent, pas celui de la question :
    // une question posée par un utilisateur n'a rien à faire dans un
    // nom de trace, qui est indexé et cherché.
    workflowName: `Oasis AI · ${appel.agent}`,
    groupId: appel.correlation,
    traceMetadata: metadonneesTrace({ ...appel, mode: etat.mode }),
  };
}

// ==================================================================
// LE RÉSUMÉ D'UN SPAN — la partie que le processeur local écrit
// ==================================================================

/**
 * La forme minimale d'un span, telle qu'on la LIT.
 *
 * On ne dépend pas du type `Span` du SDK ici, pour deux raisons : le
 * test n'a pas à charger le SDK, et le jour où le SDK ajoute un champ
 * qui contient une charge utile, ce résumé ne le recopiera pas — il ne
 * lit que ce qu'il nomme. Une liste blanche, pas une liste noire.
 */
export type SpanLu = {
  type: string;
  spanId?: string;
  traceId?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  error?: { message?: string } | null;
  donnees: Record<string, unknown>;
};

/**
 * Les champs de `SpanData` qu'on accepte de recopier, par type de span.
 *
 * TOUT LE RESTE EST JETÉ. `FunctionSpanData` porte `input` et `output`
 * (les arguments de l'outil et sa réponse : identifiants clients,
 * montants) ; `GenerationSpanData` porte `input` et `output` (le
 * contexte entier et la réponse du modèle) ; `ResponseSpanData` porte
 * `_input` et `_response`. Aucun n'est dans cette liste, et un champ
 * ajouté demain par le SDK n'y sera pas non plus.
 */
export const CHAMPS_SPAN_AUTORISES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  agent: ["name", "handoffs", "tools", "output_type"],
  function: ["name"],
  generation: ["model"],
  handoff: ["from_agent", "to_agent"],
  guardrail: ["name", "triggered"],
  custom: ["name"],
  response: ["response_id"],
  task: ["name"],
  turn: [],
});

/** Une valeur simple, ou rien. Un objet imbriqué n'entre jamais dans une trace. */
function valeurTracable(valeur: unknown): string | null {
  if (typeof valeur === "string") return valeur.length > 200 ? `${valeur.slice(0, 200)}…` : valeur;
  if (typeof valeur === "number" || typeof valeur === "boolean") return String(valeur);
  if (Array.isArray(valeur)) {
    const simples = valeur.filter((v) => typeof v === "string").slice(0, 20);
    return simples.length > 0 ? simples.join(", ") : null;
  }
  return null;
}

/** La durée d'un span, en millisecondes, ou `null` si elle n'est pas mesurable. */
export function dureeSpanMs(span: SpanLu): number | null {
  if (!span.startedAt || !span.endedAt) return null;
  const debut = Date.parse(span.startedAt);
  const fin = Date.parse(span.endedAt);
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return null;
  return Math.max(0, fin - debut);
}

/**
 * Le résumé d'un span, en une ligne, SANS charge utile.
 *
 * Rend `null` pour un type de span qu'on ne connaît pas : un span
 * inconnu est un span dont on ne sait pas quels champs sont sûrs, et
 * l'écrire « au cas où » est exactement la façon dont une donnée
 * personnelle finit dans un journal.
 */
export function resumerSpan(span: SpanLu): string | null {
  const autorises = CHAMPS_SPAN_AUTORISES[span.type];
  if (autorises === undefined) return null;

  const morceaux: string[] = [`span=${span.type}`];

  for (const champ of autorises) {
    const valeur = valeurTracable(span.donnees[champ]);
    if (valeur !== null) morceaux.push(`${champ}=${valeur}`);
  }

  const duree = dureeSpanMs(span);
  if (duree !== null) morceaux.push(`duree_ms=${duree}`);

  if (span.error) {
    // LE MESSAGE D'ERREUR EST TRONQUÉ, PAS OMIS. Une erreur de
    // fournisseur porte parfois un fragment de la requête ; deux cents
    // caractères suffisent à reconnaître « rate limit » ou « model not
    // found », qui est tout ce qu'on cherche ici.
    const message = typeof span.error.message === "string" ? span.error.message : "erreur";
    morceaux.push(`erreur=${message.slice(0, 200)}`);
  }

  return morceaux.join(" ");
}

/**
 * Les approbations, que la page 24 demande de tracer et qu'aucun span
 * du SDK ne porte.
 *
 * Le SDK trace l'INTERRUPTION comme une absence — le tour s'arrête — et
 * non comme un événement nommé. Or « qui a demandé quoi, et qu'a
 * répondu le serveur » est la ligne la plus intéressante du journal le
 * jour d'un incident. On l'écrit donc nous-mêmes, avec le même filtre :
 * un type d'action et un verdict, jamais les paramètres.
 */
export function resumerApprobation(appel: {
  agent: string;
  outil: string;
  actionType: string | null;
  risque: string | null;
  verdict: "approuvee" | "refusee";
  motif?: string | null;
}): string {
  const morceaux = [
    "span=approbation",
    `agent=${appel.agent}`,
    `outil=${appel.outil}`,
    `action=${appel.actionType ?? "—"}`,
    `risque=${appel.risque ?? "—"}`,
    `verdict=${appel.verdict}`,
  ];
  if (appel.motif) morceaux.push(`motif=${appel.motif.slice(0, 200)}`);
  return morceaux.join(" ");
}

/**
 * Un identifiant de corrélation.
 *
 * `crypto.randomUUID` est dans Node depuis longtemps et dans le runtime
 * Next ; on ne dérive rien de l'utilisateur ni de l'organisation, pour
 * que deux requêtes de la même personne ne se recollent pas dans un
 * journal partagé.
 */
export function identifiantCorrelation(): string {
  return globalThis.crypto.randomUUID();
}
