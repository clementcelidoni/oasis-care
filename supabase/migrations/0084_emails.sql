-- Oasis Care — LE COURRIER SORTANT (migration 0084).
--
-- ============================================================
-- CE QUE CE FICHIER POSE, ET CE QU'IL REFUSE DE POSER
-- ============================================================
--
-- Le produit doit expédier des devis, des factures, des relances, des
-- invitations, des messages de service et — depuis Oasis Admin
-- seulement — de la publicité. Rien de tout cela n'existe en base
-- aujourd'hui : ni journal, ni consentement, ni liste de suppression,
-- ni le moindre garde-fou. Ce fichier pose LA BASE, et rien d'autre.
--
-- IL NE NOMME AUCUN TRANSPORTEUR. Pas une fois. Le code dira « envoie
-- ce message à ce destinataire » ; qui le transporte est un réglage
-- posé côté serveur, et la base se contente d'enregistrer, APRÈS COUP,
-- le nom que l'implémentation lui déclare (`transporter_key`, texte
-- libre, sans valeur par défaut et sans contrainte de liste). Écrire
-- ici le nom du prestataire du jour, ne serait-ce qu'en valeur par
-- défaut, reviendrait à le graver dans le schéma — c'est-à-dire à
-- rendre coûteux exactement ce que l'interface est censée rendre
-- indolore.
--
-- ============================================================
-- LA DISTINCTION QUI COMMANDE TOUT LE FICHIER
-- ============================================================
--
-- TRANSACTIONNEL et PUBLICITÉ ne sont pas deux réglages du même objet.
-- Ce sont deux natures de courrier, avec deux régimes juridiques.
--
--   • TRANSACTIONNEL — un devis, une facture, une relance, une
--     invitation, un changement de paramètre. Le destinataire l'a
--     appelé par son propre acte. Pas de lien de désabonnement, et le
--     message DOIT partir même si la personne s'est désabonnée de la
--     publicité.
--
--   • PUBLICITÉ — une nouveauté, une offre. Consentement PRÉALABLE,
--     lien de désabonnement dans CHAQUE message, et un désabonnement
--     qui vaut pour tous les envois futurs, sans exception ni délai.
--
-- LE DÉFAUT À NE JAMAIS COMMETTRE, celui qu'on ne voit pas en test et
-- qui est catastrophique en production : qu'un désabonnement de la
-- publicité empêche une facture d'arriver. Le client ne reçoit plus ses
-- factures, et personne ne sait pourquoi.
--
-- CE FICHIER LE REND STRUCTURELLEMENT IMPOSSIBLE, plutôt que
-- simplement interdit :
--
--   1. `email_consents.nature` porte une contrainte `check (nature =
--      'publicite')`. Le registre de consentement est LITTÉRALEMENT
--      incapable de contenir une ligne qui parlerait d'autre chose que
--      de publicité. Il n'y a donc aucune ligne qu'une requête, même
--      mal écrite, pourrait trouver et opposer à une facture.
--   2. `email_gate()` ne consulte le registre QUE dans une branche
--      `if v_nature = 'publicite'`. La branche transactionnelle ne le
--      lit pas : il n'y a pas de code à corriger, il n'y a pas de code.
--   3. La liste de suppression ne bloque JAMAIS le transactionnel — voir
--      le § 3, où ce choix est argumenté plutôt que subi.
--
-- ============================================================
-- QUI ÉCRIT À QUI — LE MOTIF CRM, POSÉ EN BASE
-- ============================================================
--
-- L'expéditeur technique reste le domaine authentifié d'Oasis Care :
-- c'est lui qui porte SPF, DKIM et DMARC, et un paysagiste n'aura
-- jamais authentifié le sien. Le NOM AFFICHÉ est celui de son
-- entreprise, et le « RÉPONDRE À » pointe SON adresse — sans quoi le
-- client répond « d'accord pour le devis » et la réponse tombe dans une
-- boîte que personne ne lit, ce qui rend la fonctionnalité pire
-- qu'inutile.
--
-- LE NOM AFFICHÉ ET L'ADRESSE DE RÉPONSE NE SONT PAS DES PARAMÈTRES DE
-- `email_enqueue()`. Ils sont LUS EN BASE sur l'organisation vérifiée,
-- à l'intérieur de la fonction. Un nom d'expéditeur libre au moment de
-- l'envoi serait un outil d'hameçonnage : on écrirait « Votre banque »
-- depuis un domaine authentifié. Il n'y a donc pas de champ à remplir.
--
-- ET LE DESTINATAIRE NON PLUS N'EST PAS UN PARAMÈTRE. `email_enqueue()`
-- ne reçoit pas d'adresse : elle reçoit un `customer_id`, ou rien du
-- tout (auquel cas le destinataire est l'entreprise elle-même), et
-- résout l'adresse en base. Un formulaire qui accepterait une adresse
-- arbitraire ferait du serveur un relais de courrier indésirable, et le
-- domaine serait sur liste noire en une journée. La règle « le
-- destinataire vient de la base » n'est pas une consigne : c'est
-- l'absence du paramètre.
--
-- ============================================================
-- LES GABARITS : DANS LE CODE. LE CATALOGUE : EN BASE.
-- ============================================================
--
-- TRANCHÉ, ET VOICI POURQUOI. Ce produit ne range AUCUN texte
-- d'interface en base : ni les libellés, ni les messages d'erreur, ni
-- les instructions des agents. Tout est en TypeScript, typé, relu,
-- testé. Un gabarit d'e-mail rangé en base serait le seul texte du
-- produit à échapper à la revue et aux tests — et une variable mal
-- écrite (`{{clientt}}`) partirait chez un client sans qu'aucun test ne
-- la voie. Le gain — « modifier un mot sans déployer » — est réel mais
-- mince ; le risque est un devis qui dit « Bonjour {{prenom}} ».
--
-- CE QUI EST EN BASE, c'est le CATALOGUE : la liste des gabarits
-- autorisés, leur nature, leur audience et ce qu'ils exigent. Il y est
-- pour la même raison que `platform_admin_permissions` : ces propriétés
-- doivent être INTERROGEABLES EN SQL, sans quoi les contraintes qui
-- suivent ne seraient que des intentions. C'est ce catalogue qui rend
-- possible la clé de voûte du fichier : la nature d'un message n'est
-- pas choisie par l'appelant, elle est une PROPRIÉTÉ DU GABARIT,
-- imposée par une clé étrangère composite.
--
-- LA SEULE EXCEPTION est le corps d'une CAMPAGNE publicitaire : ce
-- n'est pas un gabarit, c'est du contenu qu'un administrateur rédige.
-- Le gabarit — l'enveloppe, le pied, le lien de désabonnement — reste
-- dans le code ; le texte de l'offre est une donnée.
--
-- ET DANS TOUS LES CAS, LE JOURNAL GARDE CE QUI EST RÉELLEMENT PARTI :
-- la version du gabarit (`template_version`), l'objet et le corps texte
-- rendus, et l'empreinte du corps HTML remis au transporteur. C'est la
-- deuxième question qu'on nous posera — « le client dit que le texte
-- disait autre chose » — et le précédent existe déjà dans ce dépôt :
-- `subscription_commitment_acceptances` recopie le texte de
-- l'engagement au lieu de pointer un document modifiable.
--
-- ============================================================
-- L'IDEMPOTENCE : UNE CONTRAINTE, PAS UN « SI DÉJÀ ENVOYÉ »
-- ============================================================
--
-- Une relance rejouée, un déploiement qui redémarre, deux onglets
-- ouverts : un test applicatif `if (dejaEnvoye)` perd la course, et le
-- client reçoit trois fois sa facture. `email_messages.idempotency_key`
-- est une colonne GÉNÉRÉE — l'appelant ne peut pas l'inventer — et elle
-- porte une contrainte d'UNICITÉ. `email_enqueue()` insère d'abord ;
-- si l'insertion viole l'unicité, le message est déjà parti et la
-- fonction rend la ligne existante en disant `created = false`.
--
-- ============================================================
-- CE QUE CE FICHIER NE FAIT PAS, DÉLIBÉRÉMENT
-- ============================================================
--
--   • AUCUN CHEMIN DE LECTURE ANONYME VERS UN DEVIS OU UNE FACTURE.
--     Tout le portail client de 0055 est verrouillé par `auth.uid()` :
--     un lien « Voir votre devis » tombe aujourd'hui sur un mur de
--     connexion. Ouvrir une porte anonyme sur un document commercial
--     est une décision qui se prend en connaissance de cause, pas qui
--     se glisse dans une migration de plomberie. Le seul jeton
--     anonyme posé ici est celui du DÉSABONNEMENT, qui ne donne accès
--     à rien d'autre qu'à se désabonner (§ 11).
--
--   • AUCUN ORDONNANCEUR. `pg_cron` et `pg_net` sont absents de ce
--     projet, et le commentaire de `refresh_overdue_invoices` l'admet
--     déjà : « Oasis n'en a pas encore. » Les deux RELANCES demandées
--     ne peuvent donc pas partir toutes seules tant qu'un déclencheur
--     périodique n'est pas choisi. Ce fichier pose tout ce qu'il leur
--     faut — le rang de relance (`occurrence`), la cadence par
--     entreprise, l'idempotence — et s'arrête là.
--
--   • AUCUNE SUSPENSION AUTOMATIQUE. La vue de réputation calcule un
--     niveau d'alerte ; elle ne coupe rien. Une coupure automatique
--     arrêterait les FACTURES d'un paysagiste sans que personne ne
--     l'ait décidé, et ce serait le défaut catastrophique par une autre
--     porte. La suspension est un geste humain, motivé et journalisé.


-- ============================================================
-- 0. TROIS PETITES FONCTIONS, UTILISÉES PAR LES CONTRAINTES
-- ============================================================
--
-- POURQUOI DES FONCTIONS ET PAS DES EXPRESSIONS RECOPIÉES : la première
-- est utilisée par sept contraintes de vérification. Recopiée sept
-- fois, elle aurait divergé à la première correction — et la contrainte
-- oubliée serait celle qui laisse passer l'injection.
--
-- CE QU'ELLE REFUSE VRAIMENT, et c'est le point : les retours à la
-- ligne. Une adresse ou un objet contenant un « \r\n » permet d'ajouter
-- des en-têtes au message — un « Bcc: » vers n'importe qui. Les
-- virgules et les points-virgules sont refusés pour la même raison :
-- ils transforment un destinataire en liste.
create or replace function public.email_is_addressable(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_value is not null
     and length(p_value) between 6 and 320
     and p_value ~ '^[^@[:space:],;<>()\[\]\\"]+@[^@[:space:],;<>()\[\]\\"]+\.[^@[:space:],;<>()\[\]\\"]+$';
$$;

comment on function public.email_is_addressable(text) is
  'Vrai si le texte est une adresse expédiable : une seule adresse, sans retour à la ligne, '
  'sans virgule et sans chevrons. Refuse l''injection d''en-tête — un retour à la ligne suivi '
  'de « Bcc: » dans une adresse ajoute un destinataire invisible — autant que les adresses '
  'malformées.';

-- Un texte d'en-tête ne contient jamais de retour à la ligne. Même
-- raison, appliquée à l'objet et au nom affiché.
create or replace function public.email_is_header_safe(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_value is null or p_value !~ '[\r\n]';
$$;

comment on function public.email_is_header_safe(text) is
  'Vrai si le texte peut aller dans un en-tête : pas de retour à la ligne. Un objet qui en '
  'contient un permet d''ajouter des en-têtes arbitraires au message.';

-- La normalisation du destinataire. Une adresse est comparée en
-- minuscules partout — sans quoi « Jean@X.fr » se désabonnerait sans
-- que « jean@x.fr » cesse de recevoir.
create or replace function public.email_normalize(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(lower(btrim(coalesce(p_value, ''))), '');
$$;

comment on function public.email_normalize(text) is
  'Adresse normalisée : minuscules, sans espaces autour, NULL si vide. Toute comparaison '
  'd''adresse passe par elle — « Jean@X.fr » et « jean@x.fr » sont la même personne, et un '
  'désabonnement qui ne le verrait pas ne désabonnerait rien.';

-- Le rang des états d'acheminement. Posée ici parce qu'elle sert au
-- déclencheur d'immuabilité du § 6.a ET à la projection des événements
-- du § 7.a : deux copies auraient divergé, et la divergence aurait fait
-- disparaître un échec de l'écran d'un paysagiste.
create or replace function public.email_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_status
    when 'queued'     then 0
    -- 'sending' EST LA RÉSERVATION, et c'est l'état le plus important
    -- du lot. Sans lui, deux passages d'ordonnanceur qui se
    -- chevauchent relisent la même ligne « queued » et expédient DEUX
    -- FOIS : la contrainte d'unicité ne protège que l'INSERTION, or la
    -- file n'insère rien, elle relit. Le message y entre AVANT l'appel
    -- sortant et n'en ressort que par `email_mark_sent`,
    -- `email_mark_failed` ou une remise en file explicite.
    when 'sending'    then 1
    when 'sent'       then 2
    when 'deferred'   then 3
    when 'delivered'  then 4
    when 'bounced'    then 5
    when 'complained' then 6
    when 'blocked'    then 7
    when 'failed'     then 8
    when 'cancelled'  then 9
    else -1
  end;
$$;


-- ============================================================
-- 1. LE CATALOGUE DES GABARITS
-- ============================================================
--
-- LA CLÉ DE VOÛTE DU FICHIER EST ICI, et elle tient en une contrainte :
-- `unique (key, nature)`. Elle paraît inutile — `key` est déjà clé
-- primaire, donc le couple est trivialement unique. Elle existe pour
-- servir de CIBLE à une clé étrangère composite depuis le journal :
--
--     foreign key (template_key, nature) references email_templates (key, nature)
--
-- Conséquence : un message qui prétendrait être transactionnel en
-- utilisant un gabarit publicitaire est refusé PAR LA BASE. La nature
-- n'est pas un champ que l'appelant remplit, c'est une propriété du
-- gabarit qu'il ne peut que recopier fidèlement.

create table if not exists public.email_templates (
  key text primary key,

  -- Le libellé montré dans les écrans, en français, écrit pour un
  -- paysagiste et non pour un développeur.
  label text not null,

  nature text not null check (nature in ('transactionnel', 'publicite')),

  -- À QUI ce gabarit a le droit de s'adresser.
  --   'clientFinal' — le client du paysagiste.
  --   'entreprise'  — le paysagiste lui-même.
  audience text not null check (audience in ('clientFinal', 'entreprise')),

  -- CE QUI DÉCLENCHE L'ENVOI, écrit en toutes lettres parce que c'est
  -- la frontière que ce chantier doit rendre visible :
  --   'humain'         — quelqu'un a cliqué (le devis passe en « envoyé »).
  --   'changementEtat' — un fait daté vient d'être posé (la facture est
  --                      émise). Légitime, et c'est ce qui est demandé.
  --   'periodique'     — une relance. Aucun ordonnanceur n'existe encore.
  --
  -- ET UNE ABSENCE QUI EST LE SUJET : il n'y a pas de valeur 'ia'. Un
  -- envoi décidé par un MODÈLE ne peut pas être déclaré, donc ne peut
  -- pas exister. L'IA prépare des brouillons, un humain valide — la
  -- règle est déjà en vigueur dans ce produit (0058 § SÉCURITÉ IA :
  -- « aucun outil de ce fichier n'envoie ») et elle est ici traduite
  -- par une énumération qui n'a pas de case pour elle.
  trigger_kind text not null check (trigger_kind in ('humain', 'changementEtat', 'periodique')),

  -- LE VERROU DE CONFORMITÉ. Une facture sans SIRET ni adresse n'est
  -- pas conforme (art. 242 nonies A du CGI), et l'émission est déjà un
  -- acte délibéré et verrouillant : l'y arrêter protège le paysagiste.
  -- Un devis est une proposition commerciale : l'y arrêter le jour où
  -- il en a besoin serait le mauvais arbitrage, et c'est pourquoi cette
  -- colonne existe au lieu d'une règle unique.
  requires_legal_identity boolean not null default false,

  -- Une publicité sans lien de désabonnement est illégale. La colonne
  -- est là pour que le rendu ne puisse pas l'oublier, et la contrainte
  -- plus bas pour qu'on ne puisse pas déclarer le contraire.
  requires_unsubscribe boolean not null default false,

  description text,
  created_at timestamptz not null default now(),

  -- La cible de la clé étrangère composite. Voir le commentaire du § 1.
  constraint email_templates_key_nature_unique unique (key, nature),

  -- UNE PUBLICITÉ NE S'ADRESSE QU'À UNE ENTREPRISE CLIENTE D'OASIS.
  -- Le client final du paysagiste n'a rien signé avec Oasis Care : il
  -- reçoit du transactionnel de la part de son paysagiste, rien
  -- d'autre. La règle est écrite ici, à la source, pour qu'aucun
  -- gabarit publicitaire visant un client final ne puisse même être
  -- déclaré.
  constraint email_templates_publicite_jamais_au_client_final
    check (nature <> 'publicite' or audience = 'entreprise'),

  -- Et la symétrique : une publicité porte toujours son lien de
  -- désabonnement, un transactionnel n'en porte jamais.
  constraint email_templates_desabonnement_coherent
    check (requires_unsubscribe = (nature = 'publicite'))
);

comment on table public.email_templates is
  'Le CATALOGUE des gabarits — pas leur texte, qui vit dans le code TypeScript avec le reste '
  'des textes du produit. Cette table existe pour que la nature, l''audience et les exigences '
  'd''un gabarit soient interrogeables EN SQL : c''est ce qui permet aux contraintes du journal '
  'd''être des contraintes plutôt que des intentions.';

comment on column public.email_templates.nature is
  'Transactionnel ou publicité. Recopiée dans le journal par une clé étrangère composite : '
  'l''appelant ne la choisit pas, il ne peut que la recopier fidèlement.';

insert into public.email_templates
  (key, label, nature, audience, trigger_kind, requires_legal_identity, requires_unsubscribe, description)
values
  ('devisEnvoye', 'Devis envoyé au client', 'transactionnel', 'clientFinal', 'humain',
   false, false,
   'Part quand le paysagiste bascule lui-même le devis en « envoyé ». Geste humain explicite, déjà daté par quotes.sent_at et déjà journalisé.'),

  ('devisRelance', 'Relance d''un devis sans réponse', 'transactionnel', 'clientFinal', 'periodique',
   false, false,
   'Le devis approche de sa date limite sans décision. Aucun ordonnanceur n''existe encore : ce gabarit est déclaré, il n''est pas encore déclenchable.'),

  ('factureEmise', 'Facture émise', 'transactionnel', 'clientFinal', 'changementEtat',
   true, false,
   'Part quand issue_invoice() pose issued_at. L''idempotence s''accroche au FAIT DATÉ, pas au statut : un statut se change, un fait daté non.'),

  ('factureRelance', 'Relance d''une facture impayée', 'transactionnel', 'clientFinal', 'periodique',
   true, false,
   'La facture est échue et le solde restant est positif. Se lit sur invoices.due_on, jamais sur le basculement en « overdue » : refresh_overdue_invoices() n''est appelée que si quelqu''un ouvre l''écran.'),

  ('invitationPortail', 'Invitation au portail client', 'transactionnel', 'clientFinal', 'humain',
   false, false,
   'invite_client_to_portal() fabrique déjà le jeton et le rend à l''appelant, qui n''en fait rien. Ce message est le morceau manquant.'),

  ('bienvenueEntreprise', 'Bienvenue à une nouvelle entreprise', 'transactionnel', 'entreprise', 'changementEtat',
   false, false,
   'Part après onboarding_completed_at. À NE PAS CONFONDRE avec les messages d''authentification, qui partent déjà par le réglage SMTP du projet et qu''il ne faut pas reprendre.'),

  ('parametreImportant', 'Changement de paramètre important', 'transactionnel', 'entreprise', 'humain',
   false, false,
   'Un réglage qui engage l''entreprise a changé. Le fait est déjà journalisé dans audit_events, dont la colonne source distingue l''humain de l''IA.'),

  ('annonceCommerciale', 'Annonce commerciale d''Oasis Care', 'publicite', 'entreprise', 'humain',
   false, true,
   'Le SEUL gabarit publicitaire. Uniquement vers les entreprises clientes d''Oasis Care, jamais vers leurs clients. Exige un consentement préalable enregistré et porte un lien de désabonnement.')
on conflict (key) do nothing;


-- ============================================================
-- 2. LE CONSENTEMENT — ET SON INCAPACITÉ À TOUCHER UNE FACTURE
-- ============================================================
--
-- LA CONTRAINTE LA PLUS IMPORTANTE DE CE FICHIER EST QUELQUES LIGNES
-- PLUS BAS : `check (nature = 'publicite')`.
--
-- Elle a l'air d'une colonne inutile — un seul choix possible. Elle est
-- exactement l'inverse : elle rend le registre de consentement
-- STRUCTURELLEMENT INCAPABLE de contenir une ligne qui parlerait
-- d'autre chose que de publicité. Le bogue classique — « la personne
-- s'est désabonnée, donc on ne lui envoie pas sa facture » — suppose
-- qu'il existe quelque part une ligne « cette personne refuse le
-- courrier » qu'une requête pourrait trouver et opposer à une facture.
-- Ici, cette ligne ne peut pas exister.
--
-- La colonne reste, plutôt que d'être supprimée, parce qu'elle est ce
-- qui rend le refus LISIBLE : quiconque relira cette table verra qu'on
-- a envisagé plusieurs natures et qu'on n'en a autorisé qu'une.

create table if not exists public.email_consents (
  id uuid primary key default gen_random_uuid(),

  -- À QUI APPARTIENT CETTE PERSONNE. `not null` : Oasis Care n'écrit de
  -- publicité qu'à ses propres clients, et une ligne de consentement
  -- sans entreprise serait une adresse venue d'ailleurs.
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  email text not null check (public.email_is_addressable(email)),

  nature text not null default 'publicite' check (nature = 'publicite'),

  -- LE CONSENTEMENT PRÉALABLE. Nul tant qu'il n'a pas été recueilli — et
  -- il ne se présume pas rétroactivement : les entreprises déjà
  -- inscrites n'ont jamais consenti, et `email_gate()` refusera de leur
  -- écrire tant que cette date est vide.
  consented_at timestamptz,
  consent_source text check (consent_source is null or consent_source in (
    'inscription', 'reglagesEntreprise', 'demandeExplicite', 'importManuel'
  )),
  -- CE QU'ON A MONTRÉ À LA PERSONNE, recopié et non pointé. Même raison
  -- que subscription_commitment_acceptances : une référence vers un
  -- texte modifiable rendrait la preuve fausse le jour où le texte
  -- change.
  consent_evidence text,

  unsubscribed_at timestamptz,
  unsubscribe_reason text,

  -- L'OPPOSITION PRÉCÉDENTE, CONSERVÉE.
  --
  -- Un consentement redonné effaçait `unsubscribed_at` : le registre
  -- ne disait plus qu'il y avait eu retrait, et gardait la date du
  -- PREMIER consentement. Or c'est ce registre qui sert de preuve
  -- (art. 7-1 RGPD : le responsable doit pouvoir démontrer que la
  -- personne a consenti — donc quand, et sur quel texte). Une personne
  -- qui consent en 2024, se désabonne en 2025 et revient en 2026 doit
  -- laisser trois faits lisibles, pas un seul réécrit.
  previous_unsubscribed_at timestamptz,
  previous_unsubscribe_reason text,

  -- LE JETON DE DÉSABONNEMENT. Même générateur que
  -- client_invitations.token (0055) : 32 octets aléatoires, jamais
  -- dérivé de l'adresse. Un jeton devinable désabonnerait les autres.
  --
  -- IL N'EXPIRE PAS, ET C'EST DÉLIBÉRÉ. Tous les autres jetons de ce
  -- dépôt expirent ; celui-ci ne le peut pas. Un lien de désabonnement
  -- doit fonctionner sans délai ni condition, y compris dans un message
  -- vieux de deux ans que la personne vient de retrouver. Un jeton
  -- expiré transformerait une obligation légale en page d'erreur. Le
  -- risque est borné par ce que le jeton PERMET : se désabonner, et
  -- rien d'autre (§ 11).
  unsubscribe_token text not null unique default encode(gen_random_bytes(32), 'hex'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_consents_unique unique (organization_id, email, nature),

  -- Une source sans date, ou une date sans source, est un consentement
  -- dont on ne pourra rien dire le jour où on devra le prouver.
  constraint email_consents_consentement_coherent
    check ((consented_at is null) = (consent_source is null))
);

create index if not exists email_consents_email_idx
  on public.email_consents (email);
create index if not exists email_consents_org_idx
  on public.email_consents (organization_id);

comment on table public.email_consents is
  'Le registre de consentement — POUR LA PUBLICITÉ UNIQUEMENT, et la contrainte check '
  '(nature = ''publicite'') en fait une impossibilité structurelle plutôt qu''une règle à '
  'respecter. Aucune ligne de cette table ne peut, même mal interprétée, empêcher une facture '
  'de partir : il n''existe pas de ligne qui parlerait d''autre chose que de publicité.';

comment on column public.email_consents.unsubscribe_token is
  'Jeton opaque de 32 octets. IL N''EXPIRE PAS : un lien de désabonnement doit fonctionner '
  'sans délai ni condition, y compris dans un vieux message. Il ne permet que de se '
  'désabonner — il n''ouvre aucune session et ne révèle l''adresse que masquée.';


-- ============================================================
-- 3. LA LISTE DE SUPPRESSION
-- ============================================================
--
-- ELLE EST GLOBALE AU PARC, ET C'EST VOULU. Tous les paysagistes
-- expédient depuis le même domaine authentifié : une adresse qui se
-- plaint se plaindra à nouveau, quel que soit celui qui écrit, et c'est
-- la réputation COMMUNE qui est en jeu. Une suppression par
-- organisation laisserait le deuxième paysagiste refaire l'erreur du
-- premier.
--
-- ET ELLE NE BLOQUE JAMAIS LE TRANSACTIONNEL. C'est le choix le plus
-- discutable du fichier, donc voici l'argument en entier.
--
-- Un rebond dur dit que la boîte n'existe pas ; une plainte dit que la
-- personne a cliqué « indésirable ». Bloquer les envois transactionnels
-- sur l'un ou l'autre reproduirait EXACTEMENT le défaut catastrophique
-- que ce fichier existe pour empêcher — un client qui ne reçoit plus
-- ses factures, et personne qui sache pourquoi — simplement par une
-- autre porte. Le pire : un client qui marque un devis comme
-- indésirable verrait ensuite sa FACTURE disparaître.
--
-- Ce qu'on fait à la place :
--   • l'envoi part, et le journal porte un AVERTISSEMENT en français
--     que le paysagiste voit dans son propre écran (« cette adresse a
--     échoué le 3 mars, vérifiez-la ») ;
--   • le compteur de rebonds et de plaintes de SON entreprise monte
--     (§ 10) ;
--   • et si cela devient sérieux, un humain suspend cette entreprise-là,
--     avec un motif et une trace.
--
-- Le transporteur, lui, tiendra sa propre liste de blocage, qu'on ne
-- contrôle pas et qui peut refuser un transactionnel sans qu'on y soit
-- pour rien. D'où le § 7 : on LIT ses événements pour rendre l'état
-- visible, au lieu de le subir en silence.

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),

  email text not null check (public.email_is_addressable(email)),

  kind text not null check (kind in (
    'rebondDur',           -- la boîte n'existe pas
    'plainte',             -- la personne a cliqué « indésirable »
    'desabonnement',       -- elle s'est désabonnée de la publicité
    'bloqueTransporteur',  -- le transporteur la refuse, pour ses propres raisons
    'manuel'               -- quelqu'un l'a inscrite à la main, avec un motif
  )),

  reason text,

  -- D'où vient l'information. Nul quand c'est nous qui l'avons décidée.
  transporter_key text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1 check (occurrences > 0),

  -- LA LEVÉE. Une adresse mal saisie puis corrigée doit pouvoir
  -- redevenir sollicitable, sinon la liste devient un cimetière et
  -- quelqu'un finira par la vider d'un coup.
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  released_reason text,

  constraint email_suppressions_unique unique (email, kind),
  constraint email_suppressions_levee_coherente
    check ((released_at is null) = (released_reason is null))
);

create index if not exists email_suppressions_active_idx
  on public.email_suppressions (email) where released_at is null;

comment on table public.email_suppressions is
  'Les adresses qu''on ne sollicite plus EN PUBLICITÉ. Globale au parc parce que la réputation '
  'du domaine est commune. Elle ne bloque JAMAIS un envoi transactionnel : ce serait le défaut '
  'catastrophique par une autre porte — un client qui signale un devis comme indésirable '
  'verrait ensuite sa facture disparaître.';


-- ============================================================
-- 4. L'EXPÉDITION, ENTREPRISE PAR ENTREPRISE
-- ============================================================
--
-- LE RISQUE LE PLUS SÉRIEUX DU CHANTIER EST ICI. Tout le parc expédie
-- depuis le même domaine. Un seul paysagiste qui écrit à des adresses
-- achetées fait tomber la délivrabilité de TOUS — y compris les
-- factures d'abonnement d'Oasis Care et les messages d'authentification
-- qui passent par le même domaine et qui fonctionnent aujourd'hui.
--
-- L'interrupteur ci-dessous est ce qui permet de couper UNE entreprise
-- sans couper les autres. Il coupe TOUT, transactionnel compris — et
-- c'est le seul endroit du fichier où un transactionnel peut être
-- arrêté. C'est assumé, à trois conditions qui sont toutes tenues :
-- un HUMAIN le décide, il doit donner un MOTIF, et l'entreprise le VOIT
-- dans son propre écran parce qu'elle a le droit de lire cette ligne
-- (§ 14). Une coupure silencieuse serait le défaut ; une coupure
-- motivée et visible est un garde-fou.

create table if not exists public.email_organization_settings (
  organization_id uuid primary key
    references public.business_organizations (id) on delete cascade,

  suspended_at timestamptz,
  suspended_by uuid references auth.users (id) on delete set null,
  suspended_reason text,

  -- LES RELANCES : DÉSACTIVÉES PAR DÉFAUT. Un paysagiste qui découvre
  -- que son logiciel a relancé un client avec qui il était au téléphone
  -- la veille perd confiance d'un coup, et il ne la retrouve pas. Elles
  -- s'activent entreprise par entreprise.
  --
  -- CES TROIS COLONNES NE FONT RIEN ENCORE. Aucun ordonnanceur n'existe :
  -- elles sont le réglage que la relance lira, le jour où l'on aura
  -- choisi ce qui la déclenche.
  reminders_enabled boolean not null default false,
  reminder_delay_days integer not null default 7
    check (reminder_delay_days between 1 and 90),
  reminder_max integer not null default 2
    check (reminder_max between 0 and 3),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_organization_settings_suspension_coherente
    check ((suspended_at is null) = (suspended_reason is null))
);

comment on table public.email_organization_settings is
  'L''interrupteur d''expédition par entreprise, et le réglage des relances. La suspension '
  'coupe TOUT, transactionnel compris : c''est le seul endroit du fichier où un transactionnel '
  'peut être arrêté, et c''est acceptable parce qu''un humain le décide, doit donner un motif, '
  'et que l''entreprise LIT cette ligne — elle voit donc qu''elle est coupée, et pourquoi.';


-- ============================================================
-- 5. LES CAMPAGNES PUBLICITAIRES
-- ============================================================
--
-- Le panneau d'Oasis Admin. Ce n'est PAS un déclencheur d'état : c'est
-- un geste humain, et c'est très bien ainsi.
--
-- Même astuce qu'au § 1 : `nature` est verrouillée sur 'publicite' et
-- la clé étrangère est composite. Une campagne ne peut donc utiliser
-- qu'un gabarit publicitaire — et comme un gabarit publicitaire ne peut
-- viser qu'une entreprise (§ 1), une campagne ne peut structurellement
-- pas s'adresser au client d'un paysagiste.

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),

  title text not null check (btrim(title) <> ''),

  template_key text not null,
  nature text not null default 'publicite' check (nature = 'publicite'),

  subject text not null
    check (btrim(subject) <> '' and length(subject) <= 300 and public.email_is_header_safe(subject)),
  body_text text not null check (btrim(body_text) <> ''),

  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'cancelled')),

  -- Le motif de l'administrateur. Non vide, comme
  -- admin_audit_events.reason : écrire à tout le parc se justifie au
  -- moment où on le fait, pas six mois plus tard.
  reason text not null check (btrim(reason) <> ''),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  queued_count integer,
  skipped_count integer,

  constraint email_campaigns_template_fk
    foreign key (template_key, nature) references public.email_templates (key, nature)
);

