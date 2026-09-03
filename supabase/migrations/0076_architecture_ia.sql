-- Oasis Care — ARCHITECTURE IA DES AGENTS, la part qui vit en base.
--
-- À exécuter après 0075. Idempotente et purement additive.
--
-- CE QUE CE FICHIER EST. La spec « Architecture IA des Agents » décrit
-- un runtime d'agents qui tourne dans le serveur Next.js : un
-- fournisseur, un aiguilleur de modèles, une configuration centrale,
-- un constructeur de contexte, un registre d'outils. Rien de tout cela
-- n'est ici, et c'est voulu — ce sont des objets TypeScript. Ce que la
-- base doit porter, ce sont les CINQ CHOSES QUI DOIVENT SURVIVRE AU
-- REDÉMARRAGE DU SERVEUR :
--
--   • ce que l'IA a consommé          → `ai_usage_events`      (étape 16, p. 18)
--   • ce qu'elle a le droit de brûler → `ai_cost_limits`       (étape 15, p. 19)
--   • ce qu'elle a déjà calculé       → `ai_result_cache`      (p. 19)
--   • le modèle qu'une entreprise impose → `ai_model_overrides` (p. 26)
--   • ce que l'utilisateur en a pensé → `ai_recommendation_feedback` (p. 25)
--
-- plus une colonne manquante sur `ai_decisions` : le versionnage de
-- contexte de la page 21.
--
-- CE QUE CE FICHIER N'EST PAS, ET NE SERA JAMAIS.
--
--   IL NE NOMME AUCUN MODÈLE. Ni `gpt-5.6-sol`, ni `terra`, ni `luna`,
--   nulle part — pas dans une énumération, pas dans une contrainte, pas
--   dans un défaut, pas dans une table de tarifs. Les trois
--   identifiants vivent dans UNE configuration TypeScript, surchargeable
--   par variable d'environnement, et un contrôle de disponibilité les
--   éprouve au démarrage. Le jour où l'un des trois n'existe pas sous
--   ce nom-là, il y a exactement un fichier à corriger. Une contrainte
--   SQL sur le nom du modèle ferait de cette base le deuxième endroit à
--   corriger, et le premier à échouer — en pleine nuit, sur une
--   migration, au lieu d'un message clair au démarrage. `model` est donc
--   du texte libre partout dans ce fichier.
--
--   IL NE CALCULE AUCUN COÛT. Le tarif d'un modèle n'est pas une donnée
--   de ce produit : il appartient au fournisseur, il change sans
--   préavis, et il diffère selon le cache de prompt, le palier, la
--   région. Le serveur Next.js, qui connaît le tarif au moment de
--   l'appel, ESTIME et écrit son estimation ; la base la range et dit
--   d'où elle vient (`cost_basis`). Une table de tarifs en SQL serait
--   fausse trois semaines après avoir été écrite, et personne ne le
--   saurait.
--
-- ============================================================
-- LES QUATRE RÈGLES QUE CHAQUE LIGNE DE CE FICHIER TIENT
-- ============================================================
-- Ce sont celles de 0072, appliquées à un domaine où elles mordent
-- particulièrement fort.
--
--   1. UNE LIMITE ABSENTE N'EST PAS UNE LIMITE À ZÉRO. C'est LA règle
--      de ce fichier. `ai_cost_limits` n'a aucun `default 0`, aucune
--      colonne `not null`, et aucune ligne n'est semée à la création
--      d'une entreprise. Une entreprise sans ligne n'a pas de plafond ;
--      une entreprise avec un plafond à zéro a coupé son IA
--      délibérément. Le contraire — un plafond à zéro hérité d'un
--      défaut — éteindrait l'IA de toutes les entreprises du parc le
--      jour de la migration, en silence, et personne ne comprendrait
--      pourquoi. `ai_cost_budget_remaining` rend donc NULL, et NULL veut
--      dire « aucune limite posée ».
--
--   2. UN COÛT INCONNU N'EST PAS UN COÛT NUL. `estimated_cost_cents`
--      est NULLABLE. Un modèle dont le serveur ne connaît pas le tarif
--      produit un événement d'usage SANS montant — jamais un montant à
--      zéro, qui ferait croire à un appel gratuit et sous-estimerait le
--      budget consommé pour toujours. Comme une somme silencieuse
--      mentirait quand même, `ai_cost_budget_remaining` rend en plus le
--      NOMBRE d'événements non tarifés : le total est alors lisible
--      pour ce qu'il est, un minorant.
--
--   3. UN RÉSULTAT PÉRIMÉ NE SE SERT PAS. Le cache ne repose pas sur la
--      seule expiration : il repose sur une EMPREINTE des données
--      sources, que l'appelant doit fournir pour lire. Voir la longue
--      note du § 3 — c'est la partie de ce fichier qui demande le plus
--      d'attention.
--
--   4. LE CLOISONNEMENT SE VÉRIFIE AUX DEUX BOUTS. Chaque table porte
--      `organization_id` et sa RLS. Les liens vers `ai_decisions`
--      passent par la clé composite `(id, organization_id)` que 0072 a
--      posée pour cela : une entreprise ne peut pas accrocher un
--      événement d'usage, ni un avis, à la décision d'une autre.

