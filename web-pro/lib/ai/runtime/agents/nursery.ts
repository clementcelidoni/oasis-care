import type { DefinitionAgent } from "./types.ts";

/**
 * PÉPINIÈRE — ACHEVÉ, ET IL SAIT CE QU'IL NE VOIT PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CET AGENT EST CONSTRUIT ALORS QUE LA BASE EST PRESQUE VIDE
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce que le vide n'est pas le critère. Le critère est : « existe-t-il
 * un chemin de lecture réel derrière ce que l'agent prétend savoir ? »
 *
 * Pour la Pépinière, oui, et c'est vérifié en production, pas déduit :
 *
 *   • `getNurseryStock` → `ai_find_stock` — exécutée sur l'organisation
 *     réelle, elle rend
 *     `{"espece":"CYCA","physique":50,"reserve":30,"disponible":20,
 *       "en_production":0,"attendu":0}`.
 *   • `getProjectedNurseryNeeds` → `ai_forecast_availability` — rend
 *     `{"enProduction":[{"lot":"CYCA1","stade":"Semis","quantite":50,
 *       "vendable":false}],"commandesAttendues":[]}`.
 *
 * Les deux sont déclarées dans `runtime/tools.ts`, définies en 0058,
 * présentes dans `pg_proc`, et elles appartiennent DÉJÀ à cet agent
 * (`agent: "nursery"`). Elles ne figurent pas dans
 * `OUTILS_SPEC_SANS_SERVICE` : cette liste ne contient aucun outil de
 * pépinière. Il n'y avait donc rien à écrire côté outils pour que cet
 * agent dise des choses vraies — il y avait un agent à instruire.
 *
 * Ce qui rendait la Pépinière INATTEIGNABLE n'était pas l'absence
 * d'outil, c'était l'absence de mots-clés : `app/api/oasis-ai/aiguillage.ts`
 * connaît déjà l'ORDRE des dix agents, et lit les mots dans le fichier
 * de chacun. Sans mots, « combien de cycas en stock ? » tombait par
 * défaut sur la DIRECTION, dont le plan de contexte ne contient aucune
 * source de pépinière — et la Direction répondait « je ne vois rien »
 * avec assurance. C'est la panne silencieuse déjà documentée pour
 * l'agent Devis dans `context.ts`, dans le sens rassurant. La section
 * `motsCles` ci-dessous est donc la moitié utile de ce fichier.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ MESURÉ, ET QUI N'EST PAS ÉCRIT DANS LES LIMITES
 * ══════════════════════════════════════════════════════════════════
 *
 * Les chiffres ci-dessous datent du 5 septembre 2026 et valent pour
 * l'UNIQUE organisation de cette base. Ils sont ici, en commentaire, et
 * PAS dans `limites` — délibérément : `limites` part mot pour mot dans
 * l'instruction envoyée au modèle, pour TOUTES les entreprises. Y
 * écrire « aucune inspection n'a jamais été saisie » ferait dire à
 * Oasis, chez la vingtième entreprise cliente qui inspecte ses lots
 * toutes les semaines, une phrase fausse — et personne ne la
 * relierait à cette ligne. Une limite est une RÈGLE de structure ;
 * une mesure est un fait daté. On ne mélange pas les deux.
 *
 *   nursery_lots 1 · nursery_stock (vue) 1 · nursery_stages 10
 *   nursery_locations 1 · nursery_reservations 1
 *   nursery_stock_movements 3 (receive, repot, reserve — aucun `loss`,
 *   aucun `sell`) · nursery_inspections 0 · purchase_orders 0 ·
 *   suppliers 0 · sales_orders 0 · project_resources 14 dont UNE seule
 *   de kind='plant' · projects 1, au statut `completed`.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA CONTRADICTION DES TROIS « DISPONIBLE », VÉRIFIÉE SUR LE MÊME LOT
 * ══════════════════════════════════════════════════════════════════
 *
 * Le lot CYCA1 — statut `available`, stade `Semis` dont `is_saleable`
 * est faux, 50 unités dont 30 réservées — est rendu, le même jour :
 *
 *   • « disponible 20 » par `ai_find_stock` (la vue `nursery_stock` ne
 *     regarde que le STATUT du lot) ;
 *   • « 50 en production, vendable: false » par
 *     `ai_forecast_availability` (elle ne regarde que le STADE) ;
 *   • « available_stock 0 » par `pro_analytics_nursery` (elle exige
 *     statut ET stade vendable).
 *
 * Les deux premières sont précisément les deux sources de cet agent.
 * Sans consigne, il se contredirait dans un seul paragraphe, avec
 * aplomb — pire que le silence. La deuxième limite ci-dessous est la
 * réponse : il rend TOUJOURS les deux chiffres et dit ce qui les
 * sépare. Ce n'est pas un contournement de bug ; les deux chiffres sont
 * justes, ils répondent à deux questions différentes, et c'est
 * exactement le rapprochement qu'aucun écran ne fait aujourd'hui —
 * /pepiniere/stock affiche 20, /pepiniere/production affiche le stade,
 * et c'est l'humain qui doit faire le lien.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX CORRECTIONS DEMANDÉES PAR CE FICHIER — TOUTES DEUX FAITES
 * ══════════════════════════════════════════════════════════════════
 *
 * Elles sont laissées écrites parce que la SEPTIÈME LIMITE ci-dessous
 * ne se comprend pas sans elles, et parce que le jour où l'une est
 * défaite, c'est ici qu'on cherchera pourquoi.
 *
 *   1. LE DROIT DE LECTURE — POSÉ. `runtime/tools.ts` déclarait les
 *      deux outils avec `permission: null`, alors que les six tables
 *      `nursery_*` sont toutes sous
 *      `has_permission(organization_id, 'nursery.stock.manage')` —
 *      mesuré dans `pg_policies`, un droit d'ÉCRITURE employé comme
 *      droit de LECTURE. Sans ce mot, un utilisateur sans le droit
 *      recevait `[]` et l'agent annonçait « aucun stock » au lieu de
 *      « je n'ai pas le droit de voir le stock » : la CINQUIÈME
 *      occurrence de la confusion « zéro / je ne sais pas » dans ce
 *      produit. Les deux outils portent maintenant
 *      `permission: "nursery.stock.manage"` : ils ne sont plus offerts
 *      sans le droit, et `refusesPourAgent` le NOMME.
 *
 *      LA SEPTIÈME LIMITE RESTE, ET CE N'EST PAS UN DOUBLON. La
 *      barrière du registre retire l'outil ; elle ne couvre pas le cas
 *      où le droit existe mais où la RLS filtre quand même une partie
 *      des lignes. La limite dit au modèle de ne jamais lire un vide
 *      comme un zéro — ceinture ET bretelles, dans cet ordre.
 *
 *   2. LE PLAN DE CONTEXTE — POSÉ AUSSI, et il n'était pas bloquant.
 *      Il faut le dire parce que c'est contre-intuitif : `contexte.vide`
 *      vaut `requisTotal > 0 && requisLu === 0`, donc un agent SANS
 *      plan n'est jamais « vide » — il part au modèle avec ses outils
 *      (`outilsSdkPourAgent`) et les appelle lui-même. La Pépinière
 *      fonctionnait donc déjà en appel d'outil. Sa clé dans `PLANS`
 *      (`context.ts`) lui fait gagner un aller-retour sur les questions
 *      les plus courantes ; elle ne lui a donné aucune capacité
 *      nouvelle.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL NE FAUT PAS ÉCRIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Coût de revient d'un lot, date de disponibilité prévisionnelle, prix
 * fournisseur : aucune table derrière les trois — vérifié dans
 * `pg_class` sur le schéma `public`. Il n'existe ni coût par stade, ni
 * main-d'œuvre imputée à un lot, ni durée de culture (`nursery_stages`
 * porte un libellé, une position et `is_saleable`, jamais un délai).
 * Les écrire ferait ESTIMER par le modèle.
 *
 * `ai_suggest_purchase_needs` reste NON DÉCLARÉE ici, et c'est un
 * arbitrage laissé au dirigeant, pas un oubli : la fonction Edge la
 * range sous `agentFutur: "procurement"`, la spec p. 12 la nomme côté
 * pépinière. La donner aux deux ferait deux réponses possibles à la
 * même question, et un jour deux réponses différentes. Tant que
 * personne n'a tranché, aucun des deux ne la prend.
 */
