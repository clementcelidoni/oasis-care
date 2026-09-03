import type { CategorieDecision } from "../runtime/schemas.ts";
import type { CibleContexte } from "../runtime/context.ts";
import type { SignauxRoutage } from "../runtime/run.ts";
import type { AgentConstruit } from "../runtime/definitions.ts";
import type { Confiance, Criticite, NiveauModele, Permission } from "../runtime/types.ts";

/**
 * §11V — ÉTAPE 18 : LE VOCABULAIRE DE LA SUITE D'ÉVALUATIONS
 * (spec « Architecture IA des Agents », p. 24 et p. 32).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'UNE ÉVALUATION EST, ET CE QU'ELLE N'EST PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * La page 24 nomme sept cas : devis sous-tarifé, devis rentable,
 * chantier non facturé, planning inefficace, stock insuffisant, camion
 * coûteux, aucune donnée suffisante. Elle ne dit pas ce qu'il faut en
 * vérifier. C'est là que tout se joue, parce qu'il existe deux façons
 * radicalement différentes d'« évaluer » un agent :
 *
 *   • VÉRIFIER LA PLOMBERIE — quel niveau de modèle a été choisi, quels
 *     outils ont été offerts, la sortie colle-t-elle au schéma, rien
 *     n'a-t-il été écrit en base, la dépense est-elle au grand livre,
 *     l'organisation a-t-elle été injectée. Tout cela se prouve avec un
 *     modèle SIMULÉ, en quelques millisecondes, sans dépenser un jeton,
 *     et le résultat est reproductible à l'octet près.
 *
 *   • VÉRIFIER LE JUGEMENT — le modèle repère-t-il vraiment que ce
 *     devis-là est sous-tarifé, se tait-il vraiment quand la donnée
 *     manque, s'abstient-il de recalculer une marge qu'on lui a déjà
 *     donnée. Cela ne se prouve QU'AVEC UN VRAI APPEL, et le résultat
 *     n'est pas reproductible : c'est une mesure, pas un test.
 *
 * Les deux sont nécessaires et ne vivent pas au même endroit. La
 * plomberie tourne dans `npm test`, à chaque commit. Le jugement tourne
 * à la main, avec une clé, quand on change de modèle ou d'instruction —
 * `cli.ts`. Mélanger les deux donnerait soit une intégration continue
 * qui envoie une facture à chaque `git push`, soit une suite verte qui
 * ne dit rien de ce que l'utilisateur reçoit.
 *
 * Chaque cas déclare donc lui-même, en français, `sansModele` (ce que
 * le mode simulé prouve) et `avecUnVraiModele` (ce qu'il ne prouve
 * pas). Le rapport imprime les deux listes : une évaluation qui laisse
 * croire qu'elle a tout vérifié est pire qu'une évaluation absente.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS DES SEPT CAS NE SONT PAS EXÉCUTABLES, ET C'EST LE RÉSULTAT
 * ══════════════════════════════════════════════════════════════════
 *
 * « Planning inefficace » et « camion coûteux » n'ont, dans ce produit,
 * ni agent ni fonction SQL — `OUTILS_SPEC_SANS_SERVICE` (tools.ts) les
 * nomme déjà comme absents. « Stock insuffisant » a bien deux outils
 * (`getNurseryStock`, `getProjectedNurseryNeeds`) mais aucun agent
 * construit pour les porter.
 *
 * Ces trois cas sont donc marqués `absent` ou `outils_seuls`, ils
 * comptent à part, et le rapport les affiche comme NON EXÉCUTÉS — pas
 * comme réussis. Une suite qui écrirait « 7/7 » en n'ayant réellement
 * joué que quatre cas mentirait sur la couverture, ce qui est
 * exactement le service que rend une évaluation : dire ce qui est
 * défendu et ce qui ne l'est pas.
 */

// ==================================================================
// 1. Les deux modes
// ==================================================================

