-- Oasis Care — LES ÉTIQUETTES ET LEUR RÉSOLVEUR (migration 0090).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE RÉSOLVEUR NE FORME PAS D'ORACLE (§ 4). Un jeton valide qu'on
--      n'a pas le droit de voir doit rendre EXACTEMENT la même chose
--      qu'un jeton qui n'a jamais existé : même booléen, même phrase,
--      mêmes neuf colonnes nulles. Deux réponses différentes
--      permettraient, en tapant des jetons au hasard, d'apprendre
--      lesquels sont vrais. La comparaison est faite ligne à ligne,
--      colonne par colonne, avec « is not distinct from » — un
--      « = » laisserait passer deux NULL différents.
--
--   2. LE RÉSOLVEUR NE LAISSE SORTIR AUCUNE DONNÉE INTERNE (§ 6).
--      La plupart de ces assertions vérifient une ABSENCE : une porte
--      qui montre trop ne se signale par aucune erreur — elle
--      fonctionne parfaitement, et elle fuite. On vérifie nommément
--      que le coût d'acquisition d'un matériel, le fournisseur d'un
--      lot et les notes ne sortent jamais.
--
--   3. LES CINQ ÉTIQUETTES DÉJÀ EN PRODUCTION FONCTIONNENT ENCORE
--      (§ 9). Elles sont résolues pour de vrai, une par une, par leur
--      propriétaire réel. Deux plantes, un lot de culture, deux racks.
--      C'est le seul paragraphe qui lise la production ; il n'y écrit
--      rien qui survive au ROLLBACK.
--
--   4. UNE ÉTIQUETTE PROFESSIONNELLE EST ATTEIGNABLE, ET UNE ÉTIQUETTE
--      PERSONNELLE L'EST TOUJOURS (§ 5 et § 6). C'était tout l'objet du
--      chantier : smart_tags ne portait que workspace_id, et rien du
--      monde professionnel n'était étiquetable.
--
--   5. LA PORTÉE NE SE DÉCLARE PAS, ELLE SE DÉDUIT (§ 3). Une étiquette
--      qui prétend appartenir à un espace de travail tout en visant
--      l'objet d'un autre est REFUSÉE. Sans cela, le résolveur — qui
--      est « security definer » — livrerait consciencieusement l'objet
--      du voisin.
--
--   6. LE SECOND REGISTRE EST ABSORBÉ SANS PERDRE UN JETON (§ 7).
--      Le jeton de nursery_lots n'a pas changé d'un caractère, et il
--      résout maintenant vers son lot.
--
--   7. L'ÉNUMÉRATION EST COMPTÉE, ET LE SEUIL SE RÈGLE (§ 8).
--
--   8. LES `grant` PAR DÉFAUT DE SUPABASE N'ONT RIEN ROUVERT (§ 10).
--      C'est là que 0055 s'est fait avoir, et c'est vérifié par
--      requête, pas par confiance.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les étiquettes, ni le compteur d'attaques, ni les scans posés sur les
-- cinq étiquettes réelles.
--
-- AUCUN APPEL RÉSEAU.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0090, ou l'envoyer à l'API Management. UN SEUL bloc begin/rollback :
-- un fichier découpé en plusieurs blocs verrait son premier rollback
-- annuler la migration posée devant.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table jet(k text, v text) on commit drop;
-- Le résultat brut du résolveur, rangé sous une clé, pour pouvoir
-- comparer deux réponses colonne par colonne plus loin.
create temp table rez(
  k text, ok boolean, message text, portee text, entite_type text,
  entite_id uuid, ecran text, chemin text, titre text, details jsonb
) on commit drop;

grant all on res to authenticated;
grant all on ids to authenticated;
grant all on jet to authenticated;
grant all on rez to authenticated;
-- Le § 6 fait parler un visiteur ANONYME : il doit pouvoir consigner
-- son verdict comme les autres.
grant all on res to anon;
grant all on ids to anon;
grant all on jet to anon;
grant all on rez to anon;

