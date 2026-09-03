import { test } from "node:test";
import assert from "node:assert/strict";
import { verifierDisponibiliteModeles } from "./availability.ts";
import { AIModelRouter } from "./router.ts";

/**
 * §11V — LE CONTRÔLE DE DISPONIBILITÉ : ce qu'il doit dire, et surtout
 * ce qu'il ne doit JAMAIS faire.
 *
 * ─── LA PIÈCE QUI COMPTE : NE PAS CONFONDRE « FAUX » ET « JE NE SAIS PAS » ───
 *
 * Trois déclinaisons de modèle ont été écrites dans le routeur sans
 * qu'on ait pu les vérifier contre l'API. Ce diagnostic existe pour
 * qu'un nom faux se découvre à froid, sur un écran d'administration, et
 * non au milieu d'un appel d'agent un matin de facturation.
 *
 * Il ne remplit ce rôle QUE s'il distingue trois états. Un diagnostic
 * qui afficherait « modèle indisponible » parce que la clé manque en
 * développement enverrait quelqu'un corriger un nom parfaitement
 * correct — et, la fois d'après, plus personne ne le lirait.
 *
 * ─── ET IL NE LÈVE JAMAIS ───
 *
 * Pas de clé, réseau mort, quota dépassé : chacun de ces cas devient un
 * état, pas une exception. Un diagnostic qui tombe en panne n'est pas
 * un diagnostic — c'est une deuxième panne à comprendre pendant qu'on
 * en cherche une première.
 */

/** Un routeur sans surcharge, pour connaître les identifiants attendus. */
const routeur = new AIModelRouter({ env: {} });
const MODELES = routeur.modelesConfigures();

/** Un `fetch` qui répond ce qu'on lui dit, et note ce qu'on lui a demandé. */
function fetchFactice(
  reponsePour: (url: string) => { status: number } | Error,
): { impl: typeof fetch; appels: { url: string; autorisation: string | null }[] } {
  const appels: { url: string; autorisation: string | null }[] = [];

  const impl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree.toString();
    const enTetes = new Headers(init?.headers);
    appels.push({ url, autorisation: enTetes.get("Authorization") });

    const decision = reponsePour(url);
    if (decision instanceof Error) throw decision;
    return new Response(decision.status === 200 ? "{}" : "", { status: decision.status });
  }) as typeof fetch;

  return { impl, appels };
}

test("sans clé serveur : trois « non vérifiable », et surtout aucune exception", async () => {
  const rapport = await verifierDisponibiliteModeles({ routeur, env: {} });

  assert.equal(rapport.cleConfiguree, false);
  assert.equal(rapport.modeles.length, 3);
  assert.equal(rapport.tousDisponibles, false);
  assert.equal(rapport.auMoinsUnIntrouvable, false, "sans clé, on n'accuse aucun modèle");
  assert.equal(rapport.auMoinsUnNonVerifiable, true);

  for (const modele of rapport.modeles) {
    assert.equal(modele.etat, "non_verifiable");
    assert.equal(modele.statutHttp, null);
    assert.ok(modele.detail.includes("Aucune clé OpenAI"));
  }
});

test("les trois identifiants du routeur sont bien ceux qui sont interrogés", async () => {
  const { impl, appels } = fetchFactice(() => ({ status: 200 }));

  const rapport = await verifierDisponibiliteModeles({
    routeur,
    cle: "sk-fictive-pour-le-test",
    fetchImpl: impl,
  });

  assert.equal(rapport.tousDisponibles, true);
  assert.deepEqual(
    rapport.modeles.map((m) => m.niveau),
    ["economy", "standard", "advanced"],
  );

  for (const niveau of ["economy", "standard", "advanced"] as const) {
    const attendu = encodeURIComponent(MODELES[niveau]);
    assert.ok(
      appels.some((a) => a.url.endsWith(`/models/${attendu}`)),
      `le modèle du niveau ${niveau} devait être interrogé`,
    );
  }

  assert.equal(appels.length, 3);
  for (const appel of appels) {
    assert.equal(appel.autorisation, "Bearer sk-fictive-pour-le-test");
  }
});

