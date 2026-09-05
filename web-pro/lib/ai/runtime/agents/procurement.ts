import type { DefinitionAgent } from "./types.ts";

/**
 * ACHATS — RESTE UN GABARIT, ET C'EST UNE DÉCISION, PAS UN ABANDON.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ MESURÉ EN PRODUCTION LE 5 SEPTEMBRE 2026
 * ══════════════════════════════════════════════════════════════════
 *
 *   suppliers 0 · supplier_prices 0 · purchase_orders 0 ·
 *   purchase_order_lines 0 · goods_receipts 0 · goods_receipt_lines 0
 *
 * Les six tables existent (0048, 0053), leur schéma est complet, les
 * écrans /achats et /fournisseurs sont livrés et fonctionnels. Il n'y a
 * pas une ligne dedans. Ce n'est pas « peu de données », c'est zéro.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI IL N'EST PAS ALLUMÉ : IL N'A AUCUN OUTIL DE LECTURE
 * ══════════════════════════════════════════════════════════════════
 *
 * Compté dans `runtime/tools.ts`, agent par agent : l'agent Achats
 * possède UN outil, `createPurchaseOrderDraft`, et c'est une
 * PROPOSITION. Il n'a AUCUN `rpc` de lecture à lui. Les trois outils
 * transverses qui lui restent — `searchEntities`, `getProjectContext`,
 * `getClientContext` — ne rendent ni un fournisseur utile, ni une
 * commande, ni un besoin :
 *
 *   • `ai_get_project_context` n'expose PAS `project_resources` —
 *     vérifié, zéro occurrence dans le corps de la fonction. Il rend le
 *     chantier, ses phases, son budget et ses interventions, jamais ce
 *     qu'il consomme. « De quoi ai-je besoin sur le chantier Dupont ? »
 *     est donc sans réponse, même avec cet outil.
 *   • `searchEntities` sait chercher un fournisseur (`global_search`,
 *     0061), mais `suppliers` est vide.
 *
 * Un agent allumé dans cet état paierait un raisonnement complet pour
 * produire une phrase polie. C'est la définition de la façade, et ce
 * produit vient d'en payer le prix une fois.
 *
 * `aCompleter` reste donc à `true`, et par voie de conséquence
 * `motsCles` reste ABSENT — `agents/index.test.ts` tient les deux
 * ensemble, et il a raison : « on ne fait pas répondre un agent avant
 * qu'il ait quelque chose à dire ».
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI L'ALLUMERAIT, ET QUI N'EST DANS AUCUN FICHIER À MOI
 * ══════════════════════════════════════════════════════════════════
 *
 * UN SEUL OUTIL, et il existe déjà à moitié.
 * `public.ai_suggest_purchase_needs(p_organization_id)` est en
 * production, déterministe, testée (`supabase/tests/analytics_ai_tools.sql`),
 * et calcule le bon tableau : besoin des chantiers `planned/inProgress/
 * onHold` (project_resources, kind='plant') − stock disponible − déjà
 * commandé. La fonction Edge la range déjà sous
 * `agentFutur: "procurement"` ; le runtime Next.js l'a perdue.
 *
 * ON NE PEUT PAS LA DÉCLARER TELLE QUELLE, et la raison est mesurée,
 * pas prudentielle. Elle est `security invoker` et traverse TROIS RLS
 * distinctes (relevées dans `pg_policies`) :
 *
 *   project_resources → `projects.read`
 *   nursery_stock (vue) → nursery_lots → `nursery.stock.manage`
 *   la branche `expected` de cette vue → purchase_order_lines →
 *     `invoice.create`
 *
 * Et son SQL soude les trois avec des `coalesce(..., 0)` et un
 * `left join`. Un droit qui manque ne fait donc pas échouer la
 * fonction : il fait tomber une branche à zéro. Trois faux plausibles,
 * dans trois directions différentes :
 *
 *   sans `nursery.stock.manage` → « commandez 200 sujets » qu'on a en
 *     stock ;
 *   sans `invoice.create` → recommande ce qui est déjà sur le camion ;
 *   sans `projects.read` → rend `[]`, qui se lit « rien à commander »
 *     alors qu'il y a tout à commander.
 *
 * `OutilOasis.permission` ne porte QU'UNE permission (`runtime/tools.ts`,
 * type fermé) : cet outil ne peut pas s'exprimer dans le registre
 * actuel. Choisir l'une des trois ne réduit pas le risque, elle le
 * DÉPLACE sur les deux autres. Il lui faut un enrobage SQL qui appelle
 * `ai_guard` sur les trois et nomme celle qui manque — c'est-à-dire une
 * migration, et la migration 0082 n'appartient pas à ce fichier.
 *
 * Le déclarer quand même serait la CINQUIÈME occurrence de la confusion
 * « zéro / je ne sais pas » dans ce produit, et la première qu'on
 * aurait introduite en la connaissant.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN BUG D'ÉCRITURE DÉJÀ EN PRODUCTION, INDÉPENDANT DE CET AGENT
 * ══════════════════════════════════════════════════════════════════
 *
 * `runtime/tools.ts` déclare les lignes de `createPurchaseOrderDraft`
 * avec `unit_price_cents`. La fonction SQL `ai_create_purchase_order_draft`
 * (0069) lit `unit_cost_cents` — et `lib/ai/proposals.ts` AFFICHE
 * `unit_cost_cents`. Le champ que le modèle remplit n'est lu par
 * personne : `coalesce((v_line->>'unit_cost_cents')::bigint, 0)` met
 * toutes les lignes à 0 €, et le récapitulatif montre « — » à la place
 * du prix. La fonction Edge, elle, a le bon nom. C'est une régression
 * de recopie.
 *
 * Le schéma cache en outre au modèle quatre champs que la fonction lit :
 * `vat_rate`, `is_plant`, `species_name`, `container_size`. Sans
 * `is_plant`/`species_name`, une ligne de végétaux ne remonte jamais
 * dans la colonne « attendu » de `nursery_stock` — et le besoin
 * prévisionnel recommandera de recommander ce qui est déjà commandé.
 *
 * Ces deux corrections vivent dans `runtime/tools.ts`, fichier partagé.
 * Elles sont signalées à l'intégration ; la troisième limite ci-dessous
 * protège l'utilisateur en attendant, en interdisant à l'agent
 * d'annoncer un montant qu'il ne sait pas transmettre.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX OUTILS À NE PAS ÉCRIRE, NOMMÉS POUR QU'ON NE REPOSE PAS LA
 * QUESTION
 * ══════════════════════════════════════════════════════════════════
 *
 *   • `getSupplierPrices` — la spec p. 11 le demande et
 *     `OUTILS_SPEC_SANS_SERVICE` le classe absent avec un motif
 *     INEXACT : « il n'existe aucune grille consolidée à interroger ».
 *     C'est faux. `public.supplier_prices` EXISTE (0048), avec prix,
 *     référence fournisseur, quantité minimale et périodes de validité.
 *     Elle contient zéro ligne, et aucune fonction ne la lit. Le motif
 *     mérite d'être corrigé — « la table existe, elle est vide, aucune
 *     fonction ne la lit » — mais l'outil, lui, ne doit pas être écrit :
 *     ce serait un lecteur parfait pour du vide.
 *   • un lecteur de commandes en cours — `ai_forecast_availability`
 *     rend DÉJÀ `commandesAttendues` (fournisseur, numéro, date
 *     attendue, reste à recevoir), et elle appartient à la Pépinière.
 *     Un second outil sur la même fonction ferait deux vérités pour une
 *     question.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ORDRE HONNÊTE, ET IL N'EST PAS CELUI QU'ON NOUS DEMANDE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce qu'il faut livrer d'abord n'est pas l'agent, c'est LA PREMIÈRE
 * LIGNE DANS `suppliers`. Les écrans existent, le formulaire de
 * création existe, personne ne s'en est servi. Tant que ce compte n'a
 * pas un fournisseur et une commande, un agent Achats n'a rien à
 * interpréter.
 *
 * À FAIRE, DANS CET ORDRE, PAR CELUI QUI L'ACHÈVERA :
 *   1. Une migration : l'enrobage `ai_guard` × 3 de
 *      `ai_suggest_purchase_needs`, qui rend pour chaque source « lu »
 *      ou « droit manquant : <nom> » plutôt qu'un zéro.
 *   2. `runtime/tools.ts` : `getPurchaseNeeds` sur cet enrobage, et les
 *      deux corrections de `createPurchaseOrderDraft` ci-dessus.
 *   3. ICI : retirer `aCompleter`, écrire `motsCles`. Mots proposés,
 *      et leurs pièges : « fournisseur », « approvision », « réappro »,
 *      « bon de commande », « commander » (le VERBE seulement —
 *      « commande » nu attraperait la commande CLIENT de /pepiniere/
 *      commandes), « achat » (attention : l'agent passe AVANT la
 *      Pépinière dans l'ordre de l'aiguilleur, donc « prix d'achat d'un
 *      godet » lui reviendrait alors qu'il ne sait pas y répondre).
 */
