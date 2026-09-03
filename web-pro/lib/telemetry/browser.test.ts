import { test } from "node:test";
import assert from "node:assert/strict";
import { announceWebPresence, browserEnv, type PresenceEnv } from "./browser.ts";
import { INSTALL_ID_KEY, MIN_INTERVAL_MS, type WebStorage } from "./install.ts";
import { declareQuietly } from "./report.ts";
import { WEB_PLATFORM, WEB_PRESENCE_ENABLED, type WebPresence } from "./presence.ts";

/**
 * LA PROPRIÉTÉ QU'ON NE PEUT PAS SE PERMETTRE DE PERDRE : CETTE
 * DÉCLARATION NE DOIT JAMAIS REMONTER À L'APPELANT.
 *
 * L'appelant, c'est un `useEffect` posé dans la coquille de
 * l'application. Une promesse rejetée là devient une erreur non
 * capturée sur TOUTES les pages du produit — pour une information dont
 * personne n'attend rien.
 *
 * ÉTAT DES LIEUX, À LIRE AVANT LE RESTE : la collecte web est ÉTEINTE
 * (`WEB_PRESENCE_ENABLED`, dans `presence.ts`), parce que la fonction
 * `declare_web_presence` n'existe pas en base — 0077 ne connaît que
 * 'ios'. Le premier test ci-dessous décrit ce qui se passe
 * aujourd'hui : rien, y compris dans le `localStorage`. Tous les
 * suivants passent `true` en troisième argument et décrivent le jour où
 * on l'allumera — ils existent pour qu'on ne l'allume pas sur une
 * mécanique jamais vérifiée.
 */

function fakeStorage(initial: Record<string, string> = {}): WebStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const UUID = "3f6a1b2c-8d4e-4f10-9a7b-5c2e1d0f8a93";

function fakeEnv(at = 1_000): PresenceEnv & {
  session: ReturnType<typeof fakeStorage>;
  local: ReturnType<typeof fakeStorage>;
  at: number;
} {
  const env = {
    session: fakeStorage(),
    local: fakeStorage(),
    at,
    now: () => env.at,
    newId: () => UUID,
  };
  return env;
}

test("AUJOURD'HUI, PAR DÉFAUT, ON NE COLLECTE RIEN DU TOUT", async () => {
  // `declare_web_presence` n'existe pas en base, et tant qu'elle
  // n'existe pas la collecte web est ÉTEINTE — pas « silencieusement en
  // échec », éteinte. La différence est celle-ci : rien n'est écrit
  // dans le `localStorage` de l'utilisateur. Un identifiant
  // d'installation est une donnée personnelle ; en ranger un qui ne
  // répond à aucune question, en attendant une migration qui n'est pas
  // écrite, est exactement ce que la minimisation interdit.
  //
  // Les tests qui suivent passent `true` en troisième argument : ils
  // décrivent le comportement du jour où on l'allumera. Celui-ci décrit
  // le comportement d'aujourd'hui.
  const env = fakeEnv();
  let appels = 0;
  const declare = async () => {
    appels += 1;
  };

  await announceWebPresence(declare, env);
  await announceWebPresence(declare, env);

  assert.equal(WEB_PRESENCE_ENABLED, false, "la moitié base de données n'existe pas encore");
  assert.equal(appels, 0);
  assert.deepEqual(env.local.data, {}, "aucun identifiant rangé dans le navigateur");
  assert.deepEqual(env.session.data, {});
});

test("une seule annonce, quel que soit le nombre de navigations", async () => {
  const env = fakeEnv();
  const annonces: string[] = [];
  const declare = async (installId: string) => {
    annonces.push(installId);
  };

  await announceWebPresence(declare, env, true);
  await announceWebPresence(declare, env, true);
  await announceWebPresence(declare, env, true);

  assert.deepEqual(annonces, [UUID]);
  assert.equal(env.local.data[INSTALL_ID_KEY], UUID);
});

