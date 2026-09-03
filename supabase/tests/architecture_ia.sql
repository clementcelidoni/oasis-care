-- Oasis Care — ARCHITECTURE IA DES AGENTS (migration 0076).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE CLOISONNEMENT. B ne voit ni la consommation, ni le cache, ni
--      les plafonds, ni les surcharges de modèle de A — et, le cas
--      moins évident, ne peut pas ACCROCHER une dépense ou un avis à
--      une décision de A en déclarant sa propre organisation. C'est la
--      faille que 0062 a dû réparer ailleurs : la politique RLS
--      demande « as-tu le droit d'écrire chez toi ? », la réponse est
--      oui, et personne ne vérifie l'autre bout de la ligne.
--
--   2. UNE LIMITE ABSENTE REND NULL, JAMAIS ZÉRO. C'est la règle
--      centrale de 0076, et celle dont l'échec serait le plus
--      silencieux : un `coalesce(..., 0)` égaré dans
--      `ai_cost_budget_remaining` couperait l'IA de toutes les
--      entreprises qui n'ont jamais ouvert l'écran des budgets, sans
--      qu'aucune erreur ne soit levée nulle part. Le corollaire est
--      testé aussi : un coût INCONNU ne se compte pas comme un coût
--      NUL, et le nombre d'événements non tarifés le dit.
--
--   3. LE CACHE NE SERT JAMAIS DU PÉRIMÉ. Trois façons de ne pas
--      servir, et les trois sont éprouvées : empreinte des données
--      changée (le devis a été modifié), entrée expirée, modèle
--      différent. Le premier cas est celui qui compte : c'est lui qui
--      remplace les déclencheurs d'invalidation que 0076 a refusé
--      d'écrire.
--
--   4. LA DATE D'ARRÊTÉ EST UN FAIT. `data_snapshot_timestamp` naît
--      vide (et non « maintenant »), refuse le futur, et ne se réécrit
--      pas.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les deux comptes de test.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).
-- Il suppose 0076 appliquée.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — deux entreprises, deux comptes
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000076-0000-4000-8000-000000000076','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','archi-ia-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000076-0000-4000-8000-000000000076','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','archi-ia-b@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000076-0000-4000-8000-000000000076')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000076-0000-4000-8000-000000000076')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages B','landscaper');

-- ============================================================
-- On devient réellement l'utilisateur A
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','a0000076-0000-4000-8000-000000000076')::text, true);
set local role authenticated;

-- Une décision chez A, pour l'imputation des coûts et pour les avis.
insert into ids
select 'decA', public.ai_open_decision(
  (select v from ids where k='orgA'), 'finance', 'important',
  'Marge du chantier Dupont sous la cible', 'high',
  'La marge réelle ressort à 21,9 % contre 35 % visés.');

-- ============================================================
-- 1. LE GRAND LIVRE — ce qui s'enregistre, et ce qui se refuse
-- ============================================================

insert into ids
select 'ev1', public.ai_record_usage_event(
  p_organization_id       => (select v from ids where k='orgA'),
  p_agent                 => 'finance',
  p_model                 => 'modele-standard-de-test',
  p_input_tokens          => 12000,
  p_output_tokens         => 800,
  p_duration_ms           => 2400,
  p_success               => true,
  p_tool_calls            => 3,
  p_estimated_cost_cents  => 47,
  p_cost_basis            => 'tarif-de-test',
  p_decision_id           => (select v from ids where k='decA'));

insert into res
select 'La dépense est imputée à la décision qui l''a produite','47',
       (select estimated_cost_cents::text from public.ai_usage_events
        where decision_id = (select v from ids where k='decA'));

insert into res
select 'L''auteur de la dépense est celui qui l''engage',
       'a0000076-0000-4000-8000-000000000076',
       (select user_id::text from public.ai_usage_events
        where id = (select v from ids where k='ev1'));

-- UN AGENT HORS PÉRIMÈTRE PEUT COÛTER, ET IL FAUT LE VOIR. La
-- classification (spec p. 29) n'est aucun des quatre agents ; refuser
-- sa ligne ferait disparaître sa dépense du budget.
insert into res
select 'Un agent hors des quatre peut quand même être facturé au grand livre','true',
       (public.ai_record_usage_event(
          (select v from ids where k='orgA'), 'classification',
          'modele-economique-de-test', 3000, 120, 400,
          true, 0, 5, 'tarif-de-test') is not null)::text;

-- Un montant sans provenance de tarif est un chiffre tombé du ciel.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_usage_events (organization_id, agent, model, input_tokens,
      output_tokens, duration_ms, success, estimated_cost_cents)
    select (select v from ids where k='orgA'), 'finance', 'm', 10, 10, 10, true, 99;
  exception when others then refuse := true;
  end;
  insert into res values ('Un montant sans provenance de tarif est refusé','true',refuse::text);
end $$;

