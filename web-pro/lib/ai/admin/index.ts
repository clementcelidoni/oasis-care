/**
 * §11X — LA PORTE D'ENTRÉE DE LA CONSOMMATION IA, CÔTÉ CLIENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE DOSSIER A CHANGÉ DE MÉTIER
 * ══════════════════════════════════════════════════════════════════
 *
 * Il servait « AI Configuration » (spec p. 26) et le « Dashboard coût
 * IA » (p. 18-19) : le choix des modèles, les dérogations par
 * entreprise, le contrôle de disponibilité des identifiants, la grille
 * tarifaire et les plafonds de dépense en euros. Tout cela est le
 * métier de L'ÉDITEUR — c'est lui qui paie le fournisseur — et vit
 * désormais dans le Control Center. La migration 0080 l'a acté en
 * base : plus aucune écriture possible depuis Oasis Care Pro.
 *
 * Reste ici ce qui appartient au client, et rien d'autre :
 *
 *   • ce qu'il consomme — questions posées sur son forfait mensuel,
 *     appels, jetons, ventilation par agent, par personne, par
 *     décision, et les refus qui ont interrompu son IA ;
 *   • les retours 👍 / 👎 de ses équipes (p. 25) ;
 *   • le ROUTAGE lui-même — `routage.ts` et les clés d'agent de
 *     `types.ts` : le moteur reste dans Oasis Care Pro, seule
 *     l'interface de réglage est partie. `lib/ai/runtime/supabase.ts`
 *     en dépend à chaque requête.
 *
 * DEUX MODULES NE SONT PAS RÉEXPORTÉS ICI, pour la même raison qu'en
 * `lib/ai/runtime` :
 *
 *   `./lecture.ts` — il importe `@/lib/supabase/server`, donc
 *                    `next/headers`. Le réexporter ferait entrer la
 *                    session Next dans tout module qui ne veut qu'un
 *                    type.
 *
 *   `./actions.ts` — il porte `"use server"`. Réexporter une Server
 *                    Action à travers une barrière la rend joignable
 *                    depuis n'importe quel import du module ; les
 *                    écrans l'importent par son chemin, ce qui rend
 *                    visible qui appelle quoi.
 */

export {
  AGENTS_SQL,
  LIBELLES_AGENT,
  LIBELLES_AGENT_HORS_CATALOGUE,
  LIBELLES_PANNE_CLIENT,
  cleCatalogueDeLaCleSql,
  cleSqlDeLAgent,
  estCleAgentSql,
  libellePanneClient,
  nomAgentDuJournal,
  type CleAgentSql,
} from "./types.ts";

export {
  VOLUME_VIDE,
  agregerConsommation,
  debutDuJourParis,
  type AppelIA,
  type Consommation,
  type LignePanne,
  type LigneVentilation,
  type Volume,
} from "./consommation.ts";

export {
  appliquerSurcharges,
  type SurchargesEffectives,
} from "./routage.ts";
