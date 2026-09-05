import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * LES OUTILS DE LA PÉPINIÈRE QUI RESTENT À BRANCHER.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST IMPORTÉ PAR
 * PERSONNE
 * ══════════════════════════════════════════════════════════════════
 *
 * `runtime/tools.ts` est un fichier PARTAGÉ, et la règle de ce chantier
 * est qu'une seule main l'écrit à la fois : plusieurs agents sont
 * construits en parallèle, et deux ajouts simultanés dans le même
 * tableau littéral détruisent l'un des deux en silence.
 *
 * Les déclarations ci-dessous sont donc écrites ICI, complètes et
 * éprouvées (`nursery.test.ts`), et l'intégration les recopie dans le
 * registre — `OUTILS_LECTURE` pour la première, `OUTILS_PROPOSITION`
 * pour les deux suivantes. Elles portent le type `OutilOasis` : si le
 * registre change de forme, ce fichier ne compile plus, et le décalage
 * se voit à la compilation plutôt qu'à l'exécution.
 *
 * TANT QU'ELLES NE SONT PAS RECOPIÉES, L'AGENT PÉPINIÈRE NE LES A PAS,
 * et ses limites (`agents/nursery.ts`) disent exactement cela. Un
 * fichier d'outils qui n'est pas branché n'est pas une capacité : c'est
 * une capacité PRÊTE. La différence tient dans ce que l'agent promet, et
 * il ne promet rien de tout ceci.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI N'EST PAS ICI, ET POURQUOI
 * ══════════════════════════════════════════════════════════════════
 *
 *   • `getNurseryLosses` (`ai_analyze_nursery_losses`) — la fonction
 *     existe et elle est correcte. Elle n'est PAS déclarée pour une
 *     raison de doublon, pas de vide : `pro_analytics_nursery` rend
 *     déjà `loss_rate_percent`, et deux outils qui répondent à
 *     « est-ce que je perds du stock ? » sont deux vérités pour une
 *     question — le défaut que l'en-tête de `tools.ts` décrit. Le jour
 *     où /pepiniere/sante sera réellement utilisé, la question à poser
 *     sera « le détail par espèce mérite-t-il un second outil ? », et
 *     elle se posera une seule fois.
 *   • `getPurchaseNeeds` (`ai_suggest_purchase_needs`) — arbitrage non
 *     tranché entre la Pépinière et les Achats, et surtout fonction non
 *     déclarable en l'état : elle traverse trois RLS et convertit un
 *     droit manquant en zéro. Voir l'en-tête de `agents/procurement.ts`,
 *     qui porte la démonstration complète.
 *   • un lecteur de réservations — `nursery_reservations` contient bien
 *     le bénéficiaire, et AUCUNE fonction `ai_*` ne l'expose. Écrire la
 *     fonction sortirait du périmètre d'un constructeur d'agent
 *     (migration), et l'absence est nommée dans les limites de l'agent.
 */

/**
 * LES ONZE GRANDEURS DE LA PÉPINIÈRE, DÉJÀ CALCULÉES EN BASE.
 *
 * ─── CE QU'ELLE APPORTE QUE LES DEUX AUTRES N'ONT PAS ───
 *
 * `available_stock` est la SEULE des trois définitions de « disponible »
 * qui exige à la fois le statut du lot ET un stade de culture vendable.
 * C'est donc elle qui RÉCONCILIE la contradiction que l'agent doit
 * annoncer : sur le lot mesuré en production, `ai_find_stock` dit
 * « disponible 20 », `ai_forecast_availability` dit « non vendable »,
 * et celle-ci dit « 0 » — c'est-à-dire « rien à vendre aujourd'hui »,
 * la réponse que le pépiniériste cherchait. Elle n'ajoute pas une
 * quatrième vérité, elle tranche entre les deux premières.
 *
 * ─── POURQUOI SA DÉCLARATION N'AJOUTE AUCUNE AFFIRMATION NOUVELLE ───
 *
 * `pro_analytics_nursery` est DÉJÀ affichée aux humains sur /analytics
 * (`app/(app)/analytics/page.tsx`). Le modèle ne reçoit donc rien que
 * l'écran ne montre ; il l'interprète, ce qui est exactement la
 * frontière des pages 11-12.
 *
 * ─── LA RÉSERVE, ET ELLE EST RÉELLE ───
 *
 * `permission` ne porte qu'UNE valeur, et cette fonction traverse DEUX
 * droits : `nursery.stock.manage` (les lots, les mouvements, les
 * emplacements — le gros de la sortie) et `quotes.read` (le catalogue
 * et la grille tarifaire, dont vient la valorisation). On déclare le
 * premier, qui gouverne neuf des onze grandeurs.
 *
 * L'effet d'un `quotes.read` manquant est BORNÉ, et c'est ce qui rend
 * le compromis acceptable : la valorisation ne tombe pas à « 0 € » nu,
 * elle bascule dans `unpriced_lots`. La sortie dit alors « 0 lot
 * valorisé, N sans prix » — une phrase qui reste vraie de forme (le
 * modèle ne peut pas les valoriser) même quand la cause est un droit et
 * non une donnée absente. La confusion subsistante est « aucun de vos
 * lots n'a de prix » là où il faudrait « je ne peux pas voir vos
 * prix » ; elle fait chercher une saisie déjà faite, elle ne fait pas
 * acheter ni vendre. À corriger le jour où `OutilOasis` saura porter
 * plusieurs permissions.
 *
 * ─── LA FORME DU RETOUR ───
 *
 * Elle rend une TABLE (`returns table (...)`) et non du `jsonb` : le
 * lecteur reçoit un tableau d'une ligne, là où les autres outils de
 * pépinière rendent un objet. `elaguer()` le supporte. `maxElements`
 * est donc inutile — il n'y a jamais qu'une ligne.
 */
