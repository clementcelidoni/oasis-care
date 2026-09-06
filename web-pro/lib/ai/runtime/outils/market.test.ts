import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OUTIL_INTERNAL_HISTORY } from "./market.ts";
import { registreOutils } from "../tools.ts";

/**
 * §11Z — L'OUTIL DE L'AGENT MARCHÉ, ÉPROUVÉ AVANT D'ÊTRE BRANCHÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE SEUL DÉFAUT QUI COMPTE VRAIMENT ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce n'est pas qu'il rende un chiffre faux : c'est qu'il rende un
 * chiffre EXTÉRIEUR. Un prix « du marché », une part de marché, une
 * comparaison à un concurrent — aucune de ces données n'existe dans ce
 * produit, et un modèle interrogé là-dessus en produit une plausible.
 * Personne ne vérifie un chiffre qui a l'air normal.
 *
 * La moitié de ces tests sert donc à vérifier des REFUS, ce qui est
 * inhabituel et volontaire. La fonction a été éprouvée en base par
 * `supabase/tests/agents_derniers.sql` ; ce qui reste à tenir ici, c'est
 * le contrat écrit entre elle et le modèle.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

/**
 * Les migrations, lues COMME POSTGRES LES LIT : apostrophes dédoublées,
 * et littéraux concaténés recollés.
 *
 * La seconde normalisation n'est pas un confort. Une phrase longue est
 * coupée par `' || '` pour tenir dans la largeur du fichier ; Postgres
 * en rend UNE, le fichier en montre deux morceaux. Sans le recollage,
 * un test qui cherche la phrase telle qu'elle sera LUE échoue sur un
 * retour à la ligne — et la mauvaise correction serait de raccourcir
 * l'expression cherchée jusqu'à ce qu'elle tienne dans un morceau,
 * c'est-à-dire de tester moins pour ne plus échouer.
 */
function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n")
    .replaceAll("''", "'")
    // Quote, `||`, quote — littéral collé à littéral. Une concaténation
    // avec une VARIABLE (`' || v_x || '`) n'a pas de guillemet des deux
    // côtés du `||` et n'est pas touchée.
    .replace(/'\s*\|\|\s*'/g, "");
}

function corpsFonction(): string {
  const sql = migrations();
  const debut = sql.indexOf("create or replace function public.ai_internal_history(");
  assert.notEqual(debut, -1, "`ai_internal_history` n'est définie dans aucune migration");
  const fin = sql.indexOf("comment on function public.ai_internal_history", debut);
  assert.notEqual(fin, -1, "`ai_internal_history` n'est pas commentée : le découpage est faux");
  return sql.slice(debut, fin);
}

function clesDePremierNiveau(): readonly string[] {
  const corps = corpsFonction();
  const retour = corps.slice(corps.indexOf("return jsonb_build_object("));
  return [...retour.matchAll(/^ {4}'(\w+)',/gm)].map((m) => m[1]);
}

// ==================================================================
// 1. LA RÈGLE QUI TIENT TOUT LE REGISTRE
// ==================================================================

test("l'outil nomme une fonction réellement écrite", () => {
  assert.equal(OUTIL_INTERNAL_HISTORY.rpc, "ai_internal_history");
  assert.ok(
    migrations().includes("create or replace function public.ai_internal_history("),
    "`ai_internal_history` n'est définie dans aucune migration : l'outil pointe dans le vide",
  );
});

test("l'organisation vient de la SESSION, et le modèle n'a aucun paramètre à remplir", () => {
  assert.equal(OUTIL_INTERNAL_HISTORY.injecteOrganisation, true);
  const champs = Object.keys(
    (OUTIL_INTERNAL_HISTORY.parametres as unknown as { shape: Record<string, unknown> }).shape,
  );
  assert.deepEqual(champs, []);

  // L'absence de fenêtre de dates est délibérée : cette fonction rend
  // une PROFONDEUR D'HISTORIQUE, et une période choisie par le modèle
  // permettrait de la rétrécir jusqu'à faire dire à la réponse ce
  // qu'on veut y lire.
  assert.match(
    corpsFonction(),
    /create or replace function public\.ai_internal_history\(\s*p_organization_id uuid\s*\)/,
  );
});

