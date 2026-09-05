/**
 * §STRIPE — CE QUI EST RÉELLEMENT DÛ, CALCULÉ AU SERVEUR.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI COMMANDE TOUT CE FICHIER
 * ══════════════════════════════════════════════════════════════════
 *
 * LE NAVIGATEUR N'ENVOIE JAMAIS UN MONTANT. Il envoie une INTENTION —
 * « l'offre `team`, au mois, avec BioLab » — et rien d'autre. Le serveur
 * relit l'offre, la matrice offre × module, les sièges et la remise en
 * base, et recalcule. C'est pour cela qu'il n'existe, nulle part dans ce
 * fichier, un champ « prix » côté entrée : un client qui posterait
 * « planKey: business, prix: 0 » n'est pas refusé par politesse, il est
 * refusé PAR CONSTRUCTION — le champ n'existe pas.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES PRIX SONT HORS TAXES, ET LA TVA N'EST PAS ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Tous les montants de ce fichier sont HORS TAXES et en CENTIMES
 * ENTIERS. La taxe ne s'y calcule pas : c'est `saas_vat_regime()` qui
 * décide du régime (france / euReverseCharge / outsideEu / unknown) et
 * la chaîne de facturation de 0081 qui l'applique. Deux moteurs de taxe
 * sur la même transaction, ce sont deux vérités et un jour un écart —
 * d'où `tax_behavior = 'exclusive'` verrouillé sur chaque tarif du
 * prestataire par 0083, et aucun calcul de taxe demandé au prestataire.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI DES PORTS, ET PAS UN CLIENT SUPABASE DIRECT
 * ══════════════════════════════════════════════════════════════════
 *
 * `SourceFacturation` est une interface. La vraie implémentation lit la
 * base (voir `source-supabase.ts`) ; les tests en fournissent une
 * fausse, en mémoire. Sans cela, prouver « une entreprise Business qui
 * souscrit BioLab ne génère AUCUNE ligne » exigerait une base de
 * données dans la suite de tests, et ce test ne tournerait jamais en
 * intégration.
 */

/** Les deux cycles que 0081 connaît. Il n'y en a pas de troisième. */
export type CycleFacturation = "monthly" | "yearly";

/** Les quatre natures de case de la grille (colonne `kind` de 0083). */
export type NatureTarif = "plan" | "seat" | "module" | "discount";

/** Le mode du prestataire. Une correspondance d'essai ne vaut rien en production. */
export type ModePrestataire = "test" | "live";

/**
 * Ce que rend `billing_provider_price_terms()` — la fonction de 0083 qui
 * NE LÈVE JAMAIS. Quand elle bloque, `providerPriceId` est NUL : un
 * appelant distrait ne trouve rien à encaisser plutôt qu'un tarif
 * approximatif.
 */
export type TermesTarif = {
  providerPriceId: string | null;
  providerProductId: string | null;
  /** NOTRE prix, celui qui fait autorité. */
  ourAmountCents: number | null;
  /** Le montant enregistré chez le prestataire, pour montrer la dérive. */
  mappedAmountCents: number | null;
  currency: string | null;
  blockingReason: string | null;
};

export type DemandeTermes = {
  kind: NatureTarif;
  planKey?: string | null;
  billingCycle: CycleFacturation;
  moduleKey?: string | null;
  discountCode?: string | null;
};

/** Une ligne de `organization_plans`, telle que 0081 l'a enrichie. */
export type OffreLue = {
  key: string;
  name: string;
  isActive: boolean;
  isQuoteOnly: boolean;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
  /** NULL veut dire « non décidé », explicitement — pas « zéro ». */
  includedSeats: number | null;
  seatPolicy: "hardCap" | "billedBeyondIncluded";
  extraSeatMonthlyPriceCents: number | null;
  priceFloorCents: number | null;
  currency: string;
};

/** Une ligne de `subscription_discounts` en cours à la date demandée. */
export type RemiseLue = {
  code: string | null;
  label: string;
  kind: "fixedMonthlyPrice" | "percentOff" | "amountOff";
  valueCents: number | null;
  percent: number | null;
  startsOn: string;
  /** NOT NULL en base : il n'existe pas de remise sans fin. */
  endsOn: string;
};

