-- Oasis Care — LES CONVERSATIONS AVEC L'ASSISTANT.
--
-- À exécuter après 0078. Idempotente : rejouable deux fois de suite
-- sans effet supplémentaire (éprouvée deux fois d'affilée sur la
-- production, en transaction annulée).
--
-- Purement additive : aucune table existante n'est modifiée, aucune
-- politique posée ailleurs n'est touchée, aucune fonction d'un fichier
-- précédent n'est remplacée. Elle AJOUTE en revanche un second
-- déclencheur sur `auth.users` (§ 8), à côté de celui que 0077 y a
-- posé — deux déclencheurs sur le même événement cohabitent sans se
-- gêner, et modifier celui de 0077 aurait demandé de rejouer 0077.
--
-- ============================================================
-- LE PROBLÈME, EN UNE PHRASE
-- ============================================================
--
-- « Demander à Oasis » n'a aucune mémoire, et l'écran a jusqu'ici eu
-- l'honnêteté de ne pas en faire semblant : la réponse suivante écrase
-- la précédente, et `Assistant.tsx` porte en commentaire qu'« afficher
-- une conversation continue laisserait croire à une mémoire » qui
-- n'existe pas. C'était vrai. La fonction Edge reconstruit `input` à
-- chaque requête avec le prompt système et LA question, rien d'autre
-- (`supabase/functions/oasis-pro-ai/index.ts:1396-1399`) : deux
-- questions de suite sont deux inconnus qui se parlent.
--
-- ============================================================
-- CE QUE CETTE MIGRATION POSE, ET CE QU'ELLE REFUSE DE POSER
-- ============================================================
--
-- Elle pose UN FIL et SES MESSAGES, pour que l'utilisateur retrouve ce
-- qu'il a demandé hier. Elle ne pose PAS un décor : la table n'a de
-- sens que si les tours précédents sont RÉELLEMENT renvoyés au modèle
-- à l'intérieur d'un même fil. C'est la raison d'être du § 6
-- (`ai_conversation_tail`) : la queue à rejouer se calcule ICI, au même
-- endroit que le drapeau qui dit qu'elle a été tronquée, pour que
-- l'écran et le modèle ne puissent pas raconter deux histoires
-- différentes.
--
-- LA RÈGLE D'HONNÊTETÉ, écrite une fois pour toutes :
--   • DANS un fil, les tours précédents sont transmis au modèle ;
--   • ENTRE deux fils, rien ne passe. Une « nouvelle conversation »
--     repart de zéro, et l'interface doit le montrer ;
--   • quand la queue est tronquée, l'écran le dit. Un fil
--     silencieusement rogné serait un second mensonge, plus discret
--     que le premier.
--
-- CE QU'ON NE STOCKE PAS, ET C'EST UN CHOIX. Les appels d'outils et
-- leurs résultats ne sont pas conservés comme messages. Deux raisons,
-- et la seconde suffirait :
--   • le volume — huit tours d'outils par question
--     (`MAX_TOOL_ROUNDS = 8`) rempliraient la queue de JSON avant
--     d'avoir rejoué une seule phrase ;
--   • la fraîcheur — rejouer le résultat d'un outil lu il y a une
--     heure, c'est faire raisonner le modèle sur des chiffres périmés
--     en lui laissant croire qu'ils sont d'aujourd'hui. Les données se
--     relisent à chaque tour, elles ne se ressassent pas.
-- Le fil garde donc ce qui a été DIT, pas ce qui a été CONSULTÉ — et
-- le modèle revoit exactement la conversation que l'humain revoit.
-- `tools_used` (§ 2) garde la LISTE des outils, pour que l'écran puisse
-- réafficher « Données consultées », sans leur contenu.
--
-- ============================================================
-- LA QUESTION PRODUIT QUE CETTE MIGRATION NE TRANCHE PAS
-- ============================================================
--
-- Un fil est STRICTEMENT PERSONNEL : son auteur seul le lit, même entre
-- collègues de la même entreprise (§ 7). C'est le réglage le plus
-- fermé, donc le seul qu'on puisse poser sans mandat — l'ouvrir plus
-- tard est une politique à réécrire, le refermer serait une fuite déjà
-- consommée.
--
-- Reste une vraie question, à poser à qui décide : un dirigeant
-- doit-il pouvoir lire les conversations de son équipe ? Les deux
-- réponses se défendent (un fil contient les marges de l'entreprise ;
-- il contient aussi les hésitations d'un salarié). Le jour où elle est
-- tranchée, il n'y a qu'UNE politique à changer, et elle est nommée en
-- toutes lettres au § 7.

-- ============================================================
-- 1. LE FIL
-- ============================================================
--
-- UN FIL APPARTIENT À UN UTILISATEUR **ET** À UNE ENTREPRISE, et les
-- deux clés sont nécessaires. Le même compte peut travailler pour deux
-- entreprises (`organization_members` n'a aucune contrainte d'unicité
-- sur `user_id` seul) : une conversation sur les marges de l'une n'a
-- rien à faire dans la liste de l'autre, et les données qu'elle cite
-- non plus. Un fil sans `organization_id` serait un fil qui suit
-- l'utilisateur d'une entreprise à l'autre en emportant les chiffres
-- de la première.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade`, comme les treize autres tables `ai_*` : une
  -- entreprise supprimée n'a pas de conversations survivantes.
  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,

  -- `on delete cascade`, et surtout PAS `on delete set null`. Le
  -- raisonnement est celui de 0077 (lignes 165-177), et il vaut a
  -- fortiori ici : une ligne de télémétrie qui survit à un compte
  -- supprimé est un manquement ; un fil de conversation qui y survit
  -- est un manquement qui contient des noms de clients et des montants
  -- de devis.
  --
  -- Ce dépôt porte les deux contre-exemples à ne pas recopier :
  -- `ai_usage_events.user_id` et `ai_recommendation_feedback.user_id`
  -- sont en `set null` (relevé sur `pg_constraint`). C'est défendable
  -- là-bas — une statistique de modèle n'est pas une donnée
  -- personnelle une fois l'auteur effacé. Ça ne l'est pas ici : ce
  -- qu'on effacerait, c'est le NOM de l'auteur, pas le contenu qu'il a
  -- écrit.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- DÉRIVÉ DE LA PREMIÈRE QUESTION (§ 3), jamais demandé à
  -- l'utilisateur : un champ « titre » au-dessus d'un champ de saisie
  -- ne serait jamais rempli, et la liste afficherait vingt fois
  -- « Sans titre ».
  --
  -- NULLABLE, parce qu'un fil ouvert et pas encore parlé n'a pas de
  -- titre : il n'a rien pour en fabriquer un. L'écran écrit
  -- « Nouvelle conversation » — ce qui est la vérité — plutôt qu'un
  -- défaut posé en base qui la ferait mentir.
  --
  -- Renommable, en revanche : la dérivation ne s'applique qu'une fois
  -- (§ 3), et un titre corrigé à la main n'est pas réécrit derrière.
  title text
    constraint ai_conversations_titre_borne
    check (title is null or (btrim(title) <> '' and char_length(title) <= 120)),

  -- NULL = ce fil n'a jamais rien porté. C'est différent de « ouvert
  -- à l'instant » : la liste doit pouvoir séparer un fil vide d'un fil
  -- muet depuis trois mois, et un `default now()` rendrait les deux
  -- identiques. Tenu par le déclencheur du § 3.
  last_message_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ai_conversations is
  'Un fil de conversation avec l''assistant. Appartient à UN utilisateur et à UNE entreprise : '
  'le même compte peut travailler pour deux entreprises, et un fil ne traverse pas de l''une à l''autre. '
  'Strictement personnel (RLS § 7). Supprimé par cascade avec le compte auth et avec l''entreprise.';

comment on column public.ai_conversations.title is
  'Dérivé de la première question (ai_conversation_titre), jamais demandé à l''utilisateur. '
  'NULL tant que le fil n''a rien porté : l''écran écrit « Nouvelle conversation ».';

comment on column public.ai_conversations.last_message_at is
  'Dernier message porté par ce fil. NULL = fil ouvert et jamais parlé — ce qui n''est pas la même '
  'chose qu''un fil muet depuis trois mois, et la liste doit pouvoir les séparer.';

-- LA CIBLE DE LA CLÉ ÉTRANGÈRE COMPOSITE DU § 2, et c'est tout son
-- intérêt : en portant les TROIS colonnes, elle fait garantir par la
-- base — et non par une relecture attentive — qu'un message et son fil
-- ont la même entreprise ET le même propriétaire. La famille `ai_*`
-- n'indexait que `(id, organization_id)` ; ici le propriétaire compte
-- autant que l'entreprise, puisque c'est lui que la RLS interroge.
create unique index if not exists ai_conversations_id_org_user_uidx
  on public.ai_conversations (id, organization_id, user_id);

-- La seule requête de l'écran : « mes fils dans cette entreprise, le
-- plus récent d'abord ». `nulls first` met les fils ouverts et pas
-- encore parlés en tête, là où l'utilisateur vient de cliquer.
create index if not exists ai_conversations_liste_idx
  on public.ai_conversations (organization_id, user_id, last_message_at desc nulls first);


-- ============================================================
-- 2. LE MESSAGE
-- ============================================================
--
-- LA RLS EST CLÉE SUR L'ENTREPRISE DE LA LIGNE ELLE-MÊME, jamais sur
-- celle du fil parent. C'est pour ça que `organization_id` et
-- `user_id` sont recopiés ici plutôt que lus par jointure : une
-- politique qui remonte au parent est une politique dont la justesse
-- dépend d'une seconde politique, et ce produit a déjà payé trois fois
-- ce genre de chaîne (0062).
--
-- ET LES DEUX BOUTS SONT TENUS QUAND MÊME, par la clé composite plus
-- bas : recopier une colonne sans vérifier qu'elle correspond au
-- parent, ce serait exactement la faille de 0062 dans l'autre sens.

create table if not exists public.ai_conversation_messages (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.business_organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  conversation_id uuid not null,

  -- DEUX VALEURS, PAS TROIS. Ni 'system' ni 'tool' : le prompt système
  -- appartient au serveur et se réécrit à chaque tour (le figer ici en
  -- ferait une version périmée qu'on rejouerait sans le savoir), et les
  -- outils ne sont pas stockés — voir le préambule.
  role text not null check (role in ('user', 'assistant')),

  content text not null,

  -- QUEL MODÈLE A ÉCRIT CETTE RÉPONSE. NULLABLE et sans défaut :
  -- « on ne sait pas » est une réponse, « gpt-quelque-chose » posé par
  -- défaut n'en est pas une. Le coût, lui, n'est pas ici : il a son
  -- grand livre (`ai_usage_events`), et un chiffre tenu à deux endroits
  -- est un chiffre faux à l'un des deux.
  model text
    constraint ai_conversation_messages_modele_borne
    check (model is null or (btrim(model) <> '' and char_length(model) <= 80)),

  -- LA LISTE DES OUTILS LUS, PAS LEUR CONTENU. De quoi réafficher
  -- « Données consultées : … » en rouvrant le fil.
  --
  -- NULL et '{}' ne disent pas la même chose, et c'est délibéré :
  -- NULL = l'appelant ne l'a pas dit, '{}' = le modèle n'a rien
  -- consulté. Un `default '{}'` écraserait la première phrase avec la
  -- seconde, et l'écran afficherait « aucune donnée consultée » là où
  -- il faut afficher « on ne sait pas ».
  tools_used text[],

  -- ---------- CE QUI EST SORTI DE CE MESSAGE ----------
  --
  -- Sans ces trois colonnes, l'historique raconte les mots et pas les
  -- conséquences : on relit « je peux préparer la facture » sans savoir
  -- si elle est partie.
  --
  -- LES DEUX PREMIÈRES SONT DES CLÉS COMPOSITES, pour la raison de
  -- 0062 : la politique d'écriture demande « as-tu le droit d'écrire
  -- chez toi ? », la réponse est oui puisque l'auteur y met sa propre
  -- entreprise, et rien là-dedans ne regarde l'autre bout de la ligne.
  -- Sans la clé composite, un message écrit chez B pourrait désigner la
  -- décision de A, et l'écran de B afficherait le titre d'une décision
  -- de A.
  --
  -- `on delete set null (colonne)` et non `cascade` : supprimer une
  -- décision ne doit pas trouer la conversation. Un fil amputé d'un
  -- tour est un fil qui ment sur ce que le modèle a vu — et la queue
  -- du § 6 le rejouerait tel quel. La forme à une colonne existe depuis
  -- PostgreSQL 15 ; sans elle, `set null` viderait aussi
  -- `organization_id`, qui est `not null`.
  decision_id uuid,
  action_id uuid,

  -- LA PROPOSITION — `{kind, args}` telle que l'assistant la dépose.
  --
  -- Pas de clé étrangère : il n'existe aucune table de propositions,
  -- et il ne faut pas en inventer une ici. Le catalogue des `kind` vit
  -- dans `web-pro/lib/ai/proposals.ts` (PROPOSAL_KINDS) ; le recopier
  -- en contrainte ferait deux listes qui divergeraient au premier ajout,
  -- et c'est la base qui aurait tort en silence.
  --
  -- CE QUE STOCKER LA PROPOSITION N'AUTORISE PAS : afficher un texte
  -- écrit par le modèle à la place d'un texte écrit par nous. Le résumé
  -- français que l'utilisateur lit avant de cliquer est composé en
  -- TypeScript à partir de paramètres typés (proposals.ts) ; ce jsonb
  -- est une entrée de RPC, pas une phrase d'interface.
  proposal jsonb,

  -- 'pending' tant que le bouton n'a pas été touché. La colonne avance
  -- dans un seul sens (§ 5) : une proposition exécutée ne redevient pas
  -- en attente, sinon l'historique se réécrit après coup.
  proposal_status text check (proposal_status in ('pending', 'executed', 'declined')),

  -- ---------- CE QUE LA RÉPONSE PORTAIT EN PLUS DE SA PROSE ----------
  --
  -- `content` reste LE TEXTE, et c'est lui — lui seul — que la queue du
  -- § 6 renvoie au modèle. `payload` porte la couche STRICTEMENT
  -- SUPPLÉMENTAIRE, celle qui s'affiche et que le modèle n'a pas besoin
  -- de se rappeler :
  --
  --   { "analyse":       { "confiance": "...", "ambigu": false,
  --                        "raisons": [ { "titre": "...",
  --                                       "raisons": ["..."] } ] },
  --     "avertissements": ["Analyse partielle : le droit … manque."],
  --     "actions":        [ { "actionId": "...", "approvalId": "...",
  --                           "libelle": "...", "resume": "...",
  --                           "montantCents": 123400 } ] }
  --
  -- ─── POURQUOI CETTE FRONTIÈRE-LÀ, ET PAS UNE AUTRE ───
  --
  -- Parce que l'écran et le modèle ne doivent pas diverger sur la
  -- SUBSTANCE. Ce que le lecteur prend pour la réponse — le résumé, les
  -- recommandations chiffrées, l'action recommandée, ce qui manque pour
  -- conclure — est composé HORS MODÈLE et écrit dans `content` : donc
  -- affiché tel quel, et rejoué tel quel. Ce qui reste ici est d'une
  -- autre nature : les RAISONS (repliées derrière « Pourquoi ? », que le
  -- modèle recalcule), la CONFIANCE (un badge), les AVERTISSEMENTS DU
  -- RUNTIME (un repli de modèle, un droit manquant, un montant retiré —
  -- ils parlent de la machine, pas de l'entreprise) et les ACTIONS
  -- préparées (des boutons, dont l'état vit dans `ai_action_approvals`).
  --
  -- ─── PAS DE COLONNES DÉDIÉES, ET C'EST UN CHOIX ───
  --
  -- Rien ici ne se filtre, ne se trie ni ne s'agrège en SQL : c'est un
  -- rendu, relu par un seul écran. Quatre colonnes typées auraient
  -- ajouté quatre contraintes, quatre défauts et quatre migrations le
  -- jour où la sortie des agents change de forme — pour zéro requête
  -- gagnée. La forme est vérifiée du côté où elle est vraie
  -- (`lib/ai/conversations/types.ts`, comme pour `proposal`).
  --
  -- BORNÉ QUAND MÊME. Un jsonb libre est une invitation à stocker la
  -- réponse entière deux fois ; 40 000 caractères laissent large et
  -- interdisent le mégaoctet.
  payload jsonb
    constraint ai_conversation_messages_payload_borne
    check (payload is null
           or (jsonb_typeof(payload) = 'object'
               and char_length(payload::text) <= 40000)),

  -- Posé par le déclencheur du § 4 sur l'horloge du serveur, jamais par
  -- l'appelant : c'est cette date qui ordonne la queue rejouée au
  -- modèle et qui décide de la rétention (§ 8). Une date fournie par le
  -- client permettrait de réordonner une conversation après coup, et de
  -- la soustraire indéfiniment à la purge.
  created_at timestamptz not null default now(),

  -- ---------- LES BORNES ----------
  --
  -- LA TAILLE D'UN MESSAGE, et deux plafonds parce qu'il y a deux
  -- natures de messages.
  --
  --   • Une QUESTION : 2 000 caractères. Ce n'est pas un chiffre
  --     inventé, c'est celui que les deux surfaces refusent déjà
  --     (`MAX_QUESTION_LENGTH = 2000`, oasis-pro-ai/index.ts:216 ;
  --     `LONGUEUR_QUESTION_MAX = 2_000`, demander/route.ts:63). La base
  --     ne doit pas pouvoir contenir ce que les portes refusent : sinon
  --     la borne n'est plus une règle du produit, seulement une
  --     habitude de deux fichiers.
  --
  --   • Une RÉPONSE : 20 000 caractères, soit environ 5 000 jetons.
  --     Généreux exprès — une réponse refusée serait une réponse perdue,
  --     déjà payée au fournisseur. Mais borné, parce qu'un modèle qui
  --     déraille écrit un mégaoctet et qu'une seule ligne suffirait
  --     alors à rendre le fil illisible et la queue incalculable.
  --
  -- Le plancher compte autant : un message vide n'est pas une donnée,
  -- et `btrim` parce qu'un message fait de trois espaces est vide
  -- aussi.
  constraint ai_conversation_messages_contenu_borne check (
    btrim(content) <> ''
    and char_length(content) <= case when role = 'user' then 2000 else 20000 end
  ),

  -- Quarante outils par réponse : la fonction Edge en expose une
  -- vingtaine, huit tours d'outils au plus. Au-delà, ce n'est plus une
  -- liste à afficher.
  constraint ai_conversation_messages_outils_borne check (
    tools_used is null
    or (coalesce(array_length(tools_used, 1), 0) <= 40
        and coalesce(char_length(array_to_string(tools_used, ',')), 0) <= 1000)
  ),

  -- UNE PROPOSITION ET SON STATUT VONT ENSEMBLE, et ne sortent que
  -- d'une réponse. Une proposition sans statut serait un bouton dont on
  -- ne sait pas s'il a été cliqué ; un statut sans proposition serait
  -- un clic sans bouton.
  constraint ai_conversation_messages_proposition_coherente check (
    (proposal is null and proposal_status is null)
    or (proposal is not null and proposal_status is not null and role = 'assistant')
  ),

  -- UNE QUESTION EST NUE. Elle vient de l'humain : elle n'a ni modèle,
  -- ni outils, ni conséquence. Le motif est celui de
  -- `mobile_app_installations_coherence` (0077) : une ligne à moitié
  -- remplie d'attributs qui n'ont pas de sens pour elle pollue toutes
  -- les statistiques qu'on en tirera.
  constraint ai_conversation_messages_question_nue check (
    role <> 'user'
    or (model is null and tools_used is null and decision_id is null
        and action_id is null and proposal is null and payload is null)
  ),

  -- LE MESSAGE ET SON FIL : MÊME ENTREPRISE, MÊME PROPRIÉTAIRE.
  -- Garanti par la base, pas par le code appelant. C'est ce qui permet
  -- à la RLS du § 7 de ne regarder que les colonnes de la ligne.
  constraint ai_conversation_messages_meme_fil
    foreign key (conversation_id, organization_id, user_id)
    references public.ai_conversations (id, organization_id, user_id)
    on delete cascade,

  constraint ai_conversation_messages_decision_meme_org
    foreign key (decision_id, organization_id)
    references public.ai_decisions (id, organization_id)
    on delete set null (decision_id),

  constraint ai_conversation_messages_action_meme_org
    foreign key (action_id, organization_id)
    references public.ai_actions (id, organization_id)
    on delete set null (action_id)
);

comment on table public.ai_conversation_messages is
  'Un tour de conversation : une question ou une réponse. Porte son organisation ET son propriétaire, '
  'que la clé composite vers ai_conversations garantit identiques à ceux du fil. '
  'Les appels d''outils ne sont pas stockés : voir le préambule de 0079.';

comment on column public.ai_conversation_messages.tools_used is
  'La LISTE des outils lus, pas leur contenu. NULL = l''appelant ne l''a pas dit ; '
  '{} = le modèle n''a rien consulté. Les deux phrases sont différentes.';

comment on column public.ai_conversation_messages.proposal is
  'La proposition déposée par l''assistant, {kind, args}. Entrée de RPC, jamais phrase d''interface : '
  'le résumé lu par l''humain est composé en TypeScript (proposals.ts), pas par le modèle.';

comment on column public.ai_conversation_messages.payload is
  'La couche affichée EN PLUS de la prose : raisons repliées, confiance, avertissements du runtime, '
  'actions préparées. La SUBSTANCE reste dans content, parce que content est ce que le modèle relit : '
  'l''écran et le modèle ne doivent pas diverger sur ce qui a été répondu.';

comment on column public.ai_conversation_messages.created_at is
  'Posé par le serveur (§ 4), jamais par l''appelant : cette date ordonne la queue rejouée au modèle '
  'et décide de la rétention. Une date fournie par le client permettrait d''échapper aux deux.';

-- LA REQUÊTE DU FIL, et la seule qui compte : « les messages de ce fil,
-- dans l'ordre ». Elle sert l'affichage comme la queue rejouée.
create index if not exists ai_conversation_messages_fil_idx
  on public.ai_conversation_messages (conversation_id, created_at, id);

-- « Quels messages ont produit cette décision ? » — le chemin inverse,
-- celui que le centre de décision empruntera pour dire d'où vient une
-- recommandation. Partiel : la très grande majorité des messages n'a
-- aucune conséquence attachée.
create index if not exists ai_conversation_messages_decision_idx
  on public.ai_conversation_messages (decision_id)
  where decision_id is not null;

create index if not exists ai_conversation_messages_action_idx
  on public.ai_conversation_messages (action_id)
  where action_id is not null;


-- ============================================================
-- 3. LE TITRE, DÉRIVÉ DE LA PREMIÈRE QUESTION
-- ============================================================
--
-- POURQUOI EN BASE ET PAS DANS L'ÉCRAN. Parce que l'écran n'est pas le
-- seul appelant : la fonction Edge, un script de reprise, un futur
-- client mobile écrivent le même message. Une dérivation qui ne vit que
-- dans un composant React donne des fils sans titre dès qu'une seconde
-- porte s'ouvre — et personne ne s'en aperçoit avant de voir la liste.
--
-- `ai_clean_text` d'abord (0069) : elle remplace les caractères de
-- contrôle par des espaces, ce qui est exactement ce qu'on veut d'un
-- titre — une ligne, pas un paragraphe.

create or replace function public.ai_conversation_titre(p_texte text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_texte text := public.ai_clean_text(p_texte, 4000);
  v_coupe text;
begin
  if v_texte is null then
    return null;
  end if;

  if char_length(v_texte) <= 60 then
    return v_texte;
  end if;

  -- On coupe au dernier mot entier plutôt qu'au 60ᵉ caractère : « Peux-tu
  -- me préparer la facture du chantier Duran » se lit, « …chantier Dur »
  -- ressemble à une donnée corrompue.
  v_coupe := btrim(regexp_replace(left(v_texte, 60), '\s+\S*$', ''));

  -- Sauf si le premier mot est plus long que la moitié du titre : un
  -- identifiant de trente caractères ne doit pas réduire le titre à
  -- rien. Dans ce cas on coupe net.
  if v_coupe is null or char_length(v_coupe) < 20 then
    v_coupe := btrim(left(v_texte, 60));
  end if;

  return v_coupe || '…';
end;
$$;

comment on function public.ai_conversation_titre(text) is
  'Fabrique le titre d''un fil à partir de sa première question : une ligne, 60 caractères, '
  'coupée au dernier mot entier. En base et non dans l''écran, parce que l''écran n''est pas le seul '
  'appelant — un fil sans titre est un fil qu''on ne retrouve pas.';


-- ------------------------------------------------------------
-- 3.b CE QUE CHAQUE MESSAGE FAIT AU FIL
-- ------------------------------------------------------------
--
-- Trois choses, et une seule écriture : le titre s'il manque, la date
-- de dernière activité, et l'horodatage de modification.
--
-- `coalesce(c.title, …)` : la dérivation ne s'applique qu'UNE fois. Un
-- titre corrigé à la main n'est pas réécrit par le message suivant, et
-- une réponse d'assistant ne titre jamais un fil — le titre vient de ce
-- que l'humain a demandé, pas de ce que la machine a répondu.
--
-- `greatest(...)` sur la date : une insertion hors d'ordre (reprise,
-- script) ne doit pas faire RECULER la dernière activité du fil.
--
-- `security invoker` et vérification du nombre de lignes touchées : si
-- la RLS masquait le fil, l'`update` ne toucherait aucune ligne et ne
-- lèverait rien — le compteur se désynchroniserait en silence. On
-- préfère l'échec bruyant. En pratique le cas est impossible : la clé
-- composite garantit que le fil appartient à l'auteur du message.
create or replace function public.ai_conversation_apres_message()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_touchees int;
begin
  update public.ai_conversations c
     set title = coalesce(
                   c.title,
                   case when new.role = 'user'
                        then public.ai_conversation_titre(new.content) end),
         last_message_at = greatest(coalesce(c.last_message_at, new.created_at), new.created_at),
         updated_at = clock_timestamp()
   where c.id = new.conversation_id;

  get diagnostics v_touchees = row_count;

  if v_touchees <> 1 then
    raise exception 'Le fil % n''a pas été mis à jour (% ligne(s) touchée(s)) : un message sans fil visible est un message perdu.',
      new.conversation_id, v_touchees;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_ai_conversation_apres_message on public.ai_conversation_messages;
create trigger trg_ai_conversation_apres_message
  after insert on public.ai_conversation_messages
  for each row execute function public.ai_conversation_apres_message();


-- ============================================================
-- 4. LES BORNES DU FIL, ET LA DATE QUI NE SE FALSIFIE PAS
-- ============================================================
--
-- POURQUOI UN FIL EST BORNÉ EN NOMBRE DE MESSAGES. Parce qu'on renvoie
-- l'historique au modèle : un fil sans limite coûte de plus en plus
-- cher à chaque question, et le seul garde-fou existant sur le chemin
-- réellement utilisé est un COMPTEUR DE QUESTIONS
-- (`AI_REQUESTS_PER_MONTH = 500`), aveugle à la taille de ce qu'on
-- envoie. Dix tours rejoués multiplient les jetons d'entrée par dix et
-- comptent toujours pour une question.
--
-- La queue rejouée est bornée séparément (§ 6) et beaucoup plus bas :
-- ces 200 messages ne partent jamais tous au modèle. La borne d'ici
-- sert à autre chose — dire à quel moment un fil cesse d'être une
-- conversation pour devenir un dossier. Au-delà, on n'ampute pas : on
-- refuse, avec une phrase qui dit quoi faire. Amputer par le haut
-- ferait disparaître le début d'une conversation sans que personne le
-- remarque, ce qui est exactement le mensonge qu'on cherche à éviter.
create or replace function public.ai_conversation_messages_max()
returns int
language sql
immutable
as $$ select 200 $$;

comment on function public.ai_conversation_messages_max() is
  'Le nombre de messages qu''un fil accepte. Au-delà, on refuse — on n''ampute pas : '
  'un fil rogné par le haut est un fil qui ment sur ce qu''il contient.';

create or replace function public.ai_conversation_message_borne()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_nb int;
  v_max int := public.ai_conversation_messages_max();
begin
  -- L'HORODATAGE EST CELUI DU SERVEUR, toujours. `clock_timestamp()` et
  -- non `now()` : `now()` est figé à l'ouverture de la transaction, si
  -- bien qu'une question et sa réponse écrites dans la même transaction
  -- porteraient la même date à la microseconde près — et l'ordre du fil
  -- dépendrait alors de l'`id`, c'est-à-dire du hasard. Même
  -- raisonnement qu'en 0078 pour la signature d'une note.
  new.created_at := clock_timestamp();

  -- `security invoker` : ce compte est fait sous la RLS de l'appelant,
  -- et c'est volontaire. La clé composite garantit que le fil visé lui
  -- appartient, donc tous ses messages lui sont visibles et le compte
  -- est exact. Une fonction `definer` compterait la même chose en
  -- retirant un garde-fou.
  select count(*) into v_nb
    from public.ai_conversation_messages m
   where m.conversation_id = new.conversation_id;

  if v_nb >= v_max then
    raise exception 'Cette conversation a atteint sa limite de % messages. Ouvrez-en une nouvelle : elle repartira de zéro, et c''est exactement ce que le modèle verra.',
      v_max;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ai_conversation_message_borne on public.ai_conversation_messages;
create trigger trg_ai_conversation_message_borne
  before insert on public.ai_conversation_messages
  for each row execute function public.ai_conversation_message_borne();


-- ============================================================
-- 5. CE QUI EST DIT EST DIT
-- ============================================================
--
-- UN MESSAGE NE SE RÉÉCRIT PAS. La raison n'est pas la traçabilité en
-- général, c'est celle-ci : la queue du § 6 renvoie ces lignes au
-- modèle en affirmant que ce sont les tours précédents. Si une réponse
-- pouvait être corrigée après coup, l'écran montrerait une conversation
-- que le modèle n'a jamais eue — le mensonge, à nouveau, mais par le
-- milieu.
--
-- ON LÈVE UNE EXCEPTION plutôt que de recopier silencieusement
-- l'ancienne valeur (le motif de 0078 pour `created_by`). Ici la
-- différence compte : un appelant qui croit corriger un message doit
-- l'apprendre. Un `update` sans effet lui laisserait croire qu'il a
-- corrigé.
--
-- CE QUI PEUT ENCORE BOUGER, et rien d'autre :
--   • `decision_id` et `action_id` — de NULL vers une valeur. Une
--     conséquence s'ATTACHE après coup (le bouton est cliqué plus tard),
--     elle ne se remplace pas : réattribuer un message à une autre
--     décision réécrirait l'histoire d'une entreprise.
--   • `proposal_status` — de 'pending' vers 'executed' ou 'declined',
--     dans ce sens et une seule fois.
--
-- ─── ET L'EFFACEMENT D'UNE CONSÉQUENCE, QUI EST LE CONTRAIRE D'UNE RÉÉCRITURE ───
--
-- La première version de ce déclencheur refusait TOUT changement de
-- `decision_id` dès qu'il valait quelque chose — y compris le passage
-- vers NULL. Elle rendait donc impossible le `on delete set null` que
-- la table déclare deux cents lignes plus haut : PostgreSQL applique
-- cette clause par un UPDATE sur le message, l'UPDATE réveillait ce
-- déclencheur, et c'est la SUPPRESSION DE LA DÉCISION qui échouait.
-- Éprouvé sur la production, en transaction annulée : « supprimer une
-- décision citée par un message » levait « Une conséquence s'attache
-- une fois ». Deux paragraphes de commentaire décrivaient un
-- comportement que la base rendait impossible, et l'échec tombait du
-- mauvais côté — dans un fichier dont tout le § 8 dit que la
-- suppression doit l'emporter.
--
-- On n'interdit donc plus que le REMPLACEMENT : valeur → autre valeur.
-- Valeur → NULL n'est pas réécrire l'histoire, c'est enregistrer que
-- la décision n'existe plus, et seule la clé étrangère peut le faire.
create or replace function public.ai_conversation_message_fige()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.content is distinct from old.content
     or new.created_at is distinct from old.created_at
     or new.model is distinct from old.model
     or new.tools_used is distinct from old.tools_used
     or new.proposal is distinct from old.proposal
     or new.payload is distinct from old.payload then
    raise exception 'Un message de conversation ne se réécrit pas : c''est lui qu''on renvoie au modèle comme étant le tour précédent.';
  end if;

  -- `new.… is not null` dans les deux tests : c'est ce qui laisse
  -- passer valeur → NULL, donc le `on delete set null` de la clé
  -- étrangère, tout en refusant valeur → autre valeur.
  if old.decision_id is not null and new.decision_id is not null
     and new.decision_id is distinct from old.decision_id then
    raise exception 'Une conséquence s''attache une fois : ce message est déjà rattaché à la décision %.', old.decision_id;
  end if;

  if old.action_id is not null and new.action_id is not null
     and new.action_id is distinct from old.action_id then
    raise exception 'Une conséquence s''attache une fois : ce message est déjà rattaché à l''action %.', old.action_id;
  end if;

  if new.proposal_status is distinct from old.proposal_status
     and not (old.proposal_status = 'pending'
              and new.proposal_status in ('executed', 'declined')) then
    raise exception 'Le statut d''une proposition avance de « pending » vers « executed » ou « declined », et pas dans l''autre sens.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ai_conversation_message_fige on public.ai_conversation_messages;
create trigger trg_ai_conversation_message_fige
  before update on public.ai_conversation_messages
  for each row execute function public.ai_conversation_message_fige();

-- Le fil, lui, se renomme — mais ne change ni d'entreprise, ni de
-- propriétaire, ni de date de naissance. Un fil qui pourrait changer
-- d'entreprise emporterait ses messages avec lui, clé composite
-- comprise : c'est un déménagement de données d'une société à une
-- autre, et il ne doit pas exister de bouton pour ça.
--
-- `last_message_at` n'est PAS gelée, et c'est un choix proportionné :
-- la fausser ne dérange que sa propre liste — le fil est personnel — et
-- la rétention du § 8 ne la lit pas, justement pour cette raison.
create or replace function public.ai_conversation_fige()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Un fil ne change ni d''entreprise, ni de propriétaire : ses messages le suivraient.';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_ai_conversation_fige on public.ai_conversations;
create trigger trg_ai_conversation_fige
  before update on public.ai_conversations
  for each row execute function public.ai_conversation_fige();


-- ============================================================
-- 6. LA QUEUE REJOUÉE — la seule chose que le modèle reverra
-- ============================================================
--
-- POURQUOI CETTE FONCTION EXISTE. Parce que deux affirmations doivent
-- venir du même calcul : « voici ce que le modèle a vu » et « le fil a
-- été tronqué ». Si l'écran calcule la première et le serveur la
-- seconde, ils divergeront un jour, et le jour où ils divergeront
-- personne ne le saura.
--
-- DEUX BORNES SIMULTANÉES, LA PLUS STRICTE GAGNE.
--
--   • UN NOMBRE DE MESSAGES (16 par défaut, soit huit échanges) — à
--     comparer aux huit tours d'outils déjà autorisés pour une seule
--     question. Au-delà, ce n'est plus un contexte de conversation,
--     c'est une archive.
--
--   • UN BUDGET DE CARACTÈRES (6 000 par défaut). Ce chiffre n'est pas
--     rond par hasard : `SEUIL_CONTEXTE_STANDARD_CARACTERES = 12 000`
--     (model/router.ts) est le seuil à partir duquel le routeur fait
--     monter l'agent d'un cran de modèle — donc de prix. Un historique
--     non borné ferait DEUX dégâts d'un coup : gonfler la facture, et
--     faire basculer silencieusement vers un modèle plus cher. On reste
--     franchement en dessous, pour que la conversation ne décide jamais
--     du modèle à elle seule.
--
-- LES PARAMÈTRES SONT BORNÉS EUX AUSSI. Un appelant qui demanderait
-- 200 messages et 100 000 caractères annulerait tout ce paragraphe :
-- ce n'est pas un réglage qu'on laisse au code appelant. Le plafond dur
-- est à 12 000 caractères — le seuil du routeur — parce qu'au-delà
-- l'historique seul déciderait du modèle.
--
-- CE QU'ELLE RETOURNE, ET POURQUOI DANS CET ORDRE : `messages` est
-- prêt à être passé au SDK (`Session.getItems()` rend exactement cette
-- forme) ; `tronque`, `messages_omis` et `caracteres` sont ce que
-- l'écran doit dire à l'utilisateur. Les trois sortent du même parcours.
--
-- `security invoker` : la RLS du § 7 s'applique. Un fil qui n'est pas
-- le vôtre rend une queue vide, pas une erreur — et pas un contenu.
create or replace function public.ai_conversation_tail(
  p_conversation_id uuid,
  p_messages_max int default 16,
  p_caracteres_max int default 6000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_nb_max int := least(greatest(coalesce(p_messages_max, 16), 2), 40);
  v_car_max int := least(greatest(coalesce(p_caracteres_max, 6000), 500), 12000);
  v_total int := 0;
  v_pris int := 0;
  v_car int := 0;
  v_ligne record;
  v_queue jsonb := '[]'::jsonb;
begin
  select count(*) into v_total
    from public.ai_conversation_messages m
   where m.conversation_id = p_conversation_id;

  for v_ligne in
    select m.id, m.role, m.content, m.created_at
      from public.ai_conversation_messages m
     where m.conversation_id = p_conversation_id
     order by m.created_at desc, m.id desc
  loop
    -- Le message le plus récent entre TOUJOURS, même s'il dépasse à lui
    -- seul le budget : rendre une queue vide alors que le fil parle
    -- serait pire que la dépasser d'une fois.
    exit when v_pris >= v_nb_max;
    exit when v_pris > 0 and v_car + char_length(v_ligne.content) > v_car_max;

    v_queue := jsonb_build_array(jsonb_build_object(
                 'id', v_ligne.id,
                 'role', v_ligne.role,
                 'content', v_ligne.content,
                 'created_at', v_ligne.created_at
               )) || v_queue;
    v_pris := v_pris + 1;
    v_car := v_car + char_length(v_ligne.content);
  end loop;

  -- UNE QUEUE NE COMMENCE PAS PAR UNE RÉPONSE. Couper juste après une
  -- question laisserait le modèle relire sa propre réponse sans la
  -- question qui l'a provoquée — il en déduirait une consigne là où il
  -- n'y a qu'un écho. On retire ce premier orphelin et on le compte
  -- comme omis.
  if v_pris > 1 and (v_queue -> 0 ->> 'role') = 'assistant' then
    v_car := v_car - char_length(v_queue -> 0 ->> 'content');
    v_queue := v_queue - 0;
    v_pris := v_pris - 1;
  end if;

  return jsonb_build_object(
    'messages', v_queue,
    'messages_total', v_total,
    'messages_rejoues', v_pris,
    'messages_omis', v_total - v_pris,
    'caracteres', v_car,
    -- LE DRAPEAU QUE L'ÉCRAN DOIT AFFICHER. Il ne se déduit pas d'un
    -- comptage fait ailleurs : il sort du parcours qui a fabriqué la
    -- queue, donc il ne peut pas être en désaccord avec elle.
    'tronque', (v_total - v_pris) > 0
  );
end;
$$;

comment on function public.ai_conversation_tail(uuid, int, int) is
  'La queue de conversation réellement renvoyée au modèle, bornée par un nombre de messages ET un '
  'budget de caractères (la borne la plus stricte gagne), plus le drapeau « tronque » que l''écran '
  'doit afficher. Les deux sortent du même parcours : c''est la raison d''être de cette fonction.';


-- ============================================================
-- 7. RLS — un fil est personnel, et l'entreprise reste la clé
-- ============================================================
--
-- DEUX CONDITIONS, ET AUCUNE DES DEUX N'EST DE TROP :
--
--   • `user_id = auth.uid()` — une conversation avec l'assistant est
--     personnelle, même entre collègues. C'est le réglage le plus
--     fermé, donc le seul qu'on puisse poser sans mandat produit.
--     LA POLITIQUE À CHANGER LE JOUR OÙ QUELQU'UN TRANCHE AUTREMENT
--     EST CELLE-CI, et il n'y en a pas d'autre.
--
--   • `has_permission(organization_id, 'projects.read')` — le régime
--     opérationnel de la famille `ai_*` (0076 § 7). Un fil contient des
--     noms de clients, des montants de devis et des marges : il ne doit
--     pas être plus ouvert que ce qu'il cite. Et la condition porte sur
--     `organization_id`, la colonne de LA LIGNE — jamais sur celle d'un
--     parent. Les deux tables la portent, c'est pour ça.
--
-- POURQUOI UNE POLITIQUE `for all` ET NON QUATRE. Parce que lire et
-- écrire obéissent ici à la même phrase, et que quatre copies de la
-- même phrase, c'est trois occasions de n'en corriger que deux.
--
-- ET IL N'Y A PAS DE POLITIQUE DE SUPPRESSION PLUS LARGE, parce
-- qu'elle ne servirait à rien. C'est le piège de ce fichier, mesuré en
-- transaction annulée avant d'écrire ces lignes : une politique
-- « for delete using (user_id = auth.uid()) » censée laisser chacun
-- effacer ses conversations même après avoir perdu `projects.read`
-- N'EFFACE RIEN. PostgreSQL exige, pour un `delete` dont le `where`
-- désigne une colonne — c'est-à-dire tout `delete` réel —, que la ligne
-- soit AUSSI visible par les politiques de `select`. Une politique de
-- suppression ne peut donc jamais être plus permissive que la lecture.
-- Éprouvé sur une table jetable : avec « for delete using (true) » et
-- une lecture fermée, la ligne survit, et sans la moindre erreur.
--
-- Le droit d'effacement ne peut pas pour autant dépendre d'un réglage
-- de droits : un salarié à qui l'on retire `projects.read` garderait
-- sinon en base des conversations qu'il ne peut plus ni lire ni
-- supprimer — de la donnée personnelle prisonnière d'une permission
-- métier. Il passe donc par une fonction, § 7.b.
--
-- ET LES MESSAGES NE SE SUPPRIMENT PAS UN PAR UN : aucune politique de
-- `delete`, et le droit `delete` retiré au rôle `authenticated`. Un fil
-- troué en son milieu se rejouerait au modèle comme s'il était complet.
-- On supprime une CONVERSATION ; la cascade emporte ses messages, et
-- une cascade de clé étrangère ne passe pas par la RLS.

alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_messages enable row level security;

drop policy if exists "Chacun ne voit et n'écrit que ses propres conversations"
  on public.ai_conversations;
create policy "Chacun ne voit et n'écrit que ses propres conversations"
  on public.ai_conversations
  for all
  using (user_id = auth.uid() and public.has_permission(organization_id, 'projects.read'))
  with check (user_id = auth.uid() and public.has_permission(organization_id, 'projects.read'));

-- Posée par une première version de ce fichier, et retirée pour la
-- raison expliquée juste au-dessus : elle promettait un effacement
-- qu'elle ne pouvait pas tenir. Le `drop` reste, sinon une base où
-- cette version a tourné la garderait pour toujours.
drop policy if exists "Chacun peut toujours effacer ses propres conversations"
  on public.ai_conversations;

drop policy if exists "Chacun ne lit que les messages de ses fils"
  on public.ai_conversation_messages;
create policy "Chacun ne lit que les messages de ses fils"
  on public.ai_conversation_messages
  for select
  using (user_id = auth.uid() and public.has_permission(organization_id, 'projects.read'));

drop policy if exists "Chacun n'écrit que dans ses propres fils"
  on public.ai_conversation_messages;
create policy "Chacun n'écrit que dans ses propres fils"
  on public.ai_conversation_messages
  for insert
  with check (user_id = auth.uid() and public.has_permission(organization_id, 'projects.read'));

-- L'`update` n'est ouvert que pour ATTACHER une conséquence : le
-- déclencheur du § 5 refuse tout le reste. Sans cette politique, le
-- bouton « exécuter » cliqué dix minutes après la réponse n'aurait
-- nulle part où écrire ce qu'il a fait.
drop policy if exists "Chacun rattache une conséquence à ses propres messages"
  on public.ai_conversation_messages;
create policy "Chacun rattache une conséquence à ses propres messages"
  on public.ai_conversation_messages
  for update
  using (user_id = auth.uid() and public.has_permission(organization_id, 'projects.read'))
  with check (user_id = auth.uid() and public.has_permission(organization_id, 'projects.read'));

-- LES DROITS, qui ne font pas double emploi avec la RLS. Supabase
-- accorde tout à `authenticated` sur les tables de `public` (vérifié
-- sur `information_schema.role_table_grants`) : sans ce `revoke`, le
-- droit `delete` existerait sur les messages, et il ne manquerait plus
-- qu'une politique distraite pour qu'il serve. La RLS dit QUI touche la
-- ligne ; le droit dit CE QU'ON PEUT en faire. Le motif est celui de
-- 0077 § 2.b.
revoke all on public.ai_conversations from public, anon;
revoke all on public.ai_conversations from authenticated;
grant select, insert, update, delete on public.ai_conversations to authenticated;

revoke all on public.ai_conversation_messages from public, anon;
revoke all on public.ai_conversation_messages from authenticated;
grant select, insert, update on public.ai_conversation_messages to authenticated;

-- `ai_conversation_tail` est `security invoker` : elle ne peut rien
-- rendre que l'appelant ne pourrait lire lui-même. On la ferme quand
-- même à `anon`, qui n'a pas d'`auth.uid()` et dont la queue serait
-- toujours vide — une barrière qui ne coûte rien, et qui reste le jour
-- où quelqu'un déplace un garde-fou.
revoke execute on function public.ai_conversation_tail(uuid, int, int) from public, anon;
grant execute on function public.ai_conversation_tail(uuid, int, int) to authenticated;

revoke execute on function public.ai_conversation_titre(text) from public, anon;
grant execute on function public.ai_conversation_titre(text) to authenticated;


-- ------------------------------------------------------------
-- 7.b EFFACER LES SIENNES, TOUJOURS
-- ------------------------------------------------------------
--
-- La seule porte de sortie du piège décrit au § 7 : une politique de
-- suppression ne peut pas être plus permissive que la lecture, et la
-- lecture est — à juste titre — fermée à qui n'appartient plus à
-- l'entreprise. Or celui-là aussi doit pouvoir effacer ce qu'il a
-- écrit ; c'est même lui, en premier.
--
-- `security definer`, donc hors RLS, et une seule condition :
-- `user_id = auth.uid()`. La fonction ne rend AUCUN contenu — juste
-- vrai ou faux — et ne peut donc pas servir à savoir si le fil d'un
-- collègue existe : un identifiant inconnu et le fil d'un autre
-- rendent tous deux `false`.
--
-- C'est le chemin que l'écran doit prendre pour le bouton
-- « supprimer », dans tous les cas : un `delete` direct marche pour un
-- membre en règle et échoue en silence pour les autres, ce qui est la
-- pire des deux pannes.
create or replace function public.ai_conversation_supprimer(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nb int;
begin
  if auth.uid() is null then
    return false;
  end if;

  delete from public.ai_conversations
   where id = p_conversation_id
     and user_id = auth.uid();

  get diagnostics v_nb = row_count;
  return v_nb = 1;
end;
$$;

comment on function public.ai_conversation_supprimer(uuid) is
  'Supprime UN fil, et seulement si l''appelant en est l''auteur. Passe par une fonction et non par '
  'une politique parce qu''un « delete » exige la visibilité en lecture : sans elle, effacer ses '
  'propres conversations deviendrait impossible dès qu''on perd projects.read.';

revoke execute on function public.ai_conversation_supprimer(uuid) from public, anon;
grant execute on function public.ai_conversation_supprimer(uuid) to authenticated;


-- ============================================================
-- 8. RGPD — la suppression l'emporte, et rien ne dort pour toujours
-- ============================================================
--
-- Un fil contient des noms de clients, des montants de devis et des
-- marges. C'est de la donnée personnelle et commerciale, au même titre
-- que la télémétrie de 0077, et la recette éprouvée là-bas tient en
-- TROIS parties. Deux sont ici ; la troisième ne peut pas y être.
--
--   1. LA CASCADE. `on delete cascade` sur `auth.users` et sur
--      `business_organizations` (§ 1 et § 2). Faite.
--
--   2. L'EFFACEMENT DOUX. `on delete cascade` ne se déclenche que sur
--      une suppression RÉELLE. Supabase sait effacer en douceur :
--      `deleteUser(id, true)` laisse la ligne `auth.users` en place et
--      pose `deleted_at`. Le compte disparaît alors de tous les écrans
--      pendant que ses conversations restent en base — invisibles, donc
--      jamais purgées. C'est le trou que 0077 a mesuré et rebouché pour
--      la télémétrie ; on le rebouche ici pour les conversations. Faite,
--      juste en dessous.
--
--   3. LA SUPPRESSION EXPLICITE dans
--      `supabase/functions/delete-account/index.ts`, avant l'appel à
--      `deleteUser` — non pas parce que la cascade échouerait, mais
--      parce qu'« une cascade est INVISIBLE quand on lit cette
--      fonction » (l'argument est écrit en toutes lettres aux lignes
--      76-88 de ce fichier). PAS FAITE : ce fichier n'appartient pas au
--      périmètre de cette migration. À poser par le chantier qui aura
--      le droit d'y écrire, sur le modèle des lignes 89-96 : un seul
--      `delete from ai_conversations where user_id = …` suffit, les
--      messages suivent par la cascade de la clé composite.
--
-- Le `when` du déclencheur limite le corps à la transition
-- NULL → non NULL : GoTrue écrit dans `auth.users` à chaque connexion
-- et à chaque rafraîchissement de jeton, et ce déclencheur ne doit rien
-- coûter à ces écritures-là.
--
-- Un seul `delete`, sur les fils : les messages partent par la cascade
-- de la clé composite.
create or replace function public.purge_ai_conversations_on_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ai_conversations where user_id = new.id;
  return new;
end;
$$;

comment on function public.purge_ai_conversations_on_soft_delete() is
  'Efface les conversations quand un compte est effacé EN DOUCEUR (deleted_at posé sans suppression '
  'de la ligne auth.users) : dans ce cas le « on delete cascade » ne se déclenche pas, et des noms de '
  'clients et des montants survivraient à un compte qu''on croit supprimé. Jumeau de '
  'purge_mobile_presence_on_soft_delete (0077).';

drop trigger if exists purge_ai_conversations_on_soft_delete on auth.users;
create trigger purge_ai_conversations_on_soft_delete
  after update of deleted_at on auth.users
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.purge_ai_conversations_on_soft_delete();


-- ------------------------------------------------------------
-- 8.b LA RÉTENTION — ce qui n'a plus de finalité ne se garde pas
-- ------------------------------------------------------------
--
-- Rien, aujourd'hui, ne purge un fil ancien. Un fil de trois ans plein
-- de noms de clients est de la donnée conservée sans finalité : ni
-- l'utilisateur, qui ne le rouvrira pas, ni le modèle, qui ne le
-- rejouera jamais (la queue du § 6 s'arrête à seize messages), n'en
-- ont l'usage.
--
-- ELLE COMPTE À PARTIR DU DERNIER MESSAGE RÉEL, pas de
-- `last_message_at`. La colonne du fil n'est pas gelée (§ 5) : un
-- client pourrait la repousser et soustraire indéfiniment un fil à la
-- purge. `max(created_at)` des messages, lui, est posé par le serveur
-- au § 4 et ne se falsifie pas. Un fil ouvert et jamais parlé se compte
-- depuis sa création.
--
-- ELLE COUVRE AUSSI LE CAS QU'AUCUNE CASCADE NE VOIT : un salarié qui
-- quitte l'entreprise. Il n'y a pas de clé étrangère vers
-- `organization_members` — et il ne doit pas y en avoir, sinon
-- archiver un membre effacerait ses conversations, ce qui n'est pas la
-- même décision. Ses fils deviennent donc illisibles de tous (la RLS
-- exige `user_id = auth.uid()` ET l'appartenance) sans disparaître.
-- C'est le temps qui les emporte, ici.
--
-- ELLE N'EST APPELÉE PAR PERSONNE, et il faut le dire : ce projet n'a
-- pas de `pg_cron` (vérifié sur les 78 migrations précédentes). La
-- fonction existe pour être appelée par un planificateur ou par un
-- travail de ménage, comme `ai_purge_expired_result_cache` (0076), qui
-- attend elle aussi. Écrire la fonction sans son planificateur, c'est
-- au moins rendre la décision visible et son exécution possible ;
-- l'omettre, c'est décider de tout garder sans le dire.
--
-- Fermée à `authenticated` : elle traverse toutes les entreprises et ne
-- peut vérifier l'appartenance de personne. C'est un travail de ménage,
-- pas un travail d'utilisateur — le régime de 0076 § 8.
create or replace function public.ai_purge_old_conversations(p_jours int default 365)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jours int := greatest(coalesce(p_jours, 365), 30);
  v_nb int;
begin
  delete from public.ai_conversations c
   where coalesce(
           (select max(m.created_at)
              from public.ai_conversation_messages m
             where m.conversation_id = c.id),
           c.created_at
         ) < now() - make_interval(days => v_jours);

  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.ai_purge_old_conversations(int) is
  'Supprime les fils sans activité depuis N jours (365 par défaut, jamais moins de 30). Compte à '
  'partir du dernier message RÉEL, pas de last_message_at, qui n''est pas gelée. '
  'Aucun planificateur ne l''appelle aujourd''hui — comme ai_purge_expired_result_cache (0076).';

revoke execute on function public.ai_purge_old_conversations(int)
  from public, anon, authenticated;
grant execute on function public.ai_purge_old_conversations(int) to service_role;


-- ============================================================
-- 9. CE QUI N'EST PAS DANS CE FICHIER, ET POURQUOI
-- ============================================================
-- Ce bloc n'exécute rien. Il est là pour la prochaine personne.
--
--   UNE TABLE DE PROPOSITIONS
--       `proposal` est un jsonb, pas une clé étrangère, et le
--       catalogue des `kind` reste dans `web-pro/lib/ai/proposals.ts`.
--       Une table de propositions en base ferait deux listes à tenir à
--       jour, et la base serait la seconde à être fausse : un `kind`
--       ajouté côté TypeScript passerait la revue de code et échouerait
--       en production.
--
--   UN COMPTEUR DE MESSAGES SUR LE FIL
--       Dénormaliser `message_count` aurait épargné un `count(*)` par
--       insertion sur deux cents lignes indexées — c'est-à-dire rien —
--       en échange d'un chiffre qui dérive dès la première suppression
--       inattendue. Le fil porte `last_message_at`, qui ne se recalcule
--       pas ; le nombre se compte.
--
--   UN LIEN VERS `ai_usage_events`
--       Tentant : chaque réponse a coûté quelque chose. Mais
--       `ai_usage_events.user_id` est en `on delete set null`, et une
--       clé étrangère depuis un message vers une ligne d'usage
--       rattacherait une conversation supprimable à un grand livre qui
--       ne l'est pas. Le message garde `model` ; l'argent reste au
--       grand livre.
--
--   LE PARTAGE D'UN FIL ENTRE COLLÈGUES
--       C'est une question produit, pas une omission. Voir le préambule
--       et le § 7 : la politique à changer y est nommée.
