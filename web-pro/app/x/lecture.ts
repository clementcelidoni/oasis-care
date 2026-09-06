/**
 * §15 — LIRE UNE ÉTIQUETTE AVEC UN JETON, SANS RIEN SAVOIR D'AUTRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE PARLE PAS À LA BASE, ET C'EST VOULU
 * ══════════════════════════════════════════════════════════════════
 *
 * Il reçoit une FONCTION D'APPEL et ne connaît qu'elle. Toute la
 * décision — la forme du jeton, ce qu'on affiche, ce qu'on refuse, ce
 * qu'on ne dit pas — vit donc dans un module que les tests jouent sans
 * réseau et sans base. La page, elle, ne fait plus que du câblage.
 *
 * C'est la forme de `app/d/lecture.ts`, reprise volontairement : deux
 * portes anonymes qui se ressembleraient de loin mais se relieraient
 * différemment seraient deux surfaces à relire séparément.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LE RÉSOLVEUR REND, ET CE QU'ON EN GARDE
 * ══════════════════════════════════════════════════════════════════
 *
 * `etiquette_resoudre` (0090 § 6) rend neuf colonnes : ok, message,
 * portee, entite_type, entite_id, ecran, chemin, titre, details.
 * Ce module n'en laisse sortir QUE ce que chaque issue exige :
 *
 *   • PORTÉE « complet » — le porteur a le droit. On garde le chemin et
 *     le titre. ON JETTE `details`. La page redirige : elle n'a rien à
 *     afficher, donc rien à recevoir. Un objet qu'on ne transporte pas
 *     est un objet qui ne peut pas fuir le jour où quelqu'un élargira
 *     la fonction SQL sans relire cette page.
 *
 *   • PORTÉE « publique » — un passant a scanné une étiquette publiée.
 *     On reconstruit TROIS champs, un par un, nommés ici : nom commun,
 *     nom scientifique, type. Rien d'autre ne traverse, même si la base
 *     en rendait davantage. C'est la leçon de `app/d/lecture.ts`, dont
 *     la première version laissait passer l'objet entier et aurait
 *     livré la marge du paysagiste le jour où la fonction SQL aurait
 *     grandi d'une colonne.
 *
 *   • REFUS — une phrase, la sienne, jamais la nôtre quand elle en
 *     donne une.
 *
 * ══════════════════════════════════════════════════════════════════
 * QUATRE ISSUES, ET DEUX D'ENTRE ELLES SONT LA MÊME PAGE
 * ══════════════════════════════════════════════════════════════════
 *
 * Une étiquette INCONNUE et une étiquette INTERDITE rendent le même
 * booléen, la même phrase, le même écran, et comptent le même échec.
 * Ce n'est pas une économie de moyens : deux réponses différentes
 * formeraient un oracle. En tapant des jetons au hasard, on apprendrait
 * lesquels sont vrais — et un jeton d'étiquette N'EXPIRE PAS, puisqu'il
 * est collé sur un arbre. Ce qu'on apprend de lui, on l'apprend pour
 * dix ans.
 *
 * IL EXISTE UN CINQUIÈME ÉTAT, ET LE CONFONDRE AVEC LES AUTRES SERAIT
 * UNE FAUTE : LA PANNE. Un service indisponible n'est pas une étiquette
 * morte. Répondre « cette étiquette ne mène à rien » à quelqu'un dont
 * l'étiquette est parfaitement bonne le ferait renoncer — et il ne
 * rescannera pas un autocollant qu'on vient de lui dire mort.
 */

/**
 * LA PHRASE DE REFUS, RECOPIÉE DE 0090 § 6 MOT POUR MOT.
 *
 * Elle sert quand on refuse AVANT d'appeler la base — un jeton qui n'a
 * pas la bonne forme n'a jamais existé, et on ne dérange pas le serveur
 * pour lui. Les deux textes doivent rester identiques : deux phrases
 * différentes selon l'endroit du refus REDONNERAIENT l'oracle qu'on
 * vient de fermer. `lecture.test.ts` relit la migration et échoue si
 * elles divergent d'un caractère.
 */
export const PHRASE_REFUS =
  "Cette étiquette ne mène à rien. Si elle vient de votre entreprise, connectez-vous puis scannez-la de nouveau.";

/** Ce qu'on dit quand c'est NOUS qui sommes en panne, pas l'étiquette. */
export const PHRASE_PANNE =
  "Nous n'arrivons pas à lire cette étiquette à l'instant. Réessayez dans quelques minutes.";

/** Ce qu'on dit à qui insiste. Aucune information sur l'étiquette. */
export const PHRASE_TROP_DE_TENTATIVES =
  "Trop de tentatives depuis cet appareil. Patientez quelques minutes, puis scannez de nouveau " +
  "l'étiquette que vous avez sous les yeux.";

/**
 * L'ÉCRAN DE L'ÉTIQUETTE VIERGE, tel que 0090 § 6 le nomme.
 *
 * Le § 19 décrit le geste : « approcher un tag vierge, écrire
 * l'identifiant sécurisé, confirmer l'association ». Entre l'impression
 * du rouleau et la pose sur la plante, l'étiquette existe et ne vise
 * rien. Le résolveur le dit — mais seulement à qui a le droit sur
 * l'entreprise qui l'a commandée. Un passant, lui, reçoit un refus.
 */
