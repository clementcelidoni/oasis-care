-- Oasis Care — Phase 11V, LE SOCLE D'OASIS EXECUTIVE AI.
--
-- À exécuter après 0070. Idempotente et purement additive.
-- (0071 est réservée à un autre chantier en cours.)
--
-- CE QUE CE FICHIER EST. La Phase 11V veut qu'Oasis cesse d'enregistrer
-- pour se mettre à DÉCIDER : surveiller, détecter, prioriser,
-- recommander, préparer, demander confirmation, exécuter, mesurer,
-- apprendre. Neuf briques seulement dans la première itération
-- (spec p. 49) : registre d'outils, Decision Center, Executive /
-- Finance / Billing / Quote-Pricing Agents, Action Engine, Approval
-- Engine, Oasis Daily. Ce fichier pose ce qui, de ces neuf briques,
-- vit en base : les tables, les garde-fous, et les six fonctions par
-- lesquelles tout passe. Les agents eux-mêmes, l'aiguilleur et les
-- écrans viennent après, et par-dessus.
--
-- CE QUE CE FICHIER N'EST PAS. Il ne construit ni Sales, ni Operations,
-- ni Planning, ni Procurement, ni Nursery, ni Fleet, ni Customer, ni
-- Market, ni Risk — la spec l'interdit tant que les neuf premières ne
-- tournent pas. Aucune esquisse, donc : `ai_is_supported_agent` ne
-- connaît que quatre agents, et une ligne qui en nommerait un
-- cinquième est refusée par contrainte, pas par convention.
--
-- IL N'Y A PAS DE DÉCLENCHEURS SQL SUR LES TABLES MÉTIER. `business_events`
-- existe et sa fonction d'émission aussi ; ce qui appellera cette
-- fonction est un balayage périodique, écrit ailleurs. Poser aujourd'hui
-- un déclencheur sur `invoices` ou `projects` reviendrait à faire
-- dépendre la facturation du bon fonctionnement de l'IA — l'inverse de
-- ce qu'on veut.
--
-- ============================================================
-- LES CINQ RÈGLES QUE CHAQUE LIGNE DE CE FICHIER TIENT
-- ============================================================
--
--   1. L'ORGANISATION VIENT DE LA SESSION. Aucune fonction d'écriture
--      ne laisse le modèle nommer l'entreprise qu'il vise :
--      `ai_open_decision` la reçoit de l'aiguilleur, et les fonctions
--      qui travaillent sur une ligne existante (`ai_answer_decision`,
--      `ai_request_approval`, `ai_answer_approval`) la RELISENT sur la
--      ligne au lieu de la prendre en paramètre. On ne peut pas se
--      tromper d'entreprise sur un paramètre qui n'existe pas.
--
--   2. UN AGENT AGIT AVEC LES PERMISSIONS DE L'UTILISATEUR. Tout est en
--      `security invoker`, sauf trois fonctions dont le rôle est
--      justement de voir ce que la RLS masque, et qui le justifient sur
--      place. Aucun agent n'a de droit propre.
--
--   3. UNE DONNÉE ABSENTE RESTE ABSENTE. `financial_impact_cents` est
--      NULLABLE, `before_value` et `after_value` aussi, et les cibles
--      de `organization_kpi_targets` également. « Impact inconnu » et
--      « impact nul » sont deux choses différentes ; ce projet a déjà
--      corrigé deux fois la confusion (0059 sur l'efficacité, 0067 sur
--      les compteurs). Mieux : une décision annoncée
--      `insufficient_data` NE PEUT PAS porter de montant, et la
--      contrainte le dit.
--
--   4. LE CLOISONNEMENT SE VÉRIFIE AUX DEUX BOUTS. Chaque table porte
--      `organization_id` et sa RLS. Les liens internes passent par des
--      clés composites `(id, organization_id)`, et la cible d'une
--      action — qui n'a pas de clé étrangère puisqu'elle est
--      polymorphe — est relue par un déclencheur qui compare son
--      organisation réelle à celle de l'action.
--
--   5. LE DOUTE VAUT REFUS. `ai_may_autoexecute` est écrite pour rendre
--      FAUX chaque fois qu'elle n'est pas certaine, y compris sur une
--      erreur imprévue. C'est la seule fonction du produit qui décide
--      qu'une opération peut partir sans personne.

-- ============================================================
-- 1. Le vocabulaire commun
-- ============================================================
-- Trois énumérations reviennent partout. Les écrire en fonctions
-- immuables plutôt qu'en `check (x in (...))` recopié six fois : le
-- jour où la deuxième itération ouvre SalesAgent, il y a UN endroit à
-- changer, et aucune table n'est oubliée en route.
--
-- Élargir la liste ne casse aucune ligne existante ; la rétrécir en
-- casserait, et c'est très bien ainsi.

/**
 * Les agents que cette itération connaît. Pas un de plus.
 *
 * La spec en énumère treize et impose de n'en construire que quatre.
 * Cette fonction est l'endroit où cette contrainte est mécanique :
 * `ai_agent_settings` ne peut pas recevoir un réglage pour
 * « procurement », donc `ai_may_autoexecute` ne peut pas le trouver au
 * niveau 4, donc aucun agent hors périmètre ne peut agir seul — même
 * si quelqu'un enregistre par erreur une action à son nom.
 */
