import { messageRetourDeLien } from "./parcours.ts";
import Formulaire from "./Formulaire.tsx";

/**
 * ══════════════════════════════════════════════════════════════════
 * LA CONNEXION AU CONTROL CENTER — UNE COQUILLE DE SERVEUR
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
 * courriel échoue. Ces messages tombaient jusqu'ici dans le vide — la
 * page ne lisait pas le paramètre, et l'administrateur revenait sur un
 * écran vierge qui ne disait rien de ce qui venait d'échouer.
 *
 * Le paramètre est posé par le SERVEUR, dans une redirection : le
 * serveur le connaît donc au moment de rendre la page. Le lire ici et
 * le passer en propriété le rend disponible dès le premier rendu, sans
 * effet de bord et sans la cascade de rendus qu'un `useEffect` qui pose
 * un état déclenche.
 *
 * ------------------------------------------------------------------
 * CE QUE ÇA CHANGE : LA PAGE N'EST PLUS PRÉ-CALCULÉE
 * ------------------------------------------------------------------
 * Lire `searchParams` rend la route dynamique. C'était jusqu'ici la
 * seule page pré-calculée du Control Center ; elle rejoint les autres,
 * et c'est sans conséquence — un administrateur se connecte une fois
 * par semaine, et cette page n'agrège aucune donnée.
 *
 * Au passage, cela LÈVE la vieille contrainte qui obligeait à
 * construire le client Supabase au clic pour ne pas casser
 * `next build` : plus rien n'est exécuté à la compilation. La
 * construction paresseuse reste en place tout de même, parce que la
 * raison a changé sans disparaître — voir le commentaire de `client()`
 * dans `Formulaire.tsx`.
 *
 * ------------------------------------------------------------------
 * CE QU'ELLE NE FAIT TOUJOURS PAS
 * ------------------------------------------------------------------
 * Elle ne vérifie RIEN. Pas d'appel à `requireAdmin()`, pas de lecture
 * de `platform_admins` : refuser ici, avec un message, dirait à qui
 * essaie si l'adresse saisie appartient à un administrateur. Le tri se
 * fait après la connexion, et il répond 404.
 *
 * Et elle ne lit aucun `next` : une seule porte, une seule destination.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const parametres = await searchParams;
  const motif = parametres.error;

  // Un paramètre répété (`?error=a&error=b`) arrive sous forme de
  // tableau. Ce n'est pas un cas légitime : une phrase générique vaut
  // mieux qu'un affichage bricolé.
  const erreurDeLien =
    typeof motif === "string" && motif !== "" ? messageRetourDeLien(motif) : null;

  return <Formulaire erreurDeLien={erreurDeLien} />;
}
