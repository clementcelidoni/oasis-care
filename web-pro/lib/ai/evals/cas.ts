import type { CasEval } from "./types.ts";

/**
 * §11V — LES SEPT CAS DE LA PAGE 24.
 *
 *     devis sous-tarifé · devis rentable · chantier non facturé ·
 *     planning inefficace · stock insuffisant · camion coûteux ·
 *     aucune donnée suffisante
 *
 * ══════════════════════════════════════════════════════════════════
 * LES FIXTURES SONT ARITHMÉTIQUEMENT JUSTES, ET CE N'EST PAS DU LUXE
 * ══════════════════════════════════════════════════════════════════
 *
 * Chaque jeu de données reprend la FORME EXACTE de la fonction SQL de
 * 0073 qui le produirait — mêmes clés, mêmes centimes entiers — et ses
 * chiffres se tiennent : la marge est bien le prix moins le coût, le
 * taux de marque est bien la marge rapportée au prix, le manque à
 * gagner est bien le prix multiplié par l'écart à la cible.
 *
 * Ce n'est pas de la coquetterie. En mode réel, ces fixtures sont ce
 * que le modèle lit ; une marge fausse de deux points lui apprendrait à
 * conclure de travers, et l'évaluation sanctionnerait le modèle pour
 * une erreur qu'on aurait écrite soi-même. En mode simulé, elles sont
 * ce que le rapport imprime : un chiffre qui ne se tient pas se
 * recopierait de rapport en rapport comme s'il était vrai.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS CAS SUR SEPT NE SE JOUENT PAS. C'EST LE RÉSULTAT, PAS UN TROU.
 * ══════════════════════════════════════════════════════════════════
 *
 * « Planning inefficace » et « camion coûteux » n'ont ni agent ni
 * fonction : `OUTILS_SPEC_SANS_SERVICE` (tools.ts) nomme déjà
 * `getPlanningSummary` et `getFleetCosts` comme absents du produit.
 * « Stock insuffisant » a bien ses deux outils — ils existent, ils sont
 * branchés sur des fonctions réelles — mais aucun agent construit ne
 * les porte : `AGENTS_PREMIERE_ITERATION` en compte quatre, et
 * `nursery` n'en fait pas partie.
 *
 * Les trois sont donc déclarés `absent` / `outils_seuls`, sans
 * scénario, avec la raison écrite. Le rapport les compte à part. Le
 * jour où la fonction manquante arrive, `evals.test.ts` — qui
 * relit les migrations — échoue et rappelle qu'un cas d'évaluation
 * attend d'être branché.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE SEPTIÈME CAS EST LE PLUS IMPORTANT, ET IL A DEUX VOLETS
 * ══════════════════════════════════════════════════════════════════
 *
 * « Aucune donnée suffisante » n'est pas une variante triste des six
 * autres : c'est le cas où un produit médiocre se trahit, parce que le
 * réflexe d'un modèle privé de données est de meubler. Deux formes,
 * radicalement différentes, et les deux sont jouées :
 *
 *   • LA SOURCE NE RÉPOND PAS. Le contexte est vide. Le système doit le
 *     dire SANS APPELER PERSONNE : ne pas répondre coûte zéro, et le
 *     prouver demande de compter les appels au fournisseur.
 *
 *   • LA DONNÉE EST LÀ MAIS NE SUFFIT PAS. Deux chantiers comparables
 *     au lieu des cinq exigés. La fonction rend `insufficientData` ; le
 *     modèle doit reprendre ce verdict — et surtout NE PAS CHIFFRER.
 *     Le scénario script un modèle qui annonce « données insuffisantes »
 *     ET un montant, ce qu'un vrai modèle fait régulièrement : le
 *     contrôle vérifie que le montant a été RETIRÉ et la confiance
 *     conservée (`normaliserRecommandation`). C'est la seule façon de
 *     prouver que la barrière fonctionne plutôt que d'espérer qu'elle
 *     ne servira pas.
 */

// ==================================================================
// LES JEUX DE DONNÉES
// ==================================================================

