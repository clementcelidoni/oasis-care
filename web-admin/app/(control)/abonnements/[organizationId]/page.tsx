import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  InfoCard,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  UnknownValue,
  type Column,
} from "@/components/ui";
import {
  LIBELLES_CYCLE,
  LIBELLES_FOURNISSEUR,
  LIBELLES_STATUT,
  TONS_STATUT,
  etatAbonnement,
  joursRestants,
  libelleEvenement,
  prixContractuel,
  remiseEnCours,
} from "@/lib/billing/abonnement";
import { EcranCommercialFerme } from "@/lib/billing/ecran-ferme";
import { LIBELLES_REGIME_TVA } from "@/lib/billing/facture";
import { peut, requireCommercial } from "@/lib/billing/guard";
import {
  LIBELLES_DISPONIBILITE,
  TONS_DISPONIBILITE,
  cleDeCase,
  indexerMatrice,
  prixDOffre,
} from "@/lib/billing/grille";
import { diagnostiquerSocleCommercial } from "@/lib/billing/socle";
import {
  lireAbonnement,
  lireCredits,
  lireHistoriqueAbonnement,
  lireMatrice,
  lireModules,
  lireModulesSouscrits,
  lireOffres,
  lireOffresDeRemise,
  lireRegimeTva,
  lireRemises,
  listerFactures,
  trouverEntreprise,
} from "@/lib/billing/source";
import type { LigneEvenementAbonnement, LigneRemise } from "@/lib/billing/types";
import { formatCents, formatCount, formatDate, formatDateTime } from "@/lib/format";

import { ActionsAbonnement } from "./actions-abonnement";

/**
 * ==================================================================
 * LA FICHE D'UN ABONNEMENT — spec p.12-13
 * ==================================================================
 *
 * Ce que la spec demande sur cette page : offre, prix, cycle, dates,
 * statut, essai, sièges, modules, entitlements, fournisseur de
 * paiement — et les gestes d'administration.
 *
 * ------------------------------------------------------------------
 * « ENTITLEMENTS » : ON N'EN CRÉE PAS UN TROISIÈME MOTEUR
 * ------------------------------------------------------------------
 * La spec p.14 est formelle : « utiliser la couche d'entitlements
 * existante, ne pas créer un troisième moteur de permissions
 * commerciales ». Côté Pro, un entitlement EST un module : la couche
 * existante est `plan_modules` (ce que l'offre accorde) et
 * `organization_subscription_modules` (ce que l'entreprise a souscrit).
 * C'est ce que le panneau « Modules » montre, et rien d'autre.
 *
 * Côté MOBILE, `subscription_entitlements` est alimentée par le webhook
 * Apple. Elle n'apparaît PAS ici, et elle ne s'administre pas : la
 * modifier à la main désynchroniserait le droit de ce qu'Apple a
 * réellement encaissé. Les deux canaux restent séparés, y compris à
 * l'écran — un total qui les mélangerait serait faux, l'un étant net de
 * la commission Apple et l'autre non.
 *
 * ------------------------------------------------------------------
 * LE PRIX AFFICHÉ N'EST PAS UN TOTAL DE FACTURE
 * ------------------------------------------------------------------
 * « Ce client paie tant par mois » est une lecture. Le montant d'une
 * facture est calculé par la BASE, TVA groupée par taux, et il ne se
 * recalcule jamais dans le navigateur : deux arrondis valent deux
 * montants, et c'est un document comptable.
 */

