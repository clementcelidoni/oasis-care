/**
 * §INSCRIPTION — L'ENGAGEMENT : L'ANNONCER AVANT, LE FAIRE ACCEPTER,
 * EN GARDER LA PREUVE.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'EXIGENCE, MOT POUR MOT
 * ══════════════════════════════════════════════════════════════════
 *
 * « Avant de souscrire, celui qui s'abonne est au courant qu'il est
 * engagé. » Le tarif fondateur, c'est 49,90 € HT par mois pendant DOUZE
 * MOIS sur l'offre Pro, et l'abonné est engagé sur ces douze mois. Ce
 * n'est pas un prix barré : c'est un contrat à durée déterminée.
 *
 * TROIS OBLIGATIONS EN DÉCOULENT, ET LA TROISIÈME EST CELLE QU'ON
 * OUBLIE :
 *
 *   a. ANNONCER AVANT. La carte de l'offre porte la durée, le prix
 *      pendant et LE PRIX D'APRÈS. Un client qui découvre son
 *      engagement au moment de résilier est une réclamation certaine,
 *      et il aura raison.
 *   b. FAIRE ACCEPTER PAR UN GESTE SÉPARÉ. Une case dédiée, non
 *      pré-cochée. Tant qu'elle n'est pas cochée, le paiement ne part
 *      pas — et c'est le SERVEUR qui le vérifie (`verifierAcceptation`
 *      est appelée par la Server Action, pas seulement par l'écran).
 *   c. GARDER LA PREUVE. Savoir ne suffit pas : il faut pouvoir
 *      démontrer qu'il savait. Une trace qui dit « a accepté » sans
 *      conserver LE TEXTE lu ne vaut rien le jour où l'écran aura
 *      changé — et il changera.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EST PUR, ET CE QU'IL N'A PAS LE DROIT DE FAIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucune valeur importée, aucun accès à la base, aucun réseau : comme
 * `identite.ts` et `grille.ts`, ce fichier tourne à l'identique dans le
 * navigateur et au serveur. C'est ce qui garantit qu'on ne verra jamais
 * une case cochée à l'écran refusée par le serveur, ni l'inverse : il
 * n'y a qu'un seul jeu de règles, écrit une fois.
 *
 * Les LECTURES vivent à côté, dans `engagement-lecture.ts`.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'INVENTE AUCUN CHIFFRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ni la durée, ni le prix pendant, ni le prix après. Les deux premiers
 * viennent de `discount_offers` (migration 0081) ; le TROISIÈME se
 * déduit du tarif public de l'offre visée, exactement comme le fait
 * `discount_offer_terms()` en base — et pour la même raison, écrite
 * dans 0081 : recopié, il dériverait au premier changement de grille et
 * l'écran annoncerait un retour à un tarif qui n'existe plus.
 *
 * Corollaire adopté ici : SANS PRIX PUBLIC, PAS D'ANNONCE. 0081 refuse
 * déjà de poser l'engagement dans ce cas (« le prix d'APRÈS ne peut pas
 * être annoncé, donc l'engagement ne peut pas être accepté »). L'écran
 * suit la même règle plutôt que d'afficher deux chiffres sur trois.
 */

import { formaterHt, formaterHtParPeriode } from "./grille.ts";

// ------------------------------------------------------------------
// Ce que la base porte
// ------------------------------------------------------------------

/**
 * Le TEXTE contractuel courant, tel qu'il vit dans `commercial_config`
 * sous la clé `billing.commitment.terms`.
 *
 * `version` n'est pas décorative : c'est elle qui circule avec
 * l'acceptation, et c'est en la comparant qu'on refuse une case cochée
 * devant une version qui n'est plus celle affichée. Quelqu'un qui laisse
 * l'onglet ouvert une semaine pendant que le texte change ne doit pas
 * pouvoir accepter l'ancien.
 */
export type TexteEngagement = {
  version: string;
  texte: string;
};

/**
 * Une offre de remise QUI ENGAGE, lue dans `discount_offers`.
 *
 * On ne modélise que le cas « prix mensuel imposé » : c'est le seul que
 * le tarif fondateur emploie, et le seul dont le prix pendant soit un
 * nombre connu d'avance. Un pourcentage se calcule à la facture, donc
 * il ne s'annonce pas comme un montant — 0081 rend d'ailleurs
 * `monthly_price_during_cents` à NULL dans ce cas.
 */
