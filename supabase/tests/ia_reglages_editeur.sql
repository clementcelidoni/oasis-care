-- Oasis Care — LES RÉGLAGES IA REVIENNENT À L'ÉDITEUR (migration 0080).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE GESTIONNAIRE D'UNE ENTREPRISE CLIENTE NE DÉCIDE PLUS DE CE
--      QUE L'ÉDITEUR PAIE. Les attaques rejouées ici sont exactement
--      celles qui RÉUSSISSAIENT avant 0080 : basculer les quatre agents
--      sur le modèle le plus cher, relever son propre plafond de
--      50,00 € à 1 000 000,00 €, le vider en enregistrant trois champs
--      vides, puis supprimer la ligne. Chacune doit maintenant échouer,
--      et la même attaque est rejouée sous le rôle `owner` — le piège
--      de ce produit est que « owner » et « admin » y sont des rôles
--      CLIENTS.
--
--   2. LA LECTURE DU RUNTIME SURVIT. C'est le piège de cette migration
--      et le test le plus important du fichier : `ai_model_for_agent()`
--      et `ai_cost_budget_remaining()` sont `security invoker` et
--      tournent sous le jeton d'un salarié. Si l'on avait fermé la
--      lecture en même temps que l'écriture, la surcharge et le plafond
--      IMPOSÉS PAR L'ÉDITEUR seraient devenus invisibles au moteur —
--      sans la moindre erreur, donc sans que personne s'en aperçoive.
--      Le test le vérifie par le comportement (un simple ouvrier lit le
--      modèle imposé et le plafond imposé) ET par la structure (les
--      politiques « Members read » et le `select` de `authenticated`
--      existent toujours), pour qu'il échoue quelle que soit la façon
--      dont la lecture se refermerait.
--
--   3. SEUL L'ÉDITEUR PEUT, ET PAS N'IMPORTE LEQUEL. Le produit choisit
--      le modèle et ne lève pas les plafonds ; la facturation fixe les
--      plafonds et ne choisit pas le modèle ; le support ne fait ni
--      l'un ni l'autre. Seul le super-administrateur cumule. Ces règles
--      sont testées deux fois : sur ce que la matrice DIT et sur ce que
--      le garde-fou REFUSE d'y écrire.
--
--   4. CE QUI APPARTIENT AU CLIENT NE CHANGE PAS DE MAIN. L'autonomie
--      des agents et les règles d'autopilote engagent les données et le
--      travail du client : il les règle toujours, et l'administrateur
--      de plateforme ne les voit même pas. Un chantier de gouvernance
--      des coûts ne doit pas emporter au passage des droits qui ne le
--      concernent pas.
--
--   5. RIEN NE SE FAIT SANS TRACE. Chaque changement de modèle ou de
--      plafond laisse une ligne nominative, motivée et datée dans
--      `admin_audit_events`, avec l'ancienne ET la nouvelle valeur —
--      alors qu'avant 0080 ces gestes n'en laissaient aucune.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rejouable autant de fois qu'on veut.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — deux entreprises clientes, cinq administrateurs
-- de plateforme
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 -- Chez le client A : le patron (owner), le gestionnaire (admin client)
 -- et un simple ouvrier (fieldWorker).
 ('80000001-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-patron@test.invalid','',now(),now(),now(),'{}','{}'),
 ('80000002-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-gestionnaire@test.invalid','',now(),now(),now(),'{}','{}'),
 ('80000003-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-ouvrier@test.invalid','',now(),now(),now(),'{}','{}'),
 -- Le patron d'une AUTRE entreprise cliente : le cloisonnement.
 ('80000004-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-patronB@test.invalid','',now(),now(),now(),'{}','{}'),
 -- Chez l'éditeur.
 ('80000010-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-super@test.invalid','',now(),now(),now(),'{}','{}'),
 ('80000011-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-produit@test.invalid','',now(),now(),now(),'{}','{}'),
 ('80000012-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-facturation@test.invalid','',now(),now(),now(),'{}','{}'),
 ('80000013-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-support@test.invalid','',now(),now(),now(),'{}','{}'),
 ('80000014-0000-4000-8000-000000000080','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ia80-securite@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','80000001-0000-4000-8000-000000000080')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages Gouvernance A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','80000004-0000-4000-8000-000000000080')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages Gouvernance B','landscaper');

insert into public.organization_members (organization_id, user_id, role)
select (select v from ids where k='orgA'), '80000002-0000-4000-8000-000000000080', 'admin';
insert into public.organization_members (organization_id, user_id, role)
select (select v from ids where k='orgA'), '80000003-0000-4000-8000-000000000080', 'fieldWorker';

