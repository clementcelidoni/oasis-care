import type { OrganizationContext } from "@/lib/auth/organization";
import type { Permission } from "@/lib/auth/permissions";

/**
 * POURQUOI LES DEUX IMPORTS SERVEUR SONT DIFFÉRÉS, PLUS BAS, DANS LES
 * FONCTIONS QUI S'EN SERVENT.
 *
 * Ce fichier porte deux choses : le vocabulaire du laboratoire — des
 * tables de libellés et des fonctions pures — et les lectures qui vont
 * chercher les données. Les tests tournent sous `node --test`, qui ne
 * connaît pas l'alias `@/` du tsconfig. Un `import { createClient } from
 * "@/lib/supabase/server"` en tête de fichier rendrait donc TOUT ce
 * fichier inéprouvable, y compris le vocabulaire et le tri des points
 * d'attention, qui ne touchent pourtant ni base ni réseau.
 *
 * Les charger à l'intérieur des fonctions règle cela sans rien changer
 * en production : Next les résout au premier appel, et les tests, qui
 * n'appellent jamais ces fonctions-là, ne les chargent pas. Le type
 * ci-dessus, lui, reste statique — un `import type` est effacé avant
 * l'exécution.
 */

/**
 * §6 / §7 — LE VOCABULAIRE DU LABORATOIRE, ET LE PÉRIMÈTRE QUI LE PORTE.
 *
 * Ce fichier ne définit RIEN de neuf. Chaque valeur énumérée ci-dessous
 * est recopiée, mot pour mot, du modèle Swift qui l'écrit déjà dans la
 * base — `CultureStage`, `CultureBatchStatus`, `ContaminationStatus`,
 * `ObservedSeverity`, `AcclimatizationStatus`, `CultureSystem`,
 * `BioLabAlertType`, `BioLabAlertPriority`. Le §6 est explicite : « il
 * ne faut pas créer deux systèmes BioLab indépendants ». Une deuxième
 * table de libellés qui dériverait de la première serait exactement ce
 * second système, en plus discret.
 *
 * Chemin des fichiers d'origine, pour que la vérification soit possible
 * sans chercher : `OasisCare/BioLab/Models/*.swift`.
 */

// ==================================================================
// 1. LE PÉRIMÈTRE — QUEL ESPACE, ET QUI A LE DROIT
// ==================================================================

/**
 * LES TROIS PERMISSIONS BIOLAB.
 *
 * La migration 0087 les sème dans `role_permissions` (manager et
 * nurseryManager : les trois ; nurseryWorker : lecture et écriture ;
 * readOnly : lecture ; rien pour l'ouvrier de terrain), et
 * `lib/auth/permissions.ts` les déclare désormais dans `PERMISSIONS` et
 * les répartit dans `ROLE_PERMISSIONS` à l'identique.
 *
 * LES DEUX LISTES NE PEUVENT PLUS DIVERGER EN SILENCE :
 * `lib/auth/permissions.test.ts` relit les `insert into
 * public.role_permissions` des migrations et échoue si une seule case
 * diffère. C'est le test que le commentaire de `permissions.ts`
 * promettait depuis l'origine sans qu'il ait jamais été écrit — et son
 * absence est exactement ce qui a laissé ces trois clés déclarées d'un
 * côté, ignorées de l'autre, pendant tout le chantier.
 *
 * Elles restent typées `Permission`, donc une faute de frappe ne
 * compile pas.
 */
export const PERMISSION_BIOLAB_LIRE: Permission = "biolab.read";
export const PERMISSION_BIOLAB_ECRIRE: Permission = "biolab.write";
export const PERMISSION_BIOLAB_GERER: Permission = "biolab.manage";

/** La clé du module dans `platform_modules` / `plan_modules` (0081). */
export const MODULE_BIOLAB = "biolab";

export type PerimetreBioLab = {
  organisation: OrganizationContext;
  /**
   * L'espace de travail de l'ENTREPRISE, et rien d'autre.
   *
   * Jamais l'espace personnel du dirigeant, même si c'est là que vivent
   * ses cultures aujourd'hui : les 21 politiques BioLab sont en
   * `cmd = ALL`, donc lire l'espace privé reviendrait à donner à toute
   * l'entreprise l'écriture et la suppression sur le laboratoire d'une
   * personne. `lib/twin/workspace.ts` explique le même piège pour le
   * jumeau numérique ; ici il serait plus grave.
   *
   * Quand cet espace est vide alors que les cultures existent ailleurs,
   * la réponse est l'état vide honnête de `/biolab`, pas un changement
   * de périmètre.
   */
  workspaceId: string;
  peutLire: boolean;
  peutEcrire: boolean;
  peutGerer: boolean;
  /**
   * §43 — l'entreprise a éteint elle-même le module.
   *
   * SÉPARÉ DE `peutLire` À DESSEIN. « Vous n'avez pas le droit » et
   * « votre entreprise n'utilise pas ce module » demandent deux gestes
   * différents : le premier s'adresse à un responsable, le second à
   * l'écran des réglages. Les confondre enverrait quelqu'un réclamer
   * une permission qu'il a déjà.
   */
  moduleEteint: boolean;
};

