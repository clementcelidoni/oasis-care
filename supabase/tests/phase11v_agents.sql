-- Oasis Care — Phase 11V, LES QUATRE AGENTS (migration 0073).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LES TROIS CHIFFRES D'AFFAIRES SONT TROIS. Le jeu d'essai est
--      construit EXPRÈS pour qu'ils ne puissent pas coïncider : un
--      devis signé à 900 €, une facture émise à 2 500 € dont 200 € sont
--      annulés par un avoir, un règlement de 1 200 € TTC qui vaut
--      1 000 € HT. Quatre montants, quatre valeurs différentes. Un test
--      où deux d'entre eux tomberaient juste par hasard ne prouverait
--      rien — c'est précisément la confusion que la spec p. 18 met en
--      capitales.
--
--   2. UN DEVIS SANS COMPARABLE NE REND PAS DE FOURCHETTE. Trois façons
--      d'en manquer sont éprouvées : aucun chantier semblable, aucun
--      périmètre mesurable (pas d'heures devisées), et le droit de
--      lecture absent. Les trois rendent `insufficientData` et une
--      `fourchette` NULLE — pas une fourchette large, pas une
--      fourchette prudente.
--
--   3. UN CHANTIER SANS DEVIS NE FAUSSE PAS LA MARGE. Le jeu contient
--      un chantier terminé sans devis et 500 € de coûts. S'il entrait
--      dans le calcul « vendu 0 € », la marge tomberait de 2 000 € à
--      1 500 €. On vérifie les deux : la marge juste, ET le fait qu'il
--      soit compté à part.
--
--   4. LE CLOISONNEMENT. L'entreprise B a une facture de dix millions
--      dans la même période : si un seul filtre d'organisation manquait
--      quelque part, le chiffre d'affaires de A exploserait. Et depuis
--      la peau de B, les six fonctions d'entreprise de A sont refusées,
--      y compris l'analyse d'un devis de A — dont l'identifiant est
--      pourtant connu de l'appelant.
--
--   5. UN DROIT MANQUANT NE DEVIENT PAS UN ZÉRO. Un compte sans
--      `invoice.create` obtient `null` sur les blocs monétaires, le
--      droit manquant NOMMÉ, et un refus net là où une vue partielle
--      donnerait une réponse fausse.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les quatre comptes de test.
--
-- Pour le rejouer : jouer 0072 puis 0073 dans la même transaction,
-- puis ce fichier.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

-- Le repère de temps, calculé UNE FOIS et à Paris — comme 0066 l'a
-- imposé aux fonctions. Un test qui recalculerait « aujourd'hui » à
-- chaque ligne échouerait une nuit sur deux entre minuit et deux heures.
insert into cfg values ('today', (now() at time zone 'Europe/Paris')::date);

-- ============================================================
-- Fixtures — deux entreprises, quatre comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000073-0000-4000-8000-000000000073','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','p11v-agents-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000073-0000-4000-8000-000000000073','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','p11v-agents-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000073-0000-4000-8000-000000000073','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','p11v-agents-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000073-0000-4000-8000-000000000073')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Agents A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000073-0000-4000-8000-000000000073')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Agents B','landscaper');

-- LE COMPTE QUI VOIT LES CHANTIERS ET LES DEVIS, MAIS PAS L'ARGENT.
-- C'est le seul moyen d'isoler la quatrième règle du fichier : un droit
-- manquant doit produire `null` et non zéro.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000073-0000-4000-8000-000000000073', 'custom',
       array['projects.read','quotes.read']
from ids where k='orgA';

-- ---------- Le décor de A ----------
insert into ids select 'cliA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage,
                                  billing_city, billing_postal_code)
select (select v from ids where k='cliA'), (select v from ids where k='orgA'),
       'Villa Martin', 'individual', 'customer', 'Cannes', '06400';

insert into ids select 'empA', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empA'), (select v from ids where k='orgA'),
       'Jean', 'Ferrand', 10000;

insert into ids select 'catMO', gen_random_uuid();
insert into ids select 'catMat', gen_random_uuid();
insert into public.catalog_items (id, organization_id, item_type, name, unit)
select (select v from ids where k='catMO'), (select v from ids where k='orgA'), 'labor', 'Main-d''œuvre paysagiste', 'h';
insert into public.catalog_items (id, organization_id, item_type, name, unit)
select (select v from ids where k='catMat'), (select v from ids where k='orgA'), 'material', 'Fourniture', 'u';

-- L'OBJECTIF DE MARGE. Il couvre aujourd'hui : sans lui, aucun verdict
-- « insuffisant » n'est possible, et la fonction doit alors le dire
-- plutôt que d'inventer 35 %.
insert into public.organization_kpi_targets
  (organization_id, period_start, period_end, margin_target_pct, revenue_target_cents)
select v, (select d from cfg where k='today') - 30, (select d from cfg where k='today') + 30, 35, 1000000
from ids where k='orgA';

-- ============================================================
-- 1. Le jeu construit pour DISTINGUER signé, facturé et encaissé
-- ============================================================
-- Devis signé 900 € HT · facturé 2 500 € − 200 € d'avoir = 2 300 € HT ·
-- encaissé 1 200 € TTC, soit 1 000 € HT. Quatre nombres, quatre valeurs.

insert into ids select 'Q1', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, decided_at)
select (select v from ids where k='Q1'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-Q1', 'Élagage ponctuel', 'accepted',
       (select d from cfg where k='today') - 12, now() - interval '10 days';
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='Q1'), 1, 'Élagage', 'u', 1, 90000, 0, 20;

-- La facture : créée en brouillon, garnie, PUIS émise. Les lignes d'une
-- facture émise ne se modifient plus (0054), et l'ordre compte.
insert into ids select 'I1', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, status)
select (select v from ids where k='I1'), (select v from ids where k='orgA'), (select v from ids where k='cliA'), 'draft';
insert into public.invoice_lines (organization_id, invoice_id, position, description, unit, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='I1'), 1, 'Création jardin', 'u', 1, 250000, 20;
update public.invoices
   set number = 'FA-I1', status = 'issued',
       issued_on = (select d from cfg where k='today') - 5,
       issued_at = now() - interval '5 days',
       due_on = (select d from cfg where k='today') - 1
 where id = (select v from ids where k='I1');

insert into ids select 'CN1', gen_random_uuid();
insert into public.credit_notes (id, organization_id, invoice_id, customer_id, number, reason, issued_on, issued_at)
select (select v from ids where k='CN1'), (select v from ids where k='orgA'), (select v from ids where k='I1'),
       (select v from ids where k='cliA'), 'AV-1', 'Geste commercial',
       (select d from cfg where k='today') - 4, now() - interval '4 days';
