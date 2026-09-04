-- Oasis Care — LES CONVERSATIONS AVEC L'ASSISTANT (migration 0079).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE CLOISONNEMENT, AUX DEUX BOUTS. Une entreprise ne lit pas les
--      fils d'une autre — et, le cas moins évident, ne peut pas
--      ACCROCHER un message au fil d'une autre, ni rattacher un message
--      à la décision d'une autre, en déclarant sa propre organisation.
--      C'est la faille que 0062 a dû réparer ailleurs : la politique
--      demandait « as-tu le droit d'écrire chez toi ? », la réponse
--      était oui, et personne ne regardait l'autre bout de la ligne.
--
--   2. UN FIL EST PERSONNEL. Un collègue de la MÊME entreprise, avec
--      les mêmes droits, ne lit pas les conversations d'un autre. C'est
--      le réglage le plus fermé, celui que 0079 a posé faute de mandat
--      pour l'ouvrir ; s'il se relâchait un jour par accident, ce sont
--      des marges et des noms de clients qui changeraient de mains.
--
--   3. LES BORNES TIENNENT. Un fil sans limite coûte de plus en plus
--      cher à chaque question, puisqu'on renvoie l'historique au
--      modèle. On vérifie la taille d'une question, celle d'une
--      réponse, le nombre de messages d'un fil — et surtout que la
--      QUEUE REJOUÉE reste bornée même quand l'appelant demande le
--      contraire, avec le drapeau « tronque » qui sort du même calcul.
--
--   4. UN COMPTE SUPPRIMÉ NE LAISSE RIEN. Suppression dure ET
--      suppression douce (`deleted_at` posé sans destruction de la
--      ligne `auth.users`), qui est le seul trou de la cascade — celui
--      que 0077 a mesuré la veille sur la télémétrie.
--
--   5. CE QUI EST DIT EST DIT. Un message ne se réécrit pas : c'est lui
--      qu'on renvoie au modèle en affirmant que c'est le tour
--      précédent.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les comptes de test.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — deux entreprises, six comptes
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000079-0000-4000-8000-000000000079','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','conv-patron-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000079-0000-4000-8000-000000000079','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','conv-patron-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000079-0000-4000-8000-000000000079','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','conv-collegue-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('d0000079-0000-4000-8000-000000000079','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','conv-jetable-dur@test.invalid','',now(),now(),now(),'{}','{}'),
 ('e0000079-0000-4000-8000-000000000079','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','conv-jetable-doux@test.invalid','',now(),now(),now(),'{}','{}'),
 ('f0000079-0000-4000-8000-000000000079','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','conv-parti@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000079-0000-4000-8000-000000000079')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000079-0000-4000-8000-000000000079')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages B','landscaper');

-- Le collègue de A est `manager` : mêmes droits de lecture et
-- d'écriture métier que le patron. S'il ne voit pas les fils du patron,
-- ce n'est donc pas faute de permission — c'est bien la clause
-- `user_id = auth.uid()` qui travaille.
--
-- Il est AUSSI membre de B. C'est ce qui permet le test le plus
-- important du § 4 : un compte qui appartient légitimement aux deux
-- entreprises et qui essaie de faire porter à un message l'organisation
-- de l'autre.
insert into public.organization_members (organization_id, user_id, role)
select v, 'c0000079-0000-4000-8000-000000000079', 'manager' from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role)
select v, 'c0000079-0000-4000-8000-000000000079', 'manager' from ids where k='orgB';

insert into public.organization_members (organization_id, user_id, role)
select v, 'd0000079-0000-4000-8000-000000000079', 'manager' from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role)
select v, 'e0000079-0000-4000-8000-000000000079', 'manager' from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role)
select v, 'f0000079-0000-4000-8000-000000000079', 'manager' from ids where k='orgA';

-- Une décision chez chacun : c'est à elles qu'on rattachera — ou qu'on
-- essaiera de rattacher — un message.
insert into ids select 'decisionA', gen_random_uuid();
insert into public.ai_decisions (id, organization_id, title, agent, category, confidence)
select (select v from ids where k='decisionA'), (select v from ids where k='orgA'),
       'Facturer 10 chantiers terminés', 'executive', 'urgent', 'high';

insert into ids select 'decisionA2', gen_random_uuid();
insert into public.ai_decisions (id, organization_id, title, agent, category, confidence)
select (select v from ids where k='decisionA2'), (select v from ids where k='orgA'),
       'Relancer trois devis', 'executive', 'important', 'medium';

insert into ids select 'decisionB', gen_random_uuid();
insert into public.ai_decisions (id, organization_id, title, agent, category, confidence)
select (select v from ids where k='decisionB'), (select v from ids where k='orgB'),
       'Marge de B, 42 %', 'finance', 'information', 'high';

-- ============================================================
-- On devient réellement le patron de A
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','a0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

-- ============================================================
-- 1. LE FIL ET SON TITRE
-- ============================================================

insert into ids select 'filA', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filA'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079';

