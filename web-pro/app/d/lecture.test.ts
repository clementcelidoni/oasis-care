// §PORTE ANONYME — LES PREUVES SUR LA LECTURE D'UN DEVIS PAR JETON.
//
//     node --test --experimental-strip-types "app/d/lecture.test.ts"
//
// AUCUN RÉSEAU, AUCUNE BASE : `lireDevisParJeton` reçoit une fonction
// d'appel, et les tests lui en donnent une qui ment à la demande.
//
// LA PLUPART DE CES ASSERTIONS VÉRIFIENT UNE ABSENCE, et c'est le sujet
// même de la porte anonyme : une page qui montre trop ne se signale par
// aucune erreur. Elle fonctionne parfaitement, et elle fuite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  jetonBienForme,
  lireDevisParJeton,
  normaliserJeton,
  PHRASE_LIEN_CLOS,
  PHRASE_PANNE,
  type AppelPorte,
} from "./lecture.ts";

const JETON = "a".repeat(64);

function ligneOuverte(surcharge: Record<string, unknown> = {}) {
  return [
    {
      ok: true,
      message: null,
      entreprise: { id: "org-1", name: "Jardins Dupont", business_type: "landscaper" },
      devis: {
        id: "devis-1",
        organization_id: "org-1",
        customer_id: "client-1",
        number: "DEV-2026-0007",
        title: "Création d'une haie",
        status: "sent",
        issued_on: "2026-08-01",
        valid_until: "2026-09-01",
        introduction: "Bonjour,",
        terms: "Acompte de 30 %.",
        global_discount_percent: 0,
        created_at: "2026-08-01T10:00:00Z",
      },
      sections: [{ id: "s-2", quote_id: "devis-1", title: "Plantation", description: null, position: 2 }],
      lignes: [
        {
          id: "l-2",
          quote_id: "devis-1",
          section_id: "s-2",
          position: 2,
          description: "Charmille",
          unit: "u",
          quantity: 12,
          unit_sale_price_cents: 1850,
          vat_rate: 20,
          discount_percent: 0,
          sale_total_cents: 22200,
        },
      ],
      ...surcharge,
    },
  ];
}

function appelQuiRend(data: unknown): AppelPorte {
  return async () => ({ data, error: null });
}

// ------------------------------------------------------------------
// 1. LA PHRASE DE REFUS EST LA MÊME QU'EN BASE, AU CARACTÈRE PRÈS
// ------------------------------------------------------------------

test("la phrase de refus est recopiée de 0089 sans divergence", () => {
  // POURQUOI CE TEST EXISTE. `lecture.ts` refuse AVANT d'appeler la base
  // quand le jeton n'a pas la bonne forme ; la base refuse pour tout le
  // reste. Deux phrases différentes selon l'endroit du refus
  // REDONNERAIENT l'oracle qu'on vient de fermer : « mauvaise forme »
  // deviendrait distinguable de « jeton inconnu », et un balayeur
  // apprendrait quelque chose à chaque essai.
  const migration = readFileSync(
    new URL("../../../supabase/migrations/0089_cycle.sql", import.meta.url),
    "utf8",
  );
  const trouve = /v_refus constant text :=\s*'((?:[^']|'')*)'/.exec(migration);
  assert.notEqual(trouve, null, "Le littéral de refus est introuvable dans 0089.");
  // En SQL, une apostrophe s'écrit doublée.
  const phraseEnBase = trouve![1].replace(/''/g, "'");
  assert.equal(PHRASE_LIEN_CLOS, phraseEnBase);
});

// ------------------------------------------------------------------
// 1 bis. LES COLONNES D'ICI SONT CELLES DE LA BASE, DES DEUX CÔTÉS
// ------------------------------------------------------------------

/** Le corps de `devis_par_jeton`, isolé du reste de la migration. */
function corpsDeLaPorte(): string {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/0089_cycle.sql", import.meta.url),
    "utf8",
  );
  const debut = migration.indexOf("create or replace function public.devis_par_jeton");
  const fin = migration.indexOf("create or replace function public.document_share_note_echec");
  assert.ok(debut > 0 && fin > debut, "Le corps de devis_par_jeton est introuvable dans 0089.");
  return migration.slice(debut, fin);
}

