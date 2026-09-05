-- Oasis Care — OASIS CONTROL CENTER, jalon 2 (migration 0081).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LA SÉPARATION FORTE TIENT ENCORE (spec p.32). Ce fichier ajoute
--      une trentaine de fonctions d'écriture ; chacune est une porte
--      neuve. Un utilisateur ordinaire et un OWNER d'entreprise Pro
--      n'obtiennent RIEN d'aucune d'entre elles — et elles LÈVENT, elles
--      ne rendent pas un succès silencieux.
--
--   2. LE MOINDRE PRIVILÈGE, SUR LE VOCABULAIRE NEUF. 0080 avait étendu
--      le garde-fou de la matrice à `ai.%` ; il ignorait toujours
--      `platform.%`, si bien que le droit de NOMMER DES ADMINISTRATEURS
--      pouvait être accordé à n'importe quel rôle. Le test refait le
--      sondage qui l'a révélé, et échoue si la barrière saute.
--
--   3. ON NE SE VERROUILLE PAS DEHORS. On ne se révoque pas soi-même, et
--      le dernier super-administrateur actif ne peut être ni révoqué ni
--      rétrogradé. Testé sur les fonctions ET sur le déclencheur —
--      celui-ci protège aussi l'`update` tapé à la main dans l'éditeur
--      SQL.
--
--   4. UNE SESSION D'ASSISTANCE EXPIRE, ET L'EXPIRATION EST VÉRIFIÉE EN
--      BASE. C'est le point le plus sensible du jalon : la bannière
--      « expire dans 18 min » est un affichage, pas une sécurité.
--
--   5. LA FACTURE. Numérotation séquentielle sans trou et sans doublon,
--      brouillon abandonné qui ne consomme rien, facture émise
--      immuable, TVA inconnue qui BLOQUE au lieu de supposer 20 %,
--      génération idempotente.
--
--   6. LA MATRICE OFFRE × MODULE. Un module inclus ne produit AUCUNE
--      ligne de facture ; le même module en option en produit une ; et
--      passer de Pro à Pro Business cesse de le facturer sans qu'on
--      touche à quoi que ce soit.
--
--   7. LES GRANT PAR DÉFAUT DE SUPABASE N'ONT RIEN ROUVERT. C'est là que
--      0055 s'est fait avoir, et c'est vérifié par requête.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste — ni les comptes, ni les entreprises, ni
-- les administrateurs, ni les factures, ni le numéro qu'elles ont
-- consommé.
--
-- Pour le rejouer : coller ce fichier dans l'éditeur SQL Supabase APRÈS
-- 0081, ou l'envoyer à l'API Management.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table att(k text, v text) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on att to authenticated;

-- ============================================================
-- Fixtures
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('cc810001-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-normal@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810002-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-owner@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810003-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-owner2@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810010-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-super@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810011-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-support@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810012-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-billing@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810013-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-security@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810014-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-invite@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc810015-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s2-fondateur@test.invalid','',now(),now(),now(),now(),'{}','{}');

-- Trois entreprises Pro. A est française et complètement identifiée : on
-- pourra lui facturer. B est belge sans numéro de TVA validé : c'est
-- elle qui doit rendre le régime INCONNU.
--
-- F EST LE CLIENT FONDATEUR, et elle existe pour une raison de fond :
-- le tarif fondateur est RÉSERVÉ à l'offre Pro, et A monte en gamme vers
-- Pro Business au § 8 pour éprouver la matrice offre × module. Les deux
-- rôles sont devenus incompatibles le jour où la remise a reçu sa
-- restriction d'offre — ce qui est exactement ce que cette restriction
-- doit produire. Son nom la place APRÈS A dans l'ordre alphabétique, et
-- ce détail compte : `saas_generate_invoices` parcourt les entreprises
-- `order by o.name`, et le § 11 vérifie que c'est A qui reçoit le
-- troisième numéro de la séquence.
select set_config('request.jwt.claims',
  json_build_object('sub','cc810002-0000-4000-8000-000000000081')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages Suite A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810003-0000-4000-8000-000000000081')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages Suite B','landscaper');

update public.business_organizations
   set legal_name = 'SARL Suite A', siret = '111 222 333 00044',
       address_line1 = '1 rue du Test', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@suite-a.test'
 where id = (select v from ids where k='orgA');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810015-0000-4000-8000-000000000081')::text, true);
insert into ids select 'orgF', public.create_professional_organization('Paysages Suite F','landscaper');

update public.business_organizations
   set legal_name = 'BVBA Suite B', country = 'BE',
       address_line1 = 'Teststraat 2', postal_code = '1000', city = 'Bruxelles'
 where id = (select v from ids where k='orgB');

update public.business_organizations
   set legal_name = 'SARL Suite F', siret = '555 666 777 00088',
       address_line1 = '5 rue du Fondateur', postal_code = '44000', city = 'Nantes',
       country = 'FR', email = 'compta@suite-f.test'
 where id = (select v from ids where k='orgF');

-- Les administrateurs de plateforme. Posés en `postgres` : c'est le seul
-- chemin qui existe, et c'est le sujet du test « personne ne
-- s'auto-promeut ».
insert into public.platform_admins (user_id, role, note) values
 ('cc810010-0000-4000-8000-000000000081','super_admin','Test suite'),
 ('cc810011-0000-4000-8000-000000000081','support','Test suite'),
 ('cc810012-0000-4000-8000-000000000081','billing_admin','Test suite'),
 ('cc810013-0000-4000-8000-000000000081','security_admin','Test suite');

-- LES ADMINISTRATEURS RÉELS DE LA BASE SONT MIS DE CÔTÉ, dans la
-- transaction uniquement. Sans cela, le super-administrateur de
-- production compterait comme un second, et le test « le DERNIER
-- super-administrateur ne peut pas être révoqué » passerait au vert en
-- révoquant simplement le nôtre. L'ordre compte : on insère d'abord le
-- nôtre, sinon le déclencheur refuserait de laisser la base sans aucun
-- super-administrateur actif.
update public.platform_admins
   set is_active = false, revoked_at = now()
 where user_id not in (
   'cc810010-0000-4000-8000-000000000081','cc810011-0000-4000-8000-000000000081',
   'cc810012-0000-4000-8000-000000000081','cc810013-0000-4000-8000-000000000081')
   and is_active;

insert into att values
 ('annee', extract(year from current_date)::text);

-- ============================================================
-- 1. LA SÉPARATION FORTE — l'utilisateur ORDINAIRE
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','cc810001-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select public.admin_set_plan_pricing(''team'', 100, 1000, ''essai'')',
    'select public.admin_set_plan_module(''team'', ''biolab'', ''included'', null, null, ''essai'')',
    'select public.admin_grant_platform_admin(''cc810001-0000-4000-8000-000000000081'', ''super_admin'', ''essai'')',
    'select public.admin_revoke_platform_admin(''cc810010-0000-4000-8000-000000000081'', ''essai'')',
    'select public.admin_invite_platform_admin(''pirate@test.invalid'', ''super_admin'', ''essai'')',
    'select public.admin_set_mfa_policy(false, null, ''essai'')',
    'select public.admin_set_feature_flag(''aiDiagnosisEnabled'', false, ''essai'')',
    'select public.admin_set_billing_issuer(''{"siret":"x"}''::jsonb, ''essai'')',
    'select public.admin_start_support_session(''diagnostics'', ''essai'', null, ''cc810002-0000-4000-8000-000000000081'')',
    'select public.admin_create_subscription(''00000000-0000-0000-0000-000000000000'', ''team'', ''monthly'', ''essai'')',
    'select * from public.saas_generate_invoices(''monthly'', current_date, current_date + 30, ''essai'')',
    'select * from public.platform_admin_mfa_state()',
    'select * from public.admin_list_platform_admins()'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('Utilisateur ordinaire — « ' || left(f, 58) || '… » lève', 'true', refuse::text);
  end loop;
end $$;

-- Et il ne peut pas non plus écrire directement dans les tables neuves.
do $$
declare
  t text;
  refuse boolean;
