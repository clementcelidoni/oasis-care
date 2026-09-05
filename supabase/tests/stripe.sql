-- Oasis Care — LE LIEN AVEC LE PRESTATAIRE D'ENCAISSEMENT (migration 0083).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. UN DROIT NE S'OUVRE QUE SUR UN ENCAISSEMENT PROUVÉ. Les quatre
--      fonctions de la machine sont INEXÉCUTABLES par `anon` et par
--      `authenticated`, et un encaissement présenté sans l'événement
--      qui le prouve est REFUSÉ. Un client ne peut pas se déclarer payé.
--
--   2. L'IDEMPOTENCE EST TENUE PAR LA BASE, PAS PAR DU CODE. Le même
--      événement rejoué TROIS FOIS ne laisse qu'une ligne au journal et
--      qu'un seul encaissement — et on le prouve deux fois, par
--      l'unicité de l'événement puis par celle de la référence de
--      paiement, en court-circuitant volontairement la première.
--
--   3. AUCUN SECOND DOCUMENT COMPTABLE. `saas_document_counters` garde
--      ses deux natures. Vérifié par requête, parce que c'est
--      exactement ce qu'on ajoute six mois plus tard en croyant bien
--      faire.
--
--   4. JAMAIS UN MONTANT DEVINÉ. Une correspondance manquante, une
--      grille qui a bougé, une offre sur devis, un module compris dans
--      l'offre, un cycle annuel dont personne n'a fixé le prix : chaque
--      cas rend un MOTIF LISIBLE et un identifiant de tarif NUL.
--
--   5. LE JOURNAL EST EN AJOUT SEUL. Une ligne ne se réécrit pas, ne se
--      supprime pas, et la table ne se tronque pas.
--
--   6. LES GRANT PAR DÉFAUT DE SUPABASE N'ONT RIEN ROUVERT. C'est là que
--      0055 s'est fait avoir.
--
--   7. LE PIÈGE DE 0075. `billing.providers.*` était portée par le seul
--      super-administrateur ; une permission que personne ne porte fait
--      disparaître un écran sans un mot.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les correspondances, ni la facture, ni le numéro qu'elle a consommé.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0081 et 0083.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('cc830001-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-normal@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc830002-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-owner@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc830003-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-owner2@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc830010-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-super@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc830012-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-billing@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc830011-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-support@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc830014-0000-4000-8000-000000000083','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s3-analyst@test.invalid','',now(),now(),now(),now(),'{}','{}');

-- Deux entreprises Pro, toutes deux françaises et complètement
-- identifiées : c'est le cas où la facture PEUT partir, donc celui où
-- l'encaissement a un sens.
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages 83 A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','cc830003-0000-4000-8000-000000000083')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages 83 B','landscaper');

update public.business_organizations
   set legal_name = 'SARL 83 A', siret = '111 222 333 00083',
       address_line1 = '1 rue du Prestataire', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@83a.test'
 where id = (select v from ids where k='orgA');

update public.business_organizations
   set legal_name = 'SARL 83 B', siret = '444 555 666 00083',
       address_line1 = '2 rue du Prestataire', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@83b.test'
 where id = (select v from ids where k='orgB');

insert into public.platform_admins (user_id, role, note) values
 ('cc830010-0000-4000-8000-000000000083','super_admin','Test 0083'),
 ('cc830012-0000-4000-8000-000000000083','billing_admin','Test 0083'),
 ('cc830011-0000-4000-8000-000000000083','support','Test 0083'),
 ('cc830014-0000-4000-8000-000000000083','read_only_analyst','Test 0083')
on conflict (user_id) do update set role = excluded.role, is_active = true, revoked_at = null;

-- Les administrateurs réels sont mis de côté, dans la transaction
-- uniquement : le super-administrateur de production fausserait les
-- comptages de rôles.
update public.platform_admins
   set is_active = false, revoked_at = now()
 where user_id not in (
   'cc830010-0000-4000-8000-000000000083','cc830012-0000-4000-8000-000000000083',
   'cc830011-0000-4000-8000-000000000083','cc830014-0000-4000-8000-000000000083')
   and is_active;


-- ============================================================
-- 1. LE CATALOGUE DES PRESTATAIRES
-- ============================================================
reset role;

insert into res select 'Le prestataire retenu est Stripe','stripe',
  (select string_agg(key, ',' order by key) from public.billing_providers where is_active);

insert into res select 'Et la table n''en suppose pas un seul','2',
  (select count(*)::text from public.billing_providers);

insert into res select 'Revolut est présent mais NON retenu','false',
  (select is_active::text from public.billing_providers where key = 'revolut');


-- ============================================================
-- 2. LA SÉPARATION FORTE — personne ne s'encaisse tout seul
-- ============================================================
--
-- 2.a L'utilisateur ordinaire, puis le PROPRIÉTAIRE d'une entreprise
--     Pro. Le second est le cas dangereux : c'est lui qui a un intérêt
--     direct à se déclarer payé.
do $$
declare
  u text;
  f text;
  refuse boolean;
begin
  foreach u in array array[
    'cc830001-0000-4000-8000-000000000083',
    'cc830002-0000-4000-8000-000000000083'
  ]
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', u, 'aal', 'aal2')::text, true);
    set local role authenticated;

    foreach f in array array[
      'select public.billing_provider_event_record(''stripe'',''test'',''evt_pirate'',''invoice.paid'')',
      'select public.billing_provider_event_close(''stripe'',''evt_pirate'',''applied'')',
      'select public.billing_provider_link_customer(''stripe'',''test'',''00000000-0000-0000-0000-000000000000'',''cus_pirate'')',
      'select public.saas_record_provider_payment(''stripe'',''test'',''evt_pirate'',''00000000-0000-0000-0000-000000000000'',9588,''EUR'',''pi_pirate'')',
      'select public.admin_set_provider_price(''stripe'',''test'',''plan'',''team'',''monthly'',null,null,''price_pirate'',null,7990,''essai'')',
      'select public.admin_deactivate_provider_price(''00000000-0000-0000-0000-000000000000'',''essai'')'
    ]
    loop
      refuse := false;
      begin
        execute f;
      exception when others then refuse := true;
      end;
      insert into res values (
        'Non-administrateur — « ' || left(f, 56) || '… » lève', 'true', refuse::text);
    end loop;

    reset role;
  end loop;
end $$;

-- 2.b Et l'écriture directe dans les quatre tables neuves.
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

do $$
declare
  t text;
  refuse boolean;
begin
  foreach t in array array[
    'insert into public.billing_providers (key, label) values (''pirate'', ''Pirate'')',
    'update public.billing_providers set is_active = true where key = ''revolut''',
    'insert into public.billing_provider_prices (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents) values (''stripe'',''test'',''plan'',''team'',''monthly'',''price_pirate'',1)',
    'insert into public.billing_provider_customers (organization_id, provider, mode, provider_customer_id) values (''00000000-0000-0000-0000-000000000000'',''stripe'',''test'',''cus_pirate'')',
    'insert into public.billing_provider_events (provider, mode, provider_event_id, event_type) values (''stripe'',''test'',''evt_pirate'',''invoice.paid'')',
    'insert into public.saas_invoice_payments (invoice_id, amount_cents, method, external_reference) values (''00000000-0000-0000-0000-000000000000'', 9588, ''provider'', ''pi_pirate'')'
  ]
  loop
    refuse := false;
    begin
      execute t;
    exception when others then refuse := true;
    end;
    insert into res values ('Écriture directe refusée — « ' || left(t, 52) || '… »', 'true', refuse::text);
  end loop;
end $$;

reset role;


-- ============================================================
-- 3. LA CORRESPONDANCE — NOTRE PRIX FAIT AUTORITÉ
-- ============================================================
-- Le responsable facturation porte désormais `billing.providers.write`
-- (§ 10 de la migration). Second facteur exigé, comme pour tout geste
-- d'écriture du Control Center.
select set_config('request.jwt.claims',
  json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);

-- 3.a AVANT TOUTE CORRESPONDANCE : le paiement est INDISPONIBLE, avec
--     un motif lisible, et surtout SANS identifiant de tarif.
insert into res select 'Sans correspondance, le motif est lisible','providerPriceMissing',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

