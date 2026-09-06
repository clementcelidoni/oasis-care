import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AGENT_RISQUES, MOTS_CLES_RISQUES } from "./risk.ts";
import {
  AGENTS_CONSTRUITS,
  DEFINITIONS,
  estAgentSansDonnees,
  type DefinitionAgent,
} from "./index.ts";
import { registreOutils } from "../tools.ts";
import { OUTIL_RISK_SNAPSHOT } from "../outils/risk.ts";

/**
 * §11Z — L'AGENT RISQUES, ET LA SEULE LIGNE QU'IL NE DOIT PAS FRANCHIR.
 *
 * ══════════════════════════════════════════════════════════════════
 * MESURÉ CONTRE DÉDUIT : COMMENT ON TESTE ÇA SANS APPELER UN MODÈLE
 * ══════════════════════════════════════════════════════════════════
 *
 * On ne peut pas vérifier ici qu'un modèle annonce ses déductions : il
 * faudrait l'appeler, donc écrire un test qui coûte de l'argent et qui
 * échoue au hasard. Ce n'est pas une excuse, c'est le cadrage du
 * problème — et il reste trois choses vérifiables, qui sont ensemble la
 * protection réelle :
 *
 *   1. LA RÈGLE EST DONNÉE, dans les limites qui partent mot pour mot
 *      au modèle, avec la formulation exacte attendue des deux côtés.
 *   2. LA RÈGLE EST DANS LA DONNÉE, pas seulement dans le prompt :
 *      chaque bloc de `ai_risk_snapshot` porte son étiquette. C'est
 *      tenu par `outils/risk.test.ts`.
 *   3. LA SOURCE NE PARLE JAMAIS ELLE-MÊME AU FUTUR. Un modèle recopie
 *      le registre de ce qu'il lit : si la fonction écrivait « ce
 *      client va probablement payer en retard », l'agent le répéterait
 *      en le prenant pour une mesure — et il aurait raison de le
 *      croire, puisque cela viendrait d'un champ. C'est le test le plus
 *      utile du fichier, et il est ci-dessous.
 */

const limites = AGENT_RISQUES.limites.join("\n").toLowerCase();
const mission = AGENT_RISQUES.mission.toLowerCase();

/** Les définitions vues sans le type, parce que `risk` n'y est pas encore. */
const definitions = DEFINITIONS as unknown as Record<string, DefinitionAgent | undefined>;

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

/**
 * Le corps de `ai_risk_snapshot`, lu COMME POSTGRES LE LIT.
 *
 * Apostrophes dédoublées, et surtout littéraux concaténés RECOLLÉS. Ce
 * second point n'est pas cosmétique ici : le balayage du « registre de
 * la déduction » plus bas cherche des tournures dans le texte rendu, et
 * une phrase écrite à cheval sur un `' || '` lui échapperait. Postgres
 * rend une phrase entière ; le test doit voir la même.
 */
function corpsFonction(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  const sql = readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n")
    .replaceAll("''", "'")
    .replace(/'\s*\|\|\s*'/g, "");
  const debut = sql.indexOf("create or replace function public.ai_risk_snapshot(");
  assert.notEqual(debut, -1, "`ai_risk_snapshot` n'est définie dans aucune migration");
  const fin = sql.indexOf("comment on function public.ai_risk_snapshot", debut);
  return sql.slice(debut, fin);
}

// ==================================================================
// 1. MESURÉ CONTRE DÉDUIT
// ==================================================================

test("la distinction est posée dès la MISSION, pas reléguée dans une limite", () => {
  // La mission sert de `handoffDescription` : c'est ce que la Direction
  // lit avant de l'interroger, et ce qu'elle croira de sa réponse.
  assert.ok(mission.includes("mesure"), "la mission ne dit pas ce qu'il mesure");
  assert.ok(mission.includes("déduit"), "la mission ne dit pas qu'il déduit aussi");
});

