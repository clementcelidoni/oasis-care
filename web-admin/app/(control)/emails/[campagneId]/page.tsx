import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  InfoCard,
  Notice,
  PageHeader,
  Panel,
  StatStrip,
  StatusBadge,
  UnknownValue,
  type Column,
} from "@/components/ui";
import { rendreApercu } from "@/lib/email/apercu";
import {
  empreinteAudience,
  repartirParForfait,
  type Ecartee,
  type Retenue,
} from "@/lib/email/audience";
import { EcranCourrierFerme } from "@/lib/email/ecran-ferme";
import { peut, requireCourrier } from "@/lib/email/guard";
import {
  estDistributionConnue,
  LIBELLES_EXCLUSION,
  LIBELLES_STATUT_CAMPAGNE,
  LIBELLES_STATUT_MESSAGE,
  TONS_EXCLUSION,
  TONS_STATUT_CAMPAGNE,
  TONS_STATUT_MESSAGE,
} from "@/lib/email/libelles";
import { CLES_COURRIER } from "@/lib/email/permissions";
import { diagnostiquerSocleCourrier } from "@/lib/email/socle";
import {
  apercuAudience,
  lireCampagne,
  lireEtatPlateforme,
  listerMessagesDeCampagne,
  PLAFOND_APERCU,
  type EtatPlateforme,
} from "@/lib/email/source";
import type { LigneCampagne, LigneMessage } from "@/lib/email/types";
import { formatDateTime } from "@/lib/format";

import { ConfirmerEnvoi } from "./confirmer-envoi";

export const metadata: Metadata = { title: "Annonce · Oasis Admin" };

/**
 * ==================================================================
 * UNE ANNONCE — AVANT, on montre ; APRÈS, on rend des comptes
 * ==================================================================
 *
 * AVANT L'ENVOI, l'écran répond à trois questions et à rien d'autre :
 * qui va recevoir exactement, qui est écarté et pourquoi, et à quoi
 * ressemble le message rendu sur un VRAI destinataire.
 *
 * L'AUDIENCE N'EST PAS ESTIMÉE. Pour chaque entreprise, la page pose à
 * la base les DEUX MÊMES QUESTIONS, DANS LE MÊME ORDRE, que
 * `email_enqueue()` posera : l'identité d'expéditeur — qui donne
 * l'adresse — puis la porte. Réimplémenter la règle du consentement en
 * TypeScript aurait produit une seconde règle, qui aurait divergé au
 * premier correctif ; le jour de la divergence, l'écran promet un envoi
 * que la base refuse, ou annonce un refus et laisse partir.
 *
 * APRÈS L'ENVOI, l'écran cesse de promettre et se met à compter : ce
 * qui est parti, ce qui a échoué, et — honnêtement — ce qu'on ne sait
 * pas encore parce que le transporteur ne l'a pas dit.
 */
