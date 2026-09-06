/**
 * §7 « racks, salles, étagères » — CE QUE LE PRODUIT SAIT VRAIMENT DE
 * L'ESPACE PHYSIQUE DU LABORATOIRE, ET CE QU'IL N'EN SAIT PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL N'EXISTE AUCUNE TABLE DE SALLE, DE RACK NI D'ÉTAGÈRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Mesuré, table par table, sur les vingt et une tables BioLab de la
 * production : rien qui ressemble à un registre de lieux. L'espace
 * physique n'existe dans ce produit que sous la forme de QUATRE
 * COLONNES DE TEXTE LIBRE, tapées à la main sur le téléphone :
 *
 *   • `bioreactors.location`              — où se trouve un bioréacteur
 *   • `acclimatization_batches.location`  — où se passe une acclimatation
 *   • `stock_solutions.storage_location`  — où est rangée une solution mère
 *   • `smart_tags.rack_label`             — le nom imprimé sur une étiquette de rack
 *
 * Le module mobile le dit lui-même, dans `RackTagCreationView` : le
 * rack est « la seule entité étiquetable sans modèle derrière », et son
 * étiquette « n'ouvre aucune fiche ». Inventer ici une table `salles` ou
 * un objet `Rack` serait très exactement le second système BioLab que
 * le §6 interdit — avec cette circonstance aggravante que personne ne
 * l'alimenterait, le téléphone ne le connaissant pas.
 *
 * CE QUE CE FICHIER FAIT DONC, ET C'EST TOUT : il RASSEMBLE ces quatre
 * colonnes en un index des lieux, pour répondre à la question qu'un
 * chef de culture se pose le matin — qu'est-ce qui se trouve où, et
 * qu'est-ce qui n'a pas d'emplacement noté. Un lieu n'est pas un objet
 * du modèle : c'est un mot que quelqu'un a tapé. Toute cette page en
 * découle, y compris ses limites, et l'écran doit les dire.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX PIÈGES MESURÉS DANS LA VRAIE BASE, PAS SUPPOSÉS
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. L'EMPLACEMENT VIDE N'EST PAS NUL. L'unique bioréacteur de la
 *    production porte `location = ''` — une chaîne vide, pas un NULL.
 *    Un `location is not null` le ferait donc remonter, et un
 *    regroupement naïf fabriquerait un lieu qui s'appelle « rien ».
 *    D'où `estRenseigne`, qui juge sur le contenu et non sur la
 *    nullité, et qui est appliqué PARTOUT.
 *
 * 2. DEUX ORTHOGRAPHES POUR UN MÊME LIEU. Les deux seules étiquettes
 *    de rack de la production s'appellent « BIO1 » et « Bio ». C'est
 *    la conséquence inévitable d'un champ libre, et c'est aussi ce qui
 *    rend un index de lieux dangereux : afficher deux lignes pour un
 *    seul rack fait croire à deux racks. On regroupe donc sur une clef
 *    normalisée (casse, accents, espaces), et on SIGNALE — sans jamais
 *    les fusionner d'office — les noms suffisamment proches pour
 *    désigner probablement la même chose. Fusionner serait décider à
 *    la place de l'utilisateur ; se taire serait le laisser compter
 *    faux.
 */

import type { Ton } from "./cultures.ts";

// ==================================================================
// 1. CE QUE LA BASE REND — les quatre lectures, telles quelles
// ==================================================================

/** Une ligne de `bioreactors`, réduite à ce qu'un plan de lieux montre. */
export type BioreacteurSitue = {
  id: string;
  code: string | null;
  name: string | null;
  status: string | null;
  location: string | null;
  current_batch_id: string | null;
  updated_at: string | null;
};

/** Une ligne d'`acclimatization_batches`. */
export type AcclimatationSituee = {
  id: string;
  location: string | null;
  status: string | null;
  current_survivor_count: number | null;
  initial_plantlet_count: number | null;
  /** Le code du lot d'origine, joint depuis `culture_batches`. */
  lot_code: string | null;
};