comment on table public.email_campaigns is
  'Une annonce commerciale composée depuis Oasis Admin. Le TEXTE est ici parce qu''un '
  'administrateur le rédige — c''est du contenu, pas un gabarit ; l''enveloppe, le pied et le '
  'lien de désabonnement restent dans le code. La clé étrangère composite garantit qu''une '
  'campagne ne peut utiliser qu''un gabarit publicitaire, donc ne peut viser qu''une entreprise.';


-- ============================================================
-- 5.a L'IDENTITÉ D'OASIS CARE LUI-MÊME
-- ============================================================
--
-- LE DÉFAUT QUE CETTE TABLE CORRIGE, ET IL ÉTAIT GÊNANT. Une campagne
-- parcourt les entreprises DESTINATAIRES et passait chacune d'elles
-- comme `p_organization_id` à `email_enqueue`, qui recopie le nom
-- affiché et le « répondre à » depuis l'identité de cette
-- organisation. « Jardins Dupont » recevait donc une publicité d'Oasis
-- Care signée « Jardins Dupont », portant le SIRET de Jardins Dupont
-- en pied, et toute réponse — « retirez-moi de vos listes » comprise —
-- repartait dans sa propre boîte.
--
-- Le motif CRM est juste pour un DEVIS : c'est bien le paysagiste qui
-- écrit à son client. Il est faux pour une ANNONCE D'OASIS, où c'est
-- Oasis qui écrit. Au-delà du ridicule, c'est un défaut
-- d'identification : une prospection doit indiquer clairement pour le
-- compte de qui elle est émise (art. L.34-5 CPCE, art. 6-III LCEN).
--
-- UNE SEULE LIGNE, GARANTIE PAR LA CLÉ PRIMAIRE. `id boolean primary
-- key check (id)` : il ne peut y en avoir qu'une, et personne n'aura à
-- se demander laquelle fait foi.
--
-- CE QU'ELLE NE PORTE PAS : l'adresse technique d'expédition. Celle-là
-- reste un réglage du SERVEUR (`oasis.email_expediteur`), parce qu'elle
-- désigne le DOMAINE d'expédition — la laisser choisir depuis un
-- formulaire d'administration, c'est offrir l'hameçonnage depuis un
-- domaine authentifié. Le « répondre à » ci-dessous, lui, ne décide de
-- rien : il n'entre dans aucune vérification SPF, DKIM ou DMARC.
create table if not exists public.email_platform_identity (
  id boolean primary key default true check (id),

  from_name text not null default 'Oasis Care'
    check (btrim(from_name) <> '' and public.email_is_header_safe(from_name)),

  -- LA BOÎTE QUI REÇOIT LES RÉPONSES AUX ANNONCES, ET QUE QUELQU'UN
  -- DOIT LIRE. Nulle au départ, et c'est délibéré : tant qu'elle
  -- manque, aucune annonce ne part. Une prospection dont les réponses
  -- tombent dans le vide est pire qu'une prospection qu'on n'envoie pas.
  reply_to_email text check (reply_to_email is null or public.email_is_addressable(reply_to_email)),

  -- LES MENTIONS D'OASIS CARE, pour le pied des annonces. Ce sont
  -- celles d'Oasis, jamais celles de l'entreprise qui reçoit.
  legal_name text not null default 'Oasis Care',
  legal_form text,
  siret text,
  vat_number text,
  rcs_city text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  phone text,
  website text,

  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.email_platform_identity (id) values (true)
on conflict (id) do nothing;

comment on table public.email_platform_identity is
  'L''identité d''Oasis Care en tant qu''expéditeur de SES PROPRES annonces. Une seule ligne. '
  'Sans elle, une publicité d''Oasis partait au nom de l''entreprise qui la reçoit, avec son '
  'SIRET en pied et son adresse en « répondre à ». Elle ne porte PAS l''adresse technique '
  'd''expédition : celle-là désigne le domaine et reste un réglage du serveur.';


-- ============================================================
-- 6. LE JOURNAL D'ENVOI
-- ============================================================
--
-- C'EST LUI QUI RÉPOND À « LE CLIENT DIT QU'IL N'A RIEN REÇU », la
-- question qu'on nous posera le plus souvent. Il est en AJOUT SEUL : ni
-- politique de suppression, ni politique de modification, et un
-- déclencheur qui gèle tout ce qui décrit le message une fois qu'il est
-- parti. Seuls l'état et les nouvelles du transporteur bougent.

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),

  -- L'ENTREPRISE À QUI CE MESSAGE SE RATTACHE. Pour un devis, celle qui
  -- l'envoie ; pour une publicité d'Oasis, celle qui la reçoit. Dans
  -- les deux cas c'est la clé qui permet de compter les rebonds PAR
  -- ORGANISATION et de suspendre une seule entreprise (§ 10).
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  template_key text not null,
  nature text not null check (nature in ('transactionnel', 'publicite')),

  -- LA VERSION DU GABARIT RÉELLEMENT RENDUE. Les gabarits vivent dans
  -- le code et sont versionnés par git ; cette colonne dit LAQUELLE a
  -- servi. Sans elle, « le client dit que le texte disait autre chose »
  -- resterait sans réponse.
  template_version text not null check (btrim(template_version) <> ''),

  recipient_kind text not null check (recipient_kind in ('clientFinal', 'entreprise')),

  to_email text not null check (public.email_is_addressable(to_email)),
  to_name text check (public.email_is_header_safe(to_name)),

  -- Le rattachement CRM, quand le destinataire est un client final.
  -- `set null` : effacer un client n'efface pas la preuve qu'on lui a
  -- écrit.
  customer_id uuid references public.crm_customers (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,

  -- L'OBJET LIÉ. C'est ce qui permet de retrouver « les messages de
  -- cette facture », et c'est la moitié de la clé d'idempotence.
  entity_type text not null check (entity_type in (
    'quote', 'invoice', 'clientInvitation', 'organization'
  )),
  entity_id uuid not null,

  -- L'EXPÉDITEUR TEL QU'IL EST PARTI, recopié et non joint. Une
  -- organisation change de nom ; le journal doit dire ce que le client
  -- a vu ce jour-là.
  from_email text not null check (public.email_is_addressable(from_email)),
  from_name text not null
    check (btrim(from_name) <> '' and public.email_is_header_safe(from_name)),
  -- LE CHAMP QU'ON OUBLIE, ET DONT L'ABSENCE REND TOUT INUTILE. Sans
  -- lui, le client répond « d'accord pour le devis » et la réponse
  -- tombe dans une boîte d'Oasis Care que personne ne lit. Il est
  -- `not null` : c'est le seul verrou dur posé sur le devis.
  reply_to_email text not null check (public.email_is_addressable(reply_to_email)),

  subject text not null
    check (btrim(subject) <> '' and length(subject) <= 300 and public.email_is_header_safe(subject)),
  -- La partie texte réellement expédiée. Elle existe toujours — un
  -- message sans partie texte est mal vu de tous les filtres — et elle
  -- est ce que le destinataire a lu, en substance.
  body_text text not null check (btrim(body_text) <> ''),
  -- L'empreinte du corps HTML remis au transporteur. On garde
  -- l'empreinte plutôt que le HTML : avec la version du gabarit et les
  -- variables, elle permet de REFABRIQUER le message et de PROUVER que
  -- la refabrication est identique, sans stocker des mégaoctets
  -- d'habillage.
  body_html_sha256 text not null check (body_html_sha256 ~ '^[0-9a-f]{64}$'),
  /**
   * VRAI QUAND L'EMPREINTE CI-DESSUS EST UN SUBSTITUT.
   *
   * `admin_send_email_campaign` écrit la ligne sans avoir rendu le
   * HTML — c'est la file qui le rendra, plus tard, dans la fonction
   * Edge. Elle y posait l'empreinte du TEXTE, ce qui est simplement
   * faux : « refabriquer et prouver que c'est identique » ne marchait
   * pas pour une campagne, et le journal l'affirmait quand même.
   *
   * Le déclencheur d'ajout seul autorise UNE réécriture de l'empreinte
   * tant que ce drapeau est vrai, et `email_mark_sent` l'abaisse en
   * posant la vraie. Après quoi l'empreinte est gelée comme le reste.
   */
  body_html_sha256_provisoire boolean not null default false,
  variables jsonb not null default '{}'::jsonb,

  -- LE RANG. 1 pour le premier envoi, 2 pour la première relance, etc.
  -- C'est la seule échappatoire à l'idempotence, et elle est
  -- délibérée : on ne renvoie pas « le même » message, on envoie le
  -- suivant.
  occurrence integer not null default 1 check (occurrence between 1 and 10),

  campaign_id uuid references public.email_campaigns (id) on delete set null,

  status text not null default 'queued' check (status in (
    'queued', 'sending', 'sent', 'deferred', 'delivered',
    'bounced', 'complained', 'blocked', 'failed', 'cancelled'
  )),

  -- ---- LA RÉSERVATION ------------------------------------------------
  -- CE QUE CES TROIS COLONNES EMPÊCHENT : deux passages simultanés de
  -- la file qui expédient le même message. La contrainte d'unicité sur
  -- `idempotency_key` garde l'INSERTION ; elle ne garde PAS la relecture
  -- d'une ligne qui existe déjà. C'est `email_claim_queued()` — un
  -- `update … for update skip locked` — qui rend deux passages
  -- simultanés inoffensifs, et ces colonnes sont ce qu'il écrit.
  claimed_at timestamptz,
  /** Le nom du processus qui a réservé. Pour l'enquête, pas pour la logique. */
  claimed_by text,
  /**
   * LE COMPTEUR MONTE AVANT L'APPEL SORTANT, jamais après. Une ligne
   * dont les tentatives montent sans jamais aboutir est visible ; une
   * ligne qui repart indéfiniment parce que le marquage échoue ne
   * l'est pas.
   */
  attempts integer not null default 0 check (attempts >= 0),
  /** Le prochain essai, pour un échec TEMPORAIRE (429, 5xx, réseau). */
  next_attempt_at timestamptz,

  -- LE TRANSPORTEUR. Texte libre, SANS valeur par défaut et SANS liste
  -- de valeurs : la base n'a pas à connaître le prestataire du jour.
  -- Elle enregistre le nom que l'implémentation lui déclare, après coup.
  transporter_key text,
  transporter_message_id text,

  -- POURQUOI ÇA A ÉCHOUÉ, en français, parce que c'est le paysagiste
  -- qui le lira dans son écran. Un code technique dans une interface
  -- client est une façon de ne rien dire.
  failure_reason text,
  -- Et le code brut du transporteur à côté, pour nous.
  failure_code text,

  -- Les avertissements constatés au moment de la mise en file : « cette
  -- adresse a échoué le 3 mars ». Ils n'empêchent pas l'envoi, ils
  -- l'accompagnent.
  warnings text[] not null default '{}'::text[],

  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  last_event_at timestamptz,

  -- ---- L'IDEMPOTENCE ------------------------------------------------
  -- COLONNE GÉNÉRÉE, et c'est tout l'intérêt : l'appelant ne peut pas
  -- inventer une clé pour envoyer deux fois. Elle se déduit de ce que
  -- le message EST — l'objet lié, le gabarit, le rang, la campagne — et
  -- pas de ce que l'appelant prétend.
  -- L'ORGANISATION EST DANS LA CLÉ, ET C'EST UNE CORRECTION, PAS UN
  -- ORNEMENT. Sans elle, la clé était globale au parc : un membre de
  -- l'entreprise A pouvait CONSOMMER D'AVANCE la clé de la facture de
  -- l'entreprise B en passant son identifiant. Quand B émettait sa
  -- facture, `email_enqueue` attrapait la violation d'unicité et
  -- rendait « ce message est déjà parti » — l'écran affichait un envoi
  -- réussi, le client ne recevait jamais rien, et le journal donnait
  -- raison au logiciel. Le défaut catastrophique du chantier, atteint
  -- par la porte de l'idempotence.
  --
  -- Le second verrou est dans `email_enqueue`, qui refuse désormais un
  -- `entity_id` n'appartenant pas à l'organisation visée. Deux verrous
  -- pour la même porte : celui-ci tient même si le second est contourné.
  idempotency_key text generated always as (
    organization_id::text
    || ':' || coalesce(campaign_id::text, 'transactionnel')
    || ':' || entity_type
    || ':' || entity_id::text
    || ':' || template_key
    || ':' || occurrence::text
  ) stored,

  constraint email_messages_idempotence unique (idempotency_key),

  -- LA NATURE N'EST PAS CHOISIE PAR L'APPELANT. Elle est recopiée du
  -- catalogue, et cette clé étrangère composite refuse toute autre
  -- valeur. Un message publicitaire déguisé en transactionnel — donc
  -- sans lien de désabonnement et sans consentement — est refusé par la
  -- base, pas par une relecture.
  constraint email_messages_template_fk
    foreign key (template_key, nature) references public.email_templates (key, nature),

  -- LE CLIENT FINAL DU PAYSAGISTE N'EST PAS NOTRE CLIENT. Il n'a rien
  -- signé avec Oasis Care. Deux verrous plutôt qu'un :
  --   a) une publicité ne peut viser qu'une entreprise ;
  constraint email_messages_publicite_jamais_au_client_final
    check (nature <> 'publicite' or recipient_kind = 'entreprise'),
  --   b) et un message adressé à une entreprise ne peut même pas
  --      RÉFÉRENCER un client du CRM. Une publicité ne peut donc pas
  --      être rattachée à une fiche client, quelle que soit la façon
  --      dont on s'y prendrait.
  constraint email_messages_entreprise_sans_client_crm
    check (recipient_kind = 'clientFinal' or (customer_id is null and contact_id is null)),

  -- Un contact sans client est un rattachement orphelin.
  constraint email_messages_contact_avec_client
    check (contact_id is null or customer_id is not null),

  -- Un échec dit pourquoi.
  constraint email_messages_echec_motive
    check (status not in ('bounced', 'complained', 'blocked', 'failed')
           or failure_reason is not null),

  -- Une campagne n'existe que pour la publicité.
  constraint email_messages_campagne_publicitaire
    check (campaign_id is null or nature = 'publicite')
);

