import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  StripeBillingProvider,
  clefPourIntention,
  construireStripeBillingProvider,
} from "./stripe.ts";
import type {
  ApiStripe,
  DemandeSessionPaiement,
  SessionPaiement,
} from "./stripe-api.ts";
import type {
  DemandeTermes,
  OffreLue,
  RemiseLue,
  SourceFacturation,
  TermesTarif,
  TermesTaxe,
} from "./composition.ts";

/**
 * §STRIPE — LE FOURNISSEUR, ÉPROUVÉ CONTRE UN DOUBLE SIMULÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS DÉFENDENT
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. UN DROIT NE S'OUVRE JAMAIS ICI. `startCheckout` rend une
 *    redirection ; il n'écrit rien, n'accorde rien. C'est vérifié en
 *    donnant au fournisseur une base qui LÈVE sur toute écriture.
 * 2. LE MONTANT FAIT FOI CÔTÉ SERVEUR. Ce qui part au prestataire est
 *    exactement ce que la base a dit, jamais ce que l'appelant a
 *    proposé — et l'intention ne porte aucun champ de prix.
 * 3. L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL, qui rend « unavailable » avec
 *    une phrase, et jamais une exception.
 *
 * Aucun appel réseau : `ApiStripe` est une interface, et le double
 * ci-dessous enregistre ce qu'on lui a demandé.
 */

// ══════════════════════════════════════════════════════════════════
// LES DOUBLES
// ══════════════════════════════════════════════════════════════════

class ApiSimulee implements ApiStripe {
  readonly mode = "test" as const;
  readonly demandes: DemandeSessionPaiement[] = [];
  #url: string | null;

  constructor(url: string | null = "https://paiement.exemple/cs_1") {
    this.#url = url;
  }

  async creerSessionPaiement(demande: DemandeSessionPaiement): Promise<SessionPaiement> {
    this.demandes.push(demande);
    return { id: "cs_1", url: this.#url, clientId: null };
  }
}

const OFFRE_PRO: OffreLue = {
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
};

const OFFRE_ENTERPRISE: OffreLue = {
  key: "enterprise",
  name: "Oasis Care Enterprise",
  isActive: true,
  isQuoteOnly: true,
  monthlyPriceCents: null,
  yearlyPriceCents: null,
  includedSeats: null,
  seatPolicy: "billedBeyondIncluded",
  extraSeatMonthlyPriceCents: null,
  priceFloorCents: 24900,
  currency: "EUR",
};

type EtatSource = {
  offres: Record<string, OffreLue>;
  sieges: number;
  modules: string[];
  remise: RemiseLue | null;
  /** Les cases SANS correspondance chez le prestataire. */
  sansTarif: Set<string>;
  taxe: TermesTaxe;
};

/** Le cas nominal : entreprise francaise, 20 %, objet de taxe relie. */
const TAXE_FRANCE: TermesTaxe = {
  regime: "france",
  tauxBps: 2000,
  providerTaxRateId: "txr_fr_20",
  blockingReason: null,
  reason: null,
};

class SourceSimulee implements SourceFacturation {
  readonly etat: EtatSource;

