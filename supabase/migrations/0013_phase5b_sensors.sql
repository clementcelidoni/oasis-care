-- Oasis Care — Phase 5B: sensors, filled in for real.
--
-- 0011 created sensors/sensor_readings as an empty, unused "préparer
-- seulement" schema — safe to rename/extend without any data-loss risk
-- since nothing has ever written a row to either table.
--
-- Run this once in the Supabase SQL Editor after 0001-0012.

alter table public.sensors rename column is_active to enabled;

alter table public.sensors
  add column zone_id uuid references public.garden_zones (id) on delete cascade,
  add column device_id uuid references public.connected_devices (id) on delete set null,
  add column unit text not null default '',
  add column source text not null default 'manual',
  add column minimum_expected double precision,
  add column maximum_expected double precision;

alter table public.sensor_readings
  add column quality text not null default 'good',
  add column source text not null default 'manual';

create index sensors_zone_id_idx on public.sensors (zone_id);
create index sensors_device_id_idx on public.sensors (device_id);
create index sensor_readings_timestamp_idx on public.sensor_readings (timestamp);
