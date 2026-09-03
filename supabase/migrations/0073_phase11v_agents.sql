-- Oasis Care — Phase 11V, LES QUATRE AGENTS DE LA PREMIÈRE ITÉRATION.
--
-- À exécuter après 0072. Idempotente et purement additive : que des
-- fonctions, aucune table, aucune donnée touchée.
--
-- CE QUE CE FICHIER EST. Le socle (0072) a posé les tables, les
-- garde-fous et le catalogue ; il ne calcule rien. Ce fichier calcule.
-- Il contient les sept fonctions par lesquelles Finance, Billing,
-- QuotePricing et Executive répondent aux questions de la spec —
-- « Que dois-je faire aujourd'hui ? », « Qu'est-ce qui menace ma
-- marge ? », « Quels chantiers dois-je facturer ? », « Ce devis est-il
-- au bon prix ? ».
--
-- DÉTERMINISTE AVANT LLM (spec p. 42). C'est la raison d'être de ce
-- fichier, et ce n'est pas une optimisation de coût : un taux de marque
-- calculé par un modèle de langage est un taux de marque qu'on ne peut
-- ni auditer, ni reproduire, ni opposer à un client. Tout ce qui est un
-- chiffre est calculé ICI, en SQL, à partir des lignes de la base. Le
-- modèle reçoit le résultat et le met en mots. Il n'additionne rien.
--
-- ============================================================
-- LES SIX RÈGLES QUE CHAQUE FONCTION DE CE FICHIER TIENT
-- ============================================================
--
--   1. L'ORGANISATION VIENT DE LA SESSION, JAMAIS DU MODÈLE. Les
--      fonctions d'entreprise la reçoivent de l'aiguilleur et la
--      passent à `ai_guard` ; les fonctions de devis ne la prennent
--      PAS en paramètre — elles la relisent sur la ligne du devis.
--      On ne peut pas se tromper d'entreprise sur un paramètre qui
--      n'existe pas.
--
--   2. `security invoker`, RLS, ET FILTRE EXPLICITE. Les trois, pas
--      deux. La RLS suffirait si aucune de ces requêtes ne passait par
--      une vue ni ne joignait une table à travers une clé étrangère ;
--      le filtre explicite `organization_id = p_organization_id` est
--      la ceinture qui reste quand une bretelle casse. La
--      démonstration coûte quatre caractères par requête.
--
--   3. UNE DONNÉE ABSENTE SE DIT, ELLE NE SE CHIFFRE PAS. Aucun
--      `coalesce(x, 0)` derrière la lecture d'un montant qui peut
--      manquer. Un chantier sans devis n'est pas « vendu 0 € », un
--      devis sans coût saisi n'a pas « 100 % de marge », une
--      entreprise sans objectif de marge ne « dépasse pas sa cible ».
--      Dans les trois cas la fonction rend `null` et dit pourquoi.
--
--   4. UN DROIT MANQUANT NE PRODUIT PAS UN ZÉRO. C'est le piège
--      propre à ce fichier, et il est vicieux : ces fonctions sont en
--      `security invoker`, donc la RLS masque les lignes qu'on n'a pas
--      le droit de voir, donc un `sum()` rend zéro au lieu d'échouer.
--      Un commercial verrait « 0 € facturé ce mois » et le croirait.
--      Chaque bloc chiffré est donc précédé de la question « ai-je le
--      droit de lire ce que je m'apprête à additionner ? » ; sinon le
--      bloc vaut `null` et le droit manquant est NOMMÉ dans la réponse.
--      Deux fonctions vont plus loin et REFUSENT de répondre :
--      `ai_billing_candidates` et `ai_finance_margin_breakdown`, parce
--      qu'une vue partielle y donne une réponse FAUSSE et non pas
--      incomplète — voir leur en-tête.
--
--   5. LES TROIS CHIFFRES D'AFFAIRES NE SE CONFONDENT PAS. Signé,
--      facturé, encaissé (spec p. 18). Ils portent trois noms qui ne
--      se ressemblent pas, chacun documente sa source, et l'encaissé
--      dit dans son nom qu'il est TTC.
--
--   6. ON NE DIT PAS « VOUS ÊTES TROP CHER » SANS DONNÉES (spec
--      p. 14). En dessous du seuil de comparables, la fourchette n'est
--      pas rendue — pas rendue large, pas rendue prudente : pas
--      rendue. Le verdict est `insufficientData`.
--
-- CE QUI N'EST PAS ICI. Le coût de déplacement (étape 12) est calculé
-- ailleurs, côté web, par un service qui sait interroger un
-- distancier ; `ai_quote_price_analysis` EXPOSE ce dont il aura besoin
-- — siège, chantier, effectif, durée, heures de déplacement déjà
-- devisées — et ne l'estime pas. Les neuf autres agents non plus ne
-- sont pas ici : la spec p. 49 l'interdit.

-- ============================================================
-- 1. Trois outils communs
-- ============================================================

/**
 * La famille de coût d'une ligne de devis.
 *
 * POURQUOI UNE FONCTION. `quote_lines.cost_kind` est la source de
 * vérité, mais elle est facultative et, sur les données réelles
 * d'aujourd'hui, elle n'est renseignée sur AUCUNE ligne. Le type de
 * l'article de catalogue, lui, l'est. Sans ce repli, toute analyse par
 * famille rendrait « non classé » partout et le Quote Pricing Agent
 * n'aurait aucun périmètre de comparaison.
 *
 * Les deux vocabulaires ne coïncident pas : le catalogue distingue
 * `rental` de `equipment` et connaît `service` et `custom`, que les
 * coûts de chantier ignorent. On se ramène aux huit familles de
 * `project_costs.kind` — celles dans lesquelles les coûts réels seront
 * saisis — parce que le but est justement de comparer prévu et réel.
 *
 * `nonClasse` n'est pas `other` : « aucune information » et « autre »
 * sont deux réponses différentes, et la première se corrige en
 * renseignant le catalogue.
 */
