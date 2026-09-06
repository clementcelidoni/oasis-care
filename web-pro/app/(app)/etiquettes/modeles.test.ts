import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MODELES_OASIS,
  rendreEtiquette,
  verifierModele,
  type ChampPlace,
  type FamilleEtiquette,
  type ModeleEtiquette,
} from "../../../lib/etiquettes/index.ts";
import {
  analyserChamps,
  champsVersJson,
  estFamille,
  lireBrouillon,
  modelePrefere,
  versModele,
  type ModeleEnregistre,
} from "./modeles.ts";

/**
 * LES MODÈLES, TENUS CONTRE LA MIGRATION QUI LES SÈME.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE TEST QUE `lib/etiquettes/modeles.ts` PROMETTAIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Son en-tête annonce : « Le test `modeles.test.ts` vérifie au moins
 * que les trois modèles sont valides, tiennent dans leurs cotes et se
 * rendent sans avertissement — une divergence de cote se verrait
 * immédiatement. » CE FICHIER N'EXISTE PAS dans `lib/etiquettes`. La
 * promesse était donc fausse, exactement comme celle qu'avait faite
 * `lib/auth/permissions.ts` avant qu'on l'honore.
 *
 * `lib/etiquettes` est hors du périmètre de ce chantier — un autre
 * constructeur l'écrit. On honore la promesse d'ici : le test vit dans
 * notre périmètre, il relit 0090 § 8.b, et il échoue si un seul
 * millimètre diverge entre la copie TypeScript et la base.
 *
 * POURQUOI CETTE DIVERGENCE COÛTERAIT CHER. L'éditeur affiche la copie
 * TypeScript avant le premier aller-retour serveur, et la planche
 * imprime ce que la base rend. Deux modèles « Pépinière 50 × 30 » qui
 * ne placeraient pas le QR au même endroit donneraient un aperçu juste
 * et une planche fausse — le pire des couples.
 *
 * AUCUN APPEL RÉSEAU.
 */

const MIGRATION = join(process.cwd(), "..", "supabase", "migrations", "0090_etiquettes.sql");

type ModeleSeme = {
  famille: string;
  nom: string;
  largeurMm: number;
  hauteurMm: number;
  margeMm: number;
  champs: Record<string, unknown>[];
};

/**
 * Lit les trois `insert into public.etiquette_modeles` de 0090 § 8.b.
 *
 * On analyse le SQL plutôt que d'interroger la base : « aucun appel
 * réseau dans les tests », et surtout le fichier de migration est la
 * VÉRITÉ SOURCE — c'est lui qui sera rejoué sur un environnement neuf.
 */
function modelesSemes(): ModeleSeme[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const modeles: ModeleSeme[] = [];

  const entetes = [
    ...sql.matchAll(
      /select null, '([a-z]+)', '([^']*)', ([\d.]+), ([\d.]+), ([\d.]+), (?:true|false),\s*\n\s*jsonb_build_array\(/g,
    ),
  ];

  for (const entete of entetes) {
    const depart = entete.index + entete[0].length;
    const fin = sql.indexOf("where not exists", depart);
    const corps = sql.slice(depart, fin);

    const champs = [...corps.matchAll(/jsonb_build_object\(([^)]*)\)/g)].map((objet) => {
      const paires: Record<string, unknown> = {};
      // Les arguments vont par deux : 'clé', valeur.
      const jetons = [...objet[1].matchAll(/'([^']*)'|(-?[\d.]+)|(true|false)/g)];
      for (let i = 0; i + 1 < jetons.length; i += 2) {
        const cle = jetons[i][1];
        const valeur = jetons[i + 1];
        if (cle === undefined) continue;
        if (valeur[1] !== undefined) paires[cle] = valeur[1];
        else if (valeur[2] !== undefined) paires[cle] = Number(valeur[2]);
        else paires[cle] = valeur[3] === "true";
      }
      return paires;
    });

    modeles.push({
      famille: entete[1],
      nom: entete[2],
      largeurMm: Number(entete[3]),
      hauteurMm: Number(entete[4]),
      margeMm: Number(entete[5]),
      champs,
    });
  }

  return modeles;
}

test("la lecture des modèles semés fonctionne — sinon rien n'est prouvé", () => {
  const semes = modelesSemes();
  assert.equal(
    semes.length,
    3,
    `${semes.length} modèles lus dans 0090 § 8.b au lieu de trois : l'analyse du SQL a échoué, pas la synchronisation.`,
  );
  for (const seme of semes) {
    assert.ok(seme.champs.length > 0, `Le modèle « ${seme.nom} » est lu sans aucun champ.`);
  }
});

