import type { AgentInputItem } from "@openai/agents";
// Chemins RELATIFS : ce module tourne sous `node --test`, qui ne lit
// pas les `paths` du tsconfig. Les deux fichiers visés sont purs — un
// formateur de centimes, un convertisseur de fuseau — et sont en
// lecture seule pour cette phase.
import { formatCents } from "../../quotes/types.ts";
import { parisDay } from "../../field/types.ts";

/**
 * §11W — UNE CONVERSATION AVEC OASIS : LE NOYAU PUR.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'IMPORTE AUCUN CODE, ET C'EST LA CONDITION DE SON UTILITÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Ni Supabase, ni Next, ni de valeur venue du SDK — seulement le TYPE
 * `AgentInputItem`, effacé à la compilation. Tout ce qui décide de ce
 * que le modèle relira — la lecture de la queue, sa mise en forme, le
 * repérage de la coupe — se joue ici, et se joue donc sous
 * `node --test` sans base et sans réseau. Les fichiers voisins ne font
 * que du transport.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA SEULE PROMESSE DE TOUT CE MODULE
 * ══════════════════════════════════════════════════════════════════
 *
 * DANS un fil, les tours précédents sont RÉELLEMENT transmis au modèle.
 * ENTRE deux fils, rien ne l'est.
 *
 * L'écran d'avant portait le commentaire inverse — « afficher une
 * conversation continue laisserait croire à une mémoire » qui n'existe
 * pas — et il avait raison SUR LES FAITS DE L'ÉPOQUE : chaque question
 * repartait de zéro. Cette phase ne le contredit pas, elle rend vrai ce
 * qu'il redoutait de laisser croire. Le jour où quelqu'un débranche le
 * rejeu, l'écran redevient un mensonge : c'est pourquoi le drapeau
 * `tronque` et la queue sortent du MÊME calcul (`ai_conversation_tail`,
 * migration 0079) et ne peuvent pas diverger.
 */

// ==================================================================
// 1. Les bornes
// ==================================================================

/**
 * Deux mille caractères pour une question.
 *
 * Le chiffre n'est pas choisi ici : c'est celui que la fonction Edge
 * (`MAX_QUESTION_LENGTH`), le Route Handler (`LONGUEUR_QUESTION_MAX`)
 * et la contrainte `ai_conversation_messages_contenu_borne` refusent
 * déjà tous les trois. Le recopier n'est pas une duplication : c'est la
 * même règle, tenue à chaque porte, et la base est la dernière.
 */
export const LONGUEUR_QUESTION_MAX = 2_000;

/**
 * CE QUI REPART AU MODÈLE, ET RIEN DE PLUS.
 *
 * Deux bornes simultanées, la plus stricte gagne — la fonction SQL les
 * applique, ces constantes ne font que les demander. Elles sont ici
 * pour que l'écran puisse dire la même chose que le serveur, jamais
 * pour décider à sa place : `ai_conversation_tail` borne ses propres
 * paramètres (40 messages, 12 000 caractères), et un appelant qui
 * demanderait davantage serait ramené sans le savoir.
 *
 *   • SEIZE MESSAGES, soit huit échanges. À comparer aux huit tours
 *     d'outils déjà autorisés pour une seule question.
 *
 *   • SIX MILLE CARACTÈRES. `SEUIL_CONTEXTE_STANDARD_CARACTERES` vaut
 *     12 000 (`lib/ai/model/router.ts`) : c'est le seuil à partir
 *     duquel le routeur fait monter l'agent d'un cran de modèle, donc
 *     de prix. On reste franchement dessous pour que la conversation ne
 *     décide JAMAIS du modèle à elle seule.
 */
export const BORNES_REJEU = Object.freeze({
  messages: 16,
  caracteres: 6_000,
});

/**
 * Le plafond de messages par fil, tel que le déclencheur de 0079
 * l'oppose.
 *
 * Connu ici pour prévenir AVANT de refuser : un fil à 190 messages doit
 * pouvoir le dire, plutôt que de laisser l'utilisateur découvrir le mur
 * en perdant sa question.
 */
export const MESSAGES_PAR_FIL_MAX = 200;