  constructor(surcharge: Partial<EtatSource> = {}) {
    this.etat = {
      offres: { team: OFFRE_PRO, enterprise: OFFRE_ENTERPRISE },
      sieges: 1,
      modules: [],
      remise: null,
      sansTarif: new Set(),
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
  async lireTermesTaxe(): Promise<TermesTaxe> {
    return this.etat.taxe;
  }
  async lireModulesSouscrits(): Promise<string[]> {
    return this.etat.modules;
  }
  async lireRemiseActive(): Promise<RemiseLue | null> {
    return this.etat.remise;
  }

  async termesTarif(d: DemandeTermes): Promise<TermesTarif> {
    const clef = `${d.kind}|${d.planKey ?? ""}|${d.billingCycle}|${d.moduleKey ?? ""}`;
    const bloque = (motif: string): TermesTarif => ({
      providerPriceId: null,
      providerProductId: null,
      ourAmountCents: null,
      mappedAmountCents: null,
      currency: null,
      blockingReason: motif,
    });

    if (this.etat.sansTarif.has(clef)) return bloque("providerPriceMissing");
    if (d.kind === "module" && d.moduleKey === "biolab" && d.planKey === "business") {
      return bloque("moduleIncludedInPlan");
    }

    const offre = d.planKey ? this.etat.offres[d.planKey] : undefined;
    if (d.kind !== "discount" && offre?.isQuoteOnly) return bloque("planIsQuoteOnly");

    const montant =
      d.kind === "plan"
        ? d.billingCycle === "monthly"
          ? (offre?.monthlyPriceCents ?? null)
          : (offre?.yearlyPriceCents ?? null)
        : d.kind === "seat"
          ? (offre?.extraSeatMonthlyPriceCents ?? null)
          : 2000;
    if (montant === null) return bloque("planMonthlyPriceUnknown");

    return {
      providerPriceId: `price_${d.kind}_${d.planKey ?? "x"}_${d.billingCycle}`,
      providerProductId: `prod_${d.kind}`,
      ourAmountCents: montant,
      mappedAmountCents: montant,
      currency: "EUR",
      blockingReason: null,
    };
  }
}

type LigneAbonnement = { plan: string; provider: string; status: string; started_at: string };

/**
 * Une base simulée, en LECTURE SEULE PAR CONSTRUCTION.
 *
 * `insert`, `update`, `upsert` et `delete` LÈVENT. Si un jour quelqu'un
 * ajoute une écriture dans le tunnel de paiement, ces tests tombent —
 * et c'est exactement ce qu'on veut : ouvrir un droit avant
 * l'encaissement confirmé serait le défaut le plus coûteux de tout le
 * chantier.
 */
/**
 * UNE IDENTITÉ FACTURABLE COMPLÈTE, en France.
 *
 * C'est le défaut parce que c'est le cas nominal : une entreprise dont
 * la facture PEUT être émise. Les tests qui éprouvent le refus
 * d'identité incomplète la surchargent explicitement — l'inverse
 * (défaut vide) ferait échouer tous les autres tests pour une raison
 * qui n'a rien à voir avec ce qu'ils mesurent.
 */
const IDENTITE_COMPLETE = {
  legal_name: "SARL Paysages Exemple",
  legal_form: "SARL",
  siren: "732829320",
  siret: "73282932000074",
  vat_number: null,
  address_line1: "1 rue des Jardins",
  postal_code: "44000",
  city: "Nantes",
  country: "FR",
};

type OptionsBase = {
  abonnement?: LigneAbonnement | null;
  email?: string | null;
  /** La fiche société, telle que `business_organizations` la porte. */
  identite?: Record<string, string | null> | null;
};

function supabaseSimule(options: OptionsBase) {
  const interdit = (geste: string) => () => {
    throw new Error(`Le tunnel de paiement ne doit rien écrire en base (${geste} appelé).`);
  };

  // LA BASE SIMULÉE DISTINGUE LES TABLES, et ce n'est pas un raffinement
  // gratuit : tant qu'elle rendait la même ligne à toutes les requêtes,
  // la lecture de l'identité facturable recevait l'abonnement, et le
  // test aurait « passé » en mesurant autre chose que ce qu'il annonce.
  const requete = (table: string) => {
    const r = {
      select: () => r,
      eq: () => r,
      is: () => r,
      maybeSingle: async () => {
        if (table === "business_organizations") {
          return {
            data: options.identite === undefined ? IDENTITE_COMPLETE : options.identite,
            error: null,
          };
        }
        return { data: options.abonnement ?? null, error: null };
      },
      insert: interdit("insert"),
      update: interdit("update"),
      upsert: interdit("upsert"),
      delete: interdit("delete"),
    };
    return r;
  };

  return {
    from: (table: string) => requete(table),
    rpc: async () => ({ data: null, error: new Error("rpc non simulé") }),
    auth: {
      getUser: async () => ({
        data: { user: options.email === null ? null : { email: options.email ?? "chef@exemple.fr" } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

function fournisseur(api: ApiStripe, source: SourceFacturation, options: OptionsBase = {}) {
  return new StripeBillingProvider({
    api,
    origine: "https://pro.exemple.fr/",
    supabase: async () => supabaseSimule(options),
    source: () => source,
  });
}

const ORG = "22222222-2222-2222-2222-222222222222";

// ══════════════════════════════════════════════════════════════════
// LE TUNNEL QUI PASSE
// ══════════════════════════════════════════════════════════════════

test("une souscription jouable rend une REDIRECTION, pas un abonnement", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 2 }));

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });

  assert.equal(sortie.kind, "redirect");
  if (sortie.kind !== "redirect") return;
  assert.equal(sortie.url, "https://paiement.exemple/cs_1");

  // Aucun droit ouvert : le double de base lève sur toute écriture, et
  // il n'a pas levé.
  assert.equal(api.demandes.length, 1);
});

test("CE QUI PART AU PRESTATAIRE EST CE QUE LA BASE A DIT", async () => {
  const api = new ApiSimulee();
  // Sept utilisateurs, trois sièges inclus : quatre sièges facturables.
  const provider = fournisseur(api, new SourceSimulee({ sieges: 7 }));

  await provider.startCheckout({ organizationId: ORG, planKey: "team" });

  const demande = api.demandes[0]!;
  assert.deepEqual(demande.lignes, [
    { price: "price_plan_team_monthly", quantity: 1 },
    { price: "price_seat_team_monthly", quantity: 4 },
  ]);
  // LES DEUX MONTANTS VOYAGENT, parce qu'ils ne disent pas la même
  // chose : le hors taxes est ce qui sera FACTURÉ, le toutes taxes ce
  // qui sera PRÉLEVÉ. Ils ne coïncident qu'en autoliquidation et hors
  // Union.
  const ht = 7990 + 4 * 990;
  assert.equal(demande.metadonnees.totalHtCents, String(ht));
  assert.equal(demande.metadonnees.totalTtcCents, String(ht + Math.round(ht * 0.2)));
  assert.equal(demande.metadonnees.regimeTva, "france");
  assert.equal(demande.metadonnees.siegesFacturables, "4");
  // LE NOM EST PRÉFIXÉ, ET C'EST CELUI QUE LE WEBHOOK LIT. Les deux
  // moitiés du chantier employaient des noms différents : signature
  // valide, événement journalisé, puis « Entreprise inconnue » sur
  // chaque encaissement, pendant que le prestataire recevait ses 200.
  assert.equal(demande.metadonnees.oasis_organization_id, ORG);
  assert.equal(demande.metadonnees.mode, "test");

  // ET LA TAXE PART AVEC. Sans elle, le prestataire encaisserait le
  // hors taxes nu et la facture resterait impayée de sa TVA.
  assert.deepEqual(demande.tauxTaxe, ["txr_fr_20"]);
});

test("LA TVA EST CALCULÉE, ET C'EST ELLE QUI SERA PRÉLEVÉE", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 1 }));

