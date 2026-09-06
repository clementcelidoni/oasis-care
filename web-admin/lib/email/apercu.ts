/**
 * ==================================================================
 * L'APERÇU — voir le message AVANT qu'il parte à tout le parc
 * ==================================================================
 *
 * « Envoyer à cinq cents personnes sans avoir vu le rendu est le
 * meilleur moyen d'expédier "Bonjour {{prenom}}". » Ce fichier existe
 * pour ces deux gestes : MONTRER le texte tel qu'il partira, et
 * REFUSER un brouillon qui contient encore une variable.
 *
 * ------------------------------------------------------------------
 * CE FICHIER EST UN MIROIR, ET IL FAUT LE SAVOIR
 * ------------------------------------------------------------------
 * Le gabarit qui rend vraiment le message vit dans
 * `web-pro/lib/email/gabarits/catalogue.ts` (`annonceCommerciale`), et
 * la fonction Edge d'envoi l'importe. Oasis Admin est une application
 * Next SÉPARÉE — pas de monorepo, pas de `workspaces` à la racine — et
 * ne peut pas importer ce fichier.
 *
 * Il y a donc DEUX rendus du même message, et deux rendus divergent. Ce
 * qui limite les dégâts, et il faut le mesurer honnêtement :
 *
 *   • la partie que ce fichier reproduit est MINUSCULE et stable — une
 *     ligne d'accroche, puis les paragraphes du corps découpés sur les
 *     lignes vides ;
 *   • le CORPS lui-même n'est pas un gabarit : c'est le texte qu'un
 *     administrateur vient d'écrire, et il est affiché tel quel ;
 *   • ce que ce fichier NE reproduit PAS — l'habillage, le pied de
 *     message, le lien de désabonnement, le logo — est annoncé à
 *     l'écran au lieu d'être imité de mémoire. Un aperçu qui inventerait
 *     un pied de page serait plus dangereux qu'un aperçu qui dit « le
 *     pied est ajouté à l'envoi ».
 *
 * LA VRAIE CORRECTION, le jour où quelqu'un s'en occupera : un appel
 * qui demande le rendu à la couche qui l'expédie, plutôt qu'un second
 * rendu. Elle n'est pas dans le périmètre de cet écran, et la
 * signaler vaut mieux que la simuler.
 */

/** Ce que la ligne d'accroche du gabarit ajoute devant le corps. */
export function ligneDAccroche(nomEntreprise: string): string {
  return `Bonjour ${nomEntreprise},`;
}

/**
 * Le corps, découpé comme le gabarit le découpe : un paragraphe par
 * bloc séparé d'une ligne vide, les blancs de bord retirés, les blocs
 * vides jetés.
 *
 * Recopié de `annonceCommerciale.corps` — voir l'avertissement en
 * tête de fichier.
 */
export function paragraphes(corps: string): string[] {
  return corps
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Le message tel qu'un destinataire le lira, en texte.
 *
 * `nomEntreprise` doit être celui d'un VRAI destinataire, pris dans
 * l'audience. Un aperçu rendu sur « Entreprise exemple » ne prouve
 * rien : c'est justement sur une vraie valeur qu'on voit qu'une
 * variable n'a pas été remplacée.
 */
export function rendreApercu(nomEntreprise: string, corps: string): string[] {
  return [ligneDAccroche(nomEntreprise), ...paragraphes(corps)];
}

// ------------------------------------------------------------------
// CE QUI INTERDIT D'ENVOYER
// ------------------------------------------------------------------

export type Probleme = {
  /** `bloquant` empêche l'envoi. `reserve` s'affiche et laisse passer. */
  gravite: "bloquant" | "reserve";
  champ: "titre" | "objet" | "corps" | "motif";
  phrase: string;
};

/**
 * Les motifs de variable non remplacée.
 *
 * `{{…}}` ET `${…}` sont BLOQUANTS : aucune des deux formes n'est
 * remplacée par quoi que ce soit dans le corps d'une campagne — le
 * gabarit insère le texte tel quel — donc une accolade double part
 * telle quelle chez cinq cents personnes. C'est le défaut exact que
 * cette vérification existe pour empêcher, et il ne mérite pas un
 * avertissement qu'on clique au travers.
 *
 * `{mot}` seul est une RÉSERVE : une accolade simple peut être
 * légitime — un montant, une note de bas de texte — et bloquer dessus
 * finirait par apprendre à contourner la vérification.
 */
const VARIABLE_DOUBLE = /\{\{\s*[^}]*\}\}|\$\{\s*[^}]*\}/g;
const VARIABLE_SIMPLE = /\{\s*[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_ ]*\s*\}/g;

