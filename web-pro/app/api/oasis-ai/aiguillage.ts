import { DEFINITIONS, type AgentConstruit, type DefinitionAgent } from "@/lib/ai/runtime";
import type { CleAgentModele, ComplexiteTache } from "@/lib/ai/model";
// L'ÉTAPE DE CLASSEMENT POSSÈDE LA QUALITÉ DE L'AIGUILLAGE, pas
// l'aiguilleur lui-même : c'est elle qui déclare quelles apostrophes
// circulent réellement, et c'est elle qui sait reconnaître un mot-clé
// qui en vole un autre (`anomaliesDAiguillage`, exercée par le test).
// Voir `lib/ai/runtime/agents/classification.ts`.
import { APOSTROPHES } from "@/lib/ai/runtime/agents/classification";

/**
 * §11V, §11Y — À QUEL AGENT UNE QUESTION S'ADRESSE.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUN MODÈLE N'EST APPELÉ POUR CHOISIR L'AGENT
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la règle « outils déterministes avant IA » (p. 11-12) appliquée
 * à l'aiguillage lui-même. Un aiguilleur de langage naturel coûterait
 * un appel de modèle SUR CHAQUE QUESTION, avant même de commencer à
 * répondre — donc une ligne au journal, une dépense au budget, et une
 * latence, pour une décision que quinze mots-clés tranchent presque
 * toujours.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE PASSE QUAND LES MOTS-CLÉS NE TRANCHENT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * On envoie à la DIRECTION, qui est le seul agent capable d'interroger
 * les autres : une question qu'on n'a pas comprise ne doit pas être
 * confiée à un spécialiste qui n'aura pas les bonnes sources et
 * répondra « je ne vois rien » avec assurance.
 *
 * MAIS on l'envoie avec `complexity: "simple"`, ce qui DÉCALE la
 * Direction d'un cran vers le bas — `advanced` devient `standard`
 * (`router.ts`). Le raisonnement : on ne paie pas le modèle le plus
 * cher pour découvrir ce qu'on nous demande. Et si la question était
 * réellement difficile, l'escalade s'en charge — `escalation.ts` monte
 * sur ambiguïté déclarée, risque élevé ou impact ≥ 5 000 €. On paie
 * donc cher quand on sait que c'est cher, jamais par précaution.
 *
 * Sans ce décalage, toute question mal formulée partirait sur le modèle
 * avancé, et le ratio visé par la page 17 — « ~5 % Sol » — serait faux
 * dès la première semaine.
 */

/** Le résultat de l'aiguillage. */
export type Aiguillage = {
  agent: AgentConstruit;
  /** `undefined` = laisser le routeur appliquer le niveau configuré de l'agent. */
  complexite: ComplexiteTache | undefined;
  /** Ce qui a décidé, en français, pour la trace et pour l'écran. */
  raison: string;
};

type Regle = {
  agent: AgentConstruit;
  /** Les mots qui désignent cet agent SANS ambiguïté. */
  motsCles: readonly string[];
};

