import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OUTIL_CUSTOMER_VALUE } from "./customer.ts";
import { registreOutils } from "../tools.ts";
import { AGENTS_CONSTRUITS } from "../agents/index.ts";
import type { Permission } from "../../../auth/permissions.ts";

/** Tous les droits, pour isoler le filtre de PROPRIÉTÉ de celui des droits. */
const TOUS_LES_DROITS: Permission[] = [
  "clients.read",
  "clients.write",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.approve",
  "projects.read",
  "projects.manage",
  "digitalTwin.edit",
  "nursery.stock.manage",
  "invoice.create",
  "organization.manageUsers",
];

/**
 * L'OUTIL DE VALEUR CLIENT, ÉPROUVÉ AVANT D'ÊTRE BRANCHÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * ÉPROUVER UN OUTIL QUI N'EST PAS ENCORE AU REGISTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'est importé par personne : `runtime/tools.ts` est partagé et
 * l'intégration l'y recopiera. Un objet qui n'est jamais exécuté est
 * précisément celui qu'il faut éprouver AVANT.
 *
 * La règle « aucun outil déclaré dont la fonction SQL n'existe pas » se
 * vérifie normalement contre `supabase/migrations`. Elle ne le peut pas
 * encore : la fonction vit dans `outils/customer.sql` en attendant que
 * l'intégration la verse dans 0082. Le test relit donc le fichier `.sql`
 * voisin — même garantie au stade où nous sommes — et relit AUSSI les
 * migrations, pour que la vérification bascule toute seule le jour de
 * l'intégration.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

function sourceSql(): string {
  return readFileSync(join(ici, "customer.sql"), "utf8");
}

/**
 * L'épreuve, lue COMME POSTGRES LA LIT.
 *
 * Dans un littéral SQL une apostrophe s'écrit doublée : le fichier porte
 * « il n''a pas payé », et la phrase que le lecteur voit est « il n'a
 * pas payé ». Un test qui chercherait la seconde dans le premier
 * échouerait sur une convention d'échappement plutôt que sur un défaut —
 * et on la corrigerait en affaiblissant l'expression cherchée, ce qui
 * est exactement la mauvaise correction.
 */
function sourceEpreuve(): string {
  return readFileSync(join(ici, "customer.epreuve.sql"), "utf8").replaceAll("''", "'");
}

function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n");
}

// ==================================================================
// 1. LA RÈGLE QUI TIENT TOUT LE REGISTRE
// ==================================================================

test("l'outil nomme une fonction réellement écrite", () => {
  assert.equal(OUTIL_CUSTOMER_VALUE.rpc, "ai_customer_value");
  assert.ok(
    sourceSql().includes("create or replace function public.ai_customer_value("),
    "`ai_customer_value` n'est définie nulle part dans outils/customer.sql",
  );
});

test("et le jour où l'intégration la verse dans une migration, le nom colle encore", () => {
  const sql = migrations();
  if (!sql.includes("function public.ai_customer_value(")) return;
  assert.ok(
    sql.includes("create or replace function public.ai_customer_value("),
    "`ai_customer_value` est citée par une migration sans y être définie",
  );
});

test("l'organisation vient de la LIGNE, pas d'un paramètre ni du modèle", () => {
  // `injecteOrganisation: false` comme `getQuote` et `getProjectContext` :
  // la fonction relit l'organisation sur la ligne du client (règle n° 1
  // de 0073). On ne peut pas se tromper d'entreprise sur un paramètre
  // qui n'existe pas — et le modèle n'en a aucun à remplir.
  assert.equal(OUTIL_CUSTOMER_VALUE.injecteOrganisation, false);

  const champs = Object.keys(
    (OUTIL_CUSTOMER_VALUE.parametres as unknown as { shape: Record<string, unknown> }).shape,
  );
  assert.deepEqual(champs, ["p_customer_id"]);
  assert.ok(!JSON.stringify(champs).includes("organization"));

  // Et la fonction relit bien l'organisation plutôt que de la recevoir.
  //
  // C'est la SIGNATURE qu'on relit, pas le fichier entier : l'en-tête
  // explique justement pourquoi `p_organization_id` est absent, et un
  // test qui chercherait ce mot partout échouerait sur le commentaire
  // qui le défend.
  const sql = sourceSql();
  assert.match(
    sql,
    /create or replace function public\.ai_customer_value\(p_customer_id uuid\)/,
    "la signature accepte autre chose que le seul identifiant du client",
  );
  const corps = sql.slice(sql.indexOf("create or replace function"));
  assert.ok(
    !corps.includes("p_organization_id"),
    "la fonction manipule une organisation reçue en argument : le modèle pourrait en nommer une autre",
  );
  assert.match(corps, /raise exception 'Client introuvable ou inaccessible\.'/);
});

