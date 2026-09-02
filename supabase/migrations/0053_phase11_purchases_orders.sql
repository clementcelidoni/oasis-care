-- Oasis Care — Phase 11, Milestone 9 : §11M ACHATS et §11N COMMANDES.
--
-- À exécuter après 0052. Idempotente et purement additive.
--
-- CE FICHIER FERME UNE BOUCLE. Le stock vivant du Milestone 8 affichait
-- cinq mesures sur six : « attendu » manquait, faute de commandes
-- fournisseurs. Il arrive ici, et la vue est complétée en conséquence.
--
-- DEUX RÈGLES REPRISES DES MILESTONES PRÉCÉDENTS, parce qu'elles valent
-- toujours :
--
-- 1. Une quantité de stock ne bouge QUE par `record_nursery_movement`.
--    Livrer une commande client passe donc par un mouvement `sell`, qui
--    consomme la réservation au lieu de s'y ajouter.
--
-- 2. Rien n'est créé silencieusement. §"RÉCEPTION VÉGÉTAUX : peut créer
--    automatiquement NurseryLot APRÈS VALIDATION." Le mot compte : la
--    fonction de réception ne fabrique un lot que si on le lui demande
--    explicitement, ligne par ligne.

-- ============================================================
-- 1. Commandes fournisseurs
-- ============================================================

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,

  number text not null,
  reference text,

  -- §Workflow : Purchase Order → Sent → Partially Received → Received.
  -- `partiallyReceived` et `received` ne se saisissent pas à la main :
  -- ils se déduisent des quantités reçues — voir `refresh_purchase_order_status`.
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'partiallyReceived', 'received', 'cancelled'
  )),

  ordered_on date not null default current_date,
  expected_on date,
  sent_at timestamptz,
  notes text,

  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint purchase_orders_number_unique unique (organization_id, number)
);

