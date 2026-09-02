-- Oasis Care — Phase 11, AMÉLIORATION MAJEURE : §5 GESTION → MATÉRIEL.
--
-- À exécuter après 0066. Idempotente et purement additive.
--
-- §5 listait « Matériel » dans le menu Gestion sans qu'aucun milestone
-- ne le programme : l'entrée était marquée `UNSCHEDULED` et affichée
-- « à venir ». §21 en donne le contenu recherchable — « véhicules ;
-- machines ; immatriculations ; numéros internes ; catégories » — ce
-- qui décrit l'IDENTITÉ d'un matériel, pas encore ce qu'un paysagiste
-- vient y chercher.
--
-- CE QUI GOUVERNE CE FICHIER. Une liste de camions n'apprend rien à
-- personne : l'entreprise sait très bien qu'elle a un Master et une
-- mini-pelle. Ce qu'elle ne sait pas, et ce qui coûte cher, c'est que
-- le contrôle technique du Master expire dans douze jours. Une
-- immobilisation en préfecture, une assurance lapsée le jour d'un
-- sinistre, une nacelle dont la vérification générale périodique est
-- dépassée sur un chantier contrôlé : ce sont des montants à quatre
-- chiffres, et ils tombent tous parce qu'une date est passée sans que
-- personne la regarde.
--
-- D'où quatre tables et non une : ce que le matériel EST, ce qui
-- EXPIRE dessus, où il EST AUJOURD'HUI, et ce qu'on lui a FAIT.
--
-- CE QUE CE FICHIER NE FAIT PAS, délibérément :
--   • aucun amortissement comptable — c'est le métier de l'expert, les
--     règles changent, et un plan d'amortissement faux vaut moins que
--     pas de plan du tout ;
--   • aucune facturation du matériel à un chantier — §16 « NE PAS
--     créer un deuxième moteur commercial » ; le coût d'entretien est
--     enregistré, il n'est pas refacturé ;
--   • aucune géolocalisation — le produit n'a pas de boîtier, et
--     inventer une position serait mentir.

-- ============================================================
-- 1. Le matériel
-- ============================================================
-- §21 « véhicules ; machines ; immatriculations ; numéros internes ;
-- catégories ». Le camion, la mini-pelle, l'autoportée, le taille-haie.

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  name text not null,

  -- Les catégories d'un PAYSAGISTE, pas celles d'un loueur généraliste.
  -- Elles servent à filtrer un parc de trente machines, et à savoir du
  -- premier coup d'œil qu'un engin de levage n'a pas les mêmes
  -- obligations qu'une tondeuse.
  category text not null default 'other' check (category in (
    'vehicle',      -- camion, fourgon, benne
    'trailer',      -- remorque, porte-engin
    'earthmoving',  -- mini-pelle, chargeuse, dumper
    'mower',        -- autoportée, tondeuse, robot
    'cutting',      -- taille-haie, débroussailleuse, tronçonneuse
    'lifting',      -- nacelle, grue, chariot — contrôle réglementaire
    'soil',         -- motoculteur, rotavator, broyeur
    'irrigation',   -- pompe, enrouleur, groupe
    'workshop',     -- outillage d'atelier
    'other'
  )),

  brand text,
  model text,
  serial_number text,

  -- §21 « numéros internes » : le numéro peint sur la portière, celui
  -- que le chef d'équipe donne au téléphone. Il n'a rien à voir avec
  -- l'identifiant technique, que personne ne prononcera jamais.
  internal_number text,

  -- §21 « immatriculations ». Vide pour une tondeuse, obligatoire pour
  -- un camion — d'où une colonne facultative plutôt qu'une table
  -- « véhicules » séparée : les trois quarts des colonnes seraient les
  -- mêmes, et il faudrait choisir un camp pour une remorque.
  registration text,

  -- ----- La propriété -----------------------------------------
  ownership text not null default 'owned' check (ownership in (
    'owned',   -- acheté
    'rented',  -- loué
    'leased'   -- crédit-bail / LOA
  )),
  acquired_on date,
  -- En centimes entiers, comme partout ailleurs dans le produit : un
  -- `numeric` en euros finit toujours par produire un centime
  -- fantôme à l'addition.
  acquisition_cost_cents bigint check (acquisition_cost_cents is null or acquisition_cost_cents >= 0),
  supplier_id uuid references public.suppliers (id) on delete set null,

  -- ----- Le compteur -------------------------------------------
  -- La NATURE du compteur seulement. Sa VALEUR n'est pas stockée ici :
  -- voir `equipment_overview` et le commentaire qui l'accompagne.
  meter_kind text not null default 'none' check (meter_kind in ('none', 'hours', 'kilometers')),

  status text not null default 'active' check (status in (
    'active',        -- en service
    'maintenance',   -- à l'atelier
    'outOfService',  -- immobilisé
    'retired'        -- sorti du parc
  )),

  notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- LA CLÉ QUI FERME LE CLOISONNEMENT DES TABLES FILLES.
  --
  -- Redondante en apparence — `id` est déjà la clé primaire — mais
  -- c'est elle qui permet aux trois tables ci-dessous de référencer
  -- (equipment_id, organization_id) EN BLOC. Sans cela, une politique
  -- RLS écrite `has_permission(organization_id, …)` autoriserait un
  -- confrère à accrocher une ligne d'entretien au camion de son voisin
  -- en indiquant SA propre organisation : la politique demande « as-tu
  -- le droit d'écrire chez toi ? », la réponse est oui, et rien ne
  -- vérifie l'autre bout de la ligne. C'est exactement la faille que
  -- la migration 0062 a dû réparer ailleurs. Une contrainte
  -- d'intégrité, elle, ne dépend d'aucune relecture de politique.
  constraint equipment_id_org_unique unique (id, organization_id)
);

