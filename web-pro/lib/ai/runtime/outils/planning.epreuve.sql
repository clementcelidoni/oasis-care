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
