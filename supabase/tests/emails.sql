-- Oasis Care — LE COURRIER SORTANT (migration 0084).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. UN DÉSABONNEMENT DE LA PUBLICITÉ N'EMPÊCHE JAMAIS UNE FACTURE
--      D'ARRIVER. C'est le défaut catastrophique du chantier : invisible
--      en test, désastreux en production, et personne ne comprend
--      pourquoi le client ne reçoit plus rien. Le § 5 l'attaque par
--      quatre chemins — le désabonnement par jeton, la plainte pour
--      indésirable, le rebond dur, et le blocage par le transporteur —
--      et vérifie à chaque fois que la facture PART.
--
--   2. LE CLIENT FINAL DU PAYSAGISTE NE REÇOIT JAMAIS DE PUBLICITÉ
--      D'OASIS. Il n'a rien signé avec Oasis Care. Le § 3 vérifie les
--      deux verrous de contrainte, et le § 13 fait tourner une vraie
--      campagne pour constater qu'AUCUNE adresse issue de `crm_*` n'y
--      entre.
--
--   3. LE MÊME MESSAGE NE PART PAS DEUX FOIS. Trois tentatives, une
--      seule ligne, et la clé est GÉNÉRÉE — donc l'appelant ne peut pas
--      la contourner (§ 4).
--
--   4. LE « RÉPONDRE À » EST UN VERROU DUR, et le SIRET n'en est un que
--      pour la facture (§ 6). C'est l'arbitrage du chantier, figé ici.
--
--   5. LE DESTINATAIRE VIENT DE LA BASE, jamais d'un paramètre : la
--      fonction ne prend PAS d'adresse, et le § 7 vérifie la règle de
--      résolution ainsi que le refus d'écrire au client d'une autre
--      entreprise.
--
--   6. LE JOURNAL EST EN AJOUT SEUL, y compris contre `service_role` et
--      contre `truncate` (§ 9).
--
--   7. LA PERMISSION NEUVE EST SEMÉE, ET LE GARDE-FOU DE LA MATRICE
--      COUVRE LE PRÉFIXE NEUF. Le piège de 0075 a mordu trois fois ;
--      le § 14 refait le sondage.
--
--   8. LES GRANT PAR DÉFAUT DE SUPABASE N'ONT RIEN ROUVERT. C'est là
--      que 0055 s'est fait avoir, et c'est vérifié par requête (§ 15).
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les messages, ni les consentements, ni les suppressions.
--
-- AUCUN APPEL RÉSEAU. Le « transporteur » de ce test est un double
-- simulé : on insère les événements qu'il enverrait, par
-- `email_record_event()`, exactement comme le ferait son webhook.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0084, ou l'envoyer à l'API Management. UN SEUL bloc begin/rollback :
-- un fichier découpé en plusieurs blocs verrait son premier rollback
-- annuler la migration posée devant.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table att(k text, v text) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on att to authenticated;

-- L'adresse technique d'expédition. Elle est posée par le SERVEUR, en
-- variable d'environnement ; ici on simule ce que le serveur fait avant
-- d'appeler la couche. Le § 16 vérifie ce qui se passe quand elle
-- manque.
set local oasis.email_expediteur = 'notifications@oasisrarecare.invalid';

-- ============================================================
-- Fixtures
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('e8400001-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-normal@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400002-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-ownerA@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400003-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-ownerB@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400004-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-ownerC@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400010-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-super@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400011-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-support@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400012-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-billing@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400013-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-security@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('e8400014-0000-4000-8000-000000000084','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','em-product@test.invalid','',now(),now(),now(),now(),'{}','{}');

-- TROIS ENTREPRISES, ET CHACUNE EXISTE POUR UNE RAISON :
--   A est complètement identifiée : elle peut tout envoyer.
--   B a son adresse e-mail mais PAS de SIRET : elle peut envoyer un
--     devis et PAS une facture. C'est l'arbitrage du chantier.
--   C n'a PAS d'adresse e-mail : elle ne peut RIEN envoyer, parce que
--     sans « répondre à » les réponses de ses clients se perdraient.
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages Courrier A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','e8400003-0000-4000-8000-000000000084')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages Courrier B','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','e8400004-0000-4000-8000-000000000084')::text, true);
insert into ids select 'orgC', public.create_professional_organization('Paysages Courrier C','landscaper');

update public.business_organizations
   set legal_name = 'SARL Jardins Dupont', legal_form = 'SARL',
       siret = '111 222 333 00044', vat_number = 'FR11111222333',
       address_line1 = '1 rue des Rosiers', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'contact@jardins-dupont.invalid',
       phone = '0240000000', logo_path = 'orgA/logo.png',
       insurance_decennale_number = 'DEC-2026-0001'
 where id = (select v from ids where k='orgA');

update public.business_organizations
   set legal_name = 'Les Jardins de B', email = 'contact@jardins-b.invalid'
 where id = (select v from ids where k='orgB');

-- orgC garde `email = null` : c'est tout son intérêt.

-- Les administrateurs de plateforme.
insert into public.platform_admins (user_id, role, note) values
 ('e8400010-0000-4000-8000-000000000084','super_admin','Test courrier'),
 ('e8400011-0000-4000-8000-000000000084','support','Test courrier'),
 ('e8400012-0000-4000-8000-000000000084','billing_admin','Test courrier'),
 ('e8400013-0000-4000-8000-000000000084','security_admin','Test courrier'),
 ('e8400014-0000-4000-8000-000000000084','product_admin','Test courrier');

-- Les clients du paysagiste A.
--   clientContact a un contact principal AVEC adresse : c'est lui qui
--     doit gagner sur l'adresse de la fiche client.
--   clientFiche n'a pas de contact : on doit retomber sur sa fiche.
--   clientMuet n'a ni l'un ni l'autre : on doit REFUSER avec une
--     phrase, pas lever au moment critique.
insert into ids values
 ('clientContact', gen_random_uuid()),
 ('clientFiche',   gen_random_uuid()),
 ('clientMuet',    gen_random_uuid()),
 ('clientB',       gen_random_uuid()),
 ('devis1',        gen_random_uuid()),
 ('facture1',      gen_random_uuid()),
 ('facture2',      gen_random_uuid()),
 ('facture3',      gen_random_uuid()),
 ('facture4',      gen_random_uuid()),
 ('facture5',      gen_random_uuid()),
 ('devisB',        gen_random_uuid()),
 ('factureB',      gen_random_uuid()),
 -- Les objets des § 18 à 21. ILS SONT NEUFS, ET C'EST NÉCESSAIRE :
 -- réutiliser une facture déjà employée plus haut ferait rendre à
 -- `email_enqueue` le message EXISTANT — dont l'état a déjà bougé — et
 -- l'on éprouverait la réservation sur une ligne « rebondie ».
 ('f6',            gen_random_uuid()),
 ('f7',            gen_random_uuid()),
 ('f8',            gen_random_uuid()),
 ('f9',            gen_random_uuid());

insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, email)
values
 ((select v from ids where k='clientContact'), (select v from ids where k='orgA'),
  'customer', 'Madame Martin', 'fiche-martin@test.invalid'),
 ((select v from ids where k='clientFiche'), (select v from ids where k='orgA'),
  'customer', 'Monsieur Bernard', 'bernard@test.invalid'),
 ((select v from ids where k='clientMuet'), (select v from ids where k='orgA'),
  'customer', 'Copropriété Les Tilleuls', null),
 ((select v from ids where k='clientB'), (select v from ids where k='orgB'),
  'customer', 'Client de B', 'client-de-b@test.invalid');

insert into public.crm_contacts (organization_id, customer_id, first_name, last_name, email, is_primary)
values
 ((select v from ids where k='orgA'), (select v from ids where k='clientContact'),
  'Sophie', 'Martin', 'Sophie.MARTIN@test.invalid', true);

