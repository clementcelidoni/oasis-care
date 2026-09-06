/**
 * QUI LIT LES ÉTIQUETTES, QUI LES IMPRIME.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL N'Y A PLUS DE MIROIR, ET C'EST LA CORRECTION
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce module portait une table rôle → droits recopiée à la main, parce
 * que `lib/auth/permissions.ts` ignorait `etiquettes.read` et
 * `etiquettes.manage` : `organization.permissions` ne les contenait
 * jamais, et un écran qui s'y serait fié aurait été fermé pour le
 * propriétaire lui-même.
 *
 * Les deux clés sont désormais déclarées là-bas, et
 * `permissions.test.ts` relit les migrations pour vérifier que le web
 * et la base accordent exactement les mêmes droits, rôle par rôle. Une
 * seule table, tenue par un test : la copie n'a plus lieu d'être.
 *
 * ET LE CAS `custom` SE RÈGLE TOUT SEUL. Il demandait une requête, qui
 * portait un vrai défaut : elle ne filtrait pas sur le porteur, la RLS
 * d'`organization_members` rend la liste ENTIÈRE des membres, et
 * `.maybeSingle()` refusait donc de répondre dès le deuxième salarié —
 * un rôle personnalisé à qui l'entreprise avait donné
 * `etiquettes.manage` lisait « ce n'est pas votre rôle ».
 * `permissionsForRole()` filtre déjà `custom_permissions` contre
 * `PERMISSIONS`, et `getUserOrganizations()` lit maintenant la ligne du
 * porteur. Plus de requête ici, plus de défaut.
 *
 * ══════════════════════════════════════════════════════════════════
 * CECI NE PROTÈGE RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Cacher un bouton n'est pas un contrôle d'accès : c'est de la
 * courtoisie. La barrière est en base — les fonctions du § 7 de 0090
 * sont `security definer` et refont le contrôle, et le résolveur du
 * § 15 ne croit rien de ce que le navigateur lui raconte.
 */

import type { OrganizationContext } from "@/lib/auth/organization";

export type DroitsEtiquettes = {
  /** Voir la liste, les modèles, l'aperçu. */
  readonly peutLire: boolean;
  /** Composer un modèle, poser une étiquette, publier, imprimer. */
  readonly peutGerer: boolean;
};

/** Les droits du porteur sur les étiquettes de l'entreprise active. */
export function droitsEtiquettes(organization: OrganizationContext): DroitsEtiquettes {
  const peutGerer = organization.permissions.includes("etiquettes.manage");
  return {
    // GÉRER IMPLIQUE LIRE, et il faut l'écrire : rien n'oblige la base
    // à semer les deux ensemble, et un rôle qui pourrait imprimer sans
    // pouvoir ouvrir l'écran serait une impasse silencieuse.
    peutLire: peutGerer || organization.permissions.includes("etiquettes.read"),
    peutGerer,
  };
}
