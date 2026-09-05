import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AGENT_ACHATS } from "./procurement.ts";
import { registreOutils } from "../tools.ts";

/**
 * CE QUE L'AGENT ACHATS DOIT TENIR — Y COMPRIS SON EXTINCTION.
 *
 * ══════════════════════════════════════════════════════════════════
 * ÉPROUVER UN AGENT QU'ON A DÉCIDÉ DE NE PAS ALLUMER
 * ══════════════════════════════════════════════════════════════════
 *
 * Un agent laissé en gabarit n'est pas un agent qu'on a oublié : c'est
 * une décision, et une décision se défend. Trois choses peuvent
 * l'annuler en silence :
 *
 *   • quelqu'un lui donne des mots-clés, et il se met à répondre
 *     pauvrement à des questions qui allaient bien ailleurs ;
 *   • quelqu'un déclare `ai_suggest_purchase_needs` sans l'enrobage de
 *     droits, et l'agent se met à recommander des achats faux ;
 *   • quelqu'un corrige le nom de champ de `createPurchaseOrderDraft`
 *     sans que personne ne relise la limite écrite pour le compenser.
 *
 * Les trois échouent ici. Deux de ces tests sont FAITS POUR ÉCHOUER un
 * jour : c'est ainsi qu'un défaut nommé se distingue d'un défaut
 * masqué.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n");
}

const limites = AGENT_ACHATS.limites.join("\n").toLowerCase();

// ==================================================================
// 1. LA DÉCISION : IL RESTE ÉTEINT, ET IL LE RESTE POUR UNE RAISON
// ==================================================================

test("l'agent Achats n'a AUCUNE source de lecture, et c'est ce qui le garde en gabarit", () => {
  // MESURÉ, PAS SUPPOSÉ. Il possède un seul outil, `createPurchaseOrderDraft`,
  // et c'est une PROPOSITION. Les trois transverses qui lui restent ne
  // rendent ni fournisseur utile, ni commande, ni besoin :
  // `ai_get_project_context` n'expose pas `project_resources`.
  //
  // Un agent allumé dans cet état paie un raisonnement complet pour
  // produire une phrase polie. Le jour où ce test échoue, l'agent a de
  // la matière : c'est le signal pour retirer `aCompleter` et lui
  // écrire ses mots-clés.
  const registre = registreOutils();
  const lectures = registre
    .tous()
    .filter((o) => o.agent === "procurement" && o.famille === "lecture");

  assert.equal(
    lectures.length,
    0,
    `les Achats ont maintenant ${lectures.length} source(s) de lecture (${lectures
      .map((o) => o.nom)
      .join(", ")}) : l'agent a de la matière, achevez-le`,
  );
});

test("un gabarit n'attrape pas de question libre", () => {
  // La règle est déjà tenue globalement par `agents/index.test.ts` ;
  // elle est reprise ici parce que c'est SUR CET AGENT qu'elle est
  // tentante à enfreindre — « fournisseur » et « commander » sont des
  // mots évidents, et l'agent qui les recevrait n'aurait rien à lire.
  assert.equal(AGENT_ACHATS.aCompleter, true);
  assert.equal(AGENT_ACHATS.motsCles, undefined);
});

test("la fonction qui allumerait cet agent existe en base et n'est déclarée nulle part", () => {
  // CE TEST EST FAIT POUR ÉCHOUER LE JOUR OÙ QUELQU'UN LA DÉCLARE, et
  // c'est exactement ce qu'on veut : `ai_suggest_purchase_needs` est
  // `security invoker` et traverse TROIS RLS —
  // `project_resources`/projects.read, `nursery_stock`/nursery.stock.manage,
  // et la branche « expected » de cette vue /invoice.create. Son SQL
  // soude les trois avec des `coalesce(..., 0)` et un `left join` : un
  // droit qui manque ne fait pas échouer la fonction, il fait tomber
  // une branche à zéro, et produit trois faux plausibles dans trois
  // directions différentes.
  //
  // `OutilOasis.permission` ne porte qu'UNE permission : choisir l'une
  // des trois ne réduit pas le risque, elle le déplace. Il faut un
  // enrobage SQL qui `ai_guard` les trois et NOMME celle qui manque.
  // L'échec de ce test doit conduire à relire l'en-tête de
  // `agents/procurement.ts` avant de le mettre à jour.
  const sql = migrations();
  assert.ok(
    sql.includes("function public.ai_suggest_purchase_needs("),
    "la fonction a disparu : l'agent Achats n'a plus aucune perspective",
  );

  const registre = registreOutils();
  const declaree = registre.tous().find((o) => o.rpc === "ai_suggest_purchase_needs");
  assert.equal(
    declaree,
    undefined,
    "`ai_suggest_purchase_needs` est déclarée au registre : sans enrobage de droits, elle " +
      "recommande d'acheter du stock qu'on a déjà, ou rend [] qui se lit « rien à commander »",
  );
});

// ==================================================================
// 2. LE BUG D'ÉCRITURE — corrigé, et défendu champ par champ
// ==================================================================

test("le brouillon de commande offre au modèle EXACTEMENT les champs que la base lit", () => {
  // ══════════════════════════════════════════════════════════════
  // LE BUG QUE CE TEST TENAIT EST CORRIGÉ. IL DÉFEND MAINTENANT
  // TOUTE LA CLASSE, ET PAS SEULEMENT LE CAS QUI A ÉTÉ TROUVÉ
  // ══════════════════════════════════════════════════════════════
  //
  // CE QUI ÉTAIT CASSÉ, EN PRODUCTION : le schéma nommait le prix
  // `unit_price_cents`, `ai_create_purchase_order_draft` lisait
  // `coalesce((v_line ->> 'unit_cost_cents')::bigint, 0)`. La clé que
  // le modèle remplissait n'était lue par personne, le `coalesce` la
  // remplaçait par zéro, et TOUTES les lignes du brouillon — plus le
  // total de la commande — valaient 0 €. Rien ne le signalait : la
  // proposition s'affichait, complète, à zéro euro. Quatre autres
  // champs que la fonction lit — `vat_rate`, `is_plant`,
  // `species_name`, `container_size` — n'étaient pas offerts du tout,
  // et sans les deux du milieu une ligne de végétaux ne remonte jamais
  // dans la colonne « attendu » du stock.
  //
  // POURQUOI CE TEST COMPARE LES DEUX LISTES AU LIEU DE VÉRIFIER UN
  // NOM : un test qui aurait cherché « unit_cost_cents » serait passé
  // au vert et n'aurait rien dit des quatre champs manquants. Une
  // divergence de schéma est SILENCIEUSE par nature — le `->>` de
  // Postgres rend NULL sur une clé absente, jamais une erreur — donc
  // le seul test utile est celui qui confronte l'ensemble des clés.
  // Il vaut aussi pour `createNurseryLot` et `recordStockMovement` le
  // jour où ils seront branchés.
  const outil = registreOutils().chercher("createPurchaseOrderDraft");
  assert.notEqual(outil, null);

  const champsDuModele = new Set(nomsDeChamps(outil?.parametres));

  // Les clés que la fonction lit dans CHAQUE LIGNE, extraites du SQL
  // plutôt que recopiées : une liste écrite à la main ici serait la
  // troisième vérité sur le même sujet.
  //
  // L'EXTRACTION EST BORNÉE AU CORPS DE CETTE FONCTION-LÀ, et ce n'est
  // pas un détail de mise en œuvre : `v_line` est le nom de variable
  // habituel de ce dépôt, et `ai_create_quote_draft` s'en sert aussi —
  // avec `unit_sale_price_cents`, qui n'a rien à faire sur une commande
  // FOURNISSEUR. Balayer toutes les migrations mélangeait les deux et
  // exigeait du schéma d'achat un champ de vente.
  const corps = corpsDeFonction("ai_create_purchase_order_draft");
  const lues = new Set([...corps.matchAll(/v_line\s*->>\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(lues.size >= 6, "aucune clé de ligne trouvée dans le SQL : l'extraction a changé");

  for (const clef of lues) {
    assert.ok(
      champsDuModele.has(clef),
      `la fonction lit « ${clef} » et le schéma ne l'offre pas au modèle : le champ arrivera ` +
        "NULL (donc zéro après coalesce) sans qu'aucune erreur ne soit levée",
    );
  }

  // ET DANS L'AUTRE SENS, qui est le sens du bug d'origine : un champ
  // que le modèle remplit et que personne ne lit est du travail jeté.
  assert.ok(
    !champsDuModele.has("unit_price_cents"),
    "`unit_price_cents` est de retour dans le schéma : la fonction lit `unit_cost_cents`, " +
      "donc toutes les lignes repartiraient à zéro euro",
  );

  // La limite de l'agent a suivi la correction. Une limite qui décrit
  // un bug corrigé est un mensonge de plus, pas une précaution : elle
  // ferait taire l'agent sur un chiffre désormais juste.
  assert.ok(
    !limites.includes("n'annonce jamais un montant"),
    "la limite décrit encore le bug des lignes à zéro euro, qui est corrigé",
  );
  assert.ok(
    limites.includes("ne propose jamais un prix d'achat"),
    "ce qui reste vrai — l'agent n'a aucune grille tarifaire à lire — n'est plus dit",
  );
});

/**
 * Le corps d'UNE fonction SQL, isolé de toutes les migrations.
 *
 * On découpe du `create ... function public.<nom>(` jusqu'au prochain
 * `create ... function` — grossier mais suffisant, et surtout SÛR dans
 * le sens qui compte : jamais trop peu. Un découpage trop large ferait
 * échouer le test (une clé étrangère à la fonction serait exigée du
 * schéma), un découpage trop étroit le ferait passer à tort. Le test
 * ci-dessus vérifie d'ailleurs qu'au moins six clés ont été trouvées,
 * ce qui attrape le cas où le découpage rendrait une chaîne vide.
 */