export type OffreEngageante = {
  code: string;
  label: string;
  /** L'offre visée. Sans elle, le prix d'après est introuvable. */
  planKey: string;
  dureeMois: number;
  /** HORS TAXES, en centimes entiers. */
  prixPendantHtCents: number;
};

// ------------------------------------------------------------------
// L'ANNONCE — les trois chiffres, prêts à afficher
// ------------------------------------------------------------------

export type AnnonceEngagement = {
  code: string;
  label: string;
  planKey: string;
  dureeMois: number;

  /** « Engagement 12 mois » — l'étiquette de la carte. */
  badge: string;
  /** « 49,90 € HT / mois » pendant l'engagement. */
  prixPendant: string;
  /** « 79,90 € HT / mois » à partir du treizième mois. */
  prixApres: string;
  /** « au 13e mois » — dit QUAND le prix change, pas seulement qu'il change. */
  quandLePrixChange: string;

  /** La phrase courte de la carte, avant tout choix. */
  resume: string;
  /** La phrase de la case à cocher. Elle porte les trois chiffres. */
  phraseAcceptation: string;

  /** Les montants bruts, pour la preuve. Jamais recalculés à l'écran. */
  prixPendantHtCents: number;
  prixApresHtCents: number;
};

/**
 * Le mois où le tarif public reprend, en ordinal français.
 *
 * `dureeMois` vaut au moins 1 en base (contrainte `between 1 and 60`),
 * donc le mois suivant vaut au moins 2 : le cas « 1er » ne peut pas se
 * produire, et écrire une branche pour lui laisserait croire qu'il le
 * peut.
 */
function moisOrdinal(dureeMois: number): string {
  return `${dureeMois + 1}e`;
}

/**
 * LES TROIS CHIFFRES, ASSEMBLÉS UNE SEULE FOIS.
 *
 * Rend `null` quand le prix d'après est inconnu — c'est-à-dire quand
 * l'offre visée n'a pas de tarif public. On n'annonce alors RIEN : deux
 * chiffres sur trois, c'est une promesse dont il manque la fin, et
 * c'est précisément celle que le client découvrirait au treizième mois.
 */
export function annoncerEngagement(
  offre: OffreEngageante,
  prixPublicMensuelHtCents: number | null,
): AnnonceEngagement | null {
  if (prixPublicMensuelHtCents === null) return null;

  const prixPendant = formaterHtParPeriode(offre.prixPendantHtCents, "monthly");
  const prixApres = formaterHtParPeriode(prixPublicMensuelHtCents, "monthly");
  // `formaterHtParPeriode` ne rend `null` que sur une entrée `null`, et
  // les deux viennent d'être écartées. Le contrôle reste pour que le
  // type le prouve sans qu'on ait à l'affirmer.
  if (prixPendant === null || prixApres === null) return null;

  const quandLePrixChange = `au ${moisOrdinal(offre.dureeMois)} mois`;

  return {
    code: offre.code,
    label: offre.label,
    planKey: offre.planKey,
    dureeMois: offre.dureeMois,

    badge: `Engagement ${offre.dureeMois} mois`,
    prixPendant,
    prixApres,
    quandLePrixChange,

    resume:
      `${offre.label} : ${prixPendant} pendant ${offre.dureeMois} mois, ` +
      `puis ${prixApres} ${quandLePrixChange}. Engagement de ${offre.dureeMois} mois.`,

    phraseAcceptation:
      `Je m'engage pour ${offre.dureeMois} mois à ${prixPendant}, ` +
      `puis ${prixApres} ${quandLePrixChange}. ` +
      `Je comprends que mon abonnement ne peut pas être résilié avant ce terme.`,

    prixPendantHtCents: offre.prixPendantHtCents,
    prixApresHtCents: prixPublicMensuelHtCents,
  };
}

// ------------------------------------------------------------------
// LE GESTE D'ACCEPTATION, VÉRIFIÉ CÔTÉ SERVEUR
// ------------------------------------------------------------------