-- Un échec doit dire lequel, un succès ne doit pas en inventer un.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_usage_events (organization_id, agent, model, input_tokens,
      output_tokens, duration_ms, success, failure_reason)
    select (select v from ids where k='orgA'), 'finance', 'm', 10, 10, 10, true, 'timeout';
  exception when others then refuse := true;
  end;
  insert into res values ('Un appel réussi ne porte pas de cause de panne','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_usage_events (organization_id, agent, model, input_tokens,
      output_tokens, duration_ms, success)
    select (select v from ids where k='orgA'), 'finance', 'm', 10, 10, 10, false;
  exception when others then refuse := true;
  end;
  insert into res values ('Un échec sans cause nommée est refusé','true',refuse::text);
end $$;

-- LE REPLI CONTRÔLÉ de la page 23 : Sol indisponible, Terra répond, et
-- la trace le dit.
insert into ids
select 'evfallback', public.ai_record_usage_event(
  p_organization_id     => (select v from ids where k='orgA'),
  p_agent               => 'executive',
  p_model               => 'modele-standard-de-test',
  p_input_tokens        => 5000,
  p_output_tokens       => 300,
  p_duration_ms         => 1800,
  p_success             => true,
  p_estimated_cost_cents=> 18,
  p_cost_basis          => 'tarif-de-test',
  p_fallback_from_model => 'modele-avance-de-test');

insert into res
select 'Un repli laisse la trace du modèle qui n''a pas répondu','modele-avance-de-test',
       (select fallback_from_model from public.ai_usage_events
        where id = (select v from ids where k='evfallback'));

-- Le grand livre ne s'écrit pas à la main : aucune politique
-- d'insertion, donc une ligne forgée depuis le navigateur est refusée.
-- (Les `insert` directs ci-dessus, eux, échouaient sur les contraintes
-- AVANT d'atteindre la RLS ; celui-ci est valide et doit tomber sur
-- elle.)
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_usage_events (organization_id, agent, model, input_tokens,
      output_tokens, duration_ms, success, estimated_cost_cents, cost_basis)
    select (select v from ids where k='orgA'), 'finance', 'm', 10, 10, 10, true, 500000, 'forge';
  exception when others then refuse := true;
  end;
  insert into res values ('Une ligne de dépense forgée à la main est refusée','true',refuse::text);
end $$;

-- ============================================================
-- 2. LE BUDGET — NULL n'est pas ZÉRO
-- ============================================================
-- 47 + 5 + 18 = 70 centimes dépensés chez A, tous tarifés.

insert into res
select 'Sans aucun plafond posé, le reste du jour est INCONNU (et non zéro)','NULL',
       coalesce((select daily_remaining_cents::text
                 from public.ai_cost_budget_remaining((select v from ids where k='orgA'))), 'NULL');

insert into res
select 'Sans aucun plafond posé, le reste du mois est INCONNU','NULL',
       coalesce((select monthly_remaining_cents::text
                 from public.ai_cost_budget_remaining((select v from ids where k='orgA'))), 'NULL');

-- La dépense, elle, est parfaitement connue : « aucune limite » ne veut
-- pas dire « aucune mesure ».
insert into res
select 'La dépense du jour est comptée même sans plafond','70',
       (select daily_spent_cents::text
        from public.ai_cost_budget_remaining((select v from ids where k='orgA')));

-- UN COÛT INCONNU N'EST PAS UN COÛT NUL. Un modèle dont le serveur
-- ignore le tarif produit un événement sans montant ; le total ne
-- bouge pas, mais il devient un MINORANT, et la fonction le dit.
insert into ids
select 'evsanstarif', public.ai_record_usage_event(
  (select v from ids where k='orgA'), 'billing', 'modele-inconnu-au-tarif',
  900, 80, 700, true, 0, null, null);

insert into res
select 'Un appel au tarif inconnu ne gonfle pas le total','70',
       (select daily_spent_cents::text
        from public.ai_cost_budget_remaining((select v from ids where k='orgA')));

insert into res
select 'Mais il est compté à part : le total est annoncé incomplet','1',
       (select unpriced_events_today::text
        from public.ai_cost_budget_remaining((select v from ids where k='orgA')));

-- On pose maintenant des plafonds.
insert into public.ai_cost_limits (organization_id, daily_organization_limit_cents,
                                   monthly_organization_limit_cents, per_agent_limit_cents)
select (select v from ids where k='orgA'), 200, 5000, 60;

insert into res
select 'Avec un plafond de 200, il reste 130','130',
       (select daily_remaining_cents::text
        from public.ai_cost_budget_remaining((select v from ids where k='orgA')));

-- UNE COLONNE À NULL DANS UNE LIGNE PRÉSENTE VAUT AUSSI « PAS DE
-- LIMITE ». Le piège serait de traiter « la ligne existe » comme « les
-- trois plafonds existent ».
update public.ai_cost_limits set monthly_organization_limit_cents = null
 where organization_id = (select v from ids where k='orgA');

