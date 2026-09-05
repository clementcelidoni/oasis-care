import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composerSouscription,
  jourDeReference,
  phrasePourMotif,
  versResumePublic,
  type CycleFacturation,
  type DemandeTermes,
  type OffreLue,
  type RemiseLue,
  type SourceFacturation,
  type TermesTarif,
  type TermesTaxe,
} from "./composition.ts";

/**
 * §STRIPE — CE QUI EST DÛ, ÉPROUVÉ SANS RÉSEAU ET SANS BASE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE SOURCE SIMULÉE, ET POURQUOI ELLE COPIE LE SQL
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucun test de ce dépôt ne doit exiger le réseau ni une base : un test
 * qui les exige ne tourne jamais en intégration, et on s'en aperçoit le
 * jour où il aurait eu quelque chose à dire.
 *
 * La source simulée ci-dessous ne se contente donc pas de rendre des
 * réponses commodes : elle REPRODUIT L'ARBITRAGE de
 * `billing_provider_price_terms()` (migration 0083) — l'ordre exact de
 * ses refus compris. C'est ce qui rend ces tests utiles : ils prouvent
 * que `composerSouscription` réagit bien à ce que la base rendra
 * réellement, et pas à ce qu'il serait pratique qu'elle rende.
 *
 * L'ORDRE DES MOTIFS N'EST PAS DÉCORATIF (0083, §6) : un prix que NOUS
 * ne savons pas dire rend la correspondance sans objet. Annoncer
 * « correspondance manquante » à quelqu'un dont l'offre n'a pas de prix
 * annuel l'enverrait créer chez le prestataire un tarif pour un montant
 * qui n'existe pas.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES MONTANTS SONT DES CENTIMES ENTIERS, ET HORS TAXES
 * ══════════════════════════════════════════════════════════════════
 *
 * 7990 se lit « 79,90 € HT ». Les LIGNES sont hors taxes ; le MONTANT
 * PRÉLEVÉ, lui, dépend du régime — et il est désormais calculé, parce
 * que le prestataire doit l'encaisser. Le régime vient de
 * `saas_vat_regime_compute()`, pas d'ici : la source simulée le rend
 * comme la base le rendrait. Une entreprise française paiera 95,88 €,
 * une néerlandaise avec numéro validé 79,90 € — le PRIX est le même, le
 * MONTANT PRÉLEVÉ non.
 */

// ══════════════════════════════════════════════════════════════════
// LA GRILLE DE TEST
// ══════════════════════════════════════════════════════════════════
//
// CE N'EST PAS LA GRILLE DE PRODUCTION, et il ne faut pas la lire comme
// telle. 0081 laisse `included_seats` NON DÉCIDÉ sur `team` et
// `business` ; ici on lui donne une valeur, sans quoi la moitié des cas
// de sièges ne serait pas atteignable. Le cas « non décidé » a son
// propre test, plus bas, et c'est lui qui décrit la production
// d'aujourd'hui.

type CaseModule = {
  availability: "included" | "optional" | "unavailable" | "undecided";
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
  isDelivered: boolean;
};

type Correspondance = { priceId: string; montantCents: number; devise: string };

const OFFRES: Record<string, OffreLue> = {
  solo: {
    key: "solo",
    name: "Oasis Care Solo",
    isActive: true,
    isQuoteOnly: false,
    monthlyPriceCents: 3990,
    yearlyPriceCents: 39900,
    includedSeats: 1,
    // Un plafond est un PLAFOND, pas un compteur : au-delà, on ne
    // facture pas, on refuse l'ajout d'utilisateur ailleurs.
    seatPolicy: "hardCap",
    extraSeatMonthlyPriceCents: null,
    priceFloorCents: null,
    currency: "EUR",
  },
  team: {
    key: "team",
    name: "Oasis Care Pro",
    isActive: true,
    isQuoteOnly: false,
    monthlyPriceCents: 7990,
    yearlyPriceCents: 79900,
    includedSeats: 3,
    seatPolicy: "billedBeyondIncluded",
    extraSeatMonthlyPriceCents: 990,
    priceFloorCents: null,
    currency: "EUR",
  },
  business: {
    key: "business",
    name: "Oasis Care Pro Business",
    isActive: true,
    isQuoteOnly: false,
    monthlyPriceCents: 13990,
    yearlyPriceCents: 139900,
    includedSeats: 10,
    seatPolicy: "billedBeyondIncluded",
    extraSeatMonthlyPriceCents: 990,
    priceFloorCents: null,
    currency: "EUR",
  },
  enterprise: {
    key: "enterprise",
    name: "Oasis Care Enterprise",
    isActive: true,
    // « Sur devis » : aucun prix public, un plancher affiché.
    isQuoteOnly: true,
    monthlyPriceCents: null,
    yearlyPriceCents: null,
    includedSeats: null,
    seatPolicy: "billedBeyondIncluded",
    extraSeatMonthlyPriceCents: null,
    priceFloorCents: 24900,
    currency: "EUR",
  },
  retire: {
    key: "retire",
    name: "Ancienne offre",
    isActive: false,
    isQuoteOnly: false,
    monthlyPriceCents: 4990,
    yearlyPriceCents: 49900,
    includedSeats: 2,
    seatPolicy: "billedBeyondIncluded",
    extraSeatMonthlyPriceCents: 990,
    priceFloorCents: null,
    currency: "EUR",
  },
};