/**
 * L'ORDRE DANS LEQUEL LES AGENTS SONT ESSAYÉS — ET RIEN D'AUTRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES MOTS-CLÉS NE SONT PLUS ÉCRITS ICI. C'EST §11Y
 * ══════════════════════════════════════════════════════════════════
 *
 * Ils vivent dans le fichier de chaque agent (`runtime/agents/*.ts`),
 * et cette liste ne dit plus que l'ORDRE. La raison est la même que
 * celle qui a fait éclater `definitions.ts` : dix agents qui ajoutent
 * chacun sa règle au même tableau, ce sont dix conflits sur le même
 * tableau, et celui qui fusionne en dernier arbitre sans le savoir.
 *
 * L'ordre, lui, reste ICI parce qu'il n'appartient à AUCUN agent : il
 * est un arbitrage ENTRE eux, et aucun ne peut le décider seul. C'est
 * précisément la question « qui gagne quand deux mots tombent dans la
 * même phrase », et elle se tranche à un seul endroit.
 *
 * ─── CE QUE L'ORDRE DÉCIDE, CONCRÈTEMENT ───
 *
 * « facturer un devis signé » contient « factur » et « devis » : la
 * facturation gagne, et c'est bien elle qu'on interroge. « facture en
 * retard » ne doit jamais partir aux Chantiers sous prétexte que le
 * mot « retard » y ressemble — d'où la facturation en tête, et d'où
 * l'interdiction, dans les fichiers d'agents, d'y écrire un mot nu
 * comme « retard ».
 *
 * La Direction reste EN DERNIER : ses mots sont les plus généraux du
 * lot (« la situation », « aujourd'hui »), et ils ne doivent gagner
 * contre aucun mot précis.
 *
 * ─── LES GABARITS N'ONT PAS DE MOTS, ET C'EST VOULU ───
 *
 * Un gabarit — les Achats, aujourd'hui — n'a pas de `motsCles` :
 * `reglesActives()` ne produit aucune règle pour lui et une question
 * libre ne l'atteint jamais. On ne fait pas répondre un agent avant
 * qu'il ait quelque chose à dire. Le jour où l'un d'eux est fini, son
 * auteur écrit ses mots dans SON fichier, et l'aiguillage s'allume sans
 * que personne touche à celui-ci.
 *
 * ─── §11Z : L'ORDRE PASSE DE DIX À TREIZE, ET IL PRÉCÈDE LES FICHIERS ───
 *
 * Trois agents s'y ajoutent — `sales`, `market`, `risk` — et leur place
 * est écrite ICI AVANT que leurs fichiers soient composés dans
 * `DEFINITIONS`. Ce n'est pas une anticipation gratuite : la place est
 * la seule chose qu'un agent ne peut pas décider chez lui, et deux
 * chantiers qui écrivent des agents en parallèle ne peuvent pas se
 * partager cette ligne-là. `reglesActives()` saute donc un agent que
 * `DEFINITIONS` ne connaît pas encore, et `EN_ATTENTE_INTEGRATION`
 * borne cette tolérance pour qu'une faute de frappe ne s'y cache pas.
 *
 * L'ORDRE COMPLET, ET CE QUE CHAQUE POSITION TRANCHE :
 *
 *   1. billing      — « factur » gagne sur tout le reste de l'argent dû
 *   2. sales        — la fenêtre REFERMÉE du devis (voir ci-dessous)
 *   3. quotePricing — « devis » nu, le montant, la relance de devis
 *   4. finance      — l'argent agrégé, remontée en §11Y (voir ci-dessous)
 *   5-8. procurement, nursery, fleet, planning
 *   9. operations   — « chantier », son nom commun
 *   10-11. market, risk — avant les Clients (voir ci-dessous)
 *   12. customer    — « client », le mot le plus large des métiers
 *   13. executive   — la plus générale de toutes, donc la dernière
 */