/**
 * Le périmètre BioLab d'un écran : l'entreprise active, son espace, et
 * ce que l'utilisateur a le droit d'y faire.
 *
 * UN SEUL ENDROIT, délibérément. Le constat du chantier demandait que
 * le droit au module soit vérifié « proprement et en un seul endroit » ;
 * c'est ici. Tous les écrans BioLab passent par cette fonction, aucun ne
 * refait le calcul.
 *
 * CE QUI N'EST PAS VÉRIFIÉ ICI, ET POURQUOI — L'ABONNEMENT.
 * `plan_modules` tarifie bien la clé « biolab » (inclus dans Business,
 * 20 €/mois en option sur Team), mais `organization_subscriptions`
 * compte ZÉRO ligne en production et `organization_subscription_modules`
 * aussi. Refuser l'écran à qui n'a pas d'abonnement enregistré
 * refuserait donc l'écran à TOUT LE MONDE, y compris au propriétaire du
 * produit. Ce serait une panne, pas un contrôle.
 *
 * La place de ce contrôle est nommée, pas bricolée : le jour du « lot
 * 4 », la conjonction s'ajoute ICI — une lecture de
 * `organization_subscription_modules` (voir
 * `lib/billing/source-supabase.ts`, `lireModulesSouscrits`) comparée à
 * `MODULE_BIOLAB` — et son pendant descend dans
 * `biolab_workspace_allows` côté base, comme le §1.4 de la migration
 * 0087 l'annonce. Un seul prédicat, deux endroits, jamais une deuxième
 * fonction.
 *
 * CE QUI EST VÉRIFIÉ ICI EN REVANCHE, ET QUI NE L'ÉTAIT PAS : LE
 * DÉBRAYAGE §43. `business_organizations.disabled_modules` ne servait
 * qu'à tailler la barre latérale dans `app/(app)/layout.tsx` ; taper
 * `/biolab/lots` dans la barre d'adresse ouvrait donc l'écran d'un
 * module éteint. Un interrupteur qui n'éteint que la lumière du couloir
 * n'est pas un interrupteur. Le contrôle est ici, au même endroit que
 * la permission, et pas dans chacune des seize pages.
 *
 * ET CE QUE CE CONTRÔLE NE PROTÈGE TOUJOURS PAS, écrit sans détour : ni
 * lui ni la permission d'écran ne sont une frontière. `NEXT_PUBLIC_…`
 * expose l'adresse Supabase et la clé publiable, la session vit dans un
 * cookie : un salarié connecté peut interroger PostgREST directement.
 * La seule frontière réelle est la RLS — c'est-à-dire, pour BioLab, les
 * politiques restrictives du §2 de 0087. Le §20 de l'architecture
 * demande les deux (« UI, API, backend, Supabase, RLS ») et les deux
 * existent : celle-ci range, celle-là refuse.
 */
export async function perimetreBioLab(): Promise<PerimetreBioLab> {
  const { requireOrganization } = await import("@/lib/auth/organization");
  const { createClient } = await import("@/lib/supabase/server");
  const organisation = await requireOrganization();

  const detenues = organisation.permissions as readonly string[];

  const supabase = await createClient();
  const { data: profil } = await supabase
    .from("business_organizations")
    .select("disabled_modules")
    .eq("id", organisation.organizationId)
    .maybeSingle();

  // Une lecture qui échoue ne doit pas fermer le module : on n'éteint
  // que sur une réponse explicite. Refuser l'écran parce qu'une requête
  // annexe a échoué serait une panne déguisée en réglage.
  const eteints = ((profil?.disabled_modules ?? []) as string[]) ?? [];

  return {
    organisation,
    workspaceId: organisation.workspaceId,
    peutLire: detenues.includes(PERMISSION_BIOLAB_LIRE),
    peutEcrire: detenues.includes(PERMISSION_BIOLAB_ECRIRE),
    peutGerer: detenues.includes(PERMISSION_BIOLAB_GERER),
    moduleEteint: eteints.includes(MODULE_BIOLAB),
  };
}

// ==================================================================
// 2. LES STADES, LES ÉTATS, LES OBSERVATIONS
// ==================================================================

export type Ton = "neutral" | "accent" | "positive" | "warning" | "critical" | "info";

/** `CultureStage` — le stade BIOLOGIQUE de la culture. */
export const STADES = [
  "initiation",
  "multiplication",
  "elongation",
  "rooting",
  "preAcclimatization",
  "acclimatization",
  "completed",
  "discarded",
] as const;
export type Stade = (typeof STADES)[number];

export const STADE_LABELS: Record<Stade, string> = {
  initiation: "Initiation",
  multiplication: "Multiplication",
  elongation: "Élongation",
  rooting: "Enracinement",
  preAcclimatization: "Pré-acclimatation",
  acclimatization: "Acclimatation",
  completed: "Terminé",
  discarded: "Écarté",
};

/**
 * La couleur suit l'AVANCEMENT, pas l'humeur : un lot en initiation
 * n'est pas « en attente », il commence. Seul « écarté » est rouge,
 * parce qu'il désigne une perte réelle.
 */
