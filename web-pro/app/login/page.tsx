"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * §19 PAGE LOGIN — « Refaire page login. »
 *
 *     [ Logo Oasis Care ]
 *     OASIS CARE PRO
 *     « Pilotez votre entreprise, vos jardins et votre pépinière depuis
 *       un seul endroit. »
 *     [Continuer avec Apple] [Continuer avec Google]
 *     Email [____] [Continuer]
 *     « Déjà utilisateur Oasis Care ? Utilisez le même compte. »
 *
 * C'est la seule page du produit que voient des gens qui ne le
 * connaissent pas encore. Elle dit donc CE QUE FAIT le logiciel avant de
 * demander quoi que ce soit — un formulaire nu sur fond blanc n'apprend
 * rien à personne, et la promesse est ce qui distingue « me connecter »
 * de « m'inscrire ».
 *
 * §"AUTH WEB" — même Supabase Auth que l'application iOS, donc le même
 * compte des deux côtés. Les trois méthodes sont celles que
 * l'application propose déjà : Apple, Google, e-mail.
 *
 * L'e-mail est un LIEN DE CONNEXION, pas un mot de passe : l'application
 * iOS n'en a jamais créé, et un champ « mot de passe » demanderait aux
 * gens quelque chose qu'ils n'ont pas.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  /**
   * Là où on retournera après la connexion.
   *
   * `proxy.ts` pose déjà `?next=` en renvoyant ici, et `/auth/callback`
   * sait le suivre — mais personne ne le lui transmettait. Un client qui
   * ouvrait son lien d'invitation atterrissait donc sur l'accueil,
   * invitation perdue.
   *
   * Lu dans le gestionnaire plutôt qu'avec `useSearchParams` : le second
   * forcerait toute la page en rendu dynamique pour une valeur dont on
   * n'a besoin qu'au clic.
   */
  function callbackUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    const url = new URL("/auth/callback", window.location.origin);
    // Un chemin de ce site, et rien d'autre : une URL absolue ferait de
    // la connexion une redirection ouverte vers n'importe où.
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      url.searchParams.set("next", next);
    }
    return url.toString();
  }

  async function signInWithEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  async function signInWithProvider(provider: "google" | "apple") {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl() },
    });
    if (error) setError(error.message);
  }

  // Les trois boutons de la page partagent une seule définition : trois
  // variantes légèrement différentes du même bouton, c'est exactement ce
  // que le système de design (§35) sert à éviter.
  const providerButton =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-4 py-3 text-[var(--text-body)] font-medium transition-colors hover:bg-canvas disabled:opacity-60";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-10 text-center">
          <Image
            src="/oasis-logo.png"
            alt=""
            width={64}
            height={64}
            priority
            className="mx-auto rounded-[var(--radius-control)]"
          />
          <h1 className="mt-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
            Oasis Care Pro
          </h1>
          <p className="mx-auto mt-4 max-w-xs text-[length:var(--text-card)] leading-snug text-ink-soft text-balance">
            Pilotez votre entreprise, vos jardins et votre pépinière depuis un
            seul endroit.
          </p>
        </header>

        {status === "sent" ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <p className="text-[length:var(--text-card)] font-medium">Lien envoyé.</p>
            <p className="mt-2 text-[var(--text-body)] text-ink-soft">
              Ouvrez le message envoyé à{" "}
              <span className="font-medium text-ink">{email}</span> pour vous
              connecter. Vous pouvez fermer cet onglet.
            </p>
            {/* Une faute de frappe dans l'adresse laisse sinon devant un
                écran qui attend un message qui n'arrivera jamais. */}
            <button
              type="button"
              onClick={() => setStatus("idle")}
              className="mt-4 text-[var(--text-secondary)] font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Utiliser une autre adresse
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => signInWithProvider("apple")}
                className={providerButton}
              >
                Continuer avec Apple
              </button>
              <button
                type="button"
                onClick={() => signInWithProvider("google")}
                className={providerButton}
              >
                Continuer avec Google
              </button>
            </div>

            <div className="my-6 flex items-center gap-3 text-[var(--text-secondary)] text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              ou
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={signInWithEmail} className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Adresse e-mail
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@entreprise.fr"
                  className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-3 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full rounded-[var(--radius-control)] bg-accent px-4 py-3 text-[var(--text-body)] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {status === "sending" ? "Envoi…" : "Continuer"}
              </button>
              {/* Ce que le bouton « Continuer » ne dit pas tout seul : il
                  n'y a pas de mot de passe à retrouver, un message va
                  partir. */}
              <p className="text-[var(--text-secondary)] text-ink-faint">
                Nous vous envoyons un lien de connexion. Aucun mot de passe à
                retenir.
              </p>
            </form>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-critical-wash px-3.5 py-2.5 text-[var(--text-body)] text-critical">
            {error}
          </p>
        )}

        {/* §19 — la ligne qui évite le doublon de compte. Quelqu'un qui
            utilise déjà l'application iPhone n'a rien à créer ici, et
            créer un second compte lui ferait perdre ses jardins. */}
        <p className="mt-8 text-center text-[var(--text-secondary)] text-ink-soft">
          Déjà utilisateur Oasis Care ? Utilisez le même compte.
        </p>
      </div>
    </main>
  );
}
