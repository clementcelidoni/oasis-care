-- Oasis Care — Phase 6A: new map engine.
--
-- Only a preference column this sub-phase — GardenCoordinate/
-- GardenMapCamera/GardenMapEngine are all client-side (coordinate math
-- and camera state, nothing persisted server-side). Real map geometry
-- tables (garden_map_objects, garden_boundaries, ...) start in 6B/6C.
--
-- Run this once in the Supabase SQL Editor after 0001-0021.

alter table public.gardens
  add column preferred_map_mode text not null default 'oasisPlan';