/**
 * LA DIVERGENCE EST CORRIGÉE, ET CE TEST GARDE LA PORTE FERMÉE.
 *
 * Elle a existé : `lib/etiquettes/modeles.ts` posait `taille: 5` sur le
 * champ « logo » du modèle Jardins, `0090 § 8.b` semait le même champ
 * SANS `taille`. Deux vérités pour un même modèle — l'aperçu hors
 * ligne propre, la planche imprimée depuis la base signalant un
 * ajustement de texte. Le `taille: 5` a été retiré du TypeScript, qui
 * est la copie ; la migration, qui est la source, n'a pas bougé.
 *
 * Le test ci-dessous n'a plus AUCUNE dérogation : tout écart, sur
 * n'importe quel champ de n'importe quel modèle, le fait échouer.
 */

test("les trois modèles Oasis du TypeScript sont EXACTEMENT ceux que la migration sème", () => {
  for (const seme of modelesSemes()) {
    assert.ok(estFamille(seme.famille), `Famille inconnue en base : ${seme.famille}`);
    const local = MODELES_OASIS[seme.famille as FamilleEtiquette];
    assert.ok(local, `Aucun modèle TypeScript pour la famille ${seme.famille}`);

    assert.equal(local.nom, seme.nom, `Le nom du modèle ${seme.famille} diverge.`);
    assert.equal(local.largeurMm, seme.largeurMm, `La largeur du modèle ${seme.famille} diverge.`);
    assert.equal(local.hauteurMm, seme.hauteurMm, `La hauteur du modèle ${seme.famille} diverge.`);
    assert.equal(local.margeMm, seme.margeMm, `La marge du modèle ${seme.famille} diverge.`);

    // Les champs, un par un, dans l'ordre : deux modèles qui posent les
    // mêmes champs à des endroits différents sont deux modèles
    // différents, même s'ils ont le même nom.
    const { champs: attendus } = analyserChamps(seme.champs);
    assert.equal(
      local.champs.length,
      attendus.length,
      `Le modèle ${seme.famille} n'a pas le même nombre de champs qu'en base.`,
    );
    attendus.forEach((attendu, index) => {
      const obtenu = local.champs[index];
      assert.deepEqual(
        {
          champ: obtenu.champ,
          x: obtenu.x,
          y: obtenu.y,
          largeur: obtenu.largeur,
          hauteur: obtenu.hauteur,
          taille: obtenu.taille,
          gras: obtenu.gras ?? false,
          italique: obtenu.italique ?? false,
        },
        {
          champ: attendu.champ,
          x: attendu.x,
          y: attendu.y,
          largeur: attendu.largeur,
          hauteur: attendu.hauteur,
          taille: attendu.taille,
          gras: attendu.gras ?? false,
          italique: attendu.italique ?? false,
        },
        `Le champ nº ${index + 1} du modèle ${seme.famille} diverge entre 0090 et lib/etiquettes.`,
      );
    });
  }
});

test("les trois modèles Oasis sont imprimables tels quels", () => {
  for (const famille of ["jardins", "pepiniere", "biolab"] as FamilleEtiquette[]) {
    const modele = MODELES_OASIS[famille];
    assert.deepEqual(
      verifierModele(modele),
      [],
      `Le modèle ${famille} livré par Oasis ne passe pas sa propre vérification.`,
    );
  }
});

/**
 * L'ADRESSE D'ÉPREUVE, ET POURQUOI CELLE-LÀ EXACTEMENT.
 *
 * Vingt-sept caractères d'origine et de chemin
 * (`https://oasisrarecare.fr/x/`) plus les TRENTE-DEUX caractères
 * hexadécimaux d'un jeton tiré par `gen_random_bytes(16)` : c'est la
 * longueur RÉELLE de ce qui sera encodé. Une adresse d'exemple plus
 * courte mentirait sur la version du QR, donc sur la taille d'un
 * module, donc sur la possibilité même de scanner.
 */
const URL_EPREUVE = "https://oasisrarecare.fr/x/0123456789abcdef0123456789abcdef";

