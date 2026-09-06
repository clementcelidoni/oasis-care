// Oasis Care — Les relances. LA PORTE VERS LA FILE.
//
// ==================================================================
// UNE INTERFACE, PARCE QUE C'EST ELLE QUI REND LES TESTS JOUABLES
// ==================================================================
//
// `traitement.ts` — l'orchestration, c'est-à-dire la partie où l'on se
// trompe — ne connaît que ce fichier. Les tests lui donnent un double
// qui enregistre ce qu'on lui demande ; aucun test de ce chantier n'a
// besoin ni du réseau ni d'une base. VIES tombe, Brevo tombe, Stripe
// tombe : un test qui exigerait l'un des trois ne tournerait jamais.
//
// ==================================================================
// CE QUE CETTE PORTE NE PROPOSE PAS, ET C'EST LE SUJET
// ==================================================================
//
// Il n'y a AUCUNE méthode pour calculer une échéance, choisir un rang
// de relance, lire un devis ou décider qu'une entreprise doit être
// relancée. Tout cela appartient à `relances_calculer()` (0089 § 9.a),
// qui tourne dans la base, à l'heure dite, et qui DÉPOSE.
//
// Cette fonction Edge PUISE. Elle ne décide de rien — et il ne faut
// surtout pas qu'elle apprenne à décider : deux calculs d'échéance dans
// deux langages différents finiraient par diverger, et la divergence se
// verrait sous la forme d'un client relancé deux fois le même jour.

/**
 * Une ligne de `relances_planifiees` réservée pour expédition.
 *
 * C'est exactement ce que rend `relances_a_expedier(limite, passage)`,
 * pas une colonne de plus. Ni la date d'échéance, ni la date de dépôt :
 * les relire ici donnerait envie de les recalculer.
 */
export type RelanceReservee = {
  id: string;
  organizationId: string;
  entityType: "quote" | "invoice";
  entityId: string;
  templateKey: string;
  /** 1 est le premier envoi : une relance commence donc à 2. */
  occurrence: number;
  customerId: string | null;
  /** Le fait daté qui a déclenché le calcul. Pour l'enquête, jamais pour la logique. */
  referenceOn: string;
};

export interface PorteFile {
  /**
   * RÉSERVER, ET RENDRE CE QUI EST RÉSERVÉ.
   *
   * C'est un `update … for update skip locked` en base (0089 § 9.b),
   * jamais un `select` suivi d'un `update` : deux passages simultanés
   * ne prennent pas la même ligne. La contrainte d'unicité de la file,
   * elle, ne garde que le DÉPÔT et ne protège pas ce chemin-ci.
   */
  reserver(limite: number): Promise<RelanceReservee[]>;

  /**
   * LA RELANCE A ATTEINT LE JOURNAL D'ENVOI, ET C'EST TOUT CE QU'ON
   * PROMET.
   *
   * `email_message_id` fait le lien vers `email_messages` (0084), qui
   * reste la SEULE vérité sur ce qu'un client a reçu. Cette file dit ce
   * qui était dû ; elle ne dit pas ce qui est arrivé.
   */
  marquerFaite(id: string, emailMessageId: string | null): Promise<boolean>;

  /**
   * ABANDON MOTIVÉ. Pas un échec technique : la porte `email_gate()` a
   * refusé, l'adresse est en liste de suppression, le document a été
   * archivé depuis le dépôt. La raison est écrite en français parce
   * qu'un membre de l'entreprise la lira dans son écran.
   */
  marquerAbandonnee(id: string, motif: string): Promise<boolean>;
}
