// Chemins relatifs, et non l'alias `@/` : ce module est atteint par
// `node --test`, qui ne lit pas les `paths` du tsconfig. C'est la même
// contrainte que tout le reste de `lib/ai/runtime`.
import type { Permission } from "../auth/permissions.ts";
import { registreOutils } from "./runtime/tools.ts";

/**
 * §11W — CE QUI SE LIT EN FRANÇAIS DANS UNE INTERFACE FRANÇAISE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Trois écrans affichaient des identifiants techniques anglais dans des
 * phrases françaises : `quotes.edit` et `invoice.create` dans une balise
 * `<code>` au milieu d'une explication, `procurement` en guise de nom
 * d'agent, `URGENT` en badge à côté d'un titre déjà traduit. Un code
 * dans une phrase n'est pas une information de plus : c'est une fuite
 * d'implémentation, et elle coûte une seconde de déchiffrage à chaque
 * lecture, tous les jours.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE REPLI EST TOUJOURS LE CODE BRUT, JAMAIS UN TROU
 * ══════════════════════════════════════════════════════════════════
 *
 * Chaque table ci-dessous rend le code inchangé quand elle ne le
 * connaît pas. C'est délibéré : le jour où une migration ajoute une
 * permission, l'écran affiche `nursery.audit` — laid, mais vrai, et
 * réparable en une ligne. Une table qui renverrait « — » ou
 * « inconnu » ferait disparaître l'information, et personne ne
 * saurait qu'il manque une traduction.
 */

// ==================================================================
// 1. Les permissions
// ==================================================================

/**
 * Ce qu'une permission autorise, dit à la personne qui la détient — ou
 * à qui il faut la demander.
 *
 * Formulées pour tenir dans « Droit exigé : … » et dans « Il vous
 * manque : … ». D'où l'infinitif : « modifier les devis » se lit dans
 * les deux phrases, « Modification des devis » dans aucune.
 */
const PERMISSIONS_FR: Record<Permission, string> = {
  "clients.read": "consulter les clients",
  "clients.write": "créer et modifier les clients",
  "quotes.read": "consulter les devis",
  "quotes.create": "créer des devis",
  "quotes.edit": "modifier les devis",
  "quotes.approve": "valider les devis",
  "projects.read": "consulter les chantiers",
  "projects.manage": "conduire les chantiers",
  "digitalTwin.edit": "modifier les plans de jardin",
  "nursery.stock.manage": "gérer le stock de la pépinière",
  "invoice.create": "créer des factures",
  "organization.manageUsers": "gérer les membres de l'entreprise",
  "biolab.read": "consulter le laboratoire",
  "biolab.write": "saisir au laboratoire",
  "biolab.manage": "gérer le laboratoire",
  "etiquettes.read": "consulter les étiquettes",
  "etiquettes.manage": "poser et imprimer les étiquettes",
};

/** Une permission, en français. Le code brut si elle n'est pas connue. */
export function libellePermission(code: string): string {
  return PERMISSIONS_FR[code as Permission] ?? code;
}

// ==================================================================
// 2. Les agents du catalogue d'actions
// ==================================================================

/**
 * §11Y — `procurement` N'EST PLUS « NON CONSTRUIT ».
 *
 * Le catalogue d'actions nommait `procurement` alors qu'aucun agent
 * Achats n'existait : la ligne y figurait pour déclarer que l'envoi
 * d'une commande existe et qu'il est interdit d'autopilote — déclarer
 * un interdit n'est pas construire ce qu'il interdit. L'étiquette
 * portait donc « (non construit) », et c'était juste.
 *
 * L'agent Achats existe maintenant (0082, `agents/procurement.ts`),
 * encore à l'état de gabarit. Garder la parenthèse ferait dire à
 * l'écran le contraire de ce que l'écran de réglages affiche deux
 * onglets plus loin — et c'est exactement le genre de désaccord entre
 * deux surfaces que ce produit a déjà payé.
 *
 * La table ne liste que les agents qui APPARAISSENT réellement dans
 * `ai_action_catalog` — vérifié en production : `billing`,
 * `quote_pricing`, `executive` et `procurement`, neuf lignes en tout.
 * Les cinq autres agents construits n'y ont aucune ligne, et n'ont pas
 * à en avoir : ils PROPOSENT des brouillons (`PROPOSAL_KINDS`), ils
 * n'exécutent rien. Un nom de plus ici serait une promesse d'action que
 * le moteur ne tient pas.
 *
 * `finance` y figure sans ligne au catalogue, et c'est un reste
 * antérieur : inoffensif, puisque cette table ne fait que traduire une
 * clé rencontrée. On ne le retire pas pour ne pas mêler un nettoyage à
 * ce chantier.
 */
const AGENTS_CATALOGUE_FR: Record<string, string> = {
  executive: "Direction",
  finance: "Finance",
  billing: "Facturation",
  quote_pricing: "Devis & Prix",
  quotePricing: "Devis & Prix",
  procurement: "Achats",
};

export function libelleAgentCatalogue(code: string): string {
  return AGENTS_CATALOGUE_FR[code] ?? code;
}