create or replace function public.ai_is_supported_agent(p_agent text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_agent in ('executive', 'finance', 'billing', 'quote_pricing');
$$;

create or replace function public.ai_is_risk_level(p_risk text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_risk in ('low', 'medium', 'high', 'critical');
$$;

-- ============================================================
-- 2. AI TOOL REGISTRY — le catalogue des actions
-- ============================================================
-- Brique n° 1 de la première itération.
--
-- POURQUOI UNE TABLE ET PAS UNE CONSTANTE DANS LE CODE. Trois
-- questions doivent recevoir la même réponse à trois endroits
-- différents : l'aiguilleur qui propose, la Server Action qui exécute,
-- et `ai_may_autoexecute` qui décide de se passer d'humain. Ces trois
-- endroits sont dans deux langages et deux processus. Une constante
-- TypeScript ne serait pas visible depuis SQL, et `ai_may_autoexecute`
-- devrait recevoir en paramètre la permission requise par l'action —
-- c'est-à-dire la laisser choisir le droit qu'on lui opposera. Le
-- catalogue coupe court : la permission d'une action n'est pas un
-- argument, c'est une donnée.
--
-- CETTE TABLE N'A PAS D'ORGANISATION, et c'est délibéré : « créer un
-- brouillon de facture » ne dépend pas de l'entreprise. Ce qui en
-- dépend — plafond, activation — est dans `ai_autopilot_rules`, qui
-- porte bien une organisation. La RLS ici n'existe donc que pour
-- ouvrir la lecture et fermer l'écriture.

create table if not exists public.ai_action_catalog (
  action_type text primary key,

  -- L'agent PROPRIÉTAIRE de l'action, en texte libre et non contraint
  -- à `ai_is_supported_agent`. Le catalogue doit pouvoir nommer
  -- « procurement » pour DÉCLARER que l'envoi d'une commande
  -- fournisseur existe et qu'il est interdit d'autopilote — sans que
  -- cela crée l'agent. Déclarer un interdit n'est pas construire ce
  -- qu'il interdit.
  agent text not null,

  label text not null,
  description text,

  -- Le risque par défaut de la spec p. 9 : brouillon de facture
  -- « medium », envoi de facture « high », commande de 20 000 €
  -- « critical ». Une action peut être requalifiée à la hausse au cas
  -- par cas dans `ai_actions.risk_level` ; le catalogue donne le plancher.
  default_risk_level text not null default 'high'
    check (public.ai_is_risk_level(default_risk_level)),

  -- LE DROIT DE L'UTILISATEUR, pas celui de l'agent (spec p. 30 :
  -- « Si utilisateur ne possède pas invoices.create, BillingAgent ne
  -- peut pas créer une facture »). C'est ce que `ai_may_autoexecute`
  -- oppose à `has_permission`, et ce que la Server Action de
  -- confirmation oppose à `ai_guard`.
  required_permission text not null,

  -- Une écriture, ou une simple observation ? Une alerte de stock
  -- faible ne modifie rien : elle mérite un droit de lecture, pas un
  -- droit d'écriture.
  is_write boolean not null default true,

  -- L'ACTION ENGAGE-T-ELLE DE L'ARGENT ? La question n'est pas
  -- cosmétique : c'est elle qui empêche de contourner le plafond
  -- d'autopilote en omettant simplement le montant. Voir
  -- `ai_may_autoexecute`.
  carries_amount boolean not null default false,

  -- Cette action peut-elle un jour partir sans humain ?
  --
  -- La spec p. 35-36 met trois automatismes à ON (relance de devis,
  -- brouillons de factures en fin de chantier, alerte de stock faible)
  -- et trois à OFF (envoi de factures, commandes fournisseurs,
  -- modification de tarifs). Les trois derniers ne sont pas « OFF pour
  -- l'instant » : ce sont exactement les trois interdits des PRINCIPES
  -- ABSOLUS (p. 2), et l'autopilote est par définition l'absence de
  -- validation. Ils sont donc INÉLIGIBLES, et un déclencheur refuse de
  -- les activer — pas seulement de les créer activés.
  --
  -- Une itération future qui voudrait les ouvrir devra le faire ici,
  -- explicitement, en connaissance de cause. C'est le but.
  autopilot_eligible boolean not null default false,

  -- Créé activé chez une nouvelle entreprise. Ne peut l'être que si
  -- l'action est éligible : la contrainte interdit la combinaison
  -- « allumé par défaut mais interdit d'allumage ».
  autopilot_default_on boolean not null default false,

  created_at timestamptz not null default now(),

  constraint ai_action_catalog_default_on_needs_eligible
    check (not autopilot_default_on or autopilot_eligible)
);

comment on table public.ai_action_catalog is
  'Registre des actions que les agents savent proposer : risque, droit exigé, éligibilité à l''autopilote.';

-- Le catalogue de la PREMIÈRE ITÉRATION. Les trois lignes inéligibles
-- ne sont pas des agents en construction : ce sont des verrous.
--
-- `on conflict do update` sur les colonnes de définition — le catalogue
-- est une donnée de référence, pas un réglage d'entreprise : rejouer la
-- migration doit rétablir la définition officielle, y compris et
-- surtout `autopilot_eligible = false`.
insert into public.ai_action_catalog (
  action_type, agent, label, description, default_risk_level,
  required_permission, is_write, carries_amount, autopilot_eligible, autopilot_default_on
) values
  ('createInvoiceDraft', 'billing',
   'Créer un brouillon de facture',
   'Prépare une facture non émise à partir d''un chantier terminé. Rien n''est numéroté ni envoyé.',
   'medium', 'invoice.create', true, true, true, true),

  ('issueInvoice', 'billing',
   'Émettre une facture',
   'Attribue le numéro de séquence légale. Irréversible : une facture émise s''annule par avoir.',
   'high', 'invoice.create', true, true, false, false),

  ('sendInvoice', 'billing',
   'Envoyer une facture au client',
   'Transmet la facture au client. Interdit d''autopilote (PRINCIPES ABSOLUS p. 2).',
   'high', 'invoice.create', true, true, false, false),

  ('quoteFollowUp', 'quote_pricing',
   'Relancer un devis sans réponse',
   'Rappelle au client un devis envoyé et resté sans réponse.',
   'low', 'quotes.edit', true, false, true, true),

  ('createQuoteDraft', 'quote_pricing',
   'Créer un brouillon de devis',
   'Prépare un devis non envoyé. Un brouillon se relit avant l''envoi.',
   'medium', 'quotes.create', true, true, false, false),

  ('adjustQuotePricing', 'quote_pricing',
   'Proposer un ajustement de prix sur un devis',
   'Modifie les prix d''un devis en brouillon. Ne touche à aucune grille tarifaire.',
   'medium', 'quotes.edit', true, true, false, false),

  ('lowStockAlert', 'executive',
   'Alerter sur un stock faible',
   'Ouvre une décision quand un article passe sous son seuil. N''écrit rien dans le stock.',
   'low', 'projects.read', false, false, true, true),

  ('purchaseOrderSend', 'procurement',
   'Envoyer une commande fournisseur',
   'Engage l''achat. Interdit d''autopilote (PRINCIPES ABSOLUS p. 2). Agent hors périmètre de cette itération.',
   'critical', 'projects.manage', true, true, false, false),

  ('priceBookUpdate', 'quote_pricing',
   'Modifier une grille tarifaire',
   'Un prix de grille se recopie seul dans tous les devis suivants. Interdit d''autopilote (PRINCIPES ABSOLUS p. 2).',
   'critical', 'quotes.edit', true, true, false, false)
on conflict (action_type) do update set
  agent                = excluded.agent,
  label                = excluded.label,
  description          = excluded.description,
  default_risk_level   = excluded.default_risk_level,
  required_permission  = excluded.required_permission,
  is_write             = excluded.is_write,
  carries_amount       = excluded.carries_amount,
  autopilot_eligible   = excluded.autopilot_eligible,
  autopilot_default_on = excluded.autopilot_default_on;

-- ============================================================
-- 3. Le réglage d'autonomie, par agent et par entreprise
-- ============================================================
-- Spec p. 7. Cinq niveaux, et le défaut est 1.
--
-- POURQUOI 1 ET JAMAIS 4. Le niveau 4 est le seul où personne ne
-- regarde. Un défaut à 4 signifierait qu'une entreprise qui n'a jamais
-- ouvert l'écran des automatisations laisse une machine agir en son
-- nom. Le défaut de ce produit est donc « recommande » : l'IA parle,
-- l'humain décide, et il faut un geste délibéré pour changer cela.

create table if not exists public.ai_agent_settings (
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  agent text not null check (public.ai_is_supported_agent(agent)),

  enabled boolean not null default true,

  -- 0 observe · 1 advise · 2 prepare · 3 confirm_to_execute
  -- 4 authorized_autopilot
  autonomy_level smallint not null default 1
    check (autonomy_level between 0 and 4),

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  primary key (organization_id, agent)
);

comment on column public.ai_agent_settings.autonomy_level is
  '0 observe, 1 advise (défaut), 2 prepare, 3 confirm_to_execute, 4 authorized_autopilot.';

-- ============================================================
-- 4. AUTOPILOT CENTER — les règles et leurs limites
-- ============================================================
-- Spec p. 35-36. Un réglage par type d'action et par entreprise, avec
-- les cinq limites : montant maximal, types autorisés, fournisseurs
-- autorisés, clients autorisés, heures autorisées.

create table if not exists public.ai_autopilot_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  action_type text not null
    references public.ai_action_catalog (action_type),

  enabled boolean not null default false,

  -- LE PLAFOND EST `not null` ET SON DÉFAUT EST ZÉRO. Un plafond
  -- absent voudrait dire « pas de limite », ce qui est exactement le
  -- réglage qu'on ne veut pas obtenir par oubli. Zéro n'est pas non
  -- plus un oubli : c'est « aucun engagement financier automatique »,
  -- et l'entreprise le relève elle-même, sciemment, dans l'écran des
  -- automatisations.
  maximum_amount_cents bigint not null default 0
    check (maximum_amount_cents >= 0),

  -- Restriction supplémentaire, au-delà du type de la règle elle-même.
  -- NULL = pas de restriction ; un tableau = liste blanche.
  allowed_action_types text[],

  -- NULL = pas de restriction. Un tableau NON NULL restreint, et
  -- `ai_may_autoexecute` refuse alors tout ce qu'elle ne peut pas
  -- rattacher explicitement à cette liste — y compris une action sans
  -- cible. Une liste blanche qu'on ne sait pas vérifier doit fermer,
  -- pas s'effacer.
  allowed_suppliers uuid[],
  allowed_clients uuid[],

  -- Plage horaire de Paris (bornes en heures pleines, 0-24). NULL =
  -- à toute heure. Le fuseau est celui du reste du produit (0066) :
  -- `current_date` en UTC déplacerait la fenêtre deux heures par nuit
  -- l'été, sans que rien ne soit cassé.
  allowed_hours int4range,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  unique (organization_id, action_type)
);

/**
 * Le verrou des trois automatismes que la spec veut à OFF.
 *
 * Les créer désactivés ne suffirait pas : « à OFF » et « à OFF jusqu'à
 * ce que quelqu'un clique » ne sont pas la même promesse. Envoyer une
 * facture, passer une commande, changer un tarif sont trois des
 * interdits de la page 2, et l'autopilote est précisément le mode sans
 * validation. Tant que le catalogue ne les déclare pas éligibles,
 * aucune ligne ne peut les activer — ni un écran, ni une Server
 * Action, ni un `update` direct dans la console.
 */
create or replace function public.ai_autopilot_rules_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_eligible boolean;
  v_label text;
begin
  if not new.enabled then
    return new;
  end if;

  select autopilot_eligible, label into v_eligible, v_label
  from public.ai_action_catalog where action_type = new.action_type;

  -- `is not true` et non `= false` : un catalogue muet (action inconnue)
  -- doit fermer, pas passer.
  if v_eligible is not true then
    raise exception
      'L''action « % » ne peut pas être mise en autopilote : elle exige une validation humaine.',
      coalesce(v_label, new.action_type);
  end if;

  return new;
end;
$$;

drop trigger if exists ai_autopilot_rules_guard_trg on public.ai_autopilot_rules;
create trigger ai_autopilot_rules_guard_trg
  before insert or update on public.ai_autopilot_rules
  for each row execute function public.ai_autopilot_rules_guard();

-- ============================================================
-- 5. DECISION CENTER
-- ============================================================
-- Spec p. 5-6. Brique n° 2.

create table if not exists public.ai_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  title text not null,
  description text,

  agent text not null check (public.ai_is_supported_agent(agent)),

  category text not null check (category in (
    'urgent',        -- ça saigne maintenant
    'important',     -- ça saignera bientôt
    'opportunite',   -- de l'argent à prendre
    'optimisation',  -- de l'argent à ne plus perdre
    'information'    -- rien à faire, mais bon à savoir
  )),

  -- 0 à 100, le plus grand d'abord. Ce n'est pas un rang : deux
  -- décisions peuvent se valoir, et l'écran départage sur la date.
  priority int not null default 50 check (priority between 0 and 100),

  -- L'impact en clair, tel qu'on le montre : « 10 chantiers terminés,
  -- 38 450 € HT prêts à facturer ». C'est du texte parce que tous les
  -- impacts ne sont pas des euros.
  estimated_impact text,

  -- NULLABLE, ET C'EST LE POINT LE PLUS IMPORTANT DE CETTE TABLE.
  --
  -- « On ne sait pas chiffrer » et « ça ne vaut rien » sont deux
  -- phrases opposées, et une colonne `not null default 0` les rend
  -- indiscernables. L'écran trierait alors les recommandations
  -- inchiffrables tout en bas, à côté des inutiles. Ce produit a déjà
  -- payé cette confusion deux fois : 0059 (une efficacité de 0 %
  -- voulait dire « aucune estimation ») et 0067 (un compteur jamais
  -- relevé n'est pas un compteur à zéro).
  financial_impact_cents bigint,

  confidence text not null check (confidence in (
    'high', 'medium', 'low',
    'insufficient_data'   -- spec p. 33 : « insufficientData »
  )),

  -- Les données réellement lues pour conclure (spec p. 6 : « Données
  -- utilisées »). Un tableau d'objets `{table, ids, periode, …}` :
  -- c'est ce qui rend une recommandation vérifiable par un humain.
  data_sources jsonb not null default '[]'::jsonb,

  reasoning_summary text,
  recommended_action text,

  -- Les boutons proposés : `[{actionType, label, parameters}]`. Un
  -- `actionType` doit exister au catalogue — vérifié à l'ouverture par
  -- `ai_open_decision`, pas ici : une contrainte de table ne sait pas
  -- fouiller un jsonb sans devenir illisible.
  available_actions jsonb not null default '[]'::jsonb,

  status text not null default 'new' check (status in (
    'new', 'reviewed', 'accepted', 'rejected', 'snoozed', 'executed', 'completed'
  )),
  snoozed_until timestamptz,

  -- Empêche le balayage périodique de rouvrir chaque nuit la même
  -- décision. Voir l'index unique partiel plus bas.
  dedupe_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_decisions_snoozed_needs_date
    check (status <> 'snoozed' or snoozed_until is not null),

  -- L'INTERDIT DE LA SPEC, ÉCRIT EN CONTRAINTE. Une conclusion tirée
  -- de données insuffisantes ne peut pas porter de montant : le
  -- montant serait une estimation déguisée, et la spec l'interdit
  -- nommément (p. 2, « ne jamais inventer un coût »). Si on ne sait
  -- pas, on le dit ; on ne le chiffre pas quand même.
  constraint ai_decisions_no_amount_without_data
    check (confidence <> 'insufficient_data' or financial_impact_cents is null)
);

-- Requise par la clé étrangère composite d'`ai_actions` : c'est elle
-- qui interdit de rattacher une action à la décision d'une autre
-- entreprise.
create unique index if not exists ai_decisions_id_org_uidx
  on public.ai_decisions (id, organization_id);

create index if not exists ai_decisions_board_idx
  on public.ai_decisions (organization_id, status, priority desc, created_at desc);

-- Partiel sur les statuts VIVANTS : une décision close puis
-- re-détectée trois mois plus tard doit pouvoir se rouvrir.
create unique index if not exists ai_decisions_dedupe_uidx
  on public.ai_decisions (organization_id, dedupe_key)
  where dedupe_key is not null and status in ('new', 'reviewed', 'snoozed');

-- ============================================================
-- 6. ACTION ENGINE
-- ============================================================
-- Spec p. 8-9. Brique n° 7.

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  action_type text not null references public.ai_action_catalog (action_type),
  agent text not null check (public.ai_is_supported_agent(agent)),

  decision_id uuid,

  -- Cible polymorphe : pas de clé étrangère possible, donc un
  -- déclencheur (section 6 bis) relit l'organisation réelle de
  -- l'entité et la compare à celle de l'action.
  target_entity_type text,
  target_entity_id uuid,

  parameters jsonb not null default '{}'::jsonb,

  risk_level text not null check (public.ai_is_risk_level(risk_level)),

  -- `default true`, et non `default false`. Le défaut d'une colonne est
  -- ce qu'on obtient quand on l'oublie ; ici, l'oubli doit produire
  -- « il faut confirmer ».
  requires_confirmation boolean not null default true,

  created_by_ai boolean not null default true,

  status text not null default 'proposed' check (status in (
    'proposed',           -- l'agent propose, rien n'est parti
    'awaiting_approval',  -- une demande d'approbation court
    'approved',           -- un humain a dit oui, l'exécution peut partir
    'rejected',           -- un humain a dit non
    'executing',
    'executed',
    'failed',
    'cancelled',
    'expired'             -- l'approbation a expiré sans réponse
  )),

  result jsonb,
  executed_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Une action n'est « exécutée » qu'avec une date, et une date
  -- d'exécution n'a pas de sens sans exécution.
  constraint ai_actions_executed_needs_date
    check ((status = 'executed') = (executed_at is not null)),

  -- LES DEUX BOUTS DE LA LIGNE. La décision doit appartenir à la même
  -- organisation que l'action ; sans cette clé composite, la RLS
  -- laisserait passer une action écrite chez B qui pointe la décision
  -- de A — le défaut réparé par 0062 ailleurs dans le produit.
  constraint ai_actions_decision_same_org
    foreign key (decision_id, organization_id)
    references public.ai_decisions (id, organization_id) on delete cascade
);