/** Une ligne de `stock_solutions`. */
export type SolutionSituee = {
  id: string;
  name: string | null;
  storage_location: string | null;
  expires_at: string | null;
  remaining_volume_liters: number | null;
};

/**
 * Une étiquette de rack — `smart_tags` avec un `rack_label` renseigné.
 *
 * ATTENTION À CE QU'ELLE NE DIT PAS : une étiquette de rack ne porte
 * AUCUN lien vers un lot, un bocal ou une plante. `smart_tags` a bien
 * des colonnes `culture_batch_id`, `bioreactor_id`… mais l'étiquette de
 * rack les laisse vides par construction (`SmartTagService.rackTag`).
 * Le produit sait donc qu'un rack porte un nom et qu'il a été scanné
 * telle fois ; il ne sait pas ce qui est posé dessus.
 */
export type RackEtiquete = {
  id: string;
  rack_label: string | null;
  type: string | null;
  active: boolean | null;
  last_scanned_at: string | null;
};

export type MatiereLieux = {
  bioreacteurs: BioreacteurSitue[];
  acclimatations: AcclimatationSituee[];
  solutions: SolutionSituee[];
  racks: RackEtiquete[];
};

// ==================================================================
// 2. LE NOM D'UN LIEU — le juger, le normaliser, le comparer
// ==================================================================

/**
 * Un emplacement est-il renseigné ?
 *
 * La chaîne vide et les espaces ne sont pas un lieu. Voir le piège 1 en
 * tête de fichier : ce n'est pas une précaution théorique, c'est l'état
 * de l'unique bioréacteur de la production.
 */
export function estRenseigne(valeur: string | null | undefined): valeur is string {
  return typeof valeur === "string" && valeur.trim().length > 0;
}

/**
 * La clef de regroupement d'un nom de lieu.
 *
 * « Salle A », « salle a » et « SALLE  A » sont le même endroit pour
 * l'humain qui les a tapés ; les laisser sur trois lignes ferait
 * compter trois salles. On neutralise donc ce qui ne distingue jamais
 * deux lieux dans la vraie vie — la casse, les accents, le nombre
 * d'espaces — et RIEN D'AUTRE. « Rack A » et « Rack B » restent deux
 * clefs, évidemment ; mais « Rack A » et « RackA » aussi, parce qu'on
 * ne supprime pas les espaces : les enlever ferait fusionner des noms
 * que l'utilisateur distingue peut-être.
 */
