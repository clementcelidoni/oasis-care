-- Oasis Care — §5 GESTION → MATÉRIEL (migration 0067).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE CLOISONNEMENT. Une entreprise ne voit pas le parc d'une
--      autre, et — le cas moins évident — ne peut pas ACCROCHER une
--      ligne d'entretien ou une affectation au matériel d'une autre en
--      déclarant sa propre organisation. C'est la faille que la
--      migration 0062 a dû réparer ailleurs : la politique RLS
--      demandait « as-tu le droit d'écrire chez toi ? », la réponse
--      était oui, et personne ne vérifiait l'autre bout de la ligne.
--
--   2. LE CALCUL DES ÉCHÉANCES. C'est la seule raison d'être du
--      module : un état faux vaut moins qu'un module absent, parce
--      qu'il inspire une confiance que rien ne justifie. On vérifie
--      donc les quatre états, le compte de jours, le préavis à ZÉRO
--      (« préviens-moi le jour même »), et la date d'où repart une
--      échéance renouvelée.
--
--   3. LES INDICATEURS INCALCULABLES. Un compteur jamais relevé rend
--      NULL, jamais 0 — et il redevient NULL quand on supprime la
--      relève qui l'avait produit. Un `max()` voit la suppression ;
--      une valeur recopiée sur la fiche ne la verrait jamais.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les deux comptes de test.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- Le repère de temps du test est celui de la vue : la date de PARIS.
-- Prendre `current_date` ici ferait échouer le test deux heures par
-- nuit en été, sans que rien ne soit cassé — le pire des tests.
create temp table repere(today date) on commit drop;
insert into repere select (now() at time zone 'Europe/Paris')::date;
grant all on repere to authenticated;

-- ============================================================
-- Fixtures — deux entreprises, deux comptes
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000067-0000-4000-8000-000000000067','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','materiel-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000067-0000-4000-8000-000000000067','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','materiel-b@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000067-0000-4000-8000-000000000067')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000067-0000-4000-8000-000000000067')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages B','landscaper');

-- Le parc de A : un camion et une nacelle.
insert into ids select 'master', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, brand, model,
                              internal_number, registration, ownership, meter_kind)
select (select v from ids where k='master'), (select v from ids where k='orgA'),
       'Master benne', 'vehicle', 'Renault', 'Master', '12', 'AB-123-CD', 'owned', 'kilometers';

insert into ids select 'nacelle', gen_random_uuid();
insert into public.equipment (id, organization_id, name, category, meter_kind)
select (select v from ids where k='nacelle'), (select v from ids where k='orgA'),
       'Nacelle 12 m', 'lifting', 'hours';

-- Une équipe chez B, pour le test d'affectation croisée.
insert into ids select 'equipeB', gen_random_uuid();
insert into public.teams (id, organization_id, name)
select (select v from ids where k='equipeB'), (select v from ids where k='orgB'), 'Équipe B';

insert into ids select 'equipeA', gen_random_uuid();
insert into public.teams (id, organization_id, name)
select (select v from ids where k='equipeA'), (select v from ids where k='orgA'), 'Équipe A';

-- ---------- Les échéances du camion ----------
-- En retard de cinq jours.
insert into ids select 'retard', gen_random_uuid();
insert into public.equipment_deadlines (id, organization_id, equipment_id, kind, due_on, reminder_days)
select (select v from ids where k='retard'), (select v from ids where k='orgA'),
       (select v from ids where k='master'), 'insurance', (select today from repere) - 5, 30;

-- Dans douze jours, préavis de trente : c'est la ligne qui doit
-- remonter en tête d'écran.
insert into ids select 'bientot', gen_random_uuid();
insert into public.equipment_deadlines (id, organization_id, equipment_id, kind, due_on,
                                        reminder_days, recurrence_months)
select (select v from ids where k='bientot'), (select v from ids where k='orgA'),
       (select v from ids where k='master'), 'technicalInspection',
       (select today from repere) + 12, 30, 24;

-- Dans deux cents jours : hors préavis, donc silencieuse.
insert into ids select 'lointaine', gen_random_uuid();
insert into public.equipment_deadlines (id, organization_id, equipment_id, kind, due_on, reminder_days)
select (select v from ids where k='lointaine'), (select v from ids where k='orgA'),
       (select v from ids where k='master'), 'service', (select today from repere) + 200, 30;

-- LE PRÉAVIS À ZÉRO. « Préviens-moi le jour même » est une consigne
-- légitime, pas un champ vide : celle du jour doit sonner, celle de
-- demain doit se taire.
insert into public.equipment_deadlines (organization_id, equipment_id, kind, label, due_on, reminder_days)
select (select v from ids where k='orgA'), (select v from ids where k='nacelle'),
       'regulatoryCheck', 'VGP du jour', (select today from repere), 0;
insert into public.equipment_deadlines (organization_id, equipment_id, kind, label, due_on, reminder_days)
select (select v from ids where k='orgA'), (select v from ids where k='nacelle'),
       'regulatoryCheck', 'VGP de demain', (select today from repere) + 1, 0;