/**
 * `simule` : un modèle scripté, aucun réseau, aucun jeton.
 * `reel`   : le fournisseur OpenAI, avec une clé, hors intégration continue.
 *
 * Les DONNÉES sont les mêmes dans les deux modes — les fixtures passent
 * par le port de lecture, jamais par la base. C'est ce qui rend le mode
 * réel utile : le modèle voit exactement le devis sous-tarifé qu'on a
 * écrit, et son jugement est comparable d'une exécution à l'autre.
 */
export type ModeEval = "simule" | "reel";

// ==================================================================
// 2. La couverture d'un cas
// ==================================================================

/**
 * Jusqu'où ce produit sait aller sur ce cas.
 *
 *   `couvert`      — un agent existe, ses outils existent, le cas se
 *                    joue de bout en bout.
 *   `outils_seuls` — les fonctions SQL existent, aucun agent ne les
 *                    porte. Le cas ne se joue pas ; on vérifie quand
 *                    même que les outils sont là et qu'aucun agent
 *                    construit ne se les voit offrir par erreur.
 *   `absent`       — rien n'existe. Le cas ne se joue pas, et la raison
 *                    est écrite.
 */
export type Couverture = "couvert" | "outils_seuls" | "absent";

// ==================================================================
// 3. Ce qu'un modèle simulé joue
// ==================================================================

/**
 * Un tour de modèle.
 *
 * `outil` : le modèle appelle un outil. `final` : il rend sa sortie
 * structurée. `panne` : il lève — c'est ainsi que le cas FAILURE
 * fabrique une expiration sans attendre trente secondes.
 */
export type Tour =
  | { type: "outil"; nom: string; arguments?: Record<string, unknown> }
  | { type: "final"; sortie: unknown }
  | { type: "panne"; erreur: Error };

// ==================================================================
// 4. Ce qu'on attend d'un scénario
// ==================================================================

export type AttentesCas = {
  /**
   * Le niveau que le routeur DOIT choisir.
   *
   * Comparé à l'identifiant réellement demandé au fournisseur, jamais à
   * une chaîne écrite ici : les trois identifiants n'existent que dans
   * `lib/ai/model/router.ts` et cette suite ne les recopie pas.
   */
  niveau: NiveauModele;

  /** L'appel doit-il rendre une réponse ? `false` pour un refus attendu. */
  aboutit: boolean;

  /**
   * Vrai quand AUCUN modèle ne doit être appelé.
   *
   * C'est l'attente du cas « aucune donnée suffisante » : ne pas
   * répondre coûte zéro, et le prouver demande de compter les appels au
   * fournisseur, pas de lire le message rendu.
   */
  sansAppelDeModele?: boolean;

  /** La confiance que la sortie doit porter. */
  confiance?: Confiance;

  /** Des outils qui DOIVENT être offerts au modèle. */
  outilsOfferts?: readonly string[];

  /**
   * Des outils qui ne doivent JAMAIS l'être.
   *
   * L'absence de la liste offerte n'est que la moitié du contrôle
   * TOOLS ; l'autre moitié — le refus à l'exécution — est éprouvée par
   * `obligatoires.test.ts`, qui appelle l'outil directement.
   */
  outilsInterdits?: readonly string[];

  recommandationsMin?: number;
  recommandationsMax?: number;

  /**
   * Des catégories que la réponse ne doit pas employer.
   *
   * Sert au cas « devis rentable » : un agent qui crie au loup sur un
   * devis sain est aussi inutile qu'un agent muet sur un devis raté, et
   * c'est le défaut qu'une suite d'évaluations ne voit jamais si elle
   * n'exerce que les cas alarmants.
   */
  categoriesInterdites?: readonly CategorieDecision[];

  /**
   * Le montant que la recommandation de tête doit porter, en CENTIMES
   * ENTIERS, ou `null` quand elle ne doit en porter aucun.
   *
   * Enveloppé dans un objet parce que `null` est une valeur attendue et
   * non une absence d'attente : `impactPrincipalCents: { cents: null }`
   * veut dire « aucun montant, et c'est vérifié ».
   */
  impactPrincipalCents?: { cents: number | null };

  /** La liste `donneesManquantes` de la sortie doit-elle être remplie ? */
  donneesManquantes?: "vide" | "nonVide";

  /**
   * L'action que le moteur doit avoir enregistrée — et laissée en
   * attente. Aucun scénario n'attend jamais une action exécutée : c'est
   * le critère ACTION de la page 32.
   */
  actionAttendue?: { actionType: string };

  /** Des fragments que le message de refus doit contenir. */
  messageContient?: readonly string[];
};

