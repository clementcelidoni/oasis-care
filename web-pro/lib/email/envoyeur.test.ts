import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ClientTransporteurHttp,
  ErreurTransporteur,
  composerCorps,
  configEstComplete,
  lireConfigTransporteur,
  normaliserIdentifiant,
  type ConfigTransporteur,
} from "./brevo-api.ts";
import {
  EnvoyeurBrevo,
  construireEnvoyeurBrevo,
  lireNouvelleTransporteur,
  traduireRefus,
  verifierDesabonnement,
} from "./brevo.ts";
import { EnvoyeurIndisponible, obtenirEnvoyeurCourriel } from "./envoyeur.ts";
import { composerEnveloppe, nettoyerEntete } from "./index.ts";
import { AucuneSourceDocument, nomDeFichier } from "./document-joint.ts";
import type { EnveloppeCourriel, IdentiteExpediteur } from "./types.ts";
import type { MessageRendu } from "./gabarits/index.ts";

/**
 * §COURRIEL — LE TRANSPORTEUR, ÉPROUVÉ SANS RÉSEAU.
 *
 *     node --test --experimental-strip-types "lib/email/envoyeur.test.ts"
 *
 * AUCUN APPEL SORTANT. Le `fetch` est injecté ; on inspecte ce qui
 * SERAIT parti.
 *
 * AUCUNE CLÉ N'EST ÉCRITE DANS CE FICHIER non plus. Les valeurs
 * ci-dessous sont des chaînes inventées qui ne ressemblent
 * volontairement pas à une clé de transporteur — rien qu'un scanner de
 * secrets pourrait prendre au sérieux.
 */

const FAUSSE_CLE = "cle-de-test-inventee-sans-prefixe";

const ENV_COMPLET: Record<string, string | undefined> = {
  BREVO_API_KEY: FAUSSE_CLE,
  OASIS_EMAIL_EXPEDITEUR: "envoi@expediteur.example",
  OASIS_EMAIL_RETOUR: "retours@expediteur.example",
  OASIS_EMAIL_BASE_URL: "https://pro.example/",
};

const CONFIG: ConfigTransporteur = {
  cleApi: FAUSSE_CLE,
  expediteur: "envoi@expediteur.example",
  retour: "retours@expediteur.example",
  baseUrl: "https://pro.example",
};

function enveloppe(surcharge: Partial<EnveloppeCourriel> = {}): EnveloppeCourriel {
  return {
    nature: "transactionnel",
    expediteur: { nom: "Jardins Dupont", email: "envoi@expediteur.example" },
    repondreA: { nom: "Jardins Dupont", email: "contact@jardins-dupont.example" },
    destinataire: { nom: "Marie Martin", email: "marie@client.example" },
    objet: "Votre devis n° DV-1",
    texte: "Bonjour Marie Martin,",
    html: "<p>Bonjour Marie Martin,</p>",
    pieces: [],
    entetes: {},
    etiquettes: ["devisEnvoye", "transactionnel"],
    ...surcharge,
  };
}

// ══════════════════════════════════════════════════════════════════
// L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL
// ══════════════════════════════════════════════════════════════════

test("sans clé, l'envoyeur est indisponible avec une phrase — et rien ne plante", async () => {
  const envoyeur = obtenirEnvoyeurCourriel({});
  assert.ok(envoyeur.raisonIndisponibilite !== null);
  assert.match(envoyeur.raisonIndisponibilite!, /BREVO_API_KEY/);

  const resultat = await envoyeur.expedier(enveloppe());
  assert.equal(resultat.etat, "indisponible");
  // PAS DE FAUX IDENTIFIANT. Un identifiant inventé se retrouverait dans
  // `transporter_message_id` et le webhook n'aurait plus rien à
  // rattacher.
  assert.ok(!("identifiantTransporteur" in resultat));
});

test("chaque variable manquante a sa propre phrase : elles n'appellent pas le même geste", () => {
  const sansExpediteur = lireConfigTransporteur({ ...ENV_COMPLET, OASIS_EMAIL_EXPEDITEUR: undefined });
  assert.ok(!configEstComplete(sansExpediteur));
  assert.match(sansExpediteur.manque, /OASIS_EMAIL_EXPEDITEUR/);

  const sansRetour = lireConfigTransporteur({ ...ENV_COMPLET, OASIS_EMAIL_RETOUR: undefined });
  assert.ok(!configEstComplete(sansRetour));
  assert.match(sansRetour.manque, /rebonds/);

  const sansBase = lireConfigTransporteur({ ...ENV_COMPLET, OASIS_EMAIL_BASE_URL: undefined });
  assert.ok(!configEstComplete(sansBase));
  assert.match(sansBase.manque, /désabonnement/);
});

