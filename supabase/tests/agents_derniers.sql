-- Oasis Care — §11Z, L'ÉPREUVE DES QUATRE DERNIERS AGENTS (migration 0088).
--
-- ============================================================
-- UN SEUL BLOC, ET C'EST UNE CONTRAINTE DE HARNAIS, PAS UN GOÛT
-- ============================================================
--
-- Ce fichier est UNE SEULE transaction `begin; … rollback;`. Le
-- découper en plusieurs blocs, comme le fait `agents_ia.sql`, marche
-- quand la migration est déjà posée dans la base ; cela CASSE quand on
-- éprouve la migration en la jouant devant le test dans la même
-- transaction, parce que le premier `rollback` annulerait la migration
-- avant que les blocs suivants ne s'exécutent. Un seul bloc se rejoue
-- des deux façons :
--
--   node runsql.js .sb_token supabase/tests/agents_derniers.sql
--     (sur une base où 0088 est déjà appliquée)
--
--   node runsql.js .sb_token begin.sql 0088_agents_derniers.sql agents_derniers.sql
--     (pour éprouver la migration elle-même contre la production ;
--      le `rollback` final annule aussi la migration)
--
-- SANS EFFET DE BORD : tout est annulé, y compris les cinq comptes et
-- les deux entreprises.
--
-- ============================================================
-- CE QUE CETTE ÉPREUVE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. LES QUATRE CLÉS SONT ACCEPTÉES, ET AUCUNE AUTRE. Les dix
--      précédentes sont revérifiées une par une : une liste recopiée à
--      la main peut perdre une valeur en chemin, et personne ne s'en
--      apercevrait avant la prochaine écriture sur `ai_decisions` — au
--      moment où l'appel de modèle est déjà payé.
--
--   2. UN TAUX SUR UN ÉCHANTILLON TROP PETIT VAUT NULL, PAS UN
--      POURCENTAGE. C'est la raison d'être des trois fonctions. Deux
--      entreprises sont montées exprès : l'une franchit les seuils et
--      obtient ses chiffres, l'autre ne les franchit pas et obtient
--      NULL accompagné d'un motif en français. Un test qui ne
--      vérifierait que le cas riche laisserait passer une fonction qui
--      ne refuse jamais.
--
--   3. LE CLOISONNEMENT. L'entreprise B a ses propres devis, ses
--      propres clients, ses propres factures. Si un seul filtre
--      d'organisation manquait, ils se compteraient chez A. Et depuis
--      la peau de A, les trois fonctions appelées sur B sont refusées —
--      l'identifiant de B est pourtant connu de l'appelant.
--
--   4. UN DROIT MANQUANT REFUSE, IL NE REND PAS UNE VUE PARTIELLE.
--      Quatre comptes à droits réduits, un par droit exigé. Une vue
--      amputée serait une réponse fausse, pas une réponse incomplète —
--      c'est le défaut que ce produit a corrigé quatre fois.
--
--   5. « ZÉRO » N'EST JAMAIS RENDU POUR « RIEN N'A ÉTÉ SAISI ». Le
--      pipeline vide de B, son journal d'activités vide, ses chantiers
--      sans date de fin prévue : chacun rend un motif nommé.
--
--   6. SALES NE PRODUIT PAS UN SECOND CHIFFRE SUR LES DEVIS OUVERTS.
--      Les lignes qu'il rend sortent littéralement de
--      `ai_executive_brief`, et le test le vérifie en comparant les
--      deux — pas en lisant le commentaire.
--
--   7. LES TROIS FONCTIONS NE SONT PAS EXÉCUTABLES PAR `anon` NI PAR
--      `PUBLIC`. C'est le seul point où 0088 est plus strict que ses
--      prédécesseurs, et un test est le seul moyen de s'assurer que le
--      `revoke` a porté sur les DEUX (Supabase accorde `anon`
--      nommément, en plus du `PUBLIC` implicite).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

-- Calculé UNE FOIS, à Paris : un test qui recalcule « aujourd'hui » à
-- chaque ligne échoue une nuit sur deux entre minuit et deux heures.
insert into cfg values ('today', (now() at time zone 'Europe/Paris')::date);


-- ============================================================
-- 1. LES QUATORZE ACCEPTÉS, UN PAR UN — ET RIEN D'AUTRE
-- ============================================================
-- Nommés en toutes lettres et non lus depuis une liste : un test qui
-- lirait la même source que la fonction ne vérifierait que sa propre
-- cohérence.

insert into res values
  ('1a : executive accepté',      'true', public.ai_is_supported_agent('executive')::text),
  ('1b : finance accepté',        'true', public.ai_is_supported_agent('finance')::text),
  ('1c : billing accepté',        'true', public.ai_is_supported_agent('billing')::text),
  ('1d : quote_pricing accepté',  'true', public.ai_is_supported_agent('quote_pricing')::text),
  ('1e : operations accepté',     'true', public.ai_is_supported_agent('operations')::text),
  ('1f : planning accepté',       'true', public.ai_is_supported_agent('planning')::text),
  ('1g : procurement accepté',    'true', public.ai_is_supported_agent('procurement')::text),
  ('1h : nursery accepté',        'true', public.ai_is_supported_agent('nursery')::text),
  ('1i : fleet accepté',          'true', public.ai_is_supported_agent('fleet')::text),
  ('1j : customer accepté',       'true', public.ai_is_supported_agent('customer')::text),
  ('1k : sales accepté',          'true', public.ai_is_supported_agent('sales')::text),
  ('1l : market accepté',         'true', public.ai_is_supported_agent('market')::text),
  ('1m : risk accepté',           'true', public.ai_is_supported_agent('risk')::text),
  ('1n : classification accepté', 'true', public.ai_is_supported_agent('classification')::text);

-- LA GRAPHIE. Les quatre nouvelles clés s'écrivent identiquement en base
-- et en TypeScript (`AGENTS_MODELE`, web-pro/lib/ai/model/types.ts) —
-- contrairement à `quote_pricing`. Aucune variante ne doit passer : deux
-- graphies acceptées donneraient deux réglages d'autonomie au même
-- agent, et celui qui gagnerait dépendrait de qui a écrit en dernier.
insert into res values
  ('1o : quotePricing (camel) toujours refusé', 'false',
   public.ai_is_supported_agent('quotePricing')::text),
  ('1p : market_intelligence refusé (l''alias vit dans le routeur, pas en base)', 'false',
   public.ai_is_supported_agent('market_intelligence')::text),
  ('1q : Sales (capitale) refusé', 'false',
   public.ai_is_supported_agent('Sales')::text),
  ('1r : sales_agent refusé', 'false',
   public.ai_is_supported_agent('sales_agent')::text),
  ('1s : le vide est refusé', 'false',
   coalesce(public.ai_is_supported_agent('')::text, 'null')),
  ('1t : null ne rend pas true', 'false',
   coalesce(public.ai_is_supported_agent(null)::text, 'false')),
  ('1u : un agent inventé est refusé', 'false',
   public.ai_is_supported_agent('marketing')::text);


-- ============================================================
-- 2. LA CONTRAINTE MORD VRAIMENT — ON ÉCRIT
-- ============================================================
-- Une fonction juste ne prouve rien si les `check` ne l'appellent pas.
-- Et le cas de `classification` est LE gain concret de cette migration :
-- aujourd'hui le routeur lui attribue le niveau « economy » et
-- `ServicePreTraitement` dépense sous ce nom, pendant que
-- `ai_model_overrides` refuse qu'on lui épingle un modèle. Si cette
-- ligne-là échoue, la migration n'a servi à rien pour lui.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000088-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','derniers-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000088-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','derniers-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000088-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','derniers-c1@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000088-0000-4000-8000-0000000000c2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','derniers-c2@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000088-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','derniers-c3@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000088-0000-4000-8000-0000000000c4','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','derniers-c4@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000088-0000-4000-8000-0000000000a1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Derniers A','landscaper');