export const STADE_TON: Record<Stade, Ton> = {
  initiation: "info",
  multiplication: "accent",
  elongation: "accent",
  rooting: "accent",
  preAcclimatization: "warning",
  acclimatization: "warning",
  completed: "positive",
  discarded: "critical",
};

/** `CultureBatchStatus` — l'état du LOT, distinct de son stade. */
export const STATUTS_LOT = ["active", "paused", "split", "completed", "discarded"] as const;
export type StatutLot = (typeof STATUTS_LOT)[number];

export const STATUT_LOT_LABELS: Record<StatutLot, string> = {
  active: "Actif",
  paused: "En pause",
  split: "Divisé",
  completed: "Terminé",
  discarded: "Écarté",
};

export const STATUT_LOT_TON: Record<StatutLot, Ton> = {
  active: "positive",
  paused: "warning",
  // « Divisé » n'est pas un échec : le lot a passé la main à ses
  // sous-lots et garde son compte d'alors comme fait historique. Le
  // teinter en rouge ferait croire à une perte.
  split: "info",
  completed: "neutral",
  discarded: "critical",
};

/**
 * `ContaminationStatus`. Le commentaire du modèle Swift est un ordre :
 * « ne jamais demander à l'IA de déclarer automatiquement une
 * contamination comme certitude ». « Confirmée » est le jugement d'un
 * humain. L'écran ne doit donc jamais fondre « suspectée » et
 * « confirmée » dans un même chiffre.
 */
export const CONTAMINATIONS = ["noneObserved", "suspected", "confirmed", "unknown"] as const;
export type Contamination = (typeof CONTAMINATIONS)[number];

export const CONTAMINATION_LABELS: Record<Contamination, string> = {
  noneObserved: "Aucune observée",
  suspected: "Suspectée",
  confirmed: "Confirmée",
  unknown: "Inconnue",
};

export const CONTAMINATION_TON: Record<Contamination, Ton> = {
  noneObserved: "positive",
  suspected: "warning",
  confirmed: "critical",
  unknown: "neutral",
};

/** `ObservedSeverity` — hyperhydricité, nécrose, brunissement. */
export const SEVERITES = ["none", "mild", "moderate", "severe", "unknown"] as const;
export type Severite = (typeof SEVERITES)[number];

export const SEVERITE_LABELS: Record<Severite, string> = {
  none: "Aucune",
  mild: "Légère",
  moderate: "Modérée",
  severe: "Sévère",
  unknown: "Inconnue",
};

export const SEVERITE_TON: Record<Severite, Ton> = {
  none: "positive",
  mild: "warning",
  moderate: "warning",
  severe: "critical",
  unknown: "neutral",
};

/** `AcclimatizationStatus`. */
export const STATUTS_ACCLIMATATION = ["active", "completed", "abandoned"] as const;
export type StatutAcclimatation = (typeof STATUTS_ACCLIMATATION)[number];

export const STATUT_ACCLIMATATION_LABELS: Record<StatutAcclimatation, string> = {
  active: "En cours",
  completed: "Terminée",
  abandoned: "Abandonnée",
};

export const STATUT_ACCLIMATATION_TON: Record<StatutAcclimatation, Ton> = {
  active: "accent",
  completed: "positive",
  abandoned: "critical",
};

/** `CultureSystem` — l'état physique du milieu, connu avant tout bioréacteur. */
export const SYSTEMES = [
  "solid",
  "semiSolid",
  "liquid",
  "temporaryImmersion",
  "continuousImmersion",
  "custom",
] as const;
export type Systeme = (typeof SYSTEMES)[number];

export const SYSTEME_LABELS: Record<Systeme, string> = {
  solid: "Solide",
  semiSolid: "Semi-solide",
  liquid: "Liquide",
  temporaryImmersion: "Immersion temporaire",
  continuousImmersion: "Immersion continue",
  custom: "Personnalisé",
};

/** `BioLabAlertPriority`. */
export const PRIORITES = ["info", "warning", "important", "critical"] as const;
export type Priorite = (typeof PRIORITES)[number];

export const PRIORITE_LABELS: Record<Priorite, string> = {
  info: "Information",
  warning: "Avertissement",
  important: "Important",
  critical: "Critique",
};

export const PRIORITE_TON: Record<Priorite, Ton> = {
  info: "info",
  warning: "warning",
  important: "warning",
  critical: "critical",
};

/** `BioLabAlertType`. */
export const ALERTE_LABELS: Record<string, string> = {
  missedCycle: "Cycle manqué",
  cycleTooLong: "Cycle trop long",
  unresponsivePump: "Pompe non répondante",
  abnormalPressure: "Pression anormale",
  abnormalFlow: "Débit anormal",
  abnormalMediumLevel: "Niveau de milieu anormal",
  sensorOffline: "Capteur hors ligne",
  temperatureOutOfRange: "Température hors seuil",
  lateInspection: "Inspection en retard",
  mediumChangeDue: "Changement de milieu prévu",
  suspectedContamination: "Contamination suspectée",
};

