-- Oasis Care — Phase 5F: smart greenhouse.
--
-- Run this once in the Supabase SQL Editor after 0001-0016.

create table public.greenhouses (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  zone_id uuid references public.garden_zones (id) on delete cascade,
  name text not null,
  target_temperature_min double precision,
  target_temperature_max double precision,
  target_humidity_min double precision,
  target_humidity_max double precision,
  target_light_min double precision,
  target_light_max double precision,
  climate_control_enabled boolean not null default false,
  temperature_sensor_id uuid references public.sensors (id) on delete set null,
  humidity_sensor_id uuid references public.sensors (id) on delete set null,
  light_sensor_id uuid references public.sensors (id) on delete set null,
  soil_sensor_id uuid references public.sensors (id) on delete set null,
  heater_device_id uuid references public.connected_devices (id) on delete set null,
  fan_device_id uuid references public.connected_devices (id) on delete set null,
  mister_device_id uuid references public.connected_devices (id) on delete set null,
  light_device_id uuid references public.connected_devices (id) on delete set null,
  valve_device_id uuid references public.connected_devices (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index greenhouses_garden_id_idx on public.greenhouses (garden_id);

alter table public.greenhouses enable row level security;
create policy "Workspace members can manage greenhouses" on public.greenhouses
  for all using (public.is_workspace_member(workspace_id));
