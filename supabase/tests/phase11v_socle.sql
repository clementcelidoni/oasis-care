-- Oasis Care — Phase 11V, LE SOCLE D'OASIS EXECUTIVE AI (migration 0072).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE CLOISONNEMENT. Une entreprise ne voit pas les décisions
--      d'une autre, ne peut pas répondre à ses demandes
--      d'approbation, et — le cas moins évident — ne peut pas
--      ACCROCHER une action à une entité ou à une décision de l'autre
--      en déclarant sa propre organisation. C'est la faille que 0062 a
--      dû réparer ailleurs : la politique RLS demandait « as-tu le
--      droit d'écrire chez toi ? », la réponse était oui, et personne
--      ne vérifiait l'autre bout de la ligne. La spec le réclame
--      nommément : « Organisation A jamais accessible par agents de
--      Organisation B. Tester explicitement. »
--
--   2. `ai_may_autoexecute`. C'est la seule fonction du produit qui
--      autorise une opération sans qu'un humain la regarde. On lui
--      retire ses quatre conditions UNE PAR UNE — niveau d'autonomie,
--      règle d'autopilote, plafond, droit de l'utilisateur — et elle
--      doit refuser à chaque fois ; elle ne doit accepter que lorsque
--      les quatre sont réunies. On lui tend aussi le contournement
--      évident : omettre le montant. Un test qui ne vérifierait que le
--      « oui » laisserait passer une fonction qui dit toujours oui.
--
--   3. L'IMPACT FINANCIER INCONNU. Il reste NULL et ne devient jamais
--      zéro. Ce projet a déjà payé deux fois la confusion (0059 sur
--      l'efficacité, 0067 sur les compteurs). On vérifie les deux
--      sens : l'absence reste absente, ET un vrai zéro reste zéro.
--
--   4. LES INTERDITS DE LA SPEC. Les trois automatismes que la page 36
--      met à OFF sont créés à OFF et refusent d'être allumés. Une
--      approbation vieille de trois jours ne peut plus être validée.
--      Une conclusion « données insuffisantes » ne peut pas porter de
--      montant.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les trois comptes de test.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================
-- Le troisième compte est l'ingrédient du test de permission : membre
-- à part entière de A, il conduit les chantiers mais n'a pas le droit
-- de facturer. C'est le seul moyen d'isoler la quatrième condition de
-- `ai_may_autoexecute` — un propriétaire les satisfait toutes.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000072-0000-4000-8000-000000000072','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','p11v-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000072-0000-4000-8000-000000000072','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','p11v-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000072-0000-4000-8000-000000000072','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','p11v-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000072-0000-4000-8000-000000000072')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Executive A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000072-0000-4000-8000-000000000072')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Executive B','landscaper');

-- Le conducteur de travaux de A : tout sur les chantiers, rien sur la
-- facturation.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000072-0000-4000-8000-000000000072', 'custom',
       array['projects.read','projects.manage','organization.manageUsers']
from ids where k='orgA';

-- Un client de chaque côté, pour les tentatives de cible croisée.
insert into ids select 'clientA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='clientA'), (select v from ids where k='orgA'),
       'Copropriété du Parc', 'company', 'customer';

insert into ids select 'clientB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='clientB'), (select v from ids where k='orgB'),
       'Mairie de Vallauris', 'company', 'customer';

-- ============================================================
-- 0. Les défauts posés à la création de l'entreprise
-- ============================================================
-- Le déclencheur de la section 13 a dû tourner pendant
-- `create_professional_organization`.

insert into res
select 'Les quatre agents de l''itération sont réglés','4',
       (select count(*)::text from public.ai_agent_settings
        where organization_id = (select v from ids where k='orgA'));

-- LE DÉFAUT QUI COMPTE. Un niveau 4 hérité, c'est une machine qui agit
-- au nom de quelqu'un qui n'a jamais ouvert l'écran.
insert into res
select 'Aucun agent n''est en autopilote par défaut','0',
       (select count(*)::text from public.ai_agent_settings
        where organization_id = (select v from ids where k='orgA') and autonomy_level = 4);

