-- Milestone 4 — Digital Twin technique.
--
-- Presque rien à créer : la Phase 6 avait déjà `irrigation_pipes`
-- (migration 0025) et les champs d'arroseur sur `garden_map_objects`.
-- La spec dit « Réutiliser l'architecture Phase 6 », et c'est
-- littéralement possible. Cette migration ne comble que trois manques.

-- 1. Les câbles d'éclairage.
--
-- §LIGHTING : « Prévoir : GardenLight, Cable, PowerSource, Transformer,
-- ElectricalZone » — avec, juste en dessous, « Pas d'ingénierie
-- électrique certifiée automatique ». Les luminaires et les points
-- électriques sont déjà des `garden_map_objects` (`light`,
-- `electricalPoint`) ; ce qui manquait était le tracé des câbles, une
-- polyligne que `garden_map_objects` ne sait pas représenter — même
-- raison qui avait imposé une table séparée pour les tuyaux.
--
-- Volontairement pauvre en champs : de quoi tracer un réseau et en
-- sortir un métré, pas de quoi dimensionner une installation. Une
-- section, un type de courant, et rien qui ressemble à un calcul
-- réglementaire que personne ici n'a qualité pour certifier.
--
-- ATTENTION : l'app iOS ne connaît pas encore cette table. Un câble
-- tracé sur le web n'apparaîtra pas sur le téléphone tant qu'un modèle
-- Swift ne sera pas ajouté. Rien n'est perdu — la ligne existe et sera
-- lue le jour venu — mais l'asymétrie est réelle et assumée ici plutôt
-- que découverte à l'usage.
create table if not exists public.garden_cables (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  garden_id uuid references public.gardens (id) on delete cascade,
  points jsonb not null default '[]'::jsonb,
  -- lowVoltage | mains | other, en clair et non en enum Postgres : les
  -- tables jumelles (irrigation_pipes.material, line_type) font pareil,
  -- et un enum Postgres se modifie mal depuis une app cliente.
  cable_type text not null default 'lowVoltage',
  section_mm2 double precision,
  -- Pas de clé étrangère vers garden_map_objects, exactement comme
  -- start_node_object_id sur irrigation_pipes : un identifiant orphelin
  -- se résout à « non relié » côté client plutôt que de faire échouer
  -- l'écriture.
  start_node_object_id uuid,
  end_node_object_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists garden_cables_garden_id_idx on public.garden_cables (garden_id);

alter table public.garden_cables enable row level security;

drop policy if exists "Workspace members can manage garden cables" on public.garden_cables;
create policy "Workspace members can manage garden cables" on public.garden_cables
  for all using (public.is_workspace_member(workspace_id));

-- 2. Le garde-fou d'espace de travail (migration 0046) doit couvrir les
--    deux tables de réseau, sinon la fuite qu'il ferme se rouvre par la
--    porte du réseau d'irrigation.
drop trigger if exists trg_workspace on public.irrigation_pipes;
create trigger trg_workspace before insert or update on public.irrigation_pipes
  for each row execute function public.enforce_garden_child_workspace();

drop trigger if exists trg_workspace on public.garden_cables;
create trigger trg_workspace before insert or update on public.garden_cables
  for each row execute function public.enforce_garden_child_workspace();

-- 3. La détection de conflit ignorait les réseaux.
--
-- §CONCURRENCY : « Ne pas écraser silencieusement le travail d'un autre
-- utilisateur. » La fonction ne regardait que les objets, les zones et
-- la limite. Quelqu'un qui ne modifiait QUE le réseau d'irrigation ne
-- faisait donc bouger aucun horodatage : un second éditeur chargeait,
-- ne voyait aucun conflit, et écrasait le réseau en enregistrant. Le
-- silence était exactement ce que la spec interdit.
create or replace function public.garden_twin_last_modified(p_garden_id uuid)
returns timestamptz
language sql
security invoker
set search_path = public
stable
as $$
  select greatest(
    coalesce((select max(updated_at) from public.garden_map_objects where garden_id = p_garden_id), 'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.garden_areas       where garden_id = p_garden_id), 'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.garden_boundaries  where garden_id = p_garden_id), 'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.irrigation_pipes   where garden_id = p_garden_id), 'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.garden_cables      where garden_id = p_garden_id), 'epoch'::timestamptz)
  );
$$;
