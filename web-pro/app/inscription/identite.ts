/**
 * §INSCRIPTION — L'IDENTITÉ LÉGALE, VÉRIFIÉE HORS LIGNE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un SIRET faux saisi aujourd'hui devient une facture non conforme dans
 * trois mois — et une facture non conforme se corrige par un avoir, une
 * réémission et une explication au client. Le contrôle coûte quelques
 * lignes maintenant ; il coûte un incident comptable plus tard.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE VÉRIFIE HORS LIGNE, ET CE QUI NE SE VÉRIFIE PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * SE VÉRIFIE ICI, sans le moindre appel réseau :
 *   • la LONGUEUR du SIREN (9) et du SIRET (14) ;
 *   • leur CLÉ DE CONTRÔLE (Luhn), qui attrape toute faute de frappe
 *     d'un chiffre et la quasi-totalité des inversions de deux ;
 *   • la COHÉRENCE entre les deux — les neuf premiers chiffres d'un
 *     SIRET SONT le SIREN, et deux champs qui se contredisent sont une
 *     erreur qu'aucun service extérieur n'a besoin de trancher ;
 *   • la CLÉ du numéro de TVA français, qui se recalcule à partir du
 *     SIREN par une formule fixe.
 *
 * NE SE VÉRIFIE PAS ICI, et l'écran doit le dire :
 *   • que l'entreprise EXISTE (il faudrait l'annuaire Sirene) ;
 *   • qu'elle n'est pas CESSÉE ;
 *   • qu'un numéro de TVA intracommunautaire ÉTRANGER est attribué et
 *     actif (il faudrait le service européen VIES). Une clé étrangère
 *     bien formée ne prouve rien : la Belgique, l'Espagne et l'Italie
 *     ont chacune leur propre algorithme, et plusieurs pays n'ont
 *     aucune clé de contrôle du tout.
 *
 * AUCUN APPEL RÉSEAU N'EST FAIT DEPUIS CE FICHIER, ni ne doit l'être :
 * une validation qui dépend d'un service extérieur tombe le jour où ce
 * service tombe, et l'inscription tombe avec elle.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE DÉCIDE PAS DU RÉGIME DE TVA
 * ══════════════════════════════════════════════════════════════════
 *
 * `saas_vat_regime()` (migration 0081) est la SEULE autorité sur le
 * régime applicable — france / euReverseCharge / outsideEu / unknown —
 * et son refus de deviner est précisément ce qui protège. Ce fichier ne
 * fait que dire QUELS CHAMPS il faudra avoir renseignés pour que cette
 * fonction-là puisse trancher. Deux moteurs de décision fiscale, ce
 * sont deux vérités et un jour un écart.
 */

// ------------------------------------------------------------------
// Le verdict d'un champ
// ------------------------------------------------------------------

/**
 * TROIS ÉTATS, ET « INVÉRIFIABLE » N'EST PAS « VALIDE ».
 *
 * Les confondre reviendrait à afficher une coche verte devant un numéro
 * de TVA autrichien dont on ne sait strictement rien, et à laisser
 * croire que le contrôle a eu lieu.
 */
export type EtatChamp = "vide" | "valide" | "invalide" | "inverifiable";

export type Verdict = {
  /** La valeur NORMALISÉE (espaces et ponctuation retirés), ou null. */
  valeur: string | null;
  etat: EtatChamp;
  /**
   * La phrase à afficher, ou null quand il n'y a rien à dire. Elle
   * explique CE QUI NE VA PAS, jamais « champ invalide » : personne ne
   * corrige une faute qu'on ne lui montre pas.
   */
  message: string | null;
};

/**
 * Retire tout ce qui n'est pas un chiffre.
 *
 * LA RAISON D'ÊTRE DE CETTE FONCTION : un SIRET se lit sur un extrait
 * Kbis groupé « 732 829 320 00074 », et il se copie-colle avec ses
 * espaces, parfois avec une espace insécable, parfois avec des points.
 * Refuser ces saisies-là serait recaler des numéros parfaitement
 * justes — et c'est exactement le genre de rigidité qui fait
 * abandonner une inscription.
 */