comment on table public.equipment is
  'Le parc matériel (§5, §21). Une ligne par machine, véhicule ou engin.';
comment on column public.equipment.internal_number is
  'Le numéro peint sur la machine (§21), pas un identifiant technique.';
comment on column public.equipment.meter_kind is
  'Nature du compteur. La VALEUR courante se lit dans equipment_overview.';

create index if not exists equipment_org_idx
  on public.equipment (organization_id, name)
  where archived_at is null;

create index if not exists equipment_category_idx
  on public.equipment (organization_id, category)
  where archived_at is null;

-- Deux véhicules ne partagent pas une plaque, et deux machines ne
-- partagent pas un numéro interne : sinon le chef d'équipe qui annonce
-- « le 12 est en panne » désigne deux engins.
--
-- Insensible à la casse et aux espaces : « AB-123-CD », « ab 123 cd »
-- et « AB123CD » sont la même plaque, et laisser passer le doublon
-- reviendrait à ne rien vérifier du tout.
create unique index if not exists equipment_internal_number_idx
  on public.equipment (organization_id, upper(btrim(internal_number)))
  where internal_number is not null and btrim(internal_number) <> '' and archived_at is null;

create unique index if not exists equipment_registration_idx
  on public.equipment (organization_id, upper(replace(replace(registration, ' ', ''), '-', '')))
  where registration is not null and btrim(registration) <> '' and archived_at is null;

-- ============================================================
-- 2. Les échéances — la vraie valeur du module
-- ============================================================
-- Contrôle technique, assurance, révision, vérification générale
-- périodique d'un engin de levage, fin de location. Ce sont des DATES,
-- et une date oubliée est le seul défaut de ce module qui se paie
-- comptant.
--
-- Une table plutôt que six colonnes sur `equipment` : une entreprise a
-- deux assurances sur le même camion, ou trois contrôles réglementaires
-- sur la même nacelle, et l'HISTORIQUE compte — savoir quand le
-- dernier contrôle a été passé vaut autant que savoir quand le
-- prochain tombe.

