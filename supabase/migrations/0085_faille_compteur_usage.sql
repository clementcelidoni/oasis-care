-- Oasis Care — CORRECTIF DE SÉCURITÉ (migration 0085).
--
-- ============================================================
-- LA FAILLE, PROUVÉE AVANT D'ÊTRE CORRIGÉE
-- ============================================================
--
-- `public.increment_usage_counter` est `security definer`, son droit
-- d'exécution est accordé à `anon` ET à `authenticated`, et elle ne
-- compare JAMAIS `p_user_id` à `auth.uid()`.
--
-- Conséquence : n'importe qui, SANS AUCUN COMPTE, peut consommer le
-- quota d'IA d'un utilisateur nommé. Joué en transaction annulée sur
-- cette base, avec le rôle `anon` — donc sans le moindre jeton :
--
--     set local role anon;
--     select public.increment_usage_counter(
--              <user_id d'un vrai compte>, <workspace_id>,
--              'assistantMessage', '2026-08', 1000000);
--
--     avant = 2   après = 3   →  quota d'autrui consommé
--
-- Un appelant patient épuise ainsi le forfait mensuel d'un abonné, qui
-- se voit refuser SES propres appels d'IA sans comprendre pourquoi. Et
-- comme la fonction insère la ligne quand elle n'existe pas, elle
-- permet aussi d'écrire dans `usage_counters` pour des identifiants
-- arbitraires.
--
-- SECONDE FAILLE, PLUS GRAVE ENCORE MAIS MOINS VISIBLE : ni cette
-- fonction ni `is_workspace_member` ne fixent leur `search_path`. Une
-- fonction `security definer` s'exécute avec les droits de son
-- propriétaire ; si son chemin de recherche n'est pas figé, un appelant
-- qui a le droit de créer des objets temporaires peut interposer une
-- table ou une fonction du même nom devant celles de `public`, et faire
-- exécuter son code AVEC LES DROITS DU PROPRIÉTAIRE. `anon` et
-- `authenticated` ont ce droit sur `pg_temp`. C'est le vecteur
-- d'élévation de privilèges classique de PostgreSQL.
--
-- ============================================================
-- POURQUOI LE CORRECTIF ÉVIDENT AURAIT TOUT CASSÉ
-- ============================================================
--
-- Le réflexe est d'écrire `if p_user_id <> auth.uid() then raise`. Il
-- aurait mis l'IA mobile entière hors service.
--
-- Les quatorze fonctions Edge qui appellent cette procédure le font par
-- `admin.rpc(...)`, c'est-à-dire avec la clé `service_role` : dans ce
-- contexte `auth.uid()` vaut NULL. Elles ont DÉJÀ authentifié
-- l'utilisateur de leur côté avant d'appeler, et lui passent son
-- identifiant en argument — ce qui est légitime.
--
-- Le contrôle doit donc distinguer DEUX appelants :
--   • `service_role` — il agit pour le compte d'un utilisateur qu'il a
--     lui-même vérifié. On le laisse nommer n'importe quel identifiant.
--   • tous les autres — ils ne peuvent compter QUE leur propre usage.
-- Et `anon` perd purement et simplement le droit d'appeler : aucun
-- scénario légitime ne fait compter un quota à quelqu'un qui n'est
-- connecté à rien.

-- ------------------------------------------------------------
-- 1. LE COMPTEUR D'USAGE
-- ------------------------------------------------------------
-- Le corps est repris à l'identique — verrou de ligne `for update`
-- compris, qui est correct et rare : c'est lui qui empêche deux appels
-- simultanés de compter une seule fois. On n'ajoute qu'un garde et un
-- `search_path`.

create or replace function public.increment_usage_counter(
  p_user_id uuid,
  p_workspace_id uuid,
  p_feature text,
  p_period text,
  p_limit integer
)
returns table(allowed boolean, used integer)
language plpgsql
security definer
-- Le chemin est FIGÉ. `pg_temp` est placé en DERNIER : s'il venait en
-- premier, une table temporaire nommée `usage_counters` prendrait la
-- place de la vraie, avec les droits du propriétaire de la fonction.
set search_path = public, pg_temp
as $function$
declare
  current_count integer;