export function chiffresSeuls(brut: string): string {
  return brut.replace(/\D/g, "");
}

/**
 * Normalise un numéro de TVA : majuscules, sans espace ni ponctuation.
 * Le préfixe pays reste, c'est lui qui porte l'information.
 */
export function normaliserTva(brut: string): string {
  return brut.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ------------------------------------------------------------------
// La clé de Luhn
// ------------------------------------------------------------------

/**
 * L'algorithme de Luhn, tel que l'INSEE l'applique au SIREN et au SIRET.
 *
 * On double un chiffre sur deux EN PARTANT DE LA DROITE (rang pair
 * depuis la fin), on retranche 9 au-delà de 9, et la somme doit être un
 * multiple de 10.
 */
function luhnValide(chiffres: string): boolean {
  let somme = 0;
  let doubler = false;
  for (let i = chiffres.length - 1; i >= 0; i -= 1) {
    let valeur = chiffres.charCodeAt(i) - 48;
    if (doubler) {
      valeur *= 2;
      if (valeur > 9) valeur -= 9;
    }
    somme += valeur;
    doubler = !doubler;
  }
  return somme % 10 === 0;
}

/**
 * LA POSTE EST L'EXCEPTION, ET ELLE EST RÉELLE.
 *
 * Les établissements de La Poste portent le SIREN 356000000 et leurs
 * SIRET NE SATISFONT PAS Luhn : la règle publiée par l'INSEE est que la
 * somme de leurs quatorze chiffres doit être un multiple de 5. Sans ce
 * cas particulier, tout bureau de poste client se verrait refuser un
 * SIRET parfaitement valide — et personne, à l'écran, ne pourrait
 * comprendre pourquoi.
 */
const SIREN_LA_POSTE = "356000000";

function sommeDesChiffres(chiffres: string): number {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i += 1) somme += chiffres.charCodeAt(i) - 48;
  return somme;
}

// ------------------------------------------------------------------
// SIREN
// ------------------------------------------------------------------

export function verifierSiren(brut: string | null | undefined): Verdict {
  const chiffres = chiffresSeuls(brut ?? "");
  if (chiffres === "") return { valeur: null, etat: "vide", message: null };

  if (chiffres.length !== 9) {
    return {
      valeur: chiffres,
      etat: "invalide",
      message: `Un SIREN compte 9 chiffres ; celui-ci en compte ${chiffres.length}.`,
    };
  }

  // PAS D'EXCEPTION ICI, contrairement au SIRET. Le SIREN de La Poste
  // (356000000) satisfait Luhn comme les autres — c'est vérifié par un
  // test. L'exception ne porte que sur ses SIRET, et un cas particulier
  // écrit « au cas où » serait un trou : il laisserait passer sans
  // contrôle un numéro que rien n'oblige à dispenser.
  if (!luhnValide(chiffres)) {
    return {
      valeur: chiffres,
      etat: "invalide",
      message:
        "La clé de contrôle de ce SIREN est fausse : il y a une faute de frappe ou un chiffre inversé.",
    };
  }

  return { valeur: chiffres, etat: "valide", message: null };
}

// ------------------------------------------------------------------
// SIRET
// ------------------------------------------------------------------

export function verifierSiret(brut: string | null | undefined): Verdict {
  const chiffres = chiffresSeuls(brut ?? "");
  if (chiffres === "") return { valeur: null, etat: "vide", message: null };

  if (chiffres.length !== 14) {
    return {
      valeur: chiffres,
      etat: "invalide",
      message:
        chiffres.length === 9
          ? "Ceci ressemble à un SIREN (9 chiffres). Le SIRET en compte 14 : c'est le SIREN suivi du numéro d'établissement."
          : `Un SIRET compte 14 chiffres ; celui-ci en compte ${chiffres.length}.`,
    };
  }

  const valide = chiffres.startsWith(SIREN_LA_POSTE)
    ? sommeDesChiffres(chiffres) % 5 === 0
    : luhnValide(chiffres);

  if (!valide) {
    return {
      valeur: chiffres,
      etat: "invalide",
      message:
        "La clé de contrôle de ce SIRET est fausse : il y a une faute de frappe ou un chiffre inversé.",
    };
  }

  return { valeur: chiffres, etat: "valide", message: null };
}

