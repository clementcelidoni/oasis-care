-- Oasis Care — Phase 7K: expérimentations (groupes, variables).
--
-- Run this once in the Supabase SQL Editor after 0001-0034.

create table public.bio_lab_experiments (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  code text not null,
  question text not null,
  independent_variables text not null default '',
  controlled_variables text not null default '',
  outcomes text not null default '',
  notes text not null default '',
  started_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bio_lab_experiments_workspace_id_idx on public.bio_lab_experiments (workspace_id);

alter table public.bio_lab_experiments enable row level security;
create policy "Workspace members can manage biolab experiments" on public.bio_lab_experiments
  for all using (public.is_workspace_member(workspace_id));

create table public.experiment_groups (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  experiment_id uuid not null references public.bio_lab_experiments (id) on delete cascade,
  name text not null,
  program_version_id uuid references public.bioreactor_program_versions (id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index experiment_groups_experiment_id_idx on public.experiment_groups (experiment_id);

alter table public.experiment_groups enable row level security;
create policy "Workspace members can manage experiment groups" on public.experiment_groups
  for all using (public.is_workspace_member(workspace_id));

alter table public.culture_batches
  add column experiment_group_id uuid references public.experiment_groups (id) on delete set null;

create index culture_batches_experiment_group_id_idx on public.culture_batches (experiment_group_id);