const DEVIS_SOUS_TARIFE = Object.freeze({
  agent: "quote_pricing",
  devisId: "11111111-1111-4111-8111-111111111111",
  devis: {
    numero: "DEV-2026-0184",
    titre: "Aménagement complet — Villa Les Oliviers",
    statut: "sent",
    emisLe: "2026-08-24",
    valableJusquAu: "2026-09-23",
  },
  // 38 500,00 € proposés, 36 883,00 € de coût saisi : 1 617,00 € de
  // marge, soit 4,20 % de taux de marque contre 25 % visés.
  prixProposeHtCents: 3_850_000,
  coutEstimeCents: 3_688_300,
  margeCents: 161_700,
  tauxMarquePct: 4.2,
  margeCiblePct: 25,
  ecartALaCiblePoints: -20.8,
  // 3 850 000 × 20,8 / 100 = 800 800. Le chiffre que le modèle doit
  // RECOPIER, jamais recalculer (p. 11-12).
  manqueAGagnerCents: 800_800,
  lignes: { total: 14, sansCoutSaisi: 0, coutPartiel: false },
  verdictMarge: "insuffisant",
  verdictComparables: "dansLaFourchette",
  verdict: "insuffisant",
  confiance: "high",
  comparables: {
    nombreComparables: 7,
    seuilComparables: 5,
    confiance: "low",
    motifInsuffisance: null,
    fourchette: {
      minHtCents: 3_610_000,
      q1HtCents: 3_940_000,
      medianeHtCents: 4_230_000,
      q3HtCents: 4_580_000,
      maxHtCents: 4_910_000,
      tauxMarqueReelMedianPct: 26.8,
      comparablesAvecCoutsReels: 6,
    },
  },
  deplacement: {
    effectifPrevu: null,
    nombreDeTrajets: null,
    note: "Effectif et nombre de trajets ne sont pas modélisés : ils doivent être fournis par l'appelant, pas déduits ici.",
  },
  explication: {
    donneesObservees: { lignesDuDevis: 14, lignesSansCoutSaisi: 0, chantiersComparables: 7 },
    comparaison: "Prix comparé à la fourchette de 7 chantiers internes de périmètre équivalent.",
    conclusion: "Ce prix ne couvre pas l'objectif de marge de l'entreprise.",
    confiance: "high",
  },
  actionsDisponibles: ["adjustQuotePricing"],
});

const DEVIS_RENTABLE = Object.freeze({
  agent: "quote_pricing",
  devisId: "22222222-2222-4222-8222-222222222222",
  devis: {
    numero: "DEV-2026-0191",
    titre: "Création de terrasse et plantations — Résidence Bellevue",
    statut: "sent",
    emisLe: "2026-08-28",
    valableJusquAu: "2026-09-27",
  },
  // 42 000,00 € proposés, 28 392,00 € de coût : 13 608,00 € de marge,
  // soit 32,40 % contre 25 % visés. Rien à redresser.
  prixProposeHtCents: 4_200_000,
  coutEstimeCents: 2_839_200,
  margeCents: 1_360_800,
  tauxMarquePct: 32.4,
  margeCiblePct: 25,
  ecartALaCiblePoints: 7.4,
  manqueAGagnerCents: null,
  lignes: { total: 11, sansCoutSaisi: 0, coutPartiel: false },
  verdictMarge: "conforme",
  verdictComparables: "dansLaFourchette",
  verdict: "correct",
  confiance: "high",
  comparables: {
    nombreComparables: 9,
    seuilComparables: 5,
    confiance: "medium",
    motifInsuffisance: null,
    fourchette: {
      minHtCents: 3_820_000,
      q1HtCents: 4_050_000,
      medianeHtCents: 4_310_000,
      q3HtCents: 4_640_000,
      maxHtCents: 5_120_000,
      tauxMarqueReelMedianPct: 29.1,
      comparablesAvecCoutsReels: 8,
    },
  },
  deplacement: {
    effectifPrevu: null,
    nombreDeTrajets: null,
    note: "Effectif et nombre de trajets ne sont pas modélisés : ils doivent être fournis par l'appelant, pas déduits ici.",
  },
  explication: {
    donneesObservees: { lignesDuDevis: 11, lignesSansCoutSaisi: 0, chantiersComparables: 9 },
    comparaison: "Prix comparé à la fourchette de 9 chantiers internes de périmètre équivalent.",
    conclusion: "Ce prix couvre l'objectif de marge et reste cohérent avec les chantiers comparables.",
    confiance: "high",
  },
  actionsDisponibles: [],
});