insert into res select 'Et AUCUN identifiant de tarif n''est rendu','NULL',
  coalesce((select provider_price_id from public.billing_provider_price_terms('stripe','test','plan','team','monthly')), 'NULL');

insert into res select 'Mais NOTRE prix, lui, est connu — 79,90 € HT','7990',
  (select our_amount_cents::text from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

-- 3.b LE MONTANT DÉCLARÉ EST CONFRONTÉ À NOTRE GRILLE, pas cru.
do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.admin_set_provider_price(
      'stripe','test','plan','team','monthly',null,null,
      'price_faux', 'prod_team', 6990, 'Recopie fautive du montant.');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('UN MONTANT QUI NE COLLE PAS À NOTRE GRILLE EST REFUSÉ','true',refuse::text);
  insert into res values ('Et le refus dit les DEUX montants','true',
    (v_msg like '%7990%' and v_msg like '%6990%')::text);
end $$;

-- 3.c La correspondance juste passe.
insert into ids select 'mapTeamM', public.admin_set_provider_price(
  'stripe','test','plan','team','monthly',null,null,
  'price_team_monthly','prod_team',7990,'Mise en correspondance de l''offre Pro mensuelle.');

insert into res select 'La correspondance est posée et ACTIVE','true',
  (select is_active::text from public.billing_provider_prices where id = (select v from ids where k='mapTeamM'));

insert into res select 'Elle est HORS TAXES, et il n''y a pas d''autre choix','exclusive',
  (select tax_behavior from public.billing_provider_prices where id = (select v from ids where k='mapTeamM'));

insert into res select 'Le paiement devient disponible','price_team_monthly',
  (select provider_price_id from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

insert into res select 'Sans le moindre motif de blocage','NULL',
  coalesce((select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','team','monthly')), 'NULL');

-- 3.d LE MODE FAIT PARTIE DE L'IDENTITÉ. La même case en production
--     n'existe pas — et c'est tout l'intérêt de la colonne : une clé
--     d'essai employée en production encaisserait zéro sans lever.
insert into res select 'LA MÊME CASE EN PRODUCTION N''EST PAS COUVERTE','providerPriceMissing',
  (select blocking_reason from public.billing_provider_price_terms('stripe','live','plan','team','monthly'));

-- 3.e DEUX CORRESPONDANCES ACTIVES POUR LA MÊME CASE : impossible.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.billing_provider_prices
      (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents)
    values ('stripe','test','plan','team','monthly','price_team_monthly_bis',7990);
  exception when others then refuse := true;
  end;
  insert into res values ('DEUX TARIFS ACTIFS POUR UNE MÊME CASE : REFUSÉ','true',refuse::text);
end $$;

-- 3.f UN TARIF DU PRESTATAIRE NE SERT QU'UNE CASE.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.billing_provider_prices
      (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents)
    values ('stripe','test','plan','solo','monthly','price_team_monthly',3990);
  exception when others then refuse := true;
  end;
  insert into res values ('UN TARIF DU PRESTATAIRE NE SERT QU''UNE CASE','true',refuse::text);
end $$;

-- 3.f bis ET PAR LA FONCTION AUSSI — c'est le cas le plus vicieux. Le
--     `on conflict` de la fonction vise l'identifiant du tarif : sans
--     contrôle explicite, réutiliser « price_team_monthly » pour Pro
--     Solo n'aurait pas créé la correspondance visée, il aurait
--     RÉÉCRIT LE MONTANT de la correspondance de Pro. Un succès rendu
--     à l'appelant, une case saine corrompue, et rien pour le dire.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_set_provider_price(
      'stripe','test','plan','solo','monthly',null,null,
      'price_team_monthly','prod_solo',3990,'Réemploi fautif d''un tarif déjà pris.');
  exception when others then refuse := true;
  end;
  insert into res values ('RÉEMPLOYER UN TARIF POUR UNE AUTRE CASE EST REFUSÉ','true',refuse::text);
end $$;

insert into res select 'ET LE MONTANT DE LA CASE D''ORIGINE N''A PAS BOUGÉ','7990',
  (select unit_amount_cents::text from public.billing_provider_prices
    where provider_price_id = 'price_team_monthly');

insert into res select 'La case visée n''a rien reçu','providerPriceMissing',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','solo','monthly'));

-- 3.g LA FORME DE LA CLÉ DÉPEND DE LA NATURE.
do $$
declare
  c record;
  refuse boolean;
begin
  for c in select * from (values
    -- « module » sans module : une correspondance qui pointe vers le vide.
    ('module sans module_key', 'insert into public.billing_provider_prices (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents) values (''stripe'',''test'',''module'',''team'',''monthly'',''price_x1'',2000)'),
    -- « plan » sans cycle : mensuel ou annuel, on ne devine pas.
    ('plan sans cycle',        'insert into public.billing_provider_prices (provider, mode, kind, plan_key, provider_price_id, unit_amount_cents) values (''stripe'',''test'',''plan'',''team'',''price_x2'',7990)'),
    -- « discount » sans code.
    ('remise sans code',       'insert into public.billing_provider_prices (provider, mode, kind, billing_cycle, provider_price_id, unit_amount_cents) values (''stripe'',''test'',''discount'',''monthly'',''price_x3'',2990)'),
    -- Un montant à zéro encaisserait zéro sans lever d''erreur.
    ('tarif à zéro',           'insert into public.billing_provider_prices (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents) values (''stripe'',''test'',''plan'',''solo'',''monthly'',''price_x4'',0)'),
    -- Un tarif « toutes taxes comprises » ferait payer la TVA française
    -- à un client en autoliquidation.
    ('tarif TTC',              'insert into public.billing_provider_prices (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents, tax_behavior) values (''stripe'',''test'',''plan'',''solo'',''monthly'',''price_x5'',3990,''inclusive'')'),
    -- Un mode inventé.
    ('mode inventé',           'insert into public.billing_provider_prices (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents) values (''stripe'',''sandbox'',''plan'',''solo'',''monthly'',''price_x6'',3990)'),
    -- Un prestataire inconnu.
    ('prestataire inconnu',    'insert into public.billing_provider_prices (provider, mode, kind, plan_key, billing_cycle, provider_price_id, unit_amount_cents) values (''paypal'',''test'',''plan'',''solo'',''monthly'',''price_x7'',3990)')
  ) t(nom, sql)
  loop
    refuse := false;
    begin
      execute c.sql;
    exception when others then refuse := true;
    end;
    insert into res values ('La base refuse une correspondance mal formée — ' || c.nom, 'true', refuse::text);
  end loop;
end $$;

-- 3.h LA DÉRIVE. Notre grille bouge, la correspondance ne suit pas :
--     encaisser reviendrait à facturer l'ancien montant, en silence.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830010-0000-4000-8000-000000000083','aal','aal2')::text, true);

select public.admin_set_plan_pricing('team', 8990, 89900, 'Hausse de tarif — épreuve de la dérive.');

insert into res select 'UNE GRILLE QUI BOUGE SANS LA CORRESPONDANCE : DÉRIVE','amountDrift',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

insert into res select 'Et le tarif du prestataire n''est PLUS rendu','NULL',
  coalesce((select provider_price_id from public.billing_provider_price_terms('stripe','test','plan','team','monthly')), 'NULL');

insert into res select 'Les deux montants restent lisibles pour l''écran','8990/7990',
  (select our_amount_cents::text || '/' || mapped_amount_cents::text
     from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

-- On remet la grille en place pour la suite.
select public.admin_set_plan_pricing('team', 7990, 79900, 'Retour au tarif public.');

insert into res select 'Grille remise : le paiement redevient disponible','NULL',
  coalesce((select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','team','monthly')), 'NULL');


-- ============================================================
-- 4. LES CAS OÙ L'ON REFUSE DE VENDRE
-- ============================================================
-- Chacun rend un MOTIF, jamais un montant.
insert into res select 'Une offre SUR DEVIS ne se vend pas en libre-service','planIsQuoteOnly',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','enterprise','monthly'));

insert into res select 'Une offre RETIRÉE de la grille non plus','planInactive',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','nursery','monthly'));

insert into res select 'Un module COMPRIS dans l''offre ne se vend pas deux fois','moduleIncludedInPlan',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','module','business','monthly','biolab'));

insert into res select 'Un module NON LIVRÉ ne se vend pas','moduleUndecidedOnPlan',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','module','team','monthly','whiteLabel'));

insert into res select 'Un module en option a bien un prix — 20 € HT','2000',
  (select our_amount_cents::text from public.billing_provider_price_terms('stripe','test','module','team','monthly','biolab'));

-- LE SIÈGE SUPPLÉMENTAIRE ET LE TARIF FONDATEUR N'ONT PAS DE PRIX
-- ANNUEL, et 0081 refuse explicitement de trancher. On ne tranche pas
-- non plus : on bloque, et l'écran doit le dire plutôt que de laisser
-- un client cliquer sur un annuel qui ne pourra pas être facturé.
insert into res select 'Le siège supplémentaire a un prix MENSUEL','990',
  (select our_amount_cents::text from public.billing_provider_price_terms('stripe','test','seat','team','monthly'));

insert into res select 'MAIS PAS DE PRIX ANNUEL — personne ne l''a fixé','seatYearlyPriceUndecided',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','seat','team','yearly'));

-- 49,90 € ET NON 29,90 : 0081 a été enrichie depuis l'écriture de ce
-- test (`requires_commitment` / `commitment_months = 12`), et le
-- dirigeant a confirmé 49,90 € HT sur douze mois avec engagement. C'est
-- l'attendu qui avait vieilli, pas la migration.
insert into res select 'Le tarif Fondateur vaut 49,90 € par mois','4990',
  (select our_amount_cents::text from public.billing_provider_price_terms('stripe','test','discount','team','monthly',null,'FONDATEUR'));

insert into res select 'ET RIEN EN ANNUEL : dix mois ou douze, 0081 refuse de trancher','discountYearlyUndecided',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','discount','team','yearly',null,'FONDATEUR'));

-- ------------------------------------------------------------
-- LA REMISE RÉSERVÉE À UNE OFFRE NE DÉBORDE PAS
-- ------------------------------------------------------------
-- Le trou était béant et marchait dans les DEUX SENS : le tarif
-- fondateur (49,90 €, réservé à `team` par 0081) se substituait au prix
-- de n'importe quelle offre demandée. Sur Pro Business (139,90 €) on
-- encaissait 49,90 — 90 € offerts par mois et par client. Sur Pro Solo
-- (39,90 €) on encaissait 49,90 — le client payait 10 € DE PLUS que le
-- tarif public, sous une ligne libellée « Tarif fondateur ».
insert into res select 'FONDATEUR sur BUSINESS est refusé','discountReservedToAnotherPlan',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','discount','business','monthly',null,'FONDATEUR'));

insert into res select 'FONDATEUR sur SOLO est refusé aussi (il ferait payer PLUS)','discountReservedToAnotherPlan',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','discount','solo','monthly',null,'FONDATEUR'));

insert into res select 'ET AUCUN TARIF N''EST RENDU quand la remise déborde','',
  (select coalesce(provider_price_id,'') from public.billing_provider_price_terms('stripe','test','discount','business','monthly',null,'FONDATEUR'));

-- UNE OFFRE NON PRÉCISÉE NE VAUT PAS AUTORISATION. C'est exactement
-- l'appel que faisait le tunnel de paiement avant correction : il ne
-- passait pas l'offre, donc la restriction n'était jamais vérifiée.
insert into res select 'Sans offre précisée, une remise restreinte est refusée','discountPlanUnspecified',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','discount',null,'monthly',null,'FONDATEUR'));

insert into res select 'Un prestataire inconnu bloque','providerUnknown',
  (select blocking_reason from public.billing_provider_price_terms('paypal','test','plan','team','monthly'));

insert into res select 'Un prestataire NON RETENU bloque aussi','providerNotRetained',
  (select blocking_reason from public.billing_provider_price_terms('revolut','test','plan','team','monthly'));

insert into res select 'Un mode inventé bloque','modeUnknown',
  (select blocking_reason from public.billing_provider_price_terms('stripe','sandbox','plan','team','monthly'));

-- ET LA FONCTION NE LÈVE JAMAIS : elle rend TOUJOURS exactement une
-- ligne. Un écran qui l'appelle pour six cases ne doit pas s'effondrer
-- parce que la sixième n'est pas décidée.
do $$
declare
  c record;
  n integer;
  total integer := 0;
  ok integer := 0;
begin
  for c in select * from (values
    ('stripe','test','plan','team','monthly',null,null),
    ('stripe','test','plan','enterprise','yearly',null,null),
    ('stripe','test','plan','inconnu','monthly',null,null),
    ('stripe','test','seat','team','yearly',null,null),
    ('stripe','test','module','team','monthly','biolab',null),
    ('stripe','test','module','team','monthly','inconnu',null),
    ('stripe','test','discount',null,'monthly',null,'FONDATEUR'),
    ('stripe','test','discount',null,'monthly',null,'INCONNU'),
    ('stripe','test','autre','team','monthly',null,null),
    ('paypal','live','plan',null,null,null,null)
  ) t(pv, md, kd, pk, bc, mk, dc)
  loop
    total := total + 1;
    begin
      select count(*) into n from public.billing_provider_price_terms(c.pv, c.md, c.kd, c.pk, c.bc, c.mk, c.dc);
      if n = 1 then ok := ok + 1; end if;
    exception when others then null;
    end;
  end loop;
  insert into res values ('La lecture NE LÈVE JAMAIS et rend toujours une ligne', total::text, ok::text);
end $$;


-- ============================================================
-- 5. LE CLIENT CHEZ LE PRESTATAIRE
-- ============================================================
reset role;

insert into res select 'Rattachement d''un client','linked',
  public.billing_provider_link_customer('stripe','test',(select v from ids where k='orgA'),'cus_A_test');

insert into res select 'Le même rattachement rejoué ne casse rien','alreadyLinked',
  public.billing_provider_link_customer('stripe','test',(select v from ids where k='orgA'),'cus_A_test');

do $$
declare refuse boolean := false;
begin
  begin
    perform public.billing_provider_link_customer('stripe','test',(select v from ids where k='orgA'),'cus_A_autre');
  exception when others then refuse := true;
  end;
  insert into res values ('UN SECOND CLIENT POUR LA MÊME ENTREPRISE EST REFUSÉ','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.billing_provider_link_customer('stripe','test',(select v from ids where k='orgB'),'cus_A_test');
  exception when others then refuse := true;
  end;
  insert into res values ('ET LE MÊME CLIENT POUR DEUX ENTREPRISES AUSSI','true',refuse::text);
end $$;

-- Le MODE sépare : le même identifiant en production est un autre lien.
insert into res select 'Le mode sépare les rattachements','linked',
  public.billing_provider_link_customer('stripe','live',(select v from ids where k='orgA'),'cus_A_test');

insert into res select 'Et l''entreprise a bien DEUX liens, un par mode','2',
  (select count(*)::text from public.billing_provider_customers
    where organization_id = (select v from ids where k='orgA'));


-- ============================================================
-- 6. LE JOURNAL — L'IDEMPOTENCE EST UNE CONTRAINTE, PAS UN « IF »
-- ============================================================
insert into res select 'Premier passage de l''événement','accepted',
  public.billing_provider_event_record('stripe','test','evt_83_paid','invoice.paid','2026-09-01',
    now(), jsonb_build_object('amountCents', 9588));

insert into res select 'DEUXIÈME PASSAGE DU MÊME ÉVÉNEMENT','duplicate',
  public.billing_provider_event_record('stripe','test','evt_83_paid','invoice.paid','2026-09-01',
    now(), jsonb_build_object('amountCents', 9588));

insert into res select 'TROISIÈME PASSAGE','duplicate',
  public.billing_provider_event_record('stripe','test','evt_83_paid','invoice.paid','2026-09-01',
    now(), jsonb_build_object('amountCents', 9588));

insert into res select 'UNE SEULE LIGNE AU JOURNAL APRÈS TROIS PASSAGES','1',
  (select count(*)::text from public.billing_provider_events where provider_event_id = 'evt_83_paid');

insert into res select 'Elle est en attente de traitement','pending',
  (select outcome from public.billing_provider_events where provider_event_id = 'evt_83_paid');

-- Un événement sans identifiant ne peut pas être dédoublonné.
do $$
declare
  c record;
  refuse boolean;
begin
  for c in select * from (values
    ('sans identifiant', 'select public.billing_provider_event_record(''stripe'',''test'','' '',''invoice.paid'')'),
    ('sans nature',      'select public.billing_provider_event_record(''stripe'',''test'',''evt_x'','''')'),
    ('mode inventé',     'select public.billing_provider_event_record(''stripe'',''sandbox'',''evt_x'',''invoice.paid'')'),
    ('prestataire inconnu','select public.billing_provider_event_record(''paypal'',''test'',''evt_x'',''invoice.paid'')')
  ) t(nom, sql)
  loop
    refuse := false;
    begin
      execute c.sql;
    exception when others then refuse := true;
    end;
    insert into res values ('Événement refusé — ' || c.nom, 'true', refuse::text);
  end loop;
end $$;

-- 6.a AJOUT SEUL.
do $$
declare
  c record;
  refuse boolean;
begin
  for c in select * from (values
    ('réécriture de la nature',   'update public.billing_provider_events set event_type = ''invoice.voided'' where provider_event_id = ''evt_83_paid'''),
    ('réécriture du résumé',      'update public.billing_provider_events set summary = ''{}''::jsonb where provider_event_id = ''evt_83_paid'''),
    ('réécriture de l''identifiant','update public.billing_provider_events set provider_event_id = ''evt_autre'' where provider_event_id = ''evt_83_paid'''),
    ('clôture sans date',         'update public.billing_provider_events set outcome = ''applied'' where provider_event_id = ''evt_83_paid'''),
    ('suppression',               'delete from public.billing_provider_events where provider_event_id = ''evt_83_paid'''),
    ('troncature',                'truncate public.billing_provider_events')
  ) t(nom, sql)
  loop
    refuse := false;
    begin
      execute c.sql;
    exception when others then refuse := true;
    end;
    insert into res values ('Journal en AJOUT SEUL — ' || c.nom || ' refusée', 'true', refuse::text);
  end loop;
end $$;


-- ============================================================
-- 7. LA FACTURE — NOTRE DOCUMENT, ET LE SEUL
-- ============================================================
-- On monte une vraie facture émise : identité de l'émetteur, abonnement
-- Pro mensuel, génération, émission. C'est sur elle que l'encaissement
-- se posera.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830010-0000-4000-8000-000000000083','aal','aal2')::text, true);

select public.admin_set_billing_issuer(jsonb_build_object(
  'legal_name','Oasis Care SAS (test 0083)',
  'legal_form','SAS',
  'siret','999 888 777 00083',
  'vat_number','FR00999888777',
  'address_line1','1 avenue du Test',
  'postal_code','75001',
  'city','Paris',
  'iban','FR7630000000000000000000000',
  'late_penalty_terms','Pénalités de retard : trois fois le taux d''intérêt légal. Indemnité forfaitaire de recouvrement : 40 €.'
), 'Mise en place de la facturation, épreuve du prestataire.');

select set_config('request.jwt.claims',
  json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);

select public.admin_create_subscription(
  (select v from ids where k='orgA'), 'team', 'monthly',
  'Client Pro mensuel, épreuve du prestataire.', 'active');

insert into ids select 'inv', invoice_id from public.saas_generate_invoices(
  'monthly', date '2026-03-01', date '2026-04-01', 'Facturation de mars.', false)
  where organization_id = (select v from ids where k='orgA');

-- LA PREUVE QUE LES PRIX SONT HORS TAXES, refaite ici pour qu'elle soit
-- sous les yeux de qui lit ce fichier : 79,90 HT + 15,98 = 95,88 TTC.
insert into res select 'La facture est en HORS TAXES : 7990 + 1598 = 9588','7990/1598/9588',
  (select total_excluding_vat_cents::text || '/' || total_vat_cents::text || '/' || total_including_vat_cents::text
     from public.saas_invoice_totals where invoice_id = (select v from ids where k='inv'));

-- 7.a ON N'ENCAISSE PAS UN BROUILLON.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.saas_record_provider_payment(
      'stripe','test','evt_83_paid',(select v from ids where k='inv'),9588,'EUR','pi_83_1');
  exception when others then refuse := true;
  end;
  insert into res values ('ON N''ENCAISSE PAS UN BROUILLON','true',refuse::text);
end $$;

insert into ids select 'num', null::uuid;
do $$
declare v_num text;
begin
  v_num := public.saas_issue_invoice((select v from ids where k='inv'), 'Émission de la facture de mars.');
  insert into res values ('La facture porte un numéro de NOTRE séquence','true',
    (v_num like 'FS-%')::text);
end $$;


-- ============================================================
-- 8. L'ENCAISSEMENT
-- ============================================================
reset role;

-- 8.a UN DROIT NE S'OUVRE QUE SUR UN ENCAISSEMENT PROUVÉ. Sans
--     l'événement au journal, rien ne passe — c'est ce qui empêche un
--     appelant de fabriquer un paiement.
do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.saas_record_provider_payment(
      'stripe','test','evt_jamais_recu',(select v from ids where k='inv'),9588,'EUR','pi_83_faux');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('SANS ÉVÉNEMENT AU JOURNAL, AUCUN ENCAISSEMENT','true',refuse::text);
  insert into res values ('Et le refus le dit','true', (v_msg like '%journal%')::text);
end $$;

-- 8.b Les refus de forme.
do $$
declare
  c record;
  refuse boolean;
begin
  for c in select * from (values
    ('montant nul',        'select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_paid'',(select v from ids where k=''inv''),0,''EUR'',''pi_z'')'),
    ('montant négatif',    'select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_paid'',(select v from ids where k=''inv''),-9588,''EUR'',''pi_n'')'),
    ('sans référence',     'select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_paid'',(select v from ids where k=''inv''),9588,''EUR'','' '')'),
    ('devise incohérente', 'select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_paid'',(select v from ids where k=''inv''),9588,''USD'',''pi_u'')'),
    ('mode incohérent',    'select public.saas_record_provider_payment(''stripe'',''live'',''evt_83_paid'',(select v from ids where k=''inv''),9588,''EUR'',''pi_m'')'),
    ('facture inconnue',   'select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_paid'',''00000000-0000-0000-0000-000000000000'',9588,''EUR'',''pi_f'')')
  ) t(nom, sql)
  loop
    refuse := false;
    begin
      execute c.sql;
    exception when others then refuse := true;
    end;
    insert into res values ('Encaissement refusé — ' || c.nom, 'true', refuse::text);
  end loop;
end $$;

-- 8.c L'ENCAISSEMENT, POUR DE BON.
insert into res select 'L''encaissement est enregistré','recorded',
  public.saas_record_provider_payment(
    'stripe','test','evt_83_paid',(select v from ids where k='inv'),9588,'EUR','pi_83_ok');

insert into res select 'LE STATUT SUIT L''ARGENT : la facture est payée','paid',
  (select status from public.saas_invoices where id = (select v from ids where k='inv'));

insert into res select 'Le moyen de règlement est bien « provider »','provider',
  (select payment_method from public.saas_invoices where id = (select v from ids where k='inv'));

insert into res select 'La référence du prestataire est sur la facture','pi_83_ok',
  (select external_payment_reference from public.saas_invoices where id = (select v from ids where k='inv'));

insert into res select 'Le solde restant est ZÉRO, ni plus ni moins','0',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='inv'));

insert into res select 'L''encaissement est relié à l''ÉVÉNEMENT qui l''a prouvé','true',
  (select (p.provider_event_id = e.id)::text
     from public.saas_invoice_payments p, public.billing_provider_events e
    where p.invoice_id = (select v from ids where k='inv')
      and e.provider_event_id = 'evt_83_paid');

-- L'AUDIT NOMME LA MACHINE, et ne désigne aucun humain au hasard.
insert into res select 'Le journal d''audit porte un acteur MACHINE','system',
  (select admin_role from public.admin_audit_events
    where action = 'saasInvoice.providerPaymentRecorded'
      and target_id = (select v from ids where k='inv'));

insert into res select 'ET AUCUN humain n''est désigné','true',
  (select (admin_user_id is null)::text from public.admin_audit_events
    where action = 'saasInvoice.providerPaymentRecorded'
      and target_id = (select v from ids where k='inv'));

insert into res select 'L''encaissement pointe sa ligne d''audit','true',
  (select (audit_event_id is not null)::text from public.saas_invoice_payments
    where invoice_id = (select v from ids where k='inv'));

-- 8.d LE REJEU — TROIS FOIS, ET UN SEUL EFFET.
insert into res select 'Rejeu 2 du même paiement','duplicate',
  public.saas_record_provider_payment(
    'stripe','test','evt_83_paid',(select v from ids where k='inv'),9588,'EUR','pi_83_ok');

insert into res select 'Rejeu 3 du même paiement','duplicate',
  public.saas_record_provider_payment(
    'stripe','test','evt_83_paid',(select v from ids where k='inv'),9588,'EUR','pi_83_ok');

insert into res select 'UN SEUL ENCAISSEMENT APRÈS TROIS PASSAGES','1',
  (select count(*)::text from public.saas_invoice_payments
    where invoice_id = (select v from ids where k='inv'));

insert into res select 'LE SOLDE N''EST PAS DEVENU NÉGATIF','0',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='inv'));

