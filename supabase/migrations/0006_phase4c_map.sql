-- Oasis Care — Phase 4C: plant map position.
--
-- All nullable (spec §24: "les coordonnées restent facultatives") —
-- existing rows are unaffected. map_position_x/y are a reserved,
-- currently-unused seam for a future garden-plan-image overlay (spec
-- §30), not populated by anything in this phase.
--
-- Run this once in the Supabase SQL Editor after 0001-0005.

alter table public.plants
  add column latitude double precision,
  add column longitude double precision,
  add column map_position_x double precision,
  add column map_position_y double precision,
  add column position_source text;
