import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminIdentity } from "@/lib/auth/guard";
import type { PlatformPermission } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LE CLIENT PRIVILÉGIÉ — `service_role`
 * ==================================================================
 *
 * Le seul module du dépôt qui lit `SUPABASE_SERVICE_ROLE_KEY`. Il est
 * marqué `server-only` : un composant client qui l'importerait, même
 * indirectement, ferait échouer la COMPILATION. Ce n'est pas une
 * convention qu'on peut oublier de suivre, c'est une erreur de build.
 *
 * ------------------------------------------------------------------
 * CE QU'IL N'EST PAS
 * ------------------------------------------------------------------
 * Ce n'est PAS le chemin normal de lecture du Control Center. Les
 * écrans du jalon 1 lisent par les fonctions `security definer` de la
 * migration 0075, avec la session de l'administrateur
 * (`lib/supabase/server.ts`).
 *
 * Et ce client ne saurait pas les appeler à leur place : elles
 * s'authentifient par `auth.uid()`, qui est nul sous une clé de
 * service. Vérifié en transaction annulée sur la vraie base — sous
 * `service_role`, `admin_me()` et `admin_platform_kpis()` lèvent 42501.
 * Le droit d'exécution, lui, est bien là : Supabase l'accorde par
 * défaut à `service_role` sur toute fonction créée dans `public`. Ce
 * qui refuse n'est donc pas le `grant`, c'est le contrôle d'identité
 * à l'intérieur de la fonction.
 *
 * Ce client n'existe donc que pour ce qu'aucune fonction ne peut
 * faire : administrer l'authentification elle-même (créer, révoquer un
 * administrateur de plateforme, bannir un compte). Aucun écran du jalon
 * 1 n'en fait usage — et c'est normal, ce jalon ne modifie rien.
 *
 * ------------------------------------------------------------------
 * R3 : POSSÉDER LA CLÉ N'EST PAS ÊTRE AUTORISÉ
 * ------------------------------------------------------------------
 * `service_role` contourne la RLS, donc aussi les erreurs de
 * raisonnement. La règle R3 de 0075 impose l'ordre : (1) vérifier la
 * session par `getUser()`, (2) résoudre l'identité dans
 * `platform_admins`, (3) vérifier la permission, ET SEULEMENT ALORS
 * (4) construire le client privilégié.
 *
 * Cet ordre est ici imposé par le TYPE, pas par la discipline : la
 * fonction exige une `AdminIdentity`, qui ne peut être obtenue qu'en
 * revenant de `requireAdmin()` — laquelle a déjà fait (1), (2) et (3).
 * On ne peut pas fabriquer le client « juste pour voir » : il n'y a
 * aucun chemin qui n'ait pas franchi la garde.
 *
 * Le `reason` n'est pas décoratif non plus : toute action privilégiée
 * doit être journalisée (`record_admin_event`, motif obligatoire), et
 * le demander ici oblige à l'avoir formulé avant d'agir.
 */
export function createPrivilegedClient(
  admin: AdminIdentity,
  permission: PlatformPermission,
  reason: string,
): SupabaseClient {
  // Une deuxième vérification, redondante avec `requireAdmin`. Elle
  // sert le jour où quelqu'un obtient une `AdminIdentity` par un
  // chemin détourné : la permission est revérifiée contre l'objet
  // qu'on a réellement en main, pas contre celui qu'on croit avoir.
  if (!admin.permissions.includes(permission)) {
    throw new Error(
      `Client privilégié refusé : le rôle « ${admin.role} » ne porte pas la permission ${permission}.`,
    );
  }

  if (!reason.trim()) {
    throw new Error(
      "Client privilégié refusé : une opération privilégiée se justifie au moment où on la fait, pas après.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    // Message volontairement explicite : c'est une erreur de
    // déploiement, jamais une erreur d'utilisateur, et elle ne doit pas
    // se déguiser en « accès refusé ».
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY absente de l'environnement du Control Center. " +
        "Elle vit UNIQUEMENT ici, côté serveur, et jamais dans Oasis Care Pro.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      // Aucune session, aucun cookie, aucun rafraîchissement : ce
      // client n'est l'identité de personne. Le laisser persister une
      // session mêlerait la clé maîtresse au stockage d'un visiteur.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      // Une trace côté Supabase pour distinguer ces appels de ceux de
      // l'application Pro et de l'app iOS, qui partagent le projet.
      headers: { "x-oasis-client": "control-center" },
    },
  });
}
