-- Oasis Care — LE PÉAGE (migration 0092).
--
-- ============================================================
-- CE QUI MANQUAIT, MESURÉ
-- ============================================================
--
--   select count(*) from pg_policies where schemaname = 'public';
--   → 435
--
--   select count(*) from pg_policies where schemaname = 'public'
--     and (coalesce(qual,'') || coalesce(with_check,'')) ~* 'organization_subscriptions';
--   → 0
--
-- Quatre cent trente-cinq politiques de sécurité, et pas une seule ne
-- sait ce qu'est un abonnement. Toute la base répond à « QUI êtes-vous
-- dans cette entreprise » — 151 fois has_permission(), 57 fois
-- is_workspace_member(), 37 fois is_organization_member(). Aucune ne
-- répond à « cette entreprise a-t-elle un contrat ».
--
-- Conséquence, jouée sur la vraie base sous l'identité d'un vrai
-- compte, dans un begin/rollback : une entreprise sans le moindre
-- abonnement crée ses clients, émet ses factures, configure sa société
-- et invite son équipe. Gratuitement. Indéfiniment.
--
-- Il ne manquait donc pas un branchement d'écran. Il manquait la
-- barrière. Un péage qui ne vit que dans l'écran n'est pas un péage,
-- c'est une pancarte : il suffit de ne pas passer devant.
--
--
-- ============================================================
-- LA RÈGLE
-- ============================================================
--
-- Elle se lit en trois phrases, et tout le reste de ce fichier n'est
-- que sa mise en œuvre.
--
--   1. LIRE, EXPORTER, SUPPRIMER ET PAYER NE SE FERMENT JAMAIS.
--      Quel que soit l'état du contrat, le dirigeant voit ses clients,
--      ses devis, ses factures, ce qu'il doit à Oasis, et il peut
--      régler. Une base de clients qui disparaît parce qu'une carte a
--      expiré, c'est une entreprise qu'on détruit — et ce n'est pas ce
--      qu'on a vendu.
--
--   2. CRÉER DE LA VALEUR SE FERME QUAND IL N'Y A PLUS DE CONTRAT.
--      Ouvrir un client, rédiger un devis, émettre une facture, poser
--      un chantier, saisir des heures : ce sont les gestes pour
--      lesquels on paie le logiciel. Ils s'arrêtent quand on ne le
--      paie plus. C'est le péage lui-même.
--
--   3. FAIRE GROSSIR LA NOTE SE FERME PLUS TÔT.
--      Faire entrer un collègue ajoute un siège, donc de l'argent dû.
--      Ce geste-là se ferme dès le premier impayé, avant même que
--      l'exploitation ne s'arrête. On ne laisse pas quelqu'un
--      commander davantage pendant qu'il ne règle pas la note.
--
--
-- ------------------------------------------------------------
-- POURQUOI CETTE FRONTIÈRE-LÀ, ET PAS UNE AUTRE
-- ------------------------------------------------------------
--
-- On aurait pu tracer la ligne ailleurs. Trois autres tracés se
-- présentaient, et voici pourquoi ils sont écartés.
--
-- « TOUT SE FERME, LECTURE COMPRISE. » C'est le tracé le plus simple
-- et le plus destructeur. Un dirigeant qui ne peut plus lire ne peut
-- plus savoir ce qu'il doit, ne peut plus exporter son fichier
-- clients, et ne peut donc plus décider de payer. On ne l'aurait pas
-- suspendu : on l'aurait enfermé dehors avec ses données à
-- l'intérieur. Un logiciel de gestion détient la mémoire d'une
-- entreprise ; la prendre en otage pour trente-neuf euros n'est pas
-- une politique commerciale.
--
-- « RIEN NE SE FERME, ON RELANCE PAR COURRIEL. » C'est l'état actuel,
-- et il ne tient que tant que personne ne s'en aperçoit. Le premier
-- client qui comprend qu'il suffit d'ignorer les relances a le
-- logiciel gratuitement pour toujours, et il le dira.
--
-- « ON FERME LA SUPPRESSION AUSSI. » Tentant — on garde le client
-- captif de ses propres données. C'est refusé pour trois raisons :
-- supprimer ne crée aucune valeur et ne coûte rien ; le droit à
-- l'effacement ne se monnaie pas ; et une entreprise suspendue qui
-- veut réduire sa note en retirant deux comptes doit pouvoir le faire,
-- sinon on lui interdit le seul geste qui la rendrait solvable.
--
-- La frontière retenue est donc celle de la VALEUR PRODUITE, pas celle
-- de la donnée détenue. On coupe la production, jamais la mémoire.
--
--
-- ------------------------------------------------------------
-- SORTIR UN DOCUMENT VERS UN TIERS : POURQUOI CE N'EST PAS UN
-- TROISIÈME GESTE
-- ------------------------------------------------------------
--
-- Envoyer un devis à un client, publier une facture au portail,
-- expédier un courriel : on aurait pu en faire un geste distinct, qui
-- se ferme avant l'exploitation. C'est écarté, et le motif mérite
-- d'être écrit parce qu'il est contre-intuitif.
--
-- Un paysagiste dont le prélèvement a échoué a besoin d'envoyer ses
-- factures POUR ÊTRE PAYÉ, et c'est avec cet argent-là qu'il nous
-- paiera. Lui couper l'envoi pendant le sursis, c'est lui retirer les
-- moyens de régler ce qu'il nous doit. « Sortir » se ferme donc
-- exactement au même moment qu'« exploiter », et se range avec lui.
--
--
-- ------------------------------------------------------------
-- LES QUATRE ÉTATS
-- ------------------------------------------------------------
--
--   ouvert     Le contrat court et rien n'est réclamé. Un essai en
--              cours en fait partie : la carte est enregistrée, la
--              promesse est tenue des deux côtés. Un Enterprise
--              négocié aussi : il n'a ni date ni facture automatique.
--
--   sursis     UNE FACTURE OASIS EST ÉMISE, ÉCHUE ET NON RÉGLÉE depuis
--              moins de 30 jours, et l'abonnement n'a pas été résilié.
--              C'est l'état d'un PRÉLÈVEMENT QUI A ÉCHOUÉ, et un
--              prélèvement qui échoue est un incident bancaire, pas une
--              faute : une carte expirée, un plafond, une banque qui
--              refuse un vendredi soir.
--              L'exploitation continue. Seul « grandir » se ferme.
--
--   restreint  La même facture est impayée depuis plus de 30 jours —
--              ou l'abonnement a été résilié et son terme est passé.
--              Lire, exporter, supprimer et payer restent ouverts ;
--              produire s'arrête.
--
--   transit    Aucune ligne dans organization_subscriptions. Ce n'est
--              pas un statut, c'est une ABSENCE : la clé primaire de
--              cette table est organization_id seul, une organisation
--              a au plus une ligne, et n'en avoir aucune veut dire
--              qu'on n'a jamais contracté.
--
--              Cet état-là n'a AUCUN sursis, et c'est la décision la
--              plus structurante du fichier. La règle du dirigeant est
--              « essai gratuit un mois AVEC CARTE OBLIGATOIREMENT » ;
--              elle a une conséquence d'architecture qui n'est pas un
--              choix de goût : LE CONTRAT VIENT AVANT L'ACCÈS. Une
--              organisation sans contrat est un état DE TRANSIT — le
--              temps de traverser le tunnel d'inscription — et non un
--              état d'exploitation. Aujourd'hui c'est un état
--              d'exploitation permanent, et c'est tout le défaut.
--
-- CE QUI DÉCLENCHE LE COMPTE À REBOURS : UNE FACTURE, PAS UNE DATE.
-- C'est le point le plus important de ce fichier et il a sa
-- démonstration complète au § 1. En deux phrases : la date de fin de
-- période est repoussée chaque nuit par le renouvellement, QUI NE
-- REGARDE PAS SI L'ARGENT EST ARRIVÉ — s'y fier laissait le mauvais
-- payeur ouvert pour toujours. Et à l'inverse, quand notre propre
-- facturation tombe en panne, cette date se fige et fermait le compte
-- d'un client parfaitement à jour. On ferme donc sur ce qu'on a
-- RÉCLAMÉ : une facture émise, échue, non soldée.
--
-- POURQUOI 30 JOURS DE SURSIS, ET UN SEUL NOMBRE. Deux tentatives de
-- prélèvement séparées par une semaine, plus le temps qu'un
-- indépendant en chantier ouvre son courrier. C'est aussi la durée du
-- cycle mensuel, donc la seule que l'on puisse expliquer à un
-- paysagiste sans schéma. Un seul nombre, écrit une seule fois, dans
-- peage_etat_organisation().
--
-- POURQUOI UNE RÉSILIATION N'A PAS DE SURSIS. Le sursis existe pour un
-- INCIDENT. Une résiliation est une DÉCISION : celui qui l'a prise ne
-- s'attend pas à un mois de rab, et le lui offrir ouvrirait le seul
-- contournement gratuit du péage — résilier, travailler un mois,
-- reprendre. Le contrat court jusqu'au terme payé, et s'arrête au
-- terme payé.
--
--
-- ------------------------------------------------------------
-- CE QUE LE PÉAGE NE REGARDE JAMAIS
-- ------------------------------------------------------------
--
-- LE PRESTATAIRE DE PAIEMENT. Ni provider, ni external_reference, ni
-- la présence d'une facture rapprochée. Un contrat Enterprise est posé
-- à la main par admin_create_subscription() : provider = 'manual',
-- aucune référence chez Stripe, souvent aucune date de période. Un
-- péage qui exigerait « provider = web » mettrait dehors précisément
-- les clients qu'on est allé chercher soi-même. La règle se lit sur le
-- STATUT et sur les DATES, jamais sur le dossier chez le prestataire.
--
-- LES DROITS DE L'APPLICATION iPHONE. subscription_entitlements est un
-- AUTRE AXE : un droit y est porté PAR UTILISATEUR ET PAR ESPACE, quand
-- un contrat Pro est porté PAR ORGANISATION. Croiser les deux
-- offrirait Oasis Care Pro à toute entreprise dont un salarié a acheté
-- un abonnement sur son iPhone. Le péage ne lit pas cette table, et le
-- § 5 du fichier de tests échoue si un jour quelqu'un « unifie ».
--
-- QUI N'EST PAS MEMBRE. Le péage ne parle qu'aux MEMBRES de
-- l'organisation. Cette clause, à elle seule, protège trois populations
-- d'un seul geste :
--
--   • le client du portail, qui n'est membre de rien et vient lire SA
--     facture — le suspendre parce que SON paysagiste n'a pas payé
--     serait punir le mauvais ;
--   • l'administrateur de plateforme, qui doit pouvoir intervenir
--     précisément dans une organisation en difficulté ;
--   • le professionnel d'une AUTRE entreprise qui bénéficie d'un
--     partage — son propre contrat le regarde, pas celui du voisin.
--
-- Aucune de ces trois exemptions n'ouvre quoi que ce soit : les
-- politiques permissives déjà en place restent seules juges de ce
-- qu'un non-membre a le droit de faire. Le péage se contente de ne pas
-- s'ajouter à elles.
--
--
-- ============================================================
-- COMMENT C'EST POSÉ, ET POURQUOI PAS AUTREMENT
-- ============================================================
--
-- DES POLITIQUES « RESTRICTIVE », PAS UNE RÉÉCRITURE DES 435. Une
-- politique restrictive s'AJOUTE en ET à toutes les permissives de sa
-- table ; elle n'en modifie aucune. Les 435 politiques existantes
-- continuent de répondre à « qui êtes-vous » exactement comme avant, et
-- le péage répond à « avez-vous un contrat » à côté. Réécrire les
-- politiques existantes aurait voulu dire toucher 435 clauses pour y
-- coller la même condition : la moitié du parc aurait fini par
-- appliquer une version périmée de la règle.
--
-- UNE SEULE FONCTION DÉCIDE, UNE SEULE ADRESSE. Toutes les politiques
-- appellent peage_autorise_ligne(), qui ne fait que TROUVER QUI PAIE et
-- délègue la décision à peage_autorise(). Deux responsabilités, deux
-- fonctions : la règle change à un endroit, l'adressage à un autre, et
-- aucun des deux ne se retrouve recopié dans deux cents politiques.
--
-- TROIS FAÇONS DE TROUVER LE PAYEUR, PARCE QUE LE PRODUIT EN A TROIS.
-- Une colonne organization_id ; un workspace_id remonté à l'entreprise
-- qui possède l'espace ; ou le parent, pour une table fille qui ne
-- porte ni l'un ni l'autre. Ne connaître que la première laissait
-- QUARANTE-NEUF tables dehors — les jardins, les plantes, le jumeau
-- numérique et tout le BioLab, qui est un module vendu — sous un audit
-- qui affirmait que tout allait bien. Voir le § 2 bis.
--
-- LE PÉRIMÈTRE EST UNE TABLE, PAS UNE LISTE DANS UN COMMENTAIRE.
-- peage_perimetre porte une ligne par table sous RLS, son geste, ses
-- deux adresses, et le motif quand il n'est pas celui par défaut. On
-- peut donc AUDITER le péage par une requête au lieu de relire une
-- migration, et peage_couverture() signale toute table qui s'en
-- écarterait.
--
-- SEULS « INSERT » ET « UPDATE » SONT PÉAGÉS. Pas SELECT — c'est la
-- première phrase de la règle. Pas DELETE — c'est la troisième raison
-- du tracé.
--
--
-- ============================================================
-- CE QUE CE FICHIER NE COUVRE PAS, ET IL FAUT LE SAVOIR
-- ============================================================
--
-- LE PÉAGE DÉPEND DE LA FACTURATION, ET C'EST VOULU. Depuis que la
-- règle est « on ne ferme que sur une créance réclamée », un péage sans
-- factures est un péage ouvert. C'est le bon comportement — on ne
-- suspend personne pour une panne de notre côté — mais il faut le
-- savoir et le surveiller, d'où peage_sante() au § 7 bis. Le jour où
-- la facturation s'arrête, le péage s'ouvre en silence : la fonction
-- de santé est ce qui rompt le silence.
--
-- LES FONCTIONS « SECURITY DEFINER » NE VOIENT PAS LA RLS. C'est leur
-- nature, pas un défaut de ce fichier : une fonction definer écrit
-- dans une table sans qu'aucune politique ne soit évaluée. J'ai
-- mesuré la surface exacte — les fonctions definer exécutables par
-- `authenticated` qui écrivent dans une table péagée :
--
--   partager_devis, revoquer_partage_devis   → document_share_links
--   deliver_garden_to_client                 → garden_access, garden_deliveries
--   accept_organization_invitation           → organization_members
--   accept_client_invitation                 → client_portal_access
--   etiquette_creer / publier / resoudre     → smart_tags
--   etiquette_modele_enregistrer / archiver  → etiquette_modeles
--   transferer_biolab_vers_entreprise        → biolab_transferts, smart_tags
--   (le reste est de la plomberie machine ou réservé aux admins)
--
-- Aucune de ces fonctions ne permet de CRÉER la matière de
-- l'entreprise : on ne peut pas s'y fabriquer un client, un devis, une
-- facture ni un chantier. Elles ne font qu'agir sur ce qui existait
-- déjà — partager un devis rédigé avant la suspension, accepter une
-- invitation émise avant elle. Le contournement est donc borné et
-- s'épuise de lui-même : les invitations expirent, et rien de neuf ne
-- s'ajoute au stock.
--
-- Pourquoi ne pas les avoir gardées par un déclencheur : un
-- déclencheur se déclenche AUSSI pour la machine, les tâches de nuit
-- et les jeux d'essai, qui n'ont pas de RLS et n'en veulent pas. Il
-- aurait fallu leur inventer un discriminant différent de celui de la
-- RLS — donc deux règles au lieu d'une, et un péage plus sévère par
-- déclencheur que par politique. Un seul mécanisme, appliqué partout
-- de la même façon, vaut mieux qu'une couverture plus large et
-- incohérente. Le jour où l'on voudra fermer ces fonctions, on ajoutera
-- `perform public.peage_exiger(org, 'exploiter');` en tête de chacune —
-- la fonction est là, prête, et c'est un ajout d'une ligne.
--
--
-- ============================================================
-- MISE EN SERVICE — À LIRE AVANT DE LANCER CE FICHIER
-- ============================================================
--
-- LE CONTRÔLE QUI RÉSUME TOUS LES AUTRES :
--
--       select * from public.peage_sante();
--
-- Elle doit rendre ZÉRO LIGNE. Chaque ligne qu'elle rend est une chose
-- qui empêche le péage de fonctionner, écrite en français, avec le
-- geste qui la corrige. Les deux points suivants sont ce qu'elle dira
-- le premier jour.
--
-- 1. NOTRE IDENTITÉ D'ÉMETTEUR, PUIS LES TÂCHES DE NUIT — DANS CET
--    ORDRE, ET LE PREMIER N'EST PAS UN DÉTAIL DE CONFORT.
--
--    Mesuré : saas_billing_issuer est ENTIÈREMENT VIDE. Tant qu'elle
--    l'est, saas_generate_invoices refuse d'émettre — « Identité de
--    l'émetteur incomplète : il manque address_line1, city, iban,
--    late_penalty_terms, legal_name, postal_code, siret, vat_number ».
--    Aucune facture Oasis ne part, donc aucune créance n'est jamais
--    réclamée, DONC LE PÉAGE NE SE FERME SUR RIEN. Il tournera à vide
--    en silence, et on le croira en marche.
--
--    Ensuite seulement, armer les deux tâches (vérifié en production :
--    jobid 161 'oasis-cycle-facturation' 15 3 * * * active = false ;
--    jobid 162 'oasis-relances' 30 6 * * * active = false) :
--       select cron.alter_job(161, active => true);
--       select cron.alter_job(162, active => true);
--    Sans elles, aucun essai ne se termine et aucune période ne se
--    renouvelle : rien n'est facturé, donc rien ne ferme.
--
--    LES ARMER NE FERME PLUS PERSONNE PAR SURPRISE, et c'est le
--    changement de fond de ce fichier : le péage ne lit plus les dates
--    de période, il lit les factures. Une nuit de rattrapage qui
--    émettrait plusieurs périodes d'un coup n'expulse personne — elle
--    envoie des factures, et le compte à rebours de trente jours part
--    de leur échéance à elles.
--
-- 2. LES ORGANISATIONS DÉJÀ EN BASE PASSENT EN « transit ». Mesuré au
--    moment d'écrire : une seule organisation existe, sans abonnement,
--    sans SIRET et sans profil fiscal. Elle ne perd RIEN — elle lit,
--    exporte, supprime et peut souscrire — mais elle ne produira plus
--    tant qu'elle n'aura pas de contrat. C'est voulu : c'est
--    exactement le parcours qu'on demande à un client neuf.
--    Pour lui poser un contrat à la main plutôt que de le faire passer
--    par la caisse (c'est aussi le chemin d'un Enterprise négocié) :
--       select public.admin_create_subscription(
--         p_organization_id => '…'::uuid, p_plan => 'business',
--         p_billing_cycle => 'monthly', p_reason => 'Accès de courtoisie.',
--         p_status => 'active', p_trial_days => null,
--         p_negotiated_monthly_price_cents => 0,
--         p_negotiated_yearly_price_cents => 0);
--    ATTENTION : l'accès de courtoisie de 0042 ne joue AUCUN rôle ici.
--    Il vit dans subscription_entitlements, sur un ESPACE PERSONNEL
--    iOS, rattaché à aucune organisation professionnelle. Il ne
--    protège personne côté Pro.
--
-- 3. LES JEUX D'ESSAI DU DÉPÔT ONT ÉTÉ CORRIGÉS AVEC CE FICHIER. Les
--    fichiers de supabase/tests/ créaient une organisation puis
--    écrivaient sous `role authenticated` sans jamais lui donner
--    d'abonnement — c'est-à-dire exactement le trou que ce fichier
--    ferme. Ils décrivaient donc tous une entreprise en « transit », et
--    le péage les refusait ; pire, le refus faisait AVORTER la
--    transaction, si bien qu'aucun verdict n'était rendu : on aurait
--    perdu la vérification de l'isolement multi-locataire au moment
--    précis où l'on pose deux cents politiques neuves.
--
--    Chacun porte désormais, juste après la création de l'organisation
--    (les fixtures tournent en postgres, qui n'est pas soumis à la RLS,
--    donc l'insertion directe passe) :
--
--      insert into public.organization_subscriptions
--        (organization_id, plan, status, provider, billing_cycle)
--      values (<org>, 'business', 'active', 'manual', 'monthly');
--
--    C'est aussi la recette pour poser un contrat à la main sur une
--    organisation existante quand on ne veut pas la faire passer par la
--    caisse.
--
-- ============================================================


-- ------------------------------------------------------------
-- 0. LA BORNE DES CRÉANCES — UNE COLONNE, POUR NE PAS ENFERMER
--    CELUI QUI VIENT DE PAYER
-- ------------------------------------------------------------
--
-- LE PIÈGE QU'ELLE FERME, ET IL EST SOURNOIS. Une entreprise fermée
-- pour impayé repasse à la caisse, le webhook appelle
-- saas_reopen_subscription, elle paie sa nouvelle période. MAIS LA
-- FACTURE IMPAYÉE D'AVANT EST TOUJOURS LÀ — la reprise ne l'efface pas,
-- et elle a raison : une facture émise ne disparaît pas, elle se règle
-- ou se crédite. Le péage la lisait, et refermait la porte sur un
-- client qui venait de payer pour la rouvrir. Le même piège que le
-- premier, un cran plus loin.
--
-- La reprise pose donc cette borne à sa date : on ne compte, pour
-- FERMER, que ce qui est dû depuis. La créance d'avant n'est pas
-- effacée — elle reste au dossier, visible dans Entreprise ›
-- Abonnement, et les relances la réclament. Le recouvrement est un
-- travail comptable ; ce n'est pas le travail d'un verrou.
--
-- POURQUOI UNE COLONNE À ELLE, ET PAS `started_at`. Parce qu'une
-- colonne détournée se remplit par accident. `started_at` a une valeur
-- par défaut (now()), si bien que TOUTE ligne d'abonnement posée à la
-- main — une fixture, un contrat créé par un administrateur — aurait
-- porté la borne d'aujourd'hui et rendu invisible toute créance
-- antérieure. Le péage se serait tu, sans que rien ne le signale.
-- Ici, le défaut est NULL, et NULL veut dire « compte tout ». On
-- échoue du côté fermé.
alter table public.organization_subscriptions
  add column if not exists peage_creances_depuis date;

comment on column public.organization_subscriptions.peage_creances_depuis is
  'À partir de quelle date les factures Oasis impayées ferment l''accès. NULL = toutes, et c''est le '
  'défaut. Posée par saas_reopen_subscription à la date de la reprise : sans elle, un client qui vient '
  'de payer pour rouvrir retrouverait porte close à cause de la facture qu''il n''avait pas réglée AVANT '
  'la fermeture. Elle n''efface aucune créance — elle dit seulement laquelle sert encore de verrou.';


-- ------------------------------------------------------------
-- 1. L'ÉTAT — LA SEULE FONCTION QUI LIT LE CONTRAT
-- ------------------------------------------------------------
--
-- Elle rend un mot, et un seul : ouvert, sursis, restreint, transit.
-- Personne d'autre dans la base ne doit interpréter organization_
-- subscriptions pour décider d'un accès ; c'est ici, ou nulle part.
--
-- ════════════════════════════════════════════════════════════
-- CE QU'ELLE REGARDE, ET POURQUOI CE N'EST PAS UNE DATE
-- ════════════════════════════════════════════════════════════
--
-- La première version de cette fonction fermait sur
-- `current_period_end_on`. Mesuré, ce tracé se révèle EXACTEMENT À
-- L'ENVERS, et il faut avoir vu les deux moitiés pour le croire.
--
--   LE MAUVAIS PAYEUR RESTAIT OUVERT. saas_run_billing_cycle § 5.b
--   renouvelle toute ligne 'active' dont la période est échue : il
--   pousse `current_period_end_on` d'un mois et émet une facture, SANS
--   JAMAIS REGARDER SI LA PRÉCÉDENTE A ÉTÉ RÉGLÉE. La date que le péage
--   interrogeait était donc remise dans le futur chaque nuit,
--   indéfiniment. Et le seul statut qui aurait dit la vérité,
--   'pastDue', n'est posé par AUCUNE fonction de cette base — vérifié :
--   aucune.
--
--   LE BON PAYEUR TOMBAIT LE PREMIER. Les deux tâches de nuit sont
--   posées désactivées (jobid 161 et 162, active = false), et
--   saas_generate_invoices refuse aujourd'hui d'émettre quoi que ce
--   soit parce que NOTRE identité d'émetteur est vide. Un essai
--   souscrit avec carte restait donc 'trialing' pour toujours, sa date
--   de fin finissait par passer, et trente et un jours plus tard on
--   coupait la production d'un client qui avait fait exactement ce
--   qu'on lui avait demandé.
--
-- LA RÈGLE EST DONC : ON NE FERME QUE SUR UNE CRÉANCE RÉCLAMÉE.
-- C'est-à-dire une facture qu'Oasis a ÉMISE, dont l'échéance est
-- PASSÉE, et qui n'est PAS SOLDÉE. Trois faits vérifiables, portés par
-- un document que le client a reçu.
--
-- Ce que cette règle donne, et qu'aucune date ne donnait :
--
--   • Un renouvellement de nuit ne blanchit plus rien. La période
--     avance, la facture impayée reste, et le compte à rebours part de
--     SON échéance à elle — pas de la période courante.
--   • ON NE FERME JAMAIS SUR UNE PANNE DE NOTRE CÔTÉ. Tâche de nuit
--     éteinte, identité d'émetteur incomplète, facturation en carafe :
--     dans tous ces cas nous n'avons rien réclamé, donc nous ne fermons
--     rien. Suspendre un client pour un champ vide sur notre propre
--     papier à en-tête serait indéfendable.
--   • Le motif du refus est un DOCUMENT. « La facture F-2026-0031,
--     échue le 3 mars, n'a pas été réglée » se dit à un paysagiste. « La
--     colonne current_period_end_on est dans le passé » ne se dit pas.
--
-- CE QUE ÇA COÛTE, ET C'EST ASSUMÉ : tant que la facturation ne tourne
-- pas, le péage ne mord pas. C'est pour cela que peage_sante() existe
-- (§ 7 bis) et que la mise en service commence par elle. Un péage qui
-- se tairait sur sa propre panne serait pire que pas de péage du tout :
-- on le croirait en marche.
--
-- COMBIEN DE TEMPS ÇA FAIT, EN VRAI, ET OÙ SE RÈGLE CE NOMBRE. Mesuré
-- sur la base : saas_billing_issuer.payment_terms_days vaut 30, et la
-- facture émise par la machine ne porte pas de délai propre — elle
-- hérite donc de ces trente jours. Un prélèvement qui échoue le 1er
-- mars donne : facture émise le 1er mars, exigible le 31 mars,
-- « sursis » du 1er au 30 avril, « restreint » le 1er mai. Deux mois.
--
-- C'est volontairement écrit ainsi, et ce n'est pas une négligence : ON
-- NE SUSPEND PAS UN CLIENT AVANT LA DATE IMPRIMÉE SUR LA FACTURE QU'ON
-- LUI A ENVOYÉE. Le péage respecte son propre document. Pour resserrer,
-- il y a UN SEUL nombre à changer — les conditions de paiement de
-- l'émetteur — et il se change en connaissance de cause, pas ici.
--
-- LA RÉSILIATION FAIT EXCEPTION, ET C'EST LA SEULE. Elle ne se lit pas
-- sur une facture mais sur une DÉCISION : le contrat court jusqu'au
-- terme déjà payé, et s'arrête là. Personne n'attend une facture pour
-- constater qu'un abonnement résilié a expiré.

create or replace function public.peage_etat_organisation(p_organization_id uuid)
returns text
language plpgsql
stable
security definer
-- pg_temp EN DERNIER : une fonction definer n'a pas de RLS à elle, sa
-- clause where et ses grant sont ses seules barrières. Un search_path
-- laissé libre laisserait un appelant poser une table temporaire
-- nommée organization_subscriptions et se répondre « ouvert ».
set search_path = public, pg_temp
as $$
declare
  v record;
  v_terme date;
  v_du_depuis date;
  -- LE SURSIS, ÉCRIT UNE SEULE FOIS. Voir l'en-tête.
  c_sursis_en_jours constant integer := 30;
begin
  -- Une ligne sans entreprise n'appartient à personne qui paie.
  if p_organization_id is null then
    return 'ouvert';
  end if;

  select s.status,
         s.cancelled_at,
         s.cancel_at_period_end,
         s.trial_ends_at,
         s.peage_creances_depuis,
         coalesce(s.current_period_end_on, s.current_period_end::date) as fin_periode
    into v
    from public.organization_subscriptions s
   where s.organization_id = p_organization_id;

  -- L'ABSENCE DE LIGNE N'EST PAS UN STATUT, C'EST L'ABSENCE DE
  -- CONTRAT. La clé primaire de cette table est organization_id seul :
  -- il n'y a pas d'historique où chercher un contrat plus ancien.
  if not found then
    return 'transit';
  end if;

  -- ---- A. LA RÉSILIATION : UNE DÉCISION, PAS UN INCIDENT ----------
  --
  -- Les trois façons dont elle s'écrit sont lues ensemble, et il le
  -- faut : `cancel_at_period_end` seul laisse le statut à 'active' tant
  -- que la tâche de nuit ne l'a pas basculé, et les tâches de nuit
  -- dorment. Ne lire que `status` laisserait travailler gratuitement,
  -- pour toujours, quiconque a demandé l'arrêt un soir où le cron était
  -- éteint.
  if v.status = 'cancelled'
     or v.cancelled_at is not null
     or coalesce(v.cancel_at_period_end, false) then
    v_terme := case when v.status = 'trialing' then v.trial_ends_at::date else v.fin_periode end;
    -- Aucun sursis : celui qui a résilié ne s'attend pas à un mois de
    -- rab, et le lui offrir ouvrirait le seul contournement gratuit qui
    -- resterait — résilier, travailler un mois, reprendre.
    if v_terme is null or v_terme < current_date then
      return 'restreint';
    end if;
    return 'ouvert';
  end if;

  -- ---- B. LE CONTRAT COURT : ON NE FERME QUE SUR UNE CRÉANCE -------
  --
  -- saas_invoice_state est la SEULE lecture de « qu'est-ce qui est dû
  -- et depuis quand » de cette base : elle solde les paiements et les
  -- avoirs, et rend 'overdue' / 'partiallyPaidOverdue' quand l'échéance
  -- est passée et qu'il reste quelque chose à payer. On l'appelle, on
  -- ne la réécrit pas : deux définitions de « impayé » finiraient par
  -- diverger, et l'écart se verrait le jour où l'on ferme un compte.
  --
  -- `min(due_on)` : le compte à rebours part de la PLUS ANCIENNE
  -- créance échue. Une facture neuve émise le mois suivant ne remet
  -- donc pas le compteur à zéro.
  --
  -- ---- POURQUOI « DEPUIS LE DÉBUT DE CE CONTRAT-CI » --------------
  --
  -- Sans ce filtre, le péage redevenait une prison par un autre chemin,
  -- et celui-là est bien plus sournois que le premier. Une entreprise
  -- fermée pour impayé repasse à la caisse ; le webhook appelle
  -- saas_reopen_subscription ; elle paie sa nouvelle période. Mais LA
  -- FACTURE IMPAYÉE D'AVANT EST TOUJOURS LÀ — la reprise ne l'efface
  -- pas, et elle a raison de ne pas l'effacer : une facture émise ne
  -- disparaît pas, elle se règle ou se crédite. Le péage la lisait, et
  -- refermait la porte sur un client qui venait de payer.
  --
  -- La reprise pose donc la borne `peage_creances_depuis` à sa date :
  -- on ne compte que ce qui est dû DEPUIS. L'ancienne
  -- créance, elle, N'EST PAS EFFACÉE : elle reste au dossier, visible
  -- dans Entreprise › Abonnement, et les relances continuent de la
  -- réclamer. On cesse simplement de s'en servir pour fermer une porte
  -- que le client vient de payer pour rouvrir. Le recouvrement est un
  -- travail comptable ; ce n'est pas le travail d'un verrou.
  --
  -- Pour un abonnement jamais interrompu, la borne reste NULL : toutes
  -- ses créances comptent, et un mauvais payeur ne se blanchit pas en
  -- laissant tourner les mois.
  select min(f.due_on)
    into v_du_depuis
    from public.saas_invoice_state f
   where f.organization_id = p_organization_id
     and f.effective_status in ('overdue', 'partiallyPaidOverdue')
     and f.due_on >= coalesce(v.peage_creances_depuis, '-infinity'::date);

  -- RIEN N'EST RÉCLAMÉ : rien ne se ferme. C'est aussi le cas d'un
  -- Enterprise négocié, d'un accès de courtoisie et d'un essai en
  -- cours — tous ouverts, et aucun ne doit dépendre d'une date.
  if v_du_depuis is null then
    return 'ouvert';
  end if;

  -- Le jour même de l'échéance reste ouvert : saas_invoice_state ne dit
  -- 'overdue' qu'à partir du lendemain (due_on < current_date), donc ce
  -- battement est déjà dans la donnée.
  if v_du_depuis + c_sursis_en_jours >= current_date then
    return 'sursis';
  end if;

  return 'restreint';
end;
$$;

comment on function public.peage_etat_organisation(uuid) is
  'L''état du contrat d''une organisation, en un mot : ouvert, sursis, restreint, transit. '
  'SEULE lecture autorisée de organization_subscriptions à des fins d''accès. '
  'NE FERME QUE SUR UNE CRÉANCE RÉCLAMÉE — une facture émise, échue et non soldée — jamais sur une date '
  'de période : le renouvellement de nuit avance cette date sans regarder si l''argent est arrivé, et une '
  'facturation en panne est notre faute, pas celle du client. Seule la résiliation se lit sur une date, '
  'parce que c''est une décision. Ne regarde ni le prestataire de paiement, ni les droits iOS.';


-- LA DATE DEPUIS LAQUELLE L'ARGENT EST DÛ, ou NULL si rien n'est
-- réclamé. Extraite pour que l'écran puisse DIRE ce que le péage a
-- décidé — « votre facture du 3 mars » — sans réimplémenter la lecture,
-- et pour que peage_sante() la lise à la même source.
create or replace function public.peage_creance_echue(p_organization_id uuid)
returns table (echue_le date, factures integer, montant_du_cents bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- MÊME SOURCE, MÊME FILTRE que peage_etat_organisation, y compris la
  -- borne « depuis le début de ce contrat-ci ». C'est l'invariant qui
  -- compte : ce que l'écran annonce doit être exactement ce sur quoi la
  -- porte s'est fermée. Le solde complet, lui — créances d'avant une
  -- reprise comprises — se lit dans Entreprise › Abonnement.
  select min(f.due_on)::date,
         count(*)::integer,
         coalesce(sum(f.outstanding_cents), 0)::bigint
    from public.saas_invoice_state f
    join public.organization_subscriptions s on s.organization_id = f.organization_id
   where p_organization_id is not null
     and f.organization_id = p_organization_id
     and f.effective_status in ('overdue', 'partiallyPaidOverdue')
     and f.due_on >= coalesce(s.peage_creances_depuis, '-infinity'::date);
$$;

comment on function public.peage_creance_echue(uuid) is
  'Ce qu''Oasis réclame et qui n''est pas arrivé : depuis quand, combien de factures, combien de centimes. '
  'C''est exactement ce sur quoi peage_etat_organisation() ferme — même source, même filtre — pour que '
  'l''écran puisse nommer la facture au lieu d''annoncer une panne.';


-- ------------------------------------------------------------
-- 2. LA DÉCISION — LA SEULE FONCTION QUE LES POLITIQUES APPELLENT
-- ------------------------------------------------------------
--
-- Elle ne contient QUE la table geste × état. L'état vient d'au-dessus,
-- l'appartenance vient de is_organization_member() : trois
-- responsabilités, trois endroits, aucun dupliqué.

create or replace function public.peage_autorise(
  p_organization_id uuid,
  p_geste text,
  -- Vrai (défaut) : le péage ne parle qu'aux membres — c'est la forme
  --   qu'appellent les politiques, et c'est elle qui épargne d'un seul
  --   geste le client du portail, l'administrateur de plateforme et le
  --   professionnel d'une autre entreprise.
  -- Faux : la règle nue, pour un appelant qui a déjà fait ce tri
  --   lui-même — typiquement une fonction definer qui voudrait se
  --   garder alors que son appelant n'est pas encore membre.
  p_seulement_les_membres boolean default true
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_etat text;
begin
  -- JAMAIS NULL. Une politique restrictive qui reçoit NULL ferme. Une
  -- colonne organization_id nullable — garden_access en a une — ne doit
  -- pas fermer une table par accident.
  if p_organization_id is null then
    return true;
  end if;

  if p_seulement_les_membres and not public.is_organization_member(p_organization_id) then
    return true;
  end if;

  v_etat := public.peage_etat_organisation(p_organization_id);

  -- CRÉER OU MODIFIER LA MATIÈRE DE L'ENTREPRISE, ET LA FAIRE SORTIR
  -- VERS UN TIERS. Ouvert tant qu'il y a un contrat, sursis compris :
  -- un prélèvement qui échoue est un incident bancaire, et couper la
  -- production le vendredi soir où la banque a refusé une carte
  -- coûterait au client un chantier pour nous faire gagner trois jours
  -- de trésorerie.
  if p_geste = 'exploiter' then
    return v_etat in ('ouvert', 'sursis');
  end if;

  -- FAIRE ENTRER UN COLLÈGUE. Un siège de plus est de l'argent dû de
  -- plus. Se ferme dès le sursis : on ne laisse pas commander
  -- davantage celui qui ne règle pas la note.
  if p_geste = 'grandir' then
    return v_etat = 'ouvert';
  end if;

  -- UN GESTE INCONNU LÈVE, IL NE FERME PAS EN SILENCE. Une faute de
  -- frappe dans une politique fermerait une table entière sans que rien
  -- ne le signale ; elle doit se voir au premier essai.
  raise exception 'Geste inconnu au péage : « % ». Les gestes sont « exploiter » et « grandir ».',
    coalesce(p_geste, '(vide)') using errcode = '22023';
end;
$$;

comment on function public.peage_autorise(uuid, text, boolean) is
  'LA décision du péage, et la seule que les politiques interrogent. Table geste × état, rien d''autre. '
  'Rend TOUJOURS vrai pour un non-membre (client du portail, administrateur de plateforme, entreprise tierce) : '
  'les politiques permissives restent seules juges de ce qu''un non-membre peut faire. '
  'Ne rend jamais NULL — une politique restrictive qui reçoit NULL ferme.';


-- Une variante qui LÈVE au lieu de rendre faux, pour les appelants qui
-- ne sont pas des politiques : une fonction definer, un futur point
-- d'entrée. Un refus doit y porter un message lisible par un
-- paysagiste, pas un « 0 ligne » silencieux.
create or replace function public.peage_exiger(p_organization_id uuid, p_geste text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_etat text;
begin
  if public.peage_autorise(p_organization_id, p_geste, false) then
    return;
  end if;

  v_etat := public.peage_etat_organisation(p_organization_id);

  raise exception '%', case v_etat
    when 'transit' then
      'Votre abonnement n''est pas encore souscrit. Vos données sont intactes et vous les gardez : '
      || 'il ne manque que le contrat pour reprendre le travail.'
    when 'sursis' then
      'Votre dernier prélèvement n''a pas abouti. Vous continuez à travailler, mais l''ajout d''un '
      || 'collaborateur attend la régularisation.'
    else
      'Votre abonnement est arrivé à échéance. Vous gardez l''accès à tout ce que vous avez saisi — '
      || 'clients, devis, factures — et vous pouvez l''exporter. Reprenez votre abonnement pour '
      || 'recommencer à créer.'
  end using errcode = '42501';
end;
$$;

comment on function public.peage_exiger(uuid, text) is
  'Le péage pour un appelant qui n''est pas une politique : lève un 42501 avec un message écrit pour un '
  'paysagiste. La règle reste celle de peage_autorise() — cette fonction ne fait que la dire à voix haute.';


-- ------------------------------------------------------------
-- 2 bis. L'ADRESSAGE — TROUVER QUI PAIE POUR CETTE LIGNE
-- ------------------------------------------------------------
--
-- CE QUI MANQUAIT, ET C'ÉTAIT LA MOITIÉ DU PRODUIT. La première
-- version ne connaissait qu'une seule façon de trouver le payeur : une
-- colonne `organization_id`. Mesuré : QUARANTE-NEUF tables sous RLS
-- n'en ont pas — elles portent un `workspace_id`. Ce sont les jardins,
-- les plantes, le jumeau numérique et TOUT LE BIOLAB, c'est-à-dire un
-- module vendu à part. Une entreprise sans le moindre contrat y créait
-- librement, et peage_couverture() affirmait que tout était couvert
-- parce qu'elle cherchait, elle aussi, la même colonne.
--
-- Un péage aveugle à la moitié du produit n'est pas un péage
-- incomplet : c'est un péage qu'on croit complet, ce qui est pire.
--
-- TROIS FAÇONS DE TROUVER LE PAYEUR, ET LA DERNIÈRE EST LA RAISON
-- POUR LAQUELLE CETTE COUCHE EXISTE :
--
--   1. la colonne `organization_id`, quand elle est là et remplie ;
--   2. la colonne `workspace_id`, remontée à l'entreprise qui possède
--      l'espace (business_organizations.workspace_id, unique) ;
--   3. le PARENT, pour une table fille qui ne porte ni l'un ni l'autre
--      — les zones d'un jardin, les photos d'une plante, les actions
--      d'une règle d'automatisation.
--
-- AUCUNE ENTREPRISE NE POSSÈDE L'ESPACE : ON N'A RIEN À DIRE. C'est le
-- monde particulier de l'application iPhone, et il n'a jamais rien
-- promis à personne. On rend `true`, exactement comme
-- biolab_workspace_allows() posée par 0087 le fait déjà — un seul
-- comportement pour un seul cas, plutôt que deux inventions.

create or replace function public.peage_autorise_espace(
  p_workspace_id uuid,
  p_geste text,
  -- MÊME COMMUTATEUR QUE peage_autorise, ET POUR LA MÊME RAISON. Vrai
  -- (défaut) : le péage ne parle qu aux membres, ce qui épargne d un
  -- seul geste le client du portail, l administrateur de plateforme et
  -- l entreprise voisine. Faux : la règle nue, pour un appelant qui a
  -- déjà fait ce tri — un jeu d essai qui mesure la règle depuis le
  -- contexte machine, par exemple, où personne n est membre de rien et
  -- où la fonction rendrait donc « vrai » sans jamais rien mesurer.
  p_seulement_les_membres boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Pas d'espace : rien à fermer. Une politique restrictive qui
    -- recevrait NULL fermerait la table entière.
    when p_workspace_id is null then true
    else coalesce(
      (select public.peage_autorise(o.id, p_geste, p_seulement_les_membres)
         from public.business_organizations o
        where o.workspace_id = p_workspace_id),
      -- Aucune entreprise ne possède cet espace : monde particulier
      -- iOS. Les politiques existantes restent seules juges.
      true)
  end;
$$;

comment on function public.peage_autorise_espace(uuid, text, boolean) is
  'Le péage pour une ligne portée par un ESPACE DE TRAVAIL et non par une organisation : jardins, plantes, '
  'jumeau numérique, BioLab. Remonte à l''entreprise qui possède l''espace et délègue à peage_autorise(). '
  'Rend vrai quand aucune entreprise ne possède l''espace — c''est le monde particulier de l''iPhone, et '
  'il ne doit pas payer pour un contrat professionnel qu''il n''a jamais signé.';


-- L'ADRESSAGE QUE TOUTES LES POLITIQUES APPELLENT.
--
-- POURQUOI DEUX ARGUMENTS ET PAS UN. Cinq tables péagées portent un
-- `organization_id` NULLABLE — smart_tags, garden_access,
-- garden_deliveries, biolab_transferts, etiquette_modeles — et
-- peage_autorise() rend vrai sur NULL, ce qu'il doit faire. Mesuré, ça
-- ouvrait deux trous sur smart_tags (les étiquettes QR/NFC, une
-- fonction vendue) :
--
--   • on insérait en posant simplement organization_id = null ;
--   • et surtout, on MODIFIAIT une ligne péagée en la détachant dans le
--     même ordre : « update … set organization_id = null, <la vraie
--     modification> ». Le `with check` examine la ligne TELLE QU'ELLE
--     SERAIT — donc sans entreprise — et laissait passer. La
--     modification était appliquée ET la ligne sortait du péage pour
--     toujours.
--
-- La colonne nullable n'est donc pas une adresse suffisante. On donne à
-- la politique une SECONDE adresse — l'espace de travail, ou celui du
-- parent — et le détachement ne mène plus nulle part.

create or replace function public.peage_autorise_ligne(
  p_organization_id uuid,
  p_workspace_id uuid,
  p_geste text,
  p_seulement_les_membres boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- L'ORDRE COMPTE. L'organisation est l'adresse la plus précise : une
  -- ligne qui la porte appartient à cette entreprise-là, quel que soit
  -- l'espace où elle se trouve. L'espace n'est consulté que lorsque la
  -- colonne est vide — c'est-à-dire exactement le cas du détachement.
  select case
    when p_organization_id is not null then public.peage_autorise(p_organization_id, p_geste, p_seulement_les_membres)
    when p_workspace_id is not null then public.peage_autorise_espace(p_workspace_id, p_geste, p_seulement_les_membres)
    -- Ni l'une ni l'autre : la ligne n'appartient à personne qui paie.
    -- On ne ferme pas ce qu'on ne sait pas rattacher — on le SIGNALE,
    -- et c'est le travail de peage_couverture().
    else true
  end;
$$;

comment on function public.peage_autorise_ligne(uuid, uuid, text, boolean) is
  'L''ADRESSAGE : la seule fonction que les politiques du péage appellent. Elle ne décide rien — elle '
  'trouve qui paie (organisation, sinon espace de travail, sinon personne) et délègue à peage_autorise(). '
  'Deux adresses et non une, parce qu''une colonne organization_id nullable se met à NULL dans l''ordre '
  'même qui modifie la ligne, et sortait ainsi du péage pour toujours.';


-- ------------------------------------------------------------
-- 2 ter. REMONTER AU PARENT SANS SE FAIRE AVEUGLER PAR LA RLS
-- ------------------------------------------------------------
--
-- Une quinzaine de tables filles ne portent NI organisation NI espace :
-- les zones d'un jardin, les photos d'une plante, les actions d'une
-- règle d'automatisation. Leur payeur est celui du parent.
--
-- POURQUOI UNE FONCTION « definer » ET PAS UN SIMPLE SOUS-SELECT. Un
-- `(select g.workspace_id from gardens g where g.id = garden_id)` écrit
-- dans une politique s'exécute avec les droits de CELUI QUI ÉCRIT :
-- la RLS de `gardens` s'y applique. Un jardin que l'appelant ne voit
-- pas rendrait NULL, donc « aucune adresse », donc OUVERT. Le péage
-- s'ouvrirait précisément pour qui en voit le moins. Une fonction
-- definer voit le parent quoi qu'il arrive ; elle ne divulgue rien —
-- elle ne rend qu'un identifiant d'espace, jamais une donnée.
--
-- UN SEUL POINT D'ENTRÉE, UN `case` STATIQUE, AUCUN SQL DYNAMIQUE. Le
-- nom du parent vient de la carte du péage, pas d'un appelant : sept
-- branches écrites en clair, et une exception si l'on en demande une
-- huitième. Un `execute format(...)` ici serait une injection SQL
-- offerte à toute politique mal écrite.

create or replace function public.peage_espace_de(p_parent text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_espace uuid;
begin
  if p_id is null then
    return null;
  end if;

  case p_parent
    when 'gardens' then
      select g.workspace_id into v_espace from public.gardens g where g.id = p_id;
    when 'plants' then
      select p.workspace_id into v_espace from public.plants p where p.id = p_id;
    when 'automation_rules' then
      select r.workspace_id into v_espace from public.automation_rules r where r.id = p_id;
    when 'bioreactor_inspections' then
      select i.workspace_id into v_espace from public.bioreactor_inspections i where i.id = p_id;
    when 'garden_checkups' then
      select c.workspace_id into v_espace from public.garden_checkups c where c.id = p_id;
    when 'irrigation_zones' then
      select z.workspace_id into v_espace from public.irrigation_zones z where z.id = p_id;
    when 'scenes' then
      select s.workspace_id into v_espace from public.scenes s where s.id = p_id;
    else
      raise exception 'Parent inconnu au péage : « % ». Ajoutez-le au case de peage_espace_de().', p_parent
        using errcode = '22023';
  end case;

  return v_espace;
end;
$$;

comment on function public.peage_espace_de(text, uuid) is
  'L''espace de travail du PARENT d''une ligne fille (zones d''un jardin, photos d''une plante, actions '
  'd''une règle). « security definer » à dessein : un sous-select écrit dans la politique serait soumis à '
  'la RLS du parent, et un parent invisible rendrait NULL — c''est-à-dire OUVERT. Le péage s''ouvrirait '
  'pour qui voit le moins.';


-- ------------------------------------------------------------
-- 3. CE QUE L'ÉCRAN A LE DROIT DE SAVOIR
-- ------------------------------------------------------------
--
-- Un écran qui ne peut pas prévoir un refus le présente comme une
-- panne. Cette fonction lui donne de quoi dire, AVANT le clic, ce qui
-- est ouvert et pourquoi — sans réimplémenter la règle, puisqu'elle
-- appelle les fonctions précédentes.
--
-- ELLE DIT AUSSI CE QUE LE STATUT NE DIT PLUS. `status` reste 'active'
-- sur une entreprise qui n'a rien réglé depuis deux mois : aucune
-- fonction de cette base ne pose 'pastDue', et le renouvellement de
-- nuit ne regarde pas l'argent. L'écran, lui, doit dire la vérité —
-- d'où `impayeDepuis`, `facturesEchues` et `montantDuCents`, lus à la
-- MÊME source que la décision.
--
-- ELLE EST « security definer », DONC ELLE DOIT SE GARDER ELLE-MÊME.
-- Sans la clause ci-dessous, n'importe quel compte authentifié
-- interrogerait le contrat de n'importe quelle entreprise du parc —
-- son offre, son statut, ses échéances — alors que la RLS de
-- organization_subscriptions réserve cette lecture à ses membres.
-- La fonction rend NULL à qui n'a rien à y voir : trois populations
-- seulement passent, et ce sont exactement celles qui lisent déjà la
-- table.
create or replace function public.peage_situation(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not (
      -- la machine : aucun utilisateur derrière la requête, c'est le
      -- serveur qui décide d'une redirection avant d'afficher la page
      auth.uid() is null
      or public.is_organization_member(p_organization_id)
      or public.platform_admin_can('billing.subscriptions.read')
    ) then null else jsonb_build_object(
    'etat',          e.etat,
    'peutExploiter', public.peage_autorise(p_organization_id, 'exploiter', false),
    'peutGrandir',   public.peage_autorise(p_organization_id, 'grandir', false),
    'statut',        s.status,
    'offre',         s.plan,
    'cycle',         s.billing_cycle,
    'finEssai',      s.trial_ends_at,
    'finPeriode',    coalesce(s.current_period_end_on, s.current_period_end::date),
    'resilieLe',     s.cancelled_at,
    -- CE QUI FERME VRAIMENT, NOMMÉ. Trois faits qu'un paysagiste
    -- comprend : depuis quand, combien de factures, combien d'euros.
    'impayeDepuis',    c.echue_le,
    'facturesEchues',  coalesce(c.factures, 0),
    'montantDuCents',  coalesce(c.montant_du_cents, 0),
    -- Combien de jours il reste avant que la production s'arrête. Nul
    -- quand la question ne se pose pas.
    'joursDeSursisRestants',
      case when e.etat <> 'sursis' then null
           else greatest(0, (c.echue_le + 30) - current_date) end
  ) end
  -- L'ORGANISATION EN TRANSIT N'A PAS DE LIGNE. Le left join depuis une
  -- source à une ligne garantit qu'on rend TOUJOURS un objet, avec ses
  -- champs de contrat à null. Un `from organization_subscriptions` seul
  -- ne rendrait rien du tout, et l'écran afficherait une page blanche
  -- au moment précis où il doit proposer de s'abonner.
  from (select public.peage_etat_organisation(p_organization_id) as etat) e
  left join public.organization_subscriptions s
    on s.organization_id = p_organization_id
  left join lateral public.peage_creance_echue(p_organization_id) c on true;
$$;

comment on function public.peage_situation(uuid) is
  'Ce que l''écran affiche : l''état, ce qui reste ouvert, les dates, et LA CRÉANCE QUI FERME — depuis '
  'quand, combien de factures, combien de centimes. N''implémente aucune règle : elle appelle '
  'peage_etat_organisation(), peage_autorise() et peage_creance_echue(). Un écran qui ne peut pas prévoir '
  'un refus le présente comme une panne.';


-- ------------------------------------------------------------
-- 4. LES GRANT — UNE FONCTION DE DÉCISION MAL ACCORDÉE EST UNE
--    PORTE DÉROBÉE
-- ------------------------------------------------------------
--
-- DEUX SOURCES DE DROITS, PAS UNE, ET C'EST LÀ QUE 0055 S'EST FAIT
-- AVOIR. PostgreSQL accorde EXECUTE à `public` sur toute fonction
-- créée ; Supabase, en plus, a posé des DEFAULT PRIVILEGES qui
-- accordent EXECUTE à `anon`, `authenticated` et `service_role` sur
-- toute fonction NOUVELLE du schéma public. Retirer à `public` ne
-- retire donc RIEN à ces trois-là : le grant leur est nominatif.
--
-- Mesuré au premier passage du jeu d'essai : sans les lignes
-- nominatives ci-dessous, un visiteur ANONYME pouvait interroger l'état
-- du contrat de n'importe quelle entreprise du parc, et un client
-- authentifié pouvait appeler lui-même saas_reopen_subscription. On
-- retire donc aux quatre, puis on rend à qui en a besoin.

revoke all on function public.peage_etat_organisation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.peage_creance_echue(uuid) from public, anon, authenticated, service_role;
revoke all on function public.peage_autorise(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.peage_autorise_espace(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.peage_autorise_ligne(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.peage_espace_de(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.peage_exiger(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.peage_situation(uuid) from public, anon, authenticated, service_role;

-- `authenticated` reçoit TROIS fonctions, et pas les huit.
--
--   peage_autorise_ligne : indispensable. C'est elle, et elle seule,
--     que les politiques nomment ; une politique est évaluée avec les
--     droits de CELUI QUI ÉCRIT, donc sans ce grant chaque insertion
--     rendrait « permission refusée sur la fonction » au lieu du refus
--     RLS attendu.
--   peage_espace_de : nommée elle aussi DANS l'expression de plusieurs
--     politiques (les tables filles), donc évaluée avec les droits de
--     l'appelant. Elle ne rend qu'un identifiant d'espace.
--   peage_situation : l'écran en a besoin, et elle se garde elle-même —
--     elle rend NULL à qui n'est pas membre.
--
-- LES AUTRES NE LUI SONT PAS ACCORDÉES, et surtout pas
-- peage_autorise() ni peage_creance_echue() : elles répondent sur
-- N'IMPORTE QUELLE entreprise sans vérifier l'appartenance, et
-- peage_creance_echue dirait à qui le demande combien doit le voisin.
-- Les fonctions definer qui les appellent tournent avec les droits de
-- leur propriétaire, pas ceux de l'appelant : ce retrait ne casse aucun
-- appel interne.
grant execute on function public.peage_autorise_ligne(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.peage_espace_de(text, uuid) to authenticated;
grant execute on function public.peage_situation(uuid) to authenticated;

-- `anon` : uniquement l'adressage, et uniquement parce qu'une politique
-- restrictive est ÉVALUÉE avant d'être refusée. Sans ce grant, une
-- tentative anonyme rendrait « permission refusée sur la fonction »
-- au lieu du refus RLS attendu — un message qui raconte notre plomberie
-- à quelqu'un qui n'a rien à y faire. Aucune information ne fuit :
-- peage_autorise rend « vrai » à tout non-membre, et anon n'est membre
-- de rien.
grant execute on function public.peage_autorise_ligne(uuid, uuid, text, boolean) to anon;
grant execute on function public.peage_espace_de(text, uuid) to anon;

-- `service_role` contourne la RLS : il n'a rien à demander au péage
-- pour écrire. Mais le serveur décide d'une REDIRECTION avant
-- d'afficher une page — c'est là que se branche la porte du tunnel —
-- et pour cela il doit connaître l'état.
grant execute on function public.peage_etat_organisation(uuid) to service_role;
grant execute on function public.peage_creance_echue(uuid) to service_role;
grant execute on function public.peage_situation(uuid) to service_role;
grant execute on function public.peage_exiger(uuid, text) to service_role;


-- ------------------------------------------------------------
-- 5. LE PÉRIMÈTRE — UNE TABLE, PARCE QU'UN PÉAGE DOIT S'AUDITER
--    PAR UNE REQUÊTE
-- ------------------------------------------------------------
--
-- Une ligne par table sous RLS, son geste, et LES DEUX ADRESSES par
-- lesquelles on trouve qui paie. La carte du péage se lit donc par une
-- requête, et non en relisant une migration.
--
-- LE PÉRIMÈTRE EST REFAIT À CHAQUE PASSAGE. `drop table if exists` puis
-- reconstruction complète : c'est une CARTE, pas un journal. Une carte
-- que l'on complète sans jamais la redessiner finit par décrire un pays
-- qui n'existe plus — une table renommée y resterait pour toujours, et
-- le détecteur de dérive la chercherait en vain.

drop table if exists public.peage_perimetre;

create table public.peage_perimetre (
  table_name text primary key,
  geste      text not null check (geste in ('exploiter', 'grandir', 'hors-champ')),
  -- L'EXPRESSION SQL qui, évaluée sur la ligne, donne l'organisation
  -- qui paie. NULL quand la table n'en porte pas.
  cible_organisation text,
  -- L'EXPRESSION SQL qui donne l'ESPACE DE TRAVAIL. Seconde adresse :
  -- elle sert quand la première est absente ou vide, et c'est elle qui
  -- ferme le détachement (« update … set organization_id = null »).
  cible_espace text,
  motif      text
);

comment on table public.peage_perimetre is
  'La carte du péage : une ligne par table sous RLS, le geste sous lequel elle est rangée, et les deux '
  'expressions par lesquelles une politique trouve qui paie — l''organisation, sinon l''espace de travail. '
  'La lire répond à « qu''est-ce qui se ferme » sans relire une migration.';

alter table public.peage_perimetre enable row level security;
-- Aucune politique, volontairement : la carte du péage se lit par la
-- machine et se modifie par une migration. Personne d'autre.
-- Même précaution que pour les fonctions : Supabase a posé des DEFAULT
-- PRIVILEGES qui accordent tout à anon et authenticated sur les tables
-- NOUVELLES du schéma public. La RLS sans politique suffirait à fermer
-- la lecture, mais on ne laisse pas une seule barrière tenir seule la
-- carte du péage.
revoke all on table public.peage_perimetre from public, anon, authenticated;



-- --- LES EXEMPTIONS, ET LEUR MOTIF ---------------------------
--
-- Chacune est un cas où fermer coûterait plus cher que le trou qu'elle
-- laisse. Il n'y en a pas d'autre.

insert into public.peage_perimetre (table_name, geste, cible_organisation, cible_espace, motif) values
  ('audit_events', 'hors-champ', null, null,
   'La trace ne se ferme pas. Un péage qui empêche d''écrire au journal efface sa propre preuve, et fait échouer l''action pour la mauvaise raison.'),
  ('saas_machine_events', 'hors-champ', null, null,
   'Le journal de la machine. Même motif qu''audit_events.'),
  ('biolab_audit_entries', 'hors-champ', null, null,
   'Le journal du BioLab. Même motif qu''audit_events : on ne ferme pas la trace de ce qui s''est passé.'),
  ('analytics_events', 'hors-champ', null, null,
   'La télémétrie. Elle n''est pas de la valeur produite, et la fermer ferait échouer des écrans pour un motif que personne ne comprendrait.'),

  ('notifications', 'hors-champ', null, null,
   'C''est le canal par lequel on dit « il faut payer ». Le couper, c''est éteindre la lumière dans la pièce où l''on cherche l''interrupteur.'),
  ('notification_reads', 'hors-champ', null, null,
   'Marquer une notification comme lue. Aucune valeur créée, et le fermer laisserait le bandeau de relance clignoter pour toujours.'),

  ('user_favorites', 'hors-champ', null, null,
   'Confort de navigation, par utilisateur, aucune valeur créée. Le fermer ferait échouer la lecture de ses propres données.'),
  ('user_recent_items', 'hors-champ', null, null,
   'Confort de navigation, par utilisateur, aucune valeur créée. Le fermer ferait échouer la lecture de ses propres données.'),
  ('dashboard_preferences', 'hors-champ', null, null,
   'La disposition de son tableau de bord. Confort par utilisateur : rien n''est produit, et un écran figé n''aide personne à payer.'),
  ('profiles', 'hors-champ', null, null,
   'La fiche de la PERSONNE, pas celle de l''entreprise. Elle suit le compte, pas le contrat.'),

  ('organization_subscriptions', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('organization_subscription_events', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('organization_subscription_modules', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('subscription_commitment_acceptances', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('subscription_discounts', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('billing_provider_customers', 'hors-champ', null, null,
   'Le rattachement au prestataire de paiement. Le fermer rendrait un réabonnement impossible à rapprocher.'),
  ('saas_account_credits', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('saas_credit_notes', 'hors-champ', null, null,
   'Le dossier de facturation : c''est par là qu''on paie, donc par là qu''on rouvre.'),
  ('saas_customer_tax_profiles', 'hors-champ', null, null,
   'Le régime de TVA de l''entreprise. Sans lui aucune facture Oasis ne peut être émise : le fermer interdirait de facturer celui qui veut payer.'),
  ('saas_invoices', 'hors-champ', null, null,
   'Les factures qu''Oasis lui adresse. Il doit pouvoir les voir et les régler, surtout suspendu — et c''est désormais SUR ELLES que le péage se ferme.'),
  ('relances_planifiees', 'hors-champ', null, null,
   'Les relances de paiement. Les fermer empêcherait de réclamer l''argent qui rouvrirait le compte.'),

  ('support_tickets', 'hors-champ', null, null,
   'Demander de l''aide ne se ferme jamais — surtout pas à celui qui n''arrive plus à payer.'),
  ('support_sessions', 'hors-champ', null, null,
   'Demander de l''aide ne se ferme jamais — surtout pas à celui qui n''arrive plus à payer.'),

  -- --- L'AXE iPHONE : LE PÉAGE NE LE LIT PAS, DONC NE LE FERME PAS ---
  --
  -- Un droit iOS est porté PAR UTILISATEUR ET PAR ESPACE ; un contrat
  -- Pro est porté PAR ORGANISATION. Fermer ces tables-là au nom du
  -- contrat Pro reviendrait à croiser les deux axes par la bande — et
  -- couperait l'application iPhone d'un salarié parce que son patron
  -- n'a pas payé Oasis Care Pro.
  ('subscription_entitlements', 'hors-champ', null, null,
   'Les droits de l''application iPhone. AUTRE AXE : par utilisateur et par espace, jamais par organisation. Le péage ne le lit pas et ne le ferme pas.'),
  ('subscription_customers', 'hors-champ', null, null,
   'Le dossier client de l''App Store. Autre axe, autre caisse : rien à voir avec le contrat Pro.'),
  ('subscription_events', 'hors-champ', null, null,
   'Le journal des achats App Store. Autre axe, et c''est une trace.'),

  -- --- CE QUI PERMET DE PAYER, ET CE QUI FAIT NAÎTRE UNE ENTREPRISE ---
  ('business_organizations', 'hors-champ', null, null,
   'LA FICHE DE LA SOCIÉTÉ. Sans dénomination, SIRET, adresse et TVA, aucune facture Oasis ne peut lui être adressée : fermer cette table interdirait à un suspendu de se mettre en règle pour payer. C''est joué au § 4 du jeu d''essai.'),
  ('workspaces', 'hors-champ', null, null,
   'L''espace de travail lui-même. C''est par là qu''une entreprise naît — le fermer empêcherait de fonder la société qui va souscrire.'),

  -- --- LA MACHINE, ET CE QU'ELLE ÉCRIT EN VOLUME ---------------
  ('usage_counters', 'hors-champ', null, null,
   'Les compteurs d''usage, écrits par la machine. Les fermer fausserait la facturation elle-même.'),
  ('sensor_readings', 'hors-champ', null, null,
   'Les relevés des capteurs. Écrits par les appareils, en continu et en volume : ce n''est pas un geste de production, et un sous-select par ligne y coûterait plus que le trou qu''il ferme.'),
  ('automation_executions', 'hors-champ', null, null,
   'La trace d''exécution des automatismes. Écrite par la machine, et c''est une trace.'),

-- --- LE GESTE « GRANDIR » ------------------------------------
--
-- Les trois tables par lesquelles un compte entre dans l'entreprise. Un
-- siège se compte en organization_members non archivés (voir
-- saas_start_subscription) ; employees et team_members décrivent des
-- personnes, pas des comptes qui se connectent, et se rangent donc avec
-- le reste.

  ('organization_members', 'grandir', 'organization_id', null,
   'Un membre de plus est un siège de plus, donc de l''argent dû de plus.'),
  ('organization_invitations', 'grandir', 'organization_id', null,
   'Une invitation est un siège en chemin. On la ferme au même moment que le siège lui-même.'),
  ('workspace_members', 'grandir', null, 'workspace_id',
   'L''autre porte du même siège : create_professional_organization écrit dans les deux tables. En fermer une seule laisserait la seconde ouverte.'),

-- --- LES CINQ ADRESSES NULLABLES, ET LEUR SECONDE ADRESSE -----
--
-- Ces tables portent un organization_id NULLABLE. Sans seconde
-- adresse, on en sortait par « update … set organization_id = null ».
-- Mesuré sur smart_tags : la modification passait ET la ligne quittait
-- le péage définitivement.

  ('smart_tags', 'exploiter', 'organization_id', 'workspace_id',
   'Étiquettes QR/NFC (0090), une fonction vendue. organization_id est nullable et la politique existante ne regarde que l''espace : c''est l''espace qui rattrape le détachement.'),
  ('garden_access', 'exploiter', 'organization_id', 'public.peage_espace_de(''gardens'', garden_id)',
   'organization_id nullable. Le jardin, lui, est obligatoire : on remonte par lui.'),
  ('garden_deliveries', 'exploiter', 'organization_id', 'coalesce(from_workspace_id, public.peage_espace_de(''gardens'', garden_id))',
   'organization_id nullable. On remonte par l''espace d''origine, à défaut par le jardin livré.'),
  ('biolab_transferts', 'exploiter', 'organization_id', 'coalesce(espace_source, espace_destination)',
   'organization_id nullable. Les deux espaces du transfert servent de seconde adresse.'),
  ('etiquette_modeles', 'exploiter', 'organization_id', null,
   'organization_id nullable et AUCUNE seconde adresse n''existe : une ligne sans organisation est un modèle de plateforme. Aucune politique permissive ne laisse un membre en créer un — vérifié — mais peage_sante() le signale, parce que cette sûreté-là ne tient qu''à l''absence d''une politique que quelqu''un pourrait ajouter demain.'),

-- --- LES TABLES FILLES : LE PAYEUR EST CELUI DU PARENT --------
--
-- Elles ne portent ni organisation ni espace. Les laisser dehors
-- laissait ajouter des zones à un jardin, des photos à une plante et
-- des actions à une règle pendant qu'on ne payait plus.

  ('garden_zones', 'exploiter', null, 'public.peage_espace_de(''gardens'', garden_id)', 'Le payeur est celui du jardin.'),
  ('ai_analyses', 'exploiter', null, 'public.peage_espace_de(''plants'', plant_id)', 'Le payeur est celui de la plante. Et une analyse par l''IA nous coûte de l''argent à chaque appel.'),
  ('care_events', 'exploiter', null, 'public.peage_espace_de(''plants'', plant_id)', 'Le payeur est celui de la plante.'),
  ('care_schedules', 'exploiter', null, 'public.peage_espace_de(''plants'', plant_id)', 'Le payeur est celui de la plante.'),
  ('plant_photos', 'exploiter', null, 'public.peage_espace_de(''plants'', plant_id)', 'Le payeur est celui de la plante.'),
  ('automation_actions', 'exploiter', null, 'public.peage_espace_de(''automation_rules'', rule_id)', 'Le payeur est celui de la règle d''automatisation.'),
  ('automation_conditions', 'exploiter', null, 'public.peage_espace_de(''automation_rules'', rule_id)', 'Le payeur est celui de la règle d''automatisation.'),
  ('scene_actions', 'exploiter', null, 'public.peage_espace_de(''scenes'', scene_id)', 'Le payeur est celui de la scène.'),
  ('garden_checkup_entries', 'exploiter', null, 'public.peage_espace_de(''garden_checkups'', checkup_id)', 'Le payeur est celui du bilan de jardin.'),
  ('biolab_inspection_photos', 'exploiter', null, 'public.peage_espace_de(''bioreactor_inspections'', inspection_id)', 'Le payeur est celui de l''inspection.'),
  ('irrigation_events', 'exploiter', null, 'public.peage_espace_de(''irrigation_zones'', zone_id)', 'Le payeur est celui de la zone d''arrosage.')

on conflict (table_name) do update
  set geste = excluded.geste,
      cible_organisation = excluded.cible_organisation,
      cible_espace = excluded.cible_espace,
      motif = excluded.motif;


-- --- TOUT LE RESTE : « EXPLOITER », SUR L'ADRESSE QU'ON TROUVE ---
--
-- Le défaut est de FERMER, pas d'ouvrir. Une table sous RLS qui porte
-- une adresse et que personne n'a classée est de la matière
-- d'entreprise jusqu'à preuve du contraire ; c'est le sens de péage que
-- l'on veut le jour où quelqu'un ajoutera une table sans penser à
-- l'argent.
--
-- LES DEUX AXES SONT RAMASSÉS ICI, et c'est tout le correctif : la
-- version précédente ne cherchait que `organization_id` et laissait
-- quarante-neuf tables dehors — les jardins, les plantes, le jumeau
-- numérique et le BioLab entier.

insert into public.peage_perimetre (table_name, geste, cible_organisation, cible_espace, motif)
select c.relname,
       'exploiter',
       case when bool_or(a.attname = 'organization_id') then 'organization_id' end,
       case when bool_or(a.attname = 'workspace_id') then 'workspace_id' end,
       null
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid
                     and a.attnum > 0
                     and not a.attisdropped
                     and a.attname in ('organization_id', 'workspace_id')
 where c.relkind = 'r'
 group by c.relname
on conflict (table_name) do nothing;


-- ------------------------------------------------------------
-- 6. LES POLITIQUES RESTRICTIVES
-- ------------------------------------------------------------
--
-- Une politique restrictive s'ajoute en ET à toutes les permissives de
-- sa table : les 435 politiques existantes ne bougent pas d'un
-- caractère. Deux par table — création, modification — et rien sur
-- SELECT ni sur DELETE, conformément à la règle.
--
-- ON NETTOIE AVANT DE POSER, PARTOUT. Le `drop policy if exists` court
-- sur TOUTES les tables de la carte, y compris celles rangées
-- « hors-champ ». Sans cela, une table qu'on exempterait demain
-- garderait la politique posée hier : la migration serait rejouable
-- mais pas réversible, et la carte mentirait.

do $$
declare
  r record;
  v_org text;
  v_espace text;
  v_garde text;
begin
  for r in
    select p.table_name, p.geste, p.cible_organisation, p.cible_espace
      from public.peage_perimetre p
      join pg_class c on c.relname = p.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
     order by p.table_name
  loop
    execute format('drop policy if exists %I on public.%I', 'Péage — création', r.table_name);
    execute format('drop policy if exists %I on public.%I', 'Péage — modification', r.table_name);

    continue when r.geste = 'hors-champ';

    -- UNE TABLE PÉAGÉE SANS ADRESSE EST UNE ERREUR DE CARTE, PAS UNE
    -- TABLE OUVERTE. On lève : un péage silencieusement inopérant est
    -- exactement le défaut que ce fichier corrige.
    if r.cible_organisation is null and r.cible_espace is null then
      raise exception 'Péage : la table « % » est péagée mais n''a aucune adresse. Renseignez cible_organisation ou cible_espace dans peage_perimetre.', r.table_name
        using errcode = '22023';
    end if;

    v_org    := coalesce(r.cible_organisation, 'null::uuid');
    v_espace := coalesce(r.cible_espace, 'null::uuid');

    -- UNE SEULE ADRESSE, ET ELLE PEUT ÊTRE VIDE : ON EXIGE QU'ELLE SOIT
    -- REMPLIE. C'est le cas d'etiquette_modeles, et c'est le dernier
    -- endroit par lequel on sortait du péage — peage_autorise_ligne rend
    -- « vrai » quand elle ne trouve aucun payeur, ce qu'elle doit faire,
    -- et une ligne posée sans organisation n'aurait donc jamais été
    -- gardée. Là où une seconde adresse existe, ce garde est inutile :
    -- l'espace de travail rattrape déjà le détachement.
    --
    -- CE QUE ÇA N'EMPÊCHE PAS. Les lignes sans organisation sont des
    -- modèles de plateforme, et ils sont posés par des fonctions
    -- « security definer » qui ne voient pas la RLS. Ce garde ne coûte
    -- donc rien de légitime : il ferme un chemin que seul un client
    -- écrivant en direct pourrait prendre.
    if r.cible_espace is null
       and exists (
         select 1 from pg_attribute a
          where a.attrelid = ('public.' || quote_ident(r.table_name))::regclass
            and a.attname = r.cible_organisation
            and not a.attnotnull)
    then
      v_garde := format('%s is not null and ', r.cible_organisation);
    else
      v_garde := '';
    end if;

    execute format(
      'create policy %I on public.%I as restrictive for insert to public '
      || 'with check (%s public.peage_autorise_ligne(%s, %s, %L))',
      'Péage — création', r.table_name, v_garde, v_org, v_espace, r.geste);

    -- LA MODIFICATION EST GARDÉE PAR « with check » SEUL, ET C'EST
    -- DÉLIBÉRÉ. Une clause « using » rendrait les lignes INVISIBLES à
    -- l'ordre update : PostgreSQL n'en modifierait aucune et ne
    -- signalerait rien. « 0 ligne modifiée » n'est pas une erreur —
    -- l'écran afficherait « enregistré », le paysagiste croirait avoir
    -- corrigé son devis, et il ne l'aurait pas. Un péage qui laisse
    -- croire qu'on est passé est pire qu'un péage ouvert.
    --
    -- « with check » examine la ligne TELLE QU'ELLE SERAIT APRÈS : la
    -- modification part, la vérification la refuse, et le client reçoit
    -- un vrai refus (42501) qu'un écran peut traduire. L'effet sur
    -- l'accès est identique ; seule la façon de dire non change.
    --
    -- ET LE DÉTACHEMENT NE SAUVE PLUS PERSONNE : la ligne telle qu'elle
    -- serait, privée de son organisation, garde son espace de travail,
    -- et c'est par là que peage_autorise_ligne la retrouve.
    execute format(
      'create policy %I on public.%I as restrictive for update to public '
      || 'with check (%s public.peage_autorise_ligne(%s, %s, %L))',
      'Péage — modification', r.table_name, v_garde, v_org, v_espace, r.geste);
  end loop;
end $$;


-- ------------------------------------------------------------
-- 7. LE DÉTECTEUR DE DÉRIVE
-- ------------------------------------------------------------
--
-- Une migration ne couvre que les tables qui existaient le jour où on
-- l'a lancée. Celle qu'on ajoutera l'an prochain passera au travers, en
-- silence, et personne ne s'en apercevra — c'est exactement ainsi que
-- l'on se retrouve avec 435 politiques dont aucune ne parle d'argent,
-- puis avec quarante-neuf tables ouvertes sous un audit qui rend zéro.
-- Cette fonction rend les tables oubliées ; le jeu d'essai exige
-- qu'elle rende zéro ligne.

create or replace function public.peage_couverture()
returns table (table_name text, souci text)
language sql
stable
set search_path = public, pg_temp
as $$
  -- a) une table porte une adresse et n'a jamais été classée.
  --    LES DEUX AXES SONT CHERCHÉS. Ne chercher que organization_id
  --    est ce qui a laissé le BioLab et les jardins dehors en
  --    affirmant que tout allait bien.
  select c.relname::text,
         'Table jamais classée au péage : ajoutez-la à peage_perimetre.'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid
                       and a.attname in ('organization_id', 'workspace_id')
                       and a.attnum > 0
                       and not a.attisdropped
   where c.relkind = 'r'
     and not exists (select 1 from public.peage_perimetre p where p.table_name = c.relname)
   group by c.relname

  union all

  -- b) une table est dans le champ mais il lui manque une politique
  select p.table_name,
         ('Politique de péage manquante : ' || m.cmd)::text
    from public.peage_perimetre p
    cross join (values ('INSERT'), ('UPDATE')) as m(cmd)
   where p.geste <> 'hors-champ'
     and exists (select 1 from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                  where c.relname = p.table_name and c.relkind = 'r')
     and not exists (
       select 1 from pg_policies pol
        where pol.schemaname = 'public'
          and pol.tablename = p.table_name
          and pol.permissive = 'RESTRICTIVE'
          and pol.cmd = m.cmd
          and coalesce(pol.qual, '') || coalesce(pol.with_check, '') like '%peage_autorise_ligne%')

  union all

  -- c) LA POLITIQUE EST POSÉE MAIS LA RLS EST ÉTEINTE — donc elle ne
  --    s'applique à personne. Une politique sur une table sans RLS est
  --    parfaitement inerte, et rien ne le disait : l'audit comptait la
  --    politique et concluait « couverte ». C'est le genre d'angle mort
  --    qui produit « 435 politiques dont aucune ne parle d'argent ».
  select p.table_name,
         'Politique de péage INERTE : la RLS n''est pas activée sur cette table.'::text
    from public.peage_perimetre p
    join pg_class c on c.relname = p.table_name and c.relkind = 'r'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where p.geste <> 'hors-champ'
     and not c.relrowsecurity

  order by 1, 2;
$$;

comment on function public.peage_couverture() is
  'Les tables que le péage a oubliées. Doit rendre zéro ligne. Cherche LES DEUX AXES — organization_id et '
  'workspace_id — et vérifie que la RLS est bien allumée, sans quoi la politique posée est inerte. '
  'Une table ajoutée après 0092 y apparaîtra : c''est le seul moyen de s''apercevoir d''un trou avant '
  'qu''un client ne le trouve.';

revoke all on function public.peage_couverture() from public, anon, authenticated, service_role;
grant execute on function public.peage_couverture() to service_role;


-- ------------------------------------------------------------
-- 7 bis. LA SANTÉ DU PÉAGE — CE QUI L'EMPÊCHE DE MORDRE
-- ------------------------------------------------------------
--
-- POURQUOI CETTE FONCTION EXISTE, ET POURQUOI ELLE EST AUSSI IMPORTANTE
-- QUE LE PÉAGE LUI-MÊME.
--
-- Depuis que la règle est « on ne ferme que sur une créance réclamée »,
-- le péage dépend de la FACTURATION. Si la facturation ne tourne pas,
-- il ne se ferme jamais — ce qui est le bon comportement (on ne
-- suspend pas pour une panne de notre côté), mais qui laisse croire
-- que tout va bien alors que rien ne mord.
--
-- Un péage silencieusement inopérant est pire que pas de péage : on
-- s'en remet à lui. Cette fonction dit, en français, ce qui l'empêche
-- de fonctionner. Elle doit rendre ZÉRO LIGNE le jour de la mise en
-- service, et c'est la première chose à vérifier.

create or replace function public.peage_sante()
returns table (sujet text, constat text, a_faire text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 1. NOTRE PROPRE IDENTITÉ D'ÉMETTEUR. Sans elle,
  --    saas_generate_invoices refuse d'émettre, donc aucune créance
  --    n'est jamais réclamée, donc le péage ne ferme JAMAIS rien.
  --    Mesuré au moment d'écrire : tous ces champs sont vides.
  select 'Identité de l''émetteur'::text,
         ('Il manque sur notre papier à en-tête : ' || m.manque)::text,
         'Renseignez saas_billing_issuer. Sans elle aucune facture Oasis ne part, et le péage ne se ferme sur rien.'::text
    from (
      select string_agg(x.champ, ', ' order by x.champ) as manque
        from public.saas_billing_issuer i,
             lateral (values
               ('legal_name', i.legal_name), ('siret', i.siret), ('vat_number', i.vat_number),
               ('address_line1', i.address_line1), ('postal_code', i.postal_code), ('city', i.city),
               ('iban', i.iban), ('late_penalty_terms', i.late_penalty_terms)
             ) as x(champ, valeur)
       where nullif(btrim(coalesce(x.valeur, '')), '') is null
    ) m
   where m.manque is not null

  union all

  -- Aucune ligne du tout, c'est le même défaut en pire.
  select 'Identité de l''émetteur'::text,
         'Aucune ligne dans saas_billing_issuer.'::text,
         'Créez-la : sans identité d''émetteur, aucune facture Oasis ne peut être émise.'::text
   where not exists (select 1 from public.saas_billing_issuer)

  union all

  -- 2. LES TÂCHES DE NUIT. Sans elles, aucun essai ne se termine,
  --    aucune période ne se renouvelle, donc aucune facture n'est
  --    émise, donc rien ne se ferme jamais.
  select 'Tâche de nuit'::text,
         ('« ' || j.jobname ||' » (' || j.schedule || ') est éteinte.')::text,
         ('select cron.alter_job(' || j.jobid || ', active => true);')::text
    from cron.job j
   where j.jobname in ('oasis-cycle-facturation', 'oasis-relances')
     and not j.active

  union all

  -- 3. UN ESSAI SANS DATE DE FIN. Il ne se terminera jamais : la tâche
  --    de nuit filtre sur trial_ends_at, donc aucune facture ne suivra,
  --    donc l'accès est gratuit pour toujours et rien ne le signale.
  select 'Contrat incohérent'::text,
         ('L''entreprise « ' || o.name || ' » est en essai SANS date de fin : il ne finira jamais.')::text,
         'Posez trial_ends_at, ou basculez ce contrat en « active ».'::text
    from public.organization_subscriptions s
    join public.business_organizations o on o.id = s.organization_id
   where s.status = 'trialing' and s.trial_ends_at is null

  union all

  -- 3 bis. UN ABONNÉ QU'ON NE PEUT PAS FACTURER. C'est la contrepartie
  --    exacte de la règle « on ne ferme que sur une créance réclamée » :
  --    à qui l'on ne peut pas adresser de facture, on ne peut rien
  --    réclamer, donc on ne peut jamais rien fermer. saas_issue_invoice
  --    refuse une entreprise française sans dénomination, sans SIRET ou
  --    sans adresse — mesuré sur la vraie base : « Le client "OASIS
  --    RARE" n'a pas de SIRET ». Ce client-là a le logiciel gratuitement
  --    et rien ne le signalait.
  --
  --    Le tunnel d'inscription exige ces champs et vérifie la clé de
  --    Luhn, donc le cas ne vient que d'un contrat posé à la main. Il
  --    n'en est que plus discret.
  select 'Abonné non facturable'::text,
         ('L''entreprise « ' || o.name || ' » a un abonnement mais il manque, sur SA fiche : ' || m.manque)::text,
         'Complétez sa fiche société. Sans elle aucune facture ne peut lui être adressée, donc aucune créance réclamée, donc le péage ne se fermera jamais sur elle.'::text
    from public.organization_subscriptions s
    join public.business_organizations o on o.id = s.organization_id
    cross join lateral (
      select string_agg(x.champ, ', ' order by x.champ) as manque
        from (values
               ('dénomination sociale', o.legal_name), ('SIRET', o.siret),
               ('adresse', o.address_line1), ('code postal', o.postal_code), ('ville', o.city)
             ) as x(champ, valeur)
       where nullif(btrim(coalesce(x.valeur, '')), '') is null
    ) m
   where m.manque is not null

  union all

  -- 4. UNE TABLE PÉAGÉE DONT LA SEULE ADRESSE PEUT ÊTRE VIDE ET QUI
  --    N'EXIGE PAS QU'ELLE SOIT REMPLIE. Sans ce garde, on sort du
  --    péage en posant simplement « organization_id = null » — et pire,
  --    on en sort DANS L'ORDRE MÊME qui modifie la ligne. Le § 6 pose
  --    le garde tout seul ; cette branche vérifie qu'il l'a fait.
  select 'Adresse fragile'::text,
         ('La table « ' || p.table_name || ' » n''a qu''une adresse, elle est nullable, et la politique de création n''exige pas qu''elle soit remplie.')::text,
         'Donnez-lui une seconde adresse dans peage_perimetre (cible_espace), ou rejouez 0092 : le § 6 pose le garde « is not null » de lui-même.'::text
    from public.peage_perimetre p
    join pg_attribute a on a.attrelid = ('public.' || quote_ident(p.table_name))::regclass
                       and a.attname = p.cible_organisation
                       and not a.attnotnull
   where p.geste <> 'hors-champ'
     and p.cible_espace is null
     and p.cible_organisation is not null
     and not exists (
       select 1 from pg_policies pol
        where pol.schemaname = 'public'
          and pol.tablename = p.table_name
          and pol.policyname = 'Péage — création'
          and coalesce(pol.with_check, '') like '%IS NOT NULL%')

  order by 1, 2;
$$;

comment on function public.peage_sante() is
  'CE QUI EMPÊCHE LE PÉAGE DE MORDRE, en français. Doit rendre zéro ligne. Depuis que la règle est '
  '« on ne ferme que sur une créance réclamée », le péage dépend de la facturation : identité d''émetteur '
  'vide ou tâche de nuit éteinte, et plus rien ne se ferme jamais. Un péage silencieusement inopérant est '
  'pire que pas de péage, parce qu''on s''en remet à lui.';

revoke all on function public.peage_sante() from public, anon, authenticated, service_role;
grant execute on function public.peage_sante() to service_role;


-- ------------------------------------------------------------
-- 8. LE CHEMIN DU RETOUR — UN PÉAGE SANS SORTIE EST UNE PRISON
-- ------------------------------------------------------------
--
-- CE QUI MANQUAIT. saas_start_subscription() lève 23505 dès qu'une
-- ligne existe pour l'organisation, et la clé primaire de la table
-- (organization_id seul) garantit qu'il y en aura toujours une après la
-- première souscription. Une entreprise résiliée qui repasse à la
-- caisse voit donc son paiement partir, le webhook conclure « cette
-- entreprise a déjà un abonnement : rien à ouvrir », et son accès
-- rester fermé. Le verrou de web-pro/lib/billing/stripe.ts:337-344
-- refuse d'ailleurs le tunnel à toute entreprise portant une ligne
-- « cancelled », avec un commentaire qui l'assume : « CE VERROU DOIT
-- SAUTER le jour où le réabonnement aura son chemin ».
--
-- Sans ce chemin, le péage de ce fichier serait un piège : on ferme, et
-- il n'y a rien derrière. C'est la moitié de la règle qui manquerait.
--
-- CE QUE CETTE FONCTION FAIT, ET NE FAIT PAS.
--   • Elle REPREND une ligne existante ; elle n'en crée jamais. Créer,
--     c'est saas_start_subscription et personne d'autre.
--   • Elle N'OFFRE PAS UN SECOND ESSAI. L'essai est consommé une fois
--     par entreprise. Résilier pour redemander un mois gratuit serait
--     le seul contournement gratuit qui resterait.
--   • Elle FACTURE ET REND LA FACTURE EXIGIBLE LE JOUR MÊME, comme la
--     branche sans essai de saas_start_subscription : la facture
--     précède l'encaissement, sans quoi le rapprochement du webhook ne
--     trouve aucune candidate.
--   • Elle est RÉSERVÉE À LA MACHINE, exactement comme la souscription
--     initiale. Un navigateur envoie une intention, jamais un
--     abonnement.

create or replace function public.saas_reopen_subscription(
  p_organization_id uuid,
  p_plan text,
  p_billing_cycle text,
  p_provider text,
  p_provider_mode text,
  p_provider_customer_id text,
  p_card_registered boolean,
  p_reason text default 'Réabonnement en ligne.',
  p_billing_anchor_day smallint default null,
  p_billable_extra_seats integer default null
)
returns table (
  subscription_status text,
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
  v_avant record;
  v_etat text;
  v_today date := current_date;
  v_anchor smallint;
  v_ps date;
  v_pe date;
  v_months integer;
  v_gen record;
  v_reason text;
  v_seats integer;
  -- Les suites de la facture sont recopiées dans des variables
  -- SCALAIRES dès qu'elles existent. Un `record` resté non affecté
  -- après une exception lève « record is not assigned yet » DÈS QU'ON
  -- LE NOMME, même dans une branche de CASE qui ne sera pas prise :
  -- plpgsql évalue l'expression entière. Le jeu d'essai l'a montré.
  v_facture_refus text;
  v_facture_id uuid;
  v_facture_num text;
  v_facture_issue text;
  v_facture_blocage text;
begin
  if not public.saas_contexte_machine() then
    raise exception 'Accès refusé : le réabonnement se conclut côté serveur, avec la clé de service.'
      using errcode = '42501';
  end if;

  v_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Réabonnement en ligne.');

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
  if v_plan.is_quote_only then
    raise exception 'L''offre « % » se négocie : elle ne se souscrit pas en ligne. Contactez-nous.', v_plan.name
      using errcode = '23514';
  end if;

  select * into v_avant from public.organization_subscriptions s
   where s.organization_id = p_organization_id
   for update;
  if v_avant.organization_id is null then
    raise exception 'Cette entreprise n''a aucun abonnement à reprendre : c''est une première souscription.'
      using errcode = '23503';
  end if;

  -- ON NE REPREND QUE CE QUI EST FERMÉ. Rejouer cette fonction sur un
  -- abonnement en cours redémarrerait sa période et le referait payer.
  -- Changer d'offre en cours de route est un autre geste, et il a sa
  -- propre fonction.
  v_etat := public.peage_etat_organisation(p_organization_id);
  if v_etat not in ('restreint', 'sursis') then
    raise exception 'Cet abonnement est en cours (%) : il n''y a rien à rouvrir.', v_etat
      using errcode = '23505';
  end if;

  if not coalesce(p_card_registered, false) then
    raise exception 'Aucune carte n''est enregistrée : le réabonnement l''exige.' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_provider_customer_id, '')), '') is null then
    raise exception 'Le client n''est pas identifié chez le prestataire de paiement : sans cette référence, aucun prélèvement ne pourrait être rapproché.'
      using errcode = '23514';
  end if;
  if p_provider_mode is null or p_provider_mode not in ('test', 'live') then
    raise exception 'Mode inconnu : %.', coalesce(p_provider_mode, '(vide)') using errcode = '23514';
  end if;
  if not exists (select 1 from public.billing_providers where key = p_provider) then
    raise exception 'Prestataire de paiement inconnu : %.', coalesce(p_provider, '(vide)') using errcode = '23503';
  end if;

  insert into public.billing_provider_customers
    (organization_id, provider, mode, provider_customer_id, note)
  values (p_organization_id, p_provider, p_provider_mode, btrim(p_provider_customer_id),
          'Créé ou confirmé par le réabonnement.')
  on conflict (organization_id, provider, mode) do nothing;

  v_months := case when p_billing_cycle = 'yearly' then 12 else 1 end;

  -- Les sièges : ce que la caisse a facturé fait foi, comme à
  -- l'ouverture. À défaut, l'ancien nombre — pas un recomptage, qui
  -- ferait diverger la facture du montant débité.
  v_seats := greatest(0, coalesce(p_billable_extra_seats, v_avant.billable_extra_seats, 0));

  -- L'ancre : celle de la caisse si elle la donne, sinon l'ancienne,
  -- sinon aujourd'hui. Un client qui revient au 3 du mois retrouve son
  -- 3 du mois.
  v_anchor := coalesce(nullif(p_billing_anchor_day, 0),
                       nullif(v_avant.billing_anchor_day, 0),
                       extract(day from v_today)::smallint);
  if v_anchor < 1 or v_anchor > 31 then
    raise exception 'Jour d''ancrage impossible : %.', v_anchor using errcode = '23514';
  end if;

  v_ps := v_today;
  v_pe := public.saas_date_anniversaire(v_ps, v_months, v_anchor);
  -- La première période ne peut pas être un croupion : même garde
  -- qu'à l'ouverture, pour la même raison de fuseau horaire.
  if v_pe - v_ps < 27 then
    v_pe := public.saas_date_anniversaire(v_ps, v_months + 1, v_anchor);
  end if;

  update public.organization_subscriptions s
     set plan                        = p_plan,
         provider                    = 'web',
         status                      = 'active',
         billing_cycle               = p_billing_cycle,
         billing_anchor_day          = v_anchor,
         current_period_start_on     = v_ps,
         current_period_end_on       = v_pe,
         last_billed_period_start    = v_ps,
         billable_extra_seats        = v_seats,
         payment_method_registered_at = now(),
         -- CETTE SEULE LIGNE EMPÊCHE LE PÉAGE DE REDEVENIR UNE PRISON.
         -- Sans elle, la facture impayée d'AVANT l'interruption restait
         -- comptée : le client payait sa reprise et retrouvait porte
         -- close, pour une créance qui date d'un temps où il ne pouvait
         -- déjà plus travailler. Elle n'efface rien — la créance reste
         -- au dossier et les relances la réclament. Voir le § 0.
         peage_creances_depuis       = v_today,
         external_reference          = btrim(p_provider_customer_id),
         -- LA RÉSILIATION EST LEVÉE. Sans cela l'entreprise
         -- retomberait « restreint » à la lecture suivante, et le
         -- client aurait payé pour rien.
         cancelled_at                = null,
         cancel_at_period_end        = false,
         note                        = v_reason,
         updated_at                  = now()
   where s.organization_id = p_organization_id;

  -- ---- LA FACTURE NE PEUT PAS RETENIR LA PORTE -----------------
  --
  -- La facture précède l'encaissement, comme à l'ouverture : c'est ce
  -- qui permet au webhook de la retrouver quand le prélèvement arrive.
  -- MAIS ELLE NE COMMANDE PAS LA RÉOUVERTURE, et c'est une différence
  -- assumée avec saas_start_subscription.
  --
  -- Mesuré en écrivant ce fichier : saas_generate_invoices refuse
  -- aujourd'hui d'émettre quoi que ce soit, parce que l'identité de
  -- l'ÉMETTEUR — la nôtre — est incomplète (« il manque address_line1,
  -- city, iban, legal_name, siret, vat_number »). Si cette exception
  -- remontait ici, elle annulerait la transaction entière : le client
  -- aurait payé chez Stripe, son abonnement serait resté fermé, et le
  -- motif serait une mention manquante SUR NOTRE PROPRE papier à
  -- en-tête. On ne laisse pas un client dehors pour un champ vide de
  -- notre côté.
  --
  -- Une créance à régulariser coûte une écriture comptable. Un client
  -- qui a payé et reste enfermé coûte le client.
  begin
    select * into v_gen
    from public.saas_generate_invoices(p_billing_cycle, v_ps, v_pe, v_reason, true, p_organization_id);
    v_facture_id      := v_gen.invoice_id;
    v_facture_num     := v_gen.invoice_number;
    v_facture_issue   := v_gen.outcome;
    v_facture_blocage := v_gen.blocking_reason;
  exception when others then
    get stacked diagnostics v_facture_refus = message_text;
    insert into public.saas_machine_events
      (kind, organization_id, target_type, target_id, label, details)
    values ('subscription.reopenedWithoutInvoice', p_organization_id, 'organization',
            p_organization_id, v_org.name,
            jsonb_build_object('motif', v_facture_refus,
                               'periode', jsonb_build_array(v_ps, v_pe),
                               'aFaire', 'L''accès est rouvert et la période court. La facture de cette période reste à émettre à la main.'));
  end;

  insert into public.organization_subscription_events
    (organization_id, event, plan_before, plan_after, status_before, status_after, reason, new_value)
  values (p_organization_id, 'subscription.reopened', v_avant.plan, p_plan,
          v_avant.status, 'active', v_reason,
          jsonb_build_object('periode', jsonb_build_array(v_ps, v_pe),
                             'ancre', v_anchor,
                             'siegesFactures', v_seats,
                             'facture', v_facture_num));

  insert into public.saas_machine_events (kind, organization_id, target_type, target_id, label, details)
  values ('subscription.reopened', p_organization_id, 'organization', p_organization_id, v_org.name,
          jsonb_build_object('etatAvant', v_etat, 'plan', p_plan, 'cycle', p_billing_cycle,
                             'periode', jsonb_build_array(v_ps, v_pe), 'ancre', v_anchor,
                             'siegesFactures', v_seats,
                             'facture', v_facture_num,
                             'issue', coalesce(v_facture_issue, 'refusee'),
                             'secondEssai', false));

  -- Le régime de TVA a pu changer pendant l'interruption.
  perform public.saas_vies_enqueue(p_organization_id);

  -- LE MESSAGE DIT TOUJOURS LA MÊME CHOSE EN PREMIER : vos données sont
  -- là, votre accès est rouvert. Le sort de la facture vient après,
  -- parce que c'est notre affaire, pas la sienne.
  if v_facture_refus is not null then
    return query select
      'active'::text, v_ps, v_pe, null::uuid, null::text,
      ('Votre abonnement est repris et tout ce que vous aviez saisi est en place. '
       || 'Votre facture vous parviendra séparément.')::text;
    return;
  end if;

  return query select
    'active'::text, v_ps, v_pe, v_facture_id, v_facture_num,
    case
      when v_facture_issue = 'issued' then
        ('Votre abonnement est repris. Tout ce que vous aviez saisi est resté en place, et la facture '
         || coalesce(v_facture_num, '') || ' est émise.')
      else
        ('Votre abonnement est repris et vos données sont intactes. La facture n''a pas encore pu être émise : '
         || coalesce(v_facture_blocage, 'motif non enregistré') || ' Nous la régularisons.')
    end::text;
end;
$$;

comment on function public.saas_reopen_subscription(uuid, text, text, text, text, text, boolean, text, smallint, integer) is
  'LE CHEMIN DU RETOUR. Reprend un abonnement fermé (restreint ou en sursis) au lieu de lever 23505 comme '
  'saas_start_subscription. N''offre JAMAIS un second essai — résilier pour redemander un mois gratuit serait '
  'le dernier contournement du péage. Réservée à la machine. Le webhook l''appelle quand l''ouverture rend '
  '« l''entreprise a déjà un abonnement » et que le péage dit que cet abonnement est fermé.';

-- Même piège que plus haut, et il coûterait ici bien plus cher : sans
-- le retrait nominatif, les DEFAULT PRIVILEGES de Supabase laisseraient
-- un client authentifié se rouvrir son propre abonnement. La garde
-- saas_contexte_machine() le refuserait, mais on ne laisse pas une
-- seule barrière tenir toute seule une porte qui donne sur l'argent.
revoke all on function public.saas_reopen_subscription(uuid, text, text, text, text, text, boolean, text, smallint, integer) from public, anon, authenticated, service_role;
grant execute on function public.saas_reopen_subscription(uuid, text, text, text, text, text, boolean, text, smallint, integer) to service_role;


-- ------------------------------------------------------------
-- 9. L'ESSAI GRATUIT SE CONSOMME UNE FOIS, PAR PAYEUR
-- ------------------------------------------------------------
--
-- CE QUI MANQUAIT, ET QUI VIDAIT LE PÉAGE DE SON SENS. Rien ne limite
-- le nombre d'entreprises qu'un même compte peut fonder :
-- create_professional_organization() n'a aucun garde-fou, et
-- saas_start_subscription() ne regarde nulle part si un essai a déjà
-- été consommé. Mesuré, sous l'identité d'un vrai compte dont la
-- première entreprise était fermée : créer une DEUXIÈME entreprise a
-- été ACCEPTÉ, et elle repartait pour un mois gratuit avec la même
-- carte. Autant de fois qu'on veut.
--
-- Le péage ne ralentissait pas ce contournement : il le rendait
-- simplement nécessaire. Un mois gratuit renouvelable indéfiniment
-- n'est pas un essai, c'est la gratuité avec une formalité.
--
-- CE QU'ON COMPTE, ET POURQUOI CE N'EST PAS LA CARTE. On aurait pu
-- compter les cartes bancaires : Stripe crée un client neuf à chaque
-- tunnel, et deux cartes coûtent dix euros. On compte donc LA PERSONNE
-- QUI POSSÈDE L'ENTREPRISE — c'est elle qui signe, c'est elle qui
-- revient, et c'est exactement le geste mesuré. Un dirigeant qui a déjà
-- eu son mois d'essai chez nous ne le redemande pas en fondant une
-- SARL de plus.
--
-- CE QU'ON NE FERME PAS :
--   • On ne refuse pas l'ABONNEMENT, seulement l'ESSAI. La deuxième
--     entreprise peut souscrire — elle paie son premier mois d'entrée,
--     comme la règle du dirigeant le prévoit déjà pour qui renonce à
--     l'essai.
--   • On ne touche pas aux contrats posés à la main. Un administrateur
--     de plateforme qui accorde un essai de courtoisie sait ce qu'il
--     fait ; le garde ne vise que la caisse en libre-service
--     (provider = 'web'), c'est-à-dire le seul chemin qu'un inconnu
--     peut emprunter tout seul.
--
-- POURQUOI UN DÉCLENCHEUR ET PAS UNE RÉÉCRITURE DE
-- saas_start_subscription. Parce que le garde doit tenir quel que soit
-- le chemin — la caisse, une reprise, une main humaine. Un contrôle
-- posé dans une fonction ne garde que cette fonction ; posé sur la
-- table, il garde la table.

create or replace function public.peage_essai_deja_consomme(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.organization_members m_ici
      join public.organization_members m_ailleurs
        on m_ailleurs.user_id = m_ici.user_id
       and m_ailleurs.role = 'owner'
       and m_ailleurs.archived_at is null
       and m_ailleurs.organization_id <> p_organization_id
      join public.organization_subscriptions s
        on s.organization_id = m_ailleurs.organization_id
     where m_ici.organization_id = p_organization_id
       and m_ici.role = 'owner'
       and m_ici.archived_at is null
       -- UN ESSAI COMMENCÉ AILLEURS, quel qu'en soit le sort. On
       -- regarde trial_started_at et non le statut : un essai terminé,
       -- résilié ou transformé en abonnement payant a été consommé
       -- quand même. La colonne existe depuis 0089 et personne ne la
       -- lisait.
       and s.trial_started_at is not null
  );
$$;

comment on function public.peage_essai_deja_consomme(uuid) is
  'Un dirigeant de cette entreprise a-t-il DÉJÀ eu son mois d''essai, dans une autre entreprise ? '
  'Compte la personne qui possède, pas la carte bancaire : Stripe crée un client neuf à chaque tunnel, '
  'et deux cartes coûtent dix euros. Lue par le garde ci-dessous et par l''écran, pour qu''il ne propose '
  'pas un essai qui sera refusé.';

revoke all on function public.peage_essai_deja_consomme(uuid) from public, anon, authenticated, service_role;
grant execute on function public.peage_essai_deja_consomme(uuid) to service_role;


create or replace function public.peage_garde_essai()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ---- 1. UN ESSAI SANS DATE DE FIN NE FINIT JAMAIS ---------------
  --
  -- admin_create_subscription accepte p_status = 'trialing' avec
  -- p_trial_days laissé à NULL — sa valeur par défaut. La ligne naît
  -- alors sans trial_ends_at, et la tâche de nuit qui ramasse les
  -- essais échus filtre justement sur cette colonne : elle ne la verra
  -- jamais. Un administrateur qui accorde « un essai le temps de voir »
  -- crée en réalité un accès gratuit perpétuel, que rien ne signale.
  if new.status = 'trialing' and new.trial_ends_at is null then
    raise exception 'Un essai doit avoir une date de fin, sans quoi il ne se termine jamais et aucune facture ne suit. Posez trial_ends_at (ou p_trial_days), ou créez ce contrat en « active ».'
      using errcode = '23514';
  end if;

  -- ---- 2. L'ESSAI SE CONSOMME UNE FOIS, PAR DIRIGEANT -------------
  --
  -- Seulement la caisse en libre-service : c'est le seul chemin qu'un
  -- inconnu emprunte tout seul, et donc le seul à défendre. Un contrat
  -- posé à la main par un administrateur reste à la main de cet
  -- administrateur.
  if new.status = 'trialing'
     and new.provider = 'web'
     and public.peage_essai_deja_consomme(new.organization_id) then
    raise exception 'Le mois d''essai a déjà été utilisé par le dirigeant de cette entreprise. L''abonnement reste possible : il démarre alors par le premier mois payé.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.peage_garde_essai() is
  'Le garde de l''essai gratuit, posé SUR LA TABLE et non dans une fonction : il doit tenir quel que soit '
  'le chemin — la caisse, une reprise, une main humaine. Refuse un essai sans date de fin (il ne finirait '
  'jamais) et un second essai pour un même dirigeant (mois gratuit renouvelable = gratuité).';

-- MÊME PRÉCAUTION QUE POUR LES AUTRES, et elle est facile à oublier sur
-- une fonction de déclencheur. Les DEFAULT PRIVILEGES de Supabase lui
-- accordaient EXECUTE à anon et authenticated — mesuré. Un déclencheur
-- n'en a aucun besoin : PostgreSQL vérifie ce droit quand on CRÉE le
-- déclencheur, pas quand il se déclenche. Le § 13 du jeu d'essai le
-- prouve en jouant le refus après ce retrait.
revoke all on function public.peage_garde_essai() from public, anon, authenticated, service_role;

drop trigger if exists peage_garde_essai on public.organization_subscriptions;
create trigger peage_garde_essai
  before insert on public.organization_subscriptions
  for each row execute function public.peage_garde_essai();
