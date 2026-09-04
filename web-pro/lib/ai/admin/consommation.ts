import { decalageParisMs } from "../runtime/cost.ts";
import type { MotifPanne } from "../runtime/types.ts";

/**
 * §11X — CE QUE LE CLIENT CONSOMME, CÔTÉ CALCUL.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER REMPLACE `agregation.ts`, ET LA DIFFÉRENCE TIENT EN UN MOT
 * ══════════════════════════════════════════════════════════════════
 *
 * `agregation.ts` agrégeait des CENTIMES : il rendait un « coût IA du
 * mois », une « moyenne par décision » en euros, un ratio d'usage entre
 * trois niveaux de modèle. Tout cela existe toujours et reste
 * indispensable — mais chez l'éditeur, qui paie la facture du
 * fournisseur et arbitre la répartition. Un client à qui l'on montre ce
 * montant apprend le prix d'achat de son prestataire, pas le sien.
 *
 * Ce module agrège donc des VOLUMES : des appels, des jetons, des
 * durées. Ce ne sont pas les mêmes chiffres avec l'euro effacé au
 * dernier moment — la colonne `estimated_cost_cents` n'est même pas
 * demandée à la base (voir `lecture.ts`). Une donnée qu'on ne lit pas
 * ne peut pas se retrouver dans une propriété React par distraction.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'AGRÉGATION SE FAIT ICI ET PAS EN SQL
 * ══════════════════════════════════════════════════════════════════
 *
 * PostgREST ne sait pas grouper. Écrire une fonction SQL de plus serait
 * un objet à faire vivre pour un écran consulté quelques fois par mois,
 * et surtout un calcul de plus hors de portée des tests. On ramène donc
 * les lignes du mois et on agrège ici, dans une fonction pure.
 *
 * Le prix à payer est réel et il est BORNÉ, PAS IGNORÉ : la lecture est
 * plafonnée (`complet: false` quand elle a été tronquée) et l'écran dit
 * alors que les chiffres portent sur un échantillon. Un tableau calculé
 * sur la moitié d'un mois et présenté comme un mois entier ferait
 * conclure à l'aveugle.
 */

// ------------------------------------------------------------------
// La ligne du grand livre, telle que l'écran la lit
// ------------------------------------------------------------------

/**
 * Une ligne d'`ai_usage_events` (0076), déjà convertie et EXPURGÉE.
 *
 * Ni `model`, ni `estimated_cost_cents`, ni `cost_basis`, ni
 * `fallback_from_model` : ces quatre colonnes existent en base et
 * restent lisibles par un membre, mais elles décrivent l'achat de
 * l'éditeur, pas le travail du client. Elles n'entrent pas dans ce
 * type, donc elles n'entrent nulle part.
 */
export type AppelIA = {
  agent: string;
  jetonsEntree: number;
  jetonsSortie: number;
  dureeMs: number;
  succes: boolean;
  motifPanne: MotifPanne | null;
  decisionId: string | null;
  utilisateurId: string | null;
  /** L'horodatage ISO de `created_at`. */
  quand: string;
};

/**
 * LES COLONNES DEMANDÉES À `ai_usage_events`, ET AUCUNE AUTRE.
 *
 * La constante vit dans ce module PUR, et non à côté de la requête qui
 * s'en sert (`lecture.ts`), pour une seule raison : `lecture.ts` importe
 * `next/headers` et ne peut donc pas être chargé par `node --test`. Une
 * liste de colonnes rangée là-bas serait invérifiable, et c'est
 * précisément la liste qu'il faut vérifier — c'est elle qui décide de ce
 * qui peut fuir vers l'écran du client.
 *
 * Quatre colonnes de la table en sont ABSENTES, délibérément :
 * `model`, `estimated_cost_cents`, `cost_basis`, `fallback_from_model`.
 * Elles restent lisibles en base par tout membre, et le moteur en a
 * besoin ; mais elles décrivent l'achat de l'éditeur chez son
 * fournisseur, pas le travail du client. Ne pas les demander est plus
 * sûr que les demander et penser à ne pas les afficher.
 */
export const COLONNES_USAGE =
  "agent, input_tokens, output_tokens, duration_ms, success, failure_reason, " +
  "decision_id, user_id, created_at";

