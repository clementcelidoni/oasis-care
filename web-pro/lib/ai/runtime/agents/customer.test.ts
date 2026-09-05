import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENT_CLIENTS, MOTS_CLES_CLIENTS } from "./customer.ts";
import { DEFINITIONS, AGENTS_CONSTRUITS } from "./index.ts";
import { registreOutils } from "../tools.ts";
import { OUTIL_CUSTOMER_VALUE } from "../outils/customer.ts";

/**
 * CE QUE LA DÉFINITION DE L'AGENT CLIENTS DOIT TENIR.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX MISSIONS SUR QUATRE N'ONT RIEN, ET ELLES N'ONT PAS RIEN DE LA
 * MÊME MANIÈRE
 * ══════════════════════════════════════════════════════════════════
 *
 * La spec donne quatre missions à cet agent : l'historique, la valeur,
 * la satisfaction, le risque de départ.
 *
 *   • L'HISTORIQUE tient : `ai_get_client_context` existe, est déjà
 *     transverse, et rend une réponse vraie sur la production.
 *   • LA VALEUR tient depuis ce chantier : `ai_customer_value`.
 *   • LA SATISFACTION est une ABSENCE DE SCHÉMA. Aucune table, aucune
 *     colonne, dans tout le schéma public — vérifié par balayage
 *     d'`information_schema`, pas supposé.
 *   • LE RISQUE DE DÉPART est INCALCULABLE, ce qui n'est pas la même
 *     chose : les tables existent, elles sont simplement muettes sur ce
 *     qu'il faudrait — pas de récurrence, `converted_at` non renseigné,
 *     aucun outil qui balaie le portefeuille.
 *
 * La distinction n'est pas un raffinement de vocabulaire. « la
 * fonctionnalité n'existe pas » envoie un dirigeant vers une décision
 * produit ; « je n'ai pas assez de données » l'envoie saisir des données
 * qui n'ont nulle part où aller. Les tests ci-dessous exigent que
 * l'agent dise la première pour la satisfaction et la seconde, motifs à
 * l'appui, pour le départ.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET LE FAIT QUI DOMINE : UN CLIENT, UNE SEMAINE D'HISTORIQUE
 * ══════════════════════════════════════════════════════════════════
 *
 * Sur n = 1, « votre meilleur client », « la concentration de votre
 * portefeuille » et « votre client moyen » sont arithmétiquement exacts
 * et ne décrivent rien. C'est la façade la plus difficile à repérer :
 * elle ne dit rien de faux.
 */

const limites = AGENT_CLIENTS.limites.join("\n").toLowerCase();
const mission = AGENT_CLIENTS.mission.toLowerCase();

// ==================================================================
// 1. LES DEUX MISSIONS ABSENTES SONT DITES, ET DITES DIFFÉREMMENT
// ==================================================================

test("les deux moitiés manquantes sont refusées dès la MISSION", () => {
  // La mission est le seul champ lu AVANT la question : l'écran des
  // réglages l'affiche, et la Direction s'en sert pour décider de
  // déléguer. Une limite arrive après — elle empêche une mauvaise
  // réponse, pas une délégation payée pour rien.
  assert.match(mission, /satisfaction/, "la mission ne dit plus que la satisfaction est hors de portée");
  assert.match(mission, /départ|d[eé]part/, "la mission ne dit plus que le risque de départ est hors de portée");
  assert.ok(
    mission.includes("ne les mesure pas") || mission.includes("ne mesure pas"),
    "la mission NOMME les deux sujets sans dire qu'ils sont impossibles : nommer n'est pas refuser, " +
      "et un sujet nommé dans une mission se lit comme un sujet couvert",
  );
});

