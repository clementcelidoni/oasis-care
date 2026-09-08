/**
 * §PÉAGE — CE QUE L'ÉCRAN SAIT DU CONTRAT, ET CE QU'IL EN DIT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * La migration 0092 pose une barrière dans la base : sans contrat, on
 * ne crée plus de client, plus de devis, plus de facture. La barrière
 * est juste, mais elle parle POSTGRES. Sans ce fichier, un paysagiste
 * dont le prélèvement a échoué cliquait « Enregistrer » et recevait,
 * au mieux :
 *
 *     new row violates row-level security policy "Péage — création"
 *     for table "crm_customers"
 *
 * au pire une page d'erreur générique de Next.js en production, qui
 * masque même ce message-là. Il n'aurait aucun moyen de comprendre
 * qu'il s'agit d'une facture impayée, ni où aller la régler. Un refus
 * qu'on ne sait pas présenter est indiscernable d'une panne — et on
 * n'appelle pas le service commercial pour une panne, on râle.
 *
 * CE FICHIER NE RÉIMPLÉMENTE AUCUNE RÈGLE. Il appelle
 * `peage_situation()`, qui appelle elle-même les deux fonctions de
 * décision de 0092. Une seconde règle écrite ici finirait par diverger
 * de celle de la base, et l'écart se verrait au pire moment : l'écran
 * dirait « tout va bien » pendant que la base refuse.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Les quatre états du péage (migration 0092 § 1). */
export type EtatPeage = "ouvert" | "sursis" | "restreint" | "transit";

const ETATS: EtatPeage[] = ["ouvert", "sursis", "restreint", "transit"];

export type SituationPeage = {
  etat: EtatPeage;
  /** Créer, modifier, envoyer à un tiers. Ouvert en sursis. */
  peutExploiter: boolean;
  /** Faire entrer un collègue. Se ferme dès le sursis. */
  peutGrandir: boolean;
  /** Depuis quand une facture Oasis est échue et non réglée. */
  impayeDepuis: string | null;
  facturesEchues: number;
  montantDuCents: number;
  /** Jours restants avant que la production s'arrête. Nul hors sursis. */
  joursDeSursisRestants: number | null;
  finEssai: string | null;
  finPeriode: string | null;
};

type LigneBrute = Record<string, unknown>;

function nombre(valeur: unknown): number {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : 0;
}

function texteOuNul(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur !== "" ? valeur : null;
}

/**
 * L'ÉTAT DU CONTRAT, OU `null` QUAND ON NE SAIT PAS.
 *
 * ON NE DEVINE JAMAIS, ET ON NE FERME JAMAIS PAR DÉFAUT. Trois
 * situations rendent `null`, et aucune ne doit dégrader le produit :
 *
 *   • la migration 0092 n'est pas encore passée — la fonction n'existe
 *     pas, et le code déployé avant elle doit continuer de marcher ;
 *   • l'appelant n'est pas membre de cette entreprise — la fonction se
 *     garde elle-même et rend NULL, ce qui est sa façon de dire « ce
 *     n'est pas ton affaire » ;
 *   • la base est momentanément indisponible.
 *
 * Dans les trois cas, l'écran se tait au lieu d'inventer. C'est LA
 * BASE qui refuse ou laisse passer, pas cette lecture : au pire on
 * n'aura pas prévenu, jamais on n'aura bloqué à tort.
 */
export async function lireSituationPeage(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<SituationPeage | null> {
  const { data, error } = await supabase.rpc("peage_situation", {
    p_organization_id: organizationId,
  });

  if (error || data === null || typeof data !== "object") return null;

  const ligne = data as LigneBrute;
  const etat = ETATS.find((valeur) => valeur === ligne.etat);
  if (etat === undefined) return null;

  const jours = ligne.joursDeSursisRestants;

  return {
    etat,
    // `!== false` et non `=== true` : une clé absente vaut « ouvert ».
    // Fermer sur un champ manquant reviendrait à laisser une lecture
    // d'écran décider d'un accès, ce qu'elle ne fait jamais.
    peutExploiter: ligne.peutExploiter !== false,
    peutGrandir: ligne.peutGrandir !== false,
    impayeDepuis: texteOuNul(ligne.impayeDepuis),
    facturesEchues: nombre(ligne.facturesEchues),
    montantDuCents: nombre(ligne.montantDuCents),
    joursDeSursisRestants: typeof jours === "number" && Number.isFinite(jours) ? jours : null,
    finEssai: texteOuNul(ligne.finEssai),
    finPeriode: texteOuNul(ligne.finPeriode),
  };
}