create or replace function public.ai_cost_family(
  p_cost_kind text,
  p_item_type text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_cost_kind is not null then p_cost_kind
    when p_item_type is null then 'nonClasse'
    when p_item_type in ('plant', 'material', 'labor', 'equipment',
                         'transport', 'waste', 'subcontracting') then p_item_type
    when p_item_type = 'rental' then 'equipment'
    when p_item_type in ('service', 'custom') then 'other'
    else 'nonClasse'
  end;
$$;

comment on function public.ai_cost_family(text, text) is
  'Famille de coût d''une ligne : cost_kind s''il est saisi, sinon déduite du type d''article. « nonClasse » n''est pas « other ».';

/**
 * Le taux de marque, mais qui refuse de conclure sans coût.
 *
 * POURQUOI NE PAS APPELER `margin_percent` DIRECTEMENT. Parce qu'elle
 * fait `coalesce(cost_cents, 0)`. C'est le bon choix là où elle est
 * née — sur les totaux d'un devis, où les lignes sans coût valent
 * réellement zéro — mais ici, un coût NULL veut dire « personne ne l'a
 * saisi », et `margin_percent(null, 500000)` rend 100,00. L'agent
 * annoncerait alors 100 % de marge sur le devis le plus dangereux du
 * portefeuille, et il l'annoncerait avec aplomb.
 *
 * Le test de 0073 a attrapé exactement cela. La fonction existe donc
 * pour que l'erreur ne puisse pas se réintroduire par distraction : à
 * chaque appel où le coût peut manquer, c'est celle-ci qu'on appelle.
 */
create or replace function public.ai_margin_pct(
  p_cost_cents bigint,
  p_sale_cents bigint
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_cost_cents is null then null
    else public.margin_percent(p_cost_cents, p_sale_cents)
  end;
$$;

comment on function public.ai_margin_pct(bigint, bigint) is
  'Taux de marque qui rend NULL quand le coût est inconnu, là où margin_percent le traite comme zéro.';

/**
 * La cible de marge de l'entreprise, AUJOURD'HUI.
 *
 * TROIS DÉCISIONS TIENNENT DANS CES HUIT LIGNES.
 *
 *   • La période doit CONTENIR le jour présent. Un objectif de marge
 *     fixé pour 2024 n'est pas l'objectif d'aujourd'hui, et l'opposer
 *     à un devis de 2026 serait exactement le « ne pas utiliser une
 *     donnée de cinq ans comme donnée actuelle » de la page 37.
 *
 *   • On rend `null` quand rien ne couvre aujourd'hui. Pas 35 %, pas
 *     la moyenne du métier, pas la dernière valeur connue : l'appelant
 *     doit pouvoir dire « vous n'avez pas fixé d'objectif », qui est
 *     une information utile, plutôt que de juger un devis à l'aune
 *     d'un chiffre que personne n'a choisi.
 *
 *   • Entre deux périodes qui se chevauchent, la plus RÉCEMMENT
 *     COMMENCÉE gagne : une cible trimestrielle posée par-dessus une
 *     cible annuelle est une correction, pas une contradiction.
 */
create or replace function public.ai_margin_target_pct(p_organization_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select t.margin_target_pct
  from public.organization_kpi_targets t
  where t.organization_id = p_organization_id
    and t.margin_target_pct is not null
    and (now() at time zone 'Europe/Paris')::date between t.period_start and t.period_end
  order by t.period_start desc, t.period_end asc
  limit 1;
$$;

comment on function public.ai_margin_target_pct(uuid) is
  'Objectif de marge en vigueur aujourd''hui, ou NULL si aucune période ne couvre le jour présent.';

-- ============================================================
-- 2. FINANCE AGENT — la photo financière
-- ============================================================
-- Spec p. 18-19. Les douze indicateurs demandés, et l'avertissement en
-- capitales de la page 18 : « Distinguer CA devis signé / CA facturé /
-- CA encaissé. Ne jamais les confondre. »
--
-- COMMENT CE FICHIER REND LA CONFUSION IMPOSSIBLE. Pas par un
-- commentaire — par les noms. Les trois clés du bloc `chiffreAffaires`
-- sont `caDevisSigneHtCents`, `caFactureHtCents` et
-- `caEncaisseTtcCents` : trois mots différents au milieu, et le
-- troisième annonce dans son nom qu'il ne se compare pas aux deux
-- autres. Une quatrième clé, `caEncaisseHtCents`, donne la part
-- encaissée ramenée au hors-taxes, et elle est calculée — pas devinée
-- — au prorata de chaque facture réglée.
--
--   • CA DEVIS SIGNÉ. Les devis passés à « accepted », datés par
--     `decided_at`. C'est la PROMESSE : le client a dit oui. Rien
--     n'est encore ni fait, ni facturé, ni payé.
--
--   • CA FACTURÉ. Le HT des factures ÉMISES sur la période, moins les
--     avoirs ÉMIS sur la période. C'est la règle de 0065, reprise à
--     l'identique pour que ce chiffre soit LE MÊME que celui de
--     l'écran Analytics ; deux écrans qui annoncent deux chiffres
--     d'affaires différents ruinent la confiance dans les deux. Un
--     brouillon n'est pas du chiffre d'affaires : sans numéro de
--     séquence légale, la facture n'existe pas.
--
--   • CA ENCAISSÉ. L'argent RÉELLEMENT reçu : `payments.received_on`
--     dans la période. Il est TTC par nature — on encaisse un TTC, la
--     TVA comprise, qu'on reversera. Le convertir en HT demande de
--     savoir à quelle facture chaque règlement se rapporte ; les
--     règlements non affectés (un acompte reçu avant toute facture,
--     par exemple) n'ont donc pas d'équivalent HT, et leur montant est
--     rendu à part plutôt que fondu dans le total.
--
-- CE QUI ARRIVE À UN UTILISATEUR SANS LE DROIT `invoice.create`.
-- Il obtient `null` sur les blocs monétaires et la liste
-- `droitsManquants` les nomme. Il n'obtient PAS zéro. La RLS de
-- `invoices`, `payments` et `business_expenses` exige `invoice.create`
-- (0054) : sans ce droit, `sum(...)` sur une table entièrement masquée
-- rend zéro sans la moindre erreur, et un commercial lirait « 0 €
-- facturé ce mois ». C'est le mode de panne le plus dangereux de tout
-- ce fichier, parce qu'il est silencieux et vraisemblable.

create or replace function public.ai_finance_snapshot(
  p_organization_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today        date;
  v_from         date;
  v_to           date;
  v_money        boolean;   -- droit de lire factures, règlements, dépenses
  v_quotes       boolean;   -- droit de lire les devis
  v_manque       text[] := array[]::text[];

  v_facture_ht   bigint;    -- factures émises, HT
  v_avoirs_ht    bigint;    -- avoirs émis, HT
  v_signe_ht     bigint;
  v_signe_nb     int;
  v_encaisse_ttc bigint;
  v_affecte_ttc  bigint;
  v_encaisse_ht  bigint;
  v_alloc_sans_ratio int;

  v_pipeline_ht  bigint;
  v_pipeline_nb  int;
  v_backlog_ht   bigint;
  v_backlog_nb   int;

  v_marge_cents  bigint;
  v_marge_pct    numeric;
  v_marge_nb     int;
  v_sans_devis   int;
  v_sans_cout    int;

  v_couts_directs bigint;
  v_depenses_ht  bigint;
  v_depenses_tva bigint;

  v_engage_ht    bigint;
  v_engage_nb    int;

  v_creances     bigint;
  v_retard       bigint;
  v_retard_nb    int;
  v_age          jsonb;

  v_entrees      bigint;
  v_sorties      bigint;

  v_cible        record;
  v_a_cible      boolean := false;
  v_confiance    text;
  v_a_des_donnees boolean;
begin
  -- Le droit de base : `projects.read`. C'est celui que 0072 a retenu
  -- pour tout l'opérationnel de l'IA, et le plus petit dénominateur des
  -- rôles susceptibles d'ouvrir un tableau de bord.
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_today := (now() at time zone 'Europe/Paris')::date;
  v_from  := coalesce(p_from, date_trunc('month', v_today::timestamp)::date);
  v_to    := coalesce(p_to, v_today);

  if v_to < v_from then
    raise exception 'Période inversée : du % au %.', v_from, v_to;
  end if;

  v_money  := public.has_permission(p_organization_id, 'invoice.create');
  v_quotes := public.has_permission(p_organization_id, 'quotes.read');

  if not v_money then
    v_manque := v_manque || 'invoice.create'::text;
  end if;
  if not v_quotes then
    v_manque := v_manque || 'quotes.read'::text;
  end if;

  -- ---------- CA FACTURÉ (règle de 0065, à l'identique) ----------
  if v_money then
    select coalesce(sum(t.total_excluding_vat_cents), 0)::bigint
      into v_facture_ht
    from public.invoices i
    join public.invoice_totals t on t.invoice_id = i.id
    where i.organization_id = p_organization_id
      and i.archived_at is null
      and i.issued_at is not null
      and i.status <> 'cancelled'
      and i.issued_on between v_from and v_to;

    select coalesce(sum(cl.total_cents), 0)::bigint
      into v_avoirs_ht
    from public.credit_notes cn
    join public.credit_note_lines cl on cl.credit_note_id = cn.id
    where cn.organization_id = p_organization_id
      and cn.issued_at is not null
      and cn.issued_on between v_from and v_to;
  end if;

  -- ---------- CA DEVIS SIGNÉ ----------
  if v_quotes then
    select coalesce(sum(qt.total_excluding_vat_cents), 0)::bigint, count(*)::int
      into v_signe_ht, v_signe_nb
    from public.quotes q
    join public.quote_totals qt on qt.quote_id = q.id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.status = 'accepted'
      and q.decided_at is not null
      and (q.decided_at at time zone 'Europe/Paris')::date between v_from and v_to;
  end if;

  -- ---------- CA ENCAISSÉ ----------
  if v_money then
    select coalesce(sum(p.amount_cents), 0)::bigint
      into v_encaisse_ttc
    from public.payments p
    where p.organization_id = p_organization_id
      and p.received_on between v_from and v_to;

    select coalesce(sum(a.amount_cents), 0)::bigint
      into v_affecte_ttc
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    where a.organization_id = p_organization_id
      and p.organization_id = p_organization_id
      and p.received_on between v_from and v_to;

    -- LE HT DE CE QUI A ÉTÉ ENCAISSÉ, au prorata de chaque facture.
    -- Un règlement de 1 200 € sur une facture de 1 000 € HT + 200 € de
    -- TVA vaut 1 000 € de HT encaissé. La règle de trois se fait
    -- facture par facture parce que les taux diffèrent d'une facture à
    -- l'autre — un taux moyen appliqué au total serait une invention.
    select
      coalesce(sum(round(a.amount_cents::numeric * t.total_excluding_vat_cents
                         / nullif(t.total_including_vat_cents, 0))), 0)::bigint,
      count(*) filter (where coalesce(t.total_including_vat_cents, 0) = 0)::int
      into v_encaisse_ht, v_alloc_sans_ratio
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    join public.invoice_totals t on t.invoice_id = a.invoice_id
    where a.organization_id = p_organization_id
      and p.organization_id = p_organization_id
      and p.received_on between v_from and v_to;
  end if;

  -- ---------- PIPELINE et CARNET DE COMMANDES ----------
  -- PHOTO DU JOUR, hors période, comme le carnet de 0065 : un devis en
  -- attente l'est aujourd'hui ou ne l'est pas ; le cumuler sur un mois
  -- n'aurait pas de sens.
  if v_quotes then
    select coalesce(sum(qt.total_excluding_vat_cents), 0)::bigint, count(*)::int
      into v_pipeline_ht, v_pipeline_nb
    from public.quotes q
    join public.quote_totals qt on qt.quote_id = q.id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.status in ('sent', 'viewed');

    -- Le vendu qui n'est pas encore facturé. `not exists` sur les
    -- factures : sans le droit `invoice.create`, ce test rendrait VRAI
    -- pour tout le monde et le carnet serait surévalué du montant déjà
    -- facturé. On ne le calcule donc que si les deux droits sont là.
    if v_money then
      select coalesce(sum(qt.total_excluding_vat_cents), 0)::bigint, count(*)::int
        into v_backlog_ht, v_backlog_nb
      from public.quotes q
      join public.quote_totals qt on qt.quote_id = q.id
      where q.organization_id = p_organization_id
        and q.archived_at is null
        and q.status = 'accepted'
        and not exists (
          select 1 from public.invoices i
          where i.quote_id = q.id
            and i.organization_id = p_organization_id
            and i.archived_at is null
            and i.status <> 'cancelled'
        );
    end if;
  end if;

  -- ---------- MARGE CHANTIER ----------
  -- Les chantiers TERMINÉS dans la période, à leur prix de vente devisé
  -- moins leurs coûts. DEUX exclusions, et chacune se compte à part :
  --
  --   • le chantier SANS DEVIS n'a pas de prix de vente connu, et il ne
  --     vaut pas zéro — c'est la règle de 0065, née d'une marge à −56 %
  --     lue sur des données réelles ;
  --
  --   • le chantier SANS AUCUN COÛT SAISI n'a pas de marge réelle non
  --     plus : sa marge serait de 100 %, et une ligne à +100 % tire
  --     vers le haut toute la moyenne. C'est une DIVERGENCE DÉLIBÉRÉE
  --     avec `pro_analytics_landscaper`, qui l'inclut à coût zéro. Les
  --     deux fonctions de ce fichier appliquent la même règle —
  --     `ai_finance_margin_breakdown` documente ce choix en détail — et
  --     l'écart avec l'écran Analytics est assumé et compté :
  --     `chantiersSansCoutReel` dit combien de lignes le séparent.
  if v_quotes then
    with finished as (
      select p.id, p.quote_id
      from public.projects p
      where p.organization_id = p_organization_id
        and p.archived_at is null
        and p.status in ('completed', 'handedOver')
        and p.actual_end_on between v_from and v_to
    ),
    money as (
      select
        qt.total_excluding_vat_cents::bigint as sale_cents,
        (coalesce((select sum(c.total_cents) from public.project_costs c
                    where c.project_id = f.id and c.organization_id = p_organization_id), 0)
         + coalesce((select l.validated_cents from public.project_labor_from_time l
                      where l.project_id = f.id), 0))::bigint as cost_cents,
        (exists (select 1 from public.project_costs c
                  where c.project_id = f.id and c.organization_id = p_organization_id)
         or exists (select 1 from public.time_entries te
                     where te.project_id = f.id and te.organization_id = p_organization_id
                       and te.validated and te.kind = 'work' and te.hours > 0)) as a_des_couts
      from finished f
      left join public.quote_totals qt on qt.quote_id = f.quote_id
    )
    select
      sum(sale_cents - cost_cents) filter (where sale_cents is not null and a_des_couts)::bigint,
      public.margin_percent(
        (sum(cost_cents) filter (where sale_cents is not null and a_des_couts))::bigint,
        (sum(sale_cents) filter (where sale_cents is not null and a_des_couts))::bigint),
      count(*) filter (where sale_cents is not null and a_des_couts)::int,
      count(*) filter (where sale_cents is null)::int,
      count(*) filter (where sale_cents is not null and not a_des_couts)::int
      into v_marge_cents, v_marge_pct, v_marge_nb, v_sans_devis, v_sans_cout
    from money;
  end if;

  -- ---------- MARGE BRUTE D'EXPLOITATION ----------
  -- CA facturé moins les COÛTS DIRECTS de la période : achats de
  -- chantier saisis, plus la main-d'œuvre pointée ET VALIDÉE. Un
  -- pointage non validé n'entre dans aucun budget — règle du
  -- Milestone 7, valable ici aussi.
  --
  -- Ce n'est pas la marge chantier ci-dessus, et les deux ne doivent
  -- pas se rapprocher naïvement : la première suit des CHANTIERS
  -- terminés, celle-ci suit une PÉRIODE. Un chantier facturé en mars et
  -- payé en avril ne tombe pas dans le même mois des deux côtés.
  if v_money then
    select
      (coalesce((select sum(c.total_cents) from public.project_costs c
                  where c.organization_id = p_organization_id
                    and c.incurred_on between v_from and v_to), 0)
       + coalesce((select sum(te.total_cents) from public.time_entries te
                    where te.organization_id = p_organization_id
                      and te.validated
                      and te.kind = 'work'
                      and te.worked_on between v_from and v_to), 0))::bigint
      into v_couts_directs;

    select
      coalesce(sum(e.amount_cents), 0)::bigint,
      coalesce(sum(e.vat_cents), 0)::bigint
      into v_depenses_ht, v_depenses_tva
    from public.business_expenses e
    where e.organization_id = p_organization_id
      and e.spent_on between v_from and v_to;

    -- ENGAGEMENTS FOURNISSEURS : commandes parties et pas encore
    -- entièrement reçues. De l'argent promis, pas encore dépensé.
    select
      coalesce(sum(l.total_cents), 0)::bigint,
      count(distinct po.id)::int
      into v_engage_ht, v_engage_nb
    from public.purchase_orders po
    join public.purchase_order_lines l on l.purchase_order_id = po.id
    where po.organization_id = p_organization_id
      and po.archived_at is null
      and po.status in ('sent', 'partiallyReceived');

    -- CRÉANCES : photo du jour, indépendante de la période. Une facture
    -- impayée le reste quel que soit le mois qu'on regarde.
    select
      coalesce(sum(b.outstanding_cents), 0)::bigint,
      coalesce(sum(b.outstanding_cents) filter (where i.due_on is not null and i.due_on < v_today), 0)::bigint,
      count(*) filter (where i.due_on is not null and i.due_on < v_today)::int,
      jsonb_build_object(
        'moins30Cents',  coalesce(sum(b.outstanding_cents) filter (where i.due_on is not null and i.due_on >= v_today - 30 and i.due_on < v_today), 0),
        'de31a60Cents',  coalesce(sum(b.outstanding_cents) filter (where i.due_on is not null and i.due_on >= v_today - 60 and i.due_on < v_today - 30), 0),
        'de61a90Cents',  coalesce(sum(b.outstanding_cents) filter (where i.due_on is not null and i.due_on >= v_today - 90 and i.due_on < v_today - 60), 0),
        'plus90Cents',   coalesce(sum(b.outstanding_cents) filter (where i.due_on is not null and i.due_on < v_today - 90), 0))
      into v_creances, v_retard, v_retard_nb, v_age
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.organization_id = p_organization_id
      and i.archived_at is null
      and i.issued_at is not null
      and i.status <> 'cancelled'
      and b.outstanding_cents > 0;

    -- TRÉSORERIE OBSERVÉE sur la période : ce qui est entré moins ce
    -- qui est sorti. Ce n'est pas un solde bancaire et ce n'est pas un
    -- prévisionnel — la vue `cash_flow_entries` (0054) le dit déjà.
    select
      coalesce(sum(e.amount_cents) filter (where e.direction = 'in'), 0)::bigint,
      coalesce(-sum(e.amount_cents) filter (where e.direction = 'out'), 0)::bigint
      into v_entrees, v_sorties
    from public.cash_flow_entries e
    where e.organization_id = p_organization_id
      and e.occurred_on between v_from and v_to;
  end if;

  -- ---------- LES OBJECTIFS ----------
  select t.revenue_target_cents, t.margin_target_pct, t.quote_conversion_target_pct,
         t.cash_target_cents, t.utilization_target_pct, t.period_start, t.period_end
    into v_cible
  from public.organization_kpi_targets t
  where t.organization_id = p_organization_id
    and v_today between t.period_start and t.period_end
  order by t.period_start desc, t.period_end asc
  limit 1;
  v_a_cible := found;

  -- ---------- LA CONFIANCE ----------
  -- Une photo amputée d'un de ses droits n'est pas une photo « peu
  -- fiable » : c'est une photo dont on ne sait pas ce qu'elle cache.
  v_a_des_donnees := coalesce(v_facture_ht, 0) <> 0
                     or coalesce(v_signe_ht, 0) <> 0
                     or coalesce(v_encaisse_ttc, 0) <> 0
                     or coalesce(v_pipeline_ht, 0) <> 0;

  v_confiance := case
    when cardinality(v_manque) > 0 then 'insufficient_data'
    when not v_a_des_donnees then 'insufficient_data'
    else 'high'   -- tout est lu dans des registres, rien n'est estimé
  end;

  return jsonb_build_object(
    'agent', 'finance',
    'organisationId', p_organization_id,
    'periode', jsonb_build_object('du', v_from, 'au', v_to, 'aujourdhuiParis', v_today),
    'droitsManquants', to_jsonb(v_manque),
    'confiance', v_confiance,

    -- LES TROIS CHIFFRES D'AFFAIRES, ET LEURS SOURCES.
    'chiffreAffaires', jsonb_build_object(
      'caDevisSigneHtCents', v_signe_ht,
      'caDevisSigneNombre',  v_signe_nb,
      'caDevisSigneSource',  'devis passés à « accepted », datés par decided_at',

      'caFactureHtCents',        case when v_money then v_facture_ht - v_avoirs_ht end,
      'facturesEmisesHtCents',   v_facture_ht,
      'avoirsEmisHtCents',       v_avoirs_ht,
      'caFactureSource',         'factures émises (issued_at non nul, hors annulées) moins avoirs émis, HT',

      'caEncaisseTtcCents',      v_encaisse_ttc,
      'caEncaisseHtCents',       v_encaisse_ht,
      'encaisseAffecteTtcCents', v_affecte_ttc,
      'encaisseNonAffecteTtcCents',
        case when v_money then v_encaisse_ttc - v_affecte_ttc end,
      'affectationsSansRatioHt', v_alloc_sans_ratio,
      'caEncaisseSource',        'règlements reçus dans la période ; le HT est le prorata de chaque facture réglée'
    ),

    'pipelineDevis', jsonb_build_object(
      'montantHtCents', v_pipeline_ht, 'nombre', v_pipeline_nb,
      'note', 'photo du jour : devis envoyés ou vus, sans réponse'),

    'carnetDeCommandes', jsonb_build_object(
      'signeNonFactureHtCents', v_backlog_ht, 'nombre', v_backlog_nb,
      'note', 'photo du jour : devis acceptés sans facture'),

    'margeChantier', jsonb_build_object(
      'margeCents', v_marge_cents,
      'tauxMarquePct', v_marge_pct,
      'chantiersMesures', v_marge_nb,
      'chantiersSansDevis', v_sans_devis,
      'chantiersSansCoutReel', v_sans_cout,
      'note', 'chantiers terminés dans la période ; ceux sans devis ou sans aucun coût saisi sont exclus et comptés à part'),

    'margeBrute', jsonb_build_object(
      'coutsDirectsCents', v_couts_directs,
      'margeCents', case when v_money then (v_facture_ht - v_avoirs_ht) - v_couts_directs end,
      'tauxMarquePct', case when v_money
        then public.margin_percent(v_couts_directs, v_facture_ht - v_avoirs_ht) end,
      'note', 'CA facturé moins coûts directs de la période (achats chantier + main-d''œuvre validée)'),

    'depenses', jsonb_build_object(
      'generalesHtCents', v_depenses_ht, 'tvaCents', v_depenses_tva,
      'note', 'dépenses d''entreprise saisies sur la période ; les coûts de chantier sont comptés dans margeBrute'),

    'engagementsFournisseurs', jsonb_build_object(
      'montantHtCents', v_engage_ht, 'nombreCommandes', v_engage_nb,
      'note', 'commandes envoyées et pas entièrement reçues'),

    'creances', jsonb_build_object(
      'resteDuTtcCents', v_creances,
      'enRetardTtcCents', v_retard,
      'facturesEnRetard', v_retard_nb,
      'anciennete', v_age),

    'tresorerie', jsonb_build_object(
      'encaissementsCents', v_entrees,
      'decaissementsCents', v_sorties,
      'soldePeriodeCents', case when v_money then v_entrees - v_sorties end,
      'note', 'flux observés sur la période ; ce n''est pas un solde bancaire'),

    'objectifs', case when not v_a_cible then null else jsonb_build_object(
      'du', v_cible.period_start, 'au', v_cible.period_end,
      'caCibleCents', v_cible.revenue_target_cents,
      'margeCiblePct', v_cible.margin_target_pct,
      'conversionCiblePct', v_cible.quote_conversion_target_pct,
      'tresorerieCibleCents', v_cible.cash_target_cents,
      'utilisationCiblePct', v_cible.utilization_target_pct,
      'ecartCaCents', case
        when v_money and v_cible.revenue_target_cents is not null
        then (v_facture_ht - v_avoirs_ht) - v_cible.revenue_target_cents end) end
  );
end;
$$;

comment on function public.ai_finance_snapshot(uuid, date, date) is
  'Finance Agent : la photo financière d''une période. CA signé, facturé et encaissé y sont trois clés distinctes ; un droit manquant rend null et se nomme, jamais zéro.';

-- ============================================================
-- 3. FINANCE AGENT — marge estimée contre marge réelle
-- ============================================================
-- Spec p. 19-20 : « Oasis surveille estimatedMargin / actualMargin
-- par chantier, client, commercial, service, ville, équipe, mois »,
-- puis « Principales causes détectées : 1. heures terrain +18 %,
-- 2. prix végétaux +11 %, 3. déplacement sous-facturé ».
--
-- CETTE FONCTION REFUSE DE RÉPONDRE À QUI N'A PAS `quotes.read`, et ce
-- n'est pas de la rigidité. Le prix de vente d'un chantier vient de son
-- devis. Sans le droit de lire les devis, la RLS masque toutes les
-- lignes, chaque chantier paraît « sans devis », et la fonction
-- annoncerait « 0 chantier mesuré, 14 sans devis ». Ce n'est pas une
-- réponse incomplète, c'est une réponse FAUSSE : elle décrit un état de
-- la base qui n'existe pas, et elle enverrait l'utilisateur corriger
-- des chantiers qui n'ont rien à se reprocher. Mieux vaut une erreur.
--
-- TROIS CHOSES SORTENT DU CALCUL PLUTÔT QUE D'Y ENTRER À ZÉRO.
--
--   • LE CHANTIER SANS DEVIS. Il n'a pas de prix de vente connu, et il
--     ne vaut pas zéro. C'est le défaut que 0065 a corrigé après avoir
--     lu une marge à −56 % sur des données réelles. Il est exclu, et
--     compté à part pour que l'écran puisse dire combien il en a exclu.
--
--   • LE CHANTIER SANS COÛT ESTIMÉ. Ni ressources prévues chiffrées,
--     ni coût sur les lignes du devis : sa marge estimée n'existe pas.
--     Attention au piège — `quote_lines.unit_cost_cents` est NOT NULL
--     DEFAULT 0, donc « personne n'a saisi de coût » se présente comme
--     un coût de zéro, c'est-à-dire comme une marge de 100 %. On ne
--     retient donc le coût du devis que si AU MOINS UNE ligne porte un
--     coût unitaire strictement positif.
--
--   • LE CHANTIER SANS AUCUN COÛT RÉEL SAISI. Ni achat, ni heure
--     pointée. Sa marge réelle serait de 100 %, et cette ligne
--     tirerait vers le haut toutes les moyennes de son groupe. C'est
--     une DIVERGENCE DÉLIBÉRÉE avec `pro_analytics_landscaper`, qui
--     l'inclut à coût zéro : l'écran Analytics mesure une entreprise,
--     cette fonction cherche une anomalie, et une ligne à +100 % de
--     marque est du bruit qui masque le signal. Ces chantiers sont
--     comptés dans `chantiersSansCoutReel`.
--
-- LES SEPT DIMENSIONS, ET CE QUI EN EST UNE APPROXIMATION.
-- `chantier`, `client` et `mois` sont exacts. Les quatre autres sont
-- déduites, faute de champ dédié dans le modèle, et chacune le dit :
--   • `commercial` = l'auteur du devis (`quotes.created_by`) ;
--   • `service`    = la famille de coût dominante du devis, en montant ;
--   • `ville`      = la ville du site, à défaut celle de facturation ;
--   • `equipe`     = l'équipe la plus présente sur les interventions.

create or replace function public.ai_finance_margin_breakdown(
  p_organization_id uuid,
  p_from date default null,
  p_to date default null,
  p_dimension text default 'chantier'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today   date;
  v_from    date;
  v_to      date;
  v_dim     text;
  v_res     jsonb;
  v_perim   jsonb;
  v_global  jsonb;
  v_causes  jsonb;
  v_heures  jsonb;
begin
  perform public.ai_guard(p_organization_id, 'projects.read');
  -- Voir l'en-tête : sans ce droit, la réponse serait fausse et non
  -- pas partielle.
  perform public.ai_guard(p_organization_id, 'quotes.read');

  v_dim := coalesce(p_dimension, 'chantier');
  if v_dim not in ('chantier', 'client', 'commercial', 'service', 'ville', 'equipe', 'mois') then
    raise exception 'Dimension inconnue : « % ». Attendu : chantier, client, commercial, service, ville, equipe ou mois.', v_dim;
  end if;

  -- Deux dimensions nomment des clients ou des adresses. Les rendre
  -- sous « inconnu » à qui n'a pas `clients.read` donnerait un tableau
  -- de quatorze lignes « Client inconnu » : illisible, et trompeur.
  if v_dim in ('client', 'ville') then
    perform public.ai_guard(p_organization_id, 'clients.read');
  end if;

  v_today := (now() at time zone 'Europe/Paris')::date;
  v_from  := coalesce(p_from, (date_trunc('month', v_today::timestamp) - interval '2 months')::date);
  v_to    := coalesce(p_to, v_today);
  if v_to < v_from then
    raise exception 'Période inversée : du % au %.', v_from, v_to;
  end if;

  with
  -- Les chantiers TERMINÉS dans la période. Un chantier en cours n'a
  -- pas de marge, il a une marge prévue.
  termines as (
    select p.id, p.number, p.name, p.customer_id, p.site_id, p.quote_id, p.actual_end_on
    from public.projects p
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('completed', 'handedOver')
      and p.actual_end_on between v_from and v_to
  ),
  -- Le coût du devis, mais seulement s'il a été SAISI. Voir l'en-tête :
  -- `unit_cost_cents` vaut 0 par défaut.
  cout_devis as (
    select l.quote_id,
           sum(l.cost_total_cents)::bigint as cents,
           count(*) filter (where l.unit_cost_cents > 0)::int as lignes_chiffrees
    from public.quote_lines l
    where l.organization_id = p_organization_id
      and l.quote_id in (select quote_id from termines where quote_id is not null)
    group by l.quote_id
  ),
  -- Les ressources prévues du chantier, même prudence.
  ressources as (
    select r.project_id,
           sum(r.planned_total_cents)::bigint as cents,
           count(*) filter (where r.planned_unit_cost_cents > 0)::int as lignes_chiffrees,
           sum(r.planned_quantity) filter (where r.kind = 'labor') as heures_prevues
    from public.project_resources r
    where r.organization_id = p_organization_id
      and r.project_id in (select id from termines)
    group by r.project_id
  ),
  achats as (
    select c.project_id, sum(c.total_cents)::bigint as cents, count(*)::int as lignes
    from public.project_costs c
    where c.organization_id = p_organization_id
      and c.project_id in (select id from termines)
    group by c.project_id
  ),
  -- La main-d'œuvre POINTÉE ET VALIDÉE. Un pointage non validé n'entre
  -- dans aucun budget.
  mo as (
    select te.project_id,
           sum(te.total_cents) filter (where te.validated)::bigint as cents,
           sum(te.hours) filter (where te.validated) as heures
    from public.time_entries te
    where te.organization_id = p_organization_id
      and te.kind = 'work'
      and te.project_id in (select id from termines)
    group by te.project_id
  ),
  -- La famille de coût dominante du devis, EN MONTANT DE VENTE. En
  -- nombre de lignes, un devis de terrassement à 40 000 € perdrait
  -- contre ses trois lignes de plantes à 200 €.
  famille as (
    select distinct on (l.quote_id)
           l.quote_id,
           public.ai_cost_family(l.cost_kind, ci.item_type) as famille
    from public.quote_lines l
    left join public.catalog_items ci
           on ci.id = l.catalog_item_id and ci.organization_id = p_organization_id
    where l.organization_id = p_organization_id
      and l.quote_id in (select quote_id from termines where quote_id is not null)
    group by l.quote_id, public.ai_cost_family(l.cost_kind, ci.item_type)
    order by l.quote_id, sum(l.sale_total_cents) desc nulls last
  ),
  -- L'équipe la plus présente sur les interventions du chantier.
  equipe as (
    select distinct on (fi.project_id)
           fi.project_id, fi.team_id, count(*) as n
    from public.field_interventions fi
    where fi.organization_id = p_organization_id
      and fi.team_id is not null
      and fi.project_id in (select id from termines)
    group by fi.project_id, fi.team_id
    order by fi.project_id, count(*) desc
  ),
  base as (
    select
      t.id, t.number, t.name, t.actual_end_on, t.customer_id, t.quote_id,
      qt.total_excluding_vat_cents::bigint as vendu_ht_cents,

      -- Coût estimé : les ressources prévues si elles sont chiffrées,
      -- sinon le coût du devis s'il l'est. Sinon rien.
      case
        when res.lignes_chiffrees > 0 then res.cents
        when cd.lignes_chiffrees > 0 then cd.cents
      end as cout_estime_cents,
      case
        when res.lignes_chiffrees > 0 then 'ressources'
        when cd.lignes_chiffrees > 0 then 'devis'
      end as base_cout_estime,

      (coalesce(ac.cents, 0) + coalesce(mo.cents, 0))::bigint as cout_reel_cents,
      (ac.lignes is not null or coalesce(mo.heures, 0) > 0) as a_des_couts_reels,

      res.heures_prevues,
      mo.heures as heures_reelles,

      -- Les sept clés de regroupement, calculées une fois.
      t.id::text as cle_chantier,
      coalesce(t.number || ' — ', '') || t.name as lib_chantier,
      coalesce(t.customer_id::text, 'sansClient') as cle_client,
      coalesce(cu.display_name, 'Client non renseigné') as lib_client,
      coalesce(q.created_by::text, 'sansCommercial') as cle_commercial,
      coalesce(nullif(btrim(coalesce(em.first_name, '') || ' ' || coalesce(em.last_name, '')), ''),
               'Commercial non renseigné') as lib_commercial,
      coalesce(fa.famille, 'nonClasse') as cle_service,
      coalesce(fa.famille, 'nonClasse') as lib_service,
      coalesce(nullif(btrim(coalesce(si.city, cu.billing_city, '')), ''), 'Ville non renseignée') as cle_ville,
      coalesce(nullif(btrim(coalesce(si.city, cu.billing_city, '')), ''), 'Ville non renseignée') as lib_ville,
      coalesce(eq.team_id::text, 'sansEquipe') as cle_equipe,
      coalesce(te.name, 'Équipe non renseignée') as lib_equipe,
      to_char(t.actual_end_on, 'YYYY-MM') as cle_mois,
      to_char(t.actual_end_on, 'YYYY-MM') as lib_mois
    from termines t
    left join public.quote_totals qt on qt.quote_id = t.quote_id
    left join public.quotes q on q.id = t.quote_id and q.organization_id = p_organization_id
    left join cout_devis cd on cd.quote_id = t.quote_id
    left join ressources res on res.project_id = t.id
    left join achats ac on ac.project_id = t.id
    left join mo on mo.project_id = t.id
    left join famille fa on fa.quote_id = t.quote_id
    left join equipe eq on eq.project_id = t.id
    left join public.teams te on te.id = eq.team_id and te.organization_id = p_organization_id
    left join public.crm_customers cu on cu.id = t.customer_id and cu.organization_id = p_organization_id
    left join public.crm_customer_sites si on si.id = t.site_id and si.organization_id = p_organization_id
    left join public.employees em on em.user_id = q.created_by and em.organization_id = p_organization_id
  ),
  -- Seuls les chantiers dont on connaît le prix de vente entrent dans
  -- une marge. Les autres sont comptés dans le périmètre.
  mesures as (
    select b.*,
           case v_dim
             when 'chantier'   then b.cle_chantier
             when 'client'     then b.cle_client
             when 'commercial' then b.cle_commercial
             when 'service'    then b.cle_service
             when 'ville'      then b.cle_ville
             when 'equipe'     then b.cle_equipe
             else b.cle_mois
           end as cle,
           case v_dim
             when 'chantier'   then b.lib_chantier
             when 'client'     then b.lib_client
             when 'commercial' then b.lib_commercial
             when 'service'    then b.lib_service
             when 'ville'      then b.lib_ville
             when 'equipe'     then b.lib_equipe
             else b.lib_mois
           end as libelle
    from base b
    where b.vendu_ht_cents is not null
  ),
  agg as (
    select
      m.cle, m.libelle,
      count(*)::int as chantiers,
      sum(m.vendu_ht_cents)::bigint as vendu_ht_cents,

      count(*) filter (where m.cout_estime_cents is not null)::int as chantiers_estimes,
      sum(m.cout_estime_cents) filter (where m.cout_estime_cents is not null)::bigint as cout_estime_cents,
      sum(m.vendu_ht_cents - m.cout_estime_cents)
        filter (where m.cout_estime_cents is not null)::bigint as marge_estimee_cents,
      public.margin_percent(
        (sum(m.cout_estime_cents) filter (where m.cout_estime_cents is not null))::bigint,
        (sum(m.vendu_ht_cents) filter (where m.cout_estime_cents is not null))::bigint) as taux_estime_pct,

      count(*) filter (where m.a_des_couts_reels)::int as chantiers_reels,
      sum(m.cout_reel_cents) filter (where m.a_des_couts_reels)::bigint as cout_reel_cents,
      sum(m.vendu_ht_cents - m.cout_reel_cents)
        filter (where m.a_des_couts_reels)::bigint as marge_reelle_cents,
      public.margin_percent(
        (sum(m.cout_reel_cents) filter (where m.a_des_couts_reels))::bigint,
        (sum(m.vendu_ht_cents) filter (where m.a_des_couts_reels))::bigint) as taux_reel_pct
    from mesures m
    group by m.cle, m.libelle
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'cle', a.cle,
      'libelle', a.libelle,
      'chantiers', a.chantiers,
      'venduHtCents', a.vendu_ht_cents,
      'chantiersAvecMargeEstimee', a.chantiers_estimes,
      'coutEstimeCents', a.cout_estime_cents,
      'margeEstimeeCents', a.marge_estimee_cents,
      'tauxMarqueEstimePct', a.taux_estime_pct,
      'chantiersAvecMargeReelle', a.chantiers_reels,
      'coutReelCents', a.cout_reel_cents,
      'margeReelleCents', a.marge_reelle_cents,
      'tauxMarqueReelPct', a.taux_reel_pct,
      -- L'ÉCART EN POINTS, et null si l'un des deux manque. Un écart
      -- calculé contre un taux inconnu serait le taux lui-même.
      'ecartPoints', case
        when a.taux_reel_pct is not null and a.taux_estime_pct is not null
        then round(a.taux_reel_pct - a.taux_estime_pct, 2) end)
      order by a.marge_reelle_cents asc nulls last), '[]'::jsonb)
    into v_res
  from agg a;

  -- ---------- LE PÉRIMÈTRE ----------
  with termines as (
    select p.id, p.quote_id, p.number, p.name
    from public.projects p
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('completed', 'handedOver')
      and p.actual_end_on between v_from and v_to
  ),
  etat as (
    select
      t.id, t.number, t.name,
      qt.total_excluding_vat_cents as vendu,
      (exists (select 1 from public.project_costs c
                where c.project_id = t.id and c.organization_id = p_organization_id)
       or exists (select 1 from public.time_entries te
                   where te.project_id = t.id and te.organization_id = p_organization_id
                     and te.validated and te.kind = 'work' and te.hours > 0)) as a_couts,
      (exists (select 1 from public.project_resources r
                where r.project_id = t.id and r.organization_id = p_organization_id
                  and r.planned_unit_cost_cents > 0)
       or exists (select 1 from public.quote_lines l
                   where l.quote_id = t.quote_id and l.organization_id = p_organization_id
                     and l.unit_cost_cents > 0)) as a_estime
    from termines t
    left join public.quote_totals qt on qt.quote_id = t.quote_id
  )
  select jsonb_build_object(
    'chantiersTermines', count(*)::int,
    'chantiersMesures', count(*) filter (where vendu is not null)::int,
    'chantiersSansDevis', count(*) filter (where vendu is null)::int,
    'chantiersSansCoutEstime', count(*) filter (where vendu is not null and not a_estime)::int,
    'chantiersSansCoutReel', count(*) filter (where vendu is not null and not a_couts)::int,
    'sansDevis', coalesce(jsonb_agg(jsonb_build_object('numero', number, 'nom', name))
                          filter (where vendu is null), '[]'::jsonb),
    'note', 'un chantier sans devis n''a pas de prix de vente connu : il est exclu des marges, pas compté à zéro')
    into v_perim
  from etat;

  -- ---------- LES CAUSES D'ÉCART ----------
  -- Prévu contre réel, PAR FAMILLE DE COÛT, sur les chantiers mesurés.
  -- C'est ce que la spec appelle « heures terrain +18 %, prix végétaux
  -- +11 % » : la même question posée famille par famille.
  --
  -- La main-d'œuvre réelle vient des pointages validés et non de
  -- `project_costs` : c'est là qu'elle est saisie.
  with mesures as (
    select p.id
    from public.projects p
    join public.quote_totals qt on qt.quote_id = p.quote_id
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('completed', 'handedOver')
      and p.actual_end_on between v_from and v_to
  ),
  prevu as (
    select r.kind as famille, sum(r.planned_total_cents)::bigint as cents
    from public.project_resources r
    where r.organization_id = p_organization_id
      and r.project_id in (select id from mesures)
    group by r.kind
  ),
  reel as (
    select c.kind as famille, sum(c.total_cents)::bigint as cents
    from public.project_costs c
    where c.organization_id = p_organization_id
      and c.project_id in (select id from mesures)
    group by c.kind
    union all
    select 'labor', sum(te.total_cents)::bigint
    from public.time_entries te
    where te.organization_id = p_organization_id
      and te.validated and te.kind = 'work'
      and te.project_id in (select id from mesures)
    having sum(te.total_cents) is not null
  ),
  reel_cumul as (
    select famille, sum(cents)::bigint as cents from reel group by famille
  ),
  fusion as (
    select coalesce(p.famille, r.famille) as famille, p.cents as prevu, r.cents as reel
    from prevu p
    full join reel_cumul r on r.famille = p.famille
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'famille', famille,
    'prevuCents', prevu,
    'reelCents', reel,
    -- NULL des deux côtés quand l'un des deux manque : un dépassement
    -- calculé contre un budget inexistant est le montant lui-même
    -- déguisé en dérive.
    'ecartCents', case when prevu is not null and reel is not null then reel - prevu end,
    'ecartPct', case when prevu is not null and prevu <> 0 and reel is not null
                     then round(100.0 * (reel - prevu) / prevu, 1) end)
    order by case when prevu is not null and reel is not null then reel - prevu end desc nulls last), '[]'::jsonb)
    into v_causes
  from fusion
  where coalesce(prevu, 0) <> 0 or coalesce(reel, 0) <> 0;

  -- ---------- LES HEURES ----------
  with mesures as (
    select p.id
    from public.projects p
    join public.quote_totals qt on qt.quote_id = p.quote_id
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('completed', 'handedOver')
      and p.actual_end_on between v_from and v_to
  )
  select jsonb_build_object(
    'heuresPrevues', (select sum(r.planned_quantity) from public.project_resources r
                       where r.organization_id = p_organization_id and r.kind = 'labor'
                         and r.project_id in (select id from mesures)),
    'heuresValidees', (select sum(te.hours) from public.time_entries te
                        where te.organization_id = p_organization_id
                          and te.validated and te.kind = 'work'
                          and te.project_id in (select id from mesures)),
    -- Comme en 0059 : NULL des deux côtés. Zéro heure prévue ne veut
    -- pas dire « équipe catastrophique », mais « personne n'a estimé ».
    'ecartPct', (select case
        when coalesce(pr.h, 0) = 0 or coalesce(re.h, 0) = 0 then null
        else round(100.0 * (re.h - pr.h) / pr.h, 1) end
      from (select sum(r.planned_quantity) as h from public.project_resources r
             where r.organization_id = p_organization_id and r.kind = 'labor'
               and r.project_id in (select id from mesures)) pr,
           (select sum(te.hours) as h from public.time_entries te
             where te.organization_id = p_organization_id
               and te.validated and te.kind = 'work'
               and te.project_id in (select id from mesures)) re))
    into v_heures;

  -- ---------- LE GLOBAL ----------
  -- Recalculé sur la même définition que `parDimension`, mais sans
  -- regroupement : un total obtenu en additionnant les lignes du
  -- tableau serait faux dès que la dimension laisse un chantier de
  -- côté (aucune ne le fait aujourd'hui, mais la prochaine le fera).
  with mesures as (
    select
      qt.total_excluding_vat_cents::bigint as vendu,
      case
        when exists (select 1 from public.project_resources r
                      where r.project_id = p.id and r.organization_id = p_organization_id
                        and r.planned_unit_cost_cents > 0)
        then (select sum(r.planned_total_cents) from public.project_resources r
               where r.project_id = p.id and r.organization_id = p_organization_id)
        when exists (select 1 from public.quote_lines l
                      where l.quote_id = p.quote_id and l.organization_id = p_organization_id
                        and l.unit_cost_cents > 0)
        then (select sum(l.cost_total_cents) from public.quote_lines l
               where l.quote_id = p.quote_id and l.organization_id = p_organization_id)
      end::bigint as cout_estime,
      (coalesce((select sum(c.total_cents) from public.project_costs c
                  where c.project_id = p.id and c.organization_id = p_organization_id), 0)
       + coalesce((select sum(te.total_cents) from public.time_entries te
                    where te.project_id = p.id and te.organization_id = p_organization_id
                      and te.validated and te.kind = 'work'), 0))::bigint as cout_reel,
      (exists (select 1 from public.project_costs c
                where c.project_id = p.id and c.organization_id = p_organization_id)
       or exists (select 1 from public.time_entries te
                   where te.project_id = p.id and te.organization_id = p_organization_id
                     and te.validated and te.kind = 'work' and te.hours > 0)) as a_couts
    from public.projects p
    join public.quote_totals qt on qt.quote_id = p.quote_id
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('completed', 'handedOver')
      and p.actual_end_on between v_from and v_to
  )
  select jsonb_build_object(
    'venduHtCents', coalesce(sum(vendu), 0)::bigint,
    'margeEstimeeCents', sum(vendu - cout_estime) filter (where cout_estime is not null)::bigint,
    'tauxMarqueEstimePct', public.margin_percent(
      (sum(cout_estime) filter (where cout_estime is not null))::bigint,
      (sum(vendu) filter (where cout_estime is not null))::bigint),
    'margeReelleCents', sum(vendu - cout_reel) filter (where a_couts)::bigint,
    'tauxMarqueReelPct', public.margin_percent(
      (sum(cout_reel) filter (where a_couts))::bigint,
      (sum(vendu) filter (where a_couts))::bigint),
    'ecartPoints', case
      when public.margin_percent((sum(cout_reel) filter (where a_couts))::bigint,
                                 (sum(vendu) filter (where a_couts))::bigint) is not null
       and public.margin_percent((sum(cout_estime) filter (where cout_estime is not null))::bigint,
                                 (sum(vendu) filter (where cout_estime is not null))::bigint) is not null
      then round(
        public.margin_percent((sum(cout_reel) filter (where a_couts))::bigint,
                              (sum(vendu) filter (where a_couts))::bigint)
        - public.margin_percent((sum(cout_estime) filter (where cout_estime is not null))::bigint,
                                (sum(vendu) filter (where cout_estime is not null))::bigint), 2) end)
    into v_global
  from mesures;

  return jsonb_build_object(
    'agent', 'finance',
    'organisationId', p_organization_id,
    'periode', jsonb_build_object('du', v_from, 'au', v_to, 'aujourdhuiParis', v_today),
    'dimension', v_dim,
    'dimensionApproximee', v_dim in ('commercial', 'service', 'ville', 'equipe'),
    'perimetre', v_perim,
    'global', v_global,
    'parDimension', v_res,
    'causesEcart', v_causes,
    'heures', v_heures,
    'margeCiblePct', public.ai_margin_target_pct(p_organization_id),
    'confiance', case
      when (v_perim ->> 'chantiersMesures')::int = 0 then 'insufficient_data'
      when (v_perim ->> 'chantiersSansCoutReel')::int * 2 > (v_perim ->> 'chantiersMesures')::int then 'low'
      when (v_perim ->> 'chantiersMesures')::int < 3 then 'low'
      when (v_perim ->> 'chantiersSansDevis')::int > 0 then 'medium'
      else 'high' end
  );
end;
$$;

comment on function public.ai_finance_margin_breakdown(uuid, date, date, text) is
  'Finance Agent : marge estimée contre marge réelle, par chantier, client, commercial, service, ville, équipe ou mois, avec les causes d''écart par famille de coût.';

-- ============================================================
-- 4. BILLING AGENT — ce qui attend d'être facturé
-- ============================================================
-- Spec p. 10-11. « 10 chantiers terminés ne sont pas facturés. Valeur
-- totale potentielle : 38 450 € HT », puis « 10 brouillons créés,
-- 8 prêts à être vérifiés, 2 comportent des écarts de coûts », et
-- p. 32 : « 12 projets analysés. 8 prêts. 2 nécessitent contrôle.
-- 2 ne sont pas encore réceptionnés. »
--
-- LE PARTAGE PRÊT / À VÉRIFIER EST LE CŒUR DE L'ÉCRAN, pas un détail
-- d'affichage. Une liste de dix chantiers sans ce partage oblige
-- l'utilisateur à rouvrir les dix ; avec lui, il en ouvre deux. Chaque
-- dossier écarté dit donc POURQUOI, en code et en clair, et un dossier
-- peut cumuler plusieurs motifs.
--
-- CETTE FONCTION EXIGE SES TROIS DROITS ET REFUSE SANS EUX. La raison
-- est différente de celle d'un simple cloisonnement :
--
--   • sans `invoice.create`, la RLS masque `invoices`, donc le test
--     « ce chantier n'a pas encore de facture » devient VRAI POUR
--     TOUT LE MONDE. La fonction proposerait de refacturer ce qui l'est
--     déjà. Une réponse fausse, pas une réponse partielle ;
--   • sans `quotes.read`, aucun montant facturable n'est connu, et une
--     liste de dossiers sans montant ne se priorise pas ;
--   • sans `projects.read`, il n'y a pas de chantier à regarder.
--
-- DEUX FAMILLES DE LA SPEC N'EXISTENT PAS DANS CE MODÈLE DE DONNÉES :
-- les ACOMPTES et les SITUATIONS de travaux. Il n'y a ni échéancier de
-- paiement, ni facture de situation, ni type de facture. Elles sont
-- donc rendues avec `disponible: false` et la raison — surtout pas
-- avec un compte de zéro, qui se lirait « rien à faire » alors que la
-- vraie phrase est « le produit ne sait pas encore répondre ».

create or replace function public.ai_billing_candidates(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today      date;
  v_candidats  jsonb;
  v_resume     jsonb;
  v_retard     jsonb;
  v_retard_res jsonb;
begin
  perform public.ai_guard(p_organization_id, 'projects.read');
  perform public.ai_guard(p_organization_id, 'invoice.create');
  perform public.ai_guard(p_organization_id, 'quotes.read');

  v_today := (now() at time zone 'Europe/Paris')::date;

  with
  -- ---------- 1. Les chantiers terminés non facturés ----------
  chantiers as (
    select
      p.id, p.number, p.name, p.customer_id, p.status, p.actual_end_on,
      qt.total_excluding_vat_cents::bigint as montant_ht_cents,
      (select count(*) from public.time_entries te
        where te.project_id = p.id and te.organization_id = p_organization_id
          and te.kind = 'work' and not te.validated)::int as pointages_en_attente,
      (coalesce((select sum(c.total_cents) from public.project_costs c
                  where c.project_id = p.id and c.organization_id = p_organization_id), 0)
       + coalesce((select sum(te.total_cents) from public.time_entries te
                    where te.project_id = p.id and te.organization_id = p_organization_id
                      and te.validated and te.kind = 'work'), 0))::bigint as cout_reel_cents,
      (exists (select 1 from public.project_costs c
                where c.project_id = p.id and c.organization_id = p_organization_id)
       or exists (select 1 from public.time_entries te
                   where te.project_id = p.id and te.organization_id = p_organization_id
                     and te.validated and te.kind = 'work' and te.hours > 0)) as a_des_couts
    from public.projects p
    left join public.quote_totals qt on qt.quote_id = p.quote_id
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('completed', 'handedOver')
      -- Pas de facture rattachée au chantier…
      and not exists (
        select 1 from public.invoices i
        where i.project_id = p.id
          and i.organization_id = p_organization_id
          and i.archived_at is null and i.status <> 'cancelled')
      -- …ni au devis dont il est issu. Les deux chemins existent dans
      -- ce produit, et n'en tester qu'un ferait réapparaître un
      -- chantier déjà facturé par son devis.
      and not exists (
        select 1 from public.invoices i
        where p.quote_id is not null and i.quote_id = p.quote_id
          and i.organization_id = p_organization_id
          and i.archived_at is null and i.status <> 'cancelled')
  ),
  chantiers_motifs as (
    select c.*,
      (case when c.montant_ht_cents is null then
         jsonb_build_array(jsonb_build_object('code', 'devisAbsent', 'bloquant', true,
           'libelle', 'Aucun devis rattaché : le montant à facturer est inconnu.'))
       else '[]'::jsonb end)
      || (case when c.status = 'completed' then
         jsonb_build_array(jsonb_build_object('code', 'nonReceptionne', 'bloquant', false,
           'libelle', 'Chantier terminé mais pas encore réceptionné.'))
       else '[]'::jsonb end)
      || (case when c.pointages_en_attente > 0 then
         jsonb_build_array(jsonb_build_object('code', 'pointagesNonValides', 'bloquant', false,
           'libelle', c.pointages_en_attente || ' pointage(s) en attente de validation : le coût réel n''est pas arrêté.'))
       else '[]'::jsonb end)
      || (case when not c.a_des_couts then
         jsonb_build_array(jsonb_build_object('code', 'coutsNonSaisis', 'bloquant', false,
           'libelle', 'Aucun coût ni heure saisis sur ce chantier terminé.'))
       else '[]'::jsonb end)
      || (case when c.a_des_couts and c.montant_ht_cents is not null
                 and c.cout_reel_cents > c.montant_ht_cents then
         jsonb_build_array(jsonb_build_object('code', 'depassementCout', 'bloquant', false,
           'libelle', 'Le coût réel dépasse le montant devisé.'))
       else '[]'::jsonb end) as motifs
    from chantiers c
  ),
  -- ---------- 2. Les interventions clôturées ----------
  -- Seulement celles SANS chantier : celles qui en ont un sont déjà
  -- représentées par leur chantier, et les compter deux fois
  -- gonflerait le total.
  --
  -- Aucun lien intervention → facture n'existe dans ce modèle. On ne
  -- peut donc pas affirmer qu'une intervention n'est pas facturée, ni
  -- chiffrer ce qu'elle vaut. Elles sortent à vérifier, sans montant.
  interventions as (
    select fi.id, fi.title, fi.customer_id, fi.kind,
           coalesce(fi.actual_end, fi.scheduled_end) as fin
    from public.field_interventions fi
    where fi.organization_id = p_organization_id
      and fi.status = 'done'
      and fi.project_id is null
      and fi.customer_id is not null
      and coalesce(fi.actual_end, fi.scheduled_end) >= (v_today - 365)
  ),
  -- ---------- 3. Les devis acceptés sans facture ----------
  devis as (
    select q.id, q.number, q.title, q.customer_id, q.decided_at,
           qt.total_excluding_vat_cents::bigint as montant_ht_cents,
           exists (select 1 from public.projects pr
                    where pr.quote_id = q.id and pr.organization_id = p_organization_id
                      and pr.archived_at is null and pr.status <> 'cancelled') as a_un_chantier
    from public.quotes q
    join public.quote_totals qt on qt.quote_id = q.id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.status = 'accepted'
      and not exists (
        select 1 from public.invoices i
        where i.quote_id = q.id and i.organization_id = p_organization_id
          and i.archived_at is null and i.status <> 'cancelled')
      -- Le chantier terminé issu de ce devis est déjà dans la première
      -- famille : on ne le compte pas deux fois.
      and not exists (
        select 1 from public.projects pr
        where pr.quote_id = q.id and pr.organization_id = p_organization_id
          and pr.archived_at is null and pr.status in ('completed', 'handedOver'))
  ),
  tout as (
    select
      'chantierTermine' as famille,
      c.id as entite_id, 'project' as entite_type,
      coalesce(c.number || ' — ', '') || c.name as libelle,
      c.montant_ht_cents,
      c.actual_end_on::timestamptz as reference_le,
      c.customer_id,
      c.motifs
    from chantiers_motifs c
    union all
    select
      'interventionCloturee', i.id, 'field_intervention',
      i.title, null::bigint, i.fin, i.customer_id,
      jsonb_build_array(jsonb_build_object('code', 'montantInconnu', 'bloquant', false,
        'libelle', 'Aucun lien intervention → facture dans le modèle : le montant et le statut de facturation sont à vérifier à la main.'))
    from interventions i
    union all
    select
      'devisAccepteSansFacture', d.id, 'quote',
      coalesce(d.number || ' — ', '') || coalesce(d.title, 'Devis'),
      d.montant_ht_cents, d.decided_at, d.customer_id,
      case when d.a_un_chantier then
        jsonb_build_array(jsonb_build_object('code', 'chantierEnCours', 'bloquant', false,
          'libelle', 'Le chantier issu de ce devis n''est pas terminé : facturer maintenant serait une situation ou un acompte.'))
      else
        jsonb_build_array(jsonb_build_object('code', 'aucunChantier', 'bloquant', false,
          'libelle', 'Devis signé sans chantier ouvert : vérifier que la prestation a bien été réalisée.'))
      end
    from devis d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'famille', t.famille,
    'entiteType', t.entite_type,
    'entiteId', t.entite_id,
    'libelle', t.libelle,
    'client', cu.display_name,
    'referenceLe', t.reference_le,
    -- NULL quand le montant est inconnu. Jamais zéro : « on ne sait pas
    -- combien » et « ça ne vaut rien » ne se trient pas pareil.
    'montantFacturableHtCents', t.montant_ht_cents,
    'statut', case
      when exists (select 1 from jsonb_array_elements(t.motifs) m
                    where (m.value ->> 'bloquant')::boolean) then 'bloque'
      when jsonb_array_length(t.motifs) > 0 then 'aVerifier'
      else 'pret' end,
    'motifs', t.motifs)
    order by t.montant_ht_cents desc nulls last), '[]'::jsonb)
    into v_candidats
  from tout t
  left join public.crm_customers cu
         on cu.id = t.customer_id and cu.organization_id = p_organization_id;

  -- LE PARTAGE, calculé sur la liste elle-même pour qu'il ne puisse pas
  -- diverger d'elle.
  select jsonb_build_object(
    'total', count(*)::int,
    'prets', count(*) filter (where e ->> 'statut' = 'pret')::int,
    'aVerifier', count(*) filter (where e ->> 'statut' = 'aVerifier')::int,
    'bloques', count(*) filter (where e ->> 'statut' = 'bloque')::int,
    'montantPretHtCents',
      coalesce(sum((e ->> 'montantFacturableHtCents')::bigint)
               filter (where e ->> 'statut' = 'pret'), 0)::bigint,
    'montantAVerifierHtCents',
      coalesce(sum((e ->> 'montantFacturableHtCents')::bigint)
               filter (where e ->> 'statut' = 'aVerifier'), 0)::bigint,
    -- Combien de dossiers n'ont AUCUN montant. Sans ce compte, un total
    -- de 38 450 € laisserait croire qu'il couvre les dix dossiers.
    'dossiersSansMontant',
      count(*) filter (where e -> 'montantFacturableHtCents' = 'null'::jsonb)::int)
    into v_resume
  from jsonb_array_elements(v_candidats) e;

  -- ---------- 4. Les factures en retard ----------
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'factureId', i.id, 'numero', i.number,
      'client', cu.display_name,
      'echeance', i.due_on,
      'joursDeRetard', (v_today - i.due_on),
      'resteDuTtcCents', b.outstanding_cents)
      order by b.outstanding_cents desc), '[]'::jsonb),
    jsonb_build_object(
      'nombre', count(*)::int,
      'resteDuTtcCents', coalesce(sum(b.outstanding_cents), 0)::bigint)
    into v_retard, v_retard_res
  from public.invoices i
  join public.invoice_balance b on b.invoice_id = i.id
  left join public.crm_customers cu on cu.id = i.customer_id and cu.organization_id = p_organization_id
  where i.organization_id = p_organization_id
    and i.archived_at is null
    and i.issued_at is not null
    and i.status <> 'cancelled'
    and i.due_on is not null
    and i.due_on < v_today
    and b.outstanding_cents > 0;

  return jsonb_build_object(
    'agent', 'billing',
    'organisationId', p_organization_id,
    'aujourdhuiParis', v_today,
    'resume', v_resume,
    'candidats', v_candidats,
    'facturesEnRetard', jsonb_build_object('resume', v_retard_res, 'lignes', v_retard),

    -- CE QUE LE PRODUIT NE SAIT PAS ENCORE VOIR. Dit, plutôt que
    -- compté à zéro.
    'nonCouvert', jsonb_build_object(
      'acomptes', jsonb_build_object(
        'disponible', false, 'motif', 'modeleDeDonneesAbsent',
        'explication', 'Aucun échéancier de paiement n''existe dans ce produit : un acompte dû ne peut pas être détecté.'),
      'situations', jsonb_build_object(
        'disponible', false, 'motif', 'modeleDeDonneesAbsent',
        'explication', 'Aucun type de facture ni avancement facturable : une situation de travaux ne peut pas être détectée.')),

    'confiance', case
      when (v_resume ->> 'total')::int = 0 then 'insufficient_data'
      when (v_resume ->> 'dossiersSansMontant')::int > 0 then 'medium'
      else 'high' end,

    'actionsDisponibles', jsonb_build_array('createInvoiceDraft')
  );
