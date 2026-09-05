-- Oasis Care — §11Y, LES SIX AGENTS QUE LA BASE ACCEPTE EN PLUS,
--                     ET LES CINQ FONCTIONS QUI LEUR DONNENT DE QUOI LIRE.
--
-- À exécuter après 0080. (0081 et 0083 sont réservées à d'autres
-- chantiers en cours.) Idempotente et purement additive : elle ne pose
-- aucune table, aucune politique, ne touche à aucune donnée. Elle
-- élargit une liste et crée cinq fonctions de LECTURE.
--
-- ============================================================
-- CE QUE CE FICHIER FAIT, ET POURQUOI LES DEUX MOITIÉS VONT ENSEMBLE
-- ============================================================
--
-- SECTION 1 — la liste des agents que la base accepte passe de quatre
-- à dix.
--
-- SECTION 2 — les cinq fonctions de lecture des quatre agents qui en
-- avaient besoin : `ai_operations_snapshot`, `ai_planning_summary`,
-- `ai_fleet_snapshot`, `ai_fleet_equipment`, `ai_customer_value`.
--
-- LES DEUX MOITIÉS SONT DANS LE MÊME FICHIER PARCE QU'AUCUNE NE VAUT
-- SANS L'AUTRE, et ce n'est pas une commodité de rangement. Élargir la
-- liste sans poser les fonctions donne exactement ce que ce produit
-- vient de payer une fois : un agent joignable, présenté comme prêt, et
-- qui n'a rien à lire — une façade. Poser les fonctions sans élargir la
-- liste donne l'inverse : un agent qui lit très bien et dont la
-- moindre décision est refusée par une contrainte `check`, APRÈS que
-- l'appel de modèle a été payé.
--
-- Le code Next.js déclare ces cinq fonctions dans son registre d'outils
-- (`web-pro/lib/ai/runtime/tools.ts`). Un déploiement du code SANS
-- cette migration donnerait des outils qui appellent des fonctions
-- absentes. CE COMMIT N'EST PAS DÉPLOYABLE SANS ELLE.
--
-- 0072 a posé `ai_is_supported_agent`, la liste fermée des agents que
-- la base reconnaît. Elle en acceptait quatre : `executive`, `finance`,
-- `billing`, `quote_pricing`. Ce n'était pas une limite technique,
-- c'était une décision — la spec p. 49 interdisait de construire les
-- autres tant que les quatre premiers ne tournaient pas, et 0072 l'a
-- rendue MÉCANIQUE plutôt que déclarative : sans nom accepté, pas de
-- ligne dans `ai_agent_settings`, donc pas de niveau 4, donc aucune
-- action possible au nom d'un agent hors périmètre.
--
-- Six agents de plus entrent dans la liste. LES SIX N'ONT PAS LE MÊME
-- ÉTAT, et le dire ici plutôt que de laisser croire à six agents prêts
-- est le seul moyen que ce fichier n'argumente pas contre ce qu'il
-- fait :
--
--   • CINQ ONT UNE SOURCE DE LECTURE À EUX après cette migration —
--     `operations`, `planning`, `nursery`, `fleet`, `customer`. Les
--     quatre premières fonctions sont créées ci-dessous ; la Pépinière,
--     elle, lisait déjà `ai_find_stock` et `ai_forecast_availability`,
--     posées par 0058, et n'avait besoin de rien de neuf.
--
--   • `procurement` RESTE UN GABARIT, et sciemment. Ses trois volets —
--     fournisseurs, commandes, besoins — comptent zéro ligne en
--     production (`suppliers` 0, `purchase_orders` 0), et la seule
--     fonction qui pourrait l'armer, `ai_suggest_purchase_needs`,
--     traverse trois RLS soudées par des `coalesce(..., 0)` : un droit
--     manquant n'y fait pas échouer l'appel, il fait tomber une branche
--     à zéro et produit un faux plausible. Elle n'est donc déclarée
--     par personne. L'agent n'a aucun mot-clé, l'aiguilleur ne le rend
--     jamais, et la route refuse qu'un appelant l'impose.
--
--     POURQUOI L'ADMETTRE QUAND MÊME DANS LA LISTE : il possède déjà
--     une ligne de `ai_action_catalog` (`purchaseOrderSend`) et un
--     outil de proposition au registre (`createPurchaseOrderDraft`).
--     Un nom accepté au catalogue d'actions et refusé au réglage
--     d'autonomie serait une incohérence interne, et l'écran des
--     réglages — qui affiche les dix avec un badge « En construction »
--     — échouerait sur une contrainte au premier curseur déplacé.
--
-- Ce que « avoir une source » veut dire ici est vérifiable et non
-- déclaratif : `sourcesDe(agent)` est déduit du registre d'outils, et
-- `definitions.test.ts` échoue si un agent donné pour achevé n'a rien
-- à lire.
--
-- ============================================================
-- CE QUE CE FICHIER NE FAIT PAS, ET C'EST LE POINT IMPORTANT
-- ============================================================
--
-- QUATRE AGENTS DE LA SPEC N'Y ENTRENT PAS : `sales`, `market`, `risk`,
-- `classification`. Ce n'est pas un oubli, c'est le même raisonnement
-- que 0072, appliqué une seconde fois avec les chiffres d'aujourd'hui :
--
--   • `sales` — le schéma commercial est complet et n'a jamais servi
--     (aucune opportunité, aucune activité, aucun contact) ; et la
--     seule part qui aurait de la matière — les devis sans réponse, les
--     devis qui expirent — est DÉJÀ calculée en SQL par
--     `ai_executive_brief`, et l'action de relance appartient déjà à
--     `quote_pricing` dans `ai_action_catalog`. L'ouvrir fabriquerait
--     un second calcul du même chiffre.
--
--   • `market` — le seul agent dont la spec (p. 16) nomme une source
--     EXTERNE. Cette capacité n'existe pas dans le produit, et aucune
--     table ne pourrait recevoir la source, la date, l'url et la
--     fraîcheur que la même page rend obligatoires.
--
--   • `risk` — la spec ne le décrit nulle part (deux mentions, aucune
--     section). Ses axes plausibles sont soit déjà servis par la
--     Finance et la Facturation, soit incalculables : aucune dépendance
--     entre tâches n'existe dans ce schéma, donc « retard en cascade »
--     n'est pas représentable.
--
--   • `classification` — ce n'est pas un agent : c'est une étape de
--     pré-traitement (p. 31), déjà construite côté serveur. Elle ne
--     décide rien et n'exécute rien ; lui ouvrir `ai_agent_settings` et
--     `ai_autopilot_rules` donnerait un réglage d'autonomie à quelque
--     chose qui n'agit pas.
--
-- Les laisser dehors n'est pas une omission à corriger plus tard sans
-- réfléchir : c'est ce qui empêche de FIXER UN PLAFOND DE COÛT ET DE
-- CHOISIR UN MODÈLE pour un agent qui n'existe pas — une ligne morte
-- qui donne l'illusion d'un réglage actif. Le motif de chacun, et ce
-- qu'il faudrait livrer d'abord, sont écrits dans
-- `web-pro/lib/ai/runtime/agents/sansDonnees.ts`.
--
-- ============================================================
-- LA GRAPHIE, ET LE PIÈGE QU'ELLE CACHE
-- ============================================================
--
-- 0072 écrit `quote_pricing` là où le code écrit `quotePricing`. Les
-- six clés ajoutées ici n'ont, elles, qu'une seule graphie :
-- `operations`, `planning`, `procurement`, `nursery`, `fleet`,
-- `customer` s'écrivent pareil des deux côtés. C'est une chance, pas
-- une règle — et c'est pour cela que la table `CLE_BASE`
-- (`agents/types.ts`) reste écrite explicitement plutôt que calculée,
-- et qu'un test relit CE fichier pour vérifier que les dix valeurs y
-- sont.
--
-- ============================================================
-- POURQUOI ÉLARGIR NE CASSE RIEN
-- ============================================================
--
-- `ai_is_supported_agent` est appelée dans six contraintes `check`
-- (`ai_decisions`, `ai_actions`, `ai_agent_settings`,
-- `ai_action_approvals`, `ai_model_overrides`) et dans le corps de
-- `ai_record_agent_event` et `ai_set_agent_model`. Une contrainte
-- `check` qui devient PLUS PERMISSIVE ne peut invalider aucune ligne
-- existante : PostgreSQL ne la revalide même pas. Le rétrécir, en
-- revanche, casserait — et c'est très bien ainsi, comme 0072 le disait
-- déjà.
--
-- ============================================================
-- AUCUNE ACTION N'EST AJOUTÉE AU CATALOGUE, ET IL FAUT DIRE
-- EXACTEMENT CE QUE CELA VEUT DIRE
-- ============================================================
--
-- Ce produit a DEUX registres d'écriture, et les confondre serait la
-- faute la plus facile de ce fichier. Vérifié en production, table par
-- table, plutôt que déduit :
--
--   • `ai_action_catalog` — ce que le moteur d'actions (0072) peut
--     exécuter, avec sa permission, son éligibilité à l'autopilote et
--     son plafond. Il contient NEUF lignes, réparties sur quatre
--     agents : `billing` (3), `quote_pricing` (4), `executive` (1) et
--     `procurement` (1).
--
--     La ligne `procurement` est `purchaseOrderSend` — « Envoyer une
--     commande fournisseur », `autopilot_eligible = false`. Elle existe
--     pour DÉCLARER un interdit, pas pour promettre un agent : elle a
--     été posée quand aucun agent Achats n'existait. Elle reste telle
--     quelle, et 0082 n'y touche pas — ouvrir l'agent ne change rien à
--     ce que le moteur l'autorise à exécuter.
--
--   • `PROPOSAL_KINDS` (`web-pro/lib/ai/proposals.ts`) — les BROUILLONS
--     qu'un agent prépare et qu'un humain valide d'un bouton. C'est un
--     registre distinct, en TypeScript, et c'est par là que passent
--     `scheduleIntervention` (Planning), `createNurseryLot` et
--     `recordStockMovement` (Pépinière), `createPurchaseOrderDraft`
--     (Achats). Aucun d'eux n'est dans `ai_action_catalog`, et aucun
--     n'a besoin d'y être : ils ne s'exécutent jamais seuls.
--
-- Autrement dit : les six nouveaux agents peuvent PROPOSER, aucun ne
-- gagne le droit d'EXÉCUTER. Un agent sans ligne au catalogue ne peut
-- rien faire partir sans humain, même réglé au niveau 4. C'est le
-- comportement voulu, pas un reste à faire — et c'est ce que le test
-- `supabase/tests/agents_ia.sql` vérifie en comptant les lignes.

-- ============================================================
-- 1. La liste des agents que la base reconnaît
-- ============================================================
-- `create or replace` sur une fonction `immutable` employée dans des
-- contraintes `check` : PostgreSQL l'accepte et les contraintes
-- utilisent la nouvelle définition dès la prochaine écriture. Les
-- lignes déjà écrites ne sont pas relues, et elles n'ont pas à l'être
-- puisque les quatre anciennes valeurs sont toutes conservées.

create or replace function public.ai_is_supported_agent(p_agent text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_agent in (
    -- Les quatre de 0072. AUCUNE n'est retirée : une valeur enlevée ici
    -- ferait échouer la prochaine écriture sur une ligne parfaitement
    -- valide, et l'erreur parlerait d'une contrainte, pas d'un agent.
    'executive',
    'finance',
    'billing',
    'quote_pricing',
    -- Les six de §11Y. Même graphie qu'en TypeScript, contrairement à
    -- `quote_pricing` : voir l'en-tête.
    'operations',
    'planning',
    'procurement',
    'nursery',
    'fleet',
    'customer'
  );
$$;

comment on function public.ai_is_supported_agent(text) is
  'Les dix agents construits (0072 + 0082). Sales, Market, Risk et Classification en sont volontairement absents : aucune donnée derrière eux, et un agent surchargeable qui n''existe pas est une ligne morte qui a l''air d''un réglage. Motifs dans web-pro/lib/ai/runtime/agents/sansDonnees.ts.';


-- ============================================================
-- 2. LES CINQ FONCTIONS DE LECTURE DES QUATRE AGENTS OUTILLÉS
-- ============================================================
--
-- Elles sont toutes `stable` et `security invoker` : elles ne peuvent
-- rien écrire, et la RLS de l'appelant s'applique par-dessus. Chacune
-- ouvre sur `perform public.ai_guard(..., '<droit>')`, qui LÈVE — le
-- refus est donc une exception nommée et non une vue partielle. C'est
-- la règle que ce produit a dû réapprendre quatre fois : « zéro » et
-- « je n'ai pas le droit de voir » sont deux réponses opposées, et
-- celle qui ment est la première.
--
-- Aucune ne prend l'organisation d'un paramètre choisi par le modèle :
-- soit l'exécuteur l'injecte depuis la SESSION
-- (`injecteOrganisation: true` dans `tools.ts`), soit la fonction la
-- relit sur la ligne de l'entité (`ai_customer_value`,
-- `ai_fleet_equipment`).
--
-- Chaque corps est recopié TEL QUEL du fichier de son agent
-- (`web-pro/lib/ai/runtime/outils/<agent>.sql`), où il a été écrit et
-- éprouvé. Les tests correspondants sont dans
-- `supabase/tests/agents_ia.sql`.



