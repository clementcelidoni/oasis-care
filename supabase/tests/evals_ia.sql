-- Oasis Care — LA MOITIÉ « BASE » DES TESTS OBLIGATOIRES (spec p. 32).
--
-- CE FICHIER NE REFAIT PAS `architecture_ia.sql` NI `phase11v_agents.sql`.
-- Le cloisonnement A/B des agents, des budgets, du cache et des avis y est
-- déjà éprouvé, tout comme les verdicts de prix et les candidats à la
-- facturation. Ce test-ci couvre quatre points que ni l'un ni l'autre ne
-- touchent, et qui sont précisément ceux dont la suite d'évaluations
-- TypeScript (`web-pro/lib/ai/evals/`) ne peut RIEN dire :
--
--   1. LE VOCABULAIRE DES PANNES EST-IL LE MÊME DES DEUX CÔTÉS ?
--      `MOTIFS_PANNE` (lib/ai/runtime/types.ts) énumère six valeurs.
--      `ai_usage_events.failure_reason` porte un `check` avec six valeurs.
--      Personne ne vérifie que ce sont les mêmes. Le jour où elles
--      divergent, le journal LÈVE — et il lève au moment précis où
--      quelque chose va déjà mal, donc là où l'on a le plus besoin de la
--      ligne. Les six sont donc écrites ici une par une, et une septième
--      est refusée.
--
--   2. LA LIGNE DU REFUS BUDGÉTAIRE PASSE-T-ELLE ?
--      `run.ts` inscrit, quand un plafond coupe, une ligne à ZÉRO jeton,
--      sans coût et sans grille. Une contrainte du genre
--      `check (input_tokens > 0)` la ferait échouer en silence, et le
--      tableau de bord afficherait « aucune activité IA » pendant tout un
--      après-midi de coupure. C'est le pire affichage possible : il dit
--      l'inverse de ce qui se passe.
--
--   3. UN REPLI LAISSE-T-IL DEUX LIGNES IMPUTÉES À LA MÊME DÉCISION ?
--      C'est le « coût / décision » de la page 18. Une seule ligne
--      sous-compterait la dépense ET ferait disparaître le repli.
--
--   4. LES FONCTIONS ATTEIGNABLES PAR UN OUTIL SONT-ELLES NON VOLATILES,
--      DANS LE CATALOGUE RÉEL ?
--      `obligatoires.test.ts` lit les MIGRATIONS. Une migration peut dire
--      `stable` pendant que la production porte encore une version
--      `volatile` déployée avant. Seul `pg_proc` le sait. Tant que ces
--      fonctions sont non volatiles, PostgreSQL lui-même refuse toute
--      écriture à l'intérieur : c'est la garantie « l'IA ne touche pas
--      directement la base » (p. 32, ACTION) au niveau où elle ne dépend
--      plus de notre code.
--
-- Et une cinquième chose, qui n'est pas un test mais un FIL TENDU : les
-- quatre outils que la spec p. 10-11 nomme et que ce produit n'a pas
-- (coût de flotte, synthèse de planning, tarifs fournisseurs, distancier)
-- sont vérifiés ABSENTS. Trois cas d'évaluation sur sept sont marqués
-- « non exécutable » à cause d'eux ; le jour où l'un arrive, ce test
-- échoue et rappelle quel cas attend d'être branché — sans quoi il
-- resterait marqué « absent » alors que le produit saurait répondre.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris le compte de test.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).
-- Il suppose 0076 appliquée.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — une entreprise, un compte
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('e0000018-0000-4000-8000-000000000018','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','evals-ia@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','e0000018-0000-4000-8000-000000000018')::text, true);
insert into ids select 'org', public.create_professional_organization('Évaluations IA','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','e0000018-0000-4000-8000-000000000018')::text, true);
set local role authenticated;

insert into ids
select 'dec', public.ai_open_decision(
  (select v from ids where k='org'), 'quote_pricing', 'urgent',
  'Devis DEV-2026-0184 sous la marge cible', 'high',
  'Taux de marque 4,20 % contre 25 % visés : 8 008,00 € de marge manquante.');

-- ============================================================
-- 1. LES SIX MOTIFS DE PANNE, UN PAR UN
-- ============================================================
-- `MOTIFS_PANNE` côté TypeScript et le `check` de 0076 doivent énumérer
-- EXACTEMENT le même vocabulaire. Un motif qui passerait côté code et
-- pas côté base ferait lever le journal, et `usage.ts` avale
-- délibérément cette erreur pour ne pas perdre la réponse déjà payée :
-- la ligne disparaîtrait donc SANS que rien ne casse.

do $$
declare
  v_motif text;
  v_ok    boolean;
