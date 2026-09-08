/**
 * §INSCRIPTION — L'AIGUILLAGE DU TUNNEL, ÉCRIT UNE FOIS ET TESTABLE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE RÈGLE N'EST PAS DANS LA PAGE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le tunnel a désormais TROIS étapes — société, offre, confirmation —
 * et c'est lui, et non `/bienvenue`, que rencontre un compte neuf. La
 * question « où doit-on tomber en arrivant ici ? » se pose donc à
 * chaque retour : après un abandon, après un paiement, après un retour
 * du prestataire, après un rebond du péage.
 *
 * Écrite dans le composant, cette règle aurait été invérifiable : il
 * faut une base, une session et un cookie pour la jouer. Écrite ici,
 * elle se joue sur quatre booléens, et le test dit noir sur blanc ce
 * qu'on voit après avoir payé, après avoir fermé l'onglet, et après
 * avoir renoncé.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE L'AIGUILLAGE NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * IL N'OUVRE AUCUN DROIT. Il choisit un écran. Le fait qu'on retombe
 * sur « confirmation » ne prouve pas qu'on est abonné : c'est l'écran
 * lui-même qui lit l'abonnement en base et qui dit la vérité, y compris
 * « nous attendons encore la confirmation de votre paiement ».
 */

export type Etape = "societe" | "offre" | "confirmation";

const ETAPES: Etape[] = ["societe", "offre", "confirmation"];

export function estUneEtape(valeur: string): valeur is Etape {
  return (ETAPES as string[]).includes(valeur);
}

export type EtatDuTunnel = {
  /** L'étape explicitement demandée dans l'URL, si elle est lisible. */
  demandee: string | null;
  /** Une organisation professionnelle existe-t-elle pour ce compte ? */
  organisationExiste: boolean;
  /**
   * UNE LIGNE d'abonnement existe-t-elle, quel que soit son statut ?
   *
   * C'est bien l'EXISTENCE et non l'activité : la clé primaire de
   * `organization_subscriptions` est l'organisation seule, il y a donc
   * au plus une ligne, et son absence — pas un statut — est ce qui
   * distingue « jamais souscrit » de « souscrit ». Un abonnement
   * résilié compte comme existant : la caisse refuse de le rouvrir
   * comme une première souscription, et renvoyer cette personne sur la
   * grille lui promettrait un bouton qui échouera.
   */
  abonnementExiste: boolean;
  /**
   * Une session de paiement vient-elle d'être ouverte depuis ce
   * navigateur ? (Le cookie d'intention, cf. `paiement-en-cours.ts`.)
   */
  paiementEnCours: boolean;
};

/**
 * OÙ L'ON TOMBE, ET POURQUOI DANS CET ORDRE.
 *
 * 1. L'ÉTAPE DEMANDÉE PRIME TOUJOURS. C'est ainsi qu'on revient
 *    corriger sa fiche (`?etape=societe`) ou regarder la grille
 *    (`?etape=offre`) alors même qu'on est déjà abonné. Une règle
 *    automatique qui écraserait l'URL rendrait ces deux gestes
 *    impossibles.
 *
 * 2. PAS D'ENTREPRISE → LA SOCIÉTÉ. Il n'y a personne à facturer.
 *
 * 3. UN ABONNEMENT EXISTE, OU UN PAIEMENT VIENT D'ÊTRE OUVERT →
 *    CONFIRMATION. Les deux mènent au même écran parce qu'ils posent
 *    la même question : « où en est ma souscription ? ». Le cas du
 *    paiement ouvert est celui du retour du prestataire, qui peut
 *    arriver AVANT son événement signé : renvoyer cette personne sur
 *    la grille des offres, quelques secondes après qu'elle a donné sa
 *    carte, serait le pire écran possible.
 *
 * 4. SINON → L'OFFRE. L'entreprise existe, rien n'est souscrit : c'est
 *    exactement l'état d'un abandon à mi-parcours, et l'écran qui le
 *    rattrape est la grille.
 */
export function etapeParDefaut(etat: EtatDuTunnel): Etape {
  const demandee = (etat.demandee ?? "").trim();
  if (estUneEtape(demandee)) return demandee;

  if (!etat.organisationExiste) return "societe";
  if (etat.abonnementExiste || etat.paiementEnCours) return "confirmation";
  return "offre";
}

/**
 * L'INSTALLATION DU LOGICIEL RESTE-T-ELLE À FAIRE ?
 *
 * `/bienvenue` n'est plus la porte : c'est ce qui vient APRÈS le
 * contrat. Encore faut-il ne pas l'oublier, sans pour autant y bloquer
 * qui que ce soit. Cette fonction est le seul juge de « on le
 * rappelle », et elle est partagée par les deux écrans qui le
 * rappellent — la confirmation du tunnel et la coquille de
 * l'application. Deux conditions écrites deux fois auraient fini par
 * proposer l'installation à quelqu'un qui l'a terminée.
 *
 * `onboarding_step < 3` n'est PAS un parcours à faire : c'est une
 * entreprise née avant que ce parcours existe (la colonne vaut zéro par
 * défaut, migration 0060). Lui proposer d'installer son espace six mois
 * après son premier devis n'aurait aucun sens.
 */
export function installationARappeler(entreprise: {
  onboardingStep: number | null;
  onboardingCompletedAt: string | null;
}): boolean {
  if (entreprise.onboardingCompletedAt !== null) return false;
  return (entreprise.onboardingStep ?? 0) >= 3;
}
