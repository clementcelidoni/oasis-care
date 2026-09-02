import { Card, Badge } from "@/components/ui";
import type { BadgeTone } from "@/lib/quotes/types";

export type AuditEvent = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  new_value: Record<string, unknown> | null;
  source: string;
  occurred_at: string;
};

/**
 * §AUDIT LOG, et §SECURITY « audit actions critiques ».
 *
 * En AJOUT SEUL, jusqu'à l'écran : il n'y a pas de bouton pour effacer
 * une ligne, parce qu'il n'y a pas de politique en base pour le faire.
 * C'est justement quand quelqu'un veut effacer une ligne qu'elle doit
 * rester.
 *
 * On montre le geste, pas le détail. « Facture FA-2026-0007 émise » se
 * lit ; le contenu complet de `new_value` ne se lit pas, et remplirait
 * l'écran de JSON.
 */
const ACTION_LABELS: Record<string, string> = {
  quoteSent: "Devis envoyé",
  quoteAccepted: "Devis accepté",
  quoteRejected: "Devis refusé",
  quoteDraftCreated: "Brouillon de devis créé",
  invoiceIssued: "Facture émise",
  invoiceCancelled: "Facture annulée",
  creditNoteIssued: "Avoir émis",
  paymentRecorded: "Règlement enregistré",
  gardenDelivered: "Jardin livré au client",
  portalInvited: "Client invité au portail",
  portalRevoked: "Accès au portail fermé",
  memberInvited: "Membre invité",
  memberRoleChanged: "Rôle modifié",
  memberAccessChanged: "Accès au logiciel modifié",
};

const SOURCE_LABELS: Record<string, string> = {
  web: "Oasis Care Pro",
  ios: "iPhone",
  ai: "Oasis AI",
  system: "Automatique",
};

const SOURCE_TONE: Record<string, BadgeTone> = {
  web: "neutral",
  ios: "neutral",
  // L'assistant se repère d'un coup d'œil : c'est la seule source qui
  // n'est pas un geste humain direct.
  ai: "accent",
  system: "neutral",
};

export function AuditLog({ events }: { events: AuditEvent[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Journal des opérations</h2>
        <span className="text-xs text-ink-faint">{events.length}</span>
      </div>

      {events.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-ink-faint">
          Aucune opération critique enregistrée pour l&apos;instant.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
              <span className="min-w-0 flex-1 text-sm">
                {ACTION_LABELS[event.action] ?? event.action}
                {describe(event) && (
                  <span className="text-ink-soft"> — {describe(event)}</span>
                )}
              </span>
              <Badge tone={SOURCE_TONE[event.source] ?? "neutral"}>
                {SOURCE_LABELS[event.source] ?? event.source}
              </Badge>
              <span className="tabular shrink-0 text-xs text-ink-faint">
                {new Date(event.occurred_at).toLocaleString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-line px-5 py-3 text-xs text-ink-faint">
        Ce journal s&apos;écrit seul et ne se modifie pas : la base n&apos;a
        aucune politique permettant de corriger ou d&apos;effacer une ligne.
      </p>
    </Card>
  );
}

/** Le seul détail qui vaut la peine d'être lu, selon le geste. */
function describe(event: AuditEvent): string | null {
  const value = event.new_value ?? {};
  if (typeof value.number === "string") return value.number;
  if (typeof value.email === "string") return value.email;
  if (typeof value.amount_cents === "number") {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })
      .format(value.amount_cents / 100);
  }
  if (typeof value.lines === "number") {
    return `${value.lines} ligne${value.lines > 1 ? "s" : ""}`;
  }
  return null;
}
