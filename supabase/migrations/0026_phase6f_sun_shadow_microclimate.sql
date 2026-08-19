-- Oasis Care — Phase 6F: sun/shadow simulation + microclimate.
--
-- structure_height_meters is the object's vertical height for shadow
-- casting (garden_map_objects already has width/height for the ground
-- footprint — this is a distinct, new dimension). Microclimate fields
-- are descriptive annotations on garden_areas (see GardenArea.swift's
-- own comment for why these live on the existing zone table rather
-- than a new one) — no stored temperature delta, since that's always
-- computed fresh from live sensor readings, never persisted.
--
-- Run this once in the Supabase SQL Editor after 0001-0025.

alter table public.garden_map_objects
  add column structure_height_meters double precision;

alter table public.garden_areas
  add column microclimate_sun_level text,
  add column microclimate_wind_level text,
  add column microclimate_soil_level text,
  add column microclimate_notes text;
