// §PORTE ANONYME — LES PREUVES SUR LA GARDE.
//
//     node --test --experimental-strip-types "app/d/garde.test.ts"
//
// L'horloge est injectée : aucun test n'attend cinq minutes, et aucun ne
// dépend de l'heure qu'il est.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adresseVisiteur,
  creerGarde,
  ECHECS_TOLERES,
  ECHECS_TOLERES_SOUS_ATTAQUE,
  empreinteVisiteur,
  FENETRE_MS,
} from "./garde.ts";

const T0 = 1_800_000_000_000;
const IP = "203.0.113.7";

function entetes(paires: Record<string, string>) {
  return { get: (nom: string) => paires[nom] ?? null };
}

// ------------------------------------------------------------------
// 1. ON NE COMPTE QUE LES ÉCHECS
// ------------------------------------------------------------------

test("un visiteur qui n'échoue jamais n'est jamais ralenti", () => {
  const garde = creerGarde();
  const moi = empreinteVisiteur(IP);
  // Mille ouvertures réussies : rien n'est noté, donc rien ne bloque.
  for (let i = 0; i < 1000; i += 1) {
    assert.equal(garde.verdict(moi, T0), "libre");
  }
  assert.equal(garde.adressesSuivies(), 0);
});

test("le cas normal ne demande RIEN à la base", () => {
  // « libre » se prononce sans le signal global de saturation. C'est ce
  // qui fait qu'un client ouvrant son devis ne coûte qu'un seul
  // aller-retour : celui qui lui rend son document.
  const garde = creerGarde();
  const moi = empreinteVisiteur(IP);
  assert.equal(garde.verdict(moi, T0), "libre");
  garde.noterEchec(moi, T0);
  assert.equal(garde.verdict(moi, T0), "libre");
});

test("un client légitime garde la main pendant une saturation générale", () => {
  // LA RÈGLE DE 0089 § 8.c : « ce qu'on ne fait surtout pas, c'est
  // refuser les jetons VALIDES pendant une saturation ». Un client qui
  // reçoit son devis pendant qu'un curieux tape au hasard doit pouvoir
  // le lire.
  const garde = creerGarde();
  const moi = empreinteVisiteur(IP);
  assert.equal(garde.verdict(moi, T0), "libre");
});

// ------------------------------------------------------------------
// 2. LE SEUIL, ET SON RESSERREMENT
// ------------------------------------------------------------------

test("le seuil ordinaire laisse dix échecs puis refuse", () => {
  const garde = creerGarde();
  const moi = empreinteVisiteur(IP);
  for (let i = 0; i < ECHECS_TOLERES; i += 1) {
    assert.notEqual(garde.verdict(moi, T0), "bloque", `échec ${i} refusé trop tôt`);
    garde.noterEchec(moi, T0);
  }
  assert.equal(garde.verdict(moi, T0), "bloque");
});

test("le seuil se resserre quand la base signale qu'elle déborde", () => {
  const garde = creerGarde();
  const moi = empreinteVisiteur(IP);
  for (let i = 0; i < ECHECS_TOLERES_SOUS_ATTAQUE; i += 1) garde.noterEchec(moi, T0);

  // « aVerifier » est la bande où le signal global change la réponse :
  // la page interroge alors la base, et refuse seulement si elle
  // déborde. Hors saturation, cette adresse a encore de la marge — le
  // resserrement est une réaction, pas une punition définitive.
  assert.equal(garde.verdict(moi, T0), "aVerifier");
});

test("deux visiteurs différents ne se gênent pas", () => {
  const garde = creerGarde();
  const balayeur = empreinteVisiteur("198.51.100.9");
  const client = empreinteVisiteur(IP);
  for (let i = 0; i < ECHECS_TOLERES + 5; i += 1) garde.noterEchec(balayeur, T0);

  assert.equal(garde.verdict(balayeur, T0), "bloque");
  // C'est tout l'intérêt de compter par adresse plutôt que globalement :
  // un balayeur qui bloquerait les vrais clients aurait obtenu
  // exactement ce qu'il cherchait.
  assert.equal(garde.verdict(client, T0), "libre");
});

