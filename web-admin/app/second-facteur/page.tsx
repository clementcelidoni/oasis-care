import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { currentAdmin } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/session";
import { mfaPolicy } from "@/lib/auth/mfa";
import { roleLabel } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LE SECOND FACTEUR EXIGÉ — spec p.32
 * ==================================================================
 *
 * « Préparer ou exiger une authentification renforcée pour les
 * administrateurs lorsque disponible. »
 *
 * On voit cette page dans un seul cas : `ADMIN_MFA_POLICY=require`, et
 * une session qui n'a pas présenté de second facteur (`aal2`). C'est
 * `requireAdmin()` qui y renvoie, juste après avoir résolu l'identité
 * et avant tout contrôle de permission.
 *
 * ------------------------------------------------------------------
 * POURQUOI ELLE VIT HORS DU GROUPE `(control)`
 * ------------------------------------------------------------------
 * Parce que la coquille appelle `requireAdmin()` en première
 * instruction. Une page de refus placée à l'intérieur serait renvoyée
 * vers elle-même à chaque rendu : la boucle de redirection classique
 * des écrans d'authentification. Elle est donc servie par le layout
 * racine, et elle résout l'identité par `currentAdmin()`, qui ne
 * décide rien.
 *
 * ------------------------------------------------------------------
 * ELLE NE FAIT PAS SEMBLANT D'AVOIR UNE SOLUTION
 * ------------------------------------------------------------------
 * Ce jalon ne livre pas d'écran d'enrôlement. La page dit donc la
 * vérité : l'infrastructure existe déjà côté Supabase — `mfa_factors`,
 * `mfa_challenges`, la colonne `aal` sur les sessions — mais
 * l'inscription d'un facteur se fait aujourd'hui ailleurs. Écrire un
 * bouton « Activer » qui ne marche pas serait pire que ne rien écrire.
 */
export const metadata: Metadata = {
  title: "Second facteur requis — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function SecondFacteurPage() {
  // Pas `requireAdmin()` : cette page est justement la destination de
  // son refus. `currentAdmin()` résout l'identité sans rien fermer, et
  // renvoie vers `/login` si personne n'est connecté.
  const admin = await currentAdmin();

  // Un compte qui n'est pas administrateur de plateforme n'apprend rien
  // ici non plus : même 404 que partout ailleurs.
  if (!admin) notFound();

  const policy = mfaPolicy();

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-lg">
        <p className="wordmark text-[11px] text-ink-faint">Oasis Care</p>

        <h1 className="mt-6 text-[length:var(--text-page)] font-semibold tracking-tight">
          Un second facteur est exigé
        </h1>

        <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
          Le Control Center est configuré sur{" "}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
            ADMIN_MFA_POLICY={policy}
          </code>
          . Votre session a été authentifiée, mais elle n&apos;a pas présenté de second
          facteur — elle est de niveau <span className="font-medium text-ink">aal1</span>.
          Aucun écran ne s&apos;ouvre tant que ce n&apos;est pas le cas.
        </p>

        <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
          Vous êtes bien reconnu comme{" "}
          <span className="font-medium text-ink">{roleLabel(admin.role)}</span> : ce
          n&apos;est pas un problème de rôle, et il n&apos;y a pas d&apos;accès à demander.
        </p>

        <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="eyebrow">Ce qu&apos;il faut faire</p>
          <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Ce jalon ne livre pas encore d&apos;écran d&apos;enrôlement. Un facteur
            s&apos;inscrit aujourd&apos;hui depuis le tableau de bord Supabase du projet, puis
            se présente à la connexion suivante. En attendant, un exploitant peut remettre{" "}
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
              ADMIN_MFA_POLICY
            </code>{" "}
            à <span className="font-medium text-ink">encourage</span> et redéployer : la
            bannière revient, la porte se rouvre.
          </p>
          <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Si le niveau de votre session est simplement <em>inconnu</em> — le serveur
            d&apos;authentification n&apos;a pas répondu — cette page s&apos;affiche aussi,
            volontairement : sous <span className="font-medium text-ink">require</span>, une
            absence de réponse ferme, elle n&apos;ouvre pas.
          </p>
        </div>

        <form action={signOut} className="mt-8">
          <button
            type="submit"
            className="rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-3.5 py-2 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:border-ink-faint"
          >
            Se déconnecter
          </button>
        </form>
      </div>
    </main>
  );
}