-- ============================================================
-- 1. AI USAGE EVENTS — le grand livre de ce que l'IA consomme
-- ============================================================
-- Spec p. 18 : organizationId, agent, model, inputTokens, outputTokens,
-- estimatedCost, duration, toolCalls, success, timestamp. On ajoute
-- quatre colonnes que la spec appelle ailleurs et qui n'ont de sens
-- qu'ici : `cost_basis` (p. 18, « estimation » et non facture),
-- `failure_reason` et `fallback_from_model` (p. 23, le repli contrôlé),
-- `decision_id` et `user_id` (p. 18, « coût / décision », « coût /
-- utilisateur »).

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  -- L'AGENT N'EST PAS CONTRAINT À `ai_is_supported_agent`, ET C'EST
  -- DÉLIBÉRÉ — c'est même la seule table de la Phase 11V où le nom
  -- d'agent est libre.
  --
  -- Un grand livre de dépenses doit être COMPLET avant d'être bien
  -- rangé. Le pré-traitement de classification (p. 29, « 1000 CRM
  -- activities → Luna ») coûte de l'argent réel et n'est l'affaire
  -- d'aucun des quatre agents ; un aiguilleur qui échoue avant d'avoir
  -- choisi son agent a quand même brûlé des jetons. Refuser ces lignes
  -- par contrainte ferait disparaître la dépense du budget, ce qui est
  -- exactement le contraire de ce que la table sert à faire. Le
  -- verrou de 0072 reste entier là où il compte : `ai_agent_settings`
  -- et `ai_model_overrides` refusent toujours un cinquième agent, donc
  -- aucun agent hors périmètre ne peut AGIR. Il peut seulement coûter,
  -- et alors il faut le voir.
  agent text not null,

  -- Texte libre. Voir l'en-tête : SQL ne connaît pas les noms de
  -- modèles, et ne doit jamais les apprendre.
  model text not null,

  input_tokens int not null check (input_tokens >= 0),
  output_tokens int not null check (output_tokens >= 0),

  -- UNE ESTIMATION, JAMAIS UNE FACTURE — le nom le dit, et `cost_basis`
  -- l'explique. NULLABLE : voir la règle 2 de l'en-tête. Un tarif
  -- inconnu laisse la case vide.
  estimated_cost_cents bigint check (estimated_cost_cents >= 0),

  -- D'OÙ VIENT LE TARIF QUI A SERVI À L'ESTIMATION. Une chaîne courte
  -- écrite par le serveur, du genre « tarif-public-2026-09 » ou
  -- « surcharge-env ». Sans elle, une facture du fournisseur en écart
  -- de 30 % avec ce grand livre serait indébrouillable : on ne saurait
  -- pas si le tarif a changé, si le calcul est faux, ou si un appel a
  -- échappé au journal. Avec elle, on sait au moins quelle grille
  -- interroger.
  --
  -- La contrainte qui suit dit la seule chose vraiment importante : un
  -- montant sans provenance n'est pas une estimation, c'est un chiffre.
  cost_basis text,

  duration_ms int not null check (duration_ms >= 0),
  tool_calls int not null default 0 check (tool_calls >= 0),

  success boolean not null,

  -- Les quatre pannes de la page 23, plus deux. Vocabulaire fermé :
  -- « timeout » et « time-out » écrits au hasard rendraient tout
  -- comptage de pannes faux.
  failure_reason text check (failure_reason in (
    'model_unavailable',   -- le modèle n'existe pas / n'est pas servi
    'rate_limit',
    'timeout',
    'provider_error',
    'budget_exceeded',     -- refus d'AICostControlService, pas une panne
    'other'
  )),

  -- LE REPLI, RENDU VISIBLE. Page 23 : « Sol unavailable ↓ Terra », et
  -- surtout « ne pas dégrader silencieusement une décision critique ».
  -- Une colonne vide ici veut dire que le modèle demandé est celui qui
  -- a répondu. Une colonne remplie est la trace d'un repli, et permet
  -- de le compter — un repli permanent qui ne se voit pas est un
  -- produit qui a changé de qualité sans le dire.
  fallback_from_model text,

  -- « Coût / décision » du tableau de bord p. 18. La clé est COMPOSITE :
  -- une entreprise ne peut pas imputer sa consommation à la décision
  -- d'une autre.
  decision_id uuid,

  -- « Coût / utilisateur ». `on delete set null` : un départ efface la
  -- personne, pas la dépense — le total du mois ne doit pas bouger
  -- parce qu'un compte a été supprimé.
  user_id uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),

  -- `set null (decision_id)` ET NON `set null` TOUT COURT : la clé est
  -- composite, et un `set null` nu tenterait de vider AUSSI
  -- `organization_id`, qui est `not null` — la suppression d'une
  -- décision échouerait alors avec un message incompréhensible. La
  -- liste de colonnes (PostgreSQL 15+) dit ce qu'on veut vraiment :
  -- une décision effacée laisse sa dépense au grand livre, orpheline
  -- mais toujours comptée. Le contraire ferait baisser le total du
  -- mois parce qu'on a rangé le Decision Center.
  constraint ai_usage_events_decision_same_org
    foreign key (decision_id, organization_id)
    references public.ai_decisions (id, organization_id)
    on delete set null (decision_id),

  -- Un appel réussi n'a pas de cause de panne, et un échec doit dire
  -- laquelle. Sans cette contrainte, « success = false, raison NULL »
  -- deviendrait la ligne majoritaire et le tableau des pannes serait
  -- inutilisable.
  constraint ai_usage_events_failure_reason_matches_success
    check ((success and failure_reason is null)
        or (not success and failure_reason is not null)),

  -- Un montant sans provenance de tarif est un chiffre tombé du ciel.
  -- L'inverse est permis : une provenance sans montant dit « je connais
  -- la grille, elle ne couvre pas ce modèle ».
  constraint ai_usage_events_amount_needs_basis
    check (estimated_cost_cents is null or cost_basis is not null)
);

comment on table public.ai_usage_events is
  'Grand livre de la consommation IA. Les montants sont des ESTIMATIONS calculées par le serveur ; `cost_basis` dit quelle grille tarifaire a servi. Ce n''est pas une facture.';

comment on column public.ai_usage_events.estimated_cost_cents is
  'Estimation en centimes, NULLABLE. NULL = tarif inconnu pour ce modèle, ce qui n''est PAS un appel gratuit.';

comment on column public.ai_usage_events.agent is
  'Texte libre, volontairement non contraint à ai_is_supported_agent : une dépense doit pouvoir être enregistrée même hors des quatre agents (classification, aiguilleur, échec avant routage).';

-- Les deux lectures du tableau de bord p. 18 : « aujourd'hui / ce
-- mois » pour l'entreprise, puis la ventilation par agent.
create index if not exists ai_usage_events_org_time_idx
  on public.ai_usage_events (organization_id, created_at desc);

create index if not exists ai_usage_events_org_agent_time_idx
  on public.ai_usage_events (organization_id, agent, created_at desc);

create index if not exists ai_usage_events_decision_idx
  on public.ai_usage_events (decision_id)
  where decision_id is not null;

/**
 * Enregistrer une consommation.
 *
 * `security definer`, et pour la même raison qu'`emit_business_event`
 * en 0072, doublée d'une raison propre à cette table.
 *
 *   • LA TABLE N'A AUCUNE POLITIQUE D'ÉCRITURE. Une ligne d'usage
 *     forgée depuis le navigateur creuserait le budget d'une
 *     entreprise jusqu'à éteindre son IA — un déni de service à une
 *     requête. Personne n'écrit ici sans passer par cette fonction.
 *
 *   • ELLE NE PEUT PAS EXIGER UNE PERMISSION D'ÉCRITURE. Un salarié
 *     sans `projects.manage` a parfaitement le droit de poser une
 *     question à Oasis AI, et cette question coûte. Si l'inscription au
 *     grand livre exigeait `projects.manage`, la dépense de tous les
 *     non-gestionnaires disparaîtrait du budget. L'appartenance suffit
 *     donc, exactement comme pour `emit_business_event` : constater une
 *     dépense n'est pas une décision.
 *
 * L'auteur n'est pas un paramètre : `auth.uid()` l'impose. On ne peut
 * pas imputer sa consommation à quelqu'un d'autre.
 */
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

