import { test } from "node:test";
import assert from "node:assert/strict";

// Chemin relatif, et non l'alias `@/` : ces tests tournent sous
// `node --test`, qui ne lit pas les `paths` du tsconfig.
import {
  STADES,
  STADE_LABELS,
  STADE_TON,
  STATUTS_LOT,
  STATUT_LOT_LABELS,
  STATUT_LOT_TON,
  CONTAMINATIONS,
  CONTAMINATION_LABELS,
  CONTAMINATION_TON,
  SEVERITES,
  SEVERITE_LABELS,
  SEVERITE_TON,
  STATUTS_ACCLIMATATION,
  STATUT_ACCLIMATATION_LABELS,
  STATUT_ACCLIMATATION_TON,
  SYSTEMES,
  SYSTEME_LABELS,
  PRIORITES,
  PRIORITE_LABELS,
  PRIORITE_TON,
  SEUIL_INSPECTION_JOURS,
  libelle,
  tonDe,
  formatNombre,
  formatPourcentage,
  formatFacteur,
  formatDuree,
  formatAnciennete,
  joursDepuis,
  pointsDAttention,
  type MatiereAttention,
} from "./cultures.ts";

/**
 * §7 — CE QUE CE FICHIER ÉPROUVE, ET CE QU'IL NE CHERCHE PAS À ÉPROUVER.
 *
 * Il ne vérifie pas « que le code marche ». Il vérifie les trois
 * endroits où une erreur produirait un MENSONGE À L'ÉCRAN plutôt
 * qu'une panne — c'est-à-dire les trois endroits que personne ne
 * verrait passer :
 *
 *   1. UN TAUX INCONNU AFFICHÉ COMME UN ZÉRO. « 0 % de contamination »
 *      et « aucune inspection pour en juger » sont deux affirmations
 *      différentes, et l'une des deux serait fausse. La base rend NULL
 *      pour la seconde ; si la mise en forme la transformait en « 0 % »,
 *      un laboratoire qui n'a rien inspecté se croirait sain.
 *
 *   2. UNE VALEUR VENUE DE LA BASE QUE LE WEB NE CONNAÎT PAS. Le
 *      téléphone peut écrire demain un stade que ce fichier ignore.
 *      Afficher la valeur brute est laid mais vrai ; afficher « — »
 *      effacerait une information réelle.
 *
 *   3. UN TABLEAU DE BORD QUI TAIT UNE CONTAMINATION. C'est le seul
 *      point d'attention qui désigne une perte DÉJÀ FAITE : s'il passait
 *      derrière une échéance à venir, on regarderait la semaine
 *      prochaine avant de regarder ce qui est mort hier.
 */

// ==================================================================
// 1. LES VOCABULAIRES SONT COMPLETS
// ==================================================================

/**
 * Un libellé ou un ton manquant ne casse rien : la table rend
 * `undefined`, React affiche du vide, et une colonne entière devient
 * muette sans qu'aucune erreur ne soit levée. D'où ces six tests
 * d'exhaustivité, qui coûtent trois lignes chacun.
 */
test("chaque stade a un libellé français et un ton", () => {
  for (const stade of STADES) {
    assert.ok(STADE_LABELS[stade], `libellé manquant pour ${stade}`);
    assert.ok(STADE_TON[stade], `ton manquant pour ${stade}`);
  }
  assert.equal(STADES.length, 8);
});

test("chaque état de lot a un libellé et un ton", () => {
  for (const statut of STATUTS_LOT) {
    assert.ok(STATUT_LOT_LABELS[statut]);
    assert.ok(STATUT_LOT_TON[statut]);
  }
});

test("« divisé » n'est pas un échec : il ne doit pas être teinté en rouge", () => {
  // Un lot divisé a passé la main à ses sous-lots et garde son compte
  // d'alors comme fait historique. Le rouge ferait croire à une perte.
  assert.notEqual(STATUT_LOT_TON.split, "critical");
  assert.equal(STATUT_LOT_TON.discarded, "critical");
});

test("chaque état de contamination a un libellé et un ton", () => {
  for (const c of CONTAMINATIONS) {
    assert.ok(CONTAMINATION_LABELS[c]);
    assert.ok(CONTAMINATION_TON[c]);
  }
  // Seule la contamination CONFIRMÉE est critique : « suspectée » est
  // une inquiétude, pas un fait, et les peindre pareil transformerait
  // l'une en l'autre.
  assert.equal(CONTAMINATION_TON.confirmed, "critical");
  assert.notEqual(CONTAMINATION_TON.suspected, "critical");
});