insert into res
select 'Le niveau par défaut est 1 (« advise ») pour tous','4',
       (select count(*)::text from public.ai_agent_settings
        where organization_id = (select v from ids where k='orgA') and autonomy_level = 1);

insert into res
select 'Les sept objectifs d''entreprise existent, tous éteints','7',
       (select count(*)::text from public.business_goals
        where organization_id = (select v from ids where k='orgA') and not enabled);

-- ---------- 4. Les automatismes que la spec veut à OFF ----------
insert into res
select 'Envoi automatique de factures : créé à OFF','false',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'sendInvoice');

insert into res
select 'Commandes fournisseurs : créé à OFF','false',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'purchaseOrderSend');

insert into res
select 'Modification de tarifs : créé à OFF','false',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'priceBookUpdate');

insert into res
select 'Relance de devis : proposé à ON','true',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'quoteFollowUp');

insert into res
select 'Brouillons de factures en fin de chantier : proposé à ON','true',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft');

insert into res
select 'Alerte de stock faible : proposée à ON','true',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'lowStockAlert');

-- ============================================================
-- On devient réellement l'utilisateur A
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','a0000072-0000-4000-8000-000000000072')::text, true);
set local role authenticated;

-- ---------- 4 bis. « À OFF, et qui le reste » ----------
-- Les créer désactivés ne suffirait pas : « à OFF » et « à OFF jusqu'à
-- ce que quelqu'un clique » ne sont pas la même promesse.
do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_autopilot_rules set enabled = true
     where organization_id = (select v from ids where k='orgA') and action_type = 'sendInvoice';
  exception when others then refuse := true;
  end;
  insert into res values ('L''envoi automatique de factures REFUSE d''être allumé','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_autopilot_rules set enabled = true
     where organization_id = (select v from ids where k='orgA') and action_type = 'purchaseOrderSend';
  exception when others then refuse := true;
  end;
  insert into res values ('La commande fournisseur REFUSE d''être allumée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_autopilot_rules set enabled = true
     where organization_id = (select v from ids where k='orgA') and action_type = 'priceBookUpdate';
  exception when others then refuse := true;
  end;
  insert into res values ('La modification de tarifs REFUSE d''être allumée','true',refuse::text);
end $$;

-- ============================================================
-- 3. L'impact financier inconnu
-- ============================================================

insert into ids
select 'decSansMontant', public.ai_open_decision(
  (select v from ids where k='orgA'), 'billing', 'urgent',
  'Dix chantiers terminés ne sont pas facturés',
  'medium',
  'Les réceptions sont signées, aucune facture n''existe.',
  90, '10 chantiers', null,
  '[{"table":"projects","ids":10}]'::jsonb,
  'Réceptions signées, aucune facture rattachée.',
  'Préparer les brouillons.',
  '[{"actionType":"createInvoiceDraft","label":"Préparer les brouillons"}]'::jsonb,
  'billing:unbilled:2026-09');

-- LE TEST DE 0059 ET 0067, RETOURNÉ CONTRE CETTE TABLE. Un
-- `not null default 0` rendrait « 0 » ici, et l'écran trierait cette
-- décision au fond, à côté des inutiles.
insert into res
select 'Un impact non chiffré reste INCONNU (et non zéro)','NULL',
       coalesce((select financial_impact_cents::text from public.ai_decisions
                 where id = (select v from ids where k='decSansMontant')), 'NULL');

-- Et l'inverse, tout aussi important : un vrai zéro n'est pas « on ne
-- sait pas ». Une optimisation à impact nul existe et se dit.
insert into ids
select 'decZero', public.ai_open_decision(
  (select v from ids where k='orgA'), 'finance', 'information',
  'Le regroupement des trajets du mardi ne change rien cette semaine',
  'high', null, 10, 'Aucun gain', 0,
  '[{"table":"interventions"}]'::jsonb, null, null, '[]'::jsonb, null);

insert into res
select 'Un impact réellement NUL vaut zéro, pas « inconnu »','0',
       coalesce((select financial_impact_cents::text from public.ai_decisions
                 where id = (select v from ids where k='decZero')), 'NULL');

-- « Données insuffisantes » et un montant chiffré sont contradictoires :
-- le montant serait une estimation déguisée, ce que la page 2 interdit.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision(
      (select v from ids where k='orgA'), 'quote_pricing', 'opportunite',
      'Le marché local paierait 12 % de plus', 'insufficient_data',
      null, 50, null, 1200000, '[]'::jsonb, null, null, '[]'::jsonb, null);
  exception when others then refuse := true;
  end;
  insert into res values ('« Données insuffisantes » interdit de chiffrer l''impact','true',refuse::text);
end $$;

insert into ids
select 'decInsuffisant', public.ai_open_decision(
  (select v from ids where k='orgA'), 'quote_pricing', 'information',
  'Aucune donnée de marché disponible pour Cannes', 'insufficient_data',
  null, 20, null, null, '[]'::jsonb,
  'Aucune source récente.', null, '[]'::jsonb, null);

insert into res
select 'Elle s''ouvre sans montant, et le dit','insufficient_data',
       (select confidence from public.ai_decisions
        where id = (select v from ids where k='decInsuffisant'));

-- ---------- Les énumérations refusées ----------
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision((select v from ids where k='orgA'),
      'billing', 'tres_urgent', 'Catégorie inventée', 'high');
  exception when others then refuse := true;
  end;
  insert into res values ('Une catégorie hors énumération est refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision((select v from ids where k='orgA'),
      'billing', 'urgent', 'Confiance inventée', 'tres_sur');
  exception when others then refuse := true;
  end;
  insert into res values ('Une confiance hors énumération est refusée','true',refuse::text);
end $$;

-- Hors périmètre de l'itération : les neuf autres agents n'existent pas,
-- et rien ne peut être ouvert en leur nom.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision((select v from ids where k='orgA'),
      'procurement', 'urgent', 'Un agent hors périmètre', 'high');
  exception when others then refuse := true;
  end;
  insert into res values ('Un agent hors périmètre ne peut rien ouvrir','true',refuse::text);
end $$;

-- Un bouton qui échoue au clic est pire qu'un bouton absent.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision((select v from ids where k='orgA'),
      'billing', 'urgent', 'Bouton fantaisiste', 'high', null, 50, null, null,
      '[]'::jsonb, null, null, '[{"actionType":"deleteEverything"}]'::jsonb, null);
  exception when others then refuse := true;
  end;
  insert into res values ('Une action proposée hors catalogue est refusée','true',refuse::text);
end $$;

-- Le balayage repasse chaque nuit : il ne doit pas empiler la même
-- décision.
insert into ids
select 'decDoublon', public.ai_open_decision(
  (select v from ids where k='orgA'), 'billing', 'urgent',
  'Dix chantiers terminés ne sont pas facturés', 'medium', null, 90, null, null,
  '[]'::jsonb, null, null, '[]'::jsonb, 'billing:unbilled:2026-09');

insert into res
select 'Rouverte à l''identique, la décision ne se dédouble pas','1',
       (select count(*)::text from public.ai_decisions
        where organization_id = (select v from ids where k='orgA')
          and dedupe_key = 'billing:unbilled:2026-09');

-- ---------- Répondre à une décision ----------
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_decision((select v from ids where k='decZero'), 'snoozed', null);
  exception when others then refuse := true;
  end;
  insert into res values ('Reporter sans date de réveil est refusé','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_decision((select v from ids where k='decZero'), 'snoozed',
                                      now() - interval '1 day');
  exception when others then refuse := true;
  end;
  insert into res values ('Reporter dans le passé est refusé','true',refuse::text);
end $$;

select public.ai_answer_decision((select v from ids where k='decZero'), 'snoozed',
                                 now() + interval '7 days');

insert into res
select 'Une décision reportée porte sa date de réveil','true',
       (select (status = 'snoozed' and snoozed_until is not null)::text
        from public.ai_decisions where id = (select v from ids where k='decZero'));

-- La date de réveil doit disparaître avec le report : laissée en place,
-- elle ferait ressurgir une décision déjà tranchée.
select public.ai_answer_decision((select v from ids where k='decZero'), 'accepted');

insert into res
select 'Sortir du report efface la date de réveil','true',
       (select (status = 'accepted' and snoozed_until is null)::text
        from public.ai_decisions where id = (select v from ids where k='decZero'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_decision((select v from ids where k='decZero'), 'peut_etre');
  exception when others then refuse := true;
  end;
  insert into res values ('Un statut de réponse inconnu est refusé','true',refuse::text);
end $$;

-- ---------- L'AIAuditEvent (spec p. 41) ----------
-- Pas de second journal : tout est dans `audit_events`, en source `ai`,
-- avec l'agent dans la charge utile.
insert into res
select 'Ouvrir une décision laisse une trace signée « ai »','true',
       (select exists (
          select 1 from public.audit_events
          where organization_id = (select v from ids where k='orgA')
            and source = 'ai'
            and action = 'aiDecisionOpened'
            and new_value ->> 'agent' = 'billing'
            and actor_user_id = 'a0000072-0000-4000-8000-000000000072'
        )::text);

-- ============================================================
-- 2. `ai_may_autoexecute` — la pièce critique
-- ============================================================
-- L'action de référence : `createInvoiceDraft`. Elle est éligible, elle
-- engage de l'argent, et elle exige `invoice.create`.

-- On réunit les quatre conditions.
update public.ai_agent_settings set autonomy_level = 4
 where organization_id = (select v from ids where k='orgA') and agent = 'billing';

update public.ai_autopilot_rules set maximum_amount_cents = 500000
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

insert into res
select 'Les quatre conditions réunies : VRAI','true',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

-- ---------- Condition 1 retirée : le niveau d'autonomie ----------
update public.ai_agent_settings set autonomy_level = 3
 where organization_id = (select v from ids where k='orgA') and agent = 'billing';

insert into res
select 'Sans le niveau 4, l''action ne part pas seule','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

-- Un agent ÉTEINT au niveau 4 est un agent éteint.
update public.ai_agent_settings set autonomy_level = 4, enabled = false
 where organization_id = (select v from ids where k='orgA') and agent = 'billing';

insert into res
select 'Un agent éteint ne part pas seul, fût-il au niveau 4','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

update public.ai_agent_settings set enabled = true
 where organization_id = (select v from ids where k='orgA') and agent = 'billing';

-- ---------- Condition 2 retirée : la règle d'autopilote ----------
update public.ai_autopilot_rules set enabled = false
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

insert into res
select 'Sans règle d''autopilote active, l''action ne part pas seule','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

update public.ai_autopilot_rules set enabled = true
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

-- ---------- Condition 3 retirée : le plafond ----------
insert into res
select 'Au-dessus du plafond, l''action ne part pas seule','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 500001)::text;

insert into res
select 'Exactement au plafond, elle passe','true',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 500000)::text;

-- LE CONTOURNEMENT ÉVIDENT : ne pas déclarer de montant. Sans la
-- colonne `carries_amount` du catalogue, `coalesce(montant, 0)` vaudrait
-- zéro, passerait sous n'importe quel plafond, et n'importe quelle
-- facture partirait seule.
insert into res
select 'Omettre le montant ne contourne pas le plafond','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', null)::text;

-- ---------- Condition 4 retirée : le droit de l'utilisateur ----------
-- Même organisation, mêmes réglages, même règle : seul le droit change.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000072-0000-4000-8000-000000000072')::text, true);
set local role authenticated;

insert into res
select 'Le conducteur de travaux voit bien le réglage à 4','4',
       (select autonomy_level::text from public.ai_agent_settings
        where organization_id = (select v from ids where k='orgA') and agent = 'billing');

insert into res
select 'Sans le droit de facturer, l''action ne part pas seule','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000072-0000-4000-8000-000000000072')::text, true);
set local role authenticated;