begin
  foreach t in array array[
    'insert into public.organization_plans (key, name) values (''pirate'', ''Pirate'')',
    'update public.organization_plans set monthly_price_cents = 1 where key = ''team''',
    'insert into public.plan_modules (plan_key, module_key, availability) values (''team'', ''biolab'', ''included'')',
    'insert into public.saas_invoices (organization_id, period_start, period_end) values (''00000000-0000-0000-0000-000000000000'', current_date, current_date + 1)',
    'insert into public.support_sessions (admin_user_id, admin_role, customer_user_id, reason, access_level, expires_at) values (auth.uid(), ''super_admin'', auth.uid(), ''x'', ''diagnostics'', now() + interval ''1 hour'')',
    'insert into public.support_access_log (session_id, resource) values (gen_random_uuid(), ''plants'')',
    'update public.platform_security_settings set mfa_required = false',
    'insert into public.platform_admin_invitations (email, role, invited_by_role, reason, expires_at) values (''p@x.test'', ''super_admin'', ''super_admin'', ''x'', now() + interval ''1 day'')'
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

-- ============================================================
-- 2. LA SÉPARATION FORTE — l'OWNER d'entreprise Pro (spec p.36)
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810002-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into res select 'Le propriétaire a tous les droits dans SON entreprise','true',
  public.has_permission((select v from ids where k='orgA'), 'organization.manageUsers')::text;

insert into res select 'Un owner d''entreprise Pro n''est PAS administrateur Oasis Care','false',
  public.is_platform_admin()::text;

-- LA FAILLE DE 0060, REFERMÉE. C'est le test le plus important de ce
-- paragraphe : avant 0081, la politique « Admins change their
-- subscription » était en `cmd = ALL` sur `organization.manageUsers`, et
-- ce propriétaire pouvait s'attribuer l'offre la plus chère sans payer.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.organization_subscriptions (organization_id, plan, status)
    values ((select v from ids where k='orgA'), 'business', 'active');
  exception when others then refuse := true;
  end;
  insert into res values ('UN CLIENT NE S''ATTRIBUE PLUS SON PROPRE ABONNEMENT','true',refuse::text);
end $$;

insert into res select 'La politique d''écriture de 0060 a bien disparu','0',
  (select count(*)::text from pg_policies
    where schemaname='public' and tablename='organization_subscriptions' and cmd <> 'SELECT');

insert into res select 'Le client continue de LIRE son abonnement (politique conservée)','1',
  (select count(*)::text from pg_policies
    where schemaname='public' and tablename='organization_subscriptions'
      and policyname = 'Members read their subscription');

-- ============================================================
-- 3. LE MOINDRE PRIVILÈGE SUR LE VOCABULAIRE NEUF
-- ============================================================
reset role;

-- 3.a Ce que la matrice DIT.
insert into res select 'SUPPORT NE NOMME PAS D''ADMINISTRATEUR','false',
  (select exists (select 1 from public.platform_admin_role_permissions
                   where role='support' and permission='platform.admins.manage'))::text;
insert into res select 'SÉCURITÉ NON PLUS','false',
  (select exists (select 1 from public.platform_admin_role_permissions
                   where role='security_admin' and permission='platform.admins.manage'))::text;
insert into res select 'Un seul rôle nomme les administrateurs','super_admin',
  (select string_agg(role, ', ' order by role) from public.platform_admin_role_permissions
    where permission = 'platform.admins.manage');
insert into res select 'Un seul rôle modifie l''identité légale de l''émetteur','super_admin',
  (select string_agg(role, ', ' order by role) from public.platform_admin_role_permissions
    where permission = 'billing.issuer.write');
insert into res select 'SUPPORT N''ÉCRIT PAS SUR LA FACTURATION','false',
  (select exists (select 1 from public.platform_admin_role_permissions
                   where role='support' and permission like 'billing.%' and permission like '%.write'))::text;
insert into res select 'Le super-administrateur porte tout le catalogue','0',
  (select count(*)::text from public.platform_admin_permissions p
    where not exists (select 1 from public.platform_admin_role_permissions rp
                       where rp.role = 'super_admin' and rp.permission = p.key));

-- 3.b Ce que la base REFUSE d'y écrire. C'EST LE TEST QUI COMPTE : une
-- absence peut être comblée par distraction, un refus doit être
-- supprimé exprès. Le sondage qui a révélé le trou est refait ici.
do $$
declare
  c record;
  refuse boolean;
begin
  for c in select * from (values
    ('support','platform.admins.manage'),
    ('security_admin','platform.admins.manage'),
    ('billing_admin','platform.admins.manage'),
    ('product_admin','platform.admins.manage'),
    ('support','platform.security.write'),
    ('security_admin','billing.plans.write'),
    ('security_admin','billing.invoices.write'),
    ('billing_admin','billing.issuer.write'),
    ('support','billing.invoices.write'),
    ('security_admin','support.tickets.write'),
    ('billing_admin','support.sessions.manage'),
    ('billing_admin','product.flags.write'),
    ('read_only_analyst','support.sessions.manage'),
    ('read_only_analyst','product.flags.write')
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

-- Et il laisse passer ce qui est légitime : un garde-fou qui refuse tout
-- ne protège rien, il casse.
do $$
declare
  c record;
  passe boolean;
begin
  for c in select * from (values
    ('billing_admin','billing.plans.write'),
    ('billing_admin','billing.invoices.write'),
    ('support','support.tickets.write'),
    ('support','support.sessions.manage'),
    ('product_admin','product.flags.write'),
    ('security_admin','platform.security.write'),
    ('super_admin','billing.issuer.write')
  ) t(r, pm)
  loop
    passe := true;
    begin
      insert into public.platform_admin_role_permissions (role, permission) values (c.r, c.pm)
        on conflict do nothing;
    exception when others then passe := false;
    end;
    insert into res values ('Le garde-fou accepte « ' || c.r || ' ← ' || c.pm || ' »', 'true', passe::text);
  end loop;
end $$;

-- ============================================================
-- 4. LE SUPPORT NE TOUCHE NI AUX ADMINISTRATEURS NI AUX ABONNEMENTS
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into res select 'Le support est bien administrateur de plateforme','true',
  public.is_platform_admin()::text;
insert into res select 'Le support conduit l''assistance','true',
  public.platform_admin_can('support.sessions.manage')::text;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select public.admin_grant_platform_admin(''cc810001-0000-4000-8000-000000000081'', ''support'', ''essai'')',
    'select public.admin_change_platform_admin_role(''cc810012-0000-4000-8000-000000000081'', ''super_admin'', ''essai'')',
    'select public.admin_revoke_platform_admin(''cc810012-0000-4000-8000-000000000081'', ''essai'')',
    'select public.admin_invite_platform_admin(''x@test.invalid'', ''support'', ''essai'')',
    'select public.admin_set_plan_pricing(''team'', 100, 1000, ''essai'')',
    'select public.admin_set_subscription_plan(''00000000-0000-0000-0000-000000000000'', ''business'', ''essai'')',
    'select public.admin_grant_credit(''00000000-0000-0000-0000-000000000000'', 1000, ''essai'')',
    'select public.admin_set_mfa_policy(true, null, ''essai'')',
    'select public.admin_set_feature_flag(''aiDiagnosisEnabled'', false, ''essai'')'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('SUPPORT — « ' || left(f, 56) || '… » lève', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 5. L'ÉQUIPE OASIS CARE
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

do $$
declare v_evt uuid;
begin
  v_evt := public.admin_grant_platform_admin(
    'cc810001-0000-4000-8000-000000000081', 'support',
    'Nouveau salarié Oasis Care, poste support.');

  insert into res values ('Le super-administrateur nomme un administrateur', 'support',
    (select pa.role from public.platform_admins pa
      where pa.user_id = 'cc810001-0000-4000-8000-000000000081'));

  insert into res values ('La nomination laisse une trace', 'platformAdmin.created',
    (select action from public.admin_audit_events where id = v_evt));

  insert into res values ('Et le journal nomme la cible', 's2-normal@test.invalid',
    (select target_label from public.admin_audit_events where id = v_evt));

  perform public.admin_change_platform_admin_role(
    'cc810001-0000-4000-8000-000000000081', 'billing_admin', 'Réaffectation interne.');

  insert into res values ('Le changement de rôle fonctionne', 'billing_admin',
    (select pa.role from public.platform_admins pa
      where pa.user_id = 'cc810001-0000-4000-8000-000000000081'));
end $$;

-- ON NE SE RÉVOQUE PAS SOI-MÊME.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_revoke_platform_admin(
      'cc810010-0000-4000-8000-000000000081', 'Je pars.');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE SE RÉVOQUE PAS SOI-MÊME','true',refuse::text);
end $$;

-- LE DERNIER SUPER-ADMINISTRATEUR ACTIF NE SE RÉTROGRADE PAS.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_change_platform_admin_role(
      'cc810010-0000-4000-8000-000000000081', 'support', 'Rétrogradation.');
  exception when others then refuse := true;
  end;
  insert into res values ('LE DERNIER SUPER-ADMINISTRATEUR NE SE RÉTROGRADE PAS','true',refuse::text);
end $$;

insert into res select 'Il reste bien un seul super-administrateur actif','1',
  (select count(*)::text from public.platform_admins
    where role='super_admin' and is_active and revoked_at is null);

-- Et le DÉCLENCHEUR tient aussi quand on contourne les fonctions :
-- c'est l'`update` tapé à la main dans l'éditeur SQL.
reset role;
do $$
declare refuse boolean := false;
begin
  begin
    update public.platform_admins set is_active = false, revoked_at = now()
     where user_id = 'cc810010-0000-4000-8000-000000000081';
  exception when others then refuse := true;
  end;
  insert into res values ('Le déclencheur refuse aussi l''update à la main','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    delete from public.platform_admins where user_id = 'cc810010-0000-4000-8000-000000000081';
  exception when others then refuse := true;
  end;
  insert into res values ('Ni la suppression du dernier super-administrateur','true',refuse::text);
end $$;

-- LA RÉVOCATION D'UN AUTRE, elle, doit marcher — sinon les trois refus
-- ci-dessus ne prouveraient rien de plus qu'une fonction cassée.
do $$
declare v_evt uuid;
begin
  v_evt := public.admin_revoke_platform_admin(
    'cc810001-0000-4000-8000-000000000081', 'Fin de contrat.');

  insert into res values ('On révoque bien QUELQU''UN D''AUTRE', 'false',
    (select is_active::text from public.platform_admins
      where user_id = 'cc810001-0000-4000-8000-000000000081'));

  insert into res values ('Et la révocation DATE le retrait, au lieu de simplement l''éteindre', 'true',
    (select (revoked_at is not null)::text from public.platform_admins
      where user_id = 'cc810001-0000-4000-8000-000000000081'));

  insert into res values ('Elle laisse une trace', 'platformAdmin.revoked',
    (select action from public.admin_audit_events where id = v_evt));
end $$;

-- On efface la fiche : la suite du test se sert de ce compte comme d'un
-- client ordinaire, et un administrateur révoqué reste une ligne de
-- `platform_admins`.
delete from public.platform_admins where user_id = 'cc810001-0000-4000-8000-000000000081';

-- Une invitation retirée avant d'être acceptée.
do $$
begin
  perform public.admin_invite_platform_admin(
    's2-jamais@test.invalid', 'support', 'Recrutement finalement annulé.');
  perform public.admin_revoke_platform_admin_invitation(
    's2-jamais@test.invalid', 'Le candidat s''est désisté.');
  insert into res values ('Une invitation se retire avant d''être acceptée', 'true',
    (select (revoked_at is not null)::text from public.platform_admin_invitations
      where email = 's2-jamais@test.invalid'));
end $$;

-- L'INVITATION d'un collègue sans compte : on enregistre l'intention, il
-- la réclame lui-même une fois son adresse confirmée.
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_invite_platform_admin(
      's2-owner@test.invalid', 'support', 'Essai : cette adresse a déjà un compte.');
  exception when others then refuse := true;
  end;
  insert into res values ('Inviter une adresse qui a déjà un compte est refusé (on la nomme directement)','true',refuse::text);
end $$;

do $$
begin
  perform public.admin_invite_platform_admin(
    's2-nouveau@test.invalid', 'support', 'Recrutement support, arrive lundi.');

  insert into res values ('Une invitation s''enregistre', 'support',
    (select i.role from public.platform_admin_invitations i
      where i.email = 's2-nouveau@test.invalid'));

  insert into res values ('Une invitation EXPIRE', 'true',
    (select (expires_at > now() and expires_at < now() + interval '30 days')::text
       from public.platform_admin_invitations where email = 's2-nouveau@test.invalid'));
end $$;

-- Le compte cc810014 a l'adresse s2-invite@test.invalid : on l'invite,
-- puis il réclame. Le rôle vient de l'INVITATION, jamais du réclamant.
reset role;
delete from public.platform_admin_invitations where email = 's2-invite@test.invalid';
insert into public.platform_admin_invitations
  (email, role, invited_by, invited_by_role, reason, expires_at)
values ('s2-invite@test.invalid', 'product_admin',
        'cc810010-0000-4000-8000-000000000081', 'super_admin',
        'Recrutement produit.', now() + interval '14 days');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810014-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into res select 'L''invité réclame son invitation et reçoit LE RÔLE DE L''INVITATION','product_admin',
  public.claim_platform_admin_invitation();

reset role;
insert into res select 'La ligne de journal est signée par L''INVITEUR, pas par l''invité',
  'cc810010-0000-4000-8000-000000000081',
  (select admin_user_id::text from public.admin_audit_events
    where action = 'platformAdmin.invitationAccepted'
      and target_id = 'cc810014-0000-4000-8000-000000000081');

-- ============================================================
-- 6. LE SECOND FACTEUR
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into res select 'Par défaut, le second facteur n''est pas exigé','false',
  (select policy_required::text from public.platform_admin_mfa_state());
insert into res select 'Et l''administrateur n''a aucun facteur vérifié','0',
  (select verified_factors::text from public.platform_admin_mfa_state());

-- On l'exige. Le super-administrateur n'a pas de facteur : ses ÉCRITURES
-- doivent se fermer, sa LECTURE doit rester ouverte — sinon il est
-- enfermé dehors et ne peut plus s'enrôler.
select public.admin_set_mfa_policy(true, null, 'Durcissement de la sécurité administrative.');

insert into res select 'L''exigence est en vigueur','true',
  (select policy_in_force::text from public.platform_admin_mfa_state());
insert into res select 'Les écritures sont bloquées','true',
  (select writes_blocked::text from public.platform_admin_mfa_state());

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_set_plan_pricing('team', 7990, 79900, 'Essai sous exigence de second facteur.');
  exception when others then refuse := true;
  end;
  insert into res values ('Sans second facteur, une écriture administrative est refusée','true',refuse::text);
end $$;

-- LA LECTURE RESTE OUVERTE : c'est la règle qu'on ne doit pas enfreindre.
insert into res select 'MAIS LA LECTURE RESTE OUVERTE — il peut entrer pour s''enrôler','true',
  (select count(*) > 0 from public.admin_list_platform_admins())::text;

insert into res select 'Et le tableau de bord de 0075 reste lisible','true',
  (select count(*) = 1 from public.admin_platform_kpis())::text;

-- Il s'enrôle (le facteur est créé par le service Auth ; on simule son
-- effet) et présente son second facteur : la session passe en `aal2`.
reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), 'cc810010-0000-4000-8000-000000000081', 'Test TOTP',
        'totp'::auth.factor_type, 'verified'::auth.factor_status, now(), now());

select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal1')::text, true);
set local role authenticated;

insert into res select 'Un facteur POSÉ mais NON PRÉSENTÉ (aal1) ne suffit pas','true',
  (select writes_blocked::text from public.platform_admin_mfa_state());

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

insert into res select 'Avec un facteur vérifié ET une session aal2, tout se rouvre','false',
  (select writes_blocked::text from public.platform_admin_mfa_state());

do $$
declare v_evt uuid;
begin
  v_evt := public.admin_set_plan_pricing('team', 7990, 79900, 'Confirmation de la grille.');
  insert into res values ('Et l''écriture repasse', 'plan.pricingChanged',
    (select action from public.admin_audit_events where id = v_evt));
end $$;

-- On remet la politique au repos pour la suite du test.
select public.admin_set_mfa_policy(false, null, 'Retour au repos pour la suite du test.');

-- ============================================================
-- 7. LA GRILLE ET LA MATRICE
-- ============================================================
reset role;

insert into res select 'Les quatre offres ont un prix (ou sont sur devis)','0',
  (select count(*)::text from public.organization_plans
    where is_active and monthly_price_cents is null and not is_quote_only);

insert into res select 'La grille, en centimes','3990/7990/13990',
  (select string_agg(monthly_price_cents::text, '/' order by position)
     from public.organization_plans where key in ('solo','team','business'));

insert into res select 'Les prix annuels existent enfin','39900/79900/139900',
  (select string_agg(yearly_price_cents::text, '/' order by position)
     from public.organization_plans where key in ('solo','team','business'));

insert into res select 'Pro porte le badge best-seller','bestSeller',
  (select badge from public.organization_plans where key = 'team');

insert into res select 'Enterprise est sur devis, avec un plancher et AUCUN prix public','true',
  (select (is_quote_only and price_floor_cents = 24900
           and monthly_price_cents is null and yearly_price_cents is null)::text
     from public.organization_plans where key = 'enterprise');

-- UNE OFFRE SUR DEVIS N'A PAS DE PRIX PUBLIC — et la base le refuse.
do $$
declare refuse boolean := false;
begin
  begin
    update public.organization_plans set monthly_price_cents = 24900 where key = 'enterprise';
  exception when others then refuse := true;
  end;
  insert into res values ('On ne pose pas de prix public sur une offre sur devis','true',refuse::text);
end $$;

-- LA MATRICE. Le même module inclus ici, payant là.
insert into res select 'BioLab est INCLUS dans Pro Business','included',
  (select availability from public.plan_module_terms('business','biolab'));
insert into res select 'BioLab est EN OPTION sur Pro, à 20 €','optional/2000',
  (select availability || '/' || monthly_price_cents::text from public.plan_module_terms('team','biolab'));
insert into res select 'Pépinière suit la même règle','included/optional',
  (select (select availability from public.plan_module_terms('business','nursery')) || '/' ||
          (select availability from public.plan_module_terms('team','nursery')));

-- LES CASES NON DÉCIDÉES SONT EXPLICITES, pas vides.
insert into res select 'Pro Solo × BioLab est NON DÉCIDÉ, explicitement','undecided',
  (select availability from public.plan_module_terms('solo','biolab'));
insert into res select 'Enterprise × Pépinière aussi','undecided',
  (select availability from public.plan_module_terms('enterprise','nursery'));
insert into res select 'Aucune case de la matrice ne manque','0',
  (select count(*)::text from public.organization_plans p
   cross join public.platform_modules m
   where not exists (select 1 from public.plan_modules pm
                      where pm.plan_key = p.key and pm.module_key = m.key));

-- LE JARDIN CONNECTÉ N'EST PAS UN MODULE. Il est entier dans Pro.
insert into res select 'LE JARDIN CONNECTÉ N''EST PAS UN MODULE FACTURABLE','0',
  (select count(*)::text from public.platform_modules
    where key ilike '%garden%' or key ilike '%jardin%' or key ilike '%twin%'
       or key ilike '%sensor%' or key ilike '%capteur%');

-- Une case « en option » sans prix est refusée par la base.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.plan_modules (plan_key, module_key, availability)
    values ('enterprise', 'biolab', 'optional')
    on conflict (plan_key, module_key) do update set availability = 'optional',
      monthly_price_cents = null, metered_unit_price_cents = null;
  exception when others then refuse := true;
  end;
  insert into res values ('Une case « en option » sans prix est refusée','true',refuse::text);
end $$;

-- ============================================================
-- 8. L'ABONNEMENT, LES MODULES, LA REMISE DATÉE
-- ============================================================
-- En `postgres`, avec le jeton du responsable facturation : les
-- fonctions contrôlent `auth.uid()`, pas le rôle Postgres, donc les
-- permissions mordent pareil. Le rôle sert seulement à RELIRE
-- directement `organization_subscriptions`, dont la RLS ne rend rien à
-- un administrateur de plateforme — il n'est membre d'aucune entreprise.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081')::text, true);

-- ATTENTION AU PIÈGE, ET IL A MORDU EN ÉCRIVANT CE TEST : on ne peut
-- pas appeler une fonction d'écriture depuis le `where` d'une lecture de
-- `admin_audit_events`. Le responsable facturation n'a pas
-- `platform.audit.read` — la RLS lui rend zéro ligne, le `where` n'est
-- donc jamais évalué, et la fonction n'est jamais appelée. Le test
-- passait au vert sans rien avoir fait. D'où les blocs `do` : l'écriture
-- d'abord, la vérification ensuite.
do $$
declare v_evt uuid;
begin
  v_evt := public.admin_create_subscription(
    (select v from ids where k='orgA'), 'team', 'monthly',
    'Premier client Pro, contrat signé.', 'active');
  insert into res values ('La facturation crée un abonnement à la main', 'team',
    (select plan from public.organization_subscriptions
      where organization_id = (select v from ids where k='orgA')));
  insert into res values ('Et l''abonnement porte enfin un CYCLE', 'monthly',
    (select billing_cycle from public.organization_subscriptions
      where organization_id = (select v from ids where k='orgA')));
end $$;

insert into res select 'Rien ne l''a créé automatiquement : le fournisseur dit « manual »','manual',
  (select provider from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgA'));

-- UNE OFFRE SUR DEVIS NE SE SOUSCRIT PAS SANS PRIX NÉGOCIÉ.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_create_subscription(
      (select v from ids where k='orgB'), 'enterprise', 'monthly', 'Essai sans prix négocié.', 'active');
  exception when others then refuse := true;
  end;
  insert into res values ('Une offre SUR DEVIS ne se souscrit pas sans prix négocié','true',refuse::text);
end $$;

-- Le module BioLab en option sur Pro : une ligne de 20 €.
select public.admin_set_subscription_module(
  (select v from ids where k='orgA'), 'biolab', true, 'Le client a demandé BioLab.');

insert into res select 'Sur Pro, le module BioLab produit une ligne de 20 €','2000',
  (select unit_price_cents::text from public.saas_subscription_billing_lines(
     (select v from ids where k='orgA'), date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month')::date)
   where kind = 'module');

insert into res select 'Et l''offre elle-même, 79,90 €','7990',
  (select unit_price_cents::text from public.saas_subscription_billing_lines(
     (select v from ids where k='orgA'), date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month')::date)
   where kind = 'plan');

-- LE CŒUR DE LA MATRICE : on passe à Pro Business, BioLab devient
-- compris, et il CESSE d'être facturé — sans qu'on touche à la ligne
-- d'abonnement au module.
select public.admin_set_subscription_plan(
  (select v from ids where k='orgA'), 'business', 'Montée en gamme, contrat renégocié.');

insert into res select 'Le module reste souscrit après le changement d''offre','1',
  (select count(*)::text from public.organization_subscription_modules
    where organization_id = (select v from ids where k='orgA')
      and module_key = 'biolab' and cancelled_at is null);

insert into res select 'MAIS IL N''EST PLUS FACTURÉ : inclus dans Pro Business','0',
  (select count(*)::text from public.saas_subscription_billing_lines(
     (select v from ids where k='orgA'), date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month')::date)
   where kind = 'module');

insert into res select 'Et la ligne d''offre suit le nouveau tarif','13990',
  (select unit_price_cents::text from public.saas_subscription_billing_lines(
     (select v from ids where k='orgA'), date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month')::date)
   where kind = 'plan');

-- ET LE REFUS SYMÉTRIQUE : redescendre vers une offre dont la case n'est
-- pas décidée est bloqué, plutôt que de laisser un module qu'on ne sait
-- ni facturer ni retirer.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_set_subscription_plan(
      (select v from ids where k='orgA'), 'solo', 'Descente en gamme.');
  exception when others then refuse := true;
  end;
  insert into res values ('Descendre vers une offre dont la case n''est pas décidée est REFUSÉ','true',refuse::text);
end $$;

-- LA REMISE FONDATEUR : datée, avec une fin, réservée à UNE offre, et
-- payée d'un engagement.
select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081')::text, true);

insert into res select 'La remise fondateur dure 12 mois, pas la vie','12',
  (select duration_months::text from public.discount_offers where code = 'FONDATEUR');

insert into res select 'Elle vaut 49,90 € HT, sur l''offre Pro, avec engagement','4990/team/12',
  (select value_cents || '/' || applies_to_plan || '/' || commitment_months
     from public.discount_offers where code = 'FONDATEUR');

-- LES TROIS CHIFFRES QUE L'ÉCRAN DOIT ANNONCER AVANT. Le prix d'APRÈS
-- n'est pas recopié dans le catalogue : il se déduit du tarif public de
-- l'offre visée, ce à quoi sert précisément la restriction d'offre.
insert into res select 'Douze mois à 49,90 €, puis 79,90 € — et la base sait le dire','12/4990/7990/true',
  (select duration_months || '/' || monthly_price_during_cents || '/'
       || monthly_price_after_cents || '/' || requires_commitment
     from public.discount_offer_terms('FONDATEUR'));

insert into res select 'Et rien ne bloque cette annonce','true',
  (select (blocking_reason is null)::text from public.discount_offer_terms('FONDATEUR'));

-- LE REFUS QUI VAUT 90 € PAR MOIS ET PAR CLIENT. orgA est passée en Pro
-- Business (139,90 €) juste au-dessus. Le prix imposé de 49,90 € y
-- resterait 49,90 € : la remise vaudrait 90 € au lieu de 30, et ni la
-- facture ni le MRR ne le signaleraient — tous deux seraient d'accord,
-- et tous deux faux.
do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.admin_apply_discount(
      (select v from ids where k='orgA'), 'FONDATEUR',
      'Tentative de fondateur sur Business.', date '2026-01-01',
      'Texte d''engagement.', '2026-01');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('UNE REMISE FONDATEUR POSÉE SUR PRO BUSINESS EST REFUSÉE','true',refuse::text);
  insert into res values ('Et le refus nomme l''offre à laquelle elle est réservée','true',
    (v_msg like '%Pro%')::text);
end $$;

-- L'abonnement du client fondateur : Pro, au mois. La remise démarre au
-- 1er janvier — c'est la période que la génération de factures du § 10
-- va couvrir, et une remise qui ne couvre pas la période ne produit
-- aucune ligne, ce qui est voulu mais ne testerait rien ici.
do $$
begin
  perform public.admin_create_subscription(
    (select v from ids where k='orgF'), 'team', 'monthly',
    'Client fondateur de la campagne de lancement.', 'active');
end $$;

-- LA PREUVE EST OBLIGATOIRE DÈS QUE L'OFFRE ENGAGE. Sans le texte
-- affiché, la remise n'est pas accordée : une trace qui dirait « a
-- accepté » sans conserver ce qu'il a lu ne vaudrait rien.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_apply_discount(
      (select v from ids where k='orgF'), 'FONDATEUR',
      'Sans texte affiché.', date '2026-01-01');
  exception when others then refuse := true;
  end;
  insert into res values ('UN ENGAGEMENT SANS LE TEXTE AFFICHÉ EST REFUSÉ','true',refuse::text);
end $$;

do $$
declare v_texte text;
begin
  select config_value->>'texte' into v_texte
    from public.commercial_config where config_key = 'billing.commitment.terms';

  perform public.admin_apply_discount(
    (select v from ids where k='orgF'), 'FONDATEUR',
    'Client fondateur, campagne de lancement.', date '2026-01-01',
    v_texte, '2026-01');

  insert into res values ('Appliquée, elle porte une date de fin — jamais « à vie »', 'true',
    (select (d.ends_on = (d.starts_on + interval '12 months')::date)::text
       from public.subscription_discounts d
      where d.organization_id = (select v from ids where k='orgF') and d.cancelled_at is null));

  insert into res values ('Et elle porte la date de fin d''ENGAGEMENT', 'true',
    (select (d.commitment_ends_on = date '2027-01-01')::text
       from public.subscription_discounts d
      where d.organization_id = (select v from ids where k='orgF') and d.cancelled_at is null));

  insert into res values ('La remise POSÉE recopie l''offre visée, elle ne la relit pas au catalogue', 'team',
    (select d.applies_to_plan from public.subscription_discounts d
      where d.organization_id = (select v from ids where k='orgF') and d.cancelled_at is null));

  -- LA PREUVE CONTIENT LE TEXTE, PAS UNE RÉFÉRENCE VERS LUI.
  insert into res values ('L''ACCEPTATION CONSERVE LE TEXTE EXACT AFFICHÉ', 'true',
    (select (a.terms_text = v_texte and length(a.terms_text) > 100)::text
       from public.subscription_commitment_acceptances a
      where a.organization_id = (select v from ids where k='orgF')));

  insert into res values ('Avec sa version, ses douze mois et ses deux prix', '2026-01/12/4990/7990',
    (select a.terms_version || '/' || a.commitment_months || '/'
         || a.monthly_price_during_cents || '/' || a.monthly_price_after_cents
       from public.subscription_commitment_acceptances a
      where a.organization_id = (select v from ids where k='orgF')));
end $$;

-- LE PRIX RÉELLEMENT DÛ, LES DOUZE PREMIERS MOIS PUIS LE TREIZIÈME.
insert into res select 'UN FONDATEUR PRO PAIE 49,90 € PENDANT DOUZE MOIS','4990',
  (select sum(unit_price_cents)::text from public.saas_subscription_billing_lines(
     (select v from ids where k='orgF'), date '2026-01-01', date '2026-02-01')
   where kind in ('plan','discount'));

insert into res select 'ET 79,90 € AU TREIZIÈME, sans que personne n''y touche','7990',
  (select sum(unit_price_cents)::text from public.saas_subscription_billing_lines(
     (select v from ids where k='orgF'), date '2027-01-01', date '2027-02-01')
   where kind in ('plan','discount'));

-- LE VOLET SYMÉTRIQUE, ET C'EST LA VRAIE FUITE : monter en gamme avec
-- la remise sur le dos. `admin_set_subscription_plan` ne lit aucune
-- remise ; c'est le déclencheur qui refuse.
do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.admin_set_subscription_plan(
      (select v from ids where k='orgF'), 'business', 'Montée en gamme du client fondateur.');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('MONTER UN FONDATEUR DE PRO À PRO BUSINESS EST REFUSÉ','true',refuse::text);
  insert into res values ('Et le message dit de retirer la remise d''abord','true',
    (v_msg like '%Retirez-la%')::text);
  insert into res values ('L''offre n''a pas bougé','team',
    (select plan from public.organization_subscriptions
      where organization_id = (select v from ids where k='orgF')));
end $$;

-- BASCULER AU CYCLE ANNUEL SOUS ENGAGEMENT : refusé aussi. Sans cela,
-- on souscrit au mois et on bascule ensuite, et on retombe sur la
-- facture bancale.
do $$
declare refuse boolean := false;
begin
  begin
    update public.organization_subscriptions set billing_cycle = 'yearly'
     where organization_id = (select v from ids where k='orgF');
  exception when others then refuse := true;
  end;
  insert into res values ('BASCULER UN FONDATEUR MENSUEL EN ANNUEL EST REFUSÉ','true',refuse::text);
end $$;

reset role;
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.subscription_discounts
      (organization_id, label, kind, value_cents, starts_on, ends_on, reason)
    values ((select v from ids where k='orgB'), 'À vie', 'fixedMonthlyPrice', 1990,
            current_date, null, 'Essai de remise perpétuelle.');
  exception when others then refuse := true;
  end;
  insert into res values ('UNE REMISE SANS FIN EST IMPOSSIBLE À ENREGISTRER','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.subscription_discounts
      (organization_id, label, kind, value_cents, starts_on, ends_on, reason)
    values ((select v from ids where k='orgF'), 'Doublon', 'fixedMonthlyPrice', 1000,
            current_date, (current_date + 60), 'Essai de cumul.');
  exception when others then refuse := true;
  end;
  insert into res values ('Deux remises qui se chevauchent sont refusées','true',refuse::text);
end $$;

-- UNE REMISE RESTREINTE POSÉE AVANT L'ABONNEMENT SE CONTOURNERAIT EN
-- DEUX GESTES : poser la remise, souscrire Business ensuite. Le
-- déclencheur exige donc que l'abonnement existe déjà.
do $$
declare refuse boolean := false; v_org uuid;
begin
  -- L'entreprise est créée sous le compte de test qui n'est ni
  -- administrateur ni membre d'une autre entreprise : le § 18.b
  -- vérifie que le responsable facturation n'est membre de RIEN, et
  -- créer cette entreprise sous son jeton casserait cette assertion.
  perform set_config('request.jwt.claims',
    json_build_object('sub','cc810015-0000-4000-8000-000000000081')::text, true);
  v_org := public.create_professional_organization('Entreprise sans abonnement','landscaper');
  perform set_config('request.jwt.claims',
    json_build_object('sub','cc810012-0000-4000-8000-000000000081')::text, true);

  begin
    insert into public.subscription_discounts
      (organization_id, label, kind, value_cents, applies_to_plan, starts_on, ends_on, reason)
    values (v_org, 'Fondateur avant l''heure', 'fixedMonthlyPrice', 4990, 'team',
            current_date, (current_date + 60), 'Essai de contournement.');
  exception when others then refuse := true;
  end;
  insert into res values ('UNE REMISE RESTREINTE NE SE POSE PAS AVANT L''ABONNEMENT','true',refuse::text);
  delete from public.business_organizations where id = v_org;
end $$;

-- UN PRIX MENSUEL IMPOSÉ N'A DE SENS QUE FACE À UN TARIF PUBLIC.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.discount_offers
      (code, label, kind, value_cents, duration_months, applies_to_plan)
    values ('TEST-DEVIS', 'Prix imposé sur une offre sur devis', 'fixedMonthlyPrice',
            9900, 12, 'enterprise');
  exception when others then refuse := true;
  end;
  insert into res values ('Un prix imposé sur une offre SUR DEVIS est refusé','true',refuse::text);
end $$;

-- ============================================================
-- 9. LA TVA — ce qu'on refuse de deviner
-- ============================================================
insert into res select 'Une entreprise française : régime français, taux 20','france/20.00',
  (select regime || '/' || rate::text from public.saas_vat_regime((select v from ids where k='orgA')));

insert into res select 'UNE ENTREPRISE DE L''UNION SANS NUMÉRO VALIDÉ : INCONNU, jamais 20 %','unknown',
  (select regime from public.saas_vat_regime((select v from ids where k='orgB')));

insert into res select 'Et le motif est écrit, pas deviné','true',
  (select (reason is not null and length(reason) > 40)::text
     from public.saas_vat_regime((select v from ids where k='orgB')));

update public.business_organizations set country = 'CH', vat_number = null
 where id = (select v from ids where k='orgB');
insert into res select 'Hors Union : hors champ, 0 %','outsideEu/0',
  (select regime || '/' || rate::text from public.saas_vat_regime((select v from ids where k='orgB')));

update public.business_organizations set country = 'BE', vat_number = 'BE0123456789'
 where id = (select v from ids where k='orgB');
insert into public.saas_customer_tax_profiles
  (organization_id, is_vat_registered, vat_number_validated_at, validation_source)
values ((select v from ids where k='orgB'), true, now(), 'vies');
insert into res select 'Union avec numéro VALIDÉ : autoliquidation, 0 %','euReverseCharge/0',
  (select regime || '/' || rate::text from public.saas_vat_regime((select v from ids where k='orgB')));

-- ============================================================
-- 10. LA FACTURE
-- ============================================================
-- CE PARAGRAPHE TOURNE EN `postgres`, avec le jeton du responsable
-- facturation. Ce n'est pas un relâchement : les contrôles de
-- permission de ces fonctions lisent `auth.uid()`, qui vient du jeton et
-- non du rôle Postgres — ils mordent donc exactement pareil. Le rôle
-- `postgres` n'est nécessaire que pour POSER les brouillons à la main,
-- ce qu'`authenticated` ne peut pas faire (et le § 15 le vérifie).
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081')::text, true);

-- 10.a L'ÉMETTEUR INCOMPLET BLOQUE.
insert into res select 'Sans identité d''émetteur, la base dit ce qui manque','true',
  (array_length(public.saas_billing_issuer_missing_fields(), 1) > 0)::text;

do $$
declare v_id uuid; refuse boolean := false; v_msg text;
begin
  insert into public.saas_invoices (organization_id, period_start, period_end, vat_regime, vat_rate)
  values ((select v from ids where k='orgA'), date '2026-01-01', date '2026-02-01', 'france', 20)
  returning id into v_id;
  insert into public.saas_invoice_lines (invoice_id, position, kind, description, unit_price_cents, vat_rate)
  values (v_id, 1, 'plan', 'Essai', 7990, 20);

  begin
    perform public.saas_issue_invoice(v_id, 'Essai avant identité.');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('SANS IDENTITÉ D''ÉMETTEUR, AUCUNE FACTURE NE PART','true',refuse::text);
  insert into res values ('Et le refus nomme les champs manquants','true',
    (v_msg like '%siret%')::text);
  delete from public.saas_invoices where id = v_id;
end $$;

-- On renseigne l'émetteur, sous le super-administrateur : c'est le seul
-- rôle qui y a droit.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

select public.admin_set_billing_issuer(jsonb_build_object(
  'legal_name','Oasis Care SAS (test)',
  'legal_form','SAS',
  'siret','999 888 777 00011',
  'vat_number','FR00999888777',
  'address_line1','1 avenue du Test',
  'postal_code','75001',
  'city','Paris',
  'iban','FR7630000000000000000000000',
  'late_penalty_terms','Pénalités de retard : trois fois le taux d''intérêt légal. Indemnité forfaitaire de recouvrement : 40 €.'
), 'Mise en place de la facturation SaaS.');

insert into res select 'L''identité de l''émetteur est complète','0',
  coalesce(array_length(public.saas_billing_issuer_missing_fields(), 1), 0)::text;

-- 10.b LA TVA INCONNUE BLOQUE ELLE AUSSI.
reset role;
delete from public.saas_customer_tax_profiles
 where organization_id = (select v from ids where k='orgB');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081')::text, true);

do $$
declare v_id uuid; refuse boolean := false;
begin
  insert into public.saas_invoices (organization_id, period_start, period_end, vat_regime, vat_rate, vat_note)
  values ((select v from ids where k='orgB'), date '2026-01-01', date '2026-02-01',
          'unknown', null, 'Numéro de TVA non validé.')
  returning id into v_id;
  insert into public.saas_invoice_lines (invoice_id, position, kind, description, unit_price_cents, vat_rate)
  values (v_id, 1, 'plan', 'Essai', 7990, null);

  begin
    perform public.saas_issue_invoice(v_id, 'Essai avec TVA inconnue.');
  exception when others then refuse := true;
  end;
  insert into res values ('UN RÉGIME DE TVA INCONNU BLOQUE L''ÉMISSION','true',refuse::text);
  insert into res values ('Et le total de TVA rend INCONNU, jamais zéro','NULL',
    coalesce((select total_vat_cents::text from public.saas_invoice_totals where invoice_id = v_id), 'NULL'));
  delete from public.saas_invoices where id = v_id;
end $$;

-- 10.c LA GÉNÉRATION, ET LA NUMÉROTATION.
insert into ids (k, v)
select case when g.organization_id = (select v from ids where k='orgA') then 'gen1' else 'gen1F' end,
       g.invoice_id
  from public.saas_generate_invoices(
    'monthly', date '2026-01-01', date '2026-02-01', 'Facturation de janvier.', false) g
 where g.organization_id in ((select v from ids where k='orgA'),
                             (select v from ids where k='orgF'));

insert into res select 'La génération produit un brouillon, sans numéro','true',
  (select (number is null and status = 'draft')::text from public.saas_invoices
    where id = (select v from ids where k='gen1'));

-- orgA est passée en Pro Business, qui COMPREND BioLab : son brouillon
-- ne porte que l'offre.
insert into res select 'Le brouillon porte l''offre, et pas le module inclus','plan',
  (select string_agg(distinct kind, ',' order by kind) from public.saas_invoice_lines
    where invoice_id = (select v from ids where k='gen1'));

-- LE CLIENT FONDATEUR, LUI, PORTE LES DEUX LIGNES. Il est sur Pro
-- (79,90 €) et la remise IMPOSE un prix mensuel de 49,90 € : la ligne
-- de remise vaut donc −30,00 €, et l'offre plus la remise font
-- 49,90 €. C'est ce que le dirigeant a promis, et c'est ce que la base
-- calcule — sur l'offre Pro et sur elle seule.
insert into res select 'Le brouillon du fondateur porte l''offre ET la remise','discount,plan',
  (select string_agg(distinct kind, ',' order by kind) from public.saas_invoice_lines
    where invoice_id = (select v from ids where k='gen1F'));

insert into res select 'LA REMISE FONDATEUR RAMÈNE LE PRIX MENSUEL À 49,90 €','4990',
  (select sum(total_cents)::text from public.saas_invoice_lines
    where invoice_id = (select v from ids where k='gen1F') and kind in ('plan','discount'));

-- IDEMPOTENCE : relancer ne crée pas de doublon — et RECALCULE le
-- brouillon. Un brouillon n'est pas un document : c'est un calcul en
-- attente de relecture, et il doit suivre l'abonnement jusqu'à
-- l'émission. Sans ce recalcul, une entreprise montée en gamme
-- continuait de payer un module que sa nouvelle offre comprend.
insert into res select 'RELANCER LA GÉNÉRATION NE CRÉE PAS DE DOUBLON','refreshed',
  (select outcome from public.saas_generate_invoices(
     'monthly', date '2026-01-01', date '2026-02-01', 'Relance de janvier.', false)
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Une seule facture pour cette période','1',
  (select count(*)::text from public.saas_invoices
    where organization_id = (select v from ids where k='orgA')
      and period_start = date '2026-01-01' and status <> 'cancelled');

-- ------------------------------------------------------------
-- 10.c bis UN BROUILLON PÉRIMÉ SE REFAIT — le module qu'on paierait deux fois
-- ------------------------------------------------------------
-- LE DÉFAUT MESURÉ : un brouillon produit alors que BioLab était en
-- OPTION gardait sa ligne « module 20,00 € » après un passage en offre
-- qui le COMPREND. Le client Business payait 20 € pour ce que son offre
-- inclut, sur un document ensuite émis, numéroté et opposable.
do $$
declare
  v_org uuid := (select v from ids where k='orgB');
  v_inv uuid;
  v_avant bigint;
  v_apres bigint;
begin
  -- orgB : offre Pro (`team`, BioLab en option à 20 €), abonnement actif.
  insert into public.organization_subscriptions
    (organization_id, plan, status, billing_cycle, started_at, current_period_end)
  values (v_org, 'team', 'active', 'monthly', now(), now() + interval '30 days')
  on conflict (organization_id) do update
    set plan = 'team', status = 'active', billing_cycle = 'monthly';

  insert into public.organization_subscription_modules (organization_id, module_key)
  values (v_org, 'biolab') on conflict do nothing;

  select gi.invoice_id into v_inv from public.saas_generate_invoices(
    'monthly', date '2026-07-01', date '2026-08-01', 'Juillet, offre Pro + BioLab en option.', false) gi
   where gi.organization_id = v_org;

  select sum(l.total_cents) into v_avant from public.saas_invoice_lines l
   where l.invoice_id = v_inv and l.kind = 'module';
  insert into res values ('Le brouillon facture bien le module en option','2000', coalesce(v_avant::text,'AUCUNE'));

  -- Montée en gamme : `business` COMPREND BioLab.
  update public.organization_subscriptions set plan = 'business' where organization_id = v_org;

  perform 1 from public.saas_generate_invoices(
    'monthly', date '2026-07-01', date '2026-08-01', 'Relance après montée en gamme.', false);

  select sum(l.total_cents) into v_apres from public.saas_invoice_lines l
   where l.invoice_id = v_inv and l.kind = 'module';
  insert into res values ('LE BROUILLON SUIT L''ABONNEMENT : plus de ligne module','AUCUNE',
    coalesce(v_apres::text, 'AUCUNE'));

  insert into res values ('Et c''est bien la MÊME facture, pas une seconde','1',
    (select count(*)::text from public.saas_invoices i
      where i.organization_id = v_org and i.period_start = date '2026-07-01'
        and i.status <> 'cancelled'));

  delete from public.saas_invoices where period_start in (date '2026-07-01', date '2026-09-01');
  delete from public.organization_subscription_modules where organization_id = v_org;
  delete from public.organization_subscriptions where organization_id = v_org;
end $$;

-- ------------------------------------------------------------
-- 10.c ter UN CRÉDIT NE DISPARAÎT PAS AVEC LE BROUILLON QU'ON ANNULE
-- ------------------------------------------------------------
-- La génération marque le crédit « consommé » dès le BROUILLON. Annuler
-- ce brouillon le faisait disparaître pour toujours : l'index des
-- crédits ouverts l'excluait, aucune fonction ne savait le rendre, et la
-- table n'a aucune politique d'écriture. Le client perdait son argent, et
-- la seule manœuvre pour corriger un brouillon — l'annuler et relancer —
-- était précisément celle qui le mangeait.
do $$
declare
  v_org uuid := (select v from ids where k='orgB');
  v_inv uuid;
  v_ouverts integer;
begin
  insert into public.organization_subscriptions
    (organization_id, plan, status, billing_cycle, started_at, current_period_end)
  values (v_org, 'team', 'active', 'monthly', now(), now() + interval '30 days')
  on conflict (organization_id) do update set plan = 'team', status = 'active';

  perform public.admin_grant_credit(v_org, 5000, 'Geste commercial après incident.');

  select gi.invoice_id into v_inv from public.saas_generate_invoices(
    'monthly', date '2026-09-01', date '2026-10-01', 'Septembre.', false) gi
   where gi.organization_id = v_org;

  insert into res values ('Le crédit est consommé par le brouillon','0',
    (select count(*)::text from public.saas_account_credits c
      where c.organization_id = v_org and c.consumed_at is null and c.cancelled_at is null));

  perform public.saas_cancel_invoice(v_inv, 'Brouillon erroné, on refait.');

  select count(*) into v_ouverts from public.saas_account_credits c
   where c.organization_id = v_org and c.consumed_at is null and c.cancelled_at is null;
  insert into res values ('ANNULER LE BROUILLON REND LE CRÉDIT','1', v_ouverts::text);

  -- Et la facture refaite le reprend : 79,90 − 50,00 = 29,90 € HT.
  select gi.invoice_id into v_inv from public.saas_generate_invoices(
    'monthly', date '2026-09-01', date '2026-10-01', 'Septembre, refait.', false) gi
   where gi.organization_id = v_org;

  insert into res values ('La facture refaite déduit de nouveau le crédit','2990',
    (select sum(l.total_cents)::text from public.saas_invoice_lines l where l.invoice_id = v_inv));

  delete from public.saas_invoices where period_start in (date '2026-07-01', date '2026-09-01');
  delete from public.saas_account_credits where organization_id = v_org;
  delete from public.organization_subscriptions where organization_id = v_org;
end $$;

-- ÉMISSION : le premier numéro de l'année.
insert into att select 'num1', 'FS-' || (select v from att where k='annee') || '-00001';
insert into att select 'num2', 'FS-' || (select v from att where k='annee') || '-00002';

insert into res select 'Le premier numéro de l''année',
  (select v from att where k='num1'),
  public.saas_issue_invoice((select v from ids where k='gen1'), 'Émission de la facture de janvier.');

insert into res select 'Réémettre est idempotent : pas de second numéro consommé',
  (select v from att where k='num1'),
  public.saas_issue_invoice((select v from ids where k='gen1'), 'Double clic.');

insert into res select 'La facture porte l''IBAN de l''émetteur','FR7630000000000000000000000',
  (select issuer_iban from public.saas_invoices where id = (select v from ids where k='gen1'));

insert into res select 'ET UNE RÉFÉRENCE DE PAIEMENT PROPRE',
  'OCFS' || (select v from att where k='annee') || '00001',
  (select payment_reference from public.saas_invoices where id = (select v from ids where k='gen1'));

insert into res select 'Elle fige l''identité du client au moment de l''émission','SARL Suite A',
  (select customer_legal_name from public.saas_invoices where id = (select v from ids where k='gen1'));

insert into res select 'Et l''échéance se déduit des conditions de l''émetteur','true',
  (select (due_on = issued_on + 30)::text from public.saas_invoices
    where id = (select v from ids where k='gen1'));

-- UN BROUILLON ABANDONNÉ NE CONSOMME AUCUN NUMÉRO : c'est ce qui garantit
-- l'absence de trou.
do $$
declare v_id uuid;
begin
  insert into public.saas_invoices (organization_id, period_start, period_end, vat_regime, vat_rate)
  values ((select v from ids where k='orgA'), date '2026-03-01', date '2026-04-01', 'france', 20)
  returning id into v_id;
  perform public.saas_cancel_invoice(v_id, 'Erreur de saisie, brouillon abandonné.');
  insert into res values ('Un brouillon annulé n''a jamais eu de numéro','true',
    (select (number is null and status = 'cancelled') from public.saas_invoices where id = v_id)::text);
end $$;

-- Et le numéro suivant est bien le SUIVANT : pas de trou.
do $$
declare v_id uuid; v_num text;
begin
  insert into public.saas_invoices (organization_id, period_start, period_end, vat_regime, vat_rate)
  values ((select v from ids where k='orgA'), date '2026-02-01', date '2026-03-01', 'france', 20)
  returning id into v_id;
  insert into public.saas_invoice_lines (invoice_id, position, kind, description, unit_price_cents, vat_rate)
  values (v_id, 1, 'plan', 'Pro Business — février', 13990, 20);
  v_num := public.saas_issue_invoice(v_id, 'Facture de février.');
  insert into ids values ('gen2', v_id);
  insert into res values ('LA SÉQUENCE EST SANS TROU : le numéro suivant est le suivant',
    (select v from att where k='num2'), v_num);
end $$;

insert into res select 'Aucun doublon de numéro','0',
  (select count(*)::text from (
     select number from public.saas_invoices where number is not null
     group by number having count(*) > 1) t);

-- LA FACTURATION AUTOMATIQUE, bout en bout : la génération émet
-- elle-même quand rien ne bloque. C'est ce que l'utilisateur a demandé
-- — « les factures doivent être automatiques » — et il ne manque plus
-- que le déclenchement, qui n'est pas de ce chantier.
insert into att select 'num3', 'FS-' || (select v from att where k='annee') || '-00003';

do $$
declare v_res record;
begin
  select * into v_res from public.saas_generate_invoices(
    'monthly', date '2026-04-01', date '2026-05-01', 'Facturation d''avril.', true)
   where organization_id = (select v from ids where k='orgA');

  insert into res values ('La génération ÉMET elle-même quand rien ne bloque', 'issued', v_res.outcome);
  insert into res values ('Et le numéro suit toujours la séquence',
    (select v from att where k='num3'), v_res.invoice_number);
  insert into res values ('Aucun motif de blocage', 'true', (v_res.blocking_reason is null)::text);
end $$;

-- UNE FACTURE ÉMISE NE BOUGE PLUS.
do $$
declare refuse boolean := false;
begin
  begin
    update public.saas_invoices set customer_legal_name = 'Autre nom'
     where id = (select v from ids where k='gen1');
  exception when others then refuse := true;
  end;
  insert into res values ('UNE FACTURE ÉMISE NE SE MODIFIE PLUS','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.saas_invoice_lines (invoice_id, position, kind, description, unit_price_cents, vat_rate)
    values ((select v from ids where k='gen1'), 99, 'other', 'Ligne ajoutée après coup', 100000, 20);
  exception when others then refuse := true;
  end;
  insert into res values ('Ni ses lignes','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    delete from public.saas_invoices where id = (select v from ids where k='gen1');
  exception when others then refuse := true;
  end;
  insert into res values ('ET ELLE NE SE SUPPRIME PAS : un trou serait un défaut grave','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.saas_cancel_invoice((select v from ids where k='gen1'), 'Annulation directe.');
  exception when others then refuse := true;
  end;
  insert into res values ('Une facture émise ne s''annule pas : elle se crédite','true',refuse::text);
end $$;

-- L'AVOIR : la facture garde son numéro, l'avoir a le sien.
insert into res select 'L''avoir a sa propre séquence',
  'AV-' || (select v from att where k='annee') || '-00001',
  public.saas_credit_invoice((select v from ids where k='gen2'), 'Erreur de période, facture à refaire.');

insert into res select 'La facture créditée GARDE son numéro',
  (select v from att where k='num2'),
  (select number from public.saas_invoices where id = (select v from ids where k='gen2'));

insert into res select 'Et l''avoir la neutralise','0',
  (select outstanding_cents::text from public.saas_invoice_balance
    where invoice_id = (select v from ids where k='gen2'));

-- L'ENCAISSEMENT, MANUEL.
do $$
declare v_du bigint;
begin
  select total_including_vat_cents into v_du from public.saas_invoice_totals
   where invoice_id = (select v from ids where k='gen1');

  perform public.saas_record_invoice_payment(
    (select v from ids where k='gen1'), v_du, current_date, 'transfer',
    'Virement reçu sur le compte, rapprochement fait à la main.');

  insert into res values ('L''encaissement se saisit à la main et solde la facture', 'paid',
    (select status from public.saas_invoices where id = (select v from ids where k='gen1')));
  insert into res values ('Et il ne reste rien à devoir', '0',
    (select outstanding_cents::text from public.saas_invoice_balance
      where invoice_id = (select v from ids where k='gen1')));
end $$;

-- LE RETARD SE DÉDUIT, IL NE SE SAISIT PAS.
reset role;
insert into res select 'Le statut « en retard » n''existe pas en base','0',
  (select count(*)::text from public.saas_invoices where status = 'overdue');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081')::text, true);

-- Une facture émise l'an dernier, échue depuis cinq jours. Elle est
-- POSÉE À LA MAIN et non émise par la fonction : `due_on` est figé au
-- moment de l'émission (c'est une mention du document), et le
-- déclencheur d'immuabilité refuse — à juste titre — qu'on l'antidate
-- après coup. Simuler le temps qui passe dans une transaction annulée
-- n'a pas d'autre chemin.
do $$
declare v_id uuid;
begin
  -- Le brouillon d'abord, sa ligne ensuite, l'émission en dernier :
  -- l'ordre est imposé par le déclencheur d'immuabilité, qui refuse
  -- d'ajouter une ligne à une facture déjà émise. Il vient de nous
  -- l'apprendre en faisant échouer ce test écrit dans l'autre sens.
  insert into public.saas_invoices
    (organization_id, period_start, period_end, vat_regime, vat_rate)
  values ((select v from ids where k='orgA'), date '2020-12-01', date '2021-01-01', 'france', 20)
  returning id into v_id;

  insert into public.saas_invoice_lines (invoice_id, position, kind, description, unit_price_cents, vat_rate)
  values (v_id, 1, 'plan', 'Pro Business — période échue', 13990, 20);

  update public.saas_invoices set
    number = 'FS-2020-00001', status = 'issued',
    issued_on = current_date - 35, issued_at = now() - interval '35 days',
    due_on = current_date - 5,
    issuer_legal_name = 'Oasis Care SAS (test)', issuer_siret = '999 888 777 00011',
    customer_legal_name = 'SARL Suite A'
  where id = v_id;

  insert into res values ('« EN RETARD » SE DÉDUIT DE L''ÉCHÉANCE, il ne se saisit pas','overdue',
    (select effective_status from public.saas_invoice_state where invoice_id = v_id));
  insert into res values ('Et le nombre de jours de retard est calculé','5',
    (select days_late::text from public.saas_invoice_state where invoice_id = v_id));
end $$;

-- ============================================================
-- 11. LES SESSIONS D'ASSISTANCE
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

-- LE NIVEAU « DONNÉES MÉTIER » N'EST PAS ACCORDABLE tant que personne
-- n'a nommé les tables qu'il ouvre.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_start_support_session(
      'businessReadOnly', 'Le client demande de l''aide.',
      (select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values ('« Les données du client » N''EST PAS UN NIVEAU D''ACCÈS : refusé','true',refuse::text);
end $$;

insert into ids select 'sess', public.admin_start_support_session(
  'diagnostics', 'Ticket 42 : le client dit que son IA s''est arrêtée hier.',
  (select v from ids where k='orgA'), null, 20);

insert into res select 'Une session d''assistance s''ouvre, avec motif et échéance','true',
  (select (expires_at > now() and expires_at <= started_at + interval '30 minutes')::text
     from public.support_sessions where id = (select v from ids where k='sess'));

-- Lue en `postgres` : le support n'a pas `platform.audit.read`, et
-- c'est voulu — savoir quel collègue a touché quel dossier n'est pas
-- son travail. La ligne existe pourtant, et c'est ce qu'on vérifie.
reset role;
insert into res select 'Son ouverture est journalisée','supportSession.started',
  (select action from public.admin_audit_events
    where target_id = (select v from ids where k='sess'));
set local role authenticated;

insert into res select 'Elle n''ouvre AUCUNE donnée métier','false',
  (select opens_business_data::text from public.support_session_mine()
    where id = (select v from ids where k='sess'));

-- CE QUE LE NIVEAU OUVRE, ET RIEN D'AUTRE.
insert into res select 'Le niveau « diagnostics » ouvre bien ce qui est nommé','true',
  (public.support_session_record_access(
     (select v from ids where k='sess'), 'ai_usage_events') is not null)::text;

insert into res select 'Chaque usage laisse une ligne dans le journal d''accès','1',
  (select count(*)::text from public.support_access_log
    where session_id = (select v from ids where k='sess'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access((select v from ids where k='sess'), 'plants');
  exception when others then refuse := true;
  end;
  insert into res values ('Une ressource HORS de la liste nommée est refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access((select v from ids where k='sess'), 'quotes');
  exception when others then refuse := true;
  end;
  insert into res values ('Les devis du client, en particulier','true',refuse::text);
end $$;

-- L'EXPIRATION EST VÉRIFIÉE EN BASE. C'est le test le plus important du
-- paragraphe : une session ouverte hier ne sert pas aujourd'hui, et
-- aucune bannière de navigateur ne décide de ça.
reset role;
update public.support_sessions
   set started_at = now() - interval '3 hours', expires_at = now() - interval '2 hours'
 where id = (select v from ids where k='sess');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access((select v from ids where k='sess'), 'ai_usage_events');
  exception when others then refuse := true;
  end;
  insert into res values ('UNE SESSION EXPIRÉE NE DONNE PLUS RIEN','true',refuse::text);
end $$;

insert into res select 'Et elle disparaît de la bannière','0',
  (select count(*)::text from public.support_session_mine());

-- LA SESSION D'UN COLLÈGUE N'EST PAS LA SIENNE.
reset role;
update public.support_sessions
   set started_at = now(), expires_at = now() + interval '20 minutes'
 where id = (select v from ids where k='sess');

select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access((select v from ids where k='sess'), 'ai_usage_events');
  exception when others then refuse := true;
  end;
  insert into res values ('On ne se sert pas de la session d''un collègue','true',refuse::text);
end $$;

-- UNE SESSION RÉVOQUÉE NE DONNE PLUS RIEN NON PLUS.
select public.admin_revoke_support_session((select v from ids where k='sess'), 'Intervention terminée.');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access((select v from ids where k='sess'), 'ai_usage_events');
  exception when others then refuse := true;
  end;
  insert into res values ('Une session révoquée ne donne plus rien','true',refuse::text);
end $$;

-- LE CLIENT VOIT QU'ON EST ENTRÉ CHEZ LUI.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810002-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into res select 'LE CLIENT VOIT LES SESSIONS OUVERTES SUR SON DOSSIER','1',
  (select count(*)::text from public.support_sessions
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Et le détail de ce qui a été consulté','1',
  (select count(*)::text from public.support_access_log);

-- IL N'EXISTE AUCUNE VARIANTE D'ÉCRITURE. L'assistance regarde.
reset role;
insert into res select 'Aucune fonction n''ouvre une ÉCRITURE sous session d''assistance','0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'support_session_%'
      and p.proname like '%write%');

-- ============================================================
-- 12. LES TICKETS — et leur canal d'entrée
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','cc810001-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into ids select 'ticket', public.open_support_ticket(
  'Mon IA ne répond plus', 'Depuis hier, l''analyse de plante tourne sans fin.',
  null, 'mobile', '2.4.1', '2410', 'iOS', '18.2');

insert into res select 'UN CLIENT PEUT OUVRIR UNE DEMANDE — le canal d''entrée existe','open',
  (select status from public.support_tickets where id = (select v from ids where k='ticket'));

insert into res select 'Son message est enregistré','customer',
  (select author_kind from public.support_ticket_messages
    where ticket_id = (select v from ids where k='ticket'));

-- Il ne peut pas rattacher sa demande à l'entreprise d'un autre.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.open_support_ticket('Pirate', 'Corps', (select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values ('On ne rattache pas sa demande à l''entreprise d''un autre','true',refuse::text);
end $$;

-- LE SUPPORT RÉPOND, et sa note interne ne sort pas.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

select public.admin_reply_support_ticket(
  (select v from ids where k='ticket'),
  'Note pour l''équipe : quota IA atteint, à vérifier.',
  'Qualification de la demande.', true, 'pending');

insert into res select 'Le support voit sa note interne','1',
  (select count(*)::text from public.support_ticket_messages
    where ticket_id = (select v from ids where k='ticket') and is_internal);

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810001-0000-4000-8000-000000000081')::text, true);
set local role authenticated;

insert into res select 'LE CLIENT NE VOIT PAS LA NOTE INTERNE','1',
  (select count(*)::text from public.support_ticket_messages
    where ticket_id = (select v from ids where k='ticket'));

insert into res select 'Et il ne voit que ses propres demandes','1',
  (select count(*)::text from public.support_tickets);

-- ============================================================
-- 13. LES DRAPEAUX
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

do $$
declare v_evt uuid;
begin
  v_evt := public.admin_set_feature_flag('aiDiagnosisEnabled', false,
    'Suspension temporaire : incident fournisseur.');
  insert into res values ('Un drapeau existant se bascule, avec sa trace', 'featureFlag.toggled',
    (select action from public.admin_audit_events where id = v_evt));
  insert into res values ('Et le drapeau est bien éteint', 'false',
    (select is_enabled::text from public.feature_flags where flag_key = 'aiDiagnosisEnabled'));
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_set_feature_flag('drapeauInvente', true, 'Essai.');
  exception when others then refuse := true;
  end;
  insert into res values ('ON NE CRÉE PAS UN DRAPEAU BRANCHÉ SUR RIEN','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.admin_set_commercial_config('pricing.grid.0081', '{}'::jsonb, 'Essai.');
  exception when others then refuse := true;
  end;
  insert into res values ('Le marqueur de la grille tarifaire est protégé','true',refuse::text);
end $$;

-- ============================================================
-- 14. LE MOTIF EST OBLIGATOIRE, PARTOUT
-- ============================================================
do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select public.admin_set_plan_pricing(''team'', 7990, 79900, ''   '')',
    'select public.admin_grant_platform_admin(''cc810003-0000-4000-8000-000000000081'', ''support'', '''')',
    'select public.admin_set_feature_flag(''aiDiagnosisEnabled'', true, ''  '')',
    'select public.admin_set_mfa_policy(false, null, '''')',
    'select public.admin_start_support_session(''diagnostics'', ''  '', null, ''cc810002-0000-4000-8000-000000000081'')'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('Motif vide refusé — « ' || left(f, 48) || '… »', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 15. LES DROITS — c'est là que 0055 s'est fait avoir
-- ============================================================
reset role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_security_settings', 'platform_admin_invitations',
    'platform_modules', 'plan_modules', 'discount_offers', 'subscription_discounts',
    'subscription_commitment_acceptances',
    'organization_subscription_events', 'organization_subscription_modules',
    'saas_account_credits', 'saas_billing_issuer', 'saas_vat_rates',
    'saas_customer_tax_profiles', 'saas_invoices', 'saas_invoice_lines',
    'saas_invoice_payments', 'saas_credit_notes', 'saas_credit_note_lines',
    'support_tickets', 'support_ticket_messages', 'support_access_levels',
    'support_access_level_resources', 'support_sessions', 'support_access_log'
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
  end loop;
end $$;

insert into res select 'Le compteur de numérotation n''est même pas lisible','false',
  has_table_privilege('authenticated','public.saas_document_counters','select')::text;

insert into res select 'Les vues de facturation ne sont pas modifiables','false',
  (has_table_privilege('authenticated','public.saas_invoice_totals','insert')
   or has_table_privilege('authenticated','public.saas_invoice_balance','insert')
   or has_table_privilege('authenticated','public.saas_invoice_state','insert'))::text;

insert into res select 'Les trois vues sont en security_invoker','3',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('saas_invoice_totals','saas_invoice_balance','saas_invoice_state')
      and array_to_string(c.reloptions, ',') like '%security_invoker=true%');

insert into res select 'Aucune vue security definer n''a été créée','0',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and c.relname like 'saas!_%' escape '!'
      and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%');

insert into res select 'anon n''exécute aucune fonction neuve','0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_grant_platform_admin','admin_revoke_platform_admin',
                        'admin_set_plan_pricing','saas_issue_invoice','saas_generate_invoices',
                        'admin_start_support_session','support_session_record_access',
                        'admin_set_mfa_policy','admin_set_billing_issuer')
      and has_function_privilege('anon', p.oid, 'execute'));

-- Toutes les fonctions d'écriture neuves épinglent leur `search_path` :
-- sans cela, un appelant qui crée une table temporaire homonyme
-- détourne une fonction `security definer`.
insert into res select 'Toutes les fonctions security definer neuves épinglent leur search_path','0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proname like 'admin!_%' escape '!' or p.proname like 'saas!_%' escape '!'
           or p.proname like 'support!_session!_%' escape '!'
           or p.proname like 'platform!_admin!_%' escape '!')
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public, pg_temp%');

-- ============================================================
-- 16. LA TRACE
-- ============================================================
insert into res select 'Chaque geste administratif de ce test a laissé une trace','true',
  (select (count(*) >= 15)::text from public.admin_audit_events);

insert into res select 'Aucune ligne de journal sans motif','0',
  (select count(*)::text from public.admin_audit_events where btrim(reason) = '');

insert into res select 'L''historique d''abonnement s''écrit aussi','true',
  (select (count(*) >= 3)::text from public.organization_subscription_events
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Et la remise du fondateur y laisse sa trace','true',
  (select (count(*) > 0)::text from public.organization_subscription_events
    where event = 'discountApplied'
      and organization_id = (select v from ids where k='orgF'));

insert into res select 'Et il retient le passage d''une offre à l''autre','team → business',
  (select plan_before || ' → ' || plan_after from public.organization_subscription_events
    where event = 'planChanged' and organization_id = (select v from ids where k='orgA'));

-- ============================================================
-- 17. LE MRR QUE CE LOT ALLUME — ET QU'IL DEVAIT CORRIGER
-- ============================================================
-- 0075 rendait le MRR inconnu faute de prix. Le § 4 de 0081 pose les
-- prix, donc le calcul se rallume tout seul. Ces assertions vérifient
-- qu'il se rallume JUSTE : la somme naïve de 0075 aurait compté un
-- abonné annuel à son tarif mensuel et un client fondateur à son tarif
-- public.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);

-- orgA : Pro Business (139,90 €), BioLab compris dans l'offre, aucune
-- remise — la remise fondateur ne peut plus y être posée.
insert into res select 'Un abonné Pro Business compte pour son tarif','13990',
  public.subscription_normalized_mrr_cents((select v from ids where k='orgA'))::text;

-- orgF : Pro (79,90 €), remise FONDATEUR en cours. Le prix réellement
-- payé est 49,90 €, et c'est ce que le MRR doit compter — la somme
-- naïve de 0075 aurait écrit 79,90 €.
insert into res select 'UN CLIENT FONDATEUR COMPTE POUR CE QU''IL PAIE, pas pour le tarif public','4990',
  public.subscription_normalized_mrr_cents((select v from ids where k='orgF'))::text;

do $$
begin
  perform public.admin_create_subscription(
    (select v from ids where k='orgB'), 'team', 'yearly', 'Client annuel.', 'active');
end $$;

-- 799 € l'an, soit 66,58 € par mois. La somme de 0075 aurait écrit
-- 79,90 € — 20 % de trop.
insert into res select 'UN ABONNÉ ANNUEL COMPTE POUR UN DOUZIÈME, pas pour son tarif mensuel','6658',
  public.subscription_normalized_mrr_cents((select v from ids where k='orgB'))::text;

insert into res select 'Le MRR de la plateforme est la somme des trois','25638',
  (select mrr_cents::text from public.admin_platform_kpis());

insert into res select 'Et l''ARR redevient exact, parce que le MRR est normalisé','307656',
  (select arr_cents::text from public.admin_platform_kpis());

-- UN SEUL MONTANT INCALCULABLE REND TOUT LE MRR INCONNU. Le contraire —
-- ignorer la ligne et sommer le reste — rendrait un chiffre trop bas
-- qui aurait l'air d'un chiffre.
do $$
begin
  perform public.admin_set_plan_pricing('team', 7990, null,
    'On retire le prix annuel : l''abonné annuel devient incalculable.');
end $$;

insert into res select 'UN SEUL ABONNEMENT INCALCULABLE REND LE MRR INCONNU, jamais trop bas','INCONNU',
  coalesce((select mrr_cents::text from public.admin_platform_kpis()), 'INCONNU');

insert into res select 'Et le motif compte les abonnements en cause','true',
  (select (unknown_reasons->>'mrr_cents' like '1 abonnement%')::text
     from public.admin_platform_kpis());

-- L'aide au calcul n'est appelable par personne : c'est sa seule
-- protection, elle franchit la RLS sans contrôler de permission.
insert into res select 'Personne ne peut appeler l''aide au calcul du MRR','false',
  (has_function_privilege('authenticated','public.subscription_normalized_mrr_cents(uuid)','execute')
   or has_function_privilege('anon','public.subscription_normalized_mrr_cents(uuid)','execute'))::text;

-- ============================================================
-- 18. LES SIX DÉFAUTS QUE LA RELECTURE A TROUVÉS
-- ============================================================
-- Chacun de ces blocs échouait avant correction. Ils sont ici pour que
-- personne ne les réintroduise en croyant simplifier.

-- ------------------------------------------------------------
-- 18.a AUCUN RÔLE N'ÉCRIT L'HISTOIRE D'UN ABONNEMENT À LA MAIN
-- ------------------------------------------------------------
-- `record_subscription_event()` n'a qu'un contrôle : « est-ce un
-- administrateur ». Ni permission, ni second facteur. Accordée à
-- `authenticated`, elle laissait l'analyste en LECTURE SEULE planter
-- dans l'historique d'une entreprise un « planChanged business → solo »
-- qui n'a jamais eu lieu — et le client relisait cette ligne.
reset role;
insert into res select 'L''historique d''abonnement ne s''écrit pas depuis dehors','false',
  has_function_privilege('authenticated',
    'public.record_subscription_event(uuid, text, text, text, text, text, jsonb, jsonb, text, uuid)',
    'execute')::text;

select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.record_subscription_event(
      (select v from ids where k='orgA'), 'planChanged', 'business', 'solo',
      'active', 'cancelled', null, null, 'Ligne forgée.', null);
  exception when others then refuse := true;
  end;
  insert into res values ('Même un administrateur ne peut pas l''appeler directement','true',refuse::text);
end $$;

-- ------------------------------------------------------------
-- 18.b LA FACTURATION LIT LES ABONNEMENTS DONT ELLE RÉPOND
-- ------------------------------------------------------------
-- Retirer la politique d'écriture du client avait refermé la table sur
-- NOUS : il ne restait que « Members read their subscription », et un
-- administrateur n'est membre d'aucune entreprise cliente. Le piège
-- était complet — le super-administrateur de production ÉTANT membre de
-- l'unique entreprise, l'écran marchait chez lui et restait vide chez le
-- rôle facturation, dont c'est le métier.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

insert into res select 'LE RÔLE FACTURATION LIT LES ABONNEMENTS, sans être membre','true',
  ((select count(*) from public.organization_subscriptions) >= 1)::text;

insert into res select 'Et il n''est bien membre d''aucune entreprise','0',
  (select count(*)::text from public.organization_members m where m.user_id = auth.uid());

-- Il LIT, il n'écrit pas : la politique ajoutée est un `select`.
do $$
declare refuse boolean := false;
begin
  begin
    update public.organization_subscriptions
       set current_period_end = now() + interval '3650 days'
     where organization_id = (select v from ids where k='orgA');
    if not found then refuse := true; end if;
  exception when others then refuse := true;
  end;
  insert into res values ('Mais il ne l''écrit pas en direct','true',refuse::text);
end $$;

-- ------------------------------------------------------------
-- 18.c UN PRIX INCONNU N'EST PAS UN PRIX DE ZÉRO
-- ------------------------------------------------------------
-- Le pire défaut du lot : la génération coalesçait un prix absent à
-- zéro, le motif de blocage n'était enregistré nulle part, et
-- l'émission unitaire — celle du bouton — ne regardait jamais les prix.
-- On pouvait donc ÉMETTRE une facture française numérotée, opposable,
-- immuable, à 0,00 €, ayant consommé un numéro de séquence.
reset role;
do $$
declare
  v_org uuid := (select v from ids where k='orgA');
  v_inv uuid;
  v_prix bigint;
  v_ttc bigint;
  v_motif text;
  refuse boolean := false;
begin
  -- On efface le prix de l'offre sur laquelle orgA est abonnée. C'est
  -- littéralement le geste « champ vide = efface » de l'écran des plans.
  update public.organization_subscriptions set billing_cycle = 'monthly'
   where organization_id = v_org;
  update public.organization_plans set monthly_price_cents = null where key = 'business';

  select gi.invoice_id into v_inv from public.saas_generate_invoices(
    'monthly', date '2026-11-01', date '2026-12-01', 'Novembre, prix effacé.', false) gi
   where gi.organization_id = v_org;

  select l.unit_price_cents, l.blocking_reason into v_prix, v_motif
  from public.saas_invoice_lines l where l.invoice_id = v_inv and l.kind = 'plan';

  insert into res values ('La ligne porte un prix INCONNU, pas zéro','INCONNU', coalesce(v_prix::text,'INCONNU'));
  insert into res values ('Et le motif est ENREGISTRÉ sur la ligne, pas perdu','true',(v_motif is not null)::text);

  select b.total_including_vat_cents into v_ttc
  from public.saas_invoice_balance b where b.invoice_id = v_inv;
  insert into res values ('Le total de la facture devient INCONNU','INCONNU', coalesce(v_ttc::text,'INCONNU'));

  begin
    perform public.saas_issue_invoice(v_inv, 'Émission d''une facture à prix inconnu.');
  exception when others then refuse := true;
  end;
  insert into res values ('UNE FACTURE À PRIX INCONNU NE S''ÉMET PAS','true',refuse::text);

  insert into res values ('Aucun numéro n''a été consommé','true',
    (select (number is null) from public.saas_invoices where id = v_inv)::text);

  delete from public.saas_invoices where period_start = date '2026-11-01';
  update public.organization_plans set monthly_price_cents = 13990 where key = 'business';
end $$;

-- ------------------------------------------------------------
-- 18.c bis LE SIÈGE SUPPLÉMENTAIRE PEUT ENFIN ÊTRE FACTURÉ
-- ------------------------------------------------------------
-- Le prix (9,90 €) était semé sur les quatre offres, publié sur la
-- grille, lu par la ligne de facture et compté par le MRR — et AUCUNE
-- fonction n'écrivait `billable_extra_seats`. Un prix affiché que
-- personne ne peut appliquer est une promesse sans mécanisme.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

select public.admin_set_billable_seats(
  (select v from ids where k='orgA'), 2, 'Deux collaborateurs de plus chez ce client.');

reset role;
insert into res select 'DEUX SIÈGES EN PLUS SONT ENREGISTRÉS','2',
  (select billable_extra_seats::text from public.organization_subscriptions
    where organization_id = (select v from ids where k='orgA'));

insert into res select 'Et ils apparaissent sur la facture, au prix de l''offre','1980',
  (select sum(round(l.quantity * l.unit_price_cents))::text
     from public.saas_subscription_billing_lines(
       (select v from ids where k='orgA'), date '2026-05-01', date '2026-06-01') l
    where l.kind = 'seats');

insert into res select 'Le geste est journalisé comme les sept autres','1',
  (select count(*)::text from public.admin_audit_events
    where action = 'subscription.billableSeatsSet');

-- On remet à zéro : les assertions de MRR qui suivent comptent l'offre
-- seule, et un siège en plus les ferait dériver.
select set_config('request.jwt.claims',
  json_build_object('sub','cc810012-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;
select public.admin_set_billable_seats(
  (select v from ids where k='orgA'), 0, 'Retour à la normale pour la suite du test.');
reset role;

-- ------------------------------------------------------------
-- 18.d UNE REMISE À PRIX IMPOSÉ NE GONFLE PAS LE MRR
-- ------------------------------------------------------------
-- La facture pose `greatest(base − valeur, 0)`, soit un net de
-- `min(base, valeur)` ; le MRR ADOPTAIT la valeur imposée. Un prix
-- imposé supérieur au tarif de l'offre faisait donc diverger deux
-- calculs du même euro, et c'est l'indicateur de pilotage qui mentait.
reset role;
do $$
declare
  v_org uuid := (select v from ids where k='orgA');
begin
  update public.organization_subscriptions set billing_cycle = 'monthly'
   where organization_id = v_org;
  delete from public.subscription_discounts where organization_id = v_org;

  insert into public.discount_offers (code, label, kind, value_cents, duration_months, note)
  values ('TEST-PLAFOND', 'Prix imposé plus cher que l''offre', 'fixedMonthlyPrice', 99900, 12,
          'Offre de test : ne sert qu''à éprouver la borne du calcul.')
  on conflict (code) do nothing;

  insert into public.subscription_discounts
    (organization_id, code, label, kind, value_cents, starts_on, ends_on, reason)
  values (v_org, 'TEST-PLAFOND', 'Prix imposé plus cher que l''offre', 'fixedMonthlyPrice',
          99900, current_date - 1, current_date + 30, 'Cas limite du calcul.');

  -- Pro Business vaut 139,90 € ; la remise « impose » 999,00 €. Le
  -- client paiera 139,90 € — c'est ce que pose la ligne de facture —
  -- et c'est donc ce que le MRR doit compter.
  insert into res values ('UN PRIX IMPOSÉ PLUS CHER QUE L''OFFRE NE FAIT PAS PAYER PLUS','13990',
    public.subscription_normalized_mrr_cents(v_org)::text);

  delete from public.subscription_discounts where organization_id = v_org;
end $$;

-- ------------------------------------------------------------
-- 18.e LE GARDIEN D'ASSISTANCE — la personne, et le périmètre
-- ------------------------------------------------------------
-- Deux trous, et le second est le plus grave.
--
--   • le gardien ne revérifiait jamais que l'appelant est ENCORE
--     administrateur, et seule la révocation refermait les sessions :
--     ni la rétrogradation, ni une désactivation tapée dans l'éditeur
--     SQL, ni la suppression de la fiche ;
--   • et il ne bornait pas l'accès à l'entreprise que la session NOMME.
--     Une session « entreprise A », motivée et affichée comme telle,
--     laissait lire — et journalisait comme légitime — la ligne d'un
--     tout autre client.
reset role;
insert into public.ai_usage_events (organization_id, agent, model, input_tokens, output_tokens, duration_ms, success)
values ((select v from ids where k='orgB'), 'test', 'test', 0, 0, 1, true);
insert into ids select 'ligneB', id from public.ai_usage_events
 where organization_id = (select v from ids where k='orgB') order by id limit 1;

insert into public.ai_usage_events (organization_id, agent, model, input_tokens, output_tokens, duration_ms, success)
values ((select v from ids where k='orgA'), 'test', 'test', 0, 0, 1, true);
insert into ids select 'ligneA', id from public.ai_usage_events
 where organization_id = (select v from ids where k='orgA') order by id limit 1;

select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

insert into ids select 'sess2', public.admin_start_support_session(
  'diagnostics', 'Diagnostic sur l''entreprise A seulement.',
  (select v from ids where k='orgA'), null, 30);

insert into res select 'La session ouverte sur A lit bien une ligne de A','true',
  (public.support_session_record_access(
     (select v from ids where k='sess2'), 'ai_usage_events',
     (select v from ids where k='ligneA')) is not null)::text;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access(
      (select v from ids where k='sess2'), 'ai_usage_events',
      (select v from ids where k='ligneB'));
  exception when others then refuse := true;
  end;
  insert into res values ('UNE SESSION NOMMÉE « A » N''OUVRE PAS LA LIGNE D''UN CLIENT B','true',refuse::text);
end $$;

-- Une table dont on ne sait pas dire à quel client appartient une ligne
-- refuse une cible nommée, plutôt que de la journaliser sans preuve.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access(
      (select v from ids where k='sess2'), 'ai_pro_usage', gen_random_uuid());
  exception when others then refuse := true;
  end;
  insert into res values ('Une cible qu''on ne sait pas vérifier est refusée, pas tracée','true',refuse::text);
end $$;

-- LA RÉTROGRADATION FERME LA FENÊTRE. Le support passe analyste.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

select public.admin_change_platform_admin_role(
  'cc810011-0000-4000-8000-000000000081', 'read_only_analyst',
  'Changement d''affectation pendant une session ouverte.');

reset role;
insert into res select 'LA RÉTROGRADATION FERME LA SESSION OUVERTE','true',
  (select (revoked_at is not null) from public.support_sessions
    where id = (select v from ids where k='sess2'))::text;

select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access(
      (select v from ids where k='sess2'), 'ai_usage_events',
      (select v from ids where k='ligneA'));
  exception when others then refuse := true;
  end;
  insert into res values ('Et l''accès est refusé après rétrogradation','true',refuse::text);
end $$;

-- LA DÉSACTIVATION TAPÉE DANS L'ÉDITEUR SQL AUSSI. On rend son rôle au
-- support, on lui rouvre une session, puis on le désactive à la main.
reset role;
update public.platform_admins set role = 'support'
 where user_id = 'cc810011-0000-4000-8000-000000000081';

select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

insert into ids select 'sess3', public.admin_start_support_session(
  'diagnostics', 'Seconde intervention sur A.',
  (select v from ids where k='orgA'), null, 30);

-- Le geste est fait « en base », mais sous une AUTRE identité : le
-- garde-fou du § 3 refuse qu'on se révoque soi-même, et il a raison.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
update public.platform_admins set is_active = false, revoked_at = now()
 where user_id = 'cc810011-0000-4000-8000-000000000081';

insert into res select 'UNE DÉSACTIVATION DIRECTE FERME AUSSI LA SESSION','true',
  (select (revoked_at is not null) from public.support_sessions
    where id = (select v from ids where k='sess3'))::text;

select set_config('request.jwt.claims',
  json_build_object('sub','cc810011-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.support_session_record_access(
      (select v from ids where k='sess3'), 'ai_usage_events',
      (select v from ids where k='ligneA'));
  exception when others then refuse := true;
  end;
  insert into res values ('Et le gardien refuse un appelant qui n''est plus administrateur','true',refuse::text);
end $$;

-- ------------------------------------------------------------
-- 18.f UN ANALYSTE EN LECTURE SEULE N'ÉCRIT RIEN, NULLE PART
-- ------------------------------------------------------------
-- Le test générique qui aurait attrapé 18.a du premier coup : on
-- parcourt les écritures du fichier sous un analyste, et AUCUNE ne doit
-- passer.
reset role;
insert into public.platform_admins (user_id, role, note)
values ('cc810014-0000-4000-8000-000000000081','read_only_analyst','Analyste de test')
on conflict (user_id) do update set role = 'read_only_analyst', is_active = true, revoked_at = null;

select set_config('request.jwt.claims',
  json_build_object('sub','cc810014-0000-4000-8000-000000000081','aal','aal2')::text, true);
set local role authenticated;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select public.admin_set_plan_pricing(''team'', 100, 1000, ''essai'')',
    'select public.admin_set_plan_module(''team'', ''biolab'', ''included'', null, null, ''essai'')',
    'select public.admin_set_subscription_plan((select v from ids where k=''orgA''), ''solo'', ''essai'')',
    'select public.admin_extend_trial((select v from ids where k=''orgA''), 7, ''essai'')',
    'select public.admin_grant_credit((select v from ids where k=''orgA''), 100, ''essai'')',
    'select public.admin_cancel_subscription_at_period_end((select v from ids where k=''orgA''), ''essai'')',
    'select public.admin_reactivate_subscription((select v from ids where k=''orgA''), ''essai'')',
    'select public.record_subscription_event((select v from ids where k=''orgA''), ''planChanged'', null, null, null, null, null, null, ''essai'', null)',
    'select public.admin_set_feature_flag(''aiDiagnosisEnabled'', false, ''essai'')',
    'select public.admin_set_billing_issuer(''{"siret":"x"}''::jsonb, ''essai'')',
    'select public.admin_start_support_session(''diagnostics'', ''essai'', (select v from ids where k=''orgA''))',
    'select public.admin_grant_platform_admin(''cc810001-0000-4000-8000-000000000081'', ''support'', ''essai'')',
    'select public.admin_set_mfa_policy(false, null, ''essai'')',
    'select * from public.saas_generate_invoices(''monthly'', date ''2026-12-01'', date ''2027-01-01'', ''essai'')'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('Analyste en lecture seule — « ' || left(f, 52) || '… » lève', 'true', refuse::text);
  end loop;
end $$;

-- ============================================================
-- 19. LES SIÈGES COMPRIS, ET L'ENGAGEMENT FONDATEUR
-- ============================================================
-- CE QUE CE PARAGRAPHE DÉFEND, et qui n'existait pas avant :
--   • les sièges compris sont décidés (1 / 5 / 10) et le compte est
--     juste — cinq utilisateurs sur Pro ne paient rien, sept en paient
--     deux ;
--   • une résiliation avant le terme de l'engagement est refusée PAR LA
--     BASE, y compris par un `update` tapé à la main ;
--   • un administrateur peut passer outre, avec un motif, et la trace
--     dit qui a levé quoi ;
--   • la preuve d'acceptation garde SON texte, même quand le texte
--     courant change ;
--   • un Fondateur annuel est refusé à la source, et le calcul refuse
--     de produire une facture bancale s'il en existait un malgré tout.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);

-- ------------------------------------------------------------
-- 19.a LES SIÈGES COMPRIS
-- ------------------------------------------------------------
insert into res select 'LES SIÈGES COMPRIS SONT DÉCIDÉS : 1, 5 et 10','1/5/10',
  (select string_agg(included_seats::text, '/' order by position)
     from public.organization_plans where key in ('solo','team','business'));

insert into res select 'Enterprise reste NON DÉCIDÉ : sa capacité se négocie','true',
  (select (included_seats is null)::text
     from public.organization_plans where key = 'enterprise');

-- `max_users` est l'indication que lit web-pro. La laisser en désaccord
-- avec `included_seats` donnerait deux vérités, dont une invisible.
insert into res select 'Et l''indication d''affichage dit la même chose que la facturation','1/5/10',
  (select string_agg(max_users::text, '/' order by position)
     from public.organization_plans where key in ('solo','team','business'));

insert into res select 'La grille affichée annonce les cinq utilisateurs de Pro','true',
  (select (features::text like '%5 utilisateurs compris%')::text
     from public.organization_plans where key = 'team');

do $$
declare
  v_org uuid;
  i integer;
  v_uid uuid;
begin
  -- L'entreprise est créée sous un compte qui n'est pas administrateur :
  -- le § 18.b vérifie qu'aucun administrateur n'est membre d'une
  -- entreprise cliente.
  perform set_config('request.jwt.claims',
    json_build_object('sub','cc810015-0000-4000-8000-000000000081')::text, true);
  v_org := public.create_professional_organization('Paysages Suite S','landscaper');
  perform set_config('request.jwt.claims',
    json_build_object('sub','cc810010-0000-4000-8000-000000000081','aal','aal2')::text, true);
  insert into ids values ('orgS', v_org);

  perform public.admin_create_subscription(
    v_org, 'team', 'monthly', 'Client Pro, pour éprouver le compte des sièges.', 'active');

  insert into res values ('Un Pro avec 1 utilisateur ne paie aucun siège en plus','0',
    public.subscription_billable_extra_seats(v_org)::text);

  -- On monte l'effectif un par un. La création passe par `auth.users`
  -- parce que `organization_members` y renvoie.
  for i in 2..10 loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, last_sign_in_at,
                            raw_app_meta_data, raw_user_meta_data)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'siege-' || v_uid::text || '@test.invalid', '', now(), now(), now(), now(), '{}', '{}');
    insert into public.organization_members (organization_id, user_id, role)
    values (v_org, v_uid, 'fieldWorker');

    if i = 3 then
      insert into res values ('UN PRO AVEC 3 UTILISATEURS N''EN PAIE AUCUN','0',
        public.subscription_billable_extra_seats(v_org)::text);
    elsif i = 5 then
      insert into res values ('UN PRO AVEC 5 UTILISATEURS N''EN PAIE AUCUN','0',
        public.subscription_billable_extra_seats(v_org)::text);
      insert into res values ('Et sa facture ne porte AUCUNE ligne de siège','0',
        (select count(*)::text from public.saas_subscription_billing_lines(
           v_org, date_trunc('month', current_date)::date,
           (date_trunc('month', current_date) + interval '1 month')::date)
         where kind = 'seats'));
    elsif i = 7 then
      insert into res values ('UN PRO AVEC 7 UTILISATEURS EN PAIE DEUX','2',
        public.subscription_billable_extra_seats(v_org)::text);
    end if;
  end loop;
end $$;

-- LE COMPTE PROPOSE, L'ADMINISTRATEUR DISPOSE, ET LA FACTURE SUIT.
do $$
declare v_org uuid := (select v from ids where k='orgS');
begin
  -- On redescend à sept membres : trois départs, archivés et non
  -- supprimés — un membre archivé n'occupe plus de siège.
  update public.organization_members set archived_at = now()
   where id in (select id from public.organization_members
                 where organization_id = v_org and archived_at is null
                 order by created_at desc limit 3);

  insert into res values ('Un membre ARCHIVÉ ne compte plus : sept membres, deux sièges','2',
    public.subscription_billable_extra_seats(v_org)::text);

  perform public.admin_set_billable_seats(
    v_org, public.subscription_billable_extra_seats(v_org),
    'Deux sièges au-delà des cinq compris par l''offre Pro.');

  insert into res values ('ET DEUX SIÈGES SE FACTURENT 19,80 € HT','2/990',
    (select quantity::integer || '/' || unit_price_cents::text
       from public.saas_subscription_billing_lines(
         v_org, date_trunc('month', current_date)::date,
         (date_trunc('month', current_date) + interval '1 month')::date)
      where kind = 'seats'));
end $$;

-- UN PRO BUSINESS AVEC DIX UTILISATEURS N'EN PAIE AUCUN.
do $$
declare v_org uuid := (select v from ids where k='orgS');
  v_uid uuid;
  i integer;
begin
  for i in 1..3 loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, last_sign_in_at,
                            raw_app_meta_data, raw_user_meta_data)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'siege-' || v_uid::text || '@test.invalid', '', now(), now(), now(), now(), '{}', '{}');
    insert into public.organization_members (organization_id, user_id, role)
    values (v_org, v_uid, 'fieldWorker');
  end loop;

  perform public.admin_set_subscription_plan(v_org, 'business', 'Montée en Pro Business.');

  insert into res values ('UN PRO BUSINESS AVEC 10 UTILISATEURS N''EN PAIE AUCUN','0',
    public.subscription_billable_extra_seats(v_org)::text);

  perform public.admin_set_billable_seats(
    v_org, public.subscription_billable_extra_seats(v_org),
    'Les dix sièges sont compris dans Pro Business.');

  insert into res values ('Et sa facture ne porte plus de ligne de siège','0',
    (select count(*)::text from public.saas_subscription_billing_lines(
       v_org, date_trunc('month', current_date)::date,
       (date_trunc('month', current_date) + interval '1 month')::date)
     where kind = 'seats'));
end $$;

-- ------------------------------------------------------------
-- 19.b L'ENGAGEMENT TIENT LA RÉSILIATION
-- ------------------------------------------------------------
do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.admin_cancel_subscription_at_period_end(
      (select v from ids where k='orgF'), 'Le client souhaite partir tout de suite.');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('RÉSILIER AVANT LE TERME DE L''ENGAGEMENT EST REFUSÉ','true',refuse::text);
  insert into res values ('Et le refus NOMME la date de fin d''engagement','true',
    (v_msg like '%01/01/2027%')::text);
end $$;

-- LE VERROU EST DANS LE DÉCLENCHEUR, PAS SEULEMENT DANS LA FONCTION :
-- il mord aussi sur l'`update` tapé dans l'éditeur SQL, et il mordra
-- sur le libre-service qui n'existe pas encore.
do $$
declare refuse boolean := false;
begin
  begin
    update public.organization_subscriptions set cancel_at_period_end = true
     where organization_id = (select v from ids where k='orgF');
  exception when others then refuse := true;
  end;
  insert into res values ('MÊME UN UPDATE DIRECT SUR LA TABLE EST REFUSÉ','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    update public.organization_subscriptions set status = 'cancelled'
     where organization_id = (select v from ids where k='orgF');
  exception when others then refuse := true;
  end;
  insert into res values ('Passer le statut à « cancelled » en direct aussi','true',refuse::text);
end $$;

-- ------------------------------------------------------------
-- 19.c LA DÉROGATION, AVEC MOTIF ET AVEC TRACE
-- ------------------------------------------------------------
do $$
begin
  perform public.admin_cancel_subscription_at_period_end(
    (select v from ids where k='orgF'),
    'Cessation d''activité du client, geste commercial acté par la direction.', true);

  insert into res values ('UN ADMINISTRATEUR PEUT PASSER OUTRE, AVEC UN MOTIF','true',
    (select cancel_at_period_end::text from public.organization_subscriptions
      where organization_id = (select v from ids where k='orgF')));

  insert into res values ('La dérogation ANNULE la remise, et dit qui et pourquoi','true',
    (select (d.cancelled_at is not null and d.cancelled_by is not null
             and d.cancelled_reason like 'Dérogation à l''engagement%')::text
       from public.subscription_discounts d
      where d.organization_id = (select v from ids where k='orgF') and d.code = 'FONDATEUR'));

  insert into res values ('Et elle laisse sa PROPRE trace au journal','1',
    (select count(*)::text from public.admin_audit_events
      where action = 'subscription.commitmentOverridden'
        and target_id = (select v from ids where k='orgF')));

  insert into res values ('La preuve d''acceptation, elle, ne bouge pas','1',
    (select count(*)::text from public.subscription_commitment_acceptances
      where organization_id = (select v from ids where k='orgF')));
end $$;

-- ------------------------------------------------------------
-- 19.d DEUX ACCEPTATIONS, DEUX TEXTES
-- ------------------------------------------------------------
-- Le texte courant change entre deux souscriptions. Chaque acceptation
-- garde SA version parce qu'elle garde SON texte : une référence vers
-- un document modifiable rendrait la première preuve fausse.
do $$
declare v_ancien text;
begin
  select a.terms_text into v_ancien from public.subscription_commitment_acceptances a
   where a.organization_id = (select v from ids where k='orgF');

  perform public.admin_set_commercial_config('billing.commitment.terms',
    jsonb_build_object(
      'version', '2026-06',
      'texte', 'Engagement de douze mois — rédaction révisée. Le tarif fondateur de 49,90 € HT '
            || 'par mois s''applique pendant douze mois sur l''offre Pro. La résiliation anticipée '
            || 'n''est pas possible. Au terme, le tarif public de 79,90 € HT par mois s''applique.'),
    'Refonte de la clause d''engagement par le service juridique.');

  perform public.admin_reactivate_subscription(
    (select v from ids where k='orgF'), 'Le client revient sur sa décision.');

  perform public.admin_apply_discount(
    (select v from ids where k='orgF'), 'FONDATEUR',
    'Nouvelle souscription fondateur, texte révisé.', current_date,
    (select config_value->>'texte' from public.commercial_config
      where config_key = 'billing.commitment.terms'), '2026-06');

  insert into res values ('DEUX ACCEPTATIONS, DEUX VERSIONS','2026-01,2026-06',
    (select string_agg(a.terms_version, ',' order by a.terms_version)
       from public.subscription_commitment_acceptances a
      where a.organization_id = (select v from ids where k='orgF')));

  insert into res values ('LA PREMIÈRE PREUVE N''A PAS BOUGÉ quand le texte a changé','true',
    (select (a.terms_text = v_ancien)::text
       from public.subscription_commitment_acceptances a
      where a.organization_id = (select v from ids where k='orgF')
        and a.terms_version = '2026-01'));

  insert into res values ('Et les deux textes sont bien différents','2',
    (select count(distinct a.terms_text)::text
       from public.subscription_commitment_acceptances a
      where a.organization_id = (select v from ids where k='orgF')));
end $$;

-- UNE PREUVE NE SE MODIFIE PAS, ET NE S'EFFACE PAS DEPUIS UN JETON.
insert into res select 'La preuve n''est ni modifiable ni effaçable depuis un jeton','false',
  (has_table_privilege('authenticated','public.subscription_commitment_acceptances','update')
   or has_table_privilege('authenticated','public.subscription_commitment_acceptances','delete'))::text;

-- ------------------------------------------------------------
-- 19.e LE FONDATEUR NE SE VEND QU'AU MOIS
-- ------------------------------------------------------------
-- orgB est abonnée à Pro À L'ANNÉE (§ 17). On rétablit son prix annuel,
-- retiré plus haut pour éprouver le MRR inconnu, sans quoi le refus
-- qu'on mesure ici pourrait venir du prix manquant.
select public.admin_set_plan_pricing('team', 7990, 79900,
  'Rétablissement du prix annuel après l''épreuve du MRR inconnu.');

do $$
declare refuse boolean := false; v_msg text;
begin
  begin
    perform public.admin_apply_discount(
      (select v from ids where k='orgB'), 'FONDATEUR',
      'Fondateur sur un abonnement annuel.', current_date,
      'Texte d''engagement affiché.', '2026-06');
  exception when others then refuse := true; v_msg := sqlerrm;
  end;
  insert into res values ('UN FONDATEUR SUR UN ABONNEMENT ANNUEL EST REFUSÉ À LA SOURCE','true',refuse::text);
  insert into res values ('Et le refus dit que la remise ne se vend qu''AU MOIS','true',
    (v_msg like '%AU MOIS%')::text);
end $$;

-- LE FILET, POUR UNE LIGNE ANTÉRIEURE AU VERROU. Les déclencheurs
-- rendent ces deux états impossibles ; on les fabrique en les
-- désactivant le temps de l'insertion, pour vérifier que le CALCUL ne
-- produit pas de facture bancale s'il en rencontrait un — c'est le
-- défaut que 0081 avait déjà sur les sièges, et qu'on ne refait pas.
alter table public.subscription_discounts disable trigger subscription_discounts_plan_guard;

insert into public.subscription_discounts
  (organization_id, code, label, kind, value_cents, applies_to_plan,
   starts_on, ends_on, commitment_ends_on, reason)
values ((select v from ids where k='orgB'), 'FONDATEUR', 'Tarif fondateur',
        'fixedMonthlyPrice', 4990, 'team',
        (date_trunc('month', current_date)::date - 1), (current_date + 300), (current_date + 300),
        'Ligne fabriquée pour éprouver le filet du calcul.');

insert into public.subscription_discounts
  (organization_id, code, label, kind, value_cents, applies_to_plan,
   starts_on, ends_on, reason)
values ((select v from ids where k='orgA'), 'FONDATEUR', 'Tarif fondateur',
        'fixedMonthlyPrice', 4990, 'team',
        (date_trunc('month', current_date)::date - 1), (current_date + 300),
        'Ligne fabriquée pour éprouver le filet du calcul.');

alter table public.subscription_discounts enable trigger subscription_discounts_plan_guard;

insert into res select 'UN FONDATEUR ANNUEL NE PRODUIT PAS DE FACTURE BANCALE : LA LIGNE BLOQUE','true',
  (select (unit_price_cents is null and blocking_reason like '%ANNUEL%')::text
     from public.saas_subscription_billing_lines(
       (select v from ids where k='orgB'), date_trunc('month', current_date)::date,
       (date_trunc('month', current_date) + interval '1 month')::date)
    where kind = 'discount');

insert into res select 'Et le MRR rend INCONNU plutôt qu''un montant inventé','INCONNU',
  coalesce(public.subscription_normalized_mrr_cents(
    (select v from ids where k='orgB'))::text, 'INCONNU');

-- orgA est en Pro Business ; la remise fabriquée vise Pro. Le calcul
-- refuse plutôt que d'appliquer 49,90 € à une offre à 139,90 € — ce
-- serait 90 € offerts par mois, sans que rien ne le signale.
insert into res select 'UNE REMISE VISANT UNE AUTRE OFFRE BLOQUE LA FACTURE','true',
  (select (unit_price_cents is null and blocking_reason like '%réservée à l''offre%')::text
     from public.saas_subscription_billing_lines(
       (select v from ids where k='orgA'), date_trunc('month', current_date)::date,
       (date_trunc('month', current_date) + interval '1 month')::date)
    where kind = 'discount');

insert into res select 'Et le MRR de ce client rend INCONNU, jamais le mauvais prix','INCONNU',
  coalesce(public.subscription_normalized_mrr_cents(
    (select v from ids where k='orgA'))::text, 'INCONNU');

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
