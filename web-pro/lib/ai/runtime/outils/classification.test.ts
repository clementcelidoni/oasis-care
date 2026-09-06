import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OUTILS_CLASSIFICATION, OUTILS_REFUSES } from "./classification.ts";
import { registreOutils } from "../tools.ts";

/**
 * §11Z — LE TEST QUI GARDE UNE ABSENCE.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON N'ÉPROUVE PAS UN OUTIL : ON ÉPROUVE QU'IL N'Y EN A PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Une absence délibérée ne se défend pas toute seule. Elle se relit
 * comme un oubli, et le développeur suivant la comble de bonne foi.
 * Le fichier voisin dit POURQUOI l'étape de Classement n'a aucun outil ;
 * celui-ci fait en sorte que la réponse tienne dans six mois, quand plus
 * personne ne se souviendra de l'avoir lue.
 *
 * LE COÛT D'UN OUTIL POUR CETTE ÉTAPE, RAPPELÉ ICI PARCE QUE C'EST LUI
 * QU'ON DÉFEND : le registre distribue les outils par le champ `agent`.
 * Un outil rangé sous « classification » ne serait offert à aucun des
 * treize répondeurs ; il ne servirait qu'à un quatorzième, qu'il
 * faudrait rendre appelable. Et un agent appelable répond — donc il
 * devient une quatorzième source de vérité posée par-dessus les treize
 * autres, sur des questions qui ne sont pas les siennes.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n");
}

test("la liste est vide, et elle est gelée", () => {
  assert.deepEqual([...OUTILS_CLASSIFICATION], []);
  assert.ok(Object.isFrozen(OUTILS_CLASSIFICATION), "une liste vide qu'on peut remplir n'est rien");
});

test("AUCUN outil du registre n'appartient à l'étape de Classement", () => {
  // LA VRAIE ASSERTION DE CE FICHIER. Elle ne porte pas sur ce qu'on a
  // écrit — on n'a rien écrit — mais sur ce que quelqu'un d'autre
  // pourrait écrire dans le catalogue partagé, à un endroit d'où
  // personne ne relira ce raisonnement.
  const usurpateurs = registreOutils()
    .tous()
    .filter((outil) => outil.agent === "classification");

  assert.deepEqual(
    usurpateurs.map((o) => o.nom),
    [],
    "l'étape de Classement a reçu un outil : elle est devenue un quatorzième répondeur, et " +
      "elle répondra sur des questions qui appartiennent aux treize autres",
  );
});

test("l'étape ne reçoit pas non plus d'outil par la bande, en famille « moteur »", () => {
  // Un outil d'ACTION rangé ici serait pire encore qu'un outil de
  // lecture : il mettrait une écriture entre les mains d'une étape que
  // rien ne surveille, puisqu'elle n'a ni limites conversationnelles ni
  // droits attendus.
  for (const outil of registreOutils().tous()) {
    assert.notEqual(
      outil.agent,
      "classification",
      `« ${outil.nom} » (${outil.famille}) est rangé sous l'étape de Classement`,
    );
  }
});

test("aucune migration ne lui écrit de fonction", () => {
  // 0088 ouvre son NOM dans `ai_is_supported_agent` — ce qui rend sa
  // dépense plafonnable — et lui écrit ZÉRO fonction. Trois fonctions
  // pour quatre agents, et c'est délibéré.
  const sql = migrations();
  assert.match(sql, /'classification'/, "son nom doit être accepté par la base");
  assert.ok(
    !/create or replace function public\.ai_(classif|classement)/i.test(sql),
    "une fonction de classement donnerait une SOURCE à l'étape, donc une réponse",
  );
});

test("les trois mauvaises idées sont écrites, avec leur motif", () => {
  // Elles coûtent dix lignes et font gagner la demi-heure pendant
  // laquelle quelqu'un les aurait redécouvertes — puis implémentées.
  assert.deepEqual(Object.keys(OUTILS_REFUSES).sort(), [
    "classifyBatch",
    "listUnclassifiedActivities",
    "routeQuestion",
  ]);
  for (const [nom, motif] of Object.entries(OUTILS_REFUSES)) {
    assert.ok(motif.length > 80, `« ${nom} » est refusé sans motif lisible`);
  }
  // Le motif du premier doit renvoyer au code qui fait DÉJÀ le travail :
  // un refus sans « c'est déjà là » se lit comme un refus de principe.
  assert.match(OUTILS_REFUSES.classifyBatch, /preprocessing\.ts/);
  assert.match(OUTILS_REFUSES.routeQuestion, /synchrone sans le moindre port/);
});

test("le classement en lots existe bel et bien, et il est déterministe d'abord", () => {
  // On ne se contente pas d'affirmer que `preprocessing.ts` fait le
  // travail : on le vérifie. Un refus adossé à un fichier qui aurait
  // changé de nom serait un refus adossé à rien.
  const source = readFileSync(
    join(racineDepot, "web-pro", "lib", "ai", "runtime", "preprocessing.ts"),
    "utf8",
  );
  assert.match(source, /ServicePreTraitement/);
  assert.match(source, /TAILLE_LOT/);
  assert.ok(
    /d[ée]terministe/i.test(source),
    "la règle « pas de modèle quand une règle suffit » doit être portée par le code, pas par " +
      "un commentaire de ce test",
  );
});
