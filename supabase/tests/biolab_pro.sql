-- Oasis Care — BIOLAB PRO (migration 0087).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE PARTICULIER NE PERD RIEN. C'est la moitié du chantier la plus
--      facile à rater, et le seul compte qui possède réellement des
--      données BioLab en production est un particulier. Le test mesure
--      son laboratoire DEUX FOIS : une fois avec les politiques de 0087
--      en place, une fois après les avoir retirées — c'est-à-dire dans
--      le monde d'avant. Les deux mesures doivent être IDENTIQUES, case
--      par case. Si une seule bouge, le garde a mangé quelque chose.
--
--   2. LA MÊME DOUBLE MESURE PROUVE QUE LE GARDE MORD VRAIMENT. Sur le
--      laboratoire de l'ENTREPRISE, l'ouvrier de terrain doit passer de
--      « tout » (sans les politiques) à « rien » (avec). Une politique
--      restrictive qui ne changerait rien serait une politique inutile,
--      et c'est exactement l'erreur qu'une politique PERMISSIVE aurait
--      produite ici.
--
--   3. LA MATRICE DE RÔLES, CASE PAR CASE, EN LECTURE, EN ÉCRITURE ET
--      EN SUPPRESSION. Neuf acteurs, treize familles de données, deux
--      laboratoires. Chaque case est MESURÉE sous RLS réelle, jamais
--      déduite d'une lecture de politique.
--
--   4. LE CLOISONNEMENT ENTRE ENTREPRISES. Une entreprise tierce ne
--      voit rien, n'écrit rien, ne supprime rien. `anon` non plus —
--      alors qu'il a les GRANT de table : seule RLS l'arrête.
--
--   5. LA REPRISE, ET SON RETOUR ARRIÈRE. Le laboratoire saisi sur le
--      téléphone dans l'espace personnel rejoint l'espace de
--      l'entreprise, sans qu'AUCUNE ligne ne disparaisse (§26), et
--      revient à l'identique. Les quatre façons d'en abuser sont
--      tentées et refusées.
--
--   6. LES AGRÉGATS DISENT NULL, PAS ZÉRO. « Aucune inspection cette
--      semaine » et « aucune contamination » sont deux phrases
--      différentes ; les écrire toutes les deux 0 % ferait mentir
--      l'écran.
--
--   7. LES AGRÉGATS RESPECTENT RLS. Un ouvrier de terrain qui appelle
--      le tableau de bord n'obtient pas les chiffres du laboratoire par
--      la bande. C'est la conséquence de `security invoker`, et elle se
--      mesure.
--
--   8. LE WEB NE COMMANDE RIEN — §7. Aucune fonction de 0087 n'écrit
--      dans une table d'équipement, sauf le transfert, et seulement sur
--      `workspace_id`. Vérifié en lisant le corps des fonctions.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les laboratoires, ni les transferts.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0087, ou l'envoyer à l'API Management. UN SEUL bloc begin/rollback —
-- un test découpé en plusieurs blocs verrait son premier rollback
-- annuler la migration posée devant, et tout ce qui suit échouerait par
-- « la fonction n'existe pas ».

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;

-- La matrice mesurée : une ligne par phase × acteur × laboratoire ×
-- famille, avec les trois droits séparés.
create temp table mat(phase text, acteur text, labo text, famille text,
                      lecture int, ecriture int, suppression int) on commit drop;