create index if not exists email_messages_org_idx
  on public.email_messages (organization_id, queued_at desc);
create index if not exists email_messages_entity_idx
  on public.email_messages (entity_type, entity_id, queued_at desc);
create index if not exists email_messages_email_idx
  on public.email_messages (to_email, queued_at desc);
create index if not exists email_messages_campaign_idx
  on public.email_messages (campaign_id) where campaign_id is not null;
-- Ce qui n'est pas encore parti. Index partiel : la file est toujours
-- petite, le journal grossit sans fin.
create index if not exists email_messages_queue_idx
  on public.email_messages (next_attempt_at nulls first, queued_at) where status = 'queued';
-- CE QUI EST PARTI CHEZ LE TRANSPORTEUR SANS QU'ON SACHE CE QU'IL EN A
-- FAIT. Une ligne qui reste en 'sending' au-delà de quelques minutes
-- n'est PAS rejouée — ce serait envoyer une seconde fois un message
-- peut-être déjà remis. Elle est SIGNALÉE, et un humain tranche. Cet
-- index sert l'écran qui la montre.
create index if not exists email_messages_sending_idx
  on public.email_messages (claimed_at) where status = 'sending';
-- Ce qui a mal tourné, par organisation : c'est la requête du § 10 et
-- celle de l'écran du paysagiste.
create index if not exists email_messages_trouble_idx
  on public.email_messages (organization_id, status, queued_at desc)
  where status in ('bounced', 'complained', 'blocked', 'failed');

comment on table public.email_messages is
  'Le journal d''envoi, en AJOUT SEUL. Il répond à « le client dit qu''il n''a rien reçu » et '
  'à « le client dit que le texte disait autre chose ». La colonne générée idempotency_key '
  'porte une contrainte d''unicité : le même message ne peut pas partir deux fois, et la clé '
  'étant générée, l''appelant ne peut pas la contourner.';

comment on column public.email_messages.transporter_key is
  'Le nom du transporteur qui a pris le message, tel que l''implémentation le déclare. Sans '
  'valeur par défaut et sans liste : la base ne connaît aucun prestataire en particulier, et '
  'changer de transporteur ne doit pas être une migration.';


-- ------------------------------------------------------------
-- 6.a AJOUT SEUL, POUR DE BON
-- ------------------------------------------------------------
-- Une politique RLS absente suffit contre un jeton. Elle ne suffit pas
-- contre `service_role`, qui écrit légitimement dans cette table et qui
-- pourrait, par un bogue, réécrire le corps d'un message déjà parti.
-- Un déclencheur, lui, s'applique à tout le monde.
create or replace function public.email_messages_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Le journal d''envoi ne se supprime pas : c''est lui qui répond à « le client dit qu''il n''a rien reçu ».'
      using errcode = '23514';
  end if;

  -- CE QUI EST GELÉ : tout ce qui décrit le message tel qu'il est
  -- parti. CE QUI BOUGE : l'état, le transporteur, l'échec, les dates
  -- d'événement. La liste est écrite en positif — on énumère ce qui est
  -- figé — parce que l'inverse laisserait passer chaque colonne ajoutée
  -- plus tard.
  if new.organization_id is distinct from old.organization_id
     or new.template_key is distinct from old.template_key
     or new.template_version is distinct from old.template_version
     or new.nature is distinct from old.nature
     or new.recipient_kind is distinct from old.recipient_kind
     or new.to_email is distinct from old.to_email
     or new.to_name is distinct from old.to_name
     or new.customer_id is distinct from old.customer_id
     or new.contact_id is distinct from old.contact_id
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.from_email is distinct from old.from_email
     or new.from_name is distinct from old.from_name
     or new.reply_to_email is distinct from old.reply_to_email
     or new.subject is distinct from old.subject
     or new.body_text is distinct from old.body_text
     or new.variables is distinct from old.variables
     or new.occurrence is distinct from old.occurrence
     or new.campaign_id is distinct from old.campaign_id
     or new.queued_at is distinct from old.queued_at then
    raise exception 'Un message déjà journalisé ne se réécrit pas : seuls son état et les nouvelles du transporteur peuvent changer.'
      using errcode = '23514';
  end if;

  -- L'EMPREINTE DU HTML EST GELÉE, SAUF UNE FOIS. Une campagne est
  -- écrite en base avant que le HTML n'existe : sa ligne porte une
  -- empreinte PROVISOIRE, et la file pose la vraie au moment de
  -- l'envoi. Le drapeau ne peut que descendre, donc la fenêtre ne
  -- s'ouvre qu'une fois et ne se rouvre jamais.
  if new.body_html_sha256 is distinct from old.body_html_sha256
     and not old.body_html_sha256_provisoire then
    raise exception 'L''empreinte du message est gelée : elle est ce qui permet de prouver ce qui est réellement parti.'
      using errcode = '23514';
  end if;
  if new.body_html_sha256_provisoire and not old.body_html_sha256_provisoire then
    raise exception 'Une empreinte définitive ne redevient pas provisoire.'
      using errcode = '23514';
  end if;

  -- L'ÉTAT NE RECULE PAS. Les webhooks arrivent dans le désordre : un
  -- événement en retard ne doit pas faire repasser un message
  -- « rebondi » en « envoyé », ce qui ferait disparaître l'échec de
  -- l'écran du paysagiste.
  --
  -- LA SEULE EXCEPTION, ET ELLE EST NOMMÉE : 'sending' → 'queued'.
  -- C'est la RESTITUTION d'une réservation — un 429 du transporteur,
  -- une panne de quelques minutes — et sans elle un échec temporaire
  -- serait définitif. Elle n'efface aucun constat : rien n'est encore
  -- arrivé quand un message est en 'sending'. Toute autre marche
  -- arrière reste refusée.
  if public.email_status_rank(new.status) < public.email_status_rank(old.status)
     and not (old.status = 'sending' and new.status = 'queued') then
    raise exception 'L''état d''un message ne recule pas : « % » puis « % » ferait disparaître un échec déjà constaté.', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists email_messages_append_only on public.email_messages;
create trigger email_messages_append_only
  before update or delete on public.email_messages
  for each row execute function public.email_messages_append_only();

-- `truncate` ne déclenche aucun déclencheur `for each row` : sans celui
-- qui suit, un `truncate public.email_messages` viderait le journal
-- sans un mot. Même fonction que 0081, reposée à l'identique parce
-- qu'elle est idempotente.
create or replace function public.refuse_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'On ne tronque pas « % » : cette table porte les droits d''administration de la plateforme. Supprimez ligne à ligne, sous les garde-fous.', tg_table_name
    using errcode = '23514';
end;
$$;

drop trigger if exists email_messages_no_truncate on public.email_messages;
create trigger email_messages_no_truncate
  before truncate on public.email_messages
  for each statement execute function public.refuse_truncate();


-- ============================================================
-- 7. LES ÉVÉNEMENTS DU TRANSPORTEUR
-- ============================================================
--
-- Le transporteur nous rappelle : livré, rebondi, signalé comme
-- indésirable, désabonné. On enregistre TOUT et on projette sur le
-- message. Deux raisons de ne pas se contenter de mettre le message à
-- jour :
--   • les webhooks sont rejoués. Sans trace individuelle, on ne saurait
--     pas distinguer un rejeu d'un second rebond.
--   • le transporteur tient sa PROPRE liste de blocage, qui peut
--     refuser un transactionnel sans qu'on y soit pour rien. La seule
--     façon de ne pas subir cela en silence est d'enregistrer ce qu'il
--     nous dit et de le montrer.

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),

  message_id uuid references public.email_messages (id) on delete cascade,

  transporter_key text,
  transporter_message_id text,

  event text not null check (event in (
    'sent', 'delivered', 'opened', 'clicked',
    'softBounce', 'hardBounce', 'complaint', 'blocked', 'unsubscribed',
    'deferred', 'error'
  )),

  occurred_at timestamptz not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

-- L'IDEMPOTENCE DU WEBHOOK. Un rejeu porte le même identifiant, le même
-- événement et le même instant : il tombe sur l'index et n'entre pas
-- deux fois. Un index plutôt qu'une contrainte, parce qu'il faut
-- `coalesce` — dans une contrainte `unique`, deux NULL sont distincts,
-- et le rejeu passerait.
create unique index if not exists email_events_dedupe_idx
  on public.email_events (
    coalesce(transporter_message_id, ''),
    coalesce(message_id, '00000000-0000-0000-0000-000000000000'::uuid),
    event,
    occurred_at
  );

create index if not exists email_events_message_idx
  on public.email_events (message_id, occurred_at desc);

comment on table public.email_events is
  'Ce que le transporteur nous rapporte, en ajout seul. Enregistré même quand on ne sait pas '
  'rattacher l''événement à un message : un rebond orphelin reste une information sur la '
  'réputation du domaine.';

create or replace function public.email_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Les événements du transporteur ne se modifient ni ne s''effacent : c''est la seule preuve de ce qu''il nous a dit.'
    using errcode = '23514';
end;
$$;

drop trigger if exists email_events_append_only on public.email_events;
create trigger email_events_append_only
  before update or delete on public.email_events
  for each row execute function public.email_events_append_only();

drop trigger if exists email_events_no_truncate on public.email_events;
create trigger email_events_no_truncate
  before truncate on public.email_events
  for each statement execute function public.refuse_truncate();


-- ------------------------------------------------------------
-- 7.a LA PROJECTION — ET L'ENDROIT EXACT OÙ LE DÉFAUT VIVRAIT
-- ------------------------------------------------------------
-- CE DÉCLENCHEUR EST LE PLUS DANGEREUX DU FICHIER. C'est ici que
-- quelqu'un, un jour, écrira « le client s'est plaint, donc on ne lui
-- écrit plus » — et supprimera ses factures sans le savoir.
--
-- Ce qu'il fait, et rien d'autre :
--   • il fait avancer l'état du message, jamais reculer ;
--   • un rebond dur, une plainte ou un blocage inscrit l'adresse à la
--     LISTE DE SUPPRESSION, qui ne gouverne QUE LA PUBLICITÉ (§ 3) ;
--   • un désabonnement écrit dans le REGISTRE DE CONSENTEMENT, qui est
--     structurellement incapable de parler d'autre chose que de
--     publicité (§ 2).
--
-- À AUCUN MOMENT il ne touche à ce qui laisse partir un transactionnel.
create or replace function public.email_events_project()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_message record;
begin
  v_status := case new.event
    when 'sent'       then 'sent'
    when 'delivered'  then 'delivered'
    when 'softBounce' then 'deferred'
    when 'deferred'   then 'deferred'
    when 'hardBounce' then 'bounced'
    when 'complaint'  then 'complained'
    when 'blocked'    then 'blocked'
    when 'error'      then 'failed'
    -- 'opened', 'clicked' et 'unsubscribed' ne changent pas l'état de
    -- l'acheminement : le message a bien été remis.
    else null
  end;

  -- LE `select into` EST INCONDITIONNEL, ET C'EST UNE CORRECTION.
  -- Enfermé dans un `if new.message_id is not null`, il laissait
  -- `v_message` NON AFFECTÉ quand l'événement n'était rattaché à aucun
  -- message — et la ligne suivante levait « record "v_message" is not
  -- assigned yet », c'est-à-dire que le webhook rendait une erreur.
  -- Or un rebond orphelin est justement le cas qu'on tient à
  -- enregistrer : c'est une information sur la réputation du domaine.
  -- `select into` sans ligne affecte le record à NULL, ce qui suffit.
  select * into v_message
  from public.email_messages
  where new.message_id is not null and id = new.message_id;

  if v_message.id is not null and v_status is not null
     and public.email_status_rank(v_status) > public.email_status_rank(v_message.status) then
    update public.email_messages
       set status = v_status,
           sent_at = case when v_status = 'sent' then coalesce(sent_at, new.occurred_at) else sent_at end,
           last_event_at = new.occurred_at,
           failure_reason = case
             when v_status in ('bounced', 'complained', 'blocked', 'failed')
               then coalesce(
                 nullif(btrim(coalesce(new.reason, '')), ''),
                 case v_status
                   when 'bounced' then 'L''adresse n''existe pas ou refuse le courrier. Vérifiez-la auprès du client.'
                   when 'complained' then 'Le destinataire a signalé ce message comme indésirable.'
                   when 'blocked' then 'Le transporteur a refusé d''acheminer ce message vers cette adresse.'
                   else 'Le transporteur a signalé une erreur sans en préciser la cause.'
                 end)
             else failure_reason
           end,
           transporter_key = coalesce(transporter_key, new.transporter_key),
           transporter_message_id = coalesce(transporter_message_id, new.transporter_message_id)
     where id = new.message_id;
  elsif v_message.id is not null then
    update public.email_messages
       set last_event_at = greatest(coalesce(last_event_at, new.occurred_at), new.occurred_at)
     where id = new.message_id;
  end if;

  -- LA LISTE DE SUPPRESSION. Elle ne gouverne que la publicité — voir
  -- le § 3, où le refus de bloquer le transactionnel est argumenté.
  if new.event in ('hardBounce', 'complaint', 'blocked') and v_message.id is not null then
    insert into public.email_suppressions (email, kind, reason, transporter_key, last_seen_at)
    values (
      public.email_normalize(v_message.to_email),
      case new.event
        when 'hardBounce' then 'rebondDur'
        when 'complaint'  then 'plainte'
        else 'bloqueTransporteur'
      end,
      new.reason,
      new.transporter_key,
      new.occurred_at)
    on conflict (email, kind) do update
      set last_seen_at = greatest(public.email_suppressions.last_seen_at, excluded.last_seen_at),
          occurrences = public.email_suppressions.occurrences + 1,
          reason = coalesce(excluded.reason, public.email_suppressions.reason),
          -- Une adresse qui rebondit à nouveau après une levée est
          -- re-supprimée : la levée était une hypothèse, le rebond est
          -- un fait.
          released_at = null,
          released_by = null,
          released_reason = null;
  end if;

  -- LE DÉSABONNEMENT VENU DU TRANSPORTEUR. Il vaut pour la publicité,
  -- et pour elle seule — la table qu'on écrit ne sait rien dire d'autre.
  if new.event = 'unsubscribed' and v_message.id is not null then
    update public.email_consents
       set unsubscribed_at = coalesce(unsubscribed_at, new.occurred_at),
           unsubscribe_reason = coalesce(unsubscribe_reason, 'Désabonnement transmis par le transporteur.'),
           updated_at = now()
     where organization_id = v_message.organization_id
       and email = public.email_normalize(v_message.to_email)
       and nature = 'publicite';

    insert into public.email_suppressions (email, kind, reason, transporter_key, last_seen_at)
    values (public.email_normalize(v_message.to_email), 'desabonnement',
            'Désabonnement transmis par le transporteur.', new.transporter_key, new.occurred_at)
    on conflict (email, kind) do update
      set last_seen_at = greatest(public.email_suppressions.last_seen_at, excluded.last_seen_at),
          released_at = null, released_by = null, released_reason = null;
  end if;

  return new;
