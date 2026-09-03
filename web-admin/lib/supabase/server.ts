import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Le client Supabase de l'administrateur CONNECTÉ.
 *
 * C'est le client de travail du Control Center, et non un détail : les
 * fonctions posées par la migration 0075 (`admin_platform_kpis`,
 * `admin_live_activity`, `admin_list_users`, `admin_list_organizations`,
 * `admin_global_search`, `admin_me`, `record_admin_event`)
 * s'authentifient par `auth.uid()`, c'est-à-dire par le JETON de
 * l'appelant.
 *
 * UN CLIENT `service_role` NE PEUT DONC RIEN EN TIRER. Vérifié sur la
 * vraie base, en transaction annulée : sous `service_role` sans jeton,
 * `admin_me()` et `admin_platform_kpis()` lèvent toutes deux 42501, et
 * elles lèvent encore quand le jeton porté est celui d'un compte
 * ordinaire. La raison n'est pas le droit d'exécution — Supabase
 * accorde par défaut l'`execute` à `service_role` sur toute fonction
 * créée dans `public`, et 0075 ne le lui retire pas — mais
 * `auth.uid()`, qui est nul sans jeton et qui ne désigne jamais un
 * administrateur quand le jeton est celui de quelqu'un d'autre.
 *
 * C'est la barrière R3 de 0075, et elle tient exactement comme
 * annoncé : posséder la clé maîtresse n'est pas être autorisé.
 *
 * `cookies()` est asynchrone dans cette version de Next : l'`await`
 * n'est pas facultatif.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Un Server Component ne peut pas poser de cookie. Sans
            // conséquence ici : `proxy.ts` rafraîchit la session à
            // chaque requête, donc le cookie renouvelé est déjà en
            // route vers le navigateur quand la page se rend.
          }
        },
      },
    },
  );
}

/**
 * L'utilisateur connecté, vérifié auprès du serveur d'authentification.
 *
 * TOUJOURS `getUser()`, JAMAIS `getSession()` pour décider d'un accès :
 * `getSession()` rend le contenu du cookie sans le revalider, donc un
 * cookie forgé le satisferait. `getUser()` demande au serveur Auth de
 * vérifier le jeton.
 *
 * Rend `null` aussi bien pour « déconnecté » que pour « le serveur
 * d'authentification n'a pas répondu ». Les deux mènent au même endroit
 * dans cette application — la porte reste fermée. C'est l'inverse du
 * choix fait dans Oasis Care Pro (`web-pro/proxy.ts`, « it FAILS
 * OPEN »), et c'est délibéré : là-bas la RLS reprenait la main derrière,
 * ici les lectures traversent les organisations.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
