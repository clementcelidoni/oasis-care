"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

import { estEnvoyable, verifierBrouillon } from "./apercu.ts";
import { empreinteAudience } from "./audience.ts";
import { CLES_COURRIER, phraseDeRefus, type PermissionCourrier } from "./permissions.ts";
import { viderLaFileDEnvoi } from "./machine.ts";
import { apercuAudience, lireCampagne } from "./source.ts";

/**
 * ==================================================================
 * LES CINQ ÉCRITURES DU COURRIER SORTANT
 * ==================================================================
 *
 * Elles ne touchent AUCUNE table. 0084 § 15 ne laisse à `authenticated`
 * que le `select` sur six tables, et pas même cela sur `email_consents`.
 * Le seul chemin est cinq fonctions `security definer` :
 *
 *   admin_create_email_campaign(titre, objet, corps, motif, gabarit)
 *   admin_send_email_campaign(campagne, motif)
 *   admin_suspend_organization_email(entreprise, motif)
 *   admin_resume_organization_email(entreprise, motif)
 *   admin_release_email_suppression(identifiant, motif)
 *
 * Chacune exige `platform_admin_can(…)`, PUIS le second facteur
 * (`platform_admin_require_mfa()`), PUIS un motif non vide, et écrit
 * elle-même dans `admin_audit_events`. La trace n'est pas un effet de
 * bord : elle est dans la même transaction. Si `record_admin_event()`
 * refuse, l'écriture est annulée avec elle — il n'existe pas d'état
 * « fait mais non tracé ».
 *
 * CE FICHIER N'A DONC RIEN À JOURNALISER LUI-MÊME, et ne doit surtout
 * pas essayer : une seconde ligne écrite depuis TypeScript pourrait
 * manquer là où la première ne peut pas.
 *
 * ------------------------------------------------------------------
 * TROIS BARRIÈRES, ET AUCUNE NE SUPPOSE QUE LES AUTRES ONT TENU
 * ------------------------------------------------------------------
 *   1. `requireAdmin()` : une Server Action ne passe PAS par le layout.
 *      Sans cet appel, elle serait la seule porte laissée ouverte.
 *   2. Le contrôle de permission ici, qui rend un MESSAGE plutôt qu'une
 *      redirection : dans un formulaire, une redirection perd la saisie
 *      et n'explique rien.
 *   3. `platform_admin_can(…)` dans la fonction SQL, la seule barrière
 *      qu'aucun remaniement de ce fichier ne peut déplacer.
 */

export type EtatFormulaire = {
  statut: "vierge" | "ok" | "erreur";
  message: string | null;
};

