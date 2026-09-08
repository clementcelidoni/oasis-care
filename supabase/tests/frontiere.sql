-- Oasis Care — LA FRONTIÈRE (migration 0086).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LA MATRICE D'ACCÈS, CASE PAR CASE. Dix acteurs, deux jardins,
--      vingt-cinq familles de données, trois phases — avant livraison,
--      après livraison, après annulation. Chaque case est MESURÉE sous
--      RLS réelle, en lecture ET en écriture, jamais déduite d'une
--      lecture de politique. La matrice attendue est écrite en toutes
--      lettres au § 9 : toute case qui s'en écarte fait échouer le test
--      et se nomme elle-même.
--
--   2. LE PARTICULIER NE PERD RIEN. C'est la moitié du travail et la
--      plus facile à rater : le jardin personnel rend exactement les
--      mêmes chiffres aux trois phases. Si une seule case de G1 bouge
--      entre la phase A et la phase C, le pont a mangé quelque chose.
--
--   3. LE DÉFAUT 1. Après livraison, le client voit SES PLANTES. C'était
--      zéro. C'est la case qui justifie tout le chantier.
--
--   4. LA FUITE SYMÉTRIQUE, refermée. Le salarié gardait dix familles en
--      ÉCRITURE sur un jardin qui avait quitté son entreprise. Il les
--      lit encore — son entreprise entretient ce jardin — mais il ne les
--      écrit plus.
--
--   5. LES COLLÈGUES. `garden_access` est par utilisateur ; la livraison
--      n'inscrivait que celui qui avait cliqué. Le test vérifie que
--      toute l'équipe voit le jardin SANS qu'aucune ligne nominative ne
--      leur ait été posée — trois lignes d'accès en tout, pas une de
--      plus.
--
--   6. TOUT OU RIEN. Une livraison qui échoue en cours de route ne
--      déplace rien, ne crée aucun accès, ne laisse aucune trace.
--
--   7. ON NE SUPPRIME RIEN — §26. Les compteurs de toutes les familles
--      sont pris avant la livraison et repris après l'annulation. La
--      seule différence admise est la plante que le professionnel ajoute
--      exprès en cours de route.
--
--   8. LE PONT NE FUIT PAS. Une entreprise TIERCE ne voit rien, ne
--      s'octroie rien. Un professionnel ne peut plus se déclarer
--      propriétaire du jardin de son client. `anon` a pourtant tous les
--      GRANT de table : seule RLS l'arrête, et elle l'arrête.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni l'entreprise, ni les
-- jardins, ni les accès, ni les lignes de livraison.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0086, ou l'envoyer à l'API Management. UN SEUL bloc begin/rollback —
-- un test découpé en plusieurs blocs verrait son premier rollback
-- annuler la migration posée devant.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
-- La matrice mesurée : une ligne par phase × acteur × jardin × famille.
create temp table mat(phase text, acteur text, jardin text, grp text,
                      famille text, lecture int, ecriture int) on commit drop;
-- La matrice ATTENDUE, écrite à la main au § 9.
create temp table att(phase text, acteur text, jardin text,
                      lecture int, ecriture int) on commit drop;
-- Les vingt-cinq familles.
create temp table fam(ord int, grp text, nom text, src text, filtre text) on commit drop;
-- Les compteurs « avant », pour prouver qu'on n'a rien supprimé.
create temp table cpt(etape text, tbl text, n bigint) on commit drop;

grant all on res, ids, mat, att, fam, cpt to authenticated, anon;

-- ============================================================
-- 1. LES ACTEURS
-- ============================================================
-- Dix, et chacun existe pour une raison :
--
--   P    le particulier propriétaire. Il est aussi le client CRM de
--        l'entreprise — c'est lui qui recevra le jardin.
--   Fw   son foyer, inscrit dans son ESPACE DE TRAVAIL. Le seul
--        mécanisme qui ouvrait le contenu d'un jardin avant 0086.
--   Fg   son foyer, inscrit seulement par une ligne `garden_access`.
--        Avant 0086 il voyait le plan et zéro plante ; c'est le témoin
--        du demi-pont.
--   Pro  le paysagiste, propriétaire de l'entreprise. Il a toutes les
--        permissions (`role in ('owner','admin')` dans has_permission).
--   Sal  le salarié `readOnly` : `clients.read`, PAS `digitalTwin.edit`.
--        Il doit lire un jardin livré, et ne plus l'écrire.
--   Des  le `designer` : `clients.read` ET `digitalTwin.edit`. C'est lui
--        qui entretient le plan après la livraison — s'il perdait
--        l'écriture, le pont serait inutile.
--   Fld  le `fieldWorker` : `projects.read` et rien d'autre. Il perd le
--        jardin après la livraison, et c'est VOULU — il ne voit pas non
--        plus la fiche client.
--   Ldr  le `teamLeader` : `projects.manage`, `projects.read`. LE CAS
--        QU'ON AVAIT OUBLIÉ DE NOMMER. Quatre rôles sur onze n'ont pas
--        `clients.read` — fieldWorker, teamLeader, nurseryWorker,
--        orderPicker — et le compte rendu n'en citait qu'un. Le chef
--        d'équipe est pourtant celui qui MÈNE SES GARS SUR LE JARDIN :
--        s'il doit le perdre, il faut que ce soit écrit et mesuré, pas
--        découvert par un client au téléphone.
--   Cus  un rôle `custom` portant `digitalTwin.edit` SANS `clients.read`.
--        Il n'est pas attribuable depuis l'écran équipe aujourd'hui, et
--        c'est justement pour cela qu'il est ici : il mesure ce que
--        vaudrait la frontière si un rôle séparait un jour les deux
--        permissions. Les politiques d'écriture étant en `cmd = ALL`,
--        leur `using` accorde aussi le `select` : sans le « et » posé
--        dans `can_edit_garden`, il LIRAIT le jardin d'un client qu'il
--        n'a pas le droit de voir.
--   ProB le propriétaire d'une AUTRE entreprise. Le pont ne doit rien
--        lui ouvrir, jamais.
--   T    un tiers sans aucun lien.
--   An   `anon`. Il a SELECT/INSERT/UPDATE/DELETE au niveau GRANT sur
--        plants, gardens et le reste : seule RLS l'arrête.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('f0860001-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-prop@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860002-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-foyerws@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860003-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-foyerga@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860004-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-pro@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860005-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-salarie@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860006-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-designer@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860007-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-terrain@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860008-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-prob@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860009-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-tiers@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860010-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-chefequipe@frontiere.invalid','',now(),now(),now(),'{}','{}'),
 ('f0860011-0000-4000-8000-000000000086','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fr-custom@frontiere.invalid','',now(),now(),now(),'{}','{}');

insert into ids values
 ('P',   'f0860001-0000-4000-8000-000000000086'),
 ('Fw',  'f0860002-0000-4000-8000-000000000086'),
 ('Fg',  'f0860003-0000-4000-8000-000000000086'),
 ('Pro', 'f0860004-0000-4000-8000-000000000086'),
 ('Sal', 'f0860005-0000-4000-8000-000000000086'),
 ('Des', 'f0860006-0000-4000-8000-000000000086'),
 ('Fld', 'f0860007-0000-4000-8000-000000000086'),
 ('ProB','f0860008-0000-4000-8000-000000000086'),
 ('T',   'f0860009-0000-4000-8000-000000000086'),
 ('Ldr', 'f0860010-0000-4000-8000-000000000086'),
 ('Cus', 'f0860011-0000-4000-8000-000000000086'),
 ('g1',  'f086cccc-0000-4000-8000-000000000001'),
 ('g2',  'f086cccc-0000-4000-8000-000000000002');

-- Le déclencheur `on_auth_user_created` a déjà fabriqué un espace
-- personnel à chacun et l'y a inscrit. On lit ce que le produit a posé
-- plutôt que de le refaire.
insert into ids select 'ws_p', id from public.workspaces
 where owner_id = (select v from ids where k='P') and is_personal;
-- L'espace personnel du tiers : il lui sert à fabriquer le jardin bidon
-- avec lequel il tentera de réclamer le fichier d'un autre (§ 8 nonies).
insert into ids select 'ws_t', id from public.workspaces
 where owner_id = (select v from ids where k='T') and is_personal;

