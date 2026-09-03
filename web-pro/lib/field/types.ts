import type { BadgeTone } from "@/lib/quotes/types";

/** §11G planning et §11H équipes. */

export const INTERVENTION_KINDS = [
  "visit", "work", "maintenance", "delivery", "repair", "other",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_KIND_LABELS: Record<InterventionKind, string> = {
  visit: "Visite",
  work: "Chantier",
  maintenance: "Entretien",
  delivery: "Livraison",
  repair: "Dépannage",
  other: "Autre",
};

export const INTERVENTION_STATUSES = ["scheduled", "inProgress", "done", "cancelled"] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];

export const INTERVENTION_STATUS_LABELS: Record<InterventionStatus, string> = {
  scheduled: "Planifiée",
  inProgress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

export const INTERVENTION_STATUS_TONE: Record<InterventionStatus, BadgeTone> = {
  scheduled: "neutral",
  inProgress: "info",
  done: "positive",
  cancelled: "warning",
};

export const TIME_KINDS = ["work", "travel", "break", "other"] as const;
export type TimeKind = (typeof TIME_KINDS)[number];

export const TIME_KIND_LABELS: Record<TimeKind, string> = {
  work: "Travail",
  travel: "Trajet",
  break: "Pause",
  other: "Autre",
};

/** Les niveaux de compétence — trois, parce qu'au-delà « 7/10 » ne veut rien dire. */
export const SKILL_LEVELS = [1, 2, 3] as const;
export const SKILL_LEVEL_LABELS: Record<number, string> = {
  1: "Notions",
  2: "Autonome",
  3: "Référent",
};

/** Couleurs proposées aux équipes. Assez distinctes pour se lire sur une semaine chargée. */
export const TEAM_COLORS = [
  "#15654a", "#2f6fb5", "#a8532f", "#6f4d8a", "#8a7233", "#3f8d82", "#a03b31",
];

export type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  hourly_cost_cents: number;
};

export function employeeName(e: { first_name: string; last_name: string }): string {
  return `${e.first_name} ${e.last_name}`.trim();
}

export type Team = {
  id: string;
  name: string;
  color: string;
  lead_employee_id: string | null;
};

export type Intervention = {
  id: string;
  kind: InterventionKind;
  title: string;
  status: InterventionStatus;
  instructions: string | null;
  notes: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  team_id: string | null;
  project_id: string | null;
  customer_id: string | null;
  // Existe en base depuis 0051 et n'avait jamais été déclarée ici : le
  // planning ne pouvait donc pas dire OÙ l'équipe part, qui est la
  // première question du matin.
  site_id: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
};

export type TimeEntry = {
  id: string;
  employee_id: string;
  worked_on: string;
  hours: number;
  hourly_cost_cents: number;
  total_cents: number;
  kind: TimeKind;
  validated: boolean;
  notes: string | null;
};

// ---------------------------------------------------------------
// Le jour, tel qu'il est vécu à Paris
// ---------------------------------------------------------------

/**
 * TOUT CE QUI EST « UN JOUR » SE CALCULE ICI, ET EN HEURE DE PARIS.
 *
 * L'ancienne version du planning demandait la date d'un instant à
 * `toISOString().slice(0, 10)`, c'est-à-dire la date UTC. Entre minuit
 * et deux heures du matin l'heure d'été, la journée parisienne a
 * commencé mais pas celle du serveur : le repère « aujourd'hui » se
 * posait sur la VEILLE, une intervention du lundi 00 h 30 tombait hors
 * de la fenêtre de la semaine et n'apparaissait NULLE PART, et le
 * regroupement par colonne (date UTC) pouvait désigner un autre jour
 * que l'heure affichée à côté (heure locale).
 *
 * C'est exactement le décalage que la migration 0066 a corrigé côté
 * base. Ces fonctions disent la même chose côté web, et rien d'autre
 * dans le planning n'a le droit de fabriquer un jour à la main.
 */
const PARIS = "Europe/Paris";

/** `AAAA-MM-JJ` du jour vécu à Paris. `fr-CA` produit l'ordre ISO. */
export function parisDay(instant: Date): string {
  return instant.toLocaleDateString("fr-CA", { timeZone: PARIS });
}

