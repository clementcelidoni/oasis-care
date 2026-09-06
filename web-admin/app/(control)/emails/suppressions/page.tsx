import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Card,
  EmptyState,
  Notice,
  PageHeader,
  StatStrip,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { EcranCourrierFerme } from "@/lib/email/ecran-ferme";
import { peut, requireCourrier } from "@/lib/email/guard";
import { LIBELLES_SUPPRESSION, TONS_SUPPRESSION } from "@/lib/email/libelles";
import { ongletsCourrier } from "@/lib/email/onglets";
import { CLES_COURRIER } from "@/lib/email/permissions";
import { diagnostiquerSocleCourrier } from "@/lib/email/socle";
import { listerSuppressions } from "@/lib/email/source";
import type { LigneSuppression } from "@/lib/email/types";
import { formatDateTime } from "@/lib/format";

import { LeverSuppression } from "./lever";

export const metadata: Metadata = { title: "Liste de suppression · Oasis Admin" };

/**
 * ==================================================================
 * LA LISTE DE SUPPRESSION — ce qu'elle bloque, et ce qu'elle ne
 * bloque JAMAIS
 * ==================================================================
 *
 * ELLE NE GOUVERNE QUE LA PUBLICITÉ. Un rebond dur, une plainte, un
 * blocage du transporteur : rien de tout cela n'empêche un devis ou une
 * facture de partir. Le paysagiste voit un AVERTISSEMENT dans son
 * écran — « cette adresse a échoué le 3 mars, vérifiez-la » — et le
 * message part quand même.
 *
 * C'EST LE CHOIX LE PLUS DISCUTABLE DE 0084, ET IL EST LE BON. Bloquer
 * le transactionnel sur un rebond ou une plainte reproduirait
 * exactement le défaut catastrophique que tout ce chantier existe pour
 * empêcher — un client qui ne reçoit plus ses factures, et personne qui
 * sache pourquoi — simplement par une autre porte. Le pire des cas :
 * un client qui signale un devis comme indésirable verrait ensuite sa
 * FACTURE disparaître.
 *
 * Cette page l'écrit en haut, parce que c'est ici que quelqu'un aura un
 * jour l'idée de « faire le ménage » et de brancher cette liste sur
 * tout le courrier.
 *
 * ELLE EST GLOBALE AU PARC, aussi : tous les paysagistes expédient
 * depuis le même domaine, et une adresse qui se plaint se plaindra à
 * nouveau, quel que soit celui qui écrit. Une liste par entreprise
 * laisserait le deuxième refaire l'erreur du premier.
 */
