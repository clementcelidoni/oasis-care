-- ============================================================
-- 0090 — LES ÉTIQUETTES : LE RÉSOLVEUR, ET CE QUI LUI MANQUAIT
-- Architecture Oasis Rare Care, § 12 à § 19.
-- ============================================================
--
-- LIRE CET EN-TÊTE EN ENTIER AVANT DE TOUCHER À QUOI QUE CE SOIT.
-- Une étiquette collée sur un arbre y reste dix ans. Ce fichier décide
-- de choses qu'on ne pourra pas défaire sans décoller des autocollants.
--
-- ------------------------------------------------------------
-- CE QUI ÉTAIT CASSÉ, MESURÉ AVANT D'ÉCRIRE UNE LIGNE
-- ------------------------------------------------------------
--
--   1. IL N'EXISTAIT AUCUN RÉSOLVEUR. La résolution d'un jeton se
--      faisait entièrement dans la base SwiftData locale de l'iPhone.
--      Le seul appel réseau du produit était un
--      « select plant_id from smart_tags where public_token = ? », qui
--      passe par la RLS ordinaire : une étiquette ne pouvait être lue
--      QUE par un téléphone qui possédait déjà la donnée. Un client, un
--      salarié d'une autre équipe, un contrôleur : personne.
--      Le § 15 demande exactement l'inverse — « le backend détermine
--      l'organisation, l'entité, les permissions, l'écran à ouvrir ».
--
--   2. CE SEUL APPEL NE SÉLECTIONNAIT QUE plant_id. Sur les CINQ
--      étiquettes de production, 3 (un lot de culture, deux racks)
--      rendaient NULL même à leur propriétaire.
--
--   3. smart_tags NE PORTAIT QUE workspace_id. Toutes les entités
--      professionnelles que le § 13 veut étiqueter — jardin client,
--      zone d'arrosage, lot de pépinière, emplacement, matériel —
--      étaient hors d'atteinte : elles vivent sur l'axe
--      « organization_id », et smart_tags ne le connaissait pas.
--
--   4. UN SECOND REGISTRE DE JETONS VIVAIT À CÔTÉ, sans lien :
--      nursery_lots.public_token, posé par 0052, avec sa propre
--      génération et son propre index. Ce fichier le réconcilie (§ 4).
--
-- ------------------------------------------------------------
-- CE QU'ON NE REFAIT PAS, ET POURQUOI
-- ------------------------------------------------------------
--
--   • PAS DE SECONDE TABLE. Le § 14 est déjà respecté : UNE table
--     porte le QR et le NFC, distingués par la colonne « type ». On
--     l'ÉTEND, on ne la double pas. « Ne pas créer deux bases de
--     données indépendantes QR et NFC » est écrit noir sur blanc.
--
--   • PAS DE CINQUIÈME REGISTRE DE JETONS. Il en existe quatre :
--     smart_tags.public_token, nursery_lots.public_token,
--     client_invitations.token et document_share_links.token (0089,
--     appliquée depuis). Ce fichier n'en ajoute AUCUN : il
--     réutilise smart_tags et absorbe nursery_lots.
--
--   • LA FORME DU § 8 DE 0089 EST REPRISE là où elle s'applique :
--     fonction « security definer » accordée à anon, colonnes
--     énumérées une par une, MÊME phrase de refus dans tous les cas,
--     compteur d'échecs par fenêtre qui s'arrête au seuil.
--     CE QUI CHANGE : un jeton d'étiquette N'EXPIRE PAS. Il est collé
--     sur un arbre. C'est la révocation (active = false) et la
--     disparition de l'entité qui le tuent, jamais l'horloge.
--     L'ORDRE AVEC 0089 EST INDIFFÉRENT : 0090 ne dépend d'AUCUN de
--     ses objets. Elle a été écrite alors que 0089 n'était pas encore
--     appliquée, et éprouvée après qu'elle l'a été — vérifié dans les
--     deux états.
--
-- ------------------------------------------------------------
-- L'ADRESSE IMPRIMÉE — UNE DÉCISION À CONFIRMER, PAS UNE LIGNE DE SQL
-- ------------------------------------------------------------
--
-- Le domaine encodé dans les cinq QR déjà imprimés est
-- « oasis-care.example ». Le domaine de premier niveau .example est
-- RÉSERVÉ par la RFC 2606 : il ne résout pas et ne résoudra jamais.
--
-- CE FICHIER NE PORTE AUCUNE ADRESSE, ET C'EST DÉLIBÉRÉ. Une adresse
-- en base serait une adresse à migrer ; une adresse dans le code Swift
-- serait une adresse à réimprimer. Elle se règle par variable
-- d'environnement côté serveur (OASIS_ETIQUETTES_BASE_URL, sur la
-- discipline de NEXT_PUBLIC_SITE_URL : lue, jamais codée en dur, refus
-- explicite si absente). Le jeton, lui, est opaque et résolu ici : le
-- jour où l'adresse change, RIEN n'est à réimprimer.
--
-- LA PROPOSITION, À FAIRE CONFIRMER PAR LE DIRIGEANT :
--   https://oasisrarecare.fr/x/<jeton>
--   • le dirigeant possède oasisrarecare.fr et oasisrarecare.com ;
--     .com est déjà authentifié auprès du transporteur de courriel,
--     donc la maîtrise DNS des deux est acquise ;
--   • .fr fait un caractère de moins que .com, et sur une étiquette de
--     25 × 15 mm un caractère fait parfois basculer une version de QR
--     entière ;
--   • /x/ est le chemin du § 15 (« oasisrare.app/x/AB98K4 ») ;
--   • séparer l'adresse des étiquettes du site vitrine évite qu'une
--     refonte du site casse dix ans d'autocollants.
--
-- LA DENSITÉ, CHIFFRÉE, parce que c'est une contrainte physique :
--   « https://oasisrarecare.fr/x/ » + 32 hexadécimaux = 59 caractères,
--   soit un QR version 4 (33 × 33 modules) en mode octet, correction M.
--   Sur 25 × 15 mm le carré utile fait ~13 mm : 0,39 mm par module.
--   En dessous de ~0,4 mm un appareil photo décroche. C'est À LA LIMITE.
--   Raccourcir le JETON rapporte plus que raccourcir le domaine : un
--   jeton de 16 caractères ferait 43 caractères au total, soit une
--   version 3 (0,45 mm par module), confortable.
--   CE FICHIER GARDE 32 HEXADÉCIMAUX (128 bits), pour trois raisons :
--   c'est la forme des cinq jetons déjà imprimés, c'est celle du second
--   registre qu'on absorbe, et la garde du § 5 rend l'énumération
--   visible. Raccourcir est une décision de produit ; elle se prendra
--   en changeant UNE expression régulière ici et un défaut de colonne,
--   sans rien réimprimer de ce qui existe.
--
-- ------------------------------------------------------------
-- LES CINQ ÉTIQUETTES DÉJÀ EN PRODUCTION
-- ------------------------------------------------------------
-- Toutes actives, toutes de type 'qr', toutes dans le workspace
-- ce0dba90-…, aucune jamais scannée (last_scanned_at NULL sur les 5).
-- Deux visent une plante, une un lot de culture, deux un rack.
-- CE FICHIER NE DOIT EN CASSER AUCUNE : le test le vérifie par jeton,
-- une par une, en les résolvant pour de vrai.
-- Bonne nouvelle du lot : une réimpression coûte cinq étiquettes.
-- Et le scanner de l'app ne vérifie PAS l'hôte de l'URL — les cinq
-- resteront scannables depuis Oasis Care quel que soit le domaine
-- futur. Ce qui est mort, c'est le scan par la caméra du système.


-- ============================================================
-- 1. smart_tags SAIT ENFIN DÉSIGNER LE MONDE PROFESSIONNEL
-- ============================================================
--
-- ONZE COLONNES NEUVES, ET NON UNE PAIRE POLYMORPHE
-- (entity_kind text, entity_id uuid). Le choix mérite d'être écrit,
-- parce que la paire polymorphe est plus courte et plus tentante :
--
--   • une paire polymorphe n'a AUCUNE intégrité référentielle. Rien
--     n'empêche d'y écrire l'identifiant d'une ligne d'un autre client,
--     ou d'une ligne qui n'existe pas ;
--   • surtout, rien ne la nettoie. Une clé étrangère « on delete
--     cascade » fait mourir l'étiquette avec l'entité — sans quoi un
--     lot supprimé laisse derrière lui une étiquette qui résout dans le
--     vide, et un résolveur qui doit apprendre à ne pas croire ses
--     propres colonnes.
--
-- On paie ce choix d'une colonne par famille d'objets, et d'une
-- migration le jour où une famille neuve apparaît. C'est le prix de
-- l'intégrité, et 0037 avait déjà fait le même choix pour BioLab.
--
-- LES CINQ PORTÉES EXISTANTES NE SONT PAS TOUCHÉES : plant_id,
-- bioreactor_id, culture_batch_id, medium_recipe_version_id,
-- acclimatization_batch_id et rack_label restent exactement ce
-- qu'elles sont. L'iPhone continue d'écrire comme avant.

alter table public.smart_tags
  -- L'AXE PROFESSIONNEL. smart_tags vivait sur workspace_id seul ;
  -- nursery_lots, nursery_locations et equipment vivent sur
  -- organization_id. C'est ce mur-là qui rendait tout le § 13
  -- inatteignable. Nullable : une étiquette de particulier n'a pas
  -- d'organisation, et il ne faut surtout pas lui en inventer une.
  add column if not exists organization_id uuid
    references public.business_organizations (id) on delete cascade,

  -- JARDINS CLIENTS (§ 13, première liste). Ces sept-là vivent sur
  -- l'axe workspace, comme les plantes.
  add column if not exists garden_id uuid
    references public.gardens (id) on delete cascade,
  add column if not exists garden_zone_id uuid
    references public.garden_zones (id) on delete cascade,
  add column if not exists garden_area_id uuid
    references public.garden_areas (id) on delete cascade,
  add column if not exists irrigation_zone_id uuid
    references public.irrigation_zones (id) on delete cascade,
  add column if not exists pond_id uuid
    references public.ponds (id) on delete cascade,
  add column if not exists sensor_id uuid
    references public.sensors (id) on delete cascade,

  -- « pompe », « filtre », « électrovanne », « robot », « coffret » du
  -- § 13 N'ONT AUCUNE TABLE dans cette base — cherché table par table.
  -- Le § 11 les prévoit comme catégories d'un connected_devices
  -- commun, qui existe (colonne category) et compte zéro ligne. On
  -- étiquette donc le matériel connecté, et les cinq mots du § 13
  -- deviendront des catégories de cette table le jour où quelqu'un en
  -- créera. Pas de table fantôme posée par avance.
  add column if not exists connected_device_id uuid
    references public.connected_devices (id) on delete cascade,

  -- MATÉRIEL — l'entrée « équipement » des TROIS listes du § 13.
  -- Axe organisation.
  add column if not exists equipment_id uuid
    references public.equipment (id) on delete cascade,

  -- PÉPINIÈRE. « emplacement », « zone » et « serre » du § 13 sont en
  -- réalité la MÊME table, nursery_locations, dont la colonne kind
  -- porte greenhouse / row / bench / outdoorBlock / tunnel. Une seule
  -- colonne suffit donc pour ces trois entrées.
  add column if not exists nursery_lot_id uuid
    references public.nursery_lots (id) on delete cascade,
  add column if not exists nursery_location_id uuid
    references public.nursery_locations (id) on delete cascade,

  -- ------------------------------------------------------------
  -- CE QU'UN INCONNU A LE DROIT DE VOIR — UN ACTE DE PUBLICATION
  -- ------------------------------------------------------------
  -- Le porteur le plus fréquent en vrai n'est ni l'employé ni le
  -- client : c'est le passant qui scanne une étiquette dans un jardin.
  -- Que voit-il ? La réponse ne peut pas être la même pour une plante
  -- d'un jardin ouvert au public et pour un lot de pépinière qui porte
  -- un fournisseur et une quantité.
  --
  -- LE DÉFAUT EST « false », ET C'EST VOLONTAIRE. Une étiquette ne
  -- parle à un inconnu que si quelqu'un a explicitement décidé qu'elle
  -- le devait. Publier est un geste, jamais un défaut. Conséquence
  -- assumée : les cinq étiquettes existantes ne diront rien à un
  -- passant tant que leur propriétaire n'aura pas coché la case.
  add column if not exists public_fiche boolean not null default false,

  -- COMBIEN DE FOIS CETTE ÉTIQUETTE A ÉTÉ RÉSOLUE. last_scanned_at
  -- existait déjà et valait NULL sur les cinq : personne ne l'écrivait,
  -- puisqu'il n'y avait pas de serveur pour le faire. Le résolveur
  -- l'écrit maintenant, et compte.
  add column if not exists scanned_count integer not null default 0;

-- UN JETON FABRIQUÉ PAR LA BASE, ENFIN. La colonne n'avait AUCUN
-- défaut : le jeton venait toujours de l'iPhone (UUID sans tirets,
-- minuscules, 128 bits du CSPRNG de Foundation). Le web doit pouvoir
-- en créer aussi, et 16 octets de gen_random_bytes donnent EXACTEMENT
-- la même forme — 32 caractères hexadécimaux, 128 bits — que les cinq
-- jetons existants et que le second registre absorbé au § 4. Un seul
-- alphabet, une seule longueur, une seule expression régulière.
alter table public.smart_tags
  alter column public_token set default encode(gen_random_bytes(16), 'hex');

-- ET UN IDENTIFIANT, POUR LA MÊME RAISON. `id` n'avait pas de défaut
-- non plus : l'iPhone fabriquait l'UUID en Swift avant de pousser la
-- ligne. Une insertion venue du web échouait donc sur un NOT NULL, ce
-- qui est exactement ce qu'a montré le premier essai de cette
-- migration en transaction annulée.
alter table public.smart_tags
  alter column id set default gen_random_uuid();