// ==================================================================
// 3. Les rubriques du briefing
// ==================================================================

/**
 * `URGENT`, `COMMERCIAL`, `FINANCE`, `PLANNING` s'affichaient en badge
 * À CÔTÉ d'un titre déjà en français, où ils ne disaient rien que le
 * titre ne disait pas. Ils deviennent la couleur du filet et, quand il
 * faut un mot, celui-ci.
 */
const RUBRIQUES_FR: Record<string, string> = {
  URGENT: "À traiter aujourd'hui",
  COMMERCIAL: "Commercial",
  FINANCE: "Finance",
  PLANNING: "Planning",
};

export function libelleRubrique(code: string): string {
  return RUBRIQUES_FR[code] ?? code;
}

// ==================================================================
// 4. Les outils : « Données consultées »
// ==================================================================

/**
 * Le nom lisible d'un outil de LECTURE.
 *
 * La clé est le `nom` du registre (`lib/ai/runtime/tools.ts`), pas la
 * fonction SQL : c'est le nom que le catalogue tient pour stable.
 */
const OUTILS_FR: Record<string, string> = {
  searchEntities: "recherche",
  getCompanyMetrics: "chiffres de l'entreprise",
  getMarginBreakdown: "détail des marges",
  analyzeProjectMargin: "marges des chantiers",
  getUnbilledProjects: "chantiers à facturer",
  getQuote: "devis",
  getHistoricalProjectComparisons: "chantiers comparables",
  getDigitalTwinQuantities: "quantités du plan",
  getExecutiveBrief: "briefing de direction",
  getOasisDaily: "briefing du matin",
  getDailyPriorities: "priorités du jour",
  getProjectContext: "chantier",
  getClientContext: "fiche client",
  getNurseryStock: "stock pépinière",
  getProjectedNurseryNeeds: "besoins pépinière à venir",
};

/**
 * CE QU'OASIS A CONSULTÉ POUR RÉPONDRE, en français, sans les écritures.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CETTE FONCTION FERME
 * ══════════════════════════════════════════════════════════════════
 *
 * L'ancien écran affichait le bloc dès que `toolsUsed.length > 0`, puis
 * filtrait sur une table écrite à la main de ONZE entrées, alors que le
 * modèle en appelle une vingtaine. Une réponse obtenue par le seul
 * `getCompanyMetrics` — un cas parfaitement ordinaire — affichait donc,
 * littéralement :
 *
 *     Données consultées : .
 *
 * Deux corrections, et il fallait les deux. D'abord la liste part du
 * REGISTRE et non d'une copie : un outil ajouté demain apparaît, sous
 * son nom technique au pire, jamais escamoté. Ensuite l'appelant ne
 * décide plus d'afficher le bloc en comptant les outils bruts — il
 * compte ce que CETTE fonction rend, et une liste vide ne se rend pas.
 *
 * ─── POURQUOI LES ÉCRITURES SONT EXCLUES ───
 *
 * « Données consultées » répond à « sur quoi s'appuie cette réponse ».
 * Une proposition de devis n'est pas une source ; l'annoncer comme telle
 * ferait croire qu'Oasis a lu quelque chose qu'il n'a fait qu'écrire.
 * Ce que la réponse PROPOSE s'affiche ailleurs, en carte, avec son
 * bouton.
 *
 * ─── `null` ET `[]` NE SONT PAS LA MÊME CHOSE ───
 *
 * `null` = on ne sait pas quels outils (message ancien, colonne jamais
 * remplie) : l'écran se tait. `[]` = le modèle n'a rien lu : l'écran
 * peut le dire. La distinction vient de la base et survit jusqu'ici.
 */
export function donneesConsultees(outils: readonly string[] | null): string[] {
  if (outils === null) return [];

  const registre = registreOutils();
  const parRpc = new Map<string, string>();
  for (const outil of registre.tous()) {
    if (outil.famille !== "lecture") continue;
    // `rpc` est optionnel dans le type — il n'existe que pour la
    // famille `lecture`, que le filtre ci-dessus garantit déjà. On le
    // vérifie quand même plutôt que d'affirmer : un outil de lecture
    // sans fonction SQL serait une erreur de déclaration, pas une
    // raison de planter l'affichage d'une réponse.
    if (outil.rpc) parRpc.set(outil.rpc, outil.nom);
    // Le nom, aussi : la fonction Edge historique journalisait le nom
    // d'outil là où le runtime journalise la fonction SQL. Les deux
    // formes cohabitent dans les fils déjà écrits.
    parRpc.set(outil.nom, outil.nom);
  }

  const libelles: string[] = [];
  for (const brut of new Set(outils)) {
    const nom = parRpc.get(brut);
    // Un outil inconnu du registre est soit une écriture, soit un outil
    // retiré. Dans les deux cas il n'a rien à faire dans « données
    // consultées » : on l'écarte plutôt que d'afficher un identifiant.
    if (nom === undefined) continue;
    const libelle = OUTILS_FR[nom] ?? nom;
    if (!libelles.includes(libelle)) libelles.push(libelle);
  }

  return libelles;
}
