import { createClient } from "@/lib/supabase/server";

/**
 * L'espace de travail d'un jardin — et jamais celui de l'organisation
 * active.
 *
 * Un même compte appartient à plusieurs espaces : le sien, créé à
 * l'inscription, où l'iPhone écrit depuis la Phase 3 ; et celui de son
 * entreprise, créé par `create_professional_organization`. Les deux
 * apparaissent dans la liste des jardins, parce que la politique RLS
 * dit `is_workspace_member(workspace_id)` et qu'il est membre des deux.
 *
 * Tamponner un objet du plan avec l'espace de l'organisation alors que
 * son jardin vit dans l'espace personnel brise l'invariant « un enfant
 * appartient à l'espace de son parent », et pas seulement en théorie :
 * un salarié invité dans l'entreprise lirait alors `garden_map_objects`
 * — le contenu d'un jardin privé — sans jamais voir le jardin qui le
 * porte. RLS ferait exactement ce qu'on lui demande ; c'est la donnée
 * qui serait rangée au mauvais endroit.
 *
 * Renvoie `null` si le jardin n'existe pas ou n'est pas visible : dans
 * ce cas l'appelant doit refuser d'écrire plutôt que retomber sur un
 * espace par défaut.
 */
export async function gardenWorkspaceId(gardenId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gardens")
    .select("workspace_id")
    .eq("id", gardenId)
    .maybeSingle();
  return data?.workspace_id ?? null;
}

export const NO_GARDEN_WORKSPACE =
  "Jardin introuvable, ou vous n'avez pas accès à son espace de travail.";