create table if not exists public.equipment_deadlines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  equipment_id uuid not null,

  kind text not null default 'other' check (kind in (
    'technicalInspection',  -- contrôle technique
    'insurance',            -- assurance
    'service',              -- révision périodique
    'regulatoryCheck',      -- VGP, contrôle réglementaire (levage)
    'leaseEnd',             -- fin de location ou de crédit-bail
    'warranty',             -- fin de garantie
    'other'
  )),
  -- La précision libre : « Contrôle technique poids lourd »,
  -- « Assurance flotte — contrat 1234567 ». Le `kind` range, le
  -- `label` renseigne.
  label text,

  due_on date not null,

  -- Le préavis, par échéance. Trente jours pour un contrôle technique,
  -- quatre-vingt-dix pour une fin de crédit-bail qu'il faut négocier.
  -- Un délai global unique obligerait à choisir entre alerter trop tôt
  -- sur tout et trop tard sur l'essentiel.
  --
  -- ZÉRO EST UNE VALEUR LÉGITIME (« préviens-moi le jour même ») : le
  -- code web qui lit ce champ doit distinguer « vide » de « 0 », faute
  -- de quoi il retombera sur 30 comme une TVA à 0 % retombait à 20 %.
  reminder_days int not null default 30 check (reminder_days >= 0),

  -- Une échéance qui revient. NULL = ponctuelle (une fin de garantie ne
  -- se renouvelle pas).
  recurrence_months int check (recurrence_months is null or recurrence_months > 0),

  -- Quand elle a été honorée. Tant que c'est NULL, elle court.
  completed_on date,
  completed_cost_cents bigint check (completed_cost_cents is null or completed_cost_cents >= 0),
  completed_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Voir le commentaire de `equipment_id_org_unique` : c'est la
  -- contrainte, et non la politique RLS, qui interdit d'accrocher une
  -- échéance au matériel d'une autre entreprise.
  constraint equipment_deadlines_equipment_fk
    foreign key (equipment_id, organization_id)
    references public.equipment (id, organization_id) on delete cascade
);

comment on table public.equipment_deadlines is
  'Ce qui expire sur un matériel : contrôle technique, assurance, révision, VGP, fin de contrat.';

create index if not exists equipment_deadlines_due_idx
  on public.equipment_deadlines (organization_id, due_on)
  where completed_on is null;

create index if not exists equipment_deadlines_equipment_idx
  on public.equipment_deadlines (equipment_id, due_on);

-- ============================================================
-- 3. L'affectation — où il est aujourd'hui
-- ============================================================
-- « À quel chantier ou à quelle équipe il est aujourd'hui. » Une table
-- d'affectations DATÉES plutôt qu'une colonne `current_project_id` :
-- une colonne écrase l'histoire, et la question « qui avait la
-- mini-pelle la semaine où elle est tombée en panne » n'aurait plus de
-- réponse.

create table if not exists public.equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  equipment_id uuid not null,

  -- Les trois destinataires possibles. `on delete set null` et non
  -- `cascade` : supprimer un chantier ne doit pas effacer la trace que
  -- la nacelle y a passé trois semaines.
  project_id uuid references public.projects (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  employee_id uuid references public.employees (id) on delete set null,

  -- La date de Paris, pas celle du serveur : voir la section 5. Une
  -- affectation saisie à minuit et demi porterait sinon la veille.
  started_on date not null default (now() at time zone 'Europe/Paris')::date,
  ended_on date,
  notes text,

  created_at timestamptz not null default now(),

  constraint equipment_assignments_equipment_fk
    foreign key (equipment_id, organization_id)
    references public.equipment (id, organization_id) on delete cascade,

  -- Une affectation sans destinataire ne veut rien dire : c'est
  -- l'absence d'affectation ouverte qui signifie « au dépôt ».
  constraint equipment_assignments_target check (
    project_id is not null or team_id is not null or employee_id is not null),

  constraint equipment_assignments_dates check (
    ended_on is null or ended_on >= started_on)
);

comment on table public.equipment_assignments is
  'Où le matériel se trouve, et depuis quand. Aucune ligne ouverte = au dépôt.';

-- UN SEUL ENGIN À UN SEUL ENDROIT À LA FOIS.
--
-- Sans cet index, rien n'empêche d'affecter la mini-pelle à deux
-- chantiers le même jour : les deux conducteurs de travaux la
-- compteraient chacun dans son planning, et l'un des deux la
-- chercherait un lundi matin.
create unique index if not exists equipment_assignments_open_idx
  on public.equipment_assignments (equipment_id)
  where ended_on is null;

create index if not exists equipment_assignments_project_idx
  on public.equipment_assignments (project_id, started_on desc);

