import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AGENTS_A_COMPLETER,
  AGENTS_CONSTRUITS,
  AGENTS_NON_REPONDANTS,
  AGENTS_SANS_DONNEES,
  CLE_BASE,
  DEFINITIONS,
  estAgentConstruit,
  estAgentNonRepondant,
  estAgentSansDonnees,
} from "./index.ts";
import { AGENTS_MODELE, normaliserCleAgent } from "../../model/types.ts";
import { registreOutils } from "../tools.ts";
import { AGENTS_AVEC_PLAN } from "../context.ts";

/**
 * §11Y — CE QUE LE DÉCOUPAGE PAR FICHIER DOIT GARANTIR.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'ÉPROUVE PAS LES AGENTS. IL ÉPROUVE LA PLOMBERIE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce qu'un agent DIT est éprouvé dans `definitions.test.ts`. Ce que ce
 * fichier-ci défend, c'est l'assemblage : dix fichiers, un index, une
 * liste, une graphie SQL, un routeur, une migration — et le fait que
 * les six surfaces ne puissent pas diverger en silence pendant que
 * plusieurs personnes écrivent leurs agents en parallèle.
 *
 * Chacune des divergences ci-dessous a une conséquence concrète, et
 * aucune ne casserait quoi que ce soit au moment où elle serait
 * introduite :
 *
 *   • une définition rangée sous la clé du voisin → l'agent Matériel
 *     parle de stock, et personne ne comprend pourquoi ;
 *   • une clé dans la liste sans fichier → `DEFINITIONS[agent]` vaut
 *     `undefined`, et l'erreur parle d'une propriété six appels plus
 *     loin ;
 *   • une clé que le routeur de modèles ignore → l'agent tourne sur le
 *     niveau par défaut, et la facture le dit avant l'écran ;
 *   • une clé absente de la migration → la première recommandation
 *     signée par cet agent est refusée par la contrainte, APRÈS avoir
 *     payé l'appel de modèle ;
 *   • deux agents qui revendiquent le même mot-clé → l'aiguillage
 *     dépend de l'ordre, et l'ordre dépend de qui a fusionné en
 *     dernier ;
 *   • un agent à la fois construit et déclaré sans données → les deux
 *     listes se contredisent, et celle qu'on croit dépend de l'écran.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

// ==================================================================
// 1. LA COMPOSITION — dix fichiers, dix clés, aucune permutation
// ==================================================================

test("chaque définition est rangée sous sa propre clé", () => {
  // La seule faute que ce découpage pouvait introduire : un import
  // dupliqué à la va-vite qui range la Pépinière sous « fleet ». Elle
  // ne casse rien, elle ne se voit pas, et elle fait répondre le
  // mauvais agent.
  for (const cle of AGENTS_CONSTRUITS) {
    assert.ok(DEFINITIONS[cle], `« ${cle} » figure dans la liste sans avoir de fichier`);
    assert.equal(
      DEFINITIONS[cle].cle,
      cle,
      `la définition rangée sous « ${cle} » se déclare « ${DEFINITIONS[cle].cle} »`,
    );
  }
  assert.equal(Object.keys(DEFINITIONS).length, AGENTS_CONSTRUITS.length);
});

test("chaque agent a un libellé, une mission, des responsabilités et des limites", () => {
  for (const cle of AGENTS_CONSTRUITS) {
    const d = DEFINITIONS[cle];
    assert.ok(d.libelle.length > 0, `« ${cle} » n'a pas de nom français`);
    assert.ok(d.mission.length > 20, `« ${cle} » n'a pas de mission écrite`);
    assert.ok(d.responsabilites.length > 20, `« ${cle} » n'a pas de responsabilités`);
    // MÊME UN GABARIT DOIT AVOIR SES LIMITES, et c'est le contraire de
    // ce qu'on croirait : un gabarit est justement l'agent qui risque
    // le plus d'être appelé sans savoir ce qu'il ne voit pas.
    assert.ok(d.limites.length > 0, `« ${cle} » n'écrit aucune limite`);
    assert.ok(d.droitsAttendus.length > 0, `« ${cle} » n'attend aucun droit : est-ce vrai ?`);
  }
});

test("deux agents ne revendiquent jamais le même mot-clé", () => {
  // Sinon l'aiguillage se joue à l'ordre des règles, donc à qui a
  // fusionné en dernier — et le perdant répond « je ne vois rien » avec
  // aplomb sur une question qui lui était destinée.
  const proprietaire = new Map<string, string>();
  for (const cle of AGENTS_CONSTRUITS) {
    for (const mot of DEFINITIONS[cle].motsCles ?? []) {
      const normalise = mot.toLowerCase().trim();
      const deja = proprietaire.get(normalise);
      assert.equal(
        deja,
        undefined,
        `« ${mot} » est revendiqué par « ${deja} » et par « ${cle} »`,
      );
      proprietaire.set(normalise, cle);
    }
  }
});

test("un gabarit n'a pas de mots-clés : on ne le fait pas répondre avant l'heure", () => {
  for (const cle of AGENTS_A_COMPLETER) {
    assert.equal(
      DEFINITIONS[cle].motsCles ?? undefined,
      undefined,
      `« ${cle} » est un gabarit ET attrape des questions libres : il répondra pauvrement`,
    );
  }
  // Et l'inverse : un agent achevé qu'aucun mot n'atteint ne sert à
  // personne, sauf la Direction qui l'interroge elle-même.
  for (const cle of AGENTS_CONSTRUITS) {
    if (DEFINITIONS[cle].aCompleter === true) continue;
    assert.ok(
      (DEFINITIONS[cle].motsCles ?? []).length > 0,
      `« ${cle} » est donné pour achevé et aucun mot ne l'atteint`,
    );
  }
});

// ==================================================================
// 2. LES DEUX GRAPHIES — le piège de `quote_pricing`
// ==================================================================

test("le routeur de modèles connaît les dix clés, dans les deux graphies", () => {
  for (const cle of AGENTS_CONSTRUITS) {
    assert.ok(
      (AGENTS_MODELE as readonly string[]).includes(cle),
      `« ${cle} » n'est pas au catalogue du routeur : il tournerait sur un niveau par défaut`,
    );
    // La graphie du CODE.
    assert.equal(normaliserCleAgent(cle), cle);
    // Et celle de la BASE. C'est elle qui remonte de `ai_model_overrides`
    // et de `ai_agent_settings` : si `normaliserCleAgent` ne la
    // reconnaissait pas, la surcharge serait lue puis jetée, en
    // silence, du bon côté par accident.
    assert.equal(
      normaliserCleAgent(CLE_BASE[cle]),
      cle,
      `« ${CLE_BASE[cle]} » (graphie SQL de ${cle}) n'est pas réconcilié par le routeur`,
    );
  }
});

test("la dernière migration accepte exactement les treize répondeurs et le non-répondeur", () => {
  // On balaie les migrations et on garde la DERNIÈRE définition, dans
  // l'ordre des numéros : lire 0072 en dur certifierait une liste
  // périmée depuis 0082.
  const dossier = join(racineDepot, "supabase", "migrations");
  let declares: string[] | null = null;
  let fichier = "";
  for (const nom of readdirSync(dossier).filter((n) => n.endsWith(".sql")).sort()) {
    const corps =
      /create or replace function public\.ai_is_supported_agent[\s\S]*?select p_agent in \(([\s\S]*?)\);/.exec(
        readFileSync(join(dossier, nom), "utf8"),
      );
    if (corps === null) continue;
    declares = [...corps[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    fichier = nom;
  }

  assert.ok(declares, "aucune migration ne définit `ai_is_supported_agent`");

  // ══════════════════════════════════════════════════════════════════
  // §11Z — CE QUE LA BASE ACCEPTE N'EST PLUS « LES AGENTS CONSTRUITS »
  // ══════════════════════════════════════════════════════════════════
  //
  // L'égalité portait sur `AGENTS_CONSTRUITS` seul, et 0088 l'a rendue
  // fausse en y ajoutant `classification` — qui ne peut PAS être un
  // agent construit (il n'a ni mission, ni limites, ni droits, et son
  // fichier s'interdit d'en avoir) tout en devant être accepté par la
  // base, puisqu'il DÉPENSE et qu'on doit pouvoir plafonner sa dépense.
  //
  // La liste juste est donc l'union des deux catégories qui existent en
  // base : les répondeurs ET les consommateurs non répondants. On garde
  // une ÉGALITÉ et non une inclusion — une inclusion laisserait passer
  // un nom accepté par la base et inconnu du code, ce qui est
  // exactement la moitié du contrat que ce test existe pour tenir.
  const attendus = new Set([
    ...AGENTS_CONSTRUITS.map((cle) => CLE_BASE[cle]),
    ...AGENTS_NON_REPONDANTS.map((e) => e.cle),
  ]);
  assert.deepEqual(
    new Set(declares),
    attendus,
    `${fichier} et le code ne désignent plus les mêmes agents`,
  );

  // ET LA MIGRATION LAISSE LES AGENTS SANS DONNÉES DEHORS. Cette
  // assertion ne vérifie rien tant que la liste est vide, et on la
  // garde pour cela même : c'est celle qui aurait attrapé §11Z le
  // premier jour, quand `classification` était déclaré indisponible
  // dans le code et accepté par la migration. La contradiction a coûté
  // une catégorie entière à démêler ; elle ne doit pas se reproduire en
  // silence.
  for (const entree of AGENTS_SANS_DONNEES) {
    assert.ok(
      !declares.includes(entree.cle),
      `« ${entree.cle} » est déclaré sans données et pourtant accepté par ${fichier}`,
    );
  }
});

// ==================================================================
// 3. LES DEUX LISTES NE SE CONTREDISENT PAS
// ==================================================================

test("chacun des quatorze est dans exactement une des trois catégories", () => {
  // ══════════════════════════════════════════════════════════════════
  // §11Z — DEUX CATÉGORIES SONT DEVENUES TROIS, ET CE N'EST PAS UN
  // ASSOUPLISSEMENT
  // ══════════════════════════════════════════════════════════════════
  //
  // L'invariant était « construit XOR sans données ». Il tenait tant
  // qu'un agent était soit un répondeur, soit rien. `classification`
  // n'est ni l'un ni l'autre : il consomme des jetons à chaque question
  // sans jamais répondre. Il ne pouvait donc satisfaire aucune des deux
  // listes, et l'invariant était devenu INSATISFIABLE — aucune
  // intégration ne pouvait rendre la suite verte.
  //
  // La règle reste aussi stricte : EXACTEMENT UNE case, jamais zéro,
  // jamais deux. Ce qui change est le nombre de cases, pas la rigueur
  // du compte. Un agent dans zéro case est un agent qui existe à
  // moitié ; dans deux, c'est l'écran consulté qui décide de ce qu'il
  // est.
  for (const cle of AGENTS_MODELE) {
    const cases = [
      estAgentConstruit(cle) ? "construit" : null,
      estAgentNonRepondant(cle) ? "non répondant" : null,
      estAgentSansDonnees(cle) ? "sans données" : null,
    ].filter((x) => x !== null);
    assert.equal(
      cases.length,
      1,
      cases.length === 0
        ? `« ${cle} » n'est dans aucune des trois catégories : les quatorze agents de la spec ` +
            "p. 5 doivent tous être quelque part"
        : `« ${cle} » est à la fois ${cases.join(" et ")} : l'écran consulté déciderait de ce ` +
            "qu'il est",
    );
  }
});

test("un agent non répondant n'a ni mots-clés, ni plan, ni outil", () => {
  // ══════════════════════════════════════════════════════════════════
  // LA TROISIÈME CATÉGORIE EST UNE INTERDICTION, PAS UN LAISSEZ-PASSER
  // ══════════════════════════════════════════════════════════════════
  //
  // Sans ce test, la catégorie serait une porte de sortie : il
  // suffirait d'y ranger un agent pour échapper à tout ce que les
  // douze autres doivent tenir. Elle doit au contraire coûter PLUS
  // cher, parce que le seul symptôme d'un non-répondeur qui se met à
  // répondre est une réponse un peu creuse — rien ne casse, rien
  // n'alerte, et l'utilisateur croit avoir consulté un spécialiste.
  //
  // Les trois interdits correspondent aux trois façons dont un agent
  // peut se mettre à répondre : être aiguillé (mots-clés), recevoir des
  // données (plan de contexte), agir (outil au registre).
  for (const entree of AGENTS_NON_REPONDANTS) {
    assert.ok(
      (AGENTS_MODELE as readonly string[]).includes(entree.cle),
      `« ${entree.cle} » n'est pas un agent de la spec`,
    );
    assert.ok(entree.libelle.length > 0, `« ${entree.cle} » n'a pas de nom français`);
    assert.ok(
      entree.pourquoiEnBase.length > 80,
      `« ${entree.cle} » ne dit pas pourquoi la base accepte son nom alors qu'il ne répond pas`,
    );
    assert.ok(
      entree.depenseDans.length > 0,
      `« ${entree.cle} » ne dit pas où il dépense : une dépense qu'on ne situe pas ne se ` +
        "réduit pas",
    );

    // 1. AUCUNE DÉFINITION, DONC AUCUN MOT-CLÉ. Il n'est pas dans
    //    `DEFINITIONS`, donc `reglesActives()` ne le rend jamais.
    assert.equal(
      estAgentConstruit(entree.cle),
      false,
      `« ${entree.cle} » a une définition d'agent : il est devenu joignable`,
    );

    // 2. AUCUN PLAN DE CONTEXTE. Un plan ferait sortir des données de
    //    l'entreprise à chaque appel, pour un agent qui n'a rien à en
    //    faire — et le coût serait payé sans qu'aucune réponse ne soit
    //    rendue.
    assert.ok(
      !(AGENTS_AVEC_PLAN as readonly string[]).includes(entree.cle),
      `« ${entree.cle} » a un plan de contexte : on lirait des sources pour un agent qui ne ` +
        "répond à personne",
    );

    // 3. AUCUN OUTIL AU REGISTRE. C'est la garde la plus concrète :
    //    un outil sous son nom le rendrait capable de lire une table
    //    métier, donc de produire un chiffre.
    for (const outil of registreOutils().tous()) {
      assert.notEqual(
        outil.agent,
        entree.cle,
        `« ${outil.nom} » est déclaré sous « ${entree.cle} », qui ne répond à personne`,
      );
    }
  }
});

test("les quatre déclarés sans données portent un nom français et un motif mesuré", () => {
  for (const entree of AGENTS_SANS_DONNEES) {
    assert.ok(
      (AGENTS_MODELE as readonly string[]).includes(entree.cle),
      `« ${entree.cle} » n'est pas un agent de la spec`,
    );
    assert.ok(entree.libelle.length > 0);
    assert.ok(entree.aLivrerDabord.every((l) => l.length > 20));
  }
});

// ==================================================================
// 4. L'ACCORD AVEC LE VOCABULAIRE DES ÉCRANS
// ==================================================================
//
// `lib/ai/types.ts` importe `@/components/ui`, un alias que Node ignore
// : on emploie le crochet déjà écrit pour ce cas
// (`runtime/_test/alias.mjs`) et un import DYNAMIQUE, qui seul
// s'exécute après l'installation du crochet.

register("../_test/alias.mjs", import.meta.url);

const { AGENTS: AGENTS_ECRAN, AGENT_LABELS, AGENT_MISSIONS, AGENT_REQUIRED_PERMISSIONS } =
  await import("../../types.ts");

test("l'écran de réglages connaît exactement les agents que le runtime construit", () => {
  assert.deepEqual(
    [...AGENTS_ECRAN].toSorted(),
    AGENTS_CONSTRUITS.map((cle) => CLE_BASE[cle]).toSorted(),
    "un agent réglable qui n'existe pas, ou un agent qui existe et qu'on ne peut pas régler",
  );
});

/**
 * LA SEULE DIVERGENCE TOLÉRÉE, ET ELLE EST ANTÉRIEURE À §11Y.
 *
 * Le runtime écrit « Devis et prix » depuis la Phase 11V ; les écrans
 * écrivent « Devis & prix » — dans `AGENT_LABELS` et dans
 * `LIBELLES_AGENT`, qu'un autre test tient déjà ensemble. C'est une
 * esperluette, pas un désaccord de sens, et l'aligner supposerait de
 * toucher soit une définition d'agent que ce chantier a déplacée SANS
 * CHANGER UN MOT, soit deux tables d'écran et le test qui les lie.
 *
 * On la NOMME plutôt que de la laisser passer par une comparaison
 * souple : une règle qui normaliserait « & » en « et » autoriserait la
 * prochaine divergence, celle qui ne serait pas cosmétique.
 */
