import { Tabs } from "@/components/ui";

/**
 * Les trois onglets de « Paramètres », déclarés une fois.
 *
 * Ils sont les MÊMES pour tous les rôles, et c'est délibéré. La
 * tentation serait de masquer « Sécurité de l'équipe » à qui ne porte
 * pas `platform.security.write` — mais la politique de second facteur
 * s'applique à TOUT LE MONDE, et quelqu'un qui vient d'être renvoyé vers
 * l'écran d'enrôlement a besoin de lire ce qui la lui impose et depuis
 * quand. La page se contente donc de retirer le FORMULAIRE ; elle garde
 * la lecture, que la politique de la table autorise à tout
 * administrateur.
 *
 * « Rôles et permissions » suit la même logique : savoir ce que sa
 * propre casquette ouvre n'est pas un privilège.
 */
export function OngletsParametres({ courant }: { courant: string }) {
  return (
    <Tabs
      current={courant}
      items={[
        { label: "Mon compte", href: "/parametres" },
        { label: "Sécurité de l'équipe", href: "/parametres/securite" },
        { label: "Rôles et permissions", href: "/parametres/roles" },
      ]}
    />
  );
}
