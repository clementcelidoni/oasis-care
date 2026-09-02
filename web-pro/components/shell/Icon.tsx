import type { SVGProps } from "react";

/**
 * §1 : « icônes ». Le jeu complet, en un fichier.
 *
 * Pas de bibliothèque d'icônes : elles pèsent des centaines de
 * kilo-octets pour la trentaine de symboles qu'on utilise, et §48
 * demande de ne pas ralentir le produit avec la refonte. Celles-ci sont
 * dessinées sur la même grille de 24, au même trait, en
 * `currentColor` — donc elles suivent la couleur du texte et
 * fonctionnent dans la barre latérale comme dans un bouton d'accent.
 *
 * Elles sont DÉCORATIVES : chaque icône double un libellé écrit à
 * côté, jamais elle ne le remplace. D'où `aria-hidden` systématique —
 * un lecteur d'écran qui annoncerait « image, graphique, Clients »
 * ferait perdre du temps.
 */

export type IconName =
  | "dashboard" | "clients" | "prospects" | "projects" | "twin" | "quote"
  | "planning" | "interventions" | "nursery" | "production" | "lots"
  | "stock" | "locations" | "orders" | "invoice" | "purchase" | "supplier"
  | "equipment" | "document" | "analytics" | "ai" | "company" | "team"
  | "subscription" | "settings" | "logout" | "search" | "bell" | "help"
  | "chevron" | "plus" | "check" | "close" | "collapse" | "expand" | "portal";

const PATHS: Record<IconName, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  clients: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11.5 9v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75",
  prospects: "M3 20V10m6 10V4m6 16v-7m6 7V7",
  projects: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0 9 4.5m0 0 9-4.5m-9 4.5V21",
  twin: "M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  quote: "M6 3h8l5 5v13H6V3Zm8 0v5h5M9 13h6M9 17h4",
  planning: "M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4",
  interventions: "M14 6.5a3.5 3.5 0 0 1 4.9 3.9l-9 9-3.4.5.5-3.4 9-9Zm-9.5 14h6",
  nursery: "M12 21v-7m0 0c0-3.9 3-7 7-7 0 3.9-3.1 7-7 7Zm0 0C12 10.1 9 7 5 7c0 3.9 3.1 7 7 7Z",
  production: "M3 20h18M6 20V9l5 3V9l5 3V4l3 2v14",
  lots: "M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Zm0 0 8 4.5 8-4.5M12 13v7",
  stock: "M4 7h16v13H4V7Zm-1-3h18v3H3V4Zm6 8h6",
  locations: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
  orders: "M6 4h12l1.5 16H4.5L6 4Zm3 4a3 3 0 0 0 6 0",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 6h6M9 13h6",
  purchase: "M3 5h2l2.2 10.5h10L19 8H7M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  supplier: "M3 8h11v8H3V8Zm11 3h4l3 3v2h-7v-5ZM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  equipment: "M10.5 6.5a4 4 0 0 1 5.4 5.2l4.4 4.4-2.2 2.2-4.4-4.4a4 4 0 0 1-5.2-5.4l2.5 2.5 1.5-1.5-2-3Z",
  document: "M7 3h7l4 4v14H7V3Zm7 0v4h4M10 12h5m-5 4h5",
  analytics: "M4 20V6m5 14v-8m5 8V4m5 16v-6",
  ai: "M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5ZM18.5 16l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z",
  company: "M4 21V6l7-3v18M4 21h16M11 21V9l6 2.5V21M7 9h1m-1 3h1m-1 3h1m6 0h1m-1 3h1",
  team: "M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20v-1a4.5 4.5 0 0 1 4.5-4.5h3A4.5 4.5 0 0 1 14 19v1m3-6h1a4 4 0 0 1 4 4v2",
  subscription: "M3 7h18v11H3V7Zm0 4h18M7 15h3",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.4-2.1.9 1.5-2 3.5-1.7-.5a6.9 6.9 0 0 1-1.6.9l-.4 1.7h-4l-.4-1.7a6.9 6.9 0 0 1-1.6-.9l-1.7.5-2-3.5.9-1.5a7 7 0 0 1 0-1.8l-.9-1.5 2-3.5 1.7.5a6.9 6.9 0 0 1 1.6-.9L11.6 5h4l.4 1.7c.6.2 1.1.5 1.6.9l1.7-.5 2 3.5-.9 1.5a7 7 0 0 1 0 1.8Z",
  logout: "M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2M11 12h10m0 0-3.5-3.5M21 12l-3.5 3.5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21",
  bell: "M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Zm-4.3 10a2 2 0 0 1-3.4 0",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.2-11a2.3 2.3 0 1 1 3 2.2c-.5.2-.8.7-.8 1.3v.5m0 3h.01",
  chevron: "m9 6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  check: "m5 13 4.5 4.5L19 7",
  close: "M6 6l12 12M18 6 6 18",
  collapse: "M15 6l-6 6 6 6M4 4v16",
  expand: "m9 6 6 6-6 6M20 4v16",
  portal: "M3 11.5 12 4l9 7.5M6 10v10h12V10M10 20v-6h4v6",
};

export function Icon({
  name,
  className = "h-[18px] w-[18px]",
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