-- ---------- Les conditions au-delà des quatre ----------
insert into res
select 'Une action inconnue du catalogue ne part jamais seule','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'faireNimporteQuoi', 0)::text;

-- Le verrou de la spec, vu depuis la fonction : même si quelqu'un
-- parvenait à allumer la règle, l'action reste inéligible.
insert into res
select 'Un envoi de facture ne part jamais seul','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'sendInvoice', 1)::text;

-- Un agent hors périmètre n'a pas de réglage, donc pas de niveau 4.
insert into res
select 'Un agent hors périmètre ne part jamais seul','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'procurement', 'purchaseOrderSend', 1)::text;

-- La liste blanche de clients : renseignée, elle doit FERMER sur ce
-- qu'elle ne sait pas vérifier — y compris une action sans cible.
update public.ai_autopilot_rules
   set allowed_clients = array[(select v from ids where k='clientA')]
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

insert into res
select 'Liste blanche de clients : sans cible, on refuse','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

insert into res
select 'Liste blanche de clients : la bonne cible passe','true',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000,
         'customer', (select v from ids where k='clientA'))::text;

insert into res
select 'Liste blanche de clients : une autre cible est refusée','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000,
         'customer', (select v from ids where k='clientB'))::text;

update public.ai_autopilot_rules set allowed_clients = null
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

