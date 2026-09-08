import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { echeanceReelle } from "./echeance.ts";

/**
 * §PORTE ANONYME — CE QUE LE PANNEAU DU PAYSAGISTE PROMET.
 *
 * Deux choses s'éprouvent ici, et la seconde est la plus importante :
 *
 *   1. L'ÉCHÉANCE AFFICHÉE EST CELLE QUE LA PORTE TIENDRA. La base
 *      relit `valid_until` à chaque ouverture ; afficher la date du
 *      lien quand celle du devis est plus proche ferait promettre une
 *      date qui ne serait pas tenue.
 *
 *   2. LE VOCABULAIRE. « Ouvert » n'est pas « lu », et cette
 *      distinction n'est pas une coquetterie : les analyseurs de
 *      courriel ouvrent les liens à la livraison. Le paysagiste décide
 *      d'appeler ou non son client sur cette phrase.
 */

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
}

/**
 * LE CODE SANS SES COMMENTAIRES.
 *
 * Les interdits ci-dessous portent sur ce que le produit FAIT et sur ce
 * qu'il MONTRE. Or les commentaires de ces fichiers citent justement
 * les phrases interdites pour expliquer pourquoi elles le sont — « NE
 * PAS envoyer automatiquement », « jamais “votre client a lu le
 * devis” ». Sans ce nettoyage, expliquer une règle la ferait échouer,
 * et la seule façon de faire passer le test serait d'effacer
 * l'explication.
 */
function sansCommentaires(texte: string): string {
  return texte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PANNEAU = sansCommentaires(source("./PartageDevis.tsx"));
const PANNEAU_BRUT = source("./PartageDevis.tsx");
const ACTIONS = sansCommentaires(source("./actions.ts"));
const COPIE = source("./LienCopiable.tsx");

// ------------------------------------------------------------------
// 1. L'ÉCHÉANCE
// ------------------------------------------------------------------

test("la date du DEVIS l'emporte quand elle est plus proche", () => {
  // Le paysagiste a raccourci la validité après avoir partagé : la
  // porte se ferme ce jour-là, et le panneau doit le dire.
  const { date, source: origine } = echeanceReelle(
    "2026-12-01T00:00:00Z",
    "2026-09-30",
  );
  assert.equal(origine, "devis");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8); // septembre
  assert.equal(date.getDate(), 30);
});

test("un devis reste valable TOUTE la journée de sa date de validité", () => {
  // « Valable jusqu'au 30 » veut dire jusqu'au 30 au soir, pas le 29 à
  // minuit. Un client qui ouvre son devis le 30 à 18 h doit le voir.
  const { date } = echeanceReelle("2026-12-01T00:00:00Z", "2026-09-30");
  assert.equal(date.getHours(), 23);
});

test("sans date de validité, c'est le PLAFOND du lien qui s'affiche", () => {
  const { date, source: origine } = echeanceReelle("2026-10-06T00:00:00Z", null);
  assert.equal(origine, "plafond");
  assert.equal(date.toISOString(), "2026-10-06T00:00:00.000Z");
});

test("quand le lien est le plus court des deux, c'est lui qui fait foi", () => {
  // Le devis court jusqu'en décembre mais le lien a été plafonné : on
  // n'annonce pas décembre.
  const { source: origine } = echeanceReelle("2026-10-06T00:00:00Z", "2026-12-31");
  assert.equal(origine, "plafond");
});

// ------------------------------------------------------------------
// 2. LE VOCABULAIRE — L'ASSERTION QUI COMPTE VRAIMENT
// ------------------------------------------------------------------

test("LE PANNEAU NE DIT JAMAIS QUE LE CLIENT A LU LE DEVIS", () => {
  // `document_share_openings` compte des OUVERTURES. Un lien envoyé par
  // courriel est ouvert par les analyseurs de sécurité et les
  // pré-chargeurs À LA LIVRAISON, avant que le client n'ait rien vu, et
  // la table ne porte que (lien, date) : rien ne les distingue.
  //
  // 0088 interdit déjà à l'IA de prétendre qu'un accusé de lecture
  // existe. Ce panneau ne doit pas dire mieux qu'elle.
  for (const interdit of [/a lu/i, /a consulté le devis/i, /a bien reçu/i, /a vu votre devis/i]) {
    assert.doesNotMatch(
      PANNEAU,
      interdit,
      `Le panneau conclut là où il ne peut que constater : ${interdit}`,
    );
  }
  // Et il dit explicitement la limite au paysagiste, À L'ÉCRAN —
  // pas seulement dans un commentaire que le paysagiste ne lira jamais.
  assert.match(PANNEAU, /Une ouverture n&apos;est pas une lecture/);
  // Le fichier explique aussi la règle à qui le modifiera un jour.
  assert.match(PANNEAU_BRUT, /analyseurs de/i);
});

test("le panneau parle d'OUVERTURES, et il les date", () => {
  assert.match(PANNEAU, /Ouvert \{/);
  assert.match(PANNEAU, /la première le/);
});

// ------------------------------------------------------------------
// 3. CE QUE LE PARTAGE NE FAIT PAS
// ------------------------------------------------------------------

test("créer un lien n'envoie aucun courriel", () => {
  // « NE PAS envoyer automatiquement » reste la règle : le paysagiste
  // copie l'adresse et la colle où il veut.
  for (const envoi of [/declencher/i, /email_enqueue/i, /envoyer/i, /sendMail/i]) {
    assert.doesNotMatch(ACTIONS, envoi, `Le partage ne doit rien expédier : ${envoi}`);
  }
});

test("l'organisation vient du serveur, jamais du formulaire", () => {
  // Un champ caché nommant l'organisation serait la chose évidente à
  // écrire et la chose évidente à trafiquer.
  assert.match(ACTIONS, /requireOrganization\(\)/);
  assert.doesNotMatch(ACTIONS, /"organization_id"/);
});

test("le message de refus de la BASE est montré tel quel", () => {
  // « Ce devis a expiré le … : prolongez sa validité avant de le
  // partager. » Le remplacer par « une erreur est survenue »
  // supprimerait la seule phrase qui dit quoi faire.
  assert.match(ACTIONS, /flash\("error", error\.message\)/);
});

test("LE JETON ENTIER N'EST JAMAIS AFFICHÉ À L'ÉCRAN", () => {
  // Un devis se relit souvent à deux devant un écran. Le bouton copie
  // l'adresse entière ; l'écran n'en montre qu'un aperçu.
  assert.match(COPIE, /jeton\.slice\(0, 6\)/);
  assert.match(COPIE, /jeton\.slice\(-4\)/);
});

test("l'adresse du lien se fabrique depuis l'origine du NAVIGATEUR", () => {
  // Une variable d'environnement mal réglée donnerait un lien qui ne
  // s'ouvre pas, et personne ne s'en apercevrait avant que le client ne
  // réponde « votre lien ne marche pas ».
  assert.match(COPIE, /window\.location\.origin/);
  assert.doesNotMatch(COPIE, /process\.env/);
});

test("un presse-papiers refusé laisse quand même le paysagiste copier", () => {
  // Navigateur ancien, page sans HTTPS, réglage d'entreprise : un
  // bouton qui ne fait rien et ne dit rien est pire qu'un bouton
  // absent.
  assert.match(COPIE, /catch \{/);
  assert.match(COPIE, /window\.prompt/);
});
