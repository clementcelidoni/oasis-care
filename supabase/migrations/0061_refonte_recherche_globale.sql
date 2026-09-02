-- Oasis Care — Phase 11, AMÉLIORATION MAJEURE.
-- §20 à §31 — RECHERCHE GLOBALE.
--
-- À exécuter après 0060. Idempotente et purement additive.
--
-- §20 « FONCTION MAJEURE » et §51 « La GLOBAL SEARCH doit devenir l'un
-- des moyens principaux de navigation dans Oasis Care Pro. »
--
-- §21 : « La recherche doit rechercher dans TOUTES les données
-- autorisées du workspace. Pas uniquement les clients. »
--
-- §31 SECURITY SEARCH, et c'est la contrainte qui gouverne la forme du
-- fichier : « Organisation A ne voit JAMAIS Organisation B. Même en
-- recherchant un ID exact. »
--
-- D'où deux barrières superposées, et pas une :
--
--   1. la fonction est en `security invoker` — la RLS de chaque table
--      s'applique à l'appelant, exactement comme sur les écrans ;
--   2. chaque branche filtre EN PLUS sur `organization_id`, ou sur
--      l'espace de travail de l'organisation pour les tables du jardin.
--
-- La première suffirait. La seconde existe parce qu'une recherche
-- interroge vingt tables d'un coup : c'est l'endroit du produit où une
-- politique oubliée coûterait le plus cher, et le seul où l'on peut
-- s'en apercevoir en lisant une seule fonction.
--
-- §30 : « NE PAS appeler un LLM pour retrouver une facture. » Rien ici
-- n'est probabiliste — c'est de la recherche déterministe sur des
-- index. L'IA vit à côté, pas dedans.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ============================================================
-- 1. Normaliser
-- ============================================================
-- §24 FUZZY SEARCH — « accents ; casse ; fautes légères ; recherche
-- partielle ».
--
-- `unaccent(text)` est déclarée STABLE, pas IMMUTABLE : elle dépend
-- d'un dictionnaire qu'on pourrait recharger. On ne peut donc pas
-- indexer son résultat. La forme à deux arguments, qui nomme le
-- dictionnaire, EST immuable — c'est la parade documentée, et c'est ce
-- qui rend les index ci-dessous possibles.
create or replace function public.oasis_normalize(t text)
returns text
language sql
immutable
parallel safe
strict
set search_path = public
as $$
  select lower(public.unaccent('public.unaccent'::regdictionary, t));
$$;

/**
 * §24 IDENTIFIANTS et TÉLÉPHONE.
 *
 * « DEV-0042 » doit retrouver le devis DEV-2026-0042, et
 * « 06 12 34 56 78 » le contact enregistré « 06.12.34.56.78 ».
 *
 * Comparer les CHIFFRES SEULS résout les deux d'un coup : les séparateurs
 * disparaissent, et « 0042 » se retrouve bien dans « 20260042 ». Une
 * comparaison sur la chaîne entière échouerait sur l'année que
 * l'utilisateur n'a pas tapée.
 */
create or replace function public.oasis_digits(t text)
returns text
language sql
immutable
parallel safe
strict
as $$
  select regexp_replace(t, '[^0-9]', '', 'g');
$$;

