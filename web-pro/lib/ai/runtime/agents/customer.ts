import type { DefinitionAgent } from "./types.ts";

/**
 * CLIENTS — DEUX MISSIONS SUR QUATRE TIENNENT, ET LES DEUX AUTRES SE
 * REFUSENT PAR LEUR NOM.
 *
 * ══════════════════════════════════════════════════════════════════
 * SUR QUATRE MISSIONS, DEUX TIENNENT ET DEUX N'ONT RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Verdict du sondage : PARTIEL. Et les deux absences ne sont pas de même
 * nature, ce qui change ce que l'agent doit en dire.
 *
 * L'HISTORIQUE TIENT. `ai_get_client_context` existe, est déjà déclarée
 * sous `getClientContext` avec `agent: null` — donc transverse, l'agent
 * Clients la reçoit sans une ligne de code — et rend une réponse vraie
 * et non vide sur le seul client de la base : coordonnées, devis
 * accepté, chantier terminé, propriété, factures impayées avec leurs
 * échéances.
 *
 * LA VALEUR TIENT DÉSORMAIS, et c'est ce que ce chantier a ajouté.
 * `getClientContext` ne rend que les factures IMPAYÉES : ni total
 * facturé, ni total encaissé, ni date de première facture. Sans outil,
 * la seule manière de répondre « combien ce client m'a-t-il rapporté »
 * était d'ADDITIONNER LES IMPAYÉS et d'appeler cela un chiffre
 * d'affaires — une addition faite par le modèle, interdite p. 11-12, et
 * un total qui décrit ce qu'on n'a PAS touché présenté comme un gain.
 * `getCustomerValue` (`ai_customer_value`) rend ce calcul au SQL.
 *
 * LA SATISFACTION EST ABSENTE, ET C'EST UNE ABSENCE DE SCHÉMA. Aucune
 * table de satisfaction, de note, d'avis, d'enquête, de réclamation ni
 * de ticket ; aucune colonne non plus, sur aucune table, dans tout le
 * schéma. Le plus proche est `field_interventions.signed_at` — mais une
 * signature de bon d'intervention est un ACCUSÉ DE RÉALISATION, pas une
 * note. La convertir serait l'invention que la p. 12 interdit. La
 * différence de formulation compte : « la fonctionnalité n'existe pas »
 * n'appelle pas la même suite que « je n'ai pas assez de données ».
 *
 * LE RISQUE DE DÉPART EST INCALCULABLE, pour trois raisons cumulées :
 * aucune notion de récurrence (pas de contrat d'entretien, pas
 * d'abonnement client — `organization_subscriptions` concerne
 * l'abonnement des PAYSAGISTES à Oasis Care, pas les contrats de leurs
 * clients), `crm_customers.converted_at` non renseigné donc aucune
 * ancienneté de relation, et aucun outil ne balaie le portefeuille.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE PIÈGE QUE CE CHANTIER A TROUVÉ, ET QUI N'ÉTAIT PAS DANS LE SONDAGE
 * ══════════════════════════════════════════════════════════════════
 *
 * LES TABLES DE CET AGENT NE SONT PAS SOUS LE MÊME DROIT. Vérifié dans
 * `pg_policies` : `crm_customers` sous `clients.read`, `quotes` sous
 * `quotes.read`, `invoices` / `payments` / `payment_allocations` /
 * `credit_notes` sous `invoice.create`, `projects` sous `projects.read`.
 *
 * En `security invoker` nu, un utilisateur qui n'a que `clients.read`
 * aurait obtenu : le client trouvé, ZÉRO devis, ZÉRO facture, ZÉRO euro.
 * Tout vrai au sens du SQL, tout faux au sens de la question — et
 * l'agent aurait conclu que ce client ne rapporte rien. C'est la classe
 * de bug « RLS grant tables » déjà nommée dans ce dépôt, croisée avec la
 * confusion zéro / je-ne-sais-pas corrigée quatre fois.
 *
 * `ai_customer_value` vérifie donc les trois droits AVANT de lire, rend
 * `null` sur le BLOC ENTIER quand l'un manque, et le NOMME dans
 * `droitsManquants` — la manière de `ai_finance_snapshot` (0073), reprise
 * plutôt que réinventée. Seul `clients.read` passe par `ai_guard` et lève :
 * sans lui il n'y a pas de client, donc rien à rendre partiellement.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE FAIT QUI DOMINE TOUT, ET QU'IL FAUT DIRE AU DIRIGEANT
 * ══════════════════════════════════════════════════════════════════
 *
 * Cette base a une semaine et UN client. L'agent est constructible dans
 * son mécanisme et vrai dans ses réponses — il parlera d'un client. Le
 * construire est honnête ; prétendre qu'il analyse un PORTEFEUILLE ne le
 * serait pas, et c'est pour cela que ses limites interdisent toute
 * phrase de population : concentration, moyenne, classement, « vos
 * meilleurs clients ». Sur n = 1, ces chiffres sont arithmétiquement
 * exacts et ne décrivent rien.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ LIVRÉ, ET CE QUI RESTE À BRANCHER
 * ══════════════════════════════════════════════════════════════════
 *
 * UN outil, et un seul — `getCustomerValue`, écrit et ÉPROUVÉ sur la
 * production dans une transaction annulée (45 vérifications, dont un
 * compte amputé de ses trois droits, un acompte non lettré, un brouillon
 * de facture qui ne doit entrer dans aucun total). Il vit dans
 * `runtime/outils/customer.ts` et `runtime/outils/customer.sql` en
 * attendant l'intégration : `tools.ts` et 0082 sont PARTAGÉS.
 *
 * PAS D'OUTIL DE PORTEFEUILLE, et il ne faut pas en écrire un :
 * `context.ts` pose « jamais toute la base », et un classement sur un
 * client serait une ligne.
 *
 * ─── POURQUOI `aCompleter` RESTE À `true` ───
 *
 * Conséquence mécanique, pas aveu d'inachèvement.
 * `definitions.test.ts` exige d'un agent ACHEVÉ une source dans le
 * REGISTRE, et `agents/index.test.ts` des mots-clés. `sourcesDe()` lit
 * `tools.ts`, où l'outil ne sera versé que par l'intégration. Retirer le
 * drapeau maintenant ferait échouer deux tests partagés pour une raison
 * fausse. `motsCles` reste absent avec lui : les deux vont ensemble.
 *
 * LES QUATRE GESTES D'INTÉGRATION, DANS LE MÊME COMMIT :
 *
 *   1. 0082 reçoit le corps de `outils/customer.sql`.
 *   2. `tools.ts` reçoit `OUTIL_CUSTOMER_VALUE`. Rien à changer dans
 *      `OUTILS_SPEC_SANS_SERVICE` : la p. 10-11 ne nomme aucun outil de
 *      valeur client.
 *   3. `supabase/tests/agents_ia.sql` reçoit `outils/customer.epreuve.sql`.
 *   4. ICI : retirer `aCompleter`, et écrire `motsCles:
 *      MOTS_CLES_CLIENTS` — la liste est exportée plus bas et tenue par
 *      `customer.test.ts`, il n'y a rien à recopier.
 *
 * Et, PARTAGÉ : une clé `customer` dans `PLANS` (`runtime/context.ts`).
 * Les DEUX étapes en `requis: false`, et c'est délibéré :
 *
 *   { outil: "getClientContext", requis: false,
 *     arguments: (c) => (c.customerId ? { p_customer_id: c.customerId } : null) },
 *   { outil: "getCustomerValue",  requis: false,
 *     arguments: (c) => (c.customerId ? { p_customer_id: c.customerId } : null) },
 *
 * `requis: true` ferait refuser le runner dès qu'aucun client n'est
 * désigné — or c'est le cas ordinaire d'une conversation, et l'agent sait
 * s'en sortir : `searchEntities` transforme « Robert » en identifiant.
 * Le refus doit venir de l'absence de client trouvé, pas de l'absence de
 * cible dans la requête.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE RECOMMANDATION QUI N'EST PAS DU CODE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le seul déploiement pleinement honnête de cet agent est un point
 * d'appel sur `/crm/clients/[id]`, qui transmet l'identifiant : c'est le
 * seul endroit où il démarre en sachant de qui on parle. Atteint depuis
 * une conversation générale, il commence par le deviner. Ce n'est pas
 * bloquant — `searchEntities` existe et fonctionne — mais l'écran de la
 * fiche client n'a AUCUN point d'entrée IA aujourd'hui, et c'est là que
 * cet agent vaudrait le plus. Hors périmètre de ce chantier ; signalé
 * parce que personne d'autre ne le verra.
 */
