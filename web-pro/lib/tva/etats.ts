/**
 * §TVA — CE QUE L'ÉCRAN DIT, ÉTAT PAR ÉTAT.
 *
 * ══════════════════════════════════════════════════════════════════
 * QUATRE SITUATIONS, QUATRE PHRASES
 * ══════════════════════════════════════════════════════════════════
 *
 * Un écran qui dirait « numéro non validé » dans les quatre cas
 * mentirait trois fois sur quatre. Ce ne sont pas des nuances : ce sont
 * quatre gestes différents attendus de quatre personnes différentes.
 *
 *   EN COURS       personne n'a rien à faire. La vérification part
 *                  toute seule, l'inscription ne l'attend pas.
 *   VÉRIFIÉ LE …   personne n'a rien à faire non plus, et il faut le
 *                  dire aussi — un client qui ne voit rien croit que
 *                  rien n'a été fait.
 *   PAS RECONNU    LE CLIENT doit agir : relire sa saisie, ou appeler
 *                  son administration. Personne ne réessaiera pour lui,
 *                  et c'est délibéré (0089 § 7.e).
 *   INDISPONIBLE   NOUS réessayons. Le client n'a rien à corriger, et
 *                  surtout : son numéro n'est pas en cause. Lui laisser
 *                  croire le contraire lui ferait modifier un numéro
 *                  parfaitement juste.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE DÉCIDE D'AUCUN RÉGIME NI D'AUCUN TAUX
 * ══════════════════════════════════════════════════════════════════
 *
 * `saas_vat_regime_compute()` (0081, remaniée par 0089 § 7.g) reste la
 * seule autorité sur le régime applicable. Ce fichier-ci ne fait que
 * RACONTER l'état de la vérification à celui qui s'inscrit. Il ne
 * calcule pas de TVA, il n'autorise rien, et il ne débloque aucune
 * facture : il traduit.
 *
 * `bloqueLaFacture` n'est donc PAS une décision prise ici. C'est le
 * reflet, à l'écran, de ce que la base fera de toute façon — dit
 * d'avance, pour que la surprise n'arrive pas au moment de payer.
 *
 * AUCUN APPEL RÉSEAU, AUCUNE LECTURE DE BASE : tout est pur, tout est
 * testable, et la même fonction sert à l'écran d'inscription comme à
 * l'écran d'administration.
 */

import type { EtatVies } from "./vies.ts";

// ==================================================================
// CE QUI ENTRE
// ==================================================================

/**
 * La zone fiscale, telle que `zoneFiscale()` de
 * `app/inscription/identite.ts` la calcule.
 *
 * ELLE EST PASSÉE EN PARAMÈTRE, ET CE N'EST PAS UN OUBLI. La liste des
 * vingt-sept est déjà tenue à deux endroits qui font autorité :
 * `saas_eu_countries` en base, et `PAYS_UNION` dans `identite.ts` pour
 * savoir quel champ demander. En recopier une troisième ici, dans une
 * bibliothèque, garantissait qu'un élargissement de l'Union soit
 * appliqué à deux endroits sur trois.
 */
export type ZoneFiscaleTva = "france" | "unionEuropeenne" | "horsUnion";

/**
 * La ligne de `saas_customer_tax_profiles`, réduite à ce qui se raconte.
 *
 * Les noms sont ceux des colonnes, en camel : la correspondance doit
 * pouvoir se relire d'un coup d'œil quand une colonne change de nom.
 */
export type ProfilTvaLu = {
  viesStatus: EtatVies | null;
  vatNumberValidatedAt: string | null;
  validationSource: "vies" | "manual" | "document" | null;
  viesLastAttemptAt: string | null;
  viesNextAttemptAt: string | null;
  viesAttempts: number;
  viesLastError: string | null;
  viesConsultationNumber: string | null;
  /**
   * LE NUMÉRO TEL QU'IL A ÉTÉ INTERROGÉ. Sans lui, changer son numéro
   * de TVA laisserait la validation de l'ANCIEN valoir pour le NOUVEAU.
   * C'est le trou que 0089 a refermé en base ; l'écran le referme aussi,
   * sinon il afficherait « vérifié le 3 mars » devant un numéro saisi
   * le 5.
   */
  vatNumberChecked: string | null;
};

export type EntreeEtatTva = {
  zone: ZoneFiscaleTva;
  /** Le numéro ACTUELLEMENT enregistré sur la fiche de l'entreprise. */
  numero: string | null;
  /** `null` quand aucune ligne n'existe encore : rien n'a jamais été demandé. */
  profil: ProfilTvaLu | null;
  /** Injectable pour que les tests ne dépendent pas de l'heure qu'il est. */
  maintenant?: Date;
};

// ==================================================================
// CE QUI SORT
// ==================================================================

export type CodeEtatTva =
  /** Numéro français : contrôlé hors ligne depuis le SIREN, jamais par VIES. */
  | "france"
  /** Hors de l'Union : VIES n'a rien à en dire. */
  | "horsUnion"
  /** Dans l'Union, mais aucun numéro saisi. */
  | "absent"
  /** Dans la file : jamais interrogé, ou numéro modifié depuis le dernier contrôle. */
  | "enCours"
  | "valide"
  | "refuse"
  | "indisponible";

