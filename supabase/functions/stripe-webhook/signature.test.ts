// Oasis Care — Chantier Stripe. LES PREUVES SUR LA SIGNATURE.
//
// AUCUN RÉSEAU, AUCUNE CLÉ RÉELLE. Le secret est fabriqué ici même, et
// les corps signés le sont avec lui. Un test qui exigerait un vrai
// secret Stripe ou un appel à ses serveurs ne tournerait jamais en
// intégration — c'est-à-dire jamais.
//
//     node --test "supabase/functions/stripe-webhook/signature.test.ts"
//
// LA CHAÎNE DE CONFIANCE DE CE FICHIER, en trois maillons, parce que
// « mon HMAC est d'accord avec mon HMAC » ne prouve rien :
//   1. `node:crypto` est confronté au vecteur d'essai n° 1 de la
//      RFC 4231 — une valeur publiée, extérieure à ce dépôt.
//   2. Notre implémentation (Web Crypto, celle qui part en production)
//      est confrontée à `node:crypto` — deux moteurs cryptographiques
//      distincts, OpenSSL d'un côté, l'implémentation de la plateforme
//      de l'autre.
//   3. Le vérificateur complet est confronté à des corps forgés.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  calculerSignatureHex,
  TOLERANCE_PAR_DEFAUT_SECONDES,
  verifierSignatureStripe,
} from "./signature.ts";

// Un secret d'essai FABRIQUÉ ICI. Il n'a jamais existé chez Stripe et
// n'ouvre rien. La forme `whsec_…` est reproduite pour que le test
// éprouve bien le cas réel — le secret est employé en entier, préfixe
// compris.
const SECRET = "whsec_" + "e".repeat(16) + "ChantierEssaiLocal2026";
const SECRET_AUTRE = "whsec_" + "f".repeat(16) + "SecondSecretDeRotation";

const CORPS = new TextEncoder().encode(
  JSON.stringify({ id: "evt_essai_1", type: "invoice.paid", livemode: false }),
);

const MAINTENANT = 1_780_000_000;

function signerAvecNode(corps: Uint8Array, horodatage: number, secret: string): string {
  const charge = Buffer.concat([Buffer.from(`${horodatage}.`, "utf8"), Buffer.from(corps)]);
  return createHmac("sha256", secret).update(charge).digest("hex");
}

function entete(horodatage: number, ...signatures: string[]): string {
  return [`t=${horodatage}`, ...signatures.map((s) => `v1=${s}`)].join(",");
}

// ==================================================================
// MAILLON 1 — node:crypto contre un vecteur publié
// ==================================================================

test("MAILLON 1 : node:crypto reproduit le vecteur n° 1 de la RFC 4231", () => {
  // RFC 4231, § 4.2 : clé = 0x0b × 20, données = « Hi There ».
  const attendu = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
  const obtenu = createHmac("sha256", Buffer.alloc(20, 0x0b)).update("Hi There").digest("hex");
  assert.equal(obtenu, attendu, "node:crypto ne calcule pas un HMAC-SHA256 conforme — tout le reste est sans valeur.");
});

// ==================================================================
// MAILLON 2 — notre Web Crypto contre node:crypto
// ==================================================================

test("MAILLON 2 : notre signature concorde avec celle d'OpenSSL, sur plusieurs corps", async () => {
  const corps = [
    new Uint8Array(0),
    new TextEncoder().encode("{}"),
    CORPS,
    // Un corps avec des accents et une émoticône : si l'encodage
    // dérapait quelque part, c'est ici que ça se verrait.
    new TextEncoder().encode(JSON.stringify({ note: "Pépinière — 79,90 € HT ✅" })),
    // Un corps qui n'est pas de l'UTF-8 valide. C'est précisément le cas
    // où « lire en texte puis ré-encoder » diverge de « garder les
    // octets » : notre implémentation doit rester sur les octets.
    new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
  ];

  for (const c of corps) {
    for (const t of [0, 1, MAINTENANT, 2_000_000_000]) {
      const notre = await calculerSignatureHex(c, t, SECRET);
      assert.equal(notre, signerAvecNode(c, t, SECRET), `divergence pour t=${t}, ${c.length} octets`);
      assert.match(notre, /^[0-9a-f]{64}$/, "une empreinte SHA-256 fait 64 caractères hexadécimaux minuscules");
    }
  }
});

test("MAILLON 2 : le secret est employé EN ENTIER, préfixe whsec_ compris", async () => {
  const avecPrefixe = await calculerSignatureHex(CORPS, MAINTENANT, SECRET);
  const sansPrefixe = await calculerSignatureHex(CORPS, MAINTENANT, SECRET.replace("whsec_", ""));
  assert.notEqual(avecPrefixe, sansPrefixe);
  assert.equal(avecPrefixe, signerAvecNode(CORPS, MAINTENANT, SECRET));
});