export type DemandeAcceptation = {
  /** L'engagement à accepter, ou `null` s'il n'y en a aucun. */
  annonce: AnnonceEngagement | null;
  /** La case a-t-elle été cochée ? Jamais pré-cochée à l'écran. */
  cochee: boolean;
  /** La version du texte affichée AU MOMENT DE COCHER. */
  versionAcceptee: string | null;
  /** La version du texte telle qu'elle est en base MAINTENANT. */
  versionCourante: string | null;
  /**
   * LA DATE DE FIN D'ENGAGEMENT PORTÉE PAR LA REMISE RÉELLEMENT
   * APPLIQUÉE, ou `null` si la souscription n'engage à rien.
   *
   * Elle vient de `subscription_discounts.commitment_ends_on`, que le
   * client A LE DROIT DE LIRE — contrairement au catalogue des offres
   * engageantes. C'est ce qui rend ce verrou indépendant de la
   * visibilité du catalogue : sans elle, « pas d'annonce » était
   * indiscernable de « annonce illisible », et le verrou s'ouvrait tout
   * seul précisément quand il comptait.
   */
  engageJusquAu: string | null;
};

export type VerdictAcceptation =
  | { ok: true }
  | { ok: false; code: string; motif: string };

/**
 * LE VERROU. Il est appelé par le SERVEUR avant d'ouvrir la caisse.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI QUATRE REFUS ET NON UN SEUL
 * ══════════════════════════════════════════════════════════════════
 *
 * Chacun appelle un geste différent, et une phrase unique
 * (« acceptation manquante ») enverrait tout le monde au support :
 *
 *   • RIEN N'ENGAGE → on laisse passer. La majorité des souscriptions
 *     sont dans ce cas, et leur imposer une case à cocher inutile ferait
 *     de l'acceptation un réflexe plutôt qu'un acte.
 *   • LE TEXTE N'EST PAS PUBLIÉ → on refuse. Sans texte, il n'y a rien
 *     à accepter, donc rien à prouver : encaisser ici, c'est encaisser
 *     un engagement indéfendable. 0081 refuse déjà de poser la remise
 *     sans le texte ; on refuse une étape plus tôt, pendant qu'il est
 *     encore temps de ne rien prélever.
 *   • LA CASE N'EST PAS COCHÉE → on refuse. C'est le cas nominal, et
 *     c'est la raison d'être de cette fonction.
 *   • LE TEXTE A CHANGÉ DEPUIS L'AFFICHAGE → on refuse. La preuve
 *     conserverait le texte courant alors que l'abonné en a lu un
 *     autre : elle serait fausse, et une preuve fausse est pire que pas
 *     de preuve. On lui redemande, après relecture.
 */
export function verifierAcceptation(demande: DemandeAcceptation): VerdictAcceptation {
  // ══════════════════════════════════════════════════════════════
  // LE REPLI EST INVERSÉ ICI, ET C'ÉTAIT UNE FAILLE BÉANTE
  // ══════════════════════════════════════════════════════════════
  //
  // « Pas d'annonce → rien à vérifier » se lisait comme le comportement
  // sûr. Il ne l'est que si l'annonce est absente parce qu'il n'y a
  // AUCUN engagement. Or elle est aussi absente quand on n'a PAS PU la
  // lire — et c'est le cas courant, pas un cas de bord : le catalogue
  // `discount_offers` est réservé aux administrateurs par sa politique
  // RLS, donc un client pro n'en voit aucune ligne. La RLS FILTRE, elle
  // ne lève pas : la lecture rend « rien », exactement comme s'il n'y
  // avait rien.
  //
  // Pendant ce temps la remise ACCORDÉE, elle, est parfaitement lisible
  // par le membre de l'entreprise, et la composition l'appliquait :
  // 49,90 € prélevés, douze mois verrouillés en base, et aucune des
  // quatre exigences du dirigeant — case dédiée, texte affiché en
  // entier, tarif vérifié, preuve conservée — n'était honorée. Le
  // client ne voyait nulle part le mot « engagement ».
  //
  // `engageJusquAu` vient de `subscription_discounts.commitment_ends_on`,
  // que le client PEUT lire. Le verrou ne dépend donc plus de la
  // visibilité du catalogue : dès que la souscription engage, elle
  // exige une annonce acceptée, et à défaut elle refuse.
  if (demande.annonce === null) {
    if (demande.engageJusquAu !== null) {
      return {
        ok: false,
        code: "engagementNonAnnoncable",
        motif:
          "Le tarif préférentiel posé sur votre abonnement vous engage sur une durée, et nous ne pouvons pas afficher ici les conditions exactes de cet engagement. Nous ne prélevons pas un engagement que vous n'avez pas pu lire : écrivez-nous, nous le mettons en place avec vous. Rien n'a été prélevé.",
      };
    }
    return { ok: true };
  }

  if (demande.versionCourante === null) {
    return {
      ok: false,
      code: "texteEngagementAbsent",
      motif:
        "Le texte de l'engagement n'est pas publié : il n'y a rien à accepter, et rien ne peut donc être prélevé. Écrivez-nous, nous réglons cela.",
    };
  }

  if (!demande.cochee) {
    return {
      ok: false,
      code: "engagementNonAccepte",
      motif: `Cette offre engage sur ${demande.annonce.dureeMois} mois. Cochez la case d'acceptation pour continuer : nous ne pouvons pas prélever un engagement qui n'a pas été accepté.`,
    };
  }

  if (demande.versionAcceptee !== demande.versionCourante) {
    return {
      ok: false,
      code: "texteEngagementModifie",
      motif:
        "Le texte de l'engagement a changé depuis l'affichage de cette page. Rechargez-la et relisez-le : nous ne conservons comme preuve que le texte réellement lu.",
    };
  }

  return { ok: true };
}

