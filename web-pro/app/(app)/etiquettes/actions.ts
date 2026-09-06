"use server";

/**
 * LES GESTES QUI ÉCRIVENT — § 16 et § 18.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUNE DE CES ACTIONS N'ÉCRIT DANS UNE TABLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Toutes passent par une fonction `security definer` de la migration
 * 0090. Ce n'est pas une préférence de style : la politique RLS posée
 * par 0090 § 3 sur `smart_tags` est en LECTURE SEULE sur l'axe
 * entreprise, et `etiquette_modeles` a vu ses droits d'écriture
 * retirés à `authenticated` (§ 10). Un `insert` depuis ici serait
 * refusé par la base — et c'est exactement ce qu'on veut : le contrôle
 * du droit vit à UN endroit, dans la fonction, pas dans quatre-vingt
 * écrans.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON NE RENVOIE JAMAIS L'ERREUR DE POSTGRES TELLE QUELLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Les messages de 0090 sont écrits pour un humain (« Accès refusé :
 * poser une étiquette sur cet élément demande le droit de gérer les
 * étiquettes. ») et ceux-là passent. Mais une violation de contrainte
 * rendrait « new row for relation … violates check constraint
 * etiquette_modeles_marge_tenable », qui ne veut rien dire pour un
 * pépiniériste. On traduit ce qu'on sait traduire, et on garde le
 * reste court.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { flash } from "@/lib/ui/flash";

import { estSource, gisement, type SourceEtiquette } from "./familles.ts";
import { PLAFOND_SELECTION } from "./lecture.ts";
import { champsVersJson, lireBrouillon } from "./modeles.ts";

/** La racine de ce module. Une seule constante, pour ne pas la fauter. */
const RACINE = "/etiquettes";

/**
 * Un message d'erreur lisible à partir de ce que rend PostgREST.
 *
 * LES MESSAGES DE NOS PROPRES FONCTIONS PASSENT INTACTS. Ils ont été
 * écrits pour être lus : les remplacer par « une erreur est survenue »
 * effacerait la seule information utile — que le droit manque, ou que
 * l'élément a disparu.
 */
function messageLisible(brut: string | undefined, repli: string): string {
  const texte = (brut ?? "").trim();
  if (texte === "") return repli;
  // Les nôtres commencent par une majuscule et finissent par un point ;
  // celles de Postgres portent la trace de la mécanique.
  if (/violates|constraint|relation|syntax|null value|duplicate key/i.test(texte)) return repli;
  return texte;
}

function identifiants(formData: FormData): string[] {
  // Les cases cochées arrivent en plusieurs entrées du même nom.
  const bruts = formData.getAll("objet").map((v) => String(v).trim());
  const uniques: string[] = [];
  for (const id of bruts) {
    // La forme d'un uuid, vérifiée avant de la mettre dans une URL : ce
    // qui sort d'ici finira dans un lien, et un lien est le premier
    // endroit où l'on colle n'importe quoi.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) continue;
    if (!uniques.includes(id)) uniques.push(id);
  }
  return uniques;
}

// ══════════════════════════════════════════════════════════════════
// § 16 — POSER LES ÉTIQUETTES, PUIS ALLER À LA PLANCHE
// ══════════════════════════════════════════════════════════════════

/**
 * Crée les étiquettes manquantes de la sélection, puis mène à la
 * planche.
 *
 * DEUX FOIS LE MÊME BOUTON DONNE DEUX FOIS LA MÊME PLANCHE. C'est
 * `etiquette_creer()` qui le garantit : sans `p_renouveler`, elle rend
 * l'étiquette qui existe déjà plutôt que d'en battre une neuve. Sans
 * cela, un double clic aurait suffi à périmer la planche imprimée cinq
 * minutes plus tôt.
 */