test("la règle donne les DEUX formulations, pas seulement l'interdiction", () => {
  // Une règle qui dit « ne confonds pas » sans donner la forme attendue
  // laisse le modèle inventer la sienne, et il inventera la plus fluide
  // — donc celle qui efface la distinction.
  assert.ok(limites.includes("je mesure"), "la formulation d'une mesure n'est pas donnée");
  assert.ok(limites.includes("j'en déduis"), "la formulation d'une déduction n'est pas donnée");
  assert.ok(
    limites.includes("sans certitude"),
    "rien n'oblige la déduction à s'annoncer incertaine",
  );
  assert.ok(
    limites.includes("cite le fait mesuré qui la porte"),
    "une déduction sans fait à l'appui est une opinion présentée comme une analyse",
  );
});

test("le sens de l'erreur est nommé : c'est la déduction prise pour une mesure", () => {
  // Les deux confusions ne sont pas symétriques. Présenter une mesure
  // comme une déduction fait perdre de l'information ; présenter une
  // déduction comme une mesure fait agir sur du vent. C'est la seconde
  // qu'il faut nommer, et la nommer par son nom.
  assert.ok(
    limites.includes("une déduction présentée comme une mesure"),
    "l'erreur à éviter n'est pas nommée dans le bon sens",
  );
});

/**
 * LE TEST QUI VAUT LE PLUS : LA SOURCE NE PARLE PAS AU FUTUR.
 *
 * Un modèle recopie le registre de ce qu'il lit. Si la fonction
 * écrivait elle-même « ce client va probablement payer en retard »,
 * l'agent le répéterait comme un relevé — et il aurait raison, puisque
 * cela viendrait d'un champ de la réponse.
 *
 * Ce test balaie donc TOUT le texte que la fonction rend, à la
 * recherche du vocabulaire de la prédiction. Il ne dépend d'aucune
 * formulation exacte : il attrapera une phrase écrite dans six mois par
 * quelqu'un qui n'aura pas lu ce fichier.
 */
test("aucune phrase rendue par la fonction n'est écrite au registre de la déduction", () => {
  const corps = corpsFonction().toLowerCase();

  // LA SEULE EXCEPTION, ET ELLE EST NOMMÉE. « tout va bien » figure
  // dans l'explication de la phrase INTERDITE : c'est la citation d'un
  // contresens, pas une affirmation. La retirer affaiblirait le refus.
  const sansCitations = corps.replaceAll(
    "elle serait comprise comme « tout va bien »",
    "«citation retirée par le test»",
  );

  const REGISTRE_DE_LA_DEDUCTION = [
    "probablement",
    "sans doute",
    "il est probable",
    "on peut penser",
    "devrait payer",
    "devrait finir",
    "risque fort",
    "va payer",
    "va finir",
    "tout va bien",
  ];

  for (const tournure of REGISTRE_DE_LA_DEDUCTION) {
    assert.ok(
      !sansCitations.includes(tournure),
      `« ${tournure} » est écrit dans ce que rend ai_risk_snapshot. Le modèle le lira comme ` +
        "un champ, donc comme une mesure, et le répétera avec l'assurance d'un compteur. " +
        "Une prédiction n'a pas sa place dans une fonction qui ne rend que des mesures.",
    );
  }
});

test("la phrase « aucun risque détecté » est interdite dans les limites ET dans la donnée", () => {
  // Deux endroits parce qu'ils ne tombent pas ensemble : un réglage qui
  // cesserait d'injecter les limites n'emporterait pas l'interdiction
  // portée par la fonction.
  assert.ok(limites.includes("aucun risque détecté"));
  assert.ok(limites.includes("en toutes lettres"));
  assert.ok(
    limites.includes("tout va bien"),
    "la limite ne dit pas comment la phrase sera COMPRISE : elle se lira comme un scrupule",
  );
  assert.match(corpsFonction(), /'phraseInterdite', 'Aucun risque détecté'/);
});

