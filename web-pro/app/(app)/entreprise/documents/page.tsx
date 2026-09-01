import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { Badge, ButtonLink, ConfirmDialog, EmptyState, PageHeader, Panel } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { deleteCompanyDocument } from "@/lib/company/actions";
import { CompanyTabs } from "../CompanyTabs";
import { DOCUMENT_KINDS, DocumentUploader } from "./DocumentUploader";

/**
 * §45 DOCUMENTS SOCIÉTÉ — « stockage sécurisé : KBIS ; RIB ; assurances ;
 * certifications ; documents administratifs. Permissions spécifiques. »
 *
 * Le classeur de l'entreprise. Ce n'est pas une bibliothèque de
 * fichiers : ce sont les pièces qu'un client, un donneur d'ordre, une
 * banque ou un contrôle réclament, et qu'on cherche toujours dans la
 * mauvaise boîte mail le jour où ils les demandent.
 *
 * D'où la colonne qui justifie l'écran à elle seule : la DATE
 * D'EXPIRATION. Une attestation d'assurance périmée ne protège de rien
 * et fait perdre un marché — et personne ne pense à la remplacer avant
 * qu'on la réclame. Cet écran le dit avant, pas pendant.
 */

/** Le même préavis que l'attestation d'assurance de la fiche société. */
const WARNING_DAYS = 60;

/**
 * L'URL signée vaut une heure : le seau est PRIVÉ (migration 0060) et
 * une adresse permanente circulerait ensuite hors de tout contrôle
 * d'accès, y compris après le départ de la personne qui l'a copiée.
 */
const SIGNED_URL_SECONDS = 3600;

type DocumentRow = {
  id: string;
  kind: string;
  name: string;
  storage_path: string;
  size_bytes: number | null;
  expires_on: string | null;
  created_at: string;
};

function formatSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Le nom proposé au téléchargement. La ligne porte un libellé lisible
 * (« Attestation RC Pro 2026 ») tandis que l'extension vit dans le
 * chemin de stockage : sans elle, le fichier arrive sur le bureau du
 * destinataire sans que rien ne sache l'ouvrir.
 */
function downloadName(name: string, storagePath: string): string {
  const file = storagePath.slice(storagePath.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const extension = dot > 0 ? file.slice(dot) : "";
  if (!extension || name.toLowerCase().endsWith(extension.toLowerCase())) return name;
  return `${name}${extension}`;
}

/**
 * Les jours restants, comptés en journées calendaires UTC. Comparer des
 * horodatages complets ferait passer un document en « expiré » à midi ;
 * une pièce valable jusqu'au 3 l'est toute la journée du 3.
 */
function daysUntil(date: string, todayUtc: number): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - todayUtc) / 86_400_000);
}

