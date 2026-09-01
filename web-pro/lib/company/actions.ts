"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { BUSINESS_TYPES, type BusinessType } from "@/lib/auth/permissions";
import { TOGGLEABLE_MODULES, type ModuleKey } from "@/lib/navigation";

/**
 * §11 MA SOCIÉTÉ, §12 LOGO, §43 MODULES, §45 DOCUMENTS.
 *
 * Toutes ces écritures demandent `organization.manageUsers` — la
 * politique RLS de `business_organizations` (migration 0043) l'exige, et
 * ce n'est pas contournable depuis ici. Ce fichier ne fait que masquer
 * les formulaires à ceux qui n'y ont pas droit ; c'est la base qui
 * refuse.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function integer(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const value = Number.parseInt(raw.replace(/\s/g, ""), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** §11 INFORMATIONS — l'identité, en un seul enregistrement. */
export async function updateCompanyProfile(formData: FormData) {
  const organization = await requireOrganization();

  const businessType = String(formData.get("business_type") ?? "");
  const capital = String(formData.get("share_capital") ?? "").trim();

  const patch: Record<string, unknown> = {
    name: text(formData, "name") ?? organization.name,
    legal_name: text(formData, "legal_name"),
    trade_name: text(formData, "trade_name"),
    legal_form: text(formData, "legal_form"),
    siren: text(formData, "siren"),
    siret: text(formData, "siret"),
    vat_number: text(formData, "vat_number"),
    rcs_city: text(formData, "rcs_city"),
    share_capital_cents:
      capital === "" ? null : Math.round(Number(capital.replace(",", ".")) * 100) || null,

    address_line1: text(formData, "address_line1"),
    address_line2: text(formData, "address_line2"),
    postal_code: text(formData, "postal_code"),
    city: text(formData, "city"),
    country: text(formData, "country") ?? "FR",

    email: text(formData, "email"),
    phone: text(formData, "phone"),
    website: text(formData, "website"),

    currency: text(formData, "currency") ?? "EUR",
    locale: text(formData, "locale") ?? "fr",
    timezone: text(formData, "timezone") ?? "Europe/Paris",

    employee_count_override: integer(formData, "employee_count_override"),
    updated_at: new Date().toISOString(),
  };

  // Une valeur inventée serait de toute façon refusée par la contrainte
  // de la table, mais autant ne pas envoyer la tentative.
  if (BUSINESS_TYPES.includes(businessType as BusinessType)) {
    patch.business_type = businessType;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_organizations")
    .update(patch)
    .eq("id", organization.organizationId);
  if (error) throw new Error(error.message);

  // L'activité gouverne le menu, et le nom s'affiche dans la barre
  // latérale : c'est toute la mise en page qu'il faut réinvalider.
  revalidatePath("/", "layout");
}

/** §12 ADMINISTRATION — assurances, certifications, agréments. */
export async function updateCompanyAdministration(formData: FormData) {
  const organization = await requireOrganization();

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_organizations")
    .update({
      insurer_name: text(formData, "insurer_name"),
      insurance_rc_pro_number: text(formData, "insurance_rc_pro_number"),
      insurance_decennale_number: text(formData, "insurance_decennale_number"),
      insurance_expires_on: text(formData, "insurance_expires_on"),
      certifications: text(formData, "certifications"),
      qualifications: text(formData, "qualifications"),
      phytosanitary_operator_number: text(formData, "phytosanitary_operator_number"),
      // La MENTION imprimée en pied de devis, distincte des champs
      // ci-dessus : on saisit les seconds, on publie la première.
      insurance_details: text(formData, "insurance_details"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", organization.organizationId);
  if (error) throw new Error(error.message);

  revalidatePath("/entreprise");
  revalidatePath("/devis", "layout");
  revalidatePath("/factures", "layout");
}

// ---------------------------------------------------------------
// §12 LOGO SOCIÉTÉ
// ---------------------------------------------------------------

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_BYTES = 4 * 1024 * 1024;

/**
 * §12 — « Support PNG, JPEG, WEBP. Compression. Crop si nécessaire.
 * Stockage Supabase Storage sécurisé. »
 *
 * La compression et le recadrage se font DANS LE NAVIGATEUR, avant
 * l'envoi (voir `LogoUploader`). Le faire ici demanderait une
 * bibliothèque de traitement d'image côté serveur pour un résultat que
 * le navigateur produit déjà, et ferait transiter quatre mégaoctets là
 * où cent kilo-octets suffisent.
 *
 * Le nom du fichier porte l'horodatage : un chemin fixe resterait dans
 * les caches des navigateurs et le logo ne changerait pas à l'écran.
 */
export async function uploadCompanyLogo(formData: FormData) {
  const organization = await requireOrganization();

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier." };
  }
  if (!LOGO_TYPES.includes(file.type)) {
    return { ok: false, error: "Format non pris en charge. Utilisez PNG, JPEG ou WebP." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Image trop lourde (4 Mo maximum)." };
  }

  const supabase = await createClient();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${organization.organizationId}/logo-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("organization-logos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  // L'ancien chemin, pour l'effacer une fois le nouveau en place.
  const { data: before } = await supabase
    .from("business_organizations")
    .select("logo_path")
    .eq("id", organization.organizationId)
    .maybeSingle();

  const { error } = await supabase
    .from("business_organizations")
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq("id", organization.organizationId);
  if (error) {
    // La ligne a échoué : on retire le fichier, sinon il resterait
    // orphelin dans le seau sans que rien ne le référence.
    await supabase.storage.from("organization-logos").remove([path]);
    return { ok: false, error: error.message };
  }

  if (before?.logo_path && before.logo_path !== path) {
    await supabase.storage.from("organization-logos").remove([before.logo_path]);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCompanyLogo() {
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("business_organizations")
    .select("logo_path")
    .eq("id", organization.organizationId)
    .maybeSingle();

  const { error } = await supabase
    .from("business_organizations")
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq("id", organization.organizationId);
  if (error) throw new Error(error.message);

  if (before?.logo_path) {
    await supabase.storage.from("organization-logos").remove([before.logo_path]);
  }

  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------
// §43 MODULES
// ---------------------------------------------------------------

/**
 * « Permettre masquage modules inutiles. Cela ne remplace pas les
 * entitlements. »
 *
 * Le formulaire envoie les modules ACTIVÉS ; on enregistre les autres.
 * Une case décochée n'envoie rien du tout en HTML — enregistrer ce
 * qu'on reçoit reviendrait à ne jamais pouvoir éteindre quoi que ce
 * soit.
 */
export async function updateModules(formData: FormData) {
  const organization = await requireOrganization();

  const enabled = new Set(formData.getAll("module").map(String));
  const disabled = TOGGLEABLE_MODULES.filter((key) => !enabled.has(key));

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_organizations")
    .update({ disabled_modules: disabled as ModuleKey[], updated_at: new Date().toISOString() })
    .eq("id", organization.organizationId);
  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------
// §45 DOCUMENTS SOCIÉTÉ
// ---------------------------------------------------------------

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export async function uploadCompanyDocument(formData: FormData) {
  const organization = await requireOrganization();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "Fichier trop lourd (20 Mo maximum)." };
  }

  const supabase = await createClient();
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120);
  const path = `${organization.organizationId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("organization-documents")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("organization_documents").insert({
    organization_id: organization.organizationId,
    kind: text(formData, "kind") ?? "other",
    name: text(formData, "name") ?? file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    expires_on: text(formData, "expires_on"),
    uploaded_by: user.user?.id ?? null,
  });
  if (error) {
    await supabase.storage.from("organization-documents").remove([path]);
    return { ok: false, error: error.message };
  }

  revalidatePath("/entreprise/documents");
  return { ok: true };
}

export async function deleteCompanyDocument(formData: FormData) {
  await requireOrganization();

  const id = String(formData.get("document_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { data: document } = await supabase
    .from("organization_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("organization_documents").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // Le fichier APRÈS la ligne : dans l'ordre inverse, un échec
  // laisserait une ligne qui pointe vers un fichier disparu, et l'écran
  // proposerait un téléchargement mort.
  if (document?.storage_path) {
    await supabase.storage.from("organization-documents").remove([document.storage_path]);
  }

  revalidatePath("/entreprise/documents");
}