end;
$$;

drop trigger if exists email_events_project on public.email_events;
create trigger email_events_project
  after insert on public.email_events
  for each row execute function public.email_events_project();


-- ============================================================
-- 8. L'IDENTITÉ DE L'EXPÉDITEUR — LE MOTIF CRM, VÉRIFIÉ
-- ============================================================
--
-- Même forme que `saas_subscription_billing_lines` de 0081 et que
-- `unavailableReason` du fournisseur de paiement : la fonction ne LÈVE
-- PAS quand l'identité est incomplète, elle rend un `blocking_reason`
-- que l'écran affiche. « Il manque l'adresse e-mail de l'entreprise »
-- n'est pas une panne, c'est un état normal auquel l'interface doit
-- s'adapter au lieu de mentir.
--
-- LES VERROUS, ARBITRÉS :
--   • BLOQUANT POUR TOUT ENVOI : business_organizations.email. Sans
--     elle, pas de « répondre à » : les réponses des clients tombent
--     chez Oasis et la fonctionnalité est pire qu'inutile.
--   • BLOQUANT POUR LA FACTURE SEULEMENT (requires_legal_identity) :
--     SIRET, adresse, code postal, ville. Une facture sans eux n'est pas
--     conforme, et l'émission est déjà un acte délibéré.
--   • NI BLOQUANT NI IGNORÉ, un avertissement : numéro de TVA, forme
--     juridique, décennale, logo. Bloquer un devis pour une attestation
--     à retrouver ferait perdre une affaire ; se taire ferait partir un
--     document incomplet.

create or replace function public.email_sender_identity(
  p_organization_id uuid,
  p_template_key text
)
returns table (
  from_name text,
  reply_to_email text,
  logo_path text,
  blocking_reason text,
  warnings text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org record;
  v_tpl record;
  v_oasis record;
  v_blocking text;
  v_warnings text[] := '{}';
begin
  -- LE CONTRÔLE QUE LA RLS FERAIT SI ON LISAIT LA TABLE DIRECTEMENT.
  -- `security definer` traverse la RLS : sans cette ligne, n'importe
  -- quel jeton pourrait pointer la fonction sur l'entreprise d'un autre
  -- et lire son identité. Le `auth.uid() is null` est le chemin du
  -- SERVICE — `service_role` n'a pas d'utilisateur, et c'est lui qui
  -- expédie.
  if auth.uid() is not null
     and not public.is_organization_member(p_organization_id)
     and not public.is_platform_admin() then
    raise exception 'Accès refusé : cette entreprise n''est pas la vôtre.'
      using errcode = '42501';
  end if;

  select * into v_tpl from public.email_templates t where t.key = p_template_key;
  if v_tpl.key is null then
    return query select null::text, null::text, null::text,
      format('Gabarit inconnu : « %s ». Aucun message ne part sur un gabarit qui n''est pas au catalogue.',
             coalesce(p_template_key, '(vide)'))::text,
      '{}'::text[];
    return;
  end if;

  -- ---- LA BRANCHE D'OASIS -------------------------------------------
  --
  -- QUAND OASIS ÉCRIT, C'EST OASIS QUI SIGNE. Un gabarit publicitaire
  -- est, par construction (§ 1), un message d'Oasis Care vers une
  -- entreprise cliente : le nom affiché, l'adresse de réponse et les
  -- mentions du pied sont donc ceux d'Oasis, pas ceux du destinataire.
  -- C'est la seule branche de cette fonction qui ne lit pas
  -- `business_organizations`.
  if v_tpl.nature = 'publicite' then
    select * into v_oasis from public.email_platform_identity limit 1;

    if v_oasis.id is null then
      return query select null::text, null::text, null::text,
        'L''identité d''expéditeur d''Oasis Care n''est pas enregistrée : aucune annonce ne peut partir.'::text,
        '{}'::text[];
      return;
    end if;

    -- LE VERROU DUR DES ANNONCES. Une prospection dont les réponses
    -- tombent dans le vide n'a pas d'expéditeur identifiable
    -- (art. L.34-5 CPCE) — et le destinataire qui répond « retirez-moi »
    -- n'atteint personne.
    if public.email_normalize(v_oasis.reply_to_email) is null then
      return query select null::text, null::text, null::text,
        'Renseignez l''adresse de réponse d''Oasis Care dans les réglages du courrier : sans elle, les réponses aux annonces se perdraient, et une prospection doit dire à qui elle appartient.'::text,
        '{}'::text[];
      return;
    end if;

    if nullif(btrim(coalesce(v_oasis.siret, '')), '') is null then
      v_warnings := v_warnings || 'Aucun SIRET enregistré pour Oasis Care : le pied de vos annonces sera incomplet.'::text;
    end if;
    if nullif(btrim(coalesce(v_oasis.address_line1, '')), '') is null then
      v_warnings := v_warnings || 'Aucune adresse postale enregistrée pour Oasis Care : le pied de vos annonces sera incomplet.'::text;
    end if;

    return query select
      v_oasis.from_name::text,
      public.email_normalize(v_oasis.reply_to_email),
      -- Pas de logo d'entreprise sur une annonce d'Oasis : ce serait
      -- celui du destinataire.
      null::text,
      null::text,
      v_warnings;
    return;
  end if;

  select * into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org.id is null then
    return query select null::text, null::text, null::text,
      'Entreprise introuvable.'::text, '{}'::text[];
    return;
  end if;

  -- LE SEUL VERROU DUR SUR LE DEVIS.
  if public.email_normalize(v_org.email) is null then
    v_blocking := 'Renseignez l''adresse e-mail de votre entreprise dans ses paramètres : sans elle, les réponses de vos clients se perdraient.';
  elsif not public.email_is_addressable(public.email_normalize(v_org.email)) then
    v_blocking := format('L''adresse e-mail de votre entreprise (« %s ») n''est pas une adresse valide. Corrigez-la dans ses paramètres.', v_org.email);
  end if;

  -- LE VERROU DE LA FACTURE.
  if v_blocking is null and v_tpl.requires_legal_identity then
    if nullif(btrim(coalesce(v_org.siret, '')), '') is null then
      v_blocking := 'Renseignez le SIRET de votre entreprise : une facture sans SIRET n''est pas conforme (art. 242 nonies A du CGI).';
    elsif nullif(btrim(coalesce(v_org.address_line1, '')), '') is null
       or nullif(btrim(coalesce(v_org.postal_code, '')), '') is null
       or nullif(btrim(coalesce(v_org.city, '')), '') is null then
      v_blocking := 'Renseignez l''adresse postale complète de votre entreprise : une facture doit la porter.';
    end if;
  end if;

  -- LES AVERTISSEMENTS. Ils accompagnent, ils n'arrêtent pas.
  if nullif(btrim(coalesce(v_org.vat_number, '')), '') is null then
    v_warnings := v_warnings || 'Aucun numéro de TVA enregistré. Si vous êtes en franchise en base, le document doit porter la mention « TVA non applicable, art. 293 B du CGI ».'::text;
  end if;
  if nullif(btrim(coalesce(v_org.legal_form, '')), '') is null then
    v_warnings := v_warnings || 'Aucune forme juridique enregistrée.'::text;
  end if;
  if nullif(btrim(coalesce(v_org.insurance_decennale_number, '')), '') is null then
    v_warnings := v_warnings || 'Aucun numéro d''assurance décennale enregistré : la mention est obligatoire sur vos documents pour des travaux de paysage.'::text;
  end if;
  if v_org.insurance_expires_on is not null and v_org.insurance_expires_on < current_date then
    v_warnings := v_warnings || 'Votre attestation d''assurance est expirée.'::text;
  end if;
  if nullif(btrim(coalesce(v_org.logo_path, '')), '') is null then
    v_warnings := v_warnings || 'Aucun logo : vos messages partiront sans votre image.'::text;
  end if;

  return query select
    -- LE NOM AFFICHÉ. Lu en base sur l'organisation vérifiée, jamais
    -- saisi au moment de l'envoi : un nom libre depuis un domaine
    -- authentifié serait un outil d'hameçonnage. `name` est le seul
    -- champ NOT NULL de la table, d'où le repli.
    coalesce(nullif(btrim(coalesce(v_org.legal_name, '')), ''), v_org.name)::text,
    public.email_normalize(v_org.email),
    nullif(btrim(coalesce(v_org.logo_path, '')), '')::text,
    v_blocking,
    v_warnings;
end;
$$;

comment on function public.email_sender_identity(uuid, text) is
  'Le motif CRM, vérifié en base : nom affiché de l''entreprise, adresse de réponse, logo. '
  'Rend un blocking_reason plutôt que de lever — l''identité incomplète est un état normal '
  'auquel l''écran s''adapte, comme unavailableReason du côté paiement.';


-- ------------------------------------------------------------
-- 8.a LE DESTINATAIRE, RÉSOLU EN BASE
-- ------------------------------------------------------------
-- La règle : le contact principal non archivé s'il a une adresse,
-- sinon l'adresse du client, sinon un REFUS EXPLICITE — une phrase, pas
-- une exception au moment critique.
create or replace function public.email_recipient_for_customer(
  p_organization_id uuid,
  p_customer_id uuid
)
returns table (
  to_email text,
  to_name text,
  contact_id uuid,
  blocking_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer record;
  v_contact record;
begin
  -- LE CONTRÔLE QUE LA RLS FERAIT. Et ici il est PLUS STRICT
  -- qu'ailleurs : cette fonction rend l'adresse e-mail d'un client, qui
  -- est une donnée métier. Un administrateur de plateforme n'y a donc
  -- PAS accès — 0075 réserve `customer.data.read` à un mécanisme
  -- d'assistance encadré qui n'existe pas encore, et une fonction
  -- `security definer` accessible à tout administrateur serait la porte
  -- dérobée qui contourne ce choix. Seuls un membre de l'entreprise, et
  -- le service qui expédie, passent.
  if auth.uid() is not null
     and not public.is_organization_member(p_organization_id) then
    raise exception 'Accès refusé : ce client n''appartient pas à une entreprise dont vous êtes membre.'
      using errcode = '42501';
  end if;

  select * into v_customer
  from public.crm_customers c
  where c.id = p_customer_id and c.organization_id = p_organization_id;

  if v_customer.id is null then
    -- Le filtre sur l'organisation n'est pas une précaution de style :
    -- il empêche d'écrire au client d'une AUTRE entreprise en passant
    -- son identifiant.
    return query select null::text, null::text, null::uuid,
      'Ce client n''appartient pas à votre entreprise.'::text;
    return;
  end if;

  select * into v_contact
  from public.crm_contacts ct
  where ct.customer_id = p_customer_id
    and ct.organization_id = p_organization_id
    and ct.archived_at is null
    and ct.is_primary
    and public.email_normalize(ct.email) is not null
  order by ct.updated_at desc
  limit 1;

  if v_contact.id is not null then
    return query select
      public.email_normalize(v_contact.email),
      btrim(coalesce(v_contact.first_name, '') || ' ' || v_contact.last_name)::text,
      v_contact.id,
      null::text;
    return;
  end if;

  if public.email_normalize(v_customer.email) is not null then
    return query select
      public.email_normalize(v_customer.email),
      v_customer.display_name::text,
      null::uuid,
      null::text;
    return;
  end if;

  return query select null::text, null::text, null::uuid,
    format('Aucune adresse e-mail pour « %s ». Renseignez-la sur la fiche du client, ou sur son contact principal, avant d''envoyer.',
           v_customer.display_name)::text;
end;
$$;


-- ============================================================
-- 9. LA PORTE — ET LA BRANCHE QUI N'EXISTE PAS
-- ============================================================
--
-- LIRE CETTE FONCTION EN ENTIER AVANT DE LA MODIFIER. Sa forme est le
-- garde-fou : la consultation du consentement et celle de la liste de
-- suppression sont ENFERMÉES dans `if v_tpl.nature = 'publicite'`. La
-- branche transactionnelle ne les lit pas — il n'y a pas une condition
-- à ne pas casser, il n'y a pas de code du tout.
--
-- LE SEUL BLOCAGE QUI VAUT POUR LES DEUX NATURES est la suspension de
-- l'entreprise (§ 4) : un humain l'a décidée, avec un motif, et
-- l'entreprise le lit dans son écran.

create or replace function public.email_gate(
  p_organization_id uuid,
  p_template_key text,
  p_email text
)
returns table (
  allowed boolean,
  blocking_reason text,
  warnings text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tpl record;
  v_email text := public.email_normalize(p_email);
  v_settings record;
  v_consent record;
  v_suppression record;
  v_warnings text[] := '{}';
begin
  -- LE CONTRÔLE QUE LA RLS FERAIT. Sans lui, un jeton quelconque
  -- pourrait sonder le consentement d'une adresse qu'il ne connaît pas,
  -- ou lire le motif de suspension d'une entreprise qui n'est pas la
  -- sienne.
  if auth.uid() is not null
     and not public.is_organization_member(p_organization_id)
     and not public.is_platform_admin() then
    raise exception 'Accès refusé : cette entreprise n''est pas la vôtre.'
      using errcode = '42501';
  end if;

  select * into v_tpl from public.email_templates t where t.key = p_template_key;
  if v_tpl.key is null then
    return query select false,
      format('Gabarit inconnu : « %s ».', coalesce(p_template_key, '(vide)'))::text, '{}'::text[];
    return;
  end if;

  if v_email is null or not public.email_is_addressable(v_email) then
    return query select false,
      'Adresse du destinataire absente ou invalide.'::text, '{}'::text[];
    return;
  end if;

  -- ---- CE QUI VAUT POUR LES DEUX NATURES ---------------------------
  select * into v_settings
  from public.email_organization_settings s where s.organization_id = p_organization_id;

  if v_settings.suspended_at is not null then
    return query select false,
      format('L''expédition de courrier est suspendue pour cette entreprise depuis le %s. Motif : %s',
             to_char(v_settings.suspended_at at time zone 'Europe/Paris', 'DD/MM/YYYY'),
             v_settings.suspended_reason)::text,
      '{}'::text[];
    return;
  end if;

  -- ---- CE QUI NE VAUT QUE POUR LA PUBLICITÉ ------------------------
  --
  -- TOUT CE QUI PEUT REFUSER UN ENVOI POUR UNE RAISON DE CONSENTEMENT
  -- EST DANS CE BLOC, ET DANS AUCUN AUTRE. Le déplacer d'un cran vers
  -- la gauche transformerait ce fichier en la panne qu'il existe pour
  -- empêcher : les factures cesseraient d'arriver, et personne ne
  -- saurait pourquoi.
  if v_tpl.nature = 'publicite' then

    select * into v_consent
    from public.email_consents c
    where c.organization_id = p_organization_id
      and c.email = v_email
      and c.nature = 'publicite';

    if v_consent.id is null or v_consent.consented_at is null then
      return query select false,
        'Aucun consentement préalable enregistré pour cette adresse : la publicité ne part pas.'::text,
        '{}'::text[];
      return;
    end if;

    if v_consent.unsubscribed_at is not null then
      return query select false,
        format('Cette adresse s''est désabonnée le %s.',
               to_char(v_consent.unsubscribed_at at time zone 'Europe/Paris', 'DD/MM/YYYY'))::text,
        '{}'::text[];
      return;
    end if;

    select * into v_suppression
    from public.email_suppressions s
    where s.email = v_email and s.released_at is null
    order by s.last_seen_at desc
    limit 1;

    if v_suppression.id is not null then
      return query select false,
        format('Cette adresse est sur la liste de suppression (%s). Continuer à la solliciter détruirait la réputation du domaine pour tout le parc.',
               v_suppression.kind)::text,
        '{}'::text[];
      return;
    end if;

    return query select true, null::text, '{}'::text[];
    return;
  end if;

  -- ---- LE TRANSACTIONNEL -------------------------------------------
  --
  -- IL PART. Ni le consentement ni la liste de suppression n'ont été
  -- consultés — pas « consultés puis ignorés » : pas consultés. Ce que
  -- l'on sait d'une adresse abîmée devient un AVERTISSEMENT que le
  -- paysagiste lit dans son écran, jamais un refus.
  select * into v_suppression
  from public.email_suppressions s
  where s.email = v_email
    and s.released_at is null
    and s.kind in ('rebondDur', 'bloqueTransporteur')
  order by s.last_seen_at desc
  limit 1;

  if v_suppression.id is not null then
    v_warnings := v_warnings || format(
      'Cette adresse a échoué le %s (%s). Le message part quand même : vérifiez l''adresse auprès de votre client.',
      to_char(v_suppression.last_seen_at at time zone 'Europe/Paris', 'DD/MM/YYYY'),
      v_suppression.kind)::text;
  end if;

  return query select true, null::text, v_warnings;
end;
$$;

comment on function public.email_gate(uuid, text, text) is
  'La porte unique. Le consentement et la liste de suppression ne sont consultés que dans la '
  'branche « publicite » : un transactionnel ne peut pas être refusé pour une raison de '
  'consentement, parce que le code qui le refuserait n''existe pas. Le seul blocage commun est '
  'la suspension de l''entreprise, qu''un humain décide avec un motif et que l''entreprise voit.';


-- ============================================================
-- 10. LA RÉPUTATION, PAR ORGANISATION
-- ============================================================
--
-- Une VUE plutôt qu'un compteur stocké : un compteur dérive, une vue
-- non. Et un niveau d'alerte plutôt qu'une coupure : couper
-- automatiquement arrêterait les factures d'un paysagiste sans que
-- personne ne l'ait décidé.
--
-- LES SEUILS. Les grands fournisseurs de messagerie exigent un taux de
-- plaintes durablement sous 0,3 % ; au-delà, le domaine ENTIER est
-- déclassé — y compris pour les factures d'abonnement d'Oasis et pour
-- les messages d'authentification. Le taux de rebonds toléré est de
-- l'ordre de 5 %. Le plancher de 20 messages évite qu'un envoi unique
-- qui rebondit n'affiche 100 % et ne déclenche une alerte pour rien.

create or replace view public.email_organization_reputation
with (security_invoker = true) as
select
  m.organization_id,
  count(*) filter (where m.queued_at > now() - interval '30 days') as sent_30d,
  count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'bounced') as bounced_30d,
  count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'complained') as complained_30d,
  count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'blocked') as blocked_30d,
  round(
    100.0 * count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'bounced')
    / nullif(count(*) filter (where m.queued_at > now() - interval '30 days'), 0), 2) as bounce_rate_percent,
  round(
    100.0 * count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'complained')
    / nullif(count(*) filter (where m.queued_at > now() - interval '30 days'), 0), 2) as complaint_rate_percent,
  case
    when count(*) filter (where m.queued_at > now() - interval '30 days') < 20 then 'insuffisant'
    when 100.0 * count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'complained')
         / nullif(count(*) filter (where m.queued_at > now() - interval '30 days'), 0) >= 0.3
      or 100.0 * count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'bounced')
         / nullif(count(*) filter (where m.queued_at > now() - interval '30 days'), 0) >= 10 then 'critique'
    when 100.0 * count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'complained')
         / nullif(count(*) filter (where m.queued_at > now() - interval '30 days'), 0) >= 0.1
      or 100.0 * count(*) filter (where m.queued_at > now() - interval '30 days' and m.status = 'bounced')
         / nullif(count(*) filter (where m.queued_at > now() - interval '30 days'), 0) >= 5 then 'surveillance'
    else 'ok'
  end as alert_level
