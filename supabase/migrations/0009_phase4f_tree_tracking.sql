-- Oasis Care — Phase 4F: tree/palm measurements and inspections.
--
-- plant_measurements is append-only (no updated_at/deleted_at) — spec
-- §55: "Ne jamais écraser les anciennes mesures." tree_inspections is
-- mutable, matching garden_zones/irrigation_zones.
--
-- Run this once in the Supabase SQL Editor after 0001-0008.

create table public.plant_measurements (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plant_id uuid not null references public.plants (id) on delete cascade,
  date timestamptz not null default now(),
  height double precision,
  trunk_circumference double precision,
  trunk_diameter double precision,
  canopy_diameter double precision,
  estimated_age integer,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.tree_inspections (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plant_id uuid not null references public.plants (id) on delete cascade,
  date timestamptz not null default now(),
  general_condition text not null default '',
  stability text not null default '',
  dead_wood text not null default '',
  cavities text not null default '',
  fungi text not null default '',
  parasites text not null default '',
  trunk_defects text not null default '',
  canopy_notes text not null default '',
  notes text not null default '',
  result text not null default 'good',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Photos taken during an inspection (spec §57's "Photos" field) link
-- back to it — nullable and ON DELETE SET NULL, matching the local
-- .nullify rule: deleting an inspection never deletes the photo.
alter table public.plant_photos
  add column tree_inspection_id uuid references public.tree_inspections (id) on delete set null;

create index plant_measurements_plant_id_idx on public.plant_measurements (plant_id);
create index tree_inspections_plant_id_idx on public.tree_inspections (plant_id);
create index plant_photos_tree_inspection_id_idx on public.plant_photos (tree_inspection_id);

alter table public.plant_measurements enable row level security;
create policy "Workspace members can manage plant measurements" on public.plant_measurements
  for all using (public.is_workspace_member(workspace_id));

alter table public.tree_inspections enable row level security;
create policy "Workspace members can manage tree inspections" on public.tree_inspections
  for all using (public.is_workspace_member(workspace_id));
