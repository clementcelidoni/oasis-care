import test from "node:test";
import assert from "node:assert/strict";

import {
  businessTypeLabel,
  countryLabel,
  memberRoleLabel,
  platformLabel,
  presenceSourceLabel,
  presenceSourceTone,
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
 * `product` vaut `'pro'`, `'mobile'`, `'both'` ou `null`. Le `null` doit
 * remonter tel quel pour que l'écran dessine un INCONNU : « Mobile » par
 * défaut serait l'invention la plus tentante de tout cet écran.
 */
test("un produit inconnu reste inconnu", () => {
  assert.equal(productLabel(null), null);
  assert.equal(productLabel("pro"), "Oasis Care Pro");
  assert.equal(productLabel("mobile"), "Oasis Care Mobile");
});

/**
 * LA VALEUR QU'ON OUBLIE. Depuis 0077, `admin_list_users` sait rendre
 * `'both'`, et le compte le plus important de la production en est un :
 * le propriétaire, membre de l'organisation ET utilisateur de l'iPhone.
 * Sans son entrée au dictionnaire, la fiche afficherait le mot anglais
 * brut à l'endroit exact où l'œil se pose en premier.
 */
test("« both » est traduit, et nomme les deux produits", () => {
  const label = productLabel("both");
  assert.ok(label, "« both » doit être traduit");
  assert.notEqual(label, "both");
  assert.ok(label.includes("Mobile") && label.includes("Pro"), `« ${label} » doit nommer les deux`);
});

/**
 * Une plateforme et une provenance hors catalogue s'affichent telles
 * quelles, comme tout le reste de ce fichier : le jour où un client
 * Android existera, sa valeur ne doit pas disparaître de l'interface en
 * silence.
 */
test("plateforme et provenance suivent la règle de la valeur brute", () => {
  assert.equal(platformLabel("ios"), "iPhone (iOS)");
  assert.equal(platformLabel("windowsPhone"), "windowsPhone");
  assert.equal(presenceSourceLabel("inconnue"), "inconnue");
});

/**
 * LA DISTINCTION QUE TOUT CE CHANTIER PROTÈGE : une mesure et une
 * déduction ne se lisent pas pareil. Elles n'ont donc pas la même
 * couleur, et une provenance qu'on ne comprend pas n'en reçoit aucune.
 */
test("une déduction ne se peint pas comme une mesure", () => {
  assert.equal(presenceSourceLabel("declared"), "Déclaré par l'application");
  assert.match(presenceSourceLabel("inferred"), /[Dd]éduit/);
  assert.notEqual(presenceSourceTone("declared"), presenceSourceTone("inferred"));
  assert.equal(presenceSourceTone("bidon"), "neutral");
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
