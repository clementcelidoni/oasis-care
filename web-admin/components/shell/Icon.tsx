import type { SVGProps } from "react";

/**
 * Le jeu d'icônes du Control Center, en un fichier.
 *
 * Pas de bibliothèque tierce : elles pèsent des centaines de
 * kilo-octets pour la douzaine de symboles utilisés ici. Celles-ci sont
 * dessinées sur la même grille de 24, au même trait, en `currentColor`
 * — donc elles suivent la couleur du texte et fonctionnent aussi bien
 * dans la barre latérale que dans un bouton d'accent.
 *
 * Elles sont DÉCORATIVES : chaque icône double un libellé écrit à côté,
 * jamais elle ne le remplace. D'où `aria-hidden` systématique — un
 * lecteur d'écran qui annoncerait « image, graphique, Utilisateurs »
 * ferait perdre du temps.
 */

export type IconName =
  | "dashboard"
  | "pulse"
  | "users"
  | "phone"
  | "briefcase"
  | "building"
  | "search"
  | "shield"
  | "logout"
  | "chevron"
  | "check"
  | "close"
  | "warning";

const PATHS: Record<IconName, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  pulse: "M3 12h3.5l2-6 3.5 12 2.5-8 1.8 4h4.7",
  users:
    "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11.5 9v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75",
  phone: "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5Zm2.5 15.5h3",
  briefcase: "M3 8h18v11H3V8Zm6 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18",
  building:
    "M4 21V6l7-3v18M4 21h16M11 21V9l6 2.5V21M7 9h1m-1 3h1m-1 3h1m6 0h1m-1 3h1",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21",
  shield: "M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z",
  logout:
    "M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2M11 12h10m0 0-3.5-3.5M21 12l-3.5 3.5",
  chevron: "m9 6 6 6-6 6",
  check: "m5 13 4.5 4.5L19 7",
  close: "M6 6l12 12M18 6 6 18",
  warning: "M12 3.5 22 20H2L12 3.5Zm0 6v5m0 3h.01",
};

export function Icon({
  name,
  className = "h-[17px] w-[17px]",
  ...rest
}: { name: IconName; className?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