test("il appartient aux Clients, en lecture seule", () => {
  assert.equal(OUTIL_CUSTOMER_VALUE.agent, "customer");
  assert.equal(OUTIL_CUSTOMER_VALUE.famille, "lecture");
  assert.equal(OUTIL_CUSTOMER_VALUE.confirmationRequise, false);
  assert.equal(OUTIL_CUSTOMER_VALUE.actionType, undefined);
});

// ==================================================================
// 2. TROIS DROITS, PAS UN — le piège de cet outil
// ==================================================================

test("la permission déclarée est celle qui fait ÉCHOUER l'appel, pas celles qui l'amputent", () => {
  // Le champ `permission` sert à ne pas offrir au modèle un outil qui
  // échouera : `pourAgent` le retire quand le droit manque. Un seul
  // droit fait échouer l'appel entier — `clients.read`, le seul qui
  // passe par `ai_guard`, donc le seul qui lève.
  //
  // Déclarer `invoice.create` ici retirerait l'outil à un chargé de
  // clientèle qui a de bonnes raisons de consulter la fiche sans voir
  // l'argent — alors que la fonction sait très bien lui répondre en
  // nommant ce qu'elle ne peut pas lui montrer.
  assert.equal(OUTIL_CUSTOMER_VALUE.permission, "clients.read");
  assert.equal(OUTIL_CUSTOMER_VALUE.permissionSource, "aiGuard");
});

test("la fonction vérifie les trois autres droits AVANT de lire, et les nomme", () => {
  // LE TEST LE PLUS IMPORTANT DE CE FICHIER.
  //
  // Les tables traversées ne sont pas sous le même droit :
  // `crm_customers` sous `clients.read`, `quotes` sous `quotes.read`,
  // `invoices` / `payments` / `payment_allocations` / `credit_notes`
  // sous `invoice.create`, `projects` sous `projects.read`.
  //
  // En `security invoker` nu, un utilisateur qui n'a que `clients.read`
  // obtiendrait le client, ZÉRO devis, ZÉRO facture, ZÉRO euro — tout
  // vrai au sens du SQL et faux au sens de la question. C'est la classe
  // de bug « RLS grant tables », et la confusion zéro / je-ne-sais-pas
  // corrigée quatre fois dans ce produit.
  const sql = sourceSql();
  assert.match(sql, /perform public\.ai_guard\(v_org, 'clients\.read'\)/);
  for (const droit of ["invoice.create", "quotes.read", "projects.read"]) {
    assert.ok(
      sql.includes(`public.has_permission(v_org, '${droit}')`),
      `« ${droit} » n'est pas vérifié : son bloc rendrait zéro au lieu de null`,
    );
    assert.ok(
      sql.includes(`v_manque || '${droit}'::text`),
      `« ${droit} » manquant ne serait pas NOMMÉ dans droitsManquants`,
    );
  }
  assert.match(sql, /'droitsManquants', to_jsonb\(v_manque\)/);
});

