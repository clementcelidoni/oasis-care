-- Oasis Care — §11Z, LES QUATRE DERNIERS AGENTS QUE LA BASE ACCEPTE,
--                     ET LES TROIS FONCTIONS QUI LEUR DONNENT DE QUOI LIRE.
--
-- À exécuter après 0082. Idempotente et purement additive : elle ne
-- pose aucune table, aucune politique, ne touche à aucune donnée. Elle
-- élargit une liste fermée et crée trois fonctions de LECTURE.
--
-- ============================================================
-- CE QUE CE FICHIER FAIT, ET POURQUOI IL EXISTE APRÈS 0082 QUI
-- DISAIT DE NE PAS LE FAIRE
-- ============================================================
--
-- 0082 a ouvert `ai_is_supported_agent` à dix agents et a REFUSÉ les
-- quatre derniers — `sales`, `market`, `risk`, `classification` — en
-- écrivant, dans son propre en-tête, pourquoi. Cet avis a été rendu au
-- dirigeant ; il l'a entendu et a tranché dans l'autre sens. Ce fichier
-- exécute cette décision. Il ne la rediscute pas, et il ne fait pas
-- semblant que 0082 avait tort : il répond, un par un, aux quatre
-- objections que 0082 avait formulées, parce qu'un agent construit
-- SANS y répondre serait exactement la façade que 0082 refusait.
--
--   • `sales` — l'objection de 0082 était le DOUBLON : « la seule part
--     qui aurait de la matière est déjà calculée par
--     `ai_executive_brief` ». Elle est exacte, et la réponse n'est pas
--     de l'ignorer, c'est de DÉCOUPER. `ai_executive_brief` (0073,
--     sections 2 et 3) ne regarde que les devis ENCORE OUVERTS
--     (`status in ('sent','viewed')`). `ai_sales_flow` ne regarde que
--     les devis DÉCIDÉS (`decided_at is not null`). Les deux
--     populations sont disjointes PAR CONSTRUCTION : un devis est
--     ouvert ou décidé, jamais les deux. Et pour les devis ouverts,
--     `ai_sales_flow` ne recalcule rien du tout — elle APPELLE
--     `ai_executive_brief` et rend ce qu'elle en a lu, sourcé.
--
--   • `market` — l'objection était l'ABSENCE DE SOURCE EXTERNE. Elle
--     est toujours vraie : il n'existe dans ce produit aucune capacité
--     de recherche, aucune table de citations, aucun prix concurrent.
--     La fonction s'appelle donc `ai_internal_history` et non
--     `ai_market_*` : elle compare l'entreprise À SON PROPRE PASSÉ, et
--     à rien d'autre. Elle PORTE en plus la déclaration de ce qui
--     manque (`sourceExterneAbsente`), pour que l'agent refuse un prix
--     de marché en nommant la source à brancher plutôt qu'en s'excusant.
--     La clé technique reste `market` : le routeur, `AGENTS_MODELE` et
--     l'alias `market_intelligence` la connaissent déjà, et la renommer
--     casserait trois fichiers pour gagner un mot.
--
--   • `risk` — l'objection était la DÉDUCTION PRÉSENTÉE COMME UNE
--     MESURE. `ai_risk_snapshot` répond en refusant de produire le
--     moindre score, la moindre probabilité et le moindre verdict : elle
--     rend des comptes, des dénominateurs, et des NULL motivés. Ce qui
--     se déduit reste au modèle, qui a l'obligation de le dire ; ce qui
--     se mesure sort d'ici, et de nulle part ailleurs.
--
--   • `classification` — l'objection était qu'il n'a rien à lire. Elle
--     est exacte et elle le restera : cet agent ne lit AUCUNE table
--     métier, il aiguille. AUCUNE FONCTION N'EST CRÉÉE POUR LUI, et
--     c'est volontaire — lui en donner une le rendrait capable de
--     répondre, donc concurrent des treize autres. Ce que 0088 lui
--     apporte est ailleurs, et c'est réel : son nom entre dans
--     `ai_is_supported_agent`, donc dans `ai_model_overrides` et
--     `ai_agent_settings`. Aujourd'hui le routeur lui attribue déjà le
--     niveau « economy » et `ServicePreTraitement` dépense sous ce nom,
--     pendant que la base REFUSE qu'on lui épingle un modèle ou qu'on
--     lui fixe un plafond. C'est cette incohérence-là que la section 1
--     répare, et elle vaut à elle seule la migration.
--
-- ============================================================
-- L'ÉTAT MESURÉ EN PRODUCTION LE 2026-09-05, AVANT D'ÉCRIRE
-- ============================================================
--
-- Ces trois fonctions naissent sur des tables presque vides, et le
-- dire ici est ce qui les empêche de mentir plus tard :
--
--   `business_organizations` 1 · `crm_opportunities` 0 ·
--   `crm_activities` 0 · `crm_contacts` 0 · `crm_customers` 1 ·
--   `quotes` 1 · `quote_lines` 14 (dont 1 seule porte un
--   `catalog_item_id`) · `invoices` 2 (dont 1 annulée) ·
--   `invoice_lines` 15 · `payments` 0 · `payment_allocations` 0 ·
--   `projects` 1 (aucun `planned_end_on`) · `project_phases` 5 (aucun
--   `planned_end_on`) · `project_tasks` 0 · `suppliers` 0 ·
--   `supplier_prices` 0 · `ai_conversations` 0 · `ai_usage_events` 0.
--
-- L'unique devis, DEV-2026-0001, a été envoyé le 2026-08-29 à
-- 13:36:00.471+00 et décidé à 13:36:19.609+00 : DIX-NEUF SECONDES. Ce
-- n'est pas une vente, c'est une recette de démonstration. Une médiane
-- de délai de décision calculée là-dessus vaudrait 19 secondes et
-- serait présentée comme le comportement des clients de l'entreprise.
-- `ai_sales_flow` compte séparément ces décisions instantanées
-- (`decisionsQuasiInstantanees`) pour que le fait soit RENDU par le SQL
-- au lieu d'être deviné par le modèle.
--
-- ============================================================
-- LES SEUILS DE SIGNIFICATIVITÉ VIVENT ICI, PAS DANS UN PROMPT
-- ============================================================
--
-- Un seuil écrit dans une consigne de modèle est une intention ; un
-- seuil écrit dans une fonction est une garantie. Les trois fonctions
-- rendent donc NULL ACCOMPAGNÉ D'UN MOTIF EN FRANÇAIS partout où un
-- taux, une médiane ou une tendance reposerait sur trop peu de lignes.
-- Le motif est produit par le SQL : le modèle le récite, il ne
-- l'invente pas.
--
--   • `ai_sales_flow` — 20 décisions pour un TAUX, 8 pour une MÉDIANE
--     de délai. Pourquoi 20 et non le 5 déjà en vigueur dans
--     `ai_quote_comparables` : les 5 y bornent une FOURCHETTE, où cinq
--     points donnent déjà un minimum et un maximum honnêtes. Un taux de
--     transformation est une PROPORTION ; à n = 20 son intervalle à
--     95 % vaut encore ±22 points. En dessous, le chiffre change de
--     sens à chaque devis suivant. Le seuil de la médiane est plus bas
--     parce qu'une médiane de délai est plus stable qu'une proportion.
--
--   • `ai_internal_history` — 5 points de comparaison, ALIGNÉ SUR
--     `ai_quote_comparables` (0073, `c_seuil constant int := 5`). On ne
--     pose pas un second seuil quand le produit en a déjà un pour
--     exactement la même question : « combien de points faut-il pour
--     qu'une fourchette veuille dire quelque chose ». Et 24 mois avant
--     de prononcer le mot saisonnalité : une saison se compare à la
--     même saison de l'an dernier, et cette base a huit jours
--     d'histoire.
--
--   • `ai_risk_snapshot` — 12 observations. Douze = une par mois sur un
--     an, le minimum pour qu'une dérive se distingue d'une saison dans
--     un métier qui travaille au rythme des saisons ; en dessous, un
--     seul événement déplace le résultat de plus de huit points. Et 5
--     clients facturés pour prononcer le mot concentration, parce qu'un
--     ratio sur un dénominateur de 1 vaut 100 % par construction.
--
-- ============================================================
-- CE QUE CES TROIS FONCTIONS NE FONT PAS
-- ============================================================
--
--   • AUCUNE N'ÉCRIT. Toutes sont `stable` et `security invoker` : la
--     RLS de l'appelant s'applique par-dessus, et aucune ne peut poser
--     une ligne. L'IA de ce produit prépare des brouillons ; elle
--     n'émet pas une facture, n'envoie pas un devis, n'enregistre pas
--     un paiement, ne supprime rien, ne change aucun droit.
--
--   • AUCUNE NE CHOISIT SON ORGANISATION. `p_organization_id` est posé
--     par l'exécuteur depuis la SESSION (`injecteOrganisation` dans
--     `tools.ts`), jamais par le modèle, et `ai_guard` le revérifie
--     côté serveur : appartenance ET droit. Un outil qui accepterait
--     l'organisation d'un argument choisi par le modèle serait une
--     faille, pas une commodité.
--
--   • AUCUNE NE REND UNE VUE PARTIELLE QUAND UN DROIT MANQUE.
--     `ai_guard` LÈVE. C'est la règle que ce produit a dû réapprendre
--     quatre fois : « zéro » et « je n'ai pas le droit de voir » sont
--     deux réponses opposées, et celle qui ment est la première.
--
--   • AUCUNE NE RECALCULE UN CHIFFRE QUI EXISTE AILLEURS. La liste
--     exhaustive est dans le commentaire de chaque fonction. Deux
--     implémentations du même chiffre finissent toujours par diverger,
--     et le jour où elles divergent personne ne sait laquelle croire.
--
--   • AUCUNE N'EST EXÉCUTABLE PAR `anon`. Voir la section 3 : c'est le
--     seul endroit où ce fichier est PLUS STRICT que ses prédécesseurs,
--     et il dit pourquoi.
--
-- ============================================================
-- LA GRAPHIE, VÉRIFIÉE PLUTÔT QUE SUPPOSÉE
-- ============================================================
--
-- La base écrit `quote_pricing` là où le code écrit `quotePricing` ;
-- c'est la seule irrégularité de la liste, et 0082 l'a laissée telle
-- quelle. Les quatre clés de ce fichier s'écrivent IDENTIQUEMENT des
-- deux côtés : `sales`, `market`, `risk`, `classification`. Vérifié
-- dans `web-pro/lib/ai/model/types.ts` — `AGENTS_MODELE` les contient
-- sous cette forme exacte, et `normaliserCleAgent` les ramène par
-- simple comparaison en minuscules, sans passer par `ALIAS_AGENTS`.
-- AUCUNE MODIFICATION DU ROUTEUR N'EST DONC NÉCESSAIRE, et c'est le
-- résultat d'une lecture, pas d'un espoir.
--
-- ============================================================
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI
-- ============================================================
--
--   • `ai_action_catalog` — AUCUNE LIGNE AJOUTÉE. Les quatre nouveaux
--     agents peuvent lire ; aucun ne gagne le droit d'exécuter quoi que
--     ce soit. L'action « relancer un devis » (`quoteFollowUp`) reste
--     la propriété de `quote_pricing` : `sales` ne la propose pas, il
--     dit qui la porte. Un agent sans ligne au catalogue ne peut rien
--     faire partir sans humain, même réglé au niveau 4.
--
--   • `ai_ensure_org_defaults` — NON MODIFIÉE, comme 0082 avant elle.
--     Elle sème un réglage d'autonomie pour les quatre agents de 0072
--     seulement. Les dix autres n'ont pas de ligne semée et n'en ont
--     pas besoin : l'absence de ligne vaut « pas d'autonomie », ce qui
--     est le bon défaut pour un agent neuf. Semer un niveau pour un
--     agent qu'on vient d'ouvrir reviendrait à décider à la place du
--     dirigeant.
--
--   • AUCUNE PERMISSION NOUVELLE. Les trois fonctions se gardent avec
--     des droits qui existent déjà (`projects.read`, `quotes.read`,
--     `clients.read`, `invoice.create`). C'est délibéré, et c'est le
--     piège de 0075 qui l'impose : une permission ajoutée maintenant
--     n'est portée par aucun rôle tant qu'on ne l'insère pas
--     explicitement dans `role_permissions`, et le premier appel
--     échouerait chez tout le monde — y compris chez le propriétaire,
--     qui pourtant passe par la branche `role in ('owner','admin')` et
--     ne s'en apercevrait donc pas avant qu'un salarié se plaigne.


