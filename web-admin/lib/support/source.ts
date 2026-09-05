import "server-only";

import { createClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminReadFailed } from "@/lib/customers/errors";

import { statutsRetenus, TAILLE_PAGE, type FiltresDemandes } from "./filtres.ts";
import type {
  AccesJournalise,
  MessageTicket,
  NiveauAcces,
  RessourceNiveau,
  SessionAssistance,
  SessionOuverteMienne,
  Ticket,
} from "./types.ts";

/**
 * ==================================================================
 * D'OÙ VIENNENT LES DONNÉES DES ÉCRANS D'ASSISTANCE
 * ==================================================================
 *
 * Tout passe par la SESSION DE L'ADMINISTRATEUR — `createClient()` de
 * `lib/supabase/server.ts` —, jamais par `service_role`.
 *
 * Ce n'est pas une préférence de style : les politiques de 0081 § 8
 * évaluent `platform_admin_can('support.tickets.read')` et
 * `platform_admin_can('support.sessions.read')` DANS PostgreSQL, à
 * chaque ligne. Une clé de service contournerait la RLS, donc aussi les
 * erreurs de raisonnement de ce fichier — et le seul contrôle restant
 * serait le `requireAdmin()` d'une page, c'est-à-dire une ligne de
 * TypeScript qu'un remaniement peut déplacer.
 *
 * Il y a ici une raison de plus qu'ailleurs, et elle est le sujet même
 * du module : ces tables portent la trace de qui est entré chez qui. Le
 * CLIENT a le droit de les lire — les politiques de 0081 le lui
 * accordent nommément — et c'est la contrepartie de l'accès. Lire par
 * `service_role` effacerait cette symétrie du code sans l'effacer de la
 * base, et le prochain lecteur croirait que la surveillance est à sens
 * unique.
 *
 * Le `import "server-only"` rend la chose mécanique : un composant
 * client qui importerait ce module ne COMPILERAIT pas, au lieu de fuir
 * dans le paquet du navigateur.
 */

// ------------------------------------------------------------------
// La traduction des refus
// ------------------------------------------------------------------

/**
 * `PGRST205` / `42P01` : la table est introuvable — 0081 n'est pas
 * appliquée. C'est une cause bien plus probable qu'un bug, et un
 * « échec de lecture » générique enverrait chercher pendant une heure.
 *
 * Le diagnostic de `socle.ts` couvre déjà le cas AVANT la lecture ;
 * celui-ci couvre la course : la migration peut avoir été jouée entre
 * les deux, ou PostgREST peut n'avoir pas encore rechargé son cache.
 */
function traduire(nom: string, error: { message: string; code?: string }): never {
  if (error.code === "42501") throw new AdminAccessDenied(error.message);
  if (error.code === "PGRST205" || error.code === "42P01") {
    throw new AdminReadFailed(
      `la table ${nom} est introuvable — la migration 0081_control_center_suite.sql n'est ` +
        "probablement pas appliquée, ou le cache de schéma de PostgREST n'a pas encore été rechargé.",
    );
  }
  throw new AdminReadFailed(`${nom} : ${error.message} (${error.code ?? "sans code"}).`);
}

/**
 * Nettoie un motif de recherche avant de le confier à PostgREST.
 *
 * La virgule, les parenthèses et le guillemet sont les séparateurs de
 * SA grammaire de filtres : les laisser passer ne produirait pas une
 * injection SQL — la requête reste paramétrée — mais une erreur de
 * syntaxe illisible, ou pire, un filtre qui ne veut pas dire ce que
 * l'utilisateur a tapé.
 */
