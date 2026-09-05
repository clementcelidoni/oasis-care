import "server-only";

import { createClient } from "@/lib/supabase/server";
import { AdminReadFailed } from "@/lib/customers/errors";

import { PERMISSIONS_NEUVES_0081 } from "./permissions.ts";

/**
 * ==================================================================
 * LA MIGRATION 0081 EST-ELLE APPLIQUÉE ?
 * ==================================================================
 *
 * LA QUESTION N'EST PAS THÉORIQUE : au moment où ces écrans sont
 * écrits, 0081 est éprouvée en transaction annulée et N'EST PAS
 * APPLIQUÉE en production — vérifié, `select count(*) from
 * information_schema.tables where table_name like 'support\\_%'` rend
 * ZÉRO. Ni `support_tickets`, ni `support_sessions`, ni
 * `support_access_levels` n'existent.
 *
 * Sans ce diagnostic, ces écrans afficheraient une erreur PostgREST
 * brute — « relation public.support_tickets does not exist » — que
 * personne ne relierait à « la migration n'est pas déployée ». C'est le
 * mode de défaillance que `lib/ia/source.ts` avait rencontré avec 0080 ;
 * on reprend sa forme.
 *
 * ------------------------------------------------------------------
 * TROIS ÉTATS, ET ILS N'APPELLENT PAS LA MÊME RÉPONSE
 * ------------------------------------------------------------------
 *   ok                     on peut lire.
 *   migration-absente      il faut APPLIQUER 0081.
 *   permission-manquante   il faut modifier la MATRICE des rôles.
 *
 * Les deux derniers se ressemblent de l'extérieur — l'écran est fermé —
 * et se corrigent à deux endroits opposés. Les confondre, c'est chercher
 * un bug d'autorisation pendant une heure pour un fichier SQL non joué.
 *
 * ET LE PIÈGE QUE CE FICHIER DOIT CONNAÎTRE : une permission ajoutée
 * après 0075 n'est portée par PERSONNE — pas même par le
 * super-administrateur — tant qu'on ne rejoue pas le semis par jointure
 * (0075:323, rejoué par 0080:278 puis par 0081 § 1.c). Si l'écran se
 * ferme malgré une migration appliquée, c'est la première chose à
 * vérifier, et la phrase ci-dessous le dit.
 */

export type EtatSocleAssistance =
  | { etat: "ok" }
  | { etat: "migration-absente" }
  | { etat: "permission-manquante" };

/**
 * @param permissions Celles de `admin_me()`, donc de la base.
 * @param requise La permission dont l'écran a besoin. On ne demande pas
 *   « êtes-vous administrateur » — la garde l'a déjà fait — mais
 *   « cette clé existe-t-elle, et la portez-vous ».
 */
export async function diagnostiquerSocleAssistance(
  permissions: readonly string[],
  requise: string,
): Promise<EtatSocleAssistance> {
  if (permissions.includes(requise)) return { etat: "ok" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admin_permissions")
    .select("key")
    .in("key", PERMISSIONS_NEUVES_0081 as unknown as string[]);

  if (error) {
    throw new AdminReadFailed(
      `lecture du catalogue des permissions : ${error.message} (${error.code ?? "sans code"}).`,
    );
  }

  const connues = Array.isArray(data) ? data.length : 0;
  return connues === 0 ? { etat: "migration-absente" } : { etat: "permission-manquante" };
}

/**
 * La phrase à afficher pour chacun des deux états fermés.
 *
 * Écrite ici et pas dans chaque page : quatre écrans qui expliqueraient
 * la même chose avec quatre formulations différentes feraient croire à
 * quatre problèmes.
 */
export function explicationSocle(
  etat: Exclude<EtatSocleAssistance["etat"], "ok">,
  requise: string,
): { titre: string; texte: string } {
  if (etat === "migration-absente") {
    return {
      titre: "La migration 0081 n'est pas appliquée",
      texte:
        "Aucune des quatre permissions d'assistance de ce jalon n'existe dans le catalogue de la base : " +
        "supabase/migrations/0081_control_center_suite.sql n'a pas été jouée, et les tables " +
        "support_tickets, support_sessions et support_access_levels n'existent pas encore. " +
        "Cet écran ne peut donc rien lire, et il ne l'invente pas. " +
        "Appliquez la migration, puis rechargez le cache de schéma de PostgREST — il peut avoir une minute de retard.",
    };
  }
  return {
    titre: "Votre rôle ne couvre pas cet écran",
    texte:
      `La migration 0081 est appliquée — le catalogue connaît ses permissions — mais votre rôle ne porte pas « ${requise} ». ` +
      "Si vous êtes super-administrateur et lisez cette phrase, c'est le semis qu'il faut vérifier : " +
      "une permission ajoutée après 0075 n'est portée par personne tant que la jointure de semis n'est pas rejouée.",
  };
}