/** La MATRICE offre × module — exactement ce que 0081 a semé. */
const MATRICE: Record<string, CaseModule> = {
  // BioLab et Pépinière sont INCLUS dans Business…
  "business:biolab": {
    availability: "included",
    monthlyPriceCents: null,
    yearlyPriceCents: null,
    isDelivered: true,
  },
  "business:nursery": {
    availability: "included",
    monthlyPriceCents: null,
    yearlyPriceCents: null,
    isDelivered: true,
  },
  // …et en OPTION à 20 € HT par mois sur Pro.
  "team:biolab": {
    availability: "optional",
    monthlyPriceCents: 2000,
    yearlyPriceCents: 20000,
    isDelivered: true,
  },
  "team:nursery": {
    availability: "optional",
    monthlyPriceCents: 2000,
    yearlyPriceCents: 20000,
    isDelivered: true,
  },
  // Indisponible sur Solo : ce n'est pas un prix manquant, c'est un non.
  "solo:biolab": {
    availability: "unavailable",
    monthlyPriceCents: null,
    yearlyPriceCents: null,
    isDelivered: true,
  },
  // Annoncé, pas livré : il ne se souscrit pas, même affiché.
  "team:chantiers3d": {
    availability: "optional",
    monthlyPriceCents: 1500,
    yearlyPriceCents: 15000,
    isDelivered: false,
  },
};

const FONDATEUR: RemiseLue = {
  code: "FONDATEUR",
  label: "Tarif Fondateur",
  kind: "fixedMonthlyPrice",
  // 49,90 € — la valeur que 0081 sème réellement, et que le dirigeant a
  // confirmée. Le fixture disait 29,90 : il datait d'avant
  // l'enrichissement de la migration.
  valueCents: 4990,
  percent: null,
  startsOn: "2026-01-01",
  // NOT NULL en base : il n'existe littéralement aucune remise sans fin.
  // Le treizième mois repart au tarif public.
  endsOn: "2027-01-01",
  // RÉSERVÉ À L'OFFRE PRO. Sans cette restriction, le prix imposé se
  // substituait à celui de n'importe quelle offre.
  appliesToPlan: "team",
  // ET IL ENGAGE DOUZE MOIS. C'est la seule marque d'engagement que le
  // client puisse lire : le catalogue, lui, lui est fermé.
  commitmentEndsOn: "2027-01-01",
};

/**
 * Les correspondances chez le prestataire. Elles sont VOLONTAIREMENT
 * incomplètes : « annuel de l'offre `business` » n'y figure pas, pour
 * que le refus « correspondance manquante » soit atteignable.
 */
function correspondancesParDefaut(): Map<string, Correspondance> {
  const m = new Map<string, Correspondance>();
  const pose = (clef: string, priceId: string, montantCents: number) =>
    m.set(clef, { priceId, montantCents, devise: "EUR" });

  pose("plan|solo|monthly||", "price_solo_m", 3990);
  pose("plan|solo|yearly||", "price_solo_y", 39900);
  pose("plan|team|monthly||", "price_team_m", 7990);
  pose("plan|team|yearly||", "price_team_y", 79900);
  pose("plan|business|monthly||", "price_business_m", 13990);
  // « plan|business|yearly » ABSENT — c'est le trou que l'on éprouve.
  pose("seat|team|monthly||", "price_seat_m", 990);
  pose("seat|business|monthly||", "price_seat_m_business", 990);
  pose("module|team|monthly|biolab|", "price_biolab_m", 2000);
  pose("module|team|yearly|biolab|", "price_biolab_y", 20000);
  pose("module|team|monthly|nursery|", "price_nursery_m", 2000);
  // La correspondance d'une remise se range sous l'OFFRE QU'ELLE VISE
  // — comme en base, où la recherche emploie `applies_to_plan` et non
  // l'offre présentée. Une remise universelle, elle, se rangerait sous
  // une offre nulle et servirait partout.
  pose("discount|team|monthly||FONDATEUR", "price_fondateur_m", 4990);
  return m;
}

type EtatSource = {
  sieges: number;
  modulesSouscrits: string[];
  remise: RemiseLue | null;
  correspondances: Map<string, Correspondance>;
  offres: Record<string, OffreLue>;
  taxe: TermesTaxe;
};

/**
 * LE CAS NOMINAL : entreprise francaise, 20 %, objet de taxe relie chez
 * le prestataire. Cest ce que voit limmense majorite des clients, et
 * cest donc ce que les tests doivent voir par defaut.
 */
const TAXE_FRANCE: TermesTaxe = {
  regime: "france",
  tauxBps: 2000,
  providerTaxRateId: "txr_fr_20",
  blockingReason: null,
  reason: null,
};

function clefCorrespondance(d: DemandeTermes): string {
  return [
    d.kind,
    d.planKey ?? "",
    d.billingCycle,
    d.moduleKey ?? "",
    d.discountCode ?? "",
  ].join("|");
}

