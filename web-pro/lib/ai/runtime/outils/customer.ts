import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Y — L'OUTIL PROPRE À L'AGENT CLIENTS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Le catalogue est PARTAGÉ, plusieurs agents s'écrivent en même temps,
 * et deux mains dans le même tableau font un des deux travaux perdu à
 * la fusion. Le constructeur écrit son outil chez lui ; l'intégration
 * le verse au catalogue.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES TROIS GESTES D'INTÉGRATION, ET ILS VONT ENSEMBLE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. `supabase/migrations/0082_agents_ia.sql` reçoit le corps de
 *      `outils/customer.sql`, tel quel.
 *   2. `runtime/tools.ts` reçoit `OUTIL_CUSTOMER_VALUE` dans
 *      `OUTILS_LECTURE`.
 *   3. `supabase/tests/agents_ia.sql` reçoit `outils/customer.epreuve.sql`.
 *
 * Aucun geste sur `OUTILS_SPEC_SANS_SERVICE` : la p. 10-11 ne nomme
 * aucun outil de valeur client, donc il n'y a rien à y faire passer
 * d'« absent » à « couvert ».
 *
 * ══════════════════════════════════════════════════════════════════
 * UN SEUL OUTIL, ET C'EST UNE DÉCISION
 * ══════════════════════════════════════════════════════════════════
 *
 * L'agent Clients reçoit déjà TROIS outils transverses sans qu'une
 * ligne soit écrite : `searchEntities` (le nom devient un identifiant),
 * `getClientContext` (la fiche : devis, chantiers, propriétés, impayés,
 * derniers échanges) et `getProjectContext` (le détail d'un chantier).
 * Ils couvrent l'histoire de la relation, et bien.
 *
 * Ce qu'ils ne couvrent PAS, et qui est un tiers de la mission de cet
 * agent, c'est la VALEUR : `getClientContext` ne rend que les factures
 * IMPAYÉES. Ni total facturé, ni total encaissé, ni date de première
 * facture. Sans l'outil ci-dessous, la seule manière pour l'agent de
 * répondre « combien ce client m'a-t-il rapporté » serait d'additionner
 * les impayés et d'appeler cela un chiffre d'affaires : une addition
 * faite par le modèle — interdite p. 11-12 — et un total qui décrit ce
 * qu'on n'a PAS touché présenté comme ce qu'on a gagné.
 *
 * Un seul outil, donc, et pas un de plus. Il n'y a pas d'outil de
 * portefeuille, et il ne faut pas en écrire un : `context.ts` pose
 * « jamais toute la base », la base compte un client, et un classement
 * sur n = 1 serait arithmétiquement exact et descriptivement vide.
 */

/**
 * CE QU'UN CLIENT A ÉTÉ DEVISÉ, FACTURÉ, ET A RÉELLEMENT PAYÉ.
 *
 * ─── LE PIÈGE QUE CET OUTIL DÉSAMORCE : TROIS DROITS, PAS UN ───
 *
 * Vérifié dans `pg_policies`. Les tables que la fonction traverse ne
 * sont pas sous le même droit : `crm_customers` sous `clients.read`,
 * `quotes` sous `quotes.read`, `invoices` / `payments` /
 * `payment_allocations` / `credit_notes` sous `invoice.create`,
 * `projects` sous `projects.read`.
 *
 * En `security invoker` nu, un utilisateur qui n'a que `clients.read`
 * obtiendrait donc le client, ZÉRO devis, ZÉRO facture, ZÉRO euro —
 * tout vrai au sens du SQL, tout faux au sens de la question. C'est la
 * classe de bug que ce dépôt a déjà nommée (« RLS grant tables ») et la
 * confusion zéro / je-ne-sais-pas corrigée quatre fois.
 *
 * La fonction interroge donc `has_permission` avant chaque bloc, rend
 * `null` sur le BLOC ENTIER quand le droit manque, et nomme le droit
 * dans `droitsManquants` — la manière de `ai_finance_snapshot` (0073).
 *
 * ─── POURQUOI `permission` VAUT `clients.read` ET RIEN D'AUTRE ───
 *
 * Le champ `permission` sert à ne PAS offrir au modèle un outil qui
 * échouera. Ici un seul droit fait échouer l'appel entier :
 * `clients.read`, le seul qui passe par `ai_guard`, donc le seul qui
 * lève. Les trois autres n'empêchent pas l'outil de répondre — ils
 * rétrécissent sa réponse, et la réponse le dit elle-même. Déclarer
 * `invoice.create` ici retirerait l'outil à un chargé de clientèle qui
 * a de bonnes raisons de consulter la fiche sans voir l'argent.
 *
 * ─── L'ORGANISATION VIENT DE LA LIGNE ───
 *
 * `injecteOrganisation: false`, comme `getQuote` et `getProjectContext` :
 * la fonction relit l'organisation sur la ligne du client (règle n° 1 de
 * 0073). On ne peut pas se tromper d'entreprise sur un paramètre qui
 * n'existe pas.
 */
export const OUTIL_CUSTOMER_VALUE: OutilOasis = {
  nom: "getCustomerValue",
  famille: "lecture",
  agent: "customer",
  rpc: "ai_customer_value",
  // L'organisation est RELUE sur la ligne du client, pas injectée.
  injecteOrganisation: false,
  permission: "clients.read",
  // « aiGuard » : la fonction ouvre sur `perform public.ai_guard(v_org,
  // 'clients.read')`, qui lève. Les trois autres droits amputent des
  // blocs et se nomment, ils ne font pas échouer l'appel.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // Le total facturé et les prix devisés, additionnés par le SQL. C'est
  // exactement ce que le modèle n'a pas le droit de calculer lui-même
  // (« total facture » et « prix », p. 11).
  fournit: ["totalFacture", "prix"],
  description:
    "Ce qu'UN client a été devisé, facturé, et a réellement payé, en centimes entiers : total " +
    "devisé et part acceptée, total facturé HT et TTC, argent reçu, part lettrée sur ses " +
    "factures, avoirs, reste dû, montant échu, premières et dernières dates, chantiers " +
    "terminés et en cours. Complète « getClientContext », qui ne rend que les IMPAYÉS. " +
    "UN CLIENT À LA FOIS — jamais la base clients : aucun outil ne balaie le portefeuille. " +
    "LIS « droitsManquants » AVANT DE CONCLURE : un bloc à null veut dire « je n'ai pas le " +
    "droit de le lire », jamais « il n'y a rien ». Un total à null sur un bloc lisible veut " +
    "dire « rien n'a jamais été saisi », jamais « 0 € ». " +
    "« encaisseCents » est l'argent reçu du client ; « lettreCents » la part rattachée à ses " +
    "factures. Un écart n'est pas une erreur : un acompte reçu avant toute facture n'est " +
    "lettré nulle part, et les confondre ferait dire qu'il n'a pas payé. " +
    "Les brouillons de facture sont comptés à part et n'entrent dans aucun total : sans numéro " +
    "de séquence légale, la facture n'existe pas. " +
    "« ancienneteJours » à null veut dire que la date de début de relation n'est pas " +
    "renseignée : n'en déduis ni fidélité ni nouveauté. " +
    "LE BLOC « nonMesurable » EST UN REFUS, PAS UNE NOTE : ce produit ne collecte AUCUN signal " +
    "de satisfaction — aucune table, aucune colonne — ne permet AUCUN score de risque de " +
    "départ, et n'autorise aucun jugement de « bon payeur ». Dis que la fonctionnalité " +
    "n'existe pas, pas qu'elle est vide.",
  parametres: z.object({
    p_customer_id: z
      .string()
      .describe("Identifiant du client (UUID). Utilise « searchEntities » pour l'obtenir."),
  }),
};
