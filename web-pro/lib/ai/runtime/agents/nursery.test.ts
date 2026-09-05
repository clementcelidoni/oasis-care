import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AGENT_PEPINIERE } from "./nursery.ts";
import { registreOutils } from "../tools.ts";
import { DROITS_EXIGES_OUTILS_PEPINIERE } from "../outils/nursery.ts";

/**
 * CE QUE L'AGENT PÉPINIÈRE DOIT TENIR.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'ÉPROUVE PAS LE MODÈLE. IL ÉPROUVE CE QU'ON LUI DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * On ne peut pas éprouver qu'un modèle refusera de certifier la santé
 * d'une serre qu'il n'a pas visitée. On peut éprouver que l'instruction
 * le lui interdit, que l'interdiction n'a pas été retirée par
 * inadvertance, et que rien dans le reste du système ne la contredit —
 * un outil offert derrière le dos d'une limite qui dit le contraire est
 * la manière la plus courante de rendre une instruction fausse.
 *
 * Chaque test ci-dessous défend une conséquence concrète, et aucune ne
 * casserait quoi que ce soit au moment où elle serait introduite.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

/** Le texte de toutes les migrations, concaténé. */
function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n");
}

/** Toutes les limites en un seul texte minuscule, pour chercher un sujet. */
const limites = AGENT_PEPINIERE.limites.join("\n").toLowerCase();

// ==================================================================
// 1. L'AGENT EST ALLUMÉ, ET IL EST ATTEIGNABLE
// ==================================================================

test("la Pépinière n'est plus un gabarit, et des mots l'atteignent", () => {
  // Les deux vont ENSEMBLE. Un agent achevé qu'aucun mot n'atteint
  // n'est atteint que par la Direction, qui n'a aucune source de
  // pépinière dans son plan : la question tomberait sur elle et elle
  // répondrait « je ne vois rien » avec assurance. C'est la panne
  // silencieuse déjà payée par l'agent Devis, dans le sens rassurant.
  assert.equal(AGENT_PEPINIERE.aCompleter, undefined, "la Pépinière est donnée pour un gabarit");
  assert.ok(
    (AGENT_PEPINIERE.motsCles ?? []).length > 0,
    "la Pépinière est achevée et aucune question libre ne l'atteint",
  );
});

test("aucun mot-clé de la Pépinière n'attrape une question qui ne lui appartient pas", () => {
  // L'aiguilleur essaie la Pépinière AVANT le matériel, le planning,
  // les chantiers, les clients, la finance et la Direction : un mot
  // trop large ne se contente pas d'être imprécis, il VOLE la question
  // à six agents. La comparaison est faite ici sur la sous-chaîne
  // normalisée, exactement comme `aiguiller()`.
  // Les diacritiques en POINTS DE CODE, comme `aiguillage.ts` : la
  // classe littérale équivalente contient des caractères combinants
  // nus, qui se collent au crochet précédent dans tous les éditeurs et
  // rendent la ligne invérifiable à la relecture.
  const diacritiques = new RegExp(
    `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
    "g",
  );
  const normaliser = (t: string) => t.toLowerCase().normalize("NFD").replace(diacritiques, "");

  const questionsDesAutres = [
    // Celles que les tests d'aiguillage existants exigent ailleurs.
    "Que dois-je faire aujourd'hui ?",
    "Fais-moi un brief",
    "Quelles sont mes priorités ?",
    "Qu'est-ce qui est urgent ?",
    "Quel est mon chiffre d'affaires ce trimestre ?",
    "Comment va ma trésorerie ?",
    "Mes créances augmentent-elles ?",
    "Est-ce que je tiens mon objectif de marge ?",
    "Qu'est-ce que je dois facturer ?",
    "Quelles sont mes factures impayées ?",
    "Ce devis est-il bien chiffré ?",
    "Suis-je sous-tarifé sur les terrasses ?",
    "Est-ce que ça se passe bien avec les Martin en ce moment ?",
    // LE CAS QUI A DÉCIDÉ D'ÉCRIRE « lots » ET NON « lot » :
    // « pilotage » contient « lot », et le pilotage appartient à la
    // Direction. Un mot-clé au singulier aurait détourné la question.
    "Fais-moi un point de pilotage",
    // Et celui qui a fait refuser « disponib » : la disponibilité d'une
    // ÉQUIPE appartient au Planning, qui passe APRÈS la Pépinière.
    "Qui est disponible jeudi prochain ?",
    // Et celui qui a fait refuser « espèce » : en espèces, c'est de
    // l'argent.
    "Ce client a payé en espèces",
  ];

  for (const question of questionsDesAutres) {
    const q = normaliser(question);
    for (const mot of AGENT_PEPINIERE.motsCles ?? []) {
      assert.ok(
        !q.includes(normaliser(mot)),
        `« ${mot} » attrape « ${question} », qui n'est pas une question de pépinière`,
      );
    }
  }
});