/** Les colonnes d'`ai_usage_events` que le client ne doit jamais recevoir. */
export const COLONNES_EDITEUR = [
  "model",
  "estimated_cost_cents",
  "cost_basis",
  "fallback_from_model",
] as const;

// ------------------------------------------------------------------
// Ce que l'écran reçoit
// ------------------------------------------------------------------

/** Un volume de travail demandé à Oasis. Trois compteurs, jamais négatifs. */
export type Volume = {
  appels: number;
  jetonsEntree: number;
  jetonsSortie: number;
};

export const VOLUME_VIDE: Volume = Object.freeze({
  appels: 0,
  jetonsEntree: 0,
  jetonsSortie: 0,
});

export function ajouterAppel(volume: Volume, ligne: AppelIA): Volume {
  return {
    appels: volume.appels + 1,
    jetonsEntree: volume.jetonsEntree + ligne.jetonsEntree,
    jetonsSortie: volume.jetonsSortie + ligne.jetonsSortie,
  };
}

export type LigneVentilation = {
  /** La clé du groupe : un agent, un utilisateur, une décision. */
  cle: string;
  volume: Volume;
};

export type LignePanne = {
  motif: MotifPanne | "inconnu";
  appels: number;
};

export type Consommation = {
  /** Depuis minuit, heure de Paris. */
  jour: Volume;
  /** Depuis le 1ᵉʳ du mois, minuit heure de Paris. */
  mois: Volume;

  /** Ventilation par agent, le plus sollicité d'abord. */
  parAgent: LigneVentilation[];
  /** Par utilisateur. La clé vaut `""` pour les appels sans auteur. */
  parUtilisateur: LigneVentilation[];
  /** Par décision. Seuls les appels rattachés à une décision y figurent. */
  parDecision: LigneVentilation[];

  decisionsDistinctes: number;
  utilisateursDistincts: number;

  /** Les appels refusés ou en échec du mois, par motif. */
  pannes: LignePanne[];
  appelsEnEchec: number;

  /**
   * La durée moyenne d'un appel, en millisecondes, ou `null`.
   *
   * `null` et non zéro quand il n'y a rien à moyenner : « aucun appel »
   * et « des appels instantanés » ne se ressemblent que sur un écran
   * qui confond les deux.
   */
  latenceMoyenneMs: number | null;

  /** Faux quand la lecture a été tronquée. */
  complet: boolean;
};

const VIDE: Consommation = {
  jour: VOLUME_VIDE,
  mois: VOLUME_VIDE,
  parAgent: [],
  parUtilisateur: [],
  parDecision: [],
  decisionsDistinctes: 0,
  utilisateursDistincts: 0,
  pannes: [],
  appelsEnEchec: 0,
  latenceMoyenneMs: null,
  complet: true,
};

/**
 * Agrège les appels du mois.
 *
 * `lignes` doit déjà être bornée au mois courant (heure de Paris) : la
 * fonction ne filtre pas ce qui est plus ancien, elle fait confiance à
 * la requête. Elle sépare en revanche le jour du mois elle-même, parce
 * que c'est un calcul de fuseau et qu'il doit être éprouvé.
 */