insert into res select 'Une seule ligne d''audit, pas trois','1',
  (select count(*)::text from public.admin_audit_events
    where action = 'saasInvoice.providerPaymentRecorded'
      and target_id = (select v from ids where k='inv'));

-- 8.e ET MÊME EN COURT-CIRCUITANT LE JOURNAL. Le rejeu passe ici par un
--     AUTRE événement : c'est alors l'unicité de la référence de
--     paiement, et elle seule, qui arrête le doublon. Les deux barrières
--     sont donc indépendantes, et c'est le but.
select public.billing_provider_event_record('stripe','test','evt_83_paid_bis','invoice.paid');

insert into res select 'AUTRE ÉVÉNEMENT, MÊME PAIEMENT : encore refusé','duplicate',
  public.saas_record_provider_payment(
    'stripe','test','evt_83_paid_bis',(select v from ids where k='inv'),9588,'EUR','pi_83_ok');

insert into res select 'Toujours un seul encaissement','1',
  (select count(*)::text from public.saas_invoice_payments
    where invoice_id = (select v from ids where k='inv'));

-- 8.f LA CLÔTURE DE L'ÉVÉNEMENT.
insert into res select 'L''événement se clôt','closed',
  public.billing_provider_event_close('stripe','evt_83_paid','applied');

