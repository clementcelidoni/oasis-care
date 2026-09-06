/**
 * §7 « équipements » — LE WEB SUPERVISE, LE TÉLÉPHONE COMMANDE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA LIMITE DU §7 EST LE PREMIER SUJET DE CE FICHIER, PAS UNE NOTE
 * ══════════════════════════════════════════════════════════════════
 *
 * « Le contrôle direct des objets connectés ne doit PAS être disponible
 * depuis le Web. Le Web sert à la supervision. »
 *
 * Ce fichier ne contient donc AUCUNE écriture. Pas une fonction
 * d'allumage, pas une bascule d'automatisation, pas une activation de
 * version de programme, pas un envoi d'ordre. Les trois seuls gestes de
 * commande du module mobile — le bascule « Automatisation active », le
 * bouton « Tester » d'un objet lié et l'activation d'une version de
 * programme, tous dans `BioreactorDetailView` — n'ont pas d'équivalent
 * ici et n'en auront pas. Ce n'est pas une fonctionnalité manquante :
 * c'est le choix d'architecture, et l'écran le dit sans s'excuser.
 *
 * IL FAUT SAVOIR OÙ CETTE LIMITE TIENT VRAIMENT, ET CE N'EST PAS EN
 * BASE. La migration 0087 l'écrit noir sur blanc : RLS ne distingue pas
 * le téléphone du navigateur — les deux passent par la même API avec le
 * même jeton — donc un responsable détenant `biolab.write` peut, en
 * appelant l'API à la main, basculer `automation_enabled`. Le §7 tient
 * par l'ABSENCE DE BOUTON dans web-pro. C'est-à-dire par ce fichier et
 * par les écrans qui l'utilisent, et par rien d'autre. Ajouter ici une
 * fonction d'écriture ne « débloquerait » pas une limitation technique :
 * ce serait enfreindre la spécification.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'HONNÊTETÉ SUR LA FRAÎCHEUR — LE SECOND SUJET
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'y a PAS de temps réel, et il ne faut pas écrire le mot. Mesure :
 * la publication `supabase_realtime` ne contient AUCUNE table, pour tout
 * le produit. Rien de ce que le téléphone écrit n'arrive au navigateur
 * sans que le navigateur redemande.
 *
 * Pire — et c'est le point que cet écran doit porter : `etat_connu_le`
 * est le `updated_at` de la ligne, donc la dernière fois que le
 * téléphone a ÉCRIT, jamais la dernière fois qu'il a OBSERVÉ. Renommer
 * un bioréacteur le rafraîchit sans qu'aucune mesure n'ait été prise.
 *
 * « Pompe 2, en marche » est un mensonge dès que le relevé date.
 * « Pompe 2, en marche, connu il y a 3 heures » est utile. Tout état
 * affiché par ce module passe donc par `fraicheurEtat`, et aucun écran
 * ne montre un état sans sa date.
 */

import { FUSEAU_LABORATOIRE, type Ton } from "./cultures.ts";

// ==================================================================
// 1. LE VOCABULAIRE DE L'ÉQUIPEMENT
// ==================================================================
//
// Recopié des modèles Swift qui écrivent ces valeurs en base —
// `BioreactorStatus`, `BioreactorType`, `BioreactorComponentType`,
// `BioreactorDeviceRole`, `MaintenanceEventType`. Le §6 interdit un
// second système : ces tables ne DÉCIDENT rien, elles traduisent.
// Chemin d'origine, pour que la vérification soit possible sans
// chercher : `OasisCare/BioLab/Models/`.

/** `BioreactorStatus` (Phase 7D). */
export const STATUTS_BIOREACTEUR = [
  "idle",
  "aerating",
  "immersing",
  "draining",
  "paused",
  "warning",
  "fault",
  "maintenance",
] as const;
export type StatutBioreacteur = (typeof STATUTS_BIOREACTEUR)[number];