end;
$$;

comment on function public.ai_billing_candidates(uuid) is
  'Billing Agent : ce qui attend d''être facturé, réparti en prêt / à vérifier / bloqué, chaque dossier disant pourquoi il ne l''est pas.';

-- ============================================================
-- 5. QUOTE PRICING AGENT — les comparables internes
-- ============================================================
-- Spec p. 14 : « Votre prix : 17 800 €. Vos 12 projets internes
-- comparables : 12 500 – 15 200 € », suivi immédiatement de
-- « NE PAS dire automatiquement : Vous êtes trop cher, sans données
-- solides. »
--
-- SOUS LE SEUIL, LA FOURCHETTE N'EST PAS RENDUE. Pas rendue large, pas
-- rendue avec un avertissement : pas rendue. Deux chantiers ne font pas
-- un marché, et une fourchette calculée sur deux points a l'air d'une
-- fourchette. Le seuil est de cinq, il figure dans la réponse
-- (`seuilComparables`), et en dessous la réponse est
-- `insufficientData` avec le nombre réellement trouvé — ce qui est une
-- information utile : « je n'ai que deux chantiers semblables ».
--
-- COMPARABLE SUR LE PÉRIMÈTRE, PAS SUR LE PRIX. C'est le point
-- méthodologique de cette fonction. Sélectionner les comparables dans
-- une bande de prix autour du devis étudié, puis comparer ce devis à
-- la fourchette obtenue, serait circulaire : on choisirait la réponse
-- avant de poser la question. Le périmètre est donc mesuré par les
-- HEURES DE MAIN-D'ŒUVRE DEVISÉES — la seule grandeur physique
-- disponible sur un devis de ce produit — et par la famille de
-- prestation dominante. Le prix ne sert jamais à filtrer.
--
-- Sans heures de main-d'œuvre devisées, le périmètre est inconnu : la
-- fonction rend `insufficientData` plutôt que de comparer un jardin de
-- 300 m² à une taille de haie.