function clefsRendues(corps: string, alias: string): string[] {
  const clefs = [...corps.matchAll(new RegExp(`'(\\w+)', ${alias}\\.\\w+`, "g"))].map((m) => m[1]);
  return [...new Set(clefs)].sort();
}

test("les colonnes lues ici sont exactement celles que 0089 rend", async () => {
  // LE TEST RÉCIPROQUE DE « AUCUN COÛT NE TRANSITE ». Celui-là défend
  // contre une base qui rendrait TROP ; celui-ci contre une base qui
  // rendrait AUTRE CHOSE. Sans lui, quelqu'un peut renommer une colonne
  // dans la migration et cette page afficherait un devis à trous — ou
  // ajouter une colonne à la porte SQL en croyant qu'elle s'affichera,
  // alors que la lecture l'ignore en silence.
  const corps = corpsDeLaPorte();
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(ligneOuverte()));
  if (resultat.etat !== "ouvert") throw new Error("devis attendu ouvert");

  assert.deepEqual(Object.keys(resultat.entreprise).sort(), clefsRendues(corps, "v_org"));
  assert.deepEqual(Object.keys(resultat.devis).sort(), clefsRendues(corps, "v_quote"));
  assert.deepEqual(Object.keys(resultat.sections[0]).sort(), clefsRendues(corps, "s"));
  assert.deepEqual(Object.keys(resultat.lignes[0]).sort(), clefsRendues(corps, "l"));
});

test("la porte SQL ne rend aucune colonne de coût ni de note interne", () => {
  // La même vérification, mais côté migration : elle tiendrait même si
  // ce fichier TypeScript disparaissait.
  const corps = corpsDeLaPorte();
  for (const interdit of [
    "unit_cost_cents",
    "cost_total_cents",
    "cost_kind",
    "catalog_item_id",
    "internal_notes",
    "rejection_reason",
    "viewed_at",
  ]) {
    assert.equal(
      corps.includes("'" + interdit + "'"),
      false,
      `0089 rend « ${interdit} » par la porte anonyme.`,
    );
  }
});

// ------------------------------------------------------------------
// 2. LA FORME DU JETON
// ------------------------------------------------------------------

test("un jeton se normalise comme en base : rognage et minuscules", () => {
  assert.equal(normaliserJeton("  " + "A".repeat(64) + "\n"), "a".repeat(64));
  assert.equal(normaliserJeton(null), "");
  assert.equal(normaliserJeton(undefined), "");
});

test("seuls 64 caractères hexadécimaux sont bien formés", () => {
  assert.equal(jetonBienForme(JETON), true);
  assert.equal(jetonBienForme("a".repeat(63)), false);
  assert.equal(jetonBienForme("a".repeat(65)), false);
  assert.equal(jetonBienForme("z".repeat(64)), false);
  assert.equal(jetonBienForme(""), false);
  assert.equal(jetonBienForme("../../etc/passwd"), false);
});

test("un jeton mal formé ne dérange jamais la base", async () => {
  let appele = false;
  const resultat = await lireDevisParJeton("wp-login", async () => {
    appele = true;
    return { data: null, error: null };
  });

  // Le journal de tentatives de la base doit compter les vraies
  // tentatives d'énumération, pas le bruit de fond d'Internet.
  assert.equal(appele, false);
  assert.deepEqual(resultat, { etat: "clos", message: PHRASE_LIEN_CLOS });
});

// ------------------------------------------------------------------
// 3. L'ORDRE DES CONTRÔLES : UNE PANNE N'EST JAMAIS UN REFUS
// ------------------------------------------------------------------

test("une erreur de transport donne une panne, pas un lien mort", async () => {
  const resultat = await lireDevisParJeton(JETON, async () => ({
    data: null,
    error: { message: "fetch failed" },
  }));

  // Dire « votre lien est mort » à chaque hoquet du réseau ferait
  // renoncer un client dont le lien est parfait — et il ne rappellera
  // pas son paysagiste pour un lien qu'on vient de lui dire mort.
  assert.equal(resultat.etat, "panne");
  assert.equal(resultat.etat === "panne" ? resultat.message : "", PHRASE_PANNE);
});

test("une exception du client HTTP est une panne, pas un verdict", async () => {
  const resultat = await lireDevisParJeton(JETON, async () => {
    throw new Error("socket hang up");
  });
  assert.equal(resultat.etat, "panne");
});