  const resume = await provider.previewCheckout({ organizationId: ORG, planKey: "team" });
  assert.ok(resume.jouable);
  // 79,90 HT + 15,98 = 95,88 TTC. Exactement ce que
  // `saas_invoice_totals` calcule pour la même période : les deux
  // nombres DOIVENT coïncider, sinon le rapprochement du webhook ne
  // trouve jamais de facture correspondante.
  assert.equal(resume.totalHtCents, 7990);
  assert.equal(resume.taxe.montantTvaCents, 1598);
  assert.equal(resume.taxe.totalTtcCents, 9588);
  assert.equal(resume.mentionPrix, "HT");
});

test("AUTOLIQUIDATION : rien n'est ajouté, et aucun objet de taxe n'est envoyé", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(
    api,
    new SourceSimulee({
      sieges: 1,
      taxe: {
        regime: "euReverseCharge",
        tauxBps: 0,
        providerTaxRateId: null,
        blockingReason: null,
        reason: null,
      },
    }),
  );

  const resume = await provider.previewCheckout({ organizationId: ORG, planKey: "team" });
  assert.ok(resume.jouable);
  assert.equal(resume.taxe.montantTvaCents, 0);
  // Le preneur déclare la taxe chez lui : on prélève le hors taxes.
  assert.equal(resume.taxe.totalTtcCents, 7990);

  await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.deepEqual(api.demandes[0]!.tauxTaxe, []);
});