-- LE CONTRAT — sans lui, le péage (0092) refuse tout (voir 0092 § 5).
-- « created_at >= now() » : now() est l'heure de DÉBUT DE TRANSACTION et
-- la colonne a now() pour défaut, donc ce filtre ne prend QUE les
-- entreprises nées ici. Un jeu d'essai ne signe pas de contrat pour de
-- vrais clients.
insert into public.organization_subscriptions
  (organization_id, plan, status, provider, billing_cycle)
select o.id, 'business', 'active', 'manual', 'monthly'
  from public.business_organizations o
 where o.created_at >= now()
on conflict (organization_id) do nothing;


select set_config('request.jwt.claims',
  json_build_object('sub','b0000088-0000-4000-8000-0000000000b1')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Derniers B','landscaper');

-- LE CONTRAT — sans lui, le péage (0092) refuse tout (voir 0092 § 5).
-- « created_at >= now() » : now() est l'heure de DÉBUT DE TRANSACTION et
-- la colonne a now() pour défaut, donc ce filtre ne prend QUE les
-- entreprises nées ici. Un jeu d'essai ne signe pas de contrat pour de
-- vrais clients.
insert into public.organization_subscriptions
  (organization_id, plan, status, provider, billing_cycle)
select o.id, 'business', 'active', 'manual', 'monthly'
  from public.business_organizations o
 where o.created_at >= now()
on conflict (organization_id) do nothing;


do $$
declare
  v_org uuid := (select v from ids where k='orgA');
  v_sales boolean := false;
  v_class boolean := false;
  v_over  boolean := false;
  v_faux  boolean := false;
begin
  begin
    insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
    values (v_org, 'sales', true, 1);
    v_sales := true;
  exception when check_violation then v_sales := false;
  end;

  begin
    insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
    values (v_org, 'classification', true, 1);
    v_class := true;
  exception when check_violation then v_class := false;
  end;

  -- LE GESTE UTILE POUR CLASSIFICATION : pouvoir lui épingler un modèle,
  -- donc pouvoir plafonner ce qu'il coûte.
  begin
    insert into public.ai_model_overrides (organization_id, agent, model, reason)
    values (v_org, 'classification', 'test-modele', 'épreuve 0088');
    v_over := true;
  exception when check_violation then v_over := false;
  end;

  -- Et un nom inventé reste refusé PAR LA CONTRAINTE, pas par une
  -- convention de nommage ni par la bonne volonté de l'appelant.
  begin
    insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
    values (v_org, 'marketing', true, 1);
    v_faux := false;
  exception when check_violation then v_faux := true;
  end;

  insert into res values
    ('2a : sales entre dans ai_agent_settings',                    'true', v_sales::text),
    ('2b : classification entre dans ai_agent_settings',           'true', v_class::text),
    ('2c : classification devient épinglable dans ai_model_overrides', 'true', v_over::text),
    ('2d : un agent inventé reste refusé par le check',            'true', v_faux::text);
end $$;


-- ============================================================
-- 3. OUVRIR UN AGENT NE LUI OUVRE AUCUNE EXÉCUTION
-- ============================================================
-- Deux registres cohabitent : `ai_action_catalog` décide de ce qui peut
-- S'EXÉCUTER, `PROPOSAL_KINDS` (TypeScript) de ce qui peut être
-- PROPOSÉ. 0088 n'ajoute rien au premier. Les quatre nouveaux agents
-- peuvent lire ; aucun ne gagne le droit de faire partir quoi que ce
-- soit sans humain.

insert into res
select '3a : aucune action au catalogue pour les quatre nouveaux', '0', count(*)::text
from public.ai_action_catalog
where agent in ('sales', 'market', 'risk', 'classification');

insert into res
select '3b : la relance de devis appartient toujours au Chiffrage', 'quote_pricing',
       coalesce(string_agg(distinct agent, ','), '(aucune)')
from public.ai_action_catalog
where action_type = 'quoteFollowUp';


-- ============================================================
-- 4. LE DÉCOR
-- ============================================================
-- Deux entreprises, montées pour que les seuils tombent des DEUX côtés :
-- A les franchit et obtient ses chiffres, B ne les franchit pas et doit
-- obtenir NULL. Un test qui n'éprouverait que A laisserait passer une
-- fonction qui ne refuse jamais.

-- ---------- Les comptes à droits réduits, un par droit ----------
-- C1 : pas de projects.read. C2 : projects.read sans quotes.read.
-- C3 : tout sauf invoice.create. C4 : pas de clients.read.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000088-0000-4000-8000-0000000000c1', 'custom', array['clients.read']
from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000088-0000-4000-8000-0000000000c2', 'custom', array['projects.read','clients.read']
from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000088-0000-4000-8000-0000000000c3', 'custom', array['projects.read','quotes.read','clients.read']
from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000088-0000-4000-8000-0000000000c4', 'custom', array['projects.read','quotes.read','invoice.create']
from ids where k='orgA';

-- ---------- Les clients de A : cinq avec une source, un sans ----------
-- Cinq exactement, pour poser le seuil de `ai_internal_history` sur son
-- arête : à quatre il refuse, à cinq il répond.
insert into ids select 'cA'||g, gen_random_uuid() from generate_series(1,6) g;

insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage, source)
select (select v from ids where k='cA'||g),
       (select v from ids where k='orgA'),
       'Client A'||g, 'individual', 'customer',
       case when g <= 3 then 'Bouche à oreille'
            when g <= 5 then 'Web'
            else null end
from generate_series(1,6) g;

-- ---------- Les devis DÉCIDÉS de A : vingt-sept, et trois pièges ----------
-- 25 décisions « normales » : le i-ième a été décidé i heures après son
-- envoi. Cela donne une médiane calculable et un taux au-dessus du
-- seuil de vingt.
insert into ids select 'qA'||g, gen_random_uuid() from generate_series(1,27) g;

insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until, sent_at, decided_at, viewed_at, rejection_reason)
select (select v from ids where k='qA'||g),
       (select v from ids where k='orgA'),
       (select v from ids where k='cA'||(1 + (g % 6))),
       'Q-A-'||lpad(g::text, 3, '0'), 'Devis A'||g,
       case when g <= 18 then 'accepted'
            when g <= 23 then 'rejected'
            else 'expired' end,
       (select d from cfg where k='today') - (60 - g),
       (select d from cfg where k='today') + 30,
       now() - make_interval(days => 60 - g),
       now() - make_interval(days => 60 - g) + make_interval(hours => g),
       case when g % 2 = 0 then now() - make_interval(days => 60 - g) end,
       -- Trois refus motivés, deux sans motif : « personne n'a saisi de
       -- motif » est une information, et elle doit être comptée à part.
       case when g in (19, 20) then 'Prix trop élevé'
            when g = 21 then 'Délai trop long'
            else null end
from generate_series(1,25) g;

-- PIÈGE 1 — la décision en dix secondes. Le seul devis de la production
-- a été décidé en dix-neuf secondes : ce n'est pas un client rapide,
-- c'est une saisie de recette, et le SQL doit le compter à part.
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until, sent_at, decided_at)
select (select v from ids where k='qA26'), (select v from ids where k='orgA'),
       (select v from ids where k='cA1'), 'Q-A-026', 'Devis instantané', 'accepted',
       (select d from cfg where k='today') - 10,
       (select d from cfg where k='today') + 30,
       now() - interval '10 days',
       now() - interval '10 days' + interval '10 seconds';

-- PIÈGE 2 — décidé AVANT d'être envoyé. Donnée fausse, pas client très
-- rapide : la ligne doit sortir des délais et être signalée.
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until, sent_at, decided_at)
select (select v from ids where k='qA27'), (select v from ids where k='orgA'),
       (select v from ids where k='cA2'), 'Q-A-027', 'Devis incohérent', 'rejected',
       (select d from cfg where k='today') - 5,
       (select d from cfg where k='today') + 30,
       now() - interval '5 days',
       now() - interval '5 days' - interval '1 hour';