const PARIS_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: PARIS,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

/** De combien l'horloge de Paris avance sur UTC à cet instant-là. */
function decalageParis(instant: Date): number {
  const champs: Record<string, string> = {};
  for (const morceau of PARIS_PARTS.formatToParts(instant)) champs[morceau.type] = morceau.value;
  const commeSiUtc = Date.UTC(
    Number(champs.year), Number(champs.month) - 1, Number(champs.day),
    Number(champs.hour), Number(champs.minute), Number(champs.second),
  );
  return commeSiUtc - instant.getTime();
}

/**
 * L'instant où l'horloge de Paris affiche `heureAffichee` (en
 * millisecondes depuis minuit) le jour `AAAA-MM-JJ`.
 *
 * Deux passes, et la seconde n'est pas de la coquetterie : le décalage
 * se lit SUR un instant, or l'instant cherché est précisément ce qu'on
 * ne connaît pas encore. La première passe le devine à partir du
 * décalage qu'il ferait s'il était en UTC, la seconde le corrige avec
 * le décalage réellement en vigueur ce jour-là. Sans elle, les deux
 * dimanches de changement d'heure seraient décalés d'une heure.
 *
 * Le dimanche de printemps, 2 h 30 n'existe pas — l'horloge saute de
 * 2 h à 3 h. La seconde passe rend alors 3 h 30, ce qui est le seul
 * choix disponible et le bon : on ne perd pas la carte, on la décale
 * du saut lui-même.
 */
function parisAt(dayIso: string, heureAffichee: number): string {
  const naif = Date.parse(`${dayIso}T00:00:00Z`) + heureAffichee;
  let instant = naif - decalageParis(new Date(naif));
  instant = naif - decalageParis(new Date(instant));
  return new Date(instant).toISOString();
}

/** L'instant où il est `heure` heures à Paris, le jour `AAAA-MM-JJ`. */
export function parisAtHour(dayIso: string, heure: number): string {
  return parisAt(dayIso, heure * 3_600_000);
}

/**
 * Ce que l'horloge de Paris affiche à cet instant-là, en millisecondes
 * depuis minuit.
 *
 * CE N'EST PAS L'ÉCART À MINUIT, et la nuance vaut une heure deux fois
 * par an. Le dimanche de bascule d'automne, minuit et 8 h à Paris sont
 * séparés par VINGT-CINQ heures d'horloge réelle : mesurer l'écart
 * rendrait 25 h, et le reporter sur un jour ordinaire déposerait la
 * carte à 9 h. Ce qu'on veut conserver est le chiffre que
 * l'utilisateur lit sur la carte — « 08:00 » — pas une durée.
 */
function heureAfficheeAParis(instant: Date): number {
  const champs: Record<string, string> = {};
  for (const morceau of PARIS_PARTS.formatToParts(instant)) champs[morceau.type] = morceau.value;
  const millisecondes = ((instant.getTime() % 1000) + 1000) % 1000;
  return ((Number(champs.hour) * 60 + Number(champs.minute)) * 60 + Number(champs.second)) * 1000
    + millisecondes;
}

/** L'instant où commence, à Paris, la journée `AAAA-MM-JJ`. */
export function parisMidnight(dayIso: string): Date {
  return new Date(parisAtHour(dayIso, 0));
}

/** Le jour `AAAA-MM-JJ` décalé de `jours`. Arithmétique de chaîne, sans fuseau. */
export function addDaysIso(dayIso: string, jours: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/**
 * Le lundi de la semaine contenant ce jour.
 *
 * La semaine française commence le lundi, pas le dimanche comme le
 * suppose `getDay()`. Se tromper décale tout le planning d'un jour, ce
 * qui se voit tard et coûte un déplacement.
 */
export function mondayIsoOf(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayIso;
  // getUTCDay : 0 = dimanche. On veut 0 = lundi.
  return addDaysIso(dayIso, -((d.getUTCDay() + 6) % 7));
}

/** Les sept jours de la semaine, du lundi au dimanche. */
export function weekDaysIso(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mondayIso, i));
}

