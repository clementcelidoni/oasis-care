import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { currentAdmin } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/session";
import { EnrolementTotp } from "@/lib/auth/enrolement-totp";
import { roleLabel } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LE SECOND FACTEUR — spec p.32
 * ==================================================================
 *
 * « Préparer ou exiger une authentification renforcée pour les
 * administrateurs lorsque disponible. »
 *
 * ------------------------------------------------------------------
 * CETTE PAGE EST LA RÉPONSE AU SEUL PIÈGE VRAIMENT DANGEREUX DU SUJET
 * ------------------------------------------------------------------
 * Exiger un second facteur avant de livrer de quoi en poser un enferme
 * dehors tout le monde, y compris celui qui a basculé le réglage. La
 * seule sortie serait alors une variable d'environnement et un
 * redéploiement.
 *
 * Elle est aussi la SEULE page atteignable par un administrateur dont la
 * session n'est pas `aal2` : `requireAdmin()` y renvoie juste après avoir
 * résolu l'identité et AVANT tout contrôle de permission. C'est donc
 * exactement là que l'enrôlement doit vivre. En l'y posant, quelqu'un
 * sans facteur n'est plus enfermé DEHORS — il est enfermé DANS
 * l'enrôlement, ce qui est le comportement voulu.
 *
 * ------------------------------------------------------------------
 * POURQUOI ELLE VIT HORS DU GROUPE `(control)`
 * ------------------------------------------------------------------
 * Parce que la coquille appelle `requireAdmin()` en première
 * instruction. Une page placée à l'intérieur serait renvoyée vers
 * elle-même à chaque rendu : la boucle de redirection classique des
 * écrans d'authentification. Elle est donc servie par le layout racine,
 * et elle résout l'identité par `currentAdmin()`, qui ne décide rien.
 *
 * ------------------------------------------------------------------
 * ET LA MOITIÉ QUI NE DÉPEND PAS DE CET ÉCRAN
 * ------------------------------------------------------------------
 * Depuis la migration 0081, `platform_admin_require_mfa()` est appelée
 * par TOUTES les écritures administratives en SQL et par AUCUNE lecture.
 * Un contournement de cette page — un onglet resté ouvert, une Server
 * Action postée à la main — ne donne donc aucun droit d'écriture. La
 * page organise le parcours ; la base tient la porte.
 */
export const metadata: Metadata = {
  title: "Second facteur — Oasis Care Control Center",
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

  const { mfa } = admin;

  const origine =
    mfa.requiredBy === "environnement"
      ? "la variable d'environnement ADMIN_MFA_POLICY=require"
      : mfa.requiredBy === "base"
        ? "la politique enregistrée en base, réglée depuis Paramètres → Sécurité"
        : null;

  return (
    <main className="flex min-h-full flex-1 justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <p className="wordmark text-[11px] text-ink-faint">Oasis Care</p>

        <h1 className="mt-5 text-[length:var(--text-page)] font-semibold tracking-tight">
          {mfa.blocking ? "Un second facteur est exigé" : "Votre second facteur"}
        </h1>

        {mfa.blocking ? (
          <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Votre session a bien été authentifiée, mais elle n&apos;a pas présenté de second
            facteur — elle est de niveau{" "}
            <span className="font-medium text-ink">{mfa.currentLevel ?? "inconnu"}</span>. Aucun
            écran ne s&apos;ouvre tant que ce n&apos;est pas le cas. Vous êtes reconnu comme{" "}
            <span className="font-medium text-ink">{roleLabel(admin.role)}</span> : ce n&apos;est
            pas un problème de rôle, et il n&apos;y a pas d&apos;accès à demander.
            {origine && <> L&apos;exigence vient de {origine}.</>}
          </p>
        ) : (
          <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Le Control Center administre toute la plateforme — tous les comptes, toutes les
            entreprises, tout l&apos;argent. Un mot de passe volé ne doit pas suffire à y entrer.
            Poser une application d&apos;authentification prend une minute.
          </p>
        )}

        {mfa.currentLevel === null && mfa.blocking && (
          <div className="mt-5 rounded-[var(--radius-card)] border border-info/35 bg-info-wash px-4 py-2.5">
            <p className="text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              Le niveau de votre session est <em>inconnu</em> — ni la base ni le serveur
              d&apos;authentification n&apos;ont su le dire. Cette page s&apos;affiche aussi dans
              ce cas, volontairement : sous exigence, une absence de réponse ferme, elle
              n&apos;ouvre pas.
            </p>
          </div>
        )}

        <div className="mt-7 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <EnrolementTotp satisfait={mfa.satisfied} />
        </div>

        {!mfa.blocking && (
          <p className="mt-6">
            <Link
              href="/parametres"
              className="text-[var(--text-body)] font-medium text-accent transition-colors hover:text-accent-hover"
            >
              ← Retour aux paramètres
            </Link>
          </p>
        )}

        {mfa.blocking && (
          <div className="mt-7 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="eyebrow">Si l&apos;enrôlement ne fonctionne pas</p>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              L&apos;enrôlement TOTP peut être désactivé au niveau du projet Supabase
              (Authentication → Multi-Factor) ; aucune requête SQL ne permet de le savoir, seul un
              essai réel le révèle. Dans ce cas, la sortie de secours est de poser{" "}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                ADMIN_MFA_POLICY=off
              </code>{" "}
              dans l&apos;environnement du déploiement, puis de redéployer : cette valeur lève
              l&apos;exigence quoi que dise la base. C&apos;est la seule raison pour laquelle
              cette variable existe encore.
            </p>
          </div>
        )}

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