insert into public.workspace_members (workspace_id, user_id, role)
 select (select v from ids where k='ws_p'), (select v from ids where k='Fw'), 'member';

-- L'entreprise, par la fonction du produit : elle inscrit son créateur
-- dans `organization_members` ET dans `workspace_members`.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Pro'))::text, true);
insert into ids select 'org', public.create_professional_organization('Paysages Frontière','landscaper');

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
insert into ids select 'orgB', public.create_professional_organization('Paysages Concurrents','landscaper');

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


-- Les trois salariés, inscrits EXACTEMENT comme le fait
-- `accept_organization_invitation` : les deux tables, toujours.
insert into public.organization_members (organization_id, user_id, role)
values ((select v from ids where k='org'), (select v from ids where k='Sal'), 'readOnly'),
       ((select v from ids where k='org'), (select v from ids where k='Des'), 'designer'),
       ((select v from ids where k='org'), (select v from ids where k='Fld'), 'fieldWorker'),
       ((select v from ids where k='org'), (select v from ids where k='Ldr'), 'teamLeader');
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
values ((select v from ids where k='org'), (select v from ids where k='Cus'),
        'custom', array['digitalTwin.edit']);
insert into public.workspace_members (workspace_id, user_id, role)
values ((select v from ids where k='ws_org'), (select v from ids where k='Sal'), 'readOnly'),
       ((select v from ids where k='ws_org'), (select v from ids where k='Des'), 'designer'),
       ((select v from ids where k='ws_org'), (select v from ids where k='Fld'), 'fieldWorker'),
       ((select v from ids where k='ws_org'), (select v from ids where k='Ldr'), 'teamLeader'),
       ((select v from ids where k='ws_org'), (select v from ids where k='Cus'), 'member');

-- Le particulier est client de l'entreprise, avec un compte portail :
-- `deliver_garden_to_client` l'exige.
insert into public.crm_customers (id, organization_id, display_name)
values ('f086dddd-0000-4000-8000-000000000001', (select v from ids where k='org'), 'Madame Particulier');
insert into ids values ('cust','f086dddd-0000-4000-8000-000000000001');
insert into public.client_portal_access (organization_id, customer_id, user_id)
values ((select v from ids where k='org'), (select v from ids where k='cust'), (select v from ids where k='P'));

-- ============================================================
-- 2. LES DEUX JARDINS ET LEURS VINGT-CINQ FAMILLES
-- ============================================================
-- G1 : jardin PERSONNEL, né dans l'espace du particulier — le témoin.
-- G2 : jardin CLIENT, né dans l'espace de l'entreprise, qui sera livré.
--
-- Un exemplaire de CHAQUE famille dans CHAQUE jardin : c'est ce qui
-- permet de lire la matrice comme un tableau de 0 et de 1.
-- ON REPOSE L'IDENTITÉ AVANT DE SEMER. Les appels ci-dessus ont laissé
-- les claims de `ProB` dans la session ; sans ce nettoyage, le
-- déclencheur `enforce_garden_child_workspace` — qui refuse désormais
-- qu'on dépose une ligne dans le jardin d'autrui — verrait le
-- concurrent planter dans les deux jardins, et il aurait raison de
-- refuser. Le jeu d'essai se pose SANS utilisateur, comme le ferait une
-- migration.
select set_config('request.jwt.claims', '{}', true);

insert into public.gardens (id, workspace_id, name)
values ('f086cccc-0000-4000-8000-000000000001', (select v from ids where k='ws_p'),   'Jardin personnel'),
       ('f086cccc-0000-4000-8000-000000000002', (select v from ids where k='ws_org'), 'Jardin client');

do $$
declare
  g uuid; w uuid; p text; i int;
