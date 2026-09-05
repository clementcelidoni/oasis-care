import { test } from "node:test";
import assert from "node:assert/strict";

import { lireIntention, peutSouscrire } from "./intention.ts";

/**
 * §STRIPE — LA PORTE D'ENTRÉE, ÉPROUVÉE PAR CE QU'ELLE REFUSE.
 *
 * Le test le plus important de ce fichier est le premier : un corps qui
 * porte un prix passe, et le prix DISPARAÎT. C'est la démonstration que
 * « le montant fait foi côté serveur » n'est pas une intention mais une
 * propriété de la forme des données — un champ qui n'existe pas ne peut
 * pas être respecté par distraction.
 */

// ══════════════════════════════════════════════════════════════════
// CE QUI NE PASSE PAS LA PORTE
// ══════════════════════════════════════════════════════════════════

test("UN PRIX POSTÉ PAR LE NAVIGATEUR DISPARAÎT — il n'a nulle part où aller", () => {
  const lecture = lireIntention({
    planKey: "business",
    prix: 0,
    price: 0,
    amount: 1,
    totalHtCents: 0,
    monthlyPriceCents: 1,
  });

  assert.equal(lecture.ok, true);
  if (!lecture.ok) return;
  assert.deepEqual(lecture.intention, {
    planKey: "business",
    billingCycle: "monthly",
    moduleKeys: [],
  });
  assert.equal(Object.keys(lecture.intention).length, 3);
});

test("UN CODE DE REMISE POSTÉ DISPARAÎT AUSSI", () => {
  // La remise est ACCORDÉE, elle ne se réclame pas. L'accepter ici
  // ferait du tarif Fondateur un mot de passe qui finirait sur un forum.
  const lecture = lireIntention({ planKey: "team", discountCode: "FONDATEUR", remise: "FONDATEUR" });
  assert.equal(lecture.ok, true);
  if (!lecture.ok) return;
  assert.equal("discountCode" in lecture.intention, false);
  assert.equal("remise" in lecture.intention, false);
});

test("UNE ENTREPRISE POSTÉE DISPARAÎT : elle vient de la session", () => {
  const lecture = lireIntention({
    planKey: "team",
    organizationId: "33333333-3333-3333-3333-333333333333",
  });
  assert.equal(lecture.ok, true);
  if (!lecture.ok) return;
  assert.equal("organizationId" in lecture.intention, false);
});

test("sans offre choisie, la demande est refusée avec une phrase française", () => {
  for (const corps of [{}, { planKey: "" }, { planKey: "   " }, { planKey: 42 }, { planKey: null }]) {
    const lecture = lireIntention(corps);
    assert.equal(lecture.ok, false, JSON.stringify(corps));
    if (lecture.ok) return;
    assert.match(lecture.motif, /offre/);
  }
});

test("une clé d'offre bizarre est refusée, pas nettoyée en silence", () => {
  // Nettoyer donnerait une clé différente de celle demandée, et le
  // client paierait pour une offre qu'il n'a pas choisie.
  for (const planKey of [
    "team; drop table",
    "../../etc/passwd",
    "team\npro",
    "<script>",
    "a".repeat(65),
    "-team",
  ]) {
    const lecture = lireIntention({ planKey });
    assert.equal(lecture.ok, false, planKey);
  }
});

test("un corps qui n'est pas un objet est refusé", () => {
  for (const corps of [null, "team", 42, ["team"], undefined]) {
    assert.equal(lireIntention(corps).ok, false, String(corps));
  }
});

// ══════════════════════════════════════════════════════════════════
// LE CYCLE
// ══════════════════════════════════════════════════════════════════

test("LE DÉFAUT EST LE MOIS — le seul cycle dont tous les prix existent", () => {
  const lecture = lireIntention({ planKey: "team" });
  assert.equal(lecture.ok, true);
  if (!lecture.ok) return;
  assert.equal(lecture.intention.billingCycle, "monthly");
});

test("l'annuel se demande explicitement, et rien d'autre n'est accepté", () => {
  const annuel = lireIntention({ planKey: "team", billingCycle: "yearly" });
  assert.equal(annuel.ok, true);
  if (!annuel.ok) return;
  assert.equal(annuel.intention.billingCycle, "yearly");

  for (const cycle of ["annual", "YEARLY", "trimestriel", 12, true]) {
    const lecture = lireIntention({ planKey: "team", billingCycle: cycle });
    assert.equal(lecture.ok, false, String(cycle));
    if (lecture.ok) return;
    assert.match(lecture.motif, /au mois|à l'année/);
  }
});

// ══════════════════════════════════════════════════════════════════
// LES MODULES
// ══════════════════════════════════════════════════════════════════

test("les modules sont DÉDOUBLONNÉS et ORDONNÉS", () => {
  // Deux fois le même module ne doit pas produire deux lignes ; et
  // l'ordre stable rend la clé d'idempotence stable elle aussi, sans
  // quoi deux clics identiques créeraient deux sessions de paiement.
  const a = lireIntention({ planKey: "team", moduleKeys: ["nursery", "biolab", "nursery"] });
  const b = lireIntention({ planKey: "team", moduleKeys: ["biolab", "nursery"] });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(a.intention.moduleKeys, ["biolab", "nursery"]);
  assert.deepEqual(a.intention.moduleKeys, b.intention.moduleKeys);
});

test("une liste de modules démesurée ou mal formée est refusée", () => {
  assert.equal(lireIntention({ planKey: "team", moduleKeys: "biolab" }).ok, false);
  assert.equal(lireIntention({ planKey: "team", moduleKeys: [1, 2] }).ok, false);
  assert.equal(lireIntention({ planKey: "team", moduleKeys: [""] }).ok, false);
  assert.equal(
    lireIntention({ planKey: "team", moduleKeys: Array.from({ length: 21 }, (_, i) => `m${i}`) }).ok,
    false,
  );
});

test("l'absence de modules n'est pas une erreur", () => {
  for (const moduleKeys of [undefined, null, []]) {
    const lecture = lireIntention({ planKey: "team", moduleKeys });
    assert.equal(lecture.ok, true);
    if (!lecture.ok) return;
    assert.deepEqual(lecture.intention.moduleKeys, []);
  }
});

// ══════════════════════════════════════════════════════════════════
// QUI PEUT ENGAGER L'ENTREPRISE
// ══════════════════════════════════════════════════════════════════

test("seuls le propriétaire et l'administrateur peuvent souscrire", () => {
  // Un chef d'équipe qui clique « Souscrire » dans un menu qu'il
  // n'aurait pas dû voir doit être arrêté par le SERVEUR : l'absence de
  // bouton n'a jamais arrêté un `fetch`.
  assert.equal(peutSouscrire("owner"), true);
  assert.equal(peutSouscrire("admin"), true);

  for (const role of [
    "manager",
    "accounting",
    "teamLeader",
    "fieldWorker",
    "readOnly",
    "custom",
    "",
    "OWNER",
  ]) {
    assert.equal(peutSouscrire(role), false, role);
  }
});
