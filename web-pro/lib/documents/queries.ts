import { createClient } from "@/lib/supabase/server";
import type { OrganizationContext } from "@/lib/auth/organization";
import {
  DOCUMENT_ENTITY_KINDS,
  type AttachableEntity,
  type DocumentEntityKind,
  type DocumentRow,
} from "./types";

/**
 * Les lectures de l'écran Documents.
 *
 * Un fichier séparé des Server Actions, et sans `"use server"` : ce
 * sont des fonctions appelées DEPUIS le composant serveur, pas des
 * actions déclenchées par un formulaire. Les marquer `"use server"`
 * les exposerait comme points d'entrée réseau sans qu'aucun écran n'en
 * ait besoin.
 *
 * Aucune de ces requêtes ne se protège elle-même : c'est la RLS de
 * `public.documents` (migration 0068) qui refuse. Les `eq(organization_id)`
 * ci-dessous ne sont pas une sécurité, ils évitent seulement de
 * demander à Postgres de filtrer ce qu'on sait déjà — et rendent la
 * requête lisible.
 */

/**
 * Ce que la liste rend d'un coup. Au-delà, on filtre.
 *
 * Exporté parce que l'écran doit pouvoir DIRE qu'il a coupé : un
 * compteur qui affiche « 300 documents » là où l'entreprise en a
 * quatre cents ferait chercher longtemps ceux qui manquent.
 */
export const LIST_LIMIT = 300;

/** Ce que la liste déroulante du dépôt propose par famille. */
const ATTACHABLE_LIMIT = 200;

export type DocumentFilters = {
  /** §21 « tags ; cherchables » — et le nom, et les notes. */
  query?: string;
  /** Un `doc_type`, ou rien. */
  type?: string;
  /**
   * Un `entity_type`, `"aucun"` pour les pièces non rattachées, ou
   * rien du tout. « Non rattachés » est un filtre à part entière : ce
   * sont exactement les documents que quelqu'un doit aller ranger.
   */
  entity?: string;
};

/**
 * PostgREST reçoit ses filtres `or(...)` sous forme de texte, et un
 * `,` ou une `)` dans la saisie casserait la liste d'arguments — ou,
 * pire, y ajouterait une condition. On retire donc les caractères de
 * structure AVANT de composer, plutôt que d'espérer qu'ils ne servent
 * pas. Ce qui reste est du texte à chercher, et rien d'autre.
 */