/** Les neuf premiers chiffres d'un SIRET SONT le SIREN. */
export function sirenDepuisSiret(siret: string | null | undefined): string | null {
  const chiffres = chiffresSeuls(siret ?? "");
  return chiffres.length === 14 ? chiffres.slice(0, 9) : null;
}

/**
 * Les deux champs se contredisent-ils ?
 *
 * Ce contrôle-là ne demande aucun service extérieur et attrape le cas
 * le plus fréquent en pratique : le SIREN d'une société recopié à côté
 * du SIRET d'une AUTRE de ses filiales.
 */
export function verifierCoherenceSirenSiret(
  siren: string | null | undefined,
  siret: string | null | undefined,
): Verdict {
  const s9 = chiffresSeuls(siren ?? "");
  const attendu = sirenDepuisSiret(siret);
  if (s9 === "" || attendu === null) return { valeur: attendu, etat: "vide", message: null };

  if (s9 !== attendu) {
    return {
      valeur: attendu,
      etat: "invalide",
      message: `Le SIRET commence par ${attendu}, qui n'est pas le SIREN saisi (${s9}). L'un des deux appartient à une autre entreprise.`,
    };
  }
  return { valeur: attendu, etat: "valide", message: null };
}

// ------------------------------------------------------------------
// TVA
// ------------------------------------------------------------------

/**
 * La clé du numéro de TVA français, recalculée à partir du SIREN.
 *
 *     clé = (12 + 3 × (SIREN mod 97)) mod 97
 *
 * C'est une formule fixe, publiée, sans exception. Le numéro complet est
 * donc entièrement déductible du SIREN — ce qui permet de le PROPOSER à
 * la saisie plutôt que de le faire recopier d'un document.
 *
 * RÉSERVE HONNÊTE : quelques numéros anciens portent une clé
 * alphanumérique attribuée avant cette règle. Ils sont valides et cette
 * formule ne les reproduit pas ; c'est pourquoi un écart de clé rend
 * « invérifiable » assorti de la valeur attendue, et non « invalide ».
 */
export function tvaFrancaiseAttendue(siren: string | null | undefined): string | null {
  const s9 = chiffresSeuls(siren ?? "");
  if (s9.length !== 9) return null;
  const reste = Number.parseInt(s9, 10) % 97;
  const cle = (12 + 3 * reste) % 97;
  return `FR${String(cle).padStart(2, "0")}${s9}`;
}

/**
 * LES VINGT-SEPT, tenus localement — et la raison de ne pas s'en servir
 * pour décider quoi que ce soit de fiscal.
 *
 * La liste des États membres est un fait, pas une décision commerciale :
 * l'écrire ici ne crée pas de seconde vérité. La table faisant autorité
 * reste `saas_eu_countries` (migration 0081), et c'est elle que
 * `saas_vat_regime()` consulte pour trancher le régime. Cette liste-ci
 * ne sert qu'à SAVOIR QUEL CHAMP DEMANDER dans un formulaire — pas à
 * choisir un taux, ni à décider d'une autoliquidation.
 */
export const PAYS_UNION: readonly string[] = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK",
];

/**
 * LES PAYS PROPOSÉS À LA SAISIE.
 *
 * Les vingt-sept, plus les voisins où le produit a des chances d'être
 * vendu. Ce n'est PAS une liste fermée du monde : `country` est un texte
 * libre en base, et une entreprise d'ailleurs peut être enregistrée à la
 * main. C'est une liste de commodité, ordonnée pour que le cas courant
 * — la France — soit le premier.
 */
