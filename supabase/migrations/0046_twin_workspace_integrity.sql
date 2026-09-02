-- Un enfant du jardin appartient à l'espace de travail de son jardin.
--
-- L'éditeur web tamponnait les objets, zones et limites avec l'espace de
-- l'ORGANISATION ACTIVE. Or un même compte est membre de plusieurs
-- espaces : le sien, créé à l'inscription et où l'iPhone écrit, et celui
-- de son entreprise. Modifier depuis le web le plan d'un jardin
-- personnel écrivait donc des objets estampillés « entreprise » sous un
-- jardin « personnel ».
--
-- Ce n'est pas cosmétique. Les politiques RLS disent
-- `is_workspace_member(workspace_id)` et rien d'autre : un salarié
-- invité dans l'entreprise pourrait lire ces `garden_map_objects` — le
-- contenu du jardin privé du patron — sans jamais voir le jardin qui les
-- porte. RLS ferait exactement ce qu'on lui demande ; c'est la donnée
-- qui serait rangée au mauvais endroit.
--
-- Deux temps : on répare l'existant, puis on rend la faute impossible
-- au niveau de la base, parce que le correctif applicatif seul peut
-- régresser au prochain écrivain — et parce qu'une version de l'app déjà
-- installée continuera d'envoyer ce qu'elle envoie aujourd'hui.

-- 1. Réparation. Le jardin fait foi : l'espace d'un enfant est une
--    donnée dérivée, jamais une information propre.
update public.garden_map_objects c
   set workspace_id = g.workspace_id
  from public.gardens g
 where g.id = c.garden_id
   and c.workspace_id is distinct from g.workspace_id;

update public.garden_areas c
   set workspace_id = g.workspace_id
  from public.gardens g
 where g.id = c.garden_id
   and c.workspace_id is distinct from g.workspace_id;

update public.garden_boundaries c
   set workspace_id = g.workspace_id
  from public.gardens g
 where g.id = c.garden_id
   and c.workspace_id is distinct from g.workspace_id;

update public.digital_twin_revisions c
   set workspace_id = g.workspace_id
  from public.gardens g
 where g.id = c.garden_id
   and c.workspace_id is distinct from g.workspace_id;

update public.garden_plan_images c
   set workspace_id = g.workspace_id
  from public.gardens g
 where g.id = c.garden_id
   and c.workspace_id is distinct from g.workspace_id;

-- 2. Garde-fou.
--
-- Corrige plutôt que refuse : lever une exception ferait échouer la
-- synchronisation d'une app déjà installée sur le téléphone de
-- quelqu'un, sans qu'il puisse rien y faire. La valeur correcte est
-- connue de façon certaine, donc on l'applique.
--
-- `updated_at` n'est délibérément pas touché : une correction d'espace
-- n'est pas une modification métier, et la faire remonter réveillerait
-- la détection de conflit de l'éditeur pour rien.
create or replace function public.enforce_garden_child_workspace()
returns trigger
language plpgsql
as $$
declare
  parent_workspace uuid;
begin
  if new.garden_id is null then
    return new;
  end if;

  select workspace_id into parent_workspace
    from public.gardens where id = new.garden_id;

  if parent_workspace is not null and new.workspace_id is distinct from parent_workspace then
    new.workspace_id := parent_workspace;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_workspace on public.garden_map_objects;
create trigger trg_workspace before insert or update on public.garden_map_objects
  for each row execute function public.enforce_garden_child_workspace();

drop trigger if exists trg_workspace on public.garden_areas;
create trigger trg_workspace before insert or update on public.garden_areas
  for each row execute function public.enforce_garden_child_workspace();

drop trigger if exists trg_workspace on public.garden_boundaries;
create trigger trg_workspace before insert or update on public.garden_boundaries
  for each row execute function public.enforce_garden_child_workspace();

drop trigger if exists trg_workspace on public.digital_twin_revisions;
create trigger trg_workspace before insert or update on public.digital_twin_revisions
  for each row execute function public.enforce_garden_child_workspace();

drop trigger if exists trg_workspace on public.garden_plan_images;
create trigger trg_workspace before insert or update on public.garden_plan_images
  for each row execute function public.enforce_garden_child_workspace();