-- ============================================================
-- 2. AI COST LIMITS — ce qu'une entreprise s'autorise à brûler
-- ============================================================
-- Spec p. 19 : dailyOrganizationLimit, monthlyOrganizationLimit,
-- agentLimit.
--
-- AUCUNE LIGNE N'EST SEMÉE À LA CRÉATION D'UNE ENTREPRISE, et
-- `ai_ensure_org_defaults` (0072) n'est pas touchée. Une ligne de
-- défauts à NULL serait un doublon de l'absence de ligne ; une ligne de
-- défauts chiffrée serait un plafond que personne n'a choisi — le
-- travers que 0072 nomme déjà pour l'autopilote. Absence de ligne =
-- absence de limite, et c'est la seule lecture possible.

create table if not exists public.ai_cost_limits (
  organization_id uuid primary key
    references public.business_organizations (id) on delete cascade,

  -- LES TROIS SONT NULLABLES ET SANS DÉFAUT. NULL = pas de plafond.
  -- Zéro = plafond à zéro, c'est-à-dire IA coupée — un réglage
  -- légitime, mais qui doit être écrit à la main par quelqu'un.
  daily_organization_limit_cents bigint
    check (daily_organization_limit_cents >= 0),

  monthly_organization_limit_cents bigint
    check (monthly_organization_limit_cents >= 0),

  -- PLAFOND MENSUEL, PAR AGENT. La spec dit « agentLimit » sans nommer
  -- la fenêtre ; on choisit le mois et on le dit ici plutôt que de
  -- laisser deux écrans en décider chacun de leur côté. Le jour est
  -- une mauvaise fenêtre pour un agent : l'Executive Agent tourne une
  -- fois par matin sur le modèle le plus cher, un brief un peu long le
  -- ferait sauter son plafond quotidien alors que son mois est sage.
  per_agent_limit_cents bigint
    check (per_agent_limit_cents >= 0),

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.ai_cost_limits is
  'Plafonds de dépense IA. Une colonne NULL, ou une entreprise sans ligne, veut dire « aucune limite » — jamais « limite à zéro ».';

comment on column public.ai_cost_limits.per_agent_limit_cents is
  'Plafond MENSUEL par agent, en centimes. NULL = pas de plafond.';

/**
 * Ce qu'il reste à dépenser.
 *
 * TROIS CHOSES À SAVOIR AVANT DE LIRE CETTE FONCTION.
 *
 *   1. `*_remaining_cents` VAUT NULL QUAND AUCUNE LIMITE N'EST POSÉE.
 *      C'est l'arithmétique de PostgreSQL qui le donne (NULL moins
 *      quelque chose vaut NULL) et c'est exactement ce qu'on veut :
 *      l'appelant doit distinguer « il te reste 0 centime » de « on ne
 *      t'a fixé aucune limite ». Un `coalesce(..., 0)` ici couperait
 *      l'IA de toutes les entreprises qui n'ont jamais ouvert l'écran
 *      des budgets.
 *
 *   2. LE RESTE PEUT ÊTRE NÉGATIF, et on ne l'écrête pas. « Il te
 *      reste -1 200 » dit qu'on a dépassé de douze euros ; un
 *      `greatest(0, …)` transformerait tous les dépassements, petits et
 *      énormes, en la même phrase.
 *
 *   3. `*_spent_cents` EST UN MINORANT. La somme ignore les événements
 *      sans tarif connu (règle 2 de l'en-tête). Les rendre invisibles
 *      serait un mensonge par omission, donc la fonction rend AUSSI
 *      leur nombre : `unpriced_events_today` / `unpriced_events_month`.
 *      Un appelant sérieux qui voit un compte non nul sait que son
 *      total est incomplet. Le `coalesce(sum(...), 0)` sur la dépense,
 *      lui, est honnête : aucun événement du jour, c'est réellement
 *      zéro dépensé aujourd'hui.
 *
 * JOURNÉE ET MOIS SONT CEUX DE PARIS, comme partout depuis 0066. En UTC,
 * « la dépense d'aujourd'hui » repartirait à zéro à 2 h du matin l'été,
 * et un plafond quotidien serait remis à neuf en pleine nuit.
 *
 * `security invoker`, mais avec un contrôle d'appartenance EXPLICITE :
 * sans lui, une entreprise interrogeant l'identifiant d'une autre
 * recevrait « aucune limite, zéro dépensé » — la RLS masquant tout, la
 * réponse serait rassurante et fausse. Un refus franc vaut mieux qu'un
 * zéro trompeur.
 */
create or replace function public.ai_cost_budget_remaining(
  p_organization_id uuid,
  p_agent text default null
)
returns table (
  daily_limit_cents bigint,
  daily_spent_cents bigint,
  daily_remaining_cents bigint,
  monthly_limit_cents bigint,
  monthly_spent_cents bigint,
  monthly_remaining_cents bigint,
  agent_limit_cents bigint,
  agent_spent_cents bigint,
  agent_remaining_cents bigint,
  unpriced_events_today int,
  unpriced_events_month int
)
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_agent text;
begin
  if p_organization_id is null then
    raise exception 'Organisation manquante : un budget ne se lit pas dans le vide.';
  end if;
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Organisation inaccessible.';
  end if;

  v_day_start := date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_month_start := date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_agent := public.ai_clean_text(p_agent, 60);

  return query
  with limites as (
    select l.daily_organization_limit_cents   as l_jour,
           l.monthly_organization_limit_cents as l_mois,
           l.per_agent_limit_cents            as l_agent
    from public.ai_cost_limits l
    where l.organization_id = p_organization_id
  ),
  -- UNE ENTREPRISE SANS LIGNE DE PLAFONDS DOIT QUAND MÊME OBTENIR UNE
  -- RÉPONSE. Sans ce `union all`, la fonction ne rendrait AUCUNE ligne
  -- pour elle, et l'appelant lirait l'absence de résultat comme il
  -- voudrait — le plus souvent comme un zéro. On rend donc une ligne
  -- de NULL, qui dit ce qu'il faut : aucune limite posée.
  socle as (
    select * from limites
    union all
    select null::bigint, null::bigint, null::bigint
    where not exists (select 1 from limites)
  ),
  evts as (
    select u.created_at, u.agent as ag, u.estimated_cost_cents as c
    from public.ai_usage_events u
    where u.organization_id = p_organization_id
      and u.created_at >= v_month_start
  )
  select
    s.l_jour,
    coalesce((select sum(e.c) from evts e where e.created_at >= v_day_start), 0)::bigint,
    s.l_jour - coalesce((select sum(e.c) from evts e where e.created_at >= v_day_start), 0)::bigint,

    s.l_mois,
    coalesce((select sum(e.c) from evts e), 0)::bigint,
    s.l_mois - coalesce((select sum(e.c) from evts e), 0)::bigint,

    -- Sans agent demandé, les trois colonnes d'agent restent vides :
    -- « je n'ai pas posé la question » n'est pas « il n'y a pas de
    -- plafond d'agent ».
    case when v_agent is null then null else s.l_agent end,
    case when v_agent is null then null
         else coalesce((select sum(e.c) from evts e where e.ag = v_agent), 0)::bigint end,
    case when v_agent is null then null
         else s.l_agent - coalesce((select sum(e.c) from evts e where e.ag = v_agent), 0)::bigint end,

    (select count(*) from evts e where e.c is null and e.created_at >= v_day_start)::int,
    (select count(*) from evts e where e.c is null)::int
  from socle s;
end;
$$;

comment on function public.ai_cost_budget_remaining(uuid, text) is
  'Ce qu''il reste du budget IA. Un « remaining » NULL veut dire « aucune limite posée », jamais « zéro ». Le « spent » est un minorant : voir unpriced_events_*.';

-- ============================================================
-- 3. AI RESULT CACHE — et la seule façon honnête de l'invalider
-- ============================================================
-- Spec p. 19 : « Ne pas recalculer l'analyse du même devis toutes les
-- 10 secondes », « avec invalidation lorsque données sous-jacentes
-- changent ».
--
-- LE PROBLÈME, POSÉ FRANCHEMENT. Ces deux phrases tirent en sens
-- inverse. La première veut qu'on serve un résultat déjà calculé ; la
-- seconde interdit de servir un résultat calculé avant une
-- modification. Entre les deux, il y a le cas qui fait mal : le devis
-- est modifié À LA SECONDE 3 d'une entrée valable 10 minutes. Une durée
-- de vie, aussi courte soit-elle, ne le voit pas.
--
-- LES DEUX RÉPONSES QU'ON N'A PAS RETENUES.
--
--   • Des déclencheurs SQL sur les tables métier (`quotes`,
--     `quote_lines`, `invoices`, `projects`…) qui videraient le cache.
--     C'est la solution qui vient d'abord, et 0072 a déjà écrit
--     pourquoi elle est mauvaise : elle fait dépendre l'édition d'un
--     devis du bon état de la couche IA. Un déclencheur en erreur, et
--     on ne peut plus modifier un devis. Elle a un défaut de plus :
--     elle est SILENCIEUSEMENT INCOMPLÈTE. Oublier la table
--     `quote_lines` ne casse rien de visible — le cache continue de
--     servir, simplement il ment.
--
--   • Une durée de vie très courte, dix secondes. Elle transforme le
--     mensonge en mensonge bref, ce qui n'est pas la même chose que la
--     vérité, et elle supprime au passage tout l'intérêt du cache.
--
-- CE QU'ON FAIT : L'EMPREINTE DES DONNÉES SOURCES EST DANS LA
-- CONDITION DE LECTURE.
--
-- L'appelant qui veut lire le cache doit d'abord calculer l'empreinte
-- de ce sur quoi il s'apprête à raisonner — pour un devis, typiquement
-- `md5` de son `updated_at`, de celui de ses lignes et de leur nombre.
-- Il la passe à `ai_cache_lookup`. Une entrée dont l'empreinte diffère
-- N'EST PAS SERVIE, quelle que soit sa fraîcheur.
--
-- Trois propriétés qui rendent ce choix supérieur aux deux autres :
--
--   1. ON NE PEUT PAS OUBLIER D'INVALIDER. Il n'y a rien à appeler
--      après une modification : le cache ne peut pas répondre à une
--      question qu'on ne lui a pas posée avec la bonne empreinte. Un
--      développeur qui ajoute demain une remise sur les devis et
--      oublie le cache obtient au pire des recalculs inutiles — jamais
--      une analyse périmée.
--
--   2. LE COÛT DE L'ERREUR EST DU BON CÔTÉ. Empreinte trop grossière →
--      analyse périmée servie (grave). Empreinte trop fine → cache qui
--      rate (bénin, on repaie un appel). Le paramètre est du côté de
--      l'appelant, donc facile à raffiner sans migration.
--
--   3. ÇA MARCHE POUR LES DONNÉES QUI NE SONT PAS DANS CETTE BASE.
--      Le Market Agent (p. 16) raisonne sur des données publiques.
--      Aucun déclencheur SQL ne les verrait ; une empreinte, si.
--
-- L'EXPIRATION RESTE, mais son rôle change : elle ne protège plus de la
-- péremption (l'empreinte s'en charge), elle borne la durée de vie de
-- ce que l'empreinte NE PEUT PAS voir — un tarif fournisseur consulté
-- sur le web, la météo, un cours — et elle empêche la table de croître
-- sans fin.
--
-- LE MODÈLE FAIT PARTIE DE L'IDENTITÉ de l'entrée. Une entreprise qui
-- passe son agent Finance sur le modèle avancé attend une meilleure
-- analyse ; lui resservir celle du modèle économique parce que la clé
-- et l'empreinte n'ont pas bougé viderait la surcharge de son sens.

create table if not exists public.ai_result_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  agent text not null,

  -- La clé logique, construite par l'appelant : « quotePriceAnalysis:
  -- <uuid du devis> ». Le préfixe avant les deux-points sert à
  -- l'invalidation en masse (voir `ai_invalidate_result_cache`).
  cache_key text not null,

  -- Texte libre, et partie de l'identité. Voir la note ci-dessus.
  model text not null,

  -- L'EMPREINTE. Sans elle, rien de tout ce qui précède ne tient.
  source_fingerprint text not null,

  result jsonb not null,

  -- Les données réellement lues, même forme que `ai_decisions.data_sources`.
  -- Elles servent à l'humain qui veut comprendre une analyse, et au
  -- développeur qui veut savoir ce que l'empreinte aurait dû couvrir.
  data_sources jsonb not null default '[]'::jsonb,

  -- Le versionnage de contexte de la page 21, appliqué au cache : à
  -- quelle date les données lues étaient à jour. Ce n'est PAS
  -- `created_at` — on peut analyser à 14 h une photo financière arrêtée
  -- à minuit.
  data_snapshot_timestamp timestamptz not null default now(),

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  hit_count int not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,

  constraint ai_result_cache_expiry_after_creation
    check (expires_at > created_at)
);

