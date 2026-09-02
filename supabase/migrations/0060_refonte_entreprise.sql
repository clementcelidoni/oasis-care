-- Oasis Care — Phase 11, AMÉLIORATION MAJEURE.
-- §11 MA SOCIÉTÉ · §12 LOGO · §15 ABONNEMENT · §41 NOTIFICATIONS
-- §43 MODULES · §44 ONBOARDING · §45 DOCUMENTS SOCIÉTÉ
--
-- À exécuter après 0059. Idempotente et purement additive.
--
-- CE QUI GOUVERNE CE FICHIER : « Analyse l'existant, conserve
-- l'architecture métier, Supabase, les modèles, le système
-- multi-tenant, les données, les permissions et les fonctionnalités
-- déjà développées. NE REFAIS PAS LE PROJET DE ZÉRO. »
--
-- On n'invente donc aucun deuxième axe de cloisonnement, aucun
-- deuxième moteur commercial (§16 : « NE PAS créer un deuxième moteur
-- commercial »), aucune deuxième table de membres. Tout ce qui suit
-- s'accroche à `business_organizations` et à `has_permission`, comme le
-- reste depuis la migration 0043.

-- ============================================================
-- 1. §11-12 L'identité complète de l'entreprise
-- ============================================================
-- 0056 avait posé les mentions LÉGALES, celles qui doivent figurer sur
-- un devis. §11 et §12 en demandent davantage : l'identité
-- administrative que l'entreprise gère pour elle-même — assurances,
-- certifications, effectif.
--
-- `insurance_details` (0056) reste : c'est la PHRASE imprimée en pied
-- de devis. Les colonnes ci-dessous sont les champs qu'on saisit ; la
-- phrase est ce qu'on publie. Les confondre obligerait à re-saisir la
-- mention à chaque changement d'assureur.

alter table public.business_organizations
  add column if not exists siren text,

  -- §12 ADMINISTRATION — « RC Pro, Décennale, Assureur, Numéro contrat,
  -- Date expiration, Certifications, Qualifications, Numéro opérateur
  -- phytosanitaire si applicable. »
  add column if not exists insurer_name text,
  add column if not exists insurance_rc_pro_number text,
  add column if not exists insurance_decennale_number text,
  add column if not exists insurance_expires_on date,
  add column if not exists certifications text,
  add column if not exists qualifications text,
  add column if not exists phytosanitary_operator_number text,

  -- §12 NOMBRE DE SALARIÉS — « Si module équipe utilisé : calculer
  -- automatiquement depuis les membres actifs. Permettre override
  -- manuel si nécessaire. » D'où une colonne d'OVERRIDE et non une
  -- colonne d'effectif : `null` veut dire « compte les membres », un
  -- nombre veut dire « non, c'est celui-ci ». Une seule colonne
  -- « effectif » ne saurait pas distinguer « zéro salarié » de « pas
  -- encore renseigné ».
  add column if not exists employee_count_override integer
    check (employee_count_override is null or employee_count_override >= 0),

  -- §43 MODULES — « Permettre masquage modules inutiles. Cela ne
  -- remplace pas les entitlements. » C'est du RANGEMENT, pas un droit :
  -- rien ici n'est vérifié par une politique RLS, et éteindre
  -- « Facturation » ne ferme aucune table.
  add column if not exists disabled_modules text[] not null default '{}',

  -- §44 ONBOARDING PRO — où l'entreprise en est de son installation.
  add column if not exists onboarding_step integer not null default 0,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.business_organizations.employee_count_override is
  'Effectif saisi à la main. NULL = compter les membres actifs (§12).';
comment on column public.business_organizations.disabled_modules is
  'Modules masqués dans le menu (§43). Confort d''affichage, jamais un droit.';

/**
 * §12 — l'effectif, calculé ou imposé.
 *
 * Une fonction plutôt qu'une colonne entretenue par déclencheur : le
 * nombre change à chaque invitation et à chaque départ, et une valeur
 * recopiée finit toujours par diverger de la liste qu'elle prétend
 * résumer.
 */
