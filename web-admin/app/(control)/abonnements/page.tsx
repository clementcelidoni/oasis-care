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
import {
  LIBELLES_CYCLE,
  LIBELLES_FOURNISSEUR,
  LIBELLES_STATUT,
  TONS_STATUT,
  etatAbonnement,
} from "@/lib/billing/abonnement";
import { EcranCommercialFerme } from "@/lib/billing/ecran-ferme";
import { peut, requireCommercial } from "@/lib/billing/guard";
import { diagnostiquerSocleCommercial } from "@/lib/billing/socle";
import { lireAbonnements, lireOffres, listerEntreprises } from "@/lib/billing/source";
import type { Entreprise, LigneAbonnement, LigneOffre } from "@/lib/billing/types";
import { formatCount, formatDate } from "@/lib/format";

import { CreerAbonnement } from "./creer-abonnement";

/**
 * ==================================================================
 * ABONNEMENTS PRO — spec p.12-13
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN DOIT DIRE AVANT TOUT AUTRE CHOSE
 * ------------------------------------------------------------------
 * RIEN NE CRÉE D'ABONNEMENT AUTOMATIQUEMENT. `organization_subscriptions`
 * est vide, et la seule mention de la table côté produit est une
 * LECTURE : `startCheckout` de `web-pro` rend « unavailable », parce
 * qu'aucun encaissement n'est branché. Une liste vide ici ressemblerait
 * à une panne ; c'est un fait, et il a une cause qu'un administrateur
 * doit connaître avant de chercher le bouton qui manque.
 *
 * ------------------------------------------------------------------
 * ET LE PIÈGE QUE CET ÉCRAN MESURE PLUTÔT QUE DE LE SUBIR
 * ------------------------------------------------------------------
 * Après 0081, `organization_subscriptions` ne porte plus qu'UNE
 * politique de lecture : « Members read their subscription ». Un
 * administrateur de plateforme n'est membre d'aucune entreprise — il
 * peut donc lire ZÉRO LIGNE alors que des abonnements existent, sans
 * erreur, sans code, sans rien.
 *
 * Pire : l'unique super-administrateur de production EST membre de
 * l'unique entreprise. L'écran marcherait parfaitement pour lui et
 * serait vide pour un `billing_admin` — la défaillance qui ne se voit
 * qu'en production, chez quelqu'un d'autre.
 *
 * On compare donc ce qu'on a pu lire au nombre d'entreprises portant un
 * forfait d'après `admin_list_organizations()`, qui est `security
 * definer` et traverse les organisations. L'écart est AFFICHÉ, avec la
 * politique qui manque.
 */