// ==================================================================
// 2. Les formes
// ==================================================================

export type RoleMessage = "user" | "assistant";

/**
 * ══════════════════════════════════════════════════════════════════
 * OÙ PASSE LA FRONTIÈRE ENTRE `contenu` ET `payload`
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle passe là où l'écran et le modèle risqueraient de diverger.
 *
 * `contenu` est LA RÉPONSE : le résumé, puis une ligne par
 * recommandation — titre, impact en centimes, action recommandée — puis
 * ce qui manquait pour conclure. Tout est composé HORS MODÈLE, par
 * `composerContenu`, à partir de la sortie structurée. C'est ce texte
 * qui s'affiche, et c'est EXACTEMENT ce texte que la queue du § 4
 * renvoie au modèle au tour suivant.
 *
 * ─── POURQUOI PAS SEULEMENT LE `resume` ───
 *
 * Parce que l'architecture IA a délibérément sorti la substance du
 * résumé : pour la Direction il vaut « le brief, en trois phrases au
 * plus » à côté de cinq `decisions` structurées ; pour un spécialiste il
 * est « bref » à côté de dix `recommandations`. Ne garder que lui, c'est
 * répondre « trois chantiers dépassent leur budget » à « lesquels ? ».
 * L'écran d'avant, lui, affichait la prose entière de la fonction Edge.
 *
 * ─── ET POURQUOI CE N'EST PAS DU JSON QU'ON REJOUE ───
 *
 * Rejouer la sortie structurée réapprendrait au modèle son propre schéma
 * à chaque tour et brûlerait le budget de queue en balisage. Une phrase
 * française composée par nous coûte moins cher et se relit mieux.
 *
 * `payload` porte le RESTE, qui n'est pas de la substance :
 *
 *   • les RAISONS de chaque recommandation — repliées derrière
 *     « Pourquoi ? », et que le modèle sait recalculer ;
 *   • la CONFIANCE et l'AMBIGUÏTÉ — un badge, pas une phrase ;
 *   • les AVERTISSEMENTS DU RUNTIME — ils parlent de la machine (un
 *     repli de modèle, un droit manquant, un montant retiré), pas de
 *     l'entreprise, et les rejouer inviterait le modèle à s'en excuser ;
 *   • les ACTIONS PRÉPARÉES — des boutons, dont l'état vit dans
 *     `ai_action_approvals` et change après coup.
 */
export type RaisonsRecommandation = {
  titre: string;
  /** « Ce qu'il se passe et pourquoi ça compte » — le `summary` du schéma. */
  pourquoi: string | null;
  raisons: string[];
};

/** Une action déjà enregistrée par le moteur, telle que le fil la montre. */
export type ActionPreparee = {
  actionId: string;
  approvalId: string | null;
  libelle: string;
  resume: string;
  /** Centimes entiers. `null` = montant inconnu, jamais zéro. */
  montantCents: number | null;
};

export type CoucheAffichee = {
  /** `high`, `medium`, `low`, `insufficient_data` — ou `null` si non dite. */
  confiance: string | null;
  ambigu: boolean;
  raisons: RaisonsRecommandation[];
  avertissements: string[];
  actions: ActionPreparee[];
};

export const COUCHE_VIDE: CoucheAffichee = Object.freeze({
  confiance: null,
  ambigu: false,
  raisons: [],
  avertissements: [],
  actions: [],
});