test("la satisfaction est refusée comme ABSENTE DU PRODUIT, pas comme insuffisamment remplie", () => {
  // Balayage fait : aucune table satisfaction / nps / avis / enquête /
  // réclamation / ticket, et aucune colonne non plus sur aucune table.
  // Ce n'est pas un tableau vide, c'est une fonctionnalité qui n'a jamais
  // été écrite.
  assert.match(limites, /satisfaction/, "la satisfaction n'est plus refusée dans les limites");
  assert.ok(
    limites.includes("n'existe pas"),
    "la satisfaction est présentée comme manquante plutôt qu'inexistante : " +
      "« vide » enverrait le dirigeant chercher un écran de saisie qui n'existe pas",
  );
  assert.ok(
    limites.includes("aucune table") && limites.includes("aucune colonne"),
    "le refus n'est plus adossé à la mesure qui le fonde",
  );
});

test("une intervention signée n'est PAS un contentement, et la conversion est refusée nommément", () => {
  // C'est le seul signal du produit qui RESSEMBLE à de la satisfaction :
  // deux des trois interventions de la production portent `signed_at` et
  // `signed_by_name`. Un modèle à qui l'on demande « est-il content »
  // trouvera cette colonne et la prendra — elle est la seule trace d'un
  // contact avec le client.
  //
  // Une signature de bon d'intervention atteste que le travail a été
  // CONSTATÉ. Un client mécontent signe aussi.
  assert.ok(
    limites.includes("signé") || limites.includes("signee") || limites.includes("signée"),
    "rien n'interdit plus de lire une intervention signée comme une satisfaction",
  );
  assert.ok(
    limites.includes("accusé de réalisation") || limites.includes("accuse de realisation"),
    "la nature exacte d'une signature n'est plus nommée : c'est la conversion la plus tentante du lot",
  );
});

test("le risque de départ est refusé avec ses trois motifs, pas d'un mot", () => {
  // Refuser sans motif se contourne en reformulant. Les trois manques
  // sont cumulatifs et mesurés : aucune récurrence dans le modèle (pas de
  // contrat d'entretien, pas d'abonnement client), `converted_at` non
  // renseigné donc aucune ancienneté fiable, et aucun outil qui balaie le
  // portefeuille par récence.
  const motifs: readonly [string, RegExp][] = [
    ["l'absence de récurrence", /récurrent|recurrent|contrat|abonnement/],
    ["l'ancienneté inconnue", /anciennet/],
    ["l'absence de balayage du portefeuille", /portefeuille/],
  ];
  for (const [quoi, motif] of motifs) {
    assert.match(limites, motif, `${quoi} n'est plus donnée comme raison du refus de scorer le départ`);
  }
  assert.ok(
    limites.includes("score") || limites.includes("estimer"),
    "le refus de produire un score n'est plus explicite",
  );
});

// ==================================================================
// 2. UN CLIENT, UNE SEMAINE : AUCUNE PHRASE DE POPULATION
// ==================================================================

test("aucune phrase de portefeuille : sur un client, un classement est une ligne", () => {
  // La façade la plus difficile à repérer, parce qu'elle ne dit rien de
  // faux. « Votre meilleur client représente 100 % de votre chiffre
  // d'affaires » est exact, et c'est une phrase vide.
  //
  // Et le manque est d'abord un manque d'OUTIL, pas de données :
  // `getClientContext` et `getCustomerValue` prennent un identifiant et
  // un seul. Aucun ne parcourt la base. Le jour où il y aura cent
  // clients, la limite restera vraie tant que l'outil n'existe pas.
  assert.match(limites, /portefeuille/, "la limite de portefeuille a disparu");
  assert.ok(
    limites.includes("un client à la fois") || limites.includes("un client a la fois"),
    "l'agent ne se limite plus explicitement à un client",
  );
  assert.ok(
    limites.includes("classement") || limites.includes("meilleurs clients"),
    "le classement, qui est la demande la plus naturelle, n'est plus refusé par son nom",
  );
});