-- ============================================================
-- 2. §31 INDEX SEARCH — « NE PAS lancer 25 requêtes différentes à
--    chaque frappe. Mettre en place une stratégie dédiée. »
-- ============================================================
-- Un index trigramme par colonne réellement cherchée. GIN plutôt que
-- GiST : la recherche est mille fois plus fréquente que l'écriture, et
-- GIN est le plus rapide en lecture.
--
-- Les index portent sur `oasis_normalize(colonne)` — la même expression
-- que la requête. Un index sur la colonne brute ne servirait à rien,
-- puisqu'on compare des formes sans accents ni majuscules.

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('crm_customers',      'display_name'),
      ('crm_customers',      'legal_name'),
      ('crm_customers',      'email'),
      ('crm_customers',      'billing_city'),
      ('crm_contacts',       'first_name'),
      ('crm_contacts',       'last_name'),
      ('crm_contacts',       'email'),
      ('crm_customer_sites', 'name'),
      ('crm_customer_sites', 'city'),
      ('projects',           'name'),
      ('projects',           'number'),
      ('field_interventions','title'),
      ('project_tasks',      'title'),
      ('quotes',             'title'),
      ('quotes',             'number'),
      ('quote_lines',        'description'),
      ('invoices',           'number'),
      ('gardens',            'name'),
      ('garden_areas',       'name'),
      ('garden_map_objects', 'label'),
      ('plants',             'custom_name'),
      ('plants',             'common_name'),
      ('plants',             'scientific_name'),
      ('nursery_lots',       'lot_code'),
      ('nursery_lots',       'species_name'),
      ('nursery_lots',       'cultivar'),
      ('nursery_locations',  'name'),
      ('nursery_locations',  'code'),
      ('suppliers',          'name'),
      ('purchase_orders',    'number'),
      ('sales_orders',       'number'),
      ('employees',          'first_name'),
      ('employees',          'last_name'),
      ('catalog_items',      'name'),
      ('catalog_items',      'reference')
    ) as t(tbl, col)
  loop
    -- `if not exists` sur l'index ET contrôle de la table : la
    -- migration doit rester rejouable, et une table absente ne doit pas
    -- faire échouer les trente autres.
    if to_regclass('public.' || quote_ident(spec.tbl)) is not null then
      execute format(
        'create index if not exists %I on public.%I using gin (public.oasis_normalize(%I) gin_trgm_ops)',
        'trgm_' || spec.tbl || '_' || spec.col, spec.tbl, spec.col
      );
    end if;
  end loop;
end $$;

-- ============================================================
-- 3. §31 ARCHITECTURE SEARCH — `SearchResult`
-- ============================================================
-- La spec donne la forme exacte du résultat : id, entityType, title,
-- subtitle, icon, url, organizationId, metadata, score. On la rend
-- telle quelle, colonne par colonne — le web n'a rien à recomposer.
--
-- §22 UX RECHERCHE regroupe les résultats par famille ; c'est
-- `entity_type` qui le permet, et `icon` porte le nom du symbole du jeu
-- d'icônes maison.

drop function if exists public.global_search(uuid, text, text[], integer);

create or replace function public.global_search(
  p_organization_id uuid,
  p_query text,
  p_types text[] default null,
  p_limit integer default 6
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  icon text,
  url text,
  score real
)
language plpgsql
stable
security invoker
set search_path = public
-- Le seuil par défaut de pg_trgm (0.3) rate « trachy » →
-- « Trachycarpus fortunei » : six lettres sur vingt-et-une font une
-- similarité faible. On le descend pour cette fonction seulement.
set pg_trgm.similarity_threshold = 0.2
as $$
declare
  q text := public.oasis_normalize(btrim(coalesce(p_query, '')));
  d text := public.oasis_digits(coalesce(p_query, ''));
  ws uuid;
