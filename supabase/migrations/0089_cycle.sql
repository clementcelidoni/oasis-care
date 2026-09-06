-- Oasis Care — LE CYCLE DE VIE DE L'ABONNEMENT (migration 0089).
--
-- Ce fichier met en œuvre quatre décisions du dirigeant, prises le
-- 5 septembre 2026, et rien d'autre. Ses mots :
--
--   « Non il doit pas créer de compte, prélevé tous les mois, s'il
--     s'abonne il paie le premier mois direct et ainsi de suite. Essai
--     gratuit un mois avec carte obligatoirement, oui il faut qu'il y
--     ait une validation de la TVA. »
--
-- ============================================================
-- L'AMBIGUÏTÉ, LEVÉE ICI ET SIGNALÉE, PARCE QU'ELLE PORTE SUR DE
-- L'ARGENT
-- ============================================================
--
-- « Il paie le premier mois direct » et « essai gratuit un mois » ne
-- peuvent pas être vrais EN MÊME TEMPS POUR LE MÊME CLIENT. La lecture
-- retenue, faute de consigne plus précise, et à faire confirmer :
--
--   • Un nouveau client entre PAR L'ESSAI : un mois gratuit, carte
--     ENREGISTRÉE mais JAMAIS DÉBITÉE. Au terme du mois, premier
--     prélèvement, puis tous les mois à date anniversaire.
--   • Celui qui renonce à l'essai, ou qui l'écourte, paie LE JOUR MÊME.
--
-- Aucun client ne paie à la fois « le premier mois direct » et « un
-- mois gratuit ». Si le dirigeant voulait dire l'inverse — pas d'essai
-- du tout, paiement immédiat pour tout le monde — il suffit d'appeler
-- saas_start_subscription(..., p_with_trial => false) : le chemin
-- existe, et il est éprouvé par le test.
--
-- ============================================================
-- LE TERME EST À ÉCHOIR, ET C'EST LA RÈGLE QUI TIENT TOUT LE RESTE
-- ============================================================
--
-- La facture d'un mois est émise LE PREMIER JOUR de ce mois, et elle
-- est exigible LE JOUR DE SON ÉMISSION. Elle PRÉCÈDE l'encaissement,
-- jamais l'inverse.
--
-- Ce n'est pas une préférence comptable, c'est ce qui rend le
-- rapprochement du webhook possible : stripe-webhook/rapprochement.ts
-- cherche parmi les factures ÉMISES celle dont le reste à payer
-- correspond au montant encaissé. Si l'encaissement arrivait avant la
-- facture, il ne trouverait aucune candidate et tomberait en « à
-- rapprocher à la main » — à chaque prélèvement, de chaque client.
--
-- 0081 posait due_on = current_date + saas_billing_issuer.payment_terms_days,
-- dont la seule ligne en base vaut 30. Trente jours de délai sur un
-- prélèvement carte du jour même est simplement faux : la facture
-- serait « en retard » le lendemain de son encaissement. Ce fichier
-- ajoute saas_invoices.payment_terms_days — le délai porté par LA
-- FACTURE — et la machine y écrit 0.
--
-- ============================================================
-- L'ENGAGEMENT CROISÉ AVEC L'ESSAI — LA DÉCISION, ET POURQUOI
-- ============================================================
--
-- À RELIRE DANS DEUX ANS, QUAND QUELQU'UN SE DEMANDERA POURQUOI LE
-- DOUZIÈME MOIS TOMBE À CETTE DATE-LÀ.
--
-- L'offre FONDATEUR impose 49,90 € pendant douze mois et engage sur
-- douze mois. La question est : ces douze mois partent-ils de la
-- souscription, ou de la fin de l'essai ?
--
-- LA CONTRAINTE DE 0081 TRANCHE LA MOITIÉ DE LA QUESTION À NOTRE PLACE.
-- subscription_discounts_commitment_within_period exige
-- commitment_ends_on <= ends_on : l'engagement ne survit pas à la
-- remise qui le porte. « Douze mois d'engagement à partir de la fin de
-- l'essai, avec une remise qui court dès la souscription » demande
-- treize mois d'un côté et douze de l'autre : la base le refuse, et
-- elle a raison.
--
-- LA DÉCISION : L'ESSAI NE COMPTE PAS DANS L'ENGAGEMENT. LES DEUX
-- PARTENT LE JOUR DU PREMIER PRÉLÈVEMENT.
--
-- Concrètement, la remise est posée avec p_starts_on = la date de fin
-- d'essai. Donc starts_on = fin d'essai, ends_on = fin d'essai + 12
-- mois, commitment_ends_on = fin d'essai + 12 mois. Les deux dates
-- coïncident, la contrainte de 0081 est respectée mot pour mot, et
-- aucune contrainte n'est desserrée.
--
-- POURQUOI PAS L'AUTRE LECTURE. Poser la remise le jour de la
-- souscription donnerait ends_on = souscription + 12 mois alors que le
-- premier mois n'est pas facturé : l'abonné paierait ONZE mois à
-- 49,90 € et le douzième basculerait au tarif public, sans que personne
-- l'ait annoncé. C'est 49,90 € HT de trop par client, en silence, et du
-- mauvais côté : l'écran aura promis « 49,90 € pendant 12 mois » et la
-- facture dira autre chose au douzième. Cette lecture-ci fait payer
-- douze mois pleins au tarif promis, et fait courir l'engagement sur
-- exactement les douze mois payés.
--
-- L'EFFET DE BORD, ASSUMÉ ET À AFFICHER : l'abonné reste treize mois au
-- total — un gratuit, douze payés. Le mois d'essai est donc RÉSILIABLE
-- À TOUT MOMENT SANS PÉNALITÉ, puisque l'engagement n'a pas commencé.
-- C'est cohérent avec « carte obligatoire mais pas débitée », et c'est
-- ce qu'il faut afficher.
--
-- Le § 6 pose la garde qui rend cette règle non contournable : sous
-- essai, une remise qui engage ne peut PAS démarrer à une autre date
-- que la fin de l'essai.
--
-- ============================================================
-- LA VALIDATION DE TVA : TROIS ÉTATS, PAS DEUX
-- ============================================================
--
-- VIES est un service public européen qui tombe, État membre par État
-- membre. Une inscription qui exigerait sa réponse immédiate serait
-- bloquée pour tout un pays chaque fois que son registre est
-- indisponible, et le client n'y comprendrait rien.
--
--   « valide »        → le numéro est bon, la facture s'émet.
--   « refuse »        → le numéro est mauvais, l'émission RESTE refusée.
--   « indisponible »  → on NE SAIT PAS. Ce n'est ni l'un ni l'autre :
--                       l'émission reste refusée ET la ligne repart
--                       dans la file de réessai.
--   NULL              → jamais interrogé. C'est le quatrième état, et
--                       il existait déjà de fait.
--
-- Traiter l'indisponibilité comme un refus perdrait des clients ; comme
-- une validation, elle collecterait mal la TVA. Les deux erreurs
-- coûtent, et dans des sens opposés — c'est pourquoi il faut un
-- troisième état et non un booléen.
--
-- L'INSCRIPTION N'ATTEND PAS. Ce qui attend, c'est l'ÉMISSION DE LA
-- FACTURE, et c'était déjà le comportement de 0081 : rien à ajouter
-- pour ça.
--
-- UN NUMÉRO FRANÇAIS NE PART PAS DANS LA FILE. Régime « france »,
-- 20 %, et la clé se vérifie hors ligne depuis le SIREN.
--
-- ============================================================
-- LA PORTE ANONYME — LA PARTIE LA PLUS DÉLICATE DU FICHIER
-- ============================================================
--
-- C'est la PREMIÈRE porte du produit qui s'ouvre sans compte sur un
-- document commercial. 0084 § 17 posait la question ; le dirigeant y a
-- répondu : « il doit pas créer de compte ».
--
-- Elle se conçoit comme une clé qu'on laisse sous le paillasson : on
-- choisit exactement ce qu'elle ouvre.
--
--   • UN SEUL DOCUMENT. Le jeton ouvre CE devis. Changez un caractère
--     et rien ne s'ouvre.
--   • LECTURE SEULE, ET RIEN QUI RESSEMBLE À UNE SESSION. Le jeton
--     n'authentifie personne. Accepter le devis par ce chemin serait
--     une décision distincte, et elle n'est PAS prise ici.
--   • À DURÉE LIMITÉE, ET RÉVOCABLE. L'échéance est celle du devis
--     (valid_until) quand elle existe — on n'invente pas une seconde
--     date qui contredirait la première. Quand elle n'existe pas — et
--     valid_until EST NULLABLE, donc c'est un cas réel — le jeton porte
--     un PLAFOND de trente jours. Un plafond, pas une seconde échéance.
--   • OPAQUE ET IMPRÉVISIBLE. 32 octets tirés par gen_random_bytes,
--     comme client_invitations.token. Jamais un identifiant de base,
--     jamais un compteur.
--   • CE QUI SORT EST CHOISI COLONNE PAR COLONNE, sur le modèle exact
--     des vues client_* de 0055. Le § 28 de la spec est formel : ni
--     marge, ni coût d'achat, ni note interne, ni rien d'une autre
--     entreprise.
--   • LES TENTATIVES SE COMPTENT ET SE VOIENT (§ 8.d).
--   • LES OUVERTURES SE DATENT. Ce sera le PREMIER accusé de lecture du
--     produit : aujourd'hui quotes.viewed_at est une saisie humaine, et
--     0088 interdit à l'IA de prétendre autre chose. Le jour où cette
--     porte servira, il faudra revenir dire à 0088 que sa limite a
--     bougé. Pas dans ce fichier : 0088 est hors périmètre.
--
-- ============================================================
-- CE QUE CE FICHIER MODIFIE DE L'EXISTANT, ET POURQUOI
-- ============================================================
--
-- Trois fonctions déjà déployées sont REMPLACÉES. Remplacées, pas
-- dupliquées : il n'en reste qu'une définition de chacune, et leur
-- contrat public ne change pas d'un iota. C'est la façon dont 0083 a
-- fait évoluer saas_vat_regime, et c'est la seule correcte pour du code
-- déployé — on ne réécrit pas un fichier de migration appliqué.
--
--   1. saas_vat_regime_compute(uuid) — le CALCUL du régime, posé par
--      0083. Mêmes cinq valeurs rendues ; seul le champ `reason`
--      distingue désormais « refusé », « indisponible » et « jamais
--      interrogé ». Un administrateur qui lit « non validé » ne sait pas
--      s'il doit appeler le client ou attendre.
--      C'EST LA SEULE FONCTION DE TVA À TOUCHER. La modifier deux fois,
--      ou modifier la mauvaise, ferait diverger « ce qu'on facture » et
--      « ce qu'on encaisse » — le défaut que 0083 décrit au § 8.e.
--
--   2. saas_subscription_billing_lines(uuid, date, date) — la garde
--      accepte désormais aussi LA MACHINE (§ 4.a). Le corps est repris
--      à l'identique, à un appel près : elle interroge
--      saas_vat_regime_compute() au lieu de saas_vat_regime(), qui
--      aurait refusé la machine par sa propre garde.
--
--   3. saas_issue_invoice(uuid, text) — même garde élargie, plus deux
--      détails : le délai de paiement peut venir de la facture, et la
--      trace de la machine va dans son propre journal, parce que
--      record_admin_event() refuse d'être signée par autre chose qu'un
--      administrateur.
--
-- CE FICHIER NE TOUCHE À AUCUNE TABLE DE 0081 AUTREMENT QU'EN AJOUTANT
-- DES COLONNES, ET À AUCUNE CONTRAINTE EXISTANTE.
--
-- ============================================================
-- CE QUE CE FICHIER NE FAIT PAS
-- ============================================================
--
--   • IL N'INSTALLE PAS pg_cron NI pg_net. Créer une extension est un
--     geste de niveau projet : ça démarre un travailleur d'arrière-plan
--     et ça ne se défait pas proprement. Une migration de facturation
--     n'a pas à décider ça pour tout le projet, en production, sans que
--     personne regarde. Et une migration qui ÉCHOUERAIT faute
--     d'extension bloquerait aussi les 90 % de son contenu qui n'en ont
--     pas besoin — les colonnes de TVA, la porte du devis, le calcul
--     des relances. Le § 10 planifie SI l'extension est là, et le dit à
--     l'écran sinon.
--
--   • IL NE MANIPULE AUCUN SECRET. Pas une clé, nulle part — ni
--     fichier, ni commentaire, ni exemple. La tâche planifiée ne porte
--     que le NOM d'un secret ; la valeur est lue dans Vault à
--     l'exécution. La définition d'une tâche vit dans cron.job, en
--     clair, dans une table de la base : y écrire la clé de service
--     serait la ranger à côté des données qu'elle protège.
--
--   • IL N'APPLIQUE PAS LA REMISE DEPUIS LE TUNNEL.
--     admin_apply_discount reste la seule porte, et elle est
--     administrateur. Ce fichier pose la RÈGLE de date (§ 6) et la
--     garde qui l'impose ; brancher le tunnel dessus est du TypeScript,
--     hors périmètre.
--
--   • IL N'AUTORISE PAS À ACCEPTER UN DEVIS PAR JETON. Lecture seule.
--
-- Idempotente : rejouable en entier sans effet de bord.


-- ============================================================
-- PRÉALABLE — 0083 ET 0084 DOIVENT ÊTRE PASSÉES DEVANT
-- ============================================================
-- Ce fichier se branche sur saas_vat_regime_compute() (0083) et sur
-- email_messages (0084). Sans elles, il se poserait sans erreur et
-- échouerait plus tard, à l'exécution, sur une fonction manquante :
-- l'échec le plus coûteux, celui qui se produit un mois après le
-- déploiement.
do $$
begin
  if to_regprocedure('public.saas_vat_regime_compute(uuid)') is null then
    raise exception 'Appliquez d''abord la migration 0083 : saas_vat_regime_compute() est absente.';
  end if;
  if to_regclass('public.email_messages') is null then
    raise exception 'Appliquez d''abord la migration 0084 : email_messages est absente.';
  end if;
end $$;


-- ============================================================
-- 1. LE CALENDRIER — LE 31 JANVIER EXISTE, LE 31 FÉVRIER NON
-- ============================================================
--
-- Une date anniversaire mensuelle butte sur les mois courts, et c'est
-- le premier endroit où une facturation se met à mentir. Un abonnement
-- souscrit le 31 janvier n'a pas d'anniversaire le 31 février.
--
-- LA RÈGLE, ÉCRITE UNE FOIS ET NULLE PART AILLEURS : on retient le jour
-- d'ancrage quand il existe dans le mois visé, et le DERNIER JOUR DU
-- MOIS sinon. Le 31 janvier devient donc le 28 février (le 29 en année
-- bissextile), le 31 mars, le 30 avril, le 31 mai.
--
-- ET LE POINT QUI COMPTE VRAIMENT : L'ANCRE NE DÉRIVE PAS. C'est
-- pourquoi cette fonction prend le JOUR D'ANCRAGE et pas seulement la
-- date de départ. Un calcul naïf « la période suivante commence un mois
-- après celle-ci » ferait passer le 31 janvier au 28 février, puis au
-- 28 mars, puis au 28 avril : l'abonné souscrit le 31 et se retrouve
-- prélevé le 28 pour le restant de sa vie. Avec l'ancre conservée sur
-- l'abonnement, il repasse au 31 dès que le mois le permet.
create or replace function public.saas_date_anniversaire(
  p_depart date,
  p_mois integer,
  p_jour_ancre smallint
)
returns date
language sql
immutable
as $$
  select case
    when p_depart is null or p_mois is null or p_jour_ancre is null then null
    else (
      -- Le premier du mois visé…
      date_trunc('month', p_depart + make_interval(months => p_mois))::date
      -- …plus le nombre de jours qui mène au jour d'ancrage, PLAFONNÉ
      -- au dernier jour de ce mois-là.
      + least(
          p_jour_ancre::integer,
          extract(day from (
            date_trunc('month', p_depart + make_interval(months => p_mois))
            + interval '1 month - 1 day'))::integer
        ) - 1
    )
  end;
$$;

comment on function public.saas_date_anniversaire(date, integer, smallint) is
  'La date anniversaire, p_mois mois après p_depart, ancrée au jour p_jour_ancre. '
  'Un jour d''ancrage qui n''existe pas dans le mois visé retombe sur le DERNIER jour de ce mois : '
  'le 31 janvier a son anniversaire le 28 février, puis le 31 mars — l''ancre ne dérive pas.';


-- ------------------------------------------------------------
-- 1.b QUI PARLE ? LE CONTEXTE MACHINE
-- ------------------------------------------------------------
--
-- LE PROBLÈME, ET IL EST STRUCTUREL. Toutes les fonctions de
-- facturation de 0081 exigent platform_admin_can(...) et un second
-- facteur. Un ordonnanceur n'a ni compte, ni facteur, ni écran pour le
-- présenter : il ne PEUT PAS franchir ces gardes. Sans un contexte
-- machine, la seule issue serait de recopier trois fonctions de 0081
-- en versions « sans garde » — c'est-à-dire de créer les doublons qui
-- divergeront à la première correction.
--
-- CE QU'ON RECONNAÎT, ET POURQUOI C'EST SÛR :
--
--   • AUCUN UTILISATEUR N'EST DERRIÈRE. auth.uid() est nul : ce n'est
--     ni un paysagiste, ni un administrateur, ni un client.
--   • ET LE RÔLE DE SESSION EST CELUI D'UNE MACHINE. On lit
--     session_user, pas current_user : à l'intérieur d'une fonction
--     `security definer`, current_user vaut le PROPRIÉTAIRE de la
--     fonction — donc postgres — et toute fonction définisseur
--     ressemblerait alors à la machine. Le piège est exactement à cet
--     endroit, et il ouvrirait la porte en grand.
--   • Pour un appel PostgREST, session_user vaut 'authenticator' ; on
--     exige alors que le jeton porte explicitement le rôle
--     'service_role', c'est-à-dire la clé de service, celle qui peut
--     déjà tout lire et tout écrire en base directement.
--
-- ON N'ACCORDE DONC RIEN DE NOUVEAU À PERSONNE. postgres et
-- service_role peuvent déjà lire organization_subscriptions et écrire
-- saas_invoices à la main : leur refuser un CALCUL en lecture
-- n'ajouterait aucune sécurité, ça forcerait seulement la copie.
create or replace function public.saas_contexte_machine()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select auth.uid() is null
     and (
       session_user in ('postgres', 'supabase_admin')
       or coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
            ''
          ) = 'service_role'
     );
$$;

comment on function public.saas_contexte_machine() is
  'Vrai quand l''appel vient d''un ordonnanceur ou de la clé de service, et que PERSONNE n''est '
  'derrière (auth.uid() nul). Lit session_user et NON current_user : dans une fonction '
  'security definer, current_user vaut le propriétaire, et toute fonction définisseur passerait '
  'pour la machine.';

revoke all on function public.saas_contexte_machine() from public;
revoke all on function public.saas_contexte_machine() from anon;
grant execute on function public.saas_contexte_machine() to authenticated;


-- ------------------------------------------------------------
-- 1.c LE JOURNAL DE LA MACHINE
-- ------------------------------------------------------------
-- record_admin_event() refuse d'être signée par autre chose qu'un
-- administrateur — c'est sa raison d'être, et on ne la desserre pas.
-- La machine a donc son propre journal, en AJOUT SEUL, que les
-- habilités lisent.
create table if not exists public.saas_machine_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),

  -- Ce que la machine faisait. Texte libre volontairement : la liste
  -- des traitements va s'allonger, et une contrainte `check` sur un
  -- journal oblige à migrer une table d'historique pour ajouter un mot.
  kind text not null check (btrim(kind) <> ''),

  organization_id uuid references public.business_organizations (id) on delete set null,
  target_type text,
  target_id uuid,
  label text,

  -- Le détail, en français quand un humain doit le lire.
  details jsonb not null default '{}'::jsonb
);

create index if not exists saas_machine_events_when_idx
  on public.saas_machine_events (occurred_at desc);
create index if not exists saas_machine_events_org_idx
  on public.saas_machine_events (organization_id, occurred_at desc);

alter table public.saas_machine_events enable row level security;

drop policy if exists "Les habilités lisent le journal de la machine" on public.saas_machine_events;
create policy "Les habilités lisent le journal de la machine" on public.saas_machine_events
  for select using (public.platform_admin_can('billing.invoices.read'));

-- EN AJOUT SEUL, comme email_messages. Un journal qu'on peut réécrire
-- n'est pas un journal.
create or replace function public.saas_machine_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Le journal de la machine est en ajout seul : ni modification ni suppression.'
    using errcode = '42501';
end;
$$;

drop trigger if exists saas_machine_events_append_only on public.saas_machine_events;
create trigger saas_machine_events_append_only
  before update or delete on public.saas_machine_events
  for each row execute function public.saas_machine_events_append_only();

drop trigger if exists saas_machine_events_refuse_truncate on public.saas_machine_events;
create trigger saas_machine_events_refuse_truncate
  before truncate on public.saas_machine_events
  for each statement execute function public.refuse_truncate();

revoke all on function public.saas_machine_events_append_only() from public;
revoke all on function public.saas_machine_events_append_only() from anon;
revoke all on function public.saas_machine_events_append_only() from authenticated;


-- ============================================================
-- 2. L'ABONNEMENT : L'ANCRE, LA PÉRIODE, LA CARTE
-- ============================================================
--
-- CE QUI MANQUAIT, mesuré : organization_subscriptions ne portait
-- AUCUNE ancre de facturation. current_period_end existait, nullable,
-- et n'était écrite par personne — quatre écrans l'affichent pourtant
-- (web-pro/entreprise/abonnement, web-admin/abonnements, sa page de
-- détail, et lib/billing). Elle affichait donc « — » depuis toujours.
alter table public.organization_subscriptions
  -- LE JOUR DU MOIS OÙ L'ON PRÉLÈVE. C'est LUI l'ancre, pas la date de
  -- la dernière période : voir le § 1 sur la dérive du 31.
  add column if not exists billing_anchor_day smallint,

  -- LA PÉRIODE EN COURS, EN DATES. current_period_end (timestamptz)
  -- reste, et devient le MIROIR de current_period_end_on : c'est elle
  -- que les quatre écrans lisent déjà, et un déclencheur les tient
  -- synchronisées pour qu'elles ne puissent pas diverger.
  add column if not exists current_period_start_on date,
  add column if not exists current_period_end_on date,

  -- LA CARTE EST ENREGISTRÉE — CHEZ LE PRESTATAIRE, JAMAIS ICI. Cette
  -- colonne ne porte QUE la date : aucun numéro, aucune empreinte,
  -- aucun quatre derniers chiffres. L'identifiant du moyen de paiement
  -- vit chez le prestataire, et billing_provider_customers (0083) porte
  -- le lien vers le client là-bas.
  --
  -- C'est cette date qui rend « essai gratuit avec carte
  -- obligatoirement » vérifiable : sans elle, on ne saurait pas
  -- distinguer un essai avec carte d'un essai sans.
  add column if not exists payment_method_registered_at timestamptz,

  -- QUAND L'ESSAI A COMMENCÉ. trial_ends_at existait seule, ce qui
  -- rendait impossible de dire « il lui reste 12 jours sur 30 ».
  add column if not exists trial_started_at timestamptz,

  -- LA DERNIÈRE PÉRIODE RÉELLEMENT FACTURÉE. C'est le garde-fou de
  -- l'ordonnanceur : il ne repart jamais en arrière.
  add column if not exists last_billed_period_start date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_subscriptions_anchor_valid') then
    alter table public.organization_subscriptions add constraint organization_subscriptions_anchor_valid
      check (billing_anchor_day is null or billing_anchor_day between 1 and 31);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_subscriptions_period_ordered') then
    alter table public.organization_subscriptions add constraint organization_subscriptions_period_ordered
      check (current_period_start_on is null
             or current_period_end_on is null
             or current_period_end_on > current_period_start_on);
  end if;

  -- UN ESSAI A UN DÉBUT ET UNE FIN, OU N'EN A NI L'UN NI L'AUTRE. Une
  -- fin d'essai sans début rendrait « il lui reste tant de jours »
  -- incalculable ; un début sans fin serait un essai perpétuel.
  --
  -- LA CONTRAINTE EST ÉCRITE EN UN SEUL SENS, ET C'EST DÉLIBÉRÉ :
  -- admin_create_subscription (0081) pose trial_ends_at sans
  -- trial_started_at, et refuser cela casserait un geste
  -- d'administration déjà déployé. On exige donc seulement qu'un début
  -- d'essai s'accompagne d'une fin.
  if not exists (select 1 from pg_constraint where conname = 'organization_subscriptions_trial_ordered') then
    alter table public.organization_subscriptions add constraint organization_subscriptions_trial_ordered
      check (trial_started_at is null
             or (trial_ends_at is not null and trial_ends_at > trial_started_at));
  end if;
