// LE PARCOURS D'ENTRÉE DU CONTROL CENTER, ÉPROUVÉ SANS NAVIGATEUR.
//
//     node --test --experimental-strip-types "app/login/parcours.test.ts"
//
// ══════════════════════════════════════════════════════════════════
// CE QU'ON PROUVE ICI
// ══════════════════════════════════════════════════════════════════
//
// Pas que la page s'affiche. Ce qu'on prouve, ce sont les DÉCISIONS :
// la règle du mot de passe, la traduction des refus, et surtout ce que
// l'écran refuse de dire. Un message qui en dit trop ne casse rien, ne
// lève aucune exception, ne rougit dans aucun journal — il se contente
// de publier la liste des gens qui administrent la plateforme.
//
// Un de ces tests couvre une fuite QUI EXISTAIT VRAIMENT sur cette
// page, et qui était visible à l'œil nu : voir « le refus qui trahit un
// compte inconnu est tu ».
//
// Aucun appel réseau, aucune clé : ce fichier n'importe que du calcul.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aUneIdentiteEmail,
  codeComplet,
  DELAI_RENVOI_S,
  DUREE_VIE_CODE_MS,
  envoiDoitResterMuet,
  interpreterEchecCode,
  LONGUEUR_CODE,
  LONGUEUR_CODE_SECOND_FACTEUR,
  LONGUEUR_MOT_DE_PASSE,
  messageEchecEnvoi,
  messageEchecIdentifiants,
  messageEchecMotDePasse,
  messageRetourDeLien,
  nettoyerCode,
  REGLE_MOT_DE_PASSE,
  verifierNouveauMotDePasse,
} from "./parcours.ts";

/* ==================================================================
   1. LES DEUX CODES NE SE CONFONDENT PAS
   ================================================================== */

test("le code d'entrée et le code du second facteur n'ont pas la même longueur", () => {
  // C'est le garde-fou le plus efficace de cet écran, et il est
  // gratuit. Un administrateur enrôlé voit DEUX champs de chiffres à
  // trois écrans d'intervalle ; s'ils faisaient tous deux six chiffres,
  // personne ne saurait lequel est lequel.
  //
  //   entrée        → 8 chiffres, reçus par e-mail, valables 1 heure
  //   second facteur → 6 chiffres, lus dans une application, 30 s
  //
  // Ne pas ramener `mailer_otp_length` à 6 dans le tableau de bord :
  // ce test tomberait, et à raison.
  assert.equal(LONGUEUR_CODE, 8);
  assert.equal(LONGUEUR_CODE_SECOND_FACTEUR, 6);
  assert.notEqual(LONGUEUR_CODE, LONGUEUR_CODE_SECOND_FACTEUR);
});

/* ==================================================================
   2. LE CODE — COLLAGE ET COMPLÉTUDE
   ================================================================== */

test("le collage pardonne tout ce que les gens collent vraiment", () => {
  assert.equal(nettoyerCode("12 34 56 78"), "12345678");
  assert.equal(nettoyerCode("Code : 12345678"), "12345678");
  assert.equal(nettoyerCode("\n 1234-5678 \n"), "12345678");
  assert.equal(nettoyerCode("123456789012"), "12345678");
  assert.equal(nettoyerCode("pas un chiffre"), "");
});

test("la validation ne part que quand le compte y est", () => {
  assert.equal(codeComplet("1234567"), false);
  assert.equal(codeComplet("12345678"), true);
  // Six chiffres — la longueur du code de second facteur — ne suffisent
  // pas ici, et c'est exactement ce qu'on veut : celui qui recopie le
  // code de son application d'authentification ne déclenche rien.
  assert.equal(codeComplet("123456"), false);
});

/* ==================================================================
   3. LE MOT DE PASSE — LA LONGUEUR, ET RIEN D'AUTRE
   ================================================================== */

test("la barre est à douze caractères, bien au-dessus du plancher serveur", () => {
  assert.equal(LONGUEUR_MOT_DE_PASSE, 12);
  assert.ok(LONGUEUR_MOT_DE_PASSE > 6);
});

test("aucune composition n'est imposée, et rien n'est interdit", () => {
  assert.deepEqual(
    verifierNouveauMotDePasse("le jardin de ma grand mère", "le jardin de ma grand mère"),
    { ok: true },
  );
  const bizarre = "jardinière 🌿 été 2026 ";
  assert.deepEqual(verifierNouveauMotDePasse(bizarre, bizarre), { ok: true });
  const queDesLettres = "abcdefghijkl";
  assert.deepEqual(verifierNouveauMotDePasse(queDesLettres, queDesLettres), { ok: true });
});

test("les espaces ne sont pas rognés", () => {
  const avecEspace = "  une phrase longue  ";
  assert.deepEqual(verifierNouveauMotDePasse(avecEspace, avecEspace), { ok: true });
  assert.equal(
    verifierNouveauMotDePasse("une phrase longue ", "une phrase longue").ok,
    false,
  );
});

