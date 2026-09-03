import { setTraceProcessors, setTracingDisabled } from "@openai/agents";
import type { Span, SpanData, Trace, TracingProcessor } from "@openai/agents";
import {
  etatTracing,
  resumerSpan,
  type EtatTracing,
  type SourceEnvironnement,
  type SpanLu,
} from "./tracing.ts";

/**
 * §11V — ÉTAPE 17 : LE BRANCHEMENT DU TRACING AU SDK.
 *
 * Seul fichier du dossier, avec `toolsSdk.ts` et `agents.ts`, à
 * importer `@openai/agents`. La POLITIQUE — que tracer, que jeter, quel
 * mode — vit dans `tracing.ts`, qui n'importe rien et qui est éprouvé.
 * Ici, il n'y a que le câblage.
 *
 * ─── CE QUE FAIT `configurerTracing` ───
 *
 *   `off`    → `setTracingDisabled(true)`. Le SDK ne construit même
 *              plus les spans.
 *
 *   `local`  → `setTraceProcessors([...])` avec NOTRE processeur, ce
 *              qui RETIRE l'exportateur OpenAI installé par défaut.
 *              C'est le point important : sans ce remplacement, activer
 *              le tracing enverrait les spans chez OpenAI, ce que
 *              personne n'a demandé.
 *
 *   `openai` → on ne touche à rien : l'exportateur du SDK reste, et
 *              `traceIncludeSensitiveData: false` (posé par
 *              `parametresTrace`) empêche les entrées/sorties d'y
 *              entrer.
 *
 * ─── APPELÉE UNE FOIS PAR PROCESSUS ───
 *
 * Le tracing est un réglage GLOBAL du SDK. L'appeler à chaque requête
 * réinstallerait le processeur à chaque fois — donc, à chaque fois,
 * jetterait la file d'attente du précédent. `#configure` retient que
 * c'est fait.
 */

/** Le seuil au-delà duquel un span est jugé lent, et signalé comme tel. */
export const SEUIL_SPAN_LENT_MS = 15_000;

/**
 * Le processeur local : une ligne par span, dans le journal du serveur.
 *
 * ─── IL N'ENVOIE RIEN, NULLE PART ───
 *
 * Pas de file d'attente, pas d'export, pas de `fetch`. `forceFlush` et
 * `shutdown` ne font rien parce qu'il n'y a rien à vider : la ligne est
 * écrite au moment où le span se termine. Un processeur qui accumule
 * pour envoyer plus tard est un processeur qui garde des données en
 * mémoire — et qui les perd au redéploiement, ce qui est le pire des
 * deux mondes pour un journal de diagnostic.
 *
 * ─── ET IL NE RECOPIE QUE CE QU'IL NOMME ───
 *
 * `resumerSpan` travaille sur une LISTE BLANCHE de champs par type de
 * span. Un span dont le type est inconnu n'est pas écrit du tout.
 */
export class ProcesseurTraceLocale implements TracingProcessor {
  readonly #ecrire: (ligne: string) => void;

  constructor(ecrire: (ligne: string) => void = (l) => console.info(l)) {
    this.#ecrire = ecrire;
  }

  async onTraceStart(trace: Trace): Promise<void> {
    this.#ecrire(`[oasis-ai] trace=debut nom=${trace.name} id=${trace.traceId}`);
  }

  async onTraceEnd(trace: Trace): Promise<void> {
    this.#ecrire(`[oasis-ai] trace=fin nom=${trace.name} id=${trace.traceId}`);
  }

  /**
   * Le début d'un span n'écrit RIEN.
   *
   * Il n'apporte que la moitié de l'information — pas de durée, pas
   * d'erreur — et il double le volume du journal. La latence, que la
   * page 24 demande, se lit à la fin.
   */
  async onSpanStart(): Promise<void> {}

  async onSpanEnd(span: Span<SpanData>): Promise<void> {
    const ligne = resumerSpan(lireSpan(span));
    if (ligne === null) return;
    this.#ecrire(`[oasis-ai] ${ligne}`);
  }

  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

/**
 * Le span du SDK, ramené à la forme que `tracing.ts` sait lire.
 *
 * `spanData` est recopié en surface — les champs sont ensuite filtrés
 * par `resumerSpan`. On ne le passe pas tel quel plus loin : la copie
 * de surface interdit qu'une mutation ultérieure du SDK change ce qu'on
 * a déjà décidé d'écrire.
 */
function lireSpan(span: Span<SpanData>): SpanLu {
  const donnees = span.spanData as unknown as Record<string, unknown>;
  return {
    type: typeof donnees.type === "string" ? donnees.type : "inconnu",
    spanId: span.spanId,
    traceId: span.traceId,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    error: span.error,
    donnees: { ...donnees },
  };
}

let configure = false;

/**
 * Installer le tracing pour ce processus. Idempotente.
 *
 * Rend l'état, anomalies comprises, pour que l'écran d'administration
 * (p. 26) puisse dire ce qui tourne réellement — et pour que
 * `parametresTrace` et cette fonction ne puissent pas diverger : les
 * deux lisent `etatTracing`.
 */
export function configurerTracing(env: SourceEnvironnement = process.env): EtatTracing {
  const etat = etatTracing(env);

  if (configure) return etat;
  configure = true;

  if (etat.mode === "off") {
    setTracingDisabled(true);
    return etat;
  }

  setTracingDisabled(false);

  if (etat.mode === "local") {
    // LE REMPLACEMENT EST LE POINT DE CE MODE. `setTraceProcessors`
    // écrase la liste, donc l'exportateur OpenAI installé par défaut
    // disparaît. `addTraceProcessor` l'aurait laissé en place et les
    // spans seraient partis chez un tiers en plus du journal local.
    setTraceProcessors([new ProcesseurTraceLocale()]);
  }

  for (const anomalie of etat.anomalies) {
    console.warn(`[oasis-ai] tracing : ${anomalie.variable}=${anomalie.valeur} — ${anomalie.raison}`);
  }

  return etat;
}

/** Oublie que la configuration a eu lieu. Pour les tests, et pour eux seuls. */
export function reinitialiserTracing(): void {
  configure = false;
}
