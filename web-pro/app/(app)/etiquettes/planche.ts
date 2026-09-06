/**
 * DE L'URL À LA PLANCHE — la composition, partagée par l'aperçu et le PDF.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LA SÉLECTION VOYAGE DANS L'ADRESSE
 * ══════════════════════════════════════════════════════════════════
 *
 * La planche est entièrement décrite par sa requête : le gisement, les
 * identifiants, le modèle, le support, le nombre d'exemplaires. Rien
 * n'est gardé en session, rien n'est écrit dans un cookie.
 *
 * TROIS CONSÉQUENCES, TOUTES BONNES :
 *   • l'aperçu à l'écran et le PDF partent de la MÊME description —
 *     impossible qu'ils divergent, puisqu'ils lisent la même adresse ;
 *   • la planche est REJOUABLE : garder le lien, c'est pouvoir
 *     réimprimer exactement la même feuille dans six mois, avec les
 *     mêmes jetons, quand trois autocollants se seront décollés ;
 *   • aucune écriture. Cette page est une lecture pure, et une lecture
 *     pure peut être rechargée, partagée, mise en favori sans effet de
 *     bord. Les étiquettes ont été créées AVANT, par la Server Action.
 *
 * LA CONTREPARTIE, MESURÉE ET ASSUMÉE : cinq cents identifiants de
 * trente-six caractères font environ dix-huit mille caractères
 * d'adresse, au-delà de ce que certains intermédiaires acceptent. D'où
 * `PLAFOND_SELECTION` à cinq cents — la même borne que
 * `etiquettes_creer_lot` en base — et le retrait des tirets, qui
 * ramène chaque identifiant à trente-deux caractères.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN OBJET SANS JETON N'EST PAS IMPRIMÉ, ET ON LE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Cela ne devrait pas arriver — la Server Action vient de poser les
 * étiquettes manquantes. Mais si une création a échoué en silence, ou
 * si quelqu'un a révoqué l'étiquette entre-temps, imprimer un carré
 * vide à la place du QR serait le pire des résultats : un autocollant
 * d'apparence normale qui ne mène nulle part. On saute l'objet, et on
 * nomme ceux qu'on a sautés.
 */

// Import relatif : `node --test` ne résout pas l'alias `@/`, et
// `lireRequete` doit être testable sans bundler ni réseau.
import {
  composerPlanche,
  formatPersonnalise,
  type ModeleEtiquette,
  type Planche,
  type SupportPlanche,
} from "../../../lib/etiquettes/index.ts";

import { adresseEtiquettes, urlEtiquette, type Adresse } from "./adresse.ts";
import { estSource, gisement, type SourceEtiquette } from "./familles.ts";
import {
  lireEtiquettesPosees,
  lireModele,
  lireModeles,
  lireObjets,
  PLAFOND_SELECTION,
} from "./lecture.ts";
import { modeleDeSecours, modelePrefere } from "./modeles.ts";
import type { createClient } from "@/lib/supabase/server";
import type { OrganizationContext } from "@/lib/auth/organization";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Ce qu'une adresse de planche peut porter. Tout est facultatif sauf les deux premiers. */
export type RequetePlanche = {
  readonly source: SourceEtiquette;
  readonly ids: string[];
  readonly modeleId: string | null;
  readonly support: SupportPlanche;
  readonly copies: number;
  readonly casesSautees: number;
  readonly texteLibre: string;
  readonly traitsDeCoupe: boolean;
  /** Cotes libres, quand l'utilisateur a saisi un format personnalisé. */
  readonly largeurMm: number | null;
  readonly hauteurMm: number | null;
  /**
   * LA GÉOMÉTRIE DE LA GRILLE A4, POUR TOMBER SUR UNE PLANCHE DU
   * COMMERCE.
   *
   * Elle était figée : marge 5 mm, gouttières 2 mm, bloc centré. Sous
   * ces réglages, aucune planche autocollante prédécoupée ne peut
   * tomber juste — mesuré sur une Avery L7651 (38,1 × 21,2 mm, 5 × 13
   * par feuille), notre grille rendait 5 × 12, origine (5,75 ; 10,3),
   * pas 40,1 × 23,2 au lieu de 45,7 × 21,2 : plusieurs centimètres de
   * décalage dès la troisième colonne. Or l'écran propose « sauter des
   * cases », qui n'a de sens QUE sur une planche prédécoupée. Les deux
   * ne pouvaient pas être vrais en même temps.
   *
   * Les quatre réglages existaient déjà dans OptionsGrilleA4 ; il ne
   * manquait que le passage depuis l'écran.
   */
  readonly margeXMm: number | null;
  readonly margeYMm: number | null;
  readonly gouttiereXMm: number | null;
  readonly gouttiereYMm: number | null;
  /** Faux = origine au coin haut-gauche, ce qu'impose une prédécoupe. */
  readonly centrer: boolean;
};

