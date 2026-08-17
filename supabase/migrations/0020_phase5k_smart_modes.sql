-- Oasis Care — Phase 5K: smart modes.
--
-- One row per workspace, same shape/upsert-on-workspace_id convention
-- as dashboard_preferences — a standing per-account setting, not a
-- per-device or per-garden one.
--
-- Run this once in the Supabase SQL Editor after 0001-0019.

create table public.smart_mode_settings (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade unique,
  vacation_mode_enabled boolean not null default false,
  vacation_start_date timestamptz,
  vacation_end_date timestamptz,
  winter_mode_enabled boolean not null default false,
  water_saving_mode_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.smart_mode_settings enable row level security;
create policy "Workspace members can manage smart mode settings" on public.smart_mode_settings
  for all using (public.is_workspace_member(workspace_id));