test("ni score, ni note, ni feu tricolore, ni probabilité chiffrée", () => {
  // Un score mélange mesures et déductions dans un seul nombre et fait
  // disparaître exactement la distinction que cet agent existe pour
  // tenir. Les quatre formes sont nommées séparément parce qu'un modèle
  // à qui l'on interdit « le score » propose « une note sur dix ».
  assert.ok(limites.includes("score"));
  assert.ok(limites.includes("note"));
  assert.ok(limites.includes("feu tricolore"));
  assert.ok(limites.includes("niveau de risque global"));
  assert.ok(limites.includes("probabilité"));
  assert.ok(
    limites.includes("la forme la plus convaincante d'un chiffre faux"),
    "l'interdiction de la probabilité n'explique pas pourquoi elle est dangereuse",
  );
});

// ==================================================================
// 2. LE SEUIL, ET LE SILENCE QUI VA AVEC
// ==================================================================

test("sous le seuil, il rend les lignes et se tait sur le verdict", () => {
  assert.ok(limites.includes("ne conclut rien"));
  assert.ok(limites.includes("motif du refus"));
  assert.ok(
    limites.includes("anecdote présentée comme une statistique"),
    "le motif du refus n'explique pas ce qui ne va pas avec un taux sur quelques lignes",
  );
});

test("le seuil n'est écrit nulle part dans les limites : il est appliqué par le SQL", () => {
  // Un seuil recopié dans une limite est un second seuil, et c'est
  // toujours le second qui ment. Celui-ci est une constante SQL, et le
  // modèle reçoit le refus déjà pris.
  for (const limite of AGENT_RISQUES.limites) {
    assert.ok(
      !/\d/.test(limite),
      `une limite des Risques porte un chiffre et vieillira sans prévenir : « ${limite} »`,
    );
  }
  assert.match(corpsFonction(), /c_seuil_obs\s+constant int := 12;/);
});

// ==================================================================
// 3. LES TABLES VIDES — L'ÉTAT ACTUEL, DONC LE PREMIER CAS RENCONTRÉ
// ==================================================================

test("zéro facture en retard n'est pas « les clients paient »", () => {
  // Mesuré au jour de l'écriture : les deux factures de cette base
  // échoient fin septembre. Zéro échu ne dit rien du comportement des
  // clients — il dit que rien n'est encore exigible.
  assert.ok(limites.includes("rien n'est encore exigible"));
  assert.ok(limites.includes("échéances à venir"));
});

test("zéro règlement enregistré n'est pas « zéro retard de paiement »", () => {
  // C'est la confusion zéro / je-ne-sais-pas, déjà corrigée quatre fois
  // dans ce produit. Ici elle a une conséquence directe et énonçable :
  // sans règlement enregistré, impayée et payée-hors-logiciel sont
  // indistinguables.
  assert.ok(limites.includes("payée hors logiciel"));
  assert.ok(limites.includes("zéro retard de paiement"));
});

test("aucune date de fin prévue veut dire « aucune référence », pas « aucun retard »", () => {
  assert.ok(limites.includes("aucune référence"));
  assert.ok(limites.includes("aucun retard"));
  assert.ok(
    limites.includes("défaut de saisie réparable"),
    "sans cela, le dirigeant croira que le produit ne sait pas suivre les délais",
  );
});

test("la cascade est refusée pour ABSENCE DE SCHÉMA, pas pour tables vides", () => {
  // La différence décide de la suite. « Pas encore assez de données »
  // appelle « attendons » ; « la fonctionnalité n'existe pas » appelle
  // « décidons si on la construit ». Et le refus est vérifié sur le
  // schéma à chaque appel, donc il se périmera tout seul.
  assert.ok(limites.includes("fonctionnalité absente"));
  assert.ok(limites.includes("donnée manquante"));
  assert.ok(limites.includes("quand les tables se rempliront"));
  assert.ok(limites.includes("vérifie sur le schéma à chaque appel"));
});

// ==================================================================
// 4. LES DOUBLONS QU'IL NE CRÉE PAS
// ==================================================================

test("les factures échues sont lues chez la Facturation, jamais recomptées", () => {
  assert.ok(limites.includes("ne recompte pas les factures échues"));
  assert.ok(
    limites.includes("finiraient par différer"),
    "la limite ne dit pas POURQUOI un second compte est un défaut : elle se lira comme un partage de tâches",
  );
  assert.match(corpsFonction(), /v_bill := public\.ai_billing_candidates\(p_organization_id\);/);
});