export default async function CompanyDocumentsPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  // §45 « Permissions spécifiques » : la politique RLS de la table
  // (migration 0060) exige `organization.manageUsers` EN LECTURE aussi
  // — un RIB n'est pas une photo de chantier. Pour les autres, la
  // requête ne renverrait rien : afficher « aucun document » serait un
  // mensonge, on annonce donc la restriction et on s'arrête là.
  const canManage = organization.permissions.includes("organization.manageUsers");

  if (!canManage) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <PageHeader
          title="Documents"
          subtitle="Les pièces administratives de l'entreprise."
          action={<Badge tone="neutral">Accès restreint</Badge>}
        />
        <CompanyTabs current="/entreprise/documents" />
        <EmptyState
          icon={<Icon name="document" className="h-6 w-6" />}
          title="Réservé aux administrateurs"
          description="Le KBIS, le RIB et les attestations d'assurance ne sont consultables que par les administrateurs de l'entreprise. Demandez-leur la pièce dont vous avez besoin."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_documents")
    .select("id, kind, name, storage_path, size_bytes, expires_on, created_at")
    .eq("organization_id", organization.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as DocumentRow[];

  // Une URL par document plutôt qu'un appel groupé : `createSignedUrls`
  // n'accepte qu'un seul nom de téléchargement pour tout le lot, et
  // douze fichiers arrivant sous le même nom rendraient le classeur
  // inutilisable.
  const documents = await Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from("organization-documents")
        .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS, {
          download: downloadName(row.name, row.storage_path),
        });
      return { ...row, url: signed?.signedUrl ?? null };
    }),
  );

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const expired = documents.filter(
    (doc) => doc.expires_on !== null && daysUntil(doc.expires_on, todayUtc) < 0,
  );
  const expiring = documents.filter((doc) => {
    if (doc.expires_on === null) return false;
    const left = daysUntil(doc.expires_on, todayUtc);
    return left >= 0 && left <= WARNING_DAYS;
  });

  // Le `kind` est verrouillé par une contrainte `check`, mais une
  // valeur arrivée en base sans passer par cet écran ne doit pas faire
  // disparaître la ligne : elle atterrit dans « Autres documents ».
  const known = new Set<string>(DOCUMENT_KINDS.map((kind) => kind.value));
  const groups = DOCUMENT_KINDS.map((kind) => ({
    ...kind,
    documents: documents.filter(
      (doc) => (known.has(doc.kind) ? doc.kind : "other") === kind.value,
    ),
  })).filter((group) => group.documents.length > 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Documents"
        subtitle="Le KBIS, le RIB, les attestations d'assurance et les certifications de l'entreprise, rangés au même endroit."
        action={
          <Badge tone="accent">
            {documents.length === 1 ? "1 document" : `${documents.length} documents`}
          </Badge>
        }
      />

      <CompanyTabs current="/entreprise/documents" />

      {/* L'avertissement AVANT la liste : c'est la seule information de
          cet écran qui demande une action aujourd'hui. */}
      {(expired.length > 0 || expiring.length > 0) && (
        <div
          className={`mb-6 rounded-[var(--radius-card)] border px-4 py-3 ${
            expired.length > 0
              ? "border-critical/30 bg-critical-wash"
              : "border-warning/30 bg-warning-wash"
          }`}
        >
          <p
            className={`text-[var(--text-body)] font-medium ${
              expired.length > 0 ? "text-critical" : "text-warning"
            }`}
          >
            {[
              expired.length === 1
                ? "Un document est expiré"
                : expired.length > 1
                  ? `${expired.length} documents sont expirés`
                  : null,
              expiring.length === 1
                ? `Un document expire dans moins de ${WARNING_DAYS} jours`
                : expiring.length > 1
                  ? `${expiring.length} documents expirent dans moins de ${WARNING_DAYS} jours`
                  : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Remplacez la pièce concernée : elle sera réclamée le jour où vous en
            aurez besoin, et ce jour-là il sera tard pour la demander à votre
            assureur.
          </p>
        </div>
      )}

      {documents.length === 0 ? (
        /* §32 EMPTY STATES — ce qui manque, à quoi ça servira, et le
           bouton pour commencer. */
        <EmptyState
          icon={<Icon name="document" className="h-6 w-6" />}
          title="Aucun document pour le moment"
          description="Déposez votre KBIS, votre RIB et votre attestation d'assurance : vous les retrouverez ici le jour où un client, une mairie ou un donneur d'ordre les réclamera."
          action={<ButtonLink href="#ajouter">Ajouter un document</ButtonLink>}
        />
      ) : (
        groups.map((group) => (
          <Panel
            key={group.value}
            title={group.section}
            count={group.documents.length}
            className="mb-4"
          >
            <ul className="divide-y divide-line">
              {group.documents.map((doc) => {
                const left = doc.expires_on === null ? null : daysUntil(doc.expires_on, todayUtc);
                const size = formatSize(doc.size_bytes);

                return (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[var(--text-body)] font-medium">{doc.name}</p>
                      <p className="mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                        {[size, `ajouté le ${formatDate(doc.created_at)}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                    {/* L'échéance porte sa propre couleur : « valable
                        jusqu'au » en gris et « expiré » en rouge ne se
                        lisent pas au même rythme. */}
                    {doc.expires_on !== null && left !== null && (
                      <span className="shrink-0">
                        {left < 0 ? (
                          <Badge tone="critical">Expiré le {formatDate(doc.expires_on)}</Badge>
                        ) : left <= WARNING_DAYS ? (
                          <Badge tone="warning">
                            {left === 0
                              ? "Expire aujourd'hui"
                              : left === 1
                                ? "Expire demain"
                                : `Expire dans ${left} jours`}
                          </Badge>
                        ) : (
                          <span className="text-[var(--text-secondary)] text-ink-faint">
                            Valable jusqu&apos;au {formatDate(doc.expires_on)}
                          </span>
                        )}
                      </span>
                    )}

                    <div className="flex shrink-0 items-center gap-1">
                      {doc.url ? (
                        /* Une ancre, pas un `Link` : la cible est une
                           URL signée hors de l'application, que le
                           routeur n'a pas à intercepter. */
                        <a
                          href={doc.url}
                          className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:bg-canvas"
                        >
                          Télécharger
                        </a>
                      ) : (
                        /* La signature a échoué : un bouton mènerait à
                           une page d'erreur. Mieux vaut le dire que le
                           promettre. */
                        <span className="text-[var(--text-secondary)] text-critical">
                          Fichier indisponible
                        </span>
                      )}

                      <ConfirmDialog
                        triggerLabel="Supprimer"
                        triggerVariant="ghost"
                        title="Supprimer ce document ?"
                        message={`« ${doc.name} » quittera le classeur et le fichier sera effacé du stockage. C'est définitif.`}
                        confirmLabel="Supprimer"
                        confirmVariant="danger"
                        action={deleteCompanyDocument}
                        hidden={{ document_id: doc.id }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))
      )}

      {/* Le formulaire en bas, et non en haut : on vient d'abord voir ce
          qu'on a déjà. L'ancre sert au bouton de l'état vide. */}
      <div id="ajouter" className="mt-6 scroll-mt-8">
        <DocumentUploader />
      </div>
    </div>
  );
}
