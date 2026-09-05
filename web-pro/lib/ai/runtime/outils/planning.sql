-- Oasis Care — §11Y, LA SYNTHÈSE DE PLANNING DE L'AGENT PLANNING.
--
-- ============================================================
-- CE FICHIER N'EST PAS UNE MIGRATION. IL EST À COLLER DANS 0082
-- ============================================================
--
-- `supabase/migrations/0082_agents_ia.sql` appartient à l'intégration.
-- Le corps de la fonction vit donc chez son agent jusqu'à ce qu'elle
-- l'y recopie, TEL QUEL. Il a été éprouvé sur la production dans une
-- transaction annulée ; le test correspondant est
-- `planning.epreuve.sql`, à verser dans `supabase/tests/agents_ia.sql`.
--
-- Il convertit la ligne « getPlanningSummary : absent » de
-- `OUTILS_SPEC_SANS_SERVICE` (runtime/tools.ts), qui doit passer à
-- « couvert » dans le même commit — sinon `tools.test.ts` échoue, et il
-- a raison : un outil déclaré absent ET présent au registre, c'est l'un
-- des deux qui ment.
--
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
