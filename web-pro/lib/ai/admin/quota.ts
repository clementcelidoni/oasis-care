import { createClient } from "@/lib/supabase/server";
// LE PLAFOND DE QUESTIONS VIT CHEZ CELUI QUI LE CONSOMME.
// `consommerQuota()` (app/api/oasis-ai/identite.ts) passe cette valeur à
// `consume_pro_ai_quota` (0058) à chaque question posée. La recopier ici
// donnerait deux plafonds, dont un finirait par mentir à l'écran pendant
// que l'autre coupe réellement.
//
// C'est aussi la raison d'être de ce fichier : cet import ne doit pas
// entrer dans `lecture.ts`, que les écrans de décision d'Oasis AI
// importent pour tout autre chose.
import { QUESTIONS_PAR_MOIS } from "@/app/api/oasis-ai/identite";
import { compteur } from "@/lib/ai/runtime/types";
import { classer, type Lecture } from "./lecture.ts";

/**
 * §11X — OÙ EN EST L'ENTREPRISE DE SON FORFAIT DE QUESTIONS (0058).
 *
 * ══════════════════════════════════════════════════════════════════
 * LA SEULE BORNE QUE LE CLIENT A LE DROIT DE CONNAÎTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Deux limites existent au-dessus d'Oasis AI, et elles ne regardent pas
 * les mêmes gens :
 *
 *   `ai_cost_limits` (0076) borne une DÉPENSE en centimes. Elle borne
 *   la facture que l'ÉDITEUR reçoit du fournisseur, et depuis la
 *   migration 0080 seul un administrateur de plateforme peut la poser.
 *   Son montant n'a rien à faire sous les yeux du client — pas plus
 *   qu'un prix d'achat ne figure sur un devis.
 *
 *   `ai_pro_usage` (0058) compte des QUESTIONS par entreprise et par
 *   mois. C'est la borne de l'abonnement, celle qui arrête le travail
 *   d'un salarié un mardi après-midi. Le client doit la voir, et la
 *   voir AVANT de l'atteindre.
 *
 * Jusqu'ici il ne la voyait pas : l'accueil d'Oasis affichait « N
 * question(s) posées ce mois-ci », un nombre sans dénominateur, et le
 * plafond ne se découvrait qu'au refus. C'est l'ordre inverse de ce
 * qu'il faut.
 *
 * ─── CE QUE CE FICHIER NE PRÉTEND PAS CORRIGER ───
 *
 * Le plafond est une CONSTANTE TypeScript. Ni l'éditeur ni le client ne
 * peut le changer sans redéploiement, alors que 0058 annonçait déjà
 * qu'il « sera remplacé le jour où Pro aura ses formules ». Sa place est
 * dans le Control Center, par formule d'abonnement. C'est signalé, pas
 * fait — et surtout pas contourné par un second nombre écrit ici.
 */

export type QuotaAssistant = {
  /** Les questions déjà posées ce mois-ci. */
  posees: number;
  /** Le plafond mensuel. */
  plafond: number;
  /** Ce qu'il reste. Jamais négatif : le compteur continue au-delà du plafond. */
  restant: number;
  /** La part consommée, en pourcentage entier, bornée à 100 pour la barre. */
  partPct: number;
  /** Le mois compté, au format `YYYY-MM`. */
  periode: string;
};

/**
 * ─── LE MOIS EST CELUI D'UTC, ET C'EST VOULU ───
 *
 * `consume_pro_ai_quota` (0058) range le compteur sous
 * `to_char(now() at time zone 'utc', 'YYYY-MM')`. C'est l'écrivain qui
 * fait la clé ; un lecteur qui compterait le mois autrement — en heure
 * de Paris, par exemple — ne trouverait rien pendant les une ou deux
 * premières heures de chaque mois, et afficherait « 0 question » à une
 * entreprise dont le compteur tourne encore sous le mois précédent.
 *
 * Le décalage lui-même est un vrai défaut du socle : le 1ᵉʳ du mois
 * entre minuit et deux heures, heure de Paris, une question est encore
 * imputée au mois d'avant. Il se corrige dans la fonction SQL, pas dans
 * un écran — et surtout pas dans un écran seul, qui divergerait alors du
 * compteur qui coupe réellement.
 */
export async function lireQuotaAssistant(
  organizationId: string,
  maintenant: Date = new Date(),
): Promise<Lecture<QuotaAssistant>> {
  const periode = maintenant.toISOString().slice(0, 7);
  const vide: QuotaAssistant = {
    posees: 0,
    plafond: QUESTIONS_PAR_MOIS,
    restant: QUESTIONS_PAR_MOIS,
    partPct: 0,
    periode,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_pro_usage")
    .select("used")
    .eq("organization_id", organizationId)
    .eq("period", periode)
    .maybeSingle();

  if (error) {
    const { etat, message } = classer(error);
    return { etat, message, donnees: vide };
  }

  // Aucune ligne = aucune question posée ce mois-ci. C'est un vrai zéro,
  // et il se distingue d'une lecture en échec, traitée juste au-dessus.
  if (data === null) return { etat: "lue", message: null, donnees: vide };

  const r = data as unknown as Record<string, unknown>;
  // `compteur` et non `?? 0` : `used` est un `int not null`, mais il
  // arrive par PostgREST en `unknown`, et un `?? 0` sur une valeur
  // illisible afficherait « aucune question posée » à une entreprise qui
  // vient d'épuiser son forfait.
  const posees = compteur(r.used);

  return {
    etat: "lue",
    message: null,
    donnees: {
      posees,
      plafond: QUESTIONS_PAR_MOIS,
      restant: Math.max(QUESTIONS_PAR_MOIS - posees, 0),
      partPct: Math.min(100, Math.round((posees / QUESTIONS_PAR_MOIS) * 100)),
      periode,
    },
  };
}