test("aucune ligne rendue est une panne : la fonction en rend toujours une", async () => {
  const resultat = await lireDevisParJeton(JETON, appelQuiRend([]));
  assert.equal(resultat.etat, "panne");
});

test("un ok vrai mais une charge inexploitable est une panne", async () => {
  // On n'affiche pas un devis à trous. Un document commercial amputé
  // vaut moins qu'une page d'attente honnête.
  const resultat = await lireDevisParJeton(
    JETON,
    appelQuiRend(ligneOuverte({ devis: { id: "devis-1" } })),
  );
  assert.equal(resultat.etat, "panne");
});

// ------------------------------------------------------------------
// 4. LE REFUS DE LA BASE PASSE TEL QUEL
// ------------------------------------------------------------------

test("le refus de la base est affiché tel quel", async () => {
  const resultat = await lireDevisParJeton(
    JETON,
    appelQuiRend([{ ok: false, message: PHRASE_LIEN_CLOS }]),
  );
  assert.deepEqual(resultat, { etat: "clos", message: PHRASE_LIEN_CLOS });
});

test("un refus sans phrase retombe sur la phrase commune", async () => {
  const resultat = await lireDevisParJeton(JETON, appelQuiRend([{ ok: false, message: "   " }]));
  assert.deepEqual(resultat, { etat: "clos", message: PHRASE_LIEN_CLOS });
});

test("les quatre états fermés rendent le MÊME message", async () => {
  // Expiré, révoqué, inconnu, mal formé. La base rend la même phrase
  // pour les trois premiers ; le quatrième ne l'atteint jamais. Si l'un
  // des quatre se distinguait, un balayeur saurait qu'il a trouvé un
  // vrai devis — et c'est ce oui-ou-non qui rend l'énumération
  // intéressante.
  const malForme = await lireDevisParJeton("pas-un-jeton", appelQuiRend([]));
  const refuseParLaBase = await lireDevisParJeton(
    JETON,
    appelQuiRend([{ ok: false, message: PHRASE_LIEN_CLOS }]),
  );
  assert.equal(malForme.etat, "clos");
  assert.equal(refuseParLaBase.etat, "clos");
  assert.equal(
    malForme.etat === "clos" ? malForme.message : "x",
    refuseParLaBase.etat === "clos" ? refuseParLaBase.message : "y",
  );
});

// ------------------------------------------------------------------
// 5. CE QUI SORT — ET SURTOUT CE QUI NE SORT PAS
// ------------------------------------------------------------------

test("un devis ouvert rend l'entreprise, le devis, les sections et les lignes", async () => {
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(ligneOuverte()));
  assert.equal(resultat.etat, "ouvert");
  if (resultat.etat !== "ouvert") return;

  assert.equal(resultat.entreprise.name, "Jardins Dupont");
  assert.equal(resultat.devis.number, "DEV-2026-0007");
  assert.equal(resultat.sections.length, 1);
  assert.equal(resultat.lignes.length, 1);
  assert.equal(resultat.lignes[0].sale_total_cents, 22200);
});

test("AUCUN COÛT NI AUCUNE MARGE NE PEUT TRANSITER, même si la base en rendait", async () => {
  // LE TEST QUI COMPTE. On simule une base qui, un jour, rendrait des
  // colonnes internes — parce qu'on aurait élargi `devis_par_jeton` sans
  // relire cette page. La lecture reconstruit chaque objet CHAMP PAR
  // CHAMP : ce qui n'est pas nommé ne peut pas ressortir.
  const empoisonne = ligneOuverte();
  Object.assign(empoisonne[0].devis as Record<string, unknown>, {
    internal_notes: "Client difficile, majorer de 15 %.",
    created_by: "utilisateur-1",
  });
  Object.assign((empoisonne[0].lignes as Record<string, unknown>[])[0], {
    unit_cost_cents: 900,
    cost_total_cents: 10800,
    cost_kind: "purchase",
    catalog_item_id: "cat-1",
  });
  Object.assign(empoisonne[0].entreprise as Record<string, unknown>, {
    siret: "12345678900011",
    tax_configuration: { regime: "reel" },
  });

  const resultat = await lireDevisParJeton(JETON, appelQuiRend(empoisonne));
  assert.equal(resultat.etat, "ouvert");
  if (resultat.etat !== "ouvert") return;

  const serialise = JSON.stringify(resultat);
  for (const interdit of [
    "internal_notes",
    "created_by",
    "unit_cost_cents",
    "cost_total_cents",
    "cost_kind",
    "catalog_item_id",
    "siret",
    "tax_configuration",
    "Client difficile",
  ]) {
    assert.equal(
      serialise.includes(interdit),
      false,
      `« ${interdit} » a traversé la porte anonyme.`,
    );
  }
  // Et rien qui ressemble à un coût, même sous un nom qu'on n'a pas
  // prévu : la liste ci-dessus vieillira, celle-ci non.
  assert.equal(/cost|marge|margin/i.test(serialise), false);
});

