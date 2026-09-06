// Oasis Care — Chantier courriel. L'ORCHESTRATION, ÉPROUVÉE SANS RIEN.
//
// ==================================================================
// L'ORDRE DES GESTES EST LE SUJET DE CE FICHIER
// ==================================================================
//
//   1. le transporteur est-il là ? sinon on ne met RIEN en file, et on
//      rend une phrase ;
//   2. l'entreprise peut-elle expédier ? (adresse de réponse, et pour
//      une facture : SIRET et adresse postale) ;
//   3. à qui écrit-on ? résolu en base, jamais reçu en paramètre ;
//   4. QUE DIT LE MESSAGE ? relu en base, jamais reçu en paramètre ;
//   5. on rend le message ;
//   6. ON MET EN FILE — c'est ici que l'idempotence se joue, par une
//      CONTRAINTE D'UNICITÉ et non par un « si déjà envoyé » ;
//   7. ON RÉSERVE la ligne — sans quoi un passage de file simultané
//      l'expédierait une seconde fois ;
//   8. et seulement alors on transporte, puis on marque.
//
// POURQUOI LA MISE EN FILE EST AVANT LE TRANSPORT ET NON APRÈS. Si l'on
// transportait d'abord, deux onglets ouverts sur le même devis
// enverraient deux messages et n'en journaliseraient qu'un. La
// contrainte d'unicité doit trancher AVANT que le message ne parte, pas
// après : un client qui reçoit trois fois sa facture appelle son
// paysagiste, qui vous appelle.
//
// POURQUOI LA RÉSERVATION EST NÉCESSAIRE EN PLUS. La contrainte
// d'unicité garde l'INSERTION. Elle ne garde pas la relecture : entre
// la mise en file et le transport, un passage d'ordonnanceur peut
// prendre la même ligne. `email_claim_one` la ferme.
//
// POURQUOI L'INDISPONIBILITÉ DU TRANSPORTEUR N'ENFILE RIEN. Un message
// mis en file sans adresse technique d'expédition serait refusé par
// `email_enqueue` de toute façon ; et s'il passait, il occuperait la clé
// d'idempotence sans jamais partir — le vrai envoi, plus tard, serait
// refusé comme un doublon. L'état « pas de transporteur » se dit, il ne
// se stocke pas.
//
// ==================================================================
// CE QUE L'APPELANT NE CHOISIT PLUS, ET C'EST LA CORRECTION MAJEURE
// ==================================================================
//
// `OrdreEnvoi` ne porte plus de `variables`. Il désigne un GABARIT et
// un OBJET MÉTIER ; le texte se fabrique ICI, à partir de ce que la
// base rend sous le jeton de l'appelant.
//
// Avant, `variables` traversait la requête HTTP jusqu'au rendu sans
// validation. Un compte inscrit pouvait donc faire expédier, depuis le
// domaine authentifié d'Oasis (SPF, DKIM et DMARC alignés), un message
// au texte de son choix, avec l'objet de son choix et un bouton vers
// l'URL https de son choix. La seule chose qu'il ne choisissait pas
// était précisément l'adresse qui porte l'authentification.

import {
  composerEnveloppe,
  empreinteSha256,
  rendreMessageBrut,
  type CleGabarit,
  type ContexteRendu,
  type EnvoyeurCourriel,
  type IdentiteExpediteur,
  type MentionsEntreprise,
  type MessageRendu,
  type PieceJointe,
} from "./bibliotheque.ts";
import type { FaitObjet, MessageEnFile, PorteBase } from "./porte.ts";

/**
 * UN ORDRE D'ENVOI.
 *
 * REMARQUER CE QU'IL NE PORTE PAS : aucune adresse de destinataire,
 * aucun nom d'expéditeur, aucun objet, aucun corps, AUCUNE VARIABLE. Il
 * désigne un GABARIT et un OBJET MÉTIER ; tout le reste se lit en base.
 * C'est ce qui empêche cette fonction de devenir un formulaire d'envoi
 * de courrier arbitraire.
 */
export type OrdreEnvoi = {
  organizationId: string;
  gabarit: CleGabarit;
  entityType: "quote" | "invoice";
  entityId: string;
  /** 1 pour le premier envoi, 2 pour la première relance. Plafonné à 10 en base. */
  occurrence?: number;
};

