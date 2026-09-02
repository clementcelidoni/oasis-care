import type { IconName } from "@/components/shell/Icon";

/**
 * §5 GESTION · DOCUMENTS — §21 « nom ; type ; tags ; métadonnées ;
 * client associé ; projet associé ».
 *
 * LES DOCUMENTS DE TRAVAIL, et non le classeur de l'entreprise.
 *
 * §45 (`/entreprise/documents`) porte le KBIS, le RIB, l'attestation
 * décennale : une poignée de pièces, réservées aux administrateurs.
 * Ici, ce sont les centaines de pièces que produit un chantier — la
 * photo de repérage, le plan du géomètre, le PV de réception, le
 * courrier de la mairie — rattachées chacune à un client, un chantier,
 * un devis, une facture, un jardin ou une intervention, et que TOUT le
 * terrain doit pouvoir ouvrir.
 *
 * Les deux tables ne peuvent pas fusionner : il faudrait choisir une
 * seule permission de lecture, donc soit ouvrir le RIB à l'ouvrier,
 * soit fermer les photos de chantier à celui qui les prend.
 */

// ---------------------------------------------------------------
// §21 « type »
// ---------------------------------------------------------------

/**
 * Les sept valeurs de la contrainte `check` de `public.documents`
 * (migration 0068). La liste déroulante ne peut proposer que ce que la
 * base accepte : une valeur de plus ici, et l'insertion échouerait une
 * fois le fichier déjà envoyé.
 *
 * Elles décrivent CE QU'EST la pièce, pas son format. « Plan » et
 * « photo » se rangent et se cherchent différemment ; deux PDF non.
 *
 * `label` nomme une pièce (ce qu'on choisit au dépôt), `section` nomme
 * le rayon (ce qui titre un groupe à l'écran).
 */
