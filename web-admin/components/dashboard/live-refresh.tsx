"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * ==================================================================
 * LE RAFRAÎCHISSEMENT DE L'ÉCRAN D'ACTIVITÉ
 * ==================================================================
 *
 * Le SEUL composant client du tableau de bord, et il ne parle pas à
 * Supabase : il demande à Next de rejouer le composant serveur
 * (`router.refresh()`), qui refera l'appel à `admin_live_activity()`
 * avec la session de l'administrateur. Aucun jeton, aucune clé, aucune
 * requête ne descend dans le navigateur — la règle « les opérations
 * privilégiées passent par le backend » (spec p.31-32) tient ici sans
 * qu'on ait à y penser.
 *
 * POURQUOI UN INTERRUPTEUR, ET PAS UN RAFRAÎCHISSEMENT IMPOSÉ. Un
 * écran qui se recharge tout seul pendant qu'on lit un chiffre le fait
 * bouger sous les yeux, et sur cet écran-là on lit souvent en
 * expliquant à quelqu'un d'autre. L'automatisme est allumé par défaut
 * — c'est un écran d'activité, il doit vivre — mais il s'éteint d'un
 * clic.
 *
 * L'HEURE N'EST PAS CALCULÉE ICI. La page affiche l'horodatage rendu
 * par la base (`until_at`), pas une horloge du navigateur : les deux
 * ne coïncideraient pas, et c'est la borne de la FENÊTRE MESURÉE qui
 * intéresse le lecteur, pas l'heure qu'il est.
 */
export function LiveRefresh({ intervalSeconds = 60 }: { intervalSeconds?: number }) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [auto, intervalSeconds, router, startTransition]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-3 py-1.5 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${pending ? "bg-warning" : "bg-positive"}`}
        />
        {pending ? "Actualisation…" : "Actualiser"}
      </button>

      <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--text-secondary)] text-ink-soft">
        <input
          type="checkbox"
          checked={auto}
          onChange={(event) => setAuto(event.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        toutes les {intervalSeconds} s
      </label>
    </div>
  );
}
