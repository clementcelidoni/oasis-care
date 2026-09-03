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
 * §11V — LA SURCHARGE D'ENTREPRISE, RENDUE EFFECTIVE.
 *
 * Ce que ces tests défendent : le sélecteur de `/parametres/ia` ne
 * devient pas un bouton menteur le jour où les agents des étapes 9 à 12
 * arrivent — il suffira de décorer le routeur, et ce décorateur fait ce
 * qu'il annonce, y compris dans le cas désagréable où l'identifiant
 * surchargé ne correspond plus à rien.
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
// LE FIL TENDU : l'écran et le moteur doivent raconter la même chose
// ==================================================================

/**
 * `runnerAgents()` décore désormais son routeur avec les surcharges de
 * l'entreprise, et le bandeau d'attente de `/parametres/ia` a donc été
 * retiré le même jour. Ce test reste — il garde les deux fichiers
 * accordés dans les DEUX sens, y compris le jour où quelqu'un
 * débrancherait la ligne.
 *
 * Ce test défend les deux sens de la phrase, parce que les deux
 * mensonges coûtent cher et qu'aucun ne se voit à l'œil nu :
 *
 *   • brancher le décorateur sans retirer le bandeau ferait croire
 *     qu'un réglage est sans effet alors qu'il vient d'en prendre un —
 *     et quelqu'un le reposerait une seconde fois, ou renoncerait ;
 *
 *   • retirer le bandeau sans brancher le décorateur rendrait au
 *     sélecteur le statut de bouton menteur que tout `routage.ts`
 *     existe pour lui refuser.
 *
 * On ne teste donc pas un état figé : on teste que les deux fichiers
 * s'accordent. Le jour où la ligne est branchée, ce test échoue et
 * indique la phrase à retirer — ce qui est exactement le rappel qu'on
 * voudrait recevoir ce jour-là.
 */
test("le bandeau « enregistrée, pas encore appliquée » dit la vérité du moteur", () => {
  const racineWeb = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  const moteur = readFileSync(join(racineWeb, "lib", "ai", "runtime", "supabase.ts"), "utf8");
  const ecran = readFileSync(
    join(racineWeb, "app", "(app)", "parametres", "ia", "CarteAgents.tsx"),
    "utf8",
  );

  const moteurLitLesSurcharges = moteur.includes("appliquerSurcharges");
  // « pas encore appliquée » et non la phrase entière : dans le source
  // JSX l'apostrophe s'écrit `&apos;`, et un test qui chercherait le
  // texte tel qu'il s'affiche ne le trouverait jamais.
  const ecranAnnonceLAttente = ecran.includes("pas encore appliquée");

  assert.equal(
    ecranAnnonceLAttente,
    !moteurLitLesSurcharges,
    moteurLitLesSurcharges
      ? "runnerAgents() lit désormais les surcharges : retirez le bandeau d'attente de CarteAgents.tsx, la dérogation est réellement appliquée."
      : "runnerAgents() ignore toujours ai_model_overrides : CarteAgents.tsx doit continuer à dire que la dérogation est enregistrée et pas encore appliquée.",
  );
});