test("une clé préfixée NEXT_PUBLIC_ fait refuser tout envoi : c'est une fuite, pas une commodité", () => {
  const lecture = lireConfigTransporteur({
    ...ENV_COMPLET,
    NEXT_PUBLIC_BREVO_API_KEY: "peu-importe",
  });
  assert.ok(!configEstComplete(lecture));
  assert.match(lecture.manque, /révoquée/);
});

test("une racine de liens en http n'est pas acceptée", () => {
  const lecture = lireConfigTransporteur({ ...ENV_COMPLET, OASIS_EMAIL_BASE_URL: "http://pro.example" });
  assert.ok(!configEstComplete(lecture));
});

test("la barre oblique finale de la racine est retirée : sinon les liens en portent deux", () => {
  const lecture = lireConfigTransporteur(ENV_COMPLET);
  assert.ok(configEstComplete(lecture));
  assert.equal(lecture.baseUrl, "https://pro.example");
});

test("la raison d'indisponibilité est un paramètre, pas une constante", async () => {
  const un = new EnvoyeurIndisponible("Aucun transporteur n'est branché.");
  const deux = new EnvoyeurIndisponible("La clé n'est pas posée sur ce serveur.");
  assert.notEqual(un.raisonIndisponibilite, deux.raisonIndisponibilite);
  assert.equal((await un.expedier(enveloppe())).etat, "indisponible");
});

test("l'envoyeur se reconstruit à chaque appel : une variable posée prend effet au déploiement suivant", () => {
  const avant = obtenirEnvoyeurCourriel({});
  const apres = obtenirEnvoyeurCourriel(ENV_COMPLET);
  assert.ok(avant.raisonIndisponibilite !== null);
  assert.equal(apres.raisonIndisponibilite, null);
});

// ══════════════════════════════════════════════════════════════════
// LE MOTIF CRM, DANS LE CORPS RÉELLEMENT POSTÉ
// ══════════════════════════════════════════════════════════════════

test("l'expéditeur technique est le domaine authentifié, le nom affiché est celui du paysagiste", () => {
  const corps = composerCorps(enveloppe(), CONFIG) as Record<string, Record<string, string>>;
  // C'est le cœur du motif CRM : le domaine qui porte SPF, DKIM et DMARC
  // reste celui d'Oasis ; le nom que voit le client est celui de son
  // paysagiste. L'alignement DMARC porte sur le domaine, pas sur le nom.
  assert.equal(corps.sender.email, "envoi@expediteur.example");
  assert.equal(corps.sender.name, "Jardins Dupont");
});

test("le « répondre à » pointe le paysagiste — sans lui, la fonctionnalité est pire qu'inutile", () => {
  const corps = composerCorps(enveloppe(), CONFIG) as Record<string, Record<string, string>>;
  assert.equal(corps.replyTo.email, "contact@jardins-dupont.example");
  assert.equal(corps.replyTo.name, "Jardins Dupont");
});

test("l'adresse d'expédition ne peut pas être choisie par l'appelant", () => {
  const corps = composerCorps(
    enveloppe({ expediteur: { nom: "Votre banque", email: "attaquant@ailleurs.example" } }),
    CONFIG,
  ) as Record<string, Record<string, string>>;
  // Le nom affiché vient de l'enveloppe (donc de la base) ; l'ADRESSE,
  // elle, vient de la configuration du serveur. Un envoi depuis un
  // domaine arbitraire n'est pas refusé par politesse : il est
  // impossible.
  assert.equal(corps.sender.email, "envoi@expediteur.example");
});

test("les deux parties partent ensemble : un message sans version texte est mal vu des filtres", () => {
  const corps = composerCorps(enveloppe(), CONFIG) as Record<string, string>;
  assert.equal(corps.htmlContent, "<p>Bonjour Marie Martin,</p>");
  assert.equal(corps.textContent, "Bonjour Marie Martin,");
});

