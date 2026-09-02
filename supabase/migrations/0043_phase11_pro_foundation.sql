-- Oasis Care — Phase 11, Milestone 1 : fondation Oasis Care Pro.
--
-- À exécuter dans l'éditeur SQL Supabase, APRÈS 0042.
--
-- IDEMPOTENT et purement ADDITIF : aucune table de 0001-0042 n'est
-- modifiée ni supprimée, à une exception près, `workspaces.type`, qui
-- est une colonne AJOUTÉE et dérivée de `is_personal` (conservée telle
-- quelle pour ne rien casser côté iOS).
--
-- Modèle de sécurité : le workspace reste la frontière principale, déjà
-- éprouvée sur ~65 tables via is_workspace_member(). Une organisation
-- professionnelle est la façade « entreprise » d'un workspace (1:1) et
-- porte ce que le workspace ne sait pas exprimer : des rôles riches et
-- des permissions granulaires. Les tables Pro s'isolent par
-- organization_id, jamais par une vérification côté client.

-- ============================================================
-- 1. Workspace : type personnel / professionnel
-- ============================================================

-- `is_personal` existe depuis 0001 et l'app iOS s'en sert : on l'ajoute
-- à côté plutôt que de la remplacer, et on la dérive une seule fois.
alter table public.workspaces
  add column if not exists type text not null default 'personal'
  check (type in ('personal', 'professional'));

update public.workspaces set type = 'personal' where is_personal and type is distinct from 'personal';
update public.workspaces set type = 'professional' where not is_personal and type is distinct from 'professional';

-- ============================================================
-- 2. Organisation
-- ============================================================

create table if not exists public.business_organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  name text not null,
  legal_name text,
  trade_name text,

  country text not null default 'FR',
  currency text not null default 'EUR',
  timezone text not null default 'Europe/Paris',
  locale text not null default 'fr',

  -- §"TYPES D'ENTREPRISE" — l'interface s'adapte à cette valeur.
  business_type text not null default 'landscaper'
    check (business_type in (
      'landscaper', 'nursery', 'landscaperAndNursery',
      'horticulturalProducer', 'gardenMaintenance', 'other'
    )),

  logo_path text,
  contact_details jsonb not null default '{}'::jsonb,
  tax_configuration jsonb not null default '{}'::jsonb,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id)
);

-- ============================================================
-- 3. Membres et rôles
-- ============================================================

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  role text not null default 'readOnly'
    check (role in (
      'owner', 'admin', 'manager', 'sales', 'designer', 'projectManager',
      'teamLeader', 'fieldWorker', 'nurseryManager', 'nurseryWorker',
      'orderPicker', 'accounting', 'readOnly', 'custom'
    )),

  -- Utilisé uniquement quand role = 'custom' : liste explicite de
  -- permissions, qui remplace alors la table role_permissions.
  custom_permissions text[] not null default '{}',

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, user_id)
);

create index if not exists organization_members_user_id_idx on public.organization_members (user_id);

-- ============================================================
-- 4. Catalogue de permissions
-- ============================================================
-- §"Ne pas coder les autorisations directement écran par écran." Les
-- permissions vivent en base, pas dans le code de chaque page, et la
-- vérification est faite côté serveur (voir has_permission plus bas).

create table if not exists public.role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);

