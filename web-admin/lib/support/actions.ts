"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

import { peut } from "./guard.ts";
import { phraseDeRefus } from "./permissions.ts";
import { STATUTS_TICKET } from "./types.ts";

/**
 * ==================================================================
 * LES TROIS ÉCRITURES DE L'ASSISTANCE
 * ==================================================================
 *
 * Elles ne touchent AUCUNE table directement. 0081 § 9.a retire à
 * `authenticated` tout droit d'écriture sur `support_tickets`,
 * `support_ticket_messages`, `support_sessions` et `support_access_log`
 * — il ne reste que `select`. Le seul chemin est trois fonctions
 * `security definer` :
 *
 *   admin_reply_support_ticket(ticket, corps, motif, interne, statut, s'assigner)
 *   admin_start_support_session(niveau, motif, org, personne, minutes, ticket)
 *   admin_revoke_support_session(session, motif)
 *
 * Chacune exige `platform_admin_can(…)`, puis le second facteur
 * (`platform_admin_require_mfa()`), puis un motif non vide, et rend
 * l'identifiant de sa ligne de journal. La trace n'est pas un effet de
 * bord : c'est la valeur de retour. Si `record_admin_event()` refuse,
 * l'écriture est annulée avec elle — il n'existe pas d'état « fait mais
 * non tracé ».
 *
 * Ce fichier n'a donc rien à journaliser lui-même, et ne doit surtout
 * pas essayer : une seconde ligne de journal écrite depuis TypeScript
 * pourrait manquer là où la première ne peut pas.
 *
 * ------------------------------------------------------------------
 * CE QUI N'EXISTE PAS ICI, ET QUI N'EXISTERA PAS
 * ------------------------------------------------------------------
 * Aucune action « se connecter en tant que ce client ». Pas de version
 * désactivée, pas de brouillon commenté, pas de nom de fonction réservé
 * pour plus tard. La spec p.21 l'interdit en toutes lettres, et un
 * premier jalon d'une porte dérobée est le début du chemin qui y mène.
 *
 * Aucune action d'ÉCRITURE sous session d'assistance non plus : la base
 * n'expose pas de `support_session_record_write`, et il n'y a rien à
 * appeler. L'assistance regarde.
 *
 * ------------------------------------------------------------------
 * TROIS BARRIÈRES, ET AUCUNE NE SUPPOSE QUE LES AUTRES ONT TENU
 * ------------------------------------------------------------------
 *   1. `requireAdmin()` : identité vérifiée auprès du serveur Auth,
 *      fiche `platform_admins`, second facteur si la politique l'exige.
 *      Une Server Action ne passe PAS par le layout : sans cet appel,
 *      elle serait la seule porte du Control Center laissée ouverte.
 *   2. `peut(admin, …)` ici, qui rend un message plutôt qu'une
 *      redirection — dans un formulaire, une redirection perd la saisie
 *      et n'explique rien.
 *   3. `platform_admin_can(…)` dans la fonction SQL, qui est la seule
 *      barrière qu'aucun remaniement de ce fichier ne peut déplacer.
 */

export type EtatFormulaire = {
  statut: "vierge" | "ok" | "erreur";
  message: string | null;
};