export type MessageFil = {
  id: string;
  role: RoleMessage;
  contenu: string;
  /** ISO 8601, posé par le serveur — jamais par le client (0079, § 4). */
  ecritLe: string;
  /**
   * Les outils lus pour cette réponse.
   *
   * `null` ET `[]` NE DISENT PAS LA MÊME CHOSE, et la base les
   * distingue exprès : `null` = on ne sait pas, `[]` = le modèle n'a
   * rien consulté. L'écran doit se taire dans le premier cas et non
   * afficher « aucune donnée consultée ».
   */
  outils: string[] | null;
  /** Le niveau de modèle employé, jamais son identifiant (spec p. 27). */
  modele: string | null;
  /**
   * La proposition portée par ce tour, encore sous sa forme brute.
   *
   * Volontairement `unknown` : la colonne est un `jsonb` SANS contrainte
   * d'énumération, et c'est le bon choix en base — le catalogue des
   * `kind` vit dans `lib/ai/proposals.ts`, et le recopier en SQL ferait
   * deux listes qui divergeraient au premier ajout, avec la base en
   * tort et en silence. La vérification appartient donc au code, du
   * côté où la liste est vraie : `lireProposition` s'en charge.
   */
  proposition: unknown;
  /** `pending`, `executed`, `declined` — ou `null` si ce n'en est pas une. */
  statutProposition: string | null;
  /** Ce qui s'affiche EN PLUS de la prose. Jamais ce qui repart au modèle. */
  couche: CoucheAffichee;
};

export type FilResume = {
  id: string;
  /** `null` tant que le fil n'a rien porté : l'écran écrit « Nouvelle conversation ». */
  titre: string | null;
  /** `null` = fil ouvert et jamais parlé. Différent d'un fil muet depuis trois mois. */
  dernierMessageLe: string | null;
  ouvertLe: string;
};

/**
 * Ce que `ai_conversation_tail` rend : la queue, et de quoi la
 * raconter.
 *
 * `tronque` ne se déduit PAS d'une comparaison faite à l'écran. Il sort
 * du parcours qui a fabriqué la queue, ce qui est toute la raison d'être
 * de la fonction SQL : l'écran ne peut pas annoncer une conversation
 * complète pendant que le modèle en reçoit la moitié.
 */
export type QueueFil = {
  messages: { role: RoleMessage; contenu: string; ecritLe: string }[];
  total: number;
  rejoues: number;
  omis: number;
  caracteres: number;
  tronque: boolean;
  /**
   * LA QUEUE N'A PAS PU ÊTRE LUE — ce qui n'est pas « le fil est vide ».
   *
   * La distinction est la même que partout ailleurs dans ce dossier, et
   * elle est plus grave ici qu'ailleurs. Une queue illisible rendue
   * comme une queue vide affichait le fil entier, sans filet de coupe,
   * sous un en-tête affirmant « Oasis relit cette conversation » — puis
   * envoyait la question suivante avec `historique: []`. C'est-à-dire
   * exactement la divergence écran/modèle que ce module existe pour
   * rendre impossible, obtenue par une panne au lieu d'un oubli.
   */
  illisible: boolean;
};

/** Une queue vide : un fil neuf, ou un fil qui n'a réellement rien avant. */
export const QUEUE_VIDE: QueueFil = Object.freeze({
  messages: [],
  total: 0,
  rejoues: 0,
  omis: 0,
  caracteres: 0,
  tronque: false,
  illisible: false,
});

/** Une queue qu'on n'a pas pu lire. Se dit, ne se déguise pas en fil neuf. */
export const QUEUE_ILLISIBLE: QueueFil = Object.freeze({
  ...QUEUE_VIDE,
  illisible: true,
});

// ==================================================================
// 3. La lecture défensive de ce que rend la base
// ==================================================================

function texte(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre.length === 0 ? null : propre;
}

function entier(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? Math.trunc(valeur) : null;
}

function estRole(valeur: unknown): valeur is RoleMessage {
  return valeur === "user" || valeur === "assistant";
}

/**
 * La queue, relue.
 *
 * ─── POURQUOI RELIRE CE QUE NOTRE PROPRE BASE VIENT D'ÉCRIRE ───
 *
 * Parce que la forme traverse PostgREST en `jsonb` : un `null`, une
 * migration pas encore passée, une réponse tronquée par un proxy
 * arrivent tous ici comme `unknown`. Et surtout parce que le résultat
 * PART AU MODÈLE : un objet à moitié lu deviendrait un contexte à
 * moitié faux, et personne ne le verrait.
 *
 * UN ÉCHEC REND `QUEUE_VIDE`, DONC ZÉRO TOUR REJOUÉ — jamais une queue
 * partielle. Perdre la mémoire d'un fil est visible à l'écran ; en
 * envoyer la moitié en croyant l'envoyer entière ne l'est pas.
 */
