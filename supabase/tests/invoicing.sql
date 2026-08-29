-- Milestone 10 — facturation, avoirs, encaissements.
--
-- §"Une facture émise ne doit pas être modifiable comme un brouillon."
-- C'est la règle centrale, et la moitié de ces tests ne fait que
-- l'attaquer sous des angles différents : modifier une ligne, en
-- ajouter une, en supprimer une, changer le numéro, revenir en
-- brouillon. Tout doit être refusé, par la base et pas par l'écran.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table txt(k text, v text) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on txt to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('aaaaaaa9-0000-4000-8000-0000000000a9','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','facture@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaa9-0000-4000-8000-0000000000a9')::text, true);
insert into ids select 'org', public.create_professional_organization('Facture Test','landscaper');

set local role authenticated;

insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'), 'customer', 'Client Facturé';

-- ============================================================
-- Un brouillon se modifie librement
-- ============================================================
insert into ids select 'facture', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id)
select (select v from ids where k='facture'), (select v from ids where k='org'),
       (select v from ids where k='client');

insert into res
select 'Un brouillon n''a pas de numéro', 'aucun',
       coalesce(number, 'aucun') from public.invoices where id = (select v from ids where k='facture');

-- Une facture vide ne s'émet pas.
do $$
declare ok boolean := false;
begin
  begin
    perform public.issue_invoice((select v from ids where k='facture'));
  exception when others then ok := true;
  end;
  insert into res select 'Une facture sans ligne ne s''émet pas', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ' end;
end $$;

insert into ids select 'ligne', gen_random_uuid();
insert into public.invoice_lines
  (id, organization_id, invoice_id, position, description, unit, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='ligne'), (select v from ids where k='org'),
       (select v from ids where k='facture'), 0, 'Aménagement', 'forfait', 1, 500000, 20;

update public.invoice_lines set description = 'Aménagement complet'
 where id = (select v from ids where k='ligne');

insert into res
select 'Le brouillon accepte une modification', 'Aménagement complet',
       description from public.invoice_lines where id = (select v from ids where k='ligne');

-- 5 000,00 HT + 20 % = 6 000,00 TTC.
insert into res
select 'Le total TTC est calculé', '600000',
       total_including_vat_cents::text
from public.invoice_totals where invoice_id = (select v from ids where k='facture');

-- ============================================================
-- Émission
-- ============================================================
insert into txt select 'numero', public.issue_invoice((select v from ids where k='facture'), 30);

insert into res
select 'L''émission attribue le numéro', 'FA-' || extract(year from current_date)::int::text || '-0001',
       (select v from txt where k='numero');

insert into res
select 'Et pose une échéance à 30 jours', (current_date + 30)::text,
       due_on::text from public.invoices where id = (select v from ids where k='facture');

insert into res
select 'Réémettre rend le même numéro', (select v from txt where k='numero'),
       public.issue_invoice((select v from ids where k='facture'));

-- ============================================================
-- LA RÈGLE CENTRALE, attaquée sous cinq angles
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    update public.invoice_lines set unit_price_cents = 1
     where id = (select v from ids where k='ligne');
  exception when others then ok := true;
  end;
  insert into res select 'Modifier une ligne émise est refusé', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — document falsifiable' end;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.invoice_lines
      (organization_id, invoice_id, position, description, quantity, unit_price_cents)
    select (select v from ids where k='org'), (select v from ids where k='facture'),
           1, 'Ligne ajoutée après coup', 1, 100000;
  exception when others then ok := true;
  end;
  insert into res select 'Ajouter une ligne après émission est refusé', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — document falsifiable' end;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.invoice_lines where id = (select v from ids where k='ligne');
  exception when others then ok := true;
  end;
  insert into res select 'Supprimer une ligne émise est refusé', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — document falsifiable' end;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.invoices set number = 'FA-2020-0001'
     where id = (select v from ids where k='facture');
  exception when others then ok := true;
  end;
  insert into res select 'Renuméroter une facture émise est refusé', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — numérotation falsifiable' end;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.invoices set status = 'draft'
     where id = (select v from ids where k='facture');
  exception when others then ok := true;
  end;
  insert into res select 'Revenir en brouillon est refusé', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ' end;
end $$;

-- Ce qui reste permis : les notes internes, qui ne figurent pas sur le
-- document remis au client.
update public.invoices set internal_notes = 'Relancer le 15'
 where id = (select v from ids where k='facture');

