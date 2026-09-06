import type { DefinitionAgent } from "./types.ts";

/**
 * §11Z — RISQUES. CE QUI SE MESURE, CE QUI SE DÉDUIT, ET LA LIGNE
 * ENTRE LES DEUX.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI TIENT TOUT CET AGENT
 * ══════════════════════════════════════════════════════════════════
 *
 * « Trois factures dépassent leur échéance » se MESURE. « Ce client
 * paiera sans doute en retard » se DÉDUIT. Les deux phrases se
 * ressemblent, sortent de la même bouche, et n'ont pas la même valeur.
 * Un agent qui les mélange fait passer une intuition pour un relevé —
 * et le dirigeant appelle un client sur une intuition en croyant
 * appeler sur un relevé.
 *
 * L'agent étiquette donc CHAQUE affirmation, et la règle est portée à
 * trois endroits qui ne tombent pas ensemble :
 *
 *   • DANS LA DONNÉE : chacun des cinq blocs de `ai_risk_snapshot`
 *     porte `nature: 'mesure'`, et `regleDEtiquetage` rappelle, dans la
 *     réponse elle-même, que toute phrase qui ne sort pas d'un de ces
 *     champs est une déduction.
 *   • DANS L'OUTIL : la description que le modèle lit AVANT d'appeler.
 *   • DANS LES LIMITES ci-dessous, qui partent mot pour mot dans
 *     l'instruction.
 *
 * Trois fois n'est pas de la redondance ornementale : un réglage qui
 * cesserait un jour d'injecter les limites n'emporterait pas la règle
 * avec lui, parce qu'elle est aussi dans la donnée.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI IL EXISTE ALORS QU'UN CHANTIER PRÉCÉDENT L'AVAIT ÉCARTÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * `agents/sansDonnees.ts` l'écartait, et ses quatre motifs étaient
 * exacts : impayés déjà rendus ailleurs, dérive de marge sur un seul
 * point, concentration à cent pour cent par construction sur un client,
 * cascade de retards sans schéma. Le dirigeant a lu cet avis et a
 * demandé l'agent quand même. La décision est prise ; ce fichier
 * l'exécute, et il l'exécute en répondant à chacun des quatre motifs
 * plutôt qu'en les ignorant :
 *
 *   • LES IMPAYÉS NE SONT PAS RECALCULÉS. `ai_risk_snapshot` LIT la
 *     section 4 de `ai_billing_candidates` et rend son chiffre tel
 *     quel. Deux comptes du même encours finiraient un jour par
 *     différer, et personne ne saurait lequel croire.
 *   • LA MARGE ET SA DÉRIVE RESTENT À LA FINANCE, nommément.
 *   • LA CONCENTRATION EST REFUSÉE sous le seuil, avec le ratio qu'elle
 *     vaudrait et la raison pour laquelle il ne veut rien dire. Ce
 *     n'est pas un chiffre caché : c'est un chiffre qualifié.
 *   • LA CASCADE EST REFUSÉE DÉFINITIVEMENT, et ce refus est VÉRIFIÉ à
 *     chaque appel sur `information_schema` plutôt qu'affirmé par un
 *     commentaire. Le jour où quelqu'un ajoutera une colonne de
 *     prédécesseur, la réponse changera toute seule.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE SEUIL, ET POURQUOI CELUI-LÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * Douze observations avant tout taux, toute tendance et tout verdict.
 * Douze, c'est une observation par mois sur une année : le minimum pour
 * qu'une dérive se distingue d'une saison dans un métier qui travaille
 * au rythme des saisons. En dessous, un seul événement déplace le
 * résultat de plus de huit points, et le chiffre change de sens à
 * chaque ligne saisie.
 *
 * Cinq clients facturés pour prononcer le mot « concentration », aligné
 * sur le seuil de comparabilité déjà en vigueur dans le produit.
 *
 * Les deux seuils sont appliqués PAR LE SQL, pas par le modèle : sous
 * le seuil, la fonction rend `null` et un motif. Un seuil laissé à
 * l'appréciation du modèle est un seuil qui cède la première fois qu'on
 * insiste.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA PHRASE INTERDITE, EN TOUTES LETTRES
 * ══════════════════════════════════════════════════════════════════
 *
 * « Aucun risque détecté » est interdite, et la fonction la nomme dans
 * un champ `phraseInterdite` pour que l'interdiction voyage avec la
 * donnée. Sur ces tables, elle voudrait dire « je n'ai rien à lire », et
 * le dirigeant comprendrait « tout va bien ». Ce sont deux messages
 * opposés. L'agent dit ce qu'il a regardé, ce qu'il y a trouvé, et ce
 * qu'il n'a pas pu regarder.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'INTÉGRATION : QUATRE GESTES, DANS LE MÊME COMMIT
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. `agents/types.ts` : `risk` entre dans `AGENTS_CONSTRUITS` et
 *      dans `CLE_BASE` (même graphie des deux côtés, vérifié en 0088).
 *   2. `agents/index.ts` : importer `AGENT_RISQUES`, l'ajouter à `TOUS`.
 *   3. `agents/sansDonnees.ts` : retirer l'entrée `risk`.
 *   4. `runtime/tools.ts` : verser `OUTIL_RISK_SNAPSHOT`.
 *
 * Et, PARTAGÉ, dans `app/api/oasis-ai/aiguillage.ts` : placer `risk`
 * dans `ORDRE` après `operations` et avant `customer` — placement
 * mesuré, voir `MOTS_CLES_RISQUES`.
 *
 * La migration est DÉJÀ POSÉE : `ai_risk_snapshot` et l'ouverture de
 * `ai_is_supported_agent('risk')` vivent dans
 * `supabase/migrations/0088_agents_derniers.sql`.
 */