export const STATUT_BIOREACTEUR_LABELS: Record<StatutBioreacteur, string> = {
  idle: "Au repos",
  aerating: "Aération",
  immersing: "Immersion",
  draining: "Vidange",
  paused: "En pause",
  warning: "Avertissement",
  fault: "Défaut",
  maintenance: "Maintenance",
};

/**
 * La teinte suit la GRAVITÉ, pas l'activité.
 *
 * « Au repos » n'est pas un problème — un bioréacteur passe l'essentiel
 * de sa journée entre deux cycles. Le teinter en gris d'alerte ferait
 * chercher une panne là où il n'y a qu'un intervalle. Seuls le défaut
 * et l'avertissement sont colorés comme tels.
 */
export const STATUT_BIOREACTEUR_TON: Record<StatutBioreacteur, Ton> = {
  idle: "neutral",
  aerating: "info",
  immersing: "accent",
  draining: "info",
  paused: "warning",
  warning: "warning",
  fault: "critical",
  maintenance: "info",
};

/** `BioreactorType` (Phase 7D). */
export const TYPE_BIOREACTEUR_LABELS: Record<string, string> = {
  temporaryImmersionTwinVessel: "Immersion temporaire (double bocal)",
  temporaryImmersionSingleVessel: "Immersion temporaire (bocal simple)",
  rita: "RITA",
  plantform: "Plantform",
  continuousImmersion: "Immersion continue",
  custom: "Personnalisé",
};

/**
 * `BioreactorComponentType` — ce dont l'appareil est physiquement fait.
 *
 * Stocké en jsonb (`bioreactors.component_types`) parce que le modèle
 * mobile en fait un ensemble optionnel : « ne pas imposer que chaque
 * système possède tous ces éléments ». Une pompe absente de la liste
 * n'est pas une pompe en panne — c'est une pompe que cet appareil n'a
 * pas, et l'écran ne doit pas les confondre.
 */
export const COMPOSANT_LABELS: Record<string, string> = {
  airInlet: "Entrée d'air",
  airFilter: "Filtre à air",
  pressureLine: "Ligne de pression",
  cultureVessel: "Bocal de culture",
  reservoir: "Réservoir",
  transferTube: "Tube de transfert",
  drainLine: "Ligne de vidange",
  ventLine: "Ligne d'évent",
  solenoidValve: "Électrovanne",
  airPump: "Pompe à air",
  liquidPump: "Pompe à liquide",
};

/** `BioreactorDeviceRole` — le rôle tenu par un objet connecté lié. */
export const ROLE_OBJET_LABELS: Record<string, string> = {
  airPump: "Pompe à air",
  valve: "Vanne de transfert",
  liquidPump: "Pompe à liquide",
  light: "Éclairage",
};

/** `MaintenanceEventType` — le journal d'entretien, en ajout seul. */
export const ENTRETIEN_LABELS: Record<string, string> = {
  sealReplaced: "Joint remplacé",
  filterReplaced: "Filtre remplacé",
  tubeChanged: "Tube changé",
  cleaning: "Nettoyage",
  calibration: "Calibration",
  pumpReplaced: "Pompe remplacée",
  other: "Autre",
};

/** Le type d'un cycle, tel que `bioreactor_cycle_executions` l'écrit. */
export const CYCLE_LABELS: Record<string, string> = {
  immersion: "Immersion",
  aeration: "Aération",
  drain: "Vidange",
  light: "Éclairage",
};

/** Le statut d'un cycle exécuté. */
export const STATUT_CYCLE_LABELS: Record<string, string> = {
  planned: "Planifié",
  running: "En cours",
  completed: "Terminé",
  failed: "Échoué",
  timeout: "Dépassement de durée",
  skipped: "Sauté",
};

export const STATUT_CYCLE_TON: Record<string, Ton> = {
  planned: "neutral",
  running: "accent",
  completed: "positive",
  failed: "critical",
  timeout: "critical",
  skipped: "warning",
};

