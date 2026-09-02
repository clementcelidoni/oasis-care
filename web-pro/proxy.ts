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
    pathname.startsWith("/invitation");

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

  if (!user && !isPublic && answered && !isServerAction) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Send them back where they were headed once signed in.
    loginUrl.searchParams.set("next", pathname);
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