export type Issue =
  | { etat: "envoye"; messageId: string; avertissements: string[] }
  /** La contrainte d'unicité a tranché : ce message était déjà parti. */
  | { etat: "deja"; messageId: string | null }
  /** Un refus motivé, en français, que le paysagiste lira. */
  | { etat: "refuse"; raison: string; messageId: string | null }
  /**
   * Le message est peut-être parti : on ne le sait pas, et on le dit
   * plutôt que de choisir la réponse qui arrange.
   */
  | { etat: "incertain"; raison: string; messageId: string }
  /** Aucun transporteur configuré. Ce n'est pas une panne. */
  | { etat: "indisponible"; raison: string };

/** Ce dont le rendu a besoin en plus de l'ordre. */
export type Reglages = {
  /** Racine des liens (désabonnement, portail). Vient de l'environnement. */
  baseUrl: string;
  /** L'adresse technique sur le domaine authentifié. */
  adresseTechnique: string;
  /** Ce qu'on sait joindre au message. Aujourd'hui : rien (voir `document-joint.ts`). */
  pieces?: PieceJointe[];
};

/**
 * LES QUATRE GABARITS QUE CETTE MACHINE SAIT DÉCLENCHER.
 *
 * Le catalogue en compte huit. Les quatre autres — l'invitation au
 * portail, la bienvenue, le changement de paramètre, l'annonce — ont
 * besoin de données qu'on ne peut PAS dériver d'un devis ou d'une
 * facture : un jeton d'invitation, un intitulé de réglage, un texte
 * rédigé. Tant qu'ils n'ont pas leur propre chemin, les accepter ici
 * reviendrait à rouvrir la porte qu'on vient de fermer — celle où
 * l'appelant fournit le contenu.
 */
const GABARITS_METIER: readonly CleGabarit[] = [
  "devisEnvoye",
  "devisRelance",
  "factureEmise",
  "factureRelance",
];

