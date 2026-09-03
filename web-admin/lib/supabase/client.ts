import { createBrowserClient } from "@supabase/ssr";

/**
 * Le SEUL client Supabase du navigateur, et il ne sert qu'à UNE chose :
 * la page de connexion (`app/login/page.tsx`).
 *
 * POURQUOI IL EXISTE. `signInWithOtp` et `signInWithOAuth` doivent
 * partir du navigateur : le premier a besoin de l'origine pour
 * construire le lien de retour, le second doit pouvoir naviguer vers le
 * fournisseur. Il n'y a pas d'équivalent serveur qui rende la main au
 * bon endroit.
 *
 * POURQUOI IL NE SERT À RIEN D'AUTRE. Aucun écran du Control Center ne
 * lit de données depuis le navigateur. Les lectures d'administration
 * traversent toutes les organisations ; elles passent donc par les
 * fonctions `security definer` de 0075, appelées depuis un Server
 * Component avec la session de l'administrateur. Un composant client
 * qui appellerait `supabase.rpc('admin_list_users', …)` fonctionnerait
 * — la fonction contrôle l'appelant — mais il mettrait la réponse
 * complète, pagination et total compris, dans le bundle du navigateur
 * et dans l'onglet Réseau de n'importe qui. `R5 : des nombres, pas des
 * lignes` se tient plus facilement quand les lignes ne quittent jamais
 * le serveur.
 *
 * La clé publishable est faite pour être publique. `service_role` ne
 * l'est pas, n'est jamais préfixée `NEXT_PUBLIC_`, et n'apparaît nulle
 * part dans ce fichier ni dans aucun autre fichier joignable depuis le
 * navigateur — voir `lib/supabase/admin.ts`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