begin
  foreach v_motif in array array[
    'model_unavailable','rate_limit','timeout',
    'provider_error','budget_exceeded','other'
  ] loop
    begin
      perform public.ai_record_usage_event(
        p_organization_id => (select v from ids where k='org'),
        p_agent           => 'quote_pricing',
        p_model           => 'modele-evaluation',
        p_input_tokens    => 100,
        p_output_tokens   => 0,
        p_duration_ms     => 10,
        p_success         => false,
        p_tool_calls      => 0,
        p_failure_reason  => v_motif);
      v_ok := true;
    exception when others then
      v_ok := false;
    end;
    insert into res values (
      'Le motif de panne « ' || v_motif || ' » est accepté par le grand livre',
      'true', v_ok::text);
  end loop;
end $$;

-- Et un septième est REFUSÉ. Sans ce contrôle, le test ci-dessus
-- passerait aussi avec une colonne en texte libre — c'est-à-dire avec un
-- comptage de pannes faux dès la première faute de frappe.
do $$
declare v_refuse boolean;
begin
  begin
    perform public.ai_record_usage_event(
      p_organization_id => (select v from ids where k='org'),
      p_agent           => 'quote_pricing',
      p_model           => 'modele-evaluation',
      p_input_tokens    => 1, p_output_tokens => 0, p_duration_ms => 1,
      p_success         => false, p_tool_calls => 0,
      p_failure_reason  => 'time-out');
    v_refuse := false;
  exception when others then
    v_refuse := true;
  end;
  insert into res values (
    'Un motif de panne inventé est refusé, pas rangé en texte libre', 'true', v_refuse::text);
end $$;

-- ============================================================
-- 2. LE REFUS BUDGÉTAIRE — zéro jeton, aucun coût, et il PASSE
-- ============================================================
-- La ligne que `run.ts` écrit quand un plafond coupe : zéro entrée, zéro
-- sortie, zéro durée, aucun coût, aucune grille. Elle doit être acceptée
-- ET visible.

insert into ids
select 'refus', public.ai_record_usage_event(
  p_organization_id      => (select v from ids where k='org'),
  p_agent                => 'billing',
  p_model                => 'modele-evaluation',
  p_input_tokens         => 0,
  p_output_tokens        => 0,
  p_duration_ms          => 0,
  p_success              => false,
  p_tool_calls           => 0,
  p_estimated_cost_cents => null,
  p_cost_basis           => null,
  p_failure_reason       => 'budget_exceeded');

insert into res
select 'Un refus pour plafond s''inscrit au grand livre, à zéro jeton', 'true',
       ((select v from ids where k='refus') is not null)::text;

insert into res
select 'Ce refus est VISIBLE : sans lui, une coupure afficherait « aucune activité IA »',
       'budget_exceeded',
       (select failure_reason from public.ai_usage_events
        where id = (select v from ids where k='refus'));

insert into res
select 'Un refus n''invente pas un coût de zéro', 'true',
       (select (estimated_cost_cents is null)::text from public.ai_usage_events
        where id = (select v from ids where k='refus'));

-- ============================================================
-- 3. LE REPLI — deux lignes, une décision, un modèle d'origine
-- ============================================================

insert into ids
select 'echec', public.ai_record_usage_event(
  p_organization_id      => (select v from ids where k='org'),
  p_agent                => 'quote_pricing',
  p_model                => 'modele-evaluation-avance',
  p_input_tokens         => 0, p_output_tokens => 0, p_duration_ms => 30000,
  p_success              => false, p_tool_calls => 0,
  p_failure_reason       => 'timeout',
  p_decision_id          => (select v from ids where k='dec'));

insert into ids
select 'repli', public.ai_record_usage_event(
  p_organization_id      => (select v from ids where k='org'),
  p_agent                => 'quote_pricing',
  p_model                => 'modele-evaluation-standard',
  p_input_tokens         => 2400, p_output_tokens => 600, p_duration_ms => 4100,
  p_success              => true, p_tool_calls => 1,
  p_estimated_cost_cents => 120,
  p_cost_basis           => 'grille-evaluation',
  p_fallback_from_model  => 'modele-evaluation-avance',
  p_decision_id          => (select v from ids where k='dec'));

insert into res
select 'Une décision repliée porte DEUX lignes, pas une', '2',
       (select count(*)::text from public.ai_usage_events
        where decision_id = (select v from ids where k='dec'));

insert into res
select 'La seconde ligne nomme le modèle qu''on n''a pas pu joindre',
       'modele-evaluation-avance',
       (select fallback_from_model from public.ai_usage_events
        where id = (select v from ids where k='repli'));

insert into res
select 'La tentative en échec reste comptée : elle a consommé du temps', 'true',
       (select (duration_ms = 30000)::text from public.ai_usage_events
        where id = (select v from ids where k='echec'));

-- ============================================================
-- 4. LE COÛT NON TARIFÉ SE COMPTE À PART, ET N'EST PAS ZÉRO
-- ============================================================
-- Toutes les lignes écrites plus haut sauf une sont SANS coût. Le budget
-- doit dire combien, sinon la dépense affichée passerait pour complète.

insert into res
select 'Les appels non tarifés du jour sont comptés à part', 'true',
       (select ((b ->> 'unpriced_events_today')::int >= 8)::text
        from (select to_jsonb(t) as b
              from public.ai_cost_budget_remaining((select v from ids where k='org')) t) s);