insert into res
select 'Un plafond mensuel effacé redevient INCONNU, pas zéro','NULL',
       coalesce((select monthly_remaining_cents::text
                 from public.ai_cost_budget_remaining((select v from ids where k='orgA'))), 'NULL');

-- Le plafond par agent : 47 centimes dépensés par « finance » sur 60.
insert into res
select 'Le plafond par agent se compte sur le seul agent demandé','13',
       (select agent_remaining_cents::text
        from public.ai_cost_budget_remaining((select v from ids where k='orgA'), 'finance'));

-- Sans agent demandé, les colonnes d'agent restent vides : « je n'ai
-- pas posé la question » n'est pas « il n'y a pas de plafond ».
insert into res
select 'Sans agent demandé, le reste par agent n''est pas répondu','NULL',
       coalesce((select agent_remaining_cents::text
                 from public.ai_cost_budget_remaining((select v from ids where k='orgA'))), 'NULL');

-- Un plafond à ZÉRO est un choix, pas une absence : l'IA est coupée, et
-- le reste vaut bien zéro (ou moins), surtout pas NULL.
update public.ai_cost_limits set daily_organization_limit_cents = 0
 where organization_id = (select v from ids where k='orgA');

insert into res
select 'Un plafond volontairement à ZÉRO se lit comme un dépassement','-70',
       (select daily_remaining_cents::text
        from public.ai_cost_budget_remaining((select v from ids where k='orgA')));

-- Et le dépassement n'est pas écrêté à zéro : douze euros de trop et
-- douze centimes de trop ne se disent pas de la même façon.
insert into res
select 'Le dépassement garde son signe et son ampleur','true',
       ((select daily_remaining_cents
         from public.ai_cost_budget_remaining((select v from ids where k='orgA'))) < 0)::text;

-- ============================================================
-- 3. LE CACHE — les trois façons de ne PAS servir
-- ============================================================

insert into ids
select 'cache1', public.ai_cache_store(
  p_organization_id    => (select v from ids where k='orgA'),
  p_agent              => 'quote_pricing',
  p_cache_key          => 'quotePriceAnalysis:devis-42',
  p_model              => 'modele-standard-de-test',
  p_source_fingerprint => 'empreinte-du-devis-v1',
  p_result             => '{"margePct": 21.9}'::jsonb,
  p_ttl_seconds        => 600);

insert into res
select 'La même analyse, à la seconde d''après, sort du cache','21.9',
       coalesce((public.ai_cache_lookup(
         (select v from ids where k='orgA'), 'quote_pricing',
         'quotePriceAnalysis:devis-42', 'modele-standard-de-test',
         'empreinte-du-devis-v1') ->> 'margePct'), 'NULL');

insert into res
select 'Une lecture servie incrémente le compteur d''utilité','1',
       (select hit_count::text from public.ai_result_cache
        where id = (select v from ids where k='cache1'));

-- LE CAS QUI COMPTE. Le devis est modifié : l'empreinte change, et
-- l'entrée — toujours parfaitement fraîche au sens de l'expiration —
-- n'est plus servable. C'est ce mécanisme qui remplace les
-- déclencheurs d'invalidation que 0076 a refusé d'écrire.
insert into res
select 'Le devis modifié : l''entrée encore fraîche n''est PLUS servie','NULL',
       coalesce(public.ai_cache_lookup(
         (select v from ids where k='orgA'), 'quote_pricing',
         'quotePriceAnalysis:devis-42', 'modele-standard-de-test',
         'empreinte-du-devis-v2')::text, 'NULL');

-- Le modèle fait partie de l'identité : une entreprise qui passe son
-- agent sur le modèle avancé ne doit pas recevoir la réponse de
-- l'économique.
insert into res
select 'Un autre modèle ne récupère pas la réponse du précédent','NULL',
       coalesce(public.ai_cache_lookup(
         (select v from ids where k='orgA'), 'quote_pricing',
         'quotePriceAnalysis:devis-42', 'modele-avance-de-test',
         'empreinte-du-devis-v1')::text, 'NULL');

-- Un recalcul REMPLACE : une seule entrée vivante par clé logique, et
-- le compteur d'utilité repart, puisque c'est une autre réponse.
do $$
begin
  perform public.ai_cache_store(
    (select v from ids where k='orgA'), 'quote_pricing',
    'quotePriceAnalysis:devis-42', 'modele-standard-de-test',
    'empreinte-du-devis-v2', '{"margePct": 27.4}'::jsonb, 600);
end $$;

insert into res
select 'Un recalcul remplace l''entrée au lieu de l''empiler','1',
       (select count(*)::text from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'quotePriceAnalysis:devis-42');

insert into res
select 'La nouvelle empreinte sert la nouvelle analyse','27.4',
       coalesce((public.ai_cache_lookup(
         (select v from ids where k='orgA'), 'quote_pricing',
         'quotePriceAnalysis:devis-42', 'modele-standard-de-test',
         'empreinte-du-devis-v2') ->> 'margePct'), 'NULL');