-- ============================================================
-- On devient réellement l'utilisateur A
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','a0000067-0000-4000-8000-000000000067')::text, true);
set local role authenticated;

-- ---------- 2. Le calcul des échéances ----------
insert into res
select 'Une échéance passée est « en retard »','overdue',
       (select state from public.equipment_due_dates where deadline_id = (select v from ids where k='retard'));

insert into res
select 'Le retard se compte en jours négatifs','-5',
       (select days_left::text from public.equipment_due_dates where deadline_id = (select v from ids where k='retard'));

insert into res
select 'Douze jours avec trente de préavis : « bientôt »','dueSoon',
       (select state from public.equipment_due_dates where deadline_id = (select v from ids where k='bientot'));

insert into res
select 'Le décompte affiché est bien de douze jours','12',
       (select days_left::text from public.equipment_due_dates where deadline_id = (select v from ids where k='bientot'));

insert into res
select 'Deux cents jours : hors préavis, donc « planifiée »','planned',
       (select state from public.equipment_due_dates where deadline_id = (select v from ids where k='lointaine'));

-- Le défaut connu du projet, retourné en test : un `|| 30` sur un
-- préavis à zéro rendrait cette ligne « planifiée » et personne ne
-- serait prévenu le jour dit.
insert into res
select 'Préavis à ZÉRO : l''échéance du jour sonne quand même','dueSoon',
       (select state from public.equipment_due_dates where label = 'VGP du jour');

insert into res
select 'Préavis à ZÉRO : celle de demain se tait','planned',
       (select state from public.equipment_due_dates where label = 'VGP de demain');

-- La synthèse doit remonter la PLUS PROCHE qui court, c'est-à-dire le
-- retard — pas la prochaine dans le futur.
insert into res
select 'La fiche annonce l''échéance la plus urgente','insurance',
       (select next_due_kind::text from public.equipment_overview
        where equipment_id = (select v from ids where k='master'));

insert into res
select 'Elle compte les retards','1',
       (select overdue_count::text from public.equipment_overview
        where equipment_id = (select v from ids where k='master'));

-- ---------- 3. Un indicateur incalculable rend NULL ----------
insert into res
select 'Sans relève, le compteur est INCONNU (et non zéro)','NULL',
       coalesce((select current_meter::text from public.equipment_overview
                 where equipment_id = (select v from ids where k='master')), 'NULL');

insert into res
select 'Sans intervention, le coût d''entretien est INCONNU','NULL',
       coalesce((select maintenance_cost_cents::text from public.equipment_overview
                 where equipment_id = (select v from ids where k='master')), 'NULL');

insert into ids select 'vidange', gen_random_uuid();
insert into public.equipment_maintenance (id, organization_id, equipment_id, kind,
                                          description, cost_cents, meter_reading, performed_on)
select (select v from ids where k='vidange'), (select v from ids where k='orgA'),
       (select v from ids where k='master'), 'service', 'Vidange sous garantie',
       0, 84500, (select today from repere) - 30;

insert into res
select 'Le compteur courant est celui de la dernière relève','84500.0',
       (select current_meter::text from public.equipment_overview
        where equipment_id = (select v from ids where k='master'));

-- Zéro euro n'est PAS « on ne sait pas » : une révision sous garantie
-- coûte réellement zéro, et l'écran doit écrire « 0 € », pas « — ».
insert into res
select 'Un entretien gratuit coûte ZÉRO, ce qui n''est pas inconnu','0',
       (select maintenance_cost_cents::text from public.equipment_overview
        where equipment_id = (select v from ids where k='master'));

-- LA DERNIÈRE RELÈVE FAIT FOI, PAS LA PLUS HAUTE. Compteur remplacé
-- hier : la valeur repart de zéro, et c'est celle-là qui est vraie.
-- Un `max()` afficherait 84 500 km sur un compteur qui en marque 12,
-- pour toujours et sans rien signaler.
insert into ids select 'compteur', gen_random_uuid();
insert into public.equipment_maintenance (id, organization_id, equipment_id, kind,
                                          description, cost_cents, meter_reading, performed_on)
select (select v from ids where k='compteur'), (select v from ids where k='orgA'),
       (select v from ids where k='master'), 'reading', 'Compteur remplacé',
       0, 12, (select today from repere) - 1;

insert into res
select 'La dernière relève l''emporte sur la plus haute','12.0',
       (select current_meter::text from public.equipment_overview
        where equipment_id = (select v from ids where k='master'));

insert into res
select 'La date du compteur est celle de cette relève-là',
       ((select today from repere) - 1)::text,
       (select meter_read_on::text from public.equipment_overview
        where equipment_id = (select v from ids where k='master'));

delete from public.equipment_maintenance
 where id in ((select v from ids where k='vidange'), (select v from ids where k='compteur'));

insert into res
select 'Supprimer les relèves rend le compteur à nouveau INCONNU','NULL',
       coalesce((select current_meter::text from public.equipment_overview
                 where equipment_id = (select v from ids where k='master')), 'NULL');

