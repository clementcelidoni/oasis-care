import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGUE, rendreMessage, nettoyerObjet, type ContexteRendu } from "./gabarits/index.ts";
import { echapperHtml, formaterDate, formaterMontant, urlSure } from "./gabarits/blocs.ts";
import {
  identiteEnUneLigne, lienDesabonnement, lienDesabonnementUnClic,
} from "./gabarits/enveloppe.ts";
import type { CleGabarit, IdentiteExpediteur, MentionsEntreprise } from "./types.ts";

/**
 * §COURRIEL — LES GABARITS, ÉPROUVÉS SANS RÉSEAU.
 *
 *     node --test --experimental-strip-types "lib/email/gabarits.test.ts"
 *
 * AUCUN APPEL SORTANT N'EST FAIT ICI, et c'est une règle du chantier :
 * un test qui exigerait le réseau ne tournerait jamais en intégration,
 * et on s'en apercevrait le jour où il aurait quelque chose à dire.
 */

const IDENTITE: IdentiteExpediteur = {
  nomAffiche: "Jardins Dupont",
  repondreA: "contact@jardins-dupont.example",
  adresseTechnique: "envoi@expediteur.example",
  urlLogo: "https://images.example/logo.png",
};

const MENTIONS: MentionsEntreprise = {
  raisonSociale: "Jardins Dupont",
  formeJuridique: "SARL",
  siret: "12345678900011",
  numeroTva: "FR00123456789",
  villeRcs: "Nantes",
  capitalCentimes: 1_000_000,
  adresse1: "3 chemin des Tilleuls",
  codePostal: "44000",
  ville: "Nantes",
  telephone: "02 40 00 00 00",
  courriel: "contact@jardins-dupont.example",
  siteWeb: "https://jardins-dupont.example",
  numeroDecennale: "DEC-2026-77",
  assureur: "Mutuelle du Paysage",
};

const CTX_TRANSACTIONNEL: ContexteRendu = {
  nature: "transactionnel",
  identite: IDENTITE,
  mentions: MENTIONS,
  baseUrl: "https://pro.example",
};

const CTX_PUBLICITE: ContexteRendu = {
  nature: "publicite",
  identite: IDENTITE,
  mentions: MENTIONS,
  baseUrl: "https://pro.example",
  jetonDesabonnement: "a".repeat(64),
};

// ══════════════════════════════════════════════════════════════════
// LE CATALOGUE EST LE MIROIR DE LA TABLE `email_templates`
// ══════════════════════════════════════════════════════════════════
//
// SI UN GABARIT DÉCLARE ICI UNE NATURE OU UNE AUDIENCE DIFFÉRENTE DE
// CELLE DE LA MIGRATION 0084, la clé étrangère composite
// `email_messages_template_fk` refuse l'insertion — au moment d'envoyer
// une facture, c'est-à-dire au pire moment. Ce tableau est recopié à la
// main depuis le `insert into public.email_templates` de 0084 § 1 : il
// doit être remis à jour EN MÊME TEMPS que la migration, et c'est
// justement ce que ce test force.

const ATTENDU_EN_BASE: Record<
  CleGabarit,
  { nature: string; audience: string; declencheur: string }
> = {
  devisEnvoye: { nature: "transactionnel", audience: "clientFinal", declencheur: "humain" },
  devisRelance: { nature: "transactionnel", audience: "clientFinal", declencheur: "periodique" },
  factureEmise: { nature: "transactionnel", audience: "clientFinal", declencheur: "changementEtat" },
  factureRelance: { nature: "transactionnel", audience: "clientFinal", declencheur: "periodique" },
  invitationPortail: { nature: "transactionnel", audience: "clientFinal", declencheur: "humain" },
  bienvenueEntreprise: { nature: "transactionnel", audience: "entreprise", declencheur: "changementEtat" },
  parametreImportant: { nature: "transactionnel", audience: "entreprise", declencheur: "humain" },
  annonceCommerciale: { nature: "publicite", audience: "entreprise", declencheur: "humain" },
};

