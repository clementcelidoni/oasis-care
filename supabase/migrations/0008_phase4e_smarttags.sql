-- Oasis Care — Phase 4E: QR/NFC smart tags.
--
-- No garden_id/zone_id columns: always derivable via plant_id -> plants
-- (garden_id/zone_id), so there's nothing to keep in sync if a plant
-- moves. `active` lets a tag be revoked without losing its history; a
-- true dissociation instead deletes the row outright (see
-- DeletionService.delete(_:SmartTag,in:) / pushPendingDeletions).
--
-- Run this once in the Supabase SQL Editor after 0001-0007.

create table public.smart_tags (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plant_id uuid not null references public.plants (id) on delete cascade,
  type text not null,
  public_token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_scanned_at timestamptz
);

create index smart_tags_plant_id_idx on public.smart_tags (plant_id);
create index smart_tags_public_token_idx on public.smart_tags (public_token);

alter table public.smart_tags enable row level security;

-- Spec §51: a token must never bypass permissions/RLS. This is the
-- same is_workspace_member policy every other table uses — resolving a
-- token still requires being a member of the workspace that owns the
-- plant it points to, matching SmartTagService.resolveRemotely's
-- public_token lookup.
create policy "Workspace members can manage smart tags" on public.smart_tags
  for all using (public.is_workspace_member(workspace_id));
