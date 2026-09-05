-- Oasis Care — §11Y, LA VALEUR D'UN CLIENT, POUR L'AGENT CLIENTS.
--
-- ============================================================
-- CE FICHIER N'EST PAS UNE MIGRATION. IL EST À COLLER DANS 0082
-- ============================================================
--
-- `supabase/migrations/0082_agents_ia.sql` appartient à l'intégration :
-- plusieurs agents y ajoutent leur nom à `ai_is_supported_agent`, et
-- une seule main peut y écrire à la fois. Le corps de la fonction vit
-- donc chez son agent — `runtime/outils/` — jusqu'à ce que
-- l'intégration le recopie dans 0082, TEL QUEL.
--
-- Éprouvée sur la production dans une transaction annulée : voir
-- `customer.epreuve.sql`, qui a sa place dans
-- `supabase/tests/agents_ia.sql`.
--
--   node runsql.js .sb_token customer.sql customer.epreuve.sql
--
-- ============================================================
-- POURQUOI CETTE FONCTION, ALORS QUE `ai_get_client_context` EXISTE
-- ============================================================
--
-- `ai_get_client_context` (0058) est déjà déclarée sous
-- `getClientContext`, transverse (`agent: null`), et l'agent Clients la
-- reçoit sans une ligne de code. Elle rend l'identité, les propriétés,
-- les devis, les chantiers, les dernières activités — et, côté argent,
-- UNIQUEMENT LES FACTURES IMPAYÉES.
--
-- C'est ce « uniquement » qui rend cette fonction-ci nécessaire, et la
-- raison n'est pas le confort : sans elle, la seule manière pour l'agent
-- de répondre « combien ce client m'a-t-il rapporté » serait
-- D'ADDITIONNER LES IMPAYÉS et d'appeler cela un chiffre d'affaires.
-- Deux fautes en une — une addition faite par le modèle (interdite
-- p. 11-12 : « total facture » est une grandeur déterministe), et un
-- total qui décrit ce qu'on n'a PAS encaissé présenté comme ce qu'on a
-- gagné.
--
-- Rien nulle part ne totalise ce qu'un client a rapporté. La seule vue
-- par client qui soit exacte, `ai_finance_margin_breakdown` en dimension
-- « client », appartient à l'agent Finance : `pourAgent` ne la donne pas
-- à celui-ci, et la lui donner ferait deux sources pour un même chiffre.
--
-- ============================================================
-- LE PIÈGE QUI DOMINE CETTE FONCTION : TROIS DROITS, PAS UN
-- ============================================================
--
-- Vérifié dans `pg_policies`, et c'est le fait le plus important de ce
-- fichier — les tables que cette fonction traverse ne sont PAS sous le
-- même droit :
--
--   crm_customers, crm_customer_sites ....... clients.read
--   quotes .................................. quotes.read
--   invoices, payments, payment_allocations,
--   credit_notes ............................ invoice.create
--   projects ................................ projects.read
--
-- En `security invoker`, un utilisateur qui n'a que `clients.read`
-- obtiendrait donc : le client trouvé, ZÉRO devis, ZÉRO facture, ZÉRO
-- euro. Tout serait vrai au sens du SQL et faux au sens de la question.
-- C'est LA classe de bug que ce dépôt a déjà nommée — « RLS grant
-- tables » — et la confusion zéro / je-ne-sais-pas corrigée quatre fois.
--
-- La fonction interroge donc `has_permission` AVANT chaque bloc, rend
-- `null` sur le bloc entier quand le droit manque, et NOMME le droit
-- dans `droitsManquants`. C'est la manière de `ai_finance_snapshot`
-- (0073), reprise à l'identique plutôt que réinventée.
--
-- Seul `clients.read` passe par `ai_guard`, donc LÈVE : sans lui il n'y
-- a pas de client du tout, et il n'y a rien à rendre partiellement.
--
-- ============================================================
-- CE QUE CETTE FONCTION NE RENDRA JAMAIS, ET CE N'EST PAS UN OUBLI
-- ============================================================
--
--   • AUCUNE SATISFACTION. Balayage de `information_schema` : aucune
--     table de note, d'avis, d'enquête, de réclamation ni de ticket,
--     et aucune colonne non plus, dans tout le schéma. Ce n'est pas une
--     table vide, c'est une fonctionnalité ABSENTE du produit. Le plus
--     proche — `field_interventions.signed_at` — est un accusé de
--     réalisation, pas un contentement, et les convertir serait
--     l'invention que la p. 12 interdit.
--
--   • AUCUN RISQUE DE DÉPART. Trois manques cumulés : pas de contrat
--     récurrent ni d'abonnement client dans le modèle, `converted_at`
--     souvent vide donc ancienneté inconnue, et aucun outil ne balaie le
--     portefeuille par récence. Un score serait un chiffre inventé.
--
--   • AUCUNE PHRASE DE PORTEFEUILLE. Cette fonction prend UN
--     identifiant. Il n'existe aucun `listAllCustomers`, délibérément
--     (`context.ts` : « jamais toute la base »), et la base compte
--     aujourd'hui UN client — un classement serait une ligne.
--
-- Le bloc `nonMesurable` porte ces refus DANS LA DONNÉE, à côté des
-- chiffres qu'ils nuancent, plutôt que dans une instruction qui se
-- dilue au fil d'un long contexte.
--
-- ============================================================
-- L'ORGANISATION VIENT DE LA LIGNE, PAS D'UN PARAMÈTRE
-- ============================================================
--
-- Pas de `p_organization_id` : la règle n° 1 de 0073. L'organisation est
-- RELUE sur la ligne du client, comme `ai_quote_price_analysis` la relit
-- sur celle du devis. On ne peut pas se tromper d'entreprise sur un
-- paramètre qui n'existe pas, et le modèle n'a aucun moyen d'en nommer
-- une autre. La RLS a déjà filtré : un client d'une autre entreprise
-- ressort introuvable, et le message n'en dit pas plus.