comment on table public.ai_result_cache is
  'Résultats d''agents déjà calculés. Une entrée n''est servie que si l''empreinte des données sources fournie par l''appelant correspond — l''expiration ne suffit pas à garantir la fraîcheur.';

comment on column public.ai_result_cache.source_fingerprint is
  'Empreinte des données sur lesquelles le résultat a été calculé. Fournie par l''appelant à l''écriture ET à la lecture ; une différence rend l''entrée non servable.';

-- UNE SEULE ENTRÉE VIVANTE PAR CLÉ LOGIQUE. Un recalcul REMPLACE
-- l'ancienne plutôt que de l'empiler : sans cela, une analyse de devis
-- recalculée tous les jours laisserait derrière elle une traînée
-- d'entrées périmées que plus rien ne servirait jamais, et la table
-- grossirait indéfiniment pour rien.
create unique index if not exists ai_result_cache_key_uidx
  on public.ai_result_cache (organization_id, agent, cache_key, model);

create index if not exists ai_result_cache_expiry_idx
  on public.ai_result_cache (expires_at);

/**
 * Lire le cache. Rend NULL sur défaut, et NULL est un défaut légitime.
 *
 * `security definer` AVEC `ai_guard`, et non `security invoker`.
 *
 * La lecture seule se serait contentée de la RLS. Mais cette fonction
 * écrit aussi — elle incrémente `hit_count`, et depuis que l'écriture
 * dans `ai_result_cache` n'est plus ouverte par aucune politique (§ 7),
 * un `update` en `invoker` ne lèverait pas : il toucherait ZÉRO ligne,
 * en silence, et le compteur de la page 18 s'arrêterait sans que
 * personne ne s'en aperçoive. On pose donc le droit explicitement, et
 * il est le même que celui de la politique de lecture.
 *
 * LES TROIS RAISONS DE NE PAS SERVIR sont dans le même `where`, et
 * aucune n'est un cas particulier :
 *   • la clé, l'agent, le modèle ou l'entreprise ne correspondent pas ;
 *   • l'empreinte a changé — les données sous-jacentes ont bougé ;
 *   • l'entrée a expiré.
 */
