import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENT_MATERIEL, MOTS_CLES_MATERIEL } from "./fleet.ts";
import { DEFINITIONS, AGENTS_CONSTRUITS } from "./index.ts";
import { registreOutils } from "../tools.ts";
import { OUTILS_MATERIEL } from "../outils/fleet.ts";

/**
 * CE QUE LA DÉFINITION DE L'AGENT MATÉRIEL DOIT TENIR.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN TEST DE PLUS, ALORS QUE `outils/fleet.test.ts` EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Les deux fichiers défendent deux choses différentes, et la confusion
 * entre les deux est précisément ce qui laisse passer une façade.
 *
 *   • `outils/fleet.test.ts` défend les OUTILS : ce que la fonction SQL
 *     rend, ce que le modèle lit dans la description, le fait qu'une
 *     question ne puisse rien écrire.
 *   • CE FICHIER défend la DÉFINITION : ce que l'agent dit de lui-même
 *     avant d'avoir lu quoi que ce soit. C'est le seul endroit où un
 *     verdict PARTIEL peut être trahi sans qu'aucune requête échoue —
 *     il suffit qu'une limite disparaisse, et l'agent se met à répondre
 *     avec assurance sur la moitié de son domaine qui n'a pas de schéma.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA CHOSE À NE PAS PERDRE : LA MOITIÉ « COÛTS » N'EXISTE PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le module Matériel est réel — quatre tables, deux vues, deux écrans,
 * huit politiques RLS. Ce qui n'existe pas, c'est le COÛT D'USAGE :
 * aucune table de carburant, aucun relevé kilométrique périodique,
 * aucun amortissement (0067 l'exclut par écrit), aucune géolocalisation,
 * aucune refacturation au chantier.
 *
 * Or « matériel » et « coûts du matériel » sonnent comme un seul sujet.
 * La spec elle-même nomme p. 24 le cas « camion coûteux », qui est
 * exactement celui auquel ces données ne peuvent pas répondre. Le jour
 * où quelqu'un allègera les limites de cet agent pour les rendre plus
 * lisibles, il retirera d'abord ces phrases-là — elles sont longues, et
 * elles décrivent une absence, donc rien ne semble casser.
 *
 * Les tests ci-dessous existent pour que quelque chose casse.
 */

const limites = AGENT_MATERIEL.limites.join("\n").toLowerCase();
const mission = AGENT_MATERIEL.mission.toLowerCase();

// ==================================================================
// 1. LE VERDICT PARTIEL EST DIT PAR L'AGENT, PAS SEULEMENT PAR LE
//    SONDAGE
// ==================================================================

test("la moitié qui n'a pas de schéma est refusée dès la MISSION, pas seulement dans les limites", () => {
  // La `mission` est le seul champ que trois publics différents lisent :
  // l'écran des réglages l'affiche, la Direction s'en sert comme
  // `handoffDescription` pour décider de déléguer, et le modèle la reçoit
  // en tête de ses instructions.
  //
  // C'est donc le seul endroit où le refus arrive AVANT la question. Une
  // limite arrive après : elle empêche une mauvaise réponse, elle
  // n'empêche pas la Direction de déléguer un calcul de coût au
  // kilomètre à un agent qui n'a rien pour y répondre — et cette
  // délégation-là est payée avant d'être refusée.
  assert.match(
    mission,
    /co[uû]t/,
    "la mission ne dit pas que les coûts d'usage sont hors de portée : " +
      "la Direction lui déléguera « combien me coûte ce camion »",
  );
  assert.ok(
    mission.includes("ne mesure pas") || mission.includes("ne chiffre aucun"),
    "la mission évoque les coûts sans dire qu'ils sont IMPOSSIBLES : évoquer n'est pas refuser",
  );
});

test("les cinq absences MESURÉES sont nommées une par une, pas résumées", () => {
  // Une seule phrase du genre « il ne connaît pas les coûts » serait plus
  // courte et strictement moins utile : l'utilisateur qui demande le
  // carburant ne se reconnaît pas dans « les coûts », il se reconnaît
  // dans « carburant ». Un refus qu'on ne reconnaît pas est un refus
  // qu'on reformule, et la reformulation finit par passer.
  //
  // Les cinq sont MESURÉES, pas supposées : balayage de
  // `information_schema` — aucune table, aucune colonne.
  const attendus: readonly [string, RegExp][] = [
    ["le carburant", /carburant/],
    ["le coût au kilomètre ou à l'heure", /kilom[eè]tre/],
    ["l'amortissement et la valeur résiduelle", /amortissement/],
    ["la géolocalisation", /g[eé]olocalisation|position/],
    ["la refacturation au chantier", /refacturation/],
  ];
  for (const [quoi, motif] of attendus) {
    assert.match(limites, motif, `${quoi} n'est plus nommé dans les limites de l'agent Matériel`);
  }
});

