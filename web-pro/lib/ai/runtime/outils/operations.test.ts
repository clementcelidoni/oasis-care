import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

import { OUTIL_OPERATIONS_SNAPSHOT } from "./operations.ts";
import { OasisAIToolRegistry, registreOutils } from "../tools.ts";
import { DEFINITIONS, AGENTS_CONSTRUITS } from "../agents/index.ts";
import type { Permission } from "../types.ts";

/**
 * §11Y — L'AGENT CHANTIERS ET SON OUTIL.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE TEST CONSTRUIT SON PROPRE REGISTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * `getOperationsSnapshot` n'est pas encore dans `runtime/tools.ts` :
 * ce fichier est PARTAGÉ, six agents s'écrivent en même temps, et c'est
 * l'intégration qui l'y versera. Un test qui attendrait ce moment ne
 * défendrait rien pendant l'intervalle exact où le travail est le plus
 * fragile.
 *
 * Il construit donc un registre à part — `new OasisAIToolRegistry([...])`,
 * le constructeur le permet — et lui applique les MÊMES invariants que
 * `tools.test.ts` applique au vrai. Le jour du versement, l'outil entre
 * dans un catalogue qui l'a déjà éprouvé.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET POURQUOI IL LIT LE SQL PLUTÔT QUE LA BASE
 * ══════════════════════════════════════════════════════════════════
 *
 * `tools.test.ts` relit les migrations pour refuser un outil dont la
 * fonction n'existe nulle part — « le défaut le plus silencieux de ce
 * travail ». La fonction de cet outil n'est pas encore en migration :
 * elle attend dans `outils/operations.sql`. Ce test pointe donc la même
 * vérification sur ce fichier-là, et il vérifie EN PLUS que le SQL
 * garde ses garanties — `ai_guard`, `security invoker`, le NULL qui
 * n'est pas un zéro. Un jour, quelqu'un simplifiera cette fonction de
 * bonne foi ; ces trois lignes-là ne doivent pas partir avec.
 *
 * La justesse des CHIFFRES, elle, ne se prouve pas ici : elle se prouve
 * contre une vraie base, et c'est `outils/operations.epreuve.sql` qui
 * le fait — 25 assertions jouées sur la production dans une transaction
 * annulée.
 */

/**
 * L'AIGUILLEUR, POUR DE VRAI. `aiguillage.ts` importe `DEFINITIONS`
 * par l'alias `@/`, que Node ignore : on charge le crochet écrit pour
 * ce cas, puis on importe en DYNAMIQUE (un import statique serait hissé
 * avant le crochet). C'est ce qui permet d'éprouver la question telle
 * qu'un paysagiste la tape, plutôt que la liste de mots-clés.
 */
register("../_test/alias.mjs", import.meta.url);
const { aiguiller } = await import("../../../../app/api/oasis-ai/aiguillage.ts");

const ici = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(ici, "operations.sql"), "utf8");
const epreuve = readFileSync(join(ici, "operations.epreuve.sql"), "utf8");

const OUTIL = OUTIL_OPERATIONS_SNAPSHOT;
const AGENT = DEFINITIONS.operations;

/** Tous les droits, pour isoler le filtre de PROPRIÉTÉ de celui des droits. */
const TOUS_LES_DROITS: Permission[] = [
  "clients.read",
  "clients.write",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.approve",
  "projects.read",
  "projects.manage",
  "digitalTwin.edit",
  "nursery.stock.manage",
  "invoice.create",
  "organization.manageUsers",
];

/**
 * Le registre du produit — L'OUTIL Y EST DÉSORMAIS.
 *
 * Cette fonction ajoutait l'outil au registre, parce qu'il n'y était
 * pas encore : ce fichier a été écrit avant l'intégration. Elle rend
 * maintenant le registre RÉEL, sans rien y ajouter, et c'est le seul
 * changement qui compte — tous les tests de propriété et de droits
 * ci-dessous portent désormais sur ce que le produit offre vraiment,
 * plus sur une simulation de ce qu'il offrirait.
 *
 * La fonction est conservée plutôt que remplacée partout : son nom dit
 * encore ce que le lecteur cherche, et un test qui vérifie que l'outil
 * est bien AU registre est juste en dessous.
 */
function registreAvecOutil(): OasisAIToolRegistry {
  return registreOutils();
}

// ==================================================================
// 1. L'OUTIL A BIEN UNE FONCTION DERRIÈRE, ET ELLE GARDE SES GARANTIES
// ==================================================================

