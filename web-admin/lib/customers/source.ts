import "server-only";

import { createClient } from "@/lib/supabase/server";

import { AdminAccessDenied, AdminFilterRefused, AdminReadFailed } from "./errors";
import { PAGE_SIZE, toPage, type Paged } from "./pagination";
import type { AdminOrganizationRow, AdminSearchRow, AdminUserRow } from "./types";

/**
 * ==================================================================
 * D'OÙ VIENNENT LES COMPTES, LES ENTREPRISES ET LES RÉSULTATS
 * ==================================================================
 *
 * Cinq lectures, toutes par les fonctions `security definer` de la
 * migration 0075, toutes avec la SESSION DE L'ADMINISTRATEUR.
 *
 * ------------------------------------------------------------------
 * PAS DE `service_role` ICI, ET CE N'EST PAS UN OUBLI
 * ------------------------------------------------------------------
 * Les fonctions de 0075 s'authentifient par `auth.uid()` et n'accordent
 * l'`execute` qu'au rôle `authenticated`. Un client `service_role` les
 * appellerait en vain : il n'a pas le droit d'exécution, et `auth.uid()`
 * y serait nul.
 *
 * C'est l'application la plus stricte de la règle « les opérations
 * privilégiées passent par le backend » (spec p.31-32), pas son
 * contournement : la clé maîtresse n'est jamais chargée pour AFFICHER
 * une liste, et le contrôle d'identité est refait DANS la base, où
 * aucune erreur de raisonnement de ce fichier ne peut le court-circuiter.
 * Le `import "server-only"` rend la chose mécanique : un composant
 * client qui importerait ce module ne compilerait pas, au lieu de fuir
 * silencieusement dans le bundle du navigateur.
 *
 * ------------------------------------------------------------------
 * DES NOMBRES, PAS DES LIGNES (règle R5)
 * ------------------------------------------------------------------
 * Aucune fonction appelée ici ne rend un devis, une facture, une
 * plante ni une photo. Les colonnes d'usage sont des `count` : on
 * apprend qu'une entreprise a 42 devis, on n'apprend rien de ces devis.
 * Ce module ne doit jamais aller chercher le détail « pour illustrer » —
 * ce serait défaire en TypeScript le travail fait en SQL.
 */

/**
 * Appelle une fonction de liste et rend ses lignes.
 *
 * `filter` n'est là que pour pouvoir NOMMER le filtre fautif dans
 * l'erreur : la base dit très bien pourquoi elle refuse, mais elle ne
 * répète pas la valeur sous une forme exploitable par l'interface.
 */
async function callAdminList<Row>(
  name: string,
  args: Record<string, unknown>,
  filter: string | null,
): Promise<Row[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    // 42501 — insufficient_privilege. Les deux refus de 0075 : « pas
    // administrateur » et « permission manquante ».
    if (error.code === "42501") {
      throw new AdminAccessDenied(error.message);
    }

    // 0A000 — feature_not_supported : un filtre que la donnée ne
    // permet pas (mobile, trial, cancelled).
    // 22023 — invalid_parameter_value : un filtre hors catalogue.
    if (error.code === "0A000" || error.code === "22023") {
      throw new AdminFilterRefused(filter ?? "(aucun)", error.message);
    }

    // PGRST202 : PostgREST ne trouve pas la fonction dans son cache de
    // schéma. 42883 : Postgres ne la connaît pas du tout. On ne
    // devrait jamais arriver ici — la garde appelle `admin_me()` avant
    // et lève déjà `ControlCenterNotDeployed` — mais un message exact
    // vaut mieux qu'un « échec de lecture » pour une migration non
    // appliquée.
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new AdminReadFailed(
        `la fonction ${name}() est introuvable — la migration 0075 n'est probablement pas appliquée, ou le cache de schéma de PostgREST n'a pas encore été rechargé.`,
      );
    }

    throw new AdminReadFailed(`${name} : ${error.message} (${error.code ?? "sans code"}).`);
  }

  // Une fonction `returns table` rend un tableau, éventuellement vide.
  // Le vide est ici une réponse LÉGITIME — aucun résultat — et non une
  // anomalie : contrairement au tableau de bord, on ne s'attend pas à
  // une ligne unique.
  return Array.isArray(data) ? (data as Row[]) : [];
}

export type ListQuery = {
  search: string | null;
  filter: string | null;
  page: number;
};

/**
 * ==================================================================
 * LA FENÊTRE ENTRE DEUX MIGRATIONS, ET POURQUOI ELLE MÉRITE DIX LIGNES
 * ==================================================================
 *
 * `admin_list_users` a gagné cinq colonnes avec la migration 0077.
 * Entre le déploiement de cette application et l'application de la
 * migration — quelques minutes, ou le temps que le cache de schéma de
 * PostgREST se recharge — la fonction rend l'ANCIENNE forme, et ces
 * cinq clés sont absentes de l'objet JSON.
 *
 * `undefined` n'est pas `null`, et toute cette interface repose sur
 * `null` pour dessiner l'inconnu : `value === null` déclenche le
 * marqueur et son motif, `value === undefined` traverse et rend une
 * case VIDE. Une case vide dans une colonne de versions se lit « aucune
 * version », ce qui est un fait, et il serait faux.
 *
 * On ramène donc l'absence à l'inconnu, une fois, ici. Le reste de
 * l'application n'a jamais à se demander laquelle des deux formes elle
 * regarde.
 */
