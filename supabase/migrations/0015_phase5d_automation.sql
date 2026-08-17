-- Oasis Care — Phase 5D: automation engine.
--
-- Spec §92 lists automation_rules and automation_executions; conditions
-- and actions get their own tables here rather than a JSON blob on
-- automation_rules, so a condition can hold a real foreign key to the
-- sensor/device it reads/controls (matching the local SwiftData
-- relational model — AutomationCondition/AutomationAction are their
-- own @Model types for the same reason).
--
-- Run this once in the Supabase SQL Editor after 0001-0014.

create table public.automation_rules (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  mode text not null default 'manual',
  scope_garden_id uuid references public.gardens (id) on delete cascade,
  scope_zone_id uuid references public.garden_zones (id) on delete cascade,
  scope_plant_id uuid references public.plants (id) on delete cascade,
  max_duration_seconds double precision,
  max_volume_liters double precision,
  max_runs_per_day integer,
  minimum_delay_between_runs_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_triggered_at timestamptz,
  deleted_at timestamptz
);

create table public.automation_conditions (
  id uuid primary key,
  rule_id uuid not null references public.automation_rules (id) on delete cascade,
  type text not null,
  "order" integer not null default 0,
  numeric_threshold double precision,
  hours_threshold double precision,
  time_range_start_minutes integer,
  time_range_end_minutes integer,
  days_of_week integer[] not null default '{}',
  sensor_id uuid references public.sensors (id) on delete set null,
  device_id uuid references public.connected_devices (id) on delete set null
);

create table public.automation_actions (
  id uuid primary key,
  rule_id uuid not null references public.automation_rules (id) on delete cascade,
  type text not null,
  device_id uuid references public.connected_devices (id) on delete set null,
  duration_seconds double precision,
  message text,
  "order" integer not null default 0
);

create table public.automation_executions (
  id uuid primary key,
  rule_id uuid references public.automation_rules (id) on delete cascade,
  date timestamptz not null default now(),
  conditions_summary text not null default '',
  decision boolean not null,
  action_summary text,
  succeeded boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index automation_rules_scope_garden_idx on public.automation_rules (scope_garden_id);
create index automation_rules_scope_zone_idx on public.automation_rules (scope_zone_id);
create index automation_rules_scope_plant_idx on public.automation_rules (scope_plant_id);
create index automation_conditions_rule_id_idx on public.automation_conditions (rule_id);
create index automation_actions_rule_id_idx on public.automation_actions (rule_id);
create index automation_executions_rule_id_idx on public.automation_executions (rule_id);

alter table public.automation_rules enable row level security;
create policy "Workspace members can manage automation rules" on public.automation_rules
  for all using (public.is_workspace_member(workspace_id));

alter table public.automation_conditions enable row level security;
create policy "Workspace members can manage automation conditions" on public.automation_conditions
  for all using (
    exists (
      select 1 from public.automation_rules r
      where r.id = rule_id and public.is_workspace_member(r.workspace_id)
    )
  );

alter table public.automation_actions enable row level security;
create policy "Workspace members can manage automation actions" on public.automation_actions
  for all using (
    exists (
      select 1 from public.automation_rules r
      where r.id = rule_id and public.is_workspace_member(r.workspace_id)
    )
  );

alter table public.automation_executions enable row level security;
create policy "Workspace members can manage automation executions" on public.automation_executions
  for all using (
    exists (
      select 1 from public.automation_rules r
      where r.id = rule_id and public.is_workspace_member(r.workspace_id)
    )
  );