insert into public.credit_note_lines (organization_id, credit_note_id, position, description, unit,
                                      quantity, unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='CN1'), 1, 'Remise', 'u', 1, 20000, 20;

insert into ids select 'PAY1', gen_random_uuid();
insert into public.payments (id, organization_id, customer_id, amount_cents, method, received_on, reference)
select (select v from ids where k='PAY1'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       120000, 'transfer', (select d from cfg where k='today') - 3, 'VIR-1';
insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount_cents)
select (select v from ids where k='orgA'), (select v from ids where k='PAY1'), (select v from ids where k='I1'), 120000;

-- ============================================================
-- 2. Le jeu construit pour la MARGE
-- ============================================================

-- PJ1 : chantier livré, devisé, chiffré, pointé. C'est le seul qui doit
-- entrer dans la marge réelle.
insert into ids select 'Q2', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, decided_at)
select (select v from ids where k='Q2'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-Q2', 'Création complète', 'accepted',
       (select d from cfg where k='today') - 400, now() - interval '400 days';
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='Q2'), 1, 'Création', 'u', 1, 500000, 250000, 20;

insert into ids select 'PJ1', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, quote_id, number, name, status, actual_end_on)
select (select v from ids where k='PJ1'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       (select v from ids where k='Q2'), 'CH-1', 'Villa Martin — création', 'handedOver',
       (select d from cfg where k='today') - 2;
insert into public.project_resources (organization_id, project_id, kind, description, unit,
                                      planned_quantity, planned_unit_cost_cents)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'material', 'Fournitures', 'u', 1, 150000;
insert into public.project_resources (organization_id, project_id, kind, description, unit,
                                      planned_quantity, planned_unit_cost_cents)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'labor', 'Équipe', 'h', 8, 10000;
insert into public.project_costs (organization_id, project_id, kind, description, unit, quantity,
                                  unit_cost_cents, incurred_on)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'material', 'Fournitures', 'u', 1, 200000,
       (select d from cfg where k='today') - 3;
insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgA'), (select v from ids where k='empA'), (select v from ids where k='PJ1'),
       (select d from cfg where k='today') - 3, 10, 10000, 'work', true;

-- PJ2 : LE CHANTIER SANS DEVIS. 500 € de coûts, aucun prix de vente
-- connu. Il ne vaut pas zéro : il sort du calcul.
insert into ids select 'PJ2', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status, actual_end_on)
select (select v from ids where k='PJ2'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-2', 'Dépannage arrosage', 'completed', (select d from cfg where k='today') - 2;
insert into public.project_costs (organization_id, project_id, kind, description, unit, quantity,
                                  unit_cost_cents, incurred_on)
select (select v from ids where k='orgA'), (select v from ids where k='PJ2'), 'material', 'Pièces', 'u', 1, 50000,
       (select d from cfg where k='today') - 3;

-- PJ3 : devisé mais pas encore réceptionné, avec un pointage en attente
-- et aucun coût arrêté. Il a un prix de vente, donc il compte dans le
-- périmètre, mais ni marge estimée ni marge réelle.
insert into ids select 'Q3', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, decided_at)
select (select v from ids where k='Q3'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-Q3', 'Terrasse bois', 'accepted',
       (select d from cfg where k='today') - 400, now() - interval '400 days';
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='Q3'), 1, 'Terrasse', 'u', 1, 200000, 0, 20;

insert into ids select 'PJ3', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, quote_id, number, name, status, actual_end_on)
select (select v from ids where k='PJ3'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       (select v from ids where k='Q3'), 'CH-3', 'Terrasse bois', 'completed',
       (select d from cfg where k='today') - 2;
insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgA'), (select v from ids where k='empA'), (select v from ids where k='PJ3'),
       (select d from cfg where k='today') - 3, 5, 10000, 'work', false;

-- ============================================================
-- 3. Le pipeline, les dépenses, les engagements
-- ============================================================

insert into ids select 'QP', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, sent_at, valid_until)
select (select v from ids where k='QP'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QP', 'Entretien annuel', 'sent', (select d from cfg where k='today') - 10,
       now() - interval '10 days', (select d from cfg where k='today') + 30;
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QP'), 1, 'Entretien', 'u', 1, 70000, 0, 20;

insert into ids select 'QE', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, sent_at, valid_until)
select (select v from ids where k='QE'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QE', 'Bassin', 'sent', (select d from cfg where k='today') - 2,
       now() - interval '2 days', (select d from cfg where k='today') + 3;
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QE'), 1, 'Bassin', 'u', 1, 55000, 0, 20;

insert into public.business_expenses (organization_id, description, amount_cents, vat_cents, spent_on)
select v, 'Carburant', 30000, 6000, (select d from cfg where k='today') - 2 from ids where k='orgA';

insert into ids select 'FOU', gen_random_uuid();
insert into public.suppliers (id, organization_id, name)
select (select v from ids where k='FOU'), (select v from ids where k='orgA'), 'Pépinière du Var';
insert into ids select 'PO1', gen_random_uuid();
insert into public.purchase_orders (id, organization_id, supplier_id, number, status, ordered_on, expected_on)
select (select v from ids where k='PO1'), (select v from ids where k='orgA'), (select v from ids where k='FOU'),
       'CF-1', 'sent', (select d from cfg where k='today') - 2, (select d from cfg where k='today') + 10;
insert into public.purchase_order_lines (organization_id, purchase_order_id, position, description, unit,
                                         quantity, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='PO1'), 1, 'Pittosporum C10', 'u', 1, 45000, 20;

-- Une intervention clôturée sans chantier : le produit n'a aucun lien
-- intervention → facture, elle doit donc sortir « à vérifier », sans
-- montant.
insert into public.field_interventions (organization_id, customer_id, kind, title, status,
                                        scheduled_start, scheduled_end, actual_end)
select v, (select v from ids where k='cliA'), 'maintenance', 'Passage entretien', 'done',
       now() - interval '5 days', now() - interval '5 days', now() - interval '5 days'
from ids where k='orgA';

-- ============================================================
-- 4. Le jeu des COMPARABLES
-- ============================================================
-- Six chantiers terminés, tous à 100 heures de main-d'œuvre devisées et
-- de famille dominante « labor », vendus de 8 000 € à 10 500 €. Chacun
-- porte une facture — sinon ils viendraient polluer le Billing Agent —
-- émise il y a cent jours, donc hors de la période mesurée.

do $$
declare
  v_org uuid := (select v from ids where k='orgA');
  v_cli uuid := (select v from ids where k='cliA');
  v_mo  uuid := (select v from ids where k='catMO');
  v_today date := (select d from cfg where k='today');
  v_prix bigint;
  v_q uuid; v_p uuid; v_i uuid;
  i int;
begin
  for i in 1..6 loop
    v_prix := 800000 + (i - 1) * 50000;
    v_q := gen_random_uuid(); v_p := gen_random_uuid(); v_i := gen_random_uuid();

    insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, decided_at)
    values (v_q, v_org, v_cli, 'DV-C' || i, 'Création comparable ' || i, 'accepted',
            v_today - 400, now() - interval '400 days');

    insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description,
                                    unit, quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
    values (v_org, v_q, v_mo, 1, 'Main-d''œuvre', 'h', 100, v_prix / 100, 3000, 20);

    insert into public.projects (id, organization_id, customer_id, quote_id, number, name, status, actual_end_on)
    values (v_p, v_org, v_cli, v_q, 'CH-C' || i, 'Comparable ' || i, 'handedOver', v_today - 100);

    insert into public.project_costs (organization_id, project_id, kind, description, unit, quantity,
                                      unit_cost_cents, incurred_on)
    values (v_org, v_p, 'labor', 'Main-d''œuvre', 'h', 1, v_prix / 2, v_today - 100);

    -- La facture qui les sort du périmètre à facturer. Émise il y a
    -- cent jours : elle n'entre pas dans le CA de la période mesurée.
    insert into public.invoices (id, organization_id, customer_id, quote_id, project_id, status)
    values (v_i, v_org, v_cli, v_q, v_p, 'draft');
    update public.invoices
       set number = 'FA-C' || i, status = 'paid',
           issued_on = v_today - 100, issued_at = now() - interval '100 days',
           due_on = v_today - 70
     where id = v_i;
  end loop;
