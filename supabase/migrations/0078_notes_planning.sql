-- Oasis Care — LA NOTE DE PLANNING.
--
-- À exécuter après 0077. Idempotente : rejouable deux fois de suite
-- sans effet supplémentaire.
--
-- ============================================================
-- CE QUE C'EST, ET CE QUE CE N'EST PAS
-- ============================================================
--
-- « Le planning, avec la possibilité de mettre des notes. » Ce que le
-- paysagiste écrit le matin sur le coin de son écran : « livraison
-- paillage 14 h », « dépôt fermé », « équipe B en formation ». Une
-- consigne d'exploitation, posée sur une JOURNÉE, lue par tout le
-- monde.
--
-- CE N'EST PAS le champ `field_interventions.notes` (0051, ligne 112),
-- qui existe déjà et qu'on ne touche pas. Celui-là est le compte rendu
-- d'UNE intervention : il regarde vers le passé, et il disparaît le
-- jour où l'intervention est déplacée ou annulée. Or « livraison
-- paillage 14 h » n'est attaché à aucune intervention — l'écrire dans
-- la note d'une intervention voisine, c'est le perdre.
--
-- CE N'EST PAS UNE TÂCHE. Pas d'échéance, pas de « fait / pas fait »,
-- pas d'assignation. `crm_activities` (0044, lignes 202-228) a déjà
-- construit cet objet-là pour le client, et il est nettement plus
-- lourd. Le besoin exprimé est « mettre des notes ». Le jour où une
-- échéance est réellement demandée, elle se traitera par une
-- intervention de type 'other', qui existe déjà.
--
-- CE N'EST PAS UN MODULE D'ABSENCES. Il n'existe aujourd'hui dans le
-- schéma aucune table de congé, de jour férié ni de disponibilité —
-- vérifié sur les 77 migrations précédentes et sur
-- `information_schema`. Une note qui dirait « Paul en congé » deviendra
-- donc un doublon LE JOUR où ce module arrivera. D'où le nom
-- `planning_day_notes`, délibérément étroit : il ne préempte pas le
-- nom que ce module voudra prendre.
--
-- CE N'EST PAS UN PENSE-BÊTE PRIVÉ. La note est visible de toute
-- l'entreprise, et c'est le point : une livraison que le chef d'équipe
-- qui réceptionne ne voit pas ne sert à rien. Le besoin privé est
-- couvert ailleurs, et explicitement par utilisateur
-- (`user_favorites`, `user_recent_items`, 0060 lignes 373-410).

-- ============================================================
-- 1. La table
-- ============================================================

