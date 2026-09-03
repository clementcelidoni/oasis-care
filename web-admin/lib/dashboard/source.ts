import "server-only";

import { createClient } from "@/lib/supabase/server";

import { AdminAccessDenied, AdminReadFailed } from "./errors";
import type { LiveActivityRow, PlatformKpisRow, UnknownReasons } from "./types";

/**
 * OASIS CONTROL CENTER — d'où viennent les chiffres du tableau de bord.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE MODULE N'UTILISE PAS `service_role`
 * ------------------------------------------------------------------
 * Les cinq lectures inter-organisations de 0075 sont des fonctions
 * `security definer` qui s'authentifient par le JETON de l'appelant :
 * leur première instruction est `is_platform_admin()`, qui repose sur
 * `auth.uid()`. Appelées avec un client `service_role`, elles
 * échoueraient — `auth.uid()` y est nul, et l'`execute` n'est accordé
 * qu'à `authenticated`.
 *
 * Ce n'est pas un contournement de la règle « les opérations
 * privilégiées passent par le backend » (spec p.31-32), c'en est
 * l'application la plus stricte : la clé maîtresse n'est jamais
 * chargée pour afficher un tableau de bord, et le contrôle d'identité
 * est refait DANS la base, où aucune erreur de raisonnement du code
 * TypeScript ne peut le contourner. Le franchissement de la RLS reste
 * côté serveur, et le `import "server-only"` en tête le rend
 * MÉCANIQUE : un composant client qui importerait ce module ne
 * compilerait pas, au lieu de fuir silencieusement dans le bundle du
 * navigateur.
 *
 * ------------------------------------------------------------------
 * LA SEULE COUTURE AVEC LE RESTE DE L'APPLICATION
 * ------------------------------------------------------------------
 * `createClient()` de `@/lib/supabase/server` : le client Supabase lié
 * à la session de l'administrateur (clé publishable + cookies), sur le
 * modèle de `web-pro/lib/supabase/server.ts`. C'est la seule
 * dépendance de tout le tableau de bord envers le shell.
 */

/**
 * Appelle une fonction d'administration et rend sa ligne unique.
 *
 * Les fonctions de 0075 sont déclarées `returns table (…)` : PostgREST
 * rend donc un TABLEAU, même pour une ligne unique. On accepte aussi
 * l'objet nu, au cas où une version future de PostgREST déplierait les
 * fonctions à ligne unique — le seul comportement qu'on refuse est le
 * vide, parce qu'une fonction qui ne rend rien n'est pas un tableau de
 * bord vide, c'est une anomalie.
 */
async function callAdminFunction<Row>(
  name: string,
  args: Record<string, unknown>,
): Promise<Row> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    // 42501 = insufficient_privilege. C'est le code que 0075 utilise
    // pour ses deux refus (« pas administrateur » et « permission
    // manquante »), et le seul qu'on veuille distinguer.
    if (error.code === "42501") {
      throw new AdminAccessDenied(error.message);
    }
    throw new AdminReadFailed(`${name} : ${error.message}`);
  }

  const rows: Row[] = Array.isArray(data)
    ? (data as Row[])
    : data
      ? [data as Row]
      : [];

  if (rows.length === 0) {
    throw new AdminReadFailed(`${name} n'a rendu aucune ligne.`);
  }
  return rows[0];
}

/**
 * `unknown_reasons` arrive en jsonb. La base garantit un objet — 0075
 * écrit `coalesce(v_reasons, '{}'::jsonb)` — mais on ne fait pas
 * reposer l'affichage des motifs sur une garantie distante : sans
 * motif, l'écran doit dire « inconnu, et on ne sait pas pourquoi »,
 * jamais planter.
 */
function normalizeReasons(value: unknown): UnknownReasons {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const reasons: UnknownReasons = {};
  for (const [key, reason] of Object.entries(value as Record<string, unknown>)) {
    if (typeof reason === "string" && reason.trim() !== "") reasons[key] = reason;
  }
  return reasons;
}

/** Les grands KPI (spec p.3-4). */
export async function readPlatformKpis(): Promise<PlatformKpisRow> {
  const row = await callAdminFunction<PlatformKpisRow>("admin_platform_kpis", {});
  return { ...row, unknown_reasons: normalizeReasons(row.unknown_reasons) };
}

/**
 * L'activité de la fenêtre (spec p.4-5).
 *
 * `since` à `null` laisse la BASE choisir le début : minuit à Paris.
 * C'est délibéré — le fuseau du serveur Node n'a pas à décider de ce
 * qu'est « aujourd'hui » alors que 0066 a déjà tranché la question en
 * SQL pour tout le projet.
 */
export async function readLiveActivity(since: Date | null): Promise<LiveActivityRow> {
  const row = await callAdminFunction<LiveActivityRow>("admin_live_activity", {
    p_since: since ? since.toISOString() : null,
  });
  return { ...row, unknown_reasons: normalizeReasons(row.unknown_reasons) };
}
