-- Oasis Care — Phase 11, Milestone 8 : §11I à §11L, la PÉPINIÈRE.
--
-- À exécuter après 0051. Idempotente et purement additive.
--
-- « NE PAS CONFONDRE STOCK PHYSIQUE ET DISPONIBLE À VENDRE. »
--
-- C'est la phrase du document et l'invariant de tout ce fichier.
-- Réserver 100 Trachycarpus doit faire baisser le DISPONIBLE et laisser
-- le PHYSIQUE intact jusqu'à la sortie réelle. Confondre les deux, c'est
-- soit vendre deux fois la même plante, soit refuser une commande qu'on
-- pouvait honorer.
--
-- Les quantités ne se modifient JAMAIS directement : elles passent par
-- `record_nursery_movement`, qui écrit le mouvement et applique l'effet
-- dans la même opération. Un stock corrigé à la main sans trace, c'est
-- un inventaire qu'on ne peut plus expliquer six mois plus tard, et
-- §MOUVEMENTS demande explicitement que « chaque mouvement soit
-- audit-able ».

-- ============================================================
-- 1. Emplacements
-- ============================================================
-- §NURSERY DIGITAL TWIN — les types de zones du document. Hiérarchiques
-- (site → serre → tunnel → rang → tablette) via `parent_id` : c'est
-- ainsi qu'une pépinière est réellement organisée, et c'est ce qui
-- permet de demander « tout ce qui est dans la serre 2 ».

create table if not exists public.nursery_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  parent_id uuid references public.nursery_locations (id) on delete set null,

  code text not null,
  name text not null default '',

  kind text not null default 'outdoorBlock' check (kind in (
    'site', 'greenhouse', 'tunnel', 'outdoorBlock', 'row',
    'bench', 'quarantine', 'shipping', 'potting', 'storage'
  )),

  surface_m2 numeric(12, 2),
  -- Nombre de contenants que l'emplacement peut recevoir. L'occupation,
  -- elle, se compte sur les lots présents : la stocker se
  -- désynchroniserait au premier déplacement.
  capacity int,

  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint nursery_locations_code_unique unique (organization_id, code)
);

create index if not exists nursery_locations_parent_idx
  on public.nursery_locations (parent_id);

-- ============================================================
-- 2. Étapes de production
-- ============================================================
-- §11J : seed / cutting / division / BioLab → plug → C1 → C3 → C5 →
-- C10 → saleable, « Configurable ». Donc une table, pas une
-- énumération : une pépinière qui travaille en C2 et C7 doit pouvoir le
-- dire sans migration.

create table if not exists public.nursery_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  code text not null,
  label text not null,
  position int not null default 0,
  -- Vrai pour la dernière étape : ce qui est vendable.
  is_saleable boolean not null default false,
  created_at timestamptz not null default now(),
  constraint nursery_stages_code_unique unique (organization_id, code)
);

-- ============================================================
-- 3. Lots
-- ============================================================

create table if not exists public.nursery_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  lot_code text not null,

  -- §"une donnée ne doit être saisie qu'UNE SEULE FOIS" : l'espèce vient
  -- de la fiche déjà générée côté iOS quand elle existe.
  species_profile_id uuid references public.species_profiles (id) on delete set null,
  -- Nom d'usage, toujours renseigné : une fiche d'espèce peut manquer,
  -- une étiquette de lot jamais.
  species_name text not null,
  cultivar text,

  origin text,
  supplier_id uuid references public.suppliers (id) on delete set null,
  -- §TRAÇABILITÉ — « supplier → supplier lot → internal lot → split →
  -- location → customer ». Le lot du fournisseur est une chaîne : c'est
  -- ce qui figure sur son bordereau, pas une clé chez nous.
  supplier_lot_reference text,
  -- La micropropagation d'où il sort, s'il en sort. Lien de traçabilité
  -- seulement, jamais de calcul.
  source_biolab_batch_id uuid references public.culture_batches (id) on delete set null,
  -- Le lot dont celui-ci a été détaché — §split.
  parent_lot_id uuid references public.nursery_lots (id) on delete set null,

  container_size text,
  plant_size text,
  stage_id uuid references public.nursery_stages (id) on delete set null,

  -- LES QUANTITÉS. Modifiées uniquement par `record_nursery_movement`.
  initial_quantity int not null default 0 check (initial_quantity >= 0),
  current_quantity int not null default 0 check (current_quantity >= 0),
  -- Réservé, donc plus disponible à la vente — mais toujours physique.
  reserved_quantity int not null default 0 check (reserved_quantity >= 0),

  status text not null default 'inProduction' check (status in (
    'inProduction', 'available', 'reserved', 'quarantine',
    'hold', 'damaged', 'lost', 'sold', 'completed'
  )),

  location_id uuid references public.nursery_locations (id) on delete set null,

  -- §QR — un jeton aléatoire, jamais les données du lot. Même principe
  -- que `smart_tags` en Phase 4E, mais une colonne ici plutôt qu'une
  -- ligne là-bas : `smart_tags.plant_id` est NOT NULL et l'app iPhone y
  -- écrit ; le rendre nullable pour y loger des lots casserait son
  -- décodage. Les deux tables vivent d'ailleurs sur des axes de
  -- cloisonnement différents — espace de travail contre organisation.
  public_token text unique default encode(gen_random_bytes(16), 'hex'),

  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint nursery_lots_code_unique unique (organization_id, lot_code),
  -- On ne réserve pas plus qu'on ne possède. La contrainte double la
  -- vérification de la fonction : une écriture directe qui passerait à
  -- côté serait refusée ici.
  constraint nursery_lots_reserved_within_stock
    check (reserved_quantity <= current_quantity)
);

