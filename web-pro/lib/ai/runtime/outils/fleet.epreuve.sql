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