create index if not exists purchase_orders_org_status_idx
  on public.purchase_orders (organization_id, status) where archived_at is null;
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  catalog_item_id uuid references public.catalog_items (id) on delete set null,

  position int not null default 0,
  description text not null,
  unit text not null default 'u',
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  -- Prix d'ACHAT, photographié à la commande. Même raison que sur une
  -- ligne de devis : le tarif du fournisseur peut changer, la commande
  -- passée ne doit pas se rechiffrer.
  unit_cost_cents bigint not null default 0,
  vat_rate numeric(5, 2) not null default 20,

  -- Pour une ligne de végétaux : de quoi fabriquer le lot à la
  -- réception, sans avoir à le ressaisir.
  is_plant boolean not null default false,
  species_name text,
  cultivar text,
  container_size text,

  total_cents bigint generated always as (
    round(quantity * unit_cost_cents)::bigint
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_order_lines_po_idx
  on public.purchase_order_lines (purchase_order_id, position);

-- ============================================================
-- 2. Réceptions
-- ============================================================

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,

  received_on date not null default current_date,
  delivery_note_reference text,
  notes text,

  received_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists goods_receipts_po_idx
  on public.goods_receipts (purchase_order_id, received_on desc);

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts (id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines (id) on delete cascade,

  quantity numeric(14, 3) not null check (quantity > 0),
  -- Le lot créé à cette réception, s'il y en a un. Lien de traçabilité :
  -- §"supplier → supplier lot → internal lot".
  nursery_lot_id uuid references public.nursery_lots (id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists goods_receipt_lines_receipt_idx
  on public.goods_receipt_lines (goods_receipt_id);
create index if not exists goods_receipt_lines_po_line_idx
  on public.goods_receipt_lines (purchase_order_line_id);

-- ============================================================
-- 3. Commandes clients
-- ============================================================

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  customer_id uuid not null references public.crm_customers (id) on delete restrict,
  quote_id uuid references public.quotes (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,

  number text not null,
  reference text,

  status text not null default 'draft' check (status in (
    'draft', 'confirmed', 'partiallyDelivered', 'delivered', 'cancelled'
  )),

  ordered_on date not null default current_date,
  requested_on date,
  notes text,

  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sales_orders_number_unique unique (organization_id, number)
);

create index if not exists sales_orders_org_status_idx
  on public.sales_orders (organization_id, status) where archived_at is null;
create index if not exists sales_orders_customer_idx on public.sales_orders (customer_id);

create table if not exists public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  -- Le lot précis d'où sortira la marchandise. Nul tant qu'on n'a pas
  -- choisi : on peut commander « 100 Trachycarpus » avant de savoir
  -- dans quel lot on ira les prendre.
  lot_id uuid references public.nursery_lots (id) on delete set null,
  reservation_id uuid references public.nursery_reservations (id) on delete set null,

  position int not null default 0,
  description text not null,
  unit text not null default 'u',
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit_sale_price_cents bigint not null default 0,
  vat_rate numeric(5, 2) not null default 20,

  total_cents bigint generated always as (
    round(quantity * unit_sale_price_cents)::bigint
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_order_lines_order_idx
  on public.sales_order_lines (sales_order_id, position);

-- ============================================================
-- 4. Préparation et livraison
-- ============================================================
-- §PICKING — « Commande → itinéraire → scan lot → quantité →
-- validation ». L'itinéraire se déduit des emplacements des lots : on
-- range la liste par emplacement pour ne pas traverser la pépinière
-- quatre fois.

create table if not exists public.picking_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,

  status text not null default 'open' check (status in ('open', 'inProgress', 'done', 'cancelled')),
  assigned_to uuid references public.employees (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists picking_lists_order_idx on public.picking_lists (sales_order_id);

create table if not exists public.picking_list_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  picking_list_id uuid not null references public.picking_lists (id) on delete cascade,
  sales_order_line_id uuid references public.sales_order_lines (id) on delete set null,
  lot_id uuid references public.nursery_lots (id) on delete set null,

  requested_quantity numeric(14, 3) not null default 0,
  picked_quantity numeric(14, 3) not null default 0 check (picked_quantity >= 0),
  picked_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists picking_list_lines_list_idx
  on public.picking_list_lines (picking_list_id);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  picking_list_id uuid references public.picking_lists (id) on delete set null,

  number text not null,
  delivered_on date not null default current_date,
  carrier text,
  tracking_reference text,
  -- Même choix qu'en §INTERVENTIONS : un nom et un horodatage, pas un
  -- tracé. Une signature dessinée dans un navigateur n'a aucune valeur
  -- probante particulière, et l'afficher comme telle tromperait.
  received_by_name text,
  received_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),

  constraint deliveries_number_unique unique (organization_id, number)
);

create index if not exists deliveries_order_idx on public.deliveries (sales_order_id);

create table if not exists public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  sales_order_line_id uuid references public.sales_order_lines (id) on delete set null,
  lot_id uuid references public.nursery_lots (id) on delete set null,

  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),

  created_at timestamptz not null default now()
);

create index if not exists delivery_lines_delivery_idx on public.delivery_lines (delivery_id);

-- ============================================================
-- 5. Ce qui reste à recevoir, ce qui reste à livrer
-- ============================================================
-- Des vues, jamais des colonnes : une quantité reçue stockée à côté de
-- ses réceptions finit par les contredire.

create or replace view public.purchase_order_progress as
select
  l.purchase_order_id,
  l.id as line_id,
  l.quantity as ordered,
  coalesce(sum(r.quantity), 0)::numeric as received,
  greatest(0, l.quantity - coalesce(sum(r.quantity), 0))::numeric as remaining
from public.purchase_order_lines l
left join public.goods_receipt_lines r on r.purchase_order_line_id = l.id
group by l.purchase_order_id, l.id, l.quantity;

alter view public.purchase_order_progress set (security_invoker = true);

create or replace view public.purchase_order_totals as
select
  po.id as purchase_order_id,
  coalesce(sum(l.total_cents), 0)::bigint as total_excluding_vat_cents,
  coalesce(sum(round(l.total_cents * l.vat_rate / 100.0)), 0)::bigint as total_vat_cents
from public.purchase_orders po
left join public.purchase_order_lines l on l.purchase_order_id = po.id
group by po.id;

alter view public.purchase_order_totals set (security_invoker = true);

create or replace view public.sales_order_totals as
select
  so.id as sales_order_id,
  coalesce(sum(l.total_cents), 0)::bigint as total_excluding_vat_cents,
  coalesce(sum(round(l.total_cents * l.vat_rate / 100.0)), 0)::bigint as total_vat_cents
from public.sales_orders so
left join public.sales_order_lines l on l.sales_order_id = so.id
group by so.id;

alter view public.sales_order_totals set (security_invoker = true);

-- ============================================================
-- 6. « Attendu » — la colonne qui manquait au Milestone 8
-- ============================================================
-- §STOCK VIVANT listait six mesures ; la sixième n'existait pas encore
-- faute de commandes fournisseurs. Elle existe maintenant : ce qui est
-- commandé et pas encore reçu, par espèce.
--
-- Seules les commandes ENVOYÉES comptent : un brouillon n'engage
-- personne, et le faire figurer dans un stock prévisionnel ferait
-- compter sur des plantes que personne n'a commandées.
create or replace view public.nursery_stock as
with expected as (
  select
    po.organization_id,
    l.species_name,
    sum(p.remaining)::int as expected
  from public.purchase_order_lines l
  join public.purchase_orders po on po.id = l.purchase_order_id
  join public.purchase_order_progress p on p.line_id = l.id
  where l.is_plant
    and l.species_name is not null
    and po.status in ('sent', 'partiallyReceived')
    and po.archived_at is null
  group by po.organization_id, l.species_name
),
held as (
  select
    l.organization_id,
    l.species_name,
    sum(l.current_quantity)::int as physical,
    sum(case when l.status = 'available'
             then l.current_quantity - l.reserved_quantity else 0 end)::int as available,
    sum(l.reserved_quantity)::int as reserved,
    sum(case when l.status = 'quarantine' then l.current_quantity else 0 end)::int as quarantine,
    sum(case when l.status = 'inProduction' then l.current_quantity else 0 end)::int as in_production
  from public.nursery_lots l
  where l.archived_at is null
  group by l.organization_id, l.species_name
)
select
  coalesce(h.organization_id, e.organization_id) as organization_id,
  coalesce(h.species_name, e.species_name) as species_name,
  coalesce(h.physical, 0) as physical,
  coalesce(h.available, 0) as available,
  coalesce(h.reserved, 0) as reserved,
  coalesce(h.quarantine, 0) as quarantine,
  coalesce(h.in_production, 0) as in_production,
  coalesce(e.expected, 0) as expected
from held h
-- `full outer join` : une espèce commandée mais jamais encore reçue
-- n'a aucun lot, et doit pourtant apparaître — c'est justement ce que
-- « attendu » sert à montrer.
full outer join expected e
  on e.organization_id = h.organization_id and e.species_name = h.species_name;

alter view public.nursery_stock set (security_invoker = true);

-- ============================================================
-- 7. Numérotation
-- ============================================================

create table if not exists public.document_counters (
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  kind text not null,
  year int not null,
  last_number int not null default 0,
  primary key (organization_id, kind, year)
);

alter table public.document_counters enable row level security;
drop policy if exists "Members can use document counters" on public.document_counters;
create policy "Members can use document counters" on public.document_counters
  for all using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

/**
 * Un numéro de document, unique par organisation, par nature et par
 * année. Une seule instruction, donc deux appels simultanés ne peuvent
 * pas rendre le même numéro — voir `next_quote_number`, même raison.
 */
create or replace function public.next_document_number(
  p_organization_id uuid,
  p_kind text,
  p_prefix text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  y int := extract(year from current_date);
  n int;
begin
  insert into public.document_counters (organization_id, kind, year, last_number)
  values (p_organization_id, p_kind, y, 1)
  on conflict (organization_id, kind, year) do update
    set last_number = public.document_counters.last_number + 1
  returning last_number into n;

  return p_prefix || '-' || y::text || '-' || lpad(n::text, 4, '0');
end;
$$;

-- ============================================================
-- 8. RLS
-- ============================================================
-- Les achats relèvent de `invoice.create`, les ventes de `quotes.read`
-- pour lire et `quotes.edit` pour écrire : ce sont les mêmes personnes
-- qui chiffrent et qui vendent.

do $$
declare t text;
begin
  foreach t in array array[
    'purchase_orders', 'purchase_order_lines', 'goods_receipts', 'goods_receipt_lines'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Members with purchasing %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with purchasing %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''invoice.create''))
         with check (public.has_permission(organization_id, ''invoice.create''))', t);
  end loop;

  foreach t in array array[
    'sales_orders', 'sales_order_lines', 'picking_lists',
    'picking_list_lines', 'deliveries', 'delivery_lines'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members with quotes.read can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with quotes.read can read %1$s" on public.%1$I
         for select using (public.has_permission(organization_id, ''quotes.read''))', t);

    execute format('drop policy if exists "Members with quotes.edit can write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with quotes.edit can write %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''quotes.edit''))
         with check (public.has_permission(organization_id, ''quotes.edit''))', t);
  end loop;
end $$;

-- ============================================================
-- 9. L'état d'une commande fournisseur se déduit des réceptions
-- ============================================================
-- Le saisir à la main garantirait qu'il finisse par mentir : quelqu'un
-- reçoit une palette et oublie de changer le statut.
create or replace function public.refresh_purchase_order_status(p_purchase_order_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  total_remaining numeric;
  total_received numeric;
  current_status text;
  new_status text;
begin
  select status into current_status from public.purchase_orders where id = p_purchase_order_id;
  if current_status is null then
    raise exception 'Commande introuvable.';
  end if;
  -- Un brouillon ou une commande annulée ne change pas d'état parce
  -- qu'on a reçu quelque chose : ce serait le signe d'une erreur, pas
  -- d'un avancement.
  if current_status in ('draft', 'cancelled') then
    return current_status;
  end if;

  select coalesce(sum(remaining), 0), coalesce(sum(received), 0)
    into total_remaining, total_received
  from public.purchase_order_progress
  where purchase_order_id = p_purchase_order_id;

  new_status := case
    when total_received = 0 then 'sent'
    when total_remaining = 0 then 'received'
    else 'partiallyReceived'
  end;

  update public.purchase_orders
     set status = new_status, updated_at = now()
   where id = p_purchase_order_id;

  return new_status;
end;
$$;

-- ============================================================
-- 10. Réceptionner
-- ============================================================
-- §"RÉCEPTION VÉGÉTAUX : peut créer automatiquement NurseryLot APRÈS
-- VALIDATION."
--
-- `p_create_lot` est explicite et vaut faux par défaut : la
-- fabrication d'un lot est un geste que l'utilisateur demande, jamais
-- un effet de bord de la réception. Un lot surgi tout seul dans
-- l'inventaire est exactement ce que §"NE PAS ajouter silencieusement"
-- proscrit ailleurs.
--
-- Rend l'identifiant du lot créé, ou nul.
create or replace function public.receive_purchase_line(
  p_goods_receipt_id uuid,
  p_purchase_order_line_id uuid,
  p_quantity numeric,
  p_create_lot boolean default false,
  p_lot_code text default null,
  p_location_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  line record;
  receipt record;
  remaining numeric;
  lot_id uuid := null;
begin
  select * into line from public.purchase_order_lines where id = p_purchase_order_line_id;
  select * into receipt from public.goods_receipts where id = p_goods_receipt_id;
  if line is null or receipt is null then
    raise exception 'Ligne de commande ou réception introuvable.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité reçue doit être positive.';
  end if;

  select p.remaining into remaining
    from public.purchase_order_progress p where p.line_id = p_purchase_order_line_id;

  -- Recevoir plus que commandé arrive vraiment — un fournisseur qui
  -- arrondit à la palette. On l'accepte, mais on refuse le double du
  -- reste : au-delà c'est une erreur de saisie, et l'écart se paierait
  -- à l'inventaire.
  if p_quantity > remaining * 2 and remaining > 0 then
    raise exception 'Il ne reste que % à recevoir sur cette ligne.', remaining;
  end if;

  if p_create_lot then
    if not line.is_plant then
      raise exception 'Seule une ligne de végétaux peut donner un lot de pépinière.';
    end if;
    if p_lot_code is null or btrim(p_lot_code) = '' then
      raise exception 'Un lot demande un code.';
    end if;

    insert into public.nursery_lots (
      organization_id, lot_code, species_name, cultivar, container_size,
      origin, supplier_id, supplier_lot_reference,
      initial_quantity, current_quantity, status, location_id
    ) values (
      line.organization_id, p_lot_code,
      coalesce(line.species_name, line.description), line.cultivar, line.container_size,
      'Achat', (select supplier_id from public.purchase_orders where id = line.purchase_order_id),
      receipt.delivery_note_reference,
      0, 0, 'inProduction', p_location_id
    )
    returning id into lot_id;

    -- La quantité entre par un mouvement, comme partout ailleurs : le
    -- journal du lot commence ainsi par son origine réelle.
    perform public.record_nursery_movement(
      lot_id, 'receive', p_quantity::int, p_location_id,
      'Réception ' || coalesce(receipt.delivery_note_reference, receipt.received_on::text)
    );
  end if;

  insert into public.goods_receipt_lines (
    organization_id, goods_receipt_id, purchase_order_line_id, quantity, nursery_lot_id
  ) values (
    line.organization_id, p_goods_receipt_id, p_purchase_order_line_id, p_quantity, lot_id
  );

  perform public.refresh_purchase_order_status(line.purchase_order_id);

  return lot_id;
end;
$$;

-- ============================================================
-- 11. Livrer
-- ============================================================
-- Le moment où le stock quitte réellement la pépinière.
--
-- C'est ici que se vérifie l'invariant du Milestone 8 : la sortie passe
-- par un mouvement `sell`, qui consomme la réservation au lieu de s'y
-- ajouter. Décrémenter directement laisserait la réservation en place
-- et bloquerait un stock déjà parti.
create or replace function public.deliver_sales_order_line(
  p_delivery_id uuid,
  p_sales_order_line_id uuid,
  p_quantity numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  line record;
  delivered numeric;
begin
  select * into line from public.sales_order_lines where id = p_sales_order_line_id;
  if line is null then
    raise exception 'Ligne de commande introuvable.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité livrée doit être positive.';
  end if;

  select coalesce(sum(quantity), 0) into delivered
    from public.delivery_lines where sales_order_line_id = p_sales_order_line_id;

  if delivered + p_quantity > line.quantity then
    raise exception 'Cette ligne porte sur % unités, dont % déjà livrées.',
      line.quantity, delivered;
  end if;

  insert into public.delivery_lines (
    organization_id, delivery_id, sales_order_line_id, lot_id, description, quantity
  ) values (
    line.organization_id, p_delivery_id, p_sales_order_line_id, line.lot_id,
    line.description, p_quantity
  );

  -- Le stock ne sort que si l'on sait de quel lot. Une ligne sans lot
  -- est une commande de service ou de fourniture : elle se livre sans
  -- toucher à la pépinière.
  if line.lot_id is not null then
    perform public.record_nursery_movement(
      line.lot_id, 'sell', p_quantity::int, null,
      'Livraison'
    );
  end if;

  -- L'état de la commande suit les livraisons, jamais l'inverse.
  update public.sales_orders so
     set status = case
           when (select coalesce(sum(dl.quantity), 0)
                   from public.delivery_lines dl
                   join public.sales_order_lines sol on sol.id = dl.sales_order_line_id
                  where sol.sales_order_id = so.id)
                >= (select coalesce(sum(sol.quantity), 0)
                      from public.sales_order_lines sol
                     where sol.sales_order_id = so.id)
           then 'delivered' else 'partiallyDelivered' end,
         updated_at = now()
   where so.id = line.sales_order_id
     and so.status not in ('draft', 'cancelled');
end;
$$;