-- PIÈGE 3 — DEUX DEVIS ENCORE OUVERTS, dormants depuis vingt jours. Ils
-- ne doivent PAS entrer dans les décisions de `ai_sales_flow` : ils
-- appartiennent au briefing de direction, et c'est de là que la fonction
-- doit les lire.
insert into ids select 'qOuvert'||g, gen_random_uuid() from generate_series(1,2) g;
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until, sent_at)
select (select v from ids where k='qOuvert'||g),
       (select v from ids where k='orgA'),
       (select v from ids where k='cA1'),
       'Q-A-OUV-'||g, 'Devis dormant '||g, 'sent',
       (select d from cfg where k='today') - 20,
       (select d from cfg where k='today') + 30,
       now() - interval '20 days'
from generate_series(1,2) g;

-- Une ligne sur chaque devis dormant : `ai_executive_brief` joint
-- `quote_totals`, et un devis sans ligne n'y apparaîtrait pas.
insert into public.quote_lines (organization_id, quote_id, position, description,
                                quantity, unit_sale_price_cents, unit_cost_cents)
select (select v from ids where k='orgA'), (select v from ids where k='qOuvert'||g),
       1, 'Terrasse bois', 1, 250000, 100000
from generate_series(1,2) g;

-- ---------- L'ARTICLE DU CATALOGUE, cité par six devis ----------
-- Six devis distincts : le seuil de cinq est franchi, et l'agent a le
-- droit de parler d'évolution — pour cet article-là seulement.
insert into ids select 'ciA', gen_random_uuid();
insert into public.catalog_items (id, organization_id, name, item_type, unit)
select (select v from ids where k='ciA'), (select v from ids where k='orgA'),
       'Dalle grès cérame', 'material', 'm2';

-- Prix de VENTE croissant, coût d'achat constant et bas : si la fonction
-- rendait `unit_cost_cents` au lieu de `unit_sale_price_cents`, le
-- maximum vaudrait 100 au lieu de 5000.
insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position,
                                description, quantity, unit_sale_price_cents, unit_cost_cents)
select (select v from ids where k='orgA'), (select v from ids where k='qA'||g),
       (select v from ids where k='ciA'), 1,
       'Dalle grès cérame', 1, 4000 + (g * 200), 100
from generate_series(1,6) g;

-- Un libellé commun au devis et à la facture, pour que le rapprochement
-- par libellé ait quelque chose à rapprocher.
insert into public.quote_lines (organization_id, quote_id, position, description,
                                quantity, unit_sale_price_cents, unit_cost_cents)
select (select v from ids where k='orgA'), (select v from ids where k='qA1'),
       2, 'Arrosage automatique', 1, 90000, 40000;

-- ---------- LE PIPELINE DE A : trois opportunités, deux étapes ----------
-- L'étape « negotiation » ne porte AUCUN montant estimé. Son
-- `valeurEstimeeCents` doit valoir NULL, jamais zéro : une étape sans
-- montant saisi n'est pas une étape à zéro euro.
insert into public.crm_opportunities (organization_id, customer_id, title, stage,
                                      estimated_value_cents, probability_percent, expected_close_date)
select (select v from ids where k='orgA'), (select v from ids where k='cA1'),
       'Jardin Villa', 'qualification', 1200000, 30,
       (select d from cfg where k='today') + 45;
insert into public.crm_opportunities (organization_id, customer_id, title, stage)
select (select v from ids where k='orgA'), (select v from ids where k='cA2'), 'Terrasse B', 'negotiation';
insert into public.crm_opportunities (organization_id, customer_id, title, stage)
select (select v from ids where k='orgA'), (select v from ids where k='cA3'), 'Clôture C', 'negotiation';

-- ---------- LES RELANCES DE A : deux en retard, une faite ----------
insert into public.crm_activities (organization_id, customer_id, activity_type, subject,
                                   due_at, completed_at)
select (select v from ids where k='orgA'), (select v from ids where k='cA1'), 'call',
       'Rappeler pour le devis', now() - interval '3 days', null;
insert into public.crm_activities (organization_id, customer_id, activity_type, subject,
                                   due_at, completed_at)
select (select v from ids where k='orgA'), (select v from ids where k='cA2'), 'task',
       'Envoyer les plans', now() - interval '9 days', null;
insert into public.crm_activities (organization_id, customer_id, activity_type, subject,
                                   due_at, completed_at)
select (select v from ids where k='orgA'), (select v from ids where k='cA3'), 'call',
       'Déjà faite', now() - interval '5 days', now() - interval '4 days';

-- ---------- LES FACTURES DE A : six clients, dont un à la moitié ----------
-- 5 000 pour le premier, 1 000 pour chacun des cinq autres : le total HT
-- vaut 10 000 et la part du premier vaut exactement 50 %. Un chiffre
-- rond, pour que l'échec se lise sans calculatrice.
insert into ids select 'fA'||g, gen_random_uuid() from generate_series(1,6) g;

insert into public.invoices (id, organization_id, customer_id, number, status, issued_on, due_on)
select (select v from ids where k='fA'||g), (select v from ids where k='orgA'),
       (select v from ids where k='cA'||g),
       'FA-A-'||lpad(g::text, 3, '0'), 'draft',
       (select d from cfg where k='today') - 20,
       (select d from cfg where k='today') + 10
from generate_series(1,6) g;

insert into public.invoice_lines (organization_id, invoice_id, position, description,
                                  quantity, unit_price_cents, vat_rate)
select (select v from ids where k='orgA'), (select v from ids where k='fA'||g), 1,
       case when g = 1 then 'Arrosage automatique' else 'Entretien' end,
       1, case when g = 1 then 5000 else 1000 end, 20
from generate_series(1,6) g;

-- Émises seulement après avoir posé leurs lignes : `protect_issued_invoice`
-- interdit de toucher au contenu d'une facture déjà émise, et c'est très
-- bien ainsi.
update public.invoices
   set status = 'issued', issued_at = now() - interval '20 days'
 where organization_id = (select v from ids where k='orgA');

-- UN SEUL RÈGLEMENT ENREGISTRÉ. Assez pour sortir du refus « aucun
-- règlement n'a jamais été enregistré », pas assez pour conclure quoi
-- que ce soit : le motif doit basculer sur le seuil des douze échéances.
insert into public.payments (organization_id, customer_id, amount_cents, method, received_on)
select (select v from ids where k='orgA'), (select v from ids where k='cA2'), 1200, 'transfer',
       (select d from cfg where k='today') - 2;

-- ---------- LES CHANTIERS DE A : deux terminés, avec des dates ----------
insert into ids select 'pA'||g, gen_random_uuid() from generate_series(1,2) g;
insert into public.projects (id, organization_id, customer_id, number, name, status,
                             planned_end_on, actual_end_on)
select (select v from ids where k='pA'||g), (select v from ids where k='orgA'),
       (select v from ids where k='cA'||g), 'CH-A-'||g, 'Chantier A'||g, 'completed',
       (select d from cfg where k='today') - 30 + g,
       (select d from cfg where k='today') - 25 + g
from generate_series(1,2) g;

insert into public.project_phases (organization_id, project_id, title, position, status, planned_end_on)
select (select v from ids where k='orgA'), (select v from ids where k='pA1'), 'Phase datée', 1, 'done',
       (select d from cfg where k='today') - 30;
insert into public.project_phases (organization_id, project_id, title, position, status)
select (select v from ids where k='orgA'), (select v from ids where k='pA2'), 'Phase sans date', 1, 'done';


-- ---------- LE DÉCOR DE B : sous tous les seuils, exprès ----------
-- Rien de ce décor ne doit apparaître dans les compteurs de A, et
-- réciproquement.
insert into ids select 'cB'||g, gen_random_uuid() from generate_series(1,2) g;
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage, source)
select (select v from ids where k='cB'||g), (select v from ids where k='orgB'),
       'Client B'||g, 'company', 'customer', 'Salon'
from generate_series(1,2) g;

