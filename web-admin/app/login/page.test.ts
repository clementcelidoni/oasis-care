// LES PREUVES SUR LA PAGE DE CONNEXION DU CONTROL CENTER.
//
//     node --test --experimental-strip-types "app/login/page.test.ts"
//
// ══════════════════════════════════════════════════════════════════
// POURQUOI CES TESTS LISENT DU CODE SOURCE
// ══════════════════════════════════════════════════════════════════
//
// `parcours.test.ts` éprouve ce que la page CALCULE. Ce fichier-ci
// éprouve ce qu'elle NE FAIT PAS : elle n'écrit le mot de passe nulle
// part, elle ne le met dans aucune URL, elle ne le journalise pas, elle
// n'affiche jamais l'anglais du serveur, et elle ne laisse pas repasser
// la fuite d'existence de compte qu'elle avait.
//
// Une absence ne se teste pas en exécutant : il n'y a rien à appeler.
// On la teste en relisant le fichier, comme on relirait une porte pour
// vérifier qu'elle n'a pas de seconde serrure. C'est grossier, et c'est
// pourtant le seul moyen d'échouer le jour où quelqu'un ajoutera un
// `console.log` en déboguant, et l'oubliera.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * ON RELIT LE CODE, PAS LA PROSE.
 *
 * Les commentaires de ce fichier NOMMENT ce qu'ils s'interdisent. Un
 * test qui chercherait ces mots dans le fichier entier échouerait donc
 * sur les commentaires qui expliquent pourquoi la chose est absente.
 */
function sansCommentaires(brut: string): string {
  return brut
    .replace(/\/\*[\s\S]*?\*\//g, " ") // blocs, y compris les {/* … */} de JSX
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // lignes, sans casser « https:// »
}

/**
 * L'ÉCRAN vit dans `Formulaire.tsx` ; `page.tsx` n'est qu'une coquille
 * de serveur qui lui passe le message d'un lien échoué. Les deux sont
 * relus : le mot de passe ne doit approcher ni l'un ni l'autre.
 */
const PAGE = sansCommentaires(source("./Formulaire.tsx"));
const COQUILLE = sansCommentaires(source("./page.tsx"));
const PARCOURS = sansCommentaires(source("./parcours.ts"));
const TOUT = PAGE + "\n" + COQUILLE + "\n" + PARCOURS;

/* ==================================================================
   1. LE MOT DE PASSE NE TRANSITE QUE VERS LE SERVEUR
   ================================================================== */

const SECRETS = ["motDePasse", "nouveau", "confirmation", "password"];

const PUITS = [
  "console.",
  "localStorage",
  "sessionStorage",
  "document.cookie",
  "searchParams.set",
  "searchParams.append",
  "URLSearchParams",
  "fetch(",
  "navigator.sendBeacon",
  "history.pushState",
  "history.replaceState",
  "location.assign",
  "location.href =",
];

test("aucune ligne ne met un mot de passe à côté d'un journal, d'un stockage ou d'une URL", () => {
  const fautives: string[] = [];
  for (const ligne of PAGE.split("\n")) {
    if (!SECRETS.some((nom) => ligne.includes(nom))) continue;
    const puits = PUITS.find((sortie) => ligne.includes(sortie));
    if (puits) fautives.push(`${puits} → ${ligne.trim()}`);
  }
  assert.deepEqual(fautives, [], "un mot de passe côtoie une sortie interdite");
});

test("la page ne journalise rien du tout", () => {
  // Même sans mot de passe sur la ligne : un `console.log(etat)` en
  // déboguant emporterait tout l'état du composant.
  assert.equal(/\bconsole\s*\./.test(TOUT), false);
});

test("rien de cette page ne survit à l'onglet", () => {
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(TOUT), false);
});

