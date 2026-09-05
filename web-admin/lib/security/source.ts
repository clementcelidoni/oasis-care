import "server-only";

import { createClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminReadFailed } from "@/lib/customers/errors";

import { PREFIXES_FAMILLE, type FamilleAction } from "./journal.ts";
import type { EvenementAudit, FicheAdministrateur } from "./types.ts";

/**
 * ==================================================================
 * D'OÙ VIENT CE QUE MONTRE LE CENTRE DE SÉCURITÉ
 * ==================================================================
 *
 * De DEUX sources, et de deux seulement :
 *
 *   • `admin_audit_events` — la table de 0075 § 3, lue par sa politique
 *     `platform_admin_can('platform.audit.read')`. Elle porte tout ce
 *     que les fonctions administratives ont écrit : qui, quoi, sur quoi,
 *     avant, après, motif, quand.
 *   • `admin_list_platform_admins()` — la fonction de 0081 § 3.f, seule
 *     lecture possible de `auth.mfa_factors` depuis cette application.
 *
 * Les sessions d'assistance viennent de `lib/support/source.ts`, qu'on
 * IMPORTE plutôt que de recopier : les deux modules appartiennent au
 * même lot, et deux lectures de `support_sessions` finiraient par ne
 * plus sélectionner les mêmes colonnes.
 *
 * ------------------------------------------------------------------
 * CE QUI N'EST PAS UNE SOURCE, ET QUI NE PEUT PAS LE DEVENIR ICI
 * ------------------------------------------------------------------
 * Le schéma `auth` n'est pas exposé à PostgREST : ni
 * `auth.audit_log_entries` (vide sur ce projet, vérifié), ni
 * `auth.sessions`, ni `auth.mfa_factors` ne sont atteignables autrement
 * que par une fonction `security definer` de `public`. Il n'en existe
 * que trois — `admin_live_activity`, `admin_list_users`,
 * `admin_list_platform_admins` — et aucune n'ouvre l'historique des
 * connexions. Voir `inconnus.ts` : ce qui manque y est nommé plutôt
 * qu'affiché en zéro.
 *
 * Tout passe par la SESSION de l'administrateur, jamais par
 * `service_role`. Sur cet écran-ci, la raison est presque comique à
 * force d'être évidente : un centre de sécurité qui contournerait la
 * sécurité pour se remplir n'aurait plus rien à surveiller.
 */

function traduire(nom: string, error: { message: string; code?: string }): never {
  if (error.code === "42501") throw new AdminAccessDenied(error.message);
  if (error.code === "PGRST205" || error.code === "42P01") {
    throw new AdminReadFailed(
      `la table ${nom} est introuvable — la migration 0075_control_center.sql n'est ` +
        "probablement pas appliquée, ou le cache de schéma de PostgREST n'a pas encore été rechargé.",
    );
  }
  throw new AdminReadFailed(`${nom} : ${error.message} (${error.code ?? "sans code"}).`);
}

const COLONNES_EVENEMENT =
  "id, admin_user_id, admin_role, action, target_type, target_id, target_label, " +
  "old_value, new_value, reason, ip, user_agent, session_metadata, occurred_at";

/** Combien d'actes par page. Un journal se relit, il ne se déroule pas. */
export const TAILLE_PAGE_JOURNAL = 40;

export type FiltresJournal = {
  famille: FamilleAction | null;
  /** Un identifiant d'administrateur, pour « tout ce qu'a fait untel ». */
  adminUserId: string | null;
  /** Bornage bas, en ISO. `null` = depuis toujours. */
  depuis: string | null;
  recherche: string | null;
  page: number;
};

/**
 * Le filtre PostgREST d'une famille.
 *
 * `PREFIXES_FAMILLE` est le miroir de `familleAction()`, et
 * `journal.test.ts` vérifie que les deux disent la même chose. Sans ce
 * test, le filtre de l'écran et le regroupement des chiffres
 * finiraient par ne plus désigner le même ensemble, et le total
 * afficherait un nombre qui ne correspondrait pas à sa propre liste.
 *
 * `autre` n'a aucun préfixe et ne peut donc pas se filtrer en base : le
 * filtre n'est pas proposé pour elle, et cette fonction rend `null`.
 */
function filtreFamille(famille: FamilleAction): string | null {
  const prefixes = PREFIXES_FAMILLE[famille];
  if (prefixes.length === 0) return null;
  return prefixes.map((prefixe) => `action.like.${prefixe}*`).join(",");
}

export type PageJournal = {
  lignes: EvenementAudit[];
  total: number | null;
};