end $$;

comment on column public.organization_subscriptions.billing_anchor_day is
  'Le jour du mois où l''on prélève. Conservé À PART de la période en cours pour que l''ancre '
  'ne dérive pas : un abonnement du 31 janvier passe au 28 février puis REVIENT au 31 mars.';

comment on column public.organization_subscriptions.payment_method_registered_at is
  'Quand la carte a été enregistrée CHEZ LE PRESTATAIRE. Aucune donnée de carte n''est stockée ici, '
  'ni numéro, ni empreinte, ni quatre derniers chiffres — seulement la date. C''est ce qui rend '
  '« essai gratuit avec carte obligatoirement » vérifiable.';

comment on column public.organization_subscriptions.current_period_end is
  'MIROIR de current_period_end_on, tenu par un déclencheur. Les quatre écrans déjà déployés '
  'lisent cette colonne ; les dates font foi.';

-- LE MIROIR, TENU PAR LA BASE ET NON PAR LA POLITESSE DES APPELANTS.
-- Deux colonnes qui disent la même chose finissent toujours par se
-- contredire — sauf quand un déclencheur les recopie.
create or replace function public.organization_subscriptions_sync_period()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.current_period_end := case
    when new.current_period_end_on is null then null
    else new.current_period_end_on::timestamptz
  end;
  return new;
end;
$$;

drop trigger if exists organization_subscriptions_sync_period on public.organization_subscriptions;
create trigger organization_subscriptions_sync_period
  before insert or update on public.organization_subscriptions
  for each row execute function public.organization_subscriptions_sync_period();

revoke all on function public.organization_subscriptions_sync_period() from public;
revoke all on function public.organization_subscriptions_sync_period() from anon;
revoke all on function public.organization_subscriptions_sync_period() from authenticated;


-- ------------------------------------------------------------
-- 2.b LE DÉLAI DE PAIEMENT PORTÉ PAR LA FACTURE
-- ------------------------------------------------------------
-- Voir l'en-tête : un prélèvement carte du jour même n'a pas trente
-- jours de délai. La colonne est NULLABLE et le comportement par défaut
-- ne change pas — une facture sans délai propre reprend celui de
-- l'émetteur, comme avant.
alter table public.saas_invoices
  add column if not exists payment_terms_days integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saas_invoices_payment_terms_not_negative') then
    alter table public.saas_invoices add constraint saas_invoices_payment_terms_not_negative
      check (payment_terms_days is null or payment_terms_days >= 0);
  end if;
end $$;

comment on column public.saas_invoices.payment_terms_days is
  'Le délai de paiement de CETTE facture, en jours. Nul = celui de l''émetteur (30 aujourd''hui). '
  'La machine y écrit 0 : un prélèvement carte est exigible le jour de l''émission, et une '
  'facture « en retard » le lendemain de son encaissement serait fausse.';


-- ============================================================
-- 3. LE MOTEUR — CE QU'UNE PÉRIODE DOIT, ET COMMENT ON L'ÉMET
-- ============================================================
--
-- Les deux fonctions qui suivent sont celles de 0081, REMPLACÉES et non
-- dupliquées. Leur corps est repris à l'identique ; les seules
-- différences sont marquées « 0089 » en commentaire, et il y en a
-- quatre en tout. Leur signature, leurs refus et leurs messages ne
-- changent pas : les tests de 0081 doivent passer sans une ligne de
-- modification, et c'est ce qu'on vérifie.
--
-- POURQUOI REMPLACER PLUTÔT QU'AJOUTER UNE VARIANTE « SANS GARDE ».
-- Une variante, c'est deux définitions de la même règle de facturation.
-- Le jour où l'une est corrigée et pas l'autre, l'écran affiche un
-- montant et la machine en prélève un autre — et personne ne le voit,
-- puisque les deux « fonctionnent ». 0083 a tranché ce même arbitrage
-- au § 8.e pour la TVA, dans l'autre sens (extraire le calcul, garder
-- la garde à la porte) parce que là-bas l'appelant supplémentaire était
-- un CLIENT. Ici l'appelant supplémentaire est la MACHINE, qui peut
-- déjà tout lire et tout écrire directement : élargir la garde
-- n'accorde rien de neuf, et évite la copie.

-- ------------------------------------------------------------
-- 3.a CE QU'UN ABONNEMENT DOIT POUR UNE PÉRIODE
-- ------------------------------------------------------------
create or replace function public.saas_subscription_billing_lines(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  -- `line_position` et non `position` : `position` est un mot réservé du
  -- SQL et ne peut pas nommer une colonne dans un `returns table`.
  line_position integer,
  kind text,
  module_key text,
  description text,
  quantity numeric,
  unit_price_cents bigint,
  vat_rate numeric,
  blocking_reason text
)
language plpgsql
stable
-- `security definer`, pour la même raison que `saas_vat_regime` juste
-- au-dessus : un administrateur n'est membre d'aucune entreprise, et en
-- `security invoker` cette fonction ne voyait NI l'abonnement, NI les
-- modules souscrits, NI la remise. Elle rendait alors zéro ligne — un
-- écran vide qui se serait lu « cette entreprise ne doit rien ».
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_plan record;
  v_regime record;
  v_rate numeric;
  v_regime_block text;
  v_base bigint;
  v_pos integer := 0;
  v_disc record;
  v_remise bigint;
  v_mod record;
  v_terms record;
  v_prix bigint;
  v_annuel boolean;
begin
  -- 0089 : LA MACHINE PASSE AUSSI. Un ordonnanceur n'a ni compte ni
  -- second facteur ; sans cette branche il faudrait recopier toute
  -- cette fonction en version « sans garde », et les deux copies
  -- divergeraient. Voir saas_contexte_machine() au § 1.b.
  if not public.saas_contexte_machine()
     and not (public.platform_admin_can('billing.subscriptions.read')
              or public.platform_admin_can('billing.invoices.read')) then
    raise exception 'Accès refusé : ce calcul se lit avec billing.subscriptions.read ou billing.invoices.read.'
      using errcode = '42501';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    return;
  end if;

  select * into v_plan from public.organization_plans where key = v_sub.plan;
  v_annuel := (v_sub.billing_cycle = 'yearly');

  -- 0089 : le CALCUL du régime, et non la porte. saas_vat_regime()
  -- porte sa propre garde d'administrateur et aurait refusé la machine
  -- ici — un refus que le paragraphe précédent vient précisément de
  -- lever. Les deux rendent la même chose : 0083 a extrait le calcul
  -- pour qu'il n'existe qu'une seule règle de TVA.
  select * into v_regime from public.saas_vat_regime_compute(p_organization_id);
  v_rate := v_regime.rate;
  if v_regime.regime = 'unknown' then
    v_regime_block := coalesce(v_regime.reason, 'Régime de TVA inconnu.');
  end if;

  -- ---- 1. L'offre ------------------------------------------------
  if v_plan.is_quote_only then
    v_base := case when v_annuel then v_sub.negotiated_yearly_price_cents
                   else v_sub.negotiated_monthly_price_cents end;
  else
    v_base := case when v_annuel then v_plan.yearly_price_cents
                   else v_plan.monthly_price_cents end;
  end if;

  v_pos := v_pos + 1;
  return query select
    v_pos, 'plan'::text, null::text,
    (v_plan.name || ' — ' || case when v_annuel then 'abonnement annuel' else 'abonnement mensuel' end
      || ' du ' || to_char(p_period_start, 'DD/MM/YYYY') || ' au ' || to_char(p_period_end - 1, 'DD/MM/YYYY'))::text,
    1::numeric,
    -- PAS DE `coalesce(..., 0)`. Un prix absent reste NULL jusqu'au
    -- total, qui devient inconnu, et l'émission le refuse. Coalescé à
    -- zéro, il produisait un brouillon à 0,00 € que rien n'empêchait
    -- d'émettre : une facture française numérotée, opposable et
    -- immuable, à zéro euro.
    v_base,
    v_rate,
    coalesce(
      v_regime_block,
      case when v_base is null then
        'L''offre « ' || v_plan.name || ' » n''a pas de prix ' ||
        case when v_annuel then 'annuel' else 'mensuel' end ||
        case when v_plan.is_quote_only then ' négocié sur cet abonnement.' else ' dans la grille.' end
      end);

  -- ---- 2. La remise, si elle couvre le début de période -----------
  select * into v_disc
  from public.subscription_discounts d
  where d.organization_id = p_organization_id
    and d.cancelled_at is null
    and daterange(d.starts_on, d.ends_on, '[)') @> p_period_start
  order by d.starts_on desc
  limit 1;

  -- L'ASSERTION DÉFENSIVE, ET ELLE N'EST PAS DE LA DÉFIANCE ENVERS LES
  -- DÉCLENCHEURS. Ceux du § 4.c et du § 5.b garantissent qu'une remise
  -- restreinte ne peut pas se retrouver sur une autre offre ; ce
  -- contrôle-ci couvre ce qu'ils ne couvrent pas — une ligne écrite
  -- AVANT eux, ou une restauration de sauvegarde. Il BLOQUE plutôt
  -- qu'il n'ignore la remise : appliquer le plein tarif en silence
  -- ferait payer 90 € de plus sans dire pourquoi.
  if v_disc.id is not null
     and v_disc.applies_to_plan is not null
     and v_disc.applies_to_plan is distinct from v_sub.plan then
    v_pos := v_pos + 1;
    return query select v_pos, 'discount'::text, null::text,
      ('Remise « ' || v_disc.label || ' »')::text,
      1::numeric, null::bigint, v_rate,
      ('La remise « ' || v_disc.label || ' » est réservée à l''offre « ' || v_disc.applies_to_plan
       || ' » et cet abonnement est en « ' || v_sub.plan || ' ». La base refuse cette combinaison depuis '
       || 'la migration 0081 : cette ligne est donc antérieure au verrou. Retirez la remise, ou remettez '
       || 'l''abonnement sur son offre.')::text;

  elsif v_disc.id is not null and v_base is not null then
    v_remise := null;
    if v_disc.kind = 'fixedMonthlyPrice' then
      if v_annuel then
        -- LA RÈGLE EST ARRÊTÉE : une remise à prix mensuel imposé NE SE
        -- VEND QU'AU MOIS (§ 4.c). Ce cas n'est donc plus indécidable,
        -- il est IMPOSSIBLE — on n'y arrive que par une donnée
        -- antérieure au verrou, ou par un abonnement basculé en annuel
        -- avant que le déclencheur du § 5.b n'existe. On refuse la
        -- facture plutôt que d'inventer un équivalent annuel que
        -- personne n'a fixé.
        v_pos := v_pos + 1;
        return query select v_pos, 'discount'::text, null::text,
          ('Remise « ' || v_disc.label || ' » — jusqu''au ' || to_char(v_disc.ends_on, 'DD/MM/YYYY'))::text,
          1::numeric, null::bigint, v_rate,
          ('La remise « ' || v_disc.label || ' » est libellée en prix MENSUEL et ne se vend qu''au mois ; '
           || 'cet abonnement est ANNUEL. Son équivalent annuel n''existe pas et ne sera pas inventé : '
           || 'basculez l''abonnement au mois, ou retirez la remise.')::text;
      else
        v_remise := greatest(v_base - v_disc.value_cents, 0);
      end if;
    elsif v_disc.kind = 'percentOff' then
      v_remise := round(v_base * v_disc.percent / 100.0)::bigint;
    elsif v_disc.kind = 'amountOff' then
      v_remise := least(v_disc.value_cents, v_base);
    end if;

    if v_remise is not null and v_remise > 0 then
      v_pos := v_pos + 1;
      return query select v_pos, 'discount'::text, null::text,
        ('Remise « ' || v_disc.label || ' » — jusqu''au ' || to_char(v_disc.ends_on, 'DD/MM/YYYY'))::text,
        1::numeric, (-v_remise)::bigint, v_rate, v_regime_block;
    end if;
  end if;

  -- ---- 3. Les sièges facturés en plus -----------------------------
  if coalesce(v_sub.billable_extra_seats, 0) > 0 then
    v_pos := v_pos + 1;
    if v_annuel then
      return query select v_pos, 'seats'::text, null::text,
        ('Sièges supplémentaires (' || v_sub.billable_extra_seats || ')')::text,
        v_sub.billable_extra_seats::numeric, null::bigint, v_rate,
        'Le prix du siège supplémentaire est fixé au MOIS (9,90 €). Son équivalent ANNUEL n''a pas été décidé : on ne l''invente pas.'::text;
    else
      return query select v_pos, 'seats'::text, null::text,
        ('Sièges supplémentaires (' || v_sub.billable_extra_seats || ')')::text,
        v_sub.billable_extra_seats::numeric,
        v_plan.extra_seat_monthly_price_cents,
        v_rate,
        coalesce(v_regime_block,
          case when v_plan.extra_seat_monthly_price_cents is null
               then 'L''offre « ' || v_plan.name || ' » n''a pas de prix de siège supplémentaire.' end);
    end if;
  end if;

  -- ---- 4. Les modules ---------------------------------------------
  -- LE PRIX VIENT DE LA MATRICE, JAMAIS DE LA LIGNE D'ABONNEMENT. C'est
  -- ce qui fait qu'un module inclus dans l'offre ne produit AUCUNE
  -- ligne, et qu'un passage de Pro à Pro Business cesse de facturer
  -- BioLab sans qu'on touche à quoi que ce soit.
  for v_mod in
    select sm.module_key, m.name, m.pricing_model, m.metered_unit
    from public.organization_subscription_modules sm
    join public.platform_modules m on m.key = sm.module_key
    where sm.organization_id = p_organization_id and sm.cancelled_at is null
    order by m.position
  loop
    select * into v_terms from public.plan_module_terms(v_sub.plan, v_mod.module_key);

    if v_terms.availability = 'included' then
      continue;  -- compris dans l'offre : rien à facturer, et c'est le point.
    end if;

    v_pos := v_pos + 1;

    if v_terms.availability <> 'optional' then
      return query select v_pos, 'module'::text, v_mod.module_key,
        ('Module ' || v_mod.name)::text, 1::numeric, null::bigint, v_rate,
        ('La case « ' || v_sub.plan || ' × ' || v_mod.name || ' » vaut « ' || v_terms.availability
         || ' » : ce module est souscrit mais l''offre ne dit pas à quel prix.')::text;
    elsif v_mod.pricing_model = 'metered' then
      return query select v_pos, 'module'::text, v_mod.module_key,
        ('Module ' || v_mod.name)::text, 1::numeric, null::bigint, v_rate,
        ('Le module « ' || v_mod.name || ' » se facture au compteur (' || coalesce(v_mod.metered_unit, 'unité')
         || ') et aucune table n''enregistre la consommation. Le montant est INCONNU.')::text;
    else
      v_prix := case when v_annuel then v_terms.yearly_price_cents else v_terms.monthly_price_cents end;
      return query select v_pos, 'module'::text, v_mod.module_key,
        ('Module ' || v_mod.name)::text, 1::numeric, v_prix, v_rate,
        coalesce(v_regime_block,
          case when v_prix is null then
            'La case « ' || v_sub.plan || ' × ' || v_mod.name || ' » n''a pas de prix '
            || case when v_annuel then 'annuel' else 'mensuel' end || '.' end);
    end if;
  end loop;
end;
$$;

comment on function public.saas_subscription_billing_lines(uuid, date, date) is
  'Ce qu''un abonnement doit pour une période. Consulte TOUJOURS la matrice offre × module pour le prix d''un module. '
  'Ne lève jamais : un cas indécidable rend une ligne portant un blocking_reason, et l''émission la refuse. '
  '0089 : la garde accepte aussi la MACHINE (saas_contexte_machine()), et le régime de TVA est lu par '
  'saas_vat_regime_compute() — le calcul, pas la porte.';


-- ------------------------------------------------------------
-- 3.b ÉMETTRE
-- ------------------------------------------------------------
create or replace function public.saas_issue_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_inv record;
  v_issuer record;
  v_org record;
  v_manque text[];
  v_number text;
  v_lines integer;
  v_sans_taux integer;
  v_bloc text;
  v_due date;
  v_machine boolean;
begin
  -- 0089 : LA MACHINE PASSE AUSSI. Émettre la facture d'échéance est
  -- le geste que l'ordonnanceur doit faire chaque nuit ; il n'a ni
  -- compte, ni second facteur, et il ne peut pas en avoir. Tout le
  -- reste de la fonction est INCHANGÉ : mêmes refus, même numérotation,
  -- même verrou de ligne, même idempotence.
  v_machine := public.saas_contexte_machine();

  if not v_machine then
    if not public.platform_admin_can('billing.invoices.write') then
      raise exception 'Accès refusé : permission billing.invoices.write manquante.'
        using errcode = '42501';
    end if;
    perform public.platform_admin_require_mfa();
  end if;

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : émettre une facture, c''est produire un document opposable.'
      using errcode = '23514';
  end if;

  -- `for update` — ET C'EST CE QUI TIENT LA PROMESSE DU FICHIER.
  -- Sans verrou, deux appels réellement simultanés sur le MÊME brouillon
  -- passaient tous deux le test d'idempotence ci-dessous (leurs `select`
  -- précédant le premier `commit`), puis se sérialisaient sur le
  -- compteur : le premier obtenait 00001, le second 00002 et écrasait le
  -- numéro. Le compteur valait 2, la facture portait 00002, et
  -- FS-AAAA-00001 n'existait sur aucun document — un TROU, c'est-à-dire
  -- le défaut que toute cette section existe pour rendre impossible.
  -- Avec le verrou, la seconde transaction attend, relit `issued_at`
  -- déjà renseigné et sort par le chemin idempotent sans consommer de
  -- numéro.
  select * into v_inv from public.saas_invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Facture introuvable.' using errcode = '23503';
  end if;
  if v_inv.issued_at is not null then
    -- IDEMPOTENT. Réémettre ne consomme pas un second numéro : c'est
    -- exactement le genre d'appel qu'un double clic produit.
    return v_inv.number;
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'Cette facture est annulée : elle ne s''émet pas.' using errcode = '23514';
  end if;

  -- 1. L'ÉMETTEUR DOIT ÊTRE COMPLET. Une facture sans SIRET, sans numéro
  -- de TVA, sans IBAN ou sans clause de pénalités est irrégulière.
  v_manque := public.saas_billing_issuer_missing_fields();
  if array_length(v_manque, 1) > 0 then
    raise exception 'Identité de l''émetteur incomplète : il manque %. Une facture ne part pas sans ses mentions obligatoires.', array_to_string(v_manque, ', ')
      using errcode = '23514';
  end if;

  -- 2. LE RÉGIME DE TVA DOIT ÊTRE CONNU. C'est le refus le plus
  -- important du fichier : on n'invente pas un taux.
  if v_inv.vat_regime = 'unknown' then
    raise exception 'Régime de TVA inconnu pour cette entreprise : %. Tranchez-le avant d''émettre — supposer 20 %% ou 0 %% serait faux dans un sens ou dans l''autre.', coalesce(v_inv.vat_note, 'motif non enregistré')
      using errcode = '23514';
  end if;

  select count(*), count(*) filter (where l.vat_rate is null)
    into v_lines, v_sans_taux
  from public.saas_invoice_lines l where l.invoice_id = p_invoice_id;

  if v_lines = 0 then
    raise exception 'Une facture sans ligne ne s''émet pas.' using errcode = '23514';
  end if;
  if v_sans_taux > 0 then
    raise exception 'Au moins une ligne n''a pas de taux de TVA : le total serait inconnu, et un document dont on ne sait pas faire le total ne s''émet pas.'
      using errcode = '23514';
  end if;

  -- 2 ter. AUCUN PRIX INCONNU, ET AUCUN MOTIF DE BLOCAGE RESTANT.
  --
  -- C'est le contrôle qui manquait, et son absence laissait émettre une
  -- facture opposable à 0,00 € : la génération coalesçait un prix
  -- absent à zéro, écrivait le motif dans une colonne de retour que
  -- personne n'enregistrait, et l'émission unitaire — celle du bouton
  -- de l'écran — ne regardait jamais les prix. Le motif est désormais
  -- STOCKÉ sur la ligne fautive, et on le relit ici.
  select string_agg(distinct coalesce(l.blocking_reason,
           'Prix inconnu sur la ligne « ' || l.description || ' »'), ' | ')
    into v_bloc
  from public.saas_invoice_lines l
  where l.invoice_id = p_invoice_id
    and (l.blocking_reason is not null or l.unit_price_cents is null);

  if v_bloc is not null then
    raise exception 'Cette facture ne peut pas être émise : %. Un montant inconnu ne devient pas zéro parce qu''on l''a imprimé.', v_bloc
      using errcode = '23514';
  end if;

  select * into v_issuer from public.saas_billing_issuer where id;
  select * into v_org from public.business_organizations where id = v_inv.organization_id;

  -- 2 bis. LE CLIENT AUSSI DOIT ÊTRE IDENTIFIABLE. Une facture entre
  -- professionnels porte l'identité des DEUX parties. Tous ces champs
  -- sont nullables sur `business_organizations` — une entreprise peut
  -- s'inscrire sans les renseigner — donc c'est ici, et seulement ici,
  -- qu'on refuse. L'autoliquidation exige en plus le numéro
  -- intracommunautaire du preneur : c'est lui qui porte la mention.
  if nullif(btrim(coalesce(v_org.legal_name, v_org.name, '')), '') is null then
    raise exception 'Le client n''a pas de raison sociale : une facture ne peut pas être adressée à personne.'
      using errcode = '23514';
  end if;
  if v_inv.vat_regime = 'france'
     and nullif(btrim(coalesce(v_org.siret, '')), '') is null then
    raise exception 'Le client « % » n''a pas de SIRET : une facture à un professionnel français doit le porter.', coalesce(v_org.legal_name, v_org.name)
      using errcode = '23514';
  end if;
  if v_inv.vat_regime = 'euReverseCharge'
     and nullif(btrim(coalesce(v_org.vat_number, '')), '') is null then
    raise exception 'Autoliquidation sans numéro de TVA intracommunautaire du client : la mention obligatoire serait incomplète.'
      using errcode = '23514';
  end if;

  -- 3. LE NUMÉRO, ET SEULEMENT MAINTENANT. Attribué dans la même
  -- transaction que le reste : si quoi que ce soit échoue en dessous,
  -- l'incrément du compteur disparaît avec, et il n'y a pas de trou.
  v_number := public.saas_next_document_number('invoice', 'FS');

  -- 0089 : LE DÉLAI PORTÉ PAR LA FACTURE PRIME. Un prélèvement carte du
  -- jour même est exigible le jour même ; trente jours de délai
  -- rendraient « en retard » une facture encaissée la veille. Une
  -- facture sans délai propre reprend celui de l'émetteur, comme avant.
  v_due := current_date + coalesce(v_inv.payment_terms_days, v_issuer.payment_terms_days, 30);

  update public.saas_invoices set
    number = v_number,
    status = 'issued',
    issued_on = current_date,
    issued_at = now(),
    due_on = v_due,

    issuer_legal_name = v_issuer.legal_name,
    issuer_legal_form = v_issuer.legal_form,
    issuer_siret = v_issuer.siret,
    issuer_vat_number = v_issuer.vat_number,
    issuer_rcs_city = v_issuer.rcs_city,
    issuer_share_capital_cents = v_issuer.share_capital_cents,
    issuer_address = nullif(concat_ws(', ', v_issuer.address_line1, v_issuer.address_line2,
                                      concat_ws(' ', v_issuer.postal_code, v_issuer.city),
                                      v_issuer.country), ''),
    issuer_email = v_issuer.email,
    issuer_iban = v_issuer.iban,
    issuer_bic = v_issuer.bic,
    issuer_late_penalty_terms = v_issuer.late_penalty_terms,
    issuer_recovery_indemnity_cents = v_issuer.recovery_indemnity_cents,
    issuer_footer = v_issuer.invoice_footer,

    customer_name = v_org.name,
    customer_legal_name = v_org.legal_name,
    customer_legal_form = v_org.legal_form,
    customer_siret = v_org.siret,
    customer_vat_number = v_org.vat_number,
    customer_address = nullif(concat_ws(', ', v_org.address_line1, v_org.address_line2,
                                        concat_ws(' ', v_org.postal_code, v_org.city)), ''),
    customer_country = v_org.country,
    customer_email = v_org.email,

    -- LA RÉFÉRENCE DE PAIEMENT. Sans elle, un virement arrive sans qu'on
    -- sache à quelle facture il correspond. Dérivée du numéro : le
    -- client n'a rien de plus à recopier.
    payment_reference = 'OC' || replace(v_number, '-', ''),

    updated_at = now()
  where id = p_invoice_id;

  -- 0089 : LA TRACE VA DU CÔTÉ DE CELUI QUI A AGI.
  -- record_admin_event() REFUSE d'être signée par autre chose qu'un
  -- administrateur — c'est sa raison d'être, et on ne la desserre pas.
  -- La machine écrit donc dans son propre journal, lui aussi en ajout
  -- seul, lui aussi lisible par les habilités.
  if v_machine then
    insert into public.saas_machine_events (kind, organization_id, target_type, target_id, label, details)
    values ('saasInvoice.issued', v_inv.organization_id, 'saas_invoice', p_invoice_id, v_number,
            jsonb_build_object('dueOn', v_due, 'vatRegime', v_inv.vat_regime, 'motif', v_reason));
  else
    perform public.record_admin_event(
      'saasInvoice.issued', 'saas_invoice', p_invoice_id, v_number,
      jsonb_build_object('status', v_inv.status),
      jsonb_build_object('status', 'issued', 'number', v_number, 'dueOn', v_due,
                         'vatRegime', v_inv.vat_regime),
      v_reason);
  end if;

  return v_number;
