import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CONFIANCES, MOTIFS_PANNE } from "./types.ts";
import { AGENTS_MODELE } from "../model/types.ts";
import { AGENTS_AVEC_PLAN, PLANS_LISIBLES } from "./context.ts";
import { AGENTS_CONSTRUITS, CLE_BASE, DEFINITIONS } from "./agents/index.ts";
import { RISQUE_ELEVE_AU_DELA_DE_CENTS } from "./actionEngine.ts";
// `agents.ts` importe `@/lib/ai/proposals`, un alias que Node ignore :
// on emploie le crochet déjà écrit pour ce cas, et l'import doit être
// DYNAMIQUE (un import statique serait hissé avant le `register()`).
register("./_test/alias.mjs", import.meta.url);
const { SPECIALISTES } = await import("./agents.ts");
import { sourcesDe } from "./definitions.ts";

/**
 * §11V — LES VOCABULAIRES RECOPIÉS, ET CE QUI LES TIENT D'ACCORD.
 *
 * Trois listes de ce dossier recopient une liste écrite ailleurs. Chaque
 * recopie est un désaccord possible, et un désaccord entre deux fichiers
 * corrects vus séparément est précisément ce qu'aucun test unitaire
 * n'attrape.
 *
 *   • `CONFIANCES` recopie `CONFIDENCES` de `lib/ai/types.ts`, qu'on ne
 *     peut pas importer ici : il tire `@/components/ui` pour une
 *     histoire de couleurs, ce qui ferait entrer React dans un test de
 *     plomberie — et l'alias `@/` n'existe pas sous `node --test`.
 *
 *   • `MOTIFS_PANNE` recopie le `check (… in (…))` de
 *     `ai_usage_events.failure_reason` (migration 0076). Un motif hors
 *     liste ferait échouer l'insertion du journal AU MOMENT PRÉCIS où
 *     quelque chose va mal.
 *
 *   • `AGENTS_AVEC_PLAN` doit désigner des agents que le routeur
 *     connaît, sans quoi le contexte serait construit pour un agent
 *     dont personne ne sait quel modèle il emploie.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineWeb = join(ici, "..", "..", "..");
const racineDepot = join(racineWeb, "..");

function lire(chemin: string): string {
  return readFileSync(chemin, "utf8");
}

test("CONFIANCES dit exactement la même chose que CONFIDENCES de lib/ai/types.ts", () => {
  const source = lire(join(racineWeb, "lib", "ai", "types.ts"));
  const trouve = /export const CONFIDENCES = \[([^\]]+)\]/.exec(source);
  assert.ok(trouve, "CONFIDENCES est introuvable : le repérage doit être corrigé, pas contourné");

  const original = [...trouve[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...CONFIANCES],
    original,
    "les deux vocabulaires de confiance ont divergé : une valeur connue d'un côté et pas de " +
      "l'autre retombe sur « insufficient_data », et l'escalade cesse alors de se déclencher.",
  );
});

test("MOTIFS_PANNE dit exactement ce que la contrainte de 0076 accepte", () => {
  const migration = lire(join(racineDepot, "supabase", "migrations", "0076_architecture_ia.sql"));
  const trouve = /failure_reason text check \(failure_reason in \(([\s\S]*?)\)\)/.exec(migration);
  assert.ok(trouve, "la contrainte de failure_reason est introuvable dans 0076");

  const acceptes = [...trouve[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    [...MOTIFS_PANNE].sort(),
    acceptes,
    "un motif que la base refuse ferait perdre la ligne de journal, donc la dépense",
  );
});

test("chaque agent qui a un plan de contexte est connu du routeur de modèles", () => {
  for (const agent of AGENTS_AVEC_PLAN) {
    assert.ok(
      (AGENTS_MODELE as readonly string[]).includes(agent),
      `« ${agent} » a un plan de contexte mais n'est pas au catalogue du routeur : ` +
        "on saurait quoi lui donner à lire, pas avec quel modèle le faire réfléchir.",
    );
  }
});

test("tout agent qui a un plan est un agent que la base accepte", () => {
  // ══════════════════════════════════════════════════════════════
  // §11Y — CE TEST A CHANGÉ DE FORME, ET L'ANCIENNE ÉTAIT DEVENUE
  // FAUSSE DANS LES DEUX SENS
  // ══════════════════════════════════════════════════════════════
  //
  // Il exigeait « les agents qui ont un plan sont EXACTEMENT les quatre
  // de 0072 ». Depuis 0082 la base en accepte dix, et six d'entre eux
  // n'ont pas encore de plan : l'égalité stricte serait rouge alors que
  // rien n'est cassé.
  //
  // Ce qui reste vrai, et qui est le vrai danger, c'est UN SEUL SENS :
  // un plan pour un agent que la base REFUSE produirait un contexte que
  // personne ne peut employer — on paierait la lecture des sources, et
  // la recommandation serait rejetée par la contrainte `check` au
  // moment de l'écrire.
  //
  // L'inverse — un agent accepté sans plan — est l'état normal d'un
  // gabarit : il répond « je n'ai rien lu », ce qui est vrai, et son
  // auteur lui ajoutera sa clé dans `PLANS` le jour où il l'achèvera.
  const dossier = join(racineDepot, "supabase", "migrations");
  let acceptes: string[] = [];
  for (const nom of readdirSync(dossier).filter((n) => n.endsWith(".sql")).sort()) {
    const corps =
      /create or replace function public\.ai_is_supported_agent[\s\S]*?select p_agent in \(([\s\S]*?)\);/.exec(
        lire(join(dossier, nom)),
      );
    if (corps === null) continue;
    acceptes = [...corps[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  assert.ok(acceptes.length > 0, "`ai_is_supported_agent` n'est définie dans aucune migration");

  for (const agent of AGENTS_AVEC_PLAN) {
    const graphieSql = CLE_BASE[agent as keyof typeof CLE_BASE] ?? agent;
    assert.ok(
      acceptes.includes(graphieSql),
      `« ${agent} » a un plan de contexte et la base refuse son nom : ` +
        "on lirait ses sources pour une recommandation que la contrainte rejettera.",
    );
  }

  // ══════════════════════════════════════════════════════════════
  // CE QUI MANQUE EST DÉRIVÉ, PLUS RECOPIÉ
  // ══════════════════════════════════════════════════════════════
  //
  // C'était une liste écrite à la main — « billing, executive, finance,
  // quotePricing » — sous prétexte qu'un plan qui change est un
  // changement de coût par appel. L'intention est juste ; le moyen ne
  // l'était pas. Chaque agent achevé la faisait tomber, sur un fichier
  // partagé, en conflit avec les autres constructeurs, et pour une
  // raison qui n'était pas un défaut : un plan de PLUS était le
  // résultat attendu du chantier.
  //
  // La règle qui vaut vraiment la peine d'être tenue est celle-ci : UN
  // AGENT JOIGNABLE A UN PLAN. Un agent qu'on peut atteindre et dont le
  // contexte ne pré-lit rien part au modèle sans savoir si ses sources
  // ont échoué ou si elles sont vides — et `contexte.vide` ne se
  // déclenche même pas, puisqu'il vaut `requisTotal > 0 && requisLu === 0`.
  // Un agent sans plan n'est jamais « vide » ; il est simplement muet
  // avec assurance.
  //
  // Le coût reste surveillé, mais par la bonne mesure : le nombre de
  // sources REQUISES par agent, plafonné ci-dessous. C'est lui qui se
  // paie à chaque appel, pas le fait d'avoir une clé dans `PLANS`.
  const joignables = AGENTS_CONSTRUITS.filter((a) => DEFINITIONS[a].aCompleter !== true);
  for (const agent of joignables) {
    assert.ok(
      AGENTS_AVEC_PLAN.includes(agent),
      `« ${agent} » est joignable et n'a aucun plan de contexte : il ne saura pas distinguer ` +
        "« ma source a échoué » de « il n'y a rien », et le garde-fou « contexte vide » ne se " +
        "déclenchera pas non plus (il exige au moins une source requise).",
    );
  }

  // ET LE COÛT, MESURÉ LÀ OÙ IL SE PAIE. Deux sources requises par agent
  // au plus : au-delà, chaque question ferait sortir de l'entreprise
  // plus de données qu'un spécialiste n'en lit pour répondre, et le
  // plafond de la p. 20 (« minimisation ») deviendrait décoratif.
  for (const agent of AGENTS_AVEC_PLAN) {
    const requises = (PLANS_LISIBLES[agent] ?? []).filter((e) => e.requis).length;
    assert.ok(
      requises <= 2,
      `« ${agent} » pré-lit ${requises} sources requises à chaque appel : c'est un coût par ` +
        "question, et la minimisation de la p. 20 devient décorative au-delà de deux",
    );
  }
});

/**
 * LE SEUIL DE RISQUE DE LA PAGE 15-16, DES DEUX CÔTÉS.
 *
 * `RISQUE_ELEVE_AU_DELA_DE_CENTS` classe l'action côté serveur ;
 * `ai_seuil_risque_eleve_cents()` (0076 § 6 bis) garde la porte de
 * l'autopilote. Deux valeurs qui divergeraient donneraient un écran
 * annonçant « confirmation requise » sur une action que la base laisse
 * partir seule — ou l'inverse, tout aussi déroutant.
 *
 * C'est exactement le désaccord qui a existé : la fonction Edge
 * calculait le relèvement à 20 000 € et ne s'en servait que comme
 * étiquette, pendant que les douze conditions de 0072 ne regardaient
 * aucun niveau de risque.
 */