create index if not exists nursery_lots_org_status_idx
  on public.nursery_lots (organization_id, status) where archived_at is null;
create index if not exists nursery_lots_location_idx on public.nursery_lots (location_id);
create index if not exists nursery_lots_species_idx on public.nursery_lots (species_name);
create index if not exists nursery_lots_token_idx on public.nursery_lots (public_token);

-- ============================================================
-- 4. Mouvements
-- ============================================================
-- §MOUVEMENTS — « Chaque mouvement est audit-able. » C'est le journal :
-- on n'y modifie ni n'y supprime rien, on ajoute une ligne contraire.

create table if not exists public.nursery_stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  lot_id uuid not null references public.nursery_lots (id) on delete cascade,

  kind text not null check (kind in (
    'receive', 'move', 'split', 'merge', 'repot', 'reserve',
    'unreserve', 'sell', 'loss', 'quarantine', 'release', 'adjustment'
  )),

  -- Toujours positive : c'est le TYPE qui dit le sens. Une quantité
  -- signée invite à saisir « -5 » pour une réception, et on ne le
  -- retrouve qu'à l'inventaire.
  quantity int not null check (quantity >= 0),

  from_location_id uuid references public.nursery_locations (id) on delete set null,
  to_location_id uuid references public.nursery_locations (id) on delete set null,
  related_lot_id uuid references public.nursery_lots (id) on delete set null,

  reason text,
  performed_by uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists nursery_movements_lot_idx
  on public.nursery_stock_movements (lot_id, occurred_at desc);

-- ============================================================
-- 5. Rempotage
-- ============================================================
-- §REMPotage — fromContainer, toContainer, quantity, substrate, date,
-- labor, losses.

create table if not exists public.repotting_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  lot_id uuid not null references public.nursery_lots (id) on delete cascade,

  from_container text,
  to_container text not null,
  quantity int not null default 0 check (quantity >= 0),
  substrate text,
  labor_hours numeric(8, 2),
  -- Les pertes du rempotage sortent du stock par un mouvement `loss`
  -- distinct : les compter ici seulement laisserait le lot faux.
  losses int not null default 0 check (losses >= 0),

  occurred_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists repotting_events_lot_idx on public.repotting_events (lot_id);

-- ============================================================
-- 6. Santé et traçabilité — §11L
-- ============================================================

create table if not exists public.nursery_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  lot_id uuid not null references public.nursery_lots (id) on delete cascade,

  inspected_on date not null default current_date,
  result text not null default 'healthy' check (result in (
    'healthy', 'watch', 'problem', 'critical'
  )),
  findings text,
  action_taken text,
  inspected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists nursery_inspections_lot_idx
  on public.nursery_inspections (lot_id, inspected_on desc);

-- ============================================================
-- 7. Réservations
-- ============================================================
-- §RÉSERVATIONS — « doit diminuer available, mais pas physical avant
-- sortie réelle. »
--
-- La commande client elle-même arrive au Milestone 9 : `sales_order_id`
-- reste donc une colonne libre, remplie plus tard. Une réservation sans
-- commande est parfaitement valable en attendant — un client au
-- téléphone qui pose une option.

