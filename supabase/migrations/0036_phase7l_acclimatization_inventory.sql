-- Oasis Care — Phase 7L: acclimatation + inventaire de laboratoire.
--
-- Run this once in the Supabase SQL Editor after 0001-0035.

create table public.acclimatization_batches (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  culture_batch_id uuid references public.culture_batches (id) on delete cascade,
  started_at timestamptz not null,
  initial_plantlet_count integer not null,
  current_survivor_count integer not null,
  substrate text not null default '',
  humidity_program text not null default '',
  temperature double precision,
  location text not null default '',
  status text not null default 'active',
  steps jsonb not null default '[]'::jsonb,
  notes text not null default '',
  plants_created boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index acclimatization_batches_culture_batch_id_idx on public.acclimatization_batches (culture_batch_id);

alter table public.acclimatization_batches enable row level security;
create policy "Workspace members can manage acclimatization batches" on public.acclimatization_batches
  for all using (public.is_workspace_member(workspace_id));

create table public.lab_inventory_items (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  category text not null,
  current_quantity integer not null default 0,
  minimum_threshold integer,
  unit text not null default '',
  supplier text,
  lot_number text,
  expiry_date timestamptz,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index lab_inventory_items_workspace_id_idx on public.lab_inventory_items (workspace_id);

alter table public.lab_inventory_items enable row level security;
create policy "Workspace members can manage lab inventory items" on public.lab_inventory_items
  for all using (public.is_workspace_member(workspace_id));

alter table public.plants
  add column origin_batch_id uuid references public.culture_batches (id) on delete set null;
