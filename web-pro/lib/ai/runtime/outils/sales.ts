import { z } from "zod";
import type { OutilOasis } from "../tools.ts";

/**
 * §11Z — L'OUTIL PROPRE À L'AGENT VENTES.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `tools.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * `runtime/tools.ts` est le catalogue, et il est PARTAGÉ : deux
 * constructeurs écrivent leurs agents en même temps, et deux mains dans
 * le même tableau, c'est un des deux travaux perdu à la fusion. La
 * règle du chantier est donc qu'un constructeur écrit son outil CHEZ
 * LUI, et que l'intégration le verse au catalogue.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE DIFFÉRENCE AVEC LES OUTILS DE §11Y : LE SQL EST DÉJÀ ÉCRIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Les outils de §11Y portaient un `<agent>.sql` et un
 * `<agent>.epreuve.sql` à côté d'eux, en attendant qu'une migration les
 * reçoive. Ici il n'y a rien de tel, et c'est normal :
 * `ai_sales_flow(uuid, date, date)` est DÉJÀ écrite et éprouvée dans
 * `supabase/migrations/0088_agents_derniers.sql`, et son épreuve vit
 * dans `supabase/tests/agents_derniers.sql`.
 *
 * IL NE RESTE DONC QU'UN SEUL GESTE D'INTÉGRATION : verser
 * `OUTIL_SALES_FLOW` dans `OUTILS_LECTURE` de `runtime/tools.ts`.
 * Le test voisin le vérifie contre les migrations, comme
 * `tools.test.ts` le fera ensuite pour le registre entier — la règle
 * « aucun outil déclaré dont la fonction SQL n'existe pas » vaut ici
 * dès aujourd'hui, sans attendre l'intégration.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CET OUTIL AJOUTE À CE QUI EXISTE DÉJÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * Rien de ce qu'il rend n'est calculé ailleurs, et c'est la condition
 * qui a permis à cet agent d'exister :
 *
 *   • Le DÉLAI entre l'envoi et la décision d'un devis n'est mesuré
 *     nulle part.
 *   • Le TAUX DE TRANSFORMATION sur les devis décidés n'est calculé
 *     nulle part.
 *   • Les MOTIFS DE REFUS (`quotes.rejection_reason`) ne sont agrégés
 *     nulle part.
 *   • Le PIPELINE (`crm_opportunities`) et les RELANCES COMMERCIALES
 *     (`crm_activities`) ne sont lus par aucun outil du registre.
 *
 * Et ce qu'il ne calcule PAS est tout aussi délibéré : les devis encore
 * ouverts sont LUS dans `ai_executive_brief` par la fonction elle-même
 * et rendus tels quels sous `renvoiDevisOuverts`. C'est pour cela que
 * l'outil exige `projects.read` autant que `quotes.read` : sans le
 * premier, le briefing qu'il relaie lèverait.
 */

