"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * ==================================================================
 * LA PORTE D'ENTRÉE DU CONTROL CENTER
 * ==================================================================
 *
 * Elle ressemble volontairement peu à celle d'Oasis Care Pro. Pas de
 * promesse produit, pas de logo en couleur, pas de « Pilotez votre
 * entreprise » : personne n'arrive ici par hasard, et cette page n'a
 * rien à vendre. Elle dit où l'on est, elle demande une identité, elle
 * s'arrête là.
 *
 * ------------------------------------------------------------------
 * TROIS CHOSES QU'ELLE NE FAIT PAS, ET POURQUOI
 * ------------------------------------------------------------------
 * 1. Elle ne dit JAMAIS si l'adresse saisie appartient à un
 *    administrateur. Le lien de connexion part de la même façon pour
 *    tout le monde ; le tri se fait après, côté serveur, contre
 *    `platform_admins`. Répondre « cette adresse n'est pas
 *    administratrice » offrirait à qui veut la liste de l'équipe qui
 *    exploite la plateforme, une adresse à la fois.
 *
 * 2. Elle ne propose pas de mot de passe. L'écosystème Oasis Care n'en
 *    a jamais créé : les comptes existants se connectent par Apple,
 *    Google ou lien magique (`auth.identities.provider` → apple, email,
 *    google). Un champ « mot de passe » demanderait quelque chose que
 *    personne n'a.
 *
 * 2 bis. Elle ne propose pas Apple non plus — voir le commentaire de
 *    `signInWithProvider`. Un administrateur doit être identifiable par
 *    son adresse ; le relais privé d'Apple rend cela impossible.
 *
 * 3. Elle ne transporte pas de paramètre `next`. Le Control Center a
 *    une seule porte et une seule destination, la racine. Une
 *    redirection paramétrée serait une surface de redirection ouverte
 *    pour rien.
 *
 * ------------------------------------------------------------------
 * LE MÊME COMPTE QUE PARTOUT — ET CE QUE ÇA N'IMPLIQUE PAS
 * ------------------------------------------------------------------
 * C'est le même projet Supabase que l'app iPhone et qu'Oasis Care Pro,
 * donc le même compte. Se connecter ici ne donne RIEN de plus : la
 * session obtenue est celle d'un utilisateur ordinaire, et c'est
 * `platform_admins` — une table sans aucune politique d'écriture — qui
 * décide de la suite. Spec p.32 : « Ne pas considérer simplement
 * organization owner comme admin Oasis Care. »
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  // Le client Supabase est construit AU MOMENT DU CLIC, pas au rendu.
  //
  // Ce n'est pas une micro-optimisation : `createBrowserClient` lève si
  // l'URL ou la clé publishable manquent, et cette page est la seule du
  // Control Center que Next peut pré-rendre (tout le reste lit des
  // cookies). Le construire pendant le rendu faisait donc échouer
  // `next build` dès que l'environnement de compilation n'avait pas les
  // variables — c'est-à-dire sur toute chaîne de déploiement qui les
  // injecte à l'exécution, ce qui est le cas normal.
  //
  // Au clic, en revanche, on est dans le navigateur, les variables
  // publiques ont été intégrées au bundle, et une valeur manquante
  // devient un message d'erreur affiché plutôt qu'une page blanche.
  function client() {
    return createClient();
  }

  function callbackUrl() {
    return new URL("/auth/callback", window.location.origin).toString();
  }

  async function signInWithEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus("sending");
    const { error } = await client().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl(),
        // Aucune création de compte depuis cette page. Un
        // administrateur de plateforme est nécessairement un compte qui
        // existe déjà — c'est un collègue, pas un visiteur. Sans ce
        // faux, saisir n'importe quelle adresse créerait un compte
        // Oasis Care de plus dans la vraie base de production.
        shouldCreateUser: false,
      },
    });
    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  /**
   * Google et lien magique. PAS Apple, et ce n'est pas un oubli.
   *
   * « Se connecter avec Apple » impose à l'éditeur de proposer « Masquer
   * mon adresse e-mail », qui délivre une adresse de relais du type
   * f5d8z7b5jt@privaterelay.appleid.com. C'est très bien pour un
   * particulier qui s'inscrit sur l'iPhone — il y en a déjà un dans
   * cette base — et inutilisable pour une console d'administration :
   *   • on ne reconnaît pas un collègue derrière une adresse aléatoire ;
   *   • `platform_admins` se peuple à la main, en désignant une adresse
   *     qu'on doit pouvoir écrire de mémoire ;
   *   • et le jour où quelqu'un quitte l'équipe, on cherche qui révoquer.
   *
   * Le compte reste le même partout : quelqu'un qui s'est créé un compte
   * par Apple sur l'iPhone se connecte ici par lien magique, sur la même
   * adresse réelle, et retrouve la même session.
   */
  async function signInWithProvider(provider: "google") {
    setError(null);
    const { error } = await client().auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl() },
    });
    if (error) setError(error.message);
  }

  const providerButton =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-4 py-2.5 text-[var(--text-body)] font-medium text-ink transition-colors hover:border-ink-faint disabled:opacity-60";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-10">
          <p className="wordmark text-[12px] text-ink-soft">Oasis Care</p>
          <h1 className="wordmark mt-1.5 text-[length:var(--text-page)] text-accent">
            Control Center
          </h1>
          <p className="mt-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Administration de la plateforme. Réservé à l&apos;équipe Oasis Care.
          </p>
        </header>

        {status === "sent" ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="text-[length:var(--text-card)] font-medium">Lien envoyé, s&apos;il y a lieu.</p>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Si un compte Oasis Care existe pour{" "}
              <span className="font-medium text-ink">{email}</span>, un lien de connexion vient
              d&apos;y être envoyé. Vous pouvez fermer cet onglet.
            </p>
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
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => signInWithProvider("google")}
                className={providerButton}
              >
                Continuer avec Google
              </button>
            </div>

            <div className="my-5 flex items-center gap-3 text-[var(--text-secondary)] text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              ou
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={signInWithEmail} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Adresse e-mail
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="vous@oasiscare.com"
                  className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-2.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full rounded-[var(--radius-control)] bg-accent px-4 py-2.5 text-[var(--text-body)] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {status === "sending" ? "Envoi…" : "Recevoir un lien de connexion"}
              </button>
            </form>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-critical-wash px-3 py-2 text-[var(--text-body)] text-critical">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
