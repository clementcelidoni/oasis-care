-- Oasis Care — §11Y, L'ÉPREUVE DE `ai_customer_value`.
--
-- ============================================================
-- OÙ CE FICHIER DOIT FINIR
-- ============================================================
--
-- Dans `supabase/tests/agents_ia.sql`, qui appartient à l'intégration.
-- Autonome — son `begin`, ses tables temporaires, son `rollback` — pour
-- se rejouer seul et s'y ajouter sans rien renommer.
--
--   node runsql.js .sb_token customer.sql customer.epreuve.sql
--
-- ============================================================
-- CE QU'ELLE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. LES TROIS DROITS. C'est la raison d'être de cette épreuve. Un
--      compte qui n'a que `clients.read` traverse quand même la
--      fonction — le client existe, il est lisible — et obtiendrait, en
--      `security invoker` nu, ZÉRO devis, ZÉRO facture, ZÉRO euro. Tout
--      serait vrai au sens du SQL et faux au sens de la question. §5
--      exige que les blocs vaillent NULL et que les trois droits soient
--      NOMMÉS.
--
--   2. « RIEN » N'EST PAS « ZÉRO ». Un client sans devis et sans facture
--      rend des totaux NULL et des comptes à 0 (§4) : le compte est un
--      fait vérifié, le total serait une affirmation sur de l'argent.
--
--   3. L'ARGENT REÇU N'EST PAS L'ARGENT LETTRÉ. Un acompte versé avant
--      toute facture n'est rattaché à rien : les confondre ferait dire
--      « il n'a rien payé » d'un client dont l'argent est sur le compte
--      (§3).
--
--   4. UN BROUILLON N'EST PAS UNE FACTURE. Sans numéro de séquence
--      légale elle n'existe pas : elle est comptée à part, jamais dans
--      le total facturé (§2).
--
--   5. L'ANCIENNETÉ INCONNUE RESTE INCONNUE. `converted_at` est vide sur
--      le seul client de la production : « client depuis 0 jour » se
--      lirait « nouveau client », et c'est faux (§6).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

insert into cfg select 'today', (now() at time zone 'Europe/Paris')::date;

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000082-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cust-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000082-0000-4000-8000-0000000000c2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cust-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000082-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cust-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Clients A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000c2')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Clients B','landscaper');

-- LE COMPTE QUI FAIT TOUT L'INTÉRÊT DE §5 : membre de A, et il n'a QUE
-- `clients.read`. Il voit le client et rien de son argent.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000082-0000-4000-8000-0000000000c3', 'custom', array['clients.read']
from ids where k='orgA';

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

-- ============================================================
-- Le décor : un client complet, un client vierge
-- ============================================================

-- « GRAND COMPTE » : deux devis (un accepté, un envoyé), deux factures
-- émises et un brouillon, un règlement partiel, un acompte non lettré,
-- un avoir, deux chantiers.
insert into ids select 'cli1', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind,
                                  lifecycle_stage, billing_city, converted_at)
select (select v from ids where k='cli1'), (select v from ids where k='orgA'),
       'GRAND COMPTE', 'company', 'customer', 'Nice',
       ((select d from cfg where k='today') - 400)::timestamptz;

-- « CLIENT VIERGE » : une fiche, et rien d'autre. Aucun devis, aucune
-- facture, aucun règlement, et `converted_at` vide — l'état exact du
-- seul client de la production.
insert into ids select 'cli2', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cli2'), (select v from ids where k='orgA'),
       'CLIENT VIERGE', 'individual', 'lead';

-- ---------- Les devis ----------
-- ACCEPTÉ : 1 000 € HT (une ligne de 1 000 €, TVA 20 %).
insert into ids select 'dev1', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='dev1'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'DEV-EPR-0001', 'Création jardin', 'accepted',
       (select d from cfg where k='today') - 120;
insert into public.quote_lines (organization_id, quote_id, description, quantity,
                                unit_sale_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='dev1'),
       'Terrassement', 1, 100000, 20;

-- ENVOYÉ, en attente de réponse : 500 € HT.
insert into ids select 'dev2', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='dev2'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'DEV-EPR-0002', 'Arrosage', 'sent',
       (select d from cfg where k='today') - 10;
insert into public.quote_lines (organization_id, quote_id, description, quantity,
                                unit_sale_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='dev2'),
       'Goutte-à-goutte', 1, 50000, 20;

