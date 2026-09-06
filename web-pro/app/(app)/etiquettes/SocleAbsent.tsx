/**
 * CE QU'ON MONTRE QUAND LA MIGRATION 0090 N'EST PAS APPLIQUÉE.
 *
 * Sans elle, il n'y a ni table de modèles, ni colonnes de portée sur
 * `smart_tags`, ni fonction pour poser une étiquette. Chaque requête
 * échoue, et Next.js affiche alors sa page d'erreur de développeur —
 * une trace d'exception devant un pépiniériste qui n'y peut rien.
 *
 * On préfère dire la vérité en français : ce n'est pas votre faute, la
 * base n'est pas à jour, voici quoi demander à qui de droit. Le détail
 * technique est là aussi, mais en second, pour la personne qui saura
 * quoi en faire.
 */
export function SocleAbsent({ detail }: { detail: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-warning/30 bg-warning-wash px-5 py-4">
      <p className="text-[length:var(--text-card)] font-semibold text-warning">
        Les étiquettes ne sont pas encore installées sur cette base
      </p>
      <p className="mt-2 text-[var(--text-body)] text-ink-soft">
        Tout ce module repose sur la migration <code>0090_etiquettes.sql</code> : c&apos;est elle
        qui crée les modèles d&apos;étiquette, qui apprend à <code>smart_tags</code> à désigner
        autre chose qu&apos;une plante, et qui pose les fonctions permettant de générer un QR. Tant
        qu&apos;elle n&apos;est pas appliquée, il n&apos;y a rien à lire et rien à imprimer.
      </p>
      <p className="mt-2 text-[var(--text-body)] text-ink-soft">
        Ce n&apos;est pas un problème de droits ni de données : demandez l&apos;application de
        cette migration à la personne qui administre la base.
      </p>
      {detail && (
        <p className="tabular mt-3 border-t border-warning/20 pt-3 text-[var(--text-secondary)] text-ink-faint">
          Détail technique : {detail}
        </p>
      )}
    </div>
  );
}
