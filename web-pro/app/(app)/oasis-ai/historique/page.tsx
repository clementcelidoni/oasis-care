import { requireOrganization } from "@/lib/auth/organization";
import { Card, Badge, PageHeader, EmptyState, DataTable, type Column } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import { getAiHistory, confirmationLabel, type HistoryEntry } from "@/lib/ai/history";
import { countOpenDecisions } from "@/lib/ai/decisions";
import { AGENT_LABELS, isAgentKey } from "@/lib/ai/types";
import { OasisTabs } from "../OasisTabs";

/**
 * §11V — HISTORY (spec p. 41) : « date · agent · décision · utilisateur
 * · action · résultat · impact ».
 *
 * ─── POURQUOI CET ÉCRAN EXISTE ───
 *
 * « Toutes les actions importantes doivent être traçables, auditables,
 * explicables, réversibles lorsque possible » (p. 3). Les trois
 * premières ne valent rien si personne ne peut les LIRE. Un journal
 * qu'il faut interroger en SQL est un journal qui n'existe pas pour le
 * chef d'entreprise.
 *
 * ─── CE QU'ON Y VOIT, ET CE QU'ON N'Y VOIT PAS ───
 *
 * Tout ce qui porte `source = 'ai'` dans `audit_events` : les décisions
 * ouvertes et tranchées, les validations demandées et répondues, les
 * actions exécutées ou échouées, les changements d'autonomie et
 * d'autopilote, et les quinze écritures que l'assistant sait préparer
 * (0069).
 *
 * On n'y voit PAS les gestes faits à la main ailleurs dans le produit :
 * ils sont dans le journal des opérations, sous Paramètres. Mélanger
 * les deux ferait perdre la seule question à laquelle cet écran
 * répond — « qu'est-ce que la machine a fait ? ».
 *
 * ─── L'IMPACT EST CELUI QUI A ÉTÉ CONSTATÉ ───
 *
 * Quand il existe, il vient du RÉSULTAT de l'action, pas de ce qui
 * avait été annoncé. Quand il n'existe pas, la cellule est vide — pas à
 * zéro. Un journal qui affiche « 0 € » sur une action dont on ne sait
 * pas chiffrer l'effet raconte une histoire fausse, et il la raconte
 * avec l'autorité d'un journal.
 */
export default async function HistoryPage() {
  const organization = await requireOrganization();

  const [history, openDecisions] = await Promise.all([
    getAiHistory(organization.organizationId),
    countOpenDecisions(organization.organizationId),
  ]);

  const columns: Column<HistoryEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <span className="tabular whitespace-nowrap">
          {new Date(row.occurredAt).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
      width: "9rem",
    },
    {
      key: "agent",
      header: "Agent",
      cell: (row) =>
        row.agent ? (
          <Badge tone="neutral">
            {isAgentKey(row.agent) ? AGENT_LABELS[row.agent] : row.agent}
          </Badge>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
      width: "8rem",
    },
    {
      key: "action",
      header: "Action",
      cell: (row) => (
        <span>
          <span className="block font-medium">{row.action}</span>
          {row.decisionTitle && (
            <span className="block text-[var(--text-secondary)] text-ink-soft">
              {row.decisionTitle}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "user",
      header: "Utilisateur",
      cell: (row) =>
        row.actorName ? (
          row.actorName
        ) : row.actorUserId ? (
          /* Un identifiant sans nom : le compte n'a pas de fiche
             salarié. On le dit plutôt que d'afficher un UUID, qui ne
             désigne personne pour un lecteur humain. */
          <span className="text-ink-faint">compte sans fiche</span>
        ) : (
          <span className="text-ink-faint">traitement automatique</span>
        ),
      secondary: true,
      width: "10rem",
    },
    {
      key: "confirmation",
      header: "Confirmation",
      cell: (row) => (
        <span className="text-ink-soft">{confirmationLabel(row.confirmation) ?? "—"}</span>
      ),
      secondary: true,
      width: "9rem",
    },
    {
      key: "result",
      header: "Résultat",
      cell: (row) => (
        <span
          className={
            row.succeeded === false ? "text-critical" : row.outcome ? "" : "text-ink-faint"
          }
        >
          {row.outcome ?? (row.succeeded === true ? "Fait." : "—")}
        </span>
      ),
    },
    {
      key: "impact",
      header: "Impact",
      numeric: true,
      // `formatCents(null)` rend un tiret. Jamais « 0,00 € » pour dire
      // « on ne sait pas » : c'est la confusion que ce projet a déjà
      // corrigée trois fois.
      cell: (row) => (
        <span className={row.impactCents === null ? "text-ink-faint" : ""}>
          {formatCents(row.impactCents)}
        </span>
      ),
      width: "8rem",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Historique"
        subtitle="Tout ce qu'Oasis a fait, ou tenté de faire, au nom de cette entreprise. Rien n'y est effaçable depuis l'application."
      />

      <OasisTabs current="/oasis-ai/historique" openDecisions={openDecisions} />

      {history.failed ? (
        <Card className="border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {history.failureReason}
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            Ce n&apos;est pas « aucune activité » : le journal n&apos;a pas pu être lu.
          </p>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={history.entries}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="Oasis n'a encore rien fait ici."
              description="Chaque décision ouverte, chaque validation, chaque action exécutée viendra s'inscrire ici avec son agent, son auteur, son résultat et son impact."
            />
          }
          footer={
            <p className="text-[var(--text-secondary)] text-ink-faint">
              Les {history.entries.length} derniers événements. Les gestes faits à la
              main ailleurs dans le produit sont dans le journal des opérations, sous
              Paramètres — cet écran ne montre que ce qui porte la signature d&apos;Oasis.
            </p>
          }
        />
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";