/**
 * LE MOT QUI DEVRA L'ATTEINDRE. UN SEUL, ET C'EST UN RÉSULTAT.
 *
 * Pas encore posé sur la définition : `motsCles` et `aCompleter` vont
 * ensemble (voir l'en-tête). Exporté quand même, pour que l'intégration
 * n'ait rien à retaper et pour que `customer.test.ts` puisse vérifier
 * dès aujourd'hui qu'aucun des neuf autres agents ne revendique ce mot.
 *
 * ─── POURQUOI LA LISTE A FONDU À UN SEUL MOT ───
 *
 * Le sondage en proposait quatre : « client », « fiche client »,
 * « relance client », « historique du client ». Les trois derniers
 * CONTIENNENT le premier, et l'aiguillage cherche une sous-chaîne : ils
 * ne peuvent donc jamais se déclencher seuls. Les garder aurait donné
 * une liste rassurante dont trois entrées sur quatre sont mortes — et
 * une liste morte finit par être recopiée ailleurs comme si elle
 * décrivait quelque chose.
 *
 * ─── CE QUI PROTÈGE UN MOT AUSSI LARGE : L'ORDRE, PAS LA LISTE ───
 *
 * « client » est un mot très fréquent, et c'est exactement pour cela
 * qu'il fallait le vérifier contre l'ORDRE d'`aiguillage.ts` plutôt que
 * contre lui-même. Les Clients sont essayés en huitième position, donc
 * APRÈS la Facturation, le Chiffrage, le Planning et les Chantiers :
 *
 *   • « la facture du client Dupont » → « factur » gagne, Facturation.
 *   • « un devis pour ce client »     → « devis » gagne, Chiffrage.
 *   • « où en est le chantier du client » → « chantier » gagne, Chantiers.
 *
 * Ce qui reste à cet agent, ce sont les questions où « client » est le
 * SUJET et non le complément — « où en est-on avec Robert », « ce client
 * me doit combien » — et ce sont précisément les siennes. Le mot n'est
 * donc pas trop large : il est rattrapé par l'ordre, qui est le seul
 * endroit où cet arbitrage se décide.
 *
 * ─── LES DEUX MOTS ÉCARTÉS ───
 *
 *   • « relance » NU — la relance de paiement est à la Facturation
 *     (essayée avant, et qui a raison), la relance d'un devis au
 *     Chiffrage. Le mot seul n'appartient à personne.
 *   • « impayé » — c'est le mot de la Facturation, qui le revendique
 *     déjà sous « impay » et qui gagne à juste titre : un impayé est une
 *     question d'encaissement avant d'être une question de relation.
 *
 * Et un mot qu'on aurait pu prendre pour bien faire : « portefeuille ».
 * Il est écarté parce que cet agent REFUSE toute phrase de portefeuille,
 * et qu'aucun outil ne balaie la base clients. L'attraper pour refuser
 * serait payer un raisonnement complet afin de rendre un refus qu'une
 * phrase d'écran donne gratuitement.
 */
