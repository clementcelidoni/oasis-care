import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { parseQuery, type SearchResult } from "@/lib/search/types";

/**
 * §20 RECHERCHE GLOBALE — le point d'entrée de la palette.
 *
 * Un Route Handler, et pas une Server Action. La différence compte
 * pour §31 PERFORMANCE : « Annuler anciennes requêtes. » Un `fetch`
 * accepte un `AbortSignal`, une Server Action non — en tapant
 * « Trachycarpus », on lance douze recherches dont onze sont déjà
 * périmées à leur retour, et sans annulation c'est la dernière ARRIVÉE
 * qui gagne, pas la dernière DEMANDÉE. Les résultats se mettent alors à
 * clignoter entre deux frappes.
 *
 * Pas de cache : les Route Handlers ne le sont pas par défaut, et c'est
 * ce qu'on veut. Un résultat de recherche mis en cache montrerait à
 * l'un ce que l'autre vient de chercher.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("q") ?? "";

  // L'organisation vient de la SESSION, jamais du paramètre. C'est la
  // moitié web de §31 : le client ne choisit pas dans quelle entreprise
  // il cherche.
  const organization = await getActiveOrganization();
  if (!organization) {
    return Response.json({ results: [] as SearchResult[] }, { status: 200 });
  }

  const parsed = parseQuery(raw);
  if (parsed.text.trim().length < 2) {
    return Response.json({ results: [] as SearchResult[], query: parsed });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("global_search", {
    p_organization_id: organization.organizationId,
    p_query: parsed.text,
    p_types: parsed.types,
    p_limit: 6,
  });

  if (error) {
    // On répond 200 avec une liste vide plutôt qu'une erreur : la
    // palette est un outil de navigation, et une bannière rouge sous
    // le champ à cause d'un hoquet réseau serait plus alarmante
    // qu'utile. L'erreur part dans les journaux du serveur.
    console.error("recherche globale :", error.message);
    return Response.json({ results: [] as SearchResult[], query: parsed });
  }

  return Response.json({ results: (data ?? []) as SearchResult[], query: parsed });
}
