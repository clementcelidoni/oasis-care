import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

import { OUTIL_PLANNING_SUMMARY } from "./planning.ts";
import { OUTILS_SPEC_SANS_SERVICE, OasisAIToolRegistry, registreOutils } from "../tools.ts";
import { DEFINITIONS, AGENTS_CONSTRUITS } from "../agents/index.ts";
import type { Permission } from "../types.ts";

/**
 * §11Y — L'AGENT PLANNING, SON OUTIL, ET LA RÈGLE QU'IL PORTE DEUX FOIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER DÉFEND EN PREMIER
 * ══════════════════════════════════════════════════════════════════
 *
 * `chargeDuJour` (lib/field/types.ts) est la SEULE définition arbitrée
 * de « combien d'heures cette journée pèse-t-elle », et elle a été
 * écrite après un bug réel : « le mardi s'annonçait 2 · 32 h, faux d'un
 * facteur trois ». Le modèle ne peut pas appeler du TypeScript.
 * `ai_planning_summary` porte donc la même règle une SECONDE fois, en
 * SQL — et deux copies d'une règle, c'est deux comportements le jour où
 * l'une est corrigée.
 *
 * Ce test épingle les deux côtés l'un contre l'autre : il relit la
 * version TypeScript et vérifie qu'elle dit encore ce que la version
 * SQL suppose. Le jour où quelqu'un décide, à l'écran, qu'un jour
 * intermédiaire vaut huit heures forfaitaires, ce test tombe — et c'est
 * exactement le moment où il faut que quelqu'un regarde le SQL.
 *
 * La justesse des CHIFFRES se prouve ailleurs, contre une vraie base :
 * `outils/planning.epreuve.sql`, 36 assertions jouées sur la production
 * dans une transaction annulée, dont le cas exact du bug d'origine.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET POURQUOI UN REGISTRE À PART
 * ══════════════════════════════════════════════════════════════════
 *
 * `getPlanningSummary` n'est pas encore dans `runtime/tools.ts` : ce
 * fichier est partagé et c'est l'intégration qui l'y versera. Le test
 * construit donc son propre registre et lui applique les mêmes
 * invariants, pour que l'outil entre dans un catalogue qui l'a déjà
 * éprouvé.
 */

/**
 * L'AIGUILLEUR, POUR DE VRAI.
 *
 * `aiguillage.ts` importe `DEFINITIONS` par l'alias `@/`, que Node
 * ignore : on charge le crochet déjà écrit pour ce cas exact, puis on
 * importe en DYNAMIQUE (un import statique serait hissé avant le
 * crochet). C'est ce qui permet, plus bas, d'éprouver la question
 * telle qu'un paysagiste la tape plutôt que la liste de mots-clés.
 */
register("../_test/alias.mjs", import.meta.url);
const { aiguiller } = await import("../../../../app/api/oasis-ai/aiguillage.ts");

const ici = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(ici, "planning.sql"), "utf8");
const epreuve = readFileSync(join(ici, "planning.epreuve.sql"), "utf8");
const chargeDuJour = readFileSync(join(ici, "..", "..", "..", "field", "types.ts"), "utf8");

const OUTIL = OUTIL_PLANNING_SUMMARY;
const AGENT = DEFINITIONS.planning;

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
 * Cette fonction simulait le registre augmenté de l'outil, parce que ce
 * fichier a été écrit avant l'intégration. Elle rend maintenant le
 * registre RÉEL : tous les tests de propriété et de droits ci-dessous
 * portent sur ce que le produit offre vraiment, plus sur une simulation
 * de ce qu'il offrirait.
 */
function registreAvecOutil(): OasisAIToolRegistry {
  return registreOutils();
}

// ==================================================================
// 1. LA RÈGLE PORTÉE DEUX FOIS — le test qui justifie ce fichier
// ==================================================================

test("l'écran dit toujours ce que le SQL suppose : un jour intermédiaire ne vaut AUCUNE heure", () => {
  assert.match(
    chargeDuJour,
    /carte\.jours > 1 \? null :/,
    "`chargeDuJour` a changé de règle. `ai_planning_summary` en porte une copie en SQL : " +
      "allez la corriger dans `outils/planning.sql` AVANT de refermer ce test.",
  );
  assert.match(
    chargeDuJour,
    /Jamais zéro par défaut|jamais zéro/,
    "le NULL de `chargeDuJour` est ce que le SQL recopie : s'il devient zéro, les deux mentent ensemble",
  );
});

