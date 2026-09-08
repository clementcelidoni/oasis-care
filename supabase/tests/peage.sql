-- Oasis Care — LE PÉAGE (migration 0092).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. UNE ORGANISATION SUSPENDUE NE PERD RIEN ET PEUT PAYER (§ 4).
--      C'est la moitié du chantier, et la plus facile à rater : on
--      compte ses clients et ses factures AVANT la suspension, on joue
--      la suspension, on recompte, on le fait payer, on recompte
--      encore. Aucun chiffre ne bouge. Un logiciel de gestion détient
--      la mémoire d'une entreprise ; la prendre en otage pour
--      trente-neuf euros détruirait l'entreprise, pas l'abonnement.
--
--   2. LE PÉAGE MORD (§ 3). Sans contrat, on ne crée plus de client, on
--      n'émet plus de facture, on n'invite plus personne. Mesuré sous
--      RLS réelle, en rôle `authenticated`, jamais déduit d'une lecture
--      de politique.
--
--   3. LES TROIS MOMENTS SONT DISTINCTS (§ 2 et § 3). Faire grossir la
--      note se ferme au premier impayé ; produire continue pendant le
--      sursis et s'arrête après. Si ces deux gestes se fermaient
--      ensemble, la règle ne vaudrait pas ses trois états.
--
--   4. LES QUATRE PIÈGES, un paragraphe chacun, et chacun échoue si on
--      le casse :
--        § 5 le client du portail n'est pas puni pour son paysagiste ;
--        § 6 la courtoisie iOS ne finance pas Oasis Care Pro ;
--        § 7 un Enterprise posé à la main reste ouvert, sans Stripe,
--            sans dates, sans référence ;
--        § 4 la suspension ne touche ni la donnée ni le paiement.
--
--   5. CE QUI RESTE OUVERT RESTE OUVERT (§ 8). Les dix-huit exemptions
--      ne sont pas un commentaire : elles sont jouées. Écrire au
--      journal, recevoir une notification, retrouver ses derniers
--      écrans — tout cela marche encore, suspendu.
--
--   6. LA FONCTION DE DÉCISION EST BIEN GARDÉE (§ 9). `security
--      definer` n'a pas de RLS à lui : son search_path est gelé,
--      pg_temp en dernier, et EXECUTE n'est accordé à personne de trop.
--      Une fonction de décision mal accordée est une porte dérobée qui
--      ouvre tout le parc d'un coup.
--
--   7. LE PÉAGE NE S'OUBLIE PAS (§ 10). peage_couverture() doit rendre
--      ZÉRO ligne : toute table portant un organization_id est classée
--      et gardée. C'est ainsi qu'on se rendra compte d'un trou avant
--      qu'un client ne le trouve.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les abonnements, ni les clients, ni les factures.
--
-- AUCUN APPEL RÉSEAU. Le « prestataire de paiement » de ce fichier est
-- une référence de client inventée : le réabonnement du § 4 est joué
-- côté base, exactement comme le webhook l'appellerait.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0092, ou l'envoyer à l'API Management. UN SEUL bloc begin/rollback :
-- un fichier découpé en plusieurs blocs verrait son premier rollback
-- annuler les migrations posées devant.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on res to anon;
grant all on ids to anon;


-- ============================================================
-- LES DEUX OUTILS DE MESURE
-- ============================================================
--
-- Tout ce fichier joue de VRAIS gestes sous de VRAIS rôles. Ces deux
-- fonctions endossent l'identité demandée, tentent le geste, notent le
-- verdict et rendent la main à postgres. Elles n'existent que le temps
-- de la transaction.

-- « Untel a-t-il pu faire ceci ? » — vrai ou faux, jamais d'erreur qui
-- remonte : un refus est une mesure, pas un incident.
create or replace function pg_temp.geste(p_nom text, p_qui uuid, p_sql text, p_attendu boolean)
returns void language plpgsql as $$
declare ok boolean := true;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then ok := false;
  end;
  execute 'reset role';
  insert into res values (p_nom, p_attendu::text, ok::text);
end $$;

-- « Que voit untel ? » — la valeur rendue, ou le mot ERREUR.
create or replace function pg_temp.vue(p_nom text, p_qui uuid, p_sql text, p_attendu text)
returns void language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then v := 'ERREUR';
  end;
  execute 'reset role';
  insert into res values (p_nom, p_attendu, coalesce(v, 'null'));
end $$;