export type TonEtatTva = "neutre" | "attente" | "succes" | "faute";

export type EtatValidationTva = {
  code: CodeEtatTva;
  ton: TonEtatTva;
  /** La phrase principale. Elle s'adresse au paysagiste, jamais à un développeur. */
  titre: string;
  /** Ce qu'il faut en faire — ou l'assurance qu'il n'y a rien à faire. */
  detail: string | null;
  /**
   * L'émission de la première facture attend-elle cette vérification ?
   * Constat, pas décision : c'est `saas_issue_invoice()` qui refuse.
   */
  bloqueLaFacture: boolean;
};

// ==================================================================
// LES DATES
// ==================================================================

/**
 * Une date écrite comme un francophone l'écrit, à l'heure de Paris.
 *
 * L'HEURE DE PARIS ET NON L'UTC : « nouvel essai le 12/03 à 00:30 »
 * affiché à un client français alors que l'essai est prévu à 01:30
 * heure locale, c'est une heure fausse une moitié de l'année. Le reste
 * du produit prend déjà Paris pour référence (`jourDeReference()`).
 */
export function formaterDateFr(iso: string | null, avecHeure = false): string | null {
  if (iso === null || iso.trim() === "") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  // ON ASSEMBLE LA PHRASE SOI-MÊME PLUTÔT QUE DE LA LAISSER À `format()`.
  // Le séparateur qu'`Intl` glisse entre la date et l'heure change d'une
  // version d'ICU à l'autre — virgule ici, espace ailleurs — et le
  // premier test écrit dessus s'est cassé pour cette seule raison. Les
  // MORCEAUX, eux, sont stables : on prend ceux-là et on écrit le
  // français à la main.
  const format = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(avecHeure ? ({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const) : {}),
  });

  const morceaux = new Map(format.formatToParts(date).map((part) => [part.type, part.value]));
  const jour = `${morceaux.get("day") ?? ""}/${morceaux.get("month") ?? ""}/${morceaux.get("year") ?? ""}`;
  if (!avecHeure) return jour;
  return `${jour} à ${morceaux.get("hour") ?? ""}:${morceaux.get("minute") ?? ""}`;
}