export const MOTS_CLES_CLIENTS = ["client"] as const;

export const AGENT_CLIENTS: DefinitionAgent = {
  cle: "customer",
  libelle: "Clients",
  mission:
    "Histoire d'un client : ses devis, ses chantiers, ses factures, ce qu'il a réellement payé " +
    "et ce qu'il doit encore. Ni satisfaction ni risque de départ : ce produit ne les mesure pas.",
  responsabilites:
    "Reconstitue la relation avec UN client — devis proposés et acceptés, chantiers, factures " +
    "émises, argent reçu, reste dû, montants échus — et dit ce qu'il resterait à faire avec " +
    "lui. Distingue toujours trois états qu'on confond : « je n'ai pas le droit de le lire », " +
    "« rien n'a jamais été saisi » et « zéro euro ».",
  limites: [
    "N'écrit rien. Ne crée pas de client, ne modifie aucune fiche, n'envoie aucune relance, ne " +
      "consigne aucune activité. C'est une mission de lecture.",
    "NE PARLE JAMAIS DE SATISFACTION : ce produit ne collecte AUCUN signal — ni note, ni avis, " +
      "ni enquête, ni réclamation, ni ticket. Aucune table, aucune colonne. Il dit que la " +
      "fonctionnalité N'EXISTE PAS, et non qu'elle est vide. Une intervention signée est un " +
      "accusé de réalisation, jamais un contentement, et il refuse la conversion.",
    "Ne produit aucun score de risque de départ : ni contrat récurrent, ni abonnement, ni " +
      "ancienneté fiable ne sont enregistrés, et aucun outil ne balaie le portefeuille par " +
      "récence. Il nomme les trois manques plutôt que d'estimer.",
    "Regarde UN client à la fois. Aucune phrase de portefeuille — concentration, moyenne, " +
      "classement, « vos meilleurs clients » : aucun outil ne parcourt la base clients, et sur " +
      "une base d'un client ces chiffres seraient exacts et vides.",
    "Ne juge pas si un client est « bon payeur ». Il rend les faits — facturé, encaissé, échu — " +
      "et s'arrête là : un verdict de comportement demande un historique que cette base n'a pas.",
    "« Aucune activité enregistrée » n'est pas « on ne l'a pas contacté » : le journal " +
      "d'échanges est vide par défaut de saisie. Les confondre enverrait relancer quelqu'un " +
      "qu'on a peut-être vu hier.",
    // « zéro euro » en toutes lettres, et non le chiffre : `limites` part
    // MOT POUR MOT dans l'instruction envoyée au modèle, et la règle de
    // la maison — aucun chiffre dans une limite — est volontairement
    // brutale. Une règle qui admet une exception se négocie ; celle-ci
    // ne doit pas, parce que le chiffre qu'on y écrirait un jour serait
    // un fait mesuré sur UNE entreprise et récité à toutes les autres.
    "Un bloc à null vient d'un DROIT MANQUANT et se nomme (droitsManquants) ; un total à null " +
      "sur un bloc lisible veut dire « rien n'a jamais été saisi ». Ni l'un ni l'autre ne se " +
      "dit « zéro euro ».",
    "L'argent reçu n'est pas l'argent lettré : un acompte encaissé avant toute facture n'est " +
      "rattaché à rien. Il rend les deux et nomme l'écart, plutôt que de conclure « il n'a pas " +
      "payé ».",
  ],
  droitsAttendus: ["clients.read", "projects.read"],
  // GESTE 4 DE L'INTÉGRATION, FAIT : `aCompleter` retiré et le mot-clé
  // posé, EN MÊME TEMPS que les trois autres gestes (0082 a reçu
  // `ai_customer_value`, `tools.ts` l'outil, `tests/agents_ia.sql`
  // l'épreuve). Les quatre vont ensemble.
  //
  // UN SEUL MOT, ET C'EST L'ORDRE D'AIGUILLAGE QUI LE REND SÛR :
  // Facturation, Chiffrage et Chantiers sont essayés AVANT les Clients,
  // donc « la facture du client » part bien à la Facturation et « le
  // devis du client » au Chiffrage. C'est seulement ce qui reste — « ce
  // client m'a rapporté combien ? » — qui arrive ici.
  motsCles: MOTS_CLES_CLIENTS,
};
