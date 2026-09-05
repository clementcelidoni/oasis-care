import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  Card,
  MetricCard,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  UnknownValue,
} from "@/components/ui";
import { peut, requireCommercial } from "@/lib/billing/guard";
import { EcranCommercialFerme } from "@/lib/billing/ecran-ferme";
import {
  LIBELLES_DISPONIBILITE,
  TONS_DISPONIBILITE,
  cleDeCase,
  compterCasesIndecises,
  decisionsEnAttente,
  disponibiliteDe,
  economieAnnuelle,
  fonctionnalites,
  indexerMatrice,
  prixDOffre,
} from "@/lib/billing/grille";
import { diagnostiquerSocleCommercial } from "@/lib/billing/socle";
import {
  lireMatrice,
  lireModules,
  lireOffres,
  lireOffresDeRemise,
} from "@/lib/billing/source";
import type { LigneCase, LigneModule, LigneOffre, LigneOffreDeRemise } from "@/lib/billing/types";
import { readPlatformKpis } from "@/lib/dashboard/source";
import type { PlatformKpisRow } from "@/lib/dashboard/types";
import { formatCents, formatCount, formatDateTime } from "@/lib/format";

import { EditeurGrille } from "./editeur-grille";
import { EditeurMatrice } from "./editeur-matrice";

/**
 * ==================================================================
 * PLANS ET PRIX — spec p.13-14
 * ==================================================================
 *
 * C'EST L'ÉCRAN QUI DÉBLOQUE LES AUTRES, et pas par ordre de
 * préférence : par mécanique.
 *
 * Les quatre forfaits de `organization_plans` avaient
 * `monthly_price_cents` à NULL, et deux garde-fous de 0075 en
 * découlaient — le MRR rendait `null` parce qu'« au moins un forfait
 * actif n'a pas de prix », l'ARR par dérivation. Poser les prix ici
 * éteint la première moitié de la cause. La seconde est un abonnement
 * en cours, et elle appartient à l'écran voisin : le panneau « ce que
 * les prix débloquent » ci-dessous le montre en direct plutôt que de le
 * promettre.
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN CHANGE EN DEHORS DE LUI-MÊME
 * ------------------------------------------------------------------
 * `web-pro` lit `organization_plans` et l'affiche aux entreprises
 * clientes (`lib/billing/provider.ts`, filtre `is_active`). Écrire un
 * prix ici change, À LA SECONDE, ce qu'une entreprise Pro voit sur son
 * écran d'abonnement. Ce n'est pas une console de préparation : c'est
 * la vitrine.
 *
 * CE QU'IL NE CHANGE PAS : les factures. `saas_invoice_lines` porte sa
 * propre description et son propre prix unitaire, et le total se
 * calcule sur ces lignes. Aucune jointure vers `organization_plans`
 * n'intervient après la génération — un prix changé aujourd'hui ne
 * remonte donc dans aucune facture d'hier, ni même dans un brouillon
 * déjà produit.
 *
 * ------------------------------------------------------------------
 * LA MATRICE, ET POURQUOI ELLE N'EST PAS UNE LISTE
 * ------------------------------------------------------------------
 * « BioLab et Pépinière inclus dans Business, et à 20 € de plus dans
 * Pro. » Un même module est donc COMPRIS dans une offre et PAYANT dans
 * une autre. Une liste plate `module → prix` ne saurait jamais le dire.
 * D'où la matrice, dont chaque case vaut « compris », « en option à tel
 * prix », « indisponible » — ou « non décidé », qui est une réponse et
 * non une case vide, et qui BLOQUE.
 *
 * Et le rappel qui prime sur tout : LE JARDIN CONNECTÉ N'EST PAS UN
 * MODULE. Capteurs, automatisations, jumeau numérique, IA du jardin :
 * tout est dans Pro, entier. Il n'apparaît donc nulle part dans cette
 * matrice, et l'y faire entrer serait l'inverse exact de la stratégie.
 */

