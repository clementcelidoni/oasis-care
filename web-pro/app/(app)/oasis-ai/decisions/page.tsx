import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { Card, Badge, EmptyState, PageHeader, Panel, SubmitButton } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import {
  getBillingPreview,
  getConversationApprovals,
  getDecisionBoard,
  type OrphanApproval,
} from "@/lib/ai/decisions";
import { answerApproval } from "@/lib/ai/engine";
import { catalogIndex, getActionCatalog } from "@/lib/ai/registry";
import { RISK_LABELS, RISK_TONES } from "@/lib/ai/types";
import { runExecutiveScan } from "@/lib/ai/scan";
import { lireMesAvis } from "@/lib/ai/admin/lecture";
import {
  CATEGORY_LABELS,
  DECISION_CATEGORIES,
  isDecisionCategory,
  type DecisionCategory,
} from "@/lib/ai/types";
import { OasisTabs } from "../OasisTabs";
import { DecisionCard } from "./DecisionCard";

/**
 * §11V — BRIQUE N° 2 : LE DECISION CENTER (spec p. 5-6).
 *
 * Cinq catégories, et une décision par ligne avec tout ce qu'il faut
 * pour la trancher : pourquoi, combien, sur quelles données, avec
 * quelle confiance, et ce qui se passe si on ne fait rien.
 *
 * ─── D'OÙ VIENNENT LES DÉCISIONS ───
 *
 * D'un BALAYAGE explicite (`runExecutiveScan`), pas du rendu de cette
 * page. Ouvrir une décision est une écriture : la déclencher au simple
 * affichage la rejouerait à chaque rechargement, à chaque onglet, à
 * chaque robot. Le bouton « Lancer l'analyse » est donc là, visible,
 * et il fait exactement ce qu'il dit.
 *
 * ─── LE FILTRE PAR CATÉGORIE MONTRE CE QU'IL CACHE ───
 *
 * Les compteurs des onglets portent sur TOUTES les décisions ouvertes,
 * pas sur celles que le filtre courant laisse voir. Un filtre qui
 * masque sans dire combien il masque fait rater ce qui compte.
 */