-- ============================================================
-- 1. LA LISTE DES AGENTS QUE LA BASE RECONNAÎT PASSE DE DIX À QUATORZE
-- ============================================================
-- `create or replace` sur une fonction `immutable` employée dans cinq
-- contraintes `check` (`ai_decisions`, `ai_actions`,
-- `ai_agent_settings`, `ai_action_approvals`, `ai_model_overrides`,
-- vérifié par requête sur `pg_constraint`). Une contrainte qui devient
-- PLUS PERMISSIVE ne peut invalider aucune ligne existante :
-- PostgreSQL ne la revalide même pas. Le rétrécir, en revanche,
-- casserait — et c'est très bien ainsi.
--
-- LES DIX PRÉCÉDENTS SONT RECOPIÉS UN PAR UN et non lus depuis une
-- source : une valeur perdue en chemin ne se verrait qu'à la prochaine
-- écriture sur `ai_decisions`, c'est-à-dire APRÈS que l'appel de modèle
-- a été payé.

create or replace function public.ai_is_supported_agent(p_agent text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_agent in (
    -- Les quatre de 0072.
    'executive',
    'finance',
    'billing',
    'quote_pricing',
    -- Les six de 0082 (§11Y).
    'operations',
    'planning',
    'procurement',
    'nursery',
    'fleet',
    'customer',
    -- Les quatre de 0088 (§11Z). Même graphie qu'en TypeScript, comme
    -- les six précédentes et contrairement à `quote_pricing`.
    'sales',
    'market',
    'risk',
    'classification'
  );
$$;

comment on function public.ai_is_supported_agent(text) is
  'Les quatorze agents de la spec (0072 + 0082 + 0088). Les quatre derniers sont entrés sur décision du dirigeant, après l''avis contraire de 0082 : sales lit la fenêtre refermée des devis (ai_sales_flow), market est en réalité l''historique interne (ai_internal_history) et refuse tout prix de marché, risk distingue mesure et déduction (ai_risk_snapshot), classification n''a aucune fonction et n''en aura pas — son nom n''est ici que pour rendre sa dépense plafonnable dans ai_model_overrides.';


-- ============================================================
-- 2. LES TROIS FONCTIONS DE LECTURE
-- ============================================================
-- Trois et non quatre : `classification` n'en a pas et n'en veut pas.
-- Voir l'en-tête.



-- ------------------------------------------------------------
-- 2.1 — `ai_sales_flow` : LA FENÊTRE REFERMÉE DU DEVIS.
-- ------------------------------------------------------------
--
-- ============================================================
-- LE DÉCOUPAGE, ET C'EST LA SEULE CHOSE QUI AUTORISE CETTE FONCTION
-- À EXISTER
-- ============================================================
--
--   • `ai_executive_brief` sections 2 et 3 possèdent les devis ENCORE
--     OUVERTS : dormants depuis plus de sept jours, expirant sous sept
--     jours. Filtre exact : `status in ('sent','viewed')`.
--   • `ai_sales_flow` possède les devis DÉCIDÉS : `decided_at is not
--     null`. Le flux, la transformation, les délais.
--   • `ai_billing_candidates` possède l'APRÈS-ACCEPTATION (sa section 3
--     filtre `status = 'accepted'`).
--   • `ai_quote_price_analysis` et `quote_totals` possèdent le MONTANT,
--     quelle que soit la fenêtre.
--
-- Les deux premières populations sont DISJOINTES PAR CONSTRUCTION : un
-- devis `sent`/`viewed` n'a pas de décision, un devis décidé n'est plus
-- ni `sent` ni `viewed`. C'est ce qui permet aux deux fonctions de
-- coexister sans jamais produire deux réponses à la même question.
--
-- ET POUR LES DEVIS OUVERTS, CETTE FONCTION NE CALCULE RIEN. Elle
-- appelle `ai_executive_brief` et rend, sous `renvoiDevisOuverts`, les
-- lignes que le briefing attribue déjà à `quote_pricing`. Deux
-- précautions qui comptent : le briefing ne rend que ses CINQ premières
-- lignes classées, donc l'absence d'une ligne devis n'y vaut pas zéro —
-- c'est dit dans le `note` du bloc ; et le nombre rendu vient
-- littéralement du briefing, ce qui rend un écart entre les deux
-- impossible plutôt qu'improbable.
--
-- ============================================================
-- CE QU'ELLE NE REND PAS, ET CHAQUE ABSENCE EST UN CHOIX
-- ============================================================
--
--   • AUCUN MONTANT DE DEVIS, dans aucune fenêtre. Elle compte des
--     devis et mesure des délais. L'euro appartient au Chiffrage.
--     `valeurEstimeeCents` du pipeline n'est PAS un montant de devis :
--     c'est `crm_opportunities.estimated_value_cents`, une estimation
--     saisie à la main sur une opportunité, et le champ le dit.
--   • AUCUNE PRÉVISION. Ni chiffre d'affaires à venir, ni valeur
--     pondérée par `probability_percent`. Multiplier un montant estimé
--     par une probabilité saisie au jugé fabrique un chiffre qui a
--     l'air d'une prévision et n'en est pas une. Le nombre
--     d'opportunités PORTANT une probabilité est rendu ; la moyenne ne
--     l'est pas.
--   • AUCUNE PREUVE D'OUVERTURE. `quotes.viewed_at` n'est écrit qu'à la
--     main (`web-pro/lib/quotes/actions.ts:126`, `if (status ===
--     "viewed") patch.viewed_at = now`) : il n'existe aucun accusé de
--     lecture dans ce produit. Le bloc s'appelle donc
--     `marquageDeLecture` et non `ouverture`, et son `note` interdit la
--     phrase « le client ne l'a pas ouvert ».
--   • AUCUN TAUX SOUS 20 DÉCISIONS. NULL et un motif.
--
-- ============================================================
-- « ZÉRO » N'EST JAMAIS RENDU POUR « RIEN N'A ÉTÉ SAISI »
-- ============================================================
--
-- `crm_opportunities` et `crm_activities` comptent zéro ligne depuis
-- l'ouverture de l'entreprise. Un pipeline à zéro se lit « je n'ai
-- rien en cours » ; la vérité est « personne n'a jamais rempli
-- l'écran ». Les deux blocs portent donc un compteur `jamaisRempli`
-- calculé sur la table ENTIÈRE — archives et lignes closes comprises —
-- et un motif en français. La distinction est faite par le SQL parce
-- qu'un modèle qui reçoit `[]` ne peut pas la faire.