export const PAYS_PROPOSES: readonly { code: string; nom: string }[] = [
  { code: "FR", nom: "France" },
  { code: "BE", nom: "Belgique" },
  { code: "LU", nom: "Luxembourg" },
  { code: "CH", nom: "Suisse" },
  { code: "DE", nom: "Allemagne" },
  { code: "ES", nom: "Espagne" },
  { code: "IT", nom: "Italie" },
  { code: "NL", nom: "Pays-Bas" },
  { code: "PT", nom: "Portugal" },
  { code: "AT", nom: "Autriche" },
  { code: "BG", nom: "Bulgarie" },
  { code: "CY", nom: "Chypre" },
  { code: "HR", nom: "Croatie" },
  { code: "DK", nom: "Danemark" },
  { code: "EE", nom: "Estonie" },
  { code: "FI", nom: "Finlande" },
  { code: "GR", nom: "Grèce" },
  { code: "HU", nom: "Hongrie" },
  { code: "IE", nom: "Irlande" },
  { code: "LV", nom: "Lettonie" },
  { code: "LT", nom: "Lituanie" },
  { code: "MT", nom: "Malte" },
  { code: "PL", nom: "Pologne" },
  { code: "CZ", nom: "Tchéquie" },
  { code: "RO", nom: "Roumanie" },
  { code: "SK", nom: "Slovaquie" },
  { code: "SI", nom: "Slovénie" },
  { code: "SE", nom: "Suède" },
  { code: "GB", nom: "Royaume-Uni" },
  { code: "MC", nom: "Monaco" },
];

/**
 * Le préfixe grec est « EL » sur les numéros de TVA alors que le code
 * pays ISO du pays est « GR ». Ne pas le savoir ferait refuser tous les
 * numéros grecs.
 */
function prefixeAttendu(pays: string): string {
  return pays === "GR" ? "EL" : pays;
}

export type ZoneFiscale = "france" | "unionEuropeenne" | "horsUnion";

/**
 * La ZONE, et pas le RÉGIME.
 *
 * Le mot est choisi : le RÉGIME (france / euReverseCharge / outsideEu /
 * unknown) appartient à `saas_vat_regime()`, qui prend en compte des
 * choses que ce fichier ignore — l'assujettissement du client, et
 * surtout la VALIDATION du numéro intracommunautaire, sans laquelle le
 * régime reste « unknown » et la facture ne s'émet pas.
 */
export function zoneFiscale(pays: string | null | undefined): ZoneFiscale {
  const code = (pays ?? "FR").trim().toUpperCase();
  if (code === "FR") return "france";
  return PAYS_UNION.includes(code) ? "unionEuropeenne" : "horsUnion";
}