from public.email_messages m
group by m.organization_id;

comment on view public.email_organization_reputation is
  'Rebonds et plaintes sur 30 jours glissants, PAR ORGANISATION — parce que la réputation du '
  'domaine est commune et qu''un seul paysagiste peut la détruire pour tous. Elle ALERTE, elle '
  'ne coupe pas : une coupure automatique arrêterait des factures sans que personne ne l''ait '
  'décidé. security_invoker : chacun n''y voit que les lignes que la RLS lui laisse voir.';


-- ============================================================
-- 11. LE DÉSABONNEMENT SANS COMPTE
-- ============================================================
--
-- Un lien de désabonnement doit fonctionner sans que la personne se
-- connecte. Le jeton est donc utilisable par `anon` — et c'est
-- précisément pourquoi il ne doit RIEN permettre d'autre.
--
-- CE QUE LA FONCTION NE FAIT PAS, et chaque point est une faille
-- évitée :
--   • elle n'ouvre AUCUNE session ;
--   • elle ne rend PAS l'adresse en clair, seulement masquée : un jeton
--     intercepté ne révèle pas à qui il appartient ;
--   • elle ne rend RIEN de l'entreprise, du client, ni d'aucun
--     document ;
--   • elle est le SEUL chemin qui accepte ce jeton — la table n'est
--     lisible par personne d'autre que le service (§ 14).

create or replace function public.email_unsubscribe(p_token text)
returns table (
  done boolean,
  masked_email text,
  message text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consent record;
  v_masked text;
begin
  if p_token is null or length(btrim(p_token)) < 32 then
    return query select false, null::text,
      'Ce lien de désabonnement n''est pas valide.'::text;
    return;
  end if;

  select * into v_consent
  from public.email_consents c
  where c.unsubscribe_token = btrim(p_token);

  if v_consent.id is null then
    -- Le même message que pour un jeton déjà utilisé : on ne dit pas à
    -- un curieux si son jeton a existé.
    return query select false, null::text,
      'Ce lien de désabonnement n''est pas valide.'::text;
    return;
  end if;

  v_masked := left(v_consent.email, 1) || '***@' || split_part(v_consent.email, '@', 2);

  if v_consent.unsubscribed_at is not null then
    return query select true, v_masked,
      'Vous étiez déjà désabonné de nos communications commerciales. Vous continuerez à recevoir vos documents (devis, factures) : ils ne sont pas concernés.'::text;
    return;
  end if;

  update public.email_consents
     set unsubscribed_at = now(),
         unsubscribe_reason = 'Désabonnement par le lien du message.',
         updated_at = now()
   where id = v_consent.id;

  -- Et dans la liste de suppression, pour que le désabonnement suive
  -- l'adresse même si son rattachement change.
  insert into public.email_suppressions (email, kind, reason)
  values (v_consent.email, 'desabonnement', 'Désabonnement par le lien du message.')
  on conflict (email, kind) do update
    set last_seen_at = now(),
        occurrences = public.email_suppressions.occurrences + 1,
        released_at = null, released_by = null, released_reason = null;

  return query select true, v_masked,
    'C''est fait : vous ne recevrez plus nos communications commerciales. Vos documents (devis, factures) continueront de vous parvenir — ils ne sont pas concernés par ce désabonnement.'::text;
end;
$$;

comment on function public.email_unsubscribe(text) is
  'Le désabonnement par jeton, sans compte. Il n''ouvre aucune session, ne rend l''adresse que '
  'masquée, et ne donne accès à rien d''autre. Le message rendu dit explicitement que les '
  'documents continuent d''arriver : c''est la peur numéro un de qui clique sur ce lien.';


-- ------------------------------------------------------------
-- 11.a ENREGISTRER UN CONSENTEMENT
-- ------------------------------------------------------------
-- Appelée par l'écran de réglages de l'entreprise : c'est le paysagiste
-- qui consent pour SA propre adresse. Pas de consentement recueilli
-- pour quelqu'un d'autre, et pas de consentement présumé.
create or replace function public.email_record_consent(
  p_organization_id uuid,
  p_consented boolean,
  p_source text,
  p_evidence text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org record;
  v_email text;
  v_id uuid;
begin
  if not public.has_permission(p_organization_id, 'organization.manageUsers') then
    raise exception 'Accès refusé : seul un responsable de l''entreprise décide de recevoir ou non nos communications commerciales.'
      using errcode = '42501';
  end if;

  if p_source is null or p_source not in ('inscription', 'reglagesEntreprise', 'demandeExplicite') then
    raise exception 'Origine du consentement inconnue : %.', coalesce(p_source, '(vide)')
      using errcode = '23514';
  end if;

  select * into v_org from public.business_organizations o where o.id = p_organization_id;
  v_email := public.email_normalize(v_org.email);

  if v_email is null then
    raise exception 'Renseignez d''abord l''adresse e-mail de votre entreprise.'
      using errcode = '23514';
  end if;

  insert into public.email_consents (organization_id, email, nature,
                                     consented_at, consent_source, consent_evidence)
  values (p_organization_id, v_email, 'publicite',
          case when p_consented then now() else null end,
          case when p_consented then p_source else null end,
          case when p_consented then public.ai_clean_text(p_evidence, 2000) else null end)
  on conflict (organization_id, email, nature) do update
    -- UN CONSENTEMENT REDONNÉ EST UN CONSENTEMENT NEUF, et c'est SA
    -- date qui compte. Le `coalesce` d'origine gardait celle de 2024
    -- pour quelqu'un qui s'était désabonné en 2025 : la preuve était
    -- alors fausse. On ne conserve l'ancienne date que si rien ne
    -- s'est passé entre-temps.
    set consented_at = case
          when not p_consented then null
          when public.email_consents.unsubscribed_at is not null then now()
          else coalesce(public.email_consents.consented_at, now()) end,
        consent_source = case when p_consented then p_source else null end,
        consent_evidence = case when p_consented then public.ai_clean_text(p_evidence, 2000) else null end,
        -- Un consentement redonné lève le désabonnement précédent :
        -- c'est la personne elle-même qui revient. MAIS L'OPPOSITION
        -- NE DISPARAÎT PAS DU REGISTRE : elle recule d'une colonne.
        previous_unsubscribed_at = case
          when p_consented and public.email_consents.unsubscribed_at is not null
            then public.email_consents.unsubscribed_at
          else public.email_consents.previous_unsubscribed_at end,
        previous_unsubscribe_reason = case
          when p_consented and public.email_consents.unsubscribed_at is not null
            then public.email_consents.unsubscribe_reason
          else public.email_consents.previous_unsubscribe_reason end,
        unsubscribed_at = case when p_consented then null
                               else coalesce(public.email_consents.unsubscribed_at, now()) end,
        unsubscribe_reason = case when p_consented then null
                                  else coalesce(public.email_consents.unsubscribe_reason,
                                                'Retrait du consentement depuis les réglages de l''entreprise.') end,
        updated_at = now()
  returning id into v_id;

  -- UN CONSENTEMENT REDONNÉ LÈVE LA SUPPRESSION QU'IL AVAIT LUI-MÊME
  -- CAUSÉE — et rien d'autre.
  --
  -- Sans cette levée, la personne qui revient cocher la case resterait
  -- muette pour toujours : `email_consents` dirait « d'accord » et la
  -- liste de suppression dirait « non », la seconde gagnant. Le
  -- symptôme serait « j'ai réactivé les annonces et je ne reçois rien »,
  -- sans une ligne d'erreur nulle part.
  --
  -- ON NE LÈVE QUE `desabonnement`. Un rebond dur, une plainte ou un
  -- blocage du transporteur sont des FAITS sur l'acheminement, pas des
  -- souhaits : cocher une case ne fait pas réapparaître une boîte qui
  -- n'existe pas, et ne retire pas la plainte que le destinataire a
  -- déposée. Les lever demande le geste motivé d'un administrateur
  -- (§ 13.c).
  if p_consented then
    update public.email_suppressions
       set released_at = now(),
           released_by = auth.uid(),
           released_reason = 'Consentement redonné par l''entreprise elle-même.'
     where email = v_email
       and kind = 'desabonnement'
       and released_at is null;
  end if;

  perform public.record_audit_event(
    p_organization_id,
    case when p_consented then 'emailConsentGiven' else 'emailConsentWithdrawn' end,
    'emailConsent', v_id, null,
    jsonb_build_object('source', p_source), 'web');

  return v_id;
end;
$$;

comment on function public.email_record_consent(uuid, boolean, text, text) is
  'Le consentement d''une entreprise pour SA propre adresse, donné ou retiré depuis ses '
  'réglages. Un consentement redonné lève la suppression de type « désabonnement » qu''il '
  'avait causée — sans elle, la personne qui revient resterait muette pour toujours — mais '
  'jamais un rebond dur ni une plainte, qui sont des faits et non des souhaits.';


-- ============================================================
-- 12. LA MISE EN FILE — LE SEUL CHEMIN D'ÉCRITURE
-- ============================================================
--
-- CE QU'ELLE NE PREND PAS EN PARAMÈTRE EST PLUS IMPORTANT QUE CE
-- QU'ELLE PREND :
--
--   • PAS D'ADRESSE DESTINATAIRE. Elle reçoit un `customer_id` — ou
--     rien, et le destinataire est alors l'entreprise elle-même — et
--     résout l'adresse en base. Un formulaire qui accepterait une
--     adresse arbitraire ferait du serveur un relais de courrier
--     indésirable.
--   • PAS DE NOM D'EXPÉDITEUR ni d'adresse de réponse. Ils sont lus sur
--     l'organisation vérifiée. Un nom libre depuis un domaine
--     authentifié permettrait d'écrire « Votre banque ».
--   • PAS DE NATURE. Elle est recopiée du catalogue, et la clé
--     étrangère composite refuserait autre chose.
--   • PAS DE CLÉ D'IDEMPOTENCE. Elle est générée par la base.
--
-- Elle est réservée à `service_role` (§ 15.c). Un jeton de navigateur
-- ne met rien en file.

create or replace function public.email_enqueue(
  p_organization_id uuid,
  p_template_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_template_version text,
  p_from_email text,
  p_subject text,
  p_body_text text,
  p_body_html_sha256 text,
  p_customer_id uuid default null,
  p_variables jsonb default '{}'::jsonb,
  p_occurrence integer default 1,
  p_campaign_id uuid default null,
  /**
   * VRAI quand l'empreinte remise est un SUBSTITUT que la file
   * remplacera au moment de rendre le HTML. Seule la campagne s'en
   * sert : elle écrit sa ligne avant qu'aucun HTML n'existe.
   */
  p_html_provisoire boolean default false
)
returns table (
  message_id uuid,
  created boolean,
  blocking_reason text,
  warnings text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tpl record;
  v_identity record;
  v_recipient record;
  v_gate record;
  v_kind text;
  v_to_email text;
  v_to_name text;
  v_contact_id uuid;
  v_id uuid;
  v_entite_ok boolean;
  v_warnings text[] := '{}';
begin
  select * into v_tpl from public.email_templates t where t.key = p_template_key;
  if v_tpl.key is null then
    return query select null::uuid, false,
      format('Gabarit inconnu : « %s ».', coalesce(p_template_key, '(vide)'))::text, '{}'::text[];
    return;
  end if;

  -- L'ADRESSE TECHNIQUE D'EXPÉDITION EST POSÉE PAR LE SERVEUR, en
  -- variable d'environnement, et la base ne la connaît pas. Quand elle
  -- manque, on rend une PHRASE plutôt que de lever : « le transporteur
  -- n'est pas configuré sur ce serveur » est un état NORMAL — celui
  -- d'un déploiement où la variable n'a pas encore été posée — et
  -- l'écran doit s'y adapter au lieu de mentir. C'est exactement la
  -- forme d'`unavailableReason` du côté paiement.
  if public.email_normalize(p_from_email) is null
     or not public.email_is_addressable(public.email_normalize(p_from_email)) then
    return query select null::uuid, false,
      'L''adresse technique d''expédition n''est pas configurée sur ce serveur : aucun message ne peut partir tant qu''elle n''est pas posée.'::text,
      '{}'::text[];
    return;
  end if;

  -- ---- L'OBJET LIÉ APPARTIENT-IL À CETTE ENTREPRISE ? ---------------
  --
  -- LE SECOND VERROU DE L'IDEMPOTENCE, ET IL SE LIT AVEC LA COLONNE
  -- GÉNÉRÉE. `entity_id` n'a aucune clé étrangère — il désigne quatre
  -- tables différentes selon `entity_type` — donc rien n'empêchait
  -- jusqu'ici de passer l'identifiant d'une facture appartenant à une
  -- AUTRE entreprise. La clé d'idempotence porte maintenant
  -- l'organisation, ce qui suffit à empêcher la collision ; ce contrôle
  -- ferme l'autre moitié du trou — journaliser un message rattaché à un
  -- objet qu'on ne possède pas.
  --
  -- LE `case` EST AFFECTÉ À UNE VARIABLE PLUTÔT QU'ÉCRIT DANS LE `if`.
  -- plpgsql découpe l'expression d'un `if` au PREMIER `then` qu'il
  -- rencontre : un `case … when … then …` écrit directement dans la
  -- condition rend une erreur de syntaxe au chargement de la fonction.
  v_entite_ok := case p_entity_type
    when 'quote' then exists (
      select 1 from public.quotes q
      where q.id = p_entity_id and q.organization_id = p_organization_id)
    when 'invoice' then exists (
      select 1 from public.invoices i
      where i.id = p_entity_id and i.organization_id = p_organization_id)
    when 'clientInvitation' then exists (
      select 1 from public.client_invitations ci
      where ci.id = p_entity_id and ci.organization_id = p_organization_id)
    -- Un message adressé à l'entreprise elle-même se rattache à
    -- elle-même, et à rien d'autre.
    when 'organization' then p_entity_id = p_organization_id
    else false
  end;

  if not v_entite_ok then
    return query select null::uuid, false,
      'L''objet auquel ce message se rattache n''appartient pas à cette entreprise.'::text,
      '{}'::text[];
    return;
  end if;

  v_kind := case when p_customer_id is null then 'entreprise' else 'clientFinal' end;

  -- Le gabarit dit à qui il a le droit de s'adresser. On ne le
  -- contourne pas en changeant d'argument.
  if v_kind <> v_tpl.audience then
    return query select null::uuid, false,
      format('Le gabarit « %s » s''adresse à « %s » : il ne peut pas être envoyé à « %s ».',
             v_tpl.key, v_tpl.audience, v_kind)::text, '{}'::text[];
    return;
  end if;

  -- L'identité de l'expéditeur — et le verrou du « répondre à ».
  select * into v_identity from public.email_sender_identity(p_organization_id, p_template_key);
  if v_identity.blocking_reason is not null then
    return query select null::uuid, false, v_identity.blocking_reason, v_identity.warnings;
    return;
  end if;
  v_warnings := v_identity.warnings;

  -- LE DESTINATAIRE, RÉSOLU EN BASE.
  --
  -- POUR UN MESSAGE ADRESSÉ À L'ENTREPRISE, ON LIT SON ADRESSE, jamais
  -- le « répondre à » de l'expéditeur : depuis que la publicité est
  -- signée par Oasis, les deux ont cessé d'être la même chose, et
  -- réutiliser l'un pour l'autre enverrait l'annonce à Oasis lui-même,
  -- autant de fois qu'il y a d'entreprises.
  if p_customer_id is null then
    select public.email_normalize(o.email),
           coalesce(nullif(btrim(coalesce(o.legal_name, '')), ''), o.name)
      into v_to_email, v_to_name
    from public.business_organizations o
    where o.id = p_organization_id;

    if v_to_email is null then
      return query select null::uuid, false,
        'Cette entreprise n''a pas d''adresse e-mail : aucun message ne peut lui être adressé.'::text,
        v_warnings;
      return;
    end if;
    v_contact_id := null;
  else
    select * into v_recipient
    from public.email_recipient_for_customer(p_organization_id, p_customer_id);
    if v_recipient.blocking_reason is not null then
      return query select null::uuid, false, v_recipient.blocking_reason, v_warnings;
      return;
    end if;
    v_to_email := v_recipient.to_email;
    v_to_name := v_recipient.to_name;
    v_contact_id := v_recipient.contact_id;
  end if;

  -- LA PORTE.
  select * into v_gate from public.email_gate(p_organization_id, p_template_key, v_to_email);
  if not v_gate.allowed then
    return query select null::uuid, false, v_gate.blocking_reason, v_warnings;
    return;
  end if;
  v_warnings := v_warnings || v_gate.warnings;

  -- L'INSERTION D'ABORD, LE CONSTAT ENSUITE. On n'interroge pas la
  -- table pour savoir si le message est déjà parti : entre la question
  -- et l'insertion, l'autre onglet a le temps d'insérer. C'est la
  -- CONTRAINTE qui tranche.
  begin
    insert into public.email_messages (
      organization_id, template_key, nature, template_version,
      recipient_kind, to_email, to_name, customer_id, contact_id,
      entity_type, entity_id,
      from_email, from_name, reply_to_email,
      subject, body_text, body_html_sha256, body_html_sha256_provisoire, variables,
      occurrence, campaign_id, warnings)
    values (
      p_organization_id, v_tpl.key, v_tpl.nature, btrim(p_template_version),
      v_kind, v_to_email, v_to_name, p_customer_id, v_contact_id,
      p_entity_type, p_entity_id,
      public.email_normalize(p_from_email), v_identity.from_name, v_identity.reply_to_email,
      btrim(p_subject), p_body_text, lower(btrim(p_body_html_sha256)),
      coalesce(p_html_provisoire, false),
      coalesce(p_variables, '{}'::jsonb),
      coalesce(p_occurrence, 1), p_campaign_id, v_warnings)
    returning id into v_id;
  exception when unique_violation then
    select m.id into v_id from public.email_messages m
     where m.idempotency_key =
       p_organization_id::text || ':'
       || coalesce(p_campaign_id::text, 'transactionnel') || ':' || p_entity_type || ':'
       || p_entity_id::text || ':' || p_template_key || ':' || coalesce(p_occurrence, 1)::text;
    return query select v_id, false,
      'Ce message est déjà parti : il ne repart pas.'::text, v_warnings;
    return;
  end;

  -- LA TRACE, DU BON CÔTÉ. Un envoi métier s'inscrit au journal de
  -- l'entreprise (audit_events, dont actor_user_id est nullable par
  -- dessein : un envoi déclenché par un changement d'état n'a pas
  -- d'auteur humain). La publicité d'Oasis s'inscrit ailleurs, dans
  -- admin_audit_events, et c'est admin_send_email_campaign qui le fait.
  if v_tpl.nature = 'transactionnel' then
    insert into public.audit_events (organization_id, actor_user_id, action,
                                     entity_type, entity_id, new_value, source)
    values (p_organization_id, auth.uid(), 'emailQueued', p_entity_type, p_entity_id,
            jsonb_build_object('template', v_tpl.key, 'occurrence', coalesce(p_occurrence, 1)),
            -- 'system' et non 'ai'. LA FRONTIÈRE EST ICI : un envoi
            -- déclenché par un CHANGEMENT D'ÉTAT est légitime et c'est
            -- ce que le produit demande ; un envoi décidé par un MODÈLE
            -- ne l'est pas et n'a pas de chemin dans ce fichier — le
            -- catalogue des gabarits n'a pas de déclencheur 'ia'.
            'system');
  end if;

  return query select v_id, true, null::text, v_warnings;
end;
$$;

comment on function public.email_enqueue is
  'Le seul chemin d''écriture du journal. Elle ne prend NI adresse destinataire, NI nom '
  'd''expéditeur, NI nature, NI clé d''idempotence : les quatre sont lus ou générés en base. '
  'Ce qu''elle refuse de recevoir est ce qui ferait d''elle un relais de courrier indésirable '
  'ou un outil d''hameçonnage.';


-- ------------------------------------------------------------
-- 12.a LA RÉSERVATION — LE VERROU QUI MANQUAIT
-- ------------------------------------------------------------
--
-- LIRE CE COMMENTAIRE AVANT DE TOUCHER À LA FILE.
--
-- La contrainte d'unicité sur `idempotency_key` garde l'INSERTION d'un
-- message. Elle ne garde PAS la file, qui n'insère rien : elle relit
-- des lignes qui existent déjà. Un `select … where status = 'queued'`
-- suivi d'un appel au transporteur laisse donc deux passages
-- simultanés — deux tics d'ordonnanceur, un cron qui expire à dix
-- secondes et rejoue pendant que le premier travaille, deux instances
-- de la fonction — expédier DEUX FOIS chaque message en attente. Et le
-- doublon est invisible : le second marquage retombe sur la même
-- ligne, le journal ne montre qu'un envoi, et c'est le client qui
-- signale qu'il a reçu trois fois sa facture.
--
-- `for update skip locked` EST CE QUI REND LES PASSAGES SIMULTANÉS
-- INOFFENSIFS : la seconde transaction ne bloque pas, elle saute les
-- lignes déjà prises et repart avec les suivantes, ou avec rien.
--
-- LE COMPTEUR MONTE AVANT L'APPEL SORTANT. Une ligne dont les
-- tentatives montent sans aboutir finit par se déclarer en échec
-- définitif ; une ligne qui repartirait indéfiniment parce que son
-- marquage échoue n'a aucune borne.

create or replace function public.email_claim_queued(
  p_limit integer default 50,
  p_worker text default null
)
returns setof public.email_messages
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.email_messages m
     set status = 'sending',
         claimed_at = now(),
         claimed_by = nullif(btrim(coalesce(p_worker, '')), ''),
         attempts = m.attempts + 1,
         next_attempt_at = null
   where m.id in (
     select q.id
     from public.email_messages q
     where q.status = 'queued'
       and (q.next_attempt_at is null or q.next_attempt_at <= now())
     order by q.queued_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 50), 200))
   )
  returning m.*;
