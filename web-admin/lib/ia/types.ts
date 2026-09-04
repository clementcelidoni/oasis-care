/**
 * ==================================================================
 * CE QUE LA BASE REND AUX ÉCRANS IA DU CONTROL CENTER
 * ==================================================================
 *
 * Trois lectures seulement, et chacune passe par un chemin différent —
 * ce n'est pas une incohérence, c'est la carte des droits telle que la
 * migration 0080 l'a posée :
 *
 *   • `ai_model_overrides` et `ai_cost_limits` se lisent EN LIGNES, à
 *     travers toutes les organisations, par la politique
 *     « Platform reads … » de 0080 (`platform_admin_can('ai.config.read')`).
 *     0075 R5 impose « des nombres, pas des lignes » pour les lectures
 *     inter-organisations, et la règle tient toujours : elle protège les
 *     DONNÉES MÉTIER du client — un devis, une photo, une plante. Ces
 *     deux tables ne contiennent rien de tel. Elles contiennent la
 *     configuration de l'éditeur chez son client.
 *
 *   • les NOMS d'entreprises et le compteur de requêtes IA du mois
 *     viennent de `admin_list_organizations()` (0075), parce que
 *     `business_organizations` n'a aucune politique de lecture pour un
 *     administrateur de plateforme — et n'en aura pas : une fonction
 *     `security definer` qui rend des nombres est exactement ce que R5
 *     demande.
 *
 *   • le journal se lit dans `admin_audit_events` (0075), réservé à
 *     `platform.audit.read` — donc au super-administrateur et au
 *     responsable sécurité, PAS au produit ni à la facturation.
 *
 * Les formes ci-dessous recopient les colonnes des tables, pas une
 * modélisation : mêmes noms, mêmes nullités. Un `bigint` PostgreSQL
 * arrive en `number` à travers PostgREST.
 */

/**
 * Une ligne d'`ai_model_overrides` (0076).
 *
 * `model` est du TEXTE LIBRE, et c'est un choix de la migration :
 * « SQL ne connaît aucun nom de modèle ». Conséquence directe et
 * sérieuse — une surcharge fige un identifiant LITTÉRAL. Le jour où
 * `OASIS_MODEL_ADVANCED` corrige un nom faux, l'entreprise qui porte
 * une surcharge reste accrochée à l'ancien identifiant, et son IA tombe
 * en 404 pendant que celle du voisin tourne. Voir `carte.ts`, qui
 * appelle cela une surcharge « décrochée » et refuse de la ranger
 * d'office sur un niveau.
 */
export type LigneSurcharge = {
  organization_id: string;
  /** La graphie de la base : `executive`, `finance`, `billing`, `quote_pricing`. */
  agent: string;
  /** L'identifiant littéral imposé. Jamais un niveau. */
  model: string;
  /** Le motif de la dérogation. 0080 le rend obligatoire à l'écriture. */
  reason: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Qui a écrit en dernier. `null` possible : la colonne accepte le
   * nul, et une ligne posée avant 0080 pouvait l'être par n'importe
   * quel gestionnaire client — c'est justement ce que 0080 a fermé.
   */
  updated_by: string | null;
};

/**
 * Une ligne d'`ai_cost_limits` (0076).
 *
 * LA RÈGLE DES NULS, ET ELLE N'EST PAS NÉGOCIABLE : une colonne NULLE
 * veut dire « aucune limite », jamais « limite à zéro ». Zéro est un
 * plafond à zéro, c'est-à-dire l'IA coupée pour cette entreprise — un
 * réglage légitime, écrit à la main par quelqu'un. Aucun `?? 0` ne doit
 * jamais toucher ces trois colonnes : il transformerait « pas de
 * plafond » en « IA éteinte », deux états rigoureusement opposés.
 */
export type LignePlafonds = {
  organization_id: string;
  daily_organization_limit_cents: number | null;
  monthly_organization_limit_cents: number | null;
  per_agent_limit_cents: number | null;
  updated_at: string;
  updated_by: string | null;
};

/**
 * Une ligne d'`admin_audit_events` (0075), restreinte à ce que les
 * écrans IA affichent.
 *
 * `admin_role` est le rôle AU MOMENT DU GESTE, recopié et non joint :
 * un rôle change, et le journal doit dire sous quelle casquette la
 * personne a agi.
 */
export type LigneJournal = {
  id: string;
  admin_user_id: string | null;
  admin_role: string;
  /** `aiModel.overrideSet`, `aiModel.overrideCleared`, `aiCostLimit.set`, `aiCostLimit.cleared`. */
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  occurred_at: string;
};

/** Les quatre actions IA que 0080 journalise. Sert à filtrer le journal. */
export const ACTIONS_JOURNAL_IA = [
  "aiModel.overrideSet",
  "aiModel.overrideCleared",
  "aiCostLimit.set",
  "aiCostLimit.cleared",
] as const;

export const LIBELLES_ACTION_JOURNAL: Readonly<Record<string, string>> = Object.freeze({
  "aiModel.overrideSet": "Modèle imposé",
  "aiModel.overrideCleared": "Surcharge de modèle levée",
  "aiCostLimit.set": "Plafonds de dépense posés",
  "aiCostLimit.cleared": "Plafonds de dépense retirés",
});

/**
 * Une entreprise, réduite à ce dont les écrans IA ont besoin.
 *
 * Extrait de `admin_list_organizations` — on ne garde pas les vingt
 * autres colonnes : un écran de réglage IA n'a aucune raison de porter
 * le nombre de devis d'un client dans sa mémoire.
 */
export type Entreprise = {
  id: string;
  nom: string;
  /**
   * Requêtes d'assistant du mois courant (`ai_pro_usage`, période UTC).
   *
   * `null` veut dire « aucun compteur pour ce mois », pas « zéro
   * requête » — la ligne n'est créée qu'au premier appel. Les deux se
   * ressemblent ici, mais la distinction tient : « personne n'a rien
   * demandé » et « la première requête n'a pas encore eu lieu ce
   * mois-ci » ne se corrigent pas de la même façon si le chiffre
   * paraît faux.
   */
  requetesAssistantCeMois: number | null;
  archiveeLe: string | null;
  /** Le forfait souscrit. `null` tant qu'aucun abonnement n'est suivi. */
  forfait: string | null;
};
