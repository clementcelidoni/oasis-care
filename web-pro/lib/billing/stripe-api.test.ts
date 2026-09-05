import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ClientStripeHttp,
  ErreurStripe,
  ETIQUETTE_INTEGRATION,
  VERSION_API_STRIPE,
  configEstComplete,
  encoderFormulaire,
  lireConfigStripe,
} from "./stripe-api.ts";

/**
 * §STRIPE — LA PORTE DU PRESTATAIRE, ÉPROUVÉE SANS RÉSEAU.
 *
 * AUCUN APPEL VERS `api.stripe.com` N'EST FAIT ICI, et c'est une règle
 * du chantier : un test qui exigerait le réseau ne tournerait jamais en
 * intégration. Le `fetch` est injecté ; on inspecte ce qui SERAIT parti.
 *
 * AUCUNE CLÉ N'EST ÉCRITE dans ce fichier non plus. Les valeurs
 * employées ci-dessous sont des chaînes inventées qui ne ressemblent
 * volontairement pas à une clé du prestataire — pas de préfixe `sk_`,
 * rien qu'un scanner de secrets pourrait prendre au sérieux.
 */

const FAUSSE_CLE = "cle-de-test-inventee-sans-prefixe";

// ══════════════════════════════════════════════════════════════════
// L'ENCODAGE DE FORMULAIRE
// ══════════════════════════════════════════════════════════════════
//
// L'API attend `line_items[0][price]=price_123`, pas du JSON. Une
// imbrication mal encodée ne produit pas une erreur claire : elle
// produit une session SANS LIGNES, donc un paiement à zéro. D'où un
// test dédié à cette fonction seule.

test("les lignes s'encodent en `line_items[0][price]`, la forme que l'API attend", () => {
  const encode = encoderFormulaire({
    mode: "subscription",
    line_items: [
      { price: "price_team_m", quantity: 1 },
      { price: "price_seat_m", quantity: 4 },
    ],
  });

  assert.deepEqual(encode, [
    "mode=subscription",
    "line_items%5B0%5D%5Bprice%5D=price_team_m",
    "line_items%5B0%5D%5Bquantity%5D=1",
    "line_items%5B1%5D%5Bprice%5D=price_seat_m",
    "line_items%5B1%5D%5Bquantity%5D=4",
  ]);
});

test("`null` et `undefined` sont OMIS, pas envoyés vides", () => {
  // Le prestataire traite `customer=` (vide) comme une valeur invalide,
  // et non comme une absence : envoyer le vide ferait échouer la
  // création de session au lieu de laisser le champ de côté.
  const encode = encoderFormulaire({ customer: null, client_reference_id: undefined, a: "b" });
  assert.deepEqual(encode, ["a=b"]);
});

test("les métadonnées s'imbriquent, et les valeurs sont échappées", () => {
  const encode = encoderFormulaire({ metadata: { planKey: "team", note: "à payer & vite" } });
  assert.deepEqual(encode, [
    "metadata%5BplanKey%5D=team",
    "metadata%5Bnote%5D=%C3%A0%20payer%20%26%20vite",
  ]);
});

// ══════════════════════════════════════════════════════════════════
// LA CONFIGURATION — L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL
// ══════════════════════════════════════════════════════════════════

test("sans clé secrète, la configuration dit ce qui manque — elle ne lève pas", () => {
  const lecture = lireConfigStripe({});
  assert.equal(configEstComplete(lecture), false);
  if (configEstComplete(lecture)) return;
  assert.match(lecture.manque, /STRIPE_SECRET_KEY/);
});

test("UNE CLÉ SECRÈTE PRÉFIXÉE `NEXT_PUBLIC_` FERME LA CAISSE, et demande sa révocation", () => {
  // Ce préfixe est le SEUL mécanisme qui décide ce qui part dans le
  // paquet du navigateur, et il est silencieux : rien ne prévient
  // qu'une clé secrète vient d'être publiée à chaque visiteur du site.
  const lecture = lireConfigStripe({
    STRIPE_SECRET_KEY: FAUSSE_CLE,
    STRIPE_MODE: "test",
    NEXT_PUBLIC_STRIPE_SECRET_KEY: FAUSSE_CLE,
  });

  assert.equal(configEstComplete(lecture), false);
  if (configEstComplete(lecture)) return;
  assert.match(lecture.manque, /révoquée/);
});