create or replace function public.ai_cache_lookup(
  p_organization_id uuid,
  p_agent text,
  p_cache_key text,
  p_model text,
  p_source_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  -- Le compteur sert au tableau de bord : un cache dont personne ne
  -- lit jamais les entrées coûte de la place et ne fait économiser
  -- rien, et sans compteur on ne le saurait pas. La fonction étant
  -- `security definer`, l'écriture aboutit ; le garde-fou reste, parce
  -- qu'un compteur ne vaut jamais qu'on perde la réponse.
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

/**
 * Écrire (ou remplacer) une entrée de cache.
 *
 * `p_ttl_seconds` par défaut à dix minutes. Ce n'est pas un compromis
 * de fraîcheur — l'empreinte s'en occupe — c'est une borne sur ce que
 * l'empreinte ne voit pas, et un plafond de croissance de la table.
 * Un appelant qui raisonne sur des données externes volatiles passe
 * une valeur plus courte ; personne n'a besoin d'une valeur plus longue
 * pour être juste.
 */
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
-- `security definer` : AUCUNE politique n'autorise l'écriture dans
-- `ai_result_cache` (voir § 7). Le droit se vérifie ici, en première
-- ligne, et il vaut `projects.read` — c'est le SERVEUR qui alimente le
-- cache, pour le compte du lecteur, et non le lecteur qui y dépose ce
-- qu'il veut. La différence tient à la seule chose qui compte : par
-- cette fonction, le contenu écrit est celui que le modèle a rendu.
security definer
set search_path = public
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

/**
 * Invalider explicitement.
 *
 * L'empreinte rend cette fonction facultative pour la CORRECTION — une
 * entrée dont les données ont bougé ne sera de toute façon plus servie.
 * Elle reste utile pour deux choses :
 *   • libérer la place tout de suite après une modification connue,
 *     plutôt que d'attendre l'expiration ;
 *   • forcer le recalcul quand ce n'est pas la donnée qui a changé mais
 *     le raisonnement — nouvelle version d'un agent, correction d'un
 *     prompt. Aucune empreinte ne voit cela.
 *
 * `p_cache_key_prefix` vise une famille (« quotePriceAnalysis: »),
 * NULL vise tout l'agent, et un agent NULL toute l'entreprise. Rend le
 * nombre de lignes supprimées.
 */
create or replace function public.ai_invalidate_result_cache(
  p_organization_id uuid,
  p_agent text default null,
  p_cache_key_prefix text default null
)
returns int
language plpgsql
-- Même régime que `ai_cache_store`, et pour la même raison : aucune
-- politique n'autorise le `delete`. Sans ce verrou, un compte de
-- lecture seule pouvait vider le cache de son entreprise et faire
-- repayer chaque brief — une dépense qu'il ne pouvait ni voir ni
-- expliquer.
security definer
set search_path = public
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

/**
 * Le ménage. Traverse toutes les entreprises, donc `security definer`,
 * donc fermé à tout le monde sauf au planificateur — comme
 * `ai_ensure_org_defaults` en 0072, et pour la même raison : une
 * fonction qui écrit chez n'importe qui ne doit pas être joignable
 * depuis la clé anonyme, laquelle voyage dans le bundle du navigateur.
 */
create or replace function public.ai_purge_expired_result_cache()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.ai_result_cache where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 4. AI MODEL OVERRIDES — la surcharge de la page 26
-- ============================================================
-- « Créer dans administration technique : AI Configuration. Afficher :
-- Executive → Sol, Finance → Terra, … Permettre modification
-- sécurisée. » Et le critère final, page 34 : « Je dois pouvoir
-- remplacer demain Finance Terra → Sol depuis une configuration
-- centrale. »
--
-- LA CARTE PAR DÉFAUT N'EST PAS ICI. Elle est dans la configuration
-- TypeScript, avec les trois identifiants de modèles et le contrôle de
-- disponibilité. Cette table ne contient QUE les écarts qu'une
-- entreprise a délibérément posés. Conséquence directe : une
-- entreprise sans ligne suit le produit et bénéficie automatiquement de
-- la carte du jour ; si les défauts étaient recopiés ici à la création,
-- chaque entreprise serait figée sur la carte du mois de son
-- inscription, et un changement d'aiguillage n'atteindrait plus
-- personne.

create table if not exists public.ai_model_overrides (
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  -- Contraint aux quatre agents de l'itération, exactement comme
  -- `ai_agent_settings` : surcharger le modèle d'un agent qui n'existe
  -- pas est une ligne morte qui donne l'illusion d'un réglage actif.
  agent text not null check (public.ai_is_supported_agent(agent)),

  -- Texte libre. Encore une fois : SQL ne connaît aucun nom de modèle.
  -- La validité de celui-ci se vérifie au démarrage du serveur, contre
  -- la configuration et le contrôle de disponibilité, qui savent dire
  -- « ce modèle n'existe pas » clairement. Une contrainte ici dirait la
  -- même chose au pire moment, et se tromperait la première.
  model text not null,

  -- Pourquoi cette entreprise déroge. Une surcharge sans motif, relue
  -- six mois plus tard, ne se lève jamais : personne n'ose défaire ce
  -- qu'il ne comprend pas.
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  primary key (organization_id, agent)
);

comment on table public.ai_model_overrides is
  'Écarts d''aiguillage posés par une entreprise. Absence de ligne = la carte par défaut du produit, qui vit dans la configuration TypeScript.';

/**
 * Le modèle imposé pour un agent, ou NULL.
 *
 * NULL veut dire « aucune surcharge », donc « prends le défaut du
 * code ». L'appelant ne doit surtout pas transformer ce NULL en un nom
 * de modèle écrit ici : ce serait le deuxième endroit où un identifiant
 * de modèle vivrait.
 *
 * `security invoker` : la RLS suffit. Interrogée sur l'entreprise d'un
 * autre, la fonction rend NULL — le demandeur retombe sur le défaut du
 * produit, ce qui est le comportement sûr, et n'apprend rien de la
 * configuration du voisin.
 */
create or replace function public.ai_model_for_agent(
  p_organization_id uuid,
  p_agent text
)
returns text
language sql
security invoker
stable
set search_path = public
as $$
  select o.model
  from public.ai_model_overrides o
  where o.organization_id = p_organization_id
    and o.agent = p_agent;
$$;

-- ============================================================
-- 5. AI RECOMMENDATION FEEDBACK — 👍 / 👎, et pourquoi
-- ============================================================
-- Spec p. 25.
--
-- CE QUE CETTE TABLE SERT VRAIMENT. Le tableau de bord des modèles
-- (p. 25 : accuracy, cost, latency, tool-use, user-rating) n'a que
-- cette source-là pour la dernière colonne, et c'est la seule des cinq
-- qu'aucune mesure automatique ne remplace. Sans elle, le
-- « DYNAMIC ROUTING FUTUR » de la page 26 — « cette tâche fonctionne
-- aussi bien avec Terra qu'avec Sol » — n'a rien à apprendre.

create table if not exists public.ai_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  decision_id uuid not null,

  -- Deux valeurs, pas trois. « Sans avis » est l'absence de ligne, pas
  -- une ligne à NULL : une ligne posée puis vidée serait indiscernable
  -- d'un pouce jamais donné, et la statistique compterait des avis qui
  -- n'existent pas.
  helpful boolean not null,

  -- « Et éventuellement : Pourquoi ? » (p. 25). Facultatif, et nettoyé
  -- à l'écriture par le déclencheur ci-dessous.
  reason text,

  -- Qui a donné cet avis. `on delete set null` : le départ d'un salarié
  -- efface la personne, pas la statistique du modèle.
  user_id uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- LE CLOISONNEMENT AU DEUXIÈME BOUT, via la clé composite que 0072 a
  -- posée sur `ai_decisions`. La politique RLS vérifie « as-tu le droit
  -- d'écrire chez toi ? » ; sans cette clé, la réponse serait oui et
  -- l'avis se collerait à la décision d'une autre entreprise. C'est la
  -- faille que 0062 a dû réparer ailleurs.
  constraint ai_recommendation_feedback_decision_same_org
    foreign key (decision_id, organization_id)
    references public.ai_decisions (id, organization_id) on delete cascade
);