-- ------------------------------------------------------------
-- Oasis Care — §11Y, LA VUE DE PARC DE L'AGENT CHANTIERS.
-- ============================================================
-- POURQUOI CETTE FONCTION EXISTE ALORS QUE `ai_get_project_context`
-- EST DÉJÀ LÀ
-- ============================================================
--
-- `ai_get_project_context` exige un identifiant de chantier. Le fil de
-- discussion (`/oasis-ai/conversations`) n'en transmet AUCUN : il
-- envoie une phrase et rien d'autre. L'agent Chantiers part donc
-- aveugle à chaque question, et « quels chantiers ai-je en cours ? »
-- n'a, aujourd'hui, aucune fonction capable d'y répondre.
--
-- Cette fonction est cette réponse-là, et rien de plus : le PARC, pas
-- la fiche. Dès qu'un chantier est désigné, `ai_get_project_context`
-- reste la bonne source et celle-ci n'a plus rien à ajouter.
--
-- ============================================================
-- CE QU'ELLE NE REND PAS, ET POURQUOI CHAQUE ABSENCE EST UN CHOIX
-- ============================================================
--
--   • AUCUN MONTANT DE VENTE, AUCUN COÛT MATIÈRE, AUCUNE MARGE.
--     `analyze_project_margin` (agent Finance) les rend déjà, chantier
--     par chantier. Les redonner ici ferait deux calculs du même
--     chiffre, donc deux chiffres différents le jour où l'un des deux
--     bouge. L'agent Chantiers parle de TEMPS et d'AVANCEMENT ; l'argent
--     appartient à la Finance, et ses limites le lui disent.
--
--   • AUCUN « ÉCART DE COÛT ». La vue `project_cost_summary` rend bien
--     `variance_cents`, et elle serait un piège ici : son
--     `planned_cents` vient de `project_resources`, où AUCUNE ligne
--     n'est de la main-d'œuvre. Le prévu de main-d'œuvre y vaut donc
--     zéro, l'écart vaut la totalité du réel, et la fonction
--     annoncerait un dérapage de 100 % sur un budget que personne n'a
--     jamais saisi. « Prévu à zéro » et « non prévu » ne sont pas la
--     même chose : c'est la confusion que ce produit a déjà corrigée
--     quatre fois, et on ne l'introduit pas une cinquième.
--
--   • AUCUNE HEURE PRÉVUE. `project_tasks.planned_hours` est la seule
--     colonne d'heures prévues du schéma et la table est vide. La
--     fonction rend le COMPTE de ces lignes plutôt qu'un silence : à
--     zéro, l'agent sait qu'il doit refuser « a-t-on passé plus de
--     temps que prévu ? » ; le jour où la table se remplit, le même
--     compteur cesse de le lui dire.
--
-- ============================================================
-- LE PIÈGE PRINCIPAL : « ZÉRO EN RETARD » N'EST PAS « PAS DE RETARD »
-- ============================================================
--
-- `ai_get_daily_priorities` calcule déjà « chantiersEnRetard » avec
-- `planned_end_on < today`. Comme AUCUN chantier ni aucune phase ne
-- porte de date de fin prévue, elle rend une liste vide — et une liste
-- vide se lit « tout va bien ». C'est faux : elle veut dire « je n'ai
-- aucune date de référence ».
--
-- Le bloc `retard` de cette fonction est construit pour rendre cette
-- confusion IMPOSSIBLE :
--
--   • `enRetard` vaut NULL, jamais zéro, quand aucun chantier ouvert ne
--     porte de date de fin. Un nombre absent se voit ; un zéro ment.
--   • `couverture` compte, sur TOUT le portefeuille et pas seulement
--     sur l'ouvert, combien de chantiers et combien de phases portent
--     une date de fin prévue. C'est ce qui permet à l'agent de dire
--     « 0 chantier sur 1 et 0 phase sur 5 » plutôt que « je ne sais
--     pas ».
--   • `motif` porte la phrase en français, produite par le SQL et non
--     par le modèle.
--
-- ============================================================
-- L'ORGANISATION, LES DROITS, LES BORNES
-- ============================================================
--
-- `p_organization_id` est posé par l'EXÉCUTEUR (`injecteOrganisation`),
-- jamais par le modèle : aucun schéma Zod ne l'expose. `ai_guard` la
-- revérifie côté serveur — appartenance ET droit `projects.read` — et
-- lève plutôt que de rendre une vue partielle. `security invoker` laisse
-- en plus la RLS filtrer : les deux barrières, pas l'une ou l'autre.
--
-- Les tableaux sont bornés à 50 lignes et le dépassement est ANNONCÉ
-- (`tronque`), parce qu'un tableau coupé en silence fait compter le
-- modèle sur un sous-ensemble qu'il croit complet.

