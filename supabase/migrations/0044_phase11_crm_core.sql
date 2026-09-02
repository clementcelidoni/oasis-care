-- Oasis Care — Phase 11, Milestone 2 : CRM Core.
--
-- À exécuter après 0043. Idempotente et purement additive.
--
-- CHOIX DE MODÉLISATION — Lead et Customer partagent une table.
--
-- §11B liste « Lead » et « Customer » comme deux entités. Ils sont ici
-- une seule table `crm_customers` distinguée par `lifecycle_stage`,
-- parce que le PRINCIPE FONDAMENTAL du document est : « Une donnée ne
-- doit être saisie qu'UNE SEULE FOIS. NE PAS demander à l'utilisateur
-- de ressaisir les mêmes données à chaque étape. »
--
-- Avec deux tables, convertir un prospect en client oblige à recopier
-- nom, téléphones, e-mails, adresses et historique — ou à maintenir un
-- lien entre deux fiches qui divergent. Avec une table, la conversion
-- est un changement de statut : rien n'est copié, rien ne se perd, et
-- l'historique du prospect reste attaché au client qu'il est devenu.
--
-- L'interface conserve la distinction demandée par la navigation
-- (CRM → Prospects / Clients / Opportunités) : c'est un filtre sur
-- `lifecycle_stage`, pas une table différente.

-- ============================================================
-- 1. Clients et prospects
-- ============================================================

create table if not exists public.crm_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- 'lead' = prospect, 'customer' = client, 'lost' = affaire perdue.
  -- Un prospect gagné devient 'customer' sans qu'aucune donnée bouge.
  lifecycle_stage text not null default 'lead'
    check (lifecycle_stage in ('lead', 'customer', 'lost')),

  -- §"PROSPECT — Workflow configurable". Ne concerne que les prospects ;
  -- conservé après conversion pour garder la trace du parcours.
  prospect_status text not null default 'new'
    check (prospect_status in (
      'new', 'contacted', 'visitScheduled', 'quoteInProgress', 'quoteSent', 'won', 'lost'
    )),

  kind text not null default 'individual' check (kind in ('individual', 'company')),

  -- Nom affiché : raison sociale pour une entreprise, nom complet pour
  -- un particulier. Toujours renseigné, c'est ce qu'on lit dans les listes.
  display_name text not null,
  legal_name text,
  siret text,
  vat_number text,

  email text,
  phone text,
  mobile text,

  billing_address_line1 text,
  billing_address_line2 text,
  billing_postal_code text,
  billing_city text,
  billing_country text default 'FR',

  source text,
  -- Commercial qui suit l'affaire.
  owner_user_id uuid references auth.users (id) on delete set null,
  notes text,

  lost_reason text,
  converted_at timestamptz,

  -- §SOFT DELETE : « Ne jamais détruire aveuglément... devis accepté ».
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists crm_customers_org_idx on public.crm_customers (organization_id, lifecycle_stage);
create index if not exists crm_customers_owner_idx on public.crm_customers (owner_user_id);
-- Recherche plein texte simple sur les champs qu'on cherche vraiment.
create index if not exists crm_customers_search_idx on public.crm_customers
  using gin (to_tsvector('simple',
    coalesce(display_name,'') || ' ' || coalesce(legal_name,'') || ' ' ||
    coalesce(email,'') || ' ' || coalesce(billing_city,'')));

-- ============================================================
-- 2. Contacts
-- ============================================================
-- §"Une fiche client regroupe : contacts, téléphones, emails..." — une
-- entreprise a plusieurs interlocuteurs, un particulier en a souvent
-- deux (le couple). Table séparée plutôt que des colonnes numérotées.

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete cascade,

  first_name text,
  last_name text not null,
  job_title text,

  email text,
  phone text,
  mobile text,

  is_primary boolean not null default false,
  notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contacts_customer_idx on public.crm_contacts (customer_id);

-- ============================================================
-- 3. Sites / propriétés
-- ============================================================
-- §"CustomerSite" + §"propriétés ; jardins". Un client peut avoir
-- plusieurs propriétés (résidence principale, maison de vacances, siège
-- + agences pour une entreprise).
--
-- `garden_id` est le pont vers l'existant : le jardin est une vraie
-- ligne de `gardens`, la même table que l'app iPhone alimente depuis la
-- Phase 1. C'est ce qui permet §"JARDIN PRO → PARTICULIER" plus tard —
-- livrer le jardin au client, sans le recréer.

