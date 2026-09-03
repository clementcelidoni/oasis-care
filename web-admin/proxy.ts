import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * ==================================================================
 * LE FILET EXTÉRIEUR — et pourquoi il ferme au lieu d'ouvrir
 * ==================================================================
 *
 * `proxy.ts`, pas `middleware.ts` : la convention `middleware` est
 * dépréciée depuis Next.js 16 et renommée en `proxy`. Même
 * comportement, autre nom de fichier et d'export.
 *
 * CE FICHIER N'EST PAS LA COUCHE D'AUTORISATION. La documentation de
 * Next est explicite là-dessus, et la vraie porte du Control Center est
 * `requireAdmin()` dans `lib/auth/guard.ts`, doublée du `raise` que
 * chaque fonction de la migration 0075 exécute en SQL.
 *
 * ------------------------------------------------------------------
 * LA DIFFÉRENCE AVEC OASIS CARE PRO, QUI EST TOUT LE SUJET
 * ------------------------------------------------------------------
 * `web-pro/proxy.ts` écrit noir sur blanc : « Deliberately an OPTIMISTIC
 * check only […] it FAILS OPEN ». Ce choix est BON là-bas : la RLS
 * reprend la main derrière, donc laisser passer un doute ne montre
 * jamais une donnée, et déconnecter quelqu'un au moindre hoquet réseau
 * serait le pire des deux maux.
 *
 * Ici, la RLS ne reprend PAS la main : les lectures d'administration
 * traversent les organisations. Ce proxy ferme donc sur le doute. Le
 * coût — une reconnexion en cas de panne du serveur d'authentification
 * — se paie une fois, par six personnes, sur une console interne.
 *
 * C'est aussi la raison pour laquelle le Control Center est une
 * application SÉPARÉE et non un groupe de routes dans Oasis Care Pro :
 * un groupe de routes hériterait du proxy d'à côté, écrit en s'appuyant
 * sur un filet qui n'existe plus ici.
 *
 * ------------------------------------------------------------------
 * CE QU'IL NE FAIT PAS
 * ------------------------------------------------------------------
 * Il ne demande PAS à la base si le visiteur est administrateur de
 * plateforme. Ce serait un aller-retour SQL sur chaque requête, y
 * compris les fichiers d'une page, pour une réponse que la coquille
 * redemande de toute façon deux cents millisecondes plus tard. La
 * question « connecté ? » se lit dans le jeton ; la question
 * « administrateur ? » se pose une seule fois par rendu, dans la garde.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // La bibliothèque nous rend des en-têtes Cache-Control /
          // Expires / Pragma quand elle pose un cookie de session. Les
          // appliquer n'est pas facultatif : une réponse mise en cache
          // qui porterait un Set-Cookie donnerait la session d'un
          // administrateur au visiteur suivant, à travers un CDN.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // « Pas de réponse » et « pas connecté » se traitent pareil ici.
    // C'est exactement l'inverse du choix fait dans Oasis Care Pro, et
    // c'est délibéré — voir l'en-tête de ce fichier.
    user = null;
  }

  const { pathname } = request.nextUrl;

  // `/auth/**` doit rester ouvert : c'est par là que revient le lien de
  // connexion, et une session n'existe pas encore à ce moment-là.
  const isPublic = pathname === "/login" || pathname.startsWith("/auth/");

  /**
   * UNE SERVER ACTION N'EST PAS UNE NAVIGATION.
   *
   * Elle attend une réponse d'action ; lui répondre par la page de
   * connexion produit « An unexpected response was received from the
   * server » et une trace qui accuse le formulaire affiché à l'écran.
   *
   * On la laisse donc atteindre le serveur — où elle rencontre
   * `requireAdmin()`, dont le `redirect()` est un mécanisme que le
   * routeur client sait suivre. Ce n'est pas un trou : aucune action de
   * cette application ne s'exécute sans avoir appelé la garde.
   *
   * `signOut` est le seul cas où l'action doit passer même sans
   * session — et c'est justement ce qu'on veut : elle nettoie et
   * renvoie vers `/login`.
   */
  const isServerAction = request.headers.get("next-action") !== null;

  if (!user && !isPublic && !isServerAction) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Aucun paramètre `next` : le Control Center a une seule porte
    // d'entrée, et une redirection paramétrée est une surface de
    // redirection ouverte qu'on n'a pas besoin d'ouvrir pour six
    // personnes qui arrivent toujours par la racine.
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Tout sauf les fichiers statiques : lancer un aller-retour
    // d'authentification pour une favicon n'ajoute que de la latence.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