create or replace function public.ai_sales_flow(
  p_organization_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- LES SEUILS, EN BASE ET NON DANS UN PROMPT. Voir l'en-tête du
  -- fichier pour le raisonnement derrière chacun.
  c_seuil_taux    constant int := 20;  -- décisions avant tout TAUX
  c_seuil_delai   constant int := 8;   -- décisions avant toute MÉDIANE
  c_max           constant int := 50;  -- plafond de chaque tableau rendu
  -- En dessous de cette durée, une « décision » n'en est pas une : elle
  -- a été saisie dans la foulée de l'envoi. Le seul devis de la
  -- production a été décidé en 19 secondes.
  c_instantane_s  constant int := 120;

  v_today  date;
  v_from   date;
  v_to     date;

  -- La population décidée.
  v_n            int;
  v_acceptes     int;
  v_refuses      int;
  v_expires      int;
  v_annules      int;
  v_autres       int;
  v_instantanes  int;
  v_incoherents  int;   -- décidés AVANT d'être envoyés : données fausses
  v_delai_med    numeric;
  v_delai_min    numeric;
  v_delai_max    numeric;
  v_taux         numeric;
  v_motif_taux   text;
  v_motif_delai  text;

  -- Les refus et leurs motifs.
  v_motifs           jsonb;
  v_refus_total      int;
  v_refus_sans_motif int;
  v_refus_sans_date  int;

  -- Le pipeline.
  v_pipeline       jsonb;
  v_opp_total      int;
  v_opp_ouvertes   int;
  v_motif_pipeline text;

  -- Les relances commerciales.
  v_relances       jsonb;
  v_act_total      int;
  v_act_retard     int;
  v_motif_relances text;

  -- Le marquage de lecture.
  v_envoyes    int;
  v_sans_marque int;

  -- Ce qui est lu ailleurs plutôt que recalculé.
  v_brief       jsonb;
  v_renvoi      jsonb;
begin
  -- Le droit de base de tout l'opérationnel de l'IA, puis celui des
  -- devis. Les deux LÈVENT : un flux commercial amputé se lirait comme
  -- un flux commercial vide.
  perform public.ai_guard(p_organization_id, 'projects.read');
  perform public.ai_guard(p_organization_id, 'quotes.read');

  v_today := (now() at time zone 'Europe/Paris')::date;
  v_from  := coalesce(p_from, v_today - 365);
  v_to    := coalesce(p_to,   v_today);

  if v_to < v_from then
    raise exception 'Période inversée : du % au %.', v_from, v_to;
  end if;
  -- Une fenêtre non bornée ferait sortir l'historique commercial complet
  -- de l'entreprise à chaque question posée.
  if (v_to - v_from) > 1100 then
    raise exception 'Fenêtre trop large : % jours, 1100 au plus.', v_to - v_from;
  end if;

  -- ---------- LES DÉCISIONS DE LA FENÊTRE ----------
  -- `decided_at is not null` est la frontière avec le briefing de
  -- direction. `sent_at is not null` en plus : un devis décidé sans
  -- avoir été envoyé n'a pas de délai, et il ne doit pas peser sur une
  -- médiane de délai en y entrant avec un NULL silencieux.
  with d as (
    select q.status,
           extract(epoch from (q.decided_at - q.sent_at)) as secondes
    from public.quotes q
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.sent_at is not null
      and q.decided_at is not null
      and (q.decided_at at time zone 'Europe/Paris')::date between v_from and v_to
  )
  select
    count(*)::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int,
    count(*) filter (where status = 'expired')::int,
    count(*) filter (where status = 'cancelled')::int,
    count(*) filter (where status not in ('accepted','rejected','expired','cancelled'))::int,
    count(*) filter (where secondes >= 0 and secondes < c_instantane_s)::int,
    count(*) filter (where secondes < 0)::int,
    -- La médiane, le minimum et le maximum ne sont calculés que sur les
    -- délais SENSÉS : une durée négative est une donnée fausse, pas un
    -- client très rapide.
    percentile_cont(0.5) within group (order by secondes / 86400.0)
      filter (where secondes >= 0),
    min(secondes / 86400.0) filter (where secondes >= 0),
    max(secondes / 86400.0) filter (where secondes >= 0)
    into v_n, v_acceptes, v_refuses, v_expires, v_annules, v_autres,
         v_instantanes, v_incoherents, v_delai_med, v_delai_min, v_delai_max
  from d;

  -- LE TAUX. Il n'est calculé qu'au-dessus du seuil, et le motif dit
  -- exactement pourquoi il ne l'est pas — y compris que le chiffre
  -- refusé serait arithmétiquement juste. « Je ne sais pas » et « je
  -- refuse de conclure » ne sont pas la même phrase.
  if v_n = 0 then
    v_taux := null;
    v_motif_taux := 'Aucun devis décidé dans la période : il n''y a pas de taux à calculer, et ce n''est pas un taux de zéro.';
  elsif v_n < c_seuil_taux then
    v_taux := null;
    v_motif_taux := format(
      'Taux refusé : %s décision(s) sur les %s nécessaires. Le taux vaudrait %s %% et serait exact ; '
      || 'il ne décrirait rien, puisque le devis suivant le déplacerait de %s points.',
      v_n, c_seuil_taux, round(100.0 * v_acceptes / v_n, 1), round(100.0 / (v_n + 1), 0));
  else
    v_taux := round(100.0 * v_acceptes / v_n, 1);
    v_motif_taux := null;
  end if;

  -- LA MÉDIANE. Seuil plus bas qu'un taux, parce qu'une médiane de
  -- délai est plus stable qu'une proportion — mais seuil quand même.
  if v_n < c_seuil_delai then
    v_delai_med := null;
    v_motif_delai := format(
      'Délai médian refusé : %s décision(s) sur les %s nécessaires. Le minimum et le maximum '
      || 'restent rendus : ce sont des faits observés, pas des statistiques.',
      v_n, c_seuil_delai);
  else
    v_motif_delai := null;
  end if;

  if v_instantanes > 0 then
    v_motif_delai := concat_ws(' ', v_motif_delai, format(
      '%s décision(s) sont tombées moins de %s secondes après l''envoi : cela ressemble à une saisie '
      || 'faite dans la foulée, pas à une réponse de client.', v_instantanes, c_instantane_s));
  end if;
  if v_incoherents > 0 then
    v_motif_delai := concat_ws(' ', v_motif_delai, format(
      '%s devis portent une date de décision ANTÉRIEURE à leur date d''envoi : ces lignes sont '
      || 'exclues des délais et signalent une saisie à corriger.', v_incoherents));
  end if;

  -- ---------- POURQUOI ON PERD ----------
  -- Sur toute l'histoire non archivée et non bornée par la fenêtre : un
  -- motif de refus vieux de deux ans reste un motif de refus, et il
  -- n'y en a jamais assez pour qu'une fenêtre serve à quelque chose.
  select
    coalesce(jsonb_agg(jsonb_build_object('motif', m.motif, 'nombre', m.n)
                       order by m.n desc, m.motif), '[]'::jsonb)
    into v_motifs
  from (
    select q.rejection_reason as motif, count(*)::int as n
    from public.quotes q
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.status = 'rejected'
      and q.rejection_reason is not null
      and btrim(q.rejection_reason) <> ''
    group by 1
    order by 2 desc, 1
    limit c_max
  ) m;

  select count(*)::int,
         count(*) filter (where q.rejection_reason is null or btrim(q.rejection_reason) = '')::int,
         count(*) filter (where q.decided_at is null)::int
    into v_refus_total, v_refus_sans_motif, v_refus_sans_date
  from public.quotes q
  where q.organization_id = p_organization_id
    and q.archived_at is null
    and q.status = 'rejected';

  -- ---------- LE PIPELINE ----------
  select count(*)::int,
         count(*) filter (where o.archived_at is null and o.closed_at is null)::int
    into v_opp_total, v_opp_ouvertes
  from public.crm_opportunities o
  where o.organization_id = p_organization_id;

  select coalesce(jsonb_agg(s.ligne order by s.etape), '[]'::jsonb)
    into v_pipeline
  from (
    select o.stage as etape,
      jsonb_build_object(
        'etape', o.stage,
        'nombre', count(*)::int,
        -- ESTIMATION SAISIE À LA MAIN, PAS UN MONTANT DE DEVIS. Et NULL
        -- si aucune ligne de l'étape ne porte de valeur : une étape sans
        -- montant saisi n'est pas une étape à zéro euro.
        'valeurEstimeeCents', sum(o.estimated_value_cents)
          filter (where o.estimated_value_cents is not null),
        'avecValeurEstimee', count(*) filter (where o.estimated_value_cents is not null)::int,
        -- Le NOMBRE d'opportunités portant une probabilité, jamais la
        -- moyenne : une moyenne de probabilités sur des lignes dont la
        -- plupart sont vides est une prévision déguisée.
        'avecProbabilite', count(*) filter (where o.probability_percent is not null)::int,
        'prochaineClotureAttendue', min(o.expected_close_date)
      ) as ligne
    from public.crm_opportunities o
    where o.organization_id = p_organization_id
      and o.archived_at is null
      and o.closed_at is null
    group by o.stage
  ) s;

  if v_opp_total = 0 then
    v_motif_pipeline := 'L''écran Opportunités existe et personne ne l''a jamais rempli : aucune ligne n''a été '
      || 'créée depuis l''ouverture de l''entreprise. C''est un défaut de saisie, pas un pipeline vide.';
  elsif v_opp_ouvertes = 0 then
    v_motif_pipeline := format(
      '%s opportunité(s) ont existé, aucune n''est ouverte aujourd''hui : elles sont toutes closes ou archivées.',
      v_opp_total);
  else
    v_motif_pipeline := null;
  end if;

  -- ---------- LES RELANCES COMMERCIALES EN RETARD ----------
  -- Les activités du CRM, et elles seules. Une facture en retard n'est
  -- pas une relance commerciale : elle appartient à la Facturation, et
  -- cette fonction ne la regarde jamais.
  select count(*)::int
    into v_act_total
  from public.crm_activities a
  where a.organization_id = p_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'nature', s.activity_type, 'nombre', s.n, 'plusAncienneEcheance', s.plus_vieille)
           order by s.n desc, s.activity_type), '[]'::jsonb),
         coalesce(sum(s.n), 0)::int
    into v_relances, v_act_retard
  from (
    select a.activity_type, count(*)::int as n, min(a.due_at) as plus_vieille
    from public.crm_activities a
    where a.organization_id = p_organization_id
      and a.archived_at is null
      and a.due_at is not null
      and a.due_at < now()
      and a.completed_at is null
    group by a.activity_type
  ) s;

  if v_act_total = 0 then
    v_motif_relances := 'Aucune activité commerciale n''a jamais été saisie dans ce produit : ce n''est pas '
      || '« aucune relance en retard », c''est « le journal du CRM est vide ».';
  else
    v_motif_relances := null;
  end if;

  -- ---------- LE MARQUAGE DE LECTURE ----------
  select count(*)::int, count(*) filter (where q.viewed_at is null)::int
    into v_envoyes, v_sans_marque
  from public.quotes q
  where q.organization_id = p_organization_id
    and q.archived_at is null
    and q.sent_at is not null;

  -- ---------- CE QUI EST LU AILLEURS ----------
  -- LE POINT LE PLUS IMPORTANT DE CETTE FONCTION. Les devis encore
  -- ouverts ne sont pas recomptés : ils sont LUS dans le briefing, et
  -- le chiffre rendu ici est littéralement celui du briefing.
  v_brief := public.ai_executive_brief(p_organization_id);

  -- ══════════════════════════════════════════════════════════════════
  -- DEUX CORRECTIONS ICI, ET ELLES VIENNENT DE LA MÊME RELECTURE
  -- ══════════════════════════════════════════════════════════════════
  --
  -- 1. LE FILTRE PORTAIT SUR L'AGENT, L'ÉTIQUETTE ANNONÇAIT DES
  --    SECTIONS. Le briefing émet TROIS familles de lignes sous
  --    'quote_pricing' : §2 les devis sans réponse (categorie
  --    'opportunite'), §3 ceux qui expirent (categorie 'urgent') et §4
  --    ceux sous l'objectif de marge (categorie 'optimisation'). Un
  --    filtre sur le seul agent laissait donc entrer §4 dans un bloc
  --    nommé « renvoiDevisOuverts » — et un devis sous sa marge cible
  --    n'est pas un devis en attente de réponse. Le modèle l'aurait
  --    présenté comme tel, en toute bonne foi.
  --
  -- 2. LES LIGNES TRANSPORTAIENT DES MONTANTS ET UNE ACTION QUE CET
  --    AGENT S'INTERDIT. La ligne §2 du briefing porte 'impactCents'
  --    (la valeur HT des devis en attente) et 'actionsDisponibles'
  --    contenant 'quoteFollowUp'. Or la description de l'outil affirme
  --    « AUCUN MONTANT DE DEVIS N'EST RENDU », son champ « fournit » est
  --    vide, et l'une de ses limites lui interdit de proposer la
  --    relance de devis. Les trois étaient démentis par la charge
  --    utile : un euro relayé reste un euro rendu, et un modèle qui
  --    voit une action dans ses données la propose.
  --
  --    On DÉPOUILLE donc les lignes relayées plutôt que d'assouplir la
  --    promesse. L'agent cite le titre du briefing — qui compte des
  --    devis, pas des euros — et renvoie au Chiffrage, qui possède le
  --    montant et l'action. C'est exactement ce que ses limites
  --    annoncent.
  select coalesce(jsonb_agg(
           (e.value - 'impactCents' - 'impactTexte'
                    - 'actionRecommandee' - 'actionsDisponibles')
           || jsonb_build_object(
                'montantRetire',
                'Le montant et l''action ont été retirés de cette ligne : ils appartiennent au '
                || 'Chiffrage. Cite le titre et renvoie-lui la main.')
           order by e.ordinality), '[]'::jsonb)
    into v_renvoi
  from jsonb_array_elements(v_brief -> 'actionsPrioritaires') with ordinality e
  where e.value ->> 'agent' = 'quote_pricing'
    -- Les devis ENCORE OUVERTS, et eux seuls : §2 et §3. La §4 (marge
    -- sous l'objectif) reste au Chiffrage sans transiter par ici.
    and e.value ->> 'categorie' in ('opportunite', 'urgent');

  return jsonb_build_object(
    'agent', 'sales',
    'organisationId', p_organization_id,
    'aujourdhuiParis', v_today,

    'fenetre', jsonb_build_object(
      'du', v_from, 'au', v_to,
      'porteSur', 'decided_at',
      'note', 'Cette fonction ne regarde QUE les devis déjà décidés. Les devis encore ouverts '
              || '(envoyés ou vus, sans décision) appartiennent au briefing de direction et au Chiffrage : '
              || 'voir « renvoiDevisOuverts ».'),

    'decisions', jsonb_build_object(
      'nombre', v_n,
      'acceptes', v_acceptes,
      'refuses', v_refuses,
      'expires', v_expires,
      'annules', v_annules,
      'autresStatuts', v_autres,
      'tauxDeSignaturePct', v_taux,
      'tauxMotif', v_motif_taux,
      'delaiMedianJours', case when v_delai_med is not null then round(v_delai_med, 2) end,
      'delaiMinimumJours', case when v_delai_min is not null then round(v_delai_min, 4) end,
      'delaiMaximumJours', case when v_delai_max is not null then round(v_delai_max, 4) end,
      'delaiMotif', v_motif_delai,
      'decisionsQuasiInstantanees', v_instantanes,
      'secondesQuasiInstantane', c_instantane_s,
      'decisionsAvantEnvoi', v_incoherents),

    'refus', jsonb_build_object(
      'nombre', v_refus_total,
      'motifs', v_motifs,
      'sansMotifSaisi', v_refus_sans_motif,
      'sansDateDeDecision', v_refus_sans_date,
      'note', case when v_refus_total = 0
        then 'Aucun devis refusé n''est enregistré. Cela ne veut pas dire que vous ne perdez jamais : '
             || 'cela veut dire qu''aucun refus n''a été saisi.'
        when v_refus_sans_motif = v_refus_total
        then 'Aucun des refus enregistrés ne porte de motif : la raison de vos pertes n''est nulle part.'
        end),

    'pipeline', jsonb_build_object(
      'parEtape', v_pipeline,
      'opportunitesOuvertes', v_opp_ouvertes,
      'opportunitesTotalTouteHistoire', v_opp_total,
      'motif', v_motif_pipeline),

    'relancesCommercialesEnRetard', jsonb_build_object(
      'nombre', v_act_retard,
      'parNature', v_relances,
      'activitesTotalTouteHistoire', v_act_total,
      'motif', v_motif_relances),

    'marquageDeLecture', jsonb_build_object(
      'devisEnvoyes', v_envoyes,
      'sansMarqueDeLecture', v_sans_marque,
      'note', 'viewed_at est une SAISIE HUMAINE (lib/quotes/actions.ts) : ce produit n''a aucun accusé '
              || 'de lecture. La seule phrase autorisée est « personne n''a marqué ce devis comme vu ». '
              || '« Le client ne l''a pas ouvert » est fausse et interdite.'),

    'renvoiDevisOuverts', jsonb_build_object(
      'lignesDuBriefing', v_renvoi,
      'candidatsAnalysesParLeBriefing', v_brief -> 'candidatsAnalyses',
      'droitsManquantsDuBriefing', v_brief -> 'droitsManquants',
      'source', 'ai_executive_brief, sections 2 et 3 uniquement — filtré sur agent = quote_pricing ET '
                || 'categorie dans (opportunite, urgent). La section 4 (devis sous l''objectif de marge) '
                || 'porte le même agent et NE PASSE PAS par ici : ce n''est pas un devis en attente de '
                || 'réponse, et la confondre en ferait une.',
      'note', 'Ces lignes ne sont pas recalculées ici : elles sortent du briefing de direction, '
              || 'DÉPOUILLÉES de leur montant et de leur action — les deux appartiennent au Chiffrage. '
              || 'Cite le titre, jamais un euro, et renvoie au Chiffrage pour la relance. '
              || 'Le briefing ne rend que ses cinq premières lignes classées : une liste vide ici ne '
              || 'prouve donc pas qu''aucun devis ne dort, seulement qu''aucun n''est dans le top 5.'),

    'seuils', jsonb_build_object(
      'decisionsPourUnTaux', c_seuil_taux,
      'decisionsPourUneMediane', c_seuil_delai,
      'note', 'Ces seuils sont appliqués par le SQL, pas demandés au modèle.'),

    'nonMesurable', jsonb_build_object(
      'montantsDeDevis', 'Aucun montant n''est rendu ici, dans aucune fenêtre : le prix, le coût et la '
        || 'marge d''un devis appartiennent au Chiffrage (ai_quote_price_analysis, quote_totals).',
      'devisEncoreOuverts', 'Les devis dormants et ceux qui expirent sont calculés par ai_executive_brief '
        || '(sections 2 et 3) et attribués à quote_pricing. Ils sont LUS ici, jamais recalculés, et '
        || 'dépouillés de leur montant. Les devis sous l''objectif de marge (section 4) ne passent pas '
        || 'du tout par cette fonction.',
      'apresAcceptation', 'Une fois le devis accepté, le dossier suit chez la Facturation '
        || '(ai_billing_candidates, dont la section 3 filtre status = accepted).',
      'relanceDeDevis', 'L''action « relancer un devis » est au catalogue sous quoteFollowUp, agent '
        || 'quote_pricing, droit quotes.edit. Cet agent ne la propose pas ; il dit qui la porte.',
      'previsionDeChiffreDAffaires', 'Aucune prévision de signature ni de chiffre d''affaires à venir. '
        || 'Le nombre d''opportunités portant une probabilité est rendu ; aucune valeur pondérée ne l''est.',
      'preuveDOuverture', 'Aucune. viewed_at est une saisie manuelle, pas un traceur.'),

    'confiance', case
      when v_n = 0 and v_opp_total = 0 and v_act_total = 0 then 'insufficient_data'
      when v_n < c_seuil_taux then 'low'
      when v_n < 50 then 'medium'
      else 'high' end);
end;
$$;

comment on function public.ai_sales_flow(uuid, date, date) is
  'Agent Ventes : la fenêtre REFERMÉE du devis (sent_at → decided_at), le pipeline CRM et les relances commerciales. Ne rend aucun montant de devis, aucune prévision, et aucun taux sous vingt décisions. Les devis encore ouverts sont lus dans ai_executive_brief, jamais recalculés.';



-- ------------------------------------------------------------
-- 2.2 — `ai_internal_history` : L'ENTREPRISE COMPARÉE À SON PROPRE PASSÉ.
-- ------------------------------------------------------------
--
-- ============================================================
-- POURQUOI CETTE FONCTION NE S'APPELLE PAS `ai_market_*`
-- ============================================================
--
-- L'agent porte la clé `market` parce que le routeur, `AGENTS_MODELE`
-- et l'alias `market_intelligence` la connaissent déjà. Mais il n'a
-- accès à AUCUNE donnée extérieure à l'entreprise, et un agent qui
-- « analyse le marché » à partir des seules données d'un client
-- invente. Le nom de la fonction dit donc ce qu'elle fait vraiment :
-- elle compare l'entreprise À SON PROPRE PASSÉ.
--
-- Le bloc `sourceExterneAbsente` est la seconde moitié de cette
-- honnêteté : plutôt que de laisser l'agent s'excuser, la fonction
-- NOMME ce qu'il faudrait brancher pour qu'une question de marché
-- devienne répondable. Un refus qui dit quoi faire ensuite vaut mieux
-- qu'un refus poli.
--
-- ============================================================
-- CE QUI RESTE APRÈS AVOIR RETIRÉ CE QUI EST DÉJÀ POSSÉDÉ
-- ============================================================
--
-- L'axe « historique interne » est déjà occupé sur ses deux tiers, et
-- c'est vérifié dans le code de 0073, pas supposé :
--
--   • `ai_finance_margin_breakdown(p_dimension)` accepte 'service',
--     'mois', 'ville', 'client', 'chantier', 'commercial', 'equipe'.
--     La marge par service ET la saisonnalité par mois sont donc à la
--     Finance.
--   • Les taux de transformation et les délais de décision sont à
--     `ai_sales_flow` (section 2.1 de ce fichier).
--   • L'évolution du prix des CHANTIERS COMPARABLES est à
--     `ai_quote_comparables`, qui refuse déjà sous cinq comparables.
--
-- Restent trois questions que personne ne sert, et c'est mince mais
-- réel :
--
--   1. D'où viennent les clients (`crm_customers.source`). L'agent
--      Clients regarde UN client et s'interdit explicitement toute
--      phrase de portefeuille.
--   2. Le prix unitaire d'un ARTICLE dans le temps.
--      `ai_quote_price_analysis` regarde un devis entier,
--      `ai_quote_comparables` des totaux de chantiers ; le prix
--      unitaire par article par mois n'est calculé nulle part.
--   3. L'écart entre ce qu'on devise et ce qu'on facture.
--
-- ============================================================
-- DEUX PIÈGES DE SCHÉMA, MESURÉS ET NON DEVINÉS
-- ============================================================
--
--   • `quote_lines` n'a PAS de colonne `unit_price_cents`. Le prix de
--     vente unitaire s'appelle `unit_sale_price_cents` ; il existe en
--     plus `unit_cost_cents`. Confondre les deux ferait rendre un coût
--     d'achat pour un prix de vente.
--   • `invoice_lines` n'a PAS de colonne `catalog_item_id` — seule
--     `quote_lines` en porte une. La comparaison devis/facture passe
--     donc par le LIBELLÉ, ce qui est fragile, et la fonction le dit
--     dans son propre `note` plutôt que de laisser le modèle croire à
--     un rapprochement fiable.

create or replace function public.ai_internal_history(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- ALIGNÉ SUR `ai_quote_comparables` (0073, c_seuil constant int := 5).
  -- On ne pose pas un second seuil pour la même question.
  c_seuil        constant int := 5;
  c_mois_saison  constant int := 24;
  c_max          constant int := 50;

  -- L'origine des clients.
  v_origine        jsonb;
  v_cli_total      int;
  v_cli_avec_src   int;
  v_src_distinctes int;
  v_motif_origine  text;

  -- Le prix unitaire par article.
  v_prix            jsonb;
  v_lignes_total    int;
  v_lignes_article  int;
  v_articles        int;
  v_articles_seuil  int;
  -- Le nombre TOTAL de couples article x mois, pour que la troncature du
  -- tableau se voie au lieu de se deviner.
  v_couples_total   int;
  v_motif_prix      text;

  -- Devisé contre facturé.
  v_ecarts jsonb;
  v_lignes_facture int;

  -- La saisonnalité.
  v_mois_devis      int;
  v_mois_chantiers  int;
  v_motif_saison    text;

  -- Les achats, nommés séparément.
  v_fournisseurs int;
  v_prix_fourn   int;
begin
  -- Deux droits, et les deux LÈVENT. Cette fonction lit le portefeuille
  -- clients ET les lignes de devis : un seul des deux droits donnerait
  -- une moitié de réponse qui se lirait comme une réponse entière.
  perform public.ai_guard(p_organization_id, 'clients.read');
  perform public.ai_guard(p_organization_id, 'quotes.read');

  -- ---------- 1. D'OÙ VIENNENT LES CLIENTS ----------
  select count(*)::int,
         count(*) filter (where c.source is not null and btrim(c.source) <> '')::int,
         count(distinct c.source) filter (where c.source is not null and btrim(c.source) <> '')::int
    into v_cli_total, v_cli_avec_src, v_src_distinctes
  from public.crm_customers c
  where c.organization_id = p_organization_id
    and c.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', s.source, 'nombre', s.n, 'convertis', s.conv)
           order by s.n desc, s.source), '[]'::jsonb)
    into v_origine
  from (
    select c.source, count(*)::int as n,
           count(*) filter (where c.converted_at is not null)::int as conv
    from public.crm_customers c
    where c.organization_id = p_organization_id
      and c.archived_at is null
      and c.source is not null and btrim(c.source) <> ''
    group by 1
    order by 2 desc, 1
    limit c_max
  ) s;

  -- AUCUNE PART EN POURCENTAGE sous le seuil. Une source qui représente
  -- « 100 % de vos clients » quand vous en avez un est une phrase vraie
  -- qui ne décrit rien.
  if v_cli_avec_src = 0 then
    v_motif_origine := format(
      'Aucun de vos %s client(s) ne porte de source renseignée : l''origine de votre portefeuille '
      || 'n''est pas mesurable. C''est un champ vide, pas une absence d''origine.', v_cli_total);
  elsif v_cli_avec_src < c_seuil then
    v_motif_origine := format(
      'Parts refusées : %s client(s) avec une source sur les %s nécessaires. Les lignes brutes sont '
      || 'rendues ; le pourcentage ne l''est pas.', v_cli_avec_src, c_seuil);
  elsif v_cli_avec_src < v_cli_total then
    v_motif_origine := format(
      'Compté sur %s client(s) sur %s : les %s autres n''ont aucune source renseignée et sont hors du calcul.',
      v_cli_avec_src, v_cli_total, v_cli_total - v_cli_avec_src);
  else
    v_motif_origine := null;
  end if;

  -- ---------- 2. LE PRIX UNITAIRE PAR ARTICLE, DANS LE TEMPS ----------
  select count(*)::int,
         count(*) filter (where l.catalog_item_id is not null)::int,
         count(distinct l.catalog_item_id)::int
    into v_lignes_total, v_lignes_article, v_articles
  from public.quote_lines l
  join public.quotes q on q.id = l.quote_id
  where q.organization_id = p_organization_id
    and q.archived_at is null;

  -- Combien d'articles atteignent le seuil : le compte est fait ICI
  -- pour que le modèle n'ait pas à décider lui-même s'il a le droit de
  -- parler d'évolution.
  select count(*)::int
    into v_articles_seuil
  from (
    select l.catalog_item_id
    from public.quote_lines l
    join public.quotes q on q.id = l.quote_id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and l.catalog_item_id is not null
    group by l.catalog_item_id
    having count(distinct l.quote_id) >= c_seuil
  ) a;

  select coalesce(jsonb_agg(jsonb_build_object(
           'articleId', s.catalog_item_id,
           'article', s.nom,
           'mois', s.mois,
           'lignes', s.n,
           'devisDistincts', s.devis,
           -- PRIX DE VENTE unitaire : `unit_sale_price_cents`, jamais
           -- `unit_cost_cents`. Voir l'en-tête.
           'prixUnitaireMinCents', s.mn,
           'prixUnitaireMaxCents', s.mx,
           -- L'article franchit-il le seuil ? Répondu LIGNE PAR LIGNE,
           -- pour que le modèle n'ait pas à rapprocher lui-même un
           -- compte global d'un tableau tronqué.
           'atteintLeSeuil', s.qualifie)
           order by s.qualifie desc, s.nom nulls last, s.mois), '[]'::jsonb)
    into v_prix
  from (
    select m.catalog_item_id, m.nom, m.mois, m.n, m.devis, m.mn, m.mx,
           -- ══════════════════════════════════════════════════════════
           -- LE TRI SE FAIT PAR PERTINENCE, PAS PAR ORDRE ALPHABÉTIQUE
           -- ══════════════════════════════════════════════════════════
           --
           -- Ce bloc était trié par NOM d'article puis tronqué à
           -- c_max. Les deux autres tableaux de cette fonction sont
           -- triés par pertinence décroissante, ce qui rend leur
           -- troncature bénigne ; celui-ci était l'exception, et elle
           -- coûtait cher.
           --
           -- LE DÉFAUT, ÉPROUVÉ : avec soixante articles cités une fois
           -- et un seul cité six fois, « articlesAtteignantLeSeuil »
           -- valait 1 — et l'article en question était ABSENT du
           -- tableau, éjecté par l'ordre alphabétique. Le modèle lisait
           -- « un article sur soixante et un autorise une phrase sur
           -- l'évolution du prix », puis n'avait sous les yeux que
           -- soixante articles qui ne l'autorisent pas. La pente
           -- naturelle est qu'il parle de l'un d'eux : le résultat
           -- plausible et faux que cet agent existe pour empêcher.
           --
           -- LE SEUIL SE LIT SUR L'ARTICLE, PAS SUR LE MOIS. Un article
           -- cité par six devis répartis sur six mois franchit le seuil
           -- alors qu'aucun de ses mois n'en approche : le compte doit
           -- donc venir d'un agrégat SÉPARÉ, joint ligne à ligne. Une
           -- fonction de fenêtrage aurait été plus courte, mais
           -- PostgreSQL n'implémente pas « count(distinct …) over (…) ».
           (a.devis_article >= c_seuil) as qualifie
    from (
      select l.catalog_item_id,
             ci.name as nom,
             date_trunc('month', q.issued_on)::date as mois,
             count(*)::int as n,
             count(distinct l.quote_id)::int as devis,
             -- PRIX DE VENTE unitaire : `unit_sale_price_cents`, jamais
             -- `unit_cost_cents`. Voir l'en-tête.
             min(l.unit_sale_price_cents) as mn,
             max(l.unit_sale_price_cents) as mx
      from public.quote_lines l
      join public.quotes q on q.id = l.quote_id
      left join public.catalog_items ci
        on ci.id = l.catalog_item_id and ci.organization_id = p_organization_id
      where q.organization_id = p_organization_id
        and q.archived_at is null
        and l.catalog_item_id is not null
        and q.issued_on is not null
      group by l.catalog_item_id, ci.name, date_trunc('month', q.issued_on)::date
    ) m
    join (
      -- Le compte de devis distincts PAR ARTICLE, toutes périodes
      -- confondues. Il reprend mot pour mot le filtre de
      -- « v_articles_seuil » plus haut — sans quoi un article pourrait
      -- être compté qualifié ici et pas là, et les deux chiffres du
      -- même bloc se contrediraient.
      select l.catalog_item_id as aid,
             count(distinct l.quote_id)::int as devis_article
      from public.quote_lines l
      join public.quotes q on q.id = l.quote_id
      where q.organization_id = p_organization_id
        and q.archived_at is null
        and l.catalog_item_id is not null
      group by l.catalog_item_id
    ) a on a.aid = m.catalog_item_id
    order by qualifie desc, m.nom nulls last, m.mois
    limit c_max
  ) s;

  -- LE NOMBRE TOTAL DE COUPLES ARTICLE × MOIS, pour que la troncature
  -- se voie. Un tableau tronqué sans indicateur se lit comme un tableau
  -- complet, et c'est la moitié du défaut ci-dessus.
  select count(*)::int
    into v_couples_total
  from (
    select 1
    from public.quote_lines l
    join public.quotes q on q.id = l.quote_id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and l.catalog_item_id is not null
      and q.issued_on is not null
    group by l.catalog_item_id, date_trunc('month', q.issued_on)::date
  ) c;

  if v_lignes_article = 0 then
    v_motif_prix := format(
      'Aucune de vos %s lignes de devis n''est rattachée à un article du catalogue : l''évolution '
      || 'd''un prix unitaire n''est pas suivable. C''est un rattachement absent, pas un prix stable.',
      v_lignes_total);
  elsif v_articles_seuil = 0 then
    v_motif_prix := format(
      'Évolution refusée : aucun de vos %s article(s) devisé(s) n''apparaît dans %s devis distincts. '
      || 'Les fourchettes observées sont rendues telles quelles ; aucune tendance n''en est tirée.',
      v_articles, c_seuil);
  else
    v_motif_prix := format(
      '%s article(s) sur %s atteignent %s devis distincts : eux seuls autorisent une phrase sur '
      || 'l''évolution du prix.', v_articles_seuil, v_articles, c_seuil);
  end if;

  -- ---------- 3. DEVISÉ CONTRE FACTURÉ ----------
  -- Rapprochement par LIBELLÉ, faute de `catalog_item_id` sur
  -- `invoice_lines`. Les zéros de ce bloc sont de vrais zéros : « zéro
  -- ligne de facture portant ce libellé » est une mesure, pas une
  -- ignorance.
  select count(*)::int
    into v_lignes_facture
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object(
           'libelle', s.lib, 'lignesDevis', s.nd, 'lignesFacture', s.nf)
           order by (s.nd + s.nf) desc, s.lib), '[]'::jsonb)
    into v_ecarts
  from (
    select coalesce(d.lib, f.lib) as lib,
           coalesce(d.n, 0)::int as nd,
           coalesce(f.n, 0)::int as nf
    from (
      select lower(btrim(l.description)) as lib, count(*)::int as n
      from public.quote_lines l
      join public.quotes q on q.id = l.quote_id
      where q.organization_id = p_organization_id
        and q.archived_at is null
        and l.description is not null and btrim(l.description) <> ''
      group by 1
    ) d
    full outer join (
      select lower(btrim(il.description)) as lib, count(*)::int as n
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
      where i.organization_id = p_organization_id
        and i.archived_at is null
        and i.status <> 'cancelled'
        and il.description is not null and btrim(il.description) <> ''
      group by 1
    ) f on f.lib = d.lib
    order by (coalesce(d.n, 0) + coalesce(f.n, 0)) desc, 1
    limit c_max
  ) s;

  -- ---------- 4. LA SAISONNALITÉ ----------
  select count(distinct date_trunc('month', q.issued_on))::int
    into v_mois_devis
  from public.quotes q
  where q.organization_id = p_organization_id
    and q.archived_at is null
    and q.issued_on is not null;

  select count(distinct date_trunc('month', p.actual_end_on))::int
    into v_mois_chantiers
  from public.projects p
  where p.organization_id = p_organization_id
    and p.archived_at is null
    and p.actual_end_on is not null;

  if greatest(v_mois_devis, v_mois_chantiers) < c_mois_saison then
    v_motif_saison := format(
      'Saisonnalité non calculable : %s mois de devis et %s mois de chantiers terminés, sur les %s '
      || 'nécessaires. Une saison se compare à la même saison de l''année précédente. Ce n''est pas '
      || '« aucune saisonnalité détectée », c''est « pas assez d''histoire pour en détecter une ».',
      v_mois_devis, v_mois_chantiers, c_mois_saison);
  else
    v_motif_saison := format(
      'Assez d''histoire pour en parler (%s mois de devis, %s mois de chantiers) — mais la découpe '
      || 'par mois appartient à la Finance : ai_finance_margin_breakdown(p_dimension := ''mois'').',
      v_mois_devis, v_mois_chantiers);
  end if;

  -- ---------- 5. LES ACHATS, NOMMÉS SÉPARÉMENT ----------
  select count(*)::int into v_fournisseurs from public.suppliers s
   where s.organization_id = p_organization_id;
  select count(*)::int into v_prix_fourn from public.supplier_prices sp
   where sp.organization_id = p_organization_id;

  return jsonb_build_object(
    'agent', 'market',
    'nomLisible', 'Historique interne',
    'organisationId', p_organization_id,
    'aujourdhuiParis', (now() at time zone 'Europe/Paris')::date,

    'avertissement', 'Tout ce qui suit vient de VOS données et de rien d''autre. Aucune ligne de cette '
      || 'réponse ne décrit le marché, la concurrence ou un prix pratiqué ailleurs. Les formulations '
      || 'autorisées sont « chez vous », « dans vos devis », « sur vos chantiers » ; le mot « marché » '
      || 'ferait comprendre « les autres » et il est interdit ici.',

    'origineDesClients', jsonb_build_object(
      'parSource', v_origine,
      'clientsTotal', v_cli_total,
      'clientsAvecSource', v_cli_avec_src,
      'sourcesDistinctes', v_src_distinctes,
      -- Les parts ne sont rendues qu'au-dessus du seuil, et elles sont
      -- calculées ICI : le modèle ne divise pas.
      'partsPct', case when v_cli_avec_src >= c_seuil then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'source', e.value ->> 'source',
                 'partPct', round(100.0 * (e.value ->> 'nombre')::int / v_cli_avec_src, 1))), '[]'::jsonb)
        from jsonb_array_elements(v_origine) e) end,
      'motif', v_motif_origine),

    'prixUnitaireParArticle', jsonb_build_object(
      'parArticleEtParMois', v_prix,
      'lignesDeDevisTotal', v_lignes_total,
      'lignesRattacheesAUnArticle', v_lignes_article,
      'articlesDistincts', v_articles,
      'articlesAtteignantLeSeuil', v_articles_seuil,
      -- LA TRONCATURE SE DIT. Sans ces trois champs, un tableau coupé
      -- se lit comme un tableau complet.
      'couplesArticleMoisTotal', v_couples_total,
      'couplesRendus', jsonb_array_length(v_prix),
      'tronque', (v_couples_total > jsonb_array_length(v_prix)),
      'motif', v_motif_prix,
      'note', 'Le prix rendu est unit_sale_price_cents (prix de VENTE unitaire). unit_cost_cents, '
              || 'le coût d''achat, n''est jamais rendu ici. '
              || 'Le tableau est trié PAR PERTINENCE : les articles qui atteignent le seuil viennent '
              || 'en premier et portent « atteintLeSeuil » à vrai. Si « tronque » vaut vrai, les '
              || 'couples absents sont tous des articles SOUS le seuil — donc aucun de ceux dont tu '
              || 'aurais le droit de commenter l''évolution.'),

    'deviseContreFacture', jsonb_build_object(
      'parLibelle', v_ecarts,
      'lignesDeFactureRetenues', v_lignes_facture,
      'note', 'Rapprochement par LIBELLÉ, et il est fragile : invoice_lines ne porte aucun '
              || 'catalog_item_id, seul quote_lines en a un. Deux libellés voisins ne se rejoignent pas, '
              || 'et un libellé réécrit à la facture apparaît des deux côtés séparément. À lire comme '
              || 'une piste, pas comme un écart mesuré.'),

    'saisonnalite', jsonb_build_object(
      'moisDistinctsDeDevis', v_mois_devis,
      'moisDistinctsDeChantiersTermines', v_mois_chantiers,
      'moisNecessaires', c_mois_saison,
      'mesurable', greatest(v_mois_devis, v_mois_chantiers) >= c_mois_saison,
      'motif', v_motif_saison),

    -- LA DÉCLARATION DE CE QUI MANQUE, PORTÉE PAR L'AGENT LUI-MÊME.
    'sourceExterneAbsente', jsonb_build_object(
      'disponible', false,
      'motif', 'capaciteAbsente',
      'explication', 'Ce produit n''a aucune capacité de recherche extérieure et aucune table de '
        || 'citations : les outils du registre sont tous des fonctions Supabase lisant vos propres '
        || 'tables. Aucun prix de marché, aucune part de marché, aucun concurrent n''existe nulle part '
        || 'dans cette base.',
      'aBrancher', 'Une recherche web exécutée côté serveur, et une table de sources '
        || '(source, url, date de consultation) pour que chaque chiffre extérieur soit citable et '
        || 'daté — comme la spec p. 16 l''exige. Sans cela, toute réponse sur le marché serait '
        || 'plausible et fausse, ce qui est le pire des deux mondes.'),

    'achats', jsonb_build_object(
      'fournisseurs', v_fournisseurs,
      'prixFournisseurs', v_prix_fourn,
      'note', 'Les prix d''achat appartiennent à l''agent Achats. Les deux comptes sont donnés '
              || 'séparément parce que « aucun fournisseur » et « des fournisseurs sans prix » sont '
              || 'deux situations différentes, et la réponse à donner n''est pas la même.'),

    'seuils', jsonb_build_object(
      'pointsDeComparaison', c_seuil,
      'moisPourLaSaisonnalite', c_mois_saison,
      'note', 'Le seuil de comparaison est celui de ai_quote_comparables (0073) : même question, '
              || 'même chiffre, pas un second seuil concurrent.'),

    'nonMesurable', jsonb_build_object(
      'prixDuMarche', 'Aucun prix pratiqué hors de cette entreprise n''existe dans cette base. Voir '
        || 'sourceExterneAbsente pour ce qu''il faudrait brancher.',
      'partDeMarche', 'Le dénominateur — la taille du marché — n''existe dans aucune table.',
      'concurrents', 'Aucun concurrent n''est nommé nulle part : crm_customers.lost_reason, '
        || 'crm_opportunities.lost_reason et quotes.rejection_reason sont les seuls endroits où '
        || 'l''information pourrait vivre.',
      'prixFournisseurs', 'Domaine de l''agent Achats (suppliers, supplier_prices).',
      'margeParServiceVilleOuMois', 'La Finance la calcule déjà, dimension par dimension : '
        || 'ai_finance_margin_breakdown accepte service, mois, ville, client, chantier, commercial, equipe.',
      'tauxDeTransformation', 'Ils appartiennent à l''agent Ventes (ai_sales_flow).',
      'fourchetteDesChantiersComparables', 'ai_quote_comparables (agent quote_pricing), qui refuse déjà sous cinq comparables.'),

    'confiance', case
      when v_cli_avec_src < c_seuil and v_articles_seuil = 0 then 'insufficient_data'
      when v_articles_seuil = 0 then 'low'
      else 'medium' end);
