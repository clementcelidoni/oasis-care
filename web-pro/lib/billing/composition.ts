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
 * Les LIGNES de ce fichier sont HORS TAXES, en CENTIMES ENTIERS. Mais
 * le montant PRÉLEVÉ ne l'est pas, et la distinction est le cœur du
 * sujet : une entreprise française règle 95,88 pour 79,90 HT, une
 * entreprise de l'Union avec numéro validé règle 79,90
 * (autoliquidation), hors Union 79,90 aussi. Le PRIX est le même
 * partout ; c'est le MONTANT PRÉLEVÉ qui change.
 *
 * LA RÈGLE DE TAXE N'EST PAS ÉCRITE ICI POUR AUTANT. C'est
 * `saas_vat_regime_compute()` qui décide du régime (france /
 * euReverseCharge / outsideEu / unknown) et `billing_provider_tax_terms()`
 * qui rend l'objet de taxe à appliquer ; ce fichier ne fait
 * qu'APPLIQUER le taux qu'on lui donne, en entiers. Un régime
 * « unknown » ne devient jamais 0 % : il refuse la souscription.
 *
 * Le moteur de taxe automatique du prestataire, lui, reste éteint —
 * d'où `tax_behavior = 'exclusive'` verrouillé sur chaque tarif par
 * 0083. Deux moteurs de taxe sur la même transaction, ce sont deux
 * vérités et un jour un écart.
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
  /**
   * L'OFFRE À LAQUELLE CETTE REMISE EST RÉSERVÉE. NULL = toutes les
   * offres.
   *
   * 0081 la RECOPIE sur la remise accordée plutôt que de la lire au
   * catalogue, et le commentaire de la migration dit pourquoi : `code`
   * est en `on delete set null`, donc une ligne de catalogue supprimée
   * ferait perdre à la remise toute trace de l'offre à laquelle elle
   * était réservée, et elle deviendrait universelle sans erreur ni
   * trace. On lit donc la copie, pas l'original.
   */
  appliesToPlan: string | null;
  /**
   * La date jusqu'à laquelle le client NE PEUT PAS PARTIR. Nulle quand
   * la remise n'engage à rien.
   *
   * ELLE EST ICI PARCE QU'ELLE EST LISIBLE PAR LE CLIENT, et que le
   * catalogue des offres engageantes, lui, ne l'est pas. C'est ce qui
   * permet au tunnel de savoir qu'une souscription ENGAGE même quand il
   * ne peut pas lire l'annonce à afficher — et donc de refuser plutôt
   * que d'encaisser douze mois en silence.
   */
  commitmentEndsOn: string | null;
};

/**
 * Ce que rend `billing_provider_tax_terms()` — la fonction de 0083 qui,
 * comme sa voisine des tarifs, NE LÈVE JAMAIS pour un cas commercial.
 */
export type TermesTaxe = {
  regime: "france" | "euReverseCharge" | "outsideEu" | "unknown" | null;
  /**
   * Le taux en POINTS DE BASE (2000 = 20,00 %), donc un ENTIER.
   *
   * Surtout pas un flottant : la TVA se calcule en centimes entiers, et
   * `0.1 + 0.2` vaut `0.30000000000000004`. C'est ainsi qu'une facture
   * finit par afficher un centime qui n'existe pas.
   */
  tauxBps: number | null;
  /** L'objet de taxe chez le prestataire. NUL quand le taux vaut zéro. */
  providerTaxRateId: string | null;
  blockingReason: string | null;
  /** Le motif écrit par la base, quand elle en donne un. */
  reason: string | null;
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
  /**
   * LE RÉGIME DE TVA DU CLIENT, ET L'OBJET DE TAXE À APPLIQUER.
   *
   * Nos prix sont hors taxes ; le montant PRÉLEVÉ ne l'est pas. Sans
   * cette lecture, le prestataire encaisserait 79,90 € là où la facture
   * en réclame 95,88 — et les 15,98 € de TVA française ne seraient
   * jamais collectés, alors qu'Oasis Care en reste redevable.
   */
  lireTermesTaxe(organizationId: string): Promise<TermesTaxe>;
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
  /**
   * LA DATE JUSQU'À LAQUELLE LE CLIENT NE PEUT PAS PARTIR, ou `null`
   * quand la remise n'engage à rien.
   *
   * ELLE EST PORTÉE ICI PARCE QU'ELLE EST LA SEULE PREUVE D'ENGAGEMENT
   * QUE LE CLIENT PUISSE LIRE. Le catalogue des offres engageantes
   * (`discount_offers`) est réservé aux administrateurs ; la remise
   * ACCORDÉE, elle, est visible par le membre de l'entreprise. Faire
   * dépendre le verrou d'engagement du catalogue le rendait donc
   * silencieusement inopérant côté client — exactement là où il
   * comptait.
   */
  engageJusquAu: string | null;
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
  /**
   * CE QUI SERA RÉELLEMENT PRÉLEVÉ, et pourquoi ce n'est pas le total
   * hors taxes.
   *
   * Le PRIX est le même pour tout le monde ; le MONTANT PRÉLEVÉ change
   * avec le régime du client. Une entreprise française règle 95,88 pour
   * 79,90 HT ; une entreprise de l'Union avec numéro validé règle 79,90
   * (autoliquidation) ; hors Union, 79,90 aussi. Confondre les deux,
   * c'est soit ne pas collecter une taxe dont on reste redevable, soit
   * en faire payer une qui n'est pas due.
   */
  taxe: TaxeAppliquee;
};

