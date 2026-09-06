import type { DefinitionAgent } from "./types.ts";

/**
 * §11Z — MARCHÉ, QUI S'APPELLE EN RÉALITÉ « HISTORIQUE INTERNE ».
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ARBITRAGE, ET IL A ÉTÉ TRANCHÉ CONTRE UN AVIS PRÉCÉDENT
 * ══════════════════════════════════════════════════════════════════
 *
 * `agents/sansDonnees.ts` écartait cet agent, et son motif était juste :
 * la spec p. 16 lui promet une source EXTERNE — recherche web côté
 * serveur, avec citations datées — et cette capacité n'existe pas. Le
 * dirigeant a lu cet avis et a demandé l'agent quand même. La décision
 * est prise ; ce fichier l'exécute, et il l'exécute honnêtement.
 *
 * HONNÊTEMENT VEUT DIRE UNE CHOSE PRÉCISE ICI : cet agent ne produit
 * AUCUN prix « du marché », AUCUNE part de marché, AUCUNE comparaison
 * avec un concurrent. Ce ne sont pas des données rares ou vieilles :
 * elles n'existent nulle part dans ce produit. Un modèle interrogé
 * là-dessus produirait une réponse plausible et fausse, ce qui est
 * strictement pire qu'un refus — personne ne vérifie un chiffre qui a
 * l'air normal.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'OPTION (a) ET NON L'OPTION (b) SEULE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le cadrage laissait deux formes possibles : (a) un agent qui s'appuie
 * sur l'historique INTERNE et s'appelle par ce qu'il fait vraiment ;
 * (b) un agent qui se contente de déclarer la source externe manquante.
 *
 * (b) SEULE PRODUIRAIT UN AGENT À ZÉRO REQUÊTE : un refus poli qui
 * coûte un appel de modèle. Ce dépôt a déjà payé ce prix une fois — une
 * architecture IA livrée entièrement branchée sur du vide — et
 * `sansDonnees.ts` en tire la règle : « une façade est pire que rien ».
 *
 * (a) SEULE SERAIT UN DOUBLON sur deux de ses trois axes, et c'est
 * vérifié dans le code de 0073, pas supposé :
 * `ai_finance_margin_breakdown(p_dimension)` accepte 'service', 'mois',
 * 'ville', 'client', 'chantier', 'commercial', 'equipe' — la marge par
 * service ET la saisonnalité par mois sont donc à la Finance. Les taux
 * de transformation vont à l'agent Ventes, l'évolution du prix des
 * chantiers comparables à `ai_quote_comparables`.
 *
 * L'AGENT EST DONC (a) ET (b) À LA FOIS, ce qui n'est pas un compromis
 * mais la seule forme juste : il lit ce que personne ne sert — l'origine
 * des clients, le prix de vente unitaire par article dans le temps,
 * l'écart entre ce qu'on devise et ce qu'on facture — ET il porte la
 * déclaration (b) dans `sourceExterneAbsente`, qui nomme la capacité à
 * brancher plutôt que de s'excuser.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI IL CHANGE DE NOM SANS CHANGER DE CLÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * La clé technique reste `market` : le routeur (`lib/ai/model`),
 * `AGENTS_MODELE` et l'alias `market_intelligence` la connaissent déjà,
 * et rien ne justifie de toucher au routeur pour une question de nom.
 *
 * Le LIBELLÉ, lui, devient « Historique interne », parce que c'est ce
 * qu'il fait : il compare l'entreprise à SON PROPRE PASSÉ et à rien
 * d'autre. Un agent affiché « Marché » dans l'écran des réglages
 * promettrait au dirigeant ce que personne ne peut lui donner, et il le
 * découvrirait à la première question.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL APPORTE MÊME SUR DES TABLES PRESQUE VIDES
 * ══════════════════════════════════════════════════════════════════
 *
 * Et c'est l'argument principal de sa construction, plus que ses trois
 * requêtes. Aujourd'hui, « quel est le prix du marché pour une
 * terrasse ? » et « que font mes concurrents ? » tombent en défaut sur
 * la DIRECTION — mesuré en exécutant le vrai `aiguiller()`. Or les
 * limites de la Direction portent sur l'écriture, la prévision de
 * chiffre d'affaires, la pondération et la lecture directe de la base :
 * AUCUNE ne lui interdit d'inventer un prix de marché.
 *
 * Un agent qui refuse par son nom, au niveau de modèle le moins cher,
 * est donc strictement meilleur que le repli actuel — y compris, et
 * surtout, tant que ses tables sont vides.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'INTÉGRATION : QUATRE GESTES, DANS LE MÊME COMMIT
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. `agents/types.ts` : `market` entre dans `AGENTS_CONSTRUITS` et
 *      dans `CLE_BASE` (graphie identique des deux côtés — vérifié en
 *      0088, contrairement au piège `quote_pricing` / `quotePricing`).
 *   2. `agents/index.ts` : importer `AGENT_HISTORIQUE_INTERNE` et
 *      l'ajouter au tableau `TOUS`.
 *   3. `agents/sansDonnees.ts` : retirer l'entrée `market`.
 *   4. `runtime/tools.ts` : verser `OUTIL_INTERNAL_HISTORY`.
 *
 * Et, PARTAGÉ, dans `app/api/oasis-ai/aiguillage.ts` : placer `market`
 * dans `ORDRE` entre `operations` et `customer`. Le placement est
 * mesuré, pas préféré — voir `MOTS_CLES_HISTORIQUE_INTERNE` ci-dessous.
 *
 * La migration, elle, est DÉJÀ POSÉE : `ai_internal_history` et
 * l'ouverture de `ai_is_supported_agent('market')` vivent dans
 * `supabase/migrations/0088_agents_derniers.sql`.
 *
 * ─── POURQUOI CE FICHIER NE PORTE PAS `aCompleter` ───
 *
 * Parce que rien ne manque. Les six gabarits de §11Y portaient ce
 * drapeau parce que leur fonction SQL n'était pas encore dans une
 * migration ; ici elle y est, éprouvée. `aCompleter: true` ferait
 * afficher « en construction » sur un agent prêt et, pire, le rendrait
 * injoignable par `AGENTS_JOIGNABLES`.
 */

