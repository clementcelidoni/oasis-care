"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * §17 MON PROFIL — le compte de la PERSONNE.
 *
 * Une seule chose se modifie ici, le nom affiché, et elle s'écrit à
 * DEUX endroits. Ce n'est pas une redondance :
 *
 *  · `user_metadata.full_name` est ce que la coquille lit pour saluer
 *    l'utilisateur (voir `app/(app)/layout.tsx`, qui le passe au
 *    header) ;
 *  · `profiles.display_name` est ce que le reste de la base associe au
 *    compte — et ce que l'app iOS affiche, puisqu'elle lit la même
 *    table.
 *
 * N'écrire que le premier donnerait un en-tête qui change et une fiche
 * qui ne bouge pas ; n'écrire que le second, l'inverse.
 *
 * L'e-mail ne se modifie pas. Le changer demanderait de vérifier la
 * nouvelle adresse par un lien envoyé dessus — or c'est précisément
 * cette adresse qui sert à se connecter, et une vérification ratée
 * fermerait le compte. Tant que ce parcours n'existe pas, l'écran le
 * dit au lieu d'offrir un champ qui échoue.
 */
export async function updateDisplayName(formData: FormData) {
  const name = String(formData.get("display_name") ?? "").trim().slice(0, 120);
  // Un nom vide effacerait la seule chose qui distingue ce compte d'une
  // adresse e-mail dans l'historique. On ne fait rien plutôt.
  if (!name) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // `profiles` d'abord, et sans `upsert`. La migration 0001 n'a créé
  // AUCUNE politique d'INSERT sur cette table : la ligne naît d'un
  // déclencheur à la création du compte. Un `upsert` sur un compte dont
  // la ligne manquerait serait refusé par RLS, là où un `update` ne
  // touche simplement rien.
  //
  // Et d'abord parce qu'en cas d'échec, rien n'a encore changé : on
  // s'arrête sur une erreur au lieu de laisser un nom modifié d'un côté
  // et pas de l'autre.
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  const { error: authError } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (authError) throw new Error(authError.message);

  // Le nom s'affiche dans le header, qui appartient à la mise en page :
  // sans cette invalidation-là, il garderait l'ancien jusqu'au prochain
  // rechargement complet.
  revalidatePath("/", "layout");
  revalidatePath("/profil");
}
