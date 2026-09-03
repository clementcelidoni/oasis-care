import { niveauMin } from "../model/types.ts";
import type { ContexteRoutage, DecisionRoutage } from "../model/types.ts";
import type { AgentContext } from "./context.ts";
import { AICostControlService, sommerCouts } from "./cost.ts";
import { avertissementRepli, classerPanne, deciderRepli } from "./fallback.ts";
import { ModelEscalationService, serviceEscalade } from "./escalation.ts";
import { JournalUsage } from "./usage.ts";
import {
  MESSAGE_INDISPONIBLE,
  compteur,
  lireConfiance,
  usageDeLErreur,
  type Criticite,
  type EtapeEscalade,
  type InfoRepli,
  type NiveauModele,
  type ResultatAgent,
  type SortieModele,
  type TentativeModele,
} from "./types.ts";

/**
 * §11V — L'ENDROIT OÙ LA PLOMBERIE SE REJOINT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN ORCHESTRATEUR PLUTÔT QUE QUATRE CONVENTIONS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le contrôle de coût, l'escalade, le repli et le journal ne valent
 * que par leur ORDRE et par leur EXHAUSTIVITÉ. « Vérifier le plafond
 * avant l'appel », « journaliser chaque tentative », « ne pas dégrader
 * une décision critique » sont des règles qu'on peut écrire dans un
 * document et oublier dans un agent sur quatre. Elles sont donc ici,
 * dans le SEUL chemin par lequel un agent atteint un modèle.
 *
 * Les étapes 9 à 12 (les quatre agents) n'appellent pas le fournisseur.
 * Elles fournissent un `executer` — une fermeture qui sait faire
 * tourner LEUR agent avec un identifiant de modèle donné — et cette
 * classe s'occupe du reste.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ORDRE, ET CE QUE CHAQUE POSITION COÛTE SI ON LA DÉPLACE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. LES DROITS. Un contexte vide faute de permissions ne part pas
 *      au modèle. Payer un raisonnement sur rien produit une réponse
 *      confiante et creuse — la pire des deux.
 *
 *   2. LE DÉTERMINISTE (p. 11-12). Si l'appelant a déjà la réponse par
 *      le SQL, on ne paie personne. Placer ce test après le routage
 *      n'aurait rien coûté ; le placer après le cache aurait fait
 *      chercher une entrée pour une question déjà résolue.
 *
 *   3. LE ROUTAGE. Il doit précéder le cache : le modèle FAIT PARTIE
 *      de l'identité d'une entrée (0076). Chercher avant de router
 *      ferait resservir l'analyse du petit modèle à une entreprise qui
 *      vient de passer son agent sur le grand.
 *
 *   4. LE CACHE. Avant le plafond, délibérément : servir une réponse
 *      déjà calculée ne coûte rien, et couper le cache en même temps
 *      que les appels transformerait un plafond de dépense en panne
 *      totale.
 *
 *   5. LE PLAFOND (p. 19). Avant l'appel. Un contrôle a posteriori
 *      constate un dépassement qu'il aurait pu empêcher.
 *
 *   6. L'APPEL, puis le journal — TOUJOURS, succès ou échec.
 *
 *   7. L'ESCALADE (p. 7) ou LE REPLI (p. 23), jamais les deux dans le
 *      même tour : monter parce que la réponse est faible et descendre
 *      parce que le modèle est en panne sont deux mouvements opposés,
 *      et un code qui les mélange finit par osciller.
 */

/** Une borne dure : appel initial + deux escalades + un repli. */
export const MAX_TENTATIVES = 4;

/** Les signaux de routage, sans l'agent ni la taille — les deux sont déduits. */
export type SignauxRoutage = Omit<ContexteRoutage, "agent" | "contextSize">;

export type Executeur = (tentative: TentativeModele) => Promise<SortieModele>;