export async function traiterOrdre(
  ordre: OrdreEnvoi,
  porte: PorteBase,
  envoyeur: EnvoyeurCourriel,
  reglages: Reglages,
): Promise<Issue> {
  // 0. LE GABARIT EST-IL DE CEUX QUE CE CHEMIN SAIT NOURRIR ?
  if (!GABARITS_METIER.includes(ordre.gabarit)) {
    return {
      etat: "refuse",
      raison:
        "Ce type de message n'a pas encore de chemin d'envoi : seuls le devis, la facture et leurs relances partent d'ici.",
      messageId: null,
    };
  }
  if (
    (ordre.entityType === "quote") !== ordre.gabarit.startsWith("devis")
  ) {
    return {
      etat: "refuse",
      raison: "Ce message ne correspond pas au document auquel il se rattache.",
      messageId: null,
    };
  }

  // 1. LE TRANSPORTEUR.
  if (envoyeur.raisonIndisponibilite !== null) {
    return { etat: "indisponible", raison: envoyeur.raisonIndisponibilite };
  }

  // 2. L'OBJET MÉTIER, RELU SOUS LE JETON DE L'APPELANT.
  //    La RLS fait le cloisonnement : un devis d'une autre entreprise
  //    est simplement introuvable. La comparaison qui suit ne protège
  //    rien de plus, elle produit une PHRASE au lieu d'un silence.
  const fait = await porte.lireFait(ordre.entityType, ordre.entityId);
  if (fait === null) {
    return {
      etat: "refuse",
      raison: "Ce document est introuvable.",
      messageId: null,
    };
  }
  if (fait.organizationId !== ordre.organizationId) {
    return {
      etat: "refuse",
      raison: "Ce document n'appartient pas à votre entreprise.",
      messageId: null,
    };
  }
  if (fait.archiveLe !== null) {
    return { etat: "refuse", raison: "Ce document est archivé.", messageId: null };
  }
  // LE FAIT DATÉ, PAS LE STATUT. « Un statut se change, un fait daté
  // non » (0054). Sans lui, l'écriture n'a pas eu lieu.
  if (fait.dateFait === null) {
    return {
      etat: "refuse",
      raison:
        ordre.entityType === "quote"
          ? "Ce devis n'est pas marqué comme envoyé : aucun message ne part."
          : "Cette facture n'est pas émise : aucun message ne part.",
      messageId: null,
    };
  }
  if (fait.customerId === null) {
    return {
      etat: "refuse",
      raison: "Ce document n'est rattaché à aucun client : aucun message ne part.",
      messageId: null,
    };
  }

  // 3. L'ENTREPRISE. `email_sender_identity` rend une PHRASE plutôt que
  //    de lever : l'identité incomplète est un état normal auquel
  //    l'écran s'adapte.
  const identiteLue = await porte.lireIdentite(ordre.organizationId, ordre.gabarit);
  if (identiteLue.raisonBloquante !== null) {
    return { etat: "refuse", raison: identiteLue.raisonBloquante, messageId: null };
  }
  if (identiteLue.nomAffiche === null || identiteLue.repondreA === null) {
    return {
      etat: "refuse",
      raison: "L'identité de votre entreprise n'a pas pu être lue. Vérifiez ses paramètres.",
      messageId: null,
    };
  }

  const mentions = await porte.lireMentions(ordre.organizationId);
  if (mentions === null) {
    return { etat: "refuse", raison: "Entreprise introuvable.", messageId: null };
  }

  const identite: IdentiteExpediteur = {
    nomAffiche: identiteLue.nomAffiche,
    repondreA: identiteLue.repondreA,
    adresseTechnique: reglages.adresseTechnique,
    urlLogo: porte.urlPubliqueLogo(identiteLue.cheminLogo),
  };

  // 4. LE DESTINATAIRE, RÉSOLU EN BASE.
  const lu = await porte.lireDestinataire(ordre.organizationId, fait.customerId);
  if (lu.raisonBloquante !== null || lu.email === null) {
    return {
      etat: "refuse",
      raison:
        lu.raisonBloquante ??
        "Aucune adresse e-mail pour ce client. Renseignez-la sur sa fiche avant d'envoyer.",
      messageId: null,
    };
  }
  const destinataireEmail = lu.email;
  const destinataireNom = lu.nom;

  // 5. LES VARIABLES, FABRIQUÉES ICI À PARTIR DE CE QU'ON VIENT DE LIRE.
  const occurrence = ordre.occurrence ?? 1;
  const variables = construireVariables(ordre.gabarit, fait, destinataireNom, occurrence);

  // 6. LE RENDU.
  const rendu = await rendre(
    ordre.gabarit,
    variables,
    identite,
    mentions,
    reglages.baseUrl,
    ordre.organizationId,
    destinataireEmail,
    porte,
  );
  if ("refus" in rendu) return { etat: "refuse", raison: rendu.refus, messageId: null };

  // 7. LA MISE EN FILE — ET L'IDEMPOTENCE.
  const file = await porte.mettreEnFile({
    organizationId: ordre.organizationId,
    gabarit: ordre.gabarit,
    entityType: ordre.entityType,
    entityId: ordre.entityId,
    version: rendu.message.version,
    objet: rendu.message.objet,
    corpsTexte: rendu.message.texte,
    empreinteHtml: rendu.message.empreinteHtml,
    customerId: fait.customerId,
    variables,
    occurrence,
    campaignId: null,
  });

  if (!file.cree) {
    // TOUT `cree = false` ARRÊTE LE TRANSPORT, sans exception. La base a
    // refusé, ou la contrainte d'unicité a constaté un doublon ; les
    // deux cas se distinguent par `messageId`, qu'un doublon porte. On
    // ne se fie pas à la présence d'une phrase pour trancher : une
    // réponse sans phrase mais sans création ne doit pas devenir un
    // second envoi.
    if (file.messageId !== null) return { etat: "deja", messageId: file.messageId };
    return {
      etat: "refuse",
      raison: file.raisonBloquante ?? "La mise en file a été refusée sans motif.",
      messageId: null,
    };
  }
  if (file.messageId === null) {
    return {
      etat: "refuse",
      raison: "La mise en file n'a rien rendu : le message n'est pas parti.",
      messageId: null,
    };
  }

  // 8. LA RÉSERVATION. Un passage de file peut avoir pris la ligne
  //    entre l'insertion et maintenant : il l'expédiera, et nous ne
  //    devons pas le faire une seconde fois.
  if (!(await porte.reserverUn(file.messageId))) {
    return { etat: "deja", messageId: file.messageId };
  }

  // 9. LE TRANSPORT, PUIS LA MARQUE.
  return await transporter(
    file.messageId,
    rendu.message,
    identite,
    { email: destinataireEmail, nom: destinataireNom },
    reglages.pieces ?? [],
    porte,
    envoyeur,
    file.avertissements,
    false,
  );
}