/** Est-ce une date de la forme attendue ? Garde d'entrée pour `?semaine=`. */
export function estUnJourIso(valeur: unknown): valeur is string {
  return typeof valeur === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(valeur)
    && !Number.isNaN(Date.parse(`${valeur}T00:00:00Z`));
}

export const WEEKDAY_LABELS = [
  "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
];

// Formatés en UTC parce que la chaîne `AAAA-MM-JJ` est relue à minuit
// UTC : sans cela, un navigateur à l'ouest de Greenwich afficherait la
// veille sous le bon libellé de jour.
const DAY_SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_LONG = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

function jour(dayIso: string): Date {
  return new Date(`${dayIso}T00:00:00Z`);
}

/** « 2 sept. » */
export function formatDayIso(dayIso: string): string {
  return DAY_SHORT.format(jour(dayIso));
}

/** « Mardi 2 septembre » */
export function formatDayIsoLong(dayIso: string): string {
  const index = (jour(dayIso).getUTCDay() + 6) % 7;
  return `${WEEKDAY_LABELS[index]} ${DAY_LONG.format(jour(dayIso))}`;
}

/**
 * La plage de la semaine : « 1 – 7 septembre 2026 ».
 *
 * La plage plutôt que « Semaine du … » : c'est la question qu'on se
 * pose en ouvrant l'écran — jusqu'où va ce que je regarde.
 */
export function formatWeekRange(mondayIso: string): string {
  const dimanche = addDaysIso(mondayIso, 6);
  const [anneeA, moisA] = mondayIso.split("-");
  const [anneeB, moisB] = dimanche.split("-");
  const fin = `${DAY_LONG.format(jour(dimanche))} ${anneeB}`;

  if (anneeA === anneeB && moisA === moisB) {
    return `${Number(mondayIso.slice(8, 10))} – ${fin}`;
  }
  if (anneeA === anneeB) return `${DAY_LONG.format(jour(mondayIso))} – ${fin}`;
  return `${DAY_LONG.format(jour(mondayIso))} ${anneeA} – ${fin}`;
}

// L'heure aussi est celle de Paris : ce composant est rendu tantôt sur
// le serveur (en UTC), tantôt dans le navigateur, et « 08:00 » ne peut
// pas dépendre de qui dessine.
const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit", minute: "2-digit", timeZone: PARIS,
});

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME_FORMAT.format(d);
}

/**
 * `<input type="datetime-local">` ne connaît AUCUN fuseau.
 *
 * Il rend « 2026-08-29T08:00 », que Postgres — dont le fuseau est UTC —
 * lit comme 08:00 UTC, soit 10 h à Paris. Envoyer la valeur telle
 * quelle décalait donc chaque intervention de deux heures, et de deux
 * heures DE PLUS à chaque réenregistrement, puisque le champ était
 * rempli à partir de l'heure locale de la valeur déjà décalée. Rien ne
 * le signalait : les cartes du planning se déplaçaient toutes seules.
 *
 * Ces deux fonctions font la traduction, et doivent encadrer tout champ
 * `datetime-local` de l'application.
 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * L'inverse : une saisie locale vers l'instant qu'elle désigne.
 *
 * `new Date("2026-08-29T08:00")` — sans `Z` ni décalage — est interprété
 * en heure LOCALE par la norme, ce qui est exactement ce qu'on veut.
 */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Les heures d'une durée planifiée, arrondies au quart d'heure.
 *
 * Sert à pré-remplir le pointage : le chef d'équipe corrige, mais part
 * de ce qui était prévu plutôt que d'un champ vide.
 */
export function scheduledHours(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 4) / 4;
}

/**
 * Empêche une fin antérieure au début.
 *
 * Reculer l'heure de début après la fin est un geste normal — on
 * décale une intervention de la matinée à l'après-midi — mais la
 * contrainte de la base le refuse, et l'utilisateur reçoit alors le nom
 * d'une contrainte SQL en pleine figure.
 *
 * La DURÉE est conservée : déplacer le début de 8 h à 14 h sur une
 * intervention de huit heures la fait finir à 22 h, pas planter. C'est
 * ce que fait n'importe quel agenda, et c'est presque toujours
 * l'intention. Une fin explicitement placée après le début n'est jamais
 * touchée.
 */