test("les TROIS modèles fournis produisent un QR au-dessus du plancher de lecture", () => {
  // « Au-dessus du plancher », pas « confortable » : les trois restent
  // dans la zone « limite » avec un jeton de 32 caractères, et le
  // moteur le DIT désormais (niveau « remarque »). Ce test veille sur
  // ce qui casse une étiquette, pas sur ce qui la rend perfectible.
  for (const famille of ["jardins", "pepiniere", "biolab"] as FamilleEtiquette[]) {
    const rendu = rendreEtiquette(MODELES_OASIS[famille], {
      url: URL_EPREUVE,
      valeurs: { nom: "Olivier", numeroLot: "LOT-1", date: "05/09/2026", quantite: "12 u" },
    });
    const surLeQr = rendu.avertissements.filter(
      (a) => a.champ === "qr" && (a.niveau ?? "defaut") === "defaut",
    );
    assert.deepEqual(
      surLeQr,
      [],
      `Le modèle ${famille} produit un QR trop dense : ${surLeQr.map((a) => a.message).join(" ")}`,
    );
  }
});

/**
 * LE DÉFAUT LE PLUS COÛTEUX DU CHANTIER, ET SA NON-RÉGRESSION.
 *
 * LE MODÈLE BIOLAB FOURNI IMPRIMAIT UN QR ILLISIBLE. Mesuré, pas
 * supposé : l'adresse d'épreuve fait 59 caractères, encodés en mode
 * octet, soit un QR de version 4 — 33 modules de côté. La norme exige
 * quatre modules clairs de silence de chaque côté, ce qui porte
 * l'encombrement réel à 41 modules. Le champ « qr » mesurait
 * 13 × 13 mm : 13 / 41 = 0,3171 mm par module, SOUS les 0,33 mm en
 * dessous desquels un appareil photo de téléphone décroche.
 *
 * Autrement dit : un autocollant d'apparence parfaite dont le QR ne se
 * scanne pas — précisément ce que ce module doit rendre impossible.
 *
 * CORRIGÉ DES DEUX CÔTÉS À LA FOIS, parce qu'une correction d'un seul
 * côté aurait recréé la divergence : le cadre passe à 15 × 15 mm dans
 * `lib/etiquettes/modeles.ts` ET dans `0090 § 8.b`, et les champs de
 * texte perdent 1 mm de largeur pour lui faire place. 15 / 41 =
 * 0,366 mm — au-dessus du plancher.
 *
 * CE QUI RESTE VRAI ET QUI N'EST PAS DU CODE : à 0,366 mm on est
 * au-dessus du plancher, pas dans le confortable (0,50 mm). Sur
 * 40 × 20 mm, seul un JETON PLUS COURT y mènerait — seize caractères
 * ramènent l'adresse à 43, donc à la version 3 (29 + 8 = 37 modules),
 * soit 0,405 mm dans le cadre de 15. C'est une décision de produit,
 * pas une correction.
 */
test("le modèle BioLab tient dans son étiquette avec son cadre de QR à 15 mm", () => {
  assert.deepEqual(
    verifierModele(MODELES_OASIS.biolab),
    [],
    "Le cadre agrandi ne tient plus dans l'étiquette.",
  );
});

test("NON-RÉGRESSION : ramener le cadre BioLab à 13 mm ferait repasser le QR sous le plancher", () => {
  // La preuve que le seuil mord vraiment, et qu'il mordait bien ici.
  // Sans ce test, quelqu'un pourrait resserrer le cadre pour gagner de
  // la place et refaire exactement la même étiquette invendable.
  const resserre: ModeleEtiquette = {
    ...MODELES_OASIS.biolab,
    champs: MODELES_OASIS.biolab.champs.map((c) =>
      c.champ === "qr" ? { ...c, x: 25, y: 2.5, largeur: 13, hauteur: 13 } : c,
    ),
  };
  const rendu = rendreEtiquette(resserre, { url: URL_EPREUVE, valeurs: { numeroLot: "CB-004" } });
  const surLeQr = rendu.avertissements.filter((a) => a.champ === "qr");
  assert.equal(surLeQr.length, 1, "Le plancher de lisibilité ne mord plus : le garde-fou a sauté.");
  assert.match(surLeQr[0].message, /0.3171 mm par module/);
  assert.match(surLeQr[0].message, /version 4/);
});

// ══════════════════════════════════════════════════════════════════
// L'ANALYSE DÉFENSIVE
// ══════════════════════════════════════════════════════════════════

test("un champ inconnu est écarté, et compté", () => {
  const { champs, ecartes } = analyserChamps([
    { champ: "nom", x: 1, y: 1, largeur: 10, hauteur: 4 },
    { champ: "prixDeVente", x: 1, y: 6, largeur: 10, hauteur: 4 },
    "n'importe quoi",
    null,
  ]);
  assert.equal(champs.length, 1);
  assert.equal(ecartes, 3);
});