function motifRecherche(recherche: string): string {
  return recherche.replace(/[,()"\\]/g, " ").trim();
}

// ------------------------------------------------------------------
// Les demandes
// ------------------------------------------------------------------

const COLONNES_TICKET =
  "id, user_id, organization_id, subject, product, channel, priority, status, " +
  "app_version, app_build, platform, os_version, assigned_to, created_at, updated_at, " +
  "first_response_at, resolved_at, closed_at";

export type PageDemandes = {
  lignes: Ticket[];
  /** Le total qui correspond aux filtres. `null` si PostgREST ne l'a pas rendu. */
  total: number | null;
};

export async function listerDemandes(filtres: FiltresDemandes): Promise<PageDemandes> {
  const supabase = await createClient();

  let requete = supabase
    .from("support_tickets")
    .select(COLONNES_TICKET, { count: "exact" })
    // Le tri est sur le DERNIER MOUVEMENT, pas sur la date d'ouverture :
    // une demande de la semaine dernière qui vient de recevoir une
    // réponse du client est ce qu'on doit voir en premier.
    .order("updated_at", { ascending: false });

  const statuts = statutsRetenus(filtres.statut);
  if (statuts !== null) requete = requete.in("status", statuts as string[]);
  if (filtres.priorite !== null) requete = requete.eq("priority", filtres.priorite);
  if (filtres.produit !== null) requete = requete.eq("product", filtres.produit);
  if (filtres.recherche !== null) {
    const motif = motifRecherche(filtres.recherche);
    if (motif !== "") requete = requete.ilike("subject", `%${motif}%`);
  }

  const debut = (filtres.page - 1) * TAILLE_PAGE;
  const { data, error, count } = await requete.range(debut, debut + TAILLE_PAGE - 1);

  if (error) traduire("support_tickets", error);
  return { lignes: (data ?? []) as unknown as Ticket[], total: count ?? null };
}

/**
 * Le nombre de demandes par filtre de statut, pour la barre de filtres.
 *
 * Une requête `head` par filtre : PostgREST ne sait pas faire un
 * `group by` depuis cette interface, et cinq comptes exacts valent
 * mieux qu'un chiffre approché — surtout sur une barre où le nombre est
 * la moitié de l'information.
 *
 * Rend `null` pour un filtre dont le compte a échoué, jamais zéro : un
 * « 0 » sous « Urgentes » se lit « aucune urgence », et c'est une
 * affirmation qu'un échec de lecture ne permet pas de faire.
 */
export async function compterDemandes(
  statuts: readonly (readonly string[] | null)[],
): Promise<(number | null)[]> {
  const supabase = await createClient();

  return Promise.all(
    statuts.map(async (liste) => {
      let requete = supabase
        .from("support_tickets")
        .select("id", { count: "exact", head: true });
      if (liste !== null) requete = requete.in("status", liste as string[]);
      const { count, error } = await requete;
      if (error) return null;
      return count ?? null;
    }),
  );
}

export async function lireDemande(ticketId: string): Promise<Ticket | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select(COLONNES_TICKET)
    .eq("id", ticketId)
    .maybeSingle();

  if (error) traduire("support_tickets", error);
  return (data as unknown as Ticket) ?? null;
}

export async function lireMessages(ticketId: string): Promise<MessageTicket[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_ticket_messages")
    .select("id, ticket_id, author_user_id, author_kind, body, is_internal, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) traduire("support_ticket_messages", error);
  return (data ?? []) as unknown as MessageTicket[];
}

// ------------------------------------------------------------------
// Les niveaux d'accès
// ------------------------------------------------------------------

export type CatalogueNiveaux = {
  niveaux: NiveauAcces[];
  /** Les tables nommées, par niveau. Une liste vide est une information. */
  ressources: Map<string, RessourceNiveau[]>;
};

/**
 * Le catalogue des niveaux d'accès, AVEC leurs ressources.
 *
 * Les deux se lisent ensemble et jamais séparément, parce qu'un niveau
 * sans sa liste ne veut rien dire : « Données métier en lecture seule »
 * affiché seul laisserait croire à un accès qui n'existe pas, alors que
 * la table `support_access_level_resources` ne lui rattache AUCUNE
 * ligne — c'est précisément ce que 0081 § 8.b déclare, et le refus est
 * dans les données.
 */
export async function lireCatalogueNiveaux(): Promise<CatalogueNiveaux> {
  const supabase = await createClient();

  const [niveaux, ressources] = await Promise.all([
    supabase
      .from("support_access_levels")
      .select("key, label, opens_business_data, is_grantable, max_minutes, requires_consent, note")
      .order("opens_business_data", { ascending: true })
      .order("key", { ascending: true }),
    supabase
      .from("support_access_level_resources")
      .select("level_key, resource, note")
      .order("resource", { ascending: true }),
  ]);

  if (niveaux.error) traduire("support_access_levels", niveaux.error);
  if (ressources.error) traduire("support_access_level_resources", ressources.error);

  const parNiveau = new Map<string, RessourceNiveau[]>();
  for (const ligne of (ressources.data ?? []) as unknown as RessourceNiveau[]) {
    const liste = parNiveau.get(ligne.level_key);
    if (liste) liste.push(ligne);
    else parNiveau.set(ligne.level_key, [ligne]);
  }

  return { niveaux: (niveaux.data ?? []) as unknown as NiveauAcces[], ressources: parNiveau };
}

// ------------------------------------------------------------------
// Les sessions d'assistance
// ------------------------------------------------------------------

const COLONNES_SESSION =
  "id, admin_user_id, admin_role, organization_id, customer_user_id, reason, access_level, " +
  "ticket_id, started_at, expires_at, consent_required, consent_given_at, consent_given_by, " +
  "revoked_at, revoked_by, revoked_reason, audit_event_id, created_at";

/**
 * Les sessions, les plus récentes d'abord.
 *
 * ON NE FILTRE PAS « ouvertes » EN BASE, et c'est délibéré. Une session
 * ouverte se reconnaît à trois conditions combinées — non révoquée, non
 * expirée, consentie si requis — et les exprimer en filtres PostgREST
 * ferait vivre la règle à DEUX endroits : ici et dans `etatSession()`.
 * Deux endroits divergent. On lit une fenêtre récente, et on classe en
 * TypeScript, avec la fonction qui est testée.
 */
export async function listerSessions(options?: {
  organizationId?: string;
  ticketId?: string;
  limite?: number;
}): Promise<SessionAssistance[]> {
  const supabase = await createClient();

  let requete = supabase
    .from("support_sessions")
    .select(COLONNES_SESSION)
    .order("started_at", { ascending: false })
    .limit(options?.limite ?? 100);

  if (options?.organizationId) requete = requete.eq("organization_id", options.organizationId);
  if (options?.ticketId) requete = requete.eq("ticket_id", options.ticketId);

  const { data, error } = await requete;
  if (error) traduire("support_sessions", error);
  return (data ?? []) as unknown as SessionAssistance[];
}

export async function lireSession(sessionId: string): Promise<SessionAssistance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_sessions")
    .select(COLONNES_SESSION)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) traduire("support_sessions", error);
  return (data as unknown as SessionAssistance) ?? null;
}

