-- Oasis Care — §11Y, LES DIX AGENTS QUE LA BASE RECONNAÎT (migration 0082).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LES QUATRE ANCIENS SONT TOUJOURS LÀ. C'est le seul vrai danger
--      d'une réécriture de `ai_is_supported_agent` : une liste recopiée
--      à la main peut perdre une valeur en chemin, et personne ne s'en
--      apercevrait avant la prochaine écriture sur `ai_decisions` — au
--      moment où l'appel de modèle est déjà payé. On les revérifie une
--      par une, plutôt que de compter dix.
--
--   2. LES QUATRE FAÇADES SONT TOUJOURS REFUSÉES. `sales`, `market`,
--      `risk` et `classification` n'ont aucune donnée derrière eux. Les
--      accepter permettrait de leur fixer un plafond de coût et de leur
--      choisir un modèle — un réglage qui a l'air actif pour un agent
--      qui n'existe pas. Ce test est la seule chose qui empêche qu'on
--      les ajoute « pendant qu'on y est ».
--
--   3. LA CONTRAINTE MORD VRAIMENT. Une fonction juste ne prouve rien
--      si les `check` ne l'appellent pas : on écrit réellement une
--      ligne d'`ai_agent_settings` pour un nouvel agent (elle doit
--      passer) et pour une façade (elle doit être refusée). C'est la
--      différence entre « la liste est bonne » et « la liste protège ».
--
--   4. LA GRAPHIE. `quote_pricing` s'écrit avec un tiret bas ici et en
--      `quotePricing` dans le code ; les six nouveaux s'écrivent pareil
--      des deux côtés. On vérifie que la forme camel n'est PAS acceptée
--      par la base — sinon les deux graphies coexisteraient en table et
--      un agent aurait deux réglages.
--
--   5. L'IDEMPOTENCE. La migration est rejouée une seconde fois dans la
--      même transaction, et le résultat doit être identique. Une
--      migration qu'on n'ose pas rejouer est une migration qu'on
--      n'applique qu'une fois, à la main, en croisant les doigts.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK.
--
-- Pour le rejouer : jouer 0072 (au moins), puis 0082, puis ce fichier.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;

-- ============================================================
-- 1. Les dix acceptés, un par un
-- ============================================================
-- Nommés en toutes lettres et non lus depuis une liste : un test qui
-- lirait la même source que la fonction ne vérifierait que sa propre
-- cohérence.

insert into res values
  ('1a : executive accepté',     'true', public.ai_is_supported_agent('executive')::text),
  ('1b : finance accepté',       'true', public.ai_is_supported_agent('finance')::text),
  ('1c : billing accepté',       'true', public.ai_is_supported_agent('billing')::text),
  ('1d : quote_pricing accepté', 'true', public.ai_is_supported_agent('quote_pricing')::text),
  ('1e : operations accepté',    'true', public.ai_is_supported_agent('operations')::text),
  ('1f : planning accepté',      'true', public.ai_is_supported_agent('planning')::text),
  ('1g : procurement accepté',   'true', public.ai_is_supported_agent('procurement')::text),
  ('1h : nursery accepté',       'true', public.ai_is_supported_agent('nursery')::text),
  ('1i : fleet accepté',         'true', public.ai_is_supported_agent('fleet')::text),
  ('1j : customer accepté',      'true', public.ai_is_supported_agent('customer')::text);

-- ============================================================
-- 2. Les quatre façades restent dehors
-- ============================================================

insert into res values
  ('2a : sales refusé',          'false', public.ai_is_supported_agent('sales')::text),
  ('2b : market refusé',         'false', public.ai_is_supported_agent('market')::text),
  ('2c : risk refusé',           'false', public.ai_is_supported_agent('risk')::text),
  ('2d : classification refusé', 'false', public.ai_is_supported_agent('classification')::text);

-- Et le nom de la spec pour l'agent Marché non plus : `MarketIntelligenceAgent`
-- se normalise en `market` côté TypeScript, et rien ne doit rattraper
-- cette graphie-là en base.
insert into res values
  ('2e : market_intelligence refusé', 'false',
   public.ai_is_supported_agent('market_intelligence')::text);

-- ============================================================
-- 3. La graphie : camel refusé, tiret bas accepté
-- ============================================================
-- Si les deux passaient, un même agent aurait deux clés primaires
-- possibles dans `ai_agent_settings`, donc deux niveaux d'autonomie —
-- et celui qui gagnerait dépendrait de qui a écrit en dernier.

insert into res values
  ('3a : quotePricing (camel) refusé', 'false',
   public.ai_is_supported_agent('quotePricing')::text),
  ('3b : une graphie inconnue est refusée', 'false',
   public.ai_is_supported_agent('Operations')::text),
  ('3c : le vide est refusé', 'false',
   coalesce(public.ai_is_supported_agent('')::text, 'null')),
  ('3d : null ne rend pas true', 'false',
   coalesce(public.ai_is_supported_agent(null)::text, 'false'));

-- ============================================================
-- 4. La contrainte mord — on écrit vraiment
-- ============================================================
-- Une entreprise jetable, dans la transaction annulée. Elle est créée
-- par `create_professional_organization` et non par un `insert` direct :
-- `business_organizations` exige un `workspace_id` que seule cette
-- fonction sait poser, et la contourner reviendrait à éprouver une
-- table dans un état qu'aucun code de production ne produit.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('a0000082-0000-4000-8000-000000000082','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','agents-0082@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-000000000082')::text, true);

do $$
declare
  v_org uuid;
  v_ok_nouveau boolean := false;
  v_refus_facade boolean := false;
begin
  v_org := public.create_professional_organization('TEST 0082 — agents', 'landscaper');

  -- Un des six nouveaux doit passer.
  begin
    insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
    values (v_org, 'nursery', true, 2);
    v_ok_nouveau := true;
  exception when check_violation then
    v_ok_nouveau := false;
  end;

  -- Une façade doit être refusée par la contrainte, pas par une
  -- convention de nommage ni par la bonne volonté de l'appelant.
  begin
    insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
    values (v_org, 'risk', true, 2);
    v_refus_facade := false;
  exception when check_violation then
    v_refus_facade := true;
  end;

  insert into res values
    ('4a : un agent construit entre dans ai_agent_settings', 'true', v_ok_nouveau::text),
    ('4b : une façade est refusée par le check',             'true', v_refus_facade::text);
end;
$$;

-- ============================================================
-- 5. Rejouer la migration ne change rien
-- ============================================================
-- On rejoue le `create or replace` tel quel — le corps est recopié à
-- l'identique de 0082, et c'est voulu : si les deux divergeaient, ce
-- test passerait en vérifiant autre chose que la migration.

create or replace function public.ai_is_supported_agent(p_agent text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_agent in (
    'executive', 'finance', 'billing', 'quote_pricing',
    'operations', 'planning', 'procurement', 'nursery', 'fleet', 'customer'
  );
$$;

insert into res values
  ('5a : après rejeu, nursery toujours accepté', 'true',
   public.ai_is_supported_agent('nursery')::text),
  ('5b : après rejeu, risk toujours refusé', 'false',
   public.ai_is_supported_agent('risk')::text),
  ('5c : après rejeu, les quatre de 0072 tiennent', '4',
   (
     select count(*)::text
     from unnest(array['executive', 'finance', 'billing', 'quote_pricing']) a(cle)
     where public.ai_is_supported_agent(a.cle)
   ));

-- ============================================================
-- 6. Ouvrir un agent ne lui ouvre AUCUNE exécution
-- ============================================================
-- Deux registres d'écriture cohabitent, et les confondre serait la
-- faute la plus coûteuse ici :
--
--   • `ai_action_catalog` décide de ce qui peut S'EXÉCUTER (autopilote
--     compris) ;
--   • `PROPOSAL_KINDS` (TypeScript) décide de ce qui peut être PROPOSÉ
--     en brouillon, et un brouillon attend toujours un humain.
--
-- 0082 n'ajoute rien au premier. Les cinq nouveaux agents qui n'y
-- avaient aucune ligne n'en gagnent aucune ; `procurement`, lui, en
-- avait déjà une AVANT d'être un agent — `purchaseOrderSend`, posée
-- pour DÉCLARER que l'envoi d'une commande existe et qu'il ne partira
-- jamais seul. On vérifie les deux faits séparément, sinon un compte
-- global à « 1 » ne dirait pas lequel des deux a bougé.

insert into res
select '6a : aucune action au catalogue pour les cinq agents en lecture seule', '0',
       count(*)::text
from public.ai_action_catalog
where agent in ('operations', 'planning', 'nursery', 'fleet', 'customer');

insert into res
select '6b : la seule action Achats reste celle qui déclare un interdit', 'purchaseOrderSend',
       coalesce(string_agg(action_type, ',' order by action_type), '(aucune)')
from public.ai_action_catalog
where agent = 'procurement';

insert into res
select '6c : et elle n''est toujours pas automatisable', 'false',
       coalesce(bool_or(autopilot_eligible)::text, '(aucune)')
from public.ai_action_catalog
where agent = 'procurement';

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;


-- ############################################################
-- ############################################################
--
--   LES ÉPREUVES DES CINQ FONCTIONS DE LECTURE POSÉES PAR 0082
--
-- ############################################################
-- ############################################################
--
-- Ce qui précède éprouve la LISTE des agents. Ce qui suit éprouve ce
-- qu'ils ont à LIRE — et c'est la moitié qui coûte, parce qu'une
-- fonction juste sur des données inventées peut être fausse sur les
-- vraies.
--
-- CHAQUE BLOC EST AUTONOME : son propre `begin;`, ses propres fixtures
-- à DEUX entreprises, son propre `rollback;`. Deux entreprises et non
-- une, systématiquement : la question « est-ce que A voit les données
-- de B » ne se pose pas avec une seule, et c'est la seule dont la
-- réponse fausse serait une fuite plutôt qu'un bug.
--
-- Chaque bloc crée aussi un compte à DROITS RÉDUITS et vérifie que la
-- fonction LÈVE au lieu de rendre une liste vide. C'est le défaut que
-- ce produit a corrigé quatre fois — « zéro » lu pour « je ne sais
-- pas » — et le seul moyen de ne pas le reproduire une cinquième est
-- de le tester, pas de l'écrire dans un commentaire.
--
-- Pour les rejouer : 0072, puis 0082, puis ce fichier.



