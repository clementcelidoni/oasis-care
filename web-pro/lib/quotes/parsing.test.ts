import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseNumber, parseQuantity, parseQuantityOr, parseVatRate,
  inputToCents, centsToInput, VAT_RATES,
} from "./types.ts";

/**
 * ZÉRO N'EST PAS « RIEN ».
 *
 * Ce fichier est né d'un bug d'argent trouvé en revue. Six Server
 * Actions écrivaient :
 *
 *     vat_rate: parseQuantity(saisie) || 20
 *
 * pour se prémunir d'une saisie incompréhensible. Mais `0 || 20` vaut
 * 20. Un artisan en franchise en base de TVA — le régime de la plupart
 * des auto-entrepreneurs — qui choisissait « 0 % » dans la liste, que
 * l'interface PROPOSE, voyait sa facture émise à 20 %. Aucune erreur,
 * aucun message : juste un cinquième de trop sur le document.
 *
 * La règle, désormais : un repli s'applique à ce qui N'EST PAS un
 * nombre. Jamais à un nombre qui vaut zéro.
 */

test("un zéro saisi reste un zéro", () => {
  assert.equal(parseNumber("0"), 0);
  assert.equal(parseVatRate("0"), 0);
  assert.equal(parseQuantityOr("0", 1), 0);
});

test("une saisie illisible retombe sur le repli", () => {
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseVatRate("abc"), 20);
  assert.equal(parseVatRate("abc", 10), 10);
  assert.equal(parseQuantityOr("", 1), 1);
  assert.equal(parseQuantityOr("   ", 1), 1);
});

test("la virgule française et les espaces sont acceptés", () => {
  assert.equal(parseNumber("5,5"), 5.5);
  assert.equal(parseVatRate("5,5"), 5.5);
  assert.equal(parseNumber("1 250,75"), 1250.75);
  assert.equal(parseQuantityOr("2,5", 1), 2.5);
});

test("chaque taux proposé par l'interface survit à l'aller-retour", () => {
  // Le lien direct entre la liste affichée et l'analyse : si un taux
  // de la liste ne se relit pas tel quel, l'utilisateur ne peut pas le
  // choisir, quoi qu'on affiche.
  for (const rate of VAT_RATES) {
    assert.equal(
      parseVatRate(String(rate)), rate,
      `le taux ${rate} % proposé dans l'interface ne se relit pas`,
    );
  }
});

test("un taux de TVA négatif n'existe pas et retombe sur le repli", () => {
  assert.equal(parseVatRate("-20"), 20);
  assert.equal(parseVatRate("-0.5", 10), 10);
});

test("une quantité négative passe : c'est une reprise, pas une erreur", () => {
  // Sur une facture, une ligne à quantité négative est une remise ou un
  // retour de marchandise. La refuser obligerait à passer un avoir pour
  // une ligne de trois euros.
  assert.equal(parseQuantityOr("-2", 1), -2);
});

test("parseQuantity garde son comportement historique", () => {
  // Utilisée ailleurs sans repli : l'illisible y vaut zéro, et c'est
  // voulu — mais elle ne doit plus servir à lire un taux de TVA.
  assert.equal(parseQuantity("abc"), 0);
  assert.equal(parseQuantity("3"), 3);
});

test("les centimes font l'aller-retour sans dériver", () => {
  for (const value of ["0", "0,01", "12,34", "1 500", "1500,00", "-42,50"]) {
    const cents = inputToCents(value);
    assert.equal(
      inputToCents(centsToInput(cents)), cents,
      `${value} ne revient pas à lui-même`,
    );
  }
  assert.equal(inputToCents("0"), 0);
  assert.equal(inputToCents("12,34"), 1234);
});

/**
 * Le garde-fou mécanique.
 *
 * Le bug n'était pas une faute de raisonnement, c'était un motif copié
 * six fois. Un test qui ne vérifierait que les fonctions laisserait le
 * septième passer. Celui-ci relit le code des Server Actions.
 */
test("aucune Server Action ne relit un montant avec `|| valeur`", () => {
  const root = path.resolve(import.meta.dirname, "..");

  function walk(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
    });
  }

  // `parseQuantity(...) || 1`, `parseNumber(...) || 20`, et toute
  // variante : un `||` derrière une lecture de nombre écrase le zéro.
  const guilty: string[] = [];
  for (const file of walk(root)) {
    const source = fs.readFileSync(file, "utf8");
    source.split("\n").forEach((line, index) => {
      // Les commentaires sont exclus — celui qui explique le bug le
      // cite forcément, et se dénoncerait lui-même.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

      if (/parse(Number|Quantity|VatRate|QuantityOr)\s*\([^)]*\)[^)\n]*\|\|/.test(line)) {
        guilty.push(`${path.relative(root, file)}:${index + 1} — ${trimmed}`);
      }
    });
  }

  assert.deepEqual(
    guilty, [],
    `Un repli en \`||\` derrière une lecture de nombre écrase le zéro :\n  ${guilty.join("\n  ")}`,
  );
});