export const ETAT_VIERGE: EtatFormulaire = { statut: "vierge", message: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lireTexte(formData: FormData, nom: string): string {
  const brut = formData.get(nom);
  return typeof brut === "string" ? brut : "";
}

function lireUuid(formData: FormData, nom: string): string | null {
  const valeur = lireTexte(formData, nom).trim();
  return UUID.test(valeur) ? valeur : null;
}

/**
 * Traduit le refus d'une fonction de 0084.
 *
 * Les messages de 0084 sont écrits en français et disent exactement ce
 * qui a été refusé : on les affiche TELS QUELS. Le SQLSTATE ne sert
 * qu'à choisir la mise en contexte.
 *
 * `42501` recouvre DEUX refus qu'il ne faut pas confondre — « votre
 * rôle ne porte pas la permission » et « votre session n'est pas de
 * niveau aal2 ». Le message de la base les distingue ; c'est pourquoi
 * on le montre au lieu de le résumer.
 */
function messageDeLErreur(operation: string, error: { message: string; code?: string }): string {
  switch (error.code) {
    case "42501":
      return `${operation} : la base a refusé. ${error.message}`;
    case "23514":
    case "23505":
    case "23503":
      return error.message;
    case "PGRST202":
    case "42883":
      return (
        `${operation} : la fonction n'existe pas dans la base. La migration ` +
        "0084_emails.sql n'est probablement pas appliquée — ou le cache de schéma de PostgREST " +
        "n'a pas encore été rechargé."
      );
    default:
      return `${operation} : ${error.message} (${error.code ?? "sans code"}).`;
  }
}

/** La garde commune : administrateur, puis permission, puis message. */
async function garder(
  permission: PermissionCourrier,
): Promise<{ role: string } | { refus: EtatFormulaire }> {
  const admin = await requireAdmin();
  if (!admin.permissions.includes(permission)) {
    return {
      refus: { statut: "erreur", message: phraseDeRefus(admin.role, permission) },
    };
  }
  return { role: admin.role };
}

// ------------------------------------------------------------------
// 1. COMPOSER UNE ANNONCE
// ------------------------------------------------------------------

/**
 * Créer le BROUILLON. Rien ne part à cette étape, et c'est le point :
 * la composition et l'envoi sont deux gestes, séparés par un écran qui
 * montre l'audience et le rendu.
 *
 * Fusionner les deux — « composer et envoyer » — aurait supprimé le
 * seul moment où l'on peut encore voir « Bonjour {{prenom}} ».
 */
export async function creerAnnonce(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const garde = await garder(CLES_COURRIER.campagnesEnvoyer);
  if ("refus" in garde) return garde.refus;

  const brouillon = {
    titre: lireTexte(formData, "titre"),
    objet: lireTexte(formData, "objet"),
    corps: lireTexte(formData, "corps"),
    motif: lireTexte(formData, "motif"),
  };

  // LA MÊME VÉRIFICATION QUE DANS LE NAVIGATEUR, REFAITE ICI. Un
  // contrôle qui n'existe que côté client n'existe pas : il suffit
  // d'envoyer le formulaire autrement.
  const problemes = verifierBrouillon(brouillon);
  if (!estEnvoyable(problemes)) {
    const bloquants = problemes.filter((probleme) => probleme.gravite === "bloquant");
    return {
      statut: "erreur",
      message: bloquants.map((probleme) => probleme.phrase).join(" "),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_email_campaign", {
    p_title: brouillon.titre.trim(),
    p_subject: brouillon.objet.trim(),
    p_body_text: brouillon.corps,
    p_reason: brouillon.motif.trim(),
    p_template_key: "annonceCommerciale",
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Création de l'annonce", error) };
  }

  const identifiant = typeof data === "string" ? data : null;
  revalidatePath("/emails");

  // `redirect()` lève : elle est hors de tout `try`, sinon on
  // attraperait sa propre exception de contrôle.
  if (identifiant !== null) redirect(`/emails/${identifiant}`);

  return {
    statut: "ok",
    message: "L'annonce est créée. Ouvrez-la depuis la liste pour voir son audience.",
  };
}

// ------------------------------------------------------------------
// 2. ENVOYER — LE SEUL GESTE IRRÉVERSIBLE DE CE LOT
// ------------------------------------------------------------------

/**
 * ENVOYER L'ANNONCE À TOUT LE PARC.
 *
 * TROIS CONTRÔLES AVANT L'APPEL, ET AUCUN N'EST DÉCORATIF :
 *
 *   1. LE NOMBRE, RETAPÉ À LA MAIN. Il n'est pas comparé à ce que la
 *      page affichait — il est comparé à une audience RECALCULÉE ICI,
 *      côté serveur, au moment du clic. Un nombre recopié depuis un
 *      champ caché ne prouverait rien : il suffit de le modifier.
 *   2. L'EMPREINTE DE L'AUDIENCE. Deux entreprises qui se croisent —
 *      l'une se désabonne, l'autre consent — laissent le total
 *      inchangé. Le seul nombre laisserait alors partir un message vers
 *      quelqu'un que l'administrateur n'a jamais vu à l'écran.
 *   3. L'ÉTAT DE LA CAMPAGNE. La base refuse déjà une campagne qui
 *      n'est pas « brouillon » ; on le dit avant, parce que « Cette
 *      campagne est déjà "sent" » après avoir tapé un nombre et un
 *      motif est une façon désagréable de l'apprendre.
 *
 * CE QUE CES CONTRÔLES NE PEUVENT PAS EMPÊCHER, et qui doit être dit :
 * entre le recalcul et l'appel, il reste quelques millisecondes. La
 * garantie dure est ailleurs — dans la clé d'idempotence de
 * `email_messages`, qui est une colonne GÉNÉRÉE sous contrainte
 * d'unicité. Personne ne reçoit deux fois la même annonce, même si tout
 * le reste échoue.
 */
export async function envoyerAnnonce(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const garde = await garder(CLES_COURRIER.campagnesEnvoyer);
  if ("refus" in garde) return garde.refus;

  const campagneId = lireUuid(formData, "campagneId");
  if (campagneId === null) {
    return { statut: "erreur", message: "Identifiant d'annonce absent ou mal formé." };
  }

  const motif = lireTexte(formData, "motif").trim();
  if (motif === "") {
    return {
      statut: "erreur",
      message:
        "Le motif est obligatoire. Il s'inscrit au journal des actions administratives, où il sera relu par quelqu'un qui n'était pas là.",
    };
  }

  const campagne = await lireCampagne(campagneId);
  if (campagne === null) {
    return { statut: "erreur", message: "Cette annonce est introuvable." };
  }
  if (campagne.status !== "draft") {
    return {
      statut: "erreur",
      message: `Cette annonce est « ${campagne.status} » : une annonce ne se rejoue pas. Composez-en une nouvelle si vous devez réécrire au parc.`,
    };
  }

  const saisi = Number.parseInt(lireTexte(formData, "nombre").trim(), 10);
  if (!Number.isFinite(saisi)) {
    return {
      statut: "erreur",
      message: "Recopiez le nombre exact de destinataires pour confirmer. C'est le seul garde-fou avant un geste irréversible.",
    };
  }

  // L'AUDIENCE RECALCULÉE, MAINTENANT. Coûteuse, et c'est le prix d'un
  // contrôle qui vaut quelque chose.
  const { audience } = await apercuAudience(campagne.template_key);
  const attendu = audience.retenues.length;

  if (saisi !== attendu) {
    return {
      statut: "erreur",
      message:
        `Rien n'a été envoyé. Vous avez confirmé ${saisi} destinataire${saisi > 1 ? "s" : ""}, ` +
        `et le recalcul en trouve ${attendu}. Soit la saisie est fautive, soit l'audience a changé depuis ` +
        "l'affichage : rechargez la page et relisez la liste avant de recommencer.",
    };
  }

  const empreinteVue = lireTexte(formData, "empreinte");
  const empreinteMaintenant = empreinteAudience(audience);
  if (empreinteVue !== "" && empreinteVue !== empreinteMaintenant) {
    return {
      statut: "erreur",
      message:
        "Rien n'a été envoyé. Le nombre de destinataires n'a pas changé, mais la LISTE si : au moins une " +
        "entreprise est entrée et une autre est sortie depuis l'affichage. Rechargez la page pour voir qui.",
    };
  }

  if (attendu === 0) {
    return {
      statut: "erreur",
      message:
        "Aucun destinataire. Envoyer maintenant marquerait l'annonce comme « envoyée » sans qu'elle parte à personne, " +
        "et une annonce envoyée ne se rejoue pas : elle serait perdue. Voyez les motifs d'exclusion au-dessus.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_send_email_campaign", {
    p_campaign_id: campagneId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Envoi de l'annonce", error) };
  }

  const ligne = (Array.isArray(data) ? data[0] : data) as
    | { queued?: number; skipped?: number }
    | undefined;
  const misEnFile = Number(ligne?.queued ?? 0);
  const ecartes = Number(ligne?.skipped ?? 0);

  revalidatePath("/emails");
  revalidatePath(`/emails/${campagneId}`);

  // LE CAS QUI DOIT CRIER. Zéro message en file alors que l'aperçu en
  // annonçait : quelque chose a changé entre l'aperçu et le clic, ou
  // la porte a tout refusé. L'adresse technique, elle, ne peut plus en
  // être la cause — la fonction refuse désormais de partir sans elle et
  // laisse l'annonce en brouillon.
  if (misEnFile === 0) {
    return {
      statut: "erreur",
      message:
        `Aucun message n'est parti (${ecartes} écarté${ecartes > 1 ? "s" : ""}), alors que l'aperçu en annonçait ${attendu}. ` +
        "Rechargez la page : les motifs d'exclusion, entreprise par entreprise, disent ce que la porte a refusé. " +
        "Le plus fréquent est l'absence de consentement préalable, qui ne se présume pas et se recueille " +
        "dans les réglages de chaque entreprise.",
    };
  }

  // ── ET ON TRANSPORTE, TOUT DE SUITE ──────────────────────────────
  //
  // CE QUI MANQUAIT : personne ne vidait la file. `admin_send_email_campaign`
  // écrit une ligne par entreprise et s'arrête là ; le transport
  // appartient à la machine, qui seule détient la clé du transporteur.
  // Sans cet appel, une annonce « envoyée » restait indéfiniment en
  // attente, et l'écran affichait des messages qui ne partaient jamais.
  //
  // L'ÉCHEC DE CE TRANSPORT N'EST PAS L'ÉCHEC DE L'ENVOI. Les lignes
  // sont écrites, durables, et repartiront au passage suivant : la
  // phrase le dit plutôt que de transformer un retard en panne.
  const bilan = await viderLaFileDEnvoi();

  return {
    statut: "ok",
    message:
      `${misEnFile} message${misEnFile > 1 ? "s" : ""} mis en file, ${ecartes} écarté${ecartes > 1 ? "s" : ""}. ` +
      (bilan === null
        ? "Le transport n'a pas pu être déclenché depuis cet écran : les messages restent en file et partiront au prochain passage. "
        : `${bilan.envoyes} remis au transporteur. `) +
      "« Remis au transporteur » ne veut pas dire « reçu » : la remise appartient au transporteur, et l'état de chaque " +
      "message s'affiche ci-dessous à mesure qu'il répond.",
  };
}


// ------------------------------------------------------------------
// 3. SUSPENDRE ET RÉTABLIR L'EXPÉDITION D'UNE ENTREPRISE
// ------------------------------------------------------------------

/**
 * SUSPENDRE COUPE TOUT, TRANSACTIONNEL COMPRIS.
 *
 * C'est le seul endroit du produit où une FACTURE peut être arrêtée, et
 * 0084 l'assume à trois conditions qui sont toutes tenues : un humain
 * décide, un motif est obligatoire, et l'entreprise LIT ce motif dans
 * son propre écran — la politique de lecture de
 * `email_organization_settings` lui en donne le droit.
 *
 * LE MOTIF EST DONC UN MESSAGE AU CLIENT, pas une note interne. Le
 * formulaire le dit au-dessus du champ, parce que c'est au moment
 * d'écrire qu'il faut le savoir.
 */
export async function suspendreExpedition(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const garde = await garder(CLES_COURRIER.suspendre);
  if ("refus" in garde) return garde.refus;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) {
    return { statut: "erreur", message: "Identifiant d'entreprise absent ou mal formé." };
  }

  const motif = lireTexte(formData, "motif").trim();
  if (motif === "") {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : couper l'expédition d'une entreprise arrête aussi ses FACTURES, et elle lira ce motif dans son écran.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_suspend_organization_email", {
    p_organization_id: organizationId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Suspension de l'expédition", error) };
  }

  revalidatePath("/emails/delivrabilite");
  return {
    statut: "ok",
    message:
      "Expédition suspendue. Cette entreprise ne peut plus rien envoyer — devis et factures compris — et elle voit ce motif dans son propre écran.",
  };
}

export async function retablirExpedition(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const garde = await garder(CLES_COURRIER.suspendre);
  if ("refus" in garde) return garde.refus;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) {
    return { statut: "erreur", message: "Identifiant d'entreprise absent ou mal formé." };
  }

  const motif = lireTexte(formData, "motif").trim();
  if (motif === "") {
    return { statut: "erreur", message: "Motif obligatoire, y compris pour rétablir." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_resume_organization_email", {
    p_organization_id: organizationId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Rétablissement de l'expédition", error) };
  }

  revalidatePath("/emails/delivrabilite");
  return { statut: "ok", message: "Expédition rétablie." };
}

// ------------------------------------------------------------------
// 4. LEVER UNE SUPPRESSION
// ------------------------------------------------------------------

/**
 * Réhabiliter une adresse.
 *
 * LE MOTIF N'EST PAS UNE FORMALITÉ : solliciter à nouveau une personne
 * qui s'est plainte est ce qui fait tomber la délivrabilité du domaine
 * pour TOUT le parc — y compris les factures d'abonnement d'Oasis et
 * les messages d'authentification, qui partent du même domaine et qui
 * fonctionnent aujourd'hui.
 *
 * L'ADRESSE N'EST PAS SAISIE À LA MAIN : elle vient de la ligne
 * affichée. Un champ libre permettrait de lever une suppression sur une
 * adresse qu'on n'a jamais vue.
 */
export async function leverSuppression(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const garde = await garder(CLES_COURRIER.suppressionsGerer);
  if ("refus" in garde) return garde.refus;

  // L'IDENTIFIANT DE LA LIGNE, PLUS L'ADRESSE. Depuis que la liste ne
  // s'affiche que masquée, demander l'adresse serait soit impossible,
  // soit la preuve qu'on la lit ailleurs. L'identifiant vient de la
  // ligne affichée, en champ caché.
  const suppressionId = lireTexte(formData, "suppression_id").trim();
  const motif = lireTexte(formData, "motif").trim();

  if (suppressionId === "") {
    return {
      statut: "erreur",
      message: "Ligne absente. Cette action se déclenche depuis une ligne de la liste, jamais d'une saisie libre.",
    };
  }
  if (motif === "") {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : réhabiliter une adresse qui s'est plainte engage la réputation du domaine pour tout le parc.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_release_email_suppression", {
    p_suppression_id: suppressionId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Levée de la suppression", error) };
  }

  const lignes = typeof data === "number" ? data : 0;
  revalidatePath("/emails/suppressions");

  if (lignes === 0) {
    return {
      statut: "erreur",
      message:
        "Aucune ligne n'a été levée : cette suppression avait déjà été levée, ou l'adresse a changé entre l'affichage et le clic. Rechargez la liste.",
    };
  }

  return {
    statut: "ok",
    message: `Suppression levée. Cette adresse peut de nouveau recevoir de la publicité — elle recevait déjà le transactionnel, qu'une suppression n'a jamais bloqué.`,
  };
}