end;
$$;

comment on function public.ai_internal_history(uuid) is
  'Agent Marché, qui s''appelle en réalité Historique interne : l''entreprise comparée à SON PROPRE PASSÉ — origine des clients, prix unitaire par article dans le temps, devisé contre facturé. Ne rend aucun prix de marché, aucune part de marché, aucun concurrent, et déclare la source externe qu''il faudrait brancher pour que ces questions deviennent répondables.';



-- ------------------------------------------------------------
-- 2.3 — `ai_risk_snapshot` : CE QUI SE MESURE, ET RIEN DE PLUS.
-- ------------------------------------------------------------
--
-- ============================================================
-- LA RÈGLE QUE CETTE FONCTION EXISTE POUR TENIR
-- ============================================================
--
-- « Trois factures dépassent leur échéance » se MESURE. « Ce client
-- paiera sans doute en retard » se DÉDUIT. Les deux phrases se
-- ressemblent et n'ont pas la même valeur ; un agent qui les mélange
-- fait passer une intuition pour un relevé.
--
-- Cette fonction ne rend QUE des mesures : des comptes, des
-- dénominateurs, des dates. Chaque bloc porte `nature: 'mesure'`. Les
-- déductions restent au modèle, qui a l'obligation de les annoncer
-- comme telles — et `regleDEtiquetage` le lui rappelle dans la réponse
-- elle-même plutôt que dans un prompt qu'un réglage pourrait un jour
-- ne plus injecter.
--
-- ============================================================
-- AUCUN SCORE, AUCUNE PROBABILITÉ, AUCUN FEU TRICOLORE
-- ============================================================
--
-- Un score de risque agrégé mélange des mesures et des déductions dans
-- un seul nombre et fait disparaître exactement la distinction que cet
-- agent existe pour tenir. Une probabilité d'impayé n'a aucun
-- historique derrière elle : zéro règlement enregistré, zéro date de
-- fin prévue, zéro opportunité clôturée.
--
-- ET LA PHRASE « AUCUN RISQUE DÉTECTÉ » EST INTERDITE, en toutes
-- lettres, dans le champ `phraseInterdite`. Sur ces tables elle
-- voudrait dire « je n'ai rien à lire », et le dirigeant comprendrait
-- « tout va bien ». L'agent dit ce qu'il a regardé, ce qu'il y a
-- trouvé, et ce qu'il n'a pas pu regarder.
--
-- ============================================================
-- CE QUI EST LU AILLEURS PLUTÔT QUE RECALCULÉ
-- ============================================================
--
-- Les factures échues sont LUES dans `ai_billing_candidates` (sa
-- section 4). Elles ne sont pas recomptées ici, et c'est pour cela que
-- cette fonction exige les trois mêmes droits qu'elle : deux comptes
-- de factures en retard dans le même produit finiraient un jour par
-- différer, et personne ne saurait lequel croire.
--
-- Restent hors de cette fonction, et nommés dans `nonMesurable` : la
-- marge et sa dérive (Finance), le reste dû d'un client nommé (agent
-- Clients), les échéances réglementaires du parc (agent Matériel), les
-- devis qui expirent (Chiffrage).
--
-- ============================================================
-- LA CASCADE DE RETARDS : UN REFUS DÉFINITIF, ET IL EST VÉRIFIÉ
-- ============================================================
--
-- `project_tasks` ne porte AUCUNE colonne de dépendance. Ce n'est pas
-- une table vide qui se remplira : c'est une fonctionnalité absente du
-- schéma, et la cascade restera incalculable même quand les tables
-- seront pleines. La fonction ne l'AFFIRME pas — elle le VÉRIFIE, à
-- chaque appel, en interrogeant `information_schema.columns`. Le jour
-- où quelqu'un ajoutera `predecessor_id`, la réponse changera toute
-- seule au lieu de mentir par commentaire périmé.