-- ---------- Les factures ----------
-- ÉMISE nº 1 : 1 000 € HT / 1 200 € TTC, ÉCHUE depuis 30 jours, réglée
-- à moitié (600 €).
--
-- LES LIGNES D'ABORD, L'ÉMISSION ENSUITE. `protect_issued_invoice_lines`
-- interdit de toucher aux lignes d'une facture déjà émise — c'est la
-- règle métier, et elle s'applique aussi à un jeu d'essai. On crée donc
-- la facture au brouillon, on la garnit, puis on l'émet.
insert into ids select 'fac1', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status,
                             issued_on, due_on)
select (select v from ids where k='fac1'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'FA-EPR-0001', 'draft',
       (select d from cfg where k='today') - 60, (select d from cfg where k='today') - 30;
insert into public.invoice_lines (organization_id, invoice_id, description, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fac1'),
       'Terrassement', 1, 100000, 20;
update public.invoices set status = 'partiallyPaid', issued_at = now()
where id = (select v from ids where k='fac1');

-- ÉMISE nº 2 : 500 € HT / 600 € TTC, échéance à venir, rien de réglé.
insert into ids select 'fac2', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status,
                             issued_on, due_on)
select (select v from ids where k='fac2'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'FA-EPR-0002', 'draft',
       (select d from cfg where k='today') - 5, (select d from cfg where k='today') + 25;
insert into public.invoice_lines (organization_id, invoice_id, description, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fac2'),
       'Arrosage', 1, 50000, 20;
update public.invoices set status = 'issued', issued_at = now()
where id = (select v from ids where k='fac2');

-- BROUILLON : 9 000 € HT. Elle ne doit entrer dans AUCUN total.
insert into ids select 'fac3', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status, issued_on)
select (select v from ids where k='fac3'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 'FA-EPR-BROUILLON', 'draft',
       (select d from cfg where k='today');
insert into public.invoice_lines (organization_id, invoice_id, description, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fac3'),
       'Ne doit pas compter', 1, 900000, 20;

-- ---------- Les règlements ----------
-- 600 € lettrés sur la facture nº 1.
insert into ids select 'pay1', gen_random_uuid();
insert into public.payments (id, organization_id, customer_id, amount_cents, method, received_on)
select (select v from ids where k='pay1'), (select v from ids where k='orgA'),
       (select v from ids where k='cli1'), 60000, 'transfer',
       (select d from cfg where k='today') - 40;
insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount_cents)
select (select v from ids where k='orgA'), (select v from ids where k='pay1'),
       (select v from ids where k='fac1'), 60000;

-- 250 € reçus et rattachés à AUCUNE facture — l'acompte. C'est l'écart
-- que la fonction doit rendre plutôt que fondre.
insert into public.payments (organization_id, customer_id, amount_cents, method, received_on)
select (select v from ids where k='orgA'), (select v from ids where k='cli1'), 25000, 'cash',
       (select d from cfg where k='today') - 2;

-- ---------- Un avoir de 120 € TTC sur la facture nº 2 ----------
insert into ids select 'av1', gen_random_uuid();
-- Même ordre que pour les factures : garnir, puis émettre.
insert into public.credit_notes (id, organization_id, invoice_id, customer_id, number, issued_on)
select (select v from ids where k='av1'), (select v from ids where k='orgA'),
       (select v from ids where k='fac2'), (select v from ids where k='cli1'), 'AV-EPR-0001',
       (select d from cfg where k='today') - 1;
insert into public.credit_note_lines (organization_id, credit_note_id, description,
                                      quantity, unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='av1'),
       'Geste commercial', 1, 10000, 20;
update public.credit_notes set issued_at = now() where id = (select v from ids where k='av1');

-- ---------- Les chantiers ----------
insert into public.projects (organization_id, customer_id, number, name, status, actual_end_on)
select (select v from ids where k='orgA'), (select v from ids where k='cli1'),
       'CH-EPR-0001', 'Jardin nord', 'completed', (select d from cfg where k='today') - 50;
insert into public.projects (organization_id, customer_id, number, name, status)
select (select v from ids where k='orgA'), (select v from ids where k='cli1'),
       'CH-EPR-0002', 'Jardin sud', 'inProgress';

create temp view v1 as
  select public.ai_customer_value((select v from ids where k='cli1')) as j;
create temp view v2 as
  select public.ai_customer_value((select v from ids where k='cli2')) as j;

-- ============================================================
-- 1. LES DEVIS
-- ============================================================

insert into res select '1a : deux devis au total', '2',
       (select j -> 'devis' ->> 'nombre' from v1);

insert into res select '1b : 1 500 € HT devisés, additionnés par le SQL', '150000',
       (select j -> 'devis' ->> 'totalHTCents' from v1);

insert into res select '1c : dont 1 000 € acceptés', '100000',
       (select j -> 'devis' ->> 'accepteHTCents' from v1);

insert into res select '1d : et 500 € encore en attente de réponse', '50000',
       (select j -> 'devis' ->> 'enAttenteHTCents' from v1);

-- ============================================================
-- 2. LES FACTURES — le brouillon ne compte nulle part
-- ============================================================

insert into res select '2a : deux factures ÉMISES', '2',
       (select j -> 'facturation' ->> 'nombreEmises' from v1);

insert into res select '2b : le brouillon est compté À PART', '1',
       (select j -> 'facturation' ->> 'brouillons' from v1);

-- Le test qui attrape la faute : 9 000 € de brouillon dans le total.
insert into res select '2c : et il n''entre PAS dans le total facturé', '150000',
       (select j -> 'facturation' ->> 'totalHTCents' from v1);

insert into res select '2d : le TTC est rendu à part du HT, pas déduit par le modèle', '180000',
       (select j -> 'facturation' ->> 'totalTTCCents' from v1);

insert into res select '2e : la première facture est datée', ((select d from cfg where k='today') - 60)::text,
       (select j -> 'facturation' ->> 'premiereLe' from v1);

-- ============================================================
-- 3. L'ARGENT REÇU N'EST PAS L'ARGENT LETTRÉ
-- ============================================================

insert into res select '3a : 850 € reçus du client au total', '85000',
       (select j -> 'reglement' ->> 'encaisseCents' from v1);

insert into res select '3b : dont 600 € seulement rattachés à une facture', '60000',
       (select j -> 'reglement' ->> 'lettreCents' from v1);

-- L'ACOMPTE. Les confondre ferait dire « il n'a rien payé » d'un client
-- dont l'argent est sur le compte.
insert into res select '3c : 250 € d''acompte ne sont lettrés nulle part', '25000',
       (select j -> 'reglement' ->> 'nonAffecteCents' from v1);

insert into res select '3d : l''avoir de 120 € TTC est rendu', '12000',
       (select j -> 'reglement' ->> 'avoirsCents' from v1);

-- Facture 1 : 1 200 TTC - 600 réglés = 600 dus. Facture 2 : 600 TTC -
-- 120 d'avoir = 480 dus. Total 1 080 €.
insert into res select '3e : le reste dû vient de invoice_balance, pas d''une soustraction du modèle', '108000',
       (select j -> 'reglement' ->> 'resteDuCents' from v1);

insert into res select '3f : 600 € sont ÉCHUS', '60000',
       (select j -> 'reglement' ->> 'enRetardCents' from v1);

insert into res select '3g : sur une seule facture', '1',
       (select j -> 'reglement' ->> 'enRetardNombre' from v1);

-- ============================================================
-- 4. UN CLIENT VIERGE — « rien » n'est pas « zéro »
-- ============================================================

insert into res select '4a : aucun devis, et le COMPTE vaut bien 0', '0',
       (select j -> 'devis' ->> 'nombre' from v2);

-- LA NUANCE : le compte est un fait vérifié, le total serait une
-- affirmation sur de l'argent qu'on n'a jamais chiffré.
insert into res select '4b : mais le TOTAL devisé vaut null, pas 0 €', 'null',
       (select coalesce(j -> 'devis' ->> 'totalHTCents', 'null') from v2);

insert into res select '4c : rien facturé : total null', 'null',
       (select coalesce(j -> 'facturation' ->> 'totalHTCents', 'null') from v2);

insert into res select '4d : rien encaissé : null, et surtout pas « il n''a pas payé »', 'null',
       (select coalesce(j -> 'reglement' ->> 'encaisseCents', 'null') from v2);

insert into res select '4e : rien dû non plus', 'null',
       (select coalesce(j -> 'reglement' ->> 'resteDuCents', 'null') from v2);

insert into res select '4f : et l''écart acompte / lettré ne s''invente pas à 0', 'null',
       (select coalesce(j -> 'reglement' ->> 'nonAffecteCents', 'null') from v2);

insert into res select '4g : la confiance tombe à « insufficient_data »', 'insufficient_data',
       (select j ->> 'confiance' from v2);

-- ============================================================
-- 5. LES TROIS DROITS — la raison d'être de cette épreuve
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000082-0000-4000-8000-0000000000c3')::text, true);
set local role authenticated;

create temp view vAmpute as
  select public.ai_customer_value((select v from ids where k='cli1')) as j;

insert into res select '5a : le client reste lisible avec clients.read seul', 'GRAND COMPTE',
       (select j -> 'client' ->> 'nom' from vAmpute);

-- LES QUATRE TESTS QUI COMPTENT LE PLUS DE CE FICHIER. Sans eux, ce
-- compte lirait « 0 € facturé, 0 € encaissé » et conclurait que le
-- client ne rapporte rien.
insert into res select '5b : les devis valent NULL en entier, pas 0', 'null',
       (select coalesce(j ->> 'devis', 'null') from vAmpute);

insert into res select '5c : la facturation aussi', 'null',
       (select coalesce(j ->> 'facturation', 'null') from vAmpute);

insert into res select '5d : les règlements aussi', 'null',
       (select coalesce(j ->> 'reglement', 'null') from vAmpute);

insert into res select '5e : les chantiers aussi', 'null',
       (select coalesce(j ->> 'chantiers', 'null') from vAmpute);

insert into res select '5f : et les trois droits manquants sont NOMMÉS', '3',
       (select jsonb_array_length(j -> 'droitsManquants') from vAmpute)::text;

insert into res select '5g : invoice.create est nommé', 'true',
       (select (j -> 'droitsManquants')::text like '%invoice.create%' from vAmpute)::text;

insert into res select '5h : quotes.read aussi', 'true',
       (select (j -> 'droitsManquants')::text like '%quotes.read%' from vAmpute)::text;

insert into res select '5i : projects.read aussi', 'true',
       (select (j -> 'droitsManquants')::text like '%projects.read%' from vAmpute)::text;

insert into res select '5j : et la confiance refuse de conclure', 'insufficient_data',
       (select j ->> 'confiance' from vAmpute);

-- ============================================================
-- 6. L'ANCIENNETÉ, LES CHANTIERS, ET CE QU'ON NE MESURE PAS
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

insert into res select '6a : 400 jours d''ancienneté, calculés par le SQL', '400',
       (select j -> 'client' ->> 'ancienneteJours' from v1);

-- L'ÉTAT EXACT DU SEUL CLIENT DE LA PRODUCTION : `converted_at` vide.
insert into res select '6b : sans converted_at, l''ancienneté est INCONNUE, pas nulle', 'null',
       (select coalesce(j -> 'client' ->> 'ancienneteJours', 'null') from v2);

insert into res select '6c : et la fonction dit pourquoi, plutôt que de se taire', 'true',
       (select (j -> 'client' ->> 'ancienneteNote') like '%INCONNUE%' from v2)::text;

insert into res select '6d : un chantier terminé', '1',
       (select j -> 'chantiers' ->> 'termines' from v1);

insert into res select '6e : un en cours', '1',
       (select j -> 'chantiers' ->> 'enCours' from v1);

insert into res select '6f : la satisfaction est déclarée ABSENTE du produit', 'true',
       (select (j -> 'nonMesurable' ->> 'satisfaction') like '%n''existe pas%' from v1)::text;

insert into res select '6g : et l''intervention signée est explicitement disqualifiée', 'true',
       (select (j -> 'nonMesurable' ->> 'satisfaction') like '%PAS un contentement%' from v1)::text;

insert into res select '6h : le risque de départ est déclaré incalculable', 'true',
       (select (j -> 'nonMesurable' ->> 'risqueDeDepart') is not null from v1)::text;

insert into res select '6i : et toute phrase de portefeuille est refusée', 'true',
       (select (j -> 'nonMesurable' ->> 'portefeuille') is not null from v1)::text;

insert into res select '6j : le jugement de bon payeur aussi', 'true',
       (select (j -> 'nonMesurable' ->> 'comportementDePaiement') is not null from v1)::text;

-- ============================================================
-- 7. LE CLOISONNEMENT
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000c2')::text, true);
set local role authenticated;

insert into ids select 'cliB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliB'), (select v from ids where k='orgB'),
       'CLIENT DE B', 'company', 'customer';

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

-- Le client de B doit être INTROUVABLE depuis A — et le message ne doit
-- pas confirmer qu'il existe ailleurs.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_customer_value((select v from ids where k='cliB'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('7a : le client de B est introuvable depuis A', 'true', refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_customer_value(gen_random_uuid());
  exception when others then refuse := true;
  end;
  insert into res values
    ('7b : un identifiant inventé lève, il ne rend pas une fiche vide', 'true', refuse::text);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;