insert into res
select 'Le compteur d''utilité repart pour une autre réponse','1',
       (select hit_count::text from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'quotePriceAnalysis:devis-42');

-- UNE ENTRÉE EXPIRÉE N'EST JAMAIS SERVIE, empreinte inchangée ou non.
-- On vieillit la ligne à la main — la fonction d'écriture borne la
-- durée de vie à une seconde au minimum, et attendre serait un test
-- lent pour rien. Les DEUX dates reculent : la contrainte
-- `expires_at > created_at` refuserait une entrée qui aurait expiré
-- avant d'être écrite, et elle a raison.
--
-- LE `reset role` N'EST PAS UN DÉTAIL DE CONFORT. Aucune politique
-- n'autorise plus l'écriture dans `ai_result_cache` (0076 § 7) : sous
-- la peau de l'utilisateur, cet `update` ne lèverait pas — il
-- toucherait ZÉRO ligne, en silence, et le test qui suit passerait
-- pour de mauvaises raisons. On sort donc du rôle pour vieillir la
-- ligne, puis on y revient.
reset role;
update public.ai_result_cache
   set created_at = now() - interval '1 hour',
       expires_at = now() - interval '1 second'
 where organization_id = (select v from ids where k='orgA')
   and cache_key = 'quotePriceAnalysis:devis-42';
set local role authenticated;

insert into res
select 'Une entrée expirée n''est jamais servie','NULL',
       coalesce(public.ai_cache_lookup(
         (select v from ids where k='orgA'), 'quote_pricing',
         'quotePriceAnalysis:devis-42', 'modele-standard-de-test',
         'empreinte-du-devis-v2')::text, 'NULL');

-- L'invalidation explicite, pour le cas que l'empreinte ne voit pas :
-- ce n'est pas la donnée qui a changé, c'est le raisonnement.
do $$
begin
  perform public.ai_cache_store(
    (select v from ids where k='orgA'), 'quote_pricing',
    'quotePriceAnalysis:devis-99', 'modele-standard-de-test',
    'empreinte-99', '{"margePct": 30}'::jsonb, 600);
  perform public.ai_cache_store(
    (select v from ids where k='orgA'), 'finance',
    'financeSnapshot:2026-09', 'modele-standard-de-test',
    'empreinte-fin', '{"ca": 1000}'::jsonb, 600);
end $$;

-- DEUX lignes emportées et non une : celle du devis 99 qu'on vient
-- d'écrire, ET celle du devis 42 laissée expirée plus haut. C'est le
-- comportement voulu — libérer la place tout de suite est l'une des
-- deux raisons d'être de cette fonction, et une ligne périmée occupe
-- exactement autant de place qu'une autre.
insert into res
select 'L''invalidation par préfixe ne vise que sa famille','2',
       public.ai_invalidate_result_cache(
         (select v from ids where k='orgA'), 'quote_pricing', 'quotePriceAnalysis:')::text;

insert into res
select 'La photo financière, elle, est restée en place','1',
       (select count(*)::text from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'financeSnapshot:2026-09');

-- LES JOKERS DE `LIKE` NE SONT PAS DES JOKERS. Les clés sont
-- construites par l'appelant : un `_` non échappé ferait de
-- « stock_bas: » un motif qui emporte aussi « stockXbas: ». Personne ne
-- le verrait jamais — pas d'erreur, juste des recalculs payants.
do $$
begin
  perform public.ai_cache_store(
    (select v from ids where k='orgA'), 'executive', 'stock_bas:1',
    'modele-standard-de-test', 'e', '{"n": 1}'::jsonb, 600);
  perform public.ai_cache_store(
    (select v from ids where k='orgA'), 'executive', 'stockXbas:1',
    'modele-standard-de-test', 'e', '{"n": 2}'::jsonb, 600);
end $$;

insert into res
select 'Un souligné dans une clé n''est pas un joker','1',
       public.ai_invalidate_result_cache(
         (select v from ids where k='orgA'), 'executive', 'stock_bas:')::text;

insert into res
select 'La clé voisine a survécu','1',
       (select count(*)::text from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'stockXbas:1');

-- Un résultat vide n'a rien à faire au cache : il serait resservi comme
-- une réponse.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_cache_store(
      (select v from ids where k='orgA'), 'finance', 'k', 'm', 'e', null, 600);
  exception when others then refuse := true;
  end;
  insert into res values ('Un résultat NULL est refusé au cache','true',refuse::text);
end $$;

-- ============================================================
-- 4. LA SURCHARGE DE MODÈLE
-- ============================================================

insert into public.ai_model_overrides (organization_id, agent, model, reason, updated_by)
select (select v from ids where k='orgA'), 'finance', 'modele-avance-de-test',
       'Analyses de marge jugées trop grossières.',
       'a0000076-0000-4000-8000-000000000076';