end;
$$;

comment on function public.saas_issue_invoice(uuid, text) is
  'Émet une facture d''abonnement : contrôles, numéro sans trou, verrouillage. IDEMPOTENTE. '
  '0089 : la garde accepte aussi la MACHINE, le délai de paiement peut venir de la facture '
  '(payment_terms_days), et la trace de la machine va dans saas_machine_events parce que '
  'record_admin_event() refuse d''être signée par autre chose qu''un administrateur.';


-- ------------------------------------------------------------
-- 3.c PRODUIRE LES FACTURES D'UNE PÉRIODE
-- ------------------------------------------------------------
--
-- CETTE FONCTION EST REMPLACÉE PAR UNE VERSION À SIX PARAMÈTRES, dont
-- le sixième est facultatif. Il faut donc la DÉPOSER d'abord : ajouter
-- un paramètre ne se fait pas par « create or replace », qui créerait
-- une SECONDE fonction et rendrait tout appel à quatre ou cinq
-- arguments ambigu.
--
-- POURQUOI UN FILTRE PAR ENTREPRISE. À terme échoir, chaque abonnement
-- a sa propre date anniversaire : l'un est prélevé le 3, l'autre le 28.
-- La fonction de 0081 ne sait traiter qu'une période COMMUNE à tout le
-- parc — c'était cohérent avec un déclenchement manuel « facturez-moi
-- janvier », ça ne l'est plus avec un ordonnanceur qui suit treize
-- calendriers différents.
--
-- LE CONTRAT NE CHANGE PAS POUR LES APPELANTS EXISTANTS : quatre ou
-- cinq arguments, mêmes colonnes rendues, même idempotence tenue par
-- l'index unique partiel. web-admin/lib/billing/actions.ts l'appelle
-- par paramètres NOMMÉS ; un paramètre supplémentaire à valeur par
-- défaut lui est invisible.
drop function if exists public.saas_generate_invoices(text, date, date, text, boolean);