export async function poserEtiquettes(formData: FormData) {
  // On n'a pas besoin de l'entreprise renvoyée : `etiquettes_creer_lot`
  // déduit la portée de chaque cible et vérifie le droit elle-même
  // (0090 § 7). L'appel sert de garde d'entrée — pas de session, pas
  // d'entreprise active, on ne va pas plus loin.
  await requireOrganization();
  const source = String(formData.get("source") ?? "");
  if (!estSource(source)) {
    await flash("error", "Cette famille d'éléments ne peut pas porter d'étiquette.");
    redirect(RACINE);
  }

  const ids = identifiants(formData);
  if (ids.length === 0) {
    await flash("info", "Cochez au moins un élément avant d'imprimer.");
    redirect(`${RACINE}/imprimer?source=${source}`);
  }
  if (ids.length > PLAFOND_SELECTION) {
    await flash(
      "info",
      `${ids.length} éléments d'un coup, c'est trop : ${PLAFOND_SELECTION} au maximum par planche.`,
    );
    redirect(`${RACINE}/imprimer?source=${source}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("etiquettes_creer_lot", {
    p_entite_type: source,
    p_entite_ids: ids,
    p_type: "qr",
    // PUBLIER EST UN GESTE À PART, et il ne se prend pas par défaut :
    // une étiquette publiée montre une fiche à n'importe quel passant.
    // La case est décochée, et elle porte sa propre explication.
    p_public_fiche: formData.get("public_fiche") === "on",
  });

  if (error) {
    await flash(
      "error",
      messageLisible(error.message, "Impossible de poser ces étiquettes. Réessayez."),
    );
    redirect(`${RACINE}/imprimer?source=${source}`);
  }

  const parametres = new URLSearchParams({ source, objets: ids.join(",") });
  const modele = String(formData.get("modele") ?? "").trim();
  if (modele) parametres.set("modele", modele);
  // LES COTES ET LA GÉOMÉTRIE VOYAGENT AVEC LE RESTE. Sans elles, le
  // format personnalisé du § 17 et le calage sur planche prédécoupée
  // étaient implémentés, testés, et inatteignables depuis l'écran :
  // la seule façon de les exercer était de composer l'URL à la main.
  for (const cle of [
    "support",
    "copies",
    "cases_sautees",
    "texte_libre",
    "largeur_mm",
    "hauteur_mm",
    "mx_mm",
    "my_mm",
    "gx_mm",
    "gy_mm",
    "origine",
  ]) {
    const valeur = String(formData.get(cle) ?? "").trim();
    if (valeur) parametres.set(cle, valeur);
  }
  if (formData.get("traits_de_coupe") === "on") parametres.set("traits", "1");

  revalidatePath(`${RACINE}/imprimer`);
  redirect(`${RACINE}/imprimer/planche?${parametres.toString()}`);
}

/**
 * Publie ou dépublie une étiquette déjà posée.
 *
 * C'est le seul réglage de ce module qui change ce qu'un INCONNU voit.
 * Il vit sur la liste plutôt que dans un écran de réglages parce que
 * la question se pose objet par objet : la fiche botanique d'un
 * palmier dans un jardin ouvert au public n'a pas la même sensibilité
 * qu'un lot de pépinière.
 */
async function changerPublication(formData: FormData, publier: boolean) {
  await requireOrganization();
  const id = String(formData.get("etiquette") ?? "");
  const source = String(formData.get("source") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("etiquette_publier", { p_id: id, p_publique: publier });

  if (error) {
    await flash("error", messageLisible(error.message, "Impossible de changer la publication."));
  } else {
    await flash(
      "success",
      publier
        ? "Étiquette publiée : un visiteur qui la scanne verra une fiche réduite."
        : "Étiquette dépubliée : seuls vos comptes autorisés y accèdent désormais.",
    );
  }
  revalidatePath(`${RACINE}/imprimer`);
  redirect(estSource(source) ? `${RACINE}/imprimer?source=${source}` : RACINE);
}

/**
 * DEUX ACTIONS PLUTÔT QU'UNE AVEC UN BOOLÉEN, ET C'EST UNE CONTRAINTE
 * DE HTML, PAS UN CAPRICE.
 *
 * Les boutons de publication vivent DANS le grand formulaire de
 * sélection — un formulaire imbriqué n'existe pas en HTML. Un bouton
 * ne peut transmettre qu'UN couple nom/valeur, qui sert déjà à dire
 * QUELLE étiquette. Le sens du geste doit donc venir de la fonction
 * appelée, pas d'un second paramètre qu'on ne peut pas envoyer.
 */
export async function publierFiche(formData: FormData) {
  await changerPublication(formData, true);
}

export async function depublierFiche(formData: FormData) {
  await changerPublication(formData, false);
}

/**
 * Révoque une étiquette : l'autocollant est arraché, perdu, ou collé
 * sur le mauvais pot.
 *
 * ELLE N'EST PAS SUPPRIMÉE — 0090 § 7 l'explique : un jeton révoqué
 * doit continuer de refuser proprement, et son historique de scans
 * reste lisible. Après quoi l'objet redevient « sans étiquette » et
 * peut en recevoir une neuve, avec un jeton neuf.
 */
export async function revoquerEtiquette(formData: FormData) {
  await requireOrganization();
  const id = String(formData.get("etiquette") ?? "");
  const source = String(formData.get("source") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("etiquette_desactiver", { p_id: id });

  if (error) {
    await flash("error", messageLisible(error.message, "Impossible de révoquer cette étiquette."));
  } else {
    await flash(
      "success",
      "Étiquette révoquée. L'autocollant en circulation ne mène plus à rien ; vous pouvez en imprimer une neuve.",
    );
  }
  revalidatePath(`${RACINE}/imprimer`);
  redirect(estSource(source) ? `${RACINE}/imprimer?source=${source}` : RACINE);
}

// ══════════════════════════════════════════════════════════════════
// § 18 — LES MODÈLES
// ══════════════════════════════════════════════════════════════════

export async function enregistrerModele(formData: FormData) {
  const organization = await requireOrganization();
  const { brouillon, fautes } = lireBrouillon(formData);
  const id = String(formData.get("modele_id") ?? "").trim();

  if (!brouillon) {
    // On rend les fautes TOUTES ENSEMBLE, pas la première : corriger
    // une cote pour découvrir la suivante au coup d'après est la
    // manière la plus sûre de faire abandonner.
    await flash("error", fautes.join(" "));
    redirect(id ? `${RACINE}/modeles/${id}` : `${RACINE}/modeles`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("etiquette_modele_enregistrer", {
    p_organization_id: organization.organizationId,
    p_famille: brouillon.famille,
    p_nom: brouillon.nom,
    p_largeur_mm: brouillon.largeurMm,
    p_hauteur_mm: brouillon.hauteurMm,
    p_champs: champsVersJson(brouillon.champs),
    p_marge_mm: brouillon.margeMm,
    p_est_defaut: brouillon.estDefaut,
    p_id: id === "" ? null : id,
  });

  if (error) {
    await flash(
      "error",
      messageLisible(error.message, "Impossible d'enregistrer ce modèle. Vérifiez les cotes."),
    );
    redirect(id ? `${RACINE}/modeles/${id}` : `${RACINE}/modeles`);
  }

  const nouveau = typeof data === "string" ? data : id;
  await flash("success", `Modèle « ${brouillon.nom} » enregistré.`);
  revalidatePath(`${RACINE}/modeles`);
  redirect(`${RACINE}/modeles/${nouveau}`);
}

/**
 * Duplique un modèle dans l'entreprise, et ouvre la copie.
 *
 * C'EST LE SEUL CHEMIN DE CRÉATION, ET C'EST VOULU. Un éditeur qui
 * s'ouvre sur une étiquette vide oblige à poser douze champs à la main
 * avant de voir quoi que ce soit ; partir du modèle Oasis de la
 * famille donne une étiquette juste en un clic, qu'on retouche ensuite.
 * C'est aussi ce qui rend les modèles fournis utiles plutôt que
 * décoratifs — ils sont modifiables PAR COPIE, jamais en place
 * (0090 § 8.c refuse explicitement `organization_id` nul).
 */
export async function dupliquerModele(formData: FormData) {
  const organization = await requireOrganization();
  const source = String(formData.get("modele_id") ?? "").trim();
  if (!source) redirect(`${RACINE}/modeles`);

  const supabase = await createClient();
  const { data: ligne, error: erreurLecture } = await supabase
    .from("etiquette_modeles")
    .select("famille, nom, largeur_mm, hauteur_mm, marge_mm, champs")
    .eq("id", source)
    .is("archived_at", null)
    .maybeSingle();

  if (erreurLecture || !ligne) {
    await flash("error", "Ce modèle est introuvable.");
    redirect(`${RACINE}/modeles`);
  }

  const { data, error } = await supabase.rpc("etiquette_modele_enregistrer", {
    p_organization_id: organization.organizationId,
    p_famille: ligne.famille,
    p_nom: `${String(ligne.nom ?? "Modèle")} (copie)`,
    p_largeur_mm: ligne.largeur_mm,
    p_hauteur_mm: ligne.hauteur_mm,
    p_champs: ligne.champs ?? [],
    p_marge_mm: ligne.marge_mm,
    // La copie ne prend PAS la place du défaut : dupliquer est un
    // geste d'essai, et rien ne doit changer pour les autres avant
    // qu'on ait décidé que la copie est meilleure.
    p_est_defaut: false,
    p_id: null,
  });

  if (error) {
    await flash(
      "error",
      messageLisible(error.message, "Impossible de dupliquer ce modèle."),
    );
    redirect(`${RACINE}/modeles`);
  }

  revalidatePath(`${RACINE}/modeles`);
  redirect(`${RACINE}/modeles/${String(data)}`);
}

export async function archiverModele(formData: FormData) {
  await requireOrganization();
  const id = String(formData.get("modele_id") ?? "").trim();
  if (!id) redirect(`${RACINE}/modeles`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("etiquette_modele_archiver", { p_id: id });

  if (error) {
    await flash("error", messageLisible(error.message, "Impossible d'archiver ce modèle."));
  } else {
    await flash("success", "Modèle archivé. Les étiquettes déjà imprimées ne changent pas.");
  }
  revalidatePath(`${RACINE}/modeles`);
  redirect(`${RACINE}/modeles`);
}

/** Utilisé par l'écran d'accueil pour envoyer sur le bon gisement. */
export async function ouvrirGisement(formData: FormData) {
  const source = String(formData.get("source") ?? "");
  if (!estSource(source)) redirect(RACINE);
  // `gisement()` lève si la clé est inconnue : la validation ci-dessus
  // le garantit déjà, et cet appel documente que la clé est bien celle
  // du catalogue et pas une chaîne quelconque.
  redirect(`${RACINE}/imprimer?source=${gisement(source as SourceEtiquette).cle}`);
}
