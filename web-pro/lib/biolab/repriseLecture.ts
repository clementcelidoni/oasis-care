import { createClient } from "@/lib/supabase/server";
import type { Lecture } from "./cultures.ts";
import { echecDeLecture } from "./cultures.ts";

/**
 * §3 DE LA MIGRATION 0087 — CE QUI PEUT ÊTRE REPRIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE PROBLÈME QUE CE FICHIER RÉSOUT
 * ══════════════════════════════════════════════════════════════════
 *
 * L'application iPhone estampille tout ce qu'elle écrit du PREMIER
 * ESPACE PERSONNEL du compte (`SyncEngine.fetchWorkspaceID`). Le
 * dirigeant saisit ses lots à la paillasse, sur son téléphone : ils
 * partent dans son espace privé. Le web, lui, ne lit que l'espace de
 * l'ENTREPRISE — et c'est délibéré : lire l'espace privé donnerait à
 * toute la société, salarié invité demain compris, le droit de modifier
 * et de supprimer le laboratoire d'une personne.
 *
 * Résultat, sans ce geste : un écran vide au-dessus d'un laboratoire
 * qui existe. Le tableau de bord savait déjà le DIRE ; il ne savait pas
 * y remédier, et un constat exact sans porte de sortie est une impasse.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Il ne déplace rien lui-même. Toute la logique — les deux contrôles,
 * le journal ligne à ligne, le retour arrière — est dans la fonction
 * `transferer_biolab_vers_entreprise` de la migration 0087, qui est
 * `security definer` et transactionnelle. Ce fichier l'APPELLE. Refaire
 * ici une boucle d'`update` serait le second système que le §6
 * interdit, sans journal et sans possibilité de défaire.
 *
 * LES DEUX CONTRÔLES SONT DANS LA BASE, PAS ICI : il faut être le
 * propriétaire de l'espace de départ ET détenir `biolab.manage` dans
 * l'entreprise d'arrivée. La vérification faite ci-dessous ne sert qu'à
 * ne pas montrer un bouton qui échouerait ; ce n'est pas elle qui
 * protège.
 */

export type LaboratoireAilleurs = {
  workspaceId: string;
  nom: string;
  lots: number;
};

/**
 * Les espaces PERSONNELS de l'utilisateur qui contiennent des lots de
 * culture, autres que celui de l'entreprise active.
 *
 * TROIS BORNES, ET CHACUNE A SA RAISON :
 *
 *   • `is_personal` — on ne propose jamais de vider l'espace d'une
 *     autre entreprise. La base le refuserait de toute façon (« la
 *     reprise part d'un espace personnel »), mais proposer un geste
 *     voué à l'échec est une perte de temps pour celui qui clique.
 *   • `owner_id = moi` — la base exige d'être propriétaire de l'espace
 *     de départ. Un salarié membre de l'espace privé d'un collègue ne
 *     doit pas se voir offrir de le verser dans la société.
 *   • la RLS — elle ne rend de toute façon que les espaces dont on est
 *     membre. Ce comptage ne peut révéler le laboratoire de personne.
 */
export async function lireLaboratoiresAilleurs(
  workspaceIdEntreprise: string,
): Promise<Lecture<LaboratoireAilleurs[]>> {
  const supabase = await createClient();

  const { data: utilisateur } = await supabase.auth.getUser();
  const moi = utilisateur?.user?.id ?? null;
  if (!moi) return { donnees: [], erreur: null };

  const { data: espaces, error: erreurEspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("owner_id", moi)
    .eq("is_personal", true)
    .neq("id", workspaceIdEntreprise);
  if (erreurEspaces) return echecDeLecture<LaboratoireAilleurs[]>([], erreurEspaces.message);

  const liste = (espaces ?? []) as { id: string; name: string | null }[];
  if (liste.length === 0) return { donnees: [], erreur: null };

  const resultat: LaboratoireAilleurs[] = [];
  for (const espace of liste) {
    const { count, error } = await supabase
      .from("culture_batches")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", espace.id);
    if (error) return echecDeLecture<LaboratoireAilleurs[]>([], error.message);
    if ((count ?? 0) > 0) {
      resultat.push({
        workspaceId: espace.id,
        nom: espace.name?.trim() || "Mon espace",
        lots: count ?? 0,
      });
    }
  }
  return { donnees: resultat, erreur: null };
}

