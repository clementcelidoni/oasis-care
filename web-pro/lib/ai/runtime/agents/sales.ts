import type { DefinitionAgent } from "./types.ts";

/**
 * §11Z — VENTES : LA FENÊTRE REFERMÉE DU DEVIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL AVAIT ÉTÉ ÉCARTÉ. IL EST CONSTRUIT PARCE QUE LE DIRIGEANT A
 * TRANCHÉ — ET LE DÉCOUPAGE QUI LE REND HONNÊTE EST ÉCRIT ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * `agents/sansDonnees.ts` refusait cet agent, et son motif était juste
 * dans les termes où il était posé : « la seule part qui aurait de la
 * matière est DÉJÀ livrée deux fois — la Direction calcule les devis
 * sans réponse et ceux qui expirent, et l'action “relancer un devis”
 * appartient au chiffrage. Un agent Commerce ferait une seconde source
 * de vérité sur le même chiffre. »
 *
 * Ce motif tombe pour une raison précise et mesurée, pas parce qu'on a
 * changé d'avis : `ai_executive_brief` (sections 2 et 3) ne regarde QUE
 * les devis ENCORE OUVERTS — son filtre est `status in ('sent','viewed')`.
 * Cet agent-ci ne regarde QUE les devis DÉCIDÉS — `decided_at is not
 * null`. Les deux populations sont DISJOINTES PAR CONSTRUCTION : un
 * devis ouvert n'a pas de décision, un devis décidé n'est plus ni
 * `sent` ni `viewed`. Il n'y a donc pas deux réponses possibles à la
 * même question ; il y a deux questions différentes.
 *
 * C'est cette frontière, et elle seule, qui autorise cet agent à
 * exister. Si elle bouge, il redevient le doublon que 0082 refusait.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES QUATRE PROPRIÉTAIRES, ET QUI POSSÈDE QUOI
 * ══════════════════════════════════════════════════════════════════
 *
 *   • DEVIS ENCORE OUVERT (dormant, expirant) → `ai_executive_brief`
 *     §2 et §3, attribué à `quote_pricing`. Ventes le LIT dans le
 *     briefing et le rend tel quel sous `renvoiDevisOuverts` ; il ne le
 *     recalcule jamais. Le nombre qu'il affiche est LITTÉRALEMENT celui
 *     du briefing, ce qui rend un écart impossible plutôt
 *     qu'improbable.
 *   • DEVIS DÉCIDÉ (flux, délai, transformation) → ICI.
 *   • APRÈS L'ACCEPTATION (facture à préparer, dossier à suivre) →
 *     `ai_billing_candidates`, dont la section 3 filtre
 *     `status = 'accepted'`. Vérifié dans 0073, pas supposé.
 *   • LE MONTANT, QUELLE QUE SOIT LA FENÊTRE → `ai_quote_price_analysis`
 *     et la vue `quote_totals`, agent `quotePricing`.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL SAIT DIRE AUJOURD'HUI, ET CE QUE ÇA VAUT
 * ══════════════════════════════════════════════════════════════════
 *
 * Mesuré en production le 5 septembre 2026, en transaction annulée :
 *
 *   • UN SEUL DEVIS DÉCIDÉ. DEV-2026-0001, envoyé le 29/08 à 13:36:00,
 *     décidé à 13:36:19 — DIX-NEUF SECONDES. `ai_sales_flow` compte
 *     cette décision dans `decisionsQuasiInstantanees` (seuil 120 s),
 *     et l'agent doit la lire pour ce qu'elle est : une saisie de
 *     recette, pas une décision de client.
 *   • ZÉRO OPPORTUNITÉ, ZÉRO ACTIVITÉ CRM. Les deux écrans existent et
 *     leur schéma est complet — sept étapes fermées par
 *     `crm_opportunities_stage_check`, sept natures fermées par
 *     `crm_activities_activity_type_check`. Personne ne les a remplis.
 *     C'est un DÉFAUT DE SAISIE, et la fonction le distingue d'un
 *     pipeline vide par un compteur sur la table ENTIÈRE. L'agent doit
 *     nommer le défaut, jamais rendre « zéro ».
 *   • AUCUN MOTIF DE REFUS n'a jamais été saisi. « Vous ne perdez
 *     jamais » est faux ; « aucune perte n'a été enregistrée » est
 *     vrai. Les deux phrases se ressemblent et n'ont pas le même sens.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE SEUIL, ET POURQUOI 20 PLUTÔT QUE LE 5 DÉJÀ EN VIGUEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_quote_comparables` refuse déjà sous CINQ comparables, et on ne
 * pose pas un second seuil quand le produit en a un pour la même
 * question. Sauf que ce n'est pas la même question : cinq points
 * bornent une FOURCHETTE de valeurs, où un minimum et un maximum sont
 * déjà honnêtes. Un taux de transformation est une PROPORTION, et sur
 * vingt observations son intervalle à 95 % vaut encore ±22 points.
 * En dessous, le chiffre change de sens à chaque devis suivant.
 *
 * Le seuil est appliqué PAR LE SQL (`c_seuil_taux constant int := 20`,
 * `c_seuil_delai constant int := 8`, migration 0088), pas demandé au
 * modèle : une règle qu'on demande à un modèle est une règle qu'il peut
 * décider d'assouplir pour rendre service.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI RESTE À L'INTÉGRATION, ET CE FICHIER N'EST PAS BRANCHÉ SANS
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce constructeur ne touche AUCUN fichier partagé. Il manque donc, dans
 * le même commit :
 *
 *   1. `agents/types.ts` — « sales » dans `AGENTS_CONSTRUITS` et
 *      `CLE_BASE` (même graphie des deux côtés : `sales`).
 *   2. `agents/index.ts` — l'import de `AGENT_VENTES` et son entrée
 *      dans `TOUS`.
 *   3. `agents/sansDonnees.ts` — le RETRAIT de l'entrée « sales ».
 *   4. `runtime/tools.ts` — `OUTIL_SALES_FLOW` (voir `outils/sales.ts`)
 *      dans `OUTILS_LECTURE`.
 *   5. `lib/ai/types.ts` — `AGENT_LABELS`, `AGENT_MISSIONS` et
 *      `AGENT_REQUIRED_PERMISSIONS` recopient `libelle`, `mission` et
 *      `droitsAttendus` pour l'écran des réglages, et un test les
 *      compare mot pour mot.
 *   6. `runtime/context.ts` — une entrée `sales` dans `PLANS`, sans
 *      quoi le runner part sans source et refuse avant d'appeler le
 *      modèle. Le plan tient en une étape :
 *      `{ outil: "getSalesFlow", requis: true, arguments: PERIODE }`.
 *
 * Le geste 4 sans le geste 1 déclare un outil pour un agent que le type
 * ne connaît pas ; le geste 1 sans le geste 4 donne un agent achevé
 * sans source, que `definitions.test.ts` refuse — à juste titre.
 */

