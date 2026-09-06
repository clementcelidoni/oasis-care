/**
 * CE QU'ON LIT EN BASE POUR COMPOSER ET IMPRIMER — § 16.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE FILTRE DE PORTÉE N'EST PAS UNE SÉCURITÉ, ET IL EST INDISPENSABLE
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la RLS qui refuse les données d'une autre entreprise ; rien
 * ici ne protège quoi que ce soit. Mais un compte peut appartenir à
 * PLUSIEURS entreprises — le § 13 le prévoit noir sur blanc — et sans
 * filtre explicite, l'écran « Lots de pépinière » de l'entreprise A
 * listerait aussi ceux de l'entreprise B, que la RLS laisse
 * légitimement passer. On imprimerait alors les étiquettes du voisin,
 * en toute légalité et pour rien.
 *
 * D'où le filtre, posé sur l'axe que chaque gisement déclare — voir
 * `familles.ts` et la note sur les deux axes de cloisonnement.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX QUESTIONS, ET LA SECONDE EST CELLE QUI ÉVITE LES DOUBLONS
 * ══════════════════════════════════════════════════════════════════
 *
 *   • « Quels objets puis-je étiqueter ? » — `lireObjets`.
 *   • « Lesquels portent DÉJÀ une étiquette ? » — `lireEtiquettesPosees`.
 *
 * La seconde n'est pas un détail d'affichage. Réimprimer une étiquette
 * existante est LÉGITIME — l'autocollant s'est décollé, le pot a été
 * lavé — mais en créer une SECONDE pour le même objet ne l'est pas :
 * deux QR différents sur un même lot, et le jour où l'un des deux est
 * scanné on ne sait plus lequel fait foi. `etiquette_creer()` protège
 * déjà de cela côté base (elle rend celle qui existe), mais l'écran
 * doit le DIRE avant, pas le corriger après.
 */

import type { createClient } from "@/lib/supabase/server";
import type { OrganizationContext } from "@/lib/auth/organization";

import {
  gisement,
  libelleObjet,
  valeursDe,
  type Gisement,
  type LigneGisement,
  type SourceEtiquette,
} from "./familles.ts";
import { versModele, type ModeleEnregistre } from "./modeles.ts";
import type { ChampEtiquette } from "@/lib/etiquettes";

/**
 * Le client Supabase du serveur, typé aussi mollement que celui du
 * reste du produit : les tables de ce dépôt n'ont pas de types générés,
 * et prétendre le contraire par une assertion mentirait.
 */
type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * COMBIEN D'OBJETS ON PROPOSE D'UN COUP.
 *
 * 500 est la borne de `etiquettes_creer_lot` (0090 § 7) : dépasser ici
 * ferait échouer la création plus loin, avec un message venu de
 * Postgres. On s'arrête donc AVANT, et l'écran le dit.
 */
export const PLAFOND_SELECTION = 500;

/**
 * LA MIGRATION 0090 N'EST PAS APPLIQUÉE SUR CETTE BASE.
 *
 * Tout ce module en dépend : la table `etiquette_modeles`, les colonnes
 * calculées `entity_kind`/`entity_id` de `smart_tags`, les fonctions
 * `etiquette_creer` et compagnie. Sans elle, chaque requête échoue avec
 * un « relation … does not exist » que Next.js transforme en page
 * d'erreur de développeur — affichée à un paysagiste, qui n'y peut
 * rien et n'y comprend rien.
 *
 * On distingue donc CE CAS-LÀ des autres pour pouvoir dire la seule
 * chose utile : ce n'est pas votre faute, la base n'est pas à jour,
 * voici ce qu'il manque.
 */
export class SocleManquant extends Error {
  /**
   * CHAMP DÉCLARÉ PUIS AFFECTÉ, PAS UNE « PROPRIÉTÉ DE PARAMÈTRE ».
   *
   * `constructor(readonly detail: string)` serait plus court, et ne
   * marcherait pas : `node --test --experimental-strip-types` retire
   * les types SANS les compiler, et une propriété de paramètre est la
   * seule construction TypeScript qui ÉMET du code. Node refuse alors
   * le fichier entier — et avec lui tous les tests qui l'importent, y
   * compris indirectement. C'est le genre de faute qui ne se voit ni
   * au build ni au typecheck, seulement en exécutant les tests.
   */
  readonly detail: string;

  constructor(detail: string) {
    super(
      "Le socle des étiquettes n'est pas installé sur cette base : la migration 0090 " +
        "n'a pas été appliquée. Rien ne peut être lu ni imprimé tant qu'elle ne l'est pas.",
    );
    this.name = "SocleManquant";
    this.detail = detail;
  }
}

/**
 * Distingue « la base n'est pas à jour » de « la requête a échoué ».
 *
 * 42P01 = table absente, 42703 = colonne absente. Ce sont exactement
 * les deux formes que prend l'absence de 0090.
 */
function verifierSocle(erreur: { code?: string; message?: string } | null): void {
  if (!erreur) return;
  if (erreur.code === "42P01" || erreur.code === "42703") {
    throw new SocleManquant(erreur.message ?? "");
  }
}

