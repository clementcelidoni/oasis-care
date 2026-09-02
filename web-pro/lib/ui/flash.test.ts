import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlash, FLASH_COOKIE } from "./flashShared.ts";

/**
 * §34 — LE MESSAGE QUI N'ARRIVE PAS NE SE PLAINT PAS.
 *
 * `parseFlash` rend `null` sur cinq chemins, et les cinq donnent le même
 * résultat à l'écran : rien. Pas d'erreur, pas de trace. L'utilisateur
 * enregistre, ne voit aucune confirmation, et reclique en croyant que ça
 * n'a pas marché — c'est exactement ce qu'ont montré les journaux du
 * serveur après le premier essai en conditions réelles, deux
 * enregistrements successifs de la même fiche.
 *
 * Ces tests fixent donc les deux moitiés : ce qui DOIT passer, et ce qui
 * doit être refusé. Un message légitime avalé est un défaut ; un lien
 * absolu accepté en serait un autre, plus grave.
 */

test("un message ordinaire passe", () => {
  const flash = parseFlash(JSON.stringify({ tone: "success", message: "Fiche enregistrée." }));
  assert.deepEqual(flash, { tone: "success", message: "Fiche enregistrée." });
});

test("les accents, les espaces et les apostrophes survivent", () => {
  // Le message réel de l'écran « Ma société ». S'il ne repassait pas ce
  // test, aucune confirmation ne s'afficherait jamais après un
  // enregistrement — et c'est le message le plus fréquent du produit.
  const message = "Fiche de l'entreprise enregistrée.";
  const flash = parseFlash(JSON.stringify({ tone: "success", message }));
  assert.equal(flash?.message, message);
});

test("les trois tons sont acceptés, et eux seuls", () => {
  for (const tone of ["success", "error", "info"]) {
    assert.equal(parseFlash(JSON.stringify({ tone, message: "x" }))?.tone, tone);
  }
  assert.equal(parseFlash(JSON.stringify({ tone: "danger", message: "x" })), null);
  assert.equal(parseFlash(JSON.stringify({ message: "x" })), null);
});

test("un cookie absent, vide ou illisible ne casse rien", () => {
  assert.equal(parseFlash(undefined), null);
  assert.equal(parseFlash(null), null);
  assert.equal(parseFlash(""), null);
  assert.equal(parseFlash("pas du json"), null);
  assert.equal(parseFlash("[]"), null);
  assert.equal(parseFlash("null"), null);
  assert.equal(parseFlash('"une chaîne"'), null);
});

test("un message vide n'est pas un message", () => {
  assert.equal(parseFlash(JSON.stringify({ tone: "success", message: "" })), null);
  assert.equal(parseFlash(JSON.stringify({ tone: "success", message: 42 })), null);
});

test("§34 — le lien « Réessayer » passe s'il pointe vers ce site", () => {
  const flash = parseFlash(
    JSON.stringify({
      tone: "error",
      message: "Impossible d'enregistrer.",
      action: { label: "Réessayer", href: "/entreprise" },
    }),
  );
  assert.deepEqual(flash?.action, { label: "Réessayer", href: "/entreprise" });
});

test("un lien absolu est retiré, le message reste", () => {
  // Le cookie n'est pas `httpOnly` — c'est le navigateur qui l'efface
  // après affichage. Il est donc MODIFIABLE, et un lien absolu ferait de
  // la confirmation une redirection ouverte, à un clic.
  for (const href of ["https://exemple.invalid", "//exemple.invalid", "javascript:alert(1)"]) {
    const flash = parseFlash(
      JSON.stringify({ tone: "info", message: "Coucou", action: { label: "Suivre", href } }),
    );
    assert.equal(flash?.message, "Coucou", `le message devrait survivre pour ${href}`);
    assert.equal(flash?.action, undefined, `le lien ${href} aurait dû être retiré`);
  }
});

test("une action incomplète est retirée sans emporter le message", () => {
  const flash = parseFlash(
    JSON.stringify({ tone: "success", message: "Créé", action: { href: "/x" } }),
  );
  assert.equal(flash?.message, "Créé");
  assert.equal(flash?.action, undefined);
});

test("l'aller-retour complet, tel que le cookie le fait vraiment", () => {
  // Next encode la valeur du cookie avec `encodeURIComponent` à
  // l'écriture et la décode à la lecture. On refait le trajet : c'est
  // là que les espaces et les virgules d'un message français
  // tronqueraient un cookie non encodé.
  const original = {
    tone: "success" as const,
    message: "Jardin livré. Il est maintenant dans l'application du client.",
  };
  const ecrit = encodeURIComponent(JSON.stringify(original));
  const relu = decodeURIComponent(ecrit);
  assert.deepEqual(parseFlash(relu), original);
});

test("le nom du cookie ne contient rien qui doive être encodé", () => {
  assert.equal(FLASH_COOKIE, encodeURIComponent(FLASH_COOKIE));
});