-- La plage horaire, avec une fenêtre volontairement fermée.
update public.ai_autopilot_rules set allowed_hours = int4range(0, 0)
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

insert into res
select 'Hors de la plage horaire autorisée, on refuse','false',
       public.ai_may_autoexecute((select v from ids where k='orgA'),
         'billing', 'createInvoiceDraft', 100000)::text;

update public.ai_autopilot_rules set allowed_hours = null
 where organization_id = (select v from ids where k='orgA') and action_type = 'createInvoiceDraft';

-- ---------- Rejouer les défauts n'écrase aucun choix ----------
update public.ai_autopilot_rules set maximum_amount_cents = 777
 where organization_id = (select v from ids where k='orgA') and action_type = 'quoteFollowUp';

reset role;
select public.ai_ensure_org_defaults((select v from ids where k='orgA'));
select set_config('request.jwt.claims',
  json_build_object('sub','a0000072-0000-4000-8000-000000000072')::text, true);
set local role authenticated;

insert into res
select 'Rejouer les défauts ne relève pas un plafond choisi','777',
       (select maximum_amount_cents::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'quoteFollowUp');

insert into res
select 'Rejouer les défauts ne rallume pas ce qui est éteint','false',
       (select enabled::text from public.ai_autopilot_rules
        where organization_id = (select v from ids where k='orgA') and action_type = 'sendInvoice');

