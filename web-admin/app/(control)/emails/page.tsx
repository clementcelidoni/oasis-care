import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  StatStrip,
  StatusBadge,
  Tabs,
  UnknownValue,
  type Column,
} from "@/components/ui";
import { EcranCourrierFerme } from "@/lib/email/ecran-ferme";
import { peut, requireCourrier } from "@/lib/email/guard";
import {
  EXPLICATIONS_NATURE,
  LIBELLES_NATURE,
  LIBELLES_STATUT_CAMPAGNE,
  TONS_NATURE,
  TONS_STATUT_CAMPAGNE,
} from "@/lib/email/libelles";
import { ongletsCourrier } from "@/lib/email/onglets";
import { CLES_COURRIER } from "@/lib/email/permissions";
import { diagnostiquerSocleCourrier } from "@/lib/email/socle";
import {
  listerCampagnes,
  listerConsentements,
  listerEntreprisesDuParc,
} from "@/lib/email/source";
import type { LigneCampagne } from "@/lib/email/types";
import { formatDateTime } from "@/lib/format";

import { ComposerAnnonce } from "./composer";

export const metadata: Metadata = { title: "Annonces commerciales · Oasis Admin" };

/**
 * ==================================================================
 * LE PANNEAU D'ENVOI D'OASIS ADMIN
 * ==================================================================
 *
 * TROIS NATURES ONT ÉTÉ DEMANDÉES — bienvenue, changement de paramètre
 * important, publicité. UNE SEULE peut partir d'ici, et cet écran le
 * dit en haut plutôt que de laisser le découvrir.
 *
 *   • LA PUBLICITÉ part d'ici. C'est un geste humain, motivé, tracé,
 *     et 0084 lui donne tout ce qu'il faut : catalogue, consentement,
 *     désabonnement, idempotence.
 *   • LA BIENVENUE et le CHANGEMENT DE PARAMÈTRE sont déclarés au
 *     catalogue et rendus par la couche d'envoi, mais AUCUNE fonction
 *     ne permet de les déclencher depuis Oasis Admin :
 *     `email_enqueue()` est réservée à `service_role` (0084 § 15.c), et
 *     il n'existe pas d'équivalent de
 *     `admin_send_email_campaign()` pour eux. L'onglet « Messages de
 *     service » l'explique, avec ce qu'il faudrait ajouter.
 *
 * Un bouton qui échouerait aurait été plus rapide à écrire. Il aurait
 * aussi fait perdre une heure à quelqu'un qui aurait cherché la panne.
 *
 * ------------------------------------------------------------------
 * DEUX PERMISSIONS, ET ELLES NE SE RECOUVRENT PAS
 * ------------------------------------------------------------------
 * `emails.campaigns.read` ouvre cette page. `emails.campaigns.send`
 * ouvre le formulaire. Le second n'est pas un raffinement : c'est la
 * permission par laquelle un compte compromis atteindrait TOUS les
 * clients d'un seul geste, depuis un domaine authentifié. 0084 la
 * réserve au super-administrateur et au responsable produit, et la
 * place derrière le second facteur.
 */
