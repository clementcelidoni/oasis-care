import "server-only";

import { createClient } from "@/lib/supabase/server";

// Les trois classes d'erreur sont celles de `lib/customers/errors.ts`, et
// elles sont RÉUTILISÉES plutôt que recopiées une troisième fois. Leur
// nom parle de « customers » par accident d'histoire : ce qu'elles
// décrivent est la façon dont le SQL du Control Center REFUSE — accès,
// filtre, panne — et cela n'a rien de propre aux clients. Une troisième
// copie serait le moment où la duplication cesse de payer : trois jeux
// de classes identiques divergent au premier correctif, et
// `instanceof` cesse alors silencieusement de reconnaître l'erreur, ce
// qui la fait relancer au lieu de l'afficher.
import { AdminAccessDenied, AdminReadFailed } from "@/lib/customers/errors";

import { ACTIONS_JOURNAL_IA, type Entreprise, type LigneJournal, type LignePlafonds, type LigneSurcharge } from "./types.ts";

/**
 * ==================================================================
 * D'OÙ VIENNENT LES DONNÉES DES ÉCRANS IA
 * ==================================================================
 *
 * Tout passe par la SESSION DE L'ADMINISTRATEUR — `createClient()` de
 * `lib/supabase/server.ts` —, jamais par `service_role`.
 *
 * Ce n'est pas une préférence de style, c'est ce qui rend le contrôle
 * d'accès vérifiable : `platform_admin_can('ai.config.read')` est
 * évalué DANS PostgreSQL, à chaque ligne, par la politique « Platform
 * reads … » de 0080. Une clé de service contournerait la RLS, donc
 * aussi les erreurs de raisonnement de ce fichier — et le seul contrôle
 * restant serait le `requireAdmin()` d'une page, c'est-à-dire une ligne
 * de TypeScript qu'un remaniement peut déplacer.
 *
 * Le `import "server-only"` rend la chose mécanique : un composant
 * client qui importerait ce module ne COMPILERAIT pas, au lieu de fuir
 * dans le paquet du navigateur.
 *
 * ------------------------------------------------------------------
 * LE PIÈGE QUE CE MODULE DOIT ATTRAPER : LA RLS NE LÈVE PAS
 * ------------------------------------------------------------------
 * Si la migration 0080 n'est pas appliquée, la politique « Platform
 * reads » n'existe pas et ces lectures rendent ZÉRO LIGNE — sans
 * erreur, sans code, sans rien. L'écran afficherait « aucune surcharge
 * de modèle en vigueur », ce qui est une affirmation, et elle serait
 * fausse.
 *
 * D'où `diagnostiquerSocleIa()`, appelé avant toute lecture. Il
 * distingue les trois états que le vide peut recouvrir, et ce sont
 * trois situations qui n'appellent pas du tout la même réponse.
 */

// ------------------------------------------------------------------
// Le diagnostic préalable
// ------------------------------------------------------------------

export type EtatSocleIa =
  /** 0080 appliquée, et ce rôle porte `ai.config.read`. On peut lire. */
  | { etat: "ok" }
  /** Les trois permissions `ai.*` ne sont pas au catalogue : 0080 manque. */
  | { etat: "migration-absente" }
  /** 0080 est là, mais ce rôle ne porte pas `ai.config.read`. */
  | { etat: "permission-manquante" };

/** Les trois clés que la migration 0080 ajoute au catalogue. */
export const PERMISSIONS_IA = [
  "ai.config.read",
  "ai.models.write",
  "ai.costLimits.write",
] as const;

/**
 * Distingue « migration absente » de « rôle trop étroit ».
 *
 * Les deux se ressemblent de l'extérieur — l'écran est fermé — et la
 * confusion coûte cher : la première se corrige en appliquant une
 * migration, la seconde en modifiant la matrice des rôles. Le constat
 * qui a précédé ce chantier a montré qu'une permission ajoutée après
 * 0075 n'est portée par PERSONNE tant qu'on ne rejoue pas le semis du
 * super-administrateur, pas même par le super-administrateur : l'écran
 * disparaîtrait alors simplement du menu, sans une erreur nulle part.
 * C'est exactement ce mode de défaillance que cette fonction refuse.
 *
 * Le catalogue `platform_admin_permissions` se lit par la politique
 * « Les administrateurs lisent le catalogue » (0075) : tout
 * administrateur de plateforme y a accès, quel que soit son rôle.
 */