create table if not exists public.nursery_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  lot_id uuid not null references public.nursery_lots (id) on delete cascade,
  customer_id uuid references public.crm_customers (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,

  quantity int not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'released', 'fulfilled')),

  expires_on date,
  notes text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nursery_reservations_lot_idx
  on public.nursery_reservations (lot_id) where status = 'active';

-- ============================================================
-- 8. Le stock vivant
-- ============================================================
-- §STOCK VIVANT — « Physical, Available, Reserved, Quarantine, In
-- Production, Expected. »
--
-- « Expected » — ce qui est commandé mais pas reçu — vient des
-- commandes fournisseurs, qui arrivent au Milestone 9. La colonne
-- n'existe donc pas encore plutôt que de valoir zéro : un zéro affiché
-- se lit « rien n'arrive », ce qui n'est pas la même chose que « on ne
-- sait pas encore ».
create or replace view public.nursery_stock as
select
  l.organization_id,
  l.species_name,
  sum(l.current_quantity)::int as physical,
  -- Disponible : ce qui est en vente, moins ce qui est réservé dessus.
  sum(case when l.status = 'available'
           then l.current_quantity - l.reserved_quantity else 0 end)::int as available,
  sum(l.reserved_quantity)::int as reserved,
  sum(case when l.status = 'quarantine' then l.current_quantity else 0 end)::int as quarantine,
  sum(case when l.status = 'inProduction' then l.current_quantity else 0 end)::int as in_production
from public.nursery_lots l
where l.archived_at is null
group by l.organization_id, l.species_name;

alter view public.nursery_stock set (security_invoker = true);

/** L'occupation d'un emplacement, comptée sur les lots présents. */
create or replace view public.nursery_location_occupation as
select
  loc.id as location_id,
  loc.organization_id,
  loc.capacity,
  coalesce(sum(l.current_quantity), 0)::int as occupied,
  case
    when loc.capacity is null or loc.capacity = 0 then null
    else round((coalesce(sum(l.current_quantity), 0)::numeric / loc.capacity) * 100)
  end as occupation_percent
from public.nursery_locations loc
left join public.nursery_lots l
  on l.location_id = loc.id and l.archived_at is null
where loc.archived_at is null
group by loc.id, loc.organization_id, loc.capacity;

alter view public.nursery_location_occupation set (security_invoker = true);