export type ObjetEtiquetable = {
  readonly id: string;
  readonly libelle: string;
  readonly valeurs: Partial<Record<ChampEtiquette, string>>;
};

export type EtiquettePosee = {
  readonly id: string;
  readonly jeton: string;
  readonly type: string;
  readonly publique: boolean;
  readonly nombreScans: number;
  readonly dernierScan: string | null;
};

/**
 * Applique la portée et la suppression douce.
 *
 * `gardens!inner` mérite un mot : `garden_zones` NE PORTE PAS
 * `workspace_id`, vérifié sur information_schema. Son cloisonnement
 * passe par le jardin, donc par une jointure interne — et le filtre
 * s'écrit alors sur la table embarquée (`gardens.workspace_id`), pas
 * sur la table de tête.
 */
type Filtrable<T> = {
  eq(colonne: string, valeur: string | boolean): T;
  is(colonne: string, valeur: null): T;
};

function poserPortee<T extends Filtrable<T>>(
  requete: T,
  g: Gisement,
  organization: OrganizationContext,
): T {
  let q = requete;

  if (g.cle === "gardenZone") {
    q = q.eq("gardens.workspace_id", organization.workspaceId).is("gardens.deleted_at", null);
  } else if (g.axe === "workspace") {
    q = q.eq("workspace_id", organization.workspaceId);
  } else {
    q = q.eq("organization_id", organization.organizationId);
  }

  if (g.suppressionDouce) q = q.is(g.suppressionDouce, null);
  if (g.archiveBooleen) q = q.eq(g.archiveBooleen, false);
  return q;
}

/** La sélection minimale d'un comptage : pas d'embed inutile. */
function colonnesDeComptage(g: Gisement): string {
  return g.cle === "gardenZone" ? "id, gardens!inner ( workspace_id, deleted_at )" : "id";
}

/**
 * Combien d'objets ce gisement offre à étiqueter, aujourd'hui.
 *
 * TROIS RÉPONSES, PAS DEUX : un nombre, un zéro MESURÉ, et « je n'ai
 * pas pu compter » — c'est ce dernier que rend `null`.
 *
 * LE ZÉRO DE CONSOLATION ÉTAIT UNE AFFIRMATION FAUSSE. Toute erreur —
 * table absente (42P01), droit refusé (42501), panne PostgREST
 * (PGRST301) — devenait 0, et ce 0 s'affichait comme un fait :
 * « Aucune plante enregistrée », badge « vide », et le lien
 * « Choisir et imprimer » qui disparaît. Le pépiniériste concluait
 * qu'il n'avait rien à étiqueter alors que le produit n'avait rien
 * lu. C'est LUI qui décide de ne pas imprimer ; il lui faut la vérité
 * pour le décider.
 *
 * ON NE LÈVE TOUJOURS PAS : l'écran d'accueil liste quinze gisements,
 * et une table absente ne doit pas emporter les quatorze autres. On
 * rend null, et l'écran dit « comptage indisponible ».
 */
export async function compterObjets(
  supabase: Client,
  organization: OrganizationContext,
  source: SourceEtiquette,
): Promise<number | null> {
  const g = gisement(source);
  const requete = supabase
    .from(g.table)
    .select(colonnesDeComptage(g), { count: "exact", head: true });
  const { count, error } = await poserPortee(requete, g, organization);
  if (error) return null;
  return count ?? 0;
}

/**
 * Combien d'étiquettes de cette entreprise portent l'ancienne adresse.
 *
 * 0090 § 2.b marque, UNE FOIS, tout ce qui existait avant elle : ces
 * autocollants-là ont été imprimés avec « oasis-care.example », que la
 * RFC 2606 réserve. La base ne peut pas savoir quelle adresse a été
 * IMPRIMÉE — l'URL est calculée depuis le jeton, jamais stockée — mais
 * « antérieure au socle » est vrai, et c'est ce qui permet de CHIFFRER
 * la réimpression au lieu de l'estimer.
 *
 * On compte sur les DEUX axes : une étiquette de plante porte un espace
 * de travail, une étiquette de lot porte une entreprise, et le
 * dirigeant veut le total, pas une moitié.
 *
 * Rend null si le comptage échoue — un zéro inventé serait une bonne
 * nouvelle inventée, et c'est sur ce chiffre qu'on décide de
 * réimprimer.
 */
export async function compterAncienneAdresse(
  supabase: Client,
  organization: OrganizationContext,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("smart_tags")
    .select("id", { count: "exact", head: true })
    .eq("ancienne_adresse", true)
    .eq("active", true)
    .or(
      `workspace_id.eq.${organization.workspaceId},organization_id.eq.${organization.organizationId}`,
    );
  if (error) return null;
  return count ?? 0;
}

export type OptionsLecture = {
  /** Restreindre à ces identifiants. C'est le cas « une sélection » du § 16. */
  readonly ids?: readonly string[];
  readonly limite?: number;
};

