-- Oasis Care — Phase 11, Milestone 6 : §11F PROJETS / CHANTIERS.
--
-- À exécuter après 0049. Idempotente et purement additive.
--
-- LE PRÉVU VIENT DU COÛT, PAS DU PRIX DE VENTE.
--
-- C'est la décision qui gouverne tout ce fichier, et l'erreur la plus
-- facile à commettre. §JOB COSTING demande de comparer « Prévu » et
-- « Réel ». Le prévu d'un chantier, c'est ce qu'on avait prévu de
-- DÉPENSER — donc `unit_cost_cents` de la ligne de devis, jamais
-- `unit_sale_price_cents`. Prendre le prix de vente ferait apparaître
-- chaque chantier comme largement bénéficiaire tant qu'on dépense moins
-- que ce qu'on a facturé, ce qui est vrai par construction et
-- n'apprend rien. La marge, elle, se lit sur le devis ; ici on suit la
-- dépense.
--
-- L'AVANCEMENT EST SAISI, JAMAIS DÉDUIT DE LA DÉPENSE. Avoir consommé
-- 80 % du budget ne veut pas dire que 80 % du chantier est fait — c'est
-- même souvent l'inverse qui devrait alerter. Les deux chiffres restent
-- séparés, et c'est leur écart qui informe.

-- ============================================================
-- 1. Projets
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  customer_id uuid not null references public.crm_customers (id) on delete restrict,
  site_id uuid references public.crm_customer_sites (id) on delete set null,
  garden_id uuid references public.gardens (id) on delete set null,
  -- Le devis dont il est né. `set null` et non `cascade` : supprimer un
  -- devis ne doit pas emporter le chantier qui en est sorti.
  quote_id uuid references public.quotes (id) on delete set null,

  number text not null,
  name text not null default '',

  status text not null default 'planned' check (status in (
    'planned', 'inProgress', 'onHold', 'completed', 'handedOver', 'cancelled'
  )),

  planned_start_on date,
  planned_end_on date,
  actual_start_on date,
  actual_end_on date,

  notes text,

  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_number_unique unique (organization_id, number),
  constraint projects_planned_dates_ordered
    check (planned_end_on is null or planned_start_on is null or planned_end_on >= planned_start_on)
);

create index if not exists projects_org_status_idx
  on public.projects (organization_id, status) where archived_at is null;
create index if not exists projects_customer_idx on public.projects (customer_id);
create index if not exists projects_quote_idx on public.projects (quote_id);

-- ============================================================
-- 2. Phases
-- ============================================================
-- §PHASES : Préparation, Terrassement, Irrigation, Plantation,
-- Éclairage, Finitions, Réception — « Configurables ». Donc du texte
-- libre, et un défaut proposé à la création plutôt qu'une énumération
-- figée en base.

create table if not exists public.project_phases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  title text not null,
  position int not null default 0,

  status text not null default 'notStarted' check (status in (
    'notStarted', 'inProgress', 'blocked', 'done'
  )),
  -- Saisi par le conducteur de travaux, jamais calculé — voir l'en-tête.
  progress_percent int not null default 0 check (progress_percent between 0 and 100),

  planned_start_on date,
  planned_end_on date,
  actual_start_on date,
  actual_end_on date,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_phases_project_idx
  on public.project_phases (project_id, position);

-- ============================================================
-- 3. Tâches
-- ============================================================

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid references public.project_phases (id) on delete set null,

  title text not null,
  position int not null default 0,
  status text not null default 'todo' check (status in ('todo', 'doing', 'blocked', 'done')),

  assigned_to uuid references auth.users (id) on delete set null,
  planned_hours numeric(10, 2),
  due_on date,
  done_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks (project_id, position);
create index if not exists project_tasks_phase_idx on public.project_tasks (phase_id, position);

-- ============================================================
-- 4. Ressources prévues et coûts réels
-- ============================================================
-- Deux tables et non une, avec une colonne « prévu/réel » : une
-- ressource prévue vient du devis et n'a pas de date ; un coût réel a
-- une date, souvent un fournisseur, et parfois aucun équivalent au
-- devis. Les confondre obligerait à laisser la moitié des colonnes
-- vides dans chaque cas.

