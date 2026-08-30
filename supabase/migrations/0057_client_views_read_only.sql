-- Oasis Care — Phase 11, correctif de sécurité sur le portail client.
--
-- À exécuter après 0056. Idempotente.
--
-- LA FAILLE, ET COMMENT ELLE EST NÉE.
--
-- Les vues `client_*` de la migration 0055 sont en `security definer`
-- (`security_invoker = false`) : c'est délibéré, et c'est ce qui permet
-- à un client — membre d'aucune organisation — de lire ses documents
-- sans qu'on lui ouvre `quotes` ou `invoices`.
--
-- Mais une vue en `security definer` N'A PAS DE RLS À ELLE. Elle
-- s'exécute avec les droits de son propriétaire, et sa clause `where`
-- est le seul filtre. Sur une LECTURE, c'est exactement l'effet
-- recherché. Sur une ÉCRITURE, c'est une porte ouverte.
--
-- Supabase accorde par défaut tous les droits sur les objets créés dans
-- `public` à `anon` et `authenticated` — la RLS est censée reprendre la
-- main derrière. Ici il n'y en a pas. Et `client_quotes`,
-- `client_invoices` et `client_projects` sont des vues à une seule
-- table : PostgreSQL les considère modifiables d'office.
--
-- Résultat vérifié sur la vraie base, en transaction annulée : un
-- visiteur ANONYME, sans le moindre jeton, a inséré une ligne dans
-- `quotes` en écrivant dans `client_quotes`. La ligne est bien arrivée
-- dans la table. Sans `with check option`, un `insert` par une vue
-- n'est même pas tenu de respecter sa clause `where` : n'importe quelle
-- organisation pouvait être visée.
--
-- Un client authentifié, lui, pouvait en plus modifier les lignes qu'il
-- voit — passer sa propre facture en « payée » — ou les supprimer.
--
-- LA CORRECTION : ces vues sont en LECTURE, et le disent. On retire
-- tout, on rend `select`, et rien d'autre. `anon` n'y a plus accès du
-- tout : le portail exige une session, et une vue dont le filtre repose
-- sur `auth.uid()` n'a rien à répondre à un anonyme.

do $$
declare v text;
begin
  foreach v in array array[
    'client_portal_companies',
    'client_quotes', 'client_quote_lines', 'client_quote_sections',
    'client_invoices', 'client_invoice_lines', 'client_invoice_balance',
    'client_projects', 'client_project_phases', 'client_project_photos'
  ]
  loop
    -- `public` d'abord : un droit accordé au pseudo-rôle `public` est
    -- hérité par tout le monde, et survivrait au retrait des deux
    -- autres.
    execute format('revoke all on public.%I from public', v);
    execute format('revoke all on public.%I from anon', v);
    execute format('revoke all on public.%I from authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ============================================================
-- Le même geste sur les vues de reporting
-- ============================================================
-- Celles-ci sont en `security_invoker = true` : une écriture s'y
-- exécuterait avec les droits de l'appelant, et la RLS des tables
-- dessous la refuserait. Elles ne sont donc pas vulnérables.
--
-- On leur retire quand même l'écriture. Ce sont des vues de calcul —
-- des totaux, des soldes, des stocks — que personne n'écrit et que
-- personne ne devrait pouvoir tenter d'écrire. Le jour où l'une d'elles
-- passera en `security definer` pour une bonne raison, elle sera déjà
-- fermée.
do $$
declare v text;
begin
  foreach v in array array[
    'cash_flow_entries', 'invoice_balance', 'invoice_totals',
    'nursery_location_occupation', 'nursery_stock',
    'project_cost_summary', 'project_labor_from_time',
    'purchase_order_progress', 'purchase_order_totals',
    'quote_totals', 'sales_order_totals'
  ]
  loop
    if to_regclass('public.' || quote_ident(v)) is not null then
      execute format('revoke insert, update, delete, truncate on public.%I from public', v);
      execute format('revoke insert, update, delete, truncate on public.%I from anon', v);
      execute format('revoke insert, update, delete, truncate on public.%I from authenticated', v);
    end if;
  end loop;
end $$;

-- ============================================================
-- Pour la prochaine vue
-- ============================================================
-- On ne touche PAS aux droits par défaut du schéma : `alter default
-- privileges … on tables` couvre aussi les vraies tables, et les
-- refermer casserait toutes les migrations qui comptent dessus, RLS à
-- l'appui.
--
-- La règle tient donc en une phrase, à relire avant d'écrire une vue :
-- UNE VUE EN `security definer` DOIT ÊTRE SUIVIE DE SON `revoke`. Le
-- test `supabase/tests/definer_views_read_only.sql` échoue si on
-- l'oublie.
comment on view public.client_quotes is
  'Vue en security definer : LECTURE SEULE. Toute écriture contournerait la RLS de `quotes`. Voir migration 0057.';