test("aucun jugement de « bon payeur » : les faits, puis l'arrêt", () => {
  // `payments` compte zéro ligne et la plus ancienne facture a une
  // semaine. Un verdict de comportement de paiement sur cet historique
  // serait une opinion présentée comme une mesure — et une opinion sur
  // laquelle un dirigeant refuserait un chantier.
  assert.ok(
    limites.includes("bon payeur"),
    "le jugement de solvabilité n'est plus refusé par son nom",
  );
});

// ==================================================================
// 3. LES TROIS ÉTATS QU'ON CONFOND, ET LE PIÈGE DES DROITS CROISÉS
// ==================================================================

test("les trois états sont distingués : pas le droit, rien de saisi, zéro euro", () => {
  // C'est la confusion que ce produit a corrigée quatre fois, et elle
  // prend ici sa forme la plus coûteuse : « ce client ne rapporte rien »
  // au lieu de « je n'ai pas le droit de voir ses factures ».
  assert.ok(
    limites.includes("droit manquant") || limites.includes("droitsmanquants"),
    "les limites ne distinguent plus le bloc refusé par manque de droit",
  );
  assert.ok(
    limites.includes("rien n'a jamais été saisi") || limites.includes("jamais été saisi"),
    "les limites ne distinguent plus « rien de saisi » de « zéro »",
  );
  assert.ok(
    limites.includes("0 €") || limites.includes("zéro"),
    "le zéro, qui est la troisième réponse et la seule qui soit un chiffre, n'est plus nommé",
  );
  // La responsabilité porte la même distinction, pour que l'agent la
  // tienne comme une manière d'être et pas seulement comme un interdit.
  assert.match(
    AGENT_CLIENTS.responsabilites.toLowerCase(),
    /trois états|trois etats/,
    "la distinction des trois états a quitté les responsabilités : " +
      "un interdit sans devoir positif se contourne poliment",
  );
});

test("les droits attendus couvrent les tables croisées, pas seulement celle du client", () => {
  // LE PIÈGE TROUVÉ PENDANT CE CHANTIER, et il n'était pas dans le
  // sondage. Les tables que cet agent traverse ne sont pas sous le même
  // droit : `crm_customers` sous clients.read, `quotes` sous quotes.read,
  // `invoices` / `payments` sous invoice.create, `projects` sous
  // projects.read.
  //
  // `droitsAttendus` alimente l'écran, qui affiche « droit manquant —
  // réponse amputée ». Il doit donc nommer ce qui AMPUTE, pas seulement
  // ce qui fait échouer. On y trouve clients.read (le garde qui lève) et
  // projects.read (le socle de l'opérationnel IA) ; quotes.read et
  // invoice.create restent hors de la liste parce qu'ils n'empêchent pas
  // l'agent de répondre — la fonction rend le bloc à null et le NOMME
  // elle-même dans `droitsManquants`, ce qui est plus précis qu'un
  // avertissement d'écran.
  assert.deepEqual(
    [...AGENT_CLIENTS.droitsAttendus].toSorted(),
    ["clients.read", "projects.read"],
    "les droits attendus des Clients ont changé : relire pg_policies avant de trancher",
  );
  assert.equal(
    OUTIL_CUSTOMER_VALUE.permission,
    "clients.read",
    "la permission déclarée de l'outil n'est plus celle qui fait ÉCHOUER l'appel : " +
      "déclarer invoice.create retirerait l'outil à un chargé de clientèle qui a le droit de lire la fiche",
  );
});

test("l'argent reçu et l'argent lettré restent deux choses", () => {
  // Un acompte encaissé avant toute facture n'est rattaché à rien. Les
  // confondre fait dire « il n'a pas payé » d'un client qui a versé 250 €.
  assert.ok(
    limites.includes("lettré") || limites.includes("lettre"),
    "l'écart entre l'encaissé et le lettré n'est plus nommé",
  );
});

