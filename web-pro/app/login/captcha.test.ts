// LES PREUVES SUR LA VÉRIFICATION ANTI-ROBOT.
//
//     node --test --experimental-strip-types "app/login/captcha.test.ts"
//
// ══════════════════════════════════════════════════════════════════
// COMMENT ON TESTE UN WIDGET QU'ON NE PEUT PAS CHARGER
// ══════════════════════════════════════════════════════════════════
//
// AUCUN APPEL RÉSEAU, ET C'EST LA CONTRAINTE QUI A FAÇONNÉ LE CODE.
// Le widget de Cloudflare exige un navigateur, un réseau et un serveur
// qui répond : il ne se teste pas, et le simuler ne prouverait que la
// justesse du simulacre.
//
// La sortie est la même que partout ailleurs dans ce dépôt :
//
//   1. TOUTE LA DÉCISION EST EXTRAITE EN FONCTIONS PURES, dans
//      `captcha.ts`. « Que dit-on quand le widget ne s'est jamais
//      chargé ? » n'est alors pas une situation à reproduire, c'est un
//      argument à passer — `verdictCaptcha("indisponible")`. Le cas le
//      plus difficile à provoquer devient le plus facile à vérifier.
//
//   2. LE RESTE SE RELIT. Qu'un jeton ne parte QUE vers les deux
//      appels qui l'attendent, qu'il n'y en ait qu'un seul widget, que
//      celui-ci se réarme en cédant son jeton : ce sont des absences et
//      des formes, et une absence ne s'exécute pas. On relit le
//      fichier, comme on relirait une porte pour vérifier qu'elle n'a
//      pas de seconde serrure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cleDeSite,
  estRefusDeCaptcha,
  MESSAGE_ECHEC_CAPTCHA,
  peutContinuerSansJeton,
  verdictCaptcha,
  type EtatCaptcha,
} from "./captcha.ts";
import { messageEchecEnvoi, messageEchecIdentifiants } from "./parcours.ts";

function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/** On relit le CODE, pas la prose : les commentaires nomment ce qu'ils
 *  s'interdisent, et un test naïf échouerait sur eux. */
