import { INTERVENTION_KIND_LABELS, type InterventionKind } from "@/lib/field/types";

/**
 * La NATURE de l'intervention, en une forme de seize pixels.
 *
 * Six formes remplacent six mots. Sur une carte de 196 px, « Livraison »
 * écrit en toutes lettres mange la moitié d'une ligne pour une
 * information qu'on lit d'un coup d'œil — et le libellé n'était de
 * toute façon jamais réaffiché : le champ était saisi à la création
 * puis oublié.
 *
 * Elles vivent ICI et non dans `components/shell/Icon.tsx` : c'est une
 * préoccupation du planning, pas un enrichissement du système. Même
 * grille de 24, même trait, `currentColor` — pour que le jeu reste
 * cohérent avec le reste sans grossir le reste.
 *
 * La forme ne porte JAMAIS l'information toute seule : `role="img"` et
 * `aria-label` donnent le mot à qui écoute l'écran, et `<title>` le
 * donne à la souris. C'est la règle du produit, pas une politesse.
 */
const TRACES: Record<InterventionKind, string> = {
  // Un œil : on vient voir.
  visit: "M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  // Un cône de chantier.
  work: "m12 4 6 16H6l6-16Zm-2.6 7h5.2M4 20h16",
  // Une cisaille : l'entretien, c'est la taille.
  maintenance: "M6.8 4 17 15.4M17.2 4 7 15.4M5.6 20a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Zm12.8 0a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
  // Un camion.
  delivery: "M3 7h10v9H3V7Zm10 3h4l3 3.5V16h-7v-6ZM7 19.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm10 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z",
  // Une clé : on vient réparer.
  repair: "M10.5 6.5a4 4 0 0 1 5.4 5.2l4.4 4.4-2.2 2.2-4.4-4.4a4 4 0 0 1-5.2-5.4l2.5 2.5 1.5-1.5-2-3Z",
  // Trois points : on ne s'est pas prononcé.
  other: "M6 12h.01M12 12h.01M18 12h.01",
};

export function KindGlyph({
  kind,
  className = "h-4 w-4",
}: {
  kind: InterventionKind;
  className?: string;
}) {
  const libelle = INTERVENTION_KIND_LABELS[kind];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={libelle}
      className={className}
    >
      <title>{libelle}</title>
      <path d={TRACES[kind]} />
    </svg>
  );
}
