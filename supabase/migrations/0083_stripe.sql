-- Oasis Care — LE LIEN ENTRE NOS PRIX ET CEUX DU PRESTATAIRE
-- Migration 0083. Elle suit 0081 (Control Center, la facturation SaaS)
-- et 0082 (agents IA), et elle ne modifie NI l'une NI l'autre.
--
-- ============================================================
-- LA RÈGLE QUI COMMANDE TOUT CE FICHIER
-- ============================================================
--
--   LE PRESTATAIRE ENCAISSE. OASIS CARE FACTURE.
--
-- Stripe — ou Revolut Business, ou celui qui viendra après — prend
-- l'argent et dit QUAND il est pris. Il n'émet AUCUN document légal
-- pour nous. La facture française, numérotée séquentiellement et sans
-- trou, est celle que `saas_issue_invoice()` produit depuis 0081, et
-- elle reste la seule.
--
-- CE FICHIER NE CRÉE DONC AUCUNE SECONDE NUMÉROTATION. Pas une table
-- de documents, pas une nature de compteur de plus dans
-- `saas_document_counters` : les deux natures restent 'invoice' et
-- 'creditNote'. Le test le vérifie par requête, parce que c'est
-- exactement le genre de chose qu'on ajoute six mois plus tard en
-- croyant bien faire.
--
-- CE QU'UN ÉVÉNEMENT DU PRESTATAIRE PRODUIT ICI, et rien d'autre :
--   • une ligne dans le journal des événements reçus ;
--   • éventuellement un ENCAISSEMENT posé sur une facture que NOUS
--     avons déjà émise.
--
-- ============================================================
-- LES PRIX SONT HORS TAXES, ET C'EST UNE RÈGLE DE CALCUL
-- ============================================================
--
-- 0081 traite `organization_plans.monthly_price_cents` comme une BASE
-- TAXABLE : `saas_subscription_billing_lines` recopie le montant tel
-- quel dans `unit_price_cents` et met le taux À CÔTÉ, puis
-- `saas_invoice_totals` fait `ttc = ht + round(ht * taux / 100)`.
-- Aucune division par (1 + taux) nulle part. 79,90 est donc du HT, et
-- une entreprise française règle 95,88.
--
-- CONSÉQUENCE DIRECTE SUR LA CORRESPONDANCE : un tarif enregistré chez
-- le prestataire doit valoir le montant HORS TAXES et porter un
-- comportement de taxe « exclusive ». Un tarif « toutes taxes
-- comprises » à 9 588 ferait payer 95,88 à un client néerlandais en
-- autoliquidation, dont 15,98 de TVA française qu'il ne doit pas et
-- que nous n'avons aucun droit de collecter. La colonne
-- `tax_behavior` existe pour que ce fichier le dise à voix haute, et
-- sa contrainte n'admet qu'une valeur : le jour où quelqu'un aura
-- besoin d'un tarif TTC, ce sera une migration délibérée, pas une
-- ligne saisie de travers.
--
-- ============================================================
-- CE QUE CE FICHIER POSE
-- ============================================================
--
--   1. `billing_providers`             — le catalogue des prestataires.
--   2. `billing_provider_prices`       — NOTRE objet tarifable ↔ la clé
--                                        du prestataire, par MODE.
--   3. `billing_provider_customers`    — l'identifiant du client chez
--                                        le prestataire.
--   4. `billing_provider_events`       — le journal des événements
--                                        reçus, en AJOUT SEUL, dont
--                                        l'unicité FAIT l'idempotence.
--   5. Le chaînon manquant de l'encaissement : une unicité sur
--      `saas_invoice_payments`, un lien vers l'événement, et une porte
--      d'écriture pour la machine — parce qu'aucune n'existait.
--
-- SANS AUCUN SECRET. Ce fichier ne contient ni clé, ni jeton, ni
-- empreinte de secret de signature. Les variables d'environnement sont
-- nommées dans le compte rendu du chantier, pas ici.


