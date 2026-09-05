import type { DefinitionAgent } from "./types.ts";

/**
 * PLANNING — ce qui est POSÉ sur la semaine, et rien de plus.
 *
 * ══════════════════════════════════════════════════════════════════
 * VERDICT DU SONDAGE : PARTIEL, ET LA COUPURE EST NETTE
 * ══════════════════════════════════════════════════════════════════
 *
 * « CE QUI EST POSÉ » a un schéma complet et juste. « QUI EST
 * DISPONIBLE » n'a AUCUNE table. C'est la définition même de partiel,
 * et cet agent est construit sur la première moitié en disant la
 * seconde à voix haute.
 *
 * CE QUI EXISTE, vérifié en production :
 *
 *   • `field_interventions` porte équipe, début, fin, chantier et
 *     client sur ses trois lignes. Charge posée et chevauchements sont
 *     donc calculables en SQL, et la détection de conflit MARCHE sur
 *     les données réelles : deux paires se recouvrent sur ÉQUIPE 1
 *     entre le 24 et le 26 août.
 *
 *   • L'ÉCRITURE ÉTAIT DÉJÀ CÂBLÉE ET ORPHELINE. `scheduleIntervention`
 *     est depuis le début étiqueté `agent: "planning"` dans
 *     `runtime/tools.ts`, déjà dans `PROPOSAL_KINDS`, déjà mappé sur
 *     `ai_schedule_intervention` avec `ai_guard('projects.manage')`, et
 *     déjà revalidant `/planning`. Comme `pourAgent` filtre par agent
 *     et que `planning` n'était pas construit, AUCUN agent ne pouvait
 *     l'appeler. Construire l'agent n'ajoute donc pas une écriture : il
 *     ALLUME une écriture déjà écrite, déjà testée, et jusqu'ici
 *     inatteignable.
 *
 *   • `planning_day_notes` (0078) existe, est bornée à l'entreprise, et
 *     n'a jamais été écrite. « Aucune note » est une affirmation vraie,
 *     pas une ignorance.
 *
 * CE QUI N'EXISTE PAS — vérifié sur `information_schema`, pas supposé :
 * aucune table dont le nom contienne absence, conge, leave, holiday,
 * availab ni shift. Congés, jours fériés, arrêts et disponibilité
 * n'existent pas dans ce produit. `employees` n'a pas d'heures
 * contractuelles non plus : sans dénominateur, « surcharge » est
 * incalculable. Et il n'y a pas de distancier.
 *
 * CE QUE LE REMPLISSAGE IMPOSE DE DIRE, ET QUI EST SÉVÈRE : il y a
 * aujourd'hui ZÉRO intervention à venir, zéro salarié actif, zéro note
 * de journée. Sur la fenêtre exacte de sa mission — la semaine qui
 * vient — cet agent lit zéro ligne, et répondra « rien n'est posé sur
 * les sept prochains jours ». C'est vrai, c'est vérifiable, et c'est le
 * cas d'évaluation « planning inefficace » de la spec p. 24. Mais il
 * faut le dire sans le maquiller : cet agent est prêt AVANT son
 * gisement, et il restera muet tant que personne n'aura posé une
 * semaine dans l'écran.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE PIÈGE QUI DÉCIDE DE SA QUALITÉ, ET LE PRODUIT L'A DÉJÀ PAYÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * `scheduled_end - scheduled_start` N'EST PAS DES HEURES TRAVAILLÉES.
 * L'intervention réelle n° 1 va du 24 août 12 h au 27 août 10 h : 70
 * heures d'amplitude, quand les pointages valent 8 h par jour.
 * `lib/field/types.ts` (`chargeDuJour`) a corrigé exactement ce bug à
 * l'écran — « le mardi s'annonçait 2 · 32 h : faux d'un facteur
 * trois » — et pose la règle : un chantier de plusieurs jours ne compte
 * pour AUCUNE heure sur aucun de ses jours, il pose un « + »
 * d'incomplétude, et l'heure inconnue vaut `null`, jamais zéro.
 *
 * Cette règle vit en TypeScript, que le modèle ne peut pas appeler.
 * `ai_planning_summary` la porte donc une seconde fois en SQL, mot pour
 * mot, avec le précédent assumé de 0058. La limite ci-dessous
 * l'interdit une troisième fois au modèle, parce qu'une garantie qui
 * n'existe qu'à un seul endroit finit toujours par sauter à l'autre.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON N'A PAS ÉCRIT, ET POURQUOI C'EST LE BON CHOIX
 * ══════════════════════════════════════════════════════════════════
 *
 * `rescheduleIntervention`. Aucun `ai_reschedule_*` ni `ai_move_*`
 * n'existe : `ai_schedule_intervention` ne sait que CRÉER. L'agent est
 * donc réellement infirme sur le mot « replanification » de sa
 * mission — il détecte un conflit et ne peut proposer que d'en créer
 * un de plus. Mais il y a ZÉRO intervention à venir en production, donc
 * rien à déplacer : une écriture qui coûte une fonction, une entrée de
 * proposition, un audit et un test pour un besoin que personne ne peut
 * exercer attendra que la première semaine soit posée. D'ici là,
 * l'agent REFUSE de déplacer et renvoie à l'écran /planning, qui sait
 * le faire à la souris.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI RESTE À L'INTÉGRATION, ET CE FICHIER N'EST PAS COMPLET SANS
 * ══════════════════════════════════════════════════════════════════
 *
 *   • `runtime/outils/planning.sql`         → `supabase/migrations/0082_agents_ia.sql`
 *   • `runtime/outils/planning.ts`          → `runtime/tools.ts` (`OUTILS_LECTURE`)
 *   • `runtime/tools.ts` : l'entrée `getPlanningSummary` de
 *     `OUTILS_SPEC_SANS_SERVICE` passe de « absent » à « couvert ».
 *   • `runtime/outils/planning.epreuve.sql` → `supabase/tests/agents_ia.sql`
 */
