import { test } from "node:test";
import assert from "node:assert/strict";

import {
  annoncerEngagement,
  engagementEnCours,
  formaterJour,
  phraseResiliation,
  preuveDepuisAnnonce,
  verifierAcceptation,
  verifierPreuve,
  verifierTarifAnnonce,
  type AnnonceEngagement,
  type LigneRemise,
  type OffreEngageante,
} from "./engagement.ts";

/**
 * LES CHIFFRES DU TARIF FONDATEUR, TELS QUE 0081 LES SÈME.
 *
 * 49,90 € HT par mois pendant douze mois sur l'offre Pro (`team`,
 * 79,90 € HT). Tous hors taxes — c'est la règle de calcul de toute la
 * chaîne, pas une préférence d'affichage.
 */
const FONDATEUR_PENDANT = 4990;
const PRO_PUBLIC = 7990;
const DOUZE_MOIS = 12;

function offre(patch: Partial<OffreEngageante> = {}): OffreEngageante {
  return {
    code: "FONDATEUR",
    label: "Tarif fondateur",
    planKey: "team",
    dureeMois: DOUZE_MOIS,
    prixPendantHtCents: FONDATEUR_PENDANT,
    ...patch,
  };
}

/**
 * LE CALENDRIER DE RÉFÉRENCE DES TESTS.
 *
 * L'engagement démarre au PREMIER PRÉLÈVEMENT — donc, quand il y a un
 * essai, un mois après la souscription. Les tests fixent la date plutôt
 * que d'employer « aujourd'hui » : une assertion sur une date de fin
 * calculée depuis `new Date()` passerait onze mois sur douze et
 * tomberait le 29 février.
 */
const DEBUT_ENGAGEMENT = { debutLe: "2026-10-06" };

function annonce(): AnnonceEngagement {
  const resultat = annoncerEngagement(offre(), PRO_PUBLIC, DEBUT_ENGAGEMENT);
  assert.notEqual(resultat, null, "l'annonce du tarif fondateur doit être calculable");
  return resultat as AnnonceEngagement;
}

// ------------------------------------------------------------------
// a. ANNONCER AVANT
// ------------------------------------------------------------------

test("les TROIS chiffres sont annoncés, et tous portent la mention HT", () => {
  // C'est l'exigence entière : la durée, le prix pendant, le prix
  // après. Deux sur trois, c'est une promesse dont il manque la fin.
  const a = annonce();
  assert.equal(a.dureeMois, 12);
  assert.equal(a.prixPendant, "49,90 € HT / mois");
  assert.equal(a.prixApres, "79,90 € HT / mois");
  assert.equal(a.badge, "Engagement 12 mois");
});

test("l'annonce dit QUAND le prix change, pas seulement qu'il change", () => {
  // « puis 79,90 € » sans date laisse croire à un changement lointain.
  assert.equal(annonce().quandLePrixChange, "au 13e mois");
});

test("la phrase d'acceptation porte les trois chiffres ET l'interdit", () => {
  // La case à cocher doit se suffire à elle-même : quelqu'un qui ne lit
  // que cette ligne-là doit déjà savoir à quoi il s'engage.
  const phrase = annonce().phraseAcceptation;
  assert.match(phrase, /12 mois/);
  assert.match(phrase, /49,90 € HT \/ mois/);
  assert.match(phrase, /79,90 € HT \/ mois/);
  assert.match(phrase, /ne peut pas être résilié/);
});

test("SANS PRIX PUBLIC, ON N'ANNONCE RIEN", () => {
  // 0081 refuse de poser l'engagement quand l'offre visée n'a pas de
  // tarif public : « le prix d'APRÈS ne peut pas être annoncé, donc
  // l'engagement ne peut pas être accepté ». L'écran suit la même règle
  // plutôt que d'afficher deux chiffres sur trois.
  assert.equal(annoncerEngagement(offre(), null, DEBUT_ENGAGEMENT), null);
});

test("le prix d'après SUIT la grille, il n'est pas recopié", () => {
  // Le jour où Pro passe à 89,90, l'annonce doit dire 89,90 sans qu'on
  // touche à une ligne de code. C'est pour cela que le prix public est
  // un paramètre et non une constante.
  const a = annoncerEngagement(offre(), 8990, DEBUT_ENGAGEMENT);
  assert.equal(a?.prixApres, "89,90 € HT / mois");
});