test("le mot de passe ne part que vers Supabase, par les trois appels prévus", () => {
  assert.equal(/\.auth\.signInWithPassword\(/.test(PAGE), true);
  assert.equal(/\.auth\.updateUser\(\s*\{\s*password:/.test(PAGE), true);
  assert.equal(/\bfetch\s*\(/.test(PAGE), false);
  assert.equal(/axios|XMLHttpRequest|sendBeacon/.test(PAGE), false);
});

test("les champs de mot de passe sont contrôlés, jamais pré-remplis", () => {
  assert.equal(/defaultValue/.test(PAGE), false);
});

/* ==================================================================
   2. LA FUITE D'EXISTENCE DE COMPTE NE PEUT PLUS REVENIR
   ================================================================== */

test("le refus d'une adresse inconnue est filtré avant d'atteindre l'écran", () => {
  // C'est LE correctif de cette page. Sans ce filtre :
  //     adresse connue   → panneau calme
  //     adresse inconnue → bandeau rouge
  // et la liste de l'équipe qui exploite la plateforme se lit une
  // adresse à la fois.
  assert.equal(/envoiDoitResterMuet\(\s*error\.code\s*\)/.test(PAGE), true);
  // Et le filtre doit précéder l'affichage dans la MÊME condition :
  // afficher d'abord et taire ensuite ne tairait rien du tout.
  assert.match(PAGE, /if \(error && !envoiDoitResterMuet\(error\.code\)\)/);
  const filtre = PAGE.indexOf("!envoiDoitResterMuet(error.code)");
  const affichage = PAGE.indexOf("messageEchecEnvoi(error.code)");
  assert.ok(filtre !== -1 && affichage !== -1);
  assert.ok(filtre < affichage, "le refus est affiché avant d'avoir été filtré");
});

test("aucun message d'erreur de Supabase n'est affiché tel quel", () => {
  // C'était le défaut de l'ancienne page : `{error.message}`, donc de
  // l'anglais technique — et, pour `otp_disabled`, un aveu.
  assert.equal(/setErreur\([^)]*error\.message/.test(PAGE), false);
  assert.equal(/\{\s*error\.message\s*\}/.test(PAGE), false);
});

test("les refus sont lus par leur CODE, pas par le hasard de leur phrase", () => {
  assert.equal(/messageEchecIdentifiants\(\s*error\.code\s*\)/.test(PAGE), true);
  assert.equal(/messageEchecEnvoi\(\s*error\.code\s*\)/.test(PAGE), true);
});

test("l'écran continue jusqu'au champ de code même quand rien n'est parti", () => {
  // Le pendant visible du filtre : après un `otp_disabled` tu, l'écran
  // affiche le même temps « code » que pour une adresse connue, avec la
  // même phrase prudente. Sans cela, le filtre serait inutile — l'écran
  // trahirait par son immobilité.
  assert.match(PAGE, /Si un compte Oasis Care existe pour/);
  assert.match(PAGE, /s'il y a lieu/);
  // Le panneau ne doit surtout pas affirmer l'envoi : « un code vient
  // de partir » serait, à lui seul, l'aveu que le compte existe.
  assert.equal(/code vient de partir vers/.test(PAGE), false);
});

/* ==================================================================
   3. AUCUN COUP D'ŒIL PRÉALABLE
   ================================================================== */

test("la page n'interroge jamais la base sur une adresse", () => {
  assert.equal(/\.from\(/.test(PAGE), false);
  assert.equal(/\.rpc\(/.test(PAGE), false);
  assert.equal(/platform_admins/.test(PAGE), false);
  assert.equal(/encrypted_password/.test(TOUT), false);
});

test("l'existence du compte n'est lue qu'APRÈS la vérification du code", () => {
  const appel = /aUneIdentiteEmail\(([^)]*)\)/.exec(PAGE);
  assert.notEqual(appel, null, "la lecture des identités est introuvable");
  assert.match(appel![1], /data\.user/);
});

/* ==================================================================
   4. LES DEUX CODES SE DISTINGUENT À L'ÉCRAN
   ================================================================== */

test("le champ de code nomme sa SOURCE, et jamais « code de vérification »", () => {
  // La source du code est la seule chose qui distingue les deux gestes
  // pour la personne qui les subit : « reçu par e-mail » ici, « de
  // votre application d'authentification » à `/second-facteur`. Écrire
  // « code de vérification » des deux côtés les rendrait jumeaux.
  assert.match(PAGE, /Code à \{LONGUEUR_CODE\} chiffres reçu par e-mail/);
  assert.equal(/code de vérification/i.test(PAGE), false);
});

test("l'écran prévient qu'un second code, différent, peut suivre", () => {
  // Sans cet avertissement, un administrateur enrôlé chercherait le
  // mauvais code dans la mauvaise application.
  assert.match(PAGE, /application\s*\n?\s*d&apos;authentification/);
  assert.match(PAGE, /LONGUEUR_CODE_SECOND_FACTEUR/);
});

test("le champ de code appelle le bon clavier et la bonne saisie automatique", () => {
  assert.equal(/inputMode="numeric"/.test(PAGE), true);
  assert.equal(/autoComplete="one-time-code"/.test(PAGE), true);
  assert.equal(/pattern="\[0-9\]\*"/.test(PAGE), true);
});

test("aucun maxLength sur le champ de code : il casserait le collage", () => {
  // Le navigateur applique `maxLength` au texte COLLÉ, avant que nous
  // ayons pu en retirer les espaces. Coller « 12 34 56 78 » dans un
  // champ limité à huit caractères ne laisse entrer que « 12 34 56 »,
  // que `nettoyerCode` réduit à six chiffres : bouton éteint, aucun
  // message, et la personne conclut que son code est refusé. C'est
  // `nettoyerCode` qui doit tronquer, parce qu'il compte les CHIFFRES.
  assert.equal(/maxLength/.test(PAGE), false);
});

test("le collage passe par le nettoyage, jamais directement dans l'état", () => {
  assert.equal(/changerLeCode\(event\.target\.value\)/.test(PAGE), true);
  assert.equal(/setCode\(\s*event\.target\.value\s*\)/.test(PAGE), false);
});

test("les gestionnaires de mots de passe sont invités, pas gênés", () => {
  assert.equal(/autoComplete="current-password"/.test(PAGE), true);
  assert.equal(/autoComplete="new-password"/.test(PAGE), true);
  assert.equal(/autoComplete="username"/.test(PAGE), true);
});

/* ==================================================================
   5. CE QUI NE DEVAIT PAS BOUGER N'A PAS BOUGÉ
   ================================================================== */

test("aucun compte ne se crée depuis le Control Center", () => {
  // Sans ce faux, saisir n'importe quelle adresse créerait un compte
  // Oasis Care de plus dans la vraie base de production.
  assert.match(PAGE, /shouldCreateUser:\s*false/);
});

test("Google reste, Apple reste absent", () => {
  // L'absence d'Apple n'est pas un oubli : le relais privé délivre une
  // adresse aléatoire, et `platform_admins` se peuple en désignant une
  // adresse qu'on doit pouvoir écrire de mémoire.
  assert.equal(/Continuer avec Google/.test(PAGE), true);
  assert.equal(/signInWithProvider\("google"\)/.test(PAGE), true);
  assert.equal(/apple/i.test(PAGE), false);
});

test("la page ne transporte toujours aucun paramètre de destination", () => {
  // Une seule porte, une seule destination : la racine. Pas de
  // redirection ouverte à valider, à tester, ni à réparer un jour.
  assert.equal(/\bnext\b/.test(PAGE), false);
  assert.match(PAGE, /location\.assign\("\/"\)/);
});

test("le client Supabase se construit au clic, pas au rendu", () => {
  // `createBrowserClient` lève si les variables manquent, et c'est la
  // seule page pré-rendable du Control Center : la construire au rendu
  // faisait échouer `next build` sur toute chaîne de déploiement qui
  // injecte les variables à l'exécution.
  assert.match(PAGE, /function client\(\)\s*\{\s*return createClient\(\);\s*\}/);
  assert.equal(/const supabase = createClient\(\)/.test(PAGE), false);
});

test("le message du lien qui a échoué est enfin lu, et il l'est côté serveur", () => {
  // Il est lu par la coquille de serveur, qui le connaît déjà, et non
  // par un effet du navigateur qui provoquerait une cascade de rendus.
  assert.match(COQUILLE, /await searchParams/);
  assert.match(COQUILLE, /messageRetourDeLien\(motif\)/);
  assert.match(COQUILLE, /erreurDeLien=\{erreurDeLien\}/);
  assert.match(PAGE, /useState<string \| null>\(erreurDeLien\)/);
});

test("la coquille ne vérifie rien : elle n'est pas un oracle", () => {
  // Refuser ici, avec un message, dirait à qui essaie si l'adresse
  // saisie appartient à un administrateur. Le tri se fait après la
  // connexion, et il répond 404.
  assert.equal(/requireAdmin|currentAdmin|platform_admins/.test(COQUILLE), false);
  assert.equal(/redirect\(/.test(COQUILLE), false);
});

/* ==================================================================
   6. AUCUNE CLÉ, AUCUN SECRET
   ================================================================== */

test("aucune clé puissante n'approche cette page", () => {
  assert.equal(/SERVICE_ROLE/i.test(TOUT), false);
  assert.equal(/service_role/.test(TOUT), false);
  assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(TOUT), false);
  assert.equal(/sb_secret|sbp_/.test(TOUT), false);
});