/**
 * §11Z, INTÉGRATION — L'ÉTAI DE COMPILATION A ÉTÉ RETIRÉ.
 *
 * Ce fichier portait un alias local `DefinitionEnAttente` parce que
 * `DefinitionAgent.cle` est borné à `AgentConstruit` et que « risk »
 * n'y figurait pas encore. Il y figure : l'objet ci-dessous s'annote
 * donc `: DefinitionAgent` comme les douze autres, et le contrôle de
 * type porte à nouveau sur la clé elle-même.
 *
 * On ne l'a PAS remplacé par un `as DefinitionAgent` : une conversion
 * aurait éteint ce contrôle pour de bon, y compris pour la faute
 * qu'il attrape vraiment — une définition rangée sous la clé du
 * voisin.
 */

/**
 * LES MOTS QUI DOIVENT L'ATTEINDRE, ET SURTOUT CEUX QUI NE LE DOIVENT PAS.
 *
 * ─── QUATRE MOTS, ET C'EST PEU EXPRÈS ───
 *
 * L'aiguillage compare des SOUS-CHAÎNES sur une question normalisée.
 * Un mot large ici ne rendrait pas l'agent plus utile : il lui ferait
 * voler des questions à ceux qui ont la source. Les quatre retenus sont
 * ceux qu'aucun autre agent ne peut servir.
 *
 * ─── LES QUATRE MOTS QU'IL NE PREND PAS, ET POURQUOI C'EST JUSTE ───
 *
 * Chacun a été rejoué contre le vrai aiguilleur, et chacun reste chez
 * l'agent qui détient le chiffre :
 *
 *   • « impay » → Facturation. « Quel est mon risque d'impayé » y reste,
 *     et c'est juste : l'encours échu est calculé par elle, et cet
 *     agent-ci ne fait que le LIRE.
 *   • « marge » → Finance. « Y a-t-il un risque de dérive de marge » y
 *     reste : la décomposition de marge est à elle.
 *   • « chantier » → Chantiers. « Quels chantiers risquent de déraper »
 *     y reste.
 *   • « retard » NU → interdit à tout le monde par l'en-tête
 *     d'`aiguillage.ts` : « facture en retard » ne doit jamais partir
 *     aux Chantiers sous prétexte que le mot y ressemble.
 *
 * ─── CE QUE LA PLACE DANS L'ORDRE DÉCIDE ───
 *
 * Après `operations`, avant `customer`. Le second point est le
 * nécessaire : « suis-je trop dépendant d'un client » et « quelle est
 * ma concentration client » contiennent le mot des Clients, et l'agent
 * Clients porte une limite explicite qui lui interdit TOUTE phrase de
 * portefeuille. Placé après lui, cet agent ne verrait jamais ces deux
 * questions, et l'utilisateur paierait un appel de modèle complet pour
 * un refus poli. C'est le défaut que l'en-tête d'`aiguillage.ts`
 * identifie déjà en expliquant pourquoi la Finance a été remontée.
 *
 * ─── « depend » ET NON « dépendance » ───
 *
 * La racine couvre « dépendant », « dépendance » et « je dépends trop
 * de ». La normalisation retire les accents, donc « depend » suffit
 * pour les trois. Vérifié qu'elle ne mord sur rien : la Finance
 * revendique « dépense », qui donne « depense » une fois normalisé —
 * les deux chaînes divergent à la sixième lettre.
 */
export const MOTS_CLES_RISQUES = [
  "risque",
  "concentration",
  // Racine volontaire : couvre dépendant, dépendance, je dépends de.
  "depend",
  "exposition",
] as const;