create or replace function public.ai_operations_snapshot(
  p_organization_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c_max constant int := 50;   -- le plafond de chaque tableau rendu

  v_today date;
  v_from  date;
  v_to    date;

  -- Le retard, et sa mesurabilité.
  v_ouverts            int;
  v_ouverts_avec_fin   int;
  v_en_retard          int;
  v_chantiers_total    int;
  v_chantiers_avec_fin int;
  v_phases_total       int;
  v_phases_avec_fin    int;
  v_motif_retard       text;

  -- Les tableaux et leurs totaux réels (pour dire la troncature).
  v_chantiers      jsonb;
  v_chantiers_vus  int;
  v_iv             jsonb;
  v_iv_vues        int;
  v_iv_total       int;
  v_iv_sans_duree  int;
  v_pointages      jsonb;
  v_pointages_vus  int;
  v_pointages_tot  int;
  v_heures_attente numeric;

  -- Ce que le schéma ne peut pas dire, compté plutôt que supposé.
  v_taches_prevues int;
  v_salaries_actifs int;
  v_equipes int;
  v_appartenances int;
begin
  -- Le droit de base de tout l'opérationnel de l'IA (0072, 0073).
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_today := (now() at time zone 'Europe/Paris')::date;
  v_from  := coalesce(p_from, v_today - 30);
  v_to    := coalesce(p_to,   v_today + 30);

  if v_to < v_from then
    raise exception 'Période inversée : du % au %.', v_from, v_to;
  end if;
  -- Une fenêtre non bornée ferait sortir de l'entreprise l'historique
  -- complet des interventions à chaque question.
  if (v_to - v_from) > 366 then
    raise exception 'Fenêtre trop large : % jours, 366 au plus.', v_to - v_from;
  end if;

  -- ---------- LE RETARD, ET CE QUI LE REND MESURABLE ----------
  select count(*)::int,
         count(*) filter (where p.planned_end_on is not null)::int,
         count(*) filter (where p.planned_end_on is not null and p.planned_end_on < v_today)::int
    into v_ouverts, v_ouverts_avec_fin, v_en_retard
  from public.projects p
  where p.organization_id = p_organization_id
    and p.archived_at is null
    and p.status in ('planned', 'inProgress', 'onHold');

  select count(*)::int, count(*) filter (where p.planned_end_on is not null)::int
    into v_chantiers_total, v_chantiers_avec_fin
  from public.projects p
  where p.organization_id = p_organization_id and p.archived_at is null;

  select count(*)::int, count(*) filter (where ph.planned_end_on is not null)::int
    into v_phases_total, v_phases_avec_fin
  from public.project_phases ph
  where ph.organization_id = p_organization_id;

  -- LA RÈGLE, EN UNE LIGNE : sans date de référence, le compteur est
  -- NULL et le motif dit pourquoi. Avec des chantiers ouverts qui ont
  -- tous une date, le compteur est un fait. Zéro chantier ouvert donne
  -- bien zéro en retard — c'est vrai et vérifiable, ce n'est pas une
  -- ignorance déguisée.
  if v_ouverts = 0 then
    v_en_retard := 0;
    v_motif_retard := 'Aucun chantier ouvert : rien ne peut être en retard aujourd''hui.';
  elsif v_ouverts_avec_fin = 0 then
    v_en_retard := null;
    v_motif_retard := format(
      'Le retard n''est pas mesurable : aucun de vos %s chantiers ouverts ne porte de date de '
      || 'fin prévue. Une liste vide voudrait dire « aucune référence », pas « aucun retard ».',
      v_ouverts);
  elsif v_ouverts_avec_fin < v_ouverts then
    v_motif_retard := format(
      'Compté sur %s chantiers ouverts sur %s : les %s autres ne portent pas de date de fin '
      || 'prévue et sont hors du calcul.',
      v_ouverts_avec_fin, v_ouverts, v_ouverts - v_ouverts_avec_fin);
  else
    v_motif_retard := null;
  end if;

  -- ET LA COUVERTURE S'AJOUTE AU MOTIF, MÊME QUAND RIEN N'EST OUVERT.
  -- « Aucun chantier ouvert » est vrai aujourd'hui et ne dit RIEN de la
  -- question posée : le dirigeant qui demande « suis-je en retard ? »
  -- doit apprendre, dans la même phrase, que ce produit ne saura pas lui
  -- répondre le jour où un chantier sera ouvert. Sinon il l'apprendra
  -- par une liste vide, qui se lit « tout va bien ».
  if v_chantiers_avec_fin < v_chantiers_total or v_phases_avec_fin < v_phases_total then
    v_motif_retard := concat_ws(' ', v_motif_retard, format(
      'Sur l''ensemble du portefeuille, %s chantier(s) sur %s et %s phase(s) sur %s portent une '
      || 'date de fin prévue : renseignez-la pour qu''un retard devienne mesurable.',
      v_chantiers_avec_fin, v_chantiers_total, v_phases_avec_fin, v_phases_total));
  end if;

  -- ---------- LES CHANTIERS OUVERTS ----------
  -- Temps et avancement seulement : voir l'en-tête sur l'argent.
  select coalesce(jsonb_agg(s.ligne order by s.rang), '[]'::jsonb), count(*)::int
    into v_chantiers, v_chantiers_vus
  from (
    select
      row_number() over (order by p.planned_end_on nulls last, p.number) as rang,
      jsonb_build_object(
        'id', p.id,
        'numero', p.number,
        'nom', p.name,
        'statut', p.status,
        'debutPrevu', p.planned_start_on,
        'finPrevue', p.planned_end_on,
        'debutReel', p.actual_start_on,
        'phasesNombre', ph.nb,
        'phasesTerminees', ph.faites,
        'phasesAvecDateDeFin', ph.avec_fin,
        -- La moyenne d'avancement est NULL quand il n'y a aucune phase :
        -- un chantier sans découpage n'est pas un chantier à 0 %.
        'avancementMoyenPct', ph.moyenne,
        'heuresValidees', l.validated_hours,
        'heuresEnAttente', l.pending_hours,
        'mainOeuvreValideeCents', l.validated_cents,
        'mainOeuvreEnAttenteCents', l.pending_cents,
        'interventionsPosees', iv.nb,
        'interventionsAVenir', iv.a_venir
      ) as ligne
    from public.projects p
    left join lateral (
      select count(*)::int as nb,
             count(*) filter (where pp.status = 'done')::int as faites,
             count(*) filter (where pp.planned_end_on is not null)::int as avec_fin,
             case when count(*) = 0 then null
                  else round(avg(pp.progress_percent))::int end as moyenne
      from public.project_phases pp
      where pp.project_id = p.id
    ) ph on true
    left join public.project_labor_from_time l on l.project_id = p.id
    left join lateral (
      select count(*)::int as nb,
             count(*) filter (where fi.scheduled_start >= now())::int as a_venir
      from public.field_interventions fi
      where fi.project_id = p.id and fi.status <> 'cancelled'
    ) iv on true
    where p.organization_id = p_organization_id
      and p.archived_at is null
      and p.status in ('planned', 'inProgress', 'onHold')
    order by p.planned_end_on nulls last, p.number
    limit c_max
  ) s;

  -- ---------- LES INTERVENTIONS DE LA FENÊTRE, ET LEUR ÉCART ----------
  -- `ecartFinHeures` est la SEULE soustraction de cette fonction, et
  -- elle est faite ici précisément pour que le modèle ne la fasse pas :
  -- « heures » est l'une des huit grandeurs de la frontière
  -- déterministe (p. 11-12).
  select count(*)::int,
         count(*) filter (where fi.actual_start is null or fi.actual_end is null)::int
    into v_iv_total, v_iv_sans_duree
  from public.field_interventions fi
  where fi.organization_id = p_organization_id
    and fi.scheduled_start is not null
    and (fi.scheduled_start at time zone 'Europe/Paris')::date between v_from and v_to;

  select coalesce(jsonb_agg(s.ligne order by s.rang), '[]'::jsonb), count(*)::int
    into v_iv, v_iv_vues
  from (
    select
      row_number() over (order by fi.scheduled_start) as rang,
      jsonb_build_object(
        'id', fi.id,
        'titre', fi.title,
        'statut', fi.status,
        'nature', fi.kind,
        'chantier', pr.number,
        'equipe', t.name,
        'debutPrevu', fi.scheduled_start,
        'finPrevue', fi.scheduled_end,
        'debutReel', fi.actual_start,
        'finReelle', fi.actual_end,
        -- NULL, jamais zéro, quand l'une des deux bornes manque.
        'ecartFinHeures', case
          when fi.scheduled_end is not null and fi.actual_end is not null
          then round((extract(epoch from (fi.actual_end - fi.scheduled_end)) / 3600)::numeric, 2)
        end,
        -- « Combien de temps a-t-elle réellement duré » n'est pas
        -- « quand s'est-elle terminée ». Sans début réel, la durée
        -- travaillée est inconnue, et l'agent doit le dire.
        'dureeReelleConnue', (fi.actual_start is not null and fi.actual_end is not null)
      ) as ligne
    from public.field_interventions fi
    left join public.projects pr on pr.id = fi.project_id
    left join public.teams t on t.id = fi.team_id
    where fi.organization_id = p_organization_id
      and fi.scheduled_start is not null
      and (fi.scheduled_start at time zone 'Europe/Paris')::date between v_from and v_to
    order by fi.scheduled_start
    limit c_max
  ) s;

  -- ---------- LES POINTAGES EN ATTENTE DE VALIDATION ----------
  -- NON BORNÉS PAR LA FENÊTRE, à dessein : un pointage oublié depuis
  -- six mois est exactement celui qu'il faut voir, et une fenêtre le
  -- masquerait au moment où il devient un problème.
  select count(*)::int, coalesce(sum(t.heures), 0)::numeric(10, 2)
    into v_pointages_tot, v_heures_attente
  from (
    select te.project_id, sum(te.hours) as heures
    from public.time_entries te
    where te.organization_id = p_organization_id and not te.validated
    group by te.project_id
  ) t;

  select coalesce(jsonb_agg(s.ligne order by s.rang), '[]'::jsonb), count(*)::int
    into v_pointages, v_pointages_vus
  from (
    select
      row_number() over (order by min(te.worked_on)) as rang,
      jsonb_build_object(
        'chantierId', te.project_id,
        'chantier', max(pr.number),
        'nombre', count(*)::int,
        'heures', sum(te.hours),
        'plusAncien', min(te.worked_on)
      ) as ligne
    from public.time_entries te
    left join public.projects pr on pr.id = te.project_id
    where te.organization_id = p_organization_id and not te.validated
    group by te.project_id
    order by min(te.worked_on)
    limit c_max
  ) s;

  -- ---------- CE QUE LE SCHÉMA NE SAIT PAS DIRE ----------
  -- Compté, jamais supposé : le jour où l'une de ces tables se remplit,
  -- la phrase d'indisponibilité disparaît d'elle-même.
  select count(*)::int into v_taches_prevues
  from public.project_tasks pt
  where pt.organization_id = p_organization_id and pt.planned_hours is not null;

  select count(*)::int into v_salaries_actifs
  from public.employees e
  where e.organization_id = p_organization_id and e.archived_at is null;

  select count(*)::int into v_equipes
  from public.teams t
  where t.organization_id = p_organization_id and t.archived_at is null;

  select count(*)::int into v_appartenances
  from public.team_members tm
  where tm.organization_id = p_organization_id;

  return jsonb_build_object(
    'agent', 'operations',
    'organisationId', p_organization_id,
    'periode', jsonb_build_object('du', v_from, 'au', v_to, 'aujourdhuiParis', v_today),
    -- `ai_guard` a déjà levé si `projects.read` manquait : il n'y a pas
    -- de vue partielle possible ici, donc pas de droit à nommer.
    'droitsManquants', '[]'::jsonb,
    'confiance', case
      when v_ouverts = 0 and v_iv_total = 0 then 'insufficient_data'
      else 'high'
    end,

    'chantiers', v_chantiers,
    'chantiersOuverts', v_ouverts,
    'chantiersTronque', v_ouverts > v_chantiers_vus,

    'retard', jsonb_build_object(
      'enRetard', v_en_retard,
      'chantiersOuverts', v_ouverts,
      'chantiersOuvertsAvecDateDeFin', v_ouverts_avec_fin,
      'motif', v_motif_retard,
      'couverture', jsonb_build_object(
        'chantiers', v_chantiers_total,
        'chantiersAvecDateDeFin', v_chantiers_avec_fin,
        'phases', v_phases_total,
        'phasesAvecDateDeFin', v_phases_avec_fin
      )
    ),

    'interventions', v_iv,
    'interventionsNombre', v_iv_total,
    'interventionsTronque', v_iv_total > v_iv_vues,
    'interventionsSansDureeReelle', v_iv_sans_duree,

    'pointagesEnAttente', v_pointages,
    'pointagesEnAttenteChantiers', v_pointages_tot,
    'pointagesEnAttenteTronque', v_pointages_tot > v_pointages_vus,
    'heuresEnAttenteTotal', v_heures_attente,

    -- LES REFUS, PORTÉS PAR LA FONCTION ET NON PAR LA MÉMOIRE DU MODÈLE.
    -- Une consigne dans le prompt s'oublie sous la pression d'une
    -- question insistante ; une clé présente dans la donnée, non.
    'nonMesurable', jsonb_build_object(
      'tempsPrevu', case when v_taches_prevues = 0 then
        'Aucune heure prévue n''existe : `project_tasks.planned_hours` est la seule colonne '
        || 'd''heures prévues du schéma et elle ne porte aucune ligne. La dérive d''heures est '
        || 'impossible, pas seulement vide.' end,
      'capacite', case when v_salaries_actifs = 0 or v_appartenances < v_equipes then
        format('La capacité n''est pas déductible : %s salarié(s) actif(s), %s appartenance(s) '
          || 'd''équipe pour %s équipe(s). Un effectif rendu ici serait faux.',
          v_salaries_actifs, v_appartenances, v_equipes) end,
      'materiel',
        'La disponibilité du matériel appartient à l''agent Matériel et n''est pas lue ici.',
      'tempsDeDeplacement',
        'Aucun distancier dans ce produit : ni distance ni temps de trajet ne sont calculés.',
      'argent',
        'Marge, vendu et coûts appartiennent à l''agent Finance (`ai_analyze_project_margin`) '
        || 'et ne sont volontairement pas rendus ici : deux calculs du même chiffre finissent '
        || 'par en donner deux différents.'
    )
  );
end;
$$;

comment on function public.ai_operations_snapshot(uuid, date, date) is
  'Agent Chantiers : parc des chantiers ouverts (avancement, heures pointées), écart '
  'prévu/réel des interventions d''une fenêtre, pointages en attente. Le retard est rendu '
  'NULL et motivé quand aucune date de fin prévue n''existe — jamais zéro.';


-- ------------------------------------------------------------
-- Oasis Care — §11Y, LA SYNTHÈSE DE PLANNING DE L'AGENT PLANNING.
-- ============================================================
-- LE PIÈGE QUI DÉCIDE DE LA QUALITÉ DE CETTE FONCTION
-- ============================================================
--
-- `scheduled_end - scheduled_start` N'EST PAS DES HEURES TRAVAILLÉES.
--
-- L'intervention réelle n° 1 de ce produit va du 24 août 12 h au 27 août
-- 10 h : SOIXANTE-DIX heures d'amplitude, quand les pointages du même
-- chantier valent 8 h par jour. Une fonction naïve ferait donc dire à
-- l'agent le triple de la vérité — et le contredirait à l'écran, où
-- `lib/field/types.ts` (`chargeDuJour`) affiche déjà le bon chiffre.
--
-- Cette règle a été arbitrée une fois, en TypeScript, après un bug réel :
-- « le mardi s'annonçait 2 · 32 h : faux d'un facteur trois ». Le modèle
-- ne peut pas appeler du TypeScript. Elle est donc PORTÉE UNE SECONDE
-- FOIS ici, mot pour mot, avec le précédent assumé de 0058 (la géométrie
-- du plan, portée deux fois pour la même raison) :
--
--   • Un chantier qui court sur PLUSIEURS JOURS ne compte pour AUCUNE
--     heure sur aucun de ses jours — pas même les jours de bord. Le
--     recouvrement calendaire d'un jour intermédiaire vaut vingt-quatre
--     heures, et personne ne travaille de minuit à minuit. Borner à une
--     amplitude ouvrée arbitraire (7 h – 19 h) produirait un autre
--     chiffre inventé, qui contredirait la durée écrite sur la carte.
--
--   • L'heure inconnue vaut NULL, JAMAIS ZÉRO. « On ne sait pas combien
--     d'heures de ce chantier tombent ce jour-là » et « ce jour-là ne
--     dure rien » sont deux affirmations différentes.
--
--   • Le drapeau `incomplet` accompagne tout total auquel une carte
--     manque : le nombre lu est alors un MINORANT, et il se dit.
--
-- Le champ s'appelle `heuresConnues` et pas `heuresTravaillees`. Le nom
-- fait la moitié du travail : un modèle qui lit `heuresTravaillees`
-- additionnera des amplitudes sans se poser de question.
--
-- ============================================================
-- CE QUE CETTE FONCTION NE DIRA JAMAIS, ET POURQUOI ELLE LE DIT
-- ============================================================
--
-- Vérifié sur `information_schema` : il n'existe dans ce schéma AUCUNE
-- table dont le nom contienne absence, conge, leave, holiday, availab ni
-- shift. Congés, jours fériés, arrêts et disponibilité n'existent pas.
--
-- « Rien n'est posé jeudi » et « l'équipe est libre jeudi » sont deux
-- phrases différentes, et la seconde est un mensonge. Le bloc
-- `nonMesurable` porte ce refus DANS LA DONNÉE plutôt que dans le
-- prompt : une consigne de prompt cède sous une question insistante,
-- une clé présente dans la réponse de l'outil, non.
--
-- Deuxième trou : `employees` n'a pas d'heures contractuelles (seulement
-- `hourly_cost_cents`). Il n'y a donc pas de DÉNOMINATEUR de capacité :
-- « surcharge » est incalculable, seul « heures posées » l'est.
--
-- Troisième trou, déjà nommé par le dépôt : pas de distancier
-- (`getTravelEstimate`, état « absent »).
--
-- ============================================================
-- L'ORGANISATION, LES DROITS, LES BORNES
-- ============================================================
--
-- `p_organization_id` est posé par l'EXÉCUTEUR, jamais par le modèle.
-- `ai_guard` revérifie appartenance et droit `projects.read` côté
-- serveur ; `security invoker` laisse en plus la RLS filtrer.
--
-- La fenêtre vaut 7 jours par défaut et 31 au plus : au-delà, la sortie
-- cesse d'être une synthèse et devient un export.

create or replace function public.ai_planning_summary(
  p_organization_id uuid,
  p_from date default null,
  p_days int default 7
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c_jours_max constant int := 31;

  v_today date;
  v_from  date;
  v_days  int;
  v_to    date;

  v_jours          jsonb;
  v_chevauchements jsonb;
  v_sans_equipe    jsonb;
  v_sans_debut     int;
  v_equipes        jsonb;
  v_posees         int;
  v_competences    int;
begin
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_today := (now() at time zone 'Europe/Paris')::date;
  v_from  := coalesce(p_from, v_today);
  -- Borné des deux côtés : `p_days = 0` rendrait une fenêtre vide sans
  -- rien dire, et `p_days = 400` un export.
  v_days  := least(greatest(coalesce(p_days, 7), 1), c_jours_max);
  v_to    := v_from + (v_days - 1);

  -- ---------- LA CHARGE POSÉE, JOUR PAR JOUR ET ÉQUIPE PAR ÉQUIPE ----------
  with fenetre as (
    select generate_series(v_from, v_to, interval '1 day')::date as jour
  ),
  posees as (
    select
      fi.id, fi.title, fi.status, fi.kind, fi.team_id,
      fi.scheduled_start, fi.scheduled_end,
      (fi.scheduled_start at time zone 'Europe/Paris')::date as premier,
      -- LA FIN EST EXCLUSIVE, comme à l'écran : un chantier qui s'arrête
      -- le jeudi à minuit pile s'arrête mercredi soir et n'occupe pas le
      -- jeudi. D'où la milliseconde retirée — elle vaut une colonne.
      case
        when fi.scheduled_end is not null and fi.scheduled_end > fi.scheduled_start
        then ((fi.scheduled_end - interval '1 millisecond') at time zone 'Europe/Paris')::date
        else (fi.scheduled_start at time zone 'Europe/Paris')::date
      end as dernier
    from public.field_interventions fi
    where fi.organization_id = p_organization_id
      and fi.status <> 'cancelled'
      and fi.scheduled_start is not null
  ),
  cartes as (
    select
      f.jour,
      p.id, p.title, p.team_id, p.scheduled_start, p.scheduled_end,
      (p.dernier - p.premier + 1) as nb_jours,
      -- ═══ LA RÈGLE DE `chargeDuJour`, PORTÉE MOT POUR MOT ═══
      case
        -- Plusieurs jours : aucune heure sur AUCUN de ses jours.
        when (p.dernier - p.premier + 1) > 1 then null
        -- Pas de fin, ou fin avant début : durée inconnue.
        when p.scheduled_end is null or p.scheduled_end <= p.scheduled_start then null
        else (
          select case
            when z.secondes <= 0 then null
            -- Au quart d'heure, comme `overlapHours`. Le cast borne
            -- l'échelle : sans lui « 8 » ressort en « 8.0000000000000000 »,
            -- et un modèle recopie volontiers une précision qui n'existe
            -- pas.
            else (round((z.secondes / 3600.0) * 4) / 4)::numeric(8, 2)
          end
          from (
            select extract(epoch from (
              least(p.scheduled_end,   ((f.jour + 1)::timestamp at time zone 'Europe/Paris'))
            - greatest(p.scheduled_start, (f.jour::timestamp at time zone 'Europe/Paris'))
            ))::numeric as secondes
          ) z
        )
      end as heures
    from posees p
    join fenetre f on f.jour between p.premier and p.dernier
  ),
  par_equipe as (
    select
      c.jour,
      c.team_id,
      count(*)::int as nb,
      -- `count(heures)` ne compte que les non-nuls : zéro carte chiffrée
      -- rend NULL, jamais 0.
      case when count(c.heures) = 0 then null else sum(c.heures)::numeric(8, 2) end as heures_connues,
      bool_or(c.heures is null) as incomplet,
      jsonb_agg(jsonb_build_object(
        'id', c.id, 'titre', c.title,
        'debut', c.scheduled_start, 'fin', c.scheduled_end,
        'joursCouverts', c.nb_jours,
        'heuresCeJour', c.heures
      ) order by c.scheduled_start) as detail
    from cartes c
    group by c.jour, c.team_id
  )
  select coalesce(jsonb_agg(x.ligne order by x.jour), '[]'::jsonb)
    into v_jours
  from (
    select
      f.jour,
      jsonb_build_object(
        'jour', f.jour,
        'equipes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'equipeId', pe.team_id,
            'equipe', coalesce(t.name, 'sans équipe'),
            'interventions', pe.nb,
            'heuresConnues', pe.heures_connues,
            'incomplet', pe.incomplet,
            'detail', pe.detail
          ) order by coalesce(t.name, 'zzz'))
          from par_equipe pe
          left join public.teams t on t.id = pe.team_id
          where pe.jour = f.jour
        ), '[]'::jsonb),
        'notes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'equipeId', n.team_id,
            'equipe', tn.name,
            'texte', n.body
          ) order by n.created_at)
          from public.planning_day_notes n
          left join public.teams tn on tn.id = n.team_id
          where n.organization_id = p_organization_id and n.day = f.jour
        ), '[]'::jsonb)
      ) as ligne
    from fenetre f
  ) x;

  -- ---------- LES CHEVAUCHEMENTS SUR UNE MÊME ÉQUIPE ----------
  -- Deux interventions posées en même temps sur la même équipe, c'est
  -- du travail que quelqu'un devra déplacer. C'est le SEUL conflit que
  -- ce schéma permet de détecter : sans absence ni capacité, « trop de
  -- travail » ne se calcule pas, « au même moment » si.
  select coalesce(jsonb_agg(jsonb_build_object(
           'equipeId', a.team_id,
           'equipe', t.name,
           'premiere', jsonb_build_object('id', a.id, 'titre', a.title,
                                          'debut', a.scheduled_start, 'fin', a.scheduled_end),
           'seconde',  jsonb_build_object('id', b.id, 'titre', b.title,
                                          'debut', b.scheduled_start, 'fin', b.scheduled_end)
         ) order by a.scheduled_start), '[]'::jsonb)
    into v_chevauchements
  from public.field_interventions a
  join public.field_interventions b
    on b.organization_id = a.organization_id
   and b.team_id = a.team_id
   -- LA COMPARAISON DE LIGNES FAIT DEUX CHOSES D'UN COUP : chaque paire
   -- n'apparaît qu'une fois, et `a` est toujours la PLUS ANCIENNE des
   -- deux. Un `b.id > a.id` aurait ordonné les paires par UUID, et
   -- « premiere » aurait désigné, une fois sur deux, celle qui commence
   -- en dernier — une inversion que personne ne relit dans un JSON.
   and (a.scheduled_start, a.id) < (b.scheduled_start, b.id)
   and b.status <> 'cancelled'
   and b.scheduled_start is not null and b.scheduled_end is not null
   and tstzrange(a.scheduled_start, a.scheduled_end)
       && tstzrange(b.scheduled_start, b.scheduled_end)
  left join public.teams t on t.id = a.team_id
  where a.organization_id = p_organization_id
    and a.team_id is not null
    and a.status <> 'cancelled'
    and a.scheduled_start is not null and a.scheduled_end is not null
    -- Au moins l'une des deux doit toucher la fenêtre demandée.
    and (a.scheduled_start, a.scheduled_end)
        overlaps (v_from::timestamp at time zone 'Europe/Paris',
                  (v_to + 1)::timestamp at time zone 'Europe/Paris');

  -- ---------- CE QUE PERSONNE N'A PRIS ----------
  -- Une intervention sans équipe est du travail posé que personne ne
  -- fera. Elle disparaît d'un total par équipe : il faut donc la NOMMER,
  -- pas l'oublier.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fi.id, 'titre', fi.title,
           'debut', fi.scheduled_start, 'fin', fi.scheduled_end
         ) order by fi.scheduled_start), '[]'::jsonb)
    into v_sans_equipe
  from public.field_interventions fi
  where fi.organization_id = p_organization_id
    and fi.team_id is null
    and fi.status <> 'cancelled'
    and fi.scheduled_start is not null
    and (fi.scheduled_start at time zone 'Europe/Paris')::date between v_from and v_to;

  -- Sans date de début, l'écran ne l'affiche NULLE PART : elle n'occupe
  -- aucune colonne. C'est le seul travail qu'on peut perdre de vue
  -- entièrement, et il se compte sur toute l'entreprise, pas sur la
  -- fenêtre — une fenêtre ne peut pas contenir ce qui n'a pas de date.
  select count(*)::int into v_sans_debut
  from public.field_interventions fi
  where fi.organization_id = p_organization_id
    and fi.status <> 'cancelled'
    and fi.scheduled_start is null;

  select count(*)::int into v_posees
  from public.field_interventions fi
  where fi.organization_id = p_organization_id
    and fi.status <> 'cancelled'
    and fi.scheduled_start is not null
    and (fi.scheduled_start at time zone 'Europe/Paris')::date between v_from and v_to;

  -- ---------- LES ÉQUIPES ----------
  -- `membresEnregistres` et non `effectif` : le nom dit ce que le
  -- chiffre est. Une équipe à zéro membre enregistré n'est pas une
  -- équipe vide, c'est une équipe dont personne n'a saisi la
  -- composition — et `compositionRenseignee` le dit plutôt que de
  -- laisser un zéro parler à sa place.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'nom', t.name,
           'membresEnregistres', m.nb,
           'membresActifs', m.actifs,
           'compositionRenseignee', m.nb > 0
         ) order by t.name), '[]'::jsonb)
    into v_equipes
  from public.teams t
  left join lateral (
    select count(*)::int as nb,
           count(*) filter (where e.archived_at is null)::int as actifs
    from public.team_members tm
    join public.employees e on e.id = tm.employee_id
    where tm.team_id = t.id
  ) m on true
  where t.organization_id = p_organization_id and t.archived_at is null;

  select count(*)::int into v_competences
  from public.employee_skills es
  where es.organization_id = p_organization_id;

  return jsonb_build_object(
    'agent', 'planning',
    'organisationId', p_organization_id,
    'fenetre', jsonb_build_object(
      'du', v_from, 'au', v_to, 'jours', v_days, 'aujourdhuiParis', v_today),
    'droitsManquants', '[]'::jsonb,
    -- Une semaine vide est une RÉPONSE, pas une panne : « rien n'est
    -- posé » se dit, et `insufficient_data` empêche l'agent de chiffrer
    -- quoi que ce soit à partir de là.
    'confiance', case when v_posees = 0 then 'insufficient_data' else 'high' end,

    'jours', v_jours,
    'interventionsPosees', v_posees,
    'chevauchements', v_chevauchements,
    'interventionsSansEquipe', v_sans_equipe,
    'interventionsSansDateDeDebut', v_sans_debut,
    'equipes', v_equipes,

    'nonMesurable', jsonb_build_object(
      'disponibilite',
        'Il n''existe dans ce produit AUCUNE table d''absence, de congé, de jour férié ni de '
        || 'disponibilité. Ne déduis jamais une disponibilité d''une case vide : « rien n''est '
        || 'posé ce jour-là » n''est pas « l''équipe est libre ce jour-là ».',
      'capaciteContractuelle',
        'Aucune heure contractuelle n''est enregistrée sur les salariés : il n''y a pas de '
        || 'dénominateur, donc pas de taux de charge et pas de surcharge. Seules les heures '
        || 'POSÉES sont connues.',
      'amplitude',
        'Une intervention qui court sur plusieurs jours compte pour « heuresConnues = null » sur '
        || 'chacun de ses jours, jamais pour zéro et jamais pour son amplitude calendaire. Un '
        || 'total accompagné de « incomplet: true » est un MINORANT.',
      'tempsDeDeplacement',
        'Aucun distancier : ni distance ni temps de trajet entre deux rendez-vous ne sont '
        || 'calculés par ce produit.',
      'competences', case when v_competences = 0 then
        'Aucune compétence n''est enregistrée (`employee_skills` : 0 ligne). « Personne ne sait '
        || 'le faire » serait faux : la bonne réponse est « ce n''est pas renseigné ».' end,
      'deplacementDIntervention',
        'Aucune fonction de déplacement ni d''annulation d''intervention n''existe : seule la '
        || 'CRÉATION est possible, et en brouillon. Pour déplacer, renvoie à l''écran /planning.'
    )
  );