test("une heure plus tard, dans un onglet neuf, on annonce à nouveau", async () => {
  const env = fakeEnv();
  const annonces: string[] = [];
  const declare = async (installId: string) => {
    annonces.push(installId);
  };

  await announceWebPresence(declare, env, true);

  // Onglet neuf : `sessionStorage` vierge, `localStorage` conservé.
  const suivant: PresenceEnv = { ...env, session: fakeStorage() };
  env.at += MIN_INTERVAL_MS;
  await announceWebPresence(declare, suivant, true);

  // Deux annonces, et le MÊME identifiant : c'est bien une
  // installation revue, pas une deuxième installation.
  assert.deepEqual(annonces, [UUID, UUID]);
});

test("un échec de la base ne remonte jamais, et ne relance pas à chaque page", async () => {
  const env = fakeEnv();
  let tentatives = 0;
  const declare = async () => {
    tentatives += 1;
    throw new Error("PGRST202 : fonction declare_web_presence introuvable");
  };

  // Ne rejette pas.
  await assert.doesNotReject(() => announceWebPresence(declare, env, true));

  // Et surtout : la panne ne fait pas repartir une tentative à chaque
  // navigation. La marque est posée AVANT l'envoi, exprès — une
  // déclaration perdue par heure coûte moins qu'une requête par page
  // pendant toute la durée de la panne.
  await announceWebPresence(declare, env, true);
  await announceWebPresence(declare, env, true);
  assert.equal(tentatives, 1);
});

test("une déclaration qui rejette de façon inattendue reste silencieuse", async () => {
  const env = fakeEnv();
  // Pas une `Error` : une Server Action peut rejeter avec n'importe
  // quoi, y compris `undefined` après sérialisation.
  const declare = async () => {
    throw undefined;
  };
  await assert.doesNotReject(() => announceWebPresence(declare, env, true));
});

test("sans environnement navigateur, il ne se passe rien", async () => {
  let appels = 0;
  const declare = async () => {
    appels += 1;
  };

  // Rendu côté serveur : `browserEnv()` rend `null` et l'annonce sort
  // sans toucher à quoi que ce soit.
  await announceWebPresence(declare, null, true);
  assert.equal(appels, 0);
  assert.equal(browserEnv(), null, "il n'y a pas de `window` sous node:test");
});

test("sans identifiant stable, aucune annonce", async () => {
  const env = fakeEnv();
  let appels = 0;
  const declare = async () => {
    appels += 1;
  };

  // Navigateur sans aléa sûr : on préfère ne rien compter à compter
  // une installation neuve à chaque chargement.
  await announceWebPresence(declare, { ...env, newId: () => null }, true);
  assert.equal(appels, 0);
});

test("une déclaration incomplète n'atteint jamais la base", async () => {
  // Le pendant serveur : `declareQuietly` refuse avant d'envoyer. Une
  // version vide ou un identifiant qui ressemble à un nom de personne
  // serait refusé par 0077 ; dépenser une requête pour se le faire dire
  // n'apprend rien.
  const envoyees: WebPresence[] = [];
  const write = async (presence: WebPresence) => {
    envoyees.push(presence);
  };

  const complete: WebPresence = {
    installId: UUID,
    platform: WEB_PLATFORM,
    appVersion: "0.1.0",
    appBuild: null,
  };

  await declareQuietly(write, complete);
  await declareQuietly(write, { ...complete, appVersion: "  " });
  await declareQuietly(write, { ...complete, installId: "Chrome de Clément" });
  await declareQuietly(write, { ...complete, appBuild: "" });

  assert.deepEqual(envoyees, [complete]);
});

test("l'écriture qui lève est avalée par declareQuietly, pas par l'appelant", async () => {
  const write = async () => {
    throw new Error("réseau coupé");
  };

  await assert.doesNotReject(() =>
    declareQuietly(write, {
      installId: UUID,
      platform: WEB_PLATFORM,
      appVersion: "0.1.0",
      appBuild: "a1b2c3d4e5f6",
    }),
  );
});
