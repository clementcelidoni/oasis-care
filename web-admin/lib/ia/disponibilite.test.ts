import test from "node:test";
import assert from "node:assert/strict";

import { verifierDisponibilite } from "./disponibilite.ts";
import { lireEtatRouteur } from "./modeles.ts";

/**
 * ==================================================================
 * UN SEUL SUJET : « INTROUVABLE » N'EST PAS « NON VÉRIFIABLE »
 * ==================================================================
 *
 * Un écran qui afficherait « modèle indisponible » parce que la clé
 * manque enverrait quelqu'un corriger un nom de modèle parfaitement
 * correct. Et l'inverse est pire : un 404 déguisé en « on ne sait pas »
 * laisserait un identifiant faux en production jusqu'à ce qu'une
 * décision de facturation tombe un matin.
 *
 * C'est la même règle que partout ailleurs dans cette application :
 * l'inconnu ne se déguise ni en zéro, ni en non.
 */

const ETAT = lireEtatRouteur({});

function reponse(status: number): Response {
  return new Response(status === 200 ? "{}" : "", { status });
}

test("sans clé, les trois niveaux sont « non vérifiable » — jamais « introuvable »", async () => {
  let appels = 0;
  const rapport = await verifierDisponibilite(ETAT, {
    env: {},
    fetchImpl: async () => {
      appels += 1;
      return reponse(200);
    },
  });

  // Et surtout : aucune requête n'est partie. Interroger l'API sans clé
  // produirait trois 401 qu'on aurait à réinterpréter.
  assert.equal(appels, 0);
  assert.equal(rapport.cleConfiguree, false);
  assert.equal(rapport.tousDisponibles, false);
  assert.equal(rapport.auMoinsUnIntrouvable, false);
  assert.equal(rapport.auMoinsUnNonVerifiable, true);
  assert.equal(rapport.modeles.length, 3);
  for (const modele of rapport.modeles) {
    assert.equal(modele.etat, "non_verifiable");
    assert.equal(modele.statutHttp, null);
  }
});

test("un 404 est un CONSTAT : le nom est faux, et la variable qui le corrige est nommée", async () => {
  const rapport = await verifierDisponibilite(ETAT, {
    cle: "sk-test",
    fetchImpl: async (entree) =>
      reponse(String(entree).includes("gpt-5.6-sol") ? 404 : 200),
  });

  const avance = rapport.modeles.find((m) => m.niveau === "advanced");
  assert.ok(avance);
  assert.equal(avance.etat, "introuvable");
  assert.equal(avance.statutHttp, 404);
  assert.equal(avance.variableDeCorrection, "OASIS_MODEL_ADVANCED");
  assert.match(avance.detail, /OASIS_MODEL_ADVANCED/);

  assert.equal(rapport.auMoinsUnIntrouvable, true);
  assert.equal(rapport.tousDisponibles, false);
});

test("une clé refusée ne rend pas un modèle introuvable", async () => {
  const rapport = await verifierDisponibilite(ETAT, {
    cle: "sk-mauvaise",
    fetchImpl: async () => reponse(401),
  });

  assert.equal(rapport.auMoinsUnIntrouvable, false);
  assert.equal(rapport.auMoinsUnNonVerifiable, true);
  for (const modele of rapport.modeles) {
    assert.equal(modele.etat, "non_verifiable");
    assert.equal(modele.statutHttp, 401);
  }
});

test("un réseau mort ne fait pas tomber le diagnostic", async () => {
  // Un diagnostic qui tombe en panne n'est pas un diagnostic. Aucune
  // exception ne doit sortir d'ici.
  const rapport = await verifierDisponibilite(ETAT, {
    cle: "sk-test",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });

  assert.equal(rapport.auMoinsUnNonVerifiable, true);
  for (const modele of rapport.modeles) {
    assert.equal(modele.etat, "non_verifiable");
    assert.equal(modele.statutHttp, null);
    assert.match(modele.detail, /TypeError/);
  }
});

test("aucun détail ne recopie le corps de la réponse — la clé n'y apparaît jamais", async () => {
  // Un corps de réponse peut contenir l'URL appelée, un en-tête, parfois
  // davantage. Ce texte finit à l'écran et dans un journal.
  const rapport = await verifierDisponibilite(ETAT, {
    cle: "sk-secret-a-ne-jamais-afficher",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "clé sk-secret-a-ne-jamais-afficher invalide" }), {
        status: 500,
      }),
  });

  for (const modele of rapport.modeles) {
    assert.equal(modele.detail.includes("sk-secret"), false);
    assert.equal(modele.etat, "non_verifiable");
  }
});

test("les trois requêtes partent ensemble, et l'identifiant testé est celui du routeur", async () => {
  const vues: string[] = [];
  const etat = lireEtatRouteur({ OASIS_MODEL_ECONOMY: "gpt-6-luna" });

  const rapport = await verifierDisponibilite(etat, {
    cle: "sk-test",
    fetchImpl: async (entree) => {
      vues.push(String(entree));
      return reponse(200);
    },
  });

  assert.equal(vues.length, 3);
  assert.ok(vues.some((url) => url.includes("gpt-6-luna")));
  assert.equal(rapport.tousDisponibles, true);
  assert.equal(rapport.modeles.find((m) => m.niveau === "economy")?.modele, "gpt-6-luna");
});
