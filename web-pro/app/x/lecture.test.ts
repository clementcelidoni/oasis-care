// §15 — CE QUE LA PORTE DES ÉTIQUETTES LAISSE PASSER, ET CE QU'ELLE RETIENT.
//
//     node --test --experimental-strip-types "app/x/lecture.test.ts"
//
// Aucun réseau, aucune base : `lireEtiquetteParJeton` reçoit une
// fonction d'appel, et les tests la remplacent par un double. Trois
// tests seulement lisent un fichier — la migration 0090 — pour vérifier
// que les deux moitiés de la porte disent la même chose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cheminInterne,
  ECRAN_FICHE_PUBLIQUE,
  ECRAN_VIERGE,
  jetonBienForme,
  lireEtiquetteParJeton,
  normaliserJeton,
  PHRASE_PANNE,
  PHRASE_REFUS,
  type AppelResolveur,
} from "./lecture.ts";

const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/0090_etiquettes.sql", import.meta.url),
  "utf8",
);

/** Un jeton bien formé, pour tous les cas où la forme n'est pas le sujet. */
const JETON = "a".repeat(32);

function repond(ligne: unknown): AppelResolveur {
  return async () => ({ data: [ligne], error: null });
}

// ------------------------------------------------------------------
// 1. LES DEUX MOITIÉS DE LA PORTE DISENT LA MÊME CHOSE
// ------------------------------------------------------------------

test("la phrase de refus est recopiée de 0090 sans divergence", () => {
  // Elle sert ici quand on refuse AVANT d'appeler la base — un jeton mal
  // formé. Si les deux textes divergeaient, la longueur du jeton
  // deviendrait devinable au libellé du refus : un balayeur saurait
  // lesquelles de ses tentatives ont au moins atteint la base.
  assert.equal(
    MIGRATION.includes(PHRASE_REFUS),
    true,
    "la phrase de refus de lecture.ts ne se retrouve pas mot pour mot dans 0090",
  );
});

test("la forme du jeton est la même ici et en base", () => {
  // 32 caractères hexadécimaux minuscules, des deux côtés. Le jour où
  // quelqu'un raccourcit le jeton pour densifier moins les QR, ce test
  // échoue tant que les deux moitiés ne sont pas changées ensemble.
  assert.equal(MIGRATION.includes("'^[0-9a-f]{32}$'"), true);
  assert.equal(jetonBienForme("0123456789abcdef0123456789abcdef"), true);
});

test("les deux écrans nommés ici sont ceux que 0090 rend", () => {
  assert.equal(MIGRATION.includes(`'${ECRAN_VIERGE}'`), true);
  assert.equal(MIGRATION.includes(`'${ECRAN_FICHE_PUBLIQUE}'`), true);
});

// ------------------------------------------------------------------
// 2. LA FORME DU JETON, AVANT DE DÉRANGER QUI QUE CE SOIT
// ------------------------------------------------------------------

test("un jeton se normalise comme en base : rognage et minuscules", () => {
  assert.equal(normaliserJeton("  ABCdef  "), "abcdef");
  assert.equal(normaliserJeton(null), "");
  assert.equal(normaliserJeton(undefined), "");
});

test("seuls 32 caractères hexadécimaux sont bien formés", () => {
  assert.equal(jetonBienForme(JETON), true);
  assert.equal(jetonBienForme("a".repeat(31)), false);
  assert.equal(jetonBienForme("a".repeat(33)), false);
  assert.equal(jetonBienForme("g".repeat(32)), false);
  // 64 caractères, c'est un jeton de PARTAGE DE DOCUMENT (0089), pas
  // d'étiquette. Les deux registres ne doivent pas se répondre l'un pour
  // l'autre.
  assert.equal(jetonBienForme("a".repeat(64)), false);
  assert.equal(jetonBienForme(""), false);
});

