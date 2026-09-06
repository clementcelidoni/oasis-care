import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  StatStrip,
  StatusBadge,
  Tabs,
  UnknownValue,
} from "@/components/ui";
import { EcranCourrierFerme } from "@/lib/email/ecran-ferme";
import { peut, requireCourrier } from "@/lib/email/guard";
import { LIBELLES_ALERTE, TONS_ALERTE } from "@/lib/email/libelles";
import { ongletsCourrier } from "@/lib/email/onglets";
import { CLES_COURRIER } from "@/lib/email/permissions";
import { diagnostiquerSocleCourrier } from "@/lib/email/socle";
import {
  listerEntreprisesDuParc,
  listerReglagesEntreprises,
  listerReputation,
} from "@/lib/email/source";
import type { LigneReglagesEntreprise, LigneReputation } from "@/lib/email/types";
import { formatDateTime } from "@/lib/format";

import { Interrupteur } from "./interrupteur";

export const metadata: Metadata = { title: "Délivrabilité · Oasis Admin" };

/**
 * ==================================================================
 * LA DÉLIVRABILITÉ DU PARC — et ce que cet écran NE MESURE PAS
 * ==================================================================
 *
 * LE RISQUE LE PLUS SÉRIEUX DU CHANTIER EST ICI. Tout le parc expédie
 * depuis le même domaine authentifié. Un seul paysagiste qui se fait
 * signaler comme indésirable fait tomber la délivrabilité de TOUS — y
 * compris les factures d'abonnement d'Oasis Care et les messages
 * d'authentification, qui passent par le même domaine et qui
 * fonctionnent aujourd'hui.
 *
 * ------------------------------------------------------------------
 * CET ÉCRAN VOIT MAINTENANT TOUT LE COURRIER — ET VOICI CE QU'IL NE
 * MONTRE TOUJOURS PAS
 * ------------------------------------------------------------------
 * Il lisait la vue `email_organization_reputation`, qui est
 * `security_invoker = true` : elle ne comptait que les messages que
 * L'APPELANT a le droit de lire, et la seule politique de
 * `email_messages` ouverte à un administrateur d'Oasis est
 * `nature = 'publicite'`. Un paysagiste qui venait de faire rebondir
 * deux cents devis n'avait donc AUCUNE ligne ici. Autrement dit, la
 * personne qui peut suspendre une entreprise ne voyait pas ce qui
 * justifierait de la suspendre — sur le risque numéro un du chantier.
 *
 * Il lit désormais `admin_email_reputation()` (0084 § 13.e), une
 * fonction `security definer` qui compte TOUS les messages du parc.
 * Elle ne rend QUE DES NOMBRES : ni adresse, ni objet, ni corps de
 * message. C'est la règle R5 tenue à la lettre — de quoi décider d'une
 * suspension, et rien de plus. Les devis et les factures des
 * paysagistes restent des données métier que cet écran ne montre pas.
 */