create or replace function public.organization_employee_count(p_organization_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select employee_count_override from public.business_organizations where id = p_organization_id),
    (select count(*)::int from public.organization_members
      where organization_id = p_organization_id and archived_at is null)
  );
$$;

-- ============================================================
-- 2. §12 Le logo de l'entreprise
-- ============================================================
-- §"Support PNG, JPEG, WEBP. Compression. Crop si nécessaire. Stockage
-- Supabase Storage sécurisé."
--
-- La colonne `logo_path` existe depuis 0043 et n'avait jamais eu de
-- seau où pointer. Même convention que les autres seaux du projet : le
-- PREMIER SEGMENT du chemin est l'identifiant de l'organisation, et
-- c'est lui que la politique vérifie.
--
-- Le seau est PUBLIC en lecture, et c'est un choix : un logo
-- d'entreprise s'affiche sur un devis remis au client et dans son
-- portail. Le servir par URL signée obligerait à re-signer à chaque
-- rendu, pour protéger une image que l'entreprise imprime elle-même sur
-- son papier à en-tête. L'écriture, elle, reste fermée.
insert into storage.buckets (id, name, public)
values ('organization-logos', 'organization-logos', true)
on conflict (id) do nothing;

do $$
begin
  execute 'drop policy if exists "Anyone can read organization logos" on storage.objects';
  execute $p$
    create policy "Anyone can read organization logos" on storage.objects
      for select using (bucket_id = 'organization-logos')
  $p$;

  execute 'drop policy if exists "Admins can write organization logos" on storage.objects';
  execute $p$
    create policy "Admins can write organization logos" on storage.objects
      for all using (
        bucket_id = 'organization-logos'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'organization.manageUsers')
      )
      with check (
        bucket_id = 'organization-logos'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'organization.manageUsers')
      )
  $p$;
end $$;

-- ============================================================
-- 3. §45 DOCUMENTS SOCIÉTÉ
-- ============================================================
-- « Permettre stockage sécurisé : KBIS, RIB, assurances,
-- certifications, documents administratifs. Permissions spécifiques. »
--
-- « Permissions spécifiques » se lit ici : un RIB n'est pas une photo
-- de chantier. La lecture demande `organization.manageUsers` — le droit
-- qui distingue déjà un administrateur d'un chef d'équipe — et non
-- `projects.read`, que possède tout le terrain.

create table if not exists public.organization_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  kind text not null default 'other' check (kind in (
    'kbis', 'rib', 'insurance', 'certification', 'administrative', 'other'
  )),
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  -- Une attestation d'assurance périmée ne vaut rien, et personne ne
  -- pense à la remplacer avant qu'un client la réclame.
  expires_on date,
  notes text,

  uploaded_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organization_documents_org_idx
  on public.organization_documents (organization_id) where archived_at is null;

alter table public.organization_documents enable row level security;
drop policy if exists "Admins manage organization documents" on public.organization_documents;
create policy "Admins manage organization documents" on public.organization_documents
  for all using (public.has_permission(organization_id, 'organization.manageUsers'))
  with check (public.has_permission(organization_id, 'organization.manageUsers'));

insert into storage.buckets (id, name, public)
values ('organization-documents', 'organization-documents', false)
on conflict (id) do nothing;

do $$
begin
  execute 'drop policy if exists "Admins manage organization document files" on storage.objects';
  execute $p$
    create policy "Admins manage organization document files" on storage.objects
      for all using (
        bucket_id = 'organization-documents'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'organization.manageUsers')
      )
      with check (
        bucket_id = 'organization-documents'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'organization.manageUsers')
      )
  $p$;
end $$;

-- ============================================================
-- 4. §15-16 ABONNEMENT
-- ============================================================
-- §16 : « Réutiliser le système d'entitlements existant de Phase 12. NE
-- PAS créer un deuxième moteur commercial. »
--
-- La Phase 12 accorde des droits À UN COMPTE, pour l'app iPhone, via
-- Apple. Oasis Care Pro se vend à une ENTREPRISE. Ce sont deux échelles,
-- pas deux moteurs : on ajoute donc l'échelle manquante — une ligne
-- d'abonnement par organisation — sans toucher aux entitlements
-- existants ni en dupliquer la logique.

