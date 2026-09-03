import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * §11V — LES INVARIANTS QUI TIENNENT DEUX SURFACES ENSEMBLE.
 *
 * ─── POURQUOI UN TEST QUI LIT DU CODE SOURCE ───
 *
 * Ce fichier ne teste aucune fonction. Il vérifie que deux morceaux du
 * produit écrits par deux personnes différentes disent la même chose.
 * C'est inhabituel, et c'est la seule forme de test qui pouvait
 * attraper les deux défauts qu'il ferme — parce qu'aucun des deux
 * n'était un bug dans une fonction : chacun était un DÉSACCORD entre
 * deux fichiers, tous deux corrects vus séparément.
 *
 *   1. L'ÉCRAN QUI NIE CE QUE LA FONCTION FAIT. Les deux écrans de
 *      réglage affirmaient « chaque action part d'un clic dans le
 *      centre de décision, et passe par une validation enregistrée » et
 *      « ce réglage enregistre une autorisation, il ne met rien en
 *      marche aujourd'hui ». La fonction Edge, elle, appelait
 *      `ai_may_autoexecute` puis exécutait sans approbation dès qu'un
 *      agent était au niveau 4. Le patron faisait les deux seuls gestes
 *      que l'écran propose — niveau 4, plafond relevé — après avoir lu
 *      deux fois qu'il n'armait rien.
 *
 *   2. LE OUI QUI NE PORTE PAS SUR L'ACTE QUI PART. La carte de
 *      décision envoyait trois champs cachés indépendants —
 *      `approvalId`, `actionId`, `actionType` — que la Server Action ne
 *      comparait jamais entre eux.
 *
 * ─── SI CE TEST DEVIENT GÊNANT ───
 *
 * Il ne demande pas de figer une phrase. Il demande que la phrase et la
 * branche de code bougent ENSEMBLE : neutraliser la branche autorise à
 * réécrire l'écran dans l'autre sens, et le test le dit lui-même.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineWeb = join(ici, "..", "..");
const racineDepot = join(racineWeb, "..");

function lire(chemin: string): string {
  return readFileSync(chemin, "utf8");
}

const edge = lire(join(racineDepot, "supabase", "functions", "oasis-pro-ai", "index.ts"));
const ecranAutomatisations = lire(
  join(racineWeb, "app", "(app)", "oasis-ai", "automatisations", "page.tsx"),
);
const ecranAgents = lire(join(racineWeb, "app", "(app)", "oasis-ai", "agents", "page.tsx"));
const moteur = lire(join(racineWeb, "lib", "ai", "engine.ts"));
const carteDecision = lire(
  join(racineWeb, "app", "(app)", "oasis-ai", "decisions", "DecisionCard.tsx"),
);

/**
 * La branche d'autopilote existe-t-elle vraiment dans la fonction Edge ?
 *
 * Deux marqueurs, et il faut les deux : consulter `ai_may_autoexecute`
 * ne prouve rien à soi seul (on pourrait la consulter pour l'afficher),
 * et exécuter avec la confirmation `"autopilot"` est le geste qui compte
 * — c'est celui qui n'écrit AUCUNE ligne dans `ai_action_approvals`.
 */