export function clefLieu(nom: string): string {
  return nom
    .trim()
    .normalize("NFD")
    // Les diacritiques de la table Unicode combinante : « Réserve » et
    // « Reserve » sont le même mot mal tapé une fois sur deux.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ==================================================================
// 3. L'INDEX DES LIEUX
// ==================================================================

/** Ce qui occupe un lieu, tous types confondus. */
export type Lieu = {
  clef: string;
  /**
   * L'orthographe MONTRÉE : la plus fréquente, et à égalité la première
   * rencontrée dans l'ordre stable des sources. On n'invente pas une
   * graphie « propre » — on rend à l'utilisateur un mot qu'il a écrit.
   */
  nom: string;
  /** Les autres graphies vues pour la même clef, s'il y en a. */
  variantes: string[];
  bioreacteurs: BioreacteurSitue[];
  acclimatations: AcclimatationSituee[];
  solutions: SolutionSituee[];
  racks: RackEtiquete[];
  /** Le nombre d'objets réellement situés ici — les racks non compris. */
  occupants: number;
};

/** Ce dont on ne sait pas où c'est. */
export type SansEmplacement = {
  bioreacteurs: BioreacteurSitue[];
  acclimatations: AcclimatationSituee[];
  solutions: SolutionSituee[];
};

export type IndexLieux = {
  lieux: Lieu[];
  sansEmplacement: SansEmplacement;
  /** Le nombre d'objets situés, tous lieux confondus. */
  situes: number;
  /** Le nombre d'objets sans emplacement noté. */
  nonSitues: number;
};

/**
 * Construit l'index des lieux à partir des quatre sources.
 *
 * FONCTION PURE — aucune base, aucun réseau, aucune horloge. C'est ce
 * qui la rend éprouvable ligne à ligne, et c'est important : tout ce
 * que l'écran des lieux affirme sort d'ici.
 *
 * ELLE NE COMPTE QUE CE QU'ELLE REÇOIT. Les acclimatations terminées ou
 * abandonnées n'occupent plus rien — c'est la lecture qui les écarte,
 * pas cette fonction, pour que le filtre soit visible dans la requête
 * plutôt que caché dans un tri.
 *
 * LES RACKS N'AUGMENTENT PAS `occupants`, et c'est délibéré : une
 * étiquette de rack ne dit pas qu'il y a quelque chose dessus (voir
 * `RackEtiquete`). La compter comme un occupant ferait passer un
 * inventaire d'étiquettes pour un inventaire de matériel.
 */
export function indexerLieux(matiere: MatiereLieux): IndexLieux {
  const parClef = new Map<string, Lieu>();
  // Les graphies vues par clef, pour élire la plus fréquente.
  const graphies = new Map<string, Map<string, number>>();

  function lieuDe(brut: string): Lieu {
    const clef = clefLieu(brut);
    let lieu = parClef.get(clef);
    if (!lieu) {
      lieu = {
        clef,
        nom: brut.trim(),
        variantes: [],
        bioreacteurs: [],
        acclimatations: [],
        solutions: [],
        racks: [],
        occupants: 0,
      };
      parClef.set(clef, lieu);
      graphies.set(clef, new Map());
    }
    const compte = graphies.get(clef)!;
    const graphie = brut.trim();
    compte.set(graphie, (compte.get(graphie) ?? 0) + 1);
    return lieu;
  }

  const sansEmplacement: SansEmplacement = {
    bioreacteurs: [],
    acclimatations: [],
    solutions: [],
  };

  for (const bioreacteur of matiere.bioreacteurs) {
    if (estRenseigne(bioreacteur.location)) {
      const lieu = lieuDe(bioreacteur.location);
      lieu.bioreacteurs.push(bioreacteur);
      lieu.occupants += 1;
    } else {
      sansEmplacement.bioreacteurs.push(bioreacteur);
    }
  }

  for (const acclimatation of matiere.acclimatations) {
    if (estRenseigne(acclimatation.location)) {
      const lieu = lieuDe(acclimatation.location);
      lieu.acclimatations.push(acclimatation);
      lieu.occupants += 1;
    } else {
      sansEmplacement.acclimatations.push(acclimatation);
    }
  }

  for (const solution of matiere.solutions) {
    if (estRenseigne(solution.storage_location)) {
      const lieu = lieuDe(solution.storage_location);
      lieu.solutions.push(solution);
      lieu.occupants += 1;
    } else {
      sansEmplacement.solutions.push(solution);
    }
  }

  // Les racks en dernier : une étiquette dont le nom coïncide avec un
  // emplacement déjà connu se range naturellement dessous — c'est le
  // seul lien que le produit permette entre une étiquette imprimée et
  // ce qui se trouve à cet endroit, et il vaut la peine d'être montré.
  for (const rack of matiere.racks) {
    if (!estRenseigne(rack.rack_label)) continue;
    lieuDe(rack.rack_label).racks.push(rack);
  }

  // L'orthographe montrée, et les variantes.
  for (const lieu of parClef.values()) {
    const compte = graphies.get(lieu.clef)!;
    const triees = [...compte.entries()].sort((a, b) => b[1] - a[1]);
    lieu.nom = triees[0][0];
    lieu.variantes = triees.slice(1).map(([graphie]) => graphie);
  }

  const lieux = [...parClef.values()].sort(
    // Le plus occupé d'abord : c'est là qu'on regarde. À égalité, par
    // nom, pour que deux affichages successifs donnent le même ordre.
    (a, b) => b.occupants - a.occupants || a.nom.localeCompare(b.nom, "fr"),
  );

  return {
    lieux,
    sansEmplacement,
    situes: lieux.reduce((total, lieu) => total + lieu.occupants, 0),
    nonSitues:
      sansEmplacement.bioreacteurs.length +
      sansEmplacement.acclimatations.length +
      sansEmplacement.solutions.length,
  };
}

// ==================================================================
// 4. LES NOMS QUI DÉSIGNENT PROBABLEMENT LA MÊME CHOSE
// ==================================================================

export type Rapprochement = { a: string; b: string };

/**
 * Les paires de lieux dont les noms se ressemblent assez pour n'en
 * faire qu'un.
 *
 * MESURÉ, PAS IMAGINÉ : les deux seules étiquettes de rack de la
 * production s'appellent « BIO1 » et « Bio ». `clefLieu` ne les fusionne
 * pas — et elle a raison, « Bio » pourrait être une zone et « BIO1 » un
 * rack précis. Mais laisser un chef de culture compter deux racks là où
 * il n'y en a peut-être qu'un serait pire.
 *
 * LA RÈGLE EST VOLONTAIREMENT ÉTROITE : une clef est le début de
 * l'autre, et la plus courte fait au moins deux caractères. Pas de
 * distance d'édition, pas de phonétique — ces méthodes rapprochent
 * « Rack A » et « Rack B », c'est-à-dire exactement les deux lieux
 * qu'il ne faut jamais confondre. Mieux vaut manquer un rapprochement
 * que d'en suggérer un faux : celui-ci n'est qu'une remarque, et une
 * remarque fausse fait perdre la confiance dans toutes les autres.
 *
 * ON NE FUSIONNE RIEN. La sortie est une liste de remarques ; les lieux
 * restent distincts partout ailleurs.
 */
export function rapprochements(lieux: Lieu[]): Rapprochement[] {
  const sortie: Rapprochement[] = [];
  for (let i = 0; i < lieux.length; i += 1) {
    for (let j = i + 1; j < lieux.length; j += 1) {
      const un = lieux[i];
      const autre = lieux[j];
      const court = un.clef.length <= autre.clef.length ? un : autre;
      const long = court === un ? autre : un;
      if (court.clef.length < 2) continue;
      if (!long.clef.startsWith(court.clef)) continue;
      sortie.push({ a: court.nom, b: long.nom });
    }
  }
  return sortie;
}

// ==================================================================
// 5. CE QU'UN LIEU DIT EN UNE LIGNE
// ==================================================================

/**
 * Le résumé d'un lieu, dans l'ordre où on s'en soucie : le matériel
 * d'abord, le vivant ensuite, le rangement en dernier.
 *
 * Rend une chaîne vide quand le lieu n'a qu'une étiquette de rack —
 * l'écran écrit alors autre chose, parce que « 0 occupant » et « on ne
 * sait pas ce qu'il y a dessus » ne sont pas la même phrase.
 */
export function resumerLieu(lieu: Lieu): string {
  const morceaux: string[] = [];
  if (lieu.bioreacteurs.length > 0) {
    morceaux.push(
      `${lieu.bioreacteurs.length} bioréacteur${lieu.bioreacteurs.length > 1 ? "s" : ""}`,
    );
  }
  if (lieu.acclimatations.length > 0) {
    morceaux.push(
      `${lieu.acclimatations.length} acclimatation${lieu.acclimatations.length > 1 ? "s" : ""} en cours`,
    );
  }
  if (lieu.solutions.length > 0) {
    morceaux.push(
      `${lieu.solutions.length} solution${lieu.solutions.length > 1 ? "s" : ""} mère${lieu.solutions.length > 1 ? "s" : ""}`,
    );
  }
  return morceaux.join(" · ");
}

/**
 * Le nombre de plantules vivantes dans un lieu.
 *
 * `current_survivor_count` est le compte tenu à jour par l'opérateur au
 * fil des pertes ; c'est lui qui dit ce qu'il y a sur la table
 * aujourd'hui, pas `initial_plantlet_count`.
 */
export function plantulesDansLeLieu(lieu: Lieu): number {
  return lieu.acclimatations.reduce(
    (total, acclimatation) => total + (acclimatation.current_survivor_count ?? 0),
    0,
  );
}

/**
 * La teinte d'un lieu : elle ne juge pas, elle situe.
 *
 * Un lieu n'est ni bon ni mauvais — il est occupé ou il ne l'est pas.
 * La seule nuance utile est le lieu qui n'a qu'une étiquette et rien
 * dedans : ni une alerte, ni une réussite, juste une inconnue.
 */
export function tonLieu(lieu: Lieu): Ton {
  if (lieu.occupants === 0) return "neutral";
  return "accent";
}

// ==================================================================
// 6. LA LECTURE
// ==================================================================

/**
 * Va chercher les quatre sources dans l'espace de l'entreprise.
 *
 * Quatre requêtes, toutes bornées, toutes portées par la RLS du client
 * serveur : c'est elle — et pas ce fichier — qui interdit de voir le
 * laboratoire d'une autre entreprise. Le `workspace_id` explicite n'est
 * pas une sécurité, c'est un filtre de périmètre : un utilisateur peut
 * être membre de plusieurs espaces, et l'écran n'en montre qu'un.
 *
 * LES ACCLIMATATIONS SONT FILTRÉES SUR `active` ICI, dans la requête, et
 * pas dans `indexerLieux` : une acclimatation terminée n'occupe plus la
 * table sur laquelle elle se trouvait. Le filtre est dans la requête
 * pour qu'il se voie.
 */
export async function lireMatiereLieux(
  workspaceId: string,
): Promise<{ matiere: MatiereLieux; erreur: string | null }> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const [bioreacteurs, acclimatations, solutions, racks] = await Promise.all([
    supabase
      .from("bioreactors")
      .select("id, code, name, status, location, current_batch_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("code")
      .limit(500),

    supabase
      .from("acclimatization_batches")
      .select(
        "id, location, status, current_survivor_count, initial_plantlet_count, culture_batches ( batch_code )",
      )
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(500),

    supabase
      .from("stock_solutions")
      .select("id, name, storage_location, expires_at, remaining_volume_liters")
      .eq("workspace_id", workspaceId)
      .order("name")
      .limit(500),

    supabase
      .from("smart_tags")
      .select("id, rack_label, type, active, last_scanned_at")
      .eq("workspace_id", workspaceId)
      .not("rack_label", "is", null)
      .limit(500),
  ]);

  // Le premier échec rencontré suffit à disqualifier la page : un index
  // des lieux bâti sur trois sources au lieu de quatre situerait
  // faussement le laboratoire, sans rien signaler. Mieux vaut ne rien
  // montrer que de montrer un plan incomplet qu'on croira complet.
  const erreur =
    bioreacteurs.error?.message ??
    acclimatations.error?.message ??
    solutions.error?.message ??
    racks.error?.message ??
    null;

  const matiere: MatiereLieux = {
    bioreacteurs: (bioreacteurs.data ?? []) as BioreacteurSitue[],
    // La jointure rend un objet (ou null) ; on l'aplatit ici pour que le
    // reste du fichier n'ait pas à connaître la forme de PostgREST.
    acclimatations: ((acclimatations.data ?? []) as unknown[]).map((ligne) => {
      const brut = ligne as {
        id: string;
        location: string | null;
        status: string | null;
        current_survivor_count: number | null;
        initial_plantlet_count: number | null;
        culture_batches: { batch_code: string | null } | null;
      };
      return {
        id: brut.id,
        location: brut.location,
        status: brut.status,
        current_survivor_count: brut.current_survivor_count,
        initial_plantlet_count: brut.initial_plantlet_count,
        lot_code: brut.culture_batches?.batch_code ?? null,
      };
    }),
    solutions: (solutions.data ?? []) as SolutionSituee[],
    racks: (racks.data ?? []) as RackEtiquete[],
  };

  return { matiere, erreur };
}