-- Trois décisions seulement : sous le seuil du taux ET sous celui de la
-- médiane.
insert into ids select 'qB'||g, gen_random_uuid() from generate_series(1,3) g;
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until, sent_at, decided_at)
select (select v from ids where k='qB'||g), (select v from ids where k='orgB'),
       (select v from ids where k='cB1'), 'Q-B-'||g, 'Devis B'||g,
       case when g = 1 then 'accepted' else 'rejected' end,
       (select d from cfg where k='today') - 20,
       (select d from cfg where k='today') + 30,
       now() - make_interval(days => 20 - g),
       now() - make_interval(days => 20 - g) + make_interval(hours => g)
from generate_series(1,3) g;

-- UNE SEULE FACTURE, UN SEUL CLIENT FACTURÉ : la concentration vaudrait
-- 100 % par construction, et la fonction doit refuser de la rendre.
insert into ids select 'fB1', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status, issued_on, due_on)
select (select v from ids where k='fB1'), (select v from ids where k='orgB'),
       (select v from ids where k='cB1'), 'FA-B-001', 'draft',
       (select d from cfg where k='today') - 20, (select d from cfg where k='today') + 10;
insert into public.invoice_lines (organization_id, invoice_id, position, description,
                                  quantity, unit_price_cents, vat_rate)
select (select v from ids where k='orgB'), (select v from ids where k='fB1'), 1, 'Tonte', 1, 3000, 20;
update public.invoices set status = 'issued', issued_at = now() - interval '20 days'
 where id = (select v from ids where k='fB1');

-- UN CHANTIER SANS AUCUNE DATE DE FIN PRÉVUE : « zéro retard » y serait
-- un mensonge, et la fonction doit dire « aucune référence ».
insert into ids select 'pB1', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='pB1'), (select v from ids where k='orgB'),
       (select v from ids where k='cB1'), 'CH-B-1', 'Chantier B', 'inProgress';
insert into public.project_phases (organization_id, project_id, title, position, status)
select (select v from ids where k='orgB'), (select v from ids where k='pB1'), 'Sans date', 1, 'inProgress';

-- Ni opportunité, ni activité, ni règlement chez B : les trois motifs
-- « jamais rempli » doivent tomber.


-- ============================================================
-- 5. `ai_sales_flow` — LA FENÊTRE REFERMÉE
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000088-0000-4000-8000-0000000000a1')::text, true);

create temp table sA(j jsonb) on commit drop;
insert into sA select public.ai_sales_flow((select v from ids where k='orgA'));

insert into res select '5a : 27 décisions comptées (les deux devis ouverts sont exclus)', '27',
       (select (j -> 'decisions' ->> 'nombre') from sA);

insert into res select '5b : 19 acceptés', '19',
       (select (j -> 'decisions' ->> 'acceptes') from sA);

insert into res select '5c : 6 refusés', '6',
       (select (j -> 'decisions' ->> 'refuses') from sA);

insert into res select '5d : 2 expirés', '2',
       (select (j -> 'decisions' ->> 'expires') from sA);

-- 19/27 = 70,37 %, arrondi à 70,4. Le taux EST rendu : le seuil de vingt
-- est franchi, et une fonction qui refuserait toujours serait aussi
-- inutile qu'une fonction qui ne refuse jamais.
insert into res select '5e : au-dessus de vingt décisions, le taux est rendu', '70.4',
       (select (j -> 'decisions' ->> 'tauxDeSignaturePct') from sA);

insert into res select '5f : et sans motif de refus, puisqu''il n''y a rien à refuser', 'true',
       (select ((j -> 'decisions' -> 'tauxMotif') = 'null'::jsonb)::text from sA);

-- Vingt-six délais sensés (le vingt-septième est négatif et exclu) :
-- 10 secondes, puis 1 h à 25 h. La médiane tombe entre 12 h et 13 h,
-- soit 12 h 30, soit 0,52 jour.
insert into res select '5g : le délai médian est rendu et vaut 0,52 jour', '0.52',
       (select (j -> 'decisions' ->> 'delaiMedianJours') from sA);

insert into res select '5h : la décision en dix secondes est comptée à part', '1',
       (select (j -> 'decisions' ->> 'decisionsQuasiInstantanees') from sA);

insert into res select '5i : le devis décidé avant d''être envoyé est signalé', '1',
       (select (j -> 'decisions' ->> 'decisionsAvantEnvoi') from sA);

-- Le minimum vaut dix secondes (0,0001 jour) et non moins un heure : la
-- ligne incohérente est bien sortie du calcul.
insert into res select '5j : le délai minimum n''est pas négatif', 'true',
       (select ((j -> 'decisions' ->> 'delaiMinimumJours')::numeric >= 0)::text from sA);

insert into res select '5k : deux motifs de refus distincts saisis', '2',
       (select jsonb_array_length(j -> 'refus' -> 'motifs')::text from sA);

insert into res select '5l : trois refus sans motif saisi, comptés à part', '3',
       (select (j -> 'refus' ->> 'sansMotifSaisi') from sA);

-- LE PIPELINE : deux étapes, et l'étape sans montant rend NULL.
insert into res select '5m : deux étapes de pipeline ouvertes', '2',
       (select jsonb_array_length(j -> 'pipeline' -> 'parEtape')::text from sA);

insert into res select '5n : une étape sans montant saisi rend NULL, pas zéro', 'true',
       (select bool_or((e.value ->> 'etape') = 'negotiation'
                       and (e.value -> 'valeurEstimeeCents') = 'null'::jsonb)::text
        from sA, jsonb_array_elements(j -> 'pipeline' -> 'parEtape') e);

insert into res select '5o : deux relances commerciales en retard (la troisième est faite)', '2',
       (select (j -> 'relancesCommercialesEnRetard' ->> 'nombre') from sA);

-- LE MARQUAGE DE LECTURE : 29 devis envoyés (27 décidés + 2 dormants),
-- dont 12 portent un viewed_at (les g pairs de 1 à 25 : 2,4,…,24).
insert into res select '5p : 29 devis envoyés', '29',
       (select (j -> 'marquageDeLecture' ->> 'devisEnvoyes') from sA);

insert into res select '5q : le marquage de lecture porte l''avertissement sur la saisie manuelle', 'true',
       (select ((j -> 'marquageDeLecture' ->> 'note') like '%SAISIE HUMAINE%')::text from sA);

-- LE POINT LE PLUS IMPORTANT : sales ne recompte pas les devis ouverts,
-- il les lit dans le briefing. On compare les deux sources.
insert into res select '5r : le renvoi ne contient que des lignes du Chiffrage', 'true',
       (select coalesce(bool_and((e.value ->> 'agent') = 'quote_pricing'), true)::text
        from sA, jsonb_array_elements(j -> 'renvoiDevisOuverts' -> 'lignesDuBriefing') e);

-- ══════════════════════════════════════════════════════════════════
-- 5s — L'ÉGALITÉ N'EST PLUS LITTÉRALE, ET C'EST UN RESSERRAGE
-- ══════════════════════════════════════════════════════════════════
--
-- Ce test exigeait que les lignes relayées soient EXACTEMENT celles du
-- briefing. L'intention était juste — ne pas recalculer — mais
-- l'égalité stricte imposait de transporter aussi ce que le briefing
-- met dans ses lignes et que cet agent s'interdit :
--
--   • 'impactCents', la valeur HT des devis en attente. La description
--     de l'outil affirme « AUCUN MONTANT DE DEVIS N'EST RENDU » et son
--     champ « fournit » est vide : les deux étaient démentis par la
--     charge utile. Un euro relayé reste un euro rendu.
--   • 'actionsDisponibles' contenant 'quoteFollowUp' — l'action même
--     que l'une des limites de l'agent lui interdit de proposer. Un
--     modèle qui voit une action dans ses données la propose.
--
-- La fonction DÉPOUILLE donc les lignes. Ce qu'on vérifie ici est
-- l'égalité APRÈS dépouillement : chaque ligne rendue est celle du
-- briefing moins ses quatre clés, plus une note qui dit pourquoi. Rien
-- n'est recalculé, et rien d'interdit ne passe.
insert into res select '5s : ces lignes sont celles du briefing, dépouillées et non recalculées', 'true',
       (select ((j -> 'renvoiDevisOuverts' -> 'lignesDuBriefing') = (
          select coalesce(jsonb_agg(
                   (e.value - 'impactCents' - 'impactTexte'
                            - 'actionRecommandee' - 'actionsDisponibles')
                   || jsonb_build_object(
                        'montantRetire',
                        'Le montant et l''action ont été retirés de cette ligne : ils appartiennent au '
                        || 'Chiffrage. Cite le titre et renvoie-lui la main.')
                   order by e.ordinality), '[]'::jsonb)
          from jsonb_array_elements(
                 public.ai_executive_brief((select v from ids where k='orgA')) -> 'actionsPrioritaires')
               with ordinality e
          where e.value ->> 'agent' = 'quote_pricing'
            and e.value ->> 'categorie' in ('opportunite', 'urgent')))::text
        from sA);