/** La taxe retenue pour CETTE souscription, et ce qu'elle change. */
export type TaxeAppliquee = {
  regime: "france" | "euReverseCharge" | "outsideEu";
  /** Points de base : 2000 = 20,00 %. Entier. */
  tauxBps: number;
  /** L'objet de taxe du prestataire. NUL quand le taux vaut zéro. */
  providerTaxRateId: string | null;
  /** En centimes entiers. Zéro en autoliquidation et hors Union. */
  montantTvaCents: number;
  /** HT + TVA. C'est CE nombre qui apparaîtra sur le relevé bancaire. */
  totalTtcCents: number;
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
  discountReservedToAnotherPlan:
    "Le tarif préférentiel dont vous bénéficiez est réservé à une autre offre que celle-ci. Changer d'offre y mettrait fin : parlons-en avant, plutôt que de vous le faire perdre en cliquant.",
  discountPlanUnspecified:
    "Le tarif préférentiel dont vous bénéficiez est réservé à une offre précise, et cette demande ne dit pas laquelle. On ne l'applique pas au hasard.",
  vatRegimeUnknown:
    "Votre régime de TVA n'est pas déterminé, et il commande le montant qui sera prélevé. Pour une entreprise de l'Union européenne hors France, il faut que votre numéro de TVA intracommunautaire soit renseigné puis validé. Écrivez-nous : nous le validons et la souscription s'ouvre.",
  vatRateUnknown:
    "Aucun taux de TVA n'est enregistré pour votre pays. On ne devine pas un taux : la souscription est refusée jusqu'à ce qu'il soit fixé.",
  providerTaxRateMissing:
    "La TVA applicable à votre pays n'est pas encore reliée chez le prestataire de paiement. Encaisser sans elle reviendrait à ne pas collecter la taxe : la souscription est refusée jusqu'à la mise en place.",
  taxRateDrift:
    "Le taux de TVA enregistré chez le prestataire ne correspond plus au nôtre. Encaisser reviendrait à appliquer l'ancien taux : la souscription est refusée jusqu'à la mise à jour de la correspondance.",
  providerPriceMissing:
    "Aucun tarif ne correspond à cette ligne chez le prestataire de paiement. La correspondance doit être créée avant de pouvoir encaisser — on ne devine pas un montant.",
  amountDrift:
    "Le montant enregistré chez le prestataire ne correspond plus à notre grille. Encaisser reviendrait à facturer l'ancien prix : la souscription est refusée jusqu'à la mise à jour de la correspondance.",
  currencyDrift: "La devise enregistrée chez le prestataire ne correspond plus à notre grille.",
};