export const ORDRE: readonly CleAgentModele[] = Object.freeze([
  // Les précis d'abord, du plus spécifique au plus général.
  "billing",

  // ─── LES VENTES S'INTERCALENT ICI, ET LA PLACE EST LE SUJET ───
  //
  // APRÈS la Facturation, AVANT le Chiffrage. Les deux bornes ont été
  // éprouvées en exécutant le vrai `aiguiller()`, pas déduites.
  //
  // POURQUOI APRÈS LA FACTURATION. « factur » est essayé en premier, et
  // c'est ce qui garde « relancer cette facture », « relance de
  // facture » et « facturer les devis signés » à la Facturation. Les
  // Ventes portent « relance commerciale » et « devis signe » : sans
  // cette antériorité, le mot le plus long gagnerait et une relance de
  // FACTURE partirait au commerce, qui ne connaît aucun euro.
  //
  // POURQUOI AVANT LE CHIFFRAGE. Le Chiffrage porte « devis », le mot
  // le plus général du domaine commercial. Placées après lui, les
  // Ventes ne seraient jamais atteintes : « combien de devis signés
  // cette année ? » et « pourquoi ce devis a-t-il été refusé ? »
  // contiennent toutes deux « devis ». Placées avant, elles prennent
  // les deux locutions qui leur appartiennent — la fenêtre REFERMÉE —
  // et laissent « devis » nu au Chiffrage, qui possède le montant et
  // l'action « relancer un devis » (`quoteFollowUp`, catalogue 0072).
  //
  // Aucun mot des Ventes n'apparaît dans les questions de chiffrage
  // rejouées par le test : « ce devis est-il bien chiffré », « quel
  // taux de marque », « suis-je sous-tarifé ». Vérifié, pas espéré.
  "sales",

  "quotePricing",

  // ─── LA FINANCE EST REMONTÉE ICI, ET C'EST UNE CORRECTION ───
  //
  // Elle fermait la marche juste avant la Direction, ce qui allait de
  // soi tant que six des dix agents étaient muets. Dès que les
  // Chantiers, la Pépinière et le Matériel ont reçu leurs mots, l'ordre
  // s'est retourné contre lui-même : « quelle rentabilité sur ce
  // chantier ? » partait aux Chantiers sur le mot « chantier », et
  // « mes dépenses de pépinière » à la Pépinière sur le mot
  // « pépinière ». Mesuré en exécutant le vrai `aiguiller()`, pas
  // déduit.
  //
  // LE CRITÈRE N'EST PAS « QUI EST LE PLUS PRÉCIS » MAIS « QUI A LA
  // SOURCE ». Aucun autre agent n'agrège d'argent : les Chantiers
  // portent une limite qui dit « ni marge ni budget, ils appartiennent
  // à la Finance », la Pépinière une autre qui dit « ne connaît aucun
  // prix d'achat », le Matériel une troisième qui refuse tout coût
  // d'usage. Les laisser gagner sur un mot d'argent, c'est remplacer un
  // agent qui répond par un agent qui décline poliment — et faire payer
  // l'appel de modèle pour ce refus.
  //
  // Et « la marge du chantier Dupont » a bien une réponse côté Finance :
  // `analyzeProjectMargin`, un outil par chantier qu'elle est seule à
  // posséder. Ce n'était donc pas un arbitrage entre deux bonnes
  // réponses, c'était le choix de la mauvaise.
  //
  // La Facturation et le Chiffrage restent AVANT elle : « facture »,
  // « impayé » et « devis » sont plus précis que « marge », et leurs
  // agents ont, eux aussi, la source correspondante.
  "finance",

  "procurement",
  "nursery",
  "fleet",
  "planning",
  "operations",

  // ─── L'HISTORIQUE INTERNE ET LES RISQUES, AVANT LES CLIENTS ───
  //
  // Les deux agents sont écrits par l'AUTRE chantier de §11Z ; leur
  // place, elle, se décide ici, parce qu'une place est un arbitrage
  // entre agents et qu'aucun ne peut la prendre seul.
  //
  // LA RAISON EST LA MÊME POUR LES DEUX, ET ELLE EST MESURÉE. L'agent
  // Clients porte le mot « client », et il s'interdit par une limite
  // explicite toute phrase de PORTEFEUILLE — « concentration,
  // moyenne, classement ». Placés après lui, « d'où viennent mes
  // clients ? » et « suis-je trop dépendant d'un client ? » lui
  // reviendraient, et il les déclinerait poliment APRÈS avoir fait
  // payer un appel de modèle. C'est exactement le défaut que l'en-tête
  // de ce fichier décrit à propos de la Finance : remplacer un agent
  // qui répond par un agent qui décline.
  //
  // Et ils restent APRÈS la Facturation, la Finance et les Chantiers :
  // « risque d'impayé » appartient à la Facturation, « risque de dérive
  // de marge » à la Finance, « chantiers qui risquent de déraper » aux
  // Chantiers. Chacun de ces trois a la source ; les Risques n'ont que
  // le mot.
  "market",
  "risk",

  "customer",
  // La Direction ferme la marche : voir l'en-tête.
  "executive",
]);

/**
 * LES AGENTS QUE L'ORDRE NOMME ET QUE `DEFINITIONS` NE CONNAÎT PAS
 * ENCORE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI ÉCRIRE UNE PLACE POUR UN FICHIER QUI N'EST PAS LÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce que la place est la seule chose qu'un agent ne peut PAS décider
 * chez lui. `market` et `risk` sont écrits en parallèle par un autre
 * constructeur, dans leurs propres fichiers ; s'ils devaient aussi
 * s'insérer eux-mêmes dans cette liste, les deux chantiers se
 * croiseraient sur la seule ligne qu'ils ne peuvent pas se partager.
 * L'arbitrage est donc pris ici, une fois, et documenté ci-dessus.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET POURQUOI CETTE LISTE PLUTÔT QU'UN SIMPLE `if (undefined) continue`
 * ══════════════════════════════════════════════════════════════════
 *
 * Un saut silencieux serait indistinguable d'une faute de frappe. Un
 * agent mal orthographié dans l'ORDRE disparaîtrait de l'aiguillage
 * sans que rien ne le dise, et sa question partirait à la Direction —
 * la panne rassurante, celle qui ne casse rien.
 *
 * En NOMMANT les absences attendues, le test peut exiger que tout ce
 * que l'ORDRE contient soit connu de `DEFINITIONS` OU inscrit ici. La
 * tolérance est bornée, datée et courte. Le jour où l'intégration verse
 * `market.ts` et `risk.ts`, leurs mots-clés s'allument tout seuls et
 * ces deux entrées disparaissent d'ici — c'est le geste qui referme la
 * tolérance.
 */
