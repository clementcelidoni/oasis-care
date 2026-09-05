import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OUTIL_FLEET_SNAPSHOT, OUTIL_FLEET_EQUIPMENT, OUTILS_MATERIEL } from "./fleet.ts";
import { OUTILS_SPEC_SANS_SERVICE, registreOutils } from "../tools.ts";
import { AGENTS_CONSTRUITS } from "../agents/index.ts";
import type { Permission } from "../../../auth/permissions.ts";

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
 * LES DEUX OUTILS DE L'AGENT MATÉRIEL, ÉPROUVÉS AVANT D'ÊTRE BRANCHÉS.
 *
 * ══════════════════════════════════════════════════════════════════
 * ÉPROUVER UN OUTIL QUI N'EST PAS ENCORE AU REGISTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ils ne sont importés par personne : `runtime/tools.ts` est partagé et
 * l'intégration les y recopiera. Un objet qui n'est jamais exécuté est
 * précisément celui qu'il faut éprouver AVANT — une fois recopié, ses
 * défauts n'apparaîtront qu'à l'appel, chez un client, sous la forme
 * d'un refus SQL incompréhensible.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER NE PEUT PAS ENCORE VÉRIFIER, ET COMMENT IL S'Y PREND
 * ══════════════════════════════════════════════════════════════════
 *
 * La règle de l'en-tête de `tools.ts` — « aucun outil n'est déclaré dont
 * la fonction SQL n'existe pas » — se vérifie normalement en relisant
 * `supabase/migrations`. Elle ne le peut pas encore ici : les deux
 * fonctions vivent dans `outils/fleet.sql` en attendant que
 * l'intégration les verse dans 0082, parce que la migration est un
 * fichier partagé.
 *
 * Le test relit donc le fichier `.sql` VOISIN, ce qui défend exactement
 * la même chose au stade où nous sommes : le `rpc` déclaré correspond à
 * une fonction réellement écrite, et non à un joli nom. Et il relit
 * AUSSI les migrations, pour que le jour où l'intégration y verse le
 * corps, la correspondance soit vérifiée là où elle comptera vraiment —
 * sans que personne ait à y penser.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

function sourceSql(): string {
  return readFileSync(join(ici, "fleet.sql"), "utf8");
}

/**
 * L'épreuve, lue COMME POSTGRES LA LIT.
 *
 * Dans un littéral SQL une apostrophe s'écrit doublée : le fichier porte
 * « qu''un parc faussement vide », et la phrase que le lecteur voit est
 * « qu'un parc faussement vide ». Un test qui chercherait la seconde
 * dans le premier échouerait sur une convention d'échappement plutôt que
 * sur un défaut — et on la corrigerait en affaiblissant l'expression
 * cherchée, ce qui est exactement la mauvaise correction.
 */
function sourceEpreuve(): string {
  return readFileSync(join(ici, "fleet.epreuve.sql"), "utf8").replaceAll("''", "'");
}

function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n");
}

// ==================================================================
// 1. LA RÈGLE QUI TIENT TOUT LE REGISTRE
// ==================================================================

test("chaque outil nomme une fonction réellement écrite", () => {
  // « AUCUN OUTIL N'EST DÉCLARÉ DONT LA FONCTION SQL N'EXISTE PAS. »
  // C'est le défaut le plus silencieux de ce travail : rien ne le
  // signale au développeur, rien ne le signale au modèle, qui
  // l'appellera de bonne foi, et ce qui remonte six semaines plus tard
  // c'est « Oasis dit qu'il ne peut pas répondre ».
  const sql = sourceSql();
  for (const outil of OUTILS_MATERIEL) {
    assert.notEqual(outil.rpc, undefined, `« ${outil.nom} » est une lecture sans fonction`);
    assert.ok(
      sql.includes(`create or replace function public.${outil.rpc}(`),
      `« ${outil.rpc} » n'est définie nulle part dans outils/fleet.sql`,
    );
  }
});

test("et le jour où l'intégration la verse dans une migration, le nom colle encore", () => {
  // Ce test ne fait rien tant que les fonctions ne sont pas dans 0082 —
  // c'est voulu. Il devient exigeant tout seul le jour de
  // l'intégration, sans que personne ait à s'en souvenir : si le corps
  // est recopié sous un autre nom que celui déclaré ici, il échoue.
  const sql = migrations();
  for (const outil of OUTILS_MATERIEL) {
    const versee = sql.includes(`function public.${outil.rpc}(`);
    if (!versee) continue;
    assert.ok(
      sql.includes(`create or replace function public.${outil.rpc}(`),
      `« ${outil.rpc} » est citée par une migration sans y être définie`,
    );
  }
});