begin
  -- Deux caractères au minimum. En dessous, aucun index trigramme ne
  -- peut aider et la requête balaierait vingt tables pour rendre tout
  -- ce qu'elle trouve — c'est-à-dire rien d'utile.
  if length(q) < 2 then
    return;
  end if;

  -- §31 — la barrière explicite, en plus de la RLS. Un appelant qui
  -- passerait l'identifiant d'une autre organisation n'obtiendrait
  -- déjà rien ; ici il n'obtient même pas l'espace de travail.
  if not public.is_organization_member(p_organization_id) then
    return;
  end if;

  select workspace_id into ws from public.business_organizations where id = p_organization_id;

  return query
  with hits as (
    -- ----- CRM -------------------------------------------------
    select 'client'::text as t, c.id, c.display_name as ti,
           nullif(concat_ws(' · ', c.billing_city, c.email), '') as su,
           'clients'::text as ic, '/crm/clients/' || c.id as u,
           greatest(
             similarity(public.oasis_normalize(c.display_name), q),
             case when public.oasis_normalize(c.display_name) like q || '%' then 0.95
                  when public.oasis_normalize(c.display_name) like '%' || q || '%' then 0.7
                  else 0 end,
             case when d <> '' and public.oasis_digits(coalesce(c.phone, '') || coalesce(c.mobile, '')) like '%' || d || '%' then 0.9 else 0 end
           )::real as sc
    from public.crm_customers c
    where c.organization_id = p_organization_id and c.archived_at is null
      and c.lifecycle_stage = 'customer'
      and (public.oasis_normalize(concat_ws(' ', c.display_name, c.legal_name, c.email, c.billing_city, c.siret, c.notes)) like '%' || q || '%'
           or public.oasis_normalize(c.display_name) % q
           or (d <> '' and public.oasis_digits(concat_ws(' ', c.phone, c.mobile, c.siret)) like '%' || d || '%'))

    union all
    select 'prospect', c.id, c.display_name,
           nullif(concat_ws(' · ', c.billing_city, c.email), ''),
           'prospects', '/crm/clients/' || c.id,
           greatest(
             similarity(public.oasis_normalize(c.display_name), q),
             case when public.oasis_normalize(c.display_name) like q || '%' then 0.95
                  when public.oasis_normalize(c.display_name) like '%' || q || '%' then 0.7
                  else 0 end
           )::real
    from public.crm_customers c
    where c.organization_id = p_organization_id and c.archived_at is null
      and c.lifecycle_stage = 'lead'
      and (public.oasis_normalize(concat_ws(' ', c.display_name, c.legal_name, c.email, c.billing_city, c.notes)) like '%' || q || '%'
           or public.oasis_normalize(c.display_name) % q
           or (d <> '' and public.oasis_digits(concat_ws(' ', c.phone, c.mobile)) like '%' || d || '%'))

    union all
    select 'contact', ct.id, btrim(concat_ws(' ', ct.first_name, ct.last_name)),
           nullif(concat_ws(' · ', ct.job_title, ct.email, ct.phone), ''),
           'clients', '/crm/clients/' || ct.customer_id,
           greatest(
             similarity(public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name)), q),
             case when public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name)) like '%' || q || '%' then 0.7 else 0 end,
             case when d <> '' and public.oasis_digits(concat_ws(' ', ct.phone, ct.mobile)) like '%' || d || '%' then 0.9 else 0 end
           )::real
    from public.crm_contacts ct
    where ct.organization_id = p_organization_id and ct.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name, ct.email, ct.job_title)) like '%' || q || '%'
           or public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name)) % q
           or (d <> '' and public.oasis_digits(concat_ws(' ', ct.phone, ct.mobile)) like '%' || d || '%'))

    union all
    select 'site', s.id, s.name,
           nullif(concat_ws(' · ', s.city, s.address_line1), ''),
           'locations', '/crm/clients/' || s.customer_id,
           greatest(similarity(public.oasis_normalize(s.name), q),
                    case when public.oasis_normalize(s.name) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.crm_customer_sites s
    where s.organization_id = p_organization_id and s.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', s.name, s.city, s.address_line1)) like '%' || q || '%'
           or public.oasis_normalize(s.name) % q)

    -- ----- Projets ---------------------------------------------
    union all
    select 'project', p.id, p.name,
           nullif(concat_ws(' · ', p.number, pc.display_name), ''),
           'projects', '/projets/' || p.id,
           greatest(similarity(public.oasis_normalize(p.name), q),
                    case when public.oasis_normalize(p.name) like '%' || q || '%' then 0.75 else 0 end,
                    case when public.oasis_normalize(coalesce(pc.display_name, '')) like '%' || q || '%' then 0.6 else 0 end,
                    case when d <> '' and public.oasis_digits(p.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.projects p
    left join public.crm_customers pc on pc.id = p.customer_id
    where p.organization_id = p_organization_id and p.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', p.name, p.number, p.notes, pc.display_name)) like '%' || q || '%'
           or public.oasis_normalize(p.name) % q
           or (d <> '' and public.oasis_digits(p.number) like '%' || d || '%'))

    union all
    select 'intervention', i.id, i.title, to_char(i.scheduled_start, 'DD/MM/YYYY'),
           'interventions', '/projets/interventions/' || i.id,
           greatest(similarity(public.oasis_normalize(i.title), q),
                    case when public.oasis_normalize(i.title) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.field_interventions i
    where i.organization_id = p_organization_id
      and (public.oasis_normalize(concat_ws(' ', i.title, i.instructions)) like '%' || q || '%'
           or public.oasis_normalize(i.title) % q)

    union all
    select 'task', tk.id, tk.title, null,
           'check', '/projets/' || tk.project_id,
           greatest(similarity(public.oasis_normalize(tk.title), q),
                    case when public.oasis_normalize(tk.title) like '%' || q || '%' then 0.6 else 0 end)::real
    from public.project_tasks tk
    where tk.organization_id = p_organization_id
      and (public.oasis_normalize(tk.title) like '%' || q || '%' or public.oasis_normalize(tk.title) % q)

    -- ----- Devis et factures -----------------------------------
    union all
    -- §21 « numéro ; client ; projet ; description ». Le nom du
    -- client fait partie de ce qu'on tape pour retrouver un devis —
    -- personne ne se souvient d'un numéro. Il figure aussi en
    -- sous-titre : trois devis « Jardin méditerranéen » chez trois
    -- clients seraient sinon indiscernables.
    --
    -- Le MONTANT, que §21 cite pour les factures, n'est pas cherché :
    -- « 1500 » désignerait aussi bien un total qu'un numéro, et rendre
    -- les deux transformerait chaque recherche de numéro en liste de
    -- factures sans rapport.
    select 'quote', qt.id, qt.title,
           nullif(concat_ws(' · ', qt.number, qc.display_name), ''),
           'quote', '/devis/' || qt.id,
           greatest(similarity(public.oasis_normalize(qt.title), q),
                    case when public.oasis_normalize(qt.title) like '%' || q || '%' then 0.75 else 0 end,
                    case when public.oasis_normalize(coalesce(qc.display_name, '')) like '%' || q || '%' then 0.6 else 0 end,
                    case when d <> '' and public.oasis_digits(qt.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.quotes qt
    left join public.crm_customers qc on qc.id = qt.customer_id
    where qt.organization_id = p_organization_id and qt.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', qt.title, qt.number, qc.display_name)) like '%' || q || '%'
           or public.oasis_normalize(qt.title) % q
           or (d <> '' and public.oasis_digits(qt.number) like '%' || d || '%'))

    -- §21 DEVIS — « lignes ; articles ; végétaux ». Chercher « Olivier »
    -- doit retrouver le devis qui en contient, pas seulement ceux qui
    -- s'appellent ainsi. On rend le DEVIS, jamais la ligne : le client
    -- ne veut pas ouvrir une ligne, il veut ouvrir son devis.
    union all
    select distinct on (ql.quote_id)
           'quote_line', ql.quote_id, qt2.title, 'Contient « ' || ql.description || ' »',
           'quote', '/devis/' || ql.quote_id,
           0.55::real
    from public.quote_lines ql
    join public.quotes qt2 on qt2.id = ql.quote_id
    where ql.organization_id = p_organization_id and qt2.archived_at is null
      and public.oasis_normalize(ql.description) like '%' || q || '%'

    union all
    select 'invoice', inv.id, coalesce(inv.number, 'Brouillon'),
           nullif(concat_ws(' · ', ic.display_name, to_char(inv.issued_on, 'DD/MM/YYYY')), ''),
           'invoice', '/factures/' || inv.id,
           greatest(case when public.oasis_normalize(coalesce(inv.number, '')) like '%' || q || '%' then 0.85 else 0 end,
                    case when public.oasis_normalize(coalesce(ic.display_name, '')) like '%' || q || '%' then 0.6 else 0 end,
                    case when d <> '' and public.oasis_digits(coalesce(inv.number, '')) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.invoices inv
    left join public.crm_customers ic on ic.id = inv.customer_id
    where inv.organization_id = p_organization_id and inv.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', inv.number, ic.display_name)) like '%' || q || '%'
           or (d <> '' and public.oasis_digits(coalesce(inv.number, '')) like '%' || d || '%'))

    -- ----- Digital Twin ----------------------------------------
    -- Cloisonné par ESPACE DE TRAVAIL, pas par organisation : c'est
    -- ainsi depuis la Phase 3, et un jardin livré à son propriétaire a
    -- quitté l'espace de l'entreprise. `has_garden_access` rattrape ce
    -- cas — le professionnel garde son accès tant qu'on ne le lui a pas
    -- retiré.
    union all
    select 'garden', g.id, g.name, coalesce(g.address, g.location_name),
           'twin', '/digital-twin/' || g.id,
           greatest(similarity(public.oasis_normalize(g.name), q),
                    case when public.oasis_normalize(g.name) like '%' || q || '%' then 0.75 else 0 end)::real
    from public.gardens g
    where g.deleted_at is null
      and (g.workspace_id = ws or public.has_garden_access(g.id))
      and (public.oasis_normalize(concat_ws(' ', g.name, g.address, g.location_name)) like '%' || q || '%'
           or public.oasis_normalize(g.name) % q)

    union all
    select 'garden_area', a.id, a.name, 'Zone',
           'locations', '/digital-twin/' || a.garden_id,
           greatest(similarity(public.oasis_normalize(a.name), q),
                    case when public.oasis_normalize(a.name) like '%' || q || '%' then 0.6 else 0 end)::real
    from public.garden_areas a
    where a.deleted_at is null and a.name is not null
      and (a.workspace_id = ws or public.has_garden_access(a.garden_id))
      and (public.oasis_normalize(a.name) like '%' || q || '%' or public.oasis_normalize(a.name) % q)

    -- §21 : « Olivier Martin doit retrouver l'Olivier du Digital Twin
    -- concerné. » Le sous-titre nomme le jardin, sans quoi trois
    -- oliviers de trois clients seraient indiscernables.
    union all
    select 'garden_object', o.id, o.label, g2.name,
           'twin', '/digital-twin/' || o.garden_id,
           greatest(similarity(public.oasis_normalize(o.label), q),
                    case when public.oasis_normalize(o.label) like '%' || q || '%' then 0.65 else 0 end)::real
    from public.garden_map_objects o
    join public.gardens g2 on g2.id = o.garden_id
    where o.deleted_at is null and o.label is not null and btrim(o.label) <> ''
      and (o.workspace_id = ws or public.has_garden_access(o.garden_id))
      and (public.oasis_normalize(o.label) like '%' || q || '%' or public.oasis_normalize(o.label) % q)

    union all
    select 'plant', pl.id,
           coalesce(nullif(pl.custom_name, ''), pl.common_name, pl.scientific_name),
           nullif(concat_ws(' · ', pl.scientific_name, g3.name), ''),
           'nursery', '/digital-twin/' || pl.garden_id,
           greatest(similarity(public.oasis_normalize(concat_ws(' ', pl.custom_name, pl.common_name, pl.scientific_name)), q),
                    case when public.oasis_normalize(concat_ws(' ', pl.custom_name, pl.common_name, pl.scientific_name)) like '%' || q || '%' then 0.65 else 0 end)::real
    from public.plants pl
    left join public.gardens g3 on g3.id = pl.garden_id
    where pl.deleted_at is null and pl.is_archived is not true and pl.garden_id is not null
      and (pl.workspace_id = ws or public.has_garden_access(pl.garden_id))
      and (public.oasis_normalize(concat_ws(' ', pl.custom_name, pl.common_name, pl.scientific_name)) like '%' || q || '%'
           or public.oasis_normalize(coalesce(pl.scientific_name, pl.common_name, '')) % q)

    -- ----- Pépinière -------------------------------------------
    union all
    select 'lot', l.id, l.lot_code,
           nullif(concat_ws(' ', l.species_name, l.cultivar, l.container_size), ''),
           'lots', '/pepiniere/lots/' || l.id,
           greatest(similarity(public.oasis_normalize(concat_ws(' ', l.species_name, l.cultivar)), q),
                    case when public.oasis_normalize(l.lot_code) like '%' || q || '%' then 0.9 else 0 end,
                    case when public.oasis_normalize(concat_ws(' ', l.species_name, l.cultivar)) like '%' || q || '%' then 0.75 else 0 end,
                    case when d <> '' and public.oasis_digits(l.lot_code) like '%' || d || '%' then 0.9 else 0 end)::real
    from public.nursery_lots l
    where l.organization_id = p_organization_id and l.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', l.lot_code, l.species_name, l.cultivar, l.supplier_lot_reference, l.container_size)) like '%' || q || '%'
           or public.oasis_normalize(concat_ws(' ', l.species_name, l.cultivar)) % q
           or (d <> '' and public.oasis_digits(l.lot_code) like '%' || d || '%'))

    union all
    select 'location', loc.id, loc.name, loc.code,
           'locations', '/pepiniere/emplacements',
           greatest(similarity(public.oasis_normalize(loc.name), q),
                    case when public.oasis_normalize(concat_ws(' ', loc.name, loc.code)) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.nursery_locations loc
    where loc.organization_id = p_organization_id and loc.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', loc.name, loc.code)) like '%' || q || '%'
           or public.oasis_normalize(loc.name) % q)

    -- ----- Achats et ventes ------------------------------------
    union all
    select 'supplier', sp.id, sp.name,
           nullif(concat_ws(' · ', sp.city, sp.email), ''),
           'supplier', '/fournisseurs',
           greatest(similarity(public.oasis_normalize(sp.name), q),
                    case when public.oasis_normalize(sp.name) like '%' || q || '%' then 0.8 else 0 end)::real
    from public.suppliers sp
    where sp.organization_id = p_organization_id and sp.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', sp.name, sp.reference, sp.email, sp.city)) like '%' || q || '%'
           or public.oasis_normalize(sp.name) % q)

    union all
    select 'purchase_order', po.id, po.number, po.reference,
           'purchase', '/achats/' || po.id,
           greatest(case when public.oasis_normalize(concat_ws(' ', po.number, po.reference)) like '%' || q || '%' then 0.8 else 0 end,
                    case when d <> '' and public.oasis_digits(po.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.purchase_orders po
    where po.organization_id = p_organization_id and po.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', po.number, po.reference)) like '%' || q || '%'
           or (d <> '' and public.oasis_digits(po.number) like '%' || d || '%'))

    union all
    select 'sales_order', so.id, so.number, so.reference,
           'orders', '/pepiniere/commandes/' || so.id,
           greatest(case when public.oasis_normalize(concat_ws(' ', so.number, so.reference)) like '%' || q || '%' then 0.8 else 0 end,
                    case when d <> '' and public.oasis_digits(so.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.sales_orders so
    where so.organization_id = p_organization_id and so.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', so.number, so.reference)) like '%' || q || '%'
           or (d <> '' and public.oasis_digits(so.number) like '%' || d || '%'))

    -- ----- Équipe et catalogue ---------------------------------
    union all
    select 'employee', e.id, btrim(concat_ws(' ', e.first_name, e.last_name)), e.job_title,
           'team', '/equipes',
           greatest(similarity(public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name)), q),
                    case when public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name, e.job_title)) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.employees e
    where e.organization_id = p_organization_id and e.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name, e.job_title, e.email)) like '%' || q || '%'
           or public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name)) % q)

    union all
    select 'catalog_item', ci.id, ci.name, ci.reference,
           'lots', '/catalogue',
           greatest(similarity(public.oasis_normalize(ci.name), q),
                    case when public.oasis_normalize(concat_ws(' ', ci.name, ci.reference)) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.catalog_items ci
    where ci.organization_id = p_organization_id and ci.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', ci.name, ci.reference, ci.description)) like '%' || q || '%'
           or public.oasis_normalize(ci.name) % q)
  ),
  filtered as (
    select * from hits
    -- §25-26 — le filtre par famille, et la syntaxe `type:devis`.
    where p_types is null or t = any (p_types)
  ),
  ranked as (
    select *, row_number() over (partition by t order by sc desc, ti) as rang
    from filtered
  )
  -- §22 : « Limiter résultats initiaux » — au plus `p_limit` par
  -- famille. Une recherche sur « Martin » qui rendrait quarante
  -- clients et deux devis cacherait les devis sous les clients.
  select r.t, r.id, r.ti, r.su, r.ic, r.u, r.sc
  from ranked r
  where r.rang <= p_limit
  order by r.sc desc, r.ti;
end;
$$;

-- ============================================================
-- 4. Combien y en a-t-il, en tout
-- ============================================================
-- §22 « Voir tous les résultats » a besoin de savoir s'il en reste. Une
-- fonction séparée plutôt qu'une colonne de plus : le décompte coûte
-- cher, et la palette n'en a pas besoin à chaque frappe.
create or replace function public.global_search_counts(
  p_organization_id uuid,
  p_query text
)
returns table (entity_type text, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select entity_type, count(*)
  from public.global_search(p_organization_id, p_query, null, 1000)
  group by entity_type
  order by count(*) desc;
$$;