-- UN AVIS PAR PERSONNE ET PAR DÉCISION. Changer d'avis est un `update`,
-- pas une deuxième ligne : sans cet index, dix clics sur le pouce
-- pèseraient dix fois dans la moyenne.
create unique index if not exists ai_recommendation_feedback_one_per_user_uidx
  on public.ai_recommendation_feedback (decision_id, user_id)
  where user_id is not null;

create index if not exists ai_recommendation_feedback_decision_idx
  on public.ai_recommendation_feedback (decision_id);

/**
 * L'auteur d'un avis est celui qui le donne.
 *
 * `default auth.uid()` ne suffirait pas : un client peut passer la
 * colonne explicitement. Le déclencheur l'IMPOSE, comme
 * `record_audit_event` (0058) impose l'auteur d'une trace. Un avis
 * qu'on peut signer du nom d'un collègue n'est pas une mesure, c'est un
 * bulletin de vote sans isoloir.
 */
create or replace function public.ai_recommendation_feedback_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.reason := public.ai_clean_text(new.reason, 1000);
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_recommendation_feedback_stamp_trg on public.ai_recommendation_feedback;
create trigger ai_recommendation_feedback_stamp_trg
  before insert or update on public.ai_recommendation_feedback
  for each row execute function public.ai_recommendation_feedback_stamp();

-- ============================================================
-- 6. CONTEXT VERSIONING — la colonne manquante d'`ai_decisions`
-- ============================================================
-- Spec p. 21 : « Chaque décision conserve : dataSnapshotTimestamp, afin
-- de savoir sur quelles données elle était basée. » 0072 porte bien
-- `data_sources` (QUOI a été lu) mais pas la DATE d'arrêté de ces
-- données. Les deux sont nécessaires : « les factures impayées » ne dit
-- rien sans « au 3 septembre à 6 h ».
--
-- AJOUT PUREMENT ADDITIF, SANS TOUCHER À 0072. `add column if not
-- exists`, donc rejouable ; NULLABLE et SANS DÉFAUT, pour deux raisons
-- qui vont dans le même sens :
--
--   • Les décisions déjà en base ont été prises sur des données dont
--     nul ne connaît la date d'arrêté. Les remplir avec `now()` — ou
--     même avec leur `created_at` — leur ferait affirmer quelque chose
--     que personne ne sait. Une case vide dit la vérité : on l'ignore.
--
--   • Un `default now()` sur les futures lignes ferait dire à chaque
--     décision que ses données étaient à jour à l'instant de son
--     écriture. C'est faux dès qu'un agent raisonne sur une photo prise
--     quelques minutes plus tôt — c'est-à-dire toujours, et c'est
--     précisément le décalage que la page 21 veut rendre visible.

alter table public.ai_decisions
  add column if not exists data_snapshot_timestamp timestamptz;

comment on column public.ai_decisions.data_snapshot_timestamp is
  'Date d''arrêté des données sur lesquelles la décision a été prise (spec p. 21). NULL = inconnue, ce qui n''est pas « maintenant ».';

/**
 * Dater les données d'une décision.
 *
 * POURQUOI UNE FONCTION PLUTÔT QU'UN PARAMÈTRE DE `ai_open_decision`.
 * Ajouter un paramètre à `ai_open_decision` créerait une SURCHARGE (la
 * signature de 0072 subsiste), et PostgreSQL choisirait alors entre
 * deux fonctions de même nom sur des appels que rien ne distingue —
 * une ambiguïté au pire endroit du produit. 0072 n'est pas modifiée,
 * et l'aiguilleur appelle cette fonction juste après avoir ouvert sa
 * décision.
 *
 * DEUX REFUS, ET ILS DISENT LA MÊME CHOSE : un arrêté est un FAIT, pas
 * un réglage.
 *   • Une date future est impossible : on ne lit pas des données de
 *     demain. Le plus souvent c'est un fuseau mal converti, et une
 *     décision datée du lendemain fausserait toute relecture.
 *   • Une seconde pose est refusée. Redater après coup, c'est réécrire
 *     l'histoire de ce sur quoi on s'est fondé — exactement ce que la
 *     colonne existe pour empêcher.
 *
 * `security invoker` : la RLS d'`ai_decisions` masque la décision d'une
 * autre entreprise, donc elle est introuvable, donc indatable.
 */