test("marge, fiche client, parc et devis sont renvoyés à leurs propriétaires", () => {
  assert.ok(limites.includes("à la finance"));
  assert.ok(limites.includes("fiche client"));
  assert.ok(limites.includes("matériel"));
  assert.ok(limites.includes("chiffrage"));
});

test("la concentration est un ratio : ni euro, ni nom de client", () => {
  // Le montant appartient à la Finance et la fiche à l'agent Clients.
  // C'est ce découpage qui empêche le doublon avec
  // `ai_finance_margin_breakdown(dimension := 'client')`, qui rend la
  // MARGE des chantiers terminés — une autre population, une autre
  // sortie.
  assert.ok(limites.includes("ne nomme aucun client"));
  assert.ok(limites.includes("aucun euro"));
  assert.ok(limites.includes("ratio"));
});

test("c'est une mission de lecture, et son seul outil est une lecture", () => {
  assert.ok(limites.includes("n'écrit rien"));
  assert.ok(limites.includes("ne relance personne"));
  assert.equal(OUTIL_RISK_SNAPSHOT.famille, "lecture");
  assert.equal(OUTIL_RISK_SNAPSHOT.agent, AGENT_RISQUES.cle);
});

test("les trois droits attendus sont ceux que la fonction exige avant de lire", () => {
  assert.deepEqual(
    [...AGENT_RISQUES.droitsAttendus],
    ["projects.read", "invoice.create", "quotes.read"],
    "les droits attendus ne sont plus ceux d'ai_billing_candidates, qu'elle appelle",
  );
  assert.ok(
    AGENT_RISQUES.droitsAttendus.includes(OUTIL_RISK_SNAPSHOT.permission as "invoice.create"),
    "l'outil déclare un droit que l'agent n'attend pas : l'un des deux ment",
  );
});

// ==================================================================
// 5. LES MOTS-CLÉS, ET CEUX QU'IL NE PREND PAS
// ==================================================================

test("aucun mot n'est déjà revendiqué par l'un des douze autres agents", () => {
  const pris = new Map<string, string>();
  for (const cle of AGENTS_CONSTRUITS) {
    // §11Z, INTÉGRATION — SA PROPRE CLÉ EST EXCLUE, ET C'EST LA SEULE
    // CHOSE QUI CHANGE. Ce test a été écrit avant que « risk » soit
    // composé dans `DEFINITIONS` ; il l'y trouve désormais et se
    // comparerait à lui-même. La garantie est inchangée — « aucun AUTRE
    // agent ne revendique mes mots » — mais elle cesse d'être un
    // contrôle jetable d'avant fusion : elle attrapera le prochain
    // agent qui viendrait poser un de ces mots chez lui.
    if (cle === "risk") continue;
    for (const mot of definitions[cle]?.motsCles ?? []) {
      pris.set(normaliser(mot), cle);
    }
  }
  for (const mot of MOTS_CLES_RISQUES) {
    const deja = pris.get(normaliser(mot));
    assert.equal(deja, undefined, `« ${mot} » est déjà revendiqué par « ${deja} »`);
  }
});

test("les quatre mots que d'autres détiennent restent à eux", () => {
  // Chacun a une source ailleurs, et cet agent n'a que le droit de la
  // lire. Les lui donner remplacerait un agent qui répond par un agent
  // qui décline poliment, après avoir fait payer l'appel de modèle.
  const mots: readonly string[] = MOTS_CLES_RISQUES;
  for (const vole of ["impay", "marge", "chantier", "retard"]) {
    assert.ok(
      !mots.includes(vole),
      `« ${vole} » appartient à un agent qui détient le chiffre : le prendre ferait un doublon`,
    );
  }
});