-- Un fil ouvert et pas encore parlé n'a NI titre NI date d'activité.
-- Un `default now()` sur la seconde rendrait un fil vide indiscernable
-- d'un fil muet depuis trois mois, et la liste ne saurait plus les
-- séparer.
insert into res
select 'Un fil qui n''a rien porté n''a pas de titre','NULL',
       coalesce((select title from public.ai_conversations
                 where id = (select v from ids where k='filA')), 'NULL');

insert into res
select 'Un fil qui n''a rien porté n''a pas de date d''activité','NULL',
       coalesce((select last_message_at::text from public.ai_conversations
                 where id = (select v from ids where k='filA')), 'NULL');

-- La première question titre le fil. Cent quarante caractères en
-- entrée : le titre doit être coupé, au dernier mot entier, et le dire.
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filA'), 'user',
       'Peux-tu me préparer la facture du chantier Durand, celui de la terrasse en pierre, '
       || 'et me dire combien il reste à encaisser sur ce client ?';

insert into res
select 'Le titre est dérivé de la première question','Peux-tu me préparer la facture du chantier Durand, celui de…',
       (select title from public.ai_conversations where id = (select v from ids where k='filA'));

-- Soixante caractères plus les points de suspension, jamais davantage —
-- et souvent un peu moins, puisqu'on recule jusqu'au dernier mot
-- entier.
insert into res
select 'Le titre ne dépasse jamais 61 caractères','true',
       (select (char_length(title) <= 61)::text from public.ai_conversations
         where id = (select v from ids where k='filA'));

insert into res
select 'Un titre coupé le dit','true',
       (select (right(title, 1) = '…')::text from public.ai_conversations
         where id = (select v from ids where k='filA'));

insert into res
select 'Poser un message donne une date d''activité au fil','true',
       (select (last_message_at is not null)::text from public.ai_conversations
         where id = (select v from ids where k='filA'));

-- La réponse arrive : elle ne retitre rien, et le titre vient de ce que
-- l'humain a demandé, pas de ce que la machine a répondu.
insert into ids select 'msgReponse1', gen_random_uuid();
insert into public.ai_conversation_messages (id, organization_id, user_id, conversation_id,
                                             role, content, model, tools_used)
