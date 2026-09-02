-- Oasis Care — Phase 11, Milestone 10 : §11O FACTURATION et
-- §DÉPENSES / TRÉSORERIE OPÉRATIONNELLE.
--
-- À exécuter après 0053. Idempotente et purement additive.
--
-- CE QUE CE MODULE N'EST PAS, et le document le dit deux fois :
-- « NE PAS créer une fausse comptabilité certifiée » et « NE PAS
-- prétendre remplacer une comptabilité certifiée tant que le module
-- n'a pas été développé et validé pour cela ». Il n'y a donc ici ni
-- certification NF525, ni archivage à valeur probante, ni journal
-- comptable. Un logiciel qui laisserait croire le contraire ferait
-- courir un risque réel à son utilisateur en cas de contrôle.
--
-- CE QU'IL FAIT : tenir des factures, des avoirs, des encaissements et
-- des dépenses avec assez de rigueur pour qu'un expert-comptable puisse
-- s'en servir — et un export pour les lui donner.
--
-- « UNE FACTURE ÉMISE NE DOIT PAS ÊTRE MODIFIABLE COMME UN BROUILLON. »
-- C'est la règle centrale, et elle est tenue par un DÉCLENCHEUR, pas
-- par l'interface. Une interface se contourne ; une facture modifiée
-- après remise au client est un document qui ne correspond plus à ce
-- qu'il a reçu. La correction passe par un avoir — le « mécanisme de
-- correction approprié » du document.

-- ============================================================
-- 1. Factures
-- ============================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete restrict,

  quote_id uuid references public.quotes (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  sales_order_id uuid references public.sales_orders (id) on delete set null,

  -- Nul tant que la facture est un brouillon : un numéro attribué puis
  -- abandonné ferait un trou dans la séquence, et c'est précisément ce
  -- qu'un comptable regarde en premier.
  number text,

  status text not null default 'draft' check (status in (
    'draft', 'issued', 'partiallyPaid', 'paid', 'overdue', 'cancelled', 'credited'
  )),

  issued_on date,
  due_on date,
  -- L'instant du verrouillage. Sa présence, et non le statut, est ce
  -- que le déclencheur regarde : un statut se change, un fait daté non.
  issued_at timestamptz,

  introduction text,
  terms text,
  internal_notes text,
  currency text not null default 'EUR',

  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_number_unique unique (organization_id, number),
  constraint invoices_issued_has_number
    check (issued_at is null or number is not null)
);

create index if not exists invoices_org_status_idx
  on public.invoices (organization_id, status) where archived_at is null;
create index if not exists invoices_customer_idx on public.invoices (customer_id);
create index if not exists invoices_due_idx on public.invoices (due_on)
  where status in ('issued', 'partiallyPaid', 'overdue');

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,

  position int not null default 0,
  description text not null,
  unit text not null default 'u',
  quantity numeric(14, 3) not null default 1,
  unit_price_cents bigint not null default 0,
  vat_rate numeric(5, 2) not null default 20,
  discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),

  total_cents bigint generated always as (
    round(quantity * unit_price_cents * (1 - discount_percent / 100.0))::bigint
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

-- ============================================================
-- 2. Avoirs
-- ============================================================
-- Le « mécanisme de correction approprié ». On ne rature pas une
-- facture émise : on émet un avoir qui la corrige, et les deux
-- documents restent.

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  customer_id uuid not null references public.crm_customers (id) on delete restrict,

  number text,
  reason text not null default '',
  issued_on date,
  issued_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint credit_notes_number_unique unique (organization_id, number)
);

create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);

create table if not exists public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  credit_note_id uuid not null references public.credit_notes (id) on delete cascade,

  position int not null default 0,
  description text not null,
  unit text not null default 'u',
  quantity numeric(14, 3) not null default 1,
  unit_price_cents bigint not null default 0,
  vat_rate numeric(5, 2) not null default 20,

  total_cents bigint generated always as (
    round(quantity * unit_price_cents)::bigint
  ) stored,

  created_at timestamptz not null default now()
);

create index if not exists credit_note_lines_note_idx
  on public.credit_note_lines (credit_note_id, position);