-- Oasis Care — §11Y, L'ÉPREUVE DE `ai_operations_snapshot`.
--
-- ============================================================
-- OÙ CE FICHIER DOIT FINIR
-- ============================================================
--
-- Dans `supabase/tests/agents_ia.sql`, qui appartient à l'intégration.
-- Il est écrit AUTONOME — son propre `begin`, sa propre table `res`, son
-- propre `rollback` — pour deux raisons : il se rejoue seul pendant
-- l'écriture de l'agent, et il s'ajoute au fichier d'intégration comme
-- une seconde transaction sans rien renommer.
--
--   node runsql.js .sb_token operations.sql operations.epreuve.sql
--
-- SANS EFFET DE BORD : tout est annulé, y compris les trois comptes.
--
-- ============================================================
-- CE QUE CETTE ÉPREUVE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. « ZÉRO EN RETARD » NE PEUT PAS SORTIR D'UN PORTEFEUILLE SANS
--      DATES. C'est la raison d'être de la fonction. Deux entreprises
--      sont montées exprès : l'une a une date de fin sur un chantier
--      ouvert et pas sur l'autre — le compteur vaut 1 et le motif dit
--      lequel est hors calcul ; l'autre n'en a aucune — le compteur vaut
--      NULL, et surtout PAS zéro.
--
--   2. LE CLOISONNEMENT. L'entreprise B a un chantier ouvert, une
--      intervention et un pointage non validé. Si un seul filtre
--      d'organisation manquait, ils apparaîtraient dans les compteurs de
--      A. Et depuis la peau de A, la fonction appelée sur B est refusée
--      — l'identifiant de B est pourtant connu de l'appelant.
--
--   3. UN DROIT MANQUANT REFUSE, IL NE REND PAS UNE VUE PARTIELLE. Un
--      compte sans `projects.read` obtient une exception. Une vue
--      amputée serait une réponse fausse, pas une réponse incomplète.
--
--   4. UN POINTAGE OUBLIÉ HORS FENÊTRE RESTE VISIBLE. C'est le seul
--      tableau volontairement non borné par la période : un pointage
--      vieux de six mois est précisément celui qu'il faut voir.
--
--   5. LES NULL SONT DES NULL. Avancement d'un chantier sans phase,
--      écart d'une intervention sans fin réelle : NULL, jamais zéro.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

-- Calculé UNE FOIS, à Paris : un test qui recalcule « aujourd'hui » à
-- chaque ligne échoue une nuit sur deux entre minuit et deux heures.
insert into cfg values ('today', (now() at time zone 'Europe/Paris')::date);

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000082-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ops-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000082-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ops-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000082-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ops-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Chantiers A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b1')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Chantiers B','landscaper');

-- LE COMPTE SANS `projects.read`. Il voit les clients, rien d'autre :
-- c'est le seul moyen d'éprouver le refus plutôt que la vue partielle.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000082-0000-4000-8000-0000000000c1', 'custom', array['clients.read']
from ids where k='orgA';

-- ---------- Le décor de A ----------
insert into ids select 'cliA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliA'), (select v from ids where k='orgA'),
       'Villa Aubépine', 'individual', 'customer';

insert into ids select 'empA', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empA'), (select v from ids where k='orgA'), 'Ana', 'Roux', 4000;

insert into ids select 'eqA', gen_random_uuid();
insert into public.teams (id, organization_id, name, color)
select (select v from ids where k='eqA'), (select v from ids where k='orgA'), 'ÉQUIPE A', '#123456';

-- PJ1 : OUVERT, EN RETARD, DEUX PHASES À 50 ET 100 %.
insert into ids select 'PJ1', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status, planned_end_on)
select (select v from ids where k='PJ1'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-OPS-1', 'Terrasse', 'inProgress', (select d from cfg where k='today') - 3;
insert into public.project_phases (organization_id, project_id, title, position, status, progress_percent, planned_end_on)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'Terrassement', 1, 'inProgress', 50,
       (select d from cfg where k='today') - 3;
insert into public.project_phases (organization_id, project_id, title, position, status, progress_percent)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'Plantation', 2, 'done', 100;

-- PJ2 : OUVERT, SANS DATE DE FIN, SANS PHASE. Il est ce qui rend le
-- retard partiellement mesurable, et son avancement doit valoir NULL.
insert into ids select 'PJ2', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='PJ2'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-OPS-2', 'Clôture', 'planned';

-- PJ3 : TERMINÉ. Il ne doit pas entrer dans le parc ouvert, mais il
-- compte dans la couverture des dates de fin.
insert into ids select 'PJ3', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status, actual_end_on)
select (select v from ids where k='PJ3'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-OPS-3', 'Haie', 'completed', (select d from cfg where k='today') - 20;

-- Les interventions : une avec les quatre horodatages (écart calculable),
-- une sans fin réelle (écart NULL), une hors fenêtre.
insert into public.field_interventions
  (organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end, actual_start, actual_end)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), (select v from ids where k='cliA'),
       (select v from ids where k='eqA'), 'work', 'Terrassement J1', 'done',
       ((((select d from cfg where k='today') - 2)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 2)::timestamp + time '16:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 2)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 2)::timestamp + time '18:00') at time zone 'Europe/Paris');

insert into public.field_interventions
  (organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), (select v from ids where k='cliA'),
       (select v from ids where k='eqA'), 'work', 'Terrassement J2', 'scheduled',
       ((((select d from cfg where k='today') + 1)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') + 1)::timestamp + time '16:00') at time zone 'Europe/Paris');

insert into public.field_interventions
  (organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), (select v from ids where k='cliA'),
       (select v from ids where k='eqA'), 'work', 'Vieille visite', 'done',
       ((((select d from cfg where k='today') - 200)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 200)::timestamp + time '10:00') at time zone 'Europe/Paris');

-- LE POINTAGE OUBLIÉ, VIEUX DE DEUX CENTS JOURS. Hors de toute fenêtre
-- raisonnable, et c'est exactement celui qu'il faut voir.
insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgA'), (select v from ids where k='empA'), (select v from ids where k='PJ1'),
       (select d from cfg where k='today') - 200, 5, 4000, 'work', false;
insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgA'), (select v from ids where k='empA'), (select v from ids where k='PJ1'),
       (select d from cfg where k='today') - 2, 8, 4000, 'work', true;

-- ---------- Le décor de B : rien de tout cela ne doit fuir chez A ----------
insert into ids select 'cliB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliB'), (select v from ids where k='orgB'), 'Parc B', 'company', 'customer';

insert into ids select 'empB', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empB'), (select v from ids where k='orgB'), 'Bo', 'Bee', 4000;

-- Ouvert, SANS date de fin : c'est le cas « retard non mesurable ».
insert into ids select 'PJB', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='PJB'), (select v from ids where k='orgB'), (select v from ids where k='cliB'),
       'CH-B-1', 'Bassin', 'inProgress';

insert into public.field_interventions
  (organization_id, project_id, customer_id, kind, title, status, scheduled_start, scheduled_end)