export default async function DelivrabilitePage() {
  const admin = await requireCourrier(CLES_COURRIER.journal);
  const socle = await diagnostiquerSocleCourrier(admin.permissions, CLES_COURRIER.journal);
  if (socle.etat !== "ok") {
    return (
      <EcranCourrierFerme
        etat={socle.etat}
        requise={CLES_COURRIER.journal}
        titre="Délivrabilité"
        sousTitre="Rebonds, plaintes et suspensions, entreprise par entreprise."
      />
    );
  }

  const peutSuspendre = peut(admin, CLES_COURRIER.suspendre);
  const onglets = ongletsCourrier(admin);

  let reputations: LigneReputation[] = [];
  let reglages: LigneReglagesEntreprise[] = [];
  let noms = new Map<string, string>();

  try {
    const [rep, reg, parc] = await Promise.all([
      listerReputation(),
      listerReglagesEntreprises(),
      listerEntreprisesDuParc(),
    ]);
    reputations = rep;
    reglages = reg;
    noms = new Map(parc.entreprises.map((e) => [e.organization_id, e.name]));
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Courrier" title="Délivrabilité" />
        <ReadFailure error={error} />
      </>
    );
  }

  const parOrganisation = new Map(reputations.map((ligne) => [ligne.organization_id, ligne]));
  const suspendues = reglages.filter((ligne) => ligne.suspended_at !== null);

  // Toutes les entreprises connues, qu'elles aient ou non une ligne de
  // réputation : une entreprise ABSENTE de la vue n'est pas une
  // entreprise sans problème, c'est une entreprise dont on ne sait
  // rien. Les deux se ressemblent à l'écran, et ce sont des faits
  // opposés.
  const lignes = [...noms.entries()]
    .map(([organizationId, nom]) => ({
      organizationId,
      nom,
      reputation: parOrganisation.get(organizationId) ?? null,
      reglage: reglages.find((r) => r.organization_id === organizationId) ?? null,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  const critiques = reputations.filter((ligne) => ligne.alert_level === "critique").length;
  const surveillance = reputations.filter((ligne) => ligne.alert_level === "surveillance").length;

  return (
    <>
      <PageHeader
        eyebrow="Courrier"
        title="Délivrabilité"
        subtitle="La réputation du domaine est commune à tout le parc. Un seul expéditeur peut la détruire pour les autres."
      />

      <Tabs items={onglets} current="/emails/delivrabilite" />

      <Notice tone="info" title="Des nombres, jamais des messages">
        Ces chiffres comptent TOUT le courrier de chaque entreprise — devis, factures, relances
        et annonces — sur trente jours glissants. Ils viennent d&apos;une fonction d&apos;agrégation
        qui compte sans jamais montrer : vous ne verrez ici ni adresse de client, ni objet, ni
        corps de message. Les documents d&apos;un paysagiste restent ses données métier (spec
        p.36) ; ce qui vous est ouvert, c&apos;est de quoi décider d&apos;une suspension.
      </Notice>

      <StatStrip
        items={[
          {
            label: "Entreprises suivies",
            value: String(reputations.length),
            note: "Toutes les entreprises non archivées. Celles à zéro message n'ont rien à mesurer, pas « rien à signaler ».",
          },
          {
            label: "En alerte critique",
            value: String(critiques),
            tone: critiques > 0 ? "critical" : "neutral",
          },
          {
            label: "À surveiller",
            value: String(surveillance),
            tone: surveillance > 0 ? "critical" : "neutral",
          },
          {
            label: "Expéditions suspendues",
            value: String(suspendues.length),
            tone: suspendues.length > 0 ? "critical" : "neutral",
          },
        ]}
      />

      <p className="mt-4 mb-5 max-w-4xl text-[var(--text-body)] leading-relaxed text-ink-soft">
        Les seuils de la base : alerte à partir de 0,1 % de plaintes ou 5 % de rebonds sur trente
        jours glissants, critique à 0,3 % et 10 %. En dessous de vingt messages, aucun taux
        n&apos;est calculé — un envoi unique qui rebondit afficherait 100 %. Et rien ne se coupe
        tout seul : une coupure automatique arrêterait les factures d&apos;un paysagiste sans que
        personne ne l&apos;ait décidé.
      </p>

      <div className="flex flex-col gap-4">
        {lignes.length === 0 ? (
          <EmptyState
            title="Aucune entreprise"
            description="Le parc est vide, ou la liste des entreprises n'a rien rendu."
          />
        ) : (
          lignes.map((ligne) => {
            const suspendue = ligne.reglage?.suspended_at != null;
            return (
              <Card key={ligne.organizationId} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[length:var(--text-card)] font-medium text-ink">
                      {ligne.nom}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {ligne.reputation === null ? (
                        <UnknownValue
                          inline
                          label="Aucune donnée"
                          reason="Cette entreprise n'a envoyé aucun message sur les trente derniers jours. Ce n'est pas « rien à signaler » : c'est « rien à mesurer »."
                        />
                      ) : (
                        <StatusBadge tone={TONS_ALERTE[ligne.reputation.alert_level] ?? "neutral"}>
                          {LIBELLES_ALERTE[ligne.reputation.alert_level] ??
                            ligne.reputation.alert_level}
                        </StatusBadge>
                      )}
                      {suspendue && <StatusBadge tone="critical">Expédition suspendue</StatusBadge>}
                    </div>
                  </div>

                  {ligne.reputation !== null && (
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[var(--text-secondary)]">
                      <div>
                        <dt className="text-ink-faint">Messages sur 30 j</dt>
                        <dd className="tabular font-medium text-ink">
                          {ligne.reputation.sent_count}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-faint">Rebonds</dt>
                        <dd className="tabular font-medium text-ink">
                          {ligne.reputation.bounced_count}
                          {ligne.reputation.bounce_rate_percent !== null &&
                            ` (${ligne.reputation.bounce_rate_percent} %)`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-faint">Plaintes</dt>
                        <dd className="tabular font-medium text-critical">
                          {ligne.reputation.complained_count}
                          {ligne.reputation.complaint_rate_percent !== null &&
                            ` (${ligne.reputation.complaint_rate_percent} %)`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-faint">Bloqués</dt>
                        <dd className="tabular font-medium text-ink">
                          {ligne.reputation.blocked_count}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>

                {suspendue && ligne.reglage !== null && (
                  <div className="mt-3 rounded-[var(--radius-control)] border border-critical/40 bg-critical-wash px-3 py-2">
                    <p className="text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                      Suspendue le {formatDateTime(ligne.reglage.suspended_at) ?? "—"}. Motif,
                      lisible par l&apos;entreprise elle-même : « {ligne.reglage.suspended_reason} »
                    </p>
                  </div>
                )}

                <div className="mt-3 border-t border-line pt-3">
                  {peutSuspendre ? (
                    <Interrupteur
                      organizationId={ligne.organizationId}
                      nom={ligne.nom}
                      suspendue={suspendue}
                    />
                  ) : (
                    <p className="text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                      Suspendre ou rétablir l&apos;expédition exige{" "}
                      <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[11px]">
                        emails.sending.suspend
                      </code>
                      , réservée au super-administrateur et au responsable sécurité. Celui qui
                      envoie la publicité ne lève pas le garde-fou qui la borne.
                    </p>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Panel className="mt-5" title="Ce que la suspension coupe">
        <div className="px-4 py-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
          <p>
            TOUT, y compris les factures. C&apos;est le seul endroit du produit où un message
            transactionnel peut être arrêté, et c&apos;est acceptable à trois conditions, toutes
            tenues : un humain le décide, un motif est obligatoire, et l&apos;entreprise LIT ce
            motif dans son propre écran — sans quoi son courrier s&apos;arrêterait sans un mot et
            le produit mentirait par omission.
          </p>
          <p className="mt-2">
            Ce qu&apos;elle ne fait PAS : suspendre une entreprise n&apos;inscrit aucune adresse à
            la liste de suppression, et lever une suppression ne rétablit aucune expédition. Ce
            sont deux mécanismes séparés, et les confondre reviendrait à punir une adresse pour
            le comportement d&apos;une entreprise.
          </p>
        </div>
      </Panel>
    </>
  );
}