test("un jeton mal formé ne dérange jamais la base", async () => {
  let appels = 0;
  const resultat = await lireEtiquetteParJeton("wp-login", async () => {
    appels += 1;
    return { data: null, error: null };
  });
  assert.equal(appels, 0);
  assert.deepEqual(resultat, { etat: "clos", message: PHRASE_REFUS });
});

// ------------------------------------------------------------------
// 3. LA PANNE N'EST JAMAIS UN REFUS
// ------------------------------------------------------------------

test("une erreur de transport donne une panne, pas une étiquette morte", async () => {
  const resultat = await lireEtiquetteParJeton(JETON, async () => ({
    data: null,
    error: { message: "connexion perdue" },
  }));
  assert.deepEqual(resultat, { etat: "panne", message: PHRASE_PANNE });
});

test("une exception du client HTTP est une panne, pas un verdict", async () => {
  const resultat = await lireEtiquetteParJeton(JETON, async () => {
    throw new Error("réseau");
  });
  assert.equal(resultat.etat, "panne");
});

test("aucune ligne rendue est une panne : la fonction en rend toujours une", async () => {
  const resultat = await lireEtiquetteParJeton(JETON, async () => ({ data: [], error: null }));
  assert.equal(resultat.etat, "panne");
});

test("une portée inconnue est une panne, jamais un affichage au hasard", async () => {
  // Ne peut arriver qu'entre une migration qui ajoute une portée et le
  // déploiement de cette page. Afficher « quelque chose » serait le
  // moment exact où une donnée non prévue s'échapperait.
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({ ok: true, portee: "partielle", titre: "X", details: { secret: 1 } }),
  );
  assert.equal(resultat.etat, "panne");
});

// ------------------------------------------------------------------
// 4. INCONNUE ET INTERDITE SONT LA MÊME RÉPONSE
// ------------------------------------------------------------------

test("le refus de la base est affiché tel quel", async () => {
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({ ok: false, message: PHRASE_REFUS }),
  );
  assert.deepEqual(resultat, { etat: "clos", message: PHRASE_REFUS });
});

test("un refus sans phrase retombe sur la phrase commune", async () => {
  const resultat = await lireEtiquetteParJeton(JETON, repond({ ok: false, message: "   " }));
  assert.deepEqual(resultat, { etat: "clos", message: PHRASE_REFUS });
});

test("inconnue, révoquée, orpheline et interdite rendent le MÊME résultat", async () => {
  // La base rend déjà la même ligne dans les quatre cas ; ce test
  // verrouille le fait que ce module n'invente aucune nuance en la
  // relisant. Une nuance ici suffirait à rouvrir l'oracle.
  const quatre = [
    { ok: false, message: PHRASE_REFUS }, // jeton inventé
    { ok: false, message: PHRASE_REFUS, portee: null }, // étiquette révoquée
    { ok: false, message: PHRASE_REFUS, entite_type: null }, // objet effacé
    { ok: false, message: PHRASE_REFUS, ecran: null }, // porteur sans droit
  ];
  const rendus = [];
  for (const ligne of quatre) {
    rendus.push(await lireEtiquetteParJeton(JETON, repond(ligne)));
  }
  for (const rendu of rendus) {
    assert.deepEqual(rendu, rendus[0]);
  }
});

test("un refus ne laisse échapper ni type, ni identifiant, ni chemin", async () => {
  // Même si la base se mettait à en rendre lors d'un refus — ce qu'elle
  // ne fait pas — rien ne doit remonter : ce sont exactement les trois
  // choses qui prouveraient l'existence de l'objet.
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: false,
      message: PHRASE_REFUS,
      entite_type: "nurseryLot",
      entite_id: "11111111-1111-1111-1111-111111111111",
      chemin: "/pepiniere/lots/11111111-1111-1111-1111-111111111111",
      titre: "Lot AF-2026-018",
    }),
  );
  assert.deepEqual(Object.keys(resultat).sort(), ["etat", "message"]);
});