-- ============================================================
-- 1. LE CATALOGUE DES PRESTATAIRES
-- ============================================================
--
-- POURQUOI UNE TABLE PLUTÔT QU'UNE CONTRAINTE `check (provider in
-- ('stripe'))`. Le dirigeant a hésité entre Stripe et Revolut Business,
-- et une table qui suppose un seul prestataire devra être refaite le
-- jour où il change d'avis — ou le jour où les deux coexistent pendant
-- une migration. Ajouter un prestataire devient alors un `insert`, pas
-- un `alter table ... drop constraint` sur une table qui porte de
-- l'argent.
--
-- `is_active` ne veut PAS dire « configuré » : il veut dire « retenu ».
-- Une clé d'API absente ne se lit pas en base, elle se lit dans
-- l'environnement du serveur — et prétendre le contraire ferait croire
-- que la base sait si l'encaissement fonctionne.

create table if not exists public.billing_providers (
  key text primary key
    check (key = lower(btrim(key)) and length(key) between 2 and 40),
  label text not null,
  is_active boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

alter table public.billing_providers enable row level security;

-- Le catalogue est lisible par tout compte connecté, comme
-- `organization_plans` et `platform_modules` : savoir que l'encaissement
-- passe par Stripe n'est pas un secret, et l'écran d'abonnement de
-- `web-pro` doit pouvoir le nommer au client.
drop policy if exists "Tout compte connecté lit le catalogue des prestataires" on public.billing_providers;
create policy "Tout compte connecté lit le catalogue des prestataires" on public.billing_providers
  for select using (auth.uid() is not null);

insert into public.billing_providers (key, label, is_active, note) values
  ('stripe', 'Stripe', true,
   'Prestataire d''encaissement retenu. Il ENCAISSE ; il n''émet aucun document légal pour Oasis Care. '
   'L''envoi de ses e-mails de facture doit rester désactivé dans son tableau de bord, sans quoi le client '
   'recevrait deux documents numérotés différemment pour un seul achat.'),
  ('revolut', 'Revolut Business', false,
   'Étudié puis écarté au profit de Stripe. La ligne existe pour que la table ne suppose pas un prestataire unique : '
   'le jour où il faudrait basculer, c''est un insert et des correspondances neuves, pas une migration de contrainte.')
on conflict (key) do nothing;

comment on table public.billing_providers is
  'Les prestataires d''encaissement. Une table et non une contrainte « check » : le prestataire a déjà changé une fois dans les intentions du dirigeant.';


-- ============================================================
-- 2. LA CORRESPONDANCE — NOS PRIX ↔ CEUX DU PRESTATAIRE
-- ============================================================
--
-- NOTRE PRIX RESTE LA SOURCE DE VÉRITÉ. `organization_plans`,
-- `plan_modules` et `discount_offers` décident ; cette table ne porte
-- qu'un POINTEUR vers l'objet équivalent chez le prestataire, plus une
-- COPIE du montant destinée uniquement à détecter la dérive.
--
-- POURQUOI LA COLONNE `mode` N'EST PAS UN CONFORT. Une clé de tarif
-- Stripe est une chaîne opaque, DIFFÉRENTE en essai et en production.
-- Une correspondance enregistrée en essai ne vaut RIEN en production :
-- employée là-bas, elle ne lève pas d'erreur, elle encaisse zéro euro.
-- Le mode fait partie de l'identité de la ligne, pas de ses attributs.
--
-- POURQUOI ON RECOPIE `unit_amount_cents`. Un tarif chez le prestataire
-- est IMMUABLE : changer un montant crée un nouveau tarif et laisse
-- l'ancien vivant. Sans cette copie, une grille modifiée dans le
-- Control Center continuerait de facturer l'ancien montant, en
-- silence, jusqu'à ce qu'un client s'en aperçoive. Avec elle,
-- `billing_provider_price_terms()` compare et REFUSE — jamais un
-- montant deviné, jamais zéro.
--
-- POURQUOI ON DÉSACTIVE PLUTÔT QUE DE SUPPRIMER. La ligne dit ce qui a
-- été facturé, et un remboursement se fait sur le tarif d'origine.

create table if not exists public.billing_provider_prices (
  id uuid primary key default gen_random_uuid(),

  provider text not null references public.billing_providers (key) on delete restrict,
  mode text not null check (mode in ('test', 'live')),

  -- LES QUATRE CHOSES QUE 0081 SAIT FACTURER. Une cinquième nature
  -- devra passer par une migration, et c'est voulu : « autre » serait
  -- une case où l'on range ce qu'on n'a pas compris.
  kind text not null check (kind in ('plan', 'seat', 'module', 'discount')),

  plan_key text references public.organization_plans (key) on delete restrict,
  billing_cycle text check (billing_cycle in ('monthly', 'yearly')),
  module_key text references public.platform_modules (key) on delete restrict,
  discount_code text references public.discount_offers (code) on delete restrict,

  -- Le produit chez le prestataire. Nullable : certains prestataires
  -- n'ont pas cette notion, et l'inventer serait un champ toujours vide.
  provider_product_id text
    check (provider_product_id is null or btrim(provider_product_id) <> ''),
  -- LE POINTEUR. C'est la seule chose que ce fichier emprunte au
  -- prestataire, et elle ne décide de rien : elle désigne.
  provider_price_id text not null
    check (btrim(provider_price_id) <> ''),

  -- LA COPIE DE CONTRÔLE, en centimes entiers. Strictement positive :
  -- un tarif à zéro chez le prestataire encaisserait zéro sans lever
  -- la moindre erreur, et c'est exactement la panne qu'on ne verrait
  -- pas. Une offre gratuite ne se vend pas par un prestataire.
  unit_amount_cents bigint not null check (unit_amount_cents > 0),
  currency text not null default 'EUR' check (currency = upper(currency) and length(currency) = 3),

  -- HORS TAXES, ET RIEN D'AUTRE. Voir l'en-tête du fichier.
  tax_behavior text not null default 'exclusive'
    check (tax_behavior = 'exclusive'),

  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users (id) on delete set null,

  -- Quand la correspondance a été confrontée au prestataire pour la
  -- dernière fois. Nullable : une ligne saisie à la main n'a jamais été
  -- confrontée, et prétendre le contraire serait pire que de l'ignorer.
  synced_at timestamptz,

  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  audit_event_id uuid references public.admin_audit_events (id) on delete set null,

  -- LA FORME DE LA CLÉ DÉPEND DE LA NATURE, et la base la vérifie. Sans
  -- cette contrainte, une ligne « module » sans `module_key` serait
  -- acceptée et ne désignerait rien — une correspondance qui pointe
  -- vers le vide est pire qu'une correspondance absente, parce que la
  -- première a l'air d'exister.
  constraint billing_provider_prices_shape check (
    case kind
      -- Un forfait et son cycle. Le siège supplémentaire aussi : son
      -- prix est porté par l'offre (`extra_seat_monthly_price_cents`),
      -- pas par le produit.
      when 'plan'   then plan_key is not null and billing_cycle is not null
                         and module_key is null and discount_code is null
      when 'seat'   then plan_key is not null and billing_cycle is not null
                         and module_key is null and discount_code is null
      -- Un module a un prix DANS UNE OFFRE, jamais en soi : BioLab vaut
      -- 20 € sur Pro et zéro sur Pro Business. `plan_key` est donc
      -- obligatoire ici, et c'est la traduction directe de la matrice
      -- offre × module de 0081.
      when 'module' then plan_key is not null and billing_cycle is not null
                         and module_key is not null and discount_code is null
      -- Une remise peut viser une offre précise (`plan_key` renseigné)
      -- ou s'appliquer quelle que soit l'offre (`plan_key` nul).
      when 'discount' then discount_code is not null and billing_cycle is not null
                         and module_key is null
      else false
    end
  ),

  constraint billing_provider_prices_deactivation_coherent
    check (is_active = (deactivated_at is null)),

  -- UN TARIF DU PRESTATAIRE NE SERT QU'UNE CASE, active ou non. Deux
  -- cases qui pointeraient le même tarif rendraient tout rapprochement
  -- ambigu : un encaissement ne dirait plus ce qui a été vendu.
  constraint billing_provider_prices_one_slot_per_provider_price
    unique (provider, mode, provider_price_id)
);

-- UNE SEULE VÉRITÉ PAR CASE, MAIS SEULEMENT PARMI LES LIGNES ACTIVES.
-- L'historique doit pouvoir contenir trois tarifs successifs pour
-- « Pro / mensuel / essai » ; ce qui ne doit jamais exister, c'est deux
-- tarifs actifs pour cette même case, parce qu'alors plus rien ne dit
-- lequel encaisser.
--
-- `coalesce(..., '')` PLUTÔT QUE LES COLONNES NUES : en SQL, deux NULL
-- ne sont pas égaux, et un index unique sur des colonnes nullables
-- laisserait passer autant de doublons qu'on veut dès qu'une des
-- colonnes est vide — exactement le cas de `module_key` sur une ligne
-- de forfait.
create unique index if not exists billing_provider_prices_active_slot_idx
  on public.billing_provider_prices (
    provider, mode, kind,
    coalesce(plan_key, ''), coalesce(billing_cycle, ''),
    coalesce(module_key, ''), coalesce(discount_code, ''))
  where is_active;

create index if not exists billing_provider_prices_lookup_idx
  on public.billing_provider_prices (provider, mode, kind, plan_key);

alter table public.billing_provider_prices enable row level security;

-- LA CORRESPONDANCE N'EST PAS UNE DONNÉE CLIENT. Un client n'a rien à
-- faire de nos clés de tarif : ce qu'il doit savoir — le prix, et si le
-- paiement est disponible — lui parvient par
-- `billing_provider_price_terms()` juste en dessous, qui est une
-- fonction et non une table.
drop policy if exists "Les habilités lisent la correspondance des tarifs" on public.billing_provider_prices;
create policy "Les habilités lisent la correspondance des tarifs" on public.billing_provider_prices
  for select using (public.platform_admin_can('billing.providers.read'));

comment on table public.billing_provider_prices is
  'NOS objets tarifables ↔ les clés de tarif du prestataire, PAR MODE. Notre prix reste la source de vérité ; '
  'unit_amount_cents n''est qu''une copie de contrôle qui sert à détecter la dérive et à refuser plutôt qu''à deviner.';
comment on column public.billing_provider_prices.mode is
  'test ou live. Une correspondance d''essai employée en production n''échoue pas : elle encaisse zéro. Le mode fait partie de l''identité de la ligne.';
comment on column public.billing_provider_prices.unit_amount_cents is
  'Copie du montant HORS TAXES enregistré chez le prestataire. Sert UNIQUEMENT à détecter la dérive avec notre grille ; ne fait jamais autorité.';
comment on column public.billing_provider_prices.tax_behavior is
  'Toujours « exclusive » : nos prix sont hors taxes. Un tarif TTC ferait payer la TVA française à un client en autoliquidation.';


-- ============================================================
-- 3. L'IDENTIFIANT DU CLIENT CHEZ LE PRESTATAIRE
-- ============================================================
--
-- NULLABLE PAR L'ABSENCE DE LIGNE, et non par une colonne vide sur
-- l'organisation : tant qu'aucun paiement n'a eu lieu, il n'y a rien à
-- écrire, et une colonne nulle sur `business_organizations` aurait
-- obligé chaque lecteur de cette table à connaître Stripe.
--
-- LA CLÉ PRIMAIRE EST CE QUI GARANTIT L'UNICITÉ, pas un « select puis
-- insert » applicatif. Deux onglets ouverts en même temps créeraient
-- deux clients chez le prestataire — c'est-à-dire deux historiques de
-- paiement, deux moyens de paiement enregistrés, et un remboursement
-- qui part du mauvais.
--
-- ON NE RÉEMPLOIE PAS `organization_subscriptions.external_reference`
-- (colonne de 0060) : elle n'a ni unicité, ni mode, et elle sert déjà
-- de référence externe générique. Y loger le client du prestataire la
-- rendrait ambiguë le jour où l'abonnement du prestataire aura besoin
-- d'y vivre aussi.

create table if not exists public.billing_provider_customers (
  organization_id uuid not null references public.business_organizations (id) on delete restrict,
  provider text not null references public.billing_providers (key) on delete restrict,
  mode text not null check (mode in ('test', 'live')),

  provider_customer_id text not null check (btrim(provider_customer_id) <> ''),

  created_at timestamptz not null default now(),
  -- Qui a créé le lien. NUL quand c'est la machine : un traitement
  -- automatique n'a pas de compte, et lui en inventer un serait pire.
  created_by uuid references auth.users (id) on delete set null,
  note text,

  primary key (organization_id, provider, mode),

  -- ET DANS L'AUTRE SENS : un client du prestataire n'appartient qu'à
  -- UNE entreprise. Sans cette unicité, deux entreprises pourraient
  -- pointer le même client, et un encaissement ne dirait plus qui a payé.
  constraint billing_provider_customers_one_org_per_customer
    unique (provider, mode, provider_customer_id)
);

alter table public.billing_provider_customers enable row level security;

drop policy if exists "Les habilités lisent les clients du prestataire" on public.billing_provider_customers;
create policy "Les habilités lisent les clients du prestataire" on public.billing_provider_customers
  for select using (public.platform_admin_can('billing.providers.read'));

comment on table public.billing_provider_customers is
  'L''identifiant de l''entreprise chez le prestataire, par mode. La clé primaire — et non un contrôle applicatif — est ce qui empêche de créer deux clients pour une même entreprise.';


-- ============================================================
-- 4. LE JOURNAL DES ÉVÉNEMENTS REÇUS — EN AJOUT SEUL
-- ============================================================
--
-- UN WEBHOOK REÇOIT DES DOUBLONS, DES ÉVÉNEMENTS DANS LE DÉSORDRE ET
-- DES REJEUX. Ce n'est pas une hypothèse pessimiste : c'est le
-- fonctionnement normal d'un service qui garantit « au moins une »
-- livraison. Deux livraisons simultanées du même « paiement reçu »
-- liraient toutes les deux « pas encore traité » et enregistreraient
-- deux encaissements.
--
-- C'EST DONC LA CONTRAINTE D'UNICITÉ QUI FAIT L'IDEMPOTENCE, jamais un
-- « if déjà traité » applicatif qui perd la course. Le gestionnaire
-- INSÈRE D'ABORD ; si l'insertion viole l'unicité, l'événement a déjà
-- été pris en charge et on s'arrête là. C'est la forme du webhook Apple
-- (`supabase/functions/apple-subscription-webhook`, unicité sur
-- (transaction_id, event_type)), transposée.
--
-- CE QUE LE JOURNAL NE CONTIENT PAS : le corps complet de l'événement.
-- On garde un RÉSUMÉ. Un webhook de paiement transporte des données
-- personnelles et des empreintes de moyen de paiement ; les recopier
-- intégralement dans une table lue par des administrateurs serait
-- augmenter la surface sans rien gagner — le prestataire garde
-- l'original et sait le rejouer.

create table if not exists public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),

  provider text not null references public.billing_providers (key) on delete restrict,
  mode text not null check (mode in ('test', 'live')),

  -- L'IDENTIFIANT CHEZ LE PRESTATAIRE. C'est lui qui porte l'unicité.
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  event_type text not null check (btrim(event_type) <> ''),
  api_version text,

  -- L'instant que le prestataire a daté, distinct de celui où nous
  -- l'avons reçu : un rejeu de trois jours arrive aujourd'hui et parle
  -- d'avant-hier, et confondre les deux rendrait tout l'ordre faux.
  occurred_at timestamptz,
  received_at timestamptz not null default now(),

  summary jsonb,

  -- LE CYCLE DE VIE, EN DEUX ÉTATS SEULEMENT. « pending » à
  -- l'insertion, puis un état terminal une fois pour toutes.
  outcome text not null default 'pending'
    check (outcome in ('pending', 'applied', 'ignored', 'failed')),
  processed_at timestamptz,
  error text,

  constraint billing_provider_events_outcome_coherent
    check ((outcome = 'pending') = (processed_at is null)),
  constraint billing_provider_events_error_only_on_failure
    check (error is null or outcome = 'failed'),

  -- LA CONTRAINTE QUI FAIT TOUT LE TRAVAIL.
  constraint billing_provider_events_unique_per_provider
    unique (provider, provider_event_id)
);

create index if not exists billing_provider_events_when_idx
  on public.billing_provider_events (received_at desc);
create index if not exists billing_provider_events_pending_idx
  on public.billing_provider_events (received_at) where outcome = 'pending';
create index if not exists billing_provider_events_type_idx
  on public.billing_provider_events (provider, mode, event_type, received_at desc);

alter table public.billing_provider_events enable row level security;

drop policy if exists "Les habilités lisent le journal du prestataire" on public.billing_provider_events;
create policy "Les habilités lisent le journal du prestataire" on public.billing_provider_events
  for select using (public.platform_admin_can('billing.providers.read'));

comment on table public.billing_provider_events is
  'Le journal des événements reçus du prestataire, en ajout seul. C''est la contrainte d''unicité (provider, provider_event_id) '
  'qui garantit l''idempotence — pas une vérification applicative, qui perdrait la course sur deux livraisons simultanées.';

-- ------------------------------------------------------------
-- 4.a AJOUT SEUL, TENU PAR UN DÉCLENCHEUR
-- ------------------------------------------------------------
-- Un journal qu'on peut réécrire ne prouve rien, et c'est justement
-- quand quelqu'un veut effacer une ligne qu'il faut qu'elle reste.
--
-- LA SEULE MODIFICATION ADMISE est la CLÔTURE : passer de « pending » à
-- un état terminal, une fois. Tout le reste — le prestataire, le mode,
-- l'identifiant, la nature, le résumé, la date de réception — est figé
-- dès l'insertion. Et une ligne close ne se rouvre pas : un rejeu
-- ultérieur du même événement est déjà refusé par l'unicité, alors
-- « rejouer en repassant en pending » serait un contournement.

create or replace function public.billing_provider_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Le journal du prestataire est en ajout seul : l''événement % ne se supprime pas.', old.provider_event_id
      using errcode = '23514';
  end if;

  if new.provider is distinct from old.provider
     or new.mode is distinct from old.mode
     or new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.api_version is distinct from old.api_version
     or new.occurred_at is distinct from old.occurred_at
     or new.received_at is distinct from old.received_at
     or new.summary is distinct from old.summary
  then
    raise exception 'Journal en ajout seul : le contenu de l''événement % ne se réécrit pas, seule sa clôture s''écrit.', old.provider_event_id
      using errcode = '23514';
  end if;

  if old.processed_at is not null then
    raise exception 'L''événement % est déjà clos (%) : on ne le rejoue pas en le rouvrant.', old.provider_event_id, old.outcome
      using errcode = '23514';
  end if;

  if new.processed_at is null then
    raise exception 'Clôturer un événement, c''est le dater : processed_at est obligatoire.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_billing_provider_events_append_only on public.billing_provider_events;
create trigger trg_billing_provider_events_append_only
  before update or delete on public.billing_provider_events
  for each row execute function public.billing_provider_events_append_only();

-- `truncate` ne déclenche AUCUN déclencheur « for each row » : sans
-- cette seconde barrière, un `truncate` viderait le journal en silence
-- et le prochain rejeu de chaque événement produirait un second
-- encaissement. On réemploie `refuse_truncate()`, posée par 0081.
drop trigger if exists billing_provider_events_no_truncate on public.billing_provider_events;
create trigger billing_provider_events_no_truncate
  before truncate on public.billing_provider_events
  for each statement execute function public.refuse_truncate();

revoke all on function public.billing_provider_events_append_only() from public;
revoke all on function public.billing_provider_events_append_only() from anon;
revoke all on function public.billing_provider_events_append_only() from authenticated;


-- ============================================================
-- 5. LE CHAÎNON MANQUANT DE L'ENCAISSEMENT
-- ============================================================
--
-- 0081 A PRÉVU LA PLACE ET PAS LA SERRURE. `saas_invoices.payment_method`
-- accepte déjà 'provider', `saas_invoice_payments.method` aussi, et
-- `external_reference` attend l'identifiant du paiement chez le
-- prestataire. Il manque trois choses, et les trois sont ici.

-- ------------------------------------------------------------
-- 5.a L'UNICITÉ DE L'ENCAISSEMENT — la ceinture sous la bretelle
-- ------------------------------------------------------------
-- CONSTAT SUR 0081, ET CE N'EST PAS UN DÉFAUT DE 0081 : la table des
-- encaissements porte `external_reference` sans aucune unicité. Tant
-- que la saisie est humaine, c'est sans risque — un administrateur qui
-- saisit deux fois le même virement s'en aperçoit. Dès qu'une machine
-- écrit, un rejeu créerait un SECOND encaissement du même montant, la
-- facture passerait en trop-perçu, et `saas_invoice_balance` rendrait
-- un `outstanding_cents` NÉGATIF que rien n'irait regarder.
--
-- L'index est PARTIEL : les encaissements sans référence externe — un
-- virement saisi à la main sans numéro — restent libres de se répéter,
-- parce que deux virements du même client le même jour existent
-- vraiment.
create unique index if not exists saas_invoice_payments_external_reference_idx
  on public.saas_invoice_payments (method, external_reference)
  where external_reference is not null;

-- ------------------------------------------------------------
-- 5.b LE LIEN VERS L'ÉVÉNEMENT QUI L'A PROUVÉ
-- ------------------------------------------------------------
-- STRICTEMENT ADDITIF : une colonne nullable, sur une table dont aucun
-- déclencheur ne fige le contenu. 0081 n'est pas modifiée — elle est
-- complétée par la migration qui apporte le prestataire, ce qui est
-- exactement ce que son commentaire annonçait.
--
-- `on delete restrict` plutôt que `set null` : un événement ne se
-- supprime jamais (§ 4.a), et si quelqu'un forçait la suppression, on
-- préfère que la base refuse plutôt qu'elle efface la preuve en
-- laissant l'encaissement orphelin.
alter table public.saas_invoice_payments
  add column if not exists provider_event_id uuid
    references public.billing_provider_events (id) on delete restrict;

create index if not exists saas_invoice_payments_event_idx
  on public.saas_invoice_payments (provider_event_id)
  where provider_event_id is not null;

comment on column public.saas_invoice_payments.provider_event_id is
  'L''événement du prestataire qui a prouvé cet encaissement. NUL pour un virement saisi à la main : un encaissement humain n''a pas d''événement.';

-- POURQUOI PAS D'UNICITÉ SUR `provider_event_id`, ET C'EST DÉLIBÉRÉ. Un
-- même événement peut légitimement solder plusieurs de nos factures (un
-- règlement groupé). Une unicité ici ferait échouer le second
-- encaissement, le gestionnaire renverrait une erreur, le prestataire
-- rejouerait indéfiniment, et la panne serait permanente. L'idempotence
-- est déjà tenue deux fois : par l'unicité de l'événement (§ 4) et par
-- celle de la référence de paiement (§ 5.a).


-- ============================================================
-- 6. LA LECTURE QUI REFUSE DE DEVINER
-- ============================================================
--
-- ELLE NE LÈVE JAMAIS, exactement comme `saas_subscription_billing_lines`
-- de 0081 : elle rend TOUJOURS une ligne, et cette ligne porte un
-- `blocking_reason` quand quelque chose empêche d'encaisser. Lever
-- ferait échouer l'écran entier pour une case manquante ; rendre un
-- montant serait pire.
--
-- ET QUAND ELLE BLOQUE, `provider_price_id` EST NUL. C'est la
-- précaution qui compte : un appelant distrait qui ignorerait le motif
-- ne trouverait rien à encaisser plutôt qu'un tarif approximatif. Les
-- deux montants restent rendus, eux, pour que l'écran d'administration
-- puisse afficher la dérive au lieu de dire seulement « ça ne marche
-- pas ».
--
-- ELLE EST ACCESSIBLE AUX COMPTES CONNECTÉS, et c'est réfléchi : la
-- route serveur de `web-pro` s'exécute sous le jeton de l'utilisateur,
-- et lui refuser cette lecture la pousserait vers la clé de service —
-- c'est-à-dire vers un code qui contourne toute la RLS pour lire un
-- prix. Une clé de tarif du prestataire est faite pour voyager avec la
-- clé publiable ; ce qui ne doit jamais voyager, c'est la décision du
-- montant, et cette fonction est précisément ce qui la garde au serveur.

create or replace function public.billing_provider_price_terms(
  p_provider text,
  p_mode text,
  p_kind text,
  p_plan_key text default null,
  p_billing_cycle text default null,
  p_module_key text default null,
  p_discount_code text default null
)
returns table (
  provider_price_id text,
  provider_product_id text,
  our_amount_cents bigint,
  mapped_amount_cents bigint,
  currency text,
  blocking_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_block text;
  v_our bigint;
  v_currency text;
  v_plan record;
  v_mod record;
  v_disc record;
  v_map record;
  v_provider_active boolean;
  -- L'OFFRE SOUS LAQUELLE ON CHERCHE LA CORRESPONDANCE. Elle vaut
  -- `p_plan_key` partout, SAUF pour une remise : voir le § 3 plus bas.
  v_lookup_plan text;
begin
  provider_price_id := null;
  provider_product_id := null;
  our_amount_cents := null;
  mapped_amount_cents := null;
  currency := null;
  blocking_reason := null;
  v_lookup_plan := p_plan_key;

  -- ---- 1. Le cadre : prestataire, mode, nature -------------------
  select bp.is_active into v_provider_active
  from public.billing_providers bp where bp.key = p_provider;

  if v_provider_active is null then
    blocking_reason := 'providerUnknown';
    return next; return;
  end if;
  if not v_provider_active then
    blocking_reason := 'providerNotRetained';
    return next; return;
  end if;
  if p_mode is null or p_mode not in ('test', 'live') then
    blocking_reason := 'modeUnknown';
    return next; return;
  end if;
  if p_kind is null or p_kind not in ('plan', 'seat', 'module', 'discount') then
    blocking_reason := 'kindUnknown';
    return next; return;
  end if;
  if p_billing_cycle is null or p_billing_cycle not in ('monthly', 'yearly') then
    blocking_reason := 'billingCycleUnknown';
    return next; return;
  end if;

  -- ---- 2. NOTRE prix, qui fait autorité --------------------------
  if p_kind in ('plan', 'seat', 'module') then
    select * into v_plan from public.organization_plans p where p.key = p_plan_key;
    if v_plan.key is null then
      blocking_reason := 'planUnknown';
      return next; return;
    end if;
    if not v_plan.is_active then
      blocking_reason := 'planInactive';
      return next; return;
    end if;
    -- L'offre sur devis ne se souscrit pas en libre-service. Le
    -- déclencheur de 0081 le refuserait de toute façon — mais APRÈS
    -- l'encaissement, ce qui est trop tard. On refuse ici, avant.
    if v_plan.is_quote_only then
      blocking_reason := 'planIsQuoteOnly';
      return next; return;
    end if;
    v_currency := v_plan.currency;
  else
    v_currency := 'EUR';
  end if;

  if p_kind = 'plan' then
    v_our := case when p_billing_cycle = 'monthly'
                  then v_plan.monthly_price_cents
                  else v_plan.yearly_price_cents end;
    if v_our is null then
      v_block := case when p_billing_cycle = 'monthly'
                      then 'planMonthlyPriceUnknown' else 'planYearlyPriceUnknown' end;
    end if;

  elsif p_kind = 'seat' then
    -- LE SIÈGE SUPPLÉMENTAIRE N'A PAS DE PRIX ANNUEL DANS 0081, et
    -- c'est une décision qui n'a pas été prise plutôt qu'un oubli
    -- technique. Dix fois 9,90 ou douze fois ? Tant que le dirigeant
    -- n'a pas tranché, on bloque au lieu de choisir à sa place.
    if p_billing_cycle = 'yearly' then
      v_block := 'seatYearlyPriceUndecided';
    else
      v_our := v_plan.extra_seat_monthly_price_cents;
      if v_our is null then
        v_block := 'seatMonthlyPriceUnknown';
      end if;
    end if;

  elsif p_kind = 'module' then
    select * into v_mod from public.plan_module_terms(p_plan_key, p_module_key) t;
    if v_mod.availability is null then
      blocking_reason := 'moduleUnknown';
      return next; return;
    end if;
    if v_mod.availability <> 'optional' then
      -- « inclus » n'est PAS une erreur : c'est la matrice qui fait son
      -- travail, et un module compris dans l'offre ne se vend pas une
      -- seconde fois. L'appelant doit simplement ne rien facturer.
      v_block := case v_mod.availability
                   when 'included' then 'moduleIncludedInPlan'
                   when 'unavailable' then 'moduleUnavailableOnPlan'
                   else 'moduleUndecidedOnPlan' end;
    elsif not v_mod.is_delivered then
      v_block := 'moduleNotDelivered';
    else
      v_our := case when p_billing_cycle = 'monthly'
                    then v_mod.monthly_price_cents
                    else v_mod.yearly_price_cents end;
      if v_our is null then
        v_block := case when p_billing_cycle = 'monthly'
                        then 'moduleMonthlyPriceUnknown' else 'moduleYearlyPriceUnknown' end;
      end if;
    end if;

  else
    select * into v_disc from public.discount_offers d where d.code = p_discount_code;
    if v_disc.code is null then
      blocking_reason := 'discountUnknown';
      return next; return;
    end if;

    -- LA REMISE RÉSERVÉE À UNE OFFRE NE DÉBORDE PAS SUR LES AUTRES.
    --
    -- `discount_offers.applies_to_plan` porte cette restriction depuis
    -- 0081, et le semis de FONDATEUR l'explique en toutes lettres : un
    -- prix imposé de 49,90 € posé sur Pro Business (139,90 €) offrirait
    -- 90 € par mois au lieu de 30, sans que rien ne le signale. La
    -- fuite marche AUSSI dans l'autre sens — le même prix imposé sur
    -- Pro Solo (39,90 €) ferait payer 10 € DE PLUS que le tarif public,
    -- sous une ligne libellée « Tarif fondateur ».
    --
    -- Le déclencheur `organization_subscriptions_plan_guard` de 0081
    -- ferme déjà ce trou côté ABONNEMENT. Mais le tunnel de paiement
    -- n'écrit jamais dans `organization_subscriptions` : il encaisse
    -- d'abord. Le déclencheur ne se déclencherait donc qu'après
    -- l'argent, ce qui est trop tard. On refuse ici, avant.
    --
    -- UN PLAN NON PRÉCISÉ NE VAUT PAS AUTORISATION. Quand la remise est
    -- restreinte et que l'appelant n'a pas dit à quelle offre il
    -- l'applique, on ne peut pas vérifier : on refuse. C'est la même
    -- règle que partout dans ce fichier — on ne devine pas.
    if v_disc.applies_to_plan is not null then
      if p_plan_key is null then
        blocking_reason := 'discountPlanUnspecified';
        return next; return;
      end if;
      if v_disc.applies_to_plan is distinct from p_plan_key then
        blocking_reason := 'discountReservedToAnotherPlan';
        return next; return;
      end if;
    end if;

    -- LA CORRESPONDANCE D'UNE REMISE SE RANGE SOUS L'OFFRE QU'ELLE
    -- VISE, pas sous celle qu'on lui présente — et les deux viennent
    -- d'être vérifiées égales quand la remise est restreinte.
    --
    -- La distinction compte pour la remise UNIVERSELLE
    -- (`applies_to_plan` nul), qui s'applique à n'importe quelle offre :
    -- sa correspondance est rangée une seule fois, sous une offre nulle,
    -- et sert partout. Chercher sous `p_plan_key` obligerait à créer une
    -- correspondance par offre pour un tarif qui n'en a qu'un.
    v_lookup_plan := v_disc.applies_to_plan;

    if not v_disc.is_active
       or (v_disc.available_until is not null and v_disc.available_until < current_date) then
      v_block := 'discountClosed';
    elsif v_disc.kind <> 'fixedMonthlyPrice' then
      -- Un pourcentage ou une remise en valeur n'est pas un TARIF chez
      -- le prestataire : c'est un coupon, un autre objet. Lui faire
      -- correspondre un tarif reviendrait à figer un montant calculé.
      v_block := 'discountIsNotAFixedPrice';
    elsif p_billing_cycle = 'yearly' then
      -- 0081 REFUSE DE TRANCHER, en toutes lettres : la remise est
      -- libellée « 29,90 par mois », un annuel de la grille vaut dix
      -- mois, « mais rien ne dit que la remise suit cette règle ». Douze
      -- fois 29,90 font 358,80 ; dix fois font 299. On ne choisit pas.
      v_block := 'discountYearlyUndecided';
    else
      v_our := v_disc.value_cents;
    end if;
  end if;

  our_amount_cents := v_our;
  currency := v_currency;

  -- ---- 3. La correspondance ---------------------------------------
  select * into v_map
  from public.billing_provider_prices m
  where m.provider = p_provider
    and m.mode = p_mode
    and m.kind = p_kind
    and coalesce(m.plan_key, '') = coalesce(v_lookup_plan, '')
    and coalesce(m.billing_cycle, '') = coalesce(p_billing_cycle, '')
    and coalesce(m.module_key, '') = coalesce(p_module_key, '')
    and coalesce(m.discount_code, '') = coalesce(p_discount_code, '')
    and m.is_active;

  if v_map.id is not null then
    mapped_amount_cents := v_map.unit_amount_cents;
    provider_product_id := v_map.provider_product_id;
  end if;

  -- L'ORDRE DES MOTIFS N'EST PAS INDIFFÉRENT. Un prix que NOUS ne
  -- savons pas dire rend la correspondance sans objet : annoncer
  -- « correspondance manquante » à quelqu'un dont l'offre n'a pas de
  -- prix annuel l'enverrait créer un tarif pour un montant inexistant.
  if v_block is not null then
    blocking_reason := v_block;
    return next; return;
  end if;

  if v_map.id is null then
    blocking_reason := 'providerPriceMissing';
    return next; return;
  end if;

  -- LA DÉRIVE. Le tarif du prestataire est immuable : changer un prix
  -- chez lui, c'est en créer un nouveau. Si notre grille a bougé sans
  -- que la correspondance suive, encaisser reviendrait à facturer
  -- l'ancien montant — en silence, jusqu'à ce qu'un client le voie.
  if v_map.unit_amount_cents is distinct from v_our then
    blocking_reason := 'amountDrift';
    return next; return;
  end if;
  if v_map.currency is distinct from v_currency then
    blocking_reason := 'currencyDrift';
    return next; return;
  end if;

  provider_price_id := v_map.provider_price_id;
  return next;
end;
$$;

comment on function public.billing_provider_price_terms(text, text, text, text, text, text, text) is
  'Ce qu''il faut pour encaisser une case de la grille chez le prestataire — ou le motif lisible qui l''en empêche. '
  'Ne lève jamais. Quand elle bloque, provider_price_id est NUL : jamais un montant deviné, jamais zéro.';


-- ============================================================
-- 7. ÉCRIRE LA CORRESPONDANCE — le geste d'administration
-- ============================================================
-- Deux permissions existent depuis 0081, semées d'avance et jusqu'ici
-- sans usage : `billing.providers.read` et `billing.providers.write`.
-- Ce paragraphe leur en donne un.
--
-- LE MONTANT N'EST PAS UN PARAMÈTRE LIBRE : la fonction relit NOTRE
-- grille et REFUSE si le montant déclaré chez le prestataire ne
-- correspond pas. Un administrateur qui recopie 6 990 pour une offre à
-- 7 990 se fait arrêter à la saisie, pas à la première facture.

create or replace function public.admin_set_provider_price(
  p_provider text,
  p_mode text,
  p_kind text,
  p_plan_key text,
  p_billing_cycle text,
  p_module_key text,
  p_discount_code text,
  p_provider_price_id text,
  p_provider_product_id text,
  p_unit_amount_cents bigint,
  p_reason text,
  p_currency text default 'EUR'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_terms record;
  v_old jsonb;
  v_id uuid;
  v_audit uuid;
  v_label text;
begin
  if not public.platform_admin_can('billing.providers.write') then
    raise exception 'Accès refusé : permission billing.providers.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : relier un de nos prix à un tarif du prestataire, c''est décider de ce qui sera prélevé.'
      using errcode = '23514';
  end if;

  if p_unit_amount_cents is null or p_unit_amount_cents <= 0 then
    raise exception 'Un tarif se compte en centimes strictement positifs. Un tarif à zéro encaisserait zéro sans lever d''erreur.'
      using errcode = '23514';
  end if;

  -- ON RELIT NOTRE GRILLE, ET C'EST LE CŒUR DE CETTE FONCTION. Le
  -- montant reçu n'est pas cru : il est CONFRONTÉ. `blocking_reason`
  -- vaudra 'providerPriceMissing' tant que la ligne n'existe pas, ce
  -- qui est normal au moment de la créer — c'est le seul motif qu'on
  -- accepte de traverser, avec 'amountDrift' qu'on traite juste après.
  select * into v_terms from public.billing_provider_price_terms(
    p_provider, p_mode, p_kind, p_plan_key, p_billing_cycle, p_module_key, p_discount_code);

  if v_terms.blocking_reason is not null
     and v_terms.blocking_reason not in ('providerPriceMissing', 'amountDrift') then
    raise exception 'Correspondance refusée (%) : cette case de la grille ne se vend pas en l''état.', v_terms.blocking_reason
      using errcode = '23514';
  end if;

  if v_terms.our_amount_cents is null then
    raise exception 'Correspondance refusée : notre propre prix est inconnu pour cette case. On ne fait pas pointer un tarif vers un montant qu''on ne sait pas dire.'
      using errcode = '23514';
  end if;

  if v_terms.our_amount_cents is distinct from p_unit_amount_cents then
    raise exception 'Montant refusé : notre grille dit % centimes, le tarif déclaré chez le prestataire en dit %. Créez le bon tarif chez lui plutôt que d''enregistrer l''écart.',
      v_terms.our_amount_cents, p_unit_amount_cents
      using errcode = '23514';
  end if;

  if p_currency is distinct from v_terms.currency then
    raise exception 'Devise refusée : notre grille dit %, la correspondance en dit %.',
      coalesce(v_terms.currency, '(vide)'), coalesce(p_currency, '(vide)')
      using errcode = '23514';
  end if;

  -- UN TARIF DU PRESTATAIRE NE SERT QU'UNE CASE, et ce contrôle doit
  -- être ICI et pas seulement dans la contrainte d'unicité. Sans lui,
  -- le `on conflict (provider, mode, provider_price_id)` plus bas
  -- viserait la ligne de l'AUTRE case et lui écrirait le montant de
  -- celle-ci : la correspondance visée resterait absente, et une
  -- correspondance saine serait corrompue — en silence, et avec un
  -- succès rendu à l'appelant. C'est la pire des trois issues.
  if exists (
    select 1 from public.billing_provider_prices m
    where m.provider = p_provider
      and m.mode = p_mode
      and m.provider_price_id = btrim(p_provider_price_id)
      and not (m.kind = p_kind
               and coalesce(m.plan_key, '') = coalesce(p_plan_key, '')
               and coalesce(m.billing_cycle, '') = coalesce(p_billing_cycle, '')
               and coalesce(m.module_key, '') = coalesce(p_module_key, '')
               and coalesce(m.discount_code, '') = coalesce(p_discount_code, ''))
  ) then
    raise exception 'Le tarif % chez % (%) désigne déjà une autre case de la grille. Un tarif ne se partage pas : créez-en un second chez le prestataire.',
      btrim(p_provider_price_id), p_provider, p_mode
      using errcode = '23505';
  end if;

  v_label := p_provider || ' · ' || p_mode || ' · ' || p_kind || ' · '
          || coalesce(p_plan_key, '—') || ' · ' || coalesce(p_billing_cycle, '—')
          || coalesce(' · ' || p_module_key, '') || coalesce(' · ' || p_discount_code, '');

  -- L'ANCIENNE CORRESPONDANCE EST DÉSACTIVÉE, PAS ÉCRASÉE. Elle dit ce
  -- qui a été facturé hier, et un remboursement se fait sur le tarif
  -- d'origine.
  select jsonb_build_object('providerPriceId', m.provider_price_id,
                            'unitAmountCents', m.unit_amount_cents)
    into v_old
  from public.billing_provider_prices m
  where m.provider = p_provider and m.mode = p_mode and m.kind = p_kind
    and coalesce(m.plan_key, '') = coalesce(p_plan_key, '')
    and coalesce(m.billing_cycle, '') = coalesce(p_billing_cycle, '')
    and coalesce(m.module_key, '') = coalesce(p_module_key, '')
    and coalesce(m.discount_code, '') = coalesce(p_discount_code, '')
    and m.is_active;

  update public.billing_provider_prices m
     set is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), updated_at = now()
   where m.provider = p_provider and m.mode = p_mode and m.kind = p_kind
     and coalesce(m.plan_key, '') = coalesce(p_plan_key, '')
     and coalesce(m.billing_cycle, '') = coalesce(p_billing_cycle, '')
     and coalesce(m.module_key, '') = coalesce(p_module_key, '')
     and coalesce(m.discount_code, '') = coalesce(p_discount_code, '')
     and m.is_active
     and m.provider_price_id is distinct from p_provider_price_id;

  v_audit := public.record_admin_event(
    'billingProvider.priceMapped', 'billing_provider_price', null, v_label, v_old,
    jsonb_build_object('providerPriceId', p_provider_price_id,
                       'unitAmountCents', p_unit_amount_cents,
                       'currency', p_currency),
    v_reason);

  insert into public.billing_provider_prices
    (provider, mode, kind, plan_key, billing_cycle, module_key, discount_code,
     provider_product_id, provider_price_id, unit_amount_cents, currency,
     is_active, synced_at, created_by, updated_by, audit_event_id)
  values
    (p_provider, p_mode, p_kind, p_plan_key, p_billing_cycle, p_module_key, p_discount_code,
     public.ai_clean_text(p_provider_product_id, 200), btrim(p_provider_price_id),
     p_unit_amount_cents, p_currency, true, now(), auth.uid(), auth.uid(), v_audit)
  on conflict (provider, mode, provider_price_id) do update
    set unit_amount_cents = excluded.unit_amount_cents,
        currency = excluded.currency,
        provider_product_id = excluded.provider_product_id,
        is_active = true,
        deactivated_at = null,
        deactivated_by = null,
        synced_at = now(),
        updated_at = now(),
        updated_by = excluded.updated_by,
        audit_event_id = excluded.audit_event_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_deactivate_provider_price(
  p_price_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_row record;
begin
  if not public.platform_admin_can('billing.providers.write') then
    raise exception 'Accès refusé : permission billing.providers.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : retirer une correspondance rend le paiement indisponible pour cette case.'
      using errcode = '23514';
  end if;

  select * into v_row from public.billing_provider_prices where id = p_price_id;
  if v_row.id is null then
    raise exception 'Correspondance introuvable.' using errcode = '23503';
  end if;
  if not v_row.is_active then
    -- Rendre le même identifiant sans rien réécrire : redemander la
    -- même désactivation ne doit pas être une erreur.
    return v_row.id;
  end if;

  update public.billing_provider_prices
     set is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), updated_at = now()
   where id = p_price_id;

  perform public.record_admin_event(
    'billingProvider.priceDeactivated', 'billing_provider_price', p_price_id,
    v_row.provider || ' · ' || v_row.mode || ' · ' || v_row.kind,
    jsonb_build_object('providerPriceId', v_row.provider_price_id,
                       'unitAmountCents', v_row.unit_amount_cents),
    null, v_reason);

  return v_row.id;
end;
$$;


-- ============================================================
-- 8. LA PORTE DE LA MACHINE
-- ============================================================
--
-- LE PROBLÈME, ET IL EST RÉEL. `saas_record_invoice_payment()` de 0081
-- exige `platform_admin_can('billing.invoices.write')` PUIS
-- `platform_admin_require_mfa()`. Une fonction Edge s'exécute avec la
-- clé de service : aucun `auth.uid()`, aucun rôle de plateforme, aucun
-- second facteur. Elle recevrait 42501.
--
-- LES TROIS MAUVAISES SORTIES, ÉCARTÉES :
--   a) donner un rôle `platform_admin` à un compte machine — le second
--      facteur deviendrait décoratif, et le journal d'audit attribuerait
--      les encaissements à un humain qui n'a rien fait ;
--   b) laisser le gestionnaire écrire directement dans
--      `saas_invoice_payments` avec la clé de service — plus d'audit,
--      plus de recalcul de statut, et la règle « le statut suit
--      l'argent » cesserait de s'appliquer ;
--   c) assouplir la garde de la fonction de 0081 — elle protège la
--      saisie humaine, qui n'a rien demandé.
--
-- LA QUATRIÈME EST CELLE-CI : UNE PORTE SÉPARÉE, ÉTROITE ET JOURNALISÉE.
-- Son autorisation ne vient pas d'un administrateur : elle vient du
-- FAIT QUE L'ÉVÉNEMENT A ÉTÉ VÉRIFIÉ. Et parce qu'une signature se
-- vérifie hors de la base, la fonction exige que l'événement soit DÉJÀ
-- INSCRIT AU JOURNAL avant d'accepter le moindre centime : pas
-- d'événement, pas d'encaissement. L'ordre est donc imposé par la base,
-- et non par la discipline du code appelant.
--
-- ELLE N'EST ACCESSIBLE QU'À `service_role`. `authenticated` et `anon`
-- en sont révoqués : un client ne peut pas se déclarer payé.

-- ------------------------------------------------------------
-- 8.a INSCRIRE L'ÉVÉNEMENT — et c'est ici que se joue l'idempotence
-- ------------------------------------------------------------
create or replace function public.billing_provider_event_record(
  p_provider text,
  p_mode text,
  p_provider_event_id text,
  p_event_type text,
  p_api_version text default null,
  p_occurred_at timestamptz default null,
  p_summary jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
begin
  select true into v_exists from public.billing_providers where key = p_provider;
  if v_exists is null then
    raise exception 'Prestataire inconnu : %.', coalesce(p_provider, '(vide)') using errcode = '23503';
  end if;
  if p_mode is null or p_mode not in ('test', 'live') then
    raise exception 'Mode inconnu : %. Une correspondance d''essai employée en production encaisserait zéro.', coalesce(p_mode, '(vide)')
      using errcode = '23514';
  end if;
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then
    raise exception 'Un événement sans identifiant ne peut pas être dédoublonné : refusé.' using errcode = '23514';
  end if;
  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'Un événement sans nature ne se traite pas : refusé.' using errcode = '23514';
  end if;

  -- ON INSÈRE D'ABORD. C'est la CONTRAINTE qui répond, pas un « select
  -- puis if » : deux livraisons simultanées du même événement
  -- atteindraient toutes les deux le `select`, et toutes les deux
  -- croiraient être les premières.
  begin
    insert into public.billing_provider_events
      (provider, mode, provider_event_id, event_type, api_version, occurred_at, summary)
    values
      (p_provider, p_mode, btrim(p_provider_event_id), btrim(p_event_type),
       public.ai_clean_text(p_api_version, 40), p_occurred_at, p_summary);
  exception when unique_violation then
    -- Déjà reçu. Le gestionnaire s'arrête ici et répond 200 : rejouer
    -- un événement déjà traité n'est pas une erreur du prestataire,
    -- c'est son fonctionnement normal.
    return 'duplicate';
  end;

  return 'accepted';
end;
$$;

-- ------------------------------------------------------------
-- 8.b CLORE L'ÉVÉNEMENT
-- ------------------------------------------------------------
create or replace function public.billing_provider_event_close(
  p_provider text,
  p_provider_event_id text,
  p_outcome text,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
begin
  if p_outcome is null or p_outcome not in ('applied', 'ignored', 'failed') then
    raise exception 'Issue inconnue : %. Les trois issues terminales sont applied, ignored, failed.', coalesce(p_outcome, '(vide)')
      using errcode = '23514';
  end if;

  select * into v_row from public.billing_provider_events e
   where e.provider = p_provider and e.provider_event_id = btrim(p_provider_event_id);

  if v_row.id is null then
    raise exception 'Événement introuvable : on ne clôt pas ce qu''on n''a pas inscrit.' using errcode = '23503';
  end if;
  if v_row.processed_at is not null then
    -- Le déclencheur d'ajout seul lèverait ; on rend l'état plutôt que
    -- de faire échouer un gestionnaire qui rejoue sa propre clôture.
    return 'alreadyClosed';
  end if;

  update public.billing_provider_events
     set outcome = p_outcome,
         processed_at = now(),
         error = case when p_outcome = 'failed' then public.ai_clean_text(p_error, 1000) end
   where id = v_row.id;

  return 'closed';
end;
$$;

-- ------------------------------------------------------------
-- 8.c RATTACHER LE CLIENT DU PRESTATAIRE À L'ENTREPRISE
-- ------------------------------------------------------------
create or replace function public.billing_provider_link_customer(
  p_provider text,
  p_mode text,
  p_organization_id uuid,
  p_provider_customer_id text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing text;
  v_other uuid;
begin
  if not exists (select 1 from public.billing_providers where key = p_provider) then
    raise exception 'Prestataire inconnu : %.', coalesce(p_provider, '(vide)') using errcode = '23503';
  end if;
  if p_mode is null or p_mode not in ('test', 'live') then
    raise exception 'Mode inconnu : %.', coalesce(p_mode, '(vide)') using errcode = '23514';
  end if;
  if p_provider_customer_id is null or btrim(p_provider_customer_id) = '' then
    raise exception 'Identifiant client vide : refusé.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.business_organizations where id = p_organization_id) then
    raise exception 'Entreprise introuvable.' using errcode = '23503';
  end if;

  select c.provider_customer_id into v_existing
  from public.billing_provider_customers c
  where c.organization_id = p_organization_id and c.provider = p_provider and c.mode = p_mode;

  if v_existing is not null then
    if v_existing = btrim(p_provider_customer_id) then
      return 'alreadyLinked';
    end if;
    -- ON NE REMPLACE PAS EN SILENCE. Deux clients pour une entreprise,
    -- c'est deux historiques de paiement et un remboursement qui part
    -- du mauvais : on veut que ça remonte, pas que ça s'écrase.
    raise exception 'L''entreprise est déjà rattachée au client % chez % (%). Un second rattachement se décide, il ne se subit pas.',
      v_existing, p_provider, p_mode
      using errcode = '23505';
  end if;

  select c.organization_id into v_other
  from public.billing_provider_customers c
  where c.provider = p_provider and c.mode = p_mode
    and c.provider_customer_id = btrim(p_provider_customer_id);

  if v_other is not null then
    raise exception 'Le client % chez % (%) appartient déjà à une autre entreprise.',
      btrim(p_provider_customer_id), p_provider, p_mode
      using errcode = '23505';
  end if;

  -- ON INSÈRE, ET C'EST LA CONTRAINTE QUI ARBITRE — pas les deux
  -- `select` ci-dessus.
  --
  -- CE QUE LES DEUX LECTURES NE PEUVENT PAS FAIRE. Sous READ COMMITTED,
  -- deux livraisons simultanées du même `checkout.session.completed`
  -- atteignent toutes les deux les `select`, n'y voient rien, et
  -- insèrent toutes les deux : c'est exactement le motif que le § 4
  -- de ce fichier interdit pour le journal des événements, et il
  -- s'applique ici mot pour mot. La clé primaire refuse la seconde avec
  -- un 23505 ; non rattrapé, ce refus remonterait comme un refus
  -- MÉTIER, l'événement serait clos en « failed », et le journal dirait
  -- que le rattachement a échoué alors qu'il a parfaitement eu lieu.
  --
  -- Les deux `select` restent utiles : ils distinguent le refus
  -- LÉGITIME — cette entreprise est rattachée à un AUTRE client, ce qui
  -- mérite qu'un humain regarde — du simple perdant de course, qui ne
  -- mérite rien du tout. Ce sont deux situations qu'on ne veut surtout
  -- pas voir sous le même message.
  begin
    insert into public.billing_provider_customers
      (organization_id, provider, mode, provider_customer_id, created_by)
    values (p_organization_id, p_provider, p_mode, btrim(p_provider_customer_id), auth.uid());
  exception when unique_violation then
    -- Le perdant de course relit CE QUI A ÉTÉ ÉCRIT. S'il s'agit du
    -- même client, les deux livraisons voulaient la même chose et le
    -- résultat est celui qu'on cherchait : succès. Si le gagnant a
    -- écrit autre chose, alors le conflit est réel et doit remonter —
    -- masquer celui-là ferait disparaître le seul signal qui distingue
    -- un doublon inoffensif d'un annuaire qui part en morceaux.
    select c.provider_customer_id into v_existing
    from public.billing_provider_customers c
    where c.organization_id = p_organization_id and c.provider = p_provider and c.mode = p_mode;

    if v_existing is not null and v_existing = btrim(p_provider_customer_id) then
      return 'alreadyLinked';
    end if;

    raise exception 'Rattachement refusé : le client % chez % (%) est déjà pris, ou l''entreprise est déjà rattachée ailleurs (course perdue).',
      btrim(p_provider_customer_id), p_provider, p_mode
      using errcode = '23505';
  end;

  return 'linked';
end;
$$;

-- ------------------------------------------------------------
-- 8.d L'ENCAISSEMENT — sur NOTRE facture, jamais un second document
-- ------------------------------------------------------------
-- Ce que cette fonction fait, et strictement rien d'autre :
--   • elle exige que l'événement soit déjà au journal ;
--   • elle pose une ligne dans `saas_invoice_payments` avec
--     method = 'provider' ;
--   • elle laisse le statut de la facture SUIVRE L'ARGENT, recalculé
--     depuis `saas_invoice_balance` comme le fait 0081 ;
--   • elle journalise, avec un acteur MACHINE explicite.
--
-- Elle ne crée aucune facture, n'en émet aucune, n'attribue aucun
-- numéro. Un encaissement arrivé sur une facture non émise est un
-- problème d'ordonnancement à régler en amont, pas une raison d'émettre
-- dans un webhook.
create or replace function public.saas_record_provider_payment(
  p_provider text,
  p_mode text,
  p_provider_event_id text,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_payment_reference text,
  p_received_on date default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event record;
  v_inv record;
  v_payment uuid;
  v_audit uuid;
  v_reste bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Un encaissement se compte en centimes strictement positifs.' using errcode = '23514';
  end if;
  if p_payment_reference is null or btrim(p_payment_reference) = '' then
    -- Sans référence, l'index d'unicité du § 5.a ne protège plus rien :
    -- un rejeu passerait. La référence n'est pas un confort, c'est le
    -- support de l'idempotence.
    raise exception 'Un encaissement du prestataire porte SA référence : sans elle, un rejeu créerait un second paiement.'
      using errcode = '23514';
  end if;

  select * into v_event
  from public.billing_provider_events e
  where e.provider = p_provider and e.provider_event_id = btrim(p_provider_event_id);

  if v_event.id is null then
    raise exception 'Encaissement refusé : l''événement % de % n''est pas au journal. Un droit ne s''ouvre que sur un encaissement prouvé.',
      coalesce(p_provider_event_id, '(vide)'), coalesce(p_provider, '(vide)')
      using errcode = '23503';
  end if;
  if v_event.mode is distinct from p_mode then
    raise exception 'Mode incohérent : l''événement est en « % », l''encaissement se présente en « % ».',
      v_event.mode, coalesce(p_mode, '(vide)')
      using errcode = '23514';
  end if;

  -- `for update` : LE VERROU DE LIGNE, ET IL PORTE TOUT LE CONTRÔLE DU
  -- TROP-PERÇU QUI SUIT.
  --
  -- Sans lui, deux livraisons simultanées portant deux références de
  -- paiement DIFFÉRENTES (deux factures Stripe distinctes du même
  -- montant, cas parfaitement réel) liraient toutes les deux le même
  -- reste à payer, se croiraient toutes les deux légitimes, et
  -- poseraient deux encaissements. L'index d'unicité du § 5.a ne les
  -- verrait pas passer : il porte sur la RÉFÉRENCE, et les deux
  -- références diffèrent. Le solde de la facture deviendrait négatif,
  -- et rien ne le rattraperait ensuite.
  --
  -- Le verrou sérialise les deux transactions : la seconde attend, puis
  -- relit un reste à payer déjà diminué et se fait refuser. C'est la
  -- seule forme qui tienne — un contrôle applicatif posé sur une
  -- lecture antérieure perd toujours cette course.
  select * into v_inv from public.saas_invoices i where i.id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Facture introuvable.' using errcode = '23503';
  end if;
  if v_inv.issued_at is null then
    raise exception 'Cette facture n''est pas émise : on n''encaisse pas un brouillon.' using errcode = '23514';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'Facture annulée : elle n''encaisse plus rien.' using errcode = '23514';
  end if;
  if p_currency is not null and v_inv.currency is distinct from p_currency then
    raise exception 'Devise incohérente : la facture est en %, l''encaissement en %.', v_inv.currency, p_currency
      using errcode = '23514';
  end if;

  -- L'IDEMPOTENCE PASSE AVANT LE CONTRÔLE DU TROP-PERÇU, ET L'ORDRE
  -- N'EST PAS UN DÉTAIL.
  --
  -- Un rejeu du MÊME paiement arrive sur une facture que ce même
  -- paiement a déjà soldée : son reste à payer vaut zéro, et le
  -- contrôle du trop-perçu ci-dessous le refuserait bruyamment alors
  -- qu'il n'y a rien à refuser — le rejeu est le fonctionnement normal
  -- du prestataire, pas un incident. Le gestionnaire de webhook attend
  -- « duplicate » pour clore l'événement en succès ; une exception à la
  -- place le ferait échouer en boucle jusqu'à ce que le prestataire
  -- désactive le point de terminaison.
  --
  -- On lit donc SOUS LE VERROU déjà pris : la référence est unique par
  -- l'index du § 5.a, cette lecture est donc décisive et non
  -- indicative.
  if exists (
    select 1 from public.saas_invoice_payments p
    where p.method = 'provider' and p.external_reference = btrim(p_payment_reference)
  ) then
    return 'duplicate';
  end if;

  -- ON N'ENCAISSE PAS PLUS QUE CE QUI RESTE DÛ, ET C'EST LA BASE QUI LE
  -- TIENT.
  --
  -- Le gestionnaire de webhook fait déjà ce contrôle sur la voie
  -- « métadonnée » (`rapprochement.ts`). Il ne suffit pas : c'est du
  -- code applicatif, il ne couvre qu'une des deux voies, et il travaille
  -- sur une lecture faite AVANT le verrou. Ici, sous `for update`, le
  -- contrôle est infranchissable — y compris par deux livraisons
  -- concurrentes portant des références différentes.
  --
  -- LE PAIEMENT PARTIEL RESTE ACCEPTÉ. `saas_invoice_payments` est une
  -- table et non deux colonnes, précisément pour qu'un acompte et un
  -- solde coexistent : un montant INFÉRIEUR au reste dû passe. Seul le
  -- montant SUPÉRIEUR est refusé, parce qu'il rendrait
  -- `outstanding_cents` négatif — un état que rien ne rattrape et que
  -- personne ne va regarder.
  --
  -- Un reste INCONNU (`null`) ne déclenche pas le refus : on ne compare
  -- pas un montant à ce qu'on ne connaît pas.
  select b.outstanding_cents into v_reste
  from public.saas_invoice_balance b where b.invoice_id = p_invoice_id;

  if v_reste is not null and p_amount_cents > v_reste then
    raise exception 'Trop-perçu refusé : la facture % ne présente plus que % centimes à payer, l''encaissement en porte %. Un solde négatif ne se répare pas tout seul.',
      coalesce(v_inv.number, p_invoice_id::text), v_reste, p_amount_cents
      using errcode = '23514';
  end if;

  -- ON INSÈRE, ET C'EST L'INDEX QUI ARBITRE. Un rejeu du même paiement
  -- perd la course sur l'unicité partielle (method, external_reference)
  -- du § 5.a, et on rend « duplicate » sans rien avoir écrit.
  begin
    insert into public.saas_invoice_payments
      (invoice_id, amount_cents, received_on, method, external_reference,
       note, provider_event_id)
    values
      (p_invoice_id, p_amount_cents, coalesce(p_received_on, current_date), 'provider',
       btrim(p_payment_reference),
       'Encaissement ' || p_provider || ' (' || p_mode || '), événement ' || v_event.provider_event_id || '.',
       v_event.id)
    returning id into v_payment;
  exception when unique_violation then
    return 'duplicate';
  end;

  -- L'AUDIT AVEC UN ACTEUR MACHINE. `record_admin_event()` ne convient
  -- pas : elle exige `is_platform_admin()` et impose `auth.uid()`
  -- comme auteur — c'est ce qui la rend infalsifiable pour les humains,
  -- et c'est ce qui la rend inutilisable ici. On écrit donc la ligne
  -- directement, avec `admin_user_id` NUL et un rôle 'system' : le
  -- journal doit dire qu'AUCUN humain n'a fait ce geste, pas en
  -- désigner un au hasard.
  insert into public.admin_audit_events
    (admin_user_id, admin_role, action, target_type, target_id, target_label,
     old_value, new_value, reason)
  values
    (null, 'system', 'saasInvoice.providerPaymentRecorded', 'saas_invoice',
     p_invoice_id, v_inv.number,
     jsonb_build_object('status', v_inv.status),
     jsonb_build_object('amountCents', p_amount_cents,
                        'currency', v_inv.currency,
                        'provider', p_provider,
                        'mode', p_mode,
                        'providerEventId', v_event.provider_event_id,
                        'paymentReference', btrim(p_payment_reference)),
     'Encaissement confirmé par le prestataire ' || p_provider || ' — événement ' || v_event.provider_event_id || '.')
  returning id into v_audit;

  update public.saas_invoice_payments set audit_event_id = v_audit where id = v_payment;

  -- LE STATUT SUIT L'ARGENT. Même règle qu'en 0081 : on le recalcule
  -- depuis le solde, on ne le décrète pas. Un paiement partiel laisse la
  -- facture émise, et `saas_invoice_state` en déduira le reste.
  select b.outstanding_cents into v_reste
  from public.saas_invoice_balance b where b.invoice_id = p_invoice_id;

  if v_reste is not null and v_reste <= 0 and v_inv.status = 'issued' then
    update public.saas_invoices
       set status = 'paid',
           payment_method = 'provider',
           external_payment_reference = btrim(p_payment_reference),
           updated_at = now()
     where id = p_invoice_id;
  else
    update public.saas_invoices
       set payment_method = 'provider',
           external_payment_reference = coalesce(external_payment_reference, btrim(p_payment_reference)),
           updated_at = now()
     where id = p_invoice_id;
  end if;

  return 'recorded';
end;
$$;

comment on function public.saas_record_provider_payment(text, text, text, uuid, bigint, text, text, date) is
  'Pose un encaissement du prestataire sur une facture que NOUS avons émise. N''émet rien, ne numérote rien : '
  'la facture légale reste celle de saas_issue_invoice(). Exige que l''événement soit déjà au journal, et rend « duplicate » sur un rejeu.';


-- ============================================================
-- 8.e LA TAXE — UN SEUL MOTEUR, ET C'EST LE NÔTRE
-- ============================================================
--
-- CE QUE CE PARAGRAPHE RÉPARE, ET C'ÉTAIT UN DÉFAUT BLOQUANT.
--
-- Nos tarifs sont HORS TAXES, et `tax_behavior` est verrouillé sur
-- 'exclusive' au § 2 : c'est juste. Mais tant que la session de paiement
-- ne portait AUCUNE taxe, le prestataire encaissait le HT nu — 79,90 €
-- — alors que la facture française émise par 0081 pour la même période
-- en réclame 95,88. Trois conséquences, toutes silencieuses :
--
--   • les 15,98 € de TVA française n'étaient JAMAIS collectés, et Oasis
--     Care en reste pourtant redevable ;
--   • `saas_invoice_balance` laissait la facture éternellement
--     partiellement impayée, d'un montant exactement égal à la taxe ;
--   • le rapprochement du webhook, qui compare le montant encaissé au
--     reste dû, ne trouvait AUCUNE candidate — donc chaque encaissement
--     français, premier paiement comme renouvellement, se serait soldé
--     par « à rapprocher à la main ».
--
-- Les régimes à 0 % (autoliquidation, hors Union) fonctionnaient, eux,
-- par accident : HT = TTC. Seul le cas français — l'immense majorité
-- des clients — était cassé, c'est-à-dire précisément celui qu'un essai
-- avec une carte néerlandaise n'aurait pas montré.
--
-- L'ARBITRAGE, ET IL EST ASSUMÉ : c'est NOUS qui calculons la taxe, pas
-- le moteur du prestataire. `saas_vat_regime()` sait déjà décider, et
-- surtout il sait REFUSER de deviner — il rend 'unknown' plutôt qu'un
-- taux inventé. Le moteur du prestataire, lui, n'émet aucune erreur
-- quand une immatriculation manque : il calcule zéro, et l'intégration
-- croit collecter. Entre un moteur qui refuse et un moteur qui se tait,
-- on garde celui qui refuse. Les deux ensemble, ce serait deux vérités
-- sur la même transaction.

-- ------------------------------------------------------------
-- 8.e.1 LE RÉGIME, CALCULÉ UNE SEULE FOIS
-- ------------------------------------------------------------
-- 0081 a posé `saas_vat_regime()` avec une garde qui exige
-- `billing.invoices.read` ou `billing.plans.read` — c'est-à-dire un
-- administrateur de plateforme. Le tunnel de paiement, lui, tourne sous
-- le jeton du client : il ne peut pas l'appeler, et il en a pourtant
-- besoin pour savoir quoi encaisser.
--
-- LA MAUVAISE SORTIE AURAIT ÉTÉ DE RECOPIER LA RÈGLE. Deux fonctions
-- qui décident du régime de TVA, ce sont deux fonctions qui divergeront
-- — et le jour où elles divergent, l'une facture et l'autre encaisse.
--
-- On extrait donc le CALCUL dans une fonction sans garde, invisible des
-- clients, et on rebranche `saas_vat_regime()` dessus EN GARDANT SA
-- GARDE MOT POUR MOT. Son contrat ne change pas d'un iota : mêmes
-- valeurs rendues, même refus 42501 pour qui n'est pas habilité. Le test
-- de ce fichier le vérifie dans les deux sens.
create or replace function public.saas_vat_regime_compute(p_organization_id uuid)
returns table (regime text, rate numeric, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text;
  v_vat text;
  v_in_eu boolean;
  v_rate numeric;
  v_validated timestamptz;
begin
  -- AUCUNE GARDE ICI, ET C'EST VOULU : cette fonction est révoquée de
  -- `public`, d'`anon` et d'`authenticated` au § 9. Elle n'est
  -- appelable que depuis les deux fonctions qui, elles, portent leur
  -- garde. Le calcul est nu ; l'autorisation est à la porte.
  select upper(btrim(o.country)), nullif(btrim(coalesce(o.vat_number, '')), '')
    into v_country, v_vat
  from public.business_organizations o where o.id = p_organization_id;

  if v_country is null then
    return query select 'unknown'::text, null::numeric,
      'Entreprise inconnue : aucun pays, donc aucun régime de TVA.'::text;
    return;
  end if;

  select true into v_in_eu from public.saas_eu_countries where code = v_country;
  select r.standard_rate into v_rate from public.saas_vat_rates r where r.country_code = v_country;
  select t.vat_number_validated_at into v_validated
    from public.saas_customer_tax_profiles t where t.organization_id = p_organization_id;

  if v_country = 'FR' then
    if v_rate is null then
      return query select 'unknown'::text, null::numeric,
        'Aucun taux normal enregistré pour la France dans saas_vat_rates.'::text;
    else
      return query select 'france'::text, v_rate, null::text;
    end if;
    return;
  end if;

  if coalesce(v_in_eu, false) then
    if v_vat is not null and v_validated is not null then
      return query select 'euReverseCharge'::text, 0::numeric, null::text;
    else
      return query select 'unknown'::text, null::numeric,
        ('Entreprise de l''Union (' || v_country || ') dont le numéro de TVA intracommunautaire est '
         || case when v_vat is null then 'absent' else 'non validé' end
         || '. On ne sait pas si elle est assujettie : facturer 0 % laisserait Oasis Care redevable de la TVA, '
         || 'et supposer le taux français serait faux dans l''autre sens. Validez le numéro avant d''émettre.')::text;
    end if;
    return;
  end if;

  return query select 'outsideEu'::text, 0::numeric, null::text;
end;
$$;

comment on function public.saas_vat_regime_compute(uuid) is
  'LE calcul du régime de TVA, sans garde et sans appelant direct. Révoquée de tous les rôles clients : '
  'saas_vat_regime() et billing_provider_tax_terms() sont les deux seules portes, et chacune porte la sienne.';

-- LA FONCTION DE 0081, REBRANCHÉE SANS CHANGER SON CONTRAT.
--
-- On ne modifie pas le FICHIER 0081 — il est appliqué en production et
-- ne se rejoue pas. On remplace la fonction depuis la migration qui
-- suit, ce qui est la seule façon correcte de faire évoluer du code
-- déployé. La garde est recopiée à l'identique ; seul le corps devient
-- un appel.
create or replace function public.saas_vat_regime(p_organization_id uuid)
returns table (regime text, rate numeric, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Franchir la RLS oblige à refaire le contrôle ici : c'est la règle R3
  -- de 0075, « posséder la clé n'est pas être autorisé ». Recopiée
  -- telle quelle depuis 0081 : ce remplacement ne desserre rien.
  if not (public.platform_admin_can('billing.invoices.read')
          or public.platform_admin_can('billing.plans.read')) then
    raise exception 'Accès refusé : le régime de TVA d''un client se lit avec billing.invoices.read ou billing.plans.read.'
      using errcode = '42501';
  end if;

  return query select c.regime, c.rate, c.reason
  from public.saas_vat_regime_compute(p_organization_id) c;
end;
$$;

-- ------------------------------------------------------------
-- 8.e.2 LA CORRESPONDANCE DES TAUX CHEZ LE PRESTATAIRE
-- ------------------------------------------------------------
-- Même raisonnement qu'au § 2 pour les tarifs, et pour les mêmes
-- raisons. Un taux de taxe chez le prestataire est un OBJET, désigné par
-- une chaîne opaque (`txr_…`), différente en essai et en production, et
-- IMMUABLE : changer un pourcentage, c'est créer un nouvel objet. Le
-- coder en dur ferait encaisser l'ancien taux le jour où la TVA bouge.
--
-- `percentage` est recopié pour DÉTECTER LA DÉRIVE : si
-- `saas_vat_rates` dit 20,00 et que la correspondance dit 19,60, le
-- tunnel refuse au lieu d'encaisser un taux périmé.
create table if not exists public.billing_provider_tax_rates (
  id uuid primary key default gen_random_uuid(),

  provider text not null references public.billing_providers (key) on delete restrict,
  mode text not null check (mode in ('test', 'live')),

  -- Le pays de l'entreprise cliente, tel que `business_organizations`
  -- le porte. On ne modélise pas le régime : un régime à 0 % n'a besoin
  -- d'AUCUN objet chez le prestataire (on n'envoie simplement pas de
  -- taxe), donc seuls les pays réellement taxés ont une ligne ici.
  country_code text not null
    check (country_code = upper(btrim(country_code)) and length(country_code) = 2),

  percentage numeric(5, 2) not null check (percentage > 0 and percentage <= 100),

  provider_tax_rate_id text not null
    constraint billing_provider_tax_rates_id_not_blank check (btrim(provider_tax_rate_id) <> ''),

  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- UNE SEULE VÉRITÉ PAR PAYS ET PAR MODE, tant qu'elle est active.
-- L'historique reste : on désactive, on ne supprime pas — un taux ayant
-- servi à encaisser doit rester lisible pour expliquer une facture
-- passée.
create unique index if not exists billing_provider_tax_rates_active_slot_idx
  on public.billing_provider_tax_rates (provider, mode, country_code)
  where is_active;

-- Un objet du prestataire ne sert qu'une case, comme pour les tarifs.
create unique index if not exists billing_provider_tax_rates_unique_remote_idx
  on public.billing_provider_tax_rates (provider, mode, provider_tax_rate_id);

comment on table public.billing_provider_tax_rates is
  'NOS taux de TVA reliés aux objets de taxe du prestataire, PAR MODE. Le pourcentage est recopié pour détecter la dérive : '
  'une correspondance périmée doit faire refuser la souscription, jamais encaisser l''ancien taux.';

-- ------------------------------------------------------------
-- 8.e.3 CE QU'IL FAUT ENCAISSER EN PLUS DU HORS TAXES
-- ------------------------------------------------------------
-- Sur le modèle de `billing_provider_price_terms` : ELLE NE LÈVE JAMAIS
-- pour un cas commercial, et quand elle bloque, elle ne rend AUCUN
-- taux — un appelant distrait ne trouve rien à appliquer plutôt qu'un
-- taux approximatif.
--
-- Elle lève en revanche sur un défaut de DROIT : lire le régime fiscal
-- d'une entreprise qui n'est pas la sienne n'est pas un cas commercial.
create or replace function public.billing_provider_tax_terms(
  p_provider text,
  p_mode text,
  p_organization_id uuid
)
returns table (
  regime text,
  rate numeric,
  provider_tax_rate_id text,
  blocking_reason text,
  reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_active boolean;
  v_reg record;
  v_country text;
  v_map record;
begin
  regime := null;
  rate := null;
  provider_tax_rate_id := null;
  blocking_reason := null;
  reason := null;

  -- LA GARDE. `security definer` franchit la RLS ; on refait donc le
  -- contrôle ici. Le client lit SON régime, l'habilité lit celui de
  -- tout le monde, personne d'autre ne lit rien.
  if not (public.is_organization_member(p_organization_id)
          or public.platform_admin_can('billing.invoices.read')
          or public.platform_admin_can('billing.plans.read')) then
    raise exception 'Accès refusé : le régime de TVA d''une entreprise se lit depuis cette entreprise, ou avec billing.invoices.read.'
      using errcode = '42501';
  end if;

  select bp.is_active into v_provider_active
  from public.billing_providers bp where bp.key = p_provider;

  if v_provider_active is null then
    blocking_reason := 'providerUnknown';
    return next; return;
  end if;
  if not v_provider_active then
    blocking_reason := 'providerNotRetained';
    return next; return;
  end if;
  if p_mode is null or p_mode not in ('test', 'live') then
    blocking_reason := 'modeUnknown';
    return next; return;
  end if;

  select * into v_reg from public.saas_vat_regime_compute(p_organization_id) t;
  regime := v_reg.regime;
  rate := v_reg.rate;
  reason := v_reg.reason;

  -- 'unknown' N'EST PAS 0 %, ET N'EST PAS 20 % NON PLUS. C'est le
  -- refus de deviner, et il doit fermer la caisse. Encaisser 0 % à un
  -- assujetti laisserait Oasis Care redevable de la taxe ; encaisser
  -- 20 % à un preneur en autoliquidation lui ferait payer une taxe
  -- qu'il ne doit pas et qu'on n'aurait aucun droit de collecter.
  if v_reg.regime is null or v_reg.regime = 'unknown' then
    blocking_reason := 'vatRegimeUnknown';
    return next; return;
  end if;

  if v_reg.rate is null then
    blocking_reason := 'vatRateUnknown';
    return next; return;
  end if;

  -- UN TAUX À ZÉRO N'A BESOIN D'AUCUN OBJET CHEZ LE PRESTATAIRE.
  -- Autoliquidation et hors Union : on n'envoie simplement pas de taxe,
  -- et le montant prélevé vaut le hors taxes. Créer un objet « 0 % »
  -- serait un objet de plus à tenir à jour pour un effet nul.
  if v_reg.rate = 0 then
    return next; return;
  end if;

  select upper(btrim(o.country)) into v_country
  from public.business_organizations o where o.id = p_organization_id;

  select * into v_map
  from public.billing_provider_tax_rates m
  where m.provider = p_provider
    and m.mode = p_mode
    and m.country_code = v_country
    and m.is_active;

  if v_map.id is null then
    blocking_reason := 'providerTaxRateMissing';
    return next; return;
  end if;

  -- LA DÉRIVE DU TAUX. Même discipline que sur les montants : un objet
  -- de taxe est immuable chez le prestataire, donc une correspondance
  -- qui ne suit plus notre table encaisserait l'ancien taux en silence.
  if v_map.percentage is distinct from v_reg.rate then
    blocking_reason := 'taxRateDrift';
    return next; return;
  end if;

  provider_tax_rate_id := v_map.provider_tax_rate_id;
  return next;
end;
$$;

comment on function public.billing_provider_tax_terms(text, text, uuid) is
  'Le régime de TVA du client et l''objet de taxe à appliquer chez le prestataire — ou le motif lisible qui l''en empêche. '
  'Ne lève jamais pour un cas commercial. Un régime « unknown » ferme la caisse : on ne devine ni 0 %, ni 20 %.';

-- ------------------------------------------------------------
-- 8.e.4 ÉCRIRE LA CORRESPONDANCE DE TAUX
-- ------------------------------------------------------------
create or replace function public.admin_set_provider_tax_rate(
  p_provider text,
  p_mode text,
  p_country_code text,
  p_percentage numeric,
  p_provider_tax_rate_id text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_country text;
  v_notre numeric;
  v_id uuid;
  v_old jsonb;
  v_pris uuid;
begin
  if not public.platform_admin_can('billing.providers.write') then
    raise exception 'Accès refusé : permission billing.providers.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : relier un taux de TVA à un objet du prestataire, c''est décider de ce qui sera prélevé en plus.'
      using errcode = '23514';
  end if;

  v_country := upper(btrim(coalesce(p_country_code, '')));
  if length(v_country) <> 2 then
    raise exception 'Code pays attendu sur deux lettres.' using errcode = '23514';
  end if;

  -- ON RELIT NOTRE TABLE DE TAUX, ET C'EST LE CŒUR DE LA FONCTION. Le
  -- pourcentage reçu n'est pas cru, il est CONFRONTÉ : c'est
  -- `saas_vat_rates` qui fait autorité, jamais la saisie.
  select r.standard_rate into v_notre
  from public.saas_vat_rates r where r.country_code = v_country;

  if v_notre is null then
    raise exception 'Aucun taux normal enregistré pour % dans saas_vat_rates. On ne relie pas un objet de taxe à un taux que nous ne connaissons pas.',
      v_country using errcode = '23514';
  end if;
  if v_notre is distinct from p_percentage then
    raise exception 'Taux refusé : notre table dit %, la correspondance déclarée en dit %. Créez le bon objet chez le prestataire plutôt que d''enregistrer l''écart.',
      v_notre, p_percentage using errcode = '23514';
  end if;
  if p_provider_tax_rate_id is null or btrim(p_provider_tax_rate_id) = '' then
    raise exception 'Identifiant de taux vide : refusé.' using errcode = '23514';
  end if;

  -- LE MÊME PIÈGE QUE POUR LES TARIFS, FERMÉ DE LA MÊME FAÇON. Un
  -- `on conflict` sur l'identifiant distant réécrirait la case d'un
  -- AUTRE pays en rendant un succès. On refuse explicitement.
  select t.id into v_pris
  from public.billing_provider_tax_rates t
  where t.provider = p_provider and t.mode = p_mode
    and t.provider_tax_rate_id = btrim(p_provider_tax_rate_id)
    and t.country_code is distinct from v_country;

  if v_pris is not null then
    raise exception 'Ce taux du prestataire est déjà employé pour un autre pays. Un objet de taxe ne sert qu''une case.'
      using errcode = '23505';
  end if;

  select t.id, to_jsonb(t) into v_id, v_old
  from public.billing_provider_tax_rates t
  where t.provider = p_provider and t.mode = p_mode
    and t.country_code = v_country and t.is_active;

  if v_id is null then
    insert into public.billing_provider_tax_rates
      (provider, mode, country_code, percentage, provider_tax_rate_id, note, created_by)
    values (p_provider, p_mode, v_country, p_percentage, btrim(p_provider_tax_rate_id), v_reason, auth.uid())
    returning id into v_id;
  else
    update public.billing_provider_tax_rates
       set percentage = p_percentage,
           provider_tax_rate_id = btrim(p_provider_tax_rate_id),
           note = v_reason,
           updated_at = now()
     where id = v_id;
  end if;

  -- `record_admin_event()` et non un `insert` direct : c'est elle qui
  -- exige `is_platform_admin()` et impose `auth.uid()` comme auteur.
  -- C'est ce qui rend le journal infalsifiable pour un humain — et
  -- c'est exactement pour cela que l'encaissement machine, lui, ne peut
  -- pas s'en servir et écrit sa ligne à la main avec un rôle 'system'.
  perform public.record_admin_event(
    'billingProviderTaxRate.set', 'billing_provider_tax_rate',
    v_id, p_provider || ' ' || p_mode || ' ' || v_country,
    v_old,
    jsonb_build_object('provider', p_provider, 'mode', p_mode, 'countryCode', v_country,
                       'percentage', p_percentage, 'providerTaxRateId', btrim(p_provider_tax_rate_id)),
    v_reason);

  return v_id;
end;
$$;

create or replace function public.admin_deactivate_provider_tax_rate(
  p_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old jsonb;
begin
  if not public.platform_admin_can('billing.providers.write') then
    raise exception 'Accès refusé : permission billing.providers.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  select to_jsonb(t) into v_old from public.billing_provider_tax_rates t where t.id = p_id;
  if v_old is null then
    raise exception 'Correspondance de taux introuvable.' using errcode = '23503';
  end if;

  update public.billing_provider_tax_rates
     set is_active = false, note = v_reason, updated_at = now()
   where id = p_id;

  perform public.record_admin_event(
    'billingProviderTaxRate.deactivated', 'billing_provider_tax_rate',
    p_id, (v_old ->> 'country_code'),
    v_old, jsonb_build_object('isActive', false), v_reason);
end;
$$;


-- ============================================================
-- 8.f LES SIÈGES FACTURÉS CONTRE LES SIÈGES RÉELS
-- ============================================================
--
-- CE QUE CETTE FONCTION RÉPARE : la VISIBILITÉ, pas la facturation.
--
-- `organization_subscriptions.billable_extra_seats` est une colonne
-- STOCKÉE, saisie à la main par un administrateur, et c'est elle que la
-- facturation de 0081 relit à chaque période — elle ne recompte jamais.
-- Une entreprise qui souscrit à trois comptes puis en ouvre vingt-cinq
-- paie donc indéfiniment zéro siège supplémentaire, et l'écart ne
-- s'affiche nulle part. 0081 le reconnaît elle-même en commentaire, avec
-- la requête d'écart laissée à jouer à la main.
--
-- CE QU'ON NE FAIT PAS ICI, ET POURQUOI. Rebrancher la facturation sur
-- le comptage réel demanderait de remplacer
-- `saas_subscription_billing_lines()` — une fonction de 0081, déployée,
-- couverte par 253 tests, et qui décide de ce qui part sur les factures
-- de tout le monde. Ce n'est pas un geste d'intégration de paiement :
-- c'est une modification du moteur de facturation, elle demande sa
-- propre migration et sa propre campagne de tests, et la faire en
-- passant serait le meilleur moyen de mal facturer tout le monde. Elle
-- est donc NOMMÉE dans le compte rendu, pas bricolée ici.
--
-- CE QU'ON FAIT : on rend l'écart visible et interrogeable. Un écart
-- qu'on peut lire est un écart qu'on peut décider ; un écart invisible
-- ne se décide jamais.
create or replace function public.subscription_seat_drift()
returns table (
  organization_id uuid,
  organization_name text,
  plan text,
  included_seats integer,
  billed_extra_seats integer,
  actual_extra_seats integer,
  difference integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.platform_admin_can('billing.subscriptions.read') then
    raise exception 'Accès refusé : permission billing.subscriptions.read manquante.'
      using errcode = '42501';
  end if;

  return query
  select
    s.organization_id,
    o.name,
    s.plan,
    p.included_seats,
    s.billable_extra_seats,
    greatest(m.membres - p.included_seats, 0)::integer,
    (greatest(m.membres - p.included_seats, 0) - s.billable_extra_seats)::integer
  from public.organization_subscriptions s
  join public.business_organizations o on o.id = s.organization_id
  join public.organization_plans p on p.key = s.plan
  cross join lateral (
    select count(*)::integer as membres
    from public.organization_members mm
    where mm.organization_id = s.organization_id and mm.archived_at is null
  ) m
  where p.included_seats is not null
    and p.seat_policy = 'billedBeyondIncluded'
    and greatest(m.membres - p.included_seats, 0) is distinct from s.billable_extra_seats
  order by (greatest(m.membres - p.included_seats, 0) - s.billable_extra_seats) desc;
end;
$$;

comment on function public.subscription_seat_drift() is
  'Les entreprises dont le nombre de sièges FACTURÉS ne correspond plus au nombre de sièges RÉELLEMENT ouverts. '
  'Ne corrige rien : rend l''écart lisible, parce qu''un écart invisible ne se décide jamais.';

-- LA CORRESPONDANCE DE TAUX N'EST PAS UNE DONNÉE CLIENT, exactement
-- comme celle des tarifs. Ce que le client doit savoir — son régime, et
-- ce qui sera prélevé — lui parvient par `billing_provider_tax_terms()`,
-- qui est une fonction et porte sa garde.
alter table public.billing_provider_tax_rates enable row level security;

drop policy if exists "Les habilités lisent la correspondance des taux" on public.billing_provider_tax_rates;
create policy "Les habilités lisent la correspondance des taux" on public.billing_provider_tax_rates
  for select using (public.platform_admin_can('billing.providers.read'));


-- ============================================================
-- 9. LES DROITS
-- ============================================================
--
-- LA LEÇON DE 0055 ET DE 0057, RÉAPPLIQUÉE MOT POUR MOT. Supabase
-- accorde par défaut TOUS les droits sur un objet créé dans `public` à
-- `anon` et `authenticated`, et une fonction y est par défaut exécutable
-- par `public`. Sur une fonction `security definer`, ce défaut est une
-- porte ouverte. On retire tout — à `public` d'abord, dont le droit est
-- hérité par tout le monde et survivrait au retrait des deux autres —
-- puis on rend le strict nécessaire.

do $$
declare t text;
begin
  foreach t in array array[
    'billing_providers',
    'billing_provider_prices',
    'billing_provider_customers',
    'billing_provider_events',
    'billing_provider_tax_rates'
  ]
  loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    -- AUCUNE écriture depuis un jeton, sur AUCUNE de ces tables. Ni une
    -- correspondance de tarif, ni un identifiant de client, ni une
    -- ligne de journal : les fonctions de ce fichier sont le seul chemin.
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9.a Les fonctions d'administration : `authenticated`, garde à l'intérieur
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.billing_provider_price_terms(text, text, text, text, text, text, text)',
    'public.admin_set_provider_price(text, text, text, text, text, text, text, text, text, bigint, text, text)',
    'public.admin_deactivate_provider_price(uuid, text)',
    -- LA TAXE. `billing_provider_tax_terms` est accordée à
    -- `authenticated` parce que le TUNNEL DE PAIEMENT en a besoin : il
    -- tourne sous le jeton du client et doit savoir ce qui sera
    -- réellement prélevé. Sa garde interne n'autorise que l'entreprise
    -- de l'appelant, ou un habilité.
    'public.billing_provider_tax_terms(text, text, uuid)',
    'public.admin_set_provider_tax_rate(text, text, text, numeric, text, text)',
    'public.admin_deactivate_provider_tax_rate(uuid, text)',
    'public.subscription_seat_drift()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9.a bis LE CALCUL NU, QUI N'EST À PERSONNE
-- ------------------------------------------------------------
-- `saas_vat_regime_compute()` ne porte AUCUNE garde : c'est tout
-- l'intérêt, elle est le calcul et rien d'autre. Elle doit donc être
-- inatteignable depuis un jeton, sans quoi n'importe quel compte
-- connecté lirait le régime fiscal de n'importe quelle entreprise.
-- Seules les deux fonctions qui portent une garde l'appellent, et
-- elles sont `security definer` : leur propriétaire, lui, a le droit.
do $$
begin
  execute 'revoke all on function public.saas_vat_regime_compute(uuid) from public';
  execute 'revoke all on function public.saas_vat_regime_compute(uuid) from anon';
  execute 'revoke all on function public.saas_vat_regime_compute(uuid) from authenticated';
end $$;

-- ------------------------------------------------------------
-- 9.b LES FONCTIONS DE LA MACHINE : `service_role` SEUL
-- ------------------------------------------------------------
-- CE SONT LES QUATRE PORTES QU'UN CLIENT NE DOIT JAMAIS POUVOIR
-- POUSSER. « Enregistrer un encaissement » appelé depuis un navigateur,
-- c'est un abonnement gratuit — un droit ne s'ouvre que sur un
-- encaissement confirmé, jamais sur un retour de navigateur que
-- l'utilisateur peut fabriquer.
--
-- Elles sont donc révoquées de `public`, d'`anon` ET d'`authenticated`,
-- et accordées explicitement à `service_role`. Explicitement, plutôt
-- qu'en comptant sur le défaut de Supabase : un défaut peut changer, et
-- une intention écrite se relit.
do $$
declare
  f text;
  v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  foreach f in array array[
    'public.billing_provider_event_record(text, text, text, text, text, timestamptz, jsonb)',
    'public.billing_provider_event_close(text, text, text, text)',
    'public.billing_provider_link_customer(text, text, uuid, text)',
    'public.saas_record_provider_payment(text, text, text, uuid, bigint, text, text, date)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
    if v_service then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;


-- ============================================================
-- 10. LA MATRICE DES DROITS — le piège de 0075, une fois de plus
-- ============================================================
--
-- 0081 A SEMÉ `billing.providers.read` ET `billing.providers.write`
-- DANS LE CATALOGUE, et les a données au super-administrateur par la
-- jointure du § 1.c. Elles ne sont portées par PERSONNE D'AUTRE, et
-- c'est ce fichier qui doit y remédier : une permission qu'aucun rôle
-- ne porte n'échoue pas, elle fait simplement disparaître l'écran du
-- menu, sans un mot.
--
-- ON REJOUE LA JOINTURE quand même. Elle est idempotente, et c'est
-- exactement l'oubli qui a coûté deux incidents dans ce projet.

insert into public.platform_admin_role_permissions (role, permission)
select 'super_admin', key from public.platform_admin_permissions
on conflict do nothing;

-- `billing_admin` TIENT LA CORRESPONDANCE. C'est son métier : il fixe
-- déjà les prix (`billing.plans.write`) et encaisse
-- (`billing.invoices.write`). Relier nos prix à ceux du prestataire est
-- le même geste, poursuivi.
insert into public.platform_admin_role_permissions (role, permission) values
  ('billing_admin', 'billing.providers.read'),
  ('billing_admin', 'billing.providers.write')
on conflict do nothing;

-- LE SUPPORT LIT, ET NE FAIT QUE LIRE. Il porte déjà
-- `billing.invoices.read` : voir la facture entière d'un client, avec
-- son SIRET et ses montants, est strictement plus sensible que voir la
-- ligne de journal qui dit « paiement refusé le 3 ». Sans cette lecture,
-- il ne peut pas répondre à « pourquoi mon paiement n'est pas passé »
-- autrement qu'en escaladant, et l'escalade est ce que ce jalon cherche
-- à réduire. Le garde-fou de la matrice l'autorise : la règle sur
-- `billing.%` ne vise que `is_write`.
insert into public.platform_admin_role_permissions (role, permission) values
  ('support', 'billing.providers.read')
on conflict do nothing;

-- `read_only_analyst` ne reçoit RIEN, ici comme en 0081 : le journal
-- d'un prestataire de paiement n'est pas une donnée d'analyse.


-- ============================================================
-- 11. CE QUE CE FICHIER N'A PAS FAIT, ET POURQUOI
-- ============================================================
--
--   • AUCUNE SECONDE NUMÉROTATION. `saas_document_counters` garde ses
--     deux natures, 'invoice' et 'creditNote'. Le test le vérifie.
--
--   • AUCUN CHEMIN MACHINE POUR CRÉER OU FAIRE AVANCER UN ABONNEMENT.
--     `record_subscription_event()` et `admin_create_subscription()`
--     exigent un administrateur et un second facteur, et rien ne les
--     remplace ici. Un gestionnaire de webhook peut donc constater un
--     paiement, pas ouvrir un abonnement : c'est une décision à prendre
--     avec le reste du tunnel d'inscription, pas à trancher dans une
--     migration de plomberie.
--
--   • AUCUNE VALIDATION DE NUMÉRO INTRACOMMUNAUTAIRE. `saas_vat_regime`
--     rend 'unknown' tant que `vat_number_validated_at` est vide, et
--     l'émission est refusée — désormais la SOUSCRIPTION aussi, par
--     `billing_provider_tax_terms()` (§ 8.e.3). Un client de l'Union
--     hors France ne peut donc pas s'abonner tant que son numéro n'a
--     pas été validé : c'est volontairement plus strict que de deviner,
--     et cela reste un arbitrage fiscal à trancher avec le comptable.
--
--   • AUCUN MOTEUR DE TAXE CHEZ LE PRESTATAIRE, et c'est maintenant une
--     décision APPLIQUÉE et non seulement annoncée. `tax_behavior` est
--     verrouillé sur 'exclusive' : nos tarifs sont hors taxes. La taxe
--     est calculée par NOUS — `saas_vat_regime_compute()` décide du
--     régime, `billing_provider_tax_rates` relie le taux à l'objet du
--     prestataire — et transmise explicitement à la session de
--     paiement. Le moteur automatique du prestataire reste ÉTEINT : les
--     deux ensemble seraient deux vérités sur la même transaction, et
--     celui du prestataire ne signale rien quand une immatriculation
--     manque, il calcule zéro.
--
--   • AUCUN REBRANCHEMENT DE LA FACTURATION DES SIÈGES. Voir § 8.f :
--     l'écart entre sièges facturés et sièges réels est rendu LISIBLE,
--     il n'est pas corrigé. Le corriger demande de remplacer
--     `saas_subscription_billing_lines()` de 0081, ce qui est une
--     modification du moteur de facturation et mérite sa propre
--     migration.