export async function listerEvenements(filtres: FiltresJournal): Promise<PageJournal> {
  const supabase = await createClient();

  let requete = supabase
    .from("admin_audit_events")
    .select(COLONNES_EVENEMENT, { count: "exact" })
    .order("occurred_at", { ascending: false });

  if (filtres.famille !== null) {
    const filtre = filtreFamille(filtres.famille);
    if (filtre !== null) requete = requete.or(filtre);
  }
  if (filtres.adminUserId !== null) requete = requete.eq("admin_user_id", filtres.adminUserId);
  if (filtres.depuis !== null) requete = requete.gte("occurred_at", filtres.depuis);
  if (filtres.recherche !== null) {
    // La recherche porte sur le MOTIF, qui est la seule colonne écrite
    // en langue naturelle. Chercher dans `action` serait redondant avec
    // le filtre de famille, et chercher dans `old_value`/`new_value`
    // ferait remonter des identifiants sans que personne comprenne
    // pourquoi.
    const motif = filtres.recherche.replace(/[,()"\\]/g, " ").trim();
    if (motif !== "") requete = requete.ilike("reason", `%${motif}%`);
  }

  const debut = (filtres.page - 1) * TAILLE_PAGE_JOURNAL;
  const { data, error, count } = await requete.range(
    debut,
    debut + TAILLE_PAGE_JOURNAL - 1,
  );

  if (error) traduire("admin_audit_events", error);
  return { lignes: (data ?? []) as unknown as EvenementAudit[], total: count ?? null };
}

/**
 * Le nombre d'actes d'une famille sur une fenêtre.
 *
 * Rend `null` en cas d'échec, JAMAIS zéro. « 0 changement de droits »
 * se lit « personne n'a touché aux permissions » ; un échec de lecture
 * ne permet pas cette affirmation, et c'est précisément l'affirmation
 * qu'un responsable sécurité prendrait pour argent comptant.
 */
export async function compterEvenements(
  famille: FamilleAction | null,
  depuis: string | null,
): Promise<number | null> {
  const supabase = await createClient();

  let requete = supabase
    .from("admin_audit_events")
    .select("id", { count: "exact", head: true });

  if (famille !== null) {
    const filtre = filtreFamille(famille);
    if (filtre === null) return null;
    requete = requete.or(filtre);
  }
  if (depuis !== null) requete = requete.gte("occurred_at", depuis);

  const { count, error } = await requete;
  if (error) return null;
  return count ?? null;
}

/** Les derniers actes, toutes familles — pour la chronologie du centre. */
export async function derniersEvenements(limite = 12): Promise<EvenementAudit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_audit_events")
    .select(COLONNES_EVENEMENT)
    .order("occurred_at", { ascending: false })
    .limit(limite);

  if (error) traduire("admin_audit_events", error);
  return (data ?? []) as unknown as EvenementAudit[];
}

/**
 * La liste des administrateurs de plateforme.
 *
 * Rend `null` — et non une liste vide — quand le rôle ne porte pas
 * `platform.admins.read` ou quand 0081 n'est pas appliquée. La
 * distinction est la même que partout ailleurs dans cette application :
 * une liste vide affirmerait qu'il n'y a aucun administrateur, ce qui
 * serait une information stupéfiante et fausse.
 */
export async function lireAdministrateurs(): Promise<FicheAdministrateur[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_platform_admins");

  if (error) {
    if (error.code === "42501" || error.code === "PGRST202" || error.code === "42883") {
      return null;
    }
    throw new AdminReadFailed(
      `admin_list_platform_admins : ${error.message} (${error.code ?? "sans code"}).`,
    );
  }
  return (Array.isArray(data) ? data : []) as FicheAdministrateur[];
}

/**
 * Les adresses des administrateurs, pour signer les lignes du journal.
 *
 * UNE SEULE REQUÊTE POUR TOUTE LA PAGE, et c'est ce qui la distingue de
 * la résolution des comptes clients (`lib/support/source.ts`, une par
 * fiche) : les administrateurs de plateforme sont une poignée, la
 * fonction les rend tous d'un coup, et le journal a besoin d'un nom sur
 * chaque ligne.
 *
 * Rend une carte VIDE plutôt que de lever : le journal reste lisible
 * sous des identifiants tronqués, et un uuid reste une information —
 * c'est celle qu'on recopie pour aller plus loin.
 */
export async function chargerAdressesAdmins(): Promise<Map<string, string>> {
  const carte = new Map<string, string>();
  let fiches: FicheAdministrateur[] | null;
  try {
    fiches = await lireAdministrateurs();
  } catch {
    return carte;
  }
  if (fiches === null) return carte;

  for (const fiche of fiches) {
    const nom = fiche.email ?? fiche.display_name;
    if (nom !== null) carte.set(fiche.user_id, nom);
  }
  return carte;
}

/**
 * La couverture du second facteur.
 *
 * `null` sur chacun des deux nombres quand la liste est fermée : « 0
 * administrateur protégé » serait une alarme fausse, et « 0 sur 0 » une
 * absurdité.
 */
export type CouvertureMfa = {
  actifs: number | null;
  protegesParUnFacteur: number | null;
  /** Ceux qu'il faudra prévenir avant de basculer la politique sur « exigé ». */
  sansFacteur: FicheAdministrateur[];
};

export function couvertureMfa(fiches: FicheAdministrateur[] | null): CouvertureMfa {
  if (fiches === null) {
    return { actifs: null, protegesParUnFacteur: null, sansFacteur: [] };
  }
  const actifs = fiches.filter((fiche) => fiche.is_active);
  return {
    actifs: actifs.length,
    protegesParUnFacteur: actifs.filter((fiche) => fiche.has_verified_mfa).length,
    sansFacteur: actifs.filter((fiche) => !fiche.has_verified_mfa),
  };
}
