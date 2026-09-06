import { classerRefus, type MotifExclusion } from "./libelles.ts";
import type { EntrepriseDuParc, IdentiteExpediteur, VerdictPorte } from "./types.ts";

/**
 * ==================================================================
 * QUI VA RECEVOIR — et surtout : QUI NE VA PAS RECEVOIR, ET POURQUOI
 * ==================================================================
 *
 * « Envoyer à cinq cents personnes sans avoir vu qui elles sont » est
 * la façon la plus simple de brûler la réputation d'un domaine partagé.
 * Cet écran montre le compte exact AVANT le clic, et il montre les
 * écartés avec leur motif — parce qu'un total qui passe de 40 à 12 sans
 * explication fait cliquer quand même, alors qu'une liste de motifs
 * fait corriger.
 *
 * ------------------------------------------------------------------
 * L'APERÇU N'EST PAS UNE APPROXIMATION, ET C'EST LE POINT
 * ------------------------------------------------------------------
 * Il ne réimplémente RIEN. Pour chaque entreprise, l'appelant a posé à
 * la base les DEUX MÊMES QUESTIONS, DANS LE MÊME ORDRE, que
 * `email_enqueue()` posera au moment de l'envoi :
 *
 *   1. `email_sender_identity(entreprise, gabarit)` — qui donne le nom
 *      affiché, et surtout l'adresse de réponse, qui EST le
 *      destinataire quand le message s'adresse à l'entreprise ;
 *   2. `email_gate(entreprise, gabarit, cette adresse)` — le
 *      consentement, la liste de suppression, la suspension.
 *
 * Ce fichier ne fait que ranger les réponses. Recopier la logique de la
 * porte en TypeScript aurait produit une seconde règle du consentement,
 * qui aurait divergé au premier correctif — et le jour où elles
 * divergent, l'écran promet un envoi que la base refuse, ou pire :
 * annonce un refus et laisse partir.
 *
 * IL RESTE UNE INCERTITUDE, ET ELLE EST NOMMÉE À L'ÉCRAN. Entre
 * l'aperçu et le clic, une entreprise peut se désabonner ou changer
 * d'adresse. La confirmation revérifie donc le compte côté serveur, et
 * refuse si le nombre a bougé.
 */

/** Une entreprise retenue, avec ce qu'elle va recevoir et où. */
export type Retenue = {
  organizationId: string;
  nom: string;
  /** Le destinataire réel, tel que `email_sender_identity` l'a rendu. */
  destinataire: string;
  /**
   * Le nom qui s'affichera dans la boîte du destinataire.
   *
   * POUR UNE ANNONCE D'OASIS, C'EST LE NOM DE L'ENTREPRISE DESTINATAIRE
   * ELLE-MÊME, et c'est un défaut de la couche d'envoi, pas de cet
   * écran : `email_enqueue` recopie l'identité de `p_organization_id`,
   * qui pour une campagne est le RECEVEUR. Le paysagiste recevra donc
   * une publicité d'Oasis Care signée de son propre nom, avec une
   * adresse de réponse pointant sa propre boîte. L'aperçu le montre
   * plutôt que de le corriger en douce : le corriger ici donnerait un
   * écran qui ment dans le bon sens, ce qui est pire.
   */
  nomAffiche: string;
  /** Les réserves de la base : logo absent, TVA absente… Elles n'arrêtent rien. */
  avertissements: string[];
  /**
   * Le forfait et l'état d'abonnement, tels que `admin_list_organizations`
   * les rend.
   *
   * ILS NE FILTRENT RIEN, ET C'EST LE POINT DOULOUREUX DE CET ÉCRAN.
   * `admin_send_email_campaign()` parcourt TOUTES les entreprises non
   * archivées ayant une adresse : elle n'a pas de paramètre de ciblage.
   * Écrire ici un sélecteur « seulement les essais » aurait donné un
   * écran qui promet un filtre que le serveur ignore — c'est-à-dire un
   * envoi à cinq cents personnes sous l'étiquette « trente ». Ces deux
   * champs servent donc à MONTRER la composition de l'audience, jamais
   * à la restreindre, et l'écran dit ce qu'il faudrait pour que le
   * ciblage existe.
   */
  plan: string | null;
  abonnement: string | null;
};