test("le seuil de risque élevé vaut la même chose en TypeScript et en SQL", () => {
  const migration = lire(join(racineDepot, "supabase", "migrations", "0076_architecture_ia.sql"));
  const trouve = /ai_seuil_risque_eleve_cents\(\)[\s\S]{0,400}?select\s+(\d+)::bigint/.exec(migration);

  assert.ok(trouve !== null, "0076 doit définir `ai_seuil_risque_eleve_cents()`");
  assert.equal(
    Number(trouve[1]),
    RISQUE_ELEVE_AU_DELA_DE_CENTS,
    "le seuil du serveur et celui de la base doivent dire le même montant",
  );

  // ET LA CONDITION DOIT EXISTER. Une constante posée mais jamais lue
  // serait la pire des deux situations : elle donnerait l'impression
  // que la règle est en base.
  assert.ok(
    migration.includes("'risque_confirmable'"),
    "la treizième condition d'`ai_may_autoexecute` doit être présente",
  );
  assert.ok(
    /c_conditions constant int := 13;/.test(migration),
    "le compteur de conditions doit suivre : sinon la fonction refuse tout",
  );
});

/**
 * TOUTE SURFACE QUI APPELLE UN MODÈLE ÉCRIT AU GRAND LIVRE.
 *
 * `usage.ts` l'annonce en majuscules — « CHAQUE APPEL ÉCRIT UN
 * ai_usage_event. SANS EXCEPTION » — et c'était faux : la fonction Edge
 * `oasis-pro-ai`, seule surface IA réellement câblée sur un écran,
 * n'inscrivait rien. L'onglet des coûts affichait donc une dépense
 * proche de zéro pendant que la facture montait, et les plafonds de
 * `ai_cost_limits` ne coupaient rien.
 *
 * Ce test relit la fonction Edge. Il ne prouve pas que l'appel est au
 * bon endroit — aucun test statique ne le peut — mais il rend le
 * débranchement VISIBLE, ce qui est la seule chose que son absence
 * n'était pas.
 */
