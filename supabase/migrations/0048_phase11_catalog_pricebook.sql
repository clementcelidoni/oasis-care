-- Oasis Care — Phase 11, Milestone 5 (1/2) : §11D BIBLIOTHÈQUE DE PRIX.
--
-- À exécuter après 0047. Idempotente et purement additive.
--
-- L'ARGENT EST EN CENTIMES ENTIERS, jamais en nombre à virgule
-- flottante. `0.1 + 0.2` ne vaut pas `0.3` en binaire, et une facture
-- qui se termine par un centime de trop est un litige. Même choix que
-- `crm_opportunities.estimated_value_cents` en 0044.
--
-- LE PRIX N'EST PAS DANS L'ARTICLE. Un `catalog_item` dit ce qu'est la
-- chose — un olivier en conteneur de 30 L, une heure de main-d'œuvre.
-- Ce qu'elle coûte vit à part, dans un `price_book_item` daté. Il faut
-- cette séparation pour la règle §HISTORIQUE : « Ne pas écraser les
-- anciens prix. » Un tarif qui change n'écrase rien : on ferme la
-- période de l'ancien et on en ouvre une nouvelle. Sans quoi rééditer
-- un devis de l'an dernier le rechiffrerait aux prix d'aujourd'hui.

-- ============================================================
-- 1. Fournisseurs
-- ============================================================
-- Créés ici parce que le prix d'achat vient d'eux. Le Milestone 9
-- (achats, commandes) enrichira la table ; il ne la recréera pas.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  name text not null,
  reference text,
  email text,
  phone text,
  website text,

  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text not null default 'FR',

  siret text,
  vat_number text,
  payment_terms text,
  notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_org_idx on public.suppliers (organization_id)
  where archived_at is null;

-- ============================================================
-- 2. Articles du catalogue
-- ============================================================

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- §TYPES, dans l'ordre du document.
  item_type text not null default 'material' check (item_type in (
    'plant', 'material', 'labor', 'equipment', 'rental',
    'transport', 'waste', 'subcontracting', 'service', 'custom'
  )),

  name text not null,
  reference text,
  description text,

  -- Unité de vente : u, m, m², m³, h, j, forfait, kg, L…
  -- Texte libre plutôt qu'énumération : le métier en invente
  -- régulièrement (ml, tonne, palette), et une contrainte trop serrée
  -- oblige à une migration pour chaque nouvelle.
  unit text not null default 'u',

  -- §"PRINCIPE FONDAMENTAL : une donnée ne doit être saisie qu'UNE
  -- SEULE FOIS. » Un article « plante » peut pointer vers la fiche
  -- d'espèce déjà générée côté iOS, plutôt que d'en ressaisir le nom
  -- latin et les besoins.
  species_profile_id uuid references public.species_profiles (id) on delete set null,

  -- Caractéristiques pépinière, utiles au chiffrage d'un végétal.
  container_size text,
  plant_size text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_items_org_type_idx
  on public.catalog_items (organization_id, item_type) where archived_at is null;
create index if not exists catalog_items_search_idx
  on public.catalog_items using gin (to_tsvector('french', coalesce(name, '') || ' ' || coalesce(reference, '')));

-- ============================================================
-- 3. Tarifs
-- ============================================================

create table if not exists public.price_books (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  name text not null,
  -- Le tarif proposé par défaut à la création d'un devis. Un seul par
  -- organisation : l'index unique partiel plus bas le garantit.
  is_default boolean not null default false,
  currency text not null default 'EUR',
  notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists price_books_one_default_idx
  on public.price_books (organization_id) where is_default and archived_at is null;

create table if not exists public.price_book_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  price_book_id uuid not null references public.price_books (id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items (id) on delete cascade,

  purchase_price_cents bigint not null default 0,
  sale_price_cents bigint not null default 0,

  -- Taux de TVA en pourcentage : 20, 10, 5.5. Stocké et non déduit :
  -- un même article peut relever d'un taux différent selon la
  -- prestation, et Oasis n'a pas à en décider.
  vat_rate numeric(5, 2) not null default 20,

  -- §HISTORIQUE. `valid_until` nul = tarif en cours. Fermer une période
  -- au lieu de modifier une ligne, c'est ce qui permet de rouvrir un
  -- devis ancien sans le rechiffrer.
  valid_from date not null default current_date,
  valid_until date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint price_book_items_period_ordered
    check (valid_until is null or valid_until >= valid_from)
);

create index if not exists price_book_items_lookup_idx
  on public.price_book_items (price_book_id, catalog_item_id, valid_from desc);

-- Un seul tarif EN COURS par article et par grille. Les périodes
-- closes, elles, peuvent s'empiler autant qu'il le faut.
create unique index if not exists price_book_items_one_current_idx
  on public.price_book_items (price_book_id, catalog_item_id) where valid_until is null;

create table if not exists public.supplier_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items (id) on delete cascade,

  price_cents bigint not null default 0,
  supplier_reference text,
  minimum_quantity numeric(14, 3),

  valid_from date not null default current_date,
  valid_until date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint supplier_prices_period_ordered
    check (valid_until is null or valid_until >= valid_from)
);