/** Une entreprise écartée, avec la phrase exacte de la base. */
export type Ecartee = {
  organizationId: string;
  nom: string;
  motif: MotifExclusion;
  /** La phrase de la base, montrée telle quelle. */
  phrase: string;
};

export type Audience = {
  retenues: Retenue[];
  ecartees: Ecartee[];
  /** Combien par motif, pour un résumé lisible en une ligne. */
  parMotif: { motif: MotifExclusion; nombre: number }[];
  /** Les entreprises examinées — archivées comprises, parce qu'elles sont écartées et comptées. */
  examinees: number;
};

/**
 * Ce que l'appelant a lu en base pour UNE entreprise.
 *
 * `identite` et `porte` peuvent être nulles quand l'appel a échoué —
 * une entreprise dont on ne sait rien est écartée avec un motif qui le
 * dit, jamais retenue par défaut. Le défaut d'un aperçu doit être
 * « n'envoie pas », pas « envoie ».
 */
export type LectureEntreprise = {
  entreprise: EntrepriseDuParc;
  identite: IdentiteExpediteur | null;
  porte: VerdictPorte | null;
};

/**
 * Range les lectures en retenues et écartées.
 *
 * Fonction PURE : aucune base, aucun réseau, donc éprouvable — et c'est
 * ce qui permet d'écrire le test qui interdit qu'un client final entre
 * dans une audience publicitaire.
 */
export function composerAudience(lectures: readonly LectureEntreprise[]): Audience {
  const retenues: Retenue[] = [];
  const ecartees: Ecartee[] = [];

  for (const lecture of lectures) {
    const { entreprise, identite, porte } = lecture;

    // L'ARCHIVAGE D'ABORD. `admin_send_email_campaign` ne visite que
    // les entreprises non archivées : une archivée n'apparaîtra ni dans
    // `queued_count` ni dans `skipped_count`. La compter ici, et la
    // nommer, est ce qui permet à l'écran de réconcilier ses totaux
    // avec ceux que la base rendra après l'envoi.
    if (entreprise.archived_at !== null) {
      ecartees.push({
        organizationId: entreprise.organization_id,
        nom: entreprise.name,
        motif: "archivee",
        phrase:
          "Cette entreprise est archivée : la boucle d'envoi ne la visite pas, elle n'apparaîtra dans aucun compteur.",
      });
      continue;
    }

    if (identite === null) {
      ecartees.push({
        organizationId: entreprise.organization_id,
        nom: entreprise.name,
        motif: "autre",
        phrase:
          "L'identité d'expéditeur de cette entreprise n'a pas pu être lue. Elle est écartée de l'aperçu : une entreprise dont on ne sait rien ne reçoit rien.",
      });
      continue;
    }

    if (identite.blocking_reason !== null) {
      ecartees.push({
        organizationId: entreprise.organization_id,
        nom: entreprise.name,
        motif: classerRefus(identite.blocking_reason),
        phrase: identite.blocking_reason,
      });
      continue;
    }

    const destinataire = identite.reply_to_email;
    if (destinataire === null || destinataire.trim() === "") {
      // Ne devrait pas arriver : `email_sender_identity` rend un
      // `blocking_reason` dans ce cas. On le traite quand même, parce
      // qu'un `null` inattendu qui se transforme en envoi est
      // exactement le genre de trou qu'on ne voit qu'en production.
      ecartees.push({
        organizationId: entreprise.organization_id,
        nom: entreprise.name,
        motif: "sansAdresse",
        phrase: "Aucune adresse de réponse rendue par la base, sans motif de blocage. Cas anormal : rien n'est envoyé.",
      });
      continue;
    }

    if (porte === null) {
      ecartees.push({
        organizationId: entreprise.organization_id,
        nom: entreprise.name,
        motif: "autre",
        phrase:
          "La porte n'a pas pu être interrogée pour cette entreprise. Elle est écartée de l'aperçu plutôt que supposée acceptée.",
      });
      continue;
    }

    if (!porte.allowed) {
      ecartees.push({
        organizationId: entreprise.organization_id,
        nom: entreprise.name,
        motif: classerRefus(porte.blocking_reason),
        phrase: porte.blocking_reason ?? "Refusée par la porte, sans motif rendu.",
      });
      continue;
    }

    retenues.push({
      organizationId: entreprise.organization_id,
      nom: entreprise.name,
      destinataire,
      nomAffiche: identite.from_name ?? entreprise.name,
      avertissements: [...identite.warnings, ...porte.warnings],
      plan: entreprise.plan,
      abonnement: entreprise.subscription_status,
    });
  }

  const compte = new Map<MotifExclusion, number>();
  for (const ecartee of ecartees) {
    compte.set(ecartee.motif, (compte.get(ecartee.motif) ?? 0) + 1);
  }

  return {
    retenues,
    ecartees,
    parMotif: [...compte.entries()]
      .map(([motif, nombre]) => ({ motif, nombre }))
      .sort((a, b) => b.nombre - a.nombre),
    examinees: lectures.length,
  };
}

