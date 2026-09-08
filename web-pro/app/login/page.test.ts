// LES PREUVES SUR LA PAGE DE CONNEXION ELLE-MÊME.
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
// n'affiche jamais l'anglais du serveur.
//
// Une absence ne se teste pas en exécutant : il n'y a rien à appeler.
// On la teste en relisant le fichier, comme on relirait une porte pour
// vérifier qu'elle n'a pas de seconde serrure. C'est grossier, et c'est
// pourtant le seul moyen d'échouer le jour où quelqu'un ajoutera un
// `console.log(motDePasse)` en déboguant, et l'oubliera.
//
// Aucun rendu React, aucun navigateur, aucun appel réseau : on lit un
// fichier et on cherche des motifs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * ON RELIT LE CODE, PAS LA PROSE.
 *
 * Les commentaires de ce fichier NOMMENT ce qu'ils s'interdisent —
 * « jamais dans un journal », « jamais dans une URL ». Un test qui
 * chercherait ces mots dans le fichier entier échouerait donc sur les
 * commentaires qui expliquent précisément pourquoi la chose est absente.
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

/** Les noms sous lesquels un mot de passe vit dans cette page. */
const SECRETS = ["motDePasse", "nouveau", "confirmation", "password"];

/**
 * Les endroits où un secret ne doit jamais atterrir. Tout est là : un
 * journal, un stockage qui survit à l'onglet, un cookie, une URL, une
 * requête que nous fabriquons nous-mêmes.
 */
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
    const porteUnSecret = SECRETS.some((nom) => ligne.includes(nom));
    if (!porteUnSecret) continue;
    const puits = PUITS.find((sortie) => ligne.includes(sortie));
    if (puits) fautives.push(`${puits} → ${ligne.trim()}`);
  }
  assert.deepEqual(fautives, [], "un mot de passe côtoie une sortie interdite");
});

test("la page ne journalise rien du tout", () => {
  // Même sans mot de passe sur la ligne : un `console.log(etat)` en
  // déboguant emporterait tout l'état du composant, mot de passe
  // compris. La règle la plus simple est celle qui tient : aucun.
  assert.equal(/\bconsole\s*\./.test(TOUT), false);
});

test("rien de cette page ne survit à l'onglet", () => {
  // Le client Supabase gère lui-même ses cookies de session ; nous
  // n'écrivons rien. Un brouillon de mot de passe conservé « pour la
  // commodité » serait la pire des commodités.
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(TOUT), false);
});