-- ============================================================
-- LES COMPTES
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('c9920001-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-ouvert@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920002-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-sursis@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920003-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-restreint@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920004-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-transit@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920005-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-resilie@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920006-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-enterprise@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920007-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-courtoisie@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920008-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-particulier@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('c9920009-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-essai@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Le dirigeant d'une entreprise que NOTRE facturation a oubliée.
 ('c9920010-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pe-panne@test.invalid','',now(),now(),now(),now(),'{}','{}');


-- ============================================================
-- LES ENTREPRISES — UNE PAR ÉTAT DU CONTRAT
-- ============================================================
--
-- Toutes naissent par le SEUL chemin de création possible :
-- create_professional_organization(). Ce qui les distingue tient
-- ensuite dans une seule ligne d'abonnement — ou dans son absence.

select set_config('request.jwt.claims',
  json_build_object('sub','c9920001-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgO', public.create_professional_organization('Péage Ouvert Paysages','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920002-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgS', public.create_professional_organization('Péage Sursis Jardins','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920003-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgR', public.create_professional_organization('Péage Restreint Espaces','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920004-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgT', public.create_professional_organization('Péage Transit Verdure','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920005-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgC', public.create_professional_organization('Péage Résilié Elagage','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920006-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgE', public.create_professional_organization('Péage Enterprise Groupe','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920007-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgI', public.create_professional_organization('Péage Courtoisie iOS','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920009-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgEs', public.create_professional_organization('Péage Essai En Cours','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','c9920010-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgP', public.create_professional_organization('Péage Facturation En Panne','landscaper');

select set_config('request.jwt.claims', '', true);


-- --- L'OUTIL QUI MANQUAIT : UNE CRÉANCE -----------------------
--
-- Le péage ne ferme plus sur une DATE mais sur une FACTURE ÉMISE,
-- ÉCHUE ET NON RÉGLÉE (voir 0092 § 1). Les fixtures qui posaient
-- seulement une période échue décrivaient donc un client à jour dont
-- NOUS n'avions rien réclamé — et le péage a raison de le laisser
-- travailler.
--
-- Brouillon d'abord, puis émission : une facture émise ne reçoit plus
-- de lignes (protect_issued_saas_invoice_lines) et son contenu ne se
-- modifie plus. C'est exactement la contrainte de la vraie vie, et
-- c'est pour cela qu'on ne peut pas « vieillir » une facture après
-- coup.
create or replace function pg_temp.creance(p_org uuid, p_jours int, p_num text)
returns void language plpgsql as $c$
declare v_id uuid;
begin
  insert into public.saas_invoices
    (organization_id, number, status, period_start, period_end, billing_cycle,
     currency, vat_regime, vat_rate)
  values (p_org, p_num, 'draft', current_date - p_jours - 30, current_date - p_jours,
          'monthly', 'EUR', 'france', 20)
  returning id into v_id;

  insert into public.saas_invoice_lines
    (invoice_id, description, quantity, unit_price_cents, vat_rate)
  values (v_id, 'Abonnement Oasis Care Pro', 1, 13990, 20);

  update public.saas_invoices
     set status = 'issued',
         issued_on = current_date - p_jours,
         due_on = current_date - p_jours,
         issued_at = now() - (p_jours || ' days')::interval
   where id = v_id;
end $c$;


-- --- LES CONTRATS -------------------------------------------
-- Écrits directement : la table n'a AUCUNE politique d'écriture (c'est
-- sa force), et postgres n'est pas soumis à la RLS. C'est exactement la
-- ligne à ajouter aux fixtures des trente-neuf autres fichiers de
-- tests du dépôt.

-- Contrat en cours : période ouverte, échéance dans vingt-cinq jours.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle,
   current_period_start_on, current_period_end_on, billing_anchor_day)
select v, 'business', 'web', 'active', 'monthly',
       current_date - 5, current_date + 25, extract(day from current_date + 25)::smallint
  from ids where k = 'orgO';

-- Essai en cours : la carte est enregistrée, rien n'est débité, et
-- c'est un contrat parfaitement valable.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle,
   trial_started_at, trial_ends_at, payment_method_registered_at, billing_anchor_day)
select v, 'solo', 'web', 'trialing', 'monthly',
       now() - interval '20 days', now() + interval '10 days', now() - interval '20 days',
       extract(day from current_date)::smallint
  from ids where k = 'orgEs';

-- SURSIS : UNE FACTURE ÉCHUE DEPUIS CINQ JOURS. Un prélèvement a
-- échoué, personne n'a résilié.
--
-- ET SA PÉRIODE COURT ENCORE, VOLONTAIREMENT — elle finit dans
-- vingt-cinq jours. C'est le portrait exact du défaut que la règle
-- corrige : la tâche de nuit renouvelle sans jamais regarder si
-- l'argent est arrivé, si bien qu'un mauvais payeur a toujours une date
-- de fin dans le futur. Fermer sur la date le laissait ouvert pour
-- toujours ; fermer sur la facture le rattrape.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle,
   current_period_start_on, current_period_end_on, billing_anchor_day)
select v, 'business', 'web', 'active', 'monthly',
       current_date - 5, current_date + 25, extract(day from current_date + 25)::smallint
  from ids where k = 'orgS';
select pg_temp.creance((select v from ids where k='orgS'), 5, 'PEAGE-S-1');

-- RESTREINT : UNE FACTURE ÉCHUE DEPUIS SOIXANTE JOURS, bien au-delà du
-- sursis de trente.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle,
   current_period_start_on, current_period_end_on, billing_anchor_day)
select v, 'business', 'web', 'active', 'monthly',
       current_date - 100, current_date - 60, extract(day from current_date - 60)::smallint
  from ids where k = 'orgR';
select pg_temp.creance((select v from ids where k='orgR'), 60, 'PEAGE-R-1');

-- LA FACTURATION EN PANNE : période échue depuis quarante jours, et
-- AUCUNE facture émise. C'est l'état du parc aujourd'hui — les deux
-- tâches de nuit dorment, l'identité d'émetteur est vide, rien ne part.
-- Fermer ici punirait un client parfaitement à jour pour une panne de
-- NOTRE côté.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle,
   current_period_start_on, current_period_end_on, billing_anchor_day)
select v, 'business', 'web', 'active', 'monthly',
       current_date - 70, current_date - 40, extract(day from current_date - 40)::smallint
  from ids where k = 'orgP';

-- RÉSILIÉ : le terme est passé d'UN SEUL jour. Si la résiliation
-- donnait droit au sursis, cette entreprise serait encore ouverte —
-- et c'est ce que ce jeu d'essai interdit.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle, cancelled_at,
   current_period_start_on, current_period_end_on, billing_anchor_day)
select v, 'business', 'web', 'cancelled', 'monthly', now() - interval '40 days',
       current_date - 40, current_date - 1, extract(day from current_date - 1)::smallint
  from ids where k = 'orgC';

-- ENTERPRISE, POSÉ À LA MAIN. Le portrait exact du piège 3 :
-- provider 'manual', AUCUNE référence chez le prestataire, AUCUNE date
-- de période, un prix négocié. Un péage qui lirait le dossier Stripe le
-- mettrait dehors le premier soir.
insert into public.organization_subscriptions
  (organization_id, plan, provider, status, billing_cycle,
   negotiated_monthly_price_cents, negotiated_yearly_price_cents, note)
select v, 'enterprise', 'manual', 'active', 'monthly', 29900, 299000,
       'Contrat négocié, signé sur papier.'
  from ids where k = 'orgE';

-- orgT et orgI : AUCUNE LIGNE. C'est l'état de transit, et c'est
-- exactement celui de la vraie organisation du dirigeant aujourd'hui.


-- --- LA COURTOISIE iOS (piège 2) -----------------------------
-- Le propriétaire d'orgI a un droit « complimentary » sur son espace
-- PERSONNEL, comme la migration 0042 en a posé vingt-cinq. Cet axe-là
-- est par UTILISATEUR et par ESPACE ; le contrat Pro est par
-- ORGANISATION. Les croiser offrirait Oasis Care Pro à toute entreprise
-- dont un salarié a payé un abonnement sur son iPhone.
insert into public.workspaces (id, owner_id, name, is_personal)
values ('c992ffff-0000-4000-8000-000000000001',
        'c9920007-0000-4000-8000-000000000092', 'Espace personnel', true);

insert into public.subscription_entitlements
  (user_id, workspace_id, plan, entitlement, source, status)
values ('c9920007-0000-4000-8000-000000000092',
        'c992ffff-0000-4000-8000-000000000001',
        'biolab', 'biolab', 'complimentary', 'subscribed');


-- --- LA MATIÈRE QU'ORGR A SAISIE PENDANT QU'ELLE PAYAIT ------
-- Deux clients et une facture, écrits en postgres : ce sont les
-- données de l'entreprise, celles qu'une suspension ne doit pas
-- toucher. Le second client est jetable — il sert à prouver au § 4
-- qu'on peut encore SUPPRIMER quand on est fermé.

insert into public.crm_customers (id, organization_id, display_name, kind)
select 'c992aaaa-0000-4000-8000-000000000001', v, 'Madame Dupont', 'individual'
  from ids where k = 'orgR';
insert into public.crm_customers (id, organization_id, display_name, kind)
select 'c992aaaa-0000-4000-8000-000000000002', v, 'Client jetable', 'individual'
  from ids where k = 'orgR';

insert into public.invoices (id, organization_id, customer_id, status)
select 'c992bbbb-0000-4000-8000-000000000001', v,
       'c992aaaa-0000-4000-8000-000000000001', 'draft'
  from ids where k = 'orgR';

-- Une fiche société complète : c'est une entreprise qu'on peut
-- facturer, pas une coquille. Le réabonnement du § 4 en a besoin.
update public.business_organizations
   set legal_name = 'PÉAGE RESTREINT ESPACES SARL',
       siret = '73282932000074',
       vat_number = 'FR44732829320'
 where id = (select v from ids where k = 'orgR');


-- --- LE CLIENT DU PORTAIL D'ORGR (piège 1) -------------------
-- Un particulier. Il n'est membre de RIEN : ni organization_members,
-- ni workspace_members. Il est rattaché à une fiche client, un point.
insert into public.client_portal_access (organization_id, customer_id, user_id)
select v, 'c992aaaa-0000-4000-8000-000000000001',
       'c9920008-0000-4000-8000-000000000092'
  from ids where k = 'orgR';


-- ============================================================
-- § 1. LA RÈGLE, ÉTAT PAR ÉTAT
-- ============================================================
--
-- Une seule fonction lit le contrat, et elle rend un mot. Si l'un de
-- ces huit mots change, toute la suite du fichier ment.

insert into res select 'Contrat en cours → ouvert', 'ouvert',
  public.peage_etat_organisation((select v from ids where k='orgO'));

insert into res select 'Essai en cours → ouvert (la carte est posée, la promesse tenue)', 'ouvert',
  public.peage_etat_organisation((select v from ids where k='orgEs'));

insert into res select 'Facture échue depuis 5 jours → sursis (incident bancaire, pas faute)', 'sursis',
  public.peage_etat_organisation((select v from ids where k='orgS'));

insert into res select 'Facture échue depuis 60 jours → restreint', 'restreint',
  public.peage_etat_organisation((select v from ids where k='orgR'));

-- ══════════════════════════════════════════════════════════════════
-- LE DÉFAUT QUE LA RÈGLE CORRIGE, DANS SES DEUX SENS
-- ══════════════════════════════════════════════════════════════════
--
-- Ces deux lignes valent tout le paragraphe. Elles disent que le péage
-- a cessé de lire le calendrier pour lire la comptabilité.
--
--   • Le MAUVAIS PAYEUR ne se blanchit plus. Sa période a été
--     renouvelée cette nuit — elle court jusqu'à J+25 — et il est
--     pourtant en sursis, parce que sa facture, elle, n'est pas payée.
--     Sur l'ancienne règle, il était « ouvert », et il le serait resté
--     indéfiniment : la nuit repoussait la date chaque mois.
--
--   • Le BON PAYEUR ne tombe plus le premier. Période échue de
--     quarante jours, mais nous n'avons émis aucune facture : on ne
--     ferme pas un client pour une panne de notre côté.

insert into res select 'LE MAUVAIS PAYEUR NE SE BLANCHIT PAS : sa période court encore jusqu''à J+25',
  (current_date + 25)::text,
  (select current_period_end_on::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgS'));

insert into res select 'ON NE FERME PAS SUR NOTRE PROPRE PANNE : période échue de 40 j, aucune facture émise', 'ouvert',
  public.peage_etat_organisation((select v from ids where k='orgP'));

insert into res select '… et il produit encore', 'true',
  public.peage_autorise((select v from ids where k='orgP'), 'exploiter', false)::text;

-- CE QUE L'ÉCRAN DIRA, ET QU'IL NE POUVAIT PAS DIRE. Le statut en base
-- reste « active » — aucune fonction de cette base ne pose 'pastDue' —
-- donc l'écran n'avait AUCUN moyen de savoir qu'il y avait un impayé.
insert into res select 'L''écran peut nommer la créance : depuis quand',
  (current_date - 5)::text,
  (public.peage_situation((select v from ids where k='orgS')) ->> 'impayeDepuis');

insert into res select 'L''écran peut nommer la créance : combien', '16788',
  (public.peage_situation((select v from ids where k='orgS')) ->> 'montantDuCents');

insert into res select 'L''écran sait combien de jours il reste', '25',
  (public.peage_situation((select v from ids where k='orgS')) ->> 'joursDeSursisRestants');

insert into res select 'Le statut en base, lui, dit toujours « active » : c''est pour cela que l''écran ne pouvait pas savoir', 'active',
  (public.peage_situation((select v from ids where k='orgS')) ->> 'statut');

insert into res select 'Aucune ligne d''abonnement → transit', 'transit',
  public.peage_etat_organisation((select v from ids where k='orgT'));

insert into res select 'Résiliation, terme passé d''UN jour → restreint, sans sursis', 'restreint',
  public.peage_etat_organisation((select v from ids where k='orgC'));

insert into res select 'Enterprise posé à la main, sans dates → ouvert', 'ouvert',
  public.peage_etat_organisation((select v from ids where k='orgE'));

insert into res select 'Une organisation nulle ne se péage pas', 'ouvert',
  public.peage_etat_organisation(null);


-- ============================================================
-- § 2. LES TROIS MOMENTS SONT DISTINCTS
-- ============================================================
--
-- C'est la décision de conception centrale : tous les gestes ne se
-- ferment pas au même moment. Si ces six lignes rendaient toutes la
-- même chose, la règle ne vaudrait pas ses trois états.

insert into res select 'Ouvert : produire', 'true',
  public.peage_autorise((select v from ids where k='orgO'), 'exploiter', false)::text;
insert into res select 'Ouvert : faire entrer un collègue', 'true',
  public.peage_autorise((select v from ids where k='orgO'), 'grandir', false)::text;

insert into res select 'Sursis : produire CONTINUE (sinon il ne peut plus se faire payer)', 'true',
  public.peage_autorise((select v from ids where k='orgS'), 'exploiter', false)::text;
insert into res select 'Sursis : faire entrer un collègue s''ARRÊTE (un siège est de l''argent dû)', 'false',
  public.peage_autorise((select v from ids where k='orgS'), 'grandir', false)::text;

insert into res select 'Restreint : produire s''arrête', 'false',
  public.peage_autorise((select v from ids where k='orgR'), 'exploiter', false)::text;
insert into res select 'Transit : produire n''a jamais commencé', 'false',
  public.peage_autorise((select v from ids where k='orgT'), 'exploiter', false)::text;


-- ============================================================
-- § 3. LE PÉAGE MORD — GESTES JOUÉS SOUS RLS RÉELLE
-- ============================================================
--
-- Jusqu'ici on interrogeait une fonction. Ici on ÉCRIT, en rôle
-- `authenticated`, sous l'identité du dirigeant, à travers les
-- politiques. C'est la seule mesure qui compte.

-- --- L'entreprise en règle fait tout -------------------------
select pg_temp.geste('Ouvert : il crée un client',
  'c9920001-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgO') || ''', ''Client d''''une entreprise en règle'', ''individual'')',
  true);

select pg_temp.geste('Ouvert : il invite un collègue',
  'c9920001-0000-4000-8000-000000000092',
  'insert into public.organization_invitations (organization_id, email, role) values ('''
  || (select v from ids where k='orgO') || ''', ''collegue-o@test.invalid'', ''manager'')',
  true);

-- --- LE SURSIS : la ligne de partage -------------------------
-- Ces deux mesures sont le cœur du § 2, jouées pour de vrai. Le même
-- dirigeant, la même seconde, deux verdicts opposés.
select pg_temp.geste('Sursis : il crée encore un client',
  'c9920002-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgS') || ''', ''Client pendant le sursis'', ''individual'')',
  true);

select pg_temp.geste('Sursis : il n''invite PLUS de collègue',
  'c9920002-0000-4000-8000-000000000092',
  'insert into public.organization_invitations (organization_id, email, role) values ('''
  || (select v from ids where k='orgS') || ''', ''collegue-s@test.invalid'', ''manager'')',
  false);

-- --- RESTREINT : la production s'arrête ----------------------
select pg_temp.geste('Restreint : il ne crée plus de client',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgR') || ''', ''Client interdit'', ''individual'')',
  false);

select pg_temp.geste('Restreint : il n''émet plus de facture',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.invoices (organization_id, customer_id, status) values ('''
  || (select v from ids where k='orgR') || ''', ''c992aaaa-0000-4000-8000-000000000001'', ''draft'')',
  false);

-- LA MODIFICATION DOIT ÉCHOUER BRUYAMMENT, PAS EN SILENCE. Au premier
-- passage de ce jeu d'essai, la politique de modification portait une
-- clause « using » : les lignes devenaient invisibles à l'ordre update,
-- PostgreSQL n'en modifiait aucune, ne signalait rien, et cette mesure
-- rendait « true ». L'écran aurait affiché « enregistré ». Les deux
-- assertions qui suivent sont donc solidaires : un vrai refus, ET la
-- preuve que rien n'a bougé.
select pg_temp.geste('Restreint : il ne modifie plus une fiche client, et on le lui DIT',
  'c9920003-0000-4000-8000-000000000092',
  'update public.crm_customers set notes = ''retouche interdite'' where id = ''c992aaaa-0000-4000-8000-000000000001''',
  false);

select pg_temp.vue('… et la fiche n''a effectivement pas bougé',
  'c9920003-0000-4000-8000-000000000092',
  'select coalesce(notes, ''(rien)'') from public.crm_customers where id = ''c992aaaa-0000-4000-8000-000000000001''',
  '(rien)');

select pg_temp.geste('Restreint : il n''invite plus personne',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.organization_invitations (organization_id, email, role) values ('''
  || (select v from ids where k='orgR') || ''', ''collegue-r@test.invalid'', ''manager'')',
  false);

-- --- TRANSIT : le contrat vient avant l'accès ----------------
-- C'est l'état exact de la vraie organisation du dirigeant : huit
-- étapes d'installation franchies, zéro abonnement, et jusqu'ici tous
-- les droits du monde.
select pg_temp.geste('Transit : le contrat vient AVANT l''accès',
  'c9920004-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgT') || ''', ''Client sans contrat'', ''individual'')',
  false);

-- --- RÉSILIÉ : une décision n'a pas de sursis ----------------
select pg_temp.geste('Résilié la veille : aucun mois de rab',
  'c9920005-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgC') || ''', ''Client après résiliation'', ''individual'')',
  false);

-- --- … MAIS LE TUNNEL D'INSCRIPTION RESTE PRATICABLE ---------
--
-- Une entreprise en transit doit pouvoir FINIR DE SE CONSTITUER : sans
-- SIRET ni numéro de TVA, aucune facture Oasis ne peut lui être
-- adressée, et elle ne pourrait donc jamais s'abonner. Si quelqu'un
-- range un jour business_organizations dans le champ du péage, ces
-- deux mesures tombent — et avec elles la seule porte du péage.

select pg_temp.geste('Transit : il renseigne quand même son SIRET et sa TVA',
  'c9920004-0000-4000-8000-000000000092',
  'update public.business_organizations set siret = ''73282932000074'', '
  || 'vat_number = ''FR44732829320'', legal_name = ''PÉAGE TRANSIT VERDURE SARL'' where id = '''
  || (select v from ids where k='orgT') || '''',
  true);

select pg_temp.vue('Transit : l''écran sait qu''il doit proposer l''abonnement',
  'c9920004-0000-4000-8000-000000000092',
  'select public.peage_situation('''
  || (select v from ids where k='orgT') || ''') ->> ''etat''',
  'transit');

-- Et l'objet rendu est complet même sans ligne de contrat : un écran
-- qui reçoit « rien du tout » affiche une page blanche au moment précis
-- où il doit proposer de s'abonner.
insert into res select 'Transit : la situation rendue est un objet, pas un vide', 'false',
  (public.peage_situation((select v from ids where k='orgT')) ->> 'peutExploiter');


-- ============================================================
-- § 4. LA SUSPENSION NE PREND RIEN, ET ELLE A UNE SORTIE
-- ============================================================
--
-- Piège 4, joué du début à la fin sur orgR : on compte, on constate
-- qu'il est fermé, on vérifie qu'il voit et exporte tout, qu'il peut
-- encore supprimer et corriger sa fiche fiscale, puis ON LE FAIT
-- PAYER — et on recompte.

-- --- Il voit tout --------------------------------------------
select pg_temp.vue('Suspendu, il voit ses clients',
  'c9920003-0000-4000-8000-000000000092',
  'select count(*)::text from public.crm_customers where organization_id = '''
  || (select v from ids where k='orgR') || '''',
  '2');

select pg_temp.vue('Suspendu, il voit ses factures',
  'c9920003-0000-4000-8000-000000000092',
  'select count(*)::text from public.invoices where organization_id = '''
  || (select v from ids where k='orgR') || '''',
  '1');

select pg_temp.vue('Suspendu, il voit CE QU''IL DOIT',
  'c9920003-0000-4000-8000-000000000092',
  'select status from public.organization_subscriptions where organization_id = '''
  || (select v from ids where k='orgR') || '''',
  'active');

select pg_temp.vue('Suspendu, l''écran sait quoi lui dire',
  'c9920003-0000-4000-8000-000000000092',
  'select public.peage_situation('''
  || (select v from ids where k='orgR') || ''') ->> ''etat''',
  'restreint');

-- --- Il peut encore corriger ce qui permet de le facturer ----
-- business_organizations ne porte PAS de colonne organization_id :
-- elle est hors du péage par construction, et c'est voulu. Sans cela
-- une entreprise fermée ne pourrait plus saisir le numéro de TVA sans
-- lequel aucune facture Oasis ne peut être émise.
select pg_temp.geste('Suspendu, il corrige encore sa fiche fiscale',
  'c9920003-0000-4000-8000-000000000092',
  'update public.business_organizations set vat_number = ''FR44732829320'' where id = '''
  || (select v from ids where k='orgR') || '''',
  true);

-- --- Il peut encore SUPPRIMER --------------------------------
-- Le droit à l'effacement ne se monnaie pas, et une entreprise qui
-- veut réduire sa note en retirant des comptes doit pouvoir le faire.
select pg_temp.geste('Suspendu, il peut encore supprimer (on ne l''enferme pas avec ses données)',
  'c9920003-0000-4000-8000-000000000092',
  'delete from public.crm_customers where id = ''c992aaaa-0000-4000-8000-000000000002''',
  true);

-- --- IL PAIE -------------------------------------------------
-- Exactement ce que le webhook fera : contexte machine (aucun JWT), et
-- la fonction de reprise plutôt que celle d'ouverture, qui lèverait
-- 23505 puisqu'une ligne existe déjà.
select set_config('request.jwt.claims', '', true);

do $$
declare v_repris record; v_erreur text;
begin
  begin
    select * into v_repris from public.saas_reopen_subscription(
      (select v from ids where k='orgR'), 'business', 'monthly',
      'stripe', 'test', 'cus_peage_test_0092', true,
      'Réabonnement joué par le jeu d''essai.');
    insert into res values ('Suspendu, IL PEUT PAYER ET ROUVRIR', 'active', v_repris.subscription_status);
  exception when others then
    get stacked diagnostics v_erreur = message_text;
    insert into res values ('Suspendu, IL PEUT PAYER ET ROUVRIR', 'active', 'ERREUR : ' || v_erreur);
  end;
end $$;

insert into res select 'Après paiement, le péage rouvre', 'ouvert',
  public.peage_etat_organisation((select v from ids where k='orgR'));

-- ══════════════════════════════════════════════════════════════════
-- ET IL ROUVRE MALGRÉ LA FACTURE IMPAYÉE D'AVANT — c'est le piège
-- qu'on ne voit qu'en jouant la scène jusqu'au bout.
-- ══════════════════════════════════════════════════════════════════
--
-- Le péage ferme sur une créance échue. Or la reprise NE RÈGLE PAS la
-- facture qui avait fermé le compte : une facture émise ne s'efface
-- pas, elle se règle ou se crédite. Sans précaution, le client payait
-- sa reprise et retrouvait porte close pour une créance datant d'un
-- temps où il ne pouvait déjà plus travailler. Le même piège que le
-- premier, un cran plus loin, et bien plus difficile à voir.
--
-- La reprise pose donc `peage_creances_depuis` à sa date : on ne
-- compte, POUR FERMER, que ce qui est dû depuis. La créance, elle, est
-- toujours là — ces deux lignes le prouvent ensemble.
insert into res select 'La créance d''avant est TOUJOURS AU DOSSIER (on n''efface rien)', '1',
  (select count(*)::text from public.saas_invoice_state
    where organization_id = (select v from ids where k='orgR')
      and effective_status = 'overdue');

insert into res select '… mais elle ne sert plus de verrou : la borne a été posée à la reprise', 'true',
  (select (peage_creances_depuis = current_date)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgR'));

-- CE QUE CE JEU D'ESSAI A TROUVÉ, ET QU'IL DÉFEND DÉSORMAIS.
-- saas_generate_invoices refuse aujourd'hui d'émettre : l'identité de
-- l'ÉMETTEUR — la nôtre — est incomplète en base. Au premier passage,
-- cette exception remontait et annulait tout : le client avait payé, et
-- son abonnement restait fermé pour une mention manquante sur NOTRE
-- papier à en-tête. La réouverture ne dépend plus de la facture, et le
-- refus part au journal de la machine pour qu'un humain régularise.
insert into res select 'La facture ne retient pas la porte : le refus est consigné, pas subi', '1',
  (select count(*)::text from public.saas_machine_events
    where organization_id = (select v from ids where k='orgR')
      and kind in ('subscription.reopened', 'subscription.reopenedWithoutInvoice')
      and kind = 'subscription.reopenedWithoutInvoice');

insert into res select 'La reprise n''offre PAS un second essai', 'true',
  (select (trial_started_at is null)::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgR'));

insert into res select 'La résiliation est levée, sinon il aurait payé pour rien', 'true',
  (select (cancelled_at is null and not cancel_at_period_end)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgR'));

select pg_temp.geste('Après paiement, il reprend le travail',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgR') || ''', ''Client d''''après la reprise'', ''individual'')',
  true);

-- --- ET RIEN N'A DISPARU -------------------------------------
-- Un client supprimé exprès, un client créé après la reprise : 2 - 1 + 1.
-- Madame Dupont et sa facture sont toujours là, à l'identique.
select pg_temp.vue('Rien n''a disparu pendant la fermeture',
  'c9920003-0000-4000-8000-000000000092',
  'select count(*)::text from public.crm_customers where organization_id = '''
  || (select v from ids where k='orgR') || '''',
  '2');

select pg_temp.vue('La facture émise avant la fermeture est intacte',
  'c9920003-0000-4000-8000-000000000092',
  'select count(*)::text from public.invoices where id = ''c992bbbb-0000-4000-8000-000000000001''',
  '1');

-- --- LA SORTIE NE S'OUVRE PAS N'IMPORTE QUAND ----------------
do $$
declare ok boolean := true;
begin
  begin
    perform public.saas_reopen_subscription(
      (select v from ids where k='orgO'), 'business', 'monthly',
      'stripe', 'test', 'cus_peage_test_deja_ouvert', true);
  exception when others then ok := false;
  end;
  insert into res values ('On ne « rouvre » pas un abonnement en cours (il le referait payer)', 'false', ok::text);
end $$;

do $$
declare ok boolean := true;
begin
  begin
    perform public.saas_reopen_subscription(
      (select v from ids where k='orgT'), 'business', 'monthly',
      'stripe', 'test', 'cus_peage_test_transit', true);
  exception when others then ok := false;
  end;
  insert into res values ('On ne « rouvre » pas ce qui n''a jamais été ouvert', 'false', ok::text);
end $$;


-- ============================================================
-- § 5. PIÈGE 1 — LE PORTAIL PASSE AVANT
-- ============================================================
--
-- Un particulier invité par son paysagiste n'a pas d'organisation et
-- n'en veut pas. Le punir parce que SON paysagiste n'a pas payé serait
-- punir le mauvais. La protection ne tient pas à une liste de tables :
-- elle tient à ce que le péage ne parle qu'aux MEMBRES.
--
-- On le mesure sur orgR PENDANT qu'elle était fermée — c'est fait
-- au-dessus, mais on remet l'entreprise en état fermé le temps du
-- paragraphe pour que la mesure porte.

-- ON REFERME PAR UNE CRÉANCE, PAS PAR UNE DATE — c'est la règle
-- depuis 0092 § 1. Et l'on recule la borne des créances : la reprise
-- du § 4 l'a posée à aujourd'hui, ce qui est exactement son rôle. On
-- joue donc « un mois plus tard, une facture est restée impayée ».
update public.organization_subscriptions
   set peage_creances_depuis = current_date - 90
 where organization_id = (select v from ids where k='orgR');
select pg_temp.creance((select v from ids where k='orgR'), 61, 'PEAGE-R-2');

insert into res select 'Le paysagiste est de nouveau fermé, le temps de ce paragraphe', 'restreint',
  public.peage_etat_organisation((select v from ids where k='orgR'));

insert into res select 'Le client du portail n''est membre de RIEN', 'false',
  (select exists (select 1 from public.organization_members
                   where user_id = 'c9920008-0000-4000-8000-000000000092')::text);

select pg_temp.vue('Il retrouve l''entreprise de son paysagiste (donc pas de « fondez une société »)',
  'c9920008-0000-4000-8000-000000000092',
  'select count(*)::text from public.client_portal_companies',
  '1');

select pg_temp.vue('Il lit son propre accès, paysagiste fermé ou non',
  'c9920008-0000-4000-8000-000000000092',
  'select count(*)::text from public.client_portal_access where user_id = auth.uid() and revoked_at is null',
  '1');

-- On appelle peage_autorise_LIGNE : c'est la seule fonction que les
-- politiques nomment, et donc la seule que `authenticated` a le droit
-- d'exécuter. peage_autorise, elle, répond sur n'importe quelle
-- entreprise et ne lui est plus accordée — voir le § 9.
select pg_temp.vue('Le péage ne lui parle pas : il n''est pas membre',
  'c9920008-0000-4000-8000-000000000092',
  'select public.peage_autorise_ligne('''
  || (select v from ids where k='orgR') || ''', null, ''exploiter'')::text',
  'true');

-- Et il n'obtient rien pour autant : ce sont les politiques
-- permissives, inchangées, qui restent seules juges.
select pg_temp.geste('… et il n''obtient rien de plus pour autant',
  'c9920008-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgR') || ''', ''Client écrit par le particulier'', ''individual'')',
  false);


-- ============================================================
-- § 6. PIÈGE 2 — LA COURTOISIE iPHONE NE FINANCE PAS OASIS PRO
-- ============================================================
--
-- Le droit de 0042 vit dans subscription_entitlements : PAR UTILISATEUR
-- et PAR ESPACE, sur un espace PERSONNEL, rattaché à aucune
-- organisation professionnelle. Le contrat Pro est PAR ORGANISATION.
-- Croiser les deux offrirait Oasis Care Pro à toute entreprise dont un
-- salarié a payé vingt euros sur son iPhone.

insert into res select 'Le propriétaire a bien son droit iOS de courtoisie', '1',
  (select count(*)::text from public.subscription_entitlements
    where user_id = 'c9920007-0000-4000-8000-000000000092'
      and source = 'complimentary' and status = 'subscribed');

insert into res select 'Et pourtant son entreprise est en transit', 'transit',
  public.peage_etat_organisation((select v from ids where k='orgI'));

select pg_temp.geste('Un abonnement iPhone n''ouvre RIEN côté Pro',
  'c9920007-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgI') || ''', ''Client payé par un iPhone'', ''individual'')',
  false);

-- La preuve qui survivra à une future « unification » : aucune des
-- fonctions du péage ne connaît le nom de cette table.
insert into res select 'Le péage ne lit JAMAIS subscription_entitlements', 'false',
  (select bool_or(pg_get_functiondef(p.oid) ilike '%subscription_entitlements%')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('peage_etat_organisation','peage_autorise','peage_situation','peage_exiger'));


-- ============================================================
-- § 7. PIÈGE 3 — ENTERPRISE EST SUR DEVIS
-- ============================================================
--
-- Un contrat négocié n'a ni dossier chez le prestataire, ni facture
-- automatique, ni parfois de dates. Le péage doit se lire sur le
-- STATUT et les DATES, jamais sur la présence d'un dossier Stripe.

insert into res select 'Le contrat Enterprise n''a AUCUNE référence chez le prestataire', 'true',
  (select (provider = 'manual' and external_reference is null
           and current_period_end_on is null)::text
     from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgE'));

select pg_temp.geste('… et pourtant l''entreprise travaille normalement',
  'c9920006-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgE') || ''', ''Client d''''un grand compte'', ''individual'')',
  true);

insert into res select 'Le péage ne regarde ni le prestataire ni sa référence', 'false',
  (select bool_or(pg_get_functiondef(p.oid) ~* '(provider|external_reference)')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('peage_etat_organisation','peage_autorise'));

-- Et la caisse en libre-service ne sait toujours pas ouvrir un
-- Enterprise, reprise comprise.
do $$
declare ok boolean := true;
begin
  begin
    perform public.saas_reopen_subscription(
      (select v from ids where k='orgR'), 'enterprise', 'monthly',
      'stripe', 'test', 'cus_peage_test_ent', true);
  exception when others then ok := false;
  end;
  insert into res values ('La reprise en libre-service refuse une offre sur devis', 'false', ok::text);
end $$;


-- ============================================================
-- § 8. LES DIX-HUIT EXEMPTIONS SONT JOUÉES, PAS COMMENTÉES
-- ============================================================
--
-- Chacune de ces trois mesures échouerait si quelqu'un décidait un
-- jour de « fermer tout pour être sûr ». Elles sont jouées sur orgR,
-- fermée.

select pg_temp.geste('Fermé, la trace continue de s''écrire (sinon le péage efface sa preuve)',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.audit_events (organization_id, actor_user_id, action, entity_type) values ('''
  || (select v from ids where k='orgR') || ''', ''c9920003-0000-4000-8000-000000000092'', ''peage.test'', ''organization'')',
  true);

select pg_temp.geste('Fermé, on peut encore lui dire qu''il faut payer',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.notifications (organization_id, title) values ('''
  || (select v from ids where k='orgR') || ''', ''Votre abonnement est arrivé à échéance'')',
  true);

select pg_temp.geste('Fermé, la navigation ne plante pas',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.user_recent_items (user_id, organization_id, entity_type, entity_id, title, url) values '
  || '(''c9920003-0000-4000-8000-000000000092'', '''
  || (select v from ids where k='orgR')
  || ''', ''customer'', ''c992aaaa-0000-4000-8000-000000000001'', ''Madame Dupont'', ''/clients'')',
  true);

-- SELECT et DELETE ne sont JAMAIS péagés. Ce n'est pas une intention,
-- c'est une propriété des politiques posées : on la mesure.
insert into res select 'Aucune politique de péage ne touche SELECT, DELETE ni ALL', '0',
  (select count(*)::text from pg_policies
    where schemaname = 'public'
      and permissive = 'RESTRICTIVE'
      and coalesce(qual, '') || coalesce(with_check, '') like '%peage_autorise%'
      and cmd not in ('INSERT', 'UPDATE'));


-- ============================================================
-- § 9. LA FONCTION DE DÉCISION EST BIEN GARDÉE
-- ============================================================
--
-- `security definer` n'a pas de RLS à lui : sa clause where et ses
-- grant sont ses seules barrières. Une fonction de décision mal
-- accordée ouvre tout le parc d'un coup.

insert into res select 'Le search_path du péage est gelé, pg_temp EN DERNIER', '4',
  (select count(*)::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('peage_etat_organisation','peage_autorise','peage_situation','peage_exiger')
      and p.prosecdef
      and 'search_path=public, pg_temp' = any (p.proconfig));

insert into res select 'EXECUTE n''est pas resté ouvert à `public`', 'false',
  (select bool_or(has_function_privilege('public', p.oid, 'execute'))::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('peage_etat_organisation','peage_autorise','peage_situation',
                        'peage_exiger','peage_couverture','saas_reopen_subscription'));

insert into res select 'Un anonyme ne lit pas l''état des contrats du parc', 'false',
  (select has_function_privilege('anon', p.oid, 'execute')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname = 'peage_etat_organisation');

-- CE QUE CE JEU D'ESSAI A TROUVÉ SUR LUI-MÊME. peage_situation() est
-- `security definer` : elle lit organization_subscriptions SANS que la
-- RLS de cette table s'applique. Accordée à `authenticated` sans autre
-- garde, elle laissait n'importe quel compte lire l'offre, le statut et
-- les échéances de N'IMPORTE QUELLE entreprise du parc — précisément ce
-- que les deux politiques de lecture de cette table interdisent. Elle
-- se garde désormais elle-même.
select pg_temp.vue('L''écran d''un dirigeant ne lit pas le contrat du voisin',
  'c9920001-0000-4000-8000-000000000092',
  'select coalesce(public.peage_situation('''
  || (select v from ids where k='orgR') || ''')::text, ''(rien)'')',
  '(rien)');

select pg_temp.vue('… mais il lit parfaitement le sien',
  'c9920001-0000-4000-8000-000000000092',
  'select public.peage_situation('''
  || (select v from ids where k='orgO') || ''') ->> ''etat''',
  'ouvert');

insert into res select 'peage_etat_organisation n''est pas offerte aux navigateurs', 'false',
  (select has_function_privilege('authenticated', p.oid, 'execute')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname = 'peage_etat_organisation');

-- LA LISTE EXHAUSTIVE, ET PAS UN CONTRÔLE PAR FONCTION. Vérifier une à
-- une celles qu'on connaît laisse passer celle qu'on a oubliée — et
-- c'est arrivé : les DEFAULT PRIVILEGES de Supabase avaient accordé
-- EXECUTE à anon et authenticated sur peage_garde_essai(), la fonction
-- du déclencheur, que personne n'avait pensé à retirer. Elle n'était pas
-- exploitable, mais un péage ne se garde pas « à peu près ». On fige
-- donc la liste entière.
insert into res select 'Un navigateur connecté n''exécute QUE ces trois fonctions du péage',
  'peage_autorise_ligne, peage_espace_de, peage_situation',
  coalesce((select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where (p.proname like 'peage%' or p.proname = 'saas_reopen_subscription')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'AUCUNE');

insert into res select 'Un visiteur anonyme n''en exécute que deux',
  'peage_autorise_ligne, peage_espace_de',
  coalesce((select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where (p.proname like 'peage%' or p.proname = 'saas_reopen_subscription')
      and has_function_privilege('anon', p.oid, 'EXECUTE')), 'AUCUNE');

-- ET AUCUNE POLITIQUE N'APPELLE LA DÉCISION EN DIRECT. Toutes passent
-- par l'adressage : c'est ce qui permet de ne donner EXECUTE qu'à lui,
-- et c'est aussi ce qui garantit qu'une seule fonction décide.
insert into res select 'Toutes les politiques passent par l''adressage, aucune n''appelle la décision en direct', '0',
  (select count(*)::text from pg_policies
    where schemaname = 'public'
      and coalesce(qual,'') || coalesce(with_check,'') like '%peage_autorise%'
      and coalesce(qual,'') || coalesce(with_check,'') not like '%peage_autorise_ligne%');

insert into res select 'Un client ne peut pas se rouvrir un abonnement lui-même', 'false',
  (select has_function_privilege('authenticated', p.oid, 'execute')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname = 'saas_reopen_subscription');

-- La carte du péage n'est pas une donnée de client.
select pg_temp.vue('La carte du péage n''est pas lisible par un client',
  'c9920001-0000-4000-8000-000000000092',
  'select count(*)::text from public.peage_perimetre',
  'ERREUR');

select pg_temp.geste('… et encore moins modifiable',
  'c9920001-0000-4000-8000-000000000092',
  'update public.peage_perimetre set geste = ''hors-champ'' where table_name = ''crm_customers''',
  false);

-- Le péage exempte les non-membres ; il n'OUVRE rien pour autant. Un
-- dirigeant parfaitement en règle n'écrit pas chez le voisin.
select pg_temp.geste('Une entreprise en règle n''écrit pas chez la voisine fermée',
  'c9920001-0000-4000-8000-000000000092',
  'insert into public.crm_customers (organization_id, display_name, kind) values ('''
  || (select v from ids where k='orgR') || ''', ''Client volé au voisin'', ''individual'')',
  false);

-- Un geste inconnu LÈVE. Une faute de frappe dans une politique
-- fermerait une table entière sans que rien ne le signale.
do $$
declare ok boolean := true;
begin
  begin
    perform public.peage_autorise((select v from ids where k='orgO'), 'bricoler', false);
  exception when others then ok := false;
  end;
  insert into res values ('Un geste inconnu lève au lieu de fermer en silence', 'false', ok::text);
end $$;


-- ============================================================
-- § 10. LE PÉAGE NE S'OUBLIE PAS
-- ============================================================
--
-- Une migration ne couvre que les tables du jour où on l'a lancée.
-- Celle qu'on ajoutera l'an prochain passerait au travers, en silence —
-- c'est exactement ainsi qu'on se retrouve avec 435 politiques dont
-- aucune ne parle d'argent.

insert into res select 'Aucune table portant un organization_id n''échappe au péage', '0',
  (select count(*)::text from public.peage_couverture());

insert into res select 'Chaque table du champ a ses DEUX politiques, création et modification', '0',
  (select count(*)::text
     from public.peage_perimetre p
    where p.geste <> 'hors-champ'
      and 2 <> (select count(*) from pg_policies pol
                 where pol.schemaname = 'public'
                   and pol.tablename = p.table_name
                   and pol.permissive = 'RESTRICTIVE'
                   and coalesce(pol.qual,'') || coalesce(pol.with_check,'') like '%peage_autorise%'));

insert into res select 'Toute exemption porte son motif écrit', '0',
  (select count(*)::text from public.peage_perimetre
    where geste = 'hors-champ' and coalesce(btrim(motif), '') = '');

-- LES POLITIQUES D'AVANT N'ONT PAS BOUGÉ D'UN CARACTÈRE. C'est tout
-- l'intérêt d'une politique restrictive : on AJOUTE, on ne réécrit
-- rien. Si un jour quelqu'un soude le péage dans une politique
-- existante, la règle vivra à deux endroits et l'un des deux
-- vieillira — c'est ce que cette mesure interdit.
insert into res select 'Aucune politique existante n''a été soudée au péage', '0',
  (select count(*)::text from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') || coalesce(with_check, '') like '%peage_autorise%'
      and policyname not like 'Péage%');

insert into res select 'Le péage a posé exactement deux politiques par table du champ', 'true',
  ((select count(*) from pg_policies
     where schemaname = 'public' and policyname like 'Péage%')
   = 2 * (select count(*) from public.peage_perimetre where geste <> 'hors-champ'))::text;


-- ============================================================
-- § 11. L'AXE ESPACE DE TRAVAIL — LA MOITIÉ DU PRODUIT
-- ============================================================
--
-- QUARANTE-NEUF TABLES sous RLS ne portent PAS d'organization_id :
-- elles portent un workspace_id. Ce sont les jardins, les plantes, le
-- jumeau numérique et TOUT LE BIOLAB, qui est un module vendu à part.
-- La première version du péage ne cherchait que la colonne
-- organization_id : ces tables restaient grandes ouvertes, et
-- peage_couverture() rendait zéro ligne parce qu'elle cherchait, elle
-- aussi, la même colonne. On croyait le péage complet.
--
-- Un péage aveugle à la moitié du produit n'est pas incomplet : il est
-- pire qu'absent, parce qu'on s'en remet à lui.

insert into ids select 'wsR', workspace_id from public.business_organizations
  where id = (select v from ids where k='orgR');
insert into ids select 'wsO', workspace_id from public.business_organizations
  where id = (select v from ids where k='orgO');

-- Un jardin de chacune des deux entreprises, posé par la machine.
insert into public.gardens (id, workspace_id, name)
select 'c992dddd-0000-4000-8000-000000000001', v, 'Jardin du restreint' from ids where k='wsR';
insert into public.gardens (id, workspace_id, name)
select 'c992dddd-0000-4000-8000-000000000002', v, 'Jardin de l''ouvert' from ids where k='wsO';

insert into res select 'ESPACE : l''entreprise fermée ne crée plus de jardin', 'false',
  public.peage_autorise_espace((select v from ids where k='wsR'), 'exploiter', false)::text;
insert into res select 'ESPACE : celle qui paie en crée encore', 'true',
  public.peage_autorise_espace((select v from ids where k='wsO'), 'exploiter', false)::text;

select pg_temp.geste('Restreint : il ne crée plus de jardin (axe espace)',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.gardens (id, workspace_id, name) values (gen_random_uuid(), '''
  || (select v from ids where k='wsR') || ''', ''Jardin refusé'')',
  false);

select pg_temp.geste('Restreint : il ne crée plus de plante',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.plants (id, workspace_id, common_name) values (gen_random_uuid(), '''
  || (select v from ids where k='wsR') || ''', ''Plante refusée'')',
  false);

select pg_temp.geste('Restreint : LE BIOLAB SE FERME AUSSI (c''est un module vendu)',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.culture_batches (workspace_id, batch_code) values ('''
  || (select v from ids where k='wsR') || ''', ''LOT-REFUSE'')',
  false);

select pg_temp.geste('Ouvert : la même écriture passe pour qui paie',
  'c9920001-0000-4000-8000-000000000092',
  'insert into public.gardens (id, workspace_id, name) values (gen_random_uuid(), '''
  || (select v from ids where k='wsO') || ''', ''Jardin accepté'')',
  true);

-- --- LA TABLE FILLE : LE PAYEUR EST CELUI DU PARENT -----------
-- Les zones d'un jardin ne portent NI organisation NI espace. Les
-- laisser dehors laissait aménager un jardin existant pendant qu'on ne
-- payait plus. On remonte au parent par une fonction « definer » : un
-- sous-select dans la politique serait soumis à la RLS du parent, et un
-- parent invisible rendrait NULL — c'est-à-dire OUVERT.
select pg_temp.geste('Restreint : il n''ajoute plus de zone à son jardin (table fille)',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.garden_zones (id, garden_id, name) values (gen_random_uuid(), ''c992dddd-0000-4000-8000-000000000001'', ''Zone refusée'')',
  false);

select pg_temp.geste('Ouvert : la même zone passe chez qui paie',
  'c9920001-0000-4000-8000-000000000092',
  'insert into public.garden_zones (id, garden_id, name) values (gen_random_uuid(), ''c992dddd-0000-4000-8000-000000000002'', ''Zone acceptée'')',
  true);

-- --- LE MONDE PARTICULIER DE L'iPHONE NE PAIE RIEN ------------
-- Un espace qu'aucune entreprise ne possède est un espace personnel
-- iOS. Le fermer au nom d'un contrat professionnel qu'il n'a jamais
-- signé serait absurde — et couperait l'application d'un salarié parce
-- que son patron n'a pas payé Oasis Care Pro.
insert into res select 'Un espace sans entreprise (iPhone) n''est pas péagé', 'true',
  public.peage_autorise_espace('c992ffff-0000-4000-8000-000000000001', 'exploiter', false)::text;

insert into res select 'Et un espace inconnu non plus', 'true',
  public.peage_autorise_espace(null, 'exploiter', false)::text;


-- ============================================================
-- § 12. LE DÉTACHEMENT — SORTIR DU PÉAGE DANS L'ORDRE MÊME
--       QUI MODIFIE LA LIGNE
-- ============================================================
--
-- Cinq tables péagées portent un organization_id NULLABLE, et
-- peage_autorise rend vrai sur NULL — ce qu'elle doit faire, sans quoi
-- une colonne nullable fermerait une table par accident. Mesuré sur
-- smart_tags (les étiquettes QR/NFC, une fonction vendue), ça ouvrait
-- deux trous :
--
--   • on insérait en posant simplement organization_id = null ;
--   • et surtout on MODIFIAIT une ligne péagée en la détachant dans le
--     même ordre — « update … set organization_id = null, <la vraie
--     modification> ». Le « with check » examine la ligne TELLE QU'ELLE
--     SERAIT, donc sans entreprise, et laissait passer. La modification
--     était appliquée ET la ligne quittait le péage pour toujours.
--
-- La seconde adresse — l'espace de travail — ferme les deux.

insert into public.smart_tags (id, workspace_id, organization_id, type, public_token, rack_label)
select 'c992eeee-0000-4000-8000-000000000001', (select v from ids where k='wsR'),
       (select v from ids where k='orgR'), 'qr', 'peage-detach-1', 'avant';

select pg_temp.geste('Restreint : l''étiquette avec entreprise est refusée (témoin)',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.smart_tags (workspace_id, organization_id, type, public_token) values ('''
  || (select v from ids where k='wsR') || ''', ''' || (select v from ids where k='orgR')
  || ''', ''qr'', ''peage-detach-2'')',
  false);

select pg_temp.geste('Restreint : et SANS entreprise elle l''est aussi (le trou est fermé)',
  'c9920003-0000-4000-8000-000000000092',
  'insert into public.smart_tags (workspace_id, type, public_token) values ('''
  || (select v from ids where k='wsR') || ''', ''qr'', ''peage-detach-3'')',
  false);

select pg_temp.geste('Restreint : ON NE SE DÉTACHE PLUS EN MODIFIANT',
  'c9920003-0000-4000-8000-000000000092',
  'update public.smart_tags set organization_id = null, rack_label = ''detache''
     where id = ''c992eeee-0000-4000-8000-000000000001''',
  false);

insert into res select 'Et la ligne n''a pas bougé d''un caractère', 'avant',
  (select rack_label from public.smart_tags where id = 'c992eeee-0000-4000-8000-000000000001');

-- La table qui n'a AUCUNE seconde adresse (etiquette_modeles) reçoit
-- un garde explicite : sa politique exige que l'organisation soit
-- renseignée. C'est le § 6 de la migration qui le pose tout seul.
insert into res select 'La table sans seconde adresse exige que la première soit remplie', 'true',
  (select (coalesce(with_check,'') like '%IS NOT NULL%')::text
     from pg_policies
    where schemaname='public' and tablename='etiquette_modeles' and policyname='Péage — création');


-- ============================================================
-- § 13. L'ESSAI SE CONSOMME UNE FOIS, PAR DIRIGEANT
-- ============================================================
--
-- Rien ne limitait le nombre d'entreprises qu'un compte peut fonder, et
-- saas_start_subscription ne regardait nulle part si un essai avait
-- déjà été consommé. Un dirigeant dont la première entreprise est
-- fermée en créait une seconde et repartait pour un mois gratuit avec
-- la même carte, autant de fois qu'il voulait. Un mois gratuit
-- renouvelable indéfiniment n'est pas un essai : c'est la gratuité
-- avec une formalité.

-- Le dirigeant d'orgEs a déjà son essai en cours. Il fonde une seconde
-- entreprise — ce qui reste permis, et doit le rester.
select set_config('request.jwt.claims',
  json_build_object('sub','c9920009-0000-4000-8000-000000000092')::text, true);
insert into ids select 'orgEs2', public.create_professional_organization('Péage Essai Bis','landscaper');
select set_config('request.jwt.claims', '', true);

insert into res select 'Fonder une seconde entreprise reste permis', 'true',
  (select (v is not null)::text from ids where k = 'orgEs2');

do $E$
declare ok boolean := true;
begin
  begin
    insert into public.organization_subscriptions
      (organization_id, plan, provider, status, billing_cycle, trial_ends_at)
    values ((select v from ids where k='orgEs2'), 'solo', 'web', 'trialing', 'monthly',
            now() + interval '30 days');
  exception when others then ok := false;
  end;
  insert into res values ('… MAIS PAS UN SECOND MOIS GRATUIT', 'false', ok::text);
end $E$;

do $E$
declare ok boolean := true;
begin
  begin
    insert into public.organization_subscriptions
      (organization_id, plan, provider, status, billing_cycle,
       current_period_start_on, current_period_end_on)
    values ((select v from ids where k='orgEs2'), 'solo', 'web', 'active', 'monthly',
            current_date, current_date + 30);
  exception when others then ok := false;
  end;
  insert into res values ('… et l''abonnement PAYANT, lui, passe (on ne ferme pas la vente)', 'true', ok::text);
end $E$;

-- UN ESSAI SANS DATE DE FIN NE FINIT JAMAIS. admin_create_subscription
-- accepte p_trial_days à NULL — sa valeur par défaut — et la tâche de
-- nuit filtre justement sur trial_ends_at : elle ne le verra jamais.
-- Un administrateur qui accorde « un essai le temps de voir » créait en
-- réalité un accès gratuit perpétuel, que rien ne signalait.
do $E$
declare ok boolean := true;
begin
  begin
    insert into public.organization_subscriptions
      (organization_id, plan, provider, status, billing_cycle, trial_ends_at)
    values ((select v from ids where k='orgT'), 'solo', 'manual', 'trialing', 'monthly', null);
  exception when others then ok := false;
  end;
  insert into res values ('Un essai SANS date de fin est refusé (il ne finirait jamais)', 'false', ok::text);
end $E$;


-- ============================================================
-- § 14. LA SANTÉ DU PÉAGE — UN VERROU MUET EST PIRE QU'AUCUN
-- ============================================================
--
-- Depuis que la règle est « on ne ferme que sur une créance
-- réclamée », le péage DÉPEND DE LA FACTURATION. Identité d'émetteur
-- vide, tâche de nuit éteinte : plus rien n'est facturé, donc plus rien
-- ne se ferme — et l'on croit le péage en marche. peage_sante() est ce
-- qui rompt ce silence. Elle doit rendre zéro ligne le jour de la mise
-- en service.

insert into res select 'La santé du péage se lit par une requête', 'true',
  (select (count(*) >= 0)::text from public.peage_sante());

insert into res select 'Elle signale l''identité d''émetteur tant qu''elle est vide', 'true',
  (select exists (select 1 from public.peage_sante()
                   where sujet = 'Identité de l''émetteur')::text);

insert into res select 'Elle signale les tâches de nuit éteintes', '2',
  (select count(*)::text from public.peage_sante() where sujet = 'Tâche de nuit');

-- Un abonné à qui l'on ne peut adresser aucune facture ne pourra JAMAIS
-- être fermé : c'est la contrepartie exacte de la règle, et elle doit
-- se voir. Mesuré sur la vraie base : « Le client OASIS RARE n'a pas de
-- SIRET » — cette entreprise-là avait le logiciel gratuitement, et rien
-- ne le disait.
insert into res select 'Elle signale un abonné qu''on ne peut pas facturer', 'true',
  (select exists (select 1 from public.peage_sante()
                   where sujet = 'Abonné non facturable')::text);

insert into res select 'Chaque ligne de santé dit QUOI FAIRE', '0',
  (select count(*)::text from public.peage_sante() where coalesce(btrim(a_faire), '') = '');


select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