export async function diagnostiquerSocleIa(permissions: readonly string[]): Promise<EtatSocleIa> {
  if (permissions.includes("ai.config.read")) return { etat: "ok" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admin_permissions")
    .select("key")
    .in("key", PERMISSIONS_IA);

  if (error) {
    throw new AdminReadFailed(
      `lecture du catalogue des permissions : ${error.message} (${error.code ?? "sans code"}).`,
    );
  }

  const connues = Array.isArray(data) ? data.length : 0;
  return connues === 0 ? { etat: "migration-absente" } : { etat: "permission-manquante" };
}

// ------------------------------------------------------------------
// Les deux tables de configuration
// ------------------------------------------------------------------

/**
 * Traduit l'échec d'une lecture PostgREST.
 *
 * `PGRST205` / `42P01` : la table est introuvable — la migration 0076
 * n'est pas appliquée. C'est une cause bien plus probable qu'un bug, et
 * un « échec de lecture » générique enverrait chercher pendant une
 * heure.
 */
function traduire(nom: string, error: { message: string; code?: string }): never {
  if (error.code === "42501") throw new AdminAccessDenied(error.message);
  if (error.code === "PGRST205" || error.code === "42P01") {
    throw new AdminReadFailed(
      `la table ${nom} est introuvable — la migration 0076 n'est probablement pas appliquée, ` +
        "ou le cache de schéma de PostgREST n'a pas encore été rechargé.",
    );
  }
  throw new AdminReadFailed(`${nom} : ${error.message} (${error.code ?? "sans code"}).`);
}

/** Toutes les surcharges de modèle en vigueur, toutes organisations. */
export async function lireSurcharges(organizationId?: string): Promise<LigneSurcharge[]> {
  const supabase = await createClient();
  let requete = supabase
    .from("ai_model_overrides")
    .select("organization_id, agent, model, reason, created_at, updated_at, updated_by")
    .order("updated_at", { ascending: false });

  if (organizationId !== undefined) requete = requete.eq("organization_id", organizationId);

  const { data, error } = await requete;
  if (error) traduire("ai_model_overrides", error);
  return (data ?? []) as LigneSurcharge[];
}

/** Tous les plafonds posés, toutes organisations. */
export async function lirePlafonds(organizationId?: string): Promise<LignePlafonds[]> {
  const supabase = await createClient();
  let requete = supabase
    .from("ai_cost_limits")
    .select(
      "organization_id, daily_organization_limit_cents, monthly_organization_limit_cents, per_agent_limit_cents, updated_at, updated_by",
    )
    .order("updated_at", { ascending: false });

  if (organizationId !== undefined) requete = requete.eq("organization_id", organizationId);

  const { data, error } = await requete;
  if (error) traduire("ai_cost_limits", error);
  return (data ?? []) as LignePlafonds[];
}

// ------------------------------------------------------------------
// Les entreprises
// ------------------------------------------------------------------

/**
 * La taille de page de `admin_list_organizations`. Le SQL plafonne à
 * 200 ; on demande le maximum parce que ces écrans ont besoin de la
 * liste ENTIÈRE pour associer un nom à chaque identifiant d'une table
 * de configuration.
 */
const TAILLE_PAGE = 200;

/**
 * Le nombre de pages qu'on accepte de parcourir : 1 000 entreprises.
 *
 * Une borne, et elle est ASSUMÉE À L'ÉCRAN plutôt que silencieuse. Sans
 * elle, un parc à dix mille entreprises ferait vingt-cinq allers-retours
 * pour afficher un écran de réglage, et personne ne comprendrait
 * pourquoi la page met une minute.
 */
const PAGES_MAX = 5;

export type ListeEntreprises = {
  entreprises: Entreprise[];
  /** Le total rendu par la base. `null` si aucune ligne n'est revenue. */
  total: number | null;
  /** Vrai si la borne a été atteinte : la liste est incomplète, et l'écran le dit. */
  tronquee: boolean;
};

type LigneOrganisation = {
  organization_id: string;
  name: string;
  plan: string | null;
  ai_requests_this_month: number | null;
  archived_at: string | null;
  total_count: number;
};

/**
 * Toutes les entreprises, archivées comprises.
 *
 * `p_filter: "toutes"` n'est pas un confort : `archived_at` est un
 * effacement doux (0056, 0060), et une entreprise archivée peut très
 * bien porter encore une surcharge de modèle et un plafond. Les masquer
 * ici ferait apparaître des lignes de configuration sans nom, rattachées
 * à un identifiant que l'écran ne saurait plus résoudre.
 */
export async function listerEntreprises(): Promise<ListeEntreprises> {
  const supabase = await createClient();
  const entreprises: Entreprise[] = [];
  let total: number | null = null;
  let page = 1;

  for (; page <= PAGES_MAX; page += 1) {
    const { data, error } = await supabase.rpc("admin_list_organizations", {
      p_search: null,
      p_filter: "toutes",
      p_page: page,
      p_page_size: TAILLE_PAGE,
    });

    if (error) {
      if (error.code === "42501") throw new AdminAccessDenied(error.message);
      throw new AdminReadFailed(
        `admin_list_organizations : ${error.message} (${error.code ?? "sans code"}).`,
      );
    }

    const lignes = (Array.isArray(data) ? data : []) as LigneOrganisation[];
    for (const ligne of lignes) {
      entreprises.push({
        id: ligne.organization_id,
        nom: ligne.name,
        // `?? null` et non `?? 0` : une entreprise sans ligne dans
        // `ai_pro_usage` pour ce mois n'a pas « zéro requête », elle n'a
        // pas encore de compteur. La nuance survit jusqu'à l'écran.
        requetesAssistantCeMois: ligne.ai_requests_this_month ?? null,
        archiveeLe: ligne.archived_at ?? null,
        forfait: ligne.plan ?? null,
      });
      total = ligne.total_count;
    }

    // Le total voyage SUR LES LIGNES (0075) : une page vide n'en rend
    // aucun. On s'arrête donc sur une page incomplète, pas sur un
    // compteur.
    if (lignes.length < TAILLE_PAGE) {
      return { entreprises, total, tronquee: false };
    }
  }

  return { entreprises, total, tronquee: true };
}

/** L'index identifiant → nom, pour habiller les tables de configuration. */
export function indexerEntreprises(entreprises: readonly Entreprise[]): Map<string, Entreprise> {
  const index = new Map<string, Entreprise>();
  for (const entreprise of entreprises) index.set(entreprise.id, entreprise);
  return index;
}

/**
 * Une entreprise par son identifiant.
 *
 * ON RELIT L'IDENTIFIANT RENDU plutôt que de prendre la première ligne.
 * C'est la règle R4 de l'audit : un identifiant venu de l'URL n'est pas
 * une preuve de portée. La recherche de `admin_list_organizations` est
 * un `or` de plusieurs branches — nom, raison sociale, SIRET par
 * chiffres, identifiant exact —, et un uuid est plein de chiffres : une
 * autre branche pourrait, en théorie, faire remonter une AUTRE
 * entreprise, dont l'écran afficherait alors les réglages IA.
 */
export async function trouverEntreprise(organizationId: string): Promise<Entreprise | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_organizations", {
    p_search: organizationId,
    p_filter: "toutes",
    p_page: 1,
    p_page_size: TAILLE_PAGE,
  });

  if (error) {
    if (error.code === "42501") throw new AdminAccessDenied(error.message);
    throw new AdminReadFailed(
      `admin_list_organizations : ${error.message} (${error.code ?? "sans code"}).`,
    );
  }

  const lignes = (Array.isArray(data) ? data : []) as LigneOrganisation[];
  const ligne = lignes.find((candidate) => candidate.organization_id === organizationId);
  if (ligne === undefined) return null;

  return {
    id: ligne.organization_id,
    nom: ligne.name,
    requetesAssistantCeMois: ligne.ai_requests_this_month ?? null,
    archiveeLe: ligne.archived_at ?? null,
    forfait: ligne.plan ?? null,
  };
}

