import {
  motifRefusAction,
  peutAgirSeul,
  peutExecuterApresAccord,
  peutPreparerUneAction,
  type ReglageAgent,
} from "./autonomy.ts";
import type { PropositionAction } from "./schemas.ts";
import type { IdentiteAppel, NiveauRisque, Permission } from "./types.ts";

/**
 * §11V — LA CHAÎNE D'ACTION (spec p. 13-14), QUI EST LE CRITÈRE FINAL.
 *
 * ══════════════════════════════════════════════════════════════════
 *   Agent → Proposition d'action structurée → OasisActionEngine
 *         → contrôle de permission → contrôle de risque → approbation
 *         → service métier → base
 * ══════════════════════════════════════════════════════════════════
 *
 * Sept maillons, et la valeur de la chaîne est celle du plus faible.
 * Ce fichier les tient tous, dans cet ordre, une seule fois — parce
 * qu'un contrôle de risque écrit dans trois agents finit par manquer
 * dans le quatrième.
 *
 * ─── CE QUE L'AGENT CHOISIT, ET CE QU'IL NE CHOISIT PAS ───
 *
 * Il choisit : le TYPE d'action, ses PARAMÈTRES, sa CIBLE, le MONTANT
 * qu'un outil a rendu.
 *
 * Il ne choisit PAS : le risque, le droit exigé, la nécessité d'une
 * confirmation, l'organisation. Les trois premiers viennent
 * d'`ai_action_catalog` (0072) ; le quatrième, de la session. Si le
 * risque venait de la proposition, un modèle poli finirait par écrire
 * « risque : faible » sur une facture de 20 000 € — et le moteur le
 * croirait.
 *
 * ─── LE RISQUE MONTE, IL NE DESCEND JAMAIS ───
 *
 * Le catalogue donne un PLANCHER (`default_risk_level`). Le montant
 * peut le relever : au-delà de vingt mille euros, une action passe en
 * `high` quoi qu'en dise le catalogue — c'est la règle déjà appliquée
 * par la fonction Edge, reprise telle quelle. Rien ne peut le
 * rabaisser, et surtout pas la proposition.
 *
 * ─── HIGH ET CRITICAL N'INTERROGENT MÊME PAS L'AUTOPILOTE ───
 *
 * La spec p. 15-16 : HIGH « Confirmation », CRITICAL « Confirmation
 * forte ». Il ne s'agit donc pas de demander à `ai_may_autoexecute`
 * et d'espérer un non : le chemin d'auto-exécution n'existe pas pour
 * ces deux niveaux. C'est vérifiable — un test compte les appels à la
 * base et exige ZÉRO. La différence pratique : le jour où quelqu'un
 * relâchera par erreur une condition d'`ai_may_autoexecute`, une
 * facture à 20 000 € ne partira toujours pas toute seule.
 *
 * ─── RIEN N'EST ÉCRIT DANS LE MÉTIER PAR CE FICHIER ───
 *
 * `ai_actions` et `ai_action_approvals` sont des tables de la couche
 * IA. Le seul chemin vers une écriture métier est `PortServicesMetier`,
 * et il n'est emprunté que lorsque `ai_may_autoexecute` a dit oui à ses
 * douze conditions. La confirmation humaine ordinaire, elle, passe par
 * l'écran et `answerApproval` — le chemin qui existe déjà et que cette
 * migration NE REMPLACE PAS.
 */

/**
 * Au-delà, une action passe en risque élevé quel que soit son
 * catalogue. Vingt mille euros (p. 15-16).
 *
 * ─── CE N'EST PLUS QU'UN MIROIR ───
 *
 * La règle vit désormais EN BASE, dans `ai_may_autoexecute`
 * (`ai_seuil_risque_eleve_cents()`, posée par 0076 § 6 bis). Il fallait
 * l'y mettre : la fonction Edge `oasis-pro-ai` calculait le même
 * relèvement, mais s'en servait uniquement comme ÉTIQUETTE — elle
 * écrivait `risk_level = 'high'` puis interrogeait quand même
 * l'autopilote, qui exécutait. Deux surfaces, deux réponses opposées à
 * la même question, et c'est la mauvaise qui était câblée.
 *
 * Cette constante-ci sert encore à CLASSER une action côté serveur —
 * pour que l'écran affiche le bon niveau et exige la bonne
 * confirmation. Mais elle ne garde plus la porte toute seule : si
 * quelqu'un la modifie ici sans toucher au SQL, la base refusera
 * quand même. `architecture_ia.sql` fige la valeur des deux côtés.
 */