test("UN RÉGIME DE TVA INDÉTERMINÉ FERME LA CAISSE — jamais 0 %, jamais 20 %", async () => {
  // LE CAS QUI COÛTE DANS LES DEUX SENS. Prélever 0 % à un assujetti
  // laisse Oasis Care redevable de la taxe ; prélever 20 % à un preneur
  // en autoliquidation lui fait payer une taxe qu'il ne doit pas et
  // qu'on n'a aucun droit de collecter. On refuse.
  const api = new ApiSimulee();
  const provider = fournisseur(
    api,
    new SourceSimulee({
      sieges: 1,
      taxe: {
        regime: "unknown",
        tauxBps: null,
        providerTaxRateId: null,
        blockingReason: "vatRegimeUnknown",
        reason: "numéro de TVA intracommunautaire non validé",
      },
    }),
  );

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(sortie.kind, "unavailable");
  // Et RIEN n'est parti au prestataire.
  assert.equal(api.demandes.length, 0);
});

test("UNE IDENTITÉ INCOMPLÈTE FERME LA CAISSE — le serveur, pas seulement l'écran", async () => {
  // Le contrôle n'existait que dans une condition de rendu JSX. Un
  // `fetch` fabriqué à la main — ou simplement un compte dont l'étape
  // « société » a été passée, puisqu'elle est facultative — encaissait
  // quand même, et la facture était ensuite INÉMETTABLE.
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 1 }), {
    identite: { ...IDENTITE_COMPLETE, siret: null, legal_name: null },
  });

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(sortie.kind, "unavailable");
  assert.ok(sortie.kind === "unavailable" && /siret/i.test(sortie.reason));
  assert.equal(api.demandes.length, 0);
});

test("UNE FICHE ILLISIBLE FERME LA CAISSE AUSSI — on ne la lit pas comme vide", async () => {
  // Une fiche qu'on n'a pas pu lire n'est ni « complète » ni
  // « incomplète » : les deux suppositions coûtent. On dit qu'on ne
  // sait pas, et on s'arrête.
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 1 }), { identite: null });

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(sortie.kind, "unavailable");
  assert.equal(api.demandes.length, 0);
});

test("LE RÉSUMÉ REFUSE CE QUE LA CAISSE REFUSERAIT — il ne chiffre pas dans le vide", async () => {
  // C'était le chemin OFFICIEL de montée en gamme : l'écran
  // d'abonnement propose « Changer d'offre » et renvoie au tunnel. Le
  // client voyait un total, une remise, un bouton « Payer », puis un
  // refus.
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 1 }), {
    abonnement: { plan: "team", provider: "web", status: "active", started_at: "2026-01-01" },
  });

  const resume = await provider.previewCheckout({ organizationId: ORG, planKey: "business" });
  assert.equal(resume.jouable, false);
  assert.ok(resume.jouable === false && resume.code === "dejaAbonne");
});

test("LE NAVIGATEUR NE PEUT PAS PROPOSER UN PRIX : le champ n'existe pas", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 1 }));

  // Une intention forgée, avec tout ce qu'un client malveillant
  // essaierait d'y glisser. TypeScript refuserait déjà ces champs ; on
  // les passe par un détour pour prouver qu'à l'exécution non plus ils
  // ne servent à rien.
  const forgee = {
    organizationId: ORG,
    planKey: "team",
    prix: 0,
    totalHtCents: 1,
    amount: 0,
  } as unknown as { organizationId: string; planKey: string };

  await provider.startCheckout(forgee);

  const demande = api.demandes[0]!;
  assert.deepEqual(demande.lignes, [{ price: "price_plan_team_monthly", quantity: 1 }]);
  assert.equal(demande.metadonnees.totalHtCents, "7990");
});