/**
 * §11Z, INTÉGRATION — L'ÉTAI DE COMPILATION A ÉTÉ RETIRÉ.
 *
 * Ce fichier portait un alias local, borné à la clé littérale, parce
 * que `DefinitionAgent.cle` n'acceptait que les dix agents de §11Y
 * et que « sales » n'y figurait pas encore. Il y figure : l'objet
 * ci-dessous s'annote donc `: DefinitionAgent` comme les douze autres.
 *
 * On ne l'a PAS remplacé par un `as DefinitionAgent` : une conversion
 * aurait éteint le contrôle pour de bon, y compris pour la faute
 * qu'il attrape vraiment — une définition rangée sous la clé du
 * voisin.
 */

export const AGENT_VENTES: DefinitionAgent = {
  cle: "sales",
  libelle: "Ventes",
  // NE PAS TOUCHER SANS TOUCHER `lib/ai/types.ts` : `AGENT_LABELS`,
  // `AGENT_MISSIONS` et `AGENT_REQUIRED_PERMISSIONS` recopient ces trois
  // champs pour l'écran des réglages, et un test les compare mot pour
  // mot. Deux libellés pour un agent, c'est un utilisateur qui croit
  // qu'il y en a deux.
  //
  // LA MISSION PORTE SA CLAUSE DE REFUS, ET CE N'EST PAS DU STYLE :
  // `mission` sert de `handoffDescription`, donc c'est sur elle que la
  // Direction décide à qui déléguer. Une mission qui promet des montants
  // ferait payer une délégation complète pour recevoir un renvoi.
  mission:
    "Ce que deviennent les devis une fois DÉCIDÉS : délai de réponse, transformation, motifs " +
    "de refus, pipeline d'opportunités et relances commerciales. Aucun montant, aucune " +
    "prévision, et rien sur les devis encore ouverts.",
  responsabilites:
    "Mesure la fenêtre qui va de l'envoi d'un devis à sa décision : combien de temps les " +
    "clients mettent à répondre, ce qu'ils signent, ce qu'ils refusent et pour quel motif. " +
    "Suit le pipeline d'opportunités du CRM et les relances commerciales en retard. " +
    "Chaque chiffre vient de « getSalesFlow », déjà calculé par le SQL ; aucun n'est " +
    "recompté. Et il NOMME ce que ce produit ne sait pas voir — l'ouverture réelle d'un " +
    "devis, la valeur d'un pipeline, la raison d'une perte jamais saisie — au lieu de le " +
    "compter à zéro.",
  limites: [
    // ─── LES TROIS FRONTIÈRES, ET ELLES SONT LE SUJET DE CET AGENT ───
    "NE PARLE JAMAIS D'UN DEVIS ENCORE OUVERT. Les devis qui dorment depuis plus de sept " +
      "jours et ceux qui expirent sous sept jours sont calculés par le briefing de direction " +
      "(ai_executive_brief, sections 2 et 3) et attribués au Chiffrage. Il les LIT dans " +
      "« renvoiDevisOuverts » et cite le briefing ; il ne les recompte jamais. Deux comptes " +
      "du même chiffre finissent par en donner deux différents.",
    "NE REND AUCUN MONTANT DE DEVIS, dans aucune fenêtre : ni prix, ni coût, ni marge, ni " +
      "total signé. Ils appartiennent au Chiffrage (ai_quote_price_analysis, quote_totals). " +
      "Il compte des devis et mesure des délais. « valeurEstimeeCents » du pipeline n'est PAS " +
      "un montant de devis : c'est une estimation saisie à la main sur une opportunité, et il " +
      "doit le dire chaque fois qu'il la cite.",
    "S'ARRÊTE À L'ACCEPTATION. Une fois le devis accepté, le dossier suit chez la " +
      "Facturation (ai_billing_candidates, dont la section 3 filtre status = accepted). Il " +
      "renvoie à la Facturation au lieu d'estimer ce qui reste à facturer.",
    // ─── L'ACTION QU'IL NE PROPOSE PAS ───
    "NE PROPOSE PAS DE RELANCER UN DEVIS. L'action est au catalogue sous « quoteFollowUp », " +
      "agent quote_pricing, droit quotes.edit. Il dit qui la porte et laisse la main ; " +
      "proposer une action qui ne lui appartient pas ferait deux endroits où l'on relance.",
    // ─── LE SEUIL, ET IL EST PORTÉ PAR LE SQL ───
    "NE PRONONCE AUCUN TAUX SOUS VINGT DÉCISIONS, ni aucun délai médian sous huit. Quand " +
      "« tauxDeSignaturePct » vaut null, « tauxMotif » dit pourquoi, et c'est cette phrase-là " +
      "qu'il rend : un taux calculé sur une décision vaudrait 100 %, serait exact, et ne " +
      "décrirait rien. Il donne les comptes bruts à la place.",
    // ─── LA PRÉVISION, INTERDITE COMME À LA DIRECTION ───
    "NE PRÉVOIT NI CHIFFRE D'AFFAIRES NI SIGNATURE À VENIR. Il ne multiplie jamais une " +
      "valeur estimée par une probabilité saisie au jugé : le produit aurait l'air d'une " +
      "prévision sans en être une. Le nombre d'opportunités PORTANT une probabilité est " +
      "rendu ; aucune moyenne, aucune valeur pondérée ne l'est.",
    // ─── LE PIÈGE MESURÉ DANS LE CODE, PAS DEVINÉ ───
    "NE DIT JAMAIS « le client n'a pas ouvert le devis ». « quotes.viewed_at » est une SAISIE " +
      "HUMAINE (lib/quotes/actions.ts : le champ n'est écrit que lorsqu'un humain passe le " +
      "devis au statut « vu »), et ce produit n'a AUCUN accusé de lecture. La seule phrase " +
      "autorisée est « personne n'a marqué ce devis comme vu ».",
    // ─── ZÉRO N'EST JAMAIS « RIEN N'A ÉTÉ SAISI » ───
    "NE COMPTE PAS À ZÉRO CE QUI N'A JAMAIS ÉTÉ SAISI. Un pipeline vide se lit « je n'ai " +
      "rien en cours » ; la vérité mesurée est « personne n'a jamais rempli l'écran " +
      "Opportunités ». Idem pour les activités du CRM et pour les motifs de refus : " +
      "« aucun refus enregistré » n'est pas « vous ne perdez jamais ». Les champs « motif » " +
      "et « ...TotalTouteHistoire » existent pour faire cette différence : il les lit avant " +
      "de conclure.",
    // ─── ET IL N'ÉCRIT RIEN ───
    "N'ÉCRIT RIEN. Il ne crée pas d'opportunité, ne change pas d'étape, ne clôt pas une " +
      "activité et n'envoie aucun devis : aucun outil d'action ne lui appartient. Il dit où " +
      "se trouve l'écran qui le fait.",
  ],
  // Les deux gardes de `ai_sales_flow`, dans l'ordre où elle les pose :
  // `ai_guard(org, 'projects.read')` puis `ai_guard(org, 'quotes.read')`.
  // Les deux LÈVENT — un flux commercial amputé se lirait comme un flux
  // commercial vide, ce qui est une réponse fausse et non incomplète.
  droitsAttendus: ["projects.read", "quotes.read"],
  /**
   * LES MOTS QUI L'APPELLENT — ET LES TROIS QU'IL NE PREND PAS.
   *
   * Sa place dans l'ORDRE (`app/api/oasis-ai/aiguillage.ts`) est JUSTE
   * APRÈS la Facturation et AVANT le Chiffrage. Ce placement est ce qui
   * rend la liste ci-dessous sûre, et il est justifié là-bas.
   *
   * ─── « relanc » NU EST INTERDIT ───
   *
   * Il attraperait « relancer ce devis » (Chiffrage, qui porte l'action
   * `quoteFollowUp`) et « relance de paiement » (Facturation, qui porte
   * l'argent). D'où les deux locutions complètes, au singulier ET au
   * pluriel : la comparaison est une SOUS-CHAÎNE, et « relance
   * commerciale » n'est pas contenue dans « relances commerciales ».
   *
   * ─── « affaire » NU EST INTERDIT ───
   *
   * Il est contenu dans « chiffre d'affaires », qui appartient à la
   * Finance — placée APRÈS lui. Mesuré en exécutant le vrai
   * `aiguiller()` : le mot nu volait « quel est mon chiffre d'affaires ».
   * D'où les locutions. Et « affaire en cours » n'y figure PAS non
   * plus : une affaire en cours est la fenêtre OUVERTE, qui appartient
   * au briefing de direction — la prendre ici recréerait le doublon que
   * tout ce fichier existe pour éviter.
   *
   * ─── LE PLURIEL S'ÉCRIT, PARCE QUE LA COMPARAISON EST LITTÉRALE ───
   *
   * L'aiguilleur cherche une SOUS-CHAÎNE contiguë. Un « s » ajouté à la
   * FIN d'une locution est donc gratuit — « devis signes » contient
   * « devis signe » — mais un « s » ajouté au PREMIER mot casse tout :
   * « motifs de refus » ne contient pas « motif de refus ». Les
   * locutions dont le premier mot se met au pluriel sont donc écrites
   * DEUX FOIS. Ce n'est pas de la redondance décorative : le défaut a
   * été mesuré en rejouant l'aiguilleur, et il existe déjà ailleurs
   * dans le dépôt (voir le compte rendu de ce chantier).
   *
   * ─── « devis » NU EST AU CHIFFRAGE, ET IL Y RESTE ───
   *
   * Les locutions « devis signe » et « devis refus » sont plus LONGUES
   * que « devis » : une question qui ne dit que « devis » passe donc au
   * Chiffrage, essayé juste après. C'est la règle générale de cet
   * aiguilleur — le mot le plus long gagne quand son propriétaire est
   * essayé le premier — et `agents/classification.ts` la vérifie pour
   * tout le monde.
   */
  motsCles: [
    "pipeline",
    "prospect",
    "opportunit",
    "negoci",
    "cycle de vente",
    "cycles de vente",
    // « taux » est invariant : une seule graphie suffit.
    "taux de transformation",
    "taux de signature",
    "taux de conversion",
    "relance commerciale",
    "relances commerciales",
    "affaire signee",
    "affaires signees",
    "affaire perdue",
    "affaires perdues",
    // « devis » est invariant, et le « s » de « signés » / « refusés »
    // tombe à la fin : ces deux-là couvrent le singulier et le pluriel.
    "devis signe",
    "devis refus",
    "motif de refus",
    "motifs de refus",
  ],
};
