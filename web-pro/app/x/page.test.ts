// §15 — LES PREUVES SUR LA PAGE D'ÉTIQUETTE ELLE-MÊME.
//
//     node --test --experimental-strip-types "app/x/page.test.ts"
//
// ══════════════════════════════════════════════════════════════════
// POURQUOI CES TESTS LISENT DU CODE SOURCE
// ══════════════════════════════════════════════════════════════════
//
// Ce qu'on veut prouver ici n'est pas ce que la page CALCULE — cela,
// `lecture.test.ts` s'en charge sur du code pur. C'est ce que la page
// NE FAIT PAS : elle ne fabrique pas de session, elle ne détient pas de
// clé de service, elle ne touche aucune table, elle ne mène nulle part.
//
// Une absence ne se teste pas en exécutant : il n'y a rien à appeler. On
// la teste en relisant le fichier, comme on relirait une porte pour
// vérifier qu'elle n'a pas de seconde serrure. C'est grossier, et c'est
// pourtant le seul moyen d'échouer le jour où quelqu'un ajoutera
// innocemment une balise `<a>` sur une page dont l'adresse contient le
// jeton.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * ON RELIT LE CODE, PAS LA PROSE.
 *
 * Les commentaires de ces fichiers NOMMENT ce qu'ils s'interdisent —
 * « aucune balise `<a>` », « aucune clé de service ». Un test qui
 * cherche ces chaînes dans le fichier entier échouerait donc sur les
 * commentaires qui expliquent précisément pourquoi la chose est absente.
 */
function sansCommentaires(brut: string): string {
  return brut
    .replace(/\/\*[\s\S]*?\*\//g, " ") // blocs, y compris les {/* … */} de JSX
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // lignes, sans casser « https:// »
}

const PAGE = sansCommentaires(source("./[jeton]/page.tsx"));
const FICHE = sansCommentaires(source("./[jeton]/Fiche.tsx"));
const COQUILLE = sansCommentaires(source("./Coquille.tsx"));
const LECTURE = sansCommentaires(source("./lecture.ts"));
const TOUT = PAGE + FICHE + COQUILLE + LECTURE;

// ------------------------------------------------------------------
// 1. AUCUNE SESSION FABRIQUÉE, AUCUNE CLÉ PUISSANTE
// ------------------------------------------------------------------
//
// CETTE ROUTE LIT LES COOKIES, contrairement à `app/d` qui se l'interdit,
// et c'est le § 15 qui l'exige : le résolveur répond différemment selon
// le porteur, et le porteur ne peut venir que de la session. Ce qui
// reste interdit, c'est d'en CRÉER une.

test("la page ne crée jamais de session, elle en lit une si elle existe", () => {
  // `getUser()` valide un jeton existant. Tout ce qui en FABRIQUE un est
  // absent, et doit le rester : cette page est ouverte à tout Internet.
  assert.equal(/\.auth\.getUser\(\)/.test(PAGE), true);
  assert.equal(/setSession|signIn|signUp|signInWithPassword|exchangeCodeForSession/.test(TOUT), false);
  // Le client de NAVIGATEUR n'a rien à faire dans un composant serveur :
  // il déposerait la session dans le stockage local du visiteur.
  assert.equal(TOUT.includes("lib/supabase/client"), false);
});

test("la page ne détient aucune clé de service", () => {
  // Le site n'a pas cette clé et ne doit pas l'avoir. Une page PUBLIQUE
  // qui en porterait une serait la faute la plus coûteuse imaginable —
  // la clé la plus puissante du projet, sur la seule route ouverte à
  // tout Internet.
  assert.equal(/SERVICE_ROLE/i.test(TOUT), false);
  assert.equal(/service_role/.test(TOUT), false);
  // La clé employée est la publiable, celle qui est faite pour partir
  // dans un navigateur (`lib/supabase/server` ne lit que celle-là).
  assert.equal(PAGE.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), true);
});

