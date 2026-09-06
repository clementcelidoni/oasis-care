import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRAINTES_AGENT_SUPPORTE,
  estAgentInconnuDeLaBase,
  messageEchecReglage,
} from "./reglagesMessages.ts";
import { AGENTS } from "./types.ts";

/**
 * §11Y — LE DÉCALAGE ENTRE LE CODE ET LA BASE DOIT SE NOMMER.
 *
 * Ce fichier tient une branche qui se déclenche sur du texte écrit par
 * PostgreSQL. Une correspondance de sous-chaîne jamais rejouée contre
 * la vraie chaîne est une branche morte qui ressemble à un garde-fou —
 * donc le message ci-dessous n'est pas plausible, il est RELEVÉ.
 */

/**
 * Le message exact rendu par la production, capturé le 2026-09-05 dans
 * une transaction annulée :
 *
 *   begin;
 *   insert into public.ai_agent_settings
 *     (organization_id, agent, enabled, autonomy_level)
 *   values (<org>, 'nursery', true, 2);
 *   rollback;
 *
 *   → 23514 | new row for relation "ai_agent_settings"
 *            violates check constraint "ai_agent_settings_agent_check"
 *
 * Il ne contient PAS « ai_is_supported_agent » : c'est précisément
 * pourquoi la détection ne peut pas se contenter du nom de la fonction.
 */
const MESSAGE_PRODUCTION =
  'new row for relation "ai_agent_settings" violates check constraint "ai_agent_settings_agent_check"';

test("le message relevé en production est bien reconnu", () => {
  assert.ok(
    estAgentInconnuDeLaBase(MESSAGE_PRODUCTION),
    "la chaîne exacte rendue par la base n'est pas détectée : la branche est morte",
  );

  const rendu = messageEchecReglage(MESSAGE_PRODUCTION);
  assert.notEqual(
    rendu,
    MESSAGE_PRODUCTION,
    "le message brut de PostgreSQL est montré tel quel à l'utilisateur",
  );
  assert.ok(rendu.includes("0082"), "le message ne nomme pas la mise à jour qui manque");
  assert.ok(
    !rendu.includes("check constraint"),
    "le vocabulaire de la base a fui jusqu'à l'écran",
  );
});

test("les cinq contraintes de la base sont toutes couvertes", () => {
  // Elles ont été relevées dans `pg_constraint`, pas devinées — et
  // `ai_action_approvals` ne suit pas la règle de nommage des quatre
  // autres. Ce test vérifie que la détection les attrape TOUTES, y
  // compris celle qui sort du moule.
  for (const contrainte of CONTRAINTES_AGENT_SUPPORTE) {
    const message = `new row for relation "x" violates check constraint "${contrainte}"`;
    assert.ok(
      estAgentInconnuDeLaBase(message),
      `la contrainte « ${contrainte} » n'est pas reconnue`,
    );
  }
});

test("les neuf agents ajoutés après 0072 sont ceux qui peuvent déclencher ce message", () => {
  // Un rappel exécutable de ce que la branche protège : 0072 acceptait
  // quatre agents, l'écran en affiche treize. Si cette liste tombe à
  // quatre, la branche n'a plus de raison d'être et doit partir avec
  // elle ; si elle grandit, une migration doit suivre.
  //
  // §11Z — TROIS DE PLUS, ET LEUR MIGRATION EXISTE. `sales`, `market`
  // et `risk` sont acceptés par 0088 : un réglage d'autonomie posé sur
  // eux ne se fera plus refuser par la contrainte. Tant que 0088 n'est
  // pas appliquée sur une base donnée, en revanche, c'est exactement ce
  // message de décalage qui doit sortir — d'où leur présence ici.
  //
  // `classification` N'Y EST PAS, et ce n'est pas un oubli : la base
  // accepte son nom depuis 0088, mais il n'apparaît sur aucun écran de
  // réglage puisqu'il ne répond à personne. Voir
  // `runtime/agents/nonRepondants.ts`.
  const DE_0072 = ["executive", "finance", "billing", "quote_pricing"];
  const ajoutes = AGENTS.filter((a) => !DE_0072.includes(a));
  assert.deepEqual(
    [...ajoutes],
    [
      "sales",
      "operations",
      "planning",
      "procurement",
      "nursery",
      "fleet",
      "customer",
      "market",
      "risk",
    ],
    "la liste des agents affichés a changé sans que le message de décalage suive",
  );
});

test("un droit manquant reste un droit manquant, et passe avant", () => {
  // L'ordre des branches est la seule chose qui distingue « demandez à
  // un administrateur » de « votre base est en retard ». Un message qui
  // contiendrait les deux vocabulaires doit rendre le premier : c'est
  // le seul des deux que l'utilisateur peut résoudre lui-même.
  const rls =
    'new row violates row-level security policy for table "ai_agent_settings" check constraint "ai_agent_settings_agent_check"';
  assert.ok(
    messageEchecReglage(rls).includes("administrateur"),
    "un refus de droit a été présenté comme un problème de déploiement",
  );
});

test("un message inconnu n'est ni perdu ni maquillé", () => {
  // Le repli rend la chaîne brute. C'est délibéré : inventer une
  // formule rassurante pour une erreur qu'on n'a pas prévue est pire
  // que de montrer le texte technique, parce que personne ne saurait
  // plus quoi chercher.
  assert.equal(messageEchecReglage("deadlock detected"), "deadlock detected");
  assert.equal(messageEchecReglage(""), "Le réglage n'a pas pu être enregistré.");
  assert.equal(estAgentInconnuDeLaBase(""), false);
});
