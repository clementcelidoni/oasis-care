import {
  AIModelConfiguration,
  lireConfiguration,
  type AnomalieConfiguration,
  type SourceEnvironnement,
} from "./configuration.ts";
import {
  NIVEAUX_MODELE,
  decalerNiveau,
  niveauMax,
  niveauMin,
  rangNiveau,
  type ContexteRoutage,
  type DecisionRoutage,
  type NiveauModele,
} from "./types.ts";

/**
 * §11V — AIModelRouter (spec p. 3 à 6).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER EST LE SEUL DU DÉPÔT WEB À CONNAÎTRE UN NOM DE MODÈLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Les trois chaînes ci-dessous n'apparaissent nulle part ailleurs sous
 * `web-pro/`, et `router.test.ts` relit l'arborescence pour s'en
 * assurer. Ce n'est pas une coquetterie : la spec p. 4 pose l'exigence,
 * mais la vraie raison est plus terre à terre. Les trois déclinaisons
 * `-sol`, `-terra`, `-luna` N'ONT PAS PU ÊTRE VÉRIFIÉES contre l'API au
 * moment d'écrire ce code — le dépôt appelait jusqu'ici « gpt-5.6 » tout
 * court. Si l'un des trois noms est faux, il faut qu'une seule ligne
 * soit à corriger, et que `availability.ts` l'ait dit AVANT que la
 * première décision du matin ne parte dans le mur.
 *
 * D'où les surcharges d'environnement : corriger un nom de modèle ne
 * doit pas demander un déploiement.
 *
 * ══════════════════════════════════════════════════════════════════
 * COMMENT LE NIVEAU EST CHOISI — ET POURQUOI LA COMPLEXITÉ EST RELATIVE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le routage part du niveau que la CONFIGURATION donne à l'agent, puis
 * applique trois familles de signaux, dans cet ordre :
 *
 *   1. LA COMPLEXITÉ DÉCALE. `simple` retire un cran, `complex` en
 *      ajoute un, `standard` ne bouge rien.
 *
 *      Pourquoi un décalage et pas une valeur absolue ? Parce que
 *      « complexe » ne veut pas dire la même chose pour l'agent de
 *      classification et pour l'agent de direction. La spec p. 6 le
 *      montre elle-même sur l'agent de facturation, calibré standard :
 *      détecter les factures non émises → Luna, créer un brouillon →
 *      Terra, un cas à multiples avenants → Sol. Trois crans autour de
 *      son propre niveau. Appliqué en absolu, le même barème enverrait
 *      une classification « complexe » — mille lignes de CRM — sur le
 *      modèle le plus cher, et une question « simple » posée à la
 *      direction sur le moins capable. Les deux seraient des erreurs, et
 *      la première coûterait cher mille fois de suite.
 *
 *   2. LE RISQUE, L'ARGENT ET LE RAISONNEMENT POSENT UN PLANCHER, EN
 *      ABSOLU. Eux ne sont pas relatifs à l'agent : 40 000 € en jeu,
 *      c'est 40 000 € quel que soit celui qui regarde. Un plancher ne
 *      peut que relever le niveau, jamais l'abaisser.
 *
 *   3. LE PLAN ET LE BUDGET POSENT UN PLAFOND. Ils gagnent contre les
 *      planchers — sinon un plafond ne serait pas un plafond. Quand
 *      c'est le cas, `plafonne` vaut vrai et la raison le dit : la spec
 *      p. 23 interdit de dégrader une décision critique en silence,
 *      donc l'appelant reçoit de quoi prévenir.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Il ne parle à personne. `resolve()` est une fonction pure : mêmes
 * entrées, même sortie, aucun appel réseau, aucune lecture de base. Un
 * aiguilleur qui interrogerait quoi que ce soit pour choisir serait un
 * aiguilleur qui peut tomber, et l'on n'aurait plus de modèle du tout
 * au lieu d'en avoir un imparfait.
 *
 * L'escalade en cours de route (Luna → Terra parce que la confiance est
 * insuffisante, spec p. 7) N'EST PAS ICI : elle suppose d'avoir déjà
 * une réponse à juger, donc elle appartient au service d'escalade
 * (étape 14). Ce fichier choisit le point de départ.
 */

// ------------------------------------------------------------------
// Les trois identifiants. Il n'y en a pas d'autres dans web-pro.
// ------------------------------------------------------------------

/**
 * Les modèles de la spec p. 2, un par niveau.
 *
 * Chaque niveau est surchargeable par variable d'environnement, et la
 * variable gagne : c'est la soupape qui permet de réparer un nom faux
 * sans toucher au code.
 */