-- Les administrateurs de plateforme : membres d'AUCUNE entreprise, et
-- c'est le point — leur pouvoir ne vient pas d'une appartenance.
insert into public.platform_admins (user_id, role, note) values
 ('80000010-0000-4000-8000-000000000080','super_admin',   'Test 0080'),
 ('80000011-0000-4000-8000-000000000080','product_admin', 'Test 0080'),
 ('80000012-0000-4000-8000-000000000080','billing_admin', 'Test 0080'),
 ('80000013-0000-4000-8000-000000000080','support',       'Test 0080'),
 ('80000014-0000-4000-8000-000000000080','security_admin','Test 0080');

-- ============================================================
-- 1. LE CLIENT NE PEUT PLUS — les attaques d'avant 0080, rejouées
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','80000002-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

-- La permission cliente n'a pas changé, et c'est bien pour cela qu'elle
-- ne devait pas être la clé de ces deux tables : elle continue d'ouvrir
-- les réglages d'entreprise, elle n'ouvre plus la facture de l'éditeur.
insert into res select '1.0 le gestionnaire client porte toujours organization.manageUsers','true',
  public.has_permission((select v from ids where k='orgA'),'organization.manageUsers')::text;

do $T$
begin
  insert into public.ai_model_overrides (organization_id, agent, model, reason)
  select (select v from ids where k='orgA'), 'finance', 'gpt-5.6-sol', 'je veux le meilleur';
  insert into res values ('1.1 le client bascule Finance sur le modèle le plus cher','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('1.1 le client bascule Finance sur le modèle le plus cher','REFUS','REFUS');
end $T$;

do $T$
begin
  insert into public.ai_model_overrides (organization_id, agent, model, reason)
  select (select v from ids where k='orgA'), a, 'gpt-5.6-sol', 'tout en avancé'
  from unnest(array['executive','billing','quote_pricing']) a
  on conflict (organization_id, agent) do update set model = excluded.model;
  insert into res values ('1.2 le client bascule les trois autres agents (upsert de l''écran)','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('1.2 le client bascule les trois autres agents (upsert de l''écran)','REFUS','REFUS');
end $T$;

do $T$
begin
  insert into public.ai_cost_limits (organization_id, daily_organization_limit_cents,
         monthly_organization_limit_cents, per_agent_limit_cents)
  select (select v from ids where k='orgA'), 1000, 100000000, 2000;
  insert into res values ('1.3 le client se pose un plafond de 1 000 000,00 €','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('1.3 le client se pose un plafond de 1 000 000,00 €','REFUS','REFUS');
end $T$;

-- Les mêmes gestes par la porte de service : les fonctions de l'éditeur.
do $T$
begin
  perform public.admin_set_ai_model_override(
    (select v from ids where k='orgA'), 'finance', 'gpt-5.6-sol', 'je suis chez moi');
  insert into res values ('1.4 le client appelle admin_set_ai_model_override','REFUS 42501','ACCEPTÉ');
exception when others then
  insert into res values ('1.4 le client appelle admin_set_ai_model_override','REFUS 42501','REFUS '||sqlstate);
end $T$;

do $T$
begin
  perform public.admin_set_ai_cost_limits(
    (select v from ids where k='orgA'), null, 100000000, null, 'je me plafonne moi-même');
  insert into res values ('1.5 le client appelle admin_set_ai_cost_limits','REFUS 42501','ACCEPTÉ');
exception when others then
  insert into res values ('1.5 le client appelle admin_set_ai_cost_limits','REFUS 42501','REFUS '||sqlstate);
end $T$;

insert into res select '1.6 le gestionnaire client n''est pas administrateur de plateforme','false',
  public.is_platform_admin()::text;

-- Le patron (rôle client `owner`) n'y arrive pas davantage : dans ce
-- produit, « owner » est un rôle CLIENT (spec p.32).
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000001-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

do $T$
begin
  insert into public.ai_cost_limits (organization_id, monthly_organization_limit_cents)
  select (select v from ids where k='orgA'), 100000000;
  insert into res values ('1.7 le PATRON (owner) de l''entreprise cliente non plus','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('1.7 le PATRON (owner) de l''entreprise cliente non plus','REFUS','REFUS');
end $T$;

insert into res select '1.8 aucune surcharge n''a été créée par le client','0',
  (select count(*)::text from public.ai_model_overrides
    where organization_id = (select v from ids where k='orgA'));

-- ============================================================
-- 2. L'ÉDITEUR PEUT — et chacun seulement ce qui le regarde
-- ============================================================

-- 2.a Le produit choisit le modèle.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000011-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into ids select 'evt1', public.admin_set_ai_model_override(
  (select v from ids where k='orgA'), 'finance', 'gpt-5.6-luna',
  'Sobriété : cette entreprise n''a aucun besoin du niveau avancé sur Finance.');

insert into res select '2.0 le produit pose la surcharge de modèle','gpt-5.6-luna',
  coalesce((select model from public.ai_model_overrides
             where organization_id=(select v from ids where k='orgA') and agent='finance'),'RIEN');

insert into res select '2.1 la surcharge est signée par l''administrateur qui l''a posée','true',
  (select (updated_by = '80000011-0000-4000-8000-000000000080')::text
     from public.ai_model_overrides
    where organization_id=(select v from ids where k='orgA') and agent='finance');

-- Mais il ne lève pas un plafond de dépense.
do $T$
begin
  perform public.admin_set_ai_cost_limits(
    (select v from ids where k='orgA'), null, null, null, 'je débloque tout');
  insert into res values ('2.2 le produit tente de fixer un plafond de dépense','REFUS 42501','ACCEPTÉ');
exception when others then
  insert into res values ('2.2 le produit tente de fixer un plafond de dépense','REFUS 42501','REFUS '||sqlstate);
end $T$;

-- Un motif vide est refusé : la décision se justifie au moment où on la
-- prend, pas après.
do $T$
begin
  perform public.admin_set_ai_model_override(
    (select v from ids where k='orgA'), 'billing', 'gpt-5.6-sol', '   ');
  insert into res values ('2.3 un changement de modèle sans motif','REFUS 23514','ACCEPTÉ');
exception when others then
  insert into res values ('2.3 un changement de modèle sans motif','REFUS 23514','REFUS '||sqlstate);
end $T$;

do $T$
begin
  perform public.admin_set_ai_model_override(
    (select v from ids where k='orgA'), 'marketing', 'gpt-5.6-sol', 'agent qui n''existe pas');
  insert into res values ('2.4 un agent hors des quatre surchargeables','REFUS 23514','ACCEPTÉ');
exception when others then
  insert into res values ('2.4 un agent hors des quatre surchargeables','REFUS 23514','REFUS '||sqlstate);
end $T$;

do $T$
begin
  perform public.admin_set_ai_model_override(
    (select v from ids where k='orgA'), 'finance', '  ', 'un aiguillage vers rien');
  insert into res values ('2.5 un identifiant de modèle vide','REFUS 23514','ACCEPTÉ');
exception when others then
  insert into res values ('2.5 un identifiant de modèle vide','REFUS 23514','REFUS '||sqlstate);
end $T$;

do $T$
begin
  perform public.admin_set_ai_model_override(
    '80000099-0000-4000-8000-000000000080', 'finance', 'gpt-5.6-sol', 'entreprise inventée');
  insert into res values ('2.6 une entreprise qui n''existe pas','REFUS 23503','ACCEPTÉ');
exception when others then
  insert into res values ('2.6 une entreprise qui n''existe pas','REFUS 23503','REFUS '||sqlstate);
end $T$;

do $T$
begin
  perform public.admin_clear_ai_model_override(
    (select v from ids where k='orgA'), 'executive', 'il n''y a rien à lever');
  insert into res values ('2.7 lever une surcharge inexistante ne rend pas « fait »','REFUS P0002','ACCEPTÉ');
exception when others then
  insert into res values ('2.7 lever une surcharge inexistante ne rend pas « fait »','REFUS P0002','REFUS '||sqlstate);
end $T$;

-- 2.b La facturation fixe le plafond.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000012-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into ids select 'evt2', public.admin_set_ai_cost_limits(
  (select v from ids where k='orgA'), 1000, 5000, 2000,
  'Plafond contractuel du forfait : 50,00 € par mois.');

insert into res select '2.8 la facturation pose le plafond mensuel','5000',
  (select monthly_organization_limit_cents::text from public.ai_cost_limits
    where organization_id=(select v from ids where k='orgA'));

-- Mais elle ne choisit pas le modèle : celui qui tient le budget ne
-- doit pas pouvoir dégrader seul l'outil du client.
do $T$
begin
  perform public.admin_set_ai_model_override(
    (select v from ids where k='orgA'), 'executive', 'gpt-5.6-terra', 'je descends tout le monde');
  insert into res values ('2.9 la facturation tente de changer le modèle','REFUS 42501','ACCEPTÉ');
exception when others then
  insert into res values ('2.9 la facturation tente de changer le modèle','REFUS 42501','REFUS '||sqlstate);
end $T$;

-- Un plafond négatif est un signe inversé, pas un réglage.
do $T$
begin
  perform public.admin_set_ai_cost_limits(
    (select v from ids where k='orgA'), null, -1, null, 'signe inversé');
  insert into res values ('2.10 un plafond négatif','REFUS 23514','ACCEPTÉ');
exception when others then
  insert into res values ('2.10 un plafond négatif','REFUS 23514','REFUS '||sqlstate);
end $T$;

-- 2.c Le support ne fait ni l'un ni l'autre.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000013-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

do $T$
begin
  perform public.admin_set_ai_model_override(
    (select v from ids where k='orgA'), 'finance', 'gpt-5.6-sol', 'un client m''a demandé');
  insert into res values ('2.11 le support tente de changer le modèle','REFUS 42501','ACCEPTÉ');
exception when others then
  insert into res values ('2.11 le support tente de changer le modèle','REFUS 42501','REFUS '||sqlstate);
end $T$;

do $T$
begin
  perform public.admin_clear_ai_cost_limits(
    (select v from ids where k='orgA'), 'le client se plaignait');
  insert into res values ('2.12 le support tente de retirer le plafond','REFUS 42501','ACCEPTÉ');
exception when others then
  insert into res values ('2.12 le support tente de retirer le plafond','REFUS 42501','REFUS '||sqlstate);
end $T$;

insert into res select '2.13 le support ne lit même pas la configuration IA du parc','0',
  (select count(*)::text from public.ai_model_overrides);

-- 2.d Le super-administrateur, lui, cumule — et c'est explicite.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000010-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '2.14 le super-administrateur lit la configuration IA à travers les organisations','1',
  (select count(*)::text from public.ai_model_overrides);

insert into ids select 'evt3', public.admin_set_ai_model_override(
  (select v from ids where k='orgA'), 'finance', 'gpt-5.6-sol',
  'Escalade : ce client teste le niveau avancé pendant un mois, à nos frais et sciemment.');

insert into res select '2.15 le super-administrateur change le modèle déjà posé','gpt-5.6-sol',
  (select model from public.ai_model_overrides
    where organization_id=(select v from ids where k='orgA') and agent='finance');

-- ============================================================
-- 3. LE PIÈGE : LE RUNTIME DU CLIENT LIT TOUJOURS
-- ============================================================
-- Si ce bloc échoue, le routage des agents est retombé sur les valeurs
-- par défaut du code sans que rien ne le signale, et les plafonds
-- imposés par l'éditeur ne s'appliquent plus. C'est le test qu'il ne
-- faut pas « réparer » en changeant l'attendu.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000003-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '3.0 un simple ouvrier n''a pas organization.manageUsers','false',
  public.has_permission((select v from ids where k='orgA'),'organization.manageUsers')::text;

insert into res select '3.1 LE MOTEUR LIT LA SURCHARGE IMPOSÉE PAR L''ÉDITEUR','gpt-5.6-sol',
  coalesce(public.ai_model_for_agent((select v from ids where k='orgA'),'finance'),
           'NULL — LA LECTURE S''EST REFERMÉE');

insert into res select '3.2 LE MOTEUR LIT LE PLAFOND IMPOSÉ PAR L''ÉDITEUR','5000',
  coalesce((select monthly_limit_cents::text
              from public.ai_cost_budget_remaining((select v from ids where k='orgA'),'finance')),
           'NULL — PLUS AUCUN PLAFOND');

insert into res select '3.3 le plafond par agent est lu lui aussi','2000',
  coalesce((select agent_limit_cents::text
              from public.ai_cost_budget_remaining((select v from ids where k='orgA'),'finance')),
           'NULL');

-- Et il ne peut toujours rien écrire.
do $T$
begin
  update public.ai_model_overrides set model='gpt-5.6-terra'
   where organization_id=(select v from ids where k='orgA') and agent='finance';
  insert into res values ('3.4 l''ouvrier tente de changer le modèle','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('3.4 l''ouvrier tente de changer le modèle','REFUS','REFUS');
end $T$;

-- La même chose, vue de la structure : une lecture qui se refermerait
-- autrement (retrait de la politique, retrait du grant) doit faire
-- échouer ce test aussi.
reset role;

insert into res select '3.5 les deux politiques « Members read » existent toujours','2',
  (select count(*)::text from pg_policies
    where schemaname='public'
      and tablename in ('ai_model_overrides','ai_cost_limits')
      and policyname like 'Members read %'
      and cmd = 'SELECT');

insert into res select '3.6 elles restent adossées à l''appartenance, pas à une permission','2',
  (select count(*)::text from pg_policies
    where schemaname='public'
      and tablename in ('ai_model_overrides','ai_cost_limits')
      and policyname like 'Members read %'
      and qual like '%is_organization_member%');

insert into res select '3.7 `authenticated` garde le SELECT sur les deux tables','true',
  (has_table_privilege('authenticated','public.ai_model_overrides','select')
   and has_table_privilege('authenticated','public.ai_cost_limits','select'))::text;

-- ============================================================
-- 4. CLOISONNEMENT : UN CLIENT NE LIT PAS CHEZ L'AUTRE
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','80000004-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '4.0 le patron de B ne voit aucune surcharge (ni la sienne, ni celle de A)','0',
  (select count(*)::text from public.ai_model_overrides);

insert into res select '4.1 interrogé sur A, le moteur de B rend NULL, pas le modèle de A','NULL',
  coalesce(public.ai_model_for_agent((select v from ids where k='orgA'),'finance'),'NULL');

do $T$
begin
  perform public.ai_cost_budget_remaining((select v from ids where k='orgA'),'finance');
  insert into res values ('4.2 le budget de A est refusé à B, pas rendu à zéro','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('4.2 le budget de A est refusé à B, pas rendu à zéro','REFUS','REFUS');
end $T$;

-- ============================================================
-- 5. CE QUI RESTE AU CLIENT NE CHANGE PAS DE MAIN
-- ============================================================
-- L'autonomie des agents et l'autopilote engagent les données et le
-- travail du client. 0080 ne devait pas y toucher.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000002-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

do $T$
begin
  insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
  select (select v from ids where k='orgA'), 'finance', true, 3
  on conflict (organization_id, agent) do update set autonomy_level = excluded.autonomy_level;
  insert into res values ('5.0 le client règle toujours l''autonomie de ses agents','ACCEPTÉ','ACCEPTÉ');
exception when others then
  insert into res values ('5.0 le client règle toujours l''autonomie de ses agents','ACCEPTÉ','REFUS '||sqlstate);
end $T$;

insert into res select '5.1 et la valeur est bien celle qu''il a posée','3',
  coalesce((select autonomy_level::text from public.ai_agent_settings
             where organization_id=(select v from ids where k='orgA') and agent='finance'),'RIEN');

do $T$
begin
  insert into public.ai_autopilot_rules (organization_id, action_type, enabled, maximum_amount_cents)
  select (select v from ids where k='orgA'),
         (select action_type from public.ai_action_catalog order by action_type limit 1),
         false, 5000
  on conflict (organization_id, action_type) do update
     set maximum_amount_cents = excluded.maximum_amount_cents;
  insert into res values ('5.2 le client règle toujours son autopilote','ACCEPTÉ','ACCEPTÉ');
exception when others then
  insert into res values ('5.2 le client règle toujours son autopilote','ACCEPTÉ','REFUS '||sqlstate);
end $T$;

-- Et l'administrateur de plateforme, lui, n'y a aucun accès : ce n'est
-- pas son affaire, et 0080 ne lui en a pas ouvert un par ricochet.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000010-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '5.3 le super-administrateur ne lit pas l''autonomie des agents du client','0',
  (select count(*)::text from public.ai_agent_settings);

insert into res select '5.4 ni les règles d''autopilote du client','0',
  (select count(*)::text from public.ai_autopilot_rules);

do $T$
declare n int;
begin
  update public.ai_agent_settings set autonomy_level = 4
   where organization_id = (select v from ids where k='orgA');
  get diagnostics n = row_count;
  insert into res values ('5.5 il ne met pas non plus le client en autopilote','0 ligne(s)', n::text||' ligne(s)');
exception when others then
  insert into res values ('5.5 il ne met pas non plus le client en autopilote','0 ligne(s)','REFUS '||sqlstate);
end $T$;

-- ============================================================
-- 6. LA TRACE : PLUS RIEN NE SE FAIT EN SILENCE
-- ============================================================
-- Le super-administrateur porte `platform.audit.read` : il lit le
-- journal.

insert into res select '6.0 les trois écritures ont laissé trois lignes de journal','3',
  (select count(*)::text from public.admin_audit_events
    where id in ((select v from ids where k='evt1'),
                 (select v from ids where k='evt2'),
                 (select v from ids where k='evt3')));

insert into res select '6.1 la première pose de modèle est journalisée, signée du produit',
  'aiModel.overrideSet|product_admin|gpt-5.6-luna',
  (select e.action||'|'||e.admin_role||'|'||(e.new_value->>'model')
     from public.admin_audit_events e where e.id = (select v from ids where k='evt1'));

insert into res select '6.2 la première pose n''invente pas d''ancienne valeur','true',
  (select (old_value is null)::text from public.admin_audit_events
    where id = (select v from ids where k='evt1'));

insert into res select '6.3 le second changement conserve l''ancien modèle ET le nouveau',
  'gpt-5.6-luna→gpt-5.6-sol',
  (select (e.old_value->>'model')||'→'||(e.new_value->>'model')
     from public.admin_audit_events e where e.id = (select v from ids where k='evt3'));

insert into res select '6.4 le motif est conservé mot pour mot','true',
  (select (e.reason like 'Escalade : ce client teste%')::text
     from public.admin_audit_events e where e.id = (select v from ids where k='evt3'));

insert into res select '6.5 la cible est l''entreprise, nommée pour qu''on la reconnaisse plus tard',
  'organization|Paysages Gouvernance A',
  (select e.target_type||'|'||e.target_label
     from public.admin_audit_events e where e.id = (select v from ids where k='evt3'));

insert into res select '6.6 le plafond posé est journalisé avec ses trois montants en centimes',
  'aiCostLimit.set|1000|5000|2000',
  (select e.action||'|'||(e.new_value->>'daily_cents')||'|'||
          (e.new_value->>'monthly_cents')||'|'||(e.new_value->>'per_agent_cents')
     from public.admin_audit_events e where e.id = (select v from ids where k='evt2'));

-- Le retrait du plafond — le geste le plus dangereux — garde la valeur
-- qu'il efface.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000012-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into ids select 'evt4', public.admin_clear_ai_cost_limits(
  (select v from ids where k='orgA'), 'Fin de contrat : l''entreprise passe au forfait sans plafond.');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000010-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '6.7 le retrait du plafond garde la valeur effacée','aiCostLimit.cleared|5000',
  (select e.action||'|'||(e.old_value->>'monthly_cents')
     from public.admin_audit_events e where e.id = (select v from ids where k='evt4'));

insert into res select '6.8 et il n''y a plus de plafond du tout','0',
  (select count(*)::text from public.ai_cost_limits
    where organization_id=(select v from ids where k='orgA'));

-- Personne n'écrit dans ces tables sans passer par les fonctions :
-- aucune politique d'écriture n'existe, pour personne.
reset role;

insert into res select '6.9 aucune politique d''écriture sur les deux tables, pour personne','0',
  (select count(*)::text from pg_policies
    where schemaname='public'
      and tablename in ('ai_model_overrides','ai_cost_limits')
      and cmd <> 'SELECT');

insert into res select '6.10 la politique « Managers write » a bien disparu','0',
  (select count(*)::text from pg_policies
    where schemaname='public'
      and tablename in ('ai_model_overrides','ai_cost_limits')
      and policyname like 'Managers write%');

insert into res select '6.11 ni `authenticated` ni `anon` ne gardent un droit d''écriture','false',
  (has_table_privilege('authenticated','public.ai_model_overrides','insert')
   or has_table_privilege('authenticated','public.ai_model_overrides','update')
   or has_table_privilege('authenticated','public.ai_model_overrides','delete')
   or has_table_privilege('authenticated','public.ai_cost_limits','insert')
   or has_table_privilege('authenticated','public.ai_cost_limits','update')
   or has_table_privilege('authenticated','public.ai_cost_limits','delete')
   or has_table_privilege('anon','public.ai_model_overrides','select')
   or has_table_privilege('anon','public.ai_cost_limits','select'))::text;

-- Le support ne lit pas le journal des administrateurs (0075).
select set_config('request.jwt.claims',
  json_build_object('sub','80000013-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '6.12 le support ne lit pas le journal des administrateurs','0',
  (select count(*)::text from public.admin_audit_events
    where id = (select v from ids where k='evt3'));

-- ============================================================
-- 7. LA MATRICE, ET LE GARDE-FOU QUI LA TIENT
-- ============================================================
reset role;

insert into res select '7.0 les trois permissions IA existent au catalogue','3',
  (select count(*)::text from public.platform_admin_permissions
    where key in ('ai.config.read','ai.models.write','ai.costLimits.write'));

insert into res select '7.1 le super-administrateur les porte toutes les trois','3',
  (select count(*)::text from public.platform_admin_role_permissions
    where role='super_admin' and permission like 'ai.%');

insert into res select '7.2 le produit choisit le modèle et ne lève pas les plafonds',
  'ai.config.read,ai.models.write',
  (select string_agg(permission, ',' order by permission)
     from public.platform_admin_role_permissions
    where role='product_admin' and permission like 'ai.%');

insert into res select '7.3 la facturation fixe les plafonds et ne choisit pas le modèle',
  'ai.config.read,ai.costLimits.write',
  (select string_agg(permission, ',' order by permission)
     from public.platform_admin_role_permissions
    where role='billing_admin' and permission like 'ai.%');

insert into res select '7.4 le support et la sécurité n''ont aucune permission IA','0',
  (select count(*)::text from public.platform_admin_role_permissions
    where role in ('support','security_admin','read_only_analyst') and permission like 'ai.%');

-- Le garde-fou : ce que la base REFUSE d'écrire dans la matrice. Une
-- absence se comble par distraction ; un refus se supprime exprès.
do $T$
declare
  couples text[][] := array[
    ['support','ai.models.write'],
    ['support','ai.costLimits.write'],
    ['security_admin','ai.models.write'],
    ['read_only_analyst','ai.models.write'],
    ['billing_admin','ai.models.write'],
    ['product_admin','ai.costLimits.write'],
    -- Les quatre règles de 0075 doivent avoir survécu au remplacement
    -- de la fonction.
    ['support','billing.subscriptions.write'],
    ['billing_admin','customer.data.read'],
    ['product_admin','billing.payments.write'],
    ['read_only_analyst','billing.subscriptions.write']
  ];
  i int;
  refuse boolean;
begin
  for i in 1 .. array_length(couples, 1) loop
    refuse := false;
    begin
      insert into public.platform_admin_role_permissions (role, permission)
      values (couples[i][1], couples[i][2]);
    exception when others then refuse := true;
    end;
    insert into res values (
      '7.5 la matrice refuse « ' || couples[i][1] || ' → ' || couples[i][2] || ' »',
      'true', refuse::text);
  end loop;
end $T$;

-- LA RÈGLE VISE L'ÉCRITURE, ET LE TEST DOIT LE MONTRER. Le garde-fou
-- ne ferme pas la porte à toute permission `ai.*` : `ai.config.read`
-- n'est pas une écriture et reste accordable — on ne l'a simplement
-- semée nulle part, faute d'écran qui la justifie. Si ce test se
-- mettait à échouer, c'est que le garde-fou aurait glissé de « qui fait
-- varier la facture » à « qui regarde », ce qui n'est pas la même
-- règle.
do $T$
declare accepte boolean := false;
begin
  begin
    insert into public.platform_admin_role_permissions (role, permission)
    values ('security_admin','ai.config.read');
    accepte := true;
  exception when others then accepte := false;
  end;
  insert into res values (
    '7.6 une LECTURE de la configuration IA reste accordable (la règle vise l''écriture)',
    'true', accepte::text);
end $T$;

-- Et le catalogue lui-même : `ai.config.read` n'est pas une écriture,
-- les deux autres le sont.
insert into res select '7.7 le catalogue classe correctement les trois permissions','false,true,true',
  (select string_agg(is_write::text, ',' order by key)
     from public.platform_admin_permissions
    where key in ('ai.config.read','ai.costLimits.write','ai.models.write'));

-- ============================================================
-- 8. LE CACHE : L'AUTRE PORTE VERS LA FACTURE DE L'ÉDITEUR
-- ============================================================
-- Ce bloc défend le § 6 de la migration, et il défend le même argent
-- que tout le reste du fichier. Avant lui, la politique
-- « Members with projects.read can write ai_result_cache » était
-- déployée en `FOR ALL` : un `fieldWorker` — dont `projects.read` est
-- l'unique permission — effaçait d'un `delete` toutes les analyses déjà
-- payées de son entreprise, que l'éditeur repayait ensuite une à une,
-- et pouvait RÉÉCRIRE une réponse que le dirigeant recevrait comme
-- étant l'avis d'Oasis.
--
-- LES DEUX MOITIÉS DU TEST NE SE REMPLACENT PAS. On vérifie que
-- l'ouvrier ne peut plus écrire EN DIRECT (8.2 à 8.4) et qu'il peut
-- toujours passer par les fonctions (8.6, 8.7) : fermer la table sans
-- repasser les fonctions en `security definer` couperait l'alimentation
-- du cache, donc ferait repayer l'éditeur — le défaut refermé, à
-- l'envers.

reset role;

-- Une entrée de cache posée par le serveur, hors de portée de la RLS,
-- comme le ferait un vrai calcul d'agent.
insert into public.ai_result_cache
  (organization_id, agent, cache_key, model, source_fingerprint, result, expires_at)
select (select v from ids where k='orgA'), 'executive', 'briefTest:0080',
       'gpt-5.6-luna', 'empreinte-0080',
       jsonb_build_object('texte','brief déjà calculé et déjà payé'),
       now() + interval '1 hour';

select set_config('request.jwt.claims',
  json_build_object('sub','80000003-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

insert into res select '8.0 l''ouvrier porte bien projects.read (le rôle le plus étroit du produit)','true',
  public.has_permission((select v from ids where k='orgA'),'projects.read')::text;

insert into res select '8.1 et il lit toujours le cache de son entreprise','1',
  (select count(*)::text from public.ai_result_cache
    where organization_id=(select v from ids where k='orgA'));

-- L'ATTAQUE QUI RÉUSSISSAIT. On mesure le refus ET le nombre de lignes
-- restantes : un `delete` bloqué par la seule RLS ne lève pas, il
-- efface zéro ligne en silence. Les deux formes de blocage sont
-- acceptables, l'entrée survivante ne l'est pas.
do $T$
declare n int;
begin
  delete from public.ai_result_cache
   where organization_id=(select v from ids where k='orgA');
  get diagnostics n = row_count;
  insert into res values ('8.2 l''ouvrier vide le cache déjà payé de son entreprise',
                          'BLOQUÉ',
                          case when n = 0 then 'BLOQUÉ' else 'ACCEPTÉ ('||n::text||' ligne(s))' end);
exception when others then
  insert into res values ('8.2 l''ouvrier vide le cache déjà payé de son entreprise',
                          'BLOQUÉ','BLOQUÉ');
end $T$;

insert into res select '8.3 L''ENTRÉE DE CACHE EST TOUJOURS LÀ (rien à repayer)','1',
  (select count(*)::text from public.ai_result_cache
    where organization_id=(select v from ids where k='orgA'));

-- Réécrire une réponse déjà calculée : le dirigeant la recevrait comme
-- étant l'avis d'Oasis, `ai_cache_lookup` ne revérifie rien.
--
-- DEUX FORMES DE BLOCAGE, UN SEUL VERDICT. Le retrait du grant fait
-- lever 42501 ; le retrait de la politique, lui, aurait touché zéro
-- ligne sans rien dire. Les deux conviennent, et on ne veut pas d'un
-- test qui tombe le jour où l'une remplace l'autre : ce qu'il défend,
-- c'est qu'AUCUNE ligne ne bouge.
do $T$
declare n int;
begin
  update public.ai_result_cache
     set result = jsonb_build_object('texte','réponse substituée par un ouvrier')
   where organization_id=(select v from ids where k='orgA');
  get diagnostics n = row_count;
  insert into res values ('8.4 l''ouvrier réécrit le contenu d''une réponse déjà calculée',
                          'BLOQUÉ',
                          case when n = 0 then 'BLOQUÉ' else 'ACCEPTÉ ('||n::text||' ligne(s))' end);
exception when others then
  insert into res values ('8.4 l''ouvrier réécrit le contenu d''une réponse déjà calculée',
                          'BLOQUÉ','BLOQUÉ');
end $T$;

insert into res select '8.5 le contenu de la réponse n''a pas bougé','brief déjà calculé et déjà payé',
  (select result->>'texte' from public.ai_result_cache
    where organization_id=(select v from ids where k='orgA') and cache_key='briefTest:0080');

-- L'AUTRE MOITIÉ : le chemin légitime doit rester ouvert, sinon
-- l'éditeur repaie tout.
do $T$
declare v_id uuid;
begin
  v_id := public.ai_cache_store(
        (select v from ids where k='orgA'), 'executive', 'briefTest:0080b',
        'gpt-5.6-luna', 'empreinte-0080b',
        jsonb_build_object('texte','calculé par le serveur'));
  insert into res values ('8.6 le serveur alimente toujours le cache pour ce même ouvrier',
                          'ACCEPTÉ', case when v_id is null then 'IDENTIFIANT NUL' else 'ACCEPTÉ' end);
exception when others then
  insert into res values ('8.6 le serveur alimente toujours le cache pour ce même ouvrier',
                          'ACCEPTÉ','REFUS '||sqlstate);
end $T$;

insert into res select '8.7 et il relit ce qu''il vient d''y écrire','calculé par le serveur',
  coalesce(public.ai_cache_lookup((select v from ids where k='orgA'), 'executive',
             'briefTest:0080b', 'gpt-5.6-luna', 'empreinte-0080b')->>'texte',
           'NULL — LE CACHE NE SERT PLUS');

-- Le cloisonnement : la garde des fonctions est `ai_guard`, pas un
-- identifiant reçu en paramètre.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','80000004-0000-4000-8000-000000000080')::text, true);
set local role authenticated;

do $T$
begin
  perform public.ai_cache_lookup((select v from ids where k='orgA'), 'executive',
            'briefTest:0080', 'gpt-5.6-luna', 'empreinte-0080');
  insert into res values ('8.8 le patron de B lit le cache de A par la fonction','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('8.8 le patron de B lit le cache de A par la fonction','REFUS','REFUS');
end $T$;

do $T$
begin
  perform public.ai_invalidate_result_cache((select v from ids where k='orgA'));
  insert into res values ('8.9 le patron de B vide le cache de A','REFUS','ACCEPTÉ');
exception when others then
  insert into res values ('8.9 le patron de B vide le cache de A','REFUS','REFUS');
end $T$;

-- La structure, pour que le test échoue aussi si le blocage venait à
-- disparaître par un autre chemin que celui qu'on a joué.
reset role;

insert into res select '8.10 aucune politique d''écriture sur ai_result_cache, pour personne','0',
  (select count(*)::text from pg_policies
    where schemaname='public' and tablename='ai_result_cache' and cmd <> 'SELECT');

insert into res select '8.11 la lecture du membre, elle, est conservée','1',
  (select count(*)::text from pg_policies
    where schemaname='public' and tablename='ai_result_cache' and cmd = 'SELECT');

insert into res select '8.12 ni `authenticated` ni `anon` ne gardent un droit d''écriture sur le cache','false',
  (has_table_privilege('authenticated','public.ai_result_cache','insert')
   or has_table_privilege('authenticated','public.ai_result_cache','update')
   or has_table_privilege('authenticated','public.ai_result_cache','delete')
   or has_table_privilege('anon','public.ai_result_cache','select')
   or has_table_privilege('anon','public.ai_result_cache','delete'))::text;

insert into res select '8.13 `authenticated` garde le SELECT sur le cache','true',
  has_table_privilege('authenticated','public.ai_result_cache','select')::text;

-- LA DÉRIVE ELLE-MÊME, NOMMÉE. C'est ce contrôle qui aurait dû exister
-- avant : les trois fonctions doivent être `security definer` ET
-- appeler `ai_guard`. L'une sans l'autre ne protège rien — une
-- `definer` sans garde ouvre le cache à tout le monde.
insert into res select '8.14 les trois fonctions de cache sont `security definer` et gardées par ai_guard','3',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('ai_cache_lookup','ai_cache_store','ai_invalidate_result_cache')
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%ai_guard%');

insert into res select '8.15 et `anon` ne peut plus les appeler','false',
  (has_function_privilege('anon','public.ai_cache_lookup(uuid,text,text,text,text)','execute')
   or has_function_privilege('anon','public.ai_invalidate_result_cache(uuid,text,text)','execute'))::text;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
