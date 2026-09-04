-- Oasis Care — LES RÉGLAGES IA REVIENNENT À L'ÉDITEUR (migration 0080).
--
-- ============================================================
-- LE PROBLÈME, EN UNE PHRASE
-- ============================================================
--
-- Le gestionnaire d'une entreprise CLIENTE peut aujourd'hui basculer
-- son IA sur le modèle le plus cher ET relever lui-même le plafond de
-- dépense censé l'en empêcher. Un plafond que la partie plafonnée
-- contrôle ne protège de rien — et c'est l'éditeur d'Oasis Care qui
-- reçoit la facture du fournisseur, pas le client.
--
-- Ce n'est pas une supposition. 0076 a posé, sur `ai_model_overrides`
-- et `ai_cost_limits`, la même politique que sur les réglages
-- d'entreprise ordinaires :
--
--     for all using (has_permission(organization_id, 'organization.manageUsers'))
--
-- `organization.manageUsers` est la permission d'un administrateur
-- d'entreprise cliente : `has_permission()` l'accorde à tous les rôles
-- `owner` et `admin` d'`organization_members`. Joué en transaction
-- annulée sur cette base, un compte de rôle client `admin` :
--
--   • a fait passer les QUATRE agents surchargeables sur l'identifiant
--     de modèle le plus cher, et `ai_model_for_agent()` l'a confirmé au
--     moteur dans la foulée ;
--   • a relevé son plafond mensuel de 50,00 € à 1 000 000,00 € ;
--   • l'a ensuite entièrement retiré, d'abord en enregistrant trois
--     champs vides (le geste littéral du formulaire), puis en
--     SUPPRIMANT la ligne — la politique étant `for all`, elle couvrait
--     aussi le `delete` ;
--   • sans laisser LA MOINDRE TRACE : zéro ligne dans
--     `admin_audit_events`, zéro déclencheur sur les deux tables. Seuls
--     `updated_at` / `updated_by` étaient écrasés, donc l'état
--     précédent était perdu.
--
-- Et le symétrique, tout aussi grave : un super-administrateur de
-- plateforme, membre d'aucune entreprise, ne pouvait NI lire NI écrire
-- ces réglages (0 ligne visible, 42501 à l'insertion). Celui qui paie
-- n'avait aucune main ; celui qui ne paie pas les avait toutes.
--
-- La spec du Control Center le disait déjà (p. 16-17, MODEL ROUTER :
-- « depuis l'administration technique […] Ne pas exposer cette
-- configuration aux clients ordinaires »). L'architecture IA de 0076 l'a
-- posée du mauvais côté ; ce fichier la remet du bon.
--
-- ============================================================
-- LA LIGNE DE PARTAGE QUE CE FICHIER TRACE
-- ============================================================
--
-- À L'ÉDITEUR — ce que le client paie sans le choisir :
--   le modèle de chaque agent (`ai_model_overrides`) et les plafonds de
--   dépense (`ai_cost_limits`). Les deux décident d'une facture qui
--   n'arrive pas chez le client.
--
-- AU CLIENT — ce qui engage SES données et SON travail :
--   le niveau d'autonomie de chaque agent (`ai_agent_settings`) et les
--   règles d'autopilote (`ai_autopilot_rules`). La conséquence d'un
--   mauvais réglage y est un devis parti trop vite chez lui, pas une
--   dépense chez l'éditeur. CE FICHIER N'Y TOUCHE PAS — et le test
--   `supabase/tests/ia_reglages_editeur.sql` le fige, pour qu'un
--   chantier de gouvernance n'emporte pas au passage des droits qui
--   appartiennent légitimement au client.
--
-- Un client doit pouvoir savoir ce qu'il consomme. Il ne doit pas
-- pouvoir décider ce que ça coûte à l'éditeur.
--
-- ============================================================
-- LE PIÈGE DE CETTE MIGRATION : LA LECTURE DOIT SURVIVRE
-- ============================================================
--
-- `ai_model_for_agent()` et `ai_cost_budget_remaining()` sont
-- `security invoker` et tournent DANS LE RUNTIME DES AGENTS, sous le
-- jeton du salarié qui utilise Oasis Care Pro. Si l'on fermait la
-- lecture de ces deux tables aux membres, la surcharge imposée par
-- l'éditeur deviendrait invisible au moteur : simulé en transaction
-- annulée, `ai_model_for_agent()` rend alors NULL — le routage retombe
-- silencieusement sur le défaut du produit — et `monthly_limit_cents`
-- rend NULL, c'est-à-dire « aucune limite ». SANS QU'AUCUNE ERREUR NE
-- SOIT LEVÉE NULLE PART. On aurait retiré la main au client en retirant
-- du même geste l'effet de la décision de l'éditeur.
--
-- La forme correcte, et la seule : le `select` des membres est
-- CONSERVÉ mot pour mot ; seule l'ÉCRITURE change de main.
--
-- ============================================================
-- POURQUOI AUCUNE POLITIQUE D'ÉCRITURE, MÊME POUR L'ÉDITEUR
-- ============================================================
--
-- On aurait pu écrire `for all using (platform_admin_can(...))` et en
-- rester là. Ç'aurait laissé intact le second défaut : une décision qui
-- coûte de l'argent à l'éditeur, prise sans motif et sans trace.
--
-- Ces deux tables suivent donc le modèle d'`admin_audit_events` (0075
-- § 3) et de `platform_admins` (0075 § 1) : AUCUNE politique `insert`,
-- `update` ni `delete`, et quatre fonctions `security definer` qui sont
-- le seul chemin. Chacune exige un MOTIF non vide, relève l'ancienne
-- valeur, écrit la nouvelle, et journalise les deux par
-- `record_admin_event()`. Elles rendent l'identifiant de la ligne de
-- journal : la trace n'est pas un effet de bord de l'écriture, c'est sa
-- valeur de retour. On ne peut pas changer un modèle ou un plafond sans
-- produire la trace, parce qu'il n'y a aucun autre geste possible.
--
-- ============================================================
-- ET UNE TROISIÈME PORTE, DÉCOUVERTE EN VÉRIFIANT LA BASE
-- ============================================================
--
-- Refermer ces deux tables ne suffisait pas. La production ne fait pas
-- tourner le 0076 du dépôt : la politique d'écriture de
-- `ai_result_cache` y est toujours `FOR ALL` sur `projects.read`, et
-- les trois fonctions de cache n'y sont pas `security definer`. Un
-- simple ouvrier efface donc d'un `delete` toutes les analyses déjà
-- calculées et déjà payées de son entreprise, que l'éditeur repaie une
-- à une chez le fournisseur. Le § 6 rattrape cette dérive : c'est la
-- même facture, par une autre porte.
--
-- ADDITIVE ET IDEMPOTENTE. Aucune donnée n'est reprise : la production
-- compte 0 surcharge et 0 plafond au moment d'écrire ces lignes, le
-- déménagement ne coûte donc aucune migration de données. Les
-- politiques se remplacent dans la même transaction que leur retrait —
-- il n'existe aucun instant où la table serait plus ouverte qu'avant.

-- ============================================================
-- 1. LE CATALOGUE : TROIS PERMISSIONS DE PLATEFORME
-- ============================================================
--
-- On ne réinvente pas un second modèle de droits : ce sont des
-- permissions du Control Center (0075 § 1.b), portées par
-- `platform_admin_can()`, et rien d'autre. `is_platform_admin()` et
-- `has_permission()` n'ont toujours aucun chemin l'un vers l'autre.
--
-- POURQUOI TROIS ET PAS UNE. Lire quel modèle tourne chez qui, changer
-- ce modèle, et lever un plafond de dépense ne sont pas le même geste
-- et ne coûtent pas la même chose. Une permission unique
-- `ai.settings.manage` aurait fait de tout porteur d'un droit de
-- lecture un ordonnateur de dépense.