begin
  for i in 1..2 loop
    if i = 1 then
      g := 'f086cccc-0000-4000-8000-000000000001'; p := '1';
      select v into w from ids where k='ws_p';
    else
      g := 'f086cccc-0000-4000-8000-000000000002'; p := '2';
      select v into w from ids where k='ws_org';
    end if;

    insert into public.plants (id, workspace_id, garden_id, custom_name, type)
      values (('f086' || p || '001-0000-4000-8000-000000000086')::uuid, w, g, 'Plante ' || p, 'other');
    insert into public.sensors (id, workspace_id, garden_id, name, type)
      values (('f086' || p || '002-0000-4000-8000-000000000086')::uuid, w, g, 'Capteur ' || p, 'soilMoisture');
    insert into public.connected_devices (id, workspace_id, garden_id, provider, provider_device_id, name, category)
      values (('f086' || p || '003-0000-4000-8000-000000000086')::uuid, w, g, 'matter', 'dev-' || p, 'Vanne ' || p, 'valve');
    insert into public.irrigation_zones (id, workspace_id, garden_id, name, type)
      values (('f086' || p || '004-0000-4000-8000-000000000086')::uuid, w, g, 'Zone ' || p, 'drip');
    insert into public.greenhouses (id, workspace_id, garden_id, name)
      values (('f086' || p || '005-0000-4000-8000-000000000086')::uuid, w, g, 'Serre ' || p);
    insert into public.ponds (id, workspace_id, garden_id, name)
      values (('f086' || p || '006-0000-4000-8000-000000000086')::uuid, w, g, 'Bassin ' || p);
    insert into public.scenes (id, workspace_id, garden_id, name)
      values (('f086' || p || '007-0000-4000-8000-000000000086')::uuid, w, g, 'Scène ' || p);
    insert into public.garden_checkups (id, workspace_id, garden_id, filter_category)
      values (('f086' || p || '008-0000-4000-8000-000000000086')::uuid, w, g, 'all');
    insert into public.garden_plan_images (id, workspace_id, garden_id, storage_path)
      values (('f086' || p || '009-0000-4000-8000-000000000086')::uuid, w, g, w::text || '/plan-' || p || '.png');
    -- `approved` et non l'état par défaut : depuis le § 1.4 bis de la
    -- migration, le client ne voit que les révisions qui lui sont
    -- destinées. La révision INTERNE, elle, est ajoutée juste après —
    -- sur le seul jardin livré, là où la question se pose.
    insert into public.digital_twin_revisions (id, workspace_id, garden_id, label, snapshot, state)
      values (('f086' || p || '010-0000-4000-8000-000000000086')::uuid, w, g, 'Révision ' || p, '{}'::jsonb, 'approved');
    insert into public.garden_zones (id, garden_id, name)
      values (('f086' || p || '011-0000-4000-8000-000000000086')::uuid, g, 'Massif ' || p);

    insert into public.garden_areas (id, workspace_id, garden_id, area_type)
      values (('f086' || p || '020-0000-4000-8000-000000000086')::uuid, w, g, 'lawn');
    insert into public.garden_map_objects (id, workspace_id, garden_id, object_type,
                                           position_x_meters, position_y_meters, width_meters, height_meters)
      values (('f086' || p || '021-0000-4000-8000-000000000086')::uuid, w, g, 'tree', 1, 1, 1, 1);
    insert into public.garden_boundaries (id, workspace_id, garden_id)
      values (('f086' || p || '022-0000-4000-8000-000000000086')::uuid, w, g);
    insert into public.irrigation_pipes (id, workspace_id, garden_id)
      values (('f086' || p || '023-0000-4000-8000-000000000086')::uuid, w, g);
    insert into public.garden_cables (id, workspace_id, garden_id)
      values (('f086' || p || '024-0000-4000-8000-000000000086')::uuid, w, g);

    insert into public.plant_photos (id, plant_id, storage_path, thumbnail_storage_path)
      values (('f086' || p || '030-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '001-0000-4000-8000-000000000086')::uuid, 'ph-' || p || '.jpg', 'ph-' || p || '-t.jpg');
    insert into public.care_events (id, plant_id, type)
      values (('f086' || p || '031-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '001-0000-4000-8000-000000000086')::uuid, 'watering');
    insert into public.care_schedules (id, plant_id, type, frequency_days)
      values (('f086' || p || '032-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '001-0000-4000-8000-000000000086')::uuid, 'watering', 7);
    insert into public.ai_analyses (id, plant_id, type, provider)
      values (('f086' || p || '033-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '001-0000-4000-8000-000000000086')::uuid, 'diagnosis', 'test');
    insert into public.sensor_readings (id, sensor_id, value, unit)
      values (('f086' || p || '034-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '002-0000-4000-8000-000000000086')::uuid, 42, '%');
    insert into public.irrigation_events (id, zone_id, duration_minutes, estimated_liters)
      values (('f086' || p || '035-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '004-0000-4000-8000-000000000086')::uuid, 10, 20);
    insert into public.scene_actions (id, scene_id, capability, target_on)
      values (('f086' || p || '036-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '007-0000-4000-8000-000000000086')::uuid, 'onOff', true);
    insert into public.garden_checkup_entries (id, checkup_id, plant_id, result)
      values (('f086' || p || '037-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '008-0000-4000-8000-000000000086')::uuid,
              ('f086' || p || '001-0000-4000-8000-000000000086')::uuid, 'ok');
  end loop;
end $$;

-- LA RÉVISION INTERNE — §28. Une proposition non retenue, avec le
-- commentaire qui explique pourquoi. C'est le travail du paysagiste,
-- pas le patrimoine du client : il ne doit jamais la voir, ni avant ni
-- après la livraison. Son entreprise, elle, la garde.
insert into public.digital_twin_revisions (id, workspace_id, garden_id, label, snapshot, state, notes)
values ('f086bbbb-0000-4000-8000-000000000001',
        (select v from ids where k='ws_org'), (select v from ids where k='g2'),
        'Variante écartée', '{}'::jsonb, 'proposal',
        'Le client trouvera ça trop cher, on ne lui montre pas.');

-- Le membre du foyer « garden_access » : rien d'autre qu'une ligne
-- d'accès, sur les deux jardins. Aucun écran du produit ne pose cette
-- ligne aujourd'hui — on la pose à la main pour MESURER ce qu'elle vaut.
insert into public.garden_access (garden_id, user_id, role)
values ((select v from ids where k='g1'), (select v from ids where k='Fg'), 'householdMember'),
       ((select v from ids where k='g2'), (select v from ids where k='Fg'), 'householdMember');

-- ============================================================
-- 3. LE CATALOGUE DES FAMILLES
-- ============================================================
-- `x` désigne TOUJOURS la table mesurée : c'est elle qu'on verrouille
-- pour mesurer l'écriture. Les enfants indirects passent par leur
-- parent, exactement comme leur politique le fait.
insert into fam(ord, grp, nom, src, filtre) values
 (1,  'jardin', 'gardens',                'public.gardens x', 'x.id = @G'),

 (2,  'plan',   'garden_areas',           'public.garden_areas x',       'x.garden_id = @G'),
 (3,  'plan',   'garden_map_objects',     'public.garden_map_objects x', 'x.garden_id = @G'),
 (4,  'plan',   'garden_boundaries',      'public.garden_boundaries x',  'x.garden_id = @G'),
 (5,  'plan',   'irrigation_pipes',       'public.irrigation_pipes x',   'x.garden_id = @G'),
 (6,  'plan',   'garden_cables',          'public.garden_cables x',      'x.garden_id = @G'),

 (7,  'contenu','plants',                 'public.plants x',                 'x.garden_id = @G'),
 (8,  'contenu','sensors',                'public.sensors x',                'x.garden_id = @G'),
 (9,  'contenu','connected_devices',      'public.connected_devices x',      'x.garden_id = @G'),
 (10, 'contenu','irrigation_zones',       'public.irrigation_zones x',       'x.garden_id = @G'),
 (11, 'contenu','greenhouses',            'public.greenhouses x',            'x.garden_id = @G'),
 (12, 'contenu','ponds',                  'public.ponds x',                  'x.garden_id = @G'),
 (13, 'contenu','scenes',                 'public.scenes x',                 'x.garden_id = @G'),
 (14, 'contenu','garden_checkups',        'public.garden_checkups x',        'x.garden_id = @G'),
 (15, 'contenu','garden_plan_images',     'public.garden_plan_images x',     'x.garden_id = @G'),
 (16, 'contenu','digital_twin_revisions', 'public.digital_twin_revisions x', 'x.garden_id = @G'),
 (17, 'contenu','garden_zones',           'public.garden_zones x',           'x.garden_id = @G'),

 (18, 'enfant', 'plant_photos',           'public.plant_photos x join public.plants p on p.id = x.plant_id',                'p.garden_id = @G'),
 (19, 'enfant', 'care_events',            'public.care_events x join public.plants p on p.id = x.plant_id',                 'p.garden_id = @G'),
 (20, 'enfant', 'care_schedules',         'public.care_schedules x join public.plants p on p.id = x.plant_id',              'p.garden_id = @G'),
 (21, 'enfant', 'ai_analyses',            'public.ai_analyses x join public.plants p on p.id = x.plant_id',                 'p.garden_id = @G'),
 (22, 'enfant', 'sensor_readings',        'public.sensor_readings x join public.sensors s on s.id = x.sensor_id',           's.garden_id = @G'),
 (23, 'enfant', 'irrigation_events',      'public.irrigation_events x join public.irrigation_zones z on z.id = x.zone_id',  'z.garden_id = @G'),
 (24, 'enfant', 'scene_actions',          'public.scene_actions x join public.scenes s on s.id = x.scene_id',               's.garden_id = @G'),
 (25, 'enfant', 'garden_checkup_entries', 'public.garden_checkup_entries x join public.garden_checkups c on c.id = x.checkup_id', 'c.garden_id = @G');

-- Le mesureur. Il tourne SOUS LE RÔLE DE L'APPELANT : c'est la RLS
-- réelle qui compte, jamais une lecture de `pg_policies`.
--
-- L'ÉCRITURE se mesure par `for update of x`, qui applique la clause
-- `using` des politiques d'UPDATE. C'est le même procédé qui a servi à
-- démontrer que le salarié écrivait encore sur un jardin livré.
create function pg_temp.mesure(p_phase text, p_acteur text) returns void
language plpgsql as $f$
declare
  f record; gk text; gid uuid; n int; e int; q text;
begin
  foreach gk in array array['g1','g2'] loop
    select v into gid from ids where k = gk;
    for f in select * from fam order by ord loop
      q := f.src || ' where ' || replace(f.filtre, '@G', quote_literal(gid));
      begin
        execute 'select count(*)::int from ' || q into n;
      exception when others then
        -- `anon` n'a pas forcément le GRANT de table sur tout : un refus
        -- au niveau GRANT compte comme « ne voit rien », ce qui est bien
        -- ce qu'on mesure.
        n := 0;
      end;
      begin
        execute 'select count(*)::int from (select 1 from ' || q || ' for update of x) z' into e;
      exception when others then
        -- Un refus dur compte comme « ne peut pas écrire ». On ne
        -- l'assimile pas à zéro ligne : c'est la même conclusion, mais
        -- pour une autre raison, et le test doit pouvoir le distinguer.
        e := 0;
      end;
      insert into mat values (p_phase, p_acteur, gk, f.grp, f.nom,
                              least(n, 1), least(e, 1));
    end loop;
  end loop;
end $f$;

create function pg_temp.mesure_tous(p_phase text) returns void
language plpgsql as $f$
declare a record;
begin
  for a in select k from ids where k in ('P','Fw','Fg','Pro','Sal','Des','Fld','Ldr','Cus','ProB','T') loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    perform pg_temp.mesure(p_phase, a.k);
    execute 'reset role';
  end loop;
  -- `anon` : aucune revendication, et le rôle du visiteur non connecté.
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  perform pg_temp.mesure(p_phase, 'An');
  execute 'reset role';
end $f$;

-- ============================================================
-- 4. PHASE A — AVANT LA LIVRAISON
-- ============================================================
select pg_temp.mesure_tous('A');

-- ============================================================
-- 5. TOUT OU RIEN
-- ============================================================
-- Une livraison à moitié faite est pire que pas de livraison : le
-- jardin change de main et les plantes restent. On fabrique la panne à
-- l'endroit le plus tardif — la DERNIÈRE table déplacée — et on vérifie
-- qu'il ne reste rien.
create function pg_temp.panne() returns trigger language plpgsql as $f$
begin
  raise exception 'panne fabriquée';
end $f$;
create trigger trg_panne_frontiere before update on public.digital_twin_revisions
  for each row execute function pg_temp.panne();

do $$
declare rate boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  begin
    perform public.deliver_garden_to_client(
      (select v from ids where k='g2'), (select v from ids where k='cust'));
  exception when others then rate := true;
  end;
  insert into res values ('Une livraison qui échoue LÈVE au lieu de réussir à moitié', 'true', rate::text);
end $$;

drop trigger trg_panne_frontiere on public.digital_twin_revisions;

insert into res select 'Livraison échouée — le jardin est resté chez l''entreprise', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.gardens where id = (select v from ids where k='g2'));
insert into res select 'Livraison échouée — les plantes aussi', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.plants where garden_id = (select v from ids where k='g2'));
insert into res select 'Livraison échouée — aucun accès orphelin', '1',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2'));  -- la seule ligne est celle de Fg
insert into res select 'Livraison échouée — aucune trace de livraison', '0',
  (select count(*)::text from public.garden_deliveries
    where garden_id = (select v from ids where k='g2'));

-- ============================================================
-- 6. LES COMPTEURS « AVANT »
-- ============================================================
-- §26 : « ne jamais supprimer ». On prend les totaux de chaque famille
-- ici, on les reprendra après la livraison ET son annulation.
do $$
declare f record; n bigint;
begin
  for f in select distinct nom from fam loop
    execute 'select count(*) from public.' || quote_ident(f.nom) into n;
    insert into cpt values ('avant', f.nom, n);
  end loop;
end $$;

-- ============================================================
-- 7. LA LIVRAISON
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Pro'))::text, true);
select public.deliver_garden_to_client(
  (select v from ids where k='g2'), (select v from ids where k='cust'));

-- Les seize tables ont-elles suivi ? On compte les enfants restés
-- derrière — la question à laquelle la cartographie répondait « dix ».
insert into res select 'La livraison emporte les QUINZE tables enfants (0 resté derrière)', '0',
  (select count(*)::text from (
     select 1 from public.plants                 x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.sensors            x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.connected_devices  x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.irrigation_zones   x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.greenhouses        x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.ponds              x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.scenes             x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.garden_checkups    x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.garden_plan_images x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.digital_twin_revisions x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.garden_areas       x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.garden_map_objects x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.garden_boundaries  x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.irrigation_pipes   x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
     union all select 1 from public.garden_cables      x where x.garden_id = (select v from ids where k='g2') and x.workspace_id <> (select v from ids where k='ws_p')
   ) z);

-- LES COLLÈGUES : trois lignes d'accès, pas dix. C'est le cœur du
-- point (c) — l'équipe voit le jardin sans qu'on ait inscrit personne.
insert into res select 'Trois lignes d''accès seulement : le client, le pro, et le foyer', '3',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2') and revoked_at is null);
insert into res select 'Aucune ligne nominative pour Sal, Des ou Fld', '0',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and user_id in ((select v from ids where k='Sal'),
                      (select v from ids where k='Des'),
                      (select v from ids where k='Fld')));
insert into res select 'La ligne du professionnel porte bien son organisation', 'true',
  (select (organization_id = (select v from ids where k='org'))::text
     from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and user_id = (select v from ids where k='Pro'));
insert into res select 'La livraison est tracée', '1',
  (select count(*)::text from public.garden_deliveries
    where garden_id = (select v from ids where k='g2') and reverted_at is null);

-- ============================================================
-- 8. PHASE B — APRÈS LA LIVRAISON
-- ============================================================
select pg_temp.mesure_tous('B');

-- LE TEST DU DÉFAUT 1, nommé pour ce qu'il est.
insert into res select 'DÉFAUT 1 — le client voit ses PLANTES (avant : 0)', '1',
  (select lecture::text from mat where phase='B' and acteur='P' and jardin='g2' and famille='plants');
insert into res select 'DÉFAUT 1 — et ses capteurs, ses équipements, son bilan', '1',
  (select min(lecture)::text from mat where phase='B' and acteur='P' and jardin='g2' and grp='contenu');
insert into res select 'DÉFAUT 1 — et le calendrier d''entretien (§28)', '1',
  (select min(lecture)::text from mat where phase='B' and acteur='P' and jardin='g2' and grp='enfant');

-- LA FUITE SYMÉTRIQUE, refermée.
insert into res select 'Le salarié LIT encore le jardin de son entreprise', '1',
  (select min(lecture)::text from mat where phase='B' and acteur='Sal' and jardin='g2');
insert into res select 'FUITE FERMÉE — mais il ne l''ÉCRIT plus (avant : oui, mesuré)', '0',
  (select max(ecriture)::text from mat where phase='B' and acteur='Sal' and jardin='g2');
insert into res select 'Le designer, lui, garde l''écriture : le plan reste entretenu', '1',
  (select min(ecriture)::text from mat where phase='B' and acteur='Des' and jardin='g2');

-- L'ENTREPRISE TIERCE.
insert into res select 'Un professionnel NON autorisé ne voit rien du tout', '0',
  (select max(lecture)::text from mat where phase='B' and acteur='ProB');
insert into res select 'Un tiers non plus', '0',
  (select max(lecture)::text from mat where phase='B' and acteur='T');
insert into res select 'Et anon encore moins — alors qu''il a tous les GRANT de table', '0',
  (select max(lecture)::text from mat where acteur='An');
insert into res select 'Les GRANT d''anon existent bel et bien (seule RLS l''arrête)', 'true',
  (select bool_and(has_table_privilege('anon', t, 'SELECT'))::text
     from (values ('public.plants'),('public.gardens')) as v(t));

-- ============================================================
-- 8 bis. LE PROFESSIONNEL SORTI DE L'ESPACE
-- ============================================================
-- Le trou exact que la cartographie a isolé : retiré de
-- `workspace_members` mais gardant sa ligne `garden_access`, le
-- professionnel tombait à « jardin 1, plan 1, plantes 0 ». C'est ce que
-- le pont doit combler, et c'est mesuré ici sans lui.
delete from public.workspace_members
 where workspace_id = (select v from ids where k='ws_org')
   and user_id = (select v from ids where k='Pro');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Pro'))::text, true);
set local role authenticated;
select pg_temp.mesure('B-hors-espace', 'Pro');
reset role;

insert into res select 'Pro hors de l''espace — il voit le jardin ET ses plantes (avant : 0)', '1',
  (select min(lecture)::text from mat where phase='B-hors-espace' and acteur='Pro' and jardin='g2');
insert into res select 'Pro hors de l''espace — et il peut encore l''entretenir', '1',
  (select min(ecriture)::text from mat where phase='B-hors-espace' and acteur='Pro' and jardin='g2');
insert into res select 'Pro hors de l''espace — il ne voit toujours pas le jardin privé du client', '0',
  (select max(lecture)::text from mat where phase='B-hors-espace' and acteur='Pro' and jardin='g1');

insert into public.workspace_members (workspace_id, user_id, role)
values ((select v from ids where k='ws_org'), (select v from ids where k='Pro'), 'owner');

-- ============================================================
-- 8 ter. ÉCRIRE DANS UN JARDIN LIVRÉ
-- ============================================================
-- `for update` mesure le droit de MODIFIER. Reste le droit d'AJOUTER,
-- qui passe par `with check` et non par `using` : il faut l'éprouver à
-- part, sinon on croit avoir tout mesuré.
do $$
declare ok boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.plants (id, workspace_id, garden_id, custom_name, type)
    values ('f086aaaa-0000-4000-8000-000000000001',
            (select v from ids where k='ws_org'),   -- il donne SON espace…
            (select v from ids where k='g2'), 'Plante ajoutée par le pro', 'other');
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Le professionnel autorisé peut AJOUTER une plante au jardin livré', 'true', ok::text);
end $$;

-- …et le déclencheur la range dans l'espace du JARDIN, pas dans le sien.
-- C'est le seul correctif que la base puisse apporter au défaut 3 :
-- l'iPhone estampille tout de l'espace personnel du compte, et cette
-- ligne-là est rattrapée sans une ligne de Swift.
insert into res select 'Et elle atterrit dans l''espace du JARDIN, pas dans celui du pro', 'true',
  (select (workspace_id = (select v from ids where k='ws_p'))::text
     from public.plants where id = 'f086aaaa-0000-4000-8000-000000000001');

do $$
declare a record; ok boolean;
begin
  for a in select * from (values ('Sal'),('T')) as v(k) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    ok := true;
    begin
      insert into public.plants (id, workspace_id, garden_id, custom_name, type)
      values (gen_random_uuid(), (select v from ids where k='ws_p'),
              (select v from ids where k='g2'), 'Plante interdite', 'other');
    exception when others then ok := false;
    end;
    execute 'reset role';
    insert into res values ('« ' || a.k || ' » ne peut PAS ajouter de plante au jardin livré', 'false', ok::text);
  end loop;
end $$;

-- ============================================================
-- 8 quater. LE PONT NE FUIT PAS PAR LA TABLE DES DROITS
-- ============================================================
do $$
declare ok boolean;
begin
  -- L'entreprise concurrente s'octroie un accès au jardin livré.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='ProB'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.garden_access (garden_id, user_id, role, organization_id)
    values ((select v from ids where k='g2'), (select v from ids where k='ProB'),
            'professional', (select v from ids where k='orgB'));
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Une entreprise TIERCE ne s''octroie pas l''accès à un jardin livré', 'false', ok::text);
end $$;

do $$
declare ok boolean;
begin
  -- L'escalade fermée au § 3 de la migration : un professionnel se
  -- déclarant PROPRIÉTAIRE du jardin de son client.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.garden_access (garden_id, user_id, role, organization_id)
    values ((select v from ids where k='g1'), (select v from ids where k='Pro'),
            'owner', (select v from ids where k='org'));
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Un professionnel ne se déclare pas PROPRIÉTAIRE d''un jardin', 'false', ok::text);
end $$;

-- ============================================================
-- 8 quinquies. LES FICHIERS DU PLAN
-- ============================================================
-- Le fichier ne bouge pas ; c'est la LIGNE `garden_plan_images` qui
-- décide, et elle a suivi le jardin. On interroge le prédicat lui-même :
-- une politique de `storage.objects` ne fait rien d'autre.
do $$
declare chemin text; a record; lu boolean;
begin
  select storage_path into chemin from public.garden_plan_images
   where garden_id = (select v from ids where k='g2');
  for a in select * from (values ('P','true'),('Pro','true'),('Des','true'),
                                 ('Sal','true'),('Fld','false'),('T','false')) as v(k, att) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    lu := public.garden_plan_file_access(chemin, false);
    execute 'reset role';
    insert into res values ('Fichier du plan livré — « ' || a.k || ' » le lit', a.att, lu::text);
  end loop;
end $$;

-- ============================================================
-- 8 sexies. LE PROPRIÉTAIRE QUI N'EN ÉTAIT PAS UN
-- ============================================================
-- Le jardin personnel, créé sans passer par aucune fonction du produit,
-- a bien reçu sa ligne `owner`. Sans elle, §"Le propriétaire peut
-- retirer l'accès du professionnel" était inapplicable : la fonction
-- levait « Seul le propriétaire du jardin peut retirer un accès ».
insert into res select 'Un jardin personnel reconnaît son propriétaire', '1',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g1')
      and user_id = (select v from ids where k='P') and role = 'owner');
-- Et le jardin livré n'a qu'UN propriétaire : le client. Ni le
-- paysagiste qui l'a construit, ni son entreprise.
insert into res select 'Un jardin livré n''a qu''UN propriétaire, et c''est le client', '1',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and role = 'owner' and user_id = (select v from ids where k='P'));
insert into res select 'Personne d''autre ne s''y est nommé propriétaire', '0',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and role = 'owner' and user_id <> (select v from ids where k='P'));

-- ============================================================
-- 8 septies. §28 — CE QUE LE CLIENT N'A PAS À VOIR
-- ============================================================
-- Le journal de travail du paysagiste contient des propositions
-- écartées et des notes internes. Le client reçoit son jardin, pas les
-- brouillons de celui qui l'a dessiné — et le paysagiste ne perd pas
-- les siens le jour où il livre.
do $$
declare a record; n int;
begin
  for a in select * from (values ('P','0'),('Fg','0'),('Pro','1'),('Sal','1'),('Des','1')) as v(k, att) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    select count(*)::int into n from public.digital_twin_revisions
     where id = 'f086bbbb-0000-4000-8000-000000000001';
    execute 'reset role';
    insert into res values ('§28 — la proposition INTERNE du paysagiste : « ' || a.k || ' » la voit',
                            a.att, n::text);
  end loop;
end $$;

insert into res select '§28 — le client voit bien la révision APPROUVÉE, elle', '1',
  (select lecture::text from mat
    where phase='B' and acteur='P' and jardin='g2' and famille='digital_twin_revisions');

-- ============================================================
-- 8 octies. ON RÉVOQUE UNE ENTREPRISE, PAS UN NOM
-- ============================================================
-- Le pont s'ouvre par ORGANISATION. Si la révocation, elle, ne ferme
-- qu'un NOM, le propriétaire croit avoir mis son paysagiste dehors et
-- l'entreprise entière reste dedans. C'est le défaut le plus grave du
-- lot : il annule à lui seul la promesse du § 1.1.
do $$
declare ok boolean;
begin
  -- (1) LA PORTE DÉROBÉE, D'ABORD : le professionnel n'inscrit plus
  -- personne d'autre que lui-même. Avant, il pouvait pré-poser des
  -- lignes au nom de ses collègues, la veille de la livraison.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.garden_access (garden_id, user_id, role, organization_id)
    values ((select v from ids where k='g2'), (select v from ids where k='Des'),
            'professional', (select v from ids where k='org'));
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Un professionnel n''inscrit plus ses COLLÈGUES sur un jardin', 'false', ok::text);
end $$;

-- (2) LA CASCADE. On simule la ligne d'hier — celle qu'une base déjà en
-- service peut porter — en l'insérant sans passer par la politique.
insert into public.garden_access (garden_id, user_id, role, organization_id)
values ((select v from ids where k='g2'), (select v from ids where k='Des'),
        'professional', (select v from ids where k='org'));

insert into res select 'Deux portes ouvertes par l''organisation avant la révocation', '2',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and organization_id = (select v from ids where k='org') and revoked_at is null);

-- Le propriétaire fait le seul geste qu'il connaisse : « retirer
-- l'accès de mon paysagiste ».
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='P'))::text, true);
select public.revoke_garden_access((select v from ids where k='g2'),
                                   (select v from ids where k='Pro'));

insert into res select 'Révoquer le professionnel ferme TOUTE l''organisation', '0',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and organization_id = (select v from ids where k='org') and revoked_at is null);

do $$
declare a record; n int;
begin
  for a in select * from (values ('Pro'),('Sal'),('Des'),('Cus')) as v(k) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    select count(*)::int into n from public.plants
     where garden_id = (select v from ids where k='g2');
    execute 'reset role';
    insert into res values ('Après révocation — « ' || a.k || ' » ne lit plus les plantes du jardin', '0', n::text);
  end loop;
end $$;

do $$
declare refuse boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  begin
    perform public.revert_garden_delivery((select v from ids where k='g2'));
  exception when others then refuse := true;
  end;
  insert into res values ('Après révocation — la reprise du jardin est REFUSÉE', 'true', refuse::text);
end $$;

-- Et rien n'a bougé : le jardin est toujours chez le client, la
-- livraison est toujours active. Si cette assertion tombe, c'est que la
-- reprise a eu lieu malgré la révocation — et la suite du test
-- s'effondre bruyamment, ce qui est la bonne façon d'échouer.
insert into res select 'Après révocation — la livraison est toujours active', '1',
  (select count(*)::text from public.garden_deliveries
    where garden_id = (select v from ids where k='g2') and reverted_at is null);

-- Le geste direct, pour l'écran qui voudra dire « retirer l'accès de
-- l'entreprise » plutôt que celui d'une personne. Il est réservé au
-- propriétaire, comme la révocation nominative.
do $$
declare refuse boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='ProB'))::text, true);
  begin
    perform public.revoke_organization_garden_access(
      (select v from ids where k='g2'), (select v from ids where k='org'));
  exception when others then refuse := true;
  end;
  insert into res values ('Seul le propriétaire retire l''accès d''une entreprise', 'true', refuse::text);
end $$;

-- On remet exactement l'état d'avant : la ligne d'hier disparaît, celle
-- du professionnel redevient active. Les mesures qui suivent doivent
-- retrouver la phase B au point près.
delete from public.garden_access
 where garden_id = (select v from ids where k='g2')
   and user_id = (select v from ids where k='Des');
update public.garden_access set revoked_at = null
 where garden_id = (select v from ids where k='g2')
   and user_id = (select v from ids where k='Pro');

insert into res select 'État restauré : trois accès, comme avant l''essai', '3',
  (select count(*)::text from public.garden_access
    where garden_id = (select v from ids where k='g2') and revoked_at is null);

-- ============================================================
-- 8 nonies. ON NE RÉCLAME PAS LE FICHIER D'UN AUTRE
-- ============================================================
-- Le § 2 remplace « le chemin décide » par « la ligne décide ». Cela ne
-- tient que si l'on ne peut pas fabriquer une ligne pour décider à la
-- place d'autrui. Deux verrous, éprouvés séparément.
insert into public.gardens (id, workspace_id, name)
values ('f086eeee-0000-4000-8000-000000000001', (select v from ids where k='ws_t'), 'Jardin bidon du tiers');

do $$
declare ok boolean;
begin
  -- (1) LE DÉCLENCHEUR : un chemin qu'aucune ligne ne réclame encore,
  -- mais qui est dans l'espace de quelqu'un d'autre.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='T'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.garden_plan_images (workspace_id, garden_id, storage_path)
    values ((select v from ids where k='ws_t'), 'f086eeee-0000-4000-8000-000000000001',
            (select v from ids where k='ws_p')::text || '/orphelin.png');
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Un tiers ne réclame pas un fichier rangé dans l''espace d''un autre', 'false', ok::text);
end $$;

do $$
declare ok boolean; chemin text;
begin
  -- (2) L'INDEX UNIQUE : le fichier du jardin livré est déjà réclamé
  -- par la ligne qui l'a suivi. L'ex-collègue, resté membre de l'espace
  -- d'origine, ne peut pas s'en emparer.
  select storage_path into chemin from public.garden_plan_images
   where garden_id = (select v from ids where k='g2');
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Fld'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.garden_plan_images (workspace_id, garden_id, storage_path)
    values ((select v from ids where k='ws_org'), (select v from ids where k='g2'), chemin);
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Un ex-collègue ne s''empare pas du fichier d''un jardin livré', 'false', ok::text);
end $$;

do $$
declare lu boolean;
begin
  -- Le corollaire du § 2 bis : puisqu'un tiers ne peut plus réclamer ce
  -- chemin, le propriétaire d'origine ne peut plus en être exclu.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='P'))::text, true);
  execute 'set local role authenticated';
  lu := public.garden_plan_file_access(
    (select v from ids where k='ws_p')::text || '/orphelin.png', false);
  execute 'reset role';
  insert into res values ('Le propriétaire d''origine garde son fichier orphelin', 'true', lu::text);
end $$;

-- LA MOITIÉ QUI MANQUAIT : après livraison, le paysagiste peut écrire
-- la LIGNE du plan — mais pouvait-il téléverser le FICHIER ? Non, et
-- personne ne l'avait vu : le chemin porte l'espace DU JARDIN, devenu
-- celui du client.
do $$
declare a record; chemin text; peut boolean;
begin
  chemin := (select v from ids where k='ws_p')::text || '/'
         || (select v from ids where k='g2')::text || '/nouveau-plan.png';
  for a in select * from (values ('Pro','true'),('Des','true'),('P','true'),
                                 ('Sal','false'),('Fld','false'),('T','false')) as v(k, att) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = a.k))::text, true);
    execute 'set local role authenticated';
    peut := public.garden_plan_file_access(chemin, true);
    execute 'reset role';
    insert into res values ('Téléverser un plan dans le jardin livré — « ' || a.k || ' » le peut',
                            a.att, peut::text);
  end loop;