test("aucun schéma n'expose l'organisation au modèle", () => {
  // Un paramètre d'organisation offert au modèle serait une
  // organisation choisie par la QUESTION, et la promesse « l'entreprise
  // A ne peut jamais lire l'entreprise B » reposerait sur la bonne
  // volonté d'un modèle de langage. Elle est injectée par l'exécuteur,
  // depuis la session.
  for (const outil of OUTILS_MATERIEL) {
    assert.equal(outil.injecteOrganisation, true, `« ${outil.nom} » n'injecte pas l'organisation`);
    const champs = JSON.stringify(
      Object.keys((outil.parametres as unknown as { shape: Record<string, unknown> }).shape),
    );
    assert.ok(
      !champs.includes("organization"),
      `« ${outil.nom} » laisse le modèle nommer une entreprise`,
    );
    assert.ok(!champs.includes("user_id"), `« ${outil.nom} » laisse le modèle nommer un utilisateur`);
  }
});

test("les deux appartiennent au Matériel et gardent sur projects.read", () => {
  // Les quatre tables du module sont sous `projects.read` en lecture
  // (vérifié dans pg_policies). Sans permission déclarée, une liste vide
  // se lirait « aucun matériel » au lieu de « pas le droit » — et ces
  // deux phrases mènent à deux gestes opposés.
  for (const outil of OUTILS_MATERIEL) {
    assert.equal(outil.agent, "fleet", `« ${outil.nom} » n'appartient pas au Matériel`);
    assert.equal(outil.permission, "projects.read", `« ${outil.nom} » ne nomme pas son droit`);
    // « aiGuard » et pas « rls » : le refus doit être une EXCEPTION
    // NOMMÉE. Une vue filtrée en silence rendrait un parc faussement
    // vide, indiscernable d'une entreprise qui n'a rien saisi.
    assert.equal(outil.permissionSource, "aiGuard", `« ${outil.nom} » se contente de la RLS`);
  }
});

test("une question ne peut rien écrire", () => {
  for (const outil of OUTILS_MATERIEL) {
    assert.equal(outil.famille, "lecture");
    assert.equal(outil.confirmationRequise, false, `« ${outil.nom} » réclame une confirmation`);
    assert.equal(outil.actionType, undefined, `« ${outil.nom} » porte un type d'action`);
  }
});

// ==================================================================
// 2. LA MOITIÉ QUI N'EST PAS LIVRÉE, ET QUI DOIT LE RESTER
// ==================================================================

test("`getFleetCosts` reste déclaré ABSENT : ces outils ne livrent pas les coûts d'usage", () => {
  // LE TEST LE PLUS IMPORTANT DE CE FICHIER.
  //
  // Le verdict du sondage était PARTIEL : les échéances et la
  // disponibilité sont constructibles, le coût d'usage ne l'est pas —
  // ni carburant, ni relevé kilométrique périodique, ni amortissement,
  // ni refacturation au chantier n'ont de SCHÉMA dans ce produit.
  //
  // Livrer ces deux outils ne change RIEN à cette absence. Si quelqu'un
  // fait un jour passer `getFleetCosts` à « couvert » en s'appuyant sur
  // eux, l'agent se mettra à répondre à « combien me coûte ce camion au
  // kilomètre » — la question à laquelle ces données ne peuvent pas
  // répondre, et le cas d'évaluation « camion coûteux » de la p. 24.
  const entree = OUTILS_SPEC_SANS_SERVICE.find((o) => o.nomSpec === "getFleetCosts");
  assert.notEqual(entree, undefined, "`getFleetCosts` a disparu de la liste des outils sans service");
  assert.equal(
    entree?.etat,
    "absent",
    "`getFleetCosts` est passé à « couvert » : l'agent va se mettre à chiffrer un coût d'usage " +
      "que ce produit ne mesure pas.",
  );
});

test("et aucun de ces outils ne porte un nom qui le laisserait croire", () => {
  // Un outil nommé `getFleetCosts` qui ne rendrait que des factures
  // d'entretien ferait croire que la question a une réponse ici. Le nom
  // est la première documentation que le modèle lit.
  for (const outil of OUTILS_MATERIEL) {
    assert.ok(
      !/cost|cout|coût/i.test(outil.nom),
      `« ${outil.nom} » promet un coût que ce produit ne calcule pas`,
    );
  }
});