insert into public.platform_admin_permissions (key, label, is_write) values
  ('ai.config.read',
   'Voir l''aiguillage des modèles et les plafonds IA de toutes les entreprises', false),
  ('ai.models.write',
   'Changer le modèle d''un agent chez une entreprise',                           true),
  ('ai.costLimits.write',
   'Poser, relever ou lever un plafond de dépense IA',                            true)
on conflict (key) do nothing;

-- ============================================================
-- 2. LE GARDE-FOU DE LA MATRICE, ÉTENDU AUX PERMISSIONS `ai.*`
-- ============================================================
--
-- 0075 § 1.c pose la règle : le moindre privilège s'écrit DEUX FOIS —
-- par l'absence de la ligne dans la matrice, et par un déclencheur qui
-- refuse de l'y insérer. « Une absence peut être comblée par
-- distraction dans six mois, un refus doit être supprimé exprès. »
--
-- Le garde-fou de 0075 ne raisonne que sur les préfixes `billing.%` et
-- `customer.%` : vérifié en transaction annulée, il ACCEPTAIT
-- aujourd'hui d'accorder `ai.models.write` au support comme au
-- responsable facturation. On le remplace ici — à l'identique pour les
-- quatre règles de 0075, qui sont recopiées mot pour mot, plus trois
-- règles neuves.
--
-- LA SÉPARATION DES POUVOIRS, QUI EST TOUT LE SUJET DE CE FICHIER.
-- Le produit choisit le modèle ; la facturation fixe le plafond. Aucun
-- des deux ne tient les deux bouts, exactement pour la raison qui a
-- motivé cette migration : celui qui peut faire monter la dépense ne
-- doit pas pouvoir lever la borne qui l'arrête. Seul le
-- super-administrateur cumule, et c'est un choix explicite, pas un
-- oubli.

create or replace function public.platform_admin_matrix_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_write boolean;
begin
  select p.is_write into v_is_write
  from public.platform_admin_permissions p
  where p.key = new.permission;

  if v_is_write is null then
    raise exception 'Permission inconnue : %', new.permission
      using errcode = '23514';
  end if;

  -- « Support : ne peut pas modifier les abonnements. » (spec p.30)
  if new.role = 'support' and v_is_write and new.permission like 'billing.%' then
    raise exception 'Moindre privilège (spec p.30) : le support ne modifie pas les abonnements — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- « Billing : ne peut pas ouvrir les données client. » (spec p.30)
  -- Écrite pour quatre rôles et non pour le seul `billing_admin` : le
  -- défaut voulu est l'inverse d'une liste d'exclusions.
  if new.role in ('billing_admin', 'product_admin', 'security_admin', 'read_only_analyst')
     and new.permission like 'customer.%' then
    raise exception 'Moindre privilège (spec p.30) : le rôle « % » n''ouvre pas les données client — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- « Product : ne peut pas modifier les paiements. » (spec p.30)
  if new.role = 'product_admin' and v_is_write and new.permission like 'billing.%' then
    raise exception 'Moindre privilège (spec p.30) : le produit ne touche pas aux paiements — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- ---- Neuf en 0080 : les réglages IA de l'éditeur ----------------
  --
  -- a) Trois rôles seulement peuvent tenir un droit d'écriture `ai.*` :
  --    le super-administrateur, le produit et la facturation. Le
  --    support, la sécurité et l'analyste n'ont aucune raison de faire
  --    varier la facture du fournisseur. La règle vise le PRÉFIXE et la
  --    colonne `is_write`, donc elle couvrira aussi les permissions
  --    `ai.*` qui n'existent pas encore (tarifs de jetons, quotas par
  --    plan) : c'est le point du garde-fou.
  if v_is_write and new.permission like 'ai.%'
     and new.role not in ('super_admin', 'product_admin', 'billing_admin') then
    raise exception 'Moindre privilège : le rôle « % » ne règle pas l''IA de la plateforme — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- b) La facturation ne choisit pas le modèle. Le niveau de modèle est
  --    un arbitrage de qualité produit (spec p.17) ; laisser la
  --    facturation le trancher, c'est laisser dégrader l'outil des
  --    clients pour tenir un budget, sans que personne du produit ait
  --    à le décider.
  if new.role = 'billing_admin' and v_is_write and new.permission like 'ai.model%' then
    raise exception 'Séparation des pouvoirs : la facturation ne choisit pas le modèle des agents — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- c) Le produit ne lève pas le plafond de dépense. C'est l'écho exact
  --    de « Product : ne peut pas modifier les paiements » (spec p.30),
  --    et surtout la leçon du défaut corrigé ici : celui qui peut faire
  --    monter la dépense ne tient pas la borne qui l'arrête.
  if new.role = 'product_admin' and v_is_write and new.permission like 'ai.cost%' then
    raise exception 'Séparation des pouvoirs : le produit ne lève pas les plafonds de dépense IA — permission % refusée.', new.permission
      using errcode = '23514';
  end if;
  -- -----------------------------------------------------------------

  -- Un analyste en lecture seule qui écrirait quelque chose ne serait
  -- plus en lecture seule.
  if new.role = 'read_only_analyst' and v_is_write then
    raise exception 'Un analyste en lecture seule n''écrit rien — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_admin_matrix_guard on public.platform_admin_role_permissions;
create trigger platform_admin_matrix_guard
  before insert or update on public.platform_admin_role_permissions
  for each row execute function public.platform_admin_matrix_guard();

revoke all on function public.platform_admin_matrix_guard() from public;
revoke all on function public.platform_admin_matrix_guard() from anon;
revoke all on function public.platform_admin_matrix_guard() from authenticated;

-- ============================================================
-- 3. LE SEMIS DE LA MATRICE — ET LE PIÈGE QU'IL ÉVITE
-- ============================================================
--
-- LE PIÈGE, VÉRIFIÉ : `super_admin` a été semé en 0075 PAR JOINTURE sur
-- le catalogue, au moment où 0075 s'exécutait. Une permission ajoutée
-- après coup n'est donc portée par PERSONNE — pas même par le
-- super-administrateur. Une migration qui se contenterait d'insérer les
-- trois permissions du § 1 livrerait un écran que personne ne pourrait
-- ouvrir, et sans erreur : le lien disparaîtrait simplement du menu.
--
-- On rejoue donc la jointure. Elle est idempotente et se rattrapera
-- d'elle-même à chaque migration future qui ajoutera une permission.

insert into public.platform_admin_role_permissions (role, permission)
select 'super_admin', key from public.platform_admin_permissions
on conflict do nothing;

-- product_admin : choisit le modèle, voit les plafonds, n'y touche pas.
insert into public.platform_admin_role_permissions (role, permission) values
  ('product_admin', 'ai.config.read'),
  ('product_admin', 'ai.models.write')
on conflict do nothing;

-- billing_admin : fixe les plafonds, voit l'aiguillage, ne le change pas.
insert into public.platform_admin_role_permissions (role, permission) values
  ('billing_admin', 'ai.config.read'),
  ('billing_admin', 'ai.costLimits.write')
on conflict do nothing;

-- `support` et `security_admin` NE REÇOIVENT RIEN ICI, volontairement.
-- Un support qui répond à « pourquoi mon IA s'est arrêtée hier ? »
-- aurait un usage légitime d'`ai.config.read`, et ce sera une ligne à
-- écrire ce jour-là, avec l'écran qui va avec. 0075 a posé la règle et
-- on s'y tient : un droit accordé d'avance est un droit que le premier
-- écran du jalon suivant trouve déjà ouvert, sans que personne ait eu à
-- décider.

