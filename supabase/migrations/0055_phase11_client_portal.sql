-- Oasis Care — Phase 11, Milestone 11 : §11S PORTAIL CLIENT et
-- §JARDIN PRO → PARTICULIER.
--
-- À exécuter après 0054. Idempotente et purement additive.
--
-- LA PHRASE QUI GOUVERNE TOUT CE FICHIER :
-- « Les données internes de marge / coûts / notes privées ne doivent
-- JAMAIS être transférées au client. »
--
-- D'où la construction retenue. Le client n'obtient AUCUNE politique de
-- lecture sur `quotes`, `invoices` ou `projects` : une politique mal
-- écrite sur ces tables lui donnerait les colonnes de coût du même
-- coup. Il lit à la place des VUES en `security definer` qui
-- n'exposent, colonne par colonne, que ce qu'il a le droit de voir.
--
-- La liste de colonnes EST la frontière de sécurité. Elle tient en un
-- endroit, elle se relit, et ajouter `unit_cost_cents` à une de ces
-- vues serait un geste visible dans une revue — contrairement à une
-- politique trop large, dont la faille ne se voit nulle part.
--
-- Le client n'est pas un membre de l'organisation. C'est un DEUXIÈME
-- axe d'accès, distinct de `is_organization_member`, et il ne doit
-- jamais croiser le premier.

-- ============================================================
-- 1. Le lien entre un client et son compte
-- ============================================================

create table if not exists public.client_portal_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  invited_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  -- Un compte, une fiche client, une fois. Deux liens permettraient à
  -- une révocation d'en laisser un actif.
  constraint client_portal_access_unique unique (customer_id, user_id)
);

create index if not exists client_portal_access_user_idx
  on public.client_portal_access (user_id) where revoked_at is null;

create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete cascade,

  email text not null,
  -- Jeton aléatoire, jamais dérivé de l'e-mail ou de l'identifiant :
  -- un jeton devinable est une porte ouverte sur les documents d'un
  -- client.
  token text not null unique default encode(gen_random_bytes(32), 'hex'),

  -- Une invitation qui n'expire jamais traîne dans une boîte mail
  -- pendant des années.
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,

  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_invitations_token_idx on public.client_invitations (token);
create index if not exists client_invitations_customer_idx
  on public.client_invitations (customer_id) where accepted_at is null;

-- ============================================================
-- 2. Accès au jardin
-- ============================================================
-- §PERMISSIONS JARDIN — « owner, householdMember, professional,
-- readOnly. Le propriétaire peut retirer l'accès du professionnel. »

