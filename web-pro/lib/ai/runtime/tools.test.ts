import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  CONSIGNE_FRONTIERE_DETERMINISTE,
  GRANDEURS_DETERMINISTES,
  GRANDEURS_SANS_SERVICE,
  OUTILS_SPEC_SANS_SERVICE,
  OasisAIToolRegistry,
  registreOutils,
} from "./tools.ts";
import type { Permission } from "./types.ts";

/**
 * §11V — LE REGISTRE D'OUTILS (spec p. 10-12).
 *
 * ══════════════════════════════════════════════════════════════════
 * LE TEST QUI JUSTIFIE CE FICHIER
 * ══════════════════════════════════════════════════════════════════
 *
 * « Vérifie chaque nom contre la base par requête avant de l'inscrire,
 *  c'est le défaut le plus silencieux de ce travail. »
 *
 * La vérification a été faite à la main, sur la production, avant
 * d'écrire `tools.ts`. Ce test la REND PERMANENTE : il relit les
 * migrations et échoue si un `rpc` déclaré n'y est défini nulle part.
 * Sans lui, la vérification serait vraie le jour où on l'a faite, et
 * fausse le jour où quelqu'un ajoute un outil de bonne foi.
 *
 * Il lit les MIGRATIONS et non la base : un test ne doit pas dépendre
 * d'un jeton de production. Une fonction présente en migration et pas
 * en base est un problème de déploiement, pas de déclaration.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..");
const dossierMigrations = join(racineDepot, "supabase", "migrations");

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

const registre = registreOutils();

// ==================================================================
// 1. LE DÉFAUT SILENCIEUX : un outil sans fonction derrière
// ==================================================================

test("chaque outil de LECTURE nomme une fonction Postgres qui existe", () => {
  const declarees = fonctionsDeclarees();
  assert.ok(declarees.size > 50, "les migrations n'ont pas été lues correctement");

  const fantomes: string[] = [];
  for (const outil of registre.tous()) {
    if (outil.famille !== "lecture") continue;
    assert.ok(outil.rpc !== undefined, `« ${outil.nom} » est une lecture sans fonction`);
    if (!declarees.has(String(outil.rpc).toLowerCase())) {
      fantomes.push(`${outil.nom} → ${outil.rpc}`);
    }
  }

  assert.deepEqual(
    fantomes,
    [],
    "un outil déclaré sans fonction derrière ne casse rien : le modèle l'appelle de bonne foi, " +
      "et l'utilisateur lit « Oasis ne peut pas répondre » six semaines plus tard.",
  );
});

test("chaque type d'action de MOTEUR figure au catalogue de la migration 0072", () => {
  const socle = readFileSync(join(dossierMigrations, "0072_phase11v_socle.sql"), "utf8");
  for (const outil of registre.tous()) {
    if (outil.famille !== "moteur") continue;
    assert.ok(outil.actionType !== undefined, `« ${outil.nom} » est un moteur sans actionType`);
    assert.ok(
      socle.includes(`'${outil.actionType}'`),
      `« ${outil.actionType} » n'est pas dans ai_action_catalog : la clé étrangère refuserait l'insertion`,
    );
  }
});

test("les outils qui PROPOSENT ne connaissent aucun nom de fonction", () => {
  for (const outil of registre.tous()) {
    if (outil.famille === "lecture") continue;
    assert.equal(
      outil.rpc,
      undefined,
      `« ${outil.nom} » porte un rpc : ce fichier ne doit pas pouvoir appeler une écriture, même par erreur`,
    );
  }
});

// ==================================================================
// 2. LA MINIMISATION, CÔTÉ OUTILS
// ==================================================================

/**
 * Le schéma JSON réellement transmis au fournisseur.
 *
 * `z.toJSONSchema` est la conversion que l'Agents SDK fait lui-même.
 * L'appeler ici a deux vertus : on inspecte ce qui PART vraiment, et un
 * schéma non convertible échoue dans ce test plutôt qu'au premier appel
 * d'agent en production.
 */
function schemaJson(schema: z.ZodType): {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
} {
  return z.toJSONSchema(schema) as ReturnType<typeof schemaJson>;
}

test("chaque schéma se convertit en JSON Schema — sinon l'échec arriverait au premier appel", () => {
  for (const outil of registre.tous()) {
    assert.doesNotThrow(() => schemaJson(outil.parametres), `« ${outil.nom} »`);
  }
});

test("aucun schéma n'expose l'organisation au modèle", () => {
  for (const outil of registre.tous()) {
    const serialise = JSON.stringify(schemaJson(outil.parametres));
    assert.ok(
      !serialise.includes("p_organization_id"),
      `« ${outil.nom} » laisse le modèle nommer une entreprise`,
    );
    assert.ok(
      !serialise.includes("p_user_id") && !serialise.includes("permission"),
      `« ${outil.nom} » laisse le modèle nommer un utilisateur ou un droit`,
    );
  }
});

test("chaque schéma est compatible du mode strict : rien d'optionnel, rien en trop", () => {
  // Le mode strict des sorties structurées OpenAI exige que TOUTES les
  // clés figurent dans `required` et que `additionalProperties` vaille
  // `false`. Un paramètre écrit `.optional()` au lieu de `.nullable()`
  // ne casse rien à la compilation et fait échouer l'appel.
  for (const outil of registre.tous()) {
    const schema = schemaJson(outil.parametres);
    const clefs = Object.keys(schema.properties ?? {});
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      [...clefs].sort(),
      `« ${outil.nom} » : un paramètre facultatif s'écrit .nullable(), jamais .optional()`,
    );
    assert.equal(schema.additionalProperties, false, `« ${outil.nom} »`);
  }
});

