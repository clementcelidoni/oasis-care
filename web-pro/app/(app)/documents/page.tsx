import Link from "next/link";
import { getActiveOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, ConfirmDialog, EmptyState, PageHeader, Panel } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { deleteDocument } from "@/lib/documents/actions";
import {
  entityKey,
  listAttachableEntities,
  listDocuments,
  loadEntityLabels,
  LIST_LIMIT,
} from "@/lib/documents/queries";
import {
  canWriteDocuments,
  documentTypeLabel,
  downloadName,
  entityKind,
  DOCUMENT_ENTITY_KINDS,
  DOCUMENT_TYPES,
  formatDay,
  formatSize,
  isPreviewableImage,
  type DocumentRow,
} from "@/lib/documents/types";
import { DocumentUploader } from "./DocumentUploader";

/**
 * §5 GESTION · DOCUMENTS — §21.
 *
 * LA MÉMOIRE DU TRAVAIL. La photo de repérage prise avant le devis, le
 * plan du géomètre, le PV de réception signé, le courrier de la mairie.
 * Aujourd'hui, ces pièces vivent dans les téléphones et les boîtes mail
 * de ceux qui les ont reçues, et personne ne les retrouve deux ans plus
 * tard quand un client conteste.
 *
 * CE N'EST PAS §45. `/entreprise/documents` porte le classeur de la
 * SOCIÉTÉ — KBIS, RIB, attestations — réservé aux administrateurs. Ici,
 * la lecture est ouverte à tout le terrain (`projects.read`) parce
 * qu'une photo de chantier que l'équipe ne peut pas ouvrir ne sert à
 * rien ; le dépôt et la suppression demandent `projects.manage` ou
 * `quotes.edit`. Deux tables, deux seaux, deux permissions.
 *
 * LE GROUPEMENT EST PAR ENTITÉ, pas par type. Le type est déjà un
 * filtre ; ce qu'on cherche, c'est « tout ce qu'on a sur ce chantier ».
 * Et le groupe « Non rattachés » n'est pas un fourre-tout : c'est
 * exactement la pile que quelqu'un doit aller ranger.
 */

/**
 * Une heure. Le seau est PRIVÉ (migration 0068) et une adresse
 * permanente circulerait ensuite hors de tout contrôle d'accès, y
 * compris après le départ de la personne qui l'a copiée.
 */
const SIGNED_URL_SECONDS = 3600;

const BUCKET = "work-documents";