test("chaque sévérité observée a un libellé et un ton", () => {
  for (const s of SEVERITES) {
    assert.ok(SEVERITE_LABELS[s]);
    assert.ok(SEVERITE_TON[s]);
  }
});

test("chaque état d'acclimatation, chaque système, chaque priorité ont leur libellé", () => {
  for (const s of STATUTS_ACCLIMATATION) {
    assert.ok(STATUT_ACCLIMATATION_LABELS[s]);
    assert.ok(STATUT_ACCLIMATATION_TON[s]);
  }
  for (const s of SYSTEMES) assert.ok(SYSTEME_LABELS[s]);
  for (const p of PRIORITES) {
    assert.ok(PRIORITE_LABELS[p]);
    assert.ok(PRIORITE_TON[p]);
  }
});

test("une valeur inconnue de la base s'affiche telle quelle, jamais effacée", () => {
  // Le téléphone peut écrire un stade que ce fichier ne connaît pas.
  assert.equal(libelle(STADE_LABELS, "callogenese"), "callogenese");
  assert.equal(tonDe(STADE_TON, "callogenese"), "neutral");
  // Absente, en revanche, la valeur n'est rien : le tiret est correct.
  assert.equal(libelle(STADE_LABELS, null), "—");
  assert.equal(libelle(STADE_LABELS, ""), "—");
});

// ==================================================================
// 2. UN TAUX INCONNU N'EST PAS UN ZÉRO
// ==================================================================

test("null reste null : jamais transformé en zéro", () => {
  assert.equal(formatNombre(null), null);
  assert.equal(formatNombre(undefined), null);
  assert.equal(formatPourcentage(null), null);
  assert.equal(formatPourcentage(undefined), null);
  assert.equal(formatFacteur(null), null);
  assert.equal(formatDuree(null), null);
});

test("un vrai zéro, lui, s'affiche bien comme un zéro", () => {
  // La distinction est tout l'enjeu : « 0 % » est une mesure, « — » est
  // une absence de mesure. Confondre les deux est le bogue que ces
  // tests existent pour empêcher.
  assert.equal(formatNombre(0), "0");
  assert.equal(formatPourcentage(0), "0 %");
  assert.equal(formatFacteur(0), "×0");
});

test("un numeric rendu en chaîne par PostgREST est lu comme un nombre", () => {
  // Postgres sérialise parfois `numeric` en chaîne. Sans cette
  // tolérance, le taux afficherait « NaN % » sans que rien ne plante.
  assert.equal(formatPourcentage("0.25"), "25 %");
  assert.equal(formatFacteur("3.4"), "×3,4");
  // Le séparateur de milliers français est une espace insécable étroite
  // dont le point de code a changé au fil des versions d'ICU : on le
  // demande à Intl plutôt que de l'écrire en dur, sinon ce test casse
  // à la prochaine montée de Node sans qu'aucun bogue n'existe.
  const separateur = new Intl.NumberFormat("fr-FR").format(1000).replace(/\d/g, "");
  assert.equal(formatNombre("1500"), `1${separateur}500`);
});

test("une valeur illisible ne produit pas « NaN » à l'écran", () => {
  assert.equal(formatPourcentage("bonjour"), null);
  assert.equal(formatFacteur("—"), null);
});

test("les pourcentages et les facteurs sont écrits à la française", () => {
  assert.equal(formatPourcentage(0.0734), "7,3 %");
  // Le rendement de multiplication se dit « ×3,4 » devant un bocal,
  // jamais « 340 % ».
  assert.equal(formatFacteur(3.42), "×3,42");
});

test("une durée se dit en secondes, minutes ou heures selon sa taille", () => {
  assert.equal(formatDuree(45), "45 s");
  assert.equal(formatDuree(600), "10 min");
  assert.equal(formatDuree(3600), "1 h");
  assert.equal(formatDuree(5400), "1 h 30");
});

// ==================================================================
// 3. LA FRAÎCHEUR, PARCE QUE RIEN N'EST EN DIRECT
// ==================================================================