test("le SQL recopie la règle, et il dit qu'il la recopie", () => {
  assert.match(
    sql,
    /\(p\.dernier - p\.premier \+ 1\) > 1 then null/,
    "la clause « plusieurs jours → aucune heure » a disparu du SQL",
  );
  assert.match(
    sql,
    /chargeDuJour/,
    "le SQL doit nommer la fonction TypeScript qu'il duplique : sinon personne ne saura qu'il y " +
      "a un second endroit à corriger",
  );
  assert.match(
    sql,
    /count\(c\.heures\) = 0 then null/,
    "sans cette clause, une journée dont aucune carte n'est chiffrée rendrait 0 h au lieu de « inconnu »",
  );
  assert.match(
    sql,
    /interval '1 millisecond'/,
    "la fin exclusive : une intervention qui s'arrête à minuit n'occupe pas le lendemain",
  );
});

test("le champ ne s'appelle pas « heuresTravaillees », et c'est la moitié du travail", () => {
  assert.match(sql, /'heuresConnues'/);
  // La recherche porte sur les CLÉS JSON — `'nom'` entre quotes SQL —
  // et pas sur le fichier entier : son en-tête explique justement
  // pourquoi le mot est banni, et un test qui échouerait sur sa propre
  // documentation apprendrait à tout le monde à le contourner.
  const clefsJson = [...sql.matchAll(/'([A-Za-z][A-Za-z0-9]*)',/g)].map((m) => m[1]);
  assert.ok(
    !clefsJson.some((c) => /heuresTravaill/i.test(c)),
    "un modèle qui lit « heuresTravaillées » additionne des amplitudes sans se poser de question",
  );
  assert.match(OUTIL.description, /amplitude|AMPLITUDE/i);
  assert.match(OUTIL.description, /MINORANT/);
});

// ==================================================================
// 2. L'OUTIL A UNE FONCTION DERRIÈRE, ET ELLE GARDE SES GARANTIES
// ==================================================================

test("la fonction déclarée par l'outil est définie dans le SQL qui l'accompagne", () => {
  const declarees = [
    ...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi),
  ].map((m) => m[1].toLowerCase());
  assert.ok(declarees.includes(String(OUTIL.rpc).toLowerCase()));
});

test("le SQL exige le droit côté SERVEUR, et lève au lieu de rendre une vue partielle", () => {
  assert.match(sql, /perform\s+public\.ai_guard\(\s*p_organization_id,\s*'projects\.read'\s*\)/);
  assert.equal(OUTIL.permission, "projects.read");
});

test("le SQL est en lecture seule, et la RLS filtre en plus du garde", () => {
  assert.match(sql, /\bstable\b/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /set search_path = public/);
  for (const ecriture of ["insert into", "update ", "delete from", "truncate", "drop "]) {
    assert.ok(!sql.toLowerCase().includes(ecriture), `« ${ecriture} » dans une fonction de lecture`);
  }
});

test("les refus sont portés par la DONNÉE, pas par la mémoire du modèle", () => {
  // Une consigne de prompt cède sous une question insistante ; une clé
  // présente dans la réponse de l'outil, non. C'est pour cela que
  // `nonMesurable` sort de la fonction et pas seulement des limites.
  for (const clef of [
    "'disponibilite',",
    "'capaciteContractuelle',",
    "'amplitude',",
    "'tempsDeDeplacement',",
    "'competences',",
    "'deplacementDIntervention',",
  ]) {
    assert.ok(sql.includes(clef), `« ${clef} » a disparu du bloc nonMesurable`);
  }
  assert.match(
    sql,
    /AUCUNE table d''absence/,
    "le refus le plus important : « rien n'est posé » n'est pas « l'équipe est libre »",
  );
});

test("une semaine vide est une réponse, pas une panne", () => {
  assert.match(
    sql,
    /v_posees = 0 then 'insufficient_data'/,
    "une fenêtre sans rien doit se déclarer insuffisante, sinon l'agent chiffrera à partir du vide",
  );
});

test("la fenêtre est bornée des deux côtés, et ramenée plutôt que refusée", () => {
  assert.match(sql, /c_jours_max constant int := 31/);
  assert.match(sql, /least\(greatest\(coalesce\(p_days, 7\), 1\), c_jours_max\)/);
});

test("l'épreuve SQL défend le cas du bug d'origine, pas seulement la forme", () => {
  assert.match(epreuve, /rollback;/, "l'épreuve doit être sans effet de bord");
  assert.match(epreuve, /ni 24 h ni 0 h/);
  // L'apostrophe est DOUBLÉE dans le fichier : c'est une chaîne SQL.
  assert.match(epreuve, /n''occupe PAS le samedi/);
  assert.match(epreuve, /sans projects\.read, refus net/);
  assert.match(epreuve, /la semaine de B n''apparaît pas chez A/);
});