-- Seed. `owner` et `admin` sont volontairement absents de cette table :
-- has_permission() leur accorde tout, ce qui évite d'avoir à ré-seeder
-- ces deux rôles à chaque nouvelle permission ajoutée plus tard.
insert into public.role_permissions (role, permission) values
  -- Commercial
  ('manager','clients.read'), ('manager','clients.write'),
  ('manager','quotes.read'), ('manager','quotes.create'), ('manager','quotes.edit'), ('manager','quotes.approve'),
  ('manager','projects.read'), ('manager','projects.manage'),
  ('manager','digitalTwin.edit'), ('manager','nursery.stock.manage'), ('manager','invoice.create'),
  ('sales','clients.read'), ('sales','clients.write'),
  ('sales','quotes.read'), ('sales','quotes.create'), ('sales','quotes.edit'),
  ('sales','projects.read'),
  -- Conception
  ('designer','clients.read'),
  ('designer','projects.read'),
  ('designer','digitalTwin.edit'),
  ('designer','quotes.read'), ('designer','quotes.create'),
  -- Chantier
  ('projectManager','clients.read'),
  ('projectManager','projects.read'), ('projectManager','projects.manage'),
  ('projectManager','quotes.read'), ('projectManager','digitalTwin.edit'),
  ('teamLeader','projects.read'), ('teamLeader','projects.manage'),
  ('fieldWorker','projects.read'),
  -- Pépinière
  ('nurseryManager','nursery.stock.manage'), ('nurseryManager','projects.read'), ('nurseryManager','clients.read'),
  ('nurseryWorker','nursery.stock.manage'),
  ('orderPicker','nursery.stock.manage'),
  -- Administratif
  ('accounting','clients.read'), ('accounting','quotes.read'), ('accounting','invoice.create'),
  ('accounting','projects.read'),
  -- Lecture seule
  ('readOnly','clients.read'), ('readOnly','quotes.read'), ('readOnly','projects.read')
on conflict (role, permission) do nothing;

-- ============================================================
-- 5. Invitations
-- ============================================================

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  email text not null,
  role text not null default 'readOnly',
  -- Jeton opaque : c'est lui qui circule dans le lien d'invitation,
  -- jamais l'id de l'organisation.
  token text not null unique default encode(gen_random_bytes(32), 'hex'),

  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),

  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists organization_invitations_email_idx on public.organization_invitations (lower(email));
create index if not exists organization_invitations_org_idx on public.organization_invitations (organization_id);

-- ============================================================
-- 6. Journal d'audit
-- ============================================================
-- §"AUDIT LOG — pour opérations critiques." Append-only du point de vue
-- d'un client : aucune politique d'update ni de delete n'est créée.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.business_organizations (id) on delete set null,

  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,

  old_value jsonb,
  new_value jsonb,

  -- 'web' | 'ios' | 'system' — d'où vient l'action.
  source text not null default 'web',
  occurred_at timestamptz not null default now()
);

create index if not exists audit_events_org_idx on public.audit_events (organization_id, occurred_at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);

-- ============================================================
-- 7. Fonctions de sécurité
-- ============================================================
-- Même forme que is_workspace_member() de 0001 : `security definer`
-- pour que la politique puisse lire organization_members sans que la
-- politique de cette table ne se rappelle elle-même à l'infini.

create or replace function public.is_organization_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.archived_at is null
  );
$$;