// ==================================================================
// 2. LA FRAÎCHEUR — DATER CE QU'ON MONTRE
// ==================================================================

/**
 * AU-DELÀ DE COMBIEN DE TEMPS UN ÉTAT CESSE-T-IL DE PARLER D'AUJOURD'HUI ?
 *
 * Vingt-quatre heures, et c'est un choix de produit qu'il faut assumer
 * plutôt qu'un seuil scientifique. Le raisonnement : un bioréacteur en
 * immersion temporaire enchaîne plusieurs cycles par jour, et chaque
 * cycle touche la ligne. Une ligne restée intacte depuis plus d'une
 * journée ne décrit donc plus une machine en marche — soit elle est
 * réellement à l'arrêt, soit le téléphone ne synchronise plus. Les deux
 * méritent d'être signalés, et aucun des deux ne se voit sans la date.
 *
 * CE N'EST PAS UNE PÉREMPTION. On n'efface pas l'état, on ne le grise
 * pas : un appareil au repos depuis une semaine EST au repos, et
 * l'afficher comme « inconnu » serait aussi faux que l'afficher comme
 * frais. On ajoute seulement la phrase qui manque.
 */
export const SEUIL_ETAT_ANCIEN_HEURES = 24;

export type Fraicheur = {
  /** « connu il y a 3 h », « connu le 12 août 2026 » — jamais « en direct ». */
  texte: string;
  /** Vrai au-delà de `SEUIL_ETAT_ANCIEN_HEURES` : l'écran ajoute alors sa mise en garde. */
  ancien: boolean;
  /** null quand la ligne n'a pas de date du tout. */
  heures: number | null;
};

/**
 * Dater un état.
 *
 * FONCTION PURE : elle reçoit l'instant plutôt que d'appeler l'horloge,
 * pour être éprouvable — et pour qu'une page rendue au serveur date tout
 * son contenu du même instant, au lieu de se contredire d'une ligne à
 * l'autre.
 *
 * SANS DATE, ON NE DIT RIEN PLUTÔT QU'ON N'INVENTE. `ancien` est alors
 * vrai : une valeur qu'on ne sait pas dater est le cas le moins sûr de
 * tous, pas le plus sûr.
 */
export function fraicheurEtat(
  connuLe: string | null | undefined,
  maintenant: Date = new Date(),
): Fraicheur {
  if (!connuLe) {
    return { texte: "date de relevé inconnue", ancien: true, heures: null };
  }
  const instant = new Date(connuLe).getTime();
  if (!Number.isFinite(instant)) {
    return { texte: "date de relevé inconnue", ancien: true, heures: null };
  }

  const heures = (maintenant.getTime() - instant) / 3_600_000;

  // Une date future vient d'une horloge de téléphone en avance ; la
  // traiter comme « très ancienne » serait absurde, et prétendre
  // qu'elle est fraîche le serait aussi. On la dit telle quelle.
  if (heures < 0) {
    return { texte: "connu à l'instant", ancien: false, heures: 0 };
  }

  const ancien = heures >= SEUIL_ETAT_ANCIEN_HEURES;

  if (heures < 1) {
    const minutes = Math.max(1, Math.round(heures * 60));
    return { texte: `connu il y a ${minutes} min`, ancien, heures };
  }
  if (heures < 24) {
    return { texte: `connu il y a ${Math.round(heures)} h`, ancien, heures };
  }
  const jours = Math.round(heures / 24);
  if (jours < 31) {
    return { texte: `connu il y a ${jours} j`, ancien, heures };
  }
  return {
    texte: `connu le ${new Date(connuLe).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: FUSEAU_LABORATOIRE,
    })}`,
    ancien,
    heures,
  };
}

// ==================================================================
// 3. LA SUPERVISION — CE QUE REND `biolab_supervision_equipements`
// ==================================================================