export const ECRAN_VIERGE = "etiquette.vierge";

/** L'écran que le résolveur nomme quand il ne rend qu'une fiche publiée. */
export const ECRAN_FICHE_PUBLIQUE = "fiche.publique";

/**
 * LES TROIS SEULS CHAMPS QU'UN INCONNU PEUT VOIR.
 *
 * Pas de nom d'usage — « le palmier de Mamie » est une donnée
 * personnelle. Pas de coordonnées GPS — elles situent le jardin d'un
 * client. Pas d'état sanitaire, pas de note, pas de date de plantation.
 * 0090 § 6 s'arrête déjà là ; ce type le réaffirme du côté web, pour
 * que la page ne puisse pas afficher ce que la base cesserait un jour
 * de retenir.
 */
export type FichePublique = {
  nomCommun: string | null;
  nomScientifique: string | null;
  type: string | null;
};

export type Resultat =
  /**
   * Le porteur a le droit : on l'envoie sur la fiche complète, dans
   * l'application. `chemin` peut être nul — une plante dont le jardin a
   * été effacé n'a plus d'écran où l'ouvrir — et la page le sait.
   */
  | { etat: "complet"; entiteType: string; ecran: string; chemin: string | null; titre: string }
  /** Une étiquette imprimée ou programmée, pas encore associée (§ 19). */
  | { etat: "vierge" }
  /** Le passant, devant une étiquette que son propriétaire a publiée. */
  | { etat: "publique"; entiteType: string; titre: string; fiche: FichePublique }
  /** Inconnue, révoquée, disparue ou interdite : une seule porte close. */
  | { etat: "clos"; message: string }
  /** Nous, pas elle. */
  | { etat: "panne"; message: string };

/** Ce que rend `etiquette_resoudre` : une ligne, neuf colonnes. */
type LigneRendue = {
  ok?: unknown;
  message?: unknown;
  portee?: unknown;
  entite_type?: unknown;
  entite_id?: unknown;
  ecran?: unknown;
  chemin?: unknown;
  titre?: unknown;
  details?: unknown;
};

export type AppelResolveur = (jeton: string) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

/**
 * On normalise comme la base : rognage et minuscules. Un jeton recopié
 * à la main depuis une étiquette abîmée porte souvent un espace de
 * trop, et refuser pour ça serait refuser un utilisateur légitime.
 */
export function normaliserJeton(brut: string | null | undefined): string {
  return (brut ?? "").trim().toLowerCase();
}

/**
 * LA FORME DU JETON, VÉRIFIÉE AVANT DE DÉRANGER LA BASE.
 *
 * 16 octets en hexadécimal, soit 32 caractères. C'est la forme des cinq
 * étiquettes déjà en production (UUID sans tirets, en minuscules), celle
 * du défaut posé par 0090 § 1 (`encode(gen_random_bytes(16), 'hex')`),
 * et celle du second registre absorbé au § 4. Un seul alphabet, une
 * seule longueur, une seule expression régulière — ici et dans la
 * fonction SQL, que `lecture.test.ts` relit pour vérifier qu'elles ne
 * divergent pas.
 *
 * Le refaire ici n'est pas une redondance décorative :
 *
 *   • un balayage qui tente `/x/admin`, `/x/1` ou `/x/wp-login` ne coûte
 *     alors AUCUN aller-retour à la base et n'écrit rien dans son
 *     journal de tentatives — ce journal doit compter les vraies
 *     tentatives d'énumération, pas le bruit de fond d'Internet ;
 *   • le jeton ne descend jamais jusqu'à la base sous une forme qu'elle
 *     n'attend pas.
 *
 * SI LE JETON RACCOURCIT UN JOUR — la décision est ouverte, un jeton de
 * 16 caractères ferait gagner une version de QR entière et rendrait
 * l'étiquette de 25 × 15 mm confortable à scanner — c'est ICI et dans
 * 0090 § 6 que l'expression change, et nulle part ailleurs. Aucune
 * étiquette déjà collée n'est à réimprimer : les anciennes gardent leur
 * longueur, et il suffira d'accepter les deux.
 */
export function jetonBienForme(jeton: string): boolean {
  return /^[0-9a-f]{32}$/.test(jeton);
}

/**
 * L'appel, et la lecture de ce qu'il rend.
 *
 * L'ORDRE DES CONTRÔLES EST LE SUJET : la forme d'abord (aucun appel),
 * l'erreur de transport ensuite (une PANNE, jamais un refus), le refus
 * métier enfin. Inverser les deux derniers ferait dire « cette étiquette
 * ne mène à rien » à chaque hoquet du réseau, sur une étiquette
 * parfaitement valide et collée pour dix ans.
 */