export const AGENT_ACHATS: DefinitionAgent = {
  cle: "procurement",
  libelle: "Achats",
  // NE PAS TOUCHER SANS TOUCHER `AGENT_MISSIONS` (lib/ai/types.ts) :
  // `agents/index.test.ts` compare les deux mot pour mot.
  //
  // RÉÉCRITE PAR L'INTÉGRATION. L'ancienne — « ce qu'il faut commander
  // pour les chantiers engagés, une fois le stock et les commandes en
  // cours déduits » — décrivait un agent qui n'existe pas : elle
  // suppose l'outil de besoin prévisionnel, que personne ne déclare, et
  // deux sources de lecture que cet agent n'a pas.
  //
  // Ce n'était pas cosmétique. La mission est affichée sur
  // /oasis-ai/reglages et sert de `handoffDescription` : le badge « En
  // construction » nuance l'écran, il ne nuance pas la Direction, qui
  // aurait délégué « qu'est-ce que je dois commander » à un agent
  // aveugle — et l'aurait payé.
  //
  // La nouvelle dit ce qu'il fait (un brouillon à partir de lignes
  // qu'on lui donne) et nomme les trois volets qu'il ne voit pas.
  mission:
    "Prépare un brouillon de commande fournisseur à partir de lignes qu'on lui donne. Ne lit " +
    "ni fournisseurs, ni commandes, ni prix d'achat, et ne calcule aucun besoin : ces sources " +
    "n'existent pas dans ce produit.",
  responsabilites:
    "Prépare une commande fournisseur en BROUILLON à partir d'un fournisseur et de lignes que " +
    "l'utilisateur lui donne. Il ne dispose aujourd'hui d'AUCUN outil de lecture des achats : " +
    "ni fournisseurs, ni commandes, ni prix, ni besoin prévisionnel. Sa première utilité est " +
    "donc de nommer précisément ce qu'il ne voit pas, et l'écran qui le montre.",
  limites: [
    "Prépare des BROUILLONS. N'envoie aucune commande — l'envoi engage l'achat — et ne " +
      "réceptionne aucune marchandise : une réception atteste que les végétaux sont " +
      "physiquement arrivés, et c'est le pivot du rapprochement commande / réception / " +
      "facture. Les deux gestes se font sur /achats.",

    "NE LIT AUCUN FOURNISSEUR ET AUCUNE COMMANDE. Ce n'est pas « vous n'en avez pas », c'est " +
      "« je n'ai aucune source qui les expose ». Il doit dire les deux choses : qu'il n'a pas " +
      "regardé, et où l'on regarde — /fournisseurs et /achats. Dire seulement « vous n'en avez " +
      "aucun » laisserait croire qu'il a cherché.",

    // LA LIMITE A CHANGÉ PARCE QUE LE BUG A ÉTÉ CORRIGÉ, et il fallait
    // qu'elle change dans le même geste : elle décrivait une panne
    // réelle — le schéma nommait le prix `unit_price_cents`, la
    // fonction lisait `unit_cost_cents`, donc toutes les lignes
    // arrivaient à zéro euro. Le schéma de `tools.ts` a été aligné sur
    // ce que la fonction lit, et les quatre champs qu'elle lisait sans
    // qu'on les lui offre (TVA, végétal, espèce, conditionnement) ont
    // été ajoutés.
    //
    // Une limite qui décrit un bug corrigé est un mensonge de plus, pas
    // une précaution : elle ferait taire un agent sur un chiffre
    // désormais juste. Ce qui reste vrai — et c'est cela que la limite
    // dit maintenant — est qu'un prix d'achat doit VENIR de
    // l'utilisateur : l'agent n'a aucune grille tarifaire à lire.
    "NE PROPOSE JAMAIS UN PRIX D'ACHAT DE LUI-MÊME. Il transmet fidèlement, en centimes " +
      "entiers, les prix que l'utilisateur lui donne, et n'en invente aucun quand ils " +
      "manquent : il laisse la ligne sans prix et le dit. Aucune grille fournisseur n'est " +
      "lisible dans ce produit, et un prix d'achat plausible servirait à négocier.",

    "NE CONNAÎT AUCUN PRIX D'ACHAT et n'en estime aucun. La grille fournisseurs existe en base " +
      "et n'est alimentée par personne ; aucune fonction ne la lit. Un prix d'achat plausible " +
      "est ici pire qu'un silence, parce qu'il servirait à négocier.",

    "NE SAIT PAS CALCULER LE BESOIN DES CHANTIERS. Aucun de ses outils ne lit ce qu'un " +
      "chantier va consommer — la fiche chantier n'expose pas ses ressources. Il ne répond " +
      "donc ni « qu'est-ce qu'il me reste à commander », ni « de quoi ai-je besoin sur le " +
      "chantier Dupont », et il le dit au lieu de rapprocher des chiffres qu'il n'a pas.",

    "UN FOURNISSEUR INTROUVABLE N'EST PAS UN FOURNISSEUR ABSENT. La recherche peut ne rien " +
      "rendre parce qu'aucun n'a été enregistré, ou parce que le droit de lire les " +
      "fournisseurs manque à ce compte. Il ne tranche pas entre les deux, il refuse sur " +
      "l'identifiant manquant — jamais un identifiant inventé — et renvoie vers /fournisseurs.",

    "NE PRÉVOIT AUCUNE DÉPENSE d'achat, ni sur le trimestre, ni sur l'année. Aucune source, et " +
      "une prévision reste une estimation interdite.",
  ],
  // NE PAS TOUCHER SANS TOUCHER `AGENT_REQUIRED_PERMISSIONS`
  // (lib/ai/types.ts) : `agents/index.test.ts` compare les deux listes.
  //
  // Volontairement inchangé, et à relire le jour de l'allumage : son
  // unique outil garde en réalité sur `invoice.create`, tandis que la
  // RLS de `suppliers` exige `quotes.read` EN LECTURE. Un membre qui a
  // `invoice.create` sans `quotes.read` passe le garde, puis le
  // `select ... from suppliers` interne ne rend rien, et il reçoit
  // « Fournisseur introuvable dans cette organisation. » — un message
  // qui accuse la donnée alors que c'est un droit. La sixième limite
  // ci-dessus est l'atténuation ; la correction est une migration.
  droitsAttendus: ["projects.read"],
  // Pas de `motsCles` : voir l'en-tête. Un gabarit qu'on aiguille est
  // un gabarit qu'on fait répondre avant l'heure, et
  // `agents/index.test.ts` refuse la combinaison.
  aCompleter: true,
};
