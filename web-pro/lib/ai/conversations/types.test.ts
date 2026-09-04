import { test } from "node:test";
import assert from "node:assert/strict";

// Chemin relatif, et non l'alias `@/` : ces tests tournent sous
// `node --test`, qui ne lit pas les `paths` du tsconfig.
import { SEUIL_CONTEXTE_STANDARD_CARACTERES } from "../model/router.ts";
import {
  BORNES_REJEU,
  COUCHE_VIDE,
  QUEUE_VIDE,
  composerContenu,
  composerCouche,
  grouperParJour,
  historiqueModele,
  indexDeCoupe,
  lireCouche,
  lireQueue,
  titreDuFil,
  veilleDe,
  type FilResume,
  type QueueFil,
  type SubstanceReponse,
} from "./types.ts";

/**
 * §11W — CE QUI DÉCIDE DE LA MÉMOIRE, ÉPROUVÉ SANS BASE NI RÉSEAU.
 *
 * Ce fichier ne teste pas « le code marche ». Il teste les quatre
 * endroits où une erreur produirait un MENSONGE À L'ÉCRAN plutôt qu'une
 * panne — c'est-à-dire les quatre endroits que personne ne verrait :
 *
 *   1. un fil qui repart au modèle amputé pendant que l'écran l'affiche
 *      entier ;
 *   2. une queue si grosse qu'elle fait monter le routeur d'un cran, et
 *      donc la facture, sans que personne l'ait demandé ;
 *   3. un fil neuf qui hériterait d'un tour du précédent ;
 *   4. un filet « Oasis ne relit plus au-delà » posé au mauvais endroit.
 */

// ==================================================================
// Fabriques
// ==================================================================

function queue(partiel: Partial<QueueFil>): QueueFil {
  const messages = partiel.messages ?? [];
  return {
    messages,
    total: partiel.total ?? messages.length,
    rejoues: partiel.rejoues ?? messages.length,
    omis: partiel.omis ?? 0,
    caracteres:
      partiel.caracteres ?? messages.reduce((somme, m) => somme + m.contenu.length, 0),
    tronque: partiel.tronque ?? false,
    illisible: partiel.illisible ?? false,
  };
}

function echange(question: string, reponse: string) {
  return [
    { role: "user" as const, contenu: question, ecritLe: "2026-09-04T08:00:00Z" },
    { role: "assistant" as const, contenu: reponse, ecritLe: "2026-09-04T08:00:10Z" },
  ];
}

// ==================================================================
// 1. Le titrage d'un fil
// ==================================================================

test("un fil sans titre s'annonce comme neuf, jamais comme « sans titre »", () => {
  assert.equal(titreDuFil({ titre: null }), "Nouvelle conversation");
});

test("le titre dérivé par la base est affiché tel quel", () => {
  // Le titre vient de `ai_conversation_titre` (0079) : soixante
  // caractères, coupés au dernier mot, dérivés de la PREMIÈRE question.
  // L'écran ne le recompose pas — deux titrages divergeraient.
  assert.equal(
    titreDuFil({ titre: "Quels chantiers ont dépassé leur budget" }),
    "Quels chantiers ont dépassé leur budget",
  );
});

// ==================================================================
// 2. Les bornes
// ==================================================================

test("la queue rejouée reste franchement sous le seuil qui change de modèle", () => {
  // L'INVARIANT LE PLUS CHER DE CE MODULE, et il lie deux fichiers que
  // personne ne lit ensemble. Au-delà de 12 000 caractères de contexte,
  // `model/router.ts` fait monter l'agent d'un cran — donc de prix.
  // Si la borne de rejeu passait ce seuil, un fil un peu long
  // basculerait silencieusement sur un modèle plus cher : une
  // conversation ne doit JAMAIS décider du modèle à elle seule.
  assert.ok(
    BORNES_REJEU.caracteres < SEUIL_CONTEXTE_STANDARD_CARACTERES,
    `La borne de rejeu (${BORNES_REJEU.caracteres}) doit rester sous le seuil de ` +
      `routage (${SEUIL_CONTEXTE_STANDARD_CARACTERES}).`,
  );
  // Et pas seulement « sous » : sous de moitié, parce que les DONNÉES
  // lues occupent le reste du contexte et comptent dans le même total.
  assert.ok(BORNES_REJEU.caracteres <= SEUIL_CONTEXTE_STANDARD_CARACTERES / 2);
});