$$;

comment on function public.email_claim_queued(integer, text) is
  'Réserve des messages avant de les transporter : « queued » devient « sending » dans la '
  'même instruction qui les rend. `for update skip locked` fait que deux passages simultanés '
  'ne prennent jamais la même ligne — la contrainte d''unicité, elle, ne garde que '
  'l''insertion et ne protège pas ce chemin.';

-- LA MÊME RÉSERVATION, POUR UN MESSAGE PRÉCIS. Le chemin « un devis
-- vient d'être marqué envoyé » transporte tout de suite après avoir
-- enfilé ; sans réservation, un passage de file simultané prendrait la
-- même ligne. Rend VRAI si la réservation est acquise, FAUX si
-- quelqu'un d'autre l'a déjà.
create or replace function public.email_claim_one(
  p_message_id uuid,
  p_worker text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.email_messages
     set status = 'sending',
         claimed_at = now(),
         claimed_by = nullif(btrim(coalesce(p_worker, '')), ''),
         attempts = attempts + 1,
         next_attempt_at = null
   where id = p_message_id
     and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- ------------------------------------------------------------
-- 12.b CE QUE LE TRANSPORTEUR RÉPOND
-- ------------------------------------------------------------
create or replace function public.email_mark_sent(
  p_message_id uuid,
  p_transporter_key text,
  p_transporter_message_id text,
  /**
   * L'EMPREINTE RÉELLEMENT REMISE. Renseignée seulement pour les
   * lignes dont l'empreinte était provisoire — les campagnes, écrites
   * en base avant que le HTML n'existe. Ailleurs, l'empreinte est
   * posée à la mise en file et gelée.
   */
  p_body_html_sha256 text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.email_messages
     set status = case when public.email_status_rank('sent') > public.email_status_rank(status)
                       then 'sent' else status end,
         sent_at = coalesce(sent_at, now()),
         last_event_at = now(),
         claimed_at = null,
         transporter_key = coalesce(p_transporter_key, transporter_key),
         transporter_message_id = coalesce(p_transporter_message_id, transporter_message_id),
         body_html_sha256 = case
           when body_html_sha256_provisoire and p_body_html_sha256 ~ '^[0-9a-f]{64}$'
             then lower(p_body_html_sha256)
           else body_html_sha256 end,
         body_html_sha256_provisoire = case
           when body_html_sha256_provisoire and p_body_html_sha256 ~ '^[0-9a-f]{64}$'
             then false
           else body_html_sha256_provisoire end
   where id = p_message_id;
  get diagnostics v_count = row_count;
  -- ELLE REND UN BOOLÉEN, ET L'APPELANT DOIT LE LIRE. Un marquage qui
  -- échoue après que le message est parti laisse la ligne en file : au
  -- passage suivant, elle repart. C'est le doublon franc, celui qui ne
  -- demande aucune concurrence pour se produire.
  return v_count = 1;
end;
$$;

/**
 * L'ÉCHEC.
 *
 * DEUX ÉCHECS QUI N'ONT RIEN À VOIR, ET LES CONFONDRE COÛTAIT UNE
 * JOURNÉE DE FACTURES. Un 400 « adresse invalide » est DÉFINITIF : le
 * rejouer ne fera que le refaire. Un 429 « plafond du jour atteint »,
 * un 5xx, une coupure réseau sont TEMPORAIRES — et 429 est précisément
 * ce qui arrive un lundi matin, quand les relances se groupent et que
 * le plafond journalier du transporteur mord.
 *
 * Le fichier promettait au paysagiste « il repartira une fois le
 * plafond levé », et rien ne le repartait : 'failed' est terminal, la
 * file ne lit que 'queued', et aucun bouton du produit ne remet une
 * ligne en file. La promesse est maintenant tenue par le code plutôt
 * que par la phrase.
 */
create or replace function public.email_mark_failed(
  p_message_id uuid,
  p_failure_reason text,
  p_failure_code text default null,
  p_transporter_key text default null,
  /** VRAI = on réessaiera. FAUX = c'est fini, et le journal le dit. */
  p_temporaire boolean default false,
  /** Le délai avant le prochain essai. */
  p_delai interval default interval '15 minutes',
  /** Au-delà, un échec temporaire devient définitif. */
  p_tentatives_max integer default 5
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg record;
  v_count integer;
begin
  if nullif(btrim(coalesce(p_failure_reason, '')), '') is null then
    raise exception 'Un échec dit pourquoi : c''est cette phrase que le paysagiste lira dans son écran.'
      using errcode = '23514';
  end if;

  select * into v_msg from public.email_messages where id = p_message_id;
  if v_msg.id is null then
    return false;
  end if;

  -- L'ÉCHEC TEMPORAIRE REMET LA LIGNE EN FILE, tant qu'il reste des
  -- tentatives. Le motif est écrit quand même : le paysagiste doit
  -- pouvoir lire « le transporteur a atteint son plafond, nouvel essai
  -- à 15 h » plutôt que de voir un message qui semble ne rien faire.
  if p_temporaire
     and v_msg.status = 'sending'
     and v_msg.attempts < greatest(1, coalesce(p_tentatives_max, 5)) then
    update public.email_messages
       set status = 'queued',
           claimed_at = null,
           next_attempt_at = now() + coalesce(p_delai, interval '15 minutes'),
           failure_reason = p_failure_reason,
           failure_code = p_failure_code,
           last_event_at = now(),
           transporter_key = coalesce(p_transporter_key, transporter_key)
     where id = p_message_id;
    return true;
  end if;

  update public.email_messages
     set status = 'failed',
         claimed_at = null,
         next_attempt_at = null,
         failure_reason = case
           when p_temporaire then p_failure_reason
             || format(' Après %s tentatives, nous cessons d''essayer : ce message ne partira pas.',
                       v_msg.attempts)
           else p_failure_reason end,
         failure_code = p_failure_code,
         last_event_at = now(),
         transporter_key = coalesce(p_transporter_key, transporter_key)
   where id = p_message_id
     and public.email_status_rank('failed') > public.email_status_rank(status);
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

/**
 * LE SORT INCONNU — ET C'EST L'ÉTAT LE PLUS HONNÊTE DU FICHIER.
 *
 * Quand `fetch` rejette après que le transporteur a accepté le POST, ou
 * qu'il répond 2xx sans identifiant, on NE SAIT PAS si le message est
 * parti. La couche affirmait « le message n'est pas parti ; il pourra
 * être renvoyé » — une affirmation sur un fait inconnu, fausse dans le
 * cas le plus fréquent : le client reçoit son document et l'écran du
 * paysagiste jure qu'il ne l'a pas reçu.
 *
 * On ne marque donc NI 'sent' NI 'failed'. La ligne reste 'sending' —
 * donc ni rejouée par la file, ni déclarée perdue — avec une phrase qui
 * dit la vérité et réclame un œil humain.
 */
create or replace function public.email_mark_uncertain(
  p_message_id uuid,
  p_failure_reason text,
  p_transporter_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.email_messages
     set failure_reason = coalesce(nullif(btrim(coalesce(p_failure_reason, '')), ''),
           'Nous n''avons pas eu de réponse du transporteur : ce message est peut-être parti. Vérifiez avant de le renvoyer.'),
         failure_code = 'sortInconnu',
         last_event_at = now(),
         transporter_key = coalesce(p_transporter_key, transporter_key)
   where id = p_message_id
     and status = 'sending';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

/**
 * ANNULER CE QUI ATTEND ENCORE.
 *
 * LE CAS RÉEL : le transporteur est momentanément absent, la ligne
 * reste en file — comportement voulu — et pendant ce temps le
 * paysagiste annule la facture. Sans cette fonction, le passage suivant
 * expédiait quand même : le vidage ne relisait ni le statut de la
 * facture, ni son solde. Le rang 9 était déclaré dans la contrainte et
 * RIEN dans le produit ne l'écrivait jamais.
 *
 * Elle est ouverte aux membres de l'entreprise, et non au seul service :
 * c'est `cancelInvoice`, qui tourne sous le jeton du paysagiste, qui
 * doit pouvoir l'appeler.
 */
create or replace function public.email_cancel_queued(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_reason text;
begin
  if auth.uid() is not null
     and not public.is_organization_member(p_organization_id) then
    raise exception 'Accès refusé : cette entreprise n''est pas la vôtre.'
      using errcode = '42501';
  end if;

  v_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
                       'Le document a été annulé avant que le message ne parte.');

  -- SEULEMENT CE QUI N'EST PAS ENCORE PARTI. Une ligne en 'sending' est
  -- peut-être déjà chez le transporteur : l'annuler mentirait.
  update public.email_messages
     set status = 'cancelled',
         failure_reason = v_reason,
         failure_code = 'annule',
         last_event_at = now()
   where organization_id = p_organization_id
     and entity_type = p_entity_type
     and entity_id = p_entity_id
     and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * LA PORTE, REJOUÉE AU MOMENT D'EXPÉDIER.
 *
 * TROIS DÉFAUTS SE REFERMENT ICI D'UN SEUL GESTE, et ils avaient la
 * même cause : le vidage de la file ne relisait que l'identité de
 * l'expéditeur.
 *
 *   • UNE PUBLICITÉ DÉJÀ EN FILE PARTAIT malgré une plainte ou un
 *     rebond survenu entre-temps. Une campagne enfile une ligne par
 *     entreprise et personne ne les transporte avant le passage
 *     suivant : la fenêtre est réelle, pas théorique.
 *   • SUSPENDRE UNE ENTREPRISE N'ARRÊTAIT PAS SES MESSAGES EN FILE.
 *     C'est pourtant le seul frein d'urgence qui protège la réputation
 *     du domaine partagé, et il ne freinait que les envois futurs.
 *   • UN DOCUMENT ANNULÉ PARTAIT QUAND MÊME.
 *
 * ON REJOUE `email_gate`, la MÊME fonction qu'à la mise en file. Un
 * second jeu de règles aurait divergé, et la divergence aurait été
 * invisible jusqu'au jour où elle aurait laissé partir ce qu'il
 * fallait retenir.
 */
create or replace function public.email_still_sendable(p_message_id uuid)
returns table (ok boolean, blocking_reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg record;
  v_gate record;
  v_quote record;
  v_invoice record;
begin
  select * into v_msg from public.email_messages m where m.id = p_message_id;
  if v_msg.id is null then
    return query select false, 'Ce message n''existe plus.'::text;
    return;
  end if;

  -- LA PORTE, SANS RIEN RÉÉCRIRE. Elle lit la suspension de
  -- l'entreprise pour les deux natures, et le consentement pour la
  -- seule publicité — la branche transactionnelle ne consulte toujours
  -- pas le registre.
  select * into v_gate
  from public.email_gate(v_msg.organization_id, v_msg.template_key, v_msg.to_email);
  if not v_gate.allowed then
    return query select false, v_gate.blocking_reason;
    return;
  end if;

  -- L'OBJET MÉTIER EST-IL TOUJOURS CE QU'IL ÉTAIT ?
  if v_msg.entity_type = 'invoice' then
    select i.status, i.archived_at into v_invoice
    from public.invoices i where i.id = v_msg.entity_id;
    if v_invoice.status is null then
      return query select false, 'La facture liée à ce message n''existe plus.'::text;
      return;
    end if;
    if v_invoice.status in ('cancelled', 'credited') or v_invoice.archived_at is not null then
      return query select false,
        'Cette facture a été annulée depuis la préparation du message : il ne part pas.'::text;
      return;
    end if;
  elsif v_msg.entity_type = 'quote' then
    select q.status, q.archived_at, q.decided_at into v_quote
    from public.quotes q where q.id = v_msg.entity_id;
    if v_quote.status is null then
      return query select false, 'Le devis lié à ce message n''existe plus.'::text;
      return;
    end if;
    if v_quote.status = 'cancelled' or v_quote.archived_at is not null then
      return query select false,
        'Ce devis a été annulé depuis la préparation du message : il ne part pas.'::text;
      return;
    end if;
    -- UNE DÉCISION TOMBÉE N'ARRÊTE QUE LA RELANCE. Le devis lui-même
    -- doit partir : c'est en le lisant que le client décidera.
    if v_msg.template_key = 'devisRelance' and v_quote.decided_at is not null then
      return query select false,
        'Ce devis a reçu une réponse depuis la préparation de la relance : elle ne part pas.'::text;
      return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;

create or replace function public.email_record_event(
  p_transporter_key text,
  p_transporter_message_id text,
  p_event text,
  p_occurred_at timestamptz,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message_id uuid;
  v_id uuid;
begin
  select m.id into v_message_id
  from public.email_messages m
  where m.transporter_message_id = p_transporter_message_id
    and (p_transporter_key is null or m.transporter_key is null or m.transporter_key = p_transporter_key)
  order by m.queued_at desc
  limit 1;

  -- ON ENREGISTRE MÊME SANS RATTACHEMENT. Un rebond dont on ne retrouve
  -- pas le message reste une information sur la réputation du domaine,
  -- et la jeter serait se priver du seul signal qu'on ait.
  insert into public.email_events (message_id, transporter_key, transporter_message_id,
                                   event, occurred_at, reason, payload)
  values (v_message_id, p_transporter_key, p_transporter_message_id,
          p_event, coalesce(p_occurred_at, now()), p_reason, coalesce(p_payload, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;


-- ============================================================
-- 13. LES FONCTIONS D'ADMINISTRATION
-- ============================================================

-- ------------------------------------------------------------
-- 13.a LA CAMPAGNE
-- ------------------------------------------------------------
create or replace function public.admin_create_email_campaign(
  p_title text,
  p_subject text,
  p_body_text text,
  p_reason text,
  p_template_key text default 'annonceCommerciale'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_id uuid;
begin
  if not public.platform_admin_can('emails.campaigns.send') then
    raise exception 'Accès refusé : écrire à toutes les entreprises du parc n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : écrire à tout le parc se justifie au moment où on le fait.'
      using errcode = '23514';
  end if;

  insert into public.email_campaigns (title, template_key, subject, body_text, reason, created_by)
  values (public.ai_clean_text(p_title, 200), p_template_key,
          public.ai_clean_text(p_subject, 300), p_body_text, v_reason, auth.uid())
  returning id into v_id;

  perform public.record_admin_event(
    'emailCampaign.created', 'emailCampaign', v_id, public.ai_clean_text(p_title, 200),
    null, jsonb_build_object('template', p_template_key), v_reason);

  return v_id;
end;
$$;

-- L'ENVOI. Il parcourt les ENTREPRISES, et rien d'autre.
--
-- LE TEST QUI COMPTE EST CELUI QU'ON NE VOIT PAS ICI : aucune requête
-- de cette fonction ne touche `crm_customers` ni `crm_contacts`. Le
-- client final d'un paysagiste n'a rien signé avec Oasis Care, et il
-- n'existe aucun chemin par lequel son adresse pourrait entrer dans une
-- campagne — `email_enqueue` est appelée sans `p_customer_id`, ce qui
-- force `recipient_kind = 'entreprise'`, que la contrainte
-- `email_messages_publicite_jamais_au_client_final` exigerait de toute
-- façon.
create or replace function public.admin_send_email_campaign(
  p_campaign_id uuid,
  p_reason text
)
returns table (queued integer, skipped integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_campaign record;
  v_org record;
  v_result record;
  v_expediteur text;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  if not public.platform_admin_can('emails.campaigns.send') then
    raise exception 'Accès refusé : écrire à toutes les entreprises du parc n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  -- L'ADRESSE TECHNIQUE, VÉRIFIÉE AVANT DE BRÛLER LA CAMPAGNE.
  --
  -- LE DÉFAUT CORRIGÉ : cette fonction posait `status = 'sending'`
  -- d'abord, puis découvrait ligne après ligne que l'adresse
  -- d'expédition manquait ; chaque mise en file était refusée, la
  -- campagne finissait quand même en 'sent' avec « 0 mis en file », et
  -- une campagne ne se rejoue pas. Dix minutes de rédaction perdues, et
  -- l'écran affichait un succès.
  --
  -- LE RÉGLAGE VIENT DU SERVEUR, PAS D'UN FORMULAIRE. Un appel
  -- PostgREST ne peut pas faire `set local` : il faut donc attacher le
  -- réglage au rôle de connexion, UNE FOIS, à la main —
  --   alter role authenticator set oasis.email_expediteur = '…';
  -- — et la notice de mise en service le dit. Le mettre en paramètre
  -- reviendrait à laisser un administrateur choisir le DOMAINE
  -- d'expédition, ce qui est exactement l'hameçonnage qu'on refuse.
  v_expediteur := public.email_normalize(current_setting('oasis.email_expediteur', true));
  if v_expediteur is null or not public.email_is_addressable(v_expediteur) then
    raise exception 'L''adresse technique d''expédition n''est pas configurée sur ce serveur : la campagne reste en brouillon. Posez le réglage « oasis.email_expediteur » sur le rôle de connexion de la base, puis recommencez.'
      using errcode = '23514';
  end if;

  -- L'ÉCRITURE CONDITIONNELLE **EST** LE TEST. Un `select` suivi d'un
  -- `update` laisse deux appels simultanés franchir tous deux le
  -- contrôle de statut : les destinataires sont protégés par la
  -- contrainte d'unicité, mais le second `update` final écrasait
  -- `queued_count` à zéro pour une campagne réellement partie, et le
  -- journal d'administration recevait deux entrées contradictoires.
  update public.email_campaigns
     set status = 'sending'
   where id = p_campaign_id and status = 'draft'
  returning * into v_campaign;

  if v_campaign.id is null then
    if exists (select 1 from public.email_campaigns c where c.id = p_campaign_id) then
      raise exception 'Cette campagne n''est plus un brouillon : une campagne ne se rejoue pas.'
        using errcode = '23505';
    end if;
    raise exception 'Campagne introuvable.' using errcode = '23503';
  end if;

  for v_org in
    select o.id, o.name
    from public.business_organizations o
    where o.archived_at is null
      and public.email_normalize(o.email) is not null
    order by o.name
  loop
    select * into v_result from public.email_enqueue(
      p_organization_id   => v_org.id,
      p_template_key      => v_campaign.template_key,
      p_entity_type       => 'organization',
      p_entity_id         => v_org.id,
      p_template_version  => 'campagne',
      -- L'ADRESSE TECHNIQUE D'EXPÉDITION VIENT DU SERVEUR, JAMAIS DE
      -- L'ÉCRAN. Le serveur la pose en réglage de session
      -- (`set local oasis.email_expediteur = …`) depuis sa variable
      -- d'environnement, avant d'appeler cette fonction. Elle n'est PAS
      -- un paramètre : un administrateur qui pourrait choisir l'adresse
      -- d'expédition depuis un formulaire choisirait le domaine
      -- d'expédition, ce qui est exactement l'hameçonnage qu'on refuse.
      -- Il est vérifié plus haut : la campagne reste en brouillon
      -- plutôt que de se consommer sans rien envoyer.
      p_from_email        => v_expediteur,
      p_subject           => v_campaign.subject,
      p_body_text         => v_campaign.body_text,
      -- UNE EMPREINTE PROVISOIRE, ET DÉCLARÉE COMME TELLE. Le HTML
      -- n'existe pas encore : c'est la file qui le rendra. Poser ici
      -- l'empreinte du TEXTE en la présentant comme celle du HTML
      -- rendait le journal faux — « refabriquer et prouver que c'est
      -- identique » n'aurait jamais marché pour une campagne.
      -- `email_mark_sent` posera la vraie.
      p_body_html_sha256  => encode(sha256(convert_to(v_campaign.body_text, 'UTF8')), 'hex'),
      p_customer_id       => null,
      p_variables         => jsonb_build_object('entreprise', v_org.name),
      p_occurrence        => 1,
      p_campaign_id       => p_campaign_id,
      p_html_provisoire   => true);

    if v_result.created then
      v_queued := v_queued + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  update public.email_campaigns
     set status = 'sent', sent_at = now(), queued_count = v_queued, skipped_count = v_skipped
   where id = p_campaign_id;

  perform public.record_admin_event(
    'emailCampaign.sent', 'emailCampaign', p_campaign_id, v_campaign.title,
    null, jsonb_build_object('queued', v_queued, 'skipped', v_skipped), v_reason);

  return query select v_queued, v_skipped;
end;
$$;

-- ------------------------------------------------------------
-- 13.b L'INTERRUPTEUR PAR ENTREPRISE
-- ------------------------------------------------------------
create or replace function public.admin_suspend_organization_email(
  p_organization_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org record;
begin
  if not public.platform_admin_can('emails.sending.suspend') then
    raise exception 'Accès refusé : suspendre l''expédition d''une entreprise n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : couper l''expédition d''une entreprise arrête aussi ses FACTURES. Elle lira ce motif dans son écran.'
      using errcode = '23514';
  end if;

  select * into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org.id is null then
    raise exception 'Entreprise introuvable.' using errcode = '23503';
  end if;

  insert into public.email_organization_settings (organization_id, suspended_at, suspended_by, suspended_reason)
  values (p_organization_id, now(), auth.uid(), v_reason)
  on conflict (organization_id) do update
    set suspended_at = now(), suspended_by = auth.uid(),
        suspended_reason = v_reason, updated_at = now();

  perform public.record_admin_event(
    'emailSending.suspended', 'organization', p_organization_id, v_org.name,
    null, jsonb_build_object('suspended', true), v_reason);
end;
$$;

create or replace function public.admin_resume_organization_email(
  p_organization_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org record;
begin
  if not public.platform_admin_can('emails.sending.suspend') then
    raise exception 'Accès refusé : rétablir l''expédition d''une entreprise n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  select * into v_org from public.business_organizations o where o.id = p_organization_id;

  update public.email_organization_settings
     set suspended_at = null, suspended_by = null, suspended_reason = null, updated_at = now()
   where organization_id = p_organization_id;

  perform public.record_admin_event(
    'emailSending.resumed', 'organization', p_organization_id, v_org.name,
    null, jsonb_build_object('suspended', false), v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 13.c LEVER UNE SUPPRESSION
-- ------------------------------------------------------------
-- ELLE PREND UN IDENTIFIANT, PAS UNE ADRESSE, et ce n'est pas un
-- détail de style : depuis le § 13.d, un administrateur ne voit plus
-- les adresses qu'en clair partiel. Lui demander de retaper une adresse
-- qu'il ne peut pas lire aurait été soit impossible, soit la preuve
-- qu'il la lit ailleurs.
create or replace function public.admin_release_email_suppression(
  p_suppression_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_row record;
  v_count integer;
begin
  if not public.platform_admin_can('emails.suppression.manage') then
    raise exception 'Accès refusé : lever une suppression n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : réhabiliter une adresse qui s''est plainte engage la réputation du domaine pour tout le parc.'
      using errcode = '23514';
  end if;

  select * into v_row from public.email_suppressions s where s.id = p_suppression_id;
  if v_row.id is null then
    raise exception 'Suppression introuvable.' using errcode = '23503';
  end if;

  update public.email_suppressions
     set released_at = now(), released_by = auth.uid(), released_reason = v_reason
   where id = p_suppression_id
     and released_at is null;
  get diagnostics v_count = row_count;

  perform public.record_admin_event(
    'emailSuppression.released', 'emailAddress', p_suppression_id,
    public.email_mask(v_row.email),
    null, jsonb_build_object('kind', v_row.kind, 'rows', v_count), v_reason);

  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 13.d LA LISTE DE SUPPRESSION, MASQUÉE
-- ------------------------------------------------------------
--
-- CE QUE CETTE FONCTION EMPÊCHE : que les adresses des CLIENTS FINAUX
-- des paysagistes s'affichent en clair dans Oasis Admin.
--
-- La liste est alimentée automatiquement depuis `to_email` de tout
-- message qui rebondit — donc, en très grande majorité, des devis et
-- des factures adressés aux clients des paysagistes. Le même fichier
-- refuse pourtant cette donnée au super-administrateur lui-même dans
-- `email_recipient_for_customer` (« 0075 réserve `customer.data.read` à
-- un mécanisme qui n'existe pas encore »), et le garde-fou de matrice
-- ne rattrapait rien parce qu'il ne filtre que le préfixe `customer.%`.
--
-- Un masque et un domaine suffisent à répondre à la seule question
-- qu'on pose vraiment — « mon client dit qu'il n'a rien reçu, est-il
-- sur la liste ? » — sans publier un carnet d'adresses.
create or replace function public.email_mask(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_email is null or p_email = '' then null
    else left(p_email, 1) || '***@' || split_part(p_email, '@', 2)
  end;
$$;

create or replace function public.email_suppression_digest(
  p_domain text default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  masked_email text,
  domain text,
  kind text,
  reason text,
  transporter_key text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  occurrences integer,
  released_at timestamptz,
  released_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.platform_admin_can('emails.suppression.read') then
    raise exception 'Accès refusé : la liste de suppression n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;

  return query
  select s.id,
         public.email_mask(s.email),
         split_part(s.email, '@', 2),
         s.kind, s.reason, s.transporter_key,
         s.first_seen_at, s.last_seen_at, s.occurrences,
         s.released_at, s.released_reason
  from public.email_suppressions s
  where p_domain is null or split_part(s.email, '@', 2) = lower(btrim(p_domain))
  order by s.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- ------------------------------------------------------------
-- 13.e LA RÉPUTATION VUE PAR OASIS — DES NOMBRES, PAS DES LIGNES
-- ------------------------------------------------------------
--
-- LA VUE DU § 10 EST `security_invoker`, et la seule politique de
-- `email_messages` ouverte à un administrateur est
-- `nature = 'publicite'`. Conséquence : un paysagiste qui vient de
-- faire rebondir deux cents devis n'apparaissait NULLE PART côté Oasis.
-- Le risque numéro un du chantier — un client qui détruit la
-- réputation d'un domaine partagé — n'était donc pas mesuré par ceux
-- qui peuvent y répondre.
--
-- Cette fonction compte TOUS les messages sans en montrer AUCUN : ni
-- adresse, ni objet, ni corps. Des nombres, un niveau d'alerte, et le
-- nom de l'entreprise — de quoi décider d'une suspension, rien de plus.
create or replace function public.admin_email_reputation(p_jours integer default 30)
returns table (
  organization_id uuid,
  organization_name text,
  suspended_at timestamptz,
  suspended_reason text,
  sent_count bigint,
  bounced_count bigint,
  complained_count bigint,
  blocked_count bigint,
  failed_count bigint,
  bounce_rate_percent numeric,
  complaint_rate_percent numeric,
  alert_level text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_depuis timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 365)));
begin
  if not public.platform_admin_can('emails.log.read') then
    raise exception 'Accès refusé : la délivrabilité du parc n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;

  return query
  with compte as (
    select m.organization_id as org,
           count(*) as total,
           count(*) filter (where m.status = 'bounced') as rebonds,
           count(*) filter (where m.status = 'complained') as plaintes,
           count(*) filter (where m.status = 'blocked') as bloques,
           count(*) filter (where m.status = 'failed') as echecs
    from public.email_messages m
    where m.queued_at > v_depuis
    group by m.organization_id
  )
  select o.id,
         o.name::text,
         s.suspended_at,
         s.suspended_reason,
         coalesce(c.total, 0),
         coalesce(c.rebonds, 0),
         coalesce(c.plaintes, 0),
         coalesce(c.bloques, 0),
         coalesce(c.echecs, 0),
         round(100.0 * coalesce(c.rebonds, 0) / nullif(c.total, 0), 2),
         round(100.0 * coalesce(c.plaintes, 0) / nullif(c.total, 0), 2),
         case
           when coalesce(c.total, 0) < 20 then 'insuffisant'
           when 100.0 * c.plaintes / nullif(c.total, 0) >= 0.3
             or 100.0 * c.rebonds / nullif(c.total, 0) >= 10 then 'critique'
           when 100.0 * c.plaintes / nullif(c.total, 0) >= 0.1
             or 100.0 * c.rebonds / nullif(c.total, 0) >= 5 then 'surveillance'
           else 'ok'
         end::text
  from public.business_organizations o
  left join compte c on c.org = o.id
  left join public.email_organization_settings s on s.organization_id = o.id
  where o.archived_at is null
  order by coalesce(c.plaintes, 0) + coalesce(c.rebonds, 0) desc, o.name;
end;
$$;

-- ------------------------------------------------------------
-- 13.f L'IDENTITÉ D'OASIS, ET L'ADRESSE TECHNIQUE, VUES DE L'ÉCRAN
-- ------------------------------------------------------------
--
-- LE DIAGNOSTIC AVANT LE GESTE. Un administrateur qui rédige une
-- annonce pendant dix minutes doit savoir AVANT de cliquer si le
-- serveur sait expédier. Cette fonction ne rend que ce qu'un écran
-- d'administration a besoin de montrer : l'adresse technique
-- configurée (ou son absence), et l'identité d'expéditeur d'Oasis.
create or replace function public.email_platform_status()
returns table (
  technical_sender text,
  sender_configured boolean,
  from_name text,
  reply_to_email text,
  legal_complete boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_expediteur text := public.email_normalize(current_setting('oasis.email_expediteur', true));
  v_id record;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select * into v_id from public.email_platform_identity limit 1;

  return query select
    v_expediteur,
    (v_expediteur is not null and public.email_is_addressable(v_expediteur)),
    v_id.from_name::text,
    public.email_normalize(v_id.reply_to_email),
    (nullif(btrim(coalesce(v_id.siret, '')), '') is not null
     and nullif(btrim(coalesce(v_id.address_line1, '')), '') is not null
     and nullif(btrim(coalesce(v_id.postal_code, '')), '') is not null
     and nullif(btrim(coalesce(v_id.city, '')), '') is not null);
end;
$$;

-- LE RÉGLAGE DE CETTE IDENTITÉ EST UN GESTE DE PLATEFORME, pas un
-- geste commercial : il est derrière `platform.security.write`, que
-- 0081 réserve au super-administrateur et au responsable sécurité. Le
-- responsable produit envoie les annonces sans pouvoir changer à qui
-- les réponses reviennent.
create or replace function public.admin_set_email_platform_identity(
  p_from_name text,
  p_reply_to_email text,
  p_legal_name text,
  p_legal_form text,
  p_siret text,
  p_vat_number text,
  p_rcs_city text,
  p_address_line1 text,
  p_address_line2 text,
  p_postal_code text,
  p_city text,
  p_phone text,
  p_website text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_reply text := public.email_normalize(p_reply_to_email);
begin
  if not public.platform_admin_can('platform.security.write') then
    raise exception 'Accès refusé : l''identité d''expéditeur d''Oasis Care n''appartient pas à ce rôle.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  if v_reply is not null and not public.email_is_addressable(v_reply) then
    raise exception 'Cette adresse de réponse n''est pas une adresse valide.' using errcode = '23514';
  end if;

  update public.email_platform_identity set
    from_name      = coalesce(public.ai_clean_text(p_from_name, 120), from_name),
    reply_to_email = v_reply,
    legal_name     = coalesce(public.ai_clean_text(p_legal_name, 200), legal_name),
    legal_form     = public.ai_clean_text(p_legal_form, 80),
    siret          = public.ai_clean_text(p_siret, 40),
    vat_number     = public.ai_clean_text(p_vat_number, 40),
    rcs_city       = public.ai_clean_text(p_rcs_city, 80),
    address_line1  = public.ai_clean_text(p_address_line1, 200),
    address_line2  = public.ai_clean_text(p_address_line2, 200),
    postal_code    = public.ai_clean_text(p_postal_code, 20),
    city           = public.ai_clean_text(p_city, 120),
    phone          = public.ai_clean_text(p_phone, 40),
    website        = public.ai_clean_text(p_website, 200),
    updated_by     = auth.uid(),
    updated_at     = now()
  where id;

  perform public.record_admin_event(
    'emailPlatformIdentity.updated', 'emailPlatformIdentity', null, 'Oasis Care',
    null, jsonb_build_object('replyTo', v_reply), v_reason);
end;
$$;


-- ============================================================
-- 14. RLS
-- ============================================================

alter table public.email_templates enable row level security;
alter table public.email_consents enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_organization_settings enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_events enable row level security;
alter table public.email_platform_identity enable row level security;

-- Le catalogue n'a rien de secret : c'est la liste des gabarits, pas
-- leur texte. Un membre le lit pour savoir ce que le produit sait
-- envoyer.
drop policy if exists "Le catalogue des gabarits se lit" on public.email_templates;
create policy "Le catalogue des gabarits se lit" on public.email_templates
  for select using (auth.uid() is not null);

-- AUCUNE POLITIQUE DE LECTURE SUR email_consents. Elle porte les jetons
-- de désabonnement : un membre qui la lirait pourrait désabonner
-- l'adresse de son entreprise depuis un onglet, et un jeton qui circule
-- est un jeton qui fuit. L'état se lit par la vue du § 14.a.

-- La suspension, l'entreprise la LIT. C'est la condition qui rend la
-- coupure acceptable : sans cela, son courrier s'arrêterait sans un mot
-- et le produit mentirait par omission.
drop policy if exists "Une entreprise lit son propre etat d'expedition" on public.email_organization_settings;
create policy "Une entreprise lit son propre etat d'expedition" on public.email_organization_settings
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('emails.log.read')
  );

-- Le journal : chaque entreprise voit SES messages, et le motif de
-- l'échec. C'est ce qui répond à « mon client dit qu'il n'a rien reçu ».
drop policy if exists "Une entreprise lit son propre journal d'envoi" on public.email_messages;
create policy "Une entreprise lit son propre journal d'envoi" on public.email_messages
  for select using (public.is_organization_member(organization_id));

-- UN ADMINISTRATEUR D'OASIS NE LIT QUE LE COURRIER D'OASIS. La
-- politique est restreinte à `nature = 'publicite'` — c'est-à-dire aux
-- messages qu'Oasis a lui-même expédiés. Le devis qu'un paysagiste
-- envoie à son client est une donnée métier : spec p.36, « pas de
-- données métier sensibles exposées dans les listes Admin », et 0075
-- réserve `customer.data.read` à un mécanisme qui n'existe pas encore.
-- Pour la délivrabilité, l'administrateur a la vue agrégée du § 10, qui
-- ne montre aucun corps de message.
drop policy if exists "Oasis lit le courrier d'Oasis" on public.email_messages;
create policy "Oasis lit le courrier d'Oasis" on public.email_messages
  for select using (
    nature = 'publicite' and public.platform_admin_can('emails.log.read')
  );

drop policy if exists "Une entreprise lit les evenements de ses messages" on public.email_events;
create policy "Une entreprise lit les evenements de ses messages" on public.email_events
  for select using (
    exists (
      select 1 from public.email_messages m
      where m.id = email_events.message_id
        and public.is_organization_member(m.organization_id)
    )
  );

drop policy if exists "Les campagnes se lisent avec la permission" on public.email_campaigns;
create policy "Les campagnes se lisent avec la permission" on public.email_campaigns
  for select using (public.platform_admin_can('emails.campaigns.read'));

-- AUCUNE POLITIQUE DE LECTURE SUR email_suppressions, ET C'EST UNE
-- CORRECTION. La liste est alimentée depuis `to_email` de tout message
-- qui rebondit : elle contient donc, en majorité, les adresses des
-- CLIENTS FINAUX des paysagistes — des gens qui n'ont rien signé avec
-- Oasis Care. Une politique ouverte sur `emails.suppression.read` les
-- affichait en clair dans Oasis Admin, alors que le même fichier
-- refuse cette donnée jusqu'au super-administrateur dans
-- `email_recipient_for_customer`.
--
-- La seule porte est maintenant `email_suppression_digest()` (§ 13.d),
-- qui rend un masque et un domaine. C'est assez pour répondre à « mon
-- client dit qu'il n'a rien reçu », et ce n'est pas un carnet
-- d'adresses.
drop policy if exists "La liste de suppression se lit avec la permission" on public.email_suppressions;

-- L'identité d'Oasis en tant qu'expéditeur : lisible par l'équipe,
-- écrite par la seule fonction du § 13.f.
drop policy if exists "L'identite d'Oasis se lit par l'equipe" on public.email_platform_identity;
create policy "L'identite d'Oasis se lit par l'equipe" on public.email_platform_identity
  for select using (public.is_platform_admin());

-- ET AUCUNE POLITIQUE D'INSERT, D'UPDATE NI DE DELETE, sur AUCUNE des
-- sept tables. Elles sont écrites par le service et par les fonctions
-- de ce fichier, jamais depuis un jeton de navigateur.

-- ------------------------------------------------------------
-- 14.a L'ÉTAT DU CONSENTEMENT, SANS LE JETON
-- ------------------------------------------------------------
create or replace view public.email_consent_state
with (security_invoker = false) as
select
  c.organization_id,
  c.email,
  c.nature,
  c.consented_at,
  c.consent_source,
  c.consent_evidence,
  c.unsubscribed_at,
  c.unsubscribe_reason,
  -- L'OPPOSITION PRÉCÉDENTE EST VISIBLE. « A-t-elle consenti, quand,
  -- sur quel texte, et s'est-elle opposée entre-temps ? » est la
  -- question à laquelle un registre de consentement doit savoir
  -- répondre.
  c.previous_unsubscribed_at,
  c.previous_unsubscribe_reason,
  (c.consented_at is not null and c.unsubscribed_at is null) as can_receive_marketing
from public.email_consents c
where public.is_organization_member(c.organization_id)
   or public.platform_admin_can('emails.campaigns.read');

comment on view public.email_consent_state is
  'L''état du consentement SANS le jeton de désabonnement. La table elle-même n''est lisible '
  'par personne : un membre qui verrait le jeton pourrait désabonner son entreprise depuis un '
  'onglet, et un jeton qui circule est un jeton qui fuit.';


-- ============================================================
-- 15. LES DROITS AU NIVEAU SQL
-- ============================================================
--
-- Supabase accorde par défaut `select, insert, update, delete` à `anon`
-- et `authenticated` sur toute table neuve du schéma `public`, et rend
-- toute fonction exécutable par `public`. Sur une fonction
-- `security definer`, ce défaut est une porte ouverte. On retire tout —
-- à `public` d'abord, dont le droit est hérité par tout le monde et
-- survivrait au retrait des deux autres — puis on rend le strict
-- nécessaire. C'est là que 0055 s'est fait avoir, et le test le
-- revérifie par requête.

do $$
declare t text;
begin
  foreach t in array array[
    'email_templates', 'email_consents', 'email_suppressions',
    'email_organization_settings', 'email_campaigns',
    'email_messages', 'email_events', 'email_platform_identity'
  ]
  loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- La lecture, et RIEN QUE la lecture, sur les tables dont un écran a
-- besoin.
--
-- DEUX ABSENTES, ET CHACUNE POUR SA RAISON. `email_consents` porte les
-- jetons de désabonnement : un membre qui les lirait pourrait
-- désabonner son entreprise depuis un onglet. `email_suppressions`
-- porte les adresses des clients finaux : elle ne se lit que masquée,
-- par `email_suppression_digest()`.
do $$
declare t text;
begin
  foreach t in array array[
    'email_templates',
    'email_organization_settings', 'email_campaigns',
    'email_messages', 'email_events', 'email_platform_identity'
  ]
  loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

do $$
declare v text;
begin
  foreach v in array array['email_organization_reputation', 'email_consent_state']
  loop
    execute format('revoke all on public.%I from public', v);
    execute format('revoke all on public.%I from anon', v);
    execute format('revoke all on public.%I from authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 15.a LES FONCTIONS DE LECTURE ET D'ADMINISTRATION
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.email_is_addressable(text)',
    'public.email_is_header_safe(text)',
    'public.email_normalize(text)',
    'public.email_mask(text)',
    'public.email_status_rank(text)',
    'public.email_sender_identity(uuid, text)',
    'public.email_recipient_for_customer(uuid, uuid)',
    'public.email_gate(uuid, text, text)',
    'public.email_record_consent(uuid, boolean, text, text)',
    -- Un membre de l'entreprise annule ses propres messages en file :
    -- c'est `cancelInvoice`, qui tourne sous son jeton, qui l'appelle.
    'public.email_cancel_queued(uuid, text, uuid, text)',
    'public.email_suppression_digest(text, integer)',
    'public.admin_email_reputation(integer)',
    'public.email_platform_status()',
    'public.admin_set_email_platform_identity(text, text, text, text, text, text, text, text, text, text, text, text, text, text)',
    'public.admin_create_email_campaign(text, text, text, text, text)',
    'public.admin_send_email_campaign(uuid, text)',
    'public.admin_suspend_organization_email(uuid, text)',
    'public.admin_resume_organization_email(uuid, text)',
    'public.admin_release_email_suppression(uuid, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 15.b LE DÉSABONNEMENT : `anon`, ET C'EST LE BUT
-- ------------------------------------------------------------
-- La seule fonction de ce fichier qu'un visiteur non connecté peut
-- appeler. Elle est sûre parce qu'elle ne rend rien : ni session, ni
-- adresse en clair, ni document.
revoke all on function public.email_unsubscribe(text) from public;
grant execute on function public.email_unsubscribe(text) to anon;
grant execute on function public.email_unsubscribe(text) to authenticated;

-- ------------------------------------------------------------
-- 15.c LES FONCTIONS DE LA MACHINE : `service_role` SEUL
-- ------------------------------------------------------------
-- METTRE UN MESSAGE EN FILE EST LA PORTE QU'UN NAVIGATEUR NE DOIT
-- JAMAIS POUSSER. Accordées explicitement à `service_role` plutôt qu'en
-- comptant sur le défaut de Supabase : un défaut peut changer, une
-- intention écrite se relit.
do $$
declare
  f text;
  v_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  foreach f in array array[
    'public.email_enqueue(uuid, text, text, uuid, text, text, text, text, text, uuid, jsonb, integer, uuid, boolean)',
    'public.email_claim_queued(integer, text)',
    'public.email_claim_one(uuid, text)',
    'public.email_still_sendable(uuid)',
    'public.email_mark_sent(uuid, text, text, text)',
    'public.email_mark_failed(uuid, text, text, text, boolean, interval, integer)',
    'public.email_mark_uncertain(uuid, text, text)',
    'public.email_record_event(text, text, text, timestamptz, text, jsonb)'
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

-- Les fonctions de déclencheur : exécutables par personne.
do $$
declare f text;
begin
  foreach f in array array[
    'public.email_messages_append_only()',
    'public.email_events_append_only()',
    'public.email_events_project()',
    'public.refuse_truncate()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
  end loop;
end $$;


-- ============================================================
-- 16. LA MATRICE DES DROITS — LE PIÈGE DE 0075, UNE FOIS DE PLUS
-- ============================================================
--
-- 0075 § 1.c sème le super-administrateur PAR JOINTURE sur le catalogue
-- des permissions. Une permission insérée APRÈS 0075 n'est donc portée
-- par PERSONNE — et une permission que personne ne porte ne lève pas
-- d'erreur : elle fait disparaître l'écran du menu, sans un mot. Le
-- piège a déjà mordu trois fois dans ce projet. On rejoue la jointure,
-- explicitement, et le test le vérifie.

insert into public.platform_admin_permissions (key, label, is_write) values
  ('emails.log.read',           'Lire le courrier expédié par Oasis Care et la délivrabilité du parc', false),
  ('emails.campaigns.read',     'Voir les annonces commerciales',                                      false),
  ('emails.campaigns.send',     'Écrire à toutes les entreprises du parc',                             true),
  ('emails.suppression.read',   'Voir la liste de suppression',                                        false),
  ('emails.suppression.manage', 'Lever une suppression d''adresse',                                    true),
  ('emails.sending.suspend',    'Suspendre ou rétablir l''expédition d''une entreprise',               true)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 16.a LE GARDE-FOU DE LA MATRICE, ÉTENDU AU PRÉFIXE NEUF
-- ------------------------------------------------------------
-- `emails.%` EST UN PRÉFIXE ENTIÈREMENT NOUVEAU, ET AUCUNE DES RÈGLES
-- EXISTANTES NE LE COUVRE. Sans ce qui suit,
-- ('support', 'emails.campaigns.send') passerait : un rôle d'assistance
-- pourrait écrire à tout le parc, depuis un domaine authentifié. C'est
-- exactement le trou que 0081 a refermé sur `platform.%`, et il se
-- rouvre à chaque préfixe qu'on invente.
--
-- Les treize règles de 0075, 0080 et 0081 sont RECOPIÉES MOT POUR MOT ;
-- ce fichier en ajoute trois. La recopie est la convention du dépôt :
-- `create or replace` remplace la fonction entière, et en omettre une
-- reviendrait à la supprimer.

create or replace function public.platform_admin_matrix_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_write boolean;
begin
  -- ---- 0081 : LE RETRAIT -------------------------------------------
  if tg_op = 'DELETE' then
    if old.role = 'super_admin' and old.permission = 'platform.admins.manage' then
      raise exception 'Retrait refusé : sans (super_admin, platform.admins.manage), plus personne ne peut nommer ni révoquer un administrateur, et aucune fonction ne sait reposer cette ligne.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  select p.is_write into v_is_write
  from public.platform_admin_permissions p
  where p.key = new.permission;

  if v_is_write is null then
    raise exception 'Permission inconnue : %', new.permission
      using errcode = '23514';
  end if;

  -- ---- 0075 : les trois phrases de la spec p.30 ---------------------
  if new.role = 'support' and v_is_write and new.permission like 'billing.%' then
    raise exception 'Moindre privilège (spec p.30) : le support ne modifie pas les abonnements — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  if new.role in ('billing_admin', 'product_admin', 'security_admin', 'read_only_analyst')
     and new.permission like 'customer.%' then
    raise exception 'Moindre privilège (spec p.30) : le rôle « % » n''ouvre pas les données client — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if new.role = 'product_admin' and v_is_write and new.permission like 'billing.%' then
    raise exception 'Moindre privilège (spec p.30) : le produit ne touche pas aux paiements — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- ---- 0080 : les réglages IA de l'éditeur --------------------------
  if v_is_write and new.permission like 'ai.%'
     and new.role not in ('super_admin', 'product_admin', 'billing_admin') then
    raise exception 'Moindre privilège : le rôle « % » ne règle pas l''IA de la plateforme — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if new.role = 'billing_admin' and v_is_write and new.permission like 'ai.model%' then
    raise exception 'Séparation des pouvoirs : la facturation ne choisit pas le modèle des agents — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  if new.role = 'product_admin' and v_is_write and new.permission like 'ai.cost%' then
    raise exception 'Séparation des pouvoirs : le produit ne lève pas les plafonds de dépense IA — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- ---- 0081 : la plateforme, l'argent, l'assistance, le produit -----
  if v_is_write and new.permission like 'platform.%'
     and new.role not in ('super_admin', 'security_admin') then
    raise exception 'Moindre privilège : le rôle « % » n''écrit rien sur la plateforme elle-même — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if new.permission = 'platform.admins.manage' and new.role <> 'super_admin' then
    raise exception 'Seul le super-administrateur nomme et révoque des administrateurs — permission % refusée pour le rôle « % ».', new.permission, new.role
      using errcode = '23514';
  end if;

  if v_is_write and new.permission like 'billing.%'
     and new.role not in ('super_admin', 'billing_admin') then
    raise exception 'Moindre privilège : le rôle « % » n''écrit rien sur la facturation — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if v_is_write and new.permission like 'billing.issuer%' and new.role <> 'super_admin' then
    raise exception 'Seul le super-administrateur modifie l''identité légale de l''émetteur — permission % refusée pour le rôle « % ».', new.permission, new.role
      using errcode = '23514';
  end if;

  if v_is_write and new.permission like 'support.%'
     and new.role not in ('super_admin', 'support') then
    raise exception 'Moindre privilège : le rôle « % » ne conduit pas l''assistance — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if v_is_write and new.permission like 'product.%'
     and new.role not in ('super_admin', 'product_admin') then
    raise exception 'Moindre privilège : le rôle « % » ne règle pas le produit — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- ---- NEUF EN 0084 : le courrier sortant ---------------------------
  --
  -- a) LA RÈGLE GÉNÉRALE SUR LE PRÉFIXE NEUF. Écrire quoi que ce soit
  --    sur le courrier sortant engage la réputation d'un domaine
  --    partagé par tout le parc. Trois rôles seulement, et en LISTE
  --    BLANCHE : une liste d'exclusions laisserait passer le prochain
  --    rôle qu'on inventera.
  if v_is_write and new.permission like 'emails.%'
     and new.role not in ('super_admin', 'product_admin', 'security_admin') then
    raise exception 'Moindre privilège : le rôle « % » n''écrit rien sur le courrier sortant — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- b) ÉCRIRE À TOUT LE PARC EST UN ACTE COMMERCIAL, PAS UNE MESURE DE
  --    SÉCURITÉ. Le responsable sécurité protège le domaine ; il ne
  --    fait pas de publicité. Et surtout : c'est la permission par
  --    laquelle un compte compromis atteindrait TOUS les clients d'un
  --    seul geste, depuis un domaine authentifié. Elle reste au plus
  --    étroit.
  if new.permission = 'emails.campaigns.send'
     and new.role not in ('super_admin', 'product_admin') then
    raise exception 'Écrire à toutes les entreprises du parc n''appartient qu''au super-administrateur et au responsable produit — permission % refusée pour le rôle « % ».', new.permission, new.role
      using errcode = '23514';
  end if;

  -- c) ET LE SYMÉTRIQUE : suspendre une entreprise ou réhabiliter une
  --    adresse qui s'est plainte sont des gestes de protection du
  --    domaine. Les confier au responsable produit — celui qui envoie
  --    la publicité — reviendrait à laisser la même personne créer le
  --    problème et lever le garde-fou.
  if new.permission in ('emails.sending.suspend', 'emails.suppression.manage')
     and new.role not in ('super_admin', 'security_admin') then
    raise exception 'Protéger la réputation du domaine n''appartient qu''au super-administrateur et au responsable sécurité — permission % refusée pour le rôle « % ».', new.permission, new.role
      using errcode = '23514';
  end if;

  -- d) LA LISTE DE SUPPRESSION TOUCHE AUX CLIENTS DES CLIENTS.
  --    Elle est alimentée depuis l'adresse de tout message qui rebondit,
  --    donc en majorité depuis des devis et des factures adressés aux
  --    clients des paysagistes. Même masquée (§ 13.d), elle reste une
  --    donnée sur des gens qui n'ont rien signé avec Oasis Care : elle
  --    subit donc la même règle de LISTE BLANCHE que `customer.%`, que
  --    le garde-fou de 0075 ne lui appliquait pas. Sans cette règle,
  --    rien n'empêchait de l'accorder à l'analyste ou à la facturation.
  if new.permission like 'emails.suppression.%'
     and new.role not in ('super_admin', 'security_admin', 'support') then
    raise exception 'La liste de suppression porte les adresses des clients de nos clients : le rôle « % » n''y accède pas — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- ---- L'analyste en lecture seule ----------------------------------
  if new.role = 'read_only_analyst' and v_is_write then
    raise exception 'Un analyste en lecture seule n''écrit rien — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_admin_matrix_guard on public.platform_admin_role_permissions;
create trigger platform_admin_matrix_guard
  before insert or update or delete on public.platform_admin_role_permissions
  for each row execute function public.platform_admin_matrix_guard();

revoke all on function public.platform_admin_matrix_guard() from public;
revoke all on function public.platform_admin_matrix_guard() from anon;
revoke all on function public.platform_admin_matrix_guard() from authenticated;

-- ------------------------------------------------------------
-- 16.b LE SEMIS, EXPLICITE
-- ------------------------------------------------------------
insert into public.platform_admin_role_permissions (role, permission)
select 'super_admin', key from public.platform_admin_permissions
on conflict do nothing;

-- LE RESPONSABLE PRODUIT COMPOSE ET ENVOIE LES ANNONCES. C'est son
-- métier : il porte déjà les drapeaux de fonctionnalité, et annoncer
-- une nouveauté est la suite du même geste.
insert into public.platform_admin_role_permissions (role, permission) values
  ('product_admin', 'emails.campaigns.read'),
  ('product_admin', 'emails.campaigns.send'),
  ('product_admin', 'emails.log.read')
on conflict do nothing;

-- LE RESPONSABLE SÉCURITÉ PROTÈGE LE DOMAINE, et lui seul avec le
-- super-administrateur peut couper une entreprise ou réhabiliter une
-- adresse. Il ne compose aucune annonce.
insert into public.platform_admin_role_permissions (role, permission) values
  ('security_admin', 'emails.log.read'),
  ('security_admin', 'emails.suppression.read'),
  ('security_admin', 'emails.suppression.manage'),
  ('security_admin', 'emails.sending.suspend')
on conflict do nothing;

-- LE SUPPORT LIT, ET NE FAIT QUE LIRE. « Mon client dit qu'il n'a pas
-- reçu la facture » est la question qu'on lui posera, et sans la liste
-- de suppression il ne peut qu'escalader. Le garde-fou l'autorise : la
-- règle sur `emails.%` ne vise que `is_write`.
insert into public.platform_admin_role_permissions (role, permission) values
  ('support', 'emails.suppression.read'),
  ('support', 'emails.log.read')
on conflict do nothing;

-- `read_only_analyst` ne reçoit RIEN : le courrier d'un client n'est
-- pas une donnée d'analyse.


-- ============================================================
-- 17. CE QUI RESTE À TRANCHER, ET QUI N'EST PAS DU CODE
-- ============================================================
--
--   • L'ORDONNANCEUR. `pg_cron` et `pg_net` sont absents. Tant qu'un
--     déclencheur périodique n'est pas choisi, les deux RELANCES
--     demandées ne peuvent pas partir. Tout le reste de ce fichier les
--     attend : le rang, la cadence, l'idempotence sont posés.
--
--   • LE LIEN VERS LE DOCUMENT. Le portail client est verrouillé par
--     `auth.uid()` : un lien « Voir votre devis » tombe sur un mur de
--     connexion. Ouvrir un chemin de lecture anonyme est une décision,
--     pas une ligne de migration.
--
--   • LE CONSENTEMENT DES ENTREPRISES DÉJÀ INSCRITES. Il ne se présume
--     pas rétroactivement : `email_gate()` refusera de leur écrire tant
--     que `consented_at` est vide, et c'est le comportement correct. Il
--     faut le recueillir.
--
--   • LE CONTRAT DE SOUS-TRAITANCE (art. 28 RGPD). En expédiant les
--     messages du paysagiste vers SES clients, Oasis Care devient
--     sous-traitant de données dont le paysagiste est responsable. Un
--     document juridique, pas du code, et il conditionne la mise en
--     service.
