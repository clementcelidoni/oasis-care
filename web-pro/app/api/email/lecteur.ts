/**
 * §EMAILS — CE QUE LES DÉCLENCHEURS ONT BESOIN DE LIRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE INTERFACE PLUTÔT QUE LE CLIENT SUPABASE DIRECTEMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Deux raisons, et la seconde est la vraie.
 *
 *   1. Un test qui exigerait le réseau ne tournerait jamais. Ce
 *      chantier se prouve contre un double simulé, sans un seul appel
 *      sortant : c'est cette interface qui rend le double possible en
 *      quatre lignes plutôt qu'en imitant la grammaire de PostgREST.
 *
 *   2. ELLE DIT EXACTEMENT CE QUE LE CHEMIN D'ENVOI A LE DROIT DE
 *      LIRE, et le tient court. Quatre méthodes, aucune qui rende une
 *      adresse e-mail, aucune qui accepte un identifiant de client
 *      venu d'ailleurs. Le destinataire n'est pas ici : il se résout en
 *      base, dans `email_recipient_for_customer`, et il n'y a donc pas
 *      de code dans ce module qui pourrait le remplacer par un
 *      paramètre de requête.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON LIT LE FAIT DATÉ, JAMAIS LE STATUT
 * ══════════════════════════════════════════════════════════════════
 *
 * `sent_at` pour un devis, `issued_at` pour une facture. La migration
 * 0054 le dit noir sur blanc à propos de l'émission : « Sa présence, et
 * non le statut, est ce que le déclencheur regarde : un statut se
 * change, un fait daté non. » Un statut qu'on repasse de « émise » à
 * « brouillon » puis à « émise » rejouerait l'envoi ; un `issued_at`
 * non.
 */

/** L'entreprise qui expédie. Toujours résolue côté serveur. */
export type ContexteOrganisation = { organizationId: string };

/**
 * Le devis, réduit à ce qui sert à décider et à imprimer.
 *
 * Aucun montant de marge, aucune note interne : ce sont les variables
 * du message, et un message ne porte que ce que le client a le droit de
 * voir.
 */
export type FaitDevis = {
  id: string;
  organizationId: string;
  customerId: string;
  numero: string;
  titre: string;
  /** Le fait daté. `null` = le devis n'a jamais été marqué « envoyé ». */
  envoyeLe: string | null;
  /** `null` = une décision est tombée, il n'y a plus rien à relancer. */
  decideLe: string | null;
  valableJusquau: string | null;
  archiveLe: string | null;
  statut: string;
  totalTtcCents: number | null;
};

/**
 * La facture, réduite de même.
 *
 * `resteDuCents` vient de la vue `invoice_balance` — jamais d'un
 * `total - payé` recalculé ici : la vue tient compte des avoirs, et
 * relancer un client pour une facture qu'on lui a créditée est le genre
 * d'erreur qui coûte la relation.
 */
export type FaitFacture = {
  id: string;
  organizationId: string;
  customerId: string;
  numero: string | null;
  /** Le fait daté. `null` = brouillon, rien n'est opposable, rien ne part. */
  emiseLe: string | null;
  echeanceLe: string | null;
  archiveLe: string | null;
  statut: string;
  totalTtcCents: number | null;
  resteDuCents: number | null;
};

/**
 * Le réglage des relances, par entreprise.
 *
 * DÉSACTIVÉES PAR DÉFAUT, et ce n'est pas une prudence de développeur :
 * un paysagiste qui découvre que son logiciel a relancé un client avec
 * qui il était au téléphone la veille perd la confiance d'un coup, et
 * il ne la retrouve pas. L'absence de ligne en base vaut donc
 * « désactivé », et c'est `reglagesParDefaut` qui l'énonce.
 *
 * LE DÉLAI N'EST PAS CODÉ EN DUR : il se règle entreprise par
 * entreprise dans `email_organization_settings`, et la valeur ci-dessous
 * n'est que le défaut de la colonne, recopié pour le cas « aucune ligne ».
 */
export type ReglagesRelances = {
  organizationId: string;
  actives: boolean;
  delaiJours: number;
  nombreMaximum: number;
  /** Suspension décidée par un humain, avec motif. Coupe tout. */
  suspendueLe: string | null;
  motifSuspension: string | null;
};

export const REGLAGES_RELANCES_PAR_DEFAUT: Omit<ReglagesRelances, "organizationId"> = {
  actives: false,
  delaiJours: 7,
  nombreMaximum: 2,
  suspendueLe: null,
  motifSuspension: null,
};

export function reglagesParDefaut(organizationId: string): ReglagesRelances {
  return { organizationId, ...REGLAGES_RELANCES_PAR_DEFAUT };
}

/**
 * Un envoi déjà inscrit au journal, pour un objet et un gabarit donnés.
 *
 * SERT À NE PAS TRAVAILLER POUR RIEN, ET SÛREMENT PAS À GARANTIR
 * L'IDEMPOTENCE. La garantie est la contrainte d'unicité sur la colonne
 * générée `idempotency_key` (0084), et elle seule : entre le moment où
 * l'on demande « est-ce déjà parti ? » et celui où l'on insère, l'autre
 * onglet a le temps d'insérer. Ce qu'on lit ici évite de rendre un
 * gabarit et d'appeler le transporteur pour se faire refuser trois
 * lignes plus loin — c'est une économie, pas un verrou.
 */
export type RangsDejaEnvoyes = {
  typeObjet: "quote" | "invoice";
  objetId: string;
  gabarit: string;
  rangs: number[];
};

export interface LecteurEmail {
  lireDevis(quoteId: string): Promise<FaitDevis | null>;
  lireFacture(invoiceId: string): Promise<FaitFacture | null>;

  lireReglages(organizationId: string): Promise<ReglagesRelances>;

  /**
   * Les devis expédiés, sans décision, dont la relance est encore
   * possible. Le filtrage fin (la cadence, le rang) se fait dans
   * `relances.ts`, où il est testable sans base.
   */
  listerDevisRelancables(organizationId: string): Promise<FaitDevis[]>;

  /** Les factures émises dont le solde restant est positif. */
  listerFacturesRelancables(organizationId: string): Promise<FaitFacture[]>;

  /** Les rangs déjà inscrits au journal, par objet et par gabarit. */
  lireRangsEnvoyes(
    typeObjet: "quote" | "invoice",
    objetIds: string[],
    gabarit: string,
  ): Promise<RangsDejaEnvoyes[]>;
}
