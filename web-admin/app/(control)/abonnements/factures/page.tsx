import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  ButtonLink,
  DataTable,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  StatStrip,
  StatusBadge,
  UnknownValue,
  type Column,
} from "@/components/ui";
import { EcranCommercialFerme } from "@/lib/billing/ecran-ferme";
import {
  LIBELLES_STATUT_FACTURE,
  TONS_STATUT_FACTURE,
  moisProposables,
} from "@/lib/billing/facture";
import { peut, requireCommercial } from "@/lib/billing/guard";
import { diagnostiquerSocleCommercial } from "@/lib/billing/socle";
import {
  LIBELLES_CHAMPS_EMETTEUR,
  lireChampsManquantsEmetteur,
  lireEmetteur,
  listerEntreprises,
  listerFactures,
  type FactureAvecEtat,
} from "@/lib/billing/source";
import { formatCents, formatCount, formatDate } from "@/lib/format";

import { FormulaireEmetteur } from "./formulaire-emetteur";
import { GenererFactures } from "./generer-factures";

/**
 * ==================================================================
 * FACTURATION SaaS — les factures qu'OASIS CARE émet À SES CLIENTS
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN N'EST PAS
 * ------------------------------------------------------------------
 * Ce ne sont PAS les factures qu'une entreprise cliente émet à ses
 * propres clients — celles-là vivent dans `public.invoices` et leur
 * émetteur est le client. Mélanger les deux serait une faute
 * comptable : deux séquences dans la même table, deux émetteurs, deux
 * régimes de TVA, un export inexploitable. D'où le préfixe `saas_` en
 * base, et deux écrans qui ne se ressemblent pas.
 *
 * Ce ne sont PAS non plus les revenus Apple. Le canal mobile est
 * encaissé, facturé et remboursé par Apple : construire une facture de
 * ce côté reviendrait à facturer deux fois, ce que les conditions de
 * l'App Store interdisent. Aucun montant Apple n'apparaît ici, et un
 * total qui mélangerait les deux canaux serait faux — l'un est net de
 * la commission, l'autre non.
 *
 * ------------------------------------------------------------------
 * TROIS RÈGLES QUE L'ÉCRAN DOIT RENDRE ÉVIDENTES
 * ------------------------------------------------------------------
 *   1. UNE FACTURE ÉMISE NE SE MODIFIE PLUS. Le bouton n'existe pas, et
 *      la page de détail explique pourquoi au lieu de laisser chercher.
 *   2. LE TOTAL EST CELUI DE LA BASE. TVA groupée par taux avant
 *      arrondi (correctif 0064). Rien n'est recalculé ici : deux
 *      arrondis valent deux montants.
 *   3. « EN RETARD » SE DÉDUIT. Aucune colonne ne le porte ; la vue
 *      `saas_invoice_state` le calcule à chaque lecture, depuis
 *      l'échéance et ce qui a été encaissé.
 *
 * ------------------------------------------------------------------
 * ET L'ENCAISSEMENT EST MANUEL
 * ------------------------------------------------------------------
 * Pas d'importation bancaire, pas de rapprochement automatique dans ce
 * jalon : un administrateur lit son relevé et saisit. L'écran le dit
 * plutôt que de le laisser deviner.
 */