test("une lecture ne réclame aucune confirmation, et n'écrit rien", () => {
  assert.equal(OUTIL_INTERNAL_HISTORY.famille, "lecture");
  assert.equal(OUTIL_INTERNAL_HISTORY.confirmationRequise, false);
  assert.equal(OUTIL_INTERNAL_HISTORY.risque, "low");
  assert.equal(OUTIL_INTERNAL_HISTORY.agent, "market");
});

// ==================================================================
// 2. LE GARDE-FOU : AUCUNE DONNÉE EXTÉRIEURE, JAMAIS
// ==================================================================

test("la fonction déclare l'absence de source extérieure, et dit quoi brancher", () => {
  // Un refus qui dit quoi faire ensuite vaut mieux qu'un refus poli.
  const corps = corpsFonction();
  assert.match(corps, /'sourceExterneAbsente', jsonb_build_object\(/);
  assert.match(corps, /'disponible', false/);
  assert.match(corps, /'motif', 'capaciteAbsente'/);
  assert.match(
    corps,
    /'aBrancher'/,
    "la déclaration ne dit plus ce qu'il faudrait brancher : c'est un refus définitif déguisé",
  );
  assert.match(corps, /table de sources/);
});

test("les trois données extérieures sont refusées NOMMÉMENT, une par une", () => {
  // Un refus global — « je n'ai pas de données de marché » — laisse le
  // modèle décider laquelle des trois il croit pouvoir approcher.
  const corps = corpsFonction();
  assert.match(corps, /'prixDuMarche'/);
  assert.match(corps, /'partDeMarche'/);
  assert.match(corps, /'concurrents'/);

  // Et chacun dit POURQUOI, ce qui est la seule forme de refus qu'un
  // modèle ne contourne pas en cherchant un substitut.
  assert.match(corps, /Aucun prix pratiqué hors de cette entreprise n'existe dans cette base/);
  assert.match(corps, /Le dénominateur — la taille du marché — n'existe dans aucune table/);
  assert.match(corps, /Aucun concurrent n'est nommé nulle part/);
});

test("la description interdit les trois AVANT que le modèle ait vu la réponse", () => {
  // C'est le point qui fait exister ce test : la description est ce que
  // le modèle lit avant d'appeler. Un modèle à qui l'on demande « le
  // prix du marché pour une terrasse » et qui ne voit qu'un outil nommé
  // « historique » peut décider de répondre SANS OUTIL. La description
  // est le seul endroit qui l'en dissuade à temps.
  const d = OUTIL_INTERNAL_HISTORY.description;
  assert.match(d, /AUCUN prix du marché/i);
  assert.match(d, /AUCUNE part de marché/i);
  assert.match(d, /AUCUNE comparaison avec un concurrent/i);
  assert.match(d, /plausible et fausse/);
});

test("le mot « marché » est interdit à l'agent pour parler de ses propres données", () => {
  // S'il dit « le marché », le lecteur comprend « les autres ». C'est
  // une phrase vraie dans l'intention et fausse à la lecture, donc la
  // pire des deux.
  const corps = corpsFonction();
  assert.match(corps, /'avertissement'/);
  assert.match(corps, /le mot « marché » ferait comprendre « les autres » et il est interdit ici/);
  assert.match(corps, /« chez vous », « dans vos devis », « sur vos chantiers »/);
  assert.match(OUTIL_INTERNAL_HISTORY.description, /N'EMPLOIE PAS LE MOT « MARCHÉ »/);
});

test("le nom lisible n'est pas « Marché » : il dit ce que la fonction fait", () => {
  // Un agent affiché « Marché » promettrait au dirigeant ce que
  // personne ne peut lui donner. La clé technique, elle, reste `market`
  // parce que le routeur la connaît déjà — et le routeur n'a pas à
  // bouger pour une question de nom.
  const corps = corpsFonction();
  assert.match(corps, /'agent', 'market'/);
  assert.match(corps, /'nomLisible', 'Historique interne'/);
});

// ==================================================================
// 3. LES SEUILS SONT APPLIQUÉS PAR LE SQL
// ==================================================================

test("le seuil de comparaison est celui du produit, pas un second seuil concurrent", () => {
  // On ne pose pas un nouveau chiffre quand le produit en a déjà un
  // pour exactement la même question : « combien de points faut-il pour
  // qu'une fourchette veuille dire quelque chose ». `ai_quote_comparables`
  // répond cinq depuis 0073.
  const corps = corpsFonction();
  assert.match(corps, /c_seuil\s+constant int := 5;/);
  assert.match(corps, /c_mois_saison\s+constant int := 24;/);
  assert.match(corps, /Le seuil de comparaison est celui de ai_quote_comparables/);
});

test("sous le seuil, aucune part en pourcentage — les lignes brutes et le motif", () => {
  // Une source qui représente « cent pour cent de vos clients » quand
  // vous en avez un est une phrase vraie qui ne décrit rien.
  const corps = corpsFonction();
  assert.match(corps, /'partsPct', case when v_cli_avec_src >= c_seuil then/);
  assert.match(corps, /Parts refusées/);
  assert.match(corps, /Les lignes brutes sont rendues ; le pourcentage ne l'est pas/);

  // Et le calcul de la part, quand il a lieu, est fait par le SQL :
  // le modèle ne divise pas.
  assert.match(corps, /round\(100\.0 \* \(e\.value ->> 'nombre'\)::int \/ v_cli_avec_src, 1\)/);
});

test("la saisonnalité exige une profondeur d'histoire, et le refus dit laquelle", () => {
  const corps = corpsFonction();
  assert.match(corps, /Saisonnalité non calculable/);
  assert.match(corps, /Une saison se compare à la même saison de l'année précédente/);
  assert.match(
    corps,
    /Ce n'est pas « aucune saisonnalité détectée », c'est « pas assez d'histoire pour en détecter une »/,
  );
});

// ==================================================================
// 4. LES TABLES VIDES — L'ÉTAT ACTUEL, DONC LE PREMIER CAS RENCONTRÉ
// ==================================================================

test("sur zéro ligne, la fonction nomme le défaut de saisie plutôt que de conclure", () => {
  // C'est l'état mesuré : un client, une seule ligne de devis rattachée
  // à un article, un mois d'histoire. Un agent qui rend « pas de
  // tendance » sur ces tables affirme quelque chose qu'il n'a pas
  // regardé.
  const corps = corpsFonction();

  // Aucune source renseignée ≠ aucune origine.
  assert.match(corps, /l'origine de votre portefeuille n'est pas mesurable/);
  assert.match(corps, /C'est un champ vide, pas une absence d'origine/);

  // Aucun rattachement au catalogue ≠ un prix stable.
  assert.match(corps, /l'évolution d'un prix unitaire n'est pas suivable/);
  assert.match(corps, /C'est un rattachement absent, pas un prix stable/);

  // Et la description reprend les trois distinctions pour le modèle.
  const d = OUTIL_INTERNAL_HISTORY.description;
  assert.match(d, /est un champ vide, pas une absence d'origine/);
  assert.match(d, /est un rattachement absent, pas un prix stable/);
  assert.match(d, /est un manque d'histoire, pas une absence de saison/);
});

test("les fournisseurs et leurs prix sont comptés SÉPARÉMENT", () => {
  // « Aucun fournisseur » et « des fournisseurs sans prix » sont deux
  // situations différentes, et la réponse à donner n'est pas la même.
  // Les additionner dans un seul zéro effacerait la différence.
  const corps = corpsFonction();
  assert.match(corps, /'fournisseurs', v_fournisseurs/);
  assert.match(corps, /'prixFournisseurs', v_prix_fourn/);
  assert.match(corps, /deux situations différentes/);
});

// ==================================================================
// 5. LES DEUX PIÈGES DE SCHÉMA, ET LES DOUBLONS ÉVITÉS
// ==================================================================

test("le prix rendu est le prix de VENTE, jamais le coût d'achat", () => {
  // `quote_lines` n'a pas de colonne `unit_price_cents` : le prix de
  // vente s'appelle `unit_sale_price_cents`, et `unit_cost_cents` est
  // le coût d'achat, juste à côté. Confondre les deux ferait rendre un
  // coût pour un prix, sans que rien ne le signale.
  const corps = corpsFonction();
  assert.match(corps, /min\(l\.unit_sale_price_cents\) as mn/);
  assert.match(corps, /max\(l\.unit_sale_price_cents\) as mx/);
  assert.ok(
    !/(min|max)\(l\.unit_cost_cents\)/.test(corps),
    "le coût d'achat est agrégé quelque part : il serait rendu comme un prix de vente",
  );
  assert.match(OUTIL_INTERNAL_HISTORY.description, /prix de VENTE unitaire/);
});

test("le rapprochement devis / facture annonce lui-même sa fragilité", () => {
  // `invoice_lines` ne porte aucun `catalog_item_id` : le rapprochement
  // passe par le libellé. Une piste, pas un écart mesuré — et c'est la
  // fonction qui le dit, pas un commentaire que le modèle ne lit pas.
  const corps = corpsFonction();
  assert.match(corps, /Rapprochement par LIBELLÉ, et il est fragile/);
  assert.match(corps, /invoice_lines ne porte aucun catalog_item_id/);
  assert.match(corps, /À lire comme une piste, pas comme un écart mesuré/);
});

test("ce qui appartient à d'autres agents est NOMMÉ, pas recalculé", () => {
  const corps = corpsFonction();
  assert.match(corps, /'margeParServiceVilleOuMois'/);
  assert.match(corps, /ai_finance_margin_breakdown accepte service, mois, ville/);
  assert.match(corps, /'tauxDeTransformation'/);
  assert.match(corps, /'fourchetteDesChantiersComparables'/);
  assert.match(corps, /'prixFournisseurs', 'Domaine de l'agent Achats/);
});

test("aucune clé de premier niveau n'échappe à l'inventaire", () => {
  // Une clé ajoutée demain doit passer par ici, donc par une décision :
  // porte-t-elle une donnée interne, ou fait-elle sortir l'agent de son
  // périmètre ?
  const attendues = [
    "achats",
    "agent",
    "aujourdhuiParis",
    "avertissement",
    "confiance",
    "deviseContreFacture",
    "nomLisible",
    "nonMesurable",
    "organisationId",
    "origineDesClients",
    "prixUnitaireParArticle",
    "saisonnalite",
    "seuils",
    "sourceExterneAbsente",
  ];
  assert.deepEqual(
    [...clesDePremierNiveau()].sort(),
    attendues,
    "ai_internal_history rend une clé que ce test ne connaît pas : " +
      "vérifier qu'elle ne fait pas sortir l'agent de ses propres données",
  );
});

// ==================================================================
// 6. LES DROITS, ET LE COUPLAGE OUTIL / CATALOGUE
// ==================================================================

test("les deux droits lèvent, et le champ « permission » déclare le plus étroit", () => {
  const corps = corpsFonction();
  for (const droit of ["clients.read", "quotes.read"]) {
    assert.ok(
      corps.includes(`perform public.ai_guard(p_organization_id, '${droit}');`),
      `la fonction ne garde plus « ${droit} »`,
    );
  }
  // Mesuré dans `role_permissions` : sept rôles portent `clients.read`,
  // six portent `quotes.read`, et les six sont inclus dans les sept.
  // Déclarer le plus étroit retire l'outil à exactement l'ensemble des
  // comptes qui échoueraient — ni plus, ni moins.
  assert.equal(OUTIL_INTERNAL_HISTORY.permission, "quotes.read");
  assert.equal(OUTIL_INTERNAL_HISTORY.permissionSource, "aiGuard");
});

test("branché ou non, l'outil reste cohérent — et le test change de camp tout seul", () => {
  const registre = registreOutils();
  const inscrit = registre.chercher(OUTIL_INTERNAL_HISTORY.nom);

  if (inscrit === null) {
    // État attendu tant que `runtime/tools.ts` — PARTAGÉ — n'a pas reçu
    // l'import. `tools.test.ts` §8 le réclame déjà, plus fort.
    assert.ok(true);
    return;
  }

  assert.equal(inscrit.rpc, "ai_internal_history");
  assert.equal(inscrit.agent, "market");
  assert.equal(
    inscrit,
    OUTIL_INTERNAL_HISTORY,
    "le catalogue porte une COPIE et non l'import : le jour où l'une des deux est corrigée, " +
      "c'est l'autre qui part au modèle",
  );
});