/**
 * CE QUI EST ANNONCÉ EST CE QUI SERA PRÉLEVÉ — sinon on ne prélève pas.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE PIÈGE QUE CETTE FONCTION FERME
 * ══════════════════════════════════════════════════════════════════
 *
 * Une remise n'est pas un code qu'on réclame : elle est ACCORDÉE, et
 * elle vit dans `subscription_discounts`. Le catalogue
 * (`discount_offers`), lui, dit seulement qu'elle EXISTE. Les deux ne
 * disent donc pas la même chose, et c'est exactement là que l'accident
 * se produit : la carte annonce « 49,90 € », la composition ne trouve
 * aucune remise posée sur cette entreprise, et le prélèvement part à
 * 79,90 €. Le client découvre l'écart sur son relevé — après avoir
 * coché une case disant qu'il s'engageait douze mois à 49,90 €.
 *
 * On compare donc l'ANNONCE et ce que le serveur a réellement composé.
 * S'ils divergent, on refuse : mieux vaut une souscription qui
 * n'aboutit pas qu'un prélèvement qui contredit ce qui a été accepté.
 */
export function verifierTarifAnnonce(params: {
  annonce: AnnonceEngagement | null;
  /** La remise réellement retenue par la composition, s'il y en a une. */
  remiseAppliquee: { code: string | null; prixRemiseHtCents: number } | null;
}): VerdictAcceptation {
  if (params.annonce === null) return { ok: true };

  const remise = params.remiseAppliquee;
  if (remise === null || remise.code !== params.annonce.code) {
    return {
      ok: false,
      code: "tarifAnnonceNonApplique",
      motif: `${params.annonce.label} vous est présenté, mais il n'est pas encore posé sur votre abonnement : le paiement partirait au tarif public. Écrivez-nous pour que nous l'appliquions avant de souscrire — rien n'a été prélevé.`,
    };
  }

  if (remise.prixRemiseHtCents !== params.annonce.prixPendantHtCents) {
    return {
      ok: false,
      code: "montantAnnonceDifferent",
      motif:
        "Le montant qui serait prélevé ne correspond pas à celui affiché sur cette page. Rechargez-la : nous ne prélevons jamais un montant différent de celui annoncé.",
    };
  }

  return { ok: true };
}

// ------------------------------------------------------------------
// LA PREUVE À CONSERVER
// ------------------------------------------------------------------

/**
 * Ce qu'il faut écrire dans `subscription_commitment_acceptances` — qui,
 * quand, les trois chiffres annoncés, et LE TEXTE EXACT affiché.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE TEXTE EST RECOPIÉ, JAMAIS RÉFÉRENCÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la convention du dépôt, et 0081 l'écrit noir sur blanc pour
 * cette table : une référence vers un texte modifiable rendrait la
 * preuve fausse à la première correction de virgule. `version` est
 * l'étiquette lisible de la copie, pas sa source.
 *
 * Les trois chiffres sont figés pour la même raison : ils sont
 * dérivables aujourd'hui, ils ne le seront plus quand la grille aura
 * bougé, et c'est justement ce à quoi une preuve doit résister.
 */