function vide(blocage: string | null): TermesTarif {
  return {
    providerPriceId: null,
    providerProductId: null,
    ourAmountCents: null,
    mappedAmountCents: null,
    currency: null,
    blockingReason: blocage,
  };
}

/**
 * La source simulée. Elle copie `billing_provider_price_terms()` :
 * mêmes motifs, même ORDRE de refus.
 */
class SourceSimulee implements SourceFacturation {
  readonly etat: EtatSource;

  constructor(surcharge: Partial<EtatSource> = {}) {
    this.etat = {
      sieges: 1,
      modulesSouscrits: [],
      remise: null,
      correspondances: correspondancesParDefaut(),
      offres: OFFRES,
      taxe: TAXE_FRANCE,
      ...surcharge,
    };
  }

  async lireOffre(planKey: string): Promise<OffreLue | null> {
    return this.etat.offres[planKey] ?? null;
  }

  async compterSieges(): Promise<number> {
    return this.etat.sieges;
  }

  async lireModulesSouscrits(): Promise<string[]> {
    return this.etat.modulesSouscrits;
  }

  /**
   * LE RÉGIME DE TVA. Par défaut : France, 20 %, objet de taxe relié —
   * c'est-à-dire le cas nominal, celui de l'immense majorité des
   * clients. Les tests qui éprouvent l'autoliquidation ou le refus le
   * surchargent explicitement.
   */
  async lireTermesTaxe(): Promise<TermesTaxe> {
    return this.etat.taxe;
  }

  async lireRemiseActive(_organizationId: string, leJour: string): Promise<RemiseLue | null> {
    const remise = this.etat.remise;
    if (remise === null) return null;
    // `[starts_on, ends_on)` — intervalle semi-ouvert, comme la base.
    // Le jour de fin N'EST PAS couvert.
    if (leJour < remise.startsOn || leJour >= remise.endsOn) return null;
    return remise;
  }

  async termesTarif(demande: DemandeTermes): Promise<TermesTarif> {
    const cycle = demande.billingCycle;
    let notrePrix: number | null = null;
    let blocage: string | null = null;
    let devise = "EUR";

    if (demande.kind !== "discount") {
      const offre = demande.planKey ? this.etat.offres[demande.planKey] : undefined;
      if (!offre) return vide("planUnknown");
      if (!offre.isActive) return vide("planInactive");
      if (offre.isQuoteOnly) return vide("planIsQuoteOnly");
      devise = offre.currency;

      if (demande.kind === "plan") {
        notrePrix = cycle === "monthly" ? offre.monthlyPriceCents : offre.yearlyPriceCents;
        if (notrePrix === null) {
          blocage = cycle === "monthly" ? "planMonthlyPriceUnknown" : "planYearlyPriceUnknown";
        }
      } else if (demande.kind === "seat") {
        if (cycle === "yearly") {
          // 0081 ne l'a pas tranché : dix fois 9,90 ou douze fois ?
          blocage = "seatYearlyPriceUndecided";
        } else {
          notrePrix = offre.extraSeatMonthlyPriceCents;
          if (notrePrix === null) blocage = "seatMonthlyPriceUnknown";
        }
      } else {
        const caseModule = MATRICE[`${demande.planKey}:${demande.moduleKey}`];
        if (caseModule === undefined) return vide("moduleUnknown");
        if (caseModule.availability !== "optional") {
          blocage =
            caseModule.availability === "included"
              ? "moduleIncludedInPlan"
              : caseModule.availability === "unavailable"
                ? "moduleUnavailableOnPlan"
                : "moduleUndecidedOnPlan";
        } else if (!caseModule.isDelivered) {
          blocage = "moduleNotDelivered";
        } else {
          notrePrix =
            cycle === "monthly" ? caseModule.monthlyPriceCents : caseModule.yearlyPriceCents;
          if (notrePrix === null) {
            blocage = cycle === "monthly" ? "moduleMonthlyPriceUnknown" : "moduleYearlyPriceUnknown";
          }
        }
      }
    } else {
      // LE CATALOGUE, TEL QUE LA BASE LE LIRAIT : par le CODE seul.
      // On prend la remise posée sur l'état plutôt que la constante du
      // module, sinon une remise universelle ne serait pas éprouvable —
      // et c'est précisément le cas où une garde trop large casse des
      // souscriptions légitimes.
      const catalogue = this.etat.remise;
      if (catalogue === null || demande.discountCode !== catalogue.code) {
        return vide("discountUnknown");
      }

      // LA RESTRICTION D'OFFRE, MIROIR EXACT DE LA BASE. Elle vient
      // AVANT le cycle : une remise réservée à une autre offre est
      // refusée qu'on la demande au mois ou à l'année.
      if (catalogue.appliesToPlan !== null) {
        if (demande.planKey === null || demande.planKey === undefined) {
          return vide("discountPlanUnspecified");
        }
        if (demande.planKey !== catalogue.appliesToPlan) {
          return vide("discountReservedToAnotherPlan");
        }
      }

      if (cycle === "yearly") {
        // 0081 REFUSE DE TRANCHER, en toutes lettres.
        blocage = "discountYearlyUndecided";
      } else {
        notrePrix = catalogue.valueCents;
      }
    }

    // La correspondance d'une remise se cherche sous L'OFFRE QU'ELLE
    // VISE, pas sous celle qu'on lui présente — les deux viennent
    // d'être vérifiées égales. C'est ce qui laisse une remise
    // universelle n'avoir qu'une seule correspondance, rangée sous une
    // offre nulle et valable partout.
    const map = this.etat.correspondances.get(
      demande.kind === "discount"
        ? clefCorrespondance({ ...demande, planKey: this.etat.remise?.appliesToPlan ?? null })
        : clefCorrespondance(demande),
    );

    // L'ORDRE : notre prix d'abord, la correspondance ensuite.
    if (blocage !== null) {
      return { ...vide(blocage), mappedAmountCents: map?.montantCents ?? null };
    }
    if (map === undefined) return { ...vide("providerPriceMissing"), ourAmountCents: notrePrix };
    if (map.montantCents !== notrePrix) {
      return {
        ...vide("amountDrift"),
        ourAmountCents: notrePrix,
        mappedAmountCents: map.montantCents,
      };
    }

    return {
      providerPriceId: map.priceId,
      providerProductId: `prod_${demande.kind}`,
      ourAmountCents: notrePrix,
      mappedAmountCents: map.montantCents,
      currency: map.devise ?? devise,
      blockingReason: null,
    };
  }
}

