-- Oasis Care — Phase 4H: sensor schema preparation (spec §71-72).
--
-- "Préparer seulement" — no real hardware integration this phase, and
-- nothing in the app creates a row here yet. This migration exists so
-- the schema is ready for that later phase, matching every other
-- table's RLS/versioning conventions rather than being bolted on
-- as a one-off when hardware support actually lands.
--
-- Run this once in the Supabase SQL Editor after 0001-0010.

create table public.sensors (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plant_id uuid references public.plants (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  name text not null,
  type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.sensor_readings (
  id uuid primary key,
  sensor_id uuid not null references public.sensors (id) on delete cascade,
  timestamp timestamptz not null default now(),
  value double precision not null,
  unit text not null,
  created_at timestamptz not null default now()
);

create index sensors_plant_id_idx on public.sensors (plant_id);
create index sensors_garden_id_idx on public.sensors (garden_id);
create index sensor_readings_sensor_id_idx on public.sensor_readings (sensor_id);

alter table public.sensors enable row level security;
create policy "Workspace members can manage sensors" on public.sensors
  for all using (public.is_workspace_member(workspace_id));

alter table public.sensor_readings enable row level security;
create policy "Workspace members can manage sensor readings" on public.sensor_readings
  for all using (
    exists (
      select 1 from public.sensors s
      where s.id = sensor_id and public.is_workspace_member(s.workspace_id)
    )
  );