export function agregerConsommation(
  lignes: readonly AppelIA[],
  options: { maintenant?: Date; complet?: boolean } = {},
): Consommation {
  if (lignes.length === 0) {
    return { ...VIDE, complet: options.complet ?? true };
  }

  const debutJour = debutDuJourParis(options.maintenant ?? new Date()).getTime();

  let jour = VOLUME_VIDE;
  let mois = VOLUME_VIDE;

  const parAgent = new Map<string, Volume>();
  const parUtilisateur = new Map<string, Volume>();
  const parDecision = new Map<string, Volume>();
  const pannes = new Map<MotifPanne | "inconnu", number>();

  let dureeTotale = 0;
  let appelsEnEchec = 0;

  for (const ligne of lignes) {
    mois = ajouterAppel(mois, ligne);

    // `Date.parse` d'un horodatage illisible rend NaN, et `NaN >= x` est
    // faux : une ligne dont la date ne se lit pas sort du jour mais
    // reste dans le mois. C'est le bon sens de l'erreur — on ne
    // gonflera pas le chiffre du jour avec une ligne dont on ignore
    // quand elle a eu lieu.
    if (Date.parse(ligne.quand) >= debutJour) {
      jour = ajouterAppel(jour, ligne);
    }

    parAgent.set(ligne.agent, ajouterAppel(parAgent.get(ligne.agent) ?? VOLUME_VIDE, ligne));

    // La chaîne vide représente « aucun auteur » : `ai_usage_events`
    // laisse `user_id` à NULL quand le compte a été supprimé
    // (`on delete set null`). Le travail, lui, a bien eu lieu.
    const auteur = ligne.utilisateurId ?? "";
    parUtilisateur.set(auteur, ajouterAppel(parUtilisateur.get(auteur) ?? VOLUME_VIDE, ligne));

    if (ligne.decisionId !== null) {
      parDecision.set(
        ligne.decisionId,
        ajouterAppel(parDecision.get(ligne.decisionId) ?? VOLUME_VIDE, ligne),
      );
    }

    if (!ligne.succes) {
      appelsEnEchec += 1;
      const motif = ligne.motifPanne ?? "inconnu";
      pannes.set(motif, (pannes.get(motif) ?? 0) + 1);
    }

    dureeTotale += ligne.dureeMs;
  }

  return {
    jour,
    mois,
    parAgent: trier(parAgent),
    parUtilisateur: trier(parUtilisateur),
    parDecision: trier(parDecision),
    decisionsDistinctes: parDecision.size,
    utilisateursDistincts: parUtilisateur.size,
    pannes: [...pannes.entries()]
      .map(([motif, appels]) => ({ motif, appels }))
      .sort((a, b) => b.appels - a.appels),
    appelsEnEchec,
    latenceMoyenneMs: Math.round(dureeTotale / lignes.length),
    complet: options.complet ?? true,
  };
}

/**
 * Le classement d'une ventilation.
 *
 * Par nombre d'appels, puis par jetons. L'ancien module classait par
 * dépense connue, ce qui laissait le classement au hasard de l'ordre
 * d'insertion quand aucun tarif n'était renseigné. Le nombre d'appels
 * est toujours connu — c'est même la seule chose qui le soit toujours —
 * et les jetons départagent les rares égalités : dix questions courtes
 * et dix analyses de trois pages ne sont pas le même usage.
 */
function trier(groupes: Map<string, Volume>): LigneVentilation[] {
  return [...groupes.entries()]
    .map(([cle, volume]) => ({ cle, volume }))
    .sort((a, b) => {
      const parAppels = b.volume.appels - a.volume.appels;
      if (parAppels !== 0) return parAppels;
      const jetons = (v: Volume) => v.jetonsEntree + v.jetonsSortie;
      return jetons(b.volume) - jetons(a.volume);
    });
}

// ------------------------------------------------------------------
// Le jour parisien
// ------------------------------------------------------------------

/**
 * Le premier instant du jour EN HEURE DE PARIS, rendu en UTC.
 *
 * Le pendant de `debutDuMoisParis` (runtime/cost.ts), et pour la même
 * raison : la base borne SON jour sur `date_trunc('day', now() at time
 * zone 'Europe/Paris')`. Compter ici à partir de minuit UTC donnerait,
 * l'été, un « aujourd'hui » qui repart à zéro à deux heures du matin, et
 * un chiffre différent de celui que la base utilise pour couper. Deux
 * chiffres proches et discordants coûtent plus cher à démêler qu'un
 * seul franchement faux.
 *
 * La technique est empruntée à `debutDuMoisParis` et non recopiée : le
 * décalage vient de `decalageParisMs`, déjà éprouvé au passage à
 * l'heure d'été.
 */
export function debutDuJourParis(maintenant: Date = new Date()): Date {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(maintenant);

  const annee = Number(parties.find((p) => p.type === "year")?.value);
  const mois = Number(parties.find((p) => p.type === "month")?.value);
  const jour = Number(parties.find((p) => p.type === "day")?.value);

  const minuitNaif = Date.UTC(annee, mois - 1, jour, 0, 0, 0, 0);
  return new Date(minuitNaif - decalageParisMs(new Date(minuitNaif)));
}
