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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/invitation");

  if (!user && !isPublic) {
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
