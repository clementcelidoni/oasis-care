import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, OpenAIProvider as FournisseurOpenAISDK, Runner, tool } from "@openai/agents";
import {
  OpenAIProvider,
  VARIABLE_TRACING,
  fournisseurIA,
  reinitialiserFournisseurIA,
  type AIProvider,
} from "./provider.ts";
import { VARIABLE_CLE_OPENAI, lireCleOpenAI } from "./credentials.ts";

/**
 * §11V — LE FOURNISSEUR, ET LE PARI D'ARCHITECTURE QU'IL PORTE.
 *
 * ─── LE PREMIER TEST EST UN TEST D'ARCHITECTURE ───
 *
 * La décision de faire tourner le runtime des agents dans le serveur
 * Next.js plutôt que dans une fonction Edge repose sur un fait
 * mesurable : `@openai/agents` s'importe et fonctionne en Node, et pas
 * en Deno — `@openai/agents-core` livre des shims pour « workerd » et
 * « browser », aucun pour Deno. Le premier test ci-dessous vérifie ce
 * fait à chaque exécution. S'il tombe un jour, ce n'est pas un détail
 * de test : c'est la prémisse de l'architecture qui s'écroule, et il
 * faut le savoir tout de suite.
 *
 * ─── LES AUTRES DÉFENDENT LA CLÉ ───
 *
 * Rien ne doit se construire à l'import, et aucune méthode ne doit
 * rendre la clé. `estConfigure()` répond par un booléen : une méthode
 * « quelle clé utilises-tu ? », même tronquée, finirait dans un journal
 * puis dans une capture d'écran.
 */

test("le pari d'architecture : l'Agents SDK s'importe et s'instancie en Node", () => {
  assert.equal(typeof Agent, "function");
  assert.equal(typeof Runner, "function");
  assert.equal(typeof tool, "function");
  assert.equal(typeof FournisseurOpenAISDK, "function");

  // Un agent se construit sans clé et sans réseau : c'est le SDK qui
  // diffère l'appel, et c'est ce qui rend le reste testable hors ligne.
  const agent = new Agent({ name: "Sonde", instructions: "Ne sert qu'au test d'import." });
  assert.equal(agent.name, "Sonde");
});

test("sans clé : la construction réussit, et c'est l'APPEL qui échoue", async () => {
  const fournisseur = new OpenAIProvider({ env: {} });

  assert.equal(fournisseur.estConfigure(), false);
  assert.equal(fournisseur.identifiant, "openai");

  // Le message doit nommer la variable à poser. Le SDK, lui, dit
  // « Missing credentials » sans dire où : une demi-heure perdue au
  // déploiement, systématiquement.
  await assert.rejects(() => fournisseur.getModel("peu-importe"), (erreur: unknown) => {
    assert.ok(erreur instanceof Error);
    assert.ok(erreur.message.includes(VARIABLE_CLE_OPENAI));
    assert.ok(erreur.message.includes("NEXT_PUBLIC_"), "le message doit rappeler le piège");
    return true;
  });
});

test("avec une clé : configuré, et toujours rien de construit tant qu'on n'appelle pas", () => {
  const fournisseur = new OpenAIProvider({ env: { [VARIABLE_CLE_OPENAI]: "sk-fictive" } });
  assert.equal(fournisseur.estConfigure(), true);

  // Aucune méthode ne rend la clé, et l'objet sérialisé ne la porte pas
  // non plus : les champs sont privés (`#`), donc invisibles à
  // `JSON.stringify`, à `Object.keys` et à un journal distrait.
  assert.ok(!JSON.stringify(fournisseur).includes("sk-fictive"));
  assert.ok(!Object.keys(fournisseur).some((k) => k.toLowerCase().includes("cle")));
});

test("une clé vide ou blanche vaut clé absente", () => {
  assert.equal(lireCleOpenAI({ [VARIABLE_CLE_OPENAI]: "" }), undefined);
  assert.equal(lireCleOpenAI({ [VARIABLE_CLE_OPENAI]: "   " }), undefined);
  assert.equal(lireCleOpenAI({}), undefined);
  assert.equal(lireCleOpenAI({ [VARIABLE_CLE_OPENAI]: "  sk-avec-espaces  " }), "sk-avec-espaces");

  // Un `OPENAI_API_KEY=` oublié dans un fichier d'environnement doit
  // donner « aucune clé configurée », pas un 401 incompréhensible.
  assert.equal(new OpenAIProvider({ env: { [VARIABLE_CLE_OPENAI]: "" } }).estConfigure(), false);
});

test("le nom de la variable n'a PAS de préfixe NEXT_PUBLIC_", () => {
  // Ce test tient en une ligne et ferme la seule façon dont une clé
  // OpenAI pourrait partir dans le navigateur d'un client (spec p. 21).
  assert.ok(!VARIABLE_CLE_OPENAI.startsWith("NEXT_PUBLIC_"));
  assert.ok(!VARIABLE_TRACING.startsWith("NEXT_PUBLIC_"));
});

test("le fournisseur satisfait l'interface générique de la spec p. 22", () => {
  // L'affectation elle-même est la vérification : si `OpenAIProvider`
  // cessait d'implémenter `AIProvider`, `tsc` refuserait cette ligne.
  const fournisseur: AIProvider = new OpenAIProvider({ env: {} });

  assert.equal(typeof fournisseur.getModel, "function");
  assert.equal(typeof fournisseur.run, "function");
  assert.equal(typeof fournisseur.estConfigure, "function");
});

test("l'instance partagée se construit à la première demande, et se réinitialise", () => {
  reinitialiserFournisseurIA();
  const premier = fournisseurIA();
  assert.equal(premier, fournisseurIA());

  reinitialiserFournisseurIA();
  assert.notEqual(premier, fournisseurIA());
  reinitialiserFournisseurIA();
});

test("fermer() sur un fournisseur qui n'a jamais servi ne lève pas", async () => {
  await new OpenAIProvider({ env: {} }).fermer();
});
