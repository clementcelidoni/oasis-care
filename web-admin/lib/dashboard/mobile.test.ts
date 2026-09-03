import { test } from "node:test";
import assert from "node:assert/strict";

import {
  declaredInstallations,
  distributionPercent,
  mobileBreakdown,
  mobilePresence,
} from "./mobile.ts";
import type { PlatformKpisRow } from "./types.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * Une seule chose, sous plusieurs angles : « 0 utilisateur mobile » et
 * « personne n'a encore ouvert la nouvelle version » ne sont pas la
 * même phrase, et le jour où quelqu'un écrira `?? 0` pour faire taire
 * une erreur de type, l'écran se mettra à prononcer la première en
 * croyant dire la seconde.
 *
 * Le projet a déjà corrigé cette confusion deux fois en SQL (0059,
 * 0065). Ici, c'est le côté TypeScript de la même règle.
 */

/** Un retour de `admin_platform_kpis()` réduit à ce que ce module lit. */
function kpis(mobile: Partial<PlatformKpisRow>): PlatformKpisRow {
  return {
    total_users: 2,
    new_users_this_month: 0,
    mobile_users: null,
    mobile_users_declared: null,
    mobile_users_inferred: null,
    mobile_collection_started_at: null,
    mobile_users_note: null,
    pro_organizations: 1,
    pro_users: 1,
    open_sessions: 0,
    tracked_subscriptions: 0,
    mrr_cents: null,
    arr_cents: null,
    pro_trials: null,
    mobile_trials: null,
    churn_30d_percent: null,
    pro_ai_requests_this_month: 0,
    mobile_ai_requests_this_month: 0,
    ai_cost_cents: null,
    unknown_reasons: {},
    computed_at: "2026-09-03T16:04:44.183863+00:00",
    ...mobile,
  };
}

/**
 * LE JOUR DU DÉPLOIEMENT. La base rend `null` avec un motif daté ; ce
 * module doit le laisser passer intact. Un `0` fabriqué ici serait plus
 * grave qu'un chiffre faux : il serait crédible.
 */
test("un chiffre inconnu le reste, et n'a pas de ligne de répartition", () => {
  const presence = mobilePresence(
    kpis({
      mobile_users: null,
      mobile_users_declared: 0,
      mobile_users_inferred: 0,
      mobile_collection_started_at: "2026-09-03T16:04:44.183863+00:00",
      mobile_users_note: "Collecte démarrée le 03/09/2026 : aucune installation…",
    }),
  );

  assert.equal(presence.users, null);
  assert.equal(presence.note, "Collecte démarrée le 03/09/2026 : aucune installation…");
  // Rien à mettre sous un chiffre qui n'existe pas : c'est le motif
  // daté que la carte affiche, et il dit déjà tout.
  assert.equal(mobileBreakdown(presence), null);
});

/**
 * L'ÉTAT RÉEL DE LA PRODUCTION LE JOUR OÙ 0077 SERA POSÉE, relevé en
 * transaction annulée : un compte, zéro déclaration, une déduction.
 *
 * C'est le cas le plus dangereux de tout l'écran. Le chiffre existe, il
 * a l'air d'une mesure, et il ne contient que du rétroactif. La ligne
 * qui l'accompagne doit donc porter les trois informations, sans
 * survol.
 */
test("un chiffre entièrement déduit annonce qu'il est déduit", () => {
  const presence = mobilePresence(
    kpis({
      mobile_users: 1,
      mobile_users_declared: 0,
      mobile_users_inferred: 1,
      mobile_collection_started_at: "2026-09-03T16:04:44.183863+00:00",
      mobile_users_note: "Borne inférieure. 0 compte(s) déclaré(s)…",
    }),
  );

  assert.equal(presence.users, 1);
  assert.equal(presence.awaitingFirstDeclaration, true);

  const line = mobileBreakdown(presence);
  assert.ok(line, "un chiffre connu doit être accompagné");
  assert.match(line, /0 déclaré /);
  assert.match(line, /1 déduit /);
  assert.match(line, /borne inférieure/);
  assert.match(line, /03\/09\/2026/);
});

/**
 * Le pluriel français se joue à partir de DEUX. « 0 déclarés » sur la
 * carte la plus lue du Control Center serait la première chose qu'on
 * remarquerait, et la dernière qu'on corrigerait.
 */
