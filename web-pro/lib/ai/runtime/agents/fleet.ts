import type { DefinitionAgent } from "./types.ts";

/**
 * MATÉRIEL — UN MODULE ENTIER, ZÉRO LIGNE, ET DEUX OUTILS QUI TIENNENT
 * COMPTE DES DEUX.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE MODULE EXISTE ; LE PARC EST VIDE. LES DEUX SONT VRAIS
 * ══════════════════════════════════════════════════════════════════
 *
 * Verdict du sondage : PARTIEL, et il est tenu.
 *
 * CE QUI EXISTE, ET C'EST PLUS QU'UN ÉCRAN : la migration 0067 pose
 * quatre tables (`equipment`, `equipment_deadlines`,
 * `equipment_assignments`, `equipment_maintenance`), deux vues
 * (`equipment_due_dates`, `equipment_overview`), huit politiques RLS
 * (lecture `projects.read`, écriture `projects.manage`), deux écrans
 * livrés (`/materiel`, `/materiel/[id]`) et une entrée de menu. Et les
 * deux vues font DÉJÀ le calcul : `days_left`, `state`, `current_meter`
 * et sa date de relevé, le cumul d'entretien, la prochaine échéance,
 * l'affectation ouverte. La frontière déterministe de la p. 11 est
 * tenue par le schéma : le modèle n'a rien à additionner ni à soustraire.
 *
 * CE QUI N'EXISTE PAS EN PRODUCTION : une seule ligne. Le reste du
 * produit, lui, a été saisi — un chantier, deux factures, trois
 * interventions. Le vide du matériel n'est donc pas le vide général :
 * personne n'a saisi de machine. Nuance à ne pas gonfler, cependant —
 * cette base a huit jours, c'est une installation en cours d'amorçage,
 * pas un module abandonné.
 *
 * CE QUI N'A PAS DE SCHÉMA DU TOUT — et c'est la moitié « coûts » de sa
 * mission : aucune table de carburant, aucun relevé kilométrique
 * périodique (`meter_reading` est porté par une LIGNE D'ENTRETIEN, donc
 * on ne relève qu'en passant à l'atelier), aucun amortissement (0067
 * l'exclut par écrit), aucune géolocalisation, aucune refacturation du
 * matériel au chantier. `OUTILS_SPEC_SANS_SERVICE` le consigne sous
 * `getFleetCosts` : « le matériel est suivi, son coût d'usage ne l'est
 * pas ». LA PHRASE RESTE VRAIE APRÈS CE CHANTIER, et `fleet.test.ts`
 * échoue si quelqu'un la fait passer à « couvert » : le cas
 * d'évaluation « camion coûteux » (p. 24) est précisément celui auquel
 * ces données ne peuvent pas répondre.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ LIVRÉ, ET CE QUI RESTE À BRANCHER
 * ══════════════════════════════════════════════════════════════════
 *
 * DEUX OUTILS, écrits et ÉPROUVÉS sur la production dans une
 * transaction annulée — 66 vérifications, un parc fabriqué pour
 * l'occasion puis effacé, parce qu'une fonction livrée sur une table
 * vide n'est vérifiable que sur sa forme :
 *
 *   • `getFleetSnapshot` (`ai_fleet_snapshot`) — effectifs, statuts,
 *     disponibilité, échéances triées par urgence, entretien dépensé.
 *   • `getEquipmentRecord` (`ai_fleet_equipment`) — la fiche d'UNE
 *     machine, RÉSOLUTION COMPRISE : `global_search` n'indexe pas le
 *     matériel, donc `searchEntities` ne sait pas retrouver « le Master ».
 *
 * Ils vivent dans `runtime/outils/fleet.ts` et `runtime/outils/fleet.sql`
 * en attendant l'intégration : `tools.ts` et la migration 0082 sont des
 * fichiers PARTAGÉS, et deux mains dedans font un des deux travaux perdu.
 *
 * ─── POURQUOI `aCompleter` RESTE À `true` ───
 *
 * Ce n'est pas un aveu d'inachèvement, c'est une conséquence mécanique.
 * `definitions.test.ts` exige d'un agent ACHEVÉ qu'il ait au moins une
 * source dans le REGISTRE, et `agents/index.test.ts` qu'il ait des
 * mots-clés. Or `sourcesDe()` lit `tools.ts`, où les deux outils ne
 * seront versés que par l'intégration. Retirer le drapeau maintenant
 * ferait échouer deux tests partagés pour une raison fausse.
 *
 * `motsCles` reste donc ABSENT lui aussi — les deux vont ensemble, et un
 * gabarit qu'on aiguille répondrait sans outils.
 *
 * LES QUATRE GESTES D'INTÉGRATION, DANS CET ORDRE ET DANS LE MÊME COMMIT :
 *
 *   1. 0082 reçoit le corps de `outils/fleet.sql` (les deux fonctions).
 *   2. `tools.ts` reçoit `OUTIL_FLEET_SNAPSHOT` et `OUTIL_FLEET_EQUIPMENT`.
 *      `getFleetCosts` reste « absent » dans `OUTILS_SPEC_SANS_SERVICE`.
 *   3. `supabase/tests/agents_ia.sql` reçoit `outils/fleet.epreuve.sql`.
 *   4. ICI : retirer `aCompleter`, et écrire `motsCles:
 *      MOTS_CLES_MATERIEL` — la liste est déjà exportée plus bas, tenue
 *      par `fleet.test.ts`, et il n'y a donc RIEN à recopier. Une liste
 *      recopiée depuis un commentaire est une liste qu'on retape en
 *      oubliant un mot, et personne ne s'en aperçoit : un aiguillage
 *      manquant ne casse rien, il envoie simplement la question à la
 *      Direction, qui répond « je ne vois rien » avec aplomb.
 *
 * Et, PARTAGÉ : une clé `fleet` dans `PLANS` (`runtime/context.ts`),
 * `{ outil: "getFleetSnapshot", requis: true, arguments: () => ({}) }`.
 * `requis: true` est le bon réglage et ce n'est pas indifférent : sans
 * `projects.read`, le contexte ressort vide, le runner REFUSE avant tout
 * appel de modèle et nomme le droit — au lieu de laisser l'agent
 * rapporter un parc vide qui serait un mensonge rassurant.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA CONDITION DE LIVRAISON, ET ELLE N'EST PAS NÉGOCIABLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Tant que `equipment` compte zéro ligne, l'agent répond « aucun
 * matériel enregistré » et renvoie vers `/materiel`. JAMAIS « 0 échéance
 * en retard » : c'est la confusion zéro / je-ne-sais-pas que ce produit
 * a déjà corrigée quatre fois, et elle serait ici la faute la plus facile
 * à commettre — la phrase est rassurante, donc personne ne la vérifie.
 *
 * Elle n'est PAS laissée à la vigilance du modèle. `ai_fleet_snapshot`
 * rend `parc.vide`, un BOOLÉEN distinct de tout compte, et met à NULL
 * les compteurs d'échéances tant qu'il est vrai. Le modèle n'a aucune
 * déduction à faire, parce que c'est précisément la déduction qu'il rate.
 *
 * Et une TROISIÈME forme, que le sondage n'avait pas isolée et que
 * l'épreuve a fait apparaître : un parc où des machines existent mais où
 * AUCUNE échéance n'a jamais été saisie. Les compteurs de parc y sont
 * crédibles, donc « 0 en retard » ressemble à une vraie réponse. D'où le
 * second drapeau, `echeances.suivies`, et le compte
 * `machinesSansEcheance` pour le cas intermédiaire — un parc à moitié
 * suivi rend des chiffres vrais qui décrivent la moitié de la réalité.
 */