export function verifierTvaIntracom(
  brut: string | null | undefined,
  pays: string | null | undefined,
  siren: string | null | undefined,
): Verdict {
  const numero = normaliserTva(brut ?? "");
  if (numero === "") return { valeur: null, etat: "vide", message: null };

  const code = (pays ?? "FR").trim().toUpperCase();
  const prefixe = numero.slice(0, 2);

  if (!/^[A-Z]{2}/.test(numero)) {
    return {
      valeur: numero,
      etat: "invalide",
      message:
        "Un numéro de TVA intracommunautaire commence par le code du pays — « FR » pour la France.",
    };
  }

  // Le pays du numéro et le pays de l'adresse doivent concorder. Sinon
  // la facture porterait une adresse d'un pays et une TVA d'un autre, et
  // c'est exactement le document qu'un contrôle rejette.
  const attendu = prefixeAttendu(code);
  if (PAYS_UNION.includes(code) && prefixe !== attendu) {
    return {
      valeur: numero,
      etat: "invalide",
      message: `L'adresse de l'entreprise est en ${code} : son numéro de TVA doit commencer par « ${attendu} », pas par « ${prefixe} ».`,
    };
  }

  if (prefixe === "FR") {
    const corps = numero.slice(2);
    if (!/^[0-9A-Z]{2}[0-9]{9}$/.test(corps)) {
      return {
        valeur: numero,
        etat: "invalide",
        message:
          "Un numéro de TVA français s'écrit « FR », deux caractères de clé, puis les 9 chiffres du SIREN — treize caractères en tout.",
      };
    }

    const sirenDuNumero = corps.slice(2);
    const s9 = chiffresSeuls(siren ?? "");
    if (s9 !== "" && s9 !== sirenDuNumero) {
      return {
        valeur: numero,
        etat: "invalide",
        message: `Les 9 derniers chiffres d'un numéro de TVA français sont le SIREN. Ici ils valent ${sirenDuNumero}, alors que le SIREN saisi est ${s9}.`,
      };
    }

    const complet = tvaFrancaiseAttendue(sirenDuNumero);
    if (complet !== null && complet !== numero) {
      // « Invérifiable » et non « invalide » : quelques numéros anciens
      // portent une clé alphanumérique attribuée avant la formule.
      return {
        valeur: numero,
        etat: "inverifiable",
        message: `La clé calculée à partir de ce SIREN donne ${complet}. Si votre numéro est bien celui-ci, corrigez-le ; certains numéros anciens font exception et restent valides.`,
      };
    }

    return { valeur: numero, etat: "valide", message: null };
  }

  // ÉTRANGER : on vérifie la FORME et on s'arrête là, en le disant.
  if (!/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(numero)) {
    return {
      valeur: numero,
      etat: "invalide",
      message: "Ce numéro de TVA n'a pas une forme reconnue : deux lettres de pays, puis 2 à 12 caractères.",
    };
  }

  return {
    valeur: numero,
    etat: "inverifiable",
    message:
      "La forme de ce numéro est plausible, mais son existence ne peut pas être vérifiée ici. Il sera contrôlé auprès du service européen avant l'émission de votre première facture.",
  };
}

// ------------------------------------------------------------------
// CE QU'IL FAUT POUR ÊTRE FACTURABLE
// ------------------------------------------------------------------

/**
 * La fiche telle qu'elle est enregistrée, réduite à ce qui compte ici.
 */
export type IdentiteSaisie = {
  legalName: string | null;
  legalForm: string | null;
  siren: string | null;
  siret: string | null;
  vatNumber: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
};

export type ManquePourFacturer = {
  /** Le nom du champ, tel qu'il s'appelle dans le formulaire. */
  champ: string;
  /** Le libellé humain, pour l'écran. */
  libelle: string;
  /** POURQUOI il est exigé — jamais « champ obligatoire ». */
  raison: string;
};

/**
 * CE QUI MANQUE AVANT DE POUVOIR PAYER, et pas un champ de plus.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ARBITRAGE, ÉCRIT ICI PARCE QU'IL SE DISCUTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Une facture sans SIRET ne doit pas partir — `saas_issue_invoice()` la
 * refuse de toute façon (0081), et un encaissement dont on ne peut pas
 * émettre la facture est PIRE qu'un client perdu : l'argent est pris et
 * le document n'existe pas.
 *
 * Mais bloquer la CRÉATION DU COMPTE sur cette saisie ferait perdre le
 * client qui découvre le produit un dimanche soir, sans son Kbis sous
 * la main.
 *
 * D'OÙ DEUX SEUILS, ET NON UN :
 *   • ENTRER dans le produit ne demande RIEN de tout cela. La fiche se
 *     complète plus tard, l'écran dit ce qui manque.
 *   • PAYER l'exige, parce que payer déclenche une facture.
 *
 * Et le contrôle porte sur la PRÉSENCE d'abord, sur la FORME ensuite :
 * un champ vide bloque, un champ dont la clé est fausse bloque aussi
 * (c'est une faute de frappe, elle se corrige en dix secondes), mais un
 * numéro étranger simplement « invérifiable » ne bloque PAS — sinon
 * aucune entreprise européenne ne pourrait jamais souscrire.
 *
 * CE QUI EST EXIGÉ DÉPEND DE LA ZONE, et c'est ce que 0081 exigera :
 *   FRANCE      raison sociale + SIRET + adresse
 *   UNION       raison sociale + numéro de TVA intracommunautaire + adresse
 *   HORS UNION  raison sociale + adresse
 */