-- LE MONTANT ET L'ACTION ONT VRAIMENT DISPARU. L'assertion précédente
-- compare deux expressions écrites de la même façon ; celle-ci regarde
-- le résultat, et c'est elle qui tomberait si le dépouillement était
-- retiré d'un côté seulement.
insert into res select '5s2 : aucune ligne relayée ne porte de montant ni d''action', 'true',
       (select coalesce(bool_and(
                 not (e.value ? 'impactCents')
                 and not (e.value ? 'impactTexte')
                 and not (e.value ? 'actionRecommandee')
                 and not (e.value ? 'actionsDisponibles')), true)::text
        from sA, jsonb_array_elements(j -> 'renvoiDevisOuverts' -> 'lignesDuBriefing') e);

insert into res select '5s3 : et chacune dit d''où vient le trou', 'true',
       (select coalesce(bool_and((e.value ->> 'montantRetire') like '%Chiffrage%'), true)::text
        from sA, jsonb_array_elements(j -> 'renvoiDevisOuverts' -> 'lignesDuBriefing') e);

-- LA SECTION 4 DU BRIEFING NE PASSE PAS. Elle porte le même agent
-- ('quote_pricing') mais la catégorie 'optimisation' : ce sont les
-- devis sous l'objectif de MARGE, pas des devis en attente de réponse.
-- Le filtre ne regardait que l'agent, et l'étiquette « sections 2 et
-- 3 » les annonçait quand même : un modèle aurait présenté une ligne de
-- marge comme un devis qui dort.
insert into res select '5s4 : seules les catégories des sections 2 et 3 sont relayées', 'true',
       (select coalesce(bool_and((e.value ->> 'categorie') in ('opportunite', 'urgent')), true)::text
        from sA, jsonb_array_elements(j -> 'renvoiDevisOuverts' -> 'lignesDuBriefing') e);

insert into res select '5s5 : et la source le dit, au lieu d''annoncer deux sections sur trois', 'true',
       (select (((j -> 'renvoiDevisOuverts' ->> 'source') like '%categorie%')
            and ((j -> 'renvoiDevisOuverts' ->> 'source') like '%section 4%'))::text from sA);

insert into res select '5t : les deux devis dormants sont bien vus par le briefing', 'true',
       (select (jsonb_array_length(j -> 'renvoiDevisOuverts' -> 'lignesDuBriefing') >= 1)::text from sA);

-- ══════════════════════════════════════════════════════════════════
-- 5u — LE CONTRÔLE PORTE MAINTENANT SUR TOUTE LA RÉPONSE
-- ══════════════════════════════════════════════════════════════════
--
-- Il écartait « renvoiDevisOuverts » au motif que son contenu venait du
-- briefing. C'était le seul endroit par lequel un montant de devis
-- pouvait sortir de cet agent, et l'exemption le rendait invisible : la
-- promesse « aucun montant » était vraie partout SAUF là où elle
-- pouvait être fausse.
--
-- Depuis que les lignes relayées sont dépouillées, l'exemption n'a plus
-- de raison d'être. Le contrôle s'applique à l'objet ENTIER, ce qui est
-- la seule forme sous laquelle il vaut quelque chose.
insert into res select '5u : aucun montant HT ou TTC de devis, dans AUCUNE partie de la réponse', 'true',
       (select ((j::text not like '%HtCents%')
            and (j::text not like '%TtcCents%')
            and (j::text not like '%impactCents%'))::text from sA);

insert into res select '5v : la relance de devis est nommée comme appartenant au Chiffrage', 'true',
       (select ((j -> 'nonMesurable' ->> 'relanceDeDevis') like '%quote_pricing%')::text from sA);

-- ---------- B : sous les seuils, NULL et des motifs ----------
select set_config('request.jwt.claims',
  json_build_object('sub','b0000088-0000-4000-8000-0000000000b1')::text, true);

create temp table sB(j jsonb) on commit drop;
insert into sB select public.ai_sales_flow((select v from ids where k='orgB'));

insert into res select '5w : B ne voit que ses trois décisions (aucune fuite depuis A)', '3',
       (select (j -> 'decisions' ->> 'nombre') from sB);

insert into res select '5x : sous vingt décisions, le taux vaut NULL', 'true',
       (select ((j -> 'decisions' -> 'tauxDeSignaturePct') = 'null'::jsonb)::text from sB);

insert into res select '5y : et le refus est motivé en français', 'true',
       (select ((j -> 'decisions' ->> 'tauxMotif') like '%Taux refusé%')::text from sB);

insert into res select '5z : sous huit décisions, la médiane vaut NULL', 'true',
       (select ((j -> 'decisions' -> 'delaiMedianJours') = 'null'::jsonb)::text from sB);

insert into res select '5aa : mais le minimum et le maximum restent rendus (ce sont des faits)', 'true',
       (select ((j -> 'decisions' -> 'delaiMinimumJours') <> 'null'::jsonb)::text from sB);

insert into res select '5ab : un pipeline jamais rempli est nommé comme un défaut de saisie', 'true',
       (select ((j -> 'pipeline' ->> 'motif') like '%jamais rempli%')::text from sB);

insert into res select '5ac : un journal d''activités vide n''est pas « aucune relance en retard »', 'true',
       (select ((j -> 'relancesCommercialesEnRetard' ->> 'motif') like '%journal du CRM est vide%')::text from sB);

insert into res select '5ad : et le nombre de relances en retard reste zéro, sans verdict', '0',
       (select (j -> 'relancesCommercialesEnRetard' ->> 'nombre') from sB);


-- ============================================================
-- 6. `ai_internal_history` — L'ENTREPRISE COMPARÉE À SON PASSÉ
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000088-0000-4000-8000-0000000000a1')::text, true);

create temp table mA(j jsonb) on commit drop;
insert into mA select public.ai_internal_history((select v from ids where k='orgA'));

insert into res select '6a : cinq clients portent une source, sur six', '5',
       (select (j -> 'origineDesClients' ->> 'clientsAvecSource') from mA);

insert into res select '6b : au seuil exact, les parts sont rendues', 'true',
       (select ((j -> 'origineDesClients' -> 'partsPct') <> 'null'::jsonb)::text from mA);

insert into res select '6c : et la part du bouche-à-oreille vaut 60 %', '60.0',
       (select e.value ->> 'partPct'
        from mA, jsonb_array_elements(j -> 'origineDesClients' -> 'partsPct') e
        where e.value ->> 'source' = 'Bouche à oreille');

insert into res select '6d : le client sans source est nommé, pas oublié', 'true',
       (select ((j -> 'origineDesClients' ->> 'motif') like '%hors du calcul%')::text from mA);

insert into res select '6e : un seul article atteint cinq devis distincts', '1',
       (select (j -> 'prixUnitaireParArticle' ->> 'articlesAtteignantLeSeuil') from mA);

