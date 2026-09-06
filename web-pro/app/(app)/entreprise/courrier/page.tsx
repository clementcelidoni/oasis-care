import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { PageHeader, Panel, SubmitButton, Badge, EmptyState, type Tone } from "@/components/ui";
import { CompanyTabs } from "../CompanyTabs";
import { enregistrerConsentementCommercial } from "./actions";
import { TEXTE_CONSENTEMENT } from "./texte";

/**
 * §EMAILS — CE QUE LE PAYSAGISTE DOIT POUVOIR VOIR DE SON COURRIER.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS PROMESSES DE LA MIGRATION 0084 TOMBAIENT À VIDE
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucun écran du produit ne lisait `email_messages`,
 * `email_organization_settings` ni `email_consent_state`. Trois
 * conséquences, et aucune n'est cosmétique :
 *
 *   1. LES REBONDS REVIENNENT CHEZ OASIS, PAS CHEZ LE PAYSAGISTE. C'est
 *      le prix du motif CRM : c'est notre domaine qui expédie, donc
 *      c'est notre infrastructure qui apprend qu'une adresse client est
 *      fausse. Si l'entreprise ne le voit pas, elle attend la réponse à
 *      un devis jamais arrivé, et le produit ment par omission. Cet
 *      écran est la contrepartie annoncée.
 *
 *   2. LA SUSPENSION COUPE TOUT, FACTURES COMPRISES. C'est le seul
 *      endroit du chantier où un transactionnel s'arrête, et 0084 le
 *      rend acceptable à trois conditions : un humain décide, un motif
 *      est obligatoire, et L'ENTREPRISE LIT LA LIGNE DANS SON ÉCRAN.
 *      Sans cet écran, la troisième condition n'était pas tenue.
 *
 *   3. LE CONSENTEMENT COMMERCIAL N'AVAIT AUCUN MOYEN D'ÊTRE DONNÉ.
 *      `email_record_consent` n'avait pas d'appelant : la porte
 *      refusait donc chaque adresse, et toute campagne rendait « 0 mis
 *      en file » — ce qui ressemble à une panne bien plus qu'à un refus
 *      compris.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA MIGRATION PEUT NE PAS ÊTRE APPLIQUÉE, ET L'ÉCRAN LE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Tant que 0084 n'est pas posée, ces tables n'existent pas. PostgREST
 * rend alors une erreur, et cet écran doit distinguer « rien n'est
 * encore parti » de « le socle n'est pas là ». Confondre les deux
 * afficherait un calme rassurant sur une absence.
 */

export const dynamic = "force-dynamic";

type LigneMessage = {
  id: string;
  template_key: string;
  status: string;
  to_email: string;
  subject: string;
  queued_at: string;
  sent_at: string | null;
  failure_reason: string | null;
  failure_code: string | null;
  warnings: string[] | null;
  entity_type: string;
  entity_id: string;
};

const LIBELLE_GABARIT: Record<string, string> = {
  devisEnvoye: "Devis",
  devisRelance: "Relance de devis",
  factureEmise: "Facture",
  factureRelance: "Relance de facture",
  invitationPortail: "Invitation au portail",
  bienvenueEntreprise: "Bienvenue",
  parametreImportant: "Changement de paramètre",
  annonceCommerciale: "Annonce d'Oasis Care",
};

/**
 * L'ÉTAT, DIT COMME ON LE DIRAIT À QUELQU'UN.
 *
 * « Mis en file » n'est jamais présenté comme « reçu », et
 * « sort inconnu » n'est présenté ni comme l'un ni comme l'autre : quand
 * la réponse du transporteur s'est perdue, le message est PEUT-ÊTRE
 * parti, et choisir la réponse qui arrange serait mentir dans le seul
 * écran qui répond à « mon client dit qu'il n'a rien reçu ».
 */