function sansCommentaires(brut: string): string {
  return brut
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PAGE = sansCommentaires(source("./Formulaire.tsx"));
const WIDGET = sansCommentaires(source("./Turnstile.tsx"));
const CAPTCHA = sansCommentaires(source("./captcha.ts"));

const TOUS_LES_ETATS: EtatCaptcha[] = [
  "inactif",
  "chargement",
  "pret",
  "defi",
  "indisponible",
];

/* ==================================================================
   1. CE QU'ON DIT, ÉTAT PAR ÉTAT
   ================================================================== */

test("le cas courant est le silence : on ne parle que si la personne doit agir", () => {
  // Trois états sur cinq n'affichent RIEN. « Vérification réussie » est
  // du bruit : personne ne l'a demandée, personne n'a rien à en faire.
  assert.equal(verdictCaptcha("inactif").message, null);
  assert.equal(verdictCaptcha("chargement").message, null);
  assert.equal(verdictCaptcha("pret").message, null);
});

test("le widget qui ne se charge jamais A un message, et il dit quoi faire", () => {
  // C'EST LE TEST QUI JUSTIFIE TOUTE LA FORME DU CODE. Le cas arrivera :
  // réseau coupé, bloqueur, réseau d'entreprise qui filtre Cloudflare.
  // Sans cette phrase, la personne a devant elle un formulaire
  // d'apparence normale qui refuse de la laisser entrer.
  const verdict = verdictCaptcha("indisponible");
  assert.notEqual(verdict.message, null);
  // Le fournisseur est NOMMÉ : c'est ce qui permet à quelqu'un de
  // comprendre que son bloqueur est en cause.
  assert.match(verdict.message!, /Cloudflare/);
  // Et une porte de sortie est offerte, pas seulement un constat.
  assert.equal(verdict.reessayable, true);
});

test("l'énigme est annoncée, et l'annonce dit OÙ elle est", () => {
  // Le widget est en bas de la carte pour ne rien recouvrir ; quelqu'un
  // qui vient de cliquer sur « Se connecter » regarde son bouton.
  const verdict = verdictCaptcha("defi");
  assert.notEqual(verdict.message, null);
  assert.match(verdict.message!, /dessous/);
  // Rien à réessayer : le widget travaille, il n'est pas en panne.
  assert.equal(verdict.reessayable, false);
});

test("un seul état offre un bouton « Réessayer » : celui qui est en panne", () => {
  const avecBouton = TOUS_LES_ETATS.filter((etat) => verdictCaptcha(etat).reessayable);
  assert.deepEqual(avecBouton, ["indisponible"]);
});

test("aucun état ne laisse un message vide ou une phrase anglaise", () => {
  for (const etat of TOUS_LES_ETATS) {
    const message = verdictCaptcha(etat).message;
    if (message === null) continue;
    assert.ok(message.length > 40, `message trop court pour « ${etat} »`);
    assert.equal(/captcha|token|widget|error/i.test(message), false);
  }
});

/* ==================================================================
   2. AUCUN ÉTAT NE FERME LA PORTE
   ================================================================== */

test("le widget en panne n'empêche JAMAIS de tenter sa chance", () => {
  // La décision est discutable, alors elle est testée plutôt que
  // laissée à une absence de code. Éteindre le bouton enfermerait
  // dehors quelqu'un dont le réseau filtre Cloudflare — Y COMPRIS
  // pendant toute la période où le réglage Supabase n'est pas encore
  // activé et où sa connexion aurait parfaitement fonctionné.
  //
  // L'appel part donc sans jeton. Si le réglage est éteint, la personne
  // entre. S'il est allumé, le serveur répond `captcha_failed`, et ce
  // refus est traduit par le même diagnostic et le même geste qu'un
  // bouton éteint aurait affichés.
  for (const etat of TOUS_LES_ETATS) {
    assert.equal(peutContinuerSansJeton(etat), true, `état bloquant : ${etat}`);
  }
});

/* ==================================================================
   3. LE REFUS DU SERVEUR NE DOIT PAS ÊTRE UN MENSONGE
   ================================================================== */

test("`captcha_failed` est reconnu", () => {
  assert.equal(estRefusDeCaptcha("captcha_failed"), true);
  assert.equal(estRefusDeCaptcha("invalid_credentials"), false);
  assert.equal(estRefusDeCaptcha(null), false);
  assert.equal(estRefusDeCaptcha(undefined), false);
});

test("un jeton refusé ne fait jamais accuser le mot de passe", () => {
  // L'ÉCHEC LE PLUS COÛTEUX DE CE CHANTIER, ET IL EST SILENCIEUX.
  // Sans cette branche, `captcha_failed` tombe dans la phrase
  // générique : « Nous ne pouvons pas vous connecter avec ces
  // informations. » La personne a pourtant tapé le bon mot de passe.
  // Elle repart en chercher un autre, retape, se fait refuser encore.
  const message = messageEchecIdentifiants("captcha_failed");
  assert.equal(message, MESSAGE_ECHEC_CAPTCHA);
  assert.notEqual(message, messageEchecIdentifiants("invalid_credentials"));
  // La phrase le dit explicitement, parce que c'est tout l'enjeu.
  assert.match(message, /mot de passe n'est pas en cause/);
});

test("un jeton refusé à l'envoi ne fait pas accuser l'adresse", () => {
  const message = messageEchecEnvoi("captcha_failed");
  assert.equal(message, MESSAGE_ECHEC_CAPTCHA);
  assert.notEqual(message, messageEchecEnvoi("email_address_invalid"));
});

test("les refus qui n'ont rien à voir gardent leur message d'origine", () => {
  // Une branche ajoutée en tête d'une fonction est le meilleur moyen
  // d'avaler tout le reste par mégarde.
  assert.match(messageEchecIdentifiants("user_banned"), /suspendu/);
  assert.match(messageEchecEnvoi("over_email_send_rate_limit"), /moins d'une minute/);
  assert.match(messageEchecEnvoi("email_address_invalid"), /forme valide/);
});

/* ==================================================================
   4. LA CLÉ DE SITE
   ================================================================== */

test("une clé absente vaut « pas de CAPTCHA », jamais une exception", () => {
  // C'est ce qui rend le déploiement en trois temps sûr : tant que la
  // clé n'est pas posée, l'écran est identique à celui d'hier. Une
  // fonction qui lèverait ici ferait une page blanche.
  assert.equal(cleDeSite(undefined), "");
  assert.equal(cleDeSite(null), "");
  assert.equal(cleDeSite(""), "");
  // Une variable d'environnement mal recopiée finit souvent avec un
  // espace ou un retour à la ligne : Turnstile refuserait la clé sans
  // rien expliquer.
  assert.equal(cleDeSite("  1x00000000000000000000AA \n"), "1x00000000000000000000AA");
});

test("aucune clé n'est écrite en dur", () => {
  // Une clé de site est liée à une LISTE DE DOMAINES : le
  // développement, la pré-production et la production n'ont pas les
  // mêmes. Et une clé en dur se change au prix d'un correctif.
  assert.match(CAPTCHA, /process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.equal(/0x4AAAAAAA|1x0000000000000000/.test(WIDGET), false);
  assert.equal(/sitekey:\s*"/.test(WIDGET), false);
  // Et la clé SECRÈTE n'approche aucun de ces fichiers : elle vit chez
  // Supabase, posée à la main, et nulle part ailleurs.
  assert.equal(/0x4AAAAAAAAAAAAAAAAAAAAAAAAA/.test(CAPTCHA + WIDGET + PAGE), false);
  assert.equal(/TURNSTILE_SECRET|secret_key|secretKey/.test(CAPTCHA + WIDGET + PAGE), false);
});

/* ==================================================================
   5. LE JETON PART OÙ IL FAUT, ET NULLE PART AILLEURS
   ================================================================== */

/**
 * Les arguments d'un appel, lus jusqu'à la parenthèse APPARIÉE.
 *
 * Une expression régulière ne sait pas compter les parenthèses : elle
 * s'arrêterait au premier `)` venu, c'est-à-dire au milieu d'un objet
 * d'options. Ici on lit exactement ce que le SDK reçoit.
 */
function argumentsDe(nom: string, texte: string): string[] {
  const trouves: string[] = [];
  const marqueur = `.auth.${nom}(`;
  let depuis = 0;
  for (;;) {
    const debut = texte.indexOf(marqueur, depuis);
    if (debut === -1) break;
    const ouvrante = debut + marqueur.length - 1;
    let profondeur = 0;
    let fin = -1;
    for (let i = ouvrante; i < texte.length; i++) {
      if (texte[i] === "(") profondeur++;
      else if (texte[i] === ")") {
        profondeur--;
        if (profondeur === 0) {
          fin = i;
          break;
        }
      }
    }
    assert.notEqual(fin, -1, `parenthèse jamais refermée sur ${nom}`);
    trouves.push(texte.slice(ouvrante, fin + 1));
    depuis = fin;
  }
  assert.notEqual(trouves.length, 0, `appel introuvable : ${nom}`);
  return trouves;
}

test("le jeton part avec les DEUX appels que le serveur protège", () => {
  // `signInWithPassword` → POST /token et `signInWithOtp` → POST /otp
  // sont les deux seules routes de ce parcours placées derrière le
  // contrôle de CAPTCHA du serveur d'authentification.
  for (const appel of argumentsDe("signInWithPassword", PAGE)) {
    assert.match(appel, /captchaToken/);
  }
  for (const appel of argumentsDe("signInWithOtp", PAGE)) {
    assert.match(appel, /captchaToken/);
  }
});

test("le jeton ne part avec AUCUN autre appel", () => {
  // EN ENVOYER UN LÀ OÙ IL N'EST PAS ATTENDU ÉCHOUE AUSSI SÛREMENT QUE
  // DE N'EN ENVOYER AUCUN : un jeton ne sert qu'une fois, celui qu'on
  // gaspille ici manque au suivant.
  //
  //   verifyOtp        → POST /verify, hors du contrôle, et le champ
  //                      est marqué déprécié dans les types du SDK ;
  //   updateUser       → PUT /user, hors du contrôle, et le type
  //                      `UserAttributes` n'a aucun champ pour ça ;
  //   signInWithOAuth  → une redirection vers Google ou Apple, pas un
  //                      appel à notre serveur.
  for (const nom of ["verifyOtp", "updateUser", "signInWithOAuth"]) {
    for (const appel of argumentsDe(nom, PAGE)) {
      assert.doesNotMatch(appel, /captchaToken/, `jeton de trop sur ${nom}`);
    }
  }
});

test("il n'y a que deux points d'attache dans tout l'écran", () => {
  // Le compte exact, pour que l'ajout d'un troisième soit un échec de
  // test et non une découverte en production.
  const attaches = PAGE.match(/captchaToken/g) ?? [];
  assert.equal(attaches.length, 2);
});

/* ==================================================================
   6. UN SEUL WIDGET, ET IL SURVIT AUX CHANGEMENTS D'ÉTAPE
   ================================================================== */

test("un seul widget est monté, et une seule fois", () => {
  // Deux exemplaires divergeraient, et l'un des deux finirait par ne
  // plus se réarmer — le défaut exact que ce chantier évite.
  const montages = PAGE.match(/<Turnstile/g) ?? [];
  assert.equal(montages.length, 1);
});

test("le widget est HORS des blocs d'étape", () => {
  // « M'envoyer un nouveau code » vit à l'étape « code » et appelle une
  // route protégée. Un widget monté dans le bloc « identifiants »
  // n'aurait plus de jeton à donner exactement quand on en redemande un.
  const montage = PAGE.indexOf("<Turnstile");
  const dernierBloc = PAGE.lastIndexOf('etape === "motdepasse"');
  assert.notEqual(montage, -1);
  assert.notEqual(dernierBloc, -1);
  assert.ok(
    montage > dernierBloc,
    "le widget est à l'intérieur d'un bloc d'étape : il disparaîtra",
  );
});

/* ==================================================================
   7. LE JETON EST À USAGE UNIQUE, ET ON NE PEUT PAS L'OUBLIER
   ================================================================== */

test("céder un jeton l'efface et en commande un autre, dans le même geste", () => {
  // LE DÉFAUT LE PLUS FRÉQUENT DE CE GENRE D'INTÉGRATION : un widget
  // qu'on ne réarme pas produit un second appel refusé, et la personne
  // voit « échec » sans comprendre.
  //
  // La parade n'est pas une discipline d'appelant — on l'oublierait —
  // c'est la forme de la fonction : elle ne rend un jeton qu'en
  // l'effaçant et en demandant le suivant.
  const ceder = /function ceder\([\s\S]*?\n {4}\}/.exec(WIDGET);
  assert.notEqual(ceder, null, "la fonction qui cède le jeton est introuvable");
  assert.match(ceder![0], /jeton\.current = null/);
  assert.match(ceder![0], /\.reset\(/);
});

test("aucun appelant n'a la charge de réarmer le widget", () => {
  // Si `Formulaire.tsx` devait appeler une remise à zéro après chaque
  // appel, il finirait par l'oublier sur l'un des cinq chemins.
  assert.equal(/reinitialiser|\.reset\(/.test(PAGE), false);
});

test("le widget est clair, comme le reste de l'application", () => {
  // Oasis Care Pro est clair en toute circonstance : `globals.css` ne
  // porte aucune règle `prefers-color-scheme` en dehors de
  // l'impression. Le réglage « auto » de Turnstile, lui, suit la
  // préférence du SYSTÈME — il poserait donc un rectangle sombre au bas
  // d'une carte blanche pour quiconque a mis son téléphone en mode
  // nuit, c'est-à-dire pour beaucoup de monde.
  assert.match(WIDGET, /theme: "light"/);
});

test("le widget travaille dès le montage, sans attendre le clic", () => {
  // Le jeton se fabrique pendant que la personne tape son mot de passe.
  // Au clic, il est déjà là : l'attente ne se voit pas.
  assert.match(WIDGET, /execution: "render"/);
});

/* ==================================================================
   8. LA DISCRÉTION, ET L'ATTENTE QUI NE DURE PAS TOUJOURS
   ================================================================== */

test("le widget n'occupe aucune place tant qu'il n'a rien à montrer", () => {
  // Pas de grande case blanche à cocher, pas de zone vide réservée à
  // quelque chose qui n'apparaîtra presque jamais.
  assert.match(WIDGET, /appearance: "interaction-only"/);
  // Et aucune hauteur imposée au conteneur : en réserver une créerait
  // exactement le trou qu'on cherche à éviter.
  assert.equal(/h-\[|minHeight|height:/.test(WIDGET), false);
});

test("aucune attente n'est infinie", () => {
  // Un réseau qui FILTRE ne renvoie pas d'erreur : il laisse la requête
  // pendre. Sans minuterie, ni `load` ni `error` ne se déclenchent
  // jamais et l'écran tourne pour l'éternité.
  assert.match(WIDGET, /DELAI_CHARGEMENT_MS/);
  assert.match(WIDGET, /DELAI_JETON_MS/);
  // Y compris l'attente d'une énigme, qui est plus longue mais bornée :
  // quelqu'un peut abandonner devant les images.
  assert.match(WIDGET, /DELAI_DEFI_MS/);
  assert.match(WIDGET, /echeanceDure/);
});

/* ==================================================================
   9. L'ACCESSIBILITÉ, ET CE QUI NE DOIT PAS FUIR
   ================================================================== */

test("le message du widget est annoncé, poliment", () => {
  // `role="status"` et non `role="alert"` : le bandeau d'erreur de
  // l'écran est déjà une alerte, et deux annonces qui se coupent la
  // parole ne s'entendent ni l'une ni l'autre.
  assert.match(WIDGET, /role="status"/);
  assert.match(WIDGET, /aria-live="polite"/);
  assert.equal(/role="alert"/.test(WIDGET), false);
  // Le bouton de secours est un vrai bouton, atteignable au clavier.
  assert.match(WIDGET, /<button\s+type="button"/);
});

test("le jeton ne se range nulle part et ne se journalise jamais", () => {
  // Il naît dans le composant et part directement vers Supabase depuis
  // le gestionnaire qui l'a demandé : ni notre serveur, ni une URL, ni
  // le stockage du navigateur.
  const TOUT = WIDGET + "\n" + CAPTCHA;
  assert.equal(/\bconsole\s*\./.test(TOUT), false);
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(TOUT), false);
  assert.equal(/\bfetch\s*\(/.test(TOUT), false);
  assert.equal(/axios|XMLHttpRequest|sendBeacon/.test(TOUT), false);
  // La seule requête réseau du widget est la balise `<script>` de
  // Cloudflare, et elle vient bien de chez Cloudflare.
  assert.match(CAPTCHA, /https:\/\/challenges\.cloudflare\.com\/turnstile\//);
});

/* ==================================================================
   10. LES QUATRE DÉFAUTS TROUVÉS À L'ESSAI, ET LEUR VERROU
   ==================================================================

   Ces quatre-là n'ont pas été trouvés en relisant : ils ont été
   trouvés en jouant l'écran dans un vrai navigateur, avec les clés de
   démonstration de Cloudflare. Aucun des tests ci-dessous ne les
   aurait attrapés avant qu'on sache où regarder — c'est pour qu'ils ne
   reviennent pas qu'ils sont écrits maintenant.
   ================================================================== */

test("un widget en panne rend la main tout de suite, même en pleine attente", () => {
  // MESURÉ : clic pendant le chargement, panne annoncée à 1,7 s,
  // bouton figé jusqu'à 21,6 s. Le garde existait à l'entrée de
  // `jetonNeuf` et manquait dans la boucle — donc pour tout clic tombé
  // AVANT que la panne ne soit connue, c'est-à-dire le cas courant.
  const boucle = /function regarder\(\)[\s\S]*?\n {6}\}/.exec(WIDGET);
  assert.notEqual(boucle, null, "la boucle d'attente est introuvable");
  assert.match(
    boucle![0],
    /etatCourant\.current === "indisponible"/,
    "la boucle attend vingt secondes une panne déjà connue",
  );
});

test("ce qui demande un geste est amené sous les yeux", () => {
  // MESURÉ : sur un écran de 375 × 812, l'énigme se trouve à 1010
  // pixels du haut. `block: "nearest"` ne déplace RIEN dans ce cas —
  // il ne bouge la page que pour un élément à cheval sur un bord.
  // Contre-épreuve sur le même élément : `"center"` amène la page à
  // 410. C'était donc bien l'option, pas l'environnement.
  assert.match(WIDGET, /block: "center"/);
  assert.equal(/block: "nearest"/.test(WIDGET), false);
  // Et les DEUX états qui demandent un geste, pas seulement l'énigme :
  // le message de panne porte le bouton « Réessayer ».
  assert.match(WIDGET, /etat !== "defi" && etat !== "indisponible"/);
  // L'énigme est dessinée APRÈS le changement d'état : sans rattrapage,
  // la position mesurée est celle d'un conteneur encore vide.
  assert.match(WIDGET, /ResizeObserver/);
});

test("la région vivante existe AVANT d'avoir quelque chose à dire", () => {
  // Une région `aria-live` créée en même temps que son texte n'est pas
  // annoncée de façon fiable : plusieurs lecteurs d'écran ne voient
  // aucun changement, puisque le nœud lui-même vient d'apparaître.
  const region = WIDGET.indexOf('<div role="status" aria-live="polite">');
  const garde = WIDGET.indexOf("verdict.message !== null");
  assert.notEqual(region, -1, "la région vivante est introuvable");
  assert.notEqual(garde, -1);
  assert.ok(
    region < garde,
    "la région naît avec son texte : elle ne sera pas annoncée",
  );
});

test("le widget est SOUS les deux bandeaux, jamais au-dessus", () => {
  // Quand il a quelque chose à montrer, son bloc mesure de 150 à 225
  // pixels. Placé au-dessus, il repoussait d'autant le bandeau qui
  // explique l'échec — la phrase même qu'il faut lire après le clic.
  const montage = PAGE.indexOf("<Turnstile");
  const bandeau = PAGE.indexOf('role="alert"');
  assert.notEqual(montage, -1);
  assert.notEqual(bandeau, -1, "le bandeau d'erreur est introuvable");
  assert.ok(montage > bandeau, "le widget repousse le bandeau d'erreur");
});

test("le bandeau d'erreur est amené sous les yeux, et pas seulement annoncé", () => {
  // MESURÉ à 375 × 812 : le bandeau apparaît à 1168 pixels du haut,
  // soit 356 sous le pli, et rien ne l'y amenait. `role="alert"` parle
  // à un lecteur d'écran ; il ne fait rien pour un œil.
  assert.match(PAGE, /bandeauErreur/);
  assert.match(PAGE, /scrollIntoView\(\{\s*block: "center"/);
});
