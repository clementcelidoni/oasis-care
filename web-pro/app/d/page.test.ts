// §PORTE ANONYME — LES PREUVES SUR LA PAGE ELLE-MÊME.
//
//     node --test --experimental-strip-types "app/d/page.test.ts"
//
// ══════════════════════════════════════════════════════════════════
// POURQUOI CES TESTS LISENT DU CODE SOURCE
// ══════════════════════════════════════════════════════════════════
//
// Ce qu'on veut prouver ici n'est pas ce que la page CALCULE — cela,
// `lecture.test.ts` s'en charge sur du code pur. C'est ce que la page
// NE FAIT PAS : elle n'ouvre pas de session, elle ne détient pas de clé
// de service, elle ne mène nulle part dans l'application.
//
// Une absence ne se teste pas en exécutant : il n'y a rien à appeler. On
// la teste en relisant le fichier, comme on relirait une porte pour
// vérifier qu'elle n'a pas de seconde serrure. C'est grossier, et c'est
// pourtant le seul moyen d'échouer le jour où quelqu'un ajoutera
// innocemment `import { cookies } from "next/headers"` en haut de cette
// page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * ON RELIT LE CODE, PAS LA PROSE — ET CETTE DISTINCTION A COÛTÉ TROIS
 * FAUX ÉCHECS AVANT D'ÊTRE ÉCRITE.
 *
 * Les commentaires de ces fichiers NOMMENT ce qu'ils s'interdisent :
 * « on n'emploie surtout pas `@/lib/supabase/server` », « `cookies()`
 * n'est jamais importé », « ni barre de navigation ». Un test qui
 * cherche ces chaînes dans le fichier entier échoue donc sur les
 * commentaires qui expliquent précisément pourquoi la chose est absente.
 *
 * La leçon vaut au-delà d'ici : une interdiction vérifiée par recherche
 * de texte doit d'abord retirer le texte qui n'est pas du code, sans
 * quoi elle punit la documentation et laisse passer l'obfuscation.
 */
function sansCommentaires(brut: string): string {
  return brut
    .replace(/\/\*[\s\S]*?\*\//g, " ") // blocs, y compris les {/* … */} de JSX
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // lignes, sans casser « https:// »
}

const PAGE = sansCommentaires(source("./[jeton]/page.tsx"));
const DEVIS = sansCommentaires(source("./[jeton]/Devis.tsx"));
const COQUILLE = sansCommentaires(source("./Coquille.tsx"));
const IMPRESSION = sansCommentaires(source("./Impression.tsx"));
const TOUT = PAGE + DEVIS + COQUILLE + IMPRESSION;

// ------------------------------------------------------------------
// 1. AUCUNE SESSION — LE POINT LE PLUS IMPORTANT DU CHANTIER
// ------------------------------------------------------------------

test("la page n'emploie jamais le client Supabase porteur de session", () => {
  // `@/lib/supabase/server` lit ET REPOSE les cookies d'authentification.
  // L'employer ici fabriquerait une session là où il ne doit pas y en
  // avoir — et un jeton se transfère : il finirait par ouvrir un compte
  // à quelqu'un qui a seulement reçu un lien dans un message.
  assert.equal(TOUT.includes("@/lib/supabase/server"), false);
  assert.equal(TOUT.includes("lib/supabase/client"), false);
  assert.equal(TOUT.includes("createServerClient"), false);
});

test("aucun cookie n'est lu ni écrit", () => {
  // `headers()` est permis — il sert à lire l'adresse du visiteur pour
  // la garde. `cookies()` ne l'est pas : c'est le seul mécanisme par
  // lequel une session pourrait naître sur cette route.
  assert.equal(/from\s+"next\/headers"/.test(PAGE), true);
  assert.equal(/\bcookies\b/.test(TOUT), false);
  assert.equal(/Set-Cookie/i.test(TOUT), false);
});

test("la page ne détient aucune clé de service", () => {
  // Le site n'a pas cette clé et ne doit pas l'avoir : c'est écrit dans
  // `.env.example`. Une page PUBLIQUE qui en porterait une serait la
  // faute la plus coûteuse imaginable — la clé la plus puissante du
  // projet, sur la seule route ouverte à tout Internet.
  assert.equal(/SERVICE_ROLE/i.test(TOUT), false);
  assert.equal(/service_role/.test(TOUT), false);
  // La clé employée est la publiable, celle qui est faite pour partir
  // dans un navigateur.
  assert.equal(PAGE.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), true);
  assert.equal(PAGE.includes("persistSession: false"), true);
});

