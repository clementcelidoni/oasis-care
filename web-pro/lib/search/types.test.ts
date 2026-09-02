import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, matchCommands, SEARCH_GROUPS, ENTITY_TYPES, ENTITY_LABELS } from "./types.ts";

/**
 * §26 RECHERCHE AVANCÉE — « Préparer syntaxe facultative » et surtout
 * « Ne pas obliger l'utilisateur à connaître cette syntaxe ».
 *
 * Ces tests fixent les deux moitiés de cette phrase : la syntaxe MARCHE
 * quand on la connaît, et NE GÊNE PAS quand on l'ignore. Le second cas
 * est le plus facile à casser — un analyseur zélé qui mange « type de
 * sol » rend la recherche inutilisable pour tout le monde sauf son
 * auteur.
 */

test("une recherche ordinaire n'est pas interprétée", () => {
  const parsed = parseQuery("Villa Martin");
  assert.equal(parsed.text, "Villa Martin");
  assert.equal(parsed.types, null);
  assert.deepEqual(parsed.keywords, []);
});

test("§26 — `type:devis Martin` restreint aux devis", () => {
  const parsed = parseQuery("type:devis Martin");
  assert.equal(parsed.text, "Martin");
  assert.deepEqual(parsed.types, ["quote", "quote_line"]);
  assert.deepEqual(parsed.keywords, ["type:devis"]);
});

test("§26 — `type:lot Trachycarpus`", () => {
  const parsed = parseQuery("type:lot Trachycarpus");
  assert.equal(parsed.text, "Trachycarpus");
  assert.deepEqual(parsed.types, ["lot"]);
});

test("le mot-clé peut être ailleurs que devant", () => {
  const parsed = parseQuery("Martin type:facture");
  assert.equal(parsed.text, "Martin");
  assert.deepEqual(parsed.types, ["invoice"]);
});

test("deux mots-clés s'additionnent, sans doublon", () => {
  const parsed = parseQuery("type:devis type:facture Martin");
  assert.equal(parsed.text, "Martin");
  assert.deepEqual(parsed.types, ["quote", "quote_line", "invoice"]);
});

test("les accents et la casse du mot-clé sont indifférents", () => {
  assert.deepEqual(parseQuery("type:Propriété Nice").types, ["site"]);
  assert.deepEqual(parseQuery("TYPE:DEVIS x").types, ["quote", "quote_line"]);
});

test("un mot-clé inconnu redevient du texte, sans erreur", () => {
  // Quelqu'un qui cherche « type de sol argileux » ne doit pas voir sa
  // recherche amputée, ni un message d'erreur.
  const parsed = parseQuery("statut:inconnu argileux");
  assert.equal(parsed.text, "statut:inconnu argileux");
  assert.equal(parsed.types, null);
});

test("un deux-points en cours de frappe reste du texte", () => {
  // On tape « type: » avant de taper « devis ». Manger ce mot ferait
  // disparaître la recherche sous les doigts.
  assert.equal(parseQuery("type:").text, "type:");
  assert.equal(parseQuery("type: ").text, "type:");
  assert.equal(parseQuery(":devis").text, ":devis");
});

test("§29 — la palette propose de créer, pas seulement d'ouvrir", () => {
  const commands = matchCommands("nouveau devis");
  assert.ok(commands.some((c) => c.id === "nouveau-devis"), "« Créer un devis » manque");

  assert.ok(matchCommands("nouveau client").some((c) => c.id === "nouveau-client"));
  assert.ok(matchCommands("digital twin").some((c) => c.id === "digital-twin"));
});

test("§29 — une commande se déclenche sur un mot entier, pas sur n'importe quoi", () => {
  assert.ok(matchCommands("devis").some((c) => c.id === "nouveau-devis"));
  // « adevis » n'est pas une intention de créer un devis.
  assert.deepEqual(matchCommands("adevis"), []);
  // Une lettre seule ne propose rien : la palette serait illisible.
  assert.deepEqual(matchCommands("d"), []);
});

test("chaque type appartient à exactement un groupe", () => {
  const seen = new Map<string, string>();
  for (const group of SEARCH_GROUPS) {
    for (const type of group.types) {
      assert.equal(
        seen.has(type), false,
        `le type ${type} apparaît dans « ${seen.get(type)} » et « ${group.label} »`,
      );
      seen.set(type, group.label);
    }
  }
  // Et aucun type ne reste orphelin : ses résultats n'apparaîtraient
  // dans aucun groupe, donc nulle part.
  for (const type of ENTITY_TYPES) {
    assert.ok(seen.has(type), `le type ${type} n'est dans aucun groupe`);
  }
});

test("chaque type a un libellé", () => {
  for (const type of ENTITY_TYPES) {
    assert.ok(ENTITY_LABELS[type], `le type ${type} n'a pas de libellé`);
  }
});