insert into res select 'Et il est daté','true',
  (select (processed_at is not null)::text from public.billing_provider_events
    where provider_event_id = 'evt_83_paid');

insert into res select 'Le rejeu de la clôture ne casse rien','alreadyClosed',
  public.billing_provider_event_close('stripe','evt_83_paid','applied');

do $$
declare refuse boolean := false;
begin
  begin
    update public.billing_provider_events
       set outcome = 'pending', processed_at = null
     where provider_event_id = 'evt_83_paid';
  exception when others then refuse := true;
  end;
  insert into res values ('UN ÉVÉNEMENT CLOS NE SE ROUVRE PAS','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.billing_provider_event_close('stripe','evt_jamais_recu','applied');
  exception when others then refuse := true;
  end;
  insert into res values ('On ne clôt pas ce qu''on n''a pas inscrit','true',refuse::text);
end $$;

-- 8.g UN PAIEMENT PARTIEL LAISSE LA FACTURE OUVERTE. Le statut se
--     déduit du solde, il ne se décrète pas.
do $$
declare v_inv uuid; v_num text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);

  insert into public.organization_subscriptions
    (organization_id, plan, status, billing_cycle, started_at, current_period_end)
  values ((select v from ids where k='orgB'), 'team', 'active', 'monthly', now(), now() + interval '30 days')
  on conflict (organization_id) do update
    set plan = 'team', status = 'active', billing_cycle = 'monthly';

  select gi.invoice_id into v_inv from public.saas_generate_invoices(
    'monthly', date '2026-04-01', date '2026-05-01', 'Facturation d''avril.', false) gi
   where gi.organization_id = (select v from ids where k='orgB');

  v_num := public.saas_issue_invoice(v_inv, 'Émission de la facture d''avril.');
  insert into ids values ('invB', v_inv);