create unique index if not exists ai_actions_id_org_uidx
  on public.ai_actions (id, organization_id);

create index if not exists ai_actions_org_idx
  on public.ai_actions (organization_id, status, created_at desc);

create index if not exists ai_actions_decision_idx
  on public.ai_actions (decision_id);

-- ------------------------------------------------------------
-- 6 bis. La cible d'une action appartient à l'organisation
-- ------------------------------------------------------------

/**
 * L'organisation réelle d'une entité, quel que soit son type.
 *
 * `security definer` — LE POINT DÉLICAT. En `invoker`, la RLS
 * masquerait la ligne de l'autre entreprise et la fonction rendrait
 * NULL ; on ne saurait alors pas distinguer « cette entité n'existe
 * pas » de « cette entité est chez le voisin », et le déclencheur
 * devrait refuser les deux avec le même message — ou, pire, laisser
 * passer. Ici, elle voit la vérité et le déclencheur peut la nommer.
 *
 * Elle ne divulgue rien : elle ne rend qu'un UUID d'organisation à un
 * appelant qui a déjà fourni l'identifiant exact de la ligne, et son
 * seul usage est de REFUSER.
 *
 * La liste des types est blanche et fermée : un type inconnu rend
 * NULL, et le déclencheur refuse.
 */
create or replace function public.ai_entity_organization(
  p_entity_type text,
  p_entity_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_table text;
  v_org uuid;
begin
  if p_entity_type is null or p_entity_id is null then
    return null;
  end if;

  v_table := case p_entity_type
    when 'customer'        then 'crm_customers'
    when 'project'         then 'projects'
    when 'quote'           then 'quotes'
    when 'invoice'         then 'invoices'
    when 'supplier'        then 'suppliers'
    when 'purchase_order'  then 'purchase_orders'
    when 'nursery_lot'     then 'nursery_lots'
    when 'equipment'       then 'equipment'
    when 'price_book_item' then 'price_book_items'
  end;

  if v_table is null then
    return null;
  end if;

  execute format('select organization_id from public.%I where id = $1', v_table)
    into v_org using p_entity_id;

  return v_org;
end;
$$;

create or replace function public.ai_actions_check_target()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
begin
  if new.target_entity_type is null and new.target_entity_id is null then
    return new;   -- une action peut viser l'entreprise entière
  end if;

  if new.target_entity_type is null or new.target_entity_id is null then
    raise exception 'Cible incomplète : il faut un type d''entité ET un identifiant.';
  end if;

  v_org := public.ai_entity_organization(new.target_entity_type, new.target_entity_id);

  if v_org is null then
    raise exception 'Cible introuvable : « % » n''existe pas, ou son type n''est pas une cible connue.',
      new.target_entity_type;
  end if;

  if v_org <> new.organization_id then
    raise exception 'Cible d''une autre organisation : action refusée.';
  end if;

  return new;
end;
$$;

drop trigger if exists ai_actions_check_target_trg on public.ai_actions;
create trigger ai_actions_check_target_trg
  before insert or update of target_entity_type, target_entity_id, organization_id
  on public.ai_actions
  for each row execute function public.ai_actions_check_target();

-- ============================================================
-- 7. APPROVAL ENGINE
-- ============================================================
-- Spec p. 31, `ActionApproval`. Brique n° 8.

create table if not exists public.ai_action_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  action_id uuid not null,

  requested_by_agent text not null check (public.ai_is_supported_agent(requested_by_agent)),

  -- À QUI la question est posée. Ce n'est pas forcément celui qui
  -- répondra : un propriétaire peut trancher à la place d'un chef
  -- d'équipe absent. Ce qui est exigé pour répondre, c'est la
  -- permission de l'action — voir `ai_answer_approval`.
  requested_for_user uuid not null references auth.users (id) on delete cascade,

  risk text not null check (public.ai_is_risk_level(risk)),

  -- UNE DEMANDE EXPIRE. « Créer dix factures pour 38 450 € » validé
  -- trois jours après avoir été posé porte sur des chantiers qui ont
  -- peut-être bougé, des acomptes qui sont peut-être tombés. Le oui
  -- répond alors à une question qui n'existe plus.
  expires_at timestamptz not null,

  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'expired', 'cancelled'
  )),
  responded_at timestamptz,
  responded_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),

  constraint ai_action_approvals_action_same_org
    foreign key (action_id, organization_id)
    references public.ai_actions (id, organization_id) on delete cascade,

  -- Répondu ⇔ daté. Sans cela, un `update` maladroit laisse une
  -- approbation « approved » sans savoir quand ni par qui.
  constraint ai_action_approvals_answered_is_dated
    check ((status in ('pending', 'cancelled')) or responded_at is not null)
);