const MODELES_PAR_DEFAUT: Readonly<Record<NiveauModele, string>> = Object.freeze({
  economy: "gpt-5.6-luna",
  standard: "gpt-5.6-terra",
  advanced: "gpt-5.6-sol",
});

/** Quelle variable d'environnement surcharge quel niveau. */
export const VARIABLES_ENVIRONNEMENT_MODELE: Readonly<Record<NiveauModele, string>> = Object.freeze(
  {
    economy: "OASIS_MODEL_ECONOMY",
    standard: "OASIS_MODEL_STANDARD",
    advanced: "OASIS_MODEL_ADVANCED",
  },
);

// ------------------------------------------------------------------
// Les seuils. Nommés, pour qu'on puisse en discuter.
// ------------------------------------------------------------------

/**
 * Au-delà, l'argent en jeu impose le niveau le plus capable.
 * 500 000 centimes = 5 000 €. En CENTIMES ENTIERS, comme partout dans
 * ce dépôt : un seuil en euros flottants finirait par se comparer à un
 * montant en centimes, et le bug serait invisible pendant des mois.
 */
export const SEUIL_IMPACT_AVANCE_CENTIMES = 500_000;

/** Au-delà, l'argent en jeu impose au moins le niveau intermédiaire. 500 €. */
export const SEUIL_IMPACT_STANDARD_CENTIMES = 50_000;

/** Un contexte plus long que cela demande le niveau le plus capable. */
export const SEUIL_CONTEXTE_AVANCE_CARACTERES = 60_000;

/** Et au-delà de celui-ci, au moins le niveau intermédiaire. */
export const SEUIL_CONTEXTE_STANDARD_CARACTERES = 12_000;

/**
 * Beaucoup d'outils, c'est un problème de CHOIX, pas de rédaction :
 * le modèle doit décider lequel appeler, dans quel ordre, avec quoi.
 * C'est là que les petits modèles se trompent en premier.
 */
export const SEUIL_OUTILS_AVANCE = 8;
export const SEUIL_OUTILS_STANDARD = 3;

// ------------------------------------------------------------------
// Le routeur
// ------------------------------------------------------------------

export type OptionsRouteur = {
  /** La table agent → niveau. Par défaut : celle lue dans l'environnement. */
  configuration?: AIModelConfiguration;
  /** L'environnement où lire les surcharges. Par défaut `process.env`. */
  env?: SourceEnvironnement;
};

/** Ce que l'écran d'administration de la spec p. 26 a besoin de savoir. */
export type EtatRouteur = {
  /** Les trois identifiants réellement en vigueur. */
  modeles: Readonly<Record<NiveauModele, string>>;
  /** Ceux qui viennent d'une variable d'environnement, pas de la table. */
  surcharges: readonly { niveau: NiveauModele; variable: string; modele: string }[];
  /** La table agent → niveau en vigueur. */
  agents: ReturnType<AIModelConfiguration["table"]>;
  /** Les surcharges refusées, modèles et agents confondus. */
  anomalies: readonly AnomalieConfiguration[];
};

export class AIModelRouter {
  readonly #configuration: AIModelConfiguration;
  readonly #modeles: Readonly<Record<NiveauModele, string>>;
  readonly #surcharges: readonly { niveau: NiveauModele; variable: string; modele: string }[];
  readonly #anomalies: readonly AnomalieConfiguration[];

