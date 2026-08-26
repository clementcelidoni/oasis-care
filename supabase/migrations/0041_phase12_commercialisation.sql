-- Oasis Care — Phase 12: commercialisation (abonnements StoreKit 2,
-- entitlements, backend App Store sécurisé).
--
-- Run this once in the Supabase SQL Editor after 0001-0040.
--
-- RLS shape throughout this file matches species_profiles (0003_ai.sql):
-- a `for select` policy only, no insert/update/delete policy for the
-- authenticated role at all. Only a service_role Edge Function (which
-- bypasses RLS) may ever write these rows — spec §12E "Il ne peut PAS
-- modifier directement plan, entitlements, expiration ou product via
-- le client Supabase. Seul le backend sécurisé peut modifier les
-- droits validés."

create table public.subscription_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  apple_original_transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create unique index subscription_customers_apple_original_transaction_id_idx
  on public.subscription_customers (apple_original_transaction_id)
  where apple_original_transaction_id is not null;

alter table public.subscription_customers enable row level security;
create policy "Users can read their own subscription customer row" on public.subscription_customers
  for select using (user_id = auth.uid());

-- One row per granted entitlement (spec §12E's own field list: userId,
-- workspaceId, plan, entitlement, source, status...) rather than one
-- row per user with an array — lets a client check "do I have X" with
-- a direct row match.
create table public.subscription_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan text not null,
  entitlement text not null,
  source text not null,
  status text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement)
);

create index subscription_entitlements_workspace_id_idx on public.subscription_entitlements (workspace_id);

alter table public.subscription_entitlements enable row level security;
create policy "Users can read their own entitlements" on public.subscription_entitlements
  for select using (user_id = auth.uid());

-- Append-only audit log of every Apple notification processed —
-- spec §12E's own field list, plus workspace_id for RLS scoping.
-- Idempotency (§"Une notification Apple reçue plusieurs fois ne doit
-- pas créer plusieurs événements ou droits") is enforced by the unique
-- constraint on (transaction_id, event_type): the webhook upserts on
-- conflict do-nothing rather than blindly inserting.
create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  product_id text,
  original_transaction_id text,
  transaction_id text,
  environment text not null,
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now(),
  unique (transaction_id, event_type)
);

create index subscription_events_workspace_id_idx on public.subscription_events (workspace_id);
create index subscription_events_original_transaction_id_idx on public.subscription_events (original_transaction_id);

alter table public.subscription_events enable row level security;
create policy "Users can read their own subscription events" on public.subscription_events
  for select using (user_id = auth.uid());

-- Server-side mirror of ProductIdentifiers.swift — lets
-- apple-subscription-webhook map an incoming Apple productId to a plan
-- without hardcoding that mapping in TypeScript too.
create table public.subscription_products (
  product_id text primary key,
  plan text not null,
  is_active boolean not null default true
);

alter table public.subscription_products enable row level security;
create policy "Anyone authenticated can read the product catalog" on public.subscription_products
  for select using (auth.uid() is not null);

insert into public.subscription_products (product_id, plan) values
  ('com.oasiscare.premium.monthly', 'premium'),
  ('com.oasiscare.premium.yearly', 'premium'),
  ('com.oasiscare.biolab.monthly', 'biolab'),
  ('com.oasiscare.biolab.yearly', 'biolab')
on conflict (product_id) do nothing;

-- Phase 12 §12H "AI QUOTAS — stocker les compteurs côté serveur."
-- `period` is a "YYYY-MM" string — simple, human-inspectable, no
-- timezone ambiguity for a monthly quota.
create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  feature text not null,
  period text not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, feature, period)
);

create index usage_counters_workspace_id_idx on public.usage_counters (workspace_id);

alter table public.usage_counters enable row level security;
create policy "Users can read their own usage counters" on public.usage_counters
  for select using (user_id = auth.uid());

-- Phase 12 §12O — global feature flags and remote commercial config.
-- Deliberately NOT workspace-scoped (these are app-wide operational
-- knobs, not user data) and read-only to every authenticated client;
-- only ever edited directly by the developer in the SQL Editor, never
-- through an API endpoint — see §12O "Ne jamais permettre de modifier
-- les entitlements payants depuis une config non sécurisée."
create table public.feature_flags (
  flag_key text primary key,
  is_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
create policy "Anyone authenticated can read feature flags" on public.feature_flags
  for select using (auth.uid() is not null);

insert into public.feature_flags (flag_key, is_enabled) values
  ('biolabPaywallEnabled', true),
  ('premiumPaywallEnabled', true),
  ('newOnboardingEnabled', true),
  ('aiDiagnosisEnabled', true)
on conflict (flag_key) do nothing;

create table public.commercial_config (
  config_key text primary key,
  config_value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.commercial_config enable row level security;
create policy "Anyone authenticated can read commercial config" on public.commercial_config
  for select using (auth.uid() is not null);

-- Phase 12 §12H — atomic check-then-increment so two concurrent AI
-- calls from the same user can't both slip through at the limit (a
-- plain read-then-upsert from an Edge Function would race). `for
-- update` row-locks the counter row for the duration of this
-- transaction; `security definer` lets an Edge Function's service_role
-- client call this without needing its own insert/update policy on
-- usage_counters (which deliberately has none — see that table's RLS).
create or replace function public.increment_usage_counter(
  p_user_id uuid, p_workspace_id uuid, p_feature text, p_period text, p_limit integer
)
returns table(allowed boolean, used integer)
language plpgsql
security definer
as $$
declare
  current_count integer;
begin
  insert into public.usage_counters (user_id, workspace_id, feature, period, count)
  values (p_user_id, p_workspace_id, p_feature, p_period, 0)
  on conflict (user_id, feature, period) do nothing;

  select count into current_count from public.usage_counters
  where user_id = p_user_id and feature = p_feature and period = p_period
  for update;

  if current_count >= p_limit then
    return query select false, current_count;
  else
    update public.usage_counters set count = count + 1, updated_at = now()
    where user_id = p_user_id and feature = p_feature and period = p_period;
    return query select true, current_count + 1;
  end if;
end;
$$;

-- Phase 12 §12N "ANALYTICS RESPECTUEUX DE LA VIE PRIVÉE" — "Ne jamais
-- envoyer nom de plante personnel, notes, contenu photo ou données
-- BioLab privées dans les événements génériques." `detail` is
-- deliberately just a small, non-identifying string (a plan name, a
-- product id) — never free text a user typed. No read policy at all:
-- this table is write-only from the client's own perspective (insert
-- your own event, never read anyone's, including your own — there's no
-- in-app analytics dashboard to build here).
create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  event_name text not null,
  detail text,
  occurred_at timestamptz not null default now()
);

create index analytics_events_event_name_idx on public.analytics_events (event_name);

alter table public.analytics_events enable row level security;
create policy "Authenticated users can record their own analytics events" on public.analytics_events
  for insert with check (auth.uid() is not null and (user_id is null or user_id = auth.uid()));
