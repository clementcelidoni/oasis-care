import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compterParUrgence,
  direEcheance,
  echeances,
  grouperParUrgence,
  HORIZON_PEREMPTION_JOURS,
  urgenceDe,
  type MatierePaillasse,
} from "./taches.ts";
import type { MatiereAttention } from "./cultures.ts";

/**
 * CE QUE CE FICHIER ÉPROUVE : QUE LA LISTE NE CONTIENNE QUE DES
 * ÉCHÉANCES RÉELLES, ET QU'ELLE LES CONTIENNE TOUTES.
 *
 * Une liste de tâches se trompe de deux façons, et les deux se paient
 * cher dans un laboratoire :
 *
 *   • PAR EXCÈS — signaler ce qui n'est pas dû. La liste devient du
 *     bruit, on cesse de l'ouvrir, et le jour où elle a raison personne
 *     ne la lit. Le cas typique ici : un article sans seuil renseigné
 *     qu'on déclarerait « sous le seuil ».
 *
 *   • PAR DÉFAUT — taire une échéance. Le cas typique : un article dont
 *     la date de péremption est nulle et qu'un filtre SQL écarterait
 *     silencieusement, avec son seuil de stock.
 *
 * Les deux sont éprouvés ci-dessous, ainsi que la frontière de minuit,
 * qui décide si quelque chose est « pour aujourd'hui » ou « en retard ».
 */

const MAINTENANT = new Date("2026-09-06T12:00:00Z");

const RIEN_A_SIGNALER: MatiereAttention = {
  finDeCycleDepassee: [],
  finDeCycleProche: [],
  contaminations: [],
  jamaisInspectes: [],
  alertes: [],
};

const PAILLASSE_VIDE: MatierePaillasse = {
  articles: [],
  solutions: [],
  approvisionnements: [],
};

function jourDecale(jours: number): string {
  return new Date(MAINTENANT.getTime() + jours * 86_400_000).toISOString();
}

// ==================================================================
// 1. LA FRONTIÈRE DE MINUIT
// ==================================================================

test("l'urgence se compte en jours de calendrier, pas en tranches de 24 h", () => {
  // 23 h ce soir : moins de 24 heures, mais bien « aujourd'hui ».
  assert.deepEqual(urgenceDe("2026-09-06T23:00:00Z", MAINTENANT), {
    urgence: "aujourdhui",
    jours: 0,
  });
  // 1 h ce matin : déjà passé dans la journée, mais toujours aujourd'hui.
  assert.deepEqual(urgenceDe("2026-09-06T01:00:00Z", MAINTENANT), {
    urgence: "aujourdhui",
    jours: 0,
  });
  // Minuit une, demain : ce n'est plus aujourd'hui.
  assert.deepEqual(urgenceDe("2026-09-07T00:01:00Z", MAINTENANT), {
    urgence: "semaine",
    jours: 1,
  });
  // Hier soir : en retard, même de deux heures.
  assert.deepEqual(urgenceDe("2026-09-05T23:00:00Z", MAINTENANT), {
    urgence: "retard",
    jours: -1,
  });
});

test("les quatre paliers se suivent aux bons jours", () => {
  assert.equal(urgenceDe(jourDecale(7), MAINTENANT).urgence, "semaine");
  assert.equal(urgenceDe(jourDecale(8), MAINTENANT).urgence, "plus-tard");
});

test("sans date, on ne prétend pas à un retard", () => {
  assert.deepEqual(urgenceDe(null, MAINTENANT), { urgence: "aujourdhui", jours: null });
  assert.deepEqual(urgenceDe("n'importe quoi", MAINTENANT), {
    urgence: "aujourdhui",
    jours: null,
  });
});

test("l'échéance se dit en français, dans les deux sens", () => {
  assert.equal(direEcheance(0), "aujourd'hui");
  assert.equal(direEcheance(-1), "il y a 1 jour");
  assert.equal(direEcheance(-12), "il y a 12 jours");
  assert.equal(direEcheance(3), "dans 3 jours");
  assert.equal(direEcheance(null), "sans date");
});

// ==================================================================
// 2. PAS D'ÉCHÉANCE INVENTÉE
// ==================================================================

/**
 * Un article sans seuil renseigné est HORS du dispositif de
 * réapprovisionnement : l'utilisateur n'a jamais dit combien il voulait
 * en garder. Le traiter comme un seuil de zéro le ferait apparaître
 * chaque fois qu'il est vide — et un consommable qu'on ne suit pas est
 * souvent vide.
 */
