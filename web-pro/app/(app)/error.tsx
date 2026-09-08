"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * §PÉAGE — LA DERNIÈRE LIGNE AVANT L'ÉCRAN BLANC.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL Y AVAIT ICI AVANT : RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * `web-pro` n'avait aucun `error.tsx`. Une action serveur qui levait
 * aboutissait donc à la page d'erreur par défaut de Next — « Something
 * went wrong », en anglais, sans issue. Et en production, Next MASQUE
 * le message des erreurs serveur : même la phrase française posée par
 * `traduireRefus()` n'arrivait pas jusqu'à l'écran.
 *
 * Un paysagiste dont le prélèvement a échoué voyait donc une panne. Il
 * ne pouvait pas savoir qu'il s'agissait d'argent, ni où aller.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL FAIT, ET CE QU'IL NE PEUT PAS FAIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * IL NE PEUT PAS LIRE LA BASE : une frontière d'erreur est un composant
 * client. Il ne sait donc pas si le refus vient du péage — c'est
 * `traduireRefus()`, côté serveur, qui le sait, et le bandeau de la
 * coquille qui l'annonce à l'avance. Ce fichier est le filet en
 * dessous : il rend l'erreur lisible, propose de réessayer, et donne
 * les deux portes qui résolvent l'immense majorité des cas.
 *
 * IL N'ACCUSE PAS L'ABONNEMENT. Dire « payez » à quelqu'un qui vient de
 * heurter un vrai bogue serait la pire des méprises : il paierait deux
 * fois, ou il partirait. On propose l'écran d'abonnement comme une
 * piste parmi deux, jamais comme un diagnostic.
 */
export default function ErreurApplication({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Le `digest` est la seule trace qui relie cet écran à la ligne du
    // journal serveur. Sans lui, une erreur signalée par téléphone est
    // introuvable.
    console.error("Erreur dans l'application :", error.digest ?? "(sans référence)", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-8 py-16">
      <h1 className="text-[var(--text-page)] font-semibold text-ink">
        Cette action n&apos;a pas abouti.
      </h1>

      <p className="mt-3 text-[var(--text-body)] text-ink-soft">
        Rien n&apos;a été perdu : vos clients, vos devis et vos factures sont intacts. C&apos;est
        seulement la dernière opération qui n&apos;est pas passée.
      </p>

      {/* Le message n'arrive qu'en développement — en production, Next
          le remplace par une référence. On affiche donc l'un OU
          l'autre, et jamais un cadre vide. */}
      {error.message !== "" && (
        <p className="mt-4 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-[var(--text-secondary)] text-ink">
          {error.message}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink hover:bg-accent-hover"
        >
          Réessayer
        </button>
        <Link
          href="/entreprise/abonnement"
          className="inline-flex items-center rounded-[var(--radius-control)] border border-line px-3.5 py-2 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          Vérifier mon abonnement
        </Link>
        <Link
          href="/aide"
          className="inline-flex items-center rounded-[var(--radius-control)] px-3.5 py-2 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          Nous écrire
        </Link>
      </div>

      {error.digest !== undefined && (
        <p className="mt-6 text-[var(--text-secondary)] text-ink-soft">
          Si vous nous écrivez, donnez-nous cette référence : <code>{error.digest}</code>
        </p>
      )}
    </div>
  );
}