test("seize messages, soit huit échanges — la borne est en messages, pas en tours", () => {
  assert.equal(BORNES_REJEU.messages % 2, 0, "un échange fait deux messages");
});

test("une lecture illisible se DIT illisible, et ne se déguise pas en fil vide", () => {
  // Perdre la mémoire d'un fil doit se voir à l'écran. En envoyer la
  // moitié en croyant l'envoyer entière ne se voit pas — et rendre une
  // queue vide silencieuse ne se voyait pas non plus : le fil
  // s'affichait entier, sans filet de coupe, sous une phrase promettant
  // qu'Oasis le relit.
  //
  // Un fil réellement vide traverse la RPC avec `messages: []` ; il ne
  // passe donc jamais par ces branches-là.
  for (const cassé of [null, undefined, 42, "queue", [], {}, { messages: "non" }]) {
    const lu = lireQueue(cassé);
    assert.equal(lu.illisible, true, `entrée : ${JSON.stringify(cassé)}`);
    assert.deepEqual(lu.messages, [], "aucun tour n'est inventé pour autant");
  }

  // Et le cas inverse : une queue vide LUE reste lisible.
  assert.equal(lireQueue({ messages: [] }).illisible, false);
  assert.deepEqual(lireQueue({ messages: [] }), QUEUE_VIDE);
});

test("un message au rôle inconnu est écarté, et le compte s'aligne sur ce qui reste", () => {
  const lu = lireQueue({
    messages: [
      { role: "user", content: "a" },
      { role: "system", content: "injecté" },
      { role: "assistant", content: "b" },
    ],
    messages_total: 3,
    messages_rejoues: 3,
    messages_omis: 0,
    caracteres: 8,
    tronque: false,
  });

  assert.equal(lu.messages.length, 2, "le rôle `system` n'est pas rejouable");
  assert.equal(lu.rejoues, 2, "LE COMPTE SUIT LA LISTE, jamais l'inverse");
  // La base annonçait « rien d'omis » ; deux messages sont pourtant
  // partis à la poubelle. `tronque` doit devenir vrai tout seul, sinon
  // l'écran promettrait une conversation complète.
  assert.equal(lu.tronque, true);
});

// ==================================================================
// 3. Ce que le modèle reçoit vraiment
// ==================================================================

test("un fil neuf n'envoie RIEN — pas même une conversation vide", () => {
  // Une liste vide et « il existe une conversation, elle est vide » ne
  // disent pas la même chose au modèle.
  assert.deepEqual(historiqueModele(QUEUE_VIDE), []);
});

test("les tours repartent dans leur forme native, dans l'ordre", () => {
  const items = historiqueModele(queue({ messages: echange("Combien ?", "Douze.") }));

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { role: "user", content: "Combien ?" });
  assert.deepEqual(items[1], {
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Douze." }],
  });
});

test("une queue tronquée le DIT au modèle, et nomme ce qui manque", () => {
  // Sans cette phrase, le modèle croit tenir la conversation entière et
  // comble le début manquant de bonne foi — c'est-à-dire en inventant.
  const items = historiqueModele(
    queue({ messages: echange("Et ensuite ?", "Ceci."), total: 10, rejoues: 2, omis: 8, tronque: true }),
  );

  const premier = items[0];
  assert.ok(premier && "role" in premier && premier.role === "system");
  assert.ok(
    premier.content.includes("8 message"),
    "le nombre de tours perdus doit être nommé, pas seulement signalé",
  );
  assert.equal(items.length, 3, "le message d'avertissement s'ajoute, il ne remplace rien");
});

