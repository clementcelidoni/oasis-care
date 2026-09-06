import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENT_HISTORIQUE_INTERNE, MOTS_CLES_HISTORIQUE_INTERNE } from "./market.ts";
import {
  AGENTS_CONSTRUITS,
  DEFINITIONS,
  estAgentSansDonnees,
  type DefinitionAgent,
} from "./index.ts";
import { registreOutils } from "../tools.ts";
import { OUTIL_INTERNAL_HISTORY } from "../outils/market.ts";

/**
 * §11Z — L'AGENT MARCHÉ, DONT LE PRINCIPAL TRAVAIL EST DE REFUSER.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS DÉFENDENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Un agent nommé « Marché » qui répondrait à une question de marché
 * serait plus grave qu'un agent absent : sa réponse serait plausible,
 * donc invérifiable en lecture. Les limites de cet agent sont donc son
 * organe principal, et ces tests les tiennent comme on tient une règle
 * de sécurité — mot par mot, y compris quand la formulation semble
 * verbeuse.
 *
 * Les limites partent MOT POUR MOT dans l'instruction envoyée au modèle
 * (`instructionsPour`, definitions.ts). Ce ne sont pas des commentaires.
 */

/** Ce que voit le modèle, mis à plat une fois pour toutes. */
const limites = AGENT_HISTORIQUE_INTERNE.limites.join("\n").toLowerCase();
const mission = AGENT_HISTORIQUE_INTERNE.mission.toLowerCase();

/** Les définitions vues sans le type, parce que `market` n'y est pas encore. */
const definitions = DEFINITIONS as unknown as Record<string, DefinitionAgent | undefined>;

// ==================================================================
// 1. LES TROIS REFUS QUI JUSTIFIENT L'AGENT
// ==================================================================

test("le refus des données extérieures est annoncé dès la MISSION", () => {
  // La mission sert de `handoffDescription` : c'est ce que la Direction
  // lit pour décider de l'interroger. Si elle promet le marché, la
  // Direction lui posera des questions de marché.
  assert.ok(
    mission.includes("son propre passé") || mission.includes("son propre passe"),
    "la mission ne dit pas que l'agent compare l'entreprise à elle-même",
  );
  assert.ok(mission.includes("aucune donnée extérieure"), "la mission ne pose pas le refus");
  assert.ok(mission.includes("prix du marché"));
  assert.ok(mission.includes("part de marché"));
  assert.ok(mission.includes("concurrent"));
});

test("prix du marché : refusé comme CAPACITÉ ABSENTE, pas comme donnée rare", () => {
  // La différence de formulation change la suite. « Je n'ai pas assez
  // de données » appelle « attendons » ; « la fonctionnalité n'existe
  // pas » appelle « branchons-la ». C'est la distinction que l'agent
  // Clients a déjà posée pour la satisfaction, reprise ici.
  assert.ok(limites.includes("aucun prix"));
  assert.ok(
    limites.includes("n'existe pas"),
    "le refus ne dit pas que la capacité N'EXISTE PAS : il se lira comme un manque temporaire",
  );
  assert.ok(
    limites.includes("recherche extérieure") || limites.includes("recherche exterieure"),
    "le refus ne nomme pas ce qu'il faudrait brancher : un refus sans suite est un refus définitif déguisé",
  );
  assert.ok(
    limites.includes("à titre indicatif"),
    "l'échappatoire « à titre indicatif » n'est pas fermée, et c'est celle qu'un modèle prend",
  );
});

test("part de marché : le dénominateur est nommé absent", () => {
  assert.ok(limites.includes("part de marché"));
  assert.ok(
    limites.includes("dénominateur"),
    "sans nommer le dénominateur, le refus ressemble à de la prudence plutôt qu'à une impossibilité",
  );
});