test("une pièce jointe est transmise sous son nom lisible", () => {
  const corps = composerCorps(
    enveloppe({
      pieces: [{ nom: "Facture FA-2026-0042.pdf", typeMime: "application/pdf", contenuBase64: "QUJD" }],
    }),
    CONFIG,
  ) as Record<string, { name: string; content: string }[]>;
  assert.deepEqual(corps.attachment, [{ name: "Facture FA-2026-0042.pdf", content: "QUJD" }]);
});

test("aucune donnée personnelle dans les étiquettes : elles remontent chez un tiers", () => {
  const corps = composerCorps(enveloppe(), CONFIG) as Record<string, string[]>;
  assert.deepEqual(corps.tags, ["devisEnvoye", "transactionnel"]);
  const serialise = JSON.stringify(corps.tags);
  assert.ok(!serialise.includes("marie@client.example"));
  assert.ok(!serialise.includes("Marie Martin"));
});

// ══════════════════════════════════════════════════════════════════
// LES DEUX REFUS STRUCTURELS
// ══════════════════════════════════════════════════════════════════

test("une publicité sans lien de désabonnement ne part pas", async () => {
  const envoyeur = construireEnvoyeurBrevo(ENV_COMPLET, undefined, {
    envoyer: async () => {
      throw new Error("Le transporteur ne doit jamais être appelé ici.");
    },
  });
  assert.ok(envoyeur instanceof EnvoyeurBrevo);
  const resultat = await envoyeur.expedier(enveloppe({ nature: "publicite" }));
  assert.equal(resultat.etat, "refuse");
  assert.match((resultat as { raison: string }).raison, /désabonnement/);
});

test("un transactionnel AVEC un lien de désabonnement ne part pas non plus", () => {
  const refus = verifierDesabonnement(
    enveloppe({ entetes: { "List-Unsubscribe": "<https://pro.example/x>" } }),
  );
  assert.ok(refus !== null);
  assert.match(refus!, /On ne se désabonne pas de ses propres factures/);
});

test("une publicité avec son en-tête passe", () => {
  assert.equal(
    verifierDesabonnement(
      enveloppe({ nature: "publicite", entetes: { "List-Unsubscribe": "<https://pro.example/x>" } }),
    ),
    null,
  );
});

// ══════════════════════════════════════════════════════════════════
// LE CLIENT HTTP
// ══════════════════════════════════════════════════════════════════

test("le client poste au bon endroit, avec la clé en en-tête et jamais dans l'URL", async () => {
  const vu: { url: string; init: RequestInit }[] = [];
  const client = new ClientTransporteurHttp((async (url: string, init: RequestInit) => {
    vu.push({ url, init });
    return new Response(JSON.stringify({ messageId: "<abc@relais.example>" }), { status: 201 });
  }) as unknown as typeof fetch);

  const reponse = await client.envoyer(enveloppe(), CONFIG);

  assert.equal(vu.length, 1);
  assert.equal(vu[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.ok(!vu[0].url.includes(FAUSSE_CLE));
  const entetes = vu[0].init.headers as Record<string, string>;
  assert.equal(entetes["api-key"], FAUSSE_CLE);
  // LES CHEVRONS SAUTENT DES DEUX CÔTÉS. Le transporteur les met à
  // l'envoi et parfois pas dans son webhook : enregistrer l'un et
  // chercher l'autre laisserait tous les rebonds orphelins.
  assert.equal(reponse.identifiantTransporteur, "abc@relais.example");
});

test("une réponse sans identifiant est un échec : un envoi qu'on ne suivra jamais n'en est pas un", async () => {
  const client = new ClientTransporteurHttp((async () =>
    new Response(JSON.stringify({}), { status: 201 })) as unknown as typeof fetch);
  await assert.rejects(() => client.envoyer(enveloppe(), CONFIG), /identifiant/);
});

test("un refus du transporteur devient une phrase en français, jamais un code brut", async () => {
  const client = new ClientTransporteurHttp((async () =>
    new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), {
      status: 401,
    })) as unknown as typeof fetch);
  const envoyeur = new EnvoyeurBrevo(CONFIG, client);
  const resultat = await envoyeur.expedier(enveloppe());
  assert.equal(resultat.etat, "refuse");
  assert.match((resultat as { raison: string }).raison, /identifiants/);
  assert.equal((resultat as { code: string | null }).code, "unauthorized");
});