function extraire(texte: string, motif: RegExp): string[] {
  const trouvailles = texte.match(motif);
  if (trouvailles === null) return [];
  return [...new Set(trouvailles.map((t) => t.trim()))];
}

/** Le brouillon d'une annonce, tel que le formulaire le rend. */
export type Brouillon = {
  titre: string;
  objet: string;
  corps: string;
  motif: string;
};

/**
 * Tout ce qui empêche — ou inquiète — avant d'écrire à tout le parc.
 *
 * FONCTION PURE, et appelée DEUX FOIS : par le formulaire, pour dire
 * tout de suite ce qui ne va pas, et par la Server Action, parce qu'un
 * contrôle qui n'existe que dans le navigateur n'existe pas. Les
 * contraintes de la base (objet non vide, 300 caractères, pas de retour
 * à la ligne, motif non vide) sont les mêmes : ce qui est vérifié ici
 * l'est pour donner une phrase utile AVANT le refus, jamais à la place.
 */
export function verifierBrouillon(brouillon: Brouillon): Probleme[] {
  const problemes: Probleme[] = [];

  if (brouillon.titre.trim() === "") {
    problemes.push({
      gravite: "bloquant",
      champ: "titre",
      phrase: "Donnez un titre à cette annonce : c'est ainsi qu'on la retrouvera dans l'historique.",
    });
  }

  const objet = brouillon.objet.trim();
  if (objet === "") {
    problemes.push({
      gravite: "bloquant",
      champ: "objet",
      phrase: "L'objet est vide. Un message sans objet est ouvert par personne et signalé par beaucoup.",
    });
  }
  if (objet.length > 300) {
    problemes.push({
      gravite: "bloquant",
      champ: "objet",
      phrase: `L'objet fait ${objet.length} caractères ; la base en accepte 300 au plus.`,
    });
  }
  if (/[\r\n]/.test(brouillon.objet)) {
    problemes.push({
      gravite: "bloquant",
      champ: "objet",
      phrase:
        "L'objet contient un retour à la ligne. La base le refuse, et pour une bonne raison : un retour à la ligne dans un en-tête permet d'ajouter un destinataire invisible.",
    });
  }
  // Un objet trop long est coupé dans toutes les boîtes de réception.
  // Ce n'est pas une règle, c'est une observation — d'où la réserve.
  if (objet.length > 78) {
    problemes.push({
      gravite: "reserve",
      champ: "objet",
      phrase: `L'objet fait ${objet.length} caractères : la plupart des boîtes de réception en montrent une soixantaine et coupent le reste.`,
    });
  }

  const corps = brouillon.corps.trim();
  if (corps === "") {
    problemes.push({
      gravite: "bloquant",
      champ: "corps",
      phrase: "Le message est vide.",
    });
  }

  for (const champ of ["objet", "corps"] as const) {
    const texte = champ === "objet" ? brouillon.objet : brouillon.corps;

    const doubles = extraire(texte, VARIABLE_DOUBLE);
    if (doubles.length > 0) {
      problemes.push({
        gravite: "bloquant",
        champ,
        phrase:
          `${doubles.join(", ")} : rien ne remplace ces variables. Le corps d'une annonce est envoyé TEL QUEL — ` +
          "seul « Bonjour <nom de l'entreprise>, » est ajouté devant. Ce texte partirait avec ses accolades.",
      });
    }

    const simples = extraire(texte, VARIABLE_SIMPLE);
    if (simples.length > 0) {
      problemes.push({
        gravite: "reserve",
        champ,
        phrase: `${simples.join(", ")} : si c'est une variable, elle ne sera pas remplacée. Si c'est du texte, ignorez cette réserve.`,
      });
    }
  }

  if (brouillon.motif.trim() === "") {
    problemes.push({
      gravite: "bloquant",
      champ: "motif",
      phrase:
        "Le motif est obligatoire, et la base le refusera de toute façon. Écrire à tout le parc se justifie au moment où on le fait, pas six mois plus tard.",
    });
  }

  return problemes;
}

export function estEnvoyable(problemes: readonly Probleme[]): boolean {
  return !problemes.some((probleme) => probleme.gravite === "bloquant");
}
