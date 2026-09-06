// Oasis Care — Les relances. LES DÉCLARATIONS DE VÉRIFICATION.
//
// CE FICHIER NE PART PAS EN PRODUCTION ET N'EST IMPORTÉ PAR PERSONNE.
// Il n'existe que pour que `tsc` puisse vérifier `index.ts` sur un poste
// sans Deno et sans réseau.
//
// LE PROBLÈME QU'IL RÈGLE. `index.ts` est le seul fichier du dossier
// qu'aucun test ne couvre : c'est le câblage — l'HTTP, l'environnement,
// la base. Il importe le client Supabase depuis un CDN et emploie le
// global `Deno`, deux choses que `tsc` ne sait pas résoudre ici. Sans
// ces déclarations il resterait ENTIÈREMENT non vérifié : ni test, ni
// typage.
//
// CE QU'IL VÉRIFIE VRAIMENT. La CONFORMITÉ de `porteSupabase()` à
// `PorteFile` et celle de l'expéditeur à `Expediteur` — c'est-à-dire le
// raccord entre la partie non testée et la partie testée. Et, parce que
// `Issue` et `OrdreEnvoi` sont importés de `envoi-email`, il attrape
// aussi le jour où ce voisin change la forme de ses issues : un nouvel
// état d'envoi ferait échouer le `switch` exhaustif de
// `traitement.ts` ici, et non en production sur une vraie relance.
//
// CE QU'IL NE REMPLACE PAS : la vérification que les NOMS des fonctions
// SQL et de leurs paramètres correspondent à 0089. Aucun typage ne peut
// le faire — ce sont des chaînes. Ils ont été relus un par un contre la
// migration (`relances_a_expedier(p_limit, p_worker)`,
// `relance_marquer_faite(p_id, p_email_message_id, p_motif_abandon)`),
// et c'est le premier endroit à regarder si une relance ne part pas.

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
   * `unknown`, et pour la même raison que chez le voisin : les trois
   * fonctions de 0089 employées ici ne rendent pas la même forme. Une
   * TABLE pour `relances_a_expedier`, un BOOLÉEN pour
   * `relance_marquer_faite`. Un type figé sur « un tableau de lignes »
   * ferait échouer la vérification là où le code lit justement le
   * booléen — et c'est ce booléen qui distingue « la ligne est
   * terminée » de « la ligne l'était déjà, quelqu'un d'autre l'a
   * prise ».
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
