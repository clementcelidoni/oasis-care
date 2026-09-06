import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classerRefus,
  estDistributionConnue,
  EXPLICATIONS_NATURE,
  LIBELLES_ALERTE,
  LIBELLES_EXCLUSION,
  LIBELLES_STATUT_MESSAGE,
  LIBELLES_SUPPRESSION,
  TONS_ALERTE,
  TONS_EXCLUSION,
  TONS_STATUT_MESSAGE,
  TONS_SUPPRESSION,
  libelleNature,
  tonNature,
} from "./libelles.ts";
import {
  CLES_COURRIER,
  LIBELLES_COURRIER,
  PERMISSIONS_COURRIER,
  ROLES_PORTEURS,
  estPermissionCourrier,
  phraseDeRefus,
} from "./permissions.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * TROIS CHOSES, dans l'ordre de ce qu'elles coûteraient si elles
 * cassaient :
 *
 *   1. QU'AUCUN ÉTAT DE LA BASE NE S'AFFICHE SANS MOT NI SANS COULEUR.
 *      Un statut inconnu tombe dans une cellule vide, et une cellule
 *      vide se lit « rien à signaler » — exactement le contraire de ce
 *      que dit un rebond. Les énumérations de 0084 sont donc recopiées
 *      ici et confrontées aux tables de libellés.
 *   2. QU'« ENVOYÉ » NE SE CONFONDE PAS AVEC « REÇU ». C'est le
 *      mensonge le plus facile de cet écran, et il transformerait un
 *      produit qui ne mesure rien en un produit qui affiche 100 % de
 *      distribution.
 *   3. QUE LA SÉPARATION DES POUVOIRS DE 0084 RESTE ÉCRITE. Le
 *      responsable produit envoie les annonces ; le responsable
 *      sécurité suspend et réhabilite. La même personne ne fait pas les
 *      deux, sans quoi elle crée le problème et lève le garde-fou.
 */

// Les énumérations de 0084, recopiées. Une valeur ajoutée en base sans
// libellé ici fera échouer ce fichier plutôt qu'apparaître en blanc.
const STATUTS_MESSAGE_0084 = [
  "queued",
  "sent",
  "deferred",
  "delivered",
  "bounced",
  "complained",
  "blocked",
  "failed",
  "cancelled",
];
const TYPES_SUPPRESSION_0084 = [
  "rebondDur",
  "plainte",
  "desabonnement",
  "bloqueTransporteur",
  "manuel",
];
const NIVEAUX_ALERTE_0084 = ["insuffisant", "ok", "surveillance", "critique"];

test("chaque statut de message de 0084 a un mot et un ton", () => {
  for (const statut of STATUTS_MESSAGE_0084) {
    assert.ok(LIBELLES_STATUT_MESSAGE[statut], `statut sans libellé : ${statut}`);
    assert.ok(TONS_STATUT_MESSAGE[statut], `statut sans ton : ${statut}`);
  }
});

test("chaque type de suppression de 0084 a un mot et un ton", () => {
  for (const type of TYPES_SUPPRESSION_0084) {
    assert.ok(LIBELLES_SUPPRESSION[type], `type sans libellé : ${type}`);
    assert.ok(TONS_SUPPRESSION[type], `type sans ton : ${type}`);
  }
});

test("chaque niveau d'alerte a un mot et un ton, et « insuffisant » n'est pas « bon »", () => {
  for (const niveau of NIVEAUX_ALERTE_0084) {
    assert.ok(LIBELLES_ALERTE[niveau]);
    assert.ok(TONS_ALERTE[niveau]);
  }
  // Sous vingt messages, un seul rebond afficherait 100 %. Le ton de
  // l'inconnu est le seul qui ne mente pas.
  assert.equal(TONS_ALERTE.insuffisant, "unknown");
  assert.equal(TONS_ALERTE.ok, "positive");
});

test("la plainte et le blocage sont critiques : ils abîment le domaine de TOUT le parc", () => {
  assert.equal(TONS_STATUT_MESSAGE.complained, "critical");
  assert.equal(TONS_STATUT_MESSAGE.blocked, "critical");
  // Un rebond ne coûte qu'un message : il avertit, il n'alarme pas.
  assert.equal(TONS_STATUT_MESSAGE.bounced, "warning");
});

test("« remis au transporteur » n'est PAS « distribué »", () => {
  assert.equal(estDistributionConnue("queued"), false);
  assert.equal(estDistributionConnue("sent"), false);
  assert.equal(estDistributionConnue("delivered"), true);
  assert.equal(estDistributionConnue("bounced"), true);
});

test("les deux natures sont distinguées par le mot ET par la couleur", () => {
  assert.equal(libelleNature("transactionnel"), "Transactionnel");
  assert.equal(libelleNature("publicite"), "Publicité");
  assert.notEqual(tonNature("transactionnel"), tonNature("publicite"));
  // Une valeur inattendue ne prend pas la couleur de la publicité par
  // accident : elle est neutre et se voit.
  assert.equal(tonNature("autre-chose"), "neutral");
  assert.equal(libelleNature("autre-chose"), "autre-chose");
});

