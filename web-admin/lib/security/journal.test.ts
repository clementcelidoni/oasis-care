import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estChangementDeDroits,
  estFamille,
  familleAction,
  FAMILLES_ORDONNEES,
  libelleAction,
  LIBELLES_ACTION,
  LIBELLES_FAMILLE,
  PREFIXES_FAMILLE,
  tonAction,
} from "./journal.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * Trois choses, et la dernière est la seule qui pourrait causer un vrai
 * dégât : que le filtre « Droits » de l'écran de sécurité désigne
 * EXACTEMENT le même ensemble que le regroupement des chiffres. Le
 * filtre s'exprime en préfixes envoyés à PostgREST, le regroupement en
 * une fonction TypeScript ; deux écritures de la même règle divergent,
 * et l'écran afficherait alors « 3 changements de droits » au-dessus
 * d'une liste qui en montre cinq.
 */

test("une action inconnue de l'interface garde son nom technique", () => {
  // Surtout pas « action inconnue » : dans un journal d'audit, le nom
  // brut est l'information qu'on venait chercher.
  assert.equal(libelleAction("quelqueChose.deNouveau"), "quelqueChose.deNouveau");
  assert.equal(libelleAction("platformAdmin.revoked"), "Administrateur révoqué");
});

test("les trente-quatre actions écrites par les migrations ont un libellé", () => {
  // Le compte : 0075 en écrit une, 0080 quatre, 0081 vingt-neuf. Ce
  // chiffre échouera le jour où une migration ajoutera une action sans
  // qu'on lui donne un libellé — ce qui est exactement le rappel qu'on
  // veut, puisque la liste ne peut pas se déduire de la base.
  assert.equal(Object.keys(LIBELLES_ACTION).length, 34);

  // Un échantillon nommé, pour que l'échec dise LAQUELLE manque.
  const attendues = [
    "platformAdmin.created",
    "aiModel.overrideSet",
    "aiCostLimit.cleared",
    "security.mfaPolicyChanged",
    "platformAdmin.roleChanged",
    "platformAdmin.invitationAccepted",
    "plan.pricingChanged",
    "subscription.discountApplied",
    "saasInvoice.issued",
    "featureFlag.toggled",
    "supportTicket.replied",
    "supportSession.started",
    "supportSession.revoked",
  ];
  for (const action of attendues) {
    assert.ok(LIBELLES_ACTION[action], `libellé manquant pour ${action}`);
  }
});

test("le classement se fait sur le préfixe, donc une action neuve tombe dans la bonne famille", () => {
  // C'est le point : `platformAdmin.suspended` n'existe pas encore. Le
  // jour où une migration l'écrira, elle doit apparaître dans la
  // surveillance des droits SANS qu'on ait touché à ce fichier.
  assert.equal(familleAction("platformAdmin.suspended"), "droits");
  assert.equal(familleAction("supportSession.extended"), "assistance");
  assert.equal(familleAction("saasInvoice.refunded"), "argent");
  assert.equal(familleAction("aiModel.overrideSet"), "ia");
  assert.equal(familleAction("quelqueChose"), "autre");
});

test("les préfixes du filtre et la fonction de classement disent la même chose", () => {
  // LE TEST QUI COMPTE. Le filtre part en base sous forme de préfixes ;
  // le regroupement des chiffres se fait en TypeScript. S'ils
  // divergeaient, l'écran afficherait un total qui ne correspond pas à
  // sa propre liste.
  for (const famille of FAMILLES_ORDONNEES) {
    for (const prefixe of PREFIXES_FAMILLE[famille]) {
      assert.equal(
        familleAction(`${prefixe}exempleFabrique`),
        famille,
        `le préfixe « ${prefixe} » est annoncé dans « ${famille} » mais classé ailleurs`,
      );
    }
  }
});

test("chaque action réelle est classée dans une famille qui a des préfixes", () => {
  for (const action of Object.keys(LIBELLES_ACTION)) {
    const famille = familleAction(action);
    assert.notEqual(
      famille,
      "autre",
      `« ${action} » tombe dans « Autres » : il manque un préfixe à PREFIXES_FAMILLE`,
    );
    assert.ok(LIBELLES_FAMILLE[famille]);
  }
});

test("retirer une invitation n'est pas un élargissement de droits", () => {
  // Elle est bien de la famille « droits » — on veut la voir dans le
  // filtre — mais elle n'accorde rien : la compter parmi les
  // changements de permissions gonflerait l'indicateur qu'on relit
  // précisément pour repérer les élargissements.
  assert.equal(familleAction("platformAdmin.invitationRevoked"), "droits");
  assert.equal(estChangementDeDroits("platformAdmin.invitationRevoked"), false);
  assert.equal(estChangementDeDroits("platformAdmin.roleChanged"), true);
  assert.equal(estChangementDeDroits("security.mfaPolicyChanged"), true);
  assert.equal(estChangementDeDroits("saasInvoice.issued"), false);
});

test("le rouge est réservé à ce qui élargit un droit ou retire une borne", () => {
  assert.equal(tonAction("platformAdmin.created"), "critical");
  assert.equal(tonAction("aiCostLimit.cleared"), "critical");
  assert.equal(tonAction("supportSession.started"), "critical");

  // Couper un accès est un BON geste : l'alarmer découragerait de le
  // faire, et c'est exactement le geste qu'on veut voir facile.
  assert.notEqual(tonAction("supportSession.revoked"), "critical");
  assert.notEqual(tonAction("platformAdmin.revoked"), "critical");
});

test("estFamille refuse ce qui n'est pas une famille", () => {
  assert.equal(estFamille("droits"), true);
  assert.equal(estFamille("argent"), true);
  assert.equal(estFamille("tout"), false);
  assert.equal(estFamille(null), false);
});