// ==================================================================
// 5. Un scénario, puis un cas
// ==================================================================

export type ScenarioEval = {
  id: string;
  intitule: string;
  agent: AgentConstruit;
  question: string;
  cible?: CibleContexte;
  criticite: Criticite;
  routage?: SignauxRoutage;
  /** Les droits de la session. Par défaut, tous ceux dont l'agent a besoin. */
  permissions?: readonly Permission[];

  /**
   * Ce que les fonctions SQL rendraient, indexé par nom de fonction.
   *
   * Les fixtures sont écrites dans la FORME EXACTE de 0073 — mêmes
   * clés, mêmes centimes entiers. Une fixture inventée validerait un
   * agent contre des données qui n'existent pas.
   */
  donnees: Record<string, unknown>;

  /**
   * Les fonctions dont la lecture ÉCHOUE, par leur nom.
   *
   * C'est ainsi que se fabrique « aucune donnée suffisante » : la
   * source requise ne répond pas, le contexte est vide, et le système
   * doit le dire sans payer personne.
   */
  lecturesEnEchec?: readonly string[];

  /** Ce que le modèle simulé joue. Ignoré en mode réel. */
  script: readonly Tour[];

  attentes: AttentesCas;
};

export type CasEval = {
  /** L'identifiant court, employé par le rapport et la ligne de commande. */
  id: string;
  /** Le nom du cas, tel que la page 24 l'écrit. */
  titre: string;
  couverture: Couverture;
  /** Pourquoi ce cas n'est pas exécutable. Obligatoire quand il ne l'est pas. */
  raison?: string;
  /** Ce que le mode simulé prouve. Une phrase par contrôle. */
  sansModele: readonly string[];
  /** Ce qu'aucun modèle simulé ne peut prouver. */
  avecUnVraiModele: readonly string[];
  /** Vide quand le cas n'est pas exécutable. */
  scenarios: readonly ScenarioEval[];
};

// ==================================================================
// 6. Ce que l'exécution rend
// ==================================================================

export type Controle = {
  /** Court, et lisible dans un rapport : « ROUTAGE », « ÉCRITURE »… */
  nom: string;
  ok: boolean;
  /** Ce qui a été observé, en français. Renseigné même quand `ok`. */
  detail: string;
};

export type ConstatScenario = {
  scenario: string;
  intitule: string;
  mode: ModeEval;
  controles: readonly Controle[];
  /** `null` quand aucun niveau tarifé n'a servi — jamais 0 pour « inconnu ». */
  coutEstimeCents: number | null;
  /** Le nombre d'appels de modèle réellement passés. */
  appelsModele: number;
};

export type ConstatCas = {
  cas: string;
  titre: string;
  couverture: Couverture;
  statut: "reussi" | "echoue" | "non_executable";
  /** Vide quand `non_executable`. */
  scenarios: readonly ConstatScenario[];
  /** La raison, quand le cas n'est pas exécutable. */
  raison?: string;
  nonVerifie: readonly string[];
};

export type RapportEval = {
  mode: ModeEval;
  /** L'instant du passage, ISO 8601. */
  quand: string;
  cas: readonly ConstatCas[];
  reussis: number;
  echoues: number;
  nonExecutables: number;
  /** `null` quand un niveau employé n'a pas de tarif renseigné. */
  coutTotalCents: number | null;
};
