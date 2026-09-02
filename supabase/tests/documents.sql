-- §21 DOCUMENTS DE TRAVAIL — migration 0068.
--
-- Ce que ce fichier vérifie, dans l'ordre d'importance :
--
--   1. LE CLOISONNEMENT. Un document de l'organisation B ne remonte
--      jamais chez A : ni dans la table, ni dans la recherche globale,
--      ni en demandant son identifiant exact.
--
--   2. LE RATTACHEMENT NE TRAVERSE PAS LES ENTREPRISES. Sans clé
--      étrangère, seul le déclencheur empêche d'écrire l'identifiant du
--      chantier du voisin dans `entity_id`. C'est la ligne de défense
--      que personne ne voit ; c'est donc celle qu'il faut tester.
--
--   3. LES DEUX PERMISSIONS SONT BIEN DEUX. Un ouvrier LIT les photos
--      de chantier — c'est le but du module — et n'en supprime aucune.
--
--   4. La recherche globale connaît enfin les documents.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- Le patron de l'organisation A.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('d0c00001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','patron-a@doc-test.invalid','',now(),now(),now(),'{}','{}');
-- Le patron de l'organisation B — le voisin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('d0c00002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','patron-b@doc-test.invalid','',now(),now(),now(),'{}','{}');
-- Un ouvrier de A : `projects.read` et rien d'autre.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('d0c00003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','ouvrier@doc-test.invalid','',now(),now(),now(),'{}','{}');

-- ============================================================
-- L'organisation A, son chantier, ses documents
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','d0c00001-0000-4000-8000-000000000001')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaper');
insert into ids select 'wsA', workspace_id from public.business_organizations
  where id = (select v from ids where k='orgA');

insert into public.organization_members (organization_id, user_id, role)
select v, 'd0c00003-0000-4000-8000-000000000003', 'fieldWorker' from ids where k='orgA';

set local role authenticated;

insert into ids select 'clientA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='clientA'), (select v from ids where k='orgA'),
       'customer', 'Villa Martin';

insert into ids select 'chantierA', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name)
select (select v from ids where k='chantierA'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'), 'CHA-2026-0007', 'Création jardin Villa Martin';

-- Le plan du géomètre, rangé sous le chantier.
insert into ids select 'docPlan', gen_random_uuid();
insert into public.documents
  (id, organization_id, name, doc_type, tags, entity_type, entity_id, storage_path, mime_type)
select (select v from ids where k='docPlan'), (select v from ids where k='orgA'),
       'Plan du géomètre', 'plan', array['topographie','réception'],
       'project', (select v from ids where k='chantierA'),
       (select v from ids where k='orgA') || '/plan-geometre.pdf', 'application/pdf';

-- Une pièce arrivée avant qu'on sache où la ranger : rattachement nul.
-- Son nom ne contient PAS le mot « voisin » — c'est ce mot qui sert
-- plus bas à repérer ce qui aurait fuité de chez B.
insert into public.documents
  (organization_id, name, doc_type, tags, storage_path, mime_type)
select (select v from ids where k='orgA'), 'Courrier de la mairie', 'letter',
       array['courrier'],
       (select v from ids where k='orgA') || '/courrier.pdf', 'application/pdf';

-- ============================================================
-- L'organisation B — le voisin, avec un nom voisin
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','d0c00002-0000-4000-8000-000000000002')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages B','landscaper');
set local role authenticated;

insert into ids select 'clientB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='clientB'), (select v from ids where k='orgB'),
       'customer', 'Villa du voisin';

insert into ids select 'chantierB', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name)
select (select v from ids where k='chantierB'), (select v from ids where k='orgB'),
       (select v from ids where k='clientB'), 'CHA-2026-0001', 'Chantier du voisin';

insert into ids select 'docB', gen_random_uuid();
insert into public.documents
  (id, organization_id, name, doc_type, entity_type, entity_id, storage_path)
select (select v from ids where k='docB'), (select v from ids where k='orgB'),
       'Plan du géomètre du voisin', 'plan',
       'project', (select v from ids where k='chantierB'),
       (select v from ids where k='orgB') || '/plan-voisin.pdf';

-- ============================================================
-- 1. CE QUE A VOIT — et rien de plus
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','d0c00001-0000-4000-8000-000000000001')::text, true);
set local role authenticated;

insert into res
select 'A voit ses deux documents', '2', count(*)::text
from public.documents;

-- Le cœur du test : une requête SANS filtre ne doit rendre que les
-- siens. Compter les documents de A ne prouverait rien — c'est
-- l'absence de ceux de B qui compte.
insert into res
select 'Le document du voisin n''apparaît jamais', '0', count(*)::text
from public.documents where name like '%voisin%';

-- « Même en recherchant un ID exact » (§31). Demander la ligne par son
-- identifiant est la façon la plus directe de contourner une liste
-- filtrée ; la RLS doit tenir là aussi.
insert into res
select 'Demander l''identifiant exact du document du voisin ne rend rien', '0', count(*)::text
from public.documents where id = (select v from ids where k='docB');

-- ============================================================
-- 2. LE RATTACHEMENT NE TRAVERSE PAS LES ENTREPRISES
-- ============================================================
-- Le document resterait chez A — la RLS de la table s'en charge — mais
-- il pointerait vers le chantier de B. L'écran afficherait « chantier
-- introuvable » sans jamais dire pourquoi.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.documents
      (organization_id, name, doc_type, entity_type, entity_id, storage_path)
    select (select v from ids where k='orgA'), 'Pièce mal rangée', 'other',
           'project', (select v from ids where k='chantierB'),
           (select v from ids where k='orgA') || '/mal-rangee.pdf';
  exception when others then
    refuse := true;
  end;
  insert into res select 'Rattacher au chantier du voisin est refusé', 'refuse',
    case when refuse then 'refuse' else 'ACCEPTÉ — faille' end;