test("la fonction déclarée par l'outil est définie dans le SQL qui l'accompagne", () => {
  const declarees = [
    ...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi),
  ].map((m) => m[1].toLowerCase());

  assert.ok(
    declarees.includes(String(OUTIL.rpc).toLowerCase()),
    "un outil déclaré sans fonction derrière ne casse rien : le modèle l'appelle de bonne foi, " +
      "et l'utilisateur lit « Oasis ne peut pas répondre » six semaines plus tard",
  );
});

test("le SQL exige le droit côté SERVEUR, et lève au lieu de rendre une vue partielle", () => {
  assert.match(
    sql,
    /perform\s+public\.ai_guard\(\s*p_organization_id,\s*'projects\.read'\s*\)/,
    "sans `ai_guard`, un droit manquant produirait une réponse amputée que rien ne signale",
  );
  assert.equal(OUTIL.permission, "projects.read", "l'outil doit annoncer le droit que le SQL exige");
});

test("le SQL est en lecture seule, et la RLS filtre en plus du garde", () => {
  assert.match(sql, /\bstable\b/, "une fonction de lecture se déclare `stable`");
  assert.match(
    sql,
    /security invoker/,
    "`security definer` contournerait la RLS : le garde deviendrait la seule barrière",
  );
  assert.match(sql, /set search_path = public/);

  for (const ecriture of ["insert into", "update ", "delete from", "truncate", "drop "]) {
    assert.ok(
      !sql.toLowerCase().includes(ecriture),
      `« ${ecriture} » dans une fonction de lecture : une question ne peut RIEN écrire`,
    );
  }
});

test("le compteur de retard vaut NULL, jamais zéro, quand aucune date n'existe", () => {
  // LA RAISON D'ÊTRE DE CETTE FONCTION. `ai_get_daily_priorities` rend
  // déjà une liste vide de « chantiersEnRetard » alors qu'elle veut
  // dire « aucune date de référence ». Si cette branche disparaissait,
  // cette fonction referait exactement le même mensonge.
  assert.match(
    sql,
    /v_en_retard\s*:=\s*null;/,
    "sans cette branche, un portefeuille sans dates rendrait « 0 en retard », qui se lit « tout va bien »",
  );
  assert.match(
    sql,
    /pas mesurable/,
    "le motif en français doit être produit par le SQL, pas laissé à la rédaction du modèle",
  );
  assert.match(
    sql,
    /'couverture',/,
    "sans le compte des chantiers et des phases datés, l'agent ne peut pas dire « 0 sur 1 »",
  );
});

test("la fenêtre est bornée : une question ne fait pas sortir tout l'historique", () => {
  assert.match(sql, /Fenêtre trop large/);
  assert.match(sql, /Période inversée/);
  assert.match(sql, /c_max constant int := 50/);
  assert.equal(
    OUTIL.maxElements,
    50,
    "l'élagage du contexte doit couper au même endroit que le SQL, sinon l'un des deux ment",
  );
});

test("l'épreuve SQL défend bien le NULL et le cloisonnement, pas seulement la forme", () => {
  // Un fichier d'épreuve peut se vider par accident lors d'une fusion.
  // On épingle ce qu'il doit contenir plutôt que son nombre de lignes.
  assert.match(epreuve, /rollback;/, "l'épreuve doit être sans effet de bord");
  assert.match(epreuve, /NULL, PAS zéro/);
  assert.match(epreuve, /la fonction appelée sur B est refusée/);
  assert.match(epreuve, /sans projects\.read, refus net/);
});

// ==================================================================
// 2. LE MODÈLE NE CHOISIT NI L'ENTREPRISE NI SES DROITS
// ==================================================================

function schemaJson(schema: z.ZodType): {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
} {
  return z.toJSONSchema(schema) as ReturnType<typeof schemaJson>;
}

test("le schéma n'expose ni organisation, ni utilisateur, ni droit", () => {
  const serialise = JSON.stringify(schemaJson(OUTIL.parametres));
  assert.ok(
    !serialise.includes("p_organization_id"),
    "un paramètre d'organisation exposé au modèle serait une organisation choisie par la question",
  );
  assert.ok(!serialise.includes("p_user_id"));
  assert.ok(!serialise.includes("permission"));
  assert.equal(OUTIL.injecteOrganisation, true, "c'est l'exécuteur qui pose l'organisation");
});