end $$;

delete from public.gardens where id = 'f086eeee-0000-4000-8000-000000000001';

-- ============================================================
-- 8 decies. ON NE DÉPOSE PAS UNE LIGNE DANS LE JARDIN D'AUTRUI
-- ============================================================
-- Les politiques du § 1.4 ouvrent la lecture par `garden_id`. Rien ne
-- contrôlait qui pouvait ÉCRIRE un `garden_id` : il suffisait de donner
-- SON PROPRE espace en `workspace_id`. La victime voyait alors la ligne
-- intruse dans son jardin.
do $$
declare ok boolean; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='T'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.plants (id, workspace_id, garden_id, custom_name, type)
    values ('f086aaaa-0000-4000-8000-000000000002',
            (select v from ids where k='ws_t'),          -- SON espace à lui
            (select v from ids where k='g1'), 'Plante intruse', 'other');
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Un tiers ne pose pas une plante dans le jardin PRIVÉ d''un particulier', 'false', ok::text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='P'))::text, true);
  execute 'set local role authenticated';
  select count(*)::int into n from public.plants
   where garden_id = (select v from ids where k='g1') and custom_name = 'Plante intruse';
  execute 'reset role';
  insert into res values ('… et le propriétaire n''en voit aucune trace', '0', n::text);