export const RISQUE_ELEVE_AU_DELA_DE_CENTS = 2_000_000;

/**
 * Le budget d'actions d'UNE réponse.
 *
 * Sans plafond, un modèle qui rappelle l'outil à chaque tour
 * enregistrerait des dizaines de lots — soit des centaines de demandes
 * d'approbation pour une seule question. Ce n'est pas une hypothèse
 * d'école : c'est le mode de panne le plus banal d'une boucle d'outils,
 * et il écrit en base.
 */
export const ACTIONS_MAX_PAR_REPONSE = 20;

/** Vingt-quatre heures. Au-delà, le oui répond à une question périmée. */
export const EXPIRATION_APPROBATION = "24 hours";

const RANG_RISQUE: Record<NiveauRisque, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function risqueMax(a: NiveauRisque, b: NiveauRisque): NiveauRisque {
  return RANG_RISQUE[a] >= RANG_RISQUE[b] ? a : b;
}

/** Les deux niveaux qui exigent une réponse humaine, sans exception. */
export function exigeConfirmationHumaine(risque: NiveauRisque): boolean {
  return risque === "high" || risque === "critical";
}

// ==================================================================
// Le catalogue
// ==================================================================

/** Une ligne d'`ai_action_catalog` (0072), telle qu'on la lit. */
export type EntreeCatalogue = {
  actionType: string;
  /** L'agent PROPRIÉTAIRE. C'est lui dont on lit l'autonomie, jamais l'agent annoncé. */
  agent: string;
  label: string;
  risqueParDefaut: NiveauRisque;
  permissionRequise: string;
  ecrit: boolean;
  /** Vrai quand l'action engage de l'argent : un montant absent refusera l'autopilote. */
  engageDeLArgent: boolean;
};

// ==================================================================
// Les ports
// ==================================================================

