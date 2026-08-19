-- Oasis Care — Phase 6B: garden boundary editor.
--
-- One boundary per garden (unique garden_id) — the ordered outline
-- polygon, stored as a JSON array of {xMeters, yMeters} points matching
-- GardenCoordinate's own Codable shape, so Swift's JSONEncoder/Decoder
-- round-trips it with no custom (de)serialization on either side.
--
-- Run this once in the Supabase SQL Editor after 0001-0022.

create table public.garden_boundaries (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid unique references public.gardens (id) on delete cascade,
  points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index garden_boundaries_garden_id_idx on public.garden_boundaries (garden_id);

alter table public.garden_boundaries enable row level security;
create policy "Workspace members can manage garden boundaries" on public.garden_boundaries
  for all using (public.is_workspace_member(workspace_id));