create or replace function public.ai_record_decision_snapshot(
  p_decision_id uuid,
  p_data_snapshot_timestamp timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing timestamptz;
  v_found boolean;
begin
  if p_data_snapshot_timestamp is null then
    raise exception 'Date d''arrêté manquante : ne rien écrire vaut mieux qu''écrire « maintenant » par défaut.';
  end if;

  -- Une marge d'une minute absorbe l'écart d'horloge entre le serveur
  -- Next.js et la base ; au-delà, c'est une erreur, pas une dérive.
  if p_data_snapshot_timestamp > now() + interval '1 minute' then
    raise exception 'Date d''arrêté dans le futur (%) : aucune donnée ne vient de demain.',
      p_data_snapshot_timestamp;
  end if;

  select d.data_snapshot_timestamp, true into v_existing, v_found
  from public.ai_decisions d
  where d.id = p_decision_id;

  if not coalesce(v_found, false) then
    raise exception 'Décision introuvable.';
  end if;

  if v_existing is not null then
    raise exception 'Cette décision est déjà datée (%) : un arrêté de données ne se réécrit pas.',
      v_existing;
  end if;

  update public.ai_decisions
     set data_snapshot_timestamp = p_data_snapshot_timestamp,
         updated_at = now()
   where id = p_decision_id;
end;
$$;

-- ============================================================
-- 6 bis. LE RISQUE ÉLEVÉ NE PART PLUS TOUT SEUL
-- ============================================================
-- Spec p. 15-16 : HIGH → « Confirmation ». CRITICAL → « Confirmation
-- forte ». Cet invariant n'était tenu que d'un seul côté du produit.
--
-- ─── CE QUI SE PASSAIT ───
--
-- `OasisActionEngine` (runtime Next.js) interdit bien l'autopilote pour
-- `high` et `critical` : il n'interroge même pas cette fonction. Mais
-- l'écran d'assistant appelle encore la fonction Edge `oasis-pro-ai`,
-- et celle-ci calcule le MÊME relèvement de risque à 20 000 € puis s'en
-- sert uniquement comme ÉTIQUETTE : elle écrit `risk_level = 'high'`
-- dans `ai_actions` et interroge quand même l'autopilote, qui exécute.
--
-- Côté base, rien ne rattrapait : les douze conditions de 0072
-- comparaient le montant au PLAFOND DE LA RÈGLE, jamais à un seuil de
-- risque, et aucune ne lisait `default_risk_level`. Une entreprise
-- réglée au niveau 4 avec un plafond d'autopilote au-dessus de
-- 20 000 € voyait donc partir seule une action classée `high`. Le
-- produit avait deux réponses opposées à la même question, et c'est la
-- mauvaise qui était câblée.
--
-- ─── POURQUOI LA RÈGLE VIT ICI, ET PAS DANS CHAQUE SURFACE ───
--
-- Parce que c'est le seul endroit que les DEUX surfaces rencontrent.
-- Corriger la fonction Edge aurait laissé la prochaine surface
-- recommencer ; corriger ici la ferme pour tout le monde, y compris
-- pour un appelant qu'on n'a pas encore écrit.
-- `RISQUE_ELEVE_AU_DELA_DE_CENTS` (TypeScript) en devient le miroir.
--
-- ─── LE COMPTEUR PASSE DE 12 À 13 ───
--
-- Il n'est pas décoratif : la fonction refuse tout si le nombre de
-- conditions ne colle plus. Retirer la treizième fait donc tomber
-- l'autopilote du côté fermé, ce qui est la bonne panne.
--
-- Le reste de la fonction est repris de 0072 SANS UNE VIRGULE DE
-- CHANGEMENT. On la réécrit en entier parce que PostgreSQL ne sait pas
-- amender un corps de fonction ; la seule différence est la condition
-- `risque_confirmable` et le compteur.

/** Le seuil de la page 15-16, en CENTIMES ENTIERS. 20 000 €. */
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
-- 7. RLS
-- ============================================================
-- Trois régimes, repris de 0072 sans en inventer un quatrième.
--
--   • LA CONFIGURATION — `ai_cost_limits`, `ai_model_overrides` — se lit
--     par tout membre et ne s'écrit qu'avec `organization.manageUsers`.
--     Même raison qu'en 0072 : un salarié a le droit de savoir de quel
--     budget et de quel modèle la machine dispose en son nom ; fixer le
--     budget est un réglage d'entreprise.
--
--   • L'OPÉRATIONNEL — `ai_result_cache`, `ai_recommendation_feedback` —
--     suit le régime des décisions : `projects.read` pour lire. Le
--     cache contient des analyses financières et des devis : il ne
--     doit pas être plus ouvert que ce qu'il met en cache.
--
--   • LE GRAND LIVRE — `ai_usage_events` — se LIT par tout membre et ne
--     s'écrit PAR AUCUNE POLITIQUE, comme `business_events` en 0072.
--     Seule `ai_record_usage_event` y insère. Voir la note de cette
--     fonction : une ligne d'usage forgée creuse le budget d'une
--     entreprise jusqu'à éteindre son IA.
--
-- LE CAS PARTICULIER DE `ai_recommendation_feedback`. Sa politique
-- d'écriture demande `projects.read` — un droit de LECTURE pour une
-- écriture, ce qui mérite d'être justifié : donner son avis sur une
-- recommandation qu'on a le droit de voir n'est pas conduire un
-- chantier, et exiger `projects.manage` réserverait la mesure de
-- qualité aux seuls gestionnaires — c'est-à-dire fausserait
-- l'échantillon en excluant ceux qui utilisent le plus l'outil. Le
-- `user_id = auth.uid()` de la clause `with check` interdit en revanche
-- de signer l'avis d'un autre, et le déclencheur du § 5 l'impose une
-- seconde fois.

do $$
declare t text;
begin
  -- Configuration : membre lit, gestionnaire écrit.
  foreach t in array array['ai_cost_limits', 'ai_model_overrides']
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

-- ------------------------------------------------------------
-- LE CACHE SUIT LE RÉGIME DU GRAND LIVRE, PAS CELUI DES DÉCISIONS
-- ------------------------------------------------------------
-- Il se LIT par tout membre qui a `projects.read`, et il ne s'écrit PAR
-- AUCUNE POLITIQUE : les deux fonctions d'écriture sont `security
-- definer` et vérifient elles-mêmes le droit. C'est le motif déjà
-- retenu pour `ai_record_usage_event` et `emit_business_event`.
--
-- LA VERSION PRÉCÉDENTE DONNAIT L'ÉCRITURE COMPLÈTE À `projects.read`,
-- et c'était une faille, pas une commodité. `projects.read` est la
-- seule permission du rôle `fieldWorker` et fait partie du rôle
-- littéralement nommé `readOnly` : un ouvrier ou un compte de
-- consultation pouvait donc RÉÉCRIRE le contenu d'une réponse d'agent
-- déjà calculée — en laissant l'empreinte et l'expiration intactes —,
-- et c'est ce texte que le dirigeant recevait ensuite comme étant
-- l'avis d'Oasis. `ai_cache_lookup` ne revérifie rien : elle rend la
-- ligne telle quelle. Le même compte pouvait aussi vider le cache de
-- l'entreprise et faire repayer chaque brief.
--
-- Ce n'était pas théorique : la clé du brief de direction est fixe et
-- partagée par tous les lecteurs de l'entreprise, et l'attaque a été
-- jouée en transaction annulée avant d'écrire ces lignes.
--
-- Le régime des décisions, que le commentaire d'origine invoquait, est
-- « lecture `projects.read` / écriture `projects.manage` ». La
-- politique écrite, elle, disait `projects.read` des deux côtés.
alter table public.ai_result_cache enable row level security;

drop policy if exists "Members with projects.read can read ai_result_cache" on public.ai_result_cache;
create policy "Members with projects.read can read ai_result_cache" on public.ai_result_cache
  for select using (public.has_permission(organization_id, 'projects.read'));

-- SUPPRIMÉE, ET LA LIGNE RESTE. Sans ce `drop`, une base où la
-- migration a déjà tourné garderait la politique d'écriture pour
-- toujours : `create policy` est absent, donc rien ne la remplacerait.
drop policy if exists "Members with projects.read can write ai_result_cache" on public.ai_result_cache;

-- Les avis.
alter table public.ai_recommendation_feedback enable row level security;

drop policy if exists "Members with projects.read can read ai_recommendation_feedback"
  on public.ai_recommendation_feedback;
create policy "Members with projects.read can read ai_recommendation_feedback"
  on public.ai_recommendation_feedback
  for select using (public.has_permission(organization_id, 'projects.read'));

drop policy if exists "A member rates only in their own name" on public.ai_recommendation_feedback;
create policy "A member rates only in their own name" on public.ai_recommendation_feedback
  for all
  using (public.has_permission(organization_id, 'projects.read') and user_id = auth.uid())
  with check (public.has_permission(organization_id, 'projects.read') and user_id = auth.uid());

-- Le grand livre : lecture par les membres, écriture par personne.
alter table public.ai_usage_events enable row level security;

drop policy if exists "Members read ai_usage_events" on public.ai_usage_events;
create policy "Members read ai_usage_events" on public.ai_usage_events
  for select using (public.is_organization_member(organization_id));

-- ============================================================
-- 8. LES DROITS D'EXÉCUTION DES FONCTIONS
-- ============================================================
-- Même raisonnement qu'en 0072 § 14 bis : PostgreSQL donne `execute` à
-- `public` par défaut, et Supabase expose toute fonction de `public` en
-- RPC PostgREST. Une fonction `security definer` sans contrôle
-- d'appartenance serait donc un point d'entrée ouvert à la clé anonyme.
--
-- `ai_record_usage_event` est `security definer` mais vérifie
-- `is_organization_member` en première ligne : `anon`, qui n'a pas
-- d'`auth.uid()`, échoue toujours ce contrôle. On lui retire quand même
-- le droit d'appel — une défense qui ne coûte rien, et le jour où
-- quelqu'un déplace ce contrôle, il reste une barrière.
revoke execute on function public.ai_record_usage_event(
  uuid, text, text, int, int, int, boolean, int, bigint, text, text, text, uuid
) from public, anon;
grant execute on function public.ai_record_usage_event(
  uuid, text, text, int, int, int, boolean, int, bigint, text, text, text, uuid
) to authenticated;

-- LES TROIS FONCTIONS DE CACHE sont désormais `security definer` et
-- vérifient `ai_guard(org, 'projects.read')` en première ligne. `anon`
-- n'a pas d'`auth.uid()` et échoue donc toujours ce contrôle — mais on
-- lui retire le droit d'appel quand même, pour la même raison qu'au
-- paragraphe précédent : le jour où quelqu'un déplace le garde, il
-- reste une barrière.
revoke execute on function public.ai_cache_lookup(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.ai_cache_lookup(uuid, text, text, text, text)
  to authenticated;

revoke execute on function public.ai_cache_store(
  uuid, text, text, text, text, jsonb, int, jsonb, timestamptz
) from public, anon;
grant execute on function public.ai_cache_store(
  uuid, text, text, text, text, jsonb, int, jsonb, timestamptz
) to authenticated;

revoke execute on function public.ai_invalidate_result_cache(uuid, text, text)
  from public, anon;
grant execute on function public.ai_invalidate_result_cache(uuid, text, text)
  to authenticated;

-- `ai_purge_expired_result_cache` traverse TOUTES les entreprises et ne
-- peut vérifier l'appartenance de personne : c'est un travail de
-- ménage, pas un travail d'utilisateur. Elle est donc fermée à
-- `authenticated` aussi — seuls le planificateur et les migrations
-- l'appellent.
revoke execute on function public.ai_purge_expired_result_cache()
  from public, anon, authenticated;
grant execute on function public.ai_purge_expired_result_cache() to service_role;

-- ============================================================
-- 9. CE QUI N'EST PAS DANS CE FICHIER, ET POURQUOI
-- ============================================================
-- Ce bloc n'exécute rien. Il est là pour la prochaine personne.
--
--   UNE TABLE DE TARIFS PAR MODÈLE
--       Elle ferait de la base le deuxième endroit qui nomme les
--       modèles, et le premier à être faux : un tarif change sans
--       préavis, et une grille périmée produit des estimations
--       silencieusement fausses. Le serveur estime, la base range, et
--       `cost_basis` dit quelle grille a servi.
--
--   UN DÉCLENCHEUR QUI REFUSE UN APPEL QUAND LE BUDGET EST DÉPASSÉ
--       La base n'est pas l'endroit où l'on décide de ne pas appeler le
--       fournisseur : la décision se prend AVANT l'appel, dans
--       l'AICostControlService, qui interroge
--       `ai_cost_budget_remaining`. Un refus en base arriverait après
--       la dépense — au moment de la journaliser — et perdrait la
--       trace de ce qui a été payé. On enregistre toujours ; on refuse
--       en amont.
--
--   DES DÉCLENCHEURS D'INVALIDATION DE CACHE SUR LES TABLES MÉTIER
--       Longue note au § 3. Ils feraient dépendre l'édition d'un devis
--       du bon état de la couche IA, et seraient silencieusement
--       incomplets. L'empreinte est dans la condition de lecture, donc
--       on ne peut pas oublier de l'appeler.
--
--   UNE LIGNE DE `ai_cost_limits` OU D'`ai_model_overrides` SEMÉE À LA
--   CRÉATION D'UNE ENTREPRISE
--       Un plafond que personne n'a choisi, et une carte de modèles
--       figée au mois de l'inscription. `ai_ensure_org_defaults` (0072)
--       reste donc inchangée.
--
--   UNE RÉTENTION AUTOMATIQUE SUR `ai_usage_events`
--       Le grand livre sert à comparer un mois à l'autre et à
--       rapprocher une facture fournisseur ; le purger à trois mois
--       rendrait le second impossible. Le jour où le volume l'exige,
--       ce sera une agrégation mensuelle en table séparée, pas un
--       `delete`.