end;
$$;

comment on function public.ai_planning_summary(uuid, date, int) is
  'Agent Planning : charge POSÉE par jour et par équipe sur une fenêtre bornée, '
  'chevauchements, interventions sans équipe, notes de journée. Les heures suivent la règle de '
  'chargeDuJour — un chantier de plusieurs jours vaut null, jamais zéro, jamais son amplitude.';


-- ------------------------------------------------------------
-- Oasis Care — §11Y, LES DEUX FONCTIONS DE L'AGENT MATÉRIEL.
-- ============================================================
-- POURQUOI DEUX FONCTIONS, ET PAS TROIS
-- ============================================================
--
-- Le sondage en proposait trois : l'état du parc, la liste des
-- échéances, la fiche d'une machine. Les deux premières sont ici
-- FONDUES en une seule, `ai_fleet_snapshot`, pour une raison de coût et
-- une raison de sens.
--
--   • DE COÛT : un parc de paysagiste compte trente engins, pas trois
--     mille. Compter le parc puis lister ses échéances sont deux
--     lectures des mêmes six lignes, et deux appels d'outil coûtent
--     deux allers-retours de modèle pour une réponse que le SQL rend en
--     une fois.
--
--   • DE SENS, et c'est la vraie : les échéances SONT l'état du parc.
--     « Combien de machines ai-je ? » n'est presque jamais la question ;
--     « qu'est-ce qui me tombe dessus ce mois-ci » l'est toujours. Les
--     séparer aurait laissé le modèle appeler la première, obtenir des
--     compteurs, et conclure sans jamais demander la seconde.
--
-- La fiche, elle, reste séparée : elle répond à une question d'un autre
-- ordre (« où est la mini-pelle »), et la charger à chaque question sur
-- le parc ferait sortir de l'entreprise le journal d'entretien de
-- trente machines pour en commenter une.
--
-- ============================================================
-- LE PIÈGE PRINCIPAL, ET IL EST DOUBLE
-- ============================================================
--
-- « ZÉRO ÉCHÉANCE EN RETARD » N'EST PAS « TOUT EST À JOUR ». Ce produit
-- a déjà corrigé quatre fois la confusion entre « zéro » et « je ne
-- sais pas », et le matériel est l'endroit où elle serait la plus facile
-- à commettre : `equipment` compte AUJOURD'HUI zéro ligne en production.
-- Un `count(*)` naïf rendrait « 0 en retard » à une entreprise qui n'a
-- simplement jamais saisi de machine, et cette phrase-là est
-- rassurante — donc elle ne sera pas vérifiée.
--
-- La fonction rend donc DEUX drapeaux distincts, et aucun n'est un
-- compte :
--
--   1. `parc.vide` — aucune machine enregistrée. Dans ce cas
--      `echeances.depassees` vaut NULL, jamais 0.
--
--   2. `echeances.suivies` — des machines existent, mais AUCUNE
--      échéance n'a jamais été saisie sur aucune d'elles. C'est le
--      second piège, et il est plus vicieux que le premier : le parc
--      n'est pas vide, les compteurs de machines sont crédibles, et
--      « 0 échéance dépassée » ressemble à une vraie réponse. Là encore
--      `depassees` vaut NULL.
--
-- Et un troisième cas, intermédiaire, qui ne se règle pas par un
-- drapeau mais par un compte : quand une PARTIE des machines porte des
-- échéances et l'autre non, `echeances.machinesSansEcheance` dit
-- combien d'engins sont hors de tout suivi. « 2 en retard » sur un parc
-- dont 9 machines sur 12 n'ont aucune échéance saisie n'est pas la même
-- information que « 2 en retard » sur un parc entièrement suivi.
--
-- ============================================================
-- CE QUE CES FONCTIONS NE RENDENT PAS, ET POURQUOI
-- ============================================================
--
-- AUCUN COÛT D'USAGE. Ni au kilomètre, ni à l'heure, ni au chantier.
-- Ce n'est pas une omission de prudence, c'est une absence de SCHÉMA :
--
--   • aucune table de carburant ni de consommation ;
--   • aucun relevé de compteur périodique — `meter_reading` est porté
--     par une LIGNE D'ENTRETIEN, donc on ne relève qu'en passant à
--     l'atelier : il n'existe aucune série temporelle, donc aucune
--     projection d'usure ;
--   • aucun amortissement, et 0067 écrit pourquoi : « c'est le métier
--     de l'expert, les règles changent, et un plan d'amortissement faux
--     vaut moins que pas de plan du tout » ;
--   • aucune géolocalisation, 0067 encore : « le produit n'a pas de
--     boîtier, et inventer une position serait mentir » ;
--   • aucune refacturation au chantier — `project_costs` ne porte aucune
--     ligne de nature « equipment », et 0067 l'exclut délibérément.
--
-- Le bloc `nonMesurable` porte ces cinq refus DANS LA DONNÉE. C'est
-- délibéré, et c'est le mécanisme employé par `ai_operations_snapshot`
-- et `ai_planning_summary` : une consigne dans l'instruction se
-- démode et se dilue dans un long contexte ; une clé dans la réponse
-- est relue à chaque appel, à côté du chiffre qu'elle nuance.
--
-- CE QUI EST RENDU, EN REVANCHE, EST DE L'ARGENT RÉELLEMENT DÉPENSÉ :
-- `maintenance_cost_cents` est la somme des factures d'entretien
-- SAISIES, et `acquisition_cost_cents` le prix d'achat SAISI. Leur
-- rapport est calculé par le SQL (`ratioPourMille`) parce que la page 11
-- interdit au modèle de le calculer — et les machines sans prix d'achat
-- sont EXCLUES du classement puis COMPTÉES, plutôt que d'y entrer avec
-- un dénominateur nul.
--
-- ============================================================
-- L'ORGANISATION, LES DROITS, LES BORNES
-- ============================================================
--
-- `p_organization_id` est posé par l'EXÉCUTEUR (`injecteOrganisation`),
-- jamais par le modèle : aucun schéma Zod ne l'expose. `ai_guard` la
-- revérifie côté serveur — appartenance ET droit `projects.read` — et
-- LÈVE plutôt que de rendre une vue partielle. `security invoker`
-- laisse en plus la RLS filtrer : les deux barrières, pas l'une ou
-- l'autre.
--
-- LES QUATRE TABLES DU MODULE SONT SOUS LE MÊME DROIT (`projects.read`,
-- vérifié dans `pg_policies`), et c'est ce qui dispense ces fonctions du
-- bloc `droitsManquants` que porte `ai_customer_value` : il n'existe
-- ici aucune combinaison de droits qui rendrait une vue partiellement
-- lisible. On a le parc entier, ou l'exception.
--
-- Les tableaux sont bornés et le dépassement est ANNONCÉ (`tronque`),
-- parce qu'un tableau coupé en silence fait conclure le modèle sur un
-- sous-ensemble qu'il croit complet.