test("l'absence est dite ABSENTE, et non vide : les deux n'appellent pas la même suite", () => {
  // « la table est vide » invite à saisir des données ; « la table
  // n'existe pas » invite à livrer une fonctionnalité. Dire la première
  // à la place de la seconde envoie un dirigeant chercher un écran de
  // saisie du carburant qui n'a jamais existé.
  assert.ok(
    limites.includes("tables absentes") || limites.includes("n'existent pas"),
    "les limites laissent croire que les coûts d'usage sont une table vide plutôt qu'un manque de schéma",
  );
});

// ==================================================================
// 2. « ZÉRO » N'EST JAMAIS UNE RÉPONSE — LA FAUTE LA PLUS FACILE ICI
// ==================================================================

test("les deux formes du piège du zéro sont ordonnées dans les limites, pas seulement gérées par le SQL", () => {
  // Le SQL rend déjà `parc.vide` et `echeances.suivies`, et
  // `outils/fleet.test.ts` le défend. Ce n'est pas une raison de
  // l'omettre ici : la limite est ce que le modèle lit quand l'outil
  // ÉCHOUE, quand l'utilisateur insiste, ou quand un futur outil du
  // Matériel n'aura pas les mêmes drapeaux.
  //
  // `equipment` compte zéro ligne en production aujourd'hui. « aucune
  // échéance en retard » est donc la phrase que cet agent est le plus
  // près de prononcer, et c'est aussi la plus rassurante — donc celle
  // que personne ne va vérifier.
  assert.ok(
    limites.includes("parc est vide"),
    "la limite ne couvre plus le parc vide, qui est l'état RÉEL de la production",
  );
  assert.ok(
    limites.includes("aucune échéance n'a été saisie") ||
      limites.includes("échéance n'a été saisie"),
    "la limite ne couvre plus le parc SUIVI PAR PERSONNE, qui est le piège le plus vicieux : " +
      "les compteurs de machines y sont crédibles, donc « 0 en retard » ressemble à une réponse",
  );
  assert.ok(
    limites.includes("null") || limites.includes("zéro"),
    "la limite n'ordonne plus de préférer null à zéro",
  );
});

test("un droit manquant rend indisponible et se NOMME, il ne rend pas un parc vide", () => {
  // Sans `projects.read`, la RLS masque les quatre tables et une lecture
  // naïve rendrait un parc vide — indiscernable d'une entreprise qui n'a
  // rien saisi. C'est la classe de bug « RLS grant tables » déjà nommée
  // dans ce dépôt, et elle croise ici la confusion zéro / je-ne-sais-pas.
  assert.match(
    limites,
    /projects\.read/,
    "le droit qui commande tout le module n'est plus nommé dans les limites",
  );
  assert.deepEqual(
    [...AGENT_MATERIEL.droitsAttendus],
    ["projects.read"],
    "les droits attendus du Matériel ont changé : les huit politiques RLS de 0067 lisent sous projects.read",
  );
});

test("le compteur est daté, et rien n'est extrapolé entre deux relevés", () => {
  // `meter_reading` est porté par une LIGNE D'ENTRETIEN : on ne relève
  // qu'en passant à l'atelier. Il n'existe donc aucune série temporelle,
  // et toute projection d'usure ou de panne serait inventée — sur un
  // sujet où l'invention coûte une immobilisation.
  assert.match(limites, /compteur/, "le compteur n'est plus encadré");
  assert.ok(
    limites.includes("n'extrapole") || limites.includes("ne prédit"),
    "rien n'interdit plus d'extrapoler l'usure entre deux passages à l'atelier",
  );
});