function etatLisible(ligne: LigneMessage): { texte: string; ton: Tone } {
  if (ligne.failure_code === "sortInconnu") {
    return { texte: "Sort inconnu — à vérifier", ton: "warning" };
  }
  switch (ligne.status) {
    case "queued":
      return { texte: "En attente d'envoi", ton: "neutral" };
    case "sending":
      return { texte: "En cours d'envoi", ton: "neutral" };
    case "sent":
      return { texte: "Parti", ton: "positive" };
    case "delivered":
      return { texte: "Remis", ton: "positive" };
    case "deferred":
      return { texte: "Retardé par le destinataire", ton: "warning" };
    case "bounced":
      return { texte: "N'est pas arrivé", ton: "critical" };
    case "complained":
      return { texte: "Signalé comme indésirable", ton: "critical" };
    case "blocked":
      return { texte: "Refusé par le transporteur", ton: "critical" };
    case "failed":
      return { texte: "Échec", ton: "critical" };
    case "cancelled":
      return { texte: "Annulé avant l'envoi", ton: "neutral" };
    default:
      // On affiche la valeur brute plutôt que « inconnu » : un état que
      // l'interface ne connaît pas est une information, pas un trou.
      return { texte: ligne.status, ton: "neutral" };
  }
}

function dateCourte(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default async function CourrierPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const supabase = await createClient();

  const [reglages, messages, consentement] = await Promise.all([
    supabase
      .from("email_organization_settings")
      .select("suspended_at, suspended_reason, reminders_enabled, reminder_delay_days, reminder_max")
      .eq("organization_id", organization.organizationId)
      .maybeSingle(),
    supabase
      .from("email_messages")
      .select(
        "id, template_key, status, to_email, subject, queued_at, sent_at, failure_reason, failure_code, warnings, entity_type, entity_id",
      )
      .eq("organization_id", organization.organizationId)
      .order("queued_at", { ascending: false })
      .limit(50),
    supabase
      .from("email_consent_state")
      .select("consented_at, unsubscribed_at, can_receive_marketing")
      .eq("organization_id", organization.organizationId)
      .maybeSingle(),
  ]);

  // LE SOCLE EST-IL LÀ ? Une table absente n'est pas « aucun message ».
  const socleAbsent = messages.error !== null && reglages.error !== null;

  const lignes = (messages.data ?? []) as LigneMessage[];
  const suspension = reglages.data as
    | {
        suspended_at: string | null;
        suspended_reason: string | null;
        reminders_enabled: boolean;
        reminder_delay_days: number;
        reminder_max: number;
      }
    | null;
  const consent = consentement.data as
    | { consented_at: string | null; unsubscribed_at: string | null; can_receive_marketing: boolean }
    | null;

  const canEdit = organization.permissions.includes("organization.manageUsers");
  const enProbleme = lignes.filter(
    (l) =>
      l.failure_code === "sortInconnu" ||
      ["bounced", "complained", "blocked", "failed"].includes(l.status),
  );

  return (
    <div>
      <PageHeader
        title="Courrier"
        subtitle="Ce qu'Oasis Care envoie à vos clients en votre nom, et ce qui n'est pas arrivé."
      />
      <CompanyTabs current="/entreprise/courrier" />

      {socleAbsent && (
        <Panel title="Le courrier n'est pas encore installé sur ce serveur">
          <p className="text-sm text-ink-soft">
            La partie « courrier » du produit n&apos;est pas encore posée sur la base de données.
            Aucun message n&apos;est envoyé, et cet écran ne peut rien montrer. Ce n&apos;est pas
            une panne : c&apos;est une installation à terminer.
          </p>
        </Panel>
      )}

      {/* ══ LA SUSPENSION ══════════════════════════════════════════
          Elle vient en premier parce qu'elle coupe TOUT, factures
          comprises. Une entreprise coupée qui ne le saurait pas
          attendrait des réponses à des messages jamais partis. */}
      {suspension?.suspended_at && (
        <Panel title="Votre courrier est suspendu">
          <p className="text-sm text-ink">
            Oasis Care a suspendu l&apos;expédition de votre courrier le{" "}
            <strong>{dateCourte(suspension.suspended_at)}</strong>.{" "}
            <strong>Plus aucun message ne part</strong> — ni vos devis, ni vos factures.
          </p>
          <p className="mt-3 rounded-lg bg-canvas px-3.5 py-3 text-sm text-ink-soft">
            Motif : {suspension.suspended_reason}
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            Vos documents restent valables et consultables : c&apos;est leur envoi par courriel
            qui est arrêté. Contactez-nous pour rétablir l&apos;expédition.
          </p>
        </Panel>
      )}

      {/* ══ CE QUI N'EST PAS ARRIVÉ ═══════════════════════════════ */}
      {!socleAbsent && (
        <Panel
          title="Ce qui n'est pas arrivé"
          description="Les rebonds reviennent chez Oasis Care, parce que c'est notre domaine qui expédie pour vous. Vous les lisez ici."
        >
          {enProbleme.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Aucun message en échec sur les cinquante derniers envois.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {enProbleme.map((ligne) => {
                const etat = etatLisible(ligne);
                return (
                  <li key={ligne.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={etat.ton}>{etat.texte}</Badge>
                      <span className="text-sm font-medium text-ink">
                        {LIBELLE_GABARIT[ligne.template_key] ?? ligne.template_key}
                      </span>
                      <span className="text-xs text-ink-faint">
                        à {ligne.to_email} · {dateCourte(ligne.queued_at)}
                      </span>
                    </div>
                    {ligne.failure_reason && (
                      <p className="mt-1 text-sm text-ink-soft">{ligne.failure_reason}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {/* ══ LE JOURNAL ════════════════════════════════════════════ */}
      {!socleAbsent && (
        <Panel
          title="Vos cinquante derniers envois"
          description="« Parti » veut dire remis au transporteur. « Remis » veut dire arrivé chez le destinataire — et nous ne le savons que lorsqu'il nous le dit."
        >
          {lignes.length === 0 ? (
            <EmptyState
              title="Aucun message pour l'instant"
              description="Vos devis et vos factures partiront d'ici dès que vous les marquerez comme envoyés ou émis."
            />
          ) : (
            <ul className="divide-y divide-line">
              {lignes.map((ligne) => {
                const etat = etatLisible(ligne);
                return (
                  <li key={ligne.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Badge tone={etat.ton}>{etat.texte}</Badge>
                    <span className="text-sm text-ink">
                      {LIBELLE_GABARIT[ligne.template_key] ?? ligne.template_key}
                    </span>
                    <span className="text-xs text-ink-faint">{ligne.subject}</span>
                    <span className="ml-auto text-xs text-ink-faint">
                      {dateCourte(ligne.sent_at ?? ligne.queued_at)}
                    </span>
                    {(ligne.warnings ?? []).length > 0 && (
                      <p className="w-full text-xs text-ink-faint">
                        {(ligne.warnings ?? []).join(" ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {/* ══ LES RELANCES ══════════════════════════════════════════ */}
      {!socleAbsent && (
        <Panel title="Les relances automatiques">
          <p className="text-sm text-ink-soft">
            {suspension?.reminders_enabled
              ? `Activées : une relance après ${suspension.reminder_delay_days} jours, ${suspension.reminder_max} au maximum.`
              : "Désactivées. Aucune relance ne part sans que vous l'ayez demandé."}
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Même activées, les relances ne partent pas encore toutes seules : Oasis Care
            n&apos;a pas de planificateur. Elles se déclenchent quand vous ouvrez cet écran
            ou depuis un appel manuel. C&apos;est dit ici plutôt que découvert plus tard.
          </p>
        </Panel>
      )}

      {/* ══ LE CONSENTEMENT COMMERCIAL ════════════════════════════ */}
      <Panel
        title="Les nouveautés d'Oasis Care"
        description="Ce choix ne concerne QUE nos communications commerciales. Vos devis, vos factures et les messages de votre compte partent et arrivent quoi qu'il arrive."
      >
        <form action={enregistrerConsentementCommercial}>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="consentement"
              value="oui"
              defaultChecked={consent?.can_receive_marketing === true}
              disabled={!canEdit}
              className="mt-1 h-4 w-4 rounded border-line"
            />
            <span className="text-sm text-ink-soft">{TEXTE_CONSENTEMENT}</span>
          </label>

          {consent?.consented_at && !consent.unsubscribed_at && (
            <p className="mt-3 text-xs text-ink-faint">
              Consentement enregistré le {dateCourte(consent.consented_at)}.
            </p>
          )}
          {consent?.unsubscribed_at && (
            <p className="mt-3 text-xs text-ink-faint">
              Désabonnement enregistré le {dateCourte(consent.unsubscribed_at)}.
            </p>
          )}

          {canEdit ? (
            <div className="mt-4">
              <SubmitButton>Enregistrer mon choix</SubmitButton>
            </div>
          ) : (
            <p className="mt-4 text-xs text-ink-faint">
              Seul un responsable de l&apos;entreprise peut modifier ce choix.
            </p>
          )}
        </form>
      </Panel>
    </div>
  );
}