export type DemandeExecution = {
  contexte: AgentContext;
  /**
   * Ce que coûte une réponse dégradée. `critique` interdit le repli.
   * NON OPTIONNEL : un défaut à « ordinaire » ferait dégrader
   * silencieusement toutes les décisions dont personne n'a pensé à
   * déclarer la criticité, c'est-à-dire exactement celles qu'on oublie.
   */
  criticite: Criticite;
  routage?: SignauxRoutage;
  /**
   * La clé de cache, ou `null` pour ne pas mettre en cache.
   *
   * `null` est le bon choix pour tout ce qui doit être frais à chaque
   * fois — un brief du matin, une conversation. Le cache sert les
   * analyses répétées d'un même objet (p. 19 : « ne pas recalculer
   * l'analyse du même devis toutes les 10 secondes »).
   */
  cache?: {
    cle: string;
    ttlSecondes?: number;
    /**
     * L'empreinte à opposer au cache, quand celle du contexte NE SUFFIT
     * PAS.
     *
     * Elle ne suffit pas dès que la réponse est construite sur des
     * données que l'agent n'a pas lues lui-même : le brief de Direction
     * est produit par ses spécialistes, dont les sources n'entrent pas
     * dans son propre contexte. Sans cette surcharge, une trésorerie ou
     * une marge qui bouge laissait l'empreinte identique, et l'entrée
     * était resservie — l'invariant « on ne peut pas oublier
     * d'invalider » était faux pour le seul agent qui met en cache.
     *
     * Absente, l'empreinte du contexte fait foi, et c'est le cas
     * ordinaire : un agent sans délégation lit tout ce dont il se sert.
     */
    empreinte?: string;
  } | null;
  /** Pour le « coût / décision » de la page 18. */
  decisionId?: string | null;
  /**
   * La réponse déjà obtenue par le SQL, s'il y en a une.
   *
   * C'est ici que passe la règle « outils déterministes avant IA » à
   * l'échelle de l'appel entier : un agent qui sait que sa question est
   * entièrement résolue par `ai_billing_candidates` la fournit, et
   * aucun modèle n'est appelé.
   */
  reponseDeterministe?: SortieModele | null;
  executer: Executeur;
};

/** Ce dont l'orchestrateur a besoin. Tout est injectable, donc éprouvable. */
export type PortRoutage = {
  resolve(contexte: ContexteRoutage): DecisionRoutage;
  modelePourNiveau(niveau: NiveauModele): string;
};

export type PortsRuntime = {
  routeur: PortRoutage;
  cout: AICostControlService;
  journal: JournalUsage;
  escalade?: ModelEscalationService;
  /** L'horloge des durées. Injectable pour que `duration_ms` soit vérifiable. */
  chrono?: () => number;
};

export class OasisAgentRunner {
  readonly #routeur: PortRoutage;
  readonly #cout: AICostControlService;
  readonly #journal: JournalUsage;
  readonly #escalade: ModelEscalationService;
  readonly #chrono: () => number;

  constructor(ports: PortsRuntime) {
    this.#routeur = ports.routeur;
    this.#cout = ports.cout;
    this.#journal = ports.journal;
    this.#escalade = ports.escalade ?? serviceEscalade();
    this.#chrono = ports.chrono ?? (() => Date.now());
  }

