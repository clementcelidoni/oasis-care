import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 *
 * Uses the same project and the same publishable key as the iOS app
 * (see OasisCare/Services/Auth/SupabaseConfig.swift) — Phase 11 §"AUTH
 * WEB : utiliser le même Supabase Auth que l'application. Un
 * utilisateur Oasis Care doit pouvoir utiliser le même compte sur le
 * Web."
 *
 * Only the publishable (anon) key ever reaches the browser. The
 * service_role key must never appear here — §SECURITY, "aucune
 * service_role dans navigateur". Real access control is Postgres RLS,
 * not key secrecy.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
