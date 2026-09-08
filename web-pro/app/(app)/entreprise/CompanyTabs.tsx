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
        // §EMAILS — SANS CET ONGLET, L'ÉCRAN N'EXISTE POUR PERSONNE.
        // C'est lui qui tient les trois promesses de la migration 0084 :
        // voir ses rebonds, lire le motif d'une suspension, et pouvoir
        // consentir aux communications commerciales.
        { label: "Courrier", href: "/entreprise/courrier" },
        { label: "Abonnement", href: "/entreprise/abonnement" },
      ]}
    />
  );
}