/**
 * LES MOTS QUI DEVRONT L'ATTEINDRE — EXPORTÉS, PAS COMMENTÉS.
 *
 * Ils ne sont PAS encore posés sur la définition : `motsCles` et
 * `aCompleter` vont ensemble (voir l'en-tête), et un gabarit qu'on
 * aiguille répond sans outils. Ils vivent quand même ici plutôt que dans
 * une phrase de commentaire, pour deux raisons.
 *
 * D'abord parce que l'intégration n'aura rien à retaper : elle écrit
 * `motsCles: MOTS_CLES_MATERIEL` et le geste est fini. Ensuite parce
 * qu'une liste exportée est une liste TESTABLE — `fleet.test.ts` vérifie
 * dès aujourd'hui qu'aucun de ces mots n'est déjà revendiqué par un des
 * neuf autres agents. Le conflit se découvre maintenant, pas le jour de
 * la fusion.
 *
 * ─── CE QUI EST DEDANS, ET POURQUOI SEULEMENT ÇA ───
 *
 * Des mots de CATÉGORIE, jamais des noms de machine. « mini-pelle »
 * avait été proposé et il est retiré : le parc d'un paysagiste compte
 * aussi des tondeuses, des tracteurs, des remorques, des nacelles et des
 * broyeurs, et lister les engins un par un est une course perdue qui
 * donne l'illusion d'une couverture. « engin » et « matériel » les
 * attrapent tous. Accessoirement « mini-pelle » n'aurait même pas
 * attrapé « minipelle » : la normalisation retire les accents, pas les
 * traits d'union.
 *
 * « vgp » est le seul sigle retenu, et il est sûr : la vérification
 * générale périodique est une échéance d'engin de levage et rien
 * d'autre. C'est `equipment_deadlines.kind = 'regulatoryCheck'`.
 *
 * ─── LES CINQ MOTS ÉCARTÉS, ET LA RAISON DE CHACUN ───
 *
 * Ils comptent autant que les mots retenus : un mot trop large ne se
 * signale pas, il détourne en silence une question qui allait bien.
 *
 *   • « parc » — proposé, RETIRÉ après relecture. L'aiguillage cherche
 *     une sous-chaîne : « parc » est dans « parcelle », et surtout un
 *     paysagiste entretient des PARCS. « le parc de la mairie » est un
 *     chantier, pas un parc matériel. « matériel » couvre déjà « parc
 *     matériel ».
 *   • « entretien » — l'entretien d'un jardin n'est pas l'entretien
 *     d'une machine, et chez un paysagiste le premier sens est de loin
 *     le plus fréquent.
 *   • « échéance » — une échéance de facture appartient à la
 *     Facturation, qui est essayée avant et qui a raison de gagner.
 *   • « assurance » — l'assurance décennale et la RC pro ne sont pas
 *     l'assurance d'un camion, et ce sont les deux qu'on évoque le plus.
 *   • « révision » — la révision d'un devis existe aussi.
 *
 * ─── UN MOT RETENU MALGRÉ UNE AMBIGUÏTÉ, ASSUMÉE ───
 *
 * « immobilis » attrape « immobilisé » (une machine à l'arrêt, à nous)
 * mais aussi « immobilisation » au sens comptable (des actifs, pas à
 * nous). L'ambiguïté est acceptée : l'agent Matériel refuse
 * l'amortissement par son nom et renvoie à l'expert-comptable, ce qui
 * est une meilleure réponse que celle de la Direction, qui n'a aucune
 * source sur le sujet et le dirait moins clairement.
 */
