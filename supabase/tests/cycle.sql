-- Oasis Care — LE CYCLE DE VIE DE L'ABONNEMENT (migration 0089).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. UN ESSAI NE DÉBITE RIEN, ET LE PREMIER PRÉLÈVEMENT TOMBE À SA
--      FIN. C'est la promesse faite à l'écran — « rien ne sera prélevé
--      avant cette date » — et une promesse d'argent non tenue est le
--      défaut catastrophique de ce chantier. Le § 2 vérifie qu'aucune
--      facture, aucun encaissement n'existe pendant l'essai, puis que
--      la facture paraît EXACTEMENT le jour de son terme.
--
--   2. LA FACTURE PRÉCÈDE OU ACCOMPAGNE L'ENCAISSEMENT, JAMAIS
--      L'INVERSE. Terme à échoir : la facture d'une période est émise
--      le premier jour de cette période et exigible le jour même
--      (§ 3). Sans cela, le rapprochement du webhook ne trouve aucune
--      candidate et chaque prélèvement tombe en « à rapprocher à la
--      main ».
--
--   3. LE 31 JANVIER EXISTE, LE 31 FÉVRIER NON — ET L'ANCRE NE DÉRIVE
--      PAS (§ 4). Un calcul naïf ferait passer un abonné du 31 au 28,
--      puis au 28 pour toujours.
--
--   4. « INDISPONIBLE » N'EST NI « VALIDÉ » NI « REFUSÉ » (§ 5). Une
--      panne du registre européen ne doit bloquer AUCUNE inscription,
--      et ne doit JAMAIS être comptée comme une validation. Les deux
--      erreurs coûtent, dans des sens opposés.
--
--   5. LA PORTE ANONYME OUVRE UN DOCUMENT ET UN SEUL, ET NE LAISSE
--      SORTIR AUCUNE DONNÉE INTERNE (§ 6). La plupart des assertions de
--      ce paragraphe vérifient une ABSENCE : une porte qui montre trop
--      ne se signale par aucune erreur — elle fonctionne parfaitement,
--      et elle fuite.
--
--   6. UNE TÂCHE REJOUÉE DEUX FOIS NE DÉPOSE QU'UNE RELANCE (§ 7), et
--      c'est une contrainte d'unicité qui le garantit, pas un « si
--      déjà fait ».
--
--   7. RIEN DE 0081 N'EST CASSÉ (§ 8). Les trois fonctions remplacées
--      refusent toujours un utilisateur ordinaire, exactement comme
--      avant.
--
--   8. LES `grant` PAR DÉFAUT DE SUPABASE N'ONT RIEN ROUVERT (§ 9).
--      C'est là que 0055 s'est fait avoir, et c'est vérifié par
--      requête.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les abonnements, ni les factures, ni les numéros qu'elles consomment.
--
-- AUCUN APPEL RÉSEAU. Ni Stripe, ni Brevo, ni VIES : le « prestataire »
-- et le « registre européen » de ce fichier sont des doubles simulés,
-- qui déposent exactement ce que déposerait leur webhook.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0089, ou l'envoyer à l'API Management. UN SEUL bloc begin/rollback :
-- un fichier découpé en plusieurs blocs verrait son premier rollback
-- annuler les migrations posées devant.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table att(k text, v text) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on att to authenticated;
-- Le § 6 fait parler un visiteur ANONYME : il doit pouvoir consigner
-- son verdict comme les autres.
grant all on res to anon;
grant all on ids to anon;
grant all on att to anon;

-- ============================================================
-- Fixtures
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('c9890001-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-normal@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890002-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerA@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890003-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerB@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890004-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerF@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890005-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerJ@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890006-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerK@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890010-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-super@test.invalid','',now(),now(),now(),now(),'{}','{}');

-- A : française, complètement identifiée. C'est elle qui fera l'essai.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890002-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Cycle A Paysages','landscaper');

-- B : belge, avec un numéro de TVA intracommunautaire NON validé. C'est
-- elle qui éprouve les trois états.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890003-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Cycle B Tuinen','landscaper');

-- F : française, complètement identifiée. Elle souscrit SANS essai.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890004-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgF', public.create_professional_organization('Cycle F Jardins','landscaper');

-- J : française. Elle éprouve la date anniversaire du 31.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890005-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgJ', public.create_professional_organization('Cycle J Espaces','landscaper');

-- K : française mais SANS SIRET. Elle est là pour une seule raison, et
-- c'est la plus importante du § 2 bis : sa facture NE PEUT PAS être
-- émise, et elle ne doit pas emporter la nuit de tout le parc avec
-- elle.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890006-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgK', public.create_professional_organization('Cycle K Incomplet','landscaper');

select set_config('request.jwt.claims', null, true);

update public.business_organizations
   set legal_name = 'SARL Cycle K', siret = null,
       address_line1 = '11 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-k.test'
 where id = (select v from ids where k='orgK');

update public.business_organizations
   set legal_name = 'SARL Cycle A', siret = '111 222 333 00044',
       address_line1 = '1 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-a.test'
 where id = (select v from ids where k='orgA');

update public.business_organizations
   set legal_name = 'BVBA Cycle B', country = 'BE', vat_number = 'BE0123456749',
       address_line1 = 'Cyclusstraat 2', postal_code = '1000', city = 'Bruxelles',
       email = 'compta@cycle-b.test'
 where id = (select v from ids where k='orgB');

update public.business_organizations
   set legal_name = 'SARL Cycle F', siret = '555 666 777 00088',
       address_line1 = '5 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-f.test'
 where id = (select v from ids where k='orgF');

update public.business_organizations
   set legal_name = 'SARL Cycle J', siret = '999 111 222 00033',
       address_line1 = '9 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-j.test'
 where id = (select v from ids where k='orgJ');

insert into public.platform_admins (user_id, role, note) values
 ('c9890010-0000-4000-8000-000000000089','super_admin','Test cycle');

-- Les administrateurs réels sont mis de côté, dans la transaction
-- seulement : le nôtre doit être le dernier super-administrateur actif
-- pour que les gestes d'administration de ce fichier soient les siens.
update public.platform_admins
   set is_active = false, revoked_at = now()
 where user_id <> 'c9890010-0000-4000-8000-000000000089' and is_active;

-- L'ÉMETTEUR, COMPLET : sans lui, aucune facture ne s'émet, et tout ce
-- fichier tomberait sur le même refus pour la mauvaise raison.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890010-0000-4000-8000-000000000089','aal','aal2')::text, true);
set local role authenticated;

select public.admin_set_billing_issuer(jsonb_build_object(
  'legal_name','Oasis Care SAS (test cycle)',
  'legal_form','SAS',
  'siret','999 888 777 00011',
  'vat_number','FR00999888777',
  'address_line1','1 avenue du Cycle',
  'postal_code','75001',
  'city','Paris',
  'iban','FR7630000000000000000000000',
  'late_penalty_terms','Pénalités de retard : trois fois le taux d''intérêt légal. Indemnité forfaitaire de recouvrement : 40 €.'
), 'Mise en place du cycle d''abonnement.');

reset role;
select set_config('request.jwt.claims', null, true);

-- ============================================================
-- 1. LE CONTEXTE MACHINE — ON VÉRIFIE LE SOCLE AVANT LE RESTE
-- ============================================================
-- Si cette assertion tombe, toutes les suivantes tomberont pour la
-- mauvaise raison. Le piège nommé au § 1.b de la migration : lire
-- current_user au lieu de session_user ferait passer TOUTE fonction
-- `security definer` pour la machine.
insert into res select 'La session sans utilisateur EST la machine','true',
  public.saas_contexte_machine()::text;

select set_config('request.jwt.claims',
  json_build_object('sub','c9890001-0000-4000-8000-000000000089')::text, true);
set local role authenticated;
insert into res select 'UN COMPTE CONNECTÉ N''EST PAS LA MACHINE','false',
  public.saas_contexte_machine()::text;
reset role;
select set_config('request.jwt.claims', null, true);

-- ============================================================
-- 2. L'ESSAI : UN MOIS, RIEN N'EST DÉBITÉ
-- ============================================================
insert into att
select 'essaiFin',
       (select public.saas_date_anniversaire(current_date, 1,
               extract(day from current_date)::smallint))::text;

insert into att
select 'essaiMsg',
       (select subscription_status from public.saas_start_subscription(
          (select v from ids where k='orgA'), 'team', 'monthly', true,
          'stripe', 'test', 'cus_cycle_A', true, 'Souscription de test avec essai.'));

insert into res select 'Une souscription AVEC essai part en « trialing »','trialing',
  (select v from att where k='essaiMsg');

