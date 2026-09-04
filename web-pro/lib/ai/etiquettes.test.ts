import { test } from "node:test";
import assert from "node:assert/strict";

import { PERMISSIONS } from "../auth/permissions.ts";
import { registreOutils } from "./runtime/tools.ts";
import {
  donneesConsultees,
  libelleAgentCatalogue,
  libellePermission,
  libelleRubrique,
} from "./etiquettes.ts";

/**
 * §11W — LES ÉTIQUETTES, ET LE DÉFAUT VISIBLE QU'ELLES FERMENT.
 *
 * Le test qui compte ici est le dernier : « Données consultées : . »
 * s'affichait en production dès qu'Oasis répondait avec un outil absent
 * d'une liste écrite à la main.
 */

// ==================================================================
// Les permissions
// ==================================================================

test("chaque permission du produit a une phrase française", () => {
  // Le jour où une migration en ajoute une, ce test tombe AVANT
  // qu'un code anglais n'apparaisse dans une phrase à l'écran.
  for (const permission of PERMISSIONS) {
    assert.notEqual(
      libellePermission(permission),
      permission,
      `« ${permission} » n'a pas de libellé français.`,
    );
  }
});

test("une permission inconnue ressort telle quelle, jamais en « — »", () => {
  // Laid, mais vrai. Un trou ferait disparaître l'information sans
  // que personne sache qu'il manque une traduction.
  assert.equal(libellePermission("nursery.audit"), "nursery.audit");
});

test("les libellés se lisent dans les deux phrases qui les utilisent", () => {
  // « Droit exigé : modifier les devis » et « Il vous manque : modifier
  // les devis » : l'infinitif est la seule forme qui tienne dans les
  // deux. Une majuscule initiale trahirait un nom, pas un verbe.
  for (const permission of PERMISSIONS) {
    const libelle = libellePermission(permission);
    assert.equal(libelle, libelle.toLowerCase(), `« ${libelle} » commence comme un titre.`);
  }
});

// ==================================================================
// Les agents et les rubriques
// ==================================================================

test("l'agent du catalogue qui n'existe pas est nommé, et dit qu'il n'existe pas", () => {
  // `procurement` figure au catalogue pour DÉCLARER un interdit, pas
  // pour promettre un agent. Le libellé ne doit pas laisser croire
  // qu'on peut le régler quelque part.
  assert.match(libelleAgentCatalogue("procurement"), /non construit/);
});

test("les quatre agents construits ont leur nom d'écran", () => {
  assert.equal(libelleAgentCatalogue("billing"), "Facturation");
  assert.equal(libelleAgentCatalogue("quote_pricing"), "Devis & Prix");
});

test("un code de rubrique devient un intertitre français", () => {
  assert.equal(libelleRubrique("URGENT"), "À traiter aujourd'hui");
  assert.equal(libelleRubrique("INCONNU"), "INCONNU");
});

// ==================================================================
// « Données consultées » — le défaut de production
// ==================================================================

test("un outil de lecture appelé par son nom SQL se lit en français", () => {
  assert.deepEqual(donneesConsultees(["ai_finance_snapshot"]), ["chiffres de l'entreprise"]);
});

test("le même outil appelé par son nom de catalogue donne le même libellé", () => {
  // La fonction Edge historique journalisait `getCompanyMetrics` ; le
  // runtime journalise `ai_finance_snapshot`. Les deux formes cohabitent
  // dans les fils déjà écrits, et doivent se lire pareil.
  assert.deepEqual(donneesConsultees(["getCompanyMetrics"]), ["chiffres de l'entreprise"]);
});

test("un outil lu deux fois, sous ses deux noms, ne s'affiche qu'une fois", () => {
  assert.deepEqual(donneesConsultees(["ai_finance_snapshot", "getCompanyMetrics"]), [
    "chiffres de l'entreprise",
  ]);
});

test("AUCUN outil de lecture du registre ne tombe dans le vide", () => {
  // LE TEST QUI FERME « Données consultées : . » POUR DE BON.
  // Une liste écrite à la main dérive au premier outil ajouté ; celle-ci
  // est confrontée au registre à chaque exécution.
  for (const outil of registreOutils().tous()) {
    if (outil.famille !== "lecture") continue;
    assert.ok(outil.rpc, `« ${outil.nom} » est une lecture sans fonction SQL déclarée.`);
    const libelles = donneesConsultees([outil.rpc]);
    assert.equal(libelles.length, 1, `« ${outil.nom} » ne rend aucun libellé.`);
    assert.ok(libelles[0], `« ${outil.nom} » rend un libellé vide.`);
  }
});

test("les écritures ne sont PAS des données consultées", () => {
  // Une proposition de devis n'est pas une source. L'annoncer comme
  // telle ferait croire qu'Oasis a lu ce qu'il n'a fait qu'écrire.
  const ecritures = registreOutils()
    .tous()
    .filter((outil) => outil.famille !== "lecture");
  assert.ok(ecritures.length > 0, "le registre doit bien contenir des écritures");

  for (const outil of ecritures) {
    // Une écriture n'a pas de `rpc` déclaré — c'est justement le
    // garde-fou du registre : elle ne peut pas être appelée par erreur
    // comme une lecture. On éprouve donc le nom, et le `rpc` s'il y en a.
    const noms = [outil.nom, ...(outil.rpc ? [outil.rpc] : [])];
    assert.deepEqual(
      donneesConsultees(noms),
      [],
      `« ${outil.nom} » (${outil.famille}) apparaît dans les données consultées.`,
    );
  }
});

test("« on ne sait pas » et « rien lu » se distinguent jusqu'ici", () => {
  // `null` : l'écran doit se taire. `[]` : il peut dire que rien n'a
  // été lu. Les deux rendent une liste vide, mais l'appelant garde
  // l'information dans la valeur d'origine.
  assert.deepEqual(donneesConsultees(null), []);
  assert.deepEqual(donneesConsultees([]), []);
});

test("un outil inconnu est écarté plutôt qu'affiché en identifiant", () => {
  assert.deepEqual(donneesConsultees(["ai_outil_retire", "ai_finance_snapshot"]), [
    "chiffres de l'entreprise",
  ]);
});
