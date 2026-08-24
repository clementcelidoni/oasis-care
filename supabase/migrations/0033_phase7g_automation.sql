-- Oasis Care — Phase 7G: automatisation matérielle (device mapping,
-- automatic mode, pause/reprise).
--
-- Run this once in the Supabase SQL Editor after 0001-0032.

alter table public.bioreactors
  add column automation_enabled boolean not null default false,
  add column schedule_resumed_at timestamptz;

create table public.bioreactor_device_bindings (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bioreactor_id uuid not null references public.bioreactors (id) on delete cascade,
  role text not null,
  device_id uuid references public.connected_devices (id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bioreactor_device_bindings_bioreactor_id_idx on public.bioreactor_device_bindings (bioreactor_id);

alter table public.bioreactor_device_bindings enable row level security;
create policy "Workspace members can manage bioreactor device bindings" on public.bioreactor_device_bindings
  for all using (public.is_workspace_member(workspace_id));