-- Natures de coût — §JOB COSTING : « heures, main-d'œuvre, matériaux,
-- végétaux, engins, sous-traitants, transport, autres coûts ».
create or replace function public.cost_kind_from_catalog_type(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
    when 'plant' then 'plant'
    when 'labor' then 'labor'
    when 'material' then 'material'
    when 'equipment' then 'equipment'
    when 'rental' then 'equipment'
    when 'transport' then 'transport'
    when 'waste' then 'waste'
    when 'subcontracting' then 'subcontracting'
    else 'other'
  end;
$$;

-- La nature portée par la ligne de devis elle-même.
--
-- Sans elle, la nature ne se déduisait que de l'article du catalogue —
-- et une ligne saisie librement, ce qui est le cas courant, n'en a pas.
-- Tout le chiffrage tombait alors dans « Divers », et le suivi
-- prévu/réel se réduisait à une ligne unique : exactement le contraire
-- de ce que §JOB COSTING demande.
--
-- Nullable et sans défaut : on n'écrit une valeur que lorsqu'on la
-- connaît vraiment — l'article du catalogue la donne, la proposition
-- issue du plan aussi. Deviner d'après le libellé collerait une nature
-- fausse sur des lignes que personne ne relirait.
alter table public.quote_lines
  add column if not exists cost_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quote_lines_cost_kind_valid'
  ) then
    alter table public.quote_lines add constraint quote_lines_cost_kind_valid
      check (cost_kind is null or cost_kind in (
        'labor', 'material', 'plant', 'equipment',
        'subcontracting', 'transport', 'waste', 'other'
      ));
  end if;
end $$;

create table if not exists public.project_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid references public.project_phases (id) on delete set null,

  -- D'où vient cette prévision. Traçabilité seulement : on ne relit
  -- jamais la ligne pour en tirer un montant, exactement comme une
  -- ligne de devis ne relit jamais le catalogue.
  quote_line_id uuid references public.quote_lines (id) on delete set null,
  catalog_item_id uuid references public.catalog_items (id) on delete set null,

  kind text not null default 'other' check (kind in (
    'labor', 'material', 'plant', 'equipment', 'subcontracting', 'transport', 'waste', 'other'
  )),
  description text not null,
  unit text not null default 'u',
  planned_quantity numeric(14, 3) not null default 0,
  -- COÛT, pas prix de vente. Voir l'en-tête du fichier.
  planned_unit_cost_cents bigint not null default 0,

  planned_total_cents bigint generated always as (
    round(planned_quantity * planned_unit_cost_cents)::bigint
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_resources_project_idx
  on public.project_resources (project_id, kind);

create table if not exists public.project_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid references public.project_phases (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,

  kind text not null default 'other' check (kind in (
    'labor', 'material', 'plant', 'equipment', 'subcontracting', 'transport', 'waste', 'other'
  )),
  description text not null,
  unit text not null default 'u',
  quantity numeric(14, 3) not null default 1,
  unit_cost_cents bigint not null default 0,

  total_cents bigint generated always as (
    round(quantity * unit_cost_cents)::bigint
  ) stored,

  incurred_on date not null default current_date,
  invoice_reference text,
  notes text,

  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_costs_project_idx
  on public.project_costs (project_id, incurred_on desc);

-- ============================================================
-- 5. Photos de chantier
-- ============================================================

create table if not exists public.project_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid references public.project_phases (id) on delete set null,

  storage_path text not null,
  caption text,
  -- « avant / pendant / après » : la comparaison la plus utile sur un
  -- chantier de paysage, et celle qu'on veut pouvoir montrer au client.
  moment text not null default 'during' check (moment in ('before', 'during', 'after')),
  taken_on date not null default current_date,

  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_photos_project_idx
  on public.project_photos (project_id, taken_on desc);

insert into storage.buckets (id, name, public)
values ('project-photos', 'project-photos', false)
on conflict (id) do nothing;

-- Le chemin commence par l'id de l'organisation : c'est ce que la
-- politique vérifie, même principe que le bucket des plans (0045).
do $$
begin
  execute 'drop policy if exists "Members can read project photos" on storage.objects';
  execute $p$
    create policy "Members can read project photos" on storage.objects
      for select using (
        bucket_id = 'project-photos'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'projects.read')
      )
  $p$;

  execute 'drop policy if exists "Members can write project photos" on storage.objects';
  execute $p$
    create policy "Members can write project photos" on storage.objects
      for all using (
        bucket_id = 'project-photos'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'projects.manage')
      )
      with check (
        bucket_id = 'project-photos'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'projects.manage')
      )
  $p$;
end $$;

-- ============================================================
-- 6. Prévu contre réel
-- ============================================================
-- §JOB COSTING — `ProjectCostService`.
--
-- Une vue, jamais des colonnes stockées : un écart budgétaire qui se
-- désynchronise de ses composantes est pire qu'une absence de chiffre,
-- parce qu'on le croit.
--
-- `full outer join` : une nature de coût peut exister d'un seul côté.
-- Un poste prévu et jamais dépensé compte autant qu'une dépense que
-- personne n'avait prévue — c'est même celle-là qu'on cherche.
create or replace view public.project_cost_summary as
with planned as (
  select project_id, kind, sum(planned_total_cents)::bigint as planned_cents
  from public.project_resources group by project_id, kind
),
actual as (
  select project_id, kind, sum(total_cents)::bigint as actual_cents
  from public.project_costs group by project_id, kind
)
select
  coalesce(p.project_id, a.project_id) as project_id,
  coalesce(p.kind, a.kind) as kind,
  coalesce(p.planned_cents, 0) as planned_cents,
  coalesce(a.actual_cents, 0) as actual_cents,
  (coalesce(a.actual_cents, 0) - coalesce(p.planned_cents, 0)) as variance_cents