end $$;

reset role;

select public.billing_provider_event_record('stripe','test','evt_83_partial','invoice.partially_paid');

insert into res select 'Un acompte s''enregistre','recorded',
  public.saas_record_provider_payment(
    'stripe','test','evt_83_partial',(select v from ids where k='invB'),5000,'EUR','pi_83_acompte');

insert into res select 'LA FACTURE RESTE ÉMISE, elle n''est pas « payée »','issued',
  (select status from public.saas_invoices where id = (select v from ids where k='invB'));

insert into res select 'Et il reste 45,88 € à régler','4588',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='invB'));

insert into res select 'L''état effectif dit « partiellement payée »','partiallyPaid',
  (select effective_status from public.saas_invoice_state
    where invoice_id = (select v from ids where k='invB'));


-- ============================================================
-- 9. AUCUN SECOND DOCUMENT COMPTABLE
-- ============================================================
-- LA RÈGLE DU CHANTIER, VÉRIFIÉE PAR REQUÊTE. Le prestataire encaisse ;
-- Oasis Care facture. Deux numérotations, ce serait deux documents pour
-- un seul achat, et le client ne saurait pas lequel opposer.
-- On compte les natures ÉTRANGÈRES plutôt que d'énumérer les nôtres :
-- 'creditNote' n'apparaît qu'après le premier avoir, et un test qui
-- l'exigerait serait rouge pour une raison qui n'a rien à voir avec le
-- prestataire. Ce qu'on défend, c'est qu'AUCUNE troisième nature
-- n'apparaisse.
insert into res select 'Le compteur ne connaît QUE nos deux natures','0',
  (select count(*)::text from public.saas_document_counters
    where kind not in ('invoice', 'creditNote'));

insert into res select 'Et la facture émise vient bien de NOTRE séquence','1',
  (select count(*)::text from public.saas_document_counters where kind = 'invoice');

insert into res select 'Une seule facture émise pour l''entreprise A','1',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA') and issued_at is not null);

insert into res select 'Aucune table de 0083 ne porte de numéro de document','0',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public'
      and table_name like 'billing!_provider%' escape '!'
      and column_name in ('number', 'invoice_number', 'document_number'));


-- ============================================================
-- 10. LES DROITS — c'est là que 0055 s'est fait avoir
-- ============================================================
reset role;

do $$
declare t text;
begin
  foreach t in array array[
    'billing_providers', 'billing_provider_prices',
    'billing_provider_customers', 'billing_provider_events'
  ]
  loop
    insert into res values (
      'anon ne lit rien de public.' || t, 'false',
      has_table_privilege('anon', 'public.' || t, 'select')::text);
    insert into res values (
      'authenticated n''écrit rien dans public.' || t, 'false',
      (has_table_privilege('authenticated', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'update')
       or has_table_privilege('authenticated', 'public.' || t, 'delete'))::text);
    insert into res values (
      'Et la RLS est allumée sur public.' || t, 'true',
      (select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t));
  end loop;
end $$;

-- LES QUATRE PORTES DE LA MACHINE. « Enregistrer un encaissement »
-- appelé depuis un navigateur, ce serait un abonnement gratuit.
do $$
declare f text;
begin
  foreach f in array array[
    'public.billing_provider_event_record(text, text, text, text, text, timestamptz, jsonb)',
    'public.billing_provider_event_close(text, text, text, text)',
    'public.billing_provider_link_customer(text, text, uuid, text)',
    'public.saas_record_provider_payment(text, text, text, uuid, bigint, text, text, date)'
  ]
  loop
    insert into res values (
      'anon n''exécute pas ' || left(f, 44) || '…', 'false',
      has_function_privilege('anon', f, 'execute')::text);
    insert into res values (
      'AUTHENTICATED NON PLUS — ' || left(f, 44) || '…', 'false',
      has_function_privilege('authenticated', f, 'execute')::text);
  end loop;