export function keepScheduleOrdered(
  patch: Record<string, unknown>,
  previous: { scheduled_start: string | null; scheduled_end: string | null },
) {
  const start = "scheduled_start" in patch
    ? (patch.scheduled_start as string | null) : previous.scheduled_start;
  const end = "scheduled_end" in patch
    ? (patch.scheduled_end as string | null) : previous.scheduled_end;
  if (!start || !end) return;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs >= startMs) return;

  const previousDuration =
    previous.scheduled_start && previous.scheduled_end
      ? new Date(previous.scheduled_end).getTime() - new Date(previous.scheduled_start).getTime()
      : 0;
  // Une durée héritée valable, sinon une heure : mieux vaut une durée
  // arbitraire mais visible qu'une intervention de durée nulle.
  const duration = previousDuration > 0 ? previousDuration : 3_600_000;
  patch.scheduled_end = new Date(startMs + duration).toISOString();
}


// ---------------------------------------------------------------
// Le planning de la semaine
// ---------------------------------------------------------------

/**
 * La note de journée — table `planning_day_notes`, migration 0078.
 *
 * Une consigne d'exploitation posée sur une JOURNÉE et lue par toute
 * l'entreprise : « livraison paillage 14 h », « dépôt fermé »,
 * « équipe B en formation ». À ne pas confondre avec
 * `Intervention.notes`, qui est le compte rendu d'UNE intervention et
 * qui regarde vers le passé.
 */