test("une durée d'un mois annonce le deuxième mois, pas le « 2er »", () => {
  const a = annoncerEngagement(offre({ dureeMois: 1 }), PRO_PUBLIC, DEBUT_ENGAGEMENT);
  assert.equal(a?.quandLePrixChange, "au 2e mois");
});

test("L'ANNONCE PORTE LES DEUX DATES DE L'ENGAGEMENT, CALCULÉES", () => {
  // « Douze mois » se compte de tête et se compte mal ; « jusqu'au
  // 6 octobre 2027 » se relit. L'écran doit afficher la date de fin
  // AVANT que la case ne soit cochée.
  const a = annonce();
  assert.equal(a.debutEngagementLe, "2026-10-06");
  assert.equal(a.finEngagementLe, "2027-10-06");
  assert.equal(a.periodeEngagement, "du 6 octobre 2026 au 6 octobre 2027");
  assert.match(a.resume, /du 6 octobre 2026 au 6 octobre 2027/);
});

test("LA PHRASE ACCEPTÉE PORTE LA DATE DE FIN, pas seulement la durée", () => {
  // C'est cette phrase-là que le client coche, et c'est elle qu'on lui
  // rappellera le jour où il voudra partir.
  assert.match(annonce().phraseAcceptation, /du 6 octobre 2026 au 6 octobre 2027/);
});

test("L'ESSAI DÉCALE L'ENGAGEMENT D'UN MOIS, ET L'ANNONCE LE DIT", () => {
  // ══════════════════════════════════════════════════════════════
  // LA RÈGLE DU SOCLE, VUE DEPUIS L'ÉCRAN
  // ══════════════════════════════════════════════════════════════
  //
  // L'essai ne compte pas dans l'engagement : les deux partent du
  // premier prélèvement. Poser la remise le jour de la souscription
  // ferait payer ONZE mois à 49,90 € au lieu de douze, et le douzième
  // basculerait au tarif public sans que personne l'ait annoncé.
  //
  // Le client qui entre par l'essai voit donc une fin d'engagement un
  // mois plus tard que celui qui paie tout de suite — et c'est
  // l'affichage honnête, parce que c'est ce que la base posera.
  const parEssai = annoncerEngagement(offre(), PRO_PUBLIC, { debutLe: "2026-10-06" });
  const toutDeSuite = annoncerEngagement(offre(), PRO_PUBLIC, { debutLe: "2026-09-06" });

  assert.equal(parEssai?.finEngagementLe, "2027-10-06");
  assert.equal(toutDeSuite?.finEngagementLe, "2027-09-06");
});

test("un engagement démarré un 31 janvier finit un 31 janvier", () => {
  // 0081 pose `starts_on + interval 'N months'` : douze mois retombent
  // sur le même quantième, sauf le 29 février.
  const a = annoncerEngagement(offre(), PRO_PUBLIC, { debutLe: "2026-01-31" });
  assert.equal(a?.finEngagementLe, "2027-01-31");

  const bissextile = annoncerEngagement(offre(), PRO_PUBLIC, { debutLe: "2028-02-29" });
  assert.equal(bissextile?.finEngagementLe, "2029-02-28");
});

// ------------------------------------------------------------------
// b. LE GESTE SÉPARÉ, VÉRIFIÉ AU SERVEUR
// ------------------------------------------------------------------

test("sans engagement, rien n'est exigé", () => {
  // La majorité des souscriptions n'engagent à rien. Leur imposer une
  // case ferait de l'acceptation un réflexe plutôt qu'un acte.
  const verdict = verifierAcceptation({
    annonce: null,
    cochee: false,
    versionAcceptee: null,
    versionCourante: "2026-01",
    engageJusquAu: null,
  });
  assert.equal(verdict.ok, true);
});