end $$;

-- Les gestes d'administration, eux, passent par un jeton : ils sont
-- accordés à `authenticated`, et la garde est À L'INTÉRIEUR.
do $$
declare f text;
begin
  foreach f in array array[
    'public.billing_provider_price_terms(text, text, text, text, text, text, text)',
    'public.admin_set_provider_price(text, text, text, text, text, text, text, text, text, bigint, text, text)',
    'public.admin_deactivate_provider_price(uuid, text)'
  ]
  loop
    insert into res values (
      'anon n''exécute pas ' || left(f, 40) || '…', 'false',
      has_function_privilege('anon', f, 'execute')::text);
    insert into res values (
      'authenticated exécute ' || left(f, 40) || '…', 'true',
      has_function_privilege('authenticated', f, 'execute')::text);
  end loop;
end $$;

-- Toutes les fonctions neuves épinglent leur `search_path` : sans cela,
-- un appelant qui crée une table temporaire homonyme détourne une
-- fonction `security definer`.
insert into res select 'Toutes les fonctions de 0083 épinglent leur search_path','0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('billing_provider_price_terms','billing_provider_event_record',
                        'billing_provider_event_close','billing_provider_link_customer',
                        'saas_record_provider_payment','admin_set_provider_price',
                        'admin_deactivate_provider_price','billing_provider_events_append_only')
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%');

-- Et aucune ne s'est retrouvée exécutable par `public` — le pseudo-rôle
-- dont le droit est hérité par tout le monde.
insert into res select 'Aucune fonction de 0083 n''est ouverte au pseudo-rôle public','0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('billing_provider_event_record','billing_provider_event_close',
                        'billing_provider_link_customer','saas_record_provider_payment')
      and has_function_privilege('public', p.oid, 'execute'));


-- ============================================================
-- 11. LA MATRICE — le piège de 0075, une fois de plus
-- ============================================================
insert into res select 'Le super-administrateur porte TOUT le catalogue','0',
  (select count(*)::text from public.platform_admin_permissions p
    where not exists (select 1 from public.platform_admin_role_permissions rp
                       where rp.role = 'super_admin' and rp.permission = p.key));

insert into res select 'La facturation tient la correspondance','billing_admin, super_admin',
  (select string_agg(role, ', ' order by role) from public.platform_admin_role_permissions
    where permission = 'billing.providers.write');

insert into res select 'Le support LIT le journal du prestataire','true',
  (select exists (select 1 from public.platform_admin_role_permissions
                   where role = 'support' and permission = 'billing.providers.read'))::text;

insert into res select 'MAIS IL N''Y ÉCRIT PAS','false',
  (select exists (select 1 from public.platform_admin_role_permissions
                   where role = 'support' and permission = 'billing.providers.write'))::text;

insert into res select 'L''analyste en lecture seule ne reçoit rien','false',
  (select exists (select 1 from public.platform_admin_role_permissions
                   where role = 'read_only_analyst' and permission like 'billing.providers.%'))::text;

-- ET CE QUE LA BASE REFUSE D'Y ÉCRIRE. Une absence peut être comblée
-- par distraction ; un refus doit être supprimé exprès.
do $$
declare
  c record;
  refuse boolean;
begin
  for c in select * from (values
    ('support','billing.providers.write'),
    ('security_admin','billing.providers.write'),
    ('product_admin','billing.providers.write'),
    ('read_only_analyst','billing.providers.write')
  ) t(r, pm)
  loop
    refuse := false;
    begin
      insert into public.platform_admin_role_permissions (role, permission) values (c.r, c.pm);
      delete from public.platform_admin_role_permissions where role = c.r and permission = c.pm;
    exception when others then refuse := true;
    end;
    insert into res values ('Le garde-fou refuse « ' || c.r || ' ← ' || c.pm || ' »', 'true', refuse::text);
  end loop;
end $$;


-- ============================================================
-- 12. LE SUPPORT ET L'ANALYSTE À L'ŒUVRE
-- ============================================================
-- 12.a Le support lit le journal, et n'écrit rien.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830011-0000-4000-8000-000000000083','aal','aal2')::text, true);
set local role authenticated;

insert into res select 'Le support VOIT le journal du prestataire','true',
  (select count(*) > 0 from public.billing_provider_events)::text;

insert into res select 'Et la correspondance des tarifs','true',
  (select count(*) > 0 from public.billing_provider_prices)::text;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_set_provider_price(
      'stripe','test','plan','solo','monthly',null,null,'price_solo','prod_solo',3990,'Essai support.');
  exception when others then refuse := true;
  end;
  insert into res values ('MAIS IL NE POSE AUCUNE CORRESPONDANCE','true',refuse::text);
end $$;

-- 12.b L'analyste en lecture seule n'écrit rien, nulle part.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830014-0000-4000-8000-000000000083','aal','aal2')::text, true);
set local role authenticated;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select public.admin_set_provider_price(''stripe'',''test'',''plan'',''solo'',''monthly'',null,null,''price_solo'',null,3990,''essai'')',
    'select public.admin_deactivate_provider_price((select v from ids where k=''mapTeamM''),''essai'')',
    'select public.billing_provider_event_record(''stripe'',''test'',''evt_analyste'',''invoice.paid'')',
    'select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_paid'',(select v from ids where k=''inv''),100,''EUR'',''pi_analyste'')'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('Analyste en lecture seule — « ' || left(f, 50) || '… » lève', 'true', refuse::text);
  end loop;
end $$;

-- 12.c LE CLIENT NE VOIT PAS LA CORRESPONDANCE. Il n'a rien à faire de
--      nos clés de tarif ; ce qu'il doit savoir passe par la fonction.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'Le client ne voit AUCUNE correspondance de tarif','0',
  (select count(*)::text from public.billing_provider_prices);

insert into res select 'Ni AUCUN événement du prestataire','0',
  (select count(*)::text from public.billing_provider_events);

insert into res select 'Ni le rattachement de sa propre entreprise','0',
  (select count(*)::text from public.billing_provider_customers);

insert into res select 'Mais il voit QUI encaisse — ce n''est pas un secret','2',
  (select count(*)::text from public.billing_providers);

-- ET IL PEUT DEMANDER SI LE PAIEMENT EST DISPONIBLE, parce que la
-- route serveur de web-pro s'exécute sous son jeton.
insert into res select 'Et il peut demander si le paiement est disponible','price_team_monthly',
  (select provider_price_id from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));


-- ============================================================
-- 13. LA DÉSACTIVATION D'UNE CORRESPONDANCE
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);

select public.admin_deactivate_provider_price(
  (select v from ids where k='mapTeamM'), 'Le tarif a été remplacé chez le prestataire.');

