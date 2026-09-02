-- Oasis Care — Phase 11, Milestone 12 : §11T ANALYTICS, §11U OASIS PRO
-- AI, et §AUDIT LOG.
--
-- À exécuter après 0057. Idempotente et purement additive.
--
-- POURQUOI LES OUTILS DE L'IA SONT DES FONCTIONS POSTGRES.
--
-- §11U demande un registre d'outils structurés. Ils pourraient vivre
-- dans l'Edge Function, avec le modèle. Ils vivent ici, pour deux
-- raisons qui pèsent plus que la commodité :
--
--   1. RLS. Chaque fonction est en `security invoker` : elle s'exécute
--      avec les droits de celui qui pose la question. Un outil ne peut
--      donc pas voir plus que la personne qui l'appelle, et ça n'est
--      pas une promesse du code de l'assistant — c'est la même barrière
--      que pour le reste de l'application. Écrits dans l'Edge Function
--      avec la clé de service, ils auraient contourné tout ça.
--
--   2. Les Edge Functions ne passent par aucune CI de ce projet et ne
--      sont jamais exécutées ici. Mettre la logique métier là où elle
--      peut être testée — et elle l'est, dans
--      `supabase/tests/analytics_ai_tools.sql` — plutôt que là où elle
--      ne peut pas, c'est le choix par défaut.
--
-- L'Edge Function devient un aiguilleur : elle reçoit un nom d'outil,
-- appelle la fonction correspondante avec le JWT de l'utilisateur, et
-- rend le résultat au modèle.
--
-- CE QUE L'IA NE PEUT PAS FAIRE. §SÉCURITÉ IA autorise « read, analyze,
-- suggest, draft » et refuse « send quote, issue invoice, pay,
-- purchase, delete, transfer money, sign » sans confirmation
-- explicite. La traduction la plus solide de cette phrase n'est pas une
-- boîte de dialogue : c'est une ABSENCE. Aucun outil de ce fichier
-- n'envoie, n'émet, ne paie, n'achète, ne supprime, ne vire ni ne
-- signe. On ne peut pas confirmer son chemin vers une capacité qui
-- n'existe pas.
--
-- Une seule fonction écrit : `ai_create_quote_draft`, et elle crée un
-- BROUILLON — statut `draft`, jamais envoyé — ce que §SÉCURITÉ IA
-- autorise nommément. Elle laisse une trace dans le journal d'audit.

-- ============================================================
-- 1. §AUDIT LOG
-- ============================================================
-- « who, organization, what, entity, oldValue, newValue, timestamp,
-- source. »
--
-- Table en AJOUT SEUL : aucune politique `update`, aucune politique
-- `delete`. Un journal qu'on peut réécrire ne prouve rien, et c'est
-- justement quand quelqu'un veut effacer une ligne qu'il faut qu'elle
-- reste.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- « who » — nullable : une action déclenchée par un traitement
  -- automatique n'a pas d'auteur humain, et inventer un utilisateur
  -- serait pire que de l'admettre.
  actor_user_id uuid references auth.users (id) on delete set null,

  -- « what » — le verbe, en camelCase comme les autres énumérations du
  -- projet : `quoteIssued`, `invoiceIssued`, `gardenDelivered`…
  action text not null,

  -- « entity »
  entity_type text not null,
  entity_id uuid,

  old_value jsonb,
  new_value jsonb,

  -- « source » — d'où vient le geste. `ai` compte autant que les
  -- autres : §SÉCURITÉ IA veut qu'on puisse relire ce que l'assistant
  -- a fait.
  source text not null default 'web' check (source in ('web', 'ios', 'ai', 'system')),

  occurred_at timestamptz not null default now()
);

create index if not exists audit_events_org_idx
  on public.audit_events (organization_id, occurred_at desc);
create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id, occurred_at desc);

alter table public.audit_events enable row level security;

-- Lecture : tout membre de l'organisation. Un journal réservé aux
-- administrateurs ne sert qu'à eux ; celui-ci sert à comprendre ce qui
-- s'est passé, et c'est utile à tout le monde.
drop policy if exists "Members read the audit log" on public.audit_events;
create policy "Members read the audit log" on public.audit_events
  for select using (public.is_organization_member(organization_id));

-- Écriture : PAR LA FONCTION UNIQUEMENT. Pas de politique `insert` —
-- une ligne écrite directement depuis le navigateur pourrait mentir sur
-- son auteur.
--
-- `record_audit_event` est en `security definer` et impose
-- `auth.uid()` comme auteur : c'est ce qui rend la signature
-- infalsifiable.
create or replace function public.record_audit_event(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_source text default 'web'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  -- Le contrôle que la RLS ferait si la table était écrite
  -- directement. Sans lui, `security definer` laisserait n'importe qui
  -- écrire dans le journal de n'importe quelle entreprise.
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Journal d''audit inaccessible pour cette organisation.';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id,
    old_value, new_value, source
  )
  values (
    p_organization_id,
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_old_value,
    p_new_value,
    coalesce(p_source, 'web')
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- ============================================================
-- 2. Le plafond de l'assistant
-- ============================================================
-- §SECURITY — « rate limiting IA ».
--
-- Le compteur de la Phase 12 (`increment_usage_counter`) compte par
-- ESPACE DE TRAVAIL PERSONNEL et par formule d'abonnement iOS. Il ne
-- convient pas ici : une entreprise de cinq salariés y compterait cinq
-- quotas gratuits séparés, et Oasis Care Pro n'a pas encore de
-- tarification.
--
-- Un compteur par ORGANISATION et par mois, donc. Le plafond est un
-- garde-fou de coût, pas une offre commerciale — il vivra dans la
-- fonction, et sera remplacé le jour où Pro aura ses formules.

create table if not exists public.ai_pro_usage (
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  period text not null,
  used int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, period)
);