end $$;

-- PJ4 : un chantier livré, facturé PAR SON DEVIS et non par le lien
-- chantier → facture. Les deux chemins existent dans ce produit, et un
-- Billing Agent qui n'en teste qu'un proposerait de refacturer celui-ci.
-- Daté d'il y a cent jours : il ne touche ni la marge de la période, ni
-- le chiffre d'affaires, ni les comparables (aucune heure devisée).
insert into ids select 'Q4', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, decided_at)
select (select v from ids where k='Q4'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-Q4', 'Haie de clôture', 'accepted',
       (select d from cfg where k='today') - 400, now() - interval '400 days';
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='Q4'), 1, 'Haie', 'u', 1, 300000, 0, 20;

insert into ids select 'PJ4', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, quote_id, number, name, status, actual_end_on)
select (select v from ids where k='PJ4'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       (select v from ids where k='Q4'), 'CH-4', 'Haie de clôture', 'handedOver',
       (select d from cfg where k='today') - 100;

insert into ids select 'I4', gen_random_uuid();
-- `project_id` volontairement NUL : seul le devis relie cette facture
-- au chantier.
insert into public.invoices (id, organization_id, customer_id, quote_id, status)
select (select v from ids where k='I4'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       (select v from ids where k='Q4'), 'draft';
update public.invoices
   set number = 'FA-Q4', status = 'paid',
       issued_on = (select d from cfg where k='today') - 100,
       issued_at = now() - interval '100 days',
       due_on = (select d from cfg where k='today') - 70
 where id = (select v from ids where k='I4');

-- QX : le devis à analyser. 10 000 € pour 7 000 € de coût, soit 30 % de
-- marque contre 35 % visés — insuffisant. Périmètre 100 h, famille
-- dominante « labor » : il a bien six comparables.
insert into ids select 'QX', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QX'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QX', 'Création à analyser', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QX'), (select v from ids where k='catMO'),
       1, 'Main-d''œuvre', 'h', 100, 6000, 4000, 20;
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QX'), (select v from ids where k='catMat'),
       2, 'Fournitures', 'u', 1, 400000, 300000, 20;

-- QY : même périmètre, prix double. Marge confortable, mais au-dessus
-- de TOUS les comparables.
insert into ids select 'QY', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QY'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QY', 'Création haut de gamme', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QY'), (select v from ids where k='catMO'),
       1, 'Main-d''œuvre', 'h', 100, 20000, 5000, 20;

-- QV : sous la cible de marge ET au-dessus de tous les comparables.
-- C'est le devis qui départage les deux verdicts : lequel l'emporte ?
insert into ids select 'QV', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QV'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QV', 'Création chère et peu rentable', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QV'), (select v from ids where k='catMO'),
       1, 'Main-d''œuvre', 'h', 100, 20000, 19000, 20;

-- QZ : aucune heure de main-d'œuvre devisée. Son périmètre est inconnu.
insert into ids select 'QZ', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QZ'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QZ', 'Fourniture seule', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QZ'), (select v from ids where k='catMat'),
       1, 'Fourniture', 'u', 1, 300000, 200000, 20;

-- QW : périmètre mesurable (500 h) mais aucun chantier comparable à
-- cette taille. C'est le cas de la spec p. 14.
insert into ids select 'QW', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QW'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QW', 'Grand chantier', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QW'), (select v from ids where k='catMO'),
       1, 'Main-d''œuvre', 'h', 500, 2000, 1000, 20;

-- QM : la moitié du devis est chiffrée en coût, l'autre non. La marge
-- calculée ne décrit alors qu'une moitié du devis, et l'écran doit
-- pouvoir le dire.
insert into ids select 'QM', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QM'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QM', 'Devis à moitié chiffré', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QM'), (select v from ids where k='catMO'),
       1, 'Main-d''œuvre', 'h', 100, 10000, 5000, 20;
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QM'), (select v from ids where k='catMat'),
       2, 'Fournitures non chiffrées', 'u', 1, 100000, 0, 20;

-- QN : aucun coût saisi nulle part. Le piège du DEFAULT 0 : sa marge ne
-- vaut pas 100 %, elle est INCONNUE.
insert into ids select 'QN', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
select (select v from ids where k='QN'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'DV-QN', 'Devis non chiffré en coût', 'draft', (select d from cfg where k='today');
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position, description, unit,
                                quantity, unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='QN'), (select v from ids where k='catMO'),
       1, 'Main-d''œuvre', 'h', 100, 5000, 0, 20;

-- ============================================================
-- 5. L'APPÂT : l'entreprise B, dans la même période
-- ============================================================
-- Dix millions d'euros de facture et un chantier terminé. Si un seul
-- filtre d'organisation manquait, le chiffre d'affaires de A le dirait.

insert into ids select 'cliB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliB'), (select v from ids where k='orgB'), 'Mairie de Vallauris', 'company', 'customer';

insert into ids select 'QB', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on, decided_at)
select (select v from ids where k='QB'), (select v from ids where k='orgB'), (select v from ids where k='cliB'),
       'DV-B1', 'Parc municipal', 'accepted', (select d from cfg where k='today') - 3, now() - interval '2 days';
insert into public.quote_lines (organization_id, quote_id, position, description, unit, quantity,
                                unit_sale_price_cents, unit_cost_cents, vat_rate)
