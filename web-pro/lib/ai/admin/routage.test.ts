import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AIModelRouter } from "../model/router.ts";
import type { PortRoutage } from "../runtime/run.ts";
import { appliquerSurcharges } from "./routage.ts";
import type { CleAgentSql } from "./types.ts";

/**
 * §11V / §11X — LA SURCHARGE POSÉE PAR L'ÉDITEUR, RENDUE EFFECTIVE.
 *
 * Ce que ces tests défendent : la dérogation qu'un administrateur de
 * plateforme pose sur une entreprise (0080) fait exactement ce qu'elle
 * annonce sur le prochain appel — y compris dans le cas désagréable où
 * l'identifiant surchargé ne correspond plus à rien.
 *
 * Le décorateur, lui, n'a pas bougé d'un caractère avec le déménagement
 * de l'écran : le MOTEUR reste dans Oasis Care Pro, seule l'interface
 * de réglage est partie. C'est même pour cela que la migration 0080 a
 * conservé la politique de lecture « Members read » sur
 * `ai_model_overrides` — sans elle, `lireSurchargesModeles()` rendrait
 * une carte vide et la dérogation disparaîtrait sans erreur.
 */

function port(env: Record<string, string> = {}): {
  base: PortRoutage;
  modeles: ReturnType<AIModelRouter["modelesConfigures"]>;
} {
  const routeur = new AIModelRouter({ env });
  return { base: routeur, modeles: routeur.modelesConfigures() };
}

function carte(entrees: [CleAgentSql, string][]): ReadonlyMap<CleAgentSql, string> {
  return new Map(entrees);
}

test("sans surcharge, le routeur est rendu tel quel", () => {
  const { base, modeles } = port();
  assert.equal(appliquerSurcharges(base, carte([]), modeles), base);
});

test("une surcharge remplace le modèle ET le niveau annoncé", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(
    base,
    carte([["finance", modeles.advanced]]),
    modeles,
  );

  const avant = base.resolve({ agent: "finance" });
  assert.equal(avant.niveau, "standard");

  const apres = decore.resolve({ agent: "finance" });
  assert.equal(apres.modele, modeles.advanced);
  assert.equal(
    apres.niveau,
    "advanced",
    "sinon le grand livre rangerait la dépense au mauvais étage",
  );
  assert.ok(apres.raisons.some((r) => r.includes("Surcharge de l'entreprise")));
});

test("la surcharge ne touche que son agent", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["finance", modeles.advanced]]), modeles);

  for (const agent of ["billing", "executive", "quote_pricing", "nursery"]) {
    assert.deepEqual(
      decore.resolve({ agent }),
      base.resolve({ agent }),
      `${agent} a bougé alors que seule finance était surchargée`,
    );
  }
});

test("la graphie SQL et la graphie de la spec désignent le même agent", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["quote_pricing", modeles.economy]]), modeles);

  assert.equal(decore.resolve({ agent: "quote_pricing" }).modele, modeles.economy);
  assert.equal(decore.resolve({ agent: "quotePricing" }).modele, modeles.economy);
});

test("une surcharge décrochée impose le modèle mais N'INVENTE PAS de niveau", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["billing", "gpt-5.6-nom-perime"]]), modeles);

  const decision = decore.resolve({ agent: "billing" });
  assert.equal(decision.modele, "gpt-5.6-nom-perime");
  assert.equal(decision.niveau, "standard", "le niveau du routeur, inchangé");
  assert.ok(
    decision.raisons.some((r) => r.includes("ne correspond à aucun")),
    "la raison doit dire que niveau et modèle ne se décrivent plus l'un l'autre",
  );
});

test("les signaux de routage continuent de jouer sous la surcharge", () => {
  // La surcharge fixe le modèle final ; elle ne doit pas neutraliser les
  // raisons qui ont conduit là, sans quoi une décision partie sur le
  // mauvais modèle serait inexplicable.
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["billing", modeles.economy]]), modeles);

  const decision = decore.resolve({ agent: "billing", financialImpact: 3_845_000 });
  assert.ok(decision.raisons.some((r) => r.includes("Impact financier")));
  assert.equal(decision.modele, modeles.economy);
});

test("`modelePourNiveau` n'est PAS surchargé : le repli descend sur le modèle du produit", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["finance", "un-modele-a-part"]]), modeles);

  assert.equal(decore.modelePourNiveau("standard"), modeles.standard);
  assert.equal(decore.modelePourNiveau("economy"), modeles.economy);
});

test("une surcharge identique au modèle déjà choisi ne salit pas les raisons", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["finance", modeles.standard]]), modeles);

  const decision = decore.resolve({ agent: "finance" });
  assert.equal(decision.modele, modeles.standard);
  assert.ok(!decision.raisons.some((r) => r.includes("Surcharge")));
});

test("un agent hors catalogue traverse le décorateur sans dommage", () => {
  const { base, modeles } = port();
  const decore = appliquerSurcharges(base, carte([["finance", modeles.advanced]]), modeles);

  const decision = decore.resolve({ agent: "agent-inexistant" });
  assert.equal(decision.agent, null);
  assert.equal(decision.modele, base.resolve({ agent: "agent-inexistant" }).modele);
});

// ==================================================================
// LE FIL TENDU : la surcharge de l'éditeur doit atteindre le moteur
// ==================================================================

/**
 * CE TEST A CHANGÉ DE CAMP LE JOUR OÙ L'ÉCRAN DE RÉGLAGE EST PARTI.
 *
 * Il vérifiait auparavant que `/parametres/ia/CarteAgents.tsx` et
 * `runtime/supabase.ts` racontaient la même histoire : tant que le
 * moteur ignorait `ai_model_overrides`, l'écran devait porter un
 * bandeau « enregistrée, pas encore appliquée », et le retirer le jour
 * où la ligne serait branchée. Cet écran n'existe plus dans Oasis Care
 * Pro : le choix du modèle appartient à l'éditeur et se règle depuis le
 * Control Center (migration 0080 — plus aucune politique d'écriture
 * pour le client sur `ai_model_overrides`).
 *
 * Ce qui reste, c'est la moitié qui porte le risque, et elle est
 * DEVENUE PLUS GRAVE, pas moins :
 *
 *   Une dérogation posée par l'éditeur est désormais délibérée, motivée
 *   et journalisée (`admin_set_ai_model_override`, 0080). Si personne
 *   ne décore le routeur avec `appliquerSurcharges`, elle est
 *   enregistrée, tracée, réputée active — et sans le moindre effet sur
 *   un appel. Le client, lui, ne peut plus s'en apercevoir : il n'a
 *   plus d'écran qui affiche l'aiguillage de ses agents.
 *
 * On ne teste donc plus un accord entre deux fichiers : on teste que le
 * fil est branché. Le jour où quelqu'un débranche cette ligne pour
 * simplifier un import, ce test le dit tout de suite.
 */
test("le moteur applique bien les surcharges lues en base", () => {
  const racineWeb = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const moteur = readFileSync(join(racineWeb, "lib", "ai", "runtime", "supabase.ts"), "utf8");

  assert.ok(
    moteur.includes("appliquerSurcharges"),
    "runtime/supabase.ts ne décore plus le routeur : une surcharge posée par l'éditeur dans " +
      "ai_model_overrides serait enregistrée et journalisée sans jamais changer un appel.",
  );
});
