// LE PARCOURS D'ENTRÉE, ÉPROUVÉ SANS NAVIGATEUR ET SANS RÉSEAU.
//
//     node --test --experimental-strip-types "app/login/parcours.test.ts"
//
// ══════════════════════════════════════════════════════════════════
// CE QU'ON PROUVE ICI
// ══════════════════════════════════════════════════════════════════
//
// Pas que la page s'affiche — ça, aucun test ne le dira mieux qu'un
// coup d'œil. Ce qu'on prouve, ce sont les DÉCISIONS : la règle du mot
// de passe, la traduction des refus, et surtout ce que l'écran refuse
// de dire. Un message qui en dit trop ne casse rien, ne lève aucune
// exception, ne rougit dans aucun journal — il se contente de publier
// la liste des clients. C'est exactement le genre de faute qu'un test
// doit attraper.
//
// Aucun appel réseau, aucune clé, aucun secret : ce fichier n'importe
// que du calcul pur.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aUneIdentiteEmail,
  codeComplet,
  DELAI_RENVOI_S,
  destinationSure,
  DUREE_VIE_CODE_MS,
  interpreterEchecCode,
  LONGUEUR_CODE,
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
   1. LE CODE — HUIT CHIFFRES, ET UN COLLAGE QUI PARDONNE
   ================================================================== */

test("le code fait huit chiffres, pas six", () => {
  // Six serait la longueur du code de SECOND FACTEUR du Control
  // Center. Les confondre mettrait deux champs indiscernables à trois
  // écrans d'intervalle. Le projet est réglé sur huit
  // (`mailer_otp_length = 8`) : cette constante doit le suivre.
  assert.equal(LONGUEUR_CODE, 8);
});

test("le collage pardonne tout ce que les gens collent vraiment", () => {
  // Les formes observées dans la nature : des espaces, un préfixe, un
  // espace insécable au bout, un retour à la ligne.
  assert.equal(nettoyerCode("12 34 56 78"), "12345678");
  assert.equal(nettoyerCode("Code : 12345678"), "12345678");
  assert.equal(nettoyerCode("12345678 "), "12345678");
  assert.equal(nettoyerCode("\n 1234-5678 \n"), "12345678");
});

test("le champ ne se laisse pas déborder", () => {
  // Coller la ligne entière du courriel ne doit pas remplir le champ de
  // vingt chiffres : on tronque à ce qu'un code peut valoir.
  assert.equal(nettoyerCode("123456789012"), "12345678");
  assert.equal(nettoyerCode("").length, 0);
  assert.equal(nettoyerCode("pas un chiffre"), "");
});

test("la validation ne part que quand le compte y est", () => {
  assert.equal(codeComplet("1234567"), false);
  assert.equal(codeComplet("12345678"), true);
  assert.equal(codeComplet("123456"), false);
});

/* ==================================================================
   2. LE MOT DE PASSE — LA LONGUEUR, ET RIEN D'AUTRE
   ================================================================== */

test("la barre est à douze caractères, bien au-dessus du plancher serveur", () => {
  // Le projet accepte six (`password_min_length = 6`). C'est nous qui
  // montons la barre, et c'est le seul contrôle qu'on impose.
  assert.equal(LONGUEUR_MOT_DE_PASSE, 12);
  assert.ok(LONGUEUR_MOT_DE_PASSE > 6);
});

test("aucune composition n'est imposée, et rien n'est interdit", () => {
  // Une phrase en minuscules, avec des espaces : acceptée. C'est tout
  // l'intérêt du choix — « Paysage1! » est plus court et plus faible.
  assert.deepEqual(
    verifierNouveauMotDePasse("le jardin de ma grand mère", "le jardin de ma grand mère"),
    { ok: true },
  );
  // Des accents, des émojis, un espace final, un caractère de contrôle
  // en plein milieu : rien n'est refusé.
  const bizarre = "jardinière 🌿 été 2026 ";
  assert.deepEqual(verifierNouveauMotDePasse(bizarre, bizarre), { ok: true });
  // Et surtout : aucune règle de composition ne rôde dans le code.
  const que_des_lettres = "abcdefghijkl";
  assert.deepEqual(
    verifierNouveauMotDePasse(que_des_lettres, que_des_lettres),
    { ok: true },
  );
});