-- Une seule question en attente par action : deux demandes
-- concurrentes, c'est deux « oui » possibles pour une seule opération.
create unique index if not exists ai_action_approvals_one_pending_uidx
  on public.ai_action_approvals (action_id)
  where status = 'pending';

create index if not exists ai_action_approvals_inbox_idx
  on public.ai_action_approvals (organization_id, status, expires_at);

-- ============================================================
-- 8. APPRENTISSAGE DES DÉCISIONS
-- ============================================================
-- Spec p. 34 : « augmenter prix plantation +5 % → marge +3,4 pts,
-- conversion −0,8 pt ».

create table if not exists public.ai_decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  decision_id uuid not null,

  -- La recommandation avait-elle été suivie ? Un refus mesuré vaut un
  -- accord mesuré : c'est même le seul moyen de savoir qu'une
  -- recommandation était mauvaise.
  accepted boolean not null,

  measured_at timestamptz not null default now(),

  -- « margin_points », « conversion_points », « dso_days »,
  -- « revenue_cents »… Texte libre : la liste des indicateurs
  -- mesurables grandira plus vite qu'une énumération.
  metric text not null,

  -- NULLABLES l'un et l'autre. Un « avant » qu'on n'a pas mesuré n'est
  -- pas un « avant » à zéro, et une variation calculée sur un zéro
  -- inventé est un mensonge chiffré.
  before_value numeric,
  after_value numeric,

  note text,
  created_at timestamptz not null default now(),

  constraint ai_decision_outcomes_decision_same_org
    foreign key (decision_id, organization_id)
    references public.ai_decisions (id, organization_id) on delete cascade
);

create index if not exists ai_decision_outcomes_decision_idx
  on public.ai_decision_outcomes (decision_id, measured_at desc);

-- ============================================================
-- 9. KPI TARGETS
-- ============================================================
-- Spec p. 44. Les cibles que l'Executive Agent oppose au réel.

create table if not exists public.organization_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  period_start date not null,
  period_end date not null,

  -- TOUTES NULLABLES. « Objectif de marge non défini » n'est pas
  -- « objectif de marge : 0 % » — le second ferait dire à l'IA que
  -- l'entreprise dépasse sa cible sur tous ses chantiers déficitaires.
  revenue_target_cents bigint check (revenue_target_cents is null or revenue_target_cents >= 0),
  margin_target_pct numeric(5, 2) check (margin_target_pct is null or margin_target_pct between -100 and 100),
  quote_conversion_target_pct numeric(5, 2) check (quote_conversion_target_pct is null or quote_conversion_target_pct between 0 and 100),
  cash_target_cents bigint,
  utilization_target_pct numeric(5, 2) check (utilization_target_pct is null or utilization_target_pct between 0 and 200),

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  unique (organization_id, period_start, period_end),

  constraint organization_kpi_targets_period_ordered
    check (period_end >= period_start),

  -- Une période sans aucune cible est du bruit : elle s'affiche dans
  -- l'écran, ne mesure rien, et laisse croire que des objectifs sont
  -- fixés.
  constraint organization_kpi_targets_not_empty
    check (num_nonnulls(revenue_target_cents, margin_target_pct,
                        quote_conversion_target_pct, cash_target_cents,
                        utilization_target_pct) > 0)
);