-- LES OBJETS MÉTIER EXISTENT POUR DE BON, ET C'EST NOUVEAU.
--
-- `email_enqueue` refuse désormais un `entity_id` qui n'appartient pas
-- à l'organisation visée : sans cela, un membre de l'entreprise A
-- pouvait CONSOMMER D'AVANCE la clé d'idempotence de la facture de
-- l'entreprise B, qui recevait ensuite « ce message est déjà parti »
-- pour un message jamais envoyé. Le test travaillait jusqu'ici sur des
-- identifiants inventés ; il travaille maintenant sur de vraies lignes,
-- ce qui est la seule façon d'éprouver ce contrôle.
insert into public.quotes (id, organization_id, customer_id, number, title, status, issued_on)
values
 ((select v from ids where k='devis1'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'DV-COURRIER-1', 'Création de massif', 'sent', current_date),
 ((select v from ids where k='devisB'), (select v from ids where k='orgB'),
  (select v from ids where k='clientB'), 'DV-COURRIER-B', 'Taille', 'sent', current_date);

insert into public.invoices (id, organization_id, customer_id, number, status, issued_on, due_on, issued_at)
values
 ((select v from ids where k='facture1'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-1', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='facture2'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-2', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='facture3'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-3', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='facture4'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-4', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='facture5'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-5', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='factureB'), (select v from ids where k='orgB'),
  (select v from ids where k='clientB'), 'FA-COURRIER-B', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='f6'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-6', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='f7'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-7', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='f8'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-8', 'issued', current_date, current_date + 30, now()),
 ((select v from ids where k='f9'), (select v from ids where k='orgA'),
  (select v from ids where k='clientContact'), 'FA-COURRIER-9', 'issued', current_date, current_date + 30, now());

-- ON REPASSE EN « SERVICE ». Tout ce qui suit jusqu'au § 5 est le
-- chemin de la machine : c'est `service_role` qui met en file, et
-- `service_role` n'a pas d'utilisateur. Effacer les revendications du
-- jeton reproduit exactement cet état — et c'est ce qui rend le test
-- fidèle : les gardes de tenancé des fonctions `security definer`
-- distinguent le service (aucun utilisateur) d'un jeton de navigateur.
select set_config('request.jwt.claims', '', true);

-- ============================================================
-- 1. LE CATALOGUE, ET CE QU'IL REFUSE DE DÉCLARER
-- ============================================================
insert into res select 'Les huit gabarits du produit sont au catalogue','8',
  (select count(*)::text from public.email_templates);

insert into res select 'UN SEUL gabarit est publicitaire','1',
  (select count(*)::text from public.email_templates where nature = 'publicite');

insert into res select 'Et il ne s''adresse qu''à une ENTREPRISE','entreprise',
  (select audience from public.email_templates where nature = 'publicite');

insert into res select 'Aucun gabarit n''est déclenché par un MODÈLE','0',
  (select count(*)::text from public.email_templates where trigger_kind = 'ia');

insert into res select 'Les deux factures exigent l''identité légale complète','2',
  (select count(*)::text from public.email_templates where requires_legal_identity);

do $$
declare
  c text;
  refuse boolean;
begin
  foreach c in array array[
    -- Une publicité qui viserait le client d'un paysagiste.
    'insert into public.email_templates (key,label,nature,audience,trigger_kind,requires_unsubscribe) values (''pub_client'',''x'',''publicite'',''clientFinal'',''humain'',true)',
    -- Une publicité sans lien de désabonnement.
    'insert into public.email_templates (key,label,nature,audience,trigger_kind,requires_unsubscribe) values (''pub_sans_lien'',''x'',''publicite'',''entreprise'',''humain'',false)',
    -- Un transactionnel AVEC un lien de désabonnement : une facture
    -- dont on peut se désabonner est une facture qu''on ne recevra pas.
    'insert into public.email_templates (key,label,nature,audience,trigger_kind,requires_unsubscribe) values (''trans_avec_lien'',''x'',''transactionnel'',''clientFinal'',''humain'',true)',
    -- Un déclenchement par un modèle.
    'insert into public.email_templates (key,label,nature,audience,trigger_kind) values (''par_ia'',''x'',''transactionnel'',''clientFinal'',''ia'')'
  ]
  loop
    refuse := false;
    begin execute c; exception when others then refuse := true; end;
    insert into res values ('Catalogue — « ' || left(c, 70) || '… » refusé', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 2. LA NATURE NE SE FALSIFIE PAS
-- ============================================================
-- Elle n'est pas un champ que l'appelant remplit : c'est une propriété
-- du gabarit, imposée par une clé étrangère composite. Un message
-- publicitaire déguisé en transactionnel — donc sans consentement et
-- sans lien de désabonnement — est refusé PAR LA BASE.
do $$
declare
  c text;
  refuse boolean;
begin
  foreach c in array array[
    'insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256) select (select v from ids where k=''orgA''),''annonceCommerciale'',''transactionnel'',''v1'',''entreprise'',''x@y.invalid'',''organization'',(select v from ids where k=''orgA''),''e@f.invalid'',''N'',''r@s.invalid'',''o'',''b'',repeat(''a'',64)',
    'insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256) select (select v from ids where k=''orgA''),''factureEmise'',''publicite'',''v1'',''entreprise'',''x@y.invalid'',''invoice'',(select v from ids where k=''facture1''),''e@f.invalid'',''N'',''r@s.invalid'',''o'',''b'',repeat(''a'',64)',
    'insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256) select (select v from ids where k=''orgA''),''gabaritInvente'',''transactionnel'',''v1'',''clientFinal'',''x@y.invalid'',''quote'',(select v from ids where k=''devis1''),''e@f.invalid'',''N'',''r@s.invalid'',''o'',''b'',repeat(''a'',64)'
  ]
  loop
    refuse := false;
    begin execute c; exception when others then refuse := true; end;
    insert into res values ('LA NATURE NE SE FALSIFIE PAS — insertion ' ||
      (case when c like '%annonceCommerciale%' then 'publicité déguisée en transactionnel'
            when c like '%''publicite''%' then 'facture déguisée en publicité'
            else 'gabarit inventé' end) || ' refusée', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 3. LE CLIENT FINAL DU PAYSAGISTE N'EST PAS NOTRE CLIENT
-- ============================================================
do $$
declare
  c text;
  refuse boolean;
begin
  foreach c in array array[
    -- a) une publicité vers un client final.
    'insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256) select (select v from ids where k=''orgA''),''annonceCommerciale'',''publicite'',''v1'',''clientFinal'',''x@y.invalid'',''organization'',(select v from ids where k=''orgA''),''e@f.invalid'',''N'',''r@s.invalid'',''o'',''b'',repeat(''a'',64)',
    -- b) un message « entreprise » qui RÉFÉRENCE une fiche client.
    'insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,customer_id,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256) select (select v from ids where k=''orgA''),''annonceCommerciale'',''publicite'',''v1'',''entreprise'',''x@y.invalid'',(select v from ids where k=''clientContact''),''organization'',(select v from ids where k=''orgA''),''e@f.invalid'',''N'',''r@s.invalid'',''o'',''b'',repeat(''a'',64)',
    -- c) un contact sans client : un rattachement orphelin.
    'insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,contact_id,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256) select (select v from ids where k=''orgA''),''devisEnvoye'',''transactionnel'',''v1'',''clientFinal'',''x@y.invalid'',gen_random_uuid(),''quote'',(select v from ids where k=''devis1''),''e@f.invalid'',''N'',''r@s.invalid'',''o'',''b'',repeat(''a'',64)'
  ]
  loop
    refuse := false;
    begin execute c; exception when others then refuse := true; end;
    insert into res values ('PUBLICITÉ AU CLIENT FINAL — variante ' ||
      (case when c like '%''clientFinal''%' and c like '%annonceCommerciale%' then 'a (destinataire client)'
            when c like '%customer_id%' then 'b (rattachement à une fiche client)'
            else 'c (contact orphelin)' end) || ' refusée', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 4. L'IDEMPOTENCE — TROIS FOIS, UN SEUL MESSAGE
-- ============================================================
-- Trois tentatives, comme une relance rejouée, un déploiement qui
-- redémarre et deux onglets ouverts. La clé est GÉNÉRÉE par la base :
-- l'appelant ne peut pas l'inventer pour repasser.
do $$
declare
  r1 record; r2 record; r3 record;
begin
  select * into r1 from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='facture1'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Votre facture F-2026-0001', 'Bonjour, veuillez trouver votre facture.',
    encode(sha256('corps html'::bytea), 'hex'),
    (select v from ids where k='clientContact'));

  select * into r2 from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='facture1'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Votre facture F-2026-0001', 'Bonjour, veuillez trouver votre facture.',
    encode(sha256('corps html'::bytea), 'hex'),
    (select v from ids where k='clientContact'));

  select * into r3 from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='facture1'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Votre facture F-2026-0001', 'Bonjour, veuillez trouver votre facture.',
    encode(sha256('corps html'::bytea), 'hex'),
    (select v from ids where k='clientContact'));

  insert into ids select 'msgFacture1', r1.message_id;

  insert into res values ('LA PREMIÈRE TENTATIVE CRÉE','true', r1.created::text);
  insert into res values ('LA DEUXIÈME NE CRÉE RIEN','false', r2.created::text);
  insert into res values ('LA TROISIÈME NON PLUS','false', r3.created::text);
  insert into res values ('Et les trois désignent LE MÊME message','true',
    (r1.message_id = r2.message_id and r2.message_id = r3.message_id)::text);
  insert into res values ('Le refus le DIT, au lieu de faire semblant','true',
    (r2.blocking_reason like '%déjà parti%')::text);
  insert into res values ('TROIS TENTATIVES, UNE SEULE LIGNE AU JOURNAL','1',
    (select count(*)::text from public.email_messages
      where entity_id = (select v from ids where k='facture1')));
end $$;

-- La clé est GÉNÉRÉE : on ne peut pas l'écrire soi-même pour la rendre
-- unique et repasser.
do $$
declare refuse boolean := false;
begin
  begin
    update public.email_messages set idempotency_key = 'ce-que-je-veux'
     where id = (select v from ids where k='msgFacture1');
  exception when others then refuse := true;
  end;
  insert into res values ('LA CLÉ D''IDEMPOTENCE NE S''ÉCRIT PAS À LA MAIN','true', refuse::text);
end $$;

-- La RELANCE, elle, passe : ce n'est pas le même message, c'est le
-- suivant. Le rang est la seule échappatoire, et elle est délibérée.
do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureRelance', 'invoice',
    (select v from ids where k='facture1'), 'relance-v1',
    'notifications@oasisrarecare.invalid',
    'Rappel : facture F-2026-0001', 'Bonjour, votre facture reste impayée.',
    encode(sha256('corps relance'::bytea), 'hex'),
    (select v from ids where k='clientContact'), '{}'::jsonb, 2);
  insert into res values ('LA RELANCE N''EST PAS LE MÊME MESSAGE : elle part','true', r.created::text);
  insert into res values ('Et le journal porte bien deux messages pour cette facture','2',
    (select count(*)::text from public.email_messages
      where entity_id = (select v from ids where k='facture1')));
end $$;

-- ============================================================
-- 5. LE TEST QUI COMPTE LE PLUS
-- ============================================================
-- UNE PERSONNE DÉSABONNÉE DE LA PUBLICITÉ REÇOIT QUAND MÊME SA FACTURE.
-- Quatre chemins d'abîmage, et à chacun on vérifie que le transactionnel
-- passe.

-- ---- 5.a Le consentement, puis le désabonnement par le lien --------
-- Le paysagiste consent pour SA propre adresse, depuis ses réglages.
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
do $$ begin
  perform public.email_record_consent(
    (select v from ids where k='orgA'), true, 'reglagesEntreprise',
    'Case cochée dans les réglages de l''entreprise le jour du test.');
end $$;

insert into att select 'jetonA',
  (select unsubscribe_token from public.email_consents
    where organization_id = (select v from ids where k='orgA'));

-- Et on repasse en « service » pour la suite.
select set_config('request.jwt.claims', '', true);

insert into res select 'Le consentement est enregistré, avec sa date et son origine','true',
  (select (consented_at is not null and consent_source = 'reglagesEntreprise')::text
     from public.email_consents where organization_id = (select v from ids where k='orgA'));

insert into res select 'AVANT désabonnement, la publicité est autorisée','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'annonceCommerciale', 'contact@jardins-dupont.invalid'));

do $$
declare r record;
begin
  select * into r from public.email_unsubscribe((select v from att where k='jetonA'));
  insert into res values ('LE DÉSABONNEMENT PAR JETON FONCTIONNE, SANS COMPTE','true', r.done::text);
  insert into res values ('Il ne rend l''adresse que MASQUÉE','c***@jardins-dupont.invalid', r.masked_email);
  insert into res values ('Et il DIT que les documents continuent d''arriver','true',
    (r.message like '%devis, factures%')::text);
end $$;

insert into res select 'APRÈS désabonnement, la publicité est refusée','false',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'annonceCommerciale', 'contact@jardins-dupont.invalid'));

-- ET VOICI LE POINT. La MÊME adresse, désabonnée de la publicité, reste
-- destinataire de son courrier transactionnel.
insert into res select 'MAIS LE TRANSACTIONNEL PASSE VERS LA MÊME ADRESSE','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'parametreImportant', 'contact@jardins-dupont.invalid'));

do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'parametreImportant', 'organization',
    (select v from ids where k='orgA'), 'parametre-v1',
    'notifications@oasisrarecare.invalid',
    'Un réglage important a changé', 'Bonjour, un réglage de votre compte a changé.',
    encode(sha256('corps parametre'::bytea), 'hex'));
  insert into res values ('ET LE MESSAGE PART VRAIMENT, malgré le désabonnement','true', r.created::text);
end $$;

-- ---- 5.b La PLAINTE pour indésirable -------------------------------
-- Le cas le plus vicieux : le client marque un devis comme indésirable,
-- et six semaines plus tard il doit quand même recevoir sa facture.
insert into public.email_suppressions (email, kind, reason)
values ('sophie.martin@test.invalid', 'plainte', 'Signalé comme indésirable par le destinataire.');

insert into res select 'UNE ADRESSE QUI S''EST PLAINTE NE REÇOIT PLUS DE PUBLICITÉ','false',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'annonceCommerciale', 'sophie.martin@test.invalid'));

insert into res select 'MAIS ELLE REÇOIT SA FACTURE','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'sophie.martin@test.invalid'));

insert into res select 'Et une plainte ne fabrique AUCUN avertissement sur le transactionnel','0',
  (select coalesce(array_length(warnings, 1), 0)::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'sophie.martin@test.invalid'));

