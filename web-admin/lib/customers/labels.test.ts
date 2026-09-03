import test from "node:test";
import assert from "node:assert/strict";

import {
  businessTypeLabel,
  countryLabel,
  memberRoleLabel,
  productLabel,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from "./labels.ts";

/**
 * ==================================================================
 * LA RÈGLE PROTÉGÉE ICI : UNE VALEUR INCONNUE NE DISPARAÎT PAS
 * ==================================================================
 *
 * Ces énumérations sont contraintes en base et une migration peut leur
 * ajouter un membre — `organization_members_role_check` en compte déjà
 * quatorze. Un `?? "Inconnu"` ferait alors disparaître le nouveau rôle
 * de l'interface sans une ligne d'alerte, et personne ne saurait que
 * l'écran a cessé de dire la vérité.
 *
 * Afficher `orderPicker` en anglais est laid pendant une journée.
 * Afficher « Inconnu » est faux pour toujours.
 */

test("une valeur hors catalogue s'affiche telle quelle", () => {
  assert.equal(memberRoleLabel("quinziemeRole"), "quinziemeRole");
  assert.equal(businessTypeLabel("arboriculteur"), "arboriculteur");
  assert.equal(subscriptionStatusLabel("paused"), "paused");
});

test("les rôles connus sont traduits", () => {
  assert.equal(memberRoleLabel("owner"), "Propriétaire");
  assert.equal(memberRoleLabel("readOnly"), "Lecture seule");
});

/**
 * Le piège nominatif de tout ce chantier, figé par un test.
 *
 * Spec p.32 : « Ne pas considérer simplement organization owner comme
 * admin Oasis Care. » Le rôle `admin` de `organization_members` désigne
 * l'administrateur d'UNE ENTREPRISE CLIENTE. Si son libellé français
 * devenait « Administrateur » tout court, un écran du Control Center
 * afficherait le mot qui désigne ailleurs un administrateur de
 * plateforme — et les deux vocabulaires se toucheraient exactement là
 * où la spec l'interdit.
 */
test("le rôle « admin » d'une entreprise ne se confond pas avec un administrateur de plateforme", () => {
  const label = memberRoleLabel("admin");
  assert.ok(
    label.toLowerCase().includes("entreprise"),
    `le libellé « ${label} » doit préciser qu'il s'agit d'une entreprise cliente`,
  );
});

/**
 * `product` vaut `'pro'` ou `null`, jamais `'mobile'`. Le `null` doit
 * remonter tel quel pour que l'écran dessine un INCONNU : rien dans
 * cette base n'enregistre par quelle application un compte est entré, et
 * « Mobile » par défaut serait l'invention la plus tentante de tout cet
 * écran.
 */
test("un produit inconnu reste inconnu", () => {
  assert.equal(productLabel(null), null);
  assert.equal(productLabel("pro"), "Oasis Care Pro");
});

test("un statut hors catalogue ne reçoit pas de couleur", () => {
  // Inventer une couleur pour une valeur qu'on ne comprend pas
  // reviendrait à porter un jugement — vert, rouge — sur une chose dont
  // on ne sait rien.
  assert.equal(subscriptionStatusTone("paused"), "neutral");
  assert.equal(subscriptionStatusTone("active"), "positive");
  assert.equal(subscriptionStatusTone("pastDue"), "warning");
});

test("un code pays illisible rend le code, pas une erreur", () => {
  assert.equal(countryLabel("FR"), "France");
  // Un « pays » saisi à la main ne doit pas faire tomber la fiche.
  assert.equal(countryLabel("pays inventé"), "pays inventé");
});