export default async function AnnoncesPage() {
  const admin = await requireCourrier(CLES_COURRIER.campagnesLire);
  const socle = await diagnostiquerSocleCourrier(admin.permissions, CLES_COURRIER.campagnesLire);

  if (socle.etat !== "ok") {
    return (
      <EcranCourrierFerme
        etat={socle.etat}
        requise={CLES_COURRIER.campagnesLire}
        titre="Annonces commerciales"
        sousTitre="Les messages qu'Oasis Care envoie à ses entreprises clientes."
      />
    );
  }

  const peutEnvoyer = peut(admin, CLES_COURRIER.campagnesEnvoyer);
  const onglets = ongletsCourrier(admin);

  let campagnes: LigneCampagne[] = [];
  let nomExemple: string | null = null;
  let consentantes = 0;

  try {
    campagnes = await listerCampagnes();

    // LE NOM D'UN VRAI DESTINATAIRE POUR L'APERÇU. On croise le
    // registre de consentement avec la liste des entreprises : le
    // registre porte l'identifiant, pas le nom, et le Control Center
    // n'a aucun autre chemin vers `business_organizations`.
    //
    // CE N'EST PAS L'AUDIENCE, et l'écran ne le présente pas comme
    // telle : la porte regarde aussi la liste de suppression et la
    // suspension, et elle n'est interrogée que sur le brouillon.
    const [consentements, parc] = await Promise.all([
      listerConsentements(),
      listerEntreprisesDuParc(),
    ]);

    const actifs = consentements.filter((ligne) => ligne.can_receive_marketing);
    consentantes = new Set(actifs.map((ligne) => ligne.organization_id)).size;

    const noms = new Map(parc.entreprises.map((e) => [e.organization_id, e.name]));
    for (const consentement of actifs) {
      const nom = noms.get(consentement.organization_id);
      if (nom !== undefined) {
        nomExemple = nom;
        break;
      }
    }
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Courrier" title="Annonces commerciales" />
        <ReadFailure error={error} />
      </>
    );
  }

  const colonnes: Column<LigneCampagne>[] = [
    {
      key: "titre",
      header: "Titre",
      cell: (ligne) => ligne.title,
    },
    {
      key: "statut",
      header: "État",
      cell: (ligne) => (
        <StatusBadge tone={TONS_STATUT_CAMPAGNE[ligne.status] ?? "neutral"}>
          {LIBELLES_STATUT_CAMPAGNE[ligne.status] ?? ligne.status}
        </StatusBadge>
      ),
    },
    {
      key: "objet",
      header: "Objet",
      secondary: true,
      cell: (ligne) => <span className="text-ink-soft">{ligne.subject}</span>,
    },
    {
      key: "partis",
      header: "Mis en file",
      numeric: true,
      cell: (ligne) =>
        ligne.queued_count === null ? (
          <UnknownValue
            compact
            reason="Cette annonce n'est pas encore partie : rien n'a été mis en file."
          />
        ) : (
          ligne.queued_count
        ),
    },
    {
      key: "ecartes",
      header: "Écartés",
      numeric: true,
      cell: (ligne) =>
        ligne.skipped_count === null ? (
          <UnknownValue compact reason="Cette annonce n'est pas encore partie." />
        ) : (
          ligne.skipped_count
        ),
    },
    {
      key: "date",
      header: "Envoyée le",
      secondary: true,
      cell: (ligne) => (
        <span className="text-ink-soft">
          {formatDateTime(ligne.sent_at) ?? formatDateTime(ligne.created_at) ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Courrier"
        title="Annonces commerciales"
        subtitle="Les messages qu'Oasis Care envoie à ses propres clients — les entreprises Pro. Jamais à leurs clients."
      />

      <Tabs items={onglets} current="/emails" />

      {/* ---- LES DEUX NATURES, ET CE QUI LES SÉPARE --------------- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {(["publicite", "transactionnel"] as const).map((nature) => (
          <Card key={nature} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge tone={TONS_NATURE[nature]}>{LIBELLES_NATURE[nature]}</Badge>
              {nature === "publicite" ? (
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Part d&apos;ici
                </span>
              ) : (
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Ne part jamais d&apos;ici
                </span>
              )}
            </div>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              {EXPLICATIONS_NATURE[nature]}
            </p>
          </Card>
        ))}
      </div>

      {/* LE DÉFAUT QU'ON NE VEUT PAS VOIR RÉINVENTÉ. Il est empêché
          structurellement en base — le registre de consentement ne peut
          pas contenir de ligne parlant d'autre chose que de publicité —
          mais quelqu'un finira par vouloir « unifier » les deux
          natures. La phrase est là pour ce jour-là. */}
      <Notice tone="info" title="Un désabonnement n'empêche jamais une facture d'arriver">
        Le registre de consentement de la base porte une contrainte qui l&apos;empêche
        littéralement de contenir une ligne parlant d&apos;autre chose que de publicité : il
        n&apos;existe aucune ligne qu&apos;une requête, même mal écrite, pourrait trouver et
        opposer à une facture. Si vous lisez un jour une demande d&apos;« unifier » les deux
        natures, c&apos;est cette garantie qu&apos;elle propose de retirer.
      </Notice>

      <StatStrip
        items={[
          {
            label: "Annonces composées",
            value: String(campagnes.length),
          },
          {
            label: "Annonces envoyées",
            value: String(campagnes.filter((c) => c.status === "sent").length),
          },
          {
            label: "Entreprises consentantes",
            value: String(consentantes),
            note: "Consentement en cours au registre. Ce n'est pas l'audience : la porte regarde aussi la suppression et la suspension.",
          },
          {
            label: "Messages reçus",
            value: null,
            unknownReason:
              "La distribution n'est connue que par le retour du transporteur. Tant qu'il n'est pas branché, un message reste « remis au transporteur » pour toujours, et compter ces messages comme reçus afficherait 100 % de distribution à un produit qui ne mesure rien.",
          },
        ]}
      />

      <div className="mt-5 flex flex-col gap-5">
        <Panel
          title="Composer une annonce"
          description={
            peutEnvoyer
              ? "Deux gestes : le brouillon ici, l'envoi sur l'écran suivant, après avoir vu qui recevra."
              : undefined
          }
        >
          {peutEnvoyer ? (
            <ComposerAnnonce nomExemple={nomExemple} consentantes={consentantes} />
          ) : (
            <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Votre rôle lit les annonces mais n&apos;en envoie pas.{" "}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
                emails.campaigns.send
              </code>{" "}
              est réservée au super-administrateur et au responsable produit, et le garde-fou de
              la matrice refuse de l&apos;accorder à un autre rôle : c&apos;est la permission par
              laquelle un compte compromis atteindrait tous les clients d&apos;un seul geste,
              depuis un domaine authentifié.
            </div>
          )}
        </Panel>

        <Panel title="Historique" count={campagnes.length}>
          <DataTable
            columns={colonnes}
            rows={campagnes}
            rowKey={(ligne) => ligne.id}
            rowHref={(ligne) => `/emails/${ligne.id}`}
            empty={
              <EmptyState
                title="Aucune annonce"
                description="Aucune annonce commerciale n'a encore été composée. Ce n'est pas une donnée manquante : la table est vide."
              />
            }
            footer={
              <span className="text-[var(--text-secondary)] text-ink-faint">
                « Mis en file » compte les messages confiés au transporteur, pas les messages
                reçus. « Écartés » ne compte que les entreprises visitées par la boucle
                d&apos;envoi : celles qui n&apos;ont pas d&apos;adresse e-mail, et les archivées,
                n&apos;apparaissent dans aucune des deux colonnes.
              </span>
            }
          />
        </Panel>
      </div>
    </>
  );
}