export interface SourceFacturation {
  lireOffre(planKey: string): Promise<OffreLue | null>;
  /**
   * Le nombre de SIÈGES, c'est-à-dire de comptes qui se connectent —
   * `organization_members` non archivés. Volontairement PAS
   * `organization_employee_count()`, qui retombe sur
   * `employee_count_override` : facturer un siège par ouvrier de
   * chantier ferait payer quarante licences à un paysagiste qui en
   * utilise trois.
   */
  compterSieges(organizationId: string): Promise<number>;
  lireModulesSouscrits(organizationId: string): Promise<string[]>;
  lireRemiseActive(organizationId: string, leJour: string): Promise<RemiseLue | null>;
  termesTarif(demande: DemandeTermes): Promise<TermesTarif>;
}

/**
 * Une ligne à encaisser chez le prestataire. `providerPriceId` est
 * TOUJOURS renseigné : une ligne sans tarif du prestataire n'est pas une
 * ligne, c'est un blocage.
 */
export type LigneSouscription = {
  nature: "plan" | "seat" | "module";
  moduleKey: string | null;
  libelle: string;
  quantite: number;
  /** HORS TAXES, en centimes entiers. */
  prixUnitaireHtCents: number;
  providerPriceId: string;
  devise: string;
};

/**
 * La remise appliquée, et ce qu'il faut pour en SORTIR.
 *
 * LE TREIZIÈME MOIS REPART AU TARIF PUBLIC : `ends_on` est NOT NULL en
 * base, il n'existe littéralement aucune remise perpétuelle. On porte
 * donc, avec la remise, la date de fin ET le tarif public de retour —
 * sans quoi le retour serait à recalculer ailleurs, et un calcul refait
 * est un calcul qui diverge.
 */
export type RemiseAppliquee = {
  code: string | null;
  label: string;
  /** Date ISO (AAAA-MM-JJ). Le tarif public reprend à partir de ce jour. */
  finLe: string;
  prixRemiseHtCents: number;
  prixPublicHtCents: number;
  /** Le tarif du prestataire à reprendre à la fin de la remise. */
  providerPricePublicId: string;
};

export type CompositionRefusee = {
  jouable: false;
  /** Le code brut, pour les tests et les journaux. */
  code: string;
  /** La phrase à afficher, telle quelle. */
  motif: string;
};

export type CompositionRetenue = {
  jouable: true;
  planKey: string;
  billingCycle: CycleFacturation;
  devise: string;
  lignes: LigneSouscription[];
  /** La somme HORS TAXES. Le montant PRÉLEVÉ, lui, dépend du régime de TVA. */
  totalHtCents: number;
  /**
   * Le nombre de sièges facturés. Rendu même à zéro : c'est le chiffre
   * que l'intégration doit recopier dans
   * `organization_subscriptions.billable_extra_seats`, sans quoi la
   * facture de 0081 (qui lit cette colonne, saisie à la main) et
   * l'encaissement du prestataire diraient deux choses différentes.
   */
  siegesFacturables: number;
  /** Les modules compris dans l'offre : aucune ligne, et c'est le point. */
  modulesInclusSansFrais: string[];
  remise: RemiseAppliquee | null;
};

export type Composition = CompositionRetenue | CompositionRefusee;

/**
 * Les motifs de blocage rendus par `billing_provider_price_terms()`,
 * traduits en phrases lisibles.
 *
 * POURQUOI UNE TABLE ET PAS UN `switch` : un motif inconnu doit
 * produire une phrase honnête et non une exception. Une base plus
 * récente que ce déploiement peut rendre un code que ce fichier n'a
 * jamais vu, et l'écran ne doit pas tomber pour ça.
 */