function corpsDeFonction(nom: string): string {
  const sql = migrations();
  const debut = sql.indexOf(`function public.${nom}(`);
  assert.notEqual(debut, -1, `« ${nom} » n'est définie dans aucune migration`);
  const suivante = sql.slice(debut + 1).search(/create\s+(?:or\s+replace\s+)?function\s+public\./);
  return suivante === -1 ? sql.slice(debut) : sql.slice(debut, debut + 1 + suivante);
}

/**
 * Les noms de champs d'un schéma Zod, à plat.
 *
 * On inspecte le SCHÉMA plutôt que le texte du fichier : un test qui
 * lit `tools.ts` avec une expression régulière casse au premier
 * reformatage, et il ne dirait rien du schéma réellement offert au
 * modèle.
 */
function nomsDeChamps(schema: unknown): readonly string[] {
  const noms: string[] = [];
  const visiter = (n: unknown, profondeur: number) => {
    if (n === null || typeof n !== "object" || profondeur > 6) return;
    const forme = (n as { shape?: Record<string, unknown> }).shape;
    if (forme !== undefined) {
      for (const [cle, valeur] of Object.entries(forme)) {
        noms.push(cle);
        visiter(valeur, profondeur + 1);
      }
      return;
    }
    // Un tableau ou un facultatif : on descend dans ce qu'il enveloppe.
    // `def.type` est une CHAÎNE (« array », « nullable »), pas un
    // nœud : on ne la suit pas.
    const def = (n as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (def === undefined) return;
    for (const cle of ["element", "innerType"]) {
      if (def[cle] !== undefined) visiter(def[cle], profondeur + 1);
    }
  };
  visiter(schema, 0);
  return noms;
}

// ==================================================================
// 3. LES LIMITES — les trois volets vides sont nommés, un par un
// ==================================================================

test("les trois volets que la spec lui donne sont nommés, y compris ceux qui sont vides", () => {
  // La spec p. 11-12 lui donne « fournisseurs, commandes, besoins
  // prévisionnels ». Aucun des trois n'a d'outil de lecture. Un agent
  // partiel qui tairait la moitié manquante serait exactement la
  // façade que ce produit vient de payer : l'utilisateur croirait
  // qu'Oasis a regardé.
  for (const [volet, motif] of [
    ["les fournisseurs", /fournisseur/],
    ["les commandes", /commande/],
    ["le besoin des chantiers", /besoin des chantiers/],
    ["les prix d'achat", /prix d'achat/],
  ] as const) {
    assert.match(limites, motif, `l'agent ne dit pas qu'il ne voit pas ${volet}`);
  }
});

test("une recherche sans résultat n'est pas une absence de fournisseur", () => {
  // Le piège est double, et il faut les deux moitiés : `suppliers` est
  // vide ET sa RLS exige `quotes.read` en lecture, tandis que l'outil
  // d'écriture garde sur `invoice.create`. Un membre qui a l'un sans
  // l'autre reçoit « Fournisseur introuvable dans cette
  // organisation. » — un message qui accuse la donnée alors que c'est
  // un droit.
  assert.ok(
    limites.includes("introuvable") && limites.includes("absent"),
    "l'agent doit distinguer « aucun n'a été enregistré » de « je n'ai pas le droit de les voir »",
  );
});

test("les gestes interdits par 0069 sont refusés nommément", () => {
  // L'envoi engage l'achat ; la réception atteste que la marchandise
  // est physiquement arrivée, et c'est le pivot du rapprochement
  // commande / réception / facture. Les deux sont fermés côté base ; il
  // faut qu'ils le soient aussi côté phrase, avec l'écran qui les fait.
  assert.match(limites, /brouillon/);
  assert.match(limites, /envoie aucune commande/);
  assert.match(limites, /réceptionne aucune marchandise/);
  assert.match(limites, /\/achats/);
});

test("aucune limite ne contient un chiffre : une limite est une règle, pas une mesure", () => {
  // Même discipline que pour la Pépinière : `limites` part mot pour mot
  // dans l'instruction, pour TOUTES les entreprises. « vous n'avez
  // aucun fournisseur » est vrai de l'organisation mesurée et faux de
  // la suivante. Les mesures sont dans l'en-tête, datées.
  for (const limite of AGENT_ACHATS.limites) {
    assert.ok(!/\d/.test(limite), `une limite porte un chiffre : « ${limite} »`);
  }
});