test("une affectation est une saisie, jamais une position", () => {
  // Le produit n'a aucun boîtier télématique, et 0067 l'écrit. « au
  // dépôt » veut dire « aucune affectation ouverte » — un engin prêté
  // sans saisie est « au dépôt » et il ne l'est pas.
  assert.ok(
    limites.includes("saisie") && /d[eé]p[oô]t/.test(limites),
    "la différence entre l'affectation saisie et la position réelle n'est plus dite",
  );
});

// ==================================================================
// 3. IL NE FAIT RIEN — ET IL NE PROPOSE RIEN NON PLUS
// ==================================================================

test("aucun outil du Matériel n'écrit ni ne propose : c'est une mission de lecture", () => {
  // Décision explicite du sondage, et elle mérite d'être défendue parce
  // qu'elle sera contestée : « on pourrait proposer de marquer l'échéance
  // faite ». L'écran /materiel a déjà ce bouton, à un clic. Superposer
  // une proposition d'IA ajouterait un chemin d'écriture, un brouillon à
  // valider et une confirmation serveur pour remplacer un clic.
  for (const outil of OUTILS_MATERIEL) {
    assert.equal(
      outil.famille,
      "lecture",
      `« ${outil.nom} » n'est plus un outil de lecture : l'agent Matériel gagnerait un chemin d'écriture`,
    );
    assert.equal(outil.confirmationRequise, false, `« ${outil.nom} » demande une confirmation : ` +
      "une lecture qui se fait confirmer laisse croire qu'elle agit");
  }
  assert.match(
    limites,
    /n'écrit rien/,
    "la première limite ne dit plus que l'agent n'écrit rien",
  );
});

test("il renvoie vers l'écran plutôt que de proposer une action : un refus doit avoir une suite", () => {
  // Un refus sans destination est un cul-de-sac, et un cul-de-sac se
  // contourne en reformulant la question jusqu'à ce que le modèle cède.
  assert.match(
    limites,
    /\/materiel/,
    "les limites refusent d'agir sans dire où l'utilisateur peut le faire lui-même",
  );
});

// ==================================================================
// 4. LES MOTS QUI L'ATTEINDRONT — VÉRIFIÉS AVANT LA FUSION, PAS APRÈS
// ==================================================================

test("aucun mot proposé n'est déjà revendiqué par un des neuf autres agents", () => {
  // `index.test.ts` fait cette vérification sur les mots POSÉS. Elle
  // arriverait ici trop tard : les mots du Matériel ne seront posés que
  // par l'intégration, c'est-à-dire au moment de la fusion, quand un
  // conflit se règle à la hâte. On le vérifie donc dès maintenant, sur la
  // liste exportée que l'intégration recopiera telle quelle.
  //
  // Le sens du test est ASYMÉTRIQUE, et c'est voulu : on cherche aussi
  // bien un mot du Matériel contenu dans le mot d'un autre que l'inverse.
  // L'aiguillage cherche une sous-chaîne, donc « parc » entrerait en
  // conflit avec « parcelle » sans qu'aucune égalité ne le révèle.
  for (const cle of AGENTS_CONSTRUITS) {
    if (cle === "fleet") continue;
    for (const autre of DEFINITIONS[cle].motsCles ?? []) {
      for (const mien of MOTS_CLES_MATERIEL) {
        const a = normaliser(autre);
        const b = normaliser(mien);
        assert.ok(
          !a.includes(b) && !b.includes(a),
          `« ${mien} » (Matériel) et « ${autre} » (${cle}) se recouvrent : ` +
            "l'aiguillage compare des sous-chaînes, l'agent essayé en premier gagnerait les deux",
        );
      }
    }
  }
});

test("les mots trop larges restent DEHORS, y compris celui que le sondage proposait", () => {
  // « parc » avait été proposé et il est retiré : un paysagiste entretient
  // des parcs, et « parc » est dans « parcelle ». Les trois autres sont
  // écartés pour la même famille de raison — ils ont un sens plus fréquent
  // ailleurs dans ce métier.
  //
  // Ce test n'est pas décoratif : il défend une décision contre le réflexe
  // « ajoutons quelques synonymes pour mieux couvrir », qui est exactement
  // la manière dont un aiguillage devient imprévisible.
  const interdits = ["parc", "entretien", "échéance", "assurance", "révision"];
  for (const mot of interdits) {
    for (const mien of MOTS_CLES_MATERIEL) {
      assert.ok(
        normaliser(mien) !== normaliser(mot),
        `« ${mot} » est revenu dans les mots du Matériel : relire la raison de son exclusion`,
      );
    }
  }
});