test("le plafond quotidien du transporteur se dit en clair : c'est le premier incident attendu", () => {
  const phrase = traduireRefus(new ErreurTransporteur(429, "too_many_requests", "limit"));
  assert.match(phrase, /plafond/);
});

test("UNE PANNE DE RÉSEAU N'EST PAS « LE MESSAGE N'EST PAS PARTI » : ON NE SAIT PAS", async () => {
  // LE CAS LE PLUS TROMPEUR DU FICHIER. La connexion casse aussi — et
  // surtout — APRÈS que le transporteur a accepté le message : c'est la
  // réponse qui s'est perdue, pas la requête. La couche affirmait « le
  // message n'est pas parti ; il pourra être renvoyé », une affirmation
  // sur un fait inconnu, fausse dans le cas le plus fréquent. Le client
  // recevait son document, et le journal du paysagiste — celui qu'il
  // consulte justement quand son client dit n'avoir rien reçu — jurait
  // le contraire.
  const envoyeur = new EnvoyeurBrevo(CONFIG, {
    envoyer: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const resultat = await envoyeur.expedier(enveloppe());
  assert.equal(resultat.etat, "incertain");
  assert.match((resultat as { raison: string }).raison, /peut-être parti/);
});

test("un 2xx sans identifiant est un SORT INCONNU, pas un refus", async () => {
  // Le transporteur a répondu 2xx : il a ACCEPTÉ le message. Ce qui
  // manque est le moyen de le suivre, pas l'envoi.
  const client = new ClientTransporteurHttp((async () =>
    new Response(JSON.stringify({}), { status: 201 })) as unknown as typeof fetch);
  const resultat = await new EnvoyeurBrevo(CONFIG, client).expedier(enveloppe());
  assert.equal(resultat.etat, "incertain");
});

test("UN 429 EST TEMPORAIRE, UN 400 NE L'EST PAS", async () => {
  // La phrase promettait « il repartira une fois le plafond levé » et
  // rien ne le repartait. Le drapeau est ce qui rend la promesse vraie.
  const plafond = new ClientTransporteurHttp((async () =>
    new Response(JSON.stringify({ code: "too_many_requests", message: "limite" }), { status: 429 })
  ) as unknown as typeof fetch);
  const r1 = await new EnvoyeurBrevo(CONFIG, plafond).expedier(enveloppe());
  assert.equal(r1.etat, "refuse");
  assert.equal((r1 as { temporaire: boolean }).temporaire, true);

  const mauvaise = new ClientTransporteurHttp((async () =>
    new Response(JSON.stringify({ code: "invalid_parameter", message: "adresse" }), { status: 400 })
  ) as unknown as typeof fetch);
  const r2 = await new EnvoyeurBrevo(CONFIG, mauvaise).expedier(enveloppe());
  assert.equal(r2.etat, "refuse");
  assert.equal((r2 as { temporaire: boolean }).temporaire, false);
});

test("chaque phrase qui PROMET un nouvel essai tombe dans un cas temporaire", async () => {
  // La règle qui garde les deux d'accord : une phrase qui annonce un
  // renvoi que le code ne fait pas est pire qu'une phrase sèche — le
  // paysagiste attend un message qui ne repartira jamais.
  for (const statut of [429, 500, 503]) {
    const client = new ClientTransporteurHttp((async () =>
      new Response(JSON.stringify({ message: "x" }), { status: statut })) as unknown as typeof fetch);
    const r = await new EnvoyeurBrevo(CONFIG, client).expedier(enveloppe());
    assert.equal(r.etat, "refuse", `statut ${statut}`);
    const { raison, temporaire } = r as { raison: string; temporaire: boolean };
    if (/repartira/.test(raison)) {
      assert.equal(temporaire, true, `« ${raison} » promet un renvoi : il doit être temporaire`);
    }
  }
});

test("la clé du transporteur ne figure jamais dans un message d'erreur", async () => {
  const client = new ClientTransporteurHttp((async () =>
    new Response(JSON.stringify({ code: "x", message: "boom" }), { status: 400 })) as unknown as typeof fetch);
  const envoyeur = new EnvoyeurBrevo(CONFIG, client);
  const resultat = await envoyeur.expedier(enveloppe());
  assert.ok(!JSON.stringify(resultat).includes(FAUSSE_CLE));
});

// ══════════════════════════════════════════════════════════════════
// LE WEBHOOK
// ══════════════════════════════════════════════════════════════════

test("le vocabulaire du transporteur se traduit dans celui de `email_events`", () => {
  const cas: [string, string][] = [
    ["request", "sent"],
    ["delivered", "delivered"],
    ["hard_bounce", "hardBounce"],
    ["hardBounce", "hardBounce"],
    ["invalid_email", "hardBounce"],
    ["soft_bounce", "softBounce"],
    ["spam", "complaint"],
    ["blocked", "blocked"],
    ["unsubscribed", "unsubscribed"],
    ["deferred", "deferred"],
    ["error", "error"],
    ["click", "clicked"],
    ["unique_opened", "opened"],
  ];
  for (const [brut, attendu] of cas) {
    const lu = lireNouvelleTransporteur({ event: brut, "message-id": "<x@y>", ts_event: 1_780_000_000 });
    assert.equal(lu?.evenement, attendu, `« ${brut} » se traduit en « ${attendu} »`);
  }
});

test("l'instant vient de l'événement, pas de la réception : sinon un rejeu compte double", () => {
  const lu = lireNouvelleTransporteur({
    event: "delivered",
    "message-id": "<x@y>",
    ts_event: 1_780_000_000,
  });
  assert.equal(lu?.instant, new Date(1_780_000_000 * 1000).toISOString());
});

test("une charge inconnue rend null plutôt que de lever : un 500 ferait couper le webhook", () => {
  assert.equal(lireNouvelleTransporteur(null), null);
  assert.equal(lireNouvelleTransporteur({ event: "list_addition", "message-id": "<x@y>" }), null);
  assert.equal(lireNouvelleTransporteur({ event: "delivered" }), null);
});

test("l'identifiant est normalisé des deux côtés", () => {
  assert.equal(normaliserIdentifiant("<abc@relais>"), "abc@relais");
  assert.equal(normaliserIdentifiant(" abc@relais "), "abc@relais");
  const lu = lireNouvelleTransporteur({ event: "delivered", messageId: "abc@relais", ts: 1 });
  assert.equal(lu?.identifiantTransporteur, "abc@relais");
});

// ══════════════════════════════════════════════════════════════════
// L'ENVELOPPE ET LES EN-TÊTES
// ══════════════════════════════════════════════════════════════════

const IDENTITE: IdentiteExpediteur = {
  nomAffiche: "Jardins Dupont",
  repondreA: "contact@jardins-dupont.example",
  adresseTechnique: "envoi@expediteur.example",
  urlLogo: null,
};

const RENDU: MessageRendu = {
  cle: "devisEnvoye",
  version: "devisEnvoye@1",
  nature: "transactionnel",
  audience: "clientFinal",
  objet: "Votre devis n° DV-1",
  texte: "Bonjour",
  html: "<p>Bonjour</p>",
  empreinteHtml: "0".repeat(64),
  entetes: {},
};

test("un nom d'entreprise porteur d'un saut de ligne ne peut pas injecter un en-tête", () => {
  const composee = composerEnveloppe(
    RENDU,
    { ...IDENTITE, nomAffiche: "Jardins\r\nBcc: espion@ailleurs.example" },
    { email: "marie@client.example", nom: "Marie" },
  );
  assert.ok(!/[\r\n]/.test(composee.expediteur.nom));
  assert.equal(nettoyerEntete('a"b<c>d'), "a b c d");
});

// ══════════════════════════════════════════════════════════════════
// LA PIÈCE JOINTE
// ══════════════════════════════════════════════════════════════════

test("sans rendu de document installé, on le dit — on ne joint pas un document approximatif", async () => {
  const source = new AucuneSourceDocument();
  assert.ok(source.raisonIndisponibilite !== null);
  const resultat = await source.produire("facture", "abc");
  assert.equal(resultat.etat, "indisponible");
});

test("le nom du fichier est celui que le client rangera, pas un identifiant technique", () => {
  assert.equal(nomDeFichier("facture", "FA-2026-0042"), "Facture FA-2026-0042.pdf");
  assert.equal(nomDeFichier("devis", "DV/2026 0031"), "Devis DV-2026-0031.pdf");
  assert.equal(nomDeFichier("facture", ""), "Facture sans-numero.pdf");
});