select (select v from ids where k='orgB'), (select v from ids where k='QB'), 1, 'Parc', 'u', 1, 888888, 100000, 20;

insert into ids select 'IB', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, status)
select (select v from ids where k='IB'), (select v from ids where k='orgB'), (select v from ids where k='cliB'), 'draft';
insert into public.invoice_lines (organization_id, invoice_id, position, description, unit, quantity,
                                  unit_price_cents, vat_rate)
select (select v from ids where k='orgB'), (select v from ids where k='IB'), 1, 'Parc', 'u', 1, 1000000000, 20;
update public.invoices
   set number = 'FA-B1', status = 'issued',
       issued_on = (select d from cfg where k='today') - 5,
       issued_at = now() - interval '5 days',
       due_on = (select d from cfg where k='today') - 1
 where id = (select v from ids where k='IB');

insert into ids select 'PJB', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status, actual_end_on)
select (select v from ids where k='PJB'), (select v from ids where k='orgB'), (select v from ids where k='cliB'),
       'CH-B1', 'Parc municipal', 'completed', (select d from cfg where k='today') - 1;

-- ============================================================
-- LES QUESTIONS — dans la peau du patron de A
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000073-0000-4000-8000-000000000073')::text, true);
set local role authenticated;

create temp table snap(j jsonb) on commit drop;
insert into snap
select public.ai_finance_snapshot((select v from ids where k='orgA'),
         (select d from cfg where k='today') - 20, (select d from cfg where k='today'));

-- ---------- 1. Les trois chiffres d'affaires ----------

insert into res
select 'CA devis signé = 900 € HT','90000',
       (select j -> 'chiffreAffaires' ->> 'caDevisSigneHtCents' from snap);

insert into res
select 'CA facturé = 2 500 € émis moins 200 € d''avoir','230000',
       (select j -> 'chiffreAffaires' ->> 'caFactureHtCents' from snap);

insert into res
select 'Les factures émises, séparément','250000',
       (select j -> 'chiffreAffaires' ->> 'facturesEmisesHtCents' from snap);

insert into res
select 'Les avoirs émis, séparément','20000',
       (select j -> 'chiffreAffaires' ->> 'avoirsEmisHtCents' from snap);

insert into res
select 'CA encaissé, TTC, tel qu''il est reçu','120000',
       (select j -> 'chiffreAffaires' ->> 'caEncaisseTtcCents' from snap);

-- LE CALCUL QUI NE PEUT PAS ÊTRE DEVINÉ : 1 200 € TTC réglés sur une
-- facture de 2 500 € HT / 3 000 € TTC valent 1 000 € HT.
insert into res
select 'CA encaissé ramené au HT, au prorata de la facture réglée','100000',
       (select j -> 'chiffreAffaires' ->> 'caEncaisseHtCents' from snap);

insert into res
select 'Aucun règlement non affecté','0',
       (select j -> 'chiffreAffaires' ->> 'encaisseNonAffecteTtcCents' from snap);

-- LE TEST QUI COMPTE VRAIMENT : les quatre valeurs sont bien QUATRE.
-- Un jeu où deux d'entre elles coïncideraient ne prouverait rien.
insert into res
select 'Signé, facturé, encaissé TTC et encaissé HT : quatre valeurs distinctes','4',
       (select count(distinct x)::text from (
          select (j -> 'chiffreAffaires' ->> 'caDevisSigneHtCents')::bigint as x from snap
          union all select (j -> 'chiffreAffaires' ->> 'caFactureHtCents')::bigint from snap
          union all select (j -> 'chiffreAffaires' ->> 'caEncaisseTtcCents')::bigint from snap
          union all select (j -> 'chiffreAffaires' ->> 'caEncaisseHtCents')::bigint from snap) q);

-- ---------- 2. Le reste de la photo ----------

insert into res
select 'Pipeline : les deux devis envoyés sans réponse','125000',
       (select j -> 'pipelineDevis' ->> 'montantHtCents' from snap);

insert into res
select 'Carnet de commandes : trois devis signés non facturés','790000',
       (select j -> 'carnetDeCommandes' ->> 'signeNonFactureHtCents' from snap);

insert into res
select 'Créances : reste dû après règlement et avoir','156000',
       (select j -> 'creances' ->> 'resteDuTtcCents' from snap);

insert into res
select 'Une facture en retard, et une seule','1',
       (select j -> 'creances' ->> 'facturesEnRetard' from snap);

insert into res
select 'Engagements fournisseurs : la commande envoyée','45000',
       (select j -> 'engagementsFournisseurs' ->> 'montantHtCents' from snap);

insert into res
select 'Dépenses générales HT de la période','30000',
       (select j -> 'depenses' ->> 'generalesHtCents' from snap);

insert into res
select 'Trésorerie : 1 200 € entrés, 360 € sortis','84000',
       (select j -> 'tresorerie' ->> 'soldePeriodeCents' from snap);

insert into res
select 'L''objectif de marge est lu depuis la période en cours','35.00',
       (select j -> 'objectifs' ->> 'margeCiblePct' from snap);

-- ---------- 3. La marge, et le chantier sans devis ----------

insert into res
select 'Marge chantier de la période : seul PJ1 la compose','200000',
       (select j -> 'margeChantier' ->> 'margeCents' from snap);

insert into res
select 'Un chantier terminé sans devis est compté à part','1',
       (select j -> 'margeChantier' ->> 'chantiersSansDevis' from snap);

insert into res
select 'Un chantier terminé sans aucun coût saisi aussi','1',
       (select j -> 'margeChantier' ->> 'chantiersSansCoutReel' from snap);

-- LES DEUX FONCTIONS DE MARGE DE CE FICHIER DOIVENT S'ACCORDER. Une
-- photo et son détail qui annoncent deux marges différentes ruinent la
-- confiance dans les deux ; c'est ce qu'a attrapé la première version
-- de ce test, où la photo comptait un chantier sans coût à 100 % de
-- marge.
insert into res
select 'La photo et le détail annoncent la MÊME marge chantier','true',
       ((select j -> 'margeChantier' ->> 'margeCents' from snap)
        = (public.ai_finance_margin_breakdown((select v from ids where k='orgA'),
             (select d from cfg where k='today') - 20, (select d from cfg where k='today'))
           -> 'global' ->> 'margeReelleCents'))::text;

-- LE PIÈGE DE `margin_percent`, ISOLÉ. Elle traite un coût inconnu
-- comme un coût nul, ce qui donne 100 % de marge ; `ai_margin_pct`
-- existe pour que cette confusion ne se réintroduise pas.
insert into res
select 'margin_percent traite un coût inconnu comme zéro','100.00',
       public.margin_percent(null, 500000)::text;
