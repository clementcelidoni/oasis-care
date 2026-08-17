-- Oasis Care — Phase 5I: anomaly detection.
--
-- DeviceHealthService's alerts are computed on-demand from data that's
-- already synced (sensors, sensor_readings, connected_devices,
-- irrigation_zones/events) — there's no new table here, only the
-- dashboard visibility toggle for the new "Anomalies" card.
--
-- Run this once in the Supabase SQL Editor after 0001-0018.

alter table public.dashboard_preferences
  add column show_device_health boolean not null default true;