-- §"Noms configurables. NE PAS figer définitivement ces noms." D'où une
-- TABLE de forfaits, et non une énumération dans le code : changer
-- « Team » en « Équipe » ne doit pas demander un déploiement.
create table if not exists public.organization_plans (
  key text primary key,
  name text not null,
  tagline text,
  features jsonb not null default '[]'::jsonb,
  monthly_price_cents bigint,
  max_users integer,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.organization_plans enable row level security;
drop policy if exists "Anyone authenticated can read plans" on public.organization_plans;
create policy "Anyone authenticated can read plans" on public.organization_plans
  for select using (auth.uid() is not null);

insert into public.organization_plans (key, name, tagline, features, max_users, position) values
  ('solo', 'Solo', 'Pour indépendants',
   '["1 utilisateur","CRM","Devis","Digital Twin","Planning"]'::jsonb, 1, 1),
  ('team', 'Team', 'Pour équipes',
   '["Tout Solo","Plusieurs utilisateurs","Permissions","Planning équipe"]'::jsonb, null, 2),
  ('nursery', 'Nursery', 'Pour pépinières et producteurs',
   '["Tout Team","Lots et emplacements","Mouvements de stock","Commandes"]'::jsonb, null, 3),
  ('business', 'Business', 'Pour structures multi-sites',
   '["Tout Nursery","Multi-entreprises","Analytics avancés","Oasis AI"]'::jsonb, null, 4)
on conflict (key) do nothing;

create table if not exists public.organization_subscriptions (
  organization_id uuid primary key references public.business_organizations (id) on delete cascade,
  plan text not null references public.organization_plans (key),

  -- §16 « BillingProvider … WebBillingProvider, AppleBillingProvider ».
  -- `none` est l'état réel aujourd'hui : aucun encaissement n'est
  -- branché, et §"Si aucun fournisseur de paiement web réel configuré :
  -- ne pas simuler une transaction."
  provider text not null default 'none' check (provider in ('none', 'web', 'apple', 'manual')),
  status text not null default 'trialing' check (status in (
    'trialing', 'active', 'pastDue', 'cancelled'
  )),

  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  cancelled_at timestamptz,
  external_reference text,
  updated_at timestamptz not null default now()
);

alter table public.organization_subscriptions enable row level security;
drop policy if exists "Members read their subscription" on public.organization_subscriptions;
create policy "Members read their subscription" on public.organization_subscriptions
  for select using (public.is_organization_member(organization_id));

-- L'écriture est réservée aux administrateurs — et, en pratique, elle
-- viendra d'un webhook en `service_role` le jour où un encaissement
-- existe. On n'ouvre pas l'écriture à tout membre : un forfait n'est
-- pas un réglage d'affichage.
drop policy if exists "Admins change their subscription" on public.organization_subscriptions;
create policy "Admins change their subscription" on public.organization_subscriptions
  for all using (public.has_permission(organization_id, 'organization.manageUsers'))
  with check (public.has_permission(organization_id, 'organization.manageUsers'));

-- ============================================================
-- 5. §41 NOTIFICATIONS
-- ============================================================
-- « Devis Martin accepté · Stock faible Pittosporum C5 · Facture #1045
-- échue · Équipe B intervention terminée. »
--
-- `user_id` NULL veut dire « toute l'entreprise » : un stock faible
-- concerne la pépinière entière, pas une personne. La lecture est alors
-- individuelle malgré tout — d'où `notification_reads`, séparée : si
-- l'état « lu » vivait sur la notification, le premier qui l'ouvre
-- l'effacerait pour tous.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  -- Destinataire précis, ou NULL pour toute l'organisation.
  user_id uuid references auth.users (id) on delete cascade,

  kind text not null default 'info' check (kind in (
    'info', 'success', 'warning', 'critical'
  )),
  category text not null default 'general',
  title text not null,
  body text,
  -- Où mène la notification. Un chemin interne, jamais une URL absolue :
  -- une notification est écrite par le produit, elle n'a aucune raison
  -- d'envoyer ailleurs.
  href text check (href is null or href like '/%'),

  entity_type text,
  entity_id uuid,

  created_at timestamptz not null default now()
);