create or replace function public.ai_quote_comparables(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c_seuil    constant int := 5;
  c_bande    constant numeric := 0.4;   -- ±40 % d'heures
  c_mois     constant int := 36;

  v_org      uuid;
  v_today    date;
  v_heures   numeric;
  v_famille  text;
  v_prix     bigint;
  v_projets  boolean;
  v_nb       int := 0;
  v_motif    text;

  v_min      bigint;
  v_q1       bigint;
  v_mediane  bigint;
  v_q3       bigint;
  v_max      bigint;
  v_marge_med numeric;
  v_nb_couts int;
  v_liste    jsonb := '[]'::jsonb;
  v_ech      jsonb := '[]'::jsonb;
begin
  -- L'ORGANISATION VIENT DE LA LIGNE, jamais d'un paramètre. Si la RLS
  -- masque le devis, il est « introuvable » : la réponse est la même
  -- pour un devis inexistant et pour celui du voisin, ce qui est
  -- exactement ce qu'on veut.
  select q.organization_id into v_org
  from public.quotes q where q.id = p_quote_id;

  if v_org is null then
    raise exception 'Devis introuvable ou inaccessible.';
  end if;

  v_today   := (now() at time zone 'Europe/Paris')::date;
  v_projets := public.has_permission(v_org, 'projects.read');

  select qt.total_excluding_vat_cents into v_prix
  from public.quote_totals qt where qt.quote_id = p_quote_id;

  -- Le périmètre du devis étudié : ses heures de main-d'œuvre.
  select sum(l.quantity) filter (where public.ai_cost_family(l.cost_kind, ci.item_type) = 'labor')
    into v_heures
  from public.quote_lines l
  left join public.catalog_items ci
         on ci.id = l.catalog_item_id and ci.organization_id = v_org
  where l.quote_id = p_quote_id and l.organization_id = v_org;

  -- Sa famille dominante, EN MONTANT DE VENTE : en nombre de lignes, un
  -- terrassement à 40 000 € perdrait contre trois plantes à 200 €.
  select public.ai_cost_family(l.cost_kind, ci.item_type) into v_famille
  from public.quote_lines l
  left join public.catalog_items ci
         on ci.id = l.catalog_item_id and ci.organization_id = v_org
  where l.quote_id = p_quote_id and l.organization_id = v_org
  group by public.ai_cost_family(l.cost_kind, ci.item_type)
  order by sum(l.sale_total_cents) desc nulls last
  limit 1;

  if not v_projets then
    v_motif := 'droitManquant';
  elsif v_heures is null or v_heures <= 0 then
    v_motif := 'perimetreInconnu';
  end if;

  if v_motif is null then
    -- Les devis des chantiers terminés, avec leur périmètre et leur
    -- famille dominante. On ne descend pas sous 36 mois : un prix de
    -- 2019 n'est pas un comparable de 2026 (spec p. 37, freshness).
    with candidats as (
      select p.id as project_id, p.number, p.name, p.actual_end_on,
             q2.id as quote_id,
             qt.total_excluding_vat_cents::bigint as vendu_ht_cents,
             (coalesce((select sum(c.total_cents) from public.project_costs c
                         where c.project_id = p.id and c.organization_id = v_org), 0)
              + coalesce((select sum(te.total_cents) from public.time_entries te
                           where te.project_id = p.id and te.organization_id = v_org
                             and te.validated and te.kind = 'work'), 0))::bigint as cout_reel_cents,
             (exists (select 1 from public.project_costs c
                       where c.project_id = p.id and c.organization_id = v_org)
              or exists (select 1 from public.time_entries te
                          where te.project_id = p.id and te.organization_id = v_org
                            and te.validated and te.kind = 'work' and te.hours > 0)) as a_des_couts
      from public.projects p
      join public.quotes q2 on q2.id = p.quote_id and q2.organization_id = v_org
      join public.quote_totals qt on qt.quote_id = q2.id
      where p.organization_id = v_org
        and p.archived_at is null
        and p.status in ('completed', 'handedOver')
        and p.actual_end_on is not null
        and p.actual_end_on >= (v_today - (c_mois || ' months')::interval)::date
        and q2.id <> p_quote_id
        and qt.total_excluding_vat_cents > 0
    ),
    perimetre as (
      select l.quote_id,
             sum(l.quantity) filter (where public.ai_cost_family(l.cost_kind, ci.item_type) = 'labor') as heures,
             (array_agg(public.ai_cost_family(l.cost_kind, ci.item_type)
                        order by l.sale_total_cents desc nulls last))[1] as famille
      from public.quote_lines l
      left join public.catalog_items ci
             on ci.id = l.catalog_item_id and ci.organization_id = v_org
      where l.organization_id = v_org
        and l.quote_id in (select quote_id from candidats)
      group by l.quote_id
    ),
    retenus as (
      select c.*, pe.heures
      from candidats c
      join perimetre pe on pe.quote_id = c.quote_id
      where pe.famille = v_famille
        and pe.heures is not null
        and pe.heures between v_heures * (1 - c_bande) and v_heures * (1 + c_bande)
    )
    select
      count(*)::int,
      min(r.vendu_ht_cents)::bigint,
      percentile_cont(0.25) within group (order by r.vendu_ht_cents)::bigint,
      percentile_cont(0.50) within group (order by r.vendu_ht_cents)::bigint,
      percentile_cont(0.75) within group (order by r.vendu_ht_cents)::bigint,
      max(r.vendu_ht_cents)::bigint,
      -- La marge RÉELLE médiane des comparables : ce que ces chantiers
      -- ont vraiment rapporté, et non ce qu'ils promettaient. Rendue
      -- NULL si aucun d'eux n'a de coût saisi.
      percentile_cont(0.50) within group (
        order by public.margin_percent(r.cout_reel_cents, r.vendu_ht_cents))
        filter (where r.a_des_couts),
      count(*) filter (where r.a_des_couts)::int,
      coalesce(jsonb_agg(jsonb_build_object(
        'projetId', r.project_id, 'numero', r.number, 'nom', r.name,
        'termineLe', r.actual_end_on,
        'venduHtCents', r.vendu_ht_cents,
        'heuresDevisees', r.heures,
        'tauxMarqueReelPct', case when r.a_des_couts
          then public.margin_percent(r.cout_reel_cents, r.vendu_ht_cents) end)
        order by r.actual_end_on desc), '[]'::jsonb)
      into v_nb, v_min, v_q1, v_mediane, v_q3, v_max, v_marge_med, v_nb_couts, v_liste
    from retenus r;

    if v_nb < c_seuil then
      v_motif := 'tropPeuDeComparables';
    else
      -- L'échantillon n'est rendu QUE lorsque le seuil est atteint :
      -- trois lignes affichées se lisent comme une fourchette.
      select coalesce(jsonb_agg(x.value), '[]'::jsonb) into v_ech
      from (select value from jsonb_array_elements(v_liste) limit 10) x;
    end if;
  end if;

  return jsonb_build_object(
    'agent', 'quote_pricing',
    'devisId', p_quote_id,
    'organisationId', v_org,
    'prixProposeHtCents', v_prix,
    'perimetre', jsonb_build_object(
      'heuresMainDoeuvreDevisees', v_heures,
      'familleDominante', v_famille,
      'bandeHeuresPct', (c_bande * 100)::int,
      'ancienneteMaximaleMois', c_mois),
    'seuilComparables', c_seuil,
    'nombreComparables', v_nb,
    'confiance', case
      when v_motif is not null then 'insufficient_data'
      when v_nb >= 12 then 'high'
      when v_nb >= 8 then 'medium'
      else 'low' end,
    'motifInsuffisance', v_motif,
    'explicationInsuffisance', case v_motif
      when 'droitManquant' then 'Sans le droit projects.read, les chantiers comparables sont invisibles : aucune fourchette ne peut être établie.'
      when 'perimetreInconnu' then 'Ce devis ne chiffre aucune heure de main-d''œuvre : son périmètre est inconnu, et comparer des prix sans comparer des périmètres n''a pas de sens.'
      when 'tropPeuDeComparables' then 'Moins de ' || c_seuil || ' chantiers comparables terminés : une fourchette calculée sur si peu de points en aurait l''apparence sans en avoir la valeur.'
      end,
    -- LA FOURCHETTE, ou rien. Jamais une fourchette de secours.
    'fourchette', case when v_motif is null then jsonb_build_object(
      'minHtCents', v_min,
      'q1HtCents', v_q1,
      'medianeHtCents', v_mediane,
      'q3HtCents', v_q3,
      'maxHtCents', v_max,
      'tauxMarqueReelMedianPct', v_marge_med,
      'comparablesAvecCoutsReels', v_nb_couts) end,
    'echantillon', v_ech);
end;
$$;

comment on function public.ai_quote_comparables(uuid) is
  'Quote Pricing Agent : les chantiers internes comparables d''un devis, à périmètre d''heures égal. Sous cinq comparables, aucune fourchette n''est rendue.';

-- ============================================================
-- 6. QUOTE PRICING AGENT — l'analyse de prix
-- ============================================================
-- Spec p. 13 : « Prix proposé 11 400 € / Coût estimé 8 900 € / Marge
-- 21,9 % / Marge cible entreprise 35 % → ⚠ Prix potentiellement
-- insuffisant. »
--
-- LE PIÈGE DE CE DEVIS-LÀ EST LE COÛT. `quote_lines.unit_cost_cents`
-- est NOT NULL DEFAULT 0 : un devis dont personne n'a saisi les coûts
-- ne se présente pas comme « coût inconnu » mais comme « coût nul »,
-- c'est-à-dire comme une marge de 100 %. L'agent féliciterait
-- l'entreprise pour le devis le plus dangereux de son portefeuille.
-- On ne retient donc un coût que s'il existe AU MOINS UNE ligne au
-- coût unitaire strictement positif ; sinon `coutEstimeCents` est
-- `null` et le verdict est `insufficientData`. Le nombre de lignes
-- sans coût est rendu à part, parce qu'un devis à moitié chiffré donne
-- une marge à moitié fausse.
--
-- TROIS VERDICTS, PAS UN. Le verdict global de la spec cache deux
-- questions indépendantes : « ce prix couvre-t-il mes coûts et mon
-- objectif ? » (interne, solide, ne dépend que de moi) et « ce prix
-- ressemble-t-il à ce que je facture d'habitude ? » (comparatif,
-- fragile, dépend d'un historique). Les mélanger produirait un
-- « correct » qui veut dire deux choses. La réponse porte donc
-- `verdictMarge`, `verdictComparables`, et le `verdict` global qui en
-- découle — dans cet ordre de priorité : un prix qui ne couvre pas la
-- cible est insuffisant même s'il est dans la fourchette.
--
-- LE DÉPLACEMENT N'EST PAS CALCULÉ ICI. Étape 12 de la spec, traitée
-- côté web par un service qui sait interroger un distancier. Cette
-- fonction EXPOSE ce dont il aura besoin — l'adresse du siège, celle
-- du chantier, les heures et les lignes de transport déjà devisées,
-- la durée prévue — et n'estime ni distance, ni temps, ni péage.

create or replace function public.ai_quote_price_analysis(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org         uuid;
  v_today       date;
  v_prix        bigint;
  v_cout        bigint;
  v_lignes      int;
  v_lignes_sans int;
  v_taux        numeric;
  v_cible       numeric;
  v_comp        jsonb;
  v_v_marge     text;
  v_v_comp      text;
  v_verdict     text;
  v_confiance   text;
  v_dep         jsonb;
  v_q           record;
begin
  select q.organization_id, q.number, q.title, q.status, q.customer_id, q.site_id,
         q.issued_on, q.valid_until, q.sent_at, q.decided_at
    into v_q
  from public.quotes q where q.id = p_quote_id;

  if v_q.organization_id is null then
    raise exception 'Devis introuvable ou inaccessible.';
  end if;
  v_org   := v_q.organization_id;
  v_today := (now() at time zone 'Europe/Paris')::date;

  select qt.total_excluding_vat_cents into v_prix
  from public.quote_totals qt where qt.quote_id = p_quote_id;

  -- LE COÛT, ET SEULEMENT S'IL A ÉTÉ SAISI.
  select
    count(*)::int,
    count(*) filter (where l.unit_cost_cents = 0)::int,
    case when count(*) filter (where l.unit_cost_cents > 0) > 0
         then sum(l.cost_total_cents)::bigint end
    into v_lignes, v_lignes_sans, v_cout
  from public.quote_lines l
  where l.quote_id = p_quote_id and l.organization_id = v_org;

  -- `ai_margin_pct` et non `margin_percent` : sans coût saisi, le taux
  -- est INCONNU, pas de 100 %.
  v_taux := public.ai_margin_pct(v_cout, v_prix);
  v_cible := public.ai_margin_target_pct(v_org);
  v_comp  := public.ai_quote_comparables(p_quote_id);

  -- ---------- Le verdict de marge ----------
  v_v_marge := case
    when v_prix is null or v_prix <= 0 then 'insufficientData'
    when v_cout is null then 'insufficientData'
    when v_cible is null then 'cibleNonDefinie'
    when v_taux < v_cible then 'insuffisant'
    else 'conforme'
  end;

  -- ---------- Le verdict des comparables ----------
  -- « Significativement au-dessus » se juge contre le MAXIMUM observé,
  -- pas contre le troisième quartile : au-dessus du Q3 se trouve un
  -- devis sur quatre par construction, et alerter sur un quart du
  -- portefeuille n'alerte sur rien.
  v_v_comp := case
    when v_comp ->> 'motifInsuffisance' is not null then 'insufficientData'
    when v_prix is null or v_prix <= 0 then 'insufficientData'
    when v_prix > (v_comp -> 'fourchette' ->> 'maxHtCents')::bigint then 'auDessus'
    when v_prix < (v_comp -> 'fourchette' ->> 'minHtCents')::bigint then 'enDessous'
    else 'dansLaFourchette'
  end;

  -- ---------- Le verdict global ----------
  -- L'ordre compte : un prix qui ne couvre pas la cible est insuffisant
  -- même s'il est dans la fourchette. Perdre de l'argent au tarif
  -- habituel reste perdre de l'argent.
  v_verdict := case
    when v_v_marge = 'insufficientData' then 'insufficientData'
    when v_v_marge = 'insuffisant' then 'insuffisant'
    when v_v_comp = 'auDessus' then 'auDessusDesComparables'
    -- « CORRECT » VEUT DIRE « CONFORME À VOTRE OBJECTIF ». Sans
    -- objectif, il n'y a rien à quoi être conforme, et répondre
    -- « correct » ferait passer une absence de règle pour une
    -- validation. Sur les données réelles d'aujourd'hui, où aucune
    -- cible n'est fixée, c'est le cas de TOUS les devis.
    when v_v_marge = 'cibleNonDefinie' then 'cibleNonDefinie'
    else 'correct'
  end;

  v_confiance := case
    when v_verdict = 'insufficientData' then 'insufficient_data'
    when v_lignes_sans > 0 then 'low'         -- devis à moitié chiffré
    when v_cible is null then 'medium'
    when v_comp ->> 'motifInsuffisance' is not null then 'medium'
    else 'high'
  end;

  -- ---------- Ce dont le calcul de déplacement aura besoin ----------
  select jsonb_build_object(
    'calculeParUnAutreAgent', true,
    'siege', jsonb_build_object(
      'adresse', o.address_line1, 'codePostal', o.postal_code, 'ville', o.city),
    'chantier', jsonb_build_object(
      'adresse', coalesce(si.address_line1, cu.billing_address_line1),
      'codePostal', coalesce(si.postal_code, cu.billing_postal_code),
      'ville', coalesce(si.city, cu.billing_city),
      'latitude', si.latitude, 'longitude', si.longitude,
      'notesAcces', si.access_notes),
    'heuresMainDoeuvreDevisees', v_comp -> 'perimetre' -> 'heuresMainDoeuvreDevisees',
    'lignesTransportDevisees', (
      select jsonb_build_object(
        'nombre', count(*)::int,
        'montantHtCents', coalesce(sum(l.sale_total_cents), 0)::bigint,
        'quantiteCumulee', sum(l.quantity))
      from public.quote_lines l
      left join public.catalog_items ci
             on ci.id = l.catalog_item_id and ci.organization_id = v_org
      where l.quote_id = p_quote_id and l.organization_id = v_org
        and public.ai_cost_family(l.cost_kind, ci.item_type) = 'transport'),
    'dureeChantierJours', (
      select (pr.planned_end_on - pr.planned_start_on) + 1
      from public.projects pr
      where pr.quote_id = p_quote_id and pr.organization_id = v_org
        and pr.archived_at is null
        and pr.planned_start_on is not null and pr.planned_end_on is not null
      order by pr.created_at limit 1),
    -- CE QUE LE MODÈLE NE SAIT PAS. Ni l'effectif affecté, ni le nombre
    -- de trajets ne sont saisis nulle part ; les estimer ici, c'est
    -- inventer le chiffre que la spec interdit d'inventer.
    'effectifPrevu', null,
    'nombreDeTrajets', null,
    'note', 'Effectif et nombre de trajets ne sont pas modélisés : ils doivent être fournis par l''appelant, pas déduits ici.')
    into v_dep
  from public.business_organizations o
  left join public.crm_customer_sites si on si.id = v_q.site_id and si.organization_id = v_org
  left join public.crm_customers cu on cu.id = v_q.customer_id and cu.organization_id = v_org
  where o.id = v_org;

  return jsonb_build_object(
    'agent', 'quote_pricing',
    'devisId', p_quote_id,
    'organisationId', v_org,
    'devis', jsonb_build_object(
      'numero', v_q.number, 'titre', v_q.title, 'statut', v_q.status,
      'emisLe', v_q.issued_on, 'valableJusquAu', v_q.valid_until),

    'prixProposeHtCents', v_prix,
    'coutEstimeCents', v_cout,
    'margeCents', case when v_prix is not null and v_cout is not null then v_prix - v_cout end,
    'tauxMarquePct', v_taux,
    'margeCiblePct', v_cible,
    'ecartALaCiblePoints', case when v_taux is not null and v_cible is not null
                                then round(v_taux - v_cible, 2) end,
    'manqueAGagnerCents', case
      when v_taux is not null and v_cible is not null and v_taux < v_cible and v_prix is not null
      then round(v_prix * (v_cible - v_taux) / 100.0)::bigint end,

    -- LE COÛT EST-IL CELUI DU DEVIS, OU CELUI D'UN MORCEAU DE DEVIS ?
    -- Sur les données réelles d'aujourd'hui, treize lignes sur quatorze
    -- n'ont aucun coût saisi : la marge affichée décrit alors la
    -- quatorzième. Le drapeau existe pour que l'écran puisse le dire au
    -- lieu de laisser lire 39 % comme un fait.
    'lignes', jsonb_build_object(
      'total', v_lignes,
      'sansCoutSaisi', v_lignes_sans,
      'coutPartiel', (v_cout is not null and v_lignes_sans > 0)),

    'verdictMarge', v_v_marge,
    'verdictComparables', v_v_comp,
    'verdict', v_verdict,
    'confiance', v_confiance,

    'comparables', v_comp,
    'deplacement', v_dep,

    -- L'EXPLICATION EXIGIBLE (spec p. 33) : données observées,
    -- comparaison, hypothèses, conclusion, confiance.
    'explication', jsonb_build_object(
      'donneesObservees', jsonb_build_object(
        'lignesDuDevis', v_lignes,
        'lignesSansCoutSaisi', v_lignes_sans,
        'chantiersComparables', v_comp -> 'nombreComparables'),
      'comparaison', case
        when v_v_comp = 'insufficientData'
          then 'Aucune comparaison de marché : ' || coalesce(v_comp ->> 'explicationInsuffisance', 'données insuffisantes')
        else 'Prix comparé à la fourchette de ' || (v_comp ->> 'nombreComparables') ||
             ' chantiers internes de périmètre équivalent.' end,
      'hypotheses', jsonb_build_array(
        'Le coût estimé est celui saisi sur les lignes du devis, pas un coût de revient recalculé.',
        'Le déplacement n''est pas inclus dans le coût estimé : il est chiffré par un autre agent.',
        'La marge est un TAUX DE MARQUE, rapporté au prix de vente — convention du paysage en France.'),
      'conclusion', (case v_verdict
        when 'insuffisant' then 'Ce prix ne couvre pas l''objectif de marge de l''entreprise.'
        when 'auDessusDesComparables' then 'Ce devis se situe au-dessus de tous les chantiers comparables : vérifier le niveau de prestation, la complexité, l''accès et le niveau de finition.'
        when 'cibleNonDefinie' then 'Aucun objectif de marge n''est fixé pour aujourd''hui : ce prix ne peut être jugé conforme à rien. Fixer une cible dans les objectifs de l''entreprise.'
        when 'correct' then 'Ce prix couvre l''objectif de marge et reste cohérent avec les chantiers comparables.'
        else 'Données insuffisantes pour se prononcer sur ce prix.' end)
        || (case when v_cout is not null and v_lignes_sans > 0
             then ' Attention : ' || v_lignes_sans || ' ligne(s) sur ' || v_lignes ||
                  ' ne portent aucun coût — la marge ci-dessus ne décrit que les autres.'
             else '' end),
      'confiance', v_confiance),

    'actionsDisponibles', case
      when v_verdict in ('insuffisant', 'auDessusDesComparables')
      then jsonb_build_array('adjustQuotePricing') else jsonb_build_array() end);
end;
$$;

comment on function public.ai_quote_price_analysis(uuid) is
  'Quote Pricing Agent : prix, coût, marge et cible d''un devis, avec un verdict de marge et un verdict de comparables tenus séparés.';

-- ============================================================
-- 7. EXECUTIVE AGENT — les cinq actions prioritaires
-- ============================================================
-- Spec p. 4-5. « OASIS EXECUTIVE BRIEF, 5 actions prioritaires :
-- 1. Facturer 10 chantiers terminés — impact 38 450 € HT ; 2. Relancer
-- 4 devis — valeur 17 800 € ; … » Il répond à « Que dois-je faire
-- aujourd'hui ? », « Qu'est-ce qui menace ma marge ? », « Où est-ce que
-- je perds de l'argent ? ».
--
-- IL N'A AUCUNE DONNÉE À LUI. Il agrège Finance, Billing et
-- QuotePricing, et rien d'autre : chaque ligne du brief porte le nom de
-- l'agent qui l'a produite et les données qu'il a lues. C'est ce qui
-- rend le « Pourquoi ? » de la page 6 vérifiable plutôt que
-- vraisemblable.
--
-- IL DÉGRADE, IL N'EXPLOSE PAS. Contrairement à `ai_billing_candidates`
-- qui refuse de répondre sans ses trois droits, le brief doit rester
-- utile pour un commercial : il VÉRIFIE les droits avant d'appeler
-- chaque source, saute les blocs qu'il ne peut pas lire, et les nomme
-- dans `droitsManquants`. Un brief amputé qui le dit vaut mieux qu'une
-- erreur, parce qu'il reste une réponse à « que dois-je faire
-- aujourd'hui ».
--
-- LE CLASSEMENT EST DÉTERMINISTE, ET IL EST DISCUTABLE — c'est
-- pourquoi il est écrit. Chaque candidat porte un impact en euros ; on
-- le multiplie par le poids de sa catégorie (l'urgent passe devant
-- l'optimisation à montant égal) puis par celui des objectifs
-- d'entreprise activés (spec p. 44-45 : « L'Executive Agent adapte ses
-- recommandations »). Le score obtenu est RENDU avec la ligne : un
-- classement qu'on ne peut pas contester est un classement qu'on ne
-- peut pas corriger.
--
-- UN CANDIDAT SANS IMPACT CHIFFRABLE N'EST PAS UN CANDIDAT À ZÉRO. Il
-- passe après ceux qui sont chiffrés, mais il passe — et son impact
-- reste `null`, pas 0.

create or replace function public.ai_executive_brief(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today     date;
  v_money     boolean;
  v_quotes    boolean;
  v_manque    text[] := array[]::text[];
  v_goals     text[];
  v_items     jsonb := '[]'::jsonb;
  v_billing   jsonb;
  v_cible     numeric;
  v_top       jsonb;

  v_nb        int;
  v_cents     bigint;
  v_taux      numeric;
begin
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_today  := (now() at time zone 'Europe/Paris')::date;
  v_money  := public.has_permission(p_organization_id, 'invoice.create');
  v_quotes := public.has_permission(p_organization_id, 'quotes.read');
  v_cible  := public.ai_margin_target_pct(p_organization_id);

  if not v_money  then v_manque := v_manque || 'invoice.create'::text; end if;
  if not v_quotes then v_manque := v_manque || 'quotes.read'::text;    end if;

  select coalesce(array_agg(g.goal order by g.priority), array[]::text[])
    into v_goals
  from public.business_goals g
  where g.organization_id = p_organization_id and g.enabled;

  -- ---------- 1. Les chantiers prêts à facturer ----------
  if v_money and v_quotes then
    v_billing := public.ai_billing_candidates(p_organization_id);

    if (v_billing -> 'resume' ->> 'prets')::int > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'agent', 'billing', 'categorie', 'urgent',
        'titre', 'Facturer ' || (v_billing -> 'resume' ->> 'prets') || ' dossier(s) prêt(s)',
        'impactCents', (v_billing -> 'resume' ->> 'montantPretHtCents')::bigint,
        'impactTexte', 'Chiffre d''affaires HT immédiatement facturable',
        'confiance', v_billing ->> 'confiance',
        'pourquoi', (v_billing -> 'resume' ->> 'prets') || ' dossier(s) terminé(s), sans facture, sans réserve détectée.',
        'siRienNestFait', 'Le chiffre d''affaires reste hors des comptes et la trésorerie n''entre pas.',
        'donneesUtilisees', jsonb_build_array('projects', 'quotes', 'invoices', 'time_entries', 'project_costs'),
        'actionRecommandee', 'Créer les brouillons de facture puis les relire.',
        'actionsDisponibles', jsonb_build_array('createInvoiceDraft')));
    end if;

    if (v_billing -> 'resume' ->> 'aVerifier')::int > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'agent', 'billing', 'categorie', 'important',
        'titre', 'Vérifier ' || (v_billing -> 'resume' ->> 'aVerifier') || ' dossier(s) facturable(s) sous réserve',
        'impactCents', (v_billing -> 'resume' ->> 'montantAVerifierHtCents')::bigint,
        'impactTexte', 'Chiffre d''affaires HT facturable après vérification',
        'confiance', 'medium',
        'pourquoi', 'Pointages non validés, réception manquante ou dépassement de coût : le montant n''est pas arrêté.',
        'siRienNestFait', 'Ces chantiers vieillissent et leurs coûts deviennent plus difficiles à reconstituer.',
        'donneesUtilisees', jsonb_build_array('projects', 'quotes', 'time_entries', 'project_costs'),
        'actionRecommandee', 'Lever les réserves dossier par dossier avant de facturer.',
        'actionsDisponibles', jsonb_build_array()));
    end if;

    if (v_billing -> 'facturesEnRetard' -> 'resume' ->> 'nombre')::int > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'agent', 'finance', 'categorie', 'urgent',
        'titre', 'Relancer ' || (v_billing -> 'facturesEnRetard' -> 'resume' ->> 'nombre') || ' facture(s) en retard',
        'impactCents', (v_billing -> 'facturesEnRetard' -> 'resume' ->> 'resteDuTtcCents')::bigint,
        'impactTexte', 'Encours TTC échu',
        'confiance', 'high',
        'pourquoi', 'Factures émises, échéance dépassée, solde non réglé.',
        'siRienNestFait', 'Le poste client s''alourdit et le risque d''impayé augmente avec l''ancienneté.',
        'donneesUtilisees', jsonb_build_array('invoices', 'payment_allocations', 'credit_notes'),
        'actionRecommandee', 'Relancer les clients concernés, du plus ancien au plus récent.',
        'actionsDisponibles', jsonb_build_array()));
    end if;
  end if;

  -- ---------- 2. Les devis sans réponse ----------
  if v_quotes then
    select count(*)::int, coalesce(sum(qt.total_excluding_vat_cents), 0)::bigint
      into v_nb, v_cents
    from public.quotes q
    join public.quote_totals qt on qt.quote_id = q.id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.status in ('sent', 'viewed')
      and q.sent_at is not null
      and q.sent_at < now() - interval '7 days';

    if v_nb > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'agent', 'quote_pricing', 'categorie', 'opportunite',
        'titre', 'Relancer ' || v_nb || ' devis sans réponse',
        'impactCents', v_cents,
        'impactTexte', 'Valeur HT des devis en attente depuis plus de sept jours',
        'confiance', 'high',
        'pourquoi', 'Devis envoyés ou vus, sans décision depuis plus de sept jours.',
        'siRienNestFait', 'Un devis non relancé expire ; le client a souvent déjà signé ailleurs.',
        'donneesUtilisees', jsonb_build_array('quotes', 'quote_lines'),
        'actionRecommandee', 'Relancer, en commençant par les montants les plus élevés.',
        'actionsDisponibles', jsonb_build_array('quoteFollowUp')));
    end if;

    -- ---------- 3. Les devis qui expirent ----------
    select count(*)::int, coalesce(sum(qt.total_excluding_vat_cents), 0)::bigint
      into v_nb, v_cents
    from public.quotes q
    join public.quote_totals qt on qt.quote_id = q.id
    where q.organization_id = p_organization_id
      and q.archived_at is null
      and q.status in ('sent', 'viewed')
      and q.valid_until between v_today and v_today + 7;

    if v_nb > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'agent', 'quote_pricing', 'categorie', 'urgent',
        'titre', v_nb || ' devis expire(nt) sous sept jours',
        'impactCents', v_cents,
        'impactTexte', 'Valeur HT qui sort du pipeline si rien n''est fait',
        'confiance', 'high',
        'pourquoi', 'La date de validité tombe dans les sept jours.',
        'siRienNestFait', 'Le devis devient caduc : il faudra le refaire, au tarif du jour.',
        'donneesUtilisees', jsonb_build_array('quotes', 'quote_lines'),
        'actionRecommandee', 'Relancer ou prolonger la validité avant l''échéance.',
        'actionsDisponibles', jsonb_build_array('quoteFollowUp')));
    end if;

    -- ---------- 4. Les devis sous la marge cible ----------
    -- Seulement si une cible existe. Sans cible, « sous la marge » ne
    -- veut rien dire, et inventer 35 % serait inventer un objectif.
    if v_cible is not null then
      with chiffres as (
        select q.id,
               qt.total_excluding_vat_cents::bigint as prix,
               -- Le coût n'existe que si quelqu'un l'a saisi : voir
               -- `ai_margin_pct` et le DEFAULT 0 de `unit_cost_cents`.
               case when exists (select 1 from public.quote_lines l
                                  where l.quote_id = q.id and l.organization_id = p_organization_id
                                    and l.unit_cost_cents > 0)
                    then qt.total_cost_cents::bigint end as cout
        from public.quotes q
        join public.quote_totals qt on qt.quote_id = q.id
        where q.organization_id = p_organization_id
          and q.archived_at is null
          and q.status in ('draft', 'internalReview', 'sent', 'viewed')
      ),
      taux as (
        select prix, cout, public.ai_margin_pct(cout, prix) as pct from chiffres
      )
      select count(*)::int,
             coalesce(sum(round(prix * (v_cible - pct) / 100.0)), 0)::bigint
        into v_nb, v_cents
      from taux
      where pct is not null and prix > 0 and pct < v_cible;

      if v_nb > 0 then
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'agent', 'quote_pricing', 'categorie', 'optimisation',
          'titre', 'Revoir le prix de ' || v_nb || ' devis sous l''objectif de marge',
          'impactCents', v_cents,
          'impactTexte', 'Manque à gagner HT pour atteindre l''objectif de ' || v_cible || ' %',
          'confiance', 'medium',
          'pourquoi', 'Le taux de marque de ces devis est inférieur à l''objectif de l''entreprise.',
          'siRienNestFait', 'Chaque devis signé à ce prix consomme de la capacité sans financer la structure.',
          'donneesUtilisees', jsonb_build_array('quotes', 'quote_lines', 'organization_kpi_targets'),
          'actionRecommandee', 'Analyser chaque devis avant envoi et ajuster le prix ou le périmètre.',
          'actionsDisponibles', jsonb_build_array('adjustQuotePricing')));
      end if;

      -- ---------- 5. La marge réalisée sous la cible ----------
      -- Trois mois glissants : un mois isolé bouge trop pour être un
      -- signal.
      with finis as (
        select qt.total_excluding_vat_cents::bigint as vendu,
               (coalesce((select sum(c.total_cents) from public.project_costs c
                           where c.project_id = p.id and c.organization_id = p_organization_id), 0)
                + coalesce((select sum(te.total_cents) from public.time_entries te
                             where te.project_id = p.id and te.organization_id = p_organization_id
                               and te.validated and te.kind = 'work'), 0))::bigint as cout,
               (exists (select 1 from public.project_costs c
                         where c.project_id = p.id and c.organization_id = p_organization_id)
                or exists (select 1 from public.time_entries te
                            where te.project_id = p.id and te.organization_id = p_organization_id
                              and te.validated and te.kind = 'work' and te.hours > 0)) as a_couts
        from public.projects p
        join public.quote_totals qt on qt.quote_id = p.quote_id
        where p.organization_id = p_organization_id
          and p.archived_at is null
          and p.status in ('completed', 'handedOver')
          and p.actual_end_on >= v_today - 90
      )
      select
        count(*) filter (where a_couts)::int,
        public.margin_percent((sum(cout) filter (where a_couts))::bigint,
                              (sum(vendu) filter (where a_couts))::bigint),
        -- Le manque à gagner : ce que ces chantiers auraient rapporté
        -- de plus au taux cible. Un écart en points ne se lit pas ;
        -- des euros, si.
        coalesce(round((sum(vendu) filter (where a_couts)) * v_cible / 100.0)
                 - (sum(vendu - cout) filter (where a_couts)), 0)::bigint
        into v_nb, v_taux, v_cents
      from finis;

      if v_nb > 0 and v_taux is not null and v_taux < v_cible then
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'agent', 'finance', 'categorie', 'important',
          'titre', 'Marge réalisée à ' || v_taux || ' % contre ' || v_cible || ' % visés',
          'impactCents', v_cents,
          'impactTexte', 'Écart de marge sur les chantiers terminés des 90 derniers jours',
          'confiance', case when v_nb >= 5 then 'high' when v_nb >= 3 then 'medium' else 'low' end,
          'pourquoi', v_nb || ' chantier(s) terminé(s) avec coûts saisis, taux de marque global sous l''objectif.',
          'siRienNestFait', 'L''écart se reproduit sur les chantiers suivants, qui sont déjà devisés.',
          'donneesUtilisees', jsonb_build_array('projects', 'quotes', 'project_costs', 'time_entries', 'organization_kpi_targets'),
          'actionRecommandee', 'Ouvrir l''analyse de marge par famille de coût pour identifier la cause.',
          'actionsDisponibles', jsonb_build_array()));
      end if;
    end if;
  end if;

  -- ---------- LE CLASSEMENT ----------
  select coalesce(jsonb_agg(x.ligne order by x.score desc nulls last, x.ligne ->> 'titre'), '[]'::jsonb)
    into v_top
  from (
    select
      e.value as ligne,
      -- Poids de catégorie, puis poids des objectifs d'entreprise.
      (e.value ->> 'impactCents')::numeric
      * case e.value ->> 'categorie'
          when 'urgent' then 1.30 when 'important' then 1.15
          when 'opportunite' then 1.00 when 'optimisation' then 0.90
          else 0.50 end
      * case
          when 'improve_cashflow' = any (v_goals) and e.value ->> 'agent' in ('billing', 'finance') then 1.25
          when 'increase_margin'  = any (v_goals) and e.value ->> 'categorie' = 'optimisation' then 1.25
          when 'increase_revenue' = any (v_goals) and e.value ->> 'categorie' = 'opportunite' then 1.25
          else 1.00 end as score
    from jsonb_array_elements(v_items) e
  ) x;

  return jsonb_build_object(
    'agent', 'executive',
    'organisationId', p_organization_id,
    'aujourdhuiParis', v_today,
    'droitsManquants', to_jsonb(v_manque),
    'objectifsActifs', to_jsonb(v_goals),
    'margeCiblePct', v_cible,
    'candidatsAnalyses', jsonb_array_length(v_items),
    'actionsPrioritaires', (select coalesce(jsonb_agg(y.value), '[]'::jsonb)
                            from (select value from jsonb_array_elements(v_top) limit 5) y),
    'confiance', case
      when cardinality(v_manque) > 0 then 'low'
      when jsonb_array_length(v_items) = 0 then 'insufficient_data'
      else 'high' end,
    'note', case when cardinality(v_manque) > 0
      then 'Brief partiel : les droits ' || array_to_string(v_manque, ', ') ||
           ' manquent, les recommandations correspondantes sont absentes — pas nulles, absentes.'
      end);