export async function lireEtiquetteParJeton(
  brut: string | null | undefined,
  appel: AppelResolveur,
): Promise<Resultat> {
  const jeton = normaliserJeton(brut);
  if (!jetonBienForme(jeton)) {
    return { etat: "clos", message: PHRASE_REFUS };
  }

  let reponse: { data: unknown; error: { message: string } | null };
  try {
    reponse = await appel(jeton);
  } catch {
    // Une exception du client HTTP est une panne, pas un verdict.
    return { etat: "panne", message: PHRASE_PANNE };
  }

  if (reponse.error !== null) {
    return { etat: "panne", message: PHRASE_PANNE };
  }

  const ligne = premiereLigne(reponse.data);
  if (ligne === null) {
    // La fonction rend TOUJOURS une ligne, refus compris. N'en recevoir
    // aucune n'est donc pas un refus : c'est qu'autre chose s'est passé,
    // et on ne le maquille pas en « étiquette morte ».
    return { etat: "panne", message: PHRASE_PANNE };
  }

  if (ligne.ok !== true) {
    // LA PHRASE VIENT DE LA BASE quand elle en donne une : c'est elle
    // qui décide de ce qu'on révèle, et la recopier ici la ferait
    // diverger.
    const message =
      typeof ligne.message === "string" && ligne.message.trim() !== ""
        ? ligne.message
        : PHRASE_REFUS;
    return { etat: "clos", message };
  }

  const entiteType = typeof ligne.entite_type === "string" ? ligne.entite_type : "";
  const ecran = typeof ligne.ecran === "string" ? ligne.ecran : "";
  const titre = typeof ligne.titre === "string" && ligne.titre.trim() !== "" ? ligne.titre.trim() : "";

  if (ligne.portee === "publique") {
    const fiche = lireFichePublique(ligne.details);
    if (fiche === null || titre === "") {
      // `ok` vaut vrai mais la charge est inexploitable. On ne devine
      // pas, et on n'affiche surtout pas une fiche à trous devant un
      // inconnu : mieux vaut une page d'attente honnête.
      return { etat: "panne", message: PHRASE_PANNE };
    }
    return { etat: "publique", entiteType, titre, fiche };
  }

  if (ligne.portee !== "complet") {
    // Une portée que ce module ne connaît pas ne peut arriver qu'entre
    // une migration qui en ajoute une et le déploiement de cette page.
    // Le silence est alors la bonne réponse — et surtout pas un affichage
    // au hasard.
    return { etat: "panne", message: PHRASE_PANNE };
  }

  if (ecran === ECRAN_VIERGE) {
    // Rien à afficher d'autre : une étiquette vierge n'a ni titre utile
    // ni détails, et le résolveur ne lui donne aucun chemin.
    return { etat: "vierge" };
  }

  return {
    etat: "complet",
    entiteType,
    ecran,
    chemin: cheminInterne(ligne.chemin),
    titre,
  };
}

function premiereLigne(data: unknown): LigneRendue | null {
  const brut = Array.isArray(data) ? data[0] : data;
  if (brut === null || brut === undefined || typeof brut !== "object") return null;
  return brut as LigneRendue;
}

/**
 * LA FICHE BOTANIQUE, RECONSTRUITE CHAMP PAR CHAMP.
 *
 * Trois clés, nommées ici. Tout le reste de `details` est jeté sans être
 * regardé — y compris ce que la base pourrait y mettre demain.
 *
 * UNE FICHE ENTIÈREMENT VIDE N'EST PAS UNE FICHE : un passant devant
 * « (rien) / (rien) / (rien) » n'apprend pas ce qu'il a sous les yeux et
 * repart en croyant l'étiquette cassée. On rend `null`, ce qui donne une
 * page de panne — un aveu honnête plutôt qu'un cadre vide.
 */
function lireFichePublique(brut: unknown): FichePublique | null {
  if (brut === null || brut === undefined || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  const fiche: FichePublique = {
    nomCommun: texteOuNul(o.common_name),
    nomScientifique: texteOuNul(o.scientific_name),
    type: texteOuNul(o.type),
  };
  if (fiche.nomCommun === null && fiche.nomScientifique === null && fiche.type === null) {
    return null;
  }
  return fiche;
}

function texteOuNul(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre === "" ? null : propre;
}

/**
 * LE CHEMIN DE REDIRECTION — POURQUOI ON LE RELIT ALORS QU'IL VIENT DE
 * NOTRE PROPRE FONCTION SQL.
 *
 * Parce qu'une redirection est le seul endroit de cette page où une
 * chaîne devient une DESTINATION. « //ailleurs.example/piege » est un
 * chemin valide pour un navigateur : c'est une URL de protocole relatif,
 * qui sort du site. « https://… » aussi. Si un jour quelqu'un fabrique
 * un `chemin` à partir d'un libellé saisi — un nom de rack, par
 * exemple — la faute serait une redirection ouverte servie depuis notre
 * domaine, sur la seule route ouverte à tout Internet.
 *
 * On n'accepte donc qu'une barre oblique unique suivie d'autre chose
 * qu'une barre. Ce contrôle ne coûte rien et ferme la question pour de
 * bon.
 */
export function cheminInterne(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  const propre = brut.trim();
  if (!/^\/[^/\\]/.test(propre)) return null;
  return propre;
}