test("le pluriel commence à deux, pas à un", () => {
  const un = mobileBreakdown(
    mobilePresence(kpis({ mobile_users: 1, mobile_users_declared: 1, mobile_users_inferred: 0 })),
  );
  assert.match(un ?? "", /1 déclaré /);
  assert.match(un ?? "", /0 déduit /);

  const deux = mobileBreakdown(
    mobilePresence(kpis({ mobile_users: 3, mobile_users_declared: 2, mobile_users_inferred: 1 })),
  );
  assert.match(deux ?? "", /2 déclarés /);
});

/**
 * Une répartition dont une moitié manque n'est pas une répartition.
 * Afficher « 3 déclarés » sans son pendant laisserait croire que les
 * autres n'existent pas — c'est-à-dire que le chiffre est exact.
 */
test("une répartition à moitié connue se déclare inconnue en entier", () => {
  const line = mobileBreakdown(
    mobilePresence(kpis({ mobile_users: 3, mobile_users_declared: 3, mobile_users_inferred: null })),
  );
  assert.match(line ?? "", /répartition déclaré \/ déduit inconnue/);
  assert.doesNotMatch(line ?? "", /3 déclarés/);
});

/**
 * Le chiffre reste une borne inférieure MÊME quand tout est déclaré :
 * un compte qui n'a pas rouvert l'application depuis la mise en service
 * reste invisible, et le mode invité n'est jamais compté. Ce n'est pas
 * une précaution provisoire, c'est la nature de la mesure — la réserve
 * ne doit donc jamais disparaître de la ligne.
 */
test("la réserve de borne inférieure ne s'efface pas quand tout est déclaré", () => {
  const line = mobileBreakdown(
    mobilePresence(
      kpis({
        mobile_users: 5,
        mobile_users_declared: 5,
        mobile_users_inferred: 0,
        mobile_collection_started_at: "2026-09-03T16:04:44.183863+00:00",
      }),
    ),
  );
  assert.match(line ?? "", /borne inférieure/);
});

/**
 * `awaitingFirstDeclaration` commande le bandeau « le parc n'a pas
 * encore basculé » et l'explication des tableaux de distribution vides.
 * Il doit s'éteindre à la PREMIÈRE déclaration, et pas avant.
 */
test("le parc a basculé dès la première installation annoncée", () => {
  const avant = mobilePresence(kpis({ mobile_users: 1, mobile_users_declared: 0 }));
  const apres = mobilePresence(kpis({ mobile_users: 1, mobile_users_declared: 1 }));
  assert.equal(avant.awaitingFirstDeclaration, true);
  assert.equal(apres.awaitingFirstDeclaration, false);

  // `null` n'est pas 0 : c'est « on ne sait pas combien ». Les deux
  // mènent au même bandeau d'attente — dire « le parc a basculé » sur
  // une absence de mesure serait l'affirmation la plus fausse possible.
  assert.equal(mobilePresence(kpis({ mobile_users: 1 })).awaitingFirstDeclaration, true);
});

/**
 * Le dénominateur d'une distribution est celui que la base répète sur
 * chaque ligne, JAMAIS la somme des lignes affichées : une page
 * tronquée donnerait des pourcentages gonflés qui finiraient par
 * dépasser 100 % sans que rien ne le signale.
 */
test("le pourcentage d'une version se calcule sur le total rendu par la base", () => {
  assert.equal(distributionPercent({ installations: 3, declared_installations_total: 4 }), 75);
  assert.equal(distributionPercent({ installations: 1, declared_installations_total: 3 }), 33.3);
});

test("un rapport incohérent n'est pas raboté, il est refusé", () => {
  // Une part supérieure au tout n'est pas une valeur extrême : c'est la
  // preuve que numérateur et dénominateur ne comptent pas la même
  // population. Rabotée à 100 %, elle se dessinerait comme un parc
  // parfaitement à jour.
  assert.equal(distributionPercent({ installations: 5, declared_installations_total: 4 }), null);
  assert.equal(distributionPercent({ installations: 0, declared_installations_total: 0 }), null);
});

/**
 * Le seul zéro VRAI de tout ce chantier : la fonction a répondu, et
 * elle n'avait aucune installation déclarée à décrire. Il ne se lit pas
 * « aucun utilisateur mobile » — c'est l'écran qui doit écrire
 * « aucune installation ne s'est encore annoncée ».
 */
test("un tableau de distribution vide rend zéro installation déclarée", () => {
  assert.equal(declaredInstallations([]), 0);
  assert.equal(
    declaredInstallations([
      {
        platform: "ios",
        app_version: "1.4.2",
        app_build: "214",
        installations: 1,
        users: 1,
        last_seen_at: "2026-09-03T16:05:19.025355+00:00",
        declared_installations_total: 7,
      },
    ]),
    7,
  );
});