export const OUTIL_ANALYTIQUE_PEPINIERE: OutilOasis = {
  nom: "getNurseryAnalytics",
  famille: "lecture",
  agent: "nursery",
  rpc: "pro_analytics_nursery",
  injecteOrganisation: true,
  permission: "nursery.stock.manage",
  permissionSource: "rls",
  risque: "low",
  confirmationRequise: false,
  // Pas « prix » : la valorisation est un montant de stock, pas un prix
  // de vente proposé. Revendiquer « prix » ferait de cet outil une
  // source de tarification, ce qu'il n'est pas.
  fournit: ["stock", "quantites"],
  description:
    "Les onze indicateurs de la pépinière, déjà calculés : valeur du stock en centimes, lots " +
    "valorisés et lots sans prix, stock RÉELLEMENT vendable (statut disponible ET stade " +
    "vendable), valeur en production, taux de perte, rotation, lots dormants et leur " +
    "quantité, occupation des emplacements, rendement de production. Une grandeur à « null » " +
    "veut dire « pas calculable », jamais « zéro ».",
  parametres: z.object({
    p_from: z.string().nullable().describe("Début de période, AAAA-MM-JJ. Null = les défauts de la base."),
    p_to: z.string().nullable().describe("Fin de période, AAAA-MM-JJ. Null = aujourd'hui."),
  }),
};

/**
 * LES DEUX ÉCRITURES, DÉJÀ CÂBLÉES DERRIÈRE UN CLIC.
 *
 * Il n'y a RIEN à écrire côté écriture : `lib/ai/proposals.ts` connaît
 * déjà `createNurseryLot` → `ai_create_nursery_lot` et
 * `recordStockMovement` → `ai_record_stock_movement`, avec leur
 * permission, leur récapitulatif en français et leur effet annoncé.
 * Seule la DÉCLARATION au registre manque, et la voici.
 *
 * Le champ `rpc` est volontairement absent : la famille `proposition`
 * n'en porte pas, pour que le registre ne puisse pas appeler une
 * fonction d'écriture même par erreur de programmation. La
 * correspondance vit dans `proposals.ts`, derrière l'approbation.
 *
 * ══════════════════════════════════════════════════════════════════
 * BRANCHER CES DEUX-LÀ OBLIGE À RÉÉCRIRE UNE LIMITE DE L'AGENT
 * ══════════════════════════════════════════════════════════════════
 *
 * `agents/nursery.ts` dit aujourd'hui, en première limite, « N'ÉCRIT
 * RIEN, et ne propose rien à écrire ». C'est vrai tant que ces deux
 * outils ne sont pas au registre, et cela deviendrait FAUX le jour où
 * ils y entrent — une instruction qui interdit à l'agent d'employer un
 * outil qu'on vient de lui donner. `nursery.test.ts` défend le lien :
 * il échoue si le registre offre une proposition à la Pépinière pendant
 * que la limite dit le contraire. La contradiction ne peut donc pas
 * être introduite en silence.
 */