export const EN_ATTENTE_INTEGRATION: readonly CleAgentModele[] = Object.freeze([
  // ══════════════════════════════════════════════════════════════════
  // §11Z, INTÉGRATION — LA LISTE EST VIDE, ET C'EST LE GESTE QUI
  // REFERME LA TOLÉRANCE
  // ══════════════════════════════════════════════════════════════════
  //
  // Elle a porté `sales`, `market` et `risk` le temps que leurs
  // fichiers soient écrits par deux chantiers parallèles pendant que
  // leur place, elle, se décidait ici. Les trois sont composés dans
  // `DEFINITIONS` : leurs mots-clés sont actifs, et les trois entrées
  // sont retirées.
  //
  // TANT QU'ELLE EST VIDE, LE TEST EST À SON PLUS STRICT : tout nom de
  // l'ORDRE doit être connu de `DEFINITIONS`, sans exception. Une faute
  // de frappe y est donc attrapée immédiatement, au lieu de faire
  // disparaître un agent en silence et d'envoyer ses questions à la
  // Direction.
  //
  // Le mécanisme reste écrit pour le prochain agent dont la place se
  // décidera avant que son fichier n'existe. C'est le seul usage
  // légitime de cette liste, et il est court par construction.
]);

/**
 * D'où sortent les mots-clés.
 *
 * `Partial` et non `Record` complet : l'ORDRE nomme des agents dont le
 * fichier n'est pas encore composé (voir `EN_ATTENTE_INTEGRATION`), et
 * un type qui prétendrait les avoir tous mentirait sur l'état réel du
 * dépôt — c'est-à-dire à l'endroit exact où le mensonge coûte un
 * `undefined` en production.
 */
export type CatalogueDefinitions = Partial<Record<CleAgentModele, DefinitionAgent>>;

/**
 * Les règles réellement actives, construites depuis les définitions.
 *
 * Recalculée à chaque appel plutôt que mémorisée : `DEFINITIONS` est
 * figé au démarrage, le coût est celui de treize lectures de propriété,
 * et un cache ici ne servirait qu'à faire diverger les tests du produit.
 *
 * DEUX RAISONS DE SAUTER UN AGENT, ET ELLES NE SE CONFONDENT PAS :
 *
 *   • Son fichier existe et il n'a PAS de mots-clés — c'est un gabarit,
 *     on ne le fait pas répondre avant qu'il ait quelque chose à dire.
 *   • Son fichier n'est pas encore composé dans `DEFINITIONS` — sa
 *     place est réservée, il s'allumera à l'intégration. Le test exige
 *     que ce cas-là soit inscrit dans `EN_ATTENTE_INTEGRATION`, sans
 *     quoi une faute de frappe dans l'ORDRE ferait disparaître un agent
 *     en silence.
 */
export function reglesActives(catalogue: CatalogueDefinitions = DEFINITIONS): readonly Regle[] {
  const regles: Regle[] = [];
  for (const cle of ORDRE) {
    const definition = catalogue[cle];
    if (definition === undefined) continue;
    const mots = definition.motsCles;
    if (mots === undefined || mots.length === 0) continue;
    // Sous SA clé, pas sous celle de l'ORDRE : la même précaution que
    // `agents/index.ts`, pour la même raison — une ligne mal dupliquée
    // rangerait la Pépinière sous « fleet ».
    regles.push({ agent: definition.cle, motsCles: mots });
  }
  return regles;
}