// ==================================================================
// MAILLON 3 — LE VÉRIFICATEUR
// ==================================================================

test("une signature honnête est acceptée", async () => {
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(MAINTENANT, signerAvecNode(CORPS, MAINTENANT, SECRET)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.deepEqual(verdict, { valide: true, horodatage: MAINTENANT });
});

test("UNE MAUVAISE SIGNATURE EST REFUSÉE", async () => {
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(MAINTENANT, "0".repeat(64)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
  assert.equal(verdict.valide === false && verdict.motif, "signatureNonConcordante");
});

test("UNE SIGNATURE FAITE AVEC UN AUTRE SECRET EST REFUSÉE", async () => {
  // C'est l'attaque évidente : quelqu'un qui connaît le schéma mais pas
  // le secret. Si ce test passait au vert avec `valide: true`, n'importe
  // qui sur Internet pourrait ouvrir un abonnement payant.
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(MAINTENANT, signerAvecNode(CORPS, MAINTENANT, SECRET_AUTRE)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
});

test("UN CORPS MODIFIÉ D'UN SEUL OCTET EST REFUSÉ", async () => {
  const signature = signerAvecNode(CORPS, MAINTENANT, SECRET);
  const falsifie = new Uint8Array(CORPS);
  falsifie[falsifie.length - 2] ^= 0x01;

  const verdict = await verifierSignatureStripe({
    corpsBrut: falsifie,
    enteteSignature: entete(MAINTENANT, signature),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
});

test("UN CORPS RÉ-ENCODÉ NE PASSE PAS — la preuve qu'il faut les octets bruts", async () => {
  // L'erreur classique : `JSON.parse` puis `JSON.stringify`. Le résultat
  // est du JSON équivalent, mais pas les mêmes octets. Ce test fige le
  // symptôme, pour que personne ne « corrige » un jour la vérification
  // en désactivant la vérification.
  const original = new TextEncoder().encode('{"b": 2,  "a":1}');
  const reencode = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(original))));
  assert.notDeepEqual([...original], [...reencode], "le test lui-même serait vide si les deux étaient identiques");

  const signature = signerAvecNode(original, MAINTENANT, SECRET);
  const verdict = await verifierSignatureStripe({
    corpsBrut: reencode,
    enteteSignature: entete(MAINTENANT, signature),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
});

test("UN CORPS NON SIGNÉ EST REFUSÉ — en-tête absente", async () => {
  for (const valeur of [null, undefined, "", "   "]) {
    const verdict = await verifierSignatureStripe({
      corpsBrut: CORPS,
      enteteSignature: valeur,
      secret: SECRET,
      maintenantSecondes: MAINTENANT,
    });
    assert.equal(verdict.valide, false);
    assert.equal(verdict.valide === false && verdict.motif, "enteteAbsente");
  }
});

test("SANS SECRET CONFIGURÉ, ON ÉCHOUE FERMÉ — jamais « rien à vérifier »", async () => {
  for (const valeur of [null, undefined, ""]) {
    const verdict = await verifierSignatureStripe({
      corpsBrut: CORPS,
      enteteSignature: entete(MAINTENANT, signerAvecNode(CORPS, MAINTENANT, SECRET)),
      secret: valeur,
      maintenantSecondes: MAINTENANT,
    });
    assert.equal(verdict.valide, false);
    assert.equal(verdict.valide === false && verdict.motif, "secretAbsent");
  }
});

test("UN EN-TÊTE SANS v1 EST REFUSÉ — y compris s'il ne porte que du v0", async () => {
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: `t=${MAINTENANT},v0=${signerAvecNode(CORPS, MAINTENANT, SECRET)}`,
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
  assert.equal(verdict.valide === false && verdict.motif, "signatureAbsente");
});

test("UN EN-TÊTE SANS HORODATAGE LISIBLE EST REFUSÉ", async () => {
  const signature = signerAvecNode(CORPS, MAINTENANT, SECRET);
  for (const brut of [
    `v1=${signature}`,
    `t=,v1=${signature}`,
    `t=abc,v1=${signature}`,
    // Le piège : `parseInt` accepterait « 1780000000xyz » et
    // tronquerait. On exige des chiffres et rien d'autre.
    `t=${MAINTENANT}xyz,v1=${signature}`,
    `t=-${MAINTENANT},v1=${signature}`,
  ]) {
    const verdict = await verifierSignatureStripe({
      corpsBrut: CORPS,
      enteteSignature: brut,
      secret: SECRET,
      maintenantSecondes: MAINTENANT,
    });
    assert.equal(verdict.valide, false, `accepté à tort : ${brut}`);
    assert.equal(verdict.valide === false && verdict.motif, "horodatageAbsent");
  }
});

test("LE REJEU D'UN CORPS AUTHENTIQUE MAIS ANCIEN EST REFUSÉ", async () => {
  const vieux = MAINTENANT - TOLERANCE_PAR_DEFAUT_SECONDES - 1;
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    // La signature est PARFAITEMENT valide : c'est bien un corps signé
    // par Stripe. Seul son âge le disqualifie.
    enteteSignature: entete(vieux, signerAvecNode(CORPS, vieux, SECRET)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
  assert.equal(verdict.valide === false && verdict.motif, "horodatageHorsTolerance");
});

test("juste dans la tolérance, c'est accepté — la limite est franche des deux côtés", async () => {
  const limite = MAINTENANT - TOLERANCE_PAR_DEFAUT_SECONDES;
  const accepte = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(limite, signerAvecNode(CORPS, limite, SECRET)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(accepte.valide, true);

  const trop = limite - 1;
  const refuse = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(trop, signerAvecNode(CORPS, trop, SECRET)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(refuse.valide, false);
});

test("UN HORODATAGE TRÈS EN AVANCE EST REFUSÉ — c'est une horloge fausse", async () => {
  // Sans ce contrôle, une machine en retard d'une heure accepterait tout
  // rejeu de la dernière heure : le contrôle du passé deviendrait
  // inopérant sans que rien ne le signale.
  const avance = MAINTENANT + TOLERANCE_PAR_DEFAUT_SECONDES + 1;
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(avance, signerAvecNode(CORPS, avance, SECRET)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, false);
  assert.equal(verdict.valide === false && verdict.motif, "horodatageHorsTolerance");
});

test("LA ROTATION DE SECRET FONCTIONNE — plusieurs v1, un seul doit concorder", async () => {
  // Pendant une rotation, Stripe signe avec l'ancien ET le nouveau
  // secret. Un vérificateur qui ne regarderait que la première
  // signature couperait les paiements pendant la bascule.
  const bonne = signerAvecNode(CORPS, MAINTENANT, SECRET);
  const autre = signerAvecNode(CORPS, MAINTENANT, SECRET_AUTRE);

  for (const ordre of [[autre, bonne], [bonne, autre], [autre, autre, bonne]]) {
    const verdict = await verifierSignatureStripe({
      corpsBrut: CORPS,
      enteteSignature: entete(MAINTENANT, ...ordre),
      secret: SECRET,
      maintenantSecondes: MAINTENANT,
    });
    assert.equal(verdict.valide, true, `refusé à tort avec ${ordre.length} signatures`);
  }

  // Et aucune qui concorde reste un refus, même à trois.
  const rien = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: entete(MAINTENANT, autre, "0".repeat(64), "f".repeat(64)),
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(rien.valide, false);
});

test("l'en-tête est lue avec tolérance sur les espaces et la casse hexadécimale", async () => {
  const signature = signerAvecNode(CORPS, MAINTENANT, SECRET);
  const verdict = await verifierSignatureStripe({
    corpsBrut: CORPS,
    enteteSignature: ` t=${MAINTENANT} , v1=${signature.toUpperCase()} `,
    secret: SECRET,
    maintenantSecondes: MAINTENANT,
  });
  assert.equal(verdict.valide, true);
});

test("une signature tronquée ou rallongée est refusée sans lever", async () => {
  const signature = signerAvecNode(CORPS, MAINTENANT, SECRET);
  for (const abimee of [signature.slice(0, 63), signature + "0", signature.slice(2)]) {
    const verdict = await verifierSignatureStripe({
      corpsBrut: CORPS,
      enteteSignature: entete(MAINTENANT, abimee),
      secret: SECRET,
      maintenantSecondes: MAINTENANT,
    });
    assert.equal(verdict.valide, false);
  }
});

test("le vérificateur NE LÈVE JAMAIS, quelle que soit l'en-tête", async () => {
  // Un vérificateur qui lève finit enveloppé dans un `try`, et un `try`
  // finit par avoir un `catch` qui laisse passer.
  const enTetes = [
    "n'importe quoi",
    "=",
    ",,,,",
    "t=1,v1=",
    "t=1,t=2,v1=abc",
    "v1=abc,v1=def",
    "t=99999999999999999999,v1=abc",
    " ",
  ];
  for (const brut of enTetes) {
    const verdict = await verifierSignatureStripe({
      corpsBrut: CORPS,
      enteteSignature: brut,
      secret: SECRET,
      maintenantSecondes: MAINTENANT,
    });
    assert.equal(verdict.valide, false, `accepté à tort : ${JSON.stringify(brut)}`);
  }
});