// ==================================================================
// 2. LES LIMITES — ce sont des RÈGLES, jamais des mesures
// ==================================================================

test("aucune limite ne contient un chiffre : une limite est une règle, pas une mesure", () => {
  // LA DISTINCTION EST LE SUJET, et elle est facile à perdre.
  // `limites` part MOT POUR MOT dans l'instruction envoyée au modèle,
  // pour TOUTES les entreprises. Y écrire « aucune inspection n'a
  // jamais été saisie » ou « vous avez 20 sujets disponibles » — deux
  // faits vrais de l'organisation sur laquelle ce chantier a été
  // mesuré — ferait dire à Oasis une phrase fausse chez la vingtième
  // entreprise cliente, et personne ne la relierait à ce fichier.
  //
  // Les mesures ont leur place : l'en-tête du fichier, en commentaire,
  // datées.
  for (const limite of AGENT_PEPINIERE.limites) {
    assert.ok(
      !/\d/.test(limite),
      `une limite porte un chiffre, donc probablement un fait daté : « ${limite} »`,
    );
  }
});

test("la contradiction des deux « disponible » est ordonnée, pas seulement mentionnée", () => {
  // C'est LA limite de cet agent : ses deux sources donnent deux
  // chiffres différents pour le même lot, et les deux sont justes.
  // Sans consigne, il se contredirait dans un seul paragraphe — pire
  // que le silence, parce que personne ne sait lequel croire.
  assert.match(limites, /disponible/);
  assert.match(limites, /vendable/);
  assert.match(limites, /statut/);
  assert.match(limites, /stade/);
  assert.ok(
    limites.includes("toujours les deux") || limites.includes("les deux chiffres"),
    "l'agent doit rendre les DEUX chiffres, pas en choisir un",
  );
});