// ==================================================================
// 3. LE MODÈLE NE CHOISIT NI L'ENTREPRISE NI SES DROITS
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
  assert.ok(!serialise.includes("p_organization_id"));
  assert.ok(!serialise.includes("p_user_id"));
  assert.ok(!serialise.includes("permission"));
  assert.equal(OUTIL.injecteOrganisation, true);
});

test("le schéma est compatible du mode strict : rien d'optionnel, rien en trop", () => {
  const schema = schemaJson(OUTIL.parametres);
  const clefs = Object.keys(schema.properties ?? {});
  assert.deepEqual([...(schema.required ?? [])].sort(), [...clefs].sort());
  assert.equal(schema.additionalProperties, false);
});

test("c'est une LECTURE : elle a un rpc, ne demande aucune confirmation, n'écrit rien", () => {
  assert.equal(OUTIL.famille, "lecture");
  assert.ok(OUTIL.rpc !== undefined);
  assert.equal(OUTIL.confirmationRequise, false);
  assert.equal(OUTIL.actionType, undefined);
});

// ==================================================================
// 4. LA MINIMISATION, ET L'ÉCRITURE QUE L'AGENT ALLUME
// ==================================================================

test("l'outil est au catalogue, et c'est CE fichier qui y est déclaré", () => {
  // L'intégration a eu lieu. Ce que ce test défend maintenant est plus
  // fort que « il y est » : le registre doit contenir CET OBJET-CI
  // (`===`), pas une copie recopiée dans `tools.ts`. Deux déclarations
  // du même outil finissent par diverger, et c'est celle du registre
  // qui part au modèle.
  const inscrit = registreOutils().chercher(OUTIL.nom);
  assert.notEqual(inscrit, null, "`tools.ts` doit importer OUTIL_PLANNING_SUMMARY");
  assert.equal(inscrit, OUTIL, "le registre contient une COPIE de cet outil au lieu de cet outil");
});

test("`getPlanningSummary` est déclaré « couvert », et il DOIT l'être", () => {
  // ══════════════════════════════════════════════════════════════
  // LES DEUX DÉCLARATIONS DOIVENT DIRE LA MÊME CHOSE
  // ══════════════════════════════════════════════════════════════
  //
  // `OUTILS_SPEC_SANS_SERVICE` déclarait `getPlanningSummary` « absent »
  // tant que l'agent Planning n'existait pas, et sa phrase disait
  // elle-même pourquoi il faudrait l'écrire un jour : « agréger côté
  // modèle reviendrait à lui faire compter des heures » — or les heures
  // sont l'une des huit grandeurs de la frontière déterministe.
  //
  // Depuis le versement, l'entrée dit « couvert ». Ce test tient les
  // deux bouts DANS LE MÊME SENS que `tools.test.ts` : un outil déclaré
  // absent ET présent au registre, c'est l'un des deux qui ment. Le
  // jour où quelqu'un retirerait l'outil du registre sans rebasculer
  // l'entrée, il tombe et dit lequel des deux gestes manque.
  const entree = OUTILS_SPEC_SANS_SERVICE.find((e) => e.nomSpec === "getPlanningSummary");
  assert.ok(entree, "l'entrée a disparu de OUTILS_SPEC_SANS_SERVICE");
  assert.equal(
    entree.etat,
    "couvert",
    "l'outil est au registre : le déclarer « absent » ferait mentir l'une des deux lignes",
  );
  assert.ok(
    registreOutils().chercher(OUTIL.nom) !== null,
    "l'entrée dit « couvert » alors que l'outil n'est plus au registre : reversez-le, ou " +
      "rebasculez l'entrée à « absent » — mais pas ni l'un ni l'autre",
  );
});

test("le Planning le reçoit, et personne d'autre", () => {
  const registre = registreAvecOutil();
  assert.ok(registre.pourAgent("planning", TOUS_LES_DROITS).some((o) => o.nom === OUTIL.nom));
  for (const autre of AGENTS_CONSTRUITS) {
    if (autre === "planning") continue;
    assert.ok(
      !registre.pourAgent(autre, TOUS_LES_DROITS).some((o) => o.nom === OUTIL.nom),
      `« ${autre} » lirait le planning d'une entreprise sans que ce soit sa mission`,
    );
  }
});