/**
 * Les trois références d'une affectation appartiennent-elles bien à la
 * même entreprise que le matériel ?
 *
 * `projects`, `teams` et `employees` ne portent pas de clé
 * `(id, organization_id)` — ce sont les tables d'autres modules, et
 * leur en ajouter une depuis ici serait modifier le schéma du voisin.
 * D'où ce déclencheur, qui fait le même travail que les clés composites
 * ci-dessus.
 *
 * `security definer` : la vérification doit voir la ligne visée même
 * quand la RLS de l'appelant la lui cache. Elle ne divulgue rien — elle
 * ne rend qu'un refus, jamais un contenu.
 */
create or replace function public.equipment_assignment_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p
     where p.id = new.project_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Ce chantier n''appartient pas à la même entreprise que le matériel.';
  end if;

  if new.team_id is not null and not exists (
    select 1 from public.teams t
     where t.id = new.team_id and t.organization_id = new.organization_id
  ) then
    raise exception 'Cette équipe n''appartient pas à la même entreprise que le matériel.';
  end if;

  if new.employee_id is not null and not exists (
    select 1 from public.employees e
     where e.id = new.employee_id and e.organization_id = new.organization_id
  ) then
    raise exception 'Ce salarié n''appartient pas à la même entreprise que le matériel.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_equipment_assignment_same_org on public.equipment_assignments;
create trigger trg_equipment_assignment_same_org
  before insert or update on public.equipment_assignments
  for each row execute function public.equipment_assignment_same_org();

-- ============================================================
-- 4. L'entretien — le journal
-- ============================================================
-- « Un journal d'interventions, avec le coût et le compteur. »
--
-- Le compteur vit ICI, sur l'événement daté qui l'a relevé, et non sur
-- la fiche du matériel. C'est le quatrième défaut connu de ce projet
-- retourné à l'envers : une valeur recopiée sur la fiche resterait
-- trop haute si l'on supprimait la ligne qui l'avait produite. Un
-- `max()` recalculé voit la suppression ; un cache ne la voit jamais.

create table if not exists public.equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  equipment_id uuid not null,

  performed_on date not null default (now() at time zone 'Europe/Paris')::date,

  kind text not null default 'service' check (kind in (
    'service',     -- révision, vidange
    'repair',      -- réparation, panne
    'inspection',  -- passage au contrôle
    'tyres',       -- pneumatiques, chenilles
    'consumable',  -- lames, filtres, chaînes
    'reading',     -- relevé de compteur seul
    'other'
  )),

  -- Facultative : un relevé de compteur n'a rien à décrire, et un champ
  -- obligatoire ferait taper « relevé » cinquante fois.
  description text,

  -- Zéro est légitime : une révision sous garantie coûte réellement
  -- zéro euro, et ce n'est pas la même chose qu'un coût inconnu.
  cost_cents bigint not null default 0 check (cost_cents >= 0),

  -- Heures ou kilomètres selon `equipment.meter_kind`. NULL quand on
  -- n'a pas relevé — surtout pas 0, qui ramènerait la machine à sa
  -- sortie d'usine.
  meter_reading numeric(12, 1) check (meter_reading is null or meter_reading >= 0),

  supplier_id uuid references public.suppliers (id) on delete set null,

  -- L'échéance que cette intervention honore, quand il y en a une : le
  -- passage au contrôle technique EST la réponse à l'échéance
  -- « contrôle technique ». Le lien permet de retrouver la facture
  -- depuis la date, et inversement.
  --
  -- Clé SIMPLE, contrairement à `equipment_id` juste au-dessus : un
  -- `on delete set null` sur une clé composite annulerait TOUTES ses
  -- colonnes, `organization_id` comprise — qui est `not null`. La
  -- suppression échouerait alors, et l'échéance deviendrait
  -- indestructible. Le cloisonnement est assuré autrement, par le
  -- déclencheur qui suit.
  deadline_id uuid references public.equipment_deadlines (id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint equipment_maintenance_equipment_fk
    foreign key (equipment_id, organization_id)
    references public.equipment (id, organization_id) on delete cascade
);