const LIBELLES_TOLERES = new Map<string, string>([["quote_pricing", "Devis & prix"]]);

test("le nom et la mission affichés sont ceux que l'agent se donne", () => {
  // Deux formulations pour le même agent selon l'écran, c'est un
  // utilisateur qui croit qu'il y en a deux — et c'est arrivé assez
  // souvent dans ce produit pour valoir un test.
  for (const cle of AGENTS_CONSTRUITS) {
    const sql = CLE_BASE[cle];
    assert.equal(
      AGENT_LABELS[sql],
      LIBELLES_TOLERES.get(sql) ?? DEFINITIONS[cle].libelle,
      `libellé divergent pour « ${cle} »`,
    );
    assert.equal(AGENT_MISSIONS[sql], DEFINITIONS[cle].mission, `mission divergente pour « ${cle} »`);
  }
});

test("les droits annoncés à l'écran sont ceux que l'agent attend", () => {
  // L'écart serait pire qu'esthétique : l'écran affiche « droit
  // manquant — l'agent rendra une réponse amputée ». Le dire à tort
  // fait chercher un droit inutile ; ne pas le dire fait prendre une
  // réponse amputée pour une réponse complète.
  for (const cle of AGENTS_CONSTRUITS) {
    assert.deepEqual(
      [...AGENT_REQUIRED_PERMISSIONS[CLE_BASE[cle]]].toSorted(),
      [...DEFINITIONS[cle].droitsAttendus].toSorted(),
      `droits divergents pour « ${cle} »`,
    );
  }
});