-- ============================================================
-- 4. L'Action Engine et l'approbation qui expire
-- ============================================================

insert into ids select 'actionA', gen_random_uuid();
insert into public.ai_actions (id, organization_id, action_type, agent, decision_id,
                               target_entity_type, target_entity_id, risk_level, parameters)
select (select v from ids where k='actionA'), (select v from ids where k='orgA'),
       'createInvoiceDraft', 'billing', (select v from ids where k='decSansMontant'),
       'customer', (select v from ids where k='clientA'), 'medium',
       '{"montantHTCents": 3845000}'::jsonb;

insert into res
select 'Une action naît « proposed » et exige confirmation','proposed|true',
       (select status || '|' || requires_confirmation::text from public.ai_actions
        where id = (select v from ids where k='actionA'));

-- Une date d'exécution sans exécution, ou l'inverse : refusé.
do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_actions set status = 'executed'
     where id = (select v from ids where k='actionA');
  exception when others then refuse := true;
  end;
  insert into res values ('« Exécutée » sans date d''exécution est refusé','true',refuse::text);
end $$;

-- ---------- La demande d'approbation ----------
insert into ids
select 'approA', public.ai_request_approval((select v from ids where k='actionA'), null, interval '2 hours');

insert into res
select 'La demande hérite du risque de l''action','medium',
       (select risk from public.ai_action_approvals where id = (select v from ids where k='approA'));