test("le mode n'est pas DÉDUIT du préfixe de la clé : il se déclare", () => {
  // Une déduction se trompe une fois, et cette fois-là on envoie des
  // identifiants de tarif d'essai à l'API de production.
  for (const mode of [undefined, "", "sandbox", "TEST"]) {
    const lecture = lireConfigStripe({ STRIPE_SECRET_KEY: FAUSSE_CLE, STRIPE_MODE: mode });
    assert.equal(configEstComplete(lecture), false, `« ${String(mode)} » ne doit pas passer`);
  }

  const bonne = lireConfigStripe({ STRIPE_SECRET_KEY: FAUSSE_CLE, STRIPE_MODE: "live" });
  assert.equal(configEstComplete(bonne), true);
  if (!configEstComplete(bonne)) return;
  assert.equal(bonne.mode, "live");
});

// ══════════════════════════════════════════════════════════════════
// LA SESSION DE PAIEMENT
// ══════════════════════════════════════════════════════════════════

type AppelCapture = { url: string; entetes: Record<string, string>; corps: string };

function fetchSimule(reponse: { statut?: number; charge: unknown }) {
  const appels: AppelCapture[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    appels.push({
      url: String(url),
      entetes: (init?.headers ?? {}) as Record<string, string>,
      corps: String(init?.body ?? ""),
    });
    return {
      ok: (reponse.statut ?? 200) < 400,
      status: reponse.statut ?? 200,
      json: async () => reponse.charge,
    } as Response;
  }) as unknown as typeof fetch;
  return { appels, impl };
}

const DEMANDE = {
  clefIdempotence: "oasis:org:team:monthly:7990:price_team_mx1",
  emailClient: "dirigeant@exemple.fr",
  lignes: [{ price: "price_team_m", quantity: 1 }],
  urlSucces: "https://pro.exemple.fr/entreprise/abonnement?souscription=confirmee",
  urlAbandon: "https://pro.exemple.fr/entreprise/abonnement?souscription=abandonnee",
  metadonnees: { organizationId: "org-1", planKey: "team" },
  metadonneesAbonnement: { organizationId: "org-1", planKey: "team" },
};

test("la session part avec la version d'API épinglée et la clé d'idempotence", async () => {
  const { appels, impl } = fetchSimule({
    charge: { id: "cs_test_1", url: "https://paiement.exemple/cs_test_1", customer: "cus_1" },
  });
  const client = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, impl);

  const session = await client.creerSessionPaiement(DEMANDE);

  assert.equal(session.id, "cs_test_1");
  assert.equal(session.url, "https://paiement.exemple/cs_test_1");
  assert.equal(session.clientId, "cus_1");

  assert.equal(appels.length, 1);
  const appel = appels[0]!;
  assert.equal(appel.url, "https://api.stripe.com/v1/checkout/sessions");
  // ÉPINGLÉE : sans elle, la version suit celle du compte, et une mise à
  // jour faite dans le tableau de bord changerait la forme des réponses
  // de ce code sans qu'aucun déploiement ait eu lieu.
  assert.equal(appel.entetes["Stripe-Version"], VERSION_API_STRIPE);
  assert.equal(appel.entetes["Idempotency-Key"], DEMANDE.clefIdempotence);
  assert.equal(appel.entetes["Content-Type"], "application/x-www-form-urlencoded");
});