// ------------------------------------------------------------------
// 5. LA PORTÉE COMPLÈTE — ON EMMÈNE, ON N'AFFICHE PAS
// ------------------------------------------------------------------

test("une portée complète rend le chemin et le titre", async () => {
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "complet",
      entite_type: "plant",
      entite_id: "22222222-2222-2222-2222-222222222222",
      ecran: "plante",
      chemin: "/digital-twin/abc?plante=def",
      titre: "Phoenix du jardin nord",
      details: { common_name: "Palmier", health_status: "declining" },
    }),
  );
  assert.deepEqual(resultat, {
    etat: "complet",
    entiteType: "plant",
    ecran: "plante",
    chemin: "/digital-twin/abc?plante=def",
    titre: "Phoenix du jardin nord",
  });
});

test("AUCUN DÉTAIL NE TRANSITE EN PORTÉE COMPLÈTE, même si la base en rend", async () => {
  // La page redirige : elle n'a rien à afficher, donc rien à recevoir.
  // C'est la leçon de `app/d/lecture.ts`, dont la première version
  // laissait passer l'objet entier et aurait livré la marge du
  // paysagiste le jour où la fonction SQL aurait grandi d'une colonne.
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "complet",
      entite_type: "nurseryLot",
      ecran: "pepiniere.lot",
      chemin: "/pepiniere/lots/x",
      titre: "AF-2026-018",
      details: {
        supplier_id: "fournisseur-secret",
        acquisition_cost_cents: 249900,
        notes: "négocié à moitié prix",
      },
    }),
  );
  const serialise = JSON.stringify(resultat);
  assert.equal(serialise.includes("fournisseur-secret"), false);
  assert.equal(serialise.includes("249900"), false);
  assert.equal(serialise.includes("moitié prix"), false);
  assert.equal(serialise.includes("entite_id"), false);
});

test("un chemin qui sortirait du site est refusé", async () => {
  // Une redirection ouverte servie depuis notre propre domaine, sur la
  // seule route ouverte à tout Internet, serait la faute la plus bête
  // de ce chantier. Le contrôle ne coûte rien.
  for (const dehors of [
    "//ailleurs.example/piege",
    "https://ailleurs.example/piege",
    "\\\\ailleurs.example",
    "javascript:alert(1)",
    "digital-twin/abc",
    "",
  ]) {
    assert.equal(cheminInterne(dehors), null, `« ${dehors} » aurait dû être refusé`);
  }
  assert.equal(cheminInterne("/materiel/abc"), "/materiel/abc");
  assert.equal(cheminInterne("  /materiel/abc  "), "/materiel/abc");
});

test("un chemin refusé n'empêche pas de reconnaître l'étiquette", async () => {
  // On perd la redirection, pas la reconnaissance : le porteur a bien le
  // droit, et lui répondre « cette étiquette ne mène à rien » serait
  // faux.
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "complet",
      entite_type: "equipment",
      ecran: "materiel",
      chemin: "//ailleurs.example",
      titre: "Mini-pelle",
    }),
  );
  assert.equal(resultat.etat, "complet");
  assert.equal(resultat.etat === "complet" ? resultat.chemin : "?", null);
});

// ------------------------------------------------------------------
// 6. L'ÉTIQUETTE VIERGE — § 19
// ------------------------------------------------------------------

test("une étiquette vierge a son propre état, et rien d'autre dedans", async () => {
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "complet",
      entite_type: null,
      ecran: ECRAN_VIERGE,
      chemin: null,
      titre: "Étiquette vierge",
      details: {},
    }),
  );
  assert.deepEqual(resultat, { etat: "vierge" });
});

// ------------------------------------------------------------------
// 7. LA FICHE PUBLIQUE — TROIS CHAMPS, JAMAIS UN DE PLUS
// ------------------------------------------------------------------

