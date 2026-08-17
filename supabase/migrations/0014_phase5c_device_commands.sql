-- Oasis Care — Phase 5C: actuator command audit log (spec §91).
--
-- Append-only — every DeviceCommandService call writes one row here,
-- success or failure, manual or (from Phase 5D) automation-triggered.
--
-- Run this once in the Supabase SQL Editor after 0001-0013.

create table public.device_commands (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  device_id uuid references public.connected_devices (id) on delete set null,
  command text not null,
  trigger text not null,
  trigger_rule_id uuid,
  requested_at timestamptz not null default now(),
  succeeded boolean not null,
  error_message text,
  requested_duration_seconds double precision,
  created_at timestamptz not null default now()
);

create index device_commands_device_id_idx on public.device_commands (device_id);
create index device_commands_requested_at_idx on public.device_commands (requested_at);

alter table public.device_commands enable row level security;
create policy "Workspace members can manage device commands" on public.device_commands
  for all using (public.is_workspace_member(workspace_id));