test("un émoji compte pour un caractère, comme on le voit", () => {
  const douze = "🌿".repeat(12);
  assert.deepEqual(verifierNouveauMotDePasse(douze, douze), { ok: true });
  assert.equal(verifierNouveauMotDePasse("🌿".repeat(11), "🌿".repeat(11)).ok, false);
});

test("AUCUN message ne contient jamais le mot de passe saisi", () => {
  const secret = "phrase-secrète-de-clément";
  for (const verdict of [
    verifierNouveauMotDePasse(secret, "autre chose"),
    verifierNouveauMotDePasse(secret.slice(0, 3), secret.slice(0, 3)),
  ]) {
    if (verdict.ok) continue;
    assert.equal(verdict.message.includes(secret), false);
    assert.equal(verdict.message.includes("secrète"), false);
  }
});

test("la règle est écrite pour être lue AVANT la saisie", () => {
  assert.match(REGLE_MOT_DE_PASSE, /12 caractères/);
  assert.match(REGLE_MOT_DE_PASSE, /Aucune majuscule/);
  assert.match(REGLE_MOT_DE_PASSE, /rien n'est interdit/);
});

/* ==================================================================
   4. LES QUATRE ISSUES DU CODE
   ================================================================== */

const T0 = 1_800_000_000_000;

test("un code refusé peu après l'envoi est FAUX, pas expiré", () => {
  const issue = interpreterEchecCode({
    code: "otp_expired",
    envoyeLe: T0,
    maintenant: T0 + 2 * 60 * 1000,
  });
  assert.equal(issue.issue, "faux");
  assert.match(issue.message, /Vérifiez les huit chiffres/);
});

test("un code refusé après une heure est EXPIRÉ : retaper ne sert à rien", () => {
  const issue = interpreterEchecCode({
    code: "otp_expired",
    envoyeLe: T0,
    maintenant: T0 + DUREE_VIE_CODE_MS + 1,
  });
  assert.equal(issue.issue, "expire");
  assert.match(issue.message, /Demandez-en un nouveau/);
});

test("quand on ignore l'heure d'envoi, on le dit et on offre les deux gestes", () => {
  const issue = interpreterEchecCode({
    code: "otp_expired",
    envoyeLe: null,
    maintenant: T0,
  });
  assert.equal(issue.issue, "incertain");
  assert.match(issue.message, /mal recopié/);
  assert.match(issue.message, /périmé/);
});

test("trop de tentatives n'invente AUCUNE durée d'attente", () => {
  for (const code of ["over_request_rate_limit", "over_email_send_rate_limit"]) {
    const issue = interpreterEchecCode({ code, envoyeLe: T0, maintenant: T0 });
    assert.equal(issue.issue, "trop_de_tentatives");
    assert.equal(/\d+\s*(minute|seconde|heure)/.test(issue.message), false);
  }
});

test("aucune issue ne laisse passer un message anglais du serveur", () => {
  const issue = interpreterEchecCode({
    code: "un_code_que_le_sdk_ne_connait_pas_encore",
    message: "Token has expired or is invalid",
    envoyeLe: T0,
    maintenant: T0,
  });
  assert.equal(issue.message.includes("Token"), false);
  assert.equal(issue.message.includes("invalid"), false);
});

/* ==================================================================
   5. LA FUITE QUI EXISTAIT, ET QUI N'EXISTE PLUS
   ================================================================== */

test("le refus qui trahit un compte inconnu est TU", () => {
  // ══════════════════════════════════════════════════════════════
  // CE TEST GARDE UNE FUITE RÉELLE, DÉJÀ PRÉSENTE EN PRODUCTION.
  // ══════════════════════════════════════════════════════════════
  // Le Control Center demande ses codes avec `shouldCreateUser: false`.
  // Le service d'authentification refuse alors une adresse INCONNUE
  // avec `otp_disabled` — et l'ancienne page affichait ce refus tel
  // quel :
  //     adresse connue   → panneau calme « code envoyé, s'il y a lieu »
  //     adresse inconnue → bandeau rouge
  // La différence se voyait à l'œil nu, sans aucun outil. Toute la
  // prudence de l'en-tête de la page tombait sur cette seule ligne.
  assert.equal(envoiDoitResterMuet("otp_disabled"), true);
  assert.equal(envoiDoitResterMuet("signup_disabled"), true);
});

test("le plafond d'envoi est tu aussi : il n'existe que pour un compte réel", () => {
  // LA FUITE QU'ON N'AVAIT PAS VUE, ET QUI SE JOUAIT EN DEUX CLICS.
  // `over_email_send_rate_limit` n'est atteignable que si un courriel
  // est PARTI — donc jamais pour une adresse inconnue, mesuré sur la
  // production : deux demandes de suite sur une adresse inconnue
  // rendent `otp_disabled` les deux fois, jamais le plafond. Affiché,
  // il disait donc « cette adresse a un compte ».
  assert.equal(envoiDoitResterMuet("over_email_send_rate_limit"), true);
});

test("les vrais problèmes d'envoi, eux, restent visibles", () => {
  // Taire tout serait aussi mauvais : une adresse mal tapée doit être
  // signalée, sinon la personne attend un code qui ne viendra jamais.
  // Ces refus-là ne disent rien de l'existence du compte.
  assert.equal(envoiDoitResterMuet("email_address_invalid"), false);
  assert.equal(envoiDoitResterMuet("validation_failed"), false);
  assert.equal(envoiDoitResterMuet("over_request_rate_limit"), false);
  assert.equal(envoiDoitResterMuet(null), false);
  assert.equal(envoiDoitResterMuet(undefined), false);
});

test("le message d'échec d'envoi ne parle jamais de compte", () => {
  for (const code of [
    "over_email_send_rate_limit",
    "over_request_rate_limit",
    "email_address_invalid",
    null,
  ]) {
    const message = messageEchecEnvoi(code);
    assert.equal(/compte|inscrit|administrateur|équipe/i.test(message), false);
  }
});

/* ==================================================================
   6. LA CONNEXION PAR MOT DE PASSE NE DIT RIEN NON PLUS
   ================================================================== */

test("tous les refus d'identifiants rendent la MÊME phrase, suspension comprise", () => {
  // Ici, même « ce compte est suspendu » est une information qu'on ne
  // donne pas : elle dirait que le compte existe, et sur cette page
  // cela revient à nommer un membre de l'équipe. Oasis Care Pro peut se
  // le permettre, le Control Center non.
  const attendu = messageEchecIdentifiants("invalid_credentials");
  for (const code of [
    "email_not_confirmed",
    "user_banned",
    "un_code_inconnu",
    null,
    undefined,
  ]) {
    assert.equal(messageEchecIdentifiants(code), attendu);
  }
});

test("le message d'échec ne nomme jamais ce qui a échoué", () => {
  const message = messageEchecIdentifiants("invalid_credentials");
  assert.equal(/n'existe pas|inconnu|introuvable/i.test(message), false);
  assert.equal(/incorrect|erroné|faux/i.test(message), false);
  assert.equal(/confirmée|vérifiée|suspendu/i.test(message), false);
  assert.match(message, /demandez un code/i);
});

/* ==================================================================
   7. GOOGLE — JAMAIS DE MOT DE PASSE POUR UN COMPTE PUREMENT SOCIAL
   ================================================================== */

test("un compte purement social ne se voit jamais proposer de mot de passe", () => {
  assert.equal(aUneIdentiteEmail([{ provider: "google" }]), false);
  assert.equal(aUneIdentiteEmail([{ provider: "apple" }]), false);
  assert.equal(aUneIdentiteEmail(undefined), false);
  assert.equal(aUneIdentiteEmail(null), false);
  assert.equal(aUneIdentiteEmail([]), false);
});

test("un compte lié garde son mot de passe ET ses fournisseurs", () => {
  assert.equal(
    aUneIdentiteEmail([{ provider: "email" }, { provider: "google" }]),
    true,
  );
});

/* ==================================================================
   8. LE RETOUR D'UN LIEN
   ================================================================== */

test("les motifs de /auth/callback sont enfin traduits", () => {
  assert.match(messageRetourDeLien("lien_incomplet"), /incomplet/);
  assert.match(messageRetourDeLien("type_de_lien_inconnu"), /code à huit chiffres/);
  assert.match(messageRetourDeLien("Token has expired or is invalid"), /n'est plus valable/);
});

test("un message anglais du serveur n'est jamais réaffiché tel quel", () => {
  const message = messageRetourDeLien("Email link is invalid or has expired");
  assert.equal(message.includes("Email link"), false);
  assert.equal(message.includes("expired"), false);
});

/* ==================================================================
   9. LES NOMBRES QUI DOIVENT SUIVRE LE SERVEUR
   ================================================================== */

test("le délai de renvoi n'est jamais inférieur à ce que le serveur accepte", () => {
  // `smtp_max_frequency = 60`. Un bouton qui redevient cliquable avant
  // offre un geste que le serveur refusera.
  assert.ok(DELAI_RENVOI_S >= 60);
});

test("la durée de vie du code correspond au réglage du projet", () => {
  // `mailer_otp_exp = 3600`.
  assert.equal(DUREE_VIE_CODE_MS, 3_600_000);
});

/* ==================================================================
   10. L'ENREGISTREMENT DU MOT DE PASSE
   ================================================================== */

test("le refus d'un mot de passe éventé se dit franchement", () => {
  assert.match(messageEchecMotDePasse("weak_password"), /listes de mots de passe volés/);
});

test("reposer le même mot de passe n'est pas présenté comme un échec", () => {
  assert.match(messageEchecMotDePasse("same_password"), /Vous pouvez continuer/);
});

test("aucun message de mot de passe n'est en anglais ni technique", () => {
  for (const code of ["weak_password", "same_password", "reauthentication_needed", null]) {
    assert.equal(/password|error|failed|invalid/i.test(messageEchecMotDePasse(code)), false);
  }
});