/** Une ligne de la lecture posée au §5 de la migration 0087. */
export type LigneSupervision = {
  bioreacteur_id: string;
  code: string | null;
  nom: string | null;
  type_bioreacteur: string | null;
  emplacement: string | null;
  statut: string | null;
  automatisation_active: boolean | null;
  lot_en_cours_id: string | null;
  lot_en_cours_code: string | null;
  programme_actif_id: string | null;
  programme_actif_libelle: string | null;
  dernier_cycle_type: string | null;
  dernier_cycle_statut: string | null;
  dernier_cycle_fin: string | null;
  /** NULL — et non 0 — quand aucun objet connecté n'est lié. */
  objets_lies: number | null;
  objets_en_ligne: number | null;
  derniere_presence_objet: string | null;
  /**
   * Le contact le PLUS ANCIEN du groupe, et le nombre d'objets dont on
   * ignore la date. Le seul `max` d'avant faisait dater tout le groupe
   * par l'appareil le plus récent : un objet vu il y a deux minutes
   * couvrait celui qui n'avait plus donné signe depuis des mois.
   */
  plus_ancienne_presence_objet: string | null;
  objets_sans_presence: number | null;
  etat_connu_le: string | null;
  fraicheur_secondes: number | string | null;
};

/**
 * Le résultat d'une lecture, avec son échec quand il y en a un.
 *
 * POURQUOI ON NE SE CONTENTE PAS DE `?? []`, ET C'EST MESURÉ.
 * `biolab_supervision_equipements` est posée par la migration 0087, et
 * 0087 N'EST PAS ENCORE APPLIQUÉE À LA PRODUCTION — vérifié :
 * `pg_proc` ne contient aujourd'hui aucune fonction dont le nom
 * commence par « biolab ». Un appel à cette lecture échoue donc, et
 * `data` revient nul.
 *
 * Si l'on repliait cet échec sur une liste vide, l'écran annoncerait
 * « aucun bioréacteur dans cette entreprise » — une affirmation FAUSSE
 * sur le laboratoire de quelqu'un, à cause d'une migration non jouée.
 * C'est exactement la confusion que `etats.tsx` existe pour empêcher :
 * « je n'ai pas le droit », « la lecture a échoué » et « il n'y a rien
 * ici » se ressemblent à l'écran et n'ont rien à voir.
 */
export type Lecture<T> = { lignes: T[]; erreur: string | null };

/**
 * L'état de tous les bioréacteurs de l'espace.
 *
 * LECTURE SEULE, et la fonction de base l'est aussi : `security
 * invoker`, donc la RLS du §2 de 0087 s'applique à l'intérieur. Un
 * ouvrier sans `biolab.read` obtient une liste vide, pas les chiffres du
 * laboratoire.
 */
export async function lireSupervision(
  workspaceId: string,
): Promise<Lecture<LigneSupervision>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("biolab_supervision_equipements", {
    p_workspace_id: workspaceId,
  });
  return {
    lignes: (data ?? []) as LigneSupervision[],
    erreur: error ? error.message : null,
  };
}

/**
 * Ce qu'on dit des objets connectés d'un bioréacteur, en une phrase.
 *
 * TROIS SITUATIONS QUI NE SE CONFONDENT PAS, et c'est tout l'intérêt du
 * NULL rendu par la base :
 *
 *   • aucun objet lié      → l'appareil n'est pas piloté. Ce n'est pas
 *                            une panne, beaucoup de bioréacteurs sont
 *                            manuels.
 *   • des objets, tous là  → rien à signaler.
 *   • des objets, absents  → c'est un fait à remonter.
 *
 * Rendre « 0 en ligne » dans le premier cas accuserait un appareil qui
 * n'a jamais prétendu être connecté.
 */
