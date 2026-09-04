import test from "node:test";
import assert from "node:assert/strict";

import {
  CHOIX_PRODUIT,
  choixCourant,
  construireCarte,
  estChoix,
  identifiantPourChoix,
  niveauDeLIdentifiant,
  surchargesOrphelines,
} from "./carte.ts";
import { lireEtatRouteur } from "./modeles.ts";
import type { LigneSurcharge } from "./types.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT : LA SURCHARGE QUI DÉCROCHE
 * ==================================================================
 *
 * `ai_model_overrides.model` est du texte libre — la migration 0076
 * l'assume, parce que SQL ne doit connaître aucun nom de modèle. Une
 * surcharge fige donc un identifiant LITTÉRAL. Le jour où
 * `OASIS_MODEL_ADVANCED` corrige un nom faux, l'entreprise surchargée
 * reste accrochée à l'ancien identifiant et son IA tombe en 404
 * pendant que celle du voisin tourne.
 *
 * Personne ne s'en apercevrait : la table est correcte, le routeur est
 * correct, chacun fait ce qu'on lui demande. La seule chose qui peut
 * le dire est `niveauEffectif === null`, et la seule façon de la perdre
 * est de « ranger » ces surcharges sur un niveau par défaut. C'est la
 * même faute que le `?? 0` que ce projet a corrigé quatre fois
 * ailleurs : faire disparaître l'anomalie qu'on cherche à voir.
 */

const ETAT = lireEtatRouteur({});

function surcharge(agent: string, model: string): LigneSurcharge {
  return {
    organization_id: "11111111-1111-1111-1111-111111111111",
    agent,
    model,
    reason: "test",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    updated_by: null,
  };
}

test("sans surcharge, chaque agent suit le produit", () => {
  const carte = construireCarte(ETAT);

  assert.equal(carte.nombreSurcharges, 0);
  assert.deepEqual(carte.decrochees, []);
  assert.equal(carte.surchargeables.length, 4);
  assert.equal(carte.autres.length, 10);

  const finance = carte.surchargeables.find((ligne) => ligne.cle === "finance");
  assert.ok(finance);
  assert.equal(finance.source, "produit");
  assert.equal(finance.modeleEffectif, "gpt-5.6-terra");
  assert.equal(finance.niveauEffectif, "standard");
  assert.equal(choixCourant(finance), CHOIX_PRODUIT);
});

test("une surcharge d'entreprise gagne contre le produit et contre l'environnement", () => {
  // L'environnement déplace finance vers « economy » pour tout le
  // serveur ; l'entreprise, elle, impose l'identifiant du niveau avancé.
  const etat = lireEtatRouteur({ OASIS_MODEL_AGENT_FINANCE: "economy" });
  const carte = construireCarte(etat, [surcharge("finance", "gpt-5.6-sol")]);

  const finance = carte.surchargeables.find((ligne) => ligne.cle === "finance");
  assert.ok(finance);
  assert.equal(finance.source, "entreprise");
  assert.equal(finance.niveauConfigure, "economy");
  assert.equal(finance.modeleEffectif, "gpt-5.6-sol");
  assert.equal(finance.niveauEffectif, "advanced");
  assert.equal(finance.decrochee, false);
  assert.equal(carte.nombreSurcharges, 1);
});

test("une surcharge qui pointe un identifiant inconnu est DÉCROCHÉE, pas rangée sur un niveau", () => {
  const carte = construireCarte(ETAT, [surcharge("billing", "gpt-5.5-terra")]);

  const billing = carte.surchargeables.find((ligne) => ligne.cle === "billing");
  assert.ok(billing);
  assert.equal(billing.modeleEffectif, "gpt-5.5-terra");
  // LE POINT ENTIER DE CE FICHIER : `null`, et surtout pas « standard ».
  assert.equal(billing.niveauEffectif, null);
  assert.equal(billing.decrochee, true);
  assert.deepEqual(
    carte.decrochees.map((ligne) => ligne.cle),
    ["billing"],
  );
  // Aucune des quatre options du sélecteur ne la représente.
  assert.equal(choixCourant(billing), null);
});

test("changer l'identifiant d'un niveau décroche les surcharges qui le portaient", () => {
  // Le scénario réel : quelqu'un corrige un nom de modèle faux par
  // variable d'environnement, et les entreprises surchargées restent
  // accrochées à l'ancien.
  const avant = construireCarte(ETAT, [surcharge("executive", "gpt-5.6-sol")]);
  assert.equal(avant.decrochees.length, 0);

  const apres = construireCarte(lireEtatRouteur({ OASIS_MODEL_ADVANCED: "gpt-6-sol" }), [
    surcharge("executive", "gpt-5.6-sol"),
  ]);
  assert.equal(apres.decrochees.length, 1);
  assert.equal(apres.decrochees[0].cle, "executive");
});

test("les dix agents non surchargeables ignorent une ligne posée sur eux", () => {
  // La base la refuserait de toute façon (23514), mais une ligne
  // parasite ne doit pas non plus faire échouer la carte.
  const carte = construireCarte(ETAT, [surcharge("planning", "gpt-5.6-sol")]);

  const planning = carte.autres.find((ligne) => ligne.cle === "planning");
  assert.ok(planning);
  assert.equal(planning.surchargeable, false);
  assert.equal(planning.surcharge, null);
  assert.equal(planning.source, "produit");
});

test("une surcharge sur un agent hors catalogue ne disparaît pas : elle est ramassée à part", () => {
  // Elle reste ACTIVE en base — `ai_model_for_agent()` la lira sans
  // broncher — donc l'écran doit pouvoir la nommer, faute de pouvoir la
  // ranger dans une ligne de carte.
  const lignes = [surcharge("legacy_agent", "gpt-5.6-luna"), surcharge("finance", "gpt-5.6-sol")];
  const orphelines = surchargesOrphelines(lignes);

  assert.equal(orphelines.length, 1);
  assert.equal(orphelines[0].agent, "legacy_agent");

  // Et la carte, elle, s'affiche quand même.
  const carte = construireCarte(ETAT, lignes);
  assert.equal(carte.nombreSurcharges, 1);
});

// ------------------------------------------------------------------
// Le sélecteur
// ------------------------------------------------------------------

test("« suivre le produit » n'est pas un niveau, et n'écrit aucun identifiant", () => {
  // C'est la distinction qui empêche le formulaire de créer lui-même
  // une surcharge décrochée : dire « je ne change rien » ne doit pas
  // figer l'identifiant du jour.
  assert.ok(estChoix(CHOIX_PRODUIT));
  assert.ok(estChoix("advanced"));
  assert.equal(estChoix("terra"), false);
  assert.equal(estChoix(null), false);

  assert.equal(identifiantPourChoix(ETAT, CHOIX_PRODUIT), null);
  assert.equal(identifiantPourChoix(ETAT, "advanced"), "gpt-5.6-sol");
});

test("l'identifiant écrit suit la variable d'environnement du moment", () => {
  const etat = lireEtatRouteur({ OASIS_MODEL_ADVANCED: "gpt-6-sol" });
  assert.equal(identifiantPourChoix(etat, "advanced"), "gpt-6-sol");
  assert.equal(niveauDeLIdentifiant(etat, "gpt-6-sol"), "advanced");
  assert.equal(niveauDeLIdentifiant(etat, "gpt-5.6-sol"), null);
});
