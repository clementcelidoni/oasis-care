import Link from "next/link";
import { Card, Badge, StatusBadge, SubmitButton, ConfirmDialog } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import {
  answerDecision,
  applyDecisionAction,
  prepareDecisionAction,
  answerApproval,
} from "@/lib/ai/engine";
import { isExecutable, MANUAL_ROUTES } from "@/lib/ai/registry";
import {
  AGENT_LABELS,
  CATEGORY_LABELS,
  CATEGORY_MEANINGS,
  CATEGORY_TONES,
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_TONES,
  RISK_LABELS,
  RISK_TONES,
  isAgentKey,
  isInsufficient,
  readDataSources,
  readDecisionActions,
  type DecisionCategory,
} from "@/lib/ai/types";
import type { CatalogEntry } from "@/lib/ai/types";
import type { DecisionWithActions } from "@/lib/ai/decisions";
import type { MonAvis } from "@/lib/ai/admin/lecture";
import { Explanation } from "../Explanation";
import { Feedback } from "./Feedback";

/**
 * §11V — UNE DÉCISION, ET LES CINQ BOUTONS DE LA SPEC (p. 6).
 *
 *     Appliquer · Préparer · Plus tard · Ignorer · Demander à Oasis
 *
 * ─── §11W : L'EXPLICATION EST DÉSORMAIS REPLIÉE, ET C'EST UN ARBITRAGE ───
 *
 * Elle était à plat, pour une bonne raison : « Pourquoi ? » est un
 * critère de validation à lui seul, et une décision approuvée sans
 * qu'on ait lu son raisonnement est ce que cette phase évite. Mais
 * depuis la fusion du briefing et du centre de décision dans un seul
 * écran, ces cartes ne sont plus seules : elles cohabitent avec les
 * constats et les sept listes de faits du jour. Cinq blocs dépliés par
 * carte, sur un écran qu'on ouvre chaque matin, ne se lisent plus — ils
 * se dépassent au défilement, ce qui est pire qu'un pli.
 *
 * Trois choses gardent la promesse intacte :
 *
 *   • le pli est un `<details>` NATIF — ouvert par le clavier, trouvé
 *     par le Ctrl+F du navigateur, présent dans le DOM même replié.
 *     Le « Pourquoi ? » n'est jamais à un chargement de distance ;
 *   • le résumé porte déjà le titre, l'impact chiffré et la confiance
 *     quand elle n'est pas bonne — c'est-à-dire de quoi savoir qu'il
 *     faut déplier ;
 *   • `Explanation` n'est PAS touché : les cinq blocs de la spec p. 6
 *     survivent mot pour mot à la refonte.
 *
 * Les boutons, eux, restent visibles sans déplier : les replier
 * cacherait l'action derrière un geste, ce qui est l'erreur inverse.
 *
 * ─── POURQUOI « APPLIQUER » PASSE PAR UNE BOÎTE DE DIALOGUE ───
 *
 * Spec p. 9 : une action à risque doit afficher ce qu'elle va faire,
 * combien elle engage, et ce qui n'est pas prêt, AVANT de partir. Le
 * texte de cette boîte est composé côté serveur à partir des chiffres
 * relus au moment du rendu — il ne vient jamais du modèle.
 *
 * ─── POURQUOI CERTAINS BOUTONS SONT ABSENTS ───
 *
 * Le catalogue déclare neuf actions ; cette itération en exécute une.
 * Proposer « Appliquer » sur les huit autres donnerait un bouton qui ne
 * fait rien, ou pire, un « c'est fait » sur un néant. À leur place :
 * la phrase qui dit pourquoi Oasis ne le fait pas, et le lien vers
 * l'écran où on le fait soi-même. Un cul-de-sac nommé vaut mieux qu'un
 * bouton menteur.
 */
/**
 * Le filet de gauche, par catégorie.
 *
 * Il reprend `CATEGORY_TONES` — la même teinte que le badge, pas une
 * seconde échelle de couleurs à tenir à jour. Purement décoratif :
 * `aria-hidden`, parce que le mot est déjà dans le badge.
 */
const FILET_CATEGORIE: Record<DecisionCategory, string> = {
  urgent: "bg-critical",
  important: "bg-warning",
  opportunite: "bg-accent",
  optimisation: "bg-info",
  information: "bg-line-strong",
};

