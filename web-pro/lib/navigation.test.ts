import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  NAVIGATION, DELIVERED_THROUGH_MILESTONE, UNSCHEDULED, REFONTE,
  TOGGLEABLE_MODULES, MODULE_LABELS,
  isAvailable, visibleNavigation, allNavItems,
} from "./navigation.ts";

/**
 * Le menu ne doit jamais promettre une page qui n'existe pas.
 *
 * Ce test est né d'un 404 : porter `DELIVERED_THROUGH_MILESTONE` à 8 a
 * allumé d'un coup tous les liens marqués « milestone ≤ 8 », dont un
 * que personne n'avait construit. Rien ne le signalait — ni la
 * compilation, ni le lint, ni les tests — parce qu'un lien mort est du
 * texte parfaitement valide.
 *
 * Le contrôle est mécanique : pour chaque lien annoncé comme livré, un
 * fichier `page.tsx` doit exister au chemin correspondant.
 */

const root = path.resolve(import.meta.dirname, "..");

/** Les emplacements possibles d'une page, groupe de routes compris. */
function pageExists(href: string): boolean {
  const segment = href === "/" ? "" : href;
  return [`app/(app)${segment}/page.tsx`, `app${segment}/page.tsx`]
    .some((candidate) => fs.existsSync(path.join(root, candidate)));
}

test("chaque lien annoncé comme livré mène à une page réelle", () => {
  const broken = allNavItems()
    .filter(isAvailable)
    .filter((item) => !pageExists(item.href))
    .map((item) => `${item.label} → ${item.href}`);

  assert.deepEqual(
    broken, [],
    `Ces liens sont marqués livrés mais n'ont pas de page :\n  ${broken.join("\n  ")}`,
  );
});

test("un module à venir ne pointe vers rien de cliquable", () => {
  // L'inverse compte aussi : une page construite mais laissée « à
  // venir » serait invisible, et personne ne s'en apercevrait.
  const hiddenButBuilt = allNavItems()
    .filter((item) => !isAvailable(item))
    .filter((item) => pageExists(item.href))
    .map((item) => `${item.label} → ${item.href}`);

  assert.deepEqual(
    hiddenButBuilt, [],
    `Ces pages existent mais restent annoncées « à venir » :\n  ${hiddenButBuilt.join("\n  ")}`,
  );
});

test("aucune adresse n'apparaît deux fois dans le menu", () => {
  // Deux entrées vers la même adresse font douter qu'elles mènent au
  // même écran — et avec des groupes, le doublon peut désormais
  // traverser deux sections sans qu'on le voie.
  const hrefs = allNavItems().map((item) => item.href);
  const seen = new Set<string>();
  const duplicates = hrefs.filter((href) => (seen.has(href) ? true : (seen.add(href), false)));
  assert.deepEqual(duplicates, [], `Adresses en double : ${duplicates.join(", ")}`);
});

test("chaque groupe a un nom et au moins un lien", () => {
  for (const group of NAVIGATION) {
    assert.ok(group.label.length > 0, "un groupe sans nom");
    assert.ok(group.items.length > 0, `le groupe « ${group.label} » est vide`);
  }
});

test("le filtrage par permission cache réellement", () => {
  // Le menu MONTRE ou CACHE ; ce n'est jamais lui qui protège — RLS
  // s'en charge. Mais il doit au moins faire ce qu'il annonce.
  const withoutQuotes = visibleNavigation("landscaper", ["clients.read"]);
  const hrefs = allNavItems(withoutQuotes).map((item) => item.href);
  assert.equal(hrefs.includes("/devis"), false);
  assert.equal(hrefs.includes("/crm/clients"), true);
});

test("un pépiniériste ne voit pas les modules de paysagiste, et l'inverse", () => {
  const permissions = [
    "clients.read", "quotes.read", "projects.read", "projects.manage",
    "nursery.stock.manage", "digitalTwin.edit", "invoice.create",
  ] as const;

  const nursery = allNavItems(visibleNavigation("nursery", [...permissions])).map((i) => i.href);
  const landscaper = allNavItems(visibleNavigation("landscaper", [...permissions])).map((i) => i.href);

  assert.equal(nursery.includes("/pepiniere"), true);
  assert.equal(nursery.includes("/projets"), false);
  assert.equal(landscaper.includes("/projets"), true);
  assert.equal(landscaper.includes("/pepiniere"), false);
});

test("§43 — éteindre un module le retire du menu, et vide son groupe", () => {
  const permissions = [
    "clients.read", "quotes.read", "projects.read", "projects.manage",
    "nursery.stock.manage", "digitalTwin.edit", "invoice.create",
  ] as const;

  const withNursery = visibleNavigation("landscaperAndNursery", [...permissions]);
  assert.ok(withNursery.some((g) => g.label === "Pépinière"));

  const without = visibleNavigation("landscaperAndNursery", [...permissions], ["nursery"]);
  // Le groupe entier disparaît : une section vide ressemble à une
  // panne, pas à un réglage.
  assert.equal(without.some((g) => g.label === "Pépinière"), false);
  // Et le reste ne bouge pas.
  assert.ok(allNavItems(without).some((i) => i.href === "/devis"));
});

test("chaque module débrayable porte un libellé", () => {
  for (const key of TOGGLEABLE_MODULES) {
    assert.ok(MODULE_LABELS[key], `le module ${key} n'a pas de libellé`);
  }
  // Et l'inverse : un libellé orphelin traînerait dans l'écran des
  // réglages sans rien commander.
  for (const key of Object.keys(MODULE_LABELS)) {
    assert.ok(
      (TOGGLEABLE_MODULES as readonly string[]).includes(key),
      `le libellé ${key} ne correspond à aucun module`,
    );
  }
});

test("chaque module est dans le plan, ou explicitement hors plan", () => {
  assert.ok(DELIVERED_THROUGH_MILESTONE >= 1 && DELIVERED_THROUGH_MILESTONE <= REFONTE);

  const strays = allNavItems()
    .filter((i) => i.milestone !== UNSCHEDULED && (i.milestone < 1 || i.milestone > REFONTE))
    .map((i) => `${i.label} → milestone ${i.milestone}`);
  assert.deepEqual(strays, [], `Milestones hors bornes : ${strays.join(", ")}`);

  // Et le marqueur doit rester hors d'atteinte du compteur.
  assert.ok(UNSCHEDULED > REFONTE);
});
