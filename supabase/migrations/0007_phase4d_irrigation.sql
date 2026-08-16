-- Oasis Care — Phase 4D: irrigation zones and events.
--
-- IrrigationEvent has no updated_at/deleted_at — append-only like
-- care_events, a logged cycle is never edited after the fact.
--
-- Run this once in the Supabase SQL Editor after 0001-0006.

create table public.irrigation_zones (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid not null references public.gardens (id) on delete cascade,
  name text not null,
  type text not null,
  flow_rate double precision,
  flow_rate_unit text not null default 'L/h',
  duration_minutes integer,
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.irrigation_events (
  id uuid primary key,
  zone_id uuid not null references public.irrigation_zones (id) on delete cascade,
  date timestamptz not null default now(),
  duration_minutes integer not null,
  estimated_liters double precision not null,
  is_automatic boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Plant emitter fields + irrigation zone association, plus map columns
-- from 4C's own migration (kept here since irrigation_zone_id has a
-- foreign key dependency on the table just created above).
alter table public.plants
  add column irrigation_zone_id uuid references public.irrigation_zones (id) on delete set null,
  add column emitter_count integer,
  add column emitter_flow_rate double precision;

create index irrigation_zones_garden_id_idx on public.irrigation_zones (garden_id);
create index irrigation_events_zone_id_idx on public.irrigation_events (zone_id);
create index plants_irrigation_zone_id_idx on public.plants (irrigation_zone_id);

alter table public.irrigation_zones enable row level security;
create policy "Workspace members can manage irrigation zones" on public.irrigation_zones
  for all using (public.is_workspace_member(workspace_id));

alter table public.irrigation_events enable row level security;
create policy "Workspace members can manage irrigation events" on public.irrigation_events
  for all using (
    exists (
      select 1 from public.irrigation_zones z
      where z.id = zone_id and public.is_workspace_member(z.workspace_id)
    )
  );
