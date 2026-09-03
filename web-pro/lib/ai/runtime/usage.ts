import { compteur, type MotifPanne } from "./types.ts";

/**
 * §11V — LE JOURNAL D'USAGE (spec p. 18, étape 16 côté base).
 *
 * ══════════════════════════════════════════════════════════════════
 * CHAQUE APPEL ÉCRIT UN `ai_usage_event`. SANS EXCEPTION.
 * ══════════════════════════════════════════════════════════════════
 *
 * Un appel non journalisé ne rend pas le tableau de bord « un peu
 * incomplet ». Il le rend FAUX, et un tableau de bord faux est pire
 * qu'aucun tableau de bord : quelqu'un décidera de relever un plafond,
 * ou de ne pas le relever, en regardant un chiffre qui ne correspond à
 * rien.
 *
 * Les trois oublis qui arrivent naturellement, et ce qui les empêche :
 *
 *   • L'APPEL QUI ÉCHOUE. Un appel en erreur a quand même consommé des
 *     jetons d'entrée. `run.ts` journalise dans la branche d'erreur
 *     AVANT de décider du repli, pas après.
 *
 *   • L'APPEL REMPLACÉ PAR UN REPLI. Deux appels, donc deux lignes,
 *     la seconde portant `fallback_from_model`. Une seule ligne
 *     rendrait le repli invisible et sous-compterait la dépense.
 *
 *   • L'APPEL ESCALADÉ. Idem : autant de lignes que de tentatives,
 *     toutes rattachées à la même décision par `decision_id`, ce qui
 *     donne le « coût / décision » de la page 18.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN JOURNAL QUI ÉCHOUE NE FAIT PAS ÉCHOUER LA RÉPONSE
 * ══════════════════════════════════════════════════════════════════
 *
 * Et c'est un arbitrage, pas une négligence. Les jetons sont déjà
 * payés : refuser la réponse parce qu'on n'a pas su l'inscrire au
 * grand livre ferait perdre les deux. Mais l'échec ne disparaît pas
 * pour autant — il est écrit sur la console du serveur ET remonté en
 * avertissement jusqu'à `ResultatAgent.avertissements`, parce que la
 * seule chose vraiment inacceptable serait qu'un trou dans le journal
 * ne se voie nulle part.
 */

/**
 * Ce qui part dans `ai_record_usage_event` (0076).
 *
 * Les noms sont français ; l'adaptateur les traduit en `p_*`. Aucun
 * champ n'est optionnel : un champ optionnel est un champ qu'on oublie,
 * et ici chaque oubli fausse un total.
 */
export type EvenementUsage = {
  organizationId: string;
  /** Libre : la classification et un aiguilleur en panne coûtent aussi. */
  agent: string;
  /** L'identifiant réellement appelé. */
  modele: string;
  jetonsEntree: number;
  jetonsSortie: number;
  dureeMs: number;
  succes: boolean;
  appelsOutils: number;
  /** `null` quand le niveau n'est pas tarifé. JAMAIS 0. */
  coutEstimeCents: number | null;
  /** La grille qui a servi. `null` va de pair avec un coût `null`. */
  baseTarif: string | null;
  /** Le vocabulaire fermé de 0076. `null` quand `succes`. */
  motifPanne: MotifPanne | null;
  /** L'identifiant du modèle initialement demandé, en cas de repli. */
  modeleReplieDepuis: string | null;
  /** Pour le « coût / décision » de la page 18. */
  decisionId: string | null;
};

/**
 * Le port d'écriture.
 *
 * Il ne rend rien : l'identifiant de l'événement n'intéresse personne
 * en amont, et le rendre inviterait à l'attendre.
 */
export type PortJournalUsage = (evenement: EvenementUsage) => Promise<void>;

export class JournalUsage {
  readonly #ecrire: PortJournalUsage;
  readonly #signaler: (message: string) => void;

  constructor(
    ecrire: PortJournalUsage,
    signaler: (message: string) => void = (m) => console.error(m),
  ) {
    this.#ecrire = ecrire;
    this.#signaler = signaler;
  }

  /**
   * Inscrire un appel.
   *
   * Rend l'avertissement à remonter à l'appelant, ou `null` quand tout
   * s'est bien passé. Ce retour est la façon la plus simple de rendre
   * un trou de journal visible sans faire échouer la réponse : le
   * compilateur ne force pas à le lire, mais `run.ts` le lit, et un
   * test le vérifie.
   */
  async inscrire(evenement: EvenementUsage): Promise<string | null> {
    // Une cohérence qu'on refuse de laisser passer : un montant sans
    // grille est un chiffre sans provenance, et 0076 le rejette par
    // contrainte. Mieux vaut perdre le montant que perdre la ligne.
    const propre: EvenementUsage = {
      ...evenement,
      jetonsEntree: compteur(evenement.jetonsEntree),
      jetonsSortie: compteur(evenement.jetonsSortie),
      dureeMs: compteur(evenement.dureeMs),
      appelsOutils: compteur(evenement.appelsOutils),
      coutEstimeCents: evenement.baseTarif === null ? null : evenement.coutEstimeCents,
      motifPanne: evenement.succes ? null : (evenement.motifPanne ?? "other"),
    };

    try {
      await this.#ecrire(propre);
      return null;
    } catch (erreur) {
      const detail = erreur instanceof Error ? erreur.message : String(erreur);
      this.#signaler(
        `journal d'usage IA : l'appel « ${propre.agent} / ${propre.modele} » n'a PAS été inscrit (${detail}). ` +
          "Le tableau de bord des coûts sous-compte cette dépense.",
      );
      return (
        "Cet appel n'a pas pu être inscrit au journal des coûts : " +
        "le suivi de dépense de votre entreprise est incomplet pour aujourd'hui."
      );
    }
  }
}