alter table public.ai_pro_usage enable row level security;

drop policy if exists "Members read their AI usage" on public.ai_pro_usage;
create policy "Members read their AI usage" on public.ai_pro_usage
  for select using (public.is_organization_member(organization_id));

/**
 * Consomme une requête d'assistant, ou refuse.
 *
 * En une seule instruction : deux salariés qui posent une question à la
 * même seconde ne doivent pas lire le même compteur puis écrire tous
 * les deux « 1 ».
 */
create or replace function public.consume_pro_ai_quota(
  p_organization_id uuid,
  p_limit int default 500
)
returns table (allowed boolean, used int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Préfixé : sans quoi `period` désigne à la fois la variable et la
  -- colonne, et Postgres refuse d'arbitrer.
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  new_used int;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Organisation inaccessible.';
  end if;

  insert into public.ai_pro_usage (organization_id, period, used)
  values (p_organization_id, v_period, 1)
  on conflict (organization_id, period) do update
    set used = public.ai_pro_usage.used + 1, updated_at = now()
  returning public.ai_pro_usage.used into new_used;

  -- On rend `allowed = false` APRÈS avoir incrémenté : la requête
  -- refusée compte elle aussi, sinon un client qui insiste tape la
  -- base autant qu'il veut sans jamais dépasser.
  return query select new_used <= p_limit, new_used, greatest(p_limit - new_used, 0);
end;
$$;

-- ============================================================
-- 3. §11T ANALYTICS — les KPI du paysagiste
-- ============================================================
-- `ProAnalyticsService`, côté base.
--
-- En `security invoker` : les chiffres d'une organisation ne sortent
-- que pour ses membres, et c'est la RLS des tables sous-jacentes qui
-- le garantit — pas la clause `where` de cette fonction.
--
-- CHAQUE INDICATEUR PORTE SA DÉFINITION EN COMMENTAIRE. Un tableau de
-- bord dont on ignore comment le chiffre est calculé se lit de travers
-- pendant des mois : « ma marge est de 34 % » ne veut rien dire tant
-- qu'on ne sait pas sur quel périmètre ni sur quelle période.
--
-- Ce qui n'est pas calculable rend NULL, jamais zéro. Zéro est une
-- réponse ; « je ne sais pas » en est une autre, et les confondre fait
-- lire une conversion de 0 % là où aucun devis n'a été envoyé.
create or replace function public.pro_analytics_landscaper(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns table (
  revenue_cents bigint,
  quotes_sent int,
  quotes_accepted int,
  quote_conversion_percent numeric,
  backlog_cents bigint,
  project_margin_cents bigint,
  project_margin_percent numeric,
  projects_measured int,
  labor_planned_hours numeric,
  labor_actual_hours numeric,
  labor_efficiency_percent numeric,
  average_project_value_cents bigint,
  overdue_invoices_count int,
  overdue_invoices_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
with
-- CHIFFRE D'AFFAIRES : le HT des factures ÉMISES sur la période. Pas le
-- TTC — la TVA n'est pas un revenu, elle est collectée pour l'État. Pas
-- les brouillons non plus : une facture sans numéro n'est pas un
-- chiffre d'affaires.
revenue as (
  select coalesce(sum(t.total_excluding_vat_cents), 0)::bigint as cents
  from public.invoices i
  join public.invoice_totals t on t.invoice_id = i.id
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.issued_at is not null
    and i.status <> 'cancelled'
    and i.issued_on between p_from and p_to
),
-- CONVERSION : mesurée sur la COHORTE des devis envoyés pendant la
-- période, pas sur les acceptations tombées pendant la période. La
-- seconde mesure fait grimper le taux le mois où l'on n'envoie rien.
sent_cohort as (
  select q.id, q.status
  from public.quotes q
  where q.organization_id = p_organization_id
    and q.archived_at is null
    and q.sent_at is not null
    and (q.sent_at at time zone 'Europe/Paris')::date between p_from and p_to
),
conversion as (
  select
    count(*)::int as sent,
    count(*) filter (where status = 'accepted')::int as accepted,
    case when count(*) = 0 then null
         else round(100.0 * count(*) filter (where status = 'accepted') / count(*), 1)
    end as percent
  from sent_cohort
),
-- CARNET DE COMMANDES : le vendu qui n'est pas encore facturé. Hors
-- période — c'est une photo d'aujourd'hui, pas un cumul du mois.
backlog as (
  select coalesce(sum(t.total_excluding_vat_cents), 0)::bigint as cents
  from public.quotes q
  join public.quote_totals t on t.quote_id = q.id
  where q.organization_id = p_organization_id
    and q.archived_at is null
    and q.status = 'accepted'
    and not exists (
      select 1 from public.invoices i
      where i.quote_id = q.id and i.archived_at is null and i.status <> 'cancelled'
    )
),
-- MARGE CHANTIER : sur les chantiers TERMINÉS dans la période. Un
-- chantier en cours n'a pas de marge, il a une marge prévue — et les
-- mélanger fait paraître rentable un chantier dont les coûts ne sont
-- pas tous saisis.
finished as (
  select p.id, p.quote_id
  from public.projects p
  where p.organization_id = p_organization_id
    and p.archived_at is null
    and p.status in ('completed', 'handedOver')
    and p.actual_end_on between p_from and p_to
),
finished_money as (
  select
    f.id,
    coalesce(qt.total_excluding_vat_cents, 0)::bigint as sale_cents,
    -- Les coûts saisis, PLUS la main-d'œuvre pointée et validée. Un
    -- pointage non validé n'entre dans aucun budget — c'est la règle
    -- du Milestone 7, et elle vaut ici aussi.
    (coalesce((select sum(c.total_cents) from public.project_costs c where c.project_id = f.id), 0)
     + coalesce((select l.validated_cents from public.project_labor_from_time l where l.project_id = f.id), 0)
    )::bigint as cost_cents
  from finished f
  left join public.quote_totals qt on qt.quote_id = f.quote_id
),
margin as (
  select
    count(*)::int as projects,
    coalesce(sum(sale_cents - cost_cents), 0)::bigint as cents,
    -- TAUX DE MARQUE : la marge rapportée au PRIX DE VENTE, convention
    -- du bâtiment et du paysage en France. Le taux de marge, lui, se
    -- rapporte au coût d'achat et donne un chiffre plus flatteur sur
    -- la même affaire.
    case when coalesce(sum(sale_cents), 0) = 0 then null
         else round(100.0 * sum(sale_cents - cost_cents) / sum(sale_cents), 1)
    end as percent
  from finished_money
),
-- EFFICACITÉ MAIN-D'ŒUVRE : heures prévues rapportées aux heures
-- réellement pointées, sur ces mêmes chantiers terminés. Au-dessus de
-- 100 %, on a mis moins de temps que prévu.
labor as (
  select
    coalesce(sum(planned), 0)::numeric as planned_hours,
    coalesce(sum(actual), 0)::numeric as actual_hours,
    case when coalesce(sum(actual), 0) = 0 then null
         else round(100.0 * sum(planned) / sum(actual), 1)
    end as efficiency
  from (
    select
      coalesce((select sum(r.planned_quantity) from public.project_resources r
                 where r.project_id = f.id and r.kind = 'labor'), 0) as planned,
      coalesce((select l.validated_hours from public.project_labor_from_time l
                 where l.project_id = f.id), 0) as actual
    from finished f
  ) per_project
),
-- PANIER MOYEN : sur les chantiers DÉMARRÉS dans la période, à leur
-- prix de vente. Les chantiers sans devis sont exclus plutôt que
-- comptés à zéro, ce qui écraserait la moyenne.
average_value as (
  select round(avg(qt.total_excluding_vat_cents))::bigint as cents
  from public.projects p
  join public.quote_totals qt on qt.quote_id = p.quote_id
  where p.organization_id = p_organization_id
    and p.archived_at is null
    and p.actual_start_on between p_from and p_to
),
-- IMPAYÉS : photo d'aujourd'hui, indépendante de la période. Une
-- facture en retard le reste tant qu'elle n'est pas réglée, quel que
-- soit le mois qu'on regarde.
overdue as (
  select
    count(*)::int as nb,
    coalesce(sum(b.outstanding_cents), 0)::bigint as cents
  from public.invoices i
  join public.invoice_balance b on b.invoice_id = i.id
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.issued_at is not null
    and i.status <> 'cancelled'
    and i.due_on is not null
    and i.due_on < current_date
    and b.outstanding_cents > 0
)
select
  revenue.cents,
  conversion.sent,
  conversion.accepted,
  conversion.percent,
  backlog.cents,
  margin.cents,
  margin.percent,
  margin.projects,
  labor.planned_hours,
  labor.actual_hours,
  labor.efficiency,
  average_value.cents,
  overdue.nb,
  overdue.cents
from revenue, conversion, backlog, margin, labor, average_value, overdue;
$$;

-- ============================================================
-- 4. §11T ANALYTICS — les KPI de la pépinière
-- ============================================================
-- VALORISATION : au prix de VENTE de la grille par défaut, faute d'un
-- prix d'achat par lot — `nursery_lots` n'en porte pas. C'est donc une
-- valeur commerciale, pas une valeur de bilan, et les écrans doivent le
-- dire.
--
-- La couverture sort avec le chiffre (`valued_lots` / `unpriced_lots`).
-- Une valorisation où la moitié des espèces n'a pas de tarif se lit
-- comme un stock qui a fondu ; le rapport des deux nombres empêche
-- cette lecture.
create or replace function public.pro_analytics_nursery(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns table (
  stock_value_cents bigint,
  valued_lots int,
  unpriced_lots int,
  available_stock int,
  production_value_cents bigint,
  loss_rate_percent numeric,
  turnover_percent numeric,
  dormant_lots int,
  dormant_quantity int,
  space_utilization_percent numeric,
  production_yield_percent numeric
)
language sql
stable
security invoker
set search_path = public
as $$
with
-- Le tarif du jour dans la grille par défaut, par article de
-- catalogue. `valid_until is null` = toujours en cours.
current_price as (
  select pbi.catalog_item_id, max(pbi.sale_price_cents) as sale_price_cents
  from public.price_book_items pbi
  join public.price_books pb on pb.id = pbi.price_book_id
  where pb.organization_id = p_organization_id
    and pb.is_default
    and pb.archived_at is null
    and pbi.valid_from <= current_date
    and (pbi.valid_until is null or pbi.valid_until >= current_date)
  group by pbi.catalog_item_id
),
-- Le lot rejoint son article par l'ESPÈCE, seul lien disponible :
-- `nursery_lots` ne porte pas de `catalog_item_id`.
lot_price as (
  select
    l.id,
    l.current_quantity,
    l.reserved_quantity,
    l.initial_quantity,
    l.status,
    l.location_id,
    coalesce(s.is_saleable, false) as saleable,
    (select max(cp.sale_price_cents)
       from public.catalog_items ci
       join current_price cp on cp.catalog_item_id = ci.id
      where ci.organization_id = p_organization_id
        and ci.archived_at is null
        and ci.item_type = 'plant'
        and ci.species_profile_id is not distinct from l.species_profile_id
        and l.species_profile_id is not null
    ) as unit_price_cents
  from public.nursery_lots l
  left join public.nursery_stages s on s.id = l.stage_id
  where l.organization_id = p_organization_id
    and l.archived_at is null
    and l.current_quantity > 0
    and l.status not in ('lost', 'sold', 'completed')
),
valuation as (
  select
    coalesce(sum(current_quantity * unit_price_cents) filter (where unit_price_cents is not null), 0)::bigint as stock_cents,
    count(*) filter (where unit_price_cents is not null)::int as valued,
    count(*) filter (where unit_price_cents is null)::int as unpriced,
    coalesce(sum(greatest(current_quantity - reserved_quantity, 0)) filter (where saleable and status = 'available'), 0)::int as available,
    coalesce(sum(current_quantity * unit_price_cents) filter (where unit_price_cents is not null and not saleable), 0)::bigint as production_cents,
    coalesce(sum(current_quantity), 0)::bigint as physical
  from lot_price
),
movements as (
  select
    coalesce(sum(quantity) filter (where kind = 'loss'), 0)::bigint as lost,
    coalesce(sum(quantity) filter (where kind = 'sell'), 0)::bigint as sold
  from public.nursery_stock_movements m
  where m.organization_id = p_organization_id
    and (m.occurred_at at time zone 'Europe/Paris')::date between p_from and p_to
),
-- TAUX DE PERTE : les pertes rapportées à ce qui a pu être perdu —
-- pertes + ventes + ce qui reste debout. Faute d'inventaire daté, on ne
-- peut pas reconstituer le stock d'ouverture ; ce dénominateur-là est
-- calculable et se dit en une phrase.
rates as (
  select
    case when (movements.lost + movements.sold + valuation.physical) = 0 then null
         else round(100.0 * movements.lost / (movements.lost + movements.sold + valuation.physical), 1)
    end as loss_rate,
    -- ROTATION : ce qui est sorti en vente sur la période, rapporté au
    -- stock encore présent.
    case when valuation.physical = 0 then null
         else round(100.0 * movements.sold / valuation.physical, 1)
    end as turnover
  from movements, valuation
),
-- DORMANT : en stock, et sans le moindre mouvement depuis six mois. Ce
-- sont les lots qu'on redécouvre en faisant l'inventaire.
dormant as (
  select
    count(*)::int as lots,
    coalesce(sum(l.current_quantity), 0)::int as quantity
  from public.nursery_lots l
  where l.organization_id = p_organization_id
    and l.archived_at is null
    and l.current_quantity > 0
    and l.status not in ('lost', 'sold', 'completed')
    and not exists (
      select 1 from public.nursery_stock_movements m
      where m.lot_id = l.id and m.occurred_at > now() - interval '180 days'
    )
),
space as (
  select
    case when coalesce(sum(o.capacity), 0) = 0 then null
         else round(100.0 * sum(o.occupied) / sum(o.capacity), 1)
    end as utilization
  from public.nursery_location_occupation o
  where o.organization_id = p_organization_id
    and o.capacity is not null
    and o.capacity > 0
),
-- RENDEMENT DE PRODUCTION : ce qui reste d'un lot rapporté à ce qui y
-- est entré, sur les lots ARRIVÉS à un stade vendable. Les lots encore
-- en production sont exclus : leur rendement n'est pas encore joué.
--
-- Limite assumée : un lot déjà vendu ne compte pas, faute de quantité
-- vendue mémorisée par lot. Le rendement porte donc sur ce qui est
-- arrivé au bout et encore là.
yield as (
  select
    case when coalesce(sum(l.initial_quantity), 0) = 0 then null
         else round(100.0 * sum(l.current_quantity) / sum(l.initial_quantity), 1)
    end as percent
  from public.nursery_lots l
  join public.nursery_stages s on s.id = l.stage_id
  where l.organization_id = p_organization_id
    and l.archived_at is null
    and s.is_saleable
    and l.initial_quantity > 0
)
select
  valuation.stock_cents,
  valuation.valued,
  valuation.unpriced,
  valuation.available,
  valuation.production_cents,
  rates.loss_rate,
  rates.turnover,
  dormant.lots,
  dormant.quantity,
  space.utilization,
  yield.percent
from valuation, rates, dormant, space, yield;
$$;

-- ============================================================
-- 5. §11U TOOL REGISTRY
-- ============================================================
-- Onze outils, onze fonctions, toutes en `security invoker`.

-- ------------------------------------------------------------
-- getClientContext
-- ------------------------------------------------------------
create or replace function public.ai_get_client_context(p_customer_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'client', jsonb_build_object(
      'nom', c.display_name,
      'type', c.kind,
      'etape', c.lifecycle_stage,
      'ville', c.billing_city,
      'email', c.email,
      'telephone', c.phone,
      'clientDepuis', c.converted_at
    ),
    'proprietes', coalesce((
      select jsonb_agg(jsonb_build_object('nom', s.name, 'type', s.site_type, 'ville', s.city, 'jardinId', s.garden_id))
      from public.crm_customer_sites s
      where s.customer_id = c.id and s.archived_at is null
    ), '[]'::jsonb),
    'devis', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', q.number, 'titre', q.title, 'statut', q.status,
        'montantHT', t.total_excluding_vat_cents, 'emisLe', q.issued_on)
        order by q.issued_on desc)
      from public.quotes q
      left join public.quote_totals t on t.quote_id = q.id
      where q.customer_id = c.id and q.archived_at is null
    ), '[]'::jsonb),
    'chantiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', p.number, 'nom', p.name, 'statut', p.status,
        'debutReel', p.actual_start_on, 'finReelle', p.actual_end_on))
      from public.projects p
      where p.customer_id = c.id and p.archived_at is null
    ), '[]'::jsonb),
    'facturesImpayees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', i.number, 'echeance', i.due_on, 'resteADevoir', b.outstanding_cents))
      from public.invoices i
      join public.invoice_balance b on b.invoice_id = i.id
      where i.customer_id = c.id and i.archived_at is null
        and i.issued_at is not null and b.outstanding_cents > 0
    ), '[]'::jsonb),
    'dernieresActivites', coalesce((
      select jsonb_agg(jsonb_build_object('type', a.activity_type, 'objet', a.subject, 'le', a.occurred_at)
                       order by a.occurred_at desc)
      from (
        select * from public.crm_activities
        where customer_id = c.id and archived_at is null
        order by occurred_at desc limit 10
      ) a
    ), '[]'::jsonb)
  )
  from public.crm_customers c
  where c.id = p_customer_id;