const MOTIFS: Record<string, string> = {
  providerUnknown:
    "Le prestataire de paiement demandé n'existe pas dans le catalogue. Aucun encaissement n'est possible.",
  providerNotRetained:
    "Ce prestataire de paiement n'est pas retenu. Aucun encaissement n'est possible par ce canal.",
  modeUnknown:
    "Le mode du prestataire (essai ou production) n'est pas déterminé. Une correspondance d'essai employée en production encaisserait zéro : on refuse plutôt que de deviner.",
  kindUnknown: "Nature de tarif inconnue.",
  billingCycleUnknown: "Le cycle de facturation doit être « au mois » ou « à l'année ».",
  planUnknown: "Cette offre n'existe pas.",
  planInactive: "Cette offre n'est plus proposée.",
  planIsQuoteOnly:
    "Cette offre se construit sur devis : elle ne se souscrit pas en ligne. Prenez contact et nous établissons votre proposition.",
  planMonthlyPriceUnknown:
    "Cette offre n'a pas de prix mensuel dans la grille. Un montant inconnu ne devient pas zéro parce qu'on l'a affiché : la souscription est refusée.",
  planYearlyPriceUnknown:
    "Cette offre n'a pas de prix annuel dans la grille. Choisissez l'abonnement au mois, ou attendez que le tarif annuel soit fixé.",
  seatYearlyPriceUndecided:
    "Le prix du siège supplémentaire est fixé au MOIS. Son équivalent annuel n'a pas été décidé : on ne l'invente pas. Basculez au mois, ou retirez les sièges supplémentaires.",
  seatMonthlyPriceUnknown: "Cette offre n'a pas de prix de siège supplémentaire.",
  moduleUnknown: "Ce module n'existe pas au catalogue.",
  moduleUnavailableOnPlan:
    "Ce module n'est pas disponible sur cette offre. Changez d'offre, ou retirez le module.",
  moduleUndecidedOnPlan:
    "La disponibilité de ce module sur cette offre n'a pas été arrêtée. On ne facture pas une case non décidée.",
  moduleNotDelivered: "Ce module n'est pas encore livré : il ne se souscrit pas, même annoncé.",
  moduleMonthlyPriceUnknown: "Ce module n'a pas de prix mensuel sur cette offre.",
  moduleYearlyPriceUnknown:
    "Ce module n'a pas de prix annuel sur cette offre. Choisissez l'abonnement au mois.",
  discountUnknown: "La remise portée par cet abonnement n'existe plus au catalogue.",
  discountClosed: "Cette remise est close : elle ne s'applique plus à une nouvelle souscription.",
  discountIsNotAFixedPrice:
    "Cette remise n'est pas un prix imposé : elle ne se transpose pas en tarif chez le prestataire.",
  discountYearlyUndecided:
    "La remise est libellée en prix MENSUEL et l'abonnement demandé est ANNUEL : son équivalent annuel n'a pas été décidé. Basculez l'abonnement au mois.",
  providerPriceMissing:
    "Aucun tarif ne correspond à cette ligne chez le prestataire de paiement. La correspondance doit être créée avant de pouvoir encaisser — on ne devine pas un montant.",
  amountDrift:
    "Le montant enregistré chez le prestataire ne correspond plus à notre grille. Encaisser reviendrait à facturer l'ancien prix : la souscription est refusée jusqu'à la mise à jour de la correspondance.",
  currencyDrift: "La devise enregistrée chez le prestataire ne correspond plus à notre grille.",
};

/** Motifs propres à ce fichier, sans équivalent en base. */
export const MOTIF_OFFRE_INTROUVABLE = "offreIntrouvable";
export const MOTIF_SIEGES_INCLUS_NON_DECIDES = "siegesInclusNonDecides";

export function phrasePourMotif(code: string): string {
  const phrase = MOTIFS[code];
  if (phrase !== undefined) return phrase;
  // Un code inconnu reste affichable : mieux vaut une phrase pauvre
  // qu'un écran blanc, et le code brut permet de retrouver la cause.
  return `La souscription est refusée pour un motif que cet écran ne sait pas encore expliquer (${code}).`;
}

function refus(code: string, motif?: string): CompositionRefusee {
  return { jouable: false, code, motif: motif ?? phrasePourMotif(code) };
}

/**
 * Le jour de référence, au format ISO court, en heure de Paris.
 *
 * POURQUOI PAS `new Date().toISOString().slice(0, 10)` : à 23 h 30 en
 * France, l'UTC est déjà le lendemain l'été. Une remise qui court
 * « jusqu'au 31 » cesserait alors une soirée trop tôt pour qui souscrit
 * tard, et le client verrait le tarif public là où il attend la remise.
 */
