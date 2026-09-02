-- Oasis Care — Phase 11, AMÉLIORATION MAJEURE.
-- §5 GESTION · DOCUMENTS — §21 « nom ; type ; tags ; métadonnées ;
-- client associé ; projet associé » et « Préparer plus tard :
-- full-text document content ».
--
-- À exécuter après 0067. Idempotente et purement additive.
--
-- ============================================================
-- POURQUOI CE N'EST PAS `organization_documents` (migration 0060)
-- ============================================================
-- Les deux tables portent des fichiers, et c'est tout ce qu'elles ont
-- en commun.
--
-- `organization_documents` (§45) est le CLASSEUR DE L'ENTREPRISE : le
-- KBIS, le RIB, l'attestation décennale. Une pièce par entreprise, une
-- date d'expiration qui compte, et une politique RLS qui exige
-- `organization.manageUsers` — un RIB n'est pas une photo de chantier,
-- et le chef d'équipe qui ouvre l'application sur le terrain n'a rien à
-- faire dans les coordonnées bancaires de son patron.
--
-- `documents` est la MÉMOIRE DU TRAVAIL : la photo de repérage prise
-- avant le devis, le plan du géomètre, le PV de réception signé, le
-- courrier du voisin. Des centaines de pièces, rattachées chacune à un
-- client, un chantier, un devis, une facture, un jardin ou une
-- intervention, et que TOUT LE TERRAIN doit pouvoir consulter.
--
-- Fusionner les deux obligerait à choisir une seule permission de
-- lecture : soit on ouvre le RIB à tout le monde, soit on ferme les
-- photos de chantier aux ouvriers. Les deux sont faux. Deux tables,
-- deux seaux, deux permissions.