insert into res
select 'ai_margin_pct, elle, refuse de conclure','true',
       (public.ai_margin_pct(null, 500000) is null)::text;

create temp table brk(j jsonb) on commit drop;
insert into brk
select public.ai_finance_margin_breakdown((select v from ids where k='orgA'),
         (select d from cfg where k='today') - 20, (select d from cfg where k='today'), 'chantier');

insert into res
select 'Périmètre : trois chantiers terminés','3',
       (select j -> 'perimetre' ->> 'chantiersTermines' from brk);

insert into res
select 'Un chantier sans devis, exclu et compté','1',
       (select j -> 'perimetre' ->> 'chantiersSansDevis' from brk);

insert into res
select 'Chantiers mesurés : PJ1 et PJ3','2',
       (select j -> 'perimetre' ->> 'chantiersMesures' from brk);

insert into res
select 'Un chantier mesuré n''a aucun coût réel saisi','1',
       (select j -> 'perimetre' ->> 'chantiersSansCoutReel' from brk);

insert into res
select 'Un chantier mesuré n''a aucun coût estimé','1',
       (select j -> 'perimetre' ->> 'chantiersSansCoutEstime' from brk);

-- LE TEST DU CHANTIER SANS DEVIS. S'il entrait « vendu 0 € » avec ses
-- 500 € de coûts, la marge tomberait à 150 000 centimes.
insert into res
select 'La marge réelle ignore le chantier sans devis','200000',
       (select j -> 'global' ->> 'margeReelleCents' from brk);

insert into res
select 'Taux de marque réel de la période','40.00',
       (select j -> 'global' ->> 'tauxMarqueReelPct' from brk);

-- Coût estimé = les RESSOURCES prévues (150 000 + 80 000), pas le coût
-- du devis (250 000) : les ressources sont plus proches du chantier.
insert into res
select 'La marge estimée s''appuie sur les ressources prévues','270000',
       (select j -> 'global' ->> 'margeEstimeeCents' from brk);

insert into res
select 'L''écart entre marge réelle et marge estimée, en points','-14.00',
       (select j -> 'global' ->> 'ecartPoints' from brk);

insert into res
select 'La première cause d''écart est la famille « material »','material',
       (select j -> 'causesEcart' -> 0 ->> 'famille' from brk);

insert into res
select 'Elle pèse 500 € de dépassement','50000',
       (select j -> 'causesEcart' -> 0 ->> 'ecartCents' from brk);

insert into res
select 'Les heures : 8 prévues, 10 pointées, +25 %','25.0',
       (select j -> 'heures' ->> 'ecartPct' from brk);

-- Le regroupement par chantier ne rend que les chantiers MESURÉS.
insert into res
select 'Le tableau par chantier ne contient que les mesurés','2',
       (select jsonb_array_length(j -> 'parDimension')::text from brk);

-- Une dimension déduite le DIT. Ce n'est pas cosmétique : « par
-- commercial » veut dire « par auteur du devis », et l'écran doit
-- pouvoir l'écrire.
insert into res
select 'La dimension « chantier » n''est pas une approximation','false',
       (select j ->> 'dimensionApproximee' from brk);

insert into res
select 'La dimension « service » est une approximation, et le dit','true',
       (public.ai_finance_margin_breakdown((select v from ids where k='orgA'),
          (select d from cfg where k='today') - 20, (select d from cfg where k='today'), 'service')
        ->> 'dimensionApproximee');

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_finance_margin_breakdown((select v from ids where k='orgA'), null, null, 'lune');
  exception when others then refuse := true;
  end;
  insert into res values ('Une dimension inconnue est refusée','true',refuse::text);
end $$;

-- ---------- 4. Le Billing Agent ----------

create temp table bill(j jsonb) on commit drop;
insert into bill select public.ai_billing_candidates((select v from ids where k='orgA'));

insert into res
select 'Cinq dossiers facturables détectés','5',
       (select j -> 'resume' ->> 'total' from bill);

insert into res
select 'Un seul est prêt','1',
       (select j -> 'resume' ->> 'prets' from bill);

insert into res
select 'Trois demandent une vérification','3',
       (select j -> 'resume' ->> 'aVerifier' from bill);

insert into res
select 'Un est bloqué faute de devis','1',
       (select j -> 'resume' ->> 'bloques' from bill);

insert into res
select 'Le montant prêt à facturer','500000',
       (select j -> 'resume' ->> 'montantPretHtCents' from bill);

insert into res
select 'Le montant à facturer après vérification','290000',
       (select j -> 'resume' ->> 'montantAVerifierHtCents' from bill);

-- CE COMPTE EST LE GARDE-FOU DU TOTAL. Sans lui, « 5 000 € prêts »
-- laisserait croire que la somme couvre les cinq dossiers.
insert into res
select 'Deux dossiers n''ont aucun montant, et c''est dit','2',
       (select j -> 'resume' ->> 'dossiersSansMontant' from bill);

insert into res
select 'Le chantier sans devis est bloqué, pas chiffré à zéro','true',
       (select (e.value -> 'montantFacturableHtCents' = 'null'::jsonb)::text
        from bill, jsonb_array_elements(j -> 'candidats') e
        where e.value ->> 'entiteId' = (select v from ids where k='PJ2')::text);

insert into res
select 'Et son motif le dit','devisAbsent',
       (select e.value -> 'motifs' -> 0 ->> 'code'
        from bill, jsonb_array_elements(j -> 'candidats') e
        where e.value ->> 'entiteId' = (select v from ids where k='PJ2')::text);

insert into res
select 'Le chantier non réceptionné cumule ses trois réserves','3',
       (select jsonb_array_length(e.value -> 'motifs')::text
        from bill, jsonb_array_elements(j -> 'candidats') e
        where e.value ->> 'entiteId' = (select v from ids where k='PJ3')::text);

insert into res
select 'Le chantier livré et chiffré est prêt','pret',
       (select e.value ->> 'statut'
        from bill, jsonb_array_elements(j -> 'candidats') e
        where e.value ->> 'entiteId' = (select v from ids where k='PJ1')::text);

-- Les six chantiers comparables SONT facturés : ils ne doivent pas
-- réapparaître. C'est le test du double chemin facture → chantier et
-- facture → devis.
insert into res
select 'Un chantier facturé par son devis ne réapparaît pas','0',
       (select count(*)::text
        from bill, jsonb_array_elements(j -> 'candidats') e
        where e.value ->> 'libelle' like 'CH-C%');

-- LE CHEMIN QUE L'ON OUBLIE. La facture de PJ4 ne porte pas de
-- `project_id` : seul le devis la relie au chantier. Un test qui ne
-- vérifierait que le lien direct laisserait passer une proposition de
-- refacturation.
insert into res
select 'Un chantier facturé PAR SON SEUL DEVIS ne réapparaît pas non plus','0',
       (select count(*)::text
        from bill, jsonb_array_elements(j -> 'candidats') e
        where e.value ->> 'entiteId' = (select v from ids where k='PJ4')::text);