insert into res
select 'L''action passe en attente d''approbation','awaiting_approval',
       (select status from public.ai_actions where id = (select v from ids where k='actionA'));

-- Un chèque en blanc n'est pas une demande.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_request_approval((select v from ids where k='actionA'), null, interval '30 days');
  exception when others then refuse := true;
  end;
  insert into res values ('Une demande ne peut pas courir un mois','true',refuse::text);
end $$;

-- LE TEST DE L'EXPIRATION. « Créer dix factures pour 38 450 € » validé
-- trois jours après avoir été posé porte sur des chantiers qui ont
-- peut-être bougé et des acomptes qui sont peut-être tombés : le oui
-- répond à une question qui n'existe plus.
update public.ai_action_approvals
   set expires_at = now() - interval '3 days'
 where id = (select v from ids where k='approA');

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_approval((select v from ids where k='approA'), true);
  exception when others then refuse := true;
  end;
  insert into res values ('Une approbation vieille de trois jours ne peut plus être acceptée','true',refuse::text);
end $$;

-- Le corollaire, qui est le vrai enjeu : l'action n'a pas bougé.
insert into res
select 'Et l''action n''est PAS approuvée pour autant','awaiting_approval',
       (select status from public.ai_actions where id = (select v from ids where k='actionA'));

-- Le ménage se fait par le balayage, qui, lui, ne lève rien.
insert into res
select 'Le balayage marque la demande périmée','1',
       public.ai_expire_stale_approvals((select v from ids where k='orgA'))::text;

insert into res
select 'La demande périmée porte le statut « expired »','expired',
       (select status from public.ai_action_approvals where id = (select v from ids where k='approA'));

insert into res
select 'Et l''action périmée aussi','expired',
       (select status from public.ai_actions where id = (select v from ids where k='actionA'));

-- ---------- Une approbation valide s'accepte ----------
insert into ids select 'action2', gen_random_uuid();
insert into public.ai_actions (id, organization_id, action_type, agent, risk_level)
select (select v from ids where k='action2'), (select v from ids where k='orgA'),
       'createInvoiceDraft', 'billing', 'medium';

insert into ids
select 'appro2', public.ai_request_approval((select v from ids where k='action2'));

select public.ai_answer_approval((select v from ids where k='appro2'), true);

insert into res
select 'Une approbation valide fait passer l''action à « approved »','approved',
       (select status from public.ai_actions where id = (select v from ids where k='action2'));