test("un article sans seuil ne produit aucune tâche de stock", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Pipettes",
          category: null,
          current_quantity: 0,
          minimum_threshold: null,
          unit: "u",
          expiry_date: null,
        },
      ],
    },
    MAINTENANT,
  );

  assert.deepEqual(liste, []);
});

test("un article sans quantité connue ne produit aucune tâche de stock", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Pipettes",
          category: null,
          current_quantity: null,
          minimum_threshold: 10,
          unit: "u",
          expiry_date: null,
        },
      ],
    },
    MAINTENANT,
  );

  assert.deepEqual(liste, []);
});

test("un article au-dessus de son seuil est ignoré", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Agar",
          category: null,
          current_quantity: 11,
          minimum_threshold: 10,
          unit: "g",
          expiry_date: null,
        },
      ],
    },
    MAINTENANT,
  );

  assert.deepEqual(liste, []);
});

test("une péremption trop lointaine n'encombre pas la liste", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Agar",
          category: null,
          current_quantity: null,
          minimum_threshold: null,
          unit: null,
          expiry_date: jourDecale(HORIZON_PEREMPTION_JOURS + 1),
        },
      ],
    },
    MAINTENANT,
  );

  assert.deepEqual(liste, []);
});

// ==================================================================
// 3. AUCUNE ÉCHÉANCE TUE
// ==================================================================

test("le seuil atteint pile compte comme atteint", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Agar",
          category: null,
          current_quantity: 10,
          minimum_threshold: 10,
          unit: "g",
          expiry_date: null,
        },
      ],
    },
    MAINTENANT,
  );

  assert.equal(liste.length, 1);
  assert.equal(liste[0].quoi, "Sous le seuil");
  assert.equal(liste[0].urgence, "aujourdhui");
});

test("un article épuisé est en retard, pas simplement sous le seuil", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Agar",
          category: null,
          current_quantity: 0,
          minimum_threshold: 10,
          unit: "g",
          expiry_date: null,
        },
      ],
    },
    MAINTENANT,
  );

  assert.equal(liste[0].quoi, "Épuisé");
  assert.equal(liste[0].urgence, "retard");
});

/**
 * LE PIÈGE QUE CE TEST GARDE FERMÉ. Filtrer les péremptions dans la
 * requête SQL (`lte("expiry_date", …)`) écarterait aussi les articles
 * dont la date est nulle — c'est-à-dire, silencieusement, leur seuil de
 * stock avec. Le tri se fait donc dans `echeances`, et cet article doit
 * ressortir une fois pour son seuil.
 */
test("un article sans date de péremption garde sa tâche de seuil", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Agar",
          category: null,
          current_quantity: 2,
          minimum_threshold: 10,
          unit: "g",
          expiry_date: null,
        },
      ],
    },
    MAINTENANT,
  );

  assert.equal(liste.length, 1);
  assert.equal(liste[0].famille, "stock");
});

test("un article à la fois bas et périmé produit bien deux tâches distinctes", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      articles: [
        {
          id: "a1",
          name: "Agar",
          category: null,
          current_quantity: 2,
          minimum_threshold: 10,
          unit: "g",
          expiry_date: jourDecale(-3),
        },
      ],
    },
    MAINTENANT,
  );

  assert.equal(liste.length, 2, "réapprovisionner et jeter ne sont pas le même geste");
  assert.deepEqual(new Set(liste.map((e) => e.famille)), new Set(["stock", "peremption"]));
});

test("un produit déjà périmé reste dans la liste, quelle que soit son ancienneté", () => {
  const liste = echeances(
    RIEN_A_SIGNALER,
    {
      ...PAILLASSE_VIDE,
      solutions: [
        {
          id: "s1",
          name: "BAP 1 mM",
          expires_at: jourDecale(-400),
          remaining_volume_liters: 0.2,
          storage_location: "Frigo 2",
        },
      ],
    },
    MAINTENANT,
  );

  assert.equal(liste.length, 1);
  assert.equal(liste[0].urgence, "retard");
  assert.match(liste[0].quoi, /périmée/);
  assert.match(liste[0].detail, /Frigo 2/);
});

// ==================================================================
// 4. LE CÔTÉ CULTURE VIENT DE `cultures.ts`, PAS D'UNE SECONDE RÈGLE
// ==================================================================

test("un lot au-delà de son terme devient une tâche datée et cliquable", () => {
  const liste = echeances(
    {
      ...RIEN_A_SIGNALER,
      finDeCycleDepassee: [
        { id: "lot-1", batch_code: "A-2026-001", expected_end_at: jourDecale(-5) },
      ],
    },
    PAILLASSE_VIDE,
    MAINTENANT,
  );

  assert.equal(liste.length, 1);
  assert.equal(liste[0].famille, "culture");
  assert.equal(liste[0].objet, "A-2026-001");
  assert.equal(liste[0].jours, -5);
  assert.equal(liste[0].lien?.href, "/biolab/lots/lot-1");
});