end;
$$;

comment on function public.ai_executive_brief(uuid) is
  'Executive Agent : les cinq actions prioritaires, agrégées depuis Finance, Billing et QuotePricing, chacune avec son impact chiffré et son « si rien n''est fait ».';

-- ============================================================
-- 8. OASIS DAILY — le briefing du matin
-- ============================================================
-- Spec p. 27 : « BONJOUR. Voici les priorités Oasis pour aujourd'hui.
-- URGENT : 10 chantiers à facturer, 38 450 €. COMMERCIAL : 4 devis à
-- relancer, 17 800 €. PLANNING : équipe B sous-utilisée vendredi… »
-- C'est aussi le critère de validation du MVP (p. 49) : « Je dois
-- pouvoir ouvrir Oasis Care Pro le matin et voir OASIS DAILY avec de
-- vraies recommandations basées sur les données. »
--
-- CETTE FONCTION NE REFAIT RIEN. Elle COMPOSE, et c'est délibéré :
--
--   • `ai_get_daily_priorities` (0058) tient déjà les interventions du
--     jour, les devis à relancer, les devis qui expirent, les factures
--     en retard, les chantiers en retard, les pointages à valider et
--     les réceptions attendues. Elle a surtout été CORRIGÉE en 0066
--     pour que « aujourd'hui » se compte à Paris et non à Greenwich —
--     entre minuit et deux heures du matin, l'ancienne version
--     affichait le planning de la veille. Réécrire ces sept requêtes
--     ici, c'est refaire le bug dans deux heures de la nuit.
--
--   • `ai_executive_brief` tient le classement et les montants.
--
-- Le rôle du Daily est de REGROUPER en rubriques, ce que ni l'une ni
-- l'autre ne fait. Une rubrique vide n'est pas rendue : « URGENT :
-- rien » occupe la place de ce qui compte.
--
-- LE FUSEAU N'EST PAS RECALCULÉ NON PLUS : la date affichée est celle
-- que `ai_get_daily_priorities` a calculée, pas une seconde opinion.