  async executer(demande: DemandeExecution): Promise<ResultatAgent> {
    const { contexte } = demande;
    const avertissements: string[] = [];

    // ── 1. Les droits ─────────────────────────────────────────────
    if (contexte.vide) {
      const manquantes = contexte.permissionsManquantes;
      return {
        ok: false,
        motif: manquantes.length > 0 ? "droits_manquants" : "other",
        message:
          manquantes.length > 0
            ? `Oasis n'a pas pu lire les données nécessaires : le droit ${manquantes.join(", ")} manque à ce compte. ` +
              "Ce n'est pas « rien à signaler »."
            : "Oasis n'a obtenu aucune des données nécessaires à cette analyse.",
        tentatives: [],
        // Aucun appel : zéro est ici un fait mesuré, pas un inconnu
        // déguisé. C'est le seul endroit du système où l'on écrit 0.
        coutEstimeCents: 0,
        avertissements,
      };
    }

    if (contexte.permissionsManquantes.length > 0) {
      avertissements.push(
        `Analyse partielle : le droit ${contexte.permissionsManquantes.join(", ")} manque à ce compte.`,
      );
    }

    // ── 2. Le déterministe passe avant le modèle ──────────────────
    if (demande.reponseDeterministe != null) {
      return {
        ok: true,
        origine: "deterministe",
        sortie: demande.reponseDeterministe,
        tentative: null,
        repli: null,
        escalades: [],
        coutEstimeCents: 0,
        dateArreteDonnees: contexte.dateArreteDonnees,
        avertissements,
      };
    }

    // ── 3. Le routage ─────────────────────────────────────────────
    const signaux = demande.routage ?? {};
    const decision = this.#routeur.resolve({
      ...signaux,
      agent: contexte.agent,
      contextSize: contexte.tailleCaracteres,
    });
    const plafond = plafondRoutage(signaux);

    // ── 4. Le cache ───────────────────────────────────────────────
    //
    // L'EMPREINTE PEUT VENIR DE L'APPELANT. Voir `DemandeExecution.cache` :
    // un agent qui délègue compose la sienne à partir des contextes de
    // ses délégués, parce que la réponse mise en cache dépend de
    // données qu'il n'a pas lues lui-même.
    const empreinteCache = demande.cache?.empreinte ?? contexte.empreinte;

    if (demande.cache != null) {
      const enCache = await this.#cout.lireCache({
        organizationId: contexte.organizationId,
        agent: contexte.agent,
        cle: demande.cache.cle,
        modele: decision.modele,
        empreinte: empreinteCache,
      });
      const sortie = lireSortieModele(enCache);
      if (sortie !== null) {
        return {
          ok: true,
          origine: "cache",
          sortie,
          tentative: { niveau: decision.niveau, modele: decision.modele },
          repli: null,
          escalades: [],
          coutEstimeCents: 0,
          dateArreteDonnees: contexte.dateArreteDonnees,
          avertissements,
        };
      }
    }

    // ── 5, 6, 7. Le plafond, l'appel, l'escalade et le repli ──────
    const tentatives: TentativeModele[] = [];
    const couts: (number | null)[] = [];
    const escalades: EtapeEscalade[] = [];
    const niveauxEssayes: NiveauModele[] = [];
    let repli: InfoRepli | null = null;
    let tentative: TentativeModele = { niveau: decision.niveau, modele: decision.modele };
    /** Vrai quand la tentative en cours est une escalade : le plafond se revérifie. */
    let plafondAVerifier = true;

    for (let tour = 0; tour < MAX_TENTATIVES; tour += 1) {
      if (plafondAVerifier) {
        const verdict = await this.#cout.autoriserAppel({
          organizationId: contexte.organizationId,
          agent: contexte.agent,
          niveau: tentative.niveau,
          tailleContexteCaracteres: contexte.tailleCaracteres,
        });
        // Sans dédoublonnage, une escalade ferait afficher deux fois
        // « il reste moins de 10 % du plafond » : le lecteur y verrait
        // deux alertes, donc deux problèmes.
        for (const message of verdict.avertissements) {
          if (!avertissements.includes(message)) avertissements.push(message);
        }

        if (!verdict.autorise) {
          // LE REFUS EST JOURNALISÉ. Zéro jeton, mais `failure_reason`
          // = `budget_exceeded` : sans cette ligne, un plafond qui
          // coupe tout un après-midi ne laisserait aucune trace, et le
          // tableau de bord montrerait « aucune activité IA ».
          const alerte = await this.#journal.inscrire({
            organizationId: contexte.organizationId,
            agent: contexte.agent,
            modele: tentative.modele,
            jetonsEntree: 0,
            jetonsSortie: 0,
            dureeMs: 0,
            succes: false,
            appelsOutils: 0,
            coutEstimeCents: null,
            baseTarif: null,
            motifPanne: "budget_exceeded",
            modeleReplieDepuis: null,
            decisionId: demande.decisionId ?? null,
          });
          if (alerte !== null) avertissements.push(alerte);

          return {
            ok: false,
            motif: "budget_exceeded",
            message: verdict.message ?? "Plafond de dépense IA atteint.",
            tentatives,
            coutEstimeCents: sommerCouts(couts),
            avertissements,
          };
        }
      }

      tentatives.push(tentative);
      niveauxEssayes.push(tentative.niveau);

      const debut = this.#chrono();
      let sortie: SortieModele;
      try {
        sortie = await demande.executer(tentative);
      } catch (erreur) {
        const motif = classerPanne(erreur);
        const dureeMs = Math.max(0, this.#chrono() - debut);

        // LES JETONS D'UN ÉCHEC SONT DES JETONS PAYÉS.
        //
        // La plupart des exceptions qui arrivent ici viennent d'un run
        // ENTIÈREMENT exécuté — sortie illisible, schéma refusé, tours
        // épuisés. `usageDeLErreur` les récupère (voir `types.ts`) et
        // ils sont estimés, journalisés et comptés dans le total comme
        // n'importe quelle tentative réussie. Les inscrire à zéro,
        // comme ce code le faisait, laissait un modèle qui échoue
        // systématiquement brûler du budget sans qu'aucun plafond ne
        // bouge : `ai_cost_budget_remaining` somme des zéros.
        //
        // Quand l'exception ne porte AUCUN compteur — le fournisseur
        // injoignable, par exemple —, on écrit zéro jeton et un coût
        // `null` : rien n'a été échangé, et on ne prétend pas savoir.
        const usage = usageDeLErreur(erreur);
        const coutTentative =
          usage === null
            ? null
            : this.#cout.estimer(tentative.niveau, usage.jetonsEntree, usage.jetonsSortie);
        if (usage !== null) couts.push(coutTentative);

        // JOURNALISER AVANT DE DÉCIDER DU REPLI. Décider d'abord et
        // écrire ensuite laisserait la dépense hors du grand livre
        // quand le repli lui-même échoue.
        const alerte = await this.#journal.inscrire({
          organizationId: contexte.organizationId,
          agent: contexte.agent,
          modele: tentative.modele,
          jetonsEntree: usage?.jetonsEntree ?? 0,
          jetonsSortie: usage?.jetonsSortie ?? 0,
          dureeMs,
          succes: false,
          appelsOutils: usage?.appelsOutils ?? 0,
          coutEstimeCents: coutTentative,
          baseTarif: coutTentative === null ? null : this.#cout.baseTarifaire(),
          motifPanne: motif,
          modeleReplieDepuis: repli?.deModele ?? null,
          decisionId: demande.decisionId ?? null,
        });
        if (alerte !== null) avertissements.push(alerte);

        const decisionRepli = deciderRepli({
          motif,
          niveauActuel: tentative.niveau,
          modeleActuel: tentative.modele,
          criticite: demande.criticite,
          risque: signaux.risk,
          impactFinancierCents: signaux.financialImpact ?? null,
          niveauxDejaEssayes: niveauxEssayes,
        });

        if (!decisionRepli.replier) {
          return {
            ok: false,
            motif,
            message: decisionRepli.message,
            tentatives,
            coutEstimeCents: sommerCouts(couts),
            avertissements,
          };
        }

        const modeleCible = this.#routeur.modelePourNiveau(decisionRepli.versNiveau);
        const info = decisionRepli.construireInfo(modeleCible);
        // DEUX REPLIS D'AFFILÉE GARDENT LEUR POINT DE DÉPART. Écraser
        // `repli` ferait dire « repli de standard vers economy » à une
        // réponse partie d'advanced : l'écart réel de qualité — celui
        // que l'utilisateur doit connaître — disparaîtrait.
        repli =
          repli === null ? info : { ...info, deNiveau: repli.deNiveau, deModele: repli.deModele };
        avertissements.push(avertissementRepli(repli));
        tentative = { niveau: decisionRepli.versNiveau, modele: modeleCible };
        // Un repli descend d'un cran : il coûte MOINS que ce que le
        // plafond vient d'autoriser. Le revérifier serait un
        // aller-retour de base pour une réponse connue d'avance.
        plafondAVerifier = false;
        continue;
      }

      // ---- Succès : journal, puis escalade éventuelle --------------
      const dureeMs = Math.max(0, this.#chrono() - debut);
      const coutTentative = this.#cout.estimer(
        tentative.niveau,
        sortie.jetonsEntree,
        sortie.jetonsSortie,
      );
      couts.push(coutTentative);

      const alerte = await this.#journal.inscrire({
        organizationId: contexte.organizationId,
        agent: contexte.agent,
        modele: tentative.modele,
        jetonsEntree: compteur(sortie.jetonsEntree),
        jetonsSortie: compteur(sortie.jetonsSortie),
        dureeMs,
        succes: true,
        appelsOutils: compteur(sortie.appelsOutils),
        coutEstimeCents: coutTentative,
        baseTarif: this.#cout.baseTarifaire(),
        motifPanne: null,
        modeleReplieDepuis: repli?.deModele ?? null,
        decisionId: demande.decisionId ?? null,
      });
      if (alerte !== null) avertissements.push(alerte);

      // UNE RÉPONSE OBTENUE APRÈS REPLI N'ESCALADE PAS. Elle vient
      // déjà d'un modèle plus faible parce que le plus fort était
      // indisponible ; remonter le rappellerait aussitôt.
      const suite =
        repli === null
          ? this.#escalade.decider({
              niveauActuel: tentative.niveau,
              sortie,
              plafond,
              risque: signaux.risk,
              impactFinancierCents: signaux.financialImpact ?? null,
              escaladesDejaFaites: escalades.length,
              niveauxDejaEssayes: niveauxEssayes,
            })
          : ({ escalader: false, raison: "Réponse obtenue après repli." } as const);

      if (suite.escalader) {
        escalades.push(suite.etape);
        tentative = {
          niveau: suite.versNiveau,
          modele: this.#routeur.modelePourNiveau(suite.versNiveau),
        };
        // Une escalade coûte PLUS cher : le plafond se revérifie.
        plafondAVerifier = true;
        continue;
      }

      // ---- La réponse est retenue ---------------------------------
      if (demande.cache != null) {
        try {
          await this.#cout.ecrireCache({
            organizationId: contexte.organizationId,
            agent: contexte.agent,
            cle: demande.cache.cle,
            modele: tentative.modele,
            empreinte: empreinteCache,
            resultat: sortie,
            ttlSecondes: demande.cache.ttlSecondes,
            sources: contexte.sources.filter((s) => s.ok).map((s) => s.outil),
            dateArreteDonnees: contexte.dateArreteDonnees,
          });
        } catch (erreur) {
          // Un cache qui n'écrit pas fait repayer l'appel suivant. Ce
          // n'est pas une raison de perdre la réponse qu'on tient.
          console.error(
            `cache IA : entrée non écrite pour « ${demande.cache.cle} » (${
              erreur instanceof Error ? erreur.message : String(erreur)
            }).`,
          );
        }
      }

      return {
        ok: true,
        origine: "modele",
        sortie,
        tentative,
        repli,
        escalades,
        coutEstimeCents: sommerCouts(couts),
        dateArreteDonnees: contexte.dateArreteDonnees,
        avertissements,
      };
    }

    // La borne dure. On n'y arrive qu'en cas d'enchaînement anormal —
    // et alors on ne rend pas une réponse tirée d'une tentative
    // intermédiaire : on dit que ça n'a pas abouti.
    return {
      ok: false,
      motif: "other",
      message: MESSAGE_INDISPONIBLE,
      tentatives,
      coutEstimeCents: sommerCouts(couts),
      avertissements,
    };
  }
}