-- ---------- Honorer une échéance renouvelable ----------
-- Contrôle technique passé AUJOURD'HUI alors qu'il n'expirait que dans
-- douze jours : le procès-verbal court à compter du jour du contrôle,
-- donc la suivante aussi. Repartir de l'ancienne date offrirait douze
-- jours gratuits, tous les deux ans.
insert into ids
select 'suivante', public.complete_equipment_deadline((select v from ids where k='bientot'));

insert into res
select 'La suivante part du jour du contrôle, pas de l''ancienne date',
       (((select today from repere) + interval '24 months')::date)::text,
       (select due_on::text from public.equipment_deadlines where id = (select v from ids where k='suivante'));

insert into res
select 'L''échéance honorée sort du calcul','done',
       (select state from public.equipment_due_dates where deadline_id = (select v from ids where k='bientot'));

insert into res
select 'Rappelée deux fois, la fonction ne crée pas de doublon','true',
       (public.complete_equipment_deadline((select v from ids where k='bientot')) is null)::text;

-- Le retard, la révision lointaine, et celle que la clôture vient
-- d'engendrer. Le parc n'est jamais laissé sans contrôle technique à
-- venir : c'est tout l'intérêt d'écrire les deux lignes dans la même
-- opération.
insert into res
select 'Trois échéances courent encore sur le camion','3',
       (select count(*)::text from public.equipment_due_dates
        where equipment_id = (select v from ids where k='master') and completed_on is null);

-- ---------- Un seul endroit à la fois ----------
insert into public.equipment_assignments (organization_id, equipment_id, team_id)
select (select v from ids where k='orgA'), (select v from ids where k='master'),
       (select v from ids where k='equipeA');

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.equipment_assignments (organization_id, equipment_id, team_id)
    select v, (select v from ids where k='master'), (select v from ids where k='equipeA')
    from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('Un engin ne peut pas être à deux endroits le même jour','true',refuse::text);
end $$;

-- ---------- Le doublon de plaque, casse et tirets compris ----------
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.equipment (organization_id, name, registration)
    select v, 'Faux Master', 'ab 123 cd' from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('« ab 123 cd » est la même plaque que « AB-123-CD »','true',refuse::text);
end $$;

-- ---------- 1. Le cloisonnement, vu de A ----------
-- A tente d'affecter SON camion à l'équipe de B. La politique RLS dit
-- oui (A écrit chez A) ; c'est le déclencheur qui doit dire non.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.equipment_assignments (organization_id, equipment_id, team_id)
    select (select v from ids where k='orgA'), (select v from ids where k='nacelle'),
           (select v from ids where k='equipeB');
  exception when others then refuse := true;
  end;
  insert into res values ('A ne peut pas affecter son engin à une équipe de B','true',refuse::text);
end $$;

-- A tente de rattacher une intervention du camion à une échéance de la
-- NACELLE : cohérent en apparence, faux en substance.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.equipment_maintenance (organization_id, equipment_id, kind, deadline_id)
    select (select v from ids where k='orgA'), (select v from ids where k='master'), 'inspection',
           (select id from public.equipment_deadlines where label = 'VGP du jour');
  exception when others then refuse := true;
  end;
  insert into res values ('Une intervention ne peut pas honorer l''échéance d''un autre engin','true',refuse::text);
end $$;

-- ============================================================
-- 1. Le cloisonnement, vu de B
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000067-0000-4000-8000-000000000067')::text, true);
set local role authenticated;

insert into res
select 'B ne voit aucun matériel de A','0',
       (select count(*)::text from public.equipment);

insert into res
select 'B ne voit aucune échéance de A','0',
       (select count(*)::text from public.equipment_due_dates);

insert into res
select 'B ne voit aucune ligne de la synthèse de A','0',
       (select count(*)::text from public.equipment_overview);

-- LA TENTATIVE QUI COMPTE. B écrit chez B — la politique RLS est donc
-- satisfaite — mais désigne le camion de A. Sans la clé composite
-- (equipment_id, organization_id), cette ligne passerait, et B lirait
-- ensuite l'entretien du camion de A depuis sa propre organisation.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.equipment_maintenance (organization_id, equipment_id, kind, cost_cents)
    select (select v from ids where k='orgB'), (select v from ids where k='master'), 'repair', 50000;
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas accrocher un entretien au camion de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.equipment_deadlines (organization_id, equipment_id, kind, due_on)
    select (select v from ids where k='orgB'), (select v from ids where k='master'), 'insurance',
           (select today from repere);
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas poser une échéance sur le camion de A','true',refuse::text);
end $$;

-- Et B ne peut pas honorer une échéance de A : la fonction est en
-- `security invoker`, donc la ligne lui reste invisible.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.complete_equipment_deadline((select v from ids where k='retard'));
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas clore une échéance de A','true',refuse::text);
end $$;

reset role;

-- Vérifié UNE FOIS SORTI de la peau de B, et c'est essentiel : posée
-- pendant que la RLS de B masque la ligne, la question aurait rendu
-- zéro quoi qu'il arrive — un test qui passe même quand tout est
-- cassé. Ici la requête voit vraiment la ligne de A.
insert into res
select 'L''échéance de A est restée ouverte','0',
       (select count(*)::text from public.equipment_deadlines
        where id = (select v from ids where k='retard') and completed_on is not null);

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
