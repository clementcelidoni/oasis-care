import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh on every request.
 *
 * This is `proxy.ts`, not `middleware.ts`: the middleware convention is
 * deprecated in Next.js 16 and renamed to proxy. Same behaviour, new
 * file and export name.
 *
 * Deliberately an OPTIMISTIC check only. Next's own guidance is that
 * proxy "should not be used as a full session management or
 * authorization solution" — so this refreshes the auth cookie and
 * bounces obviously-signed-out visitors, and nothing more. The real
 * authorization lives in two places that a request cannot talk its way
 * around: `getUser()` in Server Components, and Postgres RLS.
 *
 * Because it is only optimistic, it FAILS OPEN. Two cases below let a
 * request through that this file cannot judge — a Server Action, and an
 * unreachable auth server. In both, the layout re-checks and RLS still
 * refuses the data. Bouncing to the sign-in page on a doubt would log
 * people out for a network hiccup, which is the worse failure.
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
          // The library hands us Cache-Control/Expires/Pragma headers
          // when it sets auth cookies. Applying them is not optional:
          // a cached response carrying a Set-Cookie could hand one
          // user's session to the next visitor through a CDN.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  /**
   * "Signed out" and "could not ask" are different answers.
   *
   * A 4xx from the auth server is an ANSWER: the token is missing,
   * expired beyond refresh, or forged. Anything without a status — a
   * timeout, a DNS failure, a dropped connection — is not an answer at
   * all, and treating it as one signs the user out mid-click every time
   * their connection stutters.
   */
  let user = null;
  let answered = true;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    if (error && typeof (error as { status?: unknown }).status !== "number") {
      answered = false;
    }
  } catch {
    answered = false;
  }

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/invitation") ||
    // LE DÉSABONNEMENT DOIT MARCHER SANS COMPTE, ET SANS DÉLAI.
    //
    // C'est une obligation légale (art. L.34-5 CPCE, art. 7-3 RGPD : le
    // retrait doit être aussi simple que le consentement). Rediriger ce
    // lien vers une page de connexion, c'est refuser le désabonnement —
    // et la personne n'aurait alors qu'un seul geste possible :
    // « signaler comme indésirable ». C'est cette plainte qui remplit la
    // liste de blocage TRANSACTIONNELLE du transporteur, et qui finit
    // par bloquer les FACTURES de la même adresse.
    pathname.startsWith("/desabonnement") ||
    // LE DEVIS PARTAGÉ S'OUVRE SANS COMPTE. C'est la décision du
    // dirigeant : « il doit pas créer de compte ». Le client d'un
    // paysagiste n'a pas de compte et n'en aura pas.
    //
    // Sans cette ligne, /d/<jeton> était redirigé vers /login — donc la
    // porte ne s'ouvrait JAMAIS, et la redirection était une impasse
    // pour quelqu'un qui ne peut pas se connecter.
    //
    // ET LA CONSÉQUENCE ÉTAIT PIRE QUE FONCTIONNELLE : le paragraphe
    // ci-dessous recopiait le chemin dans `?next=`, donc le JETON —
    // l'unique barrière de la porte, 256 bits — partait dans une URL de
    // page de connexion. Un paramètre de requête finit dans les
    // journaux d'accès de l'hébergeur, dans l'historique du navigateur,
    // et dans l'en-tête Referer de tout ce que /login émet. La page /d
    // se défend justement par `referrer: no-referrer` et
    // `robots: noindex` — défenses qui ne s'appliquaient jamais,
    // puisqu'elle ne s'affichait pas.
    pathname.startsWith("/d/") ||
    // L'ÉTIQUETTE SCANNÉE S'OUVRE SANS COMPTE, ET C'EST TOUT LE § 15.
    //
    // « Le backend détermine ensuite l'organisation, l'entité, les
    // permissions, l'écran à ouvrir. » Le porteur le plus fréquent
    // n'est pas un salarié : c'est quelqu'un qui passe devant une
    // plante dans un jardin et sort son téléphone. Sans cette ligne,
    // /x/<jeton> était redirigé vers /login — mesuré : 307 vers
    // /login?next=… —, donc CHAQUE QR imprimé menait à un écran de
    // connexion, et les écrans du produit promettaient à l'écran
    // qu'un passant verrait une fiche.
    //
    // Le résolveur ne crée aucune session : il lit celle qui existe
    // pour décider quoi montrer, et ne montre rien de plus à un
    // anonyme que ce que le propriétaire a explicitement publié.
    pathname.startsWith("/x/");

  /**
   * A Server Action is not a page navigation.
   *
   * It expects an action response, and answering with the sign-in page
   * produces "An unexpected response was received from the server" plus
   * a stack trace pointing at whichever form happened to be on screen —
   * which is how this was found, from a stack blaming a task form for an
   * expired session.
   *
   * Let it through. The action calls `requireOrganization()`, whose
   * `redirect()` the client router knows how to follow.
   */
  const isServerAction = request.headers.get("next-action") !== null;

  /**
   * UN CHEMIN QUI PORTE UN SECRET NE SE RECOPIE PAS DANS UNE URL.
   *
   * `?next=` est une commodité utile partout ailleurs. Mais /d/<jeton>
   * porte l'unique barrière de la porte anonyme dans son chemin, et un
   * paramètre de requête se retrouve dans les journaux d'accès, dans
   * l'historique du navigateur et dans l'en-tête Referer.
   *
   * La ligne d'`isPublic` ci-dessus suffit pour /d aujourd'hui. Cette
   * liste-ci est la ceinture : la prochaine route à jeton — une
   * facture, un portail — ramènerait exactement la même fuite si elle
   * arrivait sans que personne y pense. On la nomme par sa PROPRIÉTÉ,
   * pas par son nom.
   */
  //
  // /x/<jeton> porte le même genre de secret : recopié dans `?next=`,
  // le jeton d'une étiquette partait dans les journaux d'accès, dans
  // l'historique et dans le Referer de /login. Il est nommé ici par
  // sa PROPRIÉTÉ, comme le commentaire ci-dessus le demandait.
  const cheminPorteUnSecret = pathname.startsWith("/d/") || pathname.startsWith("/x/");

  if (!user && !isPublic && answered && !isServerAction) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // Send them back where they were headed once signed in.
    if (!cheminPorteUnSecret) {
      loginUrl.searchParams.set("next", pathname);
    }
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
    // Everything except static assets and image files — running an auth
    // round-trip for a favicon would just add latency.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