export type ResultatServiceMetier =
  | { ok: true; message: string; resultat: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Le service métier — le dernier maillon (p. 14 : « Business Service »).
 *
 * `executeurs` déclare ce que ce produit sait FAIRE, par opposition à
 * ce que le catalogue sait NOMMER. Le catalogue déclare neuf actions ;
 * un seul exécuteur existe. Un `default: return ok` mentirait ; une
 * liste explicite permet de refuser AVANT d'écrire quoi que ce soit.
 */
export type PortServicesMetier = {
  executeurs: readonly string[];
  executer(appel: {
    organizationId: string;
    actionId: string;
    actionType: string;
    parametres: Record<string, unknown>;
  }): Promise<ResultatServiceMetier>;
};

export type PortActionEngine = {
  /** `ai_action_catalog`, par type. `null` quand le type n'existe pas. */
  catalogue(actionType: string): Promise<EntreeCatalogue | null>;
  /** Insère la ligne d'`ai_actions`. Rend son identifiant. */
  enregistrer(appel: {
    organizationId: string;
    actionType: string;
    agent: string;
    decisionId: string | null;
    cibleType: string | null;
    cibleId: string | null;
    parametres: Record<string, unknown>;
    risque: NiveauRisque;
    confirmationRequise: boolean;
    userId: string;
  }): Promise<string>;
  /** `ai_request_approval`. Rend l'identifiant de la demande. */
  demanderApprobation(appel: {
    actionId: string;
    risque: NiveauRisque;
    expiration: string;
  }): Promise<string>;
  /** `ai_may_autoexecute`. Toute erreur DOIT rendre `false`. */
  autoriseAutopilote(appel: {
    organizationId: string;
    agent: string;
    actionType: string;
    montantCents: number | null;
    cibleType: string | null;
    cibleId: string | null;
  }): Promise<boolean>;
  /** Le statut final d'une action auto-exécutée. */
  cloturer(appel: {
    organizationId: string;
    actionId: string;
    ok: boolean;
    resultat: Record<string, unknown>;
  }): Promise<void>;
  /** `ai_record_agent_event` (0072). Un échec ici ne fait rien échouer. */
  journaliser(appel: {
    organizationId: string;
    agent: string;
    evenement: string;
    actionId: string;
    parametres: Record<string, unknown>;
    confirmation: string;
    resultat: Record<string, unknown> | null;
  }): Promise<void>;
};

// ==================================================================
// L'entrée et la sortie
// ==================================================================

export type DemandeAction = {
  identite: IdentiteAppel;
  /** L'agent qui propose. Vérifié contre le catalogue, jamais cru sur parole. */
  agentDemandeur: string;
  proposition: PropositionAction;
  /** Le réglage d'autonomie de l'agent PROPRIÉTAIRE de l'action. */
  reglage: ReglageAgent;
  /** Le libellé de l'agent, pour les messages. */
  libelleAgent: string;
  /** La décision à laquelle rattacher l'action, s'il y en a une. */
  decisionId?: string | null;
};

export type ActionEnregistree = {
  actionId: string;
  approvalId: string | null;
  actionType: string;
  label: string;
  agent: string;
  risque: NiveauRisque;
  confirmationRequise: boolean;
  /** proposed · awaiting_approval · executed · failed */
  statut: "awaiting_approval" | "executed" | "failed";
  resume: string;
  montantCents: number | null;
  /** Ce que le service métier a rendu, quand l'autopilote a agi. */
  resultat: Record<string, unknown> | null;
};

/** Pourquoi une action n'a pas été enregistrée. Une clé, pour que l'écran puisse trier. */
export type MotifRefusAction =
  | "hors_catalogue"
  | "autonomie_insuffisante"
  | "droit_manquant"
  | "quota_actions"
  | "erreur_technique";

export type RefusAction = {
  ok: false;
  motif: MotifRefusAction;
  /** En français, destiné à l'humain ET au modèle. */
  message: string;
};

export type ResultatAction =
  | { ok: true; action: ActionEnregistree; avertissements: readonly string[] }
  | RefusAction;

/**
 * Ce que le contrôle préalable établit, sans rien écrire.
 *
 * Il existe pour une raison précise : l'Agents SDK INTERROMPT le tour
 * avant d'exécuter un outil marqué `needsApproval` (p. 14), et c'est à
 * ce moment-là que le serveur doit dire oui ou non — avant que la
 * moindre ligne parte en base. `agents.ts` appelle donc ceci à
 * l'interruption ; `proposer` le rappelle ensuite pour son propre
 * compte, parce qu'un contrôle qu'on peut contourner en appelant la
 * méthode d'à côté n'est pas un contrôle.
 */
export type ControlePrealable =
  | {
      ok: true;
      entree: EntreeCatalogue;
      risque: NiveauRisque;
      /** Vrai quand ce risque interdit toute exécution sans humain. */
      confirmationHumaineObligatoire: boolean;
      avertissements: readonly string[];
    }
  | RefusAction;

// ==================================================================
// LE MOTEUR
// ==================================================================

export class OasisActionEngine {
  readonly #port: PortActionEngine;
  readonly #services: PortServicesMetier;
  readonly #maxActions: number;

  /** Le compteur de la réponse en cours. Une instance par requête. */
  #enregistrees = 0;

  constructor(
    port: PortActionEngine,
    services: PortServicesMetier,
    options: { maxActions?: number } = {},
  ) {
    this.#port = port;
    this.#services = services;
    this.#maxActions = options.maxActions ?? ACTIONS_MAX_PAR_REPONSE;
  }

  /** Combien d'actions cette réponse a déjà enregistrées. */
  get compteur(): number {
    return this.#enregistrees;
  }

  /**
   * LES QUATRE PREMIERS MAILLONS, SANS RIEN ÉCRIRE.
   *
   * Catalogue → autonomie → droit → risque. Aucune insertion, aucun
   * appel à l'autopilote : cette méthode ne fait que RÉPONDRE.
   *
   * Elle est publique parce que le SDK interrompt le tour avant
   * d'exécuter un outil marqué `needsApproval` (p. 14) et qu'il faut
   * alors décider, côté serveur, s'il faut laisser le tour reprendre.
   * Décider là avec une logique parallèle aurait produit deux règles
   * qui divergent ; ici, c'est la même.
   */
  async verifierPrealable(demande: DemandeAction): Promise<ControlePrealable> {
    const avertissements: string[] = [];
    const { proposition, identite } = demande;

    // ── 0. Le budget de la réponse ────────────────────────────────
    if (this.#enregistrees >= this.#maxActions) {
      return {
        ok: false,
        motif: "quota_actions",
        message:
          `Le maximum de ${this.#maxActions} actions par réponse est atteint. Réponds avec ce qui ` +
          "est déjà préparé, et dis à l'utilisateur qu'il pourra demander la suite ensuite.",
      };
    }

    // ── 1. LE CATALOGUE ───────────────────────────────────────────
    //
    // Il vient AVANT tout le reste parce qu'il porte le risque et le
    // droit. Un type inconnu s'arrête ici, sans qu'aucune ligne n'ait
    // été écrite et sans qu'aucun droit n'ait été évalué contre une
    // valeur inventée.
    let entree: EntreeCatalogue | null;
    try {
      entree = await this.#port.catalogue(proposition.actionType);
    } catch (erreur) {
      return {
        ok: false,
        motif: "erreur_technique",
        message: `Le catalogue d'actions n'a pas pu être lu : ${messageDe(erreur)}`,
      };
    }

    if (entree === null) {
      return {
        ok: false,
        motif: "hors_catalogue",
        message:
          `« ${proposition.actionType} » ne figure pas au catalogue d'actions d'Oasis. ` +
          "Aucune action n'a été enregistrée. Dis-le à l'utilisateur plutôt que de reformuler.",
      };
    }

    // L'agent annoncé par le modèle est VÉRIFIÉ, il ne sert à rien
    // d'autre. C'est celui du catalogue qui gouverne — même règle
    // qu'`ai_may_autoexecute`, qui charge les réglages sur l'agent
    // propriétaire et non sur celui qu'on lui déclare.
    if (demande.agentDemandeur !== entree.agent) {
      avertissements.push(
        `L'action « ${entree.actionType} » appartient à l'agent « ${entree.agent} », ` +
          `pas à « ${demande.agentDemandeur} » : c'est l'autonomie du propriétaire qui s'applique.`,
      );
    }

    // ── 2. L'AUTONOMIE ────────────────────────────────────────────
    if (!peutPreparerUneAction(demande.reglage)) {
      return {
        ok: false,
        motif: "autonomie_insuffisante",
        message: motifRefusAction(demande.reglage, demande.libelleAgent),
      };
    }

    // ── 3. LE DROIT ───────────────────────────────────────────────
    //
    // Deuxième serrure, pas la barrière : `ai_guard` et la RLS
    // refuseraient de toute façon. Ce qu'on gagne ici est une PHRASE —
    // « votre rôle ne permet pas d'émettre une facture » plutôt qu'un
    // refus SQL — et un aller-retour de base économisé.
    if (!detient(identite.permissions, entree.permissionRequise)) {
      return {
        ok: false,
        motif: "droit_manquant",
        message:
          `Ce compte n'a pas le droit « ${entree.permissionRequise} », qu'exige ` +
          `« ${entree.label} ». Demandez-le à un administrateur. Rien n'a été enregistré.`,
      };
    }

    // ── 4. LE RISQUE ──────────────────────────────────────────────
    const risque = risqueEffectif(entree, proposition.montantCents);

    // Un exécuteur absent se dit AVANT d'écrire quoi que ce soit. La
    // remarque ne vaut que pour les niveaux ≥ 3 : au niveau 2, l'accord
    // est enregistré et le geste se fait à la main, ce qui a un sens
    // même sans exécuteur.
    if (
      !this.#services.executeurs.includes(entree.actionType) &&
      peutExecuterApresAccord(demande.reglage)
    ) {
      avertissements.push(
        `Oasis ne sait pas exécuter « ${entree.label} » lui-même : la validation sera ` +
          "enregistrée, mais le geste restera à faire à la main depuis l'écran correspondant.",
      );
    }

    return {
      ok: true,
      entree,
      risque,
      confirmationHumaineObligatoire: exigeConfirmationHumaine(risque),
      avertissements,
    };
  }

  async proposer(demande: DemandeAction): Promise<ResultatAction> {
    const { proposition, identite } = demande;

    const prealable = await this.verifierPrealable(demande);
    if (!prealable.ok) return prealable;

    const { entree, risque } = prealable;
    const avertissements: string[] = [...prealable.avertissements];
    const montant = proposition.montantCents;
    const executeurConnu = this.#services.executeurs.includes(entree.actionType);

    // ── 5. L'AUTOPILOTE — jamais pour high ni critical ────────────
    //
    // L'ordre de ce test EST la règle. Interroger `ai_may_autoexecute`
    // pour un risque élevé et se fier à son « non » reviendrait à faire
    // dépendre un interdit de la spec des douze conditions d'une
    // fonction SQL. Ici, le chemin n'existe simplement pas.
    let autopilote = false;
    if (
      !exigeConfirmationHumaine(risque) &&
      executeurConnu &&
      peutAgirSeul(demande.reglage)
    ) {
      try {
        autopilote = await this.#port.autoriseAutopilote({
          organizationId: identite.organizationId,
          agent: entree.agent,
          actionType: entree.actionType,
          montantCents: montant,
          cibleType: proposition.cibleType,
          cibleId: proposition.cibleId,
        });
      } catch (erreur) {
        // Fermé sur erreur, comme la fonction SQL elle-même. Mais on le
        // DIT : « l'autopilote ne part jamais » sans explication est
        // exactement la panne qu'on cherche des semaines.
        autopilote = false;
        avertissements.push(
          `L'autorisation d'autopilote n'a pas pu être vérifiée (${messageDe(erreur)}) : ` +
            "une validation humaine est demandée.",
        );
      }
    }

    // ── 6. LA LIGNE D'ACTION ──────────────────────────────────────
    let actionId: string;
    try {
      actionId = await this.#port.enregistrer({
        organizationId: identite.organizationId,
        actionType: entree.actionType,
        agent: entree.agent,
        decisionId: demande.decisionId ?? null,
        cibleType: proposition.cibleType,
        cibleId: proposition.cibleId,
        parametres: proposition.parameters,
        risque,
        // `requires_confirmation` est le miroir exact de la décision
        // ci-dessus. La colonne a `default true` en base (0072) : si
        // jamais on oubliait de la poser, l'oubli produirait « il faut
        // confirmer ». On la pose quand même, explicitement.
        confirmationRequise: !autopilote,
        userId: identite.userId,
      });
    } catch (erreur) {
      return {
        ok: false,
        motif: "erreur_technique",
        message: `L'action n'a pas pu être enregistrée : ${messageDe(erreur)}`,
      };
    }

    this.#enregistrees += 1;

    // ── 7a. L'AUTOPILOTE AGIT ─────────────────────────────────────
    if (autopilote) {
      const sortie = await this.#executerService(identite.organizationId, actionId, entree, proposition);

      await this.#journaliserSansCasser({
        organizationId: identite.organizationId,
        agent: entree.agent,
        evenement: sortie.ok ? "aiActionExecuted" : "aiActionFailed",
        actionId,
        parametres: { actionType: entree.actionType, montantCents: montant, risque },
        confirmation: "autopilot",
        resultat: sortie.ok ? sortie.resultat : { erreur: sortie.message },
      });

      return {
        ok: true,
        avertissements,
        action: {
          actionId,
          approvalId: null,
          actionType: entree.actionType,
          label: entree.label,
          agent: entree.agent,
          risque,
          confirmationRequise: false,
          statut: sortie.ok ? "executed" : "failed",
          resume: proposition.resume,
          montantCents: montant,
          resultat: sortie.ok ? sortie.resultat : { erreur: sortie.message },
        },
      };
    }

    // ── 7b. L'APPROBATION ─────────────────────────────────────────
    //
    // `ai_request_approval` (0072) relit l'organisation et le risque
    // sur l'action elle-même, exige `projects.manage`, borne
    // l'expiration à sept jours, et fait passer l'action en
    // `awaiting_approval`. Rien de tout cela n'est refait ici.
    let approvalId: string;
    try {
      approvalId = await this.#port.demanderApprobation({
        actionId,
        risque,
        expiration: EXPIRATION_APPROBATION,
      });
    } catch (erreur) {
      // L'action existe, la demande non : elle resterait `proposed`,
      // invisible dans la boîte de réception. On le dit franchement
      // plutôt que d'annoncer « en attente de validation » sur une
      // ligne que personne ne verra jamais.
      return {
        ok: false,
        motif: "erreur_technique",
        message:
          `L'action a été enregistrée mais la demande de validation a échoué (${messageDe(erreur)}). ` +
          "Elle n'apparaîtra pas dans les validations en attente.",
      };
    }

    await this.#journaliserSansCasser({
      organizationId: identite.organizationId,
      agent: entree.agent,
      evenement: "aiActionProposed",
      actionId,
      parametres: { actionType: entree.actionType, montantCents: montant, risque },
      confirmation: "requested",
      resultat: null,
    });

    return {
      ok: true,
      avertissements,
      action: {
        actionId,
        approvalId,
        actionType: entree.actionType,
        label: entree.label,
        agent: entree.agent,
        risque,
        confirmationRequise: true,
        statut: "awaiting_approval",
        resume: proposition.resume,
        montantCents: montant,
        resultat: null,
      },
    };
  }

  /**
   * Le service métier, puis la clôture de la ligne.
   *
   * La clôture est faite ICI et pas par l'appelant : une action
   * exécutée qui reste `approved` en base est une action qu'on
   * réexécutera. Un échec de clôture ne défait pas l'exécution — c'est
   * impossible — mais il est signalé.
   */
  async #executerService(
    organizationId: string,
    actionId: string,
    entree: EntreeCatalogue,
    proposition: PropositionAction,
  ): Promise<ResultatServiceMetier & { resultat: Record<string, unknown> }> {
    let sortie: ResultatServiceMetier;
    try {
      sortie = await this.#services.executer({
        organizationId,
        actionId,
        actionType: entree.actionType,
        parametres: proposition.parameters,
      });
    } catch (erreur) {
      sortie = { ok: false, message: messageDe(erreur) };
    }

    const resultat = sortie.ok ? sortie.resultat : { erreur: sortie.message };

    try {
      await this.#port.cloturer({ organizationId, actionId, ok: sortie.ok, resultat });
    } catch (erreur) {
      console.error(
        `action IA ${actionId} : exécutée mais non clôturée en base (${messageDe(erreur)}). ` +
          "Elle reste au statut « approved » et pourrait être rejouée.",
      );
    }

    return sortie.ok
      ? { ok: true, message: sortie.message, resultat }
      : { ok: false, message: sortie.message, resultat };
  }

  async #journaliserSansCasser(appel: Parameters<PortActionEngine["journaliser"]>[0]): Promise<void> {
    try {
      await this.#port.journaliser(appel);
    } catch (erreur) {
      // Le journal d'audit qui tombe ne défait pas ce qui a été fait.
      // Mais un trou dans un journal d'audit doit se voir.
      console.error(
        `journal d'agent : l'événement « ${appel.evenement} » sur l'action ${appel.actionId} ` +
          `n'a pas été inscrit (${messageDe(erreur)}).`,
      );
    }
  }
}

