-- Oasis Care — Phase 7 enhancement: recipe version genealogy/changelog.
--
-- Run this once in the Supabase SQL Editor after 0001-0038.

alter table public.medium_recipe_versions
  add column change_reason text not null default '',
  add column parent_version_id uuid references public.medium_recipe_versions (id) on delete set null;

create index medium_recipe_versions_parent_version_id_idx on public.medium_recipe_versions (parent_version_id);
