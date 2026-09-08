/**
 * §PORTE ANONYME — L'ÉCHÉANCE RÉELLE D'UN LIEN DE PARTAGE.
 *
 * Fichier PUR : ni base, ni réseau, ni JSX. Il vit à part du panneau
 * pour deux raisons, et la seconde est la plus concrète — le harnais de
 * test du projet strippe les types mais ne résout pas les `.tsx`, donc
 * une règle enfermée dans un composant est une règle qu'on ne peut pas
 * éprouver.
 */

/**
 * Ce que le client verra si le lien s'ouvre encore le jour où il clique.
 *
 * L'ÉCHÉANCE AFFICHÉE EST LA PLUS PROCHE DES DEUX : celle du lien et
 * celle du devis.
 *
 * `partager_devis` fige `expires_at` au moment du partage, mais la base
 * RELIT `valid_until` à chaque ouverture (0089 § 8.d) : raccourcir la
 * validité d'un devis ferme la porte le jour même. N'afficher que la
 * date du lien ferait donc promettre une date que la porte ne tiendrait
 * pas — et le paysagiste enverrait un lien en croyant qu'il vaut deux
 * mois de plus.
 *
 * Dans l'autre sens, `expires_at` reste un PLAFOND : pour un devis sans
 * date de validité, le lien se ferme au bout de trente jours.
 */
export function echeanceReelle(
  expiresAt: string,
  validUntil: string | null,
): { date: Date; source: "devis" | "plafond" } {
  const lien = new Date(expiresAt);
  if (validUntil === null) return { date: lien, source: "plafond" };

  // `valid_until` est une date de CALENDRIER : un devis « valable
  // jusqu'au 30 » l'est toute la journée du 30. La ramener à minuit
  // fermerait la porte un jour trop tôt, au nez d'un client qui lit la
  // bonne date sur son document.
  const devis = new Date(`${validUntil}T23:59:59`);
  return devis <= lien ? { date: devis, source: "devis" } : { date: lien, source: "plafond" };
}