-- ============================================================
-- 1. L'ÉTAT DU PARC ET CE QUI EXPIRE
-- ============================================================

create or replace function public.ai_fleet_snapshot(
  p_organization_id uuid,
  p_days int default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c_max      constant int := 50;   -- le plafond de la liste d'échéances
  c_max_cout constant int := 10;   -- le plafond du classement d'entretien

  v_today date;
  v_days  int;

  -- Le parc.
  v_total     int;
  v_archivees int;
  v_vide      bool;
  v_statuts   jsonb;
  v_categories jsonb;

  -- La disponibilité.
  v_affectees int;
  v_depot     int;
  v_atelier   int;
  v_immo      int;
  v_retires   int;

  -- Les échéances, et leur mesurabilité.
  v_ech_saisies int;
  v_ech_ouvertes int;
  v_avec_ech    int;
  v_sans_ech    int;
  v_depassees   int;
  v_fenetre     int;
  v_liste       jsonb;
  v_liste_total int;
  v_motif_ech   text;

  -- L'entretien réellement dépensé.
  v_entretien   jsonb;
  v_sans_prix   int;
  v_sans_journal int;
begin
  -- Le droit de base de tout l'opérationnel de l'IA (0072, 0073), et
  -- celui qui commande RÉELLEMENT les quatre tables du module.
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_today := (now() at time zone 'Europe/Paris')::date;
  -- Une fenêtre hors bornes est RAMENÉE dedans plutôt que refusée : un
  -- modèle qui demande 5 000 jours ne mérite pas une exception, il
  -- mérite une année.
  v_days  := least(greatest(coalesce(p_days, 30), 1), 366);

  -- ---------- LE PARC ----------
  -- Une machine ARCHIVÉE est sortie du parc : elle ne compte ni dans le
  -- total, ni dans la disponibilité, ni dans les échéances (la vue
  -- `equipment_due_dates` l'exclut déjà d'elle-même). Elle est comptée
  -- À PART parce que « je n'ai rien » et « j'ai tout archivé » ne sont
  -- pas la même situation.
  select
    count(*) filter (where e.archived_at is null)::int,
    count(*) filter (where e.archived_at is not null)::int
    into v_total, v_archivees
  from public.equipment e
  where e.organization_id = p_organization_id;

  -- LE DRAPEAU QUI TIENT TOUTE CETTE FONCTION. Il est booléen et non
  -- déduit d'un compte à zéro : le modèle ne doit pas avoir à faire la
  -- différence lui-même, parce que c'est précisément la différence
  -- qu'il rate.
  v_vide := (v_total = 0);

  select jsonb_build_object(
           'actif',        count(*) filter (where e.status = 'active')::int,
           'atelier',      count(*) filter (where e.status = 'maintenance')::int,
           'immobilise',   count(*) filter (where e.status = 'outOfService')::int,
           'sortiDuParc',  count(*) filter (where e.status = 'retired')::int)
    into v_statuts
  from public.equipment e
  where e.organization_id = p_organization_id and e.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('categorie', c.categorie, 'nombre', c.nombre)
                            order by c.nombre desc, c.categorie), '[]'::jsonb)
    into v_categories
  from (
    select e.category as categorie, count(*)::int as nombre
    from public.equipment e
    where e.organization_id = p_organization_id and e.archived_at is null
    group by e.category
  ) c;

  -- ---------- LA DISPONIBILITÉ ----------
  -- « AU DÉPÔT » EST UNE DÉDUCTION DE L'ABSENCE, et c'est le schéma qui
  -- le veut : 0067 écrit « aucune ligne ouverte = au dépôt ». Ce n'est
  -- donc PAS une position géographique, c'est le constat qu'aucune
  -- affectation n'a été saisie. La description de l'outil le redit au
  -- modèle, parce que la nuance disparaîtrait sinon dans le mot
  -- « dépôt ».
  select
    count(*) filter (where a.id is not null)::int,
    count(*) filter (where a.id is null and e.status = 'active')::int,
    count(*) filter (where e.status = 'maintenance')::int,
    count(*) filter (where e.status = 'outOfService')::int,
    count(*) filter (where e.status = 'retired')::int
    into v_affectees, v_depot, v_atelier, v_immo, v_retires
  from public.equipment e
  left join public.equipment_assignments a
         on a.equipment_id = e.id and a.ended_on is null
  where e.organization_id = p_organization_id and e.archived_at is null;

  -- ---------- LES ÉCHÉANCES ----------
  -- `equipment_due_dates` a DÉJÀ calculé `days_left` et `state` à la
  -- date de Paris. C'est la frontière déterministe de la p. 11 tenue par
  -- le schéma : le modèle n'a aucune soustraction de dates à faire, et
  -- il ne doit surtout pas en faire une — il ignore le fuseau.
  select
    count(*)::int,
    count(*) filter (where d.completed_on is null)::int,
    count(distinct d.equipment_id) filter (where d.completed_on is null)::int,
    count(*) filter (where d.completed_on is null and d.state = 'overdue')::int
    into v_ech_saisies, v_ech_ouvertes, v_avec_ech, v_depassees
  from public.equipment_due_dates d
  where d.organization_id = p_organization_id;

  -- Combien de machines sont HORS DE TOUT SUIVI. C'est le troisième cas,
  -- celui qu'aucun drapeau ne couvre : un parc à moitié suivi rend des
  -- compteurs vrais qui décrivent la moitié de la réalité.
  v_sans_ech := greatest(v_total - v_avec_ech, 0);

  -- Le tableau est bâti sur un sous-ensemble BORNÉ, et le total réel est
  -- recompté à part juste après : sans ce second compte, « tronque » ne
  -- saurait pas qu'il ment.
  --
  -- « En retard OU dans la fenêtre » : `days_left <= v_days` prend les
  -- deux d'un coup, puisque le retard est un `days_left` négatif. Le
  -- retard n'est donc JAMAIS coupé par la fenêtre — un contrôle
  -- technique dépassé de six mois doit ressortir d'une question sur
  -- « les trente prochains jours », et c'est même la seule raison pour
  -- laquelle on la pose.
  select coalesce(jsonb_agg(jsonb_build_object(
           'equipementId',   s.equipment_id,
           'nom',            s.equipment_name,
           'categorie',      s.category,
           'immatriculation', s.registration,
           'numeroInterne',  s.internal_number,
           'statutMachine',  s.equipment_status,
           'nature',         s.kind,
           'libelle',        s.label,
           'echeanceLe',     s.due_on,
           'joursRestants',  s.days_left,
           'etat',           s.state,
           'preavisJours',   s.reminder_days)
           order by s.due_on, s.equipment_name), '[]'::jsonb)
    into v_liste
  from (
    select d.*
    from public.equipment_due_dates d
    where d.organization_id = p_organization_id
      and d.completed_on is null
      and d.days_left <= v_days
    order by d.due_on, d.equipment_name
    limit c_max
  ) s;

  select count(*)::int into v_liste_total
  from public.equipment_due_dates d
  where d.organization_id = p_organization_id
    and d.completed_on is null
    and d.days_left <= v_days;

  select count(*)::int into v_fenetre
  from public.equipment_due_dates d
  where d.organization_id = p_organization_id
    and d.completed_on is null
    and d.days_left between 0 and v_days;

  -- LA PHRASE EST PRODUITE PAR LE SQL, PAS PAR LE MODÈLE. Un motif
  -- rédigé ici est le même à chaque appel ; laissé au modèle, il varie,
  -- et sa version rassurante finira par sortir un jour.
  v_motif_ech := case
    when v_vide then
      'Aucun matériel enregistré : le module Matériel existe et il est vide. '
      || 'Les compteurs d''échéances valent null, pas zéro. Écran : /materiel.'
    when v_ech_saisies = 0 then
      'Des machines sont enregistrées mais AUCUNE échéance ne l''est : '
      || 'rien ne permet de dire que le parc est à jour.'
    when v_sans_ech > 0 then
      v_sans_ech::text || ' machine(s) sur ' || v_total::text
      || ' ne portent aucune échéance ouverte : elles sont hors de tout suivi.'
    else null
  end;

  -- ---------- L'ENTRETIEN RÉELLEMENT DÉPENSÉ ----------
  -- De l'argent SAISI, jamais un coût de revient. Le rapport entretien /
  -- prix d'achat est calculé ICI, en pour mille entiers, parce que la
  -- p. 11 range « prix » parmi les grandeurs que le modèle ne calcule
  -- pas. Une machine sans prix d'achat n'entre pas au classement avec un
  -- dénominateur nul : elle en est exclue, et le compte des exclues est
  -- rendu à côté.
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'equipementId',      o.equipment_id,
      'nom',               o.name,
      'categorie',         o.category,
      'entretienCents',    o.maintenance_cost_cents,
      'nombrePassages',    o.maintenance_count,
      'dernierEntretienLe', o.last_maintenance_on,
      'prixAchatCents',    o.acquisition_cost_cents,
      -- NULL quand le prix d'achat manque ou vaut zéro. Le `nullif`
      -- n'est pas une précaution de style : `acquisition_cost_cents`
      -- accepte 0, et une division par zéro ferait échouer l'appel
      -- entier pour une seule ligne mal saisie.
      'ratioPourMille',    case
        when nullif(o.acquisition_cost_cents, 0) is null then null
        else round(o.maintenance_cost_cents * 1000.0 / o.acquisition_cost_cents)::int
      end)
      order by o.maintenance_cost_cents desc, o.name), '[]'::jsonb)
    into v_entretien
  from (
    select *
    from public.equipment_overview eo
    where eo.organization_id = p_organization_id
      and eo.archived_at is null
      -- Sans `coalesce` : un journal vide ne prouve pas qu'on n'a rien
      -- dépensé, il prouve qu'on n'a rien noté. La vue laisse donc NULL,
      -- et on écarte ces machines du classement au lieu de les y placer
      -- à 0 € — ce qui les ferait passer pour les moins coûteuses.
      and eo.maintenance_cost_cents is not null
    order by eo.maintenance_cost_cents desc, eo.name
    limit c_max_cout
  ) o;

  select
    count(*) filter (where eo.maintenance_cost_cents is not null
                       and nullif(eo.acquisition_cost_cents, 0) is null)::int,
    count(*) filter (where eo.maintenance_cost_cents is null)::int
    into v_sans_prix, v_sans_journal
  from public.equipment_overview eo
  where eo.organization_id = p_organization_id and eo.archived_at is null;

  return jsonb_build_object(
    'agent', 'fleet',
    'organisationId', p_organization_id,
    'aujourdhuiParis', v_today,

    'parc', jsonb_build_object(
      -- Le drapeau AVANT les compteurs, pour qu'il soit lu avant eux.
      'vide', v_vide,
      'motif', case when v_vide then
        'Aucun matériel enregistré. Ce n''est PAS « votre parc est à jour » : '
        || 'personne n''a encore saisi de machine. Renvoie vers /materiel.'
      end,
      'total', v_total,
      'archivees', v_archivees,
      'parStatut', case when v_vide then null else v_statuts end,
      'parCategorie', v_categories),

    'disponibilite', case when v_vide then null else jsonb_build_object(
      'affectees', v_affectees,
      'auDepot', v_depot,
      'atelier', v_atelier,
      'immobilisees', v_immo,
      'sortiesDuParc', v_retires,
      'note', 'Une affectation est une SAISIE, pas une position. '
              || '« Au dépôt » veut dire « aucune affectation ouverte », rien de plus.')
    end,

    'echeances', jsonb_build_object(
      -- `suivies` est faux dès qu'aucune échéance n'a jamais été saisie,
      -- parc vide compris. Les compteurs qui suivent valent alors NULL.
      'suivies', (not v_vide) and v_ech_saisies > 0,
      'motif', v_motif_ech,
      'fenetreJours', v_days,
      'depassees',       case when v_vide or v_ech_saisies = 0 then null else v_depassees end,
      'dansLaFenetre',   case when v_vide or v_ech_saisies = 0 then null else v_fenetre end,
      'ouvertes',        case when v_vide or v_ech_saisies = 0 then null else v_ech_ouvertes end,
      'machinesSuivies', case when v_vide then null else v_avec_ech end,
      'machinesSansEcheance', case when v_vide then null else v_sans_ech end,
      'liste', v_liste,
      'listeTotal', v_liste_total,
      'tronque', v_liste_total > c_max),

    'entretien', jsonb_build_object(
      'classement', v_entretien,
      'sansPrixDAchat', v_sans_prix,
      'sansJournal', v_sans_journal,
      'note', 'Des euros RÉELLEMENT dépensés et saisis, jamais un coût de revient. '
              || '« ratioPourMille » est l''entretien rapporté au prix d''achat, en pour mille ; '
              || 'null quand le prix d''achat n''est pas saisi, et ces machines sont hors classement.'),

    -- LES CINQ REFUS, PORTÉS PAR LA DONNÉE ET NON PAR LA MÉMOIRE DU
    -- MODÈLE. C'est la moitié « coûts » de la mission de cet agent, et
    -- elle n'a pas de schéma. Voir l'en-tête.
    'nonMesurable', jsonb_build_object(
      'carburant', 'Aucune table de carburant ni de consommation. Aucun coût au kilomètre '
                   || 'ni à l''heure n''est calculable. Ne l''estime pas.',
      'usure', 'Le compteur n''est relevé QU''À L''OCCASION D''UN ENTRETIEN : il n''existe '
               || 'aucune série temporelle, donc aucune projection d''usure ni de panne.',
      'amortissement', 'Exclu par écrit du produit (migration 0067) : renvoie à l''expert-comptable.',
      'geolocalisation', 'Aucun boîtier, aucune position. Seule l''affectation SAISIE est connue.',
      'refacturation', 'Aucun coût matériel n''est rattaché à un chantier : project_costs ne porte '
                       || 'aucune ligne de nature « equipment », et 0067 l''interdit délibérément.',
      'marche', 'Aucune donnée externe : ni prix de l''occasion, ni comparaison de tarifs '
                || 'd''entretien. Renvoie à l''agent Marché, qui n''est pas construit.'),

    'confiance', case
      when v_vide then 'insufficient_data'
      when v_ech_saisies = 0 then 'insufficient_data'
      else 'high'   -- tout est lu dans des registres, rien n'est estimé
    end
  );
