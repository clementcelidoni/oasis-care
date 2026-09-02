"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Se déconnecter.
 *
 * `signOut()` révoque la session côté Supabase et efface les cookies —
 * les supprimer nous-mêmes laisserait le jeton valable jusqu'à son
 * expiration, ce qui n'est pas ce qu'on promet à quelqu'un qui clique
 * « Se déconnecter » sur un ordinateur partagé.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