-- LE PIÈGE DE SCHÉMA : `unit_sale_price_cents`, pas `unit_cost_cents`.
-- Le coût vaut 100 sur toutes les lignes ; si la fonction se trompait de
-- colonne, le maximum vaudrait 100.
insert into res select '6f : le prix rendu est le prix de VENTE, pas le coût d''achat', '5200',
       (select max((e.value ->> 'prixUnitaireMaxCents')::bigint)::text
        from mA, jsonb_array_elements(j -> 'prixUnitaireParArticle' -> 'parArticleEtParMois') e);

insert into res select '6g : le rapprochement devis/facture trouve le libellé commun', 'true',
       (select bool_or((e.value ->> 'libelle') = 'arrosage automatique'
                       and (e.value ->> 'lignesDevis')::int > 0
                       and (e.value ->> 'lignesFacture')::int > 0)::text
        from mA, jsonb_array_elements(j -> 'deviseContreFacture' -> 'parLibelle') e);

insert into res select '6h : et il annonce lui-même sa fragilité', 'true',
       (select ((j -> 'deviseContreFacture' ->> 'note') like '%catalog_item_id%')::text from mA);

insert into res select '6i : la saisonnalité n''est pas mesurable', 'false',
       (select (j -> 'saisonnalite' ->> 'mesurable') from mA);

insert into res select '6j : et ce n''est pas « aucune saisonnalité détectée »', 'true',
       (select ((j -> 'saisonnalite' ->> 'motif') like '%pas assez d''histoire%')::text from mA);

insert into res select '6k : la source externe absente est déclarée par l''agent lui-même', 'false',
       (select (j -> 'sourceExterneAbsente' ->> 'disponible') from mA);

insert into res select '6l : et il dit ce qu''il faudrait brancher', 'true',
       (select (length(j -> 'sourceExterneAbsente' ->> 'aBrancher') > 50)::text from mA);

insert into res select '6m : le prix du marché est refusé nommément', 'true',
       (select ((j -> 'nonMesurable' ->> 'prixDuMarche') is not null)::text from mA);

insert into res select '6n : la part de marché aussi', 'true',
       (select ((j -> 'nonMesurable' ->> 'partDeMarche') is not null)::text from mA);

insert into res select '6o : la comparaison à un concurrent aussi', 'true',
       (select ((j -> 'nonMesurable' ->> 'concurrents') is not null)::text from mA);

insert into res select '6p : l''agent porte son nom lisible, et ce n''est pas « Marché »', 'Historique interne',
       (select j ->> 'nomLisible' from mA);

insert into res select '6q : les achats vides sont nommés séparément', '0',
       (select (j -> 'achats' ->> 'fournisseurs') from mA);

-- ---------- B : deux sources seulement, sous le seuil ----------
select set_config('request.jwt.claims',
  json_build_object('sub','b0000088-0000-4000-8000-0000000000b1')::text, true);

create temp table mB(j jsonb) on commit drop;
insert into mB select public.ai_internal_history((select v from ids where k='orgB'));

insert into res select '6r : sous cinq clients sourcés, aucune part n''est rendue', 'true',
       (select ((j -> 'origineDesClients' -> 'partsPct') = 'null'::jsonb)::text from mB);

insert into res select '6s : et le refus dit combien il en manque', 'true',
       (select ((j -> 'origineDesClients' ->> 'motif') like '%Parts refusées%')::text from mB);

insert into res select '6t : aucun article n''étant rattaché, le motif le dit', 'true',
       (select ((j -> 'prixUnitaireParArticle' ->> 'motif') like '%rattachée à un article%')::text from mB);

insert into res select '6u : B ne voit aucun des six clients de A', '2',
       (select (j -> 'origineDesClients' ->> 'clientsTotal') from mB);


-- ============================================================
-- 6bis. LA TRONCATURE DU TABLEAU DES PRIX
-- ============================================================
--
-- ══════════════════════════════════════════════════════════════════
-- LE DÉFAUT QUE CETTE SECTION VERROUILLE
-- ══════════════════════════════════════════════════════════════════
--
-- « parArticleEtParMois » est borné à c_max (50) lignes. Il était trié
-- PAR NOM D'ARTICLE. Conséquence, éprouvée contre la production avant
-- correction : avec soixante articles cités une fois chacun et un seul
-- cité six fois, « articlesAtteignantLeSeuil » valait 1 — et l'article
-- qualifié était ABSENT du tableau, éjecté par l'ordre alphabétique.
--
-- Le modèle lisait donc « un article sur soixante et un autorise une
-- phrase sur l'évolution du prix », puis n'avait sous les yeux que des
-- articles qui ne l'autorisent pas. Rien ne signalait la troncature. La
-- pente naturelle est qu'il commente l'un d'eux : le résultat plausible
-- et faux que cet agent existe pour empêcher.
--
-- Les deux autres tableaux de cette fonction sont triés par pertinence
-- décroissante, ce qui rend leur troncature bénigne. Celui-ci était
-- l'exception, et c'est pourquoi il a son propre décor.

select set_config('request.jwt.claims',
  json_build_object('sub','c0000088-0000-4000-8000-0000000000c1')::text, true);
insert into ids select 'orgT', public.create_professional_organization('Derniers T','landscaper');

-- LE CONTRAT — sans lui, le péage (0092) refuse tout (voir 0092 § 5).
-- « created_at >= now() » : now() est l'heure de DÉBUT DE TRANSACTION et
-- la colonne a now() pour défaut, donc ce filtre ne prend QUE les
-- entreprises nées ici. Un jeu d'essai ne signe pas de contrat pour de
-- vrais clients.
insert into public.organization_subscriptions
  (organization_id, plan, status, provider, billing_cycle)
select o.id, 'business', 'active', 'manual', 'monthly'
  from public.business_organizations o
 where o.created_at >= now()
on conflict (organization_id) do nothing;


insert into ids select 'cT1', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage, source)
select (select v from ids where k='cT1'), (select v from ids where k='orgT'),
       'Client T', 'individual', 'customer', 'Salon';

-- SOIXANTE ARTICLES « AAA-nn », cités par UN devis chacun : aucun
-- n'atteint le seuil de cinq. Ils sont nommés pour passer AVANT « ZZZ »
-- dans l'ordre alphabétique — c'est ce qui éjectait l'article utile.
insert into ids select 'ciT'||g, gen_random_uuid() from generate_series(1,60) g;
insert into public.catalog_items (id, organization_id, name, item_type, unit)
select (select v from ids where k='ciT'||g), (select v from ids where k='orgT'),
       'AAA-'||lpad(g::text, 2, '0'), 'material', 'u'
from generate_series(1,60) g;

-- L'ARTICLE QUALIFIÉ, nommé pour arriver EN DERNIER alphabétiquement.
insert into ids select 'ciTz', gen_random_uuid();
insert into public.catalog_items (id, organization_id, name, item_type, unit)
select (select v from ids where k='ciTz'), (select v from ids where k='orgT'),
       'ZZZ Dalle', 'material', 'm2';

-- Soixante-six devis : soixante pour les AAA, six pour le ZZZ.
insert into ids select 'qT'||g, gen_random_uuid() from generate_series(1,66) g;
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until, sent_at, decided_at)
select (select v from ids where k='qT'||g),
       (select v from ids where k='orgT'),
       (select v from ids where k='cT1'),
       'Q-T-'||lpad(g::text, 3, '0'), 'Devis T'||g, 'accepted',
       (select d from cfg where k='today') - g,
       (select d from cfg where k='today') + 30,
       now() - make_interval(days => g),
       now() - make_interval(days => g) + interval '2 hours'
from generate_series(1,66) g;

insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position,
                                description, quantity, unit_sale_price_cents, unit_cost_cents)
select (select v from ids where k='orgT'), (select v from ids where k='qT'||g),
       (select v from ids where k='ciT'||g), 1, 'AAA', 1, 1000, 100
from generate_series(1,60) g;

insert into public.quote_lines (organization_id, quote_id, catalog_item_id, position,
                                description, quantity, unit_sale_price_cents, unit_cost_cents)
select (select v from ids where k='orgT'), (select v from ids where k='qT'||(60 + g)),
       (select v from ids where k='ciTz'), 1, 'ZZZ Dalle', 1, 5000 + (g * 100), 100