function normaliser(numero: string | null | undefined): string {
  return (numero ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ==================================================================
// LA TRADUCTION
// ==================================================================

/**
 * L'état de la vérification, tel qu'il se raconte.
 *
 * L'ORDRE DES CAS EST LA MOITIÉ DU SENS, et il se lit de haut en bas :
 * la zone d'abord (elle décide s'il y a seulement une question), le
 * numéro ensuite, puis la fraîcheur du contrôle, et le verdict en
 * dernier. Remonter le verdict ferait afficher « vérifié » pour un
 * numéro qui a changé depuis.
 */
export function etatValidationTva(entree: EntreeEtatTva): EtatValidationTva {
  const numero = normaliser(entree.numero);
  const profil = entree.profil;

  // ---- 1. LA FRANCE NE PASSE PAS PAR VIES ------------------------
  // Le régime est « france » à 20 %, et la clé du numéro se recalcule
  // hors ligne depuis le SIREN. Interroger le registre européen pour un
  // client français, c'est attendre une réponse dont on n'a pas besoin.
  if (entree.zone === "france") {
    return {
      code: "france",
      ton: "neutre",
      titre: "Numéro de TVA français : rien à vérifier auprès du registre européen.",
      detail:
        "Sa clé de contrôle se recalcule depuis votre SIREN, et elle a déjà été contrôlée à la saisie. Votre TVA est la TVA française, à 20 %.",
      bloqueLaFacture: false,
    };
  }

  // ---- 2. HORS DE L'UNION ---------------------------------------
  if (entree.zone === "horsUnion") {
    return {
      code: "horsUnion",
      ton: "neutre",
      titre: "Votre entreprise est hors de l'Union européenne : la facture est établie sans TVA.",
      detail: "Aucune vérification auprès du registre européen n'est nécessaire.",
      bloqueLaFacture: false,
    };
  }

  // ---- 3. DANS L'UNION, SANS NUMÉRO ------------------------------
  if (numero === "") {
    return {
      code: "absent",
      ton: "faute",
      titre: "Votre numéro de TVA intracommunautaire n'est pas renseigné.",
      detail:
        "Hors de France mais dans l'Union, la facture s'établit en autoliquidation : elle doit porter votre numéro. Sans lui, elle ne peut pas être émise.",
      bloqueLaFacture: true,
    };
  }

  // ---- 4. LE NUMÉRO A-T-IL CHANGÉ DEPUIS LE CONTRÔLE ? -----------
  //
  // CE TEST PASSE AVANT LE VERDICT, ET C'EST TOUT SON INTÉRÊT. Un
  // verdict porte sur le numéro qui a été interrogé, pas sur celui qui
  // est affiché à côté. `saas_vies_enqueue()` efface d'ailleurs
  // l'ancienne validation dès l'enregistrement de la fiche ; l'écran
  // dit la même chose, et il la dit même dans le court instant où la
  // base n'a pas encore été prévenue.
  //
  // `vatNumberChecked` à null ne déclenche RIEN : c'est le cas d'une
  // validation posée à la main par un administrateur, qui n'a jamais
  // interrogé personne. La traiter comme un changement afficherait « en
  // cours » sur une validation parfaitement volontaire.
  const controleObsolete =
    profil !== null &&
    profil.vatNumberChecked !== null &&
    normaliser(profil.vatNumberChecked) !== numero;

  if (profil === null || controleObsolete) {
    return {
      code: "enCours",
      ton: "attente",
      titre: "Votre numéro de TVA est en cours de vérification auprès du registre européen.",
      detail: controleObsolete
        ? "Vous venez de modifier ce numéro : la vérification recommence sur le nouveau. Vous n'avez rien à faire."
        : "Votre inscription n'attend pas : la vérification se fait de notre côté. Elle doit aboutir avant l'émission de votre première facture.",
      bloqueLaFacture: true,
    };
  }

  // ---- 5. VALIDÉ ------------------------------------------------
  //
  // C'EST `vatNumberValidatedAt` QUI FAIT FOI, PAS `viesStatus`. La
  // colonne de date est celle que `saas_vat_regime_compute()` lit pour
  // accorder l'autoliquidation ; c'est donc elle qui décide de ce que
  // l'écran a le droit d'affirmer. Elle couvre aussi la validation
  // humaine (`manual`, `document`), pour laquelle `viesStatus` reste
  // nul — et qui est une validation tout aussi réelle.
  const valideLe = formaterDateFr(profil.vatNumberValidatedAt);
  if (profil.vatNumberValidatedAt !== null && valideLe !== null) {
    const parQui =
      profil.validationSource === "vies"
        ? "auprès du registre européen"
        : "par notre équipe, sur pièce";
    const preuve =
      profil.viesConsultationNumber === null
        ? null
        : ` Numéro de consultation : ${profil.viesConsultationNumber}.`;
    return {
      code: "valide",
      ton: "succes",
      titre: `Numéro de TVA vérifié le ${valideLe} ${parQui}.`,
      detail: `Vos factures seront établies en autoliquidation, sans TVA.${preuve ?? ""}`,
      bloqueLaFacture: false,
    };
  }

  // ---- 6. REFUSÉ ------------------------------------------------
  //
  // « PAS RECONNU » ET NON « INVALIDE ». Un numéro peut être refusé
  // parce qu'il est tout neuf et pas encore publié par son registre :
  // dire « invalide » accuserait le client d'une faute qu'il n'a
  // peut-être pas commise.
  if (profil.viesStatus === "refuse") {
    const le = formaterDateFr(profil.viesLastAttemptAt);
    return {
      code: "refuse",
      ton: "faute",
      titre: "Ce numéro n'est pas reconnu par le registre européen — vérifiez la saisie.",
      detail:
        (le === null ? "" : `Consultation du ${le}. `) +
        "Relisez le numéro, préfixe pays compris. S'il est exact, il vient peut-être d'être attribué et n'est pas encore publié par votre administration : écrivez-nous, nous relancerons la vérification. Personne ne la relancera automatiquement.",
      bloqueLaFacture: true,
    };
  }

  // ---- 7. INDISPONIBLE ------------------------------------------
  //
  // NI UN REFUS, NI UNE VALIDATION, et la phrase doit l'établir sans
  // ambiguïté : le client ne doit surtout pas « corriger » un numéro
  // qui n'a rien à se reprocher.
  if (profil.viesStatus === "indisponible") {
    const prochain = formaterDateFr(profil.viesNextAttemptAt, true);
    return {
      code: "indisponible",
      ton: "attente",
      titre:
        "Le registre de votre pays est momentanément indisponible : nous réessayons.",
      detail:
        "Votre numéro n'est pas en cause, et il n'y a rien à corriger. " +
        (prochain === null
          ? "Un nouvel essai est programmé."
          : `Prochain essai le ${prochain}.`) +
        " Seule l'émission de votre première facture attend cette réponse.",
      bloqueLaFacture: true,
    };
  }

  // ---- 8. LE RESTE : DANS LA FILE --------------------------------
  // `viesStatus` nul avec une ligne existante, ou l'incohérence
  // « validé sans date » que le déclencheur de 0089 § 7.a interdit en
  // base. Dans les deux cas la vérité honnête est « on n'a pas encore
  // de réponse », et surtout pas une coche verte.
  return {
    code: "enCours",
    ton: "attente",
    titre: "Votre numéro de TVA est en cours de vérification auprès du registre européen.",
    detail:
      "Votre inscription n'attend pas : la vérification se fait de notre côté. Elle doit aboutir avant l'émission de votre première facture.",
    bloqueLaFacture: true,
  };
}