  constructor(options: OptionsRouteur = {}) {
    const env = options.env ?? process.env;
    this.#configuration = options.configuration ?? lireConfiguration(env);

    const modeles: Record<NiveauModele, string> = { ...MODELES_PAR_DEFAUT };
    const surcharges: { niveau: NiveauModele; variable: string; modele: string }[] = [];
    const anomalies: AnomalieConfiguration[] = [...this.#configuration.anomalies()];

    for (const niveau of NIVEAUX_MODELE) {
      const variable = VARIABLES_ENVIRONNEMENT_MODELE[niveau];
      const brut = env[variable];
      if (brut === undefined) continue;

      const valeur = brut.trim();
      if (valeur.length === 0) {
        // Une variable vide n'est pas « pas de modèle » : ce serait un
        // routeur qui rend une chaîne vide au SDK, donc une erreur
        // incompréhensible plus loin. On garde le défaut et on le dit.
        anomalies.push({
          variable,
          valeur: brut,
          raison: "Valeur vide : l'identifiant par défaut reste en vigueur.",
        });
        continue;
      }

      modeles[niveau] = valeur;
      surcharges.push({ niveau, variable, modele: valeur });
    }

    this.#modeles = Object.freeze(modeles);
    this.#surcharges = Object.freeze(surcharges);
    this.#anomalies = Object.freeze(anomalies);
  }

  /**
   * Le modèle d'un agent, sans autre signal — `getModelForAgent("finance")`
   * de la spec p. 4.
   *
   * C'est le chemin le plus court, et celui que la plupart des agents
   * emprunteront. Il ne consulte QUE la configuration : c'est ce qui
   * rend le critère p. 34 vérifiable — déplacer finance dans la table
   * change ce que cette méthode rend, et rien d'autre n'a bougé.
   */
  getModelForAgent(agent: string | null | undefined): string {
    const { niveau } = this.#configuration.niveauPour(agent);
    return this.#modeles[niveau];
  }

  /** Le niveau d'un agent, quand l'appelant veut le niveau et pas le nom. */
  getTierForAgent(agent: string | null | undefined): NiveauModele {
    return this.#configuration.niveauPour(agent).niveau;
  }

  /** L'identifiant d'un niveau. Utile au contrôle de disponibilité. */
  modelePourNiveau(niveau: NiveauModele): string {
    return this.#modeles[niveau];
  }

  /** Les trois identifiants en vigueur. */
  modelesConfigures(): Readonly<Record<NiveauModele, string>> {
    return this.#modeles;
  }

  /** La configuration agent → niveau en vigueur. */
  configuration(): AIModelConfiguration {
    return this.#configuration;
  }

  /** Tout ce qu'un écran d'administration a besoin d'afficher. */
  etat(): EtatRouteur {
    return {
      modeles: this.#modeles,
      surcharges: this.#surcharges,
      agents: this.#configuration.table(),
      anomalies: this.#anomalies,
    };
  }

  /**
   * Le routage complet de la spec p. 6.
   *
   * Fonction pure. Elle LÈVE sur un nombre illisible plutôt que de le
   * traiter comme zéro : un `financialImpact` à `NaN` silencieusement
   * ramené à 0 ferait passer un devis à 45 000 € pour une broutille, et
   * enverrait la décision sur le modèle le moins cher. Ce dépôt a déjà
   * payé cette classe de bug ; on préfère la panne bruyante.
   */
  resolve(contexte: ContexteRoutage = {}): DecisionRoutage {
    const raisons: string[] = [];
    const { niveau: niveauConfigure, cle } = this.#configuration.niveauPour(contexte.agent);

    if (cle === null) {
      raisons.push(
        contexte.agent == null || String(contexte.agent).trim().length === 0
          ? `Aucun agent précisé : niveau « ${niveauConfigure} » par défaut.`
          : `Agent « ${String(contexte.agent)} » absent du catalogue : niveau « ${niveauConfigure} » par défaut.`,
      );
    } else {
      raisons.push(`Configuration de l'agent « ${cle} » : ${niveauConfigure}.`);
    }

    // ── 1. La complexité décale, autour du niveau de l'agent ────────
    let niveau = niveauConfigure;
    if (contexte.complexity !== undefined) {
      const pas = contexte.complexity === "simple" ? -1 : contexte.complexity === "complex" ? 1 : 0;
      const decale = decalerNiveau(niveauConfigure, pas);
      if (decale !== niveauConfigure) {
        raisons.push(
          `Tâche « ${contexte.complexity} » : ${pas > 0 ? "un cran au-dessus" : "un cran en dessous"} → ${decale}.`,
        );
      }
      niveau = decale;
    }

    // ── 2. Les planchers absolus ────────────────────────────────────
    for (const plancher of this.#planchers(contexte)) {
      if (rangNiveau(plancher.niveau) > rangNiveau(niveau)) {
        raisons.push(plancher.raison);
        niveau = niveauMax(niveau, plancher.niveau);
      }
    }

    const niveauDemande = niveau;

    // ── 3. Les plafonds, qui gagnent ────────────────────────────────
    if (contexte.userPlan !== undefined && rangNiveau(contexte.userPlan) < rangNiveau(niveau)) {
      raisons.push(
        `Plan de l'organisation limité à « ${contexte.userPlan} » : niveau ramené de ${niveau} à ${contexte.userPlan}.`,
      );
      niveau = niveauMin(niveau, contexte.userPlan);
    }

    if (contexte.budget !== undefined && contexte.budget !== "normal") {
      const plafond: NiveauModele = contexte.budget === "epuise" ? "economy" : "standard";
      if (rangNiveau(plafond) < rangNiveau(niveau)) {
        raisons.push(
          contexte.budget === "epuise"
            ? `Budget IA épuisé : niveau ramené de ${niveau} à ${plafond}.`
            : `Budget IA tendu : niveau ramené de ${niveau} à ${plafond}.`,
        );
        niveau = plafond;
      }
    }

    return {
      agent: cle,
      niveau,
      modele: this.#modeles[niveau],
      niveauConfigure,
      plafonne: niveau !== niveauDemande,
      niveauDemande,
      raisons,
    };
  }

  /**
   * Les planchers que les signaux absolus imposent.
   *
   * Chacun rend le niveau EXIGÉ et la phrase qui l'explique. Les
   * fabriquer tous avant d'en appliquer un seul évite une cascade de
   * `if` imbriqués dont personne ne saurait dire, six mois plus tard,
   * lequel a gagné.
   */
  #planchers(contexte: ContexteRoutage): { niveau: NiveauModele; raison: string }[] {
    const planchers: { niveau: NiveauModele; raison: string }[] = [];

    if (contexte.risk === "high" || contexte.risk === "critical") {
      planchers.push({
        niveau: "advanced",
        raison: `Risque « ${contexte.risk} » : plancher advanced.`,
      });
    } else if (contexte.risk === "medium") {
      planchers.push({ niveau: "standard", raison: "Risque « medium » : plancher standard." });
    }

    const impact = exigerEntierPositif(contexte.financialImpact, "financialImpact");
    if (impact !== null) {
      if (impact >= SEUIL_IMPACT_AVANCE_CENTIMES) {
        planchers.push({
          niveau: "advanced",
          raison: `Impact financier de ${formatEuros(impact)} : plancher advanced.`,
        });
      } else if (impact >= SEUIL_IMPACT_STANDARD_CENTIMES) {
        planchers.push({
          niveau: "standard",
          raison: `Impact financier de ${formatEuros(impact)} : plancher standard.`,
        });
      }
    }

    const contexteTaille = exigerEntierPositif(contexte.contextSize, "contextSize");
    if (contexteTaille !== null) {
      if (contexteTaille > SEUIL_CONTEXTE_AVANCE_CARACTERES) {
        planchers.push({
          niveau: "advanced",
          raison: `Contexte de ${contexteTaille} caractères : plancher advanced.`,
        });
      } else if (contexteTaille > SEUIL_CONTEXTE_STANDARD_CARACTERES) {
        planchers.push({
          niveau: "standard",
          raison: `Contexte de ${contexteTaille} caractères : plancher standard.`,
        });
      }
    }

    const outils = exigerEntierPositif(contexte.requiredTools, "requiredTools");
    if (outils !== null) {
      if (outils >= SEUIL_OUTILS_AVANCE) {
        planchers.push({ niveau: "advanced", raison: `${outils} outils : plancher advanced.` });
      } else if (outils >= SEUIL_OUTILS_STANDARD) {
        planchers.push({ niveau: "standard", raison: `${outils} outils : plancher standard.` });
      }
    }

    if (contexte.requiredReasoning === true) {
      planchers.push({
        niveau: "advanced",
        raison: "Raisonnement en plusieurs étapes exigé : plancher advanced.",
      });
    }

    return planchers;
  }
}