const ORG = "11111111-1111-1111-1111-111111111111";
const AUJOURD_HUI = "2026-09-05";

async function composer(
  source: SourceSimulee,
  planKey: string,
  options: { cycle?: CycleFacturation; modulesVoulus?: string[]; leJour?: string } = {},
) {
  return composerSouscription(
    {
      organizationId: ORG,
      planKey,
      billingCycle: options.cycle ?? "monthly",
      modulesVoulus: options.modulesVoulus,
      leJour: options.leJour ?? AUJOURD_HUI,
    },
    source,
  );
}

// ══════════════════════════════════════════════════════════════════
// 1. LA MATRICE OFFRE × MODULE
// ══════════════════════════════════════════════════════════════════

test("une entreprise BUSINESS qui souscrit BioLab ne génère AUCUNE ligne pour ce module", async () => {
  const source = new SourceSimulee({ sieges: 4, modulesSouscrits: ["biolab"] });
  const composition = await composer(source, "business");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;

  // Aucune ligne de module : il est COMPRIS dans l'offre.
  assert.deepEqual(
    composition.lignes.filter((l) => l.nature === "module"),
    [],
  );
  // Et on le DIT, plutôt que de laisser croire qu'il a été oublié.
  assert.deepEqual(composition.modulesInclusSansFrais, ["biolab"]);
  // Le total est celui de l'offre seule, au centime.
  assert.equal(composition.totalHtCents, 13990);
});

test("la même entreprise en PRO génère une ligne de module à 20 € HT", async () => {
  const source = new SourceSimulee({ sieges: 2, modulesSouscrits: ["biolab"] });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;

  const modules = composition.lignes.filter((l) => l.nature === "module");
  assert.equal(modules.length, 1);
  assert.equal(modules[0]!.moduleKey, "biolab");
  assert.equal(modules[0]!.prixUnitaireHtCents, 2000);
  assert.equal(modules[0]!.quantite, 1);
  assert.equal(modules[0]!.providerPriceId, "price_biolab_m");
  assert.deepEqual(composition.modulesInclusSansFrais, []);
  // 79,90 + 20,00 = 99,90 € HT.
  assert.equal(composition.totalHtCents, 9990);
});

test("LE PASSAGE DE PRO À BUSINESS FAIT DISPARAÎTRE LA LIGNE, sans qu'on touche à rien", async () => {
  // Une seule et même entreprise, un seul et même état : `biolab` est
  // souscrit. Seule l'offre change. Si la ligne survivait au passage,
  // le client paierait deux fois un module désormais compris.
  const etat = { sieges: 2, modulesSouscrits: ["biolab"] };

  const enPro = await composer(new SourceSimulee(etat), "team");
  const enBusiness = await composer(new SourceSimulee(etat), "business");

  assert.equal(enPro.jouable, true);
  assert.equal(enBusiness.jouable, true);
  if (!enPro.jouable || !enBusiness.jouable) return;

  assert.equal(enPro.lignes.filter((l) => l.nature === "module").length, 1);
  assert.equal(enBusiness.lignes.filter((l) => l.nature === "module").length, 0);
  assert.deepEqual(enBusiness.modulesInclusSansFrais, ["biolab"]);
});

test("un module VOULU en plus des modules souscrits passe par la même matrice", async () => {
  const source = new SourceSimulee({ sieges: 2, modulesSouscrits: [] });
  const composition = await composer(source, "team", { modulesVoulus: ["nursery"] });

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.lignes.filter((l) => l.nature === "module").length, 1);
  assert.equal(composition.totalHtCents, 7990 + 2000);
});

test("un module indisponible sur l'offre REFUSE la souscription entière", async () => {
  // Encaisser une souscription amputée d'une de ses lignes serait pire
  // qu'un refus : le client paierait en croyant avoir tout.
  const source = new SourceSimulee({ sieges: 1, modulesSouscrits: ["biolab"] });
  const composition = await composer(source, "solo");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "moduleUnavailableOnPlan");
  assert.match(composition.motif, /Changez d'offre/);
});