test("concurrent : refusé sans laisser croire qu'il n'y en a pas", () => {
  // « Vous n'avez pas de concurrent » serait la conclusion naturelle
  // d'un modèle qui lit trois colonnes vides. C'est la confusion zéro /
  // je-ne-sais-pas, déjà corrigée quatre fois dans ce produit.
  assert.ok(limites.includes("aucun concurrent n'est nommé nulle part"));
  assert.ok(limites.includes("motifs de perte"));
  assert.ok(
    limites.includes("vous n'avez pas de concurrent"),
    "la phrase à ne pas dire n'est pas citée : elle sera dite",
  );
});

test("le mot « marché » lui est interdit pour parler de ses propres chiffres", () => {
  // S'il dit « le marché », le lecteur comprend « les autres ». La
  // phrase serait vraie dans l'intention et fausse à la lecture.
  assert.ok(limites.includes("le lecteur comprendrait"));
  assert.ok(limites.includes("chez vous"));
  assert.ok(limites.includes("dans vos devis"));
  assert.ok(limites.includes("sur vos chantiers"));
});

test("le libellé affiché n'est pas « Marché »", () => {
  // La clé technique reste `market` — le routeur, AGENTS_MODELE et
  // l'alias `market_intelligence` la connaissent, et rien ne justifie
  // de toucher au routeur pour une question de nom. Le LIBELLÉ, lui,
  // est ce que le dirigeant lit dans l'écran des réglages.
  assert.equal(AGENT_HISTORIQUE_INTERNE.cle, "market");
  assert.equal(AGENT_HISTORIQUE_INTERNE.libelle, "Historique interne");
  assert.ok(
    !AGENT_HISTORIQUE_INTERNE.libelle.toLowerCase().includes("march"),
    "l'écran promettrait au dirigeant ce que personne ne peut lui donner",
  );
});

// ==================================================================
// 2. LES SEUILS, ET LE VIDE
// ==================================================================

test("sous le seuil, il rend les lignes brutes et le motif — jamais un pourcentage", () => {
  assert.ok(limites.includes("aucune part en pourcentage"));
  assert.ok(limites.includes("lignes brutes"));
  assert.ok(
    limites.includes("arithmétiquement exact") && limites.includes("ne décrit rien"),
    "le motif du refus n'explique pas pourquoi le chiffre serait vrai et vide",
  );
});

test("« pas assez d'histoire » et non « aucune saisonnalité détectée »", () => {
  // Les deux phrases décrivent la même absence de sortie et disent
  // l'inverse l'une de l'autre au lecteur.
  assert.ok(limites.includes("aucune saisonnalité détectée"));
  assert.ok(limites.includes("pas assez d'histoire"));
  assert.ok(limites.includes("même saison de l'année précédente"));
});

test("un champ vide n'est pas une absence : les deux cas sont nommés", () => {
  // C'est l'état MESURÉ de cette base, donc le premier que rencontrera
  // un utilisateur — pas un cas limite.
  assert.ok(limites.includes("aucune source renseignée"));
  assert.ok(limites.includes("aucune origine"));
  assert.ok(limites.includes("un prix stable"));
  assert.ok(
    limites.includes("défauts de saisie"),
    "l'agent ne dit pas que c'est réparable : le dirigeant croira que c'est le produit",
  );
});

// ==================================================================
// 3. LES DOUBLONS QU'IL NE CRÉE PAS
// ==================================================================

test("il renvoie la marge à la Finance, les taux aux Ventes, les comparables au Chiffrage", () => {
  // Une seconde source de vérité sur le même chiffre finit par donner
  // deux réponses différentes à la même question, et personne ne sait
  // laquelle croire.
  assert.ok(limites.includes("la finance la décompose"));
  assert.ok(limites.includes("taux de transformation"));
  assert.ok(limites.includes("chantiers comparables"));
});

test("le prix de vente n'est pas un coût d'achat, et les achats ne sont pas à lui", () => {
  assert.ok(limites.includes("prix de vente unitaire"));
  assert.ok(limites.includes("coût d'achat"));
  assert.ok(limites.includes("agent achats"));
});