end $$;

-- Un identifiant qui ne désigne rien du tout est refusé de la même
-- façon : le déclencheur vérifie l'existence, pas seulement la
-- propriété.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.documents
      (organization_id, name, doc_type, entity_type, entity_id, storage_path)
    select (select v from ids where k='orgA'), 'Pièce fantôme', 'other',
           'project', gen_random_uuid(),
           (select v from ids where k='orgA') || '/fantome.pdf';
  exception when others then
    refuse := true;
  end;
  insert into res select 'Rattacher à un chantier inexistant est refusé', 'refuse',
    case when refuse then 'refuse' else 'ACCEPTÉ — faille' end;
end $$;

-- Un type sans identifiant ne range rien, un identifiant sans type ne
-- désigne rien : la contrainte exige les deux ou aucun.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.documents (organization_id, name, entity_type, storage_path)
    select (select v from ids where k='orgA'), 'Type sans cible', 'project',
           (select v from ids where k='orgA') || '/type-sans-cible.pdf';
  exception when others then
    refuse := true;
  end;
  insert into res select 'Un type de rattachement sans identifiant est refusé', 'refuse',
    case when refuse then 'refuse' else 'ACCEPTÉ — faille' end;
end $$;

-- Le rattachement légitime, lui, passe — sans quoi le test précédent ne
-- prouverait que l'existence d'un déclencheur qui refuse tout.
insert into res
select 'Le document du chantier de A est bien rattaché', '1', count(*)::text
from public.documents
where entity_type = 'project' and entity_id = (select v from ids where k='chantierA');

-- ============================================================
-- 3. LA RECHERCHE GLOBALE (branche `document` de 0068)
-- ============================================================
insert into res
select 'La recherche globale trouve le document', 'Plan du géomètre',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'geometre')
                 where entity_type = 'document' limit 1), 'RIEN');

-- §21 « tags ; cherchables ». « topographie » n'est le nom d'aucun
-- document : seul le tag peut le faire remonter.
insert into res
select 'Un tag retrouve le document', 'Plan du géomètre',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'topographie')
                 where entity_type = 'document' limit 1), 'RIEN');

insert into res
select 'Le résultat mène à l''écran des documents', 'oui',
       case when (select url from public.global_search((select v from ids where k='orgA'), 'geometre')
                  where entity_type = 'document' limit 1)
                 = '/documents?document=' || (select v from ids where k='docPlan')
            then 'oui' else 'non' end;

-- Le contrôle qui compte : la même recherche ne doit pas ramener le
-- document du voisin, dont le nom contient pourtant le mot cherché.
insert into res
select 'La recherche ne rend pas le document du voisin', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), 'geometre')
where entity_type = 'document' and title like '%voisin%';

-- Et B ne trouve pas davantage celui de A.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','d0c00002-0000-4000-8000-000000000002')::text, true);
set local role authenticated;

insert into res
select 'B ne trouve pas le document de A', '0', count(*)::text
from public.global_search((select v from ids where k='orgB'), 'geometre')
where entity_type = 'document' and title not like '%voisin%';

insert into res
select 'B ne voit qu''un document — le sien', '1', count(*)::text
from public.documents;

-- ============================================================
-- 4. L'OUVRIER LIT, IL NE SUPPRIME PAS
-- ============================================================
-- C'est toute la raison d'être de ce module à côté de
-- `organization_documents` (§45) : la photo de chantier s'ouvre sur le
-- terrain, le RIB non. Si l'ouvrier ne voyait rien, le module ne
-- servirait à rien ; s'il pouvait effacer, un PV de réception
-- disparaîtrait d'un doigt sur un écran de téléphone.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','d0c00003-0000-4000-8000-000000000003')::text, true);
set local role authenticated;

insert into res
select 'L''ouvrier lit les documents de travail', '2', count(*)::text
from public.documents;

insert into res
select 'can_write_documents est faux pour l''ouvrier', 'false',
       public.can_write_documents((select v from ids where k='orgA'))::text;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.documents (organization_id, name, storage_path)
    select (select v from ids where k='orgA'), 'Dépôt interdit',
           (select v from ids where k='orgA') || '/interdit.pdf';
  exception when others then
    refuse := true;
  end;
  insert into res select 'L''ouvrier ne peut PAS déposer', 'refuse',
    case when refuse then 'refuse' else 'ACCEPTÉ — faille' end;
end $$;

-- Une suppression refusée par RLS ne lève pas : elle ne touche aucune
-- ligne. On compte donc ce qui reste, pas ce qui a été levé.
delete from public.documents where name = 'Plan du géomètre';
insert into res
select 'L''ouvrier ne peut PAS supprimer', '1', count(*)::text
from public.documents where name = 'Plan du géomètre';

-- ============================================================
-- 5. LE SEAU EST PRIVÉ
-- ============================================================
-- Un plan d'exécution et la photo de la maison d'un client n'ont pas
-- d'adresse publique. Le seau public, c'est celui des logos (0060).
reset role;
insert into res
select 'Le seau work-documents est privé', 'false',
       coalesce((select public::text from storage.buckets where id = 'work-documents'), 'ABSENT');

-- La politique de lecture doit relier les DEUX BOUTS de la ligne : le
-- dossier vérifié est celui de l'organisation dont on vérifie la
-- permission. Une politique qui ne testerait que `bucket_id` ouvrirait
-- tout le stockage à tout le monde.
insert into res
select 'La politique du seau vérifie le premier segment du chemin', 'oui',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'Members read work document files'
           and qual like '%foldername%'
       ) then 'oui' else 'non' end;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