test("un agent ne reçoit que ses outils et les transverses", () => {
  const tous: Permission[] = [
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

  const finance = registre.pourAgent("finance", tous).map((o) => o.nom);
  assert.ok(finance.includes("getCompanyMetrics"));
  assert.ok(!finance.includes("createInvoiceDraft"), "Finance n'écrit rien");
  assert.ok(!finance.includes("getQuote"));

  const billing = registre.pourAgent("billing", tous).map((o) => o.nom);
  assert.ok(billing.includes("getUnbilledProjects"));
  assert.ok(billing.includes("createInvoiceDraft"));
  assert.ok(!billing.includes("getCompanyMetrics"));
});

test("un outil dont la permission manque n'est pas proposé au modèle", () => {
  const offerts = registre.pourAgent("billing", ["projects.read"]).map((o) => o.nom);
  assert.ok(!offerts.includes("getUnbilledProjects"), "il exige invoice.create");
  assert.ok(!offerts.includes("createInvoiceDraft"));

  const refuses = registre.refusesPourAgent("billing", ["projects.read"]);
  assert.ok(
    refuses.some((r) => r.outil === "getUnbilledProjects" && r.permission === "invoice.create"),
    "on doit pouvoir DIRE quel droit manque, pas seulement masquer le bouton",
  );
});

test("toute écriture réclame une confirmation", () => {
  for (const outil of registre.tous()) {
    if (outil.famille === "lecture") continue;
    assert.equal(
      outil.confirmationRequise,
      true,
      `« ${outil.nom} » écrirait sans confirmation : la page 14 l'interdit`,
    );
  }
});

test("aucune lecture ne réclame de confirmation : une question ne peut rien écrire", () => {
  for (const outil of registre.tous()) {
    if (outil.famille !== "lecture") continue;
    assert.equal(outil.confirmationRequise, false, `« ${outil.nom} »`);
  }
});

test("un outil déclaré deux fois échoue à la construction", () => {
  const unOutil = registre.tous()[0];
  assert.throws(() => new OasisAIToolRegistry([unOutil, unOutil]), /deux fois/);
});

// ==================================================================
// 3. LA FRONTIÈRE DÉTERMINISTE (p. 11-12)
// ==================================================================

test("chaque grandeur de la page 11 a une source SQL, ou est déclarée sans service", () => {
  const fournies = registre.grandeursFournies();
  const orphelines: string[] = [];

  for (const grandeur of GRANDEURS_DETERMINISTES) {
    if (fournies.has(grandeur)) continue;
    if (grandeur in GRANDEURS_SANS_SERVICE) continue;
    orphelines.push(grandeur);
  }

  assert.deepEqual(
    orphelines,
    [],
    "une grandeur que personne ne calcule et que personne ne déclare absente sera estimée par le modèle",
  );
});

test("la distance et le temps de déplacement sont déclarés SANS service", () => {
  // `ai_quote_price_analysis.deplacement` expose le siège, le chantier
  // et les heures devisées, et s'arrête là : aucun distancier.
  assert.ok("distance" in GRANDEURS_SANS_SERVICE);
  assert.ok("tempsDeDeplacement" in GRANDEURS_SANS_SERVICE);
  assert.ok(!registre.grandeursFournies().has("distance"));
  assert.ok(!registre.grandeursFournies().has("tempsDeDeplacement"));
});

test("la consigne à coller dans les agents dit les deux moitiés de la règle", () => {
  assert.match(CONSIGNE_FRONTIERE_DETERMINISTE, /Ne les recalcule jamais/);
  assert.match(CONSIGNE_FRONTIERE_DETERMINISTE, /Interprète, compare, expliqu/);
  assert.match(CONSIGNE_FRONTIERE_DETERMINISTE, /ne les estime pas/);
});

// ==================================================================
// 4. CE QUE LA SPEC DEMANDE ET QUI N'EXISTE PAS
// ==================================================================

test("les dix-huit outils de la page 10-11 sont tous traités : déclarés, couverts ou absents", () => {
  const NOMS_SPEC = [
    "getCompanyMetrics",
    "getRevenueSummary",
    "getUnpaidInvoices",
    "getUnbilledProjects",
    "getCompletedProjects",
    "getQuote",
    "getQuoteMargin",
    "getHistoricalProjectComparisons",
    "getTravelEstimate",
    "getNurseryStock",
    "getProjectedNurseryNeeds",
    "getSupplierPrices",
    "getFleetCosts",
    "getPlanningSummary",
    "createQuoteDraft",
    "createInvoiceDraft",
    "createPurchaseOrderDraft",
    "createPlanningProposal",
  ];

  const nonTraites = NOMS_SPEC.filter(
    (nom) =>
      registre.chercher(nom) === null &&
      !OUTILS_SPEC_SANS_SERVICE.some((entree) => entree.nomSpec === nom),
  );

  assert.deepEqual(
    nonTraites,
    [],
    "un outil de la spec ni déclaré ni expliqué se lit comme un oubli, et sera redéclaré à tort",
  );
});

test("les outils déclarés « absents » ne sont effectivement pas au registre", () => {
  for (const entree of OUTILS_SPEC_SANS_SERVICE) {
    if (entree.etat !== "absent") continue;
    assert.equal(
      registre.chercher(entree.nomSpec),
      null,
      `« ${entree.nomSpec} » est déclaré sans service ET présent au registre : l'un des deux ment`,
    );
  }
});

test("chaque outil non déclaré porte une explication, pas seulement une mention", () => {
  for (const entree of OUTILS_SPEC_SANS_SERVICE) {
    assert.ok(
      entree.explication.length > 40,
      `« ${entree.nomSpec} » : dire « non fait » sans dire pourquoi ne sert à personne`,
    );
  }
});