/**
 * Le journal d'ACCÈS d'une session — une ligne par usage.
 *
 * À ne pas confondre avec `admin_audit_events`, qui porte l'OUVERTURE
 * et la RÉVOCATION de la session. « Il a ouvert une session » ne dit pas
 * ce qu'il a regardé ; ce journal-ci le dit, et c'est la moitié qui
 * intéresse le client.
 */
export async function lireJournalAcces(sessionId: string): Promise<AccesJournalise[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_access_log")
    .select("id, session_id, admin_user_id, resource, target_id, detail, occurred_at")
    .eq("session_id", sessionId)
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (error) traduire("support_access_log", error);
  return (data ?? []) as unknown as AccesJournalise[];
}

/**
 * MES sessions ouvertes — les chiffres de la bannière de la spec p.21.
 *
 * `support_session_mine()` filtre déjà sur `auth.uid()`, la révocation
 * et l'expiration : on ne repasse rien derrière. Et on ne se sert pas
 * de son `seconds_remaining` comme d'une autorisation — c'est un
 * AFFICHAGE. L'autorisation est dans
 * `support_session_record_access()`, à chaque accès.
 *
 * Rend une liste VIDE plutôt que de lever quand la fonction n'existe pas
 * : la bannière est un ornement de sécurité, pas une porte, et une page
 * entière qui planterait parce que 0081 n'est pas appliquée serait un
 * échec disproportionné.
 */
