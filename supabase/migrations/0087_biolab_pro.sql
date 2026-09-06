-- Oasis Care — migration 0087 : BIOLAB PRO, LE CÔTÉ BASE.
--
-- Idempotente. Aucune suppression de donnée — §26. Le seul mouvement de
-- lignes qu'elle contient est un `update` de `workspace_id`, commandé
-- explicitement par le propriétaire des lignes, tracé, et réversible.
--
-- ============================================================
-- CE QUE CETTE MIGRATION N'EST PAS
-- ============================================================
--
-- Elle NE CRÉE AUCUNE TABLE DE DONNÉES BIOLAB. Le §6 est catégorique :
-- « BioLab Pro doit reprendre le même moteur fonctionnel que BioLab
-- mobile. Il ne faut pas créer deux systèmes BioLab indépendants. » Les
-- vingt et une tables existent, elles sont écrites par l'iPhone, et
-- elles restent la seule source. Rien ici ne les redouble.
--
-- Les deux seules tables neuves sont un JOURNAL — `biolab_transferts`
-- et sa table de lignes. Elles ne portent aucune donnée de laboratoire :
-- elles se souviennent de qui a déplacé quoi, pour que le déplacement
-- puisse être défait. C'est la même chose que `garden_deliveries` au
-- §4 de 0086, et pour la même raison.
--
-- Elle NE MODIFIE AUCUNE COLONNE des vingt et une tables. Aucune
-- colonne ajoutée, aucune contrainte neuve : un iPhone déjà déployé
-- écrit dedans, et une contrainte posée sous ses pieds casserait la
-- synchronisation d'un utilisateur qui n'a rien demandé.
--
-- Elle NE POSE AUCUN MOYEN DE COMMANDER UN ÉQUIPEMENT. §7 : « Le
-- contrôle direct des objets connectés ne doit PAS être disponible
-- depuis le Web. Le Web sert à la supervision. » Tout ce que le §4
-- ci-dessous ajoute est en LECTURE. Il n'existe dans ce fichier aucune
-- fonction qui écrive dans `bioreactors`, `bioreactor_programs`,
-- `bioreactor_program_versions`, `bioreactor_cycle_executions` ou
-- `bioreactor_device_bindings` — c'est vérifiable en cherchant
-- `update public.bioreactor` : il n'y en a qu'une, dans le transfert
-- d'espace, et elle ne touche que `workspace_id`.
--
-- Elle NE BRANCHE PAS L'ABONNEMENT. Aucune des 299 politiques de la
-- base ne consulte aujourd'hui un abonnement, et
-- `organization_subscriptions` compte zéro ligne : un « et abonnement
-- actif » posé ici mettrait tout le monde dehors le jour de son
-- application. Le droit au module BioLab se vérifie donc pour l'instant
-- à l'écran et à l'API, en un seul endroit (`lireModulesSouscrits`), et
-- la place est nommée au §1.4 pour le jour où il descendra en base.
--
-- ============================================================
-- LE PLAN DU FICHIER
-- ============================================================
--   1. LES PERMISSIONS — trois permissions dans le moteur existant, et
--      leur attribution explicite aux rôles concernés.
--   2. LE GARDE — quatre politiques restrictives par table, qui ne
--      mordent QUE dans un espace d'entreprise. Le monde particulier
--      est laissé strictement intact.
--   3. LA REPRISE — le laboratoire du dirigeant, saisi sur son
--      téléphone dans son espace personnel, peut enfin rejoindre
--      l'espace de son entreprise. Avec trace et retour arrière.
--   4. LES LECTURES DU WEB — les agrégats que le mobile calcule
--      aujourd'hui dans le téléphone, calculés en base une seule fois.
--   5. LA SUPERVISION DES ÉQUIPEMENTS — l'état, et sa fraîcheur.
--      Lecture seule, §7.
--
-- CE QUI RESTE VOLONTAIREMENT IMPARFAIT, écrit ici plutôt que passé
-- sous silence :
--   • aucune poussée temps réel n'existe (§4.0) ;
--   • les plantes mères ne suivent pas le transfert (§3.3) ;
--   • le droit au module n'est pas encore en RLS (§1.4).


-- ============================================================
-- 1. LES PERMISSIONS
-- ============================================================
--
-- LE DÉFAUT MESURÉ. Les vingt et une tables BioLab ont exactement une
-- politique chacune, toutes de la forme
-- `for all using (is_workspace_member(workspace_id))`. Et
-- `accept_organization_invitation` inscrit TOUT invité — y compris un
-- ouvrier — dans `workspace_members` de l'espace de l'entreprise, parce
-- que sans cela il ne verrait aucune donnée métier. Conséquence
-- mécanique : aujourd'hui, le premier ouvrier de terrain invité dans
-- une entreprise peut LIRE, MODIFIER et SUPPRIMER n'importe quel lot de
-- culture du laboratoire. Ce n'est pas une hypothèse, c'est la lecture
-- directe des politiques.
--
-- ON NE CRÉE PAS UN TROISIÈME MOTEUR DE DROITS. `has_permission` et
-- `role_permissions` sont la seule chaîne du produit qui descende
-- jusqu'à RLS ; on s'y ajoute.

-- ------------------------------------------------------------
-- 1.1 Le découpage, et pourquoi il est en trois et non en deux
-- ------------------------------------------------------------
-- Le constat proposait `biolab.read` et `biolab.write` « a minima ».
-- J'en pose une troisième, et voici la mesure qui l'impose : les
-- politiques existantes sont en `cmd = ALL`, donc quiconque peut écrire
-- peut aussi SUPPRIMER. Dans un laboratoire, effacer un lot de culture
-- efface aussi la seule trace de sa généalogie — `parent_batch_id`
-- pointe vers lui. La personne qui note une contamination à la
-- paillasse n'a aucune raison de pouvoir faire cela.
--
--   biolab.read   — consulter le laboratoire : lots, inspections,
--                   recettes, milieux, équipements, statistiques.
--   biolab.write  — saisir le quotidien : une inspection, une photo,
--                   une préparation de milieu, un comptage, une étape
--                   d'acclimatation, un nouveau lot.
--   biolab.manage — le fond : SUPPRIMER une ligne, et commander la
--                   reprise du §3.
--
-- Le découpage suit les COMMANDES SQL et non les tables : c'est le seul
-- découpage qu'une politique sait appliquer sans se tromper, et il ne
-- demande à personne de tenir à jour une liste de tables « sensibles »
-- qui divergerait au premier ajout.

-- ------------------------------------------------------------
-- 1.2 L'attribution — le piège qui a déjà mordu trois fois
-- ------------------------------------------------------------
-- UNE PERMISSION AJOUTÉE SANS ÊTRE ATTRIBUÉE N'EST PORTÉE PAR PERSONNE.
-- L'écran disparaît, et aucune erreur ne l'explique. On sème donc
-- explicitement, rôle par rôle, et le test le vérifie rôle par rôle.
--
-- `owner` et `admin` sont volontairement ABSENTS : `has_permission`
-- leur accorde tout sans seed, comme depuis 0043.
--
-- LES CHOIX, ET CE QU'ILS COÛTENT :
--   • manager, nurseryManager  → tout. Ce sont les deux rôles qui
--     répondent de la production végétale.
--   • nurseryWorker → read + write, PAS manage. C'est la personne à la
--     paillasse : elle note ce qu'elle voit et prépare les milieux ;
--     elle ne supprime pas un lot.
--   • readOnly → read seul. Le rôle « Lecture seule » existe pour lire.
--   • fieldWorker, teamLeader → RIEN, et c'est la décision principale
--     de ce paragraphe. L'ouvrier de terrain et le chef d'équipe
--     travaillent sur les chantiers ; le laboratoire in vitro n'est pas
--     leur métier, et jusqu'ici ils y avaient tous les droits.
--   • sales, designer, projectManager, accounting, orderPicker → RIEN.
--     Aucun d'eux n'entre dans un laboratoire. Le comptable en
--     particulier : le coût des milieux se lit dans la facturation, pas
--     en ouvrant les recettes.
--
-- SI LE DIRIGEANT VEUT DÉPLACER CETTE FRONTIÈRE, il n'a pas à toucher
-- ce fichier : le rôle `custom` porte une liste explicite
-- (`organization_members.custom_permissions`), et `has_permission` la
-- lit déjà.
insert into public.role_permissions (role, permission) values
  ('manager',        'biolab.read'),
  ('manager',        'biolab.write'),
  ('manager',        'biolab.manage'),
  ('nurseryManager', 'biolab.read'),
  ('nurseryManager', 'biolab.write'),
  ('nurseryManager', 'biolab.manage'),
  ('nurseryWorker',  'biolab.read'),
  ('nurseryWorker',  'biolab.write'),
  ('readOnly',       'biolab.read')
