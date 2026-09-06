import type { FichePublique } from "../lecture";

/**
 * §15 — CE QUE VOIT UN PASSANT QUI SCANNE UNE ÉTIQUETTE DANS UN JARDIN.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS LIGNES, ET PAS UNE DE PLUS
 * ══════════════════════════════════════════════════════════════════
 *
 * Nom commun, nom scientifique, type. C'est tout ce que
 * `etiquette_resoudre` accepte de rendre à un inconnu, et c'est tout ce
 * que ce composant sait afficher — son type d'entrée n'a que trois
 * champs, si bien qu'il ne PEUT PAS afficher davantage, même si la base
 * en rendait davantage un jour.
 *
 * CE QUI EN EST ABSENT, ET POURQUOI :
 *   • le nom d'usage (« le palmier de Mamie ») est une donnée
 *     personnelle, et il désigne souvent quelqu'un ;
 *   • les coordonnées GPS situent le jardin d'un client ;
 *   • l'état sanitaire d'un végétal est un jugement professionnel que
 *     le propriétaire n'a pas demandé à publier ;
 *   • le jardin, le client, la date de plantation, les notes : rien de
 *     tout cela n'appartient au passant.
 *
 * ET RIEN NE SORT DE LÀ POUR UNE AUTRE FAMILLE D'OBJET. Un lot de
 * pépinière porte un fournisseur et une quantité, un matériel porte un
 * numéro de série, un lot BioLab porte un savoir-faire. Aucun des trois
 * n'a à parler à un passant, même publié — 0090 § 6 ne remplit la fiche
 * publique que dans la branche « plante ».
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI ON DIT QUI PUBLIE, ET COMMENT ON NE LE DIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le passant doit comprendre qu'il n'est pas tombé sur une page
 * cassée : quelqu'un a délibérément publié cette fiche. On le dit en
 * une phrase — SANS nommer l'entreprise, sans lien, sans logo
 * cliquable. Le nom de l'entreprise dirait à un promeneur chez qui il
 * se trouve, ce qui est exactement le genre de chose qu'un client de
 * paysagiste n'a jamais accepté de publier.
 */
export function Fiche({
  titre,
  fiche,
}: {
  titre: string;
  fiche: FichePublique;
}) {
  // Le nom scientifique ne se répète pas quand il EST déjà le titre :
  // le résolveur retombe dessus lorsqu'une plante n'a pas de nom commun,
  // et l'afficher deux fois donnerait une fiche qui a l'air en double.
  const scientifiqueAAfficher =
    fiche.nomScientifique !== null && fiche.nomScientifique !== titre
      ? fiche.nomScientifique
      : null;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        {/* Une marque, pas une navigation : rien ici n'est cliquable. */}
        <div className="mb-6 h-10 w-10 rounded-lg bg-accent" aria-hidden />

        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          {libelleType(fiche.type) ?? "Végétal"}
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{titre}</h1>

        {scientifiqueAAfficher !== null ? (
          <p className="mt-1 text-base italic text-ink-soft">{scientifiqueAAfficher}</p>
        ) : null}

        <p className="mt-8 border-t border-line pt-4 text-sm leading-relaxed text-ink-soft">
          Cette fiche est publiée par le propriétaire de ce végétal. Elle ne dit rien de plus :
          ni où il se trouve, ni à qui il appartient, ni comment il se porte.
        </p>
      </div>
    </main>
  );
}

/**
 * LE TYPE DE VÉGÉTAL, EN FRANÇAIS.
 *
 * La base stocke le vocabulaire de l'application iPhone (`PlantType`,
 * en camelCase). Cette table le traduit pour la seule page du produit
 * qu'un non-utilisateur puisse voir. Un mot inconnu — parce qu'un jour
 * quelqu'un ajoutera un cas à l'énumération — ne s'affiche PAS tel
 * quel : « flowerBed » sur une étiquette de jardin public a l'air d'une
 * fuite de code, ce qui est pire que rien. On retombe alors sur le
 * libellé générique.
 */
const TYPES: Record<string, string> = {
  houseplant: "Plante d'intérieur",
  pottedPlant: "Plante en pot",
  tree: "Arbre",
  palm: "Palmier",
  shrub: "Arbuste",
  hedge: "Haie",
  flowerBed: "Massif",
  lawn: "Pelouse",
  vegetable: "Potager",
  other: "Végétal",
};

function libelleType(brut: string | null): string | null {
  if (brut === null) return null;
  return TYPES[brut] ?? null;
}