/**
 * Deux comparables au lieu des cinq exigés.
 *
 * `coutEstimeCents` est `null` — aucune ligne ne porte de coût saisi —
 * ce qui est le piège documenté de 0073 : sans cette règle, un devis
 * non chiffré se présenterait comme une marge de 100 %.
 */
const DEVIS_SANS_ASSEZ_DE_DONNEES = Object.freeze({
  agent: "quote_pricing",
  devisId: "33333333-3333-4333-8333-333333333333",
  devis: {
    numero: "DEV-2026-0203",
    titre: "Reprise de talus — chemin des Aubépines",
    statut: "draft",
    emisLe: null,
    valableJusquAu: null,
  },
  prixProposeHtCents: 1_240_000,
  coutEstimeCents: null,
  margeCents: null,
  tauxMarquePct: null,
  margeCiblePct: 25,
  ecartALaCiblePoints: null,
  manqueAGagnerCents: null,
  lignes: { total: 6, sansCoutSaisi: 6, coutPartiel: false },
  verdictMarge: "insufficientData",
  verdictComparables: "insufficientData",
  verdict: "insufficientData",
  confiance: "insufficient_data",
  comparables: {
    nombreComparables: 2,
    seuilComparables: 5,
    confiance: "insufficient_data",
    motifInsuffisance: "tropPeuDeComparables",
    explicationInsuffisance:
      "Moins de 5 chantiers comparables terminés : une fourchette calculée sur si peu de points en aurait l'apparence sans en avoir la valeur.",
    fourchette: null,
  },
  deplacement: {
    effectifPrevu: null,
    nombreDeTrajets: null,
    note: "Effectif et nombre de trajets ne sont pas modélisés : ils doivent être fournis par l'appelant, pas déduits ici.",
  },
  explication: {
    donneesObservees: { lignesDuDevis: 6, lignesSansCoutSaisi: 6, chantiersComparables: 2 },
    comparaison: "Aucune comparaison de marché : moins de 5 chantiers comparables terminés.",
    conclusion: "Données insuffisantes pour se prononcer sur ce prix.",
    confiance: "insufficient_data",
  },
  actionsDisponibles: [],
});

/**
 * Dix dossiers prêts, 38 450,00 € HT — l'exemple de la page 27-29.
 *
 * DEUX D'ENTRE EUX N'ONT AUCUN MONTANT CONNU, et le total ne les
 * couvre donc pas. C'est le détail qui fait de ce cas une vraie
 * évaluation : un agent qui annonce « 10 dossiers, 38 450 € » sans
 * mentionner les deux non chiffrés dit une phrase fausse avec des
 * chiffres justes.
 */
const CHANTIERS_A_FACTURER = Object.freeze({
  agent: "billing",
  resume: {
    prets: 10,
    montantPretHtCents: 3_845_000,
    pretsSansMontant: 2,
    aVerifier: 3,
    montantAVerifierHtCents: 1_190_000,
    aVerifierSansMontant: 0,
  },
  confiance: "high",
  dossiers: [
    {
      projetId: "aaaaaaa1-0000-4000-8000-000000000001",
      nom: "Entretien annuel — Copropriété Le Clos",
      statut: "pret",
      montantHtCents: 742_000,
      termineLe: "2026-08-12",
    },
    {
      projetId: "aaaaaaa1-0000-4000-8000-000000000002",
      nom: "Plantation haie — Mairie de Vallauris",
      statut: "pret",
      montantHtCents: 1_318_000,
      termineLe: "2026-08-19",
    },
    {
      projetId: "aaaaaaa1-0000-4000-8000-000000000003",
      nom: "Reprise d'arrosage — Villa Mimosa",
      statut: "pret",
      montantHtCents: null,
      termineLe: "2026-08-21",
    },
  ],
  facturesEnRetard: { resume: { nombre: 4, resteDuTtcCents: 1_782_000 } },
  droitsManquants: [],
});

/**
 * LE PORTEFEUILLE DE DEVIS, tel qu'`ai_get_daily_priorities` (0058,
 * 0066) le rend.
 *
 * C'est la source SANS CIBLE de l'agent « Devis et prix ». Elle existe
 * dans son plan parce que, sans elle, l'agent ne pouvait pas répondre
 * dès qu'aucun devis n'était désigné — le cas de chaque brief de
 * Direction. Les scénarios la fournissent donc comme la production la
 * fournirait.
 */