/**
 * LES VARIABLES DU MESSAGE : CE QUI S'IMPRIME, ET RIEN DE PLUS.
 *
 * Un numéro, un montant, une date. Pas de marge, pas de coût d'achat,
 * pas de note interne, et surtout AUCUN JETON : un lien qui authentifie
 * sans expirer est la faute qu'on ne rattrape pas, parce qu'un courriel
 * se transfère.
 *
 * LES NOMS SONT CEUX DU CATALOGUE, ET C'EST VÉRIFIÉ PAR LE TYPE. La
 * version précédente émettait `totalTtcCents` là où le gabarit attend
 * `totalTtcCentimes` : la facture partait SANS SON MONTANT et la
 * première relance affichait « Retard : undefined jour » avec le ton
 * d'une dernière mise en demeure. Rien ne le signalait — les gabarits
 * omettent proprement une ligne dont la valeur manque, choix par
 * ailleurs juste, qui rendait l'erreur invisible.
 *
 * `lienDocument` reste absent : le portail client est verrouillé par
 * `auth.uid()`, et un bouton « Voir votre devis » tomberait sur un mur
 * de connexion. Le corps porte donc l'essentiel — numéro, montant,
 * échéance — pour rester utile sans lien.
 */
export function construireVariables(
  gabarit: CleGabarit,
  fait: FaitObjet,
  nomClient: string | null,
  occurrence: number,
): Record<string, unknown> {
  const nom = nomClient ?? "";
  const numero = fait.numero ?? "";

  if (gabarit === "devisEnvoye") {
    return {
      numero,
      nomClient: nom,
      totalTtcCentimes: fait.totalTtcCentimes,
      valableJusquau: fait.dateLimite,
    };
  }

  if (gabarit === "devisRelance") {
    return {
      numero,
      nomClient: nom,
      totalTtcCentimes: fait.totalTtcCentimes,
      valableJusquau: fait.dateLimite,
      // LE RANG EST L'OCCURRENCE, et il commande le TON du message : la
      // première relance suppose que le client a de bonnes raisons de
      // ne pas avoir répondu, la seconde est plus ferme. Le passer sous
      // un autre nom faisait employer le ton de la seconde dès la
      // première.
      rang: occurrence,
    };
  }

  if (gabarit === "factureEmise") {
    return {
      numero,
      nomClient: nom,
      totalTtcCentimes: fait.totalTtcCentimes,
      echeanceLe: fait.dateLimite,
    };
  }

  // factureRelance
  return {
    numero,
    nomClient: nom,
    // LE RESTE DÛ, PAS LE TOTAL : la vue `invoice_balance` déduit les
    // avoirs et les acomptes. Relancer sur le total après un acompte
    // coûte la relation.
    resteDuCentimes: fait.resteDuCentimes,
    echeanceLe: fait.dateLimite ?? "",
    joursDeRetard: joursDeRetard(fait.dateLimite),
    rang: occurrence,
  };
}

/**
 * Le nombre de jours de retard, à partir de l'échéance.
 *
 * Il se CALCULE : le laisser arriver dans la requête produisait
 * « Retard : undefined jour » dans le message d'un client.
 */