test("un 404 est un CONSTAT : le modèle est introuvable, et on dit comment le corriger", async () => {
  const { impl } = fetchFactice((url) =>
    url.includes(encodeURIComponent(MODELES.advanced)) ? { status: 404 } : { status: 200 },
  );

  const rapport = await verifierDisponibiliteModeles({
    routeur,
    cle: "sk-fictive",
    fetchImpl: impl,
  });

  const advanced = rapport.modeles.find((m) => m.niveau === "advanced");
  assert.ok(advanced !== undefined);
  assert.equal(advanced.etat, "introuvable");
  assert.equal(advanced.statutHttp, 404);
  assert.ok(
    advanced.detail.includes("OASIS_MODEL_ADVANCED"),
    "le message doit nommer la variable qui répare, pas seulement le problème",
  );

  assert.equal(rapport.auMoinsUnIntrouvable, true);
  assert.equal(rapport.tousDisponibles, false);
  assert.equal(
    rapport.modeles.find((m) => m.niveau === "standard")?.etat,
    "disponible",
    "un modèle faux n'invalide pas les deux autres",
  );
});

test("une clé refusée n'accuse pas le modèle", async () => {
  const { impl } = fetchFactice(() => ({ status: 401 }));

  const rapport = await verifierDisponibiliteModeles({
    routeur,
    cle: "sk-perimee",
    fetchImpl: impl,
  });

  assert.equal(rapport.auMoinsUnIntrouvable, false, "401 ne veut pas dire « nom faux »");
  for (const modele of rapport.modeles) {
    assert.equal(modele.etat, "non_verifiable");
    assert.equal(modele.statutHttp, 401);
  }
});

test("un 429 et un 500 restent des « je ne sais pas »", async () => {
  for (const statut of [429, 500, 503]) {
    const { impl } = fetchFactice(() => ({ status: statut }));
    const rapport = await verifierDisponibiliteModeles({
      routeur,
      cle: "sk-fictive",
      fetchImpl: impl,
    });
    assert.equal(rapport.auMoinsUnIntrouvable, false, `${statut} n'accuse pas le modèle`);
    assert.equal(rapport.modeles[0].etat, "non_verifiable");
    assert.equal(rapport.modeles[0].statutHttp, statut);
  }
});

test("un réseau mort ne fait pas tomber le diagnostic", async () => {
  const panne = new Error("getaddrinfo ENOTFOUND api.openai.com");
  panne.name = "TypeError";
  const { impl } = fetchFactice(() => panne);

  const rapport = await verifierDisponibiliteModeles({
    routeur,
    cle: "sk-fictive",
    fetchImpl: impl,
  });

  assert.equal(rapport.cleConfiguree, true);
  for (const modele of rapport.modeles) {
    assert.equal(modele.etat, "non_verifiable");
    assert.equal(modele.statutHttp, null);
    assert.ok(modele.detail.includes("n'a pas répondu"));
  }
});

test("la clé n'apparaît NULLE PART dans le rapport", async () => {
  const cle = "sk-un-secret-qui-ne-doit-pas-fuir";
  const panne = new Error(`échec en appelant l'API avec ${cle}`);
  const { impl } = fetchFactice(() => panne);

  const rapport = await verifierDisponibiliteModeles({ routeur, cle, fetchImpl: impl });

  // Le rapport finit à l'écran et dans un journal. Recopier un message
  // d'erreur brut y aurait suffi à y déposer le secret : c'est pourquoi
  // les phrases sont construites à partir du seul NOM de l'erreur.
  assert.ok(!JSON.stringify(rapport).includes(cle), "le rapport ne doit pas contenir la clé");
});

test("le rapport porte l'heure de la vérification", async () => {
  const rapport = await verifierDisponibiliteModeles({ routeur, env: {} });
  assert.match(rapport.verifieLe, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!Number.isNaN(Date.parse(rapport.verifieLe)));
});

test("un routeur surchargé fait vérifier les identifiants surchargés, pas les défauts", async () => {
  const surcharge = new AIModelRouter({ env: { OASIS_MODEL_ADVANCED: "gpt-5.7-essai" } });
  const { impl, appels } = fetchFactice(() => ({ status: 200 }));

  const rapport = await verifierDisponibiliteModeles({
    routeur: surcharge,
    cle: "sk-fictive",
    fetchImpl: impl,
  });

  assert.equal(rapport.modeles.find((m) => m.niveau === "advanced")?.modele, "gpt-5.7-essai");
  assert.ok(appels.some((a) => a.url.endsWith("/models/gpt-5.7-essai")));
});
