import { test } from "node:test";
import assert from "node:assert/strict";
import { aiguiller, normaliser } from "./aiguillage.ts";

/**
 * §11V — L'AIGUILLAGE, ÉPROUVÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON DÉFEND ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Deux propriétés, et la seconde compte plus que la première.
 *
 *   1. Les mots-clés envoient au bon agent. C'est agréable, et une
 *      erreur ici n'est jamais grave : le mauvais spécialiste répondra
 *      « je ne vois rien ».
 *
 *   2. L'AIGUILLAGE NE COÛTE RIEN. Aucun modèle n'est appelé pour
 *      décider à qui parler — c'est la règle « outils déterministes
 *      avant IA » (p. 11-12) appliquée à l'aiguillage lui-même. Un
 *      aiguilleur en langage naturel ajouterait un appel de modèle, une
 *      ligne au grand livre et une latence À CHAQUE QUESTION, avant
 *      même de commencer à répondre. Ce fichier est un test synchrone
 *      sans le moindre port : c'est la preuve que la fonction ne peut
 *      rien appeler du tout.
 *
 * ─── ET LE CAS QUI ÉCONOMISE LE PLUS D'ARGENT ───
 *
 * La question qu'aucun mot-clé ne tranche. Elle part à la Direction —
 * seul agent capable d'interroger les autres — mais AVEC
 * `complexity: "simple"`, ce qui la décale d'un cran sous son niveau
 * habituel. Sans ce décalage, toute question mal formulée partirait sur
 * le modèle le plus cher, et le ratio « ~5 % Sol » de la page 17 serait
 * faux dès la première semaine.
 */

// ==================================================================
// 1. L'agent imposé gagne toujours
// ==================================================================

test("quand l'écran sait de quoi il parle, il n'y a rien à deviner", () => {
  const resultat = aiguiller("n'importe quoi qui parle de facture", "quotePricing");
  assert.equal(resultat.agent, "quotePricing");
  assert.equal(resultat.complexite, undefined, "on laisse le routeur appliquer le niveau de l'agent");
  assert.match(resultat.raison, /imposé/);
});

// ==================================================================
// 2. Les mots-clés
// ==================================================================

test("les questions de facturation vont à la Facturation", () => {
  for (const question of [
    "Qu'est-ce que je dois facturer ?",
    "Quelles sont mes factures impayées ?",
    "Prépare un brouillon de facture pour les Dupont",
    "Où en sont mes encaissements ?",
  ]) {
    assert.equal(aiguiller(question).agent, "billing", question);
  }
});

test("les questions de prix vont au chiffrage", () => {
  for (const question of [
    "Ce devis est-il bien chiffré ?",
    "Quel taux de marque sur ce dossier ?",
    "Suis-je sous-tarifé sur les terrasses ?",
  ]) {
    assert.equal(aiguiller(question).agent, "quotePricing", question);
  }
});

test("les questions d'argent global vont à la Finance", () => {
  for (const question of [
    "Quel est mon chiffre d'affaires ce trimestre ?",
    "Comment va ma trésorerie ?",
    "Mes créances augmentent-elles ?",
    "Est-ce que je tiens mon objectif de marge ?",
  ]) {
    assert.equal(aiguiller(question).agent, "finance", question);
  }
});

test("les questions de pilotage vont à la Direction, à son niveau habituel", () => {
  for (const question of [
    "Que dois-je faire aujourd'hui ?",
    "Fais-moi un brief",
    "Quelles sont mes priorités ?",
    "Qu'est-ce qui est urgent ?",
  ]) {
    const resultat = aiguiller(question);
    assert.equal(resultat.agent, "executive", question);
    assert.equal(
      resultat.complexite,
      undefined,
      "un brief DEMANDÉ n'est pas une question qu'on n'a pas comprise",
    );
  }
});

test("l'ordre des règles tranche les questions qui portent deux mots", () => {
  // « facturer un devis signé » contient « factur » et « devis », et
  // c'est bien la Facturation qu'on interroge.
  assert.equal(aiguiller("Facturer les devis signés").agent, "billing");
});

// ==================================================================
// 3. LE CAS QUI COMPTE : personne ne sait
// ==================================================================

test("une question qu'aucun mot-clé ne tranche part à la Direction, UN CRAN PLUS BAS", () => {
  const resultat = aiguiller("Est-ce que ça se passe bien avec les Martin en ce moment ?");

  assert.equal(resultat.agent, "executive", "un spécialiste répondrait « je ne vois rien » avec aplomb");
  assert.equal(
    resultat.complexite,
    "simple",
    "on ne paie pas le modèle le plus cher pour découvrir ce qu'on nous demande",
  );
  assert.match(resultat.raison, /escaladera/, "et l'escalade montera si la Direction déclare l'ambiguïté");
});

test("une question vide ne fait pas planter l'aiguillage", () => {
  assert.equal(aiguiller("").agent, "executive");
  assert.equal(aiguiller("   ").complexite, "simple");
});

// ==================================================================
// 4. Les accents
// ==================================================================

test("« tresorerie » sans accent trouve la Finance, et « trésorerie » aussi", () => {
  assert.equal(aiguiller("comment va ma tresorerie").agent, "finance");
  assert.equal(aiguiller("comment va ma trésorerie").agent, "finance");
  assert.equal(aiguiller("COMMENT VA MA TRÉSORERIE").agent, "finance");
});

test("la normalisation retire les diacritiques et met en minuscules", () => {
  assert.equal(normaliser("Créance ÉCHUE"), "creance echue");
  assert.equal(normaliser("Où ça ?"), "ou ca ?");
  assert.equal(normaliser("déjà-vu"), "deja-vu");
});

test("la normalisation ne touche pas aux caractères ordinaires", () => {
  assert.equal(normaliser("chiffre d'affaires 2026"), "chiffre d'affaires 2026");
});
