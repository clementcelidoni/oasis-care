-- Oasis Care — Phase 11, Milestone 7 : §11G PLANNING et §11H ÉQUIPES.
--
-- À exécuter après 0050. Idempotente et purement additive.
--
-- « NE PAS créer un moteur de paie complet maintenant. Préparer les
-- données nécessaires. » C'est écrit dans la spec et c'est la limite de
-- ce fichier : on enregistre qui a travaillé, quand, sur quoi, et ce
-- que cette heure coûte à l'entreprise. Aucun bulletin, aucune
-- cotisation, aucune convention collective. Ces règles changent chaque
-- année et se trompent silencieusement.
--
-- LE COÛT HORAIRE EST PHOTOGRAPHIÉ SUR LE POINTAGE. Même raison que le
-- prix sur une ligne de devis : augmenter quelqu'un ne doit pas
-- renchérir rétroactivement les chantiers de l'an dernier.

-- ============================================================
-- 1. Salariés
-- ============================================================

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- Facultatif : un ouvrier peut être planifié sans avoir de compte
  -- Oasis. Exiger un compte obligerait à en créer un pour un
  -- intérimaire de trois jours.
  user_id uuid references auth.users (id) on delete set null,

  first_name text not null,
  last_name text not null default '',
  job_title text,
  email text,
  phone text,

  -- Coût pour l'entreprise, charges comprises — pas le salaire brut, et
  -- surtout pas un taux de facturation. C'est ce chiffre qui alimente
  -- le coût réel de main-d'œuvre d'un chantier.
  hourly_cost_cents bigint not null default 0,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_org_idx on public.employees (organization_id)
  where archived_at is null;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  name text not null,
  -- Couleur du planning. Une équipe se repère à sa couleur sur une
  -- semaine chargée, pas à son nom écrit en petit.
  color text not null default '#15654a',
  lead_employee_id uuid references public.employees (id) on delete set null,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  primary key (team_id, employee_id)
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint skills_name_unique unique (organization_id, name)
);

create table if not exists public.employee_skills (
  employee_id uuid not null references public.employees (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  -- 1 à 3 : notion, autonome, référent. Trois niveaux parce qu'au-delà
  -- personne ne sait plus ce que « 7/10 » veut dire.
  level int not null default 2 check (level between 1 and 3),
  primary key (employee_id, skill_id)
);

-- ============================================================
-- 2. Interventions
-- ============================================================
-- §INTERVENTIONS — `FieldIntervention` : project, customerSite, team,
-- scheduledStart, scheduledEnd, tasks, instructions, photos, materials,
-- timeEntries, notes, signature.

create table if not exists public.field_interventions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- Toutes facultatives : une visite de prospection n'a pas encore de
  -- chantier, et un entretien récurrent n'en a peut-être jamais.
  project_id uuid references public.projects (id) on delete set null,
  customer_id uuid references public.crm_customers (id) on delete set null,
  site_id uuid references public.crm_customer_sites (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,

  -- `visit` couvre la « Visite » de la navigation : c'est une
  -- intervention dont on ne sort pas un chantier mais un devis. Un type
  -- plutôt qu'une table à part — mêmes champs, même planning.
  kind text not null default 'work' check (kind in (
    'visit', 'work', 'maintenance', 'delivery', 'repair', 'other'
  )),

  title text not null,
  instructions text,
  notes text,

  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,

  status text not null default 'scheduled' check (status in (
    'scheduled', 'inProgress', 'done', 'cancelled'
  )),

  -- §signature. Un nom et un horodatage, rien de plus : une signature
  -- manuscrite capturée ici n'aurait aucune valeur probante
  -- particulière, et laisser croire le contraire serait pire que de ne
  -- pas la proposer. C'est un accusé de passage, pas un acte.
  signed_by_name text,
  signed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint field_interventions_schedule_ordered
    check (scheduled_end is null or scheduled_start is null or scheduled_end >= scheduled_start)
);

create index if not exists field_interventions_schedule_idx
  on public.field_interventions (organization_id, scheduled_start);
create index if not exists field_interventions_team_idx
  on public.field_interventions (team_id, scheduled_start);
create index if not exists field_interventions_project_idx
  on public.field_interventions (project_id);

create table if not exists public.intervention_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  intervention_id uuid not null references public.field_interventions (id) on delete cascade,

  title text not null,
  position int not null default 0,
  done boolean not null default false,
  done_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists intervention_tasks_idx
  on public.intervention_tasks (intervention_id, position);

-- Ce qui a réellement été consommé sur place. Distinct du prévu du
-- chantier : c'est le chef d'équipe qui le note, souvent le soir.
create table if not exists public.intervention_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  intervention_id uuid not null references public.field_interventions (id) on delete cascade,
  catalog_item_id uuid references public.catalog_items (id) on delete set null,

  description text not null,
  quantity numeric(14, 3) not null default 1,
  unit text not null default 'u',

  created_at timestamptz not null default now()
);