test("construire cet agent ALLUME `scheduleIntervention`, qui n'appartenait à personne", () => {
  // L'écriture était câblée de bout en bout et inatteignable : l'outil
  // est étiqueté `agent: "planning"` depuis le début, et `pourAgent`
  // filtre par agent. Ce test dit ce que ce chantier change vraiment.
  const outil = registreOutils().chercher("scheduleIntervention");
  assert.ok(outil, "l'écriture du planning a disparu du catalogue");
  assert.equal(outil.agent, "planning");
  assert.equal(outil.famille, "proposition", "elle PROPOSE : rien n'est posé dans le tour");
  assert.equal(outil.confirmationRequise, true);
  assert.equal(outil.rpc, undefined, "ce fichier ne doit pas pouvoir appeler une écriture");
  assert.equal(outil.permission, "projects.manage");
});

test("sans projects.manage, il lit le planning mais ne propose plus rien", () => {
  const offerts = registreAvecOutil().pourAgent("planning", ["projects.read"]).map((o) => o.nom);
  assert.ok(offerts.includes(OUTIL.nom), "la lecture ne dépend que de projects.read");
  assert.ok(
    !offerts.includes("scheduleIntervention"),
    "proposer une intervention à un compte qui ne peut pas la poser ferait payer un aller-retour " +
      "pour un refus",
  );

  const refuses = registreAvecOutil().refusesPourAgent("planning", ["projects.read"]);
  assert.ok(
    refuses.some((r) => r.outil === "scheduleIntervention" && r.permission === "projects.manage"),
    "le droit qui manque doit se NOMMER, pas seulement masquer l'outil",
  );
});

test("sans projects.read, la lecture n'est pas proposée et le droit se nomme", () => {
  const registre = registreAvecOutil();
  assert.ok(!registre.pourAgent("planning", ["clients.read"]).some((o) => o.nom === OUTIL.nom));
  assert.ok(
    registre
      .refusesPourAgent("planning", ["clients.read"])
      .some((r) => r.outil === OUTIL.nom && r.permission === "projects.read"),
  );
});

test("aucun outil ne lui permet de DÉPLACER une intervention déjà posée", () => {
  // C'est le trou que ses limites annoncent. Le jour où quelqu'un
  // ajoute `rescheduleIntervention`, ce test tombe — et il faudra alors
  // corriger la limite qui dit le contraire, dans le même geste.
  const noms = registreAvecOutil().pourAgent("planning", TOUS_LES_DROITS).map((o) => o.nom);
  for (const inexistant of ["rescheduleIntervention", "moveIntervention", "cancelIntervention"]) {
    assert.ok(!noms.includes(inexistant), `« ${inexistant} » existe : la limite qui le nie ment`);
  }
});

// ==================================================================
// 5. L'HONNÊTETÉ DE L'AGENT
// ==================================================================

test("l'agent n'est plus un gabarit, et il a de quoi le prouver", () => {
  assert.equal(AGENT.aCompleter, undefined);
  assert.ok(AGENT.limites.length >= 6);
  assert.ok((AGENT.motsCles ?? []).length > 0);
});

test("chaque limite dit une chose précise, pas « il fait attention »", () => {
  for (const limite of AGENT.limites) {
    assert.ok(limite.length > 60, `« ${limite} » : trop courte pour dire ce qu'il ne sait pas`);
  }
});

test("les six refus mesurés par le sondage sont réellement écrits", () => {
  const texte = AGENT.limites.join(" ").toLowerCase();
  for (const [sujet, motif] of [
    ["la disponibilité, qui n'existe pas", /disponib/],
    ["la surcharge, sans dénominateur", /surcharge|taux de charge/],
    ["l'amplitude contre les heures", /amplitude/],
    ["l'effectif d'une équipe", /combien de personnes|membresenregistres/],
    ["le temps de trajet", /trajet/],
    ["les compétences", /compétence/],
  ] as const) {
    assert.match(texte, motif, `${sujet} n'est plus refusé dans les limites`);
  }
});