test("le schéma est compatible du mode strict : rien d'optionnel, rien en trop", () => {
  const schema = schemaJson(OUTIL.parametres);
  const clefs = Object.keys(schema.properties ?? {});
  assert.deepEqual(
    [...(schema.required ?? [])].sort(),
    [...clefs].sort(),
    "un paramètre facultatif s'écrit .nullable(), jamais .optional()",
  );
  assert.equal(schema.additionalProperties, false);
});

test("c'est une LECTURE : elle a un rpc, ne demande aucune confirmation, n'écrit rien", () => {
  assert.equal(OUTIL.famille, "lecture");
  assert.ok(OUTIL.rpc !== undefined);
  assert.equal(OUTIL.confirmationRequise, false, "une question ne peut rien écrire");
  assert.equal(OUTIL.actionType, undefined, "un actionType ferait de lui une action du catalogue");
  assert.equal(OUTIL.risque, "low");
});

// ==================================================================
// 3. LA MINIMISATION — l'outil n'appartient qu'à son agent
// ==================================================================

test("l'outil est au catalogue, et c'est CE fichier qui y est déclaré", () => {
  // L'INTÉGRATION A EU LIEU. Le test disait auparavant l'inverse — que
  // l'outil n'y était pas encore — et il avait raison à ce moment-là.
  //
  // Ce qu'il défend maintenant est plus fort que « il y est » : il
  // vérifie que le registre contient CET OBJET-CI (`===`), pas une
  // copie recopiée dans `tools.ts`. Une copie serait une seconde
  // vérité, et le jour où l'un des deux exemplaires est corrigé — une
  // permission, une borne, une phrase de description — c'est l'autre
  // qui partirait au modèle. `tools.ts` importe donc ce fichier ; il ne
  // le duplique pas, et ce test est ce qui l'y oblige.
  const inscrit = registreOutils().chercher(OUTIL.nom);
  assert.notEqual(inscrit, null, "`tools.ts` doit importer OUTIL_OPERATIONS_SNAPSHOT");
  assert.equal(
    inscrit,
    OUTIL,
    "le registre contient une COPIE de cet outil au lieu de cet outil : deux déclarations du " +
      "même nom finissent par diverger, et c'est celle du registre qui part au modèle.",
  );
});

test("les Chantiers le reçoivent, et personne d'autre", () => {
  const registre = registreAvecOutil();
  const chantiers = registre.pourAgent("operations", TOUS_LES_DROITS).map((o) => o.nom);
  assert.ok(chantiers.includes(OUTIL.nom));

  for (const autre of AGENTS_CONSTRUITS) {
    if (autre === "operations") continue;
    assert.ok(
      !registre.pourAgent(autre, TOUS_LES_DROITS).some((o) => o.nom === OUTIL.nom),
      `« ${autre} » verrait les chantiers d'une entreprise sans que ce soit sa mission`,
    );
  }
});

test("les trois outils transverses restent à sa portée : sans eux il part aveugle", () => {
  // Aucun écran ne transmet d'identifiant à cet agent. `searchEntities`
  // est donc son premier geste sur toute question qui nomme un chantier.
  const chantiers = registreAvecOutil().pourAgent("operations", TOUS_LES_DROITS).map((o) => o.nom);
  for (const transverse of ["searchEntities", "getProjectContext", "getClientContext"]) {
    assert.ok(chantiers.includes(transverse), `« ${transverse} » lui manque`);
  }
});

test("aucun outil d'écriture ne lui est accessible", () => {
  const outils = registreAvecOutil().pourAgent("operations", TOUS_LES_DROITS);
  for (const outil of outils) {
    assert.equal(
      outil.famille,
      "lecture",
      `« ${outil.nom} » permettrait aux Chantiers d'écrire : ses limites disent qu'il n'écrit rien`,
    );
  }
});

test("sans projects.read l'outil n'est pas proposé, et le droit manquant se NOMME", () => {
  const registre = registreAvecOutil();
  const offerts = registre.pourAgent("operations", ["clients.read"]).map((o) => o.nom);
  assert.ok(!offerts.includes(OUTIL.nom), "un outil offert puis refusé coûte un aller-retour de jetons");

  const refuses = registre.refusesPourAgent("operations", ["clients.read"]);
  assert.ok(
    refuses.some((r) => r.outil === OUTIL.nom && r.permission === "projects.read"),
    "on doit pouvoir DIRE quel droit manque, pas seulement masquer l'outil",
  );
});

