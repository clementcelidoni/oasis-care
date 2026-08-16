-- Oasis Care — backfill workspaces for accounts created before the
-- handle_new_user() trigger existed.
--
-- The trigger in 0001_initial_schema.sql only fires on INSERT into
-- auth.users — any account created before that migration ran (e.g.
-- during early Phase 3A testing, before 0001 was executed) has an
-- auth.users row but no matching profiles/workspaces/workspace_members
-- row, so fetchWorkspaceID() in the app finds nothing and sync fails
-- with "Aucun espace de travail trouvé pour ce compte."
--
-- Safe to run more than once, and safe on a database where every
-- account already has a workspace: every insert is guarded by a check
-- for an existing row, so already-provisioned accounts are untouched.
--
-- Run this once in the Supabase SQL Editor.

insert into public.profiles (id, display_name, email)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.email), u.email
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.workspaces (owner_id, name, is_personal)
select u.id, 'Mon espace', true
from auth.users u
where not exists (select 1 from public.workspaces w where w.owner_id = u.id);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
where not exists (
  select 1 from public.workspace_members m
  where m.workspace_id = w.id and m.user_id = w.owner_id
);