export const AGENT_RISQUES: DefinitionAgent = {
  cle: "risk",
  libelle: "Risques",
  mission:
    "Concentration du chiffre d'affaires facturé, encours échu, comportement de paiement, tenue " +
    "des délais. Il distingue à chaque phrase ce qu'il MESURE de ce qu'il DÉDUIT, et refuse de " +
    "conclure sous son seuil d'observations.",
  responsabilites:
    "Rend les mesures brutes du risque avec leurs dénominateurs, et lit chez la Facturation ce " +
    "qu'elle calcule déjà plutôt que de le recompter. Chaque affirmation est étiquetée : " +
    "« je mesure » pour ce qui sort d'un champ de ses outils, « j'en déduis » pour tout le " +
    "reste, toujours accompagné du fait mesuré qui la porte. Quand il n'a pas de quoi conclure, " +
    "il dit ce qu'il a regardé, ce qu'il y a trouvé et ce qu'il n'a pas pu regarder.",
  limites: [
    "N'écrit rien. Ne relance personne, ne bloque aucun client, ne modifie aucune échéance. " +
      "C'est une mission de lecture.",
    "ÉTIQUETTE CHAQUE AFFIRMATION. Ce qui sort d'un champ de ses outils est une MESURE et se " +
      "dit « je mesure ». Tout le reste est une DÉDUCTION, se dit « j'en déduis, sans " +
      "certitude », et cite le fait mesuré qui la porte. Une déduction présentée comme une " +
      "mesure est le seul défaut que cet agent ne peut pas se permettre.",
    "LA PHRASE « AUCUN RISQUE DÉTECTÉ » EST INTERDITE, en toutes lettres et sous toutes ses " +
      "variantes. Sur ces tables elle voudrait dire « je n'ai rien à lire » et serait comprise " +
      "comme « tout va bien ». Il dit ce qu'il a regardé, ce qu'il y a trouvé, et ce qu'il n'a " +
      "pas pu regarder.",
    "NE PRODUIT AUCUN SCORE AGRÉGÉ, aucune note, aucun feu tricolore, aucun niveau de risque " +
      "global. Un score mélange des mesures et des déductions dans un seul nombre et fait " +
      "disparaître exactement la distinction que cet agent existe pour tenir.",
    "NE CHIFFRE AUCUNE PROBABILITÉ d'impayé, de retard ou de perte. Aucun historique ne la " +
      "porte, et une probabilité inventée est la forme la plus convaincante d'un chiffre faux.",
    "Ne conclut rien tant que le nombre d'observations exigé par ses fonctions n'est pas " +
      "atteint. En dessous, il rend les lignes et le motif du refus, et se tait sur le verdict : " +
      "un taux calculé sur quelques lignes est une anecdote présentée comme une statistique.",
    "NE RECOMPTE PAS LES FACTURES ÉCHUES. Il les lit chez la Facturation et cite la source. " +
      "Deux comptes du même encours dans le même produit finiraient par différer, et personne " +
      "ne saurait lequel croire.",
    "Zéro facture en retard ne veut pas dire que les clients paient : cela peut vouloir dire " +
      "que rien n'est encore exigible. Il rend les échéances à venir et celles déjà arrivées " +
      "avant de commenter le zéro.",
    "Aucun règlement enregistré veut dire qu'il ne peut PAS distinguer une facture impayée " +
      "d'une facture payée hors logiciel. Ce n'est pas « zéro retard de paiement », et il ne " +
      "l'écrit jamais ainsi.",
    "Aucune date de fin prévue veut dire « aucune référence », pas « aucun retard ». Sans " +
      "promesse il n'y a pas de retard à constater, et c'est un défaut de saisie réparable qu'il " +
      "nomme comme tel.",
    "LA CASCADE DE RETARDS EST INCALCULABLE, et le refus est définitif : ce produit " +
      "n'enregistre aucune dépendance entre tâches. Ce n'est pas une donnée manquante, c'est une " +
      "fonctionnalité absente du schéma — elle ne deviendra pas calculable quand les tables se " +
      "rempliront. Il le vérifie sur le schéma à chaque appel plutôt que de le tenir pour acquis.",
    "Ne mesure ni la marge ni sa dérive : elles sont à la Finance. Ne rend pas le reste dû d'un " +
      "client nommé : c'est la fiche client. Ne suit pas les échéances du parc : c'est le " +
      "Matériel. Ne surveille pas les devis qui expirent : c'est le Chiffrage. Il y renvoie.",
    "Ne nomme aucun client et ne rend aucun euro sur la concentration : elle est un ratio. Le " +
      "montant appartient à la Finance et la fiche à l'agent Clients.",
  ],
  // Les trois droits que `ai_risk_snapshot` exige AVANT de lire — les
  // mêmes que `ai_billing_candidates`, qu'elle appelle. En exiger moins
  // ferait échouer l'appel plus bas avec un message qui parlerait de la
  // Facturation et pas du Risque.
  droitsAttendus: ["projects.read", "invoice.create", "quotes.read"],
  motsCles: MOTS_CLES_RISQUES,
};
