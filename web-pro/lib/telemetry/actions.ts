"use server";

import { createClient } from "@/lib/supabase/server";
import { PRESENCE_RPC, WEB_PLATFORM, type WebPresence } from "./presence.ts";
import { declareQuietly } from "./report.ts";
import { webRelease } from "./release.ts";

/**
 * LA PORTE DE SERVICE : une Server Action, et une seule.
 *
 * POURQUOI PASSER PAR LE SERVEUR plutôt que d'appeler la fonction en
 * base depuis le navigateur, alors que `lib/supabase/client.ts` existe :
 *
 *   1. LA VERSION SE LIT ICI. Le serveur sait quelle version il
 *      exécute ; un onglet resté ouvert depuis trois jours porte
 *      l'ancienne. Faire remonter la version par le client, ce serait
 *      mesurer l'âge des onglets.
 *   2. UN SEUL PARAMÈTRE TRAVERSE LE RÉSEAU — l'identifiant
 *      d'installation. Tout le reste est décidé côté serveur, donc rien
 *      d'autre ne peut être falsifié depuis la console du navigateur.
 *   3. LA SESSION EST DÉJÀ LÀ, dans un cookie `httpOnly` que `proxy.ts`
 *      rafraîchit à chaque requête. `auth.uid()` est donc juste sans
 *      qu'on ait à manipuler un jeton.
 *
 * CE QU'ELLE NE FAIT PAS, ET C'EST VOULU :
 *   • elle ne prend AUCUN identifiant d'utilisateur. Comme
 *     `declare_mobile_presence` (0077 §4), la seule identité qu'elle
 *     connaisse est celle du jeton en cours ;
 *   • elle ne rend rien — il n'y a rien à attendre d'elle ;
 *   • elle ne lit ni en-tête, ni adresse, ni `user-agent`. Tout cela
 *     est disponible ici en une ligne, et c'est précisément pour cela
 *     qu'il faut écrire qu'on n'en veut pas.
 */
export async function declareWebPresence(installId: string): Promise<void> {
  const presence: WebPresence = {
    installId,
    platform: WEB_PLATFORM,
    ...webRelease(),
  };

  await declareQuietly(async (declared) => {
    const supabase = await createClient();

    const { error } = await supabase.rpc(PRESENCE_RPC, {
      p_install_id: declared.installId,
      p_platform: declared.platform,
      p_app_version: declared.appVersion,
      p_app_build: declared.appBuild,
    });

    // `rpc` ne lève pas : elle rend l'erreur. On la relance pour que
    // `declareQuietly` soit le SEUL endroit qui décide du silence —
    // deux façons d'ignorer une panne, c'est une de trop pour qu'on
    // sache encore laquelle s'applique.
    if (error) throw error;
  }, presence);
}
