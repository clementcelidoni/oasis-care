import { decalageParisMs, type LigneRepartition } from "../runtime/cost.ts";
import type { MotifPanne } from "../runtime/types.ts";
import {
  DEPENSE_VIDE,
  ajouterAppel,
  moyenneCents,
  type Depense,
} from "./montants.ts";

/**
 * §11V — LE TABLEAU DE BORD DES COÛTS, CÔTÉ CALCUL (spec p. 18-19).
 *
 *     Coût IA aujourd'hui · Coût IA mois · Coût moyen / organisation
 *     Coût / agent · Coût / décision · Coût / utilisateur
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'AGRÉGATION SE FAIT ICI ET PAS EN SQL
 * ══════════════════════════════════════════════════════════════════
 *
 * PostgREST ne sait pas grouper. On pourrait écrire une fonction SQL de
 * plus ; ce serait un huitième objet à faire vivre dans 0076 pour un
 * écran d'administration consulté quelques fois par mois, et surtout un
 * calcul de plus hors de portée des tests. On ramène donc les lignes du
 * mois et on agrège ici, dans une fonction pure.
 *
 * Le prix à payer est réel et il est BORNÉ, PAS IGNORÉ : la lecture est
 * plafonnée (`complet: false` quand elle a été tronquée) et l'écran dit
 * alors que les chiffres portent sur un échantillon. Un tableau de bord
 * calculé sur la moitié d'un mois et présenté comme un mois entier
 * ferait arbitrer à l'aveugle — c'est déjà la doctrine de
 * `Repartition.complet` dans `runtime/cost.ts`, on la reprend telle
 * quelle.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI N'EST PAS CALCULABLE ICI, ET POURQUOI ON LE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * « COÛT MOYEN / ORGANISATION » (p. 18) suppose de voir PLUSIEURS
 * organisations. Sur Oasis Care Pro, la RLS n'en montre qu'une : celle
 * de la session. La moyenne de la flotte appartient au Control Center
 * (`web-admin`), qui est l'application de l'éditeur et voit tout le
 * parc. Cet écran-ci rend donc le total de SON entreprise, et le dit ;
 * afficher « coût moyen par organisation : 41,20 € » alors qu'on ne
 * regarde qu'une seule organisation aurait été un chiffre juste sous
 * une étiquette fausse.
 */

// ------------------------------------------------------------------
// La ligne du grand livre, telle que l'écran la lit
// ------------------------------------------------------------------

