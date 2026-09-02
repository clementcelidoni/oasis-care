"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { DOCUMENT_ENTITY_KINDS, DOCUMENT_TYPES, parseTags } from "./types";

/**
 * §21 DOCUMENTS — déposer une pièce, la supprimer.
 *
 * Les deux écritures demandent `projects.manage` OU `quotes.edit`, et
 * ce n'est pas ce fichier qui l'exige : c'est
 * `public.can_write_documents(uuid)` (migration 0068), appelée par la
 * RLS de la table ET par la politique du seau. Ici, on masque un
 * formulaire ; là-bas, on refuse.
 *
 * LE SEAU EST PRIVÉ, et le chemin suit la convention des autres seaux
 * du projet : le PREMIER SEGMENT est l'identifiant de l'organisation,
 * et c'est lui que la politique vérifie. Changer la forme du chemin ici
 * sans changer la politique là-bas rendrait tout dépôt impossible.
 */

const BUCKET = "work-documents";

/**
 * Vingt-cinq mégaoctets. Le classeur de l'entreprise (§45) se contente
 * de vingt, parce qu'il ne reçoit que des PDF administratifs. Ici
 * arrivent des photos de chantier prises au téléphone, qui pèsent
 * couramment plus de dix.
 */
const MAX_BYTES = 25 * 1024 * 1024;

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * « project:5f3c… » → les deux moitiés du rattachement.
 *
 * Un seul champ dans le formulaire, deux colonnes en base. La valeur
 * vide veut dire « pas encore rangé », ce qui est un état légitime :
 * une pièce arrive parfois avant qu'on sache où elle va, et forcer un
 * rattachement produirait des rattachements FAUX plutôt qu'absents.
 *
 * Un type inconnu est traité comme une absence de rattachement plutôt
 * que renvoyé en erreur : la contrainte `check` de la table le
 * refuserait de toute façon, et perdre le fichier déjà envoyé pour une
 * valeur trafiquée dans le navigateur n'aiderait personne.
 */
function parseAttachment(raw: string | null): { type: string | null; id: string | null } {
  if (!raw) return { type: null, id: null };
  const separator = raw.indexOf(":");
  if (separator <= 0) return { type: null, id: null };

  const type = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  const known = DOCUMENT_ENTITY_KINDS.some((kind) => kind.value === type);
  if (!known || id === "") return { type: null, id: null };

  return { type, id };
}

export async function uploadDocument(formData: FormData) {
  const organization = await requireOrganization();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Fichier trop lourd (25 Mo maximum)." };
  }

  const supabase = await createClient();

  // Le nom d'origine est nettoyé, jamais utilisé tel quel : un chemin
  // de stockage n'accepte pas tout, et un `/` dans le nom du fichier
  // créerait un sous-dossier — donc un chemin dont le premier segment
  // ne serait plus celui que la politique vérifie.
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120);
  const path = `${organization.organizationId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const rawType = String(formData.get("doc_type") ?? "");
  const docType = DOCUMENT_TYPES.some((type) => type.value === rawType) ? rawType : "other";
  const attachment = parseAttachment(text(formData, "attachment"));

  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("documents").insert({
    organization_id: organization.organizationId,
    // §21 « nom » — ce que l'humain lit. À défaut, le nom du fichier :
    // « IMG_4471.jpg » est un mauvais nom, mais un nom vide serait
    // refusé par la contrainte, et l'utilisateur perdrait son envoi.
    name: text(formData, "name") ?? file.name,
    doc_type: docType,
    tags: parseTags(String(formData.get("tags") ?? "")),
    document_date: text(formData, "document_date"),
    notes: text(formData, "notes"),
    entity_type: attachment.type,
    entity_id: attachment.id,
    storage_path: path,
    // §21 « métadonnées » : ce que le dépôt SAIT. Le nom d'origine du
    // fichier, et rien de deviné.
    metadata: { original_filename: file.name },
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user.user?.id ?? null,
  });

  if (error) {
    // Le fichier est déjà parti. Le laisser derrière une insertion
    // refusée, c'est un octet payant que plus rien ne référence — et
    // que plus rien ne pourra retrouver, faute de ligne qui le nomme.
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: error.message };
  }

  await flash("success", "Document ajouté.");
  revalidatePath("/documents");
  return { ok: true };
}

export async function deleteDocument(formData: FormData) {
  await requireOrganization();

  const id = String(formData.get("document_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { data: document } = await supabase
    .from("documents")
    .select("storage_path, name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // Le fichier APRÈS la ligne. Dans l'ordre inverse, un échec
  // laisserait une ligne qui pointe vers un fichier disparu, et l'écran
  // proposerait un téléchargement mort.
  if (document?.storage_path) {
    await supabase.storage.from(BUCKET).remove([document.storage_path]);
  }

  await flash("success", `« ${document?.name ?? "Document"} » supprimé.`);
  revalidatePath("/documents");
}