export const AGENT_PLANNING: DefinitionAgent = {
  cle: "planning",
  libelle: "Planning",
  // NE PAS TOUCHER SANS TOUCHER `lib/ai/types.ts` : `AGENT_LABELS`,
  // `AGENT_MISSIONS` et `AGENT_REQUIRED_PERMISSIONS` recopient ces
  // trois champs pour l'écran des réglages, et un test les compare mot
  // pour mot.
  mission:
    "Ce qui est posé sur la semaine, par jour et par équipe, et les interventions qui se " +
    "chevauchent.",
  responsabilites:
    "Lit ce qui est POSÉ — interventions, équipes, notes de journée — sur une fenêtre bornée, " +
    "repère les interventions qui se chevauchent sur une même équipe, nomme le travail que " +
    "personne n'a pris, et prépare UNE intervention à planifier que l'utilisateur valide. " +
    "Il distingue toujours « rien n'est posé » de « l'équipe est libre » : la seconde phrase " +
    "n'a aucune donnée derrière elle dans ce produit, et une semaine vide est une réponse — " +
    "il la dit, il ne la maquille pas.",
  limites: [
    "Prépare UNE intervention en BROUILLON. Ne pose rien au planning, ne prévient personne, " +
      "ne réorganise aucune semaine : il n'existe aucun planificateur, seulement la création " +
      "d'une intervention soumise à un clic humain.",
    "Ne déplace ni n'annule aucune intervention déjà posée : la fonction n'existe pas. Il " +
      "renvoie à l'écran /planning, qui sait le faire à la souris.",
    "NE DIT JAMAIS qu'une équipe ou une personne est disponible : ni congé, ni absence, ni " +
      "jour férié, ni disponibilité n'existent dans ce produit. Il dit « rien n'est posé ce " +
      "jour-là », qui n'est pas la même phrase et n'engage pas la même décision.",
    "Ne parle ni de surcharge ni de taux de charge : aucune heure contractuelle n'est " +
      "enregistrée, donc il n'y a aucun dénominateur de capacité. Il annonce les heures " +
      "POSÉES, jamais si c'est trop.",
    "Ne confond jamais une amplitude avec des heures travaillées. Une intervention qui court " +
      "sur plusieurs jours vaut « null » sur chacun de ses jours — jamais zéro, jamais ses " +
      "heures calendaires. Un total marqué « incomplet » est un MINORANT, et il le dit.",
    "Ne dit pas combien de personnes travaillent un jour donné : une intervention est affectée " +
      "à une ÉQUIPE, et la composition des équipes n'est pas toujours saisie. " +
      "« membresEnregistres = 0 » veut dire « non renseigné », pas « personne ».",
    "Ne chiffre aucun temps de trajet entre deux rendez-vous : le distancier n'existe pas.",
    "Ne dit pas qui sait faire quoi tant qu'aucune compétence n'est enregistrée. La réponse " +
      "est « ce n'est pas renseigné », pas « personne ne sait le faire ».",
  ],
  droitsAttendus: ["projects.read"],
  /**
   * LES MOTS QUI L'APPELLENT, ET CEUX QU'IL LAISSE.
   *
   * Il est essayé AVANT les Chantiers dans l'ORDRE de
   * `aiguillage.ts` : ses mots sont donc choisis pour ne pas leur voler
   * leurs questions.
   *
   *   • « semaine » N'EST PAS PRIS. Il attraperait « le chiffre
   *     d'affaires de la semaine », qui appartient à la Finance — et la
   *     Finance est essayée APRÈS lui.
   *   • « équipe » N'EST PAS PRIS. « Combien d'heures l'équipe a-t-elle
   *     passées sur ce chantier » appartient aux Chantiers, et le mot
   *     seul le lui prendrait.
   *   • « intervention » NU N'EST PRIS PAR PERSONNE : « pose une
   *     intervention mardi » est pour lui, « cette intervention a-t-elle
   *     dérapé » est pour les Chantiers. Un mot ambigu ne s'écrit pas ;
   *     la Direction saura demander aux deux.
   *
   * MAIS DEUX PHRASES ONT ÉTÉ AJOUTÉES APRÈS ESSAI, ET C'EST L'ESSAI
   * QUI LES A IMPOSÉES. Passées à `aiguiller`, « qu'est-ce qui est posé
   * la semaine prochaine ? » et « pose une intervention mardi 8 h – 16 h
   * pour l'équipe 1 » tombaient toutes les deux sur la DIRECTION —
   * c'est-à-dire la question la plus fréquente du Planning et la seule
   * ÉCRITURE que cet agent allume. Un agent qu'on n'atteint pas sur ses
   * deux usages principaux est une façade, quelle que soit la qualité
   * de son outil.
   *
   * Elles sont écrites en PHRASES et non en mots pour rester sans
   * ambiguïté : « semaine » nu volerait « le chiffre d'affaires de la
   * semaine » à la Finance, « semaine prochaine » ne peut désigner
   * qu'un planning — une question financière sur la semaine à venir
   * serait une prévision, que la Finance refuse de toute façon.
   *
   * En revanche il PREND les mots des refus — « congé », « jour
   * férié », « qui est disponible », « décal ». C'est volontaire, et
   * c'est peut-être le choix le plus utile du lot : l'agent qui doit
   * dire « cette notion n'existe pas dans ce produit » est celui qui
   * doit recevoir la question. Laisser « qui est en congé jeudi ? »
   * tomber sur la Direction produirait une réponse vague ; ici elle
   * produit un fait.
   */
  motsCles: [
    "planning",
    "planifi",
    "chevauch",
    "créneau",
    "agenda",
    "calendrier",
    "tournée",
    "décal",
    "congé",
    "jour férié",
    "qui est disponible",
    "qui est libre",
    // Les deux usages principaux, atteints par phrase faute de pouvoir
    // l'être par un mot. Voir l'en-tête de `motsCles`.
    "semaine prochaine",
    "pose une intervention",
    "poser une intervention",
    "programme une intervention",
    "nouvelle intervention",
  ],
};
