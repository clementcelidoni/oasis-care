-- Oasis Care — CORRECTIF DE SÉCURITÉ.
--
-- À exécuter DÈS QUE POSSIBLE, avant 0060 et 0061 si besoin : ces
-- migrations-là ajoutent des écrans, celle-ci ferme des portes.
-- Idempotente.
--
-- ============================================================
-- CE QUI ÉTAIT OUVERT
-- ============================================================
--
-- Trois politiques du Milestone 11 s'écrivaient sur ce modèle :
--
--     using (public.has_permission(organization_id, 'clients.write'))
--
-- `organization_id` est la COLONNE DE LA LIGNE QU'ON ÉCRIT, donc une
-- valeur que l'auteur de la ligne choisit. La politique demande « as-tu
-- le droit d'écrire dans l'organisation que tu viens de désigner ? » —
-- et la réponse est oui, puisqu'il y met la sienne.
--
-- Rien ne vérifiait que L'AUTRE BOUT de la ligne — la fiche client, le
-- jardin — appartenait à cette organisation. Or ces trois tables ne
-- sont pas des tables de données : ce sont des tables de DROITS. Une
-- ligne y ouvre un accès.
--
-- Vérifié par l'attaque sur la base réelle, en transaction annulée
-- (`supabase/tests/cross_tenant_grants.sql`). Un professionnel
-- parfaitement légitime, d'une autre entreprise, pouvait :
--
--   1. se rattacher à la fiche client d'une entreprise tierce, et lire
--      ses devis et ses factures par les vues du portail — qui sont en
--      `security definer` et ne filtrent que sur `my_customer_ids()` ;
--
--   2. s'accorder l'accès à N'IMPORTE QUEL jardin de la base, y compris
--      le jardin privé d'un particulier synchronisé depuis son iPhone,
--      et en lire tout le plan ;
--
--   3. une fois révoqué par le propriétaire, remettre lui-même
--      `revoked_at` à NULL — ce qui vidait §"Le propriétaire peut
--      retirer l'accès du professionnel" de tout contenu.
--
-- Ces politiques avaient l'air justes. Elles nomment une permission,
-- elles nomment une organisation. Il faut les relire deux fois pour
-- voir qu'elles ne relient jamais les deux extrémités de la ligne.

-- ============================================================
-- 1. Relier les deux bouts
-- ============================================================
-- Deux fonctions, en `security definer`, et c'est nécessaire : sous les
-- droits de l'appelant, la sous-requête verrait la RLS de
-- `crm_customers` et de `gardens` s'appliquer, et une fiche invisible
-- ressortirait « absente » au lieu de « pas à vous ». Le refus serait
-- le bon dans les deux cas, mais pour la mauvaise raison — et le jour
-- où une politique de lecture s'élargit, le contrôle se relâcherait
-- sans que personne le demande.
--
-- Elles ne rendent qu'un booléen sur un couple d'identifiants déjà
-- connus de l'appelant : elles n'exposent aucune ligne.

create or replace function public.customer_in_organization(
  p_customer_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.crm_customers
    where id = p_customer_id and organization_id = p_organization_id
  );
$$;

create or replace function public.garden_in_organization(
  p_garden_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gardens g
    join public.business_organizations o on o.workspace_id = g.workspace_id
    where g.id = p_garden_id and o.id = p_organization_id
  );
$$;

-- ============================================================
-- 2. Le portail client
-- ============================================================
drop policy if exists "Members manage portal access" on public.client_portal_access;
create policy "Members manage portal access" on public.client_portal_access
  for all using (
    public.has_permission(organization_id, 'clients.write')
    and public.customer_in_organization(customer_id, organization_id)
  )
  with check (
    public.has_permission(organization_id, 'clients.write')
    and public.customer_in_organization(customer_id, organization_id)
  );

drop policy if exists "Members manage invitations" on public.client_invitations;
create policy "Members manage invitations" on public.client_invitations
  for all using (
    public.has_permission(organization_id, 'clients.write')
    and public.customer_in_organization(customer_id, organization_id)
  )
  with check (
    public.has_permission(organization_id, 'clients.write')
    and public.customer_in_organization(customer_id, organization_id)
  );

-- ============================================================
-- 3. L'accès au jardin
-- ============================================================
-- Le jardin doit appartenir à l'espace de travail de l'organisation
-- nommée sur la ligne.
--
-- CONSÉQUENCE VOULUE : après §JARDIN PRO → PARTICULIER, le jardin a
-- déménagé dans l'espace du client, et cette branche devient fausse. Le
-- professionnel ne peut donc plus toucher aux accès de ce jardin — y
-- compris au sien. C'est exactement ce que §"Le propriétaire peut
-- retirer l'accès du professionnel" veut dire : une révocation qu'on
-- pourrait défaire soi-même n'est pas une révocation.
--
-- Le chemin légitime ne passe pas par ici : `deliver_garden_to_client`
-- est en `security definer` et pose les deux lignes d'accès elle-même,
-- après avoir vérifié la permission ET l'appartenance du jardin.
drop policy if exists "Owners and pros manage garden access" on public.garden_access;
create policy "Owners and pros manage garden access" on public.garden_access
  for all using (
    public.is_garden_owner(garden_id)
    or (
      organization_id is not null
      and public.has_permission(organization_id, 'clients.write')
      and public.garden_in_organization(garden_id, organization_id)
    )
  )
  with check (
    public.is_garden_owner(garden_id)
    or (
      organization_id is not null
      and public.has_permission(organization_id, 'clients.write')
      and public.garden_in_organization(garden_id, organization_id)
    )
  );

-- La politique de LECTURE portait le même défaut, en plus discret :
-- `organization_id is not null and has_permission(organization_id,
-- 'clients.read')` laissait lire les lignes d'accès de n'importe quel
-- jardin dès lors qu'elles nommaient une organisation dont on est
-- membre. En pratique il fallait d'abord avoir écrit une telle ligne —
-- ce que le point 3 vient de fermer — mais le contrôle manquait aussi
-- ici, et une deuxième porte derrière la première ne coûte rien.
drop policy if exists "Users read their garden access" on public.garden_access;
create policy "Users read their garden access" on public.garden_access
  for select using (
    user_id = auth.uid()
    or public.is_garden_owner(garden_id)
    or (
      organization_id is not null
      and public.has_permission(organization_id, 'clients.read')
      and public.garden_in_organization(garden_id, organization_id)
    )
  );

comment on function public.customer_in_organization(uuid, uuid) is
  'Relie une fiche client à une organisation. Sert aux politiques des tables de DROITS, où `organization_id` est choisi par celui qui écrit (correctif 0062).';
comment on function public.garden_in_organization(uuid, uuid) is
  'Relie un jardin à une organisation, par l''espace de travail (correctif 0062).';
