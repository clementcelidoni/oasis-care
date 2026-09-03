import { NIVEAUX_MODELE, type NiveauModele } from "../model/types.ts";
import type { PortRoutage } from "../runtime/run.ts";
import { cleSqlDeLAgent, type CleAgentSql } from "./types.ts";

/**
 * §11V — RENDRE UNE SURCHARGE D'ENTREPRISE EFFECTIVE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE : UN BOUTON QUI N'AGIT PAS EST UN BOUTON
 * QUI MENT
 * ══════════════════════════════════════════════════════════════════
 *
 * L'écran `/parametres/ia` écrit dans `ai_model_overrides` (0076). Un
 * sélecteur qui range une ligne que personne ne consulte serait
 * précisément le « bouton menteur » que ce dépôt refuse ailleurs : un
 * administrateur croirait avoir déplacé Finance sur le modèle avancé,
 * et rien n'aurait bougé.
 *
 * `OasisAgentRunner` prend son routeur par un PORT étroit
 * (`PortRoutage` : `resolve` + `modelePourNiveau`). La décoration tient
 * donc en une fonction pure, et le branchement en une ligne — celle de
 * `runnerAgents()` (`lib/ai/runtime/supabase.ts`), qui reçoit la carte
 * lue par `lireSurchargesModeles()` à chaque requête :
 *
 *     routeur: appliquerSurcharges(routeur, surcharges, routeur.modelesConfigures())
 *
 * La lecture est refaite à CHAQUE requête, sans mémorisation entre deux
 * : la carte appartient à une entreprise, et un routeur décoré qui
 * survivrait à la requête servirait l'aiguillage de l'un à l'autre.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA SURCHARGE PORTE UN IDENTIFIANT, PAS UN NIVEAU
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_model_overrides.model` est du texte libre, et la migration
 * explique pourquoi : SQL ne doit connaître aucun nom de modèle. Quand
 * l'identifiant surchargé correspond encore à l'un des trois niveaux
 * configurés, on déplace AUSSI le niveau — sans quoi la décision de
 * routage porterait un niveau et un modèle en désaccord, et le grand
 * livre rangerait la dépense au mauvais étage.
 *
 * Quand il ne correspond à aucun — le cas de la surcharge qui a décroché,
 * décrit dans `carte.ts` — on laisse le niveau tel quel et on l'écrit
 * dans les raisons. Deviner un niveau ferait disparaître l'anomalie.
 */

/** Les surcharges d'une entreprise : agent SQL → identifiant de modèle. */
export type SurchargesEffectives = ReadonlyMap<CleAgentSql, string>;

/**
 * Le routeur du processus, vu à travers les surcharges d'une entreprise.
 *
 * `modelePourNiveau` n'est PAS surchargé : il répond « quel identifiant
 * pour ce niveau », une question qui ne dépend d'aucune entreprise. Le
 * repli (`fallback.ts`) s'en sert pour descendre d'un cran, et il doit
 * descendre sur le modèle du produit, pas sur une surcharge posée pour
 * un autre agent.
 */
export function appliquerSurcharges(
  base: PortRoutage,
  surcharges: SurchargesEffectives,
  modelesConfigures: Readonly<Record<NiveauModele, string>>,
): PortRoutage {
  if (surcharges.size === 0) return base;

  const niveauDuModele = new Map<string, NiveauModele>();
  for (const niveau of NIVEAUX_MODELE) niveauDuModele.set(modelesConfigures[niveau], niveau);

  return {
    modelePourNiveau: (niveau) => base.modelePourNiveau(niveau),
    resolve(contexte) {
      const decision = base.resolve(contexte);
      if (decision.agent === null) return decision;

      const cleSql = cleSqlDeLAgent(decision.agent);
      if (cleSql === null) return decision;

      const impose = surcharges.get(cleSql);
      if (impose === undefined || impose === decision.modele) return decision;

      const niveau = niveauDuModele.get(impose) ?? null;

      return {
        ...decision,
        modele: impose,
        niveau: niveau ?? decision.niveau,
        raisons: [
          ...decision.raisons,
          niveau === null
            ? `Surcharge de l'entreprise : « ${impose} », qui ne correspond à aucun des trois identifiants configurés. Le niveau annoncé reste « ${decision.niveau} » et ne décrit donc plus le modèle appelé.`
            : `Surcharge de l'entreprise pour « ${decision.agent} » : ${niveau} (« ${impose} »).`,
        ],
      };
    },
  };
}
