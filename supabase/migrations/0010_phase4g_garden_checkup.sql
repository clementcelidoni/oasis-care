-- Oasis Care — Phase 4G: garden check-up flow.
--
-- garden_checkup_entries is append-only (no updated_at) — the
-- walk-through only ever moves forward, matching care_events.
--
-- Run this once in the Supabase SQL Editor after 0001-0009.

create table public.garden_checkups (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid not null references public.gardens (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  filter_category text not null,
  filter_zone_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.garden_checkup_entries (
  id uuid primary key,
  checkup_id uuid not null references public.garden_checkups (id) on delete cascade,
  plant_id uuid not null references public.plants (id) on delete cascade,
  date timestamptz not null default now(),
  result text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Photos taken during a check-up entry (spec §62's "Photo" button)
-- link back to it — nullable and ON DELETE SET NULL, matching the
-- local .nullify rule: abandoning a check-up never deletes the photo.
alter table public.plant_photos
  add column checkup_entry_id uuid references public.garden_checkup_entries (id) on delete set null;

create index garden_checkups_garden_id_idx on public.garden_checkups (garden_id);
create index garden_checkup_entries_checkup_id_idx on public.garden_checkup_entries (checkup_id);
create index garden_checkup_entries_plant_id_idx on public.garden_checkup_entries (plant_id);
create index plant_photos_checkup_entry_id_idx on public.plant_photos (checkup_entry_id);

alter table public.garden_checkups enable row level security;
create policy "Workspace members can manage garden checkups" on public.garden_checkups
  for all using (public.is_workspace_member(workspace_id));

alter table public.garden_checkup_entries enable row level security;
create policy "Workspace members can manage garden checkup entries" on public.garden_checkup_entries
  for all using (
    exists (
      select 1 from public.garden_checkups c
      where c.id = checkup_id and public.is_workspace_member(c.workspace_id)
    )
  );
