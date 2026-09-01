-- Oasis Care — Phase 11 : correctif d'un indicateur.
--
-- À exécuter après 0058. Idempotente.
--
-- L'EFFICACITÉ MAIN-D'ŒUVRE MENTAIT QUAND RIEN N'AVAIT ÉTÉ PRÉVU.
--
-- Trouvé en exécutant `pro_analytics_landscaper` sur les vraies
-- données plutôt que sur le jeu de test : le tableau de bord affichait
-- « 0 % » là où aucun chantier ne portait d'heures prévues.
--
-- Techniquement juste — zéro heure prévue divisée par des heures
-- réelles fait bien zéro — et complètement trompeur : « 0 % » se lit
-- comme une équipe qui n'avance pas, quand la vérité est qu'il n'y a
-- rien à comparer. C'est exactement la distinction que le reste du
-- tableau de bord respecte déjà : un indicateur incalculable rend NULL,
-- et l'écran affiche un tiret.
--
-- Le jeu de test ne pouvait pas l'attraper : sa fixture prévoit dix
-- heures de main-d'œuvre, donc le dénominateur n'était jamais nul.
-- L'assertion ajoutée dans `analytics_ai_tools.sql` couvre ce cas.

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
    -- NULL DES DEUX CÔTÉS. Sans heures pointées, il n'y a rien à
    -- comparer — c'était déjà le cas. Mais sans heures PRÉVUES non
    -- plus : la formule rendait alors 0 %, ce qui se lit « équipe
    -- catastrophique » au lieu de « personne n'a estimé ce chantier ».
    -- Trouvé en passant la fonction sur des données réelles, où
    -- beaucoup de chantiers n'ont aucune ressource prévue.
    case when coalesce(sum(actual), 0) = 0 or coalesce(sum(planned), 0) = 0 then null
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