create table if not exists public.crm_customer_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete cascade,

  name text not null,
  site_type text not null default 'residence'
    check (site_type in ('residence', 'secondaryResidence', 'business', 'publicSpace', 'other')),

  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text default 'FR',

  latitude double precision,
  longitude double precision,
  surface_sqm double precision,

  access_notes text,

  -- Nullable : un site existe avant qu'un jardin soit modélisé.
  -- `on delete set null` et pas cascade : supprimer un jardin ne doit
  -- pas faire disparaître l'adresse du client.
  garden_id uuid references public.gardens (id) on delete set null,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_customer_sites_customer_idx on public.crm_customer_sites (customer_id);
create index if not exists crm_customer_sites_garden_idx on public.crm_customer_sites (garden_id);

-- ============================================================
-- 4. Opportunités
-- ============================================================

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete cascade,
  site_id uuid references public.crm_customer_sites (id) on delete set null,

  title text not null,
  stage text not null default 'qualification'
    check (stage in ('qualification', 'visit', 'design', 'quoted', 'negotiation', 'won', 'lost')),

  -- Montant estimé, saisi par le commercial. Jamais calculé par Oasis :
  -- le vrai montant viendra du devis (Milestone 5).
  estimated_value_cents bigint,
  currency text not null default 'EUR',
  probability_percent int check (probability_percent between 0 and 100),

  expected_close_date date,
  closed_at timestamptz,
  lost_reason text,

  owner_user_id uuid references auth.users (id) on delete set null,
  notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_opportunities_customer_idx on public.crm_opportunities (customer_id);
create index if not exists crm_opportunities_org_stage_idx on public.crm_opportunities (organization_id, stage);

-- ============================================================
-- 5. Activités
-- ============================================================
-- §"ACTIVITÉS CRM — types : note, call, email, meeting, visit, task,
-- custom." C'est l'« historique » de la fiche client.

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid references public.crm_customers (id) on delete cascade,
  opportunity_id uuid references public.crm_opportunities (id) on delete cascade,
  site_id uuid references public.crm_customer_sites (id) on delete set null,

  activity_type text not null default 'note'
    check (activity_type in ('note', 'call', 'email', 'meeting', 'visit', 'task', 'custom')),

  subject text,
  body text,

  -- Une tâche a une échéance et se termine ; une note est déjà faite.
  due_at timestamptz,
  completed_at timestamptz,
  occurred_at timestamptz not null default now(),

  author_user_id uuid references auth.users (id) on delete set null,
  assigned_to_user_id uuid references auth.users (id) on delete set null,

  archived_at timestamptz,
  created_at timestamptz not null default now(),

  -- Une activité flottante, rattachée à rien, serait invisible partout.
  constraint crm_activities_has_parent
    check (customer_id is not null or opportunity_id is not null)
);

create index if not exists crm_activities_customer_idx on public.crm_activities (customer_id, occurred_at desc);
create index if not exists crm_activities_due_idx on public.crm_activities (organization_id, due_at)
  where completed_at is null and due_at is not null;

-- ============================================================
-- 6. RLS
-- ============================================================
-- Lecture réservée aux membres ayant clients.read, écriture à
-- clients.write. Les deux vérifications sont faites en base : une page
-- web qui masquerait le bouton « Nouveau client » ne protège rien.

do $$
declare t text;
begin
  foreach t in array array[
    'crm_customers', 'crm_contacts', 'crm_customer_sites',
    'crm_opportunities', 'crm_activities'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members with clients.read can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with clients.read can read %1$s" on public.%1$I
         for select using (public.has_permission(organization_id, ''clients.read''))', t);

    execute format('drop policy if exists "Members with clients.write can write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with clients.write can write %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''clients.write''))
         with check (public.has_permission(organization_id, ''clients.write''))', t);
  end loop;
end $$;

-- ============================================================
-- 7. Conversion prospect → client
-- ============================================================
-- Un changement de statut, pas une copie de données. Écrit dans le
-- journal d'audit parce que « ce prospect est devenu client » est
-- exactement le genre d'événement qu'on cherche six mois plus tard.

create or replace function public.convert_lead_to_customer(customer_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  org_id uuid;
  current_stage text;
begin
  select organization_id, lifecycle_stage into org_id, current_stage
  from public.crm_customers where id = customer_id;

  -- RLS a déjà filtré : si la ligne n'est pas visible, elle est nulle ici.
  if org_id is null then
    raise exception 'Fiche introuvable.';
  end if;
  if current_stage = 'customer' then
    return; -- idempotent
  end if;

  update public.crm_customers
  set lifecycle_stage = 'customer',
      prospect_status = 'won',
      converted_at = now(),
      updated_at = now()
  where id = customer_id;

  insert into public.audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id, old_value, new_value, source)
  values
    (org_id, auth.uid(), 'crm.leadConverted', 'crm_customer', customer_id,
     jsonb_build_object('lifecycleStage', current_stage),
     jsonb_build_object('lifecycleStage', 'customer'), 'web');
end $$;
