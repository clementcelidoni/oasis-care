import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  Badge,
  EmptyState,
  InfoCard,
  PageHeader,
  Panel,
  PlanCard,
  SectionHeader,
  StatusBadge,
  type Tone,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  getAccountEntitlementSummary,
  getBillingProvider,
  type BillingProviderId,
  type SubscriptionStatus,
} from "@/lib/billing/provider";
import { CompanyTabs } from "../CompanyTabs";

/**
 * §15 ABONNEMENT — « Votre forfait / Oasis Care Pro », le plan actuel,
 * puis les forfaits à préparer.
 *
 * Cet écran a une contrainte que les autres n'ont pas : §"Si aucun
 * fournisseur de paiement web réel configuré : ne pas simuler une
 * transaction." Aucun encaissement n'est branché aujourd'hui. Un
 * bouton « Souscrire » qui n'encaisse rien ferait croire à un
 * changement de forfait, et le client découvrirait le contraire à la
 * facture suivante — ou à son absence.
 *
 * Le tunnel §"Choisir → Résumé → Paiement → Confirmation" est donc
 * ANNONCÉ, pas joué : on montre le catalogue, on dit ce qui manque, et
 * `BillingProvider` (§16) tient déjà l'interface que remplira le jour
 * venu un encaissement web ou un achat In-App.
 */

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: "Période d'essai",
  active: "Actif",
  pastDue: "Paiement en retard",
  cancelled: "Résilié",
};

const STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  trialing: "info",
  active: "positive",
  pastDue: "critical",
  cancelled: "neutral",
};

/**
 * Comment l'abonnement est payé. « Aucun » n'est pas une case vide :
 * c'est l'information la plus utile de l'écran aujourd'hui.
 */
