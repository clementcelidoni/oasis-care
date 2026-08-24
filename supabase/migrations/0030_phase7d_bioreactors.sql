-- Oasis Care — Phase 7D: bioreactors + maintenance log.
--
-- Run this once in the Supabase SQL Editor after 0001-0029.

create table public.bioreactors (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  code text not null,
  bioreactor_type text not null,
  total_volume_liters double precision not null,
  working_volume_liters double precision not null,
  status text not null default 'idle',
  component_types jsonb not null default '[]'::jsonb,
  location text not null default '',
  current_batch_id uuid references public.culture_batches (id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bioreactors_workspace_id_idx on public.bioreactors (workspace_id);

alter table public.bioreactors enable row level security;
create policy "Workspace members can manage bioreactors" on public.bioreactors
  for all using (public.is_workspace_member(workspace_id));

create table public.bioreactor_maintenance (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bioreactor_id uuid not null references public.bioreactors (id) on delete cascade,
  date timestamptz not null,
  event_type text not null,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create index bioreactor_maintenance_bioreactor_id_idx on public.bioreactor_maintenance (bioreactor_id);

alter table public.bioreactor_maintenance enable row level security;
create policy "Workspace members can manage bioreactor maintenance" on public.bioreactor_maintenance
  for all using (public.is_workspace_member(workspace_id));