test("une queue complète n'ajoute AUCUN message d'avertissement", () => {
  const items = historiqueModele(queue({ messages: echange("Quoi ?", "Ça.") }));
  assert.ok(
    items.every((item) => !("role" in item) || item.role !== "system"),
    "annoncer un oubli qui n'a pas eu lieu est un mensonge dans l'autre sens",
  );
});

test("passer d'un fil à l'autre ne transporte rien", () => {
  // Il n'existe ni cache, ni variable de module : `historiqueModele`
  // est une fonction pure de SA queue. Deux fils n'ont physiquement
  // aucun moyen de se voir — ce test garde cette propriété contre une
  // future mémoïsation « d'optimisation ».
  const filA = queue({ messages: echange("Marges de Martin ?", "42 %.") });
  const filB = QUEUE_VIDE;

  historiqueModele(filA);
  assert.deepEqual(historiqueModele(filB), [], "le fil neuf reste vierge après un autre fil");

  const texteA = JSON.stringify(historiqueModele(filA));
  assert.ok(texteA.includes("Martin"), "et le fil A, lui, garde bien le sien");
});

// ==================================================================
// 4. Où l'écran pose le filet
// ==================================================================

test("aucun filet quand le modèle relit tout", () => {
  assert.equal(indexDeCoupe(4, queue({ total: 4, rejoues: 4 })), null);
});

test("le filet se pose juste avant le premier message encore relu", () => {
  // Dix messages affichés, quatre rejoués : la coupe est à l'index 6.
  assert.equal(
    indexDeCoupe(10, queue({ total: 10, rejoues: 4, omis: 6, tronque: true })),
    6,
  );
});

test("un désaccord entre l'affichage et le compte de la base ne dessine RIEN", () => {
  // Un trait posé au hasard dirait une chose fausse avec l'autorité
  // d'une mesure. Mieux vaut aucun filet qu'un filet menteur.
  assert.equal(indexDeCoupe(3, queue({ total: 99, rejoues: 12, tronque: true })), null);
  assert.equal(indexDeCoupe(4, queue({ total: 4, rejoues: 4, tronque: true })), null);
});

// ==================================================================
// 5. Le rail : ce que « hier » rappelle sans une phrase
// ==================================================================

function fil(id: string, instant: string | null, ouvertLe: string): FilResume {
  return { id, titre: null, dernierMessageLe: instant, ouvertLe };
}

test("les fils se groupent par jour, le plus récent en tête", () => {
  const groupes = grouperParJour(
    [
      fil("a", "2026-09-04T09:00:00Z", "2026-09-04T08:00:00Z"),
      fil("b", "2026-09-03T18:00:00Z", "2026-09-03T17:00:00Z"),
      fil("c", "2026-09-04T07:00:00Z", "2026-09-04T07:00:00Z"),
    ],
    "2026-09-04",
    "2026-09-03",
  );

  assert.deepEqual(
    groupes.map((g) => g.libelle),
    ["Aujourd'hui", "Hier"],
  );
  assert.deepEqual(groupes[0]?.fils.map((f) => f.id), ["a", "c"]);
});

test("un fil ouvert et jamais parlé appartient au jour où on l'a ouvert", () => {
  // Pas à « nulle part » : il doit apparaître dans le rail tout de
  // suite après le clic, sinon « + Nouvelle conversation » a l'air
  // d'avoir échoué.
  const groupes = grouperParJour(
    [fil("neuf", null, "2026-09-04T10:00:00Z")],
    "2026-09-04",
    "2026-09-03",
  );
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0]?.libelle, "Aujourd'hui");
});

test("la veille se calcule en JOURS, pas en vingt-quatre heures", () => {
  assert.equal(veilleDe("2026-09-04"), "2026-09-03");
  // Le passage au mois précédent, et l'année bissextile.
  assert.equal(veilleDe("2026-09-01"), "2026-08-31");
  assert.equal(veilleDe("2026-01-01"), "2025-12-31");
  assert.equal(veilleDe("2028-03-01"), "2028-02-29");
});