create table if not exists public.planning_day_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  -- UNE DATE, PAS UN HORODATAGE, et la date de PARIS.
  --
  -- « Équipe B en formation » n'a pas d'heure. Lui en donner une
  -- obligerait à en inventer une, puis à la reconvertir à l'affichage,
  -- et rejouerait exactement le décalage que 0066 vient de corriger :
  -- Supabase tourne en UTC, et entre minuit et deux heures du matin
  -- (heure d'été de Paris) la journée parisienne a commencé mais pas
  -- celle du serveur.
  --
  -- Conséquence concrète du défaut, si l'on avait pris `current_date` :
  -- une note saisie le mardi à 00 h 30 serait rangée au LUNDI, et le
  -- chef d'équipe qui ouvre son planning mardi matin ne la verrait pas.
  -- Une `date` calculée à Paris ne peut plus dériver ensuite : un
  -- `date` n'a pas de fuseau, donc la note du lundi reste au lundi quoi
  -- que fasse le navigateur qui l'affiche.
  --
  -- Même convention que `equipment_assignments.started_on` (0067:253)
  -- et `equipment_maintenance.performed_on` (0067:285).
  day date not null default (now() at time zone 'Europe/Paris')::date,

  -- FACULTATIVE, et c'est ce qui permet à une seule table de porter les
  -- deux besoins :
  --   NULL          → la note concerne toute l'entreprise
  --                   (« férié », « dépôt fermé », « réunion 8 h »)
  --   renseignée    → elle concerne cette équipe-là
  --                   (« équipe B en formation »), et l'écran la range
  --                   dans la bande de couleur de l'équipe.
  --
  -- `on delete set null` et non `cascade` : dissoudre une équipe ne
  -- doit pas effacer la consigne. Elle redevient une note d'entreprise,
  -- ce qui est visible, plutôt que de disparaître, ce qui ne l'est pas.
  team_id uuid references public.teams (id) on delete set null,

  -- UNE NOTE EST UNE NOTE, PAS UN DOCUMENT. Cinq cents caractères, soit
  -- une bonne dizaine de lignes : de quoi écrire une consigne, pas de
  -- quoi coller un compte rendu de chantier — qui a déjà sa place sur
  -- l'intervention.
  --
  -- Le plancher compte autant que le plafond : une note vide est un
  -- accident de saisie, pas une donnée, et elle occuperait une place
  -- sur l'écran sans rien y dire. `btrim` parce qu'une note faite de
  -- trois espaces est vide aussi.
  body text not null
    constraint planning_day_notes_body_bounded
    check (btrim(body) <> '' and char_length(body) <= 500),

  -- QUI L'A ÉCRITE. Sans nom, une consigne posée sur le planning de
  -- lundi ne se conteste pas et ne se corrige pas : on ne sait pas à
  -- qui demander. `on delete set null` : le départ d'un salarié ne
  -- doit pas emporter les consignes de l'entreprise.
  --
  -- La valeur par défaut évite que l'écran l'oublie ; le déclencheur de
  -- la section 3 fait mieux que l'espérer.
  created_by uuid references auth.users (id) on delete set null default auth.uid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.planning_day_notes is
  'Les notes libres du planning : une consigne d''exploitation posée sur une journée, visible de toute l''entreprise. À ne pas confondre avec field_interventions.notes, qui est le compte rendu d''une intervention.';
comment on column public.planning_day_notes.day is
  'La journée concernée, en date de PARIS (voir 0066). Une date et non un horodatage : une consigne de journée n''a pas d''heure, et un timestamptz redériverait d''un fuseau à l''autre.';
comment on column public.planning_day_notes.team_id is
  'NULL = la note concerne toute l''entreprise. Renseignée = elle ne concerne que cette équipe.';
comment on column public.planning_day_notes.created_by is
  'L''auteur, affiché avec la note. Immuable : une correction par un collègue ne réécrit pas la signature.';

-- La seule requête de l'écran : « les notes de ces sept jours ». Rien
-- d'autre n'est indexé, parce que rien d'autre ne sera demandé — un
-- index par équipe servirait un filtre qui se fait déjà côté client sur
-- sept jours de lignes.
create index if not exists planning_day_notes_day_idx
  on public.planning_day_notes (organization_id, day);

-- ============================================================
-- 2. L'équipe désignée appartient-elle bien à l'entreprise ?
-- ============================================================
-- LA FAILLE DE 0062, REPRISE ICI AVANT QU'ELLE NE SOIT CREUSÉE.
--
-- La politique d'écriture ci-dessous ne demande qu'une chose : « as-tu
-- le droit d'écrire dans l'organisation que tu viens de désigner ? ».
-- Elle porte sur `organization_id`, c'est-à-dire sur une colonne que
-- l'auteur de la ligne choisit lui-même. La réponse est oui, puisqu'il
-- y met la sienne. Rien là-dedans ne regarde L'AUTRE BOUT de la ligne.
--
-- Sans ce déclencheur, un professionnel d'une autre entreprise pourrait
-- écrire, dans SA propre organisation, une note portant l'identifiant
-- d'une équipe qui n'est pas la sienne. La note resterait invisible du
-- voisin — la RLS de lecture s'en charge — mais l'écran de son auteur
-- afficherait une équipe étrangère, et tout futur rapport qui joindrait
-- notes et équipes recollerait deux mondes qui n'ont rien à voir.
-- C'est très exactement le motif que 0062 a dû réparer sur trois
-- tables, et qu'on ne redémarre pas ici.
--
-- `security definer` : la vérification doit voir l'équipe visée même
-- quand la RLS de l'appelant la lui cache, sinon « pas à vous » et
-- « n'existe pas » se confondent — le refus serait le bon, pour la
-- mauvaise raison, et il se relâcherait le jour où une politique de
-- lecture s'élargit. La fonction ne rend jamais un contenu, seulement
-- un refus.
create or replace function public.planning_day_note_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is not null and not exists (
    select 1 from public.teams t
     where t.id = new.team_id and t.organization_id = new.organization_id
  ) then
    raise exception 'Cette équipe n''appartient pas à la même entreprise que la note.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_planning_day_note_same_org on public.planning_day_notes;
create trigger trg_planning_day_note_same_org
  before insert or update on public.planning_day_notes
  for each row execute function public.planning_day_note_same_org();

-- ============================================================
-- 3. La signature ne se vole pas, l'horodatage ne s'oublie pas
-- ============================================================
-- La section 4 laisse tout détenteur de `projects.manage` corriger la
-- note d'un collègue — c'est voulu, voir plus bas. Mais corriger n'est
-- pas signer : si `created_by` pouvait être réécrit, afficher l'auteur
-- serait afficher un mensonge, et il vaudrait mieux ne pas l'afficher
-- du tout.
--
-- À l'insertion, l'auteur est celui qui écrit, pas celui que la requête
-- déclare. `coalesce` parce que les migrations et les scripts
-- d'administration tournent sans utilisateur connecté : leur laisser
-- poser un auteur explicite est légitime, se le voir imposer à NULL ne
-- le serait pas.
--
-- `clock_timestamp()` et non `now()`, contrairement au reste du projet
-- qui écrit `updated_at = now()` à la main dans ses fonctions :
-- `now()` est figé à l'ouverture de la transaction, si bien qu'une
-- note écrite puis corrigée dans la même transaction porterait deux
-- horodatages identiques — « modifiée » deviendrait indistinguable de
-- « écrite », et l'écran qui affiche « corrigée à … » mentirait.
-- Les deux dates sont prises sur la même lecture de l'horloge à
-- l'insertion, pour qu'une note jamais corrigée les ait rigoureusement
-- égales.
create or replace function public.planning_day_note_signature()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  maintenant timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := maintenant;
    new.updated_at := maintenant;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := maintenant;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_planning_day_note_signature on public.planning_day_notes;
create trigger trg_planning_day_note_signature
  before insert or update on public.planning_day_notes
  for each row execute function public.planning_day_note_signature();

-- ============================================================
-- 4. RLS — le même couple que les interventions
-- ============================================================
-- `projects.read` pour lire, `projects.manage` pour écrire : le couple
-- posé en 0051 (lignes 305-330) pour les interventions, les équipes et
-- les pointages, et repris tel quel en 0067 pour le matériel. Une note
-- de planning est un accessoire du planning ; lui inventer un troisième
-- droit obligerait à l'accorder séparément dans chaque rôle, et
-- quelqu'un finirait par pouvoir écrire des consignes sans pouvoir
-- planifier.
--
-- QUI PEUT ÉCRIRE UNE NOTE ? Celui qui peut planifier. `fieldWorker`,
-- qui n'a que `projects.read` (0043:129), lit les consignes du matin
-- mais n'en pose pas — c'est le bon partage : la consigne engage
-- l'exploitation.
--
-- QUI PEUT MODIFIER CELLE D'UN AUTRE ? Le même. Une consigne
-- d'exploitation fausse doit pouvoir être corrigée par le premier
-- responsable qui la voit, y compris quand son auteur est sur un
-- chantier sans réseau. Réserver la correction à l'auteur donnerait des
-- consignes périmées que personne n'a le droit d'effacer — le contraire
-- du service rendu. La traçabilité est assurée autrement : `created_by`
-- est immuable (section 3), et l'écran affiche l'auteur.
--
-- Ces politiques ne portent QUE sur `organization_id`, la colonne de la
-- ligne elle-même. C'est suffisant ICI, et seulement ici, parce que
-- l'autre bout de la ligne — l'équipe — est tenu par le déclencheur de
-- la section 2, et non par une relecture attentive de ce qui suit.

alter table public.planning_day_notes enable row level security;

drop policy if exists "Members with projects.read can read planning_day_notes"
  on public.planning_day_notes;
create policy "Members with projects.read can read planning_day_notes"
  on public.planning_day_notes
  for select using (public.has_permission(organization_id, 'projects.read'));

drop policy if exists "Members with projects.manage can write planning_day_notes"
  on public.planning_day_notes;
create policy "Members with projects.manage can write planning_day_notes"
  on public.planning_day_notes
  for all using (public.has_permission(organization_id, 'projects.manage'))
  with check (public.has_permission(organization_id, 'projects.manage'));