$$;

-- ------------------------------------------------------------
-- getProjectContext
-- ------------------------------------------------------------
create or replace function public.ai_get_project_context(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'chantier', jsonb_build_object(
      'numero', p.number, 'nom', p.name, 'statut', p.status,
      'debutPrevu', p.planned_start_on, 'finPrevue', p.planned_end_on,
      'debutReel', p.actual_start_on, 'finReelle', p.actual_end_on,
      'client', (select display_name from public.crm_customers where id = p.customer_id)
    ),
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titre', ph.title, 'statut', ph.status, 'avancement', ph.progress_percent)
        order by ph.position)
      from public.project_phases ph where ph.project_id = p.id
    ), '[]'::jsonb),
    'budget', jsonb_build_object(
      'venduHT', (select total_excluding_vat_cents from public.quote_totals where quote_id = p.quote_id),
      'coutsSaisis', coalesce((select sum(total_cents) from public.project_costs where project_id = p.id), 0),
      'mainOeuvreValidee', coalesce((select validated_cents from public.project_labor_from_time where project_id = p.id), 0),
      'heuresValidees', coalesce((select validated_hours from public.project_labor_from_time where project_id = p.id), 0),
      'heuresNonValidees', coalesce((select pending_hours from public.project_labor_from_time where project_id = p.id), 0)
    ),
    'interventions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titre', fi.title, 'statut', fi.status, 'debut', fi.scheduled_start))
      from public.field_interventions fi where fi.project_id = p.id
    ), '[]'::jsonb)
  )
  from public.projects p
  where p.id = p_project_id;