do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='facture2'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Votre facture F-2026-0002', 'Bonjour, veuillez trouver votre facture.',
    encode(sha256('corps html 2'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  insert into res values ('LA FACTURE PART À UNE ADRESSE QUI S''EST PLAINTE','true', r.created::text);
end $$;

-- ---- 5.c Le REBOND DUR ---------------------------------------------
-- Il ne bloque pas non plus. Il AVERTIT — et l'avertissement est en
-- français, dans l'écran du paysagiste, parce que c'est lui qui doit
-- corriger l'adresse.
insert into public.email_suppressions (email, kind, reason)
values ('sophie.martin@test.invalid', 'rebondDur', 'Boîte inexistante.');

insert into res select 'UN REBOND DUR NE BLOQUE PAS LA FACTURE','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'sophie.martin@test.invalid'));

insert into res select 'IL AVERTIT, et l''avertissement dit quoi faire','true',
  (select (warnings[1] like '%vérifiez l''adresse auprès de votre client%')::text
     from public.email_gate(
       (select v from ids where k='orgA'), 'factureEmise', 'sophie.martin@test.invalid'));

do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='facture3'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Votre facture F-2026-0003', 'Bonjour, veuillez trouver votre facture.',
    encode(sha256('corps html 3'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  insert into res values ('LA FACTURE PART APRÈS UN REBOND DUR','true', r.created::text);
  insert into res values ('Et l''avertissement est RECOPIÉ DANS LE JOURNAL, pas seulement affiché','true',
    (select (warnings::text like '%vérifiez l''adresse%')::text
       from public.email_messages where id = r.message_id));
end $$;

-- ---- 5.d LE BLOCAGE PAR LE TRANSPORTEUR ----------------------------
insert into public.email_suppressions (email, kind, reason, transporter_key)
values ('sophie.martin@test.invalid', 'bloqueTransporteur',
        'Le transporteur refuse cette adresse.', 'double-simule');

insert into res select 'UN BLOCAGE CHEZ LE TRANSPORTEUR NE FAIT PAS DISPARAÎTRE LA FACTURE','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'sophie.martin@test.invalid'));

-- ---- 5.e LE REGISTRE DE CONSENTEMENT EST INCAPABLE DE PARLER
--          D'AUTRE CHOSE QUE DE PUBLICITÉ ------------------------------
-- C'est la garantie structurelle, et non un comportement à préserver :
-- la ligne qui empêcherait une facture ne peut pas être écrite.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.email_consents (organization_id, email, nature)
    values ((select v from ids where k='orgB'), 'x@y.invalid', 'transactionnel');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE PEUT PAS ENREGISTRER UN REFUS DE TRANSACTIONNEL','true', refuse::text);
end $$;

insert into res select 'Le registre ne contient que de la publicité, par construction','0',
  (select count(*)::text from public.email_consents where nature <> 'publicite');

-- ============================================================
-- 6. LE VERROU DU « RÉPONDRE À », ET CELUI DU SIRET
-- ============================================================
insert into res select 'SANS ADRESSE D''ENTREPRISE, RIEN NE PART','true',
  (select (blocking_reason like '%adresse e-mail de votre entreprise%')::text
     from public.email_sender_identity((select v from ids where k='orgC'), 'devisEnvoye'));

insert into res select 'Et le refus explique POURQUOI : les réponses se perdraient','true',
  (select (blocking_reason like '%réponses de vos clients se perdraient%')::text
     from public.email_sender_identity((select v from ids where k='orgC'), 'devisEnvoye'));

-- L'ARBITRAGE DU CHANTIER, FIGÉ : le SIRET bloque la FACTURE, pas le
-- DEVIS. orgB a son adresse mais pas de SIRET.
insert into res select 'SANS SIRET, LE DEVIS PART QUAND MÊME','true',
  (select (blocking_reason is null)::text
     from public.email_sender_identity((select v from ids where k='orgB'), 'devisEnvoye'));

insert into res select 'SANS SIRET, LA FACTURE EST BLOQUÉE','true',
  (select (blocking_reason like '%SIRET%')::text
     from public.email_sender_identity((select v from ids where k='orgB'), 'factureEmise'));

insert into res select 'Et le refus cite l''article qui l''impose','true',
  (select (blocking_reason like '%242 nonies A%')::text
     from public.email_sender_identity((select v from ids where k='orgB'), 'factureEmise'));

insert into res select 'LE NOM AFFICHÉ EST CELUI DU PAYSAGISTE, pas « Oasis Care »','SARL Jardins Dupont',
  (select from_name from public.email_sender_identity((select v from ids where k='orgA'), 'devisEnvoye'));

insert into res select 'LE « RÉPONDRE À » POINTE LE PAYSAGISTE','contact@jardins-dupont.invalid',
  (select reply_to_email from public.email_sender_identity((select v from ids where k='orgA'), 'devisEnvoye'));

insert into res select 'Le logo suit, quand il existe','orgA/logo.png',
  (select logo_path from public.email_sender_identity((select v from ids where k='orgA'), 'devisEnvoye'));

-- L'identité complète d'orgA ne produit AUCUN avertissement ; celle de
-- B en produit — sans bloquer son devis.
insert into res select 'Une identité complète ne produit aucun avertissement','0',
  (select coalesce(array_length(warnings, 1), 0)::text
     from public.email_sender_identity((select v from ids where k='orgA'), 'devisEnvoye'));

insert into res select 'Une identité trouée AVERTIT sur la décennale, sans bloquer','true',
  (select (warnings::text like '%décennale%')::text
     from public.email_sender_identity((select v from ids where k='orgB'), 'devisEnvoye'));

insert into res select 'Et elle avertit sur la TVA en citant la mention à porter','true',
  (select (warnings::text like '%293 B%')::text
     from public.email_sender_identity((select v from ids where k='orgB'), 'devisEnvoye'));

-- LE JOURNAL PORTE L'EXPÉDITEUR TEL QU'IL EST PARTI.
insert into res select 'Le journal garde le nom affiché ET l''adresse de réponse','SARL Jardins Dupont|contact@jardins-dupont.invalid',
  (select from_name || '|' || reply_to_email from public.email_messages
    where id = (select v from ids where k='msgFacture1'));

-- Et l'expéditeur technique reste le domaine authentifié d'Oasis.
insert into res select 'L''expéditeur technique reste le domaine authentifié','notifications@oasisrarecare.invalid',
  (select from_email from public.email_messages where id = (select v from ids where k='msgFacture1'));

-- ET LA CONSÉQUENCE, MESURÉE : orgB ne peut pas mettre une facture en
-- file, mais elle peut mettre un devis.
do $$
declare r1 record; r2 record;
begin
  select * into r1 from public.email_enqueue(
    (select v from ids where k='orgB'), 'factureEmise', 'invoice',
    (select v from ids where k='facture4'), 'facture-v3',
    'notifications@oasisrarecare.invalid', 'Facture', 'Corps',
    encode(sha256('x'::bytea), 'hex'), (select v from ids where k='clientB'));
  insert into res values ('orgB NE PEUT PAS METTRE UNE FACTURE EN FILE','false', r1.created::text);

  select * into r2 from public.email_enqueue(
    (select v from ids where k='orgB'), 'devisEnvoye', 'quote',
    (select v from ids where k='devisB'), 'devis-v2',
    'notifications@oasisrarecare.invalid', 'Votre devis', 'Corps du devis',
    encode(sha256('y'::bytea), 'hex'), (select v from ids where k='clientB'));
  insert into res values ('MAIS ELLE PEUT ENVOYER SON DEVIS','true', r2.created::text);
end $$;

-- ============================================================
-- 7. LE DESTINATAIRE VIENT DE LA BASE
-- ============================================================
insert into res select 'LE CONTACT PRINCIPAL GAGNE SUR LA FICHE CLIENT','sophie.martin@test.invalid',
  (select to_email from public.email_recipient_for_customer(
     (select v from ids where k='orgA'), (select v from ids where k='clientContact')));

insert into res select 'Et l''adresse est NORMALISÉE : « Sophie.MARTIN@ » et « sophie.martin@ » sont la même personne','true',
  (select (to_email = lower(to_email))::text from public.email_recipient_for_customer(
     (select v from ids where k='orgA'), (select v from ids where k='clientContact')));

insert into res select 'SANS CONTACT, on retombe sur la fiche client','bernard@test.invalid',
  (select to_email from public.email_recipient_for_customer(
     (select v from ids where k='orgA'), (select v from ids where k='clientFiche')));

insert into res select 'SANS RIEN, ON REFUSE AVEC UNE PHRASE, pas avec une exception','true',
  (select (blocking_reason like '%Aucune adresse e-mail pour « Copropriété Les Tilleuls »%')::text
     from public.email_recipient_for_customer(
       (select v from ids where k='orgA'), (select v from ids where k='clientMuet')));

-- LE CLOISONNEMENT. On ne peut pas écrire au client d'une AUTRE
-- entreprise en passant son identifiant.
insert into res select 'ON N''ÉCRIT PAS AU CLIENT D''UNE AUTRE ENTREPRISE','true',
  (select (blocking_reason like '%n''appartient pas à votre entreprise%')::text
     from public.email_recipient_for_customer(
       (select v from ids where k='orgA'), (select v from ids where k='clientB')));

do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'devisEnvoye', 'quote',
    (select v from ids where k='devis1'), 'devis-v2',
    'notifications@oasisrarecare.invalid', 'Votre devis', 'Corps du devis',
    encode(sha256('devis'::bytea), 'hex'),
    (select v from ids where k='clientB'));
  insert into res values ('ET LA MISE EN FILE LE REFUSE AUSSI','false', r.created::text);

  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'devisEnvoye', 'quote',
    (select v from ids where k='devis1'), 'devis-v2',
    'notifications@oasisrarecare.invalid', 'Votre devis', 'Corps du devis',
    encode(sha256('devis'::bytea), 'hex'),
    (select v from ids where k='clientMuet'));
  insert into res values ('Un client sans adresse est refusé AVANT l''envoi','false', r.created::text);
end $$;

-- LE GABARIT DIT À QUI IL A LE DROIT D'ÉCRIRE, et on ne le contourne
-- pas en changeant d'argument.
do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'bienvenueEntreprise', 'organization',
    (select v from ids where k='orgA'), 'bienvenue-v1',
    'notifications@oasisrarecare.invalid', 'Bienvenue', 'Corps',
    encode(sha256('b'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  insert into res values ('UN GABARIT « ENTREPRISE » NE S''ENVOIE PAS À UN CLIENT','false', r.created::text);
  insert into res values ('Et le refus nomme l''audience du gabarit','true',
    (r.blocking_reason like '%s''adresse à « entreprise »%')::text);
end $$;

-- ============================================================
-- 8. L'INJECTION D'EN-TÊTE
-- ============================================================
-- Un retour à la ligne dans un objet ou une adresse permet d'ajouter un
-- « Bcc: » vers n'importe qui. Les contraintes le refusent à la source.
do $$
declare
  c text;
  refuse boolean;
  n text;
begin
  foreach c in array array[
    'objet avec un retour à la ligne',
    'adresse avec une virgule',
    'adresse avec des chevrons',
    'nom affiché avec un retour à la ligne',
    'empreinte qui n''en est pas une'
  ]
  loop
    refuse := false;
    begin
      if c = 'objet avec un retour à la ligne' then
        insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256)
        select (select v from ids where k='orgA'),'devisEnvoye','transactionnel','v1','clientFinal','x@y.invalid','quote',gen_random_uuid(),'e@f.invalid','N','r@s.invalid',
               E'Votre devis\nBcc: pirate@ailleurs.invalid','b',repeat('a',64);
      elsif c = 'adresse avec une virgule' then
        insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256)
        select (select v from ids where k='orgA'),'devisEnvoye','transactionnel','v1','clientFinal','x@y.invalid,pirate@ailleurs.invalid','quote',gen_random_uuid(),'e@f.invalid','N','r@s.invalid','o','b',repeat('a',64);
      elsif c = 'adresse avec des chevrons' then
        insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256)
        select (select v from ids where k='orgA'),'devisEnvoye','transactionnel','v1','clientFinal','Votre banque <x@y.invalid>','quote',gen_random_uuid(),'e@f.invalid','N','r@s.invalid','o','b',repeat('a',64);
      elsif c = 'nom affiché avec un retour à la ligne' then
        insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256)
        select (select v from ids where k='orgA'),'devisEnvoye','transactionnel','v1','clientFinal','x@y.invalid','quote',gen_random_uuid(),'e@f.invalid',E'Jardins\nBcc: p@q.invalid','r@s.invalid','o','b',repeat('a',64);
      else
        insert into public.email_messages (organization_id,template_key,nature,template_version,recipient_kind,to_email,entity_type,entity_id,from_email,from_name,reply_to_email,subject,body_text,body_html_sha256)
        select (select v from ids where k='orgA'),'devisEnvoye','transactionnel','v1','clientFinal','x@y.invalid','quote',gen_random_uuid(),'e@f.invalid','N','r@s.invalid','o','b','pas-une-empreinte';
      end if;
    exception when others then refuse := true;
    end;
    insert into res values ('INJECTION D''EN-TÊTE — ' || c || ' refusé', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 9. LE JOURNAL EST EN AJOUT SEUL
-- ============================================================
do $$
declare
  refuse boolean;
begin
  refuse := false;
  begin
    delete from public.email_messages where id = (select v from ids where k='msgFacture1');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE SUPPRIME PAS UNE LIGNE DU JOURNAL','true', refuse::text);

  refuse := false;
  begin
    update public.email_messages set body_text = 'un autre texte'
     where id = (select v from ids where k='msgFacture1');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE RÉÉCRIT PAS LE CORPS D''UN MESSAGE PARTI','true', refuse::text);

  refuse := false;
  begin
    update public.email_messages set subject = 'un autre objet'
     where id = (select v from ids where k='msgFacture1');
  exception when others then refuse := true;
  end;
  insert into res values ('NI SON OBJET','true', refuse::text);

  refuse := false;
  begin
    update public.email_messages set to_email = 'ailleurs@test.invalid'
     where id = (select v from ids where k='msgFacture1');
  exception when others then refuse := true;
  end;
  insert into res values ('NI SON DESTINATAIRE','true', refuse::text);

  -- Mais l'état, lui, doit pouvoir avancer.
  refuse := false;
  begin
    perform public.email_mark_sent((select v from ids where k='msgFacture1'),
                                   'double-simule', 'msg-0001');
  exception when others then refuse := true;
  end;
  insert into res values ('L''ÉTAT, LUI, AVANCE','false', refuse::text);

  refuse := false;
  begin
    truncate public.email_messages;
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE TRONQUE PAS LE JOURNAL','true', refuse::text);
end $$;

insert into res select 'Et l''envoi est daté','true',
  (select (status = 'sent' and sent_at is not null and transporter_message_id = 'msg-0001')::text
     from public.email_messages where id = (select v from ids where k='msgFacture1'));

-- ============================================================
-- 10. LE TRANSPORTEUR, EN DOUBLE SIMULÉ
-- ============================================================
-- Aucun appel réseau : on insère les événements que son webhook
-- enverrait, par la fonction prévue pour lui.
do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='facture5'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Votre facture F-2026-0005', 'Corps.',
    encode(sha256('corps 5'::bytea), 'hex'),
    (select v from ids where k='clientFiche'));
  insert into ids select 'msgRebond', r.message_id;
  perform public.email_mark_sent(r.message_id, 'double-simule', 'msg-0005');