create index if not exists intervention_materials_idx
  on public.intervention_materials (intervention_id);

-- Les photos d'intervention rejoignent celles du chantier plutôt que
-- d'avoir leur table : mêmes colonnes, même bucket, et on veut pouvoir
-- les regarder ensemble sur la fiche du chantier.
alter table public.project_photos
  add column if not exists intervention_id uuid
    references public.field_interventions (id) on delete set null;

-- ============================================================
-- 3. Pointages
-- ============================================================

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  employee_id uuid not null references public.employees (id) on delete cascade,
  intervention_id uuid references public.field_interventions (id) on delete set null,
  -- Renseigné même quand l'intervention l'est : une intervention peut
  -- être détachée ou supprimée, et l'heure travaillée reste imputée au
  -- chantier. Sans cette colonne, le coût disparaîtrait avec elle.
  project_id uuid references public.projects (id) on delete set null,
  phase_id uuid references public.project_phases (id) on delete set null,

  worked_on date not null default current_date,
  hours numeric(6, 2) not null default 0 check (hours >= 0 and hours <= 24),

  -- Photographie du coût horaire du salarié au moment du pointage.
  -- Augmenter quelqu'un ne doit pas renchérir les chantiers passés.
  hourly_cost_cents bigint not null default 0,

  kind text not null default 'work' check (kind in ('work', 'travel', 'break', 'other')),
  notes text,

  -- Tant qu'un pointage n'est pas validé, il ne compte pas dans le coût
  -- du chantier. Un chef d'équipe qui se trompe de ligne le soir ne doit
  -- pas faire bouger un budget avant relecture.
  validated boolean not null default false,
  validated_by uuid references auth.users (id) on delete set null,
  validated_at timestamptz,

  total_cents bigint generated always as (
    round(hours * hourly_cost_cents)::bigint
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists time_entries_project_idx
  on public.time_entries (project_id, worked_on desc);
create index if not exists time_entries_employee_idx
  on public.time_entries (employee_id, worked_on desc);
create index if not exists time_entries_intervention_idx
  on public.time_entries (intervention_id);

-- Un salarié, une intervention, un jour, une nature : une seule ligne.
-- C'est ce qui rend `log_team_time` rejouable — pointer deux fois le
-- même soir corrige les heures au lieu de les doubler, et doubler les
-- heures d'un chantier sans que personne le voie est exactement le
-- genre d'erreur qu'on ne rattrape jamais.
--
-- Partiel : un pointage sans intervention (une journée d'atelier) n'est
-- pas concerné, et NULL ne se compare pas dans un index unique de toute
-- façon.
create unique index if not exists time_entries_one_per_day_idx
  on public.time_entries (employee_id, intervention_id, worked_on, kind)
  where intervention_id is not null;

-- ============================================================
-- 4. Les heures pointées entrent dans le coût du chantier
-- ============================================================
-- §JOB COSTING liste « heures » et « main-d'œuvre » parmi les postes à
-- comparer. Sans ce raccordement, il faudrait ressaisir à la main, en
-- fin de chantier, des heures déjà pointées — et personne ne le ferait.
--
-- Seuls les pointages VALIDÉS comptent, et seulement le travail : le
-- trajet et les pauses sont enregistrés parce qu'ils existent, pas
-- parce qu'on les impute au client.
--
-- Le risque connu de ce raccordement est le double comptage : quelqu'un
-- qui pointe ses heures ET saisit « main-d'œuvre » en dépense manuelle
-- verra les deux. L'écran affiche donc les deux origines séparément
-- plutôt que de les fondre, pour que l'anomalie se voie.
create or replace view public.project_cost_summary as
with planned as (
  select project_id, kind, sum(planned_total_cents)::bigint as planned_cents
  from public.project_resources group by project_id, kind
),
direct as (
  select project_id, kind, sum(total_cents)::bigint as actual_cents
  from public.project_costs group by project_id, kind
),
pointed as (
  select project_id, 'labor'::text as kind, sum(total_cents)::bigint as actual_cents
  from public.time_entries
  where validated and kind = 'work' and project_id is not null
  group by project_id
),
actual as (
  select project_id, kind, sum(actual_cents)::bigint as actual_cents
  from (select * from direct union all select * from pointed) both_sources
  group by project_id, kind
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

-- Ce que les heures pointées apportent, à part : l'écran le montre sous
-- la ligne « main-d'œuvre » pour que le double comptage éventuel saute
-- aux yeux au lieu de se cacher dans un total.
create or replace view public.project_labor_from_time as
select
  project_id,
  sum(hours)::numeric as validated_hours,
  sum(total_cents)::bigint as validated_cents,
  sum(case when not validated then hours else 0 end)::numeric as pending_hours
from public.time_entries
where kind = 'work' and project_id is not null
group by project_id;

alter view public.project_labor_from_time set (security_invoker = true);

-- ============================================================
-- 5. RLS
-- ============================================================
-- Les salaires sont la donnée la plus sensible d'une entreprise.
-- `projects.manage` pour écrire, `projects.read` pour lire — le même
-- couple que les chantiers, dont ces tables sont le prolongement.

do $$
declare t text;
begin
  foreach t in array array[
    'employees', 'teams', 'team_members', 'skills', 'employee_skills',
    'field_interventions', 'intervention_tasks', 'intervention_materials',
    'time_entries'
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
-- 6. Pointer une intervention
-- ============================================================
-- Le geste du soir : « toute l'équipe a fait 7 h sur cette
-- intervention ». Une fonction plutôt qu'une boucle côté web, pour la
-- même raison que la conversion d'un devis — et parce qu'elle recopie
-- le coût horaire de chacun au passage, ce qu'on oublierait.
--
-- Idempotente sur la journée : rappelée pour la même intervention et le
-- même jour, elle met à jour les heures au lieu d'empiler des doublons.
create or replace function public.log_team_time(
  p_intervention_id uuid,
  p_hours numeric,
  p_worked_on date default current_date
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  iv record;
  member record;
  n int := 0;
begin
  select * into iv from public.field_interventions where id = p_intervention_id;
  -- RLS a déjà filtré : une intervention invisible ressort nulle ici.
  if iv is null then
    raise exception 'Intervention introuvable.';
  end if;
  if iv.team_id is null then
    raise exception 'Cette intervention n''a pas d''équipe : pointez individuellement.';
  end if;

  for member in
    select e.id, e.hourly_cost_cents
    from public.team_members tm
    join public.employees e on e.id = tm.employee_id
    where tm.team_id = iv.team_id and e.archived_at is null
  loop
    insert into public.time_entries (
      organization_id, employee_id, intervention_id, project_id,
      worked_on, hours, hourly_cost_cents
    ) values (
      iv.organization_id, member.id, p_intervention_id, iv.project_id,
      p_worked_on, p_hours, member.hourly_cost_cents
    )
    on conflict (employee_id, intervention_id, worked_on, kind)
      where intervention_id is not null
    do update set
      hours = excluded.hours,
      -- Le coût horaire est RAFRAÎCHI à la correction : on rectifie un
      -- pointage du jour même, pas on ne réécrit l'histoire.
      hourly_cost_cents = excluded.hourly_cost_cents,
      updated_at = now(),
      -- Une correction annule la validation : le chiffre a changé, il
      -- doit repasser sous les yeux de quelqu'un avant de compter.
      validated = false,
      validated_by = null,
      validated_at = null;
    n := n + 1;
  end loop;

  return n;
end;
$$;