insert into res select 'LE PAIEMENT REDEVIENT INDISPONIBLE','providerPriceMissing',
  (select blocking_reason from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

insert into res select 'La ligne n''est pas supprimée : elle dit ce qui a été facturé','1',
  (select count(*)::text from public.billing_provider_prices
    where id = (select v from ids where k='mapTeamM') and not is_active);

insert into res select 'Et elle porte sa date de désactivation','true',
  (select (deactivated_at is not null)::text from public.billing_provider_prices
    where id = (select v from ids where k='mapTeamM'));

insert into res select 'La redemander ne casse rien','true',
  (public.admin_deactivate_provider_price(
     (select v from ids where k='mapTeamM'), 'Rejeu de la désactivation.')
   = (select v from ids where k='mapTeamM'))::text;

-- LA PLACE EST LIBRE : une correspondance neuve peut être posée sur la
-- même case, et l'ancienne reste lisible à côté.
insert into ids select 'mapTeamM2', public.admin_set_provider_price(
  'stripe','test','plan','team','monthly',null,null,
  'price_team_monthly_v2','prod_team',7990,'Nouveau tarif après changement chez le prestataire.');

insert into res select 'Une correspondance neuve prend la place','price_team_monthly_v2',
  (select provider_price_id from public.billing_provider_price_terms('stripe','test','plan','team','monthly'));

insert into res select 'ET L''HISTORIQUE RESTE : deux lignes pour cette case, une seule active','2/1',
  (select count(*)::text || '/' || count(*) filter (where is_active)::text
     from public.billing_provider_prices
    where provider='stripe' and mode='test' and kind='plan'
      and plan_key='team' and billing_cycle='monthly');



-- ============================================================
-- 12. UN OUTIL DE MESURE, ET UN SEUL
-- ============================================================
-- « Est-ce que cet appel LÈVE ? » revient trente fois dans ce qui suit.
-- Écrit trente fois à la main en blocs `do`, il finirait par ne plus
-- être écrit pareil. Le voici une fois. `security invoker` est le point
-- important : l'appel est évalué sous le rôle de l'appelant, donc le
-- test mesure bien les droits qu'on croit mesurer.
reset role;
create or replace function public.essai_leve(p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;
grant execute on function public.essai_leve(text) to authenticated;


-- ============================================================
-- 13. LA TAXE — UN SEUL MOTEUR, ET IL REFUSE DE DEVINER
-- ============================================================
--
-- CE QUE CE PARAGRAPHE DÉFEND. Nos tarifs sont HORS TAXES ; le montant
-- PRÉLEVÉ doit donc porter la taxe en plus, et la taxe dépend du régime
-- du client. Trois régimes, trois montants prélevés différents pour un
-- MÊME prix affiché — et un quatrième cas, « on ne sait pas », qui doit
-- fermer la caisse au lieu de choisir à la place du comptable.
--
-- Avant correction, la session de paiement ne portait AUCUNE taxe : une
-- entreprise française était débitée de 79,90 € quand sa facture en
-- réclamait 95,88. Les 15,98 € n'étaient jamais collectés, et Oasis Care
-- en restait redevable.

select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
insert into ids select 'orgNL', public.create_professional_organization('Tuinen 83 NL','landscaper');
insert into ids select 'orgCH', public.create_professional_organization('Gaerten 83 CH','landscaper');

reset role;
update public.business_organizations
   set legal_name = 'Tuinen BV', country = 'NL', vat_number = 'NL123456789B01',
       address_line1 = 'Keizersgracht 1', postal_code = '1015', city = 'Amsterdam'
 where id = (select v from ids where k='orgNL');

update public.business_organizations
   set legal_name = 'Gaerten AG', country = 'CH',
       address_line1 = 'Bahnhofstrasse 1', postal_code = '8001', city = 'Zurich'
 where id = (select v from ids where k='orgCH');

-- ------------------------------------------------------------
-- 13.a LE RÉGIME, VU PAR LA PORTE DU CLIENT
-- ------------------------------------------------------------
-- `billing_provider_tax_terms` est la fonction que le TUNNEL appelle,
-- sous le jeton du client. C'est elle qui dit quoi encaisser.
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'FRANCE : régime « france »','france',
  (select regime from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgA')));

insert into res select 'ET LE TAUX EST 20,00 — pas 0, pas deviné','20.00',
  (select rate::text from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgA')));

-- LE POINT LE PLUS IMPORTANT DE CE PARAGRAPHE. Aucun objet de taxe
-- n'est encore relié chez le prestataire : on ne PEUT donc pas encaisser
-- la TVA française. Encaisser le hors taxes « en attendant » laisserait
-- Oasis Care redevable de 15,98 € par client et par mois, sans que rien
-- ne le signale. On BLOQUE.
insert into res select 'SANS OBJET DE TAXE CHEZ LE PRESTATAIRE, LA CAISSE EST FERMÉE','providerTaxRateMissing',
  (select blocking_reason from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgA')));

insert into res select 'Et aucun taux n''est rendu : jamais un taux approximatif','',
  (select coalesce(provider_tax_rate_id,'') from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgA')));

-- L'UNION SANS NUMÉRO VALIDÉ : « unknown », donc refus. Facturer 0 % à
-- un non-assujetti laisserait Oasis Care redevable ; supposer 20 %
-- ferait payer au Néerlandais une taxe française qu'il ne doit pas et
-- qu'on n'aurait aucun droit de collecter.
insert into res select 'UNION SANS NUMÉRO VALIDÉ : régime inconnu','unknown',
  (select regime from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgNL')));

insert into res select 'ET LA CAISSE SE FERME — on ne devine ni 0 %, ni 20 %','vatRegimeUnknown',
  (select blocking_reason from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgNL')));

insert into res select 'Avec le motif écrit, pas un code nu','true',
  (select (reason is not null and reason like '%non validé%')::text
     from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgNL')));

-- HORS UNION : 0 %, et ça PASSE. Aucun objet de taxe n'est nécessaire,
-- puisqu'il n'y a rien à ajouter au hors taxes.
insert into res select 'HORS UNION : « outsideEu », 0 %, caisse OUVERTE sans objet de taxe','outsideEu/0/',
  (select regime || '/' || rate::text || '/' || coalesce(blocking_reason,'')
     from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgCH')));

-- ON NE LIT PAS LE RÉGIME FISCAL DES AUTRES.
insert into res select 'Un client ne lit PAS le régime d''une autre entreprise','true',
  public.essai_leve('select * from public.billing_provider_tax_terms(''stripe'',''test'','''
     || (select v from ids where k='orgB')::text || ''')');

-- L'AUTOLIQUIDATION, une fois le numéro validé.
reset role;
insert into public.saas_customer_tax_profiles
  (organization_id, is_vat_registered, vat_number_validated_at, validation_source)
values ((select v from ids where k='orgNL'), true, now(), 'manual')
on conflict (organization_id) do update
  set is_vat_registered = true, vat_number_validated_at = now(), validation_source = 'manual';

select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'NUMÉRO VALIDÉ : autoliquidation, 0 %, caisse ouverte','euReverseCharge/0/',
  (select regime || '/' || rate::text || '/' || coalesce(blocking_reason,'')
     from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgNL')));

-- ------------------------------------------------------------
-- 13.b LA CORRESPONDANCE DE TAUX, ET SA DÉRIVE
-- ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);
set local role authenticated;

insert into ids select 'taxFR', public.admin_set_provider_tax_rate(
  'stripe','test','FR',20.00,'txr_fr_20','Taux normal français, objet créé chez le prestataire.');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'Le taux français est relié, ET LA CAISSE S''OUVRE','txr_fr_20/',
  (select provider_tax_rate_id || '/' || coalesce(blocking_reason,'')
     from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgA')));

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);
set local role authenticated;

-- ON NE RELIE PAS UN TAUX QUE NOTRE TABLE NE DIT PAS. La saisie n'est
-- pas crue, elle est confrontée à `saas_vat_rates`.
insert into res select 'Un taux qui ne correspond pas à notre table est REFUSÉ','true',
  public.essai_leve('select public.admin_set_provider_tax_rate(''stripe'',''test'',''FR'',19.60,''txr_fr_196'',''essai'')');

insert into res select 'Un pays sans taux chez nous est REFUSÉ','true',
  public.essai_leve('select public.admin_set_provider_tax_rate(''stripe'',''test'',''DE'',19.00,''txr_de_19'',''essai'')');

-- LE MÊME PIÈGE QUE SUR LES TARIFS : réemployer un objet du prestataire
-- pour une autre case réécrirait la case existante en rendant un succès.
insert into res select 'Réemployer un objet de taxe pour un autre pays est REFUSÉ','true',
  public.essai_leve('select public.admin_set_provider_tax_rate(''stripe'',''test'',''BE'',21.00,''txr_fr_20'',''essai'')');

-- LA DÉRIVE. Notre table bouge, la correspondance ne suit pas :
-- encaisser reviendrait à appliquer l'ancien taux, en silence.
reset role;
update public.saas_vat_rates set standard_rate = 21.00 where country_code = 'FR';

select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'LA DÉRIVE DE TAUX FERME LA CAISSE','taxRateDrift',
  (select blocking_reason from public.billing_provider_tax_terms('stripe','test',(select v from ids where k='orgA')));

reset role;
update public.saas_vat_rates set standard_rate = 20.00 where country_code = 'FR';

-- ------------------------------------------------------------
-- 13.c LE CONTRAT DE 0081 N'A PAS BOUGÉ
-- ------------------------------------------------------------
-- `saas_vat_regime()` a été REBRANCHÉE sur le calcul commun, pour qu'il
-- n'existe qu'UNE règle de TVA dans la base. C'est exactement le genre
-- de geste qui desserre une garde sans qu'on s'en aperçoive : on
-- vérifie donc les deux sens, le refus ET les valeurs.
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'saas_vat_regime REFUSE toujours un non-habilité','true',
  public.essai_leve('select * from public.saas_vat_regime('''
     || (select v from ids where k='orgA')::text || ''')');

-- ET LE CALCUL NU N'EST ATTEIGNABLE PAR PERSONNE. Sans cette
-- révocation, n'importe quel compte connecté lirait le régime fiscal de
-- n'importe quelle entreprise — la garde serait à la porte d'à côté.
insert into res select 'saas_vat_regime_compute est INEXÉCUTABLE depuis un jeton','true',
  public.essai_leve('select * from public.saas_vat_regime_compute('''
     || (select v from ids where k='orgA')::text || ''')');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830012-0000-4000-8000-000000000083','aal','aal2')::text, true);
set local role authenticated;

insert into res select 'ET POUR UN HABILITÉ, elle rend exactement ce qu''elle rendait','france/20.00',
  (select regime || '/' || rate::text from public.saas_vat_regime((select v from ids where k='orgA')));

insert into res select 'Y compris hors Union','outsideEu/0',
  (select regime || '/' || rate::text from public.saas_vat_regime((select v from ids where k='orgCH')));


-- ============================================================
-- 14. LE TROP-PERÇU, REFUSÉ PAR LA BASE
-- ============================================================
--
-- LE CONTRÔLE APPLICATIF NE SUFFISAIT PAS. Le gestionnaire de webhook
-- refuse déjà le trop-perçu sur la voie « métadonnée », mais : c'est du
-- code, il ne couvre qu'une des deux voies, et il travaille sur une
-- lecture faite AVANT tout verrou. Deux livraisons simultanées portant
-- deux références DIFFÉRENTES — deux factures du prestataire du même
-- montant, cas parfaitement réel — le franchissaient toutes les deux, et
-- `saas_invoice_balance` rendait un reste à payer NÉGATIF que rien ne
-- rattrape ensuite.
--
-- On reprend `invB` du § 8.g : facture de 9588, acompte de 5000 déjà
-- posé, donc 4588 restants.
reset role;

insert into res select 'Point de départ : il reste 4588 sur invB','4588',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='invB'));

select public.billing_provider_event_record('stripe','test','evt_83_trop','invoice.paid');

-- LE TROP-PERÇU EST REFUSÉ, avec une référence DIFFÉRENTE de l'acompte
-- — c'est-à-dire précisément là où l'index d'unicité du § 5.a ne voit
-- rien passer.
insert into res select 'UN ENCAISSEMENT DE 9999 SUR UN RESTE DE 4588 EST REFUSÉ','true',
  public.essai_leve('select public.saas_record_provider_payment(''stripe'',''test'',''evt_83_trop'','''
     || (select v from ids where k='invB')::text || ''',9999,''EUR'',''pi_83_trop'')');

insert into res select 'ET LE SOLDE N''EST JAMAIS DEVENU NÉGATIF','4588',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='invB'));

insert into res select 'Rien n''a été écrit : toujours un seul encaissement','1',
  (select count(*)::text from public.saas_invoice_payments
    where invoice_id = (select v from ids where k='invB'));

-- LE SOLDE EXACT, LUI, PASSE. Le paiement partiel reste légitime : la
-- table des encaissements existe pour qu'un acompte et un solde
-- coexistent.
insert into res select 'Le solde exact passe','recorded',
  public.saas_record_provider_payment('stripe','test','evt_83_trop',
    (select v from ids where k='invB'), 4588, 'EUR', 'pi_83_solde');

insert into res select 'La facture est soldée','0',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='invB'));

-- L'ORDRE DES CONTRÔLES, ET C'EST LE PIÈGE QUE CE TEST GARDE FERMÉ.
-- Un rejeu arrive FORCÉMENT sur une facture déjà soldée. Si le contrôle
-- du trop-perçu passait AVANT l'idempotence, il refuserait bruyamment un
-- événement parfaitement normal : le webhook échouerait en boucle et le
-- prestataire finirait par désactiver le point de terminaison.
insert into res select 'LE REJEU DU MÊME PAIEMENT REND « duplicate », PAS UNE ERREUR','duplicate',
  public.saas_record_provider_payment('stripe','test','evt_83_trop',
    (select v from ids where k='invB'), 4588, 'EUR', 'pi_83_solde');

insert into res select 'Et il n''a rien ajouté : deux encaissements, pas trois','2',
  (select count(*)::text from public.saas_invoice_payments
    where invoice_id = (select v from ids where k='invB'));


-- ============================================================
-- 15. LE RATTACHEMENT DU CLIENT — idempotent, et le conflit remonte
-- ============================================================
--
-- La fonction faisait « select puis insert » sans rattraper l'unicité,
-- exactement le motif que le § 4 de la migration interdit pour le
-- journal. Deux livraisons simultanées de la même session voyaient
-- toutes deux « rien », inséraient toutes deux, et le perdant remontait
-- un 23505 NON RATTRAPÉ — donc un événement clos en « failed » alors que
-- le rattachement avait parfaitement eu lieu.
--
-- La course elle-même ne se rejoue pas dans une transaction unique. Ce
-- qui se vérifie ici, c'est le CONTRAT que le rattrapage doit préserver :
-- le rejeu est un succès, et le conflit RÉEL continue de remonter — car
-- une exception avalée trop largement masquerait justement celui-là.
reset role;

insert into res select 'Le premier rattachement écrit','linked',
  public.billing_provider_link_customer('stripe','test',(select v from ids where k='orgCH'),'cus_ch_1');

insert into res select 'Le MÊME rattachement, rejoué, est un succès','alreadyLinked',
  public.billing_provider_link_customer('stripe','test',(select v from ids where k='orgCH'),'cus_ch_1');

-- LE CONFLIT LÉGITIME DOIT REMONTER. Une entreprise rattachée à DEUX
-- clients du prestataire, c'est deux historiques de paiement et un
-- remboursement qui part du mauvais : on veut que ça se voie.
insert into res select 'Un SECOND client sur la même entreprise est refusé','true',
  public.essai_leve('select public.billing_provider_link_customer(''stripe'',''test'','''
     || (select v from ids where k='orgCH')::text || ''',''cus_ch_2'')');

insert into res select 'Et le même client sur une AUTRE entreprise aussi','true',
  public.essai_leve('select public.billing_provider_link_customer(''stripe'',''test'','''
     || (select v from ids where k='orgNL')::text || ''',''cus_ch_1'')');

insert into res select 'Le rattachement d''origine est intact','cus_ch_1',
  (select provider_customer_id from public.billing_provider_customers
    where organization_id = (select v from ids where k='orgCH') and mode='test');


-- ============================================================
-- 16. L'ÉCART DE SIÈGES, RENDU LISIBLE
-- ============================================================
--
-- Cette fonction ne CORRIGE rien — voir le § 8.f de la migration, qui
-- dit pourquoi. Elle rend visible un écart qui, aujourd'hui, ne
-- s'affiche nulle part : une entreprise qui souscrit à trois comptes
-- puis en ouvre vingt-cinq paie indéfiniment zéro siège supplémentaire.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830002-0000-4000-8000-000000000083')::text, true);
set local role authenticated;

insert into res select 'Un non-habilité ne lit pas l''écart de sièges','true',
  public.essai_leve('select * from public.subscription_seat_drift()');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc830010-0000-4000-8000-000000000083','aal','aal2')::text, true);
set local role authenticated;

insert into res select 'La fonction répond sans lever pour un habilité','true',
  (select (count(*) >= 0)::text from public.subscription_seat_drift());

reset role;

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
