-- Oasis Care — CORRECTIF : la détection de conflit du Digital Twin ne
-- voyait pas les suppressions faites depuis l'iPhone.
--
-- À exécuter après 0062. Idempotente et purement additive.
--
-- ============================================================
-- CE QUI SE PASSAIT
-- ============================================================
--
-- `garden_twin_last_modified` rend `max(updated_at)` sur les cinq
-- tables du plan. L'éditeur web garde cette valeur au chargement et la
-- renvoie à chaque sauvegarde : si le maximum a AVANCÉ, quelqu'un a
-- écrit entre-temps, et on refuse d'écraser son travail.
--
-- Le raisonnement tient pour une modification et pour un ajout. Il
-- tombe sur une SUPPRESSION.
--
-- L'iPhone supprime EN DUR — `pushPendingDeletions` fait un
-- `.delete().eq("id", …)`, sans `deleted_at`. La ligne disparaît. Le
-- maximum des `updated_at` restants ne bouge pas, ou DESCEND si c'était
-- justement la ligne la plus récente.
--
-- Enchaînement observé :
--   1. le web charge le plan, retient le repère M ;
--   2. l'utilisateur supprime un arbre sur son téléphone ;
--   3. le web sauvegarde automatiquement, compare, ne voit rien bouger,
--      et réécrit son instantané — qui contient encore l'arbre.
--
-- L'arbre revient. Sans message, sans conflit signalé, et à chaque
-- fois : l'utilisateur le supprime de nouveau sur son téléphone, la
-- sauvegarde suivante le fait réapparaître.
--
-- ============================================================
-- LA CORRECTION
-- ============================================================
-- Un repère qui compte aussi les LIGNES. Une suppression change le
-- compte, même quand elle ne change aucune date.
--
-- Le repère devient une chaîne opaque, comparée par ÉGALITÉ et non par
-- ordre. C'est plus strict et plus juste : « quelque chose a changé »
-- est la question posée, pas « est-ce plus récent ». Une horloge en
-- retard sur un client ne peut plus masquer une écriture.

create or replace function public.garden_twin_version(p_garden_id uuid)
returns text
language sql
security invoker
set search_path = public
stable
as $$
  select
    -- Le maximum des dates attrape les modifications et les ajouts…
    to_char(
      greatest(
        coalesce((select max(updated_at) from public.garden_map_objects where garden_id = p_garden_id), 'epoch'::timestamptz),
        coalesce((select max(updated_at) from public.garden_areas       where garden_id = p_garden_id), 'epoch'::timestamptz),
        coalesce((select max(updated_at) from public.garden_boundaries  where garden_id = p_garden_id), 'epoch'::timestamptz),
        coalesce((select max(updated_at) from public.irrigation_pipes   where garden_id = p_garden_id), 'epoch'::timestamptz),
        coalesce((select max(updated_at) from public.garden_cables      where garden_id = p_garden_id), 'epoch'::timestamptz)
      ) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US'
    )
    || '/' ||
    -- … et le nombre de lignes attrape les suppressions dures, que les
    -- dates ne peuvent pas voir.
    (
      (select count(*) from public.garden_map_objects where garden_id = p_garden_id and deleted_at is null)
      + (select count(*) from public.garden_areas       where garden_id = p_garden_id and deleted_at is null)
      + (select count(*) from public.garden_boundaries  where garden_id = p_garden_id and deleted_at is null)
      + (select count(*) from public.irrigation_pipes   where garden_id = p_garden_id and deleted_at is null)
      + (select count(*) from public.garden_cables      where garden_id = p_garden_id and deleted_at is null)
    )::text;
$$;

comment on function public.garden_twin_version(uuid) is
  'Repère de version du plan : date la plus récente ET nombre de lignes. Le compte est indispensable — une suppression dure venue de l''iPhone ne change aucune date (correctif 0063).';

-- `garden_twin_last_modified` reste en place : elle dit une chose vraie
-- et utile — quand le plan a été touché pour la dernière fois — même si
-- elle ne suffit pas à détecter un conflit. La supprimer casserait
-- toute lecture qui l'utilise pour AFFICHER une date.
