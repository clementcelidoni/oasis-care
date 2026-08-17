-- Oasis Care — Phase 5L: scenes.
--
-- Run this once in the Supabase SQL Editor after 0001-0020.

create table public.scenes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  name text not null,
  icon text not null default 'sparkles',
  greenhouse_id uuid references public.greenhouses (id) on delete set null,
  set_climate_control_enabled boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.scene_actions (
  id uuid primary key,
  scene_id uuid not null references public.scenes (id) on delete cascade,
  device_id uuid references public.connected_devices (id) on delete cascade,
  capability text not null,
  target_on boolean not null,
  "order" integer not null default 0
);

create index scenes_garden_id_idx on public.scenes (garden_id);
create index scene_actions_scene_id_idx on public.scene_actions (scene_id);

alter table public.scenes enable row level security;
create policy "Workspace members can manage scenes" on public.scenes
  for all using (public.is_workspace_member(workspace_id));

alter table public.scene_actions enable row level security;
create policy "Workspace members can manage scene actions" on public.scene_actions
  for all using (
    exists (
      select 1 from public.scenes s
      where s.id = scene_id and public.is_workspace_member(s.workspace_id)
    )
  );