insert into res select 'L''essai finit un mois plus tard, à la date anniversaire',
  (select v from att where k='essaiFin'),
  (select trial_ends_at::date::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'LA CARTE EST ENREGISTRÉE, ET LA BASE LE SAIT','true',
  (select (payment_method_registered_at is not null)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgA'));

-- LE POINT DE CE PARAGRAPHE.
insert into res select 'PENDANT L''ESSAI, AUCUNE FACTURE N''EXISTE','0',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'PENDANT L''ESSAI, AUCUN ENCAISSEMENT N''EXISTE','0',
  (select count(*)::text from public.saas_invoice_payments p
    join public.saas_invoices i on i.id = p.invoice_id
   where i.organization_id = (select v from ids where k='orgA'));

insert into res select 'Aucune période n''est ouverte tant que l''essai court','NULL',
  coalesce((select current_period_start_on::text from public.organization_subscriptions
             where organization_id = (select v from ids where k='orgA')), 'NULL');

-- LA CARTE EST OBLIGATOIRE, ESSAI COMPRIS.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.saas_start_subscription(
      (select v from ids where k='orgB'), 'team', 'monthly', true,
      'stripe', 'test', 'cus_cycle_B_sans_carte', false, 'Essai sans carte.');
  exception when others then refuse := true;
  end;
  insert into res values ('UN ESSAI SANS CARTE EST REFUSÉ','true', refuse::text);
end $$;

-- ---- LA TÂCHE PLANIFIÉE, LE JOUR DU TERME --------------------
--
-- ON REMONTE LES DONNÉES, ON N'AVANCE PAS L'HORLOGE. C'était l'inverse
-- avant, et la fonction le refuse désormais : `p_today` ne peut plus
-- dépasser aujourd'hui, parce qu'un seul appel avec une date future
-- émettait de VRAIES factures — numérotées dans la séquence légale,
-- exigibles le jour même — pour des périodes non commencées.
--
-- Reculer la fin d'essai éprouve donc EXACTEMENT le même chemin, et il
-- se trouve que c'est aussi plus fidèle : en production, la tâche
-- tourne toujours « aujourd'hui ».
update public.organization_subscriptions
   set trial_started_at = now() - interval '1 month',
       trial_ends_at = current_date::timestamptz
 where organization_id = (select v from ids where k='orgA');

update att set v = current_date::text where k = 'essaiFin';

insert into att select 'cycle1',
  (select outcome from public.saas_run_billing_cycle(
     (select v::date from att where k='essaiFin')) limit 1);

insert into res select 'Au terme de l''essai, l''abonnement passe en « active »','active',
  (select status from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'LE PREMIER PRÉLÈVEMENT TOMBE À LA FIN DE L''ESSAI, ET PAS AVANT','1',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA') and issued_at is not null);

insert into res select 'La première période commence LE JOUR de la fin d''essai',
  (select v from att where k='essaiFin'),
  (select period_start::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA'));

-- TERME À ÉCHOIR : la facture est exigible le jour de son émission.
insert into res select 'LA FACTURE D''ÉCHÉANCE EST EXIGIBLE LE JOUR DE SON ÉMISSION','true',
  (select (due_on = issued_on)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Et elle est en mode « prélèvement », pas « virement »','provider',
  (select payment_method::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA'));

-- IDEMPOTENCE DE LA TÂCHE : la rejouer le même jour ne produit pas une
-- seconde facture. Ce n'est pas la politesse de la fonction, c'est
-- l'index unique partiel de saas_invoices.
select public.saas_run_billing_cycle((select v::date from att where k='essaiFin'));

insert into res select 'REJOUER LA TÂCHE LE MÊME JOUR NE FACTURE PAS DEUX FOIS','1',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA'));

-- ============================================================
-- 2 bis. UN CLIENT QUI ÉCHOUE N'ARRÊTE PAS LA NUIT DES AUTRES
-- ============================================================
--
-- LE MODE DE DÉFAILLANCE LE PLUS COÛTEUX DE TOUT CE CHANTIER, et il
-- ne se voit pas : saas_issue_invoice LÈVE quand un client français
-- n'a pas de SIRET — et elle a raison. Dans une boucle sans
-- sous-transaction, la PREMIÈRE entreprise mal renseignée fait
-- échouer la tâche planifiée en entier, personne n'est facturé cette
-- nuit-là, et il n'y a pas d'écran pour le dire.
select public.saas_start_subscription(
  (select v from ids where k='orgK'), 'team', 'monthly', true,
  'stripe', 'test', 'cus_cycle_K', true, 'Souscription d''un dossier incomplet.');

update public.organization_subscriptions
   set trial_ends_at = now() - interval '1 day',
       trial_started_at = now() - interval '31 days'
 where organization_id = (select v from ids where k='orgK');

insert into att select 'nbAvant',
  (select count(*)::text from public.saas_invoices);

select public.saas_run_billing_cycle(current_date);

insert into res select 'UNE FACTURE IMPOSSIBLE NE FAIT PAS ÉCHOUER LA TÂCHE','trialing',
  (select status from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgK'));

insert into res select 'ELLE RESTE EN ESSAI : on ne lui offre pas un mois par accident','true',
  (select (current_period_start_on is null)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgK'));

insert into res select 'ET L''ÉCHEC EST INSCRIT AU JOURNAL DE LA MACHINE','1',
  (select count(*)::text from public.saas_machine_events
    where kind = 'subscription.trialEndFailed'
      and organization_id = (select v from ids where k='orgK'));

insert into res select 'Aucune facture fantôme n''est restée derrière',
  (select v from att where k='nbAvant'),
  (select count(*)::text from public.saas_invoices);

-- ============================================================
-- 3. SANS ESSAI : ON FACTURE ET ON ENCAISSE LE MÊME JOUR
-- ============================================================
insert into att
select 'sansEssai',
       (select invoice_number from public.saas_start_subscription(
          (select v from ids where k='orgF'), 'team', 'monthly', false,
          'stripe', 'test', 'cus_cycle_F', true, 'Souscription sans essai.'));

insert into res select 'Une souscription SANS essai part directement en « active »','active',
  (select status from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgF'));

insert into res select 'ELLE FACTURE LE JOUR MÊME','true',
  (select (issued_on = current_date)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgF'));

insert into res select 'Et la facture porte un numéro','true',
  (select (v is not null)::text from att where k='sansEssai');

insert into res select 'ELLE EST EXIGIBLE LE JOUR MÊME, ET NON DANS TRENTE JOURS',
  current_date::text,
  (select due_on::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgF'));

insert into ids select 'factureF', id from public.saas_invoices
 where organization_id = (select v from ids where k='orgF');

-- ---- LE PRESTATAIRE, SIMULÉ ---------------------------------
-- AUCUN APPEL RÉSEAU : on dépose exactement ce que le webhook
-- déposerait, par les deux fonctions de 0083.
insert into att select 'ttcF',
  (select total_including_vat_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='factureF'));

select public.billing_provider_event_record(
  'stripe', 'test', 'evt_cycle_F_1', 'invoice.paid', null, now(),
  jsonb_build_object('source', 'test cycle'));

insert into att select 'encaisseF',
  public.saas_record_provider_payment(
    'stripe', 'test', 'evt_cycle_F_1',
    (select v from ids where k='factureF'),
    (select v::bigint from att where k='ttcF'),
    'EUR', 'pi_cycle_F_1', current_date);

insert into res select 'L''ENCAISSEMENT TOMBE LE JOUR DE L''ÉMISSION',
  current_date::text,
  (select received_on::text from public.saas_invoice_payments
    where invoice_id = (select v from ids where k='factureF'));

insert into res select 'LA FACTURE EST SOLDÉE, ET ELLE EXISTAIT AVANT L''ENCAISSEMENT','0',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='factureF'));

-- ============================================================
-- 4. LE 31 JANVIER EXISTE, LE 31 FÉVRIER NON
-- ============================================================
insert into res select 'Le 31 janvier + 1 mois tombe au 28 février','2026-02-28',
  public.saas_date_anniversaire(date '2026-01-31', 1, 31::smallint)::text;

insert into res select 'Le 31 janvier + 2 mois REVIENT au 31 mars : l''ancre ne dérive pas','2026-03-31',
  public.saas_date_anniversaire(date '2026-01-31', 2, 31::smallint)::text;

insert into res select 'Année bissextile : le 31 janvier + 1 mois tombe au 29 février','2028-02-29',
  public.saas_date_anniversaire(date '2028-01-31', 1, 31::smallint)::text;

insert into res select 'Le 30 janvier + 1 mois tombe aussi au 28 février','2026-02-28',
  public.saas_date_anniversaire(date '2026-01-30', 1, 30::smallint)::text;

insert into res select 'Un jour d''ancrage qui existe partout ne bouge pas','2026-02-15',
  public.saas_date_anniversaire(date '2026-01-15', 1, 15::smallint)::text;

insert into res select 'Le cycle annuel saute douze mois','2027-01-31',
  public.saas_date_anniversaire(date '2026-01-31', 12, 31::smallint)::text;

-- ET SUR UN VRAI ABONNEMENT, PAS SEULEMENT SUR LA FONCTION.
select public.saas_start_subscription(
  (select v from ids where k='orgJ'), 'team', 'monthly', true,
  'stripe', 'test', 'cus_cycle_J', true, 'Souscription du 31.');

update public.organization_subscriptions
   set trial_ends_at = timestamptz '2026-01-31 00:00:00+00',
       trial_started_at = timestamptz '2025-12-31 00:00:00+00',
       billing_anchor_day = 31
 where organization_id = (select v from ids where k='orgJ');

select public.saas_run_billing_cycle(date '2026-01-31');

insert into res select 'Un abonné du 31 janvier voit sa période finir le 28 février','2026-02-28',
  (select current_period_end_on::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgJ'));

select public.saas_run_billing_cycle(date '2026-02-28');

insert into res select 'ET LE MOIS SUIVANT IL REVIENT AU 31 : L''ANCRE N''A PAS DÉRIVÉ','2026-03-31',
  (select current_period_end_on::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgJ'));

insert into res select 'Deux périodes facturées, pas une de plus','2',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgJ'));

-- LE MIROIR d'affichage suit les dates, et ne peut pas diverger.
insert into res select 'La colonne d''affichage suit les dates','2026-03-31',
  (select current_period_end::date::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgJ'));

-- ============================================================
-- 5. LA TVA : TROIS ÉTATS, ET « INDISPONIBLE » N'EST PAS « VALIDÉ »
-- ============================================================
--
-- VIES EST SIMULÉ. Aucun appel réseau : on dépose la réponse comme le
-- ferait la fonction Edge, et c'est tout l'intérêt d'avoir séparé
-- l'interrogation du dépôt.

-- L'INSCRIPTION N'ATTEND PAS. Le numéro belge n'est pas validé, et la
-- souscription doit néanmoins aboutir.
insert into att
select 'inscritB',
       (select subscription_status from public.saas_start_subscription(
          (select v from ids where k='orgB'), 'team', 'monthly', false,
          'stripe', 'test', 'cus_cycle_B', true, 'Souscription belge.'));

insert into res select 'UN NUMÉRO DE TVA NON VALIDÉ NE BLOQUE PAS L''INSCRIPTION','active',
  (select v from att where k='inscritB');

insert into res select 'Et la consultation est programmée sans retarder personne','true',
  (select (vies_next_attempt_at is not null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

-- ---- LE REGISTRE EST INDISPONIBLE ----------------------------
insert into att select 'vies1',
  public.saas_vies_record_result(
    (select v from ids where k='orgB'), 'BE0123456749', 'indisponible',
    null, 'MS_UNAVAILABLE : le registre belge ne répond pas.');

insert into res select 'La réponse « indisponible » est enregistrée telle quelle','indisponible',
  (select vies_status from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

-- LE POINT LE PLUS IMPORTANT DU PARAGRAPHE.
insert into res select '« INDISPONIBLE » N''EST JAMAIS COMPTÉ COMME « VALIDÉ »','true',
  (select (vat_number_validated_at is null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

insert into res select 'Et le régime reste INCONNU','unknown',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgB')));

insert into res select 'Le motif dit que le registre était indisponible, pas « non validé »','true',
  (select (reason like '%INDISPONIBLE%')::text
     from public.saas_vat_regime_compute((select v from ids where k='orgB')));

insert into res select 'Un « indisponible » REPART dans la file de réessai','true',
  (select (vies_next_attempt_at is not null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

insert into res select 'Et le compteur de tentatives a monté','1',
  (select vies_attempts::text from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

insert into res select 'La date du dernier essai est enregistrée','true',
  (select (vies_last_attempt_at is not null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

-- L'ÉMISSION RESTE REFUSÉE. C'est le comportement de 0081, et il est
-- correct : facturer 0 % à un non-assujetti laisserait Oasis Care
-- redevable de la TVA.
do $$
declare v_id uuid; refuse boolean := false;
begin
  insert into public.saas_invoices (organization_id, period_start, period_end, vat_regime, vat_rate, vat_note)
  values ((select v from ids where k='orgB'), date '2030-01-01', date '2030-02-01',
          'unknown', null, 'Registre indisponible.')
  returning id into v_id;
  insert into public.saas_invoice_lines (invoice_id, position, kind, description, unit_price_cents, vat_rate)
  values (v_id, 1, 'plan', 'Offre', 7990, null);
  begin
    perform public.saas_issue_invoice(v_id, 'Essai d''émission sous TVA indisponible.');
  exception when others then refuse := true;
  end;
  insert into res values ('UN REGISTRE INDISPONIBLE BLOQUE L''ÉMISSION','true', refuse::text);
  delete from public.saas_invoices where id = v_id;
end $$;

-- ---- LE REFUS -----------------------------------------------
insert into att select 'vies2',
  public.saas_vies_record_result(
    (select v from ids where k='orgB'), 'BE0123456749', 'refuse',
    null, 'INVALID : numéro inconnu du registre belge.');

insert into res select 'Un REFUS ne se réessaie pas tout seul','true',
  (select (vies_next_attempt_at is null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

insert into res select 'Un refus laisse le régime INCONNU','unknown',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgB')));

insert into res select 'Et le motif dit REFUSÉ, pas « indisponible »','true',
  (select (reason like '%REFUSÉ%')::text
     from public.saas_vat_regime_compute((select v from ids where k='orgB')));

-- ON NE VALIDE PAS À LA MAIN PAR-DESSUS UN REFUS SANS L'EFFACER.
do $$
declare refuse boolean := false;
begin
  begin
    update public.saas_customer_tax_profiles
       set vat_number_validated_at = now(), validation_source = 'manual'
     where organization_id = (select v from ids where k='orgB');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE VALIDE PAS PAR-DESSUS UN REFUS DE VIES','true', refuse::text);
end $$;

-- ---- LA VALIDATION ------------------------------------------
insert into att select 'vies3',
  public.saas_vies_record_result(
    (select v from ids where k='orgB'), 'BE0123456749', 'valide',
    'WAPIAAAA-CYCLE-89', null);

insert into res select 'Un numéro VALIDÉ ouvre l''autoliquidation','euReverseCharge',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgB')));

insert into res select 'Le taux d''autoliquidation est zéro, et il est CONNU','0',
  (select rate::text from public.saas_vat_regime_compute((select v from ids where k='orgB')));

insert into res select 'LE NUMÉRO DE CONSULTATION EST CONSERVÉ : c''est la preuve opposable','WAPIAAAA-CYCLE-89',
  (select vies_consultation_number from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

insert into res select 'Et le numéro RÉELLEMENT interrogé est conservé aussi','BE0123456749',
  (select vat_number_checked from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

-- LE TROU QU'ON REFERME : changer le numéro efface la validation de
-- l'ancien. Sans cela, le contrôle d'un numéro vaudrait pour un autre.
update public.business_organizations set vat_number = 'BE0999999999'
 where id = (select v from ids where k='orgB');
select public.saas_vies_enqueue((select v from ids where k='orgB'));

insert into res select 'CHANGER LE NUMÉRO EFFACE LA VALIDATION DE L''ANCIEN','true',
  (select (vat_number_validated_at is null and vies_status is null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgB'));

-- LA FRANCE NE PASSE PAS PAR VIES.
insert into res select 'Un client français a un régime CONNU sans consultation','france',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgA')));

insert into res select 'Et il n''entre pas dans la file','0',
  (select count(*)::text from public.saas_vies_pending(100) p
    where p.organization_id = (select v from ids where k='orgA'));

insert into res select 'La clé d''un numéro français se vérifie hors ligne','true',
  public.saas_vat_number_fr_valide('FR40303265045')::text;

insert into res select 'Et une clé fausse est refusée','false',
  public.saas_vat_number_fr_valide('FR41303265045')::text;

-- ============================================================
-- 6. LA PORTE ANONYME
-- ============================================================
insert into ids select 'clientA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, notes)
select (select v from ids where k='clientA'), (select v from ids where k='orgA'),
       'customer', 'Madame Cycle', 'Négocie beaucoup';

insert into ids select 'devis1', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           internal_notes, valid_until)
select (select v from ids where k='devis1'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Jardin de curé', 'sent',
       'MARGE FAIBLE NE PAS NEGOCIER', current_date + 20;

insert into ids select 'section1', gen_random_uuid();
insert into public.quote_sections (id, organization_id, quote_id, title, description, position)
select (select v from ids where k='section1'), (select v from ids where k='orgA'),
       (select v from ids where k='devis1'), 'Plantation', 'Le massif nord', 0;

insert into public.quote_lines
  (organization_id, quote_id, section_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
select (select v from ids where k='orgA'), (select v from ids where k='devis1'),
       (select v from ids where k='section1'),
       'Olivier centenaire', 'u', 2, 314159, 900000, 20, 0;

-- Un SECOND devis, pour prouver qu'un jeton n'en ouvre qu'un.
insert into ids select 'devis2', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, valid_until)
select (select v from ids where k='devis2'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Terrasse en bois', 'sent', current_date + 20;

-- Un BROUILLON : il ne doit jamais pouvoir être partagé.
insert into ids select 'devis3', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devis3'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Idée pour plus tard', 'draft';

select set_config('request.jwt.claims',
  json_build_object('sub','c9890002-0000-4000-8000-000000000089')::text, true);
set local role authenticated;

insert into att select 'jeton1', (select token from public.partager_devis((select v from ids where k='devis1')));
insert into att select 'jeton2', (select token from public.partager_devis((select v from ids where k='devis2')));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.partager_devis((select v from ids where k='devis3'));
  exception when others then refuse := true;
  end;
  insert into res values ('UN BROUILLON NE SE PARTAGE PAS','true', refuse::text);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ---- LE VISITEUR ANONYME -------------------------------------
set local role anon;

insert into res select 'Le jeton ouvre le devis','true',
  (select ok::text from public.devis_par_jeton((select v from att where k='jeton1')));

insert into res select 'IL OUVRE CE DEVIS-LÀ, ET PAS UN AUTRE','Jardin de curé',
  (select devis ->> 'title' from public.devis_par_jeton((select v from att where k='jeton1')));

insert into res select 'Le second jeton ouvre le second devis','Terrasse en bois',
  (select devis ->> 'title' from public.devis_par_jeton((select v from att where k='jeton2')));

-- UN CARACTÈRE CHANGÉ, ET RIEN NE S'OUVRE.
insert into res select 'UN JETON MODIFIÉ D''UN CARACTÈRE N''OUVRE RIEN','false',
  (select ok::text from public.devis_par_jeton(
     overlay((select v from att where k='jeton1') placing
             case when left((select v from att where k='jeton1'), 1) = 'a' then 'b' else 'a' end
             from 1 for 1)));

insert into res select 'Un jeton inventé n''ouvre rien','false',
  (select ok::text from public.devis_par_jeton(encode(gen_random_bytes(32), 'hex')));

insert into res select 'Un jeton vide n''ouvre rien','false',
  (select ok::text from public.devis_par_jeton(''));

insert into res select 'Et le refus dit toujours la MÊME chose','true',
  (select (a.message = b.message)
     from public.devis_par_jeton(encode(gen_random_bytes(32), 'hex')) a,
          public.devis_par_jeton('pas-un-jeton') b)::text;

-- ---- CE QUI NE SORT PAS --------------------------------------
-- La plupart des assertions qui suivent vérifient une ABSENCE. Une
-- porte qui montre trop ne se signale par aucune erreur.
insert into att select 'sortie1',
  (select (coalesce(entreprise::text,'') || coalesce(devis::text,'')
           || coalesce(sections::text,'') || coalesce(lignes::text,''))
     from public.devis_par_jeton((select v from att where k='jeton1')));

insert into res select 'LA NOTE INTERNE NE SORT PAS','false',
  ((select v from att where k='sortie1') like '%MARGE FAIBLE%')::text;

insert into res select 'LE COÛT D''ACHAT NE SORT PAS','false',
  ((select v from att where k='sortie1') like '%314159%')::text;

insert into res select 'Le prix de VENTE, lui, sort : c''est le devis','true',
  ((select v from att where k='sortie1') like '%900000%')::text;

insert into res select 'Aucune clé « cost » dans ce que rend la porte','0',
  (select count(*)::text from jsonb_array_elements(
     (select lignes from public.devis_par_jeton((select v from att where k='jeton1')))) l,
     jsonb_object_keys(l) k2
    where k2 like '%cost%');

-- ---- LA TRACE ------------------------------------------------
reset role;

-- LA COMPARAISON AVEC LES VUES client_*, colonne par colonne. C'est
-- le seul moyen qu'un ajout futur d'une colonne « marge » à `quotes`
-- ne se retrouve pas dans la porte.
--
-- ELLE SE FAIT HORS DU RÔLE `anon`, ET C'EST UN PIÈGE QUI A MORDU ICI
-- MÊME : `information_schema.columns` ne montre que ce sur quoi
-- l'appelant a un droit. Sous `anon`, qui n'a rien sur les vues du
-- portail, la liste attendue revenait VIDE — et la comparaison serait
-- passée au vert le jour où la porte, elle aussi, ne rendrait plus
-- rien. Un test qui se compare à du vide ne défend rien.
insert into res select 'LES COLONNES DU DEVIS SONT EXACTEMENT CELLES DE client_quotes',
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'client_quotes'),
  (select string_agg(k2, ',' order by k2) from jsonb_object_keys(
     (select devis from public.devis_par_jeton((select v from att where k='jeton1')))) k2);

insert into res select 'LES COLONNES DES LIGNES SONT EXACTEMENT CELLES DE client_quote_lines',
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'client_quote_lines'),
  (select string_agg(k2, ',' order by k2) from jsonb_array_elements(
     (select lignes from public.devis_par_jeton((select v from att where k='jeton1')))) l,
     lateral jsonb_object_keys(l) k2
   limit 1);

insert into res select 'LES COLONNES DES SECTIONS SONT EXACTEMENT CELLES DE client_quote_sections',
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'client_quote_sections'),
  (select string_agg(k2, ',' order by k2) from jsonb_array_elements(
     (select sections from public.devis_par_jeton((select v from att where k='jeton1')))) s,
     lateral jsonb_object_keys(s) k2
   limit 1);

insert into res select 'LES OUVERTURES SONT DATÉES : c''est le premier accusé de lecture du produit','true',
  (select (opened_count > 0 and first_opened_at is not null and last_opened_at is not null)::text
     from public.document_share_links
    where document_id = (select v from ids where k='devis1') and revoked_at is null);

insert into res select 'Et chacune laisse une ligne','true',
  (select (count(*) > 0)::text from public.document_share_openings o
    join public.document_share_links l on l.id = o.link_id
   where l.document_id = (select v from ids where k='devis1'));

-- ---- LA RÉVOCATION -------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub','c9890002-0000-4000-8000-000000000089')::text, true);
set local role authenticated;
select public.revoquer_partage_devis((select v from ids where k='devis1'), 'Le client a répondu.');
reset role;
select set_config('request.jwt.claims', null, true);

set local role anon;
insert into res select 'UN JETON RÉVOQUÉ N''OUVRE PLUS RIEN','false',
  (select ok::text from public.devis_par_jeton((select v from att where k='jeton1')));
reset role;

-- ---- L'EXPIRATION --------------------------------------------
update public.document_share_links
   set expires_at = now() - interval '1 minute'
 where document_id = (select v from ids where k='devis2');

set local role anon;
insert into res select 'UN JETON EXPIRÉ N''OUVRE PLUS RIEN','false',
  (select ok::text from public.devis_par_jeton((select v from att where k='jeton2')));
reset role;

-- L'ÉCHÉANCE VIENT DU DEVIS, ET LE PLAFOND JOUE QUAND IL N'EN A PAS.
insert into ids select 'devis4', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, valid_until)
select (select v from ids where k='devis4'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Devis sans date de validité', 'sent', null;

select set_config('request.jwt.claims',
  json_build_object('sub','c9890002-0000-4000-8000-000000000089')::text, true);
set local role authenticated;
select public.partager_devis((select v from ids where k='devis4'));
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'SANS DATE DE VALIDITÉ, LE JETON PORTE UN PLAFOND DE 30 JOURS',
  (current_date + 30)::text,
  (select expires_at::date::text from public.document_share_links
    where document_id = (select v from ids where k='devis4') and revoked_at is null);

-- Le lien de `devis1` (valable jusqu'à J+20) : révoqué au paragraphe
-- précédent, mais son échéance est intacte — et c'est elle qu'on lit.
-- Le lien de `devis2` ne conviendrait pas : le test d'expiration vient
-- de lui écraser sa date.
insert into res select 'AVEC UNE DATE DE VALIDITÉ, C''EST ELLE QUI FAIT FOI',
  (current_date + 21)::text,
  (select expires_at::date::text from public.document_share_links
    where document_id = (select v from ids where k='devis1'));

-- UNE SEULE PORTE VIVANTE PAR DOCUMENT.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890002-0000-4000-8000-000000000089')::text, true);
set local role authenticated;
select public.partager_devis((select v from ids where k='devis4'));
reset role;
select set_config('request.jwt.claims', null, true);

insert into res select 'REPARTAGER RÉVOQUE L''ANCIEN LIEN : une seule porte vivante','1',
  (select count(*)::text from public.document_share_links
    where document_id = (select v from ids where k='devis4') and revoked_at is null);

-- LES TENTATIVES INFRUCTUEUSES SE COMPTENT.
insert into att select 'echecsAvant',
  coalesce((select sum(failures)::text from public.document_share_attempts), '0');

set local role anon;
do $$
declare i integer;
begin
  for i in 1..5 loop
    perform public.devis_par_jeton(encode(gen_random_bytes(32), 'hex'));
  end loop;
end $$;
reset role;

insert into res select 'LES TENTATIVES INFRUCTUEUSES SE COMPTENT, ET SE VOIENT','true',
  (select (coalesce(sum(failures), 0) > (select v::bigint from att where k='echecsAvant'))::text
     from public.document_share_attempts);

-- ============================================================
-- 7. LES RELANCES — UNE TÂCHE REJOUÉE NE DÉPOSE QU'UNE FOIS
-- ============================================================
insert into public.email_organization_settings (organization_id, reminders_enabled, reminder_delay_days, reminder_max)
select (select v from ids where k='orgA'), true, 7, 2
on conflict (organization_id) do update
  set reminders_enabled = true, reminder_delay_days = 7, reminder_max = 2;

-- Un devis envoyé il y a dix jours, sans décision.
insert into ids select 'devisRelance', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           sent_at, valid_until)
select (select v from ids where k='devisRelance'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Haie de charmes', 'sent', now() - interval '10 days', current_date + 30;

insert into att select 'calcul1', public.relances_calculer(current_date)::text;
insert into att select 'calcul2', public.relances_calculer(current_date)::text;

insert into res select 'Le premier passage dépose la relance du devis','1',
  (select count(*)::text from public.relances_planifiees
    where entity_type = 'quote' and entity_id = (select v from ids where k='devisRelance'));

insert into res select 'UNE TÂCHE REJOUÉE DEUX FOIS NE DÉPOSE QU''UNE RELANCE','0',
  (select v from att where k='calcul2');

insert into res select 'Et il n''y a toujours qu''une ligne','1',
  (select count(*)::text from public.relances_planifiees
    where entity_type = 'quote' and entity_id = (select v from ids where k='devisRelance'));

insert into res select 'La relance porte le rang 2 : le rang 1 est l''envoi initial','2',
  (select occurrence::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisRelance'));

-- UNE ENTREPRISE QUI N'A PAS ACTIVÉ LES RELANCES N'EN REÇOIT AUCUNE.
insert into ids select 'devisMuet', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           sent_at, valid_until)
select (select v from ids where k='devisMuet'), (select v from ids where k='orgF'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgF')),
       'Devis sans relance', 'sent', now() - interval '30 days', current_date + 30;

select public.relances_calculer(current_date);

insert into res select 'LES RELANCES SONT DÉSACTIVÉES PAR DÉFAUT, ET ÇA TIENT','0',
  (select count(*)::text from public.relances_planifiees
    where organization_id = (select v from ids where k='orgF'));

-- UN DEVIS DÉCIDÉ NE SE RELANCE PLUS.
update public.quotes set decided_at = now(), status = 'accepted'
 where id = (select v from ids where k='devisRelance');
delete from public.relances_planifiees
 where entity_id = (select v from ids where k='devisRelance');
select public.relances_calculer(current_date);

insert into res select 'UN DEVIS DÉCIDÉ NE SE RELANCE PLUS','0',
  (select count(*)::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisRelance'));

-- ============================================================
-- 8. L'ENGAGEMENT NE COMMENCE PAS PENDANT L'ESSAI
-- ============================================================
-- On remet orgJ en essai pour éprouver la garde : elle ne mord que sur
-- une remise QUI ENGAGE, et seulement pendant un essai.
update public.organization_subscriptions
   set status = 'trialing', trial_started_at = now(),
       trial_ends_at = now() + interval '1 month',
       current_period_start_on = null, current_period_end_on = null
 where organization_id = (select v from ids where k='orgJ');

insert into att select 'engagementLe',
  public.saas_engagement_start_on((select v from ids where k='orgJ'))::text;

insert into res select 'L''ENGAGEMENT DÉMARRE À LA FIN DE L''ESSAI, PAS À LA SOUSCRIPTION',
  (select trial_ends_at::date::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgJ')),
  (select v from att where k='engagementLe');

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.subscription_discounts
      (organization_id, label, kind, value_cents, starts_on, ends_on,
       commitment_ends_on, reason)
    values ((select v from ids where k='orgJ'), 'Remise qui engage', 'fixedMonthlyPrice', 4990,
            current_date, (current_date + interval '12 months')::date,
            (current_date + interval '12 months')::date, 'Essai de garde.');
  exception when others then refuse := true;
  end;
  insert into res values
    ('UNE REMISE QUI ENGAGE NE DÉMARRE PAS PENDANT L''ESSAI','true', refuse::text);
end $$;

do $$
declare ok boolean := true; v_debut date;
begin
  v_debut := public.saas_engagement_start_on((select v from ids where k='orgJ'));
  begin
    insert into public.subscription_discounts
      (organization_id, label, kind, value_cents, starts_on, ends_on,
       commitment_ends_on, reason)
    values ((select v from ids where k='orgJ'), 'Remise qui engage', 'fixedMonthlyPrice', 4990,
            v_debut, (v_debut + interval '12 months')::date,
            (v_debut + interval '12 months')::date, 'Essai de garde.');
  exception when others then ok := false;
  end;
  insert into res values
    ('ET ELLE PASSE QUAND ELLE DÉMARRE À LA BONNE DATE','true', ok::text);
end $$;

insert into res select 'DOUZE MOIS PAYÉS, PAS ONZE : la fin de remise suit la fin d''engagement','true',
  (select (ends_on = commitment_ends_on)::text from public.subscription_discounts
    where organization_id = (select v from ids where k='orgJ') and cancelled_at is null);

-- ============================================================
-- 9. RIEN DE 0081 N'EST CASSÉ
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','c9890001-0000-4000-8000-000000000089')::text, true);
set local role authenticated;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select * from public.saas_generate_invoices(''monthly'', current_date, current_date + 30, ''essai'')',
    'select * from public.saas_generate_invoices(''monthly'', current_date, current_date + 30, ''essai'', false)',
    'select public.saas_issue_invoice(gen_random_uuid(), ''essai'')',
    'select * from public.saas_subscription_billing_lines(gen_random_uuid(), current_date, current_date + 30)',
    'select * from public.saas_vat_regime(gen_random_uuid())',
    'select * from public.saas_start_subscription(gen_random_uuid(), ''team'', ''monthly'', true, ''stripe'', ''test'', ''cus_x'', true, ''essai'')',
    'select * from public.saas_run_billing_cycle()',
    'select public.relances_calculer()',
    'select * from public.saas_vies_pending(10)',
    'select public.saas_vies_record_result(gen_random_uuid(), ''BE1'', ''valide'')'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('Utilisateur ordinaire — « ' || left(f, 56) || '… » lève', 'true', refuse::text);
  end loop;
end $$;

-- ET IL N'ÉCRIT PAS DIRECTEMENT DANS LES TABLES NEUVES.
do $$
declare
  t text;
  refuse boolean;
begin
  foreach t in array array[
    'insert into public.document_share_links (organization_id, document_kind, document_id, expires_at) values (gen_random_uuid(), ''quote'', gen_random_uuid(), now() + interval ''1 day'')',
    'insert into public.relances_planifiees (organization_id, entity_type, entity_id, template_key, occurrence, reference_on, due_on) values (gen_random_uuid(), ''quote'', gen_random_uuid(), ''devisRelance'', 2, current_date, current_date)',
    'insert into public.saas_machine_events (kind) values (''pirate'')',
    'update public.document_share_attempts set failures = 0'
  ]
  loop
    refuse := false;
    begin
      execute t;
    exception when others then refuse := true;
    end;
    insert into res values ('Écriture directe refusée — « ' || left(t, 50) || '… »', 'true', refuse::text);
  end loop;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- LE JOURNAL DE LA MACHINE EST EN AJOUT SEUL, y compris ici.
do $$
declare refuse boolean := false;
begin
  begin
    update public.saas_machine_events set label = 'réécrit' where true;
  exception when others then refuse := true;
  end;
  insert into res values ('LE JOURNAL DE LA MACHINE EST EN AJOUT SEUL','true', refuse::text);
end $$;

-- ============================================================
-- 10. LES DROITS — LES `grant` PAR DÉFAUT N'ONT RIEN ROUVERT
-- ============================================================
insert into res select 'La porte anonyme est ACCORDÉE à anon','true',
  has_function_privilege('anon', 'public.devis_par_jeton(text)', 'execute')::text;

insert into res select 'Et c''est la SEULE fonction de 0089 accordée à anon (avec le signal de saturation)','2',
  (select count(*)::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('devis_par_jeton','document_share_sous_attaque','partager_devis',
                        'revoquer_partage_devis','saas_start_subscription','saas_run_billing_cycle',
                        'relances_calculer','relances_a_expedier','relance_marquer_faite',
                        'saas_vies_pending','saas_vies_record_result','saas_vies_enqueue',
                        'saas_contexte_machine','saas_date_anniversaire','saas_engagement_start_on',
                        'admin_clear_vies_result','document_share_note_echec')
      and has_function_privilege('anon', p.oid, 'execute'));

insert into res select 'anon NE LIT AUCUNE des tables neuves','0',
  (select count(*)::text from information_schema.table_privileges
    where grantee = 'anon' and table_schema = 'public'
      and table_name in ('document_share_links','document_share_openings',
                         'document_share_attempts','relances_planifiees','saas_machine_events'));

insert into res select 'anon N''A TOUJOURS RIEN sur les vues du portail client','0',
  (select count(*)::text from information_schema.table_privileges
    where grantee = 'anon' and table_schema = 'public'
      and table_name in ('client_quotes','client_quote_lines','client_quote_sections'));

-- ET LA VRAIE QUESTION, POSÉE COMME IL FAUT.
--
-- `anon` PORTE BEL ET BIEN SEPT DROITS DE TABLE SUR `quotes`, hérités
-- du défaut de Supabase — c'est mesuré, et ce n'est pas ce fichier qui
-- l'a créé. Ce qui l'empêche de lire quoi que ce soit, c'est la RLS de
-- `quotes`, dont toutes les politiques passent par `has_permission()`.
-- Un test qui compterait les DROITS échouerait donc sans rien dire de
-- vrai ; un test qui compte les LIGNES dit exactement ce qui compte.
--
-- On ne retire pas ces droits ici : `quotes` n'est pas au périmètre de
-- ce chantier, et refermer une table partagée depuis une migration de
-- facturation est le genre de geste qui casse ailleurs.
set local role anon;
insert into res select 'ET SURTOUT : anon NE LIT AUCUNE LIGNE DE quotes','0',
  (select count(*)::text from public.quotes);
insert into res select 'Ni aucune ligne de quote_lines','0',
  (select count(*)::text from public.quote_lines);
reset role;

insert into res select 'Le calcul nu du régime de TVA reste fermé aux clients','false',
  has_function_privilege('authenticated', 'public.saas_vat_regime_compute(uuid)', 'execute')::text;

insert into res select 'Les fonctions de la machine sont fermées aux comptes connectés','false',
  (has_function_privilege('authenticated', 'public.saas_run_billing_cycle(date)', 'execute')
   or has_function_privilege('authenticated', 'public.saas_start_subscription(uuid, text, text, boolean, text, text, text, boolean, text, date, smallint, integer)', 'execute')
   or has_function_privilege('authenticated', 'public.relances_calculer(date)', 'execute'))::text;

insert into res select 'La génération de factures reste ouverte aux administrateurs','true',
  has_function_privilege('authenticated', 'public.saas_generate_invoices(text, date, date, text, boolean, uuid)', 'execute')::text;

-- La RLS est bien allumée partout.
insert into res select 'La RLS est allumée sur les cinq tables neuves','5',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('document_share_links','document_share_openings',
                        'document_share_attempts','relances_planifiees','saas_machine_events'));

-- ============================================================
-- 10. LES DÉFAUTS TROUVÉS À L'AUDIT, ET LEUR PREUVE DE FERMETURE
-- ============================================================
--
-- CE PARAGRAPHE EXISTE PARCE QU'UN TEST VERT QUI NE COUVRE PAS LA
-- CORRECTION NE PROUVE RIEN. Chaque assertion ci-dessous ÉCHOUAIT avant
-- la correction correspondante ; c'est la seule raison de l'écrire.
--
-- Les défauts sont pris dans l'ordre de leur gravité, pas dans celui du
-- fichier.

-- Deux comptes de plus, pour des cas qui exigent un abonnement neuf.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('c9890021-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerP@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890022-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerQ@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890023-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerR@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9890024-0000-4000-8000-000000000089','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cy-ownerS@test.invalid','',now(),now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','c9890021-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgP', public.create_professional_organization('Cycle P Retard','landscaper');
select set_config('request.jwt.claims',
  json_build_object('sub','c9890022-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgQ', public.create_professional_organization('Cycle Q Resilie','landscaper');
select set_config('request.jwt.claims',
  json_build_object('sub','c9890023-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgR', public.create_professional_organization('Cycle R Sieges','landscaper');
select set_config('request.jwt.claims',
  json_build_object('sub','c9890024-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgS', public.create_professional_organization('Cycle S Allemande','landscaper');
select set_config('request.jwt.claims', null, true);

update public.business_organizations
   set legal_name = 'SARL Cycle P', siret = '121 212 121 00012',
       address_line1 = '12 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-p.test'
 where id = (select v from ids where k='orgP');
update public.business_organizations
   set legal_name = 'SARL Cycle Q', siret = '131 313 131 00013',
       address_line1 = '13 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-q.test'
 where id = (select v from ids where k='orgQ');
update public.business_organizations
   set legal_name = 'SARL Cycle R', siret = '141 414 141 00014',
       address_line1 = '14 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-r.test'
 where id = (select v from ids where k='orgR');
update public.business_organizations
   set legal_name = 'GmbH Cycle S', country = 'DE', vat_number = 'DE111111111',
       address_line1 = 'Zyklusstrasse 1', postal_code = '10115', city = 'Berlin',
       email = 'compta@cycle-s.test'
 where id = (select v from ids where k='orgS');

-- ------------------------------------------------------------
-- 10.a UN NUMÉRO DE TVA MODIFIÉ NE VAUT PLUS VALIDATION
-- ------------------------------------------------------------
-- LE DÉFAUT LE PLUS CHER DU CHANTIER, ET IL ÉTAIT INVISIBLE.
-- saas_vat_regime_compute ne lisait que vat_number_validated_at : un
-- numéro validé puis MODIFIÉ continuait de produire « euReverseCharge »
-- à 0 %. La facture partait avec zéro TVA et la mention
-- d'autoliquidation, sur un numéro que VIES n'avait jamais vu.
-- vat_number_checked existait précisément pour ça, et personne ne la
-- lisait.
select public.saas_vies_enqueue((select v from ids where k='orgS'));
select public.saas_vies_record_result(
  (select v from ids where k='orgS'), 'DE111111111', 'valide', 'WAPI-CYCLE-S', null);

insert into res select 'Point de départ : le numéro allemand est validé','euReverseCharge',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgS')));

-- Le geste exact des écrans « Entreprise » et « Bienvenue » : ils
-- écrivent vat_number, et ne prévenaient personne.
update public.business_organizations set vat_number = 'DE222222222'
 where id = (select v from ids where k='orgS');

insert into res select 'UN NUMÉRO MODIFIÉ NE PRODUIT PLUS D''AUTOLIQUIDATION À 0 %','unknown',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgS')));

insert into res select 'Et le taux n''est plus zéro : il est INCONNU','true',
  (select (rate is null)::text
     from public.saas_vat_regime_compute((select v from ids where k='orgS')));

-- LE DÉCLENCHEUR FERME LA PORTE À LA SOURCE, SANS QUE PERSONNE
-- N'APPELLE saas_vies_enqueue. C'est le point : trois écrans écrivent
-- vat_number et un seul prévenait la TVA.
insert into res select 'LE DÉCLENCHEUR A EFFACÉ LA VALIDATION SANS QU''ON LE LUI DEMANDE','true',
  (select (vat_number_validated_at is null and vies_status is null
           and vies_consultation_number is null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgS'));

insert into res select 'Et le nouveau numéro est reparti dans la file de consultation','true',
  (select (vies_next_attempt_at is not null)::text
     from public.saas_customer_tax_profiles
    where organization_id = (select v from ids where k='orgS'));

-- LA GARDE DU CALCUL, ÉPROUVÉE SEULE — ET C'EST DE LA DÉFENSE EN
-- PROFONDEUR, PAS UNE REDONDANCE. Le déclencheur ci-dessus a déjà
-- effacé la validation, donc le calcul n'a plus rien à rattraper dans
-- ce chemin-là. On remet donc le profil dans l'état EXACT que
-- produisait le défaut — validation posée, numéro contrôlé périmé — et
-- on vérifie que la fonction refuse d'elle-même. Une garde qui dépend
-- d'un déclencheur tombe avec lui ; celle-ci vit au seul point que tous
-- les chemins traversent.
update public.saas_customer_tax_profiles
   set vies_status = 'valide', vat_number_validated_at = now(),
       validation_source = 'vies', vat_number_checked = 'DE111111111'
 where organization_id = (select v from ids where k='orgS');

insert into res select 'LE CALCUL REFUSE TOUT SEUL UNE VALIDATION QUI PORTE SUR UN AUTRE NUMÉRO','unknown',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgS')));

insert into res select 'Et son motif dit que le numéro A CHANGÉ, pas qu''il est « non validé »','true',
  (select (reason like '%A CHANGÉ%')::text
     from public.saas_vat_regime_compute((select v from ids where k='orgS')));

-- ET LA GARDE NE MORD QUE SUR UN DÉSACCORD CONNU.
--
-- `vat_number_checked` n'est écrite que par le chemin VIES. Une
-- validation HUMAINE — un certificat vu sur papier, `validation_source`
-- = 'manual' ou 'document', prévues par 0081 — la laisse à NULL, parce
-- qu'il n'y a pas de « numéro interrogé » à enregistrer.
--
-- Une première version exigeait l'égalité stricte, et annulait donc
-- TOUTES les validations manuelles : la facturation de clients
-- parfaitement en règle se bloquait. Les suites `stripe` et
-- `control_center_suite` l'ont attrapé. Cette assertion est là pour
-- que la correction ne se reperde pas.
update public.saas_customer_tax_profiles
   set vies_status = null, vat_number_validated_at = now(),
       validation_source = 'document', vat_number_checked = null
 where organization_id = (select v from ids where k='orgS');

insert into res select 'UNE VALIDATION HUMAINE, SANS NUMÉRO INTERROGÉ, RESTE VALABLE','euReverseCharge',
  (select regime from public.saas_vat_regime_compute((select v from ids where k='orgS')));

-- On repart de l'état propre pour la suite du paragraphe.
update public.saas_customer_tax_profiles
   set vies_status = null, vat_number_validated_at = null,
       validation_source = null, vat_number_checked = null,
       vies_next_attempt_at = now()
 where organization_id = (select v from ids where k='orgS');

-- ------------------------------------------------------------
-- 10.b UNE FACTURE BLOQUÉE NE FAIT PAS BASCULER L'ESSAI
-- ------------------------------------------------------------
-- LE SECOND BLOQUANT, ET C'EST LE CAS NOMINAL QUE TOUT LE § 7 EXISTE
-- POUR TRAITER : un client européen dont le registre est indisponible
-- le jour de sa fin d'essai.
--
-- « Bloquée » n'est pas une exception : saas_generate_invoices rend
-- outcome = 'blocked' et un brouillon. Rien n'était donc annulé,
-- l'abonnement basculait en « active », et le brouillon n'était JAMAIS
-- retenté — même une fois l'obstacle levé. Un mois de service livré,
-- jamais facturé, jamais encaissé.
select public.saas_start_subscription(
  (select v from ids where k='orgS'), 'team', 'monthly', true,
  'stripe', 'test', 'cus_cycle_S', true, 'Souscription allemande avec essai.');

select public.saas_vies_record_result(
  (select v from ids where k='orgS'), 'DE222222222', 'indisponible',
  null, 'MS_UNAVAILABLE : le registre allemand ne répond pas.');

update public.organization_subscriptions
   set trial_started_at = now() - interval '1 month',
       trial_ends_at = current_date::timestamptz
 where organization_id = (select v from ids where k='orgS');

select public.saas_run_billing_cycle(current_date);

insert into res select 'UNE FACTURE BLOQUÉE LAISSE L''ABONNEMENT EN ESSAI','trialing',
  (select status from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgS'));

insert into res select 'Sa période n''a pas avancé : le mois ne sera pas sauté','true',
  (select (current_period_start_on is null)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgS'));

insert into res select 'ET AUCUN BROUILLON N''EST RESTÉ DERRIÈRE','0',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgS'));

insert into res select 'Le blocage est distingué d''une panne au journal','true',
  (select (details->>'bloquee' = 'true')::text
     from public.saas_machine_events
    where kind = 'subscription.trialEndFailed'
      and organization_id = (select v from ids where k='orgS')
    order by occurred_at desc limit 1);

-- ET LE POINT QUI COMPTE VRAIMENT : UNE FOIS L'OBSTACLE LEVÉ, LA NUIT
-- SUIVANTE RATTRAPE. Avant la correction, elle ne rattrapait jamais.
select public.saas_vies_record_result(
  (select v from ids where k='orgS'), 'DE222222222', 'valide', 'WAPI-CYCLE-S2', null);
select public.saas_run_billing_cycle(current_date);

insert into res select 'UNE FOIS LE REGISTRE REVENU, LA NUIT SUIVANTE RATTRAPE','active',
  (select status from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgS'));

insert into res select 'Et la facture du premier mois est enfin ÉMISE','1',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgS') and issued_at is not null);

-- ------------------------------------------------------------
-- 10.c UNE SEULE PÉRIODE PAR PASSAGE
-- ------------------------------------------------------------
-- Le § 5.b relit la table APRÈS que le § 5.a y a écrit : un abonnement
-- dont l'essai était échu depuis longtemps ressortait aussitôt, et le
-- MÊME passage émettait deux factures — donc deux prélèvements
-- exigibles le même jour, puisque la machine pose un délai de zéro.
select public.saas_start_subscription(
  (select v from ids where k='orgP'), 'team', 'monthly', true,
  'stripe', 'test', 'cus_cycle_P', true, 'Souscription oubliée quatre mois.');

update public.organization_subscriptions
   set trial_started_at = now() - interval '5 months',
       trial_ends_at = (current_date - 120)::timestamptz,
       billing_anchor_day = extract(day from current_date - 120)::smallint
 where organization_id = (select v from ids where k='orgP');

select public.saas_run_billing_cycle(current_date);

insert into res select 'UN SEUL PASSAGE N''ÉMET QU''UNE FACTURE, MÊME APRÈS QUATRE MOIS D''OUBLI','1',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgP'));

-- Une nuit de plus rattrape UNE période de plus, jamais deux.
select public.saas_run_billing_cycle(current_date);

insert into res select 'Le rattrapage se fait UNE NUIT À LA FOIS','2',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgP'));

-- ------------------------------------------------------------
-- 10.d UN ESSAI RÉSILIÉ SE TERMINE VRAIMENT
-- ------------------------------------------------------------
-- Le § 5.a excluait cancel_at_period_end et le § 5.b ne regarde que
-- « active » et « pastDue » : personne ne ramassait la ligne. Un essai
-- résilié restait en « trialing » POUR TOUJOURS — droits conservés,
-- aucun prélèvement, aucun écran pour le dire.
select public.saas_start_subscription(
  (select v from ids where k='orgQ'), 'team', 'monthly', true,
  'stripe', 'test', 'cus_cycle_Q', true, 'Souscription résiliée pendant l''essai.');

update public.organization_subscriptions
   set trial_started_at = now() - interval '1 month',
       trial_ends_at = current_date::timestamptz,
       cancel_at_period_end = true
 where organization_id = (select v from ids where k='orgQ');

select public.saas_run_billing_cycle(current_date);

insert into res select 'UN ESSAI RÉSILIÉ À SON TERME SE CLÔT','cancelled',
  (select status from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgQ'));

insert into res select 'Et la date de résiliation est posée','true',
  (select (cancelled_at is not null)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgQ'));

insert into res select 'SANS LUI FACTURER UN MOIS QU''IL N''A PAS DEMANDÉ','0',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgQ'));

-- ------------------------------------------------------------
-- 10.e ON NE FACTURE PAS UN JOUR QUI N'EST PAS ARRIVÉ
-- ------------------------------------------------------------
-- Un seul appel avec une date future émettait de VRAIES factures,
-- numérotées dans la séquence légale, pour des périodes non commencées
-- et exigibles le jour même. Le geste est irréversible : le compteur
-- est consommé sans trou et une facture émise ne se corrige que par un
-- avoir.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.saas_run_billing_cycle((current_date + 400)::date);
  exception when others then refuse := true;
  end;
  insert into res values ('LE CYCLE REFUSE UN JOUR FUTUR','true', refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.relances_calculer((current_date + 1)::date);
  exception when others then refuse := true;
  end;
  insert into res values ('LES RELANCES AUSSI','true', refuse::text);
end $$;

do $$
declare passe boolean := true;
begin
  begin
    perform public.saas_run_billing_cycle((current_date - 1)::date);
  exception when others then passe := false;
  end;
  insert into res values
    ('Le rattrapage VERS LE PASSÉ reste permis : c''est le travail normal','true', passe::text);
end $$;

-- ------------------------------------------------------------
-- 10.f LES SIÈGES ENCAISSÉS SONT LES SIÈGES FACTURÉS
-- ------------------------------------------------------------
-- La caisse facturait max(0, membres − sièges compris) et
-- saas_start_subscription n'écrivait JAMAIS billable_extra_seats : le
-- client était débité de 83,52 € et recevait une facture de 47,88 €.
-- Le rapprochement du webhook exige le montant EXACT — il ne trouvait
-- rien.
select public.saas_start_subscription(
  (select v from ids where k='orgR'), 'solo', 'monthly', false,
  'stripe', 'test', 'cus_cycle_R', true, 'Souscription à quatre comptes.',
  null, null, 3);

insert into res select 'LES SIÈGES FACTURÉS PAR LA CAISSE SONT ÉCRITS SUR L''ABONNEMENT','3',
  (select billable_extra_seats::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgR'));

insert into res select 'ET LA FACTURE LES PORTE : le client paie ce qu''il a été débité','1',
  (select count(*)::text from public.saas_invoice_lines l
     join public.saas_invoices i on i.id = l.invoice_id
    where i.organization_id = (select v from ids where k='orgR')
      and l.kind = 'seats' and l.quantity = 3);

-- ------------------------------------------------------------
-- 10.g LA FIN D'ESSAI VIENT DU PRESTATAIRE, PAS D'UN RECALCUL
-- ------------------------------------------------------------
-- La base compte en UTC (mesuré) et l'écran compte à Paris. Entre
-- minuit et 2 h, les deux ne sont pas le même jour — et c'est le
-- prestataire qui débite, à la date annoncée au client. Un recalcul
-- fixait une ancre différente, donc décalait TOUS les mois suivants.
select set_config('request.jwt.claims',
  json_build_object('sub','c9890021-0000-4000-8000-000000000089')::text, true);
insert into ids select 'orgT', public.create_professional_organization('Cycle T Ancre','landscaper');
select set_config('request.jwt.claims', null, true);

update public.business_organizations
   set legal_name = 'SARL Cycle T', siret = '151 515 151 00015',
       address_line1 = '15 rue du Cycle', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@cycle-t.test'
 where id = (select v from ids where k='orgT');

select public.saas_start_subscription(
  (select v from ids where k='orgT'), 'team', 'monthly', true,
  'stripe', 'test', 'cus_cycle_T', true, 'Essai daté par le prestataire.',
  (current_date + 29)::date, 31::smallint, null);

insert into res select 'LA FIN D''ESSAI EST CELLE DU PRESTATAIRE, AU JOUR PRÈS',
  (current_date + 29)::text,
  (select trial_ends_at::date::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgT'));

insert into res select 'ET L''ANCRE EST CELLE ANNONCÉE, PAS CELLE DÉDUITE DE LA DATE','31',
  (select billing_anchor_day::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgT'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.saas_start_subscription(
      (select v from ids where k='orgP'), 'team', 'monthly', true,
      'stripe', 'test', 'cus_x', true, 'Essai d''un an par faute de frappe.',
      (current_date + 365)::date, null, null);
  exception when others then refuse := true;
  end;
  insert into res values ('UN ESSAI D''UN AN VENU DU DEHORS EST REFUSÉ','true', refuse::text);
end $$;

-- ------------------------------------------------------------
-- 10.h LA PORTE SE FERME QUAND LE DEVIS CESSE D'ÊTRE VALABLE
-- ------------------------------------------------------------
-- partager_devis figeait expires_at au moment du partage. Un
-- paysagiste qui RACCOURCISSAIT ensuite la validité laissait la porte
-- ouverte : la page affichait « Valable jusqu'au <date passée> » tout
-- en montrant le document.
-- UN DEVIS NEUF, AVEC SON PROPRE LIEN. Le § 6 a révoqué et rejoué les
-- siens ; s'appuyer sur ce qu'il laisse derrière donnerait un test qui
-- passe pour la mauvaise raison — un jeton nul refuse aussi.
insert into ids select 'devisExp', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           issued_on, valid_until)
select (select v from ids where k='devisExp'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Devis dont la validité sera raccourcie', 'sent',
       current_date - 30, current_date + 60;

select set_config('request.jwt.claims',
  json_build_object('sub','c9890002-0000-4000-8000-000000000089')::text, true);
set local role authenticated;
insert into att select 'jetonExp',
  (select token from public.partager_devis((select v from ids where k='devisExp')));
reset role;
select set_config('request.jwt.claims', null, true);

set local role anon;
insert into res select 'Point de départ : le lien tout neuf ouvre bien le devis','true',
  (select ok::text from public.devis_par_jeton((select v from att where k='jetonExp')));
reset role;

-- Le paysagiste corrige la date de validité — une offre retirée, une
-- erreur de saisie. issued_on recule avec elle : quotes_validity_ordered
-- (0055) exige que la validité ne précède pas l'émission.
update public.quotes
   set issued_on = current_date - 30, valid_until = current_date - 1
 where id = (select v from ids where k='devisExp');

set local role anon;
insert into res select 'UN DEVIS EXPIRÉ NE S''OUVRE PLUS, MÊME AVEC UN LIEN ENCORE JEUNE','false',
  (select ok::text from public.devis_par_jeton((select v from att where k='jetonExp')));
reset role;

insert into res select 'Le lien, lui, n''a pas expiré : c''est bien le DEVIS qui ferme la porte','true',
  (select (expires_at > now())::text from public.document_share_links
    where document_id = (select v from ids where k='devisExp') and revoked_at is null);

-- ------------------------------------------------------------
-- 10.i LES OUVERTURES SONT BORNÉES
-- ------------------------------------------------------------
-- C'était le seul chemin d'écriture ouvert à un anonyme, et il n'était
-- borné nulle part : 500 lignes mesurées avec un seul jeton. La table
-- voisine des ÉCHECS plafonnait déjà « pour qu'une table de journal ne
-- devienne pas le levier par lequel on remplit le disque » ; le journal
-- des SUCCÈS n'avait rien reçu d'équivalent.
update public.quotes set valid_until = current_date + 60
 where id = (select v from ids where k='devisExp');

insert into att select 'ouvAvant', (select count(*)::text from public.document_share_openings o
  join public.document_share_links l on l.id = o.link_id
 where l.document_id = (select v from ids where k='devisExp'));

set local role anon;
do $$
declare i integer;
begin
  for i in 1..20 loop
    perform public.devis_par_jeton((select v from att where k='jetonExp'));
  end loop;
end $$;
reset role;

insert into res select 'VINGT OUVERTURES DE SUITE N''ÉCRIVENT PAS VINGT LIGNES','0',
  ((select count(*) from public.document_share_openings o
      join public.document_share_links l on l.id = o.link_id
     where l.document_id = (select v from ids where k='devisExp'))
   - (select v::bigint from att where k='ouvAvant'))::text;

insert into res select 'Mais la dernière ouverture reste datée : l''accusé de lecture est intact','true',
  (select (last_opened_at > now() - interval '1 minute')::text
     from public.document_share_links
    where document_id = (select v from ids where k='devisExp') and revoked_at is null);

-- ------------------------------------------------------------
-- 10.j LA CADENCE DES RELANCES NE S'EFFONDRE PLUS
-- ------------------------------------------------------------
-- L'échéance de CHAQUE rang était ancrée sur sent_at, un point fixe.
-- Dès qu'un devis était plus vieux que reminder_max × délai, toute
-- l'échelle était échue d'un coup : trois relances en trois jours au
-- lieu de trois semaines. C'était l'état NORMAL du portefeuille le jour
-- où une entreprise active les relances, et de tout le parc au
-- redémarrage après un arrêt de l'ordonnanceur.
insert into ids select 'devisVieux', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           sent_at, valid_until)
select (select v from ids where k='devisVieux'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Devis de soixante jours', 'sent', now() - interval '60 days', current_date + 60;

update public.email_organization_settings
   set reminders_enabled = true, reminder_delay_days = 7, reminder_max = 3
 where organization_id = (select v from ids where k='orgA');

select public.relances_calculer(current_date);

insert into res select 'Un devis oublié depuis soixante jours reçoit sa relance de rang 2','2',
  (select occurrence::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisVieux'));

-- Le planificateur l'expédie : on dépose au journal ce que déposerait
-- la fonction Edge. AUCUN APPEL RÉSEAU.
insert into public.email_messages
  (organization_id, template_key, nature, template_version, recipient_kind,
   to_email, entity_type, entity_id, from_email, from_name, reply_to_email,
   subject, body_text, body_html_sha256, occurrence, status, sent_at)
select (select v from ids where k='orgA'), 'devisRelance', 'transactionnel',
       'test-cycle-89',
       'clientFinal', 'madame@cycle.invalid', 'quote',
       (select v from ids where k='devisVieux'),
       'no-reply@oasis.test', 'Cycle A Paysages', 'contact@cycle-a.test',
       'Votre devis', 'Bonjour, votre devis vous attend.',
       repeat('a', 64), 2, 'delivered', now();

delete from public.relances_planifiees
 where entity_id = (select v from ids where k='devisVieux');
select public.relances_calculer(current_date);

-- L'ASSERTION QUI PORTE TOUT LE PARAGRAPHE. Avant la correction, le
-- rang 3 était déposé ICI, échu le jour même — deuxième relance hier,
-- troisième aujourd'hui. C'est ce qui donnait trois relances en trois
-- jours.
insert into res select 'LA RELANCE PARTIE AUJOURD''HUI N''EN DÉCLENCHE PAS UNE AUTRE DEMAIN','0',
  (select count(*)::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisVieux'));

-- ET SEPT JOURS PLUS TARD, LE RANG SUIVANT EST DÛ. Le journal de 0084
-- est en AJOUT SEUL — on ne peut pas réécrire la date d'un message
-- déjà parti, et c'est très bien —, donc le cas « une semaine s'est
-- écoulée » se pose sur un second devis dont la relance de rang 2 date
-- de sept jours.
insert into ids select 'devisVieux2', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           sent_at, valid_until)
select (select v from ids where k='devisVieux2'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Devis relancé il y a une semaine', 'sent', now() - interval '60 days', current_date + 60;

insert into public.email_messages
  (organization_id, template_key, nature, template_version, recipient_kind,
   to_email, entity_type, entity_id, from_email, from_name, reply_to_email,
   subject, body_text, body_html_sha256, occurrence, status, sent_at, queued_at)
select (select v from ids where k='orgA'), 'devisRelance', 'transactionnel',
       'test-cycle-89', 'clientFinal', 'madame@cycle.invalid', 'quote',
       (select v from ids where k='devisVieux2'),
       'no-reply@oasis.test', 'Cycle A Paysages', 'contact@cycle-a.test',
       'Votre devis', 'Bonjour, votre devis vous attend.',
       repeat('c', 64), 2, 'delivered',
       now() - interval '7 days', now() - interval '7 days';

select public.relances_calculer(current_date);

insert into res select 'ET SEPT JOURS PLUS TARD, LE RANG 3 EST DÛ','3',
  (select occurrence::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisVieux2'));

insert into res select 'La cadence est donc bien de sept jours, pas d''un jour','true',
  (select (due_on <= current_date)::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisVieux2'));

-- ------------------------------------------------------------
-- 10.k UN COURRIEL QUI A REBONDI NE COMPTE PAS COMME UNE RELANCE
-- ------------------------------------------------------------
-- Le décompte retenait tout ce qui n'était pas « cancelled » — donc les
-- rebonds. Le client dont l'adresse est mauvaise n'a rien reçu, mais
-- son rang avançait : deux rebonds épuisaient silencieusement toutes
-- les relances d'un devis.
insert into ids select 'devisRebond', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           sent_at, valid_until)
select (select v from ids where k='devisRebond'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Devis à l''adresse fausse', 'sent', now() - interval '40 days', current_date + 60;

insert into public.email_messages
  (organization_id, template_key, nature, template_version, recipient_kind,
   to_email, entity_type, entity_id, from_email, from_name, reply_to_email,
   subject, body_text, body_html_sha256, occurrence, status, failure_reason)
select (select v from ids where k='orgA'), 'devisRelance', 'transactionnel',
       'test-cycle-89',
       'clientFinal', 'inconnu@cycle.invalid', 'quote',
       (select v from ids where k='devisRebond'),
       'no-reply@oasis.test', 'Cycle A Paysages', 'contact@cycle-a.test',
       'Votre devis', 'Bonjour, votre devis vous attend.',
       repeat('b', 64), 2, 'bounced', 'Adresse inexistante.';

select public.relances_calculer(current_date);

insert into res select 'UN REBOND NE CONSOMME PAS UN RANG : on repropose le 2','2',
  (select occurrence::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisRebond'));

-- ------------------------------------------------------------
-- 10.l UNE RÉSERVATION ABANDONNÉE EST REPRISE
-- ------------------------------------------------------------
-- relances_a_expedier ne choisissait que claimed_at is null, et aucune
-- fonction ne rendait une ligne réservée sans la terminer. Une ligne
-- réservée par un passage qui meurt n'était plus JAMAIS reprise, par
-- personne, et rien ne le signalait. Le rang était consommé sans
-- qu'aucun courriel ne parte.
insert into att select 'reserve1',
  (select count(*)::text from public.relances_a_expedier(50, 'passage-qui-meurt')
    where entity_id = (select v from ids where k='devisRebond'));

insert into res select 'Un passage réserve la ligne','1',
  (select v from att where k='reserve1');

insert into res select 'Un second passage immédiat ne la reprend pas : elle est en cours','0',
  (select count(*)::text from public.relances_a_expedier(50, 'passage-2')
    where entity_id = (select v from ids where k='devisRebond'));

-- Le passage est mort il y a deux heures.
update public.relances_planifiees set claimed_at = now() - interval '2 hours'
 where entity_id = (select v from ids where k='devisRebond');

insert into res select 'UNE RÉSERVATION PÉRIMÉE EST REPRISE, ET LA RELANCE PART QUAND MÊME','1',
  (select count(*)::text from public.relances_a_expedier(50, 'passage-3')
    where entity_id = (select v from ids where k='devisRebond'));

insert into res select 'Et la reprise se compte : une ligne qui tourne en rond se voit','2',
  (select claim_count::text from public.relances_planifiees
    where entity_id = (select v from ids where k='devisRebond'));

-- ------------------------------------------------------------
-- 10.m L'ENGAGEMENT ET SA GARDE DISENT LA MÊME DATE
-- ------------------------------------------------------------
-- saas_engagement_start_on testait « et l'essai court encore » ; le
-- déclencheur, non. Dès qu'un essai était échu sans que la nuit soit
-- passée — une nuit sautée suffit — la fonction annonçait
-- « aujourd'hui » et le déclencheur refusait cette date-là. Une remise
-- posée sur la date que la base venait de rendre était REJETÉE.
update public.organization_subscriptions
   set status = 'trialing', trial_started_at = now() - interval '70 days',
       trial_ends_at = (current_date - 40)::timestamptz,
       cancel_at_period_end = false, cancelled_at = null
 where organization_id = (select v from ids where k='orgQ');

insert into res select 'LA DATE ANNONCÉE EST CELLE DE LA FIN D''ESSAI, MÊME ÉCHUE',
  (current_date - 40)::text,
  public.saas_engagement_start_on((select v from ids where k='orgQ'))::text;

do $$
declare accepte boolean := true; v_debut date;
begin
  v_debut := public.saas_engagement_start_on((select v from ids where k='orgQ'));
  begin
    insert into public.subscription_discounts
      (organization_id, label, kind, value_cents, starts_on, ends_on,
       commitment_ends_on, reason)
    values ((select v from ids where k='orgQ'), 'Remise qui engage', 'fixedMonthlyPrice', 4990,
            v_debut, (v_debut + interval '12 months')::date,
            (v_debut + interval '12 months')::date, 'Épreuve de la garde après un essai échu.');
  exception when others then accepte := false;
  end;
  insert into res values
    ('ET LA REMISE POSÉE SUR CETTE DATE-LÀ EST ACCEPTÉE','true', accepte::text);
end $$;

-- ------------------------------------------------------------
-- 10.n LA VEILLE — S'APERCEVOIR QU'UNE NUIT A MANQUÉ
-- ------------------------------------------------------------
-- Les traces de début et de fin vivent dans la transaction du travail :
-- une nuit qui échoue efface sa propre trace, et il ne reste rien.
-- Rien dans le dépôt ne lisait cron.job_run_details, et aucune fonction
-- ne cherchait une nuit manquante.
insert into res select 'La veille voit que la facturation vient d''aboutir','false',
  (select en_retard::text from public.saas_ordonnanceur_sante());

insert into res select 'Et elle sait dire depuis quand','true',
  (select (derniere_execution is not null)::text from public.saas_ordonnanceur_sante());

select set_config('request.jwt.claims',
  json_build_object('sub','c9890001-0000-4000-8000-000000000089')::text, true);
set local role authenticated;
do $$
declare refuse boolean := false;
begin
  begin
    perform public.saas_ordonnanceur_sante();
  exception when others then refuse := true;
  end;
  insert into res values ('UN COMPTE ORDINAIRE NE LIT PAS L''ÉTAT DE L''ORDONNANCEUR','true', refuse::text);
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

-- ------------------------------------------------------------
-- 10.o LES DEUX TÂCHES SONT POSÉES DÉSACTIVÉES, ET SANS SECRET
-- ------------------------------------------------------------
-- pg_cron est INSTALLÉE en production (mesuré) : sans ce désarmement,
-- appliquer la migration ferait facturer tout le parc la nuit suivante,
-- sur des données que personne n'a relues. Une première nuit doit être
-- choisie, pas subie.
insert into res select 'LES DEUX TÂCHES SONT POSÉES MAIS DÉSARMÉES','2',
  coalesce((select count(*)::text from cron.job
    where jobname like 'oasis-%' and not active), 'pg_cron absente');

insert into res select 'AUCUN SECRET NE DESCEND DANS cron.job','0',
  coalesce((select count(*)::text from cron.job
    where jobname like 'oasis-%'
      and command ~* 'Bearer|sb_secret|service_role|eyJ|https?://|net\.http'), '0');

-- ------------------------------------------------------------
-- 10.p LES VERROUS D'AVIS SONT ÉCRITS, PAS SUPPOSÉS
-- ------------------------------------------------------------
-- Ce qui protégeait jusqu'ici était incident : l'update précédait la
-- facture, donc le verrou de ligne sérialisait deux passages visant la
-- même entreprise. Cela ne couvrait pas deux passages portant un
-- p_today différent — la tâche de 03h15 croisant un appel manuel.
insert into res select 'Le cycle de facturation prend un verrou d''avis','true',
  (select (pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'saas_run_billing_cycle');

insert into res select 'Le calcul des relances aussi','true',
  (select (pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'relances_calculer');

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