export type PreuveAcceptation = {
  organizationId: string;
  discountCode: string;
  planKey: string;
  commitmentMonths: number;
  monthlyPriceDuringCents: number;
  monthlyPriceAfterCents: number;
  termsText: string;
  termsVersion: string;
};

/**
 * Assemble la preuve à partir de ce qui a été RÉELLEMENT affiché.
 *
 * Rend `null` quand il n'y a rien à prouver (aucun engagement) : une
 * preuve vide enregistrée « au cas où » ferait croire, à la relecture,
 * qu'un engagement a été accepté là où il n'y en avait pas.
 */
export function preuveDepuisAnnonce(
  organizationId: string,
  annonce: AnnonceEngagement | null,
  texte: TexteEngagement | null,
): PreuveAcceptation | null {
  if (annonce === null || texte === null) return null;
  return {
    organizationId,
    discountCode: annonce.code,
    planKey: annonce.planKey,
    commitmentMonths: annonce.dureeMois,
    monthlyPriceDuringCents: annonce.prixPendantHtCents,
    monthlyPriceAfterCents: annonce.prixApresHtCents,
    termsText: texte.texte,
    termsVersion: texte.version,
  };
}

/**
 * LA PREUVE EXISTE-T-ELLE VRAIMENT ? Sinon, on ne prélève pas.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE CONTRÔLE EST LE DERNIER, ET POURQUOI IL BLOQUE
 * ══════════════════════════════════════════════════════════════════
 *
 * Cocher une case est un GESTE ; il ne devient une preuve que s'il
 * laisse une trace. Aujourd'hui la seule écriture possible dans
 * `subscription_commitment_acceptances` est celle
 * d'`admin_apply_discount` (0081), qui exige le texte et sa version au
 * moment où l'administrateur pose la remise. Il n'existe AUCUN chemin
 * par lequel l'écran de souscription pourrait y écrire lui-même — voir
 * le compte rendu, c'est de la matière pour une migration.
 *
 * Conséquence tenue ici plutôt que subie : si aucune trace ne
 * correspond au texte affiché, on REFUSE d'encaisser. Encaisser un
 * engagement de douze mois qu'on ne saurait pas démontrer, c'est
 * s'exposer à devoir le rembourser en entier à la première
 * contestation — et avoir raison sur le fond n'y changerait rien.
 *
 * La version est comparée, pas seulement l'existence : une preuve qui
 * porte un autre texte que celui lu ce jour-là prouve autre chose.
 */
export function verifierPreuve(params: {
  annonce: AnnonceEngagement | null;
  /** La dernière trace enregistrée pour cette entreprise, s'il y en a une. */
  preuveEnregistree: { version: string; discountCode: string } | null;
  /** La version du texte affichée sur cette page. */
  versionAffichee: string | null;
}): VerdictAcceptation {
  if (params.annonce === null) return { ok: true };

  const preuve = params.preuveEnregistree;
  if (preuve === null || preuve.discountCode !== params.annonce.code) {
    return {
      ok: false,
      code: "preuveManquante",
      motif:
        "Votre acceptation n'a pas encore pu être enregistrée de façon durable, et nous ne prélevons pas un engagement dont nous ne pourrions pas démontrer qu'il a été accepté. Écrivez-nous : rien n'a été prélevé.",
    };
  }

  if (preuve.version !== params.versionAffichee) {
    return {
      ok: false,
      code: "preuveObsolete",
      motif:
        "La trace de votre acceptation porte une version du texte différente de celle affichée ici. Rechargez la page et relisez le texte avant de continuer.",
    };
  }

  return { ok: true };
}

// ------------------------------------------------------------------
// L'ENGAGEMENT DÉJÀ EN COURS
// ------------------------------------------------------------------

/**
 * Une ligne de `subscription_discounts`, réduite à ce qui compte ici.
 * Les dates sont des jours ISO (AAAA-MM-JJ), comme en base.
 */
export type LigneRemise = {
  code: string | null;
  label: string;
  appliesToPlan: string | null;
  valueCents: number | null;
  /** Fin de la REMISE. */
  endsOn: string;
  /** Fin de l'ENGAGEMENT. `null` quand la remise n'engage à rien. */
  commitmentEndsOn: string | null;
  cancelledAt: string | null;
};

