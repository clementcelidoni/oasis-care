-- Oasis Care — Phase 7 enhancement: BioLab audit trail (§48/§49).
--
-- Run this once in the Supabase SQL Editor after 0001-0039.

create table public.biolab_audit_entries (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  detail text not null default '',
  performed_by text,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index biolab_audit_entries_workspace_id_idx on public.biolab_audit_entries (workspace_id);
create index biolab_audit_entries_entity_id_idx on public.biolab_audit_entries (entity_id);

alter table public.biolab_audit_entries enable row level security;
create policy "Workspace members can manage biolab audit entries" on public.biolab_audit_entries
  for all using (public.is_workspace_member(workspace_id));