-- ============================================================
-- 10. COMPANY STRATEGY — les objectifs d'entreprise
-- ============================================================
-- Spec p. 44-45. L'Executive Agent adapte ses recommandations : la même
-- situation ne se recommande pas pareil selon qu'on veut du chiffre ou
-- de la marge.

create table if not exists public.business_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  goal text not null check (goal in (
    'increase_revenue',
    'increase_margin',
    'grow_maintenance_contracts',
    'reduce_travel',
    'grow_nursery',
    'reduce_inventory',
    'improve_cashflow'
  )),

  enabled boolean not null default false,

  -- Le plus petit d'abord — c'est un CLASSEMENT, pas un score. Deux
  -- objectifs peuvent se contredire (croître et réduire les stocks) :
  -- l'ordre dit lequel l'emporte.
  priority int not null default 100 check (priority >= 0),

  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  unique (organization_id, goal)
);

-- ============================================================
-- 11. BUSINESS EVENTS
-- ============================================================
-- Spec, ÉTAPE 4. Ce que le produit a vu se produire, et que les agents
-- n'ont pas encore traité.
--
-- ÉCRITE PAR FONCTION UNIQUEMENT, comme `audit_events` (0058) : aucune
-- politique d'insertion. Un événement forgé depuis le navigateur
-- déclencherait une analyse sur un fait qui n'a pas eu lieu, et
-- l'analyse, elle, serait sincère.

create table if not exists public.business_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  event_type text not null check (event_type in (
    'quote_accepted',
    'project_completed',
    'invoice_overdue',
    'stock_below_threshold',
    'purchase_received',
    'project_budget_exceeded',
    'vehicle_maintenance_added',
    'contract_expiring'
  )),

  entity_type text,
  entity_id uuid,

  payload jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now(),

  -- NULL = pas encore traité par les agents. C'est la file d'attente.
  processed_at timestamptz,

  -- Le balayage périodique repasse sur les mêmes lignes métier : sans
  -- clé de déduplication, la même facture en retard produirait un
  -- événement par passage.
  dedupe_key text,

  created_at timestamptz not null default now()
);

create index if not exists business_events_pending_idx
  on public.business_events (organization_id, occurred_at)
  where processed_at is null;

create unique index if not exists business_events_dedupe_uidx
  on public.business_events (organization_id, event_type, dedupe_key)
  where dedupe_key is not null;

-- ============================================================
-- 12. LES FONCTIONS
-- ============================================================

/**
 * Ouvrir une décision.
 *
 * `security invoker` : c'est l'utilisateur qui écrit, par la main de
 * l'agent. `ai_guard` avant tout le reste, comme les quinze fonctions
 * de 0069 — la RLS refuserait de toute façon, mais elle refuserait en
 * silence, zéro ligne insérée et aucune erreur, et l'agent annoncerait
 * « c'est noté » sur un néant.
 *
 * Les textes passent par `ai_clean_text` (0069) : ils viennent du
 * modèle, ils seront relus par le modèle au tour suivant, et une ligne
 * isolée qui ressemble à un en-tête d'instruction est exactement la
 * forme qu'un texte prend pour se faire passer pour une consigne.
 *
 * `p_financial_impact_cents` N'EST PAS `coalesce`-é. C'est le seul
 * paramètre de cette fonction dont l'absence a un sens, et le sens
 * n'est pas zéro.
 */
