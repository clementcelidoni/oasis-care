-- Oasis Care — Phase 5E: connected irrigation.
--
-- Adds real-hardware linkage to the Phase 4D irrigation_zones table and
-- before/after readings to irrigation_events. All nullable — existing
-- rows (every zone/event from Phase 4D real-device testing) are
-- unaffected.
--
-- Run this once in the Supabase SQL Editor after 0001-0015.

alter table public.irrigation_zones
  add column valve_device_id uuid references public.connected_devices (id) on delete set null,
  add column pump_device_id uuid references public.connected_devices (id) on delete set null,
  add column soil_sensor_id uuid references public.sensors (id) on delete set null,
  add column flow_sensor_id uuid references public.sensors (id) on delete set null;

alter table public.irrigation_events
  add column soil_moisture_before double precision,
  add column soil_moisture_after double precision,
  add column measured_liters double precision;

create index irrigation_zones_valve_device_idx on public.irrigation_zones (valve_device_id);
