-- Oasis Care — §11Y, LES DEUX FONCTIONS DE L'AGENT MATÉRIEL.
--
-- ============================================================
-- CE FICHIER N'EST PAS UNE MIGRATION. IL EST À COLLER DANS 0082
-- ============================================================
--
-- `supabase/migrations/0082_agents_ia.sql` appartient à l'intégration :
-- plusieurs agents y ajoutent leur nom à `ai_is_supported_agent`, et
-- une seule main peut écrire dans ce fichier à la fois. Le corps des
-- deux fonctions ci-dessous vit donc chez son agent —
-- `runtime/outils/` — jusqu'à ce que l'intégration le recopie dans
-- 0082, TEL QUEL.
--
-- Elles ont été ÉPROUVÉES SUR LA PRODUCTION, dans une transaction
-- annulée : créées, appelées sur un parc fabriqué pour l'occasion,
-- leurs sorties relues une à une, puis « rollback ». Voir
-- `fleet.epreuve.sql`, qui est le test correspondant et qui a sa place
-- dans `supabase/tests/agents_ia.sql`.
--
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