/** `BioLabAuditAction` — les trois actions que le téléphone journalise. */
export const HISTORIQUE_ACTION_LABELS: Record<string, string> = {
  versioned: "Nouvelle version",
  split: "Division du lot",
  stage_changed: "Changement de stade",
};

/**
 * `biolab_audit_entries.entity_type` porte le nom de TABLE Postgres —
 * convention du modèle Swift, pour que le journal survive au
 * renommage d'un type. On le retraduit ici en mot de producteur.
 */
export const HISTORIQUE_OBJET_LABELS: Record<string, string> = {
  culture_batches: "Lot de culture",
  medium_recipes: "Recette de milieu",
  medium_recipe_versions: "Version de recette",
  medium_batches: "Préparation de milieu",
  acclimatization_batches: "Acclimatation",
  bioreactors: "Bioréacteur",
  bioreactor_inspections: "Inspection",
};

/**
 * Un libellé sûr pour une valeur venue de la base.
 *
 * Le téléphone peut écrire demain un stade que ce fichier ne connaît
 * pas. Afficher la valeur brute est laid mais VRAI ; afficher « — »
 * effacerait une information réelle, et planter serait pire encore.
 */
export function libelle<T extends string>(
  table: Record<T, string> | Record<string, string>,
  valeur: string | null | undefined,
  defaut = "—",
): string {
  if (!valeur) return defaut;
  return (table as Record<string, string>)[valeur] ?? valeur;
}

export function tonDe<T extends string>(
  table: Record<T, Ton> | Record<string, Ton>,
  valeur: string | null | undefined,
): Ton {
  if (!valeur) return "neutral";
  return (table as Record<string, Ton>)[valeur] ?? "neutral";
}

// ==================================================================
// 3. LES FORMATS — METTRE EN FORME N'EST PAS CALCULER
// ==================================================================

/**
 * Tous les taux et toutes les moyennes affichés par BioLab sont
 * calculés par Postgres, dans les lectures posées par la migration
 * 0087. Les fonctions ci-dessous ne font que les METTRE EN FORME :
 * aucune n'additionne, aucune ne divise, aucune ne moyenne. C'est la
 * règle « deux arrondis valent deux chiffres » — s'il n'y a qu'un
 * calcul, il n'y a qu'un chiffre possible.
 *
 * `numeric` en Postgres arrive parfois en nombre, parfois en chaîne
 * selon la sérialisation : d'où l'acceptation des deux, plutôt qu'un
 * `NaN` silencieux à l'écran.
 */
function nombreOuNull(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const n = typeof valeur === "string" ? Number.parseFloat(valeur) : valeur;
  return Number.isFinite(n) ? n : null;
}

const ENTIER = new Intl.NumberFormat("fr-FR");

export function formatNombre(valeur: number | string | null | undefined): string | null {
  const n = nombreOuNull(valeur);
  return n === null ? null : ENTIER.format(n);
}

/**
 * Un taux 0..1 en pourcentage.
 *
 * Rend `null` — jamais « 0 % » — quand la base a rendu NULL. Les six
 * lectures de 0087 rendent délibérément NULL pour un taux inconnu, et
 * les cartes du système d'interface affichent alors un tiret : « 0 % de
 * contamination » et « aucune inspection pour en juger » sont deux
 * affirmations différentes, et l'une des deux serait fausse.
 */
