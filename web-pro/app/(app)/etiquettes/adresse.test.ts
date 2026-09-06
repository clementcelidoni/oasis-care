import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_ETALON,
  CHEMIN_RESOLVEUR,
  JETON_EXEMPLE,
  VARIABLE_ADRESSE,
  VARIABLE_REPLI,
  analyserAdresse,
  analyserOrigine,
  urlEtiquette,
  urlExemple,
} from "./adresse.ts";

/**
 * L'ADRESSE IMPRIMÉE — la décision à dix ans, tenue par des tests.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS EMPÊCHENT DE SE REPRODUIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Cinq étiquettes de production portent `oasis-care.example`. Le
 * domaine de premier niveau `.example` est RÉSERVÉ par la RFC 2606 :
 * il ne résout pas, il ne résoudra jamais, aucun enregistrement n'est
 * possible. C'était une constante dans un fichier Swift, relue par
 * personne.
 *
 * Le remède tient en deux règles, et chacune a ses tests ici :
 *   • l'adresse vient d'une variable d'environnement, jamais du code ;
 *   • ce qui n'est pas une origine exploitable est REFUSÉ, pas deviné.
 *
 * ON REFUSE PLUTÔT QUE DE DEVINER, et ce n'est pas de la rigidité :
 * une planche de deux cents autocollants partie vers nulle part, ce
 * sont deux cents autocollants à décoller un par un sur des pots déjà
 * en rayon. Un écran qui dit « posez cette variable » coûte trente
 * secondes.
 *
 * AUCUN APPEL RÉSEAU : `analyserAdresse` reçoit son environnement en
 * argument, ce qui est aussi la raison pour laquelle il est testable.
 */

test("une origine https nue est acceptée et normalisée", () => {
  for (const brut of [
    "https://oasisrarecare.fr",
    "https://oasisrarecare.fr/",
    "  https://oasisrarecare.fr  ",
  ]) {
    const { base, probleme } = analyserOrigine(brut);
    assert.equal(base, "https://oasisrarecare.fr", `refusé : ${brut}`);
    assert.equal(probleme, null);
  }
});

test("le http en clair est refusé — un QR est scanné sur des réseaux qu'on ne choisit pas", () => {
  const { base, probleme } = analyserOrigine("http://oasisrarecare.fr");
  assert.equal(base, null);
  assert.match(probleme ?? "", /en https/);
});

test("localhost n'est PAS toléré, et c'est la bibliothèque qui tranche", () => {
  // On pourrait croire utile d'accepter http://localhost pour vérifier
  // une cote en développement. La bibliothèque refuse, et elle a
  // raison : un QR qui pointe vers localhost est mort à la seconde où
  // l'autocollant quitte la machine qui l'a imprimé. Pour éprouver des
  // cotes en local, on pose la VRAIE adresse — ce sont les millimètres
  // qu'on teste, pas la résolution.
  const verdict = analyserOrigine("http://localhost:3000");
  assert.equal(verdict.base, null);
  assert.match(verdict.probleme ?? "", /https/);
});

test("les domaines réservés par la RFC 2606 sont refusés — c'est le défaut qu'on répare", () => {
  // « oasis-care.example » est exactement ce que portent les cinq
  // étiquettes déjà collées. Qu'on ne puisse plus le configurer par
  // accident est le premier acquis de ce chantier. Le refus vient de
  // `lib/etiquettes/adresse.ts`, à qui l'on délègue le verdict : un
  // seul validateur, donc un seul comportement.
  for (const mort of [
    "https://oasis-care.example",
    "https://etiquettes.invalid",
    "https://exemple.test",
  ]) {
    const { base, probleme } = analyserOrigine(mort);
    assert.equal(base, null, `accepté à tort : ${mort}`);
    assert.match(probleme ?? "", /RFC 2606/);
  }
});

test("une adresse avec un chemin est refusée : elle décalerait la route du résolveur", () => {
  // « https://exemple.fr/app » + « /x/jeton » donnerait « /app/x/jeton »,
  // qui n'est pas la route du résolveur. Deux cents QR vers une 404.
  for (const brut of [
    "https://exemple.fr/app",
    "https://exemple.fr/?utm=1",
    "https://exemple.fr/#ancre",
  ]) {
    const { base, probleme } = analyserOrigine(brut);
    assert.equal(base, null, `accepté à tort : ${brut}`);
    assert.match(probleme ?? "", /origine seule/);
  }
});

test("ce qui n'est pas une adresse du tout est refusé avec une phrase lisible", () => {
  const { base, probleme } = analyserOrigine("oasisrarecare.fr");
  assert.equal(base, null);
  assert.match(probleme ?? "", /origine complète/);
});

test("une variable vide n'est pas une faute : c'est une absence", () => {
  // La distinction compte. Une variable absente enclenche le repli ;
  // une variable FAUSSE doit s'arrêter là, sans repli silencieux.
  assert.deepEqual(analyserOrigine(""), { base: null, probleme: null });
  assert.deepEqual(analyserOrigine(undefined), { base: null, probleme: null });
});

