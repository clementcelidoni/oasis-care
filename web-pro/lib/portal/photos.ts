import { createClient } from "@/lib/supabase/server";
import type { ClientProjectPhoto } from "@/lib/portal/types";

const PHOTO_BUCKET = "project-photos";

/**
 * Les photos d'un chantier, vues du client.
 *
 * Deux barrières successives, et il faut les deux :
 *
 *  • `client_project_photos` filtre les LIGNES — quel chantier, quelles
 *    légendes ;
 *  • la politique du bucket (migration 0055) filtre les FICHIERS, sur
 *    le deuxième segment du chemin.
 *
 * Sans la seconde, `createSignedUrl` refuserait et la galerie
 * afficherait des cadres vides. Sans la première, on demanderait des
 * URL pour des photos qu'on n'a pas le droit de lister.
 */
export async function listClientProjectPhotos(projectId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("client_project_photos")
    .select("*")
    .eq("project_id", projectId)
    .order("taken_on", { ascending: false });

  const photos = (data ?? []) as ClientProjectPhoto[];

  return Promise.all(
    photos.map(async (photo) => {
      // Une heure de validité : le bucket est privé, et une URL
      // permanente circulerait hors de tout contrôle d'accès — y
      // compris après une révocation.
      const { data: signed } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(photo.storage_path, 3600);

      return {
        id: photo.id,
        url: signed?.signedUrl ?? null,
        caption: photo.caption,
        moment: photo.moment,
        takenOn: photo.taken_on,
      };
    }),
  );
}
