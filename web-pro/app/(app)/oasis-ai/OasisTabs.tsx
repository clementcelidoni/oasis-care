import { Tabs } from "@/components/ui";

/**
 * §11V UI (spec p. 39) : « Cliquer ouvre un grand workspace. Sections :
 * Daily · Decisions · Ask Oasis · Agents · Automations · History. »
 *
 * Des onglets qui NAVIGUENT, pas un état React : chaque section est une
 * URL. On passe du briefing du matin au centre de décision dix fois de
 * suite, et un lien vers « les automatisations » doit pouvoir se coller
 * dans un message.
 *
 * Le compte des décisions ouvertes est porté par l'onglet parce que
 * c'est la seule des six sections qui accumule du travail non fait.
 * Les cinq autres décrivent un état ; celle-là attend une réponse.
 */
export function OasisTabs({
  current,
  openDecisions,
}: {
  current: string;
  openDecisions?: number;
}) {
  return (
    <Tabs
      current={current}
      items={[
        { label: "Daily", href: "/oasis-ai" },
        {
          label: "Décisions",
          href: "/oasis-ai/decisions",
          // `undefined` et non `0` : un zéro à côté d'un onglet se lit
          // comme un compteur cassé plutôt que comme une bonne nouvelle.
          count: openDecisions && openDecisions > 0 ? openDecisions : undefined,
        },
        { label: "Demander à Oasis", href: "/oasis-ai/demander" },
        { label: "Agents", href: "/oasis-ai/agents" },
        { label: "Automatisations", href: "/oasis-ai/automatisations" },
        { label: "Historique", href: "/oasis-ai/historique" },
      ]}
    />
  );
}
