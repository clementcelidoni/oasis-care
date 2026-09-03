import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Échange le code à usage unique d'un lien magique ou d'une redirection
 * OAuth contre un vrai cookie de session.
 *
 * ------------------------------------------------------------------
 * CE QU'IL NE FAIT PAS : vérifier que la personne est administratrice.
 * ------------------------------------------------------------------
 * Et c'est volontaire. Cette route établit une IDENTITÉ, pas une
 * autorisation ; les deux sont des questions distinctes, et les
 * mélanger ici aurait deux défauts.
 *
 * D'abord ce serait un contrôle de plus à tenir à jour, au même endroit
 * qu'un échange de jeton — deux responsabilités dans une fonction qu'on
 * relit rarement.
 *
 * Ensuite ce serait un oracle : refuser ici, avec un message, dirait à
 * qui essaie si l'adresse qu'il vient d'utiliser appartient à un
 * administrateur. La session est donc établie pour tout le monde, et
 * `requireAdmin()` répond 404 à qui n'a rien à faire ici — sans lui
 * apprendre ce qu'il a manqué.
 *
 * ------------------------------------------------------------------
 * LA DESTINATION EST FIXE
 * ------------------------------------------------------------------
 * Toujours `/`. Pas de paramètre `next`, donc pas de redirection
 * ouverte à valider, à tester, ni à réparer un jour. Le Control Center
 * a une seule porte d'entrée.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=lien_incomplet`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Le message de Supabase est repris tel quel : ici il ne révèle
    // rien d'utile à un attaquant (« code expiré », « code déjà
    // utilisé ») et il évite un aller-retour de support pour un lien
    // ouvert trop tard.
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/`);
}
