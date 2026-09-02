-- Oasis Care — Phase 11, Milestone 5 (2/2) : §11E DEVIS.
--
-- À exécuter après 0048. Idempotente et purement additive.
--
-- CE QUE CE MODULE N'EST PAS. La liste des interdits du document est
-- explicite : « NE PAS créer une fausse comptabilité certifiée », « NE
-- PAS inventer des obligations réglementaires », « NE PAS envoyer
-- automatiquement des devis ». Il n'y a donc ici ni numérotation
-- inaltérable au sens fiscal, ni archivage probant, ni envoi. Un devis
-- est une proposition commerciale que l'utilisateur rédige, relit et
-- transmet lui-même.
--
-- LA LIGNE DE DEVIS EST UNE PHOTOGRAPHIE, PAS UN LIEN. §HISTORIQUE :
-- « Une ligne de devis doit conserver un snapshot de son prix au moment
-- de création. » Chaque ligne porte donc SA copie de la désignation, de
-- l'unité, du prix d'achat et du prix de vente. `catalog_item_id` n'est
-- gardé que pour la traçabilité — d'où vient cette ligne — et jamais
-- pour aller relire un prix. Sans quoi rouvrir un devis de l'an dernier
-- afficherait les tarifs d'aujourd'hui, et le client verrait un montant
-- différent de celui qu'on lui a remis.

-- ============================================================
-- 1. Devis
-- ============================================================

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  customer_id uuid not null references public.crm_customers (id) on delete restrict,
  site_id uuid references public.crm_customer_sites (id) on delete set null,
  opportunity_id uuid references public.crm_opportunities (id) on delete set null,
  -- §"DIGITAL TWIN → DEVIS" : d'où vient le métré, quand il y en a un.
  garden_id uuid references public.gardens (id) on delete set null,

  -- Numéro lisible, unique dans l'organisation. Voir next_quote_number.
  number text not null,
  title text not null default '',

  -- §STATUT, dans l'ordre du document.
  status text not null default 'draft' check (status in (
    'draft', 'internalReview', 'sent', 'viewed',
    'accepted', 'rejected', 'expired', 'cancelled'
  )),

  currency text not null default 'EUR',

  -- Remise globale, en pourcentage, appliquée après les remises de
  -- ligne. Séparée d'elles pour rester lisible sur le document remis :
  -- « remise commerciale 5 % » se justifie, une remise diluée sur
  -- quarante lignes ne s'explique pas.
  global_discount_percent numeric(5, 2) not null default 0
    check (global_discount_percent >= 0 and global_discount_percent <= 100),

  issued_on date not null default current_date,
  valid_until date,
  sent_at timestamptz,
  viewed_at timestamptz,
  decided_at timestamptz,
  rejection_reason text,

  -- Textes libres imprimés sur le devis.
  introduction text,
  terms text,
  internal_notes text,

  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quotes_number_unique unique (organization_id, number),
  constraint quotes_validity_ordered check (valid_until is null or valid_until >= issued_on)
);

create index if not exists quotes_org_status_idx
  on public.quotes (organization_id, status) where archived_at is null;
create index if not exists quotes_customer_idx on public.quotes (customer_id);
create index if not exists quotes_garden_idx on public.quotes (garden_id);

-- ============================================================
-- 2. Sections
-- ============================================================
-- §SECTIONS : Préparation, Terrassement, Plantation, Irrigation,
-- Éclairage, Paillage, Transport, Main-d'œuvre. Libres, pas
-- énumérées : ce sont les postes du chantier, propres à chaque devis.

create table if not exists public.quote_sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,

  title text not null,
  description text,
  position int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_sections_quote_idx on public.quote_sections (quote_id, position);