test("un champ sans surface est écarté : il n'imprimerait rien", () => {
  const { champs, ecartes } = analyserChamps([
    { champ: "nom", x: 1, y: 1, largeur: 0, hauteur: 4 },
    { champ: "qr", x: 1, y: 1, largeur: 10, hauteur: -2 },
  ]);
  assert.equal(champs.length, 0);
  assert.equal(ecartes, 2);
});

test("ce qui n'est pas un tableau ne fait pas exploser l'écran", () => {
  for (const brut of [null, undefined, 42, "champs", {}]) {
    assert.deepEqual(analyserChamps(brut), { champs: [], ecartes: 0 });
  }
});

test("un numeric rendu en chaîne, et une virgule française, sont lus comme des nombres", () => {
  const modele = versModele({
    id: "abc",
    organization_id: null,
    famille: "biolab",
    nom: "Test",
    largeur_mm: "40.00",
    hauteur_mm: "20,00",
    marge_mm: "1.50",
    champs: [],
    est_defaut: false,
  });
  assert.equal(modele.largeurMm, 40);
  assert.equal(modele.hauteurMm, 20);
  assert.equal(modele.margeMm, 1.5);
});

test("un modèle Oasis n'est jamais modifiable, un modèle d'entreprise l'est", () => {
  assert.equal(versModele({ id: "1", organization_id: null, famille: "jardins" }).modifiable, false);
  assert.equal(versModele({ id: "1", organization_id: "org-1", famille: "jardins" }).modifiable, true);
});

test("une famille inconnue en base ne casse pas l'écran : on retombe sur « jardins »", () => {
  assert.equal(versModele({ id: "1", famille: "atlantide" }).famille, "jardins");
});

// ══════════════════════════════════════════════════════════════════
// LE CHOIX DU MODÈLE PROPOSÉ
// ══════════════════════════════════════════════════════════════════

function faux(
  id: string,
  famille: FamilleEtiquette,
  organizationId: string | null,
  estDefaut = false,
): ModeleEnregistre {
  return {
    id,
    organizationId,
    famille,
    nom: id,
    largeurMm: 50,
    hauteurMm: 30,
    margeMm: 2,
    champs: [],
    estDefaut,
    modifiable: organizationId !== null,
  };
}

test("le défaut de l'entreprise gagne sur tout le reste", () => {
  const modeles = [
    faux("oasis", "pepiniere", null, true),
    faux("maison", "pepiniere", "org", false),
    faux("choisi", "pepiniere", "org", true),
  ];
  assert.equal(modelePrefere(modeles, "pepiniere")?.id, "choisi");
});

test("sans défaut d'entreprise, on prend le sien avant celui d'Oasis", () => {
  const modeles = [faux("oasis", "biolab", null, true), faux("maison", "biolab", "org")];
  assert.equal(modelePrefere(modeles, "biolab")?.id, "maison");
});

test("sans modèle d'entreprise, celui d'Oasis répond toujours présent", () => {
  assert.equal(modelePrefere([faux("oasis", "jardins", null, true)], "jardins")?.id, "oasis");
});

test("une famille sans aucun modèle rend null plutôt que celui d'une autre", () => {
  assert.equal(modelePrefere([faux("oasis", "jardins", null, true)], "biolab"), null);
});

// ══════════════════════════════════════════════════════════════════
// CE QUI ARRIVE DU FORMULAIRE
// ══════════════════════════════════════════════════════════════════

function formulaire(entrees: Record<string, string>): FormData {
  const data = new FormData();
  for (const [cle, valeur] of Object.entries(entrees)) data.append(cle, valeur);
  return data;
}

const CHAMPS_VALIDES = JSON.stringify([
  { champ: "nom", x: 2, y: 2, largeur: 26, hauteur: 6, taille: 8, gras: true },
  { champ: "qr", x: 30, y: 5, largeur: 18, hauteur: 18 },
]);

test("un brouillon complet passe", () => {
  const { brouillon, fautes } = lireBrouillon(
    formulaire({
      famille: "pepiniere",
      nom: "  Mon modèle  ",
      largeur_mm: "50",
      hauteur_mm: "30",
      marge_mm: "2",
      champs: CHAMPS_VALIDES,
      est_defaut: "on",
    }),
  );
  assert.deepEqual(fautes, []);
  assert.equal(brouillon?.nom, "Mon modèle");
  assert.equal(brouillon?.estDefaut, true);
  assert.equal(brouillon?.champs.length, 2);
});