$$;

-- ------------------------------------------------------------
-- Géométrie du plan, côté base
-- ------------------------------------------------------------
-- Les surfaces et les longueurs ne sont PAS stockées : `garden_areas`
-- et `irrigation_pipes` ne portent qu'une liste de points, et c'est le
-- navigateur qui mesure (`lib/twin/geometry.ts`).
--
-- L'assistant ne peut pas appeler du TypeScript. Ces deux fonctions
-- portent donc la même formule une seconde fois — ce qui est exactement
-- le genre de duplication qui finit par diverger. D'où le test
-- `analytics_ai_tools.sql`, qui les épingle sur les MÊMES exemples que
-- `lib/twin/quantities.test.ts` : un carré de 6 m fait 36 m² des deux
-- côtés, ou l'un des deux est faux.
--
-- Format des points : [{"xMeters":…,"yMeters":…}] — la forme produite
-- par le Codable de l'app iPhone, et donc intouchable.
create or replace function public.polygon_area_m2(p_points jsonb)
returns numeric
language sql
immutable
as $$
  -- Formule du lacet : Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ) / 2, en valeur absolue
  -- pour que le sens de tracé ne change pas le signe.
  select case
    when p_points is null or jsonb_array_length(p_points) < 3 then 0
    else abs(sum(
      (a ->> 'xMeters')::numeric * (b ->> 'yMeters')::numeric
      - (b ->> 'xMeters')::numeric * (a ->> 'yMeters')::numeric
    )) / 2
  end
  from (
    select
      p_points -> i as a,
      p_points -> ((i + 1) % jsonb_array_length(p_points)) as b
    from generate_series(0, greatest(jsonb_array_length(p_points) - 1, 0)) as i
  ) paires;