export const metadata: Metadata = {
  title: "Plans et prix — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const admin = await requireCommercial("billing.plans.read");
  const socle = await diagnostiquerSocleCommercial(admin.permissions, "billing.plans.read");

  if (socle.etat !== "ok") {
    return (
      <EcranCommercialFerme
        etat={socle.etat}
        requise="billing.plans.read"
        titre="Plans et prix"
        sousTitre="La grille tarifaire d'Oasis Care Pro, et la matrice offre × module."
      />
    );
  }

  let offres: LigneOffre[];
  let modules: LigneModule[];
  let matrice: LigneCase[];
  let remises: LigneOffreDeRemise[];
  try {
    [offres, modules, matrice, remises] = await Promise.all([
      lireOffres(),
      lireModules(),
      lireMatrice(),
      lireOffresDeRemise(),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Commercial" title="Plans et prix" />
        <ReadFailure error={error} />
      </>
    );
  }

  // Le tableau de bord est lu SANS faire échouer la page : un rôle qui
  // porte `billing.plans.read` sans `platform.dashboard.read` doit voir
  // sa grille. Le panneau « ce que les prix débloquent » disparaît
  // alors, et c'est la bonne dégradation.
  let kpis: PlatformKpisRow | null = null;
  try {
    kpis = await readPlatformKpis();
  } catch {
    kpis = null;
  }

  const peutEcrire = peut(admin, "billing.plans.write");
  const index = indexerMatrice(matrice);
  const decisions = decisionsEnAttente(offres, modules, matrice);
  const indecises = compterCasesIndecises(matrice);
  const actives = offres.filter((offre) => offre.is_active);
  const modulesLivres = modules.filter((module) => module.is_delivered);

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="Plans et prix"
        subtitle="La grille d'Oasis Care Pro. Ce qui est écrit ici est ce que voient les entreprises clientes sur leur écran d'abonnement, à la seconde."
        action={
          <ButtonLink href="/abonnements" variant="secondary">
            Abonnements
          </ButtonLink>
        }
      />

      <Notice tone="warning" title="Cet écran est la vitrine, pas un brouillon">
        Oasis Care Pro lit ces lignes et les affiche à ses clients. Un prix enregistré ici est
        immédiatement proposé. En revanche, il ne remonte dans <strong>aucune facture déjà
        produite</strong> : une ligne de facture porte son propre prix, figé au moment où elle a été
        écrite.
      </Notice>

      {/* ------------------------------------------------------------
          CE QUE LES PRIX DÉBLOQUENT — la vérification, pas la promesse
          ------------------------------------------------------------ */}
      {kpis !== null && (
        <section className="mb-6">
          <div className="mb-3">
            <h2 className="text-[length:var(--text-section)] font-semibold leading-tight tracking-tight">
              Ce que les prix débloquent
            </h2>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Le MRR et l&apos;ARR restent inconnus tant qu&apos;aucun abonnement n&apos;est en
              cours, et redeviennent inconnus dès qu&apos;un seul <strong>abonnement</strong> a un
              montant incalculable — prix absent sur son offre, remise mensuelle sur un cycle
              annuel, case de matrice non décidée, module au compteur. Une offre sans prix sur
              laquelle <em>personne</em> n&apos;est abonné n&apos;empêche plus rien : elle est
              seulement invendable. Les deux chiffres sont affichés tels que la base les rend, avec
              leur motif.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="MRR"
              value={formatCents(kpis.mrr_cents)}
              unknownReason={kpis.unknown_reasons.mrr_cents}
              size="small"
            />
            <MetricCard
              label="ARR"
              value={formatCents(kpis.arr_cents)}
              unknownReason={kpis.unknown_reasons.arr_cents}
              size="small"
            />
            <MetricCard
              label="Offres actives sans prix"
              value={formatCount(
                actives.filter(
                  (offre) => !offre.is_quote_only && offre.monthly_price_cents === null,
                ).length,
              )}
              // CE N'EST PLUS LA CAUSE DU MRR INCONNU, et il ne faut pas
              // le laisser croire : depuis 0081 le garde-fou porte sur
              // les ABONNEMENTS incalculables, pas sur les offres. Une
              // offre sans prix reste néanmoins un problème — elle est
              // affichée à la vente dans Oasis Care Pro sans montant —
              // et c'est à ce titre qu'elle est comptée ici.
              hint="Publiée à la vente sans montant. Le MRR, lui, ne dépend que des abonnements en cours."
              size="small"
            />
            <MetricCard
              label="Cases non décidées"
              value={formatCount(indecises)}
              hint="Sur toute la matrice, modules non livrés compris."
              tone={indecises > 0 ? "accent" : "neutral"}
              size="small"
            />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------
          LES DÉCISIONS QUI MANQUENT
          ------------------------------------------------------------ */}
      {decisions.length > 0 && (
        <Panel
          className="mb-6"
          title="Décisions qui reviennent au dirigeant"
          description="La base refuse de les inventer. Chacune bloque quelque chose de précis, écrit en face."
          count={decisions.length}
        >
          <ul className="divide-y divide-line">
            {decisions.map((decision) => (
              <li key={decision.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
                <UnknownValue label="À décider" inline />
                <div className="min-w-0 flex-1">
                  <p className="text-[var(--text-body)] font-medium text-ink">{decision.titre}</p>
                  <p className="mt-0.5 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                    {decision.explication}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------------------------
          LA GRILLE
          ------------------------------------------------------------ */}
      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-[length:var(--text-section)] font-semibold leading-tight tracking-tight">
            Les offres
          </h2>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Les montants sont stockés en centimes entiers et affichés en euros à la dernière
            seconde. L&apos;économie annuelle est calculée, jamais recopiée dans un libellé.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {offres.map((offre) => (
            <CarteOffre key={offre.key} offre={offre} />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <EditeurGrille offres={offres} peutEcrire={peutEcrire} role={admin.role} />
      </section>

      {/* ------------------------------------------------------------
          LA MATRICE
          ------------------------------------------------------------ */}
      <Panel
        className="mb-6"
        title="Matrice offre × module"
        description="Le prix d'un module vient TOUJOURS de la case, jamais du module ni de la ligne d'abonnement. C'est ce qui fait qu'un passage à une offre qui le comprend cesse de le facturer, sans autre geste."
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[var(--text-body)]">
            <thead>
              <tr className="border-b border-line bg-surface-sunken">
                <th scope="col" className="eyebrow px-3 py-2 text-left">
                  Module
                </th>
                {offres.map((offre) => (
                  <th key={offre.key} scope="col" className="eyebrow px-3 py-2 text-left">
                    {offre.name}
                    {!offre.is_active && (
                      <span className="block font-normal normal-case text-ink-faint">retirée</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <tr key={module.key} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-left align-top font-medium">
                    <span className="text-ink">{module.name}</span>
                    {!module.is_delivered && (
                      <span className="mt-0.5 block text-[var(--text-secondary)] font-normal text-ink-faint">
                        annoncé, non livré
                      </span>
                    )}
                    {module.pricing_model !== "flat" && (
                      <span className="mt-0.5 block text-[var(--text-secondary)] font-normal text-ink-faint">
                        {module.pricing_model === "metered"
                          ? `au compteur (${module.metered_unit ?? "unité"})`
                          : "à la commission"}
                      </span>
                    )}
                  </th>
                  {offres.map((offre) => {
                    const disponibilite = disponibiliteDe(index, offre.key, module.key);
                    const ligne = index.get(cleDeCase(offre.key, module.key));
                    return (
                      <td key={offre.key} className="px-3 py-2 align-top">
                        <StatusBadge tone={TONS_DISPONIBILITE[disponibilite]}>
                          {LIBELLES_DISPONIBILITE[disponibilite]}
                        </StatusBadge>
                        {disponibilite === "optional" && (
                          <span className="tabular mt-1 block text-[var(--text-secondary)] text-ink-soft">
                            {formatCents(ligne?.monthly_price_cents ?? null, { decimals: true }) ??
                              "prix mensuel inconnu"}
                            {" / mois"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        className="mb-6"
        title="Décider une case"
        description="Un formulaire, pas quarante-cinq : le geste est ponctuel, et il mérite d'être relu."
      >
        <EditeurMatrice
          offres={offres}
          modules={modules}
          matrice={matrice}
          peutEcrire={peutEcrire}
          role={admin.role}
        />
      </Panel>

      {/* ------------------------------------------------------------
          LES REMISES
          ------------------------------------------------------------ */}
      <Panel
        title="Offres de remise"
        description="Une remise a toujours une fin : la colonne de durée est obligatoire en base, et l'à-vie est littéralement inenregistrable."
        count={remises.length}
      >
        {remises.length === 0 ? (
          <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
            Aucune offre de remise au catalogue.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {remises.map((remise) => (
              <li key={remise.code} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5">
                <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                  {remise.code}
                </code>
                <span className="font-medium text-ink">{remise.label}</span>
                <span className="tabular text-[var(--text-secondary)] text-ink-soft">
                  {remise.kind === "fixedMonthlyPrice" &&
                    `${formatCents(remise.value_cents, { decimals: true }) ?? "montant inconnu"} par mois imposés`}
                  {remise.kind === "percentOff" && `${remise.percent ?? "?"} % de remise`}
                  {remise.kind === "amountOff" &&
                    `${formatCents(remise.value_cents, { decimals: true }) ?? "montant inconnu"} de remise`}
                </span>
                <span className="text-[var(--text-secondary)] text-ink-soft">
                  pendant {remise.duration_months} mois
                </span>
                {!remise.is_active && <Badge tone="neutral">Retirée</Badge>}
                {remise.note && (
                  <p className="w-full text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                    {remise.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="mt-6 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
        {modulesLivres.length} module(s) livré(s) sur {modules.length} au catalogue. Un module
        annoncé mais non construit peut porter une promesse dans la matrice ; la base refuse
        qu&apos;une entreprise y souscrive, et c&apos;est ce qui empêche de vendre du vent.
      </p>
    </>
  );
}

/**
 * La carte d'une offre.
 *
 * Elle ne montre AUCUN chiffre inventé : un prix absent affiche
 * l'inconnu, un nombre de sièges nul affiche « non décidé », et une
 * offre sur devis affiche son plancher SANS le faire passer pour un
 * prix. « À partir de 249 € » est un argument commercial ; le vrai
 * montant sort d'une négociation et vit sur l'abonnement.
 */
function CarteOffre({ offre }: { offre: LigneOffre }) {
  const mensuel = prixDOffre(offre, "monthly");
  const annuel = prixDOffre(offre, "yearly");
  const economie = economieAnnuelle(offre);
  const atouts = fonctionnalites(offre.features);

  return (
    <Card className={`p-4 ${offre.is_active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[length:var(--text-card)] font-semibold text-ink">{offre.name}</h3>
            {offre.badge === "bestSeller" && <Badge tone="accent">Best-seller</Badge>}
            {offre.badge === "new" && <Badge tone="info">Nouveau</Badge>}
            {!offre.is_active && <Badge tone="neutral">Retirée de la grille</Badge>}
          </div>
          {offre.tagline && (
            <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              {offre.tagline}
            </p>
          )}
        </div>
        <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
          {offre.key}
        </code>
      </div>

      <div className="mt-3">
        {mensuel.etat === "public" && (
          <p className="tabular text-[length:var(--text-kpi-small)] font-semibold leading-none text-ink">
            {formatCents(mensuel.cents, { decimals: true })}
            <span className="text-[var(--text-secondary)] font-normal text-ink-soft"> / mois</span>
          </p>
        )}
        {mensuel.etat === "surDevis" && (
          <p className="text-[length:var(--text-card)] font-semibold text-ink">
            Sur devis
            <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-soft">
              {mensuel.plancherCents === null ? (
                "sans plancher enregistré"
              ) : (
                <>à partir de {formatCents(mensuel.plancherCents, { decimals: true })} / mois</>
              )}
            </span>
          </p>
        )}
        {mensuel.etat === "absent" && (
          <UnknownValue
            label="Aucun prix mensuel"
            reason="Cette offre est active et n'a pas de prix mensuel : elle ne peut pas être facturée, et elle rend le MRR du tableau de bord inconnu."
          />
        )}
      </div>

      <div className="mt-2 text-[var(--text-secondary)] text-ink-soft">
        {annuel.etat === "public" && (
          <span className="tabular">
            {formatCents(annuel.cents, { decimals: true })} / an
            {economie !== null && (
              <span className="text-positive">
                {" "}
                — {economie.moisOfferts % 1 === 0
                  ? `${economie.moisOfferts} mois offerts`
                  : `${Math.round(economie.economiePourcent)} % d'économie`}
              </span>
            )}
          </span>
        )}
        {annuel.etat === "absent" && !offre.is_quote_only && (
          <span className="text-ink-faint">Aucun prix annuel enregistré.</span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[var(--text-secondary)]">
        <Ligne
          terme="Sièges compris"
          valeur={
            offre.included_seats === null ? null : formatCount(offre.included_seats)
          }
          motif="Non décidé — ce n'est pas « illimité ». Tant qu'il est nul, aucun siège supplémentaire n'est facturé automatiquement."
        />
        <Ligne
          terme="Siège en plus"
          valeur={
            offre.extra_seat_monthly_price_cents === null
              ? null
              : `${formatCents(offre.extra_seat_monthly_price_cents, { decimals: true })} / mois`
          }
          motif="Aucun prix de siège supplémentaire sur cette offre."
        />
        <Ligne
          terme="Quota IA"
          valeur={offre.ai_monthly_quota === null ? null : formatCount(offre.ai_monthly_quota)}
          motif="Non décidé."
        />
        <Ligne
          terme="Stockage"
          valeur={offre.storage_gb === null ? null : `${formatCount(offre.storage_gb)} Go`}
          motif="Non décidé."
        />
      </dl>

      {atouts.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-[var(--text-secondary)] text-ink-soft">
          {atouts.map((atout) => (
            <li key={atout} className="flex gap-2">
              <span aria-hidden className="text-positive">
                ·
              </span>
              {atout}
            </li>
          ))}
        </ul>
      )}

      {offre.updated_at && (
        <p className="mt-3 text-[var(--text-secondary)] text-ink-faint">
          Modifiée le {formatDateTime(offre.updated_at)}.
        </p>
      )}

      <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
        `max_users` = {offre.max_users === null ? "non renseigné" : offre.max_users} — indication
        d&apos;affichage héritée, lue par Oasis Care Pro. Ce n&apos;est pas un plafond appliqué : la
        référence de facturation est « sièges compris ».
      </p>
    </Card>
  );
}

function Ligne({
  terme,
  valeur,
  motif,
}: {
  terme: string;
  valeur: string | null;
  motif: string;
}) {
  return (
    <>
      <dt className="text-ink-faint">{terme}</dt>
      <dd className="tabular text-right text-ink-soft">
        {valeur === null ? <UnknownValue reason={motif} compact /> : valeur}
      </dd>
    </>
  );
}
