import test from "node:test";
import assert from "node:assert/strict";

import {
  PERMISSION_FAMILIES,
  PERMISSION_LABELS,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_SCOPE,
  WRITE_PERMISSIONS,
  isPlatformPermission,
  isPlatformRole,
  permissionFamily,
  permissionLabel,
  roleLabel,
} from "./roles.ts";

/**
 * Ce que ces tests protègent, et pourquoi ils valent leur place.
 *
 * `lib/auth/roles.ts` est un MIROIR de la base : il ne décide rien, mais
 * il TYPE les appels de garde. Une clé oubliée dans une de ses tables de
 * correspondance ne casse rien à la compilation — `permissionLabel()`
 * retombe sur la chaîne brute, `ROLE_SCOPE[role]` rend `undefined` — et
 * produit un écran qui affiche `billing.plans.write` là où il devrait
 * expliquer ce que le droit ouvre. Exactement au moment où quelqu'un
 * décide de l'accorder à un collègue.
 *
 * Aucun de ces défauts ne se voit à l'exécution avant l'écran lui-même.
 * D'où ces tests.
 */

test("chaque permission du catalogue a un libellé", () => {
  const sansLibelle = PLATFORM_PERMISSIONS.filter(
    (permission) => !PERMISSION_LABELS[permission]?.trim(),
  );
  assert.deepEqual(sansLibelle, []);
});

test("aucun libellé ne décrit une permission absente du catalogue", () => {
  // L'erreur symétrique : une clé renommée par une migration laisserait
  // son ancien libellé derrière elle, et personne ne le remarquerait.
  const catalogue: readonly string[] = PLATFORM_PERMISSIONS;
  const orphelins = Object.keys(PERMISSION_LABELS).filter((clef) => !catalogue.includes(clef));
  assert.deepEqual(orphelins, []);
});

test("chaque permission appartient à une famille connue", () => {
  // Les familles servent à ranger les permissions à l'écran SUR LE MÊME
  // CRITÈRE que celui du garde-fou de la matrice en base : le préfixe.
  // Une permission hors famille se retrouverait dans un fourre-tout,
  // et le lecteur se ferait une carte mentale différente de celle qui
  // s'applique réellement.
  const orphelines = PLATFORM_PERMISSIONS.filter(
    (permission) => permissionFamily(permission) === null,
  );
  assert.deepEqual(orphelines, []);
});

test("aucune famille n'est vide", () => {
  // Une famille sans permission est un intertitre suivi de rien : le
  // même bug apparent qu'un groupe de navigation vide.
  const vides = PERMISSION_FAMILIES.filter(
    (famille) => !PLATFORM_PERMISSIONS.some((clef) => clef.startsWith(famille.prefix)),
  ).map((famille) => famille.prefix);
  assert.deepEqual(vides, []);
});

test("les permissions d'écriture sont toutes au catalogue", () => {
  const catalogue: readonly string[] = PLATFORM_PERMISSIONS;
  const inconnues = WRITE_PERMISSIONS.filter((permission) => !catalogue.includes(permission));
  assert.deepEqual(inconnues, []);
});

test("toute clé se terminant par .write ou .manage est déclarée en écriture", () => {
  // La convention de nommage de 0075 et 0081 : le suffixe dit le sens.
  // Si l'un des deux dérive, c'est ici qu'on l'apprend, et non le jour
  // où un rôle en lecture seule reçoit un droit d'écriture.
  const attenduesEnEcriture = PLATFORM_PERMISSIONS.filter(
    (permission) => permission.endsWith(".write") || permission.endsWith(".manage"),
  );
  const declarees: readonly string[] = WRITE_PERMISSIONS;
  assert.deepEqual(
    attenduesEnEcriture.filter((permission) => !declarees.includes(permission)),
    [],
  );
});

test("chaque rôle a un libellé, une description et une portée", () => {
  for (const role of PLATFORM_ROLES) {
    assert.ok(ROLE_LABELS[role]?.trim(), `libellé manquant pour ${role}`);
    assert.ok(ROLE_DESCRIPTIONS[role]?.trim(), `description manquante pour ${role}`);
    assert.ok(ROLE_SCOPE[role]?.trim(), `portée manquante pour ${role}`);
  }
});

test("aucun libellé de rôle ne se réduit au mot « Administrateur »", () => {
  // Le piège nominatif de ce projet : « admin » désigne DÉJÀ le
  // gestionnaire d'une entreprise CLIENTE dans Oasis Care Pro
  // (`organization_members.role`). Un libellé « Administrateur » tout
  // court confondrait un membre de l'équipe Oasis Care avec un client —
  // exactement la confusion que la spec p.32 interdit.
  for (const role of PLATFORM_ROLES) {
    assert.notEqual(ROLE_LABELS[role].trim().toLowerCase(), "administrateur");
  }
});

test("un rôle ou une permission inconnus s'affichent bruts, jamais « inconnu »", () => {
  // Un administrateur doit pouvoir lire sa propre casquette même quand
  // l'interface a un train de retard sur une migration. Afficher
  // « inconnu » à la place lui ferait croire à un problème de compte.
  assert.equal(roleLabel("data_steward"), "data_steward");
  assert.equal(permissionLabel("gdpr.requests.read"), "gdpr.requests.read");
  assert.equal(isPlatformRole("data_steward"), false);
  assert.equal(isPlatformPermission("gdpr.requests.read"), false);
});

test("les douze clés de la migration 0081 sont au catalogue", () => {
  // LE PIÈGE DE SEMIS, transformé en test — sa moitié TypeScript.
  //
  // Les permissions du super-administrateur ont été semées PAR JOINTURE
  // au moment où 0075 s'exécutait : une clé ajoutée après coup n'est
  // portée par personne tant qu'une migration ne rejoue pas la jointure.
  // Ce test ne peut pas vérifier la base ; il vérifie que l'interface
  // connaît bien les douze clés que 0081 introduit. Si un écran de ce
  // lot disparaît du menu sans que ce test tombe, la cause est en base —
  // et c'est une information, pas un mystère.
  const attendues = [
    "billing.plans.read",
    "billing.plans.write",
    "billing.invoices.read",
    "billing.invoices.write",
    "billing.issuer.write",
    "support.tickets.read",
    "support.tickets.write",
    "support.sessions.read",
    "support.sessions.manage",
    "product.flags.read",
    "product.flags.write",
    "platform.security.write",
  ];
  const catalogue: readonly string[] = PLATFORM_PERMISSIONS;
  assert.deepEqual(
    attendues.filter((clef) => !catalogue.includes(clef)),
    [],
  );
});