/**
 * LE FLUX COMMERCIAL — LA FENÊTRE ENTRE `sent_at` ET `decided_at`.
 *
 * ─── POURQUOI `fournit` EST VIDE, ET C'EST UNE INFORMATION ───
 *
 * Aucune des dix grandeurs déterministes ne sort d'ici. Ce n'est pas un
 * oubli : cet outil ne rend AUCUN euro, dans aucune fenêtre. Il compte
 * des devis et mesure des durées. Le prix, le coût, la marge et le
 * total d'un devis appartiennent au Chiffrage
 * (`ai_quote_price_analysis`, `quote_totals`), et un second producteur
 * de ces chiffres finirait par en donner d'autres.
 *
 * La seule valeur en centimes que la fonction laisse passer est
 * `valeurEstimeeCents`, sur les étapes du pipeline. Elle ne vient pas
 * d'un devis : c'est `crm_opportunities.estimated_value_cents`, une
 * estimation saisie à la main sur une opportunité. La description
 * ci-dessous le dit au modèle, et la fonction le répète dans sa propre
 * sortie — parce qu'un entier de centimes ressemble beaucoup à un
 * montant de devis quand on le lit vite.
 *
 * ─── POURQUOI `permission` VAUT `quotes.read` ET NON `projects.read` ───
 *
 * `ai_sales_flow` ouvre sur deux gardes qui LÈVENT :
 * `ai_guard(org, 'projects.read')` puis `ai_guard(org, 'quotes.read')`.
 * Le champ `permission` n'en accepte qu'UNE, et le premier réflexe est
 * de déclarer la première garde rencontrée. C'EST LE MAUVAIS CHOIX, et
 * il a été corrigé à l'intégration après mesure.
 *
 * Ce que ce champ sert à faire, c'est empêcher le modèle de se voir
 * offrir un outil qui échouera. Le bon critère n'est donc pas « quelle
 * garde vient en premier » mais « quelle garde DÉCIDE SEULE » —
 * autrement dit la plus étroite des deux, celle qui manque à quelqu'un
 * qui a l'autre.
 *
 * MESURÉ DANS `role_permissions`, en production : `projects.read` est
 * porté par neuf rôles, `quotes.read` par six, et les six sont inclus
 * dans les neuf. Trois rôles ont donc le premier sans le second —
 * `fieldWorker`, `teamLeader`, `nurseryManager`.
 *
 * CE QUI SE SERAIT PASSÉ POUR CES TROIS-LÀ, éprouvé contre la base :
 * le filtre de `context.ts` ne regarde que ce champ, il aurait donc
 * laissé passer l'appel ; la fonction aurait levé « Droit manquant pour
 * cette action (quotes.read) » ; `context.ts` enregistre l'échec mais
 * n'ajoute rien à `permissionsManquantes`, si bien que le runner rend
 * son message le plus générique — « Oasis n'a obtenu aucune des données
 * nécessaires ». L'utilisateur aurait cherché une panne, alors qu'il
 * lui manquait un droit que PERSONNE NE LUI AURAIT NOMMÉ. C'est
 * exactement la confusion « droit manquant / rien à dire » que ce
 * produit s'interdit.
 *
 * Déclarer `quotes.read` rend le filtre EXACT : l'outil est retiré à
 * l'ensemble des comptes qui échoueraient, ni plus ni moins. C'est le
 * même raisonnement que `outils/market.ts` et `outils/risk.ts` ont
 * appliqué chez eux.
 *
 * Les deux droits restent annoncés à l'agent par `droitsAttendus`
 * (voir `agents/sales.ts`), qui, lui, en accepte plusieurs, et l'écran
 * des réglages les affiche tous les deux.
 *
 * ─── L'ORGANISATION VIENT DE LA SESSION ───
 *
 * `injecteOrganisation: true`, et le schéma ci-dessous ne nomme pas
 * `p_organization_id`. Le modèle ne peut donc pas choisir l'entreprise
 * qu'il interroge — un paramètre d'organisation exposé au modèle serait
 * une organisation choisie par la question.
 */