// ==================================================================
// Aides
// ==================================================================

/**
 * Le risque réellement appliqué : le plancher du catalogue, relevé par
 * le montant.
 *
 * `montant === null` NE RELÈVE PAS le risque, et ce n'est pas un oubli.
 * Un montant inconnu est déjà traité là où il compte :
 * `ai_may_autoexecute` refuse l'autopilote quand le catalogue dit que
 * l'action engage de l'argent et qu'aucun montant n'est fourni (0072).
 * Le relever ici en plus ferait passer en `high` toute action sans
 * montant — y compris une note interne — et noierait la distinction que
 * la page 15 établit entre les quatre niveaux.
 */
export function risqueEffectif(entree: EntreeCatalogue, montantCents: number | null): NiveauRisque {
  if (montantCents !== null && montantCents >= RISQUE_ELEVE_AU_DELA_DE_CENTS) {
    return risqueMax(entree.risqueParDefaut, "high");
  }
  return entree.risqueParDefaut;
}

/**
 * La permission du catalogue est du TEXTE en base (`required_permission
 * text not null`), pas un énuméré. On compare donc des chaînes, sans
 * caster : un droit qui n'existe pas dans `PERMISSIONS` doit rendre
 * `false`, pas provoquer une erreur de type qui n'existerait qu'à la
 * compilation.
 */
export function detient(permissions: readonly Permission[], requise: string): boolean {
  return (permissions as readonly string[]).includes(requise);
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
