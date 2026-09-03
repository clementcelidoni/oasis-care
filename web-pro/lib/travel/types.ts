/**
 * §11V — TRAVEL COST ENGINE, le vocabulaire.
 *
 * La spec (p. 12) demande sept grandeurs : distance, temps de trajet,
 * distance aller-retour, nombre de trajets, heures humaines de
 * déplacement, coût véhicule, péages éventuels.
 *
 * POURQUOI UN TYPE `PeutEtreInconnu` PLUTÔT QUE `number | null`.
 *
 * La page 2 de la spec interdit d'inventer un coût, et interdit tout
 * autant de rendre zéro à la place d'une donnée absente. Un `number |
 * null` respecte la lettre de cette règle et la trahit à l'usage :
 * l'appelant écrit `?? 0` au premier affichage un peu pressé, et le
 * chiffre inventé revient par la porte de service. En obligeant à
 * ouvrir un objet pour lire la valeur, on rend le raccourci visible ;
 * et le motif voyage AVEC l'absence, donc l'écran a toujours de quoi
 * dire pourquoi il ne sait pas.
 *
 * Rien ici n'est asynchrone et rien n'appelle la base : ce fichier et
 * ses voisins `distance.ts` / `cost.ts` sont des fonctions pures, ce
 * qui est la seule façon de tester un calcul qui alimente un prix.
 */

/** Une valeur disponible, avec la source qui permet de la contester. */
export type Connu<T> = { connu: true; valeur: T; source: string };

/** Une valeur absente, avec le motif et la phrase à montrer. */
export type Inconnu = { connu: false; motif: string; explication: string };

export type PeutEtreInconnu<T> = Connu<T> | Inconnu;

export function connu<T>(valeur: T, source: string): Connu<T> {
  return { connu: true, valeur, source };
}

export function inconnu(motif: string, explication: string): Inconnu {
  return { connu: false, motif, explication };
}

export type Coordonnees = { latitude: number; longitude: number };

/**
 * D'où viennent les coordonnées d'un bout du trajet.
 *
 * La distinction n'est pas cosmétique : `coordonneesSaisies` désigne un
 * point relevé sur le site du client, `centreCommune` désigne la mairie
 * de sa ville. Sur un chantier à trois kilomètres du bourg, l'écart est
 * réel, et l'écran doit pouvoir le dire.
 */
export type OrigineCoordonnees = "coordonneesSaisies" | "centreCommune" | "inconnue";

export type PointGeographique = {
  /** Ce qu'on montre à l'écran : « 06800 Cagnes-sur-Mer ». */
  libelle: string;
  commune: string | null;
  codePostal: string | null;
  coordonnees: Coordonnees | null;
  origine: OrigineCoordonnees;
};

/**
 * FACTEUR DE SINUOSITÉ — 1,30.
 *
 * Une distance à vol d'oiseau n'est pas une distance routière. Le
 * rapport entre les deux — l'indice de détour — vaut couramment entre
 * 1,25 et 1,35 en France métropolitaine sur des trajets
 * interurbains ; il monte en montagne et sur un littoral découpé, il
 * descend en plaine autoroutière.
 *
 * On retient 1,30, valeur médiane de cette plage. Ce n'est pas une
 * mesure : toute sortie qui s'en sert est marquée `estimation` et le
 * facteur est rendu avec le résultat, pour qu'un utilisateur qui
 * connaît sa région puisse dire « chez moi c'est plutôt 1,5 » au lieu
 * de croire un chiffre tombé du ciel.
 */
export const FACTEUR_SINUOSITE = 1.3;

/**
 * VITESSES MOYENNES DE PORTE À PORTE, en km/h, par tranche de distance.
 *
 * Elles incluent les sorties de zone urbaine, les ronds-points et les
 * arrêts : c'est pour cela qu'elles sont basses. Un trajet court est
 * presque entièrement urbain, un trajet long finit par gagner une voie
 * rapide.
 *
 * Ce modèle est GROSSIER et le sait. Sur la Côte d'Azur en été, il
 * sous-estimera largement. C'est pourquoi l'écran laisse saisir un
 * temps de trajet réel, qui prend alors le pas sur toute estimation :
 * l'exemple de la spec — « depuis le siège : 46 min » — est une donnée
 * connue de l'entreprise, pas un calcul.
 */
export const VITESSES_MOYENNES_KMH: ReadonlyArray<{ jusquaKm: number; vitesseKmH: number }> = [
  { jusquaKm: 5, vitesseKmH: 25 },
  { jusquaKm: 20, vitesseKmH: 40 },
  { jusquaKm: 50, vitesseKmH: 55 },
  { jusquaKm: Number.POSITIVE_INFINITY, vitesseKmH: 70 },
];

