/**
 * §INSCRIPTION — L'AIDE-MÉMOIRE DU PAIEMENT, CÔTÉ SERVEUR.
 *
 * La FORME du cookie, sa durée et sa lecture vivent dans
 * `paiement-partage.ts`, qui est pur et testé. Ce fichier-ci ne fait
 * que poser, relire et effacer — c'est-à-dire tout ce qui demande
 * `next/headers`, et rien d'autre.
 *
 * On y trouvera aussi le POURQUOI de ce cookie : il sert à afficher, il
 * n'ouvre aucun droit, et il survit à un abandon de paiement.
 */

import { cookies } from "next/headers";

import {
  COOKIE_PAIEMENT,
  DUREE_COOKIE_PAIEMENT,
  lirePaiementEnCours,
  type PaiementEnCours,
} from "./paiement-partage.ts";

export { COOKIE_PAIEMENT, DUREE_COOKIE_PAIEMENT, lirePaiementEnCours };
export type { PaiementEnCours };

/**
 * À appeler DANS la Server Action qui ouvre la caisse, juste avant de
 * rendre l'adresse du prestataire.
 *
 * Silencieuse en cas d'échec : un aide-mémoire d'écran ne doit jamais
 * faire échouer le paiement qu'il accompagne.
 */
export async function poserPaiementEnCours(paiement: PaiementEnCours): Promise<void> {
  try {
    const store = await cookies();
    store.set(COOKIE_PAIEMENT, JSON.stringify(paiement), {
      path: "/",
      maxAge: DUREE_COOKIE_PAIEMENT,
      // Aucun composant client n'en a besoin, et ce qui n'est pas
      // lisible par un script n'est pas volable par un script.
      httpOnly: true,
      // `lax` et non `strict` : le retour du prestataire est une
      // navigation de premier niveau venue d'un AUTRE site. En
      // `strict`, le cookie ne serait pas renvoyé, et l'écran de
      // confirmation serait muet exactement au moment où il doit
      // parler.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // Un Server Component ne peut pas écrire de cookie. Attendu :
    // seules les Server Actions appellent cette fonction.
  }
}

export async function relirePaiementEnCours(): Promise<PaiementEnCours | null> {
  const store = await cookies();
  return lirePaiementEnCours(store.get(COOKIE_PAIEMENT)?.value);
}

/**
 * L'oubli, à la sortie de l'écran de confirmation.
 *
 * On efface quand la personne a LU la confirmation et s'en va, pas
 * quand la ligne d'abonnement apparaît : elle peut revenir sur cet
 * écran, et le cookie est ce qui lui permet d'y retrouver ce qu'elle a
 * demandé tant que la base ne le sait pas encore.
 */
export async function oublierPaiementEnCours(): Promise<void> {
  try {
    const store = await cookies();
    store.delete(COOKIE_PAIEMENT);
  } catch {
    // Idem : hors Server Action, on ne peut pas écrire de cookie.
  }
}