/**
 * Une intervention ne peut honorer qu'une échéance de SON matériel.
 *
 * Invariant plus fort que le simple cloisonnement par entreprise, et
 * plus utile : rattacher la vidange de la tondeuse au contrôle
 * technique du camion produirait un journal cohérent en apparence et
 * faux en substance. Comme le matériel est déjà lié à son entreprise
 * par une clé composite, vérifier le matériel suffit à vérifier
 * l'entreprise.
 *
 * `security definer` pour la même raison que le déclencheur des
 * affectations : refuser, sans dépendre de ce que la RLS laisse voir.
 */
create or replace function public.equipment_maintenance_deadline_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deadline_id is not null and not exists (
    select 1 from public.equipment_deadlines d
     where d.id = new.deadline_id and d.equipment_id = new.equipment_id
  ) then
    raise exception 'Cette échéance ne concerne pas ce matériel.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_equipment_maintenance_deadline on public.equipment_maintenance;
create trigger trg_equipment_maintenance_deadline
  before insert or update on public.equipment_maintenance
  for each row execute function public.equipment_maintenance_deadline_matches();

comment on table public.equipment_maintenance is
  'Journal d''entretien : ce qu''on a fait, ce que ça a coûté, et le compteur ce jour-là.';

create index if not exists equipment_maintenance_equipment_idx
  on public.equipment_maintenance (equipment_id, performed_on desc);

create index if not exists equipment_maintenance_org_idx
  on public.equipment_maintenance (organization_id, performed_on desc);

-- ============================================================
-- 5. Ce qui expire, calculé une fois
-- ============================================================
-- « AUJOURD'HUI » SE COMPTE À PARIS.
--
-- La migration 0066 a corrigé sept comparaisons qui utilisaient
-- `current_date` — le fuseau du serveur, UTC chez Supabase. Entre
-- minuit et deux heures du matin l'heure d'été, la journée parisienne a
-- commencé mais pas celle du serveur : une échéance du jour se serait
-- affichée « demain ». On ne refait pas l'erreur ici.

-- `equipment_overview` (section 6) LIT cette vue-ci. On la démonte donc
-- d'abord : à la deuxième exécution, un `drop view` sur une vue dont
-- une autre dépend échoue, et la migration cesserait d'être rejouable.
drop view if exists public.equipment_overview;
drop view if exists public.equipment_due_dates;

create view public.equipment_due_dates as
with repere as (
  select (now() at time zone 'Europe/Paris')::date as today
)
select
  d.id                as deadline_id,
  d.organization_id,
  d.equipment_id,
  e.name              as equipment_name,
  e.category,
  e.registration,
  e.internal_number,
  e.status            as equipment_status,
  d.kind,
  d.label,
  d.due_on,
  d.reminder_days,
  d.recurrence_months,
  d.completed_on,
  -- Négatif = en retard. Un entier de jours, pas un intervalle : c'est
  -- ce qu'on écrit à l'écran (« dans 12 jours », « 3 jours de retard »).
  (d.due_on - r.today)::int as days_left,
  case
    when d.completed_on is not null                 then 'done'
    when d.due_on < r.today                          then 'overdue'
    when d.due_on <= r.today + d.reminder_days       then 'dueSoon'
    else                                                  'planned'
  end as state
from public.equipment_deadlines d
join public.equipment e on e.id = d.equipment_id
cross join repere r
-- Un matériel archivé ne réclame plus rien : relancer sur le contrôle
-- technique d'un camion vendu ferait perdre confiance dans toutes les
-- autres alertes.
where e.archived_at is null;

alter view public.equipment_due_dates set (security_invoker = true);

comment on view public.equipment_due_dates is
  'Les échéances du parc, avec leur état calculé à la date de Paris.';

-- ============================================================
-- 6. La synthèse par matériel
-- ============================================================

-- Déjà démontée en tête de la section 5, avec la vue dont elle dépend.