-- ============================================================
-- 9. RLS
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'nursery_locations', 'nursery_stages', 'nursery_lots',
    'nursery_stock_movements', 'repotting_events',
    'nursery_inspections', 'nursery_reservations'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members with nursery read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with nursery read %1$s" on public.%1$I
         for select using (public.has_permission(organization_id, ''nursery.stock.manage''))', t);

    execute format('drop policy if exists "Members with nursery write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with nursery write %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''nursery.stock.manage''))
         with check (public.has_permission(organization_id, ''nursery.stock.manage''))', t);
  end loop;
end $$;

-- ============================================================
-- 10. Le seul chemin qui bouge un stock
-- ============================================================
-- Écrit le mouvement ET applique son effet, en une opération. Séparés,
-- ils divergeraient au premier incident réseau, et un inventaire qui ne
-- correspond plus à son journal ne s'explique plus.
--
-- Rend la quantité restante du lot.
create or replace function public.record_nursery_movement(
  p_lot_id uuid,
  p_kind text,
  p_quantity int,
  p_to_location_id uuid default null,
  p_reason text default null,
  p_related_lot_id uuid default null
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  lot record;
  new_quantity int;
  new_reserved int;
  new_status text;
  from_loc uuid;
begin
  select * into lot from public.nursery_lots where id = p_lot_id;
  -- RLS a déjà filtré : un lot invisible ressort nul ici.
  if lot is null then
    raise exception 'Lot introuvable.';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'La quantité doit être positive : c''est le type de mouvement qui en donne le sens.';
  end if;

  new_quantity := lot.current_quantity;
  new_reserved := lot.reserved_quantity;
  new_status := lot.status;
  from_loc := lot.location_id;

  case p_kind
    when 'receive' then
      new_quantity := new_quantity + p_quantity;

    when 'sell', 'loss' then
      if p_quantity > lot.current_quantity then
        raise exception 'Le lot ne contient que % unités.', lot.current_quantity;
      end if;
      new_quantity := new_quantity - p_quantity;
      -- Une vente consomme d'abord ce qui était réservé pour elle :
      -- sinon la réservation survivrait à la sortie et bloquerait un
      -- stock déjà parti.
      if p_kind = 'sell' then
        new_reserved := greatest(0, new_reserved - p_quantity);
      else
        new_reserved := least(new_reserved, new_quantity);
      end if;

    when 'reserve' then
      -- LE POINT CENTRAL — §RÉSERVATIONS. Le physique ne bouge pas.
      if p_quantity > (lot.current_quantity - lot.reserved_quantity) then
        raise exception 'Disponible insuffisant : % unités réservables.',
          lot.current_quantity - lot.reserved_quantity;
      end if;
      new_reserved := new_reserved + p_quantity;

    when 'unreserve' then
      new_reserved := greatest(0, new_reserved - p_quantity);

    when 'move' then
      if p_to_location_id is null then
        raise exception 'Un déplacement demande un emplacement de destination.';
      end if;

    when 'quarantine' then
      new_status := 'quarantine';

    when 'release' then
      new_status := 'available';

    when 'adjustment' then
      -- Un inventaire : la quantité comptée remplace la quantité crue.
      new_quantity := p_quantity;
      new_reserved := least(new_reserved, new_quantity);

    when 'split', 'merge', 'repot' then
      -- Le déplacement de quantité entre deux lots est écrit par
      -- l'appelant en deux mouvements, un par lot. Ici on n'enregistre
      -- que la trace.
      null;

    else
      raise exception 'Type de mouvement inconnu : %', p_kind;
  end case;

  update public.nursery_lots
     set current_quantity = new_quantity,
         reserved_quantity = new_reserved,
         status = new_status,
         location_id = coalesce(p_to_location_id, location_id),
         updated_at = now()
   where id = p_lot_id;

  insert into public.nursery_stock_movements (
    organization_id, lot_id, kind, quantity,
    from_location_id, to_location_id, related_lot_id, reason, performed_by
  ) values (
    lot.organization_id, p_lot_id, p_kind, p_quantity,
    from_loc, p_to_location_id, p_related_lot_id, p_reason, auth.uid()
  );

  return new_quantity;
end;
$$;

-- ============================================================
-- 11. Scinder un lot
-- ============================================================
-- §split, et §TRAÇABILITÉ : le lot détaché garde son parent, donc la
-- chaîne remonte jusqu'au bordereau du fournisseur.
create or replace function public.split_nursery_lot(
  p_lot_id uuid,
  p_quantity int,
  p_new_lot_code text,
  p_to_location_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  lot record;
  child uuid;
begin
  select * into lot from public.nursery_lots where id = p_lot_id;
  if lot is null then
    raise exception 'Lot introuvable.';
  end if;
  if p_quantity <= 0 or p_quantity >= lot.current_quantity then
    raise exception 'Scinder demande une quantité comprise entre 1 et % exclus.', lot.current_quantity;
  end if;
  -- On ne détache pas du stock déjà promis à quelqu'un sans le dire.
  if p_quantity > (lot.current_quantity - lot.reserved_quantity) then
    raise exception 'Ce lot a % unités réservées : libérez-les avant de scinder.',
      lot.reserved_quantity;
  end if;

  insert into public.nursery_lots (
    organization_id, lot_code, species_profile_id, species_name, cultivar,
    origin, supplier_id, supplier_lot_reference, source_biolab_batch_id,
    parent_lot_id, container_size, plant_size, stage_id,
    initial_quantity, current_quantity, status, location_id
  ) values (
    lot.organization_id, p_new_lot_code, lot.species_profile_id, lot.species_name, lot.cultivar,
    lot.origin, lot.supplier_id, lot.supplier_lot_reference, lot.source_biolab_batch_id,
    lot.id, lot.container_size, lot.plant_size, lot.stage_id,
    p_quantity, p_quantity, lot.status, coalesce(p_to_location_id, lot.location_id)
  )
  returning id into child;

  -- Le parent perd ce que l'enfant emporte, avec sa trace.
  perform public.record_nursery_movement(
    p_lot_id, 'split', p_quantity, null,
    'Scindé vers ' || p_new_lot_code, child
  );
  update public.nursery_lots
     set current_quantity = current_quantity - p_quantity, updated_at = now()
   where id = p_lot_id;

  return child;
end;
$$;