test("un module annoncé mais NON LIVRÉ ne se souscrit pas", async () => {
  const source = new SourceSimulee({ sieges: 1, modulesSouscrits: [] });
  const composition = await composer(source, "team", { modulesVoulus: ["chantiers3d"] });

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "moduleNotDelivered");
});

// ══════════════════════════════════════════════════════════════════
// 2. LES SIÈGES
// ══════════════════════════════════════════════════════════════════

test("L'ÉGALITÉ NE FACTURE RIEN : trois utilisateurs pour trois sièges inclus", async () => {
  // Le défaut classique est un `>=` mal placé : il fait payer un siège à
  // chaque entreprise pile à son plafond, et personne ne le voit avant
  // la première facture.
  const source = new SourceSimulee({ sieges: 3 });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.siegesFacturables, 0);
  assert.deepEqual(
    composition.lignes.filter((l) => l.nature === "seat"),
    [],
  );
  assert.equal(composition.totalHtCents, 7990);
});

test("EN DESSOUS DU SEUIL, rien non plus — et surtout pas un nombre négatif", async () => {
  const source = new SourceSimulee({ sieges: 1 });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.siegesFacturables, 0);
  assert.equal(composition.totalHtCents, 7990);
});

test("AU-DESSUS DU SEUIL, on facture l'écart, pas le total", async () => {
  const source = new SourceSimulee({ sieges: 7 });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.siegesFacturables, 4);

  const sieges = composition.lignes.filter((l) => l.nature === "seat");
  assert.equal(sieges.length, 1);
  assert.equal(sieges[0]!.quantite, 4);
  assert.equal(sieges[0]!.prixUnitaireHtCents, 990);
  // 79,90 + 4 × 9,90 = 119,50 € HT.
  assert.equal(composition.totalHtCents, 7990 + 4 * 990);
});

test("UN PLAFOND EST UN PLAFOND : `hardCap` ne facture aucun siège au-delà", async () => {
  const source = new SourceSimulee({ sieges: 9 });
  const composition = await composer(source, "solo");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.siegesFacturables, 0);
  assert.equal(composition.totalHtCents, 3990);
});

test("UN SEUIL NON DÉCIDÉ REFUSE — il ne vaut pas zéro", async () => {
  // `included_seats` à NULL veut dire « non décidé », et 0081 l'écrit
  // noir sur blanc. Facturer depuis un seuil inconnu, c'est inventer le
  // seuil ; ne rien facturer, c'est offrir tous les sièges en silence.
  const offres = {
    ...OFFRES,
    team: { ...OFFRES.team!, includedSeats: null },
  };
  const source = new SourceSimulee({ sieges: 12, offres });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "siegesInclusNonDecides");
  assert.match(composition.motif, /n'a pas été fixé/);
});

test("LE SIÈGE ANNUEL N'EXISTE PAS : la souscription annuelle avec sièges est refusée", async () => {
  const source = new SourceSimulee({ sieges: 7 });
  const composition = await composer(source, "team", { cycle: "yearly" });

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "seatYearlyPriceUndecided");
  assert.match(composition.motif, /Basculez au mois/);
});

test("…mais l'annuel SANS siège supplémentaire passe", async () => {
  // La preuve que le refus précédent tient au siège et non au cycle.
  const source = new SourceSimulee({ sieges: 3 });
  const composition = await composer(source, "team", { cycle: "yearly" });

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.totalHtCents, 79900);
  assert.equal(composition.lignes[0]!.providerPriceId, "price_team_y");
});

// ══════════════════════════════════════════════════════════════════
// 3. LA REMISE FONDATEUR, ET SA FIN
// ══════════════════════════════════════════════════════════════════

test("FONDATEUR SUR BUSINESS EST REFUSÉ — 90 € par mois qui partaient en silence", async () => {
  // LE TROU LE PLUS COÛTEUX DU CHANTIER. Le tarif fondateur vaut
  // 49,90 € et 0081 le réserve à l'offre Pro. Sans contrôle, il se
  // substituait au prix de N'IMPORTE QUELLE offre : sur Pro Business
  // (139,90 €), on encaissait 49,90 — 90 € offerts par mois et par
  // client, sous une ligne qui avait l'air normale.
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "business");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "remiseReserveeAUneAutreOffre");
  // ON REFUSE, ON N'IGNORE PAS : ignorer la remise ferait payer 139,90 €
  // à quelqu'un à qui une remise a été accordée.
  assert.match(composition.motif, /réservé à une autre offre/);
});

test("FONDATEUR SUR SOLO EST REFUSÉ AUSSI — la fuite marche dans les deux sens", async () => {
  // Sur Pro Solo (39,90 €), le prix imposé de 49,90 € faisait payer au
  // client 10 € DE PLUS que le tarif public, sous une ligne libellée
  // « Tarif fondateur ». C'est le sens auquel personne ne pense.
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "solo");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "remiseReserveeAUneAutreOffre");
});