const PORTEFEUILLE_DEVIS = Object.freeze({
  devisARelancer: [
    {
      devisId: "cccccccc-0000-4000-8000-000000000001",
      reference: "DEV-2026-0171",
      client: "Copropriété Les Cyprès",
      montantHtCents: 862_000,
      envoyeLe: "2026-08-04",
    },
  ],
  devisQuiExpirent: [
    {
      devisId: "cccccccc-0000-4000-8000-000000000002",
      reference: "DEV-2026-0179",
      client: "Mairie de Vallauris",
      montantHtCents: 1_204_000,
      expireLe: "2026-09-10",
    },
  ],
});

// ==================================================================
// LES SEPT CAS
// ==================================================================

export const CAS_EVAL: readonly CasEval[] = Object.freeze([
  // ----------------------------------------------------------------
  // 1. DEVIS SOUS-TARIFÉ
  // ----------------------------------------------------------------
  {
    id: "devis-sous-tarife",
    titre: "Devis sous-tarifé",
    couverture: "couvert",
    sansModele: [
      "l'agent « Devis et prix » part sur le niveau le plus capable, parce que sa configuration le veut (p. 5)",
      "il ne se voit offrir aucun outil de facturation ni de direction",
      "le manque à gagner sorti par la fonction SQL traverse la chaîne sans être recalculé",
      "aucune donnée métier n'est écrite",
      "l'appel est inscrit au grand livre, jetons compris",
    ],
    avecUnVraiModele: [
      "que le modèle conclue réellement au sous-tarif plutôt que de commenter le devis",
      "qu'il n'invente ni distance ni temps de déplacement, absents du produit",
      "qu'il ne refasse pas l'arithmétique de la marge pour la « vérifier »",
    ],
    scenarios: [
      {
        id: "devis-sous-tarife/analyse",
        intitule: "38 500 € proposés, 4,2 % de marque contre 25 % visés",
        agent: "quotePricing",
        question: "Ce devis est-il bien tarifé ?",
        cible: { quoteId: DEVIS_SOUS_TARIFE.devisId },
        criticite: "critique",
        donnees: {
          ai_get_daily_priorities: PORTEFEUILLE_DEVIS,
          ai_quote_price_analysis: DEVIS_SOUS_TARIFE,
          ai_quote_comparables: DEVIS_SOUS_TARIFE.comparables,
        },
        script: [
          { type: "outil", nom: "getQuote", arguments: { p_quote_id: DEVIS_SOUS_TARIFE.devisId } },
          {
            type: "final",
            sortie: {
              resume:
                "Le prix proposé ne couvre pas l'objectif de marge : 4,20 % de taux de marque contre 25 % visés.",
              confidence: "high",
              ambigu: false,
              recommandations: [
                {
                  title: "Revoir le prix du devis DEV-2026-0184 avant envoi",
                  summary:
                    "Le taux de marque ressort à 4,20 % pour une cible de 25 %. Le devis reste dans la fourchette des sept chantiers comparables, mais la fourchette ne dit rien de la rentabilité.",
                  priority: 92,
                  category: "urgent",
                  confidence: "high",
                  estimatedImpact: "8 008,00 € de marge manquante par rapport à la cible",
                  estimatedImpactCents: 800_800,
                  reasons: [
                    "Taux de marque 4,20 % contre une cible d'entreprise de 25 %",
                    "Écart à la cible de 20,8 points",
                    "Les quatorze lignes portent toutes un coût saisi : la marge décrit le devis entier",
                  ],
                  suggestedActionType: null,
                  suggestedActionLabel: null,
                },
              ],
              donneesManquantes: [
                "Le déplacement n'est chiffré par aucun service : le coût réel est au moins celui-ci.",
              ],
            },
          },
        ],
        attentes: {
          niveau: "advanced",
          aboutit: true,
          confiance: "high",
          outilsOfferts: ["getQuote", "getHistoricalProjectComparisons", "searchEntities"],
          outilsInterdits: ["getUnbilledProjects", "createInvoiceDraft", "getExecutiveBrief"],
          recommandationsMin: 1,
          impactPrincipalCents: { cents: 800_800 },
          donneesManquantes: "nonVide",
        },
      },
    ],
  },

  // ----------------------------------------------------------------
  // 2. DEVIS RENTABLE
  // ----------------------------------------------------------------
  {
    id: "devis-rentable",
    titre: "Devis rentable",
    couverture: "couvert",
    sansModele: [
      "un devis sain ne produit AUCUNE recommandation urgente",
      "aucune action n'est enregistrée : il n'y a rien à corriger",
      "la sortie reste structurée et la confiance élevée",
    ],
    avecUnVraiModele: [
      "que le modèle s'abstienne de trouver quelque chose à dire — le défaut qu'aucun cas alarmant ne révèle",
      "qu'il ne présente pas la marge au-dessus de la cible comme une opportunité de baisser le prix",
    ],
    scenarios: [
      {
        id: "devis-rentable/analyse",
        intitule: "42 000 € proposés, 32,4 % de marque contre 25 % visés",
        agent: "quotePricing",
        question: "Ce devis est-il bien tarifé ?",
        cible: { quoteId: DEVIS_RENTABLE.devisId },
        criticite: "ordinaire",
        donnees: {
          ai_get_daily_priorities: PORTEFEUILLE_DEVIS,
          ai_quote_price_analysis: DEVIS_RENTABLE,
          ai_quote_comparables: DEVIS_RENTABLE.comparables,
        },
        script: [
          { type: "outil", nom: "getQuote", arguments: { p_quote_id: DEVIS_RENTABLE.devisId } },
          {
            type: "final",
            sortie: {
              resume:
                "Le prix couvre l'objectif de marge : 32,40 % de taux de marque pour une cible de 25 %. Rien à redresser.",
              confidence: "high",
              ambigu: false,
              recommandations: [],
              donneesManquantes: [],
            },
          },
        ],
        attentes: {
          niveau: "advanced",
          aboutit: true,
          confiance: "high",
          recommandationsMax: 0,
          categoriesInterdites: ["urgent"],
          donneesManquantes: "vide",
        },
      },
    ],
  },

  // ----------------------------------------------------------------
  // 3. CHANTIER NON FACTURÉ
  // ----------------------------------------------------------------
  {
    id: "chantier-non-facture",
    titre: "Chantier non facturé",
    couverture: "couvert",
    sansModele: [
      "la Facturation part sur le niveau intermédiaire, le moteur des agents métier (p. 2)",
      "la demande d'écriture est INTERROMPUE, tranchée par le serveur, et enregistrée en attente",
      "le service métier n'est jamais appelé : aucune facture n'existe à la fin du scénario",
      "les deux dossiers sans montant connu se retrouvent dans « données manquantes »",
    ],
    avecUnVraiModele: [
      "que le modèle demande réellement l'outil d'écriture plutôt que de décrire ce qu'il ferait",
      "qu'il mentionne les deux dossiers non chiffrés au lieu d'annoncer « 10 dossiers, 38 450 € »",
    ],
    scenarios: [
      {
        id: "chantier-non-facture/preparation",
        intitule: "Dix dossiers prêts, 38 450 € HT, deux sans montant connu",
        agent: "billing",
        question: "Qu'est-ce que je dois facturer ?",
        criticite: "ordinaire",
        donnees: { ai_billing_candidates: CHANTIERS_A_FACTURER },
        script: [
          { type: "outil", nom: "getUnbilledProjects" },
          { type: "outil", nom: "createInvoiceDraft" },
          {
            type: "final",
            sortie: {
              resume:
                "Dix dossiers terminés attendent leur facture, pour 38 450,00 € HT connus. Deux d'entre eux n'ont aucun montant : le total ne les couvre pas.",
              confidence: "high",
              ambigu: false,
              recommandations: [
                {
                  title: "Préparer les brouillons de facture des dix dossiers prêts",
                  summary:
                    "Dix chantiers sont terminés, sans facture et sans réserve détectée. Deux n'ont aucun montant connu et devront être chiffrés à la main.",
                  priority: 90,
                  category: "urgent",
                  confidence: "high",
                  estimatedImpact: "10 dossiers, 38 450,00 € HT connus sur huit d'entre eux",
                  estimatedImpactCents: 3_845_000,
                  reasons: [
                    "Dix dossiers terminés sans facture rattachée",
                    "Aucune réserve détectée sur ces dix dossiers",
                    "Deux dossiers sans montant connu : le total ne les couvre pas",
                  ],
                  suggestedActionType: "createInvoiceDraft",
                  suggestedActionLabel: "Préparer les brouillons",
                },
              ],
              donneesManquantes: [
                "Deux dossiers prêts n'ont aucun montant connu : leur facture devra être chiffrée à la main.",
              ],
            },
          },
        ],
        attentes: {
          niveau: "standard",
          aboutit: true,
          confiance: "high",
          outilsOfferts: ["getUnbilledProjects", "createInvoiceDraft"],
          outilsInterdits: ["getQuote", "getExecutiveBrief", "getNurseryStock"],
          recommandationsMin: 1,
          impactPrincipalCents: { cents: 3_845_000 },
          donneesManquantes: "nonVide",
          actionAttendue: { actionType: "createInvoiceDraft" },
        },
      },
    ],
  },

  // ----------------------------------------------------------------
  // 4. PLANNING INEFFICACE — non exécutable
  // ----------------------------------------------------------------
  {
    id: "planning-inefficace",
    titre: "Planning inefficace",
    couverture: "absent",
    raison:
      "Aucun agent « planning » n'est construit (AGENTS_PREMIERE_ITERATION en compte quatre) et " +
      "aucune fonction de synthèse de planning n'existe : `getPlanningSummary` figure dans " +
      "OUTILS_SPEC_SANS_SERVICE avec l'état « absent ». Juger l'efficacité d'un planning " +
      "supposerait d'agréger des interventions une à une côté modèle, c'est-à-dire de lui faire " +
      "compter des heures — exactement ce que la frontière déterministe interdit (p. 11-12).",
    sansModele: [
      "que les deux outils nommés par la spec restent déclarés comme absents, et que personne ne les ait branchés en douce",
    ],
    avecUnVraiModele: [],
    scenarios: [],
  },

  // ----------------------------------------------------------------
  // 5. STOCK INSUFFISANT — outils seuls
  // ----------------------------------------------------------------
  {
    id: "stock-insuffisant",
    titre: "Stock insuffisant",
    couverture: "outils_seuls",
    raison:
      "Les deux outils existent et pointent sur des fonctions réelles (`getNurseryStock` → " +
      "ai_find_stock, `getProjectedNurseryNeeds` → ai_forecast_availability), mais aucun agent " +
      "« nursery » n'est construit : ils n'appartiennent à aucun des quatre agents de cette " +
      "itération, aucun plan de contexte ne les lit, et aucune instruction ne les gouverne. " +
      "Le cas se rejouera tel quel le jour où l'agent Pépinière existera.",
    sansModele: [
      "que les deux outils de pépinière soient bien déclarés et branchés sur une fonction existante",
      "qu'AUCUN des quatre agents construits ne se les voie offrir par erreur",
    ],
    avecUnVraiModele: [],
    scenarios: [],
  },

  // ----------------------------------------------------------------
  // 6. CAMION COÛTEUX — non exécutable
  // ----------------------------------------------------------------
  {
    id: "camion-couteux",
    titre: "Camion coûteux",
    couverture: "absent",
    raison:
      "Aucun agent « fleet », et aucune donnée : `getFleetCosts` figure dans " +
      "OUTILS_SPEC_SANS_SERVICE avec l'état « absent » — le matériel est suivi, son coût d'usage " +
      "ne l'est pas. Sans coût d'usage, un modèle interrogé sur un camion coûteux répondrait à " +
      "partir de généralités du métier, ce qui serait une invention chiffrée présentée comme " +
      "une analyse de l'entreprise.",
    sansModele: [
      "que l'absence soit toujours vraie côté base : aucune fonction de coût de flotte n'est apparue",
    ],
    avecUnVraiModele: [],
    scenarios: [],
  },

  // ----------------------------------------------------------------
  // 7. AUCUNE DONNÉE SUFFISANTE — le cas qui compte
  // ----------------------------------------------------------------
  {
    id: "aucune-donnee-suffisante",
    titre: "Aucune donnée suffisante",
    couverture: "couvert",
    sansModele: [
      "une source requise muette n'appelle AUCUN modèle : le refus est gratuit et il est dit",
      "le message nomme ce qui manque, et ne ressemble en rien à « rien à signaler »",
      "un modèle qui annonce des données insuffisantes ET un montant se voit retirer le montant, pas la confiance",
      "le refus gratuit n'écrit aucune ligne au grand livre, parce qu'aucun jeton n'a été payé",
    ],
    avecUnVraiModele: [
      "que le modèle reprenne réellement le verdict « données insuffisantes » de la fonction plutôt que de conclure quand même",
      "qu'il n'aille pas chercher une fourchette dans ses connaissances générales du marché",
      "qu'il nomme ce qui manque — les coûts non saisis, les comparables trop peu nombreux",
    ],
    scenarios: [
      {
        id: "aucune-donnee-suffisante/source-muette",
        intitule: "La source requise ne répond pas : personne n'est appelé, et c'est dit",
        agent: "quotePricing",
        question: "Ce devis est-il bien tarifé ?",
        cible: { quoteId: "44444444-4444-4444-8444-444444444444" },
        criticite: "ordinaire",
        donnees: {},
        lecturesEnEchec: [
          "ai_get_daily_priorities",
          "ai_quote_price_analysis",
          "ai_quote_comparables",
        ],
        // Aucun tour : le modèle ne doit pas être appelé du tout. Si le
        // runtime l'appelait quand même, `ModeleSimule` lèverait — ce
        // qui est la bonne façon d'échouer.
        script: [],
        attentes: {
          niveau: "advanced",
          aboutit: false,
          sansAppelDeModele: true,
          messageContient: ["données", "Oasis"],
        },
      },
      {
        id: "aucune-donnee-suffisante/comparables-trop-peu",
        intitule: "Deux comparables au lieu de cinq : le montant est retiré, la confiance reste",
        agent: "quotePricing",
        question: "Mon prix est-il dans le marché ?",
        cible: { quoteId: DEVIS_SANS_ASSEZ_DE_DONNEES.devisId },
        criticite: "ordinaire",
        donnees: {
          ai_get_daily_priorities: PORTEFEUILLE_DEVIS,
          ai_quote_price_analysis: DEVIS_SANS_ASSEZ_DE_DONNEES,
          ai_quote_comparables: DEVIS_SANS_ASSEZ_DE_DONNEES.comparables,
        },
        script: [
          {
            type: "outil",
            nom: "getQuote",
            arguments: { p_quote_id: DEVIS_SANS_ASSEZ_DE_DONNEES.devisId },
          },
          {
            type: "final",
            sortie: {
              resume:
                "Impossible de se prononcer : aucun coût n'est saisi sur les six lignes, et deux chantiers comparables ne font pas une fourchette.",
              confidence: "insufficient_data",
              ambigu: false,
              recommandations: [
                {
                  title: "Saisir les coûts des six lignes avant de juger ce prix",
                  summary:
                    "Aucune ligne ne porte de coût : la marge est inconnue, pas nulle. Deux chantiers comparables seulement, pour un seuil de cinq.",
                  priority: 70,
                  category: "important",
                  confidence: "insufficient_data",
                  estimatedImpact: "Non chiffrable en l'état",
                  // LE PIÈGE, DÉLIBÉRÉMENT TENDU : un montant annoncé
                  // avec « insufficient_data ». Un vrai modèle le fait
                  // régulièrement. Le contrôle vérifie qu'il a été
                  // retiré et que la confiance, elle, a survécu.
                  estimatedImpactCents: 310_000,
                  reasons: [
                    "Les six lignes du devis n'ont aucun coût unitaire saisi",
                    "Deux chantiers comparables pour un seuil de cinq",
                  ],
                  suggestedActionType: null,
                  suggestedActionLabel: null,
                },
              ],
              donneesManquantes: [
                "Coût unitaire absent sur les six lignes du devis.",
                "Deux chantiers comparables seulement : le seuil est de cinq.",
              ],
            },
          },
        ],
        attentes: {
          niveau: "advanced",
          aboutit: true,
          confiance: "insufficient_data",
          recommandationsMin: 1,
          // Le montant a été retiré : c'est l'attente centrale du cas.
          impactPrincipalCents: { cents: null },
          donneesManquantes: "nonVide",
        },
      },
    ],
  },
]);

/** Les cas réellement jouables, dans l'ordre de la page 24. */
export const CAS_EXECUTABLES: readonly CasEval[] = Object.freeze(
  CAS_EVAL.filter((cas) => cas.scenarios.length > 0),
);