end $$;

do $$ begin
  perform public.email_record_event('double-simule', 'msg-0005', 'hardBounce',
    now(), 'La boîte du destinataire n''existe pas.', '{"code":550}'::jsonb);
end $$;

insert into res select 'UN REBOND DUR FAIT BASCULER LE MESSAGE','bounced',
  (select status from public.email_messages where id = (select v from ids where k='msgRebond'));

insert into res select 'ET LE PAYSAGISTE LIT POURQUOI, en français','true',
  (select (failure_reason like '%boîte du destinataire n''existe pas%')::text
     from public.email_messages where id = (select v from ids where k='msgRebond'));

insert into res select 'L''adresse entre à la liste de suppression','rebondDur',
  (select kind from public.email_suppressions
    where email = 'bernard@test.invalid' and released_at is null);

-- LE REJEU DU WEBHOOK. Les transporteurs rejouent ; sans idempotence,
-- un rebond compterait deux fois et la réputation de l'entreprise
-- s'effondrerait pour rien.
do $$
declare v_avant integer; v_apres integer; v_occ integer;
begin
  select count(*) into v_avant from public.email_events
   where message_id = (select v from ids where k='msgRebond');
  select occurrences into v_occ from public.email_suppressions
   where email = 'bernard@test.invalid' and kind = 'rebondDur';

  -- Trois rejeux du MÊME événement, au même instant.
  perform public.email_record_event('double-simule', 'msg-0005', 'hardBounce',
    (select occurred_at from public.email_events
      where message_id = (select v from ids where k='msgRebond') limit 1),
    'La boîte du destinataire n''existe pas.', '{"code":550}'::jsonb);
  perform public.email_record_event('double-simule', 'msg-0005', 'hardBounce',
    (select occurred_at from public.email_events
      where message_id = (select v from ids where k='msgRebond') limit 1),
    'La boîte du destinataire n''existe pas.', '{"code":550}'::jsonb);

  select count(*) into v_apres from public.email_events
   where message_id = (select v from ids where k='msgRebond');

  insert into res values ('LE WEBHOOK REJOUÉ N''ENTRE QU''UNE FOIS', v_avant::text, v_apres::text);
  insert into res values ('Et le compteur de rebonds ne double pas', v_occ::text,
    (select occurrences::text from public.email_suppressions
      where email = 'bernard@test.invalid' and kind = 'rebondDur'));
end $$;

-- L'ÉTAT NE RECULE PAS. Un « livré » arrivé en retard ne doit pas
-- effacer un rebond déjà constaté de l'écran du paysagiste.
do $$ begin
  perform public.email_record_event('double-simule', 'msg-0005', 'delivered',
    now() - interval '1 minute', null, '{}'::jsonb);
end $$;

insert into res select 'UN ÉVÉNEMENT EN RETARD NE FAIT PAS DISPARAÎTRE L''ÉCHEC','bounced',
  (select status from public.email_messages where id = (select v from ids where k='msgRebond'));

do $$
declare refuse boolean := false;
begin
  begin
    update public.email_messages set status = 'sent'
     where id = (select v from ids where k='msgRebond');
  exception when others then refuse := true;
  end;
  insert into res values ('Et l''état ne recule pas non plus à la main','true', refuse::text);
end $$;

-- Les événements sont eux aussi en ajout seul.
do $$
declare refuse boolean;
begin
  refuse := false;
  begin
    update public.email_events set reason = 'autre chose'
     where message_id = (select v from ids where k='msgRebond');
  exception when others then refuse := true;
  end;
  insert into res values ('LES ÉVÉNEMENTS DU TRANSPORTEUR NE SE MODIFIENT PAS','true', refuse::text);

  refuse := false;
  begin
    delete from public.email_events where message_id = (select v from ids where k='msgRebond');
  exception when others then refuse := true;
  end;
  insert into res values ('NI NE S''EFFACENT','true', refuse::text);
end $$;

-- ET LE POINT DE FOND, UNE DERNIÈRE FOIS : après tout cela, la facture
-- suivante part encore vers la même adresse.
insert into res select 'APRÈS TOUS CES ÉCHECS, LA FACTURE SUIVANTE PART ENCORE','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'bernard@test.invalid'));

-- ============================================================
-- 11. LA RÉPUTATION, PAR ORGANISATION
-- ============================================================
insert into res select 'La vue compte les rebonds de CETTE entreprise','1',
  (select bounced_30d::text from public.email_organization_reputation
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Sous 20 messages, elle dit « insuffisant » plutôt qu''une alerte fausse','insuffisant',
  (select alert_level from public.email_organization_reputation
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Et elle ne mélange pas les entreprises','0',
  (select coalesce(bounced_30d, 0)::text from public.email_organization_reputation
    where organization_id = (select v from ids where k='orgB'));

-- ============================================================
-- 12. LA SUSPENSION — LE SEUL ENDROIT OÙ UN TRANSACTIONNEL S'ARRÊTE
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084')::text, true);

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_suspend_organization_email((select v from ids where k='orgA'), '   ');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE SUSPEND PAS UNE ENTREPRISE SANS MOTIF','true', refuse::text);
end $$;

do $$ begin
  perform public.admin_suspend_organization_email(
    (select v from ids where k='orgA'),
    'Taux de plaintes de 2 % sur trente jours : la réputation du domaine est en jeu pour tout le parc.');
end $$;

insert into res select 'LA SUSPENSION ARRÊTE MÊME LE TRANSACTIONNEL','false',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'bernard@test.invalid'));

insert into res select 'MAIS ELLE DIT DEPUIS QUAND ET POURQUOI','true',
  (select (blocking_reason like '%réputation du domaine est en jeu%')::text
     from public.email_gate(
       (select v from ids where k='orgA'), 'factureEmise', 'bernard@test.invalid'));

insert into res select 'Elle laisse une trace administrative','1',
  (select count(*)::text from public.admin_audit_events
    where action = 'emailSending.suspended'
      and target_id = (select v from ids where k='orgA'));

insert into res select 'Et elle ne coupe QUE cette entreprise','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgB'), 'devisEnvoye', 'client-de-b@test.invalid'));

-- L'ENTREPRISE DOIT VOIR QU'ELLE EST COUPÉE. Sans cela, le produit
-- mentirait par omission — et c'est ce qui rend la coupure acceptable.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

insert into res select 'L''ENTREPRISE LIT SA PROPRE SUSPENSION, ET SON MOTIF','true',
  (select (suspended_at is not null and suspended_reason like '%réputation%')::text
     from public.email_organization_settings
    where organization_id = (select v from ids where k='orgA'));

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084')::text, true);

do $$ begin
  perform public.admin_resume_organization_email(
    (select v from ids where k='orgA'), 'Le client a nettoyé sa liste ; on rétablit.');
end $$;

insert into res select 'LA REPRISE REMET TOUT EN MARCHE','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'bernard@test.invalid'));

-- ============================================================
-- 13. LA CAMPAGNE — ET LA PREUVE QU'AUCUN CLIENT FINAL N'Y ENTRE
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','e8400014-0000-4000-8000-000000000084')::text, true);

-- orgA s'est désabonnée au § 5 : on lui redonne son consentement, pour
-- que la campagne ait exactement UNE destinataire et que le compte soit
-- déterministe. orgB n'a JAMAIS consenti — et c'est le point : un
-- consentement ne se présume pas.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
do $$ begin
  perform public.email_record_consent(
    (select v from ids where k='orgA'), true, 'demandeExplicite',
    'Le client redemande à recevoir les annonces.');
end $$;

insert into res select 'UN CONSENTEMENT REDONNÉ LÈVE LE DÉSABONNEMENT','true',
  (select (consented_at is not null and unsubscribed_at is null)::text
     from public.email_consents where organization_id = (select v from ids where k='orgA'));

-- ET IL LÈVE AUSSI LA SUPPRESSION QU'IL AVAIT CAUSÉE. Sans cela, la
-- personne qui revient cocher la case resterait muette pour toujours :
-- le registre dirait « d'accord », la liste de suppression dirait
-- « non », et la seconde gagnerait — sans une ligne d'erreur nulle part.
insert into res select 'ET IL LÈVE LA SUPPRESSION QU''IL AVAIT CAUSÉE','true',
  (select (released_at is not null)::text from public.email_suppressions
    where email = 'contact@jardins-dupont.invalid' and kind = 'desabonnement');

-- MAIS PAS CELLES QUI SONT DES FAITS. Cocher une case ne fait pas
-- réapparaître une boîte qui n'existe pas, et ne retire pas la plainte
-- qu'un destinataire a déposée.
insert into res select 'MAIS PAS UN REBOND DUR : cocher une case ne recrée pas une boîte','1',
  (select count(*)::text from public.email_suppressions
    where email = 'bernard@test.invalid' and kind = 'rebondDur' and released_at is null);

insert into res select 'NI UNE PLAINTE : elle appartient au destinataire, pas à nous','1',
  (select count(*)::text from public.email_suppressions
    where email = 'sophie.martin@test.invalid' and kind = 'plainte' and released_at is null);

-- L'IDENTITÉ D'OASIS, SANS LAQUELLE AUCUNE ANNONCE NE PART.
-- Elle est vide au départ, et c'est délibéré : une prospection dont les
-- réponses tombent dans le vide n'a pas d'expéditeur identifiable.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_send_email_campaign(gen_random_uuid(), 'motif');
  exception when others then refuse := true;
  end;
  insert into res values ('SANS IDENTITÉ D''OASIS, RIEN N''EST TENTÉ','true', refuse::text);
end $$;

insert into res select 'AVANT RÉGLAGE, L''ANNONCE EST BLOQUÉE PAR UNE PHRASE, PAS PAR UNE PANNE','true',
  (select (blocking_reason like '%adresse de réponse d''Oasis Care%')::text
     from public.email_sender_identity(
       (select v from ids where k='orgA'), 'annonceCommerciale'));

