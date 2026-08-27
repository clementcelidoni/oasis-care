import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route
 * Handlers.
 *
 * `cookies()` is async in this version of Next.js, so this function is
 * async too — awaiting it is not optional.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. That is expected and
            // harmless here: proxy.ts refreshes the session on every
            // request, so the refreshed cookie is already on its way to
            // the browser by the time a page renders.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, or null.
 *
 * Always `getUser()`, never `getSession()`, for anything that gates
 * access: `getSession()` returns whatever is in the cookie without
 * revalidating it, so a forged cookie would satisfy it. `getUser()`
 * asks the Auth server to verify the token.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
