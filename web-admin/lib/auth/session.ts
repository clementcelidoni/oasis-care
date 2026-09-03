"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Se déconnecter du Control Center.
 *
 * `signOut()` révoque la session côté Supabase avant d'effacer les
 * cookies. Les supprimer seulement laisserait le jeton valable jusqu'à
 * son expiration — sur une console d'administration, ce n'est pas ce
 * qu'on promet à quelqu'un qui clique « Se déconnecter ».
 *
 * ATTENTION AU PARTAGE DE SESSION. Cette application et Oasis Care Pro
 * s'appuient sur le même projet Supabase. Elles tournent en revanche
 * sur deux origines distinctes (`admin.oasiscare.com` et le domaine
 * Pro, `localhost:3100` et `localhost:3000` en développement), donc
 * deux jeux de cookies : se déconnecter ici ne déconnecte pas de Pro,
 * et c'est le comportement attendu. En revanche `signOut()` révoque le
 * JETON, pas seulement le cookie — une session Pro ouverte avec le même
 * compte sera invalidée à son prochain rafraîchissement. C'est le bon
 * sens de la sécurité, mais il vaut mieux le savoir avant de le
 * découvrir.
 *
 * Aucune garde ici : se déconnecter est la seule action que même un
 * visiteur non administrateur doit pouvoir accomplir. Exiger
 * `requireAdmin()` enfermerait dans un 404 quelqu'un qui s'est connecté
 * avec le mauvais compte.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
