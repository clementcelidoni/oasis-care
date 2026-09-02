-- Oasis Care — CORRECTIFS trouvés par la revue.
-- La remise globale d'une facture, la marge d'un chantier sans devis,
-- le chiffre d'affaires sans les avoirs, et un statut d'inspection qui
-- n'existe pas.
--
-- À exécuter après 0064. Idempotente.

-- ============================================================
-- 1. La facture ne retombait pas sur le montant accepté
-- ============================================================
-- `create_invoice_from_quote` répercutait la remise globale du devis
-- sur le PRIX UNITAIRE de chaque ligne :
--
--     round(line.unit_sale_price_cents * (1 - remise / 100))
--
-- Le commentaire disait « une facture n'a pas de remise globale, et la
-- perdre changerait le montant que le client a accepté ». L'intention
-- était juste ; l'exécution écrasait précisément ce qu'elle voulait
-- préserver.
--
-- Un prix unitaire est un PETIT nombre. L'arrondir avant de le
-- multiplier par la quantité fait dériver le total, et la dérive
-- explose quand l'unité est bon marché :
--
--     1 000 × 3, remise 10 %  →  attendu 2 700, obtenu 2 700   (juste)
--       333 × 3, remise 10 %  →  attendu   899, obtenu   900   (1 c.)
--         1 × 1 000, remise 33 % → attendu  670, obtenu 1 000   (33 %)
--
-- Le dernier cas n'est pas théorique : un godet à 1 centime commandé
-- par milliers est un article de pépinière ordinaire. `round(1 × 0,67)`
-- vaut 1 : la remise disparaît entièrement.
--
-- LA CORRECTION : la facture porte désormais sa propre remise globale,
-- comme le devis. Le prix unitaire reste celui qui a été accepté, et la
-- remise s'applique là où elle doit s'appliquer — sur la base imposable
-- de chaque taux, une seule fois, exactement comme dans `quote_totals`.

alter table public.invoices
  add column if not exists global_discount_percent numeric(5, 2) not null default 0
    check (global_discount_percent >= 0 and global_discount_percent <= 100);

comment on column public.invoices.global_discount_percent is
  'Remise commerciale reprise du devis. Appliquée par taux de TVA dans `invoice_totals`, jamais sur le prix unitaire (correctif 0065).';

create or replace function public.create_invoice_from_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  q record;
  existing uuid;
  new_invoice uuid;
  line record;
  n int := 0;
begin
  select * into q from public.quotes where id = p_quote_id;
  if q is null then
    raise exception 'Devis introuvable.';
  end if;

  select id into existing from public.invoices
   where quote_id = p_quote_id and archived_at is null and status <> 'cancelled' limit 1;
  if existing is not null then
    return existing;
  end if;

  insert into public.invoices (
    organization_id, customer_id, quote_id, project_id, introduction, terms,
    global_discount_percent, created_by
  ) values (
    q.organization_id, q.customer_id, p_quote_id,
    (select id from public.projects where quote_id = p_quote_id and archived_at is null limit 1),
    q.introduction, q.terms,
    -- La remise voyage TELLE QUELLE. C'est ce qui garantit que la
    -- facture retombe au centime sur le devis accepté.
    coalesce(q.global_discount_percent, 0),
    auth.uid()
  )
  returning id into new_invoice;

  for line in
    select * from public.quote_lines where quote_id = p_quote_id order by position
  loop
    insert into public.invoice_lines (
      organization_id, invoice_id, position, description, unit, quantity,
      -- Le prix unitaire est recopié SANS y toucher : c'est celui que
      -- le client a lu et accepté, et il doit se relire à l'identique
      -- sur la facture.
      unit_price_cents, vat_rate, discount_percent
    ) values (
      q.organization_id, new_invoice, n, line.description, line.unit, line.quantity,
      line.unit_sale_price_cents, line.vat_rate, line.discount_percent
    );
    n := n + 1;
  end loop;

  return new_invoice;
end;
$$;

-- La vue applique la remise comme `quote_totals` : par tranche de TVA,
-- au prorata, après les remises de ligne. C'est ce qui fait que les
-- deux documents rendent le même total.
create or replace view public.invoice_totals as
with par_taux as (
  select l.invoice_id, l.vat_rate, sum(l.total_cents)::bigint as brut_cents
  from public.invoice_lines l
  group by l.invoice_id, l.vat_rate
),
apres_remise as (
  select p.invoice_id, p.vat_rate,
         round(p.brut_cents * (1 - coalesce(i.global_discount_percent, 0) / 100.0))::bigint as base_cents
  from par_taux p
  join public.invoices i on i.id = p.invoice_id
),
cumul as (
  select invoice_id,
         sum(base_cents)::bigint as ht,
         sum(round(base_cents * vat_rate / 100.0))::bigint as tva
  from apres_remise
  group by invoice_id
)
select
  i.id as invoice_id,
  coalesce(c.ht, 0)::bigint as total_excluding_vat_cents,
  coalesce(c.tva, 0)::bigint as total_vat_cents,
  (coalesce(c.ht, 0) + coalesce(c.tva, 0))::bigint as total_including_vat_cents
from public.invoices i
left join cumul c on c.invoice_id = i.id;

alter view public.invoice_totals set (security_invoker = true);

do $$
declare v text;
begin
  foreach v in array array['invoice_totals']
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from public', v);
    execute format('revoke insert, update, delete, truncate on public.%I from anon', v);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', v);
  end loop;
end $$;

