import { UnknownValue } from "@/components/ui";
import { shareOf } from "@/lib/dashboard/aggregate";
import { formatCount, formatPercent } from "@/lib/format";

/**
 * ==================================================================
 * UNE PART D'UN TOUT, DESSINÉE
 * ==================================================================
 *
 * POURQUOI CE GRAPHIQUE-LÀ, ET PAS UNE COURBE.
 *
 * La spec p.34 demande « graphiques ». Les deux fonctions de 0075 ne
 * rendent que des scalaires, et ce n'est pas une paresse de leur
 * auteur : il n'existe AUCUNE série temporelle dans cette base. Les
 * compteurs d'IA sont mensuels et cumulatifs, sans instantané
 * quotidien à soustraire ; `organization_subscriptions` n'a qu'une
 * ligne par entreprise, donc pas d'historique ; le journal de
 * connexions de GoTrue est vide. Tracer une courbe supposerait
 * d'inventer les points intermédiaires — exactement la « valeur
 * fictive » que la spec p.4 interdit.
 *
 * Ce qu'on peut dessiner sans rien inventer, c'est un RAPPORT entre
 * deux chiffres mesurés au même instant. Et il apprend quelque chose :
 * « 0 entreprise sur 1 a un abonnement suivi » explique le MRR inconnu
 * mieux qu'un paragraphe, parce qu'on voit la barre vide.
 */
export function ShareBar({
  label,
  part,
  whole,
  unit,
  reason = null,
  note,
}: {
  label: string;
  part: number | null;
  whole: number | null;
  /** Ce qu'on compte : « comptes », « entreprises ». */
  unit: string;
  /** Le motif, si le rapport est incalculable. */
  reason?: string | null;
  note?: string;
}) {
  const ratio = shareOf(part, whole);
  const percent = ratio === null ? null : Math.round(ratio * 1000) / 10;

  // `shareOf` ne rend jamais plus de 1 : une part supérieure au tout y
  // devient `null`. La barre n'a donc rien à raboter — et c'est le
  // point, parce qu'un rapport raboté se dessine comme un 100 %
  // plausible au lieu de signaler l'incohérence qu'il est.
  const width = ratio === null ? 0 : ratio * 100;

  const incoherent =
    part !== null && whole !== null && whole > 0 && (part < 0 || part > whole);

  const missing =
    reason ??
    (part === null || whole === null
      ? "L'un des deux chiffres de ce rapport est inconnu."
      : incoherent
        ? "La part dépasse le tout : les deux chiffres ne comptent pas la même population. Le rapport n'est pas affiché, parce qu'un pourcentage calculé là-dessus serait faux tout en ayant l'air juste."
        : "Le dénominateur est nul : une part n'a pas de sens tant qu'il n'y a rien à répartir.");

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[var(--text-body)] font-medium text-ink">{label}</p>
        {ratio === null ? (
          <UnknownValue reason={missing} label="Part inconnue" compact />
        ) : (
          <p className="tabular text-[var(--text-secondary)] text-ink-soft">
            <span className="font-semibold text-ink">{formatCount(part)}</span> sur{" "}
            {formatCount(whole)} {unit} · {formatPercent(percent)}
          </p>
        )}
      </div>

      {/*
        La piste est décrite pour un lecteur d'écran, qui ne voit pas la
        barre : sans `aria-label`, le graphique n'existerait que pour la
        moitié des lecteurs.
      */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-sunken"
        role="img"
        aria-label={
          ratio === null
            ? `${label} : part inconnue`
            : `${label} : ${formatCount(part)} sur ${formatCount(whole)} ${unit}`
        }
      >
        <div
          className={`h-full rounded-[var(--radius-pill)] ${ratio === null ? "bg-transparent" : "bg-accent"}`}
          style={{ width: `${width}%` }}
        />
      </div>

      {/* Le motif ET la note, pas l'un à la place de l'autre : la note
          dit ce que le rapport signifie, le motif dit pourquoi il
          manque. Les deux restent vrais en même temps. */}
      {ratio === null && (
        <p className="mt-2 max-w-prose text-[var(--text-secondary)] leading-snug text-unknown">
          {missing}
        </p>
      )}
      {note && (
        <p className="mt-2 max-w-prose text-[var(--text-secondary)] leading-snug text-ink-faint">
          {note}
        </p>
      )}
    </div>
  );
}