/**
 * Normalisation : minuscules, accents retirés, APOSTROPHES REPLIÉES.
 *
 * Les accents sont retirés des DEUX côtés — de la question et des
 * mots-clés — sans quoi « trésorerie » tapé sans accent ne
 * correspondrait à rien. Les fichiers d'agents portent volontairement les
 * deux graphies là où l'usage hésite, mais la normalisation est ce qui
 * rend cela sûr plutôt qu'exhaustif.
 *
 * ══════════════════════════════════════════════════════════════════
 * §11Z — L'APOSTROPHE NE DÉCIDE PLUS, ET C'ÉTAIT UN VRAI DÉFAUT
 * ══════════════════════════════════════════════════════════════════
 *
 * Cette fonction retirait les diacritiques et laissait les apostrophes
 * intactes. Deux conséquences, la seconde bien pire que la première :
 *
 *   1. Un mot-clé écrit « d'où viennent mes clients » ne correspondait
 *      pas à « d ou viennent mes clients », et réciproquement. Deux
 *      agents contournaient déjà en déclarant les deux graphies — la
 *      Direction avec « aujourd'hui » ET « aujourd hui », la Finance
 *      avec « chiffre d'affaires » ET « chiffre d affaires ». Une
 *      duplication tenue à la main dans dix fichiers est une seconde
 *      vérité en attente.
 *
 *   2. L'APOSTROPHE TYPOGRAPHIQUE (U+2019) — celle que les téléphones
 *      et les traitements de texte substituent automatiquement à la
 *      frappe — ne correspondait à AUCUNE des deux graphies. Une
 *      question tapée depuis un iPhone (« aujourd’hui ») manquait donc
 *      un mot-clé écrit avec l'apostrophe droite, et partait à la
 *      Direction. Une panne muette, dans le sens rassurant.
 *
 * Les deux formes sont désormais repliées sur une ESPACE, des deux
 * côtés. Une espace et non rien : les mots-clés existants sont écrits
 * avec l'espace (« aujourd hui », « chiffre d affaires »), et replier
 * sur rien les aurait tous cassés d'un coup.
 *
 * L'opération ne peut que rendre la correspondance PLUS large, jamais
 * plus étroite : elle s'applique symétriquement à la question et au
 * mot-clé. Les doubles graphies existantes deviennent redondantes, et
 * elles restent — les retirer serait toucher aux fichiers de deux
 * agents pour un gain nul.
 */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIQUES, "")
    .replace(APOSTROPHES, " ");
}

/**
 * Les diacritiques combinantes que `NFD` isole (U+0300 à U+036F).
 *
 * Écrites en points de code, et pas en classe littérale : la classe
 * littérale équivalente contient des caractères combinants nus, qui se
 * collent au crochet précédent dans tous les éditeurs et rendent la
 * ligne illisible — donc invérifiable à la relecture.
 */
const DIACRITIQUES = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  "g",
);

/**
 * L'agent à qui poser la question.
 *
 * `agentDemande` gagne toujours : quand l'écran sait de quoi il parle —
 * la page d'un devis, l'écran de facturation — il n'y a rien à deviner.
 *
 * ─── LE TROISIÈME PARAMÈTRE EST UN BANC D'ESSAI, PAS UNE OPTION ───
 *
 * Aucun appelant du produit ne le passe, et il ne faut pas commencer :
 * l'aiguillage doit avoir UNE seule table de mots-clés, celle des
 * fichiers d'agents. Il existe pour que le test puisse rejouer LE VRAI
 * comparateur sur un jeu de définitions qui contient un agent pas
 * encore composé dans `DEFINITIONS`.
 *
 * L'alternative aurait été que le test recopie la boucle de
 * correspondance pour l'exercer à côté. C'est le pire des deux : on
 * n'éprouverait plus l'aiguilleur, on éprouverait sa copie, et le jour
 * où l'une des deux change, c'est la copie qui reste verte.
 */
export function aiguiller(
  question: string,
  agentDemande?: AgentConstruit | null,
  catalogue: CatalogueDefinitions = DEFINITIONS,
): Aiguillage {
  if (agentDemande) {
    return {
      agent: agentDemande,
      complexite: undefined,
      raison: `Agent imposé par l'appelant : ${agentDemande}.`,
    };
  }

  const normalisee = normaliser(question);

  for (const regle of reglesActives(catalogue)) {
    for (const mot of regle.motsCles) {
      if (normalisee.includes(normaliser(mot))) {
        return {
          agent: regle.agent,
          complexite: undefined,
          raison: `Aiguillé vers « ${regle.agent} » sur le mot « ${mot} ».`,
        };
      }
    }
  }

  return {
    agent: "executive",
    // Voir l'en-tête : on ne paie pas le modèle le plus cher pour
    // découvrir ce qu'on nous demande. L'escalade montera si la
    // Direction déclare l'ambiguïté ou si l'enjeu est réel.
    complexite: "simple",
    raison:
      "Aucun mot-clé décisif : la question part à la Direction, d'un cran en dessous de son " +
      "niveau habituel. Elle escaladera si elle déclare la situation ambiguë.",
  };
}
