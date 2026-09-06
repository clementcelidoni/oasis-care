import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyserReponseVies,
  consulterVies,
  decouperNumeroTva,
  enveloppeCheckVat,
  type ReponseHttpVies,
  type RequeteHttpVies,
  type TransportVies,
} from "./vies.ts";

/**
 * AUCUN APPEL RÉSEAU N'EST FAIT PAR CE FICHIER, ET C'EST UNE EXIGENCE,
 * PAS UNE COMMODITÉ.
 *
 * VIES tombe — c'est le sujet même du code testé. Un test qui
 * l'interrogerait vraiment échouerait précisément les jours où l'on a
 * le plus besoin de savoir que le code tient. Le transport est donc
 * toujours un double, et les réponses sont de vraies formes de réponse :
 * celle du guichet SOAP historique, celle de son interface REST, et
 * surtout celles qu'aucune documentation ne décrit — la page HTML
 * d'erreur, le XML coupé en deux, le corps vide.
 */

// ------------------------------------------------------------------
// Des réponses telles que le guichet en rend
// ------------------------------------------------------------------

function soapValide(pays = "BE", numero = "0123456789", identifiant?: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    "<checkVatResponse>" +
    `<countryCode>${pays}</countryCode><vatNumber>${numero}</vatNumber>` +
    "<requestDate>2026-09-06+02:00</requestDate><valid>true</valid>" +
    "<name>UNE SOCIETE</name><address>UNE RUE</address>" +
    (identifiant === undefined ? "" : `<requestIdentifier>${identifiant}</requestIdentifier>`) +
    "</checkVatResponse></soap:Body></soap:Envelope>"
  );
}

function soapInvalide(pays = "BE", numero = "0000000000"): string {
  return (
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    "<checkVatResponse>" +
    `<countryCode>${pays}</countryCode><vatNumber>${numero}</vatNumber>` +
    "<valid>false</valid><name>---</name><address>---</address>" +
    "</checkVatResponse></soap:Body></soap:Envelope>"
  );
}