/** Les objets d'un gisement, prêts à être cochés puis imprimés. */
export async function lireObjets(
  supabase: Client,
  organization: OrganizationContext,
  source: SourceEtiquette,
  options: OptionsLecture = {},
): Promise<ObjetEtiquetable[]> {
  const g = gisement(source);
  const ids = options.ids;
  if (ids && ids.length === 0) return [];

  let requete = supabase.from(g.table).select(g.colonnes);
  requete = poserPortee(requete, g, organization);
  if (ids) requete = requete.in("id", ids);

  const { data, error } = await requete
    .order(g.tri, { ascending: true, nullsFirst: false })
    .limit(Math.min(options.limite ?? PLAFOND_SELECTION, PLAFOND_SELECTION));

  verifierSocle(error);
  if (error) throw new Error(`Lecture des ${g.libelle.toLowerCase()} impossible : ${error.message}`);

  // Le `select` prend une chaîne calculée : PostgREST ne peut pas en
  // déduire la forme des lignes et rend un type d'erreur. Le passage
  // par `unknown` est donc exact — nous ne savons pas non plus, et
  // c'est `valeursDe` qui lit chaque colonne défensivement.
  return ((data ?? []) as unknown as LigneGisement[])
    .map((ligne) => {
      const id = typeof ligne.id === "string" ? ligne.id : null;
      if (!id) return null;
      return { id, libelle: libelleObjet(source, ligne), valeurs: valeursDe(source, ligne) };
    })
    .filter((o): o is ObjetEtiquetable => o !== null);
}

/**
 * Les étiquettes DÉJÀ posées sur ces objets.
 *
 * On ne demande que les ACTIVES : une étiquette révoquée — autocollant
 * arraché, pot cassé — ne doit pas empêcher d'en poser une neuve, et
 * l'annoncer comme « déjà étiqueté » serait faux.
 *
 * La clé de la table est l'identifiant de l'OBJET, pas celui de
 * l'étiquette : la question posée par l'écran est « ce lot en a-t-il
 * une ? ».
 */
export async function lireEtiquettesPosees(
  supabase: Client,
  source: SourceEtiquette,
  ids: readonly string[],
): Promise<Map<string, EtiquettePosee>> {
  const posees = new Map<string, EtiquettePosee>();
  if (ids.length === 0) return posees;

  const { data, error } = await supabase
    .from("smart_tags")
    .select("id, entity_id, public_token, type, public_fiche, scanned_count, last_scanned_at")
    .eq("entity_kind", source)
    .eq("active", true)
    .in("entity_id", ids);

  verifierSocle(error);
  if (error) throw new Error(`Lecture des étiquettes existantes impossible : ${error.message}`);

  for (const ligne of (data ?? []) as LigneGisement[]) {
    const cible = typeof ligne.entity_id === "string" ? ligne.entity_id : null;
    const jeton = typeof ligne.public_token === "string" ? ligne.public_token : null;
    if (!cible || !jeton) continue;
    // PREMIÈRE ARRIVÉE, PREMIÈRE SERVIE. Rien n'interdit deux étiquettes
    // actives sur un même objet — un QR sur le pot, une puce NFC sur le
    // tuteur, c'est même l'usage prévu. L'écran en montre une ; le
    // compte exact reste celui de la base.
    if (posees.has(cible)) continue;
    posees.set(cible, {
      id: String(ligne.id ?? ""),
      jeton,
      type: typeof ligne.type === "string" ? ligne.type : "qr",
      publique: ligne.public_fiche === true,
      nombreScans: typeof ligne.scanned_count === "number" ? ligne.scanned_count : 0,
      dernierScan: typeof ligne.last_scanned_at === "string" ? ligne.last_scanned_at : null,
    });
  }

  return posees;
}

/**
 * Tous les modèles lisibles : ceux d'Oasis et ceux de l'entreprise.
 *
 * La RLS de 0090 § 8.a fait le tri toute seule — `organization_id is
 * null` pour tout compte connecté, `has_permission(…, 'etiquettes.read')`
 * pour le reste. On ne filtre donc pas par entreprise ici : ce serait
 * répéter la barrière, et se tromper le jour où elle changera.
 */
export async function lireModeles(supabase: Client): Promise<ModeleEnregistre[]> {
  const { data, error } = await supabase
    .from("etiquette_modeles")
    .select(
      "id, organization_id, famille, nom, largeur_mm, hauteur_mm, marge_mm, champs, est_defaut",
    )
    .is("archived_at", null)
    .order("famille", { ascending: true })
    .order("nom", { ascending: true });

  verifierSocle(error);
  if (error) throw new Error(`Lecture des modèles d'étiquette impossible : ${error.message}`);
  return ((data ?? []) as LigneGisement[]).map(versModele);
}

/** Un modèle précis, ou `null`. */
export async function lireModele(
  supabase: Client,
  id: string,
): Promise<ModeleEnregistre | null> {
  const { data, error } = await supabase
    .from("etiquette_modeles")
    .select(
      "id, organization_id, famille, nom, largeur_mm, hauteur_mm, marge_mm, champs, est_defaut",
    )
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();

  verifierSocle(error);
  if (error) throw new Error(`Lecture du modèle impossible : ${error.message}`);
  return data ? versModele(data as LigneGisement) : null;
}