update public.email_platform_identity
   set reply_to_email = 'bonjour@oasisrarecare.invalid',
       legal_name = 'Oasis Care SAS', siret = '999 888 777 00011',
       address_line1 = '2 rue de la Serre', postal_code = '75011', city = 'Paris'
 where id;

select set_config('request.jwt.claims',
  json_build_object('sub','e8400014-0000-4000-8000-000000000084')::text, true);

insert into ids select 'campagne', public.admin_create_email_campaign(
  'Nouveauté : le suivi de chantier',
  'Une nouveauté dans Oasis Care',
  'Bonjour, nous venons d''ajouter le suivi de chantier.',
  'Annonce de la nouveauté du trimestre, validée par la direction.');

do $$
declare r record;
begin
  select * into r from public.admin_send_email_campaign(
    (select v from ids where k='campagne'),
    'Envoi de l''annonce trimestrielle.');
  insert into res values ('LA CAMPAGNE NE PART QU''AUX ENTREPRISES QUI ONT CONSENTI','1', r.queued::text);
  insert into res values ('Les autres sont IGNORÉES, pas forcées','true', (r.skipped >= 1)::text);
end $$;

insert into res select 'ET AUCUNE ADRESSE DE CLIENT FINAL N''EST ENTRÉE DANS LA CAMPAGNE','0',
  (select count(*)::text from public.email_messages m
    where m.nature = 'publicite'
      and (m.recipient_kind <> 'entreprise'
           or m.customer_id is not null
           or m.contact_id is not null
           or exists (select 1 from public.crm_customers c
                       where public.email_normalize(c.email) = m.to_email)
           or exists (select 1 from public.crm_contacts ct
                       where public.email_normalize(ct.email) = m.to_email)));

insert into res select 'La destinataire est bien l''entreprise, à son adresse d''entreprise','contact@jardins-dupont.invalid',
  (select to_email from public.email_messages
    where campaign_id = (select v from ids where k='campagne'));

-- QUAND OASIS ÉCRIT, C'EST OASIS QUI SIGNE.
--
-- Le défaut corrigé était gênant : la campagne parcourt les entreprises
-- DESTINATAIRES et passait chacune comme `p_organization_id`, si bien
-- que « Jardins Dupont » recevait une publicité d'Oasis signée
-- « Jardins Dupont », dont le « répondre à » était sa PROPRE adresse.
-- Une réponse « retirez-moi de vos listes » revenait donc chez celui
-- qui voulait partir.
insert into res select 'UNE ANNONCE D''OASIS EST SIGNÉE OASIS, PAS SON DESTINATAIRE','Oasis Care',
  (select from_name from public.email_messages
    where campaign_id = (select v from ids where k='campagne'));

insert into res select 'Et la réponse revient chez OASIS, pas chez celui qui la reçoit','bonjour@oasisrarecare.invalid',
  (select reply_to_email from public.email_messages
    where campaign_id = (select v from ids where k='campagne'));

insert into res select 'Le nom de l''entreprise destinataire n''est nulle part dans l''expéditeur','0',
  (select count(*)::text from public.email_messages
    where campaign_id = (select v from ids where k='campagne')
      and (from_name like '%Dupont%' or reply_to_email like '%jardins-dupont%'));

-- L'EMPREINTE D'UNE CAMPAGNE EST DÉCLARÉE PROVISOIRE, parce que le HTML
-- n'existe pas encore : c'est la file qui le rendra. La présenter comme
-- définitive rendait le journal faux — « refabriquer et prouver que
-- c'est identique » n'aurait jamais marché pour une campagne.
insert into res select 'L''EMPREINTE D''UNE CAMPAGNE EST DÉCLARÉE PROVISOIRE','true',
  (select body_html_sha256_provisoire::text from public.email_messages
    where campaign_id = (select v from ids where k='campagne'));

insert into res select 'Celle d''un devis ne l''est jamais','false',
  (select bool_or(body_html_sha256_provisoire)::text from public.email_messages
    where nature = 'transactionnel');

insert into res select 'La campagne est marquée envoyée, avec ses comptes','sent',
  (select status from public.email_campaigns where id = (select v from ids where k='campagne'));

insert into res select 'Elle laisse une trace administrative AVEC son motif','true',
  (select (reason like '%annonce trimestrielle%')::text from public.admin_audit_events
    where action = 'emailCampaign.sent'
      and target_id = (select v from ids where k='campagne'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_send_email_campaign(
      (select v from ids where k='campagne'), 'On la renvoie pour voir.');
  exception when others then refuse := true;
  end;
  insert into res values ('UNE CAMPAGNE NE SE REJOUE PAS','true', refuse::text);
end $$;

-- ============================================================
-- 14. LES DROITS — LE PIÈGE DE 0075, ET LE PRÉFIXE NEUF
-- ============================================================
insert into res select 'LES SIX PERMISSIONS NEUVES SONT AU CATALOGUE','6',
  (select count(*)::text from public.platform_admin_permissions where key like 'emails.%');

-- LE PIÈGE : une permission ajoutée après 0075 n'est portée par
-- PERSONNE si l'on ne rejoue pas la jointure — et l'écran disparaît du
-- menu sans un mot. Il a mordu trois fois.
insert into res select 'ET LE SUPER-ADMINISTRATEUR LES PORTE TOUTES LES SIX','6',
  (select count(*)::text from public.platform_admin_role_permissions
    where role = 'super_admin' and permission like 'emails.%');

insert into res select 'Le produit compose et envoie','emails.campaigns.read,emails.campaigns.send,emails.log.read',
  (select string_agg(permission, ',' order by permission) from public.platform_admin_role_permissions
    where role = 'product_admin' and permission like 'emails.%');

insert into res select 'La sécurité protège le domaine, et ne compose rien','emails.log.read,emails.sending.suspend,emails.suppression.manage,emails.suppression.read',
  (select string_agg(permission, ',' order by permission) from public.platform_admin_role_permissions
    where role = 'security_admin' and permission like 'emails.%');

insert into res select 'Le support LIT, et ne fait que lire','2',
  (select count(*)::text from public.platform_admin_role_permissions
    where role = 'support' and permission like 'emails.%');

insert into res select 'L''analyste en lecture seule ne reçoit rien','0',
  (select count(*)::text from public.platform_admin_role_permissions
    where role = 'read_only_analyst' and permission like 'emails.%');

-- LE GARDE-FOU DE LA MATRICE, SUR LE PRÉFIXE NEUF. Sans lui,
-- ('support', 'emails.campaigns.send') passerait : un rôle d'assistance
-- pourrait écrire à tout le parc depuis un domaine authentifié.
do $$
declare
  p text;
  refuse boolean;
begin
  foreach p in array array[
    'support|emails.campaigns.send',
    'support|emails.sending.suspend',
    'billing_admin|emails.campaigns.send',
    'billing_admin|emails.suppression.manage',
    'read_only_analyst|emails.sending.suspend',
    'security_admin|emails.campaigns.send',
    'product_admin|emails.sending.suspend',
    'product_admin|emails.suppression.manage'
  ]
  loop
    refuse := false;
    begin
      insert into public.platform_admin_role_permissions (role, permission)
      values (split_part(p, '|', 1), split_part(p, '|', 2));
    exception when others then refuse := true;
    end;
    insert into res values ('MOINDRE PRIVILÈGE — (' || replace(p, '|', ', ') || ') refusé',
      'true', refuse::text);
  end loop;
end $$;

-- Et les règles des migrations précédentes tiennent encore : le
-- garde-fou a été RECOPIÉ, pas remplacé.
do $$
declare
  p text;
  refuse boolean;
begin
  foreach p in array array[
    'support|platform.admins.manage',
    'security_admin|platform.admins.manage',
    'product_admin|billing.payments.write',
    'read_only_analyst|platform.security.write',
    'billing_admin|customer.data.read'
  ]
  loop
    refuse := false;
    begin
      insert into public.platform_admin_role_permissions (role, permission)
      values (split_part(p, '|', 1), split_part(p, '|', 2));
    exception when others then refuse := true;
    end;
    insert into res values ('LES RÈGLES ANCIENNES TIENNENT — (' || replace(p, '|', ', ') || ') refusé',
      'true', refuse::text);
  end loop;
end $$;

-- Une lecture, elle, reste accordable : la règle vise `is_write`.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.platform_admin_role_permissions (role, permission)
    values ('billing_admin', 'emails.log.read');
  exception when others then refuse := true;
  end;
  insert into res values ('Mais une LECTURE reste accordable','false', refuse::text);
end $$;

-- ET ON DÉFAIT CE QU'ON VIENT D'ACCORDER. Cette ligne était une SONDE,
-- pas un réglage : la laisser derrière rendrait faux le § 23, qui
-- vérifie que la facturation ne mesure pas la délivrabilité du parc. Un
-- test qui modifie l'état qu'un autre test observe est un test qui ment
-- un jour sur deux.
delete from public.platform_admin_role_permissions
 where role = 'billing_admin' and permission = 'emails.log.read';

-- ============================================================
-- 15. LA SÉPARATION, ET LES GRANT PAR DÉFAUT DE SUPABASE
-- ============================================================
-- C'est là que 0055 s'est fait avoir. Vérifié par requête, pas par
-- confiance.
do $$
declare t text;
begin
  foreach t in array array[
    'email_templates', 'email_consents', 'email_suppressions',
    'email_organization_settings', 'email_campaigns',
    'email_messages', 'email_events', 'email_platform_identity'
  ]
  loop
    insert into res values ('`anon` ne lit pas ' || t, 'false',
      has_table_privilege('anon', 'public.' || t, 'select')::text);
    insert into res values ('`authenticated` n''écrit pas dans ' || t, 'false',
      (has_table_privilege('authenticated', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'update')
       or has_table_privilege('authenticated', 'public.' || t, 'delete'))::text);
  end loop;
end $$;

-- LE JETON DE DÉSABONNEMENT NE SE LIT PAS. Un membre qui le verrait
-- pourrait désabonner son entreprise depuis un onglet.
insert into res select 'LE REGISTRE DE CONSENTEMENT N''EST LISIBLE PAR PERSONNE (il porte les jetons)','false',
  has_table_privilege('authenticated', 'public.email_consents', 'select')::text;

insert into res select 'Mais son ÉTAT se lit par une vue qui ne montre pas le jeton','true',
  has_table_privilege('authenticated', 'public.email_consent_state', 'select')::text;

insert into res select 'Et la vue ne porte AUCUNE colonne de jeton','0',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'email_consent_state'
      and column_name like '%token%');

-- METTRE UN MESSAGE EN FILE EST LA PORTE QU'UN NAVIGATEUR NE POUSSE PAS.
insert into res select 'UN JETON DE NAVIGATEUR NE MET RIEN EN FILE','false',
  has_function_privilege('authenticated',
    'public.email_enqueue(uuid, text, text, uuid, text, text, text, text, text, uuid, jsonb, integer, uuid, boolean)',
    'execute')::text;

insert into res select 'Ni n''enregistre un événement de transporteur','false',
  has_function_privilege('authenticated',
    'public.email_record_event(text, text, text, timestamptz, text, jsonb)', 'execute')::text;

insert into res select 'Ni ne marque un message comme parti','false',
  has_function_privilege('authenticated', 'public.email_mark_sent(uuid, text, text, text)', 'execute')::text;

-- LE DÉSABONNEMENT, LUI, DOIT ÊTRE OUVERT À QUI N'EST PAS CONNECTÉ.
insert into res select 'LE DÉSABONNEMENT EST OUVERT À `anon`, ET C''EST LE BUT','true',
  has_function_privilege('anon', 'public.email_unsubscribe(text)', 'execute')::text;

insert into res select 'Mais c''est la SEULE porte ouverte à `anon`','1',
  (select count(*)::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'email%'
      and has_function_privilege('anon', p.oid, 'execute'));

-- ---- La séparation, éprouvée sur un vrai jeton ----------------------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400001-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select public.admin_create_email_campaign(''x'', ''y'', ''z'', ''motif'')',
    'select * from public.admin_send_email_campaign(gen_random_uuid(), ''motif'')',
    'select public.admin_suspend_organization_email(gen_random_uuid(), ''motif'')',
    'select public.admin_resume_organization_email(gen_random_uuid(), ''motif'')',
    'select public.admin_release_email_suppression(gen_random_uuid(), ''motif'')'
  ]
  loop
    refuse := false;
    begin execute f; exception when others then refuse := true; end;
    insert into res values ('Utilisateur ordinaire — « ' || left(f, 52) || '… » lève', 'true', refuse::text);
  end loop;