test("aucun nom de machine dans la liste : on prend des catégories", () => {
  // Le parc d'un paysagiste compte des tondeuses, des tracteurs, des
  // remorques, des nacelles, des broyeurs. Les lister un par un donne
  // l'illusion d'une couverture et rate toujours la machine suivante.
  const nomsDeMachine = ["tondeuse", "mini-pelle", "minipelle", "nacelle", "broyeur", "remorque"];
  for (const nom of nomsDeMachine) {
    for (const mien of MOTS_CLES_MATERIEL) {
      assert.ok(
        normaliser(mien) !== normaliser(nom),
        `« ${nom} » est un nom de machine : « engin » et « matériel » les attrapent tous`,
      );
    }
  }
});

// ==================================================================
// 5. LE COUPLAGE GABARIT / MOTS / SOURCES — CE QUI GARDE L'AGENT
//    HONNÊTE PENDANT QU'IL ATTEND SON INTÉGRATION
// ==================================================================

test("tant que ses outils ne sont pas au catalogue, il reste gabarit et muet", () => {
  // C'EST UN TEST FAIT POUR CHANGER DE CAMP, et c'est ainsi qu'il sert.
  //
  // Aujourd'hui `tools.ts` ne connaît aucun outil du Matériel : le
  // catalogue est PARTAGÉ, et l'intégration l'y versera avec le corps SQL
  // de 0082, dans le même commit. Tant que c'est le cas, l'agent doit
  // rester `aCompleter` et sans mots-clés — sinon une question libre
  // atteindrait un agent qui n'a strictement rien à lire, et rendrait la
  // phrase polie que ce chantier existe pour ne pas produire.
  //
  // Le jour où le catalogue les connaît, la branche s'inverse et exige
  // l'inverse. Personne n'a besoin de se souvenir de ce test : il
  // réclamera le geste manquant tout seul.
  const registre = registreOutils();
  const auCatalogue = OUTILS_MATERIEL.filter((o) => registre.chercher(o.nom) !== null);

  if (auCatalogue.length === 0) {
    assert.equal(
      AGENT_MATERIEL.aCompleter,
      true,
      "l'agent Matériel se dit achevé alors qu'aucun de ses outils n'est au catalogue : " +
        "il paierait un raisonnement complet pour dire qu'il n'a rien lu",
    );
    assert.equal(
      AGENT_MATERIEL.motsCles ?? undefined,
      undefined,
      "l'agent Matériel attrape des questions libres sans avoir un seul outil déclaré",
    );
    return;
  }

  assert.equal(
    auCatalogue.length,
    OUTILS_MATERIEL.length,
    "une partie seulement des outils du Matériel est au catalogue : " +
      "les deux fonctions vivent dans la même migration, elles s'y versent ensemble",
  );
  assert.notEqual(
    AGENT_MATERIEL.aCompleter,
    true,
    "les outils du Matériel sont au catalogue mais l'agent se dit encore gabarit : " +
      "l'écran des réglages affichera « en construction » sur un agent prêt",
  );
  assert.deepEqual(
    [...(AGENT_MATERIEL.motsCles ?? [])],
    [...MOTS_CLES_MATERIEL],
    "les outils sont branchés mais aucune question libre n'atteint l'agent : " +
      "écrire « motsCles: MOTS_CLES_MATERIEL » sur la définition",
  );
});

// ==================================================================
// 6. LA FORME D'UNE LIMITE
// ==================================================================

test("aucune limite ne contient un chiffre : une limite est une règle, pas une mesure", () => {
  // La règle de la maison, et elle a une raison précise. Une limite est
  // relue une fois par an ; une mesure vieillit en une semaine. « le parc
  // compte 0 machine » écrit dans une limite deviendrait faux au premier
  // engin saisi, et personne ne relit les limites pour cela.
  //
  // Les mesures ont leur place : dans l'en-tête du fichier, qui est daté
  // par le commit, et dans les tests, qui échouent quand elles changent.
  for (const limite of AGENT_MATERIEL.limites) {
    assert.ok(
      !/\d/.test(limite),
      `une limite du Matériel porte un chiffre et vieillira sans prévenir : « ${limite} »`,
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