// ==================================================================
// 4. L'HONNÊTETÉ DE L'AGENT — ce qu'il doit refuser, il le porte
// ==================================================================

test("l'agent n'est plus un gabarit, et il a de quoi le prouver", () => {
  assert.equal(
    AGENT.aCompleter,
    undefined,
    "un agent donné pour achevé doit avoir ses limites, ses mots-clés et une source à lui",
  );
  assert.ok(AGENT.limites.length >= 5);
  assert.ok((AGENT.motsCles ?? []).length > 0);
});

test("chaque limite dit une chose précise, pas « il fait attention »", () => {
  for (const limite of AGENT.limites) {
    assert.ok(
      limite.length > 60,
      `« ${limite} » : une limite trop courte ne dit pas CE QUE l'agent ne sait pas`,
    );
  }
});

test("les quatre refus mesurés par le sondage sont réellement écrits", () => {
  // Ce ne sont pas des mots-clés décoratifs : chacun correspond à un
  // trou COMPTÉ en production. S'ils disparaissent des limites, ils
  // disparaissent des instructions envoyées au modèle — et l'agent
  // recommence à répondre « aucun retard » sur un portefeuille sans
  // dates.
  const texte = AGENT.limites.join(" ").toLowerCase();
  for (const [sujet, motif] of [
    ["le retard non mesurable", /retard\.enretard.*null|null.*aucune date de fin/],
    ["les heures prévues", /heures prévues/],
    ["la capacité des équipes", /capacité|effectif/],
    ["l'argent, qui est à la Finance", /marge|budget/],
    ["le temps de trajet", /trajet/],
  ] as const) {
    assert.match(texte, motif, `${sujet} n'est plus refusé dans les limites`);
  }
});

