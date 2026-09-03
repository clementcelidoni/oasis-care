import type { Tone } from "@/components/ui";

/**
 * ==================================================================
 * LES MOTS — traduire les valeurs de la base sans jamais les perdre
 * ==================================================================
 *
 * La base parle en `camelCase` anglais (`landscaperAndNursery`,
 * `pastDue`, `readOnly`) parce que ses énumérations sont partagées avec
 * l'application iPhone. L'écran, lui, parle français.
 *
 * ------------------------------------------------------------------
 * LA RÈGLE DE CE FICHIER : UNE VALEUR INCONNUE S'AFFICHE TELLE QUELLE
 * ------------------------------------------------------------------
 * Aucune de ces tables ne rend « Inconnu » ni chaîne vide pour une
 * valeur qu'elle ne connaît pas : elle rend la valeur BRUTE.
 *
 * C'est délibéré. Ces énumérations sont contraintes par des `check` en
 * base, et une migration à venir peut en ajouter un membre — la
 * contrainte `organization_members_role_check` en compte déjà quatorze.
 * Le jour où un quinzième rôle apparaît, un `?? "Inconnu"` le ferait
 * disparaître de l'interface sans une ligne d'alerte, et personne ne
 * saurait que l'écran a cessé de dire la vérité. Afficher
 * `orderPicker` en anglais est laid pendant une journée ; afficher
 * « Inconnu » est faux pour toujours.
 *
 * À ne pas confondre avec l'INCONNU au sens du projet — une donnée
 * absente, dessinée par `UnknownValue`. Ici la donnée est présente,
 * c'est sa traduction qui manque.
 */

function labelOf(dictionary: Record<string, string>, value: string): string {
  return dictionary[value] ?? value;
}

/** L'activité d'une entreprise (`business_organizations.business_type`). */
const BUSINESS_TYPES: Record<string, string> = {
  landscaper: "Paysagiste",
  nursery: "Pépiniériste",
  landscaperAndNursery: "Paysagiste et pépiniériste",
  horticulturalProducer: "Producteur horticole",
  gardenMaintenance: "Entretien de jardins",
  other: "Autre",
};

export function businessTypeLabel(value: string): string {
  return labelOf(BUSINESS_TYPES, value);
}

/**
 * Le rôle d'un membre DANS SON ENTREPRISE
 * (`organization_members.role`).
 *
 * ⚠️ « Admin » désigne ici l'administrateur d'UNE ENTREPRISE CLIENTE,
 * jamais un administrateur de la plateforme Oasis Care. C'est le piège
 * nominatif de tout ce chantier, et la spec p.32 l'interdit
 * explicitement : « Ne pas considérer simplement organization owner
 * comme admin Oasis Care. » Le libellé français porte donc le mot
 * « entreprise » pour que les deux vocabulaires ne se touchent jamais
 * à l'écran.
 */
const MEMBER_ROLES: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur d'entreprise",
  manager: "Responsable",
  sales: "Commercial",
  designer: "Concepteur",
  projectManager: "Chef de projet",
  teamLeader: "Chef d'équipe",
  fieldWorker: "Ouvrier",
  nurseryManager: "Responsable pépinière",
  nurseryWorker: "Ouvrier pépinière",
  orderPicker: "Préparateur de commandes",
  accounting: "Comptabilité",
  readOnly: "Lecture seule",
  custom: "Rôle sur mesure",
};

export function memberRoleLabel(value: string): string {
  return labelOf(MEMBER_ROLES, value);
}

/** Les forfaits d'entreprise (`organization_plans.key`). */
const PLANS: Record<string, string> = {
  solo: "Solo",
  team: "Équipe",
  business: "Entreprise",
  nursery: "Pépinière",
};

export function planLabel(value: string): string {
  return labelOf(PLANS, value);
}

/** Le statut d'un abonnement d'entreprise (`organization_subscriptions.status`). */
const SUBSCRIPTION_STATUSES: Record<string, string> = {
  trialing: "En essai",
  active: "Actif",
  pastDue: "Impayé",
  cancelled: "Résilié",
};

export function subscriptionStatusLabel(value: string): string {
  return labelOf(SUBSCRIPTION_STATUSES, value);
}

/**
 * La couleur d'un statut d'abonnement.
 *
 * Un statut hors catalogue prend le ton neutre : inventer une couleur
 * pour une valeur qu'on ne comprend pas reviendrait à porter un
 * jugement — « impayé » en rouge, « actif » en vert — sur une chose
 * dont on ne sait rien.
 */
export function subscriptionStatusTone(value: string): Tone {
  switch (value) {
    case "active":
      return "positive";
    case "trialing":
      return "info";
    case "pastDue":
      return "warning";
    case "cancelled":
      return "critical";
    default:
      return "neutral";
  }
}

/**
 * Ce qui a fait remonter un résultat de recherche
 * (`admin_global_search.matched_on`).
 *
 * L'afficher n'est pas décoratif : quand on cherche « 4521 » et qu'une
 * entreprise remonte, savoir que c'est son SIRET — et non son nom —
 * évite de croire à un résultat aberrant et de recommencer la
 * recherche autrement.
 */
const MATCHES: Record<string, string> = {
  identifiant: "identifiant",
  email: "adresse e-mail",
  nom: "nom",
  siret: "SIRET",
  siren: "SIREN",
  tva: "numéro de TVA",
};

export function matchedOnLabel(value: string): string {
  return labelOf(MATCHES, value);
}

/**
 * Le nom d'un pays à partir de son code ISO.
 *
 * `Intl.DisplayNames` peut lever sur un code mal formé — un « pays »
 * saisi à la main dans un champ libre, par exemple. On rend alors le
 * code brut : « ZZ » est plus honnête qu'une page en erreur, et plus
 * honnête qu'un pays inventé.
 */
export function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * « Produit utilisé » (spec p.8), depuis la colonne `product`.
 *
 * La base ne rend que `'pro'` ou `null`, et jamais `'mobile'` : la
 * présence dans une organisation prouve l'usage de Pro, rien ne prouve
 * l'usage de l'iPhone. `null` doit donc se lire « on ne sait pas », et
 * cette fonction rend `null` pour que l'appelant dessine un INCONNU —
 * surtout pas « Mobile » par défaut, qui serait une invention.
 */
export function productLabel(value: string | null): string | null {
  if (value === null) return null;
  return labelOf({ pro: "Oasis Care Pro", mobile: "Oasis Care Mobile" }, value);
}