create view public.equipment_overview as
select
  e.id            as equipment_id,
  e.organization_id,

  -- L'IDENTITÉ REPRISE ICI, et ce n'est pas de la duplication
  -- décorative : c'est ce qui permet à l'écran de chercher, filtrer,
  -- TRIER PAR URGENCE et paginer en UNE seule requête.
  --
  -- L'alternative — lire `equipment` d'un côté, la synthèse de
  -- l'autre, et recoller en JavaScript — obligerait à trier hors de la
  -- base, donc à charger tout le parc pour afficher vingt-cinq lignes,
  -- et à choisir entre une pagination fausse et une page lente. Un tri
  -- « par urgence » qui ne porterait que sur la page affichée
  -- montrerait le camion le plus urgent... de la page 3.
  e.name,
  e.category,
  e.brand,
  e.model,
  e.serial_number,
  e.internal_number,
  e.registration,
  e.ownership,
  e.acquired_on,
  e.acquisition_cost_cents,
  e.supplier_id,
  e.meter_kind,
  e.status,
  e.notes,
  e.archived_at,

  -- LE COMPTEUR COURANT N'EST PAS STOCKÉ. Voir le commentaire de
  -- `equipment_maintenance` : recalculé, il suit une suppression ;
  -- recopié, il resterait figé sur une relève effacée.
  --
  -- NULL quand aucune relève n'existe. Surtout pas 0 : « on n'a jamais
  -- relevé » et « la machine n'a jamais tourné » sont deux
  -- affirmations différentes, et l'une des deux est fausse.
  --
  -- LA DERNIÈRE RELÈVE, PAS LA PLUS HAUTE. Un compteur ne monte
  -- normalement jamais, et les deux définitions coïncident presque
  -- toujours — mais pas quand on remplace un moteur, ni quand on
  -- corrige après coup une saisie trop généreuse. `max()` garderait
  -- alors l'ancienne valeur pour toujours, sans que rien ne le dise.
  -- Et cette forme-ci est celle qui s'accorde avec `meter_read_on`
  -- juste en dessous : la valeur et sa date parlent du même jour.
  (select m.meter_reading from public.equipment_maintenance m
    where m.equipment_id = e.id and m.meter_reading is not null
    order by m.performed_on desc, m.created_at desc
    limit 1) as current_meter,
  (select max(m.performed_on) from public.equipment_maintenance m
    where m.equipment_id = e.id and m.meter_reading is not null) as meter_read_on,

  (select max(m.performed_on) from public.equipment_maintenance m
    where m.equipment_id = e.id) as last_maintenance_on,

  -- Sans `coalesce` : un journal vide ne prouve pas qu'on n'a rien
  -- dépensé, il prouve qu'on n'a rien noté.
  (select sum(m.cost_cents) from public.equipment_maintenance m
    where m.equipment_id = e.id) as maintenance_cost_cents,

  (select count(*) from public.equipment_maintenance m
    where m.equipment_id = e.id) as maintenance_count,

  -- La prochaine échéance qui court, et son état. C'est la colonne que
  -- l'écran trie en premier.
  n.due_on   as next_due_on,
  n.kind     as next_due_kind,
  n.state    as next_due_state,
  n.days_left as next_due_days_left,
  (select count(*) from public.equipment_due_dates dd
    where dd.equipment_id = e.id and dd.state = 'overdue') as overdue_count,

  -- L'affectation ouverte. `left join` sur l'index unique partiel : il
  -- ne peut y en avoir qu'une, donc la jointure ne duplique pas la
  -- ligne.
  a.id          as assignment_id,
  a.project_id  as assigned_project_id,
  a.team_id     as assigned_team_id,
  a.employee_id as assigned_employee_id,
  a.started_on  as assigned_since
from public.equipment e
left join public.equipment_assignments a
       on a.equipment_id = e.id and a.ended_on is null
left join lateral (
  select dd.due_on, dd.kind, dd.state, dd.days_left
  from public.equipment_due_dates dd
  where dd.equipment_id = e.id and dd.completed_on is null
  order by dd.due_on
  limit 1
) n on true;

alter view public.equipment_overview set (security_invoker = true);

comment on view public.equipment_overview is
  'Une ligne par matériel : compteur, entretien, prochaine échéance, affectation en cours.';