test("l'explication du transactionnel dit qu'il part MALGRÉ un désabonnement", () => {
  // C'est la phrase qui empêche un exploitant de « corriger » le
  // comportement le jour où quelqu'un lui demandera pourquoi une
  // personne désabonnée reçoit encore des factures.
  assert.match(EXPLICATIONS_NATURE.transactionnel, /désabonn/i);
  assert.match(EXPLICATIONS_NATURE.transactionnel, /DOIT partir/);
  // Et celle de la publicité dit à qui elle ne s'adresse jamais.
  assert.match(EXPLICATIONS_NATURE.publicite, /jamais à leurs clients/);
});

test("chaque motif d'exclusion a un mot et un ton", () => {
  for (const motif of Object.keys(LIBELLES_EXCLUSION) as (keyof typeof LIBELLES_EXCLUSION)[]) {
    assert.ok(LIBELLES_EXCLUSION[motif]);
    assert.ok(TONS_EXCLUSION[motif]);
  }
});

test("les phrases de refus de 0084 se rangent dans la bonne catégorie", () => {
  // Elles sont recopiées mot pour mot depuis `email_gate()` et
  // `email_sender_identity()`. Une phrase mal rangée tombe dans
  // « autre » sans rien cacher : la phrase exacte reste affichée.
  assert.equal(
    classerRefus(
      "Renseignez l'adresse e-mail de votre entreprise dans ses paramètres : sans elle, les réponses de vos clients se perdraient.",
    ),
    "sansAdresse",
  );
  assert.equal(
    classerRefus("Aucun consentement préalable enregistré pour cette adresse : la publicité ne part pas."),
    "sansConsentement",
  );
  assert.equal(classerRefus("Cette adresse s'est désabonnée le 03/03/2026."), "desabonnee");
  assert.equal(
    classerRefus("Cette adresse est sur la liste de suppression (plainte)."),
    "suppression",
  );
  assert.equal(
    classerRefus("L'expédition de courrier est suspendue pour cette entreprise depuis le 01/03/2026. Motif : x"),
    "suspendue",
  );
  assert.equal(classerRefus("Ce message est déjà parti : il ne repart pas."), "dejaEnvoye");
  assert.equal(classerRefus(null), "autre");
  assert.equal(classerRefus("Quelque chose d'imprévu."), "autre");
});

// ------------------------------------------------------------------
// LES PERMISSIONS
// ------------------------------------------------------------------

test("les six clés de 0084 sont là, toutes préfixées « emails. »", () => {
  assert.equal(PERMISSIONS_COURRIER.length, 6);
  assert.equal(new Set(PERMISSIONS_COURRIER).size, 6);
  for (const cle of PERMISSIONS_COURRIER) {
    assert.match(cle, /^emails\./);
    assert.ok(LIBELLES_COURRIER[cle], `clé sans libellé : ${cle}`);
    assert.ok(ROLES_PORTEURS[cle].length > 0, `clé que personne ne porte : ${cle}`);
    // Le super-administrateur porte tout le catalogue par la jointure
    // de semis, rejouée par 0084 § 16.b. Une clé sans lui signalerait
    // que le semis n'a pas été rejoué — le piège qui a mordu trois fois.
    assert.ok(ROLES_PORTEURS[cle].includes("super_admin"), `clé sans super_admin : ${cle}`);
  }
});

test("LA SÉPARATION DES POUVOIRS : qui envoie ne suspend pas, qui suspend n'envoie pas", () => {
  const envoi = ROLES_PORTEURS[CLES_COURRIER.campagnesEnvoyer];
  const suspension = ROLES_PORTEURS[CLES_COURRIER.suspendre];
  const levee = ROLES_PORTEURS[CLES_COURRIER.suppressionsGerer];

  assert.ok(envoi.includes("product_admin"));
  assert.ok(!envoi.includes("security_admin"), "le responsable sécurité ne fait pas de publicité");
  assert.ok(suspension.includes("security_admin"));
  assert.ok(
    !suspension.includes("product_admin"),
    "celui qui envoie la publicité ne doit pas pouvoir lever le garde-fou",
  );
  assert.ok(!levee.includes("product_admin"));

  // Et le support LIT, sans jamais écrire : « mon client dit qu'il n'a
  // pas reçu la facture » est sa question, et sans la liste de
  // suppression il ne peut qu'escalader.
  assert.ok(ROLES_PORTEURS[CLES_COURRIER.suppressionsLire].includes("support"));
  assert.ok(ROLES_PORTEURS[CLES_COURRIER.journal].includes("support"));
  assert.ok(!ROLES_PORTEURS[CLES_COURRIER.campagnesEnvoyer].includes("support"));
});

test("la phrase de refus nomme la clé, ce qu'elle ouvre, et qui la porte", () => {
  const phrase = phraseDeRefus("support", CLES_COURRIER.campagnesEnvoyer);
  assert.match(phrase, /support/);
  assert.match(phrase, /emails\.campaigns\.send/);
  assert.match(phrase, /super_admin/);
});

test("estPermissionCourrier refuse ce qui n'est pas du catalogue", () => {
  assert.equal(estPermissionCourrier("emails.campaigns.send"), true);
  assert.equal(estPermissionCourrier("emails.campaigns.sendd"), false);
  assert.equal(estPermissionCourrier("platform.audit.read"), false);
  assert.equal(estPermissionCourrier(null), false);
});