test("un champ qui déborde de l'étiquette est refusé AVANT d'enregistrer", () => {
  // C'est le même refus que celui du moteur de rendu : découvrir
  // qu'un modèle est inimprimable devant l'imprimante, rouleau engagé,
  // est le scénario qu'on veut rendre impossible.
  const { brouillon, fautes } = lireBrouillon(
    formulaire({
      famille: "biolab",
      nom: "Trop grand",
      largeur_mm: "40",
      hauteur_mm: "20",
      marge_mm: "1.5",
      champs: JSON.stringify([{ champ: "nom", x: 2, y: 2, largeur: 60, hauteur: 5 }]),
    }),
  );
  assert.equal(brouillon, null);
  assert.equal(fautes.length, 1);
  assert.match(fautes[0], /déborde/);
});

test("une marge qui mange l'étiquette entière est refusée", () => {
  const { brouillon, fautes } = lireBrouillon(
    formulaire({
      famille: "biolab",
      nom: "Marge folle",
      largeur_mm: "25",
      hauteur_mm: "15",
      marge_mm: "9",
      champs: "[]",
    }),
  );
  assert.equal(brouillon, null);
  assert.match(fautes.join(" "), /mange l'étiquette/);
});

test("les fautes sont rendues TOUTES ENSEMBLE, pas une par une", () => {
  const { fautes } = lireBrouillon(
    formulaire({ famille: "atlantide", nom: "", largeur_mm: "0", hauteur_mm: "-3", champs: "[]" }),
  );
  // Corriger une cote pour découvrir la suivante au coup d'après est la
  // manière la plus sûre de faire abandonner.
  assert.ok(fautes.length >= 4, `Attendu au moins quatre fautes, reçu ${fautes.length}.`);
});

test("la borne des mille millimètres est la même qu'en base", () => {
  const { fautes } = lireBrouillon(
    formulaire({
      famille: "jardins",
      nom: "Géante",
      largeur_mm: "1200",
      hauteur_mm: "30",
      marge_mm: "2",
      champs: "[]",
    }),
  );
  assert.match(fautes.join(" "), /1000 mm/);
});

test("un JSON de champs illisible est signalé, pas avalé", () => {
  const { brouillon, fautes } = lireBrouillon(
    formulaire({
      famille: "jardins",
      nom: "Cassé",
      largeur_mm: "50",
      hauteur_mm: "30",
      marge_mm: "2",
      champs: "{pas du json",
    }),
  );
  assert.equal(brouillon, null);
  assert.match(fautes.join(" "), /n'a pas pu être relue/);
});

test("l'aller-retour vers le jsonb ne perd ni n'invente rien", () => {
  const champs: ChampPlace[] = [
    { champ: "nom", x: 2, y: 2, largeur: 26, hauteur: 6, taille: 8, gras: true },
    { champ: "texteLibre", x: 2, y: 9, largeur: 26, hauteur: 8, taille: 5, alignement: "centre" },
    { champ: "qr", x: 30, y: 5, largeur: 18, hauteur: 18 },
  ];
  const { champs: relus } = analyserChamps(champsVersJson(champs));
  assert.deepEqual(relus, champs);
});

test("le jsonb n'écrit pas les valeurs par défaut", () => {
  const json = champsVersJson([
    { champ: "nom", x: 1, y: 1, largeur: 10, hauteur: 4, gras: false, alignement: "gauche" },
  ]);
  // Poser `gras: false` et `alignement: "gauche"` partout gonflerait le
  // jsonb et rendrait toute comparaison de deux modèles illisible.
  assert.deepEqual(Object.keys(json[0]).sort(), ["champ", "hauteur", "largeur", "x", "y"]);
});

test("un modèle composé au formulaire se rend vraiment", () => {
  const { brouillon } = lireBrouillon(
    formulaire({
      famille: "pepiniere",
      nom: "Essai",
      largeur_mm: "50",
      hauteur_mm: "30",
      marge_mm: "2",
      champs: CHAMPS_VALIDES,
    }),
  );
  assert.ok(brouillon);
  const modele: ModeleEtiquette = {
    famille: brouillon.famille,
    nom: brouillon.nom,
    largeurMm: brouillon.largeurMm,
    hauteurMm: brouillon.hauteurMm,
    margeMm: brouillon.margeMm,
    champs: brouillon.champs,
  };
  const rendu = rendreEtiquette(modele, {
    url: "https://oasisrarecare.fr/x/0123456789abcdef0123456789abcdef",
    valeurs: { nom: "Olivier" },
  });
  assert.equal(rendu.largeurMm, 50);
  assert.equal(rendu.hauteurMm, 30);
  assert.ok(rendu.elements.length > 10, "Le QR n'a produit aucun module : rien ne serait imprimé.");
});