create index if not exists supplier_prices_lookup_idx
  on public.supplier_prices (catalog_item_id, valid_from desc);

-- ============================================================
-- 4. Marge
-- ============================================================
-- Calculée, jamais stockée. Une marge enregistrée à côté de ses deux
-- prix finit toujours par les contredire — il suffit d'en modifier un.
--
-- Marge en pourcentage du PRIX DE VENTE (taux de marque), et non du
-- prix d'achat (taux de marge) : c'est la convention du bâtiment et du
-- paysage en France, et se tromper de dénominateur fausse tous les
-- chiffrages. Un article acheté 60 et vendu 100 fait 40 % ici.
create or replace function public.margin_percent(cost_cents bigint, sale_cents bigint)
returns numeric
language sql
immutable
as $$
  select case
    when sale_cents is null or sale_cents = 0 then null
    else round(((sale_cents - coalesce(cost_cents, 0))::numeric / sale_cents) * 100, 2)
  end;
$$;

-- ============================================================
-- 5. RLS
-- ============================================================
-- Les prix d'achat et les marges sont parmi les données les plus
-- sensibles d'une entreprise. Lecture pour qui peut lire un devis,
-- écriture pour qui peut en modifier un. Vérifié en base : masquer le
-- menu ne protège rien.

do $$
declare t text;
begin
  foreach t in array array[
    'suppliers', 'catalog_items', 'price_books', 'price_book_items', 'supplier_prices'
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
-- 6. Changer un prix sans perdre l'ancien
-- ============================================================
-- Le geste courant — « ce paillage passe à 42 € » — doit fermer la
-- période en cours et en ouvrir une nouvelle, en une seule opération.
-- Laissé à l'application, il finirait tôt ou tard par un simple UPDATE.
create or replace function public.set_price_book_price(
  p_price_book_id uuid,
  p_catalog_item_id uuid,
  p_purchase_price_cents bigint,
  p_sale_price_cents bigint,
  p_vat_rate numeric default 20
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  org_id uuid;
  new_id uuid;
  current_id uuid;
  current_from date;
begin
  select organization_id into org_id from public.price_books where id = p_price_book_id;
  -- RLS a déjà filtré : une grille invisible ressort nulle ici.
  if org_id is null then
    raise exception 'Grille tarifaire introuvable.';
  end if;

  select id, valid_from into current_id, current_from
    from public.price_book_items
   where price_book_id = p_price_book_id
     and catalog_item_id = p_catalog_item_id
     and valid_until is null;

  -- Un prix saisi AUJOURD'HUI qu'on rectifie aujourd'hui n'est pas un
  -- changement de tarif : c'est une correction de saisie. On l'écrit
  -- sur place. Fermer la période « la veille » créerait ici un
  -- intervalle qui se termine avant de commencer — la contrainte
  -- `price_book_items_period_ordered` le refuserait, et le premier
  -- utilisateur à corriger une faute de frappe tomberait dessus.
  if current_id is not null and current_from >= current_date then
    update public.price_book_items
       set purchase_price_cents = coalesce(p_purchase_price_cents, 0),
           sale_price_cents = coalesce(p_sale_price_cents, 0),
           vat_rate = coalesce(p_vat_rate, 20),
           updated_at = now()
     where id = current_id;
    return current_id;
  end if;

  -- Vrai changement de tarif : on ferme la veille, sans chevauchement,
  -- et le nouveau prix s'applique à partir d'aujourd'hui.
  if current_id is not null then
    update public.price_book_items
       set valid_until = current_date - 1, updated_at = now()
     where id = current_id;
  end if;

  insert into public.price_book_items (
    organization_id, price_book_id, catalog_item_id,
    purchase_price_cents, sale_price_cents, vat_rate
  ) values (
    org_id, p_price_book_id, p_catalog_item_id,
    coalesce(p_purchase_price_cents, 0), coalesce(p_sale_price_cents, 0),
    coalesce(p_vat_rate, 20)
  )
  returning id into new_id;

  return new_id;
end;
$$;
