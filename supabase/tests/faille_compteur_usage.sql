-- Oasis Care — L'ÉPREUVE DU CORRECTIF 0085.
--
-- Un test de sécurité ne vaut que s'il ÉCHOUE sur la version d'avant.
-- Chaque cas ci-dessous a été joué contre la base non corrigée : les
-- trois premiers y passaient, c'est-à-dire que l'attaque réussissait.
--
-- UN SEUL bloc begin/rollback : un fichier découpé en plusieurs blocs
-- verrait son premier `rollback` annuler la migration posée devant, et
-- tout ce qui suit échouerait par « la fonction n'existe pas ».

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;

-- Une victime réelle plutôt qu'inventée : le compte qui possède
-- réellement des compteurs en production. Un test sur des données
-- fabriquées de toutes pièces ne prouverait pas que le correctif tient
-- sur le vrai schéma.
create temp table cible on commit drop as
  select user_id, workspace_id, feature, period, count as avant
    from public.usage_counters
   order by updated_at desc
   limit 1;

-- Un SECOND compte réel, différent de la victime. « Réel » n'est pas un
-- détail : usage_counters porte une clé étrangère vers auth.users, et un
-- identifiant inventé échoue par violation de contrainte — un refus qu'on
-- prendrait à tort pour l'effet du garde de sécurité.
create temp table autre on commit drop as
  select u.id from auth.users u
   where u.id is distinct from (select user_id from cible)
   limit 1;

select set_config('epreuve.victime',  (select user_id::text from cible), true),
       set_config('epreuve.espace',   (select workspace_id::text from cible), true),
       set_config('epreuve.feature',  (select feature from cible), true),
       set_config('epreuve.periode',  (select period from cible), true),
       set_config('epreuve.autre',    coalesce((select id::text from autre), ''), true);

grant select on cible to anon, authenticated;

-- ============================================================
-- 1. UN VISITEUR NON CONNECTÉ NE PEUT PLUS RIEN
-- ============================================================
-- C'est L'ATTAQUE, celle qui fonctionnait : `anon` faisait passer le
-- compteur d'un tiers de 2 à 3.

do $$
declare v_ok boolean := false;
begin
  set local role anon;
  begin
    perform public.increment_usage_counter(
      (select user_id from cible), (select workspace_id from cible),
      (select feature from cible), (select period from cible), 1000000);
  exception when others then
    v_ok := true;   -- refus attendu, quel qu'en soit le code
  end;
  reset role;
  insert into res values ('1.1 anon ne peut plus appeler le compteur', 'true', v_ok::text);
end;
$$;

insert into res
select '1.2 et le quota de la victime n''a pas bougé', c.avant::text, u.count::text
  from cible c
  join public.usage_counters u
    on u.user_id = c.user_id and u.feature = c.feature and u.period = c.period;

-- ============================================================
-- 2. UN COMPTE CONNECTÉ NE COMPTE QUE POUR LUI-MÊME
-- ============================================================

do $$
declare v_refuse boolean := false;
begin
  -- Un AUTRE compte réel, qui n'est pas la victime.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('epreuve.autre'),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.increment_usage_counter(
      current_setting('epreuve.victime')::uuid,
      current_setting('epreuve.espace')::uuid,
      current_setting('epreuve.feature'),
      current_setting('epreuve.periode'), 1000000);
  exception when others then
    v_refuse := (sqlstate = '42501');   -- le refus du garde, pas n'importe quelle erreur
  end;
  reset role;
  insert into res values
    ('2.1 un connecté ne peut pas compter pour un AUTRE', 'true', v_refuse::text);
end;
$$;

do $$
declare v_ok boolean := false;
begin
  -- Le même compte, cette fois pour LUI-MÊME : ça doit marcher, sinon le
  -- correctif casse le produit au lieu de le protéger.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('epreuve.autre'),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.increment_usage_counter(
      current_setting('epreuve.autre')::uuid,
      current_setting('epreuve.espace')::uuid,
      'epreuve0085', '2026-09', 10);
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  reset role;
  insert into res values ('2.2 mais il compte bien pour LUI-MÊME', 'true', v_ok::text);