-- ============================================================
-- 7. Honorer une échéance
-- ============================================================
/**
 * Marquer une échéance faite, et engendrer la suivante si elle revient.
 *
 * Une fonction plutôt que deux écritures depuis le web : la ligne
 * clôturée et celle qui la remplace doivent apparaître ensemble ou pas
 * du tout. Un incident réseau entre les deux laisserait un parc sans
 * aucun contrôle technique à venir — c'est-à-dire un parc qui a l'air
 * en règle.
 *
 * REJOUABLE : rappelée sur une échéance déjà honorée, elle ne fait rien
 * et rend NULL. Un double clic ne doit pas créer deux échéances
 * suivantes.
 */
create or replace function public.complete_equipment_deadline(
  p_deadline_id uuid,
  p_completed_on date default null,
  p_cost_cents bigint default null,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  d record;
  fait date := coalesce(p_completed_on, (now() at time zone 'Europe/Paris')::date);
  suivante uuid;
begin
  -- La RLS a déjà filtré : une échéance d'une autre entreprise ressort
  -- nulle ici, et le message ne dit rien de plus qu'« introuvable ».
  select * into d from public.equipment_deadlines where id = p_deadline_id;
  -- `not found` et non `d is null` : une ligne dont toutes les colonnes
  -- facultatives seraient vides rendrait `d is null` vrai alors qu'elle
  -- existe. Ici la ligne a toujours un `id`, donc les deux formes
  -- coïncident — mais l'une ne dépend pas de cette coïncidence.
  if not found then
    raise exception 'Échéance introuvable.';
  end if;
  if d.completed_on is not null then
    return null;
  end if;

  update public.equipment_deadlines
     set completed_on = fait,
         completed_cost_cents = p_cost_cents,
         completed_note = p_note,
         updated_at = now()
   where id = p_deadline_id;

  if d.recurrence_months is not null then
    insert into public.equipment_deadlines (
      organization_id, equipment_id, kind, label,
      -- LA SUIVANTE PART DE LA DATE RÉELLE, pas de l'ancienne échéance.
      -- Un contrôle technique passé trois semaines en avance est
      -- valable deux ans à compter du jour du contrôle : c'est ce que
      -- dit le procès-verbal, et c'est donc ce que doit dire le
      -- logiciel. Repartir de l'ancienne date avancerait la prochaine
      -- de trois semaines, tous les deux ans, indéfiniment.
      due_on, reminder_days, recurrence_months
    ) values (
      d.organization_id, d.equipment_id, d.kind, d.label,
      (fait + make_interval(months => d.recurrence_months))::date,
      d.reminder_days, d.recurrence_months
    )
    returning id into suivante;
  end if;

  return suivante;
end;
$$;

-- ============================================================
-- 8. RLS
-- ============================================================
-- Calquée sur `employees` et `teams` (migration 0051), vérifiée dans
-- `pg_policies` avant d'être écrite :
--
--     select tablename, cmd, qual from pg_policies
--      where schemaname = 'public' and tablename in ('employees', 'teams');
--
-- → lecture avec `projects.read`, écriture avec `projects.manage`.
-- Le matériel est le prolongement du chantier : qui conduit les
-- travaux dispose du parc.
--
-- Ces politiques ne portent QUE sur `organization_id`. C'est suffisant
-- ici, et seulement ici, parce que le cloisonnement de l'autre bout de
-- chaque ligne est assuré par les clés composites de la section 1 et
-- par le déclencheur de la section 3 — pas par une relecture attentive
-- de ce qui suit.

do $$
declare t text;
begin
  foreach t in array array[
    'equipment', 'equipment_deadlines', 'equipment_assignments', 'equipment_maintenance'
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
end $$;

-- ============================================================
-- 9. Les droits d'accès aux deux vues
-- ============================================================
-- `security_invoker` fait porter la RLS sur l'appelant, mais ne lui
-- donne pas le droit de LIRE la vue : ce sont deux choses distinctes.
-- Les vues du produit héritent aujourd'hui des privilèges par défaut du
-- schéma `public`, ce qui suffit — sauf le jour où ces privilèges par
-- défaut changent, et l'écran affiche alors une liste vide sans la
-- moindre erreur. Un grant explicite coûte deux lignes et retire ce
-- mode de panne.
grant select on public.equipment_due_dates to authenticated;
grant select on public.equipment_overview to authenticated;