create or replace function public.ai_open_decision(
  p_organization_id uuid,
  p_agent text,
  p_category text,
  p_title text,
  p_confidence text default 'medium',
  p_description text default null,
  p_priority int default 50,
  p_estimated_impact text default null,
  p_financial_impact_cents bigint default null,
  p_data_sources jsonb default '[]'::jsonb,
  p_reasoning_summary text default null,
  p_recommended_action text default null,
  p_available_actions jsonb default '[]'::jsonb,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_title text;
  v_action text;
  v_unknown text;
begin
  perform public.ai_guard(p_organization_id, 'projects.manage');

  if not public.ai_is_supported_agent(p_agent) then
    raise exception 'Agent inconnu : « % ». Cette itération ne connaît qu''executive, finance, billing et quote_pricing.',
      coalesce(p_agent, 'néant');
  end if;

  if p_category is null or p_category not in
     ('urgent', 'important', 'opportunite', 'optimisation', 'information') then
    raise exception 'Catégorie inconnue : « % ». Attendu : urgent, important, opportunite, optimisation ou information.',
      coalesce(p_category, 'néant');
  end if;

  if p_confidence is null or p_confidence not in
     ('high', 'medium', 'low', 'insufficient_data') then
    raise exception 'Niveau de confiance inconnu : « % ». Attendu : high, medium, low ou insufficient_data.',
      coalesce(p_confidence, 'néant');
  end if;

  -- L'interdit de la page 2, dit avec des mots avant de l'être avec une
  -- contrainte. Un agent qui annonce « données insuffisantes » puis
  -- chiffre l'impact quand même a fabriqué le chiffre.
  if p_confidence = 'insufficient_data' and p_financial_impact_cents is not null then
    raise exception 'Confiance « insufficient_data » et impact chiffré sont contradictoires : un montant sans données est une estimation inventée.';
  end if;

  v_title := public.ai_clean_text(p_title, 200);
  if v_title is null then
    raise exception 'Une décision sans titre ne s''affiche nulle part.';
  end if;

  -- Chaque bouton proposé doit désigner une action que le produit sait
  -- faire. Un `actionType` fantaisiste produirait un bouton qui échoue
  -- au clic, ce qui est pire qu'un bouton absent.
  if jsonb_typeof(coalesce(p_available_actions, '[]'::jsonb)) <> 'array' then
    raise exception 'available_actions doit être un tableau.';
  end if;

  select string_agg(distinct a.value ->> 'actionType', ', ')
    into v_unknown
  from jsonb_array_elements(coalesce(p_available_actions, '[]'::jsonb)) a
  where a.value ->> 'actionType' is not null
    and not exists (
      select 1 from public.ai_action_catalog c
      where c.action_type = a.value ->> 'actionType'
    );

  if v_unknown is not null then
    raise exception 'Action proposée hors catalogue : %.', v_unknown;
  end if;

  insert into public.ai_decisions (
    organization_id, title, description, agent, category, priority,
    estimated_impact, financial_impact_cents, confidence, data_sources,
    reasoning_summary, recommended_action, available_actions, dedupe_key
  ) values (
    p_organization_id,
    v_title,
    public.ai_clean_text(p_description, 2000),
    p_agent,
    p_category,
    least(greatest(coalesce(p_priority, 50), 0), 100),
    public.ai_clean_text(p_estimated_impact, 300),
    p_financial_impact_cents,          -- surtout pas de `coalesce`
    p_confidence,
    coalesce(p_data_sources, '[]'::jsonb),
    public.ai_clean_text(p_reasoning_summary, 4000),
    public.ai_clean_text(p_recommended_action, 1000),
    coalesce(p_available_actions, '[]'::jsonb),
    public.ai_clean_text(p_dedupe_key, 200)
  )
  -- Le balayage rouvrirait sinon la même décision à chaque passage.
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Déjà ouverte : on rend l'existante plutôt qu'une erreur. Le
    -- balayage n'a rien fait de mal.
    select d.id into v_id
    from public.ai_decisions d
    where d.organization_id = p_organization_id
      and d.dedupe_key = public.ai_clean_text(p_dedupe_key, 200)
      and d.status in ('new', 'reviewed', 'snoozed')
    limit 1;
    return v_id;
  end if;

  perform public.ai_record_agent_event(
    p_organization_id, p_agent, 'aiDecisionOpened', 'ai_decision', v_id,
    coalesce(p_data_sources, '[]'::jsonb),
    jsonb_build_object('categorie', p_category, 'confiance', p_confidence,
                       'impactCents', p_financial_impact_cents),
    'none', null
  );

  return v_id;
end;
$$;

/**
 * Répondre à une décision : accepter, rejeter, reporter, classer.
 *
 * L'organisation n'est PAS un paramètre : elle est relue sur la ligne.
 * La RLS de `ai_decisions` garantit que la ligne d'une autre entreprise
 * reste invisible, donc introuvable, donc sans réponse possible.
 */
create or replace function public.ai_answer_decision(
  p_decision_id uuid,
  p_status text,
  p_snooze_until timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_before text;
  v_agent text;
begin
  if p_status is null or p_status not in
     ('reviewed', 'accepted', 'rejected', 'snoozed', 'executed', 'completed') then
    raise exception 'Statut de réponse inconnu : « % ». Attendu : reviewed, accepted, rejected, snoozed, executed ou completed.',
      coalesce(p_status, 'néant');
  end if;

  select organization_id, status, agent into v_org, v_before, v_agent
  from public.ai_decisions where id = p_decision_id;

  if v_org is null then
    raise exception 'Décision introuvable.';
  end if;

  perform public.ai_guard(v_org, 'projects.manage');

  if p_status = 'snoozed' then
    if p_snooze_until is null then
      raise exception 'Reporter une décision demande une date de réveil.';
    end if;
    if p_snooze_until <= now() then
      raise exception 'Une décision ne se reporte pas dans le passé.';
    end if;
  end if;

  update public.ai_decisions
     set status = p_status,
         -- On efface la date de réveil dès qu'on sort du report :
         -- laissée en place, elle ferait ressurgir la décision.
         snoozed_until = case when p_status = 'snoozed' then p_snooze_until else null end,
         updated_at = now()
   where id = p_decision_id;

  perform public.ai_record_agent_event(
    v_org, v_agent, 'aiDecisionAnswered', 'ai_decision', p_decision_id,
    null,
    jsonb_build_object('avant', v_before, 'apres', p_status, 'reveil', p_snooze_until),
    'human', null
  );
end;
$$;

/**
 * Demander l'approbation d'une action (spec p. 31).
 *
 * L'organisation vient de l'ACTION, jamais d'un paramètre. Le risque
 * aussi, par défaut : c'est le catalogue qui le fixe, pas l'appelant —
 * sinon un agent pressé demanderait une approbation « low » pour une
 * facture de 20 000 €.
 *
 * `p_expires_in` est BORNÉ. Une demande valable un mois n'est plus une
 * demande, c'est un chèque en blanc.
 */
create or replace function public.ai_request_approval(
  p_action_id uuid,
  p_risk text default null,
  p_expires_in interval default interval '24 hours'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action public.ai_actions;
  v_risk text;
  v_expires interval;
  v_id uuid;
begin
  select * into v_action from public.ai_actions where id = p_action_id;
  if v_action.id is null then
    raise exception 'Action introuvable.';
  end if;

  -- Le droit de conduire les travaux, qui est aussi celui qu'exige la
  -- RLS de la table. Le droit propre à l'ACTION (émettre une facture,
  -- changer un tarif) sera exigé, lui, au moment de RÉPONDRE : demander
  -- n'engage rien.
  perform public.ai_guard(v_action.organization_id, 'projects.manage');

  if v_action.status not in ('proposed', 'awaiting_approval') then
    raise exception 'Cette action n''attend plus d''approbation (statut « % »).', v_action.status;
  end if;

  v_risk := coalesce(p_risk, v_action.risk_level);
  if not public.ai_is_risk_level(v_risk) then
    raise exception 'Niveau de risque inconnu : « % ».', coalesce(v_risk, 'néant');
  end if;

  v_expires := coalesce(p_expires_in, interval '24 hours');
  if v_expires <= interval '0' then
    raise exception 'Une demande d''approbation déjà expirée ne sert à rien.';
  end if;
  if v_expires > interval '7 days' then
    raise exception 'Une demande d''approbation ne peut pas courir plus de sept jours.';
  end if;

  insert into public.ai_action_approvals (
    organization_id, action_id, requested_by_agent, requested_for_user,
    risk, expires_at
  ) values (
    v_action.organization_id, p_action_id, v_action.agent, auth.uid(),
    v_risk, now() + v_expires
  )
  returning id into v_id;

  update public.ai_actions
     set status = 'awaiting_approval', requires_confirmation = true, updated_at = now()
   where id = p_action_id;

  perform public.ai_record_agent_event(
    v_action.organization_id, v_action.agent, 'aiApprovalRequested',
    'ai_action', p_action_id, null,
    jsonb_build_object('risque', v_risk, 'expireLe', now() + v_expires),
    'requested', null
  );

  return v_id;
end;
$$;

/**
 * Répondre à une demande d'approbation.
 *
 * TROIS CHOSES QUI COMPTENT.
 *
 *   • L'EXPIRATION EST VÉRIFIÉE AVANT LE OUI, et une demande dépassée
 *     est marquée `expired` au passage plutôt que laissée `pending` :
 *     sinon elle réapparaît dans la boîte de réception et on retente.
 *
 *   • Le répondant doit détenir LA PERMISSION DE L'ACTION, pas
 *     seulement être le destinataire nommé. C'est l'application de
 *     « un agent agit avec les permissions de l'utilisateur » : le oui
 *     d'un utilisateur sans le droit ne vaut rien, quand bien même la
 *     demande lui était adressée.
 *
 *   • La ligne d'une autre entreprise est invisible (RLS, `security
 *     invoker`), donc introuvable, donc sans réponse possible.
 */
create or replace function public.ai_answer_approval(
  p_approval_id uuid,
  p_ok boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_approval public.ai_action_approvals;
  v_permission text;
  v_action_type text;
begin
  if p_ok is null then
    raise exception 'Répondre demande un oui ou un non.';
  end if;

  select * into v_approval from public.ai_action_approvals where id = p_approval_id;
  if v_approval.id is null then
    raise exception 'Demande d''approbation introuvable.';
  end if;

  if v_approval.status <> 'pending' then
    raise exception 'Cette demande a déjà reçu une réponse (« % »).', v_approval.status;
  end if;

  -- L'EXPIRATION, VÉRIFIÉE AVANT LE OUI.
  --
  -- Cette fonction NE MARQUE PAS la demande « expired » au passage, et
  -- ce n'est pas un oubli : `raise` annule la sous-transaction en
  -- cours, donc tout `update` écrit juste avant serait perdu, que
  -- l'appelant attrape l'exception ou non. Écrire puis lever, c'est
  -- écrire dans le vide — un piège classique de plpgsql, et un test
  -- vert sur une base inchangée. Le ménage est le travail de
  -- `ai_expire_stale_approvals`, qui, elle, ne lève rien.
  if v_approval.expires_at <= now() then
    raise exception 'Demande expirée le % : elle ne peut plus être validée. Relancez l''analyse.',
      to_char(v_approval.expires_at at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI');
  end if;

  select a.action_type, c.required_permission
    into v_action_type, v_permission
  from public.ai_actions a
  join public.ai_action_catalog c on c.action_type = a.action_type
  where a.id = v_approval.action_id;

  if v_permission is null then
    raise exception 'Action hors catalogue : impossible de savoir quel droit elle exige.';
  end if;

  -- Le droit propre à l'action d'abord : c'est celui dont l'absence doit
  -- s'expliquer en clair (« vous n'avez pas le droit d'émettre une
  -- facture »). Puis celui d'écrire la ligne, qu'exige la RLS.
  perform public.ai_guard(v_approval.organization_id, v_permission);
  perform public.ai_guard(v_approval.organization_id, 'projects.manage');

  update public.ai_action_approvals
     set status = case when p_ok then 'approved' else 'rejected' end,
         responded_at = now(),
         responded_by = auth.uid()
   where id = p_approval_id;

  update public.ai_actions
     set status = case when p_ok then 'approved' else 'rejected' end,
         updated_at = now()
   where id = v_approval.action_id;

  perform public.ai_record_agent_event(
    v_approval.organization_id, v_approval.requested_by_agent, 'aiApprovalAnswered',
    'ai_action', v_approval.action_id, null,
    jsonb_build_object('action', v_action_type, 'risque', v_approval.risk),
    case when p_ok then 'approved' else 'rejected' end,
    null
  );
end;
$$;

/**
 * Balayer les demandes périmées.
 *
 * Sans elle, une demande expirée reste `pending` à l'écran jusqu'à ce
 * que quelqu'un clique dessus pour découvrir qu'elle est morte.
 */
create or replace function public.ai_expire_stale_approvals(p_organization_id uuid)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  perform public.ai_guard(p_organization_id, 'projects.manage');

  with expirees as (
    update public.ai_action_approvals
       set status = 'expired', responded_at = now()
     where organization_id = p_organization_id
       and status = 'pending'
       and expires_at <= now()
    returning action_id
  )
  update public.ai_actions a
     set status = 'expired', updated_at = now()
   where a.id in (select action_id from expirees)
     and a.status = 'awaiting_approval';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * LA PIÈCE CRITIQUE : cette action peut-elle partir sans personne ?
 *
 * C'est la seule fonction du produit qui autorise une opération sans
 * qu'un humain la regarde. Tout, dans sa forme, est fait pour qu'elle
 * refuse.
 *
 * ─── POURQUOI ELLE N'EST PAS UNE SUITE DE `and` ───
 *
 * Un `return c1 and c2 and c3 and c4` a un défaut de forme : la
 * personne qui ajoutera plus tard une cinquième condition doit penser
 * à l'ajouter AU BON ENDROIT, dans une expression qu'elle peut aussi
 * bien casser en déplaçant une parenthèse. Et surtout, une condition
 * SUPPRIMÉE par mégarde ne laisse aucune trace : l'expression reste
 * valide, plus courte, et plus permissive.
 *
 * Ici, chaque condition est une entrée NOMMÉE d'un objet, et le verdict
 * n'est pas « ces conditions-là sont vraies » mais « AUCUNE condition
 * n'est fausse ». Trois conséquences :
 *
 *   • ajouter une condition la rend automatiquement bloquante — on ne
 *     peut pas oublier de la brancher, il n'y a rien à brancher ;
 *   • une condition qui vaut NULL (donnée manquante, ligne absente)
 *     devient `null` en JSON, qui n'est pas `true`, donc refuse ;
 *   • en retirer une fait passer le compte sous le minimum déclaré et
 *     la fonction refuse TOUT, bruyamment, au lieu de s'assouplir en
 *     silence. Une suppression accidentelle casse ; elle ne relâche pas.
 *
 * ─── LES QUATRE CONDITIONS EXIGÉES PAR LA SPEC ───
 *
 *   1. `agent_niveau_4`     — l'agent est actif ET au niveau 4
 *   2. `regle_active`       — une règle d'autopilote existe et est allumée
 *   3. `montant_sous_plafond` — le montant tient sous le plafond
 *   4. `droit_utilisateur`  — l'utilisateur détient le droit de l'action
 *
 * Et cinq autres, qui ne sont pas du zèle :
 *
 *   5. `membre`             — l'appelant appartient à l'organisation
 *   6. `action_connue`      — l'action figure au catalogue
 *   7. `action_eligible`    — le catalogue l'autorise en autopilote
 *   8. `type_dans_la_regle` — la liste blanche de la règle, si elle existe
 *   9. `cible_autorisee`    — les listes clients/fournisseurs, si elles existent
 *  10. `heure_autorisee`    — la plage horaire, si elle existe
 *
 * ─── LE TROU QU'ON A BOUCHÉ ───
 *
 * `coalesce(p_amount_cents, 0) <= plafond` seul offrirait un
 * contournement évident : ne pas passer de montant. Le catalogue dit
 * donc, par action, si elle engage de l'argent ; quand c'est le cas,
 * un montant ABSENT refuse au lieu de valoir zéro. Et si le catalogue
 * est muet sur l'action, on suppose qu'elle en engage.
 *
 * ─── ET L'ERREUR IMPRÉVUE ───
 *
 * Le `exception when others then return false` final n'est pas de la
 * paresse : une fonction qui décide de se passer d'humain doit tomber
 * du côté fermé. Un plantage ici doit valoir « non », jamais « oui ».
 */
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
  -- Le nombre de conditions ci-dessous. Si quelqu'un en retire une, le
  -- compte ne colle plus et la fonction refuse tout — panne visible
  -- plutôt que relâchement silencieux.
  c_conditions constant int := 10;
begin
  select * into v_catalog from public.ai_action_catalog where action_type = p_action_type;

  select * into v_setting from public.ai_agent_settings
   where organization_id = p_organization_id and agent = p_agent;

  select * into v_rule from public.ai_autopilot_rules
   where organization_id = p_organization_id and action_type = p_action_type;

  v_hour := extract(hour from (now() at time zone 'Europe/Paris'))::int;

  v_checks := jsonb_build_object(

    'membre',
      public.is_organization_member(p_organization_id),

    'action_connue',
      v_catalog.action_type is not null,

    'action_eligible',
      v_catalog.autopilot_eligible,

    -- 1. Niveau d'autonomie 4, et agent allumé. Un agent éteint au
    --    niveau 4 est un agent éteint.
    'agent_niveau_4',
      v_setting.enabled and v_setting.autonomy_level = 4,

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

  -- « Aucune fausse », et non « ces dix-là sont vraies ». Un `null`
  -- JSON n'est pas `true` : il tombe donc du côté du refus.
  return not exists (
    select 1 from jsonb_each(v_checks) e where e.value <> to_jsonb(true)
  );

exception when others then
  return false;
end;
$$;

/**
 * L'AIAuditEvent de la spec (p. 41) : agent, utilisateur, organisation,
 * action, données utilisées, paramètres, confirmation, résultat,
 * horodatage.
 *
 * PAS DE SECOND JOURNAL. `record_audit_event` (0058) porte déjà
 * l'organisation, l'auteur — imposé par `auth.uid()`, donc
 * infalsifiable —, le verbe, l'entité et l'horodatage ; il connaît
 * même la source `ai`. Les quatre champs qui manquaient (agent,
 * `dataUsed`, `parameters`, `confirmation`) sont des attributs de
 * l'événement, pas des colonnes d'une nouvelle table : ils entrent dans
 * `new_value`. Sa signature suffit donc, et n'est pas touchée — une
 * table parallèle aurait sa propre RLS, sa propre rétention, et le jour
 * d'un incident on lirait la mauvaise.
 *
 * Filtre de relecture : `source = 'ai'`, et `new_value ->> 'agent'`
 * pour un agent donné.
 */
create or replace function public.ai_record_agent_event(
  p_organization_id uuid,
  p_agent text,
  p_action text,
  p_entity_type text default 'ai_action',
  p_entity_id uuid default null,
  p_data_used jsonb default null,
  p_parameters jsonb default null,
  p_confirmation text default 'none',
  p_result jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_confirmation text := coalesce(p_confirmation, 'none');
begin
  if v_confirmation not in ('none', 'requested', 'approved', 'rejected', 'autopilot', 'human') then
    raise exception 'Mode de confirmation inconnu : « % ».', v_confirmation;
  end if;

  return public.record_audit_event(
    p_organization_id,
    coalesce(public.ai_clean_text(p_action, 100), 'aiAgentAction'),
    coalesce(public.ai_clean_text(p_entity_type, 60), 'ai_action'),
    p_entity_id,
    null,
    jsonb_strip_nulls(jsonb_build_object(
      'agent',        p_agent,
      'dataUsed',     p_data_used,
      'parameters',   p_parameters,
      'confirmation', v_confirmation,
      'result',       p_result
    )),
    'ai'
  );
end;
$$;

/**
 * Émettre un événement métier.
 *
 * `security definer`, comme `record_audit_event` et pour la même
 * raison : la table n'a pas de politique d'insertion, parce qu'un
 * événement forgé depuis le navigateur déclencherait une analyse
 * sincère sur un fait qui n'a pas eu lieu. Le contrôle d'appartenance
 * que la RLS ferait est donc fait ici, à la main.
 *
 * L'appartenance suffit — pas une permission particulière : constater
 * qu'une facture est en retard n'est pas une décision, et le balayage
 * qui l'écrit ne doit pas dépendre du profil de qui l'a déclenché.
 */
create or replace function public.emit_business_event(
  p_organization_id uuid,
  p_event_type text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Organisation inaccessible.';
  end if;

  insert into public.business_events (
    organization_id, event_type, entity_type, entity_id,
    payload, occurred_at, dedupe_key
  ) values (
    p_organization_id,
    p_event_type,
    public.ai_clean_text(p_entity_type, 60),
    p_entity_id,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_occurred_at, now()),
    public.ai_clean_text(p_dedupe_key, 200)
  )
  on conflict do nothing
  returning id into v_id;

  return v_id;   -- NULL = déjà connu, ce qui n'est pas une erreur
end;
$$;

/**
 * Marquer un événement comme traité par les agents.
 */
create or replace function public.mark_business_event_processed(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.business_events where id = p_event_id;
  if v_org is null then
    raise exception 'Événement introuvable.';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception 'Organisation inaccessible.';
  end if;

  update public.business_events
     set processed_at = coalesce(processed_at, now())
   where id = p_event_id;
end;
$$;

-- ============================================================
-- 13. Les défauts d'une entreprise
-- ============================================================

/**
 * Poser les réglages IA d'une organisation.
 *
 * `on conflict do nothing` PARTOUT, et c'est le cœur de la fonction :
 * rejouer la migration, ou repasser sur une entreprise existante, ne
 * doit JAMAIS écraser un choix humain — ni relever un plafond, ni
 * rallumer une règle éteinte, ni remonter un niveau d'autonomie.
 *
 * `security definer` : elle est appelée par un déclencheur au moment où
 * l'organisation vient de naître et où son premier membre n'est pas
 * encore inscrit (voir `create_professional_organization`, 0043) — la
 * RLS n'aurait personne à qui donner raison.
 */
create or replace function public.ai_ensure_org_defaults(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Niveau 1 « advise » pour les quatre agents. Jamais 4.
  insert into public.ai_agent_settings (organization_id, agent, enabled, autonomy_level)
  select p_organization_id, a, true, 1
  from unnest(array['executive', 'finance', 'billing', 'quote_pricing']) as a
  on conflict (organization_id, agent) do nothing;

  -- Une règle par action du catalogue, à l'état que le catalogue
  -- prescrit. Les trois de la spec qui doivent être à OFF le sont —
  -- et le déclencheur `ai_autopilot_rules_guard` les y maintient.
  insert into public.ai_autopilot_rules (organization_id, action_type, enabled, maximum_amount_cents)
  select p_organization_id, c.action_type, c.autopilot_default_on, 0
  from public.ai_action_catalog c
  on conflict (organization_id, action_type) do nothing;

  -- Les sept objectifs, tous éteints : c'est à l'entreprise de dire ce
  -- qu'elle cherche. Un objectif allumé par défaut orienterait les
  -- recommandations de quelqu'un qui n'a rien demandé.
  insert into public.business_goals (organization_id, goal, enabled, priority)
  select p_organization_id, g, false, 100
  from unnest(array[
    'increase_revenue', 'increase_margin', 'grow_maintenance_contracts',
    'reduce_travel', 'grow_nursery', 'reduce_inventory', 'improve_cashflow'
  ]) as g
  on conflict (organization_id, goal) do nothing;
end;
$$;

create or replace function public.ai_seed_org_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ai_ensure_org_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists ai_seed_org_defaults_trg on public.business_organizations;
create trigger ai_seed_org_defaults_trg
  after insert on public.business_organizations
  for each row execute function public.ai_seed_org_defaults();

-- Les entreprises déjà en base. Idempotent par construction.
do $$
declare o uuid;
begin
  for o in select id from public.business_organizations loop
    perform public.ai_ensure_org_defaults(o);
  end loop;
end $$;

-- ============================================================
-- 14. RLS
-- ============================================================
-- Trois familles, trois régimes.
--
--   • LE CATALOGUE n'appartient à personne : lecture ouverte aux
--     comptes authentifiés, écriture fermée à tous. Il se modifie par
--     migration, ce qui est exactement la cérémonie qu'on veut autour
--     de « cette action peut-elle partir sans humain ».
--
--   • L'OPÉRATIONNEL (décisions, actions, approbations, résultats
--     mesurés) suit le régime du chantier, comme le matériel en 0067 :
--     `projects.read` pour lire, `projects.manage` pour écrire. Le
--     Decision Center est le prolongement de la conduite de travaux.
--
--   • LA CONFIGURATION (autonomie des agents, autopilote, cibles KPI,
--     objectifs) se lit par tout membre — un salarié a le droit de
--     savoir ce que la machine est autorisée à faire en son nom — et ne
--     s'écrit qu'avec `organization.manageUsers`, le droit des
--     réglages d'entreprise (0060). Régler l'autopilote n'est pas
--     conduire un chantier.
--
--   • `business_events` se lit par tout membre et ne s'écrit PAR
--     AUCUNE POLITIQUE : seule `emit_business_event` y insère.

alter table public.ai_action_catalog enable row level security;
drop policy if exists "Anyone signed in reads the AI action catalog" on public.ai_action_catalog;
create policy "Anyone signed in reads the AI action catalog" on public.ai_action_catalog
  for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array[
    'ai_decisions', 'ai_actions', 'ai_action_approvals', 'ai_decision_outcomes'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members with projects.read can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with projects.read can read %1$s" on public.%1$I
         for select using (public.has_permission(organization_id, ''projects.read''))', t);

    execute format('drop policy if exists "Members with projects.manage can write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members with projects.manage can write %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''projects.manage''))
         with check (public.has_permission(organization_id, ''projects.manage''))', t);
  end loop;

  foreach t in array array[
    'ai_agent_settings', 'ai_autopilot_rules', 'organization_kpi_targets', 'business_goals'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Members read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members read %1$s" on public.%1$I
         for select using (public.is_organization_member(organization_id))', t);

    execute format('drop policy if exists "Managers write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Managers write %1$s" on public.%1$I
         for all using (public.has_permission(organization_id, ''organization.manageUsers''))
         with check (public.has_permission(organization_id, ''organization.manageUsers''))', t);
  end loop;
end $$;

alter table public.business_events enable row level security;
drop policy if exists "Members read business events" on public.business_events;
create policy "Members read business events" on public.business_events
  for select using (public.is_organization_member(organization_id));

-- ============================================================
-- 15. CE QUI N'EST PAS DANS CE FICHIER, ET POURQUOI
-- ============================================================
-- Ce bloc n'exécute rien. Il est là pour la prochaine personne, qui
-- voudra ajouter quelque chose et a le droit de savoir ce qui a été
-- pesé.
--
--   Les neuf autres agents (Sales, Operations, Planning, Procurement,
--   Nursery, Fleet, Customer, Market, Risk)
--       Hors périmètre de la première itération, spec p. 49. Le
--       catalogue nomme `purchaseOrderSend` avec l'agent
--       « procurement » — pour le VERROUILLER, pas pour l'amorcer :
--       `ai_is_supported_agent` refuse ce nom partout ailleurs.
--
--   Les déclencheurs SQL sur les tables métier
--       `business_events` attend un balayage périodique. Un
--       déclencheur sur `invoices` ferait dépendre l'émission d'une
--       facture du bon état de la couche IA.
--
--   Le TravelCostService, le MarketResearchService, la Monthly Review
--       Étapes 12, 19 et 24 : après la première itération.
--
--   Une autorisation d'autopilote pour l'envoi de factures, les
--   commandes fournisseurs ou la modification de tarifs
--       Ce sont trois des interdits de la page 2, et l'autopilote est
--       l'absence de validation. Les ouvrir demande de passer
--       `autopilot_eligible` à `true` dans le catalogue, par migration.
--       C'est délibérément la voie la plus lente.
--
--   Un plafond d'autopilote par défaut supérieur à zéro
--       Un plafond hérité est un plafond que personne n'a choisi.
