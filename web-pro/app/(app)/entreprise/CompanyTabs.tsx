import { Tabs } from "@/components/ui";

/**
 * §11, §14, §15, §45 — les quatre écrans de l'entreprise sont un seul
 * sujet, vu sous quatre angles. Des onglets plutôt que quatre entrées
 * indépendantes dans le menu : on passe de « ma société » à « mon
 * équipe » vingt fois de suite quand on installe le produit.
 */
export function CompanyTabs({ current }: { current: string }) {
  return (
    <Tabs
      current={current}
      items={[
        { label: "Société", href: "/entreprise" },
        { label: "Documents", href: "/entreprise/documents" },
        { label: "Équipe", href: "/entreprise/equipe" },
        { label: "Abonnement", href: "/entreprise/abonnement" },
      ]}
    />
  );
}
