-- Phase 11 §"RLS MULTI-TENANT" / "TEST MILESTONE 1" :
-- « Organisation A ne peut lire aucune donnée de Organisation B. »
--
-- Test RÉEL, pas une inspection de politiques : il crée deux comptes et
-- deux organisations, puis bascule en `role authenticated` avec les
-- claims JWT de l'utilisateur A — c'est-à-dire exactement les
-- conditions dans lesquelles RLS s'applique pour une vraie requête.
-- Vérifier que les politiques « existent » ne prouverait rien ; ce qui
-- compte est qu'elles bloquent.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les deux comptes de test.
-- Vérifié après exécution : 0 utilisateur de test restant.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).
-- Dernier résultat : 9/9 le 2026-08-27.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ---------- Fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','user-a@rls-test.invalid','',now(),now(),now(),'{}','{}'),
 ('bbbbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','user-b@rls-test.invalid','',now(),now(),now(),'{}','{}');

-- Organisation A, créée « par » User A
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','email','user-a@rls-test.invalid')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaper');

-- Organisation B, créée « par » User B
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','email','user-b@rls-test.invalid')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Pépinière B','nursery');

-- Un secret dans l'organisation B, que A ne doit jamais voir.
insert into public.audit_events (organization_id, actor_user_id, action, entity_type, source)
select v,'bbbbbbbb-0000-4000-8000-000000000002','secret.de.B','test','web' from ids where k='orgB';

-- ---------- Tests, exécutés RÉELLEMENT en tant que User A ----------
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','email','user-a@rls-test.invalid')::text, true);
set local role authenticated;

insert into res
select 'A ne voit que sa propre organisation','1',count(*)::text from public.business_organizations;

insert into res
select 'A ne peut PAS lire l''organisation B','0',count(*)::text
from public.business_organizations o, ids where o.id = ids.v and ids.k='orgB';

insert into res
select 'A ne voit pas les membres de B','0',count(*)::text
from public.organization_members m, ids where m.organization_id = ids.v and ids.k='orgB';

insert into res
select 'A ne lit pas le journal d''audit de B','0',count(*)::text
from public.audit_events e, ids where e.organization_id = ids.v and ids.k='orgB';

insert into res
select 'is_organization_member(B) est faux','false',
       public.is_organization_member((select v from ids where k='orgB'))::text;

insert into res
select 'has_permission(B, clients.read) est faux','false',
       public.has_permission((select v from ids where k='orgB'),'clients.read')::text;

insert into res
select 'A est bien membre de sa propre organisation','true',
       public.is_organization_member((select v from ids where k='orgA'))::text;

insert into res
select 'A est owner : has_permission(A, invoice.create) est vrai','true',
       public.has_permission((select v from ids where k='orgA'),'invoice.create')::text;

-- Tentative d'écriture croisée : A essaie de s'ajouter chez B.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.organization_members (organization_id, user_id, role)
    select v,'aaaaaaaa-0000-4000-8000-000000000001','owner' from ids where k='orgB';
    ok := false; -- l'insert a réussi : c'est une faille
  exception when others then
    ok := true;  -- refusé, c'est le comportement voulu
  end;
  insert into res values ('A ne peut pas s''inscrire de force chez B','true',ok::text);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