create or replace function public.saas_generate_invoices(
  p_billing_cycle text,
  p_period_start date,
  p_period_end date,
  p_reason text,
  p_issue boolean default false,
  -- 0089 : LE FILTRE SUR UNE SEULE ENTREPRISE, ET IL EST NÉCESSAIRE.
  -- À terme échoir, chaque abonnement a SA date anniversaire : le
  -- 3 pour l'un, le 28 pour l'autre. Une génération qui ne sait
  -- traiter qu'une période commune facturerait tout le parc à la
  -- date du premier. Nul = tout le parc, comme avant.
  p_organization_id uuid default null
)
returns table (
  organization_id uuid,
  organization_name text,
  invoice_id uuid,
  invoice_number text,
  outcome text,
  total_including_vat_cents bigint,
  blocking_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_sub record;
  v_inv_id uuid;
  v_existing record;
  v_regime record;
  v_bloc text;
  v_pos integer;
  v_credit record;
  v_ttc bigint;
  v_number text;
  v_outcome text;
begin
  -- 0089 : LA MACHINE PASSE AUSSI — voir saas_contexte_machine() § 1.b.
  if not public.saas_contexte_machine() then
    if not public.platform_admin_can('billing.invoices.write') then
      raise exception 'Accès refusé : permission billing.invoices.write manquante.'
        using errcode = '42501';
    end if;
    perform public.platform_admin_require_mfa();
  end if;

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  if p_billing_cycle is null or p_billing_cycle not in ('monthly', 'yearly') then
    raise exception 'Cycle inconnu : %.', coalesce(p_billing_cycle, '(vide)') using errcode = '23514';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'Période invalide : la fin doit suivre le début.' using errcode = '23514';
  end if;

  for v_sub in
    select s.*, o.name as org_name
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.billing_cycle = p_billing_cycle
      -- 0089 : le filtre facultatif.
      and (p_organization_id is null or s.organization_id = p_organization_id)
      -- 'trialing' n'est pas facturé : c'est le sens d'un essai.
      -- 'pastDue' l'est — un impayé ne suspend pas l'abonnement, il
      -- s'ajoute à ce qui est dû.
      and s.status in ('active', 'pastDue')
    order by o.name
  loop
    -- ---- Déjà facturé ? ------------------------------------------
    select i.id, i.number, i.status, i.issued_at into v_existing
    from public.saas_invoices i
    where i.organization_id = v_sub.organization_id
      and i.period_start = p_period_start
      and i.period_end = p_period_end
      and i.status <> 'cancelled';

    v_inv_id := null;
    v_outcome := 'draft';

    if v_existing.id is not null then
      if v_existing.issued_at is not null then
        -- ÉMISE : intouchable, et c'est tout le sens du § 6.h.
        select b.total_including_vat_cents into v_ttc
        from public.saas_invoice_balance b where b.invoice_id = v_existing.id;
        return query select v_sub.organization_id, v_sub.org_name, v_existing.id, v_existing.number,
          'alreadyBilled'::text, v_ttc, null::text;
        continue;
      end if;

      -- ---- BROUILLON : ON LE RECALCULE ----------------------------
      -- LE DÉFAUT QUE CE BLOC REFERME. La fonction se contentait de
      -- CONSTATER l'existence et repartait sans rien recalculer. Toute
      -- modification de l'abonnement survenue depuis — changement
      -- d'offre, module activé ou retiré, remise, sièges — était
      -- ignorée, et c'est ce brouillon PÉRIMÉ qui était ensuite émis,
      -- numéroté et envoyé.
      --
      -- Mesuré : une entreprise passée de Pro à Pro Business (qui
      -- COMPREND BioLab) gardait sa ligne « module BioLab 20,00 € » et
      -- payait deux fois ce que son offre inclut ; dans l'autre sens,
      -- une descente de gamme laissait partir une facture opposable de
      -- 48,00 € de trop.
      --
      -- Un brouillon n'est pas un document : c'est un calcul en attente
      -- de relecture. Le relancer doit donc le REFAIRE.
      v_inv_id := v_existing.id;
      v_outcome := 'refreshed';

      -- Les crédits que ce brouillon avait immobilisés sont rendus
      -- avant de reconstruire : ils seront reconsommés plus bas si le
      -- nouveau calcul les reprend, et resteront ouverts sinon.
      -- `c.` et `l.` partout : cette fonction a un paramètre de SORTIE
      -- nommé `invoice_id`, qui masquerait la colonne du même nom.
      update public.saas_account_credits c
         set consumed_at = null, consumed_invoice_id = null
       where c.consumed_invoice_id = v_inv_id;

      delete from public.saas_invoice_lines l where l.invoice_id = v_inv_id;
    end if;

    -- 0089 : le CALCUL du régime. saas_vat_regime() porte une garde
    -- d'administrateur qui aurait refusé la machine ; les deux rendent
    -- la même chose depuis que 0083 a extrait le calcul.
    select * into v_regime from public.saas_vat_regime_compute(v_sub.organization_id);

    if v_inv_id is null then
      -- 0089 : LA CARTE CHANGE LE MOYEN DE PAIEMENT ET LE DÉLAI.
      -- Quand une carte est enregistrée chez le prestataire, la facture
      -- est prélevée le jour de son émission : elle porte donc
      -- payment_method = 'provider' et un délai de ZÉRO jour. Sans
      -- carte, rien ne change — virement à trente jours, comme avant.
      insert into public.saas_invoices
        (organization_id, period_start, period_end, billing_cycle, currency,
         vat_regime, vat_rate, vat_note, payment_method, payment_terms_days, created_by)
      values (v_sub.organization_id, p_period_start, p_period_end, p_billing_cycle,
              coalesce(v_sub.currency, 'EUR'),
              v_regime.regime, v_regime.rate, v_regime.reason,
              case when v_sub.payment_method_registered_at is not null then 'provider' else 'transfer' end,
              case when v_sub.payment_method_registered_at is not null then 0 end,
              auth.uid())
      returning id into v_inv_id;
    else
      -- Le régime de TVA du client a pu être tranché entre-temps : le
      -- brouillon doit en profiter, sans quoi il resterait bloqué pour
      -- une raison réglée depuis.
      update public.saas_invoices
         set vat_regime = v_regime.regime,
             vat_rate = v_regime.rate,
             vat_note = v_regime.reason,
             currency = coalesce(v_sub.currency, 'EUR'),
             -- 0089 : la carte a pu être enregistrée depuis.
             payment_method = case when v_sub.payment_method_registered_at is not null
                                   then 'provider' else payment_method end,
             payment_terms_days = case when v_sub.payment_method_registered_at is not null
                                       then 0 else payment_terms_days end,
             updated_at = now()
       where id = v_inv_id;
    end if;

    v_bloc := null;
    v_pos := 0;

    insert into public.saas_invoice_lines
      (invoice_id, position, kind, module_key, description, quantity, unit_price_cents, vat_rate, blocking_reason)
    select v_inv_id, l.line_position, l.kind, l.module_key, l.description, l.quantity, l.unit_price_cents, l.vat_rate, l.blocking_reason
    from public.saas_subscription_billing_lines(v_sub.organization_id, p_period_start, p_period_end) l;

    select string_agg(distinct l.blocking_reason, ' | '), max(l.line_position)
      into v_bloc, v_pos
    from public.saas_subscription_billing_lines(v_sub.organization_id, p_period_start, p_period_end) l
    where l.blocking_reason is not null;

    if v_pos is null then
      select max(l.line_position) into v_pos
      from public.saas_subscription_billing_lines(v_sub.organization_id, p_period_start, p_period_end) l;
    end if;

    -- ---- Les crédits ouverts, consommés sur cette facture ---------
    -- Un crédit accordé se déduit ici, une seule fois : la ligne porte
    -- `consumed_invoice_id`, et la contrainte de la table empêche de le
    -- consommer deux fois.
    for v_credit in
      select c.* from public.saas_account_credits c
      where c.organization_id = v_sub.organization_id
        and c.consumed_at is null and c.cancelled_at is null
      order by c.granted_at
    loop
      v_pos := coalesce(v_pos, 0) + 1;
      insert into public.saas_invoice_lines
        (invoice_id, position, kind, description, quantity, unit_price_cents, vat_rate)
      values (v_inv_id, v_pos, 'credit',
              'Avoir commercial — ' || v_credit.reason, 1, -v_credit.amount_cents, v_regime.rate);

      update public.saas_account_credits
         set consumed_at = now(), consumed_invoice_id = v_inv_id
       where id = v_credit.id;
    end loop;

    select b.total_including_vat_cents into v_ttc
    from public.saas_invoice_balance b where b.invoice_id = v_inv_id;

    v_number := null;

    if p_issue and v_bloc is null then
      v_number := public.saas_issue_invoice(v_inv_id, v_reason);
      v_outcome := 'issued';
    elsif p_issue then
      v_outcome := 'blocked';
    end if;

    return query select v_sub.organization_id, v_sub.org_name, v_inv_id, v_number,
      v_outcome, v_ttc, v_bloc;
  end loop;
end;
$$;

comment on function public.saas_generate_invoices(text, date, date, text, boolean, uuid) is
  'Produit les factures d''abonnement d''une période. IDEMPOTENTE — la relancer sur la même période ne crée pas de doublon, '
  'et c''est un index unique partiel qui l''interdit, pas la politesse de la fonction. '
  'La relancer RECALCULE les brouillons (outcome « refreshed ») ; une facture ÉMISE ne bouge jamais (« alreadyBilled »). '
  '0089 : la garde accepte la MACHINE, un sixième paramètre facultatif restreint à UNE entreprise (chaque abonnement a '
  'sa date anniversaire), et une carte enregistrée fait basculer la facture en prélèvement exigible le jour même.';


-- ============================================================
-- 4. LA SOUSCRIPTION EN LIBRE-SERVICE
-- ============================================================
--
-- CE QUI N'EXISTAIT PAS. Mesuré : aucune ligne du dépôt n'écrivait
-- organization_subscriptions depuis le tunnel d'inscription. Le seul
-- chemin d'écriture était admin_create_subscription, appelée à la main
-- par un administrateur de plateforme, qui posait provider = 'manual'.
-- 0081 l'écrivait lui-même : « organization_subscriptions n'est écrite
-- par personne, et le statut trialing n'existe que dans la contrainte. »
--
-- CETTE FONCTION EST RÉSERVÉE À LA MACHINE, et ce n'est pas une
-- précaution de façade. Elle décide d'un prélèvement : elle doit tourner
-- CÔTÉ SERVEUR, avec la clé de service, jamais depuis un navigateur.
-- Le navigateur envoie une INTENTION — « je choisis l'offre Pro, au
-- mois, avec essai » — et le serveur va chercher le prix dans
-- organization_plans. AUCUN MONTANT NE TRAVERSE CETTE SIGNATURE, et
-- c'est délibéré : un prix qui vient du client n'est pas un prix, c'est
-- une proposition.
--
-- LA CARTE EST OBLIGATOIRE DANS LES DEUX CAS, essai compris. C'est la
-- décision du dirigeant, et elle a une raison : un essai sans carte se
-- termine par un client qui disparaît le trentième jour. La carte est
-- enregistrée CHEZ LE PRESTATAIRE ; cette base n'en voit que la date.
--
-- ------------------------------------------------------------
-- CETTE BASE NE RECALCULE PLUS UNE DATE DONT UN TIERS A DÉJÀ FAIT UN
-- PRÉLÈVEMENT. C'EST LA CORRECTION LA PLUS IMPORTANTE DU § 4.
-- ------------------------------------------------------------
--
-- La première version calculait elle-même la fin d'essai et l'ancre,
-- avec `extract(day from current_date)`. Trois faits mesurés rendaient
-- ce calcul faux :
--
--   1. CETTE BASE COMPTE EN UTC (`current_setting('TimeZone')` = UTC)
--      et l'écran compte à Paris. Entre minuit et 2 h du matin à Paris,
--      les deux ne sont pas le même jour.
--   2. C'EST LE PRESTATAIRE QUI DÉBITE, à la date envoyée à la création
--      de la session de paiement — donc à la date que l'écran a
--      annoncée au client, pas à celle que la base recalculerait après
--      coup.
--   3. UN CLIENT QUI LAISSE LA PAGE DE PAIEMENT OUVERTE et la termine
--      le lendemain ferait courir la base sur J+1 pendant que sa carte
--      est débitée à J.
--
-- L'écart n'est pas d'un jour une seule fois : il fixe une ANCRE
-- différente, donc décale TOUS les mois suivants. La facture tomberait
-- alors un autre jour que l'encaissement, et le rapprochement par
-- montant du webhook ne recollerait plus.
--
-- D'où les trois paramètres ajoutés, tous facultatifs et tous portant
-- une vérité qui vient d'AILLEURS :
--
--   • p_trial_ends_on       — le `trial_end` de l'abonnement chez le
--                             prestataire. Fait foi.
--   • p_billing_anchor_day  — le jour du mois annoncé au client.
--                             Fait foi, et il ne se déduit PAS de la
--                             fin d'essai : un essai ouvert le
--                             31 janvier finit le 28 février, et
--                             l'ancre reste 31 (§ 1).
--   • p_billable_extra_seats — LE NOMBRE DE SIÈGES RÉELLEMENT FACTURÉ
--                             par la caisse. Sans lui, le prestataire
--                             encaissait les sièges supplémentaires et
--                             la facture ne les portait pas : le client
--                             était débité de 83,52 € et recevait une
--                             facture de 47,88 €. Le rapprochement du
--                             webhook exige le montant EXACT — il ne
--                             trouvait rien.
--
-- Quand ils sont nuls, la fonction retombe sur son ancien calcul :
-- c'est le comportement d'un appel manuel, et il reste correct.
drop function if exists public.saas_start_subscription(
  uuid, text, text, boolean, text, text, text, boolean, text);

create or replace function public.saas_start_subscription(
  p_organization_id uuid,
  p_plan text,
  p_billing_cycle text,
  -- Vrai = un mois d'essai gratuit, carte enregistrée non débitée.
  -- Faux = paiement immédiat, facture émise et exigible le jour même.
  p_with_trial boolean,
  p_provider text,
  p_provider_mode text,
  p_provider_customer_id text,
  -- La carte est-elle enregistrée chez le prestataire ? La fonction
  -- REFUSE si elle ne l'est pas — voir plus haut.
  p_card_registered boolean,
  p_reason text default 'Souscription en ligne.',
  p_trial_ends_on date default null,
  p_billing_anchor_day smallint default null,
  p_billable_extra_seats integer default null
)
returns table (
  subscription_status text,
  trial_ends_on date,
  first_charge_on date,
  period_start date,
  period_end date,
  invoice_id uuid,
  invoice_number text,
  message text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org record;
  v_plan record;
  v_today date := current_date;
  v_anchor smallint;
  v_trial_end date;
  v_ps date;
  v_pe date;
  v_months integer;
  v_gen record;
  v_reason text;
  v_seats integer;
  v_seats_base integer;
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : la souscription se conclut côté serveur, avec la clé de service. Un navigateur envoie une intention, jamais un abonnement.'
      using errcode = '42501';
  end if;

  v_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Souscription en ligne.');

  if p_billing_cycle is null or p_billing_cycle not in ('monthly', 'yearly') then
    raise exception 'Cycle inconnu : %. Les deux cycles sont monthly et yearly.', coalesce(p_billing_cycle, '(vide)')
      using errcode = '23514';
  end if;

  select * into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org.id is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
  end if;

  select * into v_plan from public.organization_plans where key = p_plan;
  if v_plan.key is null then
    raise exception 'Offre inconnue : %.', coalesce(p_plan, '(vide)') using errcode = '23503';
  end if;
  -- Une offre sur devis ne se souscrit pas en libre-service. Le
  -- déclencheur de 0081 le refuserait de toute façon ; on le dit ici en
  -- français, parce que c'est un écran qui lira ce message.
  if v_plan.is_quote_only then
    raise exception 'L''offre « % » se négocie : elle ne se souscrit pas en ligne. Contactez-nous.', v_plan.name
      using errcode = '23514';
  end if;

  if exists (select 1 from public.organization_subscriptions s where s.organization_id = p_organization_id) then
    raise exception 'Cette entreprise a déjà un abonnement.' using errcode = '23505';
  end if;

  -- ---- LA CARTE, DANS LES DEUX CAS ------------------------------
  if not coalesce(p_card_registered, false) then
    raise exception 'Aucune carte n''est enregistrée : l''essai gratuit l''exige, et l''abonnement aussi. Rien ne sera prélevé pendant l''essai.'
      using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_provider_customer_id, '')), '') is null then
    raise exception 'Le client n''est pas identifié chez le prestataire de paiement : sans cette référence, aucun prélèvement ne pourrait être rapproché.'
      using errcode = '23514';
  end if;
  if p_provider_mode is null or p_provider_mode not in ('test', 'live') then
    raise exception 'Mode inconnu : %. Une correspondance d''essai employée en production encaisserait zéro.', coalesce(p_provider_mode, '(vide)')
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.billing_providers where key = p_provider) then
    raise exception 'Prestataire de paiement inconnu : %.', coalesce(p_provider, '(vide)') using errcode = '23503';
  end if;

  -- LE LIEN VERS LE CLIENT CHEZ LE PRESTATAIRE. La clé primaire de
  -- 0083 empêche d'en créer deux pour la même entreprise, et son
  -- unicité inverse empêche deux entreprises de pointer le même client.
  insert into public.billing_provider_customers
    (organization_id, provider, mode, provider_customer_id, note)
  values (p_organization_id, p_provider, p_provider_mode, btrim(p_provider_customer_id),
          'Créé par la souscription en ligne.')
  on conflict (organization_id, provider, mode) do nothing;

  v_months := case when p_billing_cycle = 'yearly' then 12 else 1 end;

  -- ---- LES SIÈGES SUPPLÉMENTAIRES, ET POURQUOI ILS VIENNENT DE
  --      LA CAISSE PLUTÔT QUE D'UN RECOMPTAGE -------------------
  --
  -- Le compte de référence est celui de source-supabase.ts :
  -- organization_members non archivés. Un siège est un COMPTE QUI SE
  -- CONNECTE, jamais le nombre de salariés déclaré au tableau de bord —
  -- facturer sur celui-là ferait payer quarante licences à un
  -- paysagiste qui a quarante salariés et trois comptes.
  --
  -- MAIS C'EST LE NOMBRE FACTURÉ PAR LA CAISSE QUI FAIT FOI quand il
  -- est fourni, et non ce recomptage. Raison : entre le moment où le
  -- client a vu son total et celui où il valide, un collègue a pu être
  -- invité. Refacturer sur le compte du jour ferait une facture qui ne
  -- correspond plus au montant débité, et le rapprochement du webhook
  -- se fait au montant EXACT.
  --
  -- Quand les deux diffèrent, on facture ce qui a été encaissé ET on
  -- l'écrit au journal : un écart silencieux est un écart qui dure.
  select greatest(0, count(*)::integer - coalesce(pl.included_seats, count(*)::integer))
    into v_seats_base
  from public.organization_members m
  cross join (select included_seats from public.organization_plans where key = p_plan) pl
  where m.organization_id = p_organization_id and m.archived_at is null
  group by pl.included_seats;

  v_seats := greatest(0, coalesce(p_billable_extra_seats, v_seats_base, 0));

  if p_billable_extra_seats is not null
     and v_seats_base is not null
     and p_billable_extra_seats <> v_seats_base then
    insert into public.saas_machine_events
      (kind, organization_id, target_type, target_id, label, details)
    values ('subscription.seatMismatch', p_organization_id, 'organization',
            p_organization_id, v_org.name,
            jsonb_build_object('factureParLaCaisse', p_billable_extra_seats,
                               'comptesEnBase', v_seats_base,
                               'retenu', v_seats,
                               'pourquoi', 'On facture ce qui a été encaissé. L''écart se règle à l''échéance suivante.'));
  end if;

  if coalesce(p_with_trial, false) then
    -- ---- L'ESSAI : UN MOIS, RIEN N'EST DÉBITÉ ------------------
    --
    -- L'ANCRE VIENT DE L'ÉCRAN QUAND IL LA DONNE. Elle ne se déduit pas
    -- de la fin d'essai : un essai ouvert le 31 janvier finit le
    -- 28 février, et l'ancre doit rester 31 pour que l'abonné repasse
    -- au 31 dès mars (§ 1). Déduire 28 de la fin d'essai le prélèverait
    -- le 28 pour le restant de sa vie.
    v_anchor := coalesce(
      nullif(p_billing_anchor_day, 0),
      extract(day from coalesce(p_trial_ends_on, v_today))::smallint);
    if v_anchor < 1 or v_anchor > 31 then
      raise exception 'Jour d''ancrage impossible : %.', v_anchor using errcode = '23514';
    end if;

    v_trial_end := coalesce(p_trial_ends_on,
                            public.saas_date_anniversaire(v_today, 1, v_anchor));

    -- DEUX BORNES SUR UNE DATE QUI VIENT DU DEHORS. Un essai qui finit
    -- hier n'est pas un essai ; un essai qui finit dans un an est une
    -- faute de frappe qui offrirait douze mois de service. Le prestataire
    -- peut aussi répondre la veille ou le lendemain selon son fuseau :
    -- deux jours de battement l'absorbent sans rien offrir.
    if v_trial_end <= v_today then
      raise exception 'La fin d''essai annoncée (%) n''est pas dans le futur : ce n''est pas un essai.',
        to_char(v_trial_end, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if v_trial_end > v_today + 62 then
      raise exception 'La fin d''essai annoncée (%) dépasse deux mois : refusée. Un essai d''un an ne se décide pas par un paramètre.',
        to_char(v_trial_end, 'DD/MM/YYYY') using errcode = '23514';
    end if;

    insert into public.organization_subscriptions
      (organization_id, plan, provider, status, started_at, billing_cycle, currency,
       trial_started_at, trial_ends_at, billing_anchor_day, billable_extra_seats,
       payment_method_registered_at, external_reference, note)
    values (p_organization_id, p_plan, 'web', 'trialing', now(), p_billing_cycle, 'EUR',
            now(), v_trial_end::timestamptz, v_anchor, v_seats,
            now(), btrim(p_provider_customer_id), v_reason);

    insert into public.saas_machine_events (kind, organization_id, target_type, target_id, label, details)
    values ('subscription.trialStarted', p_organization_id, 'organization', p_organization_id, v_org.name,
            jsonb_build_object('plan', p_plan, 'cycle', p_billing_cycle,
                               'finEssai', v_trial_end, 'ancre', v_anchor,
                               'siegesFactures', v_seats, 'carteEnregistree', true));

    -- La validation du numéro de TVA part EN PARALLÈLE : elle
    -- n'empêche pas l'inscription de se terminer. Voir le § 7.
    perform public.saas_vies_enqueue(p_organization_id);

    return query select
      'trialing'::text, v_trial_end, v_trial_end, null::date, null::date, null::uuid, null::text,
      ('Votre essai gratuit court jusqu''au ' || to_char(v_trial_end, 'DD/MM/YYYY')
       || '. Rien ne sera prélevé avant cette date, et vous pouvez arrêter à tout moment.')::text;
    return;
  end if;

  -- ---- SANS ESSAI : ON FACTURE ET ON PRÉLÈVE LE JOUR MÊME ------
  v_anchor := coalesce(nullif(p_billing_anchor_day, 0), extract(day from v_today)::smallint);
  if v_anchor < 1 or v_anchor > 31 then
    raise exception 'Jour d''ancrage impossible : %.', v_anchor using errcode = '23514';
  end if;

  v_ps := v_today;
  v_pe := public.saas_date_anniversaire(v_ps, v_months, v_anchor);

  -- LA PREMIÈRE PÉRIODE NE PEUT PAS ÊTRE UN CROUPION. Quand l'écran
  -- compte déjà demain à Paris et que la base compte encore aujourd'hui
  -- en UTC, l'ancre reçue (le 1er) tombe le lendemain de la période
  -- ouverte (le 31) : on facturerait un mois plein pour UN JOUR. Un
  -- mois de plus quand l'écart est manifeste, et le client a bien la
  -- durée qu'il a payée.
  if v_pe - v_ps < 27 then
    v_pe := public.saas_date_anniversaire(v_ps, v_months + 1, v_anchor);
  end if;

  insert into public.organization_subscriptions
    (organization_id, plan, provider, status, started_at, billing_cycle, currency,
     billing_anchor_day, current_period_start_on, current_period_end_on, billable_extra_seats,
     last_billed_period_start, payment_method_registered_at, external_reference, note)
  values (p_organization_id, p_plan, 'web', 'active', now(), p_billing_cycle, 'EUR',
          v_anchor, v_ps, v_pe, v_seats, v_ps, now(), btrim(p_provider_customer_id), v_reason);

  -- LA FACTURE PRÉCÈDE L'ENCAISSEMENT. Émise aujourd'hui, exigible
  -- aujourd'hui : c'est ce qui permet au webhook de la retrouver quand
  -- le prélèvement arrivera, dans les secondes qui suivent.
  select * into v_gen
  from public.saas_generate_invoices(p_billing_cycle, v_ps, v_pe, v_reason, true, p_organization_id);

  insert into public.saas_machine_events (kind, organization_id, target_type, target_id, label, details)
  values ('subscription.started', p_organization_id, 'organization', p_organization_id, v_org.name,
          jsonb_build_object('plan', p_plan, 'cycle', p_billing_cycle,
                             'periode', jsonb_build_array(v_ps, v_pe), 'ancre', v_anchor,
                             'siegesFactures', v_seats,
                             'facture', v_gen.invoice_number, 'issue', v_gen.outcome));

  perform public.saas_vies_enqueue(p_organization_id);

  return query select
    'active'::text, null::date, v_ps, v_ps, v_pe, v_gen.invoice_id, v_gen.invoice_number,
    case
      when v_gen.outcome = 'issued' then
        ('Votre abonnement est actif. La facture ' || coalesce(v_gen.invoice_number, '')
         || ' est émise, et le prélèvement suit aujourd''hui.')
      else
        ('Votre abonnement est actif. La facture n''a pas encore pu être émise : '
         || coalesce(v_gen.blocking_reason, 'motif non enregistré')
         || ' Nous la régularisons et revenons vers vous.')
    end::text;
end;
$$;

comment on function public.saas_start_subscription(uuid, text, text, boolean, text, text, text, boolean, text, date, smallint, integer) is
  'La souscription en libre-service, RÉSERVÉE À LA MACHINE (clé de service, côté serveur). '
  'Aucun montant ne traverse sa signature : le prix vient de organization_plans. '
  'La carte est obligatoire dans les deux cas — essai compris — et n''est jamais débitée pendant l''essai. '
  'La fin d''essai, l''ancre et le nombre de sièges facturés VIENNENT DU PRESTATAIRE quand il les donne : '
  'cette base ne recalcule pas une date dont un tiers a déjà fait un prélèvement.';


-- ============================================================
-- 5. L'ÉCHÉANCE — CE QUE LA TÂCHE PLANIFIÉE FAIT CHAQUE NUIT
-- ============================================================
--
-- CE QUI MANQUAIT, MESURÉ : trial_ends_at apparaissait six fois dans
-- les 88 migrations, et une seule occurrence la comparait à now() —
-- admin_extend_trial, qui l'ALLONGE. Aucune fonction, aucun
-- déclencheur, aucune tâche ne faisait passer trialing → active. Un
-- abonnement laissé en essai y restait pour toujours.
--
-- LA TÂCHE CALCULE ET ÉCRIT EN BASE. ELLE N'APPELLE PERSONNE — pas de
-- requête HTTP, pas de prestataire, pas de courriel. Deux raisons :
-- une tâche qui échoue au milieu d'un appel réseau laisse un état
-- indéterminé, alors qu'une transaction est atomique ; et l'idempotence
-- est portée par l'index unique partiel de saas_invoices, pas par un
-- « si déjà fait » que deux exécutions simultanées franchiraient
-- toutes les deux.
--
-- ELLE N'AVANCE QUE D'UNE PÉRIODE PAR PASSAGE. Une base restée trois
-- mois sans ordonnanceur ne se réveille donc pas en émettant trois
-- factures d'un coup à chaque client : elle rattrape un mois par nuit,
-- ce qui laisse à un humain le temps de voir passer la première.
--
-- ELLE NE TOUCHE PAS AUX ABONNEMENTS SANS ANCRE. admin_create_subscription
-- pose des lignes sans billing_anchor_day ni période : ce sont des
-- abonnements gérés à la main, et les faire entrer d'office dans le
-- cycle automatique enverrait des factures que personne n'a décidées.
create or replace function public.saas_run_billing_cycle(
  p_today date default current_date
)
returns table (
  organization_id uuid,
  organization_name text,
  action text,
  period_start date,
  period_end date,
  invoice_id uuid,
  invoice_number text,
  outcome text,
  blocking_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_anchor smallint;
  v_months integer;
  v_ps date;
  v_pe date;
  v_gen record;
  v_run uuid;
  v_examines integer := 0;
  v_produits integer := 0;
  v_bloques integer := 0;
  -- LES ABONNEMENTS DÉJÀ TRAITÉS PAR LE § 5.a. Voir le § 5.b : sans
  -- cette liste, un même passage avançait DEUX périodes.
  v_vus uuid[] := array[]::uuid[];
  v_blocage text;
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : le cycle de facturation est un traitement de la machine.'
      using errcode = '42501';
  end if;

  -- ------------------------------------------------------------
  -- ON NE FACTURE PAS UN JOUR QUI N'EST PAS ARRIVÉ
  -- ------------------------------------------------------------
  -- p_today n'était borné nulle part. Un seul appel avec une date
  -- future émettait de VRAIES factures, numérotées dans la séquence
  -- légale, pour des périodes non commencées — et exigibles le jour
  -- même, puisque la machine pose payment_terms_days = 0. Le geste est
  -- irréversible : le compteur séquentiel est consommé sans trou, une
  -- facture émise ne se modifie plus, et elle ne se corrige que par un
  -- avoir.
  --
  -- Le rattrapage VERS LE PASSÉ reste permis : c'est le travail normal
  -- de cette fonction après une nuit manquée.
  if p_today > current_date then
    raise exception 'Le cycle ne facture pas un jour qui n''est pas arrivé : %. Une facture émise ne se reprend pas, elle s''annule par un avoir.',
      to_char(p_today, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  -- ------------------------------------------------------------
  -- UN SEUL PASSAGE À LA FOIS
  -- ------------------------------------------------------------
  -- Ce qui protégeait jusqu'ici était INCIDENT et non conçu : l'`update`
  -- de l'abonnement précède la facture, donc le verrou de ligne
  -- sérialisait deux passages visant la même entreprise. Cette
  -- protection ne couvrait PAS deux passages portant un `p_today`
  -- différent — le cas concret étant la tâche de 03h15 croisant un
  -- appel manuel depuis l'éditeur SQL, qui tourne sous le même rôle et
  -- franchit donc saas_contexte_machine().
  --
  -- Le verrou tombe tout seul à la fin de la transaction. Il ne coûte
  -- rien, et il transforme une garantie de circonstance en garantie
  -- écrite.
  perform pg_advisory_xact_lock(hashtext('oasis.cycle_facturation'));

  insert into public.saas_machine_events (kind, details)
  values ('billingCycle.started', jsonb_build_object('jour', p_today))
  returning id into v_run;

  -- ------------------------------------------------------------
  -- 5.a LES ESSAIS ARRIVÉS À TERME
  -- ------------------------------------------------------------
  -- L'essai finit, le premier prélèvement tombe, et la période payée
  -- commence CE JOUR-LÀ. C'est la lecture retenue en tête de fichier.
  for v_sub in
    select s.*, o.name as org_name
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.status = 'trialing'
      and s.trial_ends_at is not null
      and s.trial_ends_at::date <= p_today
      and s.cancelled_at is null
    order by o.name
  loop
    v_examines := v_examines + 1;
    v_vus := v_vus || v_sub.organization_id;

    -- ---- L'ESSAI RÉSILIÉ À SON TERME --------------------------
    -- CE CAS N'ÉTAIT RAMASSÉ PAR PERSONNE : le § 5.a excluait
    -- cancel_at_period_end et le § 5.b ne regarde que 'active' et
    -- 'pastDue'. Un essai résilié restait donc en « trialing » POUR
    -- TOUJOURS — le client gardait ses droits indéfiniment, sans
    -- qu'aucun prélèvement ne parte et sans qu'aucun écran ne signale
    -- l'anomalie. Mesuré sur trois passages jusqu'à J+400.
    --
    -- Il n'y a rien à facturer : l'essai n'a jamais été payé, et
    -- l'engagement n'a pas commencé (voir l'en-tête). On clôt, et c'est
    -- tout.
    if v_sub.cancel_at_period_end then
      update public.organization_subscriptions
         set status = 'cancelled', cancelled_at = now(), updated_at = now()
       where organization_subscriptions.organization_id = v_sub.organization_id;

      insert into public.saas_machine_events
        (kind, organization_id, target_type, target_id, label, details)
      values ('subscription.trialCancelled', v_sub.organization_id, 'organization',
              v_sub.organization_id, v_sub.org_name,
              jsonb_build_object('finEssai', v_sub.trial_ends_at::date,
                                 'facture', 'aucune : un essai résilié ne se facture pas'));

      return query select v_sub.organization_id, v_sub.org_name, 'trialCancelled'::text,
        null::date, v_sub.trial_ends_at::date, null::uuid, null::text, 'cancelled'::text, null::text;
      continue;
    end if;

    v_months := case when v_sub.billing_cycle = 'yearly' then 12 else 1 end;
    v_ps := v_sub.trial_ends_at::date;
    v_anchor := coalesce(v_sub.billing_anchor_day, extract(day from v_ps)::smallint);
    v_pe := public.saas_date_anniversaire(v_ps, v_months, v_anchor);

    -- UN CLIENT QUI ÉCHOUE N'ARRÊTE PAS LA NUIT DE TOUT LE PARC.
    --
    -- saas_issue_invoice LÈVE — et elle a raison de lever — quand le
    -- client n'a pas de SIRET, quand l'émetteur est incomplet, quand le
    -- régime de TVA est inconnu. Sans ce bloc, la PREMIÈRE entreprise
    -- mal renseignée ferait tomber la transaction entière et personne
    -- ne serait facturé cette nuit-là. Le pire est qu'on ne le verrait
    -- pas : la tâche planifiée échoue en silence.
    --
    -- Le bloc est une SOUS-TRANSACTION : le changement de statut et la
    -- facture réussissent ou échouent ENSEMBLE. Un abonnement dont la
    -- facture n'a pas pu être émise reste donc en essai, et sera
    -- retenté demain — plutôt que de basculer en « actif » sans que
    -- rien n'ait été facturé, ce qui donnerait un mois gratuit à
    -- l'insu de tout le monde.
    --
    -- ------------------------------------------------------------
    -- ET « BLOQUÉE » COMPTE COMME UN ÉCHEC. C'ÉTAIT LE TROU.
    -- ------------------------------------------------------------
    -- La promesse ci-dessus n'était tenue que pour les EXCEPTIONS. Or
    -- saas_generate_invoices ne lève pas quand une ligne porte un motif
    -- de blocage : elle rend outcome = 'blocked' et un brouillon. Rien
    -- n'était donc annulé, l'abonnement basculait en « active », et le
    -- brouillon n'était JAMAIS retenté — même une fois l'obstacle levé,
    -- puisque le § 5.b ne regarde plus que les fins de PÉRIODE.
    --
    -- Mesuré sur le cas nominal que tout le § 7 existe pour traiter —
    -- un client allemand dont le registre VIES est indisponible le jour
    -- de la fin d'essai : « 15/03 draft | 15/04 issued | 15/05 issued ».
    -- Un mois de service livré, jamais facturé, jamais encaissé, et
    -- personne pour s'en apercevoir.
    --
    -- On force donc le retour en arrière par une exception. Le motif
    -- survit dans v_blocage : les variables PL/pgSQL ne sont pas
    -- annulées par le bloc d'exception, seules les écritures le sont.
    v_blocage := null;
    begin
      update public.organization_subscriptions
         set status = 'active',
             billing_anchor_day = v_anchor,
             current_period_start_on = v_ps,
             current_period_end_on = v_pe,
             last_billed_period_start = v_ps,
             updated_at = now()
       where organization_subscriptions.organization_id = v_sub.organization_id;

      select * into v_gen
      from public.saas_generate_invoices(
        v_sub.billing_cycle, v_ps, v_pe,
        'Fin d''essai : première échéance.', true, v_sub.organization_id);

      if v_gen.outcome is distinct from 'issued' then
        v_blocage := coalesce(v_gen.blocking_reason,
                              'La facture n''a pas pu être émise (' || coalesce(v_gen.outcome, 'sans issue') || ').');
        raise exception using errcode = '23514', message = v_blocage;
      end if;
    exception when others then
      v_bloques := v_bloques + 1;
      insert into public.saas_machine_events
        (kind, organization_id, target_type, target_id, label, details)
      values ('subscription.trialEndFailed', v_sub.organization_id, 'organization',
              v_sub.organization_id, v_sub.org_name,
              jsonb_build_object('periode', jsonb_build_array(v_ps, v_pe),
                                 'erreur', sqlerrm, 'code', sqlstate,
                                 'bloquee', v_blocage is not null,
                                 'suite', 'L''abonnement RESTE EN ESSAI et sera retenté au prochain passage. Rien n''a été facturé, et sa période n''a pas avancé.'));
      return query select v_sub.organization_id, v_sub.org_name, 'trialEnded'::text,
        v_ps, v_pe, null::uuid, null::text,
        case when v_blocage is not null then 'blocked' else 'failed' end::text,
        coalesce(v_blocage, sqlerrm);
      continue;
    end;

    -- On n'arrive ici QUE si la facture est émise : tout le reste est
    -- reparti par le `continue` du bloc d'exception ci-dessus.
    v_produits := v_produits + 1;

    insert into public.saas_machine_events
      (kind, organization_id, target_type, target_id, label, details)
    values ('subscription.trialEnded', v_sub.organization_id, 'organization',
            v_sub.organization_id, v_sub.org_name,
            jsonb_build_object('periode', jsonb_build_array(v_ps, v_pe),
                               'facture', v_gen.invoice_number,
                               'issue', v_gen.outcome,
                               'blocage', v_gen.blocking_reason));

    return query select v_sub.organization_id, v_sub.org_name, 'trialEnded'::text,
      v_ps, v_pe, v_gen.invoice_id, v_gen.invoice_number, v_gen.outcome, v_gen.blocking_reason;
  end loop;

  -- ------------------------------------------------------------
  -- 5.b LES PÉRIODES ARRIVÉES À TERME
  -- ------------------------------------------------------------
  for v_sub in
    select s.*, o.name as org_name
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.status in ('active', 'pastDue')
      and s.current_period_end_on is not null
      and s.current_period_end_on <= p_today
      and s.cancelled_at is null
      and s.billing_anchor_day is not null
      -- UNE SEULE PÉRIODE PAR PASSAGE, ET C'EST ICI QUE ÇA SE JOUE.
      --
      -- Cette boucle relit organization_subscriptions APRÈS que le
      -- § 5.a y a écrit. Un abonnement dont l'essai était échu depuis
      -- longtemps ressortait donc immédiatement ici, et le MÊME passage
      -- émettait DEUX factures — deux prélèvements exigibles le même
      -- jour, puisque la machine pose payment_terms_days = 0. Mesuré :
      -- un essai fini le 28/02 et un premier passage le 15/06 rendaient
      -- « 2026-02-28→03-31 » ET « 2026-03-31→04-30 ».
      --
      -- Le fichier promettait pourtant « un mois par nuit, ce qui
      -- laisse à un humain le temps de voir passer la première ». La
      -- promesse est maintenant tenue.
      and not (s.organization_id = any (v_vus))
    order by o.name
  loop
    v_examines := v_examines + 1;

    -- ---- L'ABONNEMENT QUI S'ARRÊTE À L'ÉCHÉANCE ---------------
    -- LE DÉCLENCHEUR DE 0081 PEUT REFUSER CETTE RÉSILIATION : il la
    -- bloque tant qu'une remise engage l'abonnement au-delà de la
    -- période. En principe le cas ne se présente pas — poser
    -- cancel_at_period_end sous engagement est déjà refusé — mais si
    -- une remise a été prolongée entre-temps, le refus tomberait ici,
    -- la nuit, et ferait échouer TOUTE la tâche. On l'attrape.
    if v_sub.cancel_at_period_end then
      begin
        update public.organization_subscriptions
           set status = 'cancelled', cancelled_at = now(), updated_at = now()
         where organization_subscriptions.organization_id = v_sub.organization_id;
      exception when others then
        insert into public.saas_machine_events
          (kind, organization_id, target_type, target_id, label, details)
        values ('subscription.cancelBlocked', v_sub.organization_id, 'organization',
                v_sub.organization_id, v_sub.org_name,
                jsonb_build_object('erreur', sqlerrm, 'code', sqlstate));
        return query select v_sub.organization_id, v_sub.org_name, 'cancelled'::text,
          v_sub.current_period_start_on, v_sub.current_period_end_on,
          null::uuid, null::text, 'failed'::text, sqlerrm;
        continue;
      end;

      insert into public.saas_machine_events
        (kind, organization_id, target_type, target_id, label, details)
      values ('subscription.cancelledAtPeriodEnd', v_sub.organization_id, 'organization',
              v_sub.organization_id, v_sub.org_name,
              jsonb_build_object('finDePeriode', v_sub.current_period_end_on));

      return query select v_sub.organization_id, v_sub.org_name, 'cancelled'::text,
        v_sub.current_period_start_on, v_sub.current_period_end_on,
        null::uuid, null::text, 'cancelled'::text, null::text;
      continue;
    end if;

    v_months := case when v_sub.billing_cycle = 'yearly' then 12 else 1 end;
    v_ps := v_sub.current_period_end_on;
    v_anchor := v_sub.billing_anchor_day;
    v_pe := public.saas_date_anniversaire(v_ps, v_months, v_anchor);

    -- Même sous-transaction qu'au § 5.a, et pour la même raison : une
    -- entreprise dont la facture ne peut pas être émise ne doit pas
    -- avancer d'une période — sans quoi son mois serait sauté sans
    -- jamais être facturé — et ne doit pas non plus arrêter la nuit
    -- des autres.
    --
    -- ET « BLOQUÉE » COMPTE ICI AUSSI COMME UN ÉCHEC, exactement pour
    -- la raison écrite au § 5.a : sans cela, la période avançait
    -- pendant que la facture restait un brouillon, et le mois écoulé
    -- n'était jamais rattrapé.
    v_blocage := null;
    begin
      update public.organization_subscriptions
         set current_period_start_on = v_ps,
             current_period_end_on = v_pe,
             last_billed_period_start = v_ps,
             updated_at = now()
       where organization_subscriptions.organization_id = v_sub.organization_id;

      select * into v_gen
      from public.saas_generate_invoices(
        v_sub.billing_cycle, v_ps, v_pe, 'Échéance mensuelle.', true, v_sub.organization_id);

      if v_gen.outcome is distinct from 'issued' then
        v_blocage := coalesce(v_gen.blocking_reason,
                              'La facture n''a pas pu être émise (' || coalesce(v_gen.outcome, 'sans issue') || ').');
        raise exception using errcode = '23514', message = v_blocage;
      end if;
    exception when others then
      v_bloques := v_bloques + 1;
      insert into public.saas_machine_events
        (kind, organization_id, target_type, target_id, label, details)
      values ('subscription.renewalFailed', v_sub.organization_id, 'organization',
              v_sub.organization_id, v_sub.org_name,
              jsonb_build_object('periode', jsonb_build_array(v_ps, v_pe),
                                 'erreur', sqlerrm, 'code', sqlstate,
                                 'bloquee', v_blocage is not null,
                                 'suite', 'La période N''A PAS AVANCÉ : nouvel essai au prochain passage.'));
      return query select v_sub.organization_id, v_sub.org_name, 'renewed'::text,
        v_ps, v_pe, null::uuid, null::text,
        case when v_blocage is not null then 'blocked' else 'failed' end::text,
        coalesce(v_blocage, sqlerrm);
      continue;
    end;

    v_produits := v_produits + 1;

    insert into public.saas_machine_events
      (kind, organization_id, target_type, target_id, label, details)
    values ('subscription.renewed', v_sub.organization_id, 'organization',
            v_sub.organization_id, v_sub.org_name,
            jsonb_build_object('periode', jsonb_build_array(v_ps, v_pe),
                               'facture', v_gen.invoice_number,
                               'issue', v_gen.outcome,
                               'blocage', v_gen.blocking_reason));

    return query select v_sub.organization_id, v_sub.org_name, 'renewed'::text,
      v_ps, v_pe, v_gen.invoice_id, v_gen.invoice_number, v_gen.outcome, v_gen.blocking_reason;
  end loop;

  insert into public.saas_machine_events (kind, details)
  values ('billingCycle.finished',
          jsonb_build_object('jour', p_today, 'examines', v_examines,
                             'facturesEmises', v_produits, 'bloques', v_bloques,
                             'debut', v_run));
end;
$$;

comment on function public.saas_run_billing_cycle(date) is
  'La tâche d''échéance : elle constate les fins d''essai et les fins de période, avance UNE période par '
  'passage, et produit la facture À ÉCHOIR. Elle n''appelle personne — aucune requête sortante — et son '
  'idempotence est celle de l''index unique partiel de saas_invoices, pas un « si déjà fait ». '
  'Elle REFUSE une date future, prend un verrou d''avis, et n''avance ni statut ni période quand la '
  'facture n''est pas émise — « bloquée » compte comme un échec.';


-- ------------------------------------------------------------
-- 5.c LA VEILLE — S'APERCEVOIR QU'UNE NUIT N'A PAS TOURNÉ
-- ------------------------------------------------------------
--
-- LE PROBLÈME, ET IL EST SOURNOIS. saas_run_billing_cycle écrit
-- « billingCycle.started » en entrant et « billingCycle.finished » en
-- sortant, mais les deux vivent dans LA MÊME TRANSACTION que le
-- travail. Une nuit qui échoue — délai d'exécution dépassé, verrou,
-- panne — n'annule pas seulement la facturation : elle annule aussi sa
-- propre trace. Il ne reste RIEN, et personne ne constate l'absence.
--
-- Rien dans le dépôt ne lit cron.job_run_details, et aucune fonction
-- ne cherchait une nuit manquante. Un arrêt de trois jours était donc
-- invisible à l'aller.
--
-- LA RÉPONSE : DEUX TÂCHES QUI SE SURVEILLENT L'UNE L'AUTRE. La tâche
-- des relances appelle cette fonction ; si la facturation n'a pas
-- abouti depuis plus de 36 heures, un événement « billingCycle.missing »
-- est écrit — et lui SURVIT, parce qu'il est écrit par une autre
-- transaction que celle qui a échoué. Trente-six heures et non
-- vingt-quatre : une nuit sautée peut être un redémarrage, deux nuits
-- sautées ne le sont plus.
--
-- La fonction est LISIBLE PAR UN ADMINISTRATEUR pour que l'écran
-- puisse afficher l'alerte, et elle n'écrit que lorsque la machine
-- l'appelle : une consultation ne doit pas fabriquer d'événement.
create or replace function public.saas_ordonnanceur_sante()
returns table (
  derniere_execution timestamptz,
  heures_depuis numeric,
  en_retard boolean,
  message text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dernier timestamptz;
  v_heures numeric;
  v_retard boolean;
begin
  if not (public.saas_contexte_machine() or public.platform_admin_can('billing.invoices.read')) then
    raise exception 'Accès refusé : l''état de l''ordonnanceur est une information d''administration.'
      using errcode = '42501';
  end if;

  select max(e.occurred_at) into v_dernier
  from public.saas_machine_events e
  where e.kind = 'billingCycle.finished';

  v_heures := case when v_dernier is null then null
                   else round(extract(epoch from (now() - v_dernier)) / 3600.0, 1) end;
  v_retard := v_dernier is null or v_dernier < now() - interval '36 hours';

  -- ON N'ÉCRIT L'ALERTE QUE DEPUIS LA MACHINE, et une seule fois par
  -- tranche de six heures : une alerte répétée toutes les minutes est
  -- une alerte qu'on finit par ne plus lire.
  if v_retard and public.saas_contexte_machine()
     and not exists (
       select 1 from public.saas_machine_events e
       where e.kind = 'billingCycle.missing'
         and e.occurred_at > now() - interval '6 hours') then
    insert into public.saas_machine_events (kind, details)
    values ('billingCycle.missing',
            jsonb_build_object('dernierSucces', v_dernier, 'heuresDepuis', v_heures,
                               'quoiFaire', 'La facturation ne tourne plus. Voir docs/ordonnanceur-facturation.md.'));
  end if;

  return query select v_dernier, v_heures, v_retard,
    case
      when v_dernier is null then
        'La facturation n''a JAMAIS abouti depuis la mise en service. Si la migration vient d''être posée, c''est normal : la première nuit n''a pas encore eu lieu. Sinon, la tâche planifiée ne tourne pas.'
      when v_retard then
        'La facturation n''a pas abouti depuis ' || v_heures || ' heures. Des factures ne partent plus, et des essais restent ouverts. Voir la notice de mise en service.'
      else
        'La facturation a abouti il y a ' || v_heures || ' heures. Tout est normal.'
    end::text;
end;
$$;

comment on function public.saas_ordonnanceur_sante() is
  'Constate qu''une nuit de facturation a MANQUÉ. Les traces de début et de fin vivent dans la '
  'transaction du travail : une nuit qui échoue efface sa propre trace. Cette fonction est appelée '
  'par l''AUTRE tâche planifiée — les deux se surveillent l''une l''autre — et son alerte survit donc '
  'à l''échec qu''elle signale.';


-- ============================================================
-- 6. L'ENGAGEMENT NE COMMENCE PAS PENDANT L'ESSAI
-- ============================================================
--
-- LA RÈGLE, ET SON POURQUOI, SONT ÉCRITS EN TÊTE DE FICHIER. Ce
-- paragraphe la rend non contournable.
--
-- admin_apply_discount accepte aujourd'hui N'IMPORTE QUELLE date de
-- début, sans la relier à l'essai. Rien n'empêchait donc de poser la
-- remise FONDATEUR le jour de la souscription — ce qui ferait payer
-- onze mois à 49,90 € au lieu de douze, en silence.
--
-- UN DÉCLENCHEUR PLUTÔT QU'UN CONTRÔLE DANS LA FONCTION : toutes les
-- fonctions de 0081 sont `security definer`, donc un contrôle écrit
-- dans l'une d'elles serait contourné par tout autre chemin —
-- l'éditeur SQL, la clé de service, le tunnel de demain. C'est le même
-- raisonnement que 0081 § 5.b, et il vaut ici aussi.
create or replace function public.saas_engagement_start_on(p_organization_id uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- LA DATE À LAQUELLE UNE REMISE QUI ENGAGE DOIT COMMENCER : la fin
  -- de l'essai tant que l'abonnement est en essai, aujourd'hui sinon.
  -- Un tunnel qui la lit ne peut pas se tromper de date.
  --
  -- LE TEST « ET QU'IL COURT ENCORE » A ÉTÉ RETIRÉ, ET C'EST UNE
  -- CORRECTION. Il faisait diverger cette fonction du déclencheur
  -- ci-dessous, qui exige `trial_ends_at::date` SANS condition de
  -- temps. Dès que l'essai était échu sans que la tâche de nuit soit
  -- passée — un cas courant, il suffit d'une nuit sautée — la fonction
  -- annonçait « aujourd'hui » et le déclencheur refusait cette
  -- date-là : une remise posée sur la date que la base venait
  -- elle-même de rendre était REJETÉE. Mesuré.
  --
  -- UNE SEULE RÈGLE, ÉCRITE UNE FOIS : tant que le statut est
  -- « trialing », c'est la fin d'essai. Le déclencheur appelle
  -- désormais cette fonction plutôt que de refaire le calcul.
  select case
    when s.status = 'trialing' and s.trial_ends_at is not null
      then s.trial_ends_at::date
    else current_date
  end
  from public.organization_subscriptions s
  where s.organization_id = p_organization_id;
$$;

comment on function public.saas_engagement_start_on(uuid) is
  'La date à laquelle une remise qui ENGAGE doit démarrer : la fin de l''essai, ou aujourd''hui. '
  'L''essai ne compte pas dans l''engagement — voir l''en-tête de 0089.';

create or replace function public.subscription_discounts_trial_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_attendu date;
begin
  -- Une remise SANS engagement ne pose pas la question : elle n'enferme
  -- personne, et la faire courir pendant l'essai est même généreux.
  if new.commitment_ends_on is null or new.cancelled_at is not null then
    return new;
  end if;

  select * into v_sub from public.organization_subscriptions s
   where s.organization_id = new.organization_id;

  if v_sub.organization_id is null then
    return new;
  end if;

  -- L'abonnement n'est pas en essai : la remise démarre quand elle veut,
  -- et admin_apply_discount pose déjà current_date par défaut.
  if v_sub.status <> 'trialing' or v_sub.trial_ends_at is null then
    return new;
  end if;

  -- LA MÊME EXPRESSION QUE saas_engagement_start_on, ET PAR LE MÊME
  -- CHEMIN. Deux calculs qui disent la même chose finissent toujours
  -- par se contredire ; celui-ci s'était déjà contredit.
  v_attendu := public.saas_engagement_start_on(new.organization_id);

  if new.starts_on is distinct from v_attendu then
    raise exception 'Cette remise engage sur plusieurs mois, et l''abonnement est en essai jusqu''au %. Elle doit démarrer CE JOUR-LÀ, pas le %. L''essai ne compte pas dans l''engagement : on n''enferme pas quelqu''un sur une période où il ne paie rien et peut partir. Sans cette règle, l''abonné paierait onze mois au tarif promis au lieu de douze, et le douzième basculerait au tarif public sans que personne l''ait annoncé.',
      to_char(v_attendu, 'DD/MM/YYYY'), to_char(new.starts_on, 'DD/MM/YYYY')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists subscription_discounts_trial_guard on public.subscription_discounts;
create trigger subscription_discounts_trial_guard
  before insert or update on public.subscription_discounts
  for each row execute function public.subscription_discounts_trial_guard();

revoke all on function public.subscription_discounts_trial_guard() from public;
revoke all on function public.subscription_discounts_trial_guard() from anon;
revoke all on function public.subscription_discounts_trial_guard() from authenticated;


-- ============================================================
-- 7. LA VALIDATION DE TVA — TROIS ÉTATS, ET UNE FILE DE RÉESSAI
-- ============================================================
--
-- CE QUI EXISTAIT : saas_customer_tax_profiles portait
-- vat_number_validated_at et validation_source, et
-- saas_vat_regime_compute ne lisait QU'UNE colonne — validated_at, en
-- test « is not null ». Il n'y avait donc que DEUX états observables :
-- validé, ou pas. « Refusé » et « indisponible » étaient confondus avec
-- « jamais essayé », et le message d'erreur disait « non validé » dans
-- les trois cas. Un administrateur qui le lisait ne savait pas s'il
-- devait appeler le client ou attendre.
alter table public.saas_customer_tax_profiles
  -- LES TROIS ÉTATS. Plus le NULL, qui vaut « jamais interrogé » et qui
  -- est le quatrième — il existait déjà de fait.
  add column if not exists vies_status text,
  -- La date du DERNIER essai, réussi ou non. Sans elle, « registre
  -- indisponible » ne dit pas depuis quand.
  add column if not exists vies_last_attempt_at timestamptz,
  add column if not exists vies_attempts integer not null default 0,
  -- QUAND RÉESSAYER. C'est CE champ que l'ordonnanceur lit, et lui
  -- seul : une file qui se déduirait d'un statut se remettrait à
  -- tourner à chaque changement d'humeur du statut.
  add column if not exists vies_next_attempt_at timestamptz,
  -- Ce que VIES a répondu, en clair, pour l'écran d'administration.
  add column if not exists vies_last_error text,
  -- LE NUMÉRO DE CONSULTATION que VIES rend en cas de validation. C'est
  -- la PREUVE opposable en contrôle fiscal ; sans lui, « validé » n'est
  -- qu'une affirmation de notre part.
  add column if not exists vies_consultation_number text,
  -- LE NUMÉRO TEL QU'IL A ÉTÉ INTERROGÉ, et c'est un trou réel qu'on
  -- referme : sans lui, changer business_organizations.vat_number
  -- laissait vat_number_validated_at en place, et l'ancien contrôle
  -- valait pour le nouveau numéro.
  add column if not exists vat_number_checked text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saas_customer_tax_profiles_vies_status_valid') then
    alter table public.saas_customer_tax_profiles add constraint saas_customer_tax_profiles_vies_status_valid
      check (vies_status is null or vies_status in ('valide', 'refuse', 'indisponible'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'saas_customer_tax_profiles_vies_attempts_positive') then
    alter table public.saas_customer_tax_profiles add constraint saas_customer_tax_profiles_vies_attempts_positive
      check (vies_attempts >= 0);
  end if;
end $$;

create index if not exists saas_customer_tax_profiles_vies_queue_idx
  on public.saas_customer_tax_profiles (vies_next_attempt_at)
  where vies_next_attempt_at is not null;

comment on column public.saas_customer_tax_profiles.vies_status is
  'valide | refuse | indisponible, plus le NULL qui vaut « jamais interrogé ». '
  '« Indisponible » ne vaut NI validation NI refus : l''émission reste refusée, ET la ligne repart '
  'dans la file. Traiter l''indisponibilité comme un refus perdrait des clients ; comme une '
  'validation, elle collecterait mal la TVA.';

comment on column public.saas_customer_tax_profiles.vat_number_checked is
  'Le numéro TEL QU''IL A ÉTÉ INTERROGÉ. Sans lui, changer le numéro de l''entreprise laisserait '
  'la validation de l''ANCIEN valoir pour le nouveau.';

-- ------------------------------------------------------------
-- 7.a LA RÈGLE QUI LIE LES COLONNES NEUVES À L'ANCIENNE
-- ------------------------------------------------------------
--
-- C'EST LA PLUS IMPORTANTE DU PARAGRAPHE.
-- vat_number_validated_at NE SE POSE QUE SI VIES A DIT « VALIDE ».
--
--   'valide'       → validated_at posé, source 'vies' → euReverseCharge,
--                    la facture s'émet.
--   'refuse'       → validated_at NUL → unknown → émission REFUSÉE.
--                    Correct : facturer 0 % à un non-assujetti laisserait
--                    Oasis Care redevable de la TVA.
--   'indisponible' → validated_at NUL → unknown → émission REFUSÉE
--                    AUSSI, mais pour une raison DIFFÉRENTE, et c'est
--                    là que le message doit changer.
--
-- UN DÉCLENCHEUR PLUTÔT QU'UN `check`, POUR UNE RAISON PRÉCISE : une
-- validation MANUELLE (source 'manual' ou 'document') après un refus de
-- VIES est un cas réel — un client dont l'immatriculation vient d'être
-- publiée et que le registre n'a pas encore répercutée. Un `check` la
-- refuserait avec un message de contrainte illisible ; le déclencheur
-- explique quoi faire. Et il ne l'autorise pas en silence : il faut
-- d'abord effacer le refus, délibérément, avec un motif.
create or replace function public.saas_tax_profile_vies_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.vies_status = 'valide' and new.vat_number_validated_at is null then
    raise exception 'Incohérent : VIES a validé ce numéro, mais rien n''enregistre la validation. Une validation qui ne se voit pas ne sert à rien.'
      using errcode = '23514';
  end if;

  if new.vies_status in ('refuse', 'indisponible') and new.vat_number_validated_at is not null then
    raise exception 'VIES a répondu « % » pour ce numéro : on ne peut pas le déclarer validé par-dessus. Effacez d''abord ce résultat (admin_clear_vies_result) en disant pourquoi — facturer 0 %% à un client qui n''est pas assujetti laisserait Oasis Care redevable de la TVA.',
      case new.vies_status when 'refuse' then 'refusé' else 'registre indisponible' end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists saas_tax_profile_vies_guard on public.saas_customer_tax_profiles;
create trigger saas_tax_profile_vies_guard
  before insert or update on public.saas_customer_tax_profiles
  for each row execute function public.saas_tax_profile_vies_guard();

revoke all on function public.saas_tax_profile_vies_guard() from public;
revoke all on function public.saas_tax_profile_vies_guard() from anon;
revoke all on function public.saas_tax_profile_vies_guard() from authenticated;


-- ------------------------------------------------------------
-- 7.b UN NUMÉRO FRANÇAIS NE PASSE PAS PAR VIES
-- ------------------------------------------------------------
-- Le régime français est 'france' à 20 % que le numéro soit validé ou
-- non : c'est le SIRET qui est exigé à l'émission, pas le numéro
-- intracommunautaire. Interroger VIES pour un client français, ce
-- serait s'exposer à ses pannes sans rien y gagner.
--
-- La clé se vérifie HORS LIGNE : FR + une clé à deux caractères + les
-- neuf chiffres du SIREN, où la clé numérique vaut
-- (12 + 3 × (SIREN mod 97)) mod 97. Une clé alphanumérique — l'ancien
-- format — n'est pas vérifiable ainsi : on ne la déclare pas fausse, on
-- déclare qu'on ne sait pas.
create or replace function public.saas_vat_number_fr_valide(p_vat text)
returns boolean
language plpgsql
immutable
as $$
declare
  v text;
  v_cle text;
  v_siren text;
begin
  v := upper(regexp_replace(coalesce(p_vat, ''), '[^A-Za-z0-9]', '', 'g'));
  if v !~ '^FR[0-9A-Z]{2}[0-9]{9}$' then
    return false;
  end if;
  v_cle := substring(v from 3 for 2);
  v_siren := substring(v from 5 for 9);
  if v_cle !~ '^[0-9]{2}$' then
    -- Ancien format à clé alphanumérique : non vérifiable hors ligne.
    -- On ne dit pas « faux », on dit « pas vérifié » — et le seul
    -- appelant traite le faux comme « à faire vérifier ailleurs ».
    return false;
  end if;
  return v_cle::integer = (12 + 3 * (v_siren::bigint % 97)) % 97;
end;
$$;

comment on function public.saas_vat_number_fr_valide(text) is
  'La clé d''un numéro de TVA français, vérifiée hors ligne depuis le SIREN. '
  'Un numéro français ne part JAMAIS dans la file VIES : son régime est « france » à 20 %.';


-- ------------------------------------------------------------
-- 7.c METTRE UNE ENTREPRISE DANS LA FILE — SANS BLOQUER PERSONNE
-- ------------------------------------------------------------
-- L'INSCRIPTION N'ATTEND PAS VIES. La ligne est créée avec
-- vies_status = NULL et vies_next_attempt_at = maintenant, et le tunnel
-- se termine. Ce qui attend, c'est l'ÉMISSION DE LA FACTURE, et c'était
-- déjà le comportement de 0081.
--
-- IDEMPOTENTE : la rappeler ne remet pas le compteur à zéro et ne
-- reprogramme pas un essai déjà planifié. Elle ne réveille la file que
-- si le NUMÉRO A CHANGÉ depuis le dernier contrôle — auquel cas
-- l'ancienne validation ne vaut plus rien, et elle est effacée.
create or replace function public.saas_vies_enqueue(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org record;
  v_vat text;
  v_profil record;
begin
  -- LA GARDE, ET ELLE N'EST PAS DÉCORATIVE : cette fonction EFFACE une
  -- validation quand le numéro a changé. Sans contrôle, n'importe quel
  -- compte connecté pourrait remettre à zéro la validation de TVA d'une
  -- autre entreprise et bloquer sa facturation.
  if not (public.saas_contexte_machine()
          or public.is_organization_member(p_organization_id)
          or public.platform_admin_can('billing.invoices.write')) then
    raise exception 'Accès refusé : on ne relance pas la validation de TVA d''une autre entreprise.'
      using errcode = '42501';
  end if;

  select * into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org.id is null then
    return 'Entreprise inconnue.';
  end if;

  v_vat := nullif(btrim(coalesce(v_org.vat_number, '')), '');

  -- La France ne passe pas par VIES.
  if upper(btrim(coalesce(v_org.country, ''))) = 'FR' then
    return 'Client français : régime « france » à 20 %, aucune consultation VIES nécessaire.';
  end if;

  if v_vat is null then
    return 'Aucun numéro de TVA intracommunautaire à valider.';
  end if;

  select * into v_profil from public.saas_customer_tax_profiles t
   where t.organization_id = p_organization_id;

  if v_profil.organization_id is null then
    insert into public.saas_customer_tax_profiles
      (organization_id, vies_next_attempt_at, vat_number_checked)
    values (p_organization_id, now(), null);
    return 'Numéro à valider : la consultation partira sans retarder l''inscription.';
  end if;

  -- Le numéro a changé depuis le dernier contrôle : l'ancienne
  -- validation ne vaut plus rien, et la laisser en place ferait valoir
  -- la vérification d'un numéro pour un autre.
  if v_profil.vat_number_checked is distinct from v_vat then
    update public.saas_customer_tax_profiles
       set vies_status = null,
           vat_number_validated_at = null,
           validation_source = null,
           vies_consultation_number = null,
           vies_last_error = null,
           vies_attempts = 0,
           vies_next_attempt_at = now(),
           updated_at = now()
     where organization_id = p_organization_id;
    return 'Le numéro a changé : l''ancienne validation est effacée, une nouvelle consultation part.';
  end if;

  if v_profil.vies_status = 'valide' then
    return 'Numéro déjà validé.';
  end if;

  -- Déjà en file : on ne reprogramme rien, sans quoi une inscription
  -- rejouée relancerait indéfiniment le compteur d'essais.
  if v_profil.vies_next_attempt_at is not null then
    return 'Consultation déjà programmée.';
  end if;

  update public.saas_customer_tax_profiles
     set vies_next_attempt_at = now(), updated_at = now()
   where organization_id = p_organization_id;
  return 'Consultation programmée.';
end;
$$;


-- ------------------------------------------------------------
-- 7.d CE QUI EST DÛ — LA FILE QUE L'ORDONNANCEUR LIT
-- ------------------------------------------------------------
create or replace function public.saas_vies_pending(p_limit integer default 50)
returns table (
  organization_id uuid,
  country text,
  vat_number text,
  attempts integer,
  last_error text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : la file de consultation VIES est lue par la machine.'
      using errcode = '42501';
  end if;

  return query
  select t.organization_id,
         upper(btrim(o.country)),
         nullif(btrim(coalesce(o.vat_number, '')), ''),
         t.vies_attempts,
         t.vies_last_error
  from public.saas_customer_tax_profiles t
  join public.business_organizations o on o.id = t.organization_id
  where t.vies_next_attempt_at is not null
    and t.vies_next_attempt_at <= now()
    and upper(btrim(coalesce(o.country, ''))) <> 'FR'
    and nullif(btrim(coalesce(o.vat_number, '')), '') is not null
  order by t.vies_next_attempt_at
  limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$$;


-- ------------------------------------------------------------
-- 7.e CE QUE VIES A RÉPONDU
-- ------------------------------------------------------------
-- IDEMPOTENTE au sens qui compte ici : la rejouer avec le même
-- résultat laisse la base dans le même état. Le compteur d'essais ne
-- monte que sur un échec, et une validation déjà enregistrée n'est pas
-- réécrite — sa DATE est une preuve, et la repousser à chaque
-- consultation la ferait mentir.
--
-- AUCUN APPEL RÉSEAU ICI, ET C'EST LE POINT : la base ne parle pas à
-- VIES. C'est la fonction Edge qui interroge et qui vient déposer la
-- réponse. Une base qui attendrait un service public européen tiendrait
-- une transaction ouverte pendant sa panne.
create or replace function public.saas_vies_record_result(
  p_organization_id uuid,
  p_vat_number text,
  p_status text,
  p_consultation_number text default null,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profil record;
  v_vat text;
  v_prochain timestamptz;
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : seule la machine dépose une réponse de VIES.'
      using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('valide', 'refuse', 'indisponible') then
    raise exception 'Réponse VIES inconnue : %. Trois états, et trois seulement : valide, refuse, indisponible.',
      coalesce(p_status, '(vide)') using errcode = '23514';
  end if;

  v_vat := nullif(btrim(coalesce(p_vat_number, '')), '');
  if v_vat is null then
    raise exception 'Une réponse de VIES porte le numéro interrogé : sans lui, on ne saurait pas ce qui a été vérifié.'
      using errcode = '23514';
  end if;

  select * into v_profil from public.saas_customer_tax_profiles t
   where t.organization_id = p_organization_id for update;
  if v_profil.organization_id is null then
    insert into public.saas_customer_tax_profiles (organization_id) values (p_organization_id);
    select * into v_profil from public.saas_customer_tax_profiles t
     where t.organization_id = p_organization_id for update;
  end if;

  -- Déjà validé pour CE numéro : on ne repousse pas la date de preuve.
  if v_profil.vies_status = 'valide' and v_profil.vat_number_checked = v_vat and p_status = 'valide' then
    return 'Déjà validé : rien ne change.';
  end if;

  if p_status = 'valide' then
    update public.saas_customer_tax_profiles
       set vies_status = 'valide',
           vat_number_checked = v_vat,
           vat_number_validated_at = now(),
           validation_source = 'vies',
           vies_consultation_number = nullif(btrim(coalesce(p_consultation_number, '')), ''),
           vies_last_attempt_at = now(),
           vies_attempts = 0,
           vies_next_attempt_at = null,
           vies_last_error = null,
           is_vat_registered = true,
           updated_at = now()
     where organization_id = p_organization_id;
    return 'Numéro validé : la facture peut être émise en autoliquidation.';
  end if;

  if p_status = 'refuse' then
    -- UN REFUS EST UNE RÉPONSE, PAS UNE PANNE : on ne réessaie pas en
    -- boucle. C'est un humain qui doit appeler le client.
    update public.saas_customer_tax_profiles
       set vies_status = 'refuse',
           vat_number_checked = v_vat,
           vat_number_validated_at = null,
           validation_source = null,
           vies_consultation_number = null,
           vies_last_attempt_at = now(),
           vies_attempts = v_profil.vies_attempts + 1,
           vies_next_attempt_at = null,
           vies_last_error = public.ai_clean_text(p_error, 500),
           is_vat_registered = false,
           updated_at = now()
     where organization_id = p_organization_id;
    return 'Numéro refusé par VIES : l''émission reste bloquée, et personne ne réessaiera tout seul.';
  end if;

  -- ---- INDISPONIBLE : ON NE SAIT PAS, ET ON REVIENDRA ----------
  -- Le report double à chaque échec, plafonné à vingt-quatre heures.
  -- Un registre national tombe pour des heures, pas pour des semaines ;
  -- réessayer toutes les minutes ne ferait que se faire refouler.
  --
  -- is_vat_registered N'EST PAS TOUCHÉ : ne pas savoir n'est pas savoir
  -- que non. Le NULL de cette colonne est un état à part entière, et
  -- 0081 l'écrit déjà : « un booléen à deux états forcerait à choisir
  -- entre deux mensonges ».
  v_prochain := now() + least(
    make_interval(hours => (2 ^ least(v_profil.vies_attempts, 5))::integer),
    interval '24 hours');

  update public.saas_customer_tax_profiles
     set vies_status = 'indisponible',
         vat_number_checked = v_vat,
         vat_number_validated_at = null,
         validation_source = null,
         vies_last_attempt_at = now(),
         vies_attempts = v_profil.vies_attempts + 1,
         vies_next_attempt_at = v_prochain,
         vies_last_error = public.ai_clean_text(p_error, 500),
         updated_at = now()
   where organization_id = p_organization_id;

  return 'Registre indisponible : nouvel essai le ' || to_char(v_prochain, 'DD/MM/YYYY à HH24:MI') || '.';
end;
$$;

comment on function public.saas_vies_record_result(uuid, text, text, text, text) is
  'Dépose la réponse de VIES. « indisponible » ne vaut NI validation NI refus : l''émission reste '
  'refusée et la ligne repart dans la file, avec un report qui double à chaque échec. '
  'Un REFUS, lui, ne se réessaie pas : c''est une réponse, et c''est un humain qui doit agir.';


-- ------------------------------------------------------------
-- 7.f EFFACER UN RÉSULTAT VIES — GESTE HUMAIN, MOTIVÉ
-- ------------------------------------------------------------
create or replace function public.admin_clear_vies_result(
  p_organization_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org text;
  v_old jsonb;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : effacer un refus de VIES ouvre la porte à une validation manuelle, et donc à une facture à 0 %%.'
      using errcode = '23514';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
  end if;

  select to_jsonb(t) into v_old from public.saas_customer_tax_profiles t
   where t.organization_id = p_organization_id;

  update public.saas_customer_tax_profiles
     set vies_status = null,
         vies_next_attempt_at = null,
         updated_at = now(),
         updated_by = auth.uid()
   where organization_id = p_organization_id;

  return public.record_admin_event(
    'billing.viesResultCleared', 'organization', p_organization_id, v_org, v_old,
    (select to_jsonb(t) from public.saas_customer_tax_profiles t where t.organization_id = p_organization_id),
    v_reason);
end;
$$;


-- ------------------------------------------------------------
-- 7.g LE RÉGIME — MÊME CONTRAT, TROIS PHRASES AU LIEU D'UNE
-- ------------------------------------------------------------
--
-- LA SEULE FONCTION DE TVA QUE CE FICHIER TOUCHE, et il faut que ce
-- soit celle-là. 0083 a remplacé saas_vat_regime() par un renvoi vers
-- saas_vat_regime_compute() — le calcul nu, révoqué des rôles clients,
-- appelé AUSSI par billing_provider_tax_terms() pour le tunnel de
-- paiement. Modifier saas_vat_regime() au lieu de compute() ferait
-- diverger « ce qu'on facture » et « ce qu'on encaisse » : le défaut
-- que 0083 décrit lui-même au § 8.e.
--
-- LE CONTRAT NE BOUGE PAS D'UN IOTA : mêmes cinq valeurs de régime,
-- mêmes taux, même garde 42501 à la porte. Seul le champ `reason`
-- distingue désormais les trois cas — parce qu'un administrateur qui
-- lit « non validé » ne sait pas s'il doit appeler le client ou
-- attendre.
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
  v_profil record;
  v_pourquoi text;
begin
  -- AUCUNE GARDE ICI, ET C'EST VOULU : cette fonction est révoquée de
  -- `public`, d'`anon` et d'`authenticated`. Elle n'est appelable que
  -- depuis les fonctions qui, elles, portent leur garde. Le calcul est
  -- nu ; l'autorisation est à la porte.
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
  select * into v_profil from public.saas_customer_tax_profiles t
    where t.organization_id = p_organization_id;

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
    -- ------------------------------------------------------------
    -- LA VALIDATION VAUT POUR UN NUMÉRO, PAS POUR UNE ENTREPRISE.
    -- ------------------------------------------------------------
    -- C'était le trou le plus cher du chantier, et il était invisible.
    -- vat_number_validated_at décidait seule : un numéro validé, puis
    -- MODIFIÉ dans l'écran « Entreprise », continuait de produire
    -- « euReverseCharge » à 0 %. La facture partait avec 0 € de TVA et
    -- la mention d'autoliquidation, sur un numéro que VIES n'avait
    -- JAMAIS VU. Mesuré : validation sur DE111111111, changement pour
    -- DE222222222, puis facture ÉMISE « euReverseCharge | 0.00 |
    -- DE222222222 ».
    --
    -- vat_number_checked avait justement été ajoutée pour refermer ce
    -- trou, et personne ne la lisait.
    --
    -- LA GARDE VIT ICI ET NON CHEZ L'APPELANT, délibérément : c'est le
    -- SEUL point que tous les chemins traversent. Trois écrans écrivent
    -- business_organizations.vat_number et un seul appelait
    -- saas_vies_enqueue ; le § 7.f ferme aussi cette porte-là, mais une
    -- garde qui dépend de la politesse des appelants n'est pas une
    -- garde.
    --
    -- ELLE NE MORD QUE SUR UN DÉSACCORD CONNU, ET C'EST IMPORTANT.
    -- `vat_number_checked` n'est écrite que par le chemin VIES. Une
    -- validation HUMAINE — `validation_source` vaut 'manual' ou
    -- 'document', prévues par 0081 — la laisse à NULL : quelqu'un a vu
    -- un certificat sur papier, et il n'y a pas de « numéro interrogé »
    -- à enregistrer. Exiger l'égalité stricte annulerait donc toutes
    -- les validations manuelles, ce qui bloquerait la facturation de
    -- clients parfaitement en règle. Deux suites voisines l'ont
    -- attrapé, et elles avaient raison.
    --
    -- On refuse donc quand on SAIT que le numéro contrôlé n'est pas le
    -- numéro courant, et pas quand on l'ignore. Le changement de
    -- numéro, lui, reste couvert dans tous les cas : le déclencheur du
    -- § 7.f efface la validation — manuelle comprise — dès que
    -- `vat_number` bouge.
    if v_vat is not null
       and v_profil.vat_number_validated_at is not null
       and (v_profil.vat_number_checked is null
            or v_profil.vat_number_checked = v_vat) then
      return query select 'euReverseCharge'::text, 0::numeric, null::text;
      -- LE `return` QUI MANQUAIT, ET QUE LE TEST A ATTRAPÉ. Sans lui,
      -- la fonction poursuivait et rendait une SECONDE ligne
      -- « unknown » derrière l'autoliquidation. Tout appelant écrit
      -- « select * into v_regime from saas_vat_regime… » : il aurait
      -- gardé la première et n'aurait rien vu, jusqu'au jour où un
      -- appelant écrit la même chose dans une sous-requête et
      -- rencontre « more than one row returned ». Un bogue qui dort.
      return;
    end if;

    -- ---- LES TROIS PHRASES ------------------------------------
    v_pourquoi := case
      when v_vat is null then
        'son numéro de TVA intracommunautaire est ABSENT'
      -- LE CAS NEUF, ET IL A SA PROPRE PHRASE parce qu'il appelle un
      -- geste différent des autres : il n'y a personne à appeler et
      -- rien à attendre, il faut relancer la consultation.
      when v_profil.vat_number_validated_at is not null
           and v_profil.vat_number_checked is not null
           and v_profil.vat_number_checked <> v_vat then
        'son numéro A CHANGÉ depuis le dernier contrôle — « '
        || coalesce(v_profil.vat_number_checked, 'aucun')
        || ' » avait été validé, « ' || v_vat || ' » ne l''a jamais été. '
        || 'La validation d''un numéro ne vaut pas pour un autre : relancez la consultation'
      when v_profil.vies_status = 'refuse' then
        'VIES a REFUSÉ son numéro le '
        || to_char(coalesce(v_profil.vies_last_attempt_at, now()), 'DD/MM/YYYY')
        || coalesce(' (« ' || v_profil.vies_last_error || ' »)', '')
        || ' : appelez le client, personne ne réessaiera tout seul'
      when v_profil.vies_status = 'indisponible' then
        'le registre de ' || v_country || ' était INDISPONIBLE au dernier essai, le '
        || to_char(coalesce(v_profil.vies_last_attempt_at, now()), 'DD/MM/YYYY à HH24:MI')
        || coalesce(' ; nouvel essai le ' || to_char(v_profil.vies_next_attempt_at, 'DD/MM/YYYY à HH24:MI'), '')
        || '. On ne sait pas encore : ce n''est ni un refus, ni une validation'
      when v_profil.vies_status = 'valide' then
        'VIES l''a validé, mais la validation n''est pas enregistrée — signalez cette incohérence'
      else
        -- LES DEUX MOTS « non validé » SONT CONSERVÉS ICI, ET C'EST
        -- VOULU : c'est la phrase que 0083 a écrite, que son test
        -- vérifie, et qui reste exacte pour ce cas-là. Les deux cas
        -- NEUFS — refusé, indisponible — ont leur propre formulation,
        -- et c'est tout l'objet de ce paragraphe : cesser de dire la
        -- même chose de trois situations qui appellent trois gestes
        -- différents.
        'son numéro de TVA intracommunautaire est non validé : il n''a JAMAIS ÉTÉ INTERROGÉ auprès de VIES'
    end;

    return query select 'unknown'::text, null::numeric,
      ('Entreprise de l''Union (' || v_country || ') dont ' || v_pourquoi
       || '. Facturer 0 % laisserait Oasis Care redevable de la TVA, et supposer le taux français '
       || 'serait faux dans l''autre sens : l''émission est bloquée tant que ce n''est pas tranché.')::text;
    return;
  end if;

  return query select 'outsideEu'::text, 0::numeric, null::text;
end;
$$;

comment on function public.saas_vat_regime_compute(uuid) is
  'LE calcul du régime de TVA, sans garde et sans appelant direct. Révoquée de tous les rôles clients : '
  'saas_vat_regime() et billing_provider_tax_terms() sont les deux seules portes, et chacune porte la sienne. '
  '0089 : le motif distingue « refusé », « indisponible » et « jamais interrogé ». Les régimes rendus, eux, '
  'sont exactement les mêmes qu''avant.';

do $$
begin
  execute 'revoke all on function public.saas_vat_regime_compute(uuid) from public';
  execute 'revoke all on function public.saas_vat_regime_compute(uuid) from anon';
  execute 'revoke all on function public.saas_vat_regime_compute(uuid) from authenticated';
end $$;


-- ------------------------------------------------------------
-- 7.f LE NUMÉRO QUI CHANGE — LA PORTE FERMÉE À LA SOURCE
-- ------------------------------------------------------------
--
-- saas_vies_enqueue() sait effacer une validation périmée, mais elle
-- n'était appelée QUE par le tunnel d'inscription. Deux autres écrans
-- écrivent business_organizations.vat_number — « Entreprise » et
-- « Bienvenue » — et ni l'un ni l'autre ne la prévenait. La validation
-- de l'ancien numéro survivait donc au nouveau.
--
-- POURQUOI UN DÉCLENCHEUR ET PAS TROIS APPELS. Parce qu'un quatrième
-- écran s'écrira un jour, et que son auteur n'aura aucune raison de
-- savoir qu'il doit prévenir la TVA. Une règle qui dépend de la
-- mémoire des développeurs est une règle qui casse ; celle-ci est
-- portée par la table elle-même.
--
-- IL N'APPELLE PAS saas_vies_enqueue : cette fonction porte une garde
-- de permission qui n'a aucun sens dans un déclencheur, et elle lit la
-- ligne qu'on est justement en train de modifier. Il fait le geste nu —
-- effacer, et remettre en file.
create or replace function public.business_organizations_vat_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_avant text := nullif(btrim(coalesce(old.vat_number, '')), '');
  v_apres text := nullif(btrim(coalesce(new.vat_number, '')), '');
begin
  if v_avant is not distinct from v_apres then
    return new;
  end if;

  -- Le numéro a changé. Ce qui valait pour l'ancien ne vaut plus, et
  -- le laisser en place ferait facturer 0 % sur un numéro jamais
  -- contrôlé.
  update public.saas_customer_tax_profiles
     set vies_status = null,
         vat_number_validated_at = null,
         validation_source = null,
         vies_consultation_number = null,
         vies_last_error = null,
         vies_attempts = 0,
         -- Un numéro français ne part pas dans la file : régime
         -- « france », 20 %, contrôle hors ligne depuis le SIREN.
         vies_next_attempt_at = case
           when v_apres is null then null
           when upper(btrim(coalesce(new.country, ''))) = 'FR' then null
           else now()
         end,
         updated_at = now()
   where organization_id = new.id;

  return new;
end;
$$;

drop trigger if exists business_organizations_vat_changed on public.business_organizations;
create trigger business_organizations_vat_changed
  after update of vat_number on public.business_organizations
  for each row execute function public.business_organizations_vat_changed();

revoke all on function public.business_organizations_vat_changed() from public;
revoke all on function public.business_organizations_vat_changed() from anon;
revoke all on function public.business_organizations_vat_changed() from authenticated;


-- ============================================================
-- 8. LA PORTE ANONYME — UN DEVIS, UN JETON, EN LECTURE SEULE
-- ============================================================
--
-- LIRE L'EN-TÊTE DE CE FICHIER AVANT DE TOUCHER À QUOI QUE CE SOIT ICI.
--
-- POURQUOI UN TROISIÈME REGISTRE DE JETONS, ALORS QU'IL EN EXISTE DÉJÀ
-- TROIS. Parce qu'aucun des trois n'est anonyme, et la vérification est
-- nette : une requête sur pg_policies cherchant une politique portant
-- le rôle `anon` rendait ZÉRO LIGNE dans toute la base.
--
--   • client_invitations.token — le plus proche, et pourtant non :
--     client_invitation_preview() porte « and auth.uid() is not null »
--     et est révoquée d'anon. Ce jeton RATTACHE UN COMPTE à un client ;
--     il n'ouvre pas un document sans compte. On lui emprunte en
--     revanche sa GÉNÉRATION, qui est exemplaire : 32 octets.
--   • smart_tags.public_token — contre-modèle explicite. 0008 ligne 28 :
--     « Spec §51: a token must never bypass permissions/RLS. » C'est un
--     index de recherche pour un membre déjà connecté.
--   • nursery_lots.public_token — même chose, en 16 octets seulement,
--     sans expiration ni révocation. Un identifiant de QR, pas une clé.
--
-- LE BON MODÈLE EST LE QUATRIÈME, ET IL VIENT DE 0084 :
-- email_unsubscribe(), la SEULE fonction du dépôt accordée à `anon`.
-- Elle n'ouvre aucune session, ne rend rien en clair, et est le seul
-- chemin qui accepte son jeton. On suit sa discipline mot pour mot.

create table if not exists public.document_share_links (
  id uuid primary key default gen_random_uuid(),

  -- L'ENTREPRISE, POUR QUE LA PORTE SOIT RÉVOCABLE PAR SON PROPRIÉTAIRE
  -- et visible dans ses écrans.
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- UN SEUL TYPE POUR L'INSTANT, et la contrainte le dit. Ouvrir la
  -- facture est une décision distincte : une facture porte un IBAN, et
  -- un IBAN public est une invitation à la fraude au virement.
  document_kind text not null check (document_kind in ('quote')),
  document_id uuid not null,

  -- 32 OCTETS TIRÉS AU HASARD CRYPTOGRAPHIQUE. Jamais l'identifiant du
  -- devis, jamais un compteur, jamais rien de dérivé du client.
  -- 256 bits : deviner est hors de portée, et c'est la seule barrière
  -- qui tienne pour une porte que personne ne surveille.
  token text not null unique default encode(gen_random_bytes(32), 'hex'),

  -- L'ÉCHÉANCE. Voir l'en-tête : c'est celle du DEVIS quand il en a
  -- une, et un PLAFOND de trente jours sinon. Pas une seconde échéance
  -- qui contredirait la première — un plafond quand la première est
  -- absente.
  expires_at timestamptz not null,

  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_reason text,

  -- LA TRAÇABILITÉ. « Le client a-t-il vu mon devis ? » n'a aujourd'hui
  -- aucune réponse honnête : quotes.viewed_at est une SAISIE HUMAINE,
  -- et 0088 interdit à l'IA de prétendre autre chose. Ces trois
  -- colonnes seront le premier accusé de lecture du produit.
  opened_count integer not null default 0 check (opened_count >= 0),
  first_opened_at timestamptz,
  last_opened_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint document_share_links_revocation_coherente
    check ((revoked_at is null) = (revoked_by is null and revoked_reason is null))
);

-- UNE SEULE PORTE VIVANTE PAR DOCUMENT. Deux liens valides pour le même
-- devis, ce sont deux portes à surveiller — la règle est empruntée à
-- client_invitations, qui supprime l'invitation en attente avant d'en
-- créer une nouvelle. Ici on RÉVOQUE plutôt qu'on ne supprime : le
-- journal des ouvertures doit survivre au renouvellement du lien.
create unique index if not exists document_share_links_one_live_idx
  on public.document_share_links (document_kind, document_id)
  where revoked_at is null;

create index if not exists document_share_links_org_idx
  on public.document_share_links (organization_id, created_at desc);

alter table public.document_share_links enable row level security;

-- L'ENTREPRISE VOIT SES PROPRES LIENS. `anon` n'a RIEN sur cette table :
-- la seule chose qu'un anonyme puisse faire avec un jeton, c'est
-- l'apporter à la fonction du § 8.c.
drop policy if exists "L'entreprise lit ses liens de partage" on public.document_share_links;
create policy "L'entreprise lit ses liens de partage" on public.document_share_links
  for select using (public.has_permission(organization_id, 'quotes.read'));

comment on table public.document_share_links is
  'La porte anonyme vers UN document commercial. Le jeton n''authentifie personne, n''ouvre aucune '
  'session, et ne donne accès qu''à ce document-là. Table dédiée et non colonne sur quotes : la porte '
  'doit être révocable et traçable indépendamment du devis, et un devis peut être partagé deux fois.';

-- ------------------------------------------------------------
-- 8.b LES OUVERTURES — « QUAND », JAMAIS « QUI »
-- ------------------------------------------------------------
-- « Qui » n'aurait aucun sens ici : personne n'est connecté, et une
-- adresse IP est une donnée personnelle qu'on collecterait sans base
-- légale claire pour un bénéfice nul. « Quand » en a beaucoup : c'est
-- la seule réponse honnête à « le client a-t-il ouvert mon devis ? ».
create table if not exists public.document_share_openings (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.document_share_links (id) on delete cascade,
  opened_at timestamptz not null default now()
);

create index if not exists document_share_openings_link_idx
  on public.document_share_openings (link_id, opened_at desc);

-- ------------------------------------------------------------
-- CE QUE CE JOURNAL PROUVE, ET CE QU'IL NE PROUVE PAS.
-- À LIRE AVANT D'ÉCRIRE LA MOINDRE PHRASE À UN PAYSAGISTE.
-- ------------------------------------------------------------
--
-- IL COMPTE DES OUVERTURES, PAS DES LECTURES. Un lien envoyé par
-- courriel est ouvert par les analyseurs de sécurité et les
-- pré-chargeurs de messagerie À LA LIVRAISON — donc avant que le client
-- n'ait rien vu. Rien ici ne permet de les distinguer : la table ne
-- porte que (id, link_id, opened_at), et c'est un choix de vie privée
-- qu'on ne revient pas dessus (ni adresse, ni agent utilisateur).
--
-- LA CONSÉQUENCE EST UNE RÈGLE DE VOCABULAIRE, ET ELLE EST FERME.
-- Les seules phrases autorisées sont factuelles :
--   « Lien ouvert 3 fois, la première le 12/03 à 14 h 02. »
-- Les phrases interdites sont celles qui concluent :
--   « Votre client a lu le devis. »  ← FAUSSE quand c'est un automate.
-- Le paysagiste décidera d'appeler ou non son client là-dessus ; une
-- phrase confiante et parfois fausse est pire qu'une phrase prudente.
--
-- ET C'EST POURQUOI 0088 N'EST PAS RÉVISÉ SUR CETTE BASE. Il interdit
-- aujourd'hui à l'IA de dire autre chose que « personne n'a marqué ce
-- devis comme vu ». Remplacer cette phrase prudente et vraie par une
-- phrase confiante et parfois fausse serait un mauvais échange. Le jour
-- où l'ouverture sera confirmée depuis le navigateur — un analyseur de
-- courriel n'exécute pas de JavaScript —, la limite pourra bouger.
comment on table public.document_share_openings is
  'QUAND un lien de partage a été ouvert, jamais par qui. Il compte des OUVERTURES, pas des lectures : '
  'les analyseurs de courriel ouvrent le lien à la livraison, et rien ici ne les distingue d''un humain. '
  'Les phrases autorisées sont factuelles (« ouvert 3 fois, la première le … ») ; « votre client a lu le '
  'devis » est interdite, parce qu''elle est parfois fausse et qu''on décide d''un appel commercial dessus.';

alter table public.document_share_openings enable row level security;

drop policy if exists "L'entreprise lit les ouvertures de ses liens" on public.document_share_openings;
create policy "L'entreprise lit les ouvertures de ses liens" on public.document_share_openings
  for select using (exists (
    select 1 from public.document_share_links l
    where l.id = link_id and public.has_permission(l.organization_id, 'quotes.read')
  ));

-- ------------------------------------------------------------
-- 8.c LES TENTATIVES QUI ÉCHOUENT — ET CE QU'UNE BASE PEUT VRAIMENT
--     FAIRE CONTRE L'ÉNUMÉRATION
-- ------------------------------------------------------------
--
-- SOYONS EXACTS SUR CE QUE CETTE TABLE APPORTE, PARCE QU'UNE PROMESSE
-- DE SÉCURITÉ APPROXIMATIVE EST PIRE QUE PAS DE PROMESSE DU TOUT.
--
-- Un jeton n'a pas de session : la fonction ne sait pas QUI l'apporte.
-- Elle ne peut donc pas limiter « par visiteur ». Ce qu'elle peut, et
-- ce qu'elle fait :
--
--   1. RENDRE LE TIRAGE HORS DE PORTÉE. 256 bits. Il n'existe pas de
--      « milliers de jetons » à essayer : il en faudrait 2^255.
--   2. COMPTER LES ÉCHECS PAR FENÊTRE DE CINQ MINUTES, et poser un
--      drapeau quand la fenêtre déborde. Le compteur cesse alors de
--      grossir — une table de journal ne doit pas être un levier de
--      saturation de disque.
--   3. LE DIRE. document_share_sous_attaque() rend vrai, et c'est la
--      route web — qui, elle, VOIT l'adresse du visiteur — qui refuse,
--      ralentit ou présente une épreuve. La limitation par client
--      appartient au bord, pas à la base ; prétendre le contraire ici
--      donnerait une fausse assurance.
--
-- CE QU'ON NE FAIT SURTOUT PAS : refuser les jetons VALIDES pendant une
-- saturation. Un client qui reçoit son devis pendant qu'un curieux
-- tape au hasard doit pouvoir le lire.
create table if not exists public.document_share_attempts (
  window_start timestamptz primary key,
  failures integer not null default 0 check (failures >= 0),
  saturated_at timestamptz
);

alter table public.document_share_attempts enable row level security;

drop policy if exists "Les habilités voient les tentatives" on public.document_share_attempts;
create policy "Les habilités voient les tentatives" on public.document_share_attempts
  for select using (public.is_platform_admin());

create or replace function public.document_share_sous_attaque()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.document_share_attempts a
    where a.saturated_at is not null
      and a.window_start > now() - interval '15 minutes'
  );
$$;

comment on function public.document_share_sous_attaque() is
  'Vrai quand une fenêtre récente a débordé de tentatives infructueuses. La route web s''en sert pour '
  'refuser au BORD, là où l''adresse du visiteur est connue : la base, elle, ne sait pas qui frappe.';

-- ------------------------------------------------------------
-- 8.d OUVRIR LA PORTE — LA CLAUSE `where` EST LA SEULE BARRIÈRE
-- ------------------------------------------------------------
--
-- CETTE FONCTION EST `security definer` ET ACCORDÉE À `anon`. Elle
-- contourne donc la RLS de `quotes`, et RIEN d'autre que sa clause
-- `where` ne protège les données. Elle est écrite comme telle : chaque
-- condition est là pour une raison, et aucune n'est décorative.
--
--   1. le jeton doit exister, à l'octet près ;
--   2. le lien ne doit pas être révoqué ;
--   3. il ne doit pas être expiré ;
--   4. le devis doit exister, ne pas être archivé, et ne pas être un
--      brouillon ni une relecture interne — exactement le filtre de
--      client_quotes, parce qu'un devis qu'on est en train d'écrire
--      n'a pas été remis ;
--   5. le devis doit appartenir à l'entreprise qui a créé le lien.
--
-- LES COLONNES SONT CHOISIES UNE PAR UNE, et la liste est celle des
-- vues client_* de 0055, mot pour mot. Ce qui n'y est pas ne peut pas
-- sortir : ni unit_cost_cents, ni cost_total_cents, ni cost_kind, ni
-- internal_notes, ni created_by, ni catalog_item_id. Le test de ce
-- chantier compare les deux listes et échoue si elles divergent.
--
-- LE MESSAGE DE REFUS EST LE MÊME DANS TOUS LES CAS. On ne dit pas à un
-- curieux si son jeton a existé, s'il a expiré ou s'il a été révoqué :
-- c'est la règle d'email_unsubscribe, et elle vaut ici aussi.
create or replace function public.devis_par_jeton(p_token text)
returns table (
  ok boolean,
  message text,
  entreprise jsonb,
  devis jsonb,
  sections jsonb,
  lignes jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_link record;
  v_quote record;
  v_org record;
  v_fenetre timestamptz;
  v_sature boolean;
  v_refus constant text :=
    'Ce lien n''est plus valable. Demandez-en un nouveau à votre paysagiste.';
begin
  v_token := lower(btrim(coalesce(p_token, '')));
  v_fenetre := to_timestamp(floor(extract(epoch from now()) / 300) * 300);

  -- La forme d'abord : un jeton de ce registre fait 64 caractères
  -- hexadécimaux. Ce qui n'a pas cette forme n'a jamais existé.
  if v_token !~ '^[0-9a-f]{64}$' then
    perform public.document_share_note_echec(v_fenetre);
    return query select false, v_refus, null::jsonb, null::jsonb, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_link
  from public.document_share_links l
  where l.token = v_token
    and l.revoked_at is null
    and l.expires_at > now();

  if v_link.id is null then
    perform public.document_share_note_echec(v_fenetre);
    return query select false, v_refus, null::jsonb, null::jsonb, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_quote
  from public.quotes q
  where q.id = v_link.document_id
    and q.organization_id = v_link.organization_id
    and q.archived_at is null
    and q.status <> 'draft'
    and q.status <> 'internalReview'
    -- LA VALIDITÉ SE RELIT, ELLE NE SE RECOPIE PAS.
    --
    -- partager_devis fige expires_at au moment du partage. Si le
    -- paysagiste RACCOURCIT ensuite la validité du devis — une date
    -- corrigée, une offre retirée — le lien continuait d'ouvrir le
    -- document, et la page affichait au client « Valable jusqu'au
    -- <date passée> » tout en le lui montrant. Mesuré : validité
    -- ramenée à hier, porte encore ouverte deux mois.
    --
    -- C'était exactement l'invariant que ce fichier s'était donné :
    -- « L'ÉCHÉANCE VIENT DU DEVIS. On ne réinvente pas une date qui
    -- contredirait celle que le client lit sur le document. »
    -- expires_at garde son rôle de PLAFOND — les trente jours quand
    -- valid_until est nulle, et la révocation ; l'échéance réelle
    -- redevient celle du document.
    and (q.valid_until is null or q.valid_until >= current_date);

  if v_quote.id is null then
    -- Le devis a été archivé ou renvoyé en brouillon depuis le partage.
    -- Même message : le porteur du jeton n'a pas à apprendre l'état
    -- interne d'un document.
    perform public.document_share_note_echec(v_fenetre);
    return query select false, v_refus, null::jsonb, null::jsonb, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_org from public.business_organizations o where o.id = v_quote.organization_id;

  -- ---- LA TRACE, AVANT DE RENDRE QUOI QUE CE SOIT --------------
  --
  -- ELLE EST BORNÉE, ET IL LE FAUT : C'EST LE SEUL CHEMIN D'ÉCRITURE
  -- QUE CE FICHIER OUVRE À UN ANONYME.
  --
  -- Chaque ouverture insérait une ligne, sans plafond, sans
  -- déduplication et sans purge. La garde du bord ne compte QUE les
  -- échecs — délibérément : « un client qui ouvre son devis vingt fois
  -- n'est jamais ralenti » — et la page interdit tout cache. Quiconque
  -- détient un lien valide écrivait donc autant de lignes qu'il
  -- voulait : mesuré, 500 lignes avec un seul jeton. La table voisine
  -- des ÉCHECS, elle, plafonnait déjà « pour qu'une table de journal ne
  -- devienne pas le levier par lequel on remplit le disque » ; le
  -- journal des SUCCÈS n'avait rien reçu d'équivalent.
  --
  -- DEUX BORNES, ET AUCUNE NE COÛTE À L'ACCUSÉ DE LECTURE :
  --   1. UNE OUVERTURE PAR DEMI-HEURE. Un accusé de lecture ne cherche
  --      pas à compter les rafraîchissements de page ; savoir que le
  --      client est revenu une demi-heure plus tard suffit largement.
  --   2. LE COMPTEUR S'ARRÊTE À MILLE. Au-delà, « beaucoup » est la
  --      seule information restante, et elle est déjà acquise.
  if not exists (
    select 1 from public.document_share_openings o
    where o.link_id = v_link.id and o.opened_at > now() - interval '30 minutes'
  ) then
    insert into public.document_share_openings (link_id) values (v_link.id);

    update public.document_share_links
       set opened_count = least(opened_count + 1, 1000),
           first_opened_at = coalesce(first_opened_at, now()),
           last_opened_at = now()
     where id = v_link.id;
  else
    -- Une réouverture dans la demi-heure : on tient la dernière date à
    -- jour, sans fabriquer de ligne ni gonfler le compteur.
    update public.document_share_links
       set last_opened_at = now()
     where id = v_link.id;
  end if;

  return query select
    true,
    null::text,

    -- L'ENTREPRISE : trois colonnes, comme client_portal_companies.
    -- Ni SIRET, ni coordonnées bancaires, ni réglages.
    jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'business_type', v_org.business_type
    ),

    -- LE DEVIS : les DOUZE colonnes de client_quotes, et pas une de
    -- plus. Les douze écartées comprennent internal_notes, created_by,
    -- site_id, opportunity_id, garden_id, sent_at, viewed_at,
    -- decided_at, rejection_reason et archived_at.
    jsonb_build_object(
      'id', v_quote.id,
      'organization_id', v_quote.organization_id,
      'customer_id', v_quote.customer_id,
      'number', v_quote.number,
      'title', v_quote.title,
      'status', v_quote.status,
      'issued_on', v_quote.issued_on,
      'valid_until', v_quote.valid_until,
      'introduction', v_quote.introduction,
      'terms', v_quote.terms,
      'global_discount_percent', v_quote.global_discount_percent,
      'created_at', v_quote.created_at
    ),

    -- LES SECTIONS : les cinq colonnes de client_quote_sections.
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'quote_id', s.quote_id,
               'title', s.title,
               'description', s.description,
               'position', s.position
             ) order by s.position)
      from public.quote_sections s where s.quote_id = v_quote.id
    ), '[]'::jsonb),

    -- LES LIGNES : les onze colonnes de client_quote_lines. LES SEPT
    -- ÉCARTÉES SONT EXACTEMENT LES INTERNES — unit_cost_cents,
    -- cost_total_cents, cost_kind, catalog_item_id, organization_id,
    -- created_at, updated_at. LA MARGE ET LE COÛT D'ACHAT NE PEUVENT
    -- PAS TRANSITER PAR CETTE PORTE.
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'quote_id', l.quote_id,
               'section_id', l.section_id,
               'position', l.position,
               'description', l.description,
               'unit', l.unit,
               'quantity', l.quantity,
               'unit_sale_price_cents', l.unit_sale_price_cents,
               'vat_rate', l.vat_rate,
               'discount_percent', l.discount_percent,
               'sale_total_cents', l.sale_total_cents
             ) order by l.position)
      from public.quote_lines l where l.quote_id = v_quote.id
    ), '[]'::jsonb);
end;
$$;

-- Le compteur d'échecs, à part : `devis_par_jeton` est `stable` par
-- nature mais doit écrire ces deux lignes-là. On isole l'écriture pour
-- que la fonction publique reste lisible d'un seul tenant.
create or replace function public.document_share_note_echec(p_fenetre timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seuil constant integer := 200;
begin
  insert into public.document_share_attempts (window_start, failures)
  values (p_fenetre, 1)
  on conflict (window_start) do update
    set failures = case
          -- LE COMPTEUR S'ARRÊTE AU SEUIL. Une table de journal ne doit
          -- pas devenir le levier par lequel on remplit le disque.
          when public.document_share_attempts.failures >= v_seuil
            then public.document_share_attempts.failures
          else public.document_share_attempts.failures + 1
        end,
        saturated_at = case
          when public.document_share_attempts.failures + 1 >= v_seuil
            then coalesce(public.document_share_attempts.saturated_at, now())
          else public.document_share_attempts.saturated_at
        end;
end;
$$;

comment on function public.devis_par_jeton(text) is
  'La porte anonyme : un jeton, UN devis, en lecture seule. Elle n''ouvre aucune session, ne rend '
  'aucune donnée interne (ni marge, ni coût d''achat, ni note), et refuse toujours avec la MÊME '
  'phrase — on ne dit pas à un curieux si son jeton a existé, expiré ou été révoqué.';

-- ------------------------------------------------------------
-- 8.e OUVRIR ET FERMER LA PORTE — CÔTÉ PAYSAGISTE
-- ------------------------------------------------------------
create or replace function public.partager_devis(p_quote_id uuid)
returns table (token text, expires_at timestamptz, message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote record;
  v_expire timestamptz;
  v_token text;
begin
  select * into v_quote from public.quotes q where q.id = p_quote_id;
  if v_quote.id is null then
    raise exception 'Devis introuvable.' using errcode = '23503';
  end if;

  -- PARTAGER, C'EST OUVRIR UNE PORTE PUBLIQUE : ça demande le droit de
  -- MODIFIER le devis, pas seulement celui de le lire.
  if not public.has_permission(v_quote.organization_id, 'quotes.edit') then
    raise exception 'Accès refusé : partager un devis demande le droit de le modifier.'
      using errcode = '42501';
  end if;

  if v_quote.archived_at is not null
     or v_quote.status in ('draft', 'internalReview') then
    raise exception 'Ce devis n''est pas prêt à être partagé : un brouillon ou une relecture interne n''a pas été remis au client.'
      using errcode = '23514';
  end if;

  -- L'ÉCHÉANCE VIENT DU DEVIS. On ne réinvente pas une date qui
  -- contredirait celle que le client lit sur le document.
  -- `valid_until + 1 jour` : un devis valable « jusqu'au 30 » l'est
  -- toute la journée du 30.
  --
  -- ET LE PLAFOND, PARCE QUE valid_until EST NULLABLE. Un devis sur
  -- deux peut n'avoir aucune date de validité, et le jeton serait alors
  -- éternel. Trente jours, comme les invitations de 0055.
  v_expire := case
    when v_quote.valid_until is not null then (v_quote.valid_until + 1)::timestamptz
    else now() + interval '30 days'
  end;

  if v_expire <= now() then
    raise exception 'Ce devis a expiré le % : prolongez sa validité avant de le partager.',
      to_char(v_quote.valid_until, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  -- UNE SEULE PORTE VIVANTE. L'ancienne est révoquée, pas supprimée :
  -- son journal d'ouvertures a de la valeur.
  update public.document_share_links
     set revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = 'Remplacé par un nouveau lien de partage.'
   where document_kind = 'quote' and document_id = p_quote_id and revoked_at is null;

  insert into public.document_share_links
    (organization_id, document_kind, document_id, expires_at, created_by)
  values (v_quote.organization_id, 'quote', p_quote_id, v_expire, auth.uid())
  returning document_share_links.token into v_token;

  return query select v_token, v_expire,
    ('Le lien est valable jusqu''au ' || to_char(v_expire - interval '1 second', 'DD/MM/YYYY')
     || '. Il ouvre ce devis, et rien d''autre : il ne donne accès ni à votre compte, ni aux autres documents.')::text;
end;
$$;

create or replace function public.revoquer_partage_devis(p_quote_id uuid, p_motif text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_n integer;
begin
  select q.organization_id into v_org from public.quotes q where q.id = p_quote_id;
  if v_org is null then
    raise exception 'Devis introuvable.' using errcode = '23503';
  end if;
  if not public.has_permission(v_org, 'quotes.edit') then
    raise exception 'Accès refusé : fermer un lien de partage demande le droit de modifier le devis.'
      using errcode = '42501';
  end if;

  update public.document_share_links
     set revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = coalesce(public.ai_clean_text(p_motif, 300), 'Lien fermé par l''entreprise.')
   where document_kind = 'quote' and document_id = p_quote_id and revoked_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ============================================================
-- 9. LES RELANCES — LE CALCUL, ET SEULEMENT LE CALCUL
-- ============================================================
--
-- CE QUE 0084 A DÉJÀ POSÉ, ET QU'IL NE FAUT SURTOUT PAS REFAIRE :
-- le journal d'envoi en ajout seul, l'idempotence par colonne GÉNÉRÉE
-- (organization:campagne:objet:gabarit:rang, sous contrainte unique),
-- le RANG de relance (occurrence, 1 à 10), les réglages de cadence par
-- entreprise (reminders_enabled, reminder_delay_days, reminder_max), les
-- deux gabarits 'devisRelance' et 'factureRelance', la file et son
-- verrou, et la porte email_gate(). Tout est là.
--
-- CE QUI MANQUAIT : le CALCUL. Aucune fonction ne répondait à « quels
-- devis, quelles factures sont dus pour une relance aujourd'hui ». Et
-- le déclencheur dans le temps.
--
-- POURQUOI UNE FILE ET NON UN APPEL DIRECT À email_enqueue().
-- email_enqueue() exige le SUJET, le TEXTE et l'empreinte du HTML —
-- c'est-à-dire le gabarit rendu, qui vit dans le code TypeScript avec
-- le reste des textes du produit. La base ne sait pas écrire une
-- phrase à un client, et il ne faut surtout pas qu'elle apprenne.
--
-- LA TÂCHE CALCULE ET DÉPOSE. LA FONCTION EDGE EXPÉDIE. Deux raisons,
-- et elles ne sont pas de style :
--   • une tâche qui échoue au milieu d'un appel réseau laisse un état
--     indéterminé, alors qu'une insertion est atomique ;
--   • c'est LA FILE qui porte la contrainte d'unicité, donc
--     l'idempotence. Une tâche rejouée deux fois n'envoie pas deux
--     relances au même client — et ce n'est pas la politesse de la
--     fonction qui le garantit, c'est un index.

create table if not exists public.relances_planifiees (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- Le même vocabulaire que email_messages.entity_type, réduit aux deux
  -- objets qui se relancent.
  entity_type text not null check (entity_type in ('quote', 'invoice')),
  entity_id uuid not null,

  template_key text not null,
  -- LE RANG, repris de email_messages.occurrence : 1 est le premier
  -- envoi, donc une relance commence à 2.
  occurrence integer not null check (occurrence between 2 and 10),

  -- Le client final à qui la relance s'adresse. email_enqueue le prend
  -- et va lire l'adresse en base : elle ne transite pas ici.
  customer_id uuid references public.crm_customers (id) on delete cascade,

  -- LE FAIT DATÉ QUI A DÉCLENCHÉ LE CALCUL, et la date à laquelle la
  -- relance est due. 0084 le note ligne 359 et c'est la bonne
  -- discipline : « l'idempotence s'accroche au FAIT DATÉ, pas au
  -- statut : un statut se change, un fait daté non ».
  reference_on date not null,
  due_on date not null,

  created_at timestamptz not null default now(),

  claimed_at timestamptz,
  claimed_by text,
  done_at timestamptz,
  email_message_id uuid references public.email_messages (id) on delete set null,

  -- COMBIEN DE FOIS CETTE LIGNE A ÉTÉ RÉSERVÉE. Une ligne qui tourne en
  -- rond — réservée, abandonnée, reprise, abandonnée — ne se voyait
  -- nulle part. Voir la péremption de réservation au § 9.b.
  claim_count integer not null default 0 check (claim_count >= 0),

  cancelled_at timestamptz,
  cancelled_reason text,

  -- L'IDEMPOTENCE, TENUE PAR LA BASE. Deux exécutions simultanées de la
  -- tâche atteindraient toutes les deux le même « pas encore déposé » ;
  -- c'est la contrainte qui tranche, pas la lecture.
  constraint relances_planifiees_unicite
    unique (organization_id, entity_type, entity_id, template_key, occurrence)
);

-- Pour le cas où une version antérieure de ce fichier aurait déjà posé
-- la table : `create table if not exists` n'ajoute pas de colonne.
alter table public.relances_planifiees
  add column if not exists claim_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'relances_planifiees_claim_count_positif') then
    alter table public.relances_planifiees add constraint relances_planifiees_claim_count_positif
      check (claim_count >= 0);
  end if;
end $$;

-- L'INDEX NE PEUT PLUS EXCLURE LES LIGNES RÉSERVÉES.
--
-- Il excluait `claimed_at is not null`, exactement comme la clause
-- `where` de relances_a_expedier — donc une ligne réservée par un
-- passage qui meurt ensuite sortait de l'index ET de la requête, pour
-- toujours. Voir le § 9.b : la réservation PÉRIME maintenant, et
-- l'index doit rester utile pour ces lignes-là.
--
-- `now()` n'étant pas immuable, la péremption ne peut pas vivre dans le
-- prédicat de l'index. On indexe donc claimed_at avec le reste et on
-- laisse le planificateur filtrer : la table est petite, et une file
-- qui déborde est un incident, pas un régime de croisière.
drop index if exists public.relances_planifiees_a_faire_idx;
create index if not exists relances_planifiees_a_faire_idx
  on public.relances_planifiees (due_on, created_at, claimed_at)
  where done_at is null and cancelled_at is null;

alter table public.relances_planifiees enable row level security;

-- L'entreprise voit ce qui va partir en son nom. C'est la contrepartie
-- de « les relances sont désactivées par défaut » : quand elle les
-- active, elle doit pouvoir regarder.
drop policy if exists "L'entreprise voit ses relances planifiées" on public.relances_planifiees;
create policy "L'entreprise voit ses relances planifiées" on public.relances_planifiees
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('emails.log.read')
  );

comment on table public.relances_planifiees is
  'CE QUI EST DÛ, pas ce qui est parti. Le journal d''envoi est email_messages (0084) et il reste '
  'la seule vérité sur ce qu''un client a reçu. Cette file est l''étage au-dessus : la tâche y dépose, '
  'la fonction Edge y puise, rend le gabarit et appelle email_enqueue().';

-- ------------------------------------------------------------
-- 9.a LE CALCUL
-- ------------------------------------------------------------
-- Pour chaque entreprise qui a ACTIVÉ les relances :
--   • les devis envoyés depuis plus de N jours et sans décision ;
--   • les factures émises, échues, dont le solde restant est positif.
-- Le rang se déduit du nombre de relances DÉJÀ AU JOURNAL pour ce
-- couple (objet, gabarit) — le journal de 0084, pas cette file : ce qui
-- compte est ce que le client a reçu, pas ce qu'on avait prévu.
create or replace function public.relances_calculer(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  v_pose integer;
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : le calcul des relances est un traitement de la machine.'
      using errcode = '42501';
  end if;

  -- La même borne qu'au § 5, et pour la même raison : on ne relance pas
  -- au nom d'un jour qui n'est pas arrivé.
  if p_today > current_date then
    raise exception 'Les relances ne se calculent pas pour un jour qui n''est pas arrivé : %.',
      to_char(p_today, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('oasis.relances'));

  -- ------------------------------------------------------------
  -- LA CADENCE S'ANCRE SUR LE DERNIER FAIT DATÉ, PAS SUR LE PREMIER.
  -- C'ÉTAIT LE DÉFAUT LE PLUS VISIBLE POUR UN CLIENT.
  -- ------------------------------------------------------------
  --
  -- L'échéance de CHAQUE rang était calculée depuis sent_at, un point
  -- fixe : `sent_on + (deja + 1) × delai`. Dès qu'un devis était plus
  -- vieux que reminder_max × delai, TOUTE l'échelle était déjà échue :
  -- le rang 2 partait, le journal montait à 1, le passage suivant
  -- trouvait aussitôt le rang 3 échu, et ainsi de suite. Un rang par
  -- passage, donc UN PAR JOUR.
  --
  -- Trois relances en trois jours au lieu de trois semaines. Et ce
  -- n'était pas un cas de bord : c'est l'état NORMAL de tout le
  -- portefeuille le jour où une entreprise active les relances, et de
  -- tout le parc au redémarrage après un arrêt de l'ordonnanceur.
  -- Mesuré sur 31 tours de boucle : un devis frais donnait 7/14/21, un
  -- devis de soixante jours donnait 0/1/2.
  --
  -- LA CORRECTION : l'échéance part du PLUS RÉCENT des deux faits
  -- datés — l'envoi initial, ou la dernière relance réellement partie.
  -- C'est la discipline que 0084 recommande ligne 359 (« l'idempotence
  -- s'accroche au FAIT DATÉ, pas au statut »), simplement accrochée au
  -- bon fait daté. Le rang, lui, ne change pas.
  --
  -- ------------------------------------------------------------
  -- ET UN COURRIEL QUI A REBONDI NE COMPTE PLUS COMME UNE RELANCE.
  -- ------------------------------------------------------------
  -- Le décompte retenait tout message dont le statut n'était pas
  -- « cancelled » — donc « bounced », « failed », « blocked » et
  -- « complained » compris. Le client dont l'adresse est mauvaise n'a
  -- rien reçu, mais son rang avançait quand même : il consommait un des
  -- reminder_max créneaux. Sur le défaut de 0084 (deux relances), deux
  -- rebonds épuisaient silencieusement toutes les relances d'un devis.
  -- On ne compte donc que ce qui a une chance d'avoir été lu.
  with candidats as (
    select
      q.organization_id,
      q.id as quote_id,
      q.customer_id,
      q.sent_at::date as sent_on,
      s.reminder_delay_days,
      s.reminder_max,
      -- Ce qui est DÉJÀ PARTI, lu dans le journal de 0084.
      coalesce((
        select count(*) from public.email_messages m
        where m.organization_id = q.organization_id
          and m.entity_type = 'quote' and m.entity_id = q.id
          and m.template_key = 'devisRelance'
          and m.status in ('queued', 'sending', 'sent', 'deferred', 'delivered')
      ), 0)::integer as deja,
      -- ET QUAND la dernière est partie : c'est elle qui porte la
      -- cadence, pas l'envoi initial.
      (
        select max(coalesce(m.sent_at, m.queued_at))::date
        from public.email_messages m
        where m.organization_id = q.organization_id
          and m.entity_type = 'quote' and m.entity_id = q.id
          and m.template_key = 'devisRelance'
          and m.status in ('queued', 'sending', 'sent', 'deferred', 'delivered')
      ) as dernier_le
    from public.quotes q
    join public.email_organization_settings s on s.organization_id = q.organization_id
    where s.reminders_enabled
      and s.suspended_at is null
      and q.sent_at is not null
      and q.decided_at is null
      and q.archived_at is null
      and q.status not in ('draft', 'internalReview', 'accepted', 'rejected', 'expired', 'cancelled')
      and (q.valid_until is null or q.valid_until >= p_today)
  ),
  dus as (
    select c.*,
           (c.deja + 2)::integer as rang,
           (greatest(c.sent_on, coalesce(c.dernier_le, c.sent_on))
              + c.reminder_delay_days)::date as echeance
    from candidats c
    where c.deja < c.reminder_max
  )
  insert into public.relances_planifiees
    (organization_id, entity_type, entity_id, template_key, occurrence,
     customer_id, reference_on, due_on)
  select d.organization_id, 'quote', d.quote_id, 'devisRelance', d.rang,
         d.customer_id, d.sent_on, d.echeance
  from dus d
  where d.echeance <= p_today
    and d.rang between 2 and 10
  -- LA CLÉ DE L'IDEMPOTENCE. Rejouer la tâche ne dépose rien de plus :
  -- ce n'est pas un contrôle, c'est un index unique.
  on conflict (organization_id, entity_type, entity_id, template_key, occurrence) do nothing;

  get diagnostics v_pose = row_count;
  v_n := v_n + v_pose;

  -- ---- LES FACTURES IMPAYÉES ----------------------------------
  with candidats as (
    select
      i.organization_id,
      i.id as invoice_id,
      i.customer_id,
      i.due_on as echue_le,
      s.reminder_delay_days,
      s.reminder_max,
      -- Mêmes deux corrections qu'à la branche des devis : on ne compte
      -- que ce qui a pu être lu, et la cadence part du dernier envoi.
      coalesce((
        select count(*) from public.email_messages m
        where m.organization_id = i.organization_id
          and m.entity_type = 'invoice' and m.entity_id = i.id
          and m.template_key = 'factureRelance'
          and m.status in ('queued', 'sending', 'sent', 'deferred', 'delivered')
      ), 0)::integer as deja,
      (
        select max(coalesce(m.sent_at, m.queued_at))::date
        from public.email_messages m
        where m.organization_id = i.organization_id
          and m.entity_type = 'invoice' and m.entity_id = i.id
          and m.template_key = 'factureRelance'
          and m.status in ('queued', 'sending', 'sent', 'deferred', 'delivered')
      ) as dernier_le
    from public.invoices i
    join public.email_organization_settings s on s.organization_id = i.organization_id
    join public.invoice_balance b on b.invoice_id = i.id
    where s.reminders_enabled
      and s.suspended_at is null
      and i.issued_at is not null
      and i.archived_at is null
      and i.status not in ('cancelled', 'paid', 'credited')
      and i.due_on is not null
      and i.due_on < p_today
      -- LE SOLDE RESTANT, ET JAMAIS « || 0 » DERRIÈRE UN MONTANT
      -- INCONNU : un solde qu'on ne sait pas calculer n'est pas zéro,
      -- et relancer sur un montant inventé serait pire que se taire.
      and b.outstanding_cents is not null
      and b.outstanding_cents > 0
  ),
  dus as (
    select c.*,
           (c.deja + 2)::integer as rang,
           (greatest(c.echue_le, coalesce(c.dernier_le, c.echue_le))
              + c.reminder_delay_days)::date as echeance
    from candidats c
    where c.deja < c.reminder_max
  )
  insert into public.relances_planifiees
    (organization_id, entity_type, entity_id, template_key, occurrence,
     customer_id, reference_on, due_on)
  select d.organization_id, 'invoice', d.invoice_id, 'factureRelance', d.rang,
         d.customer_id, d.echue_le, d.echeance
  from dus d
  where d.echeance <= p_today
    and d.rang between 2 and 10
  on conflict (organization_id, entity_type, entity_id, template_key, occurrence) do nothing;

  get diagnostics v_pose = row_count;
  v_n := v_n + v_pose;

  insert into public.saas_machine_events (kind, details)
  values ('relances.calculees', jsonb_build_object('jour', p_today, 'deposees', v_n));

  return v_n;
end;
$$;

comment on function public.relances_calculer(date) is
  'Calcule ce qui est dû et le DÉPOSE dans relances_planifiees. Elle n''appelle personne : ni '
  'transporteur, ni prestataire. Rejouée deux fois, elle ne dépose qu''une relance par objet et par '
  'rang — c''est une contrainte d''unicité qui le garantit, pas un « si déjà fait » que deux '
  'exécutions simultanées franchiraient toutes les deux.';

-- ------------------------------------------------------------
-- 9.b LA RÉSERVATION, SUR LE MODÈLE DE email_claim_queued
-- ------------------------------------------------------------
-- `for update skip locked` : deux passages simultanés ne se marchent
-- pas dessus, le second saute les lignes déjà prises.
--
-- ------------------------------------------------------------
-- ET LA RÉSERVATION PÉRIME AU BOUT D'UNE HEURE. C'ÉTAIT UNE FUITE.
-- ------------------------------------------------------------
--
-- La requête ne choisissait que `claimed_at is null`, et il n'existe
-- aucune fonction qui rende une ligne réservée SANS la terminer :
-- relance_marquer_faite pose done_at ou cancelled_at. Une ligne
-- réservée par un passage qui meurt ensuite — la fonction Edge tuée en
-- plein vol, un délai d'exécution dépassé — n'était donc JAMAIS
-- reprise, par personne, et rien ne le signalait. Le calcul ne la
-- remplaçait pas non plus : l'index unique refuse le doublon. Le rang
-- était consommé sans qu'aucun courriel ne parte.
--
-- POURQUOI LE REJEU EST SÛR. Il y a un troisième étage d'idempotence,
-- et il est en dessous de celui-ci : email_messages.idempotency_key est
-- une colonne GÉNÉRÉE sous contrainte unique (0084). Une ligne reprise
-- après une expédition qui avait en fait abouti ressort donc en
-- « déjà envoyé » — la seconde insertion viole l'unicité — et aucun
-- second courriel ne part. La péremption ne peut pas faire de doublon.
--
-- UNE HEURE, et pas dix minutes : une file qui met vingt minutes à se
-- vider est lente, pas cassée, et reprendre une ligne encore en cours
-- de traitement ferait tourner deux expéditeurs sur le même message.
create or replace function public.relances_a_expedier(
  p_limit integer default 50,
  p_worker text default null
)
returns table (
  id uuid,
  organization_id uuid,
  entity_type text,
  entity_id uuid,
  template_key text,
  occurrence integer,
  customer_id uuid,
  reference_on date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : la file des relances est réservée à la machine.'
      using errcode = '42501';
  end if;

  return query
  update public.relances_planifiees r
     set claimed_at = now(),
         claimed_by = nullif(btrim(coalesce(p_worker, '')), ''),
         claim_count = r.claim_count + 1
   where r.id in (
     select r2.id from public.relances_planifiees r2
      where r2.done_at is null and r2.cancelled_at is null
        and (r2.claimed_at is null or r2.claimed_at < now() - interval '1 hour')
        and r2.due_on <= current_date
        -- UNE LIGNE QUI TOURNE EN ROND FINIT PAR SORTIR DE LA FILE.
        -- Cinq reprises sans aboutir, c'est une relance qui ne partira
        -- jamais : la garder en tête de file empêcherait les autres de
        -- passer et masquerait le vrai problème.
        and r2.claim_count < 5
      order by r2.due_on, r2.created_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 50), 200))
   )
  returning r.id, r.organization_id, r.entity_type, r.entity_id,
            r.template_key, r.occurrence, r.customer_id, r.reference_on;
end;
$$;

create or replace function public.relance_marquer_faite(
  p_id uuid,
  p_email_message_id uuid default null,
  p_motif_abandon text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : la file des relances est réservée à la machine.'
      using errcode = '42501';
  end if;

  -- Un abandon MOTIVÉ (la porte email_gate() a refusé, l'adresse est en
  -- liste de suppression, le client a répondu entre-temps) n'est pas un
  -- échec technique : il se range dans la même colonne, avec sa raison.
  update public.relances_planifiees
     set done_at = case when p_motif_abandon is null then now() end,
         cancelled_at = case when p_motif_abandon is not null then now() end,
         cancelled_reason = public.ai_clean_text(p_motif_abandon, 300),
         email_message_id = p_email_message_id,
         claimed_at = null
   where id = p_id and done_at is null and cancelled_at is null;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;


-- ============================================================
-- 10. L'ORDONNANCEUR — pg_cron S'IL EST LÀ, ET UN AVIS SINON
-- ============================================================
--
-- ÉTAT MESURÉ SUR CE PROJET LE 6 SEPTEMBRE 2026 : pg_cron 1.6.4 et
-- pg_net 0.20.4 sont INSTALLÉES ; supabase_vault 0.3.1 est installée et
-- VIDE ; cron.job contient zéro tâche.
--
-- ATTENTION, CE PARAGRAPHE A CHANGÉ DE SENS DEPUIS SA PREMIÈRE
-- RÉDACTION. Il annonçait « disponibles mais non installées », ce qui
-- n'est plus vrai : le dirigeant les a activées entre-temps. Le bloc
-- gardé n'émettra donc plus son avis — il PLANIFIERA.
--
-- CE FICHIER N'INSTALLE TOUJOURS PAS LES EXTENSIONS — voir l'en-tête
-- pour les trois raisons. Il planifie SI l'extension est là, et il le
-- DIT sinon. Le bloc est idempotent : un `cron.unschedule` précède
-- chaque `cron.schedule` sur le même nom de tâche.
--
-- ------------------------------------------------------------
-- LES DEUX TÂCHES SONT POSÉES **DÉSACTIVÉES**, ET C'EST DÉLIBÉRÉ.
-- ------------------------------------------------------------
--
-- Sans cela, appliquer cette migration à 18 h ferait facturer TOUT LE
-- PARC à 03h15 le lendemain matin et relancer tous les clients à
-- 06h30 — la toute première nuit, sur des données que personne n'a
-- encore relues. Ce n'est pas ce que la lecture de ce fichier laisse
-- attendre, et une première nuit doit être CHOISIE, pas subie.
--
-- Les tâches existent donc, à la bonne heure, avec la bonne commande,
-- et elles ne partiront que lorsque quelqu'un les armera :
--
--     update cron.job set active = true where jobname like 'oasis-%';
--
-- La notice docs/ordonnanceur-facturation.md décrit le geste, ce qu'il
-- faut vérifier avant, et comment tout arrêter en urgence.
--
-- LE PIÈGE À NE PAS COMMETTRE, ET IL EST NOMMÉ POUR ÊTRE ÉVITÉ.
-- Le motif habituel écrit la tâche comme un appel HTTP portant la clé
-- de service EN CLAIR dans sa définition. Cette définition vit dans
-- cron.job.command, une table lisible en base : la clé la plus
-- puissante du projet se retrouverait rangée à côté des données
-- qu'elle protège.
--
-- LES DEUX TÂCHES CI-DESSOUS N'APPELLENT PERSONNE. Elles exécutent une
-- fonction SQL qui calcule et écrit, point. Aucun secret n'entre donc
-- dans cron.job — et c'est aussi pourquoi pg_net n'est pas nécessaire à
-- ce chantier.
--
-- LE VIDAGE DES FILES — expédier les relances, interroger VIES —
-- demande un appel sortant, et il se déclenche depuis le PLANIFICATEUR
-- DE FONCTIONS EDGE de Supabase, qui n'a besoin ni de pg_net ni de
-- Vault. C'est la voie sûre : aucune clé ne descend en base.
-- La notice docs/ décrit le geste.
do $$
declare
  v_job_facturation bigint;
  v_job_relances bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Le nom de la tâche est la clé d'idempotence : on retire avant de
    -- poser, sans quoi rejouer ce fichier créerait des doublons qui
    -- factureraient deux fois.
    begin
      perform cron.unschedule('oasis-cycle-facturation');
    exception when others then null;
    end;
    begin
      perform cron.unschedule('oasis-relances');
    exception when others then null;
    end;

    -- 03h15 UTC : après minuit à Paris en toute saison, et hors du
    -- créneau où les sauvegardes tournent.
    select cron.schedule('oasis-cycle-facturation', '15 3 * * *',
      $cron$select public.saas_run_billing_cycle();$cron$) into v_job_facturation;

    -- 06h30 UTC : les relances partent le matin, jamais la nuit. Un
    -- client qui reçoit une relance à 3 h du matin la lit comme une
    -- machine, et c'est exactement ce qu'on veut éviter.
    --
    -- ELLE APPELLE AUSSI LA VEILLE (§ 5.c), ET C'EST TOUT L'INTÉRÊT
    -- D'AVOIR DEUX TÂCHES : les traces de la facturation vivent dans la
    -- transaction de la facturation, donc une nuit qui échoue efface sa
    -- propre trace. C'est l'AUTRE tâche, trois heures plus tard, qui
    -- constate l'absence et écrit l'alerte — depuis sa propre
    -- transaction, qui survit.
    select cron.schedule('oasis-relances', '30 6 * * *',
      $cron$select public.saas_ordonnanceur_sante(); select public.relances_calculer();$cron$) into v_job_relances;

    -- LES DEUX TÂCHES SONT ARMÉES PAR UN HUMAIN, PAS PAR CE FICHIER.
    -- Voir l'explication ci-dessus : la première nuit doit être
    -- choisie. `cron.schedule` les pose actives ; on les désarme
    -- aussitôt, dans la même transaction.
    --
    -- PAR cron.alter_job ET NON PAR UN `update` SUR cron.job : la table
    -- n'est pas modifiable directement, même par le propriétaire de la
    -- base (« permission denied for table job », mesuré). C'est
    -- l'interface prévue par l'extension, et elle vérifie que la tâche
    -- vous appartient.
    perform cron.alter_job(v_job_facturation, active := false);
    perform cron.alter_job(v_job_relances, active := false);

    raise notice 'Tâches posées mais DÉSACTIVÉES : oasis-cycle-facturation (03h15 UTC) et oasis-relances (06h30 UTC). Rien ne partira tant que personne ne les aura armées. Le geste, et ce qu''il faut vérifier avant : docs/ordonnanceur-facturation.md.';
  else
    raise notice 'pg_cron n''est PAS installée : les fonctions saas_run_billing_cycle() et relances_calculer() sont posées mais RIEN NE LES APPELLE. Activez l''extension (Dashboard Supabase, Database, Extensions), puis rejouez ce seul bloc — il est idempotent. Voir docs/ordonnanceur-facturation.md.';
  end if;
end $$;


-- ============================================================
-- 11. LES DROITS — QUI PEUT APPELER QUOI
-- ============================================================
--
-- LES `grant` PAR DÉFAUT DE SUPABASE ACCORDENT L'EXÉCUTION À TOUT LE
-- MONDE SUR TOUTE FONCTION CRÉÉE DANS `public`. C'est là que 0055 s'est
-- fait avoir. On révoque d'abord, on accorde ensuite, et le test le
-- vérifie par requête plutôt que par confiance.

-- ------------------------------------------------------------
-- 11.a CE QU'UN COMPTE CONNECTÉ PEUT APPELER
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.saas_date_anniversaire(date, integer, smallint)',
    'public.saas_engagement_start_on(uuid)',
    'public.saas_vat_number_fr_valide(text)',
    'public.saas_vies_enqueue(uuid)',
    'public.admin_clear_vies_result(uuid, text)',
    'public.partager_devis(uuid)',
    'public.revoquer_partage_devis(uuid, text)',
    -- 0089 remplace ces trois fonctions de 0081 ; un `create or replace`
    -- conserve les droits, mais `saas_generate_invoices` a été DÉPOSÉE
    -- et recréée avec un paramètre de plus : ses droits, eux, sont
    -- partis avec elle. On les repose tous les trois plutôt que le
    -- seul qui manque — une liste explicite se relit, une exception
    -- s'oublie.
    'public.saas_subscription_billing_lines(uuid, date, date)',
    'public.saas_issue_invoice(uuid, text)',
    'public.saas_generate_invoices(text, date, date, text, boolean, uuid)',
    -- L'état de l'ordonnanceur : la fonction porte SA PROPRE garde
    -- (administrateur de plateforme ou machine), donc l'accorder à
    -- `authenticated` n'ouvre rien — c'est le motif habituel du dépôt.
    'public.saas_ordonnanceur_sante()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 11.b LA SEULE PORTE ANONYME DE CE FICHIER
-- ------------------------------------------------------------
-- Sur le modèle d'email_unsubscribe (0084 § 15.b). Elle est sûre parce
-- qu'elle ne rend que ce que le § 8.d liste, colonne par colonne, et
-- qu'elle n'ouvre aucune session.
revoke all on function public.devis_par_jeton(text) from public;
grant execute on function public.devis_par_jeton(text) to anon;
grant execute on function public.devis_par_jeton(text) to authenticated;

-- Le signal de saturation : un seul booléen, aucune donnée. La route
-- publique tourne sans session ; sans ce `grant`, elle ne pourrait pas
-- savoir qu'il faut refuser au bord.
revoke all on function public.document_share_sous_attaque() from public;
grant execute on function public.document_share_sous_attaque() to anon;
grant execute on function public.document_share_sous_attaque() to authenticated;

-- ------------------------------------------------------------
-- 11.c LES FONCTIONS DE LA MACHINE — `service_role` SEUL
-- ------------------------------------------------------------
-- Accordées EXPLICITEMENT plutôt qu'en comptant sur le défaut de
-- Supabase : un défaut peut changer, une intention écrite se relit.
-- Et le rappel de 0075 vaut ici aussi — posséder la clé n'est pas être
-- autorisé : chacune de ces fonctions REFAIT le contrôle à l'intérieur
-- avec saas_contexte_machine().
do $$
declare
  f text;
  v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  foreach f in array array[
    'public.saas_start_subscription(uuid, text, text, boolean, text, text, text, boolean, text, date, smallint, integer)',
    'public.saas_run_billing_cycle(date)',
    'public.saas_vies_pending(integer)',
    'public.saas_vies_record_result(uuid, text, text, text, text)',
    'public.relances_calculer(date)',
    'public.relances_a_expedier(integer, text)',
    'public.relance_marquer_faite(uuid, uuid, text)'
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

-- ------------------------------------------------------------
-- 11.d CE QUE PERSONNE N'APPELLE
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.document_share_note_echec(timestamptz)',
    'public.saas_machine_events_append_only()',
    'public.organization_subscriptions_sync_period()',
    'public.subscription_discounts_trial_guard()',
    'public.saas_tax_profile_vies_guard()',
    'public.business_organizations_vat_changed()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 11.e LES TABLES NEUVES
-- ------------------------------------------------------------
-- Aucune n'est écrite depuis un navigateur. La RLS pose la lecture ;
-- l'écriture passe par les fonctions ci-dessus, et par elles seules.
do $$
declare t text;
begin
  foreach t in array array[
    'saas_machine_events',
    'document_share_links',
    'document_share_openings',
    'document_share_attempts',
    'relances_planifiees'
  ]
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from public', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- AUCUNE PERMISSION NOUVELLE DANS LA MATRICE, ET C'EST DÉLIBÉRÉ.
-- Le piège de 0075 § 1.c — une permission insérée après coup n'est
-- portée par personne, l'écran disparaît du menu sans un mot, et le
-- piège a déjà mordu trois fois — ne peut pas mordre ici : ce fichier
-- réutilise `billing.invoices.read`, `billing.invoices.write` et
-- `emails.log.read`, qui sont déjà distribuées.


-- ============================================================
-- 12. CE QUI RESTE À TRANCHER, ET QUI N'EST PAS DU CODE
-- ============================================================
--
--   • L'AMBIGUÏTÉ DU DIRIGEANT. « Il paie le premier mois direct » et
--     « essai gratuit un mois » ont été lus comme deux chemins
--     distincts. À confirmer — c'est de l'argent, et la lecture
--     inverse (pas d'essai du tout) se règle en passant
--     p_with_trial => false, sans une ligne de migration.
--
--   • LA DURÉE DE L'ESSAI EST FIXÉE À UN MOIS DANS LE CODE de
--     saas_start_subscription. Le jour où elle deviendra un réglage
--     commercial, elle ira dans organization_plans — pas dans une
--     variable d'environnement, où elle serait invisible à la base qui
--     la fait respecter.
--
--   • LA RELANCE APRÈS UN PRÉLÈVEMENT REFUSÉ. Le statut 'pastDue'
--     existe dans la contrainte de 0081 et personne ne le pose. Ce
--     fichier ne le pose pas non plus : décider au bout de combien
--     d'échecs on suspend un abonnement — et si l'on suspend — est une
--     décision commerciale. Aujourd'hui l'impayé s'ajoute simplement à
--     ce qui est dû, et 0081 l'assume : « un impayé ne suspend pas
--     l'abonnement ».
--
--   • L'ACCEPTATION DU DEVIS PAR JETON. La porte est en lecture seule.
--     Ouvrir « J'accepte » sans compte engage contractuellement
--     quelqu'un qu'on n'a pas identifié : c'est une décision juridique
--     avant d'être technique.
--
--   • LA FACTURE PAR JETON. Non ouverte : une facture porte un IBAN, et
--     un IBAN sur une page publique est une invitation à la fraude au
--     virement.
--
--   • 0088 N'EST PAS REVU, ET C'EST UNE DÉCISION, PAS UN OUBLI.
--     Ce paragraphe annonçait le contraire ; il a été corrigé après
--     mesure, et voici pourquoi.
--
--     0088 interdit à l'IA de dire autre chose que « personne n'a
--     marqué ce devis comme vu ». Le § 8 semble lui donner un vrai
--     accusé de lecture — mais document_share_openings compte des
--     OUVERTURES, pas des lectures. Un lien envoyé par courriel est
--     ouvert par les analyseurs de sécurité et les pré-chargeurs de
--     messagerie À LA LIVRAISON, avant que le client n'ait rien vu, et
--     la table ne porte que (lien, date) : rien ne les distingue d'un
--     humain — c'est un choix de vie privée qu'on ne revient pas
--     dessus.
--
--     Remplacer une phrase prudente et VRAIE par une phrase confiante
--     et PARFOIS FAUSSE serait un mauvais échange, d'autant qu'un
--     paysagiste décide d'appeler ou non son client là-dessus. La règle
--     retenue est donc une règle de VOCABULAIRE, appliquée à l'écran et
--     documentée sur la table : « ouvert 3 fois, la première le … »,
--     jamais « votre client a lu le devis ».
--
--     Le jour où l'ouverture sera confirmée depuis le navigateur — un
--     analyseur de courriel n'exécute pas de JavaScript —, la limite de
--     0088 pourra bouger. Pas avant.
--
--   • LA CLÉ DE SERVICE DANS VAULT. Elle se dépose À LA MAIN, une fois,
--     par le dirigeant. Aucune migration ne doit la porter. La notice
--     docs/ordonnanceur-facturation.md décrit le geste — et la voie
--     recommandée (le planificateur de fonctions Edge) n'en a même pas
--     besoin.
--
--   • LES DEUX TÂCHES SONT POSÉES DÉSACTIVÉES (§ 10). pg_cron est
--     INSTALLÉE sur ce projet — mesuré le 6 septembre 2026, contre ce
--     que la première rédaction affirmait — donc appliquer ce fichier
--     à 18 h ferait facturer tout le parc à 03h15. La première nuit se
--     choisit : un humain arme les tâches quand il a relu le tour
--     d'essai. Le geste est dans la notice.
--
--   • LE NOMBRE DE SIÈGES VIENT DE LA CAISSE, PAS D'UN RECOMPTAGE
--     (§ 4). C'est ce qui a été encaissé qui est facturé, parce que le
--     rapprochement du webhook se fait au montant EXACT. Quand le
--     compte en base diffère, l'écart est journalisé
--     (subscription.seatMismatch) et se règle à l'échéance suivante.
--     Décider s'il faut le régulariser par un avoir, ou l'ignorer, est
--     une décision commerciale.