select (select v from ids where k='orgB'), (select v from ids where k='PJB'), (select v from ids where k='cliB'),
       'work', 'Intervention B', 'scheduled',
       ((((select d from cfg where k='today'))::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today'))::timestamp + time '12:00') at time zone 'Europe/Paris');

insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgB'), (select v from ids where k='empB'), (select v from ids where k='PJB'),
       (select d from cfg where k='today') - 1, 20, 4000, 'work', false;

-- ============================================================
-- 1. Vue de A — le retard PARTIELLEMENT mesurable
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a1')::text, true);
set local role authenticated;

create temp table snapA(j jsonb) on commit drop;
insert into snapA select public.ai_operations_snapshot((select v from ids where k='orgA'));

insert into res
select '1a : deux chantiers ouverts chez A, et pas trois', '2',
       (select j ->> 'chantiersOuverts' from snapA);

insert into res
select '1b : un seul est en retard, l''autre n''a pas de date', '1',
       (select j -> 'retard' ->> 'enRetard' from snapA);

insert into res
select '1c : le motif nomme le chantier hors calcul', 'true',
       (select (j -> 'retard' ->> 'motif') like '%hors du calcul%' from snapA)::text;

insert into res
select '1d : la couverture compte TOUT le portefeuille, pas seulement l''ouvert', '3',
       (select j -> 'retard' -> 'couverture' ->> 'chantiers' from snapA);

insert into res
select '1e : deux phases, une seule datée', '1',
       (select j -> 'retard' -> 'couverture' ->> 'phasesAvecDateDeFin' from snapA);

-- ============================================================
-- 2. Les NULL sont des NULL
-- ============================================================

insert into res
select '2a : l''avancement moyen de CH-OPS-1 est la moyenne de ses phases', '75',
       (select e ->> 'avancementMoyenPct' from snapA, jsonb_array_elements(j -> 'chantiers') e
        where e ->> 'numero' = 'CH-OPS-1');

insert into res
select '2b : un chantier SANS PHASE n''est pas à 0 % : il est à NULL', '(null)',
       (select coalesce(e ->> 'avancementMoyenPct', '(null)')
        from snapA, jsonb_array_elements(j -> 'chantiers') e
        where e ->> 'numero' = 'CH-OPS-2');

insert into res
select '2c : l''écart de fin est calculé par le SQL, pas par le modèle', '2.00',
       (select e ->> 'ecartFinHeures' from snapA, jsonb_array_elements(j -> 'interventions') e
        where e ->> 'titre' = 'Terrassement J1');

insert into res
select '2d : sans fin réelle, l''écart est NULL et non zéro', '(null)',
       (select coalesce(e ->> 'ecartFinHeures', '(null)')
        from snapA, jsonb_array_elements(j -> 'interventions') e
        where e ->> 'titre' = 'Terrassement J2');

insert into res
select '2e : et la durée réellement travaillée est déclarée inconnue', 'false',
       (select e ->> 'dureeReelleConnue' from snapA, jsonb_array_elements(j -> 'interventions') e
        where e ->> 'titre' = 'Terrassement J2');

-- ============================================================
-- 3. La fenêtre borne les interventions, PAS les pointages
-- ============================================================

insert into res
select '3a : la vieille visite de J-200 est hors de la fenêtre par défaut', '2',
       (select j ->> 'interventionsNombre' from snapA);

insert into res
select '3b : mais le pointage non validé de J-200 reste visible', '1',
       (select j ->> 'pointagesEnAttenteChantiers' from snapA);

insert into res
select '3c : et ses heures aussi', '5.00',
       (select j ->> 'heuresEnAttenteTotal' from snapA);

insert into res
select '3d : une fenêtre élargie retrouve la vieille visite', '3',
       (select public.ai_operations_snapshot((select v from ids where k='orgA'),
              (select d from cfg where k='today') - 300, (select d from cfg where k='today') + 30) ->> 'interventionsNombre');

-- ============================================================
-- 4. Le cloisonnement
-- ============================================================

insert into res
select '4a : le pointage de 20 h de B n''entre pas dans le total de A', '5.00',
       (select j ->> 'heuresEnAttenteTotal' from snapA);

insert into res
select '4b : l''intervention de B n''entre pas dans le compte de A', '2',
       (select j ->> 'interventionsNombre' from snapA);

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgB'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('4c : depuis A, la fonction appelée sur B est refusée', 'true', refuse::text);
end $$;

-- ============================================================
-- 5. Un droit manquant REFUSE
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('5a : sans projects.read, refus net plutôt que vue partielle', 'true', refuse::text);
end $$;

-- ============================================================
-- 6. Vue de B — le retard NON MESURABLE, et c'est le cœur du sujet
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b1')::text, true);
set local role authenticated;

create temp table snapB(j jsonb) on commit drop;
insert into snapB select public.ai_operations_snapshot((select v from ids where k='orgB'));

insert into res
select '6a : un chantier ouvert chez B', '1',
       (select j ->> 'chantiersOuverts' from snapB);

insert into res
select '6b : AUCUNE date de fin : le compteur de retard est NULL, PAS zéro', '(null)',
       (select coalesce(j -> 'retard' ->> 'enRetard', '(null)') from snapB);

insert into res
select '6c : et la fonction dit pourquoi, en français', 'true',
       (select (j -> 'retard' ->> 'motif') like '%pas mesurable%' from snapB)::text;

insert into res
select '6d : le refus « heures prévues » est porté par la donnée, pas par le prompt', 'true',
       (select (j -> 'nonMesurable' ->> 'tempsPrevu') is not null from snapB)::text;

-- Et il DISPARAÎT dès que la donnée existe : une phrase d'indisponibilité
-- qu'aucun remplissage ne fait taire finirait par mentir à son tour.
reset role;
insert into public.project_tasks (organization_id, project_id, title, position, status, planned_hours)
select (select v from ids where k='orgB'), (select v from ids where k='PJB'), 'Poser le liner', 1, 'todo', 6;

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b1')::text, true);
set local role authenticated;

insert into res
select '6e : une heure prévue enregistrée fait taire la phrase d''indisponibilité', '(null)',
       coalesce(public.ai_operations_snapshot((select v from ids where k='orgB'))
                -> 'nonMesurable' ->> 'tempsPrevu', '(null)');

-- ============================================================
-- 7. Les bornes
-- ============================================================

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgB'),
                                          current_date, current_date - 1);
  exception when others then refuse := true;
  end;
  insert into res values ('7a : une période inversée est refusée', 'true', refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgB'),
                                          current_date - 400, current_date);
  exception when others then refuse := true;
  end;
  insert into res values ('7b : une fenêtre de 400 jours est refusée', 'true', refuse::text);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;


-- Oasis Care — §11Y, L'ÉPREUVE DE `ai_planning_summary`.
--
-- ============================================================
-- OÙ CE FICHIER DOIT FINIR
-- ============================================================
--
-- Dans `supabase/tests/agents_ia.sql`, qui appartient à l'intégration.
-- Autonome — son `begin`, sa table `res`, son `rollback` — pour se
-- rejouer seul et s'y ajouter sans rien renommer.
--
--   node runsql.js .sb_token planning.sql planning.epreuve.sql
--
-- ============================================================
-- CE QUE CETTE ÉPREUVE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. LA RÈGLE DE `chargeDuJour`, PORTÉE EN SQL, DIT LA MÊME CHOSE
--      QU'À L'ÉCRAN. C'est la seule raison pour laquelle cette fonction
--      est difficile. Le jeu d'essai reproduit EXACTEMENT le cas qui a
--      produit le bug d'origine : un chantier de trois jours qui
--      recouvre une journée entière, et une visite d'une demi-journée
--      le même jour. Le mardi doit valoir « 4 h, incomplet », JAMAIS
--      « 28 h » (l'amplitude), JAMAIS « 4 h » sans le drapeau, et le
--      mercredi — jour entièrement recouvert par le seul chantier long
--      — doit valoir NULL et pas 24 h, ni 0 h.
--
--   2. LA FIN EST EXCLUSIVE. Une intervention qui s'arrête à minuit
--      pile n'occupe pas le lendemain. Une milliseconde, et elle vaut
--      une colonne entière du planning.
--
--   3. « RIEN N'EST POSÉ » N'EST PAS « L'ÉQUIPE EST LIBRE ». Le refus
--      est porté par la DONNÉE (`nonMesurable.disponibilite`), pas par
--      la mémoire du modèle. Une semaine vide rend
--      `insufficient_data`, pas une réponse rassurante.
--
--   4. LE CLOISONNEMENT ET LES DROITS. L'entreprise B a une semaine
--      chargée ; rien n'en paraît chez A. Un compte sans
--      `projects.read` est refusé.
--
--   5. CE QUE PERSONNE N'A PRIS SE NOMME. Une intervention sans équipe
--      disparaît d'un total par équipe ; une intervention sans date de
--      début n'apparaît sur AUCUNE colonne. Les deux sont comptées à
--      part plutôt qu'oubliées.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

-- LUNDI FIXE, ET PAS « AUJOURD'HUI ». La règle de `chargeDuJour` porte
-- sur des journées PARISIENNES : un test calé sur l'heure de la machine
-- passerait ou échouerait selon l'heure d'exécution. On fixe donc un
-- lundi de plein été (heure d'été, UTC+2) et on écrit toutes les heures
-- en heure de Paris.
insert into cfg values ('lundi', date '2026-06-01');

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000082-0000-4000-8000-0000000000a2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','plan-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000082-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','plan-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000082-0000-4000-8000-0000000000c2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','plan-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a2')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Planning A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b2')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Planning B','landscaper');

insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000082-0000-4000-8000-0000000000c2', 'custom', array['clients.read']
from ids where k='orgA';

-- ---------- Le décor de A ----------
insert into ids select 'cliA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliA'), (select v from ids where k='orgA'),
       'Domaine du Val', 'company', 'customer';

insert into ids select 'empA', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empA'), (select v from ids where k='orgA'), 'Iris', 'Nadal', 4000;

-- DEUX ÉQUIPES : l'une dont la composition est saisie, l'autre non.
-- « Zéro membre » et « composition non renseignée » ne sont pas la même
-- chose, et la fonction doit les distinguer.
insert into ids select 'eq1', gen_random_uuid();
insert into ids select 'eq2', gen_random_uuid();
insert into public.teams (id, organization_id, name, color)
select (select v from ids where k='eq1'), (select v from ids where k='orgA'), 'ÉQUIPE UN', '#111111';
insert into public.teams (id, organization_id, name, color)
select (select v from ids where k='eq2'), (select v from ids where k='orgA'), 'ÉQUIPE DEUX', '#222222';
insert into public.team_members (organization_id, team_id, employee_id)
select (select v from ids where k='orgA'), (select v from ids where k='eq1'), (select v from ids where k='empA');

-- ═══ LE CAS QUI A PRODUIT LE BUG D'ORIGINE ═══
-- « LONG » : lundi 12 h → jeudi 10 h, heure de Paris. Trois jours et
-- demi d'amplitude, soixante-dix heures calendaires. Il occupe lundi,
-- mardi, mercredi ET jeudi, et il ne doit compter pour AUCUNE heure sur
-- aucun d'eux.
insert into ids select 'ivLong', gen_random_uuid();
insert into public.field_interventions
  (id, organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end)
select (select v from ids where k='ivLong'), (select v from ids where k='orgA'), null,
       (select v from ids where k='cliA'), (select v from ids where k='eq1'),
       'work', 'LONG', 'scheduled',
       (((select d from cfg where k='lundi'))::timestamp + time '12:00') at time zone 'Europe/Paris',
       (((select d from cfg where k='lundi') + 3)::timestamp + time '10:00') at time zone 'Europe/Paris';

-- « COURTE » : mardi 8 h → 12 h, même équipe. Quatre heures exactement,
-- et un chevauchement avec LONG.
insert into ids select 'ivCourte', gen_random_uuid();
insert into public.field_interventions
  (id, organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end)
select (select v from ids where k='ivCourte'), (select v from ids where k='orgA'), null,
       (select v from ids where k='cliA'), (select v from ids where k='eq1'),
       'work', 'COURTE', 'scheduled',
       (((select d from cfg where k='lundi') + 1)::timestamp + time '08:00') at time zone 'Europe/Paris',
       (((select d from cfg where k='lundi') + 1)::timestamp + time '12:00') at time zone 'Europe/Paris';

-- « MINUIT » : vendredi 20 h → samedi 00 h 00 pile, sur l'ÉQUIPE DEUX.
-- La fin est exclusive : elle occupe le vendredi et PAS le samedi.
insert into public.field_interventions
  (organization_id, customer_id, team_id, kind, title, status, scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       (select v from ids where k='eq2'), 'work', 'MINUIT', 'scheduled',
       (((select d from cfg where k='lundi') + 4)::timestamp + time '20:00') at time zone 'Europe/Paris',
       (((select d from cfg where k='lundi') + 5)::timestamp + time '00:00') at time zone 'Europe/Paris';

-- « ORPHELINE » : posée le mercredi, sans équipe. Elle disparaîtrait
-- d'un total par équipe si personne ne la nommait.
insert into public.field_interventions
  (organization_id, customer_id, team_id, kind, title, status, scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       null, 'visit', 'ORPHELINE', 'scheduled',
       (((select d from cfg where k='lundi') + 2)::timestamp + time '09:00') at time zone 'Europe/Paris',
       (((select d from cfg where k='lundi') + 2)::timestamp + time '11:00') at time zone 'Europe/Paris';

-- « SANS DATE » : aucune date de début. Elle n'apparaît sur AUCUNE
-- colonne du planning — c'est le seul travail qu'on peut perdre de vue
-- entièrement.
insert into public.field_interventions
  (organization_id, customer_id, kind, title, status)
select (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'work', 'SANS DATE', 'scheduled';

-- « ANNULÉE » : posée le mardi sur l'équipe un. Elle ne doit compter
-- nulle part, ni en charge, ni en chevauchement.
insert into public.field_interventions
  (organization_id, customer_id, team_id, kind, title, status, scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       (select v from ids where k='eq1'), 'work', 'ANNULÉE', 'cancelled',
       (((select d from cfg where k='lundi') + 1)::timestamp + time '08:00') at time zone 'Europe/Paris',
       (((select d from cfg where k='lundi') + 1)::timestamp + time '18:00') at time zone 'Europe/Paris';

-- Une note de journée sur le jeudi, visible de toute l'entreprise.
insert into public.planning_day_notes (organization_id, day, team_id, body)
select (select v from ids where k='orgA'), (select d from cfg where k='lundi') + 3, null,
       'Livraison paillage 14 h.';

-- ---------- Le décor de B : une semaine chargée qui ne doit pas fuir ----------
insert into ids select 'cliB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliB'), (select v from ids where k='orgB'), 'Mairie B', 'company', 'customer';
insert into ids select 'eqB', gen_random_uuid();
insert into public.teams (id, organization_id, name, color)
select (select v from ids where k='eqB'), (select v from ids where k='orgB'), 'ÉQUIPE B', '#333333';
insert into public.field_interventions
  (organization_id, customer_id, team_id, kind, title, status, scheduled_start, scheduled_end)
select (select v from ids where k='orgB'), (select v from ids where k='cliB'),
       (select v from ids where k='eqB'), 'work', 'CHEZ B', 'scheduled',
       (((select d from cfg where k='lundi'))::timestamp + time '08:00') at time zone 'Europe/Paris',
       (((select d from cfg where k='lundi'))::timestamp + time '18:00') at time zone 'Europe/Paris';

-- ============================================================
-- 1. LA RÈGLE DE `chargeDuJour`, LE CŒUR DE CETTE FONCTION
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a2')::text, true);
set local role authenticated;

create temp table sA(j jsonb) on commit drop;
insert into sA select public.ai_planning_summary(
  (select v from ids where k='orgA'), (select d from cfg where k='lundi'), 7);

-- Le raccourci de lecture : (jour 0..6, nom d'équipe) → l'objet équipe.
create or replace function pg_temp.eq(p_jour int, p_equipe text)
returns jsonb language sql stable as $f$
  select e
  from sA, jsonb_array_elements(j -> 'jours') d, jsonb_array_elements(d -> 'equipes') e
  where (d ->> 'jour')::date = (select cfg.d from cfg where cfg.k='lundi') + p_jour
    and e ->> 'equipe' = p_equipe;
$f$;

insert into res
select '1a : LUNDI — le chantier long ne compte pour AUCUNE heure', '(null)',
       coalesce(pg_temp.eq(0, 'ÉQUIPE UN') ->> 'heuresConnues', '(null)');

insert into res
select '1b : et le lundi est déclaré incomplet', 'true',
       pg_temp.eq(0, 'ÉQUIPE UN') ->> 'incomplet';

insert into res
select '1c : MARDI — 4 h connues, celles de la visite, et rien du chantier long', '4.00',
       pg_temp.eq(1, 'ÉQUIPE UN') ->> 'heuresConnues';

insert into res
select '1d : le mardi porte bien DEUX interventions malgré ses 4 h', '2',
       pg_temp.eq(1, 'ÉQUIPE UN') ->> 'interventions';

insert into res
select '1e : et son total est annoncé MINORANT', 'true',
       pg_temp.eq(1, 'ÉQUIPE UN') ->> 'incomplet';

insert into res
select '1f : MERCREDI — journée entièrement recouverte : NULL, ni 24 h ni 0 h', '(null)',
       coalesce(pg_temp.eq(2, 'ÉQUIPE UN') ->> 'heuresConnues', '(null)');

insert into res
select '1g : le chantier long annonce ses quatre jours couverts', '4',
       (pg_temp.eq(2, 'ÉQUIPE UN') -> 'detail' -> 0 ->> 'joursCouverts');

insert into res
select '1h : JEUDI — il l''occupe encore, et toujours sans heure', '(null)',
       coalesce(pg_temp.eq(3, 'ÉQUIPE UN') ->> 'heuresConnues', '(null)');

-- ============================================================
-- 2. LA FIN EXCLUSIVE — une milliseconde vaut une colonne
-- ============================================================

insert into res
select '2a : VENDREDI — la visite qui finit à minuit y compte pour 4 h', '4.00',
       pg_temp.eq(4, 'ÉQUIPE DEUX') ->> 'heuresConnues';

insert into res
select '2b : et elle n''occupe PAS le samedi', '(aucune)',
       coalesce(pg_temp.eq(5, 'ÉQUIPE DEUX') ->> 'heuresConnues', '(aucune)');

insert into res
select '2c : le samedi de l''équipe deux n''existe même pas comme ligne', '0',
       (select count(*)::text
        from sA, jsonb_array_elements(j -> 'jours') d, jsonb_array_elements(d -> 'equipes') e
        where (d ->> 'jour')::date = (select cfg.d from cfg where cfg.k='lundi') + 5);

-- ============================================================
-- 3. LES CHEVAUCHEMENTS, ET CE QUI N'EN EST PAS UN
-- ============================================================

insert into res
select '3a : un seul chevauchement, sur l''équipe qui porte les deux', '1',
       (select jsonb_array_length(j -> 'chevauchements')::text from sA);

insert into res
select '3b : la paire est rendue dans l''ordre du temps, pas dans celui des UUID', 'LONG',
       (select j -> 'chevauchements' -> 0 -> 'premiere' ->> 'titre' from sA);

insert into res
select '3c : l''intervention ANNULÉE ne fabrique pas de faux conflit', 'false',
       (select (j -> 'chevauchements')::text like '%ANNUL%' from sA)::text;

insert into res
select '3d : et elle ne charge aucune journée', '2',
       pg_temp.eq(1, 'ÉQUIPE UN') ->> 'interventions';

-- ============================================================
-- 4. CE QUE PERSONNE N'A PRIS
-- ============================================================

insert into res
select '4a : l''intervention sans équipe est nommée, pas fondue dans un total', 'ORPHELINE',
       (select j -> 'interventionsSansEquipe' -> 0 ->> 'titre' from sA);

insert into res
select '4b : et elle apparaît quand même sur sa journée, sous « sans équipe »', '2.00',
       pg_temp.eq(2, 'sans équipe') ->> 'heuresConnues';

insert into res
select '4c : l''intervention sans date de début est comptée à part', '1',
       (select j ->> 'interventionsSansDateDeDebut' from sA);

insert into res
select '4d : la note de journée du jeudi est rendue', 'Livraison paillage 14 h.',
       (select d -> 'notes' -> 0 ->> 'texte'
        from sA, jsonb_array_elements(j -> 'jours') d
        where (d ->> 'jour')::date = (select cfg.d from cfg where cfg.k='lundi') + 3);

-- ============================================================
-- 5. LES ÉQUIPES — zéro membre n'est pas « personne »
-- ============================================================

insert into res
select '5a : l''équipe dont la composition est saisie le dit', 'true',
       (select e ->> 'compositionRenseignee' from sA, jsonb_array_elements(j -> 'equipes') e
        where e ->> 'nom' = 'ÉQUIPE UN');

insert into res
select '5b : celle dont personne n''a saisi la composition le dit AUSSI', 'false',
       (select e ->> 'compositionRenseignee' from sA, jsonb_array_elements(j -> 'equipes') e
        where e ->> 'nom' = 'ÉQUIPE DEUX');

insert into res
select '5c : et le champ s''appelle « membresEnregistres », pas « effectif »', 'true',
       (select (j -> 'equipes' -> 0) ? 'membresEnregistres' from sA)::text;

-- ============================================================
-- 6. LES REFUS SONT DANS LA DONNÉE, PAS DANS LE PROMPT
-- ============================================================

insert into res
select '6a : la disponibilité est déclarée inexistante par la fonction elle-même', 'true',
       (select (j -> 'nonMesurable' ->> 'disponibilite') like '%AUCUNE table d%' from sA)::text;

insert into res
select '6b : la surcharge est déclarée incalculable', 'true',
       (select (j -> 'nonMesurable' ->> 'capaciteContractuelle') like '%dénominateur%' from sA)::text;

insert into res
select '6c : l''amplitude est déclarée non convertible en heures', 'true',
       (select (j -> 'nonMesurable' ->> 'amplitude') like '%MINORANT%' from sA)::text;

insert into res
select '6d : le distancier est déclaré absent', 'true',
       (select (j -> 'nonMesurable' ->> 'tempsDeDeplacement') like '%Aucun distancier%' from sA)::text;

insert into res
select '6e : et le déplacement d''une intervention est déclaré impossible', 'true',
       (select (j -> 'nonMesurable' ->> 'deplacementDIntervention') like '%/planning%' from sA)::text;

-- ============================================================
-- 7. UNE SEMAINE VIDE EST UNE RÉPONSE, PAS UNE PANNE
-- ============================================================

create temp table sVide(j jsonb) on commit drop;
insert into sVide select public.ai_planning_summary(
  (select v from ids where k='orgA'), (select d from cfg where k='lundi') + 60, 7);

insert into res
select '7a : sept jours rendus même quand rien n''est posé', '7',
       (select jsonb_array_length(j -> 'jours')::text from sVide);

insert into res
select '7b : et la confiance dit « données insuffisantes », pas « tout va bien »',
       'insufficient_data', (select j ->> 'confiance' from sVide);

insert into res
select '7c : zéro intervention posée, affirmé', '0',
       (select j ->> 'interventionsPosees' from sVide);

-- ============================================================
-- 8. LE CLOISONNEMENT ET LES DROITS
-- ============================================================

insert into res
select '8a : la semaine de B n''apparaît pas chez A', 'false',
       (select (j -> 'jours')::text like '%CHEZ B%' from sA)::text;

insert into res
select '8b : et l''équipe de B non plus', 'false',
       (select (j -> 'equipes')::text like '%ÉQUIPE B%' from sA)::text;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_planning_summary((select v from ids where k='orgB'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('8c : depuis A, la fonction appelée sur B est refusée', 'true', refuse::text);
end $$;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000082-0000-4000-8000-0000000000c2')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_planning_summary((select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('8d : sans projects.read, refus net plutôt que vue partielle', 'true', refuse::text);
end $$;

-- ============================================================
-- 9. LES BORNES DE LA FENÊTRE
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a2')::text, true);
set local role authenticated;

insert into res
select '9a : une fenêtre de 900 jours est ramenée à 31, pas refusée', '31',
       jsonb_array_length(public.ai_planning_summary(
         (select v from ids where k='orgA'), (select d from cfg where k='lundi'), 900) -> 'jours')::text;

insert into res
select '9b : une fenêtre de zéro jour vaut un jour, jamais une sortie muette', '1',
       jsonb_array_length(public.ai_planning_summary(
         (select v from ids where k='orgA'), (select d from cfg where k='lundi'), 0) -> 'jours')::text;

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;


-- Oasis Care — §11Y, L'ÉPREUVE DES DEUX FONCTIONS DE L'AGENT MATÉRIEL.
--
-- ============================================================
-- OÙ CE FICHIER DOIT FINIR
-- ============================================================
--
-- Dans `supabase/tests/agents_ia.sql`, qui appartient à l'intégration.
-- Autonome — son `begin`, ses tables temporaires, son `rollback` — pour
-- se rejouer seul et s'y ajouter sans rien renommer.
--
--   node runsql.js .sb_token fleet.sql fleet.epreuve.sql
--
-- ============================================================
-- POURQUOI CETTE ÉPREUVE EXISTE, ALORS QUE LE PARC EST VIDE
-- ============================================================
--
-- `equipment` compte ZÉRO ligne en production. Une fonction livrée sur
-- une table vide n'est vérifiable que sur sa forme : elle rend un objet
-- bien découpé, et personne ne sait si ses chiffres sont justes. C'est
-- exactement la façade que ce chantier est censé ne pas refaire.
--
-- Cette épreuve FABRIQUE donc le parc que la production n'a pas — deux
-- entreprises, huit machines, des échéances en retard et à venir, un
-- journal d'entretien, une machine archivée, une affectation ouverte —
-- puis annule tout. C'est la seule manière d'affirmer que les chiffres
-- sont justes plutôt que bien nommés.
--
-- ============================================================
-- CE QU'ELLE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. « ZÉRO » N'EST JAMAIS RENDU À LA PLACE DE « JE NE SAIS PAS ».
--      C'est la faute que ce produit a déjà corrigée quatre fois, et
--      elle a ICI trois formes distinctes, éprouvées séparément : le
--      parc vide (§1), le parc sans aucune échéance saisie (§2), et le
--      parc à moitié suivi (§3). Dans les deux premières, `depassees`
--      vaut NULL — un compte à zéro se lirait « tout est à jour ».
--
--   2. LE RETARD N'EST PAS COUPÉ PAR LA FENÊTRE. Une échéance dépassée
--      de six mois doit sortir d'une question sur « les 30 prochains
--      jours » : c'est même la seule raison de poser la question.
--
--   3. L'ARGENT NON SAISI RESTE NULL. Une machine sans ligne d'entretien
--      rend `null`, pas 0 € — sans quoi elle passerait pour la moins
--      coûteuse du parc. Et une machine sans prix d'achat sort du
--      classement au lieu d'y entrer avec un dénominateur nul.
--
--   4. LE CLOISONNEMENT ET LES DROITS. Le parc de B n'apparaît nulle
--      part chez A ; un compte sans `projects.read` est refusé net,
--      jamais servi avec un parc vide.
--
--   5. L'AMBIGUÏTÉ EST UNE RÉPONSE. Deux machines qui correspondent au
--      même fragment rendent la liste des candidats, jamais la première.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

-- La date de PARIS, celle sur laquelle `equipment_due_dates` calcule
-- `days_left`. Un repère pris sur l'heure du serveur ferait passer ou
-- échouer l'épreuve selon l'heure d'exécution.
insert into cfg select 'today', (now() at time zone 'Europe/Paris')::date;

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000082-0000-4000-8000-0000000000f1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','fleet-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000082-0000-4000-8000-0000000000f2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','fleet-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000082-0000-4000-8000-0000000000f3','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','fleet-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000f1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Matériel A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000f2')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Matériel B','landscaper');

-- Le troisième compte est membre de A mais n'a QUE `clients.read` : il
-- doit être refusé net, pas servi avec un parc vide.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000082-0000-4000-8000-0000000000f3', 'custom', array['clients.read']
from ids where k='orgA';

-- ============================================================
-- 1. LE PARC VIDE — la faute la plus facile à commettre
-- ============================================================
--
-- A n'a encore AUCUNE machine. C'est l'état exact de la production au
-- jour de ce chantier, et c'est le premier cas éprouvé plutôt que le
-- dernier : si la fonction se trompe ici, tout le reste est décoratif.

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000f1')::text, true);
set local role authenticated;

create temp view vide as
  select public.ai_fleet_snapshot((select v from ids where k='orgA'), 30) as j;

insert into res
select '1a : le parc vide se DÉCLARE vide', 'true',
       (select (j -> 'parc' ->> 'vide') from vide);

insert into res
select '1b : et il le dit en français, pour que l''agent le répète', 'true',
       (select (j -> 'parc' ->> 'motif') like '%Aucun matériel enregistré%' from vide)::text;

-- LE TEST QUI COMPTE LE PLUS DE TOUT CE FICHIER.
insert into res
select '1c : « échéances dépassées » vaut NULL, JAMAIS 0', 'null',
       (select coalesce(j -> 'echeances' ->> 'depassees', 'null') from vide);

insert into res
select '1d : « dans la fenêtre » vaut NULL aussi', 'null',
       (select coalesce(j -> 'echeances' ->> 'dansLaFenetre', 'null') from vide);

insert into res
select '1e : les échéances ne sont pas déclarées suivies', 'false',
       (select (j -> 'echeances' ->> 'suivies') from vide);

insert into res
select '1f : la disponibilité entière est NULL, pas un bloc de zéros', 'null',
       (select coalesce(j ->> 'disponibilite', 'null') from vide);

insert into res
select '1g : la confiance est « insufficient_data »', 'insufficient_data',
       (select j ->> 'confiance' from vide);

insert into res
select '1h : et l''écran est nommé, sinon le refus est un cul-de-sac', 'true',
       (select (j -> 'parc' ->> 'motif') like '%/materiel%' from vide)::text;

-- ============================================================
-- 2. UN PARC SANS AUCUNE ÉCHÉANCE — le second piège, plus vicieux
-- ============================================================
--
-- Des machines existent, les compteurs de parc sont crédibles, et « 0
-- échéance dépassée » ressemble à une vraie réponse. Elle est fausse :
-- personne n'a saisi d'échéance, donc rien ne permet de dire que le parc
-- est à jour.

insert into ids select 'm1', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, status, meter_kind)
select (select v from ids where k='m1'), (select v from ids where k='orgA'),
       'TONDEUSE SEULE', 'mower', 'active', 'hours';

create temp view sansEch as
  select public.ai_fleet_snapshot((select v from ids where k='orgA'), 30) as j;

insert into res
select '2a : le parc n''est plus vide', 'false',
       (select (j -> 'parc' ->> 'vide') from sansEch);

insert into res
select '2b : mais les échéances ne sont PAS suivies', 'false',
       (select (j -> 'echeances' ->> 'suivies') from sansEch);

insert into res
select '2c : et « dépassées » vaut TOUJOURS null, pas 0', 'null',
       (select coalesce(j -> 'echeances' ->> 'depassees', 'null') from sansEch);

insert into res
select '2d : le motif dit qu''aucune échéance n''est saisie', 'true',
       (select (j -> 'echeances' ->> 'motif') like '%AUCUNE échéance%' from sansEch)::text;

insert into res
select '2e : la confiance reste « insufficient_data »', 'insufficient_data',
       (select j ->> 'confiance' from sansEch);

insert into res
select '2f : une machine sans journal d''entretien rend null, pas 0 €', '1',
       (select (j -> 'entretien' ->> 'sansJournal') from sansEch);

insert into res
select '2g : et elle n''entre pas au classement des coûts', '0',
       (select jsonb_array_length(j -> 'entretien' -> 'classement') from sansEch)::text;

-- ============================================================
-- 3. UN PARC RÉEL — retards, fenêtre, entretien, affectation
-- ============================================================

-- « MASTER » : un camion, contrôle technique DÉPASSÉ de 200 jours, prix
-- d'achat saisi, deux entretiens dont un relevé de compteur.
insert into ids select 'm2', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, brand, model,
                              registration, internal_number, status, meter_kind,
                              acquisition_cost_cents)
select (select v from ids where k='m2'), (select v from ids where k='orgA'),
       'MASTER', 'vehicle', 'Renault', 'Master', 'AB-123-CD', '12', 'active',
       'kilometers', 2000000;

insert into public.equipment_deadlines (organization_id, equipment_id, kind, label, due_on)
select (select v from ids where k='orgA'), (select v from ids where k='m2'),
       'technicalInspection', 'Contrôle technique PL', (select d from cfg where k='today') - 200;

insert into public.equipment_maintenance
  (organization_id, equipment_id, performed_on, kind, description, cost_cents, meter_reading)
select (select v from ids where k='orgA'), (select v from ids where k='m2'),
       (select d from cfg where k='today') - 90, 'service', 'Vidange', 45000, 128000.0;

insert into public.equipment_maintenance
  (organization_id, equipment_id, performed_on, kind, description, cost_cents, meter_reading)
select (select v from ids where k='orgA'), (select v from ids where k='m2'),
       (select d from cfg where k='today') - 30, 'repair', 'Embrayage', 155000, null;

-- « MINI-PELLE » : échéance dans 10 jours (donc DANS la fenêtre), et une
-- affectation OUVERTE sur un chantier.
insert into ids select 'm3', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, status, meter_kind,
                              acquisition_cost_cents)
select (select v from ids where k='m3'), (select v from ids where k='orgA'),
       'MINI-PELLE', 'earthmoving', 'active', 'hours', 3000000;

insert into public.equipment_deadlines (organization_id, equipment_id, kind, due_on)
select (select v from ids where k='orgA'), (select v from ids where k='m3'),
       'service', (select d from cfg where k='today') + 10;

-- Une échéance LOINTAINE sur la même machine : hors fenêtre de 30 jours,
-- elle ne doit pas gonfler la liste — mais elle doit compter parmi les
-- ouvertes.
insert into public.equipment_deadlines (organization_id, equipment_id, kind, due_on)
select (select v from ids where k='orgA'), (select v from ids where k='m3'),
       'insurance', (select d from cfg where k='today') + 300;

insert into ids select 'cliA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliA'), (select v from ids where k='orgA'),
       'Domaine du Val', 'company', 'customer';

insert into ids select 'chA', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='chA'), (select v from ids where k='orgA'),
       (select v from ids where k='cliA'), 'CH-EPR-0001', 'CHANTIER NORD', 'inProgress';

insert into public.equipment_assignments (organization_id, equipment_id, project_id, started_on)
select (select v from ids where k='orgA'), (select v from ids where k='m3'),
       (select v from ids where k='chA'), (select d from cfg where k='today') - 5;

-- « NACELLE » : à l'atelier, AUCUN prix d'achat saisi mais un entretien
-- coûteux. Elle doit sortir du classement de ratio, pas y entrer avec un
-- dénominateur nul.
insert into ids select 'm4', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, status, meter_kind)
select (select v from ids where k='m4'), (select v from ids where k='orgA'),
       'NACELLE', 'lifting', 'maintenance', 'hours';

