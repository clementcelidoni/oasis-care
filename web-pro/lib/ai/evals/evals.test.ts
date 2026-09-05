import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTILS_SPEC_SANS_SERVICE, registreOutils } from "../runtime/tools.ts";
import { AGENTS_CONSTRUITS } from "../runtime/definitions.ts";
import { CAS_EVAL, CAS_EXECUTABLES } from "./cas.ts";
import { executerCas, executerSuite } from "./executeur.ts";
import { DROITS_COMPLETS } from "./harnais.ts";
import { formaterRapport } from "./rapport.ts";
import type { ConstatCas } from "./types.ts";

/**
 * §11V — LES SEPT CAS DE LA PAGE 24, EN MODE SIMULÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER TOURNE DANS `npm test`. IL N'APPELLE PERSONNE.
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucune clé, aucun réseau, aucun jeton. Ce qu'il défend est la
 * PLOMBERIE des sept cas : le niveau de modèle choisi, les outils
 * offerts, la forme de la sortie, l'absence d'écriture, la tenue du
 * grand livre, le cloisonnement. Le JUGEMENT du modèle, lui, se mesure
 * par `cli.ts --reel`, à la main, et chaque cas dit lui-même ce qui
 * reste alors à vérifier.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES TROIS CAS NON EXÉCUTABLES SONT TESTÉS AUSSI — AUTREMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Un cas déclaré « absent » ne prouve rien tant que son absence n'est
 * pas vérifiée : il suffirait qu'on ajoute `ai_fleet_costs` un mardi
 * pour que le cas « camion coûteux » reste marqué non exécutable
 * pendant deux ans. Les tests de couverture ci-dessous relisent donc
 * les MIGRATIONS et le REGISTRE, et échouent le jour où la pièce
 * manquante arrive — en disant quel cas d'évaluation attend d'être
 * branché.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const dossierMigrations = join(ici, "..", "..", "..", "..", "supabase", "migrations");

/** Toutes les fonctions Postgres définies par une migration du dépôt. */
function fonctionsDeclarees(): Set<string> {
  const noms = new Set<string>();
  for (const fichier of readdirSync(dossierMigrations)) {
    if (!fichier.endsWith(".sql")) continue;
    const contenu = readFileSync(join(dossierMigrations, fichier), "utf8");
    for (const trouve of contenu.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi,
    )) {
      noms.add(trouve[1].toLowerCase());
    }
  }
  return noms;
}

/** Le détail des contrôles ratés, pour que l'échec se lise sans relancer. */
function echecs(constat: ConstatCas): string {
  const lignes: string[] = [];
  for (const scenario of constat.scenarios) {
    for (const controle of scenario.controles) {
      if (!controle.ok) lignes.push(`${scenario.scenario} · ${controle.nom} : ${controle.detail}`);
    }
  }
  return lignes.join("\n");
}

// ==================================================================
// 1. LES SEPT CAS
// ==================================================================

test("la suite couvre exactement les sept cas de la page 24, dans son ordre", () => {
  assert.deepEqual(
    CAS_EVAL.map((c) => c.titre),
    [
      "Devis sous-tarifé",
      "Devis rentable",
      "Chantier non facturé",
      "Planning inefficace",
      "Stock insuffisant",
      "Camion coûteux",
      "Aucune donnée suffisante",
    ],
    "la page 24 nomme sept cas ; en retirer un pour faire passer la suite serait la seule " +
      "façon de la rendre inutile sans que rien ne rougisse",
  );
});

for (const cas of CAS_EXECUTABLES) {
  test(`cas « ${cas.titre} » : la plomberie tient`, async () => {
    const constat = await executerCas(cas, { mode: "simule" });
    assert.equal(constat.statut, "reussi", `\n${echecs(constat)}\n`);
    assert.ok(
      constat.scenarios.every((s) => s.controles.length >= 5),
      "les cinq contrôles universels doivent s'appliquer à chaque scénario",
    );
  });
}

test("un cas non exécutable dit POURQUOI, et ne se compte pas comme réussi", async () => {
  for (const cas of CAS_EVAL) {
    if (cas.scenarios.length > 0) continue;
    const constat = await executerCas(cas, { mode: "simule" });
    assert.equal(constat.statut, "non_executable");
    assert.ok(
      (constat.raison ?? "").length > 80,
      `« ${cas.titre} » n'explique pas son absence : une limite sans raison écrite est une limite ` +
        "que la prochaine personne prendra pour un oubli",
    );
  }
});