create or replace function public.ai_risk_snapshot(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- LES SEUILS. Voir l'en-tête du fichier : douze = une observation par
  -- mois sur un an, dans un métier qui travaille au rythme des saisons.
  c_seuil_obs      constant int := 12;
  c_seuil_clients  constant int := 5;

  v_today date;

  -- La concentration.
  v_clients_fact int;
  v_fact_nb      int;
  v_max_ttc      bigint;
  v_tot_ttc      bigint;
  v_part         numeric;
  v_motif_conc   text;

  -- L'encours échu, LU chez la Facturation.
  v_bill        jsonb;
  v_retard_nb   int;
  v_retard_ttc  bigint;
  v_a_echoir_nb int;
  v_prochaine   date;
  v_echues_nb   int;

  -- Le comportement de paiement.
  v_reglements int;
  v_affect     int;
  v_motif_pay  text;

  -- La tenue des délais.
  v_pj_total     int;
  v_pj_avec_fin  int;
  v_pj_ouverts   int;
  v_pj_finis     int;
  v_pj_finis_ref int;
  v_ph_total     int;
  v_ph_avec_fin  int;
  v_motif_delais text;

  -- La cascade, vérifiée sur le schéma.
  v_col_dep int;
  v_taches  int;
begin
  -- LES TROIS MÊMES DROITS QUE `ai_billing_candidates`, qu'elle appelle.
  -- En exiger moins ferait échouer l'appel plus bas avec un message qui
  -- parlerait de la Facturation, pas du Risque.
  perform public.ai_guard(p_organization_id, 'projects.read');
  perform public.ai_guard(p_organization_id, 'invoice.create');
  perform public.ai_guard(p_organization_id, 'quotes.read');

  v_today := (now() at time zone 'Europe/Paris')::date;

  -- ---------- 1. LA CONCENTRATION DU CA FACTURÉ ----------
  -- POPULATION DIFFÉRENTE DE CELLE DE LA FINANCE, et c'est ce qui
  -- empêche le doublon : `ai_finance_margin_breakdown(dimension =
  -- 'client')` rend la MARGE des chantiers TERMINÉS par client. Ici on
  -- regarde le CA FACTURÉ, et on n'en rend qu'un RATIO — aucun euro,
  -- aucun nom de client. Le montant et la fiche appartiennent à la
  -- Finance et à l'agent Clients.
  with fact as (
    select i.customer_id, sum(b.total_including_vat_cents)::bigint as tot, count(*)::int as n
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.organization_id = p_organization_id
      and i.archived_at is null
      and i.status not in ('draft', 'cancelled')
      and i.customer_id is not null
    group by i.customer_id
  )
  select count(*)::int, coalesce(sum(n), 0)::int, max(tot), sum(tot)
    into v_clients_fact, v_fact_nb, v_max_ttc, v_tot_ttc
  from fact;

  if v_clients_fact = 0 then
    v_part := null;
    v_motif_conc := 'Aucune facture émise et non annulée : il n''y a pas de concentration à mesurer, '
      || 'et ce n''est pas une concentration nulle.';
  elsif v_clients_fact < c_seuil_clients then
    v_part := null;
    v_motif_conc := format(
      'Concentration refusée : %s client(s) facturé(s) sur les %s nécessaires. Le ratio vaudrait %s %% '
      || 'et serait arithmétiquement exact ; avec si peu de clients il ne décrit rien d''autre que le '
      || 'fait qu''il y en a peu.',
      v_clients_fact, c_seuil_clients,
      case when coalesce(v_tot_ttc, 0) > 0 then round(100.0 * v_max_ttc / v_tot_ttc, 1)::text else 'indéfini' end);
  elsif coalesce(v_tot_ttc, 0) <= 0 then
    v_part := null;
    v_motif_conc := 'Le total facturé est nul ou négatif (avoirs) : un ratio n''aurait pas de sens.';
  else
    v_part := round(100.0 * v_max_ttc / v_tot_ttc, 1);
    v_motif_conc := null;
  end if;

  -- ---------- 2. L'ENCOURS ÉCHU, LU CHEZ LA FACTURATION ----------
  v_bill := public.ai_billing_candidates(p_organization_id);
  v_retard_nb  := (v_bill -> 'facturesEnRetard' -> 'resume' ->> 'nombre')::int;
  v_retard_ttc := (v_bill -> 'facturesEnRetard' -> 'resume' ->> 'resteDuTtcCents')::bigint;

  -- Ce qui n'est PAS un recalcul : les échéances à venir. Elles servent
  -- à empêcher la lecture « zéro échu = tout le monde paie » — sans
  -- elles, un zéro se lit comme un satisfecit.
  select count(*)::int, min(i.due_on)
    into v_a_echoir_nb, v_prochaine
  from public.invoices i
  join public.invoice_balance b on b.invoice_id = i.id
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.issued_at is not null
    and i.status <> 'cancelled'
    and i.due_on is not null
    and i.due_on >= v_today
    and b.outstanding_cents > 0;

  -- Le DÉNOMINATEUR du comportement de paiement : combien d'échéances
  -- sont seulement ARRIVÉES. Sans lui, « zéro retard » sur zéro échéance
  -- passerait pour une performance.
  select count(*)::int
    into v_echues_nb
  from public.invoices i
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.issued_at is not null
    and i.status <> 'cancelled'
    and i.due_on is not null
    and i.due_on < v_today;

  -- ---------- 3. LE COMPORTEMENT DE PAIEMENT ----------
  select count(*)::int into v_reglements
  from public.payments p where p.organization_id = p_organization_id;
  select count(*)::int into v_affect
  from public.payment_allocations a where a.organization_id = p_organization_id;

  if v_reglements = 0 then
    v_motif_pay := 'Aucun règlement n''a jamais été enregistré dans ce produit. Conséquence directe et '
      || 'à dire au dirigeant : je ne peux pas distinguer une facture impayée d''une facture payée hors '
      || 'logiciel. Ce n''est pas « zéro retard de paiement ».';
  elsif v_echues_nb < c_seuil_obs then
    v_motif_pay := format(
      'Comportement de paiement non concluant : %s échéance(s) arrivée(s) sur les %s nécessaires. '
      || 'Les règlements enregistrés sont comptés ; aucune tendance n''en est tirée.',
      v_echues_nb, c_seuil_obs);
  else
    v_motif_pay := null;
  end if;

  -- ---------- 4. LA TENUE DES DÉLAIS ----------
  select count(*)::int,
         count(*) filter (where p.planned_end_on is not null)::int,
         count(*) filter (where p.status in ('planned', 'inProgress', 'onHold'))::int,
         count(*) filter (where p.status in ('completed', 'handedOver'))::int,
         count(*) filter (where p.status in ('completed', 'handedOver')
                            and p.planned_end_on is not null and p.actual_end_on is not null)::int
    into v_pj_total, v_pj_avec_fin, v_pj_ouverts, v_pj_finis, v_pj_finis_ref
  from public.projects p
  where p.organization_id = p_organization_id
    and p.archived_at is null;

  select count(*)::int, count(*) filter (where ph.planned_end_on is not null)::int
    into v_ph_total, v_ph_avec_fin
  from public.project_phases ph
  where ph.organization_id = p_organization_id;

  if v_pj_avec_fin = 0 and v_ph_avec_fin = 0 then
    v_motif_delais := format(
      'Aucune date de fin prévue n''est saisie, ni sur vos %s chantier(s) ni sur leurs %s phase(s). '
      || 'Sans promesse, il n''y a pas de retard à constater : ce n''est pas « aucun retard », c''est '
      || '« aucune référence ». C''est un défaut de saisie réparable.', v_pj_total, v_ph_total);
  elsif v_pj_finis_ref < c_seuil_obs then
    v_motif_delais := format(
      'Tenue des délais non concluante : %s chantier(s) terminé(s) portant à la fois une date de fin '
      || 'prévue et une date de fin réelle, sur les %s nécessaires.', v_pj_finis_ref, c_seuil_obs);
  else
    v_motif_delais := null;
  end if;

  -- ---------- 5. LA CASCADE, VÉRIFIÉE SUR LE SCHÉMA ----------
  select count(*)::int
    into v_col_dep
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'project_tasks'
    and c.column_name in ('predecessor_id', 'predecessor_task_id', 'depends_on',
                          'depends_on_task_id', 'blocked_by', 'blocked_by_task_id');

  select count(*)::int into v_taches
  from public.project_tasks t where t.organization_id = p_organization_id;

  return jsonb_build_object(
    'agent', 'risk',
    'organisationId', p_organization_id,
    'aujourdhuiParis', v_today,

    'regleDEtiquetage', 'Tout ce que rend cette fonction est une MESURE. Toute phrase que vous ajoutez '
      || 'et qui ne sort pas d''un de ces champs est une DÉDUCTION, et doit être présentée comme telle, '
      || 'avec le fait mesuré qui la porte.',

    'phraseInterdite', 'Aucun risque détecté',
    'pourquoiCettePhraseEstInterdite', 'Sur ces tables elle voudrait dire « je n''ai rien à lire », et '
      || 'elle serait comprise comme « tout va bien ». Dites ce que vous avez regardé, ce que vous y '
      || 'avez trouvé, et ce que vous n''avez pas pu regarder.',

    'concentrationClient', jsonb_build_object(
      'nature', 'mesure',
      'clientsFactures', v_clients_fact,
      'facturesRetenues', v_fact_nb,
      'partDuPremierClientPct', v_part,
      'motif', v_motif_conc,
      'note', 'Aucun euro et aucun nom de client ne sont rendus ici : le montant appartient à la '
              || 'Finance, la fiche à l''agent Clients. Cet agent ne rend qu''un ratio.'),

    'encoursEchu', jsonb_build_object(
      'nature', 'mesure',
      'facturesEnRetard', v_retard_nb,
      'resteDuEchuTtcCents', v_retard_ttc,
      'source', 'ai_billing_candidates, section 4 (agent billing)',
      'facturesNonEncoreEchues', v_a_echoir_nb,
      'prochaineEcheance', v_prochaine,
      'echeancesDejaArrivees', v_echues_nb,
      'note', case when v_retard_nb = 0 and v_a_echoir_nb > 0 then format(
          'Zéro facture en retard ne veut pas dire que tout le monde paie : cela veut dire que rien '
          || 'n''est encore exigible. %s facture(s) restent à échoir, la première le %s.',
          v_a_echoir_nb, v_prochaine)
        when v_retard_nb = 0 and v_a_echoir_nb = 0 then
          'Zéro facture en retard, et aucune facture en attente de règlement : il n''y a rien à surveiller '
          || 'aujourd''hui, ce qui est différent de « les clients paient bien ».'
        end),

    'comportementDePaiement', jsonb_build_object(
      'nature', 'mesure',
      'reglementsEnregistres', v_reglements,
      'affectationsAuxFactures', v_affect,
      'echeancesArrivees', v_echues_nb,
      'echeancesNecessaires', c_seuil_obs,
      'mesurable', (v_reglements > 0 and v_echues_nb >= c_seuil_obs),
      'motif', v_motif_pay),

    'tenueDesDelais', jsonb_build_object(
      'nature', 'mesure',
      'chantiers', v_pj_total,
      'chantiersAvecDateDeFinPrevue', v_pj_avec_fin,
      'chantiersOuverts', v_pj_ouverts,
      'chantiersTermines', v_pj_finis,
      'chantiersTerminesComparables', v_pj_finis_ref,
      'phases', v_ph_total,
      'phasesAvecDateDeFinPrevue', v_ph_avec_fin,
      'chantiersNecessaires', c_seuil_obs,
      'mesurable', (v_pj_finis_ref >= c_seuil_obs),
      'motif', v_motif_delais),

    'cascadeDeRetards', jsonb_build_object(
      'nature', 'mesure',
      'calculable', (v_col_dep > 0),
      'colonnesDeDependanceTrouvees', v_col_dep,
      'tachesEnregistrees', v_taches,
      'motif', case when v_col_dep = 0 then
          -- AU PRÉSENT CONSTATÉ, ET C'EST LE SUJET DE CET AGENT. La
          -- phrase disait « la cascade ne SERA PAS calculable même
          -- quand vos tables SERONT pleines » : une projection sur
          -- l'état futur du produit, dans un bloc qui porte
          -- « nature: mesure » et sous une règle d'étiquetage qui
          -- affirme que tout ce que rend cette fonction est une mesure.
          -- Un agent construit pour séparer ce qui se mesure de ce qui
          -- se déduit ne peut pas prédire dans le champ d'à côté — et
          -- un modèle recopie le registre de ce qu'il lit.
          --
          -- La branche « else » ci-dessous prévoit déjà que ce refus se
          -- périme tout seul le jour où les colonnes apparaîtront : la
          -- phrase n'a donc rien à annoncer sur l'avenir.
          'Ce produit n''enregistre aucune dépendance entre tâches : project_tasks ne porte aucune '
          || 'colonne de prédécesseur ni de blocage. Ce n''est pas une donnée manquante, c''est une '
          || 'fonctionnalité absente : tant qu''aucune colonne de dépendance n''existe, la cascade '
          || 'n''est pas calculable, et remplir vos tables n''y changerait rien. Vérifié sur le '
          || 'schéma à cet appel, pas déduit d''un commentaire.'
        else
          'Des colonnes de dépendance existent désormais sur project_tasks : la cascade redevient une '
          || 'question à instruire, et ce refus est périmé.'
        end),

    'seuils', jsonb_build_object(
      'observations', c_seuil_obs,
      'clientsPourParlerDeConcentration', c_seuil_clients,
      'note', 'Ces seuils sont appliqués par le SQL. Sous le seuil, la fonction rend NULL et un motif ; '
              || 'elle ne rend jamais un pourcentage calculé sur trois lignes.'),

    'nonMesurable', jsonb_build_object(
      'scoreDeRisque', 'Aucun score agrégé, aucune note sur dix, aucun feu tricolore. Un score mélange '
        || 'des mesures et des déductions dans un seul nombre et fait disparaître la distinction que cet '
        || 'agent existe pour tenir.',
      'probabilites', 'Aucune probabilité chiffrée d''impayé, de retard ou de perte : aucun historique '
        || 'ne la porte.',
      'margeEtSaDerive', 'La Finance la mesure : ai_executive_brief section 5 et '
        || 'ai_finance_margin_breakdown.',
      'resteDuDUnClientNomme', 'C''est la fiche client : ai_get_client_context et ai_customer_value '
        || '(agent customer).',
      'echeancesDuMateriel', 'Contrôle technique, VGP, révision : agent Matériel (ai_fleet_snapshot).',
      'devisQuiExpirent', 'ai_executive_brief section 3 (agent quote_pricing).',
      'facturesEnRetardRecalculees', 'Elles ne sont pas recomptées ici : le chiffre rendu vient de '
        || 'ai_billing_candidates. Deux comptes du même encours finiraient par différer.'),

    'confiance', case
      when v_clients_fact < c_seuil_clients and v_pj_finis_ref = 0 and v_reglements = 0
        then 'insufficient_data'
      when v_pj_finis_ref < c_seuil_obs then 'low'
      else 'medium' end);
end;
$$;

comment on function public.ai_risk_snapshot(uuid) is
  'Agent Risques : concentration client, encours échu (lu chez la Facturation, jamais recompté), comportement de paiement, tenue des délais. Ne rend que des MESURES, refuse tout score, toute probabilité et toute conclusion sous douze observations, et interdit en toutes lettres la phrase « aucun risque détecté ».';


-- ============================================================
-- 3. LES DROITS D'EXÉCUTION, PLUS SERRÉS QUE PAR DÉFAUT
-- ============================================================
-- Vérifié par requête sur `pg_proc.proacl` : les fonctions posées par
-- 0073 et 0082 portent toutes le grant par défaut de Supabase, qui
-- inclut `PUBLIC` et `anon`. Ce n'est pas une fuite — elles sont
-- `security invoker` et `ai_guard` lève dès `auth.uid()` nul — mais
-- c'est une surface offerte pour rien : un appelant non authentifié
-- peut aujourd'hui déclencher l'exécution d'une fonction et lire le
-- texte de son message d'erreur.
--
-- Les trois fonctions de ce fichier ne l'offrent pas. C'est le seul
-- endroit où 0088 est plus strict que ses prédécesseurs, et c'est
-- délibérément limité à ses propres fonctions : resserrer celles des
-- autres migrations depuis ici casserait un jour un appel qu'on n'a pas
-- vu, dans un fichier qu'on n'a pas lu.
--
-- DEUX RÉVOCATIONS ET NON UNE : Supabase pose `ALTER DEFAULT
-- PRIVILEGES` qui accorde `execute` nommément à `anon`, EN PLUS du
-- `PUBLIC` implicite des fonctions. Révoquer `from public` seul
-- laisserait la ligne `anon=X` intacte dans `proacl` et n'aurait rien
-- fermé du tout — c'est le genre de demi-mesure qui passe la relecture
-- et pas le test.
--
-- `service_role` est explicitement ré-accordé : il contourne la RLS
-- mais pas `ai_guard`, qui exige un membre d'organisation — un appel
-- `service_role` sans JWT utilisateur échouera de toute façon, et c'est
-- le comportement voulu.

revoke all on function public.ai_sales_flow(uuid, date, date) from public, anon;
revoke all on function public.ai_internal_history(uuid) from public, anon;
revoke all on function public.ai_risk_snapshot(uuid) from public, anon;

grant execute on function public.ai_sales_flow(uuid, date, date) to authenticated, service_role;
grant execute on function public.ai_internal_history(uuid) to authenticated, service_role;
grant execute on function public.ai_risk_snapshot(uuid) to authenticated, service_role;