test("la page n'appelle que les deux fonctions accordées à anon", () => {
  // 0089 § 11.b n'en ouvre que deux à `anon` : la porte, et le booléen
  // de saturation. Tout autre appel depuis cette page échouerait en
  // production — mieux vaut le voir ici.
  const appels = [...PAGE.matchAll(/\.rpc\(\s*"(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(appels)], ["devis_par_jeton", "document_share_sous_attaque"]);
  assert.equal(/\.from\(/.test(PAGE), false, "Aucune table ne se lit directement d'ici.");
});

// ------------------------------------------------------------------
// 2. C'EST LA PAGE D'UN DOCUMENT, PAS UNE PAGE DU LOGICIEL
// ------------------------------------------------------------------

test("aucune barre de navigation, aucun élément de coquille produit", () => {
  for (const interdit of [
    "@/components/shell",
    "Sidebar",
    "TopBar",
    "navigation",
    "requireOrganization",
    "requirePortal",
  ]) {
    assert.equal(TOUT.includes(interdit), false, `« ${interdit} » n'a rien à faire ici.`);
  }
});

test("aucun lien sortant : ni vers l'application, ni ailleurs", () => {
  // DEUX RAISONS, ET LA SECONDE EST TECHNIQUE.
  //
  //   • Un lien « Se connecter » enverrait buter sur un mur quelqu'un
  //     qui n'a pas de compte et à qui le dirigeant a décidé de ne pas
  //     en demander.
  //   • Surtout : le jeton est DANS L'URL. Un clic sur n'importe quel
  //     lien ferait partir l'URL complète dans l'en-tête `Referer`. La
  //     directive `no-referrer` ci-dessous s'en charge, mais deux
  //     défenses valent mieux qu'une pour un secret qui circule dans une
  //     barre d'adresse.
  assert.equal(/from\s+"next\/link"/.test(TOUT), false);
  assert.equal(/<a\s/.test(TOUT), false);
  assert.equal(/href=/.test(TOUT), false);
});

test("la page interdit l'indexation et la fuite par le référent", () => {
  // Un lien recopié sur un forum, indexé une fois, et le devis est
  // public pour de bon — bien après l'expiration du jeton, dans le cache
  // du moteur.
  assert.match(PAGE, /robots:\s*\{/);
  assert.match(PAGE, /index:\s*false/);
  assert.match(PAGE, /follow:\s*false/);
  assert.match(PAGE, /referrer:\s*"no-referrer"/);
});

test("le titre de l'onglet ne dit rien du document", () => {
  // Il part dans l'onglet, dans les favoris et dans l'aperçu d'un
  // partage : y mettre le numéro du devis ou le nom de l'entreprise
  // ferait fuiter le document par sa vignette.
  assert.match(PAGE, /title:\s*"Votre devis"/);
});

test("rien n'est mis en cache", () => {
  // Une page de devis rendue une fois puis resservie le serait À UN
  // AUTRE JETON. Et l'ouverture, qui est une écriture, ne serait
  // enregistrée qu'une fois.
  assert.match(PAGE, /export const dynamic = "force-dynamic"/);
});

// ------------------------------------------------------------------
// 3. LES QUATRE ÉTATS, ET LE CINQUIÈME
// ------------------------------------------------------------------

test("expiré, révoqué et inconnu partagent un seul écran", () => {
  // La page ne distingue que trois issues — ouvert, clos, panne — parce
  // que `lireDevisParJeton` n'en rend que trois. Les quatre états d'un
  // lien se replient donc sur « clos », et aucune branche ne peut dire
  // lequel : il n'y a rien dans le code qui le sache.
  assert.equal(PAGE.includes('resultat.etat === "clos"'), true);
  assert.equal(PAGE.includes('resultat.etat === "panne"'), true);
  for (const mot of ["expiré", "expire", "révoqué", "revoque", "inconnu", "introuvable"]) {
    assert.equal(
      new RegExp(`titre="[^"]*${mot}`, "i").test(PAGE),
      false,
      `Un titre dit « ${mot} » : c'est l'oracle qu'on voulait fermer.`,
    );
  }
});

test("la panne ne compte pas comme un échec du visiteur", () => {
  // Son lien est peut-être parfait. Le pénaliser pour notre panne, puis
  // lui dire « trop de tentatives », serait le double châtiment de
  // quelqu'un qui n'a rien fait.
  const brancheClos = PAGE.slice(PAGE.indexOf('resultat.etat === "clos"'));
  const brancheParme = brancheClos.indexOf('resultat.etat === "panne"');
  const avantPanne = brancheClos.slice(0, brancheParme);
  const apresPanne = brancheClos.slice(brancheParme);
  assert.equal(avantPanne.includes("noterEchec"), true, "Un refus doit être compté.");
  assert.equal(apresPanne.includes("noterEchec"), false, "Une panne ne doit pas être comptée.");
});

test("la garde est consultée AVANT tout appel à la porte", () => {
  // Sinon elle n'épargne rien : chaque tentative d'un balayeur
  // coûterait un aller-retour SQL et une écriture dans le journal des
  // tentatives.
  assert.ok(
    PAGE.indexOf("garde.verdict") < PAGE.indexOf("lireDevisParJeton("),
    "La garde doit passer avant l'appel à la porte.",
  );
});

test("UN JETON VALIDE EST SERVI MÊME QUAND LA PLATEFORME EST SATURÉE", () => {
  // ══════════════════════════════════════════════════════════════
  // L'ASSERTION LA PLUS IMPORTANTE DE CE FICHIER.
  // ══════════════════════════════════════════════════════════════
  //
  // `document_share_sous_attaque()` est un drapeau GLOBAL : 200 échecs
  // sur cinq minutes, tous visiteurs confondus, vrai pendant un quart
  // d'heure. Il était consulté avant l'appel à la porte, et la
  // tolérance tombait alors à deux échecs — donc un client qui avait
  // cliqué deux fois sur un ancien lien se voyait refuser son NOUVEAU
  // lien, valide, parce qu'un inconnu tapait au hasard ailleurs.
  //
  // Pour environ 0,7 requête par seconde, n'importe qui pouvait faire
  // refuser leur devis aux vrais clients. C'était exactement la règle
  // que 0089 § 8.c disait ne pas vouloir enfreindre.
  //
  // On vérifie donc l'ORDRE : la saturation ne se lit qu'après que la
  // porte a répondu, et seulement sur un refus déjà acquis.
  const posSaturation = PAGE.indexOf("lireSaturation(");
  const posPorte = PAGE.indexOf("lireDevisParJeton(");
  const posClos = PAGE.indexOf('resultat.etat === "clos"');

  assert.ok(posSaturation > posPorte, "La saturation ne doit pas décider avant la porte.");
  assert.ok(
    posSaturation > posClos,
    "La saturation ne doit se lire que sur un refus DÉJÀ acquis.",
  );

  // Et le refus anticipé ne porte plus que sur « bloque », un fait
  // local que personne ne peut poser à distance.
  const avantPorte = PAGE.slice(0, posPorte);
  assert.equal(
    /verdict === "aVerifier"/.test(avantPorte),
    false,
    "Un signal global ne doit pas décider du sort d'un visiteur particulier.",
  );
  assert.match(avantPorte, /verdict === "bloque"/);
});

// ------------------------------------------------------------------
// 4. LE PROXY — LA PORTE DOIT POUVOIR S'OUVRIR, ET LE JETON RESTER
//    DANS SON CHEMIN
// ------------------------------------------------------------------

test("/d est déclaré public dans proxy.ts", () => {
  // Sans cette ligne, tout visiteur sans session était redirigé vers
  // /login : la porte anonyme ne s'ouvrait jamais, et la redirection
  // était une impasse pour quelqu'un qui n'a pas de compte et n'en
  // aura pas — c'est la décision du dirigeant.
  const proxy = source("../../proxy.ts");
  assert.match(proxy, /pathname\.startsWith\("\/d\/"\)/);
});

test("LE JETON NE PART JAMAIS DANS UN PARAMÈTRE D'URL", () => {
  // La conséquence mesurée était pire que fonctionnelle : la
  // redirection recopiait le chemin dans `?next=`, donc le jeton —
  // l'unique barrière de la porte, 256 bits — sortait de son chemin. Un
  // paramètre de requête finit dans les journaux d'accès de
  // l'hébergeur, dans l'historique du navigateur et dans le `Referer`
  // de tout ce que /login émet. Les défenses de la page /d
  // (`no-referrer`, `noindex`) ne s'appliquaient jamais, puisqu'elle ne
  // s'affichait pas.
  //
  // Deux verrous plutôt qu'un : /d est public (ci-dessus), ET un chemin
  // porteur de secret n'entre pas dans `next` même si une future route
  // à jeton oubliait la première ligne.
  const proxy = source("../../proxy.ts");
  assert.match(proxy, /cheminPorteUnSecret/);

  const posGarde = proxy.indexOf("const cheminPorteUnSecret");
  const posNext = proxy.indexOf('searchParams.set("next"');
  assert.ok(posGarde < posNext, "La garde doit précéder l'écriture du paramètre.");

  // Le `set("next", …)` doit être conditionné par cette garde.
  const autour = proxy.slice(posNext - 200, posNext);
  assert.match(autour, /if \(!cheminPorteUnSecret\)/);
});
