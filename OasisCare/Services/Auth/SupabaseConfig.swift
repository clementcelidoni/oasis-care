import Foundation

/// The Supabase project URL and publishable (anon) key. Both are safe to
/// ship in the client — Supabase's publishable key is explicitly designed
/// for public embedding (every client app download contains it, extractable
/// regardless of where it's stored), unlike the service_role/secret key,
/// which must never appear anywhere in this app. Real data access control
/// comes from Postgres Row Level Security (Phase 3C), not from keeping this
/// key secret.
enum SupabaseConfig {
    static let url = URL(string: "https://bipicvyfhxvqpwwaogpl.supabase.co")!
    static let publishableKey = "sb_publishable_8vOPaFoDla2AbAecgH0kYw_pxxZCT09"
}