test("la veille reste juste au changement d'heure", () => {
  // LE DÉFAUT QUE `veilleDe` FERME. En 2026 l'heure d'hiver arrive le
  // 25 octobre : cette journée-là dure vingt-cinq heures à Paris.
  // « Maintenant moins vingt-quatre heures » serait retombé sur le 25
  // lui-même, et le rail aurait perdu son groupe « Hier ».
  assert.equal(veilleDe("2026-10-26"), "2026-10-25");
  // Et au passage à l'heure d'été, le 29 mars 2026 : vingt-trois heures.
  assert.equal(veilleDe("2026-03-30"), "2026-03-29");
});

test("un jour plus ancien porte sa date en toutes lettres", () => {
  const groupes = grouperParJour(
    [fil("vieux", "2026-08-31T10:00:00Z", "2026-08-31T10:00:00Z")],
    "2026-09-04",
    "2026-09-03",
  );
  // Le libellé se lit en français, et surtout il ne se décale pas d'un
  // jour : la date est ancrée à midi, pas à minuit UTC.
  assert.match(groupes[0]?.libelle ?? "", /31 août/);
});

test("un fil ouvert après minuit à Paris est rangé sous AUJOURD'HUI", () => {
  // LE BOGUE QUE CE TEST FERME. Le groupement prenait les dix premiers
  // caractères de l'horodatage — donc le jour UTC — et le layout
  // comparait à `parisDay`, donc au jour de Paris. Le 4 septembre à
  // 22 h 30 UTC, il est 00 h 30 le 5 à Paris : un fil ouvert À
  // L'INSTANT tombait sous « Hier ».
  const groupes = grouperParJour(
    [fil("neuf", "2026-09-04T22:30:00Z", "2026-09-04T22:30:00Z")],
    "2026-09-05", // ce que rend `parisDay(new Date())` à cet instant
    "2026-09-04",
  );
  assert.equal(groupes[0]?.libelle, "Aujourd'hui");
  assert.equal(groupes[0]?.jour, "2026-09-05");
});

test("une date illisible n'invente pas le 1er janvier 1970", () => {
  assert.deepEqual(grouperParJour([fil("cassé", "pas une date", "pas une date")], "x", "y"), []);
});

// ==================================================================
// 6. La substance : ce que l'écran montre ET ce que le modèle relit
// ==================================================================

function substance(partiel: Partial<SubstanceReponse>): SubstanceReponse {
  return {
    resume: partiel.resume ?? "",
    confiance: partiel.confiance ?? null,
    ambigu: partiel.ambigu ?? false,
    recommandations: partiel.recommandations ?? [],
    donneesManquantes: partiel.donneesManquantes ?? [],
  };
}

