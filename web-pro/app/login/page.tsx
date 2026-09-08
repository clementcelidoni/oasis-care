import { messageRetourDeLien } from "./parcours.ts";
import Formulaire from "./Formulaire.tsx";

/**
 * ══════════════════════════════════════════════════════════════════
 * LA PAGE DE CONNEXION — UNE COQUILLE DE SERVEUR, ET RIEN D'AUTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Tout l'écran vit dans `Formulaire.tsx`, côté navigateur : les trois
 * appels d'authentification doivent en partir, sans quoi la session
 * obtenue serait perdue en silence (`lib/supabase/server.ts` avale
 * l'exception de `setAll()`).
 *
 * ------------------------------------------------------------------
 * CE QUE CETTE COQUILLE FAIT, ET POURQUOI ELLE EXISTE
 * ------------------------------------------------------------------
 * UNE SEULE CHOSE : lire `?error=`.
 *
 * `/auth/callback` redirige ici avec ce paramètre quand un lien de
 * courriel échoue — lien coupé par une messagerie, lien déjà consommé,
 * lien de plus d'une heure. Ces messages, soigneusement rédigés par la
 * route, TOMBAIENT JUSQU'ICI DANS LE VIDE : la page ne lisait pas le
 * paramètre, et l'utilisateur revenait sur un écran de connexion
 * vierge, sans la moindre idée de ce qui venait d'échouer. Il en
 * concluait, raisonnablement, que « le lien ne marche pas ».
 *
 * Ce paramètre est posé par le SERVEUR, dans une redirection : le
 * serveur le connaît donc au moment de rendre la page. Le lire ici et
 * le passer en propriété le rend disponible dès le premier rendu, sans
 * effet de bord, sans clignotement, et sans la cascade de rendus qu'un
 * `useEffect` qui pose un état déclenche.
 *
 * ------------------------------------------------------------------
 * CE QUE ÇA COÛTE, ET POURQUOI C'EST LE BON PRIX
 * ------------------------------------------------------------------
 * Lire `searchParams` rend cette route dynamique : elle n'est plus
 * pré-calculée à la compilation, elle est rendue à chaque demande.
 * Pour une page de connexion — visitée une fois par personne et par
 * semaine, sans aucune donnée à agréger — c'est indolore. Et c'est le
 * prix d'un message qui s'affiche là où il n'y avait rien.
 *
 * `?next=` n'est PAS lu ici : le formulaire en a besoin au clic, pas au
 * rendu, et il le relit lui-même dans la barre d'adresse.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const parametres = await searchParams;
  const motif = parametres.error;

  // Un paramètre répété (`?error=a&error=b`) arrive sous forme de
  // tableau. On ne cherche pas à en faire quelque chose d'intelligent :
  // ce n'est pas un cas légitime, et une phrase générique vaut mieux
  // qu'un affichage bricolé.
  const erreurDeLien =
    typeof motif === "string" && motif !== "" ? messageRetourDeLien(motif) : null;

  return <Formulaire erreurDeLien={erreurDeLien} />;
}