// ------------------------------------------------------------------
// 3. LA FENÊTRE
// ------------------------------------------------------------------

test("la fenêtre suivante rend la main", () => {
  const garde = creerGarde();
  const moi = empreinteVisiteur(IP);
  for (let i = 0; i < ECHECS_TOLERES; i += 1) garde.noterEchec(moi, T0);
  assert.equal(garde.verdict(moi, T0), "bloque");
  assert.equal(garde.verdict(moi, T0 + FENETRE_MS), "libre");
});

test("les compteurs périmés sont élagués", () => {
  const garde = creerGarde();
  garde.noterEchec(empreinteVisiteur("198.51.100.1"), T0);
  garde.noterEchec(empreinteVisiteur("198.51.100.2"), T0);
  assert.equal(garde.adressesSuivies(), 2);
  // Une écriture dans une fenêtre postérieure nettoie les précédentes :
  // une table qui grandit sans limite est le levier par lequel on
  // remplit la mémoire.
  garde.noterEchec(empreinteVisiteur("198.51.100.3"), T0 + FENETRE_MS);
  assert.equal(garde.adressesSuivies(), 1);
});

// ------------------------------------------------------------------
// 4. QUAND ON NE SAIT PAS QUI FRAPPE
// ------------------------------------------------------------------

test("sans adresse lisible la garde s'efface au lieu de tout bloquer", () => {
  const garde = creerGarde();
  // Un seau commun ferait qu'un balayeur bloque les vrais clients. On
  // préfère ne pas gêner : la vraie barrière reste les 256 bits du
  // jeton, et la base compte de son côté.
  for (let i = 0; i < 100; i += 1) garde.noterEchec(null, T0);
  assert.equal(garde.verdict(null, T0), "libre");
  assert.equal(garde.adressesSuivies(), 0);
});

// ------------------------------------------------------------------
// 5. L'EMPREINTE — ON NE GARDE PAS L'ADRESSE
// ------------------------------------------------------------------

test("l'empreinte ne contient pas l'adresse", () => {
  const empreinte = empreinteVisiteur(IP);
  assert.notEqual(empreinte, null);
  // Une table en mémoire finit dans un vidage de tas ou un rapport
  // d'incident. Une adresse IP est une donnée personnelle ; une
  // empreinte de quelques caractères suffit à compter.
  assert.equal(empreinte!.includes(IP), false);
  assert.equal(empreinte!.includes("203"), false);
  assert.ok(empreinte!.length <= 8);
});

test("la même adresse donne la même empreinte, deux adresses non", () => {
  assert.equal(empreinteVisiteur(IP), empreinteVisiteur(" " + IP + " "));
  assert.notEqual(empreinteVisiteur(IP), empreinteVisiteur("198.51.100.9"));
});

test("une adresse absente ou vide ne donne pas d'empreinte", () => {
  assert.equal(empreinteVisiteur(null), null);
  assert.equal(empreinteVisiteur("   "), null);
});

// ------------------------------------------------------------------
// 6. LA LECTURE DES EN-TÊTES
// ------------------------------------------------------------------

test("x-forwarded-for rend le PREMIER élément, celui du visiteur", () => {
  // Les suivants sont les relais traversés : prendre le dernier
  // donnerait toujours la même valeur, celle de notre propre hébergeur,
  // et tout le monde partagerait un seul compteur.
  assert.equal(
    adresseVisiteur(entetes({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" })),
    "203.0.113.7",
  );
  assert.equal(adresseVisiteur(entetes({ "x-forwarded-for": "  203.0.113.7  " })), "203.0.113.7");
});

test("x-real-ip prend le relais, et l'absence des deux rend null", () => {
  assert.equal(adresseVisiteur(entetes({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(adresseVisiteur(entetes({})), null);
  assert.equal(adresseVisiteur(entetes({ "x-forwarded-for": "   " })), null);
});