/** Motifs propres à ce fichier, sans équivalent en base. */
export const MOTIF_OFFRE_INTROUVABLE = "offreIntrouvable";
export const MOTIF_SIEGES_INCLUS_NON_DECIDES = "siegesInclusNonDecides";
export const MOTIF_REMISE_AUTRE_OFFRE = "remiseReserveeAUneAutreOffre";
export const MOTIF_TAXE_INDETERMINEE = "taxeIndeterminee";

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

  // LA REMISE RÉSERVÉE À UNE OFFRE NE DÉBORDE PAS SUR LES AUTRES, et le
  // contrôle vient AVANT toute substitution.
  //
  // Le tarif fondateur vaut 49,90 € et 0081 le réserve à l'offre Pro.
  // Sans ce contrôle il se substituait au prix de N'IMPORTE QUELLE offre
  // demandée, dans les deux sens : sur Pro Business (139,90 €) on
  // encaissait 49,90, soit 90 € offerts par mois et par client ; sur Pro
  // Solo (39,90 €) on encaissait 49,90, soit 10 € DE PLUS que le tarif
  // public, sous une ligne libellée « Tarif fondateur ».
  //
  // ON REFUSE, ON N'IGNORE PAS. Ignorer la remise ferait payer le tarif
  // plein à quelqu'un à qui une remise a été accordée — c'est le cas
  // voisin que ce fichier refuse déjà quelques lignes plus bas, et il
  // n'y a pas de raison de le traiter autrement ici.
  if (remiseLue !== null && remiseLue.appliesToPlan !== null && remiseLue.appliesToPlan !== planKey) {
    return refus(MOTIF_REMISE_AUTRE_OFFRE, phrasePourMotif("discountReservedToAnotherPlan"));
  }

  if (remiseLue !== null && remiseLue.kind === "fixedMonthlyPrice") {
    const termesRemise = await source.termesTarif({
      kind: "discount",
      // L'OFFRE VOYAGE JUSQU'À LA BASE. Sans elle,
      // `billing_provider_price_terms` ne peut pas vérifier la
      // restriction de son côté, et la garde ne tiendrait que dans ce
      // fichier — donc seulement tant que ce fichier est le seul
      // appelant.
      planKey,
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
      engageJusquAu: remiseLue.commitmentEndsOn,
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

  // ---- 7. LA TAXE, ET CE QUI SERA VRAIMENT PRÉLEVÉ -----------------
  //
  // Elle vient EN DERNIER parce qu'elle s'applique au total, mais elle
  // n'est pas un ornement : sans elle, le prestataire encaisse le hors
  // taxes nu. Une entreprise française serait débitée de 79,90 € quand
  // sa facture en réclame 95,88 — la TVA ne serait jamais collectée, la
  // facture resterait éternellement impayée de son montant, et le
  // rapprochement du webhook ne trouverait jamais de facture
  // correspondante.
  const termesTaxe = await source.lireTermesTaxe(organizationId);
  if (termesTaxe.blockingReason !== null) {
    // Le motif de la base est plus précis que le nôtre quand il en
    // porte un — « votre numéro n'est pas validé » vaut mieux que
    // « régime inconnu ».
    return refus(
      termesTaxe.blockingReason,
      termesTaxe.blockingReason === "vatRegimeUnknown" && termesTaxe.reason !== null
        ? `${phrasePourMotif("vatRegimeUnknown")} (${termesTaxe.reason})`
        : phrasePourMotif(termesTaxe.blockingReason),
    );
  }
  if (
    termesTaxe.regime === null
    || termesTaxe.regime === "unknown"
    || termesTaxe.tauxBps === null
  ) {
    // Défense : 0083 ne rend jamais ce cas sans motif. S'il arrivait, un
    // régime absent ne doit pas devenir « 0 % » par distraction — ce
    // serait de la TVA non collectée dont Oasis Care reste redevable.
    return refus(MOTIF_TAXE_INDETERMINEE, phrasePourMotif("vatRegimeUnknown"));
  }

  // EN ENTIERS, DU DÉBUT À LA FIN. Le taux est en points de base, donc
  // `7990 × 2000 / 10000` — jamais `7990 × 0.2`, qui ferait entrer un
  // flottant dans un calcul de monnaie. Même arrondi que
  // `saas_invoice_totals` de 0081 (`round(base * vat_rate / 100.0)`),
  // sans quoi l'encaissement et la facture différeraient d'un centime.
  const montantTvaCents = Math.round((totalHtCents * termesTaxe.tauxBps) / 10000);

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
    taxe: {
      regime: termesTaxe.regime,
      tauxBps: termesTaxe.tauxBps,
      providerTaxRateId: termesTaxe.providerTaxRateId,
      montantTvaCents,
      totalTtcCents: totalHtCents + montantTvaCents,
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// LE RÉSUMÉ, TEL QU'IL PART AU NAVIGATEUR
// ══════════════════════════════════════════════════════════════════

/**
 * Une ligne du résumé. Elle porte le total de la ligne CALCULÉ AU
 * SERVEUR : laisser le navigateur multiplier la quantité par le prix
 * unitaire, c'est accepter qu'il affiche autre chose que ce qui sera
 * prélevé, et l'écart ne se verrait qu'au relevé bancaire.
 */
export type LigneResume = {
  nature: "plan" | "seat" | "module";
  moduleKey: string | null;
  libelle: string;
  quantite: number;
  /** HORS TAXES, en centimes entiers. */
  prixUnitaireHtCents: number;
  /** HORS TAXES, en centimes entiers. */
  totalLigneHtCents: number;
};

export type ResumeSouscription =
  | {
      jouable: true;
      planKey: string;
      billingCycle: CycleFacturation;
      devise: string;
      lignes: LigneResume[];
      totalHtCents: number;
      /**
       * « HT ». Elle voyage AVEC le montant et n'est pas laissée au
       * gabarit d'affichage : un prix hors taxes montré sans sa mention
       * à un professionnel est une pratique commerciale trompeuse, et
       * une mention écrite en dur dans un écran finit par manquer au
       * deuxième écran.
       */
      mentionPrix: "HT";
      siegesFacturables: number;
      modulesInclusSansFrais: string[];
      remise: {
        code: string | null;
        label: string;
        finLe: string;
        prixRemiseHtCents: number;
        prixPublicHtCents: number;
        /**
         * La date de fin d'ENGAGEMENT, distincte de la fin de REMISE.
         * Elles coïncident sur le tarif fondateur ; rien ne garantit
         * qu'une remise future fera de même.
         */
        engageJusquAu: string | null;
      } | null;
      /**
       * CE QUI SERA DÉBITÉ, et il faut le montrer.
       *
       * Découvrir au relevé bancaire que 79,90 € annoncés sont devenus
       * 95,88 € est la première cause de contestation. L'écart n'est
       * pas une surprise : c'est la TVA, elle est légitime, et il n'y a
       * aucune raison de la cacher jusqu'au prélèvement.
       */
      taxe: {
        regime: "france" | "euReverseCharge" | "outsideEu";
        tauxBps: number;
        montantTvaCents: number;
        totalTtcCents: number;
      };
    }
  | { jouable: false; code: string; motif: string };

/**
 * CE QUI A LE DROIT DE SORTIR DU SERVEUR.
 *
 * L'identifiant de tarif du prestataire (`price_…`) est RETIRÉ. Il n'est
 * pas secret — il voyage avec la clé publiable dans une intégration
 * classique — mais l'exposer ici inviterait un jour quelqu'un à le
 * renvoyer au serveur, et le serveur à s'en servir. Le montant fait foi
 * côté serveur : le navigateur n'a besoin de rien pour l'afficher.
 */
export function versResumePublic(composition: Composition): ResumeSouscription {
  if (!composition.jouable) {
    return { jouable: false, code: composition.code, motif: composition.motif };
  }

  return {
    jouable: true,
    planKey: composition.planKey,
    billingCycle: composition.billingCycle,
    devise: composition.devise,
    lignes: composition.lignes.map((ligne) => ({
      nature: ligne.nature,
      moduleKey: ligne.moduleKey,
      libelle: ligne.libelle,
      quantite: ligne.quantite,
      prixUnitaireHtCents: ligne.prixUnitaireHtCents,
      totalLigneHtCents: ligne.quantite * ligne.prixUnitaireHtCents,
    })),
    totalHtCents: composition.totalHtCents,
    mentionPrix: "HT",
    siegesFacturables: composition.siegesFacturables,
    modulesInclusSansFrais: composition.modulesInclusSansFrais,
    remise:
      composition.remise === null
        ? null
        : {
            code: composition.remise.code,
            label: composition.remise.label,
            finLe: composition.remise.finLe,
            prixRemiseHtCents: composition.remise.prixRemiseHtCents,
            prixPublicHtCents: composition.remise.prixPublicHtCents,
            engageJusquAu: composition.remise.engageJusquAu,
          },
    // L'IDENTIFIANT DE L'OBJET DE TAXE EST RETIRÉ, pour la même raison
    // que celui du tarif : le navigateur n'en a pas besoin pour
    // afficher un montant, et l'exposer inviterait un jour quelqu'un à
    // le renvoyer au serveur.
    taxe: {
      regime: composition.taxe.regime,
      tauxBps: composition.taxe.tauxBps,
      montantTvaCents: composition.taxe.montantTvaCents,
      totalTtcCents: composition.taxe.totalTtcCents,
    },
  };
}