test("une fiche publiée rend le nom commun, le nom scientifique et le type", async () => {
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "publique",
      entite_type: "plant",
      entite_id: null,
      ecran: ECRAN_FICHE_PUBLIQUE,
      chemin: null,
      titre: "Palmier des Canaries",
      details: {
        common_name: "Palmier des Canaries",
        scientific_name: "Phoenix canariensis",
        type: "palm",
      },
    }),
  );
  assert.deepEqual(resultat, {
    etat: "publique",
    entiteType: "plant",
    titre: "Palmier des Canaries",
    fiche: {
      nomCommun: "Palmier des Canaries",
      nomScientifique: "Phoenix canariensis",
      type: "palm",
    },
  });
});

test("RIEN D'AUTRE QUE LES TROIS CHAMPS NE PEUT ATTEINDRE UN PASSANT", async () => {
  // On simule exactement ce qui arrivera un jour : quelqu'un élargit la
  // fonction SQL pour un besoin interne, sans relire cette page. Une
  // adresse, un nom de client, un état sanitaire et des coordonnées GPS
  // partent alors vers un inconnu, dans le HTML d'une page publique,
  // sans qu'aucune erreur ne se produise.
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "publique",
      entite_type: "plant",
      ecran: ECRAN_FICHE_PUBLIQUE,
      titre: "Palmier",
      details: {
        common_name: "Palmier",
        scientific_name: "Phoenix canariensis",
        type: "palm",
        custom_name: "le palmier de Mamie",
        latitude: 43.7,
        longitude: 7.26,
        health_status: "declining",
        customer_name: "Famille Durand",
        notes: "à remplacer au printemps",
        garden_id: "33333333-3333-3333-3333-333333333333",
      },
    }),
  );
  const serialise = JSON.stringify(resultat);
  for (const interdit of [
    "Mamie",
    "43.7",
    "7.26",
    "declining",
    "Durand",
    "printemps",
    "33333333",
  ]) {
    assert.equal(serialise.includes(interdit), false, `« ${interdit} » a traversé la porte`);
  }
});

test("une fiche entièrement vide est une panne, jamais un cadre vide", async () => {
  // Un passant devant trois lignes vides n'apprend pas ce qu'il a sous
  // les yeux et repart en croyant l'étiquette cassée. Un aveu honnête
  // vaut mieux.
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "publique",
      entite_type: "plant",
      ecran: ECRAN_FICHE_PUBLIQUE,
      titre: "Palmier",
      details: { common_name: "  ", scientific_name: null, type: "" },
    }),
  );
  assert.equal(resultat.etat, "panne");
});

test("une fiche publiée sans titre est une panne", async () => {
  const resultat = await lireEtiquetteParJeton(
    JETON,
    repond({
      ok: true,
      portee: "publique",
      entite_type: "plant",
      ecran: ECRAN_FICHE_PUBLIQUE,
      titre: "   ",
      details: { common_name: "Palmier", scientific_name: null, type: "palm" },
    }),
  );
  assert.equal(resultat.etat, "panne");
});

test("des détails qui ne sont pas un objet ne font pas tomber la page", async () => {
  for (const details of [null, "texte", 42, []]) {
    const resultat = await lireEtiquetteParJeton(
      JETON,
      repond({
        ok: true,
        portee: "publique",
        entite_type: "plant",
        ecran: ECRAN_FICHE_PUBLIQUE,
        titre: "Palmier",
        details,
      }),
    );
    assert.equal(resultat.etat, "panne");
  }
});

test("une ligne rendue hors tableau est lue quand même", async () => {
  // `rpc()` rend tantôt un tableau, tantôt l'objet seul selon la forme
  // de la fonction. On accepte les deux plutôt que de dépendre d'un
  // détail de la bibliothèque.
  const resultat = await lireEtiquetteParJeton(JETON, async () => ({
    data: { ok: false, message: PHRASE_REFUS },
    error: null,
  }));
  assert.equal(resultat.etat, "clos");
});