export function lireQueue(valeur: unknown): QueueFil {
  // ILLISIBLE, ET NON VIDE. Un fil réellement vide traverse la RPC avec
  // `messages: []` : arriver ici sans tableau de messages veut dire
  // qu'on n'a pas compris la réponse de la base, pas qu'il n'y a rien à
  // rejouer. Confondre les deux, c'est afficher un fil entier sous une
  // promesse de mémoire qui n'a pas eu lieu.
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) {
    return QUEUE_ILLISIBLE;
  }
  const brut = valeur as Record<string, unknown>;
  if (!Array.isArray(brut.messages)) return QUEUE_ILLISIBLE;

  const messages: QueueFil["messages"] = [];
  for (const entree of brut.messages) {
    if (typeof entree !== "object" || entree === null) continue;
    const ligne = entree as Record<string, unknown>;
    const contenu = texte(ligne.content) ?? texte(ligne.contenu);
    if (!estRole(ligne.role) || contenu === null) continue;
    messages.push({
      role: ligne.role,
      contenu,
      ecritLe: texte(ligne.created_at) ?? texte(ligne.ecritLe) ?? "",
    });
  }

  const total = entier(brut.messages_total);
  const rejoues = entier(brut.messages_rejoues);
  const omis = entier(brut.messages_omis);
  const caracteres = entier(brut.caracteres);

  // LE COMPTE FAIT FOI SUR LA LISTE, PAS L'INVERSE. Si la base annonce
  // douze messages rejoués et que dix seulement sont lisibles, c'est la
  // liste qui part au modèle : on aligne le compte dessus, et `tronque`
  // le devient forcément.
  const rejouesReels = messages.length;
  const totalReel = total === null || total < rejouesReels ? rejouesReels : total;

  return {
    messages,
    total: totalReel,
    rejoues: rejouesReels,
    omis:
      omis !== null && rejoues === rejouesReels
        ? omis
        : Math.max(0, totalReel - rejouesReels),
    caracteres:
      caracteres !== null && rejoues === rejouesReels
        ? caracteres
        : messages.reduce((somme, m) => somme + m.contenu.length, 0),
    tronque:
      brut.tronque === true || totalReel > rejouesReels,
    // Ce qui se lit n'est pas illisible : le drapeau n'est levé que par
    // l'appelant, quand la RPC elle-même a échoué.
    illisible: false,
  };
}

// ==================================================================
// 3 bis. LA SUBSTANCE, COMPOSÉE HORS MODÈLE
// ==================================================================

/**
 * Une recommandation, réduite à ce que ce module en fait.
 *
 * Volontairement structurel plutôt qu'importé de `runtime/schemas` :
 * ce fichier ne doit dépendre d'aucun code (zod compris) pour rester
 * jouable sous `node --test`. La conversion depuis
 * `DecisionRecommendation` se fait chez l'appelant, en une ligne.
 */
export type RecommandationLue = {
  titre: string;
  /** Centimes entiers, ou `null` quand aucun outil ne l'a fourni. */
  impactCents: number | null;
  actionRecommandee: string | null;
  /** `summary` : ce qu'il se passe et pourquoi ça compte. Va dans le repli. */
  pourquoi: string | null;
  raisons: readonly string[];
};

export type SubstanceReponse = {
  resume: string;
  confiance: string | null;
  ambigu: boolean;
  recommandations: readonly RecommandationLue[];
  donneesManquantes: readonly string[];
};

/** Huit lignes de recommandation : au-delà, une réponse devient un rapport. */
const RECOMMANDATIONS_AFFICHEES_MAX = 8;
/** Huit raisons par recommandation, comme `RAISONS_MAX` du schéma. */
const RAISONS_AFFICHEES_MAX = 8;