export const ETAT_VIERGE: EtatFormulaire = { statut: "vierge", message: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Traduit le refus d'une fonction de 0081.
 *
 * Les messages de 0081 sont écrits en français et disent exactement ce
 * qui a été refusé et pourquoi : on les affiche TELS QUELS plutôt que
 * de les remplacer par une phrase de notre cru. Le code SQLSTATE ne
 * sert qu'à choisir la mise en contexte.
 *
 * `42501` mérite une précision que ce module est le seul à devoir
 * faire : depuis 0081 § 2, il recouvre DEUX refus différents — « votre
 * rôle ne porte pas la permission » et « votre session n'est pas de
 * niveau aal2 ». Le message de la base distingue les deux ; c'est
 * pourquoi on le montre au lieu de le résumer.
 */
function messageDeLErreur(
  operation: string,
  error: { message: string; code?: string },
): string {
  switch (error.code) {
    case "42501":
      return `${operation} : la base a refusé. ${error.message}`;
    case "23514":
    case "23505":
      return error.message;
    case "23503":
      return `${operation} : ${error.message}`;
    case "PGRST202":
    case "42883":
      return (
        `${operation} : la fonction n'existe pas dans la base. La migration ` +
        "0081_control_center_suite.sql n'est probablement pas appliquée — ou le cache de " +
        "schéma de PostgREST n'a pas encore été rechargé."
      );
    default:
      return `${operation} : ${error.message} (${error.code ?? "sans code"}).`;
  }
}

function lireTexte(formData: FormData, nom: string): string | null {
  const brut = formData.get(nom);
  if (typeof brut !== "string") return null;
  const valeur = brut.trim();
  return valeur === "" ? null : valeur;
}

function lireUuid(formData: FormData, nom: string): string | null {
  const valeur = lireTexte(formData, nom);
  return valeur !== null && UUID.test(valeur) ? valeur : null;
}

function coche(formData: FormData, nom: string): boolean {
  return formData.get(nom) !== null;
}

// ------------------------------------------------------------------
// 1. Répondre à une demande
// ------------------------------------------------------------------

/**
 * Répondre, assigner, changer le statut — en un seul geste, comme on le
 * fait vraiment.
 *
 * LA NOTE INTERNE EST UNE CASE, ET C'EST DÉLIBÉRÉMENT LA MÊME BOÎTE.
 * Deux zones de saisie séparées — « réponse » et « note » — invitent à
 * la faute qui coûte le plus cher dans un outil d'assistance : écrire
 * dans la mauvaise. Une seule boîte, un interrupteur explicite au-
 * dessus, et l'écran change de couleur quand il est armé.
 *
 * La protection, elle, n'est pas dans la couleur : la politique de
 * lecture de `support_ticket_messages` (0081 § 8.a) réserve
 * `is_internal = true` aux administrateurs. Le client ne peut PAS lire
 * une note interne, même si l'interface se trompait.
 */
export async function repondreDemande(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!peut(admin, "support.tickets.write")) {
    return { statut: "erreur", message: phraseDeRefus(admin.role, "support.tickets.write") };
  }

  const ticketId = lireUuid(formData, "ticketId");
  if (ticketId === null) {
    return { statut: "erreur", message: "Demande absente ou mal formée dans le formulaire." };
  }

  const corps = lireTexte(formData, "corps");
  if (corps === null) {
    return { statut: "erreur", message: "Une réponse vide n'est pas une réponse." };
  }

  const motif = lireTexte(formData, "motif");
  if (motif === null) {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : répondre au nom d'Oasis Care est une action administrative, et le journal en garde la trace.",
    };
  }

  const statutBrut = lireTexte(formData, "statut");
  const statut =
    statutBrut !== null && (STATUTS_TICKET as readonly string[]).includes(statutBrut)
      ? statutBrut
      : null;
  if (statutBrut !== null && statut === null) {
    return { statut: "erreur", message: `Statut inconnu : « ${statutBrut} ».` };
  }

  const interne = coche(formData, "interne");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reply_support_ticket", {
    p_ticket_id: ticketId,
    p_body: corps,
    p_reason: motif,
    p_is_internal: interne,
    p_status: statut,
    p_assign_to_me: coche(formData, "assigner"),
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Répondre à la demande", error) };
  }

  revalidatePath("/support");
  revalidatePath(`/support/${ticketId}`);

  return {
    statut: "ok",
    message: interne
      ? "Note interne enregistrée et journalisée. Le client ne la voit pas."
      : "Réponse enregistrée et journalisée.",
  };
}

// ------------------------------------------------------------------
// 2. Ouvrir une session d'assistance
// ------------------------------------------------------------------

