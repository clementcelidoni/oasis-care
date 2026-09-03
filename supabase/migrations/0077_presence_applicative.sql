-- Oasis Care — PRÉSENCE APPLICATIVE : qui utilise vraiment l'iPhone.
--
-- À exécuter après 0075 (Control Center). Idempotente, rejouable, et
-- purement additive sur les données : elle ne touche à aucune table
-- existante, n'écrit dans aucune, et ne modifie aucune politique posée
-- ailleurs. Elle REMPLACE en revanche deux fonctions de 0075
-- (`admin_platform_kpis` et `admin_list_users`), parce qu'on ne peut
-- pas ajouter une colonne au retour d'une fonction sans la recréer.
--
-- >>> À PARTIR D'ICI, LA DÉFINITION VIVANTE DE CES DEUX FONCTIONS EST
-- >>> DANS CE FICHIER. Celle de 0075 n'est plus que l'histoire : le
-- >>> corps est recopié à l'identique, seul le bloc « mobile » change.
-- >>> Toute correction future se fait ici, pas là-bas.
--
-- >>> CONSÉQUENCE OPÉRATOIRE, à connaître avant de rejouer quoi que ce
-- >>> soit : 0075 NE SE REJOUE PLUS TELLE QUELLE une fois 0077 posée.
-- >>> Son `create or replace function admin_platform_kpis()` échoue
-- >>> avec « 42P13 : cannot change return type of existing function »
-- >>> (vérifié en transaction annulée sur la production). Ce n'est pas
-- >>> un défaut de 0077 : c'est PostgreSQL qui refuse de changer un
-- >>> type de retour sans un `drop` explicite, et c'est heureux — une
-- >>> réexécution distraite de 0075 ferait sinon disparaître les
-- >>> colonnes mobiles sans que rien ne le signale. Pour rejouer 0075,
-- >>> il faut rejouer 0077 derrière. 0077, elle, est rejouable autant
-- >>> de fois qu'on veut (éprouvée trois fois de suite).
--
-- ============================================================
-- LE PROBLÈME, EN UNE PHRASE
-- ============================================================
--
-- Le Control Center doit afficher « Oasis Care Mobile : N
-- utilisateurs » et affiche « — », parce que RIEN dans cette base
-- n'enregistre par quelle application un compte est entré. L'audit l'a
-- établi et re-vérifié trois fois : le seul proxy imaginable,
-- « posséder un espace personnel », est SANS VALEUR — le déclencheur
-- `handle_new_user` (0001_initial_schema.sql:180-181) crée « Mon
-- espace » pour TOUT compte auth, y compris celui qui n'ouvrira jamais
-- l'iPhone. Contrôlé sur la production : 2 utilisateurs, 2 espaces
-- personnels.
--
-- ============================================================
-- CE QU'ON COLLECTE, ET RIEN D'AUTRE
-- ============================================================
--
-- C'est de la DONNÉE PERSONNELLE. Le cadrage n'est pas négociable :
--
--   • plateforme, version d'application, numéro de build, version
--     MAJEURE d'OS, dernière présence, et un identifiant
--     d'INSTALLATION stable. Six informations, pas sept.
--   • PAS d'adresse IP, PAS de géolocalisation, PAS de modèle
--     d'appareil, PAS de nom d'appareil (« iPhone de Clément » est un
--     nom de personne), PAS d'identifiant publicitaire. Et ce n'est pas
--     qu'une intention : les trois colonnes que le client remplit
--     (`install_id`, `app_version`, `app_build`) sont tenues par une
--     contrainte de FORME et pas seulement de longueur — un UUID pour
--     la première, un numéro commençant par un chiffre pour les deux
--     autres. Une longueur bornée n'aurait rien gardé du tout :
--     « iPhone-de-Clement » tient très largement dans 64 caractères, et
--     une adresse électronique ne contient aucune espace.
--   • Côté iOS, l'identifiant doit être `identifierForVendor` ou un
--     UUID tiré au premier lancement et rangé dans le trousseau —
--     JAMAIS un identifiant matériel.
--   • UNE LIGNE PAR INSTALLATION, jamais par lancement. `last_seen_at`
--     est ÉCRASÉ, pas empilé. Cette table décrit un ÉTAT PRÉSENT ; elle
--     n'accumule pas un historique de comportement. C'est ce qui la
--     distingue d'une table d'analytics, et c'est pourquoi elle n'a pas
--     de colonne `occurred_at`.
--   • AUCUNE fonction d'administration ne rend `install_id`. Les écrans
--     voient des NOMBRES et des VERSIONS. Si le support a un jour
--     besoin de l'identifiant lui-même, ce sera une fonction dédiée,
--     derrière « Afficher détails techniques », avec sa propre
--     permission — pas un élargissement silencieux de celles-ci.
--
-- ============================================================
-- L'HONNÊTETÉ DU CHIFFRE EST LA MOITIÉ DU TRAVAIL
-- ============================================================
--
-- Le jour du déploiement, aucun iPhone ne porte encore la version qui
-- déclare sa présence. Un `count(*)` dirait 0, et 0 serait un MENSONGE :
-- la vérité est « le parc n'a pas encore basculé ». Ce projet a déjà
-- corrigé deux fois cette confusion entre « zéro » et « je ne sais
-- pas » — 0059 (« 0 % se lit comme une équipe qui n'avance pas, quand
-- la vérité est qu'il n'y a rien à comparer ») et 0065. On ne la
-- réintroduit pas ici.
--
-- D'où trois règles, appliquées au §5 :
--   1. table VIDE → `mobile_users` rend NULL, avec un motif DATÉ dans
--      `unknown_reasons`. Jamais 0.
--   2. table NON VIDE → un entier, ET une phrase (`mobile_users_note`)
--      qui dit que c'est une BORNE INFÉRIEURE et depuis quand on
--      compte. Le chiffre ne devient pas exact parce qu'il existe.
--   3. déclaré et déduit sont COMPTÉS SÉPARÉMENT. Sans cette
--      distinction, personne ne saura dans six mois quelle part de ce
--      nombre était une mesure.
--
-- Et une limite qu'il ne faut pas taire : LE MODE INVITÉ.
-- `RootContainerView` laisse utiliser l'application entière sans
-- compte, et `SyncEngine.syncIfPossible` sort immédiatement si l'on
-- n'est pas authentifié. Ce KPI compte des COMPTES, pas des
-- utilisateurs de l'application. C'est cohérent, mais « utilisateurs
-- Mobile » se lirait sinon « utilisateurs de l'application ».


-- ============================================================
-- 1. LA DATE DE DÉMARRAGE DE LA COLLECTE
-- ============================================================
--
-- « Depuis quand mesure-t-on ? » est une question sur la TABLE, pas sur
-- les gens : elle ne doit surtout pas être répondue par un
-- `first_seen_at` posé sur chaque ligne, qui serait de la donnée
-- personnelle de plus pour une information qui n'en demande aucune.
--
-- Une ligne unique, donc, dont la date est celle où CETTE MIGRATION a
-- réellement tourné — pas une constante écrite d'avance dans le
-- fichier, qui mentirait de plusieurs semaines entre l'écriture et le
-- déploiement. Le `on conflict do nothing` garantit qu'une deuxième
-- exécution ne rajeunit pas la date.
create table if not exists public.mobile_presence_collection (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now()
);

insert into public.mobile_presence_collection (singleton) values (true)
on conflict (singleton) do nothing;

comment on table public.mobile_presence_collection is
  'Une seule ligne : la date à laquelle la collecte de présence applicative a démarré. '
  'Sert à écrire « la collecte a commencé le … » à côté d''un chiffre qui est une borne inférieure.';

alter table public.mobile_presence_collection enable row level security;
-- Aucune politique, et c'est volontaire : personne ne lit cette table
-- avec un jeton. Les fonctions `security definer` du §5 la lisent pour
-- le compte de l'administrateur.