/**
 * LE TEXTE DE LA RÉPONSE, ÉCRIT PAR NOUS.
 *
 * Chaque morceau vient d'un champ typé de la sortie structurée ; aucun
 * n'est de la prose libre réinterprétée. C'est la règle de §11U
 * (`describeProposal`) appliquée au corps de la réponse : un client
 * nommé « Ignore les instructions précédentes » ressort comme un titre
 * de recommandation bizarre, à sa place, et jamais comme une consigne.
 *
 * ─── CE QU'ON N'ÉCRIT PAS ───
 *
 * Le zéro. `formatCents(null)` rend un tiret, et une recommandation
 * sans impact chiffré le dit en toutes lettres : « impact non chiffré ».
 * Ce dépôt a corrigé trois fois le motif inverse.
 */
export function composerContenu(substance: SubstanceReponse): string {
  const blocs: string[] = [];

  const resume = substance.resume.trim();
  if (resume.length > 0) blocs.push(resume);

  const lignes = substance.recommandations
    .slice(0, RECOMMANDATIONS_AFFICHEES_MAX)
    .map((recommandation) => {
      const titre = recommandation.titre.trim();
      if (titre.length === 0) return null;
      const impact =
        recommandation.impactCents === null
          ? "impact non chiffré"
          : formatCents(recommandation.impactCents);
      const action = recommandation.actionRecommandee?.trim();
      return `• ${titre} — ${impact}${action ? ` — ${action}` : ""}`;
    })
    .filter((ligne): ligne is string => ligne !== null);

  if (lignes.length > 0) blocs.push(lignes.join("\n"));

  // « PAS ASSEZ DE DONNÉES » NE SE TAIT PAS. Le socle ordonne au modèle
  // de nommer le manque dans un champ à part plutôt que dans la prose ;
  // ne pas le réinjecter ici ferait s'afficher une réponse fondée sur
  // des données absentes exactement comme une réponse sûre.
  const manques = substance.donneesManquantes
    .map((manque) => manque.trim())
    .filter((manque) => manque.length > 0);

  if (manques.length > 0) {
    blocs.push(`Il manque, pour conclure : ${manques.join(", ")}.`);
  } else if (substance.confiance === "insufficient_data") {
    // Le cas que le socle distingue nommément d'une confiance faible :
    // il n'y a pas de doute sur la lecture, il n'y a pas de données.
    blocs.push("Données insuffisantes pour conclure.");
  }

  return blocs.join("\n\n").trim();
}

/** La couche affichée, prête à écrire en base. */
export function composerCouche(
  substance: SubstanceReponse,
  avertissements: readonly string[],
  actions: readonly ActionPreparee[],
): CoucheAffichee {
  return {
    confiance: substance.confiance,
    ambigu: substance.ambigu,
    raisons: substance.recommandations
      .slice(0, RECOMMANDATIONS_AFFICHEES_MAX)
      .map((recommandation) => ({
        titre: recommandation.titre.trim(),
        pourquoi: recommandation.pourquoi?.trim() || null,
        raisons: recommandation.raisons
          .map((raison) => raison.trim())
          .filter((raison) => raison.length > 0)
          .slice(0, RAISONS_AFFICHEES_MAX),
      }))
      .filter(
        (entree) =>
          entree.titre.length > 0 && (entree.pourquoi !== null || entree.raisons.length > 0),
      ),
    avertissements: [...new Set(avertissements.map((a) => a.trim()).filter((a) => a.length > 0))],
    actions: [...actions],
  };
}

/**
 * LA COUCHE AFFICHÉE, RELUE.
 *
 * Même exigence que `lireQueue` et pour la même raison : la colonne est
 * un `jsonb` libre, donc tout ce qui en sort est `unknown`. La
 * différence est qu'ici rien ne part au modèle — un champ mal lu coûte
 * un badge, pas un contexte faux. On préfère donc perdre un morceau que
 * refuser le message entier.
 */