insert into public.equipment_maintenance
  (organization_id, equipment_id, performed_on, kind, cost_cents)
select (select v from ids where k='orgA'), (select v from ids where k='m4'),
       (select d from cfg where k='today') - 10, 'repair', 300000;

-- « BROYEUR » : immobilisé, aucune affectation.
insert into ids select 'm5', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, status)
select (select v from ids where k='m5'), (select v from ids where k='orgA'),
       'BROYEUR', 'soil', 'outOfService';

-- « VIEUX CAMION » : ARCHIVÉ, avec une échéance dépassée. Il ne doit
-- compter nulle part — relancer sur le contrôle technique d'un camion
-- vendu ferait perdre confiance dans toutes les autres alertes (0067).
insert into ids select 'm6', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, status, archived_at)
select (select v from ids where k='m6'), (select v from ids where k='orgA'),
       'VIEUX CAMION', 'vehicle', 'retired', now();

insert into public.equipment_deadlines (organization_id, equipment_id, kind, due_on)
select (select v from ids where k='orgA'), (select v from ids where k='m6'),
       'technicalInspection', (select d from cfg where k='today') - 400;

-- Une échéance DÉJÀ HONORÉE : elle ne court plus.
insert into public.equipment_deadlines (organization_id, equipment_id, kind, due_on, completed_on)
select (select v from ids where k='orgA'), (select v from ids where k='m2'),
       'insurance', (select d from cfg where k='today') - 50,
       (select d from cfg where k='today') - 48;

