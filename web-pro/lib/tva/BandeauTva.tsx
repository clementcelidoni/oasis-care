/**
 * §TVA — LE BANDEAU QUI DIT OÙ EN EST LA VÉRIFICATION.
 *
 * Composant serveur pur : il ne lit rien, il ne décide rien, il rend ce
 * que `etatValidationTva()` a établi. Le tri des cas est ailleurs, et
 * il n'y a donc aucun endroit ici où une phrase pourrait se retrouver
 * devant le mauvais état.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'IL NE MONTRE PAS, ET POURQUOI
 * ══════════════════════════════════════════════════════════════════
 *
 * « ABSENT » NE S'AFFICHE PAS ICI. Le champ manquant est déjà signalé,
 * juste à côté, par la liste « ce qu'il manque pour souscrire »
 * (`manquePourFacturer()`), qui explique la même chose et mène au bon
 * champ. Deux avertissements pour un seul champ vide font douter de la
 * saisie qu'on vient de faire.
 *
 * `vies_last_error` NE S'AFFICHE PAS NON PLUS. « MS_UNAVAILABLE » ou
 * « HTTP 503 » ne veut rien dire pour un paysagiste, et l'afficher lui
 * donnerait l'impression d'avoir cassé quelque chose. Ce texte-là est
 * conservé en base pour l'écran d'administration, qui s'adresse à
 * quelqu'un qui peut en faire quelque chose.
 */

import type { EtatValidationTva, TonEtatTva } from "./etats.ts";

/**
 * Le ton porte le sens, la couleur ne fait que l'accompagner : chaque
 * bandeau dit en toutes lettres ce qu'il y a à faire, et reste donc
 * lisible pour qui ne distingue pas l'ambre du vert.
 */
const HABILLAGE: Record<TonEtatTva, string> = {
  neutre: "border-line bg-surface-sunken text-ink-soft",
  attente: "border-warning bg-warning-wash text-warning",
  succes: "border-positive bg-positive-wash text-ink",
  faute: "border-critical bg-critical-wash text-critical",
};

export function BandeauTva({
  etat,
  className = "",
}: {
  etat: EtatValidationTva;
  className?: string;
}) {
  // Le champ vide est déjà dit ailleurs, et mieux.
  if (etat.code === "absent") return null;

  return (
    <div
      className={`rounded-[var(--radius-card)] border px-4 py-3 ${HABILLAGE[etat.ton]} ${className}`}
      // « status » et non « alert » : rien ici n'est urgent, et une
      // annonce impérieuse à chaque affichage de la page fatiguerait
      // quiconque navigue au lecteur d'écran.
      role="status"
    >
      <p className="text-[var(--text-body)] font-medium">{etat.titre}</p>
      {etat.detail !== null && (
        <p className="mt-1 text-[var(--text-secondary)] opacity-90">{etat.detail}</p>
      )}
    </div>
  );
}