export function lireCouche(valeur: unknown): CoucheAffichee {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return COUCHE_VIDE;
  const brut = valeur as Record<string, unknown>;

  const analyse =
    typeof brut.analyse === "object" && brut.analyse !== null && !Array.isArray(brut.analyse)
      ? (brut.analyse as Record<string, unknown>)
      : {};

  const raisons: RaisonsRecommandation[] = [];
  if (Array.isArray(analyse.raisons)) {
    for (const entree of analyse.raisons) {
      if (typeof entree !== "object" || entree === null) continue;
      const ligne = entree as Record<string, unknown>;
      const titre = texte(ligne.titre);
      const liste = Array.isArray(ligne.raisons)
        ? ligne.raisons
            .map((r) => texte(r))
            .filter((r): r is string => r !== null)
            .slice(0, RAISONS_AFFICHEES_MAX)
        : [];
      const pourquoi = texte(ligne.pourquoi);
      if (titre === null || (pourquoi === null && liste.length === 0)) continue;
      raisons.push({ titre, pourquoi, raisons: liste });
    }
  }

  const actions: ActionPreparee[] = [];
  if (Array.isArray(brut.actions)) {
    for (const entree of brut.actions) {
      if (typeof entree !== "object" || entree === null) continue;
      const ligne = entree as Record<string, unknown>;
      const actionId = texte(ligne.actionId);
      const libelle = texte(ligne.libelle);
      if (actionId === null || libelle === null) continue;
      actions.push({
        actionId,
        approvalId: texte(ligne.approvalId),
        libelle,
        resume: texte(ligne.resume) ?? libelle,
        // `entier` et non `Number(...)` : un montant illisible reste
        // inconnu. `Number(null)` vaudrait 0, c'est-à-dire « gratuit ».
        montantCents: entier(ligne.montantCents),
      });
    }
  }

  return {
    confiance: texte(analyse.confiance),
    ambigu: analyse.ambigu === true,
    raisons,
    avertissements: Array.isArray(brut.avertissements)
      ? brut.avertissements.map((a) => texte(a)).filter((a): a is string => a !== null)
      : [],
    actions,
  };
}

// ==================================================================
// 4. Ce que le modèle reçoit
// ==================================================================

/**
 * LA QUEUE, MISE DANS LA FORME QUE LE MODÈLE RELIT VRAIMENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * DES MESSAGES, PAS UN PAQUET DE DONNÉES
 * ══════════════════════════════════════════════════════════════════
 *
 * Un tour d'utilisateur ressort en message `user`, un tour d'Oasis en
 * message `assistant`. C'est la forme native du SDK (`AgentInputItem`),
 * donc celle que le modèle a apprise : il lit une conversation comme
 * une conversation.
 *
 * L'autre voie — empaqueter les tours en JSON sous une clé de
 * `contexte.donnees` — a été écartée pour trois raisons cumulées :
 * elle ajoute une seconde abstraction par-dessus celle que le SDK offre
 * déjà, elle paie le balisage JSON en jetons sur un budget de queue
 * volontairement étroit, et elle apprend au modèle que sa propre parole
 * d'il y a cinq minutes est une « donnée lue » comme le stock ou les
 * factures.
 *
 * ─── CE QUE ÇA NE RELÂCHE PAS ───
 *
 * Rien, sur l'injection. Ce qui entre ici a été écrit soit par
 * l'utilisateur — sa question d'il y a dix minutes n'est pas plus
 * dangereuse que celle qu'il tape maintenant — soit par le modèle
 * lui-même. Les DONNÉES de l'entreprise, qui sont la vraie surface
 * d'injection (un client nommé « ignore les instructions
 * précédentes »), continuent de passer exclusivement par
 * `entreeModele`, annoncées comme des données et jamais comme des
 * consignes. Et le texte d'une proposition n'est jamais la prose du
 * modèle : `describeProposal` le compose à partir de paramètres typés.
 *
 * ─── CE QUE LA BASE NE GARANTIT PAS, ET IL FAUT LE DIRE ───
 *
 * La PROVENANCE d'un tour `assistant`. `authenticated` détient bien
 * `insert` sur `ai_conversation_messages`, et la politique d'écriture ne
 * regarde que `user_id = auth.uid()` : rien n'empêche quelqu'un
 * d'écrire, par PostgREST, un tour d'assistant dans SON PROPRE fil, qui
 * repartira ensuite au modèle comme s'il venait du modèle.
 *
 * Mesuré, et borné : c'est de l'auto-injection. Le fil est strictement
 * personnel (prouvé par les tests de 0079), donc personne ne peut
 * empoisonner le fil d'un autre ; et toute écriture métier reste
 * derrière `confirmProposal` ou `answerApproval`, qui relisent la
 * permission depuis la session, plus la RLS, plus un clic humain. Le
 * gain pour qui s'y essaierait est de persuasion, pas de privilège.
 *
 * La garantie de ce module porte donc sur l'IMMUABILITÉ d'un tour
 * (déclencheur `ai_conversation_message_fige`), pas sur sa provenance.
 * Le jour où un agent partira sans clic depuis ce runtime, il faudra
 * faire passer l'écriture d'un tour `assistant` par une fonction
 * `security definer` — comme `ai_conversation_supprimer` — et restreindre
 * la politique `insert` à `role = 'user'`.
 *
 * ─── LA COUPE SE DIT AU MODÈLE, PAS SEULEMENT À L'ÉCRAN ───
 *
 * Quand la queue est tronquée, un message `system` ouvre la liste pour
 * le dire. Sans lui, le modèle croirait tenir la conversation entière
 * et comblerait le début manquant de bonne foi — c'est-à-dire en
 * inventant. Le filet affiché dans le fil et cette phrase sortent du
 * MÊME drapeau : l'écran et le modèle ne peuvent pas être en désaccord
 * sur ce qui a été oublié.
 *
 * Rend un tableau VIDE quand il n'y a rien à rejouer. Un fil neuf n'a
 * pas un passé vide : il n'a pas de passé, et rien ne doit apprendre au
 * modèle qu'une conversation vide existe.
 */