insert into res
select 'A impose son modèle à son agent Finance','modele-avance-de-test',
       coalesce(public.ai_model_for_agent(
         (select v from ids where k='orgA'), 'finance'), 'NULL');

insert into res
select 'Sans surcharge, la réponse est NULL — donc « prends le défaut du code »','NULL',
       coalesce(public.ai_model_for_agent(
         (select v from ids where k='orgA'), 'billing'), 'NULL');

-- Le verrou de 0072 tient ici aussi : un cinquième agent n'existe pas,
-- et une surcharge à son nom serait un réglage qui n'agit sur rien.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_model_overrides (organization_id, agent, model)
    select (select v from ids where k='orgA'), 'sales', 'modele-standard-de-test';
  exception when others then refuse := true;
  end;
  insert into res values ('Une surcharge pour un agent hors périmètre est refusée','true',refuse::text);
end $$;

-- ============================================================
-- 5. L'AVIS SUR UNE RECOMMANDATION
-- ============================================================

insert into public.ai_recommendation_feedback (organization_id, decision_id, helpful, reason)
select (select v from ids where k='orgA'), (select v from ids where k='decA'), false,
       'Le chantier était en régie, la marge affichée ne veut rien dire.';

insert into res
select 'L''avis est signé de celui qui le donne, sans qu''il ait à le dire',
       'a0000076-0000-4000-8000-000000000076',
       (select user_id::text from public.ai_recommendation_feedback
        where decision_id = (select v from ids where k='decA'));

-- Signer du nom d'un collègue : le déclencheur réécrit l'auteur, la
-- politique le vérifie. Le résultat doit être l'un ou l'autre — jamais
-- une ligne au nom de B.
do $$
declare v_auteur uuid;
begin
  begin
    update public.ai_recommendation_feedback
       set user_id = 'b0000076-0000-4000-8000-000000000076'
     where decision_id = (select v from ids where k='decA');
  exception when others then null;
  end;
  select user_id into v_auteur from public.ai_recommendation_feedback
   where decision_id = (select v from ids where k='decA');
  insert into res values ('On ne peut pas signer l''avis d''un collègue',
    'a0000076-0000-4000-8000-000000000076', coalesce(v_auteur::text, 'NULL'));
end $$;

-- Changer d'avis est un `update`, pas une deuxième ligne : dix clics
-- sur le pouce ne pèsent pas dix fois dans la moyenne.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_recommendation_feedback (organization_id, decision_id, helpful)
    select (select v from ids where k='orgA'), (select v from ids where k='decA'), true;
  exception when others then refuse := true;
  end;
  insert into res values ('Un second avis du même utilisateur est refusé','true',refuse::text);
end $$;

-- ============================================================
-- 6. LA DATE D'ARRÊTÉ DES DONNÉES (spec p. 21)
-- ============================================================

insert into res
select 'Une décision naît SANS date d''arrêté — inconnue, pas « maintenant »','NULL',
       coalesce((select data_snapshot_timestamp::text from public.ai_decisions
                 where id = (select v from ids where k='decA')), 'NULL');

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_record_decision_snapshot(
      (select v from ids where k='decA'), now() + interval '2 hours');
  exception when others then refuse := true;
  end;
  insert into res values ('Une date d''arrêté dans le futur est refusée','true',refuse::text);
end $$;

do $$
begin
  perform public.ai_record_decision_snapshot(
    (select v from ids where k='decA'), now() - interval '3 hours');
end $$;