end;
$$;

comment on function public.ai_fleet_snapshot(uuid, int) is
  'Fleet Agent : état du parc, disponibilité, échéances triées par urgence et entretien dépensé. Un parc vide rend « vide: true » et des compteurs null, jamais zéro.';

-- ============================================================
-- 2. LA FICHE D'UNE MACHINE
-- ============================================================
--
-- LA RÉSOLUTION EST DANS L'OUTIL, ET C'EST LE POINT DE CE FICHIER.
--
-- `searchEntities` délègue à `global_search`, qui N'INDEXE PAS le
-- matériel — vérifié : aucune des fonctions `ai_*` de la base ne
-- contient le mot « equipment ». L'agent ne peut donc PAS transformer
-- « le Master » en identifiant par les moyens ordinaires.
--
-- Deux réponses étaient possibles. Écrire un quatrième outil de
-- recherche, propre au matériel — ce qui aurait donné DEUX manières de
-- chercher une entité dans ce produit, et un modèle qui hésite entre
-- les deux. Ou porter la résolution DANS la fiche, ce qui est fait ici :
-- l'outil accepte un fragment de nom, de numéro interne, de plaque, de
-- marque ou de modèle — et, quand la question vient de l'écran
-- `/materiel/[id]`, l'identifiant lui-même.
--
-- L'AMBIGUÏTÉ N'EST PAS UNE ERREUR : deux tondeuses « Husqvarna »
-- rendent `trouve: false` et la LISTE des candidats, pour que l'agent
-- demande laquelle. Choisir la première serait rendre la fiche d'une
-- machine en la faisant passer pour l'autre.