begin
  -- LE GARDE. `auth.role()` rend le rôle porté par la requête.
  -- `service_role` a déjà vérifié l'utilisateur en amont ; quiconque
  -- d'autre ne compte que pour lui-même.
  if coalesce(auth.role(), '') <> 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception
      'Accès refusé : on ne peut compter que son propre usage.'
      using errcode = '42501';
  end if;

  insert into public.usage_counters (user_id, workspace_id, feature, period, count)
  values (p_user_id, p_workspace_id, p_feature, p_period, 0)
  on conflict (user_id, feature, period) do nothing;

  select count into current_count from public.usage_counters
  where user_id = p_user_id and feature = p_feature and period = p_period
  for update;

  if current_count >= p_limit then
    return query select false, current_count;
  else
    update public.usage_counters set count = count + 1, updated_at = now()
    where user_id = p_user_id and feature = p_feature and period = p_period;
    return query select true, current_count + 1;
  end if;
end;
$function$;

-- La ceinture en plus des bretelles : même si le garde était un jour
-- affaibli par mégarde, un visiteur non connecté ne peut plus appeler.
revoke all on function public.increment_usage_counter(uuid, uuid, text, text, integer) from public;
revoke all on function public.increment_usage_counter(uuid, uuid, text, text, integer) from anon;
grant execute on function public.increment_usage_counter(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.increment_usage_counter(uuid, uuid, text, text, integer) to service_role;

-- ------------------------------------------------------------
-- 2. LE CHEMIN DE RECHERCHE DE `is_workspace_member`
-- ------------------------------------------------------------
-- Cette fonction est appelée par CINQUANTE-SEPT politiques RLS : c'est
-- l'ossature de l'isolation du monde particulier. Elle vérifie déjà
-- `auth.uid()`, donc pas de garde à ajouter — mais elle est
-- `security definer` sans `search_path`, ce qui en fait le meilleur
-- point d'entrée d'une élévation de privilèges de tout le schéma.
--
-- ON NE TOUCHE NI À SON CORPS NI À SES DROITS. `anon` garde l'exécution :
-- une politique RLS s'évalue avec le rôle qui interroge, et la lui
-- retirer ferait échouer toute requête d'un visiteur sur une table
-- protégée — au lieu de lui rendre zéro ligne, ce qui est le
-- comportement attendu. On se contente de figer le chemin.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_workspace_member'
   limit 1;

  if v_def is null then
    raise notice 'is_workspace_member absente : rien à durcir.';
  elsif position('search_path' in v_def) > 0 then
    raise notice 'is_workspace_member a déjà un search_path : inchangée.';
  else
    -- `alter function ... set search_path` ne touche QUE l'attribut :
    -- le corps, les droits et les dépendances des 57 politiques restent
    -- intacts. Réécrire la fonction aurait été plus risqué pour rien.
    execute 'alter function public.is_workspace_member(uuid) set search_path = public, pg_temp';
    raise notice 'is_workspace_member : search_path figé.';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3. DEUX VUES QUI ONT RÉCUPÉRÉ LES DROITS PAR DÉFAUT
-- ------------------------------------------------------------
-- `equipment_due_dates` et `equipment_overview` portent, pour `anon` ET
-- `authenticated`, l'intégralité du jeu par défaut de Supabase :
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.
--
-- MESURÉ : elles ne fuient RIEN aujourd'hui — un `anon` qui les
-- interroge obtient zéro ligne, parce que la RLS des tables sous-jacentes
-- s'applique. Ce n'est donc pas une fuite ouverte, c'est une CHARGE
-- AMORCÉE : le jour où l'une des deux sera recréée sans
-- `security_invoker`, elle s'exécutera avec les droits de son
-- propriétaire et exposera le parc de toutes les entreprises d'un coup.
-- La migration 0057 avait fait ce ménage sur d'autres vues ; ces deux-là
-- y ont échappé.
--
-- On ne garde que la LECTURE, et pour les comptes connectés seulement.
revoke all on public.equipment_due_dates from anon, authenticated;
revoke all on public.equipment_overview  from anon, authenticated;
grant select on public.equipment_due_dates to authenticated;
grant select on public.equipment_overview  to authenticated;

comment on function public.increment_usage_counter(uuid, uuid, text, text, integer) is
  'Compte un usage sous plafond. Depuis 0085 : seul service_role peut compter pour autrui ; tout autre appelant est borné à auth.uid(), et anon ne peut plus appeler du tout.';