test("le porteur n'est JAMAIS un paramètre du résolveur", () => {
  // C'est la règle qui tient tout le reste : `etiquette_resoudre` ne
  // prend que le jeton et lit `auth.uid()` elle-même. Un appel qui lui
  // passerait un identifiant d'utilisateur serait une faille béante
  // qu'aucune autre ligne ne pourrait rattraper.
  const appel = /rpc\(\s*"etiquette_resoudre"\s*,\s*\{([^}]*)\}/.exec(PAGE);
  assert.notEqual(appel, null, "l'appel au résolveur est introuvable");
  const arguments_ = appel![1];
  assert.equal(/p_token/.test(arguments_), true);
  assert.equal(/user|uid|porteur|membre|organization|workspace/i.test(arguments_), false);
});

// ------------------------------------------------------------------
// 2. RIEN QUE LES DEUX FONCTIONS ACCORDÉES À anon
// ------------------------------------------------------------------

test("la page n'appelle que les deux fonctions accordées à anon", () => {
  const appelees = new Set(
    [...PAGE.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((trouve) => trouve[1]),
  );
  assert.deepEqual(
    [...appelees].sort(),
    ["etiquette_resoudre", "etiquettes_sous_attaque"],
  );
});

test("aucune table n'est lue directement", () => {
  // Toute la décision — la portée, le droit, l'écran — vit dans
  // `etiquette_resoudre`. Un `select` posé ici passerait par la RLS
  // ordinaire et ne rendrait rien à un anonyme, ce qui donnerait une
  // seconde règle d'accès à relire. Il n'y en a qu'une.
  assert.equal(/\.from\(/.test(TOUT), false);
  assert.equal(/smart_tags|nursery_lots|plants/.test(PAGE), false);
});

// ------------------------------------------------------------------
// 3. LE JETON EST DANS L'URL : AUCUNE FUITE PAR LE RÉFÉRENT
// ------------------------------------------------------------------

test("aucun lien sortant : ni vers l'application, ni ailleurs", () => {
  // UN SEUL `<a>` enverrait l'adresse complète — donc le jeton — au site
  // visité, par l'en-tête `Referer`. Et un jeton d'étiquette N'EXPIRE
  // PAS : il est collé sur un arbre.
  for (const [nom, fichier] of [
    ["page", PAGE],
    ["Fiche", FICHE],
    ["Coquille", COQUILLE],
  ] as const) {
    assert.equal(/<a[\s>]/.test(fichier), false, `${nom} porte une balise <a>`);
    assert.equal(/next\/link/.test(fichier), false, `${nom} importe next/link`);
    assert.equal(/href=/.test(fichier), false, `${nom} porte un href`);
  }
});

test("la page interdit l'indexation et la fuite par le référent", () => {
  assert.equal(PAGE.includes("index: false"), true);
  assert.equal(PAGE.includes('referrer: "no-referrer"'), true);
});

test("le titre de l'onglet ne dit rien de ce qui a été scanné", () => {
  // Le titre part dans l'onglet, dans les favoris et dans l'aperçu d'un
  // partage. Il est fixe, et il le reste pour les cinq issues.
  assert.equal(/title:\s*"Étiquette Oasis"/.test(PAGE), true);
  assert.equal(/generateMetadata/.test(PAGE), false);
});

test("rien n'est mis en cache", () => {
  // Une réponse resservie le serait à un AUTRE jeton et à un AUTRE
  // porteur : la même adresse doit rendre la fiche complète à un membre
  // et un refus à un inconnu.
  assert.equal(/export const dynamic = "force-dynamic"/.test(PAGE), true);
  assert.equal(/revalidate/.test(PAGE), false);
});

// ------------------------------------------------------------------
// 4. AUCUNE COQUILLE DE PRODUIT, AUCUN INDICE DE CE QUI EXISTE AILLEURS
// ------------------------------------------------------------------

test("aucune barre de navigation, aucun élément de coquille produit", () => {
  // Le porteur le plus fréquent est un passant sans compte. Lui montrer
  // le menu d'un ERP lui apprendrait ce que fait l'entreprise chez qui
  // il se trouve, et lui proposerait une porte dont il n'a pas la clé.
  assert.equal(/Sidebar|Topbar|AppShell|Navigation|@\/components\/shell/.test(TOUT), false);
  assert.equal(/Se connecter|Créer un compte|S'inscrire/.test(TOUT), false);
});

test("les quatre refus partagent un seul écran et une seule phrase", () => {
  // Inconnue, révoquée, orpheline, interdite. Une seule `Coquille` porte
  // le titre du refus, et la phrase vient de la base.
  const titres = [...PAGE.matchAll(/<Coquille titre="([^"]*)"/g)].map((t) => t[1]);
  const refus = titres.filter((t) => t.includes("ne mène à rien"));
  assert.equal(refus.length, 1);
  assert.equal(/resultat\.message/.test(PAGE), true);
});

// ------------------------------------------------------------------
// 5. LA GARDE — L'ORDRE DES GESTES EST LE SUJET
// ------------------------------------------------------------------

test("la garde est consultée AVANT tout appel au résolveur", () => {
  const verdict = PAGE.indexOf("garde.verdict");
  const resolveur = PAGE.indexOf("etiquette_resoudre");
  assert.notEqual(verdict, -1);
  assert.notEqual(resolveur, -1);
  assert.equal(verdict < resolveur, true);
});

test("la panne ne compte pas comme un échec du visiteur", () => {
  // Son étiquette est peut-être parfaite : c'est nous qui sommes en
  // panne. La compter ferait finir bloqué quelqu'un qui n'a rien fait,
  // pendant la panne, au moment précis où il réessaie.
  const panne = PAGE.indexOf('resultat.etat === "panne"');
  const clos = PAGE.indexOf('resultat.etat === "clos"');
  const echec = PAGE.indexOf("garde.noterEchec");
  assert.equal(panne !== -1 && clos !== -1 && echec !== -1, true);
  assert.equal(panne < clos, true, "la panne doit être traitée avant le refus");
  assert.equal(clos < echec, true, "l'échec ne se compte que dans la branche du refus");
  assert.equal(PAGE.split("garde.noterEchec").length - 1, 1, "un seul comptage d'échec");
});

// ------------------------------------------------------------------
// 6. LA REDIRECTION — LA SEULE CHAÎNE QUI DEVIENNE UNE DESTINATION
// ------------------------------------------------------------------

test("on ne redirige que vers le chemin que le résolveur a rendu, filtré", () => {
  // `cheminInterne` (lecture.ts) refuse tout ce qui sortirait du site.
  // Ici on vérifie qu'aucune autre chaîne ne peut atteindre `redirect`.
  const redirections = [...PAGE.matchAll(/redirect\(([^)]*)\)/g)].map((t) => t[1].trim());
  assert.deepEqual(redirections, ["resultat.chemin"]);
  assert.equal(LECTURE.includes("cheminInterne"), true);
});

test("la fiche publique ne reçoit que la charge filtrée", () => {
  // Ni `details` brut, ni la ligne rendue par la base : uniquement
  // l'objet à trois champs que `lecture.ts` a reconstruit.
  const passage = /<Fiche titre=\{resultat\.titre\} fiche=\{resultat\.fiche\} \/>/.test(PAGE);
  assert.equal(passage, true);
  assert.equal(/details/.test(PAGE), false);
});

test("la fiche publique ne sait afficher que trois champs", () => {
  // Son type d'entrée n'en a que trois : elle ne PEUT PAS en afficher un
  // quatrième, même si la base en rendait un.
  assert.equal(/nomCommun|nomScientifique/.test(FICHE), true);
  for (const interdit of [
    "custom_name",
    "latitude",
    "longitude",
    "health_status",
    "garden",
    "customer",
    "notes",
    "price",
    "cents",
  ]) {
    assert.equal(FICHE.includes(interdit), false, `Fiche.tsx mentionne « ${interdit} »`);
  }
});
