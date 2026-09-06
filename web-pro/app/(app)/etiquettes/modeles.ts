/**
 * LES MODÈLES : DE LA BASE À L'ÉCRAN, ET RETOUR — § 18.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS REPRÉSENTATIONS DU MÊME MODÈLE, ET IL FAUT LES TENIR ENSEMBLE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. LA LIGNE `etiquette_modeles` — colonnes en `snake_case`,
 *      cotes en `numeric(7,2)`, champs en `jsonb`.
 *   2. LE TYPE `ModeleEtiquette` de `lib/etiquettes` — camelCase, tout
 *      en nombres, c'est lui que le moteur de rendu comprend.
 *   3. CE QUE L'ÉDITEUR RENVOIE — un formulaire, donc des CHAÎNES, y
 *      compris pour les millimètres.
 *
 * Les conversions vivent ici, et nulle part ailleurs. Une conversion
 * recopiée dans un composant est une conversion qui divergera : c'est
 * ainsi qu'on finit par afficher 2 mm et enregistrer 2,00 puis relire
 * « 2.00 » comme du texte.
 *
 * ══════════════════════════════════════════════════════════════════
 * TOUT CE QUI ENTRE EST SUSPECT
 * ══════════════════════════════════════════════════════════════════
 *
 * `champs` est du `jsonb` : la base vérifie sa forme
 * (`etiquette_champs_valides`), mais elle ne peut pas empêcher une
 * version antérieure du produit d'y avoir laissé une clé inconnue. Et
 * le formulaire, lui, vient du navigateur. On analyse donc défensive-
 * ment dans les deux sens, et on JETTE ce qu'on ne comprend pas plutôt
 * que de le laisser filer jusqu'au moteur de rendu.
 */

import {
  CHAMPS_ETIQUETTE,
  MODELES_OASIS,
  verifierModele,
  type ChampEtiquette,
  type ChampPlace,
  type FamilleEtiquette,
  type ModeleEtiquette,
} from "../../../lib/etiquettes/index.ts";
import { FAMILLES } from "./familles.ts";

/** Ce que la table rend, plus ce que l'écran a besoin de savoir. */
export type ModeleEnregistre = ModeleEtiquette & {
  readonly id: string;
  /** `null` = modèle fourni par Oasis : lisible par tous, modifiable par personne. */
  readonly organizationId: string | null;
  readonly estDefaut: boolean;
  /** Un modèle Oasis ne s'édite pas. Il se DUPLIQUE. */
  readonly modifiable: boolean;
};

function nombre(valeur: unknown, defaut: number): number {
  if (typeof valeur === "number" && Number.isFinite(valeur)) return valeur;
  if (typeof valeur === "string") {
    // La base peut rendre un `numeric` en chaîne selon le connecteur ;
    // et un formulaire écrit « 12,5 » en français.
    const propre = Number(valeur.replace(",", "."));
    if (Number.isFinite(propre)) return propre;
  }
  return defaut;
}

function booleen(valeur: unknown): boolean {
  return valeur === true || valeur === "true" || valeur === "on" || valeur === 1;
}

function estChamp(valeur: unknown): valeur is ChampEtiquette {
  return typeof valeur === "string" && (CHAMPS_ETIQUETTE as readonly string[]).includes(valeur);
}

export function estFamille(valeur: unknown): valeur is FamilleEtiquette {
  return typeof valeur === "string" && (FAMILLES as readonly string[]).includes(valeur);
}

/**
 * Analyse la liste `champs` d'un modèle.
 *
 * UN CHAMP INCONNU EST SILENCIEUSEMENT ÉCARTÉ, et c'est le bon choix
 * ici plutôt qu'une exception : un modèle enregistré par une version
 * ultérieure du produit doit continuer de s'imprimer, amputé du champ
 * qu'on ne sait pas rendre, plutôt que de rendre tout l'écran
 * inutilisable. Le nombre de champs écartés est rendu à part, pour que
 * l'écran puisse le dire au lieu de le taire.
 */