test("le mot de passe ne part que vers Supabase, par les trois appels prévus", () => {
  // Trois appels, et pas un de plus. Aucun `fetch` maison, aucune route
  // interne à nous : le mot de passe ne traverse jamais notre serveur.
  assert.equal(/\.auth\.signInWithPassword\(/.test(PAGE), true);
  assert.equal(/\.auth\.updateUser\(\s*\{\s*password:/.test(PAGE), true);
  assert.equal(/\bfetch\s*\(/.test(PAGE), false);
  assert.equal(/axios|XMLHttpRequest|sendBeacon/.test(PAGE), false);
});

test("les champs de mot de passe sont contrôlés, jamais pré-remplis", () => {
  // Un `defaultValue` sur un champ de mot de passe met la valeur dans
  // le HTML rendu, donc dans le cache du navigateur et dans la source
  // de la page.
  assert.equal(/defaultValue/.test(PAGE), false);
});

/* ==================================================================
   2. L'ANGLAIS DU SERVEUR N'ATTEINT JAMAIS L'ÉCRAN
   ================================================================== */

test("aucun message d'erreur de Supabase n'est affiché tel quel", () => {
  // C'était le défaut de l'ancienne page : `{error.message}`, donc de
  // l'anglais technique sous les yeux d'un paysagiste. Toutes les
  // erreurs passent désormais par une traduction de `parcours.ts`.
  assert.equal(/setErreur\([^)]*error\.message/.test(PAGE), false);
  assert.equal(/\{\s*error\.message\s*\}/.test(PAGE), false);
  assert.equal(/\{\s*erreur\?\.message\s*\}/.test(PAGE), false);
});

test("les refus sont lus par leur CODE, pas par le hasard de leur phrase", () => {
  // `error.code` est stable ; `error.message` change au gré des
  // versions du serveur. Une traduction accrochée à la phrase se
  // décrocherait sans prévenir.
  assert.equal(/messageEchecIdentifiants\(\s*error\.code\s*\)/.test(PAGE), true);
  assert.equal(/messageEchecEnvoi\(\s*error\.code\s*\)/.test(PAGE), true);
});

/* ==================================================================
   3. L'ÉCRAN NE DEMANDE JAMAIS AU SERVEUR SI L'ADRESSE EXISTE
   ================================================================== */

test("aucun coup d'œil préalable : pas de requête sur l'adresse avant de l'utiliser", () => {
  // Ce serait l'oracle. Interroger une table, appeler une fonction, ou
  // lire `auth.users` pour choisir quel champ montrer reviendrait à
  // publier la liste des clients, une adresse à la fois.
  assert.equal(/\.from\(/.test(PAGE), false);
  assert.equal(/\.rpc\(/.test(PAGE), false);
  assert.equal(/encrypted_password/.test(TOUT), false);
});

test("l'existence du compte n'est lue qu'APRÈS la vérification du code", () => {
  // `aUneIdentiteEmail` est la seule lecture du compte, et elle prend
  // ce que rend `verifyOtp` — donc une session déjà obtenue, donc une
  // personne qui vient de prouver qu'elle possède l'adresse.
  const appel = /aUneIdentiteEmail\(([^)]*)\)/.exec(PAGE);
  assert.notEqual(appel, null, "la lecture des identités est introuvable");
  assert.match(appel![1], /session\.data\.user/);
});

/* ==================================================================
   4. LE CHAMP DE CODE SE COMPORTE COMME UN CHAMP DE CODE
   ================================================================== */

test("le champ de code appelle le bon clavier et la bonne saisie automatique", () => {
  assert.equal(/inputMode="numeric"/.test(PAGE), true);
  // Sans lui, iOS et Safari ne proposent pas le code lu dans le
  // courriel au-dessus du clavier — c'est le geste qui fait toute la
  // différence sur un téléphone.
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
  // `changerLeCode` est le seul chemin : il retire les espaces, les
  // tirets et le « Code : » que les gens collent avec.
  assert.equal(/onChange=\{\(e\) => changerLeCode\(e\.target\.value\)\}/.test(PAGE), true);
  assert.equal(/setCode\(\s*e\.target\.value\s*\)/.test(PAGE), false);
});

test("les gestionnaires de mots de passe sont invités, pas gênés", () => {
  // `Field` de `components/ui/primitives.tsx` n'expose pas
  // `autoComplete` : c'est pourquoi cette page écrit ses champs à la
  // main. Sans ces attributs, aucun gestionnaire n'enregistre ni ne
  // restitue la clé — et c'est ce qui rend un mot de passe supportable.
  assert.equal(/autoComplete="current-password"/.test(PAGE), true);
  assert.equal(/autoComplete="new-password"/.test(PAGE), true);
  assert.equal(/autoComplete="username"/.test(PAGE), true);
});

/* ==================================================================
   5. GOOGLE ET APPLE N'ONT PAS BOUGÉ
   ================================================================== */

test("les deux boutons de fournisseur sont toujours là", () => {
  // Le dirigeant l'a demandé mot pour mot : deux populations, deux
  // parcours, et aucun des deux ne gêne l'autre.
  assert.equal(/signInWithProvider\("apple"\)/.test(PAGE), true);
  assert.equal(/signInWithProvider\("google"\)/.test(PAGE), true);
  assert.equal(/Continuer avec Apple/.test(PAGE), true);
  assert.equal(/Continuer avec Google/.test(PAGE), true);
  assert.equal(/signInWithOAuth/.test(PAGE), true);
});

test("l'inscription reste possible : cette page crée les comptes", () => {
  // Inscription et connexion sont le même chemin. `shouldCreateUser`
  // doit donc rester à son défaut — vrai. Le poser à faux ici fermerait
  // la porte à tout nouveau client, et rendrait la page bavarde sur
  // l'existence des comptes par-dessus le marché.
  assert.equal(/shouldCreateUser/.test(PAGE), false);
});

/* ==================================================================
   6. LA PROMESSE PÉRIMÉE A DISPARU
   ================================================================== */

test("la page ne promet plus qu'il n'y a pas de mot de passe", () => {
  assert.equal(/Aucun mot de passe à retenir/.test(PAGE), false);
  assert.equal(/Lien envoyé/.test(PAGE), false);
  // Et elle ne dit plus « fermez cet onglet » : le code se saisit ici.
  assert.equal(/fermer cet onglet/i.test(PAGE), false);
});

test("le message du lien qui a échoué est enfin lu, et il l'est côté serveur", () => {
  // `/auth/callback` redirige vers `/login?error=…` et personne ne
  // lisait ce paramètre : tous ses messages tombaient dans le vide.
  //
  // Il est lu par la coquille de serveur, qui le connaît déjà, et non
  // par un effet du navigateur qui provoquerait une cascade de rendus.
  assert.match(COQUILLE, /await searchParams/);
  assert.match(COQUILLE, /messageRetourDeLien\(motif\)/);
  assert.match(COQUILLE, /erreurDeLien=\{erreurDeLien\}/);
  // Et le formulaire s'en sert comme VALEUR INITIALE : une action de
  // l'utilisateur efface le message d'un lien périmé, sans code exprès.
  assert.match(PAGE, /useState<string \| null>\(erreurDeLien\)/);
});

test("le formulaire ne va plus chercher l'erreur lui-même", () => {
  // Deux lectures du même paramètre finiraient par diverger, et celle
  // du navigateur imposerait un effet posant un état — précisément ce
  // que React déconseille.
  assert.equal(/searchParams\.get\("error"\)/.test(PAGE), false);
  assert.equal(/messageRetourDeLien/.test(PAGE), false);
});

/* ==================================================================
   7. AUCUNE CLÉ, AUCUN SECRET
   ================================================================== */

test("aucune clé puissante n'approche cette page", () => {
  assert.equal(/SERVICE_ROLE/i.test(TOUT), false);
  assert.equal(/service_role/.test(TOUT), false);
  // La page n'écrit aucune clé en dur : elle passe par
  // `lib/supabase/client`, qui ne lit que la clé publiable.
  assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(TOUT), false);
  assert.equal(/sb_secret|sbp_/.test(TOUT), false);
});
