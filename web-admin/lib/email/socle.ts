import "server-only";

import { AdminReadFailed } from "@/lib/customers/errors";
import { createClient } from "@/lib/supabase/server";

import { PERMISSIONS_COURRIER, type PermissionCourrier } from "./permissions.ts";

/**
 * ==================================================================
 * LA MIGRATION 0084 EST-ELLE APPLIQUÉE ?
 * ==================================================================
 *
 * LA QUESTION N'EST PAS THÉORIQUE. Au moment où ces écrans sont écrits,
 * la production est à 0080 : 0081, 0082, 0083 et 0084 sont éprouvées en
 * transaction annulée et AUCUNE n'est appliquée. Aucune table
 * `email_*` n'existe, et le catalogue des permissions compte quatorze
 * clés — les six du courrier n'y sont pas.
 *
 * Sans ce diagnostic, chaque écran de ce lot afficherait une erreur
 * PostgREST brute — « relation public.email_campaigns does not exist » —
 * que personne ne relierait à « la migration n'est pas déployée ». On
 * reprend la forme de `lib/billing/socle.ts`, y compris la distinction
 * qui coûte le plus cher quand on l'omet.
 *
 * ------------------------------------------------------------------
 * TROIS ÉTATS, QUI SE CORRIGENT À TROIS ENDROITS OPPOSÉS
 * ------------------------------------------------------------------
 *   ok                     on peut lire.
 *   migration-absente      il faut APPLIQUER 0084.
 *   permission-manquante   il faut modifier la MATRICE des rôles.
 *
 * ET LE PIÈGE QUE CE FICHIER DOIT CONNAÎTRE : 0075 § 1.c sème le
 * super-administrateur PAR JOINTURE sur le catalogue. Une permission
 * ajoutée après 0075 n'est donc portée par PERSONNE tant que la
 * jointure n'est pas rejouée. 0084 § 16.b la rejoue explicitement. Si
 * l'écran se ferme malgré une migration appliquée, c'est la PREMIÈRE
 * chose à vérifier — et c'est ce que dit la phrase de refus.
 */

export type EtatSocleCourrier =
  | { etat: "ok" }
  | { etat: "migration-absente" }
  | { etat: "permission-manquante" };

/**
 * @param permissions Celles de `admin_me()`, donc de la base.
 * @param requise La clé dont l'écran a besoin. On ne demande pas
 *   « êtes-vous administrateur » — la garde l'a déjà fait — mais
 *   « cette clé existe-t-elle au catalogue, et la portez-vous ».
 */
export async function diagnostiquerSocleCourrier(
  permissions: readonly string[],
  requise: PermissionCourrier,
): Promise<EtatSocleCourrier> {
  if (permissions.includes(requise)) return { etat: "ok" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admin_permissions")
    .select("key")
    .in("key", PERMISSIONS_COURRIER as unknown as string[]);

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
 * Écrite ici et pas dans chaque page : six écrans qui expliqueraient la
 * même chose avec six formulations différentes feraient croire à six
 * problèmes, et la moitié finirait par afficher « une erreur est
 * survenue », qui n'apprend rien.
 */
export function explicationSocle(
  etat: Exclude<EtatSocleCourrier["etat"], "ok">,
  requise: PermissionCourrier,
): { titre: string; texte: string } {
  if (etat === "migration-absente") {
    return {
      titre: "La migration 0084 n'est pas appliquée",
      texte:
        "Aucune des six permissions du courrier sortant n'existe dans le catalogue de la base : " +
        "supabase/migrations/0084_emails.sql n'a pas été jouée. Ni le journal d'envoi, ni le registre de " +
        "consentement, ni la liste de suppression n'existent — cet écran ne peut donc rien lire, et il " +
        "ne l'invente pas. Appliquez la migration, puis rechargez le cache de schéma de PostgREST : il " +
        "peut avoir une minute de retard.",
    };
  }
  return {
    titre: "Votre rôle ne couvre pas cet écran",
    texte:
      `La migration 0084 est appliquée — le catalogue connaît ses permissions — mais votre rôle ne porte pas « ${requise} ». ` +
      "Si vous êtes super-administrateur et lisez cette phrase, ce n'est pas votre rôle qu'il faut regarder mais le SEMIS : " +
      "0075 sème le super-administrateur par jointure sur le catalogue, donc une permission ajoutée après lui n'est portée " +
      "par personne tant que la jointure n'est pas rejouée. 0084 § 16.b la rejoue ; si la ligne manque, c'est que ce bloc " +
      "n'a pas été exécuté.",
  };
}