export const metadata: Metadata = {
  title: "Abonnements — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

type Ligne = {
  abonnement: LigneAbonnement;
  entreprise: Entreprise | undefined;
  offre: LigneOffre | undefined;
};

export default async function AbonnementsPage() {
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
        titre="Abonnements"
        sousTitre="Les abonnements des entreprises clientes à Oasis Care Pro."
      />
    );
  }

  let entreprises: Awaited<ReturnType<typeof listerEntreprises>>;
  let offres: LigneOffre[];
  let lecture: Awaited<ReturnType<typeof lireAbonnements>>;
  try {
    [entreprises, offres] = await Promise.all([listerEntreprises(), lireOffres()]);
    lecture = await lireAbonnements(entreprises.entreprises);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Commercial" title="Abonnements" />
        <ReadFailure error={error} />
      </>
    );
  }

  const indexEntreprises = new Map(entreprises.entreprises.map((e) => [e.id, e]));
  const indexOffres = new Map(offres.map((o) => [o.key, o]));

  const lignes: Ligne[] = lecture.abonnements.map((abonnement) => ({
    abonnement,
    entreprise: indexEntreprises.get(abonnement.organization_id),
    offre: indexOffres.get(abonnement.plan),
  }));

  const avecAbonnement = new Set(lecture.abonnements.map((a) => a.organization_id));
  const sansAbonnement = entreprises.entreprises.filter(
    (entreprise) => !avecAbonnement.has(entreprise.id) && entreprise.archiveeLe === null,
  );

  const peutEcrire = peut(admin, "billing.subscriptions.write");
  const maintenant = new Date();

  const essais = lignes.filter(
    (ligne) => etatAbonnement(ligne.abonnement, maintenant).etat === "essai",
  ).length;
  const partants = lignes.filter((ligne) => ligne.abonnement.cancel_at_period_end).length;
  const impayes = lignes.filter((ligne) => ligne.abonnement.status === "pastDue").length;

  const colonnes: Column<Ligne>[] = [
    {
      key: "entreprise",
      header: "Entreprise",
      cell: (ligne) => ligne.entreprise?.nom ?? "Entreprise inconnue",
    },
    {
      key: "offre",
      header: "Offre",
      cell: (ligne) => ligne.offre?.name ?? ligne.abonnement.plan,
    },
    {
      key: "cycle",
      header: "Cycle",
      cell: (ligne) => LIBELLES_CYCLE[ligne.abonnement.billing_cycle],
    },
    {
      key: "statut",
      header: "Statut",
      cell: (ligne) => {
        const etat = etatAbonnement(ligne.abonnement, maintenant);
        if (etat.etat === "partALEcheance") {
          return <StatusBadge tone="warning">Part à l&apos;échéance</StatusBadge>;
        }
        if (etat.etat === "essai" && etat.expire) {
          return <StatusBadge tone="warning">Essai expiré</StatusBadge>;
        }
        return (
          <StatusBadge tone={TONS_STATUT[ligne.abonnement.status]}>
            {LIBELLES_STATUT[ligne.abonnement.status]}
          </StatusBadge>
        );
      },
    },
    {
      key: "periode",
      header: "Fin de période",
      secondary: true,
      cell: (ligne) =>
        formatDate(ligne.abonnement.current_period_end) ?? (
          <UnknownValue
            compact
            reason="Aucune fin de période enregistrée : rien ne la pose, faute d'encaissement branché."
          />
        ),
    },
    {
      key: "sieges",
      header: "Sièges facturés",
      numeric: true,
      secondary: true,
      cell: (ligne) => formatCount(ligne.abonnement.billable_extra_seats),
    },
    {
      key: "provider",
      header: "Origine",
      secondary: true,
      cell: (ligne) => LIBELLES_FOURNISSEUR[ligne.abonnement.provider],
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="Abonnements"
        subtitle="Les abonnements des entreprises clientes à Oasis Care Pro. Administrés à la main : aucun encaissement n'est branché."
        action={
          <>
            <ButtonLink href="/plans" variant="secondary">
              Plans et prix
            </ButtonLink>
            <ButtonLink href="/abonnements/factures" variant="secondary">
              Factures SaaS
            </ButtonLink>
          </>
        }
      />

      <Notice tone="info" title="Rien ne crée d'abonnement automatiquement">
        Le paiement en ligne n&apos;est pas branché : <code className="font-mono">startCheckout</code>{" "}
        d&apos;Oasis Care Pro rend délibérément « indisponible ». Un abonnement n&apos;apparaît ici
        que parce qu&apos;un administrateur l&apos;a saisi, et il porte alors l&apos;origine
        « saisi à la main ». Ce n&apos;est pas provisoire par négligence : le prestataire de
        paiement arrive au chantier suivant, et la place lui est réservée.
      </Notice>

      {/* LE TROU DE LECTURE, quand il se produit. */}
      {lecture.manquants > 0 && (
        <Notice tone="critical" title="Des abonnements existent et ne vous sont pas lisibles">
          {formatCount(lecture.attendus)} entreprise(s) portent un forfait d&apos;après la fonction
          d&apos;administration, et {formatCount(lecture.abonnements.length)} ligne(s)
          d&apos;abonnement vous sont visibles. L&apos;écart de {formatCount(lecture.manquants)}{" "}
          n&apos;est pas un vide : c&apos;est un refus silencieux.{" "}
          <code className="font-mono">organization_subscriptions</code> ne porte qu&apos;une
          politique de lecture, « Members read their subscription », et un administrateur de
          plateforme n&apos;est membre d&apos;aucune entreprise. Il manque à 0081 une politique de
          lecture sur <code className="font-mono">billing.subscriptions.read</code> ; les actions,
          elles, fonctionnent — elles passent par des fonctions <em>security definer</em>.
        </Notice>
      )}

      <div className="mb-5">
        <StatStrip
          items={[
            {
              label: "Abonnements lisibles",
              value: formatCount(lecture.abonnements.length),
              note:
                lecture.manquants > 0
                  ? `${lecture.manquants} autre(s) existent sans vous être lisibles.`
                  : undefined,
            },
            { label: "En essai", value: formatCount(essais) },
            {
              label: "Partent à l'échéance",
              value: formatCount(partants),
              tone: partants > 0 ? "critical" : undefined,
            },
            {
              label: "Impayés",
              value: formatCount(impayes),
              tone: impayes > 0 ? "critical" : undefined,
            },
          ]}
        />
      </div>

      <div className="mb-6">
        <DataTable
          columns={colonnes}
          rows={lignes}
          rowKey={(ligne) => ligne.abonnement.organization_id}
          rowHref={(ligne) => `/abonnements/${ligne.abonnement.organization_id}`}
          empty={
            <EmptyState
              tone="unknown"
              title="Aucun abonnement enregistré"
              description={
                "Ce zéro est exact, et il a une cause : aucune ligne du produit n'écrit dans cette table. " +
                "Le premier abonnement se crée ci-dessous, à la main — c'est la seule façon aujourd'hui, " +
                "et c'est aussi ce qui rallumera le MRR du tableau de bord, une fois les prix posés."
              }
              action={
                <ButtonLink href="/plans" variant="secondary">
                  Vérifier la grille tarifaire
                </ButtonLink>
              }
            />
          }
          footer={
            entreprises.tronquee ? (
              <span className="text-[var(--text-secondary)] text-ink-faint">
                La liste des entreprises a été tronquée à {formatCount(1000)} : certains noms
                peuvent manquer en face des identifiants.
              </span>
            ) : undefined
          }
        />
      </div>

      <Panel
        title="Créer un abonnement"
        description="L'administrateur est la source. Ce formulaire est le seul chemin, et chaque création laisse deux traces."
      >
        <CreerAbonnement
          entreprises={sansAbonnement}
          offres={offres.filter((offre) => offre.is_active)}
          peutEcrire={peutEcrire}
          role={admin.role}
        />
      </Panel>
    </>
  );
}