test("le rapport dit ce qu'il n'a PAS vérifié, même quand tout est vert", async () => {
  const rapport = await executerSuite({ mode: "simule" });
  const texte = formaterRapport(rapport);

  assert.equal(rapport.echoues, 0, texte);
  assert.equal(rapport.reussis, CAS_EXECUTABLES.length);
  assert.equal(rapport.nonExecutables, CAS_EVAL.length - CAS_EXECUTABLES.length);

  // LE POINT DU TEST : le mode simulé ne prouve pas le jugement, et le
  // rapport doit le porter noir sur blanc. Sans cette ligne, « suite au
  // vert » finirait par vouloir dire « le produit répond bien ».
  assert.ok(texte.includes("CE PASSAGE N'A PAS VÉRIFIÉ"));
  assert.ok(
    texte.includes("conclue réellement au sous-tarif"),
    "la liste du jugement doit être imprimée, pas seulement stockée",
  );
  assert.ok(texte.includes("Mode SIMULÉ"));
  assert.ok(
    !texte.includes(`${CAS_EVAL.length}/${CAS_EVAL.length}`),
    "aucun rapport ne doit pouvoir se lire « sept sur sept »",
  );
});

test("le mode réel ne se rabat JAMAIS sur le simulé en silence", async () => {
  await assert.rejects(
    () => executerCas(CAS_EXECUTABLES[0], { mode: "reel" }),
    /refuse de basculer en simulé/,
    "un rapport marqué « réel » qui n'aurait appelé personne est pire qu'aucun rapport",
  );
});

// ==================================================================
// 2. LA COUVERTURE — les fils tendus sous les trois cas absents
// ==================================================================

test("« camion coûteux » et le déplacement restent sans service — le planning, lui, en a un", () => {
  const declarees = fonctionsDeclarees();
  assert.ok(declarees.size > 50, "les migrations n'ont pas été lues correctement");

  // ══════════════════════════════════════════════════════════════
  // CE FIL A FAIT SON TRAVAIL : `ai_planning_summary` EST APPARUE
  // ══════════════════════════════════════════════════════════════
  //
  // Le test tendait un fil sous TROIS cas d'évaluation marqués « non
  // exécutables » faute de donnée, et il devait sonner le jour où l'un
  // d'eux gagnait une fonction. Il a sonné pour le planning, à
  // l'intégration de 0082 — c'est exactement ce pour quoi il était
  // écrit, et le cas « planning-inefficace » a été rebranché en même
  // temps que cette ligne bouge.
  //
  // Les deux autres restent tendus, et il faut dire pourquoi ils ne
  // sonnent PAS alors que l'agent Matériel vient d'être construit :
  // `ai_fleet_snapshot` et `ai_fleet_equipment` rendent les échéances,
  // la disponibilité et l'entretien SAISI. Aucune des deux ne porte un
  // coût d'usage — ni carburant, ni coût au kilomètre, ni
  // amortissement — et le motif ci-dessous ne les attrape donc pas, à
  // juste titre. Le cas « camion coûteux » de la p. 24 est précisément
  // celui auquel ces données ne peuvent pas répondre.
  //
  // On cherche large : n'importe quelle fonction dont le nom évoque un
  // coût de flotte. Chercher un nom exact laisserait passer
  // `ai_fleet_cost_summary`, et le cas resterait marqué « absent »
  // alors que la donnée serait là.
  const motifs: readonly { cas: string; motif: RegExp }[] = [
    { cas: "camion-couteux", motif: /^ai_.*(fleet|flotte).*(cost|cout|couts)/ },
    { cas: "devis-sous-tarife (déplacement)", motif: /^ai_.*(travel|trajet|distance|itinerair)/ },
  ];

  const apparues: string[] = [];
  for (const nom of declarees) {
    for (const { cas, motif } of motifs) {
      if (motif.test(nom)) apparues.push(`${nom} → le cas « ${cas} » peut enfin être branché`);
    }
  }

  assert.deepEqual(
    apparues,
    [],
    "une fonction est apparue depuis l'écriture de cette suite : le cas d'évaluation " +
      "correspondant attend d'être branché, sinon il restera marqué « non exécutable » " +
      "alors que le produit sait désormais répondre",
  );

  // ET DANS L'AUTRE SENS. Le fil du planning est retiré parce que la
  // fonction existe ; si elle disparaissait, le cas d'évaluation
  // redeviendrait faux sans que rien ne le dise.
  assert.ok(
    declarees.has("ai_planning_summary"),
    "`ai_planning_summary` a disparu des migrations : le cas « planning-inefficace » décrit " +
      "un produit qui n'existe plus, et l'agent Planning n'a plus rien à lire",
  );
});

