// Oasis Care — Chantier Stripe. LES DÉCLARATIONS DE VÉRIFICATION.
//
// CE FICHIER NE PART PAS EN PRODUCTION ET N'EST IMPORTÉ PAR PERSONNE.
// Il n'existe que pour que `tsc` puisse vérifier `index.ts` sur un
// poste sans Deno et sans réseau.
//
// LE PROBLÈME QU'IL RÈGLE. `index.ts` est le seul fichier du dossier
// qu'aucun test ne couvre : c'est le câblage — les octets,
// l'environnement, la base. Il importe `@supabase/supabase-js` depuis
// un CDN et emploie le global `Deno`, deux choses que `tsc` ne sait pas
// résoudre ici. Sans ces déclarations, il resterait ENTIÈREMENT non
// vérifié : ni test, ni typage. Un simple nom de méthode mal
// orthographié dans `porteSupabase()` ne se découvrirait qu'en
// production, sur un vrai paiement.
//
// CE QU'IL VÉRIFIE VRAIMENT, ET CE QU'IL NE VÉRIFIE PAS. Le client
// Supabase est typé LARGEMENT : ce n'est pas lui qu'on éprouve, et
// prétendre le contraire serait pire que de ne rien déclarer. Ce que le
// typage attrape ici, c'est la CONFORMITÉ de `porteSupabase()` à
// `PorteBase` — les huit méthodes, leurs arguments, leurs types de
// retour. C'est précisément le raccord entre la partie non testée et la
// partie testée, donc l'endroit où une erreur passerait inaperçue.
//
// Ce qu'il ne remplace pas : la vérification que les NOMS des fonctions
// SQL et de leurs paramètres correspondent à 0083. Aucun typage ne peut
// le faire — ils sont des chaînes. Ils ont été relus un par un contre
// la migration, et c'est le premier endroit à regarder si un
// encaissement échoue en essai.

declare namespace Deno {
  export function serve(gestionnaire: (requete: Request) => Response | Promise<Response>): unknown;
  export const env: { get(nom: string): string | undefined };
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  /**
   * Volontairement large. La forme exacte du constructeur de requêtes
   * de PostgREST n'est pas ce qu'on cherche à éprouver ici, et la
   * décrire à moitié donnerait une fausse assurance.
   */
  // deno-lint-ignore no-explicit-any
  export type SupabaseClient = any;
  export function createClient(
    url: string,
    cle: string,
    options?: Record<string, unknown>,
  ): SupabaseClient;
}