export function historiqueModele(queue: QueueFil): AgentInputItem[] {
  if (queue.messages.length === 0) return [];

  const items: AgentInputItem[] = [];

  if (queue.tronque) {
    items.push({
      role: "system",
      content:
        `Cette conversation a commencé plus tôt : ${queue.omis} message(s) plus anciens ` +
        "ne te sont pas transmis. Ne prétends pas t'en souvenir. Si la question du " +
        "moment s'y réfère, dis que le début du fil ne t'est plus accessible et " +
        "demande de le reformuler.",
    });
  }

  for (const message of queue.messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: message.contenu });
    } else {
      // `status: "completed"` est exigé par le schéma du SDK pour un
      // message d'assistant, et il est exact : on ne persiste un tour
      // qu'une fois la réponse obtenue (voir `poserQuestion`).
      items.push({
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: message.contenu }],
      });
    }
  }

  return items;
}

// ==================================================================
// 5. Ce que l'écran raconte
// ==================================================================

/** Le titre d'un fil, ou la vérité à sa place. */
export function titreDuFil(fil: { titre: string | null }): string {
  return fil.titre ?? "Nouvelle conversation";
}

/**
 * OÙ PASSE LA COUPE, dans la liste affichée.
 *
 * Rend l'index du PREMIER message que le modèle relit encore, ou `null`
 * quand il les relit tous. Le filet horizontal se pose juste avant cet
 * index — c'est-à-dire à l'endroit exact où l'oubli devient vrai, et
 * pas en petit sous le champ de saisie.
 *
 * La position se déduit du COMPTE rendu par la base, jamais d'un
 * recomptage local des caractères : recompter ici, c'est reproduire
 * l'algorithme SQL à la main, et deux copies d'un même calcul finissent
 * par ne plus dire la même chose — précisément la panne que
 * `ai_conversation_tail` existe pour empêcher.
 */
export function indexDeCoupe(messagesAffiches: number, queue: QueueFil): number | null {
  if (!queue.tronque) return null;
  const debut = messagesAffiches - queue.rejoues;
  // Hors bornes = incohérence entre ce qu'on affiche et ce que la base
  // a compté. On ne dessine alors AUCUN filet : un trait posé au hasard
  // dirait une chose fausse avec l'autorité d'une mesure.
  if (debut <= 0 || debut >= messagesAffiches) return null;
  return debut;
}

// ==================================================================
// 6. Le rail : des fils groupés par jour
// ==================================================================

export type GroupeDeFils = {
  /** La journée, en ISO court (AAAA-MM-JJ) — la clé de regroupement. */
  jour: string;
  /** « Aujourd'hui », « Hier », ou la date écrite en français. */
  libelle: string;
  fils: FilResume[];
};