insert into res
select 'Et la réponse est signée et datée','true',
       (select (responded_by = 'a0000072-0000-4000-8000-000000000072'
                and responded_at is not null)::text
        from public.ai_action_approvals where id = (select v from ids where k='appro2'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_approval((select v from ids where k='appro2'), false);
  exception when others then refuse := true;
  end;
  insert into res values ('On ne répond pas deux fois à la même demande','true',refuse::text);
end $$;

-- ---------- 1. Le cloisonnement, vu de A ----------
-- A écrit chez A, la RLS est satisfaite — mais la cible est chez B.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_actions (organization_id, action_type, agent, risk_level,
                                   target_entity_type, target_entity_id)
    select (select v from ids where k='orgA'), 'createInvoiceDraft', 'billing', 'medium',
           'customer', (select v from ids where k='clientB');
  exception when others then refuse := true;
  end;
  insert into res values ('A ne peut pas viser un client de B','true',refuse::text);
end $$;

-- Une cible dont le type n'est pas connu de l'Action Engine : refusée,
-- parce qu'on ne saurait pas vérifier à qui elle appartient.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_actions (organization_id, action_type, agent, risk_level,
                                   target_entity_type, target_entity_id)
    select (select v from ids where k='orgA'), 'createInvoiceDraft', 'billing', 'medium',
           'grimoire', gen_random_uuid();
  exception when others then refuse := true;
  end;
  insert into res values ('Une cible de type inconnu est refusée','true',refuse::text);
end $$;

-- ---------- Les résultats mesurés ----------
insert into public.ai_decision_outcomes (organization_id, decision_id, accepted, metric,
                                         before_value, after_value, note)
select (select v from ids where k='orgA'), (select v from ids where k='decSansMontant'),
       true, 'margin_points', 21.0, 24.4, 'Recommandation +5 % appliquée en juin.';

insert into public.ai_decision_outcomes (organization_id, decision_id, accepted, metric, note)
select (select v from ids where k='orgA'), (select v from ids where k='decSansMontant'),
       true, 'conversion_points', 'Pas encore assez de devis pour conclure.';

insert into res
select 'Un « avant » non mesuré reste INCONNU (et non zéro)','NULL',
       coalesce((select before_value::text from public.ai_decision_outcomes
                 where decision_id = (select v from ids where k='decSansMontant')
                   and metric = 'conversion_points'), 'NULL');

-- ---------- Les cibles KPI ----------
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.organization_kpi_targets (organization_id, period_start, period_end)
    select v, date '2026-01-01', date '2026-12-31' from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('Une période sans aucune cible est refusée','true',refuse::text);
end $$;

insert into public.organization_kpi_targets (organization_id, period_start, period_end,
                                             margin_target_pct)
select v, date '2026-01-01', date '2026-12-31', 35.00 from ids where k='orgA';

insert into res
select 'Une cible de marge fixée, les autres restent INCONNUES','NULL',
       coalesce((select revenue_target_cents::text from public.organization_kpi_targets
                 where organization_id = (select v from ids where k='orgA')), 'NULL');

-- ---------- Les événements métier ----------
insert into ids
select 'evt', public.emit_business_event((select v from ids where k='orgA'),
  'project_completed', 'project', null, '{"nom":"Villa des Pins"}'::jsonb,
  'project_completed:villa-des-pins');

insert into res
select 'Un événement émis est en attente de traitement','true',
       (select (processed_at is null)::text from public.business_events
        where id = (select v from ids where k='evt'));

insert into res
select 'Le même événement réémis ne se dédouble pas','true',
       (public.emit_business_event((select v from ids where k='orgA'),
          'project_completed', 'project', null, '{}'::jsonb,
          'project_completed:villa-des-pins') is null)::text;

-- La table n'a AUCUNE politique d'insertion : un événement forgé
-- depuis le navigateur déclencherait une analyse sincère sur un fait
-- qui n'a pas eu lieu.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.business_events (organization_id, event_type)
    select v, 'invoice_overdue' from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('Un événement métier ne s''écrit pas à la main','true',refuse::text);
end $$;

-- ============================================================
-- 1. Le cloisonnement, vu de B
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000072-0000-4000-8000-000000000072')::text, true);
set local role authenticated;

insert into res
select 'B ne voit aucune décision de A','0',
       (select count(*)::text from public.ai_decisions);

insert into res
select 'B ne voit aucune action de A','0',
       (select count(*)::text from public.ai_actions);

insert into res
select 'B ne voit aucune demande d''approbation de A','0',
       (select count(*)::text from public.ai_action_approvals);

insert into res
select 'B ne voit aucun résultat mesuré de A','0',
       (select count(*)::text from public.ai_decision_outcomes);

insert into res
select 'B ne voit aucun événement métier de A','0',
       (select count(*)::text from public.business_events);

insert into res
select 'B ne voit aucune cible KPI de A','0',
       (select count(*)::text from public.organization_kpi_targets);

-- B ne voit que SES propres réglages d'agent — pas ceux de A.
insert into res
select 'B ne voit que ses quatre réglages d''agent','4',
       (select count(*)::text from public.ai_agent_settings);

insert into res
select 'B ne voit pas que l''agent de A est en autopilote','0',
       (select count(*)::text from public.ai_agent_settings where autonomy_level = 4);

-- LA TENTATIVE QUI COMPTE, N° 1. B écrit chez B — la RLS est donc
-- satisfaite — mais rattache son action à la DÉCISION de A. Sans la clé
-- composite `(id, organization_id)`, cette ligne passerait, et B
-- relierait ensuite ses actions au raisonnement de A.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_actions (organization_id, action_type, agent, risk_level, decision_id)
    select (select v from ids where k='orgB'), 'createInvoiceDraft', 'billing', 'medium',
           (select v from ids where k='decSansMontant');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas rattacher une action à une décision de A','true',refuse::text);
end $$;

-- LA TENTATIVE QUI COMPTE, N° 2. Même geste, mais sur la CIBLE :
-- l'entité est polymorphe, elle n'a pas de clé étrangère, et seule la
-- relecture de son organisation réelle la protège.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_actions (organization_id, action_type, agent, risk_level,
                                   target_entity_type, target_entity_id)
    select (select v from ids where k='orgB'), 'createInvoiceDraft', 'billing', 'medium',
           'customer', (select v from ids where k='clientA');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas viser un client de A','true',refuse::text);
end $$;

-- L'approbation de A est en `security invoker` : la ligne est
-- invisible, donc introuvable, donc sans réponse possible.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_approval((select v from ids where k='appro2'), false);
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas répondre à une approbation de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_answer_decision((select v from ids where k='decSansMontant'), 'rejected');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas répondre à une décision de A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision((select v from ids where k='orgA'),
      'billing', 'urgent', 'Décision plantée chez le voisin', 'high');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas ouvrir une décision chez A','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.emit_business_event((select v from ids where k='orgA'), 'invoice_overdue');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas émettre un événement chez A','true',refuse::text);
end $$;

-- B tente de RABAISSER l'agent de A à zéro. Rabaisser et non élever :
-- A l'a déjà mis à 4, et « le remettre à 4 » aurait laissé la valeur
-- inchangée que la tentative réussisse ou non — un test vert sur une
-- base trouée. Ici, la vérification hors de la peau de B distingue
-- vraiment les deux cas.
do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_agent_settings set autonomy_level = 0
     where organization_id = (select v from ids where k='orgA');
    if not found then refuse := true; end if;   -- la RLS masque, donc rien n'est touché
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas toucher au réglage d''un agent de A','true',refuse::text);
end $$;

-- Et B ne peut pas se donner à lui-même ce que la spec interdit.
insert into res
select 'B non plus ne part pas seul sur un envoi de facture','false',
       public.ai_may_autoexecute((select v from ids where k='orgB'),
         'billing', 'sendInvoice', 1)::text;

reset role;

-- Vérifié UNE FOIS SORTI de la peau de B, et c'est essentiel : posées
-- pendant que la RLS de B masque les lignes, ces questions auraient
-- rendu zéro quoi qu'il arrive — un test qui passe même quand tout est
-- cassé. Ici les requêtes voient vraiment les lignes de A.
insert into res
select 'L''agent de A est resté au niveau où A l''avait laissé','4',
       (select autonomy_level::text from public.ai_agent_settings
        where organization_id = (select v from ids where k='orgA') and agent = 'billing');

insert into res
select 'La décision de A est restée telle quelle','new',
       (select status from public.ai_decisions where id = (select v from ids where k='decSansMontant'));

insert into res
select 'L''approbation de A est restée approuvée','approved',
       (select status from public.ai_action_approvals where id = (select v from ids where k='appro2'));

insert into res
select 'Aucune action de B n''a été créée','0',
       (select count(*)::text from public.ai_actions
        where organization_id = (select v from ids where k='orgB'));

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
