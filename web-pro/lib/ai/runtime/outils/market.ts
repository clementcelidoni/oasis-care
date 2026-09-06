import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Z — L'OUTIL PROPRE À L'AGENT MARCHÉ, QUI S'APPELLE EN RÉALITÉ
 * « HISTORIQUE INTERNE ».
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Le catalogue est PARTAGÉ et deux constructeurs écrivent en ce moment.
 * Deux mains dans le même tableau, c'est un des deux travaux perdu à la
 * fusion. Le constructeur écrit son outil chez lui ; l'intégration le
 * verse au catalogue. C'est la manière déjà en vigueur pour
 * `operations`, `planning`, `fleet` et `customer`.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL RESTE À FAIRE, ET C'EST UN SEUL GESTE
 * ══════════════════════════════════════════════════════════════════
 *
 * La fonction SQL EST DÉJÀ POSÉE : `ai_internal_history` vit dans
 * `supabase/migrations/0088_agents_derniers.sql`, éprouvée par
 * `supabase/tests/agents_derniers.sql`. Contrairement aux outils de
 * §11Y, il n'y a donc pas trois gestes d'intégration mais un seul :
 *
 *   `runtime/tools.ts` reçoit `OUTIL_INTERNAL_HISTORY` dans
 *   `OUTILS_LECTURE`, par un import et non par un copier-coller.
 *
 * ATTENTION, ET C'EST MESURÉ : `tools.test.ts` §8 (« aucune déclaration
 * d'outil n'est écrite dans `outils/` sans être branchée ») ÉCHOUERA
 * tant que ce geste n'est pas fait. C'est le comportement voulu du
 * test — il a été écrit après que 260 Ko d'outils sont restés orphelins
 * — mais il faut le savoir avant de lancer la suite : l'échec ne dira
 * pas « l'outil est faux », il dira « l'outil n'est branché nulle
 * part », et c'est vrai.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE GARDE-FOU, ET IL EST LA RAISON D'ÊTRE DE CET OUTIL
 * ══════════════════════════════════════════════════════════════════
 *
 * Cet agent porte la clé `market` — le routeur, `AGENTS_MODELE` et
 * l'alias `market_intelligence` la connaissent déjà — et il n'a accès à
 * AUCUNE donnée extérieure à l'entreprise. Un agent qui « analyse le
 * marché » à partir des seules données d'un client INVENTE, et il
 * invente de façon plausible, ce qui est le pire des deux mondes.
 *
 * Deux protections, et il faut les deux :
 *
 *   • LA FONCTION ne rend aucun prix de marché, aucune part de marché,
 *     aucun concurrent — elle n'a rien pour les produire — et elle
 *     NOMME cette absence dans `sourceExterneAbsente` avec ce qu'il
 *     faudrait brancher.
 *   • LA DESCRIPTION ci-dessous le répète au modèle. Ce n'est pas une
 *     redite : la description est ce que le modèle lit AVANT d'appeler,
 *     donc avant d'avoir vu la réponse. Un modèle à qui l'on demande
 *     « le prix du marché pour une terrasse » et qui ne voit qu'un
 *     outil nommé « historique » peut décider de répondre sans outil.
 *     La description est le seul endroit qui l'en dissuade à temps.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI `quotes.read` ET NON `clients.read` : C'EST MESURÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * La fonction lève sur DEUX droits — `perform ai_guard(...,
 * 'clients.read')` puis `perform ai_guard(..., 'quotes.read')` — et le
 * champ `permission` n'en accepte qu'un. Il ne sert pas à décrire la
 * fonction : il sert à ne PAS offrir au modèle un outil qui échouera.
 *
 * Le bon choix est donc celui qui filtre EXACTEMENT, et il se mesure
 * plutôt qu'il ne se devine. Relevé dans `role_permissions` : sept
 * rôles portent `clients.read`, six portent `quotes.read`, et les six
 * sont INCLUS dans les sept — seul `nurseryManager` a le premier sans
 * le second. `quotes.read` est donc le droit strictement plus étroit,
 * et le déclarer ici retire l'outil à exactement l'ensemble des comptes
 * qui échoueraient, ni plus ni moins. Déclarer `clients.read` aurait
 * laissé un responsable de pépinière appeler un outil qui lève.
 */
