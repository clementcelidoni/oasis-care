-- Oasis Care — accès offert (complimentary) pour un compte précis.
--
-- À exécuter dans l'éditeur SQL Supabase, APRÈS 0041.
--
-- Pourquoi ce fichier existe : le prompt Phase 12 interdit d'accorder
-- automatiquement un abonnement aux bêta-testeurs « sans décision
-- explicite ». La décision a été prise explicitement par le
-- propriétaire du projet pour SON SEUL compte, le 2026-08-26. Ce script
-- n'accorde rien à personne d'autre, et surtout rien « à tous les
-- utilisateurs TestFlight ».
--
-- Ce n'est PAS un abonnement Apple : rien n'est facturé, rien ne se
-- renouvelle. L'application le présente comme « Accès offert » et cache
-- le bouton « Gérer mon abonnement », qui n'aurait aucun sens ici.
--
-- Sécurité : `subscription_entitlements` n'a aucune politique d'écriture
-- pour un client (cf. 0041). Seul cet éditeur SQL ou une Edge Function
-- en service_role peut insérer ces lignes — un utilisateur ne peut donc
-- pas s'auto-accorder un accès en rejouant ce script depuis l'app.
--
-- POUR RÉVOQUER, une seule commande (tout en bas du fichier).

-- ---------------------------------------------------------------
-- 1. À RENSEIGNER : l'adresse e-mail du compte à qui offrir l'accès.
-- ---------------------------------------------------------------
do $$
declare
  -- L'e-mail du compte Oasis Care concerné.
  target_email constant text := 'clement.celidoni@gmail.com';

  -- 'biolab' débloque TOUT, y compris le module BioLab.
  -- Mettez 'premium' si vous préférez exclure BioLab.
  target_plan constant text := 'biolab';

  target_user_id uuid;
  target_workspace_id uuid;
  granted_entitlement text;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then
    raise exception 'Aucun compte avec l''e-mail %. Créez le compte dans l''app d''abord.', target_email;
  end if;

  select workspace_id into target_workspace_id
  from public.workspace_members where user_id = target_user_id limit 1;
  if target_workspace_id is null then
    select id into target_workspace_id
    from public.workspaces where owner_id = target_user_id limit 1;
  end if;
  if target_workspace_id is null then
    raise exception 'Aucun espace de travail pour %. Ouvrez l''app une fois connecté, puis relancez.', target_email;
  end if;

  -- Une ligne par droit du plan choisi. La liste est volontairement
  -- écrite ici en clair plutôt que déduite : elle doit rester lisible
  -- pour qui inspecte la base, et elle doit correspondre à
  -- PlanConfigurationStore.swift.
  foreach granted_entitlement in array (
    case target_plan
      when 'premium' then array[
        'plantManagement','cloudSync','aiIdentification','aiAssistant','aiDiagnosis','dataExport',
        'unlimitedPlants','multipleGardens','advancedPhotos','digitalTwin','advancedMapLayers',
        'smartIrrigation','sensorHistory','connectedGarden','matterHomeKit','greenhouseAdvanced',
        'pondAdvanced','advancedAnalytics','qrNfc'
      ]
      else array[
        'plantManagement','cloudSync','aiIdentification','aiAssistant','aiDiagnosis','dataExport',
        'unlimitedPlants','multipleGardens','advancedPhotos','digitalTwin','advancedMapLayers',
        'smartIrrigation','sensorHistory','connectedGarden','matterHomeKit','greenhouseAdvanced',
        'pondAdvanced','advancedAnalytics','qrNfc',
        'biolab','bioreactors','smartMedia','biolabAI','biolabAnalytics','biolabExperiments'
      ]
    end
  )
  loop
    insert into public.subscription_entitlements
      (user_id, workspace_id, plan, entitlement, source, status, expires_at)
    values
      -- source = 'complimentary' : jamais 'storeKit'. C'est ce qui
      -- permet de distinguer un accès offert d'un vrai achat, aussi bien
      -- dans l'app que lors d'un audit de la base.
      (target_user_id, target_workspace_id, target_plan, granted_entitlement, 'complimentary', 'subscribed', null)
    on conflict (user_id, entitlement) do update
      set plan = excluded.plan,
          source = excluded.source,
          status = excluded.status,
          expires_at = excluded.expires_at,
          updated_at = now();
  end loop;

  raise notice 'Accès % offert à % (% droits).', target_plan, target_email, (
    select count(*) from public.subscription_entitlements where user_id = target_user_id
  );
end $$;

-- ---------------------------------------------------------------
-- 2. VÉRIFIER (optionnel)
-- ---------------------------------------------------------------
-- select plan, source, status, count(*)
-- from public.subscription_entitlements
-- where user_id = (select id from auth.users where email = 'clement.celidoni@gmail.com')
-- group by plan, source, status;

-- ---------------------------------------------------------------
-- 3. RÉVOQUER — retire l'accès offert et rien d'autre.
--    Le filtre sur source='complimentary' garantit qu'un vrai achat
--    Apple enregistré plus tard ne serait pas supprimé par erreur.
-- ---------------------------------------------------------------
-- delete from public.subscription_entitlements
-- where user_id = (select id from auth.users where email = 'clement.celidoni@gmail.com')
--   and source = 'complimentary';