create temp view plein as
  select public.ai_fleet_snapshot((select v from ids where k='orgA'), 30) as j;

insert into res
select '3a : cinq machines actives au parc, l''archivée exclue', '5',
       (select j -> 'parc' ->> 'total' from plein);

insert into res
select '3b : et l''archivée est comptée à part, pas oubliée', '1',
       (select j -> 'parc' ->> 'archivees' from plein);

insert into res
select '3c : une seule échéance DÉPASSÉE — celle du camion archivé ne compte pas', '1',
       (select j -> 'echeances' ->> 'depassees' from plein);

insert into res
select '3d : le retard SORT d''une fenêtre de 30 jours', 'true',
       (select (j -> 'echeances' -> 'liste')::text like '%Contrôle technique PL%' from plein)::text;

insert into res
select '3e : l''échéance à +300 jours n''y est PAS', 'false',
       (select (j -> 'echeances' -> 'liste')::text like '%insurance%' from plein)::text;

insert into res
select '3f : mais elle compte parmi les ouvertes', '3',
       (select j -> 'echeances' ->> 'ouvertes' from plein);

insert into res
select '3g : l''échéance honorée ne court plus', '2',
       (select jsonb_array_length(j -> 'echeances' -> 'liste') from plein)::text;

insert into res
select '3h : deux machines suivies, trois hors de tout suivi', '3',
       (select j -> 'echeances' ->> 'machinesSansEcheance' from plein);