test("les trois outils de la spec déclarés « absents » le sont toujours", () => {
  const registre = registreOutils();
  const absents = OUTILS_SPEC_SANS_SERVICE.filter((o) => o.etat === "absent").map((o) => o.nomSpec);

  // ILS ÉTAIENT QUATRE. `getPlanningSummary` A ÉTÉ LIVRÉ PAR 0082, et
  // son entrée est passée à « couvert » dans le même geste — l'un sans
  // l'autre aurait fait mentir l'une des deux lignes.
  //
  // Les trois qui restent ne sont pas trois oublis, et c'est ce que
  // cette liste sert à empêcher de croire :
  //   • `getFleetCosts` — l'agent Matériel EXISTE et lit son parc, mais
  //     le coût d'usage n'a aucun schéma : ni carburant, ni relevé
  //     périodique, ni amortissement.
  //   • `getSupplierPrices` — la table existe (0048) et personne ne
  //     l'alimente : zéro ligne, aucune fonction ne la lit.
  //   • `getTravelEstimate` — aucun distancier dans le produit.
  assert.deepEqual(
    absents.toSorted(),
    ["getFleetCosts", "getSupplierPrices", "getTravelEstimate"],
    "la liste des manques a changé : les cas d'évaluation qui s'appuient dessus doivent être relus",
  );
  for (const nom of absents) {
    assert.equal(
      registre.chercher(nom),
      null,
      `« ${nom} » est déclaré absent du produit ET présent au registre : l'un des deux ment`,
    );
  }
});

test("« stock insuffisant » : les outils existent, et seule la Pépinière les reçoit", () => {
  const registre = registreOutils();
  const declarees = fonctionsDeclarees();

  for (const nom of ["getNurseryStock", "getProjectedNurseryNeeds"]) {
    const outil = registre.chercher(nom);
    assert.ok(outil !== null, `« ${nom} » a disparu du registre`);
    assert.equal(outil.agent, "nursery");
    assert.ok(
      declarees.has(String(outil.rpc).toLowerCase()),
      `« ${nom} » nomme une fonction qui n'existe plus`,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // §11Y — CE TEST A CHANGÉ DE SENS, ET IL FAUT LE DIRE
  // ══════════════════════════════════════════════════════════════
  //
  // Il vérifiait qu'AUCUN agent ne recevait ces deux outils : c'était
  // vrai tant que `nursery` n'existait pas, et c'est ce qui faisait du
  // cas n° 5 un « outils_seuls ». L'agent Pépinière est aujourd'hui
  // ACHEVÉ — plan de contexte, mots-clés, huit limites, et ses deux
  // outils sous `nursery.stock.manage` — et `pourAgent("nursery")` les
  // lui offre donc.
  //
  // Ce que le test défend désormais est le vrai risque restant, et
  // c'est le même que la page 20 : QUE PERSONNE D'AUTRE NE LES VOIE.
  // Un outil de pépinière offert à la Facturation serait une source
  // qu'elle n'a aucune raison de lire — la minimisation prise à
  // l'envers. L'exemption ci-dessous ne dispense donc de rien : elle
  // dit seulement que le propriétaire n'est pas un intrus, et
  // l'assertion qui suit la boucle vérifie qu'il les reçoit bien.
  //
  // POURQUOI LE CAS N° 5 RESTE « outils_seuls » — la raison a changé,
  // et l'ancienne (« le gabarit n'a ni plan ni scénario ») n'est plus
  // vraie. Ce qui reste hors de portée est le JUGEMENT : « disponible »
  // a deux sens contradictoires dans ses propres sources, et éprouver
  // que l'agent rende toujours les deux chiffres demande de lire une
  // phrase, pas de compter des outils. Le `raison` du cas le dit.
  for (const agent of AGENTS_CONSTRUITS) {
    if (agent === "nursery") continue;
    const offerts = registre.pourAgent(agent, DROITS_COMPLETS).map((o) => o.nom);
    assert.ok(
      !offerts.includes("getNurseryStock") && !offerts.includes("getProjectedNurseryNeeds"),
      `l'agent « ${agent} » se voit offrir un outil de pépinière alors qu'il n'est pas la Pépinière`,
    );
  }

  const pepiniere = registreOutils().pourAgent("nursery", DROITS_COMPLETS).map((o) => o.nom);
  assert.ok(
    pepiniere.includes("getNurseryStock") && pepiniere.includes("getProjectedNurseryNeeds"),
    "les deux outils appartiennent à `nursery` : l'agent construit doit les recevoir",
  );
});