function normalizeMobilePresence(row: AdminUserRow): AdminUserRow {
  return {
    ...row,
    mobile_platform: row.mobile_platform ?? null,
    mobile_app_version: row.mobile_app_version ?? null,
    mobile_install_count: row.mobile_install_count ?? null,
    mobile_last_seen_at: row.mobile_last_seen_at ?? null,
    mobile_presence_source: row.mobile_presence_source ?? null,
  };
}

/** USERS (spec p.7). Permission `platform.users.read`, vérifiée en SQL. */
export async function listUsers(query: ListQuery): Promise<Paged<AdminUserRow>> {
  const rows = await callAdminList<AdminUserRow>(
    "admin_list_users",
    {
      p_search: query.search,
      p_filter: query.filter,
      p_page: query.page,
      p_page_size: PAGE_SIZE,
    },
    query.filter,
  );

  return toPage(rows.map(normalizeMobilePresence), query.page, PAGE_SIZE);
}

/** PRO ORGANIZATIONS (spec p.9). Permission `platform.organizations.read`. */
export async function listOrganizations(query: ListQuery): Promise<Paged<AdminOrganizationRow>> {
  const rows = await callAdminList<AdminOrganizationRow>(
    "admin_list_organizations",
    {
      p_search: query.search,
      p_filter: query.filter,
      p_page: query.page,
      p_page_size: PAGE_SIZE,
    },
    query.filter,
  );

  return toPage(rows, query.page, PAGE_SIZE);
}

/**
 * ==================================================================
 * LA FICHE D'UN COMPTE — et pourquoi on RELIT l'identifiant
 * ==================================================================
 *
 * Il n'existe pas de `admin_user_detail()` dans 0075. La fiche se lit
 * donc par la fonction de liste, à qui l'on passe l'identifiant en
 * guise de recherche : `admin_list_users` compare `u.id::text = v_q`.
 *
 * ------------------------------------------------------------------
 * ON NE PREND PAS `rows[0]` LES YEUX FERMÉS
 * ------------------------------------------------------------------
 * C'est la règle R4 de l'audit, tirée de l'incident 0062 : un
 * identifiant venu de l'URL n'est jamais une preuve de portée, et la
 * cible se relit côté serveur.
 *
 * Ce n'est pas une précaution abstraite. La clause de recherche est un
 * `or` de plusieurs branches — l'égalité d'identifiant, mais aussi des
 * `ilike` sur l'e-mail et sur le nom. Une chaîne qui ressemble à un
 * uuid pourrait, en théorie, faire remonter une AUTRE ligne par une
 * autre branche, et une fiche afficherait alors le compte de quelqu'un
 * d'autre sous l'adresse demandée. On exige donc que la ligne rendue
 * porte exactement l'identifiant demandé, et on ignore tout le reste.
 */
export async function findUser(userId: string): Promise<AdminUserRow | null> {
  const rows = await callAdminList<AdminUserRow>(
    "admin_list_users",
    { p_search: userId, p_filter: null, p_page: 1, p_page_size: 200 },
    null,
  );

  return rows.find((row) => row.user_id === userId) ?? null;
}

/**
 * La fiche d'une entreprise.
 *
 * `p_filter: "toutes"` n'est pas un détail : la liste par défaut masque
 * les entreprises archivées (`archived_at` est un effacement doux,
 * migrations 0056 et 0060). Sans ce filtre, la fiche d'une entreprise
 * archivée rendrait un 404 — elle deviendrait introuvable alors qu'elle
 * est bien là, et c'est précisément le moment où un administrateur a
 * besoin de la consulter.
 *
 * Même relecture d'identifiant que pour un compte, et une raison de
 * plus de la faire : la recherche d'entreprise comporte une branche par
 * CHIFFRES (SIRET, SIREN, TVA), et un uuid est plein de chiffres.
 */
export async function findOrganization(
  organizationId: string,
): Promise<AdminOrganizationRow | null> {
  const rows = await callAdminList<AdminOrganizationRow>(
    "admin_list_organizations",
    { p_search: organizationId, p_filter: "toutes", p_page: 1, p_page_size: 200 },
    null,
  );

  return rows.find((row) => row.organization_id === organizationId) ?? null;
}

/**
 * GLOBAL ADMIN SEARCH (spec p.33). Permission `platform.search`.
 *
 * La fonction filtre ses propres branches par permission : elle ne rend
 * les comptes que si l'appelant porte `platform.users.read`, et les
 * entreprises que s'il porte `platform.organizations.read`. Une
 * recherche qui rendrait ce qu'une liste refuse serait une porte
 * dérobée dans le moindre privilège — le SQL s'en charge, cette
 * fonction n'a rien à ajouter.
 */
export async function searchPlatform(query: string, limit = 10): Promise<AdminSearchRow[]> {
  return callAdminList<AdminSearchRow>(
    "admin_global_search",
    { p_query: query, p_limit: limit },
    null,
  );
}
