"use client";

import { useEffect, useState } from "react";

import { phraseTempsRestant } from "./libelles.ts";

/**
 * ==================================================================
 * « Session expires in 18 min » — spec p.21
 * ==================================================================
 *
 * CE COMPOSANT N'EST PAS UNE SÉCURITÉ, ET LE DIRE UNE FOIS NE SUFFIT
 * PAS : c'est écrit ici, dans la bannière qui l'utilise, et dans le
 * commentaire de `support_session_record_access()` en SQL. Un compte à
 * rebours dans un navigateur ne ferme rien — il suffit de ne pas
 * rafraîchir la page, ou d'ouvrir les outils de développement. Ce qui
 * FERME, c'est le `if v_session.expires_at <= now() then raise` de la
 * fonction SQL, évalué à CHAQUE accès.
 *
 * Ce que ce composant apporte est donc autre chose, et c'est utile :
 * qu'un administrateur ne découvre pas l'expiration par un message
 * d'erreur au milieu d'un dépannage.
 *
 * ------------------------------------------------------------------
 * L'ÉCHÉANCE EST UN INSTANT, PAS UNE DURÉE
 * ------------------------------------------------------------------
 * On reçoit `expiresAt` (une date ISO) et non « il reste 1080
 * secondes ». Une durée décomptée par `setInterval` dérive : un onglet
 * mis en arrière-plan voit ses minuteries ralenties par le navigateur,
 * et la bannière annoncerait douze minutes restantes alors que la
 * session est close depuis six. Recalculer depuis l'horloge à chaque
 * tick ne dérive pas.
 *
 * ------------------------------------------------------------------
 * ET LE PREMIER RENDU EST CELUI DU SERVEUR
 * ------------------------------------------------------------------
 * `secondesInitiales` vient du serveur — de `support_session_mine()`,
 * qui calcule le reste en SQL. Le composant l'affiche tel quel au
 * premier rendu, puis passe à l'horloge locale. Sans cela, le rendu
 * serveur et le rendu client différeraient à la seconde près et React
 * signalerait une divergence d'hydratation à chaque chargement.
 */
export function CompteARebours({
  expiresAt,
  secondesInitiales,
}: {
  expiresAt: string;
  /** Le reste calculé EN SQL, pour que le premier rendu soit identique des deux côtés. */
  secondesInitiales: number;
}) {
  const [secondes, setSecondes] = useState(secondesInitiales);

  useEffect(() => {
    const fin = new Date(expiresAt).getTime();
    if (Number.isNaN(fin)) return;

    const recalculer = () => {
      setSecondes(Math.max(0, Math.floor((fin - Date.now()) / 1000)));
    };

    recalculer();
    const minuterie = window.setInterval(recalculer, 1000);
    return () => window.clearInterval(minuterie);
  }, [expiresAt]);

  return (
    <span className="tabular font-semibold" aria-live="off">
      {phraseTempsRestant(secondes)}
    </span>
  );
}
