import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  INSTALL_ID_MAX_LENGTH,
  INSTALL_ID_MIN_LENGTH,
  PRESENCE_RPC,
  VERSION_MAX_LENGTH,
  WEB_PLATFORM,
  isDeclarable,
  isValidInstallId,
  type WebPresence,
} from "./presence.ts";

/**
 * CE QUE CE MODULE A LE DROIT DE SAVOIR, ET CE QU'IL DOIT IGNORER.
 *
 * La moitié de ces contrôles ne porte pas sur du calcul mais sur du
 * TEXTE : ils lisent les fichiers du module et vérifient qu'aucune
 * ligne n'y touche à ce qu'on s'est interdit. C'est le seul test
 * possible pour une promesse de la forme « on ne collecte PAS ceci » —
 * une fonction ne peut pas démontrer qu'elle n'appelle jamais
 * `navigator.userAgent`, mais le fichier, si.
 *
 * Ce n'est pas de la paranoïa de principe : une empreinte de navigateur
 * s'ajoute en une ligne, sans rien casser, sans rien afficher, et
 * personne ne s'en aperçoit à la relecture d'un diff.
 */

const here = import.meta.dirname;

/** Les fichiers du module, sauf les tests eux-mêmes. */
function sources(): { name: string; code: string }[] {
  return fs
    .readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => ({ name, code: fs.readFileSync(path.join(here, name), "utf8") }));
}

test("les bornes reprennent celles de la base (0077)", () => {
  // Si 0077 change ses contraintes, ces trois nombres doivent bouger
  // ensemble — sinon le client envoie ce que la base refuse.
  assert.equal(INSTALL_ID_MIN_LENGTH, 8);
  assert.equal(INSTALL_ID_MAX_LENGTH, 64);
  assert.equal(VERSION_MAX_LENGTH, 32);
  assert.equal(WEB_PLATFORM, "web");
  assert.equal(PRESENCE_RPC, "declare_web_presence");
});

test("un UUID passe, un nom de personne non", () => {
  assert.equal(isValidInstallId("3f6a1b2c-8d4e-4f10-9a7b-5c2e1d0f8a93"), true);
  assert.equal(isValidInstallId("a".repeat(32)), true);

  // LA GARDE ANTI-« NOM D'APPAREIL », la même qu'en base. « Chrome de
  // Clément » est un nom de personne : il ne doit pas pouvoir entrer
  // par la porte d'un identifiant technique.
  assert.equal(isValidInstallId("Chrome de Clément"), false);
  assert.equal(isValidInstallId("MacBook\tPro"), false);

  // ET LES DEUX QUE LA PREMIÈRE VERSION LAISSAIT PASSER. Elle refusait
  // l'espace, ce qui ne gardait rien : une espace se remplace par un
  // tiret, et une adresse électronique n'en contient aucune. La règle
  // est une liste blanche maintenant — chiffres hexadécimaux et tirets,
  // c'est-à-dire un UUID, comme en base.
  assert.equal(isValidInstallId("Chrome-de-Clement-Celidoni"), false);
  assert.equal(isValidInstallId("clement.celidoni@gmail.com"), false);

  assert.equal(isValidInstallId("court"), false);
  assert.equal(isValidInstallId("x".repeat(65)), false);
  assert.equal(isValidInstallId(""), false);
  assert.equal(isValidInstallId(null), false);
  assert.equal(isValidInstallId(42), false);
});

test("une déclaration est complète ou n'est pas", () => {
  const base: WebPresence = {
    installId: "3f6a1b2c-8d4e-4f10-9a7b-5c2e1d0f8a93",
    platform: WEB_PLATFORM,
    appVersion: "0.1.0",
    appBuild: "a1b2c3d4e5f6",
  };

  assert.equal(isDeclarable(base), true);

  // `appBuild` est la SEULE absence légitime : rien n'injecte de
  // révision aujourd'hui, et en inventer une la rendrait indiscernable
  // d'une vraie dans la distribution des versions.
  assert.equal(isDeclarable({ ...base, appBuild: null }), true);

  assert.equal(isDeclarable({ ...base, appVersion: "" }), false);
  assert.equal(isDeclarable({ ...base, appVersion: "   " }), false);
  assert.equal(isDeclarable({ ...base, appVersion: "v".repeat(33) }), false);
  assert.equal(isDeclarable({ ...base, appBuild: "" }), false);
  assert.equal(isDeclarable({ ...base, appBuild: "b".repeat(33) }), false);
  assert.equal(isDeclarable({ ...base, installId: "trop court" }), false);
});

test("aucune empreinte de navigateur ne s'est glissée dans le module", () => {
  // Chaque motif ci-dessous est une façon connue de reconnaître un
  // navigateur sans lui rien demander. Aucun n'a sa place ici : on
  // identifie une INSTALLATION parce qu'elle porte un jeton qu'on lui a
  // donné, on ne reconnaît personne à ses caractéristiques.
  const interdits: [RegExp, string][] = [
    [/navigator\.userAgent/, "user-agent"],
    [/navigator\.platform/, "plateforme du système"],
    [/navigator\.language/, "langue"],
    [/navigator\.plugins/, "liste des greffons"],
    [/hardwareConcurrency/, "nombre de cœurs"],
    [/deviceMemory/, "mémoire de l'appareil"],
    [/screen\.(width|height|colorDepth)/, "résolution d'écran"],
    [/getContext\(\s*["'](2d|webgl)/, "empreinte par canvas"],
    [/AudioContext/, "empreinte audio"],
    [/queryLocalFonts|document\.fonts/, "liste des polices"],
    [/resolvedOptions\(\)/, "fuseau horaire"],
    [/getBattery/, "niveau de batterie"],
    [/geolocation/, "géolocalisation"],
  ];

  const trouves: string[] = [];
  for (const { name, code } of sources()) {
    for (const [motif, quoi] of interdits) {
      // Les commentaires de ce module NOMMENT ces techniques pour dire
      // qu'on n'en veut pas : on ne regarde donc que le code.
      if (motif.test(stripComments(code))) trouves.push(`${name} : ${quoi}`);
    }
  }

  assert.deepEqual(
    trouves,
    [],
    `Empreinte de navigateur détectée :\n  ${trouves.join("\n  ")}`,
  );
});

test("le module ne lit ni en-tête, ni adresse, ni cookie de son cru", () => {
  // 0077 interdit l'adresse IP nommément. Côté web, elle est à portée
  // de main dans une Server Action (`headers()`, `x-forwarded-for`) :
  // c'est justement pour cela qu'il faut un contrôle mécanique et pas
  // seulement une phrase dans un commentaire.
  const interdits: [RegExp, string][] = [
    [/from\s+["']next\/headers["']/, "next/headers (en-têtes et cookies)"],
    [/x-forwarded-for/i, "adresse IP"],
    [/x-real-ip/i, "adresse IP"],
    [/\buserAgent\b/, "user-agent"],
  ];

  const trouves: string[] = [];
  for (const { name, code } of sources()) {
    const nu = stripComments(code);
    for (const [motif, quoi] of interdits) {
      if (motif.test(nu)) trouves.push(`${name} : ${quoi}`);
    }
  }

  assert.deepEqual(trouves, [], `Lecture interdite :\n  ${trouves.join("\n  ")}`);
});

/** Retire commentaires de bloc et de ligne, pour ne juger que le code. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
