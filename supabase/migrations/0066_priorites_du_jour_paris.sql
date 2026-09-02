-- Oasis Care — CORRECTIF : « aujourd'hui » se comptait à Greenwich.
--
-- À exécuter après 0065. Idempotente.
--
-- `ai_get_daily_priorities` convertissait les horaires d'intervention
-- en heure de Paris — `(scheduled_start at time zone 'Europe/Paris')`
-- — puis les comparait à `current_date`, qui suit le fuseau du serveur.
-- Supabase tourne en UTC.
--
-- Entre minuit et deux heures du matin (heure d'été), la journée
-- parisienne a commencé mais pas celle du serveur : le tableau
-- affichait le planning de la VEILLE. Une entreprise qui prépare ses
-- tournées à six heures ne le voit jamais ; celle qui referme son
-- écran à minuit et demi, si — et elle croit son planning vide.
--
-- Le même décalage touchait les devis qui expirent, les factures en
-- retard, les chantiers en retard et les réceptions attendues : sept
-- comparaisons, toutes sur le mauvais jour pendant deux heures par
-- nuit.
--
-- Un seul repère désormais, calculé une fois en tête de requête.

create or replace function public.ai_get_daily_priorities(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- « AUJOURD HUI » SE COMPTE À PARIS.
  --
  -- Les dates des interventions étaient converties en heure de Paris
  -- puis comparées à `current_date`, qui suit le fuseau du serveur —
  -- UTC chez Supabase. Entre minuit et deux heures du matin, la
  -- journée parisienne avait déjà commencé mais pas celle du serveur :
  -- le tableau affichait le planning de la veille. Une entreprise qui
  -- prépare ses tournées à six heures ne le voyait pas ; celle qui
  -- ferme sa caisse à minuit et demi, si.
  with reperes as (select (now() at time zone 'Europe/Paris')::date as today_paris)
  select jsonb_build_object(
    'date', today_paris,
    'interventionsDuJour', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titre', fi.title, 'debut', fi.scheduled_start, 'statut', fi.status,
        'client', (select display_name from public.crm_customers where id = fi.customer_id))
        order by fi.scheduled_start)
      from public.field_interventions fi
      where fi.organization_id = p_organization_id
        and (fi.scheduled_start at time zone 'Europe/Paris')::date = today_paris
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
        and q.valid_until between today_paris and today_paris + 7
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
        and i.due_on < today_paris and b.outstanding_cents > 0
    ), '[]'::jsonb),
    'chantiersEnRetard', coalesce((
      select jsonb_agg(jsonb_build_object('numero', p.number, 'nom', p.name, 'finPrevue', p.planned_end_on))
      from public.projects p
      where p.organization_id = p_organization_id
        and p.archived_at is null
        and p.status in ('planned', 'inProgress', 'onHold')
        and p.planned_end_on < today_paris
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
        and po.expected_on <= today_paris
    ), '[]'::jsonb)
  )
  from reperes;
$$;