test("la réponse écrite contient les recommandations, pas seulement le résumé", () => {
  // LE DÉFAUT QUE CE TEST FERME. On ne persistait que `resume`, décrit
  // dans le schéma comme « le brief, en trois phrases au plus » — à
  // côté de cinq décisions structurées qui, elles, portaient la
  // substance. « Quels chantiers ont dépassé leur budget ? » rendait
  // trois phrases là où l'écran d'avant rendait la liste.
  const texte = composerContenu(
    substance({
      resume: "Trois chantiers dépassent leur budget.",
      recommandations: [
        {
          titre: "Refacturer les heures du chantier Durand",
          impactCents: 845_000,
          actionRecommandee: "Créer l'avenant",
          pourquoi: "Le devis prévoyait 40 h, 63 ont été pointées.",
          raisons: ["23 heures au-delà du devis", "Aucun avenant signé"],
        },
      ],
    }),
  );

  assert.match(texte, /Trois chantiers dépassent/);
  assert.match(texte, /Refacturer les heures du chantier Durand/);
  assert.match(texte, /8\s?450/, "le montant est écrit, en euros, depuis les centimes");
  assert.match(texte, /Créer l'avenant/);
  // Le « pourquoi » et les raisons restent dans le repli : ils
  // s'affichent, ils ne repartent pas au modèle.
  assert.doesNotMatch(texte, /63 ont été pointées/);
});

test("un impact inconnu s'écrit « non chiffré », jamais zéro", () => {
  const texte = composerContenu(
    substance({
      resume: "À regarder.",
      recommandations: [
        {
          titre: "Relancer le devis Martin",
          impactCents: null,
          actionRecommandee: null,
          pourquoi: null,
          raisons: ["Envoyé il y a 21 jours"],
        },
      ],
    }),
  );
  assert.match(texte, /impact non chiffré/);
  assert.doesNotMatch(texte, /0,00/);
});

test("ce qui manque pour conclure est ÉCRIT DANS LA RÉPONSE", () => {
  // Le socle ordonne au modèle de nommer le manque dans un champ à
  // part, et non dans sa prose. Ne pas le réinjecter faisait s'afficher
  // une réponse fondée sur des données absentes exactement comme une
  // réponse sûre — et le modèle, au tour suivant, ne s'en souvenait pas.
  const texte = composerContenu(
    substance({
      resume: "La marge n'est pas calculable.",
      donneesManquantes: ["le coût d'achat de 4 lignes", "l'objectif de marge"],
    }),
  );
  assert.match(texte, /Il manque, pour conclure : le coût d'achat de 4 lignes, l'objectif de marge\./);
});

test("« données insuffisantes » se dit même quand rien n'est nommé", () => {
  const texte = composerContenu(
    substance({ resume: "Je ne peux pas répondre.", confiance: "insufficient_data" }),
  );
  assert.match(texte, /Données insuffisantes pour conclure\./);
});

test("la couche affichée garde les raisons, la confiance et les avertissements", () => {
  const couche = composerCouche(
    substance({
      confiance: "medium",
      ambigu: true,
      recommandations: [
        {
          titre: "Refacturer Durand",
          impactCents: 1,
          actionRecommandee: null,
          pourquoi: "Le devis prévoyait 40 h.",
          raisons: ["  23 heures au-delà  ", ""],
        },
      ],
    }),
    ["Analyse partielle : le droit finance.read manque.", "Analyse partielle : le droit finance.read manque."],
    [{ actionId: "a1", approvalId: "p1", libelle: "Créer la facture", resume: "…", montantCents: null }],
  );

  assert.equal(couche.confiance, "medium");
  assert.equal(couche.ambigu, true);
  assert.deepEqual(couche.raisons[0]?.raisons, ["23 heures au-delà"], "les vides sont écartés");
  assert.equal(couche.avertissements.length, 1, "un avertissement répété ne se lit qu'une fois");
  assert.equal(couche.actions[0]?.montantCents, null);
});

test("une couche illisible ne rend ni badge ni bouton inventé", () => {
  for (const cassé of [null, undefined, 42, "payload", [], { analyse: 7 }]) {
    const couche = lireCouche(cassé);
    assert.equal(couche.confiance, null, `entrée : ${JSON.stringify(cassé)}`);
    assert.deepEqual(couche.actions, []);
    assert.deepEqual(couche.raisons, []);
  }
  assert.deepEqual(lireCouche(null), COUCHE_VIDE);
});

test("une action sans identifiant n'est pas rendue, et un montant illisible reste inconnu", () => {
  const couche = lireCouche({
    actions: [
      { libelle: "Sans identifiant" },
      { actionId: "a1", libelle: "Créer la facture", montantCents: "beaucoup" },
    ],
  });
  assert.equal(couche.actions.length, 1);
  // `Number("beaucoup")` vaudrait NaN, et `?? 0` vaudrait « gratuit ».
  assert.equal(couche.actions[0]?.montantCents, null);
});