-- ============================================================
-- 2. LA TABLE
-- ============================================================
--
-- POURQUOI `install_id` ET PAS `device_id` : `identifierForVendor` est
-- remis à zéro quand la dernière application du vendeur est
-- désinstallée de l'appareil. Il compte donc des INSTALLATIONS, pas des
-- téléphones. Le nommer `device_id` promettrait ce qu'il ne tient pas,
-- et « 3 appareils » deviendrait faux pour quelqu'un qui a réinstallé
-- deux fois. On appelle la chose par son nom, et l'écran dira
-- « installations ».
--
-- POURQUOI `app_build` EN PLUS DE `app_version`, et ce n'est pas de la
-- précaution : `project.yml:22` fige `MARKETING_VERSION` à « 0.1.0 » et
-- seul `CURRENT_PROJECT_VERSION` est réécrit par la CI
-- (`.github/workflows/testflight.yml:78`, `github.run_number`). Les 31
-- builds TestFlight envoyés à ce jour portent TOUS la version 0.1.0.
-- Une distribution bâtie sur `app_version` seule afficherait « 100 %
-- sur 0.1.0 » : techniquement exact, sans aucune valeur pour la gestion
-- des releases. C'est d'ailleurs le build, et non la version, que porte
-- déjà le `user_agent` observé en base (« OasisCare/31 »).
--
-- POURQUOI `os_major` ET PAS LA VERSION COMPLÈTE : la seule question
-- que ce champ sert à trancher est « à partir de quand peut-on relever
-- la cible de déploiement sans couper un utilisateur ». La mineure ne
-- change aucune décision et rend l'empreinte plus fine. 26, pas 26.3.1.
create table if not exists public.mobile_app_installations (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade`, et surtout pas `on delete set null`. Le
  -- précédent existe dans ce dépôt : `analytics_events.user_id`
  -- (0041:222) laisse survivre des lignes orphelines à un compte
  -- supprimé. Une ligne de télémétrie qui survit à la suppression d'un
  -- compte est un manquement RGPD ; on ne reproduit pas ce choix.
  --
  -- La clé pointe vers `auth.users` et vers rien d'autre. Surtout PAS
  -- vers `workspaces` : la fonction de suppression de compte détruit
  -- les espaces AVANT le compte (delete-account/index.ts:56-66), et un
  -- utilisateur peut perdre un espace sans perdre son compte — la ligne
  -- disparaîtrait alors trop tôt, par un autre chemin, pour une raison
  -- sans rapport.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- LA COLONNE QUI SÉPARE UNE MESURE D'UNE DÉDUCTION.
  --   'declared' : l'application s'est annoncée elle-même (§4).
  --   'inferred' : personne ne s'est annoncé, mais l'activité passée du
  --                compte ne peut venir que de l'iPhone (§3).
  source text not null check (source in ('declared', 'inferred')),

  -- Nul sur une ligne déduite : on sait que le compte est passé par
  -- l'iPhone, on ne sait pas depuis quelle installation, et fabriquer
  -- un identifiant pour remplir la case serait inventer une donnée.
  --
  -- La longueur seule ne garde RIEN, et il a fallu se le faire dire :
  -- « iPhone-de-Clement-Celidoni » fait 27 caractères et une adresse
  -- électronique ne contient aucune espace. Le vrai garde-fou
  -- anti-« nom d'appareil » est la contrainte de FORME posée juste
  -- après la table (`mobile_app_installations_forme`), qui n'accepte
  -- ici que des chiffres hexadécimaux et des tirets — c'est-à-dire un
  -- UUID, avec ou sans tirets, et rien d'autre.
  install_id text check (install_id is null or (length(install_id) between 8 and 64)),

  -- Le CHECK n'accepte QUE 'ios' aujourd'hui, exprès : c'est le seul
  -- client mobile qui existe. Accepter 'android' d'avance laisserait
  -- croire qu'on le mesure. On élargira le jour où un client Android
  -- existera — et ce jour-là, la ligne à changer est ici, pas dans
  -- quinze requêtes.
  platform text not null check (platform in ('ios')),

  app_version text check (app_version is null or (length(app_version) between 1 and 32)),
  app_build   text check (app_build   is null or (length(app_build)   between 1 and 32)),
  os_major    smallint check (os_major is null or (os_major between 1 and 999)),

  -- Écrasé à chaque annonce, jamais empilé.
  last_seen_at timestamptz not null default now(),

  -- Une ligne déclarée est COMPLÈTE ou n'est pas : une déclaration à
  -- moitié remplie polluerait la distribution des versions de trous
  -- qu'on prendrait pour des versions inconnues. Une ligne déduite, à
  -- l'inverse, ne porte AUCUN de ces champs — elle n'en a aucun à
  -- porter, et un défaut inventé (« 0.1.0 ») deviendrait une ligne de
  -- la distribution.
  constraint mobile_app_installations_coherence check (
    (source = 'declared'
       and install_id is not null and app_version is not null
       and app_build is not null and os_major is not null)
    or
    (source = 'inferred'
       and install_id is null and app_version is null
       and app_build is null and os_major is null)
  )
);

-- ------------------------------------------------------------
-- 2.a bis LA FORME DES TROIS COLONNES QUE LE CLIENT REMPLIT
-- ------------------------------------------------------------
--
-- POURQUOI ICI ET PAS SEULEMENT DANS LA FONCTION DU §4. La fonction est
-- la seule porte ouverte à un jeton, mais elle n'est pas la seule porte
-- : `service_role` écrit directement (une reprise, un script de
-- support, une restauration), et la reprise du §3 le fait déjà. Une
-- règle qui ne vit que dans la fonction n'est pas une règle de la
-- donnée. On la pose donc aux deux endroits — la fonction pour
-- expliquer le refus à l'appelant, la table pour que rien ne passe.
--
-- CE QUE CHAQUE FORME REFUSE, concrètement :
--   • `install_id` — chiffres hexadécimaux et tirets seulement. Accepte
--     un UUID (36 caractères) et un UUID sans tirets (32). Refuse
--     « iPhone-de-Clement », « clement.celidoni@gmail.com », et tout ce
--     qui contient une lettre au-delà de F.
--   • `app_version` et `app_build` — doivent COMMENCER PAR UN CHIFFRE.
--     C'est ce qui distingue « 0.1.0 » ou « 31 » d'un nom de personne,
--     et c'est vrai de tout ce qu'Apple accepte dans
--     `CFBundleShortVersionString` / `CFBundleVersion`. Ces deux
--     colonnes-là sont RENDUES TELLES QUELLES à l'administrateur, sur
--     la fiche et dans la distribution des versions : ce qu'on n'y
--     refuse pas s'affiche.
--
-- `drop` puis `add` plutôt qu'un `if not exists` (qui n'existe pas pour
-- une contrainte) : la migration reste rejouable, et un `add` valide la
-- contrainte contre les lignes DÉJÀ présentes — une réexécution échoue
-- donc bruyamment si une valeur douteuse s'est glissée en base, ce qui
-- est exactement ce qu'on veut apprendre.
alter table public.mobile_app_installations
  drop constraint if exists mobile_app_installations_forme;

alter table public.mobile_app_installations
  add constraint mobile_app_installations_forme check (
    (install_id is null or install_id ~ '^[0-9A-Fa-f-]{8,64}$')
    and (app_version is null or app_version ~ '^[0-9][0-9A-Za-z.+-]{0,31}$')
    and (app_build  is null or app_build  ~ '^[0-9][0-9A-Za-z.+-]{0,31}$')
  );

-- Une installation, UNE ligne. C'est cet index que l'annonce du §4
-- utilise pour son `on conflict` : deux lancements ne peuvent pas
-- fabriquer deux lignes pour la MÊME installation, et c'est la base qui
-- le garantit.
--
-- CE QU'IL NE GARANTIT PAS, et il a fallu se le faire dire aussi : le
-- NOMBRE d'installations distinctes qu'un compte peut déclarer. C'est
-- la seule dimension que l'appelant choisit librement, et elle est
-- plafonnée dans la fonction du §4 (`MAX_INSTALLATIONS_DECLAREES`), pas
-- ici — un index unique ne sait pas compter.
create unique index if not exists mobile_app_installations_declared_uidx
  on public.mobile_app_installations (user_id, install_id)
  where source = 'declared';

-- Au plus UNE déduction par compte : la déduction dit « ce compte est
-- passé par l'iPhone », une phrase qui ne se répète pas.
create unique index if not exists mobile_app_installations_inferred_uidx
  on public.mobile_app_installations (user_id)
  where source = 'inferred';

-- Le seul parcours fréquent : « les installations vues depuis … », pour
-- les actifs et la distribution des versions.
create index if not exists mobile_app_installations_last_seen_idx
  on public.mobile_app_installations (last_seen_at desc);

comment on table public.mobile_app_installations is
  'Une ligne par INSTALLATION de l''application mobile — jamais par lancement, jamais par session. '
  'Donnée personnelle minimisée : plateforme, version, build, version majeure d''OS, dernière présence '
  'et un identifiant d''installation (identifierForVendor ou UUID du trousseau). Ni IP, ni position, '
  'ni modèle, ni nom d''appareil. Supprimée par cascade avec le compte auth.';

comment on column public.mobile_app_installations.source is
  '« declared » : l''application s''est annoncée. « inferred » : déduit d''une activité passée qui ne peut '
  'venir que de l''iPhone. Un chiffre qui mélange les deux sans le dire n''est plus une mesure.';

comment on column public.mobile_app_installations.install_id is
  'Identifiant d''INSTALLATION, pas d''appareil : identifierForVendor est remis à zéro à la '
  'désinstallation. Nul sur une ligne déduite. N''est rendu par AUCUNE fonction d''administration.';

comment on column public.mobile_app_installations.last_seen_at is
  'Dernière annonce de cette installation. ÉCRASÉ à chaque fois : cette table décrit un état présent, '
  'elle n''accumule pas un historique de comportement.';

-- ------------------------------------------------------------
-- 2.b RLS et droits — deux verrous qui ne font pas double emploi
-- ------------------------------------------------------------
--
--   1. LA RLS : un porteur de jeton ne voit que SES lignes. Les
--      administrateurs de plateforme ne passent PAS par là — ils lisent
--      par les fonctions `security definer` du §5, comme tout le reste
--      du Control Center (règle R1 de 0075).
--
--   2. LES DROITS : `select` seulement. AUCUN `insert`, `update` ni
--      `delete` n'est accordé à `authenticated`, donc la seule écriture
--      possible depuis un jeton passe par `declare_mobile_presence`
--      (§4), qui valide ce qu'elle écrit. Sans cela, un client bricolé
--      pourrait insérer « iPhone de Clément » dans `install_id` en
--      respectant parfaitement la RLS : la politique dit À QUI
--      appartient la ligne, elle ne dit rien de ce qu'elle contient.
alter table public.mobile_app_installations enable row level security;

drop policy if exists "Chacun ne voit que ses propres installations" on public.mobile_app_installations;
create policy "Chacun ne voit que ses propres installations" on public.mobile_app_installations
  for select using (user_id = auth.uid());

revoke all on public.mobile_app_installations from public;
revoke all on public.mobile_app_installations from anon;
revoke all on public.mobile_app_installations from authenticated;
grant select on public.mobile_app_installations to authenticated;

revoke all on public.mobile_presence_collection from public;
revoke all on public.mobile_presence_collection from anon;
revoke all on public.mobile_presence_collection from authenticated;


-- ------------------------------------------------------------
-- 2.c L'EFFACEMENT DOUX — le seul trou de la cascade
-- ------------------------------------------------------------
--
-- `on delete cascade` ne se déclenche que sur une suppression RÉELLE.
-- Or Supabase sait effacer en douceur : `deleteUser(id, true)` côté
-- GoTrue laisse la ligne `auth.users` en place et pose `deleted_at`.
-- Le compte disparaît alors de tous les écrans — les fonctions du §5
-- excluent `deleted_at is not null` — pendant que sa télémétrie reste
-- en base, invisible et donc jamais purgée. Mesuré : sur les trois
-- chemins d'effacement, deux effacent bien la ligne (le chemin produit
-- `delete-account`, et la cascade nue depuis le tableau de bord), le
-- troisième la laissait survivre.
--
-- Ce n'est pas le chemin du produit — `delete-account/index.ts` appelle
-- `deleteUser(userId)` sans second argument, donc en dur — mais une
-- ligne de données personnelles qui survit à un compte qu'on croit
-- supprimé est un manquement, quel que soit le bouton qui l'a supprimé.
-- Deux lignes suffisent à fermer le cas sans dépendre de l'appelant.
--
-- Le `when` fait que le corps ne s'exécute QUE sur la transition
-- NULL → non NULL : GoTrue écrit dans `auth.users` à chaque connexion
-- et à chaque rafraîchissement de jeton, et ce déclencheur ne doit rien
-- coûter à ces écritures-là.
create or replace function public.purge_mobile_presence_on_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.mobile_app_installations where user_id = new.id;
  return new;
end;
$$;

comment on function public.purge_mobile_presence_on_soft_delete() is
  'Efface la télémétrie de présence quand un compte est effacé EN DOUCEUR (deleted_at posé sans '
  'suppression de la ligne auth.users) : dans ce cas le « on delete cascade » ne se déclenche pas, '
  'et une ligne de donnée personnelle survivrait à un compte qu''on croit supprimé.';

drop trigger if exists purge_mobile_presence_on_soft_delete on auth.users;
create trigger purge_mobile_presence_on_soft_delete
  after update of deleted_at on auth.users
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.purge_mobile_presence_on_soft_delete();


-- ============================================================
-- 3. LA REPRISE DE L'EXISTANT — ce qui est déjà prouvé
-- ============================================================
--
-- Il existe un signal rétroactif, et il est solide : CINQ tables
-- (`care_events`, `plant_photos`, `ai_analyses`, `smart_tags`,
-- `garden_checkups`) et TOUS les compteurs de `usage_counters` ne sont
-- écrits QUE par l'application iPhone. Vérifié par relecture exhaustive
-- de `OasisCare/`, `web-pro/`, `web-admin/` et `supabase/functions/` :
--   • `usage_counters` n'est incrémenté que par `increment_usage_counter`,
--     appelé par seize Edge Functions IA, elles-mêmes invoquées
--     uniquement depuis `OasisCare/Services/AI/…` via `AIBackend.swift`.
--     `web-pro` n'invoque que `oasis-pro-ai`, qui n'appelle jamais ce
--     compteur ;
--   • les cinq tables ne sont écrites que par
--     `OasisCare/Services/Sync/SyncEngine.swift` (côté web, elles sont
--     lues, jamais écrites).
--
-- DEUX PRÉCAUTIONS, PARCE QUE LA DÉDUCTION EST FRAGILE PAR NATURE.
--
--   (a) `care_events`, `plant_photos` et `ai_analyses` N'ONT PAS de
--       `user_id` : l'attribution passe par `plants.workspace_id`. Dans
--       un espace d'organisation, cela désignerait TOUS les membres.
--       On se restreint donc aux espaces PERSONNELS, et même là, à ceux
--       qui n'ont pas plus d'un membre : la seule personne à qui
--       attribuer l'écriture doit être évidente.
--
--   (b) LE PIÈGE DES JARDINS LIVRÉS. `deliver_garden_to_client`
--       (0055:539-543) DÉPLACE un jardin vers l'espace PERSONNEL d'un
--       client. Un client pourrait donc hériter d'un espace personnel
--       peuplé par le travail du PAYSAGISTE, et se retrouver déclaré
--       utilisateur mobile sans avoir jamais ouvert l'application.
--
--       DEUX CHOSES À SAVOIR, ET LA SECONDE EST LA PLUS IMPORTANTE.
--
--       La première : les comptes ayant un accès portail — MÊME
--       RÉVOQUÉ — sont exclus de la déduction par espace. La révocation
--       (`web-pro/lib/portal/proActions.ts`, `revokePortalAccess`) pose
--       `revoked_at` et écrit en toutes lettres qu'elle ne touche PAS
--       aux jardins déjà livrés : ils restent chez le client. Filtrer
--       sur `revoked_at is null` rouvrirait donc le piège au moment
--       exact où il compte, et cette migration est rejouable. La
--       question posée n'est pas « ce compte a-t-il un accès portail
--       aujourd'hui ? » mais « ce compte a-t-il jamais pu recevoir un
--       jardin d'une entreprise ? ».
--
--       La seconde : ce garde-fou n'est PAS ce qui ferme le piège
--       aujourd'hui, et il ne faut pas croire le contraire. Vérifié :
--       `deliver_garden_to_client` déplace gardens, garden_areas,
--       garden_map_objects, garden_boundaries, irrigation_pipes et
--       garden_cables — mais PAS `plants`. Or les trois branches
--       fragiles (care_events, plant_photos, ai_analyses) passent
--       toutes par `plants.workspace_id` : elles ne peuvent pas suivre
--       un jardin livré. Les deux autres (smart_tags, garden_checkups)
--       portent le workspace du SYNCHRONISEUR, pas celui du jardin
--       (`SyncEngine.swift`). Le jour où quelqu'un ajoutera `plants` au
--       recalage de 0046, l'exclusion ci-dessous redeviendra la SEULE
--       protection — c'est pour ce jour-là qu'elle est écrite.
--
--       La déduction par `usage_counters`, elle, reste valable pour un
--       client de portail : elle porte un `user_id` réel.
--
-- CE QUE ÇA DONNE SUR LA PRODUCTION, au moment d'écrire : UN compte est
-- rattrapé (deux chemins de preuve indépendants — 5 appels IA et
-- 98 `care_events` dans son espace personnel). L'autre compte réel n'a
-- RIEN dans la donnée durable : il est pourtant prouvé mobile par une
-- ligne de `auth.sessions` dont le `user_agent` dit
-- « OasisCare/31 CFNetwork/… Darwin/… ». Cette ligne n'a PAS été
-- utilisée ici, et c'est un choix : `auth.sessions` ne contient que les
-- sessions VIVANTES (une seule ligne pour deux comptes qui se sont tous
-- deux connectés), `auth.audit_log_entries` est vide, le `user_agent`
-- porte le build et jamais la version marketing, « Darwin/25.5.0 » est
-- une version de noyau et non un numéro d'iOS, et la colonne voisine
-- `ip` est une donnée qu'on ne veut pas approcher. Bâtir un KPI
-- là-dessus, c'était bâtir sur une preuve périssable. On le consigne
-- ici plutôt que de le compter : la fenêtre de rattrapage se referme
-- d'elle-même, et c'est la meilleure démonstration que la collecte
-- devait exister.
do $$
declare
  v_rattrapes integer;
begin
  with espaces_attribuables as (
    -- Un espace personnel, un seul membre : l'attribution de l'écriture
    -- à son propriétaire est alors exacte, pas approchée.
    select w.id as workspace_id, w.owner_id as user_id
    from public.workspaces w
    where w.is_personal
      and (select count(*) from public.workspace_members m where m.workspace_id = w.id) <= 1
      -- Le piège des jardins livrés, fermé explicitement — et SANS
      -- filtrer sur `revoked_at` : une révocation retire l'accès au
      -- portail, elle ne reprend pas les jardins déjà livrés.
      and not exists (
        select 1 from public.client_portal_access a
        where a.user_id = w.owner_id
      )
  ),
  preuves as (
    -- Preuve DIRECTE : le compteur porte un `user_id`. C'est la plus
    -- solide des deux, et la seule qui vaille pour un compte à qui un
    -- jardin a pu être livré.
    select c.user_id, max(c.updated_at) as vu
    from public.usage_counters c
    group by c.user_id

    union all

    -- Preuves par ÉCRITURE dans un espace attribuable.
    select e.user_id, ce.created_at
    from public.care_events ce
    join public.plants p on p.id = ce.plant_id
    join espaces_attribuables e on e.workspace_id = p.workspace_id

    union all
    select e.user_id, ph.created_at
    from public.plant_photos ph
    join public.plants p on p.id = ph.plant_id
    join espaces_attribuables e on e.workspace_id = p.workspace_id

    union all
    select e.user_id, an.created_at
    from public.ai_analyses an
    join public.plants p on p.id = an.plant_id
    join espaces_attribuables e on e.workspace_id = p.workspace_id

    union all
    select e.user_id, t.created_at
    from public.smart_tags t
    join espaces_attribuables e on e.workspace_id = t.workspace_id

    union all
    select e.user_id, g.created_at
    from public.garden_checkups g
    join espaces_attribuables e on e.workspace_id = g.workspace_id
  ),
  a_rattraper as (
    select pr.user_id, max(pr.vu) as derniere_trace
    from preuves pr
    join auth.users u on u.id = pr.user_id and u.deleted_at is null
    group by pr.user_id
  )
  insert into public.mobile_app_installations (user_id, source, platform, last_seen_at)
  select r.user_id, 'inferred', 'ios', coalesce(r.derniere_trace, now())
  from a_rattraper r
  -- Rejouable : ni doublon, ni écrasement d'une VRAIE déclaration
  -- arrivée entre-temps. Une mesure ne se fait jamais remplacer par une
  -- déduction.
  where not exists (
    select 1 from public.mobile_app_installations i where i.user_id = r.user_id
  );

  get diagnostics v_rattrapes = row_count;
  raise notice 'Présence applicative : % compte(s) rattrapé(s) par déduction.', v_rattrapes;
end $$;


-- ============================================================
-- 4. L'ANNONCE — la fonction que les clients appellent
-- ============================================================
--
-- UNE SEULE FONCTION, IDEMPOTENTE, POUR L'UTILISATEUR COURANT.
--
--   • ELLE NE PREND PAS D'IDENTIFIANT D'UTILISATEUR. C'est la
--     précaution centrale : `declare_mobile_presence(p_user_id, …)`
--     aurait laissé n'importe qui déclarer la présence de n'importe
--     qui. La seule identité qu'elle connaisse est celle du JETON en
--     cours. Même règle qu'au §2 de 0075 pour `is_platform_admin()`.
--
--     CE QUE CETTE PRÉCAUTION NE FERME PAS, et il faut le dire pour ne
--     pas s'en croire protégé : elle ferme la déclaration AU NOM
--     D'AUTRUI, pas la déclaration en son propre nom. La fonction est
--     accordée à tout rôle `authenticated` — la clé publique est dans
--     le bundle iOS —, donc un compte qui n'a jamais installé
--     l'iPhone peut s'inscrire lui-même dans le chiffre. C'est le
--     compromis assumé d'une télémétrie déclarative : le serveur n'a
--     aucun moyen de distinguer une déclaration venue de l'application
--     d'un appel à `/rest/v1/rpc/declare_mobile_presence`, et le CHECK
--     `platform in ('ios')` filtre une chaîne de caractères, pas une
--     provenance. Deux conséquences, tenues ailleurs dans ce fichier :
--     le nombre d'installations par compte est PLAFONNÉ (plus bas), et
--     la phrase du §5 dit que le chiffre peut aussi être trop haut.
--
--   • ELLE PLAFONNE LE NOMBRE D'INSTALLATIONS PAR COMPTE. L'index
--     unique empêche le DOUBLON, jamais la MULTIPLICATION : rien
--     n'empêchait un compte de fabriquer trois cents lignes avec trois
--     cents identifiants (mesuré, 301 lignes en une transaction). Or
--     `declared_installations_total` est le DÉNOMINATEUR de tous les
--     pourcentages de l'écran des versions. Au-delà du plafond, la plus
--     ancienne installation est RECYCLÉE plutôt que l'appel refusé :
--     refuser ferait cesser de compter un utilisateur légitime, recycler
--     borne la table et garde juste « le dernier appareil utilisé ».
--
--   • ELLE EST `security definer` PARCE QUE LA TABLE N'EST PAS
--     ÉCRIVABLE. `authenticated` n'a que le `select` (§2.b) : cette
--     fonction est la seule porte, et elle valide ce qui passe. Un
--     `security invoker` aurait exigé d'accorder l'écriture directe,
--     c'est-à-dire d'accepter n'importe quel contenu de colonne.
--
--   • `set search_path = public, pg_temp`, `pg_temp` nommé EN DERNIER :
--     sans cela, un appelant qui créerait une table temporaire nommée
--     `mobile_app_installations` détournerait l'écriture. C'est l'écart
--     qu'`increment_usage_counter` (0041) a laissé ouvert ; 0075 ne l'a
--     pas reproduit, celle-ci non plus.
--
--   • ELLE EST BON MARCHÉ, et il le faut : elle sera appelée à chaque
--     lancement, et `scenePhase == .active` se déclenche à chaque retour
--     au premier plan. Le `where` du `do update` fait que la ligne n'est
--     RÉÉCRITE que si quelque chose a changé, ou si la dernière annonce
--     date de plus d'une heure. Un client bavard ne produit alors ni
--     ligne morte, ni WAL, ni index à rafraîchir. Le client posera son
--     propre garde-fou en plus ; celui-ci ne dépend pas de lui.
--
--   • ELLE NE DOIT JAMAIS FAIRE ÉCHOUER UNE SYNCHRONISATION. Côté
--     Swift, l'appel s'ignore en cas d'erreur : la télémétrie n'a pas le
--     droit de casser le produit. C'est pour cela qu'elle ne rend rien —
--     il n'y a rien à attendre d'elle.
create or replace function public.declare_mobile_presence(
  p_install_id text,
  p_platform text,
  p_app_version text,
  p_app_build text,
  p_os_major integer
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_install text := btrim(coalesce(p_install_id, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_version text := btrim(coalesce(p_app_version, ''));
  v_build text := btrim(coalesce(p_app_build, ''));

  -- DIX INSTALLATIONS DÉCLARÉES PAR COMPTE. Au-delà, ce n'est plus un
  -- parc de téléphones — personne n'a huit iPhone — c'est un client qui
  -- ne sait pas retenir son identifiant, ou quelqu'un qui fabrique des
  -- lignes. Le nombre est écrit ici, en un seul endroit, et il est
  -- répété dans le commentaire de `mobile_install_count` : sans cela,
  -- « 10 appareils » se lira un jour comme une mesure alors que ce sera
  -- une saturation.
  c_max_installations constant integer := 10;
  v_declarees integer;
begin
  if v_user is null then
    raise exception 'Authentification requise : la présence se déclare pour le porteur du jeton, jamais pour un identifiant passé en paramètre.'
      using errcode = '42501';
  end if;

  -- Le refus est explicite plutôt que laissé à la contrainte de table :
  -- un client qui se trompe doit lire pourquoi, pas un « violates check
  -- constraint ».
  if v_platform <> 'ios' then
    raise exception 'Plateforme « % » inconnue : seul le client iOS existe aujourd''hui.', p_platform
      using errcode = '22023';
  end if;

  -- LA GARDE ANTI-« NOM D'APPAREIL », et c'est une LISTE BLANCHE.
  -- Refuser l'espace ne gardait rien : « iPhone-de-Clement-Celidoni »
  -- n'en contient aucune et passait (mesuré en transaction annulée
  -- contre la production, avant correction). On exige donc la forme
  -- attendue au lieu d'interdire un caractère : les deux clients
  -- n'envoient qu'un UUID — `UUID().uuidString` ou
  -- `identifierForVendor` côté iOS, `crypto.randomUUID` côté web — donc
  -- chiffres hexadécimaux et tirets, rien d'autre. Une liste noire d'un
  -- seul caractère ne ferme que ce caractère ; une liste blanche ferme
  -- la question. La même règle est doublée en contrainte de table
  -- (`mobile_app_installations_forme`), pour que `service_role` y soit
  -- tenu aussi.
  if v_install !~ '^[0-9A-Fa-f-]{8,64}$' then
    raise exception 'Identifiant d''installation invalide : attendu un UUID (identifierForVendor ou UUID du trousseau), jamais un nom d''appareil.'
      using errcode = '22023';
  end if;

  -- MÊME RAISONNEMENT, ET C'EST LE PLUS URGENT DES TROIS : ces deux
  -- valeurs-là sont RENDUES TELLES QUELLES à l'administrateur, sur la
  -- fiche (« Version de l'application ») et dans
  -- `admin_mobile_version_distribution()`. Sans forme imposée, un nom
  -- écrit par l'utilisateur traversait la base et s'affichait dans la
  -- colonne « version » de l'écran /utilisateurs/mobile. Un numéro de
  -- version commence par un chiffre — c'est vrai de tout ce qu'Apple
  -- accepte dans `CFBundleShortVersionString` et `CFBundleVersion`, et
  -- c'est faux de tout prénom.
  if v_version !~ '^[0-9][0-9A-Za-z.+-]{0,31}$' then
    raise exception 'Version d''application invalide : attendu un numéro commençant par un chiffre (« 0.1.0 »), 32 caractères au plus.'
      using errcode = '22023';
  end if;

  if v_build !~ '^[0-9][0-9A-Za-z.+-]{0,31}$' then
    raise exception 'Build d''application invalide : attendu un numéro commençant par un chiffre (« 31 »), 32 caractères au plus.'
      using errcode = '22023';
  end if;

  if p_os_major is null or p_os_major < 1 or p_os_major > 999 then
    raise exception 'Version majeure d''OS invalide : attendu un entier (26), pas une version complète (26.3.1).'
      using errcode = '22023';
  end if;

  -- LE PLAFOND. Il ne s'applique qu'à une installation INCONNUE : mettre
  -- à jour une installation déjà enregistrée n'ajoute pas de ligne et ne
  -- doit jamais être refusée, sinon un utilisateur légitime à trois
  -- téléphones cesserait d'être vu au onzième identifiant perdu.
  --
  -- On RECYCLE la plus ancienne plutôt que de lever : lever aurait rendu
  -- l'appel bruyant côté client (qui l'ignore, donc pour rien) et aurait
  -- figé le parc sur dix identifiants morts. Recycler borne la table à
  -- dix lignes par compte — donc borne aussi `mobile_install_count` et
  -- le dénominateur de la distribution des versions — tout en gardant
  -- juste la seule chose qui compte vraiment, « le dernier appareil
  -- utilisé ».
  if not exists (
    select 1 from public.mobile_app_installations
     where user_id = v_user and install_id = v_install and source = 'declared'
  ) then
    select count(*) into v_declarees
    from public.mobile_app_installations
    where user_id = v_user and source = 'declared';

    while v_declarees >= c_max_installations loop
      delete from public.mobile_app_installations
      where id = (
        select id from public.mobile_app_installations
         where user_id = v_user and source = 'declared'
         order by last_seen_at asc, id asc
         limit 1
      );
      v_declarees := v_declarees - 1;
    end loop;
  end if;

  insert into public.mobile_app_installations as i
    (user_id, source, install_id, platform, app_version, app_build, os_major, last_seen_at)
  values
    (v_user, 'declared', v_install, 'ios', v_version, v_build, p_os_major::smallint, now())
  on conflict (user_id, install_id) where source = 'declared'
  do update set
    app_version = excluded.app_version,
    app_build = excluded.app_build,
    os_major = excluded.os_major,
    last_seen_at = now()
  -- On ne réécrit que si ça vaut la peine : une mise à jour par heure
  -- suffit à « dernière présence », et un changement de version doit,
  -- lui, être pris tout de suite — sinon la distribution des versions
  -- retarderait d'une heure le jour d'une sortie.
  where i.last_seen_at < now() - interval '1 hour'
     or i.app_version is distinct from excluded.app_version
     or i.app_build is distinct from excluded.app_build
     or i.os_major is distinct from excluded.os_major;

  -- Une DÉCLARATION périme la DÉDUCTION : on mesure, on ne suppose
  -- plus. La ligne déduite disparaît donc, et le compte bascule du
  -- compteur « déduits » vers le compteur « déclarés » sans être compté
  -- deux fois. Le `delete` ne coûte qu'une recherche sur index partiel,
  -- et ne trouve rien dans l'immense majorité des appels.
  delete from public.mobile_app_installations d
  where d.user_id = v_user and d.source = 'inferred';
end;
$$;

comment on function public.declare_mobile_presence(text, text, text, text, integer) is
  'Déclare la présence de l''installation courante POUR LE PORTEUR DU JETON. Ne prend aucun identifiant '
  'd''utilisateur, exprès : on ne peut pas déclarer la présence d''autrui — mais on peut déclarer la '
  'sienne sans avoir d''iPhone, et c''est le compromis assumé d''une télémétrie déclarative. Idempotente '
  '— une installation, une ligne — bon marché (réécriture seulement si une version change ou si la '
  'dernière annonce date de plus d''une heure), et PLAFONNÉE à 10 installations déclarées par compte, '
  'la plus ancienne étant recyclée au-delà.';


-- ============================================================
-- 5. LES INDICATEURS DU CONTROL CENTER
-- ============================================================
--
-- 0075 rendait `mobile_users` à NULL avec pour motif « rien
-- n'enregistre par quelle application un compte est entré ». Ce motif
-- n'est plus vrai : quelque chose l'enregistre. Mais le remplacer par
-- un entier sec serait retomber dans la faute inverse.

-- ------------------------------------------------------------
-- 5.a admin_platform_kpis() — recréée (le retour gagne 5 colonnes)
-- ------------------------------------------------------------
--
-- `create or replace` ne sait pas changer le type de retour d'une
-- fonction : il faut la supprimer d'abord. Le corps est celui de 0075,
-- recopié sans y toucher — SEUL le bloc mobile change. Les commentaires
-- longs de 0075 (MRR, ARR, essais, populations comparables) restent
-- valables et ne sont pas répétés ici ; ils se lisent dans 0075, §4.a.
drop function if exists public.admin_platform_kpis();

create function public.admin_platform_kpis()
returns table (
  total_users bigint,
  new_users_this_month bigint,
  mobile_users bigint,
  -- LES QUATRE COLONNES DE FIABILITÉ. Un chiffre de télémétrie sans
  -- elles est un chiffre qu'on ne peut pas interpréter : on ne sait ni
  -- ce qui a été mesuré, ni ce qui a été supposé, ni depuis quand.
  mobile_users_declared bigint,
  mobile_users_inferred bigint,
  mobile_collection_started_at timestamptz,
  mobile_users_note text,
  pro_organizations bigint,
  pro_users bigint,
  open_sessions bigint,
  tracked_subscriptions bigint,
  mrr_cents bigint,
  arr_cents bigint,
  pro_trials bigint,
  mobile_trials bigint,
  churn_30d_percent numeric,
  pro_ai_requests_this_month bigint,
  mobile_ai_requests_this_month bigint,
  ai_cost_cents bigint,
  unknown_reasons jsonb,
  computed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Le mois « en cours » est celui de PARIS : à minuit le 1er, un
  -- compteur en UTC afficherait encore le mois précédent pendant deux
  -- heures (0066 a tranché ce point pour tout le projet).
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';

  -- Les périodes des compteurs IA sont écrites en UTC par leurs
  -- producteurs : on relit avec la MÊME étiquette que l'écrivain.
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');

  v_total_users bigint;
  v_new_users bigint;
  v_orgs bigint;
  v_pro_users bigint;
  v_sessions bigint;
  v_subs bigint;
  v_subs_billable bigint;
  v_unpriced bigint;
  v_mrr bigint;
  v_arr bigint;
  v_pro_trials bigint;
  v_pro_ai bigint;
  v_mobile_ai bigint;
  v_reasons jsonb;

  v_mob_total bigint;
  v_mob_declared bigint;
  v_mob_inferred bigint;
  v_mob_started timestamptz;
  v_mob_note text;
  v_mob_since text;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.dashboard.read') then
    raise exception 'Accès refusé : permission platform.dashboard.read manquante.'
      using errcode = '42501';
  end if;

  -- ---- Ce qui se calculait déjà ---------------------------------

  select count(*) into v_total_users from auth.users where deleted_at is null;

  select count(*) into v_new_users
  from auth.users
  where deleted_at is null and created_at >= v_month_start;

  select count(*) into v_orgs
  from public.business_organizations where archived_at is null;

  select count(distinct om.user_id) into v_pro_users
  from public.organization_members om
  join auth.users u on u.id = om.user_id and u.deleted_at is null
  join public.business_organizations o
    on o.id = om.organization_id and o.archived_at is null
  where om.archived_at is null;

  select count(distinct s.user_id) into v_sessions
  from auth.sessions s
  where coalesce(s.refreshed_at at time zone 'UTC', s.updated_at) >= now() - interval '30 minutes';

  select count(*) into v_subs
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null;

  select coalesce(sum(u.used), 0) into v_pro_ai
  from public.ai_pro_usage u where u.period = v_period;

  select coalesce(sum(c.count), 0) into v_mobile_ai
  from public.usage_counters c where c.period = v_period;

  -- ---- LES UTILISATEURS MOBILE ----------------------------------
  --
  -- Les comptes effacés en douceur sont exclus, comme dans
  -- `v_total_users` : ce chiffre est le numérateur d'une barre dont
  -- `v_total_users` est le dénominateur, et deux populations
  -- différentes donnent un pourcentage qui peut dépasser 100 %. La
  -- cascade ne suffit pas à garantir ça — Supabase pose `deleted_at`
  -- sans supprimer la ligne, donc le `on delete cascade` NE SE
  -- DÉCLENCHE PAS pour un effacement doux.
  select started_at into v_mob_started from public.mobile_presence_collection;

  select
    count(distinct i.user_id),
    count(distinct i.user_id) filter (where i.source = 'declared'),
    count(distinct i.user_id) filter (where i.source = 'inferred')
  into v_mob_total, v_mob_declared, v_mob_inferred
  from public.mobile_app_installations i
  join auth.users u on u.id = i.user_id and u.deleted_at is null;

  -- LE `coalesce` N'EST PAS DÉCORATIF. Si `mobile_presence_collection`
  -- est vide (un `truncate`, une restauration partielle, un
  -- environnement recréé sans la graine), `v_mob_since` serait NULL,
  -- donc `v_mob_note` — construit par concaténation — serait NULL, donc
  -- le `where v is not null` plus bas ferait DISPARAÎTRE l'entrée
  -- `mobile_users` de `unknown_reasons` : un chiffre inconnu SANS motif,
  -- c'est-à-dire « — » tout court, le point de départ même de ce
  -- chantier. L'invariant que ce projet défend — un nombre OU un motif,
  -- jamais aucun des deux — se tient, il ne se suppose pas.
  -- La préposition est DANS la variable, pas dans les phrases : sans
  -- cela, le repli produirait « démarrée le une date inconnue ».
  v_mob_since := coalesce(
    'le ' || to_char(v_mob_started at time zone 'Europe/Paris', 'DD/MM/YYYY'),
    'à une date inconnue — la ligne de démarrage de la collecte est absente de mobile_presence_collection'
  );

  if v_mob_total = 0 then
    -- LE CAS DU JOUR DU DÉPLOIEMENT. Le mécanisme existe mais personne
    -- ne s'en est encore servi : « 0 utilisateur Mobile » se lirait
    -- « personne n'utilise l'iPhone » alors que la vérité est « le parc
    -- n'a pas encore basculé ». On rend donc NULL et on DATE le motif —
    -- un inconnu sans date ne se distingue pas d'un inconnu définitif.
    v_mob_total := null;
    v_mob_note := 'Collecte démarrée ' || v_mob_since ||
      ' : aucune installation ne s''est encore annoncée, et aucune activité passée ne permet de déduire un usage mobile. Le chiffre est inconnu, pas nul.';
  else
    -- LE CHIFFRE EXISTE, ET IL RESTE UNE BORNE INFÉRIEURE. Il le
    -- restera tant qu'un compte pourra exister sans avoir rouvert
    -- l'application depuis la mise en service : ce n'est pas une
    -- précaution provisoire, c'est la nature de la mesure.
    v_mob_note := 'Borne inférieure. ' || v_mob_declared::text ||
      ' compte(s) déclaré(s) par l''application depuis ' || v_mob_since || ', ' ||
      v_mob_inferred::text ||
      ' déduit(s) d''une activité passée qui ne peut venir que de l''iPhone. Un compte qui n''a pas rouvert l''application depuis cette date reste invisible, et le mode invité n''est jamais compté. ' ||
      -- LE SENS INVERSE, QU'IL SERAIT MALHONNÊTE DE TAIRE. « Borne
      -- inférieure » laisserait croire que le chiffre ne peut qu'être
      -- trop bas. La déclaration est faite par le client, et la clé qui
      -- permet de l'appeler est publique par nature : le serveur ne
      -- distingue pas l'application d'un appel direct. Le plafond de dix
      -- installations par compte borne le NOMBRE DE LIGNES, pas le
      -- nombre de comptes — au pire un compte de plus par compte réel.
      'Une réserve dans l''autre sens : la déclaration est faite par l''application et n''est pas vérifiable côté serveur, donc un compte qui n''utilise pas l''iPhone pourrait s''y inscrire lui-même.';
  end if;

  -- ---- Le MRR, et pourquoi il reste inconnu (voir 0075 §4.a) ----
  select count(*) into v_subs_billable
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null
  where s.status in ('active', 'pastDue');

  select count(*) into v_unpriced
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null
  join public.organization_plans p on p.key = s.plan
  where s.status in ('active', 'pastDue')
    and p.monthly_price_cents is null;

  if v_subs_billable = 0 then
    v_mrr := null;
  elsif v_unpriced > 0 then
    v_mrr := null;
  else
    select sum(p.monthly_price_cents) into v_mrr
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    join public.organization_plans p on p.key = s.plan
    where s.status in ('active', 'pastDue');
  end if;

  v_arr := case when v_mrr is null then null else v_mrr * 12 end;

  if v_subs = 0 then
    v_pro_trials := null;
  else
    select count(*) into v_pro_trials
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.status = 'trialing';
  end if;

  -- ---- Les motifs des inconnus ----------------------------------
  -- Construits à partir des valeurs RÉELLEMENT nulles : le motif de
  -- `mobile_users` disparaît de lui-même à la première installation
  -- annoncée, sans qu'on ait à y revenir.
  select jsonb_object_agg(k, v) into v_reasons
  from (values
    ('mobile_users',
     case when v_mob_total is null then v_mob_note end::text),
    ('mrr_cents',
     case when v_mrr is null then
       case when v_subs_billable = 0
         then 'Aucun abonnement facturable sur une entreprise vivante : organization_subscriptions est vide et aucune ligne de code du dépôt ne l''écrit (startCheckout rend « unavailable »). 0 € serait un fait faux.'
         else 'Au moins un forfait actif n''a pas de prix (organization_plans.monthly_price_cents est NULL) : la somme serait silencieusement trop basse.'
       end
     end),
    ('arr_cents',
     case when v_arr is null then 'Dérivé du MRR, inconnu tant que le MRR l''est.' end),
    ('pro_trials',
     case when v_pro_trials is null then
       'Aucun abonnement suivi sur une entreprise vivante : organization_subscriptions n''est écrite par personne, et le statut « trialing » n''existe que dans la contrainte. « 0 essai » se lirait « personne n''essaie » au lieu de « on ne suit aucun essai ».'
     end),
    ('mobile_trials',
     'Le webhook Apple n''écrit que subscribed / expired / revoked : un essai gratuit y est enregistré comme « subscribed », indiscernable d''un abonnement payé.'),
    ('churn_30d_percent',
     'Ni numérateur ni dénominateur. Côté Pro, organization_subscriptions a pour clé primaire organization_id — une seule ligne par entreprise — donc cancelled_at est écrasé à chaque changement : il n''y a pas d''historique. Côté mobile, subscription_events est bien en ajout seul mais ne contient aucune ligne.'),
    ('ai_cost_cents',
     'Aucune table du projet n''enregistre de tokens, de modèle, de latence ni de coût. ai_pro_usage et usage_counters comptent des REQUÊTES, pas des euros.')
  ) t(k, v)
  where v is not null;

  return query select
    v_total_users,
    v_new_users,
    v_mob_total,
    v_mob_declared,
    v_mob_inferred,
    v_mob_started,
    v_mob_note,
    v_orgs,
    v_pro_users,
    v_sessions,
    v_subs,
    v_mrr,
    v_arr,
    v_pro_trials,
    null::bigint,        -- mobile_trials
    null::numeric,       -- churn_30d_percent
    v_pro_ai,
    v_mobile_ai,
    null::bigint,        -- ai_cost_cents
    coalesce(v_reasons, '{}'::jsonb),
    now();
end;
$$;

-- ------------------------------------------------------------
-- 5.b admin_list_users(...) — recréée (la fiche gagne le mobile)
-- ------------------------------------------------------------
--
-- Spec p.8 : « Produit utilisé : Oasis Care Mobile / Pro / ou les
-- deux », « version application », « plateforme », « nombre
-- d'appareils ». 0075 ne savait dire que la moitié de la phrase et
-- LEVAIT sur le filtre « Mobile ». Les deux se réparent ici.
--
-- CE QUI RESTE INCONNU, ET DOIT LE RESTER : pour un compte sans aucune
-- ligne de présence, les quatre colonnes mobiles rendent NULL, jamais
-- 0 ni 'pro'. « 0 appareil » affirmerait qu'on a regardé et qu'il n'y
-- en a pas ; la vérité est qu'on ne sait pas encore.
drop function if exists public.admin_list_users(text, text, integer, integer);

create function public.admin_list_users(
  p_search text default null,
  p_filter text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  product text,
  organization_count bigint,
  organizations text[],
  pro_plans text[],
  mobile_plan text,
  complimentary boolean,
  -- Les cinq colonnes de la fiche (spec p.8-9). `mobile_install_count`
  -- compte des INSTALLATIONS déclarées, jamais des appareils, et
  -- `install_id` lui-même n'est PAS rendu : l'écran affiche « 2
  -- installations », pas deux UUID. Ce compte est PLAFONNÉ À 10 par
  -- `declare_mobile_presence` : « 10 installations » se lit donc
  -- « au moins dix », c'est-à-dire une saturation et non une mesure.
  --
  -- CE QUI VAUT NULL POUR UN COMPTE DÉDUIT : la version, le nombre
  -- d'installations et la date de dernière annonce — trois choses
  -- qu'une déduction ne sait pas. La plateforme, elle, est renseignée :
  -- la déduction repose sur des tables qu'aucun autre client n'écrit.
  mobile_platform text,
  mobile_app_version text,
  mobile_install_count bigint,
  mobile_last_seen_at timestamptz,
  mobile_presence_source text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := nullif(btrim(lower(coalesce(p_filter, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_idle interval := interval '30 days';
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.users.read') then
    raise exception 'Accès refusé : permission platform.users.read manquante.'
      using errcode = '42501';
  end if;

  -- « android » continue de LEVER, et ce n'est pas un oubli : il
  -- n'existe aucun client Android, la table n'accepte que 'ios', et une
  -- liste vide se lirait « aucun utilisateur Android » — c'est-à-dire
  -- un fait, alors que la réalité est qu'il n'y a rien à mesurer.
  if v_filter = 'android' then
    raise exception 'Filtre « android » impossible : aucun client Android n''existe. La contrainte de mobile_app_installations n''accepte que « ios ».'
      using errcode = '0A000';
  elsif v_filter in ('trial', 'essai') then
    raise exception 'Filtre « % » impossible : côté Pro aucun abonnement n''est suivi, côté Apple un essai est enregistré comme « subscribed » et reste indiscernable d''un abonnement payé.', v_filter
      using errcode = '0A000';
  elsif v_filter in ('cancelled', 'resilie', 'résilié') then
    raise exception 'Filtre « % » impossible : il n''existe aucun historique de résiliation (cancelled_at est écrasé côté Pro, subscription_events est vide côté mobile).', v_filter
      using errcode = '0A000';
  elsif v_filter is not null and v_filter not in (
    'pro', 'sans_organisation', 'premium', 'gratuit', 'offert', 'actif', 'inactif', 'banni',
    'mobile', 'ios', 'mobile_declare', 'mobile_deduit'
  ) then
    raise exception 'Filtre inconnu : « % ». Attendu : pro, mobile, ios, mobile_declare, mobile_deduit, sans_organisation, premium, gratuit, offert, actif, inactif, banni.', v_filter
      using errcode = '22023';
  end if;

  return query
  with base as (
    select u.id,
           u.email::text as email,
           p.display_name,
           u.created_at,
           u.last_sign_in_at,
           u.banned_until
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.deleted_at is null
      and (
        v_q is null
        or u.email ilike '%' || v_q || '%'
        or coalesce(p.display_name, '') ilike '%' || v_q || '%'
        or u.id::text = v_q
      )
      and (
        v_filter is null
        or (v_filter = 'pro' and exists (
              select 1 from public.organization_members m
              join public.business_organizations o
                on o.id = m.organization_id and o.archived_at is null
              where m.user_id = u.id and m.archived_at is null))
        or (v_filter = 'sans_organisation' and not exists (
              select 1 from public.organization_members m
              join public.business_organizations o
                on o.id = m.organization_id and o.archived_at is null
              where m.user_id = u.id and m.archived_at is null))
        or (v_filter = 'premium' and exists (
              select 1 from public.subscription_entitlements e
              where e.user_id = u.id and e.status = 'subscribed'
                and (e.expires_at is null or e.expires_at > now())))
        or (v_filter = 'gratuit' and not exists (
              select 1 from public.subscription_entitlements e
              where e.user_id = u.id and e.status = 'subscribed'
                and (e.expires_at is null or e.expires_at > now())))
        or (v_filter = 'offert' and exists (
              select 1 from public.subscription_entitlements e
              where e.user_id = u.id and e.source = 'complimentary'))
        or (v_filter = 'actif' and u.last_sign_in_at >= now() - v_idle)
        or (v_filter = 'inactif' and (u.last_sign_in_at is null or u.last_sign_in_at < now() - v_idle))
        or (v_filter = 'banni' and u.banned_until > now())
        -- « Mobile » veut dire « on a une trace, déclarée ou déduite ».
        -- Les deux sous-filtres existent parce que la question « qui
        -- l'a vraiment ouvert depuis la mise en service ? » n'est pas
        -- la même que « qui est passé par l'iPhone un jour ? ».
        or (v_filter in ('mobile', 'ios') and exists (
              select 1 from public.mobile_app_installations i where i.user_id = u.id))
        or (v_filter = 'mobile_declare' and exists (
              select 1 from public.mobile_app_installations i
              where i.user_id = u.id and i.source = 'declared'))
        or (v_filter = 'mobile_deduit' and exists (
              select 1 from public.mobile_app_installations i
              where i.user_id = u.id and i.source = 'inferred'))
      )
  ),
  counted as (select count(*) as n from base),
  page as (
    select * from base
    order by base.created_at desc, base.id
    offset (v_page - 1) * v_size
    limit v_size
  ),
  -- Une seule agrégation par page, plutôt qu'une sous-requête par
  -- colonne : la fiche a besoin de cinq informations tirées des mêmes
  -- lignes.
  mob as (
    select i.user_id,
           -- LA PLATEFORME N'EST PAS FILTRÉE, ET C'EST DÉLIBÉRÉ : une
           -- ligne déduite porte bien 'ios', et ce n'est pas un artefact
           -- de la colonne `not null` — les cinq tables et les compteurs
           -- sur lesquels repose la déduction ne sont écrits QUE par
           -- l'application iPhone. Masquer un fait vrai pour uniformiser
           -- l'affichage serait perdre de l'information ; c'est le texte
           -- de la fiche qui doit dire d'où il vient.
           max(i.platform) as platform,
           count(*) filter (where i.source = 'declared') as installs,
           count(*) filter (where i.source = 'declared') > 0 as a_declare,
           -- LA DATE, ELLE, EST FILTRÉE — c'était le défaut le plus
           -- visible de la première écriture. Sur une ligne DÉDUITE,
           -- `last_seen_at` vaut `coalesce(derniere_trace, now())` (§3),
           -- c'est-à-dire la date du dernier ARROSAGE ou du dernier
           -- appel IA. Rendue sans filtre, elle s'affichait sur la fiche
           -- sous le libellé « Dernière annonce de l'application », avec
           -- un indice qui affirmait quatre lignes plus bas que ce
           -- n'était « ni la dernière connexion, ni le dernier geste
           -- métier ». Vérifié sur la production : la valeur était égale
           -- au dernier `care_events.created_at` à la microseconde près.
           -- Une date d'annonce n'existe que s'il y a eu annonce.
           max(i.last_seen_at) filter (where i.source = 'declared') as vu_le,
           -- La version de l'installation vue le plus récemment : sur
           -- deux téléphones, c'est celle du dernier utilisé qui décrit
           -- l'utilisateur, pas la plus haute ni la première trouvée.
           (array_agg(i.app_version order by i.last_seen_at desc)
              filter (where i.source = 'declared'))[1] as version
    from public.mobile_app_installations i
    join page b2 on b2.id = i.user_id
    group by i.user_id
  )
  select
    b.id,
    b.email,
    b.display_name,
    b.created_at,
    b.last_sign_in_at,
    b.banned_until,
    -- « Produit utilisé : Oasis Care Mobile / Pro / ou les deux »
    -- (spec p.8). La phrase est enfin complète. `null` reste possible
    -- et veut toujours dire « on ne sait pas » : un compte sans
    -- organisation et sans trace mobile n'est pas « gratuit », il est
    -- inconnu.
    case
      when exists (
        select 1 from public.organization_members m2
        join public.business_organizations o
          on o.id = m2.organization_id and o.archived_at is null
        where m2.user_id = b.id and m2.archived_at is null
      ) then case when mb.user_id is not null then 'both' else 'pro' end
      when mb.user_id is not null then 'mobile'
      else null
    end::text,
    (select count(*) from public.organization_members m2
      join public.business_organizations o
        on o.id = m2.organization_id and o.archived_at is null
      where m2.user_id = b.id and m2.archived_at is null),
    (select array_agg(o.name order by o.name)
       from public.organization_members m2
       join public.business_organizations o on o.id = m2.organization_id
      where m2.user_id = b.id and m2.archived_at is null
        and o.archived_at is null),
    (select array_agg(distinct s.plan)
       from public.organization_members m2
       join public.business_organizations o
         on o.id = m2.organization_id and o.archived_at is null
       join public.organization_subscriptions s on s.organization_id = m2.organization_id
      where m2.user_id = b.id and m2.archived_at is null),
    (select max(e.plan) from public.subscription_entitlements e
      where e.user_id = b.id and e.status = 'subscribed'
        and (e.expires_at is null or e.expires_at > now())),
    exists (select 1 from public.subscription_entitlements e
             where e.user_id = b.id and e.source = 'complimentary'),
    mb.platform,
    mb.version,
    -- `nullif(…, 0)` : un compte connu comme mobile mais uniquement par
    -- DÉDUCTION n'a aucune installation identifiée. Rendre 0 laisserait
    -- lire « il n'a aucun appareil » ; la vérité est « on ne sait pas
    -- combien ».
    nullif(mb.installs, 0),
    mb.vu_le,
    case
      when mb.user_id is null then null
      when mb.a_declare then 'declared'
      else 'inferred'
    end::text,
    (select n from counted)
  from page b
  left join mob mb on mb.user_id = b.id;
end;
$$;

-- ------------------------------------------------------------
-- 5.c La distribution des versions et des OS
-- ------------------------------------------------------------
--
-- DEUX FONCTIONS ET NON UNE, parce que ce sont deux questions
-- différentes : « puis-je arrêter de corriger la 0.1.0 (build 31) ? »
-- et « puis-je relever la cible de déploiement à iOS 26 ? ». Les
-- empiler dans une seule table de retour aurait forcé une colonne
-- « dimension » et des colonnes nulles une ligne sur deux.
--
-- ELLES NE COMPTENT QUE LES LIGNES DÉCLARÉES, forcément : une
-- déduction ne porte aucune version. Le total des déclarations est
-- rendu sur chaque ligne (idiome de `total_count` dans 0075) pour
-- qu'un pourcentage se calcule sans second appel — et pour qu'il soit
-- calculé sur la bonne population.
create or replace function public.admin_mobile_version_distribution()
returns table (
  platform text,
  app_version text,
  app_build text,
  installations bigint,
  users bigint,
  last_seen_at timestamptz,
  declared_installations_total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.dashboard.read') then
    raise exception 'Accès refusé : permission platform.dashboard.read manquante.'
      using errcode = '42501';
  end if;

  return query
  with declarees as (
    select i.*
    from public.mobile_app_installations i
    join auth.users u on u.id = i.user_id and u.deleted_at is null
    where i.source = 'declared'
  ),
  total as (select count(*) as n from declarees)
  select d.platform,
         d.app_version,
         d.app_build,
         count(*)::bigint,
         count(distinct d.user_id)::bigint,
         max(d.last_seen_at),
         (select n from total)
  from declarees d
  group by d.platform, d.app_version, d.app_build
  -- Le build est un numéro de séquence de la CI : le tri numérique est
  -- le bon quand il en est un, et l'alphabétique le seul possible
  -- sinon. On trie donc d'abord sur la dernière présence — la ligne la
  -- plus vivante en haut, qui est la question qu'on se pose.
  order by max(d.last_seen_at) desc, d.app_version desc, d.app_build desc;
end;
$$;

create or replace function public.admin_mobile_os_distribution()
returns table (
  platform text,
  os_major smallint,
  installations bigint,
  users bigint,
  last_seen_at timestamptz,
  declared_installations_total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.dashboard.read') then
    raise exception 'Accès refusé : permission platform.dashboard.read manquante.'
      using errcode = '42501';
  end if;

  return query
  with declarees as (
    select i.*
    from public.mobile_app_installations i
    join auth.users u on u.id = i.user_id and u.deleted_at is null
    where i.source = 'declared'
  ),
  total as (select count(*) as n from declarees)
  select d.platform,
         d.os_major,
         count(*)::bigint,
         count(distinct d.user_id)::bigint,
         max(d.last_seen_at),
         (select n from total)
  from declarees d
  group by d.platform, d.os_major
  -- Croissant : la question est « qu'est-ce qui traîne en bas », et la
  -- réponse se lit en première ligne.
  order by d.os_major asc;
end;
$$;


-- ============================================================
-- 6. LES DROITS
-- ============================================================
--
-- La leçon de 0057, réappliquée : Supabase accorde par défaut
-- l'exécution de toute fonction créée dans `public` au pseudo-rôle
-- `public`, donc à tout le monde, `anon` compris. Sur une fonction
-- `security definer`, la clause de garde est alors le SEUL filtre.
--
-- Les deux fonctions recréées au §5 ont perdu les droits que 0075 leur
-- avait posés (un `drop` emporte ses `grant`) : on les repose ici. Ce
-- n'est pas une redondance, c'est la réparation d'un effet de bord.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.declare_mobile_presence(text, text, text, text, integer)',
    'public.admin_platform_kpis()',
    'public.admin_list_users(text, text, integer, integer)',
    'public.admin_mobile_version_distribution()',
    'public.admin_mobile_os_distribution()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ============================================================
-- 7. CE QUI RESTE À FAIRE AILLEURS, ET QUI N'EST PAS OPTIONNEL
-- ============================================================
--
--   1. `supabase/functions/delete-account/index.ts` — la suppression
--      explicite de `mobile_app_installations` y est ajoutée par le
--      même changement que cette migration, AVANT `deleteUser`. La
--      cascade suffirait techniquement (éprouvée en transaction
--      annulée : 1 ligne avant, 0 après), mais une cascade est
--      INVISIBLE à la relecture : quelqu'un qui lit cette fonction ne
--      verrait nulle part que la télémétrie disparaît, et un futur
--      `on delete set null` la ferait survivre sans que rien n'échoue.
--      Attention : ce chemin de suppression n'a JAMAIS été exécuté (son
--      propre en-tête le dit). Il faut l'éprouver sur un compte
--      jetable — écrire une garantie RGPD qu'on n'a jamais vue
--      s'exécuter n'est pas une garantie.
--
--   2. Côté iOS : lire `CFBundleShortVersionString` et
--      `CFBundleVersion` (`Bundle.main.infoDictionary`, comme
--      `DiagnosticExportView.swift:16`), `UIDevice.current.systemVersion`
--      dont on ne garde QUE la majeure, et un identifiant
--      d'installation — `identifierForVendor`, ou un UUID tiré au
--      premier lancement et rangé dans le trousseau (aucun stockage
--      sécurisé n'existe encore dans l'application : c'est du code
--      neuf). Puis appeler `declare_mobile_presence` depuis
--      `SyncEngine.syncIfPossible`, juste après `fetchWorkspaceID()` —
--      là où l'on sait déjà qu'on est authentifié et que le réseau
--      répond. L'appel doit ÊTRE IGNORÉ EN CAS D'ERREUR : la
--      télémétrie n'a pas le droit de faire échouer une
--      synchronisation.
--
--   1 bis. ÉPROUVER `delete-account` POUR DE VRAI. Le §2.c ferme
--      l'effacement doux et la cascade ferme l'effacement dur, mais
--      aucun des deux ne remplace un essai sur un compte jetable : la
--      seule fonction de suppression du dépôt n'a jamais été exécutée.
--
--   3. Côté web-admin : `product` peut désormais valoir 'both' —
--      `productLabel()` (web-admin/lib/customers/labels.ts) doit gagner
--      cette entrée, sans quoi la fiche affichera le mot brut. Le
--      filtre « Mobile », dessiné éteint par `filters.ts`, peut être
--      rallumé ; le motif qui l'accompagnait n'est plus vrai.