function entier(valeur: unknown, defaut: number, min: number, max: number): number {
  const n = Number(typeof valeur === "string" ? valeur : Number.NaN);
  if (!Number.isFinite(n)) return defaut;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function decimal(valeur: unknown): number | null {
  if (typeof valeur !== "string" || valeur.trim() === "") return null;
  const n = Number(valeur.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Lit une requête de planche depuis les paramètres d'URL. */
export function lireRequete(
  params: Record<string, string | string[] | undefined>,
): RequetePlanche | null {
  const un = (cle: string): string | undefined => {
    const brut = params[cle];
    return Array.isArray(brut) ? brut[0] : brut;
  };

  const source = un("source") ?? "";
  if (!estSource(source)) return null;

  const ids = (un("objets") ?? "")
    .split(",")
    .map((morceau) => morceau.trim())
    .filter((morceau) => /^[0-9a-f-]{32,36}$/i.test(morceau))
    // On accepte les identifiants avec ou sans tirets : l'adresse est
    // plus courte sans, mais un lien recopié à la main les garde.
    .map((morceau) => (morceau.includes("-") ? morceau : reposerTirets(morceau)))
    .filter((morceau, index, tous) => tous.indexOf(morceau) === index)
    .slice(0, PLAFOND_SELECTION);

  if (ids.length === 0) return null;

  const support: SupportPlanche = un("support") === "rouleau" ? "rouleau" : "a4";

  return {
    source,
    ids,
    modeleId: un("modele")?.trim() || null,
    support,
    copies: entier(un("copies"), 1, 1, 50),
    casesSautees: support === "a4" ? entier(un("cases_sautees"), 0, 0, 200) : 0,
    texteLibre: (un("texte_libre") ?? "").slice(0, 200),
    traitsDeCoupe: un("traits") === "1",
    largeurMm: decimal(un("largeur_mm")),
    hauteurMm: decimal(un("hauteur_mm")),
    margeXMm: borneDecimal(decimal(un("mx_mm")), 0, 80),
    margeYMm: borneDecimal(decimal(un("my_mm")), 0, 80),
    gouttiereXMm: borneDecimal(decimal(un("gx_mm")), 0, 50),
    gouttiereYMm: borneDecimal(decimal(un("gy_mm")), 0, 50),
    // Centré par défaut : c'est le bon choix quand on découpe aux
    // ciseaux, et c'est ce que le produit faisait avant que ces
    // réglages n'existent.
    centrer: un("origine") !== "coin",
  };
}

/** Une cote lue dans l'adresse, bornée — ou null si elle n'y était pas. */
function borneDecimal(valeur: number | null, min: number, max: number): number | null {
  if (valeur === null) return null;
  return Math.max(min, Math.min(max, valeur));
}

/** Remet les tirets d'un uuid écrit à plat. */
function reposerTirets(plat: string): string {
  return [
    plat.slice(0, 8),
    plat.slice(8, 12),
    plat.slice(12, 16),
    plat.slice(16, 20),
    plat.slice(20, 32),
  ].join("-");
}

/**
 * Les réglages de composition, à partir d'une requête et d'un modèle.
 *
 * EXTRAIT POUR ÊTRE TESTABLE, et c'est délibéré : c'est la seule
 * fonction de ce module qui décide de la GÉOMÉTRIE de ce qui sort de
 * l'imprimante. `impression.test.ts` la fait tourner pour les cinq
 * formats du § 17, écrit les PDF, et RELIT leurs cotes. Une copie de
 * ces réglages dans le test n'aurait rien prouvé — elle aurait pu
 * diverger de ce que la page fait vraiment.
 */
export function optionsPlanche(
  requete: RequetePlanche,
  modele: ModeleEtiquette,
): Parameters<typeof composerPlanche>[1] {
  const surA4 = requete.support === "a4";
  // LA RÈGLE DE CONTRÔLE DISPARAÎT SUR UNE PRÉDÉCOUPE. Elle mange
  // 12 mm de pied de page, ce qui coûte un rang entier — et surtout,
  // sur une planche autocollante, elle s'imprimerait SUR une étiquette
  // au lieu du papier. Quand l'origine est imposée par la découpe, la
  // barre n'a plus ni la place ni le sens : on cale à la découpe, on
  // ne mesure plus à la règle.
  const surPredecoupe = surA4 && !requete.centrer;
  const regle = surA4 && !surPredecoupe;
  return {
    modele,
    support: requete.support,
    copies: requete.copies,
    casesSautees: requete.casesSautees,
    traitsDeCoupe: surA4 && requete.traitsDeCoupe,
    // LA RÈGLE DE CONTRÔLE NE VA QUE SUR LA PLANCHE A4. Sur un rouleau,
    // la page fait la taille de l'étiquette : il n'y a physiquement pas
    // la place pour une barre de 50 mm, et le PDF impose déjà ses cotes
    // — il n'y a donc rien à contrôler à la règle.
    regleDeControle: regle,
    grille: {
      regleDeControle: regle,
      // On ne pose que ce qui a été demandé : grilleA4 porte ses
      // propres défauts, et les recopier ici les ferait diverger le
      // jour où l'un des deux changerait.
      ...(requete.margeXMm !== null ? { margeXMm: requete.margeXMm } : {}),
      ...(requete.margeYMm !== null ? { margeYMm: requete.margeYMm } : {}),
      ...(requete.gouttiereXMm !== null ? { gouttiereXMm: requete.gouttiereXMm } : {}),
      ...(requete.gouttiereYMm !== null ? { gouttiereYMm: requete.gouttiereYMm } : {}),
      centrer: requete.centrer,
    },
  };
}

export type PlancheComposee = {
  readonly planche: Planche | null;
  readonly modele: ModeleEtiquette;
  readonly modeleNom: string;
  readonly adresse: Adresse;
  /** Les objets dont l'étiquette manque : ils ne sont PAS imprimés. */
  readonly sansJeton: string[];
  readonly nombreObjets: number;
  /** Ce qui empêche complètement d'imprimer. */
  readonly erreur: string | null;
};

/**
 * Compose la planche décrite par la requête.
 *
 * Une seule fonction pour l'écran et pour le PDF : c'est la garantie
 * que ce qu'on regarde est ce qu'on imprime.
 */
export async function composerDepuisRequete(
  supabase: Client,
  organization: OrganizationContext,
  requete: RequetePlanche,
): Promise<PlancheComposee> {
  const adresse = adresseEtiquettes();

  // Le modèle d'abord : sans lui, on ne sait même pas quelles cotes
  // annoncer dans un message d'erreur.
  let modele: ModeleEtiquette | null = null;
  let modeleNom = "";
  if (requete.modeleId) {
    const enregistre = await lireModele(supabase, requete.modeleId);
    if (enregistre) {
      modele = enregistre;
      modeleNom = enregistre.nom;
    }
  }
  if (!modele) {
    // LE REPLI SUIT LA FAMILLE DU GISEMENT, PAS UN DÉFAUT ARBITRAIRE.
    // Un identifiant de modèle périmé — archivé entre-temps, ou copié
    // d'un lien plus ancien — ne doit pas faire sortir des lots de
    // pépinière sur une étiquette botanique de jardin : les champs ne
    // sont pas les mêmes, et le numéro de lot disparaîtrait de
    // l'autocollant sans que rien ne le signale.
    const famille = gisement(requete.source).famille;
    const tous = await lireModeles(supabase).catch(() => []);
    const prefere = modelePrefere(tous, famille);
    modele = prefere ?? modeleDeSecours(famille);
    modeleNom = prefere?.nom ?? modele.nom;
  }

  // UN FORMAT PERSONNALISÉ REMPLACE LES COTES DU MODÈLE, PAS SES
  // CHAMPS. C'est le « formats personnalisés » du § 17 : on garde la
  // composition et on change la taille du papier. `formatPersonnalise`
  // borne et arrondit, et lève si les cotes n'ont aucun sens.
  if (requete.largeurMm !== null && requete.hauteurMm !== null) {
    try {
      const format = formatPersonnalise(requete.largeurMm, requete.hauteurMm);
      modele = { ...modele, largeurMm: format.largeurMm, hauteurMm: format.hauteurMm };
    } catch (erreur) {
      return {
        planche: null,
        modele,
        modeleNom,
        adresse,
        sansJeton: [],
        nombreObjets: 0,
        erreur: erreur instanceof Error ? erreur.message : "Format personnalisé invalide.",
      };
    }
  }

  if (!adresse.base) {
    return {
      planche: null,
      modele,
      modeleNom,
      adresse,
      sansJeton: [],
      nombreObjets: 0,
      erreur: adresse.probleme,
    };
  }
  const base = adresse.base;

  const objets = await lireObjets(supabase, organization, requete.source, { ids: requete.ids });
  const posees = await lireEtiquettesPosees(
    supabase,
    requete.source,
    objets.map((o) => o.id),
  );

  const sansJeton: string[] = [];
  const entrees = objets.flatMap((objet) => {
    const etiquette = posees.get(objet.id);
    if (!etiquette) {
      sansJeton.push(objet.libelle);
      return [];
    }
    // `urlEtiquette` LÈVE plutôt que de fabriquer une adresse douteuse
    // — jeton qui n'a pas la forme d'un jeton, domaine réservé. On
    // écarte alors l'élément et on le NOMME, au lieu de laisser
    // l'exception emporter les cent quatre-vingt-dix-neuf autres
    // étiquettes de la planche.
    let url: string;
    try {
      url = urlEtiquette(base, etiquette.jeton);
    } catch {
      sansJeton.push(objet.libelle);
      return [];
    }
    return [
      {
        url,
        valeurs: {
          ...objet.valeurs,
          ...(requete.texteLibre ? { texteLibre: requete.texteLibre } : {}),
          // LE LOGO EST LE NOM DE L'ENTREPRISE, EN TOUTES LETTRES. Le
          // moteur de rendu accepte aussi une image en `data:` URI,
          // mais elle ne survivrait pas au PDF (voir pdf.ts) : une
          // planche dont le logo n'apparaît qu'à l'écran serait pire
          // que pas de logo du tout.
          logo: organization.name,
        },
      },
    ];
  });

  if (entrees.length === 0) {
    return {
      planche: null,
      modele,
      modeleNom,
      adresse,
      sansJeton,
      nombreObjets: objets.length,
      erreur:
        objets.length === 0
          ? "Aucun de ces éléments n'est lisible dans cette entreprise."
          : "Aucun de ces éléments ne porte d'étiquette active. Revenez à la sélection pour en poser.",
    };
  }

  try {
    const planche = composerPlanche(entrees, optionsPlanche(requete, modele));
    return {
      planche,
      modele,
      modeleNom,
      adresse,
      sansJeton,
      nombreObjets: objets.length,
      erreur: null,
    };
  } catch (erreur) {
    return {
      planche: null,
      modele,
      modeleNom,
      adresse,
      sansJeton,
      nombreObjets: objets.length,
      erreur:
        erreur instanceof Error
          ? erreur.message
          : "Cette planche n'a pas pu être composée.",
    };
  }
}

/** L'adresse du PDF correspondant à une requête de planche. */
export function lienPdf(
  params: Record<string, string | string[] | undefined>,
  telecharger = false,
): string {
  const sortie = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params)) {
    const un = Array.isArray(valeur) ? valeur[0] : valeur;
    if (typeof un === "string" && un !== "") sortie.set(cle, un);
  }
  if (telecharger) sortie.set("telecharger", "1");
  return `/etiquettes/imprimer/pdf?${sortie.toString()}`;
}
