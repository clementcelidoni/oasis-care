import type { OutilOasis } from "../tools.ts";

/**
 * §11Z — L'AGENT « CLASSEMENT » N'A AUCUN OUTIL, ET N'EN AURA PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE ALORS QU'IL NE DÉCLARE RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce qu'un dossier `outils/` où neuf agents ont un fichier et où le
 * dixième n'en a pas se lit « on a oublié ». Le suivant l'écrira, de
 * bonne foi, en une demi-heure — et il aura fabriqué le défaut que tout
 * ce chantier a évité.
 *
 * C'est le même mécanisme que `OUTILS_SPEC_SANS_SERVICE` dans
 * `tools.ts` : ce dépôt traite déjà « on pourrait s'attendre à quelque
 * chose ici, et il n'y a rien » en le NOMMANT, avec le motif, à côté de
 * ce qui existe. On ne réinvente pas une seconde manière de se taire.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'UN OUTIL LUI COÛTERAIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Le registre distribue les outils par le champ `agent`
 * (`outilsPourAgent`). Un outil dont `agent` vaudrait `classification`
 * ne serait offert à aucun des treize répondeurs — il ne servirait donc
 * qu'à un quatorzième, qu'il faudrait rendre appelable. Et un agent
 * appelable est un agent qui répond : il aurait à dire quelque chose
 * sur une question métier, alors que son unique travail est de désigner
 * celui qui doit répondre. Il deviendrait une quatorzième source de
 * vérité posée par-dessus les treize autres.
 *
 * L'étape n'en a pas besoin, et c'est vérifiable plutôt que
 * rassurant : ses deux lieux d'exécution ne lisent AUCUNE table métier.
 *
 *   • `app/api/oasis-ai/aiguillage.ts` compare des mots-clés à une
 *     chaîne de caractères. Aucun port, aucun appel, aucun coût.
 *   • `lib/ai/runtime/preprocessing.ts` reçoit les éléments à classer
 *     de son APPELANT ; il ne va pas les chercher, et sa règle
 *     déterministe écarte du modèle tout élément dont le type est déjà
 *     renseigné.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET LA MIGRATION 0088 NE LUI ÉCRIT AUCUNE FONCTION NON PLUS
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle ouvre son NOM dans `ai_is_supported_agent` — ce qui rend sa
 * dépense plafonnable et son modèle épinglable dans
 * `ai_model_overrides`, alors que le routeur le facturait déjà en
 * « economy » pendant que la base refusait son nom — et elle s'arrête
 * là. Trois fonctions pour quatre agents, et c'est écrit dans son
 * en-tête.
 */

/**
 * LA LISTE, ET ELLE EST VIDE.
 *
 * Typée `readonly OutilOasis[]` plutôt que `never[]` : l'intégration
 * peut l'étaler dans `OUTILS_LECTURE` sans conditionner, et le jour
 * — s'il vient — où l'étape gagnerait un outil, le type est déjà juste.
 * Ce qui protège n'est pas le type, c'est le test voisin : il exige que
 * le registre ne contienne JAMAIS d'outil appartenant à
 * « classification ».
 */
export const OUTILS_CLASSIFICATION: readonly OutilOasis[] = Object.freeze([]);

/**
 * CE QU'ON SERAIT TENTÉ D'ÉCRIRE, ET POURQUOI IL NE FAUT PAS.
 *
 * Trois idées qui viennent naturellement, et qui sont toutes les trois
 * de mauvaises idées pour une raison différente. Les écrire ici coûte
 * dix lignes et fait gagner la demi-heure pendant laquelle quelqu'un
 * les aurait redécouvertes — puis implémentées.
 */
export const OUTILS_REFUSES: Readonly<Record<string, string>> = Object.freeze({
  classifyBatch:
    "Le classement en lots est DÉJÀ écrit et testé — ServicePreTraitement, " +
    "lib/ai/runtime/preprocessing.ts : découpe en lots, budget de caractères dérivé du seuil " +
    "du routeur, règles déterministes avant le modèle, double filtre anti-hallucination. Un " +
    "outil qui le rappellerait depuis un agent ferait passer par un modèle une étape dont " +
    "tout l'intérêt est de ne pas en appeler.",
  listUnclassifiedActivities:
    "Il rendrait une liste vide, et une liste vide se lit « tout est classé ». La vérité " +
    "mesurée est que crm_activities compte zéro ligne : personne n'a rien saisi. Et la nature " +
    "d'une activité est de toute façon posée à la saisie par un menu déroulant sous " +
    "contrainte fermée — il n'y a rien à classer après coup.",
  routeQuestion:
    "L'aiguillage ne doit RIEN coûter : c'est la règle « outils déterministes avant IA » " +
    "appliquée à l'aiguillage lui-même. En faire un outil, c'est le rendre appelable par un " +
    "modèle, donc payer un raisonnement pour choisir à qui parler, avant même de commencer à " +
    "répondre. `aiguiller()` est une fonction synchrone sans le moindre port, et c'est ce " +
    "qu'elle doit rester.",
});