on conflict (role, permission) do nothing;

-- ------------------------------------------------------------
-- 1.3 Le garde, en une seule fonction
-- ------------------------------------------------------------
-- « Cet espace de travail appartient-il à une entreprise, et si oui,
--   ai-je la permission demandée dans cette entreprise ? »
--
-- LA BRANCHE QUI PROTÈGE LE MONDE PARTICULIER EST LA PREMIÈRE CHOSE À
-- LIRE : quand AUCUNE entreprise ne possède l'espace, la fonction rend
-- VRAI. Un particulier — et c'est aujourd'hui la totalité des données
-- BioLab de la production, l'espace personnel du dirigeant compris — ne
-- rencontre donc jamais ce garde. Il ne peut rien perdre. C'est la
-- moitié du chantier la plus facile à rater, et le test la mesure avant
-- et après.
--
-- `security definer` : elle lit `business_organizations`, qui a sa
-- propre RLS. Sans cela, un utilisateur qui n'a pas le droit de voir
-- l'organisation lirait « aucune organisation ne possède cet espace »,
-- et le garde se lèverait pour lui — exactement le piège que 0086 a
-- documenté au §4 bis sur `garden_deliveries`.
--
-- `stable` : elle sera évaluée ligne à ligne par quatre-vingt-quatre
-- politiques. `set search_path` : une fonction `definer` sans chemin
-- figé est une porte d'entrée.
--
-- ELLE RESTE EXÉCUTABLE PAR `anon` ET `authenticated`, ET C'EST MESURÉ
-- AILLEURS. Une politique RLS s'évalue avec les privilèges de CELUI QUI
-- INTERROGE. 0086 a mesuré les deux conséquences d'un `revoke` ici :
-- retiré à `authenticated`, tout le monde tombe à zéro ligne ; retiré à
-- `anon`, un visiteur non connecté reçoit une ERREUR au lieu de zéro
-- ligne. La garde est donc dans le corps, pas dans les droits.
--
-- Elle ne rend qu'un booléen : elle n'apprend à personne QUELLE
-- entreprise possède l'espace, seulement si l'appelant y a un droit —
-- ce qu'il sait déjà.
--
-- `business_organizations` porte `unique (workspace_id)` : au plus une
-- organisation par espace, donc au plus une ligne à examiner, et le
-- sous-select ne peut pas rendre deux lignes.
create or replace function public.biolab_workspace_allows(
  p_workspace_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_workspace_id is null then false
    else coalesce(
      (select public.has_permission(o.id, p_permission)
         from public.business_organizations o
        where o.workspace_id = p_workspace_id),
      -- Aucune entreprise ne possède cet espace : monde particulier,
      -- rien ne change, la politique existante décide seule.
      true)
  end;
$$;

comment on function public.biolab_workspace_allows(uuid, text) is
  'Le garde BioLab : vrai si l''espace n''appartient à aucune entreprise (le particulier ne perd rien), ou si l''appelant détient la permission demandée dans l''entreprise qui le possède (0087).';

-- `biolab_inspection_photos` est la seule des vingt et une tables à ne
-- pas porter `workspace_id` : elle pend à son inspection. Même forme
-- que les cinq localisateurs du §1.3 de 0086, `auth.uid() is not null`
-- compris — sans cette clause, la fonction répond au visiteur non
-- connecté et devient un oracle sur l'espace de n'importe quelle
-- inspection.
--
-- LA CLAUSE D'APPARTENANCE A ÉTÉ AJOUTÉE APRÈS MESURE, ET VOICI LA
-- MESURE. Avec la seule clause `auth.uid() is not null`, un compte
-- connecté quelconque — le dirigeant d'une entreprise concurrente, ou
-- un particulier n'appartenant à aucune organisation — obtenait
-- l'identifiant d'espace de l'inspection de n'importe qui à partir du
-- seul identifiant de cette inspection. La fonction ne rendait pas le
-- relevé, mais elle RATTACHAIT UN OBJET À SON PROPRIÉTAIRE, ce qui
-- suffit à qualifier un espace sans en être membre.
--
-- `is_workspace_member` ne casse aucun usage légitime : la politique
-- restrictive des photos se multiplie de toute façon à la politique
-- permissive existante, qui exige déjà l'appartenance à l'espace de
-- l'inspection parente. Un membre passe donc comme avant ; un étranger
-- obtient `null` au lieu d'un identifiant, et `biolab_workspace_allows`
-- rend alors `false` sur `null`.
create or replace function public.biolab_inspection_workspace(p_inspection_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.bioreactor_inspections
   where id = p_inspection_id
     and auth.uid() is not null
     and public.is_workspace_member(workspace_id);
$$;

comment on function public.biolab_inspection_workspace(uuid) is
  'L''espace de travail d''une inspection, sans repasser par sa RLS. Sert à la politique de ses photos, seule table BioLab sans workspace_id (0087).';

-- ------------------------------------------------------------
-- 1.4 LA PLACE DE L'ABONNEMENT — nommée, pas occupée
-- ------------------------------------------------------------
-- Le jour du « lot 4 », le droit au module descendra en base. Il ne
-- faudra PAS écrire une seconde fonction : il faudra ajouter une
-- conjonction dans `biolab_workspace_allows` ci-dessus, de la forme
--
--   and exists (select 1 from public.organization_subscription_modules m
--                where m.organization_id = o.id and m.module_key = 'biolab'
--                  and m.active)
--
-- La matrice `plan_modules` porte déjà la clé 'biolab' (business :
-- inclus ; team : optionnel à 20 €/mois). Ce qui manque n'est pas le
-- prédicat, c'est la donnée : `organization_subscriptions` compte zéro
-- ligne. Poser la conjonction aujourd'hui fermerait BioLab à la seule
-- entreprise de la production.


-- ============================================================
-- 2. LE GARDE, APPLIQUÉ AUX VINGT ET UNE TABLES
-- ============================================================
--
-- POURQUOI DES POLITIQUES RESTRICTIVES, ET C'EST LE POINT TECHNIQUE
-- CENTRAL DE CE FICHIER. Le constat proposait « une lecture ouverte par
-- biolab.read, à côté des politiques existantes, deux politiques
-- permissives se lisant en ou ». C'est vrai, et c'est précisément
-- pourquoi cela ne peut pas marcher ici : des politiques permissives
-- s'ADDITIONNENT. En ajouter une n'a jamais restreint quoi que ce soit.
-- L'ouvrier de terrain garderait tous ses droits, et l'ajout n'aurait
-- servi à rien. 0086 a fait exactement cette erreur une fois, au §4 bis,
-- et l'a corrigée de la même façon : il faut une politique RESTRICTIVE,
-- qui se multiplie à toutes les autres.
--
-- « ON N'ENLÈVE RIEN » RESTE TENU, ET C'EST VÉRIFIABLE :
--   • aucune des vingt et une politiques existantes n'est supprimée ni
--     réécrite — cherchez `drop policy` sur un nom commençant par
--     « Workspace members », il n'y en a pas ;
--   • le garde rend VRAI dès que l'espace n'appartient à aucune
--     entreprise, donc la restriction ne mord littéralement jamais dans
--     le monde particulier ;
--   • et dans une entreprise, elle ne peut mordre que sur quelqu'un qui
--     est déjà membre de l'espace : la politique permissive reste le
--     premier filtre.
--
-- QUATRE POLITIQUES PAR TABLE, ET PAS UNE SEULE `for all`. Une
-- restrictive en `for all` s'appliquerait AUSSI au `select`, et
-- exigerait donc le droit d'écrire pour avoir celui de lire. Il faut
-- donc découper par commande — c'est ce qui permet au découpage du §1.1
-- d'exister.
--
-- LE COÛT. Quatre-vingt-quatre politiques de plus, chacune appelant une
-- fonction `stable` qui fait au plus une lecture indexée sur
-- `business_organizations` (une ligne en production) suivie d'un
-- `has_permission`. Sur un espace personnel, la fonction sort au
-- premier `select` qui ne rend rien. Le surcoût réel se mesurera le
-- jour où un laboratoire d'entreprise aura des dizaines de milliers de
-- lignes ; il est nul aujourd'hui.

-- La liste, en un seul endroit. L'écrire quatre fois — une par
-- commande — c'était garantir qu'un jour l'une des quatre en oublierait
-- une.
create or replace function public.biolab_tables_espace()
returns text[]
language sql
immutable
as $$
  select array[
    'culture_batches',
    'bioreactors',
    'medium_recipes',
    'medium_recipe_versions',
    'medium_batches',
    'acclimatization_batches',
    'bio_lab_experiments',
    'experiment_groups',
    'bioreactor_programs',
    'bioreactor_program_versions',
    'bioreactor_cycle_executions',
    'bioreactor_device_bindings',
    'bioreactor_inspections',
    'bioreactor_maintenance',
    'biolab_alerts',
    'biolab_audit_entries',
    'lab_compounds',
    'stock_solutions',
    'inventory_lots',
    'lab_inventory_items'
  ]::text[];
$$;

comment on function public.biolab_tables_espace() is
  'Les vingt tables BioLab qui portent workspace_id. Une seule liste, partagée par les politiques du §2 et par le transfert du §3 : deux listes auraient divergé (0087).';

do $$
declare
  t text;
begin
  foreach t in array public.biolab_tables_espace()
  loop
    execute format('drop policy if exists %I on public.%I',
                   'BioLab entreprise — lecture', t);
    execute format('drop policy if exists %I on public.%I',
                   'BioLab entreprise — création', t);
    execute format('drop policy if exists %I on public.%I',
                   'BioLab entreprise — modification', t);
    execute format('drop policy if exists %I on public.%I',
                   'BioLab entreprise — suppression', t);

    execute format(
      $f$create policy %I on public.%I as restrictive for select
           using (public.biolab_workspace_allows(workspace_id, 'biolab.read'))$f$,
      'BioLab entreprise — lecture', t);

    execute format(
      $f$create policy %I on public.%I as restrictive for insert
           with check (public.biolab_workspace_allows(workspace_id, 'biolab.write'))$f$,
      'BioLab entreprise — création', t);

    -- `using` ET `with check` : sans le second, un membre autorisé
    -- pourrait déplacer une ligne vers un espace où il ne l'est pas.
    execute format(
      $f$create policy %I on public.%I as restrictive for update
           using (public.biolab_workspace_allows(workspace_id, 'biolab.write'))
           with check (public.biolab_workspace_allows(workspace_id, 'biolab.write'))$f$,
      'BioLab entreprise — modification', t);

    execute format(
      $f$create policy %I on public.%I as restrictive for delete
           using (public.biolab_workspace_allows(workspace_id, 'biolab.manage'))$f$,
      'BioLab entreprise — suppression', t);
  end loop;
end $$;

-- La vingt-et-unième, qui passe par son inspection parente.
drop policy if exists "BioLab entreprise — lecture" on public.biolab_inspection_photos;
create policy "BioLab entreprise — lecture" on public.biolab_inspection_photos
  as restrictive for select using (
    public.biolab_workspace_allows(
      public.biolab_inspection_workspace(inspection_id), 'biolab.read'));

drop policy if exists "BioLab entreprise — création" on public.biolab_inspection_photos;
create policy "BioLab entreprise — création" on public.biolab_inspection_photos
  as restrictive for insert with check (
    public.biolab_workspace_allows(
      public.biolab_inspection_workspace(inspection_id), 'biolab.write'));

drop policy if exists "BioLab entreprise — modification" on public.biolab_inspection_photos;
create policy "BioLab entreprise — modification" on public.biolab_inspection_photos
  as restrictive for update
  using (public.biolab_workspace_allows(
           public.biolab_inspection_workspace(inspection_id), 'biolab.write'))
  with check (public.biolab_workspace_allows(
           public.biolab_inspection_workspace(inspection_id), 'biolab.write'));

drop policy if exists "BioLab entreprise — suppression" on public.biolab_inspection_photos;
create policy "BioLab entreprise — suppression" on public.biolab_inspection_photos
  as restrictive for delete using (
    public.biolab_workspace_allows(
      public.biolab_inspection_workspace(inspection_id), 'biolab.manage'));

-- ET LES ÉTIQUETTES. `smart_tags` porte QR et NFC pour TOUT le produit —
-- plantes comprises — et ses lignes BioLab n'en sont qu'une partie.
-- On ne pose donc PAS de garde BioLab sur cette table : il mordrait sur
-- les étiquettes de plantes, qui n'ont rien à voir avec le laboratoire.
-- Le §14 est déjà tenu par une table unique à colonne `type`, et ce
-- n'est pas ici qu'on le défera. La conséquence est assumée et écrite :
-- un ouvrier de terrain qui scanne l'étiquette d'un lot de culture en
-- lit encore la ligne `smart_tags` — c'est-à-dire un jeton et un
-- identifiant, pas le lot lui-même, qui reste fermé par le §2.


-- ============================================================
-- 2 BIS. LA PORTE DE SORTIE, REFERMÉE
-- ============================================================
--
-- LE DÉFAUT MESURÉ, ET IL VIDAIT LE §2 DE SON SENS. Un salarié ne
-- détenant que `biolab.write` s'appropriait tout le laboratoire de son
-- entreprise en UNE instruction :
--
--     update public.culture_batches
--        set workspace_id = <son espace personnel>;
--
-- Le `with check` de la politique de modification appelle
-- `biolab_workspace_allows(NEW.workspace_id, 'biolab.write')`, et la
-- branche qui protège le particulier — « aucune entreprise ne possède
-- cet espace, donc vrai » — autorisait TOUT espace personnel comme
-- destination. L'entreprise perdait la lecture immédiatement, son
-- propriétaire compris, et rien n'était écrit dans `biolab_transferts`.
-- Enchaîné avec un `delete` dans l'espace d'arrivée — où le garde ne
-- mord pas — le même acteur supprimait la ligne pour de bon : la
-- permission `biolab.manage`, créée précisément pour que « qui écrit ne
-- supprime pas », était contournée en deux instructions. Mesuré :
-- attendu 0 ligne déplacée, obtenu 2.
--
-- POURQUOI UN DÉCLENCHEUR ET NON UNE POLITIQUE. Il faudrait écrire, en
-- `with check`, « la destination est l'espace d'origine » — or une
-- politique n'a pas accès à OLD dans son `with check`. RLS ne sait donc
-- pas exprimer « cette colonne ne change pas ». Un déclencheur le sait.
--
-- CE QU'IL NE MORD PAS, ET C'EST LA MOITIÉ DE SA DÉFINITION. Il ne se
-- lève que si l'espace de DÉPART ou celui d'ARRIVÉE appartient à une
-- entreprise. Le monde particulier — c'est-à-dire, aujourd'hui, la
-- totalité des données BioLab de la production — ne le rencontre
-- jamais. Le §26 est tenu : il ne supprime rien, il refuse un
-- déplacement.
--
-- CE QU'IL NE PEUT PAS EMPÊCHER, ÉCRIT PLUTÔT QUE TU : la RECOPIE. Un
-- salarié qui lit un lot peut en insérer une copie dans son espace
-- personnel — l'insertion y est permise, sinon aucun particulier ne
-- pourrait plus rien saisir. L'entreprise ne PERD alors rien : c'est
-- une exfiltration par transcription, du même ordre que noter le
-- contenu de l'écran sur un carnet, et elle suppose déjà `biolab.read`.
-- Le déplacement, lui, faisait disparaître la donnée de l'entreprise :
-- c'est celui-là qui est fermé.
create or replace function public.biolab_espace_entreprise(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_organizations o
     where o.workspace_id = p_workspace_id);
$$;

comment on function public.biolab_espace_entreprise(uuid) is
  'Vrai si cet espace de travail est celui d''une entreprise. Sert au déclencheur du §2 bis, qui ne mord que dans le monde professionnel (0087).';

-- Le drapeau est posé par les deux fonctions du §3 et par elles seules.
-- `set_config(..., true)` le rend LOCAL À LA TRANSACTION : il disparaît
-- au commit comme au rollback, et une session qui tenterait de le poser
-- elle-même n'irait nulle part — PostgREST ouvre une transaction par
-- requête et n'expose aucun moyen d'appeler `set_config` avant un
-- `update`.
create or replace function public.biolab_refuse_changement_espace()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Un `update` qui cite la colonne sans en changer la valeur est le
  -- cas courant : le déclencheur ne doit pas s'en mêler.
  if new.workspace_id is not distinct from old.workspace_id then
    return new;
  end if;

  if coalesce(current_setting('oasis.biolab_transfert', true), '') = 'en cours' then
    return new;
  end if;

  if public.biolab_espace_entreprise(old.workspace_id)
     or public.biolab_espace_entreprise(new.workspace_id) then
    raise exception
      'Le laboratoire d''une entreprise ne change pas d''espace par une simple modification. Utilisez la reprise tracée (transferer_biolab_vers_entreprise), qui vérifie les droits, garde le détail de ce qui bouge et sait le défaire.';
  end if;

  return new;
end;
$$;

comment on function public.biolab_refuse_changement_espace() is
  'Refuse tout déplacement d''une ligne BioLab hors de la reprise tracée du §3, dès qu''une entreprise est d''un côté ou de l''autre. Ferme l''appropriation en une instruction que le with check ne pouvait pas voir (0087).';

do $$
declare
  t text;
begin
  foreach t in array (public.biolab_tables_espace() || array['smart_tags'])
  loop
    execute format('drop trigger if exists biolab_espace_fige on public.%I', t);
    execute format(
      'create trigger biolab_espace_fige
         before update of workspace_id on public.%I
         for each row execute function public.biolab_refuse_changement_espace()', t);
  end loop;
end $$;


-- ============================================================
-- 3. LA REPRISE — LE LABORATOIRE QUI N'EST PAS DANS L'ENTREPRISE
-- ============================================================
--
-- LE DÉFAUT, ET C'EST LE VRAI SUJET DU CHANTIER. 0086 a réparé les
-- tables adossées à un jardin et a laissé explicitement ce cas dehors :
-- « une culture BioLab n'est pas concernée — il n'y a pas de jardin
-- pour dire où la ligne devrait aller ». Voici où elle va.
--
-- LA MESURE. `SyncEngine.fetchWorkspaceID()` estampille TOUT ce que
-- l'iPhone écrit du PREMIER ESPACE PERSONNEL du compte. Le dirigeant
-- saisit ses lots sur son téléphone : ils partent dans son espace
-- privé. En production, la totalité des données BioLab — un lot, un
-- bioréacteur, une recette, une version, une préparation — vit dans
-- l'espace personnel du dirigeant, et l'espace de son entreprise en
-- compte zéro. Un professionnel qui ouvrirait BioLab sur le web
-- aujourd'hui, avec le bon périmètre, verrait un écran vide alors que
-- ses cultures existent.
--
-- LA MAUVAISE RÉPONSE, ET IL FAUT L'ÉCRIRE POUR QUE PERSONNE NE LA
-- REPRENNE : faire lire au web l'espace PERSONNEL du professionnel.
-- L'écran se remplirait tout de suite, et l'entreprise entière — les
-- politiques sont en `cmd = ALL` — obtiendrait l'écriture et la
-- suppression sur le laboratoire privé du dirigeant.
--
-- LA BONNE RÉPONSE : le web lit `organization.workspaceId` et rien
-- d'autre, et on donne au dirigeant le moyen d'y amener son
-- laboratoire, une fois, explicitement, en sachant ce qu'il fait.

-- ------------------------------------------------------------
-- 3.1 Le journal
-- ------------------------------------------------------------
-- Même doctrine que `garden_deliveries` au §4 de 0086 : `on delete set
-- null` partout, colonnes nullables, libellés recopiés à l'écriture. Un
-- journal qui s'efface tout seul ne respecte pas le §26 ; un journal
-- qui empêche de supprimer un compte le respecte trop.
create table if not exists public.biolab_transferts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.business_organizations (id) on delete set null,
  espace_source uuid references public.workspaces (id) on delete set null,
  espace_destination uuid references public.workspaces (id) on delete set null,
  transfere_par uuid references auth.users (id) on delete set null,
  transfere_le timestamptz not null default now(),
  annule_par uuid references auth.users (id) on delete set null,
  annule_le timestamptz,

  -- Les identifiants ne suffisent plus à relire le journal une fois les
  -- lignes d'origine supprimées : on recopie ce qu'il faut pour que la
  -- trace reste LISIBLE, et pas seulement présente.
  entreprise_nom text,
  espace_source_nom text,

  -- Combien de lignes par table. Ce n'est pas un doublon de la table
  -- de lignes : c'est ce qu'on montre à l'écran sans avoir à compter.
  resume jsonb not null default '{}'::jsonb
);

-- Le détail, ligne à ligne, et c'est ce qui rend le retour arrière
-- EXACT. Sans lui, « défaire » voudrait dire « renvoyer tout le BioLab
-- de l'entreprise vers l'espace personnel », ce qui emporterait aussi
-- ce que l'entreprise a créé depuis. Ici on ne renvoie que ce qui est
-- venu. `on delete cascade` est correct : cette table est le contenu du
-- journal, pas une donnée métier.
create table if not exists public.biolab_transfert_lignes (
  transfert_id uuid not null references public.biolab_transferts (id) on delete cascade,
  table_source text not null,
  ligne_id uuid not null,
  primary key (transfert_id, table_source, ligne_id)
);

create index if not exists biolab_transferts_org_idx
  on public.biolab_transferts (organization_id) where annule_le is null;

alter table public.biolab_transferts enable row level security;
alter table public.biolab_transfert_lignes enable row level security;

-- Qui lit le journal : celui qui a déplacé, et l'entreprise qui a reçu.
drop policy if exists "Le laboratoire et son entreprise lisent les transferts"
  on public.biolab_transferts;
create policy "Le laboratoire et son entreprise lisent les transferts"
  on public.biolab_transferts
  for select using (
    transfere_par = auth.uid()
    or public.has_permission(organization_id, 'biolab.read')
  );

-- Aucune politique d'insert, d'update ni de delete : le journal ne
-- s'écrit que par les deux fonctions ci-dessous, qui sont `definer`.
-- Un journal que son sujet peut réécrire ne vaut rien.

drop policy if exists "Le détail suit son transfert" on public.biolab_transfert_lignes;
create policy "Le détail suit son transfert"
  on public.biolab_transfert_lignes
  for select using (
    exists (select 1 from public.biolab_transferts t
             where t.id = transfert_id
               and (t.transfere_par = auth.uid()
                    or public.has_permission(t.organization_id, 'biolab.read')))
  );

comment on table public.biolab_transferts is
  'Journal des reprises de laboratoire : un espace personnel a versé son BioLab dans celui d''une entreprise. Sert au retour arrière et à la traçabilité — sans elle, une reprise vers la mauvaise entreprise serait irréparable (0087).';

-- ------------------------------------------------------------
-- 3.2 La reprise
-- ------------------------------------------------------------
-- ELLE NE SUPPRIME RIEN — §26. Que des `update` sur `workspace_id`.
-- La colonne référence `workspaces(id)` : la changer vers un espace
-- existant ne déclenche aucune cascade. Le test compte les lignes avant
-- et après et exige l'égalité.
--
-- ELLE EST TRANSACTIONNELLE, et ce n'est pas une précaution nouvelle :
-- un corps plpgsql s'exécute dans la transaction de l'appelant. Si la
-- dix-huitième table échoue, les dix-sept autres reviennent avec elle.
-- Une reprise à moitié faite est impossible.
--
-- LES DEUX CONTRÔLES, ET IL EN FAUT DEUX. La permission seule ne suffit
-- pas : elle dirait « j'ai le droit de gérer le laboratoire de cette
-- entreprise », ce qui n'autorise pas à y verser le laboratoire d'un
-- AUTRE. Il faut donc aussi être le propriétaire de l'espace de départ.
-- C'est exactement la structure du double contrôle de
-- `deliver_garden_to_client` au §5 de 0086.
create or replace function public.transferer_biolab_vers_entreprise(
  p_organization_id uuid,
  p_espace_source uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appelant uuid := auth.uid();
  source_proprietaire uuid;
  source_personnelle boolean;
  source_nom text;
  destination uuid;
  entreprise text;
  transfert uuid;
  t text;
  n bigint;
  total bigint := 0;
  detail jsonb := '{}'::jsonb;
  meres_restees bigint;
begin
  if appelant is null then
    raise exception 'Connectez-vous.';
  end if;

  select owner_id, is_personal, name
    into source_proprietaire, source_personnelle, source_nom
    from public.workspaces where id = p_espace_source;
  if source_proprietaire is null then
    raise exception 'Espace de travail introuvable.';
  end if;

  -- CONTRÔLE 1 — on ne reprend que SON PROPRE laboratoire.
  if source_proprietaire is distinct from appelant then
    raise exception 'Seul le propriétaire de cet espace peut y reprendre son laboratoire.';
  end if;
  -- Et seulement depuis un espace personnel : partir de l'espace d'une
  -- autre entreprise serait un vol de laboratoire déguisé en reprise.
  if not source_personnelle then
    raise exception 'La reprise part d''un espace personnel, pas de l''espace d''une entreprise.';
  end if;

  -- CONTRÔLE 2 — et on ne le dépose que là où l'on a le droit.
  if not public.has_permission(p_organization_id, 'biolab.manage') then
    raise exception 'Vous n''avez pas le droit de gérer le laboratoire de cette entreprise.';
  end if;

  select workspace_id, name into destination, entreprise
    from public.business_organizations where id = p_organization_id;
  if destination is null then
    raise exception 'Entreprise introuvable.';
  end if;
  if destination = p_espace_source then
    raise exception 'Ce laboratoire est déjà dans l''espace de cette entreprise.';
  end if;

  insert into public.biolab_transferts (
    organization_id, espace_source, espace_destination, transfere_par,
    entreprise_nom, espace_source_nom
  ) values (
    p_organization_id, p_espace_source, destination, appelant,
    entreprise, source_nom
  ) returning id into transfert;

  -- Le drapeau du §2 bis. Il autorise le déclencheur à laisser passer
  -- CE déplacement-ci, et lui seul : il est local à la transaction,
  -- donc il disparaît quoi qu'il arrive ensuite.
  perform set_config('oasis.biolab_transfert', 'en cours', true);

  -- POURQUOI `updated_at` N'EST PLUS TOUCHÉ ICI, ET C'EST UNE
  -- CORRECTION MESURÉE. Cette colonne est ce que l'écran de supervision
  -- affiche comme DATE DE L'ÉTAT d'un appareil (« état connu il y a
  -- 4 j », et au-delà de 24 h une mise en garde « à vérifier sur
  -- place »). La réécrire pendant la reprise remettait tous les
  -- appareils à « connu il y a 0 min » et éteignait la mise en garde —
  -- à l'instant précis où l'entreprise découvre l'écran, et alors
  -- qu'aucune mesure n'a été prise. Une écriture d'administration n'a
  -- pas à se faire passer pour un relevé. Le déplacement reste tracé :
  -- `biolab_transfert_lignes` en garde le détail ligne à ligne.
  foreach t in array public.biolab_tables_espace()
  loop
    execute format(
      'with deplacees as (
         update public.%I set workspace_id = $1
          where workspace_id = $2
         returning id)
       insert into public.biolab_transfert_lignes (transfert_id, table_source, ligne_id)
       select $3, $4, id from deplacees', t)
      using destination, p_espace_source, transfert, t;
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then
      detail := detail || jsonb_build_object(t, n);
    end if;
  end loop;

  -- LES ÉTIQUETTES, ET SEULEMENT CELLES DU LABORATOIRE. `smart_tags`
  -- porte aussi les étiquettes de plantes : les emporter détacherait
  -- une étiquette de la plante qu'elle désigne, restée dans l'espace
  -- personnel. On ne déplace donc que les lignes qui pointent vers un
  -- objet BioLab ET vers aucune plante.
  with deplacees as (
    update public.smart_tags set workspace_id = destination
     where workspace_id = p_espace_source
       and plant_id is null
       and (bioreactor_id is not null
            or culture_batch_id is not null
            or medium_recipe_version_id is not null
            or acclimatization_batch_id is not null)
    returning id)
  insert into public.biolab_transfert_lignes (transfert_id, table_source, ligne_id)
  select transfert, 'smart_tags', id from deplacees;
  get diagnostics n = row_count;
  total := total + n;
  if n > 0 then
    detail := detail || jsonb_build_object('smart_tags', n);
  end if;

  -- CE QUI NE SUIT PAS, ET QU'IL FAUT DIRE À L'ÉCRAN. Les PLANTES MÈRES
  -- appartiennent au monde du jardin : elles portent `garden_id`, elles
  -- relèvent du pont de 0086, et les déplacer ici viderait un jardin
  -- personnel sans que personne ne l'ait demandé. Après la reprise,
  -- `culture_batches.mother_plant_id` pointe donc vers une plante que
  -- l'entreprise ne voit pas, et le web doit afficher « plante mère non
  -- accessible » plutôt qu'un blanc. On compte combien, pour que
  -- l'écran puisse le dire au lieu de le taire.
  select count(distinct b.mother_plant_id) into meres_restees
    from public.culture_batches b
    join public.plants p on p.id = b.mother_plant_id
   where b.workspace_id = destination
     and p.workspace_id is distinct from destination;

  detail := detail || jsonb_build_object(
    'lignes_deplacees', total,
    'plantes_meres_restees', meres_restees);

  update public.biolab_transferts set resume = detail where id = transfert;

  -- On repose le drapeau tout de suite : la transaction de l'appelant
  -- peut contenir d'autres instructions après celle-ci, et le garde du
  -- §2 bis doit se relever pour elles.
  perform set_config('oasis.biolab_transfert', '', true);

  return detail || jsonb_build_object('transfert_id', transfert);
end;
$$;

comment on function public.transferer_biolab_vers_entreprise(uuid, uuid) is
  'Verse le laboratoire d''un espace personnel dans l''espace d''une entreprise. Aucune suppression : que des update de workspace_id, tracés ligne à ligne pour que le retour arrière soit exact (0087).';

-- ------------------------------------------------------------
-- 3.3 Le retour arrière
-- ------------------------------------------------------------
-- Une reprise vers la mauvaise entreprise doit se défaire. On ne
-- renvoie QUE les lignes que ce transfert a emportées — c'est à cela
-- que sert `biolab_transfert_lignes`. Ce que l'entreprise a créé depuis
-- reste chez elle.
--
-- QUI PEUT DÉFAIRE : celui qui a fait. Pas l'entreprise — sans quoi une
-- entreprise pourrait renvoyer chez lui le laboratoire d'un dirigeant
-- qui l'a quittée, ou pire, s'en servir pour le déplacer une seconde
-- fois vers ailleurs.
create or replace function public.annuler_transfert_biolab(p_transfert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appelant uuid := auth.uid();
  tr public.biolab_transferts%rowtype;
  t text;
  n bigint;
  total bigint := 0;
  detail jsonb := '{}'::jsonb;
begin
  if appelant is null then
    raise exception 'Connectez-vous.';
  end if;

  select * into tr from public.biolab_transferts where id = p_transfert_id;
  if tr.id is null then
    raise exception 'Transfert introuvable.';
  end if;
  if tr.annule_le is not null then
    raise exception 'Ce transfert a déjà été annulé.';
  end if;
  if tr.transfere_par is distinct from appelant then
    raise exception 'Seul l''auteur de la reprise peut la défaire.';
  end if;
  if tr.espace_source is null then
    raise exception 'L''espace de départ n''existe plus : ce transfert ne peut pas être défait.';
  end if;

  perform set_config('oasis.biolab_transfert', 'en cours', true);

  -- Même raison qu'à l'aller : `updated_at` porte la fraîcheur affichée
  -- à l'écran, pas la trace d'une écriture d'administration.
  foreach t in array (public.biolab_tables_espace() || array['smart_tags'])
  loop
    execute format(
      'update public.%I s set workspace_id = $1
        from public.biolab_transfert_lignes l
       where l.transfert_id = $2 and l.table_source = $3 and l.ligne_id = s.id
         and s.workspace_id = $4', t)
      using tr.espace_source, p_transfert_id, t, tr.espace_destination;
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then
      detail := detail || jsonb_build_object(t, n);
    end if;
  end loop;

  update public.biolab_transferts
     set annule_le = now(), annule_par = appelant
   where id = p_transfert_id;

  perform set_config('oasis.biolab_transfert', '', true);

  return detail || jsonb_build_object('lignes_rendues', total);
end;
$$;

comment on function public.annuler_transfert_biolab(uuid) is
  'Défait une reprise de laboratoire, ligne à ligne et seulement pour les lignes qu''elle avait emportées. Aucune suppression (0087).';

-- Les deux fonctions ci-dessus sont `security definer` et écrivent dans
-- vingt et une tables. Elles restent exécutables par `authenticated` —
-- il le faut, c'est le dirigeant qui les appelle depuis le web — et
-- c'est leur double contrôle interne qui les tient, pas leurs droits.
-- On ferme en revanche la porte à `anon`, qui n'a rien à y faire :
-- `auth.uid()` y est nul, la première ligne du corps refuse déjà, mais
-- un refus au niveau du droit vaut mieux qu'un refus au niveau du code.
revoke all on function public.transferer_biolab_vers_entreprise(uuid, uuid) from anon;
revoke all on function public.annuler_transfert_biolab(uuid) from anon;


-- ============================================================
-- 4. LES LECTURES DU WEB
-- ============================================================
--
-- POURQUOI EN BASE ET NON DANS LE NAVIGATEUR. Un taux de contamination
-- ou un rendement de multiplication calculé deux fois — une fois en
-- Swift, une fois en TypeScript — dérive au premier changement de
-- définition, et les deux écrans se contredisent sans que personne ne
-- sache lequel a raison. Le SQL calcule, l'écran affiche.
--
-- LES DÉFINITIONS SONT CELLES DU MOBILE, PAS DES DÉFINITIONS NEUVES.
-- Elles reprennent `BioLabDashboardService.summary` et
-- `BioLabAnalyticsService` ligne à ligne, y compris leurs prudences :
--   • une contamination n'est comptée que si elle est CONFIRMÉE par un
--     humain, jamais `suspected` — un lot jamais inspecté n'est pas
--     compté comme contaminé ;
--   • le « taux de réussite » d'un bioréacteur est un rapport
--     cycles réussis / cycles tentés, PAS une disponibilité calendaire :
--     le produit n'enregistre aucune durée d'immobilisation ;
--   • le taux d'enracinement se lit sur les lots encore en jeu (non
--     rebutés), faute d'un signal « enracinement tenté puis échoué ».
--
-- ELLES RENDENT NULL, JAMAIS ZÉRO, POUR UN INCONNU. « Aucun lot n'a été
-- inspecté cette semaine » et « aucun lot inspecté n'était contaminé »
-- sont deux phrases différentes ; les écrire toutes les deux « 0 % »
-- ferait mentir l'écran. C'est déjà la discipline du mobile
-- (`nil` plutôt que `0`), et c'est la même ici.
--
-- ELLES SONT `security invoker` — c'est-à-dire sans `security definer`,
-- le défaut. C'EST LA PROPRIÉTÉ DE SÛRETÉ PRINCIPALE DE CE PARAGRAPHE :
-- un agrégat `definer` compterait des lignes que l'appelant n'a pas le
-- droit de voir et les lui rendrait sous forme de moyenne. Ici, la RLS
-- du §2 s'applique à l'intérieur de la fonction : un ouvrier de terrain
-- qui les appelle obtient zéro et NULL, pas les chiffres du
-- laboratoire.
--
-- LE PARAMÈTRE `p_workspace_id` N'EST PAS UNE PROTECTION et n'a pas à
-- l'être : quelqu'un qui y met l'espace d'un autre obtient zéro ligne,
-- parce que la RLS a déjà tranché. C'est une ceinture, pas la serrure.

-- ------------------------------------------------------------
-- 4.1 Le tableau de bord
-- ------------------------------------------------------------
-- `p_fuseau` existe pour une raison mesurable : le mobile compte « les
-- immersions du jour » avec `Calendar.current`, c'est-à-dire l'heure du
-- téléphone, alors qu'une session Postgres est en UTC. Sans ce
-- paramètre, entre minuit et deux heures du matin, le web et le
-- téléphone afficheraient deux nombres différents pour la même journée.
--
-- LES QUATRE DÉNOMINATEURS ONT ÉTÉ AJOUTÉS APRÈS COUP, ET C'EST LE
-- DÉFAUT LE PLUS SOURNOIS QU'ON AIT TROUVÉ SUR CETTE PAGE. Un taux sans
-- son effectif n'est pas vérifiable : avec un seul lot inspecté, la
-- carte « Contamination (7 jours) » affichait « 100 % » exactement comme
-- elle l'aurait fait sur quarante inspections. Le module s'est donné une
-- règle — sous cinq observations, on montre les faits bruts (« 1 sur
-- 3 ») et pas un pourcentage — et cette règle était intenable sur ces
-- cartes-là, faute de savoir sur combien de lignes le chiffre portait.
-- La fonction rend donc, à côté de chaque taux, ce qu'il y avait au
-- dénominateur.
--
-- `drop function` avant `create` : ajouter une colonne à un `returns
-- table` change la signature de retour, et `create or replace` la
-- refuse. La suppression ne perd rien — une fonction n'a pas d'état.
drop function if exists public.biolab_tableau_de_bord(uuid, text);

create or replace function public.biolab_tableau_de_bord(
  p_workspace_id uuid,
  p_fuseau text default 'Europe/Paris'
)
returns table (
  lots_total int,
  lots_actifs int,
  lots_multiplication int,
  lots_enracinement int,
  bioreacteurs_actifs int,
  explants_total int,
  plantules_acclimatation int,
  alertes_actives int,
  immersions_du_jour int,
  aerations_du_jour int,
  inspections_du_jour int,
  milieux_du_jour int,
  articles_stock_faible int,
  -- Les dénominateurs, un par taux, dans le même ordre que les taux.
  inspections_7j int,
  lots_mesures_multiplication int,
  acclimatations_mesurees int,
  lots_inspectes int,
  taux_multiplication_moyen numeric,
  taux_contamination_7j numeric,
  taux_survie_acclimatation numeric,
  taux_perte numeric,
  duree_cycle_moyenne_secondes numeric
)
language sql
stable
as $$
  with debut_jour as (
    select date_trunc('day', now() at time zone p_fuseau) at time zone p_fuseau as t
  ),
  lots as (
    select * from public.culture_batches where workspace_id = p_workspace_id
  ),
  insp7 as (
    select * from public.bioreactor_inspections
     where workspace_id = p_workspace_id and date >= now() - interval '7 days'
  ),
  acc as (
    select * from public.acclimatization_batches where workspace_id = p_workspace_id
  )
  select
    (select count(*) from lots)::int,
    (select count(*) from lots where status = 'active')::int,
    (select count(*) from lots where status = 'active' and culture_stage = 'multiplication')::int,
    (select count(*) from lots where status = 'active' and culture_stage = 'rooting')::int,
    -- « Actif » au sens du mobile : ni en maintenance, et portant un lot.
    (select count(*) from public.bioreactors
      where workspace_id = p_workspace_id
        and status <> 'maintenance' and current_batch_id is not null)::int,
    (select coalesce(sum(current_count), 0) from lots where status = 'active')::int,
    (select coalesce(sum(current_survivor_count), 0) from acc where status = 'active')::int,
    (select count(*) from public.biolab_alerts
      where workspace_id = p_workspace_id and resolved_at is null)::int,
    (select count(*) from public.bioreactor_cycle_executions e, debut_jour d
      where e.workspace_id = p_workspace_id and e.cycle_type = 'immersion'
        and e.actual_start >= d.t)::int,
    (select count(*) from public.bioreactor_cycle_executions e, debut_jour d
      where e.workspace_id = p_workspace_id and e.cycle_type = 'aeration'
        and e.actual_start >= d.t)::int,
    (select count(*) from public.bioreactor_inspections i, debut_jour d
      where i.workspace_id = p_workspace_id and i.date >= d.t)::int,
    (select count(*) from public.medium_batches m, debut_jour d
      where m.workspace_id = p_workspace_id and m.prepared_at >= d.t)::int,
    (select count(*) from public.lab_inventory_items
      where workspace_id = p_workspace_id
        and current_quantity <= minimum_threshold)::int,
    -- Les quatre dénominateurs. `taux_perte`, lui, porte sur
    -- `lots_total`, qui est déjà rendu plus haut.
    (select count(*) from insp7)::int,
    (select count(*) from lots where initial_explant_count > 0)::int,
    (select count(*) from acc where initial_plantlet_count > 0)::int,
    -- Combien de lots ont AU MOINS UNE inspection. Sert à dire, sur la
    -- page des statistiques, l'écart entre l'effectif et l'effectif
    -- réellement observé : un lot jamais inspecté compte bel et bien au
    -- dénominateur du taux de contamination, et l'écran doit le dire au
    -- lieu de laisser croire qu'il est écarté du calcul.
    (select count(distinct i.culture_batch_id)
       from public.bioreactor_inspections i
      where i.workspace_id = p_workspace_id
        and i.culture_batch_id is not null)::int,
    -- NULL quand aucun lot n'a de compte de départ : une moyenne sur
    -- rien n'est pas zéro.
    (select avg(current_count::numeric / initial_explant_count)
       from lots where initial_explant_count > 0),
    -- NULL quand aucune inspection n'a eu lieu cette semaine.
    (select case when count(*) = 0 then null
                 else count(*) filter (where contamination_status = 'confirmed')::numeric
                      / count(*) end
       from insp7),
    (select avg(current_survivor_count::numeric / initial_plantlet_count)
       from acc where initial_plantlet_count > 0),
    (select case when count(*) = 0 then null
                 else count(*) filter (where status = 'discarded')::numeric / count(*) end
       from lots),
    (select avg(actual_duration_seconds::numeric)
       from public.bioreactor_cycle_executions
      where workspace_id = p_workspace_id and status = 'completed'
        and actual_duration_seconds is not null);
$$;

comment on function public.biolab_tableau_de_bord(uuid, text) is
  'Le tableau de bord BioLab du §7, calculé en base. Reprend BioLabDashboardService.summary du mobile, NULL compris : un taux inconnu n''est pas zéro (0087).';

-- ------------------------------------------------------------
-- 4.2 Les statistiques par espèce
-- ------------------------------------------------------------
-- `lots_inspectes` a été ajouté pour la même raison que les
-- dénominateurs du §4.1 : le taux de contamination d'une espèce se
-- calcule sur TOUS ses lots, inspectés ou non — un lot jamais regardé
-- compte comme non contaminé. Ce n'est pas un défaut du calcul, c'est
-- la seule définition possible ; mais un laboratoire qui n'inspecte
-- qu'un lot sur dix verrait son taux divisé par dix sans rien pour s'en
-- apercevoir. La colonne rend l'écart visible.
drop function if exists public.biolab_statistiques_especes(uuid);

create or replace function public.biolab_statistiques_especes(p_workspace_id uuid)
returns table (
  espece text,
  lots int,
  lots_inspectes int,
  taux_multiplication_moyen numeric,
  taux_contamination numeric,
  taux_hyperhydricite numeric,
  taux_enracinement numeric,
  taux_survie_acclimatation numeric
)
language sql
stable
as $$
  with lots as (
    select b.id, b.species_name, b.status, b.culture_stage,
           b.initial_explant_count, b.current_count,
           -- CONFIRMÉE seulement. `suspected` est une inquiétude, pas
           -- un fait : la compter surestimerait une certitude que le
           -- produit n'a pas.
           exists (select 1 from public.bioreactor_inspections i
                    where i.culture_batch_id = b.id
                      and i.contamination_status = 'confirmed') as contamine,
           exists (select 1 from public.bioreactor_inspections i
                    where i.culture_batch_id = b.id
                      and i.hyperhydricity_status not in ('none', 'unknown')) as hyperhydrique,
           exists (select 1 from public.bioreactor_inspections i
                    where i.culture_batch_id = b.id) as inspecte
      from public.culture_batches b
     where b.workspace_id = p_workspace_id
  ),
  survie as (
    select l.species_name,
           avg(a.current_survivor_count::numeric / a.initial_plantlet_count) as taux
      from public.acclimatization_batches a
      join lots l on l.id = a.culture_batch_id
     where a.initial_plantlet_count > 0
     group by l.species_name
  )
  select
    l.species_name,
    count(*)::int,
    count(*) filter (where l.inspecte)::int,
    avg(case when l.initial_explant_count > 0
             then l.current_count::numeric / l.initial_explant_count end),
    count(*) filter (where l.contamine)::numeric / count(*),
    count(*) filter (where l.hyperhydrique)::numeric / count(*),
    -- Sur les lots ENCORE EN JEU. Si tous ont été rebutés, la question
    -- n'a pas de réponse : NULL.
    case when count(*) filter (where l.status <> 'discarded') = 0 then null
         else count(*) filter (
                where l.status <> 'discarded'
                  and l.culture_stage in ('rooting', 'preAcclimatization',
                                          'acclimatization', 'completed'))::numeric
              / count(*) filter (where l.status <> 'discarded') end,
    max(s.taux)
  from lots l
  left join survie s on s.species_name = l.species_name
  group by l.species_name
  order by count(*) desc, l.species_name;
$$;

comment on function public.biolab_statistiques_especes(uuid) is
  'Statistiques par espèce : rendement de multiplication, contamination confirmée, hyperhydricité, enracinement, survie en acclimatation. Reprend BioLabAnalyticsService.speciesStats (0087).';

-- ------------------------------------------------------------
-- 4.3 Les statistiques par bioréacteur
-- ------------------------------------------------------------
create or replace function public.biolab_statistiques_bioreacteurs(p_workspace_id uuid)
returns table (
  bioreacteur_id uuid,
  code text,
  nom text,
  cycles_termines int,
  cycles_echoues int,
  taux_reussite numeric,
  lots_termines int
)
language sql
stable
as $$
  select
    r.id, r.code, r.name,
    coalesce(c.termines, 0)::int,
    coalesce(c.echoues, 0)::int,
    -- Aucun cycle tenté : pas de taux, et surtout pas « 0 % de
    -- réussite », qui accuserait un équipement neuf.
    case when coalesce(c.termines, 0) + coalesce(c.echoues, 0) = 0 then null
         else c.termines::numeric / (c.termines + c.echoues) end,
    coalesce(l.lots, 0)::int
  from public.bioreactors r
  left join lateral (
    select count(*) filter (where e.status = 'completed') as termines,
           count(*) filter (where e.status in ('failed', 'timeout')) as echoues
      from public.bioreactor_cycle_executions e
     where e.bioreactor_id = r.id
  ) c on true
  left join lateral (
    -- Le seul lien lot↔bioréacteur que le produit ENREGISTRE est
    -- l'inspection : `bioreactors.current_batch_id` est un instantané
    -- vivant, pas un historique. C'est donc un approchant, et le mobile
    -- le dit déjà de la même façon.
    select count(distinct i.culture_batch_id) as lots
      from public.bioreactor_inspections i
      join public.culture_batches b on b.id = i.culture_batch_id
     where i.bioreactor_id = r.id and b.status = 'completed'
  ) l on true
  where r.workspace_id = p_workspace_id
  order by r.code;
$$;

comment on function public.biolab_statistiques_bioreacteurs(uuid) is
  'Statistiques par bioréacteur : cycles réussis, échoués, taux de réussite (pas une disponibilité calendaire) et lots terminés. Reprend BioLabAnalyticsService.bioreactorStats (0087).';

-- ------------------------------------------------------------
-- 4.4 L'activité récente
-- ------------------------------------------------------------
create or replace function public.biolab_activite_recente(
  p_workspace_id uuid,
  p_limite int default 15
)
returns table (
  survenu_le timestamptz,
  categorie text,
  libelle text,
  objet_id uuid
)
language sql
stable
as $$
  select * from (
    select e.actual_start, 'cycle'::text,
           coalesce(r.code, '?') || ' — ' ||
             case e.cycle_type when 'immersion' then 'immersion'
                               when 'aeration' then 'aération'
                               else e.cycle_type end,
           e.id
      from public.bioreactor_cycle_executions e
      left join public.bioreactors r on r.id = e.bioreactor_id
     where e.workspace_id = p_workspace_id and e.actual_start is not null
    union all
    select i.date, 'inspection'::text,
           'Lot ' || coalesce(b.batch_code, '?') || ' — inspection', i.id
      from public.bioreactor_inspections i
      left join public.culture_batches b on b.id = i.culture_batch_id
     where i.workspace_id = p_workspace_id
    union all
    select m.prepared_at, 'milieu'::text,
           'Préparation de milieu ' || m.code, m.id
      from public.medium_batches m
     where m.workspace_id = p_workspace_id
  ) a (survenu_le, categorie, libelle, objet_id)
  order by survenu_le desc
  limit greatest(p_limite, 0);
$$;

comment on function public.biolab_activite_recente(uuid, int) is
  'Les trois familles d''événements BioLab qui portent une date, fusionnées et triées. Reprend BioLabDashboardService.recentActivity (0087).';

-- ------------------------------------------------------------
-- 4.5 La généalogie d'un lot
-- ------------------------------------------------------------
-- La traçabilité du §7. Elle remonte d'abord à la RACINE de la lignée —
-- comme `CultureLineageService.tree`, et pour la même raison : l'arbre
-- montré doit partir de la vraie origine, pas de l'endroit où
-- l'utilisateur a ouvert un lot — puis redescend.
--
-- LES DEUX PARCOURS SONT BORNÉS. `parent_batch_id` référence la table
-- elle-même sans rien qui interdise un cycle : un lot qui deviendrait
-- son propre ancêtre ferait tourner la récursion sans fin. Les deux
-- `where` sur la profondeur ferment cela — 64 niveaux de repiquage
-- successifs est déjà une lignée qu'aucun laboratoire n'atteint.
create or replace function public.biolab_genealogie_lot(p_lot_id uuid)
returns table (
  lot_id uuid,
  code text,
  espece text,
  stade text,
  statut text,
  explants int,
  parent_id uuid,
  profondeur int,
  est_racine boolean
)
language sql
stable
as $$
  with recursive remontee as (
    select b.id, b.parent_batch_id, 0 as niveau
      from public.culture_batches b where b.id = p_lot_id
    union all
    select p.id, p.parent_batch_id, r.niveau + 1
      from public.culture_batches p
      join remontee r on p.id = r.parent_batch_id
     where r.niveau < 64
  ),
  racine as (
    select id from remontee where parent_batch_id is null
     union all
    -- Le lot lui-même si la remontée n'a trouvé aucune racine (parent
    -- inaccessible parce qu'il vit dans un autre espace, ou lignée
    -- tronquée par la borne) : mieux vaut un arbre partiel qu'aucun.
    select p_lot_id where not exists (select 1 from remontee where parent_batch_id is null)
  ),
  descente as (
    select b.id, b.parent_batch_id, 0 as niveau
      from public.culture_batches b
     where b.id in (select id from racine)
    union all
    select e.id, e.parent_batch_id, d.niveau + 1
      from public.culture_batches e
      join descente d on e.parent_batch_id = d.id
     where d.niveau < 64
  )
  select distinct on (b.id)
         b.id, b.batch_code, b.species_name, b.culture_stage, b.status,
         b.current_count, b.parent_batch_id, d.niveau,
         b.parent_batch_id is null
    from descente d
    join public.culture_batches b on b.id = d.id
   order by b.id, d.niveau;
$$;

comment on function public.biolab_genealogie_lot(uuid) is
  'L''arbre généalogique complet d''un lot : remonte à la racine de la lignée puis redescend. Récursion bornée à 64 niveaux, parent_batch_id n''interdisant pas un cycle. Reprend CultureLineageService (0087).';


-- ============================================================
-- 5. LA SUPERVISION DES ÉQUIPEMENTS — §7, EN LECTURE SEULE
-- ============================================================
--
-- CE QUI N'A PAS ÉTÉ AJOUTÉ, ET POURQUOI C'EST LA BONNE DÉCISION.
-- Le premier réflexe était de créer une table d'état d'équipement, que
-- le téléphone écrirait et que le web lirait. Deux mesures l'ont
-- écarté :
--
--   (a) L'ÉTAT EST DÉJÀ STOCKÉ. `bioreactors` porte `status`,
--       `automation_enabled`, `active_program_version_id`,
--       `current_batch_id` et `schedule_resumed_at` ;
--       `connected_devices` porte `online` et `last_seen_at` ;
--       `bioreactor_cycle_executions` porte l'historique complet d'un
--       cycle, instantanés de capteurs compris. C'est-à-dire l'état
--       réel, la dernière activation, le programme actif et l'état de
--       connexion : les quatre choses que le §7 demande d'afficher. Une
--       table de plus serait le second système que le §6 interdit.
--
--   (b) PERSONNE NE L'ÉCRIRAIT. Le code de l'iPhone est hors du
--       périmètre de ce chantier. Une table neuve resterait vide, et un
--       écran vide qui prétend superviser est pire que pas d'écran.
--
-- CE QU'ON POSE À LA PLACE : une lecture qui rassemble l'état ET SA
-- FRAÎCHEUR. Une valeur d'état sans date de relevé est une affirmation
-- invérifiable ; c'est le seul point sur lequel la base pouvait
-- progresser sans écrire une ligne de Swift.
--
-- LA LIMITE, ÉCRITE ICI PARCE QUE L'ÉCRAN DEVRA LA DIRE :
-- `etat_connu_le` est le `updated_at` de la ligne, c'est-à-dire la
-- dernière fois que le TÉLÉPHONE A ÉCRIT, pas la dernière fois qu'il a
-- OBSERVÉ. Renommer le bioréacteur le rafraîchit sans que rien n'ait
-- été mesuré. C'est la meilleure approximation disponible, et il faut
-- l'afficher comme telle — « connu le … » et non « en direct ».
--
-- IL N'Y A AUCUNE POUSSÉE TEMPS RÉEL. La publication
-- `supabase_realtime` ne contient AUCUNE table — comptage :
-- `pg_publication_tables` rend zéro ligne pour toute la base. Le §9
-- (« le web reflète immédiatement ce que le téléphone a fait ») n'est
-- porté par rien aujourd'hui, et ce fichier ne prétend pas le porter :
-- ajouter des tables à une publication touche tout le produit, pas
-- seulement BioLab, et cela se décide globalement.
--
-- ET IL N'Y A AUCUN MOYEN DE COMMANDER *ICI*. Pas de fonction
-- d'allumage, pas de bascule d'automatisation, pas d'activation de
-- version de programme, pas de table d'ordres. §7 : le web supervise,
-- le téléphone commande (§8).
--
-- MAIS IL FAUT DIRE OÙ LE §7 TIENT VRAIMENT, ET CE N'EST PAS ICI. RLS
-- ne sait pas distinguer le téléphone du navigateur : les deux passent
-- par la même API PostgREST avec le même jeton. Un responsable qui
-- détient `biolab.write` PEUT donc, en appelant l'API à la main,
-- basculer `automation_enabled` — c'est mesuré, et le test l'enregistre
-- comme un fait connu plutôt que de laisser croire l'inverse. Le §7 est
-- tenu par l'ABSENCE DE BOUTON dans web-pro, pas par la base.
--
-- ON POURRAIT le faire tenir en base — une politique restrictive
-- interdisant de modifier les cinq colonnes de commande — mais elle
-- mordrait sur le TÉLÉPHONE, qui les écrit légitimement, et il n'existe
-- aucun moyen de les distinguer. Le remède serait pire que le mal, et
-- c'est pour cela qu'il n'est pas appliqué.
--
-- DEUX COLONNES AJOUTÉES APRÈS MESURE, SUR LA PRÉSENCE DES OBJETS.
-- `derniere_presence_objet` était un `max` sur tous les objets liés :
-- un appareil vu il y a deux minutes datait pour tout le groupe, y
-- compris pour celui qui n'avait plus donné signe depuis des mois. Et
-- `connected_devices.last_seen_at` est NULLABLE alors qu'`online`
-- vaut `false` par défaut : un objet marqué en ligne une fois et jamais
-- revu produisait un « tous joignables » SANS AUCUNE DATE. C'est le cas
-- le moins sûr, et il s'affichait comme le plus sûr. On rend donc aussi
-- le PLUS ANCIEN contact et le nombre d'objets dont on ignore la date :
-- c'est l'objet le plus ancien qui qualifie honnêtement un groupe.
drop function if exists public.biolab_supervision_equipements(uuid);

create or replace function public.biolab_supervision_equipements(p_workspace_id uuid)
returns table (
  bioreacteur_id uuid,
  code text,
  nom text,
  type_bioreacteur text,
  emplacement text,
  statut text,
  automatisation_active boolean,
  lot_en_cours_id uuid,
  lot_en_cours_code text,
  programme_actif_id uuid,
  programme_actif_libelle text,
  dernier_cycle_type text,
  dernier_cycle_statut text,
  dernier_cycle_fin timestamptz,
  objets_lies int,
  objets_en_ligne int,
  derniere_presence_objet timestamptz,
  plus_ancienne_presence_objet timestamptz,
  objets_sans_presence int,
  etat_connu_le timestamptz,
  fraicheur_secondes numeric
)
language sql
stable
as $$
  select
    r.id, r.code, r.name, r.bioreactor_type, r.location,
    r.status, r.automation_enabled,
    r.current_batch_id, b.batch_code,
    r.active_program_version_id,
    case when v.id is null then null
         else coalesce(pr.name, 'Programme') || ' — V' || v.version_number end,
    c.cycle_type, c.status, coalesce(c.actual_end, c.actual_start),
    -- NULL et non 0 quand aucun objet connecté n'est lié : « aucun
    -- équipement piloté » et « zéro équipement en ligne » sont deux
    -- constats différents.
    case when d.lies = 0 then null else d.lies::int end,
    case when d.lies = 0 then null else d.en_ligne::int end,
    d.derniere_presence,
    d.plus_ancienne_presence,
    case when d.lies = 0 then null else d.sans_presence::int end,
    r.updated_at,
    extract(epoch from (now() - r.updated_at))::numeric
  from public.bioreactors r
  left join public.culture_batches b on b.id = r.current_batch_id
  left join public.bioreactor_program_versions v on v.id = r.active_program_version_id
  left join public.bioreactor_programs pr on pr.id = v.program_id
  left join lateral (
    select e.cycle_type, e.status, e.actual_end, e.actual_start
      from public.bioreactor_cycle_executions e
     where e.bioreactor_id = r.id
     order by coalesce(e.actual_end, e.actual_start, e.planned_start) desc
     limit 1
  ) c on true
  left join lateral (
    select count(*) as lies,
           count(*) filter (where cd.online) as en_ligne,
           max(cd.last_seen_at) as derniere_presence,
           min(cd.last_seen_at) as plus_ancienne_presence,
           count(*) filter (where cd.last_seen_at is null) as sans_presence
      from public.bioreactor_device_bindings bd
      join public.connected_devices cd on cd.id = bd.device_id
     where bd.bioreactor_id = r.id and cd.deleted_at is null
  ) d on true
  where r.workspace_id = p_workspace_id
  order by r.code;
$$;

comment on function public.biolab_supervision_equipements(uuid) is
  'Supervision §7, LECTURE SEULE : état d''un bioréacteur, programme actif, lot en cours, dernier cycle, objets connectés liés, et la fraîcheur de tout cela. Aucune commande — le web ne pilote pas un équipement (0087).';

-- Ces six lectures sont `security invoker` : la RLS du §2 les tient. On
-- ferme quand même la porte à `anon`, qui ne peut de toute façon rien
-- en tirer, plutôt que de le laisser appeler un agrégat pour recevoir
-- des zéros.
revoke all on function public.biolab_tableau_de_bord(uuid, text) from anon;
revoke all on function public.biolab_statistiques_especes(uuid) from anon;
revoke all on function public.biolab_statistiques_bioreacteurs(uuid) from anon;
revoke all on function public.biolab_activite_recente(uuid, int) from anon;
revoke all on function public.biolab_genealogie_lot(uuid) from anon;
revoke all on function public.biolab_supervision_equipements(uuid) from anon;