/**
 * §11Z, INTÉGRATION — L'ÉTAI DE COMPILATION A ÉTÉ RETIRÉ.
 *
 * Ce fichier portait un alias local `DefinitionEnAttente` parce que
 * `DefinitionAgent.cle` est borné à `AgentConstruit` et que « market »
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
 * LES MOTS QUI DOIVENT L'ATTEINDRE, ET LEUR PLACE DANS L'ORDRE.
 *
 * ─── LES TROIS GRAPHIES DE LA MÊME QUESTION, ET POURQUOI ───
 *
 * PIÈGE MESURÉ EN EXÉCUTANT LE VRAI AIGUILLEUR : `normaliser()` passe
 * en minuscules et retire les diacritiques, mais elle NE TOUCHE PAS aux
 * apostrophes. « d'où viennent mes clients » ne correspond donc pas au
 * mot-clé « d ou viennent mes clients », et l'inverse est vrai aussi.
 * Les agents existants contournent déjà en écrivant les deux graphies —
 * la Direction porte « aujourd'hui » ET « aujourd hui », la Finance
 * « chiffre d'affaires » ET « chiffre d affaires ». On suit leur
 * manière plutôt que de modifier `normaliser()`, qui toucherait les dix
 * agents d'un coup pour le confort d'un seul.
 *
 * ─── TROIS MOTS CONTIENNENT « client », ET C'EST ASSUMÉ ───
 *
 * « origine de mes clients » et les deux graphies de « d'où viennent
 * mes clients » contiennent le mot de l'agent Clients. Ce n'est pas une
 * collision oubliée : c'est ce qui rend le placement dans `ORDRE`
 * NÉCESSAIRE, et non préférable.
 *
 * Cet agent doit être essayé AVANT `customer`. Sans cela, « d'où
 * viennent mes clients » est attrapé par les Clients sur le mot
 * « client » — et l'agent Clients porte une limite explicite qui lui
 * interdit TOUTE phrase de portefeuille. Il déclinerait donc poliment,
 * après avoir fait payer un appel de modèle complet. C'est exactement
 * le défaut que l'en-tête d'`aiguillage.ts` nomme quand il explique
 * pourquoi la Finance a été remontée dans l'ordre.
 *
 * PLACE RETENUE : entre `operations` et `customer`. Après les
 * Chantiers, parce que « saisonnalité de mes chantiers » doit rester
 * aux Chantiers ; avant les Clients, pour la raison ci-dessus.
 *
 * ─── LES MOTS DE REFUS SONT DES MOTS DE PLEIN DROIT ───
 *
 * « prix du marché », « part de marché », « concurrent », « benchmark »
 * n'amènent aucune donnée : ils amènent un refus nommé. On pourrait
 * croire qu'attraper une question pour la refuser est un gaspillage —
 * c'est le raisonnement qui a fait écarter « portefeuille » chez les
 * Clients. La différence tient en une phrase : ces quatre questions
 * tombent AUJOURD'HUI sur la Direction, à qui rien n'interdit
 * d'inventer un prix. Le refus n'est donc pas un coût évitable, c'est
 * la correction d'un risque réel — et il coûte le niveau de modèle le
 * moins cher.
 *
 * ─── LE MOT QU'ON N'ÉCRIT PAS ───
 *
 * « marché » NU. Il attraperait « le marché de Rungis », « un marché
 * public », « j'ai décroché ce marché » — trois questions qui ne sont
 * pas les siennes, dont deux appartiennent au Commerce. Les deux
 * locutions complètes suffisent, et elles ne se déclenchent que sur la
 * question qu'on veut vraiment refuser.
 */
