-- Oasis Care — spec's "QR / NFC" section: extends SmartTag to
-- bioréacteur/lot/recette imprimée/zone d'acclimatation/rack.
--
-- Run this once in the Supabase SQL Editor after 0001-0036.

-- plant_id was NOT NULL since Phase 4E (a tag always pointed at a plant
-- until now) — every other new scope column below is nullable from the
-- start, same "any one of several" shape as sensors' own scope columns.
alter table public.smart_tags
  alter column plant_id drop not null;

alter table public.smart_tags
  add column bioreactor_id uuid references public.bioreactors (id) on delete cascade,
  add column culture_batch_id uuid references public.culture_batches (id) on delete cascade,
  add column medium_recipe_version_id uuid references public.medium_recipe_versions (id) on delete cascade,
  add column acclimatization_batch_id uuid references public.acclimatization_batches (id) on delete cascade,
  add column rack_label text;

create index smart_tags_bioreactor_id_idx on public.smart_tags (bioreactor_id);
create index smart_tags_culture_batch_id_idx on public.smart_tags (culture_batch_id);
create index smart_tags_medium_recipe_version_id_idx on public.smart_tags (medium_recipe_version_id);
create index smart_tags_acclimatization_batch_id_idx on public.smart_tags (acclimatization_batch_id);