create index if not exists notifications_org_idx
  on public.notifications (organization_id, created_at desc);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc) where user_id is not null;

alter table public.notifications enable row level security;

drop policy if exists "Members read their notifications" on public.notifications;
create policy "Members read their notifications" on public.notifications
  for select using (
    public.is_organization_member(organization_id)
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "Members write notifications" on public.notifications;
create policy "Members write notifications" on public.notifications
  for insert with check (public.is_organization_member(organization_id));

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;
drop policy if exists "Users manage their own reads" on public.notification_reads;
create policy "Users manage their own reads" on public.notification_reads
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

/**
 * Ce que CE compte n'a pas encore lu.
 *
 * En `security invoker` : la RLS de `notifications` et de
 * `notification_reads` s'applique à l'appelant, donc la fonction ne
 * peut pas compter les notifications d'une autre entreprise même si on
 * lui en donnait l'identifiant.
 */
create or replace function public.unread_notification_count(p_organization_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
  from public.notifications n
  where n.organization_id = p_organization_id
    and (n.user_id is null or n.user_id = auth.uid())
    and not exists (
      select 1 from public.notification_reads r
      where r.notification_id = n.id and r.user_id = auth.uid()
    );
$$;

-- ============================================================
-- 6. §27-28 RECHERCHES RÉCENTES et FAVORIS
-- ============================================================
-- §27 « Stockage par utilisateur. » Les deux tables sont donc
-- strictement personnelles : la RLS ne regarde que `user_id`, et
-- l'organisation n'y sert qu'à ranger — un même compte peut travailler
-- pour deux entreprises et ne doit pas voir ses favoris de l'une dans
-- l'autre.

create table if not exists public.user_recent_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  entity_type text not null,
  entity_id uuid not null,
  title text not null,
  url text not null check (url like '/%'),

  opened_at timestamptz not null default now(),

  -- Rouvrir le même devis met la ligne à jour au lieu d'en empiler une
  -- deuxième : « récemment ouverts » est une liste d'objets, pas un
  -- journal de clics.
  unique (user_id, organization_id, entity_type, entity_id)
);

create index if not exists user_recent_items_lookup_idx
  on public.user_recent_items (user_id, organization_id, opened_at desc);

alter table public.user_recent_items enable row level security;
drop policy if exists "Users manage their own recent items" on public.user_recent_items;
create policy "Users manage their own recent items" on public.user_recent_items
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  entity_type text not null,
  entity_id uuid not null,
  title text not null,
  url text not null check (url like '/%'),

  created_at timestamptz not null default now(),
  unique (user_id, organization_id, entity_type, entity_id)
);

create index if not exists user_favorites_lookup_idx
  on public.user_favorites (user_id, organization_id, created_at desc);

alter table public.user_favorites enable row level security;
drop policy if exists "Users manage their own favorites" on public.user_favorites;
create policy "Users manage their own favorites" on public.user_favorites
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

/**
 * §23 OUVERTURE DIRECTE — « Cliquer résultat : Client → fiche client. »
 *
 * Enregistrer l'ouverture ET la rendre récente en une seule instruction.
 * Deux appels séparés depuis le web laisseraient une fenêtre où la
 * ligne existe sans sa date, et la liste « récemment ouverts »
 * afficherait le mauvais ordre.
 */
create or replace function public.record_recent_item(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_url text
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.user_recent_items
    (user_id, organization_id, entity_type, entity_id, title, url)
  values (auth.uid(), p_organization_id, p_entity_type, p_entity_id, p_title, p_url)
  on conflict (user_id, organization_id, entity_type, entity_id) do update
    set opened_at = now(), title = excluded.title, url = excluded.url;
$$;