-- ============================================================
-- 1. Qui a le droit d'écrire un document de travail
-- ============================================================
-- Une SEULE fonction, appelée par la politique de la TABLE et par celle
-- du SEAU.
--
-- Écrire la même condition deux fois, c'est accepter qu'elles divergent
-- un jour : le fichier partirait dans le stockage et la ligne serait
-- refusée, ou l'inverse — un document listé dont personne ne peut
-- ouvrir le fichier. Une fonction rend la divergence impossible.
--
-- Deux permissions, et pas une : `projects.manage` couvre le terrain
-- (photos, PV, plans), `quotes.edit` couvre le commerce (courriers,
-- pièces jointes à un devis). Un commercial qui ne peut pas joindre le
-- plan reçu du client à son devis rangerait la pièce dans sa boîte mail
-- — c'est-à-dire nulle part.
create or replace function public.can_write_documents(p_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.has_permission(p_organization_id, 'projects.manage')
      or public.has_permission(p_organization_id, 'quotes.edit');
$$;

comment on function public.can_write_documents(uuid) is
  'Le droit de déposer ou supprimer un document de travail. Utilisée par la RLS de public.documents ET par la politique du seau work-documents : une seule définition, donc pas de divergence.';

-- ============================================================
-- 2. §21 La table
-- ============================================================
-- Le rattachement suit la convention d'`audit_events` (0058) :
-- `entity_type` / `entity_id`, sans clé étrangère.
--
-- Pas de clé étrangère parce qu'il n'en existe aucune qui pointe vers
-- six tables à la fois, et que six colonnes nullables — `customer_id`,
-- `project_id`, `quote_id`… — donneraient six index, six jointures et
-- la possibilité d'en remplir deux qui se contredisent. `audit_events`
-- a tranché la même question de la même façon ; on ne va pas inventer
-- une seconde convention pour le même problème.
--
-- Ce que la clé étrangère aurait garanti — « l'entité existe, et elle
-- est chez nous » — est rendu par le déclencheur du §3. Ce qu'elle
-- aurait fait en plus — supprimer les documents avec le chantier — est
-- délibérément abandonné : un PV de réception survit au chantier qu'il
-- clôt.
--
-- §21 nomme « client associé » et « projet associé » : ce sont deux cas
-- de CE rattachement, pas deux colonnes. Un document rangé sous un
-- chantier appartient au client de ce chantier — le chantier le sait
-- déjà. Le recopier autoriserait les deux à se contredire.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- §21 « nom » — ce que l'humain lit. Jamais le nom du fichier :
  -- « IMG_4471.jpg » ne se retrouve pas, « Repérage avant travaux » si.
  name text not null check (btrim(name) <> ''),

  -- §21 « type ». Les valeurs décrivent CE QU'EST la pièce, pas son
  -- format : « plan » et « photo » se rangent et se cherchent
  -- différemment, deux PDF non.
  doc_type text not null default 'other' check (doc_type in (
    'photo',          -- repérage, avancement, réception
    'plan',           -- plan du géomètre, esquisse, plan d'exécution
    'report',         -- PV de réception, compte rendu de visite
    'contract',       -- contrat signé, bon de commande, devis contresigné
    'letter',         -- courrier reçu ou envoyé
    'administrative', -- autorisation, déclaration préalable, arrêté
    'other'
  )),

  -- §21 « tags ». Un tableau plutôt qu'une table de liaison : on veut
  -- filtrer et chercher, jamais renommer un tag partout à la fois. Un
  -- index GIN (§4) rend `tags @> array['réception']` immédiat.
  tags text[] not null default '{}',

  -- §21 « métadonnées ». Ce que le dépôt SAIT, pas ce qu'il devine :
  -- nom d'origine du fichier et extension. Rien n'est inventé ici — un
  -- champ vide reste vide.
  metadata jsonb not null default '{}'::jsonb,

  -- La date DU DOCUMENT, distincte de la date de dépôt. Un PV signé le
  -- 3 mars et scanné le 12 est daté du 3 ; c'est cette date-là qu'on
  -- oppose à un client.
  document_date date,
  notes text,

  -- Le rattachement. Nullable : une pièce peut arriver avant qu'on
  -- sache où la ranger, et la forcer produirait des rattachements faux
  -- plutôt que des rattachements absents.
  entity_type text check (entity_type in (
    'customer', 'project', 'quote', 'invoice', 'garden', 'intervention'
  )),
  entity_id uuid,
  -- Les deux ensemble ou aucun des deux. Un `entity_id` orphelin de son
  -- type ne désigne rien, et un type sans identifiant ne range rien.
  constraint documents_entity_complete check (
    (entity_type is null and entity_id is null)
    or (entity_type is not null and entity_id is not null)
  ),

  -- Le chemin dans le seau. UNIQUE : deux lignes qui pointeraient le
  -- même fichier feraient qu'en supprimer une casserait l'autre.
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,

  -- §21 « Préparer plus tard : full-text document content ».
  --
  -- La colonne existe, RIEN NE LA REMPLIT, et c'est volontaire : il n'y
  -- a aujourd'hui aucun extracteur de texte de PDF dans ce projet, et
  -- une colonne remplie d'à-peu-près serait pire que vide — on
  -- chercherait dedans en croyant chercher dans le document.
  --
  -- Le jour où l'extraction existe, il reste à la remplir et à ajouter
  -- son index ; ni la table ni les écrans n'ont à bouger.
  content_text text,

  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.documents is
  'Les documents de TRAVAIL, rattachés à un client, un chantier, un devis, une facture, un jardin ou une intervention (§21). À ne pas confondre avec organization_documents (§45), qui porte les papiers de la société.';
comment on column public.documents.entity_type is
  'Convention d''audit_events : le TYPE de l''entité rattachée, sans clé étrangère. Le déclencheur documents_check_entity vérifie qu''elle existe et qu''elle appartient bien à l''organisation.';
comment on column public.documents.content_text is
  'Réservé au texte extrait du fichier (§21 « préparer plus tard »). Aucun code ne l''écrit aujourd''hui ; il vaut NULL, ce qui veut dire « pas extrait » et non « document vide ».';

-- ============================================================
-- 3. Le rattachement ne traverse pas les entreprises
-- ============================================================
-- Sans clé étrangère, rien n'empêcherait d'écrire l'identifiant du
-- chantier du voisin dans `entity_id`. Le document resterait dans NOTRE
-- organisation — la RLS de la table s'en charge — mais l'écran
-- afficherait « Chantier introuvable » sans jamais dire pourquoi, et un
-- futur rapport joindrait deux mondes qui n'ont rien à voir.
--
-- Le déclencheur est en SECURITY INVOKER : la vérification passe par la
-- RLS de la table visée, exactement comme l'écran qui l'affichera. Une
-- entité qu'on n'a pas le droit de voir n'est pas une entité à laquelle
-- on peut rattacher quoi que ce soit.
create or replace function public.documents_check_entity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  ok boolean := false;
  ws uuid;
begin
  if new.entity_type is null then
    return new;
  end if;

  if new.entity_type = 'customer' then
    select exists (select 1 from public.crm_customers c
                    where c.id = new.entity_id and c.organization_id = new.organization_id)
      into ok;

  elsif new.entity_type = 'project' then
    select exists (select 1 from public.projects p
                    where p.id = new.entity_id and p.organization_id = new.organization_id)
      into ok;

  elsif new.entity_type = 'quote' then
    select exists (select 1 from public.quotes q
                    where q.id = new.entity_id and q.organization_id = new.organization_id)
      into ok;

  elsif new.entity_type = 'invoice' then
    select exists (select 1 from public.invoices i
                    where i.id = new.entity_id and i.organization_id = new.organization_id)
      into ok;

  elsif new.entity_type = 'intervention' then
    select exists (select 1 from public.field_interventions f
                    where f.id = new.entity_id and f.organization_id = new.organization_id)
      into ok;

  elsif new.entity_type = 'garden' then
    -- Un jardin n'a pas d'`organization_id` : il vit dans un ESPACE DE
    -- TRAVAIL depuis la Phase 3, et un jardin livré à son propriétaire
    -- a quitté celui de l'entreprise. `has_garden_access` rattrape ce
    -- cas — le paysagiste garde son accès tant qu'on ne le lui a pas
    -- retiré. C'est exactement la règle que suit la recherche globale.
    select workspace_id into ws
      from public.business_organizations where id = new.organization_id;
    select exists (select 1 from public.gardens g
                    where g.id = new.entity_id
                      and (g.workspace_id = ws or public.has_garden_access(g.id)))
      into ok;
  end if;

  if not ok then
    raise exception 'Rattachement impossible : cette entité n''existe pas dans votre entreprise.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_check_entity on public.documents;
create trigger documents_check_entity
  before insert or update of entity_type, entity_id, organization_id on public.documents
  for each row execute function public.documents_check_entity();

-- ============================================================
-- 4. Les index
-- ============================================================
create index if not exists documents_org_idx
  on public.documents (organization_id, created_at desc);

-- Le filtre « les documents de CE chantier ». L'organisation en tête
-- parce qu'aucune requête ne cherche une entité sans savoir chez qui.
create index if not exists documents_entity_idx
  on public.documents (organization_id, entity_type, entity_id);

create index if not exists documents_type_idx
  on public.documents (organization_id, doc_type);

-- §21 « tags » — cherchables. GIN sur le tableau : `tags @> array[…]`
-- et `tags && array[…]` deviennent des lectures d'index.
create index if not exists documents_tags_idx
  on public.documents using gin (tags);

-- Le même index trigramme que les trente-cinq autres colonnes
-- cherchables (0061), sur la même expression normalisée — un index sur
-- la colonne brute ne servirait à rien, la requête compare des formes
-- sans accents ni majuscules.
create index if not exists trgm_documents_name
  on public.documents using gin (public.oasis_normalize(name) gin_trgm_ops);

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.documents enable row level security;

-- Lecture : TOUT le monde dans l'entreprise, via `projects.read` — la
-- permission que possède jusqu'à l'ouvrier. C'est le point de départ du
-- module : une photo de chantier que l'équipe ne peut pas ouvrir sur le
-- terrain ne sert à personne. C'est aussi la permission portée par
-- l'entrée « Documents » du menu, et ce n'est pas un hasard : la
-- permission d'une entrée est celle qui ouvre sa table principale.
drop policy if exists "Members read work documents" on public.documents;
create policy "Members read work documents" on public.documents
  for select using (public.has_permission(organization_id, 'projects.read'));

-- Écriture : trois politiques distinctes plutôt qu'un `for all`, pour
-- que `with check` porte sur l'organisation de la ligne ÉCRITE et
-- `using` sur celle de la ligne EXISTANTE. Un `for all` qui n'aurait
-- que `using` laisserait déplacer une ligne vers une autre entreprise.
drop policy if exists "Members insert work documents" on public.documents;
create policy "Members insert work documents" on public.documents
  for insert with check (public.can_write_documents(organization_id));

drop policy if exists "Members update work documents" on public.documents;
create policy "Members update work documents" on public.documents
  for update using (public.can_write_documents(organization_id))
  with check (public.can_write_documents(organization_id));

drop policy if exists "Members delete work documents" on public.documents;
create policy "Members delete work documents" on public.documents
  for delete using (public.can_write_documents(organization_id));

-- ============================================================
-- 6. Le seau
-- ============================================================
-- PRIVÉ. Un plan d'exécution, un PV signé et la photo de la maison d'un
-- client n'ont pas d'adresse publique ; l'écran les sert par URL signée
-- d'une heure. C'est la différence avec le seau des logos (0060), qui
-- est public parce qu'un logo s'imprime sur du papier à en-tête.
--
-- Même convention de chemin que `project-photos` (0050) et
-- `organization-documents` (0060) : le PREMIER SEGMENT est
-- l'identifiant de l'organisation, et c'est lui que la politique
-- vérifie.
--
-- Le nom du seau dit « travail » : `documents` tout court se
-- confondrait à l'œil avec `organization-documents`, et se tromper de
-- seau donnerait un RIB dans la liste des photos de chantier.
insert into storage.buckets (id, name, public)
values ('work-documents', 'work-documents', false)
on conflict (id) do nothing;

do $$
begin
  -- Lecture : la même permission que la table. Les deux bouts de la
  -- ligne sont reliés — le dossier vérifié est celui de l'organisation
  -- dont on vérifie la permission — sans quoi la politique ouvrirait
  -- l'accès inter-entreprises.
  execute 'drop policy if exists "Members read work document files" on storage.objects';
  execute $p$
    create policy "Members read work document files" on storage.objects
      for select using (
        bucket_id = 'work-documents'
        and public.has_permission((storage.foldername(name))[1]::uuid, 'projects.read')
      )
  $p$;

  -- Écriture : la fonction du §1, celle-là même qu'appelle la RLS de la
  -- table. Un fichier déposé sans que sa ligne puisse l'être resterait
  -- un octet payant que plus rien ne référence.
  execute 'drop policy if exists "Members write work document files" on storage.objects';
  execute $p$
    create policy "Members write work document files" on storage.objects
      for all using (
        bucket_id = 'work-documents'
        and public.can_write_documents((storage.foldername(name))[1]::uuid)
      )
      with check (
        bucket_id = 'work-documents'
        and public.can_write_documents((storage.foldername(name))[1]::uuid)
      )
  $p$;
end $$;

-- ============================================================
-- 7. §21 · §22 — la recherche globale apprend les documents
-- ============================================================
-- §22 liste « Documents » parmi les groupes de résultats, et §21
-- demande que la recherche couvre « TOUTES les données autorisées du
-- workspace. Pas uniquement les clients. » La fonction de 0061 ne
-- connaissait pas la table, pour la bonne raison qu'elle n'existait
-- pas.
--
-- `global_search` est recréée EN ENTIER à partir de sa définition
-- actuelle (0061), avec une branche de plus. Une fonction plpgsql ne se
-- complète pas par morceaux : la recopier est le seul moyen honnête, et
-- la relire d'un bloc reste le seul endroit où l'on peut vérifier d'un
-- coup d'œil que les vingt-deux branches filtrent toutes sur
-- l'organisation.
--
-- Ce qui change par rapport à 0061, et RIEN D'AUTRE :
--   • une branche `document`, à la fin ;
--   • ce commentaire.

drop function if exists public.global_search(uuid, text, text[], integer);

create or replace function public.global_search(
  p_organization_id uuid,
  p_query text,
  p_types text[] default null,
  p_limit integer default 6
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  icon text,
  url text,
  score real
)
language plpgsql
stable
security invoker
set search_path = public
-- Le seuil par défaut de pg_trgm (0.3) rate « trachy » →
-- « Trachycarpus fortunei » : six lettres sur vingt-et-une font une
-- similarité faible. On le descend pour cette fonction seulement.
set pg_trgm.similarity_threshold = 0.2
as $$
declare
  q text := public.oasis_normalize(btrim(coalesce(p_query, '')));
  d text := public.oasis_digits(coalesce(p_query, ''));
  ws uuid;
begin
  -- Deux caractères au minimum. En dessous, aucun index trigramme ne
  -- peut aider et la requête balaierait vingt tables pour rendre tout
  -- ce qu'elle trouve — c'est-à-dire rien d'utile.
  if length(q) < 2 then
    return;
  end if;

  -- §31 — la barrière explicite, en plus de la RLS. Un appelant qui
  -- passerait l'identifiant d'une autre organisation n'obtiendrait
  -- déjà rien ; ici il n'obtient même pas l'espace de travail.
  if not public.is_organization_member(p_organization_id) then
    return;
  end if;

  select workspace_id into ws from public.business_organizations where id = p_organization_id;

  return query
  with hits as (
    -- ----- CRM -------------------------------------------------
    select 'client'::text as t, c.id, c.display_name as ti,
           nullif(concat_ws(' · ', c.billing_city, c.email), '') as su,
           'clients'::text as ic, '/crm/clients/' || c.id as u,
           greatest(
             similarity(public.oasis_normalize(c.display_name), q),
             case when public.oasis_normalize(c.display_name) like q || '%' then 0.95
                  when public.oasis_normalize(c.display_name) like '%' || q || '%' then 0.7
                  else 0 end,
             case when d <> '' and public.oasis_digits(coalesce(c.phone, '') || coalesce(c.mobile, '')) like '%' || d || '%' then 0.9 else 0 end
           )::real as sc
    from public.crm_customers c
    where c.organization_id = p_organization_id and c.archived_at is null
      and c.lifecycle_stage = 'customer'
      and (public.oasis_normalize(concat_ws(' ', c.display_name, c.legal_name, c.email, c.billing_city, c.siret, c.notes)) like '%' || q || '%'
           or public.oasis_normalize(c.display_name) % q
           or (d <> '' and public.oasis_digits(concat_ws(' ', c.phone, c.mobile, c.siret)) like '%' || d || '%'))

    union all
    select 'prospect', c.id, c.display_name,
           nullif(concat_ws(' · ', c.billing_city, c.email), ''),
           'prospects', '/crm/clients/' || c.id,
           greatest(
             similarity(public.oasis_normalize(c.display_name), q),
             case when public.oasis_normalize(c.display_name) like q || '%' then 0.95
                  when public.oasis_normalize(c.display_name) like '%' || q || '%' then 0.7
                  else 0 end
           )::real
    from public.crm_customers c
    where c.organization_id = p_organization_id and c.archived_at is null
      and c.lifecycle_stage = 'lead'
      and (public.oasis_normalize(concat_ws(' ', c.display_name, c.legal_name, c.email, c.billing_city, c.notes)) like '%' || q || '%'
           or public.oasis_normalize(c.display_name) % q
           or (d <> '' and public.oasis_digits(concat_ws(' ', c.phone, c.mobile)) like '%' || d || '%'))

    union all
    select 'contact', ct.id, btrim(concat_ws(' ', ct.first_name, ct.last_name)),
           nullif(concat_ws(' · ', ct.job_title, ct.email, ct.phone), ''),
           'clients', '/crm/clients/' || ct.customer_id,
           greatest(
             similarity(public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name)), q),
             case when public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name)) like '%' || q || '%' then 0.7 else 0 end,
             case when d <> '' and public.oasis_digits(concat_ws(' ', ct.phone, ct.mobile)) like '%' || d || '%' then 0.9 else 0 end
           )::real
    from public.crm_contacts ct
    where ct.organization_id = p_organization_id and ct.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name, ct.email, ct.job_title)) like '%' || q || '%'
           or public.oasis_normalize(concat_ws(' ', ct.first_name, ct.last_name)) % q
           or (d <> '' and public.oasis_digits(concat_ws(' ', ct.phone, ct.mobile)) like '%' || d || '%'))

    union all
    select 'site', s.id, s.name,
           nullif(concat_ws(' · ', s.city, s.address_line1), ''),
           'locations', '/crm/clients/' || s.customer_id,
           greatest(similarity(public.oasis_normalize(s.name), q),
                    case when public.oasis_normalize(s.name) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.crm_customer_sites s
    where s.organization_id = p_organization_id and s.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', s.name, s.city, s.address_line1)) like '%' || q || '%'
           or public.oasis_normalize(s.name) % q)

    -- ----- Projets ---------------------------------------------
    union all
    select 'project', p.id, p.name,
           nullif(concat_ws(' · ', p.number, pc.display_name), ''),
           'projects', '/projets/' || p.id,
           greatest(similarity(public.oasis_normalize(p.name), q),
                    case when public.oasis_normalize(p.name) like '%' || q || '%' then 0.75 else 0 end,
                    case when public.oasis_normalize(coalesce(pc.display_name, '')) like '%' || q || '%' then 0.6 else 0 end,
                    case when d <> '' and public.oasis_digits(p.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.projects p
    left join public.crm_customers pc on pc.id = p.customer_id
    where p.organization_id = p_organization_id and p.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', p.name, p.number, p.notes, pc.display_name)) like '%' || q || '%'
           or public.oasis_normalize(p.name) % q
           or (d <> '' and public.oasis_digits(p.number) like '%' || d || '%'))

    union all
    select 'intervention', i.id, i.title, to_char(i.scheduled_start, 'DD/MM/YYYY'),
           'interventions', '/projets/interventions/' || i.id,
           greatest(similarity(public.oasis_normalize(i.title), q),
                    case when public.oasis_normalize(i.title) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.field_interventions i
    where i.organization_id = p_organization_id
      and (public.oasis_normalize(concat_ws(' ', i.title, i.instructions)) like '%' || q || '%'
           or public.oasis_normalize(i.title) % q)

    union all
    select 'task', tk.id, tk.title, null,
           'check', '/projets/' || tk.project_id,
           greatest(similarity(public.oasis_normalize(tk.title), q),
                    case when public.oasis_normalize(tk.title) like '%' || q || '%' then 0.6 else 0 end)::real
    from public.project_tasks tk
    where tk.organization_id = p_organization_id
      and (public.oasis_normalize(tk.title) like '%' || q || '%' or public.oasis_normalize(tk.title) % q)

    -- ----- Devis et factures -----------------------------------
    union all
    -- §21 « numéro ; client ; projet ; description ». Le nom du
    -- client fait partie de ce qu'on tape pour retrouver un devis —
    -- personne ne se souvient d'un numéro. Il figure aussi en
    -- sous-titre : trois devis « Jardin méditerranéen » chez trois
    -- clients seraient sinon indiscernables.
    --
    -- Le MONTANT, que §21 cite pour les factures, n'est pas cherché :
    -- « 1500 » désignerait aussi bien un total qu'un numéro, et rendre
    -- les deux transformerait chaque recherche de numéro en liste de
    -- factures sans rapport.
    select 'quote', qt.id, qt.title,
           nullif(concat_ws(' · ', qt.number, qc.display_name), ''),
           'quote', '/devis/' || qt.id,
           greatest(similarity(public.oasis_normalize(qt.title), q),
                    case when public.oasis_normalize(qt.title) like '%' || q || '%' then 0.75 else 0 end,
                    case when public.oasis_normalize(coalesce(qc.display_name, '')) like '%' || q || '%' then 0.6 else 0 end,
                    case when d <> '' and public.oasis_digits(qt.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.quotes qt
    left join public.crm_customers qc on qc.id = qt.customer_id
    where qt.organization_id = p_organization_id and qt.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', qt.title, qt.number, qc.display_name)) like '%' || q || '%'
           or public.oasis_normalize(qt.title) % q
           or (d <> '' and public.oasis_digits(qt.number) like '%' || d || '%'))

    -- §21 DEVIS — « lignes ; articles ; végétaux ». Chercher « Olivier »
    -- doit retrouver le devis qui en contient, pas seulement ceux qui
    -- s'appellent ainsi. On rend le DEVIS, jamais la ligne : le client
    -- ne veut pas ouvrir une ligne, il veut ouvrir son devis.
    union all
    select distinct on (ql.quote_id)
           'quote_line', ql.quote_id, qt2.title, 'Contient « ' || ql.description || ' »',
           'quote', '/devis/' || ql.quote_id,
           0.55::real
    from public.quote_lines ql
    join public.quotes qt2 on qt2.id = ql.quote_id
    where ql.organization_id = p_organization_id and qt2.archived_at is null
      and public.oasis_normalize(ql.description) like '%' || q || '%'

    union all
    select 'invoice', inv.id, coalesce(inv.number, 'Brouillon'),
           nullif(concat_ws(' · ', ic.display_name, to_char(inv.issued_on, 'DD/MM/YYYY')), ''),
           'invoice', '/factures/' || inv.id,
           greatest(case when public.oasis_normalize(coalesce(inv.number, '')) like '%' || q || '%' then 0.85 else 0 end,
                    case when public.oasis_normalize(coalesce(ic.display_name, '')) like '%' || q || '%' then 0.6 else 0 end,
                    case when d <> '' and public.oasis_digits(coalesce(inv.number, '')) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.invoices inv
    left join public.crm_customers ic on ic.id = inv.customer_id
    where inv.organization_id = p_organization_id and inv.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', inv.number, ic.display_name)) like '%' || q || '%'
           or (d <> '' and public.oasis_digits(coalesce(inv.number, '')) like '%' || d || '%'))

    -- ----- Digital Twin ----------------------------------------
    -- Cloisonné par ESPACE DE TRAVAIL, pas par organisation : c'est
    -- ainsi depuis la Phase 3, et un jardin livré à son propriétaire a
    -- quitté l'espace de l'entreprise. `has_garden_access` rattrape ce
    -- cas — le professionnel garde son accès tant qu'on ne le lui a pas
    -- retiré.
    union all
    select 'garden', g.id, g.name, coalesce(g.address, g.location_name),
           'twin', '/digital-twin/' || g.id,
           greatest(similarity(public.oasis_normalize(g.name), q),
                    case when public.oasis_normalize(g.name) like '%' || q || '%' then 0.75 else 0 end)::real
    from public.gardens g
    where g.deleted_at is null
      and (g.workspace_id = ws or public.has_garden_access(g.id))
      and (public.oasis_normalize(concat_ws(' ', g.name, g.address, g.location_name)) like '%' || q || '%'
           or public.oasis_normalize(g.name) % q)

    union all
    select 'garden_area', a.id, a.name, 'Zone',
           'locations', '/digital-twin/' || a.garden_id,
           greatest(similarity(public.oasis_normalize(a.name), q),
                    case when public.oasis_normalize(a.name) like '%' || q || '%' then 0.6 else 0 end)::real
    from public.garden_areas a
    where a.deleted_at is null and a.name is not null
      and (a.workspace_id = ws or public.has_garden_access(a.garden_id))
      and (public.oasis_normalize(a.name) like '%' || q || '%' or public.oasis_normalize(a.name) % q)

    -- §21 : « Olivier Martin doit retrouver l'Olivier du Digital Twin
    -- concerné. » Le sous-titre nomme le jardin, sans quoi trois
    -- oliviers de trois clients seraient indiscernables.
    union all
    select 'garden_object', o.id, o.label, g2.name,
           'twin', '/digital-twin/' || o.garden_id,
           greatest(similarity(public.oasis_normalize(o.label), q),
                    case when public.oasis_normalize(o.label) like '%' || q || '%' then 0.65 else 0 end)::real
    from public.garden_map_objects o
    join public.gardens g2 on g2.id = o.garden_id
    where o.deleted_at is null and o.label is not null and btrim(o.label) <> ''
      and (o.workspace_id = ws or public.has_garden_access(o.garden_id))
      and (public.oasis_normalize(o.label) like '%' || q || '%' or public.oasis_normalize(o.label) % q)

    union all
    select 'plant', pl.id,
           coalesce(nullif(pl.custom_name, ''), pl.common_name, pl.scientific_name),
           nullif(concat_ws(' · ', pl.scientific_name, g3.name), ''),
           'nursery', '/digital-twin/' || pl.garden_id,
           greatest(similarity(public.oasis_normalize(concat_ws(' ', pl.custom_name, pl.common_name, pl.scientific_name)), q),
                    case when public.oasis_normalize(concat_ws(' ', pl.custom_name, pl.common_name, pl.scientific_name)) like '%' || q || '%' then 0.65 else 0 end)::real
    from public.plants pl
    left join public.gardens g3 on g3.id = pl.garden_id
    where pl.deleted_at is null and pl.is_archived is not true and pl.garden_id is not null
      and (pl.workspace_id = ws or public.has_garden_access(pl.garden_id))
      and (public.oasis_normalize(concat_ws(' ', pl.custom_name, pl.common_name, pl.scientific_name)) like '%' || q || '%'
           or public.oasis_normalize(coalesce(pl.scientific_name, pl.common_name, '')) % q)

    -- ----- Pépinière -------------------------------------------
    union all
    select 'lot', l.id, l.lot_code,
           nullif(concat_ws(' ', l.species_name, l.cultivar, l.container_size), ''),
           'lots', '/pepiniere/lots/' || l.id,
           greatest(similarity(public.oasis_normalize(concat_ws(' ', l.species_name, l.cultivar)), q),
                    case when public.oasis_normalize(l.lot_code) like '%' || q || '%' then 0.9 else 0 end,
                    case when public.oasis_normalize(concat_ws(' ', l.species_name, l.cultivar)) like '%' || q || '%' then 0.75 else 0 end,
                    case when d <> '' and public.oasis_digits(l.lot_code) like '%' || d || '%' then 0.9 else 0 end)::real
    from public.nursery_lots l
    where l.organization_id = p_organization_id and l.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', l.lot_code, l.species_name, l.cultivar, l.supplier_lot_reference, l.container_size)) like '%' || q || '%'
           or public.oasis_normalize(concat_ws(' ', l.species_name, l.cultivar)) % q
           or (d <> '' and public.oasis_digits(l.lot_code) like '%' || d || '%'))

    union all
    select 'location', loc.id, loc.name, loc.code,
           'locations', '/pepiniere/emplacements',
           greatest(similarity(public.oasis_normalize(loc.name), q),
                    case when public.oasis_normalize(concat_ws(' ', loc.name, loc.code)) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.nursery_locations loc
    where loc.organization_id = p_organization_id and loc.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', loc.name, loc.code)) like '%' || q || '%'
           or public.oasis_normalize(loc.name) % q)

    -- ----- Achats et ventes ------------------------------------
    union all
    select 'supplier', sp.id, sp.name,
           nullif(concat_ws(' · ', sp.city, sp.email), ''),
           'supplier', '/fournisseurs',
           greatest(similarity(public.oasis_normalize(sp.name), q),
                    case when public.oasis_normalize(sp.name) like '%' || q || '%' then 0.8 else 0 end)::real
    from public.suppliers sp
    where sp.organization_id = p_organization_id and sp.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', sp.name, sp.reference, sp.email, sp.city)) like '%' || q || '%'
           or public.oasis_normalize(sp.name) % q)

    union all
    select 'purchase_order', po.id, po.number, po.reference,
           'purchase', '/achats/' || po.id,
           greatest(case when public.oasis_normalize(concat_ws(' ', po.number, po.reference)) like '%' || q || '%' then 0.8 else 0 end,
                    case when d <> '' and public.oasis_digits(po.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.purchase_orders po
    where po.organization_id = p_organization_id and po.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', po.number, po.reference)) like '%' || q || '%'
           or (d <> '' and public.oasis_digits(po.number) like '%' || d || '%'))

    union all
    select 'sales_order', so.id, so.number, so.reference,
           'orders', '/pepiniere/commandes/' || so.id,
           greatest(case when public.oasis_normalize(concat_ws(' ', so.number, so.reference)) like '%' || q || '%' then 0.8 else 0 end,
                    case when d <> '' and public.oasis_digits(so.number) like '%' || d || '%' then 0.95 else 0 end)::real
    from public.sales_orders so
    where so.organization_id = p_organization_id and so.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', so.number, so.reference)) like '%' || q || '%'
           or (d <> '' and public.oasis_digits(so.number) like '%' || d || '%'))

    -- ----- Équipe et catalogue ---------------------------------
    union all
    select 'employee', e.id, btrim(concat_ws(' ', e.first_name, e.last_name)), e.job_title,
           'team', '/equipes',
           greatest(similarity(public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name)), q),
                    case when public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name, e.job_title)) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.employees e
    where e.organization_id = p_organization_id and e.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name, e.job_title, e.email)) like '%' || q || '%'
           or public.oasis_normalize(concat_ws(' ', e.first_name, e.last_name)) % q)

    union all
    select 'catalog_item', ci.id, ci.name, ci.reference,
           'lots', '/catalogue',
           greatest(similarity(public.oasis_normalize(ci.name), q),
                    case when public.oasis_normalize(concat_ws(' ', ci.name, ci.reference)) like '%' || q || '%' then 0.7 else 0 end)::real
    from public.catalog_items ci
    where ci.organization_id = p_organization_id and ci.archived_at is null
      and (public.oasis_normalize(concat_ws(' ', ci.name, ci.reference, ci.description)) like '%' || q || '%'
           or public.oasis_normalize(ci.name) % q)

    -- ----- Documents de travail (0068) -------------------------
    -- §22 « Documents ». On cherche le NOM, les TAGS et les NOTES.
    --
    -- Pas `content_text` : la colonne est vide par construction (§2), et
    -- une branche qui prétendrait chercher dedans mentirait sur ce que
    -- la recherche couvre. Le jour où l'extraction existe, il suffira
    -- de l'ajouter au `concat_ws` — et de lui donner son index.
    --
    -- Le sous-titre porte les tags : c'est ce qui distingue deux
    -- « Photo de repérage » déposées le même jour sur deux chantiers.
    union all
    select 'document', dc.id, dc.name,
           nullif(array_to_string(dc.tags, ' · '), ''),
           'document', '/documents?document=' || dc.id,
           greatest(similarity(public.oasis_normalize(dc.name), q),
                    case when public.oasis_normalize(dc.name) like q || '%' then 0.9
                         when public.oasis_normalize(dc.name) like '%' || q || '%' then 0.7
                         else 0 end,
                    case when public.oasis_normalize(array_to_string(dc.tags, ' ')) like '%' || q || '%' then 0.65 else 0 end)::real
    from public.documents dc
    where dc.organization_id = p_organization_id
      and (public.oasis_normalize(concat_ws(' ', dc.name, dc.notes, array_to_string(dc.tags, ' '))) like '%' || q || '%'
           or public.oasis_normalize(dc.name) % q)
  ),
  filtered as (
    select * from hits
    -- §25-26 — le filtre par famille, et la syntaxe `type:devis`.
    where p_types is null or t = any (p_types)
  ),
  ranked as (
    select *, row_number() over (partition by t order by sc desc, ti) as rang
    from filtered
  )
  -- §22 : « Limiter résultats initiaux » — au plus `p_limit` par
  -- famille. Une recherche sur « Martin » qui rendrait quarante
  -- clients et deux devis cacherait les devis sous les clients.
  select r.t, r.id, r.ti, r.su, r.ic, r.u, r.sc
  from ranked r
  where r.rang <= p_limit
  order by r.sc desc, r.ti;
end;
$$;