test("l'entreprise se limite à trois champs", async () => {
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(ligneOuverte()));
  if (resultat.etat !== "ouvert") throw new Error("devis attendu ouvert");
  assert.deepEqual(Object.keys(resultat.entreprise).sort(), [
    "business_type",
    "id",
    "name",
  ]);
});

test("le devis se limite aux douze colonnes de client_quotes, plus l'entreprise", async () => {
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(ligneOuverte()));
  if (resultat.etat !== "ouvert") throw new Error("devis attendu ouvert");
  // `organization_id` en plus des douze : la page en a besoin pour rien
  // d'autre que le rattachement, et il n'apprend rien qu'un devis ne
  // dise déjà. Les douze ÉCARTÉES — internal_notes, created_by, site_id,
  // opportunity_id, garden_id, sent_at, viewed_at, decided_at,
  // rejection_reason, archived_at — n'ont pas de champ pour atterrir.
  assert.deepEqual(Object.keys(resultat.devis).sort(), [
    "created_at",
    "customer_id",
    "global_discount_percent",
    "id",
    "introduction",
    "issued_on",
    "number",
    "organization_id",
    "status",
    "terms",
    "title",
    "valid_until",
  ]);
});

// ------------------------------------------------------------------
// 6. L'ORDRE D'AFFICHAGE, ET LES LIGNES ILLISIBLES
// ------------------------------------------------------------------

test("sections et lignes sont rangées par position", async () => {
  const charge = ligneOuverte();
  (charge[0].sections as unknown[]) = [
    { id: "s-2", quote_id: "d", title: "B", description: null, position: 2 },
    { id: "s-1", quote_id: "d", title: "A", description: null, position: 1 },
  ];
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(charge));
  if (resultat.etat !== "ouvert") throw new Error("devis attendu ouvert");
  assert.deepEqual(
    resultat.sections.map((s) => s.id),
    ["s-1", "s-2"],
  );
});

test("une ligne illisible fait échouer TOUT le document, jamais une ligne en moins", async () => {
  // Écarter la ligne fautive présenterait au client un TOTAL qui ne
  // correspond à rien — et il s'en servirait pour décider. Une page
  // d'attente honnête vaut mieux qu'un devis faux.
  const charge = ligneOuverte();
  (charge[0].lignes as unknown[]).push({ description: "ligne sans identifiant", position: 3 });
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(charge));
  assert.equal(resultat.etat, "panne");
});

test("un montant illisible ne devient jamais zéro", async () => {
  // La règle du dépôt : jamais de repli derrière des centimes inconnus.
  // Zéro euro est un montant ; « je n'ai pas su lire » n'en est pas un,
  // et un devis affiché à 0,00 € est une erreur silencieuse qui a
  // l'air d'un prix.
  const charge = ligneOuverte();
  (charge[0].lignes as Record<string, unknown>[])[0].sale_total_cents = null;
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(charge));
  assert.equal(resultat.etat, "panne");
});

test("une section illisible fait échouer le document : ses lignes disparaîtraient", async () => {
  const charge = ligneOuverte();
  (charge[0].sections as unknown[]).push({ id: "s-3", quote_id: "devis-1", title: 42, position: 3 });
  const resultat = await lireDevisParJeton(JETON, appelQuiRend(charge));
  assert.equal(resultat.etat, "panne");
});

test("des sections absentes donnent un tableau vide, jamais une panne", async () => {
  const resultat = await lireDevisParJeton(
    JETON,
    appelQuiRend(ligneOuverte({ sections: null, lignes: null })),
  );
  assert.equal(resultat.etat, "ouvert");
  if (resultat.etat !== "ouvert") return;
  assert.deepEqual(resultat.sections, []);
  assert.deepEqual(resultat.lignes, []);
});