-- ============================================================
-- 4. LES POLITIQUES : LA LECTURE RESTE, L'ÉCRITURE PART
-- ============================================================
--
-- Trois politiques par table, et pas une quatrième :
--
--   • « Members read … » — REPOSÉE À L'IDENTIQUE. C'est la ligne de vie
--     du runtime des agents (voir l'en-tête). Elle est réécrite ici
--     plutôt que laissée en place afin que ce fichier dise lui-même ce
--     qu'il conserve : un lecteur qui ne verrait pas cette politique
--     dans la migration pourrait croire qu'elle a disparu.
--   • « L'éditeur lit … » — la même lecture, à travers toutes les
--     organisations, pour le Control Center.
--   • Et c'est tout : « Managers write … » est RETIRÉE, et rien ne la
--     remplace. Les quatre fonctions du § 5 sont le seul chemin
--     d'écriture.
--
-- POURQUOI UNE POLITIQUE DE LECTURE ET NON UNE FONCTION `security
-- definer`, alors que 0075 R5 impose « des nombres, pas des lignes »
-- pour les lectures inter-organisations : cette règle protège les
-- DONNÉES MÉTIER DU CLIENT — un devis, une photo, une plante. Ces deux
-- tables ne contiennent rien de tel. Elles contiennent la configuration
-- de l'éditeur chez son client : un identifiant de modèle, trois
-- montants en centimes, un motif écrit par l'éditeur lui-même. Les lire
-- en lignes n'ouvre aucune donnée client.

do $$
declare t text;
begin
  foreach t in array array['ai_cost_limits', 'ai_model_overrides']
  loop
    execute format('alter table public.%I enable row level security', t);

    -- LA LECTURE DU CLIENT. Ne pas retirer : `ai_model_for_agent()` et
    -- `ai_cost_budget_remaining()` sont `security invoker` et passent
    -- par ici. Sans elle, la surcharge et le plafond IMPOSÉS PAR
    -- L'ÉDITEUR deviennent invisibles au moteur, sans erreur.
    execute format('drop policy if exists "Members read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members read %1$s" on public.%1$I
         for select using (public.is_organization_member(organization_id))', t);

    -- LA LECTURE DE L'ÉDITEUR, à travers les organisations.
    execute format('drop policy if exists "Platform reads %1$s" on public.%1$I', t);
    execute format(
      'create policy "Platform reads %1$s" on public.%1$I
         for select using (public.platform_admin_can(''ai.config.read''))', t);

    -- L'ÉCRITURE DU CLIENT — retirée. C'est la ligne qui donnait au
    -- gestionnaire d'une entreprise cliente le droit de choisir le
    -- modèle que l'éditeur paierait, et de supprimer son propre
    -- plafond. Aucune politique d'écriture ne la remplace, pour
    -- personne : voir § 5.
    execute format('drop policy if exists "Managers write %1$s" on public.%1$I', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4.b Les droits de table
-- ------------------------------------------------------------
-- La RLS refuse déjà l'écriture à tout le monde, mais un droit
-- `insert/update/delete` qui traîne est une seconde serrure laissée
-- ouverte : le jour où quelqu'un rajoute une politique permissive « le
-- temps d'un correctif », le grant est déjà là pour la rendre
-- effective. Même geste qu'en 0075 : on retire tout, `public` d'abord —
-- un droit accordé au pseudo-rôle `public` est hérité par tout le monde
-- et survivrait au retrait des deux autres — puis on rend le strict
-- nécessaire, c'est-à-dire le `select` du runtime.
--
-- `anon` ne conserve RIEN. Il n'a aucune raison de lire la
-- configuration IA d'une entreprise, et Supabase lui avait accordé par
-- défaut les sept droits, y compris `truncate`.

do $$
declare t text;
begin
  foreach t in array array['ai_cost_limits', 'ai_model_overrides']
  loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ============================================================
-- 5. LES QUATRE ÉCRITURES, TOUTES JOURNALISÉES
-- ============================================================
--
-- CE QUI EST COMMUN AUX QUATRE, et qu'on relit sans suivre d'appel :
--
--   1. La barrière est dans les premières lignes, et c'est
--      `platform_admin_can()` — jamais `has_permission()`, jamais un
--      `organization_id` reçu en paramètre. R4 de 0075 : un identifiant
--      reçu n'est pas une preuve de portée. Ici l'organisation est la
--      CIBLE de l'acte, pas son autorisation.
--   2. Le motif est obligatoire et non vide, refusé avant toute
--      écriture. Une décision qui coûte de l'argent se justifie au
--      moment où on la prend.
--   3. L'ancienne valeur est relevée AVANT, la nouvelle APRÈS, et les
--      deux partent dans `record_admin_event()`. `updated_at` /
--      `updated_by` écrasent l'état précédent ; sans ce relevé, il
--      serait perdu — c'est exactement ce qui se passait avant ce
--      fichier.
--   4. La valeur de retour est l'identifiant de la ligne de journal.
--      Si la journalisation échoue, la fonction lève et l'écriture est
--      annulée avec elle : dans une transaction, il n'existe pas d'état
--      « changé mais non tracé ».
--   5. `set search_path = public, pg_temp`, `pg_temp` nommé EN DERNIER.
--      En `security definer`, un `pg_temp` non listé est fouillé en
--      premier pour les tables : un appelant qui créerait une table
--      temporaire `ai_cost_limits` détournerait la fonction.
--
-- SUR LE MOTIF, UN CHOIX À CONNAÎTRE. La colonne `reason` de
-- `ai_model_overrides` (« pourquoi cette entreprise déroge ») reçoit le
-- MÊME texte que le motif du journal. Deux motifs distincts pour un
-- seul geste, c'est un formulaire à deux champs que personne ne remplit
-- deux fois honnêtement, et deux vérités qui divergent au premier
-- copier-coller.

-- ------------------------------------------------------------
-- 5.a Poser ou changer le modèle d'un agent
-- ------------------------------------------------------------
create or replace function public.admin_set_ai_model_override(
  p_organization_id uuid,
  p_agent text,
  p_model text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent text;
  v_model text;
  v_reason text;
  v_org_label text;
  v_old text;
begin
  if not public.platform_admin_can('ai.models.write') then
    raise exception 'Accès refusé : seul un administrateur de la plateforme habilité choisit le modèle d''un agent.'
      using errcode = '42501';
  end if;

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : changer de modèle change la facture de l''éditeur, cela se justifie.'
      using errcode = '23514';
  end if;

  v_agent := public.ai_clean_text(p_agent, 60);
  if v_agent is null or not public.ai_is_supported_agent(v_agent) then
    raise exception 'Agent inconnu ou non surchargeable : %.', coalesce(v_agent, '(vide)')
      using errcode = '23514';
  end if;

  -- Texte libre, comme la colonne : SQL ne connaît aucun nom de modèle,
  -- et une liste blanche ici se tromperait la première (0076). On refuse
  -- seulement le vide, qui ne peut être qu'une erreur de saisie.
  v_model := public.ai_clean_text(p_model, 200);
  if v_model is null then
    raise exception 'Identifiant de modèle vide : un aiguillage vers rien n''est pas un aiguillage.'
      using errcode = '23514';
  end if;

  -- L'entreprise doit exister. Sans ce contrôle, la clé étrangère
  -- lèverait un message illisible, et une faute de frappe sur
  -- l'identifiant passerait pour une panne.
  select o.name into v_org_label
  from public.business_organizations o
  where o.id = p_organization_id;

  if v_org_label is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id
      using errcode = '23503';
  end if;

  select m.model into v_old
  from public.ai_model_overrides m
  where m.organization_id = p_organization_id and m.agent = v_agent;

  insert into public.ai_model_overrides (organization_id, agent, model, reason, updated_by)
  values (p_organization_id, v_agent, v_model, v_reason, auth.uid())
  on conflict (organization_id, agent) do update
    set model = excluded.model,
        reason = excluded.reason,
        updated_at = now(),
        updated_by = excluded.updated_by;

  -- `v_old` à NULL se traduit par un `old_value` JSON nul, et non par un
  -- nom de modèle inventé : « aucune surcharge » et « surchargé sur le
  -- défaut » ne sont pas le même état.
  return public.record_admin_event(
    'aiModel.overrideSet',
    'organization',
    p_organization_id,
    v_org_label,
    case when v_old is null then null
         else jsonb_build_object('agent', v_agent, 'model', v_old) end,
    jsonb_build_object('agent', v_agent, 'model', v_model),
    v_reason
  );
end;
$$;

comment on function public.admin_set_ai_model_override(uuid, text, text, text) is
  'Impose le modèle d''un agent chez une entreprise. Réservé à ai.models.write, motif obligatoire, journalisé. Rend l''identifiant de la ligne d''audit.';

-- ------------------------------------------------------------
-- 5.b Lever la surcharge : l'entreprise revient au défaut du produit
-- ------------------------------------------------------------
create or replace function public.admin_clear_ai_model_override(
  p_organization_id uuid,
  p_agent text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent text;
  v_reason text;
  v_org_label text;
  v_old text;
begin
  if not public.platform_admin_can('ai.models.write') then
    raise exception 'Accès refusé : seul un administrateur de la plateforme habilité lève une surcharge de modèle.'
      using errcode = '42501';
  end if;

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : une surcharge sans motif ne se lève jamais, personne n''ose défaire ce qu''il ne comprend pas.'
      using errcode = '23514';
  end if;

  v_agent := public.ai_clean_text(p_agent, 60);

  select o.name into v_org_label
  from public.business_organizations o
  where o.id = p_organization_id;

  if v_org_label is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id
      using errcode = '23503';
  end if;

  select m.model into v_old
  from public.ai_model_overrides m
  where m.organization_id = p_organization_id and m.agent = v_agent;

  -- RIEN À LEVER EST UNE ERREUR, PAS UN SUCCÈS SILENCIEUX. Une fonction
  -- qui rendrait « fait » sans rien avoir fait laisserait croire à
  -- l'administrateur que l'entreprise est revenue au défaut, alors
  -- qu'il s'est trompé d'agent ou d'entreprise.
  if v_old is null then
    raise exception 'Aucune surcharge de modèle à lever pour l''agent « % » chez cette entreprise.', coalesce(v_agent, '(vide)')
      using errcode = 'P0002';
  end if;

  delete from public.ai_model_overrides
  where organization_id = p_organization_id and agent = v_agent;

  return public.record_admin_event(
    'aiModel.overrideCleared',
    'organization',
    p_organization_id,
    v_org_label,
    jsonb_build_object('agent', v_agent, 'model', v_old),
    null,
    v_reason
  );
end;
$$;

comment on function public.admin_clear_ai_model_override(uuid, text, text) is
  'Lève la surcharge de modèle d''un agent : l''entreprise suit de nouveau la carte par défaut du produit. Réservé à ai.models.write, journalisé.';

-- ------------------------------------------------------------
-- 5.c Poser les trois plafonds de dépense
-- ------------------------------------------------------------
--
-- LA FONCTION POSE LES TROIS, ET UN NULL VEUT DIRE « AUCUNE LIMITE ».
-- Ce n'est pas « ne change pas ce plafond-là » : c'est le geste du
-- formulaire, où vider un champ retire la limite. On garde cette
-- sémantique parce qu'elle est déjà celle de la table (0076 : « une
-- colonne NULL veut dire aucune limite, jamais limite à zéro ») et
-- qu'un troisième sens du NULL rendrait l'écran indéchiffrable. Ce qui
-- change, c'est que le geste laisse maintenant une trace nominative
-- avec son motif, et qu'il n'est plus à la portée du client.
--
-- ZÉRO N'EST PAS NULL. Zéro est un plafond à zéro, c'est-à-dire l'IA
-- coupée pour cette entreprise — un réglage légitime, écrit à la main
-- par quelqu'un. Aucun `coalesce` ne les confond ici, ni dans le
-- journal.
create or replace function public.admin_set_ai_cost_limits(
  p_organization_id uuid,
  p_daily_cents bigint,
  p_monthly_cents bigint,
  p_per_agent_cents bigint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org_label text;
  v_old jsonb;
begin
  if not public.platform_admin_can('ai.costLimits.write') then
    raise exception 'Accès refusé : seul un administrateur de la plateforme habilité fixe un plafond de dépense IA.'
      using errcode = '42501';
  end if;

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un plafond posé ou levé sans raison est un plafond que personne n''ose plus toucher.'
      using errcode = '23514';
  end if;

  -- Les contraintes de la table refusent déjà le négatif, mais elles le
  -- diraient en langage de contrainte. Un montant négatif est presque
  -- toujours un signe inversé dans un formulaire.
  if coalesce(p_daily_cents, 0) < 0
     or coalesce(p_monthly_cents, 0) < 0
     or coalesce(p_per_agent_cents, 0) < 0 then
    raise exception 'Un plafond de dépense ne peut pas être négatif. Laisser le champ vide retire la limite ; zéro coupe l''IA.'
      using errcode = '23514';
  end if;

  select o.name into v_org_label
  from public.business_organizations o
  where o.id = p_organization_id;

  if v_org_label is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id
      using errcode = '23503';
  end if;

  select jsonb_build_object(
           'daily_cents',     l.daily_organization_limit_cents,
           'monthly_cents',   l.monthly_organization_limit_cents,
           'per_agent_cents', l.per_agent_limit_cents)
    into v_old
  from public.ai_cost_limits l
  where l.organization_id = p_organization_id;

  insert into public.ai_cost_limits (
    organization_id,
    daily_organization_limit_cents,
    monthly_organization_limit_cents,
    per_agent_limit_cents,
    updated_by
  )
  values (p_organization_id, p_daily_cents, p_monthly_cents, p_per_agent_cents, auth.uid())
  on conflict (organization_id) do update
    set daily_organization_limit_cents   = excluded.daily_organization_limit_cents,
        monthly_organization_limit_cents = excluded.monthly_organization_limit_cents,
        per_agent_limit_cents            = excluded.per_agent_limit_cents,
        updated_at = now(),
        updated_by = excluded.updated_by;

  -- `v_old` nul = il n'y avait AUCUNE ligne, donc aucune limite. Un
  -- objet à trois nuls dirait la même chose ; on garde la distinction
  -- parce qu'elle raconte l'histoire : « premier plafond posé » n'est
  -- pas « plafonds remis à vide ».
  return public.record_admin_event(
    'aiCostLimit.set',
    'organization',
    p_organization_id,
    v_org_label,
    v_old,
    jsonb_build_object(
      'daily_cents',     p_daily_cents,
      'monthly_cents',   p_monthly_cents,
      'per_agent_cents', p_per_agent_cents),
    v_reason
  );
end;
$$;

comment on function public.admin_set_ai_cost_limits(uuid, bigint, bigint, bigint, text) is
  'Pose les TROIS plafonds de dépense IA d''une entreprise (NULL = aucune limite, 0 = IA coupée). Réservé à ai.costLimits.write, motif obligatoire, journalisé.';

-- ------------------------------------------------------------
-- 5.d Retirer la ligne de plafonds
-- ------------------------------------------------------------
-- Le geste le plus dangereux du lot : après lui, l'entreprise dépense
-- sans borne. Il reste possible — il faut pouvoir défaire — mais il est
-- nominatif, motivé et daté.
create or replace function public.admin_clear_ai_cost_limits(
  p_organization_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org_label text;
  v_old jsonb;
begin
  if not public.platform_admin_can('ai.costLimits.write') then
    raise exception 'Accès refusé : seul un administrateur de la plateforme habilité retire un plafond de dépense IA.'
      using errcode = '42501';
  end if;

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : retirer tout plafond, c''est accepter une dépense sans borne — la raison doit être écrite.'
      using errcode = '23514';
  end if;

  select o.name into v_org_label
  from public.business_organizations o
  where o.id = p_organization_id;

  if v_org_label is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id
      using errcode = '23503';
  end if;

  select jsonb_build_object(
           'daily_cents',     l.daily_organization_limit_cents,
           'monthly_cents',   l.monthly_organization_limit_cents,
           'per_agent_cents', l.per_agent_limit_cents)
    into v_old
  from public.ai_cost_limits l
  where l.organization_id = p_organization_id;

  if v_old is null then
    raise exception 'Aucun plafond de dépense IA à retirer chez cette entreprise.'
      using errcode = 'P0002';
  end if;

  delete from public.ai_cost_limits where organization_id = p_organization_id;

  return public.record_admin_event(
    'aiCostLimit.cleared',
    'organization',
    p_organization_id,
    v_org_label,
    v_old,
    null,
    v_reason
  );
end;
$$;

comment on function public.admin_clear_ai_cost_limits(uuid, text) is
  'Retire entièrement les plafonds de dépense IA d''une entreprise : elle dépense ensuite sans borne. Réservé à ai.costLimits.write, journalisé.';

-- ------------------------------------------------------------
-- 5.e Les droits d'exécution
-- ------------------------------------------------------------
-- PostgreSQL donne `execute` à `public` par défaut, et Supabase expose
-- toute fonction de `public` en RPC PostgREST : sur une fonction
-- `security definer`, ce défaut est une porte ouverte dont la clause de
-- garde est le seul filtre. On retire tout, `public` d'abord, puis on
-- rend l'`execute` à `authenticated` et à lui seul.
--
-- `service_role` en conserve un, hérité du défaut de Supabase. Ce n'est
-- pas une faille et le retirer serait cosmétique : `platform_admin_can()`
-- s'appuie sur `auth.uid()`, qui est nul pour un client `service_role`
-- sans jeton — la fonction refuse. Posséder la clé n'est pas être
-- autorisé (0075 R3).

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_set_ai_model_override(uuid, text, text, text)',
    'public.admin_clear_ai_model_override(uuid, text, text)',
    'public.admin_set_ai_cost_limits(uuid, bigint, bigint, bigint, text)',
    'public.admin_clear_ai_cost_limits(uuid, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 6. LA DÉRIVE DU CACHE — LE MÊME ARGENT, PAR L'AUTRE PORTE
-- ============================================================
--
-- CE PARAGRAPHE N'ÉTAIT PAS PRÉVU. Il a été ajouté après avoir vérifié
-- EN BASE, et non dans les fichiers, ce que la production fait
-- réellement. Le constat est têtu :
--
--   LA PRODUCTION NE FAIT PAS TOURNER LE 0076 DU DÉPÔT. Le fichier
--   `0076_architecture_ia.sql` déclare `ai_cache_lookup`,
--   `ai_cache_store` et `ai_invalidate_result_cache` en `security
--   definer` gardées par `ai_guard(org, 'projects.read')`, et supprime
--   la politique d'écriture de `ai_result_cache`. Rien de tout cela
--   n'est déployé : les trois fonctions sont `prosecdef = false` et ne
--   contiennent aucun `ai_guard`, et la politique
--   « Members with projects.read can write ai_result_cache » est
--   toujours là, en `FOR ALL`. Ce qui tourne est une révision
--   ANTÉRIEURE du même fichier.
--
-- CE QUE CELA COÛTE — et c'est exactement la facture que 0080 protège.
-- `projects.read` est l'unique permission du rôle le plus étroit du
-- produit, le `fieldWorker`. Joué en transaction annulée sur cette
-- base : sous son jeton, `delete from ai_result_cache where
-- organization_id = <la sienne>` ne lève rien et efface réellement les
-- lignes. Chaque brief de direction, chaque analyse de devis déjà
-- calculée et déjà payée se repaie alors chez le fournisseur — sur la
-- facture de l'éditeur, pas sur la sienne. La politique étant `for
-- all`, il peut aussi RÉÉCRIRE le contenu d'une réponse déjà calculée,
-- que le dirigeant recevra ensuite comme étant l'avis d'Oasis :
-- `ai_cache_lookup` ne revérifie rien, elle rend ce qu'elle trouve.
--
-- POURQUOI ICI, ET PAS DANS UNE MIGRATION À PART. Parce que 0080 n'est
-- pas encore appliquée : la compléter avant sa première exécution est
-- possible, alors que 0076 ne doit plus être touchée. Et surtout parce
-- que c'est le même sujet, mot pour mot : 0080 retire au client le
-- droit de décider de ce que l'éditeur paie ; le laisser vider le cache
-- le lui rendrait par une autre porte, et sans même un formulaire.
--
-- LES DEUX GESTES SONT INDISSOCIABLES et doivent rester dans la même
-- transaction. Les fonctions déployées écrivent aujourd'hui GRÂCE à la
-- politique : retirer la politique sans les repasser en `security
-- definer` couperait l'alimentation du cache — `ai_cache_store`
-- lèverait, `ai_cache_lookup` cesserait de compter — et l'éditeur
-- repaierait tout, c'est-à-dire le défaut qu'on referme, à l'envers.
-- Les repasser en `definer` sans retirer la politique laisserait la
-- porte du `delete` grande ouverte. On fait les deux.
--
-- LE CORPS DES TROIS FONCTIONS EST CELUI DE 0076, INCHANGÉ. Comparé
-- ligne à ligne au déployé : seuls manquaient `security definer` et
-- l'appel à `ai_guard`. On n'en profite pas pour corriger autre chose —
-- une migration de rattrapage qui fait plus que rattraper est une
-- migration qu'on ne peut plus relire.
--
-- Une seule différence assumée avec le fichier 0076 : `search_path` y
-- vaut `public` seul, ce qui laisse `pg_temp` implicitement fouillé EN
-- PREMIER. Sur une fonction `security definer`, c'est le détournement
-- décrit au § 5.5 — un appelant qui créerait une table temporaire
-- `ai_result_cache` se la ferait servir à la place de la vraie. On
-- nomme donc `pg_temp` en dernier, comme les quatre fonctions du § 5.

create or replace function public.ai_cache_lookup(
  p_organization_id uuid,
  p_agent text,
  p_cache_key text,
  p_model text,
  p_source_fingerprint text
)
returns jsonb
language plpgsql
-- `security definer` AVEC `ai_guard`. La lecture seule se serait
-- contentée de la RLS ; mais cette fonction ÉCRIT aussi — elle
-- incrémente `hit_count` — et depuis que l'écriture n'est plus ouverte
-- par aucune politique, un `update` en `invoker` ne lèverait pas : il
-- toucherait ZÉRO ligne, en silence, et le compteur de lectures du
-- cache s'arrêterait sans que personne ne s'en aperçoive.
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  if p_organization_id is null or p_cache_key is null
     or p_agent is null or p_model is null or p_source_fingerprint is null then
    -- Un appel incomplet ne doit pas ressembler à un défaut de cache
    -- ordinaire ; il doit se voir.
    raise exception 'Lecture de cache incomplète : entreprise, agent, clé, modèle et empreinte sont tous requis.';
  end if;

  perform public.ai_guard(p_organization_id, 'projects.read');

  select c.id, c.result into v_id, v_result
  from public.ai_result_cache c
  where c.organization_id = p_organization_id
    and c.agent = p_agent
    and c.cache_key = p_cache_key
    and c.model = p_model
    and c.source_fingerprint = p_source_fingerprint
    and c.expires_at > now();

  if v_id is null then
    return null;
  end if;

  -- La fonction étant `security definer`, l'écriture aboutit ; le
  -- garde-fou reste, parce qu'un compteur ne vaut jamais qu'on perde la
  -- réponse.
  begin
    update public.ai_result_cache
       set hit_count = hit_count + 1,
           last_hit_at = now()
     where id = v_id;
  exception when insufficient_privilege then
    null;
  end;

  return v_result;
end;
$$;

create or replace function public.ai_cache_store(
  p_organization_id uuid,
  p_agent text,
  p_cache_key text,
  p_model text,
  p_source_fingerprint text,
  p_result jsonb,
  p_ttl_seconds int default 600,
  p_data_sources jsonb default '[]'::jsonb,
  p_data_snapshot_timestamp timestamptz default now()
)
returns uuid
language plpgsql
-- Le droit se vérifie ici, en première ligne, et il vaut
-- `projects.read` : c'est le SERVEUR qui alimente le cache pour le
-- compte du lecteur, et non le lecteur qui y dépose ce qu'il veut. La
-- différence tient à la seule chose qui compte — par cette fonction, le
-- contenu écrit est celui que le modèle a rendu.
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_ttl int;
begin
  if p_organization_id is null or p_cache_key is null
     or p_agent is null or p_model is null or p_source_fingerprint is null then
    raise exception 'Écriture de cache incomplète : entreprise, agent, clé, modèle et empreinte sont tous requis.';
  end if;

  perform public.ai_guard(p_organization_id, 'projects.read');

  if p_result is null then
    raise exception 'Un résultat vide n''a rien à faire au cache : il serait resservi comme une réponse.';
  end if;

  -- Une durée de vie nulle ou négative produirait une entrée déjà
  -- périmée, donc de la place occupée pour rien. Une seconde au
  -- minimum, une journée au maximum.
  v_ttl := least(greatest(coalesce(p_ttl_seconds, 600), 1), 86400);

  insert into public.ai_result_cache (
    organization_id, agent, cache_key, model, source_fingerprint,
    result, data_sources, data_snapshot_timestamp, expires_at
  ) values (
    p_organization_id, p_agent, p_cache_key, p_model, p_source_fingerprint,
    p_result,
    coalesce(p_data_sources, '[]'::jsonb),
    coalesce(p_data_snapshot_timestamp, now()),
    now() + make_interval(secs => v_ttl)
  )
  on conflict (organization_id, agent, cache_key, model) do update set
    source_fingerprint      = excluded.source_fingerprint,
    result                  = excluded.result,
    data_sources            = excluded.data_sources,
    data_snapshot_timestamp = excluded.data_snapshot_timestamp,
    created_at              = now(),
    expires_at              = excluded.expires_at,
    -- Le compteur repart : c'est une AUTRE réponse, ses lectures ne
    -- sont pas celles de la précédente.
    hit_count               = 0,
    last_hit_at             = null
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.ai_invalidate_result_cache(
  p_organization_id uuid,
  p_agent text default null,
  p_cache_key_prefix text default null
)
returns int
language plpgsql
-- Même régime que `ai_cache_store`, et pour la même raison : aucune
-- politique n'autorise le `delete`. Sans ce verrou, un compte de
-- lecture seule vidait le cache de son entreprise et faisait repayer
-- chaque brief — une dépense qu'il ne pouvait ni voir ni expliquer.
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_organization_id is null then
    raise exception 'Organisation manquante : on ne vide pas le cache de tout le monde.';
  end if;

  perform public.ai_guard(p_organization_id, 'projects.read');

  delete from public.ai_result_cache c
  where c.organization_id = p_organization_id
    and (p_agent is null or c.agent = p_agent)
    -- `LIKE` AVEC UN PRÉFIXE ÉCHAPPÉ. Les clés sont construites par
    -- l'appelant et peuvent contenir n'importe quoi ; un `%` ou un `_`
    -- non échappé transformerait « vide la famille X » en « vide aussi
    -- les voisines », ce qui coûte des recalculs sans jamais lever
    -- d'erreur — donc sans jamais se faire remarquer. Le contre-oblique
    -- passe en premier, sinon on échapperait les échappements.
    and (p_cache_key_prefix is null
         or c.cache_key like
            replace(replace(replace(p_cache_key_prefix, '\', '\\'), '%', '\%'), '_', '\_')
            || '%');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- La politique d'écriture s'en va, la lecture reste — même forme qu'au
-- § 4, et pour la même raison : le `select` du membre est ce qui fait
-- fonctionner le produit, l'écriture est ce qui permet d'en abuser.
drop policy if exists "Members with projects.read can write ai_result_cache"
  on public.ai_result_cache;

-- Reposée à l'identique, pour que ce fichier dise lui-même ce qu'il
-- conserve.
drop policy if exists "Members with projects.read can read ai_result_cache"
  on public.ai_result_cache;
create policy "Members with projects.read can read ai_result_cache"
  on public.ai_result_cache
  for select using (public.has_permission(organization_id, 'projects.read'));

-- Les droits de table : la seconde serrure. `anon` détenait, par défaut
-- Supabase, les sept droits sur cette table — `truncate` compris.
revoke all on public.ai_result_cache from public;
revoke all on public.ai_result_cache from anon;
revoke all on public.ai_result_cache from authenticated;
grant select on public.ai_result_cache to authenticated;

-- Les droits d'exécution, que 0076 déclarait sans les déployer. Les
-- trois fonctions sont désormais `security definer` : le défaut
-- PostgreSQL (`execute` à `public`, donc à `anon`) en ferait un point
-- d'entrée dont la clause de garde serait le seul filtre.
revoke all on function public.ai_cache_lookup(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.ai_cache_lookup(uuid, text, text, text, text)
  to authenticated;

revoke all on function public.ai_cache_store(
  uuid, text, text, text, text, jsonb, int, jsonb, timestamptz
) from public, anon;
grant execute on function public.ai_cache_store(
  uuid, text, text, text, text, jsonb, int, jsonb, timestamptz
) to authenticated;

revoke all on function public.ai_invalidate_result_cache(uuid, text, text)
  from public, anon;
grant execute on function public.ai_invalidate_result_cache(uuid, text, text)
  to authenticated;


-- ------------------------------------------------------------
-- 6.b LA MÊME DÉRIVE, SUR LE GRAND LIVRE
-- ------------------------------------------------------------
-- L'inventaire de la dérive a rendu une seconde fonction : le
-- `ai_record_usage_event` déployé diffère de celui du fichier 0076 par
-- UNE SEULE LIGNE — il insère `p_decision_id` tel quel, là où le
-- fichier le fait passer par un sous-select borné à l'entreprise.
--
-- La conséquence n'est pas un vol de données : la clé étrangère
-- `(decision_id, organization_id)` refuse de toute façon un
-- rattachement forgé. Elle le refuse en LEVANT, c'est-à-dire en faisant
-- échouer l'enregistrement de la dépense — un appel payé chez le
-- fournisseur qui n'entre jamais au grand livre, donc une dépense
-- invisible au budget, à cause d'un identifiant que l'appelant a
-- inventé. Le sous-select du fichier neutralise l'identifiant au lieu
-- de perdre l'écriture : on garde la dépense, on jette le
-- rattachement.
--
-- C'est aussi ce qui fait ABANDONNER `supabase/tests/architecture_ia.sql`
-- en cours de route aujourd'hui, sans rendre le moindre verdict.
--
-- Le corps est celui de 0076, recopié sans autre changement.

create or replace function public.ai_record_usage_event(
  p_organization_id uuid,
  p_agent text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_duration_ms int,
  p_success boolean default true,
  p_tool_calls int default 0,
  p_estimated_cost_cents bigint default null,
  p_cost_basis text default null,
  p_failure_reason text default null,
  p_fallback_from_model text default null,
  p_decision_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_agent text;
  v_model text;
begin
  if p_organization_id is null then
    raise exception 'Organisation manquante : une dépense sans entreprise n''est imputable à personne.';
  end if;

  -- `security definer` : la RLS ne dira rien, donc le contrôle est ici.
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Organisation inaccessible.';
  end if;

  v_agent := public.ai_clean_text(p_agent, 60);
  v_model := public.ai_clean_text(p_model, 120);

  if v_agent is null then
    raise exception 'Agent manquant : une dépense anonyme ne se ventile pas.';
  end if;
  if v_model is null then
    raise exception 'Modèle manquant : sans lui, l''estimation n''est pas vérifiable.';
  end if;

  insert into public.ai_usage_events (
    organization_id, agent, model, input_tokens, output_tokens,
    estimated_cost_cents, cost_basis, duration_ms, tool_calls,
    success, failure_reason, fallback_from_model, decision_id, user_id
  ) values (
    p_organization_id,
    v_agent,
    v_model,
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    -- SURTOUT PAS de `coalesce(..., 0)` : voir la règle 2.
    p_estimated_cost_cents,
    public.ai_clean_text(p_cost_basis, 120),
    greatest(coalesce(p_duration_ms, 0), 0),
    greatest(coalesce(p_tool_calls, 0), 0),
    coalesce(p_success, true),
    p_failure_reason,
    public.ai_clean_text(p_fallback_from_model, 120),
    -- UN RATTACHEMENT INVALIDE FAIT PERDRE LE LIEN, JAMAIS LA DÉPENSE.
    --
    -- `ai_usage_events` porte une clé étrangère COMPOSITE
    -- `(decision_id, organization_id)` : un identifiant qui n'existe pas
    -- dans l'entreprise faisait LEVER l'insertion. Et l'appelant avale
    -- cette exception pour ne pas perdre une réponse déjà payée. Il
    -- suffisait donc d'un `decisionId` inventé dans le corps d'une
    -- requête HTTP pour qu'aucune ligne du grand livre ne soit écrite —
    -- ni l'appel initial, ni l'escalade, ni le repli, ni le refus
    -- budgétaire. La dépense restait à zéro, et les trois plafonds de la
    -- page 19 ne se déclenchaient jamais.
    --
    -- Le même cas se produit sans malveillance : un écran resté ouvert
    -- qui renvoie l'identifiant d'une décision supprimée entre-temps.
    --
    -- La route valide déjà l'appartenance et refuse en 400 ; ceci est la
    -- défense de fond, celle qui vaut pour TOUS les appelants, y compris
    -- ceux qu'on écrira plus tard.
    (select d.id from public.ai_decisions d
      where d.id = p_decision_id and d.organization_id = p_organization_id),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ------------------------------------------------------------
-- 6.c LA DÉRIVE LA PLUS COÛTEUSE DES TROIS : LE SEUIL DE RISQUE
-- ------------------------------------------------------------
-- Troisième écart entre le fichier 0076 et la base, et celui-ci
-- n'engage plus la facture de l'éditeur mais le client lui-même :
--
--   `ai_seuil_risque_eleve_cents()` N'EXISTE PAS EN PRODUCTION, et
--   `ai_may_autoexecute()` y est encore la version de 0072, à douze
--   conditions. Vérifié : la fonction déployée ne contient ni
--   `risque_confirmable` ni le moindre appel au seuil.
--
-- Autrement dit, la treizième condition de la page 15-16 — « une action
-- de risque `high` ou `critical`, ou qui engage 20 000 € ou plus, ne
-- part JAMAIS en autopilote » — n'est appliquée nulle part en base.
-- Seul le miroir TypeScript (`RISQUE_ELEVE_AU_DELA_DE_CENTS`) la tient,
-- c'est-à-dire une seule des deux surfaces, alors que 0076 l'a écrite
-- en SQL précisément pour qu'elle vaille aussi pour « un appelant qu'on
-- n'a pas encore écrit ».
--
-- ON LA DÉPLOIE, ET C'EST UN CHOIX QUI SE DISCUTE. Deux raisons de le
-- faire ici plutôt que de le signaler : le sens du changement est
-- FERMANT — après lui, des actions qui partaient seules demandent une
-- confirmation humaine, jamais l'inverse ; et le reste de la fonction
-- est celui de 0072 sans une virgule de différence, donc le seul effet
-- observable est la treizième condition. Si ce n'est pas le moment,
-- supprimer ce § 6.c suffit : rien d'autre dans ce fichier n'en dépend
-- — mais `supabase/tests/architecture_ia.sql` s'arrêtera alors dessus,
-- faute de la fonction de seuil.
--
-- Le bloc est celui de 0076 § 6 bis, recopié sans changement.

create or replace function public.ai_seuil_risque_eleve_cents()
returns bigint
language sql
immutable
as $$ select 2000000::bigint $$;

comment on function public.ai_seuil_risque_eleve_cents() is
  'Au-delà de ce montant, une action est traitée comme « risque élevé » : elle exige une confirmation humaine et ne part jamais en autopilote (spec p. 15-16).';

create or replace function public.ai_may_autoexecute(
  p_organization_id uuid,
  p_agent text,
  p_action_type text,
  p_amount_cents bigint default null,
  p_target_entity_type text default null,
  p_target_entity_id uuid default null
)
returns boolean
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_catalog public.ai_action_catalog;
  v_setting public.ai_agent_settings;
  v_rule public.ai_autopilot_rules;
  v_checks jsonb;
  v_hour int;
  v_cible_org uuid;
  -- Le nombre de conditions ci-dessous. Si quelqu'un en retire une, le
  -- compte ne colle plus et la fonction refuse tout — panne visible
  -- plutôt que relâchement silencieux.
  c_conditions constant int := 13;
begin
  select * into v_catalog from public.ai_action_catalog where action_type = p_action_type;

  -- L'AGENT VIENT DU CATALOGUE. `p_agent` est une déclaration de
  -- l'appelant, vérifiée plus bas ; elle ne sert jamais à choisir la
  -- ligne de réglages qu'on va lui opposer.
  select * into v_setting from public.ai_agent_settings
   where organization_id = p_organization_id and agent = v_catalog.agent;

  select * into v_rule from public.ai_autopilot_rules
   where organization_id = p_organization_id and action_type = p_action_type;

  v_hour := extract(hour from (now() at time zone 'Europe/Paris'))::int;

  -- L'organisation RÉELLE de la cible, vue sans la RLS — la même
  -- réponse que celle qu'oppose `ai_actions_check_target`.
  v_cible_org := public.ai_entity_organization(p_target_entity_type, p_target_entity_id);

  v_checks := jsonb_build_object(

    'membre',
      public.is_organization_member(p_organization_id),

    'action_connue',
      v_catalog.action_type is not null,

    'action_eligible',
      v_catalog.autopilot_eligible,

    -- 1. Niveau d'autonomie 4, et agent allumé. Un agent éteint au
    --    niveau 4 est un agent éteint. `v_setting` a été chargé sur
    --    `v_catalog.agent` : c'est l'agent PROPRIÉTAIRE de l'action qui
    --    doit être au niveau 4, pas celui que l'appelant préfère.
    'agent_niveau_4',
      v_setting.enabled and v_setting.autonomy_level = 4,

    -- L'agent annoncé doit être celui du catalogue. Il ne sert plus à
    -- rien d'autre qu'à être vérifié : un appelant qui se trompe se
    -- fait refuser au lieu d'ouvrir une porte.
    'agent_annonce_coherent',
      p_agent is null or p_agent = v_catalog.agent,

    -- 2. Une règle d'autopilote active pour ce type d'action.
    'regle_active',
      v_rule.enabled,

    'type_dans_la_regle',
      v_rule.allowed_action_types is null
        or p_action_type = any (v_rule.allowed_action_types),

    -- 3. Le montant sous le plafond. `v_rule.maximum_amount_cents` est
    --    `not null` en base ; s'il n'y a pas de règle du tout, il vaut
    --    NULL ici et la comparaison rend NULL, donc refus.
    'montant_sous_plafond',
      (case when coalesce(v_catalog.carries_amount, true)
            then p_amount_cents is not null
            else true end)
      and coalesce(p_amount_cents, 0) >= 0
      and coalesce(p_amount_cents, 0) <= v_rule.maximum_amount_cents,

    -- 3 bis. LE RISQUE, ET LE SEUIL QUI LE RELÈVE (p. 15-16).
    --
    --   • une action dont le catalogue dit `high` ou `critical` exige
    --     une confirmation humaine : elle ne part jamais seule ;
    --   • une action qui engage 20 000 € ou plus DEVIENT `high`, quel
    --     que soit son niveau au catalogue. C'est le calcul que la
    --     fonction Edge faisait déjà — mais qu'elle n'utilisait que
    --     comme étiquette.
    --
    -- Un niveau de risque illisible vaut `critical`, donc refus : c'est
    -- le même défaut fermé que partout ailleurs dans cette phase.
    'risque_confirmable',
      coalesce(v_catalog.default_risk_level, 'critical') not in ('high', 'critical')
      and (
        not coalesce(v_catalog.carries_amount, true)
        or coalesce(p_amount_cents, -1) < public.ai_seuil_risque_eleve_cents()
      ),

    -- Les listes blanches de cibles. NON RENSEIGNÉES, elles ne
    -- restreignent rien ; RENSEIGNÉES, elles exigent une cible qu'on
    -- puisse y retrouver — une action sans cible échoue alors, et
    -- c'est voulu : cette itération ne sait pas remonter d'un devis à
    -- son client, et une liste blanche qu'on ne sait pas vérifier doit
    -- fermer.
    'cible_autorisee',
      (v_rule.allowed_clients is null
        or (p_target_entity_type = 'customer'
            and p_target_entity_id = any (v_rule.allowed_clients)))
      and (v_rule.allowed_suppliers is null
        or (p_target_entity_type = 'supplier'
            and p_target_entity_id = any (v_rule.allowed_suppliers))),

    -- Une cible d'une autre entreprise ferme, comme le déclencheur
    -- d'insertion. Sans cette ligne, une liste blanche renseignée avec
    -- l'identifiant d'un client du voisin — que rien en base
    -- n'interdit d'écrire — autorisait l'autopilote sur cette cible.
    'cible_meme_organisation',
      p_target_entity_id is null or v_cible_org = p_organization_id,

    'heure_autorisee',
      v_rule.allowed_hours is null or v_rule.allowed_hours @> v_hour,

    -- 4. Le droit de l'utilisateur, celui que le CATALOGUE désigne —
    --    pas un droit choisi par l'appelant.
    'droit_utilisateur',
      v_catalog.required_permission is not null
      and public.has_permission(p_organization_id, v_catalog.required_permission)
  );

  if (select count(*) from jsonb_object_keys(v_checks)) <> c_conditions then
    return false;
  end if;

  -- « Aucune fausse », et non « ces douze-là sont vraies ». Un `null`
  -- JSON n'est pas `true` : il tombe donc du côté du refus.
  return not exists (
    select 1 from jsonb_each(v_checks) e where e.value <> to_jsonb(true)
  );

exception when others then
  -- LE REFUS EST LA BONNE RÉPONSE, LE SILENCE NON. Sans cette trace, un
  -- vrai bug ici se lirait « l'autopilote ne part jamais » et personne
  -- ne saurait pourquoi. `raise warning` n'interrompt rien et n'annule
  -- aucune transaction.
  raise warning 'ai_may_autoexecute a échoué (org=%, action=%) : %',
    p_organization_id, p_action_type, sqlerrm;
  return false;
end;
$$;

comment on function public.ai_may_autoexecute(uuid, text, text, bigint, text, uuid) is
  'Treize conditions, toutes vraies, pour qu''une action parte sans clic humain. La treizième — ajoutée en 0076 — refuse tout risque « high » ou « critical » et tout montant au-delà du seuil de la page 15-16, quelle que soit la surface appelante.';

-- ============================================================
-- 7. CE QUE CE FICHIER NE TOUCHE PAS, ET POURQUOI C'EST ÉCRIT ICI
-- ============================================================
--
-- `ai_agent_settings` (autonomie de chaque agent, 0 observe → 4
-- autopilote) et `ai_autopilot_rules` (plafonds d'engagement, listes
-- blanches, plages horaires) GARDENT leurs politiques de 0072 :
-- « Members read » et « Managers write » avec
-- `organization.manageUsers`. Ces réglages engagent les données et le
-- travail du client, pas la facture de l'éditeur ; un chantier de
-- gouvernance des coûts n'a aucune raison de les emporter au passage,
-- et le test le vérifie explicitement dans les deux sens — le client
-- peut toujours, l'administrateur de plateforme ne peut toujours pas.
--
-- UNE NUANCE, POUR QUE CE PARAGRAPHE NE MENTE PAS : le § 6.c déploie
-- enfin la treizième condition d'`ai_may_autoexecute`, absente de la
-- production. QUI règle l'autopilote ne change donc pas — c'est
-- toujours le client, avec les mêmes politiques — mais CE QUE
-- l'autopilote s'autorise se resserre : une action de risque élevé, ou
-- qui engage 20 000 € ou plus, exigera désormais une confirmation
-- humaine chez lui. C'est la règle de la page 15-16, écrite en 0076 et
-- jamais arrivée en base ; le sens est fermant, jamais l'inverse.
--
-- Ne sont pas non plus traités ici, faute d'écran et de décision :
--   • la grille tarifaire des jetons, aujourd'hui en variables
--     d'environnement du serveur de l'éditeur ;
--   • le quota mensuel de requêtes d'assistant, constante TypeScript
--     (500) que ni l'éditeur ni le client ne peut changer sans
--     déploiement ;
--   • la vue des coûts de TOUTES les organisations. Sa donnée existe
--     pourtant : `ai_usage_events` porte `input_tokens`,
--     `output_tokens`, `model`, `duration_ms` et
--     `estimated_cost_cents` depuis 0076, alors que la carte « Coût de
--     l'IA » du tableau de bord administrateur rend toujours INCONNU
--     avec le motif « aucune table du projet n'enregistre de tokens, de
--     modèle, de latence ni de coût » (0075, recopié en 0077). Ce motif
--     est factuellement périmé ; le corriger demande de toucher
--     `admin_platform_kpis()`, ce que ce fichier ne fait pas — la carte
--     dirait alors un chiffre que personne n'a encore décidé
--     d'interpréter (coût d'achat de l'éditeur, moyenne par
--     organisation, sur quelle fenêtre).
--
-- Enfin, une fuite RESTE OUVERTE et n'est pas de ce ressort : un simple
-- ouvrier (`fieldWorker`) lit l'identifiant du modèle de son entreprise
-- par PostgREST, alors que la spec p.27 veut que l'utilisateur final ne
-- voie pas le nom du modèle. La refermer demande une fonction
-- `security definer` dédiée au runtime (sur le modèle
-- d'`ai_cache_lookup`), et surtout PAS le retrait de la politique de
-- lecture : ce retrait annulerait silencieusement la surcharge imposée
-- par l'éditeur. C'est un chantier à part entière, avec le moteur en
-- face.