export const MOTS_CLES_MATERIEL = [
  "matériel",
  "engin",
  "camion",
  "véhicule",
  "contrôle technique",
  "vgp",
  "immobilis",
] as const;

export const AGENT_MATERIEL: DefinitionAgent = {
  cle: "fleet",
  libelle: "Matériel",
  mission:
    "Échéances qui tombent, machines immobilisées, affectations en cours et entretiens " +
    "réellement enregistrés. Ne chiffre aucun coût d'usage : ce produit ne le mesure pas.",
  responsabilites:
    "Suit les échéances du parc — contrôle technique, révision, assurance, contrôle " +
    "réglementaire — l'état de chaque machine, à qui elle est affectée et depuis quand, et ce " +
    "que son entretien a réellement coûté. Classe ce qu'il faut traiter en premier et dit " +
    "pourquoi. Sur la moitié « coûts » de son domaine, il NOMME ce qu'il ne sait pas voir au " +
    "lieu de l'estimer.",
  limites: [
    "N'écrit rien, et ne propose rien. Changer un statut, sortir une machine du parc, marquer " +
      "une échéance « faite », créer une ligne d'entretien : l'écran /materiel le fait déjà à " +
      "un clic. Renvoie-y.",
    "NE CHIFFRE AUCUN COÛT D'USAGE : ni carburant, ni coût au kilomètre ou à l'heure, ni " +
      "amortissement, ni valeur résiduelle, ni refacturation au chantier n'existent dans ce " +
      "produit — ce ne sont pas des tables vides, ce sont des tables absentes. Il connaît le " +
      "prix d'achat saisi et les factures d'entretien saisies, et rien d'autre. « Combien me " +
      "coûte ce camion au kilomètre » se refuse par son nom, sans contre-proposition chiffrée.",
    "Ne dit JAMAIS « aucune échéance en retard » quand le parc est vide, ni quand aucune " +
      "échéance n'a été saisie : « personne n'a rien enregistré » et « tout est à jour » sont " +
      "deux phrases opposées. L'outil rend « vide » et « suivies » pour trancher, et des " +
      "compteurs à null — il ne les remplace jamais par zéro.",
    "Le compteur d'une machine date de son dernier passage à l'atelier, pas d'aujourd'hui : il " +
      "n'existe aucun relevé périodique. Il cite le relevé AVEC sa date, n'extrapole aucune " +
      "usure entre les deux, et ne prédit aucune panne.",
    "Une affectation est une SAISIE, pas une position : aucune géolocalisation, aucun boîtier. " +
      "« Au dépôt » veut dire « aucune affectation ouverte », rien de plus.",
    "Aucune donnée externe : ni cote de l'occasion, ni comparaison des tarifs d'entretien. " +
      "C'est le domaine de l'agent Marché, qui n'est pas construit — il le dit plutôt que de " +
      "l'inventer.",
    "Sans projects.read, il est indisponible et le NOMME : la RLS masquerait les quatre tables " +
      "et rendrait un parc faussement vide, ce qui est pire qu'un refus.",
  ],
  droitsAttendus: ["projects.read"],
  // GESTE 4 DE L'INTÉGRATION, FAIT : `aCompleter` retiré et les
  // mots-clés posés, EN MÊME TEMPS que les trois autres gestes (0082 a
  // reçu les deux fonctions, `tools.ts` les deux outils,
  // `tests/agents_ia.sql` l'épreuve). Les quatre vont ensemble : le
  // drapeau retiré sans les outils fabriquerait l'agent joignable et
  // muet que ce chantier avait pour but d'éviter.
  //
  // La liste est IMPORTÉE d'au-dessus et non recopiée : une liste de
  // mots retapée à la main perd un mot sans que rien ne casse — la
  // question part simplement à la Direction, qui répond « je ne vois
  // rien » avec aplomb.
  motsCles: MOTS_CLES_MATERIEL,
};