test("la description porte les cinq refus, là où le modèle les lira", () => {
  // Les limites d'un agent vivent dans son instruction ; la description
  // d'un outil vit à CÔTÉ DU CHIFFRE, dans le même tour. C'est le seul
  // endroit qui ne se dilue pas dans un long contexte.
  const d = OUTIL_FLEET_SNAPSHOT.description;
  assert.match(d, /nonMesurable/, "la description ne renvoie pas au bloc de refus");
  assert.match(d, /carburant/i);
  assert.match(d, /amortissement/i);
  assert.match(d, /géolocalisation|geolocalisation/i);
  assert.match(d, /refacturation/i);
});

// ==================================================================
// 3. « ZÉRO » N'EST PAS « JE NE SAIS PAS » — la faute la plus facile
// ==================================================================

test("la description ORDONNE de lire le drapeau de parc vide avant les compteurs", () => {
  // `equipment` compte zéro ligne en production. « 0 échéance en
  // retard » est donc la réponse que le modèle produira naturellement,
  // elle est rassurante, et personne ne la vérifiera. La description
  // doit l'interdire nommément — pas suggérer la prudence.
  const d = OUTIL_FLEET_SNAPSHOT.description;
  assert.match(d, /parc\.vide/, "le drapeau n'est pas nommé dans la description");
  assert.match(d, /AVANT TOUT LE RESTE/, "rien n'impose de le lire en premier");
  assert.match(d, /JAMAIS « 0 échéance en retard »/, "la phrase interdite n'est pas citée");
  assert.match(d, /\/materiel/, "le refus est un cul-de-sac : aucun écran n'est nommé");
});

test("le SQL rend bien null, et non zéro, quand le parc est vide", () => {
  // Le test TypeScript ne peut pas appeler Postgres. Il vérifie donc que
  // la FORME du SQL porte encore la décision — un `count(*)` glissé plus
  // tard à la place du `case when v_vide then null` ne casserait aucun
  // test de ce fichier sans cette relecture.
  const sql = sourceSql();
  assert.match(
    sql,
    /'depassees',\s+case when v_vide or v_ech_saisies = 0 then null/,
    "« depassees » ne vaut plus null sur un parc vide ou non suivi",
  );
  assert.match(
    sql,
    /'suivies', \(not v_vide\) and v_ech_saisies > 0/,
    "le drapeau « suivies » ne distingue plus « aucune échéance saisie »",
  );
});