from planned p
full outer join actual a on a.project_id = p.project_id and a.kind = p.kind;

alter view public.project_cost_summary set (security_invoker = true);

-- ============================================================
-- 7. Numérotation
-- ============================================================

create table if not exists public.project_counters (
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  year int not null,
  last_number int not null default 0,
  primary key (organization_id, year)
);

alter table public.project_counters enable row level security;
drop policy if exists "Members with projects.manage can use counters" on public.project_counters;
create policy "Members with projects.manage can use counters" on public.project_counters
  for all using (public.has_permission(organization_id, 'projects.manage'))
  with check (public.has_permission(organization_id, 'projects.manage'));

create or replace function public.next_project_number(p_organization_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  y int := extract(year from current_date);
  n int;
begin
  insert into public.project_counters (organization_id, year, last_number)
  values (p_organization_id, y, 1)
  on conflict (organization_id, year) do update
    set last_number = public.project_counters.last_number + 1
  returning last_number into n;

  return 'CH-' || y::text || '-' || lpad(n::text, 4, '0');
end;
$$;

-- ============================================================
-- 8. RLS
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'project_phases', 'project_tasks',
    'project_resources', 'project_costs', 'project_photos'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members with projects.read can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with projects.read can read %1$s" on public.%1$I
         for select using (public.has_permission(organization_id, ''projects.read''))', t);

    execute format('drop policy if exists "Members with projects.manage can write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with projects.manage can write %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''projects.manage''))
         with check (public.has_permission(organization_id, ''projects.manage''))', t);
  end loop;
end $$;

-- ============================================================
-- 9. « Transformer en projet »
-- ============================================================
-- §DEVIS ACCEPTÉ — « Bouton : Transformer en projet. Créer
-- automatiquement les éléments pertinents. »
--
-- Une fonction et non une suite d'appels depuis l'application : créer
-- un chantier, ses phases et ses vingt ressources doit réussir en
-- entier ou pas du tout. Interrompu au milieu, le web laisserait un
-- chantier à moitié peuplé que personne ne saurait distinguer d'un
-- chantier normal.
--
-- Idempotente : un second clic rend le projet déjà créé au lieu d'en
-- fabriquer un jumeau.
create or replace function public.create_project_from_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  org_id uuid;
  q record;
  existing uuid;
  new_project uuid;
  section record;
  line record;
  phase_id uuid;
  phase_by_section jsonb := '{}'::jsonb;
begin
  select * into q from public.quotes where id = p_quote_id;
  -- RLS a déjà filtré : un devis invisible ressort nul ici.
  if q is null then
    raise exception 'Devis introuvable.';
  end if;
  org_id := q.organization_id;

  select id into existing from public.projects
   where quote_id = p_quote_id and archived_at is null limit 1;
  if existing is not null then
    return existing;
  end if;

  insert into public.projects (
    organization_id, customer_id, site_id, garden_id, quote_id,
    number, name, created_by
  ) values (
    org_id, q.customer_id, q.site_id, q.garden_id, p_quote_id,
    public.next_project_number(org_id),
    coalesce(nullif(q.title, ''), 'Chantier ' || q.number),
    auth.uid()
  )
  returning id into new_project;

  -- Une phase par poste du devis : le découpage du chiffrage est déjà
  -- celui du chantier, le refaire à la main serait une double saisie.
  for section in
    select * from public.quote_sections where quote_id = p_quote_id order by position
  loop
    insert into public.project_phases (organization_id, project_id, title, position)
    values (org_id, new_project, section.title, section.position)
    returning id into phase_id;
    phase_by_section := phase_by_section || jsonb_build_object(section.id::text, phase_id::text);
  end loop;

  -- Une ressource prévue par ligne, au COÛT et non au prix de vente.
  for line in
    select * from public.quote_lines where quote_id = p_quote_id order by position
  loop
    insert into public.project_resources (
      organization_id, project_id, phase_id, quote_line_id, catalog_item_id,
      kind, description, unit, planned_quantity, planned_unit_cost_cents
    ) values (
      org_id, new_project,
      case when line.section_id is null then null
           else (phase_by_section ->> line.section_id::text)::uuid end,
      line.id, line.catalog_item_id,
      -- Ce que la ligne dit d'elle-même d'abord ; à défaut, ce que dit
      -- son article de catalogue ; à défaut « Divers », qui reste une
      -- réponse honnête et se corrige sur la fiche du chantier.
      coalesce(
        line.cost_kind,
        public.cost_kind_from_catalog_type(
          (select item_type from public.catalog_items where id = line.catalog_item_id)
        )
      ),
      line.description, line.unit, line.quantity,
      line.unit_cost_cents
    );
  end loop;

  return new_project;
end;
$$;