end;
$$;

-- ============================================================
-- 3. `service_role` GARDE LE DROIT DE COMPTER POUR AUTRUI
-- ============================================================
-- C'est le cas qu'un correctif trop brutal aurait détruit : les
-- quatorze fonctions Edge d'IA appellent par `admin.rpc`, donc en
-- `service_role`, avec `auth.uid()` à NULL. Si ce test échoue, toute
-- l'IA mobile est hors service.

do $$
declare v_ok boolean := false;
begin
  -- Le rôle vu par le garde est celui du JETON, pas celui de PostgreSQL :
  -- auth.role() lit request.jwt.claims. Poser l'un sans l'autre ferait
  -- échouer le test pour une raison qui n'existe pas en production, où
  -- PostgREST pose toujours les deux.
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  begin
    perform public.increment_usage_counter(
      current_setting('epreuve.victime')::uuid,
      current_setting('epreuve.espace')::uuid,
      'epreuve0085srv', '2026-09', 10);
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  reset role;
  insert into res values
    ('3.1 service_role compte encore pour un utilisateur', 'true', v_ok::text);
end;
$$;

-- ============================================================
-- 4. LE CHEMIN DE RECHERCHE EST FIGÉ
-- ============================================================
-- Sans `search_path`, une fonction `security definer` est le vecteur
-- d'élévation de privilèges classique : `anon` a le droit de créer des
-- objets temporaires, donc d'interposer une table homonyme.

insert into res
select '4.1 increment_usage_counter a un search_path',
       'true',
       (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'increment_usage_counter';

insert into res
select '4.2 pg_temp est en DERNIER, jamais en premier',
       'true',
       (array_to_string(p.proconfig, ',') like '%public, pg_temp%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'increment_usage_counter';

insert into res
select '4.3 is_workspace_member a un search_path',
       'true',
       (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'is_workspace_member';

-- Et elle continue de fonctionner : durcir une fonction dont dépendent
-- 57 politiques RLS sans vérifier qu'elle répond encore serait
-- imprudent.
insert into res
select '4.4 is_workspace_member répond toujours', 'false',
       public.is_workspace_member('00000000-0000-4000-8000-0000000000ff'::uuid)::text;

-- ============================================================
-- 5. LES DROITS
-- ============================================================

insert into res
select '5.1 anon n''exécute plus le compteur', 'false',
       has_function_privilege('anon',
         'public.increment_usage_counter(uuid,uuid,text,text,integer)', 'EXECUTE')::text;

insert into res
select '5.2 authenticated l''exécute encore', 'true',
       has_function_privilege('authenticated',
         'public.increment_usage_counter(uuid,uuid,text,text,integer)', 'EXECUTE')::text;

insert into res
select '5.3 service_role l''exécute encore', 'true',
       has_function_privilege('service_role',
         'public.increment_usage_counter(uuid,uuid,text,text,integer)', 'EXECUTE')::text;

-- Les deux vues : plus aucun droit d'écriture, la lecture réservée aux
-- comptes connectés.
insert into res
select '5.4 aucune écriture sur les deux vues pour anon/authenticated', '0',
       count(*)::text
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('equipment_due_dates', 'equipment_overview')
   and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

insert into res
select '5.5 anon ne lit plus les deux vues', '0', count(*)::text
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('equipment_due_dates', 'equipment_overview')
   and grantee = 'anon' and privilege_type = 'SELECT';

insert into res
select '5.6 authenticated les lit toujours', '2', count(*)::text
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('equipment_due_dates', 'equipment_overview')
   and grantee = 'authenticated' and privilege_type = 'SELECT';

-- ============================================================
-- LE VERDICT
-- ============================================================

select case when obtenu is not distinct from attendu then '  OK  ' else ' ÉCHEC' end as etat,
       nom, '[attendu ' || attendu || ', obtenu ' || coalesce(obtenu, 'NULL') || ']' as detail
  from res order by nom;

select count(*) filter (where obtenu is not distinct from attendu) || '/' || count(*)
       || ' tests passés' as resultat
  from res;

rollback;