const autopiloteExiste =
  edge.includes("ai_may_autoexecute") && /executeAction\([\s\S]{0,400}?"autopilot"/.test(edge);

test("l'autopilote existe dans la fonction Edge — ce test suppose de le savoir", () => {
  // Ce n'est pas une exigence : c'est le constat dont dépendent les
  // deux suivants. S'il tombe un jour, c'est que quelqu'un a neutralisé
  // la branche, et les assertions ci-dessous basculent d'elles-mêmes.
  assert.equal(
    typeof autopiloteExiste,
    "boolean",
    "le repérage de la branche d'autopilote doit rendre un booléen",
  );
});

test("l'écran des automatisations ne nie pas l'autopilote qui existe", () => {
  const mensonges = [
    "chaque action part d'un clic dans le centre de décision",
    "elle ne déclenche rien par elle-même aujourd",
    "rien ne tourne encore tout seul",
  ];

  if (autopiloteExiste) {
    for (const phrase of mensonges) {
      assert.ok(
        !normalise(ecranAutomatisations).includes(normalise(phrase)),
        `L'écran des automatisations affirme « ${phrase} » alors que la fonction Edge ` +
          "exécute sans confirmation au niveau 4. Corrigez la phrase, ou neutralisez la branche.",
      );
    }
    assert.ok(
      normalise(ecranAutomatisations).includes(normalise("niveau 4")),
      "L'écran doit dire à quelle condition un automatisme part vraiment.",
    );
  } else {
    assert.ok(
      normalise(ecranAutomatisations).includes(normalise("ne déclenche rien")),
      "La branche d'autopilote a disparu : l'écran peut — et doit — le dire.",
    );
  }
});

test("la boîte de dialogue du niveau 4 ne promet pas l'inverse de ce qui se passe", () => {
  const mensonge = "il ne met rien en marche aujourd";
  if (autopiloteExiste) {
    assert.ok(
      !normalise(ecranAgents).includes(normalise(mensonge)),
      "La confirmation du niveau 4 affirme qu'elle n'arme rien, alors qu'elle arme " +
        "l'exécution sans confirmation depuis l'assistant.",
    );
    assert.ok(
      normalise(ecranAgents).includes(normalise("sans vous demander")),
      "La confirmation du niveau 4 doit dire que l'agent agira sans demander.",
    );
  }
});

/**
 * L'INVARIANT DE L'APPROVAL ENGINE : le oui porte sur l'acte qui part.
 *
 * On l'éprouve par la forme, faute de pouvoir jouer une Server Action
 * ici : le formulaire ne doit porter qu'un identifiant d'approbation, et
 * le serveur ne doit lire ni `actionId` ni `actionType` dans le
 * `FormData`.
 */
test("la validation d'une action ne se pilote que par l'identifiant d'approbation", () => {
  assert.ok(
    !/formData\.get\("actionId"\)/.test(moteur),
    "engine.ts lit encore un `actionId` dans le formulaire : l'action exécutée doit venir " +
      "de `ai_action_approvals.action_id`, jamais du navigateur.",
  );
  assert.ok(
    !/name="actionId"/.test(carteDecision) && !/actionId: pending\.actionId/.test(carteDecision),
    "DecisionCard.tsx renvoie encore un `actionId` au serveur : retirez-le, pour que " +
      "personne ne le recâble.",
  );
  assert.ok(
    !/actionType: pending\.actionType/.test(carteDecision),
    "DecisionCard.tsx renvoie encore un `actionType` au serveur.",
  );
});

test("le statut de l'action est relu APRÈS la réponse à l'approbation", () => {
  assert.ok(
    /actionRow\.status !== "approved"/.test(moteur),
    "engine.ts doit refuser d'exécuter une action qui n'est pas passée à « approved » : " +
      "c'est `ai_answer_approval` qui a vérifié le droit, pas nous.",
  );
});

/**
 * LE CANAL DE CONFIRMATION DE LA CONVERSATION.
 *
 * La fonction Edge implémente `POST { organizationId, confirm: {
 * approvalIds, ok } }` depuis le début, et rien ne l'émettait : « Prépare
 * les factures » écrivait des demandes d'approbation que personne ne
 * pouvait voir, et qui mouraient d'expiration au bout de vingt-quatre
 * heures.
 */
test("quelque chose émet enfin le second appel de confirmation", () => {
  assert.ok(
    /confirm:\s*\{/.test(lire(join(racineWeb, "lib", "ai", "actions.ts"))),
    "Aucun code du dépôt n'appelle le mode « confirm » de la fonction Edge : les actions " +
      "préparées depuis la conversation ne peuvent alors être validées nulle part.",
  );
  assert.ok(
    /handleConfirm/.test(edge),
    "La fonction Edge doit toujours servir le mode « confirm » que le web appelle.",
  );
});

/** Comparaison indifférente aux apostrophes typographiques et aux `&apos;` du JSX. */
function normalise(texte: string): string {
  return texte
    .replace(/&apos;|&#39;|’/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