end $$;

-- ============================================================
-- 8 undecies. LES LOCALISATEURS SONT FERMÉS
-- ============================================================
-- Cinq fonctions `security definer` qui rendent le jardin d'une ligne
-- sans aucun contrôle. Elles n'ont rien à faire entre les mains d'un
-- visiteur non connecté — mais elles sont INDISPENSABLES aux politiques
-- des huit enfants indirects, qui s'évaluent sous les privilèges de
-- celui qui interroge. Les deux assertions vont ensemble : la seconde
-- est ce qui a fait rejeter la fermeture complète.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  select count(*)::int into n from (
    select public.plant_garden((select v from ids where k='g1')) -- identifiant quelconque
    union all select public.plant_garden('f0861001-0000-4000-8000-000000000086')
    union all select public.sensor_garden('f0861002-0000-4000-8000-000000000086')
    union all select public.irrigation_zone_garden('f0861004-0000-4000-8000-000000000086')
    union all select public.scene_garden('f0861007-0000-4000-8000-000000000086')
    union all select public.checkup_garden('f0861008-0000-4000-8000-000000000086')
  ) z(g) where g is not null;
  execute 'reset role';
  insert into res values ('Les cinq localisateurs sont AVEUGLES au visiteur non connecté', '0', n::text);
end $$;
insert into res select 'Et les huit familles indirectes répondent encore au propriétaire', '1',
  (select min(lecture)::text from mat
    where phase='B' and acteur='P' and jardin='g2' and grp='enfant');