export default async function DecisionsPage({
  searchParams,
}: PageProps<"/oasis-ai/decisions">) {
  const organization = await requireOrganization();
  const params = await searchParams;

  const rawCategory = typeof params.categorie === "string" ? params.categorie : null;
  const category: DecisionCategory | undefined = isDecisionCategory(rawCategory)
    ? rawCategory
    : undefined;
  const scope = params.tout === "1" ? "all" : "open";

  const [board, catalog, conversationApprovals] = await Promise.all([
    getDecisionBoard(organization.organizationId, { scope, category }),
    getActionCatalog(),
    getConversationApprovals(organization.organizationId),
  ]);

  // Le droit d'écrire dans `ai_actions` et de répondre à une décision
  // (0072, section 14 : l'opérationnel suit le régime du chantier).
  const canAct = organization.permissions.includes("projects.manage");

  // §11V p. 25 — MON avis sur chacune des recommandations affichées.
  // Lu après le tableau, et seulement pour les décisions qui vont
  // s'afficher : une jointure sur toutes les décisions de l'entreprise
  // coûterait cher pour des lignes que le filtre écarte.
  const mesAvis = await lireMesAvis(
    organization.organizationId,
    board.items.map((item) => item.decision.id),
  );

  const index = catalogIndex(catalog.entries);
  const confirmMessages = await buildConfirmMessages(
    organization.organizationId,
    board.items.some((item) =>
      JSON.stringify(item.decision.available_actions ?? "").includes("createInvoiceDraft"),
    ),
  );

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Centre de décision"
        subtitle="Ce qu'Oasis a détecté, ce qu'il en conclut, et ce qu'il propose de faire. Rien ne part sans votre confirmation."
        action={
          <form action={runExecutiveScan}>
            <SubmitButton variant="secondary">Lancer l&apos;analyse</SubmitButton>
          </form>
        }
      />

      <OasisTabs current="/oasis-ai/decisions" openDecisions={board.openTotal} />

      {board.failed && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {board.failureReason}
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            Ce n&apos;est pas « aucune décision » : la liste n&apos;a pas pu être lue.
          </p>
        </Card>
      )}

      {!canAct && !board.failed && (
        <Card className="mb-6 border-info/30 bg-info-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] text-info">
            Vous consultez les décisions sans pouvoir y répondre : cela demande le droit
            de conduire les chantiers. Les explications, elles, restent utiles.
          </p>
        </Card>
      )}

      {/* ---- Le filtre par catégorie ---- */}
      <nav className="mb-6 flex flex-wrap gap-1.5" aria-label="Catégories">
        <FilterChip
          href="/oasis-ai/decisions"
          label="Toutes"
          count={board.openTotal}
          active={!category}
        />
        {DECISION_CATEGORIES.map((key) => (
          <FilterChip
            key={key}
            href={`/oasis-ai/decisions?categorie=${key}`}
            label={CATEGORY_LABELS[key]}
            count={board.openByCategory[key]}
            active={category === key}
          />
        ))}
      </nav>

      {/* ---- Ce qui vient de la conversation ----
          Ces demandes n'ont pas de décision derrière elles : elles
          naissent d'une phrase tapée dans l'assistant. Sans ce bloc,
          fermer l'onglet entre la question et le clic les rendait
          invisibles, et elles mouraient d'expiration au bout de
          vingt-quatre heures. */}
      {conversationApprovals.length > 0 && (
        <Panel
          title="Demandes venues de la conversation"
          description="Préparées par l'assistant, jamais exécutées. Elles expirent au bout de vingt-quatre heures."
          count={conversationApprovals.length}
          className="mb-6"
        >
          <ul className="divide-y divide-line">
            {conversationApprovals.map((approval) => (
              <ConversationApprovalRow
                key={approval.approvalId}
                approval={approval}
                label={index.get(approval.actionType)?.label ?? approval.actionType}
                canAct={canAct}
              />
            ))}
          </ul>
        </Panel>
      )}

      {board.items.length === 0 && !board.failed ? (
        <EmptyState
          title={
            category
              ? `Aucune décision « ${CATEGORY_LABELS[category].toLowerCase()} » ouverte.`
              : "Aucune décision en attente."
          }
          description={
            board.openTotal > 0
              ? "D'autres catégories en contiennent — les compteurs ci-dessus disent lesquelles."
              : "Lancez l'analyse : Oasis relit vos chantiers, vos devis et vos factures, et n'ouvre une décision que s'il a de quoi la justifier."
          }
          action={
            <form action={runExecutiveScan}>
              <SubmitButton>Lancer l&apos;analyse</SubmitButton>
            </form>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {board.items.map((item) => (
            <DecisionCard
              key={item.decision.id}
              item={item}
              catalog={index}
              canAct={canAct}
              confirmMessages={confirmMessages}
              monAvis={mesAvis.get(item.decision.id) ?? null}
            />
          ))}
        </div>
      )}

      <p className="mt-8 text-[11px] text-ink-faint">
        {scope === "all" ? (
          <Link href="/oasis-ai/decisions" className="text-accent hover:underline">
            Ne montrer que les décisions ouvertes
          </Link>
        ) : (
          <Link href="/oasis-ai/decisions?tout=1" className="text-accent hover:underline">
            Voir aussi les décisions déjà tranchées
          </Link>
        )}{" "}
        · Chaque geste — validation, refus, exécution — est consigné dans{" "}
        <Link href="/oasis-ai/historique" className="text-accent hover:underline">
          l&apos;historique
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Le texte des boîtes de confirmation (spec p. 9).
 *
 *     « Oasis souhaite : créer 10 factures.
 *       Montant total estimé : 38 450 € HT.
 *       8 factures semblent prêtes.
 *       2 nécessitent une vérification. »
 *
 * IL EST RELU MAINTENANT, PAS REPRIS DE LA DÉCISION. Entre l'ouverture
 * de la décision — hier peut-être — et ce clic, deux chantiers ont pu
 * être facturés à la main. Le chiffre montré doit être celui sur lequel
 * on va agir, et l'exécuteur relit la même source une troisième fois
 * avant d'écrire.
 */
async function buildConfirmMessages(
  organizationId: string,
  needsBilling: boolean,
): Promise<Map<string, string>> {
  const messages = new Map<string, string>();
  if (!needsBilling) return messages;

  const preview = await getBillingPreview(organizationId);
  if (preview.failed) {
    messages.set(
      "createInvoiceDraft",
      "Le décompte des dossiers à facturer n'a pas pu être relu. N'appliquez pas à l'aveugle : ouvrez d'abord les chantiers.",
    );
    return messages;
  }

  const lines = [
    `Oasis va créer ${preview.prets} brouillon(s) de facture.`,
    preview.montantPretHtCents === null
      ? "Montant total inconnu."
      : `Montant total estimé : ${formatCents(preview.montantPretHtCents)} HT.`,
    preview.aVerifier > 0
      ? `${preview.aVerifier} dossier(s) ne seront PAS facturés : ils demandent une vérification.`
      : "",
    preview.bloques > 0 ? `${preview.bloques} dossier(s) sont bloqués et écartés.` : "",
    preview.dossiersSansMontant > 0
      ? `${preview.dossiersSansMontant} dossier(s) sans montant connu.`
      : "",
    "Aucune facture ne sera émise ni envoyée : ce sont des brouillons, relisez-les.",
  ].filter(Boolean);

  messages.set("createInvoiceDraft", lines.join(" "));
  return messages;
}

/**
 * Une demande née de la conversation.
 *
 * Le formulaire ne porte QUE l'identifiant de l'approbation :
 * `answerApproval` relit l'action et son type sur la ligne, et
 * n'exécute que si `ai_answer_approval` a bien fait passer l'action à
 * « approuvée ».
 */
function ConversationApprovalRow({
  approval,
  label,
  canAct,
}: {
  approval: OrphanApproval;
  label: string;
  canAct: boolean;
}) {
  const parameters = (approval.parameters ?? {}) as Record<string, unknown>;
  const dossier = typeof parameters.libelle === "string" ? parameters.libelle : null;
  const client = typeof parameters.client === "string" ? parameters.client : null;
  const montant =
    typeof parameters.montantHtCents === "number" ? parameters.montantHtCents : null;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={RISK_TONES[approval.risk]}>{RISK_LABELS[approval.risk]}</Badge>
          <p className="text-[var(--text-body)] font-medium">{label}</p>
        </div>
        <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
          {dossier ?? "Dossier non nommé"}
          {client ? ` — ${client}` : ""}
          {/* Un tiret, jamais « 0 € » : un montant inconnu n'est pas un
              montant nul. */}
          {montant === null ? " — montant inconnu" : ` — ${formatCents(montant)} HT`}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          Expire le{" "}
          {new Date(approval.expiresAt).toLocaleString("fr-FR", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      </div>
      {canAct ? (
        <div className="flex flex-wrap gap-2">
          <form action={answerApproval}>
            <input type="hidden" name="approvalId" value={approval.approvalId} />
            <input type="hidden" name="ok" value="1" />
            <SubmitButton>Valider et exécuter</SubmitButton>
          </form>
          <form action={answerApproval}>
            <input type="hidden" name="approvalId" value={approval.approvalId} />
            <input type="hidden" name="ok" value="0" />
            <SubmitButton variant="secondary">Refuser</SubmitButton>
          </form>
        </div>
      ) : (
        <p className="text-[var(--text-secondary)] text-ink-faint">
          Votre rôle ne permet pas de répondre à une validation.
        </p>
      )}
    </li>
  );
}

function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-[var(--text-secondary)] transition-colors ${
        active
          ? "border-accent bg-accent-wash font-medium text-accent"
          : "border-line-strong bg-surface text-ink-soft hover:bg-canvas hover:text-ink"
      }`}
    >
      {label}
      {/* Un zéro s'affiche quand même sur un filtre : c'est là qu'il
          veut dire quelque chose — « inutile de cliquer ». */}
      <span className="tabular text-ink-faint">{count}</span>
    </Link>
  );
}

export const dynamic = "force-dynamic";