test("l'épreuve SQL défend les trois formes du piège, pas seulement la première", () => {
  // Le parc vide, le parc sans aucune échéance, et le parc à moitié
  // suivi. Les deux dernières sont les plus vicieuses : les compteurs de
  // machines y sont crédibles, donc « 0 en retard » ressemble à une
  // vraie réponse.
  const e = sourceEpreuve();
  assert.match(e, /« échéances dépassées » vaut NULL, JAMAIS 0/);
  assert.match(e, /mais les échéances ne sont PAS suivies/);
  assert.match(e, /machinesSansEcheance/);
  assert.match(e, /refus net plutôt qu'un parc faussement vide/);
});

// ==================================================================
// 4. LES SCHÉMAS
// ==================================================================

test("les schémas acceptent un appel réaliste et refusent un appel vide", () => {
  // Le mode strict des sorties structurées exige que TOUTES les clés
  // soient présentes : les facultatives sont `.nullable()`, jamais
  // `.optional()`. Un schéma qui accepterait `{}` cacherait une
  // `.optional()` glissée par habitude.
  assert.doesNotThrow(() => OUTIL_FLEET_SNAPSHOT.parametres.parse({ p_days: null }));
  assert.doesNotThrow(() => OUTIL_FLEET_SNAPSHOT.parametres.parse({ p_days: 90 }));
  assert.throws(() => OUTIL_FLEET_SNAPSHOT.parametres.parse({}));

  assert.doesNotThrow(() => OUTIL_FLEET_EQUIPMENT.parametres.parse({ p_query: "master" }));
  assert.throws(() => OUTIL_FLEET_EQUIPMENT.parametres.parse({}));
  // Une recherche vide ramènerait tout le parc et le modèle croirait
  // avoir désigné une machine.
  assert.throws(() => OUTIL_FLEET_EQUIPMENT.parametres.parse({ p_query: "" }));
});

test("la fiche dit au modèle de ne PAS passer par searchEntities", () => {
  // `global_search` n'indexe pas le matériel : aucune fonction `ai_*` de
  // la base ne contient le mot `equipment`. Un modèle laissé à ses
  // habitudes chercherait « le Master » avec `searchEntities`,
  // obtiendrait rien, et conclurait que la machine n'existe pas.
  assert.match(OUTIL_FLEET_EQUIPMENT.description, /N'UTILISE PAS « searchEntities »/);
});

test("la fiche distingue « parc vide » de « rien ne correspond »", () => {
  assert.match(OUTIL_FLEET_EQUIPMENT.description, /parcVide/);
  assert.match(OUTIL_FLEET_EQUIPMENT.description, /Plusieurs candidats/);
});

// ==================================================================
// 5. ILS SONT BRANCHÉS, ET C'EST CE FICHIER QUI EST BRANCHÉ
// ==================================================================

test("les deux sont au registre, et ce sont CES objets-ci", () => {
  // L'INTÉGRATION A EU LIEU. Le test disait auparavant l'inverse — que
  // les deux n'y étaient pas encore — et il avait raison à ce
  // moment-là. Il défend maintenant quelque chose de plus fort.
  //
  // `tools.ts` IMPORTE ce fichier au lieu de recopier ses deux
  // déclarations, et l'égalité de référence (`===`) est ce qui l'y
  // oblige. Une recopie serait une seconde vérité : le jour où l'un des
  // deux exemplaires est corrigé — une permission, une borne, une
  // phrase de description — c'est l'autre qui part au modèle, et rien
  // ne le signale.
  const registre = registreOutils();
  for (const outil of OUTILS_MATERIEL) {
    const inscrit = registre.chercher(outil.nom);
    assert.notEqual(inscrit, null, `« ${outil.nom} » manque au registre : \`tools.ts\` doit l'importer`);
    assert.equal(
      inscrit,
      outil,
      `le registre contient une COPIE de « ${outil.nom} » au lieu de cet objet : deux ` +
        "déclarations du même outil finissent par diverger, et c'est celle du registre qui part " +
        "au modèle.",
    );
  }
});

test("le Matériel les reçoit, et personne d'autre", () => {
  // La minimisation de la p. 20, vérifiée sur le registre RÉEL
  // maintenant qu'il les contient : un agent ne voit que ses outils et
  // les transverses. Sans ce test, rien n'empêcherait qu'une ligne
  // `agent: "fleet"` mal recopiée donne le parc à la Finance.
  const registre = registreOutils();
  for (const outil of OUTILS_MATERIEL) {
    assert.ok(
      registre.pourAgent("fleet", TOUS_LES_DROITS).some((o) => o.nom === outil.nom),
      `« ${outil.nom} » n'est pas offert au Matériel`,
    );
    for (const autre of AGENTS_CONSTRUITS) {
      if (autre === "fleet") continue;
      assert.ok(
        !registre.pourAgent(autre, TOUS_LES_DROITS).some((o) => o.nom === outil.nom),
        `« ${autre} » verrait le parc d'une entreprise sans que ce soit sa mission`,
      );
    }
  }
});

test("sans projects.read, ni l'un ni l'autre n'est proposé, et le droit se NOMME", () => {
  // C'EST LE POINT LE PLUS IMPORTANT DE CE FICHIER, et il n'est pas
  // cosmétique. Les quatre tables `equipment*` sont sous RLS : sans le
  // droit, une fonction sans garde rendrait « aucun matériel
  // enregistré » — indiscernable d'un parc réellement vide, et c'est le
  // mensonge rassurant que ce produit a déjà payé quatre fois. Les deux
  // fonctions lèvent (`ai_guard`), et le registre doit en plus NOMMER
  // le droit plutôt que de masquer l'outil en silence.
  const registre = registreOutils();
  const offerts = registre.pourAgent("fleet", ["clients.read"]).map((o) => o.nom);
  const refuses = registre.refusesPourAgent("fleet", ["clients.read"]);
  for (const outil of OUTILS_MATERIEL) {
    assert.ok(!offerts.includes(outil.nom), `« ${outil.nom} » est offert sans le droit de le lire`);
    assert.ok(
      refuses.some((r) => r.outil === outil.nom && r.permission === "projects.read"),
      `le droit manquant de « ${outil.nom} » doit se nommer, pas seulement masquer l'outil`,
    );
  }
});

test("aucun outil d'écriture n'est accessible au Matériel", () => {
  // Ses limites disent qu'il n'enregistre ni entretien, ni relevé, ni
  // affectation. Ce test le prouve au lieu de le promettre.
  for (const outil of registreOutils().pourAgent("fleet", TOUS_LES_DROITS)) {
    assert.equal(
      outil.famille,
      "lecture",
      `« ${outil.nom} » permettrait au Matériel d'écrire : ses limites disent le contraire`,
    );
  }
});