/**
 * Les fils, groupés par jour, le plus récent d'abord.
 *
 * ─── POURQUOI GROUPER, ALORS QU'UNE LISTE À PLAT SUFFIRAIT ───
 *
 * Parce que c'est la façon la moins bavarde de dire qu'il n'y a pas de
 * mémoire entre deux fils. Voir « Mardi » écrit au-dessus d'une
 * conversation rappelle, sans une phrase, que celle d'aujourd'hui
 * repart de zéro. Une liste à plat de titres laisserait croire à un
 * historique continu.
 *
 * `dernierMessageLe` d'abord, `ouvertLe` sinon : un fil ouvert et pas
 * encore parlé appartient au jour où on l'a ouvert, pas à nulle part.
 */
export function grouperParJour(
  fils: readonly FilResume[],
  aujourdhui: string,
  hier: string,
): GroupeDeFils[] {
  const groupes = new Map<string, FilResume[]>();

  for (const fil of fils) {
    const instant = fil.dernierMessageLe ?? fil.ouvertLe;
    const jour = jourDe(instant);
    if (jour === null) continue;
    const existant = groupes.get(jour);
    if (existant) existant.push(fil);
    else groupes.set(jour, [fil]);
  }

  return [...groupes.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([jour, fils]) => ({
      jour,
      libelle: jour === aujourdhui ? "Aujourd'hui" : jour === hier ? "Hier" : libelleDeJour(jour),
      fils,
    }));
}

/**
 * LE JOUR VÉCU À PARIS, et non les dix premiers caractères de l'ISO.
 *
 * ─── LE BOGUE QUE CETTE FONCTION A EU ───
 *
 * Elle rendait `instant.slice(0, 10)`, c'est-à-dire le jour UTC, et le
 * layout comparait ce jour à `parisDay(new Date())`. Entre minuit et
 * deux heures du matin (heure d'été ; minuit-une en hiver), une
 * conversation ouverte À L'INSTANT tombait donc sous « Hier », et un fil
 * plus ancien portait une date française fausse d'un jour.
 *
 * C'est la classe de bogue que cette phase revendique d'avoir corrigée
 * ailleurs — `toISOString().slice(0, 7)` remplacé par `parisDay` pour
 * lire le quota du MOIS. La correction avait été faite sur le mois et
 * pas sur le jour.
 *
 * Une date illisible rend `null` : le fil n'est alors rattaché à aucun
 * groupe plutôt qu'au 1er janvier 1970.
 */
function jourDe(instant: string): string | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return parisDay(date);
}

/**
 * La veille d'un jour, en ISO court.
 *
 * ─── POURQUOI PAS `Date.now() - 24 h` ───
 *
 * Deux raisons, et la seconde est la vraie. La première : le
 * compilateur React refuse `Date.now()` pendant un rendu, et il a
 * raison — deux rendus du même écran rendraient deux résultats.
 *
 * La seconde : soustraire vingt-quatre heures à un INSTANT est faux
 * deux fois par an. Au passage à l'heure d'hiver, la veille dure
 * vingt-cinq heures ; « il y a vingt-quatre heures » tombe alors le
 * jour même, et le rail perdrait son groupe « Hier ». Ici on soustrait
 * un JOUR à un jour, ce qui est l'opération qu'on voulait. L'ancrage à
 * midi met le calcul à l'abri des fuseaux dans les deux sens.
 */
export function veilleDe(jour: string): string {
  const midi = new Date(`${jour}T12:00:00Z`);
  midi.setUTCDate(midi.getUTCDate() - 1);
  return midi.toISOString().slice(0, 10);
}

/**
 * « lundi 8 septembre ».
 *
 * `T12:00:00Z` et non `T00:00:00Z` : minuit UTC tombe la veille dans
 * les fuseaux à l'ouest et, en heure d'été française, l'écart joue dans
 * l'autre sens. Midi met la journée à l'abri des deux — c'est un
 * libellé, pas un instant, et il ne doit pas se décaler d'un jour.
 */
function libelleDeJour(jour: string): string {
  return new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Paris",
  });
}