$$;

create or replace function public.polyline_length_m(p_points jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when p_points is null or jsonb_array_length(p_points) < 2 then 0
    else coalesce(sum(sqrt(
      power((b ->> 'xMeters')::numeric - (a ->> 'xMeters')::numeric, 2)
      + power((b ->> 'yMeters')::numeric - (a ->> 'yMeters')::numeric, 2)
    )), 0)
  end
  from (
    select p_points -> i as a, p_points -> (i + 1) as b
    from generate_series(0, greatest(jsonb_array_length(p_points) - 2, 0)) as i
    where jsonb_array_length(p_points) >= 2
  ) segments;
$$;

-- ------------------------------------------------------------
-- getDigitalTwinQuantities
-- ------------------------------------------------------------
-- Les quantités du plan : ce qui alimente déjà « Devis depuis le plan »
-- au Milestone 5. L'assistant lit la MÊME chose que le bouton, sans
-- quoi les deux chemins donneraient deux devis différents.
create or replace function public.ai_get_digital_twin_quantities(p_garden_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'jardin', (select name from public.gardens where id = p_garden_id),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nom', a.name, 'type', a.area_type,
        'surfaceM2', round(public.polygon_area_m2(a.points), 2)))
      from public.garden_areas a
      where a.garden_id = p_garden_id and a.deleted_at is null
    ), '[]'::jsonb),
    'vegetaux', coalesce((
      select jsonb_agg(jsonb_build_object('libelle', libelle, 'nombre', nb))
      from (
        select coalesce(o.label, o.object_type) as libelle, count(*) as nb
        from public.garden_map_objects o
        where o.garden_id = p_garden_id and o.deleted_at is null
          and o.object_type in ('tree', 'shrub', 'plant', 'palm', 'hedge')
        group by 1 order by 2 desc
      ) v
    ), '[]'::jsonb),
    'equipements', coalesce((
      select jsonb_agg(jsonb_build_object('type', object_type, 'nombre', nb))
      from (
        select o.object_type, count(*) as nb
        from public.garden_map_objects o
        where o.garden_id = p_garden_id and o.deleted_at is null
          and o.object_type not in ('tree', 'shrub', 'plant', 'palm', 'hedge')
        group by 1 order by 2 desc
      ) e
    ), '[]'::jsonb),
    'irrigationMetres', coalesce((
      select round(sum(public.polyline_length_m(p.points)), 2)
        from public.irrigation_pipes p
       where p.garden_id = p_garden_id and p.deleted_at is null
    ), 0),
    'cablesMetres', coalesce((
      select round(sum(public.polyline_length_m(c.points)), 2)
        from public.garden_cables c
       where c.garden_id = p_garden_id and c.deleted_at is null
    ), 0)
  );
