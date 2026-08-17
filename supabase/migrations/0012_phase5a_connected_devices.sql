-- Oasis Care — Phase 5A: connected devices (HomeKit/Matter/manual/API).
--
-- One row per physical smart-home accessory Oasis Care knows about.
-- garden_id/zone_id are nullable — a device can be recognized by
-- HomeKitService before the user assigns it anywhere in the garden
-- hierarchy. capabilities is derived from the accessory's real HomeKit
-- services (or set manually for provider='manual'/'api'), never
-- hardcoded per device name — see HomeKitService.capabilities(for:).
--
-- Run this once in the Supabase SQL Editor after 0001-0011.

alter table public.dashboard_preferences
  add column show_connected_home boolean not null default true;

create table public.connected_devices (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete set null,
  zone_id uuid references public.garden_zones (id) on delete set null,
  provider text not null,
  provider_device_id text not null,
  name text not null,
  category text not null,
  manufacturer text,
  model text,
  firmware_version text,
  capabilities text[] not null default '{}',
  online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index connected_devices_garden_id_idx on public.connected_devices (garden_id);
create index connected_devices_zone_id_idx on public.connected_devices (zone_id);
create unique index connected_devices_workspace_provider_device_idx
  on public.connected_devices (workspace_id, provider, provider_device_id);

alter table public.connected_devices enable row level security;
create policy "Workspace members can manage connected devices" on public.connected_devices
  for all using (public.is_workspace_member(workspace_id));