test("les URL de retour viennent du SERVEUR, jamais du navigateur", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee());
  await provider.startCheckout({ organizationId: ORG, planKey: "team" });

  const demande = api.demandes[0]!;
  // L'origine est celle passée au constructeur, débarrassée de sa barre
  // finale — une URL postée par le client ferait de cette route un
  // redirecteur ouvert, au bout d'un tunnel de paiement, c'est-à-dire
  // exactement là où l'on clique sans lire.
  assert.ok(demande.urlSucces.startsWith("https://pro.exemple.fr/entreprise/abonnement?"));
  assert.equal(demande.urlSucces.includes("//entreprise"), false);
  assert.ok(demande.urlAbandon.includes("souscription=abandonnee"));
  // L'identifiant de session sert à AFFICHER, pas à ouvrir un droit.
  assert.ok(demande.urlSucces.includes("{CHECKOUT_SESSION_ID}"));
});

test("LA CLÉ D'IDEMPOTENCE EST STABLE pour la même intention, différente sinon", async () => {
  // Deux clics sur « Payer » portent la même intention et doivent rendre
  // la même session. Une clé tirée au hasard créerait deux sessions,
  // donc deux abonnements possibles pour un seul client.
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 2 }));

  await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(api.demandes[0]!.clefIdempotence, api.demandes[1]!.clefIdempotence);

  // Un changement de cycle est une AUTRE intention : nouvelle clé.
  const autre = new ApiSimulee();
  const provider2 = fournisseur(autre, new SourceSimulee({ sieges: 2 }));
  await provider2.startCheckout({ organizationId: ORG, planKey: "team", billingCycle: "yearly" });
  assert.notEqual(api.demandes[0]!.clefIdempotence, autre.demandes[0]!.clefIdempotence);
});

test("la clé d'idempotence porte l'entreprise : deux clients ne la partagent pas", () => {
  const composition = {
    jouable: true as const,
    planKey: "team",
    billingCycle: "monthly" as const,
    devise: "EUR",
    lignes: [
      {
        nature: "plan" as const,
        moduleKey: null,
        libelle: "Pro",
        quantite: 1,
        prixUnitaireHtCents: 7990,
        providerPriceId: "price_team_m",
        devise: "EUR",
      },
    ],
    totalHtCents: 7990,
    siegesFacturables: 0,
    modulesInclusSansFrais: [],
    remise: null,
    taxe: {
      regime: "france" as const,
      tauxBps: 2000,
      providerTaxRateId: "txr_fr_20",
      montantTvaCents: 1598,
      totalTtcCents: 9588,
    },
  };

  const a = clefPourIntention("org-a", composition);
  const b = clefPourIntention("org-b", composition);
  assert.notEqual(a, b);
  assert.ok(a.includes("org-a"));
});

test("le RÉSUMÉ et le PAIEMENT sont calculés par le même code", async () => {
  // Un résumé calculé à part finirait par annoncer un montant et en
  // prélever un autre.
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee({ sieges: 5 }));

  const resume = await provider.previewCheckout({ organizationId: ORG, planKey: "team" });
  await provider.startCheckout({ organizationId: ORG, planKey: "team" });

  assert.equal(resume.jouable, true);
  if (!resume.jouable) return;
  assert.equal(resume.totalHtCents, 7990 + 2 * 990);
  assert.equal(api.demandes[0]!.metadonnees.totalHtCents, String(resume.totalHtCents));
});

// ══════════════════════════════════════════════════════════════════
// LES REFUS
// ══════════════════════════════════════════════════════════════════

test("« SUR DEVIS » rend `unavailable` avec un motif qui propose la suite", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee());

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "enterprise" });

  assert.equal(sortie.kind, "unavailable");
  if (sortie.kind !== "unavailable") return;
  assert.match(sortie.reason, /sur devis/);
  assert.match(sortie.reason, /Prenez contact/);
  // Et surtout : RIEN n'a été demandé au prestataire.
  assert.equal(api.demandes.length, 0);
});

test("UNE CORRESPONDANCE MANQUANTE rend `unavailable`, jamais un montant deviné", async () => {
  const api = new ApiSimulee();
  const source = new SourceSimulee({ sansTarif: new Set(["plan|team|monthly|"]) });
  const provider = fournisseur(api, source);

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });

  assert.equal(sortie.kind, "unavailable");
  if (sortie.kind !== "unavailable") return;
  assert.match(sortie.reason, /on ne devine pas un montant/);
  assert.equal(api.demandes.length, 0);
});

