// Oasis Care — Chantier courriel. LES DÉCLARATIONS DE VÉRIFICATION.
//
// CE FICHIER NE PART PAS EN PRODUCTION ET N'EST IMPORTÉ PAR PERSONNE.
// Il n'existe que pour que `tsc` puisse vérifier `index.ts` sur un poste
// sans Deno et sans réseau.
//
// LE PROBLÈME QU'IL RÈGLE. `index.ts` est le seul fichier du dossier
// qu'aucun test ne couvre : c'est le câblage — l'HTTP, l'environnement,
// la base. Il importe le client Supabase depuis un CDN et emploie le
// global `Deno`, deux choses que `tsc` ne sait pas résoudre ici. Sans
// ces déclarations, il resterait ENTIÈREMENT non vérifié : ni test, ni
// typage. Un nom de méthode mal orthographié dans `porteSupabase()` ne
// se découvrirait qu'en production, sur un vrai devis.
//
// CE QU'IL VÉRIFIE VRAIMENT, ET CE QU'IL NE VÉRIFIE PAS. Le client
// Supabase est typé LARGEMENT : ce n'est pas lui qu'on éprouve, et
// prétendre le contraire serait pire que de ne rien déclarer. Ce que le
// typage attrape ici, c'est la CONFORMITÉ de `porteSupabase()` à
// `PorteBase` — les onze méthodes, leurs arguments, leurs types de
// retour. C'est le raccord entre la partie non testée et la partie
// testée, donc l'endroit où une erreur passerait inaperçue.
//
// Ce qu'il ne remplace pas : la vérification que les NOMS des fonctions
// SQL et de leurs paramètres correspondent à 0084. Aucun typage ne peut
// le faire — ce sont des chaînes. Ils ont été relus un par un contre la
// migration, et c'est le premier endroit à regarder si un envoi échoue.

declare namespace Deno {
  const env: { get(nom: string): string | undefined };
  function serve(gestionnaire: (requete: Request) => Response | Promise<Response>): unknown;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export type ReponsePostgrest<T> = { data: T | null; error: { message: string } | null };

  export type Constructeur = {
    select(colonnes: string): Constructeur;
    eq(colonne: string, valeur: unknown): Constructeur;
    order(colonne: string, options: { ascending: boolean }): Constructeur;
    limit(nombre: number): Constructeur;
    maybeSingle(): Promise<ReponsePostgrest<Record<string, unknown>>>;
    then<R>(
      surSucces: (valeur: ReponsePostgrest<Record<string, unknown>[]>) => R,
    ): Promise<R>;
  };

  /**
   * CE QUE REND UN APPEL DE FONCTION, ET POURQUOI C'EST `unknown`.
   *
   * Les fonctions de 0084 ne rendent pas toutes la même forme : une
   * table pour `email_claim_queued`, une ligne pour `email_enqueue`, un
   * BOOLÉEN pour `email_claim_one`, `email_mark_sent` et
   * `email_mark_failed`. Un type de retour figé sur « un tableau de
   * lignes » ferait échouer la vérification là où le code lit
   * justement un booléen — et c'est ce booléen qui distingue « le
   * message est parti » de « le message est parti et la base ne le sait
   * pas ». `unknown` oblige l'appelant à décider, ce qui est exactement
   * ce qu'on veut.
   */
  export type ConstructeurRpc = {
    maybeSingle(): Promise<ReponsePostgrest<Record<string, unknown>>>;
    then<R>(surSucces: (valeur: ReponsePostgrest<unknown>) => R): Promise<R>;
  };

  export type SupabaseClient = {
    from(table: string): Constructeur;
    rpc(nom: string, parametres?: Record<string, unknown>): ConstructeurRpc;
    storage: {
      from(bucket: string): { getPublicUrl(chemin: string): { data: { publicUrl: string } | null } };
    };
  };

  export function createClient(
    url: string,
    cle: string,
    options?: Record<string, unknown>,
  ): SupabaseClient;
}
