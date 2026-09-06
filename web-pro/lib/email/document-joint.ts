import type { PieceJointe } from "./types.ts";

/**
 * §COURRIEL — LA PIÈCE JOINTE, ET LA RÈGLE QUI LA GOUVERNE.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN SEUL DOCUMENT. PAS DEUX.
 * ══════════════════════════════════════════════════════════════════
 *
 * Si une facture s'attache à un message, c'est LE MÊME DOCUMENT que
 * celui de l'écran. Pas « le même contenu », pas « la même mise en page
 * à peu près » : le même, produit par le même code.
 *
 * POURQUOI C'EST LA RÈGLE LA PLUS DURE DE CE FICHIER. Un second gabarit
 * de facture ne se voit pas le jour où on l'écrit — les deux se
 * ressemblent, les tests passent. Il diverge au premier changement :
 * quelqu'un corrige le taux de TVA affiché à l'écran et pas dans le
 * gabarit du courriel, ou l'inverse. Le client reçoit alors un document
 * comptable qui ne correspond pas à celui de son espace, et personne ne
 * s'en aperçoit avant qu'il compare les deux devant son comptable.
 *
 * LE SEUL RENDU AUTORISÉ EST DONC CELUI DES PAGES D'IMPRESSION
 * EXISTANTES :
 *
 *   web-pro/app/(app)/factures/[id]/imprimer/page.tsx
 *   web-pro/app/(app)/devis/[id]/imprimer/page.tsx
 *
 * Elles calculent déjà la ventilation de TVA avec la même fonction que
 * la base et que le portail — un correctif que le commentaire de la page
 * raconte : elles faisaient leur propre total, et il ne tombait pas
 * d'accord avec celui de la base. Recommencer ce chemin dans un gabarit
 * de courriel serait refaire exactement le bogue qui a déjà été corrigé
 * une fois.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI MANQUE AUJOURD'HUI, DIT SANS L'ADOUCIR
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'existe AUCUNE génération de PDF dans ce dépôt : pas de
 * dépendance, pas de service. Ce qui existe est une page HTML
 * d'impression dont le bouton dit littéralement au paysagiste : « Dans
 * la fenêtre d'impression, choisissez Enregistrer au format PDF ». C'est
 * exactement la douleur que ce chantier doit supprimer, et elle ne peut
 * pas l'être ici : ajouter une dépendance de rendu toucherait
 * `web-pro/package.json`, qui appartient à un autre chantier en cours.
 *
 * Ce fichier livre donc la FORME — l'interface, l'état
 * « indisponible » avec sa phrase, et l'interdiction d'un second
 * gabarit — et le compte rendu demande la dépendance. Le jour où elle
 * arrive, une seule implémentation s'écrit ici, et rien d'autre du
 * dossier ne bouge.
 */

export type TypeDocument = "devis" | "facture";

/**
 * Ce qu'une source de document rend : la pièce, ou la raison de son
 * absence.
 *
 * MÊME FORME QU'`unavailableReason`, et pour la même raison : « aucun
 * rendu de document n'est installé » est un état NORMAL du déploiement
 * d'aujourd'hui, pas une panne. Le message part alors sans pièce jointe,
 * avec l'essentiel dans son corps — il ne part pas en erreur.
 */
export type ResultatDocument =
  | { etat: "pret"; piece: PieceJointe }
  | { etat: "indisponible"; raison: string };

export interface SourceDocument {
  /** `null` quand la source sait produire un document. Sinon, la phrase. */
  readonly raisonIndisponibilite: string | null;

  /**
   * Produire la pièce jointe d'un document.
   *
   * L'implémentation réelle devra RENDRE LA PAGE D'IMPRESSION
   * EXISTANTE — la même URL que celle du bouton « Imprimer » — et jamais
   * composer un second document. C'est la seule chose que ce fichier
   * exige d'elle, et c'est la seule qui compte.
   */
  produire(type: TypeDocument, id: string): Promise<ResultatDocument>;
}

/**
 * L'état d'aujourd'hui : rien n'est joint, et on le dit.
 *
 * Il ne fabrique pas un PDF vide, ne joint pas un HTML renommé en
 * `.pdf`, et ne joint pas « une version simplifiée ». Une version
 * simplifiée d'une facture EST un second document.
 */
export class AucuneSourceDocument implements SourceDocument {
  readonly raisonIndisponibilite: string;

  constructor(
    raison = "Aucun rendu de document n'est installé sur ce serveur : le message part sans pièce jointe, avec l'essentiel dans son corps.",
  ) {
    this.raisonIndisponibilite = raison;
  }

  async produire(type: TypeDocument, id: string): Promise<ResultatDocument> {
    void type;
    void id;
    return { etat: "indisponible", raison: this.raisonIndisponibilite };
  }
}

/**
 * Le nom du fichier vu par le client.
 *
 * « Facture FA-2026-0042.pdf », jamais « document.pdf » ni un
 * identifiant technique : le client range ce fichier et devra le
 * retrouver un an plus tard. Les caractères qui gênent les systèmes de
 * fichiers sont remplacés — un nom de pièce jointe refusé par le poste
 * du destinataire produit un message sans pièce, en silence.
 */
export function nomDeFichier(type: TypeDocument, numero: string): string {
  const etiquette = type === "facture" ? "Facture" : "Devis";
  const propre = numero.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${etiquette} ${propre === "" ? "sans-numero" : propre}.pdf`;
}
