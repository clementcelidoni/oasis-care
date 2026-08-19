-- Oasis Care — Phase 6G: growth timeline simulation.
--
-- estimated_years_to_maturity is GrowthSimulationService's rate
-- assumption for one placed vegetation object (Saisie utilisateur).
-- Past-mode reconstruction and collision/proximity detection use only
-- data that already exists (plants.date_added, plant_measurements,
-- garden_map_objects' own fields) — nothing else new to store.
--
-- Run this once in the Supabase SQL Editor after 0001-0026.

alter table public.garden_map_objects
  add column estimated_years_to_maturity double precision;