/**
 * Le retard d'une inspection se compte à partir du jour où le seuil de
 * quatorze jours a été franchi, pas depuis le début du lot. Un lot actif
 * depuis vingt jours a quatorze jours de vie normale et six jours de
 * retard — annoncer « vingt jours de retard » exagérerait d'un facteur
 * trois, sur l'indicateur qui décide d'aller ouvrir un bocal.
 */
test("le retard d'inspection se compte depuis le seuil, pas depuis le début du lot", () => {
  const liste = echeances(
    {
      ...RIEN_A_SIGNALER,
      jamaisInspectes: [
        { id: "lot-1", batch_code: "A-2026-001", started_at: jourDecale(-20) },
      ],
    },
    PAILLASSE_VIDE,
    MAINTENANT,
  );

  assert.equal(liste[0].famille, "inspection");
  assert.equal(liste[0].jours, -6, "20 jours de vie moins les 14 jours accordés");
});

test("une alerte critique du téléphone passe en retard, une information reste du jour", () => {
  const liste = echeances(
    {
      ...RIEN_A_SIGNALER,
      alertes: [
        {
          id: "al-1",
          alert_type: "unresponsivePump",
          priority: "critical",
          message: "BR1 : la pompe à air ne répond plus.",
          created_at: jourDecale(-2),
        },
        {
          id: "al-2",
          alert_type: "mediumChangeDue",
          priority: "info",
          message: "A-2026-001 : changement de milieu prévu.",
          created_at: MAINTENANT.toISOString(),
        },
      ],
    },
    PAILLASSE_VIDE,
    MAINTENANT,
  );

  const critique = liste.find((e) => e.id === "alerte-al-1")!;
  const info = liste.find((e) => e.id === "alerte-al-2")!;
  assert.equal(critique.urgence, "retard");
  assert.equal(info.urgence, "aujourdhui");
  // Le message du téléphone est repris tel quel : le réécrire ici le
  // ferait diverger de ce que l'opérateur a vu sur son écran.
  assert.equal(critique.detail, "BR1 : la pompe à air ne répond plus.");
});

// ==================================================================
// 5. L'ORDRE ET LES GROUPES
// ==================================================================

test("le plus en retard remonte en tête", () => {
  const liste = echeances(
    {
      ...RIEN_A_SIGNALER,
      finDeCycleDepassee: [
        { id: "lot-1", batch_code: "RECENT", expected_end_at: jourDecale(-1) },
        { id: "lot-2", batch_code: "ANCIEN", expected_end_at: jourDecale(-30) },
      ],
      finDeCycleProche: [
        { id: "lot-3", batch_code: "BIENTOT", expected_end_at: jourDecale(3) },
      ],
    },
    PAILLASSE_VIDE,
    MAINTENANT,
  );

  assert.deepEqual(
    liste.map((e) => e.objet),
    ["ANCIEN", "RECENT", "BIENTOT"],
  );
});

test("le comptage et le regroupement s'accordent", () => {
  const liste = echeances(
    {
      ...RIEN_A_SIGNALER,
      finDeCycleDepassee: [
        { id: "lot-1", batch_code: "A", expected_end_at: jourDecale(-1) },
      ],
      finDeCycleProche: [
        { id: "lot-2", batch_code: "B", expected_end_at: jourDecale(2) },
        { id: "lot-3", batch_code: "C", expected_end_at: jourDecale(4) },
      ],
    },
    PAILLASSE_VIDE,
    MAINTENANT,
  );

  const compte = compterParUrgence(liste);
  assert.deepEqual(compte, { retard: 1, aujourdhui: 0, semaine: 2, "plus-tard": 0 });

  const groupes = grouperParUrgence(liste);
  assert.deepEqual(
    groupes.map((g) => g.urgence),
    ["retard", "semaine"],
    "un palier vide ne fait pas de section vide",
  );
  assert.equal(
    groupes.reduce((total, g) => total + g.lignes.length, 0),
    liste.length,
    "aucune ligne ne se perd au regroupement",
  );
});

test("un laboratoire sans échéance rend une liste vide, pas une ligne « tout va bien »", () => {
  assert.deepEqual(echeances(RIEN_A_SIGNALER, PAILLASSE_VIDE, MAINTENANT), []);
});