// ------------------------------------------------------------------
// Le journal
// ------------------------------------------------------------------

/**
 * Les actes IA journalisés, les plus récents d'abord.
 *
 * ------------------------------------------------------------------
 * TOUS LES RÔLES NE VOIENT PAS CE JOURNAL, ET C'EST VOULU
 * ------------------------------------------------------------------
 * `admin_audit_events` exige `platform.audit.read` (0075), que seuls le
 * super-administrateur et le responsable sécurité portent. Le produit
 * et la facturation — qui sont pourtant ceux qui ÉCRIVENT ces
 * lignes — ne les relisent pas.
 *
 * Ce n'est pas un oubli à corriger en douce depuis un écran : le
 * journal des actions administratives est précisément ce qu'on ne
 * laisse pas relire par celui qui agit. Cette fonction rend donc `null`
 * pour « pas le droit », que l'écran distingue de « aucun acte » —
 * une liste vide et une liste fermée ne disent pas la même chose.
 */
export async function lireJournalIa(options: {
  organizationId?: string;
  limite?: number;
  peutLire: boolean;
}): Promise<LigneJournal[] | null> {
  if (!options.peutLire) return null;

  const supabase = await createClient();
  let requete = supabase
    .from("admin_audit_events")
    .select(
      "id, admin_user_id, admin_role, action, target_type, target_id, target_label, old_value, new_value, reason, occurred_at",
    )
    .in("action", ACTIONS_JOURNAL_IA)
    .order("occurred_at", { ascending: false })
    .limit(options.limite ?? 50);

  if (options.organizationId !== undefined) {
    requete = requete.eq("target_id", options.organizationId);
  }

  const { data, error } = await requete;
  if (error) traduire("admin_audit_events", error);
  return (data ?? []) as LigneJournal[];
}

