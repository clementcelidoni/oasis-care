-- Oasis Care — Phase 11, Milestone 3 : révisions, plans importés.
--
-- À exécuter après 0044. Idempotente et purement additive.

-- ============================================================
-- 1. Révisions du Digital Twin
-- ============================================================
-- §"VERSIONS DU PROJET — CRITIQUE" : existing / proposal / approved /
-- asBuilt, avec duplication et comparaison entre versions.
--
-- Une révision est un INSTANTANÉ complet en JSON, pas un jeu de
-- pointeurs vers les lignes vivantes. C'est volontaire : une révision
-- « existant » doit continuer de montrer le terrain tel qu'il était
-- avant travaux, même après que quelqu'un ait déplacé chaque objet du
-- plan courant. Des références auraient fait muter le passé.

create table if not exists public.digital_twin_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid not null references public.gardens (id) on delete cascade,

  label text not null,
  state text not null default 'proposal'
    check (state in ('existing', 'proposal', 'approved', 'asBuilt')),

  -- { boundary: [...], areas: [...], objects: [...] }
  snapshot jsonb not null,

  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists digital_twin_revisions_garden_idx
  on public.digital_twin_revisions (garden_id, created_at desc);

alter table public.digital_twin_revisions enable row level security;
drop policy if exists "Workspace members can manage twin revisions" on public.digital_twin_revisions;
create policy "Workspace members can manage twin revisions" on public.digital_twin_revisions
  for all using (public.is_workspace_member(workspace_id));

-- ============================================================
-- 2. Plans importés
-- ============================================================
-- §"IMPORT DE PLAN" + §"CALIBRATION".
--
-- ATTENTION — divergence assumée avec le modèle Swift.
-- `GardenPlanImage` existe côté iOS mais n'a JAMAIS eu de table : il est
-- local à l'appareil. Il stocke l'image en `Data` inline. Ici l'image va
-- dans Supabase Storage et la table ne garde qu'un chemin — mettre
-- plusieurs mégaoctets de PDF ou de photo aérienne en base ralentirait
-- chaque lecture du plan pour rien.
-- Si iOS synchronise ses plans un jour, il devra passer par Storage lui
-- aussi plutôt que d'ajouter une colonne binaire ici.
--
-- Les deux points de calibrage sont en PIXELS de l'image, pas en
-- mètres : ils désignent deux repères sur le document scanné, et c'est
-- la distance réelle saisie par l'utilisateur qui donne l'échelle.

create table if not exists public.garden_plan_images (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid not null references public.gardens (id) on delete cascade,

  storage_path text not null,
  original_filename text,
  content_type text,

  -- Position du coin de l'image dans le repère local, en mètres.
  position_x_meters double precision not null default 0,
  position_y_meters double precision not null default 0,
  rotation_radians double precision not null default 0,
  opacity double precision not null default 0.6 check (opacity between 0 and 1),
  is_visible boolean not null default true,

  -- Calibrage : deux points en pixels image + la distance réelle.
  calibration_point_ax double precision,
  calibration_point_ay double precision,
  calibration_point_bx double precision,
  calibration_point_by double precision,
  calibration_real_distance_meters double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists garden_plan_images_garden_idx
  on public.garden_plan_images (garden_id) where deleted_at is null;

alter table public.garden_plan_images enable row level security;
drop policy if exists "Workspace members can manage garden plan images" on public.garden_plan_images;
create policy "Workspace members can manage garden plan images" on public.garden_plan_images
  for all using (public.is_workspace_member(workspace_id));

-- ============================================================
-- 3. Stockage des plans
-- ============================================================
-- Bucket privé, rangé par workspace — §FICHIERS : « Storage doit être
-- organisé par tenant », et §RLS MULTI-TENANT s'applique aussi au
-- chemin de stockage.

insert into storage.buckets (id, name, public)
values ('garden-plans', 'garden-plans', false)
on conflict (id) do nothing;

-- Le premier segment du chemin est l'id du workspace : un membre ne
-- peut donc lire et écrire que sous le sien.
drop policy if exists "Workspace members read garden plans" on storage.objects;
create policy "Workspace members read garden plans" on storage.objects
  for select using (
    bucket_id = 'garden-plans'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Workspace members write garden plans" on storage.objects;
create policy "Workspace members write garden plans" on storage.objects
  for insert with check (
    bucket_id = 'garden-plans'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Workspace members delete garden plans" on storage.objects;
create policy "Workspace members delete garden plans" on storage.objects
  for delete using (
    bucket_id = 'garden-plans'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

-- ============================================================
-- 4. Détection de conflit
-- ============================================================
-- §CONCURRENCY : « Ne pas écraser silencieusement le travail d'un autre
-- utilisateur. »
--
-- Pas de colonne `version` : l'app iOS écrit dans ces mêmes tables et
-- n'incrémenterait jamais un tel compteur, donc une modification faite
-- depuis le téléphone passerait au travers. `updated_at` existe déjà
-- partout et EST mis à jour par les deux applications — c'est donc le
-- seul signal qui couvre réellement les deux côtés.

create or replace function public.garden_twin_last_modified(p_garden_id uuid)
returns timestamptz
language sql
security invoker
set search_path = public
stable
as $$
  select greatest(
    coalesce((select max(updated_at) from public.garden_map_objects where garden_id = p_garden_id), 'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.garden_areas       where garden_id = p_garden_id), 'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.garden_boundaries  where garden_id = p_garden_id), 'epoch'::timestamptz)
  );
$$;
