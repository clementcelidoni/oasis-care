import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import type { DashboardAlert } from "./queries";

/**
 * §10 DASHBOARD V2 — « ALERTES : À SURVEILLER ».
 *
 * Une alerte n'a d'intérêt que si elle mène quelque part : chaque ligne
 * est donc un lien vers l'écran qui permet de la traiter, jamais un
 * simple constat. Un tableau de bord qui signale un problème sans
 * donner la porte oblige à retrouver soi-même le bon menu.
 *
 * Ce panneau ne montre QUE ce qui se déclenche. Une liste des quatre
 * contrôles avec trois « rien à signaler » remplirait l'écran de
 * silence — et §1 demande l'inverse.
 */

const TONE_CLASS = {
  warning: "bg-warning-wash text-warning",
  critical: "bg-critical-wash text-critical",
} as const;

export function Alerts({ alerts, checks }: { alerts: DashboardAlert[]; checks: string[] }) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        title="Rien à surveiller"
        // On énumère ce qui a VRAIMENT été contrôlé. Écrire « tout va
        // bien » alors que le module Pépinière est éteint serait une
        // promesse que cet écran ne tient pas.
        description={
          checks.length > 0
            ? `Contrôlé à l'instant : ${listeFrancaise(checks)}.`
            : "Aucun contrôle ne s'applique à votre périmètre."
        }
        icon={<Icon name="check" className="h-5 w-5" />}
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <Link
              href={alert.href}
              className="flex items-start gap-3.5 px-5 py-4 transition-colors hover:bg-canvas"
            >
              {/* §47 : la couleur DOUBLE le texte, elle ne le remplace
                  pas. Le titre dit déjà tout ce que la teinte suggère. */}
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${TONE_CLASS[alert.tone]}`}
              >
                <Icon name={alert.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{alert.title}</span>
                <span className="mt-0.5 block text-[var(--text-secondary)] text-ink-soft">
                  {alert.detail}
                </span>
              </span>
              <span aria-hidden className="shrink-0 self-center text-ink-faint">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** « a, b et c » — la conjonction française, que `join(", ")` ne fait pas. */
function listeFrancaise(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}