// ------------------------------------------------------------------
// Qui a écrit
// ------------------------------------------------------------------

/**
 * Résout des identifiants d'administrateurs en adresses lisibles.
 *
 * `updated_by` est un uuid, et « 3f2a1b… a relevé le plafond » n'apprend
 * rien à personne. La résolution passe par `admin_list_users` (0075),
 * qui compare `u.id::text` — donc une requête par identifiant.
 *
 * TROIS BORNES, parce qu'un écran de réglage ne doit pas se transformer
 * en boucle de lecture :
 *   • on ne résout que les identifiants DISTINCTS ;
 *   • on s'arrête à douze — au-delà, la table de configuration compte
 *     plus d'auteurs différents que l'équipe n'a d'administrateurs, et
 *     c'est le moment d'ouvrir le journal, pas de multiplier les
 *     requêtes ;
 *   • un échec de résolution n'est pas une erreur d'écran : l'appelant
 *     retombe sur l'identifiant tronqué, qui reste une information.
 */
const AUTEURS_MAX = 12;

export async function resoudreAuteurs(
  identifiants: readonly (string | null)[],
): Promise<Map<string, string>> {
  const distincts = [...new Set(identifiants.filter((id): id is string => id !== null))].slice(
    0,
    AUTEURS_MAX,
  );
  const noms = new Map<string, string>();
  if (distincts.length === 0) return noms;

  const supabase = await createClient();

  await Promise.all(
    distincts.map(async (identifiant) => {
      const { data, error } = await supabase.rpc("admin_list_users", {
        p_search: identifiant,
        p_filter: null,
        p_page: 1,
        p_page_size: 5,
      });
      if (error) return;

      const lignes = (Array.isArray(data) ? data : []) as {
        user_id: string;
        email: string | null;
        display_name: string | null;
      }[];
      // Même relecture d'identifiant que pour une entreprise : la
      // recherche est un `or` de plusieurs branches.
      const ligne = lignes.find((candidate) => candidate.user_id === identifiant);
      const nom = ligne?.email ?? ligne?.display_name ?? null;
      if (nom !== null) noms.set(identifiant, nom);
    }),
  );

  return noms;
}