export function DecisionCard({
  item,
  catalog,
  canAct,
  confirmMessages,
  monAvis = null,
}: {
  item: DecisionWithActions;
  catalog: Map<string, CatalogEntry>;
  /** `projects.manage` : le droit qu'exigent `ai_actions` et `ai_answer_decision`. */
  canAct: boolean;
  /** Le récapitulatif à montrer avant d'appliquer, par type d'action. */
  confirmMessages: Map<string, string>;
  /** Mon 👍 / 👎 sur cette recommandation (spec p. 25), s'il existe. */
  monAvis?: MonAvis | null;
}) {
  const { decision, pending, actions } = item;
  const proposed = readDecisionActions(decision.available_actions);
  const agentLabel = isAgentKey(decision.agent)
    ? AGENT_LABELS[decision.agent]
    : decision.agent;

  const question = `À propos de « ${decision.title} » : que me conseilles-tu ?`;
  const executed = actions.find((a) => a.status === "executed");
  const confianceFaible =
    decision.confidence !== "high" && !isInsufficient(decision.confidence);

  return (
    <Card className="flex">
      {/* LE FILET DE CATÉGORIE. Il DOUBLE le badge, il ne le remplace
          pas : la couleur ne porte jamais seule une information de ce
          produit, et un œil qui ne distingue pas l'ambre du rouge lit
          le même classement dans le mot juste à côté. */}
      <span
        aria-hidden="true"
        className={`w-1 shrink-0 rounded-l-[var(--radius-card)] ${FILET_CATEGORIE[decision.category]}`}
      />

      <div className="min-w-0 flex-1">
        {/* ---- L'en-tête : d'où ça vient, de quoi il s'agit, combien ---- */}
        <div className="flex flex-wrap items-start gap-2 border-b border-line px-5 py-3.5">
          <Badge tone={CATEGORY_TONES[decision.category]}>
            {CATEGORY_LABELS[decision.category]}
          </Badge>
          <Badge tone="neutral">{agentLabel}</Badge>
          <h3 className="min-w-0 flex-1 basis-full text-[length:var(--text-card)] font-semibold leading-tight sm:basis-auto">
            {decision.title}
          </h3>
          {/* L'IMPACT MONTE DANS L'EN-TÊTE. C'est le chiffre sur lequel
              on arbitre ; l'enfouir dans un bloc replié obligeait à
              déplier chaque carte pour savoir laquelle mérite qu'on la
              déplie. Un tiret, jamais « 0 € ». */}
          <span
            className={`tabular shrink-0 text-[var(--text-body)] font-medium ${
              decision.financial_impact_cents === null ? "text-ink-faint" : ""
            }`}
          >
            {formatCents(decision.financial_impact_cents)}
          </span>
          {/* LE STATUT NE S'AFFICHE PAS QUAND IL VAUT LE DÉFAUT.
              « À traiter » sur chaque carte d'une liste de décisions à
              traiter n'apprend rien, et apprend surtout à ne plus lire
              la pastille — donc à rater « Reportée ». */}
          {decision.status !== "new" && (
            <StatusBadge tone={DECISION_STATUS_TONES[decision.status]}>
              {DECISION_STATUS_LABELS[decision.status]}
            </StatusBadge>
          )}
        </div>

        <div className="px-5 py-4">
          <p className="text-[var(--text-secondary)] text-ink-faint">
            {CATEGORY_MEANINGS[decision.category]} Détectée le{" "}
            {new Date(decision.created_at).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
            })}
            {decision.status === "snoozed" && decision.snoozed_until && (
              <> — reportée jusqu&apos;au {new Date(decision.snoozed_until).toLocaleDateString("fr-FR")}</>
            )}
            .
          </p>

          {/* DEUX FORMES, JAMAIS DEUX TEINTES.
              Une confiance moyenne ou faible qualifie la RÉPONSE : c'est
              un badge. « Données insuffisantes » ne qualifie rien — il
              manque quelque chose, et ça appelle un geste : c'est une
              ligne de texte. Les rendre comme deux pastilles dans la
              même case est précisément ce qui les confondait. */}
          {confianceFaible && (
            <p className="mt-2">
              <Badge tone={CONFIDENCE_TONES[decision.confidence]}>
                Confiance : {CONFIDENCE_LABELS[decision.confidence].toLowerCase()}
              </Badge>
            </p>
          )}
          {isInsufficient(decision.confidence) && (
            <p className="mt-2 text-[var(--text-secondary)] text-warning">
              Il manque des données pour chiffrer cette ligne. Aucun montant ne
              l&apos;accompagne : un chiffre posé sur des données manquantes serait une
              estimation déguisée.
            </p>
          )}

          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-[var(--text-secondary)] text-accent">
              <span className="group-open:hidden">Pourquoi ? — voir le raisonnement</span>
              <span className="hidden text-ink-faint group-open:inline">
                Replier le raisonnement
              </span>
            </summary>
            <div className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-4 py-3.5">
              <Explanation
                pourquoi={decision.reasoning_summary}
                impactCents={decision.financial_impact_cents}
                impactTexte={decision.estimated_impact}
                donneesUtilisees={readDataSources(decision.data_sources)}
                confiance={decision.confidence}
                /* `description` porte le « si rien n'est fait » :
                   `ai_decisions` (0072) n'a pas de colonne dédiée, et
                   c'est le seul texte libre disponible. Voir le
                   commentaire de `lib/ai/scan.ts`. */
                siRienNestFait={decision.description}
                actionRecommandee={decision.recommended_action}
              />
            </div>
          </details>
        </div>

      {/* ---- Une validation court déjà ---- */}
      {pending && (
        <div className="border-t border-line bg-warning-wash px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RISK_TONES[pending.risk]}>{RISK_LABELS[pending.risk]}</Badge>
            <p className="min-w-0 flex-1 text-[var(--text-body)] text-warning">
              {catalog.get(pending.actionType)?.label ?? pending.actionType} attend une
              validation. Elle expire le{" "}
              {new Date(pending.expiresAt).toLocaleString("fr-FR", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
              .
            </p>
          </div>
          {canAct ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <ConfirmDialog
                triggerLabel="Valider et exécuter"
                triggerVariant="primary"
                title="Valider cette action ?"
                message={
                  confirmMessages.get(pending.actionType) ??
                  "Oasis exécutera l'action après votre validation. Elle sera consignée au journal."
                }
                confirmLabel="Valider et exécuter"
                action={answerApproval}
                /* UN SEUL IDENTIFIANT PART D'ICI, ET C'EST VOULU.
                   La Server Action relit l'action et son type sur la
                   ligne d'approbation : lui envoyer aussi un identifiant
                   d'action et un type d'action reviendrait à laisser
                   le navigateur désigner ce qui s'exécute, alors que
                   la validation, elle, porte sur cette demande-ci. */
                hidden={{
                  approvalId: pending.approvalId,
                  ok: "1",
                }}
              />
              <form action={answerApproval}>
                <input type="hidden" name="approvalId" value={pending.approvalId} />
                <input type="hidden" name="ok" value="0" />
                <SubmitButton variant="secondary">Refuser</SubmitButton>
              </form>
            </div>
          ) : (
            <p className="mt-2 text-[var(--text-secondary)] text-warning">
              Votre rôle ne permet pas de répondre à une validation. Un conducteur de
              travaux ou un administrateur le peut.
            </p>
          )}
        </div>
      )}

      {/* ---- Ce qui a déjà été fait ---- */}
      {executed && (
        <div className="border-t border-line bg-positive-wash px-5 py-3">
          <p className="text-[var(--text-body)] text-positive">
            {describeExecution(executed.result)}
            {executed.executedAt &&
              ` — le ${new Date(executed.executedAt).toLocaleString("fr-FR", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}.`}
          </p>
        </div>
      )}

      {/* ---- Les boutons ---- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
        {!canAct ? (
          /* §42 : on n'escamote pas la carte — l'explication est utile
             sans le droit d'agir. On retire de quoi écrire, et on dit
             pourquoi. */
          <p className="text-[var(--text-secondary)] text-ink-faint">
            Votre rôle ne permet pas de répondre à une décision. Il faut le droit de
            conduire les chantiers ; demandez-le à un administrateur.
          </p>
        ) : (
          <>
            {!pending &&
              proposed.map((action) => {
                const entry = catalog.get(action.actionType);
                const label = action.label ?? entry?.label ?? action.actionType;

                if (!isExecutable(action.actionType)) {
                  const manual = MANUAL_ROUTES[action.actionType];
                  return (
                    <span
                      key={action.actionType}
                      className="text-[var(--text-secondary)] text-ink-faint"
                    >
                      {label} :{" "}
                      {manual?.why ?? "Oasis ne sait pas encore le faire lui-même."}{" "}
                      {manual && (
                        <Link href={manual.href} className="text-accent hover:underline">
                          {manual.label}
                        </Link>
                      )}
                    </span>
                  );
                }

                return (
                  <span key={action.actionType} className="flex flex-wrap gap-2">
                    <ConfirmDialog
                      triggerLabel="Appliquer"
                      triggerVariant="primary"
                      title={`Oasis souhaite : ${label.toLowerCase()}`}
                      message={
                        confirmMessages.get(action.actionType) ??
                        "Rien n'a encore été écrit. La validation et l'exécution seront consignées au journal."
                      }
                      confirmLabel="Confirmer"
                      action={applyDecisionAction}
                      hidden={{
                        decisionId: decision.id,
                        actionType: action.actionType,
                      }}
                    />
                    <form action={prepareDecisionAction}>
                      <input type="hidden" name="decisionId" value={decision.id} />
                      <input type="hidden" name="actionType" value={action.actionType} />
                      <SubmitButton variant="secondary">Préparer</SubmitButton>
                    </form>
                  </span>
                );
              })}

            <form action={answerDecision}>
              <input type="hidden" name="decisionId" value={decision.id} />
              <input type="hidden" name="status" value="snoozed" />
              <SubmitButton variant="ghost">Plus tard</SubmitButton>
            </form>

            <form action={answerDecision}>
              <input type="hidden" name="decisionId" value={decision.id} />
              <input type="hidden" name="status" value="rejected" />
              <SubmitButton variant="ghost">Ignorer</SubmitButton>
            </form>

            {/* La question part dans une conversation NEUVE, et c'est
                exact : elle n'a aucun passé à relire. Le fil s'ouvrira
                sur cette question déjà écrite, pas encore envoyée — un
                lien qui interroge le modèle au clic ferait dépenser une
                question de l'abonnement sans qu'on l'ait demandé. */}
            <Link
              href={`/oasis-ai/conversations?q=${encodeURIComponent(question)}`}
              className="ml-auto text-[var(--text-secondary)] text-accent hover:underline"
            >
              En parler à Oasis
            </Link>
          </>
        )}
        </div>

        {/* §11V p. 25 — le pouce vient APRÈS les boutons, et il est offert
            même à qui ne peut pas agir.

            Après, parce qu'on juge une recommandation une fois qu'on a
            décidé quoi en faire — la placer au-dessus reviendrait à
            demander un avis avant d'avoir lu.

            À tout le monde, parce que la politique RLS de
            `ai_recommendation_feedback` (0076) demande `projects.read` et
            non `projects.manage`, et pour la raison qu'elle donne :
            réserver la mesure aux seuls gestionnaires fausserait
            l'échantillon en excluant ceux qui utilisent le plus l'outil. */}
        <Feedback decisionId={decision.id} avis={monAvis} />
      </div>
    </Card>
  );
}

/**
 * Ce qui est sorti d'une exécution, en une phrase.
 *
 * Le résultat est un `jsonb` écrit par l'exécuteur, pas par un modèle.
 * On ne rend que les clés qu'on reconnaît : afficher le JSON brut
 * ferait passer un détail d'implémentation pour une information.
 */
function describeExecution(result: unknown): string {
  if (typeof result !== "object" || result === null) return "Action exécutée.";
  const row = result as Record<string, unknown>;

  const created = row.brouillonsCrees;
  if (typeof created === "number") {
    const total = typeof row.totalHtCents === "number" ? row.totalHtCents : null;
    const skipped = Array.isArray(row.dossiersEcartes) ? row.dossiersEcartes.length : 0;
    return [
      `${created} brouillon(s) de facture créé(s)`,
      total === null ? "montant total inconnu" : `total HT ${formatCents(total)}`,
      skipped > 0 ? `${skipped} dossier(s) écarté(s)` : "",
      "aucune n'est émise",
    ]
      .filter(Boolean)
      .join(", ");
  }

  return "Action exécutée.";
}