insert into res
select 'La facture en retard est vue, avec son reste dû','156000',
       (select j -> 'facturesEnRetard' -> 'resume' ->> 'resteDuTtcCents' from bill);

-- LES DEUX FAMILLES QUE LE MODÈLE NE SAIT PAS VOIR. Dites, pas comptées
-- à zéro : « rien à faire » et « je ne sais pas regarder » sont deux
-- phrases différentes.
insert into res
select 'Les acomptes sont déclarés non couverts, pas comptés à zéro','false',
       (select j -> 'nonCouvert' -> 'acomptes' ->> 'disponible' from bill);

insert into res
select 'Les situations de travaux aussi','modeleDeDonneesAbsent',
       (select j -> 'nonCouvert' -> 'situations' ->> 'motif' from bill);

-- ---------- 5. Le Quote Pricing Agent ----------

create temp table qx(j jsonb) on commit drop;
insert into qx select public.ai_quote_price_analysis((select v from ids where k='QX'));

insert into res
select 'QX : prix proposé','1000000', (select j ->> 'prixProposeHtCents' from qx);
insert into res
select 'QX : coût estimé','700000', (select j ->> 'coutEstimeCents' from qx);
insert into res
select 'QX : taux de marque','30.00', (select j ->> 'tauxMarquePct' from qx);
insert into res
select 'QX : la cible de l''entreprise','35.00', (select j ->> 'margeCiblePct' from qx);
insert into res
select 'QX : verdict de marge','insuffisant', (select j ->> 'verdictMarge' from qx);
insert into res
select 'QX : le manque à gagner est chiffré','50000', (select j ->> 'manqueAGagnerCents' from qx);
insert into res
select 'QX : six comparables trouvés','6', (select j -> 'comparables' ->> 'nombreComparables' from qx);
insert into res
select 'QX : la fourchette basse','800000', (select j -> 'comparables' -> 'fourchette' ->> 'minHtCents' from qx);
insert into res
select 'QX : la fourchette haute','1050000', (select j -> 'comparables' -> 'fourchette' ->> 'maxHtCents' from qx);
insert into res
select 'QX : le prix reste dans la fourchette','dansLaFourchette', (select j ->> 'verdictComparables' from qx);
-- L'ORDRE DES VERDICTS : sous la cible, le devis est insuffisant même
-- s'il est au tarif habituel. Perdre de l'argent au prix du marché
-- reste perdre de l'argent.
insert into res
select 'QX : le verdict global retient l''insuffisance de marge','insuffisant', (select j ->> 'verdict' from qx);

insert into res
select 'QY : marge confortable mais au-dessus de tous les comparables','auDessusDesComparables',
       (public.ai_quote_price_analysis((select v from ids where k='QY')) ->> 'verdict');

-- QV CUMULE LES DEUX DÉFAUTS, et l'ordre des verdicts compte : perdre
-- de l'argent au tarif habituel reste perdre de l'argent, donc la marge
-- insuffisante l'emporte sur « au-dessus des comparables ».
create temp table qv(j jsonb) on commit drop;
insert into qv select public.ai_quote_price_analysis((select v from ids where k='QV'));

insert into res
select 'QV : sa marge est insuffisante','insuffisant', (select j ->> 'verdictMarge' from qv);
insert into res
select 'QV : et son prix dépasse tous les comparables','auDessus', (select j ->> 'verdictComparables' from qv);
insert into res
select 'QV : le verdict global retient la marge, pas le prix','insuffisant',
       (select j ->> 'verdict' from qv);

-- LE TEST DE LA PAGE 14. Aucun comparable → pas de fourchette. Pas une
-- fourchette large : PAS DE FOURCHETTE.
create temp table qw(j jsonb) on commit drop;
insert into qw select public.ai_quote_comparables((select v from ids where k='QW'));

insert into res
select 'QW : aucun chantier de cette taille','0', (select j ->> 'nombreComparables' from qw);
insert into res
select 'QW : la confiance est « insufficient_data »','insufficient_data', (select j ->> 'confiance' from qw);
insert into res
select 'QW : le motif est nommé','tropPeuDeComparables', (select j ->> 'motifInsuffisance' from qw);
insert into res
select 'QW : AUCUNE fourchette n''est rendue','true',
       (select (j -> 'fourchette' = 'null'::jsonb)::text from qw);
insert into res
select 'QW : aucun échantillon non plus','0',
       (select jsonb_array_length(j -> 'echantillon')::text from qw);
insert into res
select 'QW : et le verdict de comparaison le répercute','insufficientData',
       (public.ai_quote_price_analysis((select v from ids where k='QW')) ->> 'verdictComparables');

-- Sans heures devisées, le périmètre est inconnu : on ne compare pas un
-- jardin à une taille de haie.
insert into res
select 'QZ : sans heures devisées, le périmètre est inconnu','perimetreInconnu',
       (public.ai_quote_comparables((select v from ids where k='QZ')) ->> 'motifInsuffisance');
insert into res
select 'QZ : et aucune fourchette n''est rendue','true',
       ((public.ai_quote_comparables((select v from ids where k='QZ')) -> 'fourchette' = 'null'::jsonb)::text);

-- LE PIÈGE DU « DEFAULT 0 ». Un devis sans coût saisi n'a pas 100 % de
-- marge : il a une marge inconnue.
create temp table qn(j jsonb) on commit drop;
insert into qn select public.ai_quote_price_analysis((select v from ids where k='QN'));

insert into res
select 'QN : un devis sans coût saisi n''a pas de coût, pas un coût nul','true',
       (select (j -> 'coutEstimeCents' = 'null'::jsonb)::text from qn);
insert into res
select 'QN : sa marge n''est donc pas 100 %','true',
       (select (j -> 'tauxMarquePct' = 'null'::jsonb)::text from qn);
insert into res
select 'QN : le verdict est « données insuffisantes »','insufficientData',
       (select j ->> 'verdict' from qn);
insert into res
select 'QN : sa ligne sans coût saisi est comptée','1',
       (select j -> 'lignes' ->> 'sansCoutSaisi' from qn);

-- UN DEVIS À MOITIÉ CHIFFRÉ. Le cas le plus fréquent sur les données
-- réelles — treize lignes sur quatorze sans coût — et le plus
-- trompeur : la marge affichée ne décrit que les lignes chiffrées.
create temp table qm(j jsonb) on commit drop;
insert into qm select public.ai_quote_price_analysis((select v from ids where k='QM'));

insert into res
select 'QM : le coût est déclaré partiel','true',
       (select j -> 'lignes' ->> 'coutPartiel' from qm);