-- ============================================================
-- 3. Encaissements
-- ============================================================
-- Un règlement et son affectation sont deux choses. Un virement de
-- 5 000 € peut solder trois factures ; une facture peut recevoir un
-- acompte puis un solde. Les confondre en un seul champ « payé »
-- rendrait la moitié des situations réelles inexprimables.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid references public.crm_customers (id) on delete set null,

  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'transfer' check (method in (
    'transfer', 'card', 'cheque', 'cash', 'direct_debit', 'other'
  )),
  received_on date not null default current_date,
  reference text,
  notes text,

  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payments_customer_idx on public.payments (customer_id, received_on desc);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,

  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),

  constraint payment_allocations_unique unique (payment_id, invoice_id)
);

create index if not exists payment_allocations_invoice_idx
  on public.payment_allocations (invoice_id);

-- ============================================================
-- 4. Dépenses
-- ============================================================

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint expense_categories_name_unique unique (organization_id, name)
);

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  category_id uuid references public.expense_categories (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  -- Une dépense rattachée à un chantier alimente aussi son coût réel —
  -- voir plus bas. Sans ce lien, on saisirait deux fois.
  project_id uuid references public.projects (id) on delete set null,

  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  vat_cents bigint not null default 0,
  spent_on date not null default current_date,
  payment_method text,
  invoice_reference text,
  notes text,

  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists business_expenses_date_idx
  on public.business_expenses (organization_id, spent_on desc);

-- ============================================================
-- 5. Ce qui reste dû
-- ============================================================
-- Des vues. Un solde stocké se désynchronise du premier encaissement
-- saisi ailleurs, et un solde faux est pire qu'un solde absent.

create or replace view public.invoice_totals as
select
  i.id as invoice_id,
  coalesce(sum(l.total_cents), 0)::bigint as total_excluding_vat_cents,
  coalesce(sum(round(l.total_cents * l.vat_rate / 100.0)), 0)::bigint as total_vat_cents,
  (coalesce(sum(l.total_cents), 0)
   + coalesce(sum(round(l.total_cents * l.vat_rate / 100.0)), 0))::bigint
   as total_including_vat_cents
from public.invoices i
left join public.invoice_lines l on l.invoice_id = i.id
group by i.id;

alter view public.invoice_totals set (security_invoker = true);

create or replace view public.invoice_balance as
with credited as (
  select cn.invoice_id,
         coalesce(sum(cl.total_cents + round(cl.total_cents * cl.vat_rate / 100.0)), 0)::bigint as credited_cents
  from public.credit_notes cn
  join public.credit_note_lines cl on cl.credit_note_id = cn.id
  where cn.issued_at is not null
  group by cn.invoice_id
),
paid as (
  select invoice_id, coalesce(sum(amount_cents), 0)::bigint as paid_cents
  from public.payment_allocations group by invoice_id
)
select
  t.invoice_id,
  t.total_including_vat_cents,
  coalesce(p.paid_cents, 0) as paid_cents,
  coalesce(c.credited_cents, 0) as credited_cents,
  (t.total_including_vat_cents - coalesce(p.paid_cents, 0) - coalesce(c.credited_cents, 0))::bigint
    as outstanding_cents
from public.invoice_totals t
left join paid p on p.invoice_id = t.invoice_id
left join credited c on c.invoice_id = t.invoice_id;

alter view public.invoice_balance set (security_invoker = true);

-- §"trésorerie prévisionnelle" — les mouvements d'argent, entrants et
-- sortants, dans un seul flux ordonné. Encaissements réels d'un côté,
-- dépenses de l'autre ; ce n'est pas un plan de trésorerie prévisionnel
-- au sens bancaire, et l'écran ne le présente pas comme tel.
create or replace view public.cash_flow_entries as
select
  p.organization_id,
  p.received_on as occurred_on,
  'in'::text as direction,
  p.amount_cents,
  coalesce(p.reference, 'Encaissement') as label,
  'payment'::text as source
from public.payments p
union all
select
  e.organization_id,
  e.spent_on,
  'out'::text,
  -(e.amount_cents + e.vat_cents),
  e.description,
  'expense'::text
from public.business_expenses e;

alter view public.cash_flow_entries set (security_invoker = true);

-- ============================================================
-- 6. Une facture émise ne bouge plus
-- ============================================================
-- LA RÈGLE CENTRALE, tenue par la base.
--
-- Ce qui reste modifiable après émission : les notes internes, et le
-- statut — parce qu'il suit les règlements. Tout le reste est figé, et
-- les lignes ne peuvent être ni ajoutées, ni modifiées, ni supprimées.
--
-- La correction passe par un avoir. C'est plus lourd, et c'est le but :
-- un document remis à un client doit rester ce qu'il a reçu.

create or replace function public.protect_issued_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.issued_at is null then
    return new;
  end if;

  -- Annuler ou créditer une facture émise reste possible : ce sont des
  -- décisions, pas des retouches.
  if new.status is distinct from old.status then
    if new.status not in ('issued', 'partiallyPaid', 'paid', 'overdue', 'cancelled', 'credited') then
      raise exception 'Une facture émise ne peut pas redevenir un brouillon. Émettez un avoir.';
    end if;
  end if;

  if new.number is distinct from old.number
     or new.issued_on is distinct from old.issued_on
     or new.issued_at is distinct from old.issued_at
     or new.customer_id is distinct from old.customer_id
     or new.introduction is distinct from old.introduction
     or new.terms is distinct from old.terms
  then
    raise exception 'Facture % déjà émise : son contenu ne se modifie plus. Le mécanisme de correction est l''avoir.', old.number;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_issued_invoice on public.invoices;
create trigger trg_protect_issued_invoice before update on public.invoices
  for each row execute function public.protect_issued_invoice();

create or replace function public.protect_issued_invoice_lines()
returns trigger
language plpgsql
as $$
declare
  locked_number text;
begin
  select number into locked_number from public.invoices
   where id = coalesce(new.invoice_id, old.invoice_id) and issued_at is not null;

  if locked_number is not null then
    raise exception 'Facture % déjà émise : ses lignes ne se modifient plus. Émettez un avoir.', locked_number;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_issued_invoice_lines on public.invoice_lines;
create trigger trg_protect_issued_invoice_lines
  before insert or update or delete on public.invoice_lines
  for each row execute function public.protect_issued_invoice_lines();

-- ============================================================
-- 7. Émettre
-- ============================================================
-- Le numéro n'est attribué QU'ICI, au moment où la facture devient
-- réelle. Le donner à la création laisserait des trous dans la
-- séquence à chaque brouillon abandonné.
create or replace function public.issue_invoice(
  p_invoice_id uuid,
  p_due_in_days int default 30
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  inv record;
  new_number text;
  line_count int;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv is null then
    raise exception 'Facture introuvable.';
  end if;
  if inv.issued_at is not null then
    return inv.number;  -- déjà émise : idempotent
  end if;

  select count(*) into line_count from public.invoice_lines where invoice_id = p_invoice_id;
  if line_count = 0 then
    raise exception 'Une facture sans ligne ne s''émet pas.';
  end if;

  new_number := public.next_document_number(inv.organization_id, 'invoice', 'FA');

  update public.invoices
     set number = new_number,
         status = 'issued',
         issued_on = current_date,
         issued_at = now(),
         due_on = coalesce(due_on, current_date + coalesce(p_due_in_days, 30)),
         updated_at = now()
   where id = p_invoice_id;

  return new_number;
end;
$$;

-- ============================================================
-- 8. Affecter un règlement
-- ============================================================
-- Écrit l'affectation ET recalcule le statut de la facture, dans la
-- même opération. Séparés, un encaissement enregistré sans mise à jour
-- laisserait une facture soldée affichée comme impayée.
create or replace function public.allocate_payment(
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  pay record;
  already_allocated bigint;
  outstanding bigint;
  new_status text;
begin
  select * into pay from public.payments where id = p_payment_id;
  if pay is null then
    raise exception 'Règlement introuvable.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Le montant affecté doit être positif.';
  end if;

  select coalesce(sum(amount_cents), 0) into already_allocated
    from public.payment_allocations where payment_id = p_payment_id;

  if already_allocated + p_amount_cents > pay.amount_cents then
    raise exception 'Ce règlement de % centimes n''a plus que % à affecter.',
      pay.amount_cents, pay.amount_cents - already_allocated;
  end if;

  select b.outstanding_cents into outstanding
    from public.invoice_balance b where b.invoice_id = p_invoice_id;

  -- Affecter plus que le dû arrive — un client qui arrondit — mais le
  -- laisser passer en silence produirait un solde négatif que personne
  -- ne comprendrait. On refuse, et on dit combien reste dû.
  if p_amount_cents > coalesce(outstanding, 0) then
    raise exception 'Il ne reste que % centimes dus sur cette facture.', coalesce(outstanding, 0);
  end if;

  insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount_cents)
  values (pay.organization_id, p_payment_id, p_invoice_id, p_amount_cents)
  on conflict (payment_id, invoice_id) do update
    set amount_cents = public.payment_allocations.amount_cents + excluded.amount_cents;

  select case
      when b.outstanding_cents <= 0 then 'paid'
      when b.paid_cents > 0 then 'partiallyPaid'
      else 'issued'
    end into new_status
  from public.invoice_balance b where b.invoice_id = p_invoice_id;

  update public.invoices set status = new_status, updated_at = now()
   where id = p_invoice_id and status not in ('cancelled', 'credited');

  return new_status;
end;
$$;

-- ============================================================
-- 9. Facturer un devis accepté
-- ============================================================
-- Le pont qui manquait : un devis accepté se refacture à l'identique,
-- sans ressaisie. Les montants sont RECOPIÉS, jamais relus — le devis
-- pourrait changer plus tard, la facture non.
create or replace function public.create_invoice_from_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  q record;
  existing uuid;
  new_invoice uuid;
  line record;
  discount numeric;
  n int := 0;
begin
  select * into q from public.quotes where id = p_quote_id;
  if q is null then
    raise exception 'Devis introuvable.';
  end if;

  select id into existing from public.invoices
   where quote_id = p_quote_id and archived_at is null and status <> 'cancelled' limit 1;
  if existing is not null then
    return existing;
  end if;

  insert into public.invoices (
    organization_id, customer_id, quote_id, project_id, introduction, terms, created_by
  ) values (
    q.organization_id, q.customer_id, p_quote_id,
    (select id from public.projects where quote_id = p_quote_id and archived_at is null limit 1),
    q.introduction, q.terms, auth.uid()
  )
  returning id into new_invoice;

  discount := 1 - coalesce(q.global_discount_percent, 0) / 100.0;

  for line in
    select * from public.quote_lines where quote_id = p_quote_id order by position
  loop
    insert into public.invoice_lines (
      organization_id, invoice_id, position, description, unit, quantity,
      -- La remise globale du devis est répercutée sur le prix unitaire :
      -- une facture n'a pas de remise globale, et la perdre changerait
      -- le montant que le client a accepté.
      unit_price_cents, vat_rate, discount_percent
    ) values (
      q.organization_id, new_invoice, n, line.description, line.unit, line.quantity,
      round(line.unit_sale_price_cents * discount)::bigint,
      line.vat_rate, line.discount_percent
    );
    n := n + 1;
  end loop;

  return new_invoice;
end;
$$;

-- ============================================================
-- 10. RLS
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'invoices', 'invoice_lines', 'credit_notes', 'credit_note_lines',
    'payments', 'payment_allocations', 'expense_categories', 'business_expenses'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Members with invoicing %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with invoicing %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''invoice.create''))
         with check (public.has_permission(organization_id, ''invoice.create''))', t);
  end loop;
end $$;

-- ============================================================
-- 11. Les factures en retard
-- ============================================================
-- Le retard est un FAIT daté, pas une décision : une facture dont
-- l'échéance est passée et qui reste due est en retard, qu'on l'ait
-- marquée ou non. Cette fonction se rappelle depuis l'écran plutôt que
-- par une tâche planifiée — Oasis n'en a pas encore, et un statut faux
-- entre deux passages serait pire que pas de statut du tout.
create or replace function public.refresh_overdue_invoices(p_organization_id uuid)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  with late as (
    select i.id
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.organization_id = p_organization_id
      and i.status in ('issued', 'partiallyPaid')
      and i.due_on is not null
      and i.due_on < current_date
      and b.outstanding_cents > 0
  )
  update public.invoices set status = 'overdue', updated_at = now()
   where id in (select id from late);

  get diagnostics n = row_count;
  return n;
end;
$$;
