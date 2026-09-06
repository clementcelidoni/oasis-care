import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OUTIL_SALES_FLOW } from "./sales.ts";
import { registreOutils } from "../tools.ts";

/**
 * §11Z — L'OUTIL DU FLUX COMMERCIAL, ÉPROUVÉ AVANT D'ÊTRE BRANCHÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * ÉPROUVER UN OUTIL QUI N'EST PAS ENCORE AU REGISTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'est importé par personne : `runtime/tools.ts` est partagé et
 * l'intégration l'y versera. Un objet qui n'est jamais exécuté est
 * précisément celui qu'il faut éprouver AVANT — sans quoi il entre au
 * catalogue le jour de la fusion, sans que rien ne l'ait jamais lu.
 *
 * La règle qui tient tout le registre — « aucun outil déclaré dont la
 * fonction SQL n'existe pas » — se vérifie ici dès aujourd'hui, contre
 * les migrations, parce que `ai_sales_flow` est déjà écrite dans
 * `0088_agents_derniers.sql`. C'est la différence avec les outils de
 * §11Y, qui attendaient leur SQL dans un fichier voisin.
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

// ==================================================================
// 1. LA RÈGLE QUI TIENT TOUT LE REGISTRE
// ==================================================================

test("l'outil nomme une fonction réellement définie par une migration", () => {
  // LE DÉFAUT LE PLUS SILENCIEUX DU LOT : un outil au joli nom, au joli
  // schéma, et un `rpc` qui n'existe nulle part. Rien ne le signale au
  // développeur. Rien ne le signale au modèle, qui l'appellera de bonne
  // foi. Ce qui remonte six semaines plus tard, c'est « Oasis dit qu'il
  // ne peut pas répondre ».
  assert.equal(OUTIL_SALES_FLOW.rpc, "ai_sales_flow");
  assert.match(
    migrations(),
    /create or replace function public\.ai_sales_flow\s*\(/,
    "`ai_sales_flow` n'est définie par aucune migration",
  );
});

test("la signature attendue est celle que la migration déclare", () => {
  // Trois paramètres, dans cet ordre : l'organisation, puis les deux
  // bornes de la fenêtre. Le schéma Zod ci-dessous n'en expose que deux
  // — voir le test suivant.
  const sql = migrations();
  const debut = sql.indexOf("create or replace function public.ai_sales_flow");
  assert.ok(debut >= 0);
  const signature = sql.slice(debut, debut + 200);
  assert.match(signature, /p_organization_id uuid/);
  assert.match(signature, /p_from\s+date default null/);
  assert.match(signature, /p_to\s+date default null/);
});

// ==================================================================
// 2. L'ORGANISATION NE PASSE PAS PAR LE MODÈLE
// ==================================================================

test("l'organisation vient de la SESSION : le modèle ne peut pas la nommer", () => {
  // « Organisation A ne peut jamais interroger Organisation B » (p. 22).
  // Un paramètre d'organisation exposé au modèle ferait reposer cette
  // promesse sur la bonne volonté d'un modèle de langage.
  assert.equal(OUTIL_SALES_FLOW.injecteOrganisation, true);

  const forme = JSON.stringify(OUTIL_SALES_FLOW.parametres, null, 0);
  assert.ok(
    !forme.includes("organization"),
    "le schéma exposé au modèle ne doit contenir aucun identifiant d'organisation",
  );

  const accepte = OUTIL_SALES_FLOW.parametres.safeParse({
    p_from: null,
    p_to: null,
    p_organization_id: "00000000-0000-0000-0000-000000000000",
  });
  assert.ok(accepte.success, "le schéma reste tolérant, mais…");
  assert.ok(
    !Object.hasOwn(accepte.data as object, "p_organization_id"),
    "…une organisation glissée par le modèle doit être ÉCARTÉE à l'analyse, pas transmise",
  );
});

test("le schéma exige les deux bornes, même à null", () => {
  // `.nullable()` et non `.optional()` : le mode strict des sorties
  // structurées exige que toutes les clés soient présentes, et une clé
  // absente y devient une erreur de schéma plutôt qu'un défaut.
  assert.ok(OUTIL_SALES_FLOW.parametres.safeParse({ p_from: null, p_to: null }).success);
  assert.ok(OUTIL_SALES_FLOW.parametres.safeParse({ p_from: "2026-01-01", p_to: "2026-09-05" }).success);
  assert.ok(!OUTIL_SALES_FLOW.parametres.safeParse({}).success, "une clé absente doit être refusée");
});

// ==================================================================
// 3. IL APPARTIENT AUX VENTES, EN LECTURE, ET IL NE REND AUCUN EURO
// ==================================================================

test("il appartient aux Ventes, en lecture seule, sans confirmation", () => {
  assert.equal(OUTIL_SALES_FLOW.agent, "sales");
  assert.equal(OUTIL_SALES_FLOW.famille, "lecture");
  assert.equal(OUTIL_SALES_FLOW.risque, "low");
  assert.equal(OUTIL_SALES_FLOW.confirmationRequise, false);
  assert.equal(OUTIL_SALES_FLOW.actionType, undefined, "un outil de lecture n'a pas d'action");
});

test("il ne FOURNIT aucune grandeur déterministe, et ce n'est pas un oubli", () => {
  // `fournit` dit quelles grandeurs un outil apporte DÉJÀ CALCULÉES.
  // Celui-ci n'en apporte aucune parce qu'il ne rend aucun euro : le
  // prix, le coût, la marge et le total d'un devis appartiennent au
  // Chiffrage, et un second producteur des mêmes chiffres finirait par
  // en donner d'autres.
  assert.deepEqual([...OUTIL_SALES_FLOW.fournit], []);
  assert.match(OUTIL_SALES_FLOW.description, /AUCUN MONTANT DE DEVIS N'EST RENDU/);
});

test("le seul entier de centimes qu'il laisse passer est annoncé comme n'étant PAS un devis", () => {
  // `crm_opportunities.estimated_value_cents` est une estimation saisie
  // à la main. Un entier de centimes ressemble beaucoup à un montant de
  // devis quand on le lit vite — et un modèle qui l'additionne à un
  // chiffre d'affaires produit un nombre plausible et faux.
  assert.match(OUTIL_SALES_FLOW.description, /valeurEstimeeCents/);
  assert.match(OUTIL_SALES_FLOW.description, /n'est PAS un montant de devis/);
  assert.match(OUTIL_SALES_FLOW.description, /Ne l'additionne à aucun chiffre d'affaires/);
});

// ==================================================================
// 4. CE QUE LA DESCRIPTION DOIT DIRE AU MODÈLE
// ==================================================================

test("elle renvoie les devis OUVERTS au briefing, et interdit de les recompter", () => {
  assert.match(OUTIL_SALES_FLOW.description, /renvoiDevisOuverts/);
  assert.match(OUTIL_SALES_FLOW.description, /ne les recompte jamais/);
  // ET LA PRÉCAUTION QUI COMPTE AUTANT : le briefing ne rend que ses
  // cinq premières lignes classées. Une liste vide n'y prouve donc pas
  // qu'aucun devis ne dort — seulement qu'aucun n'est dans le top 5. Un
  // modèle qui l'ignorerait annoncerait « aucun devis en attente » à un
  // dirigeant qui en a douze.
  assert.match(OUTIL_SALES_FLOW.description, /cinq premières lignes/);
});

test("elle distingue « pas assez de données » d'un chiffre, et donne le motif", () => {
  assert.match(OUTIL_SALES_FLOW.description, /tauxDeSignaturePct/);
  assert.match(OUTIL_SALES_FLOW.description, /vingt décisions/);
  assert.match(OUTIL_SALES_FLOW.description, /tauxMotif/);
  assert.match(OUTIL_SALES_FLOW.description, /delaiMotif/);
  assert.match(
    OUTIL_SALES_FLOW.description,
    /vaudrait 100 % et ne décrirait rien/,
    "il faut expliquer POURQUOI le taux est refusé, sinon le modèle le reconstruit",
  );
});

test("elle distingue « personne n'a rien saisi » de « il n'y a rien »", () => {
  // La confusion zéro / je-ne-sais-pas, déjà corrigée quatre fois dans
  // ce produit. Ici elle porte sur deux tables entièrement vides depuis
  // l'ouverture de l'entreprise.
  assert.match(OUTIL_SALES_FLOW.description, /TotalTouteHistoire/);
  assert.match(OUTIL_SALES_FLOW.description, /personne n'a jamais rempli l'écran Opportunités/);
  assert.match(OUTIL_SALES_FLOW.description, /n'est pas « vous ne perdez jamais »/);
});

test("elle interdit la phrase « le client ne l'a pas ouvert »", () => {
  assert.match(OUTIL_SALES_FLOW.description, /marquageDeLecture/);
  assert.match(OUTIL_SALES_FLOW.description, /aucun accusé de lecture/);
  assert.match(OUTIL_SALES_FLOW.description, /jamais « le client ne l'a pas ouvert »/);
});

test("elle nomme les décisions instantanées pour ce qu'elles sont", () => {
  // Le seul devis de la production a été décidé DIX-NEUF SECONDES après
  // son envoi. C'est une saisie de recette, pas une décision de client,
  // et le SQL la détecte (`c_instantane_s constant int := 120`) plutôt
  // que de laisser le modèle la deviner.
  assert.match(OUTIL_SALES_FLOW.description, /decisionsQuasiInstantanees/);
  assert.match(OUTIL_SALES_FLOW.description, /saisies de recette/);
  assert.match(migrations(), /c_instantane_s\s+constant int := 120;/);
});

test("le plafond annoncé est celui que le SQL applique", () => {
  // Deux plafonds qui divergent, c'est un tableau tronqué à un endroit
  // et pas à l'autre — donc un modèle qui reçoit moins de lignes qu'on
  // ne lui a dit.
  assert.equal(OUTIL_SALES_FLOW.maxElements, 50);
  assert.match(migrations(), /c_max\s+constant int := 50;/);
});

// ==================================================================
// 5. LE REGISTRE — AVANT ET APRÈS L'INTÉGRATION
// ==================================================================

test("s'il est au registre, c'est CET objet-ci et pas une copie", () => {
  // ─── LE TEST QUI BASCULE TOUT SEUL ───
  //
  // Tant que l'intégration n'a pas versé l'outil, le registre ne le
  // connaît pas : c'est l'état juste, et `tools.test.ts` échouerait à
  // raison sur un outil orphelin. Le jour où il y entre, ce test exige
  // que ce soit CET objet — pas une déclaration recopiée à la main dans
  // `tools.ts`, qui serait la seconde vérité, et c'est toujours la
  // seconde qui ment.
  const inscrit = registreOutils()
    .tous()
    .find((o) => o.nom === "getSalesFlow");

  if (inscrit === undefined) {
    assert.ok(true, "pas encore intégré : versez OUTIL_SALES_FLOW dans OUTILS_LECTURE");
    return;
  }
  assert.equal(inscrit, OUTIL_SALES_FLOW, "le catalogue porte une COPIE de l'outil, pas l'outil");
});

test("aucun autre outil du registre ne prétend appartenir aux Ventes", () => {
  // La moitié « outils » de la minimisation de la page 20 : un agent ne
  // reçoit que les siens et les transverses. Un outil d'écriture rangé
  // sous « sales » mettrait entre les mains du modèle une capacité que
  // l'agent s'interdit par une limite — et c'est la limite qui perdrait.
  for (const outil of registreOutils().tous()) {
    if (outil.agent !== "sales") continue;
    assert.equal(outil.nom, "getSalesFlow", `« ${outil.nom} » est rangé sous les Ventes`);
    assert.equal(outil.famille, "lecture", "les Ventes n'ont aucun outil d'écriture");
  }
});