export const MOTS_CLES_HISTORIQUE_INTERNE = [
  // Ce qu'il sait lire.
  "saisonnal",
  "évolution de mes prix",
  "évolution de mes tarifs",
  "origine de mes clients",
  "d'où viennent mes clients",
  "d ou viennent mes clients",
  // ══════════════════════════════════════════════════════════════════
  // CE QU'IL SAIT REFUSER EN LE NOMMANT — ÉLARGI EN §11Z, APRÈS MESURE
  // ══════════════════════════════════════════════════════════════════
  //
  // C'est la moitié la plus importante de cette liste, et c'est
  // l'argument qui a justifié la construction de cet agent : aujourd'hui
  // une question de marché sans mot-clé tombe en défaut sur la
  // DIRECTION, dont aucune des limites ne lui interdit d'inventer un
  // prix du marché. Un refus nommé vaut donc strictement mieux que le
  // repli, et il coûte le niveau le moins cher.
  //
  // LA PREMIÈRE VERSION NE TENAIT QUE POUR DEUX FORMULATIONS SUR DOUZE.
  // Mesuré en rejouant le vrai aiguilleur :
  //
  //   executive | Quel est le prix MOYEN du marché pour une terrasse ?
  //   executive | Que fait la CONCURRENCE ?
  //   executive | Quelle est ma position SUR LE marché local ?
  //   executive | Quelles sont les PARTS de marché du secteur ?
  //   executive | Est-ce que mes tarifs sont dans les PRIX PRATIQUÉS… ?
  //   executive | Quel est mon POSITIONNEMENT tarifaire ?
  //   executive | Est-ce que je suis COMPÉTITIF ?
  //
  // DEUX CAUSES, ET AUCUNE N'EST UNE FAUTE D'INATTENTION.
  //
  //   1. « concurrent » N'EST PAS UNE SOUS-CHAÎNE DE « concurrence » :
  //      les deux mots divergent au dixième caractère. Le mot le plus
  //      employé du sujet ratait donc le mot-clé, et il faut les deux.
  //
  //   2. LES LOCUTIONS SONT CONTIGUËS. « prix du marché » ne correspond
  //      pas à « prix MOYEN du marché », et « part de marché » pas à
  //      « PARTS de marché » — un « s » sur le premier mot casse tout,
  //      alors qu'un « s » à la fin est gratuit. D'où « du marché », qui
  //      couvre les deux tournures de prix, et les deux graphies de
  //      « part(s) de marché ».
  //
  // « marché » NU RESTE INTERDIT, et l'en-tête au-dessus dit pourquoi.
  // « du marché » et « sur le marché » sont les deux tournures qui
  // désignent le marché AU SENS ÉCONOMIQUE ; « j'ai décroché ce marché »
  // et « un marché public » n'en contiennent aucune, et restent donc au
  // Commerce.
  "du marché",
  "sur le marché",
  "part de marché",
  "parts de marché",
  "concurrent",
  "concurrence",
  "prix pratiqué",
  "positionnement",
  // Couvre compétitif, compétitive, compétitivité, compétition.
  "compétiti",
  // « suis-je plus cher QUE LES AUTRES entreprises du secteur ? »
  "que les autres",
  "benchmark",
] as const;

