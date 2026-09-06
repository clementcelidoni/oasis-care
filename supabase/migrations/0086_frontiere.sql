-- Oasis Care — migration 0086 : LA FRONTIÈRE.
--
-- Idempotente. Aucune suppression de donnée : §26 est catégorique, et
-- ce chantier ne fait que DÉPLACER des lignes d'un espace de travail à
-- un autre, ou poser des `revoked_at`.
--
-- ============================================================
-- LE DÉFAUT, EN UNE PHRASE
-- ============================================================
--
-- Le produit a deux mondes de propriété qui ne se parlent pas : le
-- monde PARTICULIER (colonne `workspace_id`, gardé par
-- `is_workspace_member`) et le monde PROFESSIONNEL (colonne
-- `organization_id`, gardé par `has_permission`). Aucune des 196 tables
-- ne porte les deux colonnes — mesuré.
--
-- Un jardin, lui, appartient AUX DEUX À LA FOIS : à son propriétaire
-- particulier, et à l'entreprise qui l'entretient. C'est ce que la
-- migration 0055 avait commencé à écrire avec `garden_access`,
-- `has_garden_access` et `can_edit_garden` — mais seulement pour SIX
-- tables : le jardin lui-même et les cinq tables de son PLAN.
--
-- Quinze tables portent pourtant `garden_id` ET `workspace_id`.
-- Autrement dit DIX tables sont restées derrière :
--
--   plants, sensors, connected_devices, irrigation_zones, greenhouses,
--   ponds, scenes, garden_checkups, garden_plan_images,
--   digital_twin_revisions
--
-- Trois conséquences, toutes mesurées en transaction annulée sur la
-- production :
--
--   (a) LE CLIENT REÇOIT UN JARDIN SANS PLANTES. Après
--       `deliver_garden_to_client`, le propriétaire voit le plan et
--       zéro plante, zéro capteur, zéro équipement, zéro serre, zéro
--       bassin, zéro scène, zéro bilan, zéro relevé.
--
--   (b) LE SALARIÉ DE L'ENTREPRISE GARDE CES DIX FAMILLES EN ÉCRITURE,
--       sur un jardin qui a quitté son entreprise, et sans même voir le
--       jardin qui les porte. `select … for update` réussit.
--
--   (c) LES COLLÈGUES DU PAYSAGISTE QUI A LIVRÉ PERDENT TOUT.
--       `deliver_garden_to_client` n'accorde une ligne `garden_access`
--       qu'à L'APPELANT. `garden_access` est par UTILISATEUR : l'équipe
--       entière perd le jardin qu'elle vient de livrer.
--
-- ============================================================
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS
-- ============================================================
--
-- ELLE NE CRÉE PAS DE SECOND MOTEUR DE DROITS. `has_permission`,
-- `role_permissions` et les 144 politiques qui les appellent sont la
-- seule chaîne du produit qui descende vraiment jusqu'à RLS. On écrit
-- sa JUMELLE — `garden_access_by_organization` — et on la replie DANS
-- les deux fonctions que 0055 avait déjà posées. Les politiques
-- existantes ne sont pas remplacées : les nouvelles s'ajoutent à côté,
-- et deux politiques permissives se lisent en « ou ». Un particulier ne
-- peut donc RIEN perdre : sa politique `is_workspace_member` n'est pas
-- touchée.
--
-- ELLE NE BRANCHE PAS L'ABONNEMENT. Aucune politique de données ne
-- vérifie d'entitlement aujourd'hui, et aucun des comptes de production
-- n'a d'abonnement enregistré : un « et abonnement actif » posé ici
-- mettrait tout le monde à la porte le jour de son application. Mais la
-- place est laissée, et elle est nommée — voir le §1.5.
--
-- ELLE NE TOUCHE NI À web-pro, NI À web-admin, NI À L'IPHONE. Ce qui,
-- dans les défauts constatés, ne peut se corriger que là-bas est porté
-- au compte rendu, pas bricolé ici.
--
-- ============================================================
-- LE PLAN DU FICHIER
-- ============================================================
--   1.   LE PONT — la jumelle de has_permission, les deux fonctions de
--        0055 élargies, les cinq localisateurs, 38 politiques neuves.
--   2.   LES FICHIERS DU PLAN — l'autorité passe du chemin à la ligne…
--   2bis …ET LA REVENDICATION EST CONTRAINTE, sans quoi n'importe qui
--        réclamerait le fichier d'un autre et en exclurait son
--        propriétaire. Index unique + déclencheur.
--   2ter LE PRÉDICAT, avec la branche qui manquait : le paysagiste peut
--        de nouveau téléverser un plan dans un jardin qu'il a livré.
--   3.   DEUX ESCALADES FERMÉES sur `garden_access` — se déclarer
--        propriétaire, et inscrire ses collègues d'avance.
--   4.   LA TRACE DES LIVRAISONS — aucune clé qui verrouille, aucune
--        qui efface.
--   4bis §28 — le client ne lit pas les brouillons de son paysagiste.
--   5.   LA LIVRAISON QUI EMPORTE TOUT — seize tables, pas six.
--   6.   LE RETOUR ARRIÈRE, et sa soupape.
--   6bis ON RÉVOQUE UNE ENTREPRISE, PAS UN NOM — sans quoi la
--        révocation ne révoque rien.
--   7.   LE SENS INVERSE — un jardin personnel reconnaît enfin son
--        propriétaire.
--   8.   L'INVARIANT ENFIN COMPLET — et le déclencheur qui, faute
--        d'être `definer`, ne protégeait que ceux qui n'en avaient pas
--        besoin.
--   9.   LE SALARIÉ QUI PART ET QUI RESTE — l'archivage n'était pas lu
--        par `is_workspace_member`.
--
-- CE QUI RESTE VOLONTAIREMENT IMPARFAIT, et qui est écrit noir sur
-- blanc à l'endroit concerné plutôt que passé sous silence :
--   • les cinq localisateurs répondent encore à tout compte CONNECTÉ
--     qui connaît déjà l'identifiant d'une ligne (§1.3) ;
--   • le coût d'un balayage complet augmente d'environ moitié sur les
--     tables adossées au jardin (§1.4) ;
--   • quatre rôles d'entreprise perdent les jardins livrés, dont le
--     chef d'équipe : c'est une question posée au dirigeant, pas une
--     décision prise ici (§1.2).

-- ============================================================
-- 1. LE PONT
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 La jumelle de has_permission
-- ------------------------------------------------------------
-- « Une entreprise dont je fais partie est-elle légitimement autorisée
--   sur ce jardin, et ai-je le droit correspondant dans cette
--   entreprise ? »
--
-- Même forme que `has_permission` : `security definer` parce qu'elle
-- doit lire `garden_access` et `organization_members` sans que la
-- politique de ces tables ne se rappelle elle-même ; `stable` parce
-- qu'elle sera évaluée ligne à ligne par une cinquantaine de
-- politiques ; `set search_path` parce qu'une fonction `definer` sans
-- chemin figé est une porte d'entrée.
--
-- ELLE NE RÉÉCRIT PAS `has_permission`, ELLE L'APPELLE. C'est le point
-- important : le jour où les rôles changent, ils changent à un seul
-- endroit. Un prédicat recopié à la main est exactement la faute que
-- l'architecture interdit.
--
-- POURQUOI L'ACCÈS EST PORTÉ PAR L'ORGANISATION ET NON PAR CHAQUE
-- SALARIÉ : `garden_access` est par utilisateur, mais ses lignes
-- portent déjà un `organization_id` — que `deliver_garden_to_client`
-- remplit, et qu'AUCUN prédicat de lecture n'utilisait. Une seule ligne
-- suffit donc à ouvrir le jardin à toute l'équipe, sans table nouvelle,
-- sans écran nouveau, et sans que personne ait à penser à inscrire ses
-- collègues un par un. Le corollaire est voulu : quand le propriétaire
-- révoque cette ligne, c'est l'entreprise entière qui sort — §"Le
-- propriétaire peut retirer l'accès du professionnel" ne veut rien dire
-- d'autre.
create or replace function public.garden_access_by_organization(
  p_garden_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.garden_access ga
    where ga.garden_id = p_garden_id
      and ga.organization_id is not null
      and ga.revoked_at is null
      and public.has_permission(ga.organization_id, p_permission)
  );
$$;

comment on function public.garden_access_by_organization(uuid, text) is
  'Le pont entre les deux mondes de propriété : une entreprise autorisée sur un jardin (ligne garden_access portant son organization_id) ouvre ce jardin à ses membres qui détiennent la permission demandée. Jumelle de has_permission, qu''elle appelle plutôt que de la recopier (0086).';

