import { Card } from "@/components/ui";
import type { UnknownReasons } from "@/lib/dashboard/types";

/**
 * ==================================================================
 * « CE QUE CET ÉCRAN NE SAIT PAS ENCORE CALCULER »
 * ==================================================================
 *
 * Chaque carte dit déjà son inconnu et son motif. Ce panneau les
 * rassemble, et il sert trois choses qu'une carte isolée ne peut pas
 * rendre :
 *
 *   • l'AMPLEUR — « sept chiffres sur seize » n'est pas la même
 *     information que sept tirets dispersés dans une grille ;
 *   • une LISTE DE TRAVAUX — chaque motif nomme la donnée qui manque,
 *     donc ce qu'il faudrait construire pour que le chiffre existe ;
 *   • un endroit ATTEIGNABLE AU CLAVIER où lire les motifs en entier,
 *     là où une infobulle au survol se perd.
 *
 * Il est replié par défaut (spec p.35 : les détails techniques
 * s'affichent à la demande), mais son résumé annonce toujours le
 * nombre. On ne cache pas qu'il y a quelque chose à déplier.
 */
export function UnknownsPanel({
  id,
  reasons,
  labels,
}: {
  /** L'ancre vers laquelle pointent les cartes inconnues. */
  id?: string;
  reasons: UnknownReasons;
  /** Nom lisible de chaque colonne inconnue, dans l'ordre d'affichage souhaité. */
  labels: Record<string, string>;
}) {
  // L'ordre est celui des libellés — donc celui de l'écran. Un motif
  // que la base rendrait sans qu'on l'ait prévu passe à la fin plutôt
  // que de disparaître : une colonne devenue inconnue doit se voir.
  const keys = Object.keys(labels)
    .filter((key) => key in reasons)
    .concat(Object.keys(reasons).filter((key) => !(key in labels)));

  if (keys.length === 0) {
    return (
      <Card className="border-positive/30 bg-positive-wash px-4 py-3">
        <p className="text-[var(--text-body)] text-ink-soft">
          Tous les chiffres de cet écran sont calculés depuis les vraies données.
        </p>
      </Card>
    );
  }

  return (
    <details id={id} className="unknown-rule scroll-mt-24 rounded-[var(--radius-card)]">
      <summary className="cursor-pointer list-none px-4 py-3 marker:content-none">
        <span className="text-[var(--text-body)] font-semibold text-ink">
          {keys.length === 1
            ? "Un chiffre de cet écran est inconnu"
            : `${keys.length} chiffres de cet écran sont inconnus`}
        </span>
        <span className="ml-2 text-[var(--text-secondary)] text-ink-soft">
          — la donnée n&apos;existe pas dans cette base. Déplier pour lire pourquoi, chiffre
          par chiffre.
        </span>
      </summary>

      <dl className="divide-y divide-unknown-line border-t border-unknown-line">
        {keys.map((key) => (
          <div key={key} className="px-4 py-3">
            <dt className="text-[var(--text-secondary)] font-semibold text-ink">
              {labels[key] ?? key}
            </dt>
            <dd className="mt-1 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              {reasons[key]}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