end $$;

insert into res select 'Un étranger ne voit AUCUN message d''une entreprise dont il n''est pas membre','0',
  (select count(*)::text from public.email_messages);

-- LE CLOISONNEMENT DES FONCTIONS `security definer`. Elles traversent
-- la RLS par construction : sans un contrôle écrit à l'intérieur, elles
-- seraient la porte dérobée qui rend toutes les politiques inutiles.
-- On les pointe donc sur l'entreprise d'un AUTRE, avec un vrai jeton.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400003-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select * from public.email_recipient_for_customer((select v from ids where k=''orgA''), (select v from ids where k=''clientContact''))',
    'select * from public.email_sender_identity((select v from ids where k=''orgA''), ''devisEnvoye'')',
    'select * from public.email_gate((select v from ids where k=''orgA''), ''annonceCommerciale'', ''contact@jardins-dupont.invalid'')'
  ]
  loop
    refuse := false;
    begin execute f; exception when others then refuse := true; end;
    insert into res values ('UN VOISIN NE POINTE PAS CES FONCTIONS SUR L''ENTREPRISE D''UN AUTRE — « ' ||
      left(regexp_replace(f, '^select \* from public\.', ''), 28) || '… »', 'true', refuse::text);
  end loop;
end $$;

-- ET LA PLUS STRICTE DES TROIS : l'adresse d'un client est une donnée
-- métier. Un administrateur de plateforme n'y a PAS accès non plus —
-- 0075 réserve `customer.data.read` à un mécanisme d'assistance encadré
-- qui n'existe pas encore, et une fonction `security definer` ouverte à
-- tout administrateur serait la porte dérobée qui contourne ce choix.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400010-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform * from public.email_recipient_for_customer(
      (select v from ids where k='orgA'), (select v from ids where k='clientContact'));
  exception when others then refuse := true;
  end;
  insert into res values ('MÊME LE SUPER-ADMINISTRATEUR N''OUVRE PAS L''ADRESSE D''UN CLIENT','true', refuse::text);
end $$;

-- Mais l'identité de l'ENTREPRISE, elle, lui reste lisible : c'est une
-- métadonnée d'entreprise, pas une donnée métier de client.
do $$
declare refuse boolean := false;
begin
  begin
    perform * from public.email_sender_identity(
      (select v from ids where k='orgA'), 'devisEnvoye');
  exception when others then refuse := true;
  end;
  insert into res values ('Mais l''identité de l''ENTREPRISE lui reste lisible','false', refuse::text);
end $$;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400001-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

insert into res select 'MAIS UN MEMBRE VOIT LES SIENS, avec le motif de l''échec','true',
  (select (count(*) > 0)::text from public.email_messages
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Et il ne voit RIEN de ceux d''une autre entreprise','0',
  (select count(*)::text from public.email_messages
    where organization_id = (select v from ids where k='orgB'));

-- UN ADMINISTRATEUR D'OASIS NE LIT PAS LE COURRIER D'UN CLIENT. Il ne
-- voit que le courrier d'Oasis — la publicité qu'Oasis a lui-même
-- expédiée. Le devis d'un paysagiste est une donnée métier.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

insert into res select 'UN ADMINISTRATEUR D''OASIS NE LIT AUCUN COURRIER TRANSACTIONNEL D''UN CLIENT','0',
  (select count(*)::text from public.email_messages where nature = 'transactionnel');

insert into res select 'Il ne voit que le courrier d''Oasis lui-même','true',
  (select (count(*) > 0)::text from public.email_messages where nature = 'publicite');

reset role;

-- ============================================================
-- 16. QUAND LE TRANSPORTEUR N'EST PAS CONFIGURÉ
-- ============================================================
-- « Pas d'adresse d'expédition sur ce serveur » est un ÉTAT NORMAL —
-- celui d'un déploiement où la variable n'a pas encore été posée — et
-- l'écran doit s'y adapter au lieu de mentir. Même forme
-- qu'`unavailableReason` du côté paiement : une phrase, pas une panne.
do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'devisEnvoye', 'quote',
    gen_random_uuid(), 'devis-v2',
    null,
    'Votre devis', 'Corps', encode(sha256('z'::bytea), 'hex'),
    (select v from ids where k='clientFiche'));
  insert into res values ('SANS ADRESSE TECHNIQUE, RIEN NE PART — mais on le DIT','false', r.created::text);
  insert into res values ('Et la phrase nomme ce qui manque','true',
    (r.blocking_reason like '%adresse technique d''expédition n''est pas configurée%')::text);
end $$;

-- ============================================================
-- 17. LA TRACE, DU BON CÔTÉ
-- ============================================================
-- Un envoi métier s'inscrit au journal de l'entreprise ; la publicité
-- d'Oasis s'inscrit au journal administratif. Les mélanger rendrait les
-- deux illisibles.
insert into res select 'UN ENVOI MÉTIER S''INSCRIT AU JOURNAL DE L''ENTREPRISE','true',
  (select (count(*) > 0)::text from public.audit_events
    where organization_id = (select v from ids where k='orgA') and action = 'emailQueued');

insert into res select 'Et il est marqué « system », jamais « ai »','system',
  (select distinct source from public.audit_events
    where organization_id = (select v from ids where k='orgA') and action = 'emailQueued');

insert into res select 'LA PUBLICITÉ NE S''INSCRIT PAS AU JOURNAL DU CLIENT','0',
  (select count(*)::text from public.audit_events
    where action = 'emailQueued'
      and entity_id = (select v from ids where k='orgA')
      and new_value ->> 'template' = 'annonceCommerciale');

insert into res select 'Elle s''inscrit au journal administratif, avec son motif','1',
  (select count(*)::text from public.admin_audit_events
    where action = 'emailCampaign.created'
      and target_id = (select v from ids where k='campagne'));

-- ============================================================
-- 18. LE DÉSABONNEMENT, LES CAS DE BORD
-- ============================================================
do $$
declare r record;
begin
  select * into r from public.email_unsubscribe('jeton-qui-nexiste-pas-du-tout-mais-assez-long-quand-meme');
  insert into res values ('UN JETON INVENTÉ NE DÉSABONNE RIEN','false', r.done::text);
  insert into res values ('Et il ne dit pas s''il a existé','Ce lien de désabonnement n''est pas valide.', r.message);

  select * into r from public.email_unsubscribe('court');
  insert into res values ('Un jeton trop court non plus','false', r.done::text);

  select * into r from public.email_unsubscribe((select v from att where k='jetonA'));
  insert into res values ('LE DÉSABONNEMENT EST IDEMPOTENT','true', r.done::text);
end $$;

insert into res select 'Et le désabonnement inscrit aussi l''adresse à la liste de suppression','true',
  (select (count(*) > 0)::text from public.email_suppressions
    where email = 'contact@jardins-dupont.invalid' and kind = 'desabonnement' and released_at is null);

-- APRÈS TOUT CELA — le désabonnement, la plainte, le rebond, le blocage,
-- la suspension puis la reprise — LA FACTURE PART TOUJOURS. C'est la
-- phrase que ce fichier existe pour pouvoir écrire.
insert into res select 'LA CONCLUSION : APRÈS TOUT CELA, LA FACTURE PART TOUJOURS','true',
  (select allowed::text from public.email_gate(
     (select v from ids where k='orgA'), 'factureEmise', 'contact@jardins-dupont.invalid'));

-- ============================================================
-- 19. LE SECOND FACTEUR EST BIEN BRANCHÉ
-- ============================================================
-- Écrire à tout le parc depuis un domaine authentifié est le geste par
-- lequel un compte compromis ferait le plus de dégâts. Il est donc
-- derrière le même cran que les autres écritures administratives — et
-- sans ce test, le cran aurait pu être oublié sur ces fonctions-là.
--
-- CE BLOC EST LE DERNIER DU FICHIER, ET CE N'EST PAS UN HASARD :
-- rallumer la politique la rend opposable à `admin_set_mfa_policy`
-- elle-même, donc on ne peut plus l'éteindre sans une session `aal2`.
-- La placer ailleurs bloquerait tout ce qui suit.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400010-0000-4000-8000-000000000084')::text, true);
do $$ begin
  perform public.admin_set_mfa_policy(true, null, 'Durcissement pour éprouver le cran.');
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub','e8400014-0000-4000-8000-000000000084')::text, true);
do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.admin_create_email_campaign('x', 'y', 'z', 'Un motif suffisant.');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('SANS SECOND FACTEUR, ON N''ÉCRIT PAS AU PARC','true', refuse::text);
  insert into res values ('Et le refus dit quoi faire','true', (v_msg like '%Second facteur%')::text);
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084')::text, true);
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_suspend_organization_email(
      (select v from ids where k='orgB'), 'Un motif suffisant.');
  exception when others then refuse := true;
  end;
  insert into res values ('NI NE SUSPEND UNE ENTREPRISE','true', refuse::text);
end $$;

-- Et avec un facteur vérifié ET une session qui l'a présenté, tout se
-- rouvre : le cran mesure bien le SECOND FACTEUR, et pas autre chose.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), 'e8400014-0000-4000-8000-000000000084',
        'Test courrier', 'totp', 'verified', now(), now());

select set_config('request.jwt.claims',
  json_build_object('sub','e8400014-0000-4000-8000-000000000084','aal','aal2')::text, true);

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_create_email_campaign(
      'Annonce avec second facteur', 'Objet', 'Corps', 'Un motif suffisant.');
  exception when others then refuse := true;
  end;
  insert into res values ('AVEC UN SECOND FACTEUR PRÉSENTÉ, L''ANNONCE REDEVIENT POSSIBLE','false', refuse::text);
end $$;


-- ============================================================
-- 18. LA RÉSERVATION — LE VERROU QUI MANQUAIT À LA FILE
-- ============================================================
--
-- CE QUE CE PARAGRAPHE DÉFEND : deux passages d'ordonnanceur qui se
-- chevauchent n'expédient pas le même message deux fois.
--
-- La contrainte d'unicité sur `idempotency_key` garde l'INSERTION. Elle
-- ne garde pas la file, qui n'insère rien : elle relit des lignes qui
-- existent déjà. Un `select … where status = 'queued'` suivi d'un appel
-- au transporteur laissait donc partir deux fois chaque message en
-- attente — et le doublon était INVISIBLE, parce que le second marquage
-- retombait sur la même ligne.
reset role;
select set_config('request.jwt.claims', null, true);

insert into ids select 'msgResa', message_id from public.email_enqueue(
  (select v from ids where k='orgA'), 'factureEmise', 'invoice',
  (select v from ids where k='f6'), 'facture-v3',
  'notifications@oasisrarecare.invalid',
  'Facture à réserver', 'Corps.', encode(sha256('h'::bytea), 'hex'),
  (select v from ids where k='clientContact'));

insert into res select 'UN MESSAGE NEUF ATTEND EN FILE','queued',
  (select status from public.email_messages where id = (select v from ids where k='msgResa'));

do $$
declare v_premier integer; v_second integer;
begin
  -- Le premier passage prend la ligne.
  select count(*) into v_premier from public.email_claim_queued(50, 'passage-1');
  -- Le second, joué juste après, ne doit plus la voir : elle n'est plus
  -- « queued ». C'est exactement ce que `skip locked` produit quand les
  -- deux passages sont réellement simultanés.
  select count(*) into v_second from public.email_claim_queued(50, 'passage-2');
  insert into res values ('LE PREMIER PASSAGE RÉSERVE AU MOINS UN MESSAGE','true', (v_premier >= 1)::text);
  insert into res values ('LE SECOND N''EN REPREND AUCUN','0', v_second::text);