export function joursDeRetard(echeance: string | null, maintenant = new Date()): number {
  if (echeance === null || echeance.trim() === "") return 0;
  const due = new Date(`${echeance.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return 0;
  const jour = 24 * 60 * 60 * 1000;
  const aujourdhui = Date.UTC(
    maintenant.getUTCFullYear(),
    maintenant.getUTCMonth(),
    maintenant.getUTCDate(),
  );
  return Math.max(0, Math.round((aujourdhui - due.getTime()) / jour));
}

/**
 * Rendre, ou dire pourquoi on ne peut pas.
 *
 * LE JETON DE DÉSABONNEMENT N'EST LU QUE POUR LA PUBLICITÉ, et ce `if`
 * est le pendant exact de celui d'`email_gate` : la branche
 * transactionnelle ne consulte pas le registre de consentement — pas
 * « le consulte puis l'ignore » : ne le consulte pas. Le déplacer d'un
 * cran vers la gauche transformerait ce chantier en la panne qu'il
 * existe pour empêcher.
 */
async function rendre(
  gabarit: CleGabarit,
  variables: Record<string, unknown>,
  identite: IdentiteExpediteur,
  mentions: MentionsEntreprise,
  baseUrl: string,
  organizationId: string,
  email: string,
  porte: PorteBase,
): Promise<{ message: MessageRendu } | { refus: string }> {
  let ctx: ContexteRendu;

  if (gabarit === "annonceCommerciale") {
    const jeton = await porte.lireJetonDesabonnement(organizationId, email);
    if (jeton === null || jeton.trim() === "") {
      return {
        refus:
          "Aucun consentement enregistré pour cette adresse : le message commercial ne part pas, et il ne peut pas porter de lien de désabonnement valide.",
      };
    }
    ctx = { nature: "publicite", identite, mentions, baseUrl, jetonDesabonnement: jeton };
  } else {
    ctx = { nature: "transactionnel", identite, mentions, baseUrl };
  }

  try {
    return { message: await rendreMessageBrut(gabarit, variables, ctx) };
  } catch (erreur) {
    // Un gabarit inconnu ou des variables incohérentes sont un défaut de
    // programmation. On en fait un refus motivé plutôt qu'une panne de
    // la fonction : une fonction qui rend 500 finit par être coupée, et
    // l'on perd alors TOUS les envois, pas seulement celui-ci.
    const message = erreur instanceof Error ? erreur.message : "Rendu impossible.";
    return { refus: message };
  }
}

async function transporter(
  messageId: string,
  message: MessageRendu,
  identite: IdentiteExpediteur,
  destinataire: { email: string; nom: string | null },
  pieces: PieceJointe[],
  porte: PorteBase,
  envoyeur: EnvoyeurCourriel,
  avertissements: string[],
  /** Vrai pour une ligne dont l'empreinte enregistrée est un substitut. */
  empreinteProvisoire: boolean,
): Promise<Issue> {
  const enveloppe = composerEnveloppe(message, identite, destinataire, pieces);
  const resultat = await envoyeur.expedier(enveloppe);

  if (resultat.etat === "remis") {
    // L'EMPREINTE VRAIE, POUR LES LIGNES QUI N'EN AVAIENT PAS. Une
    // campagne est écrite en base avant que le HTML n'existe : sa ligne
    // portait l'empreinte du TEXTE, présentée comme celle du HTML.
    const empreinte = empreinteProvisoire ? await empreinteSha256(enveloppe.html) : null;
    const marque = await porte.marquerEnvoye(
      messageId,
      envoyeur.cle,
      resultat.identifiantTransporteur,
      empreinte,
    );
    if (!marque) {
      // LE MESSAGE EST PARTI ET LA BASE NE LE SAIT PAS. On ne peut plus
      // rien réparer d'ici ; ce qu'on peut, c'est ne pas prétendre que
      // tout va bien. Sans cette branche, la ligne restait « en
      // attente » et le passage suivant la réexpédiait — à chaque
      // passage, indéfiniment.
      await porte.marquerSortInconnu(
        messageId,
        "Ce message est parti, mais nous n'avons pas pu l'enregistrer comme tel. Vérifiez avant de le renvoyer.",
        envoyeur.cle,
      );
      return {
        etat: "incertain",
        raison:
          "Ce message est parti, mais nous n'avons pas pu l'enregistrer comme tel. Vérifiez avant de le renvoyer.",
        messageId,
      };
    }
    return { etat: "envoye", messageId, avertissements };
  }

  if (resultat.etat === "indisponible") {
    // Le transporteur a disparu ENTRE la vérification et l'envoi. On
    // REND SA RÉSERVATION pour que le message reparte au prochain
    // passage : sans cela il resterait « en cours d'envoi » pour
    // toujours, sans jamais partir ni jamais échouer.
    await porte.marquerEchec(messageId, resultat.raison, "transporteur", null, true);
    return { etat: "indisponible", raison: resultat.raison };
  }

  if (resultat.etat === "incertain") {
    await porte.marquerSortInconnu(messageId, resultat.raison, envoyeur.cle);
    return { etat: "incertain", raison: resultat.raison, messageId };
  }

  await porte.marquerEchec(
    messageId,
    resultat.raison,
    resultat.code,
    envoyeur.cle,
    resultat.temporaire,
  );
  return { etat: "refuse", raison: resultat.raison, messageId };
}

// ==================================================================
// LA FILE — CE QUI A ÉTÉ ENFILÉ PAR LA BASE ELLE-MÊME
// ==================================================================
//
// `admin_send_email_campaign()` écrit directement dans `email_messages`,
// une ligne par entreprise, sans jamais appeler cette fonction. Ces
// lignes attendent et personne ne les transporte : c'est ce passage-là
// qui les prend. Y passent aussi les messages restés en file après une
// indisponibilité du transporteur ou un échec temporaire.
//
// IL RÉSERVE AVANT DE TRANSPORTER. Un `select … where status = 'queued'`
// suivi d'un appel sortant laisse deux passages simultanés expédier deux
// fois chaque message — et le doublon est invisible dans le journal.
//
// IL REJOUE LA PORTE. Une ligne peut attendre longtemps : entre sa
// préparation et son transport, la facture a pu être annulée,
// l'entreprise suspendue, l'adresse s'être plainte.
//
// IL RE-REND LE MESSAGE plutôt que de lire un HTML stocké, parce
// qu'aucun HTML n'est stocké — le journal ne garde que son empreinte. Le
// gabarit, sa version et les variables suffisent à refabriquer le
// message à l'identique, et c'est précisément ce que l'empreinte permet
// de PROUVER.

export type BilanFile = {
  traites: number;
  envoyes: number;
  echecs: number;
  /** Les messages dont on ne sait pas s'ils sont partis. Un humain doit regarder. */
  incertains: number;
  /** Ceux que la porte a arrêtés au moment d'expédier. */
  arretes: number;
  /** Renseigné quand rien n'a pu partir faute de transporteur. */
  indisponible: string | null;
};

export async function viderFile(
  porte: PorteBase,
  envoyeur: EnvoyeurCourriel,
  reglages: Reglages,
  limite = 50,
): Promise<BilanFile> {
  const vide: BilanFile = {
    traites: 0, envoyes: 0, echecs: 0, incertains: 0, arretes: 0, indisponible: null,
  };
  if (envoyeur.raisonIndisponibilite !== null) {
    return { ...vide, indisponible: envoyeur.raisonIndisponibilite };
  }

  // LA RÉSERVATION EST LA PREMIÈRE CHOSE QUI SE PASSE. Les lignes
  // rendues ici sont déjà passées en « en cours d'envoi » : aucun autre
  // passage ne peut plus les voir.
  const messages = await porte.reserverFile(limite);
  const bilan: BilanFile = { ...vide, traites: messages.length };

  for (const enFile of messages) {
    const issue = await transporterDepuisLaFile(enFile, porte, envoyeur, reglages);
    if (issue === "envoye") bilan.envoyes += 1;
    else if (issue === "incertain") bilan.incertains += 1;
    else if (issue === "arrete") bilan.arretes += 1;
    else bilan.echecs += 1;
  }

  return bilan;
}

async function transporterDepuisLaFile(
  enFile: MessageEnFile,
  porte: PorteBase,
  envoyeur: EnvoyeurCourriel,
  reglages: Reglages,
): Promise<"envoye" | "echec" | "incertain" | "arrete"> {
  // LA PORTE, D'ABORD. C'est la MÊME fonction qu'à la mise en file —
  // `email_gate`, rejouée en base par `email_still_sendable` — et non un
  // second jeu de règles écrit ici. Deux jeux auraient divergé, et la
  // divergence aurait été invisible jusqu'au jour où elle aurait laissé
  // partir ce qu'il fallait retenir.
  const verdict = await porte.verifierEncoreExpediable(enFile.id);
  if (!verdict.ok) {
    await porte.marquerEchec(
      enFile.id,
      verdict.raison ?? "Ce message ne peut plus être expédié.",
      "porte",
      null,
      false,
    );
    return "arrete";
  }

  const identiteLue = await porte.lireIdentite(enFile.organizationId, enFile.gabarit);
  // POUR UNE ANNONCE, LES MENTIONS SONT CELLES D'OASIS. Le pied d'une
  // publicité imprimait le SIRET et l'assurance décennale de
  // l'entreprise qui la RECEVAIT.
  const mentions = await porte.lireMentions(
    enFile.organizationId,
    enFile.nature === "publicite",
  );

  if (identiteLue.raisonBloquante !== null || identiteLue.nomAffiche === null
      || identiteLue.repondreA === null || mentions === null) {
    await porte.marquerEchec(
      enFile.id,
      identiteLue.raisonBloquante ??
        "L'identité de l'entreprise n'a pas pu être lue au moment d'expédier.",
      "identite",
      envoyeur.cle,
      false,
    );
    return "echec";
  }

  const identite: IdentiteExpediteur = {
    nomAffiche: identiteLue.nomAffiche,
    repondreA: identiteLue.repondreA,
    adresseTechnique: reglages.adresseTechnique,
    urlLogo: porte.urlPubliqueLogo(identiteLue.cheminLogo),
  };

  // LE CORPS D'UNE CAMPAGNE EST DANS LA LIGNE, pas dans le gabarit :
  // c'est un administrateur qui l'a rédigé. Le gabarit ne fournit que
  // l'enveloppe, le pied et le désabonnement.
  const variables =
    enFile.gabarit === "annonceCommerciale"
      ? {
          nomEntreprise: String(enFile.variables.entreprise ?? enFile.destinataireNom ?? ""),
          objet: enFile.objet,
          corpsTexte: enFile.corpsTexte,
        }
      : enFile.variables;

  const rendu = await rendre(
    enFile.gabarit,
    variables,
    identite,
    mentions,
    reglages.baseUrl,
    enFile.organizationId,
    enFile.destinataireEmail,
    porte,
  );
  if ("refus" in rendu) {
    await porte.marquerEchec(enFile.id, rendu.refus, "rendu", envoyeur.cle, false);
    return "echec";
  }

  const issue = await transporter(
    enFile.id,
    rendu.message,
    identite,
    { email: enFile.destinataireEmail, nom: enFile.destinataireNom },
    reglages.pieces ?? [],
    porte,
    envoyeur,
    [],
    enFile.empreinteProvisoire,
  );
  if (issue.etat === "envoye") return "envoye";
  if (issue.etat === "incertain") return "incertain";
  return "echec";
}

// ==================================================================
// LE WEBHOOK — CE QUE LE TRANSPORTEUR NOUS RAPPORTE
// ==================================================================
//
// À QUOI IL SERT VRAIMENT : les rebonds reviennent chez Oasis, pas chez
// le paysagiste, parce que c'est le domaine d'Oasis qui expédie. Sans ce
// retour, le paysagiste attendrait la réponse à un devis jamais arrivé,
// et le produit mentirait par omission. C'est la contrepartie du motif
// CRM, et elle n'est pas facultative.
//
// LES ÉVÉNEMENTS INCONNUS SONT IGNORÉS, PAS REFUSÉS. Un transporteur qui
// reçoit des 500 finit par désactiver le point de terminaison, et l'on
// perd alors TOUS les rebonds, silencieusement — le pire des deux maux.

export type BilanNouvelles = { lues: number; ignorees: number };

export async function traiterNouvelles(
  charge: unknown,
  porte: PorteBase,
  envoyeur: EnvoyeurCourriel,
): Promise<BilanNouvelles> {
  if (typeof envoyeur.lireNouvelle !== "function") return { lues: 0, ignorees: 0 };

  // Le transporteur poste tantôt un objet, tantôt un tableau. On accepte
  // les deux : n'en accepter qu'un jetterait la moitié des rebonds sans
  // que rien ne le signale.
  const charges = Array.isArray(charge) ? charge : [charge];
  let lues = 0;
  let ignorees = 0;

  for (const une of charges) {
    const nouvelle = envoyeur.lireNouvelle(une);
    if (nouvelle === null) {
      ignorees += 1;
      continue;
    }
    await porte.enregistrerEvenement(
      envoyeur.cle,
      nouvelle.identifiantTransporteur,
      nouvelle.evenement,
      nouvelle.instant,
      nouvelle.raison,
      nouvelle.charge,
    );
    lues += 1;
  }

  return { lues, ignorees };
}