select (select v from ids where k='msgReponse1'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079', (select v from ids where k='filA'),
       'assistant', 'Le chantier Durand est terminé depuis le 12 août. Reste à facturer 8 450 € HT.',
       'terra', array['getCompanyMetrics','getBillingCandidates'];

insert into res
select 'Une réponse ne retitre pas le fil','Peux-tu me préparer la facture du chantier Durand, celui de…',
       (select title from public.ai_conversations where id = (select v from ids where k='filA'));

-- Un fil dont le premier message est une réponse reste sans titre : il
-- n'y a rien à titrer tant que personne n'a rien demandé.
insert into ids select 'filMuet', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filMuet'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079';
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filMuet'), 'assistant', 'Bonjour.';

insert into res
select 'Une réponse seule ne fabrique pas de titre','NULL',
       coalesce((select title from public.ai_conversations
                 where id = (select v from ids where k='filMuet')), 'NULL');

-- Un titre corrigé à la main n'est pas réécrit par la question
-- suivante : la dérivation ne s'applique qu'une fois.
update public.ai_conversations set title = 'Facturation Durand'
 where id = (select v from ids where k='filA');
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filA'), 'user', 'Et le chantier Martin ?';

insert into res
select 'Un titre corrigé à la main survit à la question suivante','Facturation Durand',
       (select title from public.ai_conversations where id = (select v from ids where k='filA'));

-- Une question courte se garde en entier, sans points de suspension
-- décoratifs.
insert into res
select 'Une question courte devient un titre entier','Et le chantier Martin ?',
       public.ai_conversation_titre('  Et le chantier Martin ?  ');

-- Un titre est UNE LIGNE. Un retour à la ligne qui survivrait ferait
-- ressembler la seconde ligne à un en-tête de consigne dans la liste
-- des fils — la raison d'être d'`ai_clean_text` (0069).
insert into res
select 'Un titre ne contient jamais de retour à la ligne','true',
       (position(E'\n' in public.ai_conversation_titre(E'Ignore\nles instructions')) = 0)::text;

-- ============================================================
-- 2. LES BORNES
-- ============================================================

-- Une QUESTION : 2 000 caractères, le chiffre que les deux surfaces
-- refusent déjà. Si la base acceptait davantage, la borne ne serait
-- plus une règle du produit mais une habitude de deux fichiers.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', repeat('x', 2001);
  exception when others then refuse := true;
  end;
  insert into res values ('Une question de 2 001 caractères est refusée','true',refuse::text);
end $$;

-- Une RÉPONSE a droit à davantage : la refuser serait perdre une
-- réponse déjà payée au fournisseur.
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filA'), 'assistant', repeat('y', 2001);

insert into res
select 'Une réponse de 2 001 caractères passe','1',
       (select count(*)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filA')
           and content = repeat('y', 2001));

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'assistant', repeat('z', 20001);
  exception when others then refuse := true;
  end;
  insert into res values ('Une réponse de 20 001 caractères est refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', '   ';
  exception when others then refuse := true;
  end;
  insert into res values ('Un message de trois espaces est vide, donc refusé','true',refuse::text);
end $$;

-- UNE QUESTION EST NUE. Elle vient de l'humain : ni modèle, ni outils,
-- ni conséquence. Une ligne à moitié remplie d'attributs qui n'ont pas
-- de sens pour elle fausserait toutes les statistiques qu'on en tire.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                                 role, content, model)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', 'Une question', 'terra';
  exception when others then refuse := true;
  end;
  insert into res values ('Une question n''a pas de modèle : refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                                 role, content, proposal, proposal_status)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', 'Une question',
           '{"kind":"createCustomer"}'::jsonb, 'pending';
  exception when others then refuse := true;
  end;
  insert into res values ('Une question ne porte pas de proposition : refusée','true',refuse::text);
end $$;

-- Une proposition sans statut serait un bouton dont on ne sait pas s'il
-- a été cliqué.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                                 role, content, proposal)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'assistant', 'Je peux créer la fiche.',
           '{"kind":"createCustomer"}'::jsonb;
  exception when others then refuse := true;
  end;
  insert into res values ('Une proposition sans statut est refusée','true',refuse::text);
end $$;

-- NULL et '{}' ne disent pas la même chose sur les outils : « on ne
-- sait pas » et « rien consulté ». Un `default '{}'` écraserait la
-- première phrase avec la seconde.
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                             role, content, tools_used)
select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filA'), 'assistant', 'Réponse sans aucun outil.', '{}'::text[];

insert into res
select '« Aucun outil » se distingue de « on ne sait pas »','true',
       (select (tools_used is not null and coalesce(array_length(tools_used,1),0) = 0)::text
          from public.ai_conversation_messages
         where content = 'Réponse sans aucun outil.');

-- LE NOMBRE DE MESSAGES PAR FIL. Au-delà, on refuse — on n'ampute pas :
-- un fil rogné par le haut ment sur ce qu'il contient, et la queue du
-- § 6 le rejouerait comme s'il était complet.
insert into ids select 'filPlein', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filPlein'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079';

do $$
declare i int;
begin
  for i in 1..public.ai_conversation_messages_max() loop
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filPlein'),
           case when i % 2 = 1 then 'user' else 'assistant' end,
           'Tour numéro ' || i;
  end loop;
end $$;

insert into res
select 'Un fil accepte exactement sa limite de messages',
       public.ai_conversation_messages_max()::text,
       (select count(*)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filPlein'));

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filPlein'), 'user', 'Un de trop.';
  exception when others then refuse := true;
  end;
  insert into res values ('Le message suivant est refusé, pas le premier effacé','true',refuse::text);
end $$;

-- ============================================================
-- 3. CE QUI EST DIT EST DIT
-- ============================================================

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_conversation_messages
       set content = 'Reste à facturer 84 500 € HT.'
     where id = (select v from ids where k='msgReponse1');
  exception when others then refuse := true;
  end;
  insert into res values ('Une réponse déjà écrite ne se corrige pas','true',refuse::text);
end $$;

insert into res
select 'Et son contenu est resté intact',
       'Le chantier Durand est terminé depuis le 12 août. Reste à facturer 8 450 € HT.',
       (select content from public.ai_conversation_messages
         where id = (select v from ids where k='msgReponse1'));

-- Une conséquence s'ATTACHE après coup — le bouton est cliqué plus
-- tard — mais ne se remplace pas : réattribuer un message à une autre
-- décision réécrirait l'histoire d'une entreprise.
update public.ai_conversation_messages
   set decision_id = (select v from ids where k='decisionA')
 where id = (select v from ids where k='msgReponse1');

insert into res
select 'Une conséquence s''attache après coup','true',
       (select (decision_id = (select v from ids where k='decisionA'))::text
          from public.ai_conversation_messages where id = (select v from ids where k='msgReponse1'));

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_conversation_messages
       set decision_id = (select v from ids where k='decisionA2')
     where id = (select v from ids where k='msgReponse1');
  exception when others then refuse := true;
  end;
  insert into res values ('Une conséquence attachée ne se réattribue pas','true',refuse::text);
end $$;

-- Le statut d'une proposition avance dans un seul sens.
insert into ids select 'msgProp', gen_random_uuid();
insert into public.ai_conversation_messages (id, organization_id, user_id, conversation_id,
                                             role, content, proposal, proposal_status)
select (select v from ids where k='msgProp'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079', (select v from ids where k='filA'),
       'assistant', 'Je peux créer la fiche client Durand.',
       '{"kind":"createCustomer","args":{"displayName":"Durand"}}'::jsonb, 'pending';

update public.ai_conversation_messages set proposal_status = 'executed'
 where id = (select v from ids where k='msgProp');

insert into res
select 'Une proposition en attente peut être exécutée','executed',
       (select proposal_status from public.ai_conversation_messages
         where id = (select v from ids where k='msgProp'));

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_conversation_messages set proposal_status = 'pending'
     where id = (select v from ids where k='msgProp');
  exception when others then refuse := true;
  end;
  insert into res values ('Une proposition exécutée ne redevient pas en attente','true',refuse::text);
end $$;

-- UN MESSAGE NE SE SUPPRIME PAS UN PAR UN. Un fil troué en son milieu
-- se rejouerait au modèle comme s'il était complet. Ni politique de
-- `delete`, ni droit `delete` : deux verrous, et le second est celui
-- qui parle ici, puisque Supabase accorde tout par défaut.
do $$
declare refuse boolean := false;
begin
  begin
    delete from public.ai_conversation_messages
     where id = (select v from ids where k='msgReponse1');
  exception when others then refuse := true;
  end;
  insert into res values ('Un message ne se supprime pas un par un','true',refuse::text);
end $$;

insert into res
select 'Et il est toujours là','1',
       (select count(*)::text from public.ai_conversation_messages
         where id = (select v from ids where k='msgReponse1'));

-- ------------------------------------------------------------
-- 3 bis. SUPPRIMER LA CONSÉQUENCE NE DOIT PAS BLOQUER LA SUPPRESSION
-- ------------------------------------------------------------
-- La table déclare `on delete set null (decision_id)` et explique
-- pourquoi : supprimer une décision ne doit pas trouer la conversation.
-- La première version du déclencheur « ce qui est dit est dit »
-- refusait pourtant TOUT changement de `decision_id` dès qu'il valait
-- quelque chose — y compris vers NULL. Or c'est exactement par un
-- UPDATE que PostgreSQL applique un `set null` : c'était donc la
-- SUPPRESSION DE LA DÉCISION qui échouait, dans un fichier dont tout le
-- § 8 dit que la suppression doit l'emporter.
--
-- Aucun appelant vivant ne supprime de décision aujourd'hui, et les
-- chemins réels (compte, entreprise) passent parce que la cascade des
-- messages s'exécute d'abord. C'est un ordre d'exécution, pas une
-- garantie : le premier script de ménage tombait sur le mur.
--
-- On supprime hors du rôle `authenticated` : c'est la position d'un
-- script de ménage ou d'une purge RGPD, et c'est là que le mur était.
-- Une décision et une action JETABLES, pour ne pas priver les tests de
-- cloisonnement du § 4 de leur cible.
insert into ids select 'decisionJetable', gen_random_uuid();
insert into public.ai_decisions (id, organization_id, title, agent, category, confidence)
select (select v from ids where k='decisionJetable'), (select v from ids where k='orgA'),
       'Décision que l''on supprimera', 'executive', 'information', 'medium';

insert into ids select 'actionJetable', gen_random_uuid();
insert into public.ai_actions (id, organization_id, action_type, agent, risk_level, status)
select (select v from ids where k='actionJetable'), (select v from ids where k='orgA'),
       (select action_type from public.ai_action_catalog order by action_type limit 1),
       'executive', 'low', 'proposed';

insert into ids select 'msgConsequences', gen_random_uuid();
insert into public.ai_conversation_messages (id, organization_id, user_id, conversation_id,
                                             role, content, decision_id, action_id)
select (select v from ids where k='msgConsequences'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079', (select v from ids where k='filA'),
       'assistant', 'J''ai ouvert une décision et préparé une action.',
       (select v from ids where k='decisionJetable'),
       (select v from ids where k='actionJetable');

reset role;

do $$
declare echoue boolean := false;
begin
  begin
    delete from public.ai_decisions where id = (select v from ids where k='decisionJetable');
  exception when others then echoue := true;
  end;
  insert into res values ('Supprimer une décision citée par un message ne lève pas','false',echoue::text);
end $$;

insert into res
select 'Le message survit à la décision supprimée','1',
       (select count(*)::text from public.ai_conversation_messages
         where id = (select v from ids where k='msgConsequences'));

insert into res
select 'Et sa conséquence est retombée à NULL','true',
       (select (decision_id is null)::text from public.ai_conversation_messages
         where id = (select v from ids where k='msgConsequences'));

do $$
declare echoue boolean := false;
begin
  begin
    delete from public.ai_actions where id = (select v from ids where k='actionJetable');
  exception when others then echoue := true;
  end;
  insert into res values ('Supprimer une action citée par un message ne lève pas','false',echoue::text);
end $$;

insert into res
select 'Le message survit à l''action supprimée, sans conséquence','true',
       (select (action_id is null)::text from public.ai_conversation_messages
         where id = (select v from ids where k='msgConsequences'));

set local role authenticated;

-- ------------------------------------------------------------
-- 3 ter. `payload` — LA COUCHE AFFICHÉE, ET SES BORNES
-- ------------------------------------------------------------
-- `content` porte la substance, parce que c'est lui qu'on renvoie au
-- modèle ; `payload` porte ce qui s'affiche en plus — raisons repliées,
-- confiance, avertissements du runtime, actions préparées. Sans lui,
-- l'écran avait perdu tout ce que l'architecture IA a délibérément
-- sorti du résumé, et une réponse fondée sur des données absentes
-- s'affichait comme un paragraphe assuré.
insert into ids select 'msgPayload', gen_random_uuid();
insert into public.ai_conversation_messages (id, organization_id, user_id, conversation_id,
                                             role, content, payload)
select (select v from ids where k='msgPayload'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079', (select v from ids where k='filA'),
       'assistant', 'Trois chantiers dépassent leur budget.',
       '{"analyse":{"confiance":"medium","ambigu":false,"raisons":[]},
         "avertissements":["Analyse partielle : le droit finance.read manque à ce compte."],
         "actions":[]}'::jsonb;

insert into res
select 'Une réponse peut porter sa couche affichée','true',
       (select (payload -> 'avertissements' ->> 0 is not null)::text
          from public.ai_conversation_messages where id = (select v from ids where k='msgPayload'));

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                                 role, content, payload)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', 'Et les marges ?', '{"analyse":{}}'::jsonb;
  exception when others then refuse := true;
  end;
  insert into res values ('Une question ne porte pas de couche affichée : refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                                 role, content, payload)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'assistant', 'Réponse volumineuse.',
           jsonb_build_object('bruit', repeat('x', 40001));
  exception when others then refuse := true;
  end;
  insert into res values ('Une couche affichée de 40 001 caractères est refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_conversation_messages set payload = '{"analyse":{"confiance":"high"}}'::jsonb
     where id = (select v from ids where k='msgPayload');
  exception when others then refuse := true;
  end;
  insert into res values ('La couche affichée ne se réécrit pas non plus','true',refuse::text);
end $$;

-- ============================================================
-- 4. LE CLOISONNEMENT, ET LE FIL PERSONNEL
-- ============================================================

-- ---------- Vu du collègue, dans la MÊME entreprise ----------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into res
select 'Un collègue de la même entreprise ne voit AUCUN fil du patron','0',
       (select count(*)::text from public.ai_conversations);

insert into res
select 'Ni aucun de ses messages','0',
       (select count(*)::text from public.ai_conversation_messages);

-- Il a pourtant `projects.read` et `projects.manage` : ce n'est donc
-- pas la permission qui le retient, c'est `user_id = auth.uid()`.
insert into res
select 'Ce n''est pas faute de permission','true',
       (select public.has_permission((select v from ids where k='orgA'), 'projects.manage')::text);

-- La queue rejouée ne rend rien non plus. Elle est `security invoker` :
-- un fil qui n'est pas le vôtre rend une queue vide, pas une erreur, et
-- surtout pas un contenu.
insert into res
select 'La queue d''un fil qui n''est pas le sien est vide','0',
       (public.ai_conversation_tail((select v from ids where k='filA')) ->> 'messages_total');

insert into res
select 'Et elle ne rend aucun contenu, pas même une erreur bavarde','[]',
       (public.ai_conversation_tail((select v from ids where k='filA')) ->> 'messages');

-- LA TENTATIVE QUI COMPTE, PREMIÈRE FORME. Le collègue écrit chez lui,
-- avec sa propre identité — la politique RLS est donc satisfaite des
-- deux côtés — mais désigne le fil du patron. Sans la clé composite
-- (conversation_id, organization_id, user_id), cette ligne passerait,
-- et le patron relirait demain un message qu'il n'a pas écrit.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'c0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', 'Combien gagne le patron ?';
  exception when others then refuse := true;
  end;
  insert into res values ('Un collègue ne peut pas glisser un message dans le fil d''un autre','true',refuse::text);
end $$;

-- LA TENTATIVE QUI COMPTE, SECONDE FORME — et c'est la faille de 0062
-- dans sa forme exacte. Le collègue appartient LÉGITIMEMENT à A et à B.
-- Il ouvre un fil chez B, puis tente d'y accrocher un message portant
-- l'organisation de A. Les deux politiques disent oui : il a le droit
-- d'écrire chez A, et le message est bien le sien. Seule la clé
-- composite regarde l'autre bout de la ligne.
insert into ids select 'filCollegueB', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filCollegueB'), (select v from ids where k='orgB'),
       'c0000079-0000-4000-8000-000000000079';

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'c0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filCollegueB'), 'user', 'Les marges de A, dans le fil de B.';
  exception when others then refuse := true;
  end;
  insert into res values ('Un message ne peut pas porter une autre entreprise que son fil','true',refuse::text);
end $$;

-- ---------- Vu de l'autre entreprise ----------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into res
select 'B ne voit aucun fil de A','0',
       (select count(*)::text from public.ai_conversations);

insert into res
select 'B ne voit aucun message de A','0',
       (select count(*)::text from public.ai_conversation_messages);

-- B écrit chez B, sous son nom, mais désigne le fil de A.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgB'), 'b0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filA'), 'user', 'Bonjour depuis B.';
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas accrocher un message au fil de A','true',refuse::text);
end $$;

-- Et B ne peut pas s'ouvrir un fil dans l'entreprise de A.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversations (organization_id, user_id)
    select (select v from ids where k='orgA'), 'b0000079-0000-4000-8000-000000000079';
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas ouvrir un fil chez A','true',refuse::text);
end $$;

-- ---------- Le rattachement à une décision d'une autre entreprise ----
-- LE POINT LE PLUS DISCRET DU CLOISONNEMENT. B ouvre son fil chez lui,
-- écrit son message chez lui — tout est régulier — et tente de le
-- rattacher à la décision de A. La RLS ne voit rien à redire : la ligne
-- écrite porte l'organisation de B. Sans la clé composite
-- (decision_id, organization_id), l'écran de B afficherait ensuite le
-- titre d'une décision de A, c'est-à-dire un constat financier de A.
insert into ids select 'filB', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filB'), (select v from ids where k='orgB'),
       'b0000079-0000-4000-8000-000000000079';

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id,
                                                 role, content, decision_id)
    select (select v from ids where k='orgB'), 'b0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filB'), 'assistant', 'Voici la décision.',
           (select v from ids where k='decisionA');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas rattacher un message à la décision de A','true',refuse::text);
end $$;

-- La même tentative en `update`, parce que la colonne s'attache après
-- coup : le chemin le plus probable en vrai est celui-là.
insert into ids select 'msgB', gen_random_uuid();
insert into public.ai_conversation_messages (id, organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='msgB'), (select v from ids where k='orgB'),
       'b0000079-0000-4000-8000-000000000079', (select v from ids where k='filB'),
       'assistant', 'Une réponse ordinaire.';

do $$
declare refuse boolean := false;
begin
  begin
    update public.ai_conversation_messages
       set decision_id = (select v from ids where k='decisionA')
     where id = (select v from ids where k='msgB');
  exception when others then refuse := true;
  end;
  insert into res values ('Ni après coup, par un update','true',refuse::text);
end $$;

-- Chez lui, en revanche, le rattachement fonctionne : le verrou coupe
-- ce qu'il doit couper, et rien de plus. Un test de cloisonnement qui
-- ne vérifie pas le cas légitime ne prouve pas grand-chose.
update public.ai_conversation_messages
   set decision_id = (select v from ids where k='decisionB')
 where id = (select v from ids where k='msgB');

insert into res
select 'Mais B rattache sans peine une décision de B','true',
       (select (decision_id = (select v from ids where k='decisionB'))::text
          from public.ai_conversation_messages where id = (select v from ids where k='msgB'));

reset role;

-- Vérifié UNE FOIS SORTI de la peau de B, et c'est essentiel : posée
-- pendant que la RLS de B masque les lignes de A, la question aurait
-- rendu zéro quoi qu'il arrive — un test qui passe même quand tout est
-- cassé. Ici la requête voit vraiment les messages de A.
insert into res
select 'Aucun message de B ne pointe une décision de A','0',
       (select count(*)::text from public.ai_conversation_messages m
         where m.organization_id = (select v from ids where k='orgB')
           and m.decision_id = (select v from ids where k='decisionA'));

insert into res
select 'Le fil de A a bien ses messages, vu sans RLS','true',
       (select (count(*) > 3)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filA'));

-- ============================================================
-- 5. LA QUEUE REJOUÉE — la seule chose que le modèle reverra
-- ============================================================
--
-- On bâtit un fil dont on connaît la taille exacte, et on regarde ce
-- qui en sort. Ce qui compte n'est pas seulement que la queue soit
-- courte : c'est que le drapeau « tronque » sorte du MÊME parcours,
-- pour que l'écran ne puisse pas annoncer une conversation complète
-- pendant que le modèle en reçoit la moitié.
select set_config('request.jwt.claims',
  json_build_object('sub','a0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into ids select 'filLong', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filLong'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079';

-- Trente tours de 400 caractères : au-delà des seize messages par
-- défaut, et au-delà des 6 000 caractères.
do $$
declare i int;
begin
  for i in 1..30 loop
    insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
    select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
           (select v from ids where k='filLong'),
           case when i % 2 = 1 then 'user' else 'assistant' end,
           'Tour ' || lpad(i::text, 3, '0') || ' ' || repeat('m', 390);
  end loop;
end $$;

insert into res
select 'Le fil compte bien trente messages','30',
       ((public.ai_conversation_tail((select v from ids where k='filLong'))) ->> 'messages_total');

-- 6 000 caractères pour des messages de 399 : quinze tiennent dans le
-- budget, un de moins que le plafond de seize. C'est donc le BUDGET qui
-- coupe, pas le compte — la borne la plus stricte gagne. Puis le
-- quinzième en repartant du fond se trouve être une RÉPONSE, et une
-- queue ne commence pas par une réponse : il en reste quatorze.
insert into res
select 'La queue est bornée par le budget de caractères, pas par le compte','14',
       ((public.ai_conversation_tail((select v from ids where k='filLong'))) ->> 'messages_rejoues');

insert into res
select 'Et l''écran sait que le fil a été tronqué','true',
       ((public.ai_conversation_tail((select v from ids where k='filLong'))) ->> 'tronque');

-- Trente moins quatorze : le compte des omis est celui des messages
-- réellement laissés de côté, y compris l'orphelin qu'on vient de
-- retirer. Un drapeau « tronqué » assorti d'un compte faux serait à
-- peine mieux qu'un fil silencieusement rogné.
insert into res
select 'Le compte des omis est celui des messages réellement omis','16',
       ((public.ai_conversation_tail((select v from ids where k='filLong'))) ->> 'messages_omis');

insert into res
select 'Rejoués plus omis font bien le fil entier','30',
       ((((public.ai_conversation_tail((select v from ids where k='filLong'))) ->> 'messages_rejoues')::int
       + ((public.ai_conversation_tail((select v from ids where k='filLong'))) ->> 'messages_omis')::int))::text;

-- UNE QUEUE NE COMMENCE PAS PAR UNE RÉPONSE. Le modèle relirait sa
-- propre réponse sans la question qui l'a provoquée, et en déduirait
-- une consigne là où il n'y a qu'un écho.
insert into res
select 'La queue commence toujours par une question','user',
       ((public.ai_conversation_tail((select v from ids where k='filLong')))
          -> 'messages' -> 0 ->> 'role');

insert into res
select 'Et se termine par le dernier tour du fil','Tour 030 ' || repeat('m', 390),
       ((public.ai_conversation_tail((select v from ids where k='filLong')))
          -> 'messages' -> -1 ->> 'content');

-- LES PARAMÈTRES SONT BORNÉS EUX AUSSI. Un appelant qui demanderait
-- tout le fil annulerait le paragraphe entier : le plafond dur est le
-- seuil du routeur (12 000 caractères), au-delà duquel l'historique
-- déciderait à lui seul du modèle utilisé, donc du prix.
insert into res
select 'Un appelant qui demande 200 messages n''en obtient pas plus de 40','true',
       ((public.ai_conversation_tail((select v from ids where k='filLong'), 200, 999999)
           ->> 'messages_rejoues')::int <= 40)::text;

insert into res
select 'Et jamais plus de 12 000 caractères, le seuil du routeur','true',
       ((public.ai_conversation_tail((select v from ids where k='filLong'), 200, 999999)
           ->> 'caracteres')::int <= 12000)::text;

-- Un fil court n'est pas tronqué, et le dit.
insert into res
select 'Un fil court n''est pas tronqué','false',
       ((public.ai_conversation_tail((select v from ids where k='filMuet'))) ->> 'tronque');

insert into res
select 'Un fil vide rend une queue vide sans se plaindre','0',
       ((public.ai_conversation_tail(gen_random_uuid())) ->> 'messages_total');

-- ============================================================
-- 6. LE DROIT D'EFFACER LES SIENNES
-- ============================================================

-- Supprimer un fil emporte ses messages : la cascade de la clé
-- étrangère ne passe pas par la RLS, et c'est le SEUL chemin par lequel
-- un message disparaît.
insert into ids select 'filJetable', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filJetable'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079';
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'a0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filJetable'), 'user', 'À effacer.';

delete from public.ai_conversations where id = (select v from ids where k='filJetable');

reset role;
insert into res
select 'Supprimer un fil emporte ses messages','0',
       (select count(*)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filJetable'));

-- EFFACER CE QU'ON A ÉCRIT NE DÉPEND PAS D'UNE PERMISSION MÉTIER, et
-- c'est ici que le piège de PostgreSQL se referme. Un salarié dont
-- l'appartenance est archivée ne peut plus rien LIRE — `has_permission`
-- est faux — et un `delete` dont le `where` désigne une colonne exige
-- que la ligne soit visible en lecture. Une politique de suppression
-- plus permissive que la lecture n'efface donc RIEN, et sans lever la
-- moindre erreur : le bouton dirait « supprimé », la donnée resterait.
--
-- Ces deux tests-là sont le cœur du § 7.b de la migration. Le premier
-- documente la panne, le second prouve la parade.
select set_config('request.jwt.claims',
  json_build_object('sub','f0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into ids select 'filParti', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filParti'), (select v from ids where k='orgA'),
       'f0000079-0000-4000-8000-000000000079';
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'f0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filParti'), 'user', 'La marge du chantier Durand ?';

reset role;
update public.organization_members set archived_at = now()
 where user_id = 'f0000079-0000-4000-8000-000000000079';

select set_config('request.jwt.claims',
  json_build_object('sub','f0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into res
select 'Une appartenance archivée ferme la lecture','0',
       (select count(*)::text from public.ai_conversations);

-- LA PANNE, MISE NOIR SUR BLANC : le `delete` direct part sans erreur
-- et n'efface rien. C'est pour ça que l'écran ne doit pas l'employer.
delete from public.ai_conversations where id = (select v from ids where k='filParti');

reset role;
insert into res
select 'Un « delete » direct n''efface rien quand la lecture est fermée','1',
       (select count(*)::text from public.ai_conversations
         where id = (select v from ids where k='filParti'));

select set_config('request.jwt.claims',
  json_build_object('sub','f0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into res
select 'La fonction d''effacement, elle, aboutit','true',
       public.ai_conversation_supprimer((select v from ids where k='filParti'))::text;

reset role;
insert into res
select 'Le fil de l''ancien salarié a disparu','0',
       (select count(*)::text from public.ai_conversations
         where id = (select v from ids where k='filParti'));

insert into res
select 'Et ses messages avec','0',
       (select count(*)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filParti'));

-- Elle n'efface QUE les siennes, et ne dit rien de plus qu'un « non » :
-- un identifiant inconnu et le fil d'un collègue rendent la même
-- réponse, donc la fonction ne sert pas à deviner ce qui existe.
select set_config('request.jwt.claims',
  json_build_object('sub','c0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into res
select 'Personne n''efface le fil d''un autre par cette porte','false',
       public.ai_conversation_supprimer((select v from ids where k='filA'))::text;

insert into res
select 'Un fil inconnu rend la même réponse qu''un fil interdit','false',
       public.ai_conversation_supprimer(gen_random_uuid())::text;

reset role;
insert into res
select 'Et le fil du patron est intact','1',
       (select count(*)::text from public.ai_conversations
         where id = (select v from ids where k='filA'));

-- ============================================================
-- 7. UN COMPTE SUPPRIMÉ N'Y LAISSE RIEN
-- ============================================================

-- ---------- La suppression DURE ----------
select set_config('request.jwt.claims',
  json_build_object('sub','d0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into ids select 'filDur', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filDur'), (select v from ids where k='orgA'),
       'd0000079-0000-4000-8000-000000000079';
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'd0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filDur'), 'user',
       'Quelle marge avons-nous faite sur le chantier de madame Durand ?';

reset role;
insert into res
select 'Le compte jetable a bien une conversation','1',
       (select count(*)::text from public.ai_conversations
         where user_id = 'd0000079-0000-4000-8000-000000000079');

-- C'est la dernière étape de `delete-account/index.ts` : la destruction
-- de l'utilisateur `auth` lui-même. La cascade doit emporter le fil ET
-- ses messages — y compris quand la suppression est faite hors de
-- l'Edge Function (tableau de bord Supabase, SQL direct).
delete from public.workspaces where owner_id = 'd0000079-0000-4000-8000-000000000079';
delete from auth.users where id = 'd0000079-0000-4000-8000-000000000079';

insert into res
select 'Un compte supprimé ne laisse AUCUN fil','0',
       (select count(*)::text from public.ai_conversations
         where user_id = 'd0000079-0000-4000-8000-000000000079');

insert into res
select 'Ni AUCUN message — noms de clients et marges compris','0',
       (select count(*)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filDur'));

-- ---------- La suppression DOUCE, le seul trou de la cascade ----------
-- `deleteUser(id, true)` laisse la ligne `auth.users` en place et pose
-- `deleted_at`. Le compte disparaît alors de tous les écrans pendant
-- que ses conversations restent en base — invisibles, donc jamais
-- purgées. Ce n'est pas le chemin du produit, et c'est justement
-- pourquoi personne ne s'en apercevrait.
select set_config('request.jwt.claims',
  json_build_object('sub','e0000079-0000-4000-8000-000000000079')::text, true);
set local role authenticated;

insert into ids select 'filDoux', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id)
select (select v from ids where k='filDoux'), (select v from ids where k='orgA'),
       'e0000079-0000-4000-8000-000000000079';
insert into public.ai_conversation_messages (organization_id, user_id, conversation_id, role, content)
select (select v from ids where k='orgA'), 'e0000079-0000-4000-8000-000000000079',
       (select v from ids where k='filDoux'), 'user', 'Le devis Martin, à combien ?';

reset role;
insert into res
select 'Le compte à effacer en douceur a bien une conversation','1',
       (select count(*)::text from public.ai_conversations
         where user_id = 'e0000079-0000-4000-8000-000000000079');

update auth.users set deleted_at = now()
 where id = 'e0000079-0000-4000-8000-000000000079';

insert into res
select 'Un effacement DOUX emporte les conversations lui aussi','0',
       (select count(*)::text from public.ai_conversations
         where user_id = 'e0000079-0000-4000-8000-000000000079');

insert into res
select 'Et leurs messages avec','0',
       (select count(*)::text from public.ai_conversation_messages
         where conversation_id = (select v from ids where k='filDoux'));

-- ---------- La rétention ----------
-- Elle compte à partir du dernier message RÉEL, pas de
-- `last_message_at`, qui n'est pas gelée : un client pourrait repousser
-- cette colonne et soustraire indéfiniment un fil à la purge.
insert into ids select 'filVieux', gen_random_uuid();
insert into public.ai_conversations (id, organization_id, user_id, created_at, last_message_at)
select (select v from ids where k='filVieux'), (select v from ids where k='orgA'),
       'a0000079-0000-4000-8000-000000000079', now() - interval '3 years', now();

insert into res
select 'Un fil ancien est purgé malgré une date d''activité rafraîchie','1',
       public.ai_purge_old_conversations(365)::text;

insert into res
select 'Et les fils récents sont restés','true',
       (select (count(*) > 0)::text from public.ai_conversations
         where id = (select v from ids where k='filA'));

-- La purge ne descend jamais sous trente jours, même si on le lui
-- demande : un paramètre distrait ne doit pas pouvoir vider la table.
insert into res
select 'La purge refuse de descendre sous trente jours','0',
       public.ai_purge_old_conversations(0)::text;

-- ============================================================
-- 8. L'ENTREPRISE SUPPRIMÉE EMPORTE SES CONVERSATIONS
-- ============================================================
-- Deux fils chez B : celui du patron de B, et celui que le collègue de
-- A — membre légitime des deux entreprises — y a ouvert au § 4.
insert into res
select 'Deux fils vivent chez B avant sa suppression','2',
       (select count(*)::text from public.ai_conversations
         where organization_id = (select v from ids where k='orgB'));

delete from public.business_organizations where id = (select v from ids where k='orgB');

insert into res
select 'Une entreprise supprimée n''y laisse aucun fil','0',
       (select count(*)::text from public.ai_conversations
         where organization_id = (select v from ids where k='orgB'));

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