test("UN ENGAGEMENT QU'ON N'A PAS PU ANNONCER FERME LA CAISSE", () => {
  // ══════════════════════════════════════════════════════════════
  // LE TEST LE PLUS IMPORTANT DE CE FICHIER
  // ══════════════════════════════════════════════════════════════
  //
  // « Pas d'annonce → rien à vérifier » se lisait comme le comportement
  // sûr. Il ne l'était que si l'annonce manquait faute d'engagement.
  // Or elle manque AUSSI quand on n'a pas pu la lire — et c'est le cas
  // COURANT : le catalogue `discount_offers` est réservé aux
  // administrateurs par sa RLS, et une RLS FILTRE, elle ne lève pas. La
  // lecture rend « rien », exactement comme s'il n'y avait rien.
  //
  // Pendant ce temps la remise ACCORDÉE, elle, est lisible par le
  // client et la composition l'appliquait : 49,90 € prélevés, douze
  // mois verrouillés en base, et aucune des quatre exigences —
  // case dédiée, texte affiché, tarif vérifié, preuve conservée — n'était
  // honorée. Le client ne voyait nulle part le mot « engagement ».
  const verdict = verifierAcceptation({
    annonce: null,
    cochee: false,
    versionAcceptee: null,
    versionCourante: "2026-01",
    // La remise POSÉE engage jusqu'à cette date. C'est la seule marque
    // d'engagement que le client puisse lire.
    engageJusquAu: "2027-01-01",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "engagementNonAnnoncable");
});

test("…et cocher la case ne suffit pas à contourner ce refus", () => {
  // Le refus ne tient pas à la case : il tient au fait qu'on ne peut
  // PAS montrer les conditions. Cocher une case sur un texte absent ne
  // prouve rien.
  const verdict = verifierAcceptation({
    annonce: null,
    cochee: true,
    versionAcceptee: "2026-01",
    versionCourante: "2026-01",
    engageJusquAu: "2027-01-01",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "engagementNonAnnoncable");
});

test("LA CASE NON COCHÉE BLOQUE LE PAIEMENT", () => {
  // C'est la raison d'être de la fonction, et elle est appelée par le
  // SERVEUR : un `fetch` fabriqué à la main ne voit pas la case.
  const verdict = verifierAcceptation({
    annonce: annonce(),
    cochee: false,
    versionAcceptee: "2026-01",
    versionCourante: "2026-01",
    engageJusquAu: null,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "engagementNonAccepte");
  // Le motif dit la durée : « acceptation manquante » n'apprend rien.
  assert.match(verdict.ok === false ? verdict.motif : "", /12 mois/);
});

test("la case cochée devant le bon texte laisse passer", () => {
  const verdict = verifierAcceptation({
    annonce: annonce(),
    cochee: true,
    versionAcceptee: "2026-01",
    versionCourante: "2026-01",
    engageJusquAu: null,
  });
  assert.equal(verdict.ok, true);
});

test("UN TEXTE CHANGÉ DEPUIS L'AFFICHAGE FAIT REFUSER", () => {
  // L'onglet est resté ouvert une semaine, le texte a été réécrit
  // depuis. Accepter ici enregistrerait comme preuve un texte que
  // personne n'a lu — et une preuve fausse est pire que pas de preuve.
  const verdict = verifierAcceptation({
    annonce: annonce(),
    cochee: true,
    versionAcceptee: "2026-01",
    versionCourante: "2026-06",
    engageJusquAu: null,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "texteEngagementModifie");
});

test("PAS DE TEXTE PUBLIÉ, PAS D'ENCAISSEMENT", () => {
  // Sans texte il n'y a rien à accepter, donc rien à prouver. On refuse
  // pendant qu'il est encore temps de ne rien prélever, plutôt que de
  // laisser 0081 refuser la remise après l'encaissement.
  const verdict = verifierAcceptation({
    annonce: annonce(),
    cochee: true,
    versionAcceptee: "2026-01",
    versionCourante: null,
    engageJusquAu: null,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "texteEngagementAbsent");
});

test("une case cochée SANS version acceptée ne passe pas", () => {
  // Un client fabriqué à la main qui poste `{cochee: true}` et rien
  // d'autre ne doit pas franchir la porte : la version est la preuve
  // qu'un texte a bien été affiché.
  const verdict = verifierAcceptation({
    annonce: annonce(),
    cochee: true,
    versionAcceptee: null,
    versionCourante: "2026-01",
    engageJusquAu: null,
  });
  assert.equal(verdict.ok, false);
});

// ------------------------------------------------------------------
// CE QUI EST ANNONCÉ EST CE QUI SERA PRÉLEVÉ
// ------------------------------------------------------------------

test("ANNONCER 49,90 ET PRÉLEVER 79,90 EST REFUSÉ", () => {
  // Le piège central : la carte annonce le tarif fondateur parce qu'il
  // existe au catalogue, mais aucune remise n'est posée sur cette
  // entreprise — le prélèvement partirait au tarif public, après une
  // case cochée disant l'inverse.
  const verdict = verifierTarifAnnonce({ annonce: annonce(), remiseAppliquee: null });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "tarifAnnonceNonApplique");
  assert.match(verdict.ok === false ? verdict.motif : "", /rien n'a été prélevé/);
});

test("une AUTRE remise que celle annoncée est refusée", () => {
  const verdict = verifierTarifAnnonce({
    annonce: annonce(),
    remiseAppliquee: { code: "BIENVENUE", prixRemiseHtCents: FONDATEUR_PENDANT },
  });
  assert.equal(verdict.ok, false);
});

test("un montant différent de celui affiché est refusé", () => {
  // Même code de remise, mais la base a été modifiée entre l'affichage
  // et le clic. On ne prélève jamais un montant que la page n'a pas
  // montré.
  const verdict = verifierTarifAnnonce({
    annonce: annonce(),
    remiseAppliquee: { code: "FONDATEUR", prixRemiseHtCents: 5990 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "montantAnnonceDifferent");
});

test("la remise annoncée ET appliquée au bon montant passe", () => {
  const verdict = verifierTarifAnnonce({
    annonce: annonce(),
    remiseAppliquee: { code: "FONDATEUR", prixRemiseHtCents: FONDATEUR_PENDANT },
  });
  assert.equal(verdict.ok, true);
});

test("sans engagement, ce contrôle ne s'applique pas", () => {
  assert.equal(verifierTarifAnnonce({ annonce: null, remiseAppliquee: null }).ok, true);
});

// ------------------------------------------------------------------
// c. LA PREUVE
// ------------------------------------------------------------------

test("SANS TRACE ENREGISTRÉE, ON N'ENCAISSE PAS L'ENGAGEMENT", () => {
  // Cocher est un geste ; il ne devient une preuve que s'il laisse une
  // trace. Encaisser douze mois qu'on ne saurait pas démontrer, c'est
  // s'exposer à devoir tout rembourser à la première contestation.
  const verdict = verifierPreuve({
    annonce: annonce(),
    preuveEnregistree: null,
    versionAffichee: "2026-01",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "preuveManquante");
});

test("une trace qui porte un AUTRE texte prouve autre chose", () => {
  const verdict = verifierPreuve({
    annonce: annonce(),
    preuveEnregistree: { version: "2025-06", discountCode: "FONDATEUR" },
    versionAffichee: "2026-01",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "preuveObsolete");
});

test("une trace du bon texte et de la bonne remise laisse passer", () => {
  const verdict = verifierPreuve({
    annonce: annonce(),
    preuveEnregistree: { version: "2026-01", discountCode: "FONDATEUR" },
    versionAffichee: "2026-01",
  });
  assert.equal(verdict.ok, true);
});

test("sans engagement, aucune trace n'est exigée", () => {
  const verdict = verifierPreuve({
    annonce: null,
    preuveEnregistree: null,
    versionAffichee: null,
  });
  assert.equal(verdict.ok, true);
});

test("la preuve conserve LE TEXTE, pas une référence vers lui", () => {
  // Une trace qui dit « a accepté » sans conserver ce qu'il a lu ne
  // vaut rien le jour où l'écran aura changé — et il changera.
  const preuve = preuveDepuisAnnonce("org-1", annonce(), {
    version: "2026-01",
    texte: "Engagement de douze mois. …",
  });
  assert.equal(preuve?.termsText, "Engagement de douze mois. …");
  assert.equal(preuve?.termsVersion, "2026-01");
});

test("la preuve fige les trois chiffres annoncés ce jour-là", () => {
  // Ils sont dérivables aujourd'hui ; ils ne le seront plus quand la
  // grille aura bougé, et c'est justement ce à quoi une preuve doit
  // résister.
  const preuve = preuveDepuisAnnonce("org-1", annonce(), {
    version: "2026-01",
    texte: "…",
  });
  assert.equal(preuve?.commitmentMonths, 12);
  assert.equal(preuve?.monthlyPriceDuringCents, FONDATEUR_PENDANT);
  assert.equal(preuve?.monthlyPriceAfterCents, PRO_PUBLIC);
  assert.equal(preuve?.planKey, "team");
  assert.equal(preuve?.discountCode, "FONDATEUR");
});

test("sans engagement, aucune preuve n'est fabriquée", () => {
  // Une preuve vide enregistrée « au cas où » ferait croire, à la
  // relecture, qu'un engagement a été accepté là où il n'y en avait pas.
  assert.equal(preuveDepuisAnnonce("org-1", null, { version: "v", texte: "t" }), null);
  assert.equal(preuveDepuisAnnonce("org-1", annonce(), null), null);
});

// ------------------------------------------------------------------
// L'ENGAGEMENT DÉJÀ EN COURS
// ------------------------------------------------------------------

function remise(patch: Partial<LigneRemise> = {}): LigneRemise {
  return {
    code: "FONDATEUR",
    label: "Tarif fondateur",
    appliesToPlan: "team",
    valueCents: FONDATEUR_PENDANT,
    endsOn: "2027-03-01",
    commitmentEndsOn: "2027-03-01",
    cancelledAt: null,
    ...patch,
  };
}

test("l'engagement court jusqu'à son dernier jour INCLUS", () => {
  // Le 1er mars, on est encore engagé. Libérer la veille au soir
  // raccourcirait le contrat d'un jour, en faveur du client cette
  // fois-ci — mais une règle qui se trompe d'un jour se trompera dans
  // l'autre sens un jour aussi.
  assert.notEqual(engagementEnCours([remise()], "2027-03-01"), null);
  assert.equal(engagementEnCours([remise()], "2027-03-02"), null);
});

test("une remise ANNULÉE n'engage plus", () => {
  // On ne retient pas quelqu'un sur une remise qu'on lui a retirée.
  const lignes = [remise({ cancelledAt: "2026-09-01T10:00:00Z" })];
  assert.equal(engagementEnCours(lignes, "2026-09-05"), null);
});

test("une remise SANS engagement ne retient personne", () => {
  // `commitment_ends_on` nulle veut dire « la remise n'engage à rien ».
  const lignes = [remise({ commitmentEndsOn: null })];
  assert.equal(engagementEnCours(lignes, "2026-09-05"), null);
});

test("deux engagements superposés libèrent à la fin du PLUS TARDIF", () => {
  // Prendre le premier libérerait trop tôt, et le client partirait au
  // milieu d'un engagement qu'il a bien accepté.
  const lignes = [
    remise({ commitmentEndsOn: "2027-03-01", endsOn: "2027-03-01" }),
    remise({ code: "PROLONGATION", commitmentEndsOn: "2027-09-01", endsOn: "2027-09-01" }),
  ];
  assert.equal(engagementEnCours(lignes, "2026-09-05")?.finLe, "2027-09-01");
});

test("les deux dates ne se confondent pas : fin de remise ≠ fin d'engagement", () => {
  // Sur le fondateur elles tombent le même jour ; rien ne garantit
  // qu'une remise future fera de même, et c'est `commitment_ends_on`
  // seule que la résiliation interroge.
  const lignes = [remise({ endsOn: "2027-03-01", commitmentEndsOn: "2027-09-01" })];
  const cours = engagementEnCours(lignes, "2026-09-05");
  assert.equal(cours?.finRemiseLe, "2027-03-01");
  assert.equal(cours?.finLe, "2027-09-01");
});

test("la date affichée ne glisse jamais d'un jour", () => {
  // `new Date("2027-03-01")` est minuit UTC : affiché dans un fuseau
  // négatif, il rendrait « 28 février ». Une date de calendrier n'a pas
  // d'heure, et lui en inventer une est le seul moyen de se tromper.
  assert.equal(formaterJour("2027-03-01"), "1 mars 2027");
  assert.equal(formaterJour("2027-01-01"), "1 janvier 2027");
});

test("la résiliation n'est PAS en libre-service, et l'écran le dit avec la date", () => {
  // Un bouton « annuler » qui n'annule pas serait un mensonge ; un
  // bouton qui annulerait serait une rupture de contrat. On explique,
  // on donne la date, on renvoie vers quelqu'un.
  const cours = engagementEnCours([remise()], "2026-09-05");
  assert.notEqual(cours, null);
  const phrase = phraseResiliation(cours!);
  assert.match(phrase, /1 mars 2027/);
  assert.match(phrase, /ne peut pas être résilié/);
  assert.match(phrase, /49,90 € HT/);
});