test("l'ancienneté se dit en mots, et jamais dans le futur", () => {
  const maintenant = new Date("2026-09-06T12:00:00Z");
  assert.equal(formatAnciennete("2026-09-06T11:58:00Z", maintenant), "il y a 2 min");
  assert.equal(formatAnciennete("2026-09-06T09:00:00Z", maintenant), "il y a 3 h");
  assert.equal(formatAnciennete("2026-09-01T12:00:00Z", maintenant), "il y a 5 j");
  // Une horloge en avance ne doit pas produire « il y a -3 min ».
  assert.equal(formatAnciennete("2026-09-06T12:03:00Z", maintenant), "à l'instant");
  assert.equal(formatAnciennete(null, maintenant), null);
});

test("joursDepuis compte des jours entiers", () => {
  const maintenant = new Date("2026-09-06T12:00:00Z");
  assert.equal(joursDepuis("2026-09-06T00:00:00Z", maintenant), 0);
  assert.equal(joursDepuis("2026-08-23T12:00:00Z", maintenant), 14);
});

// ==================================================================
// 4. LES POINTS D'ATTENTION
// ==================================================================

const RIEN: MatiereAttention = {
  finDeCycleDepassee: [],
  finDeCycleProche: [],
  contaminations: [],
  jamaisInspectes: [],
  alertes: [],
};

const MAINTENANT = new Date("2026-09-06T12:00:00Z");

test("un laboratoire sans souci ne produit AUCUNE ligne", () => {
  // Et surtout pas une ligne « tout va bien » : c'est à l'écran de
  // distinguer « rien à arbitrer » de « rien du tout dans la base »,
  // parce que lui seul sait si le laboratoire contient quelque chose.
  assert.deepEqual(pointsDAttention(RIEN, MAINTENANT), []);
});

test("la contamination confirmée passe avant tout le reste", () => {
  const points = pointsDAttention(
    {
      ...RIEN,
      finDeCycleProche: [
        { id: "1", batch_code: "A-001", expected_end_at: "2026-09-08T00:00:00Z" },
      ],
      finDeCycleDepassee: [
        { id: "2", batch_code: "A-002", expected_end_at: "2026-09-01T00:00:00Z" },
      ],
      contaminations: [{ id: "i1", date: "2026-09-05T00:00:00Z", lot: "A-003" }],
    },
    MAINTENANT,
  );

  // Une perte déjà faite se lit avant une échéance à venir.
  assert.equal(points[0].id, "contaminations");
  assert.equal(points[0].ton, "critical");
  assert.ok(points[0].titre.includes("1 contamination confirmée"));
  assert.ok(points[0].detail.includes("A-003"));

  // Et ce qui arrive se lit en dernier.
  assert.equal(points[points.length - 1].id, "fin-de-cycle-proche");
});

test("le mot « confirmée » est écrit, parce qu'il désigne un jugement humain", () => {
  const points = pointsDAttention(
    { ...RIEN, contaminations: [{ id: "i1", date: "2026-09-05T00:00:00Z", lot: "A-003" }] },
    MAINTENANT,
  );
  assert.ok(points[0].detail.includes("confirmée"));
  assert.ok(!points[0].titre.toLowerCase().includes("suspect"));
});

