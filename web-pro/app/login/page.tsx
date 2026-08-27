"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * §"AUTH WEB" — same Supabase Auth as the iOS app, so the same account
 * works on both. Supports the methods the app already offers: Apple,
 * Google and e-mail.
 *
 * E-mail here is a magic link rather than a password field: the iOS app
 * never created passwords, so offering a password box would ask people
 * for something they do not have.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  async function signInWithEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
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
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <div className="mb-6 h-10 w-10 rounded-lg bg-accent" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Oasis Care Pro</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Connectez-vous avec votre compte Oasis Care habituel.
          </p>
        </div>

        {status === "sent" ? (
          <div className="rounded-lg border border-line bg-accent-wash p-4 text-sm">
            <p className="font-medium">Lien envoyé.</p>
            <p className="mt-1 text-ink-soft">
              Ouvrez le message envoyé à <span className="font-medium">{email}</span> pour
              vous connecter. Vous pouvez fermer cet onglet.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => signInWithProvider("apple")}
                className="w-full rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
              >
                Continuer avec Apple
              </button>
              <button
                type="button"
                onClick={() => signInWithProvider("google")}
                className="w-full rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
              >
                Continuer avec Google
              </button>
            </div>

            <div className="my-6 flex items-center gap-3 text-xs text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              ou
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={signInWithEmail} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-soft">Adresse e-mail</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@entreprise.fr"
                  className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={status === "sending"}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {status === "sending" ? "Envoi…" : "Recevoir un lien de connexion"}
              </button>
            </form>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