-- ============================================================
-- 2. Une inspection « problem » n'était jamais signalée
-- ============================================================
-- `pro_ai_nursery_context` cherchait `result in ('poor', 'critical')`.
-- La contrainte de `nursery_inspections` n'accepte que 'healthy',
-- 'watch', 'problem' et 'critical' : `'poor'` n'existe pas.
--
-- L'assistant rendait donc la moitié des inspections défavorables — les
-- critiques — et taisait toutes les autres. Une liste incomplète est
-- plus dangereuse qu'une liste vide : on la croit exhaustive.
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
        -- 'problem', pas 'poor'. La contrainte de la table n'accepte
        -- que 'healthy', 'watch', 'problem' et 'critical'.
        and i.result in ('problem', 'critical')
    ), '[]'::jsonb)
  );
$$;

-- ============================================================
-- 3. Le chiffre d’affaires ignorait les avoirs, et la marge
--    comptait un chantier sans devis comme « vendu 0 € »
-- ============================================================
-- Les deux dans la même fonction, recréée en entier : `create or
-- replace` sur une fonction qui rend une TABLE ne permet pas d’en
-- changer les colonnes autrement.
--
-- Le second défaut explique un chiffre observé sur des données réelles :
-- une marge chantier à −56 %. Le chantier n’était pas vendu à perte ; il
-- n’était simplement rattaché à aucun devis, et ses coûts se
-- rapportaient à un prix de vente de zéro.

drop function if exists public.pro_analytics_landscaper(uuid, date, date);

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
  -- Combien de chantiers terminés n'ont PAS pu entrer dans la marge,
  -- faute de devis. L'écran doit pouvoir le dire : une marge juste sur
  -- un périmètre inconnu n'est pas une marge juste.
  projects_without_quote int,
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
invoiced as (
  select coalesce(sum(t.total_excluding_vat_cents), 0)::bigint as cents
  from public.invoices i
  join public.invoice_totals t on t.invoice_id = i.id
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.issued_at is not null
    and i.status <> 'cancelled'
    and i.issued_on between p_from and p_to
),
-- LES AVOIRS SE DÉDUISENT. Sans eux, une facture de 10 000 € annulée
-- par un avoir de 10 000 € comptait encore 10 000 € de chiffre
-- d'affaires : le tableau de bord affichait une année que la
-- comptabilité n'a jamais vue. Seuls les avoirs ÉMIS comptent — un
-- brouillon d'avoir n'annule rien.
credited as (
  select coalesce(sum(cl.total_cents), 0)::bigint as cents
  from public.credit_notes cn
  join public.credit_note_lines cl on cl.credit_note_id = cn.id
  where cn.organization_id = p_organization_id
    and cn.issued_at is not null
    and cn.issued_on between p_from and p_to
),
revenue as (
  select (invoiced.cents - credited.cents)::bigint as cents
  from invoiced, credited
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
-- UN CHANTIER SANS DEVIS N'A PAS DE PRIX DE VENTE CONNU, et il ne vaut
-- pas zéro. `coalesce(…, 0)` le comptait « vendu 0 € » tout en gardant
-- ses coûts : chaque chantier de ce type tirait le taux de marque vers
-- le bas, et le chiffre affiché ne décrivait plus rien. C'est la même
-- règle que pour l'efficacité main-d'œuvre — un indicateur incalculable
-- rend NULL, il ne rend pas zéro.
--
-- Ces chantiers sont donc ÉCARTÉS du calcul, et comptés à part pour que
-- l'écran puisse dire combien il en a écartés. Les taire donnerait une
-- marge juste sur un périmètre qu'on ne connaît pas.
finished_money as (
  select
    f.id,
    qt.total_excluding_vat_cents::bigint as sale_cents,
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
    count(*) filter (where sale_cents is not null)::int as projects,
    count(*) filter (where sale_cents is null)::int as projects_without_quote,
    coalesce(sum(sale_cents - cost_cents) filter (where sale_cents is not null), 0)::bigint as cents,
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
  margin.projects_without_quote,
  labor.planned_hours,
  labor.actual_hours,
  labor.efficiency,
  average_value.cents,
  overdue.nb,
  overdue.cents
from revenue, conversion, backlog, margin, labor, average_value, overdue;
$$;

-- ============================================================
-- 4. Le portail client doit voir la remise, lui aussi
-- ============================================================
-- `client_invoices` n'exposait pas `global_discount_percent` : le
-- portail recalculait la ventilation depuis les lignes SANS la remise,
-- et affichait donc un détail qui ne faisait pas le total rendu par
-- `client_invoice_balance`. Le client aurait vu la contradiction avant
-- nous.
--
-- La liste de colonnes reste la frontière de sécurité (§11S) : on
-- ajoute UNE colonne, et c'est un pourcentage de remise commerciale —
-- exactement ce qui figure déjà en toutes lettres sur le document
-- qu'il a reçu.
create or replace view public.client_invoices
with (security_invoker = false) as
select
  i.id, i.organization_id, i.customer_id, i.number, i.status,
  i.issued_on, i.due_on, i.introduction, i.terms,
  i.global_discount_percent
  -- PAS `internal_notes`.
from public.invoices i
where i.customer_id in (select public.my_customer_ids())
  and i.archived_at is null
  and i.issued_at is not null;

-- Recréée, donc de nouveau soumise aux droits par défaut du schéma :
-- on referme, comme le correctif 0057 l'a fait pour les dix vues.
revoke all on public.client_invoices from public;
revoke all on public.client_invoices from anon;
revoke all on public.client_invoices from authenticated;
grant select on public.client_invoices to authenticated;