function safeForFilter(value: string): string {
  return value.replace(/[,()*\\"'{}:.]/g, " ").trim();
}

export async function listDocuments(
  organization: OrganizationContext,
  filters: DocumentFilters = {},
): Promise<DocumentRow[]> {
  const supabase = await createClient();

  let request = supabase
    .from("documents")
    .select(
      "id, name, doc_type, tags, notes, document_date, entity_type, entity_id, storage_path, mime_type, size_bytes, created_at",
    )
    .eq("organization_id", organization.organizationId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (filters.type) request = request.eq("doc_type", filters.type);

  if (filters.entity === "aucun") request = request.is("entity_type", null);
  else if (filters.entity) request = request.eq("entity_type", filters.entity);

  const needle = safeForFilter(filters.query ?? "");
  if (needle !== "") {
    // Le nom, les notes, et les TAGS.
    //
    // `cs` compare le tableau à un tag ENTIER : chercher « récep » ne
    // trouvera pas le tag « réception ». C'est assumé — le nom, lui, se
    // cherche en sous-chaîne, et c'est par le nom qu'on cherche un
    // document. Le tag sert à retrouver une famille de pièces, et on le
    // tape en entier parce qu'on le voit écrit sur les lignes voisines.
    //
    // Le tag n'entre dans le filtre que s'il ne contient pas d'espace :
    // `{deux mots}` demanderait des guillemets dans la syntaxe
    // PostgREST, et une paire de guillemets mal placée est une
    // condition de plus, pas une condition de moins.
    const clauses = [`name.ilike.%${needle}%`, `notes.ilike.%${needle}%`];
    if (!needle.includes(" ")) clauses.push(`tags.cs.{${needle}}`);
    request = request.or(clauses.join(","));
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentRow[];
}

// ---------------------------------------------------------------
// À quoi les documents sont rattachés
// ---------------------------------------------------------------

/** Le nom lisible d'une entité, indexé par `type:id`. */
export type EntityLabels = Record<string, string>;

export function entityKey(type: string | null, id: string | null): string | null {
  return type && id ? `${type}:${id}` : null;
}

/**
 * Les noms des entités citées par ces documents.
 *
 * Une requête par famille présente, jamais une par document : trente
 * photos d'un même chantier ne doivent pas produire trente allers-retours.
 *
 * Une entité absente du résultat n'est PAS remplacée par un nom
 * inventé — l'appelant affichera « rattachement introuvable ». Elle a
 * pu être supprimée depuis : un PV de réception survit au chantier
 * qu'il clôt, c'est écrit dans la migration.
 */
export async function loadEntityLabels(
  organization: OrganizationContext,
  rows: Pick<DocumentRow, "entity_type" | "entity_id">[],
): Promise<EntityLabels> {
  const wanted = new Map<DocumentEntityKind, Set<string>>();
  for (const row of rows) {
    if (!row.entity_type || !row.entity_id) continue;
    const kind = DOCUMENT_ENTITY_KINDS.find((k) => k.value === row.entity_type);
    if (!kind) continue;
    const set = wanted.get(kind.value) ?? new Set<string>();
    set.add(row.entity_id);
    wanted.set(kind.value, set);
  }
  if (wanted.size === 0) return {};

  const supabase = await createClient();
  const labels: EntityLabels = {};

  await Promise.all(
    [...wanted.entries()].map(async ([kind, idSet]) => {
      const ids = [...idSet];

      if (kind === "customer") {
        const { data } = await supabase
          .from("crm_customers").select("id, display_name")
          .eq("organization_id", organization.organizationId).in("id", ids);
        for (const row of data ?? []) labels[`customer:${row.id}`] = row.display_name;
        return;
      }
      if (kind === "project") {
        const { data } = await supabase
          .from("projects").select("id, name, number")
          .eq("organization_id", organization.organizationId).in("id", ids);
        for (const row of data ?? []) labels[`project:${row.id}`] = row.name;
        return;
      }
      if (kind === "quote") {
        const { data } = await supabase
          .from("quotes").select("id, title, number")
          .eq("organization_id", organization.organizationId).in("id", ids);
        for (const row of data ?? []) {
          labels[`quote:${row.id}`] = row.number ? `${row.number} · ${row.title}` : row.title;
        }
        return;
      }
      if (kind === "invoice") {
        const { data } = await supabase
          .from("invoices").select("id, number")
          .eq("organization_id", organization.organizationId).in("id", ids);
        // Une facture en brouillon n'a pas encore de numéro : la
        // nommer « null » serait pire que de la nommer « Brouillon ».
        for (const row of data ?? []) labels[`invoice:${row.id}`] = row.number ?? "Brouillon";
        return;
      }
      if (kind === "garden") {
        // Le jardin est cloisonné par ESPACE DE TRAVAIL, pas par
        // organisation — c'est ainsi depuis la Phase 3 — et un jardin
        // LIVRÉ à son propriétaire a quitté celui de l'entreprise sans
        // que le paysagiste en perde l'accès (`has_garden_access`).
        //
        // Filtrer ici sur `workspace_id` afficherait « rattachement
        // introuvable » sur ces jardins-là, alors même que le
        // déclencheur de la migration 0068 a accepté de les rattacher.
        // On laisse donc la RLS trancher, comme le fait /digital-twin.
        const { data } = await supabase
          .from("gardens").select("id, name")
          .in("id", ids).is("deleted_at", null);
        for (const row of data ?? []) labels[`garden:${row.id}`] = row.name;
        return;
      }
      const { data } = await supabase
        .from("field_interventions").select("id, title")
        .eq("organization_id", organization.organizationId).in("id", ids);
      for (const row of data ?? []) labels[`intervention:${row.id}`] = row.title;
    }),
  );

  return labels;
}

/**
 * Ce à quoi on peut rattacher une pièce au moment du dépôt.
 *
 * Les six familles en une seule liste déroulante, groupée : deux champs
 * liés (« type », puis « lequel ») obligeraient à recharger la seconde
 * liste à chaque changement du premier, donc à faire du formulaire un
 * aller-retour réseau.
 *
 * Chaque famille est plafonnée. Le formulaire le DIT — il ne fait pas
 * semblant de tout proposer : une entreprise avec six cents chantiers
 * ne verrait pas les plus anciens, et laisser croire le contraire
 * enverrait chercher longtemps une ligne qui n'y est pas.
 */
export async function listAttachableEntities(
  organization: OrganizationContext,
): Promise<{ entities: AttachableEntity[]; truncated: boolean }> {
  const supabase = await createClient();
  const org = organization.organizationId;

  const [customers, projects, quotes, invoices, gardens, interventions] = await Promise.all([
    supabase.from("crm_customers")
      .select("id, display_name").eq("organization_id", org).is("archived_at", null)
      .order("display_name").limit(ATTACHABLE_LIMIT),
    supabase.from("projects")
      .select("id, name, number").eq("organization_id", org).is("archived_at", null)
      .order("number", { ascending: false }).limit(ATTACHABLE_LIMIT),
    supabase.from("quotes")
      .select("id, title, number").eq("organization_id", org).is("archived_at", null)
      .order("number", { ascending: false }).limit(ATTACHABLE_LIMIT),
    supabase.from("invoices")
      .select("id, number").eq("organization_id", org).is("archived_at", null)
      .order("number", { ascending: false }).limit(ATTACHABLE_LIMIT),
    // Pas de filtre sur l'espace de travail, pour la raison expliquée
    // dans `loadEntityLabels` : la RLS des `gardens` sait déjà lesquels
    // sont accessibles, jardins livrés compris.
    supabase.from("gardens")
      .select("id, name").is("deleted_at", null)
      .order("name").limit(ATTACHABLE_LIMIT),
    supabase.from("field_interventions")
      .select("id, title, scheduled_start").eq("organization_id", org)
      .order("scheduled_start", { ascending: false }).limit(ATTACHABLE_LIMIT),
  ]);

  const entities: AttachableEntity[] = [
    ...(customers.data ?? []).map((row) => ({
      kind: "customer" as const, id: row.id as string, label: row.display_name as string,
    })),
    ...(projects.data ?? []).map((row) => ({
      kind: "project" as const, id: row.id as string,
      label: row.number ? `${row.number} · ${row.name}` : (row.name as string),
    })),
    ...(quotes.data ?? []).map((row) => ({
      kind: "quote" as const, id: row.id as string,
      label: row.number ? `${row.number} · ${row.title}` : (row.title as string),
    })),
    ...(invoices.data ?? []).map((row) => ({
      kind: "invoice" as const, id: row.id as string,
      label: (row.number as string | null) ?? "Facture en brouillon",
    })),
    ...(gardens.data ?? []).map((row) => ({
      kind: "garden" as const, id: row.id as string, label: row.name as string,
    })),
    ...(interventions.data ?? []).map((row) => ({
      kind: "intervention" as const, id: row.id as string, label: row.title as string,
    })),
  ];

  const truncated = [customers, projects, quotes, invoices, gardens, interventions].some(
    (result) => (result.data ?? []).length >= ATTACHABLE_LIMIT,
  );

  return { entities, truncated };
}
