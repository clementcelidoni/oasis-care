-- Oasis Care — Phase 7C: medium recipes, versions, prepared batches.
--
-- Run this once in the Supabase SQL Editor after 0001-0028.

create table public.medium_recipes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  species_name text not null default '',
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index medium_recipes_workspace_id_idx on public.medium_recipes (workspace_id);

alter table public.medium_recipes enable row level security;
create policy "Workspace members can manage medium recipes" on public.medium_recipes
  for all using (public.is_workspace_member(workspace_id));

-- Versions are never updated after creation (app-enforced — see
-- MediumRecipeVersion's own doc comment); components is a structured
-- JSON array (MediumComponentAmount), same jsonb-array convention as
-- garden_areas.points in Phase 6C.
create table public.medium_recipe_versions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipe_id uuid not null references public.medium_recipes (id) on delete cascade,
  version_number integer not null,
  target_ph double precision not null,
  measured_ph double precision,
  components jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index medium_recipe_versions_recipe_id_idx on public.medium_recipe_versions (recipe_id);

alter table public.medium_recipe_versions enable row level security;
create policy "Workspace members can manage medium recipe versions" on public.medium_recipe_versions
  for all using (public.is_workspace_member(workspace_id));

create table public.medium_batches (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  code text not null,
  recipe_version_id uuid references public.medium_recipe_versions (id) on delete set null,
  volume_liters double precision not null,
  prepared_at timestamptz not null,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index medium_batches_workspace_id_idx on public.medium_batches (workspace_id);

alter table public.medium_batches enable row level security;
create policy "Workspace members can manage medium batches" on public.medium_batches
  for all using (public.is_workspace_member(workspace_id));

alter table public.culture_batches
  add column medium_recipe_version_id uuid references public.medium_recipe_versions (id) on delete set null;