/**
 * Deux trajets par jour et par personne : on part le matin, on rentre
 * le soir. C'est l'hypothèse de la spec (aller-retour quotidien) et
 * elle est fausse dès qu'on découche — d'où sa présence explicite dans
 * la sortie plutôt qu'enfouie dans une multiplication.
 */
export const TRAJETS_PAR_JOUR = 2;

export type Confiance = "insufficient_data" | "low" | "medium" | "high";

export type DetailDistance = {
  volDoiseauKm: number;
  facteurSinuosite: number;
  allerKm: number;
  allerRetourKm: number;
  /** Toujours vrai dans cette itération : aucun distancier routier n'est interrogé. */
  estimation: true;
  origineDepart: OrigineCoordonnees;
  origineArrivee: OrigineCoordonnees;
};

export type DetailTemps = {
  allerMinutes: number;
  allerRetourMinutes: number;
  origine: "fourniParLUtilisateur" | "estimeDepuisLaDistance";
  vitesseMoyenneKmH: number | null;
};

export type DetailTrajets = {
  /** Aller-retour quotidien : deux trajets simples par jour et par personne. */
  trajetsParPersonne: number;
  /**
   * Les mêmes trajets, comptés par véhicule. `null` tant que le nombre
   * de véhicules n'est pas posé — quatre personnes peuvent partir dans
   * une camionnette ou dans quatre voitures, et rien en base ne le dit.
   */
  trajetsVehicules: number | null;
  nombreDeVehicules: number | null;
  kmTotauxVehicules: number | null;
};

export type DetailHeuresHumaines = {
  heures: number;
  /** « 30 h 40 » — la forme lisible, calculée une fois. */
  libelle: string;
  effectif: number;
  joursChantier: number;
};

export type PosteDeCout = "heuresHumaines" | "vehicule" | "peages";

export type CoutTotal = {
  /** Vrai seulement si les trois postes sont connus. */
  complet: boolean;
  /** Somme des postes CONNUS. `null` s'il n'y en a aucun. */
  totalCents: number | null;
  postesRetenus: PosteDeCout[];
  postesManquants: PosteDeCout[];
};

export type VerdictDeplacement =
  | "insufficientData"
  | "sousChiffragePotentiel"
  | "coherent"
  | "devisSuperieurAuBesoin";

export type ComparaisonAuDevis = {
  verdict: VerdictDeplacement;
  heuresEstimees: number | null;
  heuresDevisees: number | null;
  ecartHeures: number | null;
  explication: string;
};

export type HypothesesDeplacement = {
  effectif: number | null;
  joursChantier: number | null;
  nombreDeVehicules: number | null;
  tempsAllerMinutesFourni: number | null;
  tauxHoraireCents: PeutEtreInconnu<number>;
  coutVehiculeParKmCents: PeutEtreInconnu<number>;
  peagesAllerRetourCents: PeutEtreInconnu<number>;
  heuresDeplacementDevisees: PeutEtreInconnu<number>;
};

export type EntreeTravelCost = {
  siege: PointGeographique;
  chantier: PointGeographique;
  hypotheses: HypothesesDeplacement;
};

export type ResultatTravelCost = {
  siege: PointGeographique;
  chantier: PointGeographique;
  trajetsParJour: number;
  distance: PeutEtreInconnu<DetailDistance>;
  temps: PeutEtreInconnu<DetailTemps>;
  trajets: PeutEtreInconnu<DetailTrajets>;
  heuresHumaines: PeutEtreInconnu<DetailHeuresHumaines>;
  coutHumainCents: PeutEtreInconnu<number>;
  coutVehiculeCents: PeutEtreInconnu<number>;
  peagesCents: PeutEtreInconnu<number>;
  coutTotal: CoutTotal;
  comparaisonAuDevis: ComparaisonAuDevis;
  confiance: Confiance;
  avertissements: string[];
};

/**
 * « 30 h 40 » plutôt que « 30,67 h ».
 *
 * La spec écrit ses durées ainsi, et c'est aussi la façon dont un chef
 * d'entreprise lit un temps de chantier. L'arrondi se fait à la minute
 * la plus proche : afficher 30 h 40,2 serait une précision empruntée à
 * une estimation qui ne la mérite pas.
 */
export function formatHeuresMinutes(heures: number): string {
  const minutesTotales = Math.round(heures * 60);
  const h = Math.floor(minutesTotales / 60);
  const m = minutesTotales % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