export default async function AnnoncePage({ params }: PageProps<"/emails/[campagneId]">) {
  const { campagneId } = await params;

  const admin = await requireCourrier(CLES_COURRIER.campagnesLire);
  const socle = await diagnostiquerSocleCourrier(admin.permissions, CLES_COURRIER.campagnesLire);
  if (socle.etat !== "ok") {
    return (
      <EcranCourrierFerme
        etat={socle.etat}
        requise={CLES_COURRIER.campagnesLire}
        titre="Annonce commerciale"
      />
    );
  }

  const peutEnvoyer = peut(admin, CLES_COURRIER.campagnesEnvoyer);
  const peutLireJournal = peut(admin, CLES_COURRIER.journal);

  let campagne: LigneCampagne | null = null;
  let retenues: Retenue[] = [];
  let ecartees: Ecartee[] = [];
  let parMotif: { motif: keyof typeof LIBELLES_EXCLUSION; nombre: number }[] = [];
  let examinees = 0;
  let tronquee = false;
  let empreinte = "";
  let messages: LigneMessage[] = [];
  let socleEnvoi: EtatPlateforme | null = null;

  try {
    campagne = await lireCampagne(campagneId);

    // `notFound()` est APPELÉE HORS DU `try`. Elle lève une exception de
    // contrôle que Next intercepte ; l'attraper ici la ferait passer
    // pour une panne de lecture, et l'écran afficherait « la lecture a
    // échoué » à la place d'un 404. Le `catch` ne doit voir que de
    // vraies erreurs.
    if (campagne !== null) {
      if (campagne.status === "draft") {
        // AVANT LE GESTE, PAS APRÈS. Rédiger dix minutes puis apprendre
        // au clic que le serveur ne sait pas expédier fait perdre le
        // texte et la confiance.
        socleEnvoi = await lireEtatPlateforme();
        const apercu = await apercuAudience(campagne.template_key);
        retenues = apercu.audience.retenues;
        ecartees = apercu.audience.ecartees;
        parMotif = apercu.audience.parMotif;
        examinees = apercu.audience.examinees;
        tronquee = apercu.tronquee;
        empreinte = empreinteAudience(apercu.audience);
      } else if (peutLireJournal) {
        messages = await listerMessagesDeCampagne(campagneId);
      }
    }
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Courrier"
          title="Annonce commerciale"
          breadcrumb={{ label: "Annonces", href: "/emails" }}
        />
        <ReadFailure error={error} />
      </>
    );
  }

  if (campagne === null) notFound();

  const brouillon = campagne.status === "draft";
  const exemple = retenues[0] ?? null;
  const lignesApercu = rendreApercu(exemple?.nom ?? "votre entreprise", campagne.body_text);

  // Ce que le transporteur a dit, regroupé. « Remis au transporteur »
  // n'est PAS « distribué » : le second n'existe que si le retour du
  // transporteur est branché.
  const parStatut = new Map<string, number>();
  for (const message of messages) {
    parStatut.set(message.status, (parStatut.get(message.status) ?? 0) + 1);
  }
  const distributionConnue = messages.some((message) => estDistributionConnue(message.status));

  const colonnesMessages: Column<LigneMessage>[] = [
    { key: "to", header: "Destinataire", cell: (ligne) => ligne.to_email },
    {
      key: "statut",
      header: "État",
      cell: (ligne) => (
        <StatusBadge tone={TONS_STATUT_MESSAGE[ligne.status] ?? "neutral"}>
          {LIBELLES_STATUT_MESSAGE[ligne.status] ?? ligne.status}
        </StatusBadge>
      ),
    },
    {
      key: "motif",
      header: "Motif d'échec",
      cell: (ligne) =>
        ligne.failure_reason === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span className="text-ink-soft">{ligne.failure_reason}</span>
        ),
    },
    {
      key: "transporteur",
      header: "Transporteur",
      secondary: true,
      cell: (ligne) =>
        ligne.transporter_key === null ? (
          <UnknownValue
            compact
            reason="Aucun transporteur n'a encore pris ce message : il est en file."
          />
        ) : (
          <span className="text-ink-soft">{ligne.transporter_key}</span>
        ),
    },
    {
      key: "date",
      header: "Mis en file",
      secondary: true,
      cell: (ligne) => <span className="text-ink-soft">{formatDateTime(ligne.queued_at) ?? "—"}</span>,
    },
  ];

  const colonnesEcartees: Column<Ecartee>[] = [
    { key: "nom", header: "Entreprise", cell: (ligne) => ligne.nom },
    {
      key: "motif",
      header: "Motif",
      cell: (ligne) => (
        <StatusBadge tone={TONS_EXCLUSION[ligne.motif]}>
          {LIBELLES_EXCLUSION[ligne.motif]}
        </StatusBadge>
      ),
    },
    {
      key: "phrase",
      header: "Ce que dit la base",
      cell: (ligne) => <span className="text-ink-soft">{ligne.phrase}</span>,
    },
  ];

  const colonnesRetenues: Column<Retenue>[] = [
    { key: "nom", header: "Entreprise", cell: (ligne) => ligne.nom },
    {
      key: "destinataire",
      header: "Recevra à",
      cell: (ligne) => <span className="font-mono text-[12px] text-ink-soft">{ligne.destinataire}</span>,
    },
    {
      key: "affiche",
      header: "Signée par",
      cell: (ligne) => <span className="text-ink-soft">{ligne.nomAffiche}</span>,
    },
    {
      key: "reserves",
      header: "Réserves",
      secondary: true,
      cell: (ligne) =>
        ligne.avertissements.length === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span className="text-warning">{ligne.avertissements.join(" ")}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Annonce commerciale"
        title={campagne.title}
        breadcrumb={{ label: "Annonces", href: "/emails" }}
        subtitle={campagne.subject}
        action={
          <StatusBadge tone={TONS_STATUT_CAMPAGNE[campagne.status] ?? "neutral"}>
            {LIBELLES_STATUT_CAMPAGNE[campagne.status] ?? campagne.status}
          </StatusBadge>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <InfoCard label="Motif de la composition" value={campagne.reason} />
        <InfoCard
          label="Composée le"
          value={formatDateTime(campagne.created_at) ?? "—"}
          hint="Le motif et l'auteur sont aussi dans le journal des actions administratives."
        />
        <InfoCard
          label="Envoyée le"
          value={campagne.sent_at === null ? "Pas encore" : (formatDateTime(campagne.sent_at) ?? "—")}
        />
      </div>

      {campagne.status === "sending" && (
        <Notice tone="critical" title="Cet envoi s'est interrompu au milieu">
          L&apos;état « sending » est posé et remplacé dans la même transaction par
          `admin_send_email_campaign`. Le voir signifie que la fonction n&apos;est pas allée au
          bout. Les messages déjà mis en file sont partis ; la campagne ne peut pas être rejouée,
          et la clé d&apos;idempotence empêcherait de toute façon un double envoi vers les
          entreprises déjà servies.
        </Notice>
      )}

      {/* ================= AVANT L'ENVOI ========================= */}
      {brouillon && (
        <>
          <StatStrip
            items={[
              {
                label: "Recevront",
                value: String(retenues.length),
                tone: retenues.length === 0 ? "critical" : "positive",
                note: "Établi en interrogeant la base entreprise par entreprise, avec les mêmes questions que l'envoi.",
              },
              { label: "Écartées", value: String(ecartees.length) },
              {
                label: "Entreprises examinées",
                value: String(examinees),
                note: tronquee
                  ? `Le parc dépasse ${PLAFOND_APERCU} entreprises : cet aperçu est INCOMPLET.`
                  : undefined,
                tone: tronquee ? "critical" : "neutral",
              },
              {
                label: "Messages déjà partis",
                value: "0",
                note: "Rien n'est encore parti : cette annonce est un brouillon.",
              },
            ]}
          />

          {tronquee && (
            <Notice tone="critical" title="Cet aperçu est incomplet">
              Le parc compte plus de {PLAFOND_APERCU} entreprises, et cet écran s&apos;arrête là
              plutôt que d&apos;approximer. N&apos;envoyez pas : le nombre affiché serait faux
              sous un bouton irréversible. La correction est une fonction SQL qui rend
              l&apos;audience en une seule requête — voir le compte rendu du lot.
            </Notice>
          )}

          {/* LE RÉGLAGE SERVEUR, VÉRIFIÉ AVANT LE GESTE.
              `admin_send_email_campaign` lit l'adresse technique dans
              `current_setting('oasis.email_expediteur')`, qu'un appel
              PostgREST ne peut pas poser lui-même : elle doit être
              attachée au rôle de connexion de la base, une fois, à la
              main. La fonction REFUSE désormais de partir quand elle
              manque — la campagne reste un brouillon au lieu de se
              consommer sans rien envoyer — mais on le dit ici plutôt
              qu'au clic. */}
          {socleEnvoi === null ? (
            <Notice tone="warning" title="Nous n'avons pas pu vérifier le socle d'expédition">
              L&apos;état de la configuration d&apos;envoi n&apos;a pas pu être lu. La migration
              du courrier n&apos;est peut-être pas encore appliquée. L&apos;envoi refusera
              proprement si quelque chose manque — l&apos;annonce restera un brouillon — mais
              vous ne le saurez qu&apos;au clic.
            </Notice>
          ) : !socleEnvoi.sender_configured ? (
            <Notice
              tone="critical"
              title="Aucune annonce ne peut partir : l'adresse technique manque"
            >
              La base lit l&apos;adresse d&apos;expédition dans le réglage{" "}
              <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[11px]">
                oasis.email_expediteur
              </code>
              , qui n&apos;est pas posé. Il doit être attaché au rôle de connexion de la base —
              cet écran passe par PostgREST et ne peut pas le poser lui-même. L&apos;envoi
              refusera, et l&apos;annonce restera un brouillon : rien n&apos;est perdu, mais rien
              ne partira tant que le réglage manque. La marche à suivre est dans{" "}
              <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[11px]">
                docs/courriel-mise-en-service.md
              </code>
              .
            </Notice>
          ) : socleEnvoi.reply_to_email === null ? (
            <Notice
              tone="critical"
              title="Aucune annonce ne peut partir : l'adresse de réponse d'Oasis manque"
            >
              Une prospection doit dire à qui elle appartient, et permettre de lui répondre
              (art. L.34-5 CPCE). Tant que l&apos;adresse de réponse d&apos;Oasis Care n&apos;est
              pas enregistrée, chaque mise en file sera refusée et l&apos;annonce restera un
              brouillon.
            </Notice>
          ) : (
            <Notice
              tone="info"
              title={`Les annonces partiront au nom de « ${socleEnvoi.from_name ?? "Oasis Care"} »`}
            >
              Adresse technique : <strong>{socleEnvoi.technical_sender}</strong> — c&apos;est elle
              qui porte l&apos;authentification du domaine. Les réponses reviendront à{" "}
              <strong>{socleEnvoi.reply_to_email}</strong>, une boîte que quelqu&apos;un doit
              lire.
              {!socleEnvoi.legal_complete && (
                <>
                  {" "}
                  Le pied de vos annonces sera INCOMPLET : le SIRET ou l&apos;adresse postale
                  d&apos;Oasis Care ne sont pas renseignés.
                </>
              )}
            </Notice>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="Le message, rendu sur un vrai destinataire"
              description={
                exemple === null
                  ? "Aucun destinataire retenu : l'aperçu se rabat sur un nom générique."
                  : `Rendu pour « ${exemple.nom} ».`
              }
            >
              <div className="px-4 py-4">
                <p className="text-[var(--text-secondary)] text-ink-faint">Objet</p>
                <p className="mt-0.5 text-[var(--text-body)] font-medium text-ink">
                  {campagne.subject}
                </p>
                <div className="mt-3 border-t border-line pt-3">
                  {lignesApercu.map((ligne, index) => (
                    <p
                      key={index}
                      className="mb-2 text-[var(--text-body)] leading-relaxed text-ink last:mb-0"
                    >
                      {ligne}
                    </p>
                  ))}
                </div>
                <p className="mt-3 border-t border-line pt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                  L&apos;habillage, le pied avec les mentions, le logo et le lien de
                  désabonnement sont ajoutés par la couche d&apos;envoi et ne sont pas
                  reproduits ici. Cet aperçu montre le TEXTE, pas la mise en forme.
                </p>
              </div>
            </Panel>

            <div className="flex flex-col gap-5">
              <Panel title="Qui est écarté, et pourquoi" count={ecartees.length}>
                {parMotif.length === 0 ? (
                  <div className="px-4 py-4 text-[var(--text-body)] text-ink-soft">
                    Aucune entreprise écartée.
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {parMotif.map((compte) => (
                      <li
                        key={compte.motif}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <Badge tone={TONS_EXCLUSION[compte.motif]}>
                          {LIBELLES_EXCLUSION[compte.motif]}
                        </Badge>
                        <span className="tabular text-[var(--text-body)] font-medium text-ink">
                          {compte.nombre}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* LA COMPOSITION, QUI N'EST PAS UN FILTRE. Le ciblage par
                  forfait ou par essai a été demandé et n'est pas
                  livrable : la fonction d'envoi n'a aucun paramètre
                  d'audience. Une liste déroulante ici aurait annoncé
                  trente destinataires pour cinq cents servis. */}
              <Panel
                title="À qui, exactement"
                description="La composition de l'audience. Ce n'est pas un filtre."
              >
                {retenues.length === 0 ? (
                  <div className="px-4 py-4 text-[var(--text-body)] text-ink-soft">
                    Aucun destinataire.
                  </div>
                ) : (
                  <>
                    <ul className="divide-y divide-line">
                      {repartirParForfait(retenues).map((compte) => (
                        <li
                          key={compte.libelle}
                          className="flex items-center justify-between gap-3 px-4 py-2.5"
                        >
                          <span className="text-[var(--text-body)] text-ink-soft">
                            {compte.libelle}
                          </span>
                          <span className="tabular text-[var(--text-body)] font-medium text-ink">
                            {compte.nombre}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                      Une annonce part à TOUTES les entreprises qui passent la porte : la fonction
                      d&apos;envoi n&apos;accepte aucun critère. Choisir « seulement les essais »
                      demanderait un paramètre d&apos;audience côté base — sans lui, un sélecteur
                      ici annoncerait un nombre et le serveur en servirait un autre. En
                      attendant, la composition ci-dessus permet au moins d&apos;écrire un texte
                      qui convienne à tout le monde.
                    </p>
                  </>
                )}
              </Panel>
            </div>
          </div>

          {/* LE DÉFAUT QUE CETTE COLONNE A SERVI À TROUVER, ET QUI EST
              CORRIGÉ. `email_enqueue` recopiait l'identité de
              l'organisation qu'on lui passe — pour une campagne, celle
              qui REÇOIT : « Jardins Dupont » recevait une annonce
              d'Oasis Care signée « Jardins Dupont », dont les réponses
              revenaient dans sa propre boîte.
              `email_sender_identity` branche désormais sur la nature du
              gabarit : une publicité est signée par Oasis. La colonne
              reste, parce qu'elle est la PREUVE que c'est vrai — et le
              bandeau ci-dessous se rallume si deux entreprises
              affichaient deux expéditeurs différents. */}
          {retenues.length > 1
            && retenues.some((ligne) => ligne.nomAffiche !== retenues[0].nomAffiche) && (
            <Notice tone="critical" title="Deux annonces ne devraient pas avoir deux expéditeurs">
              Les entreprises retenues n&apos;affichent pas toutes le même expéditeur. Une annonce
              d&apos;Oasis Care doit être signée par Oasis Care, quelle que soit l&apos;entreprise
              qui la reçoit — sans quoi le destinataire reçoit un message signé de son propre nom,
              dont les réponses lui reviennent. N&apos;envoyez pas avant d&apos;avoir compris
              pourquoi.
            </Notice>
          )}

          <div className="mt-5 flex flex-col gap-5">
            <Panel
              title="Ces entreprises recevront le message"
              count={retenues.length}
              description="La liste exacte, telle que la base la calculera au moment de l'envoi."
            >
              <DataTable
                columns={colonnesRetenues}
                rows={retenues}
                rowKey={(ligne) => ligne.organizationId}
                empty={
                  <EmptyState
                    tone="unknown"
                    title="Personne ne recevrait ce message"
                    description="Aucune entreprise ne passe la porte. Le tableau des écartées, au-dessus, dit pourquoi — le plus souvent : aucun consentement préalable enregistré. Le consentement ne se présume pas rétroactivement ; il faut le recueillir dans les réglages de chaque entreprise."
                  />
                }
              />
            </Panel>

            {ecartees.length > 0 && (
              <Panel title="Le détail des écartées" count={ecartees.length}>
                <DataTable
                  columns={colonnesEcartees}
                  rows={ecartees}
                  rowKey={(ligne) => ligne.organizationId}
                  empty={<EmptyState title="Aucune" description="Rien à afficher." />}
                />
              </Panel>
            )}

            <Panel
              title="Envoyer"
              description="Après avoir lu la liste ci-dessus, et pas avant."
            >
              {peutEnvoyer ? (
                <ConfirmerEnvoi
                  campagneId={campagne.id}
                  destinataires={retenues.length}
                  empreinte={empreinte}
                  secondFacteurActif={admin.mfa.currentLevel === "aal2"}
                />
              ) : (
                <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
                  Votre rôle lit cette annonce mais ne l&apos;envoie pas.{" "}
                  <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
                    emails.campaigns.send
                  </code>{" "}
                  est réservée au super-administrateur et au responsable produit.
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* ================= APRÈS L'ENVOI ========================== */}
      {!brouillon && (
        <>
          <StatStrip
            items={[
              {
                label: "Mis en file",
                value: campagne.queued_count === null ? null : String(campagne.queued_count),
                unknownReason:
                  "La fonction d'envoi n'a pas rendu de compte : elle s'est probablement interrompue.",
              },
              {
                label: "Écartés par la porte",
                value: campagne.skipped_count === null ? null : String(campagne.skipped_count),
                unknownReason: "Idem.",
                note: "Ne compte que les entreprises visitées : ni les archivées, ni celles sans adresse.",
              },
              {
                label: "Distribués",
                value: distributionConnue
                  ? String(parStatut.get("delivered") ?? 0)
                  : null,
                unknownReason:
                  "Aucun message n'a encore reçu de nouvelle du transporteur. « Remis au transporteur » n'est pas « distribué » : compter les premiers comme des reçus afficherait 100 % de distribution à un produit qui ne mesure rien. Ce chiffre restera inconnu tant que le retour du transporteur n'est pas branché.",
              },
              {
                label: "Rebonds et plaintes",
                value: distributionConnue
                  ? String(
                      (parStatut.get("bounced") ?? 0) +
                        (parStatut.get("complained") ?? 0) +
                        (parStatut.get("blocked") ?? 0),
                    )
                  : null,
                unknownReason:
                  "Un rebond n'est connu que par le transporteur. Afficher zéro ici ferait croire que tout est arrivé.",
                tone: "critical",
              },
            ]}
          />

          {!peutLireJournal ? (
            <Card className="p-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Le détail message par message exige{" "}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
                emails.log.read
              </code>
              , que votre rôle ne porte pas. Les nombres ci-dessus viennent de la ligne de
              l&apos;annonce, que vous avez le droit de lire ; la liste des destinataires, non.
            </Card>
          ) : (
            <Panel title="Ce qui est parti, message par message" count={messages.length}>
              <DataTable
                columns={colonnesMessages}
                rows={messages}
                rowKey={(ligne) => ligne.id}
                empty={
                  <EmptyState
                    tone="unknown"
                    title="Aucun message pour cette annonce"
                    description="La campagne est marquée comme envoyée, mais le journal ne porte aucune ligne. La cause la plus probable est que l'adresse technique d'expédition n'était pas configurée sur la base : chaque mise en file a été refusée. L'annonce ne peut pas être rejouée ; posez le réglage, puis composez-en une nouvelle."
                  />
                }
                footer={
                  <span className="text-[var(--text-secondary)] text-ink-faint">
                    Le journal est en ajout seul : ni l&apos;objet, ni le corps, ni le
                    destinataire d&apos;un message parti ne peuvent être réécrits. C&apos;est ce
                    qui permet de répondre à « le client dit que le texte disait autre chose ».
                  </span>
                }
              />
            </Panel>
          )}
        </>
      )}
    </>
  );
}
