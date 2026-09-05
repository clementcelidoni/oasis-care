import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  OUTIL_ANALYTIQUE_PEPINIERE,
  OUTILS_PROPOSITION_PEPINIERE,
} from "./nursery.ts";
import { registreOutils } from "../tools.ts";

/**
 * LES TROIS OUTILS DE PÉPINIÈRE PRÊTS À BRANCHER.
 *
 * ══════════════════════════════════════════════════════════════════
 * ÉPROUVER UN OUTIL QUI N'EST PAS ENCORE AU REGISTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ils ne sont importés par personne : `runtime/tools.ts` est partagé et
 * l'intégration les y recopiera. Un objet qui n'est jamais exécuté est
 * précisément celui qu'il faut éprouver AVANT — une fois recopié, ses
 * défauts n'apparaîtront qu'à l'appel, chez un client, sous la forme
 * d'un refus SQL incompréhensible ou d'une approbation qui ne trouve
 * pas sa fonction.
 *
 * Quatre choses se vérifient sans exécuter quoi que ce soit :
 *
 *   1. la fonction SQL existe réellement (la règle de l'en-tête de
 *      `tools.ts`, celle qui évite l'outil au joli nom sans `rpc`) ;
 *   2. l'organisation n'est nulle part dans le schéma offert au modèle ;
 *   3. les propositions n'ont pas de `rpc` et exigent une confirmation ;
 *   4. leurs noms et leurs paramètres correspondent EXACTEMENT à ce que
 *      `lib/ai/proposals.ts` sait exécuter — un nom qui diverge se
 *      découvre après l'appel de modèle, au moment du clic.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n");
}

function sourceDesPropositions(): string {
  return readFileSync(join(racineDepot, "web-pro", "lib", "ai", "proposals.ts"), "utf8");
}

const TOUS = [OUTIL_ANALYTIQUE_PEPINIERE, ...OUTILS_PROPOSITION_PEPINIERE];

// ==================================================================
// 1. LA RÈGLE QUI TIENT TOUT LE REGISTRE
// ==================================================================

test("la fonction de l'outil de lecture existe vraiment en base", () => {
  // « AUCUN OUTIL N'EST DÉCLARÉ DONT LA FONCTION SQL N'EXISTE PAS. »
  // C'est le défaut le plus silencieux de ce travail : rien ne le
  // signale au développeur, rien ne le signale au modèle, qui
  // l'appellera de bonne foi, et ce qui remonte six semaines plus tard
  // c'est « Oasis dit qu'il ne peut pas répondre ».
  const sql = migrations();
  assert.equal(OUTIL_ANALYTIQUE_PEPINIERE.rpc, "pro_analytics_nursery");
  assert.ok(
    sql.includes("function public.pro_analytics_nursery("),
    "`pro_analytics_nursery` n'est définie par aucune migration",
  );
});

test("aucun schéma n'expose l'organisation au modèle", () => {
  // Un paramètre d'organisation offert au modèle serait une
  // organisation choisie par la QUESTION, et la promesse
  // « l'entreprise A ne peut jamais lire l'entreprise B » reposerait
  // sur la bonne volonté d'un modèle de langage. Elle est injectée par
  // l'exécuteur, depuis la session.
  for (const outil of TOUS) {
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

test("les trois appartiennent à la Pépinière et gardent sur le droit de son stock", () => {
  // Les six tables `nursery_*` sont sous
  // `has_permission(organization_id, 'nursery.stock.manage')` — un
  // droit d'écriture employé comme droit de lecture. C'est le défaut
  // que ces déclarations corrigent : sans permission déclarée, une
  // liste vide se lit « aucun stock » au lieu de « pas le droit ».
  for (const outil of TOUS) {
    assert.equal(outil.agent, "nursery", `« ${outil.nom} » n'appartient pas à la Pépinière`);
    assert.equal(
      outil.permission,
      "nursery.stock.manage",
      `« ${outil.nom} » ne nomme pas le droit qui commande ses tables`,
    );
  }
});

// ==================================================================
// 2. LES DEUX ÉCRITURES N'ÉCRIVENT PAS
// ==================================================================

test("une proposition ne connaît pas le nom de la fonction qui écrit", () => {
  // Pas de champ `rpc` : le registre ne peut donc pas appeler une
  // fonction d'écriture, même par erreur de programmation. La
  // correspondance vit dans `proposals.ts`, derrière l'approbation.
  for (const outil of OUTILS_PROPOSITION_PEPINIERE) {
    assert.equal(outil.famille, "proposition");
    assert.equal(outil.rpc, undefined, `« ${outil.nom} » porte un rpc : il pourrait être exécuté`);
    assert.equal(outil.confirmationRequise, true, `« ${outil.nom} » n'exige pas de confirmation`);
    assert.equal(outil.permissionSource, "aiGuard");
    assert.deepEqual(outil.fournit, [], "une écriture ne fournit aucune grandeur déterministe");
  }
});

test("chaque proposition porte le nom exact que proposals.ts sait exécuter", () => {
  // LE DÉFAUT QUE CE TEST ATTRAPE : un nom qui diverge d'une lettre.
  // Le modèle appelle l'outil, l'utilisateur voit un bouton, il
  // clique — et `isProposalKind` refuse. Le coût du modèle est déjà
  // payé, et l'utilisateur ne comprend pas pourquoi son geste n'a rien
  // fait.
  const source = sourceDesPropositions();
  for (const outil of OUTILS_PROPOSITION_PEPINIERE) {
    assert.ok(
      new RegExp(`\\n  ${outil.nom}: \\{`).test(source),
      `« ${outil.nom} » n'est pas une proposition connue de lib/ai/proposals.ts`,
    );
  }
});

test("les paramètres offerts au modèle sont exactement ceux que la proposition transmet", () => {
  // `proposals.ts` recopie une liste FERMÉE de paramètres (`params`) :
  // un champ que le modèle remplit et qui n'y figure pas est
  // silencieusement jeté. C'est exactement le défaut qui affecte
  // aujourd'hui `createPurchaseOrderDraft` — `unit_price_cents`
  // déclaré, `unit_cost_cents` lu, toutes les lignes à 0 €. On ne le
  // refait pas ici.
  const source = sourceDesPropositions();

  for (const outil of OUTILS_PROPOSITION_PEPINIERE) {
    const bloc = source.slice(source.indexOf(`\n  ${outil.nom}: {`));
    const params = bloc.slice(bloc.indexOf("params: ["), bloc.indexOf("headline:"));
    const attendus = [...params.matchAll(/"(p_[a-z_]+)"/g)].map((m) => m[1]);
    const offerts = Object.keys(
      (outil.parametres as unknown as { shape: Record<string, unknown> }).shape,
    );

    assert.deepEqual(
      offerts.toSorted(),
      attendus.toSorted(),
      `« ${outil.nom} » : le modèle remplit des champs que la proposition ne transmet pas, ` +
        "ou l'inverse",
    );
  }
});

// ==================================================================
// 3. ILS NE SONT PAS ENCORE BRANCHÉS, ET C'EST L'ÉTAT ATTENDU
// ==================================================================

test("aucun des trois n'est déjà au registre : une double déclaration ferait tout échouer", () => {
  // `OasisAIToolRegistry` lève à la construction sur un nom en double —
  // ce qui casserait le runtime ENTIER, pas seulement la Pépinière. Ce
  // test est donc aussi la garantie que l'intégration peut recopier
  // sans lire deux fois.
  //
  // Le jour où elle l'a fait, ce test échoue et il faut le supprimer
  // en même temps qu'on supprime ce fichier : les déclarations auront
  // rejoint `tools.ts`, qui a ses propres tests.
  const registre = registreOutils();
  for (const outil of TOUS) {
    assert.equal(
      registre.chercher(outil.nom),
      null,
      `« ${outil.nom} » est déjà au registre : retirez-le de runtime/outils/nursery.ts`,
    );
  }
});

test("les schémas acceptent un appel réaliste et refusent un appel vide", () => {
  // Le mode strict des sorties structurées exige que TOUTES les clés
  // soient présentes : les facultatives sont `.nullable()`, jamais
  // `.optional()`. Un schéma qui accepterait `{}` cacherait une
  // `.optional()` glissée par habitude.
  assert.doesNotThrow(() =>
    OUTIL_ANALYTIQUE_PEPINIERE.parametres.parse({ p_from: null, p_to: null }),
  );

  const lot = OUTILS_PROPOSITION_PEPINIERE.find((o) => o.nom === "createNurseryLot");
  assert.notEqual(lot, undefined);
  // Un lot sans espèce ni quantité doit être refusé par le schéma, pas
  // par la base : le refus SQL arriverait après l'appel de modèle.
  assert.throws(() => {
    lot?.parametres.parse({});
  });
  assert.doesNotThrow(() =>
    lot?.parametres.parse({
      p_species_name: "Cycas revoluta",
      p_initial_quantity: 50,
      p_lot_code: null,
      p_cultivar: null,
      p_container_size: "C3",
      p_stage_id: null,
      p_location_id: null,
      p_supplier_id: null,
      p_notes: null,
    }),
  );
});