export function jourDeReference(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

export type DemandeComposition = {
  organizationId: string;
  planKey: string;
  billingCycle: CycleFacturation;
  /**
   * Les modules VOULUS en plus de ceux déjà souscrits. Une clé déjà
   * comprise dans l'offre ne coûte rien : c'est la matrice qui tranche,
   * pas cette liste.
   */
  modulesVoulus?: string[];
  /** Injecté par les tests ; par défaut, aujourd'hui à Paris. */
  leJour?: string;
};

/**
 * CE QUI EST DÛ, ET RIEN D'AUTRE.
 *
 * L'ordre des étapes n'est pas indifférent : on écarte d'abord ce qui
 * rend le reste sans objet (offre inexistante, offre sur devis), puis on
 * bâtit ligne à ligne. Un seul blocage suffit à refuser l'ensemble —
 * encaisser une souscription amputée d'une de ses lignes serait pire
 * qu'un refus, parce que le client paierait en croyant avoir tout.
 */
export async function composerSouscription(
  demande: DemandeComposition,
  source: SourceFacturation,
): Promise<Composition> {
  const { organizationId, planKey, billingCycle } = demande;
  const leJour = demande.leJour ?? jourDeReference();

  // ---- 1. L'offre ------------------------------------------------
  const offre = await source.lireOffre(planKey);
  if (offre === null) {
    return refus(MOTIF_OFFRE_INTROUVABLE, phrasePourMotif("planUnknown"));
  }
  if (!offre.isActive) return refus("planInactive");

  // « SUR DEVIS » NE SE SOUSCRIT PAS, et on le refuse ICI — avant
  // l'encaissement. Le déclencheur `organization_subscriptions_plan_guard`
  // de 0081 le refuserait aussi, mais APRÈS : l'argent serait déjà pris.
  if (offre.isQuoteOnly) return refus("planIsQuoteOnly");

  const lignes: LigneSouscription[] = [];

  // ---- 2. La ligne d'offre ---------------------------------------
  const termesOffre = await source.termesTarif({ kind: "plan", planKey, billingCycle });
  if (termesOffre.blockingReason !== null || termesOffre.providerPriceId === null) {
    return refus(termesOffre.blockingReason ?? "providerPriceMissing");
  }
  const devise = termesOffre.currency ?? offre.currency;
  const prixPublicHtCents = termesOffre.ourAmountCents;
  if (prixPublicHtCents === null) {
    // Défense : 0083 ne rend jamais ce cas sans motif. S'il arrivait, un
    // prix absent ne doit pas devenir zéro par distraction.
    return refus("providerPriceMissing");
  }

  // ---- 3. La remise, qui SUBSTITUE le prix de l'offre -------------
  //
  // Une remise « prix mensuel imposé » n'est pas une ligne négative :
  // c'est un PRIX QUI REMPLACE celui de l'offre (0081 : « ce n'est pas
  // une réduction en pourcentage, c'est un prix qui se substitue »). On
  // ne pose donc pas deux lignes qui s'annulent à moitié — chez un
  // prestataire de paiement, une ligne négative n'existe pas.
  const remiseLue = await source.lireRemiseActive(organizationId, leJour);
  let remise: RemiseAppliquee | null = null;
  let prixOffreHtCents = prixPublicHtCents;
  let providerPriceOffre = termesOffre.providerPriceId;
  let libelleOffre = `${offre.name} — ${
    billingCycle === "yearly" ? "abonnement annuel" : "abonnement mensuel"
  }`;

  if (remiseLue !== null && remiseLue.kind === "fixedMonthlyPrice") {
    const termesRemise = await source.termesTarif({
      kind: "discount",
      billingCycle,
      discountCode: remiseLue.code,
    });
    if (termesRemise.blockingReason !== null || termesRemise.providerPriceId === null) {
      // On REFUSE plutôt que d'ignorer la remise : encaisser le tarif
      // public à quelqu'un à qui une remise a été accordée, c'est le
      // faire payer trop, et il ne s'en apercevra qu'au relevé.
      return refus(termesRemise.blockingReason ?? "providerPriceMissing");
    }
    if (termesRemise.ourAmountCents === null) return refus("providerPriceMissing");

    remise = {
      code: remiseLue.code,
      label: remiseLue.label,
      finLe: remiseLue.endsOn,
      prixRemiseHtCents: termesRemise.ourAmountCents,
      prixPublicHtCents,
      // LE RETOUR AU TARIF PUBLIC EST PORTÉ DÈS MAINTENANT. Sans cette
      // clé, personne ne saurait à quel tarif revenir au treizième mois
      // sans refaire tout ce calcul.
      providerPricePublicId: termesOffre.providerPriceId,
    };
    prixOffreHtCents = termesRemise.ourAmountCents;
    providerPriceOffre = termesRemise.providerPriceId;
    libelleOffre = `${offre.name} — ${remiseLue.label}, jusqu'au ${remiseLue.endsOn}`;
  } else if (remiseLue !== null) {
    // Un pourcentage ou une remise en valeur n'est pas un TARIF chez le
    // prestataire : c'est un coupon, un autre objet, et 0083 ne lui a
    // pas fait de place. On refuse au lieu d'encaisser le tarif plein.
    return refus("discountIsNotAFixedPrice");
  }

  lignes.push({
    nature: "plan",
    moduleKey: null,
    libelle: libelleOffre,
    quantite: 1,
    prixUnitaireHtCents: prixOffreHtCents,
    providerPriceId: providerPriceOffre,
    devise,
  });

  // ---- 4. Les sièges ----------------------------------------------
  //
  // max(0, utilisateurs − sièges inclus). L'ÉGALITÉ NE FACTURE RIEN :
  // un `>=` mal placé ferait payer un siège à chaque entreprise pile à
  // son plafond, et personne ne le verrait avant la première facture.
  let siegesFacturables = 0;
  if (offre.seatPolicy === "billedBeyondIncluded") {
    if (offre.includedSeats === null) {
      // NULL VEUT DIRE « NON DÉCIDÉ », pas « zéro » — 0081 l'écrit noir
      // sur blanc. Facturer depuis un seuil inconnu, ce serait inventer
      // le seuil ; ne rien facturer, ce serait offrir tous les sièges en
      // silence. On refuse, et le motif dit quoi faire.
      return refus(
        MOTIF_SIEGES_INCLUS_NON_DECIDES,
        `Le nombre de sièges compris dans l'offre « ${offre.name} » n'a pas été fixé. Tant qu'il ne l'est pas, on ne sait pas à partir de quel utilisateur facturer : la souscription en ligne est refusée plutôt que d'inventer un seuil.`,
      );
    }
    const utilisateurs = await source.compterSieges(organizationId);
    siegesFacturables = Math.max(0, utilisateurs - offre.includedSeats);
  }
  // `hardCap` ne facture AUCUN siège au-delà : le plafond est un
  // plafond, pas un compteur. On ne pose donc pas de ligne, et on ne
  // bloque pas non plus sur un `included_seats` absent.

  if (siegesFacturables > 0) {
    const termesSiege = await source.termesTarif({ kind: "seat", planKey, billingCycle });
    if (termesSiege.blockingReason !== null || termesSiege.providerPriceId === null) {
      return refus(termesSiege.blockingReason ?? "providerPriceMissing");
    }
    if (termesSiege.ourAmountCents === null) return refus("providerPriceMissing");

    lignes.push({
      nature: "seat",
      moduleKey: null,
      libelle: `Sièges supplémentaires (${siegesFacturables})`,
      quantite: siegesFacturables,
      prixUnitaireHtCents: termesSiege.ourAmountCents,
      providerPriceId: termesSiege.providerPriceId,
      devise,
    });
  }

  // ---- 5. Les modules, arbitrés par LA MATRICE --------------------
  //
  // Le prix d'un module ne vit ni sur le module, ni sur l'abonnement :
  // il vit sur la CASE offre × module. Une entreprise Business qui
  // souscrit BioLab ne génère aucune ligne — il est compris — et la même
  // entreprise en Pro en génère une à 20 €. Le passage de Pro à Business
  // fait donc disparaître la ligne sans qu'on touche à quoi que ce soit
  // ici : c'est la matrice qui a changé de réponse, pas le code.
  const souscrits = await source.lireModulesSouscrits(organizationId);
  const voulus = demande.modulesVoulus ?? [];
  const modules = [...new Set([...souscrits, ...voulus])].sort();

  const modulesInclusSansFrais: string[] = [];
  for (const moduleKey of modules) {
    const termesModule = await source.termesTarif({
      kind: "module",
      planKey,
      billingCycle,
      moduleKey,
    });

    if (termesModule.blockingReason === "moduleIncludedInPlan") {
      // « Inclus » N'EST PAS UNE ERREUR : c'est la matrice qui fait son
      // travail. On n'encaisse rien, et on le dit à l'écran plutôt que
      // de laisser croire que le module a été oublié.
      modulesInclusSansFrais.push(moduleKey);
      continue;
    }

    if (termesModule.blockingReason !== null || termesModule.providerPriceId === null) {
      return refus(termesModule.blockingReason ?? "providerPriceMissing");
    }
    if (termesModule.ourAmountCents === null) return refus("providerPriceMissing");

    lignes.push({
      nature: "module",
      moduleKey,
      libelle: `Module ${moduleKey}`,
      quantite: 1,
      prixUnitaireHtCents: termesModule.ourAmountCents,
      providerPriceId: termesModule.providerPriceId,
      devise,
    });
  }

  // ---- 6. Le total -------------------------------------------------
  //
  // En centimes ENTIERS, additionnés en entiers. Aucun flottant n'entre
  // ici : `0.1 + 0.2` vaut `0.30000000000000004`, et c'est ainsi qu'une
  // facture finit par afficher un centime qui n'existe pas.
  const totalHtCents = lignes.reduce(
    (somme, ligne) => somme + ligne.quantite * ligne.prixUnitaireHtCents,
    0,
  );

  return {
    jouable: true,
    planKey,
    billingCycle,
    devise,
    lignes,
    totalHtCents,
    siegesFacturables,
    modulesInclusSansFrais,
    remise,
  };
}