test("« aucune activité enregistrée » n'est pas « on ne l'a pas contacté »", () => {
  // `crm_activities` compte zéro ligne : c'est un défaut de SAISIE, pas
  // un fait commercial. Les confondre envoie relancer quelqu'un qu'on a
  // peut-être vu la veille — le genre d'erreur qui coûte un client.
  assert.ok(
    limites.includes("activité") || limites.includes("activite"),
    "la limite sur le journal d'activités vide a disparu",
  );
  assert.ok(
    limites.includes("saisie"),
    "le journal vide n'est plus présenté comme un défaut de saisie",
  );
});

// ==================================================================
// 4. LECTURE SEULE — Y COMPRIS CONTRE DEUX FONCTIONS QUI EXISTENT
// ==================================================================

test("c'est une mission de lecture, et son seul outil est une lecture", () => {
  // `ai_create_customer` et `ai_log_activity` EXISTENT en base. Elles ne
  // sont déclarées nulle part dans `tools.ts`, et il ne faut pas les
  // donner à cet agent : consigner une activité au nom du dirigeant, dans
  // un journal qui sert ensuite à décider d'une relance, c'est écrire une
  // trace commerciale que personne n'a relue.
  assert.equal(
    OUTIL_CUSTOMER_VALUE.famille,
    "lecture",
    "l'outil des Clients n'est plus une lecture : l'agent gagnerait un chemin d'écriture",
  );
  assert.match(limites, /n'écrit rien/, "la première limite ne dit plus que l'agent n'écrit rien");
  for (const geste of ["ne crée pas de client", "n'envoie aucune relance", "ne consigne aucune activité"]) {
    assert.ok(
      limites.includes(geste),
      `« ${geste} » n'est plus refusé nommément : un interdit générique se contourne par un cas particulier`,
    );
  }
});

test("les deux fonctions d'écriture que la base offre restent hors du catalogue", () => {
  // Elles existent, elles sont tentantes, et rien d'autre que ce test ne
  // signale qu'on a décidé de ne pas les prendre.
  const registre = registreOutils();
  for (const outil of registre.tous()) {
    assert.ok(
      outil.rpc !== "ai_create_customer" && outil.rpc !== "ai_log_activity",
      `« ${outil.nom} » déclare ${outil.rpc} : l'agent Clients écrirait dans le CRM, ` +
        "et la mission « Clients » a été décidée en lecture seule",
    );
  }
});

// ==================================================================
// 5. LE MOT QUI L'ATTEINDRA
// ==================================================================

test("le mot proposé n'est revendiqué par aucun des neuf autres agents", () => {
  // Vérifié maintenant plutôt qu'à la fusion, sur la liste exportée que
  // l'intégration recopiera telle quelle. La comparaison est
  // ASYMÉTRIQUE : l'aiguillage cherche une sous-chaîne, donc un mot
  // contenu dans celui d'un autre est un conflit qu'aucune égalité ne
  // révélerait.
  for (const cle of AGENTS_CONSTRUITS) {
    if (cle === "customer") continue;
    for (const autre of DEFINITIONS[cle].motsCles ?? []) {
      for (const mien of MOTS_CLES_CLIENTS) {
        const a = normaliser(autre);
        const b = normaliser(mien);
        assert.ok(
          !a.includes(b) && !b.includes(a),
          `« ${mien} » (Clients) et « ${autre} » (${cle}) se recouvrent`,
        );
      }
    }
  }
});

test("la liste ne contient aucune entrée morte : une sous-chaîne d'un mot déjà pris n'en est pas une", () => {
  // Le sondage proposait quatre mots dont trois CONTENAIENT le premier.
  // Avec un aiguillage par sous-chaîne, « fiche client » ne peut jamais
  // se déclencher sans que « client » l'ait déjà fait. Une liste dont
  // trois entrées sur quatre sont mortes se recopie ensuite ailleurs
  // comme si elle décrivait une couverture.
  const mots = [...MOTS_CLES_CLIENTS].map(normaliser);
  for (const mot of mots) {
    const couvert = mots.filter((autre) => autre !== mot && mot.includes(autre));
    assert.deepEqual(
      couvert,
      [],
      `« ${mot} » contient déjà « ${couvert[0]} » : il ne se déclenchera jamais seul`,
    );
  }
});

test("« relance » et « impayé » restent à leurs propriétaires", () => {
  // La relance de paiement est à la Facturation, la relance de devis au
  // Chiffrage — le mot nu n'appartient à personne. « impayé » est
  // revendiqué par la Facturation sous « impay », et elle a raison : un
  // impayé est une question d'encaissement avant d'être une question de
  // relation.
  for (const interdit of ["relance", "impayé", "impaye", "portefeuille"]) {
    for (const mien of MOTS_CLES_CLIENTS) {
      assert.notEqual(
        normaliser(mien),
        normaliser(interdit),
        `« ${interdit} » est revenu dans les mots des Clients : relire la raison de son exclusion`,
      );
    }
  }
});

// ==================================================================
// 6. LE COUPLAGE GABARIT / MOTS / SOURCE
// ==================================================================

test("tant que son outil n'est pas au catalogue, il reste gabarit et muet", () => {
  // TEST FAIT POUR CHANGER DE CAMP. Voir le même dans `fleet.test.ts` :
  // il réclame le geste manquant tout seul, dans un sens comme dans
  // l'autre, et personne n'a besoin de s'en souvenir.
  //
  // Nuance propre aux Clients : cet agent a DÉJÀ des sources transverses
  // (`getClientContext`, `searchEntities`, `getProjectContext`), donc il
  // ne serait pas tout à fait muet si on l'allumait aujourd'hui. Il
  // resterait pourtant incomplet sur un tiers de sa mission — la valeur —
  // et c'est la moitié qui fait poser la question.
  const registre = registreOutils();
  const auCatalogue = registre.chercher(OUTIL_CUSTOMER_VALUE.nom) !== null;

  if (!auCatalogue) {
    assert.equal(
      AGENT_CLIENTS.aCompleter,
      true,
      "l'agent Clients se dit achevé alors que getCustomerValue n'est pas au catalogue : " +
        "il additionnerait les impayés pour répondre « combien ce client m'a rapporté »",
    );
    assert.equal(
      AGENT_CLIENTS.motsCles ?? undefined,
      undefined,
      "l'agent Clients attrape des questions libres avant d'avoir son outil de valeur",
    );
    return;
  }

  assert.notEqual(
    AGENT_CLIENTS.aCompleter,
    true,
    "getCustomerValue est au catalogue mais l'agent se dit encore gabarit : " +
      "l'écran des réglages affichera « en construction » sur un agent prêt",
  );
  assert.deepEqual(
    [...(AGENT_CLIENTS.motsCles ?? [])],
    [...MOTS_CLES_CLIENTS],
    "l'outil est branché mais aucune question libre n'atteint l'agent : " +
      "écrire « motsCles: MOTS_CLES_CLIENTS » sur la définition",
  );
});

// ==================================================================
// 7. LA FORME D'UNE LIMITE
// ==================================================================

test("aucune limite ne contient un chiffre : une limite est une règle, pas une mesure", () => {
  // Une limite est relue une fois par an, une mesure vieillit en une
  // semaine — et cette base a précisément une semaine. « la base compte
  // un client » écrit dans une limite deviendra faux au deuxième client,
  // et personne ne relit les limites pour cela. Les mesures vont dans
  // l'en-tête, que le commit date, et dans les tests, qui échouent.
  for (const limite of AGENT_CLIENTS.limites) {
    assert.ok(
      !/\d/.test(limite),
      `une limite des Clients porte un chiffre et vieillira sans prévenir : « ${limite} »`,
    );
  }
});

/** La normalisation d'`aiguillage.ts`, recopiée pour ne pas importer une route dans un test de définition. */
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "");
}