export function analyserChamps(brut: unknown): { champs: ChampPlace[]; ecartes: number } {
  if (!Array.isArray(brut)) return { champs: [], ecartes: 0 };

  const champs: ChampPlace[] = [];
  let ecartes = 0;

  for (const element of brut) {
    if (!element || typeof element !== "object") {
      ecartes += 1;
      continue;
    }
    const objet = element as Record<string, unknown>;
    if (!estChamp(objet.champ)) {
      ecartes += 1;
      continue;
    }

    const place: ChampPlace = {
      champ: objet.champ,
      x: nombre(objet.x, 0),
      y: nombre(objet.y, 0),
      largeur: nombre(objet.largeur, 0),
      hauteur: nombre(objet.hauteur, 0),
      ...(objet.taille !== undefined && objet.taille !== null
        ? { taille: nombre(objet.taille, 0) }
        : {}),
      ...(objet.gras !== undefined ? { gras: booleen(objet.gras) } : {}),
      ...(objet.italique !== undefined ? { italique: booleen(objet.italique) } : {}),
      ...(objet.alignement === "centre" || objet.alignement === "droite"
        ? { alignement: objet.alignement }
        : {}),
      ...(objet.cadre !== undefined ? { cadre: booleen(objet.cadre) } : {}),
    };

    if (!(place.largeur > 0) || !(place.hauteur > 0)) {
      ecartes += 1;
      continue;
    }
    champs.push(place);
  }

  return { champs, ecartes };
}

/** Une ligne d'`etiquette_modeles` telle que PostgREST la rend. */
export type LigneModele = Record<string, unknown>;

export function versModele(ligne: LigneModele): ModeleEnregistre {
  const organizationId = typeof ligne.organization_id === "string" ? ligne.organization_id : null;
  const famille = estFamille(ligne.famille) ? ligne.famille : "jardins";
  const { champs } = analyserChamps(ligne.champs);

  return {
    id: String(ligne.id ?? ""),
    organizationId,
    famille,
    nom: typeof ligne.nom === "string" && ligne.nom.trim() !== "" ? ligne.nom : "Modèle",
    largeurMm: nombre(ligne.largeur_mm, 50),
    hauteurMm: nombre(ligne.hauteur_mm, 30),
    margeMm: nombre(ligne.marge_mm, 1.5),
    champs,
    estDefaut: booleen(ligne.est_defaut),
    modifiable: organizationId !== null,
  };
}

/**
 * Le modèle à proposer pour une famille, parmi ceux qu'on a lus.
 *
 * L'ORDRE DE PRÉFÉRENCE, ET SA RAISON :
 *   1. le défaut de l'entreprise — elle l'a choisi, il gagne ;
 *   2. n'importe quel modèle de l'entreprise pour cette famille ;
 *   3. le modèle Oasis — il existe toujours, semé par 0090 § 8.b.
 *
 * Cette fonction ne rend jamais `undefined` tant que les modèles Oasis
 * sont présents ; l'appelant qui n'aurait rien du tout retombe sur
 * `MODELES_OASIS`, la copie locale, pour que l'éditeur ne s'ouvre pas
 * sur une page blanche au premier aller-retour serveur.
 */
export function modelePrefere(
  modeles: readonly ModeleEnregistre[],
  famille: FamilleEtiquette,
): ModeleEnregistre | null {
  const deLaFamille = modeles.filter((m) => m.famille === famille);
  return (
    deLaFamille.find((m) => m.organizationId !== null && m.estDefaut) ??
    deLaFamille.find((m) => m.organizationId !== null) ??
    deLaFamille.find((m) => m.organizationId === null) ??
    null
  );
}

/** Le modèle Oasis d'une famille, en repli hors ligne. */
export function modeleDeSecours(famille: FamilleEtiquette): ModeleEtiquette {
  return MODELES_OASIS[famille];
}

// ══════════════════════════════════════════════════════════════════
// DU FORMULAIRE VERS LA BASE
// ══════════════════════════════════════════════════════════════════

export type BrouillonModele = {
  readonly famille: FamilleEtiquette;
  readonly nom: string;
  readonly largeurMm: number;
  readonly hauteurMm: number;
  readonly margeMm: number;
  readonly champs: ChampPlace[];
  readonly estDefaut: boolean;
};

/**
 * Ce que l'éditeur envoie, remis en forme et vérifié.
 *
 * POURQUOI LES CHAMPS ARRIVENT EN JSON PLUTÔT QU'EN CHAMPS DE
 * FORMULAIRE. Un modèle porte de zéro à douze champs, chacun avec huit
 * réglages : en `<input name="champs[3].x">` cela ferait une centaine
 * d'entrées à recoller côté serveur, et une seule faute d'indice
 * décalerait tout un modèle sans que rien ne proteste. L'éditeur tient
 * l'état en mémoire, le sérialise une fois, et le serveur le relit avec
 * `analyserChamps` — le même analyseur défensif que pour la base.
 */