export const metadata: Metadata = {
  title: "Abonnement — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function FicheAbonnementPage({
  params,
}: PageProps<"/abonnements/[organizationId]">) {
  const { organizationId } = await params;

  const admin = await requireCommercial("billing.subscriptions.read");
  const socle = await diagnostiquerSocleCommercial(
    admin.permissions,
    "billing.subscriptions.read",
  );

  if (socle.etat !== "ok") {
    return (
      <EcranCommercialFerme
        etat={socle.etat}
        requise="billing.subscriptions.read"
        titre="Abonnement"
      />
    );
  }

  const entreprise = await trouverEntreprise(organizationId);
  if (entreprise === null) notFound();

  let donnees: {
    abonnement: Awaited<ReturnType<typeof lireAbonnement>>;
    offres: Awaited<ReturnType<typeof lireOffres>>;
    modules: Awaited<ReturnType<typeof lireModules>>;
    matrice: Awaited<ReturnType<typeof lireMatrice>>;
    souscrits: Awaited<ReturnType<typeof lireModulesSouscrits>>;
    remises: LigneRemise[];
    credits: Awaited<ReturnType<typeof lireCredits>>;
    historique: LigneEvenementAbonnement[];
    offresDeRemise: Awaited<ReturnType<typeof lireOffresDeRemise>>;
    factures: Awaited<ReturnType<typeof listerFactures>>;
  };
  try {
    const [
      abonnement,
      offres,
      modules,
      matrice,
      souscrits,
      remises,
      credits,
      historique,
      offresDeRemise,
      factures,
    ] = await Promise.all([
      lireAbonnement(organizationId),
      lireOffres(),
      lireModules(),
      lireMatrice(),
      lireModulesSouscrits(organizationId),
      lireRemises(organizationId),
      lireCredits(organizationId),
      lireHistoriqueAbonnement(organizationId),
      lireOffresDeRemise(),
      listerFactures({ organizationId, limite: 24 }),
    ]);
    donnees = {
      abonnement,
      offres,
      modules,
      matrice,
      souscrits,
      remises,
      credits,
      historique,
      offresDeRemise,
      factures,
    };
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Commercial"
          title={entreprise.nom}
          breadcrumb={{ label: "Abonnements", href: "/abonnements" }}
        />
        <ReadFailure error={error} />
      </>
    );
  }

  // Le régime de TVA est lu à part : un rôle qui lit les abonnements
  // sans lire les factures n'y a pas droit, et cela ne doit pas
  // emporter la page.
  let regime: Awaited<ReturnType<typeof lireRegimeTva>> = null;
  if (peut(admin, "billing.invoices.read")) {
    try {
      regime = await lireRegimeTva(organizationId);
    } catch {
      regime = null;
    }
  }

  const {
    abonnement,
    offres,
    modules,
    matrice,
    souscrits,
    remises,
    credits,
    historique,
    offresDeRemise,
    factures: lectureFactures,
  } = donnees;

  // Cette fiche montre les 24 dernières factures de l'entreprise. Le
  // compte exact vient avec, et sert à dire « et il y en a d'autres »
  // plutôt qu'à laisser croire que la liste est complète.
  const factures = lectureFactures.factures;
  const facturesTotal = lectureFactures.total;
  const facturesTronquees = lectureFactures.tronquee;

  // LE CAS QUI N'EST PAS UN VIDE. Si `admin_list_organizations` rend un
  // forfait pour cette entreprise et que la ligne n'est pas lisible,
  // c'est la politique de lecture qui manque — pas l'abonnement.
  if (abonnement === null && entreprise.plan !== null) {
    return (
      <>
        <PageHeader
          eyebrow="Commercial"
          title={entreprise.nom}
          breadcrumb={{ label: "Abonnements", href: "/abonnements" }}
        />
        <EmptyState
          tone="unknown"
          title="Cet abonnement existe et ne vous est pas lisible"
          description={
            `La fonction d'administration rapporte le forfait « ${entreprise.plan} » pour cette entreprise, ` +
            "mais la ligne d'abonnement ne vous est pas rendue. Ce n'est pas une absence : c'est un " +
            "refus silencieux, et l'écart est mesuré plutôt que subi. La lecture passe par la " +
            "politique « Les habilités lisent les abonnements » (billing.subscriptions.read) posée " +
            "par 0081 : si vous voyez ce message, ou bien la migration n'est pas appliquée, ou bien " +
            "votre rôle a perdu cette permission."
          }
          action={
            <ButtonLink href="/abonnements" variant="secondary">
              Retour à la liste
            </ButtonLink>
          }
        />
      </>
    );
  }

  if (abonnement === null) {
    return (
      <>
        <PageHeader
          eyebrow="Commercial"
          title={entreprise.nom}
          breadcrumb={{ label: "Abonnements", href: "/abonnements" }}
        />
        <EmptyState
          title="Aucun abonnement pour cette entreprise"
          description="Rien ne crée d'abonnement automatiquement : le paiement en ligne n'est pas branché. Le premier se crée à la main depuis la liste."
          action={
            <ButtonLink href="/abonnements" variant="secondary">
              Créer un abonnement
            </ButtonLink>
          }
        />
      </>
    );
  }

  const offre = offres.find((candidate) => candidate.key === abonnement.plan);
  const index = indexerMatrice(matrice);
  const maintenant = new Date();
  const etat = etatAbonnement(abonnement, maintenant);
  const remise = remiseEnCours(remises, maintenant);

  const prixGrille = offre === undefined ? null : prixDOffre(offre, abonnement.billing_cycle);
  const prix = prixContractuel(
    abonnement,
    prixGrille !== null && prixGrille.etat === "public" ? prixGrille.cents : null,
    offre?.is_quote_only === true,
    remise,
  );

  const souscritsActifs = souscrits.filter((module) => module.cancelled_at === null);
  const creditsOuverts = credits.filter(
    (credit) => credit.consumed_at === null && credit.cancelled_at === null,
  );

  const colonnesHistorique: Column<LigneEvenementAbonnement>[] = [
    {
      key: "quand",
      header: "Quand",
      cell: (ligne) => formatDateTime(ligne.occurred_at) ?? "—",
    },
    {
      key: "quoi",
      header: "Événement",
      cell: (ligne) => libelleEvenement(ligne.event),
    },
    {
      key: "offre",
      header: "Offre",
      secondary: true,
      cell: (ligne) =>
        ligne.plan_before === ligne.plan_after
          ? (ligne.plan_after ?? "—")
          : `${ligne.plan_before ?? "—"} → ${ligne.plan_after ?? "—"}`,
    },
    {
      key: "motif",
      header: "Motif",
      cell: (ligne) => ligne.reason ?? <UnknownValue compact reason="Aucun motif enregistré." />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Abonnement"
        title={entreprise.nom}
        subtitle={
          offre === undefined
            ? `Offre « ${abonnement.plan} », inconnue de la grille.`
            : (offre.tagline ?? undefined)
        }
        breadcrumb={{ label: "Abonnements", href: "/abonnements" }}
        action={
          <ButtonLink href={`/organisations/${organizationId}`} variant="secondary">
            Fiche entreprise
          </ButtonLink>
        }
      />

      {abonnement.provider === "manual" && (
        <Notice tone="info" title="Abonnement saisi à la main">
          Aucun encaissement n&apos;est branché : cette ligne existe parce qu&apos;un administrateur
          l&apos;a écrite. Elle ne prélève rien et ne se renouvelle pas toute seule ; la facturation
          se déclenche depuis l&apos;écran des factures.
        </Notice>
      )}

      {etat.etat === "partALEcheance" && (
        <Notice tone="warning" title="Ce client part à l'échéance">
          Le statut vaut encore « {LIBELLES_STATUT[abonnement.status]} », et c&apos;est normal : le
          client a payé sa période et en garde l&apos;usage jusqu&apos;au bout.
          {etat.finLe !== null && ` L'échéance est le ${formatDate(etat.finLe)}.`}
          {etat.decideLe !== null && ` La décision date du ${formatDate(etat.decideLe)}.`}
        </Notice>
      )}

      {etat.etat === "essai" && etat.expire && (
        <Notice tone="warning" title="L'essai est terminé et le statut n'a pas bougé">
          Aucun traitement planifié ne fait basculer un essai en base : la ligne restera
          « en essai » tant qu&apos;un administrateur ne la changera pas. Ce compte n&apos;est ni
          facturé, ni fermé.
        </Notice>
      )}

      {/* ------------------------------------------------------------
          L'ESSENTIEL
          ------------------------------------------------------------ */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          label="Offre"
          value={offre?.name ?? abonnement.plan}
          hint={offre?.is_quote_only ? "Sur devis : le prix est négocié." : undefined}
          badge={
            offre?.badge === "bestSeller" ? { label: "Best-seller", tone: "accent" } : undefined
          }
        />
        <InfoCard
          label="Statut"
          value={
            <StatusBadge tone={TONS_STATUT[abonnement.status]}>
              {LIBELLES_STATUT[abonnement.status]}
            </StatusBadge>
          }
          hint={abonnement.cancel_at_period_end ? "Annulation à l'échéance en cours." : undefined}
        />
        <InfoCard label="Cycle" value={LIBELLES_CYCLE[abonnement.billing_cycle]} />
        <InfoCard
          label="Prix contractuel"
          value={
            prix.etat === "prix" ? (
              <span className="tabular">
                {formatCents(prix.cents, { decimals: true })}
                <span className="text-[var(--text-secondary)] font-normal text-ink-soft">
                  {abonnement.billing_cycle === "yearly" ? " / an" : " / mois"}
                </span>
              </span>
            ) : (
              <UnknownValue reason={prix.raison} />
            )
          }
          hint={
            prix.etat === "prix" && prix.remise !== null
              ? `Remise « ${prix.remise.label} » jusqu'au ${formatDate(prix.remise.finLe)}.`
              : "Hors modules, sièges et crédits — ce n'est pas un total de facture."
          }
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          label="Début"
          value={formatDate(abonnement.started_at) ?? <UnknownValue compact />}
        />
        <InfoCard
          label="Fin de période"
          value={
            formatDate(abonnement.current_period_end) ?? (
              <UnknownValue
                reason="Aucune fin de période n'est enregistrée : rien ne la pose tant qu'aucun encaissement n'est branché."
                compact
              />
            )
          }
        />
        <InfoCard
          label="Fin d'essai"
          value={
            abonnement.trial_ends_at === null ? (
              <span className="text-ink-soft">Aucun essai</span>
            ) : (
              <span>
                {formatDate(abonnement.trial_ends_at)}
                {(() => {
                  const jours = joursRestants(abonnement.trial_ends_at, maintenant);
                  if (jours === null) return null;
                  return (
                    <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-soft">
                      {jours >= 0 ? `dans ${jours} j` : `il y a ${-jours} j`}
                    </span>
                  );
                })()}
              </span>
            )
          }
        />
        <InfoCard
          label="Origine"
          value={LIBELLES_FOURNISSEUR[abonnement.provider]}
          hint={`Sièges facturés en plus : ${formatCount(abonnement.billable_extra_seats)}. Saisis, jamais comptés depuis les membres.`}
        />
      </div>

      {/* ------------------------------------------------------------
          LES MODULES — la couche d'entitlements existante
          ------------------------------------------------------------ */}
      <Panel
        className="mb-6"
        title="Modules souscrits"
        description="C'est la couche d'entitlements côté Pro, et il n'en existe pas d'autre. Les droits mobiles viennent d'Apple et ne s'administrent pas ici."
        count={souscritsActifs.length}
      >
        {modules.length === 0 ? (
          <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
            Aucun module au catalogue.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {modules.map((module) => {
              const souscrit = souscrits.find((s) => s.module_key === module.key);
              const actif = souscrit !== undefined && souscrit.cancelled_at === null;
              const disponibilite =
                index.get(cleDeCase(abonnement.plan, module.key))?.availability ?? "undecided";
              const ligneCase = index.get(cleDeCase(abonnement.plan, module.key));
              const prixModule =
                abonnement.billing_cycle === "yearly"
                  ? (ligneCase?.yearly_price_cents ?? null)
                  : (ligneCase?.monthly_price_cents ?? null);

              return (
                <li
                  key={module.key}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                >
                  <span className="min-w-40 font-medium text-ink">{module.name}</span>
                  <StatusBadge tone={TONS_DISPONIBILITE[disponibilite]}>
                    {LIBELLES_DISPONIBILITE[disponibilite]}
                  </StatusBadge>
                  {actif ? (
                    <Badge tone="positive">Souscrit</Badge>
                  ) : (
                    <span className="text-[var(--text-secondary)] text-ink-faint">
                      non souscrit
                    </span>
                  )}
                  {!module.is_delivered && <Badge tone="neutral">Annoncé, non livré</Badge>}
                  <span className="tabular ml-auto text-[var(--text-secondary)] text-ink-soft">
                    {disponibilite === "included"
                      ? "compris — 0 €"
                      : disponibilite === "optional"
                        ? (formatCents(prixModule, { decimals: true }) ?? "prix inconnu")
                        : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Le prix affiché vient de la case de l&apos;offre en cours, jamais de la ligne
          d&apos;abonnement. C&apos;est ce qui fait qu&apos;un passage vers une offre qui comprend
          le module cesse de le facturer, sans qu&apos;on touche à quoi que ce soit.
        </p>
      </Panel>

      {/* ------------------------------------------------------------
          REMISES, CRÉDITS, TVA
          ------------------------------------------------------------ */}
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Panel title="Remises" count={remises.length}>
          {remises.length === 0 ? (
            <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
              Aucune remise accordée.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {remises.map((ligne) => {
                const jours = joursRestants(ligne.ends_on, maintenant);
                const active = ligne.cancelled_at === null && ligne === remise;
                return (
                  <li key={ligne.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{ligne.label}</span>
                      {active && <Badge tone="positive">En cours</Badge>}
                      {ligne.cancelled_at !== null && <Badge tone="neutral">Annulée</Badge>}
                    </div>
                    <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                      Du {formatDate(ligne.starts_on)} au {formatDate(ligne.ends_on)}
                      {active && jours !== null && jours >= 0 && ` — tombe dans ${jours} jours`}
                    </p>
                    <p className="mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                      {ligne.reason}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Toute remise a une fin, et le client la voit : c&apos;est la contrepartie de la décision
            d&apos;écarter le tarif à vie. Une remise perpétuelle sur un abonnement récurrent est
            une dette que rien ne corrige.
          </p>
        </Panel>

        <Panel title="Crédits" count={credits.length}>
          {credits.length === 0 ? (
            <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
              Aucun crédit accordé.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {credits.map((credit) => (
                <li key={credit.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5">
                  <span className="tabular font-medium text-ink">
                    {formatCents(credit.amount_cents, { decimals: true })}
                  </span>
                  {credit.consumed_at !== null ? (
                    <Badge tone="neutral">Consommé</Badge>
                  ) : credit.cancelled_at !== null ? (
                    <Badge tone="neutral">Annulé</Badge>
                  ) : (
                    <Badge tone="positive">Ouvert</Badge>
                  )}
                  <span className="text-[var(--text-secondary)] text-ink-soft">
                    {credit.reason}
                  </span>
                  <span className="ml-auto text-[var(--text-secondary)] text-ink-faint">
                    {formatDate(credit.granted_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            {creditsOuverts.length === 0
              ? "Aucun crédit ouvert : la prochaine facture ne sera pas réduite."
              : `${creditsOuverts.length} crédit(s) ouvert(s) seront consommés, une seule fois, sur la prochaine facture générée.`}
          </p>
        </Panel>
      </div>

      {/* ------------------------------------------------------------
          LA TVA
          ------------------------------------------------------------ */}
      <Card className="mb-6 p-4">
        <p className="eyebrow">Régime de TVA</p>
        {regime === null ? (
          <div className="mt-2">
            <UnknownValue
              reason={
                peut(admin, "billing.invoices.read")
                  ? "Le régime n'a pas pu être lu."
                  : "Ce rôle ne porte pas billing.invoices.read : le régime de TVA d'un client ne lui est pas ouvert."
              }
            />
          </div>
        ) : regime.regime === "unknown" ? (
          <div className="mt-2">
            <UnknownValue label="Inconnu — l'émission est bloquée" reason={regime.reason} />
          </div>
        ) : (
          <p className="mt-2 text-[length:var(--text-card)] font-medium text-ink">
            {LIBELLES_REGIME_TVA[regime.regime]}
            <span className="tabular ml-2 text-[var(--text-secondary)] font-normal text-ink-soft">
              {regime.rate === null ? "taux inconnu" : `${regime.rate} %`}
            </span>
          </p>
        )}
        <p className="mt-2 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Pays : {entreprise.pays ?? "non renseigné"} · SIRET :{" "}
          {entreprise.siret ?? "non renseigné"}. Le taux n&apos;est jamais codé en dur : il se lit
          en base, et un cas qu&apos;on ne sait pas trancher rend INCONNU et bloque l&apos;émission
          plutôt que de supposer 20 % ou 0 %.
        </p>
      </Card>

      {/* ------------------------------------------------------------
          LES GESTES
          ------------------------------------------------------------ */}
      <Panel
        className="mb-6"
        title="Administrer cet abonnement"
        description="Huit gestes, chacun avec son motif, chacun tracé dans le journal administratif ET dans l'historique de l'abonnement, dans la même transaction."
      >
        <ActionsAbonnement
          abonnement={abonnement}
          offres={offres}
          modules={modules}
          matrice={matrice}
          modulesSouscrits={souscrits}
          offresDeRemise={offresDeRemise}
          regime={regime}
          peutEcrireAbonnement={peut(admin, "billing.subscriptions.write")}
          peutEcrirePrix={peut(admin, "billing.plans.write")}
          peutEcrireFacture={peut(admin, "billing.invoices.write")}
          role={admin.role}
        />
      </Panel>

      {/* ------------------------------------------------------------
          LES FACTURES DE CETTE ENTREPRISE
          ------------------------------------------------------------ */}
      {peut(admin, "billing.invoices.read") && (
        <Panel
          className="mb-6"
          title="Factures d'abonnement"
          count={facturesTotal}
          description={
            facturesTronquees
              ? `Les ${factures.length} plus récentes sur ${facturesTotal}.`
              : undefined
          }
          action={
            <ButtonLink href="/abonnements/factures" variant="ghost">
              Toutes les factures
            </ButtonLink>
          }
        >
          {factures.length === 0 ? (
            <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
              Aucune facture pour cette entreprise. Les factures se produisent par période depuis
              l&apos;écran « Factures SaaS » ; rien ne les déclenche automatiquement.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {factures.map((facture) => (
                <li key={facture.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <Link
                    href={`/abonnements/factures/${facture.id}`}
                    className="font-medium hover:text-accent"
                  >
                    {facture.number ?? "Brouillon sans numéro"}
                  </Link>
                  <span className="text-[var(--text-secondary)] text-ink-soft">
                    {formatDate(facture.period_start)} → {formatDate(facture.period_end)}
                  </span>
                  <span className="tabular ml-auto">
                    {facture.etat?.total_including_vat_cents === null ||
                    facture.etat === null ? (
                      <UnknownValue compact reason="Au moins un taux de TVA manque : le total est inconnu." />
                    ) : (
                      formatCents(facture.etat.total_including_vat_cents, { decimals: true })
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* ------------------------------------------------------------
          L'HISTORIQUE
          ------------------------------------------------------------ */}
      <Panel
        title="Historique de l'abonnement"
        description="En ajout seul. C'est cette table qui rendra le churn calculable un jour : la ligne d'abonnement, elle, n'en garde aucune trace — sa clé primaire est l'entreprise."
        count={historique.length}
      >
        <DataTable
          columns={colonnesHistorique}
          rows={historique}
          rowKey={(ligne) => ligne.id}
          empty={
            <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
              Aucun événement. Ce vide est exact et se remplira au premier geste administratif :
              chaque action de cette page y écrit une ligne.
            </p>
          }
        />
      </Panel>
    </>
  );
}
