-- Oasis Care — Phase 6D: graphical irrigation network (pipes).
--
-- Sprinkler-specific fields (radius/angles/flow rate) live on the
-- existing garden_map_objects table (see 0024) rather than a new one —
-- SprinklerMapObject is GardenMapObject with objectType = 'sprinkler',
-- same reasoning as canopy diameter for vegetation. This migration only
-- adds the new IrrigationPipe concept, which garden_map_objects can't
-- represent (a polyline, not a single point).
--
-- start_node_object_id/end_node_object_id deliberately have no foreign
-- key to garden_map_objects for the same reason linked_entity_id in
-- 0024 doesn't: a dangling id here resolves to nil client-side
-- (GardenMapEngine.resolvedPipeNode) rather than erroring.
--
-- Run this once in the Supabase SQL Editor after 0001-0024.

-- SprinklerMapObject's parameters, added to the existing table rather
-- than a new one (see note above).
alter table public.garden_map_objects
  add column sprinkler_radius_meters double precision,
  add column sprinkler_start_angle_degrees double precision,
  add column sprinkler_end_angle_degrees double precision,
  add column sprinkler_flow_rate_liters_per_hour double precision;

create table public.irrigation_pipes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  points jsonb not null default '[]'::jsonb,
  diameter_mm double precision not null default 25,
  material text not null default 'pe',
  line_type text not null default 'secondary',
  start_node_object_id uuid,
  end_node_object_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index irrigation_pipes_garden_id_idx on public.irrigation_pipes (garden_id);

alter table public.irrigation_pipes enable row level security;
create policy "Workspace members can manage irrigation pipes" on public.irrigation_pipes
  for all using (public.is_workspace_member(workspace_id));
