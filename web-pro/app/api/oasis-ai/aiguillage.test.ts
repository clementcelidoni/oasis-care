import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * POURQUOI UN `register()` ET UN IMPORT DYNAMIQUE DEPUIS §11Y.
 *
 * `aiguillage.ts` n'importait qu'un TYPE de `@/lib/ai/runtime`, et un
 * type s'efface au dépouillement : Node n'avait rien à résoudre. Il en
 * importe maintenant une VALEUR — `DEFINITIONS`, d'où il tire les
 * mots-clés de chaque agent au lieu de les recopier —, et `@/` est un
 * alias de `tsconfig.json` que Node ignore.
 *
 * On emploie le crochet déjà écrit pour ce cas exact
 * (`lib/ai/runtime/_test/alias.mjs`, voir son en-tête) plutôt que
 * d'inventer un second mécanisme. L'import doit être DYNAMIQUE : un
 * import statique est hissé avant l'exécution de la première ligne,
 * donc avant que le crochet existe.
 */
register("../../../lib/ai/runtime/_test/alias.mjs", import.meta.url);

const { aiguiller, normaliser } = await import("./aiguillage.ts");

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
// 2 bis. LES SIX AGENTS DE §11Y — CE QU'ILS PRENNENT, ET CE QU'ILS
//        NE DOIVENT PAS PRENDRE
// ==================================================================
//
// Cette section existe à cause d'une régression réelle, et elle est
// écrite pour qu'elle ne puisse pas revenir en silence.
//
// Quand six agents muets ont reçu leurs mots-clés d'un coup, l'ordre
// d'aiguillage s'est retourné sans que rien ne casse : des questions
// d'argent qui allaient à la Finance sont parties aux Chantiers et à la
// Pépinière — deux agents qui refusent l'argent par une limite
// explicite. Aucun test ne couvrait ces formulations, donc la suite est
// restée verte pendant que le produit répondait moins bien qu'avant.
//
// Une liste de mots-clés se relit très bien en paraissant complète.
// Seule la QUESTION RÉELLE, passée à `aiguiller()`, dit où elle tombe.

test("une question d'argent va à la Finance, même quand elle nomme un chantier", () => {
  // LE CRITÈRE EST « QUI A LA SOURCE ». Aucun autre agent n'agrège
  // d'argent ; la Finance possède `getCompanyMetrics`,
  // `getMarginBreakdown` et `analyzeProjectMargin` — dont le dernier
  // répond précisément à « la marge de CE chantier ».
  for (const question of [
    "Où en est ma trésorerie ?",
    "Où en est mon chiffre d'affaires ?",
    "Où en est ma marge globale",
    "Quelle rentabilité sur ce chantier ?",
    "Quelle est la marge du chantier Dupont ?",
    "Mes dépenses de pépinière",
  ]) {
    assert.equal(
      aiguiller(question).agent,
      "finance",
      `« ${question} » part à un agent qui refuse l'argent par une limite : on paie un appel ` +
        "de modèle pour recevoir un renvoi vers la Finance",
    );
  }
});

test("« où en est » n'aiguille rien toute seule : ce n'est pas un mot de métier", () => {
  // C'est une AMORCE DE PHRASE. Tant qu'elle était un mot-clé des
  // Chantiers, elle attrapait tout ce qui la suivait. Retirée, la
  // question tombe sur le mot qui la suit — ou sur la Direction.
  assert.equal(aiguiller("Où en est le chantier Mairie ?").agent, "operations");
  assert.equal(aiguiller("Où en est ma trésorerie ?").agent, "finance");
  assert.equal(aiguiller("Où en est mon stock de cycas ?").agent, "nursery");
  assert.equal(
    aiguiller("Où en est tout ça ?").agent,
    "executive",
    "sans mot de métier, la question doit aller à la Direction, qui ira demander",
  );
});

test("chacun des cinq agents outillés est atteint par sa question la plus ordinaire", () => {
  // La question qu'un paysagiste pose vraiment, agent par agent. Un
  // agent construit que personne n'atteint est un agent qui n'existe
  // pas : sa question part à la Direction, dont le plan ne contient
  // aucune de ses sources, et qui répond « je ne vois rien » avec
  // aplomb. C'est la panne la plus silencieuse de tout ce dispositif.
  const attendus: readonly [string, string][] = [
    ["Quels chantiers sont en retard ?", "operations"],
    ["Qu'est-ce qui est posé la semaine prochaine ?", "planning"],
    ["Combien de cycas j'ai en stock ?", "nursery"],
    ["Quel est le contrôle technique du camion ?", "fleet"],
    ["Combien ce client m'a rapporté ?", "customer"],
  ];
  for (const [question, agent] of attendus) {
    assert.equal(aiguiller(question).agent, agent, `« ${question} » n'atteint pas « ${agent} »`);
  }
});

test("les Achats restent inatteignables tant qu'ils n'ont rien à lire", () => {
  // L'agent Achats est un GABARIT : ses trois volets — fournisseurs,
  // commandes, besoins — comptent zéro ligne en production, et il n'a
  // aucun outil de lecture. Il n'a donc aucun mot-clé, et sa question
  // doit tomber à la Direction plutôt que sur lui.
  //
  // Ce n'est pas un manque à combler « pendant qu'on y est » : allumé,
  // il paierait un raisonnement complet pour rendre une phrase polie.
  assert.equal(aiguiller("Que dois-je commander ?").agent, "executive");
  assert.equal(aiguiller("Quels sont mes fournisseurs ?").agent, "executive");
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