test("les espaces ne sont pas rognés", () => {
  // `trim()` semble aimable et ne l'est pas : la saisie acceptée ici
  // doit être exactement celle qui partira au serveur, sinon on
  // enferme quelqu'un dehors demain sans qu'il comprenne.
  const avecEspace = "  une phrase longue  ";
  assert.deepEqual(verifierNouveauMotDePasse(avecEspace, avecEspace), { ok: true });
  // Et deux saisies qui ne diffèrent que par un espace sont bien
  // signalées comme différentes.
  const verdict = verifierNouveauMotDePasse("une phrase longue ", "une phrase longue");
  assert.equal(verdict.ok, false);
});

test("un émoji compte pour un caractère, comme on le voit", () => {
  // Douze émojis font douze caractères à l'œil, et vingt-quatre unités
  // UTF-16. Compter les unités récompenserait les émojis pour de
  // mauvaises raisons.
  const douzeEmojis = "🌿".repeat(12);
  assert.deepEqual(verifierNouveauMotDePasse(douzeEmojis, douzeEmojis), { ok: true });
  const onzeEmojis = "🌿".repeat(11);
  assert.equal(verifierNouveauMotDePasse(onzeEmojis, onzeEmojis).ok, false);
});

test("le manque de longueur se dit en clair, et se compte", () => {
  const verdict = verifierNouveauMotDePasse("abc", "abc");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.champ, "premier");
  assert.match(verdict.ok === false ? verdict.message : "", /9 caractères/);

  const unSeul = verifierNouveauMotDePasse("abcdefghijk", "abcdefghijk");
  assert.match(unSeul.ok === false ? unSeul.message : "", /un caractère/);
});

test("les deux saisies se comparent, et l'écart désigne le second champ", () => {
  const verdict = verifierNouveauMotDePasse("phrase de douze", "phrase de douzE");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.champ, "second");
});

test("AUCUN message ne contient jamais le mot de passe saisi", () => {
  // La règle qui ne se négocie pas : un message finit dans un journal,
  // une capture d'écran, un rapport de bogue.
  const secret = "phrase-secrète-de-clément";
  for (const verdict of [
    verifierNouveauMotDePasse(secret, "autre chose"),
    verifierNouveauMotDePasse("court", "court"),
    verifierNouveauMotDePasse(secret.slice(0, 3), secret.slice(0, 3)),
  ]) {
    if (verdict.ok) continue;
    assert.equal(verdict.message.includes(secret), false);
    assert.equal(verdict.message.includes("secrète"), false);
  }
});

test("la règle est écrite pour être lue AVANT la saisie", () => {
  // Elle doit dire la longueur, et dire explicitement qu'il n'y a rien
  // à composer — c'est ce qui évite le « Paysage1! » réflexe.
  assert.match(REGLE_MOT_DE_PASSE, /12 caractères/);
  assert.match(REGLE_MOT_DE_PASSE, /Aucune majuscule/);
  assert.match(REGLE_MOT_DE_PASSE, /rien n'est interdit/);
});

/* ==================================================================
   3. LES QUATRE ISSUES DU CODE
   ================================================================== */

const T0 = 1_800_000_000_000;

test("un code refusé peu après l'envoi est FAUX, pas expiré", () => {
  // Le serveur rend le même `otp_expired` dans les deux cas. Mais un
  // code parti il y a deux minutes ne peut pas être périmé : on le sait
  // parce que c'est nous qui l'avons demandé. Retaper a du sens.
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
  // Onglet rechargé, code demandé sur un autre appareil : ce navigateur
  // ne sait rien. On n'invente pas — on décrit les deux possibilités.
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
    // Le serveur ne nous dit pas combien de temps. Annoncer « dans 5
    // minutes » serait une invention, et un mensonge une fois sur deux.
    assert.equal(/\d+\s*(minute|seconde|heure)/.test(issue.message), false);
    assert.match(issue.message, /nous ne savons pas combien de temps/);
  }
});

test("aucune issue ne laisse passer un message anglais du serveur", () => {
  const issue = interpreterEchecCode({
    code: "un_code_que_le_sdk_ne_connait_pas_encore",
    message: "Token has expired or is invalid",
    envoyeLe: T0,
    maintenant: T0,
  });
  assert.equal(issue.issue, "autre");
  assert.equal(issue.message.includes("Token"), false);
  assert.equal(issue.message.includes("invalid"), false);
});

test("la limite exacte de l'heure bascule du bon côté", () => {
  const juste = interpreterEchecCode({
    code: "otp_expired",
    envoyeLe: T0,
    maintenant: T0 + DUREE_VIE_CODE_MS - 1,
  });
  assert.equal(juste.issue, "faux");
  const pile = interpreterEchecCode({
    code: "otp_expired",
    envoyeLe: T0,
    maintenant: T0 + DUREE_VIE_CODE_MS,
  });
  assert.equal(pile.issue, "expire");
});