test("chaque gabarit déclare exactement ce que la migration 0084 déclare", () => {
  const cles = Object.keys(CATALOGUE) as CleGabarit[];
  assert.equal(cles.length, 8, "la migration 0084 pose huit gabarits, ni plus ni moins");

  for (const cle of cles) {
    const gabarit = CATALOGUE[cle];
    const attendu = ATTENDU_EN_BASE[cle];
    assert.equal(gabarit.cle, cle, `la clé de ${cle} ne se contredit pas`);
    assert.equal(gabarit.nature, attendu.nature, `nature de ${cle}`);
    assert.equal(gabarit.audience, attendu.audience, `audience de ${cle}`);
    assert.equal(gabarit.declencheur, attendu.declencheur, `déclencheur de ${cle}`);
    assert.match(gabarit.version, /@\d+$/, `${cle} porte une version incrémentable`);
  }
});

test("une publicité ne vise jamais un client final : la règle vaut aussi dans le code", () => {
  for (const gabarit of Object.values(CATALOGUE)) {
    if (gabarit.nature === "publicite") {
      assert.equal(
        gabarit.audience,
        "entreprise",
        "le client final du paysagiste n'a rien signé avec Oasis Care",
      );
    }
  }
});

test("aucun gabarit n'est déclenché par un modèle : le mot n'existe pas", () => {
  for (const gabarit of Object.values(CATALOGUE)) {
    assert.ok(
      ["humain", "changementEtat", "periodique"].includes(gabarit.declencheur),
      "un envoi décidé par un modèle n'a pas de nom, donc pas de chemin",
    );
  }
});

// ══════════════════════════════════════════════════════════════════
// LE DÉSABONNEMENT — PRÉSENT SUR LA PUBLICITÉ, ABSENT AILLEURS
// ══════════════════════════════════════════════════════════════════