/** Une ligne d'`ai_usage_events` (0076), déjà convertie. */
export type AppelIA = {
  agent: string;
  modele: string;
  /** `null` = tarif inconnu. JAMAIS 0 pour dire « on ne sait pas ». */
  coutCents: number | null;
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

// ------------------------------------------------------------------
// Ce que l'écran reçoit
// ------------------------------------------------------------------

export type LigneVentilation = {
  /** La clé du groupe : un agent, un utilisateur, une décision. */
  cle: string;
  depense: Depense;
};

export type LignePanne = {
  motif: MotifPanne | "inconnu";
  appels: number;
};

export type TableauCouts = {
  /** Depuis minuit, heure de Paris. */
  jour: Depense;
  /** Depuis le 1ᵉʳ du mois, minuit heure de Paris. */
  mois: Depense;

  /** Ventilation par agent, la plus chère d'abord. */
  parAgent: LigneVentilation[];
  /** Par utilisateur. La clé vaut `""` pour les appels sans auteur. */
  parUtilisateur: LigneVentilation[];
  /** Par décision. Seuls les appels rattachés à une décision y figurent. */
  parDecision: LigneVentilation[];

  /** Les appels du mois groupés par modèle, pour `repartirParNiveau`. */
  parModele: LigneRepartition[];

  /** La part rattachée à une décision, et sa moyenne. */
  depenseRattachee: Depense;
  decisionsDistinctes: number;
  moyenneParDecisionCents: number | null;

  utilisateursDistincts: number;
  moyenneParUtilisateurCents: number | null;

  /** Les échecs du mois, par motif. Un plafond qui coupe y figure. */
  pannes: LignePanne[];
  appelsEnEchec: number;

  jetonsEntree: number;
  jetonsSortie: number;
  /** La durée moyenne d'un appel, en millisecondes, ou `null`. */
  latenceMoyenneMs: number | null;

  /** Faux quand la lecture a été tronquée. */
  complet: boolean;
};

const VIDE: TableauCouts = {
  jour: DEPENSE_VIDE,
  mois: DEPENSE_VIDE,
  parAgent: [],
  parUtilisateur: [],
  parDecision: [],
  parModele: [],
  depenseRattachee: DEPENSE_VIDE,
  decisionsDistinctes: 0,
  moyenneParDecisionCents: null,
  utilisateursDistincts: 0,
  moyenneParUtilisateurCents: null,
  pannes: [],
  appelsEnEchec: 0,
  jetonsEntree: 0,
  jetonsSortie: 0,
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
export function agregerAppels(
  lignes: readonly AppelIA[],
  options: { maintenant?: Date; complet?: boolean } = {},
): TableauCouts {
  if (lignes.length === 0) {
    return { ...VIDE, complet: options.complet ?? true };
  }

  const debutJour = debutDuJourParis(options.maintenant ?? new Date()).getTime();

  let jour = DEPENSE_VIDE;
  let mois = DEPENSE_VIDE;
  let rattachee = DEPENSE_VIDE;

  const parAgent = new Map<string, Depense>();
  const parUtilisateur = new Map<string, Depense>();
  const parDecision = new Map<string, Depense>();
  const parModele = new Map<string, { appels: number; coutCents: number | null }>();
  const pannes = new Map<MotifPanne | "inconnu", number>();

  let jetonsEntree = 0;
  let jetonsSortie = 0;
  let dureeTotale = 0;
  let appelsEnEchec = 0;

  for (const ligne of lignes) {
    mois = ajouterAppel(mois, ligne.coutCents);

    // `Date.parse` d'un horodatage illisible rend NaN, et `NaN >= x` est
    // faux : une ligne dont la date ne se lit pas sort du jour mais
    // reste dans le mois. C'est le bon sens de l'erreur — on ne
    // gonflera pas le chiffre du jour avec une ligne dont on ignore
    // quand elle a eu lieu.
    if (Date.parse(ligne.quand) >= debutJour) {
      jour = ajouterAppel(jour, ligne.coutCents);
    }

    parAgent.set(ligne.agent, ajouterAppel(parAgent.get(ligne.agent) ?? DEPENSE_VIDE, ligne.coutCents));

    // La chaîne vide représente « aucun auteur » : `ai_usage_events`
    // laisse `user_id` à NULL quand le compte a été supprimé
    // (`on delete set null`). La dépense, elle, a bien eu lieu.
    const auteur = ligne.utilisateurId ?? "";
    parUtilisateur.set(
      auteur,
      ajouterAppel(parUtilisateur.get(auteur) ?? DEPENSE_VIDE, ligne.coutCents),
    );

    if (ligne.decisionId !== null) {
      rattachee = ajouterAppel(rattachee, ligne.coutCents);
      parDecision.set(
        ligne.decisionId,
        ajouterAppel(parDecision.get(ligne.decisionId) ?? DEPENSE_VIDE, ligne.coutCents),
      );
    }

    const modele = parModele.get(ligne.modele) ?? { appels: 0, coutCents: 0 };
    parModele.set(ligne.modele, {
      appels: modele.appels + 1,
      // Ici `null` CONTAMINE, contrairement à `Depense` : ce total-là
      // part dans `repartirParNiveau`, dont le contrat (runtime/cost.ts)
      // est qu'un coût inconnu rend la somme inconnue, pas plus petite.
      coutCents:
        modele.coutCents === null || ligne.coutCents === null
          ? null
          : modele.coutCents + ligne.coutCents,
    });

    if (!ligne.succes) {
      appelsEnEchec += 1;
      const motif = ligne.motifPanne ?? "inconnu";
      pannes.set(motif, (pannes.get(motif) ?? 0) + 1);
    }

    jetonsEntree += ligne.jetonsEntree;
    jetonsSortie += ligne.jetonsSortie;
    dureeTotale += ligne.dureeMs;
  }

  return {
    jour,
    mois,
    parAgent: trier(parAgent),
    parUtilisateur: trier(parUtilisateur),
    parDecision: trier(parDecision),
    parModele: [...parModele.entries()].map(([modele, agg]) => ({
      modele,
      appels: agg.appels,
      coutCents: agg.coutCents,
    })),
    depenseRattachee: rattachee,
    decisionsDistinctes: parDecision.size,
    moyenneParDecisionCents: moyenneCents(rattachee, parDecision.size),
    utilisateursDistincts: parUtilisateur.size,
    moyenneParUtilisateurCents: moyenneCents(mois, parUtilisateur.size),
    pannes: [...pannes.entries()]
      .map(([motif, appels]) => ({ motif, appels }))
      .sort((a, b) => b.appels - a.appels),
    appelsEnEchec,
    jetonsEntree,
    jetonsSortie,
    latenceMoyenneMs: Math.round(dureeTotale / lignes.length),
    complet: options.complet ?? true,
  };
}

/**
 * Le classement d'une ventilation.
 *
 * Par dépense CONNUE d'abord, puis par nombre d'appels. Le second
 * critère n'est pas décoratif : sans tarif renseigné, toutes les
 * dépenses valent zéro et le classement serait celui de l'ordre
 * d'insertion — c'est-à-dire aucun. Le nombre d'appels reste alors la
 * seule information de volume disponible, et il vaut mieux que rien.
 */
function trier(groupes: Map<string, Depense>): LigneVentilation[] {
  return [...groupes.entries()]
    .map(([cle, depense]) => ({ cle, depense }))
    .sort((a, b) => {
      const parCout = b.depense.centsConnus - a.depense.centsConnus;
      return parCout !== 0 ? parCout : b.depense.appels - a.depense.appels;
    });
}

// ------------------------------------------------------------------
// Le jour parisien
// ------------------------------------------------------------------

/**
 * Le premier instant du jour EN HEURE DE PARIS, rendu en UTC.
 *
 * Le pendant de `debutDuMoisParis` (runtime/cost.ts), et pour la même
 * raison : `ai_cost_budget_remaining` (0076) borne SON jour sur
 * `date_trunc('day', now() at time zone 'Europe/Paris')`. Compter ici à
 * partir de minuit UTC donnerait, l'été, un « coût d'aujourd'hui » qui
 * repart à zéro à deux heures du matin, et un chiffre différent de
 * celui que le plafond utilise pour couper. Deux chiffres proches et
 * discordants coûtent plus cher à démêler qu'un seul franchement faux.
 *
 * La technique est celle de `debutDuMoisParis`, empruntée et non
 * recopiée : le décalage vient de `decalageParisMs`, qui est déjà
 * éprouvé au passage à l'heure d'été.
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
