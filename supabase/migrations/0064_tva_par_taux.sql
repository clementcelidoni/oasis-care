-- Oasis Care — CORRECTIF : la TVA était arrondie ligne par ligne.
--
-- À exécuter après 0063. Idempotente.
--
-- ============================================================
-- LA RÈGLE, ET OÙ ELLE N'ÉTAIT PAS SUIVIE
-- ============================================================
--
-- La TVA se calcule PAR TAUX, sur la base imposable de ce taux, puis
-- s'additionne. C'est ce que fait `quote_totals` depuis le Milestone 5,
-- ce que fait le portail client, et ce qu'imprime la ventilation en
-- pied de document.
--
-- Trois vues faisaient l'inverse : elles arrondissaient CHAQUE LIGNE
-- puis additionnaient les arrondis.
--
--     sum(round(l.total_cents * l.vat_rate / 100.0))
--
-- L'écart est petit par ligne et grandit avec leur nombre. Mesuré sur
-- la vraie base :
--
--     3 lignes à 3,33 € à 20 %  →  2,01 € par ligne, 2,00 € par taux
--     40 lignes à 1,67 € à 20 % → 13,20 € par ligne, 13,36 € par taux
--
-- Seize centimes sur une facture de quarante lignes. Ce n'est pas la
-- somme qui est grave, c'est qu'elle est INCOHÉRENTE AVEC ELLE-MÊME :
-- la facture imprimée affiche la ventilation par taux (13,36 €) juste
-- au-dessus d'un total calculé par ligne (13,20 €). Le document ne fait
-- pas son propre total.
--
-- Et `invoice_totals` alimente l'export vers l'expert-comptable : la
-- TVA déclarée ne correspondait ni au document remis au client, ni à ce
-- que le client voit dans son portail.

-- ============================================================
-- 1. Les factures
-- ============================================================
create or replace view public.invoice_totals as
with par_taux as (
  select l.invoice_id, l.vat_rate, sum(l.total_cents)::bigint as base_cents
  from public.invoice_lines l
  group by l.invoice_id, l.vat_rate
),
cumul as (
  select invoice_id,
         sum(base_cents)::bigint as ht,
         sum(round(base_cents * vat_rate / 100.0))::bigint as tva
  from par_taux
  group by invoice_id
)
select
  i.id as invoice_id,
  coalesce(c.ht, 0)::bigint as total_excluding_vat_cents,
  coalesce(c.tva, 0)::bigint as total_vat_cents,
  (coalesce(c.ht, 0) + coalesce(c.tva, 0))::bigint as total_including_vat_cents
from public.invoices i
-- `left join` : une facture sans ligne existe — c'est un brouillon — et
-- doit rendre zéro plutôt que disparaître de la vue.
left join cumul c on c.invoice_id = i.id;

alter view public.invoice_totals set (security_invoker = true);

-- ============================================================
-- 2. Les avoirs
-- ============================================================
-- `invoice_balance` calcule le crédit de la même façon, ligne par
-- ligne. Un avoir de plusieurs lignes déduisait donc un montant qui ne
-- correspondait pas à celui qu'il affiche.
create or replace view public.invoice_balance as
with credite as (
  select cn.invoice_id, cl.vat_rate,
         sum(cl.total_cents)::bigint as base_cents
  from public.credit_notes cn
  join public.credit_note_lines cl on cl.credit_note_id = cn.id
  where cn.issued_at is not null
  group by cn.invoice_id, cl.vat_rate
),
credite_total as (
  select invoice_id,
         (sum(base_cents) + sum(round(base_cents * vat_rate / 100.0)))::bigint as credited_cents
  from credite
  group by invoice_id
),
regle as (
  select invoice_id, coalesce(sum(amount_cents), 0)::bigint as paid_cents
  from public.payment_allocations group by invoice_id
)
select
  t.invoice_id,
  t.total_including_vat_cents,
  coalesce(p.paid_cents, 0) as paid_cents,
  coalesce(c.credited_cents, 0) as credited_cents,
  (t.total_including_vat_cents - coalesce(p.paid_cents, 0) - coalesce(c.credited_cents, 0))::bigint
    as outstanding_cents
from public.invoice_totals t
left join regle p on p.invoice_id = t.invoice_id
left join credite_total c on c.invoice_id = t.invoice_id;

alter view public.invoice_balance set (security_invoker = true);

-- ============================================================
-- 3. Les commandes
-- ============================================================
create or replace view public.purchase_order_totals as
with par_taux as (
  select l.purchase_order_id, l.vat_rate, sum(l.total_cents)::bigint as base_cents
  from public.purchase_order_lines l
  group by l.purchase_order_id, l.vat_rate
),
cumul as (
  select purchase_order_id,
         sum(base_cents)::bigint as ht,
         sum(round(base_cents * vat_rate / 100.0))::bigint as tva
  from par_taux group by purchase_order_id
)
select
  po.id as purchase_order_id,
  coalesce(c.ht, 0)::bigint as total_excluding_vat_cents,
  coalesce(c.tva, 0)::bigint as total_vat_cents
from public.purchase_orders po
left join cumul c on c.purchase_order_id = po.id;

alter view public.purchase_order_totals set (security_invoker = true);

create or replace view public.sales_order_totals as
with par_taux as (
  select l.sales_order_id, l.vat_rate, sum(l.total_cents)::bigint as base_cents
  from public.sales_order_lines l
  group by l.sales_order_id, l.vat_rate
),
cumul as (
  select sales_order_id,
         sum(base_cents)::bigint as ht,
         sum(round(base_cents * vat_rate / 100.0))::bigint as tva
  from par_taux group by sales_order_id
)
select
  so.id as sales_order_id,
  coalesce(c.ht, 0)::bigint as total_excluding_vat_cents,
  coalesce(c.tva, 0)::bigint as total_vat_cents
from public.sales_orders so
left join cumul c on c.sales_order_id = so.id;

alter view public.sales_order_totals set (security_invoker = true);

-- Ces vues sont recréées : le correctif 0057 leur avait retiré les
-- droits d'écriture, et `create or replace view` ne les rend pas — mais
-- une vue recréée hérite des droits PAR DÉFAUT du schéma, qui incluent
-- l'écriture pour `anon` et `authenticated`. On referme.
do $$
declare v text;
begin
  foreach v in array array[
    'invoice_totals', 'invoice_balance',
    'purchase_order_totals', 'sales_order_totals'
  ]
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from public', v);
    execute format('revoke insert, update, delete, truncate on public.%I from anon', v);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', v);
  end loop;
end $$;
