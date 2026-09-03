import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CONFIANCES, MOTIFS_PANNE } from "./types.ts";
import { AGENTS_MODELE } from "../model/types.ts";
import { AGENTS_AVEC_PLAN } from "./context.ts";
import { RISQUE_ELEVE_AU_DELA_DE_CENTS } from "./actionEngine.ts";

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

test("les quatre agents de 0072 sont ceux qui ont un plan", () => {
  const socle = lire(join(racineDepot, "supabase", "migrations", "0072_phase11v_socle.sql"));
  // `ai_is_supported_agent` est la liste fermée côté base.
  for (const attendu of ["executive", "finance", "billing", "quote_pricing"]) {
    assert.ok(socle.includes(`'${attendu}'`), `${attendu} doit figurer dans 0072`);
  }
  assert.deepEqual(
    [...AGENTS_AVEC_PLAN].sort(),
    ["billing", "executive", "finance", "quotePricing"],
    "un plan pour un agent que la base refuse produirait un contexte que personne ne peut employer",
  );
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
