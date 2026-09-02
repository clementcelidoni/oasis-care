"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { FLASH_COOKIE, type Flash } from "@/lib/ui/flashShared";

/**
 * §34 TOASTS / FEEDBACK — la moitié visible.
 *
 * Le message arrive du serveur par un cookie ; ce composant l'affiche
 * et EFFACE le cookie tout de suite. Sans cet effacement, « Client
 * créé » reviendrait à chaque navigation pendant trente secondes.
 *
 * `role="status"` et `aria-live="polite"` : un lecteur d'écran annonce
 * la confirmation sans interrompre ce que la personne était en train de
 * lire. Une erreur, elle, passe en `alert` — §47 demande de tester avec
 * un lecteur d'écran, et une action échouée dont on n'est pas prévenu
 * est le pire des cas.
 */
const TONE = {
  success: {
    icon: "check" as const,
    shell: "border-positive/30 bg-positive-wash text-positive",
  },
  error: {
    icon: "close" as const,
    shell: "border-critical/30 bg-critical-wash text-critical",
  },
  info: {
    icon: "bell" as const,
    shell: "border-info/30 bg-info-wash text-info",
  },
};

/**
 * `key` remonte le composant à chaque nouveau message — voir la mise en
 * page. C'est ce qui permet à l'état initial d'être la vérité, sans
 * qu'un effet ait à le remettre à `true` : rappeler `setState` depuis le
 * corps d'un effet provoque un rendu en cascade, et React le signale.
 */
export function Toast({ flash }: { flash: Flash | null }) {
  const [visible, setVisible] = useState(Boolean(flash));

  useEffect(() => {
    if (!flash) return;
    // Effacer le cookie dès l'affichage : il a fait son travail.
    document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0; samesite=lax`;

    // Une erreur reste jusqu'à ce qu'on la ferme — elle demande souvent
    // de refaire quelque chose. Une confirmation s'efface toute seule.
    if (flash.tone === "error") return;
    const timer = setTimeout(() => setVisible(false), 4500);
    return () => clearTimeout(timer);
  }, [flash]);

  if (!flash || !visible) return null;
  const tone = TONE[flash.tone];

  return (
    <div
      role={flash.tone === "error" ? "alert" : "status"}
      aria-live={flash.tone === "error" ? "assertive" : "polite"}
      className="rise pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 print:hidden"
    >
      <div
        className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-[var(--radius-card)] border px-4 py-3 shadow-[var(--shadow-float)] ${tone.shell}`}
      >
        <Icon name={tone.icon} className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 text-[var(--text-body)]">{flash.message}</p>

        {flash.action && (
          <Link href={flash.action.href} className="shrink-0 font-medium underline">
            {flash.action.label}
          </Link>
        )}

        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Fermer"
          className="-mr-1 -mt-0.5 shrink-0 rounded px-1 opacity-60 transition-opacity hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