test("« depend » ne mord pas sur « dépense », qui est à la Finance", () => {
  // L'aiguillage compare des sous-chaînes sur une question normalisée,
  // accents retirés : « dépense » devient « depense ». Les deux chaînes
  // divergent à la sixième lettre, et ce test le vérifie plutôt que de
  // le supposer — c'est exactement la classe de collision qui a déjà
  // fait remonter la Finance dans l'ORDRE.
  assert.ok(MOTS_CLES_RISQUES.includes("depend"));
  for (const question of [
    "quelles sont mes dépenses du mois",
    "mes dépenses de pépinière",
    "je veux réduire mes dépenses",
  ]) {
    assert.ok(
      !normaliser(question).includes("depend"),
      `« ${question} » serait volée à la Finance par le mot « depend »`,
    );
  }
  // Et il attrape bien ce pour quoi il est écrit.
  for (const question of [
    "suis-je trop dépendant d'un client",
    "quelle est ma dépendance à ce client",
  ]) {
    assert.ok(normaliser(question).includes("depend"), `« ${question} » n'atteint pas les Risques`);
  }
});

test("« concentration » empiète sur le mot des Clients par le SENS, pas par la lettre", () => {
  // « quelle est ma concentration client » contient à la fois
  // « concentration » et « client ». Le mot des Risques est le plus
  // précis, mais la précision ne décide de rien : c'est la PLACE dans
  // l'ORDRE d'`aiguillage.ts` qui tranche, et cet agent doit donc être
  // essayé AVANT `customer`. Sans ce placement, l'agent Clients
  // attrape la question et la refuse par sa limite « aucune phrase de
  // portefeuille » — un appel de modèle payé pour un refus.
  const question = normaliser("quelle est ma concentration client");
  assert.ok(question.includes("concentration"), "le mot des Risques est bien dans la question");
  const motsClients = (definitions["customer"]?.motsCles ?? []).map(normaliser);
  assert.ok(
    motsClients.some((m) => question.includes(m)),
    "les Clients ne revendiquent plus ce mot : relire la place de risk dans ORDRE",
  );
});

test("aucune entrée morte dans la liste", () => {
  const mots = MOTS_CLES_RISQUES.map(normaliser);
  for (const mot of mots) {
    for (const autre of mots) {
      if (mot === autre) continue;
      assert.ok(!mot.includes(autre), `« ${mot} » contient « ${autre} » : il ne gagnera jamais`);
    }
  }
});

// ==================================================================
// 6. L'INTÉGRATION — LE TEST CHANGE DE CAMP TOUT SEUL
// ==================================================================

test("tant que risk n'est pas dans la liste des construits, il n'est ni double ni oublié", () => {
  const construit = (AGENTS_CONSTRUITS as readonly string[]).includes("risk");

  if (!construit) {
    // ÉTAT ATTENDU AUJOURD'HUI : `agents/types.ts`, `agents/index.ts`,
    // `agents/sansDonnees.ts` et `runtime/tools.ts` sont PARTAGÉS.
    assert.equal(definitions["risk"], undefined);
    assert.ok(
      estAgentSansDonnees("risk"),
      "risk n'est ni construit ni déclaré sans données : il est introuvable, " +
        "et un agent introuvable est indiscernable d'un agent oublié",
    );
    return;
  }

  // `aCompleter` est LU D'ABORD, sur la définition composée : `satisfies`
  // conserve le type littéral de l'objet écrit, où la propriété est
  // absente — donc illisible — et la lire après l'égalité ci-dessous la
  // rendrait illisible aussi, TypeScript ayant rétréci le type à celui
  // de la constante.
  const enConstruction = definitions["risk"]?.aCompleter === true;

  assert.equal(
    definitions["risk"],
    AGENT_RISQUES,
    "risk est déclaré construit mais l'index compose une autre définition",
  );
  assert.equal(
    estAgentSansDonnees("risk"),
    false,
    "risk est construit ET encore déclaré sans données : l'écran dira les deux",
  );
  assert.equal(
    enConstruction,
    false,
    "l'écran des réglages affichera « en construction » sur un agent prêt",
  );
  assert.notEqual(
    registreOutils().chercher(OUTIL_RISK_SNAPSHOT.nom),
    null,
    "risk est construit mais getRiskSnapshot n'est au catalogue nulle part : " +
      "l'agent parlerait de risques sans jamais rien mesurer",
  );
});

/** La normalisation d'`aiguillage.ts`, recopiée pour ne pas importer une route dans un test de définition. */
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "");
}