-- Vérification de permission, faite EN BASE (§"permissions
-- server-side") : une page web ne peut pas se l'accorder à elle-même en
-- modifiant son état local.
create or replace function public.has_permission(org_id uuid, required_permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.archived_at is null
      and (
        -- owner/admin : tout, sans seed à maintenir.
        m.role in ('owner', 'admin')
        or (m.role = 'custom' and required_permission = any (m.custom_permissions))
        or exists (
          select 1 from public.role_permissions rp
          where rp.role = m.role and rp.permission = required_permission
        )
      )
  );
$$;

-- ============================================================
-- 8. RLS
-- ============================================================

alter table public.business_organizations enable row level security;
drop policy if exists "Members can read their organization" on public.business_organizations;
create policy "Members can read their organization" on public.business_organizations
  for select using (public.is_organization_member(id));
drop policy if exists "Admins can update their organization" on public.business_organizations;
create policy "Admins can update their organization" on public.business_organizations
  for update using (public.has_permission(id, 'organization.manageUsers'));
-- La création passe par create_professional_organization() ci-dessous :
-- il n'y a volontairement aucune politique d'insert, sinon n'importe qui
-- pourrait créer une organisation rattachée au workspace d'un autre.

alter table public.organization_members enable row level security;
drop policy if exists "Members can read the member list" on public.organization_members;
create policy "Members can read the member list" on public.organization_members
  for select using (public.is_organization_member(organization_id));
drop policy if exists "User managers can write members" on public.organization_members;
create policy "User managers can write members" on public.organization_members
  for all using (public.has_permission(organization_id, 'organization.manageUsers'));

alter table public.role_permissions enable row level security;
drop policy if exists "Anyone authenticated can read the permission catalogue" on public.role_permissions;
create policy "Anyone authenticated can read the permission catalogue" on public.role_permissions
  for select using (auth.uid() is not null);

alter table public.organization_invitations enable row level security;
drop policy if exists "User managers can manage invitations" on public.organization_invitations;
create policy "User managers can manage invitations" on public.organization_invitations
  for all using (public.has_permission(organization_id, 'organization.manageUsers'));
-- Un invité doit pouvoir lire SA propre invitation avant d'être membre.
drop policy if exists "Invitees can read their own invitation" on public.organization_invitations;
create policy "Invitees can read their own invitation" on public.organization_invitations
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

alter table public.audit_events enable row level security;
drop policy if exists "Members can read their organization audit log" on public.audit_events;
create policy "Members can read their organization audit log" on public.audit_events
  for select using (public.is_organization_member(organization_id));
drop policy if exists "Members can append audit events" on public.audit_events;
create policy "Members can append audit events" on public.audit_events
  for insert with check (
    public.is_organization_member(organization_id)
    and actor_user_id = auth.uid()
  );
-- Pas de politique d'update ni de delete : un journal d'audit modifiable
-- ne vaut rien.

-- ============================================================
-- 9. Création d'une organisation
-- ============================================================
-- Crée le workspace professionnel, l'organisation et le premier membre
-- (owner) en une seule transaction. `security definer` parce que
-- business_organizations n'a délibérément aucune politique d'insert.

create or replace function public.create_professional_organization(
  org_name text,
  org_business_type text default 'landscaper'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
  new_org_id uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Authentification requise.';
  end if;
  if coalesce(trim(org_name), '') = '' then
    raise exception 'Le nom de l''organisation est obligatoire.';
  end if;

  insert into public.workspaces (owner_id, name, is_personal, type)
  values (caller, org_name, false, 'professional')
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, caller, 'owner')
  on conflict do nothing;

  insert into public.business_organizations (workspace_id, name, business_type)
  values (new_workspace_id, org_name, org_business_type)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, caller, 'owner');

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, new_value, source)
  values (new_org_id, caller, 'organization.created', 'business_organization', new_org_id,
          jsonb_build_object('name', org_name, 'businessType', org_business_type), 'web');

  return new_org_id;
end $$;

-- ============================================================
-- 10. Acceptation d'une invitation
-- ============================================================

create or replace function public.accept_organization_invitation(invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invitations%rowtype;
  caller uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if caller is null then
    raise exception 'Authentification requise.';
  end if;

  select * into inv from public.organization_invitations
  where token = invitation_token;

  if inv.id is null then
    raise exception 'Invitation introuvable.';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Cette invitation n''est plus valable.';
  end if;
  if inv.expires_at < now() then
    update public.organization_invitations set status = 'expired' where id = inv.id;
    raise exception 'Cette invitation a expiré.';
  end if;
  -- L'invitation est nominative : le jeton seul ne suffit pas.
  if lower(inv.email) <> caller_email then
    raise exception 'Cette invitation a été émise pour une autre adresse e-mail.';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (inv.organization_id, caller, inv.role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role, archived_at = null, updated_at = now();

  -- L'invité doit aussi rejoindre le workspace, sinon il ne verrait
  -- aucune des données métier isolées par is_workspace_member().
  insert into public.workspace_members (workspace_id, user_id, role)
  select o.workspace_id, caller, inv.role
  from public.business_organizations o where o.id = inv.organization_id
  on conflict do nothing;

  update public.organization_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = caller
  where id = inv.id;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, new_value, source)
  values (inv.organization_id, caller, 'organization.memberJoined', 'organization_member', inv.id,
          jsonb_build_object('role', inv.role), 'web');

  return inv.organization_id;
end $$;