const PROVIDER_LABEL: Record<BillingProviderId, string> = {
  none: "Aucun — rien n'est prélevé",
  web: "Paiement en ligne",
  apple: "Achat In-App (Apple)",
  manual: "Facturation manuelle",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatPrice(cents: number | null): string | undefined {
  if (cents === null) return undefined;
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} € / mois`;
}

/** §15 « Choisir → Résumé → Paiement → Confirmation ». */
const CHECKOUT_STEPS = [
  { label: "Choisir", detail: "Le catalogue ci-dessus." },
  { label: "Résumé", detail: "Ce que vous payez, et à partir de quand." },
  { label: "Paiement", detail: "L'étape qui manque." },
  { label: "Confirmation", detail: "Le forfait prend effet immédiatement." },
];

export default async function SubscriptionPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  // §16 — l'écran ne connaît aucun fournisseur en particulier ; il
  // demande celui qui est actif et se règle sur ce qu'il sait faire.
  const billing = getBillingProvider();
  const supabase = await createClient();

  const [plans, subscription, entitlements, { data: memberCount }] = await Promise.all([
    billing.listPlans(),
    billing.getSubscription(organization.organizationId),
    getAccountEntitlementSummary(organization.workspaceId),
    supabase.rpc("organization_employee_count", {
      p_organization_id: organization.organizationId,
    }),
  ]);

  // Un forfait désactivé après souscription disparaît du catalogue mais
  // reste celui de l'entreprise : on garde alors sa clé brute plutôt que
  // d'afficher « aucun forfait » à quelqu'un qui en a bien un.
  const currentPlan = subscription ? plans.find((plan) => plan.key === subscription.planKey) : undefined;
  const currentPlanName = currentPlan?.name ?? subscription?.planKey ?? null;

  // Le plafond d'utilisateurs du forfait en cours, quand il en a un.
  // Le comparer à l'effectif réel est la seule alerte que cet écran
  // puisse donner honnêtement aujourd'hui : elle repose sur deux
  // chiffres qui existent tous les deux en base.
  const members = (memberCount as number | null) ?? 0;
  const maxUsers = currentPlan?.maxUsers ?? null;
  const overCapacity = maxUsers !== null && members > maxUsers;

  // §9 : aucun tarif n'est enregistré pour l'instant. On le dit une fois,
  // au-dessus des cartes, plutôt que d'écrire quatre fois « — € ».
  const noPrices = plans.length > 0 && plans.every((plan) => plan.monthlyPriceCents === null);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Care Pro"
        title="Votre forfait"
        subtitle="Ce que couvre votre abonnement, et les forfaits prévus pour la suite."
        action={
          subscription ? (
            <StatusBadge tone={STATUS_TONE[subscription.status]}>
              {STATUS_LABEL[subscription.status]}
            </StatusBadge>
          ) : (
            <Badge tone="neutral">Aucun abonnement</Badge>
          )
        }
      />

      <CompanyTabs current="/entreprise/abonnement" />

      {/* ---------- Plan actuel ---------- */}
      <Panel
        title="Plan actuel"
        description="L'abonnement enregistré pour cette entreprise."
        className="mb-4"
      >
        {subscription ? (
          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
            <InfoCard
              label="Forfait"
              value={currentPlanName}
              hint={currentPlan?.tagline ?? undefined}
              badge={
                overCapacity
                  ? { label: "Plafond dépassé", tone: "warning" }
                  : undefined
              }
            />
            <InfoCard
              label="Statut"
              value={STATUS_LABEL[subscription.status]}
              hint={
                subscription.cancelledAt
                  ? `Résilié le ${formatDate(subscription.cancelledAt)}.`
                  : `Depuis le ${formatDate(subscription.startedAt)}.`
              }
            />
            <InfoCard
              label="Utilisateurs"
              value={members === 1 ? "1 utilisateur" : `${members} utilisateurs`}
              hint={
                maxUsers === null
                  ? "Aucun plafond sur ce forfait."
                  : overCapacity
                    ? `Ce forfait en prévoit ${maxUsers}.`
                    : `Jusqu'à ${maxUsers} sur ce forfait.`
              }
            />
            <InfoCard
              label="Mode de facturation"
              value={PROVIDER_LABEL[subscription.provider]}
              hint={
                subscription.currentPeriodEnd
                  ? `Période en cours jusqu'au ${formatDate(subscription.currentPeriodEnd)}.`
                  : "Aucune échéance enregistrée."
              }
            />
          </div>
        ) : (
          /* §32 — pas de ligne d'abonnement, et c'est un état normal :
             le produit n'a encore encaissé personne. On l'écrit, plutôt
             que de laisser un panneau vide qui ressemble à une panne. */
          <div className="px-5 py-5">
            <p className="text-[var(--text-body)] text-ink-soft">
              Aucun abonnement n&apos;est enregistré pour{" "}
              <span className="font-medium text-ink">{organization.name}</span>. Rien
              n&apos;est prélevé et aucune fonctionnalité n&apos;est bridée : la ligne
              d&apos;abonnement sera créée le jour où un forfait sera souscrit.
            </p>
          </div>
        )}
      </Panel>

      {/* ---------- Les forfaits ---------- */}
      <div className="mt-8">
        <SectionHeader
          title="Les forfaits"
          description={
            noPrices
              ? "Les tarifs ne sont pas encore fixés : aucun montant n'est enregistré pour ces forfaits."
              : "Ce que couvre chaque forfait."
          }
        />

        {plans.length === 0 ? (
          /* §32 — un catalogue vide veut dire que la table
             `organization_plans` n'a pas été alimentée. Inventer quatre
             cartes ici ferait exactement ce que §"Noms configurables"
             interdit. */
          <EmptyState
            icon={<Icon name="subscription" className="h-6 w-6" />}
            title="Aucun forfait publié pour le moment"
            description="Les forfaits d'Oasis Care Pro sont enregistrés en base pour pouvoir être renommés sans mise à jour de l'application. Aucun n'est actif actuellement."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((plan) => (
              <PlanCard
                key={plan.key}
                name={plan.name}
                tagline={plan.tagline ?? undefined}
                features={plan.features}
                price={formatPrice(plan.monthlyPriceCents)}
                current={plan.key === subscription?.planKey}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---------- §15 le tunnel, annoncé et non joué ---------- */}
      {plans.length > 0 && (
        <Panel
          title="Changer de forfait"
          description="Comment cela se passera."
          className="mt-8"
        >
          <ol className="flex flex-col gap-3 px-5 py-5">
            {CHECKOUT_STEPS.map((step, index) => (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[var(--text-secondary)] font-medium text-ink-soft"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[var(--text-body)] font-medium">{step.label}</span>
                  <span className="block text-[var(--text-secondary)] text-ink-soft">
                    {step.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          {/* §16 — la phrase vient du fournisseur, pas de cet écran :
              le jour où un encaissement existe, elle disparaît toute
              seule et les boutons prennent sa place. */}
          {billing.unavailableReason && (
            <div className="border-t border-line px-5 py-4">
              <p className="text-[var(--text-body)] text-ink-soft">
                {billing.unavailableReason}
              </p>
              <p className="mt-1.5 text-[var(--text-secondary)] text-ink-faint">
                Aucun bouton de souscription n&apos;est affiché tant que le paiement
                n&apos;aboutit pas réellement — mieux vaut un écran qui ne propose rien
                qu&apos;un écran qui confirme une transaction qui n&apos;a pas eu lieu.
              </p>
            </div>
          )}
        </Panel>
      )}

      {/* ---------- §16 les entitlements de la Phase 12 ---------- */}
      <Panel
        title="Votre abonnement sur l'app iPhone"
        description="Les droits validés par Apple pour votre compte."
        className="mt-8"
      >
        <div className="px-5 py-5">
          {entitlements ? (
            <>
              <p className="text-[var(--text-body)]">
                <span className="font-medium">{entitlements.plans.join(", ")}</span> —{" "}
                {entitlements.count === 1
                  ? "1 droit accordé"
                  : `${entitlements.count} droits accordés`}
                {entitlements.expiresAt
                  ? `, jusqu'au ${formatDate(entitlements.expiresAt)}.`
                  : ", sans échéance enregistrée."}
              </p>
              <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
                Cet abonnement-là couvre l&apos;application Oasis Care sur votre iPhone. Il
                est rattaché à votre compte Apple, pas à l&apos;entreprise, et il ne
                remplace pas un forfait Oasis Care Pro.
              </p>
            </>
          ) : (
            <p className="text-[var(--text-body)] text-ink-soft">
              Aucun droit n&apos;est enregistré pour votre compte sur l&apos;application
              iPhone. Un abonnement souscrit depuis l&apos;App Store apparaîtrait ici — il
              reste distinct du forfait de l&apos;entreprise.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
