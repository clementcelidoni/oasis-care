-- Oasis Care — §11Y, LA VUE DE PARC DE L'AGENT CHANTIERS.
--
-- ============================================================
-- CE FICHIER N'EST PAS UNE MIGRATION. IL EST À COLLER DANS 0082
-- ============================================================
--
-- `supabase/migrations/0082_agents_ia.sql` appartient à l'intégration :
-- six agents y ajoutent leur nom à `ai_is_supported_agent`, et une
-- seule main peut écrire dans ce fichier à la fois. Le corps de la
-- fonction ci-dessous vit donc chez son agent — `runtime/outils/` —
-- jusqu'à ce que l'intégration le recopie dans 0082, TEL QUEL.
--
-- Il a été ÉPROUVÉ SUR LA PRODUCTION, dans une transaction annulée :
-- créé, appelé sur les données réelles de l'unique entreprise, ses
-- sorties relues une à une, puis « rollback ». Voir
-- `operations.epreuve.sql`, qui est le test correspondant et qui a sa
-- place dans `supabase/tests/agents_ia.sql`.
--
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