from generate_series(1,6) g;

select set_config('request.jwt.claims',
  json_build_object('sub','c0000088-0000-4000-8000-0000000000c1')::text, true);

create temp table mT(j jsonb) on commit drop;
insert into mT select public.ai_internal_history((select v from ids where k='orgT'));

insert into res select '6v : soixante et un articles distincts, un seul au-dessus du seuil', '1',
       (select (j -> 'prixUnitaireParArticle' ->> 'articlesAtteignantLeSeuil') from mT);

-- L'ASSERTION QUI TOMBAIT AVANT CORRECTION.
insert into res select '6w : l''article qualifié est DANS le tableau, malgré la troncature', 'true',
       (select coalesce(bool_or((e.value ->> 'article') = 'ZZZ Dalle'), false)::text
        from mT, jsonb_array_elements(j -> 'prixUnitaireParArticle' -> 'parArticleEtParMois') e);

insert into res select '6x : et il vient en premier, parce que le tri est par pertinence', 'ZZZ Dalle',
       (select (j -> 'prixUnitaireParArticle' -> 'parArticleEtParMois' -> 0 ->> 'article') from mT);

insert into res select '6y : chaque ligne dit si son article atteint le seuil', 'true',
       (select coalesce(bool_and(e.value ? 'atteintLeSeuil'), false)::text
        from mT, jsonb_array_elements(j -> 'prixUnitaireParArticle' -> 'parArticleEtParMois') e);

-- LA TRONCATURE SE DIT. Un tableau coupé sans indicateur se lit comme
-- un tableau complet, et c'est la moitié du défaut.
insert into res select '6z : la troncature est annoncée', 'true',
       (select (j -> 'prixUnitaireParArticle' ->> 'tronque') from mT);

insert into res select '6z2 : cinquante couples rendus sur soixante et un', '50',
       (select (j -> 'prixUnitaireParArticle' ->> 'couplesRendus') from mT);

-- Au moins 61 : soixante articles AAA a un couple chacun, plus le ou
-- les couples du ZZZ selon que ses six devis tombent sur un mois ou
-- deux. On borne par le bas plutot que de figer un nombre qui depend
-- du jour ou le test tourne.
insert into res select '6z3 : et le total est dit, pour qu''on sache ce qui manque', 'true',
       (select ((j -> 'prixUnitaireParArticle' ->> 'couplesArticleMoisTotal')::int >= 61)::text from mT);

-- ET LE PRIX RENDU EST BIEN LE PRIX DE VENTE. Coûts à 100 partout,
-- ventes de 5 100 à 5 600 : si la fonction lisait unit_cost_cents, le
-- maximum vaudrait 100.
insert into res select '6z4 : le prix rendu est le prix de VENTE, pas le coût', '5600',
       (select max((e.value ->> 'prixUnitaireMaxCents')::int)::text
        from mT, jsonb_array_elements(j -> 'prixUnitaireParArticle' -> 'parArticleEtParMois') e
        where (e.value ->> 'article') = 'ZZZ Dalle');


-- ============================================================
-- 7. `ai_risk_snapshot` — CE QUI SE MESURE, ET RIEN DE PLUS
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000088-0000-4000-8000-0000000000a1')::text, true);

create temp table rA(j jsonb) on commit drop;
insert into rA select public.ai_risk_snapshot((select v from ids where k='orgA'));

insert into res select '7a : six clients facturés', '6',
       (select (j -> 'concentrationClient' ->> 'clientsFactures') from rA);

-- 6 000 TTC sur 12 000 TTC : exactement la moitié. Un chiffre rond, pour
-- que l'échec se lise sans calculatrice.
insert into res select '7b : au-dessus de cinq clients, la part du premier est rendue', '50.0',
       (select (j -> 'concentrationClient' ->> 'partDuPremierClientPct') from rA);

insert into res select '7c : et aucun euro ni nom de client ne sort de cet agent', 'true',
       (select ((j -> 'concentrationClient' ->> 'note') like '%ratio%')::text from rA);

-- L'ENCOURS ÉCHU EST LU CHEZ LA FACTURATION, pas recompté. On compare
-- les deux valeurs plutôt que de croire le commentaire.
insert into res select '7d : l''encours échu vient de ai_billing_candidates, à l''identique', 'true',
       (select ((j -> 'encoursEchu' ->> 'facturesEnRetard')
                 = (public.ai_billing_candidates((select v from ids where k='orgA'))
                    -> 'facturesEnRetard' -> 'resume' ->> 'nombre'))::text from rA);

insert into res select '7e : et la source est nommée dans la réponse', 'true',
       (select ((j -> 'encoursEchu' ->> 'source') like '%ai_billing_candidates%')::text from rA);

insert into res select '7f : zéro échu ne se lit pas « tout le monde paie »', 'true',
       (select ((j -> 'encoursEchu' ->> 'note') like '%rien n''est encore exigible%')::text from rA);

-- A a UN règlement : il sort du refus « aucun règlement », mais le seuil
-- des douze échéances n'est pas franchi et le verdict reste refusé.
insert into res select '7g : un seul règlement ne rend pas le comportement de paiement mesurable', 'false',
       (select (j -> 'comportementDePaiement' ->> 'mesurable') from rA);

insert into res select '7h : et le motif parle du seuil, pas de l''absence de règlement', 'true',
       (select ((j -> 'comportementDePaiement' ->> 'motif') like '%non concluant%')::text from rA);

insert into res select '7i : deux chantiers terminés comparables, sous le seuil de douze', '2',
       (select (j -> 'tenueDesDelais' ->> 'chantiersTerminesComparables') from rA);

insert into res select '7j : la tenue des délais n''est donc pas mesurable', 'false',
       (select (j -> 'tenueDesDelais' ->> 'mesurable') from rA);

-- LA CASCADE : vérifiée sur le schéma à chaque appel, pas affirmée.
insert into res select '7k : la cascade de retards est déclarée incalculable', 'false',
       (select (j -> 'cascadeDeRetards' ->> 'calculable') from rA);

insert into res select '7l : aucune colonne de dépendance sur project_tasks', '0',
       (select (j -> 'cascadeDeRetards' ->> 'colonnesDeDependanceTrouvees') from rA);

insert into res select '7m : et le refus dit « fonctionnalité absente », pas « donnée manquante »', 'true',
       (select ((j -> 'cascadeDeRetards' ->> 'motif') like '%fonctionnalité absente%')::text from rA);

insert into res select '7n : la phrase « aucun risque détecté » est déclarée interdite', 'Aucun risque détecté',
       (select j ->> 'phraseInterdite' from rA);

insert into res select '7o : la règle d''étiquetage mesure/déduction est portée par la réponse', 'true',
       (select ((j ->> 'regleDEtiquetage') like '%DÉDUCTION%')::text from rA);

insert into res select '7p : chaque bloc chiffré se déclare comme une mesure', '5',
       (select count(*)::text from rA,
        (values ('concentrationClient'),('encoursEchu'),('comportementDePaiement'),
                ('tenueDesDelais'),('cascadeDeRetards')) b(cle)
        where (j -> b.cle ->> 'nature') = 'mesure');

insert into res select '7q : aucun score de risque agrégé n''est rendu', 'true',
       (select ((j::text not like '%scoreDeRisqueCalcule%')
            and (j -> 'nonMesurable' ->> 'scoreDeRisque') is not null)::text from rA);

insert into res select '7r : aucune probabilité chiffrée non plus', 'true',
       (select ((j -> 'nonMesurable' ->> 'probabilites') is not null)::text from rA);

insert into res select '7s : la marge est renvoyée à la Finance', 'true',
       (select ((j -> 'nonMesurable' ->> 'margeEtSaDerive') like '%ai_finance_margin_breakdown%')::text from rA);

-- ---------- B : un client facturé, aucun règlement, aucune date ----------
select set_config('request.jwt.claims',
  json_build_object('sub','b0000088-0000-4000-8000-0000000000b1')::text, true);