export const OUTIL_INTERNAL_HISTORY: OutilOasis = {
  nom: "getInternalHistory",
  famille: "lecture",
  agent: "market",
  rpc: "ai_internal_history",
  // L'organisation vient de la SESSION. Le schéma ci-dessous ne la
  // nomme pas, donc le modèle ne peut pas en choisir une autre.
  injecteOrganisation: true,
  permission: "quotes.read",
  // « aiGuard » et non « rls » : la fonction ouvre sur deux
  // `perform public.ai_guard(...)`, qui LÈVENT. Un droit manquant ne
  // produit donc jamais une vue partielle — qui serait une réponse
  // fausse plutôt qu'une réponse incomplète.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // La seule grandeur déterministe qu'il apporte : le prix de VENTE
  // unitaire par article, en fourchette min/max par mois. Ni marge, ni
  // total de facture, ni chiffre d'affaires — ils appartiennent à la
  // Finance, qui les calcule déjà.
  fournit: ["prix"],
  // `c_max constant int := 50` dans la fonction : les trois tableaux
  // qu'elle rend sont bornés là.
  maxElements: 50,
  description:
    "L'entreprise comparée À SON PROPRE PASSÉ, et à rien d'autre : origine des clients " +
    "(crm_customers.source), prix de VENTE unitaire par article du catalogue et par mois, " +
    "rapprochement entre ce qui est devisé et ce qui est facturé, profondeur d'historique " +
    "disponible pour parler de saisonnalité. " +
    "CET OUTIL NE CONNAÎT AUCUNE DONNÉE EXTÉRIEURE À L'ENTREPRISE. Il ne rend AUCUN prix du " +
    "marché, AUCUNE part de marché, AUCUNE comparaison avec un concurrent : ces données " +
    "n'existent nulle part dans ce produit, aucune table ne les stocke et aucun outil ne les " +
    "cherche. Si on te les demande, lis « sourceExterneAbsente », dis que la capacité manque et " +
    "dis laquelle il faudrait brancher. N'en produis jamais une par déduction : elle serait " +
    "plausible et fausse. " +
    "N'EMPLOIE PAS LE MOT « MARCHÉ » pour parler de ce que rend cet outil : le lecteur " +
    "comprendrait « les autres ». Dis « chez vous », « dans vos devis », « sur vos chantiers ». " +
    "LIS LES CHAMPS « motif » AVANT DE CONCLURE. Sous le seuil, la fonction rend les lignes " +
    "brutes et met le pourcentage à null : ce null veut dire « trop peu de points pour qu'une " +
    "part veuille dire quelque chose », jamais « zéro ». " +
    "« Aucune source renseignée » est un champ vide, pas une absence d'origine ; « aucune ligne " +
    "rattachée à un article » est un rattachement absent, pas un prix stable ; « saisonnalité " +
    "non calculable » est un manque d'histoire, pas une absence de saison. " +
    "Le prix rendu est le prix de VENTE unitaire (unit_sale_price_cents). Le coût d'achat n'est " +
    "jamais rendu ici, et les prix fournisseurs appartiennent à l'agent Achats. " +
    "Le rapprochement devisé / facturé passe par le LIBELLÉ faute de référence d'article sur " +
    "les lignes de facture : c'est une piste à vérifier, jamais un écart mesuré. " +
    "Le bloc « nonMesurable » nomme ce qui appartient à d'autres : la marge par service, par " +
    "ville ou par mois est à la Finance, les taux de transformation à l'agent Ventes, la " +
    "fourchette des chantiers comparables au Chiffrage. Renvoie-y plutôt que de recalculer.",
  // Aucun paramètre : la période n'en est pas un ici, à dessein. La
  // fonction rend une PROFONDEUR D'HISTORIQUE (combien de mois
  // distincts, combien d'articles atteignent le seuil), et une fenêtre
  // choisie par le modèle permettrait de la rétrécir jusqu'à faire
  // dire à la réponse ce qu'on veut y lire.
  parametres: z.object({}),
};