insert into res
select 'Sans plafond posé, le reste est NULL et jamais zéro', 'true',
       (select ((b ->> 'daily_remaining_cents') is null)::text
        from (select to_jsonb(t) as b
              from public.ai_cost_budget_remaining((select v from ids where k='org')) t) s);

-- ============================================================
-- 5. ACTION — les fonctions des outils de LECTURE sont non volatiles
-- ============================================================
-- PostgreSQL REFUSE une écriture dans une fonction `stable` ou
-- `immutable` (« INSERT is not allowed in a non-volatile function »).
-- Tant que les quinze fonctions ci-dessous le sont, un appel d'outil ne
-- PEUT PAS écrire — même si quelqu'un glissait un `insert` dans l'une
-- d'elles, la base le refuserait à l'exécution.
--
-- La liste recopie le champ `rpc` de `lib/ai/runtime/tools.ts`. Un outil
-- ajouté là-bas sans être ajouté ici ne serait pas couvert : c'est
-- `obligatoires.test.ts` qui garde la liste complète, en relisant le
-- registre. Ici on éprouve le CATALOGUE RÉEL, que les migrations ne
-- disent pas.

insert into res
select 'Aucune fonction d''outil de lecture n''est volatile en production',
       '{}',
       coalesce(
         (select array_agg(p.proname order by p.proname)::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.provolatile = 'v'
            and p.proname = any (array[
              'ai_search_entities','ai_finance_snapshot','ai_finance_margin_breakdown',
              'ai_analyze_project_margin','ai_billing_candidates','ai_quote_price_analysis',
              'ai_quote_comparables','ai_get_digital_twin_quantities','ai_executive_brief',
              'ai_oasis_daily','ai_get_daily_priorities','ai_get_project_context',
              'ai_get_client_context','ai_find_stock','ai_forecast_availability'])),
         '{}');

-- Et la contrepartie : les quinze existent bel et bien. Une liste de
-- fonctions volatiles vide serait aussi le résultat d'une liste de
-- fonctions absentes.
insert into res
select 'Les quinze fonctions de lecture existent en production', '15',
       (select count(distinct p.proname)::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any (array[
            'ai_search_entities','ai_finance_snapshot','ai_finance_margin_breakdown',
            'ai_analyze_project_margin','ai_billing_candidates','ai_quote_price_analysis',
            'ai_quote_comparables','ai_get_digital_twin_quantities','ai_executive_brief',
            'ai_oasis_daily','ai_get_daily_priorities','ai_get_project_context',
            'ai_get_client_context','ai_find_stock','ai_forecast_availability']));

-- ============================================================
-- 6. LE FIL TENDU — les trois cas d'évaluation sans service
-- ============================================================
-- « Planning inefficace », « camion coûteux » et le chiffrage du
-- déplacement sont marqués NON EXÉCUTABLES dans la suite d'évaluations
-- parce qu'aucune fonction ne les sert. Le jour où l'une apparaît, cette
-- ligne rougit — et c'est le bon moment pour brancher le cas plutôt que
-- de le laisser marqué « absent » pendant deux ans.

insert into res
select 'Aucune fonction de coût de flotte, de synthèse de planning ou de distancier',
       '{}',
       coalesce(
         (select array_agg(p.proname order by p.proname)::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname like 'ai\_%'
            and (p.proname ~ '(fleet|flotte).*(cost|cout)'
              or p.proname ~ '(planning|schedule).*(summary|synthese|resume)'
              or p.proname ~ '(supplier|fournisseur).*(price|prix|tarif)'
              or p.proname ~ '(travel|trajet|distance|itinerair)')),
         '{}');

-- ============================================================
-- 7. LE VOCABULAIRE DES QUATRE AGENTS N'A PAS BOUGÉ
-- ============================================================
-- `AGENTS_PREMIERE_ITERATION` (definitions.ts) et `ai_is_supported_agent`
-- (0072) doivent rester d'accord. Trois des sept cas d'évaluation sont
-- « non exécutables » précisément parce que leur agent n'est pas de la
-- liste ; le jour où la base en accepte un cinquième, le cas
-- correspondant doit être rejoué plutôt qu'oublié.

insert into res
select 'La base n''accepte toujours que les quatre agents construits', 'true',
       (public.ai_is_supported_agent('executive')
        and public.ai_is_supported_agent('finance')
        and public.ai_is_supported_agent('billing')
        and public.ai_is_supported_agent('quote_pricing')
        and not public.ai_is_supported_agent('nursery')
        and not public.ai_is_supported_agent('fleet')
        and not public.ai_is_supported_agent('planning'))::text;

-- ============================================================
-- VERDICT
-- ============================================================
select nom,
       attendu,
       obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by (attendu is not distinct from obtenu), nom;

select count(*) filter (where attendu is not distinct from obtenu) as reussis,
       count(*) filter (where attendu is distinct from obtenu)     as echecs,
       count(*)                                                    as total
from res;

rollback;
