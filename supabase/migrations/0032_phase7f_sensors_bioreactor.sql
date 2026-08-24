-- Oasis Care — Phase 7F: scope Sensor to a bioreactor.
--
-- Same "any combination of optional scopes" shape sensors already have
-- for plant/garden/zone/device (0011/0013) — one more nullable FK, no
-- RLS change needed since the existing workspace_id policy on
-- public.sensors already covers every row regardless of scope column.
--
-- Run this once in the Supabase SQL Editor after 0001-0031.

alter table public.sensors
  add column bioreactor_id uuid references public.bioreactors (id) on delete cascade;

create index sensors_bioreactor_id_idx on public.sensors (bioreactor_id);
