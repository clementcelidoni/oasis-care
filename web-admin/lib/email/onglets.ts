import type { AdminIdentity } from "@/lib/auth/guard";

import { CLES_COURRIER } from "./permissions.ts";

/**
 * Les quatre écrans du courrier sortant, filtrés par ce que le rôle
 * peut ouvrir.
 *
 * LE FILTRE N'EST PAS UNE SÉCURITÉ — chaque page rappelle sa garde, et
 * chaque fonction de 0084 recommence le contrôle en SQL. Il évite
 * seulement de proposer une porte fermée : la séparation des pouvoirs
 * de 0084 fait qu'aucun rôle sauf le super-administrateur ne voit les
 * quatre onglets, et c'est voulu. Le responsable produit compose les
 * annonces sans pouvoir suspendre une entreprise ; le responsable
 * sécurité fait l'inverse.
 *
 * « Messages de service » n'a pas de permission : c'est un écran qui
 * EXPLIQUE ce que le produit ne sait pas encore envoyer. Le fermer à
 * quelqu'un reviendrait à lui cacher une absence, ce qui n'a pas de
 * sens.
 */
export function ongletsCourrier(admin: AdminIdentity): { label: string; href: string }[] {
  const portees = new Set(admin.permissions);
  const onglets: { label: string; href: string }[] = [];

  if (portees.has(CLES_COURRIER.campagnesLire)) {
    onglets.push({ label: "Annonces commerciales", href: "/emails" });
  }
  onglets.push({ label: "Messages de service", href: "/emails/service" });
  if (portees.has(CLES_COURRIER.journal)) {
    onglets.push({ label: "Délivrabilité", href: "/emails/delivrabilite" });
  }
  if (portees.has(CLES_COURRIER.suppressionsLire)) {
    onglets.push({ label: "Liste de suppression", href: "/emails/suppressions" });
  }

  return onglets;
}