$$;

-- ------------------------------------------------------------
-- analyzeProjectMargin
-- ------------------------------------------------------------
-- « Quels chantiers ont dépassé leur budget ? » — §EXEMPLES.
create or replace function public.ai_analyze_project_margin(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by (x.depassement_cents) desc), '[]'::jsonb)
  from (
    select
      p.number as numero,
      p.name as nom,
      p.status as statut,
      coalesce(qt.total_excluding_vat_cents, 0) as vendu_ht_cents,
      (coalesce((select sum(c.total_cents) from public.project_costs c where c.project_id = p.id), 0)
       + coalesce((select l.validated_cents from public.project_labor_from_time l where l.project_id = p.id), 0)
      ) as cout_reel_cents,
      (coalesce((select sum(r.planned_total_cents) from public.project_resources r where r.project_id = p.id), 0)
      ) as cout_prevu_cents,
      (coalesce((select sum(c.total_cents) from public.project_costs c where c.project_id = p.id), 0)
       + coalesce((select l.validated_cents from public.project_labor_from_time l where l.project_id = p.id), 0)
       - coalesce((select sum(r.planned_total_cents) from public.project_resources r where r.project_id = p.id), 0)
      ) as depassement_cents
    from public.projects p
    left join public.quote_totals qt on qt.quote_id = p.quote_id
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status <> 'cancelled'
  ) x;
$$;

-- ------------------------------------------------------------
-- summarizeProject
-- ------------------------------------------------------------
-- Volontairement DIFFÉRENT de getProjectContext : celui-ci rend des
-- phrases courtes, prêtes à être reprises telles quelles. Le modèle
-- résume moins bien un tableau de chiffres qu'une liste de faits déjà
-- formulés, et il invente moins.
create or replace function public.ai_summarize_project(p_project_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  p record;
  faits text[] := array[]::text[];
  avancement numeric;
  vendu bigint;
  cout bigint;
begin
  select * into p from public.projects where id = p_project_id;
  if p is null then
    return jsonb_build_object('erreur', 'Chantier introuvable ou inaccessible.');
  end if;

  select round(avg(progress_percent)) into avancement
  from public.project_phases where project_id = p.id;

  select total_excluding_vat_cents into vendu from public.quote_totals where quote_id = p.quote_id;
  select coalesce((select sum(total_cents) from public.project_costs where project_id = p.id), 0)
       + coalesce((select validated_cents from public.project_labor_from_time where project_id = p.id), 0)
    into cout;

  faits := array_append(faits, format('Chantier %s « %s », statut %s.', p.number, p.name, p.status));
  if avancement is not null then
    faits := array_append(faits, format('Avancement moyen des phases : %s %%.', avancement));
  else
    faits := array_append(faits, 'Aucune phase définie : l''avancement n''est pas mesurable.');
  end if;

  if p.actual_start_on is not null then
    faits := array_append(faits, format('Démarré le %s.', to_char(p.actual_start_on, 'DD/MM/YYYY')));
  elsif p.planned_start_on is not null then
    faits := array_append(faits, format('Pas encore démarré, début prévu le %s.', to_char(p.planned_start_on, 'DD/MM/YYYY')));
  end if;

  if p.planned_end_on is not null and p.actual_end_on is null and p.planned_end_on < current_date then
    faits := array_append(faits, format('EN RETARD : la fin était prévue le %s.', to_char(p.planned_end_on, 'DD/MM/YYYY')));
  end if;

  if vendu is not null then
    faits := array_append(faits, format('Vendu %s € HT, coûts engagés %s €.',
                             round(vendu / 100.0, 2), round(cout / 100.0, 2)));
    if cout > vendu then
      faits := array_append(faits, 'Les coûts dépassent le prix de vente.');
    end if;
  else
    faits := array_append(faits, 'Aucun devis rattaché : la rentabilité n''est pas calculable.');
  end if;

  return jsonb_build_object('faits', to_jsonb(faits));
end;
$$;

-- ------------------------------------------------------------
-- findStock
-- ------------------------------------------------------------
create or replace function public.ai_find_stock(p_organization_id uuid, p_query text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.disponible desc), '[]'::jsonb)
  from (
    select
      s.species_name as espece,
      s.physical as physique,
      s.available as disponible,
      s.reserved as reserve,
      s.in_production as en_production,
      s.expected as attendu
    from public.nursery_stock s
    where s.organization_id = p_organization_id
      and (p_query is null or btrim(p_query) = '' or s.species_name ilike '%' || btrim(p_query) || '%')
    limit 100
  ) x;
$$;