insert into res
select 'La décision sait maintenant sur quelles données elle reposait','true',
       (select (data_snapshot_timestamp is not null)::text from public.ai_decisions
        where id = (select v from ids where k='decA'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_record_decision_snapshot(
      (select v from ids where k='decA'), now() - interval '1 hour');
  exception when others then refuse := true;
  end;
  insert into res values ('Un arrêté de données ne se réécrit pas','true',refuse::text);
end $$;

-- ============================================================
-- 7. LE CLOISONNEMENT — on devient B
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000076-0000-4000-8000-000000000076')::text, true);
set local role authenticated;

insert into res
select 'B ne voit aucune dépense de A','0',
       (select count(*)::text from public.ai_usage_events);

insert into res
select 'B ne voit aucune entrée de cache de A','0',
       (select count(*)::text from public.ai_result_cache);

insert into res
select 'B ne voit aucun plafond de A','0',
       (select count(*)::text from public.ai_cost_limits);

insert into res
select 'B ne voit aucune surcharge de modèle de A','0',
       (select count(*)::text from public.ai_model_overrides);

insert into res
select 'B ne voit aucun avis de A','0',
       (select count(*)::text from public.ai_recommendation_feedback);

-- LA SURCHARGE DE A NE S'APPLIQUE PAS À B. Deux questions, deux fois
-- NULL : sur sa propre entreprise (il n'a rien posé) et sur celle de A
-- (il n'a rien à y voir).
insert into res
select 'Chez B, l''agent Finance n''a aucune surcharge','NULL',
       coalesce(public.ai_model_for_agent(
         (select v from ids where k='orgB'), 'finance'), 'NULL');

insert into res
select 'B n''hérite pas de la surcharge posée par A','NULL',
       coalesce(public.ai_model_for_agent(
         (select v from ids where k='orgA'), 'finance'), 'NULL');

-- Le cache de A reste inaccessible à B, même avec la clé et
-- l'empreinte exactes — c'est l'hypothèse la plus défavorable, et la
-- seule qui prouve quelque chose.
--
-- LE REFUS EST FRANC, il ne rend plus NULL. Depuis que les trois
-- fonctions de cache sont `security definer` — la RLS ne pouvant plus
-- laisser l'écriture ouverte à `projects.read` sans qu'un compte de
-- lecture seule puisse réécrire l'avis rendu à son patron —, elles
-- posent `ai_guard` en première ligne. Un NULL serait ici un « défaut
-- de cache » indiscernable du cas ordinaire ; le refus dit ce qui s'est
-- réellement passé. Même raisonnement que pour le budget, juste en
-- dessous.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_cache_lookup(
      (select v from ids where k='orgA'), 'finance',
      'financeSnapshot:2026-09', 'modele-standard-de-test', 'empreinte-fin');
  exception when others then refuse := true;
  end;
  insert into res values ('B se voit REFUSER le cache de A, clé exacte comprise','true',refuse::text);
end $$;

-- Le budget de A n'est pas « aucune limite, zéro dépensé » : c'est un
-- refus. Une réponse rassurante et fausse serait le pire des deux.
do $$
declare refuse boolean := false;
begin
  begin
    perform * from public.ai_cost_budget_remaining((select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values ('B se voit REFUSER le budget de A, il ne reçoit pas un zéro','true',refuse::text);
end $$;

-- LES TENTATIVES QUI COMPTENT. B écrit chez B — la politique RLS est
-- donc satisfaite — mais désigne la décision de A.
--
-- ─── ON PERD LE LIEN, JAMAIS LA DÉPENSE ───
--
-- La clé étrangère composite (decision_id, organization_id) faisait
-- LEVER l'insertion, et l'appelant TypeScript avale cette exception
-- pour ne pas perdre une réponse déjà payée. Il suffisait donc d'un
-- identifiant de décision inventé dans le corps d'une requête HTTP
-- pour qu'AUCUNE ligne du grand livre ne soit écrite — donc pour que
-- les plafonds de la page 19 ne se déclenchent jamais.
--
-- `ai_record_usage_event` valide désormais le rattachement elle-même :
-- un identifiant qui n'appartient pas à l'entreprise devient NULL. La
-- ligne existe, la dépense compte, et le lien — le seul élément
-- douteux — est celui qui tombe.
do $$
declare v_id uuid;
begin
  v_id := public.ai_record_usage_event(
    (select v from ids where k='orgB'), 'finance', 'm', 10, 10, 10,
    true, 0, 100000, 'forge', null, null,
    (select v from ids where k='decA'));

  insert into res values (
    'La dépense de B est bien comptée, malgré le rattachement forgé',
    'true', (v_id is not null)::text);

  insert into res values (
    'Mais elle n''est PAS rattachée à la décision de A',
    'NULL',
    coalesce((select u.decision_id::text from public.ai_usage_events u where u.id = v_id), 'NULL'));
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_recommendation_feedback (organization_id, decision_id, helpful)
    select (select v from ids where k='orgB'), (select v from ids where k='decA'), true;
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas accrocher un avis à la décision de A','true',refuse::text);
end $$;

-- B ne peut pas non plus dater les données de la décision de A : la
-- fonction est en `security invoker`, donc la ligne lui est invisible.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_record_decision_snapshot(
      (select v from ids where k='decA'), now() - interval '1 minute');
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas dater les données d''une décision de A','true',refuse::text);
end $$;

-- Et B ne peut pas empoisonner le cache de A en écrivant sous
-- l'organisation de A.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_cache_store(
      (select v from ids where k='orgA'), 'finance', 'financeSnapshot:2026-09',
      'modele-standard-de-test', 'empreinte-fin', '{"ca": 0}'::jsonb, 600);
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas écrire dans le cache de A','true',refuse::text);
end $$;

-- ============================================================
-- Vérifié UNE FOIS SORTI de la peau de B
-- ============================================================
-- C'est essentiel : posées pendant que la RLS de B masque les lignes,
-- ces questions auraient rendu « rien n'a bougé » quoi qu'il arrive —
-- un test qui passe même quand tout est cassé.
reset role;

insert into res
select 'Le grand livre de A est intact','4',
       (select count(*)::text from public.ai_usage_events
        where organization_id = (select v from ids where k='orgA'));

insert into res
select 'La photo financière de A n''a pas été empoisonnée','1000',
       (select result ->> 'ca' from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'financeSnapshot:2026-09');

insert into res
select 'La décision de A ne porte qu''un seul avis','1',
       (select count(*)::text from public.ai_recommendation_feedback
        where decision_id = (select v from ids where k='decA'));

-- ============================================================
-- Le ménage du cache, et le fait qu'il ne soit joignable par personne
-- ============================================================
-- Une entrée neuve, vieillie à la main : l'invalidation par préfixe a
-- déjà emporté la précédente, et une purge qui ne trouve rien à purger
-- ne prouve rien.
insert into public.ai_result_cache (organization_id, agent, cache_key, model,
                                    source_fingerprint, result, created_at, expires_at)
select (select v from ids where k='orgA'), 'finance', 'aPurger:1',
       'modele-standard-de-test', 'empreinte', '{}'::jsonb,
       now() - interval '2 hours', now() - interval '1 hour';

insert into res
select 'La purge emporte l''entrée expirée de A','true',
       (public.ai_purge_expired_result_cache() >= 1)::text;

insert into res
select 'La purge ne touche pas ce qui est encore valable','1',
       (select count(*)::text from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'financeSnapshot:2026-09');

insert into res
select 'La purge n''est appelable ni par anon ni par authenticated','false',
       (has_function_privilege('authenticated', 'public.ai_purge_expired_result_cache()', 'execute')
        or has_function_privilege('anon', 'public.ai_purge_expired_result_cache()', 'execute'))::text;


-- ============================================================
-- LE CACHE NE S'ÉCRIT PLUS PAR POLITIQUE — un ouvrier ne réécrit
-- pas l'avis rendu à son patron
-- ============================================================
-- LA FAILLE QUE CE BLOC FERME. `ai_result_cache` accordait l'écriture
-- COMPLÈTE (insert/update/delete) à `projects.read` — la seule
-- permission du rôle `fieldWorker`, et l'une de celles du rôle
-- littéralement nommé `readOnly`. Un ouvrier pouvait donc RÉÉCRIRE le
-- contenu d'une réponse d'agent déjà calculée, en laissant l'empreinte
-- et l'expiration intactes, et c'est ce texte que le dirigeant recevait
-- ensuite comme étant l'avis d'Oasis. `ai_cache_lookup` ne revérifie
-- rien : elle rend la ligne telle quelle. Il pouvait aussi vider le
-- cache de l'entreprise et faire repayer chaque brief.
--
-- La ligne de CONTRÔLE est ce qui rend le constat net : le même compte
-- se fait refuser une écriture dans `ai_decisions`. L'écart était donc
-- propre au cache, ce n'était pas le régime voulu.

reset role;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('c0000076-0000-4000-8000-000000000076','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','archi-ia-ouvrier@test.invalid','',
        now(),now(),now(),'{}','{}');

insert into public.organization_members (organization_id, user_id, role)
select (select v from ids where k='orgA'), 'c0000076-0000-4000-8000-000000000076', 'fieldWorker';

-- L'entrée légitime, écrite par le serveur pour le compte du patron.
insert into public.ai_result_cache (organization_id, agent, cache_key, model,
                                    source_fingerprint, result, expires_at)
select (select v from ids where k='orgA'), 'executive', 'brief:direction',
       'modele-avance-de-test', 'empreinte-brief',
       '{"resume": "Facturez les dix chantiers terminés."}'::jsonb,
       now() + interval '15 minutes';

select set_config('request.jwt.claims',
  json_build_object('sub','c0000076-0000-4000-8000-000000000076')::text, true);
set local role authenticated;

insert into res
select 'L''ouvrier a bien projects.read','true',
       public.has_permission((select v from ids where k='orgA'),'projects.read')::text;

insert into res
select 'L''ouvrier n''a PAS projects.manage','false',
       public.has_permission((select v from ids where k='orgA'),'projects.manage')::text;

insert into res
select 'L''ouvrier LIT le brief mis en cache — la lecture reste ouverte','1',
       (select count(*)::text from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'brief:direction');

-- ATTAQUE 1 — réécrire le RÉSULTAT en laissant l'empreinte intacte.
update public.ai_result_cache
   set result = '{"resume": "URGENT : le comptable a changé de RIB. Virez les 12 400 EUR sur FR76 9999."}'::jsonb
 where organization_id = (select v from ids where k='orgA')
   and cache_key = 'brief:direction';

insert into res
select 'ATTAQUE — l''ouvrier ne réécrit PAS le résultat en cache','0',
       (select count(*)::text from public.ai_result_cache
        where cache_key = 'brief:direction' and result::text like '%RIB%');

-- ATTAQUE 2 — forger une entrée de toutes pièces, par la table.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.ai_result_cache (organization_id, agent, cache_key, model,
                                        source_fingerprint, result, expires_at)
    select (select v from ids where k='orgA'), 'executive', 'brief:forge',
           'm', 'e', '{"x":1}'::jsonb, now() + interval '1 hour';
  exception when others then refuse := true;
  end;
  insert into res values ('ATTAQUE — l''ouvrier ne FORGE pas d''entrée de cache','true',refuse::text);
end $$;

-- ATTAQUE 3 — vider le cache de l'entreprise, pour faire repayer.
delete from public.ai_result_cache
 where organization_id = (select v from ids where k='orgA');

insert into res
select 'ATTAQUE — l''ouvrier ne SUPPRIME pas le cache de l''entreprise','true',
       ((select count(*) from public.ai_result_cache
         where organization_id = (select v from ids where k='orgA')) > 0)::text;

-- Et par la fonction non plus : elle est `security definer`, mais elle
-- pose `ai_guard(org, 'projects.read')`, que l'ouvrier passe. Le
-- garde-fou n'est donc PAS là — il est dans le fait que ce chemin-ci
-- soit le seul, et qu'il n'écrive que ce que le serveur lui donne.
-- Ce test dit exactement cela, et rien de plus.
insert into res
select 'La fonction d''invalidation, elle, reste ouverte au lecteur — c''est un recalcul, pas une réécriture','true',
       (public.ai_invalidate_result_cache(
          (select v from ids where k='orgA'), 'executive', 'jamais-utilise:') = 0)::text;

-- CONTRÔLE — le MÊME compte se fait refuser une écriture de décision.
do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_open_decision(
      (select v from ids where k='orgA'), 'finance', 'important',
      'Décision forgée par un ouvrier', 'high', 'x');
  exception when others then refuse := true;
  end;
  insert into res values ('CONTRÔLE — le même compte ne peut pas écrire une décision','true',refuse::text);
end $$;

reset role;

insert into res
select 'Le brief du patron est resté celui d''Oasis','Facturez les dix chantiers terminés.',
       (select result ->> 'resume' from public.ai_result_cache
        where organization_id = (select v from ids where k='orgA')
          and cache_key = 'brief:direction');

-- ============================================================
-- LE RISQUE ÉLEVÉ NE PART PAS SEUL (p. 15-16), QUELLE QUE SOIT
-- LA SURFACE
-- ============================================================
-- `ai_may_autoexecute` avait douze conditions et pas une ne regardait
-- le niveau de risque : elle comparait le montant au plafond de la
-- RÈGLE, jamais à un seuil de risque. Une entreprise réglée au niveau 4
-- avec un plafond au-dessus de 20 000 € voyait donc partir seule une
-- action classée `high` par la fonction Edge — qui calculait bien le
-- relèvement, mais s'en servait uniquement comme étiquette.
--
-- Trois actions de test, trois verdicts, et la troisième est celle qui
-- compte : même risque `low`, même règle, même plafond, seul le montant
-- change.

insert into public.ai_action_catalog
  (action_type, agent, label, default_risk_level, required_permission,
   is_write, carries_amount, autopilot_eligible)
values
  ('testRisqueFaible','billing','Test risque faible','low','invoice.create',true,true,true),
  ('testRisqueEleve','billing','Test risque élevé','high','invoice.create',true,true,true)
on conflict (action_type) do nothing;

insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
select (select v from ids where k='orgA'), 'billing', true, 4
on conflict (organization_id, agent) do update set enabled = true, autonomy_level = 4;

-- Un plafond de règle VOLONTAIREMENT très au-dessus du seuil de risque :
-- c'est la configuration exacte qui rendait le défaut atteignable.
insert into public.ai_autopilot_rules
  (organization_id, action_type, enabled, maximum_amount_cents)
values
  ((select v from ids where k='orgA'), 'testRisqueFaible', true, 5000000),
  ((select v from ids where k='orgA'), 'testRisqueEleve', true, 5000000);

select set_config('request.jwt.claims',
  json_build_object('sub','a0000076-0000-4000-8000-000000000076')::text, true);
set local role authenticated;

insert into res
select 'Un petit montant sur une action à risque faible part bien seul','true',
       public.ai_may_autoexecute(
         (select v from ids where k='orgA'), 'billing', 'testRisqueFaible', 100000)::text;

insert into res
select 'Une action classée « high » ne part JAMAIS seule','false',
       public.ai_may_autoexecute(
         (select v from ids where k='orgA'), 'billing', 'testRisqueEleve', 100000)::text;

insert into res
select 'Au-delà de 20 000 EUR, même une action « low » exige une confirmation','false',
       public.ai_may_autoexecute(
         (select v from ids where k='orgA'), 'billing', 'testRisqueFaible', 2000000)::text;

insert into res
select 'Juste en dessous du seuil, elle part encore','true',
       public.ai_may_autoexecute(
         (select v from ids where k='orgA'), 'billing', 'testRisqueFaible', 1999999)::text;

insert into res
select 'Le seuil de la page 15-16 vaut 20 000 EUR, en centimes entiers','2000000',
       public.ai_seuil_risque_eleve_cents()::text;

reset role;
select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