test("un droit manquant rend le BLOC ENTIER null, jamais un bloc de zéros", () => {
  // Un bloc rempli de zéros serait indiscernable d'un client sans
  // activité — et c'est précisément la confusion à éviter.
  const sql = sourceSql();
  for (const bloc of ["'devis'", "'facturation'", "'reglement'", "'chantiers'"]) {
    assert.ok(
      new RegExp(`${bloc}, case when not v_(money|quotes|projects) then null`).test(sql),
      `le bloc ${bloc} ne vaut pas null quand son droit manque`,
    );
  }
});

test("aucun montant n'est ramené à zéro par un coalesce", () => {
  // La classe de bug « || 0 sur de l'argent », déjà nommée dans ce
  // dépôt. `sum()` sur zéro ligne rend NULL, et NULL est la bonne
  // réponse : « 0 € devisé » pour un client à qui on n'a jamais rien
  // proposé est une affirmation, pas un constat.
  //
  // Le seul `coalesce` toléré sur de l'argent est celui de
  // `v_a_des_donnees`, qui sert à DÉCIDER de la confiance et n'est
  // jamais rendu, et celui de `nonAffecteCents`, gardé par un
  // `case when v_encaisse is null then null`.
  const sql = sourceSql();
  const rendus = sql.slice(sql.indexOf("return jsonb_build_object"));
  const suspects = [...rendus.matchAll(/coalesce\(v_[a-z_]+, 0\)/g)].map((m) => m[0]);
  assert.deepEqual(
    suspects,
    ["coalesce(v_lettre, 0)"],
    "un montant est ramené à zéro dans la réponse : « rien » deviendrait « 0 € »",
  );
  assert.match(rendus, /case\s+when v_encaisse is null then null/);
});

// ==================================================================
// 3. CE QUE CET AGENT NE SAURA JAMAIS DIRE
// ==================================================================

test("la description refuse la satisfaction comme ABSENTE, pas comme vide", () => {
  // La nuance change la phrase que l'agent prononce. « Je n'ai pas assez
  // de données » invite à en saisir ; « la fonctionnalité n'existe pas »
  // est la vérité, vérifiée par balayage de `information_schema` : aucune
  // table de note, d'avis, d'enquête, de réclamation ni de ticket, et
  // aucune colonne non plus, dans tout le schéma.
  const d = OUTIL_CUSTOMER_VALUE.description;
  assert.match(d, /AUCUN signal de satisfaction/);
  assert.match(d, /n'existe pas, pas qu'elle est vide/);

  const sql = sourceSql();
  assert.match(sql, /PAS un contentement/, "l'intervention signée n'est pas disqualifiée");
});

test("la description refuse le score de départ et toute phrase de portefeuille", () => {
  const d = OUTIL_CUSTOMER_VALUE.description;
  assert.match(d, /UN CLIENT À LA FOIS/);
  assert.match(d, /aucun outil ne balaie le portefeuille/);
  assert.match(d, /risque de\s+départ/);
  assert.match(d, /bon payeur/);
});

test("la description distingue l'argent reçu de l'argent lettré", () => {
  // Les confondre ferait dire « il n'a rien payé » d'un client dont
  // l'acompte est sur le compte mais rattaché à aucune facture.
  const d = OUTIL_CUSTOMER_VALUE.description;
  assert.match(d, /encaisseCents/);
  assert.match(d, /lettreCents/);
  assert.match(d, /acompte/);
});

