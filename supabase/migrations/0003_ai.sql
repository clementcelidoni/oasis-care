-- Oasis Care — Phase 3D AI schema.
--
-- Two tables:
--
-- species_profiles: a SHARED, cross-user cache of generic botanical
-- data (never anything about a specific user's plant). Only the
-- delete-account-style Edge Functions (using the service_role key,
-- which bypasses RLS) may write here — regular users get read-only
-- access, and there is deliberately no insert/update/delete policy for
-- the authenticated role at all. This is what lets 50 users adding a
-- Monstera deliciosa share one generated profile instead of paying for
-- an OpenAI call every time (spec: "coûts IA" / "cache des espèces").
--
-- ai_analyses: per-plant history of AI diagnoses/completions, synced
-- like care_events — append-only, workspace-scoped RLS, no
-- updated_at/deleted_at because a past analysis is a historical record,
-- never edited or hidden.
--
-- Run this once in the Supabase SQL Editor after 0001 and 0002.

-- ============================================================
-- Species profile cache — keyed on a normalized scientific name so
-- "Monstera deliciosa" and "monstera  deliciosa" hit the same row.
-- ============================================================
create table public.species_profiles (
  id uuid primary key default gen_random_uuid(),
  scientific_name text not null,
  normalized_name text not null unique,
  profile_json jsonb not null,
  source text not null default 'openai',
  generated_at timestamptz not null default now(),
  version integer not null default 1
);

-- ============================================================
-- AI analysis history — one row per identification-completion,
-- assistant answer, or problem diagnosis performed for a plant.
-- ============================================================
create table public.ai_analyses (
  id uuid primary key,
  plant_id uuid not null references public.plants (id) on delete cascade,
  type text not null,
  date timestamptz not null default now(),
  summary text not null default '',
  structured_data jsonb,
  provider text not null,
  model text,
  confidence text,
  created_at timestamptz not null default now()
);

create index ai_analyses_plant_id_idx on public.ai_analyses (plant_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.species_profiles enable row level security;
create policy "Authenticated users can read species profiles" on public.species_profiles
  for select using (auth.uid() is not null);

alter table public.ai_analyses enable row level security;
create policy "Workspace members can manage ai analyses" on public.ai_analyses
  for all using (
    exists (
      select 1 from public.plants p
      where p.id = plant_id and public.is_workspace_member(p.workspace_id)
    )
  );