export function lireBrouillon(formData: FormData): {
  brouillon: BrouillonModele | null;
  fautes: string[];
} {
  const fautes: string[] = [];

  const familleBrute = String(formData.get("famille") ?? "");
  if (!estFamille(familleBrute)) {
    fautes.push("Famille de modèle inconnue.");
  }

  const nom = String(formData.get("nom") ?? "").trim();
  if (nom === "") fautes.push("Donnez un nom à ce modèle : c'est ainsi qu'on le retrouve.");
  if (nom.length > 120) fautes.push("Le nom du modèle ne peut pas dépasser 120 caractères.");

  const largeurMm = nombre(formData.get("largeur_mm"), Number.NaN);
  const hauteurMm = nombre(formData.get("hauteur_mm"), Number.NaN);
  const margeMm = nombre(formData.get("marge_mm"), 1.5);

  for (const [libelle, valeur] of [
    ["largeur", largeurMm],
    ["hauteur", hauteurMm],
  ] as const) {
    if (!Number.isFinite(valeur) || valeur <= 0) {
      fautes.push(`La ${libelle} de l'étiquette doit être un nombre de millimètres positif.`);
    } else if (valeur > 1000) {
      // La même borne que la base (0090 § 8, `<= 1000`). Les deux
      // doivent dire la même chose, sinon on découvre le refus après
      // avoir composé la planche.
      fautes.push(`La ${libelle} de l'étiquette ne peut pas dépasser 1000 mm ; reçu ${valeur}.`);
    }
  }
  if (!Number.isFinite(margeMm) || margeMm < 0 || margeMm > 50) {
    fautes.push("La marge de l'étiquette doit être comprise entre 0 et 50 mm.");
  }

  let brut: unknown = [];
  try {
    brut = JSON.parse(String(formData.get("champs") ?? "[]"));
  } catch {
    fautes.push("La composition du modèle n'a pas pu être relue. Rechargez la page et réessayez.");
  }
  const { champs } = analyserChamps(brut);

  if (fautes.length > 0 || !estFamille(familleBrute)) return { brouillon: null, fautes };

  const brouillon: BrouillonModele = {
    famille: familleBrute,
    nom,
    largeurMm,
    hauteurMm,
    margeMm,
    champs,
    estDefaut: booleen(formData.get("est_defaut")),
  };

  // LA MÊME VÉRIFICATION QUE CELLE DU MOTEUR DE RENDU, ET AU MÊME
  // ENDROIT QUE LA BASE. `verifierModele` refuse un champ qui déborde
  // ou qui entre dans la marge ; l'appeler ici évite d'enregistrer un
  // modèle que la planche refusera ensuite d'imprimer.
  const contraintes = verifierModele({
    famille: brouillon.famille,
    nom: brouillon.nom,
    largeurMm: brouillon.largeurMm,
    hauteurMm: brouillon.hauteurMm,
    margeMm: brouillon.margeMm,
    champs: brouillon.champs,
  });
  if (contraintes.length > 0) return { brouillon: null, fautes: contraintes };

  return { brouillon, fautes: [] };
}

/** La forme `jsonb` attendue par `etiquette_modele_enregistrer`. */
export function champsVersJson(champs: readonly ChampPlace[]): Record<string, unknown>[] {
  return champs.map((champ) => {
    const objet: Record<string, unknown> = {
      champ: champ.champ,
      x: champ.x,
      y: champ.y,
      largeur: champ.largeur,
      hauteur: champ.hauteur,
    };
    // On n'écrit QUE ce qui est réglé. Poser `gras: false` partout
    // gonflerait le `jsonb` de valeurs par défaut et rendrait toute
    // comparaison de deux modèles illisible.
    if (champ.taille !== undefined) objet.taille = champ.taille;
    if (champ.gras) objet.gras = true;
    if (champ.italique) objet.italique = true;
    if (champ.alignement && champ.alignement !== "gauche") objet.alignement = champ.alignement;
    if (champ.cadre) objet.cadre = true;
    return objet;
  });
}

/** Le libellé français d'un champ, pour l'éditeur. */
export const LIBELLE_CHAMP: Readonly<Record<ChampEtiquette, string>> = {
  logo: "Logo / raison sociale",
  nom: "Nom",
  nomScientifique: "Nom scientifique",
  cultivar: "Cultivar",
  numeroLot: "Numéro de lot",
  date: "Date",
  quantite: "Quantité",
  emplacement: "Emplacement",
  stade: "Stade",
  qr: "QR code",
  codeBarres: "Code-barres",
  texteLibre: "Texte libre",
};