// ==================================================================
// Aides
// ==================================================================

/**
 * Le plafond de niveau qu'imposent le plan et le budget.
 *
 * RECOPIE la troisième étape de `AIModelRouter.resolve` : le routeur
 * applique ces deux plafonds au moment de choisir, mais il rend un
 * niveau, pas le plafond lui-même — et l'escalade a besoin du plafond
 * pour ne pas le franchir en remontant. Un test compare les deux
 * lectures ; si le routeur change sa règle, il tombe.
 */
export function plafondRoutage(signaux: SignauxRoutage): NiveauModele {
  const parPlan: NiveauModele = signaux.userPlan ?? "advanced";
  const parBudget: NiveauModele =
    signaux.budget === "epuise" ? "economy" : signaux.budget === "tendu" ? "standard" : "advanced";
  return niveauMin(parPlan, parBudget);
}

/**
 * Relire une sortie sortie du cache.
 *
 * `jsonb` arrive en `unknown`. Une entrée mal formée rend `null` — un
 * défaut de cache — plutôt qu'un objet à moitié vrai : mieux vaut
 * repayer l'appel que servir une réponse dont la confiance a disparu en
 * route et vaudrait « high » par défaut.
 */
export function lireSortieModele(valeur: unknown): SortieModele | null {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return null;
  const r = valeur as Record<string, unknown>;
  if (!("confiance" in r)) return null;
  return {
    texte: typeof r.texte === "string" ? r.texte : null,
    donnees: r.donnees ?? null,
    confiance: lireConfiance(r.confiance),
    ambigu: r.ambigu === true,
    jetonsEntree: compteur(r.jetonsEntree),
    jetonsSortie: compteur(r.jetonsSortie),
    appelsOutils: compteur(r.appelsOutils),
  };
}