insert into res
select '3i : le SQL a déjà calculé le retard en jours', '-200',
       (select e ->> 'joursRestants' from plein,
        jsonb_array_elements(j -> 'echeances' -> 'liste') e
        where e ->> 'nom' = 'MASTER');

insert into res
select '3j : et son état, que le modèle n''a pas à déduire', 'overdue',
       (select e ->> 'etat' from plein,
        jsonb_array_elements(j -> 'echeances' -> 'liste') e
        where e ->> 'nom' = 'MASTER');

-- ---------- La disponibilité ----------

insert into res
select '4a : une seule machine affectée', '1',
       (select j -> 'disponibilite' ->> 'affectees' from plein);

insert into res
select '4b : deux actives sans affectation = au dépôt', '2',
       (select j -> 'disponibilite' ->> 'auDepot' from plein);

insert into res
select '4c : une à l''atelier', '1',
       (select j -> 'disponibilite' ->> 'atelier' from plein);

insert into res
select '4d : une immobilisée', '1',
       (select j -> 'disponibilite' ->> 'immobilisees' from plein);

insert into res
select '4e : « au dépôt » est nommé comme une absence de saisie', 'true',
       (select (j -> 'disponibilite' ->> 'note') like '%aucune affectation ouverte%' from plein)::text;

-- ---------- L'entretien ----------

insert into res
select '5a : le MASTER cumule ses deux factures, additionnées par le SQL', '200000',
       (select e ->> 'entretienCents' from plein,
        jsonb_array_elements(j -> 'entretien' -> 'classement') e
        where e ->> 'nom' = 'MASTER');

insert into res
select '5b : en deux passages', '2',
       (select e ->> 'nombrePassages' from plein,
        jsonb_array_elements(j -> 'entretien' -> 'classement') e
        where e ->> 'nom' = 'MASTER');

insert into res
select '5c : le ratio entretien / prix d''achat est calculé en SQL (200 000 / 2 000 000)', '100',
       (select e ->> 'ratioPourMille' from plein,
        jsonb_array_elements(j -> 'entretien' -> 'classement') e
        where e ->> 'nom' = 'MASTER');

insert into res
select '5d : la NACELLE, sans prix d''achat, n''a PAS de ratio', 'null',
       (select coalesce(e ->> 'ratioPourMille', 'null') from plein,
        jsonb_array_elements(j -> 'entretien' -> 'classement') e
        where e ->> 'nom' = 'NACELLE');

insert into res
select '5e : et elle est comptée parmi les machines sans prix d''achat', '1',
       (select j -> 'entretien' ->> 'sansPrixDAchat' from plein);

insert into res
select '5f : les trois machines sans journal restent hors classement', '3',
       (select j -> 'entretien' ->> 'sansJournal' from plein);

insert into res
select '5g : le classement ne contient QUE les machines qui ont un journal', '2',
       (select jsonb_array_length(j -> 'entretien' -> 'classement') from plein)::text;

insert into res
select '5h : la confiance passe à « high » dès que le parc est suivi', 'high',
       (select j ->> 'confiance' from plein);

-- ---------- Les cinq refus, portés par la donnée ----------

insert into res
select '6a : le carburant est déclaré non mesurable', 'true',
       (select (j -> 'nonMesurable' ->> 'carburant') is not null from plein)::text;

insert into res
select '6b : l''amortissement aussi', 'true',
       (select (j -> 'nonMesurable' ->> 'amortissement') is not null from plein)::text;

insert into res
select '6c : la géolocalisation aussi', 'true',
       (select (j -> 'nonMesurable' ->> 'geolocalisation') is not null from plein)::text;

insert into res
select '6d : la refacturation au chantier aussi', 'true',
       (select (j -> 'nonMesurable' ->> 'refacturation') is not null from plein)::text;

insert into res
select '6e : et la projection d''usure, faute de série de relevés', 'true',
       (select (j -> 'nonMesurable' ->> 'usure') is not null from plein)::text;

-- ============================================================
-- 7. LA FICHE D'UNE MACHINE
-- ============================================================

insert into res
select '7a : un fragment de nom suffit', 'true',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'master') ->> 'trouve');

insert into res
select '7b : une plaque aussi', 'MASTER',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'AB-123-CD')
         -> 'machine' ->> 'nom');

insert into res
select '7c : un numéro interne aussi — c''est celui qu''on donne au téléphone', 'MASTER',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), '12')
         -> 'machine' ->> 'nom');

insert into res
select '7d : et l''identifiant, que l''écran /materiel/[id] a sous la main', 'MASTER',
       (public.ai_fleet_equipment((select v from ids where k='orgA'),
          (select v from ids where k='m2')::text) -> 'machine' ->> 'nom');

insert into res
select '7e : le compteur voyage AVEC sa date de relevé', 'true',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'master')
         -> 'compteur' ->> 'releveLe') is not null;

insert into res
select '7f : et la date est celle du RELEVÉ, pas du dernier entretien',
       ((select d from cfg where k='today') - 90)::text,
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'master')
         -> 'compteur' ->> 'releveLe');

insert into res
select '7g : l''entretien sans relevé laisse le compteur à null, jamais 0', 'null',
       coalesce((select e ->> 'compteur'
                 from jsonb_array_elements(
                   public.ai_fleet_equipment((select v from ids where k='orgA'), 'master')
                     -> 'entretien' -> 'journal') e
                 where e ->> 'description' = 'Embrayage'), 'null');

insert into res
select '7h : l''affectation ouverte nomme le chantier', 'CHANTIER NORD',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'MINI-PELLE')
         -> 'affectation' ->> 'chantier');

insert into res
select '7i : sans affectation, le bloc est null et la note le dit', 'null',
       coalesce(public.ai_fleet_equipment((select v from ids where k='orgA'), 'BROYEUR')
         ->> 'affectation', 'null');

insert into res
select '7j : une machine sans entretien rend null, pas 0 €', 'null',
       coalesce(public.ai_fleet_equipment((select v from ids where k='orgA'), 'BROYEUR')
         -> 'entretien' ->> 'totalCents', 'null');

insert into res
select '7k : la machine ARCHIVÉE reste trouvable, avec sa date d''archivage', 'true',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'VIEUX CAMION')
         -> 'machine' ->> 'archiveLe') is not null;

-- L'AMBIGUÏTÉ EST UNE RÉPONSE, PAS UNE ERREUR.
insert into ids select 'm7', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, brand)
select (select v from ids where k='m7'), (select v from ids where k='orgA'),
       'TONDEUSE AUTOPORTÉE', 'mower', 'Husqvarna';

insert into res
select '7l : deux « tondeuse » ne rendent pas la première', 'false',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'TONDEUSE') ->> 'trouve');