export function formatPourcentage(valeur: number | string | null | undefined): string | null {
  const n = nombreOuNull(valeur);
  if (n === null) return null;
  return `${(n * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/**
 * Le rendement de multiplication : explants aujourd'hui rapportés aux
 * explants de départ. Ce n'est PAS un pourcentage — « ×3,4 » est le mot
 * du métier, « 340 % » ne se dit pas devant un bocal.
 */
export function formatFacteur(valeur: number | string | null | undefined): string | null {
  const n = nombreOuNull(valeur);
  if (n === null) return null;
  return `×${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}

/** Une durée en secondes, telle que la base la rend, en mots. */
export function formatDuree(valeur: number | string | null | undefined): string | null {
  const n = nombreOuNull(valeur);
  if (n === null) return null;
  const secondes = Math.round(n);
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, "0")}`;
}

/**
 * LE FUSEAU DU LABORATOIRE, ÉCRIT UNE FOIS.
 *
 * Sans lui, toutes les dates de BioLab étaient rendues dans le fuseau
 * du processus Node — inconnu, non garanti, et différent de celui que
 * la base emploie : `biolab_tableau_de_bord` reçoit explicitement
 * `p_fuseau = 'Europe/Paris'` pour compter « les gestes du jour » comme
 * le téléphone les compte. La même page mélangeait donc deux horloges.
 * Mesuré sur la valeur réelle de production
 * (`bioreactors.updated_at = 2026-09-02 15:03:52+00`) : « 15:03 » sous
 * TZ=UTC, « 17:03 » sous TZ=Europe/Paris — et un pied de page qui
 * annonçait « lue à 22:30 » la veille du jour affiché.
 *
 * C'est la même convention que le reste de web-pro, qui fixe
 * Europe/Paris partout (`app/(app)/(dashboard)/queries.ts`,
 * `lib/field/types.ts`, `lib/billing/composition.ts`…). Le produit n'a
 * pas encore de constante partagée pour cela ; le jour où il s'ouvrira
 * à un autre fuseau, c'est cette ligne-ci qu'il faudra remplacer par
 * la préférence de l'entreprise, et le même changement devra descendre
 * dans le `p_fuseau` passé à la base.
 */
export const FUSEAU_LABORATOIRE = "Europe/Paris";

/** Le jour et le mois, pour la colonne d'heure d'une frise. */
export function formatJourCourt(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  return new Date(valeur).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: FUSEAU_LABORATOIRE,
  });
}

export function formatDateHeure(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  return new Date(valeur).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSEAU_LABORATOIRE,
  });
}

/** L'heure seule, pour dater le rendu d'une page. */
export function formatHeure(valeur: Date): string {
  return valeur.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSEAU_LABORATOIRE,
  });
}

/**
 * Depuis combien de temps, en mots.
 *
 * Sert à DATER ce qu'on affiche. Le §9 demande que le web reflète
 * immédiatement ce que le téléphone a fait ; rien ne le porte
 * aujourd'hui — la publication `supabase_realtime` ne contient aucune
 * table. La seule honnêteté possible est donc de dire QUAND la valeur
 * montrée a été écrite, et de ne jamais écrire « en direct ».
 */
export function formatAnciennete(
  valeur: string | null | undefined,
  maintenant: Date = new Date(),
): string | null {
  if (!valeur) return null;
  const instant = new Date(valeur).getTime();
  if (!Number.isFinite(instant)) return null;
  const secondes = Math.round((maintenant.getTime() - instant) / 1000);
  if (secondes < 0) return "à l'instant";
  if (secondes < 90) return "il y a moins d'une minute";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  if (jours < 31) return `il y a ${jours} j`;
  return `le ${new Date(valeur).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: FUSEAU_LABORATOIRE })}`;
}

/** Le nombre de jours entiers écoulés depuis une date. */
export function joursDepuis(valeur: string, maintenant: Date = new Date()): number {
  const instant = new Date(valeur).getTime();
  if (!Number.isFinite(instant)) return 0;
  return Math.floor((maintenant.getTime() - instant) / 86_400_000);
}

// ==================================================================
// 4. LE TABLEAU DE BORD — CE QUI DEMANDE UNE ACTION
// ==================================================================

/**
 * UNE LECTURE, RÉUSSIE OU NON — LE CONTRAT DE TOUT LE MODULE.
 *
 * Il vivait dans `lib/biolab/statistiques.ts` et n'était employé que
 * par la moitié des fichiers ; l'autre moitié — le socle, c'est-à-dire
 * les lectures les plus visibles — jetait l'erreur et rendait une liste
 * vide. Une liste vide s'affiche ensuite comme une AFFIRMATION : « ce
 * lot n'a ni parent ni sous-lot », « aucune culture dans cette
 * entreprise ». Le tableau de bord allait jusqu'à en déduire un
 * diagnostic — « vos cultures sont dans un espace personnel » — sur la
 * foi d'une requête qui avait échoué.
 *
 * Ce n'est pas théorique : la migration 0087 n'est pas encore appliquée
 * à la production, et `biolab_tableau_de_bord` y répond aujourd'hui
 * HTTP 404 (PGRST202, « la fonction n'existe pas »).
 *
 * Le type descend donc ici, au socle, et `statistiques.ts` le réexporte
 * pour que rien n'ait deux définitions.
 */
export type Lecture<T> = { donnees: T; erreur: string | null };

export function echecDeLecture<T>(vide: T, message: string | undefined): Lecture<T> {
  return { donnees: vide, erreur: message ?? "Lecture impossible" };
}

/** Ce que rend `biolab_tableau_de_bord` (0087, §4.1). */
export type TableauDeBord = {
  lots_total: number;
  lots_actifs: number;
  lots_multiplication: number;
  lots_enracinement: number;
  bioreacteurs_actifs: number;
  explants_total: number;
  plantules_acclimatation: number;
  alertes_actives: number;
  immersions_du_jour: number;
  aerations_du_jour: number;
  inspections_du_jour: number;
  milieux_du_jour: number;
  articles_stock_faible: number;
  /**
   * LES DÉNOMINATEURS, UN PAR TAUX.
   *
   * Sans eux, une carte affichait « 100 % de contamination » sur une
   * seule inspection exactement comme sur quarante. Le module s'est
   * donné une règle — sous cinq observations, les faits bruts
   * remplacent le pourcentage (`SEUIL_TAUX`) — et elle était intenable
   * sur ces cartes faute de savoir sur combien de lignes le chiffre
   * portait. La migration 0087 les rend désormais.
   */
  inspections_7j: number;
  lots_mesures_multiplication: number;
  acclimatations_mesurees: number;
  /**
   * Combien de lots ont AU MOINS une inspection. Le taux de
   * contamination se calcule sur TOUS les lots — un lot jamais regardé
   * compte comme non contaminé — et c'est la seule définition
   * possible ; mais l'écart entre l'effectif et l'effectif observé doit
   * se voir.
   */
  lots_inspectes: number;
  taux_multiplication_moyen: number | string | null;
  taux_contamination_7j: number | string | null;
  taux_survie_acclimatation: number | string | null;
  taux_perte: number | string | null;
  duree_cycle_moyenne_secondes: number | string | null;
};

/** Ce que rend `biolab_activite_recente` (0087, §4.4). */
export type LigneActivite = {
  survenu_le: string;
  categorie: "cycle" | "inspection" | "milieu" | string;
  libelle: string;
  objet_id: string;
};

/**
 * Le tableau de bord, calculé EN BASE.
 *
 * Reprend `BioLabDashboardService.summary` du mobile — mêmes
 * définitions, mêmes NULL. Le §6 interdit deux moteurs ; recompter ici
 * ce que la fonction compte déjà produirait, un jour, deux chiffres
 * différents pour la même journée.
 *
 * Le fuseau n'est pas décoratif : le mobile compte « les immersions du
 * jour » avec l'heure du téléphone, une session Postgres est en UTC.
 * Sans lui, entre minuit et deux heures du matin, l'écran et le
 * téléphone se contrediraient.
 */
export async function lireTableauDeBord(
  workspaceId: string,
): Promise<Lecture<TableauDeBord | null>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("biolab_tableau_de_bord", {
    p_workspace_id: workspaceId,
    p_fuseau: FUSEAU_LABORATOIRE,
  });
  if (error) return echecDeLecture<TableauDeBord | null>(null, error.message);

  const lignes = (data ?? []) as TableauDeBord[];
  return { donnees: lignes[0] ?? null, erreur: null };
}

export async function lireActiviteRecente(
  workspaceId: string,
  limite = 12,
): Promise<Lecture<LigneActivite[]>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("biolab_activite_recente", {
    p_workspace_id: workspaceId,
    p_limite: limite,
  });
  if (error) return echecDeLecture<LigneActivite[]>([], error.message);
  return { donnees: (data ?? []) as LigneActivite[], erreur: null };
}

// ------------------------------------------------------------------
// 4 bis. LES POINTS D'ATTENTION
// ------------------------------------------------------------------

export type PointAttention = {
  id: string;
  ton: "critical" | "warning" | "accent";
  titre: string;
  detail: string;
  lien?: { label: string; href: string };
};

/** Le seuil du mobile, repris tel quel — voir `MatiereAttention`. */
export const SEUIL_INSPECTION_JOURS = 14;

/** L'horizon « cette semaine » du mobile (`BioLabDashboardService.suggestions`). */
export const HORIZON_FIN_DE_CYCLE_JOURS = 7;

export type MatiereAttention = {
  /** Lots actifs dont la fin de cycle prévue est DÉPASSÉE. */
  finDeCycleDepassee: { id: string; batch_code: string; expected_end_at: string }[];
  /** Lots actifs dont la fin de cycle prévue tombe dans les sept jours. */
  finDeCycleProche: { id: string; batch_code: string; expected_end_at: string }[];
  /**
   * Contaminations CONFIRMÉES des sept derniers jours. Jamais les
   * suspicions : le modèle Swift réserve « confirmée » au jugement d'un
   * humain, et mélanger les deux transformerait une inquiétude en fait.
   */
  contaminations: { id: string; date: string; lot: string | null }[];
  /**
   * Lots actifs commencés il y a au moins quatorze jours et qui n'ont
   * JAMAIS été inspectés. Même définition que
   * `BioLabAlertService.scanInspectionRecency` — quatorze jours, aucune
   * inspection du tout, pas un intervalle par espèce que le produit
   * n'a aucune base pour choisir.
   */
  jamaisInspectes: { id: string; batch_code: string; started_at: string }[];
  /** Les alertes non résolues écrites par le téléphone. */
  alertes: {
    id: string;
    alert_type: string;
    priority: string;
    message: string;
    created_at: string;
  }[];
};

/**
 * Ce qui demande une décision aujourd'hui, dans l'ordre où on se la
 * pose : ce qui est perdu, ce qui va l'être, ce qu'il faut regarder.
 *
 * FONCTION PURE, et c'est ce qui la rend éprouvable sans base ni
 * réseau. Elle ne compte rien qu'on lui n'ait donné : chaque liste
 * ci-dessus vient d'une requête, donc du serveur. Elle ordonne et elle
 * formule — deux choses qu'un test peut vérifier ligne à ligne.
 *
 * ELLE NE REND JAMAIS DE LIGNE « TOUT VA BIEN ». Un tableau de bord qui
 * affirme que rien ne cloche alors que la base est vide ment par
 * omission ; l'écran distingue les deux cas lui-même, parce qu'il sait,
 * lui, si le laboratoire contient quelque chose.
 */
export function pointsDAttention(
  matiere: MatiereAttention,
  maintenant: Date = new Date(),
): PointAttention[] {
  const points: PointAttention[] = [];

  // 1. La contamination confirmée. C'est une perte déjà faite : elle
  //    passe avant tout le reste.
  if (matiere.contaminations.length > 0) {
    const n = matiere.contaminations.length;
    const lots = [...new Set(matiere.contaminations.map((c) => c.lot).filter(Boolean))];
    points.push({
      id: "contaminations",
      ton: "critical",
      titre: `${n} contamination${n > 1 ? "s" : ""} confirmée${n > 1 ? "s" : ""} cette semaine`,
      detail:
        lots.length > 0
          ? `${lots.slice(0, 4).join(", ")}${lots.length > 4 ? `, et ${lots.length - 4} autre${lots.length - 4 > 1 ? "s" : ""}` : ""}. Une contamination confirmée est le jugement d'un opérateur, pas une suspicion.`
          : "Relevées à l'inspection, sur des lots que cet espace ne montre plus.",
      lien: { label: "Voir les lots", href: "/biolab/lots?contamination=confirmee" },
    });
  }

  // 2. Les alertes du téléphone, les plus graves d'abord. On ne les
  //    recalcule pas : elles ont été écrites par la scrutation du
  //    mobile, qui voit des choses que le web ne voit pas (une pompe qui
  //    ne répond plus, un capteur hors ligne).
  const gravite: Record<string, number> = { critical: 3, important: 2, warning: 1, info: 0 };
  const alertesTriees = [...matiere.alertes].sort(
    (a, b) => (gravite[b.priority] ?? 0) - (gravite[a.priority] ?? 0),
  );
  for (const alerte of alertesTriees.slice(0, 5)) {
    points.push({
      id: `alerte-${alerte.id}`,
      ton: alerte.priority === "critical" || alerte.priority === "important" ? "critical" : "warning",
      titre: libelle(ALERTE_LABELS, alerte.alert_type),
      // Le message a été composé par le téléphone avec le code du lot ou
      // du bioréacteur : le réécrire ici le ferait diverger.
      detail: alerte.message,
    });
  }

  // 3. La fin de cycle dépassée. Un lot qu'on laisse au-delà de son
  //    terme s'épuise dans son milieu : c'est une perte en cours, pas
  //    une échéance manquée.
  if (matiere.finDeCycleDepassee.length > 0) {
    const n = matiere.finDeCycleDepassee.length;
    const plusVieux = [...matiere.finDeCycleDepassee].sort(
      (a, b) => new Date(a.expected_end_at).getTime() - new Date(b.expected_end_at).getTime(),
    )[0];
    const retard = joursDepuis(plusVieux.expected_end_at, maintenant);
    points.push({
      id: "fin-de-cycle-depassee",
      ton: "warning",
      titre: `${n} lot${n > 1 ? "s ont" : " a"} dépassé la fin de cycle prévue`,
      detail: `Le plus ancien est ${plusVieux.batch_code}, ${retard} jour${retard > 1 ? "s" : ""} au-delà du terme que vous aviez noté. À repiquer, à passer au stade suivant, ou à clore.`,
      lien: { label: "Voir ces lots", href: "/biolab/lots?echeance=depassee" },
    });
  }

  // 4. Les lots jamais inspectés. Le mobile en fait une alerte de
  //    priorité « information » ; on la reproduit ici parce qu'elle
  //    n'existe que si la scrutation du téléphone a tourné, et rien ne
  //    garantit qu'elle l'ait fait.
  if (matiere.jamaisInspectes.length > 0) {
    const n = matiere.jamaisInspectes.length;
    points.push({
      id: "jamais-inspectes",
      ton: "warning",
      titre: `${n} lot${n > 1 ? "s" : ""} sans aucune inspection`,
      detail: `Actif${n > 1 ? "s" : ""} depuis plus de ${SEUIL_INSPECTION_JOURS} jours et jamais relevé${n > 1 ? "s" : ""}. Une contamination qui démarre ne se voit que là.`,
      lien: { label: "Voir ces lots", href: "/biolab/lots?inspection=jamais" },
    });
  }

  // 5. Ce qui arrive. Dernier, parce que ce n'est pas encore un
  //    problème — mais c'est la semaine à préparer.
  if (matiere.finDeCycleProche.length > 0) {
    const n = matiere.finDeCycleProche.length;
    points.push({
      id: "fin-de-cycle-proche",
      ton: "accent",
      titre: `${n} lot${n > 1 ? "s arrivent" : " arrive"} en fin de cycle cette semaine`,
      detail: `Prévoyez le milieu, les bocaux et la paillasse : ${matiere.finDeCycleProche
        .slice(0, 4)
        .map((l) => l.batch_code)
        .join(", ")}${n > 4 ? `, et ${n - 4} autre${n - 4 > 1 ? "s" : ""}` : ""}.`,
      lien: { label: "Voir ces lots", href: "/biolab/lots?echeance=semaine" },
    });
  }

  return points;
}