insert into res
select 'Les notes internes restent modifiables', 'Relancer le 15',
       coalesce(internal_notes, 'REFUSÉ') from public.invoices where id = (select v from ids where k='facture');

-- ============================================================
-- Encaissements
-- ============================================================
insert into res
select 'Rien n''est encaissé au départ', '600000',
       outstanding_cents::text from public.invoice_balance
where invoice_id = (select v from ids where k='facture');

insert into ids select 'acompte', gen_random_uuid();
insert into public.payments (id, organization_id, customer_id, amount_cents, method, reference)
select (select v from ids where k='acompte'), (select v from ids where k='org'),
       (select v from ids where k='client'), 200000, 'transfer', 'VIR-001';

insert into res
select 'Un acompte laisse la facture partiellement payée', 'partiallyPaid',
       public.allocate_payment((select v from ids where k='acompte'),
                               (select v from ids where k='facture'), 200000);

insert into res
select 'Le reste dû tombe à 4 000,00', '400000',
       outstanding_cents::text from public.invoice_balance
where invoice_id = (select v from ids where k='facture');

-- On n'affecte pas plus que le règlement ne contient.
do $$
declare ok boolean := false;
begin
  begin
    perform public.allocate_payment((select v from ids where k='acompte'),
                                    (select v from ids where k='facture'), 100000);
  exception when others then ok := true;
  end;
  insert into res select 'On n''affecte pas plus que le règlement', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ' end;
end $$;

insert into ids select 'solde', gen_random_uuid();
insert into public.payments (id, organization_id, customer_id, amount_cents, method)
select (select v from ids where k='solde'), (select v from ids where k='org'),
       (select v from ids where k='client'), 500000, 'transfer';

-- On n'affecte pas plus que le dû non plus.
do $$
declare ok boolean := false;
begin
  begin
    perform public.allocate_payment((select v from ids where k='solde'),
                                    (select v from ids where k='facture'), 500000);
  exception when others then ok := true;
  end;
  insert into res select 'Ni plus que le solde de la facture', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — solde négatif' end;
end $$;

insert into res
select 'Le solde exact la passe en payée', 'paid',
       public.allocate_payment((select v from ids where k='solde'),
                               (select v from ids where k='facture'), 400000);

insert into res
select 'Et il ne reste plus rien dû', '0',
       outstanding_cents::text from public.invoice_balance
where invoice_id = (select v from ids where k='facture');

-- ============================================================
-- L'avoir, seul mécanisme de correction
-- ============================================================
insert into ids select 'avoir', gen_random_uuid();
insert into public.credit_notes (id, organization_id, invoice_id, customer_id, reason, issued_on, issued_at, number)
select (select v from ids where k='avoir'), (select v from ids where k='org'),
       (select v from ids where k='facture'), (select v from ids where k='client'),
       'Prestation non réalisée', current_date, now(),
       public.next_document_number((select v from ids where k='org'), 'credit', 'AV');

insert into public.credit_note_lines
  (organization_id, credit_note_id, position, description, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='avoir'),
       0, 'Retrait plantation', 1, 100000, 20;

-- 1 000,00 HT + 20 % = 1 200,00 crédités sur une facture déjà soldée :
-- le reste dû devient négatif, ce qui est correct — on doit 1 200 au
-- client.
insert into res
select 'L''avoir se déduit du dû', '-120000',
       outstanding_cents::text from public.invoice_balance
where invoice_id = (select v from ids where k='facture');

-- ============================================================
-- Trésorerie
-- ============================================================
insert into public.business_expenses (organization_id, description, amount_cents, vat_cents)
select (select v from ids where k='org'), 'Carburant', 15000, 3000;

insert into res
select 'La trésorerie compte les entrées', '700000',
       coalesce(sum(amount_cents), 0)::text
from public.cash_flow_entries
where organization_id = (select v from ids where k='org') and direction = 'in';

insert into res
select 'Et les sorties, en négatif', '-18000',
       coalesce(sum(amount_cents), 0)::text
from public.cash_flow_entries
where organization_id = (select v from ids where k='org') and direction = 'out';

-- ============================================================
-- Isolement
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('aaaaaab0-0000-4000-8000-0000000000b0','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival7@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaab0-0000-4000-8000-0000000000b0')::text, true);
select public.create_professional_organization('Rival facture','landscaper');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucune facture', '0', count(*)::text from public.invoices;
insert into res select 'Ni aucun encaissement', '0', count(*)::text from public.payments;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