/**
 * La composition de l'audience, par forfait.
 *
 * ELLE NE FILTRE RIEN. C'est le compromis honnête d'un écran qui ne
 * PEUT pas cibler : `admin_send_email_campaign()` n'a aucun paramètre
 * d'audience, elle parcourt toutes les entreprises non archivées ayant
 * une adresse. Offrir une liste déroulante « seulement les essais »
 * aurait produit le pire défaut possible pour ce panneau — un écran qui
 * annonce trente destinataires et un serveur qui en sert cinq cents.
 *
 * Montrer la composition permet au moins de décider en connaissance de
 * cause : « cette annonce parlera d'une option payante à onze
 * entreprises qui l'ont déjà » se voit ici, et se corrige dans le
 * texte.
 *
 * `subscription_status` vaut 'trialing' quand l'essai court (0060), et
 * `null` quand aucun abonnement n'est suivi — ce qui est le cas de tout
 * le parc aujourd'hui, `organization_subscriptions` n'étant écrite par
 * personne. « Aucun abonnement suivi » n'est donc pas « pas client » :
 * l'écran garde les deux mots distincts.
 */
export function repartirParForfait(
  retenues: readonly Retenue[],
): { libelle: string; nombre: number }[] {
  const compte = new Map<string, number>();
  for (const retenue of retenues) {
    const libelle =
      retenue.abonnement === "trialing"
        ? `${retenue.plan ?? "Sans forfait"} — en essai`
        : (retenue.plan ?? "Aucun abonnement suivi");
    compte.set(libelle, (compte.get(libelle) ?? 0) + 1);
  }
  return [...compte.entries()]
    .map(([libelle, nombre]) => ({ libelle, nombre }))
    .sort((a, b) => b.nombre - a.nombre);
}

/**
 * L'empreinte de l'audience, pour que la confirmation porte sur CE
 * qu'on a vu et pas seulement sur COMBIEN.
 *
 * POURQUOI PAS LE SEUL NOMBRE : deux entreprises qui se croisent — l'une
 * se désabonne, l'autre consent — laissent le total inchangé alors que
 * la liste a changé. Un contrôle sur le nombre seul laisserait partir un
 * message vers quelqu'un que l'administrateur n'a jamais vu à l'écran.
 * La liste triée des identifiants, elle, bouge dès qu'un destinataire
 * change.
 *
 * Ce n'est pas une empreinte cryptographique et elle n'a pas à l'être :
 * elle ne protège de rien d'hostile, elle constate un écart entre deux
 * instants. Le contrôle qui compte est de toute façon refait en base.
 */
export function empreinteAudience(audience: Audience): string {
  return audience.retenues
    .map((retenue) => retenue.organizationId)
    .sort()
    .join(",");
}