create or replace function public.ai_customer_value(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org      uuid;
  v_c        record;
  v_today    date;
  v_manque   text[] := array[]::text[];

  v_money    bool;
  v_quotes   bool;
  v_projects bool;

  -- Les devis.
  v_dev_nb        int;
  v_dev_ht        bigint;
  v_dev_acc_nb    int;
  v_dev_acc_ht    bigint;
  v_dev_att_nb    int;
  v_dev_att_ht    bigint;
  v_dev_premier   date;
  v_dev_dernier   date;

  -- Les factures.
  v_fac_nb        int;
  v_fac_brouillon int;
  v_fac_ht        bigint;
  v_fac_ttc       bigint;
  v_fac_premiere  date;
  v_fac_derniere  date;

  -- L'argent reçu.
  v_encaisse   bigint;
  v_lettre     bigint;
  v_avoirs     bigint;
  v_reste      bigint;
  v_retard     bigint;
  v_retard_nb  int;

  -- Les chantiers.
  v_ch_nb        int;
  v_ch_termines  int;
  v_ch_encours   int;
  v_ch_dernier   date;

  v_a_des_donnees bool;
begin
  -- L'ORGANISATION EST RELUE SUR LA LIGNE. La RLS a déjà filtré : un
  -- client d'une autre entreprise ressort ici avec un `organization_id`
  -- nul, et le message ne dit rien de plus qu'« introuvable » — ne pas
  -- distinguer « n'existe pas » de « pas le droit » est délibéré, sans
  -- quoi la fonction confirmerait l'existence d'un client concurrent.
  select c.organization_id, c.display_name, c.kind, c.lifecycle_stage,
         c.billing_city, c.converted_at, c.archived_at
    into v_c
  from public.crm_customers c
  where c.id = p_customer_id;

  if v_c.organization_id is null then
    raise exception 'Client introuvable ou inaccessible.';
  end if;
  v_org   := v_c.organization_id;
  v_today := (now() at time zone 'Europe/Paris')::date;

  -- Le droit de base : sans lui il n'y a pas de client, donc rien à
  -- rendre partiellement. Il LÈVE.
  perform public.ai_guard(v_org, 'clients.read');

  -- Les trois autres ne lèvent pas : ils AMPUTENT, et se nomment.
  v_money    := public.has_permission(v_org, 'invoice.create');
  v_quotes   := public.has_permission(v_org, 'quotes.read');
  v_projects := public.has_permission(v_org, 'projects.read');

  if not v_money    then v_manque := v_manque || 'invoice.create'::text; end if;
  if not v_quotes   then v_manque := v_manque || 'quotes.read'::text;    end if;
  if not v_projects then v_manque := v_manque || 'projects.read'::text;  end if;

  -- ---------- LES DEVIS ----------
  -- `sum()` sans `coalesce` : sur zéro ligne il rend NULL, et NULL est
  -- la bonne réponse. Un `coalesce(..., 0)` écrirait « 0 € devisé » pour
  -- un client à qui on n'a jamais rien proposé — c'est la classe de bug
  -- « || 0 sur de l'argent » que ce dépôt a déjà nommée.
  if v_quotes then
    select
      count(*)::int,
      sum(t.total_excluding_vat_cents)::bigint,
      count(*) filter (where q.status = 'accepted')::int,
      sum(t.total_excluding_vat_cents) filter (where q.status = 'accepted')::bigint,
      count(*) filter (where q.status in ('sent', 'viewed'))::int,
      sum(t.total_excluding_vat_cents) filter (where q.status in ('sent', 'viewed'))::bigint,
      min(q.issued_on), max(q.issued_on)
      into v_dev_nb, v_dev_ht, v_dev_acc_nb, v_dev_acc_ht,
           v_dev_att_nb, v_dev_att_ht, v_dev_premier, v_dev_dernier
    from public.quotes q
    left join public.quote_totals t on t.quote_id = q.id
    where q.customer_id = p_customer_id and q.archived_at is null;
  end if;

  -- ---------- LES FACTURES ----------
  -- « ÉMISE » = `issued_at is not null`. C'est la règle de 0065 et de
  -- 0073, reprise à l'identique pour que ce chiffre soit LE MÊME que
  -- celui de l'écran Analytics : un brouillon n'a pas de numéro de
  -- séquence légale, donc la facture n'existe pas encore. Les brouillons
  -- sont COMPTÉS À PART plutôt que fondus ou tus — « trois factures
  -- prêtes et non émises » est une action à faire, pas un détail.
  if v_money then
    select
      count(*) filter (where i.issued_at is not null)::int,
      count(*) filter (where i.issued_at is null)::int,
      sum(t.total_excluding_vat_cents) filter (where i.issued_at is not null)::bigint,
      sum(t.total_including_vat_cents) filter (where i.issued_at is not null)::bigint,
      min(i.issued_on) filter (where i.issued_at is not null),
      max(i.issued_on) filter (where i.issued_at is not null)
      into v_fac_nb, v_fac_brouillon, v_fac_ht, v_fac_ttc, v_fac_premiere, v_fac_derniere
    from public.invoices i
    left join public.invoice_totals t on t.invoice_id = i.id
    where i.customer_id = p_customer_id and i.archived_at is null;

    -- L'ARGENT REÇU DU CLIENT, toutes affectations confondues.
    select sum(p.amount_cents)::bigint into v_encaisse
    from public.payments p
    where p.customer_id = p_customer_id;

    -- L'ARGENT RATTACHÉ À SES FACTURES. Les deux ne coïncident PAS
    -- toujours, et l'écart est une information plutôt qu'une erreur : un
    -- acompte reçu avant toute facture n'est lettré nulle part. Les
    -- confondre ferait dire « il n'a rien payé » d'un client dont
    -- l'argent est sur le compte.
    select sum(a.amount_cents)::bigint into v_lettre
    from public.payment_allocations a
    join public.invoices i on i.id = a.invoice_id
    where i.customer_id = p_customer_id and i.archived_at is null;

    select sum(b.credited_cents)::bigint into v_avoirs
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.customer_id = p_customer_id and i.archived_at is null
      and i.issued_at is not null;

    select
      sum(b.outstanding_cents)::bigint,
      sum(b.outstanding_cents) filter (where i.due_on < v_today)::bigint,
      count(*) filter (where i.due_on < v_today and b.outstanding_cents > 0)::int
      into v_reste, v_retard, v_retard_nb
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.customer_id = p_customer_id and i.archived_at is null
      and i.issued_at is not null and b.outstanding_cents > 0;
  end if;

  -- ---------- LES CHANTIERS ----------
  if v_projects then
    select
      count(*)::int,
      count(*) filter (where p.status in ('completed', 'handedOver'))::int,
      count(*) filter (where p.status in ('planned', 'inProgress', 'onHold'))::int,
      max(p.actual_end_on) filter (where p.status in ('completed', 'handedOver'))
      into v_ch_nb, v_ch_termines, v_ch_encours, v_ch_dernier
    from public.projects p
    where p.customer_id = p_customer_id and p.archived_at is null;
  end if;

  -- Une fiche amputée d'un de ses droits n'est pas une fiche « peu
  -- fiable » : c'est une fiche dont on ne sait pas ce qu'elle cache.
  v_a_des_donnees := coalesce(v_fac_ht, 0) <> 0
                     or coalesce(v_dev_ht, 0) <> 0
                     or coalesce(v_encaisse, 0) <> 0
                     or coalesce(v_ch_nb, 0) <> 0;

  return jsonb_build_object(
    'agent', 'customer',
    'clientId', p_customer_id,
    'aujourdhuiParis', v_today,
    'droitsManquants', to_jsonb(v_manque),

    'client', jsonb_build_object(
      'nom', v_c.display_name,
      'type', v_c.kind,
      'etape', v_c.lifecycle_stage,
      'ville', v_c.billing_city,
      'archive', v_c.archived_at is not null,
      'clientDepuis', v_c.converted_at,
      -- NULL, jamais zéro : `converted_at` n'est pas renseigné sur le
      -- seul client de la base, et « client depuis 0 jour » se lirait
      -- « nouveau client ». L'ancienneté est INCONNUE, pas nulle.
      'ancienneteJours', case
        when v_c.converted_at is null then null
        else (v_today - (v_c.converted_at at time zone 'Europe/Paris')::date)
      end,
      'ancienneteNote', case
        when v_c.converted_at is null
          then 'Date de début de relation non renseignée : l''ancienneté est INCONNUE. '
               || 'N''en déduis ni fidélité, ni nouveauté.'
      end),

    -- Chaque bloc vaut NULL en entier quand son droit manque. Un bloc
    -- rempli de zéros serait indiscernable d'un client sans activité.
    'devis', case when not v_quotes then null else jsonb_build_object(
      'nombre', v_dev_nb,
      'totalHTCents', v_dev_ht,
      'accepteNombre', v_dev_acc_nb,
      'accepteHTCents', v_dev_acc_ht,
      'enAttenteNombre', v_dev_att_nb,
      'enAttenteHTCents', v_dev_att_ht,
      'premierLe', v_dev_premier,
      'dernierLe', v_dev_dernier) end,

    'facturation', case when not v_money then null else jsonb_build_object(
      'nombreEmises', v_fac_nb,
      'brouillons', v_fac_brouillon,
      'totalHTCents', v_fac_ht,
      'totalTTCCents', v_fac_ttc,
      'premiereLe', v_fac_premiere,
      'derniereLe', v_fac_derniere) end,

    'reglement', case when not v_money then null else jsonb_build_object(
      'encaisseCents', v_encaisse,
      'lettreCents', v_lettre,
      -- L'écart entre l'argent reçu et l'argent rattaché à une facture.
      -- Calculé ici, en SQL, et NULL quand on n'a rien reçu — pas 0.
      'nonAffecteCents', case
        when v_encaisse is null then null
        else v_encaisse - coalesce(v_lettre, 0) end,
      'avoirsCents', v_avoirs,
      'resteDuCents', v_reste,
      'enRetardCents', v_retard,
      'enRetardNombre', v_retard_nb,
      'note', '« encaisseCents » est l''argent reçu du client ; « lettreCents » la part '
              || 'rattachée à ses factures. Un écart n''est pas une erreur : un acompte reçu '
              || 'avant toute facture n''est lettré nulle part.') end,

    'chantiers', case when not v_projects then null else jsonb_build_object(
      'nombre', v_ch_nb,
      'termines', v_ch_termines,
      'enCours', v_ch_encours,
      'dernierTermineLe', v_ch_dernier) end,

    -- LES QUATRE REFUS, PORTÉS PAR LA DONNÉE. Voir l'en-tête : ce ne
    -- sont pas des tables vides, ce sont des fonctionnalités absentes,
    -- et la nuance change la phrase que l'agent doit prononcer.
    'nonMesurable', jsonb_build_object(
      'satisfaction', 'Ce produit ne collecte AUCUN signal de satisfaction : ni note, ni avis, '
                      || 'ni enquête, ni réclamation, ni ticket — aucune table, aucune colonne. '
                      || 'Dis que la fonctionnalité n''existe pas, pas qu''elle est vide. '
                      || 'Une intervention signée est un accusé de réalisation, PAS un contentement.',
      'risqueDeDepart', 'Incalculable : aucun contrat récurrent ni abonnement dans le modèle, '
                        || 'ancienneté souvent inconnue, et aucun outil ne balaie le portefeuille '
                        || 'par récence. Ne produis aucun score.',
      'portefeuille', 'Cet outil regarde UN client. Aucun classement, aucune moyenne, aucune '
                      || 'concentration : il n''existe aucun outil qui parcoure la base clients.',
      'comportementDePaiement', 'Ne juge pas s''il est « bon payeur ». Rends les faits — facturé, '
                                || 'encaissé, en retard — et arrête-toi là : un verdict de '
                                || 'comportement demande un historique que cette base n''a pas.',
      'consultationDuPortail', 'Aucun accès au portail client n''est exploitable comme signal '
                               || 'd''engagement : le mécanisme existe mais n''est pas alimenté.'),

    'confiance', case
      when cardinality(v_manque) > 0 then 'insufficient_data'
      when not v_a_des_donnees       then 'insufficient_data'
      else 'high'   -- tout est lu dans des registres, rien n'est estimé
    end
  );
end;
$$;

comment on function public.ai_customer_value(uuid) is
  'Customer Agent : ce qu''UN client a été devisé, facturé et a réellement payé, en centimes entiers. Un droit manquant rend le bloc null et se nomme — jamais zéro.';