-- ------------------------------------------------------------
-- 1.2 Les deux fonctions de 0055, élargies
-- ------------------------------------------------------------
-- On ne pose pas une troisième porte à côté des deux existantes : on
-- élargit celles-ci. Elles sont déjà appelées par 14 politiques, par
-- `global_search` et par `documents_check_entity` — trois endroits qui
-- doivent continuer de rendre exactement les mêmes lignes que RLS. Les
-- élargir toutes en même temps est la seule façon de ne pas les faire
-- diverger.
--
-- QUELLE PERMISSION POUR QUELLE MOITIÉ, et c'est un choix, pas une
-- évidence :
--   • LIRE  → `clients.read`. C'est la permission minimale de qui
--     s'occupe des clients ; `readOnly`, `accounting`, `designer`,
--     `nurseryManager`, `projectManager`, `sales` et `manager` l'ont.
--   • ÉCRIRE → `clients.read` ET `digitalTwin.edit`. C'est littéralement
--     « modifier le jardin » ; `designer`, `projectManager` et `manager`
--     l'ont. Prendre `clients.write` à la place aurait mis à la porte le
--     designer et le chef de projet — c'est-à-dire précisément ceux qui
--     entretiennent le plan — pour y faire entrer le commercial.
--
--     POURQUOI LES DEUX ET NON `digitalTwin.edit` SEUL : les politiques
--     d'écriture sont en `cmd = ALL`, et le `using` d'une politique ALL
--     accorde AUSSI le `select`. Un rôle qui porterait `digitalTwin.edit`
--     sans `clients.read` lirait donc les dix-neuf familles du jardin
--     d'un client qu'il n'a pas le droit de voir. Aucun rôle du
--     catalogue ne les sépare aujourd'hui — les trois qui portent
--     `digitalTwin.edit` portent aussi `clients.read` — mais un rôle
--     `custom` le peut, et le jour où un rôle nouveau les séparerait,
--     personne ne relirait cette migration. Exiger les deux ne coûte
--     donc rien et ferme la porte d'avance.
--
-- CE QUE CE CHOIX RESSERRE, ET C'EST VOULU. QUATRE rôles sur onze n'ont
-- PAS `clients.read` — mesuré sur `role_permissions` :
--
--     fieldWorker      (projects.read)
--     teamLeader       (projects.manage, projects.read)
--     nurseryWorker    (nursery.stock.manage)
--     orderPicker      (nursery.stock.manage)
--
-- Ces quatre-là ne voient plus le jardin après sa livraison, alors
-- qu'ils voyaient tout avant par appartenance à l'espace. Ils ne voient
-- pas non plus la fiche client, et c'est cohérent.
--
-- LE CAS QUI DOIT REMONTER AU DIRIGEANT, ET C'EST LE CHEF D'ÉQUIPE :
-- `teamLeader` est l'homme qui mène ses gars sur le jardin du client.
-- Après livraison il ouvre l'application et voit zéro plante, sans
-- message. Lui donner `clients.read` marcherait, mais lui ouvrirait du
-- même coup les FICHES CLIENTS — coordonnées, historique commercial.
-- La bonne réponse est une permission dédiée (`gardens.read`) à mettre
-- ici À LA PLACE de `clients.read` ; c'est une décision produit, elle
-- n'est pas prise dans cette migration, et elle est portée au compte
-- rendu. Le test `frontiere.sql` modélise `teamLeader` à côté de
-- `fieldWorker` : le jour où quelqu'un déplacera cette frontière pour
-- dépanner un client, une assertion le dira.
--
-- LE PIÈGE ÉVITÉ : `revoked_at is null` est dans le corps des fonctions,
-- pas recopié dans les politiques. Une politique écrite à la main qui
-- l'oublierait rendrait la révocation inopérante — et personne ne le
-- verrait, puisque le symptôme est « ça marche encore ».
create or replace function public.has_garden_access(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garden_access
    where garden_id = p_garden_id
      and user_id = auth.uid()
      and revoked_at is null
  )
  or public.garden_access_by_organization(p_garden_id, 'clients.read');
$$;

create or replace function public.can_edit_garden(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garden_access
    where garden_id = p_garden_id
      and user_id = auth.uid()
      and revoked_at is null
      and role in ('owner', 'householdMember', 'professional')
  )
  or (
    public.garden_access_by_organization(p_garden_id, 'clients.read')
    and public.garden_access_by_organization(p_garden_id, 'digitalTwin.edit')
  );
$$;

comment on function public.has_garden_access(uuid) is
  'Droit de LIRE un jardin partagé : une ligne garden_access nominative, ou une entreprise autorisée dont je suis membre avec clients.read (0086).';
comment on function public.can_edit_garden(uuid) is
  'Droit d''ÉCRIRE sur un jardin partagé : une ligne garden_access nominative autre que readOnly, ou une entreprise autorisée dont je suis membre avec digitalTwin.edit (0086).';

-- `is_garden_owner` NE REÇOIT PAS la branche organisation, et c'est
-- délibéré. Le propriétaire est celui qui peut retirer l'accès des
-- autres : une entreprise ne doit jamais pouvoir se déclarer
-- propriétaire du jardin de son client, sous peine de rendre la
-- révocation impossible. Elle reste donc telle que 0055 l'a écrite.