test("les angles morts mesurés sont nommés un par un", () => {
  // Un angle mort qu'on ne nomme pas devient une réponse confiante.
  // Chacun de ceux-ci a été vérifié : aucune source de cet agent ne
  // lit les inspections, ne rend le bénéficiaire d'une réservation, ne
  // porte un coût de revient, une durée de culture ou un prix d'achat.
  for (const [sujet, motif] of [
    ["l'état sanitaire", /inspection/],
    ["le bénéficiaire d'une réservation", /réserv/],
    ["le coût de revient", /coût de revient/],
    ["la durée de culture", /délai/],
    ["le prix d'achat", /prix d'achat/],
    ["le droit manquant", /droit/],
    ["ce qui est attendu des fournisseurs", /commandes fournisseur/],
  ] as const) {
    assert.match(limites, motif, `l'agent ne dit pas qu'il ignore ${sujet}`);
  }
});

test("« aucune perte saisie » et « aucune perte » sont distingués", () => {
  // Le dénominateur est un carnet, pas une pépinière. C'est la
  // cinquième fois que ce produit corrige la confusion entre « zéro »
  // et « je ne sais pas » ; ici elle porte sur des faits saisis à la
  // main, qui sont ceux qu'on oublie le plus.
  assert.match(limites, /saisi/);
  assert.ok(
    limites.includes("carnet"),
    "l'agent doit dire d'où vient le zéro : un carnet vide n'est pas une pépinière sans casse",
  );
});

// ==================================================================
// 3. CE QUE L'AGENT DIT ET CE QUE LE REGISTRE FAIT NE PEUVENT PAS
//    DIVERGER
// ==================================================================

test("ses deux sources existent, lui appartiennent, et pointent sur une fonction réelle", () => {
  const registre = registreOutils();
  const siennes = registre.tous().filter((o) => o.agent === "nursery" && o.rpc !== undefined);
  const rpcs = siennes.map((o) => o.rpc);

  assert.deepEqual(
    rpcs.toSorted(),
    ["ai_find_stock", "ai_forecast_availability"],
    "les sources de la Pépinière ont changé : relire ses limites avant de changer ce test",
  );

  // « AUCUN OUTIL N'EST DÉCLARÉ DONT LA FONCTION SQL N'EXISTE PAS » —
  // la règle de l'en-tête de `tools.ts`, revérifiée ici pour les deux
  // fonctions dont dépend TOUT ce que cet agent sait dire.
  const sql = migrations();
  for (const rpc of rpcs) {
    assert.ok(
      sql.includes(`function public.${rpc}(`),
      `« ${rpc} » est déclaré et aucune migration ne le définit : l'agent l'appellera de bonne foi`,
    );
  }
});

test("la première limite et le registre disent la même chose sur l'écriture", () => {
  // LE LIEN QUE CE TEST DÉFEND. `agents/nursery.ts` promet « N'ÉCRIT
  // RIEN, et ne propose rien à écrire ». C'est vrai tant que
  // `createNurseryLot` et `recordStockMovement` ne sont pas au
  // registre — ils sont câblés dans `lib/ai/proposals.ts` et prêts
  // dans `runtime/outils/nursery.ts`, il ne manque que leur
  // déclaration.
  //
  // Le jour où quelqu'un les déclare, l'instruction interdirait à
  // l'agent d'employer un outil qu'on vient de lui donner : il
  // refuserait poliment de faire ce qu'on lui demande, et rien ne le
  // signalerait. Ce test échoue ce jour-là, et il nomme la limite à
  // réécrire.
  const registre = registreOutils();
  const ecritures = registre
    .tous()
    .filter((o) => o.agent === "nursery" && o.famille !== "lecture");

  const promesse = AGENT_PEPINIERE.limites[0].toUpperCase();
  const jureNePasEcrire = promesse.includes("N'ÉCRIT RIEN");

  if (ecritures.length > 0) {
    assert.ok(
      !jureNePasEcrire,
      `la Pépinière a maintenant ${ecritures.length} outil(s) d'écriture (${ecritures
        .map((o) => o.nom)
        .join(", ")}) et sa première limite dit encore qu'elle n'écrit rien : réécrivez-la`,
    );
  } else {
    assert.ok(
      jureNePasEcrire,
      "la Pépinière n'a aucun outil d'écriture et ne le dit pas : elle promettra un brouillon " +
        "qu'aucun outil ne peut déposer",
    );
  }
});

test("les deux outils portent le droit du stock, et le droit manquant se NOMME", () => {
  // ══════════════════════════════════════════════════════════════
  // LA CINQUIÈME OCCURRENCE DE « ZÉRO N'EST PAS JE NE SAIS PAS »
  // ══════════════════════════════════════════════════════════════
  //
  // Ce test disait l'inverse : il TENAIT le défaut — `permission: null`
  // sur les deux outils — pour qu'on le voie plutôt que de le masquer,
  // parce que `tools.ts` est un fichier partagé que son auteur ne
  // pouvait pas corriger. L'intégration l'a corrigé, et le test défend
  // maintenant la correction.
  //
  // Ce qu'il défend n'est pas cosmétique. Les six tables `nursery_*`
  // sont sous `has_permission(..., 'nursery.stock.manage')`, et les
  // deux fonctions SQL sont `security invoker` sans `ai_guard` : elles
  // rendent `[]` au lieu de lever. Sans la permission déclarée ici,
  // l'outil est offert à un compte qui ne peut rien lire, la réponse
  // est une liste vide, et l'agent annonce « aucun stock » à une
  // entreprise qui en a.
  const registre = registreOutils();
  for (const exige of DROITS_EXIGES_OUTILS_PEPINIERE) {
    const outil = registre.chercher(exige.outil);
    assert.notEqual(outil, null, `« ${exige.outil} » a disparu du registre`);
    assert.equal(
      outil?.permission,
      exige.permission,
      `« ${exige.outil} » a perdu son droit : sans lui, un compte sans « ${exige.permission} » ` +
        `reçoit une liste vide, lue comme une pépinière vide. ${exige.pourquoi}`,
    );
  }

  // LES DEUX EFFETS, VÉRIFIÉS SÉPARÉMENT. Le premier — ne pas offrir
  // l'outil — évite un aller-retour de jetons. Le second — nommer le
  // droit — est celui qui change la réponse de l'agent.
  const sansLeDroit = ["projects.read", "clients.read"] as const;
  const offerts = registre.pourAgent("nursery", sansLeDroit).map((o) => o.nom);
  const refuses = registre.refusesPourAgent("nursery", sansLeDroit);
  for (const exige of DROITS_EXIGES_OUTILS_PEPINIERE) {
    assert.ok(
      !offerts.includes(exige.outil),
      `« ${exige.outil} » est offert à un compte qui ne peut pas le lire`,
    );
    assert.ok(
      refuses.some((r) => r.outil === exige.outil && r.permission === exige.permission),
      `le droit manquant de « ${exige.outil} » n'est pas nommé : l'agent dira « aucun stock »`,
    );
  }

  // Et l'atténuation côté modèle RESTE, en plus de la barrière. Elle
  // n'est pas redondante : la barrière empêche de lire à l'aveugle,
  // la limite couvre le cas où le stock est réellement vide et où
  // l'agent doit quand même énoncer les deux possibilités.
  assert.ok(
    limites.includes("droit manquant") || limites.includes("un droit manquant"),
    "la limite qui double la barrière a disparu",
  );
});
