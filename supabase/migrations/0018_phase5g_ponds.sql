-- Oasis Care — Phase 5G: smart pond.
--
-- Run this once in the Supabase SQL Editor after 0001-0017.

create table public.ponds (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  name text not null,
  volume_liters double precision,
  target_temperature_min double precision,
  target_temperature_max double precision,
  target_water_level_percent double precision,
  water_temperature_sensor_id uuid references public.sensors (id) on delete set null,
  water_level_sensor_id uuid references public.sensors (id) on delete set null,
  flow_sensor_id uuid references public.sensors (id) on delete set null,
  ph_sensor_id uuid references public.sensors (id) on delete set null,
  conductivity_sensor_id uuid references public.sensors (id) on delete set null,
  pump_device_id uuid references public.connected_devices (id) on delete set null,
  filtration_device_id uuid references public.connected_devices (id) on delete set null,
  uv_device_id uuid references public.connected_devices (id) on delete set null,
  last_filtration_cleaned_at timestamptz,
  uv_lamp_installed_at timestamptz,
  uv_lamp_reminder_after_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index ponds_garden_id_idx on public.ponds (garden_id);

alter table public.ponds enable row level security;
create policy "Workspace members can manage ponds" on public.ponds
  for all using (public.is_workspace_member(workspace_id));