type ResolvedDocument = DocumentRow & {
  /** L'URL de téléchargement, avec un nom de fichier lisible. */
  downloadUrl: string | null;
  /** L'URL d'affichage, pour les images seulement. */
  previewUrl: string | null;
};

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const typeFilter = typeof params.type === "string" ? params.type : "";
  const entityFilter = typeof params.entite === "string" ? params.entite : "";
  // La recherche globale renvoie `/documents?document=<id>` : le
  // document ouvert doit se repérer d'un coup d'œil dans la liste.
  const focused = typeof params.document === "string" ? params.document : "";

  // La RLS refuserait de toute façon, mais elle refuse en rendant une
  // liste VIDE — et « aucun document » est un mensonge quand la vérité
  // est « pas pour vous ». On le dit.
  if (!organization.permissions.includes("projects.read")) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Documents" subtitle="Les pièces de vos chantiers." />
        <EmptyState
          icon={<Icon name="document" className="h-6 w-6" />}
          title="Accès non autorisé"
          description="Les documents de travail sont liés aux chantiers. Votre rôle ne donne pas accès aux chantiers de cette entreprise : demandez l'autorisation à un administrateur."
        />
      </div>
    );
  }

  const canWrite = canWriteDocuments(organization.permissions);

  const rows = await listDocuments(organization, {
    query,
    type: typeFilter,
    entity: entityFilter,
  });
  const labels = await loadEntityLabels(organization, rows);

  const supabase = await createClient();

  /**
   * Une URL par document plutôt qu'un appel groupé : `createSignedUrls`
   * n'accepte qu'un seul nom de téléchargement pour tout le lot, et
   * trente fichiers arrivant sous le même nom rendraient la liste
   * inutilisable.
   *
   * Deux URL pour une image : celle du bouton force le téléchargement,
   * ce qui empêche le navigateur de l'AFFICHER. Une vignette a besoin
   * de la seconde.
   */
  const documents: ResolvedDocument[] = await Promise.all(
    rows.map(async (row) => {
      const preview = isPreviewableImage(row.mime_type);
      const [download, inline] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS, {
          download: downloadName(row.name, row.storage_path),
        }),
        preview
          ? supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS)
          : Promise.resolve({ data: null }),
      ]);

      return {
        ...row,
        downloadUrl: download.data?.signedUrl ?? null,
        previewUrl: inline.data?.signedUrl ?? null,
      };
    }),
  );

  const filtered = query !== "" || typeFilter !== "" || entityFilter !== "";

  // Les six familles rattachables ne sont chargées que si un formulaire
  // les affiche : sur un écran en lecture seule, ce seraient six
  // requêtes pour rien.
  const attachable = canWrite ? await listAttachableEntities(organization) : null;

  // §22 — regroupés par entité rattachée. L'ordre suit celui de
  // `DOCUMENT_ENTITY_KINDS`, puis le nom : deux chantiers ne doivent pas
  // changer de place d'un rendu à l'autre.
  const groups = groupByEntity(documents, labels);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Documents"
        subtitle="Les pièces de vos chantiers : photos de repérage, plans, PV de réception, courriers. Rangées là où on les cherchera."
        action={
          <Badge tone="accent">
            {documents.length >= LIST_LIMIT
              ? /* La liste est coupée. Afficher « 300 documents » sans
                   le dire laisserait croire qu'il n'y en a pas plus. */
                `${LIST_LIMIT} documents affichés`
              : documents.length === 1
                ? "1 document"
                : `${documents.length} documents`}
          </Badge>
        }
      />

      {/* Un formulaire GET : le filtre atterrit dans l'URL, donc dans
          l'historique et dans le presse-papiers. On peut envoyer
          « les plans du chantier Villa Martin » à un collègue. */}
      <form className="mb-3">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Rechercher un nom, une note, un tag…"
          aria-label="Rechercher un document"
          className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2.5 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
        />
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        {entityFilter && <input type="hidden" name="entite" value={entityFilter} />}
      </form>

      <nav className="mb-2 flex flex-wrap gap-1.5" aria-label="Filtrer par type">
        <FilterPill label="Tous les types" active={typeFilter === ""}
          href={hrefFor({ q: query, entite: entityFilter })} />
        {DOCUMENT_TYPES.map((type) => (
          <FilterPill
            key={type.value}
            label={type.label}
            active={typeFilter === type.value}
            href={hrefFor({ q: query, type: type.value, entite: entityFilter })}
          />
        ))}
      </nav>

      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Filtrer par rattachement">
        <FilterPill label="Tous les rattachements" active={entityFilter === ""}
          href={hrefFor({ q: query, type: typeFilter })} />
        {DOCUMENT_ENTITY_KINDS.map((kind) => (
          <FilterPill
            key={kind.value}
            label={kind.plural}
            active={entityFilter === kind.value}
            href={hrefFor({ q: query, type: typeFilter, entite: kind.value })}
          />
        ))}
        <FilterPill
          label="Non rattachés"
          active={entityFilter === "aucun"}
          href={hrefFor({ q: query, type: typeFilter, entite: "aucun" })}
        />
      </nav>

      {/* Arrivé depuis la recherche globale, mais le document n'est pas
          dans la liste : un filtre le masque, ou il a été supprimé
          depuis. Le silence enverrait chercher un bogue. */}
      {focused !== "" && !documents.some((doc) => doc.id === focused) && (
        <p className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface-sunken px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
          Le document que vous avez ouvert n&apos;apparaît pas ici : un filtre le
          masque, ou il a été supprimé depuis.{" "}
          <Link href="/documents" className="font-medium text-accent">
            Voir tous les documents
          </Link>
        </p>
      )}

      {documents.length === 0 ? (
        /* §32 EMPTY STATES — ce qu'il n'y a pas, à quoi ça servira, et
           le bouton pour commencer. Deux textes, parce que « aucun
           résultat » et « rien du tout » n'appellent pas le même geste. */
        <EmptyState
          icon={<Icon name="document" className="h-6 w-6" />}
          title={filtered ? "Aucun document ne correspond" : "Aucun document pour le moment"}
          description={
            filtered
              ? "Essayez un autre mot, un autre type, ou retirez le filtre de rattachement."
              : "Déposez les photos de repérage, les plans du géomètre, les PV de réception et les courriers. Rattachés à un chantier ou à un client, ils se retrouvent deux ans plus tard — le jour où on les conteste."
          }
          action={
            filtered ? (
              <ButtonLink href="/documents" variant="secondary">
                Retirer les filtres
              </ButtonLink>
            ) : canWrite ? (
              <ButtonLink href="#deposer">Déposer un document</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        groups.map((group) => (
          <Panel
            key={group.key}
            title={group.title}
            description={group.subtitle}
            count={group.documents.length}
            action={
              group.href ? (
                <Link href={group.href} className="text-[var(--text-secondary)] font-medium text-accent">
                  Ouvrir
                </Link>
              ) : undefined
            }
            className="mb-4"
          >
            <ul className="divide-y divide-line">
              {group.documents.map((doc) => (
                <li
                  key={doc.id}
                  id={`document-${doc.id}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 scroll-mt-8 ${
                    doc.id === focused ? "bg-accent-wash" : ""
                  }`}
                >
                  {/* L'aperçu vaut le nom : sur un chantier, on
                      reconnaît une photo, on ne relit pas son
                      libellé. Les autres formats ont l'icône du
                      module — une vignette grise ne dirait rien. */}
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-sunken text-ink-faint">
                    {doc.previewUrl ? (
                      /* URL signée d'un seau privé, valable une heure :
                         `next/image` la mettrait en cache côté serveur
                         bien après son expiration, et la vignette se
                         briserait. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={doc.previewUrl}
                        alt={doc.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Icon name="document" className="h-5 w-5" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[var(--text-body)] font-medium">{doc.name}</p>
                    <p className="mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                      {[
                        documentTypeLabel(doc.doc_type),
                        formatSize(doc.size_bytes),
                        doc.document_date
                          ? `daté du ${formatDay(doc.document_date)}`
                          : `déposé le ${formatDay(doc.created_at)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {doc.notes && (
                      <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{doc.notes}</p>
                    )}
                    {doc.tags.length > 0 && (
                      <p className="mt-1.5 flex flex-wrap gap-1">
                        {doc.tags.map((tag) => (
                          /* Un tag est un lien : le voir écrit et ne
                             pas pouvoir cliquer dessus oblige à le
                             retaper dans la recherche. */
                          <Link
                            key={tag}
                            href={hrefFor({ q: tag })}
                            className="rounded-[var(--radius-pill)] bg-surface-sunken px-2 py-0.5 text-[var(--text-secondary)] text-ink-soft transition-colors hover:text-ink"
                          >
                            {tag}
                          </Link>
                        ))}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {doc.downloadUrl ? (
                      /* Une ancre, pas un `Link` : la cible est une URL
                         signée hors de l'application, que le routeur
                         n'a pas à intercepter. */
                      <a
                        href={doc.downloadUrl}
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

                    {canWrite && (
                      <ConfirmDialog
                        triggerLabel="Supprimer"
                        triggerVariant="ghost"
                        title="Supprimer ce document ?"
                        message={`« ${doc.name} » quittera la liste et le fichier sera effacé du stockage. C'est définitif.`}
                        confirmLabel="Supprimer"
                        confirmVariant="danger"
                        action={deleteDocument}
                        hidden={{ document_id: doc.id }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}

      {documents.length >= LIST_LIMIT && (
        <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
          Seuls les {LIST_LIMIT} documents les plus récents sont affichés. Filtrez
          par type, par rattachement, ou cherchez un nom ou un tag pour atteindre
          les autres.
        </p>
      )}

      {attachable ? (
        /* Le formulaire en bas : on vient d'abord voir ce qu'on a
           déjà. L'ancre sert au bouton de l'état vide. */
        <div id="deposer" className="mt-6 scroll-mt-8">
          <DocumentUploader
            entities={attachable.entities}
            truncated={attachable.truncated}
          />
        </div>
      ) : (
        <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
          Vous pouvez consulter et télécharger ces pièces. Le dépôt et la
          suppression demandent la gestion des chantiers ou celle des devis.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Le groupement
// ---------------------------------------------------------------

type Group = {
  key: string;
  title: string;
  subtitle?: string;
  href?: string;
  documents: ResolvedDocument[];
};

function groupByEntity(
  documents: ResolvedDocument[],
  labels: Record<string, string>,
): Group[] {
  const groups = new Map<string, Group>();

  for (const doc of documents) {
    const key = entityKey(doc.entity_type, doc.entity_id);
    const kind = entityKind(doc.entity_type);

    if (key === null || kind === null) {
      const bucket = groups.get("aucun") ?? {
        key: "aucun",
        title: "Non rattachés",
        subtitle:
          "Ces pièces n'appartiennent encore à aucun client ni à aucun chantier. C'est la pile à ranger.",
        documents: [],
      };
      bucket.documents.push(doc);
      groups.set("aucun", bucket);
      continue;
    }

    const bucket = groups.get(key) ?? {
      key,
      // L'entité a pu disparaître depuis — un PV de réception survit au
      // chantier qu'il clôt. On le dit plutôt que d'inventer un nom.
      title: labels[key] ?? "Rattachement introuvable",
      subtitle: labels[key] ? kind.label : `${kind.label} supprimé depuis`,
      href: labels[key] ? kind.href(doc.entity_id as string) : undefined,
      documents: [],
    };
    bucket.documents.push(doc);
    groups.set(key, bucket);
  }

  const order = new Map<string, number>(
    DOCUMENT_ENTITY_KINDS.map((kind, index) => [kind.value, index] as [string, number]),
  );
  return [...groups.values()].sort((a, b) => {
    // « Non rattachés » ferme la marche : c'est une corbeille d'entrée,
    // pas un dossier de travail.
    if (a.key === "aucun") return 1;
    if (b.key === "aucun") return -1;
    const rankA = order.get(a.key.slice(0, a.key.indexOf(":"))) ?? 99;
    const rankB = order.get(b.key.slice(0, b.key.indexOf(":"))) ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.title.localeCompare(b.title, "fr");
  });
}

// ---------------------------------------------------------------
// Les filtres
// ---------------------------------------------------------------

function hrefFor(parts: { q?: string; type?: string; entite?: string }): string {
  const search = new URLSearchParams();
  if (parts.q) search.set("q", parts.q);
  if (parts.type) search.set("type", parts.type);
  if (parts.entite) search.set("entite", parts.entite);
  const suffix = search.toString();
  return suffix ? `/documents?${suffix}` : "/documents";
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-3 py-1.5 text-[var(--text-secondary)] transition-colors ${
        active
          ? "bg-accent text-accent-ink"
          : "border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