insert into res
select 'QM : la confiance chute pour cette raison','low',
       (select j ->> 'confiance' from qm);
insert into res
select 'QM : et la conclusion le dit en toutes lettres','true',
       (select (j -> 'explication' ->> 'conclusion' like '%ne portent aucun coût%')::text from qm);
insert into res
select 'QX, lui, est entièrement chiffré','false',
       (select j -> 'lignes' ->> 'coutPartiel' from qx);

-- Le déplacement est EXPOSÉ, pas calculé.
insert into res
select 'Le déplacement est renvoyé à un autre agent','true',
       (select j -> 'deplacement' ->> 'calculeParUnAutreAgent' from qx);
insert into res
select 'L''effectif n''est pas inventé','true',
       (select (j -> 'deplacement' -> 'effectifPrevu' = 'null'::jsonb)::text from qx);
insert into res
select 'La ville du chantier est exposée pour le calcul','Cannes',
       (select j -> 'deplacement' -> 'chantier' ->> 'ville' from qx);

-- ---------- 6. L'Executive Agent et le Daily ----------

create temp table brief(j jsonb) on commit drop;
insert into brief select public.ai_executive_brief((select v from ids where k='orgA'));

insert into res
select 'Six candidats analysés','6', (select j ->> 'candidatsAnalyses' from brief);
insert into res
select 'Cinq actions prioritaires, pas six','5',
       (select jsonb_array_length(j -> 'actionsPrioritaires')::text from brief);
insert into res
select 'La première est de facturer le dossier prêt','billing',
       (select j -> 'actionsPrioritaires' -> 0 ->> 'agent' from brief);
insert into res
select 'Avec son impact chiffré','500000',
       (select j -> 'actionsPrioritaires' -> 0 ->> 'impactCents' from brief);
insert into res
select 'Et l''action du catalogue qui va avec','createInvoiceDraft',
       (select j -> 'actionsPrioritaires' -> 0 -> 'actionsDisponibles' ->> 0 from brief);
insert into res
select 'Chaque action dit ce qui arrive si rien n''est fait','5',
       (select count(*)::text from brief, jsonb_array_elements(j -> 'actionsPrioritaires') e
        where e.value ->> 'siRienNestFait' is not null);
insert into res
select 'Le patron n''a aucun droit manquant','0',
       (select jsonb_array_length(j -> 'droitsManquants')::text from brief);

create temp table daily(j jsonb) on commit drop;
insert into daily select public.ai_oasis_daily((select v from ids where k='orgA'));

insert into res
select 'Le Daily s''ouvre sur une salutation','Bonjour', (select j ->> 'salutation' from daily);
-- LA DATE VIENT DE `ai_get_daily_priorities`, corrigée en 0066 pour le
-- fuseau de Paris. Un second calcul ici rouvrirait le bug de la nuit.
insert into res
select 'La date du Daily est celle de Paris',
       (select d::text from cfg where k='today'),
       (select j ->> 'date' from daily);
insert into res
select 'Le Daily a une rubrique URGENT','URGENT',
       (select e.value ->> 'code' from daily, jsonb_array_elements(j -> 'rubriques') e
        where e.value ->> 'code' = 'URGENT');
insert into res
select 'Une rubrique vide ne s''affiche pas','0',
       (select count(*)::text from daily, jsonb_array_elements(j -> 'rubriques') e
        where jsonb_array_length(e.value -> 'elements') = 0);
insert into res
select 'Les pointages en attente sont au planning, avec leur raison','1',
       (select count(*)::text from daily, jsonb_array_elements(j -> 'rubriques') r,
             jsonb_array_elements(r.value -> 'elements') e
        where r.value ->> 'code' = 'PLANNING' and e.value ->> 'titre' like '%pointage%');

-- ============================================================
-- LA CEINTURE, SANS LES BRETELLES
-- ============================================================
-- Les six tests de cloisonnement qui suivent passent grâce à la RLS.
-- Ils passeraient donc AUSSI si les fonctions avaient oublié leur
-- filtre `organization_id = p_organization_id` — et le jour où une
-- politique RLS est assouplie par mégarde, personne ne le verrait.
--
-- On repasse donc en superutilisateur, où la RLS ne filtre plus rien,
-- en gardant la session du patron de A pour que `ai_guard` réponde oui.
-- Ce qui reste, c'est le filtre explicite. Et l'appât est là : dix
-- millions d'euros de facture chez B, dans la même période.

reset role;

insert into res
select 'Sans RLS, le filtre explicite tient le CA facturé','230000',
       (public.ai_finance_snapshot((select v from ids where k='orgA'),
          (select d from cfg where k='today') - 20, (select d from cfg where k='today'))
        -> 'chiffreAffaires' ->> 'caFactureHtCents');

insert into res
select 'Sans RLS, le périmètre de marge reste celui de A','3',
       (public.ai_finance_margin_breakdown((select v from ids where k='orgA'),
          (select d from cfg where k='today') - 20, (select d from cfg where k='today'))
        -> 'perimetre' ->> 'chantiersTermines');

insert into res
select 'Sans RLS, le devis signé de B n''entre pas dans celui de A','90000',
       (public.ai_finance_snapshot((select v from ids where k='orgA'),
          (select d from cfg where k='today') - 20, (select d from cfg where k='today'))
        -> 'chiffreAffaires' ->> 'caDevisSigneHtCents');

-- ============================================================
-- LE CLOISONNEMENT — dans la peau du patron de B
-- ============================================================
-- B a une facture de dix millions d'euros émise dans la même période.
-- Si le chiffre d'affaires de A ne l'a pas vue, aucun filtre ne manque.

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000073-0000-4000-8000-000000000073')::text, true);
set local role authenticated;

-- CONTRÔLE POSITIF, et il est indispensable : sans lui, les six refus
-- qui suivent prouveraient seulement que tout échoue chez B.
insert into res
select 'B voit bien SA facture de dix millions','1000000000',
       (public.ai_finance_snapshot((select v from ids where k='orgB'),
          (select d from cfg where k='today') - 20, (select d from cfg where k='today'))
        -> 'chiffreAffaires' ->> 'caFactureHtCents');

