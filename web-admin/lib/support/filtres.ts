import { PRIORITES_TICKET, PRODUITS_TICKET, STATUTS_TICKET } from "./types.ts";
import type { PrioriteTicket, ProduitTicket, StatutTicket } from "./types.ts";

/**
 * ==================================================================
 * LES FILTRES DE LA LISTE DES DEMANDES — dans l'URL, pas dans un état
 * ==================================================================
 *
 * Tout passe par la barre d'adresse : un filtre se colle dans un
 * message d'équipe, « précédent » le défait, et un rafraîchissement ne
 * le perd pas. C'est la règle de `components/ui/data.tsx`, et ce
 * fichier est la moitié serveur qui la rend possible.
 *
 * ------------------------------------------------------------------
 * UNE VALEUR INCONNUE RETOMBE SUR LE DÉFAUT, ELLE NE LÈVE PAS
 * ------------------------------------------------------------------
 * On arrive ici par une URL tapée ou copiée à la main. `?statut=urgent`
 * — quelqu'un qui confond statut et priorité — ne doit pas produire une
 * page d'erreur, et surtout pas une liste VIDE qui se lirait « aucune
 * demande ». Le défaut est explicite et l'écran montre lequel est actif.
 *
 * La différence avec `admin_list_users`, qui LÈVE sur trois filtres,
 * n'est pas une incohérence : là-bas, le filtre est impossible parce
 * qu'aucune donnée ne le porte, et rendre la liste entière serait un
 * mensonge sur son titre. Ici, le filtre est simplement mal orthographié.
 */

/**
 * Le filtre de statut par défaut : les demandes qui ATTENDENT QUELQUE
 * CHOSE DE NOUS.
 *
 * Ce n'est pas « toutes ». Une console d'assistance s'ouvre sur le
 * travail à faire, pas sur les archives — et « ouvertes » sans « en
 * attente du client » cacherait les relances.
 */
export const STATUT_PAR_DEFAUT = "actives" as const;

export type FiltreStatut = StatutTicket | "actives" | "toutes";

export const FILTRES_STATUT: readonly FiltreStatut[] = [
  "actives",
  "open",
  "pending",
  "resolved",
  "closed",
  "toutes",
];

export const LIBELLES_FILTRE_STATUT: Record<FiltreStatut, string> = {
  actives: "À traiter",
  open: "Ouvertes",
  pending: "En attente du client",
  resolved: "Résolues",
  closed: "Closes",
  toutes: "Toutes",
};

/**
 * Les statuts que ce filtre laisse passer.
 *
 * Rend `null` pour « aucune restriction » — et non la liste des quatre
 * statuts. La nuance compte : un `in` sur quatre valeurs exclurait
 * silencieusement un cinquième statut que la base gagnerait un jour,
 * et la liste « Toutes » cesserait de porter son nom sans que personne
 * ne le remarque.
 */
export function statutsRetenus(filtre: FiltreStatut): readonly StatutTicket[] | null {
  if (filtre === "toutes") return null;
  if (filtre === "actives") return ["open", "pending"];
  return [filtre];
}

export type FiltresDemandes = {
  statut: FiltreStatut;
  priorite: PrioriteTicket | null;
  produit: ProduitTicket | null;
  recherche: string | null;
  page: number;
};

function premiere(valeur: string | string[] | undefined): string | null {
  if (Array.isArray(valeur)) return valeur[0] ?? null;
  return typeof valeur === "string" ? valeur : null;
}

export function lireFiltres(params: {
  [cle: string]: string | string[] | undefined;
}): FiltresDemandes {
  const statutBrut = premiere(params.statut);
  const prioriteBrute = premiere(params.priorite);
  const produitBrut = premiere(params.produit);
  const rechercheBrute = premiere(params.q);
  const pageBrute = premiere(params.page);

  const page = Number.parseInt(pageBrute ?? "", 10);

  return {
    statut: (FILTRES_STATUT as readonly string[]).includes(statutBrut ?? "")
      ? (statutBrut as FiltreStatut)
      : STATUT_PAR_DEFAUT,
    priorite: (PRIORITES_TICKET as readonly string[]).includes(prioriteBrute ?? "")
      ? (prioriteBrute as PrioriteTicket)
      : null,
    produit: (PRODUITS_TICKET as readonly string[]).includes(produitBrut ?? "")
      ? (produitBrut as ProduitTicket)
      : null,
    recherche: rechercheBrute !== null && rechercheBrute.trim() !== ""
      ? rechercheBrute.trim()
      : null,
    // Une page négative, zéro ou illisible vaut 1. Un `NaN` glissé dans
    // un `range()` de PostgREST produirait une erreur illisible.
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/**
 * Reconstruit l'URL en changeant UNE chose.
 *
 * Les autres filtres sont EMPORTÉS : cliquer « Urgentes » depuis une
 * recherche ne doit pas effacer la recherche. Le seul filtre remis à
 * zéro est la page — la page 4 d'une liste de trois pages afficherait
 * un vide qu'on lirait « aucun résultat ».
 */
export function lienFiltre(
  base: string,
  filtres: FiltresDemandes,
  changement: Partial<FiltresDemandes>,
): string {
  const suivant = { ...filtres, ...changement };
  const parametres = new URLSearchParams();

  if (suivant.statut !== STATUT_PAR_DEFAUT) parametres.set("statut", suivant.statut);
  if (suivant.priorite !== null) parametres.set("priorite", suivant.priorite);
  if (suivant.produit !== null) parametres.set("produit", suivant.produit);
  if (suivant.recherche !== null) parametres.set("q", suivant.recherche);

  // La page ne survit à aucun autre changement : elle n'est recopiée
  // que si c'est ELLE qu'on change.
  const page = changement.page ?? 1;
  if (page > 1) parametres.set("page", String(page));

  const chaine = parametres.toString();
  return chaine === "" ? base : `${base}?${chaine}`;
}

/** Les valeurs actives, pour les champs cachés du formulaire de recherche. */
export function champsCaches(filtres: FiltresDemandes): { nom: string; valeur: string }[] {
  const champs: { nom: string; valeur: string }[] = [];
  if (filtres.statut !== STATUT_PAR_DEFAUT) champs.push({ nom: "statut", valeur: filtres.statut });
  if (filtres.priorite !== null) champs.push({ nom: "priorite", valeur: filtres.priorite });
  if (filtres.produit !== null) champs.push({ nom: "produit", valeur: filtres.produit });
  return champs;
}

/** Combien de demandes par page. Une console se consulte large, pas infinie. */
export const TAILLE_PAGE = 25;

export { PRIORITES_TICKET, PRODUITS_TICKET, STATUTS_TICKET };