test("…et sur l'offre VISÉE, la remise s'applique normalement", async () => {
  // La preuve que le refus tient à la restriction d'offre et non à la
  // remise elle-même.
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.totalHtCents, 4990);
});

test("UNE REMISE UNIVERSELLE S'APPLIQUE À TOUTES LES OFFRES", async () => {
  // `applies_to_plan` nul veut dire « toutes les offres ». La garde ne
  // doit pas transformer une remise commerciale générale en remise
  // introuvable — sinon on refuserait des souscriptions parfaitement
  // légitimes.
  const universelle: RemiseLue = { ...FONDATEUR, appliesToPlan: null, commitmentEndsOn: null };
  const source = new SourceSimulee({
    sieges: 1,
    remise: universelle,
    correspondances: (() => {
      const m = correspondancesParDefaut();
      m.delete("discount|team|monthly||FONDATEUR");
      // Rangée sous une offre NULLE : une seule correspondance sert
      // toutes les offres.
      m.set("discount||monthly||FONDATEUR", {
        priceId: "price_fondateur_m",
        montantCents: 4990,
        devise: "EUR",
      });
      return m;
    })(),
  });

  const composition = await composer(source, "business");
  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.totalHtCents, 4990);
});

// ══════════════════════════════════════════════════════════════════
// 3.bis LA TAXE — LE PRIX EST LE MÊME, LE MONTANT PRÉLEVÉ NON
// ══════════════════════════════════════════════════════════════════

test("FRANCE : 79,90 HT deviennent 95,88 au débit", async () => {
  // Le nombre DOIT être celui que `saas_invoice_totals` calcule pour la
  // même période. S'ils divergent, le rapprochement du webhook ne
  // trouve aucune facture correspondante et chaque encaissement se
  // solde par « à rapprocher à la main ».
  const source = new SourceSimulee({ sieges: 1 });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.totalHtCents, 7990);
  assert.equal(composition.taxe.montantTvaCents, 1598);
  assert.equal(composition.taxe.totalTtcCents, 9588);
  assert.equal(composition.taxe.providerTaxRateId, "txr_fr_20");
});

test("AUTOLIQUIDATION ET HORS UNION : le débit vaut le hors taxes", async () => {
  for (const regime of ["euReverseCharge", "outsideEu"] as const) {
    const source = new SourceSimulee({
      sieges: 1,
      taxe: {
        regime,
        tauxBps: 0,
        providerTaxRateId: null,
        blockingReason: null,
        reason: null,
      },
    });
    const composition = await composer(source, "team");

    assert.equal(composition.jouable, true, regime);
    if (!composition.jouable) return;
    assert.equal(composition.taxe.montantTvaCents, 0, regime);
    assert.equal(composition.taxe.totalTtcCents, 7990, regime);
    // Aucun objet de taxe à envoyer : il n'y a rien à ajouter.
    assert.equal(composition.taxe.providerTaxRateId, null, regime);
  }
});

test("UN RÉGIME INDÉTERMINÉ REFUSE, ET LE MOTIF DIT QUOI FAIRE", async () => {
  const source = new SourceSimulee({
    sieges: 1,
    taxe: {
      regime: "unknown",
      tauxBps: null,
      providerTaxRateId: null,
      blockingReason: "vatRegimeUnknown",
      reason: "numéro de TVA intracommunautaire non validé",
    },
  });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "vatRegimeUnknown");
  // Le motif de la base est REPRIS : « votre numéro n'est pas validé »
  // vaut mieux que « régime inconnu ».
  assert.match(composition.motif, /non validé/);
});

test("UNE CORRESPONDANCE DE TAXE MANQUANTE REFUSE — on n'encaisse pas le HT nu", async () => {
  // C'est le cas d'un déploiement à moitié fait : les tarifs sont
  // reliés, l'objet de taxe ne l'est pas encore. Encaisser « en
  // attendant » laisserait Oasis Care redevable de 15,98 € par client
  // et par mois, sans que rien ne le signale.
  const source = new SourceSimulee({
    sieges: 1,
    taxe: {
      regime: "france",
      tauxBps: 2000,
      providerTaxRateId: null,
      blockingReason: "providerTaxRateMissing",
      reason: null,
    },
  });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "providerTaxRateMissing");
});

test("LA TVA SE CALCULE SUR LE TOTAL, SIÈGES ET MODULES COMPRIS", async () => {
  // 7990 + 4×990 + 2000 = 13 950 HT → 2790 de TVA → 16 740 TTC.
  const source = new SourceSimulee({ sieges: 7, modulesSouscrits: ["biolab"] });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.totalHtCents, 13950);
  assert.equal(composition.taxe.montantTvaCents, 2790);
  assert.equal(composition.taxe.totalTtcCents, 16740);
});

test("la remise SUBSTITUE le prix de l'offre — elle n'ajoute pas une ligne négative", async () => {
  // Chez un prestataire de paiement, une ligne négative n'existe pas.
  // Deux lignes qui s'annulent à moitié donneraient un encaissement
  // faux et une facture illisible.
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;

  assert.equal(composition.lignes.length, 1);
  assert.equal(composition.lignes[0]!.prixUnitaireHtCents, 4990);
  assert.equal(composition.lignes[0]!.providerPriceId, "price_fondateur_m");
  assert.equal(composition.totalHtCents, 4990);
  assert.ok(composition.lignes.every((l) => l.prixUnitaireHtCents > 0));
});