test("le rapprochement par libellé est présenté comme une piste", () => {
  assert.ok(limites.includes("libellé"));
  assert.ok(limites.includes("piste à vérifier"));
  assert.ok(limites.includes("écart mesuré"));
});

test("c'est une mission de lecture, et son seul outil est une lecture", () => {
  assert.ok(limites.includes("n'écrit rien"));
  assert.equal(OUTIL_INTERNAL_HISTORY.famille, "lecture");
  assert.equal(OUTIL_INTERNAL_HISTORY.agent, AGENT_HISTORIQUE_INTERNE.cle);
});

test("les droits attendus sont exactement ceux que la fonction exige", () => {
  // Ce ne sont pas « les droits de l'agent » — un agent n'en a aucun,
  // il agit avec ceux de l'utilisateur. C'est ce que ses fonctions
  // exigent de l'appelant, et l'instruction lui ordonne de le dire
  // quand l'un manque.
  assert.deepEqual([...AGENT_HISTORIQUE_INTERNE.droitsAttendus], ["clients.read", "quotes.read"]);
  assert.ok(
    AGENT_HISTORIQUE_INTERNE.droitsAttendus.includes(
      OUTIL_INTERNAL_HISTORY.permission as "quotes.read",
    ),
    "l'outil déclare un droit que l'agent n'attend pas : l'un des deux ment",
  );
});

// ==================================================================
// 4. LES MOTS-CLÉS, ET CE QU'ILS COÛTENT AUX AUTRES
// ==================================================================

test("aucun mot n'est déjà revendiqué par l'un des douze autres agents", () => {
  // Sinon l'aiguillage se joue à l'ordre des règles, donc à qui a
  // fusionné en dernier — et le perdant répond « je ne vois rien » avec
  // aplomb sur une question qui lui était destinée.
  const pris = new Map<string, string>();
  for (const cle of AGENTS_CONSTRUITS) {
    // §11Z, INTÉGRATION — SA PROPRE CLÉ EST EXCLUE, ET C'EST LA SEULE
    // CHOSE QUI CHANGE. Ce test a été écrit avant que « market » soit
    // composé dans `DEFINITIONS` ; il l'y trouve désormais et se
    // comparerait à lui-même. La garantie est inchangée — « aucun AUTRE
    // agent ne revendique mes mots » — mais elle cesse d'être un
    // contrôle jetable d'avant fusion : elle attrapera le prochain
    // agent qui viendrait poser un de ces mots chez lui.
    if (cle === "market") continue;
    for (const mot of definitions[cle]?.motsCles ?? []) {
      pris.set(normaliser(mot), cle);
    }
  }
  for (const mot of MOTS_CLES_HISTORIQUE_INTERNE) {
    const deja = pris.get(normaliser(mot));
    assert.equal(deja, undefined, `« ${mot} » est déjà revendiqué par « ${deja} »`);
  }
});

test("aucune entrée morte : un mot contenu dans un autre de la liste ne se déclenche jamais", () => {
  // L'aiguillage cherche une SOUS-CHAÎNE. Un mot plus long qui contient
  // un mot plus court de la même liste ne peut jamais gagner : le court
  // aura déjà répondu. Une liste rassurante dont la moitié est morte
  // finit par être recopiée ailleurs comme si elle décrivait quelque chose.
  const mots = MOTS_CLES_HISTORIQUE_INTERNE.map(normaliser);
  for (const mot of mots) {
    for (const autre of mots) {
      if (mot === autre) continue;
      assert.ok(
        !mot.includes(autre),
        `« ${mot} » contient « ${autre} » : il ne se déclenchera jamais`,
      );
    }
  }
});