export default async function SuppressionsPage() {
  const admin = await requireCourrier(CLES_COURRIER.suppressionsLire);
  const socle = await diagnostiquerSocleCourrier(admin.permissions, CLES_COURRIER.suppressionsLire);
  if (socle.etat !== "ok") {
    return (
      <EcranCourrierFerme
        etat={socle.etat}
        requise={CLES_COURRIER.suppressionsLire}
        titre="Liste de suppression"
        sousTitre="Les adresses qu'on ne sollicite plus en publicité."
      />
    );
  }

  const peutLever = peut(admin, CLES_COURRIER.suppressionsGerer);
  const onglets = ongletsCourrier(admin);

  let suppressions: LigneSuppression[] = [];
  try {
    suppressions = await listerSuppressions(false);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Courrier" title="Liste de suppression" />
        <ReadFailure error={error} />
      </>
    );
  }

  const actives = suppressions.filter((ligne) => ligne.released_at === null);
  const levees = suppressions.filter((ligne) => ligne.released_at !== null);
  const plaintes = actives.filter((ligne) => ligne.kind === "plainte").length;
  const rebonds = actives.filter((ligne) => ligne.kind === "rebondDur").length;

  return (
    <>
      <PageHeader
        eyebrow="Courrier"
        title="Liste de suppression"
        subtitle="Les adresses qu'on ne sollicite plus EN PUBLICITÉ. Globale au parc, parce que la réputation du domaine l'est aussi."
      />

      <Tabs items={onglets} current="/emails/suppressions" />

      <Notice tone="info" title="Cette liste n'a jamais empêché une facture d'arriver">
        Un rebond dur, une plainte ou un blocage du transporteur écarte l&apos;adresse de toute
        PUBLICITÉ, et de rien d&apos;autre. Les devis, les factures, les relances et les
        invitations partent quand même : le paysagiste voit un avertissement dans son écran, avec
        la date de l&apos;échec, et il lui appartient de vérifier l&apos;adresse auprès de son
        client. Brancher cette liste sur le transactionnel ferait disparaître les factures d&apos;un
        client qui aurait simplement cliqué « indésirable » sur un devis.
      </Notice>

      <StatStrip
        items={[
          { label: "Adresses écartées", value: String(actives.length) },
          {
            label: "Plaintes",
            value: String(plaintes),
            tone: plaintes > 0 ? "critical" : "neutral",
            note: "Le seul type qui abîme la réputation du domaine pour tout le parc.",
          },
          { label: "Rebonds durs", value: String(rebonds) },
          { label: "Levées", value: String(levees.length) },
        ]}
      />

      <div className="mt-5 flex flex-col gap-4">
        {suppressions.length === 0 ? (
          <EmptyState
            title="Aucune adresse écartée"
            description="La liste est vide. Ce n'est pas une donnée manquante : aucun rebond, aucune plainte et aucun désabonnement n'a encore été enregistré — ce qui est cohérent avec un produit qui n'a encore rien expédié."
          />
        ) : (
          suppressions.map((ligne) => {
            const active = ligne.released_at === null;
            return (
              <Card key={ligne.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/*
                      L'ADRESSE EST MASQUÉE, ET CE N'EST PAS DE LA
                      PUDEUR. Cette liste est alimentée depuis l'adresse
                      de tout message qui rebondit : elle contient donc,
                      en très grande majorité, les adresses des CLIENTS
                      FINAUX des paysagistes — des gens qui n'ont rien
                      signé avec Oasis Care. Le masque et le domaine
                      suffisent à répondre à « mon client dit qu'il n'a
                      rien reçu » ; l'adresse entière serait un carnet
                      d'adresses.
                    */}
                    <p className="font-mono text-[13px] font-medium text-ink">
                      {ligne.masked_email}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={active ? (TONS_SUPPRESSION[ligne.kind] ?? "neutral") : "neutral"}>
                        {LIBELLES_SUPPRESSION[ligne.kind] ?? ligne.kind}
                      </StatusBadge>
                      {!active && <StatusBadge tone="positive">Levée</StatusBadge>}
                      {ligne.occurrences > 1 && (
                        <StatusBadge tone="warning" dot={false}>
                          {ligne.occurrences} fois
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[var(--text-secondary)]">
                    <div>
                      <dt className="text-ink-faint">Première fois</dt>
                      <dd className="text-ink">{formatDateTime(ligne.first_seen_at) ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Dernière fois</dt>
                      <dd className="text-ink">{formatDateTime(ligne.last_seen_at) ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Domaine</dt>
                      <dd className="text-ink">{ligne.domain}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Source</dt>
                      <dd className="text-ink">{ligne.transporter_key ?? "Oasis Care"}</dd>
                    </div>
                  </dl>
                </div>

                {ligne.reason !== null && (
                  <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                    {ligne.reason}
                  </p>
                )}

                {!active && (
                  <p className="mt-2 rounded-[var(--radius-control)] border border-line bg-surface-sunken px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                    Levée le {formatDateTime(ligne.released_at) ?? "—"} : «{" "}
                    {ligne.released_reason} »
                  </p>
                )}

                {active && (
                  <div className="mt-3 border-t border-line pt-3">
                    {peutLever ? (
                      <LeverSuppression id={ligne.id} type={ligne.kind} />
                    ) : (
                      <p className="text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                        Lever une suppression exige{" "}
                        <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[11px]">
                          emails.suppression.manage
                        </code>
                        , réservée au super-administrateur et au responsable sécurité. Le support
                        lit cette liste sans pouvoir la modifier — c&apos;est ce qui lui permet de
                        répondre à « mon client dit qu&apos;il n&apos;a rien reçu » sans engager
                        la réputation du domaine.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