export const OUTILS_PROPOSITION_PEPINIERE: readonly OutilOasis[] = Object.freeze([
  {
    nom: "createNurseryLot",
    famille: "proposition",
    agent: "nursery",
    injecteOrganisation: true,
    permission: "nursery.stock.manage",
    permissionSource: "aiGuard",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    description:
      "PROPOSE la création d'un lot de pépinière. N'exécute rien : l'utilisateur relit le " +
      "récapitulatif et clique. La quantité entrera par un mouvement de réception, pour que " +
      "le journal du lot commence par son origine.",
    parametres: z.object({
      p_species_name: z.string().describe("Nom de l'espèce. Obligatoire."),
      p_initial_quantity: z.number().int().describe("Nombre de sujets à l'entrée."),
      p_lot_code: z.string().nullable().describe("Code du lot. Null = numéroté par Oasis."),
      p_cultivar: z.string().nullable(),
      p_container_size: z.string().nullable().describe("Conditionnement : godet, C3, C10…"),
      p_stage_id: z.string().nullable().describe("Identifiant du stade de culture (UUID)."),
      p_location_id: z.string().nullable().describe("Identifiant de l'emplacement (UUID)."),
      p_supplier_id: z.string().nullable().describe("Identifiant du fournisseur d'origine (UUID)."),
      p_notes: z.string().nullable(),
    }),
  },
  {
    nom: "recordStockMovement",
    famille: "proposition",
    agent: "nursery",
    injecteOrganisation: true,
    permission: "nursery.stock.manage",
    permissionSource: "aiGuard",
    risque: "medium",
    confirmationRequise: true,
    fournit: [],
    // VENDRE ET AJUSTER UN INVENTAIRE SONT EXCLUS, et le sont déjà côté
    // base : une vente est une sortie commerciale, un ajustement
    // d'inventaire est une attestation de comptage. Les deux se
    // constatent, elles ne se proposent pas. Le dire dans la
    // description évite que le modèle les tente et se fasse refuser
    // après avoir fait espérer.
    description:
      "PROPOSE un mouvement de stock sur un lot : réception, rempotage, réservation, perte ou " +
      "transfert. N'exécute rien. NE SERT NI À VENDRE NI À AJUSTER UN INVENTAIRE : ces deux " +
      "gestes restent des saisies humaines sur /pepiniere/lots.",
    parametres: z.object({
      p_lot_id: z.string().describe("Identifiant du lot (UUID). À trouver avec searchEntities."),
      p_kind: z.string().describe("receive, repot, reserve, loss ou transfer."),
      p_quantity: z.number().int().describe("Nombre de sujets concernés."),
      p_to_location_id: z.string().nullable().describe("Emplacement d'arrivée pour un transfert (UUID)."),
      p_reason: z.string().nullable().describe("Motif, indispensable pour une perte."),
    }),
  },
]);

/**
 * LE DROIT QUE CHAQUE OUTIL DE PÉPINIÈRE DOIT PORTER — ET POURQUOI.
 *
 * ══════════════════════════════════════════════════════════════════
 * CETTE LISTE ÉTAIT UNE DETTE. ELLE EST DEVENUE UNE GARANTIE
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle s'appelait `CORRECTIONS_ATTENDUES_TOOLS` et nommait un défaut
 * que son auteur ne pouvait pas corriger : les deux outils déclaraient
 * `permission: null` dans `runtime/tools.ts`, fichier partagé et hors
 * de son périmètre. L'intégration a posé les deux permissions.
 *
 * Une liste de corrections faites qui resterait une liste de
 * corrections À FAIRE deviendrait fausse à l'envers — le pire état d'un
 * pense-bête, parce qu'il continue d'avoir l'air utile. Elle change
 * donc de sens plutôt que de disparaître : elle dit maintenant ce que
 * chaque outil DOIT porter, et `nursery.test.ts` le vérifie contre le
 * registre réel. Le jour où quelqu'un retire l'un des deux droits — en
 * « simplifiant », ou en recopiant un outil voisin — le test tombe.
 *
 * ─── POURQUOI CE DROIT-LÀ, ET PAS LA RLS SEULE ───
 *
 * Les six tables `nursery_*` sont sous
 * `has_permission(organization_id, 'nursery.stock.manage')`, et les
 * deux fonctions sont `security invoker` SANS `ai_guard` : elles
 * finissent par `coalesce(jsonb_agg(...), '[]')`. Un membre sans le
 * droit ne reçoit donc pas un refus, il reçoit UNE LISTE VIDE —
 * indiscernable d'une pépinière vide. Mesuré en production sur le même
 * lot réel, à deux comptes : le propriétaire voit 40 rosiers, le membre
 * à droits réduits voit `[]`.
 *
 * Déclarer la permission produit deux effets, et le second compte
 * autant que le premier : l'outil n'est plus offert à qui ne peut pas
 * le lire, et `refusesPourAgent` NOMME le droit manquant. L'agent dit
 * « il vous manque le droit de stock » au lieu de « vous n'avez rien ».
 */
export const DROITS_EXIGES_OUTILS_PEPINIERE: readonly {
  outil: string;
  permission: string;
  pourquoi: string;
}[] = Object.freeze([
  {
    outil: "getNurseryStock",
    permission: "nursery.stock.manage",
    pourquoi:
      "`ai_find_stock` lit la vue `nursery_stock` (security_invoker) et la table " +
      "`nursery_lots`, toutes deux sous `has_permission(organization_id, " +
      "'nursery.stock.manage')`. Sans le droit, elle rend `[]` et non un refus.",
  },
  {
    outil: "getProjectedNurseryNeeds",
    permission: "nursery.stock.manage",
    pourquoi:
      "`ai_forecast_availability` lit `nursery_lots` et `nursery_stages`, tous deux sous le " +
      "même droit. Sans lui, `enProduction` est vide et se lit « rien en production ».",
  },
]);