-- ============================================================
-- 9. LA MATRICE ATTENDUE
-- ============================================================
-- Une ligne par phase × acteur × jardin. Les vingt-cinq familles doivent
-- rendre LA MÊME valeur à l'intérieur d'une case : si une seule dévie,
-- le § 10 la nomme. C'est ce qui attrape le demi-pont — la plante
-- visible dont la photo ne l'est pas.
--
--   A = avant la livraison
--   B = après la livraison
--   C = après l'annulation de la livraison
insert into att(phase, acteur, jardin, lecture, ecriture) values
-- ---- PHASE A ----------------------------------------------------
-- G1, le jardin personnel. Fg passe de 0 à 1 sur le contenu : c'est le
-- pont, et c'est voulu — un membre du foyer voit les plantes du foyer.
 ('A','P',   'g1',1,1), ('A','Fw',  'g1',1,1), ('A','Fg', 'g1',1,1),
 ('A','Pro', 'g1',0,0), ('A','Sal', 'g1',0,0), ('A','Des','g1',0,0),
 ('A','Fld', 'g1',0,0), ('A','Ldr', 'g1',0,0), ('A','Cus','g1',0,0),
 ('A','ProB','g1',0,0), ('A','T',  'g1',0,0), ('A','An','g1',0,0),
-- G2 vit encore chez l'entreprise : toute l'entreprise y est chez elle.
 ('A','P',   'g2',0,0), ('A','Fw',  'g2',0,0), ('A','Fg', 'g2',1,1),
 ('A','Pro', 'g2',1,1), ('A','Sal', 'g2',1,1), ('A','Des','g2',1,1),
 ('A','Fld', 'g2',1,1), ('A','Ldr', 'g2',1,1), ('A','Cus','g2',1,1),
 ('A','ProB','g2',0,0), ('A','T',  'g2',0,0), ('A','An','g2',0,0),