-- ============================================================
-- 3. Lignes
-- ============================================================

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  section_id uuid references public.quote_sections (id) on delete set null,

  -- Traçabilité seulement. On ne relit JAMAIS le prix par ce lien.
  catalog_item_id uuid references public.catalog_items (id) on delete set null,

  position int not null default 0,
  description text not null,
  unit text not null default 'u',
  quantity numeric(14, 3) not null default 1,

  -- La photographie du prix, prise à la création de la ligne.
  unit_cost_cents bigint not null default 0,
  unit_sale_price_cents bigint not null default 0,
  vat_rate numeric(5, 2) not null default 20,
  discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),

  -- Totaux CALCULÉS par la base, jamais écrits par l'application.
  -- Une colonne générée ne peut pas diverger de ses composantes : c'est
  -- exactement ce qu'on veut d'un montant.
  --
  -- La remise porte sur la vente et pas sur le coût — un rabais ne fait
  -- pas baisser ce que la chose a coûté, il ronge la marge. C'est le
  -- sens même du calcul de rentabilité.
  sale_total_cents bigint generated always as (
    round(quantity * unit_sale_price_cents * (1 - discount_percent / 100.0))::bigint
  ) stored,
  cost_total_cents bigint generated always as (
    round(quantity * unit_cost_cents)::bigint
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_lines_quote_idx on public.quote_lines (quote_id, position);
create index if not exists quote_lines_section_idx on public.quote_lines (section_id, position);

-- ============================================================
-- 4. Révisions
-- ============================================================
-- Même principe que `digital_twin_revisions` : un instantané JSON, et
-- non des références. Une version envoyée au client doit continuer de
-- montrer ce qu'il a reçu, même après que le devis courant ait
-- entièrement changé.

create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,

  label text not null,
  snapshot jsonb not null,
  total_excluding_vat_cents bigint,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists quote_revisions_quote_idx
  on public.quote_revisions (quote_id, created_at desc);

-- ============================================================
-- 5. Totaux
-- ============================================================
-- Une vue, pas des colonnes. Le total d'un devis est la somme de ses
-- lignes : le stocker, c'est accepter qu'il se désynchronise le jour où
-- une ligne change sans passer par le bon chemin.
--
-- §RENTABILITÉ demande d'afficher « Coût estimé / Prix HT / Marge € /
-- Marge % », et plus bas « TVA / TTC ».
--
-- La TVA est calculée PAR TAUX puis sommée, et non appliquée au total.
-- Un devis mêlant du 20 % et du 10 % — travaux neufs et rénovation —
-- donnerait sinon un montant faux.
create or replace view public.quote_totals as
with lines as (
  select
    l.quote_id,
    l.vat_rate,
    sum(l.sale_total_cents) as sale_cents,
    sum(l.cost_total_cents) as cost_cents
  from public.quote_lines l
  group by l.quote_id, l.vat_rate
),
after_global as (
  select
    l.quote_id,
    l.vat_rate,
    -- La remise globale s'applique après les remises de ligne, sur
    -- chaque tranche de TVA au prorata — c'est ce qui garde la
    -- ventilation juste.
    round(l.sale_cents * (1 - q.global_discount_percent / 100.0))::bigint as sale_cents,
    l.cost_cents
  from lines l
  join public.quotes q on q.id = l.quote_id
)
select
  quote_id,
  sum(sale_cents)::bigint as total_excluding_vat_cents,
  sum(cost_cents)::bigint as total_cost_cents,
  sum(round(sale_cents * vat_rate / 100.0))::bigint as total_vat_cents,
  (sum(sale_cents) + sum(round(sale_cents * vat_rate / 100.0)))::bigint as total_including_vat_cents,
  (sum(sale_cents) - sum(cost_cents))::bigint as margin_cents,
  public.margin_percent(sum(cost_cents)::bigint, sum(sale_cents)::bigint) as margin_percent
from after_global
group by quote_id;

-- La vue hérite de la RLS de `quote_lines` et `quotes` : elle est
-- déclarée en `security_invoker` pour que les politiques s'appliquent à
-- l'appelant, et non au propriétaire de la vue.
alter view public.quote_totals set (security_invoker = true);

-- ============================================================
-- 6. Numérotation
-- ============================================================
-- « DEV-2026-0007 », unique par organisation.
--
-- Le compteur est une ligne qu'on incrémente en une seule instruction :
-- deux commerciaux qui créent un devis à la même seconde obtiennent
-- deux numéros différents. Un `max(number) + 1` leur en donnerait le
-- même, et la contrainte d'unicité ferait échouer l'un des deux.

create table if not exists public.quote_counters (
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  year int not null,
  last_number int not null default 0,
  primary key (organization_id, year)
);

alter table public.quote_counters enable row level security;
drop policy if exists "Members with quotes.create can use counters" on public.quote_counters;
create policy "Members with quotes.create can use counters" on public.quote_counters
  for all using (public.has_permission(organization_id, 'quotes.create'))
  with check (public.has_permission(organization_id, 'quotes.create'));

create or replace function public.next_quote_number(p_organization_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  y int := extract(year from current_date);
  n int;
begin
  insert into public.quote_counters (organization_id, year, last_number)
  values (p_organization_id, y, 1)
  on conflict (organization_id, year) do update
    set last_number = public.quote_counters.last_number + 1
  returning last_number into n;

  return 'DEV-' || y::text || '-' || lpad(n::text, 4, '0');
end;
$$;

-- ============================================================
-- 7. RLS
-- ============================================================
-- Quatre permissions distinctes existent (read / create / edit /
-- approve). `approve` sert au workflow applicatif — qui a le droit de
-- passer un devis en « envoyé » — et non à l'accès aux lignes : un
-- commercial qui ne peut pas approuver doit tout de même pouvoir
-- rédiger.

do $$
declare t text;
begin
  foreach t in array array['quotes', 'quote_sections', 'quote_lines', 'quote_revisions']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members with quotes.read can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with quotes.read can read %1$s" on public.%1$I
         for select using (public.has_permission(organization_id, ''quotes.read''))', t);

    execute format('drop policy if exists "Members with quotes.create can insert %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with quotes.create can insert %1$s" on public.%1$I
         for insert with check (public.has_permission(organization_id, ''quotes.create''))', t);

    execute format('drop policy if exists "Members with quotes.edit can update %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with quotes.edit can update %1$s" on public.%1$I
         for update using (public.has_permission(organization_id, ''quotes.edit''))
         with check (public.has_permission(organization_id, ''quotes.edit''))', t);

    execute format('drop policy if exists "Members with quotes.edit can delete %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with quotes.edit can delete %1$s" on public.%1$I
         for delete using (public.has_permission(organization_id, ''quotes.edit''))', t);
  end loop;
end $$;