test("LE TREIZIÈME MOIS EST PORTÉ DÈS LA SOUSCRIPTION : fin datée et tarif public de retour", async () => {
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.notEqual(composition.remise, null);

  assert.equal(composition.remise!.code, "FONDATEUR");
  assert.equal(composition.remise!.finLe, "2027-01-01");
  assert.equal(composition.remise!.prixRemiseHtCents, 4990);
  // Sans ces deux-là, personne ne saurait à quel tarif revenir sans
  // refaire tout le calcul — et un calcul refait est un calcul qui
  // diverge.
  assert.equal(composition.remise!.prixPublicHtCents, 7990);
  assert.equal(composition.remise!.providerPricePublicId, "price_team_m");
});

test("APRÈS LA FIN, le tarif public reprend tout seul", async () => {
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  // Le jour de fin lui-même n'est PAS couvert : `[starts_on, ends_on)`,
  // le même intervalle semi-ouvert que `saas_subscription_billing_lines`.
  const composition = await composer(source, "team", { leJour: "2027-01-01" });

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.remise, null);
  assert.equal(composition.totalHtCents, 7990);
  assert.equal(composition.lignes[0]!.providerPriceId, "price_team_m");
});

test("LA VEILLE DE LA FIN, la remise court encore", async () => {
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "team", { leJour: "2026-12-31" });

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;
  assert.equal(composition.totalHtCents, 4990);
});

test("FONDATEUR + ANNUEL est refusé, parce que 0081 refuse de trancher", async () => {
  // Douze fois 29,90 font 358,80 ; dix fois font 299. On ne choisit pas
  // à la place du dirigeant, et surtout on n'encaisse pas en attendant.
  const source = new SourceSimulee({ sieges: 1, remise: FONDATEUR });
  const composition = await composer(source, "team", { cycle: "yearly" });

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "discountYearlyUndecided");
  assert.match(composition.motif, /Basculez l'abonnement au mois/);
});

test("une remise en POURCENTAGE refuse plutôt que d'encaisser le tarif plein", async () => {
  const source = new SourceSimulee({
    sieges: 1,
    remise: { ...FONDATEUR, code: "PARRAIN", kind: "percentOff", valueCents: null, percent: 20 },
  });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "discountIsNotAFixedPrice");
});

// ══════════════════════════════════════════════════════════════════
// 4. « SUR DEVIS » NE SE SOUSCRIT PAS
// ══════════════════════════════════════════════════════════════════

test("Enterprise est refusée AVANT l'encaissement, pas après", async () => {
  // Le déclencheur `organization_subscriptions_plan_guard` de 0081 le
  // refuserait aussi — mais APRÈS : l'argent serait déjà pris.
  const source = new SourceSimulee({ sieges: 40 });
  const composition = await composer(source, "enterprise");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "planIsQuoteOnly");
  // La phrase doit proposer la suite, pas se contenter de dire non.
  assert.match(composition.motif, /Prenez contact/);
});

// ══════════════════════════════════════════════════════════════════
// 5. UNE CORRESPONDANCE MANQUANTE NE DEVIENT JAMAIS UN MONTANT DEVINÉ
// ══════════════════════════════════════════════════════════════════

test("aucun tarif chez le prestataire : refus lisible, et pas un prix inventé", async () => {
  const source = new SourceSimulee({ sieges: 2 });
  const composition = await composer(source, "business", { cycle: "yearly" });

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "providerPriceMissing");
  assert.match(composition.motif, /on ne devine pas un montant/);
});

test("LA DÉRIVE DE MONTANT REFUSE : notre grille a bougé, la correspondance non", async () => {
  // Un tarif du prestataire est IMMUABLE : changer un prix chez lui,
  // c'est en créer un nouveau. Si la correspondance ne suit pas,
  // encaisser reviendrait à facturer l'ancien montant — en silence.
  const correspondances = correspondancesParDefaut();
  correspondances.set("plan|team|monthly||", {
    priceId: "price_team_m_ancien",
    montantCents: 6990,
    devise: "EUR",
  });
  const source = new SourceSimulee({ sieges: 1, correspondances });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "amountDrift");
  assert.match(composition.motif, /ancien prix/);
});

test("une correspondance de SIÈGE manquante refuse toute la souscription", async () => {
  const correspondances = correspondancesParDefaut();
  correspondances.delete("seat|team|monthly||");
  const source = new SourceSimulee({ sieges: 7, correspondances });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "providerPriceMissing");
});

// ══════════════════════════════════════════════════════════════════
// 6. LES REFUS DE CADRE
// ══════════════════════════════════════════════════════════════════

test("une offre inexistante refuse sans lever", async () => {
  const composition = await composer(new SourceSimulee(), "offre-qui-n-existe-pas");
  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "offreIntrouvable");
});

test("une offre retirée du catalogue ne se souscrit plus", async () => {
  const composition = await composer(new SourceSimulee(), "retire");
  assert.equal(composition.jouable, false);
  if (composition.jouable) return;
  assert.equal(composition.code, "planInactive");
});