export type EngagementEnCours = {
  code: string | null;
  label: string;
  planKey: string | null;
  /** Le jour jusqu'auquel on ne peut pas partir (inclus). */
  finLe: string;
  /** Le jour où la remise cesse et le tarif public reprend. */
  finRemiseLe: string;
  prixPendantHtCents: number | null;
};

/**
 * L'engagement qui court AUJOURD'HUI, ou `null`.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX DATES QU'IL NE FAUT PAS CONFONDRE
 * ══════════════════════════════════════════════════════════════════
 *
 * `ends_on` est la fin de la REMISE : c'est là que le tarif public
 * reprend. `commitment_ends_on` est la fin de l'ENGAGEMENT : c'est là
 * qu'on redevient libre de partir. Sur le tarif fondateur elles
 * tombent le même jour ; rien ne garantit qu'une remise future fera de
 * même, et c'est `commitment_ends_on` — et elle seule — que la
 * résiliation doit interroger. 0081 le dit dans ses propres termes :
 * « c'est CETTE colonne que la résiliation interroge — jamais le
 * catalogue, qui a pu changer depuis ».
 *
 * Une remise ANNULÉE (`cancelled_at`) n'engage plus : on ne retient pas
 * quelqu'un sur une remise qu'on lui a retirée.
 *
 * La comparaison de dates se fait sur des chaînes ISO, ce qui est
 * exact parce que le format `AAAA-MM-JJ` s'ordonne comme le calendrier.
 * Passer par `Date` introduirait un fuseau là où il n'y en a pas.
 */
export function engagementEnCours(
  lignes: LigneRemise[],
  leJour: string,
): EngagementEnCours | null {
  const engageantes = lignes
    .filter((ligne) => ligne.cancelledAt === null)
    .filter((ligne): ligne is LigneRemise & { commitmentEndsOn: string } =>
      ligne.commitmentEndsOn !== null,
    )
    // `>=` et non `>` : le dernier jour de l'engagement en fait partie.
    .filter((ligne) => ligne.commitmentEndsOn >= leJour)
    // Le plus tardif fait foi : deux remises engageantes superposées
    // (une prolongation, par exemple) ne libèrent qu'à la fin de la
    // dernière. Prendre la première libérerait trop tôt.
    .sort((a, b) => b.commitmentEndsOn.localeCompare(a.commitmentEndsOn));

  const retenue = engageantes[0];
  if (retenue === undefined) return null;

  return {
    code: retenue.code,
    label: retenue.label,
    planKey: retenue.appliesToPlan,
    finLe: retenue.commitmentEndsOn,
    finRemiseLe: retenue.endsOn,
    prixPendantHtCents: retenue.valueCents,
  };
}

/**
 * Un jour ISO en français lisible, sans jamais glisser d'un jour.
 *
 * `new Date("2027-03-01")` est minuit UTC ; l'afficher dans un fuseau
 * négatif rendrait « 28 février ». On force donc l'affichage en UTC —
 * une date de calendrier n'a pas d'heure, et lui en inventer une est le
 * seul moyen de se tromper.
 */
export function formaterJour(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * CE QUE L'ENGAGEMENT INTERDIT, dit à l'écran.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÉSILIATION AVANT TERME N'EST PAS EN LIBRE-SERVICE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un bouton « annuler » qui n'annule pas serait un mensonge ; un bouton
 * « annuler » qui annulerait serait une rupture de contrat qu'aucune
 * trace ne justifierait. La troisième voie est celle que ce produit
 * emploie déjà pour les gestes irréversibles : on explique, on donne la
 * date, et on renvoie vers quelqu'un — un administrateur peut le faire
 * depuis le Control Center, AVEC UN MOTIF.
 */
export function phraseResiliation(engagement: EngagementEnCours): string {
  const prix =
    engagement.prixPendantHtCents === null
      ? null
      : formaterHt(engagement.prixPendantHtCents);

  return (
    `Votre abonnement est engagé jusqu'au ${formaterJour(engagement.finLe)}` +
    (prix === null ? "" : ` au titre de « ${engagement.label} » (${prix} par mois)`) +
    `. Jusqu'à cette date, il ne peut pas être résilié depuis cet écran. ` +
    `Écrivez-nous si votre situation a changé : une résiliation anticipée reste possible, ` +
    `mais elle se décide au cas par cas et se justifie.`
  );
}