export function manquePourFacturer(identite: IdentiteSaisie): ManquePourFacturer[] {
  const manque: ManquePourFacturer[] = [];
  const zone = zoneFiscale(identite.country);

  if ((identite.legalName ?? "").trim() === "") {
    manque.push({
      champ: "legal_name",
      libelle: "Dénomination sociale",
      raison:
        "C'est le nom qui figure sur la facture. Il doit être celui du registre, pas le nom commercial.",
    });
  }

  if (zone === "france") {
    const siret = verifierSiret(identite.siret);
    if (siret.etat === "vide") {
      manque.push({
        champ: "siret",
        libelle: "SIRET",
        raison:
          "Une facture émise en France doit porter le SIRET du client. Sans lui, la facture ne peut pas être émise — et un paiement encaissé sans facture est un problème pour vous comme pour nous.",
      });
    } else if (siret.etat === "invalide") {
      manque.push({
        champ: "siret",
        libelle: "SIRET",
        raison: siret.message ?? "Ce SIRET est invalide.",
      });
    }
  }

  if (zone === "unionEuropeenne") {
    const tva = verifierTvaIntracom(identite.vatNumber, identite.country, identite.siren);
    if (tva.etat === "vide") {
      manque.push({
        champ: "vat_number",
        libelle: "Numéro de TVA intracommunautaire",
        raison:
          "Hors de France mais dans l'Union, la facture s'établit en autoliquidation : elle doit porter votre numéro intracommunautaire, sinon elle ne peut pas être émise.",
      });
    } else if (tva.etat === "invalide") {
      manque.push({
        champ: "vat_number",
        libelle: "Numéro de TVA intracommunautaire",
        raison: tva.message ?? "Ce numéro de TVA est invalide.",
      });
    }
    // « invérifiable » ne bloque pas : la vérification auprès du service
    // européen ne se fait pas ici, et refuser faute de l'avoir faite
    // fermerait la porte à toute entreprise européenne.
  }

  if ((identite.addressLine1 ?? "").trim() === "" || (identite.city ?? "").trim() === "") {
    manque.push({
      champ: "address_line1",
      libelle: "Adresse",
      raison:
        "L'adresse du client est une mention obligatoire de la facture, et c'est elle qui détermine le régime de TVA applicable.",
    });
  }

  if (zone !== "horsUnion" && (identite.postalCode ?? "").trim() === "") {
    manque.push({
      champ: "postal_code",
      libelle: "Code postal",
      raison: "Il complète l'adresse portée sur la facture.",
    });
  }

  return manque;
}

/**
 * Les avertissements DOUX : ce qui mérite d'être signalé sans empêcher
 * d'avancer. Un SIREN incohérent avec le SIRET, un numéro étranger
 * qu'on ne sait pas contrôler — on le dit, on ne bloque pas.
 */
export function avertissements(identite: IdentiteSaisie): string[] {
  const liste: string[] = [];

  const siren = verifierSiren(identite.siren);
  if (siren.etat === "invalide" && siren.message !== null) liste.push(siren.message);

  const coherence = verifierCoherenceSirenSiret(identite.siren, identite.siret);
  if (coherence.etat === "invalide" && coherence.message !== null) liste.push(coherence.message);

  const tva = verifierTvaIntracom(identite.vatNumber, identite.country, identite.siren);
  if (tva.etat === "inverifiable" && tva.message !== null) liste.push(tva.message);

  return liste;
}