create or replace function public.ai_oasis_daily(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_prio      jsonb;
  v_brief     jsonb;
  v_rub       jsonb := '[]'::jsonb;
  v_urgent    jsonb := '[]'::jsonb;
  v_commerce  jsonb := '[]'::jsonb;
  v_planning  jsonb := '[]'::jsonb;
  v_finance   jsonb := '[]'::jsonb;
  v_info      jsonb := '[]'::jsonb;
  v_n         int;
  v_money     boolean;
  v_quotes    boolean;
  v_manque    text[] := array[]::text[];
begin
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_money  := public.has_permission(p_organization_id, 'invoice.create');
  v_quotes := public.has_permission(p_organization_id, 'quotes.read');
  if not v_money  then v_manque := v_manque || 'invoice.create'::text; end if;
  if not v_quotes then v_manque := v_manque || 'quotes.read'::text;    end if;

  v_prio  := public.ai_get_daily_priorities(p_organization_id);
  v_brief := public.ai_executive_brief(p_organization_id);

  -- ---------- URGENT ----------
  -- Les lignes du brief classées « urgent » gardent leur montant et
  -- leur explication : le Daily n'est qu'une mise en pages.
  select coalesce(jsonb_agg(e.value), '[]'::jsonb) into v_urgent
  from jsonb_array_elements(v_brief -> 'actionsPrioritaires') e
  where e.value ->> 'categorie' = 'urgent';

  v_n := jsonb_array_length(coalesce(v_prio -> 'chantiersEnRetard', '[]'::jsonb));
  if v_n > 0 then
    v_urgent := v_urgent || jsonb_build_array(jsonb_build_object(
      'agent', 'executive', 'categorie', 'urgent',
      'titre', v_n || ' chantier(s) en retard sur la date de fin prévue',
      'impactCents', null,
      'impactTexte', 'Impact non chiffrable : un retard de chantier ne se convertit pas en euros sans hypothèse.',
      'confiance', 'high',
      'detail', v_prio -> 'chantiersEnRetard'));
  end if;

  -- ---------- COMMERCIAL ----------
  select coalesce(jsonb_agg(e.value), '[]'::jsonb) into v_commerce
  from jsonb_array_elements(v_brief -> 'actionsPrioritaires') e
  where e.value ->> 'agent' = 'quote_pricing'
    and e.value ->> 'categorie' <> 'urgent';

  v_n := jsonb_array_length(coalesce(v_prio -> 'devisQuiExpirent', '[]'::jsonb));
  if v_n > 0 then
    v_commerce := v_commerce || jsonb_build_array(jsonb_build_object(
      'agent', 'quote_pricing', 'categorie', 'urgent',
      'titre', v_n || ' devis arrive(nt) à échéance sous sept jours',
      'confiance', 'high',
      'detail', v_prio -> 'devisQuiExpirent'));
  end if;

  -- ---------- PLANNING ----------
  v_n := jsonb_array_length(coalesce(v_prio -> 'interventionsDuJour', '[]'::jsonb));
  if v_n > 0 then
    v_planning := v_planning || jsonb_build_array(jsonb_build_object(
      'agent', 'executive', 'categorie', 'information',
      'titre', v_n || ' intervention(s) prévue(s) aujourd''hui',
      'confiance', 'high',
      'detail', v_prio -> 'interventionsDuJour'));
  end if;

  if coalesce((v_prio -> 'pointagesAValider' ->> 'nombre')::int, 0) > 0 then
    v_planning := v_planning || jsonb_build_array(jsonb_build_object(
      'agent', 'billing', 'categorie', 'important',
      'titre', (v_prio -> 'pointagesAValider' ->> 'nombre') || ' pointage(s) à valider ('
               || coalesce(v_prio -> 'pointagesAValider' ->> 'heures', '0') || ' h)',
      'confiance', 'high',
      'pourquoi', 'Un pointage non validé n''entre dans aucun coût de chantier : la marge affichée est incomplète tant qu''il reste en attente.',
      'detail', v_prio -> 'pointagesAValider'));
  end if;

  v_n := jsonb_array_length(coalesce(v_prio -> 'receptionsAttendues', '[]'::jsonb));
  if v_n > 0 then
    v_planning := v_planning || jsonb_build_array(jsonb_build_object(
      'agent', 'executive', 'categorie', 'information',
      'titre', v_n || ' réception(s) fournisseur attendue(s)',
      'confiance', 'high',
      'detail', v_prio -> 'receptionsAttendues'));
  end if;

  -- ---------- FINANCE ----------
  select coalesce(jsonb_agg(e.value), '[]'::jsonb) into v_finance
  from jsonb_array_elements(v_brief -> 'actionsPrioritaires') e
  where e.value ->> 'agent' = 'finance'
    and e.value ->> 'categorie' <> 'urgent';

  -- ---------- INFORMATION ----------
  -- Les décisions déjà ouvertes par les agents et jamais tranchées.
  -- Elles ne sont pas des recommandations neuves : elles disent que le
  -- Decision Center a du retard.
  select count(*)::int into v_n
  from public.ai_decisions d
  where d.organization_id = p_organization_id
    and d.status in ('new', 'reviewed');

  if v_n > 0 then
    v_info := v_info || jsonb_build_array(jsonb_build_object(
      'agent', 'executive', 'categorie', 'information',
      'titre', v_n || ' décision(s) Oasis en attente de réponse',
      'confiance', 'high',
      'impactCents', (select sum(d.financial_impact_cents)
                      from public.ai_decisions d
                      where d.organization_id = p_organization_id
                        and d.status in ('new', 'reviewed')),
      'impactTexte', 'Somme des impacts CHIFFRÉS ; les décisions sans montant n''y figurent pas.'));
  end if;

  -- ---------- L'ASSEMBLAGE ----------
  -- Une rubrique vide ne s'affiche pas.
  if jsonb_array_length(v_urgent) > 0 then
    v_rub := v_rub || jsonb_build_array(jsonb_build_object(
      'code', 'URGENT', 'titre', 'Urgent', 'elements', v_urgent));
  end if;
  if jsonb_array_length(v_commerce) > 0 then
    v_rub := v_rub || jsonb_build_array(jsonb_build_object(
      'code', 'COMMERCIAL', 'titre', 'Commercial', 'elements', v_commerce));
  end if;
  if jsonb_array_length(v_planning) > 0 then
    v_rub := v_rub || jsonb_build_array(jsonb_build_object(
      'code', 'PLANNING', 'titre', 'Planning', 'elements', v_planning));
  end if;
  if jsonb_array_length(v_finance) > 0 then
    v_rub := v_rub || jsonb_build_array(jsonb_build_object(
      'code', 'FINANCE', 'titre', 'Finance', 'elements', v_finance));
  end if;
  if jsonb_array_length(v_info) > 0 then
    v_rub := v_rub || jsonb_build_array(jsonb_build_object(
      'code', 'INFORMATION', 'titre', 'Information', 'elements', v_info));
  end if;

  return jsonb_build_object(
    'agent', 'executive',
    'organisationId', p_organization_id,
    -- La date vient de `ai_get_daily_priorities` : un seul repère, et
    -- c'est celui qui a été corrigé pour le fuseau de Paris.
    'date', v_prio -> 'date',
    'salutation', 'Bonjour',
    'droitsManquants', to_jsonb(v_manque),
    'rubriques', v_rub,
    'confiance', case
      when cardinality(v_manque) > 0 then 'low'
      when jsonb_array_length(v_rub) = 0 then 'insufficient_data'
      else 'high' end,
    'note', case when jsonb_array_length(v_rub) = 0
      then 'Rien à signaler ce matin sur le périmètre lisible par ce compte.' end,
    'sources', jsonb_build_object(
      'prioritesDuJour', v_prio,
      'briefExecutif', v_brief));
end;
$$;

comment on function public.ai_oasis_daily(uuid) is
  'Oasis Daily : le briefing du matin, groupé par rubrique. Compose ai_get_daily_priorities (fuseau Europe/Paris de 0066) et ai_executive_brief ; ne recalcule ni l''un ni l''autre.';

-- ============================================================
-- 9. CE QUI N'EST PAS DANS CE FICHIER, ET POURQUOI
-- ============================================================
-- Ce bloc n'exécute rien. Il est là pour la prochaine personne, qui
-- voudra ajouter quelque chose et a le droit de savoir ce qui a été
-- pesé.
--
--   LA PRÉVISION DE CHIFFRE D'AFFAIRES (spec p. 19 : « Prévision
--   51 800 €, écart probable −3 200 € »)
--       Une prévision est une estimation, et la page 2 interdit
--       d'inventer un chiffre d'affaires. Le socle donne de quoi la
--       construire honnêtement — pipeline, carnet de commandes,
--       objectifs — mais l'extrapolation elle-même demande un modèle
--       explicite (taux de transformation historique, saisonnalité)
--       que ce produit n'a pas encore. Rendre un chiffre sans ce
--       modèle serait le présenter comme une mesure.
--
--   LES ACOMPTES ET LES SITUATIONS DE TRAVAUX
--       Il n'existe ni échéancier de paiement, ni type de facture, ni
--       avancement facturable dans ce modèle de données.
--       `ai_billing_candidates` le DIT (`nonCouvert`) au lieu de
--       compter zéro. Les ouvrir demande des tables, pas des requêtes.
--
--   LE COÛT DE DÉPLACEMENT
--       Étape 12 de la spec, et un autre agent, côté web : il faut un
--       distancier. `ai_quote_price_analysis` expose le siège, le
--       chantier, les heures et les lignes de transport devisées, et
--       laisse `effectifPrevu` et `nombreDeTrajets` à `null` — ces
--       deux-là ne sont saisis nulle part, et les déduire serait
--       inventer.
--
--   LES NEUF AUTRES AGENTS
--       Sales, Operations, Planning, Procurement, Nursery, Fleet,
--       Customer, Market, Risk : hors périmètre de la première
--       itération (spec p. 49). `ai_is_supported_agent` (0072) refuse
--       leurs noms, et aucune fonction d'ici ne les nomme.
--
--   L'OUVERTURE AUTOMATIQUE DE DÉCISIONS
--       Ces sept fonctions LISENT. Aucune n'appelle `ai_open_decision`,
--       aucune n'écrit une ligne. Le balayage qui transformera un
--       constat en décision est un travail à part, et il devra
--       s'exécuter avec les droits d'un utilisateur réel — pas avec
--       ceux d'un `security definer` de confort.
--
--   UN CACHE
--       `ai_executive_brief` appelle `ai_billing_candidates`, et
--       `ai_oasis_daily` appelle les deux. Sur un portefeuille de
--       plusieurs milliers de chantiers, cela se verra. La réponse
--       n'est pas un cache posé maintenant à l'aveugle : c'est une
--       mesure, puis un index, puis éventuellement une table de
--       résultats datée. Un cache non daté sur des chiffres financiers
--       est une façon d'afficher hier en croyant afficher aujourd'hui.