/**
 * L'ACTION LA PLUS SENSIBLE DU CONTROL CENTER.
 *
 * Elle n'ouvre par elle-même AUCUNE donnée : elle crée une autorisation
 * bornée, motivée, tracée, que `support_session_record_access()` fera
 * respecter à chaque usage. Ce que l'écran doit dire — et dit — c'est
 * ce que le niveau choisi ouvre RÉELLEMENT, table par table.
 *
 * LES QUATRE REFUS SONT EN BASE, PAS ICI (0081 § 8.c) : niveau inconnu,
 * niveau non accordable, niveau qui prétend ouvrir des données métier
 * sans ressource nommée, et session qui ne vise ni entreprise ni
 * personne. Ce fichier ne les rejoue pas — il les laisserait diverger.
 * Il ne fait que remplir le formulaire correctement.
 */
export async function ouvrirSessionAssistance(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!peut(admin, "support.sessions.manage")) {
    return { statut: "erreur", message: phraseDeRefus(admin.role, "support.sessions.manage") };
  }

  const niveau = lireTexte(formData, "niveau");
  if (niveau === null) {
    return { statut: "erreur", message: "Choisissez un niveau d'accès." };
  }

  const motif = lireTexte(formData, "motif");
  if (motif === null) {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : entrer dans le dossier d'un client sans dire pourquoi est exactement ce que la spec p.19 interdit.",
    };
  }

  const organizationId = lireUuid(formData, "organizationId");
  const customerUserId = lireUuid(formData, "customerUserId");
  if (organizationId === null && customerUserId === null) {
    return {
      statut: "erreur",
      message:
        "Une session vise une entreprise ou une personne : elle ne flotte pas. Collez un identifiant d'entreprise ou de compte.",
    };
  }

  const minutesBrut = lireTexte(formData, "minutes");
  const minutes = minutesBrut === null ? null : Number.parseInt(minutesBrut, 10);
  if (minutesBrut !== null && (!Number.isFinite(minutes) || (minutes as number) < 1)) {
    return {
      statut: "erreur",
      message:
        "La durée doit être un nombre de minutes d'au moins 1. Laissée vide, elle prend le maximum du niveau — la base la plafonne de toute façon.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_start_support_session", {
    p_access_level: niveau,
    p_reason: motif,
    p_organization_id: organizationId,
    p_customer_user_id: customerUserId,
    p_minutes: minutes,
    p_ticket_id: lireUuid(formData, "ticketId"),
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Ouvrir la session", error) };
  }

  revalidatePath("/support/sessions");
  revalidatePath("/securite");

  return {
    statut: "ok",
    message:
      "Session ouverte, journalisée, et visible du client. Elle se ferme d'elle-même à l'échéance : " +
      "l'expiration est vérifiée en base à chaque accès, pas par la bannière.",
  };
}

// ------------------------------------------------------------------
// 3. Révoquer une session
// ------------------------------------------------------------------

/**
 * COUPER DOIT ÊTRE PLUS FACILE QU'OUVRIR, et 0081 § 8.c le traduit en
 * droits : trois personnes peuvent fermer une session — celui qui l'a
 * ouverte, un habilité à conduire l'assistance, et le responsable
 * SÉCURITÉ, qui surveille sans jamais pouvoir ouvrir.
 *
 * D'où l'absence de `peut(admin, …)` ici, contrairement aux deux autres
 * actions : la condition n'est pas une permission unique mais une
 * disjonction que la base évalue. La rejouer en TypeScript, c'est
 * choisir entre refuser quelqu'un que la base accepterait (le
 * propriétaire de la session, quel que soit son rôle) et laisser passer
 * un appel que la base refusera. On laisse la base répondre, et on
 * affiche son refus.
 */
export async function revoquerSessionAssistance(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  await requireAdmin();

  const sessionId = lireUuid(formData, "sessionId");
  if (sessionId === null) {
    return { statut: "erreur", message: "Session absente ou mal formée dans le formulaire." };
  }

  const motif = lireTexte(formData, "motif");
  if (motif === null) {
    return {
      statut: "erreur",
      message: "Motif obligatoire : le client lit ce journal, et « révoquée » sans raison n'y apprend rien.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revoke_support_session", {
    p_session_id: sessionId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Révoquer la session", error) };
  }

  revalidatePath("/support/sessions");
  revalidatePath(`/support/sessions/${sessionId}`);
  revalidatePath("/securite");

  return { statut: "ok", message: "Session révoquée. Plus aucun accès ne passera par elle." };
}