create or replace function public.ai_fleet_equipment(
  p_organization_id uuid,
  p_query text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c_max_journal constant int := 20;

  v_today    date;
  v_q        text;
  v_est_uuid bool;
  v_parc     int;
  v_nb       int;
  v_id       uuid;
  v_candidats jsonb;
  v_o        record;
  v_journal  jsonb;
  v_journal_total int;
  v_echeances jsonb;
  v_chantier text;
  v_equipe   text;
  v_salarie  text;
begin
  perform public.ai_guard(p_organization_id, 'projects.read');

  v_today := (now() at time zone 'Europe/Paris')::date;
  -- `ai_clean_text` (0069) : le fragment vient du modèle, donc d'un
  -- texte que quelqu'un a pu écrire. On le borne et on retire les
  -- caractères de contrôle avant de le coller dans un `ilike`.
  v_q := public.ai_clean_text(p_query, 120);

  select count(*)::int into v_parc
  from public.equipment e
  where e.organization_id = p_organization_id and e.archived_at is null;

  if v_q is null then
    return jsonb_build_object(
      'trouve', false,
      'motif', 'Aucun fragment de recherche fourni.',
      'parcVide', v_parc = 0,
      'candidats', '[]'::jsonb);
  end if;

  -- Un UUID est accepté tel quel : c'est ce que l'écran `/materiel/[id]`
  -- a sous la main, et lui faire retaper un nom serait lui faire perdre
  -- la seule certitude de la page.
  v_est_uuid := v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if v_est_uuid then
    select e.id into v_id
    from public.equipment e
    where e.organization_id = p_organization_id and e.id = v_q::uuid;
    v_nb := case when v_id is null then 0 else 1 end;
    v_candidats := '[]'::jsonb;
  else
    -- LES MACHINES ARCHIVÉES SONT CHERCHÉES AUSSI. « Où est passé le
    -- Master ? » a une réponse — « vendu, archivé le 3 mars » — et elle
    -- vaut mieux qu'un « introuvable » qui laisse croire à une faute de
    -- frappe. La fiche porte `archiveLe`, l'agent le dira.
    select count(*)::int into v_nb
    from public.equipment e
    where e.organization_id = p_organization_id
      and (e.name ilike '%' || v_q || '%'
        or e.internal_number ilike '%' || v_q || '%'
        or e.registration ilike '%' || v_q || '%'
        or e.brand ilike '%' || v_q || '%'
        or e.model ilike '%' || v_q || '%'
        or e.serial_number ilike '%' || v_q || '%');

    if v_nb = 1 then
      select e.id into v_id
      from public.equipment e
      where e.organization_id = p_organization_id
        and (e.name ilike '%' || v_q || '%'
          or e.internal_number ilike '%' || v_q || '%'
          or e.registration ilike '%' || v_q || '%'
          or e.brand ilike '%' || v_q || '%'
          or e.model ilike '%' || v_q || '%'
          or e.serial_number ilike '%' || v_q || '%');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'equipementId', c.id, 'nom', c.name, 'categorie', c.category,
             'marque', c.brand, 'modele', c.model,
             'numeroInterne', c.internal_number, 'immatriculation', c.registration,
             'archive', c.archived_at is not null)
             order by c.name), '[]'::jsonb)
      into v_candidats
    from (
      select e.* from public.equipment e
      where e.organization_id = p_organization_id
        and (e.name ilike '%' || v_q || '%'
          or e.internal_number ilike '%' || v_q || '%'
          or e.registration ilike '%' || v_q || '%'
          or e.brand ilike '%' || v_q || '%'
          or e.model ilike '%' || v_q || '%'
          or e.serial_number ilike '%' || v_q || '%')
      order by e.name
      limit 25
    ) c;
  end if;

  if v_nb <> 1 then
    return jsonb_build_object(
      'trouve', false,
      -- LES TROIS ÉCHECS SONT NOMMÉS SÉPARÉMENT. « Parc vide », « rien
      -- ne correspond » et « plusieurs correspondent » appellent trois
      -- phrases différentes de l'agent, et une seule d'entre elles est
      -- une invitation à préciser.
      'motif', case
        when v_parc = 0 then
          'Aucun matériel enregistré dans cette entreprise : le module existe et il est vide. '
          || 'Ce n''est pas « je n''ai pas trouvé cette machine ». Écran : /materiel.'
        when v_nb = 0 then
          'Aucune machine ne correspond à « ' || v_q || ' ».'
        else
          v_nb::text || ' machines correspondent à « ' || v_q
          || ' » : demande laquelle plutôt que d''en choisir une.'
      end,
      'parcVide', v_parc = 0,
      'nombreCandidats', v_nb,
      'candidats', v_candidats);
  end if;

  select * into v_o from public.equipment_overview o where o.equipment_id = v_id;

  -- Les noms de l'affectation ouverte. Trois `left join` séparés plutôt
  -- qu'une jointure : les trois cibles sont exclusives dans l'usage mais
  -- la contrainte n'en impose qu'UNE AU MOINS, pas une seule.
  select p.name into v_chantier from public.projects p where p.id = v_o.assigned_project_id;
  select t.name into v_equipe   from public.teams t    where t.id = v_o.assigned_team_id;
  select (em.first_name || ' ' || em.last_name) into v_salarie
  from public.employees em where em.id = v_o.assigned_employee_id;

  select count(*)::int into v_journal_total
  from public.equipment_maintenance m where m.equipment_id = v_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'le', j.performed_on,
           'nature', j.kind,
           'description', j.description,
           'coutCents', j.cost_cents,
           -- NULL = non relevé. JAMAIS 0, qui ramènerait la machine à
           -- sa sortie d'usine (0067).
           'compteur', j.meter_reading)
           order by j.performed_on desc), '[]'::jsonb)
    into v_journal
  from (
    select m.* from public.equipment_maintenance m
    where m.equipment_id = v_id
    order by m.performed_on desc, m.created_at desc
    limit c_max_journal
  ) j;

  select coalesce(jsonb_agg(jsonb_build_object(
           'nature', d.kind, 'libelle', d.label, 'echeanceLe', d.due_on,
           'joursRestants', d.days_left, 'etat', d.state, 'preavisJours', d.reminder_days,
           'recurrenceMois', d.recurrence_months)
           order by d.due_on), '[]'::jsonb)
    into v_echeances
  from public.equipment_due_dates d
  where d.equipment_id = v_id and d.completed_on is null;

  return jsonb_build_object(
    'agent', 'fleet',
    'trouve', true,
    'aujourdhuiParis', v_today,

    'machine', jsonb_build_object(
      'equipementId', v_o.equipment_id,
      'nom', v_o.name,
      'categorie', v_o.category,
      'marque', v_o.brand,
      'modele', v_o.model,
      'numeroInterne', v_o.internal_number,
      'immatriculation', v_o.registration,
      'propriete', v_o.ownership,
      'acquisLe', v_o.acquired_on,
      'prixAchatCents', v_o.acquisition_cost_cents,
      'statut', v_o.status,
      'archiveLe', v_o.archived_at),

    'compteur', jsonb_build_object(
      'nature', v_o.meter_kind,
      'valeur', v_o.current_meter,
      -- LA DATE EST AUSSI IMPORTANTE QUE LA VALEUR, et c'est pour cela
      -- qu'elles voyagent ensemble : un compteur relevé il y a huit mois
      -- ne dit rien de l'état d'aujourd'hui, et l'agent doit citer les
      -- deux ou aucune.
      'releveLe', v_o.meter_read_on,
      'note', case
        when v_o.meter_kind = 'none' then 'Cette machine n''a pas de compteur.'
        when v_o.current_meter is null then 'Aucun relevé enregistré : la valeur est inconnue, pas nulle.'
        else 'Relevé au dernier passage à l''atelier, pas aujourd''hui. N''extrapole aucune usure depuis.'
      end),

    'affectation', case when v_o.assignment_id is null then null else jsonb_build_object(
      'chantier', v_chantier,
      'equipe', v_equipe,
      'salarie', v_salarie,
      'depuisLe', v_o.assigned_since) end,
    'affectationNote', case
      when v_o.assignment_id is null
        then 'Aucune affectation ouverte : la machine est au dépôt, au sens où rien n''a été saisi.'
      else 'Affectation SAISIE, pas une position géographique.' end,

    'entretien', jsonb_build_object(
      -- Sans `coalesce` : NULL veut dire « aucune ligne d'entretien
      -- saisie », et c'est différent de « zéro euro dépensé » — un
      -- entretien fait et non noté est le cas le plus courant.
      'totalCents', v_o.maintenance_cost_cents,
      'nombrePassages', v_o.maintenance_count,
      'dernierLe', v_o.last_maintenance_on,
      'journal', v_journal,
      'journalTotal', v_journal_total,
      'tronque', v_journal_total > c_max_journal),

    'echeancesOuvertes', v_echeances,
    'echeancesDepassees', v_o.overdue_count,

    'nonMesurable', jsonb_build_object(
      'coutDUsage', 'Ni carburant, ni coût au kilomètre ou à l''heure : aucune table ne les porte.',
      'position', 'Aucune géolocalisation. Seule l''affectation saisie est connue.',
      'panneAVenir', 'Aucune série de relevés : aucune prévision de panne ni d''usure.',
      'valeurResiduelle', 'Ni amortissement, ni cote de l''occasion. Renvoie à l''expert-comptable.'),

    'confiance', 'high'
  );
end;
$$;

comment on function public.ai_fleet_equipment(uuid, text) is
  'Fleet Agent : la fiche d''UNE machine, résolue par fragment de nom, de plaque ou de numéro interne — global_search n''indexe pas le matériel.';


-- ------------------------------------------------------------
-- Oasis Care — §11Y, LA VALEUR D'UN CLIENT, POUR L'AGENT CLIENTS.
-- ============================================================
-- POURQUOI CETTE FONCTION, ALORS QUE `ai_get_client_context` EXISTE
-- ============================================================
--
-- `ai_get_client_context` (0058) est déjà déclarée sous
-- `getClientContext`, transverse (`agent: null`), et l'agent Clients la
-- reçoit sans une ligne de code. Elle rend l'identité, les propriétés,
-- les devis, les chantiers, les dernières activités — et, côté argent,
-- UNIQUEMENT LES FACTURES IMPAYÉES.
--
-- C'est ce « uniquement » qui rend cette fonction-ci nécessaire, et la
-- raison n'est pas le confort : sans elle, la seule manière pour l'agent
-- de répondre « combien ce client m'a-t-il rapporté » serait
-- D'ADDITIONNER LES IMPAYÉS et d'appeler cela un chiffre d'affaires.
-- Deux fautes en une — une addition faite par le modèle (interdite
-- p. 11-12 : « total facture » est une grandeur déterministe), et un
-- total qui décrit ce qu'on n'a PAS encaissé présenté comme ce qu'on a
-- gagné.
--
-- Rien nulle part ne totalise ce qu'un client a rapporté. La seule vue
-- par client qui soit exacte, `ai_finance_margin_breakdown` en dimension
-- « client », appartient à l'agent Finance : `pourAgent` ne la donne pas
-- à celui-ci, et la lui donner ferait deux sources pour un même chiffre.
--
-- ============================================================
-- LE PIÈGE QUI DOMINE CETTE FONCTION : TROIS DROITS, PAS UN
-- ============================================================
--
-- Vérifié dans `pg_policies`, et c'est le fait le plus important de ce
-- fichier — les tables que cette fonction traverse ne sont PAS sous le
-- même droit :
--
--   crm_customers, crm_customer_sites ....... clients.read
--   quotes .................................. quotes.read
--   invoices, payments, payment_allocations,
--   credit_notes ............................ invoice.create
--   projects ................................ projects.read
--
-- En `security invoker`, un utilisateur qui n'a que `clients.read`
-- obtiendrait donc : le client trouvé, ZÉRO devis, ZÉRO facture, ZÉRO
-- euro. Tout serait vrai au sens du SQL et faux au sens de la question.
-- C'est LA classe de bug que ce dépôt a déjà nommée — « RLS grant
-- tables » — et la confusion zéro / je-ne-sais-pas corrigée quatre fois.
--
-- La fonction interroge donc `has_permission` AVANT chaque bloc, rend
-- `null` sur le bloc entier quand le droit manque, et NOMME le droit
-- dans `droitsManquants`. C'est la manière de `ai_finance_snapshot`
-- (0073), reprise à l'identique plutôt que réinventée.
--
-- Seul `clients.read` passe par `ai_guard`, donc LÈVE : sans lui il n'y
-- a pas de client du tout, et il n'y a rien à rendre partiellement.
--
-- ============================================================
-- CE QUE CETTE FONCTION NE RENDRA JAMAIS, ET CE N'EST PAS UN OUBLI
-- ============================================================
--
--   • AUCUNE SATISFACTION. Balayage de `information_schema` : aucune
--     table de note, d'avis, d'enquête, de réclamation ni de ticket,
--     et aucune colonne non plus, dans tout le schéma. Ce n'est pas une
--     table vide, c'est une fonctionnalité ABSENTE du produit. Le plus
--     proche — `field_interventions.signed_at` — est un accusé de
--     réalisation, pas un contentement, et les convertir serait
--     l'invention que la p. 12 interdit.
--
--   • AUCUN RISQUE DE DÉPART. Trois manques cumulés : pas de contrat
--     récurrent ni d'abonnement client dans le modèle, `converted_at`
--     souvent vide donc ancienneté inconnue, et aucun outil ne balaie le
--     portefeuille par récence. Un score serait un chiffre inventé.
--
--   • AUCUNE PHRASE DE PORTEFEUILLE. Cette fonction prend UN
--     identifiant. Il n'existe aucun `listAllCustomers`, délibérément
--     (`context.ts` : « jamais toute la base »), et la base compte
--     aujourd'hui UN client — un classement serait une ligne.
--
-- Le bloc `nonMesurable` porte ces refus DANS LA DONNÉE, à côté des
-- chiffres qu'ils nuancent, plutôt que dans une instruction qui se
-- dilue au fil d'un long contexte.
--
-- ============================================================
-- L'ORGANISATION VIENT DE LA LIGNE, PAS D'UN PARAMÈTRE
-- ============================================================
--
-- Pas de `p_organization_id` : la règle n° 1 de 0073. L'organisation est
-- RELUE sur la ligne du client, comme `ai_quote_price_analysis` la relit
-- sur celle du devis. On ne peut pas se tromper d'entreprise sur un
-- paramètre qui n'existe pas, et le modèle n'a aucun moyen d'en nommer
-- une autre. La RLS a déjà filtré : un client d'une autre entreprise
-- ressort introuvable, et le message n'en dit pas plus.