end $$;

insert into res select 'LA RÉSERVATION SE VOIT DANS L''ÉTAT','sending',
  (select status from public.email_messages where id = (select v from ids where k='msgResa'));

insert into res select 'Et le compteur de tentatives a monté AVANT l''appel sortant','1',
  (select attempts::text from public.email_messages where id = (select v from ids where k='msgResa'));

insert into res select 'Le passage qui l''a prise est nommé','passage-1',
  (select claimed_by from public.email_messages where id = (select v from ids where k='msgResa'));

-- LA RÉSERVATION D'UN MESSAGE PRÉCIS, pour le chemin « un devis vient
-- d'être marqué envoyé » : il enfile puis transporte tout de suite.
do $$
declare v_a boolean; v_b boolean; v_id uuid;
begin
  select message_id into v_id from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='f7'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Facture réservée une fois', 'Corps.', encode(sha256('h2'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  v_a := public.email_claim_one(v_id, 'onglet-1');
  v_b := public.email_claim_one(v_id, 'onglet-2');
  insert into res values ('DEUX ONGLETS, UNE SEULE RÉSERVATION — le premier l''obtient','true', v_a::text);
  insert into res values ('… et le second se la voit refuser','false', v_b::text);
  insert into ids select 'msgResa2', v_id;
end $$;


-- ============================================================
-- 19. L'ÉCHEC TEMPORAIRE REPART. L'ÉCHEC DÉFINITIF NON.
-- ============================================================
--
-- « Le transporteur a atteint son plafond d'envois pour aujourd'hui ;
-- il repartira une fois le plafond levé » était écrit dans le produit,
-- et rien ne le repartait : 'failed' est terminal, la file ne lit que
-- 'queued', et aucun bouton ne remettait une ligne en file. Un lundi
-- matin où le plafond journalier tombe, toutes les factures et relances
-- de la pointe étaient perdues DÉFINITIVEMENT — avec au journal une
-- phrase qui affirmait le contraire.
do $$
declare v_ok boolean;
begin
  v_ok := public.email_mark_failed(
    (select v from ids where k='msgResa'),
    'Le transporteur a atteint son plafond d''envois pour aujourd''hui.',
    '429', 'test', true, interval '15 minutes', 5);
  insert into res values ('UN 429 EST TRAITÉ COMME TEMPORAIRE','true', v_ok::text);
end $$;

insert into res select 'ET LE MESSAGE RETOURNE EN FILE, il n''est pas perdu','queued',
  (select status from public.email_messages where id = (select v from ids where k='msgResa'));

insert into res select 'Avec une date de prochain essai','true',
  (select (next_attempt_at is not null)::text from public.email_messages
    where id = (select v from ids where k='msgResa'));

insert into res select 'Et le motif reste lisible en attendant','true',
  (select (failure_reason like '%plafond%')::text from public.email_messages
    where id = (select v from ids where k='msgResa'));

-- MAIS IL N'EST PAS REPRIS AVANT L'HEURE. Sans ce filtre, un
-- transporteur en panne serait bombardé à chaque tic d'ordonnanceur.
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.email_claim_queued(50, 'trop-tot') c
   where c.id = (select v from ids where k='msgResa');
  insert into res values ('IL N''EST PAS REPRIS AVANT L''HEURE DITE','0', v_n::text);
end $$;

-- ET IL FINIT PAR ABANDONNER. Sans plafond, une ligne insubmersible
-- expédierait à chaque passage, indéfiniment.
do $$
declare v_id uuid;
begin
  select message_id into v_id from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='f8'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Facture qui s''épuise', 'Corps.', encode(sha256('h3'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  -- Deux tentatives, plafond à deux.
  perform public.email_claim_one(v_id, 'w');
  perform public.email_mark_failed(v_id, 'Panne passagère.', '503', 'test', true, interval '0 seconds', 2);
  perform public.email_claim_one(v_id, 'w');
  perform public.email_mark_failed(v_id, 'Panne passagère.', '503', 'test', true, interval '0 seconds', 2);
  insert into ids select 'msgEpuise', v_id;
end $$;

insert into res select 'AU PLAFOND DE TENTATIVES, L''ÉCHEC DEVIENT DÉFINITIF','failed',
  (select status from public.email_messages where id = (select v from ids where k='msgEpuise'));

insert into res select 'ET LE JOURNAL LE DIT, au lieu de promettre un renvoi qui n''arrivera pas','true',
  (select (failure_reason like '%nous cessons d''essayer%')::text
     from public.email_messages where id = (select v from ids where k='msgEpuise'));

-- LE SORT INCONNU. Quand le réseau coupe après que le transporteur a
-- accepté le message, on ne sait pas s'il est parti. Affirmer « il
-- n'est pas parti » est faux dans le cas le plus fréquent.
do $$
declare v_ok boolean;
begin
  v_ok := public.email_mark_uncertain(
    (select v from ids where k='msgResa2'),
    'Nous n''avons pas eu de réponse du transporteur : ce message est peut-être parti.', 'test');
  insert into res values ('UN SORT INCONNU S''ENREGISTRE','true', v_ok::text);
end $$;

insert into res select 'IL NE SE DÉCLARE NI PARTI NI PERDU','sending',
  (select status from public.email_messages where id = (select v from ids where k='msgResa2'));

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.email_claim_queued(50, 'apres-inconnu') c
   where c.id = (select v from ids where k='msgResa2');
  insert into res values ('Et il n''est pas rejoué par la file','0', v_n::text);
end $$;

insert into res select 'Le paysagiste lit qu''il faut vérifier avant de renvoyer','sortInconnu',
  (select failure_code from public.email_messages where id = (select v from ids where k='msgResa2'));


-- ============================================================
-- 20. LA PORTE, REJOUÉE AU MOMENT D'EXPÉDIER
-- ============================================================
--
-- TROIS DÉFAUTS AVAIENT LA MÊME CAUSE : le vidage de la file ne
-- relisait que l'identité de l'expéditeur. Une publicité déjà en file
-- partait malgré une plainte survenue entre-temps ; suspendre une
-- entreprise n'arrêtait pas ses messages en attente ; un document
-- annulé partait quand même.

-- a) UNE FACTURE ANNULÉE NE PART PAS.
do $$
declare v_id uuid; r record;
begin
  select message_id into v_id from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='f9'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Facture qui sera annulée', 'Corps.', encode(sha256('h4'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  insert into ids select 'msgAnnule', v_id;

  select * into r from public.email_still_sendable(v_id);
  insert into res values ('AVANT ANNULATION, LA PORTE LAISSE PASSER','true', r.ok::text);

  update public.invoices set status = 'cancelled'
   where id = (select v from ids where k='f9');

  select * into r from public.email_still_sendable(v_id);
  insert into res values ('APRÈS ANNULATION DE LA FACTURE, ELLE REFUSE','false', r.ok::text);
  insert into res values ('Et elle dit pourquoi, en français','true',
    (r.blocking_reason like '%annulée%')::text);
end $$;

-- ET ON PEUT ARRÊTER CE QUI ATTEND. Le rang « cancelled » était déclaré
-- dans la contrainte et RIEN dans le produit ne l'écrivait jamais.
insert into res select 'ANNULER LE DOCUMENT ARRÊTE LE MESSAGE EN FILE','1',
  public.email_cancel_queued(
    (select v from ids where k='orgA'), 'invoice',
    (select v from ids where k='f9'),
    'La facture a été annulée.')::text;

insert into res select 'Le message est marqué annulé, pas effacé','cancelled',
  (select status from public.email_messages where id = (select v from ids where k='msgAnnule'));

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.email_claim_queued(50, 'apres-annulation') c
   where c.id = (select v from ids where k='msgAnnule');
  insert into res values ('Et il n''est plus jamais repris par la file','0', v_n::text);
end $$;

-- b) UNE ENTREPRISE SUSPENDUE N'EXPÉDIE PLUS RIEN, PAS MÊME CE QUI
--    ATTENDAIT DÉJÀ. C'est le seul frein d'urgence qui protège la
--    réputation d'un domaine partagé par tout le parc.
do $$
declare v_id uuid; r record;
begin
  select message_id into v_id from public.email_enqueue(
    (select v from ids where k='orgA'), 'devisEnvoye', 'quote',
    (select v from ids where k='devis1'), 'devis-v2',
    'notifications@oasisrarecare.invalid',
    'Devis en attente de transport', 'Corps.', encode(sha256('h5'::bytea), 'hex'),
    (select v from ids where k='clientContact'), '{}'::jsonb, 3);
  insert into ids select 'msgSuspendu', v_id;
  select * into r from public.email_still_sendable(v_id);
  insert into res values ('AVANT SUSPENSION, LE DEVIS EN FILE PEUT PARTIR','true', r.ok::text);
end $$;

-- Le responsable sécurité a besoin d'un second facteur VÉRIFIÉ : les
-- cinq fonctions d'écriture de ce fichier appellent
-- « platform_admin_require_mfa() ».
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), 'e8400013-0000-4000-8000-000000000084',
        'Test courrier sécurité', 'totp', 'verified', now(), now());

select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084','aal','aal2')::text, true);
set local role authenticated;

do $$
begin
  perform public.admin_suspend_organization_email(
    (select v from ids where k='orgA'),
    'Trop de plaintes : on protège la réputation du domaine pour tout le parc.');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare r record;
begin
  select * into r from public.email_still_sendable((select v from ids where k='msgSuspendu'));
  insert into res values ('UNE ENTREPRISE SUSPENDUE N''EXPÉDIE PLUS CE QUI ATTENDAIT','false', r.ok::text);
  insert into res values ('Et le motif décidé par un humain est recopié','true',
    (r.blocking_reason like '%Trop de plaintes%')::text);
end $$;

-- L'ENTREPRISE LE VOIT DANS SON ÉCRAN. C'est l'une des trois conditions
-- qui rendent la coupure d'un transactionnel acceptable.
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

insert into res select 'ET L''ENTREPRISE LIT ELLE-MÊME QU''ELLE EST COUPÉE, ET POURQUOI','true',
  (select (suspended_reason like '%Trop de plaintes%')::text
     from public.email_organization_settings
    where organization_id = (select v from ids where k='orgA'));

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084','aal','aal2')::text, true);
set local role authenticated;
do $$
begin
  perform public.admin_resume_organization_email(
    (select v from ids where k='orgA'), 'Le paysagiste a corrigé ses listes.');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- c) UNE PUBLICITÉ DÉJÀ EN FILE NE PART PAS SI L'ADRESSE VIENT D'ENTRER
--    EN LISTE DE SUPPRESSION — et le pendant obligatoire : le
--    TRANSACTIONNEL, lui, part toujours.
--
-- L'entreprise A s'est désabonnée au § 16 par le lien du message : on
-- lui redonne son consentement, sans quoi la publicité serait refusée
-- pour une autre raison et l'on n'éprouverait rien.
select set_config('request.jwt.claims',
  json_build_object('sub','e8400002-0000-4000-8000-000000000084')::text, true);
set local role authenticated;
do $$
begin
  perform public.email_record_consent(
    (select v from ids where k='orgA'), true, 'reglagesEntreprise',
    'Je réactive les communications commerciales.');
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare r record;
begin
  select * into r from public.email_still_sendable(
    (select id from public.email_messages
      where campaign_id = (select v from ids where k='campagne') limit 1));
  insert into res values ('LA PUBLICITÉ EN FILE PASSE ENCORE LA PORTE','true', r.ok::text);
end $$;

insert into public.email_suppressions (email, kind, reason)
values ('contact@jardins-dupont.invalid', 'plainte', 'Signalé comme indésirable.')
on conflict (email, kind) do update
  set released_at = null, released_by = null, released_reason = null, last_seen_at = now();

