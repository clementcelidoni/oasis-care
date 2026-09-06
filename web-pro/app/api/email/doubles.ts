import type {
  FaitDevis, FaitFacture, LecteurEmail, RangsDejaEnvoyes, ReglagesRelances,
} from "./lecteur.ts";
import { reglagesParDefaut } from "./lecteur.ts";
import type { DemandeEnvoi, PortEmail, ResultatEnvoi } from "./port.ts";

/**
 * §EMAILS — LES DOUBLES SIMULÉS.
 *
 * AUCUN APPEL RÉSEAU DANS CE CHANTIER, et cette règle n'est pas une
 * préférence de confort : un test qui exigerait Brevo ou Supabase ne
 * tournerait ni en intégration continue, ni sur la machine de quelqu'un
 * qui n'a pas les clés — donc ne tournerait jamais, donc ne
 * défendrait rien.
 *
 * Ces doubles vivent dans un fichier ordinaire plutôt que dans un
 * dossier `_test` parce qu'ils servent à DEUX épreuves et qu'une copie
 * dans chacune finirait par diverger. Ils n'ont aucune dépendance : ni
 * `next`, ni `@supabase`, ni l'alias `@/`.
 *
 * ── LE DOUBLE DU TRANSPORTEUR EST UN ENREGISTREUR ───────────────────
 *
 * `PortEspion` retient les demandes reçues, et c'est ce qui permet de
 * vérifier la propriété la plus importante de tout le chantier : qu'une
 * demande ne porte NI adresse de destinataire, NI nom d'expéditeur
 * libre. Le test ne lit pas le commentaire qui l'affirme, il lit les
 * clés de l'objet.
 */

export class PortEspion implements PortEmail {
  readonly identifiant = "espion";
  raisonIndisponible: string | null = null;

  /** Tout ce qu'on lui a demandé d'expédier, dans l'ordre. */
  readonly demandes: DemandeEnvoi[] = [];

  /**
   * Les clés d'idempotence déjà vues — l'imitation fidèle de la
   * contrainte d'unicité sur la colonne générée `idempotency_key`.
   * Deuxième demande identique : `dejaParti`, comme en base.
   */
  readonly #cles = new Map<string, string>();

  /** Un refus métier à rendre au prochain appel (adresse absente…). */
  refusProchain: string | null = null;

  /** Une exception à lever au prochain appel, pour éprouver la digue. */
  leveProchain: Error | null = null;

  #compteur = 0;

  async mettreEnFile(demande: DemandeEnvoi): Promise<ResultatEnvoi> {
    this.demandes.push(demande);

    if (this.leveProchain) {
      const erreur = this.leveProchain;
      this.leveProchain = null;
      throw erreur;
    }

    if (this.refusProchain) {
      const raison = this.refusProchain;
      this.refusProchain = null;
      return { etat: "refuse", raison, avertissements: [] };
    }

    const cle = `transactionnel:${demande.typeObjet}:${demande.objetId}:${demande.gabarit}:${demande.occurrence}`;
    const deja = this.#cles.get(cle);
    if (deja) return { etat: "dejaParti", messageId: deja };

    this.#compteur += 1;
    const messageId = `msg-${this.#compteur}`;
    this.#cles.set(cle, messageId);
    return { etat: "misEnFile", messageId, avertissements: [] };
  }
}

export class LecteurDouble implements LecteurEmail {
  devis = new Map<string, FaitDevis>();
  factures = new Map<string, FaitFacture>();
  reglages = new Map<string, ReglagesRelances>();
  /** Clé : `${typeObjet}:${objetId}:${gabarit}`. */
  rangs = new Map<string, number[]>();

  /** Une panne de lecture, pour vérifier qu'elle ne remonte pas. */
  panne: Error | null = null;

  async lireDevis(quoteId: string): Promise<FaitDevis | null> {
    if (this.panne) throw this.panne;
    return this.devis.get(quoteId) ?? null;
  }

  async lireFacture(invoiceId: string): Promise<FaitFacture | null> {
    if (this.panne) throw this.panne;
    return this.factures.get(invoiceId) ?? null;
  }

  async lireReglages(organizationId: string): Promise<ReglagesRelances> {
    return this.reglages.get(organizationId) ?? reglagesParDefaut(organizationId);
  }

  async listerDevisRelancables(organizationId: string): Promise<FaitDevis[]> {
    return [...this.devis.values()].filter((d) => d.organizationId === organizationId);
  }

  async listerFacturesRelancables(organizationId: string): Promise<FaitFacture[]> {
    return [...this.factures.values()].filter((f) => f.organizationId === organizationId);
  }

  async lireRangsEnvoyes(
    typeObjet: "quote" | "invoice", objetIds: string[], gabarit: string,
  ): Promise<RangsDejaEnvoyes[]> {
    const sortie: RangsDejaEnvoyes[] = [];
    for (const objetId of objetIds) {
      const rangs = this.rangs.get(`${typeObjet}:${objetId}:${gabarit}`);
      if (rangs && rangs.length > 0) sortie.push({ typeObjet, objetId, gabarit, rangs });
    }
    return sortie;
  }
}

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

export const ORGANISATION_DE_TEST = ORG;
export const CLIENT_DE_TEST = CLIENT;

export function unDevis(patch: Partial<FaitDevis> = {}): FaitDevis {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organizationId: ORG,
    customerId: CLIENT,
    numero: "DEV-2026-0007",
    titre: "Création d'un massif",
    envoyeLe: "2026-09-01T09:00:00.000Z",
    decideLe: null,
    valableJusquau: "2026-10-01",
    archiveLe: null,
    statut: "sent",
    totalTtcCents: 240_000,
    ...patch,
  };
}

export function uneFacture(patch: Partial<FaitFacture> = {}): FaitFacture {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organizationId: ORG,
    customerId: CLIENT,
    numero: "FAC-2026-0011",
    emiseLe: "2026-08-01T09:00:00.000Z",
    echeanceLe: "2026-08-31",
    archiveLe: null,
    statut: "issued",
    totalTtcCents: 240_000,
    resteDuCents: 240_000,
    ...patch,
  };
}

export function reglagesActifs(patch: Partial<ReglagesRelances> = {}): ReglagesRelances {
  return {
    organizationId: ORG,
    actives: true,
    delaiJours: 7,
    nombreMaximum: 2,
    suspendueLe: null,
    motifSuspension: null,
    ...patch,
  };
}