test("il n'écrit rien, et sa première limite le dit avant tout le reste", () => {
  assert.match(AGENT.limites[0], /N'écrit rien/);
});

// ==================================================================
// 5. L'AIGUILLAGE — les mots qu'il prend, et les deux qu'il refuse
// ==================================================================

test("« retard » NU n'est pas un de ses mots : il volerait « facture en retard »", () => {
  // La Facturation est essayée AVANT lui et attrape « factur », donc
  // « facture en retard » lui échappe. Mais un « retard » nu prendrait
  // tout le reste — « retard de paiement », « relance en retard ».
  // « chantier » suffit à faire venir « quels chantiers sont en retard ».
  for (const mot of AGENT.motsCles ?? []) {
    assert.notEqual(mot.trim().toLowerCase(), "retard");
  }
  assert.ok((AGENT.motsCles ?? []).includes("chantier"));
});

test("il ne prend aucun mot du Planning, qui est essayé avant lui", () => {
  const siens = (AGENT.motsCles ?? []).map((m) => m.toLowerCase());
  for (const vole of ["planning", "planifi", "semaine", "équipe"]) {
    assert.ok(
      !siens.includes(vole),
      `« ${vole} » appartient au Planning ou à personne : le prendre le rendrait inatteignable`,
    );
  }
});

test("les questions d'un paysagiste arrivent bien chez lui, une par une", () => {
  // Une liste de mots-clés se relit très bien en paraissant complète.
  // Seule la question réelle dit si l'agent est atteint — et un agent
  // qu'on n'atteint pas est le défaut exact que ce produit vient de
  // corriger ailleurs.
  for (const question of [
    "Où en est le chantier CH-2026-0001 ?",
    "Quels chantiers sont en retard ?",
    "Combien d'heures ont été pointées sur ce chantier ?",
    "Reste-t-il des pointages à valider ?",
    "Quel est l'avancement des travaux ?",
    "Cette intervention a-t-elle dérapé ?",
  ]) {
    assert.equal(aiguiller(question, null).agent, "operations", `« ${question} »`);
  }
});

test("il ne vole ni la Facturation, ni le Planning, ni le chiffrage", () => {
  // « facture en retard » est le cas historique : la Facturation est
  // essayée AVANT lui et attrape « factur ». C'est cette précédence-là
  // qui autorise les Chantiers à prendre « chantier ».
  for (const [question, attendu] of [
    ["Ai-je des factures en retard ?", "billing"],
    ["Quels devis dois-je relancer ?", "quotePricing"],
    ["Qu'est-ce qui est posé la semaine prochaine ?", "planning"],
    ["Pose une intervention mardi pour l'équipe 1", "planning"],
    ["Quelle est ma trésorerie ?", "finance"],
  ] as const) {
    assert.equal(aiguiller(question, null).agent, attendu, `« ${question} »`);
  }
});

test("« la marge du chantier » va bien à la Finance, et la limite reste utile", () => {
  // ══════════════════════════════════════════════════════════════
  // LA COLLISION A ÉTÉ TRANCHÉE, ET DANS L'AUTRE SENS
  // ══════════════════════════════════════════════════════════════
  //
  // Ce test épinglait l'état inverse : l'ORDRE de `aiguillage.ts`
  // essayait les Chantiers AVANT la Finance, « la marge du chantier »
  // tombait donc ici, et son auteur avait écrit noir sur blanc que le
  // jour où l'intégration déplacerait la Finance, le test tomberait.
  // Il est tombé, l'intégration l'a fait, et voici pourquoi.
  //
  // Le mot « chantier » est plus précis que « marge », donc l'ordre de
  // départ suivait la règle habituelle. Mais la règle habituelle est un
  // raccourci pour la vraie : QUI A LA SOURCE. La Finance possède
  // `analyzeProjectMargin`, un outil qui rend la marge d'UN chantier
  // désigné ; les Chantiers n'ont aucun chiffre d'argent et leur
  // instruction leur ordonne de renvoyer. Ce n'était donc pas un
  // arbitrage entre deux bonnes réponses, c'était le choix de la
  // mauvaise — payée au prix d'un appel de modèle.
  //
  // L'agent Chantiers reste parfaitement atteignable : « chantier » ne
  // lui est pas retiré, il ne perd que les questions qui portent EN
  // PLUS un mot d'argent.
  assert.equal(aiguiller("Quelle est la marge du chantier CH-2026-0001 ?", null).agent, "finance");
  assert.equal(aiguiller("Où en est le chantier CH-2026-0001 ?", null).agent, "operations");

  // LA LIMITE RESTE, ET ELLE N'EST PAS DEVENUE INUTILE. L'aiguillage ne
  // protège que la PREMIÈRE question ; rien n'empêche un utilisateur de
  // demander la marge au milieu d'une conversation déjà ouverte avec
  // les Chantiers, ni la Direction de leur déléguer. La limite est ce
  // qui répond dans ces deux cas-là.
  assert.match(
    AGENT.limites.join(" "),
    // `[\s\S]` plutôt que le drapeau `s` : la cible TypeScript de ce
    // dépôt est antérieure à es2018, et `tsc` refuse ce drapeau.
    /marge[\s\S]*Finance|Finance[\s\S]*marge/,
    "l'aiguillage ne couvre que la première question : la limite doit rester",
  );
});

test("aucun de ses mots n'est déjà revendiqué par un autre agent", () => {
  // `agents/index.test.ts` tient déjà cette règle sur les dix. On la
  // rejoue ici parce qu'un mot ajouté DANS CE FICHIER est la seule
  // façon de la casser, et qu'un échec doit pointer le bon fichier.
  const siens = new Set((AGENT.motsCles ?? []).map((m) => m.trim().toLowerCase()));
  for (const cle of AGENTS_CONSTRUITS) {
    if (cle === "operations") continue;
    for (const mot of DEFINITIONS[cle].motsCles ?? []) {
      assert.ok(
        !siens.has(mot.trim().toLowerCase()),
        `« ${mot} » est revendiqué par « ${cle} » et par les Chantiers`,
      );
    }
  }
});

// ==================================================================
// 6. CE QUE LA DESCRIPTION DIT AU MODÈLE
// ==================================================================

test("la description avertit du piège avant que le modèle ne tombe dedans", () => {
  // La description est le SEUL texte que le modèle lit avant de choisir
  // d'appeler l'outil. Si elle ne dit pas que « enRetard » peut valoir
  // null, il lira le null comme un zéro.
  assert.match(OUTIL.description, /enRetard/);
  assert.match(OUTIL.description, /null/);
  assert.match(OUTIL.description, /nonMesurable/);
  assert.match(OUTIL.description, /Finance/, "l'argent doit être renvoyé explicitement ailleurs");
});

test("il n'annonce que les grandeurs qu'il apporte vraiment", () => {
  assert.deepEqual([...OUTIL.fournit], ["heures"]);
  for (const jamais of ["marge", "prix", "chiffreAffaires", "totalFacture"] as const) {
    assert.ok(
      !OUTIL.fournit.includes(jamais),
      `« ${jamais} » déclaré ici ferait croire qu'un second service le calcule`,
    );
  }
});