-- ------------------------------------------------------------
-- 1.3 Les cinq localisateurs
-- ------------------------------------------------------------
-- Huit tables ne portent pas `garden_id` : elles pendent à un parent
-- qui, lui, le porte. Leur politique actuelle fait un `exists` sur ce
-- parent — ce qui, sous les droits de l'appelant, RÉAPPLIQUE la RLS du
-- parent à l'intérieur de la politique de l'enfant. Cela fonctionne,
-- mais cela évalue deux fois le même prédicat par ligne, et cela crée
-- une dépendance invisible : le jour où le parent gagne une politique
-- permissive de plus, l'enfant s'élargit tout seul.
--
-- Ces cinq fonctions coupent les deux problèmes d'un coup : elles
-- rendent le jardin du parent, sans RLS, en une ligne.
--
-- `auth.uid() is not null` N'EST PAS DÉCORATIF : sans cette clause,
-- ces cinq fonctions répondent au VISITEUR NON CONNECTÉ. `anon` obtient
-- alors le jardin de n'importe quelle plante, de n'importe quel
-- capteur, de n'importe quelle scène — mesuré — alors que la même
-- session lit zéro ligne de `plants`. Ce n'est pas une donnée métier,
-- mais c'est un oracle, et il n'avait aucune raison d'exister.
create or replace function public.plant_garden(p_plant_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select garden_id from public.plants where id = p_plant_id and auth.uid() is not null $$;

create or replace function public.sensor_garden(p_sensor_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select garden_id from public.sensors where id = p_sensor_id and auth.uid() is not null $$;

create or replace function public.irrigation_zone_garden(p_zone_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select garden_id from public.irrigation_zones where id = p_zone_id and auth.uid() is not null $$;

create or replace function public.scene_garden(p_scene_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select garden_id from public.scenes where id = p_scene_id and auth.uid() is not null $$;

create or replace function public.checkup_garden(p_checkup_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select garden_id from public.garden_checkups where id = p_checkup_id and auth.uid() is not null $$;

comment on function public.plant_garden(uuid) is
  'Le jardin d''une plante, sans repasser par la RLS de plants. Sert aux politiques de ses enfants indirects (0086).';

-- POURQUOI LA GARDE EST DANS LE CORPS ET NON DANS LES DROITS — ET
-- C'EST UNE MESURE, PAS UNE PRÉFÉRENCE.
--
-- Le réflexe était de faire comme `move_garden_children` : `revoke all
-- … from public, anon, authenticated`. J'ai essayé, et la matrice l'a
-- refusé deux fois, pour deux raisons différentes :
--
--   • RETIRER LE DROIT À `authenticated` casse tout. Une politique RLS
--     s'évalue avec les privilèges de CELUI QUI INTERROGE, pas de celui
--     qui l'a écrite. Les huit familles indirectes — photos, soins,
--     calendrier, analyses, relevés, arrosages, actions de scène,
--     lignes de bilan — tombaient alors à zéro pour TOUT LE MONDE, y
--     compris pour le propriétaire du jardin.
--
--   • LE RETIRER À `anon` ne rend pas « zéro ligne », il rend UNE
--     ERREUR. Une session expirée ou un visiteur non connecté recevait
--     « permission denied for function » là où il lisait auparavant une
--     liste vide. Aucune fuite, mais un refus illisible à la place d'un
--     résultat vide, sur neuf tables.
--
-- La garde est donc dans le corps : `auth.uid() is not null`. Le
-- visiteur non connecté obtient NULL — donc rien, proprement — et les
-- politiques continuent de fonctionner pour ceux qui en ont besoin.
--
-- CE QUI RESTE, ET IL FAUT LE DIRE : tout compte CONNECTÉ peut encore
-- demander le jardin d'une ligne dont il connaît déjà l'identifiant.
-- C'est un oracle identifiant-pour-identifiant sur des UUID qui ne se
-- devinent pas, et il ne rend aucune donnée métier — ni nom, ni photo,
-- ni relevé. Le fermer vraiment demanderait de repasser ces cinq
-- fonctions en `security invoker`, donc de réappliquer la RLS du parent
-- à l'intérieur de la politique de l'enfant : c'est exactement ce que
-- le §1.3 a supprimé, et cela doublerait un coût déjà mesuré à +52 %.
-- Défaut mineur assumé, écrit ici pour qu'il ne se redécouvre pas.

-- ------------------------------------------------------------
-- 1.4 Le pont posé sur les dix tables laissées derrière
-- ------------------------------------------------------------
-- EXACTEMENT le modèle que les cinq tables du plan appliquent depuis
-- 0055 : la politique d'espace reste, on lui ajoute une politique de
-- LECTURE et une politique d'ÉCRITURE adossées au jardin.
--
-- POURQUOI DEUX POLITIQUES ET NON UNE : la politique d'espace est en
-- `cmd = ALL` sans `with check`, donc lire et écrire y sont le même
-- droit — ce qui est juste quand le prédicat est « tu es chez toi ».
-- Ça cesse de l'être dès qu'un invité entre : `readOnly` doit regarder
-- sans toucher. Une seule politique élargie aurait donné le droit
-- d'écrire à qui n'a que celui de lire.
--
-- `garden_id` est nullable sur la plupart de ces tables. Les fonctions
-- rendent faux sur NULL : une plante d'intérieur sans jardin ne
-- s'ouvre à personne de nouveau.
do $$
declare t text;
begin
  foreach t in array array[
    'plants', 'sensors', 'connected_devices', 'irrigation_zones',
    'greenhouses', 'ponds', 'scenes', 'garden_checkups',
    'garden_plan_images', 'digital_twin_revisions',
    -- `garden_zones` n'a pas de `workspace_id` mais porte `garden_id` :
    -- même traitement, sa politique d'espace passe déjà par le jardin.
    'garden_zones'
  ]
  loop
    execute format('drop policy if exists "Garden guests can read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Garden editors can write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Garden guests can read %1$s" on public.%1$I
         for select using (public.has_garden_access(garden_id))', t);
    execute format(
      'create policy "Garden editors can write %1$s" on public.%1$I
         for all using (public.can_edit_garden(garden_id))
         with check (public.can_edit_garden(garden_id))', t);
  end loop;
end $$;
-- Les huit enfants indirects. Même paire, résolue par le localisateur
-- du parent.
--
-- ILS NE SONT PAS FACULTATIFS : une plante visible dont la photo ne
-- l'est pas, c'est un demi-pont — exactement l'incohérence que la
-- cartographie a relevée entre `irrigation_pipes` (visible) et
-- `irrigation_zones` (invisible). §28 nomme d'ailleurs le « calendrier »
-- parmi ce que le client doit consulter : c'est `care_events` et
-- `care_schedules`.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('plant_photos',           'plant_id',   'plant_garden'),
      ('care_events',            'plant_id',   'plant_garden'),
      ('care_schedules',         'plant_id',   'plant_garden'),
      ('ai_analyses',            'plant_id',   'plant_garden'),
      ('sensor_readings',        'sensor_id',  'sensor_garden'),
      ('irrigation_events',      'zone_id',    'irrigation_zone_garden'),
      ('scene_actions',          'scene_id',   'scene_garden'),
      ('garden_checkup_entries', 'checkup_id', 'checkup_garden')
    ) as v(tbl, col, locator)
  loop
    execute format('drop policy if exists "Garden guests can read %1$s" on public.%1$I', r.tbl);
    execute format('drop policy if exists "Garden editors can write %1$s" on public.%1$I', r.tbl);
    execute format(
      'create policy "Garden guests can read %1$s" on public.%1$I
         for select using (public.has_garden_access(public.%3$I(%2$I)))',
      r.tbl, r.col, r.locator);
    execute format(
      'create policy "Garden editors can write %1$s" on public.%1$I
         for all using (public.can_edit_garden(public.%3$I(%2$I)))
         with check (public.can_edit_garden(public.%3$I(%2$I)))',
      r.tbl, r.col, r.locator);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 1.5 La place laissée à l'abonnement
-- ------------------------------------------------------------
-- §20 demande un contrôle à cinq niveaux — UI, API, backend, Supabase,
-- RLS. RLS en applique un seul aujourd'hui, et ce chantier n'en ajoute
-- pas : il pose la frontière, pas le péage.
--
-- Mais il la pose de façon à ce que le péage tienne en DEUX LIGNES le
-- jour venu. Les 38 politiques créées ci-dessus n'appellent que
-- `has_garden_access` et `can_edit_garden`. Un droit payant s'y
-- ajouterait ainsi, et nulle part ailleurs :
--
--     …
--     or (
--       public.garden_access_by_organization(p_garden_id, 'clients.read')
--       and public.organization_has_entitlement(…, 'pro')   -- ← ici
--     );
--
-- Deux corps de fonction à retoucher, zéro politique. C'est la
-- différence entre un chantier d'une heure et un chantier de cinquante
-- tables — et c'est la seule raison pour laquelle ces deux fonctions
-- existent au lieu d'un prédicat recopié.

-- ============================================================
-- 2. LES FICHIERS DU PLAN
-- ============================================================
-- Le bucket `garden-plans` est indexé par le chemin
-- `{espace}/{fichier}` : c'est le PREMIER SEGMENT qui décide, et il
-- porte l'UUID de l'espace de travail. Une livraison déplace la LIGNE
-- `garden_plan_images` et laisse le FICHIER là où il est. Résultat
-- mesuré : le client possède la ligne sans le fichier, l'ex-collègue
-- garde le fichier sans la ligne — et peut le SUPPRIMER.
--
-- LE CHOIX, TRANCHÉ ICI : on ne déplace pas les octets. Renommer une
-- ligne de `storage.objects` en SQL ne déplace pas l'objet dans le
-- stockage — cela le casse. Un vrai déménagement demande une copie
-- côté serveur par l'API Storage, donc une Edge Function, hors de ce
-- périmètre.
--
-- Ce qu'on fait à la place : ON CHANGE L'AUTORITÉ. Quand une ligne
-- `garden_plan_images` désigne le fichier, c'est ELLE qui décide — et
-- elle, elle suit le jardin. Le chemin ne décide plus que pour un
-- fichier qu'aucune ligne ne réclame encore, c'est-à-dire pendant le
-- téléversement, avant que la ligne n'existe.
--
-- Conséquence : après livraison, le client lit et remplace le fichier,
-- l'ex-collègue ne peut plus ni le lire ni le supprimer. La fuite est
-- fermée dans les deux sens, sans avoir déplacé un octet.
--
-- CE PARAGRAPHE ÉTAIT FAUX À DEUX ENDROITS, et les §2 bis et 2 ter
-- ci-dessous sont ce qu'il a fallu écrire pour qu'il devienne vrai :
--   • « c'est la ligne qui décide » ne vaut rien tant que n'importe qui
--     peut FABRIQUER la ligne qui décide (§2 bis) ;
--   • « fermée dans les deux sens » ne valait que pour la LECTURE : le
--     paysagiste pouvait écrire la ligne du plan et pas téléverser le
--     fichier qu'elle désigne (§2 ter, branche (c)).
--
-- ============================================================
-- 2 bis. CE QUI REND LE §2 TENABLE : LA REVENDICATION CONTRAINTE
-- ============================================================
-- « La ligne décide » ne vaut que si l'on ne peut pas fabriquer une
-- ligne pour décider à la place d'un autre. Sans les deux garde-fous
-- ci-dessous, n'importe quel compte authentifié — sans entreprise, sans
-- jardin, sans aucun lien — se crée un jardin chez lui, insère une
-- ligne `garden_plan_images` portant le `storage_path` du fichier d'une
-- AUTRE entreprise, et devient l'autorité sur ce fichier : il le lit,
-- il le remplace, il le supprime. Et le propriétaire légitime, lui, en
-- est mis dehors, puisque la branche « une ligne réclame ce chemin »
-- remplace la branche du chemin au lieu de s'y ajouter.
--
-- Mesuré, joué, reproductible. Deux pièces le ferment :
--
--   (1) UN CHEMIN, UNE SEULE AUTORITÉ. Index UNIQUE sur `storage_path`.
--       La première ligne — celle du téléversement légitime, écrite
--       par la même fonction qui vient de poser le fichier — est la
--       seule qui puisse réclamer ce chemin. Toute revendication
--       ultérieure se heurte à l'index, y compris celle d'un
--       ex-collègue resté membre de l'espace d'origine.
--
--       L'index n'est PAS partiel sur `deleted_at is null`, et c'est
--       délibéré : une ligne mise à la corbeille garde autorité sur ses
--       octets. Sinon le fichier changerait de mains en silence au
--       moment précis où l'on croit l'avoir rangé — et plus personne ne
--       pourrait le supprimer pour de bon.
--
--   (2) ON NE RÉCLAME QUE CE QU'ON AURAIT PU TÉLÉVERSER. Un déclencheur
--       refuse un `storage_path` dont le premier segment n'est ni
--       l'espace du jardin de la ligne, ni un espace dont l'écrivain
--       est membre. Il ne surveille que la CRÉATION du lien (insert, et
--       update qui touche au chemin) : `move_garden_children` change
--       `workspace_id` sans toucher au chemin, et doit continuer de le
--       pouvoir — c'est tout le principe du §2, la ligne suit le
--       jardin, le fichier ne bouge pas.
create unique index if not exists garden_plan_images_storage_path_key
  on public.garden_plan_images (storage_path);

-- L'ancien index simple ne sert plus à rien : l'index unique le
-- remplace pour la recherche par chemin comme pour l'unicité.
drop index if exists public.garden_plan_images_storage_path_idx;

create or replace function public.enforce_plan_image_path()
returns trigger
language plpgsql
security definer   -- il doit lire `gardens` même quand l'appelant n'y a
                   -- pas accès, sans quoi il ne verrait rien et
                   -- laisserait tout passer.
set search_path = public
as $$
declare
  premier uuid;
  espace_du_jardin uuid;
begin
  -- Un chemin mal formé n'est pas revendicable : on refuse plutôt que
  -- de faire échouer le transtypage par une erreur illisible.
  if new.storage_path !~ '^[0-9a-fA-F-]{36}/' then
    raise exception 'Chemin de fichier de plan invalide.' using errcode = '22023';
  end if;
  premier := ((storage.foldername(new.storage_path))[1])::uuid;

  select workspace_id into espace_du_jardin
    from public.gardens where id = new.garden_id;

  if premier is distinct from espace_du_jardin
     and not public.is_workspace_member(premier) then
    raise exception 'Ce fichier n''est pas le vôtre : vous ne pouvez pas le rattacher à ce jardin.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_plan_image_path() is
  'Interdit de réclamer le fichier d''autrui : le premier segment du storage_path doit être l''espace du jardin, ou un espace dont l''écrivain est membre (0086).';

drop trigger if exists trg_plan_image_path on public.garden_plan_images;
create trigger trg_plan_image_path
  before insert or update of storage_path on public.garden_plan_images
  for each row execute function public.enforce_plan_image_path();

-- ------------------------------------------------------------
-- 2 ter. LE PRÉDICAT LUI-MÊME
-- ------------------------------------------------------------
-- Trois branches, dans cet ordre :
--
--   (a) UNE LIGNE RÉCLAME LE FICHIER → elle décide, et elle seule. La
--       revendication étant contrainte par le §2 bis, cette ligne est
--       nécessairement la ligne légitime, et le « elle seule » cesse
--       d'être une porte : c'est ce qui referme la fuite sur
--       l'ex-collègue.
--
--   (b) AUCUNE LIGNE, ET LE CHEMIN NOMME MON ESPACE → c'est un
--       téléversement, ou un fichier orphelin dans mon propre dossier.
--
--   (c) AUCUNE LIGNE, ET LE CHEMIN NOMME UN JARDIN QUE J'ENTRETIENS →
--       LA MOITIÉ QUI MANQUAIT. L'application construit
--       `{espace}/{jardin}/{fichier}` où l'espace est celui DU JARDIN.
--       Après livraison, cet espace est celui du client : le
--       paysagiste, qui a pourtant le droit d'écrire la LIGNE, ne
--       pouvait plus téléverser le FICHIER qu'elle désigne. Les deux
--       moitiés du même geste ne disaient plus la même chose.
--       Le second segment nomme déjà le jardin ; il suffit de le
--       laisser parler, en exigeant que le premier segment soit bien
--       l'espace de ce jardin — sinon on pourrait déposer un fichier
--       dans le dossier d'un tiers.
--       On ne retombe SURTOUT PAS sur `is_workspace_member` du second
--       segment : ce serait rendre au chemin l'autorité que le §2 vient
--       de lui retirer.
create or replace function public.garden_plan_file_access(
  p_name text,
  p_write boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- (a) Une ligne réclame ce fichier : elle décide, et elle seule.
    when exists (
      select 1 from public.garden_plan_images i where i.storage_path = p_name
    ) then exists (
      select 1 from public.garden_plan_images i
      where i.storage_path = p_name
        and (
          public.is_workspace_member(i.workspace_id)
          or (case when p_write
                then public.can_edit_garden(i.garden_id)
                else public.has_garden_access(i.garden_id) end)
        )
    )
    -- (b) et (c). Le `~` évite qu'un nom de fichier mal formé ne fasse
    -- échouer le transtypage — et donc toute la politique — par une
    -- erreur.
    when p_name ~ '^[0-9a-fA-F-]{36}/' then
      public.is_workspace_member(((storage.foldername(p_name))[1])::uuid)
      or (
        p_name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/'
        and exists (
          select 1 from public.gardens g
          where g.id = ((storage.foldername(p_name))[2])::uuid
            and g.workspace_id = ((storage.foldername(p_name))[1])::uuid
            and public.can_edit_garden(g.id)
        )
      )
    else false
  end;
$$;

comment on function public.garden_plan_file_access(text, boolean) is
  'Qui peut toucher un fichier du bucket garden-plans. La ligne garden_plan_images décide quand elle existe — elle suit le jardin ; sinon le chemin décide, et son second segment nomme le jardin, ce qui laisse le paysagiste téléverser dans un jardin livré (0086).';

drop policy if exists "Workspace members read garden plans" on storage.objects;
drop policy if exists "Workspace members write garden plans" on storage.objects;
drop policy if exists "Workspace members delete garden plans" on storage.objects;
drop policy if exists "Garden plan files are read by the garden" on storage.objects;
drop policy if exists "Garden plan files are written by the garden" on storage.objects;
drop policy if exists "Garden plan files are deleted by the garden" on storage.objects;

create policy "Garden plan files are read by the garden" on storage.objects
  for select using (
    bucket_id = 'garden-plans' and public.garden_plan_file_access(name, false)
  );

create policy "Garden plan files are written by the garden" on storage.objects
  for insert with check (
    bucket_id = 'garden-plans' and public.garden_plan_file_access(name, true)
  );

create policy "Garden plan files are deleted by the garden" on storage.objects
  for delete using (
    bucket_id = 'garden-plans' and public.garden_plan_file_access(name, true)
  );

-- L'index qui porte ce prédicat est l'index UNIQUE du §2 bis : sans
-- lui, chaque objet du bucket balayerait la table — et n'importe qui
-- pourrait réclamer le fichier d'un autre.

-- ============================================================
-- 3. UNE ESCALADE LATENTE, FERMÉE AU PASSAGE
-- ============================================================
-- La politique d'écriture de `garden_access` n'a jamais contraint le
-- RÔLE de la ligne écrite. Un professionnel avec `clients.write`
-- pouvait donc, AVANT de livrer, se poser lui-même une ligne
-- `role = 'owner'` sur le jardin de son organisation. Après livraison,
-- `deliver_garden_to_client` fait bien du client un `owner`, mais elle
-- ne retire pas celle du professionnel : il reste co-propriétaire à
-- vie, et `revoke_garden_access` — réservée au propriétaire — lui
-- permet alors de révoquer son propre client.
--
-- Le défaut est antérieur à ce chantier. Il devient dangereux
-- maintenant, parce qu'une ligne `garden_access` ouvre désormais dix
-- tables de plus. Une organisation n'a jamais besoin de nommer un
-- `owner` : la seule fabrique légitime d'un propriétaire est
-- `deliver_garden_to_client`, en `security definer`, qui ne passe pas
-- par cette politique.
-- SECONDE ESCALADE, PLUS DISCRÈTE : LA PORTE DÉROBÉE POSÉE D'AVANCE.
-- Le §1.1 ouvre le jardin dès qu'il existe UNE ligne `garden_access`
-- non révoquée portant un `organization_id` — quel que soit son
-- `user_id`. Or `garden_in_organization` est encore vrai AVANT la
-- livraison : un professionnel avec `clients.write` pouvait donc, la
-- veille, inscrire un ou plusieurs COLLÈGUES avec l'organisation.
-- Après livraison, le propriétaire retire l'accès « du professionnel »
-- qu'il voit dans son portail ; les lignes oubliées continuent d'ouvrir
-- le jardin à toute l'entreprise, et rouvrent même la soupape du retour
-- arrière. Mesuré.
--
-- Deux verrous, ici et au §6 :
--   • ici, `user_id = auth.uid()` — par cette porte on ne gère QUE son
--     propre accès. Inscrire ses collègues n'a plus aucune raison
--     d'être depuis le §1.1 : une seule ligne ouvre le jardin à toute
--     l'équipe. Aucun écran du produit n'écrit cette table (vérifié :
--     web-pro ne fait que la LIRE, et `deliver_garden_to_client` est en
--     `security definer`, elle ne passe pas par cette politique).
--   • au §6, la révocation CASCADE sur l'organisation entière, pour que
--     la ligne oubliée d'hier n'ait pas le dernier mot.
drop policy if exists "Owners and pros manage garden access" on public.garden_access;
create policy "Owners and pros manage garden access" on public.garden_access
  for all using (
    public.is_garden_owner(garden_id)
    or (
      organization_id is not null
      and user_id = auth.uid()
      and role <> 'owner'
      and public.has_permission(organization_id, 'clients.write')
      and public.garden_in_organization(garden_id, organization_id)
    )
  )
  with check (
    public.is_garden_owner(garden_id)
    or (
      organization_id is not null
      and user_id = auth.uid()
      and role <> 'owner'
      and public.has_permission(organization_id, 'clients.write')
      and public.garden_in_organization(garden_id, organization_id)
    )
  );

-- `garden_in_organization` N'EST PAS ÉLARGIE, et c'est un refus motivé.
-- Elle devient fausse dès que le jardin est livré, ce qui interdit à
-- l'entreprise de toucher aux accès de ce jardin — y compris pour
-- annuler une révocation que le propriétaire vient de poser. C'était
-- tout le propos du correctif 0062 : « une révocation qu'on pourrait
-- défaire soi-même n'est pas une révocation ». La cartographie
-- proposait de l'élargir pour que l'entreprise puisse ajouter un second
-- intervenant ; ce n'est plus nécessaire — le §1.1 ouvre le jardin à
-- TOUS les membres autorisés sans qu'aucune ligne nouvelle soit écrite.

-- ============================================================
-- 4. LA TRACE DES LIVRAISONS
-- ============================================================
-- Une livraison change le propriétaire de vingt familles de données.
-- Sans trace, une erreur de client est irréparable : on ne sait même
-- plus d'où le jardin venait.
--
-- La table ne s'écrit que par les deux fonctions `security definer`
-- ci-dessous — d'où l'absence de toute politique d'écriture. C'est le
-- même parti que `business_organizations` : pas de politique d'insert,
-- donc pas de porte.
-- AUCUNE DE SES CLÉS N'EST UN VERROU, ET AUCUNE N'EFFACE LA TRACE.
-- C'est la leçon de deux défauts jumeaux, tous deux mesurés :
--
--   • `references workspaces (id)` SANS action de suppression aurait
--     verrouillé les deux espaces dès la première livraison — et, par
--     la cascade `auth.users → workspaces`, la suppression du compte
--     propriétaire avec eux. Ce sont les deux seules clés du produit
--     vers `workspaces`, sur cinquante-deux, à ne pas dire ce qu'elles
--     font en cas de suppression : l'oubli était visible.
--
--   • `on delete cascade` sur le jardin aurait fait disparaître la
--     trace AVEC l'objet qu'elle trace — c'est-à-dire au seul moment où
--     elle sert : « à qui ce jardin avait-il été livré, avant que le
--     compte du client ne soit supprimé ? »
--
-- Donc `on delete set null` PARTOUT, colonnes nullables, et les
-- libellés recopiés à l'écriture. §26 dit « ne jamais supprimer » : un
-- journal qui s'efface tout seul ne respecte pas cette règle, et un
-- journal qui empêche de supprimer un compte la respecte trop.
create table if not exists public.garden_deliveries (
  id uuid primary key default gen_random_uuid(),
  garden_id uuid references public.gardens (id) on delete set null,
  organization_id uuid references public.business_organizations (id) on delete set null,
  customer_id uuid references public.crm_customers (id) on delete set null,
  client_user_id uuid references auth.users (id) on delete set null,

  from_workspace_id uuid references public.workspaces (id) on delete set null,
  to_workspace_id uuid references public.workspaces (id) on delete set null,

  -- Les identifiants ne suffisent plus à relire le journal une fois les
  -- lignes d'origine supprimées : on recopie ce qu'il faut pour que la
  -- trace reste LISIBLE, et pas seulement présente.
  garden_name text,
  customer_name text,

  delivered_by uuid references auth.users (id) on delete set null,
  delivered_at timestamptz not null default now(),
  reverted_by uuid references auth.users (id) on delete set null,
  reverted_at timestamptz
);

-- Rejouable sur une base où la table existerait déjà dans sa forme
-- première. `if not exists` ne modifie pas une table existante : sans ce
-- bloc, une base ayant reçu une version antérieure de 0086 garderait
-- ses verrous. Chaque contrainte est reposée dans sa forme voulue,
-- jamais supprimée sans être remplacée.
do $$
declare r record;
begin
  alter table public.garden_deliveries add column if not exists garden_name text;
  alter table public.garden_deliveries add column if not exists customer_name text;

  for r in
    select * from (values
      ('garden_id',        'public.gardens (id)'),
      ('organization_id',  'public.business_organizations (id)'),
      ('customer_id',      'public.crm_customers (id)'),
      ('client_user_id',   'auth.users (id)'),
      ('from_workspace_id','public.workspaces (id)'),
      ('to_workspace_id',  'public.workspaces (id)')
    ) as v(col, cible)
  loop
    execute format('alter table public.garden_deliveries alter column %I drop not null', r.col);
    execute format(
      'alter table public.garden_deliveries drop constraint if exists garden_deliveries_%s_fkey', r.col);
    execute format(
      'alter table public.garden_deliveries add constraint garden_deliveries_%s_fkey
         foreign key (%I) references %s on delete set null', r.col, r.col, r.cible);
  end loop;
end $$;

create index if not exists garden_deliveries_garden_idx
  on public.garden_deliveries (garden_id) where reverted_at is null;

alter table public.garden_deliveries enable row level security;

drop policy if exists "Owner and delivering organization read deliveries"
  on public.garden_deliveries;
create policy "Owner and delivering organization read deliveries"
  on public.garden_deliveries
  for select using (
    public.is_garden_owner(garden_id)
    or public.has_permission(organization_id, 'clients.read')
  );

comment on table public.garden_deliveries is
  'Journal des livraisons de jardin. Sert au retour arrière et à la traçabilité : sans elle, une livraison au mauvais client est irréparable (0086).';


-- ------------------------------------------------------------
-- 4 bis  §28 — CE QUE LE CLIENT N'A PAS À VOIR
-- ------------------------------------------------------------
-- `digital_twin_revisions` est le journal de travail du paysagiste sur
-- le jardin : chaque enregistrement porte un `state` (existing,
-- proposal, approved, asBuilt), un `notes` en texte libre, et il peut
-- être archivé. La paire posée ci-dessus l'ouvrirait TELLE QUELLE au
-- client — propositions non retenues et notes internes comprises.
--
-- Aucune donnée financière n'y transite, c'est vérifié colonne par
-- colonne : ni marge, ni prix d'achat, ni taux horaire. Mais une
-- proposition écartée et le commentaire qui explique pourquoi sont le
-- travail du professionnel, pas le patrimoine du client.
--
-- L'ARBITRAGE RENDU ICI, et il est réversible en une ligne : le client
-- voit ce qui lui est destiné — `approved` et `asBuilt`, non archivé ;
-- l'entreprise qui entretient le jardin continue de voir TOUT son
-- travail, y compris après la livraison, par la branche organisation.
-- Sans cette seconde branche le paysagiste perdrait ses propres
-- brouillons le jour où il livre : le remède serait pire que le mal.
--
-- POURQUOI UNE POLITIQUE « RESTRICTIVE », LA PREMIÈRE DU PRODUIT — et
-- ce n'est pas un caprice, c'est une MESURE. J'avais d'abord écrit une
-- politique de lecture permissive plus étroite : elle n'a rien restreint
-- du tout, et le test l'a nommé. La raison est mécanique : après la
-- livraison, la ligne vit dans l'espace du CLIENT, donc la politique
-- d'espace — qui reste, et qui doit rester — la lui ouvre déjà. Des
-- politiques permissives s'ADDITIONNENT ; on ne restreint pas en en
-- ajoutant une. Il fallait donc une politique restrictive, qui se
-- multiplie à toutes les autres.
--
-- ELLE NE MORD QUE SUR UN JARDIN LIVRÉ. Tant qu'aucune livraison active
-- n'existe, la table se comporte exactement comme avant : le paysagiste
-- ne perd pas ses brouillons dans son propre espace, et rien du monde
-- particulier ne change. C'est ce que dit la dernière branche.
--
-- Aucun écran ne régresse : `digital_twin_revisions` n'est écrite et lue
-- que par `TwinEditor`, côté professionnel. Le portail client ne
-- l'affiche nulle part et l'iPhone ne la connaît pas — vérifié par
-- recherche dans web-pro et dans OasisCare. Si le dirigeant tranche
-- dans l'autre sens, il suffit de supprimer cette seule politique.
-- LE PIÈGE, ET IL S'EST REFERMÉ SUR MOI UNE FOIS : « ce jardin a-t-il
-- été livré ? » ne peut pas s'écrire en sous-requête directe dans la
-- politique. `garden_deliveries` a sa propre RLS ; un membre du foyer,
-- qui n'a le droit de voir aucune livraison, lisait donc « aucune
-- livraison » et la restriction se levait pour lui. Il faut donc une
-- fonction `security definer` — laissée exécutable, comme les cinq
-- localisateurs et pour les mêmes deux raisons mesurées au §1.3.
create or replace function public.garden_is_delivered(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garden_deliveries d
    where d.garden_id = p_garden_id and d.reverted_at is null
  );
$$;

comment on function public.garden_is_delivered(uuid) is
  'Ce jardin est-il actuellement livré à un particulier ? Sans RLS, parce que la question se pose dans une politique et que garden_deliveries en a une (0086).';

drop policy if exists "Internal revisions stay with the professional"
  on public.digital_twin_revisions;
create policy "Internal revisions stay with the professional"
  on public.digital_twin_revisions
  as restrictive
  for select using (
    (state in ('approved', 'asBuilt') and archived_at is null)
    or public.garden_access_by_organization(garden_id, 'clients.read')
    or not public.garden_is_delivered(garden_id)
  );

comment on column public.digital_twin_revisions.notes is
  'Notes de la révision. ATTENTION : visibles par le client dès que la révision passe en approved/asBuilt sur un jardin livré (0086, §28).';


-- Les seize tables, en un seul endroit. Les écrire deux fois — à la
-- livraison et au retour — c'était garantir qu'un jour l'une des deux
-- listes en oublierait une.
create or replace function public.move_garden_children(
  p_garden_id uuid,
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Les cinq tables du plan (déjà déplacées depuis 0055).
  update public.garden_areas       set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.garden_map_objects set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.garden_boundaries  set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.irrigation_pipes   set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.garden_cables      set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;

  -- LES DIX QUI RESTAIENT DERRIÈRE.
  update public.plants             set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.sensors            set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.connected_devices  set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.irrigation_zones   set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.greenhouses        set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.ponds              set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.scenes             set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.garden_checkups    set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  update public.garden_plan_images set workspace_id = p_workspace_id, updated_at = now() where garden_id = p_garden_id;
  -- `digital_twin_revisions` n'a pas de colonne `updated_at`.
  update public.digital_twin_revisions set workspace_id = p_workspace_id where garden_id = p_garden_id;

  -- Les enfants indirects (photos, soins, relevés, actions de scène,
  -- lignes de bilan) ne portent PAS de `workspace_id` : ils suivent
  -- leur parent par jointure. Rien à déplacer, et c'est vérifié — les
  -- quinze tables ci-dessus sont exactement celles qui portent les deux
  -- colonnes, mesuré sur `information_schema`.
end;
$$;

comment on function public.move_garden_children(uuid, uuid) is
  'Déplace les quinze tables enfants d''un jardin vers un espace de travail. Une seule liste, partagée par la livraison et le retour arrière (0086).';

-- ELLE EST FERMÉE DE L'EXTÉRIEUR, ET IL LE FAUT. Postgres accorde
-- `execute` à `public` sur toute fonction créée : laissée ouverte, une
-- fonction `security definer` qui écrit dans quinze tables se
-- retournerait en un appel unique — « déplace les enfants du jardin de
-- n'importe qui vers mon espace ». Les deux fonctions qui l'appellent
-- s'exécutent sous les droits de leur propriétaire : elles n'ont pas
-- besoin de ce `grant`.
revoke all on function public.move_garden_children(uuid, uuid) from public;
revoke all on function public.move_garden_children(uuid, uuid) from anon;
revoke all on function public.move_garden_children(uuid, uuid) from authenticated;

-- ============================================================
-- 5. LA LIVRAISON QUI EMPORTE TOUT
-- ============================================================
-- Trois corrections à la fonction de 0055 :
--
--   (1) LES SEIZE TABLES, PAS SIX. Quinze tables portent `garden_id` et
--       `workspace_id` ; toutes suivent, plus le jardin lui-même.
--
--   (2) LE CHOIX DE L'ESPACE DEVIENT DÉTERMINISTE. `where owner_id = X
--       and is_personal limit 1` SANS `order by` rendait l'un ou
--       l'autre selon l'ordre physique des lignes — un compte peut
--       porter deux espaces personnels, et la livraison partait alors
--       au hasard. C'est exactement le défaut déjà corrigé côté iPhone
--       dans `SyncEngine.fetchWorkspaceID`. Même correction ici, et
--       pour la même raison.
--
--   (3) LA TRACE. Une ligne dans `garden_deliveries`, qui rend le
--       retour arrière possible.
--
-- ELLE RESTE TRANSACTIONNELLE, ET CE N'EST PAS UNE PRÉCAUTION NOUVELLE :
-- un corps plpgsql s'exécute dans la transaction de l'appelant. Si le
-- déplacement de la dixième table échoue, les neuf autres et le jardin
-- reviennent en arrière avec elle. Une livraison à moitié faite est
-- impossible — c'est vérifié par le test, en faisant échouer
-- volontairement la dernière écriture.
--
-- ELLE NE SUPPRIME RIEN — §26. Que des `update` sur `workspace_id`.
-- `workspace_id` référence `workspaces(id)` : le changer vers un espace
-- existant ne déclenche aucune cascade. Le test compte les lignes avant
-- et après et exige l'égalité.
create or replace function public.deliver_garden_to_client(
  p_garden_id uuid,
  p_customer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  org_workspace uuid;
  garden_workspace uuid;
  client_user uuid;
  client_workspace uuid;
  pro uuid := auth.uid();
begin
  if pro is null then
    raise exception 'Connectez-vous.';
  end if;

  select organization_id into org_id from public.crm_customers where id = p_customer_id;
  if org_id is null then
    raise exception 'Client introuvable.';
  end if;

  -- CONTRÔLE 1 — l'appelant a le droit d'agir sur ce client.
  if not public.has_permission(org_id, 'clients.write') then
    raise exception 'Vous n''avez pas le droit de livrer un jardin pour ce client.';
  end if;

  select workspace_id into org_workspace from public.business_organizations where id = org_id;
  select workspace_id into garden_workspace from public.gardens where id = p_garden_id;
  if garden_workspace is null then
    raise exception 'Jardin introuvable.';
  end if;

  -- CONTRÔLE 2 — le jardin est bien celui de cette organisation. Sans
  -- lui, la permission ci-dessus suffirait à déplacer le jardin d'un
  -- tiers.
  if garden_workspace is distinct from org_workspace then
    raise exception 'Ce jardin n''appartient pas à votre organisation.';
  end if;

  -- Le premier compte invité sur cette fiche, et toujours le même :
  -- `limit 1` sans tri laissait le choix à l'ordre physique des lignes.
  select user_id into client_user from public.client_portal_access
   where customer_id = p_customer_id and revoked_at is null
   order by created_at, id limit 1;
  if client_user is null then
    raise exception 'Ce client n''a pas encore de compte Oasis Care. Invitez-le d''abord.';
  end if;

  select id into client_workspace from public.workspaces
   where owner_id = client_user and is_personal
   order by created_at, id limit 1;
  if client_workspace is null then
    raise exception 'Ce client n''a pas d''espace de travail personnel.';
  end if;

  -- Les accès D'ABORD. L'ordre n'a plus la valeur de sûreté que 0055
  -- lui prêtait — la transaction s'en charge — mais il reste le bon :
  -- la ligne du professionnel porte `organization_id`, et c'est elle
  -- qui, au §1.1, ouvre le jardin à toute son équipe. L'écrire avant le
  -- déplacement évite que la lecture qui suit ne tombe dans le vide.
  insert into public.garden_access (garden_id, user_id, role, granted_by)
  values (p_garden_id, client_user, 'owner', pro)
  on conflict (garden_id, user_id) do update
    set role = 'owner', revoked_at = null;

  insert into public.garden_access (garden_id, user_id, role, organization_id, granted_by)
  values (p_garden_id, pro, 'professional', org_id, pro)
  on conflict (garden_id, user_id) do update
    set role = 'professional', organization_id = org_id, revoked_at = null;

  insert into public.garden_deliveries (
    garden_id, organization_id, customer_id, client_user_id,
    from_workspace_id, to_workspace_id, delivered_by,
    garden_name, customer_name
  ) values (
    p_garden_id, org_id, p_customer_id, client_user,
    garden_workspace, client_workspace, pro,
    (select name from public.gardens where id = p_garden_id),
    (select display_name from public.crm_customers where id = p_customer_id)
  );

  -- LE JARDIN D'ABORD, ses enfants ensuite : le déclencheur
  -- `enforce_garden_child_workspace` lit l'espace du PARENT pour recaler
  -- l'enfant. Dans l'autre ordre, il recalerait chaque enfant sur
  -- l'ancien espace et annulerait le déplacement, ligne par ligne, sans
  -- rien signaler.
  update public.gardens
     set workspace_id = client_workspace, updated_at = now()
   where id = p_garden_id;

  perform public.move_garden_children(p_garden_id, client_workspace);

  return client_user;
end;
$$;


-- ============================================================
-- 6. LE RETOUR ARRIÈRE
-- ============================================================
-- « Que se passe-t-il si le paysagiste s'est trompé de client ? »
-- Jusqu'ici : rien. Aucune fonction de retour n'existait, et
-- `revoke_garden_access` ne fait que poser un `revoked_at` — elle ne
-- ramène pas le jardin.
--
-- QUI A LE DROIT. Pas le client : dans le scénario qui compte, c'est
-- LUI l'erreur, et il n'a aucune raison de coopérer. C'est donc
-- l'organisation qui a livré, à trois conditions cumulatives :
--   • une livraison non annulée existe dans `garden_deliveries` ;
--   • l'appelant a `clients.write` dans l'organisation qui a livré ;
--   • cette organisation est ENCORE autorisée sur le jardin.
--
-- La troisième condition est la soupape, et c'est elle qui rend
-- l'ensemble acceptable : si le propriétaire a révoqué l'accès du
-- professionnel, le retour est refusé — définitivement. Le client garde
-- donc le dernier mot, exactement comme §"Le propriétaire peut retirer
-- l'accès du professionnel" l'exige.
--
-- CE QUI RESTE COMME RISQUE, et il faut le dire : tant que le client
-- n'a rien révoqué, l'entreprise peut reprendre un jardin que le client
-- a enrichi entre-temps. Rien n'est perdu — les lignes changent
-- d'espace, elles ne sont pas supprimées, et la trace dit qui a fait
-- quoi et quand — mais le client cesse de les voir. Une garantie plus
-- forte (fenêtre de quelques heures, accord du client) demanderait un
-- écran ; elle est notée au compte rendu, pas décidée ici.
create or replace function public.revert_garden_delivery(p_garden_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.garden_deliveries%rowtype;
  garden_workspace uuid;
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Connectez-vous.';
  end if;

  select * into d from public.garden_deliveries
   where garden_id = p_garden_id and reverted_at is null
   order by delivered_at desc, id desc limit 1;
  if d.id is null then
    raise exception 'Ce jardin n''a pas de livraison à annuler.';
  end if;

  -- Le journal survit à la suppression des lignes qu'il désigne (§4) :
  -- il peut donc décrire une livraison dont l'espace d'origine ou
  -- l'organisation n'existent plus. On refuse plutôt que de deviner où
  -- ramener le jardin.
  if d.organization_id is null or d.from_workspace_id is null then
    raise exception 'Cette livraison ne peut plus être annulée : son point de départ n''existe plus.';
  end if;

  if not public.has_permission(d.organization_id, 'clients.write') then
    raise exception 'Vous n''avez pas le droit d''annuler cette livraison.';
  end if;

  -- La soupape : le propriétaire a-t-il déjà mis l'entreprise dehors ?
  if not exists (
    select 1 from public.garden_access
    where garden_id = p_garden_id
      and organization_id = d.organization_id
      and revoked_at is null
  ) then
    raise exception 'Le propriétaire a retiré l''accès de votre organisation : la livraison ne peut plus être annulée.';
  end if;

  -- Le jardin a-t-il bougé depuis ? Si oui, quelque chose d'autre est
  -- passé par là et on ne sait plus ce qu'on défait. On refuse plutôt
  -- que de deviner.
  select workspace_id into garden_workspace from public.gardens where id = p_garden_id;
  if garden_workspace is distinct from d.to_workspace_id then
    raise exception 'Ce jardin a changé d''espace depuis la livraison : annulation impossible.';
  end if;

  update public.gardens
     set workspace_id = d.from_workspace_id, updated_at = now()
   where id = p_garden_id;

  perform public.move_garden_children(p_garden_id, d.from_workspace_id);

  -- Le client cesse de voir le jardin. RÉVOQUÉ, PAS SUPPRIMÉ — §26, et
  -- parce que la ligne est la preuve qu'il l'a eu.
  update public.garden_access
     set revoked_at = now()
   where garden_id = p_garden_id
     and user_id = d.client_user_id
     and revoked_at is null;

  update public.garden_deliveries
     set reverted_at = now(), reverted_by = actor
   where id = d.id;
end;
$$;

comment on function public.revert_garden_delivery(uuid) is
  'Annule une livraison de jardin : tout revient dans l''espace de l''organisation, l''accès du client est révoqué (jamais supprimé). Refusé si le propriétaire a déjà retiré l''accès de l''organisation (0086).';

-- ============================================================
-- 6 bis. ON RÉVOQUE UNE ENTREPRISE, PAS UN NOM
-- ============================================================
-- LE DÉFAUT, ET IL ANNULE À LUI SEUL LA PROMESSE DU §1.1. Le pont
-- s'ouvre par ORGANISATION : une ligne `garden_access` non révoquée
-- portant un `organization_id` suffit, quel que soit le salarié dont
-- elle porte le nom. Mais `revoke_garden_access`, la seule fonction de
-- révocation du produit, ne révoque QU'UN utilisateur.
--
-- Le propriétaire retire donc l'accès « du professionnel » qu'il voit
-- dans son portail, et l'entreprise entière continue de lire ET
-- d'écrire tout le contenu de son jardin — le professionnel révoqué
-- compris, puisque c'est son organisation, pas son nom, qui lui ouvre
-- la porte. La même ligne oubliée rouvre la soupape du §6 : l'entreprise
-- peut reprendre le jardin malgré la révocation.
--
-- CE QUI S'OUVRE PAR L'ORGANISATION SE FERME PAR L'ORGANISATION. Deux
-- gestes, pas un :
--
--   • `revoke_garden_access` CASCADE. Quand la ligne visée porte une
--     organisation, toutes les lignes de ce jardin portant la même
--     organisation sont révoquées dans la même transaction. Le
--     propriétaire fait le geste qu'il comprend — « je retire l'accès
--     de mon paysagiste » — et il obtient l'effet qu'il attend.
--
--   • `revoke_organization_garden_access` pour le dire directement,
--     quand l'écran voudra proposer « retirer l'accès de l'entreprise »
--     plutôt que celui d'une personne.
--
-- `revoked_at is null` est ajouté au filtre : sans lui, une seconde
-- révocation réécrivait la date de la première et effaçait la date à
-- laquelle l'accès avait réellement cessé.
create or replace function public.revoke_garden_access(
  p_garden_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  org uuid;
begin
  if not public.is_garden_owner(p_garden_id) then
    raise exception 'Seul le propriétaire du jardin peut retirer un accès.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre accès de propriétaire.';
  end if;

  -- L'organisation portée par la ligne visée, s'il y en a une.
  -- `garden_access` est unique par (garden_id, user_id) : au plus une.
  select organization_id into org
    from public.garden_access
   where garden_id = p_garden_id and user_id = p_user_id;

  update public.garden_access
     set revoked_at = now()
   where garden_id = p_garden_id
     and user_id = p_user_id
     and revoked_at is null;

  if org is not null then
    update public.garden_access
       set revoked_at = now()
     where garden_id = p_garden_id
       and organization_id = org
       and revoked_at is null;
  end if;
end;
$$;

comment on function public.revoke_garden_access(uuid, uuid) is
  'Retire un accès à un jardin. Si la ligne visée porte une organisation, TOUTE l''organisation sort — c''est elle qui ouvrait la porte, c''est elle qu''on ferme (0086).';

create or replace function public.revoke_organization_garden_access(
  p_garden_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not public.is_garden_owner(p_garden_id) then
    raise exception 'Seul le propriétaire du jardin peut retirer un accès.';
  end if;

  update public.garden_access
     set revoked_at = now()
   where garden_id = p_garden_id
     and organization_id = p_organization_id
     and revoked_at is null;
end;
$$;

comment on function public.revoke_organization_garden_access(uuid, uuid) is
  'Le propriétaire retire l''accès d''une ENTREPRISE entière à son jardin, en un seul geste (0086).';

-- ============================================================
-- 7. LE SENS INVERSE — LE PROPRIÉTAIRE QUI N'EN ÉTAIT PAS UN
-- ============================================================
-- Un jardin créé par un particulier depuis son iPhone ne reçoit AUCUNE
-- ligne `garden_access`. Son propriétaire réel n'est donc pas reconnu
-- comme `owner` : il voit tout — par appartenance à son espace — mais
-- il ne peut ni inviter son conjoint, ni retirer l'accès d'un
-- professionnel. §"Le propriétaire peut retirer l'accès du
-- professionnel" était littéralement inapplicable.
--
-- POURQUOI SEULEMENT LES ESPACES PERSONNELS : dans un espace
-- d'entreprise, le jardin est à l'entreprise, pas à une personne. Y
-- nommer un `owner` donnerait à un salarié le pouvoir d'exclure ses
-- collègues du jardin de sa propre société.
--
-- POURQUOI `workspaces.owner_id` ET NON `auth.uid()` : la même règle
-- doit valoir pour les jardins déjà en base, où il n'y a aucun appelant
-- à interroger. Une seule définition du propriétaire, donc un seul
-- endroit où se tromper.
create or replace function public.grant_owner_access_to_garden()
returns trigger
language plpgsql
security definer   -- sinon la politique de `garden_access` refuse la
                   -- ligne : `is_garden_owner` est faux tant qu'elle
                   -- n'existe pas, et l'insertion se mordrait la queue.
set search_path = public
as $$
declare
  w record;
begin
  select owner_id, is_personal into w from public.workspaces where id = new.workspace_id;
  if w.is_personal then
    insert into public.garden_access (garden_id, user_id, role, granted_by)
    values (new.id, w.owner_id, 'owner', w.owner_id)
    on conflict (garden_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_garden_owner_access on public.gardens;
create trigger trg_garden_owner_access
  after insert on public.gardens
  for each row execute function public.grant_owner_access_to_garden();

-- Le rattrapage. Sans lui, la correction ne vaudrait que pour l'avenir
-- et laisserait les jardins d'aujourd'hui dans un état bâtard.
insert into public.garden_access (garden_id, user_id, role, granted_by)
select g.id, w.owner_id, 'owner', w.owner_id
from public.gardens g
join public.workspaces w on w.id = g.workspace_id
where w.is_personal
on conflict (garden_id, user_id) do nothing;

-- ============================================================
-- 8. L'INVARIANT ENFIN COMPLET
-- ============================================================
-- « Un enfant appartient à l'espace de son jardin. » Le déclencheur
-- `enforce_garden_child_workspace` l'applique depuis 0046, mais sur
-- SEPT tables seulement. Les huit autres n'avaient rien — c'est
-- pourquoi rien ne rattrapait la livraison sur les plantes.
--
-- ET C'EST AUSSI LE SEUL CORRECTIF QUE LA BASE PEUT APPORTER AU DÉFAUT
-- 3. L'iPhone estampille tout ce qu'il envoie du premier espace
-- PERSONNEL du compte (`SyncEngine.fetchWorkspaceID`). Une plante
-- ajoutée depuis le téléphone dans un jardin livré partait donc dans
-- l'espace privé du téléphone, où personne d'autre ne la verrait
-- jamais. Avec ce déclencheur, elle est recalée sur l'espace de son
-- jardin — sans une ligne de Swift.
--
-- Il ne fait rien quand `garden_id` est nul : une plante d'intérieur,
-- une culture BioLab, un équipement de pépinière ne sont pas concernés.
-- Le reste du défaut 3 — BioLab dans l'espace privé du professionnel —
-- ne se corrige pas ici : il n'y a pas de jardin pour dire où la ligne
-- devrait aller. Il est porté au compte rendu.
--
-- ------------------------------------------------------------
-- 8.0  MAIS IL NE RECALAIT RIEN, ET IL NE REFUSAIT RIEN
-- ------------------------------------------------------------
-- LE DÉFAUT, MESURÉ : les dix-neuf politiques du §1.4 ouvrent la
-- LECTURE par `garden_id`. Or rien ne contrôlait qui avait le droit
-- d'ÉCRIRE un `garden_id` : il suffisait de donner SON PROPRE espace
-- en `workspace_id` pour que la politique d'espace accepte la ligne, et
-- le `garden_id` du jardin d'autrui passait avec elle. Un tiers sans
-- aucun lien déposait ainsi une plante dans le jardin privé de
-- quelqu'un — et depuis le §1.4, la victime la VOIT dans son jardin.
--
-- Le garde-fou attendu ne rattrapait rien : `enforce_garden_child_workspace`
-- n'était PAS `security definer`. Il lisait `gardens` sous les droits de
-- l'appelant, donc RLS lui rendait NULL quand le jardin était invisible,
-- et son corps enchaînait « si l'espace du parent n'est pas nul… ». Il
-- ne recalait pas, et surtout il ne refusait pas. Autrement dit il ne
-- s'appliquait qu'aux appelants qui n'en avaient pas besoin.
--
-- DEUX CORRECTIONS, ET LA SECONDE EST LE VRAI SUJET :
--   • `security definer` : il voit le jardin même quand l'appelant ne
--     le voit pas — c'est ce qui rend enfin vrai le recalage que ce §8
--     revendique pour le défaut 3.
--   • il LÈVE au lieu d'ignorer, quand l'écrivain n'a aucun droit sur
--     le jardin qu'il désigne. Un refus explicite vaut mieux qu'une
--     ligne silencieusement rangée ailleurs.
--
-- POURQUOI LE REFUS NE S'APPLIQUE PAS QUAND `auth.uid()` EST NUL : les
-- migrations, les fonctions `security definer` du serveur et les tâches
-- d'administration écrivent sans utilisateur. Leur imposer un droit
-- qu'aucun compte ne porte ferait échouer le rattrapage de ce §8
-- lui-même. Ce n'est pas une porte : sans JWT on est déjà `postgres` ou
-- `service_role`, qui ne passent pas par RLS de toute façon.
create or replace function public.enforce_garden_child_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_workspace uuid;
begin
  if new.garden_id is null then
    return new;
  end if;

  select workspace_id into parent_workspace
    from public.gardens where id = new.garden_id;

  -- Jardin inexistant : la clé étrangère tranchera, pas nous.
  if parent_workspace is null then
    return new;
  end if;

  if auth.uid() is not null
     and not public.is_workspace_member(parent_workspace)
     and not public.can_edit_garden(new.garden_id) then
    raise exception 'Vous ne pouvez pas rattacher cette ligne à ce jardin.'
      using errcode = '42501';
  end if;

  if new.workspace_id is distinct from parent_workspace then
    new.workspace_id := parent_workspace;
  end if;

  return new;
end;
$$;

comment on function public.enforce_garden_child_workspace() is
  'Un enfant appartient à l''espace de son jardin — et on ne dépose pas une ligne dans le jardin d''autrui. Security definer depuis 0086 : sans cela il ne voyait pas le jardin qu''il devait protéger.';

do $$
declare t text;
begin
  foreach t in array array[
    'plants', 'sensors', 'connected_devices', 'irrigation_zones',
    'greenhouses', 'ponds', 'scenes', 'garden_checkups'
  ]
  loop
    execute format('drop trigger if exists trg_workspace on public.%I', t);
    execute format(
      'create trigger trg_workspace before insert or update on public.%I
         for each row execute function public.enforce_garden_child_workspace()', t);
  end loop;
end $$;

-- Le recalage des lignes déjà en base. Zéro ligne concernée aujourd'hui
-- — mesuré — mais si une livraison avait lieu entre l'écriture de cette
-- migration et son application, les dix tables seraient restées
-- derrière et il faudrait bien les ramener. C'est un `update`, pas une
-- suppression : aucune ligne ne disparaît.
update public.plants p            set workspace_id = g.workspace_id from public.gardens g where g.id = p.garden_id and p.workspace_id is distinct from g.workspace_id;
update public.sensors s           set workspace_id = g.workspace_id from public.gardens g where g.id = s.garden_id and s.workspace_id is distinct from g.workspace_id;
update public.connected_devices d set workspace_id = g.workspace_id from public.gardens g where g.id = d.garden_id and d.workspace_id is distinct from g.workspace_id;
update public.irrigation_zones z  set workspace_id = g.workspace_id from public.gardens g where g.id = z.garden_id and z.workspace_id is distinct from g.workspace_id;
update public.greenhouses h       set workspace_id = g.workspace_id from public.gardens g where g.id = h.garden_id and h.workspace_id is distinct from g.workspace_id;
update public.ponds b             set workspace_id = g.workspace_id from public.gardens g where g.id = b.garden_id and b.workspace_id is distinct from g.workspace_id;
update public.scenes c            set workspace_id = g.workspace_id from public.gardens g where g.id = c.garden_id and c.workspace_id is distinct from g.workspace_id;
update public.garden_checkups k   set workspace_id = g.workspace_id from public.gardens g where g.id = k.garden_id and k.workspace_id is distinct from g.workspace_id;
update public.garden_plan_images i set workspace_id = g.workspace_id from public.gardens g where g.id = i.garden_id and i.workspace_id is distinct from g.workspace_id;
update public.digital_twin_revisions r set workspace_id = g.workspace_id from public.gardens g where g.id = r.garden_id and r.workspace_id is distinct from g.workspace_id;

-- ============================================================
-- 9. LE SALARIÉ QUI PART ET QUI RESTE
-- ============================================================
-- LE DÉFAUT, MESURÉ. Le produit « retire » un salarié en posant
-- `archived_at` sur `organization_members` (web-pro, §14 « Désactiver
-- accès ») et NE TOUCHE JAMAIS à `workspace_members`. `has_permission`
-- cesse bien de répondre — le pont du §1.1 se referme donc correctement
-- sur les jardins livrés — mais `is_workspace_member`, qui garde
-- cinquante-sept tables en `cmd = ALL`, ne sait rien de l'archivage.
--
-- L'ex-salarié continue donc de LIRE ET D'ÉCRIRE tous les chantiers non
-- livrés de son ancienne entreprise, leurs plantes, leurs capteurs, et
-- les vingt et une tables BioLab de l'espace. « Un salarié révoqué
-- voit-il encore quelque chose ? » — oui : presque tout.
--
-- LE DÉFAUT EST ANTÉRIEUR À CE CHANTIER, et sa correction complète a
-- deux moitiés dont une seule m'appartient :
--   • côté web-pro (hors de mon périmètre d'écriture) : que
--     `setMemberAccess` retire aussi la ligne `workspace_members`, en
--     pendant exact de `accept_organization_invitation` qui écrit bien
--     les deux tables. Porté au compte rendu.
--   • ici, LA CEINTURE : `is_workspace_member` refuse un membre archivé
--     de l'organisation qui POSSÈDE cet espace.
--
-- POURQUOI JE LA POSE MALGRÉ LE RISQUE. Cette fonction porte
-- cinquante-sept politiques : une erreur ici met tout le monde dehors,
-- et c'est la raison pour laquelle on hésite à y toucher. Trois choses
-- rendent la retouche tenable :
--   • le prédicat ajouté est FERMÉ SUR LUI-MÊME — il ne peut refuser
--     que quelqu'un ayant une ligne `organization_members` ARCHIVÉE
--     dans l'organisation propriétaire de CET espace. Un espace
--     personnel n'a pas d'organisation : rien ne change pour lui, et
--     c'est la totalité du monde particulier.
--   • la production ne compte AUCUN membre archivé aujourd'hui —
--     mesuré : `archived_at is not null` rend zéro ligne. Personne ne
--     peut donc être mis dehors par cette ligne au moment où elle est
--     posée.
--   • la matrice d'accès la mesure, avant et après, avec un acteur
--     archivé exprès (`Ex` dans `frontiere.sql`).
--
-- `business_organizations` porte `unique (workspace_id)` : au plus une
-- organisation par espace, donc au plus une ligne à examiner.
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  )
  and not exists (
    select 1
    from public.business_organizations o
    join public.organization_members m
      on m.organization_id = o.id
     and m.user_id = auth.uid()
    where o.workspace_id = ws_id
      and m.archived_at is not null
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'Appartenance à un espace de travail. Un membre ARCHIVÉ de l''organisation propriétaire de l''espace n''en est plus membre : sans cela, désactiver un salarié ne lui retirait rien (0086).';