create temp table rB(j jsonb) on commit drop;
insert into rB select public.ai_risk_snapshot((select v from ids where k='orgB'));

insert into res select '7t : avec un seul client facturé, la concentration vaut NULL', 'true',
       (select ((j -> 'concentrationClient' -> 'partDuPremierClientPct') = 'null'::jsonb)::text from rB);

insert into res select '7u : et le refus explique que 100 % serait exact et vide de sens', 'true',
       (select ((j -> 'concentrationClient' ->> 'motif') like '%arithmétiquement exact%')::text from rB);

insert into res select '7v : sans aucun règlement, le refus est nommé et non chiffré', 'true',
       (select ((j -> 'comportementDePaiement' ->> 'motif') like '%payée hors%logiciel%')::text from rB);

insert into res select '7w : sans date de fin prévue, ce n''est pas « aucun retard »', 'true',
       (select ((j -> 'tenueDesDelais' ->> 'motif') like '%aucune référence%')::text from rB);

insert into res select '7x : B ne voit aucune des six factures de A', '1',
       (select (j -> 'concentrationClient' ->> 'facturesRetenues') from rB);


-- ============================================================
-- 8. LE CLOISONNEMENT
-- ============================================================
-- Depuis la peau de A, les trois fonctions appelées sur B doivent lever.
-- L'identifiant de B est pourtant connu de l'appelant : c'est
-- exactement la situation d'un modèle à qui l'on aurait laissé choisir
-- son organisation.

select set_config('request.jwt.claims',
  json_build_object('sub','a0000088-0000-4000-8000-0000000000a1')::text, true);

do $$
declare
  v_b uuid := (select v from ids where k='orgB');
  r1 boolean := false; r2 boolean := false; r3 boolean := false;
begin
  begin perform public.ai_sales_flow(v_b);        exception when others then r1 := true; end;
  begin perform public.ai_internal_history(v_b);  exception when others then r2 := true; end;
  begin perform public.ai_risk_snapshot(v_b);     exception when others then r3 := true; end;
  insert into res values
    ('8a : ai_sales_flow sur une autre entreprise lève',       'true', r1::text),
    ('8b : ai_internal_history sur une autre entreprise lève', 'true', r2::text),
    ('8c : ai_risk_snapshot sur une autre entreprise lève',    'true', r3::text);
end $$;

do $$
declare
  r boolean := false;
begin
  begin perform public.ai_sales_flow(gen_random_uuid());
  exception when others then r := true; end;
  insert into res values
    ('8d : une organisation inventée lève, elle ne rend pas un flux vide', 'true', r::text);
end $$;


-- ============================================================
-- 9. UN DROIT MANQUANT REFUSE, IL NE REND PAS UNE VUE PARTIELLE
-- ============================================================
-- Quatre comptes, un par droit exigé. Une vue amputée serait une réponse
-- fausse, pas une réponse incomplète : le dirigeant lirait « zéro » là
-- où il fallait lire « je n'ai pas le droit de voir ».

do $$
declare
  v_a uuid := (select v from ids where k='orgA');
  r1 boolean := false; r2 boolean := false; r3 boolean := false; r4 boolean := false;
begin
  -- C1 : pas de projects.read.
  perform set_config('request.jwt.claims',
    json_build_object('sub','c0000088-0000-4000-8000-0000000000c1')::text, true);
  begin perform public.ai_sales_flow(v_a); exception when others then r1 := true; end;

  -- C2 : projects.read, mais pas quotes.read.
  perform set_config('request.jwt.claims',
    json_build_object('sub','c0000088-0000-4000-8000-0000000000c2')::text, true);
  begin perform public.ai_sales_flow(v_a); exception when others then r2 := true; end;

  -- C3 : tout sauf invoice.create — le droit de l'argent.
  perform set_config('request.jwt.claims',
    json_build_object('sub','c0000088-0000-4000-8000-0000000000c3')::text, true);
  begin perform public.ai_risk_snapshot(v_a); exception when others then r3 := true; end;

  -- C4 : tout sauf clients.read.
  perform set_config('request.jwt.claims',
    json_build_object('sub','c0000088-0000-4000-8000-0000000000c4')::text, true);
  begin perform public.ai_internal_history(v_a); exception when others then r4 := true; end;

  insert into res values
    ('9a : sans projects.read, ai_sales_flow lève',        'true', r1::text),
    ('9b : sans quotes.read, ai_sales_flow lève aussi',    'true', r2::text),
    ('9c : sans invoice.create, ai_risk_snapshot lève',    'true', r3::text),
    ('9d : sans clients.read, ai_internal_history lève',   'true', r4::text);
end $$;

-- ET LE COMPTE C3 N'OBTIENT PAS UNE VUE PARTIELLE PAR UN AUTRE CHEMIN :
-- il a projects.read et quotes.read, donc `ai_sales_flow` DOIT lui
-- répondre. Un droit manquant ferme ce qu'il ferme, pas plus.
do $$
declare
  v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','c0000088-0000-4000-8000-0000000000c3')::text, true);
  begin
    perform public.ai_sales_flow((select v from ids where k='orgA'));
    v_ok := true;
  exception when others then v_ok := false;
  end;
  insert into res values
    ('9e : avec les deux droits qu''elle exige, la fonction répond', 'true', v_ok::text);
end $$;


-- ============================================================
-- 10. `anon` ET `PUBLIC` N'EXÉCUTENT RIEN
-- ============================================================
-- Supabase accorde `execute` nommément à `anon` EN PLUS du `PUBLIC`
-- implicite des fonctions. Révoquer l'un sans l'autre n'aurait rien
-- fermé — et c'est le genre de demi-mesure qui passe la relecture et
-- pas le test.

insert into res
select '10a : anon n''exécute aucune des trois fonctions', '0', count(*)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ai_sales_flow', 'ai_internal_history', 'ai_risk_snapshot')
  and has_function_privilege('anon', p.oid, 'execute');

insert into res
select '10b : PUBLIC non plus', '0', count(*)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral unnest(coalesce(p.proacl, array[]::aclitem[])) a
where n.nspname = 'public'
  and p.proname in ('ai_sales_flow', 'ai_internal_history', 'ai_risk_snapshot')
  and a::text like '=%';

insert into res
select '10c : mais authenticated, lui, exécute les trois', '3', count(*)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ai_sales_flow', 'ai_internal_history', 'ai_risk_snapshot')
  and has_function_privilege('authenticated', p.oid, 'execute');

-- Les trois sont bien en LECTURE SEULE : `stable` interdit toute
-- écriture, et `security invoker` laisse la RLS de l'appelant filtrer.
insert into res
select '10d : les trois sont stable et security invoker', '3', count(*)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ai_sales_flow', 'ai_internal_history', 'ai_risk_snapshot')
  and p.provolatile = 's'
  and not p.prosecdef;


-- ============================================================
-- 11. REJOUER LA MIGRATION NE CHANGE RIEN
-- ============================================================
-- Le corps est recopié à l'identique de 0088 : si les deux divergeaient,
-- ce test passerait en vérifiant autre chose que la migration. Une
-- migration qu'on n'ose pas rejouer est une migration qu'on applique
-- une fois, à la main, en croisant les doigts.

create or replace function public.ai_is_supported_agent(p_agent text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_agent in (
    'executive', 'finance', 'billing', 'quote_pricing',
    'operations', 'planning', 'procurement', 'nursery', 'fleet', 'customer',
    'sales', 'market', 'risk', 'classification'
  );
$$;

insert into res values
  ('11a : après rejeu, les quatorze tiennent', '14',
   (select count(*)::text
    from unnest(array['executive','finance','billing','quote_pricing','operations','planning',
                      'procurement','nursery','fleet','customer','sales','market','risk',
                      'classification']) a(cle)
    where public.ai_is_supported_agent(a.cle))),
  ('11b : après rejeu, quotePricing reste refusé', 'false',
   public.ai_is_supported_agent('quotePricing')::text);


select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;