function soapFaute(code: string): string {
  return (
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<soap:Fault><faultcode>soap:Server</faultcode><faultstring>${code}</faultstring></soap:Fault>` +
    "</soap:Body></soap:Envelope>"
  );
}

// ==================================================================
// 1. DÉCOUPER LE NUMÉRO
// ==================================================================

test("le numéro se découpe en pays et corps, espaces et points compris", () => {
  assert.deepEqual(decouperNumeroTva("BE 0123.456.789"), { pays: "BE", corps: "0123456789" });
  assert.deepEqual(decouperNumeroTva("be0123456789"), { pays: "BE", corps: "0123456789" });
});

test("le préfixe grec « EL » est pris tel quel, sans table de correspondance", () => {
  // `identite.ts` impose déjà EL pour une entreprise dont le pays est
  // GR. Une seconde correspondance ici serait une seconde vérité.
  assert.deepEqual(decouperNumeroTva("EL123456789"), { pays: "EL", corps: "123456789" });
});

test("un numéro qui n'a pas la forme attendue est refusé avant toute requête", () => {
  assert.equal(decouperNumeroTva(""), null);
  assert.equal(decouperNumeroTva(null), null);
  assert.equal(decouperNumeroTva("12345678"), null); // pas de préfixe pays
  assert.equal(decouperNumeroTva("BE1"), null); // trop court
  assert.equal(decouperNumeroTva("BE01234567890123456"), null); // trop long
});

test("rien de ce qui entre dans l'enveloppe ne peut refermer une balise", () => {
  // DEUX BARRIÈRES, ET LA PREMIÈRE SUFFIT DÉJÀ. Une tentative
  // d'injection un peu longue ne passe même pas le contrôle de forme :
  // elle rend `null`, et aucune requête n'est fabriquée.
  assert.equal(decouperNumeroTva('BE<0123/><script>alert("x")</script>'), null);

  // Et une tentative assez courte pour franchir la longueur ressort
  // vidée de tout ce qui n'est pas lettre ou chiffre : l'enveloppe est
  // sûre par construction, pas par échappement.
  const decoupe = decouperNumeroTva("BE<b>012</b>");
  assert.deepEqual(decoupe, { pays: "BE", corps: "B012B" });
  const xml = enveloppeCheckVat(decoupe!);
  assert.equal(xml.includes("<b>"), false);
  assert.equal(xml.includes("</b>"), false);
});

test("l'enveloppe demande la preuve quand on s'identifie, et pas autrement", () => {
  const cible = decouperNumeroTva("BE0123456789")!;

  const anonyme = enveloppeCheckVat(cible, null);
  assert.equal(anonyme.includes("checkVatApprox"), false);
  assert.equal(anonyme.includes("<urn:countryCode>BE</urn:countryCode>"), true);
  assert.equal(anonyme.includes("<urn:vatNumber>0123456789</urn:vatNumber>"), true);

  const identifie = enveloppeCheckVat(cible, decouperNumeroTva("FR44732829320"));
  assert.equal(identifie.includes("checkVatApprox"), true);
  assert.equal(identifie.includes("<urn:requesterCountryCode>FR</urn:requesterCountryCode>"), true);
});

// ==================================================================
// 2. LES TROIS ÉTATS — SOAP
// ==================================================================

test("valid=true rend « valide », et le numéro de consultation est la preuve", () => {
  const sansPreuve = analyserReponseVies(soapValide(), 200);
  assert.equal(sansPreuve.etat, "valide");
  assert.equal(sansPreuve.numeroConsultation, null);

  const avecPreuve = analyserReponseVies(soapValide("BE", "0123456789", "WAPIAAAAX123"), 200);
  assert.equal(avecPreuve.etat, "valide");
  assert.equal(avecPreuve.numeroConsultation, "WAPIAAAAX123");
});

test("valid=false rend « refuse » : c'est une réponse, pas une panne", () => {
  const resultat = analyserReponseVies(soapInvalide(), 200);
  assert.equal(resultat.etat, "refuse");
});

test("les préfixes de namespace ne changent rien à la lecture", () => {
  const avecPrefixes =
    '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>' +
    '<ns2:checkVatResponse xmlns:ns2="urn:ec.europa.eu:taxud:vies:services:checkVat:types">' +
    "<ns2:countryCode>DE</ns2:countryCode><ns2:vatNumber>123456789</ns2:vatNumber>" +
    "<ns2:valid>true</ns2:valid>" +
    "</ns2:checkVatResponse></S:Body></S:Envelope>";
  assert.equal(analyserReponseVies(avecPrefixes, 200).etat, "valide");
});

test("les pannes du registre national rendent « indisponible », jamais « refuse »", () => {
  for (const code of [
    "MS_UNAVAILABLE",
    "SERVICE_UNAVAILABLE",
    "TIMEOUT",
    "SERVER_BUSY",
    "MS_MAX_CONCURRENT_REQ",
    "GLOBAL_MAX_CONCURRENT_REQ",
    "MS_UNAVAILABLE_DUE_TO_MAINTENANCE",
  ]) {
    const resultat = analyserReponseVies(soapFaute(code), 200);
    assert.equal(resultat.etat, "indisponible", `${code} devrait être une panne`);
    assert.equal(resultat.message?.includes(code), true);
  }
});

test("INVALID_INPUT est le seul code qui vaut refus", () => {
  assert.equal(analyserReponseVies(soapFaute("INVALID_INPUT"), 200).etat, "refuse");
});

test("notre propre identification refusée est une panne de NOTRE côté, pas un refus du client", () => {
  // INVALID_REQUESTER_INFO n'apprend rien sur le numéro interrogé : le
  // traiter comme un refus radierait des clients pour une erreur de
  // configuration qui n'est pas la leur.
  assert.equal(analyserReponseVies(soapFaute("INVALID_REQUESTER_INFO"), 200).etat, "indisponible");
});

test("un code de panne jamais vu est une panne, pas un refus", () => {
  // La Commission en ajoute au fil des versions. Deviner qu'un code
  // inconnu veut dire « non » est exactement l'erreur qui coûte des
  // clients, et elle ne se verrait nulle part.
  assert.equal(analyserReponseVies(soapFaute("CODE_INEDIT_DE_2027"), 200).etat, "indisponible");
});

// ==================================================================
// 3. LES TROIS ÉTATS — REST (JSON)
// ==================================================================

test("l'interface REST se lit aussi, dans ses deux orthographes", () => {
  const avecValid = analyserReponseVies(
    '{"countryCode":"BE","vatNumber":"0123456789","valid":true,"requestIdentifier":"ABC123"}',
    200,
  );
  assert.equal(avecValid.etat, "valide");
  assert.equal(avecValid.numeroConsultation, "ABC123");

  const avecIsValid = analyserReponseVies('{"isValid":true}', 200);
  assert.equal(avecIsValid.etat, "valide");

  assert.equal(analyserReponseVies('{"valid":false}', 200).etat, "refuse");
});

test("REST : userError distingue le refus de la panne", () => {
  assert.equal(analyserReponseVies('{"userError":"INVALID","valid":false}', 200).etat, "refuse");
  assert.equal(analyserReponseVies('{"userError":"MS_UNAVAILABLE"}', 200).etat, "indisponible");
  // « VALID » dans ce champ n'est pas une erreur : c'est le verdict.
  assert.equal(analyserReponseVies('{"userError":"VALID","valid":true}', 200).etat, "valide");
});

test("REST : un errorWrapper est lu comme une faute SOAP", () => {
  const resultat = analyserReponseVies(
    '{"actionSucceed":false,"errorWrappers":[{"error":"MS_UNAVAILABLE","message":"registre absent"}]}',
    200,
  );
  assert.equal(resultat.etat, "indisponible");
});

// ==================================================================
// 4. LA RÉPONSE MALFORMÉE — LE CAS QUI FAIT TOMBER LES ANALYSEURS
// ==================================================================

test("une réponse malformée n'est jamais un refus, et ne fait jamais planter", () => {
  const monstres: (string | null | undefined)[] = [
    "", // corps vide
    "   ", // que du blanc
    null,
    undefined,
    "<!DOCTYPE html><html><body><h1>503 Service Unavailable</h1></body></html>",
    "<soap:Envelope><soap:Body><checkVatResponse><valid>tr", // coupé en plein milieu
    '{"valid":tr', // JSON coupé
    "{}", // JSON sans verdict
    '{"valid":"peut-être"}', // verdict qui n'est pas un booléen
    "<checkVatResponse><valid>oui</valid></checkVatResponse>", // verdict dans une autre langue
    " binaire",
    "<".repeat(5000), // du XML pathologique
  ];

  for (const monstre of monstres) {
    const resultat = analyserReponseVies(monstre, 200);
    assert.equal(
      resultat.etat,
      "indisponible",
      `« ${String(monstre).slice(0, 30)} » ne doit être ni valide ni refusé`,
    );
    assert.notEqual(resultat.message, null);
  }
});

test("une réponse illisible se raconte sans recracher toute la page", () => {
  const enorme = `<html>${"x".repeat(10_000)}</html>`;
  const resultat = analyserReponseVies(enorme, 200);
  assert.equal(resultat.etat, "indisponible");
  // Le message part en base (`vies_last_error`, tronqué à 500) et sur un
  // écran d'administration : dix mille caractères y seraient illisibles.
  assert.equal((resultat.message ?? "").length < 400, true);
});

test("un code HTTP de panne suffit : on ne cherche pas de verdict dans une réponse d'erreur", () => {
  for (const statut of [0, 429, 500, 502, 503, 504]) {
    // Même si le corps ressemble à une validation : un 503 n'est pas une
    // réponse du registre, c'est le guichet qui n'a pas travaillé.
    const resultat = analyserReponseVies(soapValide(), statut);
    assert.equal(resultat.etat, "indisponible", `HTTP ${statut}`);
  }
});

test("une réponse qui parle d'un autre numéro est écartée plutôt que crue", () => {
  const attendu = decouperNumeroTva("BE0123456789")!;

  // Le pays ne correspond pas.
  const autrePays = analyserReponseVies(soapValide("DE", "0123456789"), 200, attendu);
  assert.equal(autrePays.etat, "indisponible");

  // Le numéro ne correspond pas : enregistrer « validé » attacherait la
  // preuve d'un numéro à un autre — le trou même que
  // `vat_number_checked` referme en base.
  const autreNumero = analyserReponseVies(soapValide("BE", "9999999999"), 200, attendu);
  assert.equal(autreNumero.etat, "indisponible");

  // Et la réponse conforme passe.
  assert.equal(analyserReponseVies(soapValide("BE", "0123456789"), 200, attendu).etat, "valide");
});

// ==================================================================
// 5. LA CONSULTATION — TRANSPORT SIMULÉ
// ==================================================================

function transportQuiRend(reponse: ReponseHttpVies, journal?: RequeteHttpVies[]): TransportVies {
  return async (requete) => {
    journal?.push(requete);
    return reponse;
  };
}

test("la consultation rend chacun des trois états", async () => {
  const valide = await consulterVies("BE0123456789", {
    transport: transportQuiRend({ statut: 200, corps: soapValide() }),
  });
  assert.equal(valide.etat, "valide");

  const refuse = await consulterVies("BE0123456789", {
    transport: transportQuiRend({ statut: 200, corps: soapInvalide("BE", "0123456789") }),
  });
  assert.equal(refuse.etat, "refuse");

  const indisponible = await consulterVies("BE0123456789", {
    transport: transportQuiRend({ statut: 200, corps: soapFaute("MS_UNAVAILABLE") }),
  });
  assert.equal(indisponible.etat, "indisponible");
});

test("la requête part avec l'enveloppe SOAP et le bon numéro", async () => {
  const journal: RequeteHttpVies[] = [];
  await consulterVies("be 0123.456.789", {
    transport: transportQuiRend({ statut: 200, corps: soapValide() }, journal),
  });
  assert.equal(journal.length, 1);
  assert.equal(journal[0].corps.includes("<urn:countryCode>BE</urn:countryCode>"), true);
  assert.equal(journal[0].corps.includes("<urn:vatNumber>0123456789</urn:vatNumber>"), true);
  assert.equal(journal[0].url.startsWith("https://ec.europa.eu/"), true);
});

test("LE DÉLAI DÉPASSÉ est une panne, et il n'attend pas la fin des temps", async () => {
  // Le double ne répond jamais : il ne se dénoue que sur l'annulation.
  // C'est exactement ce que fait un registre national qui ne répond pas
  // — et sans annulation, la tâche resterait suspendue indéfiniment.
  const transportMuet: TransportVies = ({ signal }) =>
    new Promise((_, rejeter) => {
      signal.addEventListener("abort", () => rejeter(new Error("annulé")));
    });

  const debut = Date.now();
  const resultat = await consulterVies("BE0123456789", {
    transport: transportMuet,
    delaiMs: 25,
  });
  assert.equal(resultat.etat, "indisponible");
  assert.equal(resultat.message?.includes("n'a pas répondu"), true);
  assert.equal(Date.now() - debut < 2000, true, "le délai doit couper, pas attendre");
});

test("un transport qui explose est une panne, pas un refus, et ne remonte pas l'exception", async () => {
  const transportCasse: TransportVies = async () => {
    throw new Error("getaddrinfo ENOTFOUND ec.europa.eu");
  };
  const resultat = await consulterVies("BE0123456789", { transport: transportCasse });
  assert.equal(resultat.etat, "indisponible");
  assert.equal(resultat.message?.includes("ENOTFOUND"), true);
});

test("un numéro impossible à poser est refusé sans déranger le guichet", async () => {
  let appele = false;
  const transport: TransportVies = async () => {
    appele = true;
    return { statut: 200, corps: soapValide() };
  };
  const resultat = await consulterVies("XX", { transport });
  assert.equal(resultat.etat, "refuse");
  assert.equal(appele, false, "on n'interroge pas VIES avec un numéro qu'il rejettera");
});