test("la description distingue « pas le droit » de « il n'y a rien » de « 0 € »", () => {
  // Trois états, trois phrases. C'est la distinction que tout cet outil
  // sert à rendre possible ; si la description ne la porte pas, le
  // modèle les confondra dans sa réponse même quand la donnée est juste.
  const d = OUTIL_CUSTOMER_VALUE.description;
  assert.match(d, /droitsManquants/);
  assert.match(d, /je n'ai pas le droit de le lire/);
  assert.match(d, /rien n'a jamais été saisi/);
  assert.match(d, /jamais « 0 € »/);
});

test("un brouillon de facture n'est pas une facture", () => {
  const sql = sourceSql();
  assert.match(sql, /filter \(where i\.issued_at is not null\)/);
  assert.match(OUTIL_CUSTOMER_VALUE.description, /brouillons de facture sont comptés à part/);
});

// ==================================================================
// 4. L'ÉPREUVE SQL DÉFEND CE QUE LE TYPESCRIPT NE PEUT PAS ATTEINDRE
// ==================================================================

test("l'épreuve SQL couvre le compte amputé, l'acompte et le brouillon", () => {
  const e = sourceEpreuve();
  assert.match(e, /les devis valent NULL en entier, pas 0/);
  assert.match(e, /les trois droits manquants sont NOMMÉS/);
  assert.match(e, /d'acompte ne sont lettrés nulle part/);
  assert.match(e, /il n'entre PAS dans le total facturé/);
  assert.match(e, /l'ancienneté est INCONNUE, pas nulle/);
});

// ==================================================================
// 5. LES SCHÉMAS, ET L'ÉTAT ATTENDU
// ==================================================================

test("le schéma accepte un identifiant et refuse un appel vide", () => {
  assert.doesNotThrow(() =>
    OUTIL_CUSTOMER_VALUE.parametres.parse({
      p_customer_id: "11111111-1111-4111-8111-111111111111",
    }),
  );
  assert.throws(() => OUTIL_CUSTOMER_VALUE.parametres.parse({}));
});

test("il est au registre, et c'est CET objet-ci", () => {
  // L'INTÉGRATION A EU LIEU. Le test disait auparavant l'inverse, et il
  // avait raison à ce moment-là. Il défend maintenant plus fort :
  // `tools.ts` IMPORTE ce fichier plutôt que d'en recopier la
  // déclaration, et l'égalité de référence est ce qui l'y oblige. Une
  // copie serait une seconde vérité, et le jour où l'un des deux
  // exemplaires est corrigé, c'est l'autre qui part au modèle.
  const inscrit = registreOutils().chercher(OUTIL_CUSTOMER_VALUE.nom);
  assert.notEqual(inscrit, null, "`tools.ts` doit importer OUTIL_CUSTOMER_VALUE");
  assert.equal(
    inscrit,
    OUTIL_CUSTOMER_VALUE,
    "le registre contient une COPIE de « getCustomerValue » au lieu de cet objet",
  );
});

test("les Clients le reçoivent, et personne d'autre", () => {
  const registre = registreOutils();
  assert.ok(
    registre.pourAgent("customer", TOUS_LES_DROITS).some((o) => o.nom === OUTIL_CUSTOMER_VALUE.nom),
  );
  for (const autre of AGENTS_CONSTRUITS) {
    if (autre === "customer") continue;
    assert.ok(
      !registre.pourAgent(autre, TOUS_LES_DROITS).some((o) => o.nom === OUTIL_CUSTOMER_VALUE.nom),
      `« ${autre} » lirait l'argent d'un client sans que ce soit sa mission`,
    );
  }
});

test("sans clients.read, l'outil n'est pas proposé et le droit se NOMME", () => {
  const registre = registreOutils();
  assert.ok(
    !registre.pourAgent("customer", ["projects.read"]).some((o) => o.nom === OUTIL_CUSTOMER_VALUE.nom),
    "un outil offert puis refusé fait payer un aller-retour de jetons pour « permission denied »",
  );
  assert.ok(
    registre
      .refusesPourAgent("customer", ["projects.read"])
      .some((r) => r.outil === OUTIL_CUSTOMER_VALUE.nom && r.permission === "clients.read"),
    "le droit qui manque doit se nommer, pas seulement masquer l'outil",
  );
});

test("aucun outil d'écriture n'est accessible aux Clients", () => {
  // Ses limites disent qu'il ne relance rien, n'encaisse rien et ne
  // modifie aucune fiche. Ce test le prouve au lieu de le promettre.
  for (const outil of registreOutils().pourAgent("customer", TOUS_LES_DROITS)) {
    assert.equal(
      outil.famille,
      "lecture",
      `« ${outil.nom} » permettrait aux Clients d'écrire : ses limites disent le contraire`,
    );
  }
});
