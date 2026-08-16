-- Oasis Care — Phase 3B photo storage.
--
-- Private bucket for plant photos, paths shaped
-- {workspaceId}/{plantId}/{photoId}.jpg — mirrors the same
-- workspace-membership ownership check as the Postgres tables via the
-- is_workspace_member() helper from 0001_initial_schema.sql, applied to
-- the first path segment via storage.foldername().
--
-- Run this once in the Supabase SQL Editor, after 0001_initial_schema.sql.

insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

create policy "Workspace members can read their plant photos"
on storage.objects for select
using (
  bucket_id = 'plant-photos'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);

create policy "Workspace members can upload their plant photos"
on storage.objects for insert
with check (
  bucket_id = 'plant-photos'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);

create policy "Workspace members can update their plant photos"
on storage.objects for update
using (
  bucket_id = 'plant-photos'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);

create policy "Workspace members can delete their plant photos"
on storage.objects for delete
using (
  bucket_id = 'plant-photos'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);