export function direObjets(ligne: LigneSupervision): {
  texte: string;
  ton: Ton;
} {
  const lies = ligne.objets_lies;
  if (lies === null || lies === undefined || lies === 0) {
    return { texte: "Aucun objet connecté lié", ton: "neutral" };
  }
  const enLigne = ligne.objets_en_ligne ?? 0;
  if (enLigne === lies) {
    // « TOUS JOIGNABLES » SUR UNE PRÉSENCE INCONNUE N'EST PAS UNE BONNE
    // NOUVELLE. `connected_devices.online` vaut `false` par défaut
    // mais `last_seen_at` est NULLABLE : un objet marqué en ligne une
    // fois et jamais revu produisait une affirmation verte sans aucune
    // date. Le cas le moins sûr s'affichait comme le plus sûr.
    const sansDate = ligne.objets_sans_presence ?? 0;
    if (sansDate > 0) {
      return {
        texte: `${lies} objet${lies > 1 ? "s" : ""} connecté${lies > 1 ? "s" : ""} annoncé${lies > 1 ? "s" : ""} en ligne, ${sansDate === lies ? "sans aucune date de contact" : `dont ${sansDate} sans date de contact`}`,
        ton: "warning",
      };
    }
    return {
      texte: `${lies} objet${lies > 1 ? "s" : ""} connecté${lies > 1 ? "s" : ""}, ${lies > 1 ? "tous joignables" : "joignable"}`,
      ton: "positive",
    };
  }
  return {
    texte: `${lies - enLigne} objet${lies - enLigne > 1 ? "s" : ""} sur ${lies} injoignable${lies - enLigne > 1 ? "s" : ""}`,
    ton: "warning",
  };
}

// ==================================================================
// 4. LE DÉTAIL D'UN BIORÉACTEUR
// ==================================================================

export type VersionProgramme = {
  id: string;
  version_number: number | null;
  immersion_enabled: boolean | null;
  immersion_duration_seconds: number | null;
  immersion_interval_minutes: number | null;
  aeration_enabled: boolean | null;
  aeration_duration_seconds: number | null;
  aeration_interval_minutes: number | null;
  photoperiod_enabled: boolean | null;
  light_start_minutes: number | null;
  light_end_minutes: number | null;
  target_temperature: number | null;
  notes: string | null;
};

export type ObjetLie = {
  id: string;
  role: string | null;
  device_id: string | null;
  nom: string | null;
  categorie: string | null;
  en_ligne: boolean | null;
  vu_le: string | null;
  fabricant: string | null;
  modele: string | null;
};

export type Cycle = {
  id: string;
  cycle_type: string | null;
  status: string | null;
  planned_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  expected_duration_seconds: number | null;
  actual_duration_seconds: number | null;
  failure_reason: string | null;
};

export type Entretien = {
  id: string;
  date: string | null;
  event_type: string | null;
  notes: string | null;
};

export type FicheEquipement = {
  id: string;
  code: string | null;
  name: string | null;
  bioreactor_type: string | null;
  status: string | null;
  location: string | null;
  total_volume_liters: number | null;
  working_volume_liters: number | null;
  component_types: unknown;
  automation_enabled: boolean | null;
  current_batch_id: string | null;
  lot_code: string | null;
  active_program_version_id: string | null;
  schedule_resumed_at: string | null;
  updated_at: string | null;
};

export type DetailEquipement = {
  fiche: FicheEquipement;
  programme: VersionProgramme | null;
  programme_nom: string | null;
  objets: ObjetLie[];
  cycles: Cycle[];
  entretiens: Entretien[];
};

/**
 * `component_types` est un jsonb dont le mobile écrit un tableau de
 * chaînes. On ne fait pas confiance à cette forme les yeux fermés : la
 * colonne n'a aucune contrainte, et une valeur inattendue ne doit pas
 * faire tomber la page d'un chef de culture.
 */
export function composantsDe(brut: unknown): string[] {
  if (!Array.isArray(brut)) return [];
  return brut.filter((valeur): valeur is string => typeof valeur === "string");
}