create table if not exists public.garden_access (
  id uuid primary key default gen_random_uuid(),
  garden_id uuid not null references public.gardens (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  role text not null default 'readOnly' check (role in (
    'owner', 'householdMember', 'professional', 'readOnly'
  )),
  -- L'organisation, quand l'accès est celui d'un professionnel. C'est
  -- ce qui permet au propriétaire de le retirer d'un geste.
  organization_id uuid references public.business_organizations (id) on delete cascade,

  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint garden_access_unique unique (garden_id, user_id)
);

create index if not exists garden_access_user_idx
  on public.garden_access (user_id) where revoked_at is null;
create index if not exists garden_access_garden_idx
  on public.garden_access (garden_id) where revoked_at is null;

alter table public.client_portal_access enable row level security;
alter table public.client_invitations enable row level security;
alter table public.garden_access enable row level security;

-- Le professionnel gère les invitations et les accès de SON
-- organisation.
drop policy if exists "Members manage portal access" on public.client_portal_access;
create policy "Members manage portal access" on public.client_portal_access
  for all using (public.has_permission(organization_id, 'clients.write'))
  with check (public.has_permission(organization_id, 'clients.write'));

drop policy if exists "Members manage invitations" on public.client_invitations;
create policy "Members manage invitations" on public.client_invitations
  for all using (public.has_permission(organization_id, 'clients.write'))
  with check (public.has_permission(organization_id, 'clients.write'));

-- Le client voit son propre accès, et rien d'autre.
drop policy if exists "Clients read their own access" on public.client_portal_access;
create policy "Clients read their own access" on public.client_portal_access
  for select using (user_id = auth.uid());

/**
 * Suis-je propriétaire de ce jardin ?
 *
 * En `security definer`, et c'est nécessaire : les politiques de
 * `garden_access` doivent interroger `garden_access`. Sous les droits
 * de l'appelant, Postgres réapplique la politique à cette
 * sous-requête — et refuse la récursion infinie. Une fonction définie
 * par son propriétaire coupe la boucle.
 *
 * Elle ne rend qu'un booléen sur le compte connecté : elle n'expose
 * aucune ligne, et ne peut pas être détournée pour lire les accès d'un
 * autre.
 */
create or replace function public.is_garden_owner(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garden_access
    where garden_id = p_garden_id
      and user_id = auth.uid()
      and role = 'owner'
      and revoked_at is null
  );
$$;

-- Lire les accès d'un jardin.
--
-- La branche `is_garden_owner` n'est pas du confort : §"Le propriétaire
-- peut retirer l'accès du professionnel" suppose qu'il PUISSE LE VOIR.
-- Sans elle, chacun ne verrait que sa propre ligne, et le propriétaire
-- devrait deviner l'identifiant de celui à qui il retire l'accès.
drop policy if exists "Users read their garden access" on public.garden_access;
create policy "Users read their garden access" on public.garden_access
  for select using (
    user_id = auth.uid()
    or public.is_garden_owner(garden_id)
    or (organization_id is not null and public.has_permission(organization_id, 'clients.read'))
  );

-- Écrire un accès au jardin : le propriétaire du jardin, ou le
-- professionnel qui l'a créé. §"Le propriétaire peut retirer l'accès du
-- professionnel" — d'où la première branche, qui ne dépend d'aucune
-- organisation.
drop policy if exists "Owners and pros manage garden access" on public.garden_access;
create policy "Owners and pros manage garden access" on public.garden_access
  for all using (
    public.is_garden_owner(garden_id)
    or (organization_id is not null and public.has_permission(organization_id, 'clients.write'))
  )
  with check (
    public.is_garden_owner(garden_id)
    or (organization_id is not null and public.has_permission(organization_id, 'clients.write'))
  );

-- ============================================================
-- 3. Qui suis-je, côté client
-- ============================================================
-- Les fiches clients auxquelles le compte connecté a accès. Toutes les
-- vues du portail passent par là : une seule définition de « à qui
-- appartient ce document », donc un seul endroit où se tromper.
create or replace function public.my_customer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id
  from public.client_portal_access
  where user_id = auth.uid() and revoked_at is null;
$$;

-- ============================================================
-- 4. Ce que le client a le droit de voir
-- ============================================================
-- CHAQUE COLONNE EST UN CHOIX. Ce qui n'est pas listé n'est pas
-- accessible, et ce qui est absent l'est délibérément :
--   • `unit_cost_cents`, `cost_kind` — ce que la chose nous coûte ;
--   • `internal_notes` — ce qu'on s'écrit entre nous ;
--
-- `organization_id` y figure en revanche : le client sait déjà qui
-- lui a envoyé le document, et sans lui le portail ne saurait pas
-- quelle entête imprimer quand un particulier fait travailler deux
-- entreprises.
--   • marges, ressources, pointages, dépenses — tout le Milestone 6.

-- Le nom de l'entreprise qui l'a invité. Le portail doit pouvoir dire
-- « Vos documents chez Paysages Martin » — sans cette vue, il n'aurait
-- qu'un identifiant à afficher. Trois colonnes, et rien d'autre : ni
-- SIRET, ni coordonnées bancaires, ni réglages.
create or replace view public.client_portal_companies
with (security_invoker = false) as
select distinct o.id, o.name, o.business_type
from public.business_organizations o
join public.client_portal_access a on a.organization_id = o.id
where a.user_id = auth.uid() and a.revoked_at is null;

create or replace view public.client_quotes
with (security_invoker = false) as
select
  q.id, q.organization_id, q.customer_id, q.number, q.title, q.status,
  q.issued_on, q.valid_until, q.introduction, q.terms,
  q.global_discount_percent, q.created_at
from public.quotes q
where q.customer_id in (select public.my_customer_ids())
  and q.archived_at is null
  -- Un brouillon n'a pas été remis : le montrer ferait découvrir au
  -- client un devis qu'on est en train d'écrire.
  and q.status <> 'draft'
  and q.status <> 'internalReview';

create or replace view public.client_quote_lines
with (security_invoker = false) as
select
  l.id, l.quote_id, l.section_id, l.position,
  l.description, l.unit, l.quantity,
  l.unit_sale_price_cents, l.vat_rate, l.discount_percent, l.sale_total_cents
  -- PAS `unit_cost_cents`, PAS `cost_total_cents`, PAS `cost_kind`.
from public.quote_lines l
join public.quotes q on q.id = l.quote_id
where q.customer_id in (select public.my_customer_ids())
  and q.status not in ('draft', 'internalReview');

create or replace view public.client_quote_sections
with (security_invoker = false) as
select s.id, s.quote_id, s.title, s.description, s.position
from public.quote_sections s
join public.quotes q on q.id = s.quote_id
where q.customer_id in (select public.my_customer_ids())
  and q.status not in ('draft', 'internalReview');

create or replace view public.client_invoices
with (security_invoker = false) as
select
  i.id, i.organization_id, i.customer_id, i.number, i.status,
  i.issued_on, i.due_on, i.introduction, i.terms
  -- PAS `internal_notes`.
from public.invoices i
where i.customer_id in (select public.my_customer_ids())
  and i.archived_at is null
  -- Une facture non émise n'existe pas pour le client : elle n'a même
  -- pas de numéro.
  and i.issued_at is not null;

create or replace view public.client_invoice_lines
with (security_invoker = false) as
select
  l.id, l.invoice_id, l.position, l.description, l.unit, l.quantity,
  l.unit_price_cents, l.vat_rate, l.discount_percent, l.total_cents
from public.invoice_lines l
join public.invoices i on i.id = l.invoice_id
where i.customer_id in (select public.my_customer_ids())
  and i.issued_at is not null;

create or replace view public.client_invoice_balance
with (security_invoker = false) as
select
  b.invoice_id, b.total_including_vat_cents, b.paid_cents,
  b.credited_cents, b.outstanding_cents
from public.invoice_balance b
join public.invoices i on i.id = b.invoice_id
where i.customer_id in (select public.my_customer_ids())
  and i.issued_at is not null;

create or replace view public.client_projects
with (security_invoker = false) as
select
  p.id, p.organization_id, p.customer_id, p.number, p.name, p.status,
  p.planned_start_on, p.planned_end_on, p.actual_start_on, p.actual_end_on,
  p.garden_id
  -- PAS `notes` : les notes d'un chantier sont internes.
from public.projects p
where p.customer_id in (select public.my_customer_ids())
  and p.archived_at is null;

-- §"avancement" — les phases et leur pourcentage, sans les budgets.
create or replace view public.client_project_phases
with (security_invoker = false) as
select
  ph.id, ph.project_id, ph.title, ph.position, ph.status, ph.progress_percent,
  ph.planned_start_on, ph.planned_end_on
  -- PAS `notes`, et surtout aucune ressource ni aucun coût.
from public.project_phases ph
join public.projects p on p.id = ph.project_id
where p.customer_id in (select public.my_customer_ids());

create or replace view public.client_project_photos
with (security_invoker = false) as
select
  ph.id, ph.project_id, ph.storage_path, ph.caption, ph.moment, ph.taken_on
from public.project_photos ph
join public.projects p on p.id = ph.project_id
where p.customer_id in (select public.my_customer_ids());

-- Ces vues sont en `security definer` : elles contournent la RLS des
-- tables sous-jacentes, et c'est leur clause `where` — appuyée sur
-- `my_customer_ids()` — qui tient l'isolement. On les rend lisibles à
-- tout compte connecté ; la vue décide ensuite ce qu'elle rend.
do $$
declare v text;
begin
  foreach v in array array[
    'client_portal_companies',
    'client_quotes', 'client_quote_lines', 'client_quote_sections',
    'client_invoices', 'client_invoice_lines', 'client_invoice_balance',
    'client_projects', 'client_project_phases', 'client_project_photos'
  ]
  loop
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ============================================================
-- 5. Inviter un client
-- ============================================================
create or replace function public.invite_client(
  p_customer_id uuid,
  p_email text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  org_id uuid;
  new_token text;
begin
  select organization_id into org_id from public.crm_customers where id = p_customer_id;
  -- RLS a déjà filtré : une fiche invisible ressort nulle ici.
  if org_id is null then
    raise exception 'Client introuvable.';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'Une invitation demande une adresse e-mail.';
  end if;

  -- Une invitation en attente est remplacée plutôt que doublée : deux
  -- liens valides pour le même client sont deux portes à surveiller.
  delete from public.client_invitations
   where customer_id = p_customer_id and accepted_at is null;

  insert into public.client_invitations (organization_id, customer_id, email, invited_by)
  values (org_id, p_customer_id, lower(btrim(p_email)), auth.uid())
  returning token into new_token;

  return new_token;
end;
$$;

-- ============================================================
-- 6. Lire une invitation avant de l'accepter
-- ============================================================
-- L'invité n'est membre de rien : `client_invitations` lui est fermée.
-- Sans cette fonction, la page d'invitation ne pourrait afficher qu'un
-- bouton « Accepter » sans dire accepter QUOI — ce qui est exactement
-- ce qu'on apprend aux gens à ne jamais cliquer.
--
-- Elle ne rend ni l'adresse invitée, ni la fiche client, ni
-- l'identifiant de l'organisation : le nom de l'entreprise et la date
-- limite suffisent à décider. Et elle n'est exécutable que par un
-- compte connecté — un porteur de jeton anonyme n'apprend rien.
create or replace function public.client_invitation_preview(p_token text)
returns table (company_name text, expires_at timestamptz, accepted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, i.expires_at, i.accepted_at is not null
  from public.client_invitations i
  join public.business_organizations o on o.id = i.organization_id
  where i.token = p_token
    and auth.uid() is not null;
$$;

revoke execute on function public.client_invitation_preview(text) from anon;

-- ============================================================
-- 7. Accepter une invitation
-- ============================================================
-- En `security definer` : celui qui accepte n'est membre de rien, et
-- n'a donc aucun droit sur `client_invitations`. Il ne peut atteindre
-- cette fonction qu'avec un jeton valide, et elle ne fait rien d'autre.
create or replace function public.accept_client_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Connectez-vous pour accepter cette invitation.';
  end if;

  select * into inv from public.client_invitations where token = p_token;
  if inv is null then
    raise exception 'Cette invitation n''existe pas.';
  end if;
  if inv.accepted_at is not null then
    -- Déjà acceptée par ce compte : on rend simplement le client.
    if inv.accepted_by = me then
      return inv.customer_id;
    end if;
    raise exception 'Cette invitation a déjà été utilisée.';
  end if;
  if inv.expires_at < now() then
    raise exception 'Cette invitation a expiré. Demandez-en une nouvelle.';
  end if;

  insert into public.client_portal_access (organization_id, customer_id, user_id, invited_by)
  values (inv.organization_id, inv.customer_id, me, inv.invited_by)
  on conflict (customer_id, user_id) do update set revoked_at = null;

  update public.client_invitations
     set accepted_at = now(), accepted_by = me
   where id = inv.id;

  return inv.customer_id;
end;
$$;

-- ============================================================
-- 8. Livrer le jardin
-- ============================================================
-- §JARDIN PRO → PARTICULIER, « FONCTION MAJEURE ».
--
-- Le professionnel a dessiné un jardin dans SON espace de travail. À la
-- réception, le client doit pouvoir l'ouvrir dans son Oasis Care à lui.
--
-- Ce qui traverse : le jardin et son plan. Ce qui ne traverse pas : le
-- devis, les coûts, les marges, les notes. Ils restent dans
-- l'organisation — §"LE PROFESSIONNEL CONSERVE".
--
-- LA PROPRIÉTÉ CHANGE VRAIMENT DE MAINS. Le jardin passe dans l'espace
-- de travail personnel du client, celui que son compte a reçu à
-- l'inscription et que son iPhone synchronise. C'est ce que veut dire
-- « Livrer le jardin dans Oasis Care ».
--
-- Sans ce déplacement, §"Le propriétaire peut retirer l'accès du
-- professionnel" serait une promesse creuse : le jardin resterait dans
-- l'espace de l'entreprise, dont la politique RLS suffit à le lire. On
-- retirerait un accès qui ne servait déjà à rien.
--
-- Le professionnel garde un accès `professional`, révocable, qui lui
-- permet de continuer à entretenir le plan. Le devis, les coûts et les
-- marges, eux, ne bougent pas : ils appartiennent à l'organisation —
-- §"LE PROFESSIONNEL CONSERVE".
-- EN `security definer`, ET C'EST INÉVITABLE. Un transfert entre deux
-- cloisonnements ne peut se faire d'aucun des deux côtés seul : le
-- professionnel ne voit pas l'espace de travail du client, et le client
-- ne voit pas le jardin. Sous les droits de l'appelant, la fonction
-- échouerait à lire la destination puis à écrire dedans.
--
-- Ce que RLS ne vérifie plus, la fonction le vérifie elle-même, et
-- explicitement : l'appelant doit pouvoir écrire les clients de
-- l'organisation, et le jardin doit appartenir à l'espace de cette
-- organisation. Sans ces deux contrôles, n'importe qui pourrait
-- déplacer n'importe quel jardin.
create or replace function public.deliver_garden_to_client(
  p_garden_id uuid,
  p_customer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  org_workspace uuid;
  garden_workspace uuid;
  client_user uuid;
  client_workspace uuid;
  pro uuid := auth.uid();
begin
  if pro is null then
    raise exception 'Connectez-vous.';
  end if;

  select organization_id into org_id from public.crm_customers where id = p_customer_id;
  if org_id is null then
    raise exception 'Client introuvable.';
  end if;

  -- CONTRÔLE 1 — l'appelant a le droit d'agir sur ce client.
  if not public.has_permission(org_id, 'clients.write') then
    raise exception 'Vous n''avez pas le droit de livrer un jardin pour ce client.';
  end if;

  select workspace_id into org_workspace from public.business_organizations where id = org_id;
  select workspace_id into garden_workspace from public.gardens where id = p_garden_id;
  if garden_workspace is null then
    raise exception 'Jardin introuvable.';
  end if;

  -- CONTRÔLE 2 — le jardin est bien celui de cette organisation. Sans
  -- lui, la permission ci-dessus suffirait à déplacer le jardin d'un
  -- tiers.
  if garden_workspace is distinct from org_workspace then
    raise exception 'Ce jardin n''appartient pas à votre organisation.';
  end if;

  select user_id into client_user from public.client_portal_access
   where customer_id = p_customer_id and revoked_at is null limit 1;
  if client_user is null then
    raise exception 'Ce client n''a pas encore de compte Oasis Care. Invitez-le d''abord.';
  end if;

  select id into client_workspace from public.workspaces
   where owner_id = client_user and is_personal limit 1;
  if client_workspace is null then
    raise exception 'Ce client n''a pas d''espace de travail personnel.';
  end if;

  -- Les accès D'ABORD : si le déplacement passe et que les accès
  -- échouent, plus personne ne voit le jardin. Dans l'ordre inverse, un
  -- échec laisse simplement des accès sur un jardin resté en place.
  insert into public.garden_access (garden_id, user_id, role, granted_by)
  values (p_garden_id, client_user, 'owner', pro)
  on conflict (garden_id, user_id) do update
    set role = 'owner', revoked_at = null;

  insert into public.garden_access (garden_id, user_id, role, organization_id, granted_by)
  values (p_garden_id, pro, 'professional', org_id, pro)
  on conflict (garden_id, user_id) do update
    set role = 'professional', organization_id = org_id, revoked_at = null;

  update public.gardens
     set workspace_id = client_workspace, updated_at = now()
   where id = p_garden_id;

  -- Les enfants suivent. Le déclencheur de la migration 0046 les
  -- recale de toute façon sur l'espace de leur jardin : on écrit la
  -- bonne valeur, il confirme.
  update public.garden_areas set workspace_id = client_workspace, updated_at = now()
   where garden_id = p_garden_id;
  update public.garden_map_objects set workspace_id = client_workspace, updated_at = now()
   where garden_id = p_garden_id;
  update public.garden_boundaries set workspace_id = client_workspace, updated_at = now()
   where garden_id = p_garden_id;
  update public.irrigation_pipes set workspace_id = client_workspace, updated_at = now()
   where garden_id = p_garden_id;
  update public.garden_cables set workspace_id = client_workspace, updated_at = now()
   where garden_id = p_garden_id;

  return client_user;
end;
$$;

-- ============================================================
-- 9. Le client lit son jardin
-- ============================================================
-- Les tables du jardin sont cloisonnées par espace de travail depuis la
-- Phase 3. Un client n'appartient à aucun de ces espaces : il faut donc
-- une seconde porte, appuyée sur `garden_access`.
create or replace function public.has_garden_access(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garden_access
    where garden_id = p_garden_id
      and user_id = auth.uid()
      and revoked_at is null
  );
$$;

/**
 * Le droit d'ÉCRIRE sur un jardin partagé.
 *
 * `readOnly` regarde ; les trois autres rôles modifient. C'est ce qui
 * laisse le paysagiste entretenir le plan après l'avoir livré, et le
 * conjoint du propriétaire y toucher sans être propriétaire lui-même.
 */
create or replace function public.can_edit_garden(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garden_access
    where garden_id = p_garden_id
      and user_id = auth.uid()
      and revoked_at is null
      and role in ('owner', 'householdMember', 'professional')
  );
$$;

do $$
declare t text;
begin
  -- Seulement les tables du PLAN. Les plantes, les capteurs et le reste
  -- du carnet suivent l'espace de travail : le jardin déménage, elles
  -- restent chez leur propriétaire.
  foreach t in array array[
    'gardens', 'garden_areas', 'garden_map_objects',
    'garden_boundaries', 'irrigation_pipes', 'garden_cables'
  ]
  loop
    execute format('drop policy if exists "Garden guests can read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Garden editors can write %1$s" on public.%1$I', t);
  end loop;

  execute $p$
    create policy "Garden guests can read gardens" on public.gardens
      for select using (public.has_garden_access(id))
  $p$;
  execute $p$
    create policy "Garden editors can write gardens" on public.gardens
      for update using (public.can_edit_garden(id))
      with check (public.can_edit_garden(id))
  $p$;

  foreach t in array array[
    'garden_areas', 'garden_map_objects', 'garden_boundaries',
    'irrigation_pipes', 'garden_cables'
  ]
  loop
    execute format(
      'create policy "Garden guests can read %1$s" on public.%1$I
         for select using (public.has_garden_access(garden_id))', t);
    execute format(
      'create policy "Garden editors can write %1$s" on public.%1$I
         for all using (public.can_edit_garden(garden_id))
         with check (public.can_edit_garden(garden_id))', t);
  end loop;
end $$;

-- ============================================================
-- 10. Retirer l'accès du professionnel
-- ============================================================
-- §"Le propriétaire peut retirer l'accès du professionnel."
--
-- Et §"LE PROFESSIONNEL CONSERVE" : retirer l'accès au JARDIN ne touche
-- à rien d'autre. Les devis, factures, chantiers et documents restent
-- dans l'organisation — ils sont à elle, pas au jardin.
create or replace function public.revoke_garden_access(
  p_garden_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_garden_owner(p_garden_id) then
    raise exception 'Seul le propriétaire du jardin peut retirer un accès.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre accès de propriétaire.';
  end if;

  update public.garden_access
     set revoked_at = now()
   where garden_id = p_garden_id and user_id = p_user_id;
end;
$$;

-- ============================================================
-- 11. Les photos du chantier
-- ============================================================
-- La vue `client_project_photos` rend un `storage_path`, et un chemin
-- sans droit de lecture ne montre rien. Le bucket `project-photos`
-- (migration 0050) n'ouvre sa politique qu'aux membres ayant
-- `projects.read` : le client n'en a aucune.
--
-- Sans cette section, la galerie du portail afficherait des cadres
-- vides — sans erreur, comme d'habitude.
--
-- Le chemin est `{organisation}/{chantier}/{fichier}`. C'est le
-- DEUXIÈME segment qui décide ici : le premier dirait seulement que la
-- photo appartient à une entreprise dont ce compte est client, ce qui
-- lui ouvrirait les chantiers de tous les autres clients de cette
-- entreprise.
create or replace function public.portal_can_read_project_photo(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[];
  project uuid;
begin
  parts := storage.foldername(p_path);
  if parts is null or array_length(parts, 1) < 2 then
    return false;
  end if;

  -- Un chemin qui ne ressemble pas à ce qu'on écrit n'est pas une
  -- erreur à faire remonter : c'est un refus. Sans ce garde-fou, un
  -- fichier déposé à la racine ferait échouer la requête entière.
  begin
    project := parts[2]::uuid;
  exception when others then
    return false;
  end;

  return exists (
    select 1 from public.projects p
    where p.id = project
      and p.customer_id in (select public.my_customer_ids())
      and p.archived_at is null
  );
end;
$$;

do $$
begin
  execute 'drop policy if exists "Portal clients read their project photos" on storage.objects';
  execute $p$
    create policy "Portal clients read their project photos" on storage.objects
      for select using (
        bucket_id = 'project-photos'
        and public.portal_can_read_project_photo(name)
      )
  $p$;
end $$;