export const metadata: Metadata = {
  title: "Factures SaaS — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function FacturesPage() {
  const admin = await requireCommercial("billing.invoices.read");
  const socle = await diagnostiquerSocleCommercial(admin.permissions, "billing.invoices.read");

  if (socle.etat !== "ok") {
    return (
      <EcranCommercialFerme
        etat={socle.etat}
        requise="billing.invoices.read"
        titre="Factures SaaS"
        sousTitre="Les factures d'abonnement qu'Oasis Care émet à ses entreprises clientes."
      />
    );
  }

  const LIMITE = 200;

  let lecture: Awaited<ReturnType<typeof listerFactures>>;
  let entreprises: Awaited<ReturnType<typeof listerEntreprises>>;
  let emetteur: Awaited<ReturnType<typeof lireEmetteur>>;
  let manquants: string[];
  try {
    [lecture, entreprises, emetteur, manquants] = await Promise.all([
      listerFactures({ limite: LIMITE }),
      listerEntreprises(),
      lireEmetteur(),
      lireChampsManquantsEmetteur(),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Commercial" title="Factures SaaS" />
        <ReadFailure error={error} />
      </>
    );
  }

  const { factures, total, tronquee } = lecture;
  const noms = new Map(entreprises.entreprises.map((e) => [e.id, e.nom]));
  const peutEcrire = peut(admin, "billing.invoices.write");

  const brouillons = factures.filter((f) => f.status === "draft").length;
  const enRetard = factures.filter(
    (f) =>
      f.etat?.effective_status === "overdue" ||
      f.etat?.effective_status === "partiallyPaidOverdue",
  ).length;

  // LE MONTANT EN ATTENTE — et il rend INCONNU dans DEUX cas, pas un.
  //
  //   1. une facture dont le total est incalculable (taux de TVA
  //      manquant, prix absent). Une somme qui saute cette ligne serait
  //      un chiffre trop bas qui a l'air d'un chiffre ;
  //   2. UNE LISTE TRONQUÉE. C'est le cas qui manquait : la lecture est
  //      bornée à 200 documents, et additionner cet échantillon en
  //      l'appelant « Restant dû » aurait été exactement la faute que
  //      le point 1 sert à éviter — au même endroit, sur le même
  //      chiffre. Les trois compteurs voisins portent la même réserve.
  const ouvertes = factures.filter(
    (f) => f.issued_at !== null && f.status !== "cancelled" && f.status !== "credited",
  );
  const totalIncalculable = ouvertes.some(
    (f) => f.etat === null || f.etat.outstanding_cents === null,
  );
  const incalculable = totalIncalculable || tronquee;
  const motifTroncature = `La liste est tronquée à ${LIMITE} documents sur ${total} : une somme partielle se lirait comme un total.`;
  const motifInconnu = totalIncalculable
    ? "Au moins une facture émise a un total incalculable (un taux de TVA ou un prix manque). Une somme partielle se lirait comme un total."
    : motifTroncature;
  const restantDu = incalculable
    ? null
    : ouvertes.reduce((somme, f) => somme + (f.etat?.outstanding_cents ?? 0), 0);

  const colonnes: Column<FactureAvecEtat>[] = [
    {
      key: "numero",
      header: "Numéro",
      cell: (facture) =>
        facture.number ?? (
          <span className="text-ink-soft">Brouillon — aucun numéro attribué</span>
        ),
    },
    {
      key: "entreprise",
      header: "Entreprise",
      // On ne lit PAS `customer_name` de la facture ici : ce champ est
      // le nom FIGÉ au moment de l'émission, et il est nul sur un
      // brouillon. Le nom courant de l'entreprise est celui qu'on
      // cherche dans une liste ; le nom figé appartient au document, et
      // il est affiché sur sa fiche.
      cell: (facture) => noms.get(facture.organization_id) ?? "Entreprise inconnue",
    },
    {
      key: "periode",
      header: "Période",
      cell: (facture) => `${formatDate(facture.period_start)} → ${formatDate(facture.period_end)}`,
    },
    {
      key: "statut",
      header: "Statut",
      cell: (facture) =>
        facture.etat === null ? (
          <UnknownValue compact reason="L'état effectif n'a pas pu être lu." />
        ) : (
          <StatusBadge tone={TONS_STATUT_FACTURE[facture.etat.effective_status]}>
            {LIBELLES_STATUT_FACTURE[facture.etat.effective_status]}
          </StatusBadge>
        ),
    },
    {
      key: "echeance",
      header: "Échéance",
      secondary: true,
      cell: (facture) =>
        facture.due_on === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span>
            {formatDate(facture.due_on)}
            {facture.etat !== null &&
              facture.etat.days_late !== null &&
              facture.etat.days_late > 0 &&
              (facture.etat.effective_status === "overdue" ||
                facture.etat.effective_status === "partiallyPaidOverdue") && (
                <span className="ml-2 text-critical">+{facture.etat.days_late} j</span>
              )}
          </span>
        ),
    },
    {
      key: "total",
      header: "Total TTC",
      numeric: true,
      cell: (facture) =>
        facture.etat === null || facture.etat.total_including_vat_cents === null ? (
          <UnknownValue
            compact
            reason="Au moins une ligne n'a pas de prix ou pas de taux de TVA : la base rend le total inconnu plutôt qu'un montant faux, et l'émission est refusée."
          />
        ) : (
          formatCents(facture.etat.total_including_vat_cents, { decimals: true })
        ),
    },
    {
      key: "restant",
      header: "Restant dû",
      numeric: true,
      secondary: true,
      cell: (facture) =>
        facture.etat === null || facture.etat.outstanding_cents === null ? (
          <UnknownValue compact reason="Total inconnu : le solde l'est aussi." />
        ) : (
          formatCents(facture.etat.outstanding_cents, { decimals: true })
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="Factures SaaS"
        subtitle="Ce qu'Oasis Care facture à ses entreprises clientes. Numérotation séquentielle et sans trou, garantie par la base."
        action={
          <>
            <ButtonLink href="/abonnements" variant="secondary">
              Abonnements
            </ButtonLink>
            <ButtonLink href="/plans" variant="secondary">
              Plans et prix
            </ButtonLink>
          </>
        }
      />

      <Notice tone="info" title="Deux canaux, et un seul se facture ici">
        Oasis Care Pro : nous vendons, nous encaissons, nous facturons — ce sont ces documents.
        Oasis Care sur iPhone : Apple encaisse, facture et rembourse, et aucune facture
        n&apos;est produite de ce côté. Les mélanger rendrait le chiffre d&apos;affaires illisible,
        l&apos;un étant net de la commission Apple et l&apos;autre non.
      </Notice>

      {manquants.length > 0 && (
        <Notice tone="critical" title="Aucune facture ne peut être émise pour l'instant">
          L&apos;identité légale de l&apos;émetteur est incomplète : il manque{" "}
          {manquants.map((nom) => LIBELLES_CHAMPS_EMETTEUR[nom] ?? nom).join(", ")}. La génération
          reste possible — elle produira des brouillons — mais l&apos;émission est refusée par la
          base tant que ces mentions manquent.
        </Notice>
      )}

      {tronquee && (
        <Notice tone="warning" title="Cette page ne montre pas tout">
          {total} factures existent ; les {factures.length} plus récentes sont affichées. Les
          compteurs « Brouillons » et « En retard » ne portent donc que sur cet échantillon, et le
          restant dû est rendu <strong>inconnu</strong> plutôt qu&apos;additionné partiellement.
          Filtrez par entreprise depuis sa fiche d&apos;abonnement pour voir son dossier complet.
        </Notice>
      )}

      <div className="mb-5">
        <StatStrip
          items={[
            { label: "Factures", value: formatCount(total) },
            {
              label: "Brouillons",
              value: formatCount(brouillons),
              note: tronquee ? `Sur les ${factures.length} plus récentes.` : undefined,
            },
            {
              label: "En retard",
              value: formatCount(enRetard),
              tone: enRetard > 0 ? "critical" : undefined,
              note: tronquee
                ? `Sur les ${factures.length} plus récentes. Déduit de l'échéance, jamais saisi.`
                : "Déduit de l'échéance, jamais saisi.",
            },
            {
              label: "Restant dû",
              value: formatCents(restantDu, { decimals: true }),
              unknownReason: incalculable ? motifInconnu : undefined,
            },
          ]}
        />
      </div>

      <div className="mb-6">
        <DataTable
          columns={colonnes}
          rows={factures}
          rowKey={(facture) => facture.id}
          rowHref={(facture) => `/abonnements/factures/${facture.id}`}
          empty={
            <EmptyState
              title="Aucune facture d'abonnement"
              description={
                "Rien ne facture automatiquement : aucun planificateur n'appelle la génération, et c'est " +
                "délibéré tant qu'un humain n'a pas regardé la première fois. Produisez la période " +
                "ci-dessous — la relancer ne crée aucun doublon et RECALCULE les brouillons."
              }
            />
          }
        />
      </div>

      <Panel
        className="mb-6"
        title="Générer les factures d'une période"
        description="Relancer sur la même période ne crée pas de doublon — un index unique l'interdit — et RECALCULE les brouillons pour qu'ils suivent l'abonnement. Une facture déjà émise, elle, ne bouge plus."
      >
        <GenererFactures mois={moisProposables()} peutEcrire={peutEcrire} role={admin.role} />
      </Panel>

      <Panel
        title="Identité légale de l'émetteur"
        description="Oasis Care lui-même. Elle n'existe nulle part ailleurs dans la base, et sans elle aucune facture ne part."
      >
        <FormulaireEmetteur
          emetteur={emetteur}
          manquants={manquants}
          libelles={LIBELLES_CHAMPS_EMETTEUR}
          peutEcrire={peut(admin, "billing.issuer.write")}
          role={admin.role}
        />
      </Panel>
    </>
  );
}