-- ============================================================
-- Fixtures
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 -- Le patron de l'entreprise A : membre de son espace de travail ET de
 -- son entreprise, comme create_professional_organization les crée.
 ('e9900001-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-patronA@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Le patron d'une AUTRE entreprise. C'est lui, le « connecté sans
 -- droit » du § 15 : il n'a rigoureusement rien à voir avec A.
 ('e9900002-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-patronB@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- L'ouvrier de A : membre de l'ENTREPRISE seulement, pas de l'espace
 -- de travail. Il porte projects.read et etiquettes.read, PAS
 -- nursery.stock.manage. C'est lui qui éprouve la permission par
 -- famille d'objet.
 ('e9900003-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-ouvrierA@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Le pépiniériste de A : nurseryManager, donc nursery.stock.manage.
 ('e9900004-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-pepiniereA@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Un particulier, avec son seul espace personnel et AUCUNE entreprise.
 -- C'est le monde d'origine de smart_tags ; il ne doit pas casser.
 ('e9900005-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-particulier@test.invalid','',now(),now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Étiquettes A Paysages','landscaper');

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


select set_config('request.jwt.claims',
  json_build_object('sub','e9900002-0000-4000-8000-000000000090')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Étiquettes B Jardins','landscaper');

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


select set_config('request.jwt.claims', null, true);

insert into ids select 'wsA', o.workspace_id from public.business_organizations o
 where o.id = (select v from ids where k='orgA');
insert into ids select 'wsB', o.workspace_id from public.business_organizations o
 where o.id = (select v from ids where k='orgB');

insert into public.organization_members (organization_id, user_id, role) values
 ((select v from ids where k='orgA'),'e9900003-0000-4000-8000-000000000090','fieldWorker'),
 ((select v from ids where k='orgA'),'e9900004-0000-4000-8000-000000000090','nurseryManager');

-- L'espace PERSONNEL, sans la moindre entreprise derrière.
insert into public.workspaces (id, owner_id, name, is_personal, type) values
 ('e9900010-0000-4000-8000-000000000090','e9900005-0000-4000-8000-000000000090',
  'Chez le particulier', true, 'personal');
insert into public.workspace_members (workspace_id, user_id, role) values
 ('e9900010-0000-4000-8000-000000000090','e9900005-0000-4000-8000-000000000090','owner');

-- ---- LES OBJETS À ÉTIQUETER ----------------------------------
insert into public.gardens (id, workspace_id, name) values
 ('e9900020-0000-4000-8000-000000000090',(select v from ids where k='wsA'),'Jardin du client Dupont');

insert into public.plants (id, workspace_id, garden_id, custom_name, type, common_name, scientific_name, notes) values
 ('e9900021-0000-4000-8000-000000000090',(select v from ids where k='wsA'),
  'e9900020-0000-4000-8000-000000000090','Le palmier de l''entrée','palm',
  'Palmier de Chine','Trachycarpus fortunei','Note interne : le client râle sur le prix.');

-- La plante du PARTICULIER, dans son espace personnel.
insert into public.plants (id, workspace_id, custom_name, type, common_name, scientific_name) values
 ('e9900022-0000-4000-8000-000000000090','e9900010-0000-4000-8000-000000000090',
  'Mon ficus','indoor','Figuier pleureur','Ficus benjamina');

-- Le lot de pépinière : axe ORGANISATION, inatteignable avant 0090.
insert into public.nursery_lots (id, organization_id, lot_code, species_name, cultivar,
                                 status, initial_quantity, current_quantity, notes) values
 ('e9900030-0000-4000-8000-000000000090',(select v from ids where k='orgA'),
  'LOT-2026-001','Olea europaea','Cipressino','available',400,380,
  'Note interne : acheté 3,20 € pièce, marge à surveiller.');

-- Le matériel : axe organisation lui aussi, et il porte un COÛT
-- D'ACQUISITION — la donnée qui ne doit jamais sortir du résolveur.
insert into public.equipment (id, organization_id, name, category, acquisition_cost_cents,
                              serial_number, notes) values
 ('e9900031-0000-4000-8000-000000000090',(select v from ids where k='orgA'),
  'Mini-pelle 1,8 t','earthmoving',2450000,'SN-XYZ-99','Note interne : révision en retard.');

-- ============================================================
-- 1. LA TABLE ÉTENDUE — CE QUI EXISTE, ET CE QU'ELLE REFUSE
-- ============================================================
insert into res select 'smart_tags porte les onze portées neuves','11',
  (select count(*)::text from information_schema.columns
    where table_schema='public' and table_name='smart_tags'
      and column_name in ('organization_id','garden_id','garden_zone_id','garden_area_id',
                          'irrigation_zone_id','pond_id','sensor_id','connected_device_id',
                          'equipment_id','nursery_lot_id','nursery_location_id'));

insert into res select 'IL N''Y A TOUJOURS QU''UNE SEULE TABLE D''ÉTIQUETTES (§ 14)','1',
  (select count(*)::text from information_schema.tables
    where table_schema='public'
      and table_name in ('smart_tags','nfc_tags','qr_tags','etiquettes','labels'));

insert into res select 'Le jeton et l''identifiant ont enfin un défaut, donc le web peut créer','2',
  (select count(*)::text from information_schema.columns
    where table_schema='public' and table_name='smart_tags'
      and column_name in ('id','public_token') and column_default is not null);

-- DEUX CIBLES SUR LA MÊME ÉTIQUETTE : refusé. Sans cette contrainte,
-- la colonne calculée entity_kind choisirait en silence.
do $$
begin
  begin
    insert into public.smart_tags (workspace_id, type, plant_id, garden_id)
    values ((select v from ids where k='wsA'), 'qr',
            'e9900021-0000-4000-8000-000000000090','e9900020-0000-4000-8000-000000000090');
    insert into res select 'Deux cibles sur une même étiquette sont refusées','refusé','ACCEPTÉ';
  exception when check_violation then
    insert into res select 'Deux cibles sur une même étiquette sont refusées','refusé','refusé';
  end;
end $$;

do $$
begin
  begin
    insert into public.smart_tags (workspace_id, type, plant_id)
    values ((select v from ids where k='wsA'), 'rfid', 'e9900021-0000-4000-8000-000000000090');
    insert into res select 'Un type d''étiquette autre que qr ou nfc est refusé','refusé','ACCEPTÉ';
  exception when check_violation then
    insert into res select 'Un type d''étiquette autre que qr ou nfc est refusé','refusé','refusé';
  end;
end $$;

-- ============================================================
-- 2. LA PORTÉE SE DÉDUIT DE LA CIBLE, ELLE NE SE DÉCLARE PAS
-- ============================================================
-- LE TROU QUE LE § 2 DE LA MIGRATION BOUCHE : une étiquette qui
-- déclare l'espace de travail B tout en visant une plante de A. La RLS
-- ne regardait que la colonne déclarée ; le résolveur, lui, est
-- « security definer ».
do $$
begin
  begin
    insert into public.smart_tags (workspace_id, type, plant_id)
    values ((select v from ids where k='wsB'), 'qr', 'e9900021-0000-4000-8000-000000000090');
    insert into res select 'Une étiquette qui déclare un AUTRE espace que sa cible est refusée',
      'refusé','ACCEPTÉ';
  exception when insufficient_privilege then
    insert into res select 'Une étiquette qui déclare un AUTRE espace que sa cible est refusée',
      'refusé','refusé';
  end;
end $$;

-- Et l'inverse : une étiquette posée sur un lot de pépinière hérite
-- toute seule de l'entreprise ET de l'espace de travail du lot.
insert into public.smart_tags (id, workspace_id, type, nursery_lot_id)
values ('e9900040-0000-4000-8000-000000000090', null, 'qr',
        'e9900030-0000-4000-8000-000000000090');

insert into res select 'Une étiquette de lot hérite de l''entreprise de son lot','true',
  (select (t.organization_id = (select v from ids where k='orgA'))::text
     from public.smart_tags t where t.id = 'e9900040-0000-4000-8000-000000000090');
insert into res select 'Et de l''espace de travail, par le pont business_organizations','true',
  (select (t.workspace_id = (select v from ids where k='wsA'))::text
     from public.smart_tags t where t.id = 'e9900040-0000-4000-8000-000000000090');
insert into res select 'Sa cible calculée est bien un lot de pépinière','nurseryLot',
  (select t.entity_kind from public.smart_tags t where t.id = 'e9900040-0000-4000-8000-000000000090');

-- ============================================================
-- 3. FABRIQUER UNE ÉTIQUETTE DEPUIS LE WEB — LE GESTE QUI N'EXISTAIT PAS
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;

insert into jet select 'plante', c.public_token
  from public.etiquette_creer('plant','e9900021-0000-4000-8000-000000000090','qr', false) c;
insert into jet select 'materiel', c.public_token
  from public.etiquette_creer('equipment','e9900031-0000-4000-8000-000000000090','qr', false) c;
insert into jet select 'jardin', c.public_token
  from public.etiquette_creer('garden','e9900020-0000-4000-8000-000000000090','qr', false) c;

insert into res select 'Le jeton fabriqué par la base a bien 32 hexadécimaux','true',
  (select (v ~ '^[0-9a-f]{32}$')::text from jet where k='plante');

-- GÉNÉRER DEUX FOIS LE QR DU MÊME OBJET DOIT DONNER LE MÊME QR.
-- Sinon la planche imprimée hier ne vaut plus rien.
insert into res select 'Générer deux fois le QR d''une plante rend LE MÊME jeton','true',
  (select (c.public_token = (select v from jet where k='plante') and c.deja_existante)::text
     from public.etiquette_creer('plant','e9900021-0000-4000-8000-000000000090','qr', false) c);

-- Et le QR et le NFC du même objet sont DEUX étiquettes distinctes, qui
-- ouvrent la même fiche (§ 14).
insert into jet select 'plante_nfc', c.public_token
  from public.etiquette_creer('plant','e9900021-0000-4000-8000-000000000090','nfc', false) c;
insert into res select 'Le NFC d''une plante est une autre étiquette que son QR','true',
  (select ((select v from jet where k='plante_nfc') <> (select v from jet where k='plante'))::text);

reset role;
select set_config('request.jwt.claims', null, true);

-- Le pépiniériste pose l'étiquette d'un emplacement : il a
-- nursery.stock.manage, mais PAS etiquettes.manage. Poser une étiquette
-- exige le second.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900004-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into jet select 'lot_par_pepinieriste', c.public_token
  from public.etiquette_creer('nurseryLot','e9900030-0000-4000-8000-000000000090','qr', false) c;
insert into res select 'Le nurseryManager, qui porte etiquettes.manage, peut poser une étiquette','true',
  (select (v is not null)::text from jet where k='lot_par_pepinieriste');
reset role;
select set_config('request.jwt.claims', null, true);

-- L'OUVRIER, LUI, NE PEUT PAS. fieldWorker porte etiquettes.read, pas
-- etiquettes.manage : il scanne, il ne compose pas.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900003-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.etiquette_creer('plant','e9900021-0000-4000-8000-000000000090','qr', false);
    insert into res select 'Un ouvrier de terrain ne pose PAS d''étiquette','refusé','ACCEPTÉ';
  exception when insufficient_privilege then
    insert into res select 'Un ouvrier de terrain ne pose PAS d''étiquette','refusé','refusé';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

-- ============================================================
-- 4. LE RÉSOLVEUR — ET SURTOUT, L'ABSENCE D'ORACLE
-- ============================================================
-- Un jeton inexistant, de la BONNE FORME : il doit suivre exactement le
-- même chemin qu'un vrai, sinon la comparaison ne prouve rien.
insert into jet values ('inexistant','00000000000000000000000000000000');
insert into jet select 'plante_alteree',
  -- Le même jeton, UN SEUL caractère changé.
  overlay((select v from jet where k='plante') placing
          case when substr((select v from jet where k='plante'),1,1) = 'a' then 'b' else 'a' end
          from 1 for 1);

-- ---- LE PORTEUR HABILITÉ -------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'patron_plante', r.* from public.etiquette_resoudre((select v from jet where k='plante')) r;
insert into rez select 'patron_materiel', r.* from public.etiquette_resoudre((select v from jet where k='materiel')) r;
insert into rez select 'patron_lot', r.* from public.etiquette_resoudre((select v from jet where k='lot_par_pepinieriste')) r;
insert into rez select 'patron_altere', r.* from public.etiquette_resoudre((select v from jet where k='plante_alteree')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Un jeton valide rend son entité à qui a le droit','true',
  (select (ok and portee='complet' and entite_type='plant'
           and entite_id='e9900021-0000-4000-8000-000000000090')::text
     from rez where k='patron_plante');
insert into res select 'Et il dit QUEL ÉCRAN ouvrir (§ 15)','plante',
  (select ecran from rez where k='patron_plante');
insert into res select 'Avec le chemin web réel du jumeau numérique','true',
  (select (chemin = '/digital-twin/e9900020-0000-4000-8000-000000000090?plante=e9900021-0000-4000-8000-000000000090')::text
     from rez where k='patron_plante');
insert into res select 'UN JETON MODIFIÉ D''UN SEUL CARACTÈRE NE REND RIEN','false',
  (select ok::text from rez where k='patron_altere');

-- ---- LE PORTEUR CONNECTÉ SANS DROIT --------------------------
-- C'est l'assertion la plus importante du fichier.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900002-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'etranger_plante', r.* from public.etiquette_resoudre((select v from jet where k='plante')) r;
insert into rez select 'etranger_lot', r.* from public.etiquette_resoudre((select v from jet where k='lot_par_pepinieriste')) r;
insert into rez select 'etranger_inexistant', r.* from public.etiquette_resoudre((select v from jet where k='inexistant')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Un connecté sans droit n''obtient RIEN','false',
  (select ok::text from rez where k='etranger_plante');
insert into res select
  'ET SA RÉPONSE EST MOT POUR MOT CELLE D''UN JETON INEXISTANT — pas d''oracle','true',
  (select ((a.ok, a.message, a.portee, a.entite_type, a.entite_id, a.ecran, a.chemin, a.titre, a.details)
           is not distinct from
           (b.ok, b.message, b.portee, b.entite_type, b.entite_id, b.ecran, b.chemin, b.titre, b.details))::text
     from rez a, rez b where a.k='etranger_plante' and b.k='etranger_inexistant');
insert into res select 'Même chose pour une étiquette professionnelle','true',
  (select ((a.ok, a.message, a.portee, a.entite_type, a.entite_id, a.ecran, a.chemin, a.titre, a.details)
           is not distinct from
           (b.ok, b.message, b.portee, b.entite_type, b.entite_id, b.ecran, b.chemin, b.titre, b.details))::text
     from rez a, rez b where a.k='etranger_lot' and b.k='etranger_inexistant');
insert into res select 'Il n''apprend même pas que l''entité existe : type et identifiant sont nuls','true',
  (select (entite_type is null and entite_id is null and titre is null and details is null)::text
     from rez where k='etranger_plante');

-- ---- LA PERMISSION DÉPEND DE LA FAMILLE D'OBJET --------------
-- L'ouvrier porte projects.read (donc les jardins et le matériel) mais
-- pas nursery.stock.manage (donc pas les lots).
select set_config('request.jwt.claims',
  json_build_object('sub','e9900003-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'ouvrier_plante', r.* from public.etiquette_resoudre((select v from jet where k='plante')) r;
insert into rez select 'ouvrier_lot', r.* from public.etiquette_resoudre((select v from jet where k='lot_par_pepinieriste')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'L''ouvrier, membre de l''entreprise et pas de l''espace, voit la plante','true',
  (select ok::text from rez where k='ouvrier_plante');
insert into res select 'MAIS PAS LE LOT DE PÉPINIÈRE : la permission dépend de la famille','false',
  (select ok::text from rez where k='ouvrier_lot');

-- ---- LE VISITEUR ANONYME -------------------------------------
set local role anon;
insert into rez select 'anon_plante', r.* from public.etiquette_resoudre((select v from jet where k='plante')) r;
insert into rez select 'anon_lot', r.* from public.etiquette_resoudre((select v from jet where k='lot_par_pepinieriste')) r;
reset role;

insert into res select 'Un passant ne voit rien d''une étiquette non publiée','false',
  (select ok::text from rez where k='anon_plante');
insert into res select 'Ni du lot de pépinière, évidemment','false',
  (select ok::text from rez where k='anon_lot');

-- On PUBLIE l'étiquette de la plante, et seulement elle.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
select public.etiquette_publier(
  (select t.id from public.smart_tags t where t.public_token = (select v from jet where k='plante')), true);
select public.etiquette_publier(
  (select t.id from public.smart_tags t where t.public_token = (select v from jet where k='lot_par_pepinieriste')), true);
reset role;
select set_config('request.jwt.claims', null, true);

set local role anon;
insert into rez select 'anon_plante_publiee', r.* from public.etiquette_resoudre((select v from jet where k='plante')) r;
insert into rez select 'anon_lot_publie', r.* from public.etiquette_resoudre((select v from jet where k='lot_par_pepinieriste')) r;
reset role;

insert into res select 'Publiée, la plante montre sa fiche botanique à un passant','publique',
  (select portee from rez where k='anon_plante_publiee');
insert into res select 'Nom commun et nom scientifique, et rien de plus : trois clés','3',
  (select count(*)::text from jsonb_object_keys(
     (select details from rez where k='anon_plante_publiee')) x);
insert into res select 'Le nom d''usage « le palmier de l''entrée » ne sort PAS : c''est une donnée personnelle','false',
  (select ((select details from rez where k='anon_plante_publiee')::text ilike '%palmier de l%')::text);
insert into res select 'Ni l''identifiant de la plante','true',
  (select (entite_id is null)::text from rez where k='anon_plante_publiee');
insert into res select
  'UN LOT DE PÉPINIÈRE PUBLIÉ NE PARLE QUAND MÊME PAS À UN PASSANT : seule la plante a une fiche publique',
  'false', (select ok::text from rez where k='anon_lot_publie');

-- ============================================================
-- 5. UNE ÉTIQUETTE PERSONNELLE MARCHE TOUJOURS
-- ============================================================
-- Le monde d'origine de smart_tags : un espace personnel, aucune
-- entreprise, aucune permission. C'est is_workspace_member qui juge, et
-- il jugeait déjà avant 0090.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900005-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into jet select 'plante_perso', c.public_token
  from public.etiquette_creer('plant','e9900022-0000-4000-8000-000000000090','qr', false) c;
insert into rez select 'perso_sa_plante', r.*
  from public.etiquette_resoudre((select v from jet where k='plante_perso')) r;
-- Le matériel de l'entreprise A : professionnel, et JAMAIS publié —
-- contrairement à la plante de A, publiée au § 4. La différence
-- compte : elle sépare « je n'ai pas le droit » de « ceci est public ».
insert into rez select 'perso_materiel_de_A', r.*
  from public.etiquette_resoudre((select v from jet where k='materiel')) r;
-- Et la plante de A, elle, EST publiée : il doit en voir la fiche
-- botanique et rien d'autre. Un compte connecté n'a pas moins de droits
-- qu'un passant : il lui suffirait de se déconnecter.
insert into rez select 'perso_plante_de_A', r.*
  from public.etiquette_resoudre((select v from jet where k='plante')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Un particulier résout l''étiquette de SA plante','true',
  (select (ok and portee='complet' and entite_type='plant')::text from rez where k='perso_sa_plante');
insert into res select 'Son étiquette n''a NI entreprise NI organisation inventée','true',
  (select (t.organization_id is null)::text from public.smart_tags t
    where t.public_token = (select v from jet where k='plante_perso'));
insert into res select 'Et il ne résout RIEN d''une étiquette professionnelle non publiée',
  'true', (select (not ok and entite_type is null and entite_id is null)::text
             from rez where k='perso_materiel_de_A');
insert into res select
  'D''une étiquette PUBLIÉE il ne voit que la fiche botanique, jamais la fiche complète',
  'publique|null', (select portee || '|' || coalesce(entite_id::text, 'null')
                      from rez where k='perso_plante_de_A');

-- ============================================================
-- 6. AUCUNE DONNÉE INTERNE — LA PLUPART DE CES TESTS VÉRIFIENT UNE ABSENCE
-- ============================================================
insert into res select 'Le coût d''acquisition du matériel (24 500 €) NE SORT PAS','false',
  (select ((select details from rez where k='patron_materiel')::text like '%2450000%')::text);
insert into res select 'Ni son numéro de série','false',
  (select ((select details from rez where k='patron_materiel')::text ilike '%SN-XYZ-99%')::text);
insert into res select 'Ni la note interne du matériel','false',
  (select ((select details from rez where k='patron_materiel')::text ilike '%révision en retard%')::text);
insert into res select 'La marge notée sur le lot NE SORT PAS','false',
  (select ((select details from rez where k='patron_lot')::text ilike '%marge à surveiller%')::text);
insert into res select 'Ni le prix d''achat qui y est écrit','false',
  (select ((select details from rez where k='patron_lot')::text like '%3,20%')::text);
insert into res select 'La note interne de la plante NE SORT PAS non plus','false',
  (select ((select details from rez where k='patron_plante')::text ilike '%râle sur le prix%')::text);

-- LA LISTE BLANCHE, ÉNUMÉRÉE. Ce qui n'est pas dans cette liste ne peut
-- pas sortir : si quelqu'un ajoute une clé au résolveur sans y penser,
-- ce test tombe.
-- ORDONNÉES ALPHABÉTIQUEMENT, et non dans l'ordre du jsonb : celui-ci
-- range ses clés par longueur puis par octets, ce qui ferait échouer le
-- test pour une raison qui n'a rien à voir avec la sécurité.
-- AUCUN FILTRE ICI : la liste est comparée ENTIÈRE. Une clé ajoutée un
-- jour sans y penser fait tomber cette ligne, ce qui est exactement son
-- rôle.
insert into res select 'Le détail d''un matériel tient en quatre clés nommées, et pas une de plus',
  'category,internal_number,name,status',
  (select string_agg(x, ',' order by x)
     from jsonb_object_keys((select details from rez where k='patron_materiel')) x);
insert into res select 'Et il n''en a pas une de plus','4',
  (select count(*)::text from jsonb_object_keys((select details from rez where k='patron_materiel')) x);
insert into res select 'Le détail d''un lot tient en cinq clés nommées, sans fournisseur ni note',
  'cultivar,current_quantity,lot_code,species_name,status',
  (select string_agg(x, ',' order by x)
     from jsonb_object_keys((select details from rez where k='patron_lot')) x);

-- ============================================================
-- 7. LE SECOND REGISTRE — ABSORBÉ SANS PERDRE UN JETON
-- ============================================================
-- On simule un lot HÉRITÉ : un lot qui portait déjà son propre jeton
-- avant 0090, comme la ligne unique de production.
insert into public.nursery_lots (id, organization_id, lot_code, species_name, status,
                                 initial_quantity, current_quantity, public_token) values
 ('e9900050-0000-4000-8000-000000000090',(select v from ids where k='orgA'),
  'LOT-HERITE','Quercus ilex','available',100,100,'aaaa1111bbbb2222cccc3333dddd4444');

insert into res select 'Le DEFAULT de nursery_lots.public_token a bien disparu','true',
  (select (column_default is null)::text from information_schema.columns
    where table_schema='public' and table_name='nursery_lots' and column_name='public_token');

-- Tel quel, ce jeton hérité doit DÉJÀ résoudre — c'est le repli du § 6
-- de la migration, celui qui garde vivant un QR déjà imprimé.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'jeton_herite', r.*
  from public.etiquette_resoudre('aaaa1111bbbb2222cccc3333dddd4444') r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'UN JETON DE L''ANCIEN REGISTRE RÉSOUT ENCORE, en repli','true',
  (select (ok and entite_type='nurseryLot'
           and entite_id='e9900050-0000-4000-8000-000000000090')::text
     from rez where k='jeton_herite');

-- Et l'ordre de recherche est écrit : smart_tags GAGNE. On pose une
-- étiquette smart_tags portant le même jeton sur un AUTRE lot, et c'est
-- elle qui doit répondre.
insert into public.nursery_lots (id, organization_id, lot_code, species_name, status,
                                 initial_quantity, current_quantity) values
 ('e9900051-0000-4000-8000-000000000090',(select v from ids where k='orgA'),
  'LOT-PRIORITAIRE','Pinus pinea','available',10,10);
insert into public.smart_tags (workspace_id, type, nursery_lot_id, public_token) values
 (null,'qr','e9900051-0000-4000-8000-000000000090','aaaa1111bbbb2222cccc3333dddd4444');

select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'jeton_double', r.*
  from public.etiquette_resoudre('aaaa1111bbbb2222cccc3333dddd4444') r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'À jeton égal, smart_tags passe AVANT nursery_lots — l''ordre est écrit et tenu','true',
  (select (entite_id = 'e9900051-0000-4000-8000-000000000090')::text from rez where k='jeton_double');

-- ============================================================
-- 8. L'ÉNUMÉRATION — COMPTÉE, PLAFONNÉE, ET RÉGLABLE
-- ============================================================
-- Le seuil est abaissé pour que le test tienne en quelques appels : la
-- démonstration est qu'il SE RÈGLE, précisément parce qu'il n'est pas
-- codé en dur dans le corps d'une fonction.
insert into public.platform_admins (user_id, role, note) values
 ('e9900001-0000-4000-8000-000000000090','super_admin','Test étiquettes');
update public.platform_admins
   set is_active = false, revoked_at = now()
 where user_id <> 'e9900001-0000-4000-8000-000000000090' and is_active;

select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090','aal','aal2')::text, true);
set local role authenticated;
-- 10, PARCE QUE C'EST LE PLANCHER DE LA CONTRAINTE, et le plancher
-- existe pour une raison : un seuil de 1 ferait crier « sous attaque »
-- au premier autocollant décollé mal lu, et une alerte qui se déclenche
-- tout le temps est une alerte que plus personne ne regarde.
select public.etiquette_garde_regler(p_seuil_echecs => 10, p_alerte_minutes => 60);
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Le seuil se règle sans migration','10',
  (select seuil_echecs::text from public.etiquette_garde where id);

-- ET IL NE SE RÈGLE PAS N'IMPORTE COMMENT : sous le plancher, refus.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090','aal','aal2')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.etiquette_garde_regler(p_seuil_echecs => 1);
    insert into res select 'Un seuil sous le plancher est refusé','refusé','ACCEPTÉ';
  exception when check_violation then
    insert into res select 'Un seuil sous le plancher est refusé','refusé','refusé';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

delete from public.etiquette_tentatives;

set local role anon;
select public.etiquette_resoudre('11111111111111111111111111111111');
select public.etiquette_resoudre('22222222222222222222222222222222');
select public.etiquette_resoudre('33333333333333333333333333333333');
select public.etiquette_resoudre('44444444444444444444444444444444');
select public.etiquette_resoudre('55555555555555555555555555555555');
select public.etiquette_resoudre('66666666666666666666666666666666');
select public.etiquette_resoudre('77777777777777777777777777777777');
select public.etiquette_resoudre('88888888888888888888888888888888');
select public.etiquette_resoudre('99999999999999999999999999999999');
select public.etiquette_resoudre('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select public.etiquette_resoudre('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select public.etiquette_resoudre('cccccccccccccccccccccccccccccccc');
-- LE SIGNAL SE LIT SOUS L'IDENTITÉ D'UN ANONYME, et c'est le sens même
-- du test : la route /x tourne sans session, et c'est elle qui doit
-- pouvoir refuser au bord.
insert into res select 'Et la saturation est VISIBLE, même pour un anonyme','true',
  public.etiquettes_sous_attaque()::text;
reset role;

-- LE COMPTEUR LUI-MÊME NE SE LIT PAS SANS SESSION : un anonyme obtient
-- le booléen, jamais la table. Cette lecture-ci se fait donc APRÈS
-- « reset role » — et le § 12 vérifie plus bas qu'un anonyme qui
-- essaierait n'en tirerait aucune ligne.
insert into res select 'Douze jetons inventés sont comptés, mais LE COMPTEUR S''ARRÊTE AU SEUIL','10',
  (select max(failures)::text from public.etiquette_tentatives);

-- ET SOUS SATURATION, LA LIGNE N'EST PLUS RÉÉCRITE DU TOUT.
-- La preuve se lit dans le ctid, l'adresse physique de la ligne : une
-- écriture, même sans changer une valeur, en crée une nouvelle version
-- et donc un nouveau ctid. S'il ne bouge pas après cinq tentatives de
-- plus, c'est qu'aucun verrou et aucune écriture n'ont été pris.
-- CE QUE CELA DÉFEND : sans ce court-circuit, toutes les tentatives
-- d'une énumération se sérialisaient sur cette unique ligne, et c'est
-- celui qui frappe qui décidait du débit de la base.
insert into jet select 'ctid_avant',
  (select ctid::text from public.etiquette_tentatives order by window_start desc limit 1);
set local role anon;
select public.etiquette_resoudre('dddddddddddddddddddddddddddddddd');
select public.etiquette_resoudre('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
select public.etiquette_resoudre('ffffffffffffffffffffffffffffffff');
select public.etiquette_resoudre('0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a');
select public.etiquette_resoudre('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
reset role;
insert into res select 'Une fois saturée, la ligne du compteur n''est même plus réécrite','true',
  (select ((select ctid::text from public.etiquette_tentatives order by window_start desc limit 1)
           = (select v from jet where k='ctid_avant'))::text);

-- CE QU'ON NE FAIT SURTOUT PAS : refuser les jetons valides pendant une
-- saturation. Le client qui scanne son arbre pendant qu'un curieux tape
-- au hasard doit voir sa plante.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'sous_attaque_valide', r.*
  from public.etiquette_resoudre((select v from jet where k='plante')) r;
reset role;
select set_config('request.jwt.claims', null, true);
insert into res select 'Un jeton VALIDE passe toujours pendant une saturation','true',
  (select ok::text from rez where k='sous_attaque_valide');

-- Une étiquette révoquée refuse comme un jeton inventé.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
select public.etiquette_desactiver(
  (select t.id from public.smart_tags t where t.public_token = (select v from jet where k='jardin')));
insert into rez select 'jardin_revoque', r.* from public.etiquette_resoudre((select v from jet where k='jardin')) r;
reset role;
select set_config('request.jwt.claims', null, true);
insert into res select 'Une étiquette révoquée ne mène plus nulle part, même pour son propriétaire','false',
  (select ok::text from rez where k='jardin_revoque');

-- ============================================================
-- 9. LES CINQ ÉTIQUETTES DÉJÀ EN PRODUCTION FONCTIONNENT ENCORE
-- ============================================================
-- LE SEUL PARAGRAPHE QUI LISE LA PRODUCTION. Il résout les cinq
-- étiquettes réelles, une par une, sous l'identité de leur propriétaire
-- réel — et le ROLLBACK efface les scans qu'il vient d'y poser.
insert into ids select 'ws_prod', 'ce0dba90-c8a1-4239-8c62-12761b03b4ce'::uuid;
insert into ids select 'membre_prod', wm.user_id
  from public.workspace_members wm
 where wm.workspace_id = 'ce0dba90-c8a1-4239-8c62-12761b03b4ce'
 order by wm.created_at limit 1;

insert into res select 'Les cinq étiquettes de production sont toujours là et actives','5',
  (select count(*)::text from public.smart_tags t
    where t.workspace_id = 'ce0dba90-c8a1-4239-8c62-12761b03b4ce' and t.active
      and t.created_at < '2026-09-06');

do $$
declare
  v_membre uuid := (select v from ids where k='membre_prod');
  v_tok text;
  v_ok boolean;
  v_n integer := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_membre)::text, true);
  for v_tok in
    select t.public_token from public.smart_tags t
     where t.workspace_id = 'ce0dba90-c8a1-4239-8c62-12761b03b4ce'
       and t.active and t.created_at < '2026-09-06'
     order by t.created_at
  loop
    select r.ok into v_ok from public.etiquette_resoudre(v_tok) r;
    if v_ok then v_n := v_n + 1; end if;
  end loop;
  perform set_config('request.jwt.claims', null, true);
  insert into res select 'LES CINQ RÉSOLVENT POUR LEUR PROPRIÉTAIRE — deux plantes, un lot, deux racks','5', v_n::text;
end $$;

insert into res select 'Aucun de leurs jetons n''a été touché par la migration','5',
  (select count(*)::text from public.smart_tags t
    where t.public_token in ('c6c1c60b51e641b3a92802ddff39817c','00a0ebd7975c4d3fae9af76cdb273f9a',
                             '184231dc2ea24a28b9371f961c5b8c40','5b3f5ee1351246928ac18b4abe4a3ce8',
                             '5298bcf18419438788349084279a6f6d'));

insert into res select 'Les deux étiquettes de rack calculent bien la cible « rack »','2',
  (select count(*)::text from public.smart_tags t
    where t.public_token in ('184231dc2ea24a28b9371f961c5b8c40','5298bcf18419438788349084279a6f6d')
      and t.entity_kind = 'rack' and t.entity_id is null);

-- ============================================================
-- 10. LES MODÈLES D'ÉTIQUETTE (§ 18)
-- ============================================================
insert into res select 'Trois modèles Oasis sont semés, un par monde','3',
  (select count(*)::text from public.etiquette_modeles where organization_id is null);
insert into res select 'Et ils couvrent bien les trois familles','biolab,jardins,pepiniere',
  (select string_agg(famille, ',' order by famille) from public.etiquette_modeles where organization_id is null);
insert into res select 'Chacun porte un QR','3',
  (select count(*)::text from public.etiquette_modeles m
    where m.organization_id is null
      and exists (select 1 from jsonb_array_elements(m.champs) e where e->>'champ' = 'qr'));
insert into res select 'Leurs cotes sont en millimètres exacts, pas en flottants','numeric',
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='etiquette_modeles' and column_name='largeur_mm');

-- Un champ hors du vocabulaire du § 18 est refusé À L'ÉCRITURE, pas
-- devant l'imprimante.
do $$
begin
  begin
    insert into public.etiquette_modeles (organization_id, famille, nom, largeur_mm, hauteur_mm, champs)
    values ((select v from ids where k='orgA'),'jardins','Faux',50,30,
            jsonb_build_array(jsonb_build_object('champ','coordonneesBancaires','x',1,'y',1,'largeur',10,'hauteur',5)));
    insert into res select 'Un champ inconnu du § 18 est refusé','refusé','ACCEPTÉ';
  exception when check_violation then
    insert into res select 'Un champ inconnu du § 18 est refusé','refusé','refusé';
  end;
end $$;

-- Une cote écrite en texte (« 12mm ») est refusée : c'est exactement le
-- genre de valeur qui fait sortir une planche fausse.
do $$
begin
  begin
    insert into public.etiquette_modeles (organization_id, famille, nom, largeur_mm, hauteur_mm, champs)
    values ((select v from ids where k='orgA'),'jardins','Faux 2',50,30,
            jsonb_build_array(jsonb_build_object('champ','nom','x','12mm','y',1,'largeur',10,'hauteur',5)));
    insert into res select 'Une cote écrite en texte est refusée','refusé','ACCEPTÉ';
  exception when check_violation then
    insert into res select 'Une cote écrite en texte est refusée','refusé','refusé';
  end;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into ids select 'modeleA', public.etiquette_modele_enregistrer(
  (select v from ids where k='orgA'), 'pepiniere', 'Le modèle maison', 100, 50,
  jsonb_build_array(jsonb_build_object('champ','nom','x',2,'y',2,'largeur',60,'hauteur',8),
                    jsonb_build_object('champ','qr','x',70,'y',5,'largeur',25,'hauteur',25)),
  2, true);
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Une entreprise crée son propre modèle','true',
  (select (v is not null)::text from ids where k='modeleA');
insert into res select 'Et il devient LE défaut de sa famille, sans déloger celui d''Oasis','1',
  (select count(*)::text from public.etiquette_modeles
    where organization_id = (select v from ids where k='orgA')
      and famille='pepiniere' and est_defaut and archived_at is null);

-- Les modèles Oasis ne s'écrivent pas.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.etiquette_modele_archiver(
      (select id from public.etiquette_modeles where organization_id is null and famille='biolab'));
    insert into res select 'Un modèle fourni par Oasis ne s''archive pas','refusé','ACCEPTÉ';
  exception when insufficient_privilege then
    insert into res select 'Un modèle fourni par Oasis ne s''archive pas','refusé','refusé';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

-- ============================================================
-- 11. LES PERMISSIONS — ET LE PIÈGE DE 0075
-- ============================================================
-- Une permission neuve n'est portée par personne tant qu'on ne l'insère
-- pas. Le piège a déjà mordu trois fois ; on le vérifie par requête.
insert into res select 'etiquettes.read est portée par les onze rôles de terrain','11',
  (select count(*)::text from public.role_permissions where permission='etiquettes.read');
insert into res select 'etiquettes.manage est portée par les cinq rôles qui décident','5',
  (select count(*)::text from public.role_permissions where permission='etiquettes.manage');
insert into res select 'Un ouvrier de terrain PORTE bien etiquettes.read','true',
  (select exists(select 1 from public.role_permissions
                  where role='fieldWorker' and permission='etiquettes.read'))::text;
insert into res select 'Mais PAS etiquettes.manage','false',
  (select exists(select 1 from public.role_permissions
                  where role='fieldWorker' and permission='etiquettes.manage'))::text;

-- ============================================================
-- 12. LES DROITS — LES `grant` PAR DÉFAUT DE SUPABASE N'ONT RIEN ROUVERT
-- ============================================================
insert into res select 'Le résolveur est ouvert à un visiteur anonyme','true',
  has_function_privilege('anon','public.etiquette_resoudre(text)','execute')::text;
insert into res select 'Le signal de saturation aussi','true',
  has_function_privilege('anon','public.etiquettes_sous_attaque()','execute')::text;
insert into res select 'MAIS PAS le compteur d''échecs : le saturer soi-même ferait refuser tout le monde','false',
  has_function_privilege('anon','public.etiquette_note_echec(timestamptz)','execute')::text;
insert into res select 'Ni pour un compte connecté','false',
  has_function_privilege('authenticated','public.etiquette_note_echec(timestamptz)','execute')::text;
insert into res select 'Un anonyme ne peut pas poser d''étiquette','false',
  has_function_privilege('anon','public.etiquette_creer(text, uuid, text, boolean, boolean)','execute')::text;
insert into res select 'Ni régler la garde','false',
  has_function_privilege('anon','public.etiquette_garde_regler(integer, integer, integer)','execute')::text;

insert into res select 'Les trois tables neuves sont fermées en écriture à tout le monde','0',
  (select count(*)::text from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('etiquette_garde','etiquette_tentatives','etiquette_modeles')
      and grantee in ('anon','authenticated','public')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'));
insert into res select 'Et `anon` n''a rien du tout dessus, pas même la lecture','0',
  (select count(*)::text from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('etiquette_garde','etiquette_tentatives','etiquette_modeles')
      and grantee = 'anon');

insert into res select 'La RLS est allumée sur les trois tables neuves','3',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relrowsecurity
      and c.relname in ('etiquette_garde','etiquette_tentatives','etiquette_modeles'));

-- Toutes les fonctions `security definer` de ce chantier ont un
-- search_path figé. Une seule qui l'oublierait serait le vecteur
-- d'élévation de privilèges classique — ce projet vient d'en corriger
-- deux.
insert into res select 'Toute fonction security definer de 0090 a son search_path figé','0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prosecdef
      and p.proname in ('etiquette_resoudre','etiquette_note_echec','etiquette_fenetre',
                        'etiquettes_sous_attaque','etiquette_garde_regler','etiquette_creer',
                        'etiquettes_creer_lot','etiquette_publier','etiquette_desactiver',
                        'etiquette_modele_enregistrer','etiquette_modele_archiver',
                        'etiquette_portee_cible','smart_tags_portee')
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                       where c like 'search_path=%'));

-- ET SURTOUT : `anon` NE LIT AUCUNE LIGNE de smart_tags. La table
-- porte peut-être des droits hérités du défaut de Supabase — ce n'est
-- pas ce chantier qui les a créés — mais sa RLS ne laisse rien passer.
-- Un test qui compterait les DROITS échouerait sans rien dire de vrai ;
-- un test qui compte les LIGNES dit exactement ce qui compte.
-- DEUX FAÇONS DE NE RIEN VOIR, ET LES DEUX CONVIENNENT : soit le droit
-- de lire n'existe pas (les deux tables neuves, dont la migration
-- retire tout à `anon`), soit il existe mais la RLS ne rend aucune
-- ligne (smart_tags, qui porte des droits hérités du défaut de
-- Supabase — ce chantier ne les a pas créés). Le verdict est le même :
-- rien ne sort. Compter les DROITS seuls dirait faux pour l'une,
-- compter les LIGNES seules planterait sur les autres.
set local role anon;
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['smart_tags', 'etiquette_modeles', 'etiquette_tentatives', 'etiquette_garde']
  loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      insert into res select 'Un anonyme ne tire rien de ' || t, 'rien',
        case when n = 0 then 'rien' else n::text || ' LIGNES' end;
    exception when insufficient_privilege then
      insert into res select 'Un anonyme ne tire rien de ' || t, 'rien', 'rien';
    end;
  end loop;
end $$;
reset role;

-- Un compte connecté étranger à l'entreprise A ne lit pas ses
-- étiquettes non plus.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900002-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into res select 'Le patron de B ne lit aucune étiquette de A','0',
  (select count(*)::text from public.smart_tags t
    where t.organization_id = (select v from ids where k='orgA'));
reset role;
select set_config('request.jwt.claims', null, true);

-- ============================================================
-- 13. LES CINQ DÉFAUTS TROUVÉS EN ÉPROUVANT 0090 CONTRE LA PRODUCTION
-- ============================================================
-- Chacun de ces paragraphes défend une correction qu'AUCUN test ne
-- couvrait. Le § 7 vérifiait qu'un jeton hérité résout ; jamais qu'il
-- cesse de résoudre. Le § 3 éprouvait l'axe entreprise ; jamais un
-- membre d'espace de travail. Le § 11 comptait les permissions ; jamais
-- ce qu'un rôle voit vraiment.

-- ---- 13.a LA RÉVOCATION D'UNE ÉTIQUETTE MIGRÉE --------------
-- LE DÉFAUT : le § 4.a de la migration recopie
-- nursery_lots.public_token TEL QUEL dans une ligne smart_tags. Les
-- deux registres portent alors le même jeton. Le résolveur cherchait
-- « smart_tags … and t.active » : dès que la révocation posait
-- active = false, la recherche échouait et le code tombait dans le
-- REPLI sur nursery_lots — une colonne sans active, sans révocation,
-- sans aucun moyen d'être fermée. L'autocollant que le producteur
-- croyait mort ouvrait encore son lot : code, espèce, stock.
--
-- Le § 7 a déjà posé une ligne smart_tags portant le jeton hérité
-- 'aaaa1111…' (sur LOT-PRIORITAIRE). On la révoque, et le jeton doit
-- cesser de résoudre — pas retomber sur LOT-HERITE.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
select public.etiquette_desactiver(
  (select t.id from public.smart_tags t
    where t.public_token = 'aaaa1111bbbb2222cccc3333dddd4444'));
insert into rez select 'herite_revoque', r.*
  from public.etiquette_resoudre('aaaa1111bbbb2222cccc3333dddd4444') r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'RÉVOQUER une étiquette migrée la ferme VRAIMENT — plus de repli','false',
  (select ok::text from rez where k='herite_revoque');
insert into res select 'Et elle ne retombe surtout pas sur le lot hérité','',
  (select coalesce(titre,'') from rez where k='herite_revoque');

-- ---- 13.a bis LES ÉTIQUETTES DÉJÀ COLLÉES SONT MARQUÉES ----
-- Le § 2.b marque, une fois pour toutes, ce qui existait avant la
-- migration. Ces autocollants-là portent « oasis-care.example », mort
-- par la RFC 2606. La base ne peut pas savoir quelle adresse a été
-- imprimée — l'URL est calculée depuis le jeton, jamais stockée — mais
-- elle peut dire « antérieure au socle », et cela suffit à CHIFFRER la
-- réimpression au lieu de l'estimer.
insert into res select 'Les cinq étiquettes de production sont marquées « ancienne adresse »','5',
  (select count(*)::text from public.smart_tags t
    where t.ancienne_adresse and t.created_at < '2026-09-06');

-- ET CELLES QUE LE TEST VIENT DE POSER NE LE SONT PAS : une étiquette
-- créée après le socle naît avec la bonne adresse.
insert into res select 'Une étiquette posée après le socle n''est pas marquée','false',
  (select t.ancienne_adresse::text from public.smart_tags t
    where t.public_token = (select v from jet where k='plante'));

-- ---- 13.b LE MEMBRE D'ESPACE DE TRAVAIL SANS AUCUN RÔLE -----
-- LE DÉFAUT : les gardes s'écrivaient « is_workspace_member(ws) OU
-- has_permission(org, …) ». La première branche n'exige AUCUN rôle,
-- rien qu'une ligne dans workspace_members. Un compte ajouté à l'espace
-- sans l'être à l'entreprise pouvait donc publier sur Internet la
-- plante d'un client, révoquer l'étiquette d'un jardin, et poser une
-- étiquette sur le matériel — alors que le § 9 réserve
-- etiquettes.manage à cinq rôles sur onze.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('e9900006-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-wsSeul@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Le préparateur de commandes : membre de l'ENTREPRISE, rôle le moins
 -- habilité du produit. C'est lui qui éprouve le laboratoire.
 ('e9900007-0000-4000-8000-000000000090','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','et-orderPicker@test.invalid','',now(),now(),now(),now(),'{}','{}');

insert into public.workspace_members (workspace_id, user_id, role) values
 ((select v from ids where k='wsA'),'e9900006-0000-4000-8000-000000000090','member');
insert into public.organization_members (organization_id, user_id, role) values
 ((select v from ids where k='orgA'),'e9900007-0000-4000-8000-000000000090','orderPicker');

-- Le décor : il n'est PAS membre de l'entreprise, et il ne porte rien.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900006-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into res select 'Le membre d''espace de travail n''est PAS membre de l''entreprise','false',
  public.is_organization_member((select v from ids where k='orgA'))::text;
insert into res select 'Et il ne porte pas etiquettes.manage','false',
  public.has_permission((select v from ids where k='orgA'),'etiquettes.manage')::text;

-- 1. Il ne PUBLIE pas la plante d'un client sur Internet.
do $$
begin
  begin
    perform public.etiquette_publier(
      (select t.id from public.smart_tags t
        where t.public_token = (select v from jet where k='plante')), true);
    insert into res select 'Il ne peut PAS publier la plante du client','refusé','ACCEPTÉ';
  exception when insufficient_privilege then
    insert into res select 'Il ne peut PAS publier la plante du client','refusé','refusé';
  end;
end $$;

-- 2. Il ne RÉVOQUE pas l'étiquette d'un jardin.
do $$
begin
  begin
    perform public.etiquette_desactiver(
      (select t.id from public.smart_tags t
        where t.public_token = (select v from jet where k='plante')));
    insert into res select 'Il ne peut PAS révoquer une étiquette','refusé','ACCEPTÉ';
  exception when insufficient_privilege then
    insert into res select 'Il ne peut PAS révoquer une étiquette','refusé','refusé';
  end;
end $$;

-- 3. Il ne POSE pas d'étiquette sur le matériel de l'entreprise.
do $$
begin
  begin
    perform public.etiquette_creer('equipment','e9900031-0000-4000-8000-000000000090','qr', true);
    insert into res select 'Il ne peut PAS poser d''étiquette sur le matériel','refusé','ACCEPTÉ';
  exception when insufficient_privilege then
    insert into res select 'Il ne peut PAS poser d''étiquette sur le matériel','refusé','refusé';
  end;
end $$;

-- 4. Et il ne LIT pas non plus : la permission par famille n'est plus
--    annulée par la simple appartenance à l'espace.
insert into rez select 'wsSeul_lot', r.*
  from public.etiquette_resoudre((select v from jet where k='lot_par_pepinieriste')) r;
insert into rez select 'wsSeul_materiel', r.*
  from public.etiquette_resoudre((select v from jet where k='materiel')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Un membre d''espace sans rôle ne résout pas un lot de pépinière','false',
  (select ok::text from rez where k='wsSeul_lot');
insert into res select 'Ni le matériel de l''entreprise','false',
  (select ok::text from rez where k='wsSeul_materiel');

-- ET L'ESPACE PERSONNEL N'EST PAS TOUCHÉ : c'est le monde d'origine de
-- smart_tags, il n'a aucune entreprise derrière, et son propriétaire
-- doit continuer de passer par la porte « espace de travail ».
insert into res select 'Le particulier résout toujours sa propre plante','true',
  (select ok::text from rez where k='perso_sa_plante');

-- ---- 13.c LE LABORATOIRE N'EST PLUS LA DONNÉE LA MOINS GARDÉE
-- LE DÉFAUT : les six familles BioLab ne posaient jamais v_perm, qui
-- restait à 'etiquettes.read' — accordée aux ONZE rôles. Le
-- préparateur de commandes se voyait donc refuser le nom d'une
-- mini-pelle (gardée par projects.read) et recevait EN ENTIER un lot de
-- culture : espèce, cultivar, stade, effectif. Le savoir-faire du
-- laboratoire était la donnée la moins protégée du produit.
insert into public.culture_batches
  (id, workspace_id, batch_code, species_name, cultivar, culture_stage, status,
   started_at, initial_explant_count, current_count, created_at)
values
 ('e9900060-0000-4000-8000-000000000090',(select v from ids where k='wsA'),
  'CB-2026-SECRET','Wollemia nobilis','Notre clone maison','multiplication','active',
  now(), 1200, 1200, now());

select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into jet select 'lot_biolab', c.public_token
  from public.etiquette_creer('cultureBatch','e9900060-0000-4000-8000-000000000090','qr', false) c;
reset role;
select set_config('request.jwt.claims', null, true);

-- Le préparateur de commandes : membre de l'entreprise, rôle le moins
-- habilité. Il porte etiquettes.read et nursery.stock.manage, pas
-- biolab.read.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900007-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into res select 'Le préparateur de commandes porte bien etiquettes.read','true',
  public.has_permission((select v from ids where k='orgA'),'etiquettes.read')::text;
insert into res select 'Mais PAS biolab.read','false',
  public.has_permission((select v from ids where k='orgA'),'biolab.read')::text;
insert into rez select 'picker_biolab', r.*
  from public.etiquette_resoudre((select v from jet where k='lot_biolab')) r;
insert into rez select 'picker_materiel', r.*
  from public.etiquette_resoudre((select v from jet where k='materiel')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Le rôle le moins habilité ne lit PAS un lot de culture','false',
  (select ok::text from rez where k='picker_biolab');
insert into res select 'Le cultivar du laboratoire ne sort pas','',
  (select coalesce(details::text,'') from rez where k='picker_biolab');
insert into res select 'Il ne lit pas le matériel non plus — c''était déjà vrai','false',
  (select ok::text from rez where k='picker_materiel');

-- ET LE PÉPINIÉRISTE, LUI, ENTRE : nurseryManager porte biolab.read
-- (semé par 0087). Une correction qui fermerait la porte à tout le
-- monde ne serait pas une correction.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900004-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'pepinieriste_biolab', r.*
  from public.etiquette_resoudre((select v from jet where k='lot_biolab')) r;
reset role;
select set_config('request.jwt.claims', null, true);
insert into res select 'Le pépiniériste, qui porte biolab.read, lit bien le lot de culture','true',
  (select ok::text from rez where k='pepinieriste_biolab');

-- ---- 13.d LE CORPS DU TEXTE DOIT TENIR DANS SON CADRE -------
-- LE DÉFAUT : rien ne bornait « taille ». Un corps de 24 points dans un
-- cadre de 4 mm sortait des glyphes de 0,96 à 8,83 mm — la marge mordue
-- en haut, près de 3 mm dans le champ voisin, et pas un mot.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.etiquette_modele_enregistrer(
      p_organization_id => (select v from ids where k='orgA'),
      p_famille => 'jardins',
      p_nom => 'Corps hors cadre',
      p_largeur_mm => 60, p_hauteur_mm => 40,
      p_champs => jsonb_build_array(jsonb_build_object(
        'champ','nom','x',2,'y',2,'largeur',34,'hauteur',4,'taille',24)));
    insert into res select 'Un corps trop grand pour son cadre est refusé','refusé','ACCEPTÉ';
  exception when others then
    insert into res select 'Un corps trop grand pour son cadre est refusé','refusé','refusé';
  end;
end $$;

-- Et la contre-épreuve : juste en dessous de la borne, ça passe.
-- 2,485 point par millimètre de cadre : 4 mm tiennent 9,9 points.
do $$
declare v_id uuid;
begin
  select public.etiquette_modele_enregistrer(
    p_organization_id => (select v from ids where k='orgA'),
    p_famille => 'jardins',
    p_nom => 'Corps qui tient',
    p_largeur_mm => 60, p_hauteur_mm => 40,
    p_champs => jsonb_build_array(jsonb_build_object(
      'champ','nom','x',2,'y',2,'largeur',34,'hauteur',4,'taille',9))) into v_id;
  insert into res select 'Un corps qui tient passe sans discuter','true',(v_id is not null)::text;
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

-- LES TROIS MODÈLES FOURNIS PASSENT CETTE BORNE. Sinon la migration se
-- refuserait elle-même au prochain enregistrement.
insert into res select 'Les trois modèles Oasis respectent la borne de corps','true',
  (select bool_and(public.etiquette_champs_valides(m.champs))::text
     from public.etiquette_modeles m where m.organization_id is null);

-- ET LE MODÈLE BIOLAB A UN CADRE DE QR DE 15 mm, pas 13. À 13 mm, un QR
-- de version 4 (33 modules + 8 de zone de silence = 41) donnait
-- 0,317 mm par module — sous le plancher de 0,33 en dessous duquel un
-- appareil photo décroche. L'autocollant sortait parfait et ne se
-- scannait pas.
insert into res select 'Le cadre du QR BioLab mesure 15 mm','15',
  (select (e->>'largeur') from public.etiquette_modeles m,
          lateral jsonb_array_elements(m.champs) e
    where m.organization_id is null and m.famille='biolab' and e->>'champ'='qr');

-- ---- 13.f LA TRACE DE SCAN NE RECULE JAMAIS ----------------
-- LE DÉFAUT : le résolveur écrit last_scanned_at côté serveur, et
-- l'iPhone continue de l'envoyer dans sa synchronisation. Un téléphone
-- qui n'a pas vu le scan du serveur écrasait donc un horodatage récent
-- par un plus ancien — ou par NULL. L'écran de suivi montrait « jamais
-- scannée » une étiquette qui venait de l'être, et c'est ce chiffre-là
-- qui décide de remplacer un autocollant.
--
-- On simule exactement ce que fait la synchronisation : un update qui
-- repose une valeur plus ancienne.
select set_config('request.jwt.claims',
  json_build_object('sub','e9900001-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
select public.etiquette_resoudre((select v from jet where k='plante'));
reset role;
select set_config('request.jwt.claims', null, true);

insert into jet select 'scan_serveur',
  (select last_scanned_at::text from public.smart_tags
    where public_token = (select v from jet where k='plante'));
insert into res select 'Le résolveur a bien horodaté le scan','true',
  (select (v is not null)::text from jet where k='scan_serveur');

-- La synchronisation repose une date d'hier, et un compteur à zéro.
update public.smart_tags
   set last_scanned_at = now() - interval '1 day', scanned_count = 0
 where public_token = (select v from jet where k='plante');

insert into res select 'Une synchronisation ne peut pas rembobiner l''horodatage','true',
  (select (last_scanned_at::text = (select v from jet where k='scan_serveur'))::text
     from public.smart_tags where public_token = (select v from jet where k='plante'));
insert into res select 'Ni remettre le compteur de scans à zéro','true',
  (select (scanned_count >= 1)::text
     from public.smart_tags where public_token = (select v from jet where k='plante'));

-- ET ELLE PEUT TOUJOURS AVANCER : un scan hors ligne, remonté plus
-- tard, doit être pris. Le garde-fou n'est pas un verrou.
update public.smart_tags
   set last_scanned_at = now() + interval '1 hour'
 where public_token = (select v from jet where k='plante');
insert into res select 'Mais un scan PLUS RÉCENT passe : ce n''est pas un verrou','true',
  (select (last_scanned_at > (select v from jet where k='scan_serveur')::timestamptz)::text
     from public.smart_tags where public_token = (select v from jet where k='plante'));

-- ---- 13.e L'ENTREPRISE ARCHIVÉE CESSE DE RÉSOUDRE -----------
-- LE DÉFAUT : has_permission() ne regarde que l'archivage du MEMBRE,
-- jamais celui de l'entreprise. Une entreprise archivée continuait donc
-- de livrer ses matériels et ses lots à tous ses anciens membres — et
-- le résolveur posait pourtant « o.archived_at is null » en traversant
-- le pont espace → entreprise, ce qui donnait l'illusion inverse.
insert into rez select 'avant_archivage', r.*
  from public.etiquette_resoudre((select v from jet where k='materiel')) r;

update public.business_organizations set archived_at = now()
 where id = (select v from ids where k='orgA');

select set_config('request.jwt.claims',
  json_build_object('sub','e9900003-0000-4000-8000-000000000090')::text, true);
set local role authenticated;
insert into rez select 'apres_archivage', r.*
  from public.etiquette_resoudre((select v from jet where k='materiel')) r;
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'Une entreprise archivée ne livre plus son matériel','false',
  (select ok::text from rez where k='apres_archivage');

update public.business_organizations set archived_at = null
 where id = (select v from ids where k='orgA');

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
