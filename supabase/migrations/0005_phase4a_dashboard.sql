-- Oasis Care — Phase 4A/4B: dashboard preferences + garden location.
--
-- Adds nullable columns to gardens (spec §16) — never breaks existing
-- rows, matches how CareSchedule/Plant fields were added earlier — and
-- a new dashboard_preferences table, scoped by workspace like every
-- other synced entity (today a personal workspace has exactly one
-- member, so this is effectively "per user" until Pro workspaces
-- exist, same as the rest of the schema).
--
-- Run this once in the Supabase SQL Editor after 0001-0004.

alter table public.gardens
  add column latitude double precision,
  add column longitude double precision,
  add column location_name text,
  add column weather_enabled boolean not null default false;

create table public.dashboard_preferences (
  id uuid primary key,
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  show_today boolean not null default true,
  show_alerts boolean not null default true,
  show_weather boolean not null default true,
  show_oasis_ai boolean not null default true,
  show_water boolean not null default true,
  show_recent_activity boolean not null default true,
  show_upcoming boolean not null default true,
  show_health boolean not null default true,
  show_evolution boolean not null default true,
  updated_at timestamptz not null default now()
);

create index dashboard_preferences_workspace_id_idx on public.dashboard_preferences (workspace_id);

alter table public.dashboard_preferences enable row level security;
create policy "Workspace members can manage dashboard preferences" on public.dashboard_preferences
  for all using (public.is_workspace_member(workspace_id));
