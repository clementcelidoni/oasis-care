/**
 * ==================================================================
 * LES FILTRES — dont trois que la spec demande et que la base refuse
 * ==================================================================
 *
 * La spec p.7 énumère neuf filtres d'utilisateurs. Six ont une donnée
 * derrière. Trois n'en ont aucune, et `admin_list_users` LÈVE sur
 * ceux-là (SQLSTATE 0A000) au lieu de les ignorer.
 *
 * Cette décision de la base commande le dessin de l'interface. Un
 * filtre qu'on ignore en silence rend la liste ENTIÈRE sous un titre
 * qui affirme le contraire : cliquer sur « Mobile » afficherait les
 * deux comptes de la plateforme, et l'écran dirait « voici les
 * utilisateurs Mobile ». C'est le pire des trois comportements
 * possibles — pire qu'une erreur, pire qu'une absence.
 *
 * Ils sont donc DESSINÉS ÉTEINTS, avec leur raison. Les faire
 * disparaître aurait fait croire à un oubli d'interface ; les laisser
 * cliquables aurait fait croire à une panne. Éteints et expliqués, ils
 * disent la seule chose vraie : la question est légitime, la plateforme
 * ne l'enregistre pas.
 *
 * ------------------------------------------------------------------
 * LA BASE RESTE L'AUTORITÉ
 * ------------------------------------------------------------------
 * Ce catalogue ne VALIDE rien. Un filtre arrivé par une URL tapée à la
 * main part tel quel vers la fonction SQL, qui le refuse avec son
 * propre message. Dupliquer ici la liste des filtres acceptés créerait
 * deux vérités à tenir d'accord, et c'est toujours la copie qui dérive.
 */

export type FilterOption = {
  /** La valeur passée à `p_filter`. `null` = pas de filtre. */
  value: string | null;
  label: string;
  /**
   * Renseigné quand la base refuse ce filtre. Le chip est alors inerte
   * et porte cette phrase — qui est la moitié utile de l'information.
   */
  unsupportedReason?: string;
};

/**
 * Les filtres d'utilisateurs, dans l'ordre de la spec p.7, suivis des
 * deux que la base sait faire en plus.
 *
 * « Offert » mérite son chip. Les 25 lignes de
 * `subscription_entitlements` du compte propriétaire viennent de la
 * migration 0042 (`source='complimentary'`) : ce sont des droits
 * offerts, pas un abonnement payé. Pouvoir isoler ces comptes est ce
 * qui empêche de lire « 1 abonné » là où il y a zéro euro.
 */
export const USER_FILTERS: FilterOption[] = [
  { value: null, label: "Tous" },
  {
    value: "mobile",
    label: "Mobile",
    unsupportedReason:
      "Rien n'enregistre par quelle application un compte est entré. Le seul proxy imaginable — « possède un espace personnel » — est faux : le trigger on_auth_user_created en crée un pour tout nouveau compte, y compris celui qui n'ouvrira jamais l'iPhone.",
  },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
  { value: "gratuit", label: "Gratuit" },
  {
    value: "trial",
    label: "Essai",
    unsupportedReason:
      "Aucun essai n'est suivi. Côté Pro, aucun abonnement d'entreprise n'est enregistré ; côté Apple, un essai gratuit arrive avec le statut « subscribed » et reste indiscernable d'un abonnement payé.",
  },
  { value: "actif", label: "Actif" },
  { value: "inactif", label: "Inactif" },
  {
    value: "cancelled",
    label: "Résilié",
    unsupportedReason:
      "Il n'existe aucun historique de résiliation : côté Pro, cancelled_at est écrasé à chaque changement (une seule ligne par entreprise) ; côté mobile, la table subscription_events est vide.",
  },
  { value: "banni", label: "Banni" },
  { value: "offert", label: "Accès offert" },
  { value: "sans_organisation", label: "Sans organisation" },
];

/**
 * Les filtres d'entreprises. La spec n'en impose pas ; ceux-ci sont
 * ceux que `admin_list_organizations` accepte.
 *
 * « Archivées » n'est pas un confort. `archived_at` est un effacement
 * doux (migrations 0056 et 0060) : la liste par défaut masque ces
 * entreprises, et sans ce filtre elles deviendraient introuvables —
 * présentes en base, absentes de toute vue.
 */
export const ORGANIZATION_FILTERS: FilterOption[] = [
  { value: null, label: "Actives" },
  { value: "avec_abonnement", label: "Avec abonnement" },
  { value: "sans_abonnement", label: "Sans abonnement" },
  { value: "archivees", label: "Archivées" },
  { value: "toutes", label: "Toutes" },
];

/** L'option du catalogue correspondant à une valeur d'URL, si elle y figure. */
export function findFilter(
  catalogue: readonly FilterOption[],
  value: string | null,
): FilterOption | undefined {
  return catalogue.find((option) => option.value === value);
}

/**
 * Le filtre demandé par l'URL, tel quel.
 *
 * Aucune validation : voir l'en-tête de ce fichier. Une valeur absurde
 * ira jusqu'à la base, qui la refusera en nommant les filtres qu'elle
 * accepte — un message plus juste que tout ce qu'on pourrait écrire
 * ici, et qui ne peut pas dériver du SQL puisqu'il en vient.
 */
export function parseFilter(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Construit l'URL d'une liste. Les paramètres vides sont OMIS plutôt
 * qu'écrits vides : `/utilisateurs` se partage mieux que
 * `/utilisateurs?q=&filtre=&page=1`, et les deux doivent désigner la
 * même page.
 *
 * `page` est volontairement absent quand il vaut 1 : revenir en page 1
 * doit rendre l'URL canonique, pas y laisser une trace du détour.
 */
export function listHref(
  basePath: string,
  params: { q?: string | null; filtre?: string | null; page?: number },
): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.filtre) search.set("filtre", params.filtre);
  if (params.page !== undefined && params.page > 1) search.set("page", String(params.page));

  const query = search.toString();
  return query === "" ? basePath : `${basePath}?${query}`;
}