-- ------------------------------------------------------------
-- forecastAvailability
-- ------------------------------------------------------------
-- Ce qui sera disponible, et QUAND. Deux sources : les lots encore en
-- production, et les commandes fournisseurs en attente de réception.
create or replace function public.ai_forecast_availability(p_organization_id uuid, p_query text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'enProduction', coalesce((
      select jsonb_agg(jsonb_build_object(
        'espece', l.species_name, 'lot', l.lot_code, 'quantite', l.current_quantity,
        'stade', st.label, 'vendable', st.is_saleable))
      from public.nursery_lots l
      left join public.nursery_stages st on st.id = l.stage_id
      where l.organization_id = p_organization_id
        and l.archived_at is null
        and l.current_quantity > 0
        and coalesce(st.is_saleable, false) = false
        and (p_query is null or btrim(p_query) = '' or l.species_name ilike '%' || btrim(p_query) || '%')
    ), '[]'::jsonb),
    'commandesAttendues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fournisseur', s.name, 'commande', po.number, 'attendueLe', po.expected_on,
        'designation', pol.description, 'restantARecevoir', pr.remaining))
      from public.purchase_order_lines pol
      join public.purchase_orders po on po.id = pol.purchase_order_id
      join public.purchase_order_progress pr on pr.line_id = pol.id
      left join public.suppliers s on s.id = po.supplier_id
      where po.organization_id = p_organization_id
        and po.archived_at is null
        and po.status not in ('draft', 'cancelled')
        and pr.remaining > 0
        and (p_query is null or btrim(p_query) = '' or pol.description ilike '%' || btrim(p_query) || '%'
             or pol.species_name ilike '%' || btrim(p_query) || '%')
    ), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------------
-- suggestPurchaseNeeds
-- ------------------------------------------------------------
-- « Quels végétaux dois-je commander pour les projets signés ? »
-- §EXEMPLES dit ce qu'Oasis compare : projects, quotes, nursery stock,
-- reservations, purchase orders. C'est exactement le calcul ci-dessous,
-- et il se fait EN BASE — le modèle ne fait pas d'arithmétique, il
-- commente un tableau déjà juste.
create or replace function public.ai_suggest_purchase_needs(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with besoin as (
    -- Ce que les chantiers signés vont consommer : les ressources
    -- prévues de type végétal, sur les chantiers pas encore terminés.
    select lower(btrim(r.description)) as cle, r.description as designation,
           sum(r.planned_quantity) as quantite
    from public.project_resources r
    join public.projects p on p.id = r.project_id
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('planned', 'inProgress', 'onHold')
      and r.kind = 'plant'
    group by 1, 2
  ),
  dispo as (
    select lower(btrim(s.species_name)) as cle, s.available, s.expected
    from public.nursery_stock s
    where s.organization_id = p_organization_id
  )
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.a_commander desc), '[]'::jsonb)
  from (
    select
      b.designation,
      b.quantite::int as besoin,
      coalesce(d.available, 0)::int as en_stock,
      coalesce(d.expected, 0)::int as deja_commande,
      greatest(b.quantite - coalesce(d.available, 0) - coalesce(d.expected, 0), 0)::int as a_commander
    from besoin b
    left join dispo d on d.cle = b.cle
  ) x
  where x.a_commander > 0;
$$;

-- ------------------------------------------------------------
-- getDailyPriorities  →  « Oasis Daily »
-- ------------------------------------------------------------
-- « Que dois-je faire aujourd'hui ? » — §EXEMPLES.
--
-- Rien n'est inventé ici : chaque ligne est un fait daté qui existe
-- déjà en base. C'est le modèle qui les met en phrases, pas lui qui les
-- trouve.
create or replace function public.ai_get_daily_priorities(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'date', current_date,
    'interventionsDuJour', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titre', fi.title, 'debut', fi.scheduled_start, 'statut', fi.status,
        'client', (select display_name from public.crm_customers where id = fi.customer_id))
        order by fi.scheduled_start)
      from public.field_interventions fi
      where fi.organization_id = p_organization_id
        and (fi.scheduled_start at time zone 'Europe/Paris')::date = current_date
    ), '[]'::jsonb),
    'devisARelancer', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', q.number, 'titre', q.title, 'envoyeLe', q.sent_at,
        'client', (select display_name from public.crm_customers where id = q.customer_id)))
      from public.quotes q
      where q.organization_id = p_organization_id
        and q.archived_at is null
        and q.status in ('sent', 'viewed')
        and q.sent_at < now() - interval '7 days'
    ), '[]'::jsonb),
    'devisQuiExpirent', coalesce((
      select jsonb_agg(jsonb_build_object('numero', q.number, 'valableJusquAu', q.valid_until))
      from public.quotes q
      where q.organization_id = p_organization_id
        and q.archived_at is null
        and q.status in ('sent', 'viewed')
        and q.valid_until between current_date and current_date + 7
    ), '[]'::jsonb),
    'facturesEnRetard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', i.number, 'echeance', i.due_on, 'resteADevoir', b.outstanding_cents,
        'client', (select display_name from public.crm_customers where id = i.customer_id)))
      from public.invoices i
      join public.invoice_balance b on b.invoice_id = i.id
      where i.organization_id = p_organization_id
        and i.archived_at is null and i.issued_at is not null
        and i.status <> 'cancelled'
        and i.due_on < current_date and b.outstanding_cents > 0
    ), '[]'::jsonb),
    'chantiersEnRetard', coalesce((
      select jsonb_agg(jsonb_build_object('numero', p.number, 'nom', p.name, 'finPrevue', p.planned_end_on))
      from public.projects p
      where p.organization_id = p_organization_id
        and p.archived_at is null
        and p.status in ('planned', 'inProgress', 'onHold')
        and p.planned_end_on < current_date
    ), '[]'::jsonb),
    'pointagesAValider', coalesce((
      select jsonb_build_object('nombre', count(*), 'heures', coalesce(sum(t.hours), 0))
      from public.time_entries t
      where t.organization_id = p_organization_id and not t.validated
    ), '{}'::jsonb),
    'receptionsAttendues', coalesce((
      select jsonb_agg(jsonb_build_object('commande', po.number, 'attendueLe', po.expected_on))
      from public.purchase_orders po
      where po.organization_id = p_organization_id
        and po.archived_at is null
        and po.status not in ('draft', 'cancelled', 'received')
        and po.expected_on <= current_date
    ), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------------
-- analyzeNurseryLosses
-- ------------------------------------------------------------
create or replace function public.ai_analyze_nursery_losses(
  p_organization_id uuid,
  p_from date default (current_date - 365),
  p_to date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'periode', jsonb_build_object('du', p_from, 'au', p_to),
    'parEspece', coalesce((
      select jsonb_agg(jsonb_build_object('espece', espece, 'perdus', perdus, 'motifs', motifs)
                       order by perdus desc)
      from (
        select l.species_name as espece,
               sum(m.quantity)::int as perdus,
               array_agg(distinct m.reason) filter (where m.reason is not null) as motifs
        from public.nursery_stock_movements m
        join public.nursery_lots l on l.id = m.lot_id
        where m.organization_id = p_organization_id
          and m.kind = 'loss'
          and (m.occurred_at at time zone 'Europe/Paris')::date between p_from and p_to
        group by 1
      ) e
    ), '[]'::jsonb),
    'inspectionsDefavorables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lot', l.lot_code, 'espece', l.species_name, 'resultat', i.result,
        'constat', i.findings, 'le', i.inspected_on))
      from public.nursery_inspections i
      join public.nursery_lots l on l.id = i.lot_id
      where i.organization_id = p_organization_id
        and i.inspected_on between p_from and p_to
        and i.result in ('poor', 'critical')
    ), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------------