-- ---- PHASE B ----------------------------------------------------
-- G1 NE BOUGE PAS. C'est la moitié du travail : livrer un jardin ne
-- touche à rien d'autre.
 ('B','P',   'g1',1,1), ('B','Fw',  'g1',1,1), ('B','Fg', 'g1',1,1),
 ('B','Pro', 'g1',0,0), ('B','Sal', 'g1',0,0), ('B','Des','g1',0,0),
 ('B','Fld', 'g1',0,0), ('B','Ldr', 'g1',0,0), ('B','Cus','g1',0,0),
 ('B','ProB','g1',0,0), ('B','T',  'g1',0,0), ('B','An','g1',0,0),
-- G2 a changé de main.
--   P  passe de 0 à 1 partout : LE DÉFAUT 1.
--   Fw suit son espace : le jardin est arrivé chez lui.
--   Sal passe de 1/1 à 1/0 : LA FUITE, refermée. Il lit parce que son
--       entreprise entretient ce jardin ; il n'écrit plus parce qu'il
--       n'a pas `digitalTwin.edit`.
--   Fld passe de 1/1 à 0/0 : resserrement voulu. `projects.read` ne dit
--       rien des clients ; il ne voit pas non plus leur fiche.
--   Ldr passe de 1/1 à 0/0 POUR LA MÊME RAISON, et c'est le cas qu'on
--       avait oublié de nommer : le chef d'équipe n'a pas
--       `clients.read`. Ce n'est pas un défaut du pont, c'est une
--       question posée au dirigeant — voir le § 1.2 de la migration.
--   Cus passe de 1/1 à 0/0 : `digitalTwin.edit` seul n'ouvre plus rien,
--       parce que `can_edit_garden` exige AUSSI `clients.read`. Sans ce
--       « et », il lirait tout le jardin par le `using` d'une politique
--       en `cmd = ALL`.
 ('B','P',   'g2',1,1), ('B','Fw',  'g2',1,1), ('B','Fg', 'g2',1,1),
 ('B','Pro', 'g2',1,1), ('B','Sal', 'g2',1,0), ('B','Des','g2',1,1),
 ('B','Fld', 'g2',0,0), ('B','Ldr', 'g2',0,0), ('B','Cus','g2',0,0),
 ('B','ProB','g2',0,0), ('B','T',  'g2',0,0), ('B','An','g2',0,0),
-- ---- PHASE C ----------------------------------------------------
 ('C','P',   'g1',1,1), ('C','Fw',  'g1',1,1), ('C','Fg', 'g1',1,1),
 ('C','Pro', 'g1',0,0), ('C','Sal', 'g1',0,0), ('C','Des','g1',0,0),
 ('C','Fld', 'g1',0,0), ('C','Ldr', 'g1',0,0), ('C','Cus','g1',0,0),
 ('C','ProB','g1',0,0), ('C','T',  'g1',0,0), ('C','An','g1',0,0),
-- Le jardin est revenu chez l'entreprise et l'accès du client est
-- révoqué : il redevient exactement la phase A. Fg garde le sien — il
-- lui a été donné nommément, l'annulation ne le concerne pas.
 ('C','P',   'g2',0,0), ('C','Fw',  'g2',0,0), ('C','Fg', 'g2',1,1),
 ('C','Pro', 'g2',1,1), ('C','Sal', 'g2',1,1), ('C','Des','g2',1,1),
 ('C','Fld', 'g2',1,1), ('C','Ldr', 'g2',1,1), ('C','Cus','g2',1,1),
 ('C','ProB','g2',0,0), ('C','T',  'g2',0,0), ('C','An','g2',0,0);

-- ============================================================
-- 10. LE RETOUR ARRIÈRE
-- ============================================================
-- LA SOUPAPE D'ABORD : si le propriétaire a retiré l'accès de
-- l'entreprise, l'annulation est refusée — définitivement. C'est ce qui
-- rend acceptable de donner ce pouvoir à l'entreprise plutôt qu'au
-- client : le client garde le dernier mot.
update public.garden_access set revoked_at = now()
 where garden_id = (select v from ids where k='g2')
   and user_id = (select v from ids where k='Pro');

do $$
declare refuse boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  begin
    perform public.revert_garden_delivery((select v from ids where k='g2'));
  exception when others then refuse := true;
  end;
  insert into res values ('Accès révoqué par le client → l''annulation est REFUSÉE', 'true', refuse::text);
end $$;

update public.garden_access set revoked_at = null
 where garden_id = (select v from ids where k='g2')
   and user_id = (select v from ids where k='Pro');

-- Un tiers ne peut pas non plus annuler la livraison de quelqu'un d'autre.
do $$
declare refuse boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='ProB'))::text, true);
  begin
    perform public.revert_garden_delivery((select v from ids where k='g2'));
  exception when others then refuse := true;
  end;
  insert into res values ('Une entreprise tierce n''annule pas la livraison', 'true', refuse::text);
end $$;

-- L'annulation, pour de vrai.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Pro'))::text, true);
select public.revert_garden_delivery((select v from ids where k='g2'));

insert into res select 'Annulation — le jardin est revenu chez l''entreprise', 'true',
  (select (workspace_id = (select v from ids where k='ws_org'))::text
     from public.gardens where id = (select v from ids where k='g2'));
insert into res select 'Annulation — les plantes aussi', 'true',
  (select bool_and(workspace_id = (select v from ids where k='ws_org'))::text
     from public.plants where garden_id = (select v from ids where k='g2'));
insert into res select 'Annulation — l''accès du client est RÉVOQUÉ, pas supprimé', 'true',
  (select (revoked_at is not null)::text from public.garden_access
    where garden_id = (select v from ids where k='g2')
      and user_id = (select v from ids where k='P'));
insert into res select 'Annulation — la trace est marquée, pas effacée', '1',
  (select count(*)::text from public.garden_deliveries
    where garden_id = (select v from ids where k='g2') and reverted_at is not null);
insert into res select 'Annulation — on ne l''annule pas deux fois', 'true',
  (select (not exists (select 1 from public.garden_deliveries
     where garden_id = (select v from ids where k='g2') and reverted_at is null))::text);

select pg_temp.mesure_tous('C');

-- ============================================================
-- 11. ON N'A RIEN SUPPRIMÉ — §26
-- ============================================================
do $$
declare f record; n bigint;
begin
  for f in select distinct nom from fam loop
    execute 'select count(*) from public.' || quote_ident(f.nom) into n;
    insert into cpt values ('apres', f.nom, n);
  end loop;
end $$;

insert into res select 'Aucune ligne perdue en chemin (hors la plante ajoutée exprès)', '0',
  (select count(*)::text from (
     select a.tbl from cpt a join cpt b on b.tbl = a.tbl and b.etape='apres'
      where a.etape='avant'
        and b.n <> a.n + (case when a.tbl = 'plants' then 1 else 0 end)
   ) z);
insert into res select 'Et la plante ajoutée par le professionnel est bien là', '1',
  (select (b.n - a.n)::text from cpt a join cpt b on b.tbl=a.tbl and b.etape='apres'
    where a.etape='avant' and a.tbl='plants');

-- ============================================================
-- 12. LA MATRICE, CASE PAR CASE
-- ============================================================
-- Trois assertions seulement, mais elles portent 1 800 mesures :
--   • toutes les cases mesurées ont une attente écrite ;
--   • dans chaque case, les 25 familles s'accordent — pas de demi-pont ;
--   • et la valeur est celle qu'on a décidée.
insert into res select 'Toutes les cases mesurées ont une attente déclarée', '0',
  (select count(*)::text from (
     select distinct m.phase, m.acteur, m.jardin from mat m
      where m.phase in ('A','B','C')
        and not exists (select 1 from att a
              where a.phase=m.phase and a.acteur=m.acteur and a.jardin=m.jardin)) z);

insert into res select 'Aucun demi-pont : les 25 familles s''accordent dans chaque case', '0',
  (select count(*)::text from (
     select phase, acteur, jardin from mat where phase in ('A','B','C')
      group by phase, acteur, jardin
     having min(lecture) <> max(lecture) or min(ecriture) <> max(ecriture)) z);