insert into res
select '7m : elles rendent les candidats, pour qu''on demande laquelle', '2',
       jsonb_array_length(public.ai_fleet_equipment(
         (select v from ids where k='orgA'), 'TONDEUSE') -> 'candidats')::text;

insert into res
select '7n : « rien ne correspond » n''est pas « le parc est vide »', 'false',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'HÉLICOPTÈRE')
         ->> 'parcVide');

-- ============================================================
-- 8. LE CLOISONNEMENT ET LES DROITS
-- ============================================================

-- B se dote d'un parc qui ne doit jamais paraître chez A.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000f2')::text, true);
set local role authenticated;

insert into public.equipment (organization_id, name, category, status)
select (select v from ids where k='orgB'), 'CAMION DE B', 'vehicle', 'active';

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000f1')::text, true);
set local role authenticated;

insert into res
select '8a : le parc de B n''apparaît pas chez A', 'false',
       (select (j)::text like '%CAMION DE B%' from plein)::text;

insert into res
select '8b : et la fiche ne le retrouve pas non plus', 'false',
       (public.ai_fleet_equipment((select v from ids where k='orgA'), 'CAMION DE B') ->> 'trouve');

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_fleet_snapshot((select v from ids where k='orgB'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('8c : depuis A, la fonction appelée sur B est refusée', 'true', refuse::text);
end $$;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000082-0000-4000-8000-0000000000f3')::text, true);
set local role authenticated;

-- LE REFUS LE PLUS IMPORTANT DE CETTE SECTION. Sans `projects.read`, la
-- RLS masquerait TOUT le parc et la fonction rendrait « aucun matériel
-- enregistré » — c'est-à-dire un mensonge rassurant, indiscernable du
-- cas §1. Le garde LÈVE, donc l'agent dira « droit manquant ».
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_fleet_snapshot((select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('8d : sans projects.read, refus net plutôt qu''un parc faussement vide', 'true', refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_fleet_equipment((select v from ids where k='orgA'), 'master');
  exception when others then refuse := true;
  end;
  insert into res values
    ('8e : la fiche est refusée par le même garde', 'true', refuse::text);
end $$;

-- ============================================================
-- 9. LES BORNES DE LA FENÊTRE
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000f1')::text, true);
set local role authenticated;

insert into res
select '9a : une fenêtre de 5 000 jours est ramenée à 366, pas refusée', '366',
       (public.ai_fleet_snapshot((select v from ids where k='orgA'), 5000)
         -> 'echeances' ->> 'fenetreJours');

insert into res
select '9b : une fenêtre de zéro jour vaut un jour, et garde les retards', '1',
       (public.ai_fleet_snapshot((select v from ids where k='orgA'), 0)
         -> 'echeances' ->> 'fenetreJours');

insert into res
select '9c : à un jour de fenêtre, le retard est TOUJOURS là', 'true',
       ((public.ai_fleet_snapshot((select v from ids where k='orgA'), 0)
         -> 'echeances' -> 'liste')::text like '%Contrôle technique PL%')::text;

insert into res
select '9d : une fenêtre nulle prend le défaut de 30 jours', '30',
       (public.ai_fleet_snapshot((select v from ids where k='orgA'), null)
         -> 'echeances' ->> 'fenetreJours');

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;


-- Oasis Care — §11Y, L'ÉPREUVE DE `ai_customer_value`.
--
-- ============================================================
-- OÙ CE FICHIER DOIT FINIR
-- ============================================================
--
-- Dans `supabase/tests/agents_ia.sql`, qui appartient à l'intégration.
-- Autonome — son `begin`, ses tables temporaires, son `rollback` — pour
-- se rejouer seul et s'y ajouter sans rien renommer.
--
--   node runsql.js .sb_token customer.sql customer.epreuve.sql
--
-- ============================================================
-- CE QU'ELLE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. LES TROIS DROITS. C'est la raison d'être de cette épreuve. Un
--      compte qui n'a que `clients.read` traverse quand même la
--      fonction — le client existe, il est lisible — et obtiendrait, en
--      `security invoker` nu, ZÉRO devis, ZÉRO facture, ZÉRO euro. Tout
--      serait vrai au sens du SQL et faux au sens de la question. §5
--      exige que les blocs vaillent NULL et que les trois droits soient
--      NOMMÉS.
--
--   2. « RIEN » N'EST PAS « ZÉRO ». Un client sans devis et sans facture
--      rend des totaux NULL et des comptes à 0 (§4) : le compte est un
--      fait vérifié, le total serait une affirmation sur de l'argent.
--
--   3. L'ARGENT REÇU N'EST PAS L'ARGENT LETTRÉ. Un acompte versé avant
--      toute facture n'est rattaché à rien : les confondre ferait dire
--      « il n'a rien payé » d'un client dont l'argent est sur le compte
--      (§3).
--
--   4. UN BROUILLON N'EST PAS UNE FACTURE. Sans numéro de séquence
--      légale elle n'existe pas : elle est comptée à part, jamais dans
--      le total facturé (§2).
--
--   5. L'ANCIENNETÉ INCONNUE RESTE INCONNUE. `converted_at` est vide sur
--      le seul client de la production : « client depuis 0 jour » se
--      lirait « nouveau client », et c'est faux (§6).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

insert into cfg select 'today', (now() at time zone 'Europe/Paris')::date;

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000082-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cust-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000082-0000-4000-8000-0000000000c2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cust-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000082-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cust-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Clients A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000c2')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Clients B','landscaper');

-- LE COMPTE QUI FAIT TOUT L'INTÉRÊT DE §5 : membre de A, et il n'a QUE
-- `clients.read`. Il voit le client et rien de son argent.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000082-0000-4000-8000-0000000000c3', 'custom', array['clients.read']
from ids where k='orgA';

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

-- ============================================================
-- Le décor : un client complet, un client vierge
-- ============================================================

-- « GRAND COMPTE » : deux devis (un accepté, un envoyé), deux factures
-- émises et un brouillon, un règlement partiel, un acompte non lettré,
-- un avoir, deux chantiers.
insert into ids select 'cli1', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind,
                                  lifecycle_stage, billing_city, converted_at)
select (select v from ids where k='cli1'), (select v from ids where k='orgA'),
       'GRAND COMPTE', 'company', 'customer', 'Nice',
       ((select d from cfg where k='today') - 400)::timestamptz;

-- « CLIENT VIERGE » : une fiche, et rien d'autre. Aucun devis, aucune
-- facture, aucun règlement, et `converted_at` vide — l'état exact du
-- seul client de la production.
insert into ids select 'cli2', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cli2'), (select v from ids where k='orgA'),
       'CLIENT VIERGE', 'individual', 'lead';

-- ---------- Les devis ----------
-- ACCEPTÉ : 1 000 € HT (une ligne de 1 000 €, TVA 20 %).
insert into ids select 'dev1', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='dev1'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'DEV-EPR-0001', 'Création jardin', 'accepted',
       (select d from cfg where k='today') - 120;
insert into public.quote_lines (organization_id, quote_id, description, quantity,
                                unit_sale_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='dev1'),
       'Terrassement', 1, 100000, 20;

-- ENVOYÉ, en attente de réponse : 500 € HT.
insert into ids select 'dev2', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='dev2'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'DEV-EPR-0002', 'Arrosage', 'sent',
       (select d from cfg where k='today') - 10;
insert into public.quote_lines (organization_id, quote_id, description, quantity,
                                unit_sale_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='dev2'),
       'Goutte-à-goutte', 1, 50000, 20;

-- ---------- Les factures ----------
-- ÉMISE nº 1 : 1 000 € HT / 1 200 € TTC, ÉCHUE depuis 30 jours, réglée
-- à moitié (600 €).
--
-- LES LIGNES D'ABORD, L'ÉMISSION ENSUITE. `protect_issued_invoice_lines`
-- interdit de toucher aux lignes d'une facture déjà émise — c'est la
-- règle métier, et elle s'applique aussi à un jeu d'essai. On crée donc
-- la facture au brouillon, on la garnit, puis on l'émet.
insert into ids select 'fac1', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status,
                             issued_on, due_on)
select (select v from ids where k='fac1'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'FA-EPR-0001', 'draft',
       (select d from cfg where k='today') - 60, (select d from cfg where k='today') - 30;
insert into public.invoice_lines (organization_id, invoice_id, description, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fac1'),
       'Terrassement', 1, 100000, 20;
update public.invoices set status = 'partiallyPaid', issued_at = now()
where id = (select v from ids where k='fac1');

-- ÉMISE nº 2 : 500 € HT / 600 € TTC, échéance à venir, rien de réglé.
insert into ids select 'fac2', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status,
                             issued_on, due_on)
select (select v from ids where k='fac2'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'FA-EPR-0002', 'draft',
       (select d from cfg where k='today') - 5, (select d from cfg where k='today') + 25;
insert into public.invoice_lines (organization_id, invoice_id, description, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fac2'),
       'Arrosage', 1, 50000, 20;
update public.invoices set status = 'issued', issued_at = now()
where id = (select v from ids where k='fac2');

-- BROUILLON : 9 000 € HT. Elle ne doit entrer dans AUCUN total.
insert into ids select 'fac3', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status, issued_on)
select (select v from ids where k='fac3'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'FA-EPR-BROUILLON', 'draft',
       (select d from cfg where k='today');
insert into public.invoice_lines (organization_id, invoice_id, description, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fac3'),
       'Ne doit pas compter', 1, 900000, 20;

-- ---------- Les règlements ----------
-- 600 € lettrés sur la facture nº 1.
insert into ids select 'pay1', gen_random_uuid();
insert into public.payments (id, organization_id, customer_id, amount_cents, method, received_on)
select (select v from ids where k='pay1'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 60000, 'transfer',
       (select d from cfg where k='today') - 40;
insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount_cents)
select (select v from ids where k='orgA'), (select v from ids where k='pay1'),
       (select v from ids where k='fac1'), 60000;

-- 250 € reçus et rattachés à AUCUNE facture — l'acompte. C'est l'écart
-- que la fonction doit rendre plutôt que fondre.
insert into public.payments (organization_id, customer_id, amount_cents, method, received_on)
select (select v from ids where k='orgA'), (select v from ids where k='cli1'), 25000, 'cash',
       (select d from cfg where k='today') - 2;

-- ---------- Un avoir de 120 € TTC sur la facture nº 2 ----------
insert into ids select 'av1', gen_random_uuid();
-- Même ordre que pour les factures : garnir, puis émettre.
insert into public.credit_notes (id, organization_id, invoice_id, customer_id, number, issued_on)
select (select v from ids where k='av1'), (select v from ids where k='orgA'),
       (select v from ids where k='fac2'), (select v from ids where k='cli1'), 'AV-EPR-0001',
       (select d from cfg where k='today') - 1;
insert into public.credit_note_lines (organization_id, credit_note_id, description,
                                      quantity, unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='av1'),
       'Geste commercial', 1, 10000, 20;
update public.credit_notes set issued_at = now() where id = (select v from ids where k='av1');

-- ---------- Les chantiers ----------
insert into public.projects (organization_id, customer_id, number, name, status, actual_end_on)
select (select v from ids where k='orgA'), (select v from ids where k='cli1'),
       'CH-EPR-0001', 'Jardin nord', 'completed', (select d from cfg where k='today') - 50;
insert into public.projects (organization_id, customer_id, number, name, status)
select (select v from ids where k='orgA'), (select v from ids where k='cli1'),
       'CH-EPR-0002', 'Jardin sud', 'inProgress';

create temp view v1 as
  select public.ai_customer_value((select v from ids where k='cli1')) as j;
create temp view v2 as
  select public.ai_customer_value((select v from ids where k='cli2')) as j;

-- ============================================================
-- 1. LES DEVIS
-- ============================================================

insert into res select '1a : deux devis au total', '2',
       (select j -> 'devis' ->> 'nombre' from v1);

insert into res select '1b : 1 500 € HT devisés, additionnés par le SQL', '150000',
       (select j -> 'devis' ->> 'totalHTCents' from v1);

insert into res select '1c : dont 1 000 € acceptés', '100000',
       (select j -> 'devis' ->> 'accepteHTCents' from v1);

insert into res select '1d : et 500 € encore en attente de réponse', '50000',
       (select j -> 'devis' ->> 'enAttenteHTCents' from v1);

-- ============================================================
-- 2. LES FACTURES — le brouillon ne compte nulle part
-- ============================================================

insert into res select '2a : deux factures ÉMISES', '2',
       (select j -> 'facturation' ->> 'nombreEmises' from v1);

insert into res select '2b : le brouillon est compté À PART', '1',
       (select j -> 'facturation' ->> 'brouillons' from v1);

-- Le test qui attrape la faute : 9 000 € de brouillon dans le total.
insert into res select '2c : et il n''entre PAS dans le total facturé', '150000',
       (select j -> 'facturation' ->> 'totalHTCents' from v1);

insert into res select '2d : le TTC est rendu à part du HT, pas déduit par le modèle', '180000',
       (select j -> 'facturation' ->> 'totalTTCCents' from v1);

insert into res select '2e : la première facture est datée', ((select d from cfg where k='today') - 60)::text,
       (select j -> 'facturation' ->> 'premiereLe' from v1);

-- ============================================================
-- 3. L'ARGENT REÇU N'EST PAS L'ARGENT LETTRÉ
-- ============================================================

insert into res select '3a : 850 € reçus du client au total', '85000',
       (select j -> 'reglement' ->> 'encaisseCents' from v1);

insert into res select '3b : dont 600 € seulement rattachés à une facture', '60000',
       (select j -> 'reglement' ->> 'lettreCents' from v1);

-- L'ACOMPTE. Les confondre ferait dire « il n'a rien payé » d'un client
-- dont l'argent est sur le compte.
insert into res select '3c : 250 € d''acompte ne sont lettrés nulle part', '25000',
       (select j -> 'reglement' ->> 'nonAffecteCents' from v1);

insert into res select '3d : l''avoir de 120 € TTC est rendu', '12000',
       (select j -> 'reglement' ->> 'avoirsCents' from v1);

-- Facture 1 : 1 200 TTC - 600 réglés = 600 dus. Facture 2 : 600 TTC -
-- 120 d'avoir = 480 dus. Total 1 080 €.
insert into res select '3e : le reste dû vient de invoice_balance, pas d''une soustraction du modèle', '108000',
       (select j -> 'reglement' ->> 'resteDuCents' from v1);

insert into res select '3f : 600 € sont ÉCHUS', '60000',
       (select j -> 'reglement' ->> 'enRetardCents' from v1);

insert into res select '3g : sur une seule facture', '1',
       (select j -> 'reglement' ->> 'enRetardNombre' from v1);

-- ============================================================
-- 4. UN CLIENT VIERGE — « rien » n'est pas « zéro »
-- ============================================================

insert into res select '4a : aucun devis, et le COMPTE vaut bien 0', '0',
       (select j -> 'devis' ->> 'nombre' from v2);

-- LA NUANCE : le compte est un fait vérifié, le total serait une
-- affirmation sur de l'argent qu'on n'a jamais chiffré.
insert into res select '4b : mais le TOTAL devisé vaut null, pas 0 €', 'null',
       (select coalesce(j -> 'devis' ->> 'totalHTCents', 'null') from v2);

insert into res select '4c : rien facturé : total null', 'null',
       (select coalesce(j -> 'facturation' ->> 'totalHTCents', 'null') from v2);

insert into res select '4d : rien encaissé : null, et surtout pas « il n''a pas payé »', 'null',
       (select coalesce(j -> 'reglement' ->> 'encaisseCents', 'null') from v2);

insert into res select '4e : rien dû non plus', 'null',
       (select coalesce(j -> 'reglement' ->> 'resteDuCents', 'null') from v2);

insert into res select '4f : et l''écart acompte / lettré ne s''invente pas à 0', 'null',
       (select coalesce(j -> 'reglement' ->> 'nonAffecteCents', 'null') from v2);

insert into res select '4g : la confiance tombe à « insufficient_data »', 'insufficient_data',
       (select j ->> 'confiance' from v2);

-- ============================================================
-- 5. LES TROIS DROITS — la raison d'être de cette épreuve
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000082-0000-4000-8000-0000000000c3')::text, true);
set local role authenticated;

create temp view vAmpute as
  select public.ai_customer_value((select v from ids where k='cli1')) as j;

insert into res select '5a : le client reste lisible avec clients.read seul', 'GRAND COMPTE',
       (select j -> 'client' ->> 'nom' from vAmpute);

-- LES QUATRE TESTS QUI COMPTENT LE PLUS DE CE FICHIER. Sans eux, ce
-- compte lirait « 0 € facturé, 0 € encaissé » et conclurait que le
-- client ne rapporte rien.
insert into res select '5b : les devis valent NULL en entier, pas 0', 'null',
       (select coalesce(j ->> 'devis', 'null') from vAmpute);

insert into res select '5c : la facturation aussi', 'null',
       (select coalesce(j ->> 'facturation', 'null') from vAmpute);

insert into res select '5d : les règlements aussi', 'null',
       (select coalesce(j ->> 'reglement', 'null') from vAmpute);

insert into res select '5e : les chantiers aussi', 'null',
       (select coalesce(j ->> 'chantiers', 'null') from vAmpute);

insert into res select '5f : et les trois droits manquants sont NOMMÉS', '3',
       (select jsonb_array_length(j -> 'droitsManquants') from vAmpute)::text;

insert into res select '5g : invoice.create est nommé', 'true',
       (select (j -> 'droitsManquants')::text like '%invoice.create%' from vAmpute)::text;

insert into res select '5h : quotes.read aussi', 'true',
       (select (j -> 'droitsManquants')::text like '%quotes.read%' from vAmpute)::text;

insert into res select '5i : projects.read aussi', 'true',
       (select (j -> 'droitsManquants')::text like '%projects.read%' from vAmpute)::text;

insert into res select '5j : et la confiance refuse de conclure', 'insufficient_data',
       (select j ->> 'confiance' from vAmpute);

-- ============================================================
-- 6. L'ANCIENNETÉ, LES CHANTIERS, ET CE QU'ON NE MESURE PAS
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

insert into res select '6a : 400 jours d''ancienneté, calculés par le SQL', '400',
       (select j -> 'client' ->> 'ancienneteJours' from v1);

-- L'ÉTAT EXACT DU SEUL CLIENT DE LA PRODUCTION : `converted_at` vide.
insert into res select '6b : sans converted_at, l''ancienneté est INCONNUE, pas nulle', 'null',
       (select coalesce(j -> 'client' ->> 'ancienneteJours', 'null') from v2);

insert into res select '6c : et la fonction dit pourquoi, plutôt que de se taire', 'true',
       (select (j -> 'client' ->> 'ancienneteNote') like '%INCONNUE%' from v2)::text;

insert into res select '6d : un chantier terminé', '1',
       (select j -> 'chantiers' ->> 'termines' from v1);

insert into res select '6e : un en cours', '1',
       (select j -> 'chantiers' ->> 'enCours' from v1);

insert into res select '6f : la satisfaction est déclarée ABSENTE du produit', 'true',
       (select (j -> 'nonMesurable' ->> 'satisfaction') like '%n''existe pas%' from v1)::text;

insert into res select '6g : et l''intervention signée est explicitement disqualifiée', 'true',
       (select (j -> 'nonMesurable' ->> 'satisfaction') like '%PAS un contentement%' from v1)::text;

insert into res select '6h : le risque de départ est déclaré incalculable', 'true',
       (select (j -> 'nonMesurable' ->> 'risqueDeDepart') is not null from v1)::text;

insert into res select '6i : et toute phrase de portefeuille est refusée', 'true',
       (select (j -> 'nonMesurable' ->> 'portefeuille') is not null from v1)::text;

insert into res select '6j : le jugement de bon payeur aussi', 'true',
       (select (j -> 'nonMesurable' ->> 'comportementDePaiement') is not null from v1)::text;

-- ============================================================
-- 7. LE CLOISONNEMENT
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000c2')::text, true);
set local role authenticated;

insert into ids select 'cliB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliB'), (select v from ids where k='orgB'),
       'CLIENT DE B', 'company', 'customer';

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

-- Le client de B doit être INTROUVABLE depuis A — et le message ne doit
-- pas confirmer qu'il existe ailleurs.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_customer_value((select v from ids where k='cliB'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('7a : le client de B est introuvable depuis A', 'true', refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_customer_value(gen_random_uuid());
  exception when others then refuse := true;
  end;
  insert into res values
    ('7b : un identifiant inventé lève, il ne rend pas une fiche vide', 'true', refuse::text);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;