/**
 * Va chercher en base la matière des points d'attention.
 *
 * Cinq requêtes, toutes bornées, toutes portées par la RLS du client
 * serveur — c'est elle, et pas ce fichier, qui interdit de voir le
 * laboratoire d'une autre entreprise.
 */
/**
 * LE PLAFOND DES LECTURES EN DEUX TEMPS, ÉCRIT UNE SEULE FOIS.
 *
 * Le compteur « lots jamais inspectés » du tableau de bord et la liste
 * qu'il ouvre (`lots.ts`, filtre `?inspection=jamais`) doivent compter
 * la même chose : cliquer sur « 3 » pour trouver onze lignes se lit
 * comme un bogue, et c'en serait un. Les deux définitions étaient déjà
 * identiques ; leurs BORNES ne l'étaient pas — 200 d'un côté, 1000 de
 * l'autre. Une seule constante, partagée, ferme l'écart.
 */
export const PLAFOND_ANTI_JOINTURE = 1000;

export async function lireMatiereAttention(
  workspaceId: string,
  maintenant: Date = new Date(),
): Promise<Lecture<MatiereAttention>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const maintenantISO = maintenant.toISOString();
  const dansUneSemaine = new Date(
    maintenant.getTime() + HORIZON_FIN_DE_CYCLE_JOURS * 86_400_000,
  ).toISOString();
  const ilYAUneSemaine = new Date(maintenant.getTime() - 7 * 86_400_000).toISOString();
  const seuilInspection = new Date(
    maintenant.getTime() - SEUIL_INSPECTION_JOURS * 86_400_000,
  ).toISOString();

  const [depassee, proche, contaminations, candidats, alertes] = await Promise.all([
    supabase
      .from("culture_batches")
      .select("id, batch_code, expected_end_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .not("expected_end_at", "is", null)
      .lt("expected_end_at", maintenantISO)
      .order("expected_end_at")
      .limit(200),

    supabase
      .from("culture_batches")
      .select("id, batch_code, expected_end_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .gte("expected_end_at", maintenantISO)
      .lte("expected_end_at", dansUneSemaine)
      .order("expected_end_at")
      .limit(200),

    supabase
      .from("bioreactor_inspections")
      .select("id, date, culture_batches ( batch_code )")
      .eq("workspace_id", workspaceId)
      .eq("contamination_status", "confirmed")
      .gte("date", ilYAUneSemaine)
      .order("date", { ascending: false })
      .limit(50),

    // Les lots ASSEZ VIEUX pour être en retard d'inspection. On retire
    // ensuite ceux qui en ont une : PostgREST ne sait pas exprimer une
    // anti-jointure, et ce tri-là est un ensemble, pas un calcul — il ne
    // produit aucun chiffre affiché.
    supabase
      .from("culture_batches")
      .select("id, batch_code, started_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .lte("started_at", seuilInspection)
      .order("started_at")
      .limit(PLAFOND_ANTI_JOINTURE),

    supabase
      .from("biolab_alerts")
      .select("id, alert_type, priority, message, created_at")
      .eq("workspace_id", workspaceId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const vide: MatiereAttention = {
    finDeCycleDepassee: [],
    finDeCycleProche: [],
    contaminations: [],
    jamaisInspectes: [],
    alertes: [],
  };

  // LA PREMIÈRE ERREUR SUFFIT À TOUT ARRÊTER. Une liste amputée d'une
  // de ses cinq sources est plus dangereuse qu'une page en erreur :
  // « rien à arbitrer aujourd'hui » est une affirmation, et on la
  // croirait.
  const premiereErreur =
    depassee.error?.message ??
    proche.error?.message ??
    contaminations.error?.message ??
    candidats.error?.message ??
    alertes.error?.message ??
    null;
  if (premiereErreur) return echecDeLecture(vide, premiereErreur);

  const lotsCandidats = (candidats.data ?? []) as {
    id: string;
    batch_code: string;
    started_at: string;
  }[];

  let jamaisInspectes: typeof lotsCandidats = [];
  if (lotsCandidats.length > 0) {
    const { data: inspectes, error: erreurInspectes } = await supabase
      .from("bioreactor_inspections")
      .select("culture_batch_id")
      .eq("workspace_id", workspaceId)
      .in(
        "culture_batch_id",
        lotsCandidats.map((l) => l.id),
      );
    if (erreurInspectes) return echecDeLecture(vide, erreurInspectes.message);
    const deja = new Set(
      ((inspectes ?? []) as { culture_batch_id: string | null }[])
        .map((i) => i.culture_batch_id)
        .filter((v): v is string => v !== null),
    );
    jamaisInspectes = lotsCandidats.filter((l) => !deja.has(l.id));
  }

  return {
    donnees: {
      finDeCycleDepassee: (depassee.data ?? []) as MatiereAttention["finDeCycleDepassee"],
      finDeCycleProche: (proche.data ?? []) as MatiereAttention["finDeCycleProche"],
      contaminations: ((contaminations.data ?? []) as unknown as {
        id: string;
        date: string;
        culture_batches: { batch_code: string } | null;
      }[]).map((i) => ({ id: i.id, date: i.date, lot: i.culture_batches?.batch_code ?? null })),
      jamaisInspectes,
      alertes: (alertes.data ?? []) as MatiereAttention["alertes"],
    },
    erreur: null,
  };
}
