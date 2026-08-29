import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  NAVIGATION, DELIVERED_THROUGH_MILESTONE, UNSCHEDULED, isAvailable, visibleNavigation,
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

function flatten() {
  const items = [];
  for (const item of NAVIGATION) {
    items.push(item);
    for (const child of item.children ?? []) items.push(child);
  }
  return items;
}

/** Les emplacements possibles d'une page, groupe de routes compris. */
function pageExists(href: string): boolean {
  const segment = href === "/" ? "" : href;
  return [`app/(app)${segment}/page.tsx`, `app${segment}/page.tsx`]
    .some((candidate) => fs.existsSync(path.join(root, candidate)));
}

test("chaque lien annoncé comme livré mène à une page réelle", () => {
  const broken = flatten()
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
  const hiddenButBuilt = flatten()
    .filter((item) => !isAvailable(item))
    .filter((item) => pageExists(item.href))
    .map((item) => `${item.label} → ${item.href}`);

  assert.deepEqual(
    hiddenButBuilt, [],
    `Ces pages existent mais restent annoncées « à venir » :\n  ${hiddenButBuilt.join("\n  ")}`,
  );
});

test("aucun lien n'est proposé deux fois au même endroit", () => {
  // Deux entrées vers la même adresse dans un même niveau font douter
  // qu'elles mènent au même écran.
  for (const parent of NAVIGATION) {
    const hrefs = (parent.children ?? []).map((c) => c.href);
    assert.equal(
      new Set(hrefs).size, hrefs.length,
      `Doublon sous « ${parent.label} » : ${hrefs.join(", ")}`,
    );
  }
});

test("le filtrage par permission cache réellement", () => {
  // Le menu MONTRE ou CACHE ; ce n'est jamais lui qui protège — RLS
  // s'en charge. Mais il doit au moins faire ce qu'il annonce.
  const withoutQuotes = visibleNavigation("landscaper", ["clients.read"]);
  assert.equal(withoutQuotes.some((i) => i.href === "/devis"), false);
  assert.equal(withoutQuotes.some((i) => i.href === "/crm"), true);
});

test("un pépiniériste ne voit pas les modules de paysagiste, et l'inverse", () => {
  const permissions = [
    "clients.read", "quotes.read", "projects.read", "projects.manage",
    "nursery.stock.manage", "digitalTwin.edit", "invoice.create",
  ] as const;

  const nursery = visibleNavigation("nursery", [...permissions]);
  const landscaper = visibleNavigation("landscaper", [...permissions]);

  assert.equal(nursery.some((i) => i.href === "/pepiniere"), true);
  assert.equal(nursery.some((i) => i.href === "/projets"), false);
  assert.equal(landscaper.some((i) => i.href === "/projets"), true);
  assert.equal(landscaper.some((i) => i.href === "/pepiniere"), false);
});

test("chaque module est dans le plan, ou explicitement hors plan", () => {
  assert.ok(DELIVERED_THROUGH_MILESTONE >= 1 && DELIVERED_THROUGH_MILESTONE <= 12);

  // Un numéro entre 1 et 12, ou le marqueur « non programmé ». Rien
  // entre les deux : un 13 inventé s'allumerait un jour sans qu'aucune
  // ligne de la spec ne le prévoie.
  const strays = flatten()
    .filter((i) => i.milestone !== UNSCHEDULED && (i.milestone < 1 || i.milestone > 12))
    .map((i) => `${i.label} → milestone ${i.milestone}`);
  assert.deepEqual(strays, [], `Milestones hors bornes : ${strays.join(", ")}`);

  // Et le marqueur doit rester hors d'atteinte du compteur.
  assert.ok(UNSCHEDULED > 12);
});
