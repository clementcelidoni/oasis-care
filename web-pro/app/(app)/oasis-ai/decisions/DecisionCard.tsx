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
  DECISION_STATUS_LABELS,
  DECISION_STATUS_TONES,
  RISK_LABELS,
  RISK_TONES,
  isAgentKey,
  readDataSources,
  readDecisionActions,
} from "@/lib/ai/types";
import type { CatalogEntry } from "@/lib/ai/types";
import type { DecisionWithActions } from "@/lib/ai/decisions";
import { Explanation } from "../Explanation";

/**
 * §11V — UNE DÉCISION, ET LES CINQ BOUTONS DE LA SPEC (p. 6).
 *
 *     Appliquer · Préparer · Plus tard · Ignorer · Demander à Oasis
 *
 * ─── POURQUOI L'EXPLICATION N'EST PAS REPLIÉE ICI ───
 *
 * Sur le briefing du matin, elle l'est : on balaye vingt lignes.
 * Ici, on tranche. « Pourquoi ? » est un critère de validation de la
 * spec à lui seul, et une décision qu'on approuve sans avoir déplié son
 * raisonnement est exactement ce que cette phase cherche à éviter. Elle
 * est donc à plat, au-dessus des boutons, et il faut la traverser pour
 * atteindre « Appliquer ».
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
export function DecisionCard({
  item,
  catalog,
  canAct,
  confirmMessages,
}: {
  item: DecisionWithActions;
  catalog: Map<string, CatalogEntry>;
  /** `projects.manage` : le droit qu'exigent `ai_actions` et `ai_answer_decision`. */
  canAct: boolean;
  /** Le récapitulatif à montrer avant d'appliquer, par type d'action. */
  confirmMessages: Map<string, string>;
}) {
  const { decision, pending, actions } = item;
  const proposed = readDecisionActions(decision.available_actions);
  const agentLabel = isAgentKey(decision.agent)
    ? AGENT_LABELS[decision.agent]
    : decision.agent;

  const question = `À propos de « ${decision.title} » : que me conseilles-tu ?`;
  const executed = actions.find((a) => a.status === "executed");

  return (
    <Card>
      {/* ---- L'en-tête : d'où ça vient, et de quoi il s'agit ---- */}
      <div className="flex flex-wrap items-start gap-2 border-b border-line px-5 py-3.5">
        <Badge tone={CATEGORY_TONES[decision.category]}>
          {CATEGORY_LABELS[decision.category]}
        </Badge>
        <Badge tone="neutral">{agentLabel}</Badge>
        <h3 className="min-w-0 flex-1 basis-full text-[length:var(--text-card)] font-semibold leading-tight sm:basis-auto">
          {decision.title}
        </h3>
        <StatusBadge tone={DECISION_STATUS_TONES[decision.status]}>
          {DECISION_STATUS_LABELS[decision.status]}
        </StatusBadge>
      </div>

      <div className="px-5 py-4">
        <p className="mb-4 text-[var(--text-secondary)] text-ink-faint">
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

        <Explanation
          pourquoi={decision.reasoning_summary}
          impactCents={decision.financial_impact_cents}
          impactTexte={decision.estimated_impact}
          donneesUtilisees={readDataSources(decision.data_sources)}
          confiance={decision.confidence}
          /* `description` porte le « si rien n'est fait » : `ai_decisions`
             (0072) n'a pas de colonne dédiée, et c'est le seul texte
             libre disponible. Voir le commentaire de `lib/ai/scan.ts`. */
          siRienNestFait={decision.description}
          actionRecommandee={decision.recommended_action}
        />
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

            <Link
              href={`/oasis-ai/demander?q=${encodeURIComponent(question)}`}
              className="ml-auto text-[var(--text-secondary)] text-accent hover:underline"
            >
              Demander à Oasis
            </Link>
          </>
        )}
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
