-- Oasis Care — Phase 6C: garden objects and zones.
--
-- linked_entity_id deliberately has no foreign key: it can point at
-- either plants.id or sensors.id depending on linked_entity_kind, and
-- a single FK constraint can't express "one of several tables" in
-- standard Postgres. The Swift side (GardenMapEngine.resolvedLinkedPlant/
-- resolvedLinkedSensor) already treats a lookup miss as "not linked"
-- rather than an error, so a dangling id here is handled gracefully,
-- not silently trusted.
--
-- Run this once in the Supabase SQL Editor after 0001-0023.

create table public.garden_map_objects (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  object_type text not null,
  position_x_meters double precision not null,
  position_y_meters double precision not null,
  rotation_radians double precision not null default 0,
  width_meters double precision not null,
  height_meters double precision not null,
  z_index integer not null default 0,
  label text,
  linked_entity_id uuid,
  linked_entity_kind text,
  canopy_diameter_meters double precision,
  estimated_adult_canopy_diameter_meters double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index garden_map_objects_garden_id_idx on public.garden_map_objects (garden_id);

alter table public.garden_map_objects enable row level security;
create policy "Workspace members can manage garden map objects" on public.garden_map_objects
  for all using (public.is_workspace_member(workspace_id));

create table public.garden_areas (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  area_type text not null,
  name text not null default '',
  points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index garden_areas_garden_id_idx on public.garden_areas (garden_id);

alter table public.garden_areas enable row level security;
create policy "Workspace members can manage garden areas" on public.garden_areas
  for all using (public.is_workspace_member(workspace_id));