do $$
declare refuse boolean := false;
begin
  begin perform public.ai_finance_snapshot((select v from ids where k='orgA'));
  exception when others then refuse := true; end;
  insert into res values ('B ne peut pas lire la photo financière de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin perform public.ai_finance_margin_breakdown((select v from ids where k='orgA'));
  exception when others then refuse := true; end;
  insert into res values ('B ne peut pas lire la marge de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin perform public.ai_billing_candidates((select v from ids where k='orgA'));
  exception when others then refuse := true; end;
  insert into res values ('B ne peut pas lire ce que A doit facturer','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin perform public.ai_executive_brief((select v from ids where k='orgA'));
  exception when others then refuse := true; end;
  insert into res values ('B n''obtient pas le brief de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin perform public.ai_oasis_daily((select v from ids where k='orgA'));
  exception when others then refuse := true; end;
  insert into res values ('B n''obtient pas le Daily de A','true',refuse::text);
end $$;

-- LE CAS LE MOINS ÉVIDENT : l'identifiant du devis de A est connu de
-- l'appelant, et il ne suffit pas. L'organisation est relue sur la
-- ligne, la RLS masque la ligne, le devis est « introuvable » — la même
-- réponse que pour un devis qui n'existe pas.
do $$
declare refuse boolean := false;
begin
  begin perform public.ai_quote_price_analysis((select v from ids where k='QX'));
  exception when others then refuse := true; end;
  insert into res values ('B ne peut pas analyser le prix d''un devis de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin perform public.ai_quote_comparables((select v from ids where k='QX'));
  exception when others then refuse := true; end;
  insert into res values ('B n''obtient pas les comparables d''un devis de A','true',refuse::text);
end $$;

-- Et dans l'autre sens : les comparables de B ne contiennent aucun
-- chantier de A, alors que A en a six qui feraient l'affaire.
insert into res
select 'Les comparables de B ignorent les six chantiers de A','0',
       (public.ai_quote_comparables((select v from ids where k='QB')) ->> 'nombreComparables');

-- « CORRECT » N'EST PAS LE VERDICT PAR DÉFAUT. B n'a fixé aucun
-- objectif de marge : son devis à 88 % de marque ne peut pas être dit
-- « conforme », faute de règle à laquelle se conformer. C'est le cas de
-- TOUS les devis d'une entreprise qui n'a pas rempli ses objectifs —
-- c'est-à-dire de la seule entreprise réelle de cette base aujourd'hui.
create temp table qb(j jsonb) on commit drop;
insert into qb select public.ai_quote_price_analysis((select v from ids where k='QB'));

insert into res
select 'Sans objectif de marge, la cible est nulle et non pas 35 %','true',
       (select (j -> 'margeCiblePct' = 'null'::jsonb)::text from qb);
insert into res
select 'Le verdict de marge le dit','cibleNonDefinie', (select j ->> 'verdictMarge' from qb);
insert into res
select 'Et le verdict global ne conclut pas « correct »','cibleNonDefinie',
       (select j ->> 'verdict' from qb);

-- ============================================================
-- LE DROIT MANQUANT — dans la peau du conducteur de travaux de A
-- ============================================================
-- Il voit les chantiers et les devis, pas l'argent. Le piège serait de
-- lui répondre « 0 € facturé ce mois » : la RLS masque les factures, et
-- `sum()` sur zéro ligne visible rend zéro sans la moindre erreur.

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000073-0000-4000-8000-000000000073')::text, true);
set local role authenticated;

create temp table snapc(j jsonb) on commit drop;
insert into snapc
select public.ai_finance_snapshot((select v from ids where k='orgA'),
         (select d from cfg where k='today') - 20, (select d from cfg where k='today'));

insert into res
select 'Sans le droit de facturer, le CA facturé est NUL — pas zéro','true',
       (select (j -> 'chiffreAffaires' -> 'caFactureHtCents' = 'null'::jsonb)::text from snapc);

insert into res
select 'Le droit manquant est NOMMÉ','invoice.create',
       (select j -> 'droitsManquants' ->> 0 from snapc);

insert into res
select 'La confiance chute à « insufficient_data »','insufficient_data',
       (select j ->> 'confiance' from snapc);

-- Ce qu'il a le droit de voir, il le voit : la fonction n'est pas
-- devenue aveugle, elle est devenue honnête.
insert into res
select 'Le CA signé, lui, reste lisible','90000',
       (select j -> 'chiffreAffaires' ->> 'caDevisSigneHtCents' from snapc);

insert into res
select 'Les créances sont nulles, pas à zéro','true',
       (select (j -> 'creances' -> 'resteDuTtcCents' = 'null'::jsonb)::text from snapc);

-- LE REFUS NET. Sans `invoice.create`, « ce chantier n'a pas de
-- facture » est VRAI POUR TOUS : la réponse serait fausse, pas
-- partielle. La fonction préfère l'erreur.
do $$
declare refuse boolean := false;
begin
  begin perform public.ai_billing_candidates((select v from ids where k='orgA'));
  exception when others then refuse := true; end;
  insert into res values ('Le Billing Agent REFUSE de répondre sans le droit de facturer','true',refuse::text);
end $$;

-- Le brief, lui, dégrade : il reste une réponse à « que dois-je faire
-- aujourd'hui ».
create temp table briefc(j jsonb) on commit drop;
insert into briefc select public.ai_executive_brief((select v from ids where k='orgA'));

insert into res
select 'Le brief reste rendu, amputé et le disant','invoice.create',
       (select j -> 'droitsManquants' ->> 0 from briefc);

insert into res
select 'Aucune recommandation de facturation n''y figure','0',
       (select count(*)::text from briefc, jsonb_array_elements(j -> 'actionsPrioritaires') e
        where e.value ->> 'agent' = 'billing');

insert into res
select 'Mais les devis à relancer, si','1',
       (select count(*)::text from briefc, jsonb_array_elements(j -> 'actionsPrioritaires') e
        where e.value ->> 'titre' like 'Relancer % devis sans réponse');

-- La marge reste lisible pour lui : il a `projects.read` et
-- `quotes.read`, qui sont exactement ce qu'elle demande.
insert into res
select 'La marge reste calculable pour le conducteur de travaux','200000',
       (public.ai_finance_margin_breakdown((select v from ids where k='orgA'),
          (select d from cfg where k='today') - 20, (select d from cfg where k='today'))
        -> 'global' ->> 'margeReelleCents');

-- Mais pas par client : nommer les clients demande `clients.read`, et
-- rendre quatorze lignes « Client inconnu » serait trompeur.
do $$
declare refuse boolean := false;
begin
  begin perform public.ai_finance_margin_breakdown((select v from ids where k='orgA'), null, null, 'client');
  exception when others then refuse := true; end;
  insert into res values ('La marge par client exige le droit de lire les clients','true',refuse::text);
end $$;

reset role;

-- Vérifié UNE FOIS SORTI de la peau des autres : les fonctions n'ont
-- rien écrit. Ce sont des lectures, et le rester est une propriété.
insert into res
select 'Aucune décision n''a été ouverte par ces sept fonctions','0',
       (select count(*)::text from public.ai_decisions
        where organization_id in (select v from ids where k in ('orgA','orgB')));

insert into res
select 'Aucune action n''a été créée non plus','0',
       (select count(*)::text from public.ai_actions
        where organization_id in (select v from ids where k in ('orgA','orgB')));

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
