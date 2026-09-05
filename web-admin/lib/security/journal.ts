import type { Tone } from "@/components/ui";

/**
 * ==================================================================
 * LE VOCABULAIRE DU JOURNAL DES ACTIONS ADMINISTRATIVES
 * ==================================================================
 *
 * Spec p.31 : « Toute action administrative importante doit être
 * enregistrée. » `admin_audit_events` le fait depuis 0075 ; ce fichier
 * traduit ce qu'elle contient.
 *
 * ------------------------------------------------------------------
 * IL N'Y A PAS DE CATALOGUE D'ACTIONS EN BASE, ET C'EST UN FAIT
 * ------------------------------------------------------------------
 * `action` est une colonne `text` libre : aucune table ne liste les
 * valeurs possibles, aucune contrainte ne les borne. La carte ci-dessous
 * est donc RECOPIÉE des migrations — 0075 en écrit une, 0080 quatre,
 * 0081 vingt-neuf — et elle sera incomplète le jour où une migration en
 * ajoutera une trente-cinquième.
 *
 * C'est pourquoi `libelleAction()` retombe sur la valeur BRUTE et non
 * sur « action inconnue ». Une trace dont l'écran ne connaît pas le nom
 * reste parfaitement lisible sous son nom technique ; la remplacer par
 * « inconnue » détruirait l'information qu'on venait chercher, et un
 * journal d'audit vaut par son exactitude.
 *
 * Aucune base, aucun Next : ce fichier est éprouvable seul, et il l'est
 * (`journal.test.ts`).
 */

/**
 * Les trente-quatre actions écrites par les migrations 0075, 0080 et 0081.
 *
 * Elles sont regroupées par migration d'origine plutôt que par ordre
 * alphabétique : quand une action manque à l'appel, la question utile
 * est « quelle migration l'écrit », et le classement y répond.
 */
export const LIBELLES_ACTION: Readonly<Record<string, string>> = Object.freeze({
  // 0075 — le socle
  "platformAdmin.created": "Administrateur nommé",

  // 0080 — la gouvernance de l'IA
  "aiModel.overrideSet": "Modèle d'agent imposé",
  "aiModel.overrideCleared": "Surcharge de modèle levée",
  "aiCostLimit.set": "Plafonds de dépense IA posés",
  "aiCostLimit.cleared": "Plafonds de dépense IA retirés",

  // 0081 § 2 — le second facteur
  "security.mfaPolicyChanged": "Politique de second facteur modifiée",

  // 0081 § 3 — l'équipe Oasis Care
  "platformAdmin.roleChanged": "Rôle d'un administrateur changé",
  "platformAdmin.revoked": "Administrateur révoqué",
  "platformAdmin.reinstated": "Administrateur rétabli",
  "platformAdmin.invited": "Collègue invité",
  "platformAdmin.invitationRevoked": "Invitation retirée",
  "platformAdmin.invitationAccepted": "Invitation acceptée",

  // 0081 § 4 — la grille tarifaire
  "plan.pricingChanged": "Tarif d'une offre modifié",
  "plan.moduleTermsChanged": "Case offre × module modifiée",

  // 0081 § 5 — les abonnements
  "subscription.created": "Abonnement créé à la main",
  "subscription.planChanged": "Changement d'offre",
  "subscription.trialExtended": "Essai prolongé",
  "subscription.creditGranted": "Avoir commercial accordé",
  "subscription.moduleActivated": "Module activé",
  "subscription.moduleDeactivated": "Module désactivé",
  "subscription.cancelledAtPeriodEnd": "Résiliation à l'échéance",
  "subscription.reactivated": "Abonnement réactivé",
  "subscription.discountApplied": "Remise appliquée",

  // 0081 § 6 — la facturation SaaS
  "billing.issuerChanged": "Identité légale de l'émetteur modifiée",
  "billing.taxProfileChanged": "Régime de TVA d'un client modifié",
  "saasInvoice.issued": "Facture émise",
  "saasInvoice.paymentRecorded": "Encaissement enregistré",
  "saasInvoice.draftCancelled": "Brouillon de facture annulé",
  "saasInvoice.credited": "Avoir émis",

  // 0081 § 7 — les drapeaux
  "featureFlag.toggled": "Drapeau de fonctionnalité basculé",
  "commercialConfig.changed": "Réglage commercial modifié",

  // 0081 § 8 — l'assistance
  "supportTicket.replied": "Réponse à une demande d'assistance",
  "supportSession.started": "Session d'assistance ouverte",
  "supportSession.revoked": "Session d'assistance révoquée",
});

export function libelleAction(action: string): string {
  return LIBELLES_ACTION[action] ?? action;
}

/**
 * ==================================================================
 * LES SIX FAMILLES DE LA SPEC p.29
 * ==================================================================
 *
 * Le centre de sécurité demande six choses. TROIS d'entre elles se
 * lisent dans `admin_audit_events`, et les regrouper est exactement le
 * travail de ce bloc :
 *
 *   • « permission changes » → la famille `droits`
 *   • « admin actions »      → tout le reste
 *   • « support sessions »   → la famille `assistance`
 *
 * Les trois autres — connexions échouées, sessions suspectes, anomalies
 * d'API — n'ont AUCUNE source dans cette base. Elles sont traitées dans
 * `inconnus.ts`, et pas ici : on ne fabrique pas une famille vide pour
 * faire nombre.
 */
export type FamilleAction =
  | "droits"
  | "assistance"
  | "argent"
  | "produit"
  | "ia"
  | "autre";