-- QR OU NFC, ET RIEN D'AUTRE. Le § 14 fait de « type » la seule chose
-- qui distingue les deux, ce qui n'a de sens que si le vocabulaire est
-- fermé. Les cinq lignes de production valent 'qr' ; zéro ligne 'nfc'
-- n'a jamais été écrite, ce qui veut dire qu'aucune étiquette NFC n'a
-- jamais été programmée par personne.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.smart_tags'::regclass and conname = 'smart_tags_type_connu'
  ) then
    alter table public.smart_tags
      add constraint smart_tags_type_connu check (type in ('qr', 'nfc'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 1.b AU PLUS UNE CIBLE — LA CONTRAINTE QUI REND LE RESTE LISIBLE
-- ------------------------------------------------------------
-- Le modèle Swift l'assume déjà en commentaire — « any one of several,
-- never more than one meaningfully set » — mais rien ne l'imposait.
-- Sans cette contrainte, les colonnes calculées du § 1.c devraient
-- choisir en silence entre deux cibles, et un silence dans une barrière
-- de sécurité est une faille en attente.
--
-- « AU PLUS UNE », ET NON « EXACTEMENT UNE » : le § 19 décrit un tag
-- NFC vierge qu'on programme AVANT de l'associer, et un rouleau
-- d'étiquettes pré-imprimées est un usage normal en pépinière. Une
-- étiquette sans cible est donc légitime ; le résolveur sait le dire.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.smart_tags'::regclass and conname = 'smart_tags_une_seule_cible'
  ) then
    alter table public.smart_tags
      add constraint smart_tags_une_seule_cible check (
        (case when plant_id is not null then 1 else 0 end)
        + (case when bioreactor_id is not null then 1 else 0 end)
        + (case when culture_batch_id is not null then 1 else 0 end)
        + (case when medium_recipe_version_id is not null then 1 else 0 end)
        + (case when acclimatization_batch_id is not null then 1 else 0 end)
        + (case when garden_id is not null then 1 else 0 end)
        + (case when garden_zone_id is not null then 1 else 0 end)
        + (case when garden_area_id is not null then 1 else 0 end)
        + (case when irrigation_zone_id is not null then 1 else 0 end)
        + (case when pond_id is not null then 1 else 0 end)
        + (case when sensor_id is not null then 1 else 0 end)
        + (case when connected_device_id is not null then 1 else 0 end)
        + (case when equipment_id is not null then 1 else 0 end)
        + (case when nursery_lot_id is not null then 1 else 0 end)
        + (case when nursery_location_id is not null then 1 else 0 end)
        + (case when rack_label is not null then 1 else 0 end)
        <= 1
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- 1.c LA CIBLE, EN DEUX COLONNES CALCULÉES
-- ------------------------------------------------------------
-- Le résolveur du § 6 aurait pu dérouler seize « if » pour retrouver
-- ce que l'étiquette vise. Il lit deux colonnes à la place. Elles sont
-- CALCULÉES et non maintenues à la main : une colonne dénormalisée
-- qu'un « update » peut désynchroniser de sa source n'a rien à faire
-- au cœur d'une barrière de sécurité.
--
-- Le vocabulaire est celui de l'application (camelCase), le même que
-- celui des énumérations déjà en base ('internalReview',
-- 'nurseryManager'). Un client web et un iPhone lisent le même mot.
alter table public.smart_tags
  add column if not exists entity_kind text
    generated always as (
      case
        when plant_id is not null then 'plant'
        when bioreactor_id is not null then 'bioreactor'
        when culture_batch_id is not null then 'cultureBatch'
        when medium_recipe_version_id is not null then 'mediumRecipeVersion'
        when acclimatization_batch_id is not null then 'acclimatizationBatch'
        when garden_id is not null then 'garden'
        when garden_zone_id is not null then 'gardenZone'
        when garden_area_id is not null then 'gardenArea'
        when irrigation_zone_id is not null then 'irrigationZone'
        when pond_id is not null then 'pond'
        when sensor_id is not null then 'sensor'
        when connected_device_id is not null then 'connectedDevice'
        when equipment_id is not null then 'equipment'
        when nursery_lot_id is not null then 'nurseryLot'
        when nursery_location_id is not null then 'nurseryLocation'
        when rack_label is not null then 'rack'
      end
    ) stored,

  -- « rack » n'a pas d'identifiant, et c'est exact : aucune table de
  -- rack n'existe dans cette base. Un rack est une étiquette physique
  -- portant un libellé, rien derrière. entity_id vaut donc NULL pour
  -- lui, et le résolveur le sait.
  add column if not exists entity_id uuid
    generated always as (
      coalesce(plant_id, bioreactor_id, culture_batch_id, medium_recipe_version_id,
               acclimatization_batch_id, garden_id, garden_zone_id, garden_area_id,
               irrigation_zone_id, pond_id, sensor_id, connected_device_id,
               equipment_id, nursery_lot_id, nursery_location_id)
    ) stored;

-- L'index qui sert le résolveur : il cherche par jeton, sur les
-- étiquettes actives, et rien d'autre.
create index if not exists smart_tags_actives_par_jeton_idx
  on public.smart_tags (public_token) where active;

-- Et les index qui servent l'autre sens — « quelles étiquettes pour cet
-- objet ? », la question du § 16 quand on imprime les QR d'un lot ou
-- d'un jardin. Un seul index sur la paire calculée les couvre tous.
create index if not exists smart_tags_par_cible_idx
  on public.smart_tags (entity_kind, entity_id);

create index if not exists smart_tags_par_organisation_idx
  on public.smart_tags (organization_id) where organization_id is not null;

comment on column public.smart_tags.organization_id is
  'L''axe professionnel. Rempli automatiquement par smart_tags_portee() : depuis la cible quand elle '
  'porte une organisation, sinon depuis le pont business_organizations.workspace_id. NULL pour une '
  'étiquette de particulier — et il ne faut surtout pas lui inventer une organisation.';

comment on column public.smart_tags.public_fiche is
  'Vrai quand le propriétaire a DÉCIDÉ que cette étiquette parle aussi aux inconnus. Défaut faux : '
  'publier est un geste. Même vrai, le résolveur ne rend que la fiche botanique — jamais un prix, '
  'jamais une quantité, jamais un client.';

comment on column public.smart_tags.entity_kind is
  'Calculée : la famille de l''objet visé, en un mot du vocabulaire de l''application. NULL quand '
  'l''étiquette est vierge (un tag NFC programmé mais pas encore associé, § 19).';


-- ============================================================
-- 2. LA COHÉRENCE DE PORTÉE — ÉCRITE PAR LA BASE, PAS PAR LE CLIENT
-- ============================================================
--
-- LE TROU QUE CE DÉCLENCHEUR BOUCHE, ET IL EST RÉEL : rien
-- n'empêchait un membre du workspace A de créer une étiquette avec
-- workspace_id = A pointant sur une plante du workspace B. La
-- politique RLS ne regarde que workspace_id ; elle aurait laissé
-- passer. Le résolveur, lui, est « security definer » : il aurait
-- consciencieusement livré la plante de B.
--
-- La portée d'une étiquette N'EST PAS UNE DONNÉE SAISIE : elle se
-- DÉDUIT de la cible. Ce déclencheur la déduit et refuse toute
-- contradiction. Le résolveur du § 6 la redéduit quand même à la
-- lecture — deux barrières valent mieux qu'une colonne à laquelle on
-- fait confiance.
--
-- ------------------------------------------------------------
-- 2.a LA PORTÉE D'UNE CIBLE — UNE SEULE DÉFINITION, DEUX APPELANTS
-- ------------------------------------------------------------
-- Le déclencheur ci-dessous et etiquette_creer() du § 7 posent la même
-- question : « à qui appartient cet objet ? ». Elle est écrite une
-- fois. Deux copies d'une règle de cloisonnement, ce sont deux règles
-- qui divergeront.
--
-- ELLE NE FILTRE PAS LES SUPPRESSIONS DOUCES, et c'est voulu : elle
-- répond à « à qui », pas à « est-ce visible ». Un objet archivé
-- appartient toujours à son entreprise. C'est le résolveur du § 6 qui
-- décide de ne pas le montrer, et il refait ses propres lectures pour
-- cela.
create or replace function public.etiquette_portee_cible(p_kind text, p_id uuid)
returns table (ws uuid, org uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind is null or p_id is null then
    return;
  end if;

  case p_kind
    when 'plant' then
      return query select p.workspace_id, null::uuid from public.plants p where p.id = p_id;
    when 'bioreactor' then
      return query select b.workspace_id, null::uuid from public.bioreactors b where b.id = p_id;
    when 'cultureBatch' then
      return query select c.workspace_id, null::uuid from public.culture_batches c where c.id = p_id;
    when 'mediumRecipeVersion' then
      return query select v.workspace_id, null::uuid from public.medium_recipe_versions v where v.id = p_id;
    when 'acclimatizationBatch' then
      return query select a.workspace_id, null::uuid from public.acclimatization_batches a where a.id = p_id;
    when 'garden' then
      return query select g.workspace_id, null::uuid from public.gardens g where g.id = p_id;
    when 'gardenZone' then
      -- garden_zones ne porte PAS de workspace_id : elle passe par son
      -- jardin. C'est la seule cible indirecte du lot.
      return query select g.workspace_id, null::uuid
        from public.garden_zones z join public.gardens g on g.id = z.garden_id where z.id = p_id;
    when 'gardenArea' then
      return query select a.workspace_id, null::uuid from public.garden_areas a where a.id = p_id;
    when 'irrigationZone' then
      return query select i.workspace_id, null::uuid from public.irrigation_zones i where i.id = p_id;
    when 'pond' then
      return query select p.workspace_id, null::uuid from public.ponds p where p.id = p_id;
    when 'sensor' then
      return query select s.workspace_id, null::uuid from public.sensors s where s.id = p_id;
    when 'connectedDevice' then
      return query select d.workspace_id, null::uuid from public.connected_devices d where d.id = p_id;
    when 'equipment' then
      return query select null::uuid, e.organization_id from public.equipment e where e.id = p_id;
    when 'nurseryLot' then
      return query select null::uuid, l.organization_id from public.nursery_lots l where l.id = p_id;
    when 'nurseryLocation' then
      return query select null::uuid, o.organization_id from public.nursery_locations o where o.id = p_id;
    else
      return;
  end case;
end $$;

create or replace function public.smart_tags_portee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text;
  v_id uuid;
  v_ws uuid;
  v_org uuid;
begin
  -- ---- 0. LA TRACE DE SCAN NE RECULE JAMAIS ------------------
  -- LE RÉSOLVEUR ÉCRIT MAINTENANT last_scanned_at CÔTÉ SERVEUR, et
  -- l'iPhone continue de l'envoyer dans son SmartTagDTO. Une
  -- synchronisation partie d'un téléphone qui n'a pas vu le scan du
  -- serveur écraserait donc un horodatage récent par un plus ancien —
  -- voire par NULL. L'écran de suivi montrerait alors une étiquette
  -- « jamais scannée » qui vient de l'être, et c'est exactement le
  -- chiffre sur lequel on décide de remplacer un autocollant.
  --
  -- ON CORRIGE ICI PLUTÔT QUE D'AMPUTER LE DTO : la base est le seul
  -- endroit que TOUS les écrivains traversent — l'iPhone, le web, et
  -- ce qui viendra ensuite. « greatest » ignore les NULL, donc une
  -- synchronisation muette ne fait rien, ce qui est le comportement
  -- voulu.
  if tg_op = 'UPDATE' then
    new.last_scanned_at := greatest(old.last_scanned_at, new.last_scanned_at);
    new.scanned_count := greatest(coalesce(old.scanned_count, 0), coalesce(new.scanned_count, 0));
  end if;

  -- ---- 1. LA PORTÉE DE LA CIBLE ------------------------------
  -- LES COLONNES CALCULÉES entity_kind ET entity_id NE SONT PAS
  -- DISPONIBLES ICI : PostgreSQL évalue les colonnes « generated »
  -- APRÈS les déclencheurs BEFORE. On refait donc le même choix sur
  -- les colonnes brutes. La contrainte du § 1.b garantit qu'au plus
  -- une est renseignée, donc que ce choix n'en cache aucun autre.
  v_kind := case
    when new.plant_id is not null then 'plant'
    when new.bioreactor_id is not null then 'bioreactor'
    when new.culture_batch_id is not null then 'cultureBatch'
    when new.medium_recipe_version_id is not null then 'mediumRecipeVersion'
    when new.acclimatization_batch_id is not null then 'acclimatizationBatch'
    when new.garden_id is not null then 'garden'
    when new.garden_zone_id is not null then 'gardenZone'
    when new.garden_area_id is not null then 'gardenArea'
    when new.irrigation_zone_id is not null then 'irrigationZone'
    when new.pond_id is not null then 'pond'
    when new.sensor_id is not null then 'sensor'
    when new.connected_device_id is not null then 'connectedDevice'
    when new.equipment_id is not null then 'equipment'
    when new.nursery_lot_id is not null then 'nurseryLot'
    when new.nursery_location_id is not null then 'nurseryLocation'
  end;
  v_id := coalesce(new.plant_id, new.bioreactor_id, new.culture_batch_id,
                   new.medium_recipe_version_id, new.acclimatization_batch_id,
                   new.garden_id, new.garden_zone_id, new.garden_area_id,
                   new.irrigation_zone_id, new.pond_id, new.sensor_id,
                   new.connected_device_id, new.equipment_id,
                   new.nursery_lot_id, new.nursery_location_id);

  select c.ws, c.org into v_ws, v_org
    from public.etiquette_portee_cible(v_kind, v_id) c;

  -- ---- 2. LE PONT ENTRE LES DEUX AXES ------------------------
  -- create_professional_organization() crée le workspace ET
  -- l'organisation ensemble : le pont business_organizations.workspace_id
  -- est donc bijectif en pratique. On le traverse dans les deux sens,
  -- mais on ne l'INVENTE jamais : un workspace personnel n'a pas
  -- d'organisation, et son étiquette n'en aura pas non plus.
  if v_org is not null and v_ws is null then
    -- SYMÉTRIQUE DU PONT D'AU-DESSUS : lui filtrait déjà les
    -- entreprises archivées, celui-ci ne le faisait pas. Une
    -- asymétrie non commentée finit toujours par être lue comme
    -- une intention.
    select o.workspace_id into v_ws from public.business_organizations o
     where o.id = v_org and o.archived_at is null;
  elsif v_ws is not null and v_org is null then
    select o.id into v_org from public.business_organizations o
     where o.workspace_id = v_ws and o.archived_at is null
     order by o.created_at limit 1;
  end if;

  -- ---- 3. ON ÉCRIT, OU ON REFUSE -----------------------------
  if v_ws is not null then
    -- Une contradiction n'est pas corrigée en silence : elle est
    -- refusée. Corriger en silence, c'est laisser une tentative de
    -- traversée réussir à moitié sans que personne ne l'apprenne.
    if new.workspace_id is not null and new.workspace_id <> v_ws then
      raise exception 'Étiquette incohérente : la cible appartient à un autre espace de travail.'
        using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
  end if;

  if v_org is not null then
    if new.organization_id is not null and new.organization_id <> v_org then
      raise exception 'Étiquette incohérente : la cible appartient à une autre entreprise.'
        using errcode = '42501';
    end if;
    new.organization_id := v_org;
  end if;

  -- Une étiquette VIERGE (aucune cible) garde la portée qu'on lui
  -- donne : c'est un rouleau pré-imprimé, il appartient à celui qui l'a
  -- commandé. rack_label, qui n'a aucune ligne derrière, suit la même
  -- règle.
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists smart_tags_portee_trg on public.smart_tags;
create trigger smart_tags_portee_trg
  before insert or update on public.smart_tags
  for each row execute function public.smart_tags_portee();

comment on function public.smart_tags_portee() is
  'Déduit workspace_id et organization_id de la CIBLE de l''étiquette, et refuse toute contradiction. '
  'Sans lui, une étiquette pouvait déclarer un espace de travail et viser l''objet d''un autre — le '
  'résolveur, qui est security definer, l''aurait servi sans broncher.';

-- LES CINQ LIGNES EXISTANTES PASSENT PAR LÀ UNE FOIS, pour que leur
-- organization_id se remplisse si leur workspace porte une entreprise.
-- Aujourd'hui il ne le porte pas (le workspace ce0dba90-… n'a aucune
-- business_organization), donc cette mise à jour ne changera rien —
-- mais elle le fera le jour où le dirigeant rattachera son espace, et
-- elle vérifie dès maintenant que le déclencheur n'en rejette aucune.
update public.smart_tags set updated_at = updated_at;


-- ------------------------------------------------------------
-- 2.b LES ÉTIQUETTES DÉJÀ COLLÉES SONT MARQUÉES, UNE FOIS
-- ------------------------------------------------------------
-- LA PREMIÈRE QUESTION QUE POSERA LE DIRIGEANT : « et mes étiquettes
-- déjà collées ? » Toutes celles qui existent au moment où cette
-- migration s'applique ont été imprimées avec « oasis-care.example ».
-- Le .example est RÉSERVÉ par la RFC 2606 : il ne résout pas, il ne
-- résoudra jamais, aucun enregistrement n'est possible. Ces
-- autocollants restent scannables DEPUIS l'application Oasis Care —
-- son lecteur ne vérifie pas l'hôte et ne fait aucune requête DNS —
-- mais ils sont morts pour l'appareil photo d'un téléphone et pour
-- toute personne qui n'a pas l'application.
--
-- LA BASE NE PEUT PAS SAVOIR QUELLE ADRESSE A ÉTÉ IMPRIMÉE : l'URL est
-- calculée depuis le jeton, jamais stockée. Ce drapeau dit donc la
-- seule chose vraie — « cette étiquette existait avant que le produit
-- n'ait une vraie adresse ». L'écran s'en sert pour COMPTER ce que
-- coûte la réimpression, au lieu de l'estimer.
--
-- Il est posé UNE SEULE FOIS, sur les lignes présentes à cet instant.
-- Toute étiquette créée après naît à false, et la synchronisation de
-- l'iPhone n'y touche pas : SmartTagDTO n'envoie pas cette colonne, et
-- un upsert ne réécrit que les colonnes qu'il nomme.
-- LE MARQUAGE EST LIÉ À LA CRÉATION DE LA COLONNE, et c'est ce qui le
-- rend rejouable pour de bon. Un « update … where not ancienne_adresse »
-- rejoué marquerait les étiquettes créées ENTRE LES DEUX PASSAGES — sur
-- une base neuve, où le premier passage ne marque rien, le second
-- aurait déclaré « ancienne » une étiquette imprimée hier avec la bonne
-- adresse. Ici, la colonne n'existe qu'une fois ; le marquage aussi.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'smart_tags'
       and column_name = 'ancienne_adresse')
  then
    alter table public.smart_tags
      add column ancienne_adresse boolean not null default false;
    update public.smart_tags set ancienne_adresse = true;
  end if;
end $$;

comment on column public.smart_tags.ancienne_adresse is
  'Vrai pour les étiquettes qui existaient avant 0090, donc imprimées avec le domaine mort '
  '« oasis-care.example » (RFC 2606). Elles se scannent encore depuis l''application, jamais '
  'avec l''appareil photo du téléphone. Sert à chiffrer la réimpression, pas à décider.';


-- ============================================================
-- 3. LA RLS — L'AXE ORGANISATION S'AJOUTE, L'AXE WORKSPACE RESTE
-- ============================================================
--
-- La politique existante — « Workspace members can manage smart tags »,
-- ALL, using is_workspace_member(workspace_id) — N'EST PAS TOUCHÉE.
-- C'est elle qui fait vivre l'iPhone, et la remplacer serait risquer de
-- casser la synchronisation pour gagner de l'élégance.
--
-- ON AJOUTE UNE SECONDE POLITIQUE, EN LECTURE SEULE, sur l'axe
-- organisation. Les politiques d'une table se combinent par OU : un
-- membre de l'entreprise qui n'est pas membre du workspace — le cas
-- d'un salarié rattaché à l'entreprise seule — voit maintenant les
-- étiquettes de son entreprise.
--
-- L'ÉCRITURE N'EST PAS OUVERTE PAR CETTE POLITIQUE. Créer une étiquette
-- professionnelle passe par etiquette_creer() du § 7, et par elle
-- seule : c'est là que le droit est vérifié.
drop policy if exists "L'entreprise lit les étiquettes de ses éléments" on public.smart_tags;
create policy "L'entreprise lit les étiquettes de ses éléments" on public.smart_tags
  for select using (
    organization_id is not null
    and public.has_permission(organization_id, 'etiquettes.read')
  );


-- ============================================================
-- 4. LE SECOND REGISTRE — ABSORBÉ, PAS SUPPRIMÉ
-- ============================================================
--
-- nursery_lots.public_token existe depuis 0052 :
--   public_token text unique default encode(gen_random_bytes(16), 'hex')
-- plus son propre index. Même longueur, même alphabet, même entropie
-- que smart_tags.public_token — donc DEUX REGISTRES INDISCERNABLES À
-- L'ŒIL, interrogés par le même résolveur. Ce n'est pas un risque de
-- collision (128 bits contre 128 bits, la probabilité est négligeable) :
-- c'est un ORDRE DE RECHERCHE à écrire noir sur blanc, sinon le
-- prochain le réinventera au hasard.
--
-- LES DEUX RAISONS QU'INVOQUAIT 0052, RÉEXAMINÉES :
--   1. « smart_tags.plant_id est NOT NULL » — FAUX DÈS L'ÉCRITURE.
--      0037, ANTÉRIEURE à 0052, faisait déjà « alter column plant_id
--      drop not null ». Vérifié en production : is_nullable = 'YES'.
--   2. « axes de cloisonnement différents » — vraie à l'époque, et
--      c'était la seule vraie raison. Le § 1 vient de la lever.
--
-- CE QUE COÛTE LA RÉCONCILIATION, MESURÉ : une seule ligne dans
-- nursery_lots en production, et ZÉRO code lit cette colonne. Le grep
-- sur tout le dépôt ne rend que trois endroits : la migration 0052 qui
-- la crée, supabase/tests/nursery_stock.sql, et une déclaration de type
-- TypeScript jamais consultée. C'est un jeton fabriqué pour personne
-- depuis 0052.

-- ---- 4.a ON RECOPIE, ON NE RÉGÉNÈRE PAS -----------------------
-- UN JETON QUI CHANGE EST UNE ÉTIQUETTE À REFAIRE. Si quelqu'un a
-- imprimé un QR sur ce lot, il doit continuer de résoudre. On reprend
-- donc le jeton EXISTANT, tel quel, dans une ligne smart_tags.
--
-- « on conflict (public_token) do nothing » : rejouer cette migration
-- ne crée pas de doublon, et un jeton déjà présent des deux côtés — ce
-- qui n'arrivera pas, mais coûte zéro à prévoir — laisse smart_tags
-- gagner, ce qui est exactement l'ordre de recherche du § 6.
insert into public.smart_tags (workspace_id, organization_id, nursery_lot_id, type, public_token, active)
select o.workspace_id, l.organization_id, l.id, 'qr', l.public_token, true
  from public.nursery_lots l
  join public.business_organizations o on o.id = l.organization_id
 where l.public_token is not null
   and l.archived_at is null
   and o.workspace_id is not null
   and not exists (select 1 from public.smart_tags t where t.nursery_lot_id = l.id)
on conflict (public_token) do nothing;

-- ---- 4.b ON CESSE D'EN FABRIQUER DE NOUVEAUX -------------------
-- Le DEFAULT part : à partir d'ici, un lot neuf n'a plus de jeton à
-- lui. Son étiquette passe par smart_tags comme tout le reste.
alter table public.nursery_lots alter column public_token drop default;

-- LA COLONNE ET SON INDEX RESTENT. Trois raisons, et la troisième
-- suffirait :
--   • un QR déjà imprimé portant l'ancien jeton doit continuer de
--     résoudre — c'est le repli du § 6 ;
--   • un « drop column » est la seule opération de cette liste qui soit
--     irréversible ;
--   • elle ne gêne personne : zéro code la lit.
comment on column public.nursery_lots.public_token is
  'HÉRITÉE de 0052, gelée par 0090 : plus aucun défaut, plus aucune écriture. Les étiquettes de lots '
  'passent désormais par smart_tags.nursery_lot_id. Cette colonne n''est plus lue que par '
  'etiquette_resoudre(), EN SECOND et en repli, pour qu''un QR déjà imprimé continue de fonctionner. '
  'Ne pas la supprimer sans avoir vérifié qu''aucune étiquette physique ne porte encore son jeton.';


-- ============================================================
-- 5. LA GARDE CONTRE L'ÉNUMÉRATION — COMPTER, ET LE DIRE
-- ============================================================
--
-- SOYONS EXACTS SUR CE QUE CECI APPORTE, parce qu'une promesse de
-- sécurité approximative est pire que pas de promesse du tout.
--
-- Un jeton n'a pas de session : le résolveur ne sait pas QUI l'apporte.
-- Il ne peut donc pas limiter « par visiteur ». Ce qu'il peut, et ce
-- qu'il fait :
--   1. RENDRE LE TIRAGE COÛTEUX. 128 bits. Il n'existe pas de
--      « milliers de jetons » à essayer utilement.
--   2. COMPTER LES ÉCHECS PAR FENÊTRE, et poser un drapeau quand la
--      fenêtre déborde. Le compteur cesse alors de grossir : une table
--      de journal ne doit pas devenir le levier par lequel on remplit
--      le disque.
--   3. LE DIRE. etiquettes_sous_attaque() rend vrai, et c'est la route
--      web — qui, elle, VOIT l'adresse du visiteur — qui refuse,
--      ralentit ou présente une épreuve. La limitation par client
--      appartient au bord, pas à la base ; prétendre le contraire ici
--      donnerait une fausse assurance.
--
-- CE QU'ON NE FAIT SURTOUT PAS : refuser les jetons VALIDES pendant une
-- saturation. Un client qui scanne son arbre pendant qu'un curieux tape
-- au hasard doit voir sa plante.
--
-- LE SEUIL ET LA SANCTION SE RÈGLENT, ILS NE SE CODENT PAS EN DUR.
-- 0089 avait écrit « v_seuil constant integer := 200 » dans le corps
-- d'une fonction : pour le changer, il faut une migration. Ici c'est
-- une ligne de table, modifiable par un administrateur de plateforme.
create table if not exists public.etiquette_garde (
  -- Une seule ligne, et la contrainte le dit : une clé primaire
  -- booléenne qui ne peut valoir que « true ».
  id boolean primary key default true check (id),

  -- La largeur de la fenêtre de comptage, en secondes.
  -- 300 = cinq minutes, la valeur de 0089.
  fenetre_secondes integer not null default 300
    check (fenetre_secondes between 60 and 3600),

  -- Combien de jetons refusés dans une fenêtre valent une alerte.
  seuil_echecs integer not null default 200
    check (seuil_echecs between 10 and 1000000),

  -- Combien de temps une fenêtre saturée continue de faire dire
  -- « sous attaque » à la fonction que la route web interroge.
  alerte_minutes integer not null default 15
    check (alerte_minutes between 1 and 1440),

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.etiquette_garde (id) values (true) on conflict (id) do nothing;

alter table public.etiquette_garde enable row level security;

drop policy if exists "Les administrateurs lisent la garde des étiquettes" on public.etiquette_garde;
create policy "Les administrateurs lisent la garde des étiquettes" on public.etiquette_garde
  for select using (public.is_platform_admin());

comment on table public.etiquette_garde is
  'Les trois nombres de la garde anti-énumération : largeur de fenêtre, seuil d''alerte, durée de '
  'l''alerte. En table et non en constante de fonction, pour qu''un réglage ne demande pas une migration.';

-- LES TENTATIVES INFRUCTUEUSES. Une ligne par FENÊTRE, jamais une ligne
-- par tentative : c'est ce qui empêche la table de servir de levier de
-- saturation à celui-là même qu'elle surveille.
create table if not exists public.etiquette_tentatives (
  window_start timestamptz primary key,
  failures integer not null default 0 check (failures >= 0),
  saturated_at timestamptz
);

alter table public.etiquette_tentatives enable row level security;

drop policy if exists "Les administrateurs voient les tentatives d'étiquettes" on public.etiquette_tentatives;
create policy "Les administrateurs voient les tentatives d'étiquettes" on public.etiquette_tentatives
  for select using (public.is_platform_admin());

comment on table public.etiquette_tentatives is
  'Le comptage des jetons d''étiquette refusés, agrégé par fenêtre. Il ne dit pas QUI frappe — la base '
  'ne le sait pas — mais il dit QUE ça frappe, et c''est ce que la route /x attend pour refuser au bord.';

-- Le début de la fenêtre courante. Isolée pour que le résolveur et le
-- compteur tombent forcément d'accord sur la même arithmétique.
create or replace function public.etiquette_fenetre(p_instant timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_timestamp(
    floor(extract(epoch from p_instant) / g.fenetre_secondes) * g.fenetre_secondes
  )
  from public.etiquette_garde g where g.id;
$$;

create or replace function public.etiquette_note_echec(p_fenetre timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seuil integer;
begin
  select g.seuil_echecs into v_seuil from public.etiquette_garde g where g.id;
  if v_seuil is null or p_fenetre is null then
    return;
  end if;

  -- UNE FENÊTRE DÉJÀ DÉBORDÉE NE S'ÉCRIT PLUS DU TOUT. Le compteur
  -- s'arrêtait déjà au seuil, mais l'« insert … on conflict do update »
  -- prenait quand même un verrou de ligne et une écriture WAL à CHAQUE
  -- tentative : sous une énumération soutenue, toutes les tentatives se
  -- sérialisaient sur cette unique ligne, et c'est celui qui frappe qui
  -- décidait du débit de la base. Une lecture d'index sur la clé
  -- primaire coûte incomparablement moins, et le drapeau est déjà levé :
  -- il n'y a plus rien à apprendre de la tentative suivante.
  if exists (
    select 1 from public.etiquette_tentatives a
     where a.window_start = p_fenetre and a.saturated_at is not null
  ) then
    return;
  end if;

  insert into public.etiquette_tentatives (window_start, failures)
  values (p_fenetre, 1)
  on conflict (window_start) do update
    set failures = case
          -- LE COMPTEUR S'ARRÊTE AU SEUIL. Au-delà, le nombre exact
          -- n'apprend plus rien, et chaque incrément est une écriture
          -- offerte à celui qui frappe.
          when public.etiquette_tentatives.failures >= v_seuil
            then public.etiquette_tentatives.failures
          else public.etiquette_tentatives.failures + 1
        end,
        saturated_at = case
          when public.etiquette_tentatives.failures + 1 >= v_seuil
            then coalesce(public.etiquette_tentatives.saturated_at, now())
          else public.etiquette_tentatives.saturated_at
        end;
end $$;

create or replace function public.etiquettes_sous_attaque()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.etiquette_tentatives a, public.etiquette_garde g
     where g.id
       and a.saturated_at is not null
       and a.window_start > now() - make_interval(mins => g.alerte_minutes)
  );
$$;

comment on function public.etiquettes_sous_attaque() is
  'Vrai quand une fenêtre récente a débordé de jetons refusés. La route /x s''en sert pour refuser au '
  'BORD, là où l''adresse du visiteur est connue : la base, elle, ne sait pas qui frappe.';

create or replace function public.etiquette_garde_regler(
  p_fenetre_secondes integer default null,
  p_seuil_echecs integer default null,
  p_alerte_minutes integer default null
)
returns public.etiquette_garde
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ligne public.etiquette_garde;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : régler la garde des étiquettes est un geste d''administration.'
      using errcode = '42501';
  end if;

  update public.etiquette_garde
     set fenetre_secondes = coalesce(p_fenetre_secondes, fenetre_secondes),
         seuil_echecs = coalesce(p_seuil_echecs, seuil_echecs),
         alerte_minutes = coalesce(p_alerte_minutes, alerte_minutes),
         updated_at = now(),
         updated_by = auth.uid()
   where id
  returning * into v_ligne;

  return v_ligne;
end $$;


-- ============================================================
-- 5 bis. QUI DÉCIDE, QUAND LES DEUX AXES SE CROISENT
-- ============================================================
--
-- LA RÈGLE, ÉCRITE UNE FOIS ET APPELÉE PARTOUT : dès qu'une entreprise
-- est derrière l'élément, C'EST ELLE QUI JUGE. L'appartenance à
-- l'espace de travail ne vaut que là où aucune entreprise n'existe —
-- l'iPhone d'un particulier, un espace personnel.
--
-- POURQUOI CE N'EST PAS UN DÉTAIL. La forme précédente était
-- « is_workspace_member(ws) OU has_permission(org, …) ». La première
-- branche n'exige AUCUN rôle : rien qu'une ligne dans
-- workspace_members. Un compte ajouté à un espace de travail sans
-- l'être à l'entreprise obtenait donc tout — publier sur Internet la
-- plante d'un client, révoquer l'étiquette d'un jardin, poser une
-- étiquette sur le matériel — alors que le § 9 réserve
-- « etiquettes.manage » à 5 rôles sur 11. La porte de service annulait
-- la porte d'entrée.
--
-- CE QUE CELA NE CASSE PAS, MESURÉ EN PRODUCTION AVANT D'ÉCRIRE : les
-- cinq étiquettes existantes vivent dans un espace de travail SANS
-- entreprise (v_org reste nul) — elles passent donc toujours par la
-- porte « espace de travail », inchangée. Et il n'existe aujourd'hui
-- aucun membre d'espace de travail qui ne soit pas membre de
-- l'entreprise : personne ne perd un accès qu'il avait.
--
-- L'ARCHIVAGE D'UNE ENTREPRISE EST TRAITÉ ICI, ET NULLE PART AILLEURS.
-- has_permission() ne regarde que l'archivage du MEMBRE
-- (organization_members.archived_at), jamais celui de l'entreprise :
-- une entreprise archivée continuait donc de livrer ses éléments à ses
-- anciens membres. Le résolveur posait pourtant déjà
-- « o.archived_at is null » en traversant le pont espace → entreprise,
-- ce qui donnait l'illusion que le cas était traité. On tranche : une
-- entreprise archivée ne juge plus rien, et son matériel cesse de
-- résoudre. Le contrôle vit dans cette fonction-ci, pas dans
-- has_permission() — celle-là décide de TOUT le produit, et un lot
-- d'étiquettes n'est pas le bon endroit pour la changer.
create or replace function public.etiquette_droit(p_ws uuid, p_org uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when p_org is not null then
             exists (select 1 from public.business_organizations o
                      where o.id = p_org and o.archived_at is null)
             and public.has_permission(p_org, p_permission)
           when p_ws is not null then public.is_workspace_member(p_ws)
           else false
         end;
$$;

comment on function public.etiquette_droit(uuid, uuid, text) is
  'Le juge unique des étiquettes : l''entreprise si elle existe, sinon l''espace de travail. '
  'Écrit une fois pour que la porte de service ne réapparaisse pas au prochain ajout de fonction.';


-- ============================================================
-- 6. LE RÉSOLVEUR — SA CLAUSE « where » EST LA SEULE BARRIÈRE
-- ============================================================
--
-- C'EST LA PIÈCE DU CHANTIER. Elle est « security definer » et
-- accordée à « anon » : elle contourne donc TOUTE la RLS, et rien
-- d'autre que son propre corps ne protège les données. Chaque
-- condition est là pour une raison, aucune n'est décorative.
--
-- LE search_path EST FIGÉ. Une fonction « security definer » sans
-- chemin figé est le vecteur d'élévation de privilèges classique : il
-- suffit à un utilisateur de créer une table « plants » dans un schéma
-- qu'il contrôle et de la placer devant. Ce projet vient d'en corriger
-- deux ; on ne pose pas la troisième.
--
-- LE PORTEUR VIENT DE LA SESSION, JAMAIS D'UN PARAMÈTRE. La signature
-- ne prend QUE le jeton. is_workspace_member() et has_permission()
-- lisent auth.uid() elles-mêmes. Un résolveur qui accepterait « et je
-- suis untel » en argument serait une faille béante.
--
-- LES QUATRE QUESTIONS DU § 15, DANS L'ORDRE :
--   1. à quelle entité ce jeton correspond-il ?
--   2. qui est le porteur ?
--   3. qu'a-t-il le droit d'en voir ?
--   4. quel écran ouvrir ?
--
-- LES TROIS PORTEURS, ET LEURS TROIS RÉPONSES :
--
--   • CONNECTÉ ET HABILITÉ → la fiche, portée « complet ». Il voit le
--     type d'entité, son identifiant, un titre, et l'écran à ouvrir.
--
--   • CONNECTÉ SANS DROIT → EXACTEMENT LA MÊME RÉPONSE QU'UN JETON
--     INEXISTANT. Même booléen, même phrase, même absence de tout le
--     reste. Deux messages différents formeraient un oracle : en tapant
--     des jetons au hasard, on apprendrait lesquels sont vrais.
--
--     CE QUI EST ÉGALISÉ, ET CE QUI NE L'EST PAS — dit franchement,
--     parce qu'une phrase rassurante et fausse est pire que rien. La
--     RÉPONSE est indistinguable, octet pour octet, et c'est testé.
--     Le TEMPS ne l'est pas : un jeton inexistant fait deux lectures
--     d'index et sort ; un jeton valide qu'on n'a pas le droit de voir
--     lit en plus la table cible, traverse le pont
--     business_organizations, puis appelle has_permission(). Mesuré :
--     130 µs contre 241 µs, écart stable d'environ 110 µs. Ce qui
--     protège n'est donc PAS la constance du temps, c'est la taille du
--     jeton — 128 bits, soit 2^128 tirages avant d'en trouver un vrai,
--     et le comptage du § 5 pour que les tentatives se voient. Le
--     comptage d'échecs sert à la TRACE, pas à l'égalisation. Fermer
--     vraiment le canal demanderait un travail constant sur toutes les
--     branches, ce qui coûte plus qu'il ne rapporte face à 2^128.
--
--   • VISITEUR NON CONNECTÉ → rien, sauf si le propriétaire a publié
--     l'étiquette (public_fiche). C'est le cas le plus fréquent en
--     vrai : quelqu'un scanne une étiquette dans un jardin. Ce qu'il
--     voit alors est une FICHE BOTANIQUE et rien d'autre — nom commun,
--     nom scientifique, type. Ni nom d'usage (« le palmier de
--     Mamie » est une donnée personnelle), ni coordonnées GPS (elles
--     situent le jardin d'un client), ni état sanitaire, ni notes.
--     ET SEULEMENT POUR UNE PLANTE : un lot de pépinière porte un
--     fournisseur et une quantité, un matériel porte un numéro de
--     série, un lot BioLab porte un savoir-faire. Aucun des trois n'a
--     à parler à un passant, même publié.
--
-- CE QU'IL NE FAIT JAMAIS, quel que soit le porteur : révéler
-- l'existence d'une entité à qui n'y a pas droit, créer une session,
-- ou rendre une donnée interne. LA RÈGLE DES DÉTAILS EST ÉCRITE ET
-- TESTÉE : identité seulement. Un nom, un code, une espèce, un stade,
-- un statut. JAMAIS un montant, jamais un coût d'achat, jamais un
-- fournisseur, jamais une note libre, jamais une adresse, jamais une
-- coordonnée GPS, jamais l'identité d'un autre client.
create or replace function public.etiquette_resoudre(p_token text)
returns table (
  ok boolean,
  message text,
  portee text,        -- 'complet' | 'publique'
  entite_type text,
  entite_id uuid,
  ecran text,         -- la clé stable, commune à l'iPhone et au web
  chemin text,        -- le chemin web, NULL quand aucun écran n'existe
  titre text,
  details jsonb
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_tag record;
  v_kind text;
  v_id uuid;
  v_ws uuid;
  v_org uuid;
  v_garden uuid;
  v_parent uuid;
  v_titre text;
  v_titre_public text;
  v_details jsonb;
  v_publique jsonb;
  v_perm text := 'etiquettes.read';
  v_ecran text;
  v_chemin text;
  v_fiche_publique boolean := false;
  v_tag_id uuid;
  v_droit boolean;
  v_fenetre timestamptz;

  -- LA MÊME PHRASE DANS TOUS LES CAS DE REFUS. Elle ne dit ni que le
  -- jeton a existé, ni qu'il a été révoqué, ni qu'il ne vous est pas
  -- accessible. Elle dit quoi faire, et c'est tout ce qu'un paysagiste
  -- attend d'elle.
  v_refus constant text :=
    'Cette étiquette ne mène à rien. Si elle vient de votre entreprise, connectez-vous puis scannez-la de nouveau.';
begin
  v_token := lower(btrim(coalesce(p_token, '')));
  v_fenetre := public.etiquette_fenetre(now());

  -- ---- LA FORME D'ABORD ----------------------------------------
  -- Les deux registres tirent 128 bits et les écrivent en 32
  -- caractères hexadécimaux minuscules. Ce qui n'a pas cette forme n'a
  -- jamais existé, et ne mérite pas une lecture d'index.
  if v_token !~ '^[0-9a-f]{32}$' then
    perform public.etiquette_note_echec(v_fenetre);
    return query select false, v_refus, null::text, null::text, null::uuid,
                        null::text, null::text, null::text, null::jsonb;
    return;
  end if;

  -- ---- 1. À QUELLE ENTITÉ CE JETON CORRESPOND-IL ? -------------
  -- L'ORDRE DE RECHERCHE EST ÉCRIT ICI, ET IL EST TESTÉ : smart_tags
  -- D'ABORD, nursery_lots.public_token EN REPLI. Voir le § 4 : deux
  -- registres de même forme cohabitent, l'un vivant, l'autre gelé.
  select t.id, t.entity_kind, t.entity_id, t.public_fiche, t.rack_label,
         t.workspace_id, t.organization_id
    into v_tag
    from public.smart_tags t
   where t.public_token = v_token
     and t.active;

  if v_tag.id is not null then
    v_tag_id := v_tag.id;
    v_kind := v_tag.entity_kind;
    v_id := v_tag.entity_id;
    v_fiche_publique := v_tag.public_fiche;
    -- ATTENTION : on NE recopie PAS ici la portée de l'étiquette.
    -- Chaque branche du § 2 la relit à la source, et si la cible a
    -- disparu la portée doit rester NULLE — sans quoi le contrôle
    -- « la cible a disparu » plus bas verrait la portée de
    -- l'étiquette survivante et laisserait passer. Les deux seules
    -- branches qui n'ont pas de cible à relire (rack, vierge)
    -- reprennent explicitement celle de l'étiquette.
  else
    -- LE REPLI NE DOIT JAMAIS RESSUSCITER UNE ÉTIQUETTE RÉVOQUÉE.
    --
    -- Le § 4.a recopie `nursery_lots.public_token` TEL QUEL dans une
    -- ligne `smart_tags`. Les deux registres portent donc le même
    -- jeton pour le même lot. Sans le `not exists` ci-dessous, la
    -- révocation était SANS EFFET : `etiquette_desactiver()` posait
    -- `active = false`, la recherche du haut ne trouvait plus rien, et
    -- le code tombait ici — sur une colonne qui n'a ni `active`, ni
    -- fonction de révocation, ni aucun moyen d'être fermée. Le
    -- producteur qui arrache un autocollant le croyait mort ; il
    -- ouvrait encore son lot, avec son code, son espèce et son stock.
    -- Le renouvellement avait le même trou : le nouveau jeton
    -- fonctionnait, et l'ANCIEN aussi.
    --
    -- LA RÈGLE, ÉCRITE UNE FOIS POUR TOUTES : dès qu'une ligne
    -- smart_tags porte ce jeton, c'est SON `active` qui décide, point
    -- final. Le repli ne sert plus qu'aux jetons que le § 4.a n'a pas
    -- pu absorber — lot archivé au moment de la migration, entreprise
    -- sans espace de travail.
    select l.id into v_id
      from public.nursery_lots l
     where l.public_token = v_token
       and l.archived_at is null
       and not exists (select 1
                         from public.smart_tags t2
                        where t2.public_token = v_token);

    if v_id is null then
      perform public.etiquette_note_echec(v_fenetre);
      return query select false, v_refus, null::text, null::text, null::uuid,
                          null::text, null::text, null::text, null::jsonb;
      return;
    end if;
    v_kind := 'nurseryLot';
  end if;

  -- ---- 2. LA PORTÉE, REDÉDUITE DE LA CIBLE ---------------------
  -- ON NE FAIT PAS CONFIANCE aux colonnes de l'étiquette. Le
  -- déclencheur du § 2 les a écrites, mais cette fonction contourne
  -- toute la RLS : elle relit la portée à la source, et n'accorde le
  -- droit que d'après ce qu'elle a relu.
  --
  -- CHAQUE BRANCHE FILTRE LES SUPPRESSIONS DOUCES. Une plante effacée,
  -- un lot archivé : l'étiquette ne mène plus à rien, et c'est le même
  -- refus que pour un jeton inventé.
  if v_kind = 'plant' then
    select p.workspace_id, p.garden_id,
           coalesce(nullif(btrim(p.custom_name), ''), nullif(btrim(p.common_name), ''),
                    nullif(btrim(p.scientific_name), ''), 'Plante'),
           coalesce(nullif(btrim(p.common_name), ''), nullif(btrim(p.scientific_name), ''), 'Plante'),
           jsonb_build_object('custom_name', p.custom_name, 'common_name', p.common_name,
                              'scientific_name', p.scientific_name, 'type', p.type,
                              'health_status', p.health_status),
           jsonb_build_object('common_name', p.common_name, 'scientific_name', p.scientific_name,
                              'type', p.type)
      into v_ws, v_garden, v_titre, v_titre_public, v_details, v_publique
      from public.plants p
     where p.id = v_id and p.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'plante';
    v_chemin := case when v_garden is not null
                     then '/digital-twin/' || v_garden::text || '?plante=' || v_id::text end;

  elsif v_kind = 'garden' then
    select g.workspace_id, g.id, coalesce(nullif(btrim(g.name), ''), 'Jardin'),
           jsonb_build_object('name', g.name)
      into v_ws, v_garden, v_titre, v_details
      from public.gardens g
     where g.id = v_id and g.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin';
    v_chemin := '/digital-twin/' || v_id::text;

  elsif v_kind = 'gardenZone' then
    select g.workspace_id, g.id, coalesce(nullif(btrim(z.name), ''), 'Zone'),
           jsonb_build_object('name', z.name)
      into v_ws, v_garden, v_titre, v_details
      from public.garden_zones z
      join public.gardens g on g.id = z.garden_id
     where z.id = v_id and z.deleted_at is null and g.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin.zone';
    v_chemin := case when v_garden is not null then '/digital-twin/' || v_garden::text end;

  elsif v_kind = 'gardenArea' then
    select a.workspace_id, a.garden_id, coalesce(nullif(btrim(a.name), ''), 'Massif'),
           jsonb_build_object('name', a.name, 'area_type', a.area_type)
      into v_ws, v_garden, v_titre, v_details
      from public.garden_areas a
     where a.id = v_id and a.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin.massif';
    v_chemin := case when v_garden is not null then '/digital-twin/' || v_garden::text end;

  elsif v_kind = 'irrigationZone' then
    select i.workspace_id, i.garden_id, coalesce(nullif(btrim(i.name), ''), 'Zone d''arrosage'),
           jsonb_build_object('name', i.name, 'type', i.type, 'active', i.active)
      into v_ws, v_garden, v_titre, v_details
      from public.irrigation_zones i
     where i.id = v_id and i.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin.arrosage';
    v_chemin := case when v_garden is not null then '/digital-twin/' || v_garden::text end;

  elsif v_kind = 'pond' then
    select p.workspace_id, p.garden_id, coalesce(nullif(btrim(p.name), ''), 'Bassin'),
           jsonb_build_object('name', p.name)
      into v_ws, v_garden, v_titre, v_details
      from public.ponds p
     where p.id = v_id and p.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin.bassin';
    v_chemin := case when v_garden is not null then '/digital-twin/' || v_garden::text end;

  elsif v_kind = 'sensor' then
    select s.workspace_id, s.garden_id, coalesce(nullif(btrim(s.name), ''), 'Capteur'),
           jsonb_build_object('name', s.name, 'type', s.type, 'unit', s.unit)
      into v_ws, v_garden, v_titre, v_details
      from public.sensors s
     where s.id = v_id and s.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin.capteur';
    v_chemin := case when v_garden is not null then '/digital-twin/' || v_garden::text end;

  elsif v_kind = 'connectedDevice' then
    select d.workspace_id, d.garden_id, coalesce(nullif(btrim(d.name), ''), 'Équipement'),
           jsonb_build_object('name', d.name, 'category', d.category, 'online', d.online)
      into v_ws, v_garden, v_titre, v_details
      from public.connected_devices d
     where d.id = v_id and d.deleted_at is null;
    v_perm := 'projects.read';
    v_ecran := 'jardin.equipement';
    v_chemin := case when v_garden is not null then '/digital-twin/' || v_garden::text end;

  elsif v_kind = 'equipment' then
    -- LE MATÉRIEL PORTE acquisition_cost_cents ET supplier_id.
    -- NI L'UN NI L'AUTRE NE SORT D'ICI. Le prix d'achat d'une
    -- mini-pelle n'a rien à faire dans la réponse à un scan.
    select e.organization_id, coalesce(nullif(btrim(e.name), ''), 'Matériel'),
           jsonb_build_object('name', e.name, 'category', e.category,
                              'internal_number', e.internal_number, 'status', e.status)
      into v_org, v_titre, v_details
      from public.equipment e
     where e.id = v_id and e.archived_at is null;
    v_perm := 'projects.read';
    v_ecran := 'materiel';
    v_chemin := '/materiel/' || v_id::text;

  elsif v_kind = 'nurseryLot' then
    -- MÊME RÈGLE : ni supplier_id, ni supplier_lot_reference, ni notes.
    -- Le fournisseur d'un lot est le secret commercial du producteur.
    select l.organization_id, coalesce(nullif(btrim(l.lot_code), ''), 'Lot'),
           jsonb_build_object('lot_code', l.lot_code, 'species_name', l.species_name,
                              'cultivar', l.cultivar, 'status', l.status,
                              'current_quantity', l.current_quantity)
      into v_org, v_titre, v_details
      from public.nursery_lots l
     where l.id = v_id and l.archived_at is null;
    v_perm := 'nursery.stock.manage';
    v_ecran := 'pepiniere.lot';
    v_chemin := '/pepiniere/lots/' || v_id::text;

  elsif v_kind = 'nurseryLocation' then
    select o.organization_id, coalesce(nullif(btrim(o.name), ''), nullif(btrim(o.code), ''), 'Emplacement'),
           jsonb_build_object('code', o.code, 'name', o.name, 'kind', o.kind)
      into v_org, v_titre, v_details
      from public.nursery_locations o
     where o.id = v_id and o.archived_at is null;
    v_perm := 'nursery.stock.manage';
    v_ecran := 'pepiniere.emplacement';
    v_chemin := '/pepiniere/emplacements';

  elsif v_kind = 'cultureBatch' then
    select c.workspace_id, coalesce(nullif(btrim(c.batch_code), ''), 'Lot de culture'),
           jsonb_build_object('batch_code', c.batch_code, 'species_name', c.species_name,
                              'cultivar', c.cultivar, 'culture_stage', c.culture_stage,
                              'status', c.status, 'current_count', c.current_count)
      into v_ws, v_titre, v_details
      from public.culture_batches c
     where c.id = v_id;
    v_perm := 'biolab.read';
    v_ecran := 'biolab.lot';
    v_chemin := '/biolab/lots/' || v_id::text;

  elsif v_kind = 'bioreactor' then
    select b.workspace_id, coalesce(nullif(btrim(b.name), ''), nullif(btrim(b.code), ''), 'Incubateur'),
           jsonb_build_object('name', b.name, 'code', b.code, 'status', b.status)
      into v_ws, v_titre, v_details
      from public.bioreactors b
     where b.id = v_id;
    v_perm := 'biolab.read';
    v_ecran := 'biolab.equipement';
    v_chemin := '/biolab/equipements/' || v_id::text;

  elsif v_kind = 'mediumRecipeVersion' then
    select v.workspace_id, v.recipe_id,
           'Recette V' || v.version_number::text,
           jsonb_build_object('version_number', v.version_number, 'recipe_id', v.recipe_id)
      into v_ws, v_parent, v_titre, v_details
      from public.medium_recipe_versions v
     where v.id = v_id;
    v_perm := 'biolab.read';
    v_ecran := 'biolab.recette';
    v_chemin := case when v_parent is not null then '/biolab/recettes/' || v_parent::text end;

  elsif v_kind = 'acclimatizationBatch' then
    select a.workspace_id, 'Acclimatation',
           jsonb_build_object('status', a.status, 'started_at', a.started_at)
      into v_ws, v_titre, v_details
      from public.acclimatization_batches a
     where a.id = v_id;
    v_perm := 'biolab.read';
    v_ecran := 'biolab.acclimatation';
    v_chemin := '/biolab/acclimatation';

  elsif v_kind = 'rack' then
    -- LE RACK N'A AUCUNE LIGNE DERRIÈRE LUI, et ce n'est pas un
    -- oubli : aucune table de rack n'existe dans cette base. Son
    -- libellé est porté par l'étiquette elle-même, et sa portée est
    -- celle de l'étiquette — les deux seuls cas du fichier où l'on
    -- lit la colonne plutôt que la cible, parce qu'il n'y a pas de
    -- cible à lire.
    v_ws := v_tag.workspace_id;
    v_org := v_tag.organization_id;
    v_titre := coalesce(nullif(btrim(v_tag.rack_label), ''), 'Rack');
    v_details := jsonb_build_object('rack_label', v_tag.rack_label);
    v_perm := 'biolab.read';
    v_ecran := 'biolab.rack';
    v_chemin := '/biolab/lieux';

  elsif v_kind is null and v_tag_id is not null then
    -- ÉTIQUETTE VIERGE : imprimée ou programmée, pas encore associée
    -- (§ 19 : « approcher un tag vierge, écrire l'identifiant
    -- sécurisé, confirmer l'association »). Elle appartient à qui l'a
    -- commandée, et l'écran à ouvrir est celui de l'association.
    v_ws := v_tag.workspace_id;
    v_org := v_tag.organization_id;
    v_titre := 'Étiquette vierge';
    v_details := '{}'::jsonb;
    v_perm := 'etiquettes.manage';
    v_ecran := 'etiquette.vierge';
    v_chemin := null;

  else
    -- Un entity_kind inconnu de cette fonction. Cela ne peut arriver
    -- qu'entre une migration qui ajoute une famille et le déploiement
    -- de cette fonction. Le silence est alors la bonne réponse.
    v_ws := null;
    v_org := null;
  end if;

  -- LA CIBLE A DISPARU (supprimée, archivée) : même refus que pour un
  -- jeton inventé. Une étiquette qui survit à son objet ne doit pas
  -- apprendre au monde que l'objet a existé.
  if v_ws is null and v_org is null then
    perform public.etiquette_note_echec(v_fenetre);
    return query select false, v_refus, null::text, null::text, null::uuid,
                        null::text, null::text, null::text, null::jsonb;
    return;
  end if;

  -- LE PONT ENTRE LES DEUX AXES, comme au § 2 : une cible d'un côté
  -- doit pouvoir être atteinte par un droit de l'autre.
  if v_org is null and v_ws is not null then
    select o.id into v_org from public.business_organizations o
     where o.workspace_id = v_ws and o.archived_at is null
     order by o.created_at limit 1;
  elsif v_ws is null and v_org is not null then
    -- SYMÉTRIQUE DU PONT D'AU-DESSUS : lui filtrait déjà les
    -- entreprises archivées, celui-ci ne le faisait pas. Une
    -- asymétrie non commentée finit toujours par être lue comme
    -- une intention.
    select o.workspace_id into v_ws from public.business_organizations o
     where o.id = v_org and o.archived_at is null;
  end if;

  -- ---- 3. QU'A-T-IL LE DROIT D'EN VOIR ? -----------------------
  -- UN SEUL JUGE, celui du § 5 bis : l'entreprise si la cible en a
  -- une, l'espace de travail sinon. La permission exigée dépend de la
  -- famille (v_perm), posée par la branche du § 2.
  -- has_permission() et is_workspace_member() lisent auth.uid()
  -- elles-mêmes : pour un visiteur anonyme, auth.uid() vaut NULL et
  -- les deux rendent faux, sans qu'il faille l'écrire nulle part.
  v_droit := public.etiquette_droit(v_ws, v_org, v_perm);

  if v_droit then
    -- La trace du scan, avant de rendre quoi que ce soit. Sur les cinq
    -- étiquettes de production, last_scanned_at vaut NULL : personne ne
    -- l'écrivait, puisqu'il n'y avait pas de serveur pour le faire.
    if v_tag_id is not null then
      update public.smart_tags
         set last_scanned_at = now(), scanned_count = scanned_count + 1
       where id = v_tag_id;
    end if;

    return query select true, null::text, 'complet'::text, v_kind, v_id,
                        v_ecran, v_chemin, v_titre, coalesce(v_details, '{}'::jsonb);
    return;
  end if;

  -- ---- LA FICHE PUBLIQUE, S'IL Y EN A UNE ----------------------
  -- Elle est servie à TOUT LE MONDE, connecté ou non : elle est
  -- publique, c'est sa définition. La refuser à un compte connecté
  -- serait absurde — il lui suffirait de se déconnecter.
  if v_fiche_publique and v_publique is not null then
    if v_tag_id is not null then
      update public.smart_tags
         set last_scanned_at = now(), scanned_count = scanned_count + 1
       where id = v_tag_id;
    end if;

    return query select true, null::text, 'publique'::text, v_kind, null::uuid,
                        'fiche.publique'::text, null::text, v_titre_public, v_publique;
    return;
  end if;

  -- ---- LE REFUS, IDENTIQUE À CELUI D'UN JETON INEXISTANT -------
  -- Même booléen, même phrase, même comptage. Ce qui est identique,
  -- c'est la RÉPONSE ; le temps de réponse, lui, ne l'est pas et ne
  -- prétend pas l'être (voir l'en-tête du § 6). Ce qui protège, c'est
  -- la taille du jeton.
  perform public.etiquette_note_echec(v_fenetre);
  return query select false, v_refus, null::text, null::text, null::uuid,
                      null::text, null::text, null::text, null::jsonb;
end $$;

comment on function public.etiquette_resoudre(text) is
  'Le résolveur du § 15 : un jeton entre, une entité, un droit et un écran sortent. Le porteur vient '
  'de la SESSION, jamais d''un paramètre. Il refuse avec la MÊME phrase pour un jeton inexistant et '
  'pour un jeton valide qu''on n''a pas le droit de voir — deux phrases différentes formeraient un '
  'oracle. Il ne rend AUCUNE donnée interne : ni prix, ni coût, ni fournisseur, ni note, ni adresse, '
  'ni coordonnée GPS.';


-- ============================================================
-- 7. FABRIQUER, PUBLIER, RÉVOQUER — TOUJOURS PAR UNE FONCTION
-- ============================================================
--
-- LE WEB N'A JAMAIS CRÉÉ UNE SEULE ÉTIQUETTE : le jeton venait
-- exclusivement de l'iPhone. Le § 16 demande l'inverse — « générer un
-- QR, plusieurs QR, les QR d'un lot, d'un jardin, d'une zone, d'un
-- rack, d'une sélection ». Voici les trois gestes, et rien de plus.
--
-- RIEN N'EST ÉCRIT PAR UN CLIENT SANS PASSER PAR ICI, pour le monde
-- professionnel : la politique RLS du § 3 est en LECTURE seule. C'est
-- dans ces fonctions que le droit est vérifié, et nulle part ailleurs.

create or replace function public.etiquette_creer(
  p_entite_type text,
  p_entite_id uuid,
  p_type text default 'qr',
  p_public_fiche boolean default false,
  -- RENOUVELER, C'EST RÉIMPRIMER. Par défaut on rend l'étiquette qui
  -- existe déjà : « générer le QR de ce lot » deux fois doit donner
  -- DEUX FOIS LE MÊME QR, sinon la planche imprimée hier ne vaut plus
  -- rien. On ne bat un jeton neuf que si on le demande explicitement —
  -- par exemple parce que l'autocollant a été arraché.
  p_renouveler boolean default false
)
returns table (id uuid, public_token text, deja_existante boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_kind text;
  v_ws uuid;
  v_org uuid;
  v_existante record;
  v_id uuid;
  v_token text;
begin
  v_type := lower(btrim(coalesce(p_type, 'qr')));
  if v_type not in ('qr', 'nfc') then
    raise exception 'Type d''étiquette inconnu : attendu « qr » ou « nfc ».' using errcode = '22023';
  end if;

  v_kind := btrim(coalesce(p_entite_type, ''));
  if v_kind not in ('plant', 'bioreactor', 'cultureBatch', 'mediumRecipeVersion',
                    'acclimatizationBatch', 'garden', 'gardenZone', 'gardenArea',
                    'irrigationZone', 'pond', 'sensor', 'connectedDevice',
                    'equipment', 'nurseryLot', 'nurseryLocation') then
    raise exception 'Cette famille d''élément ne peut pas porter d''étiquette : %.', v_kind
      using errcode = '22023';
  end if;

  select c.ws, c.org into v_ws, v_org
    from public.etiquette_portee_cible(v_kind, p_entite_id) c;

  if v_ws is null and v_org is null then
    raise exception 'Cet élément n''existe pas.' using errcode = '23503';
  end if;

  -- Le pont, comme au § 2 : une cible d'un côté, un droit de l'autre.
  if v_org is null then
    select o.id into v_org from public.business_organizations o
     where o.workspace_id = v_ws and o.archived_at is null
     order by o.created_at limit 1;
  elsif v_ws is null then
    -- SYMÉTRIQUE DU PONT D'AU-DESSUS : lui filtrait déjà les
    -- entreprises archivées, celui-ci ne le faisait pas. Une
    -- asymétrie non commentée finit toujours par être lue comme
    -- une intention.
    select o.workspace_id into v_ws from public.business_organizations o
     where o.id = v_org and o.archived_at is null;
  end if;

  -- POSER UNE ÉTIQUETTE, C'EST UN GESTE D'ORGANISATION, pas de simple
  -- lecture : elle coûte un autocollant, elle engage un rouleau, et
  -- elle ouvre une porte publique si on la publie. Le juge est celui
  -- du § 5 bis — l'entreprise d'abord, l'espace de travail à défaut.
  if not public.etiquette_droit(v_ws, v_org, 'etiquettes.manage') then
    raise exception 'Accès refusé : poser une étiquette sur cet élément demande le droit de gérer les étiquettes.'
      using errcode = '42501';
  end if;

  select t.id, t.public_token into v_existante
    from public.smart_tags t
   where t.active and t.type = v_type
     and t.entity_kind = v_kind and t.entity_id = p_entite_id
   order by t.created_at
   limit 1;

  if v_existante.id is not null and not coalesce(p_renouveler, false) then
    return query select v_existante.id, v_existante.public_token, true;
    return;
  end if;

  if coalesce(p_renouveler, false) then
    -- L'ANCIENNE EST RÉVOQUÉE, PAS SUPPRIMÉE. Son compteur de scans et
    -- sa date de dernier scan ont de la valeur, et un autocollant
    -- oublié dans un coin doit refuser proprement plutôt que de
    -- ressusciter le jour où le hasard recrée son jeton.
    update public.smart_tags
       set active = false
     where active and type = v_type
       and entity_kind = v_kind and entity_id = p_entite_id;
  end if;

  -- workspace_id est laissé NULL : le déclencheur du § 2 le remplit
  -- AVANT que la contrainte NOT NULL ne soit vérifiée, et il est la
  -- seule autorité sur la portée d'une étiquette.
  insert into public.smart_tags (
    workspace_id, type, public_fiche,
    plant_id, bioreactor_id, culture_batch_id, medium_recipe_version_id,
    acclimatization_batch_id, garden_id, garden_zone_id, garden_area_id,
    irrigation_zone_id, pond_id, sensor_id, connected_device_id,
    equipment_id, nursery_lot_id, nursery_location_id
  ) values (
    null, v_type, coalesce(p_public_fiche, false),
    case when v_kind = 'plant' then p_entite_id end,
    case when v_kind = 'bioreactor' then p_entite_id end,
    case when v_kind = 'cultureBatch' then p_entite_id end,
    case when v_kind = 'mediumRecipeVersion' then p_entite_id end,
    case when v_kind = 'acclimatizationBatch' then p_entite_id end,
    case when v_kind = 'garden' then p_entite_id end,
    case when v_kind = 'gardenZone' then p_entite_id end,
    case when v_kind = 'gardenArea' then p_entite_id end,
    case when v_kind = 'irrigationZone' then p_entite_id end,
    case when v_kind = 'pond' then p_entite_id end,
    case when v_kind = 'sensor' then p_entite_id end,
    case when v_kind = 'connectedDevice' then p_entite_id end,
    case when v_kind = 'equipment' then p_entite_id end,
    case when v_kind = 'nurseryLot' then p_entite_id end,
    case when v_kind = 'nurseryLocation' then p_entite_id end
  )
  returning smart_tags.id, smart_tags.public_token into v_id, v_token;

  return query select v_id, v_token, false;
end $$;

comment on function public.etiquette_creer(text, uuid, text, boolean, boolean) is
  'Pose une étiquette sur un élément, ou rend celle qui existe déjà. Générer deux fois le QR d''un lot '
  'donne DEUX FOIS LE MÊME QR : sinon la planche imprimée hier ne vaudrait plus rien. Le jeton est tiré '
  'par la base (16 octets de gen_random_bytes), jamais dérivé de l''identifiant de l''élément.';

-- LE LOT — « générer les QR d'un lot, d'un jardin, d'une zone, d'un
-- rack, d'une sélection, de plusieurs plantes » (§ 16). Une boucle sur
-- la fonction du dessus, pour que le contrôle de droit soit fait UNE
-- SEULE FOIS quelque part, et refait pour chaque élément.
create or replace function public.etiquettes_creer_lot(
  p_entite_type text,
  p_entite_ids uuid[],
  p_type text default 'qr',
  p_public_fiche boolean default false
)
returns table (entite_id uuid, id uuid, public_token text, deja_existante boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cible uuid;
  v_ligne record;
begin
  if p_entite_ids is null or array_length(p_entite_ids, 1) is null then
    return;
  end if;
  -- Un garde-fou sur la taille : une planche A4 tient une centaine
  -- d'étiquettes, et une demande de dix mille est une erreur de
  -- manipulation, pas un besoin.
  if array_length(p_entite_ids, 1) > 500 then
    raise exception 'Trop d''éléments d''un coup : % demandés, 500 au maximum.', array_length(p_entite_ids, 1)
      using errcode = '22023';
  end if;

  foreach v_cible in array p_entite_ids loop
    for v_ligne in
      select * from public.etiquette_creer(p_entite_type, v_cible, p_type, p_public_fiche, false)
    loop
      return query select v_cible, v_ligne.id, v_ligne.public_token, v_ligne.deja_existante;
    end loop;
  end loop;
end $$;

-- PUBLIER OU DÉPUBLIER — le geste qui décide si un passant voit
-- quelque chose. Il est séparé de la création parce que c'en est un
-- autre : on imprime souvent, on publie rarement.
create or replace function public.etiquette_publier(p_id uuid, p_publique boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tag record;
begin
  select t.id, t.workspace_id, t.organization_id into v_tag
    from public.smart_tags t where t.id = p_id;
  if v_tag.id is null then
    raise exception 'Étiquette introuvable.' using errcode = '23503';
  end if;

  if not public.etiquette_droit(v_tag.workspace_id, v_tag.organization_id, 'etiquettes.manage') then
    raise exception 'Accès refusé : publier une étiquette demande le droit de gérer les étiquettes.'
      using errcode = '42501';
  end if;

  update public.smart_tags set public_fiche = coalesce(p_publique, false) where id = p_id;
  return coalesce(p_publique, false);
end $$;

-- RÉVOQUER — l'autocollant est arraché, perdu, ou collé sur le mauvais
-- pot. On ne SUPPRIME pas : un jeton révoqué doit continuer de refuser
-- proprement, et son historique de scans reste lisible.
create or replace function public.etiquette_desactiver(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tag record;
begin
  select t.id, t.workspace_id, t.organization_id into v_tag
    from public.smart_tags t where t.id = p_id;
  if v_tag.id is null then
    raise exception 'Étiquette introuvable.' using errcode = '23503';
  end if;

  if not public.etiquette_droit(v_tag.workspace_id, v_tag.organization_id, 'etiquettes.manage') then
    raise exception 'Accès refusé : révoquer une étiquette demande le droit de gérer les étiquettes.'
      using errcode = '42501';
  end if;

  update public.smart_tags set active = false where id = p_id;
  return true;
end $$;


-- ============================================================
-- 8. LES MODÈLES D'ÉTIQUETTE (§ 18) — POUR QUE L'ÉDITEUR NE SOIT
--    JAMAIS VIDE
-- ============================================================
--
-- « Le Web Pro doit permettre de configurer une étiquette avec : logo,
-- nom, nom scientifique, cultivar, numéro de lot, date, quantité,
-- emplacement, stade, QR, code-barres éventuellement, texte libre.
-- BioLab, Nursery et Jardins doivent pouvoir avoir leurs propres
-- modèles. »
--
-- TROIS MODÈLES OASIS SONT SEMÉS, organization_id À NULL. C'est le
-- choix qui évite un déclencheur sur business_organizations : plutôt
-- que de recopier trois lignes dans chaque entreprise créée — et de
-- devoir y penser pour chaque entreprise future —, les modèles fournis
-- sont GLOBAUX et lisibles par tous. Une entreprise qui veut le sien
-- en crée un ; elle ne part jamais d'un écran vide, et personne n'a à
-- se souvenir de semer quoi que ce soit.
--
-- LES MILLIMÈTRES SONT DES MILLIMÈTRES, ET LE TYPE LE DIT.
-- `numeric(7,2)`, pas `real` ni `double precision` : un flottant
-- binaire ne représente pas 25,4 exactement, et une planche dont les
-- cotes dérivent de deux pour cent est physiquement inutilisable —
-- l'étiquette ne colle plus sur son support. C'est la même discipline
-- que l'argent en centimes entiers, pour la même raison.

create or replace function public.etiquette_champs_valides(p_champs jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_champs) = 'array'
     and jsonb_array_length(p_champs) <= 40
     and not exists (
       select 1
         from jsonb_array_elements(p_champs) e
        where jsonb_typeof(e) <> 'object'
           -- LE VOCABULAIRE DU § 18, FERMÉ. Un champ inconnu serait un
           -- champ que le moteur d'impression ne saurait pas rendre :
           -- autant le refuser à l'écriture plutôt qu'à l'impression,
           -- devant l'imprimante et le rouleau déjà engagé.
           or coalesce(e->>'champ', '') not in (
                'logo', 'nom', 'nomScientifique', 'cultivar', 'numeroLot', 'date',
                'quantite', 'emplacement', 'stade', 'qr', 'codeBarres', 'texteLibre')
           -- Les quatre cotes sont des NOMBRES, en millimètres, et
           -- positives. Une chaîne « 12mm » passerait un test naïf et
           -- ferait sortir une planche fausse.
           or jsonb_typeof(e->'x') <> 'number'
           or jsonb_typeof(e->'y') <> 'number'
           or jsonb_typeof(e->'largeur') <> 'number'
           or jsonb_typeof(e->'hauteur') <> 'number'
           or (e->>'x')::numeric < 0
           or (e->>'y')::numeric < 0
           or (e->>'largeur')::numeric <= 0
           or (e->>'hauteur')::numeric <= 0
           -- LA TAILLE DU TEXTE DOIT TENIR EN HAUTEUR DANS SON CADRE,
           -- et rien ne le vérifiait. Un corps de 24 pt dans un cadre
           -- de 4 mm sortait des glyphes de 0,96 à 8,83 mm : ils
           -- mordaient la marge et entraient de près de 3 mm dans le
           -- champ voisin, sans un mot d'avertissement.
           --
           -- LE FACTEUR 2,485 EST MESURÉ, pas choisi : un point vaut
           -- 25,4/72 mm, la hauteur d'encre d'une ligne (capitale plus
           -- jambages, avec la même sécurité que le moteur de rendu)
           -- vaut environ 0,952 fois le corps. 1 mm de cadre tient
           -- donc au plus 2,485 pt de corps.
           or (e ? 'taille' and jsonb_typeof(e->'taille') <> 'number')
           or (e ? 'taille' and (e->>'taille')::numeric <= 0)
           or (e ? 'taille'
               and (e->>'taille')::numeric > 2.485 * (e->>'hauteur')::numeric)
     );
$$;

comment on function public.etiquette_champs_valides(jsonb) is
  'Le vocabulaire du § 18 et rien d''autre, avec quatre cotes numériques en millimètres. Refuser un '
  'champ inconnu à l''écriture vaut mieux que le découvrir devant l''imprimante, rouleau engagé.';

create table if not exists public.etiquette_modeles (
  id uuid primary key default gen_random_uuid(),

  -- NULL = modèle fourni par Oasis : lisible par tous, modifiable par
  -- personne. Les fonctions d'écriture refusent explicitement le NULL.
  organization_id uuid references public.business_organizations (id) on delete cascade,

  -- Les trois mondes du § 18. Un modèle sert une famille d'objets :
  -- une étiquette de lot BioLab et une étiquette de plante de jardin
  -- n'ont ni la même taille, ni les mêmes champs.
  famille text not null check (famille in ('jardins', 'pepiniere', 'biolab')),

  nom text not null check (btrim(nom) <> ''),

  -- LES CINQ FORMATS DU § 17 — 25×15, 40×20, 50×30, 60×40, 100×50 —
  -- ne sont pas une énumération ici : le § 17 demande aussi des
  -- « formats personnalisés ». On borne, on n'énumère pas.
  largeur_mm numeric(7,2) not null check (largeur_mm > 0 and largeur_mm <= 1000),
  hauteur_mm numeric(7,2) not null check (hauteur_mm > 0 and hauteur_mm <= 1000),

  -- LA MARGE DU MODÈLE, EN MILLIMÈTRES, ET ELLE N'A RIEN À VOIR AVEC
  -- CELLE DE @page. Le produit impose aujourd'hui « @page { margin:
  -- 14mm } » à toutes ses pages : sous cette règle, une étiquette de
  -- 25 × 15 mm a une surface imprimable NÉGATIVE (14 + 14 = 28 mm de
  -- marges pour 15 mm de hauteur). La planche d'étiquettes devra donc
  -- déclarer ses propres @page — c'est un chantier web, pas un
  -- chantier de base. Ce qu'on stocke ici, c'est le blanc tournant
  -- SUR l'étiquette, celui que la tête thermique ne doit pas mordre.
  marge_mm numeric(7,2) not null default 1.5 check (marge_mm >= 0 and marge_mm <= 50),

  champs jsonb not null default '[]'::jsonb
    check (public.etiquette_champs_valides(champs)),

  est_defaut boolean not null default false,

  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Le blanc tournant ne peut pas manger l'étiquette entière.
  constraint etiquette_modeles_marge_tenable
    check (marge_mm * 2 < least(largeur_mm, hauteur_mm))
);

-- UN SEUL MODÈLE PAR DÉFAUT PAR FAMILLE ET PAR ENTREPRISE. L'expression
-- coalesce() est là parce que NULL n'entre pas en conflit avec NULL
-- dans un index unique : sans elle, on pourrait semer deux modèles
-- Oasis par défaut pour la même famille sans que rien ne proteste.
create unique index if not exists etiquette_modeles_un_defaut_idx
  on public.etiquette_modeles (
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), famille)
  where est_defaut and archived_at is null;

create index if not exists etiquette_modeles_par_organisation_idx
  on public.etiquette_modeles (organization_id, famille) where archived_at is null;

alter table public.etiquette_modeles enable row level security;

-- LES MODÈLES OASIS SONT LISIBLES PAR TOUT COMPTE CONNECTÉ ; ceux d'une
-- entreprise, par ses membres habilités. `anon` n'a rien à faire ici :
-- un modèle d'étiquette décrit ce qu'une entreprise imprime, ce n'est
-- pas une donnée publique.
drop policy if exists "Les modèles d'étiquette se lisent" on public.etiquette_modeles;
create policy "Les modèles d'étiquette se lisent" on public.etiquette_modeles
  for select using (
    (organization_id is null and auth.uid() is not null)
    or (organization_id is not null and public.has_permission(organization_id, 'etiquettes.read'))
  );

comment on table public.etiquette_modeles is
  'Les modèles d''étiquette du § 18. organization_id NULL = modèle fourni par Oasis, lisible par tous '
  'et modifiable par personne : c''est ce qui garantit qu''un éditeur ne s''ouvre jamais vide, sans '
  'avoir à semer trois lignes dans chaque entreprise créée.';

-- ---- 8.b LES TROIS MODÈLES FOURNIS -----------------------------
-- Semés une fois, reconnaissables à organization_id NULL. Le
-- « on conflict do nothing » sur l'index d'unicité du défaut rend ce
-- bloc rejouable.
insert into public.etiquette_modeles
  (organization_id, famille, nom, largeur_mm, hauteur_mm, marge_mm, est_defaut, champs)
select null, 'jardins', 'Jardins — étiquette botanique 60 × 40', 60, 40, 2, true,
  jsonb_build_array(
    jsonb_build_object('champ','nom',            'x',2,'y',2,  'largeur',34,'hauteur',7, 'taille',9,'gras',true),
    jsonb_build_object('champ','nomScientifique','x',2,'y',9,  'largeur',34,'hauteur',6, 'taille',7,'italique',true),
    jsonb_build_object('champ','cultivar',       'x',2,'y',15, 'largeur',34,'hauteur',5, 'taille',7),
    jsonb_build_object('champ','emplacement',    'x',2,'y',21, 'largeur',34,'hauteur',5, 'taille',6),
    jsonb_build_object('champ','qr',             'x',40,'y',6, 'largeur',18,'hauteur',18),
    jsonb_build_object('champ','logo',           'x',2,'y',32, 'largeur',18,'hauteur',6))
where not exists (
  select 1 from public.etiquette_modeles m
   where m.organization_id is null and m.famille = 'jardins');

insert into public.etiquette_modeles
  (organization_id, famille, nom, largeur_mm, hauteur_mm, marge_mm, est_defaut, champs)
select null, 'pepiniere', 'Pépinière — étiquette de lot 50 × 30', 50, 30, 2, true,
  jsonb_build_array(
    jsonb_build_object('champ','nom',        'x',2,'y',2,  'largeur',26,'hauteur',6,'taille',8,'gras',true),
    jsonb_build_object('champ','cultivar',   'x',2,'y',8,  'largeur',26,'hauteur',5,'taille',7),
    jsonb_build_object('champ','numeroLot',  'x',2,'y',13, 'largeur',26,'hauteur',5,'taille',7),
    jsonb_build_object('champ','quantite',   'x',2,'y',18, 'largeur',12,'hauteur',5,'taille',7),
    jsonb_build_object('champ','emplacement','x',14,'y',18,'largeur',14,'hauteur',5,'taille',7),
    jsonb_build_object('champ','date',       'x',2,'y',23, 'largeur',26,'hauteur',5,'taille',6),
    jsonb_build_object('champ','qr',         'x',30,'y',5, 'largeur',18,'hauteur',18))
where not exists (
  select 1 from public.etiquette_modeles m
   where m.organization_id is null and m.famille = 'pepiniere');

insert into public.etiquette_modeles
  (organization_id, famille, nom, largeur_mm, hauteur_mm, marge_mm, est_defaut, champs)
-- LE CADRE DU QR EST PASSÉ DE 13 À 15 mm, ET CE N'EST PAS COSMÉTIQUE.
-- Mesuré : l'adresse imprimée fait 59 caractères, ce qui donne un QR
-- de version 4, soit 33 modules plus 4 de zone de silence de chaque
-- côté = 41 modules. Dans 13 mm, un module fait 0,317 mm — SOUS le
-- plancher de lisibilité de 0,33 mm que le module de rendu applique.
-- L'autocollant sortait parfait à l'œil et ne se scannait pas. À
-- 15 mm, le module fait 0,366 mm et repasse le plancher.
-- Les champs de texte perdent 1 mm de largeur pour lui faire place.
select null, 'biolab', 'BioLab — étiquette de lot 40 × 20', 40, 20, 1.5, true,
  jsonb_build_array(
    jsonb_build_object('champ','numeroLot','x',1.5,'y',1.5, 'largeur',21,'hauteur',5,'taille',7,'gras',true),
    jsonb_build_object('champ','stade',    'x',1.5,'y',6.5, 'largeur',21,'hauteur',4,'taille',6),
    jsonb_build_object('champ','date',     'x',1.5,'y',10.5,'largeur',21,'hauteur',4,'taille',6),
    jsonb_build_object('champ','quantite', 'x',1.5,'y',14.5,'largeur',21,'hauteur',4,'taille',6),
    jsonb_build_object('champ','qr',       'x',23,'y',2,    'largeur',15,'hauteur',15))
where not exists (
  select 1 from public.etiquette_modeles m
   where m.organization_id is null and m.famille = 'biolab');

-- ---- 8.c ÉCRIRE UN MODÈLE --------------------------------------
create or replace function public.etiquette_modele_enregistrer(
  p_organization_id uuid,
  p_famille text,
  p_nom text,
  p_largeur_mm numeric,
  p_hauteur_mm numeric,
  p_champs jsonb,
  p_marge_mm numeric default 1.5,
  p_est_defaut boolean default false,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null then
    raise exception 'Les modèles fournis par Oasis ne se modifient pas : créez le vôtre.'
      using errcode = '42501';
  end if;
  if not public.has_permission(p_organization_id, 'etiquettes.manage') then
    raise exception 'Accès refusé : modifier un modèle d''étiquette demande le droit de gérer les étiquettes.'
      using errcode = '42501';
  end if;

  -- UN SEUL DÉFAUT PAR FAMILLE : on démet l'ancien avant de promouvoir
  -- le nouveau, plutôt que de laisser l'index unique refuser
  -- l'enregistrement avec un message que personne ne comprend.
  if coalesce(p_est_defaut, false) then
    update public.etiquette_modeles
       set est_defaut = false, updated_at = now()
     where organization_id = p_organization_id
       and famille = p_famille
       and archived_at is null
       and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.etiquette_modeles
      (organization_id, famille, nom, largeur_mm, hauteur_mm, marge_mm, champs, est_defaut, created_by)
    values (p_organization_id, p_famille, btrim(p_nom), p_largeur_mm, p_hauteur_mm,
            coalesce(p_marge_mm, 1.5), coalesce(p_champs, '[]'::jsonb),
            coalesce(p_est_defaut, false), auth.uid())
    returning id into v_id;
  else
    update public.etiquette_modeles
       set famille = p_famille,
           nom = btrim(p_nom),
           largeur_mm = p_largeur_mm,
           hauteur_mm = p_hauteur_mm,
           marge_mm = coalesce(p_marge_mm, 1.5),
           champs = coalesce(p_champs, '[]'::jsonb),
           est_defaut = coalesce(p_est_defaut, false),
           updated_at = now()
     where id = p_id
       and organization_id = p_organization_id
       and archived_at is null
    returning id into v_id;

    if v_id is null then
      raise exception 'Modèle d''étiquette introuvable dans cette entreprise.' using errcode = '23503';
    end if;
  end if;

  return v_id;
end $$;

create or replace function public.etiquette_modele_archiver(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.etiquette_modeles where id = p_id;
  if v_org is null then
    -- Couvre les deux cas d'un seul refus : le modèle n'existe pas, ou
    -- c'est un modèle Oasis. Aucun des deux ne s'archive.
    raise exception 'Ce modèle ne peut pas être archivé.' using errcode = '42501';
  end if;
  if not public.has_permission(v_org, 'etiquettes.manage') then
    raise exception 'Accès refusé : archiver un modèle d''étiquette demande le droit de gérer les étiquettes.'
      using errcode = '42501';
  end if;

  update public.etiquette_modeles
     set archived_at = now(), est_defaut = false, updated_at = now()
   where id = p_id and archived_at is null;
  return true;
end $$;


-- ============================================================
-- 9. LES DEUX PERMISSIONS NEUVES — ET LE PIÈGE DE 0075
-- ============================================================
--
-- LE PIÈGE, QUI A DÉJÀ MORDU TROIS FOIS : une permission neuve n'est
-- portée par PERSONNE tant qu'on ne l'insère pas explicitement dans
-- role_permissions. owner et admin passent tout sans seed ; tous les
-- autres rôles voient l'écran disparaître de leur menu sans un mot.
-- Ce paragraphe existe pour que cela n'arrive pas une quatrième fois.
--
-- POURQUOI DEUX ET PAS UNE : lire une étiquette et en poser une ne sont
-- pas le même geste. Scanner est un geste de terrain que tout le monde
-- fait, y compris l'ouvrier qui cherche où planter. Poser une
-- étiquette engage un rouleau, décide de ce qui est imprimé, et peut
-- ouvrir une fiche au public.
--
-- POURQUOI PAS DE PERMISSION POUR LES JARDINS NI LA PÉPINIÈRE : parce
-- que le résolveur exige DÉJÀ la permission du monde concerné —
-- 'projects.read' pour un jardin, 'nursery.stock.manage' pour un lot
-- de pépinière.
--
-- MAIS BIOLAB N'AVAIT AUCUN JUGE, et c'était une inversion complète.
-- Les six familles du laboratoire retombaient sur 'etiquettes.read',
-- accordée aux ONZE rôles. Résultat mesuré : le préparateur de
-- commandes se voyait refuser le nom d'une mini-pelle (gardée par
-- 'projects.read') et recevait EN ENTIER un lot de culture — espèce,
-- cultivar, stade, effectif. C'est le savoir-faire du laboratoire, et
-- c'était la donnée la moins protégée du produit.
--
-- LE RÉSOLVEUR EXIGE DONC 'biolab.read' SUR LES SIX FAMILLES DU
-- LABORATOIRE, et cette permission N'EST PAS SEMÉE ICI : 0087 § 1.2
-- l'a déjà posée, et le web la connaît (lib/auth/permissions.ts). La
-- redéclarer avec une autre liste de rôles aurait créé deux vérités
-- pour un même droit. Vérifié en production avant d'écrire :
-- 'biolab.read' est portée par manager, nurseryManager, nurseryWorker
-- et readOnly — plus owner et admin, qui passent tout sans seed.
-- Autrement dit, ceux qui entrent au laboratoire, et eux seuls.

-- LA FORME « values (rôle, permission) » N'EST PAS UN GOÛT D'ÉCRITURE.
-- web-pro/lib/auth/permissions.test.ts relit TOUTES les migrations pour
-- vérifier que le web et la base accordent exactement les mêmes droits,
-- et son motif attend « insert into public.role_permissions
-- (role, permission) values ». La forme « select … from (values …) »
-- passait à côté de son filet : les deux permissions neuves auraient pu
-- diverger sans qu'aucun test ne le dise.
insert into public.role_permissions (role, permission) values
  ('manager',        'etiquettes.read'),
  ('sales',          'etiquettes.read'),
  ('designer',       'etiquettes.read'),
  ('projectManager', 'etiquettes.read'),
  ('accounting',     'etiquettes.read'),
  ('nurseryManager', 'etiquettes.read'),
  ('readOnly',       'etiquettes.read'),
  ('teamLeader',     'etiquettes.read'),
  ('fieldWorker',    'etiquettes.read'),
  ('nurseryWorker',  'etiquettes.read'),
  ('orderPicker',    'etiquettes.read')
on conflict (role, permission) do nothing;

-- GÉRER : ceux qui décident de ce qui s'imprime. L'ouvrier de terrain
-- et le préparateur de commandes scannent, ils ne composent pas les
-- étiquettes ; la comptabilité et le lecteur seul non plus.
insert into public.role_permissions (role, permission) values
  ('manager',        'etiquettes.manage'),
  ('designer',       'etiquettes.manage'),
  ('projectManager', 'etiquettes.manage'),
  ('nurseryManager', 'etiquettes.manage'),
  ('teamLeader',     'etiquettes.manage')
on conflict (role, permission) do nothing;


-- ============================================================
-- 10. LES DROITS — VÉRIFIÉS PAR REQUÊTE, PAS PAR CONFIANCE
-- ============================================================
--
-- Supabase accorde par défaut select/insert/update/delete à `anon` et
-- `authenticated` sur toute table neuve du schéma `public`. C'est là
-- que 0055 s'est fait avoir. Rien ici ne s'écrit depuis un navigateur :
-- la RLS pose la lecture, les fonctions du § 7 et du § 8 posent
-- l'écriture, et le reste est retiré à la main.

do $$
declare t text;
begin
  foreach t in array array['etiquette_garde', 'etiquette_tentatives', 'etiquette_modeles']
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from public', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    -- `anon` n'a RIEN sur ces trois tables, pas même la lecture : la
    -- seule chose qu'un anonyme puisse faire avec une étiquette, c'est
    -- apporter son jeton au résolveur.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 10.a LA SEULE PORTE ANONYME DE CE FICHIER
-- ------------------------------------------------------------
-- Sur le modèle d'email_unsubscribe (0084 § 15.b), la seule fonction du
-- dépôt déjà accordée à `anon`. Celle-ci est sûre parce que son corps
-- énumère colonne par colonne ce qui sort, et qu'elle n'ouvre aucune
-- session.
revoke all on function public.etiquette_resoudre(text) from public;
grant execute on function public.etiquette_resoudre(text) to anon;
grant execute on function public.etiquette_resoudre(text) to authenticated;

-- Le signal de saturation : un seul booléen, aucune donnée. La route /x
-- tourne sans session ; sans ce grant, elle ne pourrait pas savoir
-- qu'il faut refuser au bord.
revoke all on function public.etiquettes_sous_attaque() from public;
grant execute on function public.etiquettes_sous_attaque() to anon;
grant execute on function public.etiquettes_sous_attaque() to authenticated;

-- ------------------------------------------------------------
-- 10.b CE QU'UN COMPTE CONNECTÉ PEUT APPELER
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.etiquette_creer(text, uuid, text, boolean, boolean)',
    'public.etiquettes_creer_lot(text, uuid[], text, boolean)',
    'public.etiquette_publier(uuid, boolean)',
    'public.etiquette_desactiver(uuid)',
    'public.etiquette_modele_enregistrer(uuid, text, text, numeric, numeric, jsonb, numeric, boolean, uuid)',
    'public.etiquette_modele_archiver(uuid)',
    'public.etiquette_garde_regler(integer, integer, integer)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 10.c CE QUE PERSONNE N'APPELLE DEPUIS UN NAVIGATEUR
-- ------------------------------------------------------------
-- etiquette_note_echec écrit le compteur d'attaques : l'exposer, ce
-- serait offrir le moyen de saturer soi-même le drapeau et de faire
-- refuser tout le monde au bord. etiquette_portee_cible et
-- etiquette_fenetre sont des rouages internes ; smart_tags_portee est
-- un déclencheur ; etiquette_droit est le juge du § 5 bis, appelé
-- depuis l'intérieur de fonctions « security definer » — ses appelants
-- n'ont donc besoin d'aucun droit dessus, et l'exposer offrirait un
-- moyen commode de sonder qui a quoi.
do $$
declare f text;
begin
  foreach f in array array[
    'public.etiquette_note_echec(timestamptz)',
    'public.etiquette_fenetre(timestamptz)',
    'public.etiquette_portee_cible(text, uuid)',
    'public.etiquette_droit(uuid, uuid, text)',
    'public.smart_tags_portee()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
  end loop;
end $$;


-- ============================================================
-- 11. CE QUI RESTE À TRANCHER, ET QUI N'EST PAS DU CODE
-- ============================================================
--
--   • LE DOMAINE. oasisrarecare.fr ou .com ? Le chemin /x/ est-il
--     figé ? Un domaine court dédié (oasisrare.app, 13 caractères
--     contre 16) ferait gagner une version de QR entière, mais il faut
--     l'acheter et il engage dix ans lui aussi. VOIR L'EN-TÊTE :
--     aucune ligne de ce fichier ne dépend de la réponse.
--
--   • LA LONGUEUR DU JETON. 32 caractères hexadécimaux aujourd'hui.
--     Un jeton de 16 caractères (80 bits) ferait passer le QR d'une
--     version 4 à une version 3 — nettement plus lisible sur une
--     étiquette de 25 × 15 mm. Avec la garde du § 5, 80 bits sont hors
--     de portée d'une énumération. C'est une décision de produit :
--     elle se prendra en changeant l'expression régulière du § 6 et le
--     défaut du § 1, sans réimprimer une seule étiquette existante.
--
--   • LES CINQ ÉTIQUETTES DÉJÀ COLLÉES portent « oasis-care.example ».
--     Elles restent scannables DEPUIS L'APPLICATION Oasis Care, dont le
--     scanner ne vérifie pas l'hôte — mais elles sont mortes pour la
--     caméra du système et pour tout téléphone sans l'application.
--     Réimprimer coûte cinq autocollants. À dire au dirigeant avant de
--     décider.
--
--   • LA FICHE PUBLIQUE EST FERMÉE PAR DÉFAUT (public_fiche = false), et
--     n'existe que pour les PLANTES. Faut-il l'ouvrir par défaut sur
--     les jardins ouverts au public ? Faut-il l'étendre au jardin
--     lui-même ? Ce sont des décisions de produit, pas de sécurité :
--     le mécanisme est là, il suffit de cocher.
--
--   • LES MOTS DU § 13 QUI N'ONT AUCUNE TABLE : pompe, filtre,
--     électrovanne, robot, coffret, bac, plateau, contenant, étagère,
--     salle. Quinze des trente-six entrées du § 13 n'ont rigoureusement
--     rien à désigner en base. Sept d'entre elles deviendront des
--     catégories de connected_devices ; « coffret » n'apparaît sous
--     aucune forme nulle part. Ce fichier ne pose PAS de tables
--     fantômes par avance.
--
--   • proxy.ts DEVRA LAISSER PASSER /x. La liste isPublic de
--     web-pro/proxy.ts contient /login, /auth, /invitation et
--     /desabonnement — ni /d ni /x. En l'état, un visiteur non
--     connecté qui ouvre /x/<jeton> est redirigé vers /login, et toute
--     cette porte anonyme ne sert à rien. C'est une ligne à ajouter
--     côté web, et le chantier des devis doit y ajouter /d en même
--     temps : à se répartir pour ne pas se marcher dessus.
--
--   • LE PILOTAGE DES IMPRIMANTES THERMIQUES (§ 17) N'EST PAS
--     PROMIS ICI, et ne devrait l'être nulle part : produire du ZPL
--     pour une Zebra, du b-PAC pour une Brother ou piloter une Dymo par
--     son SDK exige un logiciel installé sur le poste. Ce qu'un
--     navigateur sait faire — une planche HTML aux cotes exactes, que
--     « Enregistrer au format PDF » transforme en PDF et qu'une
--     thermique installée comme imprimante système avale très bien —
--     couvre l'essentiel du § 17. C'est un constat, pas une limite de
--     ce fichier : la base n'imprime rien.
--
--   • nursery_lots.public_token N'EST PAS SUPPRIMÉE (§ 4). Le jour où
--     l'on aura la certitude qu'aucun autocollant ne porte plus l'un de
--     ces jetons, une migration d'une ligne la retirera. Pas avant : un
--     « drop column » ne se rejoue pas à l'envers.
