-- Oasis Care — Phase 7H: inspections de culture (contamination,
-- hyperhydricité, nécrose, brunissement, photos catégorisées).
--
-- Run this once in the Supabase SQL Editor after 0001-0033.

create table public.bioreactor_inspections (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  culture_batch_id uuid references public.culture_batches (id) on delete cascade,
  bioreactor_id uuid references public.bioreactors (id) on delete set null,
  date timestamptz not null,
  culture_appearance text not null default '',
  contamination_status text not null default 'noneObserved',
  hyperhydricity_status text not null default 'none',
  necrosis_status text not null default 'none',
  browning_status text not null default 'none',
  growth_status text not null default '',
  estimated_count integer,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bioreactor_inspections_culture_batch_id_idx on public.bioreactor_inspections (culture_batch_id);

alter table public.bioreactor_inspections enable row level security;
create policy "Workspace members can manage bioreactor inspections" on public.bioreactor_inspections
  for all using (public.is_workspace_member(workspace_id));

-- Same "no direct workspace_id, join through the parent" shape as
-- plant_photos (0001) — storage paths, not inline image data.
create table public.biolab_inspection_photos (
  id uuid primary key,
  inspection_id uuid not null references public.bioreactor_inspections (id) on delete cascade,
  storage_path text not null,
  thumbnail_storage_path text not null,
  category text not null,
  date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index biolab_inspection_photos_inspection_id_idx on public.biolab_inspection_photos (inspection_id);

alter table public.biolab_inspection_photos enable row level security;
create policy "Workspace members can manage biolab inspection photos" on public.biolab_inspection_photos
  for all using (
    exists (
      select 1 from public.bioreactor_inspections i
      where i.id = inspection_id and public.is_workspace_member(i.workspace_id)
    )
  );