-- createQuoteDraft — LA SEULE FONCTION QUI ÉCRIT
-- ------------------------------------------------------------
-- §SÉCURITÉ IA autorise « draft ». Le devis créé est en `draft` : sans
-- numéro remis au client, sans envoi, et modifiable — donc relu par un
-- humain avant d'exister pour qui que ce soit.
--
-- Elle écrit aussi dans le journal d'audit, avec `source = 'ai'`. Un
-- brouillon apparu tout seul dans la liste des devis doit pouvoir être
-- expliqué.
create or replace function public.ai_create_quote_draft(
  p_organization_id uuid,
  p_customer_id uuid,
  p_title text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  quote_id uuid;
  quote_number text;
  line jsonb;
  position_index int := 0;
  inserted int := 0;
begin
  if not public.has_permission(p_organization_id, 'quotes.create') then
    raise exception 'Vous n''avez pas le droit de créer un devis.';
  end if;

  -- Le client doit appartenir à cette organisation. La RLS le refuserait
  -- de toute façon à l'insertion, mais l'erreur serait obscure.
  if not exists (
    select 1 from public.crm_customers
    where id = p_customer_id and organization_id = p_organization_id
  ) then
    raise exception 'Client introuvable dans cette organisation.';
  end if;

  quote_number := public.next_quote_number(p_organization_id);

  insert into public.quotes (organization_id, customer_id, number, title, status, internal_notes)
  values (p_organization_id, p_customer_id, quote_number,
          coalesce(nullif(btrim(p_title), ''), 'Brouillon Oasis AI'),
          'draft',
          'Brouillon préparé par Oasis AI. À relire avant envoi.')
  returning id into quote_id;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.quote_lines (
      organization_id, quote_id, description, unit, quantity,
      unit_cost_cents, unit_sale_price_cents, vat_rate, position, cost_kind
    )
    values (
      p_organization_id, quote_id,
      coalesce(line ->> 'description', 'Ligne sans désignation'),
      coalesce(line ->> 'unit', 'u'),
      coalesce((line ->> 'quantity')::numeric, 1),
      coalesce((line ->> 'unit_cost_cents')::bigint, 0),
      coalesce((line ->> 'unit_sale_price_cents')::bigint, 0),
      coalesce((line ->> 'vat_rate')::numeric, 20),
      position_index,
      coalesce(line ->> 'cost_kind', 'other')
    );
    position_index := position_index + 1;
    inserted := inserted + 1;
  end loop;

  perform public.record_audit_event(
    p_organization_id, 'quoteDraftCreated', 'quote', quote_id,
    null,
    jsonb_build_object('number', quote_number, 'lines', inserted),
    'ai'
  );

  return jsonb_build_object(
    'devisId', quote_id,
    'numero', quote_number,
    'lignes', inserted,
    'statut', 'draft',
    'avertissement', 'Brouillon non envoyé. Relisez les prix avant de le transmettre.'
  );
end;
$$;

-- ============================================================
-- 6. Correctif : les heures « validées » ne l'étaient pas
-- ============================================================
-- Trouvé en écrivant le test des KPI : la marge d'un chantier tombait à
-- 37,5 % là où le calcul à la main donnait 50 %.
--
-- `project_labor_from_time` (migration 0051) additionne TOUS les
-- pointages sous deux colonnes qui s'appellent `validated_hours` et
-- `validated_cents`. Seule `pending_hours` filtrait.
--
-- Conséquence : le coût de main-d'œuvre d'un chantier comptait les
-- heures en attente de validation. C'est exactement ce que l'écran
-- promet de ne pas faire — « Un pointage non validé n'entre dans aucun
-- budget » — et la phrase était juste dans `project_cost_summary`,
-- qui filtre correctement, mais fausse ici.
--
-- Rien ne le signalait : deux vues, deux règles, et un écran qui montre
-- l'une en croyant montrer l'autre.
--
-- Les noms de colonnes ne bougent pas — ils étaient justes, c'est le
-- calcul qui ne l'était pas. On ajoute `pending_cents` : l'écran
-- annonce « dont X € en attente » et devait jusqu'ici le déduire.
create or replace view public.project_labor_from_time as
select
  project_id,
  sum(hours) filter (where validated)::numeric as validated_hours,
  coalesce(sum(total_cents) filter (where validated), 0)::bigint as validated_cents,
  coalesce(sum(hours) filter (where not validated), 0)::numeric as pending_hours,
  coalesce(sum(total_cents) filter (where not validated), 0)::bigint as pending_cents
from public.time_entries
where kind = 'work' and project_id is not null
group by project_id;

alter view public.project_labor_from_time set (security_invoker = true);
