-- Oasis Care — Phase 7 enhancement: Smart Media foundation (compound
-- library, stock solutions, per-lot compound traceability) + the new
-- scope/tracking columns on CultureBatch and MediumBatch.
--
-- Run this once in the Supabase SQL Editor after 0001-0037.

create table public.lab_compounds (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  short_name text not null default '',
  category text not null,
  molecular_weight double precision,
  default_unit text not null default 'gramsPerLiter',
  supplier text,
  catalog_number text,
  notes text not null default '',
  is_hidden boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index lab_compounds_workspace_id_idx on public.lab_compounds (workspace_id);

alter table public.lab_compounds enable row level security;
create policy "Workspace members can manage lab compounds" on public.lab_compounds
  for all using (public.is_workspace_member(workspace_id));

create table public.stock_solutions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  compound_id uuid references public.lab_compounds (id) on delete set null,
  name text not null,
  concentration double precision not null,
  concentration_unit text not null,
  prepared_volume_liters double precision not null,
  remaining_volume_liters double precision not null,
  prepared_at timestamptz not null,
  expires_at timestamptz,
  storage_location text not null default '',
  lot_number text,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index stock_solutions_workspace_id_idx on public.stock_solutions (workspace_id);
create index stock_solutions_compound_id_idx on public.stock_solutions (compound_id);

alter table public.stock_solutions enable row level security;
create policy "Workspace members can manage stock solutions" on public.stock_solutions
  for all using (public.is_workspace_member(workspace_id));

-- Separate from the pre-existing lab_inventory_items (general consumable
-- stock) — see InventoryLot's own doc comment for why a compound needs
-- its own per-lot table rather than reusing that single-lot-field model.
create table public.inventory_lots (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  compound_id uuid references public.lab_compounds (id) on delete set null,
  lot_number text not null,
  quantity_received double precision not null,
  quantity_remaining double precision not null,
  unit text not null,
  received_at timestamptz not null,
  expires_at timestamptz,
  supplier text,
  cost_total double precision,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index inventory_lots_workspace_id_idx on public.inventory_lots (workspace_id);
create index inventory_lots_compound_id_idx on public.inventory_lots (compound_id);

alter table public.inventory_lots enable row level security;
create policy "Workspace members can manage inventory lots" on public.inventory_lots
  for all using (public.is_workspace_member(workspace_id));

-- CultureBatch: recommendation-engine inputs (enhancement §2).
alter table public.culture_batches
  add column cultivar text,
  add column explant_type text,
  add column culture_system text;

-- MediumBatch: target-vs-actual + real preparation record (enhancement
-- "MEDIUM BATCH COMPLET"). volumeLiters itself is untouched — it has
-- always meant the real/actual prepared volume.
alter table public.medium_batches
  add column target_volume_liters double precision,
  add column prepared_by text,
  add column measured_ph double precision,
  add column compound_lots jsonb not null default '[]'::jsonb;