test("toute graphie avec apostrophe a sa jumelle sans apostrophe", () => {
  // PIÈGE MESURÉ : `normaliser()` passe en minuscules et retire les
  // diacritiques, mais NE TOUCHE PAS aux apostrophes. « d'où viennent
  // mes clients » ne correspond donc pas au mot-clé « d ou viennent mes
  // clients ». Les agents existants portent déjà les deux graphies —
  // la Direction « aujourd'hui » ET « aujourd hui », la Finance
  // « chiffre d'affaires » ET « chiffre d affaires ».
  //
  // Ce test défend la règle plutôt que la liste : il attrapera le
  // prochain mot à apostrophe qu'on ajoutera ici sans y penser.
  const toutes = new Set<string>(MOTS_CLES_HISTORIQUE_INTERNE.map((m) => normaliser(m)));
  for (const mot of MOTS_CLES_HISTORIQUE_INTERNE) {
    if (!/['’]/.test(mot)) continue;
    const sansApostrophe = normaliser(mot).replace(/['’]/g, " ");
    assert.ok(
      toutes.has(sansApostrophe),
      `« ${mot} » n'a pas sa variante « ${sansApostrophe} » : ` +
        "la question tapée sans apostrophe partira ailleurs",
    );
  }
});

test("trois mots contiennent « client », et c'est ce qui rend le placement OBLIGATOIRE", () => {
  // Ce n'est pas une collision oubliée : c'est la raison pour laquelle
  // `market` doit être essayé AVANT `customer` dans l'ORDRE
  // d'`aiguillage.ts`. Sans ce placement, « d'où viennent mes clients »
  // part aux Clients sur le mot « client » — et l'agent Clients porte
  // une limite explicite qui lui interdit TOUTE phrase de portefeuille.
  // Il déclinerait poliment, après avoir fait payer un appel complet.
  //
  // Le test échouera le jour où les Clients changent de mot-clé : ce
  // sera le bon moment pour relire le placement, pas pour l'oublier.
  const motsClients = (definitions["customer"]?.motsCles ?? []).map(normaliser);
  const concernes = MOTS_CLES_HISTORIQUE_INTERNE.filter((m) =>
    motsClients.some((c) => normaliser(m).includes(c)),
  );
  assert.deepEqual(
    concernes,
    ["origine de mes clients", "d'où viennent mes clients", "d ou viennent mes clients"],
    "la liste des mots qui empiètent sur les Clients a changé : relire la place dans ORDRE",
  );
});

test("« marché » nu n'est pas un mot-clé : il volerait trois questions qui ne sont pas les siennes", () => {
  // « le marché de Rungis », « un marché public », « j'ai décroché ce
  // marché » — dont deux appartiennent au Commerce. Les locutions
  // complètes suffisent, et ne se déclenchent que sur la question qu'on
  // veut vraiment refuser.
  const mots: readonly string[] = MOTS_CLES_HISTORIQUE_INTERNE;
  assert.ok(!mots.includes("marché"));
  assert.ok(!mots.includes("marche"));

  // §11Z — « prix du marché » A ÉTÉ REMPLACÉ PAR « du marché », ET LE
  // TEST SUIT LA MESURE PLUTÔT QUE L'INVERSE.
  //
  // La locution exacte ne correspondait pas à « quel est le prix MOYEN
  // du marché » : l'aiguilleur cherche une sous-chaîne CONTIGUË, et un
  // mot inséré au milieu casse la correspondance. Mesuré en rejouant le
  // vrai aiguilleur — la question partait à la Direction, qui n'a
  // AUCUNE limite lui interdisant d'inventer un prix du marché.
  //
  // Ce qui est vérifié ici reste la même garantie, exprimée sur la
  // bonne unité : les deux tournures retenues désignent le marché AU
  // SENS ÉCONOMIQUE et n'apparaissent dans aucune des trois questions
  // que le mot nu volerait.
  assert.ok(mots.includes("du marché"), "la tournure qui couvre « prix (moyen) du marché »");
  assert.ok(mots.includes("sur le marché"), "la tournure qui couvre « ma position sur le marché »");
  assert.ok(mots.includes("part de marché"));
  assert.ok(mots.includes("parts de marché"), "le pluriel du PREMIER mot n'est jamais gratuit");

  // ET LA VÉRIFICATION QUI COMPTE VRAIMENT : aucune des trois questions
  // que « marché » nu volerait ne contient l'une des tournures
  // retenues. C'est cela que le titre de ce test promet, et c'était
  // jusqu'ici affirmé plutôt que mesuré.
  const normaliserLocal = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const question of [
    "le marché de Rungis",
    "un marché public",
    "j'ai décroché ce marché",
  ]) {
    for (const mot of mots) {
      assert.ok(
        !normaliserLocal(question).includes(normaliserLocal(mot)),
        `« ${question} » atteint l'Historique interne par « ${mot} » : ce n'est pas sa question`,
      );
    }
  }
});

// ==================================================================
// 5. LA FORME D'UNE LIMITE
// ==================================================================

test("aucune limite ne contient un chiffre : une limite est une règle, pas une mesure", () => {
  // Une limite est relue une fois par an, une mesure vieillit en une
  // semaine. « cinq points de comparaison » écrit dans une limite
  // deviendrait faux le jour où le seuil bouge, et personne ne relit
  // les limites pour cela. Les seuils vivent dans le SQL, qui les
  // applique, et dans les tests, qui échouent.
  for (const limite of AGENT_HISTORIQUE_INTERNE.limites) {
    assert.ok(
      !/\d/.test(limite),
      `une limite du Marché porte un chiffre et vieillira sans prévenir : « ${limite} »`,
    );
  }
});

// ==================================================================
// 6. L'INTÉGRATION — LE TEST CHANGE DE CAMP TOUT SEUL
// ==================================================================

test("tant que market n'est pas dans la liste des construits, il n'est ni double ni oublié", () => {
  const construit = (AGENTS_CONSTRUITS as readonly string[]).includes("market");

  if (!construit) {
    // ÉTAT ATTENDU AUJOURD'HUI. `agents/types.ts`, `agents/index.ts`,
    // `agents/sansDonnees.ts` et `runtime/tools.ts` sont PARTAGÉS :
    // deux constructeurs qui y écriraient en même temps se
    // croiseraient. L'intégration fait les quatre gestes d'un coup.
    assert.equal(definitions["market"], undefined);
    assert.ok(
      estAgentSansDonnees("market"),
      "market n'est ni construit ni déclaré sans données : il est simplement introuvable, " +
        "et un agent introuvable est indiscernable d'un agent oublié",
    );
    return;
  }

  // ÉTAT APRÈS INTÉGRATION : les quatre gestes doivent avoir été faits
  // ENSEMBLE, sinon l'agent est accepté par la base et n'a rien à lire.
  //
  // `aCompleter` est LU D'ABORD, sur la définition composée et non sur
  // la constante : `satisfies` conserve le type littéral de l'objet
  // écrit, où la propriété est absente — donc illisible — et la lire
  // après l'égalité ci-dessous la rendrait illisible aussi, TypeScript
  // ayant alors rétréci le type à celui de la constante.
  const enConstruction = definitions["market"]?.aCompleter === true;

  assert.equal(
    definitions["market"],
    AGENT_HISTORIQUE_INTERNE,
    "market est déclaré construit mais l'index compose une autre définition",
  );
  assert.equal(
    estAgentSansDonnees("market"),
    false,
    "market est construit ET encore déclaré sans données : l'écran dira les deux",
  );
  assert.equal(
    enConstruction,
    false,
    "l'écran des réglages affichera « en construction » sur un agent prêt",
  );
  assert.notEqual(
    registreOutils().chercher(OUTIL_INTERNAL_HISTORY.nom),
    null,
    "market est construit mais getInternalHistory n'est au catalogue nulle part : " +
      "l'agent répondra sans jamais pouvoir lire l'historique qu'il promet",
  );
});

/** La normalisation d'`aiguillage.ts`, recopiée pour ne pas importer une route dans un test de définition. */
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "");
}