export async function mesSessionsOuvertes(): Promise<SessionOuverteMienne[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("support_session_mine");

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return [];
    if (error.code === "42501") return [];
    throw new AdminReadFailed(
      `support_session_mine() : ${error.message} (${error.code ?? "sans code"}).`,
    );
  }
  return (Array.isArray(data) ? data : []) as SessionOuverteMienne[];
}

// ------------------------------------------------------------------
// Résoudre des identifiants en noms
// ------------------------------------------------------------------

/**
 * Le plafond dur de `admin_list_organizations`. On demande le maximum :
 * ces écrans ont besoin de la liste entière pour associer un nom à
 * chaque identifiant d'entreprise porté par une demande.
 */
const TAILLE_PAGE_ORGS = 200;

/** 1 000 entreprises. Une borne, et elle est DITE à l'écran, pas tue. */
const PAGES_MAX = 5;

export type NomsEntreprises = {
  noms: Map<string, string>;
  /** Vrai si la borne a été atteinte : des noms manqueront, et l'écran le dit. */
  tronquee: boolean;
};

export async function chargerNomsEntreprises(): Promise<NomsEntreprises> {
  const supabase = await createClient();
  const noms = new Map<string, string>();

  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const { data, error } = await supabase.rpc("admin_list_organizations", {
      p_page: page,
      p_page_size: TAILLE_PAGE_ORGS,
    });

    if (error) {
      // Un rôle qui n'a pas `platform.organizations.read` ne peut pas
      // nommer les entreprises. Ce n'est PAS une panne, et la liste des
      // demandes doit rester lisible : on rend ce qu'on a, et l'écran
      // affiche l'identifiant plutôt qu'un nom inventé.
      if (error.code === "42501") return { noms, tronquee: false };
      throw new AdminReadFailed(
        `admin_list_organizations : ${error.message} (${error.code ?? "sans code"}).`,
      );
    }

    const lignes = (Array.isArray(data) ? data : []) as {
      organization_id: string;
      name: string;
    }[];
    for (const ligne of lignes) noms.set(ligne.organization_id, ligne.name);

    if (lignes.length < TAILLE_PAGE_ORGS) return { noms, tronquee: false };
  }

  return { noms, tronquee: true };
}

/**
 * L'adresse d'UN compte, résolue à la demande.
 *
 * POURQUOI PAS EN LOT, ET POURQUOI CE N'EST PAS UN RENONCEMENT.
 * `admin_list_users` accepte un identifiant comme critère de recherche
 * (`u.id::text = v_q`, 0075) : une adresse coûte donc un aller-retour.
 * Sur une fiche, c'est un aller-retour. Sur une liste de vingt-cinq
 * demandes, ce serait vingt-cinq — pour une colonne. La liste affiche
 * donc l'identifiant tronqué, qui reste cliquable vers la fiche du
 * compte ; la FICHE, elle, affiche l'adresse.
 *
 * Rend `null` quand le rôle ne porte pas `platform.users.read` : c'est
 * le cas légitime, pas une panne, et l'écran retombe sur l'identifiant.
 */
/**
 * Le nom d'UNE entreprise, pour une fiche.
 *
 * Même raison et même mécanique que `resoudreAdresse` : 0075 accepte
 * l'identifiant comme critère de recherche (`o.id::text = v_q`). Sur
 * une fiche, un aller-retour ; sur une liste, on charge en lot.
 */
export async function resoudreEntreprise(organizationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_organizations", {
    p_search: organizationId,
    p_page: 1,
    p_page_size: 1,
  });

  if (error) return null;
  const lignes = (Array.isArray(data) ? data : []) as {
    organization_id: string;
    name: string | null;
  }[];
  const trouve = lignes.find((ligne) => ligne.organization_id === organizationId);
  return trouve?.name ?? null;
}

export async function resoudreAdresse(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users", {
    p_search: userId,
    p_page: 1,
    p_page_size: 1,
  });

  if (error) return null;
  const lignes = (Array.isArray(data) ? data : []) as { user_id: string; email: string | null }[];
  const trouve = lignes.find((ligne) => ligne.user_id === userId);
  return trouve?.email ?? null;
}