export const AGENT_HISTORIQUE_INTERNE: DefinitionAgent = {
  cle: "market",
  // Le nom dit ce qu'il fait. Voir l'en-tête : « Marché » promettrait
  // ce que personne ne peut donner.
  libelle: "Historique interne",
  mission:
    "L'entreprise comparée à SON PROPRE PASSÉ : d'où viennent ses clients, comment ses prix de " +
    "vente bougent article par article, ce qu'elle devise contre ce qu'elle facture. Aucune " +
    "donnée extérieure : ni prix du marché, ni part de marché, ni concurrent.",
  responsabilites:
    "Lit l'historique interne que personne d'autre ne sert et le rend tel quel, avec ses " +
    "dénominateurs. Quand on l'interroge sur le marché, la concurrence ou un prix pratiqué " +
    "ailleurs, il refuse en NOMMANT la capacité qui manque et ce qu'il faudrait brancher pour " +
    "que la question devienne répondable — plutôt que de s'excuser, et surtout plutôt que de " +
    "produire un chiffre plausible. Renvoie vers la Finance, le Chiffrage, les Ventes et les " +
    "Achats ce qu'ils calculent déjà.",
  limites: [
    "N'écrit rien. Ne crée, ne modifie et n'archive aucune fiche, aucun tarif, aucun article. " +
      "C'est une mission de lecture.",
    "NE PRODUIT AUCUN PRIX « DU MARCHÉ ». Aucun prix pratiqué hors de cette entreprise n'existe " +
      "dans ce produit : aucune table ne le stocke, aucun outil ne le cherche, il n'y a même " +
      "pas d'endroit où écrire sa source et sa date. Il dit que la capacité N'EXISTE PAS et " +
      "nomme ce qu'il faudrait brancher — une recherche extérieure côté serveur et une table de " +
      "sources datées. Il n'en estime jamais un, même « à titre indicatif ».",
    "NE PRODUIT AUCUNE PART DE MARCHÉ. Le dénominateur — la taille du marché — n'existe dans " +
      "aucune table. Une part calculée sur un dénominateur absent est une invention.",
    "NE COMPARE JAMAIS À UN CONCURRENT. Aucun concurrent n'est nommé nulle part : les seuls " +
      "endroits où l'information pourrait vivre sont les motifs de perte des clients, des " +
      "opportunités et des devis, et ils ne sont pas renseignés. Il le dit ainsi, et non " +
      "« vous n'avez pas de concurrent ».",
    "N'EMPLOIE PAS LE MOT « MARCHÉ » pour parler de ce qu'il a lu. Le lecteur comprendrait " +
      "« les autres ». Il dit « chez vous », « dans vos devis », « sur vos chantiers ».",
    "Ne rend aucune part en pourcentage tant que le nombre de points de comparaison exigé par " +
      "sa fonction n'est pas atteint. En dessous, il rend les lignes brutes et le motif du " +
      "refus : un pourcentage sur quelques lignes est arithmétiquement exact et ne décrit rien.",
    "Ne prononce pas le mot « saisonnalité » tant que l'historique n'a pas la profondeur que sa " +
      "fonction exige. Une saison se compare à la même saison de l'année précédente. Il dit " +
      "« pas assez d'histoire pour en détecter une », jamais « aucune saisonnalité détectée ».",
    "Ne confond pas un champ vide avec une absence. « Aucune source renseignée » n'est pas " +
      "« aucune origine » ; « aucune ligne rattachée à un article » n'est pas « un prix stable ». " +
      "Ce sont des défauts de saisie, réparables, et il les nomme comme tels.",
    "Le prix qu'il rend est le prix de VENTE unitaire. Il ne le présente jamais comme un coût " +
      "d'achat, et il ne rend aucun prix fournisseur : les achats appartiennent à l'agent " +
      "Achats, qui a ses propres tables.",
    "Le rapprochement entre ce qui est devisé et ce qui est facturé passe par le LIBELLÉ, faute " +
      "de référence d'article sur les lignes de facture. C'est fragile : deux libellés voisins " +
      "ne se rejoignent pas. Il le présente comme une piste à vérifier, jamais comme un écart " +
      "mesuré.",
    "Ne calcule ni la marge par service, par ville ou par mois — la Finance la décompose déjà " +
      "dimension par dimension — ni les taux de transformation, qui sont aux Ventes, ni la " +
      "fourchette des chantiers comparables, qui est au Chiffrage. Il y renvoie.",
  ],
  // Les deux droits que `ai_internal_history` exige, et les deux
  // LÈVENT : elle lit le portefeuille clients ET les lignes de devis.
  // Un seul des deux donnerait une moitié de réponse qui se lirait
  // comme une réponse entière.
  droitsAttendus: ["clients.read", "quotes.read"],
  motsCles: MOTS_CLES_HISTORIQUE_INTERNE,
};