export type DayNote = {
  id: string;
  day: string;
  team_id: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Le plafond de la contrainte `planning_day_notes_body_bounded` (0078). */
export const NOTE_LONGUEUR_MAX = 500;

export type NoteVerdict =
  | { action: "vide" }
  | { action: "enregistrer"; body: string }
  | { action: "refuser"; raison: string };

/**
 * Ce qu'il faut faire d'une note saisie, avant que la base ne réponde.
 *
 * Le bornage est celui de 0078, rejoué ici pour deux raisons. D'abord
 * parce qu'une note vidée VOLONTAIREMENT est une suppression, pas une
 * erreur : sans ce verdict, l'utilisateur qui efface le texte et valide
 * recevrait le nom d'une contrainte SQL en pleine figure pour un geste
 * parfaitement normal. Ensuite parce qu'un refus doit s'écrire en
 * français.
 *
 * `trim()` est plus sévère que le `btrim()` de Postgres — qui ne retire
 * que les espaces — et `String.length` compte plus large que
 * `char_length`, les émojis pesant deux unités UTF-16 pour un seul
 * caractère. Les deux écarts vont dans le même sens : ce qui passe ici
 * passe en base. L'inverse aurait été le piège.
 */
export function verdictDeNote(brut: string): NoteVerdict {
  const body = brut.trim();
  if (body === "") return { action: "vide" };
  if (body.length > NOTE_LONGUEUR_MAX) {
    return {
      action: "refuser",
      raison: `Une note de planning tient en ${NOTE_LONGUEUR_MAX} caractères. `
        + `Celle-ci en fait ${body.length} — le détail a sa place sur l'intervention.`,
    };
  }
  return { action: "enregistrer", body };
}

/**
 * Une carte à dessiner : une intervention, un jour, et son rang.
 *
 * Une intervention de plusieurs jours produit PLUSIEURS cartes — une
 * par jour couvert. C'est le mensonge que l'ancien écran racontait : un
 * chantier de soixante-dix heures n'apparaissait que le jour de son
 * début, et le mercredi paraissait libre alors que l'équipe y était
 * mobilisée.
 */
export type PlanningCard = {
  intervention: Intervention;
  /** 1 pour un chantier d'un jour ; « jour 2 sur 4 » sinon. */
  rang: number;
  jours: number;
  /** La carte du premier jour est la seule qui se déplace. */
  premier: boolean;
  dernier: boolean;
};

/** Tous les jours couverts par l'intervention, hors de toute fenêtre. */
function joursOccupes(iv: Intervention): string[] {
  if (!iv.scheduled_start) return [];
  const debut = Date.parse(iv.scheduled_start);
  if (!Number.isFinite(debut)) return [];

  const premier = parisDay(new Date(debut));
  const finBrute = iv.scheduled_end ? Date.parse(iv.scheduled_end) : Number.NaN;
  // La fin est EXCLUSIVE : un chantier qui s'arrête le jeudi à minuit
  // pile s'arrête mercredi soir, il n'occupe pas le jeudi. D'où le
  // `- 1` — une milliseconde, mais elle vaut une colonne entière.
  const dernier = Number.isFinite(finBrute) && finBrute > debut
    ? parisDay(new Date(finBrute - 1))
    : premier;

  const jours: string[] = [];
  // Un garde-fou plutôt qu'une boucle ouverte : une fin saisie en 2126
  // ne doit pas fabriquer trente-six mille cartes.
  for (let j = premier; j <= dernier && jours.length < 400; j = addDaysIso(j, 1)) jours.push(j);
  return jours;
}

/** Les jours de la fenêtre que cette intervention occupe réellement. */
export function interventionDaysIso(iv: Intervention, weekDays: string[]): string[] {
  const tous = joursOccupes(iv);
  // Comparaison de chaînes : `AAAA-MM-JJ` s'ordonne comme la date.
  return weekDays.filter((j) => tous.includes(j));
}

/**
 * Les cartes de chaque jour de la semaine.
 *
 * Le tri se fait sur l'heure de début, PUIS sur le nom de l'équipe :
 * sans second critère, deux interventions de même heure échangent leur
 * place d'un rendu à l'autre et l'œil ne retrouve plus la carte qu'il
 * suivait.
 */
export function groupByDay(
  interventions: Intervention[],
  weekDays: string[],
  nomEquipe: (id: string | null) => string = () => "",
): Map<string, PlanningCard[]> {
  const parJour = new Map<string, PlanningCard[]>();
  for (const dayIso of weekDays) parJour.set(dayIso, []);

  for (const iv of interventions) {
    // Les jours occupés se comptent sur TOUTE la durée du chantier et
    // non sur la fenêtre affichée : un chantier commencé la semaine
    // dernière doit s'annoncer « jour 6 sur 9 », pas « jour 1 sur 4 ».
    const tous = joursOccupes(iv);

    for (const dayIso of tous) {
      const cartes = parJour.get(dayIso);
      if (!cartes) continue;
      const rang = tous.indexOf(dayIso) + 1;
      cartes.push({
        intervention: iv,
        rang,
        jours: tous.length,
        premier: rang === 1,
        dernier: rang === tous.length,
      });
    }
  }

  for (const cartes of parJour.values()) {
    cartes.sort((a, b) => {
      const heure = (a.intervention.scheduled_start ?? "")
        .localeCompare(b.intervention.scheduled_start ?? "");
      if (heure !== 0) return heure;
      const equipe = nomEquipe(a.intervention.team_id)
        .localeCompare(nomEquipe(b.intervention.team_id), "fr");
      return equipe !== 0 ? equipe : a.intervention.id.localeCompare(b.intervention.id);
    });
  }

  return parJour;
}

/**
 * Les heures qu'une intervention occupe DANS cette journée-là.
 *
 * `null` quand la durée est inconnue, et ce n'est PAS zéro : « on ne
 * sait pas quand ça finit » et « ça ne dure pas » sont deux
 * affirmations différentes, et la première est de loin la plus
 * fréquente. Un `?? 0` ici afficherait « 0 h » sur une journée pleine.
 */
export function overlapHours(iv: Intervention, dayIso: string): number | null {
  if (!iv.scheduled_start || !iv.scheduled_end) return null;
  const debut = Date.parse(iv.scheduled_start);
  const fin = Date.parse(iv.scheduled_end);
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return null;

  const ouverture = parisMidnight(dayIso).getTime();
  const fermeture = parisMidnight(addDaysIso(dayIso, 1)).getTime();
  const ms = Math.min(fin, fermeture) - Math.max(debut, ouverture);
  if (ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 4) / 4;
}

export type ChargeDuJour = {
  compte: number;
  /** `null` quand AUCUNE carte n'a de durée connue. Jamais zéro par défaut. */
  heures: number | null;
  /** Au moins une carte n'a pas de fin : le total affiché est un minorant. */
  incomplet: boolean;
};

/**
 * Ce que pèse une journée : combien d'interventions, et combien d'heures.
 *
 * Le nombre seul ne dit pas si la journée est pleine — trois visites
 * d'une heure et trois chantiers de huit heures s'écrivent « 3 » de la
 * même façon.
 *
 * UN CHANTIER DE PLUSIEURS JOURS NE COMPTE POUR AUCUNE HEURE ICI, et
 * c'est la correction la plus importante de cette fonction. Le
 * recouvrement calendaire d'un jour intermédiaire vaut VINGT-QUATRE
 * heures — personne ne travaille de minuit à minuit. Sur les seules
 * données réelles du produit, le mardi s'annonçait « 2 · 32 h » : faux
 * d'un facteur trois, et faux sur l'unique chiffre dont le métier est
 * de dire si la journée est pleine.
 *
 * Borner à une amplitude ouvrée arbitraire (7 h – 19 h) aurait produit
 * un autre chiffre inventé, et il aurait contredit la durée écrite sur
 * la carte. On préfère ne rien affirmer : le chantier compte pour une
 * intervention, il pose le « + » d'incomplétude, et le total lu reste
 * un minorant honnête. « On ne sait pas combien d'heures de ce chantier
 * tombent ce jour-là » est la vérité.
 */
export function chargeDuJour(cartes: PlanningCard[], dayIso: string): ChargeDuJour {
  let heures: number | null = null;
  let incomplet = false;

  for (const carte of cartes) {
    const part = carte.jours > 1 ? null : overlapHours(carte.intervention, dayIso);
    if (part === null) incomplet = true;
    else heures = (heures ?? 0) + part;
  }

  return { compte: cartes.length, heures, incomplet };
}

/** « 8 h », « 7 h 30 ». Jamais « 8.25 h » : personne ne lit une heure en décimales. */
export function formatDuree(heures: number): string {
  const entier = Math.floor(heures);
  const minutes = Math.round((heures - entier) * 60);
  return minutes === 0 ? `${entier} h` : `${entier} h ${String(minutes).padStart(2, "0")}`;
}

/**
 * Le même instant, un autre jour, à la même heure DE PARIS.
 *
 * C'est le cœur du glisser-déposer, et le point le plus fragile de
 * l'écran : faire glisser une carte du mardi au jeudi ne doit pas la
 * faire commencer à minuit.
 *
 * L'ancienne version réécrivait le jour avec `setFullYear`, c'est-à-dire
 * en heure LOCALE du serveur, donc en UTC. Pour la quasi-totalité des
 * interventions — celles qui commencent en pleine journée — les deux
 * calculs donnent le même résultat. Mais une intervention commencée à
 * 00 h 30 heure de Paris est un instant de la VEILLE en UTC : réécrire
 * sa date UTC la déposait un jour trop tôt, en silence, et pour ces
 * cartes-là seulement.
 *
 * CE QU'ON CONSERVE EST LE CHIFFRE AFFICHÉ, pas un écart. Reporter
 * l'écart à minuit paraît revenir au même et n'y revient pas : les
 * deux dimanches de changement d'heure, une journée parisienne fait
 * vingt-trois ou vingt-cinq heures. Déplacer une intervention de 8 h
 * SUR le dimanche d'octobre la posait à 7 h, l'en retirer la posait à
 * 9 h — une heure de perdue en silence, deux jours par an, et
 * précisément sur les cartes qu'on déplace le plus, celles du week-end
 * qu'on repousse au lundi.
 */
export function moveToDayParis(
  startIso: string | null,
  dayIso: string,
  heureParDefaut = 8,
): string {
  if (!startIso) return parisAtHour(dayIso, heureParDefaut);
  const debut = Date.parse(startIso);
  if (!Number.isFinite(debut)) return parisAtHour(dayIso, heureParDefaut);

  return parisAt(dayIso, heureAfficheeAParis(new Date(debut)));
}
