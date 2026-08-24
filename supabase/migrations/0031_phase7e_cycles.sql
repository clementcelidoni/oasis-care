-- Oasis Care — Phase 7E: immersion/aeration programs, cycle execution
-- journal, and lab alerts.
--
-- Run this once in the Supabase SQL Editor after 0001-0030.

create table public.bioreactor_programs (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bioreactor_programs_workspace_id_idx on public.bioreactor_programs (workspace_id);

alter table public.bioreactor_programs enable row level security;
create policy "Workspace members can manage bioreactor programs" on public.bioreactor_programs
  for all using (public.is_workspace_member(workspace_id));

-- Immutable once created (app-enforced), same convention as
-- medium_recipe_versions.
create table public.bioreactor_program_versions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  program_id uuid not null references public.bioreactor_programs (id) on delete cascade,
  version_number integer not null,
  immersion_enabled boolean not null default true,
  immersion_duration_seconds integer not null default 0,
  immersion_interval_minutes integer not null default 0,
  aeration_enabled boolean not null default true,
  aeration_duration_seconds integer not null default 0,
  aeration_interval_minutes integer not null default 0,
  photoperiod_enabled boolean not null default false,
  light_start_minutes integer,
  light_end_minutes integer,
  target_temperature double precision,
  -- CRITIQUE (spec): hard safety ceiling, never optional/nullable —
  -- a version with no cap is not a valid version.
  max_immersion_duration_seconds integer not null,
  max_aeration_duration_seconds integer not null,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bioreactor_program_versions_program_id_idx on public.bioreactor_program_versions (program_id);

alter table public.bioreactor_program_versions enable row level security;
create policy "Workspace members can manage bioreactor program versions" on public.bioreactor_program_versions
  for all using (public.is_workspace_member(workspace_id));

alter table public.bioreactors
  add column active_program_version_id uuid references public.bioreactor_program_versions (id) on delete set null;

create table public.bioreactor_cycle_executions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bioreactor_id uuid not null references public.bioreactors (id) on delete cascade,
  program_version_id uuid references public.bioreactor_program_versions (id) on delete set null,
  cycle_type text not null,
  planned_start timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  expected_duration_seconds integer not null,
  actual_duration_seconds integer,
  status text not null,
  failure_reason text,
  sensor_snapshot_before text,
  sensor_snapshot_after text,
  updated_at timestamptz not null default now()
);

create index bioreactor_cycle_executions_bioreactor_id_idx on public.bioreactor_cycle_executions (bioreactor_id);

alter table public.bioreactor_cycle_executions enable row level security;
create policy "Workspace members can manage bioreactor cycle executions" on public.bioreactor_cycle_executions
  for all using (public.is_workspace_member(workspace_id));

create table public.biolab_alerts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  alert_type text not null,
  priority text not null,
  message text not null,
  bioreactor_id uuid references public.bioreactors (id) on delete cascade,
  culture_batch_id uuid references public.culture_batches (id) on delete cascade,
  created_at timestamptz not null,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index biolab_alerts_workspace_id_idx on public.biolab_alerts (workspace_id);

alter table public.biolab_alerts enable row level security;
create policy "Workspace members can manage biolab alerts" on public.biolab_alerts
  for all using (public.is_workspace_member(workspace_id));