test("un motif INCONNU produit une phrase, jamais une exception", async () => {
  // Une base plus récente que ce déploiement peut rendre un code que ce
  // fichier n'a jamais vu. L'écran ne doit pas tomber pour ça, et le
  // code brut doit rester lisible pour retrouver la cause.
  const phrase = phrasePourMotif("motifQueLeCodeNeConnaitPas");
  assert.match(phrase, /motifQueLeCodeNeConnaitPas/);
  assert.ok(phrase.length > 20);
});

// ══════════════════════════════════════════════════════════════════
// 7. L'ARITHMÉTIQUE
// ══════════════════════════════════════════════════════════════════

test("le total est une somme d'ENTIERS, jamais un flottant", async () => {
  const source = new SourceSimulee({ sieges: 6, modulesSouscrits: ["biolab", "nursery"] });
  const composition = await composer(source, "team");

  assert.equal(composition.jouable, true);
  if (!composition.jouable) return;

  // 7990 + 3 × 990 + 2000 + 2000 = 14 960 centimes.
  assert.equal(composition.totalHtCents, 14960);
  assert.equal(Number.isInteger(composition.totalHtCents), true);
  for (const ligne of composition.lignes) {
    assert.equal(Number.isInteger(ligne.prixUnitaireHtCents), true);
    assert.equal(Number.isInteger(ligne.quantite), true);
  }
});

test("le jour de référence est celui de PARIS, pas celui d'UTC", async () => {
  // À 23 h 30 en France l'été, l'UTC est déjà le lendemain. Une remise
  // qui court « jusqu'au 31 » cesserait une soirée trop tôt pour qui
  // souscrit tard, et le client verrait le tarif public.
  const tardLeSoir = new Date("2026-07-31T22:30:00Z"); // 00 h 30 le 1er août à Paris
  const finJuillet = new Date("2026-07-31T21:00:00Z"); // 23 h 00 le 31 juillet à Paris

  assert.equal(jourDeReference(tardLeSoir), "2026-08-01");
  assert.equal(jourDeReference(finJuillet), "2026-07-31");
  // Et voici l'écart, mesuré : sur ce même instant, un
  // `toISOString().slice(0, 10)` aurait rendu le 31 juillet.
  assert.equal(tardLeSoir.toISOString().slice(0, 10), "2026-07-31");
  assert.notEqual(jourDeReference(tardLeSoir), tardLeSoir.toISOString().slice(0, 10));
});

// ══════════════════════════════════════════════════════════════════
// 8. LE RÉSUMÉ QUI PART AU NAVIGATEUR
// ══════════════════════════════════════════════════════════════════

test("LE RÉSUMÉ NE PORTE AUCUN IDENTIFIANT DE TARIF DU PRESTATAIRE", async () => {
  // Il n'est pas secret, mais l'exposer inviterait un jour quelqu'un à
  // le renvoyer au serveur, et le serveur à s'en servir. Le montant fait
  // foi côté serveur : le navigateur n'a besoin de rien pour afficher.
  const source = new SourceSimulee({ sieges: 7, modulesSouscrits: ["biolab"], remise: FONDATEUR });
  const composition = await composer(source, "team");
  const resume = versResumePublic(composition);

  const serialise = JSON.stringify(resume);
  assert.equal(serialise.includes("price_"), false, serialise);
  assert.equal(serialise.includes("providerPriceId"), false);
});

test("chaque total de ligne est calculé AU SERVEUR, pas laissé au navigateur", async () => {
  const source = new SourceSimulee({ sieges: 7 });
  const resume = versResumePublic(await composer(source, "team"));

  assert.equal(resume.jouable, true);
  if (!resume.jouable) return;

  const siege = resume.lignes.find((l) => l.nature === "seat")!;
  assert.equal(siege.quantite, 4);
  assert.equal(siege.prixUnitaireHtCents, 990);
  assert.equal(siege.totalLigneHtCents, 3960);
  // La somme des lignes est le total : deux chiffres qui divergeraient
  // se verraient à l'écran avant de se voir au relevé bancaire.
  assert.equal(
    resume.lignes.reduce((s, l) => s + l.totalLigneHtCents, 0),
    resume.totalHtCents,
  );
});

test("LA MENTION « HT » VOYAGE AVEC LE MONTANT", async () => {
  // Un prix hors taxes montré sans sa mention à un professionnel est une
  // pratique commerciale trompeuse. La laisser au gabarit d'affichage,
  // c'est accepter qu'elle manque au deuxième écran.
  const resume = versResumePublic(await composer(new SourceSimulee(), "team"));
  assert.equal(resume.jouable, true);
  if (!resume.jouable) return;
  assert.equal(resume.mentionPrix, "HT");
  assert.equal(resume.devise, "EUR");
});

test("un refus se résume en code + phrase, sans détail interne", async () => {
  const resume = versResumePublic(await composer(new SourceSimulee(), "enterprise"));
  assert.equal(resume.jouable, false);
  if (resume.jouable) return;
  assert.equal(resume.code, "planIsQuoteOnly");
  assert.match(resume.motif, /Prenez contact/);
});