/**
 * Le programme actif, en mots de producteur.
 *
 * SUPERVISION, PAS RÉGLAGE : on affiche ce que la machine est censée
 * faire, on n'offre aucun moyen de le changer. §7 range explicitement
 * « le programme actif » parmi les choses à AFFICHER.
 *
 * Les minutes de `light_start_minutes` comptent depuis minuit — c'est la
 * convention du modèle mobile, et « 480 » ne veut rien dire pour
 * personne : on rend « 08:00 ».
 */
export function resumerProgramme(version: VersionProgramme | null): string[] {
  if (!version) return [];
  const lignes: string[] = [];

  if (version.immersion_enabled) {
    const duree = version.immersion_duration_seconds;
    const intervalle = version.immersion_interval_minutes;
    lignes.push(
      `Immersion ${duree !== null ? `de ${duree} s` : "de durée non renseignée"}${
        intervalle !== null ? `, toutes les ${intervalle} min` : ""
      }`,
    );
  }
  if (version.aeration_enabled) {
    const duree = version.aeration_duration_seconds;
    const intervalle = version.aeration_interval_minutes;
    lignes.push(
      `Aération ${duree !== null ? `de ${duree} s` : "de durée non renseignée"}${
        intervalle !== null ? `, toutes les ${intervalle} min` : ""
      }`,
    );
  }
  if (version.photoperiod_enabled) {
    lignes.push(
      `Éclairage de ${minutesEnHeure(version.light_start_minutes)} à ${minutesEnHeure(version.light_end_minutes)}`,
    );
  }
  if (version.target_temperature !== null && version.target_temperature !== undefined) {
    lignes.push(`Température visée ${version.target_temperature} °C`);
  }
  return lignes;
}