/**
 * À quelle famille appartient une action.
 *
 * LE CLASSEMENT SE FAIT SUR LE PRÉFIXE, jamais sur la liste des
 * libellés ci-dessus. Une action inconnue de l'interface mais préfixée
 * `platformAdmin.` est un changement de droits, et doit apparaître dans
 * la surveillance des droits même si personne n'a encore écrit son
 * libellé. Classer depuis la carte des libellés ferait disparaître de
 * l'écran de sécurité l'action la plus intéressante : la nouvelle.
 */
export function familleAction(action: string): FamilleAction {
  if (action.startsWith("platformAdmin.") || action.startsWith("security.")) return "droits";
  if (action.startsWith("supportSession.") || action.startsWith("supportTicket.")) {
    return "assistance";
  }
  if (
    action.startsWith("saasInvoice.") ||
    action.startsWith("billing.") ||
    action.startsWith("subscription.") ||
    action.startsWith("plan.")
  ) {
    return "argent";
  }
  if (action.startsWith("featureFlag.") || action.startsWith("commercialConfig.")) {
    return "produit";
  }
  if (action.startsWith("ai")) return "ia";
  return "autre";
}

export const LIBELLES_FAMILLE: Record<FamilleAction, string> = {
  droits: "Droits et administrateurs",
  assistance: "Assistance",
  argent: "Argent",
  produit: "Produit",
  ia: "IA de l'éditeur",
  autre: "Autres",
};

export const DESCRIPTIONS_FAMILLE: Record<FamilleAction, string> = {
  droits:
    "Nominations, changements de rôle, révocations, invitations, politique de second facteur. C'est « permission changes » de la spec p.29, et la famille qu'un responsable sécurité relit en premier.",
  assistance:
    "Ouvertures et révocations de sessions d'accès, réponses aux demandes. Voir aussi le journal d'accès de chaque session, qui dit ce qui a été REGARDÉ — cette liste-ci ne dit que ce qui a été OUVERT.",
  argent:
    "Tarifs, abonnements, remises, factures, encaissements, identité de l'émetteur. Tout ce qui change un montant ou un document comptable.",
  produit: "Drapeaux de fonctionnalité et réglages commerciaux.",
  ia: "Modèles imposés et plafonds de dépense IA — ce que l'éditeur paie au fournisseur.",
  autre: "Actions dont le préfixe n'est connu d'aucune famille de cette interface.",
};

/**
 * Le ton d'une action dans une liste.
 *
 * LA COULEUR SUIT CE QU'ON VOUDRAIT REMARQUER EN PARCOURANT, pas la
 * gravité morale. Trois gestes RETIRENT une protection — révoquer un
 * administrateur, lever un plafond de dépense, retirer un plafond
 * IA — et deux en POSENT une (révoquer une session, c'est fermer).
 *
 * On ne peint donc PAS en rouge « session révoquée » : couper un accès
 * est un bon geste, et l'alarmer découragerait de le faire. Le rouge
 * est réservé à ce qui ÉLARGIT un droit ou en supprime la borne.
 */
export function tonAction(action: string): Tone {
  const elargit =
    action === "platformAdmin.created" ||
    action === "platformAdmin.roleChanged" ||
    action === "platformAdmin.reinstated" ||
    action === "platformAdmin.invitationAccepted" ||
    action === "aiCostLimit.cleared" ||
    action === "supportSession.started";
  if (elargit) return "critical";

  if (action === "security.mfaPolicyChanged") return "warning";
  if (familleAction(action) === "argent") return "warning";
  if (familleAction(action) === "assistance") return "info";
  return "accent";
}

/**
 * Est-ce un changement de DROITS au sens de la spec p.29 ?
 *
 * Utilisé par le centre de sécurité pour compter. La question est
 * distincte de `familleAction() === "droits"` par une seule chose, et
 * elle compte : une invitation RETIRÉE n'accorde aucun droit — elle en
 * reprend un qui n'avait pas encore pris effet. La compter parmi les
 * « changements de permissions » gonflerait un indicateur qu'on relit
 * précisément pour repérer les élargissements.
 */
export function estChangementDeDroits(action: string): boolean {
  return familleAction(action) === "droits" && action !== "platformAdmin.invitationRevoked";
}

/**
 * Les familles proposées comme filtres, dans l'ordre de lecture d'un
 * responsable sécurité : d'abord qui a reçu quel droit, ensuite qui est
 * entré chez qui, ensuite l'argent.
 */
export const FAMILLES_ORDONNEES: readonly FamilleAction[] = [
  "droits",
  "assistance",
  "argent",
  "ia",
  "produit",
  "autre",
];

export function estFamille(valeur: unknown): valeur is FamilleAction {
  return (
    typeof valeur === "string" && (FAMILLES_ORDONNEES as readonly string[]).includes(valeur)
  );
}

/**
 * Les préfixes d'une famille, pour filtrer EN BASE.
 *
 * On ne peut pas envoyer `familleAction()` à PostgREST : il faut lui
 * donner des motifs. Cette table est donc le miroir de la fonction, et
 * `journal.test.ts` vérifie que les deux disent la même chose — sans
 * quoi le filtre « Droits » de l'écran et le regroupement des chiffres
 * finiraient par ne plus désigner le même ensemble.
 */
export const PREFIXES_FAMILLE: Record<FamilleAction, readonly string[]> = {
  droits: ["platformAdmin.", "security."],
  assistance: ["supportSession.", "supportTicket."],
  argent: ["saasInvoice.", "billing.", "subscription.", "plan."],
  produit: ["featureFlag.", "commercialConfig."],
  ia: ["ai"],
  autre: [],
};