test("la phrase qui distingue « rien n'est posé » de « l'équipe est libre » est écrite noir sur blanc", () => {
  const tout = `${AGENT.responsabilites} ${AGENT.limites.join(" ")}`;
  assert.match(tout, /rien n'est posé/i);
  assert.match(tout, /libre/i);
});

test("il annonce qu'il ne pose rien sans confirmation, avant tout le reste", () => {
  assert.match(AGENT.limites[0], /BROUILLON/);
});

// ==================================================================
// 6. L'AIGUILLAGE — les mots qu'il prend, et ceux qu'il laisse
// ==================================================================

test("aucun mot AMBIGU NU n'est pris : ils voleraient d'autres agents", () => {
  const siens = (AGENT.motsCles ?? []).map((m) => m.toLowerCase());
  // « semaine » attraperait « le chiffre d'affaires de la semaine », et
  // la Finance est essayée APRÈS lui. « équipe » attraperait « combien
  // d'heures l'équipe a passées sur ce chantier », qui est aux
  // Chantiers. Les PHRASES qui les contiennent restent permises —
  // « semaine prochaine » ne peut désigner qu'un planning — et c'est
  // pour cela que la comparaison est une égalité, pas une inclusion.
  for (const vole of ["semaine", "équipe", "equipe", "chantier", "intervention", "retard"]) {
    assert.ok(!siens.includes(vole), `« ${vole} » est ambigu : il ne doit être pris par personne`);
  }
});

test("ses DEUX usages principaux arrivent bien chez lui, question par question", () => {
  // ══════════════════════════════════════════════════════════════
  // LE TEST QUI A CHANGÉ LES MOTS-CLÉS
  // ══════════════════════════════════════════════════════════════
  //
  // Écrits sans lui, ils envoyaient « qu'est-ce qui est posé la semaine
  // prochaine ? » et « pose une intervention mardi » à la DIRECTION :
  // la question la plus fréquente du Planning, et la seule ÉCRITURE que
  // cet agent allume. Une liste de mots-clés se relit très bien en
  // paraissant complète ; seule la question réelle le dit.
  for (const question of [
    "Qu'est-ce qui est posé la semaine prochaine ?",
    "Montre-moi le planning de jeudi",
    "Est-ce que deux chantiers se chevauchent sur la même équipe ?",
    "Pose une intervention mardi 8 h – 16 h pour l'équipe 1",
    "Planifie une tonte mardi chez Dupont",
    "Qui est en congé jeudi ?",
    "Qui est disponible mardi ?",
    "Décale la tonte de jeudi à vendredi",
  ]) {
    assert.equal(aiguiller(question, null).agent, "planning", `« ${question} »`);
  }
});

test("et il ne vole ni la Facturation, ni la Finance, ni les Chantiers", () => {
  for (const [question, attendu] of [
    ["Ai-je des factures en retard ?", "billing"],
    ["Quelle est ma marge ce mois-ci ?", "finance"],
    ["Quelle est ma trésorerie ?", "finance"],
    ["Où en est le chantier CH-2026-0001 ?", "operations"],
    ["Combien d'heures ont été pointées sur ce chantier ?", "operations"],
    ["Ce devis est-il bien chiffré ?", "quotePricing"],
  ] as const) {
    assert.equal(aiguiller(question, null).agent, attendu, `« ${question} »`);
  }
});

test("il PREND les mots de ses refus, parce que c'est lui qui doit les dire", () => {
  // Laisser « qui est en congé jeudi ? » tomber sur la Direction
  // produirait une réponse vague ; ici elle produit un fait, parce que
  // `nonMesurable.disponibilite` est dans sa donnée.
  const siens = (AGENT.motsCles ?? []).map((m) => m.toLowerCase());
  for (const refus of ["congé", "qui est disponible", "décal"]) {
    assert.ok(siens.includes(refus), `« ${refus} » doit venir jusqu'à lui pour être refusé net`);
  }
});

test("aucun de ses mots n'est déjà revendiqué par un autre agent", () => {
  const siens = new Set((AGENT.motsCles ?? []).map((m) => m.trim().toLowerCase()));
  for (const cle of AGENTS_CONSTRUITS) {
    if (cle === "planning") continue;
    for (const mot of DEFINITIONS[cle].motsCles ?? []) {
      assert.ok(
        !siens.has(mot.trim().toLowerCase()),
        `« ${mot} » est revendiqué par « ${cle} » et par le Planning`,
      );
    }
  }
});

// ==================================================================
// 7. CE QUE LA DESCRIPTION DIT AU MODÈLE
// ==================================================================

test("la description porte le refus le plus important de cet agent", () => {
  assert.match(OUTIL.description, /Rien n'est posé jeudi/);
  assert.match(OUTIL.description, /libre jeudi/);
  assert.match(OUTIL.description, /nonMesurable/);
});

test("il n'annonce que les grandeurs qu'il apporte vraiment", () => {
  assert.deepEqual([...OUTIL.fournit], ["heures"]);
  for (const jamais of ["distance", "tempsDeDeplacement"] as const) {
    assert.ok(
      !OUTIL.fournit.includes(jamais),
      `« ${jamais} » n'a aucun service dans ce produit : le déclarer ferait estimer le modèle`,
    );
  }
});