/** Des minutes depuis minuit en heure lisible. */
export function minutesEnHeure(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Un cycle a-t-il débordé de sa durée prévue ?
 *
 * Le mobile en fait une alerte (`cycleTooLong`). On la recalcule ici
 * uniquement pour SIGNALER une ligne du journal — jamais pour créer une
 * alerte, qui reste le travail de la scrutation du téléphone. Rend null
 * quand l'une des deux durées manque : sans point de comparaison, il n'y
 * a pas de dépassement, et surtout pas « 0 % ».
 */
export function depassement(cycle: Cycle): number | null {
  const prevue = cycle.expected_duration_seconds;
  const reelle = cycle.actual_duration_seconds;
  if (!prevue || prevue <= 0 || reelle === null || reelle === undefined) return null;
  return reelle / prevue - 1;
}

/**
 * Le détail d'un bioréacteur.
 *
 * Cinq requêtes, toutes bornées. La première porte le `workspace_id`
 * pour la même raison que partout ailleurs : la RLS protège, le filtre
 * délimite. Rend null quand l'appareil n'est pas dans cet espace — un
 * identifiant deviné dans l'URL ne doit pas ouvrir la fiche du
 * laboratoire d'un autre, et la RLS s'en charge, mais l'écran doit
 * savoir quoi afficher.
 */
export async function lireEquipement(
  workspaceId: string,
  bioreacteurId: string,
): Promise<DetailEquipement | null> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data: brut } = await supabase
    .from("bioreactors")
    .select(
      "id, code, name, bioreactor_type, status, location, total_volume_liters, working_volume_liters, component_types, automation_enabled, current_batch_id, active_program_version_id, schedule_resumed_at, updated_at, culture_batches ( batch_code )",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", bioreacteurId)
    .maybeSingle();

  if (!brut) return null;

  const ligne = brut as unknown as FicheEquipement & {
    culture_batches: { batch_code: string | null } | null;
  };
  const fiche: FicheEquipement = {
    id: ligne.id,
    code: ligne.code,
    name: ligne.name,
    bioreactor_type: ligne.bioreactor_type,
    status: ligne.status,
    location: ligne.location,
    total_volume_liters: ligne.total_volume_liters,
    working_volume_liters: ligne.working_volume_liters,
    component_types: ligne.component_types,
    automation_enabled: ligne.automation_enabled,
    current_batch_id: ligne.current_batch_id,
    lot_code: ligne.culture_batches?.batch_code ?? null,
    active_program_version_id: ligne.active_program_version_id,
    schedule_resumed_at: ligne.schedule_resumed_at,
    updated_at: ligne.updated_at,
  };

  const [programme, objets, cycles, entretiens] = await Promise.all([
    fiche.active_program_version_id
      ? supabase
          .from("bioreactor_program_versions")
          .select(
            "id, version_number, immersion_enabled, immersion_duration_seconds, immersion_interval_minutes, aeration_enabled, aeration_duration_seconds, aeration_interval_minutes, photoperiod_enabled, light_start_minutes, light_end_minutes, target_temperature, notes, bioreactor_programs ( name )",
          )
          .eq("id", fiche.active_program_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    supabase
      .from("bioreactor_device_bindings")
      .select(
        "id, role, device_id, connected_devices ( name, category, online, last_seen_at, manufacturer, model )",
      )
      .eq("bioreactor_id", bioreacteurId)
      .limit(50),

    supabase
      .from("bioreactor_cycle_executions")
      .select(
        "id, cycle_type, status, planned_start, actual_start, actual_end, expected_duration_seconds, actual_duration_seconds, failure_reason",
      )
      .eq("bioreactor_id", bioreacteurId)
      .order("planned_start", { ascending: false, nullsFirst: false })
      .limit(25),

    supabase
      .from("bioreactor_maintenance")
      .select("id, date, event_type, notes")
      .eq("bioreactor_id", bioreacteurId)
      .order("date", { ascending: false })
      .limit(25),
  ]);

  const versionBrute = programme.data as
    | (VersionProgramme & { bioreactor_programs: { name: string | null } | null })
    | null;

  return {
    fiche,
    programme: versionBrute
      ? {
          id: versionBrute.id,
          version_number: versionBrute.version_number,
          immersion_enabled: versionBrute.immersion_enabled,
          immersion_duration_seconds: versionBrute.immersion_duration_seconds,
          immersion_interval_minutes: versionBrute.immersion_interval_minutes,
          aeration_enabled: versionBrute.aeration_enabled,
          aeration_duration_seconds: versionBrute.aeration_duration_seconds,
          aeration_interval_minutes: versionBrute.aeration_interval_minutes,
          photoperiod_enabled: versionBrute.photoperiod_enabled,
          light_start_minutes: versionBrute.light_start_minutes,
          light_end_minutes: versionBrute.light_end_minutes,
          target_temperature: versionBrute.target_temperature,
          notes: versionBrute.notes,
        }
      : null,
    programme_nom: versionBrute?.bioreactor_programs?.name ?? null,
    objets: ((objets.data ?? []) as unknown[]).map((entree) => {
      const lien = entree as {
        id: string;
        role: string | null;
        device_id: string | null;
        connected_devices: {
          name: string | null;
          category: string | null;
          online: boolean | null;
          last_seen_at: string | null;
          manufacturer: string | null;
          model: string | null;
        } | null;
      };
      return {
        id: lien.id,
        role: lien.role,
        device_id: lien.device_id,
        nom: lien.connected_devices?.name ?? null,
        categorie: lien.connected_devices?.category ?? null,
        en_ligne: lien.connected_devices?.online ?? null,
        vu_le: lien.connected_devices?.last_seen_at ?? null,
        fabricant: lien.connected_devices?.manufacturer ?? null,
        modele: lien.connected_devices?.model ?? null,
      };
    }),
    cycles: (cycles.data ?? []) as Cycle[],
    entretiens: (entretiens.data ?? []) as Entretien[],
  };
}