-- Les tables de travail ci-dessus appartiennent au compte qui joue le
-- test. Or la mesure se fait SOUS L'IDENTITE DES ACTEURS — `set local
-- role authenticated` — et ce role n'a aucun droit dessus : sans ce
-- geste, la premiere mesure echoue par « permission denied for table
-- familles » et non par un verdict. On ouvre donc le bloc-notes du
-- test, jamais les tables du produit.
create function pg_temp.ouvrir_temp() returns void
language plpgsql as $ot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname like 'pg\_temp%' loop
    execute format('grant select, insert, update, delete on %I to authenticated, anon',
                   r.tablename);
  end loop;
end $ot$;

-- ============================================================
-- 1. LES ACTEURS
-- ============================================================
--   Part  un PARTICULIER qui fait de la culture in vitro chez lui.
--         C'est le témoin : il n'appartient à aucune entreprise, et
--         rien de ce chantier ne doit le toucher.
--   Coloc un membre de son foyer, inscrit dans son espace de travail.
--         Il ne doit rien perdre non plus.
--   Dir   le DIRIGEANT. Il a un espace personnel — où son téléphone
--         écrit son laboratoire, comme en production — et il est
--         `owner` de son entreprise.
--   Mgr   `manager`. Le rôle qui répond de la production : tout.
--   NWk   `nurseryWorker`. La personne à la paillasse : elle lit et
--         elle saisit, elle NE SUPPRIME PAS.
--   RO    `readOnly`. Elle lit, et rien d'autre.
--   Fld   `fieldWorker`. L'OUVRIER DE TERRAIN — la case qui justifie
--         tout le §2 de la migration. Aujourd'hui il a tous les droits
--         sur le laboratoire ; après 0087 il n'en a aucun.
--   Ldr   `teamLeader`. Même conclusion, autre métier.
--   ProB  le dirigeant d'une AUTRE entreprise. Jamais rien.
--   An    `anon`.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('b0870001-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-part@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870002-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-coloc@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870003-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-dir@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870004-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-mgr@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870005-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-nwk@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870006-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-ro@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870007-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-fld@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870008-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-ldr@biolab.invalid','',now(),now(),now(),'{}','{}'),
 ('b0870009-0000-4000-8000-000000000087','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bl-prob@biolab.invalid','',now(),now(),now(),'{}','{}');

insert into ids values
 ('Part','b0870001-0000-4000-8000-000000000087'),
 ('Coloc','b0870002-0000-4000-8000-000000000087'),
 ('Dir', 'b0870003-0000-4000-8000-000000000087'),
 ('Mgr', 'b0870004-0000-4000-8000-000000000087'),
 ('NWk', 'b0870005-0000-4000-8000-000000000087'),
 ('RO',  'b0870006-0000-4000-8000-000000000087'),
 ('Fld', 'b0870007-0000-4000-8000-000000000087'),
 ('Ldr', 'b0870008-0000-4000-8000-000000000087'),
 ('ProB','b0870009-0000-4000-8000-000000000087');

-- Le déclencheur `on_auth_user_created` a déjà fabriqué un espace
-- personnel à chacun et l'y a inscrit. On lit ce que le produit a posé
-- plutôt que de le refaire.
insert into ids select 'ws_part', id from public.workspaces
 where owner_id = (select v from ids where k='Part') and is_personal;
insert into ids select 'ws_dir', id from public.workspaces
 where owner_id = (select v from ids where k='Dir') and is_personal;

insert into res select 'Le produit a bien donné un espace personnel au particulier', '1',
  (select count(*)::text from ids where k='ws_part');
insert into res select 'Et au dirigeant', '1',
  (select count(*)::text from ids where k='ws_dir');

-- Le membre du foyer, inscrit dans l'espace du particulier.
insert into public.workspace_members (workspace_id, user_id, role)
 select (select v from ids where k='ws_part'), (select v from ids where k='Coloc'), 'member';

-- Les deux entreprises, par la fonction du produit : elle inscrit son
-- créateur dans `organization_members` ET dans `workspace_members`.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Dir'))::text, true);
insert into ids select 'org', public.create_professional_organization('Laboratoire Alocasia','horticulturalProducer');

-- LE CONTRAT — sans lui, le péage (0092) refuse tout (voir 0092 § 5).
-- « created_at >= now() » : now() est l'heure de DÉBUT DE TRANSACTION et
-- la colonne a now() pour défaut, donc ce filtre ne prend QUE les
-- entreprises nées ici. Un jeu d'essai ne signe pas de contrat pour de
-- vrais clients.
insert into public.organization_subscriptions
  (organization_id, plan, status, provider, billing_cycle)
select o.id, 'business', 'active', 'manual', 'monthly'
  from public.business_organizations o
 where o.created_at >= now()
on conflict (organization_id) do nothing;

insert into ids select 'ws_org', o.workspace_id
  from public.business_organizations o where o.id = (select v from ids where k='org');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='ProB'))::text, true);
insert into ids select 'orgB', public.create_professional_organization('Laboratoire Concurrent','horticulturalProducer');

-- LE CONTRAT — sans lui, le péage (0092) refuse tout (voir 0092 § 5).
-- « created_at >= now() » : now() est l'heure de DÉBUT DE TRANSACTION et
-- la colonne a now() pour défaut, donc ce filtre ne prend QUE les
-- entreprises nées ici. Un jeu d'essai ne signe pas de contrat pour de
-- vrais clients.
insert into public.organization_subscriptions
  (organization_id, plan, status, provider, billing_cycle)
select o.id, 'business', 'active', 'manual', 'monthly'
  from public.business_organizations o
 where o.created_at >= now()
on conflict (organization_id) do nothing;


select set_config('request.jwt.claims', '{}', true);

-- Les cinq salariés, inscrits EXACTEMENT comme le fait
-- `accept_organization_invitation` : les deux tables, toujours. C'est
-- ce doublon qui, sans 0087, donne au manœuvre les pleins pouvoirs sur
-- le laboratoire — et c'est pour cela qu'on ne peut pas se contenter de
-- le simuler à moitié.
insert into public.organization_members (organization_id, user_id, role)
values ((select v from ids where k='org'), (select v from ids where k='Mgr'), 'manager'),
       ((select v from ids where k='org'), (select v from ids where k='NWk'), 'nurseryWorker'),
       ((select v from ids where k='org'), (select v from ids where k='RO'),  'readOnly'),
       ((select v from ids where k='org'), (select v from ids where k='Fld'), 'fieldWorker'),
       ((select v from ids where k='org'), (select v from ids where k='Ldr'), 'teamLeader');
insert into public.workspace_members (workspace_id, user_id, role)
values ((select v from ids where k='ws_org'), (select v from ids where k='Mgr'), 'manager'),
       ((select v from ids where k='ws_org'), (select v from ids where k='NWk'), 'nurseryWorker'),
       ((select v from ids where k='ws_org'), (select v from ids where k='RO'),  'readOnly'),
       ((select v from ids where k='ws_org'), (select v from ids where k='Fld'), 'fieldWorker'),
       ((select v from ids where k='ws_org'), (select v from ids where k='Ldr'), 'teamLeader');

-- ============================================================
-- 2. LE CATALOGUE DE PERMISSIONS — semé, et pas seulement déclaré
-- ============================================================
-- « Une permission ajoutée sans être attribuée n'est portée par
--   personne. » On le vérifie rôle par rôle, avec la fonction du
--   produit et non avec une lecture de la table : c'est
--   `has_permission` qui décide, et c'est elle qu'il faut interroger.
create function pg_temp.perm(p_acteur text, p_permission text) returns boolean
language plpgsql as $f$
declare r boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = p_acteur))::text, true);
  select public.has_permission((select v from ids where k='org'), p_permission) into r;
  perform set_config('request.jwt.claims', '{}', true);
  return r;
end $f$;

insert into res values
 ('Le dirigeant gère le laboratoire',        'true',  pg_temp.perm('Dir','biolab.manage')::text),
 ('Le responsable lit',                      'true',  pg_temp.perm('Mgr','biolab.read')::text),
 ('Le responsable écrit',                    'true',  pg_temp.perm('Mgr','biolab.write')::text),
 ('Le responsable gère',                     'true',  pg_temp.perm('Mgr','biolab.manage')::text),
 ('La paillasse lit',                        'true',  pg_temp.perm('NWk','biolab.read')::text),
 ('La paillasse écrit',                      'true',  pg_temp.perm('NWk','biolab.write')::text),
 ('Mais la paillasse ne gère PAS',           'false', pg_temp.perm('NWk','biolab.manage')::text),
 ('La lecture seule lit',                    'true',  pg_temp.perm('RO','biolab.read')::text),
 ('Et n''écrit pas',                         'false', pg_temp.perm('RO','biolab.write')::text),
 ('L''ouvrier de terrain ne lit pas',        'false', pg_temp.perm('Fld','biolab.read')::text),
 ('L''ouvrier de terrain n''écrit pas',      'false', pg_temp.perm('Fld','biolab.write')::text),
 ('Le chef d''équipe ne lit pas',            'false', pg_temp.perm('Ldr','biolab.read')::text),
 ('Le concurrent n''a rien dans cette entreprise', 'false', pg_temp.perm('ProB','biolab.read')::text);

-- Et le garde du §1.3 dit bien « oui » pour un espace sans entreprise.
insert into res select 'Un espace personnel n''est gardé par personne', 'true',
  public.biolab_workspace_allows((select v from ids where k='ws_part'), 'biolab.read')::text;
insert into res select 'Même pour la suppression', 'true',
  public.biolab_workspace_allows((select v from ids where k='ws_part'), 'biolab.manage')::text;

-- ============================================================
-- 3. LES TROIS LABORATOIRES
-- ============================================================
-- L1 : le laboratoire du PARTICULIER, dans son espace personnel. Témoin.
-- L2 : le laboratoire de l'ENTREPRISE, dans l'espace de l'entreprise.
-- L3 : le laboratoire du DIRIGEANT, dans son espace PERSONNEL — c'est
--      la situation réelle de la production, et le sujet du §3 de la
--      migration.
--
-- Un exemplaire de CHAQUE famille dans L1 et dans L2 : c'est ce qui
-- permet de lire la matrice comme un tableau de 0 et de 1.
create temp table familles(nom text, tbl text, id1 uuid, id2 uuid) on commit drop;
insert into familles values
 ('lots de culture',      'culture_batches',             'b087a001-0000-4000-8000-000000000087','b087b001-0000-4000-8000-000000000087'),
 ('bioréacteurs',         'bioreactors',                 'b087a002-0000-4000-8000-000000000087','b087b002-0000-4000-8000-000000000087'),
 ('inspections',          'bioreactor_inspections',      'b087a003-0000-4000-8000-000000000087','b087b003-0000-4000-8000-000000000087'),
 ('photos d''inspection', 'biolab_inspection_photos',    'b087a004-0000-4000-8000-000000000087','b087b004-0000-4000-8000-000000000087'),
 ('recettes de milieu',   'medium_recipes',              'b087a005-0000-4000-8000-000000000087','b087b005-0000-4000-8000-000000000087'),
 ('versions de recette',  'medium_recipe_versions',      'b087a006-0000-4000-8000-000000000087','b087b006-0000-4000-8000-000000000087'),
 ('milieux préparés',     'medium_batches',              'b087a007-0000-4000-8000-000000000087','b087b007-0000-4000-8000-000000000087'),
 ('acclimatation',        'acclimatization_batches',     'b087a008-0000-4000-8000-000000000087','b087b008-0000-4000-8000-000000000087'),
 ('historiques',          'biolab_audit_entries',        'b087a009-0000-4000-8000-000000000087','b087b009-0000-4000-8000-000000000087'),
 ('alertes',              'biolab_alerts',               'b087a010-0000-4000-8000-000000000087','b087b010-0000-4000-8000-000000000087'),
 ('composés',             'lab_compounds',               'b087a011-0000-4000-8000-000000000087','b087b011-0000-4000-8000-000000000087'),
 ('programmes',           'bioreactor_programs',         'b087a012-0000-4000-8000-000000000087','b087b012-0000-4000-8000-000000000087'),
 ('cycles',               'bioreactor_cycle_executions', 'b087a013-0000-4000-8000-000000000087','b087b013-0000-4000-8000-000000000087');

-- Le jeu d'essai se pose SANS utilisateur, comme le ferait une
-- migration : les claims laissés par les appels ci-dessus feraient
-- décider la RLS à la place du test.
select set_config('request.jwt.claims', '{}', true);

do $$
declare
  w uuid;
  p text;
  labo text;
begin
  foreach labo in array array['1','2'] loop
    if labo = '1' then
      w := (select v from ids where k='ws_part'); p := 'b087a';
    else
      w := (select v from ids where k='ws_org');  p := 'b087b';
    end if;

    insert into public.culture_batches
      (id, workspace_id, batch_code, species_name, cultivar, culture_stage, status,
       started_at, initial_explant_count, current_count, created_at)
    values ((p||'001-0000-4000-8000-000000000087')::uuid, w, 'L-'||labo,
            'Alocasia scalprum', 'type', 'multiplication', 'active', now(), 10, 40, now());

    insert into public.bioreactors
      (id, workspace_id, name, code, bioreactor_type, total_volume_liters,
       working_volume_liters, status, automation_enabled, current_batch_id, created_at)
    values ((p||'002-0000-4000-8000-000000000087')::uuid, w, 'Bioréacteur '||labo,
            'BR-'||labo, 'temporaryImmersion', 5, 2, 'idle', false,
            (p||'001-0000-4000-8000-000000000087')::uuid, now());

    insert into public.bioreactor_inspections
      (id, workspace_id, culture_batch_id, bioreactor_id, date, contamination_status,
       hyperhydricity_status, created_at)
    values ((p||'003-0000-4000-8000-000000000087')::uuid, w,
            (p||'001-0000-4000-8000-000000000087')::uuid,
            (p||'002-0000-4000-8000-000000000087')::uuid, now(), 'confirmed', 'mild', now());

    -- La seule famille sans `workspace_id` : elle pend à son inspection.
    insert into public.biolab_inspection_photos
      (id, inspection_id, storage_path, thumbnail_storage_path, category)
    values ((p||'004-0000-4000-8000-000000000087')::uuid,
            (p||'003-0000-4000-8000-000000000087')::uuid, 'a/b.jpg', 'a/b_t.jpg', 'culture');

    insert into public.medium_recipes (id, workspace_id, name, created_at)
    values ((p||'005-0000-4000-8000-000000000087')::uuid, w, 'MS modifié '||labo, now());

    insert into public.medium_recipe_versions
      (id, workspace_id, recipe_id, version_number, target_ph, created_at)
    values ((p||'006-0000-4000-8000-000000000087')::uuid, w,
            (p||'005-0000-4000-8000-000000000087')::uuid, 1, 5.8, now());

    insert into public.medium_batches
      (id, workspace_id, code, recipe_version_id, volume_liters, prepared_at, created_at)
    values ((p||'007-0000-4000-8000-000000000087')::uuid, w, 'MB-'||labo,
            (p||'006-0000-4000-8000-000000000087')::uuid, 1.0, now(), now());

    insert into public.acclimatization_batches
      (id, workspace_id, culture_batch_id, started_at, initial_plantlet_count,
       current_survivor_count, status, created_at)
    values ((p||'008-0000-4000-8000-000000000087')::uuid, w,
            (p||'001-0000-4000-8000-000000000087')::uuid, now(), 20, 15, 'active', now());

    insert into public.biolab_audit_entries
      (id, workspace_id, entity_type, entity_id, action, occurred_at)
    values ((p||'009-0000-4000-8000-000000000087')::uuid, w, 'cultureBatch',
            (p||'001-0000-4000-8000-000000000087')::uuid, 'created', now());

    insert into public.biolab_alerts
      (id, workspace_id, alert_type, priority, message, bioreactor_id, created_at)
    values ((p||'010-0000-4000-8000-000000000087')::uuid, w, 'contamination', 'high',
            'Contamination confirmée', (p||'002-0000-4000-8000-000000000087')::uuid, now());

    insert into public.lab_compounds (id, workspace_id, name, category, created_at)
    values ((p||'011-0000-4000-8000-000000000087')::uuid, w, 'Saccharose', 'sugar', now());

    insert into public.bioreactor_programs (id, workspace_id, name, created_at)
    values ((p||'012-0000-4000-8000-000000000087')::uuid, w, 'Programme '||labo, now());

    insert into public.bioreactor_cycle_executions
      (id, workspace_id, bioreactor_id, cycle_type, planned_start, actual_start,
       actual_end, expected_duration_seconds, actual_duration_seconds, status)
    values ((p||'013-0000-4000-8000-000000000087')::uuid, w,
            (p||'002-0000-4000-8000-000000000087')::uuid, 'immersion', now(), now(),
            now(), 300, 302, 'completed');
  end loop;
end $$;

-- ============================================================
-- 4. LA MESURE — LECTURE, ÉCRITURE, SUPPRESSION
-- ============================================================
-- Chaque case est mesurée par un ESSAI RÉEL sous l'identité de
-- l'acteur, jamais par une lecture de `pg_policies`. La suppression est
-- réellement tentée, puis défaite : c'est le seul moyen d'en connaître
-- le résultat, RLS ne refusant pas un `delete`, elle n'en supprime
-- simplement aucune ligne.
create function pg_temp.mesure(p_phase text, p_acteur text) returns void
language plpgsql as $f$
declare
  f record;
  cible uuid;
  labo text;
  n int; e int; s int;
begin
  for f in select * from familles order by nom loop
    foreach labo in array array['L1','L2'] loop
      cible := case when labo = 'L1' then f.id1 else f.id2 end;

      begin
        execute format('select count(*)::int from public.%I where id = $1', f.tbl)
          into n using cible;
      exception when others then n := 0;
      end;

      begin
        execute format(
          'select count(*)::int from (select 1 from public.%I where id = $1 for update) z', f.tbl)
          into e using cible;
      exception when others then
        -- Un refus dur compte comme « ne peut pas écrire ». Même
        -- conclusion qu'une absence de ligne, autre raison.
        e := 0;
      end;

      -- La suppression, tentée puis annulée par le point de reprise
      -- implicite du bloc `begin ... exception`. Les variables plpgsql
      -- ne sont pas transactionnelles : `s` survit à l'annulation.
      s := 0;
      begin
        execute format(
          'with d as (delete from public.%I where id = $1 returning 1)
           select count(*)::int from d', f.tbl)
          into s using cible;
        raise exception 'annulation volontaire';
      exception when others then
        null;
      end;

      insert into mat values (p_phase, p_acteur, labo, f.nom,
                              least(n,1), least(e,1), least(s,1));
    end loop;
  end loop;
end $f$;

create function pg_temp.mesure_tous(p_phase text) returns void
language plpgsql as $f$
declare a record;
begin
  perform pg_temp.ouvrir_temp();
  for a in select k from ids
            where k in ('Part','Coloc','Dir','Mgr','NWk','RO','Fld','Ldr','ProB') loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    perform pg_temp.mesure(p_phase, a.k);
    execute 'reset role';
  end loop;
  -- `anon` : aucune revendication, et le rôle du visiteur non connecté.
  -- Il a pourtant les GRANT de table sur les vingt et une tables.
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  perform pg_temp.mesure(p_phase, 'An');
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $f$;

-- PHASE « AVEC » : le monde de 0087.
select pg_temp.mesure_tous('AVEC');

-- ------------------------------------------------------------
-- 4.1 La matrice attendue, écrite en toutes lettres
-- ------------------------------------------------------------
-- Trois chiffres par case : lecture, écriture, suppression. Toute case
-- qui s'écarte de ce tableau fait échouer le test et se nomme
-- elle-même.
create temp table attendu(acteur text, labo text, l int, e int, s int) on commit drop;
insert into attendu values
 -- LE LABORATOIRE DU PARTICULIER — inchangé, et c'est le point n° 1.
 ('Part','L1',1,1,1), ('Coloc','L1',1,1,1),
 ('Dir','L1',0,0,0),  ('Mgr','L1',0,0,0),  ('NWk','L1',0,0,0),
 ('RO','L1',0,0,0),   ('Fld','L1',0,0,0),  ('Ldr','L1',0,0,0),
 ('ProB','L1',0,0,0), ('An','L1',0,0,0),
 -- LE LABORATOIRE DE L'ENTREPRISE — le découpage par rôle.
 ('Dir','L2',1,1,1),   -- owner : has_permission lui accorde tout
 ('Mgr','L2',1,1,1),
 ('NWk','L2',1,1,0),   -- la paillasse saisit mais ne supprime pas
 ('RO','L2',1,0,0),
 ('Fld','L2',0,0,0),   -- LA CASE QUI JUSTIFIE LE CHANTIER
 ('Ldr','L2',0,0,0),
 ('Part','L2',0,0,0), ('Coloc','L2',0,0,0), ('ProB','L2',0,0,0), ('An','L2',0,0,0);

insert into res
select 'Matrice AVEC — ' || a.acteur || ' / ' || a.labo || ' / ' || m.famille,
       a.l::text || a.e::text || a.s::text,
       m.lecture::text || m.ecriture::text || m.suppression::text
from mat m join attendu a on a.acteur = m.acteur and a.labo = m.labo
where m.phase = 'AVEC'
  and (m.lecture, m.ecriture, m.suppression) is distinct from (a.l, a.e, a.s);

-- Et la contre-épreuve : la matrice a bien été mesurée en entier.
insert into res select 'La matrice AVEC est complète (10 acteurs × 13 familles × 2 labos)', '260',
  (select count(*)::text from mat where phase='AVEC');

-- ============================================================
-- 5. LA REPRISE — LE LABORATOIRE QUI REJOINT SON ENTREPRISE
-- ============================================================
-- On reproduit la situation de production : le dirigeant a saisi son
-- laboratoire sur son téléphone, donc dans son espace PERSONNEL.
insert into public.culture_batches
  (id, workspace_id, batch_code, species_name, culture_stage, status,
   started_at, initial_explant_count, current_count, created_at)
values ('b087c001-0000-4000-8000-000000000087', (select v from ids where k='ws_dir'),
        'TEL-001', 'Alocasia scalprum', 'elongation', 'active', now(), 5, 25, now());
insert into public.bioreactors
  (id, workspace_id, name, code, bioreactor_type, total_volume_liters,
   working_volume_liters, status, automation_enabled, created_at)
values ('b087c002-0000-4000-8000-000000000087', (select v from ids where k='ws_dir'),
        'Bioréacteur du téléphone', 'BR-TEL', 'temporaryImmersion', 5, 2, 'idle', false, now());
-- Une plante mère, restée dans le monde du jardin : elle NE DOIT PAS
-- suivre, et le transfert doit le DIRE.
insert into public.plants (id, workspace_id, custom_name, type)
values ('b087c003-0000-4000-8000-000000000087', (select v from ids where k='ws_dir'),
        'Pied mère', 'houseplant');
update public.culture_batches
   set mother_plant_id = 'b087c003-0000-4000-8000-000000000087'
 where id = 'b087c001-0000-4000-8000-000000000087';
-- Une étiquette QR sur le lot, et une étiquette de PLANTE qui ne doit
-- pas bouger.
insert into public.smart_tags (id, workspace_id, type, public_token, culture_batch_id)
values ('b087c010-0000-4000-8000-000000000087', (select v from ids where k='ws_dir'), 'qr', 'jeton-lot-b087', 'b087c001-0000-4000-8000-000000000087');
insert into public.smart_tags (id, workspace_id, type, public_token, plant_id)
values ('b087c011-0000-4000-8000-000000000087', (select v from ids where k='ws_dir'), 'qr', 'jeton-plante-b087', 'b087c003-0000-4000-8000-000000000087');

-- Le compte AVANT, pour le §26 : rien ne doit disparaître.
create temp table compte_avant(t text, n bigint) on commit drop;
do $$
declare t text; n bigint;
begin
  foreach t in array (public.biolab_tables_espace() || array['smart_tags','plants']) loop
    execute format('select count(*) from public.%I', t) into n;
    insert into compte_avant values (t, n);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5.1 Les quatre façons d'en abuser — toutes refusées
-- ------------------------------------------------------------
create function pg_temp.echoue(p_acteur text, p_sql text) returns boolean
language plpgsql as $f$
declare rate boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = p_acteur))::text, true);
  begin
    execute p_sql;
  exception when others then rate := true;
  end;
  perform set_config('request.jwt.claims', '{}', true);
  return rate;
end $f$;

insert into res values
 ('Un salarié ne peut pas reprendre le laboratoire privé du dirigeant', 'true',
  pg_temp.echoue('Mgr', format(
    'select public.transferer_biolab_vers_entreprise(%L,%L)',
    (select v from ids where k='org'), (select v from ids where k='ws_dir')))::text),
 ('Une entreprise tierce non plus', 'true',
  pg_temp.echoue('ProB', format(
    'select public.transferer_biolab_vers_entreprise(%L,%L)',
    (select v from ids where k='orgB'), (select v from ids where k='ws_dir')))::text),
 ('Le dirigeant ne peut pas verser le laboratoire d''un particulier', 'true',
  pg_temp.echoue('Dir', format(
    'select public.transferer_biolab_vers_entreprise(%L,%L)',
    (select v from ids where k='org'), (select v from ids where k='ws_part')))::text),
 ('Ni partir de l''espace d''une entreprise', 'true',
  pg_temp.echoue('Dir', format(
    'select public.transferer_biolab_vers_entreprise(%L,%L)',
    (select v from ids where k='org'), (select v from ids where k='ws_org')))::text);

insert into res select 'Après ces quatre refus, le lot du téléphone n''a pas bougé', 'true',
  (select (workspace_id = (select v from ids where k='ws_dir'))::text
     from public.culture_batches where id = 'b087c001-0000-4000-8000-000000000087');

-- ------------------------------------------------------------
-- 5.2 La reprise, par celui qui a le droit
-- ------------------------------------------------------------
-- LA FRAÎCHEUR DE L'ÉTAT NE DOIT PAS ÊTRE RÉÉCRITE PAR LA REPRISE.
-- `bioreactors.updated_at` est ce que l'écran de supervision affiche
-- comme date de l'état (« connu il y a 4 j », plus une mise en garde
-- au-delà de 24 h). Une écriture d'administration qui la remet à
-- l'instant ferait passer un état vieux de plusieurs mois pour un
-- relevé frais, et précisément au moment où l'entreprise découvre
-- l'écran. On le vieillit exprès, puis on vérifie qu'il n'a pas bougé.
update public.bioreactors set updated_at = now() - interval '40 days'
 where id = 'b087c002-0000-4000-8000-000000000087';
create temp table fraicheur_avant(t timestamptz) on commit drop;
insert into fraicheur_avant
select updated_at from public.bioreactors
 where id = 'b087c002-0000-4000-8000-000000000087';

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Dir'))::text, true);
create temp table transfert(r jsonb) on commit drop;
insert into transfert
select public.transferer_biolab_vers_entreprise(
  (select v from ids where k='org'), (select v from ids where k='ws_dir'));
select set_config('request.jwt.claims', '{}', true);

insert into res select 'Le lot du téléphone est arrivé dans l''entreprise', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.culture_batches where id = 'b087c001-0000-4000-8000-000000000087');
insert into res select 'Le bioréacteur aussi', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.bioreactors where id = 'b087c002-0000-4000-8000-000000000087');
insert into res select 'L''étiquette du lot a suivi', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.smart_tags where public_token = 'jeton-lot-b087');
insert into res select 'L''étiquette de la PLANTE est restée où est sa plante', 'true',
  (select (workspace_id = (select v from ids where k='ws_dir'))::text
     from public.smart_tags where public_token = 'jeton-plante-b087');
insert into res select 'La plante mère est restée dans le monde du jardin', 'true',
  (select (workspace_id = (select v from ids where k='ws_dir'))::text
     from public.plants where id = 'b087c003-0000-4000-8000-000000000087');
insert into res select 'Et le transfert le DIT au lieu de le taire', '1',
  (select (r->>'plantes_meres_restees') from transfert);

insert into res select 'La reprise n''a PAS rajeuni la date d''état du bioréacteur', 'true',
  (select (r.updated_at = a.t)::text
     from public.bioreactors r, fraicheur_avant a
    where r.id = 'b087c002-0000-4000-8000-000000000087');
insert into res select 'Et cette date reste bien ancienne (plus de 24 h)', 'true',
  (select (now() - r.updated_at > interval '24 hours')::text
     from public.bioreactors r
    where r.id = 'b087c002-0000-4000-8000-000000000087');

-- §26 : rien n'a disparu. On ne compte pas « ce qui est arrivé », on
-- compte le TOTAL de chaque table, avant et après.
create temp table compte_apres(t text, n bigint) on commit drop;
do $$
declare t text; n bigint;
begin
  foreach t in array (public.biolab_tables_espace() || array['smart_tags','plants']) loop
    execute format('select count(*) from public.%I', t) into n;
    insert into compte_apres values (t, n);
  end loop;
end $$;

insert into res
select 'Reprise §26 — aucune ligne perdue dans ' || a.t, a.n::text, b.n::text
from compte_avant a join compte_apres b on b.t = a.t
where a.n is distinct from b.n;

insert into res select 'Reprise §26 — les 22 tables ont bien été comptées', '22',
  (select count(*)::text from compte_avant a join compte_apres b on b.t = a.t);

-- Le laboratoire repris est désormais VU par l'entreprise, et
-- seulement par qui a le droit.
create function pg_temp.voit(p_acteur text, p_id uuid) returns int
language plpgsql as $f$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = p_acteur))::text, true);
  execute 'set local role authenticated';
  begin
    select count(*)::int into n from public.culture_batches where id = p_id;
  exception when others then n := 0;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  return n;
end $f$;

insert into res values
 ('Le responsable voit enfin le lot saisi au téléphone', '1',
  pg_temp.voit('Mgr','b087c001-0000-4000-8000-000000000087')::text),
 ('L''ouvrier de terrain ne le voit toujours pas', '0',
  pg_temp.voit('Fld','b087c001-0000-4000-8000-000000000087')::text),
 ('Le particulier ne l''a jamais vu', '0',
  pg_temp.voit('Part','b087c001-0000-4000-8000-000000000087')::text),
 ('Le concurrent non plus', '0',
  pg_temp.voit('ProB','b087c001-0000-4000-8000-000000000087')::text);

-- ------------------------------------------------------------
-- 5.3 Le retour arrière — exact, et réservé à son auteur
-- ------------------------------------------------------------
-- L'entreprise crée un lot À ELLE pendant que le laboratoire repris est
-- chez elle : il ne doit PAS partir avec le retour arrière.
insert into public.culture_batches
  (id, workspace_id, batch_code, species_name, culture_stage, status,
   started_at, initial_explant_count, current_count, created_at)
values ('b087c004-0000-4000-8000-000000000087', (select v from ids where k='ws_org'),
        'ENT-001', 'Alocasia scalprum', 'initiation', 'active', now(), 3, 3, now());

insert into res select 'Un salarié ne peut pas défaire la reprise du dirigeant', 'true',
  pg_temp.echoue('Mgr', format('select public.annuler_transfert_biolab(%L)',
    (select (r->>'transfert_id')::uuid from transfert)))::text;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Dir'))::text, true);
select public.annuler_transfert_biolab((select (r->>'transfert_id')::uuid from transfert));
select set_config('request.jwt.claims', '{}', true);

insert into res select 'Le lot du téléphone est rentré chez son propriétaire', 'true',
  (select (workspace_id = (select v from ids where k='ws_dir'))::text
     from public.culture_batches where id = 'b087c001-0000-4000-8000-000000000087');
insert into res select 'Le lot créé par l''entreprise est resté chez elle', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.culture_batches where id = 'b087c004-0000-4000-8000-000000000087');
insert into res select 'L''étiquette est rentrée avec son lot', 'true',
  (select (workspace_id = (select v from ids where k='ws_dir'))::text
     from public.smart_tags where public_token = 'jeton-lot-b087');
insert into res select 'On ne défait pas deux fois', 'true',
  pg_temp.echoue('Dir', format('select public.annuler_transfert_biolab(%L)',
    (select (r->>'transfert_id')::uuid from transfert)))::text;

create temp table compte_fin(t text, n bigint) on commit drop;
do $$
declare t text; n bigint;
begin
  foreach t in array (public.biolab_tables_espace() || array['smart_tags','plants']) loop
    execute format('select count(*) from public.%I', t) into n;
    insert into compte_fin values (t, n);
  end loop;
end $$;

-- Le seul écart admis est le lot que l'entreprise a créé exprès pendant
-- que le laboratoire repris était chez elle.
insert into res
select 'Retour arrière §26 — aucune ligne perdue dans ' || a.t,
       a.n::text, (b.n - case when a.t = 'culture_batches' then 1 else 0 end)::text
from compte_avant a join compte_fin b on b.t = a.t
where a.n is distinct from (b.n - case when a.t = 'culture_batches' then 1 else 0 end);

insert into res select 'Retour arrière §26 — les 22 tables ont bien été recomptées', '22',
  (select count(*)::text from compte_avant a join compte_fin b on b.t = a.t);

-- ============================================================
-- 6. LES AGRÉGATS
-- ============================================================
-- Ils sont `security invoker` : la RLS du §2 s'applique À L'INTÉRIEUR.
-- C'est la propriété de sûreté principale du §4 de la migration, et
-- c'est celle-ci qui la mesure.
create function pg_temp.tdb(p_acteur text, p_ws uuid, p_champ text) returns text
language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = p_acteur))::text, true);
  execute 'set local role authenticated';
  execute format('select (t.%I)::text from public.biolab_tableau_de_bord($1) t', p_champ)
    into r using p_ws;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  return coalesce(r, 'NULL');
end $f$;

insert into res values
 -- Deux lots : celui du laboratoire (L-2, 40 explants) et celui que
 -- l'entreprise a créé pendant la reprise (ENT-001, 3 explants).
 ('Tableau de bord — le responsable compte les lots de son entreprise', '2',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'lots_total')),
 ('Tableau de bord — et leurs 43 explants', '43',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'explants_total')),
 ('Tableau de bord — un bioréacteur actif',  '1',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'bioreacteurs_actifs')),
 ('Tableau de bord — une alerte non résolue', '1',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'alertes_actives')),
 ('Tableau de bord — 15 plantules en acclimatation', '15',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'plantules_acclimatation')),
 -- L'inspection semée est confirmée : 1 sur 1.
 ('Tableau de bord — taux de contamination de la semaine', '1.00000000000000000000',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'taux_contamination_7j')),
 -- LES DÉNOMINATEURS. Un taux sans son effectif n'est pas vérifiable :
 -- « 100 % » sur une seule inspection s'affichait exactement comme
 -- « 100 % » sur quarante. Ces quatre colonnes existent pour que
 -- l'écran puisse appliquer sa propre règle (sous cinq observations,
 -- les faits bruts remplacent le pourcentage).
 ('Dénominateur — une seule inspection derrière ce taux', '1',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'inspections_7j')),
 ('Dénominateur — deux lots ont un compte de départ', '2',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'lots_mesures_multiplication')),
 ('Dénominateur — une acclimatation mesurable', '1',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'acclimatations_mesurees')),
 -- Un seul des deux lots a été inspecté : l'écart entre l'effectif et
 -- l'effectif observé est réel, et c'est lui qu'il faut pouvoir dire.
 ('Dénominateur — un seul des deux lots a été inspecté', '1',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'lots_inspectes')),
 -- Moyenne des deux rapports : (40/10 + 3/3) / 2 = 2,5. Le mobile fait
 -- la moyenne DES RAPPORTS, pas le rapport des sommes.
 ('Tableau de bord — rendement de multiplication', '2.50000000000000000000',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'taux_multiplication_moyen')),
 -- 15 / 20 = 0,75.
 ('Tableau de bord — survie en acclimatation', '0.75000000000000000000',
  pg_temp.tdb('Mgr', (select v from ids where k='ws_org'), 'taux_survie_acclimatation')),
 -- LE POINT 7 : l'ouvrier de terrain n'obtient rien par la bande.
 ('L''ouvrier de terrain ne compte AUCUN lot par le tableau de bord', '0',
  pg_temp.tdb('Fld', (select v from ids where k='ws_org'), 'lots_total')),
 ('Ni aucun explant', '0',
  pg_temp.tdb('Fld', (select v from ids where k='ws_org'), 'explants_total')),
 ('Ni aucun taux — et c''est NULL, pas zéro', 'NULL',
  pg_temp.tdb('Fld', (select v from ids where k='ws_org'), 'taux_contamination_7j')),
 -- Le concurrent qui devine l'identifiant de l'espace n'obtient rien.
 ('Le concurrent qui connaît l''espace de l''autre n''en tire rien', '0',
  pg_temp.tdb('ProB', (select v from ids where k='ws_org'), 'lots_total')),
 -- LE POINT 6 : NULL et non zéro, quand la question n'a pas de réponse.
 ('Un espace sans acclimatation rend NULL, pas 0 %', 'NULL',
  pg_temp.tdb('Dir', (select v from ids where k='ws_dir'), 'taux_survie_acclimatation')),
 ('Un espace sans inspection rend NULL, pas 0 %', 'NULL',
  pg_temp.tdb('Dir', (select v from ids where k='ws_dir'), 'taux_contamination_7j')),
 ('Un espace sans cycle terminé rend NULL, pas 0 seconde', 'NULL',
  pg_temp.tdb('Dir', (select v from ids where k='ws_dir'), 'duree_cycle_moyenne_secondes'));

-- Statistiques par espèce et par bioréacteur, sous l'identité du
-- responsable.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Mgr'))::text, true);
select pg_temp.ouvrir_temp();
set local role authenticated;

insert into res select 'Statistiques par espèce — une espèce', '1',
  (select count(*)::text from public.biolab_statistiques_especes(
     (select v from ids where k='ws_org')));
insert into res select 'Statistiques par espèce — un lot contaminé sur les deux', '0.50000000000000000000',
  (select taux_contamination::text from public.biolab_statistiques_especes(
     (select v from ids where k='ws_org')));
insert into res select 'Statistiques par espèce — hyperhydricité sur un lot des deux', '0.50000000000000000000',
  (select taux_hyperhydricite::text from public.biolab_statistiques_especes(
     (select v from ids where k='ws_org')));
insert into res select 'Statistiques par bioréacteur — un cycle réussi', '1',
  (select cycles_termines::text from public.biolab_statistiques_bioreacteurs(
     (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Statistiques par bioréacteur — taux de réussite plein', '1.00000000000000000000',
  (select taux_reussite::text from public.biolab_statistiques_bioreacteurs(
     (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Supervision — le bioréacteur est à l''arrêt', 'idle',
  (select statut from public.biolab_supervision_equipements(
     (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Supervision — automatisation désactivée', 'false',
  (select automatisation_active::text from public.biolab_supervision_equipements(
     (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Supervision — le lot en cours est nommé', 'L-2',
  (select lot_en_cours_code from public.biolab_supervision_equipements(
     (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Supervision — aucun objet connecté lié : NULL, pas 0', 'NULL',
  (select coalesce(objets_lies::text, 'NULL') from public.biolab_supervision_equipements(
     (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Supervision — la fraîcheur de l''état est datée', 'true',
  (select (etat_connu_le is not null and fraicheur_secondes >= 0)::text
     from public.biolab_supervision_equipements(
       (select v from ids where k='ws_org')) where code = 'BR-2');
insert into res select 'Activité récente — trois événements datés', '3',
  (select count(*)::text from public.biolab_activite_recente(
     (select v from ids where k='ws_org'), 15));

reset role;
select set_config('request.jwt.claims', '{}', true);

-- La généalogie : un lot fille, ouverte depuis la FILLE, doit rendre
-- toute la lignée — c'est ce que fait `CultureLineageService.tree`.
insert into public.culture_batches
  (id, workspace_id, batch_code, species_name, culture_stage, status, started_at,
   initial_explant_count, current_count, parent_batch_id, created_at)
values ('b087b101-0000-4000-8000-000000000087', (select v from ids where k='ws_org'),
        'L-2-A', 'Alocasia scalprum', 'multiplication', 'active', now(), 20, 20,
        'b087b001-0000-4000-8000-000000000087', now()),
       ('b087b102-0000-4000-8000-000000000087', (select v from ids where k='ws_org'),
        'L-2-B', 'Alocasia scalprum', 'multiplication', 'active', now(), 20, 20,
        'b087b001-0000-4000-8000-000000000087', now());

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Mgr'))::text, true);
select pg_temp.ouvrir_temp();
set local role authenticated;
insert into res select 'Généalogie — ouverte depuis une fille, elle rend les trois lots', '3',
  (select count(*)::text from public.biolab_genealogie_lot('b087b101-0000-4000-8000-000000000087'));
insert into res select 'Généalogie — et elle part bien de la racine', 'L-2',
  (select code from public.biolab_genealogie_lot('b087b101-0000-4000-8000-000000000087')
    where est_racine);
reset role;
select set_config('request.jwt.claims', '{}', true);

-- Un cycle dans la généalogie ne doit pas faire tourner la récursion
-- sans fin : c'est la borne à 64 niveaux du §4.5.
update public.culture_batches set parent_batch_id = 'b087b101-0000-4000-8000-000000000087'
 where id = 'b087b001-0000-4000-8000-000000000087';
do $$
declare n int; ok boolean := true;
begin
  begin
    select count(*) into n from public.biolab_genealogie_lot('b087b101-0000-4000-8000-000000000087');
  exception when others then ok := false;
  end;
  insert into res values ('Une lignée circulaire ne fait pas tourner la base sans fin', 'true', ok::text);
end $$;
update public.culture_batches set parent_batch_id = null
 where id = 'b087b001-0000-4000-8000-000000000087';

-- ============================================================
-- 7. §7 — LE WEB NE COMMANDE RIEN
-- ============================================================
-- Aucune fonction de 0087 n'écrit dans une table d'équipement, sauf le
-- transfert d'espace et seulement sur `workspace_id`. On lit le corps
-- des fonctions plutôt que de le supposer.
-- (a) Les six lectures du §4 n'écrivent RIEN : aucun update, aucun
--     insert, aucun delete dans leur corps.
insert into res
select 'La lecture ' || p.proname || ' n''écrit rien', 'true', 'false'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in ('biolab_tableau_de_bord','biolab_statistiques_especes',
                    'biolab_statistiques_bioreacteurs','biolab_activite_recente',
                    'biolab_genealogie_lot','biolab_supervision_equipements')
  and p.prosrc ~* '\\m(update|insert|delete)\\M';

insert into res select 'Les six lectures du §4 existent bien', '6',
  (select count(*)::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
    where p.proname in ('biolab_tableau_de_bord','biolab_statistiques_especes',
                        'biolab_statistiques_bioreacteurs','biolab_activite_recente',
                        'biolab_genealogie_lot','biolab_supervision_equipements'));

-- (b) Aucune fonction de 0087 ne touche à la table d'ordres du produit.
insert into res
select 'Aucune fonction de 0087 n''écrit dans device_commands : ' || p.proname, '0', '1'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where (p.proname like 'biolab%' or p.proname like '%biolab%')
  and p.prosrc ~* 'device_commands';

-- (c) Le transfert ne modifie QUE workspace_id et updated_at : aucune
--     colonne de commande n'apparaît dans son corps.
insert into res select 'Le transfert n''écrit aucune colonne de commande', 'true',
  (select (prosrc !~* 'set\\s+(status|automation_enabled|active_program_version_id|current_batch_id)')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
    where p.proname = 'transferer_biolab_vers_entreprise');

-- (d) ET LA LIMITE HONNÊTE, MESURÉE ICI PLUTÔT QUE PASSÉE SOUS SILENCE.
--     RLS ne sait pas distinguer le téléphone du navigateur : les deux
--     passent par la même API avec le même jeton. Un responsable qui
--     détient biolab.write PEUT donc, en appelant l'API directement,
--     basculer automation_enabled. Le §7 n'est pas tenu par la base, il
--     est tenu par l'ABSENCE de bouton dans web-pro. Cette ligne
--     enregistre le fait pour que personne ne croie l'inverse — et si
--     un jour la base se met à l'interdire, elle se remarquera.
do $ctrl$
declare peut boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Mgr'))::text, true);
  execute 'set local role authenticated';
  begin
    update public.bioreactors set automation_enabled = true
     where id = 'b087b002-0000-4000-8000-000000000087';
    peut := found;
    raise exception 'annulation volontaire';
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  insert into res values (
    'CONNU : la base n''empêche pas un responsable de commander un équipement — c''est web-pro qui n''offre pas le bouton (§7)',
    'true', peut::text);
end $ctrl$;

-- ============================================================
-- 7 BIS. LA PORTE DE SORTIE — L'APPROPRIATION EN UNE INSTRUCTION
-- ============================================================
-- LE DÉFAUT QUE CETTE SECTION MESURE. Avant le §2 bis de la migration,
-- un salarié détenant `biolab.write` s'appropriait tout le laboratoire
-- de son entreprise en écrivant
--
--     update culture_batches set workspace_id = <son espace personnel>
--
-- Le `with check` de la politique de modification laissait passer,
-- parce que la branche qui protège le particulier répond « vrai » sur
-- tout espace qu'aucune entreprise ne possède. L'entreprise perdait la
-- lecture immédiatement, son propriétaire compris, et rien n'était
-- tracé. Enchaîné avec un `delete` dans l'espace d'arrivée, cela
-- contournait aussi `biolab.manage` — la permission créée pour que qui
-- écrit ne supprime pas.
--
-- Les espaces personnels des salariés ont été posés par le déclencheur
-- d'inscription du produit, comme pour les autres acteurs.
insert into ids select 'ws_mgr', id from public.workspaces
 where owner_id = (select v from ids where k='Mgr') and is_personal;
insert into ids select 'ws_nwk', id from public.workspaces
 where owner_id = (select v from ids where k='NWk') and is_personal;

-- Un lot bien à l'entreprise, dans son espace.
insert into public.culture_batches
  (id, workspace_id, batch_code, species_name, culture_stage, status,
   started_at, initial_explant_count, current_count, created_at)
values ('b087c020-0000-4000-8000-000000000087', (select v from ids where k='ws_org'),
        'ENT-CONVOITE', 'Alocasia scalprum', 'multiplication', 'active', now(), 4, 12, now());

-- La tentative, jouée sous RLS réelle, par chacun des deux rôles qui
-- détiennent `biolab.write`.
create function pg_temp.tente_deplacement(p_acteur text, p_destination text) returns int
language plpgsql as $f$
declare n int := -1;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = p_acteur))::text, true);
  execute 'set local role authenticated';
  begin
    with d as (
      update public.culture_batches
         set workspace_id = (select v from ids where k = p_destination)
       where id = 'b087c020-0000-4000-8000-000000000087'
      returning 1)
    select count(*)::int into n from d;
  exception when others then
    -- Un refus dur est le résultat attendu : le déclencheur lève.
    n := 0;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  return n;
end $f$;

insert into res values
 ('L''ouvrier de paillasse ne sort pas un lot vers son espace privé', '0',
  pg_temp.tente_deplacement('NWk','ws_nwk')::text),
 ('Le responsable non plus, malgré biolab.manage', '0',
  pg_temp.tente_deplacement('Mgr','ws_mgr')::text),
 ('Ni vers l''espace d''une autre entreprise', '0',
  pg_temp.tente_deplacement('Mgr','ws_dir')::text);

insert into res select 'Après ces trois tentatives, le lot est toujours à l''entreprise', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.culture_batches where id = 'b087c020-0000-4000-8000-000000000087');
insert into res select 'Et aucune trace de transfert n''a été fabriquée', '1',
  (select count(*)::text from public.biolab_transferts);

-- LE PARTICULIER NE RENCONTRE JAMAIS CE GARDE. On lui donne un second
-- espace personnel et on déplace son lot de l'un à l'autre : le
-- déclencheur ne se lève que si une ENTREPRISE est d'un côté ou de
-- l'autre.
insert into public.workspaces (id, owner_id, name, is_personal)
values ('b087c030-0000-4000-8000-000000000087',
        (select v from ids where k='Part'), 'Second espace', true);
insert into public.culture_batches
  (id, workspace_id, batch_code, species_name, culture_stage, status,
   started_at, initial_explant_count, current_count, created_at)
values ('b087c031-0000-4000-8000-000000000087', (select v from ids where k='ws_part'),
        'PART-DEPL', 'Monstera', 'initiation', 'active', now(), 2, 2, now());

do $$
begin
  update public.culture_batches
     set workspace_id = 'b087c030-0000-4000-8000-000000000087'
   where id = 'b087c031-0000-4000-8000-000000000087';
exception when others then null;
end $$;

insert into res select 'Le particulier déplace encore son lot entre ses deux espaces', 'true',
  (select (workspace_id = 'b087c030-0000-4000-8000-000000000087')::text
     from public.culture_batches where id = 'b087c031-0000-4000-8000-000000000087');

-- ET LA REPRISE, ELLE, PASSE TOUJOURS. C'est la contrepartie : un garde
-- qui bloquerait aussi le chemin légitime rendrait le §3 inutilisable.
-- Le §5 ci-dessus l'a déjà prouvé en déplaçant tout le laboratoire du
-- dirigeant ; on le redit ici pour que la section se lise seule.
insert into res select 'La reprise tracée, elle, a bien déplacé les lignes', 'true',
  (select (count(*) > 0)::text from public.biolab_transfert_lignes);

-- L'ORACLE SUR L'ESPACE D'UNE INSPECTION. La fonction
-- `biolab_inspection_workspace` rattachait un objet à son propriétaire
-- pour n'importe quel compte connecté. Elle exige désormais
-- l'appartenance à l'espace.
insert into public.bioreactor_inspections
  (id, workspace_id, culture_batch_id, date, culture_appearance,
   contamination_status, hyperhydricity_status, necrosis_status,
   browning_status, growth_status, notes, created_at)
values ('b087c040-0000-4000-8000-000000000087', (select v from ids where k='ws_org'),
        'b087c020-0000-4000-8000-000000000087', now(), 'healthy',
        'none', 'none', 'none', 'none', 'normal', '', now());

create function pg_temp.oracle(p_acteur text) returns text
language plpgsql as $f$
declare r uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = p_acteur))::text, true);
  execute 'set local role authenticated';
  begin
    select public.biolab_inspection_workspace('b087c040-0000-4000-8000-000000000087') into r;
  exception when others then r := null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  return coalesce(r::text, 'NULL');
end $f$;

insert into res values
 ('Un concurrent n''apprend plus à qui appartient une inspection', 'NULL',
  pg_temp.oracle('ProB')),
 ('Un particulier étranger non plus', 'NULL',
  pg_temp.oracle('Part')),
 ('Mais le responsable de l''entreprise, lui, l''obtient toujours',
  (select v::text from ids where k='ws_org'),
  pg_temp.oracle('Mgr'));

-- ============================================================
-- 8. LA DOUBLE MESURE — LE MONDE D'AVANT, ET CE QU'IL CHANGE
-- ============================================================
-- On retire les politiques restrictives de 0087, et on remesure. C'est
-- le monde d'avant la migration, reconstitué exactement.
--
-- DEUX CHOSES DOIVENT EN SORTIR, ET ELLES SONT AUSSI IMPORTANTES L'UNE
-- QUE L'AUTRE :
--   • le laboratoire du particulier rend EXACTEMENT les mêmes chiffres
--     dans les deux mondes. Si une seule case bouge, 0087 lui a pris
--     quelque chose ;
--   • le laboratoire de l'entreprise, lui, DOIT bouger. Une politique
--     restrictive qui ne changerait rien serait une politique inutile —
--     et c'est exactement ce qu'aurait donné une politique permissive
--     ajoutée « en ou », qui n'aurait rien restreint du tout.
do $$
declare t text;
begin
  foreach t in array (public.biolab_tables_espace() || array['biolab_inspection_photos']) loop
    execute format('drop policy if exists %I on public.%I', 'BioLab entreprise — lecture', t);
    execute format('drop policy if exists %I on public.%I', 'BioLab entreprise — création', t);
    execute format('drop policy if exists %I on public.%I', 'BioLab entreprise — modification', t);
    execute format('drop policy if exists %I on public.%I', 'BioLab entreprise — suppression', t);
  end loop;
end $$;

select pg_temp.mesure_tous('SANS');

insert into res
select 'Le particulier ne perd RIEN — ' || a.acteur || ' / ' || a.famille,
       a.lecture::text || a.ecriture::text || a.suppression::text,
       b.lecture::text || b.ecriture::text || b.suppression::text
from mat a join mat b
  on b.phase = 'SANS' and a.acteur = b.acteur and a.labo = b.labo and a.famille = b.famille
where a.phase = 'AVEC' and a.labo = 'L1'
  and (a.lecture, a.ecriture, a.suppression) is distinct from (b.lecture, b.ecriture, b.suppression);

insert into res select 'La double mesure a bien comparé les 130 cases du particulier', '130',
  (select count(*)::text from mat a join mat b
     on b.phase='SANS' and a.acteur=b.acteur and a.labo=b.labo and a.famille=b.famille
   where a.phase='AVEC' and a.labo='L1');
insert into res select 'La matrice SANS est complète elle aussi', '260',
  (select count(*)::text from mat where phase='SANS');

-- Et la preuve que le garde sert à quelque chose : sans lui, l'ouvrier
-- de terrain avait TOUT sur le laboratoire de l'entreprise.
insert into res select 'Sans 0087, l''ouvrier de terrain lisait les 13 familles', '13',
  (select count(*)::text from mat
    where phase='SANS' and acteur='Fld' and labo='L2' and lecture = 1);
insert into res select 'Sans 0087, il pouvait même les SUPPRIMER', '13',
  (select count(*)::text from mat
    where phase='SANS' and acteur='Fld' and labo='L2' and suppression = 1);
insert into res select 'Avec 0087, il n''en lit plus aucune', '0',
  (select count(*)::text from mat
    where phase='AVEC' and acteur='Fld' and labo='L2' and lecture = 1);
insert into res select 'Ni n''en supprime aucune', '0',
  (select count(*)::text from mat
    where phase='AVEC' and acteur='Fld' and labo='L2' and suppression = 1);
insert into res select 'Sans 0087, la lecture seule pouvait supprimer un lot', '13',
  (select count(*)::text from mat
    where phase='SANS' and acteur='RO' and labo='L2' and suppression = 1);
insert into res select 'Avec 0087, elle lit et rien de plus', '0',
  (select count(*)::text from mat
    where phase='AVEC' and acteur='RO' and labo='L2' and suppression = 1);

-- `anon` n'a jamais rien vu, dans aucun des deux mondes. Ce n'est pas
-- 0087 qui l'arrête, c'est la politique d'espace — mais si un jour
-- quelqu'un la desserrait, cette ligne le dirait.
insert into res select 'anon ne lit rien, ni avant ni après', '0',
  (select count(*)::text from mat where acteur='An' and (lecture=1 or ecriture=1 or suppression=1));

-- ============================================================
-- 9. LE VERDICT
-- ============================================================
select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