export const DOCUMENT_TYPES = [
  { value: "photo", label: "Photo", section: "Photos", hint: "Repérage, avancement, réception" },
  { value: "plan", label: "Plan", section: "Plans", hint: "Géomètre, esquisse, exécution" },
  { value: "report", label: "Compte rendu", section: "Comptes rendus", hint: "PV de réception, visite" },
  { value: "contract", label: "Contrat", section: "Contrats", hint: "Devis signé, bon de commande" },
  { value: "letter", label: "Courrier", section: "Courriers", hint: "Reçu ou envoyé" },
  { value: "administrative", label: "Document administratif", section: "Documents administratifs", hint: "Autorisation, déclaration préalable" },
  { value: "other", label: "Autre document", section: "Autres documents", hint: "" },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = Object.fromEntries(
  DOCUMENT_TYPES.map((type) => [type.value, type.label] as [string, string]),
) as Record<DocumentType, string>;

/**
 * Le `doc_type` est verrouillé par une contrainte, mais une valeur
 * arrivée en base autrement que par cet écran ne doit pas faire
 * disparaître la ligne : elle retombe sur « Autre document ».
 */
export function documentTypeLabel(value: string): string {
  return DOCUMENT_TYPE_LABELS[value as DocumentType] ?? DOCUMENT_TYPE_LABELS.other;
}

// ---------------------------------------------------------------
// §21 « client associé ; projet associé »
// ---------------------------------------------------------------

/**
 * Les six entités auxquelles un document peut se rattacher.
 *
 * `entity_type` / `entity_id` suit la convention d'`audit_events` : pas
 * de clé étrangère, parce qu'aucune ne pointe vers six tables à la
 * fois. Ce que la clé aurait garanti — « l'entité existe, et elle est
 * chez nous » — est rendu par le déclencheur `documents_check_entity`
 * (migration 0068).
 *
 * `href` est ce qui rend le rattachement utile : depuis la liste, on
 * remonte au chantier en un clic. Sans lui, « chantier Villa Martin »
 * ne serait qu'une étiquette.
 */
export const DOCUMENT_ENTITY_KINDS = [
  {
    value: "customer",
    label: "Client",
    plural: "Clients",
    icon: "clients" as IconName,
    href: (id: string) => `/crm/clients/${id}`,
  },
  {
    value: "project",
    label: "Chantier",
    plural: "Chantiers",
    icon: "projects" as IconName,
    href: (id: string) => `/projets/${id}`,
  },
  {
    value: "quote",
    label: "Devis",
    plural: "Devis",
    icon: "quote" as IconName,
    href: (id: string) => `/devis/${id}`,
  },
  {
    value: "invoice",
    label: "Facture",
    plural: "Factures",
    icon: "invoice" as IconName,
    href: (id: string) => `/factures/${id}`,
  },
  {
    value: "garden",
    label: "Jardin",
    plural: "Jardins",
    icon: "twin" as IconName,
    href: (id: string) => `/digital-twin/${id}`,
  },
  {
    value: "intervention",
    label: "Intervention",
    plural: "Interventions",
    icon: "interventions" as IconName,
    href: (id: string) => `/projets/interventions/${id}`,
  },
] as const;

export type DocumentEntityKind = (typeof DOCUMENT_ENTITY_KINDS)[number]["value"];

export function entityKind(value: string | null) {
  return DOCUMENT_ENTITY_KINDS.find((kind) => kind.value === value) ?? null;
}

/** Une entité proposée au dépôt : ce qu'on choisit dans la liste. */
export type AttachableEntity = {
  kind: DocumentEntityKind;
  id: string;
  label: string;
};

/** Une ligne de `public.documents`, telle que l'écran la lit. */
export type DocumentRow = {
  id: string;
  name: string;
  doc_type: string;
  tags: string[];
  notes: string | null;
  document_date: string | null;
  entity_type: string | null;
  entity_id: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

// ---------------------------------------------------------------
// §21 « tags »
// ---------------------------------------------------------------

/** Douze suffit largement, et empêche qu'un copier-coller malheureux
 *  transforme une ligne en pavé illisible dans la liste. */
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

/**
 * « réception, PV, villa martin » → trois tags.
 *
 * Les doublons sont écartés SANS TENIR COMPTE DE LA CASSE, mais la
 * première graphie saisie est conservée : « Réception » et
 * « réception » désignent la même chose, et en garder deux couperait en
 * deux le filtre qui les cherche.
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const piece of raw.split(",")) {
    const tag = piece.trim().slice(0, MAX_TAG_LENGTH);
    if (tag === "") continue;
    const key = tag.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }

  return tags;
}

// ---------------------------------------------------------------
// Le fichier lui-même
// ---------------------------------------------------------------

/**
 * Une image se montre, le reste se télécharge.
 *
 * On se fie au type MIME enregistré au dépôt, pas à l'extension du
 * chemin : un fichier renommé « .jpg » qui n'en est pas un afficherait
 * une vignette cassée à chaque rendu de la liste.
 */
export function isPreviewableImage(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(mimeType);
}

export function formatSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

export function formatDay(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Le nom proposé au téléchargement.
 *
 * La ligne porte un libellé lisible (« Plan du géomètre ») tandis que
 * l'extension vit dans le chemin de stockage. Sans elle, le fichier
 * arrive sur le bureau du destinataire sans que rien ne sache l'ouvrir.
 */
export function downloadName(name: string, storagePath: string): string {
  const file = storagePath.slice(storagePath.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const extension = dot > 0 ? file.slice(dot) : "";
  if (!extension || name.toLowerCase().endsWith(extension.toLowerCase())) return name;
  return `${name}${extension}`;
}

/**
 * Ce que l'écran a le droit d'ÉCRIRE.
 *
 * Le miroir exact de `public.can_write_documents(uuid)` (migration
 * 0068), qui gouverne à la fois la RLS de la table et la politique du
 * seau. Ici, ça ne protège rien : ça masque un formulaire que la base
 * refuserait de toute façon. Les deux doivent dire la même chose, sinon
 * l'utilisateur voit un bouton qui échoue.
 *
 * Deux permissions, et pas une : `projects.manage` couvre le terrain,
 * `quotes.edit` couvre le commerce. Un commercial qui ne peut pas
 * joindre le plan reçu du client à son devis le laisserait dans sa
 * boîte mail — c'est-à-dire nulle part.
 */
export function canWriteDocuments(permissions: readonly string[]): boolean {
  return permissions.includes("projects.manage") || permissions.includes("quotes.edit");
}