test("LE CORPS NE FIGE AUCUN MOYEN DE PAIEMENT", async () => {
  // Règle formelle de la documentation officielle : ne jamais passer
  // `payment_method_types`. Le figer sur « card » exclurait le
  // prélèvement SEPA — précisément le moyen que choisit une entreprise
  // française sur un abonnement mensuel.
  const { appels, impl } = fetchSimule({
    charge: { id: "cs_test_2", url: "https://paiement.exemple/cs_test_2" },
  });
  const client = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, impl);
  await client.creerSessionPaiement(DEMANDE);

  const corps = decodeURIComponent(appels[0]!.corps);
  assert.equal(corps.includes("payment_method_types"), false);
  assert.ok(corps.includes("mode=subscription"));
  assert.ok(corps.includes("line_items[0][price]=price_team_m"));
  assert.ok(corps.includes("integration_identifier=" + ETIQUETTE_INTEGRATION));
});

test("AUCUNE FACTURE N'EST DEMANDÉE AU PRESTATAIRE", async () => {
  // Stripe encaisse, Oasis Care facture. La facture française —
  // numérotée sans trou — est celle de `saas_issue_invoice()`. Une
  // seconde numérotation donnerait deux documents pour un seul achat,
  // et le client ne saurait plus lequel remettre à son comptable.
  const { appels, impl } = fetchSimule({
    charge: { id: "cs_test_3", url: "https://paiement.exemple/cs_test_3" },
  });
  const client = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, impl);
  await client.creerSessionPaiement(DEMANDE);

  const corps = decodeURIComponent(appels[0]!.corps);
  assert.equal(corps.includes("invoice_creation"), false);
  // Et aucune taxe demandée au prestataire : deux moteurs de taxe, ce
  // sont deux vérités et un jour un écart.
  assert.equal(corps.includes("automatic_tax"), false);
});

test("l'e-mail sert de rattachement tant qu'aucun client n'est connu", async () => {
  const { appels, impl } = fetchSimule({
    charge: { id: "cs_4", url: "https://paiement.exemple/cs_4" },
  });
  const client = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, impl);
  await client.creerSessionPaiement(DEMANDE);
  assert.ok(decodeURIComponent(appels[0]!.corps).includes("customer_email=dirigeant@exemple.fr"));

  // …et le client existant l'emporte quand il est connu : deux clients
  // chez le prestataire, ce sont deux historiques de paiement et un
  // remboursement qui part du mauvais.
  const second = fetchSimule({ charge: { id: "cs_5", url: "https://paiement.exemple/cs_5" } });
  const client2 = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, second.impl);
  await client2.creerSessionPaiement({ ...DEMANDE, clientId: "cus_existant" });
  const corps2 = decodeURIComponent(second.appels[0]!.corps);
  assert.ok(corps2.includes("customer=cus_existant"));
  assert.equal(corps2.includes("customer_email"), false);
});

test("un refus du prestataire remonte en `ErreurStripe`, sans la clé dans le message", async () => {
  const { impl } = fetchSimule({
    statut: 400,
    charge: { error: { code: "resource_missing", message: "No such price: price_inconnu" } },
  });
  const client = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, impl);

  await assert.rejects(
    () => client.creerSessionPaiement(DEMANDE),
    (erreur: unknown) => {
      assert.ok(erreur instanceof ErreurStripe);
      assert.equal(erreur.statut, 400);
      assert.equal(erreur.codeStripe, "resource_missing");
      // La clé ne doit apparaître NULLE PART dans ce qui remonte : les
      // messages d'erreur finissent dans des journaux, et les journaux
      // se partagent.
      assert.equal(erreur.message.includes(FAUSSE_CLE), false);
      return true;
    },
  );
});

test("une session sans URL rend `url: null` plutôt qu'une chaîne vide", async () => {
  // L'appelant refuse alors, et dit que rien n'a été prélevé. Une
  // chaîne vide produirait une redirection vers la page courante, et le
  // client croirait avoir payé.
  const { impl } = fetchSimule({ charge: { id: "cs_6" } });
  const client = new ClientStripeHttp({ cleSecrete: FAUSSE_CLE, mode: "test" }, impl);
  const session = await client.creerSessionPaiement(DEMANDE);
  assert.equal(session.url, null);
});