/* ==================================================================
   4. L'ÉCRAN NE RÉVÈLE JAMAIS QU'UNE ADRESSE EXISTE
   ================================================================== */

test("les trois refus d'identifiants rendent la MÊME phrase", () => {
  // C'est LA propriété qui protège la liste des clients. Le serveur ne
  // distingue déjà pas ces cas ; notre traduction ne doit surtout pas
  // réintroduire la distinction qu'il a pris soin d'effacer.
  const inconnu = messageEchecIdentifiants("invalid_credentials");
  const nonConfirme = messageEchecIdentifiants("email_not_confirmed");
  const inattendu = messageEchecIdentifiants("un_code_inconnu");
  assert.equal(inconnu, nonConfirme);
  assert.equal(inconnu, inattendu);
});

test("le message d'échec ne nomme jamais ce qui a échoué", () => {
  const message = messageEchecIdentifiants("invalid_credentials");
  // Ni « ce compte n'existe pas », ni « mot de passe incorrect », ni
  // « adresse non confirmée » : chacune de ces phrases répond à une
  // question qu'on ne veut pas voir posée.
  assert.equal(/n'existe pas|inconnu|introuvable/i.test(message), false);
  assert.equal(/incorrect|erroné|faux/i.test(message), false);
  assert.equal(/confirmée|vérifiée/i.test(message), false);
  // Et il dit quoi faire, sinon la personne reste plantée là.
  assert.match(message, /demandez un code/i);
});

test("le message d'échec d'envoi ne parle que d'envoi, jamais de compte", () => {
  for (const code of [
    "over_email_send_rate_limit",
    "over_request_rate_limit",
    "email_address_invalid",
    null,
  ]) {
    const message = messageEchecEnvoi(code);
    assert.equal(/compte|inscrit|client|administrateur/i.test(message), false);
  }
});

/* ==================================================================
   5. GOOGLE ET APPLE — JAMAIS DE MOT DE PASSE
   ================================================================== */

test("un compte purement social ne se voit jamais proposer de mot de passe", () => {
  assert.equal(aUneIdentiteEmail([{ provider: "apple" }]), false);
  assert.equal(aUneIdentiteEmail([{ provider: "google" }]), false);
  assert.equal(aUneIdentiteEmail([{ provider: "google" }, { provider: "apple" }]), false);
});

test("un compte lié — Apple, Google ET e-mail — reste un compte à mot de passe", () => {
  // C'est le cas du compte du dirigeant : trois identités, une seule
  // personne. Il doit pouvoir poser un mot de passe ET continuer
  // d'entrer par Apple ou par Google. Les deux parcours coexistent.
  assert.equal(
    aUneIdentiteEmail([
      { provider: "email" },
      { provider: "apple" },
      { provider: "google" },
    ]),
    true,
  );
});

test("l'absence d'information ne fabrique pas un mot de passe à réclamer", () => {
  // Sans identités lisibles, on ne réclame rien : mieux vaut laisser
  // entrer quelqu'un sans mot de passe que le bloquer devant un champ
  // qui ne le concerne pas.
  assert.equal(aUneIdentiteEmail(undefined), false);
  assert.equal(aUneIdentiteEmail(null), false);
  assert.equal(aUneIdentiteEmail([]), false);
  assert.equal(aUneIdentiteEmail([{ provider: null }]), false);
});

/* ==================================================================
   6. LE RETOUR D'UN LIEN, ET LA DESTINATION
   ================================================================== */

test("les motifs de /auth/callback sont enfin traduits", () => {
  // Ces messages tombaient dans le vide : la page ne lisait pas
  // `?error=`, et l'utilisateur revenait sur un écran muet.
  assert.match(messageRetourDeLien("lien_incomplet"), /incomplet/);
  assert.match(messageRetourDeLien("type_de_lien_inconnu"), /code à huit chiffres/);
  assert.match(
    messageRetourDeLien("Token has expired or is invalid"),
    /n'est plus valable/,
  );
});

test("un message anglais du serveur n'est jamais réaffiché tel quel", () => {
  const message = messageRetourDeLien("Email link is invalid or has expired");
  assert.equal(message.includes("Email link"), false);
  assert.equal(message.includes("expired"), false);
});

test("chaque traduction de lien renvoie vers le code, pas vers le lien", () => {
  // Le lien est un confort ; le code est le chemin qui marche depuis
  // n'importe quel appareil. Quand le lien a échoué, c'est le code
  // qu'il faut proposer.
  for (const motif of ["lien_incomplet", "type_de_lien_inconnu", "n'importe quoi"]) {
    assert.match(messageRetourDeLien(motif), /code/i);
  }
});

test("la destination ne quitte jamais ce site", () => {
  // Une connexion qui vient d'un courriel — donc d'un endroit où l'on
  // clique sans réfléchir — ne doit jamais servir de tremplin.
  assert.equal(destinationSure("/inscription"), "/inscription");
  assert.equal(destinationSure("/devis/42?onglet=lignes"), "/devis/42?onglet=lignes");
  assert.equal(destinationSure("https://ailleurs.example/vol"), "/");
  assert.equal(destinationSure("//ailleurs.example/vol"), "/");
  assert.equal(destinationSure("/\\ailleurs.example/vol"), "/");
  assert.equal(destinationSure("javascript:alert(1)"), "/");
  assert.equal(destinationSure(null), "/");
  assert.equal(destinationSure(""), "/");
});

test("un caractère invisible ne fait pas sortir du site", () => {
  // LE TROU QUI A ÉTÉ MESURÉ, ET QUE LA LISTE DE DÉBUTS INTERDITS NE
  // VOYAIT PAS. `?next=/<TABULATION>/ailleurs.example` commence par une
  // seule barre oblique — donc l'ancienne version le laissait passer.
  // Mais le navigateur retire tabulations et retours à la ligne AVANT
  // d'interpréter : ce qu'il ouvre est `//ailleurs.example`, c'est-à-dire
  // un autre site. Vérifié dans un vrai navigateur :
  //     new URL("/\tailleurs", "https://exemple.fr").href
  //         === "https://ailleurs/"
  for (const invisible of ["\t", "\n", "\r"]) {
    assert.equal(destinationSure(`/${invisible}/ailleurs.example/vol`), "/");
    assert.equal(destinationSure(`/${invisible}\\ailleurs.example/vol`), "/");
  }
  // `%09` est la même tabulation, écrite autrement : `URLSearchParams`
  // la décode avant que nous la voyions, mais on vérifie aussi la forme
  // encodée — elle, en revanche, reste un chemin honnête de ce site.
  assert.equal(destinationSure("/%09/ailleurs.example"), "/%09/ailleurs.example");
});

test("la destination rendue est celle que le navigateur ouvrira", () => {
  // On ne renvoie plus la chaîne reçue mais celle que l'analyseur d'URL
  // a reconstruite : c'est la seule façon de garantir que ce qui a été
  // vérifié est exactement ce qui sera exécuté.
  assert.equal(destinationSure("/devis/42#lignes"), "/devis/42#lignes");
  assert.equal(destinationSure("/a/../b"), "/b");
});

/* ==================================================================
   7. LES NOMBRES QUI DOIVENT SUIVRE LE SERVEUR
   ================================================================== */

test("le délai de renvoi n'est jamais inférieur à ce que le serveur accepte", () => {
  // `smtp_max_frequency = 60`. Un bouton qui redevient cliquable à 30
  // secondes offre un geste que le serveur refusera — c'est exactement
  // le défaut mesuré côté iPhone.
  assert.ok(DELAI_RENVOI_S >= 60);
});

test("la durée de vie du code correspond au réglage du projet", () => {
  // `mailer_otp_exp = 3600`. Si ce réglage change, cette ligne doit
  // suivre — sinon le message dira « vérifiez les chiffres » là où il
  // aurait dû dire « demandez-en un nouveau ».
  assert.equal(DUREE_VIE_CODE_MS, 3_600_000);
});

/* ==================================================================
   8. L'ENREGISTREMENT DU MOT DE PASSE
   ================================================================== */

test("le refus d'un mot de passe éventé se dit franchement", () => {
  // `weak_password` n'arrive que si la vérification des mots de passe
  // volés est activée. C'est le seul contrôle qui protège vraiment : il
  // mérite un vrai message, pas « une erreur est survenue ».
  const message = messageEchecMotDePasse("weak_password");
  assert.match(message, /listes de mots de passe volés/);
});

test("reposer le même mot de passe n'est pas présenté comme un échec", () => {
  assert.match(messageEchecMotDePasse("same_password"), /Vous pouvez continuer/);
});

test("aucun message de mot de passe n'est en anglais ni technique", () => {
  for (const code of ["weak_password", "same_password", "reauthentication_needed", null]) {
    const message = messageEchecMotDePasse(code);
    assert.equal(/password|error|failed|invalid/i.test(message), false);
  }
});