insert into res select 'LA MATRICE EST CELLE QU''ON A VOULUE — 0 écart', '0',
  (select count(*)::text from (
     select a.phase, a.acteur, a.jardin
       from att a
       join (select phase, acteur, jardin, min(lecture) l, min(ecriture) e
               from mat where phase in ('A','B','C')
              group by phase, acteur, jardin) m
         on m.phase=a.phase and m.acteur=a.acteur and m.jardin=a.jardin
      where m.l <> a.lecture or m.e <> a.ecriture) z);

-- Et si un écart existe, il doit se NOMMER : sans cela on chercherait à
-- l'aveugle dans 750 mesures.
insert into res
select 'ÉCART — ' || m.phase || ' / ' || m.acteur || ' / ' || m.jardin || ' / ' || m.famille,
       a.lecture || '/' || a.ecriture, m.lecture || '/' || m.ecriture
  from mat m join att a
    on a.phase=m.phase and a.acteur=m.acteur and a.jardin=m.jardin
 where m.phase in ('A','B','C')
   and (m.lecture <> a.lecture or m.ecriture <> a.ecriture);

-- ============================================================
-- 13. LE PARTICULIER N'A RIEN PERDU
-- ============================================================
-- La formulation la plus directe de la moitié la plus facile à rater :
-- le jardin personnel rend les mêmes 250 mesures aux trois phases.
insert into res select 'G1 rend exactement les mêmes mesures aux phases A, B et C', '0',
  (select count(*)::text from (
     select acteur, famille from mat where jardin='g1' and phase in ('A','B','C')
      group by acteur, famille
     having count(distinct lecture) > 1 or count(distinct ecriture) > 1) z);

-- ============================================================
-- 14. LE SALARIÉ QUI PART — ET QUI RESTAIT
-- ============================================================
-- Le produit « désactive » un salarié en posant `archived_at` sur
-- `organization_members`, et ne touche jamais à `workspace_members`. Le
-- pont se refermait bien sur les jardins LIVRÉS — `has_permission` ne
-- répond plus — mais l'espace de travail, lui, restait grand ouvert :
-- tous les chantiers en cours, et les vingt et une tables BioLab.
--
-- On mesure sur `Des`, à la phase C, jardin revenu chez l'entreprise :
-- c'est le cas où l'appartenance à l'espace est le SEUL mécanisme en
-- jeu, donc celui qui isole exactement le défaut.
insert into res select 'Avant archivage — le designer lit le chantier de son entreprise', '1',
  (select min(lecture)::text from mat where phase='C' and acteur='Des' and jardin='g2');

update public.organization_members set archived_at = now()
 where organization_id = (select v from ids where k='org')
   and user_id = (select v from ids where k='Des');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Des'))::text, true);
set local role authenticated;
select pg_temp.mesure('C-archive', 'Des');
reset role;

insert into res select 'Salarié archivé — il ne lit plus RIEN du chantier de son ex-entreprise', '0',
  (select max(lecture)::text from mat where phase='C-archive' and acteur='Des' and jardin='g2');
insert into res select 'Salarié archivé — il n''y écrit plus rien non plus', '0',
  (select max(ecriture)::text from mat where phase='C-archive' and acteur='Des' and jardin='g2');

do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Des'))::text, true);
  execute 'set local role authenticated';
  select count(*)::int into n from public.workspaces
   where id = (select v from ids where k='ws_org');
  execute 'reset role';
  insert into res values ('Salarié archivé — l''espace de l''entreprise lui est fermé', '0', n::text);
end $$;

-- Et il retrouve tout si on lui rend son accès : `archived_at` est un
-- interrupteur, pas une porte condamnée.
update public.organization_members set archived_at = null
 where organization_id = (select v from ids where k='org')
   and user_id = (select v from ids where k='Des');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='Des'))::text, true);
set local role authenticated;
select pg_temp.mesure('C-retabli', 'Des');
reset role;

insert into res select 'Accès rétabli — il retrouve exactement ce qu''il avait', '0',
  (select count(*)::text from (
     select m.famille from mat m
       join mat c on c.phase='C' and c.acteur='Des' and c.jardin=m.jardin and c.famille=m.famille
      where m.phase='C-retabli' and m.acteur='Des'
        and (m.lecture <> c.lecture or m.ecriture <> c.ecriture)) z);

-- Le monde particulier n'a rien senti : l'archivage ne concerne que les
-- espaces qui appartiennent à une organisation.
insert into res select 'Un espace PERSONNEL n''a pas d''organisation : rien n''y change', '0',
  (select count(*)::text from (
     select m.acteur, m.famille from mat m
       join mat a on a.phase='A' and a.acteur=m.acteur and a.jardin='g1' and a.famille=m.famille
      where m.phase='C' and m.jardin='g1'
        and (m.lecture <> a.lecture or m.ecriture <> a.ecriture)) z);

-- ============================================================
-- 15. LE JOURNAL NE VERROUILLE RIEN ET NE S'EFFACE PAS
-- ============================================================
-- Deux défauts jumeaux dans les clés de `garden_deliveries` : sans
-- action de suppression, elles auraient verrouillé les deux espaces
-- pour toujours ; en cascade sur le jardin, la trace aurait disparu au
-- seul moment où elle sert.
insert into res select 'Aucune clé du journal ne verrouille ce qu''elle désigne', '0',
  (select count(*)::text from pg_constraint
    where conrelid = 'public.garden_deliveries'::regclass
      and contype = 'f' and confdeltype <> 'n');

-- Supabase accorde par défaut tous les droits de table à `anon` et
-- `authenticated` : seule l'ABSENCE de politique d'écriture ferme le
-- journal. On vérifie que c'est bien le cas, sinon n'importe qui
-- s'écrirait une livraison — et donc un droit de reprise.
do $$
declare ok boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k='Pro'))::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    insert into public.garden_deliveries (garden_id, organization_id, customer_id,
      client_user_id, from_workspace_id, to_workspace_id)
    values ((select v from ids where k='g2'), (select v from ids where k='org'),
            (select v from ids where k='cust'), (select v from ids where k='P'),
            (select v from ids where k='ws_org'), (select v from ids where k='ws_p'));
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values ('Personne ne s''écrit une livraison à la main', 'false', ok::text);
end $$;

-- Un essai FONCTIONNEL, pas seulement une lecture de métadonnées : on
-- fabrique un espace et un jardin jetables, on les journalise, et on
-- les supprime.
insert into public.workspaces (id, owner_id, name, is_personal)
values ('f086ffff-0000-4000-8000-000000000001', (select v from ids where k='T'), 'Espace jetable', false);
insert into public.gardens (id, workspace_id, name)
values ('f086ffff-0000-4000-8000-000000000002', 'f086ffff-0000-4000-8000-000000000001', 'Jardin jetable');
insert into public.garden_deliveries (
  garden_id, organization_id, customer_id, client_user_id,
  from_workspace_id, to_workspace_id, delivered_by, garden_name, customer_name)
values ('f086ffff-0000-4000-8000-000000000002', (select v from ids where k='org'),
        (select v from ids where k='cust'), (select v from ids where k='P'),
        'f086ffff-0000-4000-8000-000000000001', (select v from ids where k='ws_p'),
        (select v from ids where k='Pro'), 'Jardin jetable', 'Madame Particulier');

do $$
declare ok boolean := true;
begin
  begin
    delete from public.gardens where id = 'f086ffff-0000-4000-8000-000000000002';
    delete from public.workspaces where id = 'f086ffff-0000-4000-8000-000000000001';
  exception when others then ok := false;
  end;
  insert into res values ('Un espace livreur reste supprimable après une livraison', 'true', ok::text);
end $$;

insert into res select 'La trace survit au jardin qu''elle trace', '1',
  (select count(*)::text from public.garden_deliveries
    where garden_name = 'Jardin jetable' and garden_id is null);
insert into res select 'Et elle reste LISIBLE : le nom du client y est resté', 'Madame Particulier',
  (select customer_name from public.garden_deliveries where garden_name = 'Jardin jetable');

delete from public.garden_deliveries where garden_name = 'Jardin jetable';

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