export const AGENT_PEPINIERE: DefinitionAgent = {
  cle: "nursery",
  libelle: "Pépinière",
  // NE PAS TOUCHER SANS TOUCHER `AGENT_MISSIONS` (lib/ai/types.ts) :
  // `agents/index.test.ts` compare les deux mot pour mot, parce que
  // deux formulations pour un même agent font croire qu'il y en a deux.
  // LA CLAUSE DE REFUS A ÉTÉ AJOUTÉE, ET ELLE CORRIGE UN TIERS DE
  // MISSION QUI N'AVAIT AUCUNE SOURCE. L'ancienne promettait « ce que
  // les chantiers engagés vont consommer » : aucun des deux outils de
  // l'agent ne produit cela. `ai_forecast_availability` ne touche
  // jamais un chantier — son corps ne lit que `nursery_lots`,
  // `nursery_stages` et `purchase_order_lines`, vérifié en base — et
  // `ai_suggest_purchase_needs`, la seule fonction qui rapprocherait
  // les deux, n'est déclarée par personne (voir procurement.ts).
  //
  // La clause reste dans la MISSION plutôt que d'être seulement une
  // limite, exactement comme pour le Matériel et les Clients : la
  // question « qu'est-ce que je vais devoir planter » est légitime, et
  // il faut qu'elle ARRIVE à cet agent pour qu'il réponde que le
  // produit ne le mesure pas. La supprimer de la mission la ferait
  // errer ; la garder sans la nier ferait inventer une réponse.
  mission:
    "Stock par espèce et par lot, ce qui est réellement vendable, et ce qui est attendu des " +
    "commandes. Ne dit pas ce que les chantiers engagés vont consommer : rien ne relie un " +
    "devis au stock.",
  responsabilites:
    "Lit le stock d'une espèce — physique, réservé, disponible — et l'état des lots en " +
    "production, puis RAPPROCHE les deux : c'est le seul endroit du produit où « j'en ai 20 » " +
    "et « ils ne sont pas vendables » se disent dans la même phrase. Aucun écran ne fait ce " +
    "rapprochement.",
  limites: [
    // 1. Ce qu'il ne peut pas faire, et qui ne se devine pas : il n'a
    //    AUCUN outil d'écriture. `createNurseryLot` et
    //    `recordStockMovement` sont câblés dans `lib/ai/proposals.ts`
    //    mais absents de `runtime/tools.ts` — donc jamais offerts au
    //    modèle. Sans cette ligne, il proposerait de « préparer un
    //    brouillon » qu'aucun outil ne peut déposer.
    "N'ÉCRIT RIEN, et ne propose rien à écrire : aucun outil d'entrée de lot ni de mouvement " +
      "de stock ne lui est offert aujourd'hui. Créer un lot ou enregistrer un mouvement se " +
      "fait sur /pepiniere/lots. Il dit où, il ne promet pas de le faire.",

    // 2. LA limite de cet agent. Voir l'en-tête : trois définitions
    //    mesurées sur le même lot, dont deux sont ses propres sources.
    "« DISPONIBLE » A DEUX SENS DANS SES PROPRES SOURCES, ET ELLES PEUVENT SE CONTREDIRE SUR " +
      "LE MÊME LOT. Le stock dit « disponible » ce qui n'est pas réservé sur un lot dont le " +
      "STATUT est disponible ; la production dit « vendable » un lot dont le STADE de culture " +
      "est arrivé au bout. Un même lot peut être disponible au premier sens et non vendable au " +
      "second, en même temps, et les deux sont vrais. Il rend TOUJOURS les deux chiffres et " +
      "nomme ce qui les sépare ; il n'en choisit jamais un, et ne conclut jamais « vous pouvez " +
      "en vendre autant » sur le seul chiffre du stock.",

    // 3. Le piège du carnet vide, cas général de « zéro ≠ je ne sais
    //    pas » appliqué à des faits SAISIS À LA MAIN.
    "UN MOUVEMENT NON SAISI N'EST PAS UN MOUVEMENT QUI N'A PAS EU LIEU. Les pertes, les " +
      "ventes et les réceptions n'existent pour lui que si quelqu'un les a enregistrées. Il " +
      "dit « aucune perte saisie », jamais « vous ne perdez rien » : le dénominateur est un " +
      "carnet, pas une pépinière.",

    // 4. Trois angles morts structurels, nommés ensemble parce qu'ils
    //    ont la même cause : aucune source ne les expose.
    "NE VOIT PAS l'état sanitaire des lots (aucune source ne lit les inspections), ni POUR QUI " +
      "un stock est réservé (il voit combien, jamais le bénéficiaire), ni la valeur du stock, " +
      "le taux de perte ou la rotation. Ces questions se répondent sur /pepiniere/sante, " +
      "/pepiniere/lots et /analytics. Il nomme l'écran plutôt que de laisser croire qu'il a " +
      "regardé.",

    // 5. Les trois inventions les plus tentantes du métier.
    "NE CONNAÎT ni le coût de revient d'un lot, ni la date à laquelle un semis deviendra " +
      "vendable, ni aucun prix d'achat. Ces trois-là n'ont aucune table dans ce produit : les " +
      "stades de culture portent un ordre et un caractère vendable, jamais un délai. Il ne " +
      "les estime pas — un délai plausible sert à promettre une livraison.",

    // 6. `commandesAttendues` traverse purchase_orders, qui relève d'un
    //    AUTRE droit que le stock (invoice.create, mesuré dans
    //    pg_policies). Trois causes indiscernables pour une liste vide.
    "CE QUI EST ATTENDU vient des commandes fournisseur, qui ne relèvent pas du même droit que " +
      "le stock. « Rien n'arrive » peut vouloir dire trois choses — aucune commande saisie, " +
      "aucune commande en cours, ou pas le droit de les voir — et il ne tranche pas entre " +
      "elles sans le dire.",

    // 7. LA SECONDE BRETELLE, ET ELLE SERT ENCORE. La barrière est
    //    posée dans `tools.ts` (`permission: "nursery.stock.manage"`,
    //    voir l'en-tête, correction 1) : sans le droit, l'outil n'est
    //    plus offert du tout. Cette limite couvre l'autre cas, que le
    //    registre ne voit pas — le droit est là, mais la RLS filtre une
    //    partie des lignes, et le vide qui remonte reste indiscernable
    //    d'un vide réel.
    "UN STOCK VIDE PEUT ÊTRE UN DROIT MANQUANT. Le droit de gérer le stock de la pépinière " +
      "commande la lecture de TOUTES ses sources, et son absence rend une liste vide, " +
      "indiscernable d'une pépinière vide. Devant un stock entièrement vide, il énonce les " +
      "deux possibilités au lieu d'annoncer zéro.",

    // 8. LE TIERS DE MISSION QUI N'A AUCUNE SOURCE, nommé ici en plus
    //    de la mission. Sans cette limite, l'agent recevait la question
    //    (elle est dans sa mission, donc la Direction la lui délègue)
    //    et n'avait rien qui lui dise de refuser : `enProduction` et
    //    `commandesAttendues` ressemblent assez à « ce qui arrive »
    //    pour qu'un modèle en tire un besoin par soustraction.
    "NE DIT PAS CE QUE LES CHANTIERS ENGAGÉS VONT CONSOMMER. Aucune source ne relie un devis, " +
      "un chantier ou une ressource de chantier au stock de pépinière : il voit ce qu'il a, ce " +
      "qui pousse et ce qui arrive, jamais ce qui va sortir. Il ne déduit donc AUCUN besoin " +
      "par soustraction, même quand les deux chiffres sont sous ses yeux, et renvoie la " +
      "question au chiffrage du devis concerné.",
  ],
  // NE PAS TOUCHER SANS TOUCHER `AGENT_REQUIRED_PERMISSIONS`
  // (lib/ai/types.ts) : `agents/index.test.ts` compare les deux listes.
  // `nursery.stock.manage` gouverne les six tables `nursery_*` ;
  // `projects.read` sert `getProjectContext`, le pont entre ce qu'un
  // chantier va planter et ce qui est en serre.
  droitsAttendus: ["nursery.stock.manage", "projects.read"],
  /**
   * LES MOTS QUI L'APPELLENT — et les trois que j'ai refusé d'écrire.
   *
   * L'aiguilleur essaie la Pépinière APRÈS la facturation, le chiffrage
   * et les achats, et AVANT le matériel, le planning, les chantiers,
   * les clients, la finance et la Direction. Un mot écrit ici gagne
   * donc contre ces six-là : il doit être sans ambiguïté dans le
   * métier, pas seulement plausible.
   *
   *   • « espèce » — REFUSÉ. « payer en espèces » est du ressort de la
   *     facturation, qui passe pourtant avant : le risque est faible,
   *     mais un mot qui désigne l'argent chez un agent qui parle de
   *     plantes ne mérite pas d'être défendu.
   *   • « disponib » — REFUSÉ. La disponibilité d'une ÉQUIPE appartient
   *     au Planning, qui passe APRÈS la Pépinière : le mot lui serait
   *     volé. « Qui est disponible jeudi ? » doit continuer de tomber à
   *     la Direction tant que le Planning n'a pas ses mots.
   *   • « lot » nu — REFUSÉ, au profit de « lots ». « pilotage »
   *     contient « lot », et « les questions de pilotage vont à la
   *     Direction » est un test qui existe. Le pluriel coûte une
   *     formulation (« combien de lots ») et supprime la classe entière
   *     des faux positifs par sous-chaîne.
   *
   * Les accents ne sont pas doublés : `normaliser()` retire les
   * diacritiques des DEUX côtés, donc « pépinière » attrape déjà
   * « pepiniere ». Écrire les deux graphies laisserait croire que la
   * normalisation ne suffit pas.
   */
  motsCles: [
    "pépinière",
    "stock",
    "lots",
    "semis",
    "bouture",
    "rempot",
    "godet",
    "vendable",
    "cultivar",
    "serre",
  ],
  // `aCompleter` retiré : cet agent a deux sources réelles, une
  // instruction qui nomme ses sept angles morts, et des mots qui
  // l'atteignent. Le retrait fait tomber l'assertion
  // `AGENTS_A_COMPLETER` de `definitions.test.ts` — fichier partagé,
  // signalé à l'intégration plutôt que corrigé ici.
};
