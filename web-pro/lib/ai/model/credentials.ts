import type { SourceEnvironnement } from "./configuration.ts";

/**
 * §11V — OÙ SE LIT LA CLÉ OPENAI, ET RIEN D'AUTRE.
 *
 * Un fichier de trois lignes utiles, isolé pour une raison précise : le
 * contrôle de disponibilité (`availability.ts`) a besoin de savoir s'il
 * y a une clé, et il ne doit PAS pour autant charger `@openai/agents` —
 * soixante-six mégaoctets de dépendances pour répondre « oui » ou
 * « non ». Mettre cette lecture dans `provider.ts` aurait suffi à
 * tirer tout le SDK dans un écran d'administration.
 *
 * LA RÈGLE DE LA SPEC p. 21, EN UNE LIGNE DE CODE : le nom de la
 * variable n'a PAS de préfixe `NEXT_PUBLIC_`. C'est ce détail, et lui
 * seul, qui empêche Next.js de recopier le secret dans le paquet
 * JavaScript envoyé à chaque visiteur.
 *
 * Rien ici ne rend la clé à l'extérieur autrement que pour l'appel
 * lui-même. Aucune fonction ne l'affiche, ne la tronque, ne la
 * journalise.
 */

/**
 * Le nom de la variable qui porte la clé.
 *
 * Volontairement le nom standard du SDK OpenAI : deux noms pour un même
 * secret, c'est un secret posé deux fois et retiré une seule.
 */
export const VARIABLE_CLE_OPENAI = "OPENAI_API_KEY";

/**
 * La clé, ou `undefined`.
 *
 * Une variable présente mais vide vaut absente : c'est le cas typique
 * d'un `OPENAI_API_KEY=` laissé dans un fichier d'environnement, et le
 * traiter comme une clé produirait un 401 incompréhensible au lieu d'un
 * « aucune clé configurée » qui dit quoi faire.
 */
export function lireCleOpenAI(env: SourceEnvironnement = process.env): string | undefined {
  const brut = env[VARIABLE_CLE_OPENAI];
  if (typeof brut !== "string") return undefined;
  const valeur = brut.trim();
  return valeur.length > 0 ? valeur : undefined;
}