// ══════════════════════════════════════════════════════════════════
// LA PRÉCÉDENCE DES DEUX VARIABLES
// ══════════════════════════════════════════════════════════════════

test("la variable dédiée gagne sur celle du site", () => {
  const adresse = analyserAdresse({
    [VARIABLE_ADRESSE]: "https://oasisrarecare.fr",
    [VARIABLE_REPLI]: "https://app.exemple.fr",
  });
  assert.equal(adresse.base, "https://oasisrarecare.fr");
  assert.equal(adresse.origine, "dediee");
  assert.equal(adresse.probleme, null);
});

test("sans variable dédiée, on se replie sur celle du site — et on le dit", () => {
  const adresse = analyserAdresse({ [VARIABLE_REPLI]: "https://app.exemple.fr" });
  assert.equal(adresse.base, "https://app.exemple.fr");
  // L'origine « repli » est ce qui fait afficher l'avertissement :
  // graver le domaine du site sur dix ans d'autocollants est une
  // décision, pas un défaut de configuration.
  assert.equal(adresse.origine, "repli");
});

test("une variable dédiée FAUSSE ne se replie pas en silence", () => {
  // C'est le piège classique : quelqu'un pose l'adresse avec un chemin
  // en trop, la validation la rejette, et un repli silencieux enverrait
  // la planche vers l'autre domaine. Il faut que ça s'arrête.
  const adresse = analyserAdresse({
    [VARIABLE_ADRESSE]: "https://oasisrarecare.fr/etiquettes",
    [VARIABLE_REPLI]: "https://app.exemple.fr",
  });
  assert.equal(adresse.base, null);
  assert.equal(adresse.origine, "aucune");
  assert.match(adresse.probleme ?? "", /origine seule/);
});

test("sans aucune variable, on n'imprime pas, et la phrase dit quoi faire", () => {
  const adresse = analyserAdresse({});
  assert.equal(adresse.base, null);
  assert.equal(adresse.origine, "aucune");
  assert.match(adresse.probleme ?? "", new RegExp(VARIABLE_ADRESSE));
  assert.match(adresse.probleme ?? "", /décoller/);
});

test("sans configuration, l'étalon sert à mesurer et ne peut pas être imprimé", () => {
  // La règle du chantier, vérifiée mécaniquement plutôt que promise :
  // aucune adresse imprimable n'est écrite dans le code. L'étalon est
  // en `.invalid`, réservé par la RFC 2606 — la bibliothèque le
  // REFUSERAIT si on tentait de le faire passer par le chemin normal,
  // et c'est cette impossibilité qui garantit qu'il ne finira jamais
  // sur du papier.
  const adresse = analyserAdresse({});
  assert.equal(adresse.base, null);
  assert.match(urlExemple(null), new RegExp(`^${BASE_ETALON}/`));
  assert.throws(() => urlEtiquette(BASE_ETALON, JETON_EXEMPLE), /RFC 2606/);
});

test("l'étalon a EXACTEMENT la longueur du domaine proposé", () => {
  // Sans cela, le verdict de lisibilité affiché avant configuration
  // serait celui d'une autre adresse que la vraie — donc un mensonge
  // dans le seul panneau censé dire la vérité sur la densité.
  assert.equal(urlExemple(null).length, urlExemple("https://oasisrarecare.fr").length);
  assert.equal(`${BASE_ETALON}/x/`.length, "https://oasisrarecare.fr/x/".length);
});

// ══════════════════════════════════════════════════════════════════
// L'ADRESSE COMPLÈTE
// ══════════════════════════════════════════════════════════════════

test("l'adresse d'une étiquette est l'origine, le chemin du résolveur, le jeton", () => {
  assert.equal(
    urlEtiquette("https://oasisrarecare.fr", "abc123"),
    "https://oasisrarecare.fr/x/abc123",
  );
  assert.equal(CHEMIN_RESOLVEUR, "x");
});

test("le jeton d'exemple a la longueur RÉELLE d'un jeton de la base", () => {
  // Trente-deux caractères hexadécimaux, ce que produit
  // `encode(gen_random_bytes(16), 'hex')`. Un exemple plus court
  // mentirait sur la version du QR, donc sur la taille d'un module,
  // donc sur la possibilité de scanner — c'est tout l'objet du panneau
  // de densité de l'éditeur.
  assert.equal(JETON_EXEMPLE.length, 32);
  assert.match(JETON_EXEMPLE, /^[0-9a-f]{32}$/);
});

test("l'adresse complète fait bien 59 caractères avec le domaine proposé", () => {
  // Le chiffre qui décide de la version du QR : 27 caractères
  // d'origine et de chemin, plus 32 de jeton. C'est ce que mesure
  // `lib/etiquettes/densite.ts`, et c'est ce qui rend le modèle BioLab
  // 40 × 20 tout juste illisible aujourd'hui — voir `modeles.test.ts`.
  const url = urlEtiquette("https://oasisrarecare.fr", JETON_EXEMPLE);
  assert.equal(url.length, 59);
  assert.equal("https://oasisrarecare.fr/x/".length, 27);
});