test("les alertes du téléphone gardent leur message, et les plus graves d'abord", () => {
  const points = pointsDAttention(
    {
      ...RIEN,
      alertes: [
        {
          id: "a1",
          alert_type: "lateInspection",
          priority: "info",
          message: "Lot A-001 : aucune inspection enregistrée depuis 20 jours.",
          created_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "a2",
          alert_type: "unresponsivePump",
          priority: "critical",
          message: "BR-01 : la pompe à air n'a pas répondu aux deux dernières commandes.",
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
    },
    MAINTENANT,
  );

  assert.equal(points[0].id, "alerte-a2");
  assert.equal(points[0].titre, "Pompe non répondante");
  // Le message a été composé par le téléphone avec le code réel : le
  // réécrire ici le ferait diverger.
  assert.equal(points[0].detail, "BR-01 : la pompe à air n'a pas répondu aux deux dernières commandes.");
  assert.equal(points[1].id, "alerte-a1");
});

test("une alerte d'un type inconnu affiche son type plutôt que rien", () => {
  const points = pointsDAttention(
    {
      ...RIEN,
      alertes: [
        {
          id: "a1",
          alert_type: "phMeterDrift",
          priority: "warning",
          message: "Dérive du pH-mètre.",
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
    },
    MAINTENANT,
  );
  assert.equal(points[0].titre, "phMeterDrift");
});

test("le retard annoncé est celui du lot LE PLUS ancien", () => {
  const points = pointsDAttention(
    {
      ...RIEN,
      finDeCycleDepassee: [
        { id: "1", batch_code: "A-RECENT", expected_end_at: "2026-09-05T12:00:00Z" },
        { id: "2", batch_code: "A-VIEUX", expected_end_at: "2026-08-27T12:00:00Z" },
      ],
    },
    MAINTENANT,
  );
  const point = points.find((p) => p.id === "fin-de-cycle-depassee");
  assert.ok(point);
  assert.ok(point.titre.includes("2 lots ont dépassé"));
  // Dix jours, et le code du plus ancien — pas celui du premier de la
  // liste, qui n'a aucune raison d'être trié.
  assert.ok(point.detail.includes("A-VIEUX"), point.detail);
  assert.ok(point.detail.includes("10 jour"), point.detail);
});

test("un seul lot, et les accords passent au singulier", () => {
  const points = pointsDAttention(
    {
      ...RIEN,
      finDeCycleDepassee: [
        { id: "1", batch_code: "A-001", expected_end_at: "2026-09-05T12:00:00Z" },
      ],
    },
    MAINTENANT,
  );
  assert.ok(points[0].titre.includes("1 lot a dépassé"), points[0].titre);
});

test("les lots jamais inspectés citent le seuil du téléphone, pas un autre", () => {
  const points = pointsDAttention(
    { ...RIEN, jamaisInspectes: [{ id: "1", batch_code: "A-001", started_at: "2026-08-01T00:00:00Z" }] },
    MAINTENANT,
  );
  const point = points.find((p) => p.id === "jamais-inspectes");
  assert.ok(point);
  // `BioLabAlertService.lateInspectionThresholdDays` vaut 14. Un autre
  // nombre ici, et le web et le téléphone signaleraient deux ensembles
  // de lots différents sous le même nom.
  assert.equal(SEUIL_INSPECTION_JOURS, 14);
  assert.ok(point.detail.includes("14 jours"), point.detail);
});

test("au-delà de quatre lots, la liste s'abrège au lieu de s'allonger", () => {
  const points = pointsDAttention(
    {
      ...RIEN,
      finDeCycleProche: Array.from({ length: 7 }, (_, i) => ({
        id: String(i),
        batch_code: `A-00${i}`,
        expected_end_at: "2026-09-08T00:00:00Z",
      })),
    },
    MAINTENANT,
  );
  const point = points.find((p) => p.id === "fin-de-cycle-proche");
  assert.ok(point);
  assert.ok(point.detail.includes("et 3 autres"), point.detail);
  assert.ok(!point.detail.includes("A-006"), point.detail);
});

test("chaque point d'attention porte un identifiant unique", () => {
  // Deux clés identiques, et React n'en rendrait qu'une : une alerte
  // disparaîtrait de l'écran sans erreur.
  const points = pointsDAttention(
    {
      finDeCycleDepassee: [{ id: "1", batch_code: "A", expected_end_at: "2026-09-01T00:00:00Z" }],
      finDeCycleProche: [{ id: "2", batch_code: "B", expected_end_at: "2026-09-08T00:00:00Z" }],
      contaminations: [{ id: "i1", date: "2026-09-05T00:00:00Z", lot: "C" }],
      jamaisInspectes: [{ id: "3", batch_code: "D", started_at: "2026-08-01T00:00:00Z" }],
      alertes: [
        { id: "a1", alert_type: "sensorOffline", priority: "warning", message: "m", created_at: "x" },
        { id: "a2", alert_type: "sensorOffline", priority: "warning", message: "m", created_at: "x" },
      ],
    },
    MAINTENANT,
  );
  const cles = points.map((p) => p.id);
  assert.equal(new Set(cles).size, cles.length);
  assert.equal(points.length, 6);
});

test("une contamination sur un lot devenu illisible ne casse pas la phrase", () => {
  // La RLS peut avoir écarté le lot alors que l'inspection reste
  // visible. Le point d'attention doit rester lisible sans son code.
  const points = pointsDAttention(
    { ...RIEN, contaminations: [{ id: "i1", date: "2026-09-05T00:00:00Z", lot: null }] },
    MAINTENANT,
  );
  assert.equal(points[0].ton, "critical");
  assert.ok(!points[0].detail.includes("null"));
});