test("la publicité porte un lien de désabonnement, dans le corps ET dans l'en-tête", async () => {
  const rendu = await rendreMessage(
    "annonceCommerciale",
    { nomEntreprise: "Jardins Dupont", objet: "Nouveauté", corpsTexte: "Bonne nouvelle." },
    CTX_PUBLICITE,
  );

  // LE BOUTON DU CORPS MÈNE À UNE PAGE, qui explique et confirme.
  const lien = lienDesabonnement("https://pro.example", "a".repeat(64));
  assert.ok(rendu.html.includes(lien), "le lien figure dans le HTML");
  assert.ok(rendu.texte.includes(lien), "et en toutes lettres dans la version texte");

  // L'EN-TÊTE, LUI, MÈNE À UN POINT DE TERMINAISON QUI ACCEPTE LE POST,
  // et ce n'est pas la même adresse. Gmail et Yahoo exigent des envois
  // de masse, depuis 2024, un `List-Unsubscribe` qui désabonne sur une
  // requête POST sans interaction supplémentaire (RFC 8058) : leur
  // bouton natif POSTE, il ne clique pas. Une page Next et un point de
  // terminaison POST ne pouvant pas cohabiter sur la même route, les
  // deux adresses diffèrent — et une page qui ne répondrait qu'au GET
  // ferait disparaître le bouton natif, ne laissant au destinataire que
  // « signaler comme indésirable ».
  const unClic = lienDesabonnementUnClic("https://pro.example", "a".repeat(64));
  assert.notEqual(unClic, lien);
  assert.equal(rendu.entetes["List-Unsubscribe"], `<${unClic}>`);
  assert.equal(rendu.entetes["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("le message de désabonnement rassure sur les factures : c'est la peur numéro un", async () => {
  const rendu = await rendreMessage(
    "annonceCommerciale",
    { nomEntreprise: "Jardins Dupont", objet: "Nouveauté", corpsTexte: "Bonne nouvelle." },
    CTX_PUBLICITE,
  );
  assert.match(rendu.texte, /factures/i);
  assert.match(rendu.texte, /continueront/i);
});

test("AUCUN gabarit transactionnel ne porte de désabonnement, ni corps ni en-tête", async () => {
  const echantillons: [CleGabarit, unknown][] = [
    ["devisEnvoye", { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 124000 }],
    ["devisRelance", { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 124000, rang: 1 }],
    ["factureEmise", { numero: "FA-1", nomClient: "Marie", totalTtcCentimes: 124000 }],
    [
      "factureRelance",
      {
        numero: "FA-1",
        nomClient: "Marie",
        resteDuCentimes: 124000,
        echeanceLe: "2026-08-01",
        joursDeRetard: 12,
        rang: 1,
      },
    ],
    [
      "invitationPortail",
      { nomClient: "Marie", lienInvitation: "https://pro.example/i/xyz", expireLe: "2026-10-01" },
    ],
    [
      "bienvenueEntreprise",
      { nomEntreprise: "Jardins Dupont", lienApplication: "https://pro.example" },
    ],
    [
      "parametreImportant",
      { nomEntreprise: "Jardins Dupont", intitule: "Le taux de TVA", quand: "2026-09-05" },
    ],
  ];

  for (const [cle, variables] of echantillons) {
    // @ts-expect-error — le test parcourt le catalogue par clé, ce que
    // le typage nominal de `rendreMessage` interdit à dessein.
    const rendu = await rendreMessage(cle, variables, CTX_TRANSACTIONNEL);
    assert.deepEqual(rendu.entetes, {}, `${cle} : aucun en-tête de désabonnement`);
    assert.ok(!/désabonn/i.test(rendu.texte), `${cle} : le mot n'apparaît pas dans le texte`);
    assert.ok(!/desabonnement\?jeton/.test(rendu.html), `${cle} : aucun lien de désabonnement`);
  }
});

// ══════════════════════════════════════════════════════════════════
// LES DEUX VERSIONS DISENT LA MÊME CHOSE
// ══════════════════════════════════════════════════════════════════

test("chaque gabarit rend une version texte non vide, et l'essentiel y figure", async () => {
  const rendu = await rendreMessage(
    "factureEmise",
    { numero: "FA-2026-0042", nomClient: "Marie Martin", totalTtcCentimes: 124050, echeanceLe: "2026-10-15" },
    CTX_TRANSACTIONNEL,
  );

  for (const attendu of ["FA-2026-0042", "Marie Martin", "1 240,50", "15 octobre 2026"]) {
    assert.ok(
      rendu.texte.includes(attendu.replace(/ /g, " ")) ||
        rendu.texte.replace(/ | /g, " ").includes(attendu),
      `« ${attendu} » figure dans la version texte`,
    );
    assert.ok(
      rendu.html.replace(/ | /g, " ").includes(attendu),
      `« ${attendu} » figure dans la version HTML`,
    );
  }
});

test("l'objet dit ce que c'est, sans jargon", async () => {
  const devis = await rendreMessage(
    "devisEnvoye",
    { numero: "DV-2026-0031", nomClient: "Marie", totalTtcCentimes: 100000 },
    CTX_TRANSACTIONNEL,
  );
  assert.equal(devis.objet, "Votre devis n° DV-2026-0031");

  const facture = await rendreMessage(
    "factureEmise",
    { numero: "FA-2026-0042", nomClient: "Marie", totalTtcCentimes: 100000 },
    CTX_TRANSACTIONNEL,
  );
  assert.equal(facture.objet, "Votre facture n° FA-2026-0042");
});

test("l'empreinte du HTML est en hexadécimal minuscule sur 64 caractères", async () => {
  const rendu = await rendreMessage(
    "devisEnvoye",
    { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 100000 },
    CTX_TRANSACTIONNEL,
  );
  // C'est la contrainte exacte de `email_messages.body_html_sha256`.
  // Une empreinte en majuscules ferait échouer l'insertion au moment
  // d'envoyer une facture.
  assert.match(rendu.empreinteHtml, /^[0-9a-f]{64}$/);
});

test("le même message rendu deux fois donne la même empreinte", async () => {
  const variables = { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 100000 };
  const un = await rendreMessage("devisEnvoye", variables, CTX_TRANSACTIONNEL);
  const deux = await rendreMessage("devisEnvoye", variables, CTX_TRANSACTIONNEL);
  // Sans cela, « refabriquer le message et prouver que c'est le même »
  // serait un vœu : le journal ne garde que l'empreinte.
  assert.equal(un.empreinteHtml, deux.empreinteHtml);
});

// ══════════════════════════════════════════════════════════════════
// LE PIED D'IDENTITÉ ET SES TROUS
// ══════════════════════════════════════════════════════════════════

test("le pied porte les mentions légales du paysagiste, pas celles d'Oasis", async () => {
  const rendu = await rendreMessage(
    "devisEnvoye",
    { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 100000 },
    CTX_TRANSACTIONNEL,
  );
  for (const attendu of [
    "Jardins Dupont",
    "12345678900011",
    "FR00123456789",
    "3 chemin des Tilleuls",
    "DEC-2026-77",
  ]) {
    assert.ok(rendu.texte.includes(attendu), `« ${attendu} » figure au pied`);
  }
});

test("le pied dit comment répondre, parce que l'adresse d'expédition n'est pas celle du paysagiste", async () => {
  const rendu = await rendreMessage(
    "devisEnvoye",
    { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 100000 },
    CTX_TRANSACTIONNEL,
  );
  assert.ok(rendu.texte.includes("contact@jardins-dupont.example"));
  assert.match(rendu.texte, /Répondre/);
});

test("une identité trouée reste présentable : on n'écrit jamais « SIRET : non renseigné »", () => {
  // C'EST L'ÉTAT RÉEL DE LA PRODUCTION : sur la seule entreprise
  // existante, le SIRET, le numéro de TVA et la décennale manquent.
  const ligne = identiteEnUneLigne({ raisonSociale: "Paysages Martin" });
  assert.equal(ligne, "Paysages Martin");
  assert.ok(!/non renseign/i.test(ligne));
});

test("sans logo, l'en-tête montre le nom de l'entreprise plutôt qu'une case vide", async () => {
  const rendu = await rendreMessage(
    "devisEnvoye",
    { numero: "DV-1", nomClient: "Marie", totalTtcCentimes: 100000 },
    { ...CTX_TRANSACTIONNEL, identite: { ...IDENTITE, urlLogo: null } },
  );
  assert.ok(!rendu.html.includes("<img"));
  assert.ok(rendu.html.includes("Jardins Dupont"));
});

// ══════════════════════════════════════════════════════════════════
// L'ÉCHAPPEMENT ET L'INJECTION
// ══════════════════════════════════════════════════════════════════

test("un nom de client qui contient du balisage ne devient pas du balisage", async () => {
  const rendu = await rendreMessage(
    "devisEnvoye",
    {
      numero: "DV-1",
      nomClient: "<script>alert(1)</script>Dupont & Fils",
      totalTtcCentimes: 100000,
    },
    CTX_TRANSACTIONNEL,
  );
  // Un message part sous le nom d'une entreprise depuis un domaine
  // authentifié : c'est le support d'hameçonnage le plus crédible qui
  // soit, et une valeur venue d'une fiche client ne doit jamais y
  // injecter de balisage.
  assert.ok(!rendu.html.includes("<script>"));
  assert.ok(rendu.html.includes("&lt;script&gt;"));
  assert.ok(rendu.html.includes("Dupont &amp; Fils"));
});

test("un objet ne peut pas porter de retour à la ligne : ce serait une injection d'en-tête", () => {
  const propre = nettoyerObjet("Votre devis\r\nBcc: espion@ailleurs.example");
  assert.ok(!/[\r\n]/.test(propre));
  assert.equal(propre, "Votre devis Bcc: espion@ailleurs.example");
});

test("un objet vide devient un objet générique plutôt qu'un envoi perdu", () => {
  assert.equal(nettoyerObjet("   "), "Message de votre paysagiste");
});

test("un objet trop long est coupé proprement", () => {
  const long = nettoyerObjet("a".repeat(400));
  assert.ok(long.length <= 250);
  assert.ok(long.endsWith("…"));
});

test("un lien non chiffré n'est pas rendu du tout, plutôt que rendu mort", () => {
  assert.equal(urlSure("http://exemple.fr"), null);
  assert.equal(urlSure("javascript:alert(1)"), null);
  assert.equal(urlSure("https://exemple.fr/a b"), null);
  assert.equal(urlSure("https://exemple.fr/devis"), "https://exemple.fr/devis");
});

test("un bouton dont l'URL est refusée disparaît, et n'écrit pas un lien vide", async () => {
  const rendu = await rendreMessage(
    "invitationPortail",
    { nomClient: "Marie", lienInvitation: "http://pas-chiffre.example", expireLe: "2026-10-01" },
    CTX_TRANSACTIONNEL,
  );
  assert.ok(!rendu.html.includes("<a href"));
});

// ══════════════════════════════════════════════════════════════════
// LES FORMATS
// ══════════════════════════════════════════════════════════════════

test("un montant absent rend null, et le gabarit n'affiche alors pas la ligne", async () => {
  // `formatCents` du reste du produit rend « — », ce qui est juste dans
  // un tableau et faux dans un message : « Votre facture s'élève à — »
  // part chez le client et il appelle son paysagiste.
  assert.equal(formaterMontant(null), null);
  assert.equal(formaterMontant(undefined), null);
  assert.equal(formaterMontant(Number.NaN), null);

  const rendu = await rendreMessage(
    "factureEmise",
    { numero: "FA-1", nomClient: "Marie", totalTtcCentimes: Number.NaN },
    CTX_TRANSACTIONNEL,
  );
  // La ligne disparaît entièrement plutôt que d'annoncer « Montant
  // TTC : — », qui part chez le client et le fait appeler.
  assert.ok(!rendu.texte.includes("Montant TTC"));
  assert.ok(!/Montant[^\n]*—/.test(rendu.texte));
});

test("une date s'écrit en toutes lettres : 05/09 se lit « 9 mai » ailleurs qu'en France", () => {
  assert.equal(formaterDate("2026-09-05"), "5 septembre 2026");
  assert.equal(formaterDate(null), null);
  assert.equal(formaterDate("pas une date"), null);
});

test("l'échappement couvre les cinq caractères qui comptent", () => {
  assert.equal(echapperHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

// ══════════════════════════════════════════════════════════════════
// LE CORPS D'UNE ANNONCE EST DU TEXTE, PAS DU BALISAGE
// ══════════════════════════════════════════════════════════════════

test("le texte rédigé par un administrateur est découpé en paragraphes et échappé", async () => {
  const rendu = await rendreMessage(
    "annonceCommerciale",
    {
      nomEntreprise: "Jardins Dupont",
      objet: "Nouveauté",
      corpsTexte: "Premier paragraphe.\n\n<b>Deuxième</b> paragraphe.",
    },
    CTX_PUBLICITE,
  );
  assert.ok(rendu.html.includes("Premier paragraphe."));
  assert.ok(rendu.html.includes("&lt;b&gt;Deuxième&lt;/b&gt;"));
  assert.ok(!rendu.html.includes("<b>Deuxième</b>"));
});

test("un jeton de désabonnement vide fait échouer le rendu plutôt que produire un lien mort", async () => {
  await assert.rejects(
    () =>
      rendreMessage(
        "annonceCommerciale",
        { nomEntreprise: "X", objet: "O", corpsTexte: "C" },
        { ...CTX_PUBLICITE, jetonDesabonnement: "   " },
      ),
    /jeton de désabonnement/i,
  );
});

test("rendre une publicité dans un contexte transactionnel est refusé à l'exécution aussi", async () => {
  await assert.rejects(
    () =>
      // Le typage l'interdit — c'est justement le garde-fou. Le test
      // prouve que l'exécution le refuse AUSSI, pour l'appelant qui
      // vient du JSON de la file et qui n'a pas de type.
      rendreMessage(
        "annonceCommerciale",
        { nomEntreprise: "X", objet: "O", corpsTexte: "C" },
        // @ts-expect-error — la nature du contexte ne correspond pas.
        CTX_TRANSACTIONNEL,
      ),
    /nature/i,
  );
});

// ══════════════════════════════════════════════════════════════════
// LE NOM DU TRANSPORTEUR NE SORT PAS DE SON IMPLÉMENTATION
// ══════════════════════════════════════════════════════════════════
//
// « Aucun appel au transporteur ne doit exister ailleurs que dans son
// implémentation ; si un gabarit, un écran ou une fonction métier le
// nomme, c'est un défaut. » Cette épreuve le vérifie sur les FICHIERS
// plutôt que sur la bonne volonté : la promesse « qui transporte est un
// réglage » se perd une chaîne à la fois, et l'on ne s'en aperçoit que
// le jour où l'on veut changer de prestataire.
//
// Les commentaires sont épargnés : expliquer pourquoi on a choisi ce
// prestataire est utile, et une épreuve qui l'interdirait pousserait à
// ne plus expliquer.

test("aucun fichier de ce dossier ne nomme un transporteur, sauf son implémentation", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  // `fileURLToPath` et pas `url.pathname` : sur un chemin qui contient
  // une espace — « OASIS CARE » — le second rend « %20 » et le dossier
  // devient introuvable.
  const { fileURLToPath } = await import("node:url");
  const ici = path.dirname(fileURLToPath(import.meta.url));

  async function fichiersSous(dossier: string): Promise<string[]> {
    const entrees = await readdir(dossier, { withFileTypes: true });
    const trouves: string[] = [];
    for (const entree of entrees) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) trouves.push(...(await fichiersSous(complet)));
      else if (entree.name.endsWith(".ts")) trouves.push(complet);
    }
    return trouves;
  }

  function sansCommentaires(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((ligne) => ligne.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n");
  }

  // QUATRE FICHIERS ONT LE DROIT DE LE NOMMER, ET PAS UN DE PLUS :
  //   brevo.ts, brevo-api.ts  — ILS SONT l'implémentation ;
  //   envoyeur.ts             — l'aiguillage, exactement comme
  //                             `getBillingProvider()` nomme
  //                             `construireStripeBillingProvider` ;
  //   index.ts                — la surface publique, qui réexporte.
  // Les fichiers d'épreuve le nomment pour l'éprouver.
  const permis = new Set(["brevo.ts", "brevo-api.ts", "envoyeur.ts", "index.ts"]);
  const transporteurs = /\b(brevo|sendinblue|sendgrid|mailgun|postmark|resend|nodemailer)\b/i;

  const coupables: string[] = [];
  for (const fichier of await fichiersSous(ici)) {
    const nom = path.basename(fichier);
    if (permis.has(nom) || nom.endsWith(".test.ts")) continue;
    if (transporteurs.test(sansCommentaires(await readFile(fichier, "utf8")))) {
      coupables.push(path.relative(ici, fichier));
    }
  }

  assert.deepEqual(coupables, [], "Le nom d'un transporteur est sorti de son implémentation.");
});
