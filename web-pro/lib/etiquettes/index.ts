/**
 * LA GÉNÉRATION ET L'IMPRESSION DES ÉTIQUETTES — § 16, § 17, § 18.
 *
 * ------------------------------------------------------------------
 * CE QUE CETTE BIBLIOTHÈQUE FAIT, ET CE QU'ELLE NE FAIT PAS
 * ------------------------------------------------------------------
 *
 * ELLE FAIT : encoder un QR (ISO/IEC 18004, versions 1 à 10) et un
 * code-barres Code 39, composer une étiquette à partir d'un modèle du
 * § 18, la poser sur un rouleau ou sur une planche A4 aux cotes
 * exactes, et rendre le tout en SVG (pour le navigateur) ou en PDF
 * (pour tout le reste). Zéro dépendance, zéro appel réseau.
 *
 * ELLE NE FAIT PAS : parler à la base de données, connaître un domaine,
 * fabriquer un jeton, ni décider qui a le droit d'imprimer quoi. Une
 * étiquette entre sous la forme « une adresse + des valeurs » ; d'où
 * vient l'adresse est l'affaire du résolveur (§ 15) et de la migration
 * 0090.
 *
 * ------------------------------------------------------------------
 * LE PILOTAGE DIRECT DES IMPRIMANTES THERMIQUES : CE QUI EST POSSIBLE
 * ------------------------------------------------------------------
 *
 * Le § 17 cite « imprimantes thermiques, Zebra, Brother, Dymo ». Il faut
 * être net sur ce qu'une page web sait faire.
 *
 * CE QUI MARCHE, ET QUE CETTE BIBLIOTHÈQUE LIVRE : un PDF dont la page
 * fait EXACTEMENT la taille de l'étiquette. Une Zebra, une Brother ou
 * une Dymo installée comme imprimante du système l'avale par son
 * pilote, comme n'importe quel document — à condition que le format
 * déclaré corresponde au rouleau chargé. C'est le chemin normal, il
 * couvre l'essentiel du § 17, et il ne demande rien à installer de plus
 * que le pilote que l'imprimante exige de toute façon.
 *
 * CE QUI N'EST PAS POSSIBLE DEPUIS UNE PAGE WEB, ET QUE JE NE PROMETS
 * PAS : produire du ZPL pour une Zebra, du b-PAC pour une Brother, ou
 * piloter une Dymo par son SDK. Ces trois chemins passent par un
 * logiciel installé sur le poste (Zebra Browser Print, b-PAC, DYMO
 * Connect) qui expose un service local ; la page devrait lui parler en
 * cross-origin sur localhost. C'est fragile, c'est à installer poste
 * par poste, cela dépend de la version du logiciel, et ce n'est pas un
 * pilote que nous pouvons livrer. Si le ZPL devient un besoin réel, ce
 * sera un petit utilitaire local, pas une page.
 *
 * ------------------------------------------------------------------
 * LES DEUX CHEMINS D'IMPRESSION, ET LEQUEL CHOISIR
 * ------------------------------------------------------------------
 *
 *   • PDF DIRECT (`plancheVersPdf`) — les cotes sont dans le MediaBox,
 *     rien ne peut les changer. C'est le chemin des thermiques et de
 *     tout ce qui doit sortir juste sans que personne ne vérifie un
 *     réglage. Il n'incorpore pas les logos en image (voir pdf.ts).
 *   • SVG + « Imprimer » DU NAVIGATEUR (`plancheVersSvg` +
 *     `cssImpressionPlanche`) — l'aperçu est fidèle, les logos passent,
 *     et « Enregistrer au format PDF » fait le reste. Mais l'échelle et
 *     les marges dépendent de la boîte de dialogue : d'où la règle de
 *     contrôle de 50 mm imprimée en pied de planche.
 */

export {
  encoderQr,
  capaciteDonnees,
  capaciteBrute,
  VERSION_MAX,
  type MatriceQr,
  type ModeQr,
  type NiveauCorrection,
} from "./qr.ts";

export {
  encoderCode39,
  estEncodableCode39,
  normaliserPourCode39,
  moduleCode39Mm,
  CARACTERES_CODE39,
  type Code39,
} from "./code39.ts";

export {
  MM_PAR_POUCE,
  POINTS_PAR_POUCE,
  arrondiMm,
  largeurTexteMm,
  mmVersPoints,
  pointsVersMm,
} from "./mesures.ts";

export {
  A4_HAUTEUR_MM,
  A4_LARGEUR_MM,
  COTE_MAXIMALE_MM,
  FORMATS_ETIQUETTE,
  LARGEUR_MINIMALE_MM,
  BAS_IMPRIMABLE_A4_MM,
  MARGE_A4_MINIMALE_MM,
  caseGrille,
  formatEtiquette,
  formatPersonnalise,
  grilleA4,
  type CleFormatEtiquette,
  type FormatEtiquette,
  type GrilleA4,
  type OptionsGrilleA4,
} from "./formats.ts";

export {
  CORPS_MINIMAL_PT,
  MODULE_QR_MINIMAL_MM,
  SILENCE_QR_MODULES,
  donneesExemple,
  rendreEtiquette,
  verifierModele,
  type OptionsRendu,
} from "./rendu.ts";

export { documentSvg, elementsVersSvg, PILE_POLICES } from "./svg.ts";
export { ecrirePdf, lireCotesPdf, versWinAnsi, type PagePdf } from "./pdf.ts";

export {
  LONGUEUR_REGLE_MM,
  composerPlanche,
  cssImpressionPlanche,
  elementsRegleDeControle,
  plancheDeControle,
  plancheVersPdf,
  plancheVersSvg,
  type OptionsPlanche,
  type PagePlanche,
  type Planche,
  type SupportPlanche,
} from "./planche.ts";

export {
  POINT_203_DPI_MM,
  POINT_300_DPI_MM,
  SEUIL_CONFORTABLE_MM,
  SEUIL_LIMITE_MM,
  coteQrMaximalMm,
  longueurContenuMaximale,
  mesurerDensiteQr,
  tableauDensite,
  type LigneTableauDensite,
  type LongueurMaximale,
  type MesureDensiteQr,
  type VerdictLecture,
} from "./densite.ts";

export {
  CHAMPS_ETIQUETTE,
  type AvertissementRendu,
  type ChampEtiquette,
  type ChampPlace,
  type DonneesEtiquette,
  type ElementRendu,
  type EtiquetteRendue,
  type FamilleEtiquette,
  type ModeleEtiquette,
} from "./types.ts";

export { JETON_0090, adresseEtiquette, adressesEtiquettes, type OptionsAdresse } from "./adresse.ts";

export { MODELES_OASIS, modeleOasis } from "./modeles.ts";