export const OUTIL_SALES_FLOW: OutilOasis = {
  nom: "getSalesFlow",
  famille: "lecture",
  agent: "sales",
  rpc: "ai_sales_flow",
  injecteOrganisation: true,
  // La plus ÉTROITE des deux gardes, pas la première. Voir l'en-tête :
  // c'est elle qui décide seule, donc elle seule filtre juste.
  permission: "quotes.read",
  // « aiGuard » et non « rls » : le refus vient d'une exception nommée,
  // pas d'une ligne filtrée. Un droit manquant ne produit donc jamais
  // une vue partielle — qui serait une réponse fausse, et non une
  // réponse incomplète.
  permissionSource: "aiGuard",
  risque: "low",
  confirmationRequise: false,
  // Vide, et c'est un choix : voir l'en-tête. Cet outil ne rend aucun
  // euro.
  fournit: [],
  // `c_max constant int := 50` dans la fonction : les tableaux rendus
  // (motifs de refus, étapes du pipeline, natures de relance) y sont
  // déjà bornés côté SQL.
  maxElements: 50,
  description:
    "Le flux commercial sur une fenêtre de dates : ce que deviennent les devis une fois " +
    "DÉCIDÉS. Nombre de décisions, acceptés / refusés / expirés / annulés, délai médian, " +
    "minimum et maximum entre l'envoi et la décision, motifs de refus agrégés, pipeline " +
    "d'opportunités par étape, relances commerciales en retard par nature. " +
    "LA FENÊTRE PORTE SUR « decided_at » : les devis ENCORE OUVERTS ne sont pas ici. Ils sont " +
    "calculés par le briefing de direction et rendus tels quels dans « renvoiDevisOuverts » — " +
    "cite-les depuis ce bloc, ne les recompte jamais, et n'en déduis pas qu'il n'y en a aucun " +
    "si la liste est vide : le briefing ne rend que ses cinq premières lignes classées, et son " +
    "propre « note » le dit. " +
    "AUCUN MONTANT DE DEVIS N'EST RENDU, dans aucune fenêtre : prix, coût, marge et total " +
    "appartiennent au Chiffrage. Le seul entier de centimes présent est " +
    "« valeurEstimeeCents » sur les étapes du pipeline, et ce n'est PAS un montant de devis : " +
    "c'est une estimation saisie à la main sur une opportunité. Ne l'additionne à aucun " +
    "chiffre d'affaires. " +
    "« tauxDeSignaturePct » vaut null tant qu'il n'y a pas vingt décisions, et " +
    "« delaiMedianJours » null tant qu'il n'y en a pas huit : « tauxMotif » et « delaiMotif » " +
    "disent pourquoi, et c'est cette phrase-là qu'il faut rendre. Un taux sur une décision " +
    "vaudrait 100 % et ne décrirait rien. " +
    "« decisionsQuasiInstantanees » compte les devis décidés moins de deux minutes après leur " +
    "envoi : ce sont des saisies de recette, pas des décisions de client. " +
    "« decisionsAvantEnvoi » compte les dates incohérentes — une donnée fausse, pas un client " +
    "rapide. " +
    "LIS LES CHAMPS « motif » ET « ...TotalTouteHistoire » AVANT DE CONCLURE : un pipeline à " +
    "zéro avec « opportunitesTotalTouteHistoire » à zéro veut dire « personne n'a jamais " +
    "rempli l'écran Opportunités », jamais « vous n'avez rien en cours ». Même règle pour les " +
    "relances et pour les refus : « aucun refus enregistré » n'est pas « vous ne perdez " +
    "jamais ». " +
    "« marquageDeLecture » N'EST PAS UNE PREUVE D'OUVERTURE : « viewed_at » est une saisie " +
    "humaine, ce produit n'a aucun accusé de lecture. Dis « personne n'a marqué ce devis " +
    "comme vu », jamais « le client ne l'a pas ouvert ». " +
    "Le bloc « nonMesurable » nomme ce que cet outil refuse de produire : montants, devis " +
    "ouverts, suite après acceptation, relance de devis, prévision de chiffre d'affaires. " +
    "N'en déduis rien et renvoie à l'agent nommé.",
  parametres: z.object({
    // `.nullable()` et non `.optional()` : le mode strict des sorties
    // structurées exige que toutes les clés soient présentes.
    p_from: z
      .string()
      .nullable()
      .describe("Début de la fenêtre de DÉCISION, AAAA-MM-JJ. Null = il y a 365 jours."),
    p_to: z
      .string()
      .nullable()
      .describe(
        "Fin de la fenêtre de DÉCISION, AAAA-MM-JJ. Null = aujourd'hui. 1100 jours au plus.",
      ),
  }),
};