test("un abonnement DÉJÀ EN COURS ferme la caisse plutôt que d'ouvrir un doublon", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee(), {
    abonnement: {
      plan: "team",
      provider: "web",
      status: "active",
      started_at: "2026-01-01T00:00:00Z",
    },
  });

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "business" });

  assert.equal(sortie.kind, "unavailable");
  if (sortie.kind !== "unavailable") return;
  assert.match(sortie.reason, /déjà un abonnement en cours/);
  assert.equal(api.demandes.length, 0);
});

test("un abonnement RÉSILIÉ ne ferme pas la caisse : on peut se réabonner", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee(), {
    abonnement: {
      plan: "team",
      provider: "web",
      status: "cancelled",
      started_at: "2026-01-01T00:00:00Z",
    },
  });

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(sortie.kind, "redirect");
});

test("une session expirée refuse au lieu d'encaisser sous une identité inconnue", async () => {
  const api = new ApiSimulee();
  const provider = fournisseur(api, new SourceSimulee(), { email: null });

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(sortie.kind, "unavailable");
  if (sortie.kind !== "unavailable") return;
  assert.match(sortie.reason, /Reconnectez-vous/);
  assert.equal(api.demandes.length, 0);
});

test("une session sans URL dit que RIEN n'a été prélevé", async () => {
  const api = new ApiSimulee(null);
  const provider = fournisseur(api, new SourceSimulee());

  const sortie = await provider.startCheckout({ organizationId: ORG, planKey: "team" });
  assert.equal(sortie.kind, "unavailable");
  if (sortie.kind !== "unavailable") return;
  assert.match(sortie.reason, /Rien n'a été prélevé/);
});

// ══════════════════════════════════════════════════════════════════
// L'AIGUILLAGE : L'ABSENCE DE CLÉ EST UN ÉTAT NORMAL
// ══════════════════════════════════════════════════════════════════

const supabaseInutile = async () => supabaseSimule({});

test("sans clé secrète, la construction rend une PHRASE — elle ne lève pas", () => {
  const sortie = construireStripeBillingProvider(supabaseInutile, {
    NEXT_PUBLIC_SITE_URL: "https://pro.exemple.fr",
  });
  assert.ok("indisponible" in sortie);
  if (!("indisponible" in sortie)) return;
  assert.match(sortie.indisponible, /STRIPE_SECRET_KEY/);
});

test("sans adresse publique du site, la caisse reste fermée", () => {
  // Sans elle, la page de retour après paiement ne peut pas être
  // construite de façon sûre : un `Host` est falsifiable.
  const sortie = construireStripeBillingProvider(supabaseInutile, {
    STRIPE_SECRET_KEY: "cle-de-test-inventee",
    STRIPE_MODE: "test",
  });
  assert.ok("indisponible" in sortie);
  if (!("indisponible" in sortie)) return;
  assert.match(sortie.indisponible, /NEXT_PUBLIC_SITE_URL/);
});

test("une adresse de site qui n'est pas une URL http(s) est refusée", () => {
  for (const origine of ["pro.exemple.fr", "javascript:alert(1)", "/entreprise"]) {
    const sortie = construireStripeBillingProvider(supabaseInutile, {
      STRIPE_SECRET_KEY: "cle-de-test-inventee",
      STRIPE_MODE: "test",
      NEXT_PUBLIC_SITE_URL: origine,
    });
    assert.ok("indisponible" in sortie, `« ${origine} » ne doit pas passer`);
  }
});

test("avec les trois variables posées, le fournisseur naît et se dit disponible", () => {
  const sortie = construireStripeBillingProvider(supabaseInutile, {
    STRIPE_SECRET_KEY: "cle-de-test-inventee",
    STRIPE_MODE: "test",
    NEXT_PUBLIC_SITE_URL: "https://pro.exemple.fr",
  });
  assert.equal("indisponible" in sortie, false);
  if ("indisponible" in sortie) return;
  assert.equal(sortie.unavailableReason, null);
  assert.equal(sortie.id, "web");
});
