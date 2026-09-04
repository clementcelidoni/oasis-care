import { CHOIX_PRODUIT, estChoix, identifiantPourChoix, niveauDeLIdentifiant } from "./carte.ts";
import {
  AGENTS_SURCHARGEABLES,
  CLE_SQL_AGENT,
  LIBELLES_AGENT,
  LIBELLES_NIVEAU,
  type EtatRouteur,
} from "./modeles.ts";
import type { LigneSurcharge } from "./types.ts";

/**
 * ==================================================================
 * CE QU'ON VA ÉCRIRE, DÉCIDÉ AVANT D'ÉCRIRE QUOI QUE CE SOIT
 * ==================================================================
 *
 * Ce module ne parle ni à la base ni à Next : il transforme ce qu'un
 * formulaire a envoyé, plus l'état lu en base, en une LISTE DE GESTES.
 * `actions.ts` se contente ensuite de les jouer.
 *
 * ─── POURQUOI IL EXISTE SÉPARÉMENT ───
 *
 * Deux raisons, et la seconde est la vraie.
 *
 *   1. `actions.ts` porte `"use server"` : il ne peut exporter que des
 *      fonctions asynchrones, donc rien qu'un test puisse appeler
 *      simplement. Le seul chemin d'ÉCRITURE de la surface IA du
 *      Control Center n'avait, de ce fait, aucun test.
 *
 *   2. Chaque agent part dans SA propre fonction SQL, donc dans SA
 *      propre transaction. Il n'existe aucun moyen d'annuler les
 *      premières écritures quand la troisième échoue. La seule
 *      protection possible est donc de ne commencer à écrire QUE
 *      lorsque les quatre champs ont été lus et compris — et c'est
 *      exactement ce que fait cette fonction. Une validation faite à
 *      l'intérieur de la boucle d'écriture produisait, elle, un
 *      « aucun changement n'a été enregistré » alors que deux agents
 *      venaient de changer et d'être journalisés.
 *
 * Une Server Action est une URL : on peut lui poster un formulaire
 * amputé sans jamais ouvrir l'écran. Le cas n'est pas théorique.
 */

/** Un geste à jouer sur un agent, une fois toutes les lectures faites. */
export type Changement =
  | { agent: string; cleSql: string; geste: "lever" }
  | { agent: string; cleSql: string; geste: "imposer"; modele: string; niveau: string };

export type Plan =
  | { statut: "ok"; changements: readonly Changement[] }
  | { statut: "erreur"; message: string };

/** Ce que le plan a besoin de savoir du formulaire, et rien de plus. */
export type LectureChamp = (nom: string) => unknown;

/**
 * Décide, pour les quatre agents surchargeables, ce qu'il faut écrire.
 *
 * SEULS LES AGENTS QUI CHANGENT SONT RETENUS. Réécrire une valeur
 * identique ferait une ligne de journal qui n'apprend rien, et
 * déplacerait `updated_at` — donc effacerait la date du vrai dernier
 * changement, qui est souvent l'information qu'on cherche.
 *
 * UN SEUL CHAMP ILLISIBLE ET LE PLAN ENTIER EST REFUSÉ. C'est le point
 * du module : mieux vaut ne rien faire que faire la moitié.
 */
export function planifierChangements(
  etatRouteur: EtatRouteur,
  surcharges: readonly LigneSurcharge[],
  lire: LectureChamp,
): Plan {
  const parAgentSql = new Map(surcharges.map((ligne) => [ligne.agent, ligne]));
  const changements: Changement[] = [];

  for (const agent of AGENTS_SURCHARGEABLES) {
    const cleSql = CLE_SQL_AGENT[agent];
    if (cleSql === undefined) continue;

    const brut = lire(`agent.${cleSql}`);
    if (!estChoix(brut)) {
      return {
        statut: "erreur",
        message: `Choix illisible pour l'agent « ${LIBELLES_AGENT[agent]} ». Aucun changement n'a été enregistré.`,
      };
    }

    const existante = parAgentSql.get(cleSql) ?? null;
    const choixActuel =
      existante === null
        ? CHOIX_PRODUIT
        : (niveauDeLIdentifiant(etatRouteur, existante.model) ?? null);

    // `choixActuel === null` = surcharge DÉCROCHÉE : elle ne correspond
    // à aucune option de l'écran, donc TOUT choix est un changement, y
    // compris celui qui porte le même nom que son niveau supposé. Sans
    // cela, une entreprise restée accrochée à un identifiant disparu
    // n'aurait aucun moyen d'en sortir depuis le formulaire.
    if (choixActuel !== null && choixActuel === brut) continue;

    if (brut === CHOIX_PRODUIT) {
      changements.push({ agent: LIBELLES_AGENT[agent], cleSql, geste: "lever" });
      continue;
    }

    const modele = identifiantPourChoix(etatRouteur, brut);
    if (modele === null) {
      // Impossible en pratique — `estChoix` a déjà écarté le reste —
      // mais on ne construit pas un appel d'écriture sur un « ne devrait
      // pas arriver ».
      return {
        statut: "erreur",
        message:
          `Aucun identifiant de modèle ne correspond au niveau demandé pour « ${LIBELLES_AGENT[agent]} ». ` +
          "Aucun changement n'a été enregistré.",
      };
    }

    changements.push({
      agent: LIBELLES_AGENT[agent],
      cleSql,
      geste: "imposer",
      modele,
      niveau: LIBELLES_NIVEAU[brut],
    });
  }

  return { statut: "ok", changements };
}

/**
 * La phrase rendue à l'opérateur.
 *
 * L'ÉCHEC SE DIT AVEC CE QUI A RÉUSSI, JAMAIS SANS. Un message qui ne
 * nommerait que l'agent en défaut laisserait croire que les autres
 * n'ont pas bougé, alors qu'ils sont déjà écrits ET journalisés — et
 * c'est précisément l'état silencieux contre lequel la migration 0080
 * a été écrite.
 */
export function raconter(
  faits: readonly string[],
  echecs: readonly string[],
): { statut: "ok" | "erreur"; message: string } {
  if (faits.length === 0 && echecs.length === 0) {
    return {
      statut: "ok",
      message:
        "Aucun changement : les quatre agents portaient déjà ces niveaux. Rien n'a été écrit, et le journal reste intact.",
    };
  }

  const resume = `${faits.length} changement${faits.length > 1 ? "s" : ""} enregistré${faits.length > 1 ? "s" : ""} et journalisé${faits.length > 1 ? "s" : ""} : ${faits.join(" ; ")}.`;

  if (echecs.length === 0) return { statut: "ok", message: resume };

  return {
    statut: "erreur",
    message:
      faits.length === 0
        ? `${echecs.join(" ")} Aucun changement n'a été enregistré.`
        : `${echecs.join(" ")} ATTENTION : le reste EST passé — ${resume}`,
  };
}