create or replace function public.ai_customer_value(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org      uuid;
  v_c        record;
  v_today    date;
  v_manque   text[] := array[]::text[];

  v_money    bool;
  v_quotes   bool;
  v_projects bool;

  -- Les devis.
  v_dev_nb        int;
  v_dev_ht        bigint;
  v_dev_acc_nb    int;
  v_dev_acc_ht    bigint;
  v_dev_att_nb    int;
  v_dev_att_ht    bigint;
  v_dev_premier   date;
  v_dev_dernier   date;

  -- Les factures.
  v_fac_nb        int;
  v_fac_brouillon int;
  v_fac_ht        bigint;
  v_fac_ttc       bigint;
  v_fac_premiere  date;
  v_fac_derniere  date;

  -- L'argent reçu.
  v_encaisse   bigint;
  v_lettre     bigint;
  v_avoirs     bigint;
  v_reste      bigint;
  v_retard     bigint;
  v_retard_nb  int;

  -- Les chantiers.
  v_ch_nb        int;
  v_ch_termines  int;
  v_ch_encours   int;
  v_ch_dernier   date;

  v_a_des_donnees bool;
begin
  -- L'ORGANISATION EST RELUE SUR LA LIGNE. La RLS a déjà filtré : un
  -- client d'une autre entreprise ressort ici avec un `organization_id`
  -- nul, et le message ne dit rien de plus qu'« introuvable » — ne pas
  -- distinguer « n'existe pas » de « pas le droit » est délibéré, sans
  -- quoi la fonction confirmerait l'existence d'un client concurrent.
  select c.organization_id, c.display_name, c.kind, c.lifecycle_stage,
         c.billing_city, c.converted_at, c.archived_at
    into v_c
  from public.crm_customers c
  where c.id = p_customer_id;

  if v_c.organization_id is null then
    raise exception 'Client introuvable ou inaccessible.';
  end if;
  v_org   := v_c.organization_id;
  v_today := (now() at time zone 'Europe/Paris')::date;

  -- Le droit de base : sans lui il n'y a pas de client, donc rien à
  -- rendre partiellement. Il LÈVE.
  perform public.ai_guard(v_org, 'clients.read');

  -- Les trois autres ne lèvent pas : ils AMPUTENT, et se nomment.
  v_money    := public.has_permission(v_org, 'invoice.create');
  v_quotes   := public.has_permission(v_org, 'quotes.read');
  v_projects := public.has_permission(v_org, 'projects.read');

  if not v_money    then v_manque := v_manque || 'invoice.create'::text; end if;
  if not v_quotes   then v_manque := v_manque || 'quotes.read'::text;    end if;
  if not v_projects then v_manque := v_manque || 'projects.read'::text;  end if;

  -- ---------- LES DEVIS ----------
  -- `sum()` sans `coalesce` : sur zéro ligne il rend NULL, et NULL est
  -- la bonne réponse. Un `coalesce(..., 0)` écrirait « 0 € devisé » pour
  -- un client à qui on n'a jamais rien proposé — c'est la classe de bug
  -- « || 0 sur de l'argent » que ce dépôt a déjà nommée.
  if v_quotes then
    select
      count(*)::int,
      sum(t.total_excluding_vat_cents)::bigint,
      count(*) filter (where q.status = 'accepted')::int,
      sum(t.total_excluding_vat_cents) filter (where q.status = 'accepted')::bigint,
      count(*) filter (where q.status in ('sent', 'viewed'))::int,
      sum(t.total_excluding_vat_cents) filter (where q.status in ('sent', 'viewed'))::bigint,
      min(q.issued_on), max(q.issued_on)
      into v_dev_nb, v_dev_ht, v_dev_acc_nb, v_dev_acc_ht,
           v_dev_att_nb, v_dev_att_ht, v_dev_premier, v_dev_dernier
    from public.quotes q
    left join public.quote_totals t on t.quote_id = q.id
    where q.customer_id = p_customer_id and q.archived_at is null;
  end if;

  -- ---------- LES FACTURES ----------
  -- « ÉMISE » = `issued_at is not null`. C'est la règle de 0065 et de
  -- 0073, reprise à l'identique pour que ce chiffre soit LE MÊME que
  -- celui de l'écran Analytics : un brouillon n'a pas de numéro de
  -- séquence légale, donc la facture n'existe pas encore. Les brouillons
  -- sont COMPTÉS À PART plutôt que fondus ou tus — « trois factures
  -- prêtes et non émises » est une action à faire, pas un détail.
  if v_money then
    select
      count(*) filter (where i.issued_at is not null)::int,
      count(*) filter (where i.issued_at is null)::int,
      sum(t.total_excluding_vat_cents) filter (where i.issued_at is not null)::bigint,
      sum(t.total_including_vat_cents) filter (where i.issued_at is not null)::bigint,
      min(i.issued_on) filter (where i.issued_at is not null),
      max(i.issued_on) filter (where i.issued_at is not null)
      into v_fac_nb, v_fac_brouillon, v_fac_ht, v_fac_ttc, v_fac_premiere, v_fac_derniere
    from public.invoices i
    left join public.invoice_totals t on t.invoice_id = i.id
    where i.customer_id = p_customer_id and i.archived_at is null;

    -- L'ARGENT REÇU DU CLIENT, toutes affectations confondues.
    select sum(p.amount_cents)::bigint into v_encaisse
    from public.payments p
    where p.customer_id = p_customer_id;

    -- L'ARGENT RATTACHÉ À SES FACTURES. Les deux ne coïncident PAS
    -- toujours, et l'écart est une information plutôt qu'une erreur : un
    -- acompte reçu avant toute facture n'est lettré nulle part. Les
    -- confondre ferait dire « il n'a rien payé » d'un client dont
    -- l'argent est sur le compte.
    select sum(a.amount_cents)::bigint into v_lettre
    from public.payment_allocations a
    join public.invoices i on i.id = a.invoice_id
    where i.customer_id = p_customer_id and i.archived_at is null;

    select sum(b.credited_cents)::bigint into v_avoirs
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.customer_id = p_customer_id and i.archived_at is null
      and i.issued_at is not null;

    select
      sum(b.outstanding_cents)::bigint,
      sum(b.outstanding_cents) filter (where i.due_on < v_today)::bigint,
      count(*) filter (where i.due_on < v_today and b.outstanding_cents > 0)::int
      into v_reste, v_retard, v_retard_nb
    from public.invoices i
    join public.invoice_balance b on b.invoice_id = i.id
    where i.customer_id = p_customer_id and i.archived_at is null
      and i.issued_at is not null and b.outstanding_cents > 0;
  end if;

  -- ---------- LES CHANTIERS ----------
  if v_projects then
    select
      count(*)::int,
      count(*) filter (where p.status in ('completed', 'handedOver'))::int,
      count(*) filter (where p.status in ('planned', 'inProgress', 'onHold'))::int,
      max(p.actual_end_on) filter (where p.status in ('completed', 'handedOver'))
      into v_ch_nb, v_ch_termines, v_ch_encours, v_ch_dernier
    from public.projects p
    where p.customer_id = p_customer_id and p.archived_at is null;
  end if;

  -- Une fiche amputée d'un de ses droits n'est pas une fiche « peu
  -- fiable » : c'est une fiche dont on ne sait pas ce qu'elle cache.
  v_a_des_donnees := coalesce(v_fac_ht, 0) <> 0
                     or coalesce(v_dev_ht, 0) <> 0
                     or coalesce(v_encaisse, 0) <> 0
                     or coalesce(v_ch_nb, 0) <> 0;

  return jsonb_build_object(
    'agent', 'customer',
    'clientId', p_customer_id,
    'aujourdhuiParis', v_today,
    'droitsManquants', to_jsonb(v_manque),

    'client', jsonb_build_object(
      'nom', v_c.display_name,
      'type', v_c.kind,
      'etape', v_c.lifecycle_stage,
      'ville', v_c.billing_city,
      'archive', v_c.archived_at is not null,
      'clientDepuis', v_c.converted_at,
      -- NULL, jamais zéro : `converted_at` n'est pas renseigné sur le
      -- seul client de la base, et « client depuis 0 jour » se lirait
      -- « nouveau client ». L'ancienneté est INCONNUE, pas nulle.
      'ancienneteJours', case
        when v_c.converted_at is null then null
        else (v_today - (v_c.converted_at at time zone 'Europe/Paris')::date)
      end,
      'ancienneteNote', case
        when v_c.converted_at is null
          then 'Date de début de relation non renseignée : l''ancienneté est INCONNUE. '
               || 'N''en déduis ni fidélité, ni nouveauté.'
      end),

    -- Chaque bloc vaut NULL en entier quand son droit manque. Un bloc
    -- rempli de zéros serait indiscernable d'un client sans activité.
    'devis', case when not v_quotes then null else jsonb_build_object(
      'nombre', v_dev_nb,
      'totalHTCents', v_dev_ht,
      'accepteNombre', v_dev_acc_nb,
      'accepteHTCents', v_dev_acc_ht,
      'enAttenteNombre', v_dev_att_nb,
      'enAttenteHTCents', v_dev_att_ht,
      'premierLe', v_dev_premier,
      'dernierLe', v_dev_dernier) end,

    'facturation', case when not v_money then null else jsonb_build_object(
      'nombreEmises', v_fac_nb,
      'brouillons', v_fac_brouillon,
      'totalHTCents', v_fac_ht,
      'totalTTCCents', v_fac_ttc,
      'premiereLe', v_fac_premiere,
      'derniereLe', v_fac_derniere) end,

    'reglement', case when not v_money then null else jsonb_build_object(
      'encaisseCents', v_encaisse,
      'lettreCents', v_lettre,
      -- L'écart entre l'argent reçu et l'argent rattaché à une facture.
      -- Calculé ici, en SQL, et NULL quand on n'a rien reçu — pas 0.
      'nonAffecteCents', case
        when v_encaisse is null then null
        else v_encaisse - coalesce(v_lettre, 0) end,
      'avoirsCents', v_avoirs,
      'resteDuCents', v_reste,
      'enRetardCents', v_retard,
      'enRetardNombre', v_retard_nb,
      'note', '« encaisseCents » est l''argent reçu du client ; « lettreCents » la part '
              || 'rattachée à ses factures. Un écart n''est pas une erreur : un acompte reçu '
              || 'avant toute facture n''est lettré nulle part.') end,

    'chantiers', case when not v_projects then null else jsonb_build_object(
      'nombre', v_ch_nb,
      'termines', v_ch_termines,
      'enCours', v_ch_encours,
      'dernierTermineLe', v_ch_dernier) end,

    -- LES QUATRE REFUS, PORTÉS PAR LA DONNÉE. Voir l'en-tête : ce ne
    -- sont pas des tables vides, ce sont des fonctionnalités absentes,
    -- et la nuance change la phrase que l'agent doit prononcer.
    'nonMesurable', jsonb_build_object(
      'satisfaction', 'Ce produit ne collecte AUCUN signal de satisfaction : ni note, ni avis, '
                      || 'ni enquête, ni réclamation, ni ticket — aucune table, aucune colonne. '
                      || 'Dis que la fonctionnalité n''existe pas, pas qu''elle est vide. '
                      || 'Une intervention signée est un accusé de réalisation, PAS un contentement.',
      'risqueDeDepart', 'Incalculable : aucun contrat récurrent ni abonnement dans le modèle, '
                        || 'ancienneté souvent inconnue, et aucun outil ne balaie le portefeuille '
                        || 'par récence. Ne produis aucun score.',
      'portefeuille', 'Cet outil regarde UN client. Aucun classement, aucune moyenne, aucune '
                      || 'concentration : il n''existe aucun outil qui parcoure la base clients.',
      'comportementDePaiement', 'Ne juge pas s''il est « bon payeur ». Rends les faits — facturé, '
                                || 'encaissé, en retard — et arrête-toi là : un verdict de '
                                || 'comportement demande un historique que cette base n''a pas.',
      'consultationDuPortail', 'Aucun accès au portail client n''est exploitable comme signal '
                               || 'd''engagement : le mécanisme existe mais n''est pas alimenté.'),

    'confiance', case
      when cardinality(v_manque) > 0 then 'insufficient_data'
      when not v_a_des_donnees       then 'insufficient_data'
      else 'high'   -- tout est lu dans des registres, rien n'est estimé
    end
  );
end;
$$;

comment on function public.ai_customer_value(uuid) is
  'Customer Agent : ce qu''UN client a été devisé, facturé et a réellement payé, en centimes entiers. Un droit manquant rend le bloc null et se nomme — jamais zéro.';