test("la fonction Edge inscrit sa consommation au grand livre et respecte les plafonds", () => {
  const edge = lire(
    join(racineDepot, "supabase", "functions", "oasis-pro-ai", "index.ts"),
  );

  assert.ok(
    edge.includes("ai_record_usage_event"),
    "la fonction Edge doit journaliser ses appels : sinon l'écran des coûts est faux dans le sens rassurant",
  );
  assert.ok(
    edge.includes("ai_cost_budget_remaining"),
    "elle doit aussi consulter le plafond AVANT d'appeler : un plafond qui ne coupe rien est un réglage qui ment",
  );
  assert.ok(
    edge.includes("edge-assistant"),
    "elle doit s'imputer sous un nom lisible dans la ventilation par agent",
  );
});

/**
 * LA DÉLÉGATION DE LA DIRECTION, ET CE QU'ELLE ENGAGE.
 *
 * `SPECIALISTES` est la liste des agents que la Direction peut
 * interroger (p. 9). Elle reste ÉCRITE et non dérivée, à dessein :
 * inscrire un agent engage une dépense sur chaque appel de la Direction
 * — `#empreinteAvecDelegations` construit le contexte de TOUS les
 * spécialistes pour couvrir l'entrée de cache, cache touché compris — et
 * une dépense se décide, elle ne s'hérite pas d'un drapeau.
 *
 * Ce test tient donc l'implication dans LE SEUL SENS qui protège.
 */
test("tout spécialiste de la Direction est un agent joignable qui a de quoi lire", () => {
  for (const specialiste of SPECIALISTES) {
    // 1. PAS UN GABARIT. La Direction paierait un raisonnement complet
    //    pour recevoir « je n'ai rien lu » — un brief plus cher et pas
    //    plus vrai.
    assert.notEqual(
      DEFINITIONS[specialiste].aCompleter,
      true,
      `« ${specialiste} » est un gabarit et la Direction peut le déléguer : elle paiera un ` +
        "appel de modèle pour un agent qui n'a rien à dire",
    );

    // 2. UN PLAN. C'est le critère que `runtime/agents.ts` s'est donné,
    //    et il n'est pas décoratif : sans plan, le contexte du
    //    spécialiste est vide, son empreinte ne couvre rien, et
    //    l'entrée de cache du brief cesserait d'être protégée par les
    //    données qui la produisent. C'est exactement le défaut que
    //    `#empreinteAvecDelegations` a été écrite pour réparer.
    assert.ok(
      AGENTS_AVEC_PLAN.includes(specialiste),
      `« ${specialiste} » est délégable sans plan de contexte : son empreinte ne couvrirait ` +
        "aucune donnée, et le brief de Direction serait resservi périmé",
    );

    // 3. UNE SOURCE À LUI. Un spécialiste qui n'a que les outils
    //    transverses ne dit rien que la Direction ne sache déjà.
    assert.ok(
      sourcesDe(specialiste).length > 0,
      `« ${specialiste} » n'a aucune source propre : la Direction se déléguerait à elle-même`,
    );
  }
});
