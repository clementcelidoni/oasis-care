-- Oasis Care — Phase 7A/7B: Oasis BioLab foundation + culture batches.
--
-- Run this once in the Supabase SQL Editor after 0001-0027.

alter table public.dashboard_preferences
  add column show_bio_lab boolean not null default true;

create table public.culture_batches (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_code text not null,
  species_name text not null,
  culture_stage text not null,
  status text not null,
  started_at timestamptz not null,
  expected_end_at timestamptz,
  initial_explant_count integer not null,
  current_count integer not null,
  notes text not null default '',
  created_at timestamptz not null,
  mother_plant_id uuid references public.plants (id) on delete set null,
  parent_batch_id uuid references public.culture_batches (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index culture_batches_workspace_id_idx on public.culture_batches (workspace_id);
create index culture_batches_parent_batch_id_idx on public.culture_batches (parent_batch_id);

alter table public.culture_batches enable row level security;
create policy "Workspace members can manage culture batches" on public.culture_batches
  for all using (public.is_workspace_member(workspace_id));
