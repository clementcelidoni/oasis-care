-- Oasis Care — Phase 3B initial cloud schema.
--
-- Mirrors the existing SwiftData models (Plant, Garden, GardenZone,
-- CareEvent, CareSchedule, PlantPhoto) plus the account/workspace layer
-- from Phase 3A. Every row a client creates keeps the SAME id it already
-- has locally (the app always supplies `id` explicitly — nothing here
-- auto-generates ids for synced entities, only for server-created rows
-- like workspaces) so SwiftData UUID and Supabase id never diverge.
--
-- Row Level Security is enabled from the start, not deferred to Phase 3C:
-- real personal data starts flowing into these tables as soon as sync
-- goes live, so "workspace member" ownership checks ship with the schema
-- itself. Phase 3C is about the fuller security review and the
-- account-deletion cascade, not about whether RLS exists at all.
--
-- Run this once in the Supabase SQL Editor (Database → SQL Editor → New
-- query → paste → Run). It only creates new tables; nothing here touches
-- or deletes existing data.

-- ============================================================
-- Profiles — one row per auth.users, app-facing profile data.
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  first_name text,
  last_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Workspaces — every user gets a personal workspace automatically.
-- The professional/multi-employee workspace type mentioned in the
-- spec is not built yet; `is_personal` is the seam for it later.
-- ============================================================
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  is_personal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ============================================================
-- Gardens / zones
-- ============================================================
create table public.gardens (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  address text,
  notes text not null default '',
  date_created timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.garden_zones (
  id uuid primary key,
  garden_id uuid not null references public.gardens (id) on delete cascade,
  name text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ============================================================
-- Plants — the main photo is stored twice (thumbnail + detail),
-- same split as the local SwiftData model, so lists never have to
-- fetch/decode a full-size image just to show a thumbnail.
-- ============================================================
create table public.plants (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete set null,
  zone_id uuid references public.garden_zones (id) on delete set null,
  custom_name text not null,
  common_name text,
  scientific_name text,
  type text not null,
  is_indoor boolean not null default true,
  notes text not null default '',
  date_added timestamptz not null default now(),
  health_status text not null default 'healthy',
  is_archived boolean not null default false,
  photo_storage_path text,
  thumbnail_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.plant_photos (
  id uuid primary key,
  plant_id uuid not null references public.plants (id) on delete cascade,
  storage_path text not null,
  thumbnail_storage_path text not null,
  date timestamptz not null default now(),
  notes text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ============================================================
-- Care events / schedules — events are append-only (no updated_at,
-- no deleted_at): never edit or hide a historical event, matching
-- the local model's "immutable record" rule.
-- ============================================================
create table public.care_events (
  id uuid primary key,
  plant_id uuid not null references public.plants (id) on delete cascade,
  type text not null,
  date timestamptz not null default now(),
  notes text not null default '',
  quantity double precision,
  unit text,
  product text,
  photo_storage_path text,
  created_at timestamptz not null default now()
);

create table public.care_schedules (
  id uuid primary key,
  plant_id uuid not null references public.plants (id) on delete cascade,
  type text not null,
  is_active boolean not null default true,
  frequency_days integer not null,
  last_completed_date timestamptz,
  next_due_date timestamptz,
  notes text not null default '',
  preferred_time_minutes integer,
  reminder_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ============================================================
-- Indexes for the lookups the app actually does.
-- ============================================================
create index gardens_workspace_id_idx on public.gardens (workspace_id);
create index garden_zones_garden_id_idx on public.garden_zones (garden_id);
create index plants_workspace_id_idx on public.plants (workspace_id);
create index plants_garden_id_idx on public.plants (garden_id);
create index plants_zone_id_idx on public.plants (zone_id);
create index plant_photos_plant_id_idx on public.plant_photos (plant_id);
create index care_events_plant_id_idx on public.care_events (plant_id);
create index care_schedules_plant_id_idx on public.care_schedules (plant_id);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- ============================================================
-- Auto-provisioning: new auth user → profile + personal workspace.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), new.email);

  insert into public.workspaces (owner_id, name, is_personal)
  values (new.id, 'Mon espace', true)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Row Level Security — a user may only touch data in a workspace
-- they belong to. is_workspace_member() is SECURITY DEFINER so
-- policies can call it without each one re-deriving the same join.
-- ============================================================
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
create policy "Users can view their own profile" on public.profiles
  for select using (id = auth.uid());
create policy "Users can update their own profile" on public.profiles
  for update using (id = auth.uid());

alter table public.workspaces enable row level security;
create policy "Members can view their workspaces" on public.workspaces
  for select using (public.is_workspace_member(id));
create policy "Owners can update their workspace" on public.workspaces
  for update using (owner_id = auth.uid());

alter table public.workspace_members enable row level security;
create policy "Members can view their own membership rows" on public.workspace_members
  for select using (user_id = auth.uid());

alter table public.gardens enable row level security;
create policy "Workspace members can manage gardens" on public.gardens
  for all using (public.is_workspace_member(workspace_id));

alter table public.garden_zones enable row level security;
create policy "Workspace members can manage garden zones" on public.garden_zones
  for all using (
    exists (
      select 1 from public.gardens g
      where g.id = garden_id and public.is_workspace_member(g.workspace_id)
    )
  );

alter table public.plants enable row level security;
create policy "Workspace members can manage plants" on public.plants
  for all using (public.is_workspace_member(workspace_id));

alter table public.plant_photos enable row level security;
create policy "Workspace members can manage plant photos" on public.plant_photos
  for all using (
    exists (
      select 1 from public.plants p
      where p.id = plant_id and public.is_workspace_member(p.workspace_id)
    )
  );

alter table public.care_events enable row level security;
create policy "Workspace members can manage care events" on public.care_events
  for all using (
    exists (
      select 1 from public.plants p
      where p.id = plant_id and public.is_workspace_member(p.workspace_id)
    )
  );

alter table public.care_schedules enable row level security;
create policy "Workspace members can manage care schedules" on public.care_schedules
  for all using (
    exists (
      select 1 from public.plants p
      where p.id = plant_id and public.is_workspace_member(p.workspace_id)
    )
  );
