/**
 * ==================================================================
 * OASIS CARE / CONTROL CENTER — le titre, spec p.3 et p.34
 * ==================================================================
 *
 * « Afficher en grand : OASIS CARE — CONTROL CENTER. »
 *
 * Sur DEUX lignes, et pas une. La première porte l'identité commune aux
 * trois applications ; la seconde dit laquelle des trois on regarde, et
 * c'est celle-là qui doit trancher. Sur une seule ligne, « Oasis Care
 * Control Center » se lit d'un bloc et ressemble de loin à « Oasis Care
 * Pro » — exactement la confusion que la spec p.34 demande d'éviter.
 *
 * La seconde ligne est donc dans la couleur d'accent, plus lourde, plus
 * espacée. C'est le seul endroit du produit où l'on écrit ainsi.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span
        className="wordmark inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] bg-accent text-[11px] text-accent-ink"
        title="Oasis Care Control Center"
      >
        OC
      </span>
    );
  }

  return (
    <span className="flex flex-col leading-none">
      <span className="wordmark text-[11px] text-ink-soft">Oasis Care</span>
      <span className="wordmark mt-1 text-[13px] text-accent">Control Center</span>
    </span>
  );
}

/**
 * La version « en grand » : réservée à l'écran de connexion et au haut
 * du tableau de bord. Ailleurs, la version de la barre latérale suffit
 * — un titre répété en 40 points sur chaque page prend la place des
 * chiffres qu'on vient lire.
 */
export function WordmarkLarge() {
  return (
    <span className="flex flex-col leading-none">
      <span className="wordmark text-[length:var(--text-section)] text-ink">Oasis Care</span>
      <span className="wordmark mt-2 text-[length:var(--text-page)] text-accent">
        Control Center
      </span>
    </span>
  );
}