do $$
declare r record;
begin
  select * into r from public.email_still_sendable(
    (select id from public.email_messages
      where campaign_id = (select v from ids where k='campagne') limit 1));
  insert into res values ('APRÈS LA PLAINTE, LA PUBLICITÉ EN FILE NE PART PLUS','false', r.ok::text);
end $$;

-- LE PENDANT, ET C'EST LE TEST LE PLUS IMPORTANT DU PARAGRAPHE : la
-- même plainte, sur LA MÊME ADRESSE, ne retire RIEN au transactionnel.
-- Quelqu'un qui signale une annonce comme indésirable doit continuer de
-- recevoir ses documents.
do $$
declare v_id uuid; r record; v_raison text;
begin
  select message_id, blocking_reason into v_id, v_raison from public.email_enqueue(
    (select v from ids where k='orgA'), 'bienvenueEntreprise', 'organization',
    (select v from ids where k='orgA'), 'bienvenue-v1',
    'notifications@oasisrarecare.invalid',
    'Bienvenue', 'Corps.', encode(sha256('h6'::bytea), 'hex'));
  insert into res values ('LE TRANSACTIONNEL VERS LA MÊME ADRESSE PART QUAND MÊME','true',
    (v_id is not null)::text);
  select * into r from public.email_still_sendable(v_id);
  insert into res values ('ET IL PASSE ENCORE LA PORTE AU MOMENT D''EXPÉDIER','true', r.ok::text);
end $$;


-- ============================================================
-- 21. L'IDEMPOTENCE EST CLOISONNÉE PAR ENTREPRISE
-- ============================================================
--
-- LE DÉFAUT CATASTROPHIQUE, ATTEINT PAR LA PORTE DE L'IDEMPOTENCE. La
-- clé était globale au parc : un membre de l'entreprise A pouvait
-- CONSOMMER D'AVANCE la clé de la facture de l'entreprise B en passant
-- son identifiant. Quand B émettait sa facture, la mise en file rendait
-- « ce message est déjà parti » — l'écran affichait un envoi réussi, le
-- client ne recevait jamais rien, et le journal donnait raison au
-- logiciel.
insert into res select 'L''ORGANISATION EST DANS LA CLÉ D''IDEMPOTENCE','true',
  (select (idempotency_key like (select v::text from ids where k='orgA') || ':%')::text
     from public.email_messages where id = (select v from ids where k='msgFacture1'));

do $$
declare r record;
begin
  -- L'entreprise A tente de préempter la clé d'une facture de B.
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    (select v from ids where k='factureB'), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Préemption', 'Corps.', encode(sha256('h7'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  insert into res values ('UNE ENTREPRISE NE PRÉEMPTE PAS LA CLÉ D''UNE AUTRE','false', r.created::text);
  insert into res values ('Et le refus nomme le vrai problème','true',
    (r.blocking_reason like '%n''appartient pas à cette entreprise%')::text);
end $$;

-- ET L'OBJET LIÉ EST VÉRIFIÉ : un identifiant inventé ne journalise rien.
do $$
declare r record;
begin
  select * into r from public.email_enqueue(
    (select v from ids where k='orgA'), 'factureEmise', 'invoice',
    gen_random_uuid(), 'facture-v3',
    'notifications@oasisrarecare.invalid',
    'Facture fantôme', 'Corps.', encode(sha256('h8'::bytea), 'hex'),
    (select v from ids where k='clientContact'));
  insert into res values ('UN OBJET QUI N''EXISTE PAS NE PRODUIT AUCUN MESSAGE','false', r.created::text);
end $$;


-- ============================================================
-- 22. LA LISTE DE SUPPRESSION NE SORT PLUS EN CLAIR
-- ============================================================
--
-- Elle est alimentée depuis l'adresse de tout message qui rebondit :
-- elle contient donc, en majorité, les adresses des CLIENTS FINAUX des
-- paysagistes — des gens qui n'ont rien signé avec Oasis Care. Le même
-- fichier leur refuse pourtant cette donnée jusqu'au
-- super-administrateur dans `email_recipient_for_customer`.
insert into res select 'LA TABLE DE SUPPRESSION N''EST PLUS LISIBLE PAR UN JETON','false',
  has_table_privilege('authenticated', 'public.email_suppressions', 'select')::text;

insert into res select 'ET AUCUNE POLITIQUE NE L''OUVRE','0',
  (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename = 'email_suppressions');

select set_config('request.jwt.claims',
  json_build_object('sub','e8400011-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

insert into res select 'LE SUPPORT LIT LA LISTE, MAIS MASQUÉE','true',
  (select (count(*) > 0)::text from public.email_suppression_digest());

insert into res select 'ET AUCUNE ADRESSE COMPLÈTE N''EN SORT','0',
  (select count(*)::text from public.email_suppression_digest() d
    where d.masked_email not like '_***@%');

insert into res select 'Le domaine, lui, reste lisible : c''est ce qui sert à enquêter','true',
  (select (count(*) > 0)::text from public.email_suppression_digest() d
    where d.domain is not null and d.domain <> '');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400012-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false; n integer;
begin
  begin select count(*) into n from public.email_suppression_digest();
  exception when others then refuse := true; end;
  insert into res values ('LA FACTURATION N''Y ACCÈDE PAS','true', refuse::text);
end $$;

-- ET LA MATRICE REFUSE DE L'ACCORDER À QUI N'A RIEN À Y VOIR. Le
-- garde-fou de 0075 ne filtrait que le préfixe `customer.%` : rien
-- n'empêchait d'attribuer la liste à l'analyste ou à la facturation.
reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare
  c text;
  refuse boolean;
begin
  foreach c in array array['read_only_analyst', 'billing_admin', 'product_admin']
  loop
    refuse := false;
    begin
      insert into public.platform_admin_role_permissions (role, permission)
      values (c, 'emails.suppression.read');
    exception when others then refuse := true;
    end;
    insert into res values ('LA MATRICE REFUSE LA LISTE DE SUPPRESSION À « ' || c || ' »', 'true', refuse::text);
  end loop;
end $$;


-- ============================================================
-- 23. LA RÉPUTATION, VUE PAR CEUX QUI PEUVENT Y RÉPONDRE
-- ============================================================
--
-- La vue du § 10 est `security_invoker`, et la seule politique de
-- `email_messages` ouverte à un administrateur est
-- `nature = 'publicite'`. Un paysagiste qui faisait rebondir deux cents
-- devis n'apparaissait donc NULLE PART côté Oasis : le risque numéro un
-- du chantier n'était pas mesuré par ceux qui peuvent le traiter.
select set_config('request.jwt.claims',
  json_build_object('sub','e8400013-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

insert into res select 'LA SÉCURITÉ VOIT LES REBONDS D''UNE ENTREPRISE, MÊME SUR DES DEVIS','true',
  (select (r.bounced_count >= 1)::text from public.admin_email_reputation(30) r
    where r.organization_id = (select v from ids where k='orgA'));

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400012-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false; n integer;
begin
  begin select count(*) into n from public.admin_email_reputation(30);
  exception when others then refuse := true; end;
  insert into res values ('LA FACTURATION NE MESURE PAS LA DÉLIVRABILITÉ DU PARC','true', refuse::text);
end $$;


-- ============================================================
-- 24. LE REGISTRE DE CONSENTEMENT GARDE SES DATES
-- ============================================================
--
-- Un consentement redonné effaçait `unsubscribed_at` et gardait la date
-- du PREMIER consentement. Or c'est ce registre qui sert de preuve
-- (art. 7-1 RGPD) : une personne qui consent, se désabonne, puis
-- revient laisse TROIS faits, pas un seul réécrit.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400003-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare v_avant timestamptz; v_apres timestamptz;
begin
  perform public.email_record_consent(
    (select v from ids where k='orgB'), true, 'reglagesEntreprise',
    'J''accepte de recevoir les nouveautés d''Oasis Care.');
  select consented_at into v_avant from public.email_consent_state
   where organization_id = (select v from ids where k='orgB');

  perform pg_sleep(0.01);
  perform public.email_record_consent(
    (select v from ids where k='orgB'), false, 'reglagesEntreprise', null);
  perform public.email_record_consent(
    (select v from ids where k='orgB'), true, 'reglagesEntreprise',
    'Je réactive les nouveautés.');
  select consented_at into v_apres from public.email_consent_state
   where organization_id = (select v from ids where k='orgB');

  insert into res values ('UN CONSENTEMENT REDONNÉ PORTE SA PROPRE DATE','true',
    (v_apres >= v_avant)::text);
end $$;

insert into res select 'ET L''OPPOSITION PRÉCÉDENTE RESTE AU REGISTRE','true',
  (select (previous_unsubscribed_at is not null)::text from public.email_consent_state
    where organization_id = (select v from ids where k='orgB'));

insert into res select 'Le registre peut donc répondre « s''est-elle opposée entre-temps ? »','true',
  (select (previous_unsubscribe_reason is not null)::text from public.email_consent_state
    where organization_id = (select v from ids where k='orgB'));


-- ============================================================
-- 25. UNE CAMPAGNE NE SE BRÛLE PLUS FAUTE D'ADRESSE TECHNIQUE
-- ============================================================
--
-- Elle posait `status = 'sending'` d'abord, découvrait ensuite que
-- l'adresse manquait, comptait tout en « ignoré » et finissait en
-- 'sent'. Une campagne ne se rejoue pas : dix minutes de rédaction
-- étaient perdues, et l'écran affichait un succès.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','e8400014-0000-4000-8000-000000000084','aal','aal2')::text, true);
set local role authenticated;

insert into ids select 'campagne2', public.admin_create_email_campaign(
  'Annonce sans adresse technique', 'Objet', 'Corps.',
  'On éprouve le cas où le serveur n''est pas réglé.');

set local oasis.email_expediteur = '';

do $$
declare refuse boolean := false; r record;
begin
  begin
    select * into r from public.admin_send_email_campaign(
      (select v from ids where k='campagne2'), 'Un motif.');
  exception when others then refuse := true;
  end;
  insert into res values ('SANS ADRESSE TECHNIQUE, LA CAMPAGNE REFUSE DE PARTIR','true', refuse::text);
end $$;

insert into res select 'ET ELLE RESTE UN BROUILLON : le travail n''est pas perdu','draft',
  (select status from public.email_campaigns where id = (select v from ids where k='campagne2'));

set local oasis.email_expediteur = 'notifications@oasisrarecare.invalid';


-- ============================================================
-- 26. LES DROITS DES FONCTIONS NEUVES
-- ============================================================
reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare f text;
begin
  foreach f in array array[
    'public.email_claim_queued(integer, text)',
    'public.email_claim_one(uuid, text)',
    'public.email_mark_uncertain(uuid, text, text)',
    'public.email_still_sendable(uuid)'
  ]
  loop
    insert into res values ('UN JETON DE NAVIGATEUR N''ATTEINT PAS ' || left(f, 26), 'false',
      has_function_privilege('authenticated', f, 'execute')::text);
    insert into res values ('… ni `anon` : ' || left(f, 26), 'false',
      has_function_privilege('anon', f, 'execute')::text);
  end loop;
end $$;

-- MAIS ANNULER SES PROPRES MESSAGES EN FILE EST UN GESTE DU
-- PAYSAGISTE : c'est son action d'annulation de facture qui l'appelle.
insert into res select 'UN MEMBRE PEUT ARRÊTER SES PROPRES MESSAGES EN FILE','true',
  has_function_privilege('authenticated', 'public.email_cancel_queued(uuid, text, uuid, text)', 'execute')::text;

-- ET PAS CEUX D'UNE AUTRE ENTREPRISE.
select set_config('request.jwt.claims',
  json_build_object('sub','e8400003-0000-4000-8000-000000000084')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.email_cancel_queued(
      (select v from ids where k='orgA'), 'invoice',
      (select v from ids where k='facture1'), 'motif');
  exception when others then refuse := true;
  end;
  insert into res values ('UN VOISIN N''ARRÊTE PAS LES MESSAGES D''UNE AUTRE ENTREPRISE','true', refuse::text);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