/**
 * Un entier positif, ou `null` si le champ n'a pas été renseigné.
 *
 * LÈVE si la valeur est présente mais illisible. C'est le seul endroit
 * du routeur qui peut échouer, et c'est voulu : `Number("quarante")`
 * rend `NaN`, `NaN >= 500000` rend `false`, et sans ce garde-fou un
 * montant mal transmis choisirait tranquillement le modèle le moins
 * cher pour la décision la plus chère.
 */
function exigerEntierPositif(valeur: number | undefined, champ: string): number | null {
  if (valeur === undefined) return null;
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new TypeError(
      `AIModelRouter.resolve : « ${champ} » doit être un entier positif (reçu ${String(valeur)}).`,
    );
  }
  return valeur;
}

/** Des centimes entiers, dits en euros, pour une phrase lisible. */
function formatEuros(centimes: number): string {
  const euros = Math.trunc(centimes / 100);
  const reste = centimes % 100;
  return `${euros.toLocaleString("fr-FR")},${String(reste).padStart(2, "0")} €`;
}

// ------------------------------------------------------------------
// L'instance partagée
// ------------------------------------------------------------------

let routeurMemorise: AIModelRouter | null = null;

/**
 * Le routeur du processus.
 *
 * Construit à la PREMIÈRE demande, pas au chargement du module :
 * `process.env` n'est pas forcément peuplé quand un module est importé,
 * et un routeur figé trop tôt aurait ignoré les surcharges. Le prix à
 * payer est cette fonction au lieu d'une constante ; c'est peu cher.
 */
export function routeurModeles(): AIModelRouter {
  routeurMemorise ??= new AIModelRouter();
  return routeurMemorise;
}

/** Oublie l'instance partagée. Pour les tests, et pour eux seuls. */
export function reinitialiserRouteurModeles(): void {
  routeurMemorise = null;
}
