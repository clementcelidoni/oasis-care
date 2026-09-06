import { createClient } from "@/lib/supabase/server";
import { LecteurSupabase } from "./lecteur-supabase.ts";
import { obtenirPortEmail } from "./port.ts";
import { messageDe, surDevisEnvoye, surFactureEmise } from "./declencheurs.ts";
import { envoyerRelancesDues, type BilanRelances } from "./relances.ts";
import type { Dependances } from "./declencheurs.ts";
import type { ResultatEnvoi } from "./port.ts";

/**
 * RÉEXPORTÉE ICI POUR QUE LES ACTIONS N'AIENT QU'UNE SEULE ADRESSE.
 *
 * Une action de devis ou de facture importe `dependances` et rien
 * d'autre du dossier. C'est vérifié par une épreuve
 * (`frontiere-ia.test.ts`), et ce n'est pas de la coquetterie : le jour
 * où une action se remet à importer `port.ts` directement, elle
 * recommence à câbler — et c'est en câblant qu'on finit par laisser
 * remonter une exception jusqu'à la facture.
 */
export { phrasePourEcran } from "./declencheurs.ts";
export type { ResultatEnvoi } from "./port.ts";

/**
 * §EMAILS — LE CÂBLAGE, ET LA SEULE PORTE QUE LES ACTIONS CONNAISSENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE SÉPARÉMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Deux raisons, et elles tirent dans le même sens.
 *
 *   1. `declencheurs.ts` et `relances.ts` n'importent que des TYPES et
 *      leurs voisins. Ils ne connaissent ni `next/headers`, ni le
 *      client Supabase, ni `@/`. C'est ce qui permet à leurs épreuves
 *      de tourner sous `node --test` sans crochet d'alias, sans
 *      contexte de requête et sans réseau. Tout le câblage est ici, et
 *      aucune épreuve n'importe ce fichier.
 *
 *   2. LES ACCROCHES DANS LES ACTIONS DE DEVIS ET DE FACTURE DOIVENT
 *      TENIR EN UNE LIGNE. Plus l'accroche est courte, moins elle
 *      risque d'emporter avec elle le geste métier qu'elle accompagne.
 *      `declencherDevisEnvoye` et `declencherFactureEmise` ne prennent
 *      que ce que l'action a déjà sous la main, et ne rendent qu'un
 *      résultat à lire.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUNE DE CES FONCTIONS NE LÈVE. C'EST LEUR CONTRAT.
 * ══════════════════════════════════════════════════════════════════
 *
 * Y COMPRIS À LA CONSTRUCTION. `createClient()` peut échouer — cookies
 * indisponibles, variables d'environnement absentes — et cet échec ne
 * doit pas empêcher une facture de s'émettre. C'est pourquoi le
 * `try` englobe la construction des dépendances et pas seulement
 * l'envoi : la version évidente, qui construit d'abord puis protège
 * l'appel, laisse passer exactement l'erreur qu'on croyait avoir
 * couverte.
 */

async function construire(): Promise<Dependances> {
  const supabase = await createClient();

  // LE JETON DE LA SESSION, POUR QUE LA MACHINE LISE SOUS RLS.
  //
  // `getSession()` plutôt que `getUser()`, et ce n'est PAS l'exception
  // à la règle du dépôt : on ne s'en sert pas pour AUTORISER quoi que
  // ce soit ici — la page appelante a déjà vérifié l'utilisateur. On a
  // besoin du jeton lui-même, que `getUser()` ne rend pas, pour le
  // transmettre à la machine. C'est ELLE, et la base derrière elle, qui
  // le vérifient : un jeton forgé n'ouvrirait rien de plus qu'une
  // requête PostgREST forgée.
  let jeton: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    jeton = data.session?.access_token ?? null;
  } catch {
    // Pas de session lisible : le port le dira avec une phrase, et le
    // geste métier continuera.
    jeton = null;
  }

  return {
    lecteur: new LecteurSupabase(supabase),
    // Reconstruit à chaque appel — pas de cache de module. Une variable
    // d'environnement posée sur l'hébergeur doit prendre effet au
    // déploiement suivant, pas au redémarrage suivant d'un processus
    // qu'on ne contrôle pas. Même raison que `getBillingProvider()`.
    port: obtenirPortEmail(jeton),
  };
}

/**
 * Le devis vient d'être marqué « envoyé » par un humain.
 * Appelée depuis `lib/quotes/actions.ts`, après l'écriture et l'audit.
 */
export async function declencherDevisEnvoye(
  organizationId: string, quoteId: string,
): Promise<ResultatEnvoi> {
  try {
    return await surDevisEnvoye(await construire(), { organizationId, quoteId });
  } catch (erreur) {
    return { etat: "erreur", raison: messageDe(erreur) };
  }
}

/**
 * La facture vient d'être émise : `issue_invoice()` a posé `issued_at`.
 * Appelée depuis `lib/finance/actions.ts`, après l'écriture et l'audit.
 */
export async function declencherFactureEmise(
  organizationId: string, invoiceId: string,
): Promise<ResultatEnvoi> {
  try {
    return await surFactureEmise(await construire(), { organizationId, invoiceId });
  } catch (erreur) {
    return { etat: "erreur", raison: messageDe(erreur) };
  }
}

/**
 * ARRÊTER LES MESSAGES QUI ATTENDENT ENCORE POUR UN DOCUMENT.
 *
 * Appelée quand on annule une facture ou un devis. Rend le nombre de
 * messages arrêtés — zéro la plupart du temps, parce que la plupart des
 * messages sont partis dans la seconde.
 *
 * ELLE NE LÈVE PAS, comme tout ce dossier : annuler une facture ne doit
 * pas échouer parce qu'un courriel n'a pas pu être arrêté.
 *
 * `email_cancel_queued` est ouverte aux membres de l'entreprise (0084
 * § 12.b) précisément pour cet appel : il tourne sous le jeton du
 * paysagiste, qui n'a aucune clé de service.
 */
export async function annulerCourrierEnAttente(
  organizationId: string,
  typeObjet: "quote" | "invoice",
  objetId: string,
  motif = "Le document a été annulé avant que le message ne parte.",
): Promise<number> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("email_cancel_queued", {
      p_organization_id: organizationId,
      p_entity_type: typeObjet,
      p_entity_id: objetId,
      p_reason: motif,
    });
    // La migration 0084 peut ne pas être appliquée : la fonction
    // n'existe alors pas, et il n'y a de toute façon aucun message à
    // arrêter.
    if (error) return 0;
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

/**
 * Le passage de relances, pour une entreprise.
 *
 * PERSONNE NE L'APPELLE AUTOMATIQUEMENT AUJOURD'HUI, et il faut le lire
 * comme tel : aucun ordonnanceur n'existe dans ce projet. La route POST
 * voisine est le seul appelant, et elle-même attend qu'on la branche.
 */
export async function passerLesRelances(
  organizationId: string, maintenant?: Date,
): Promise<BilanRelances> {
  try {
    return await envoyerRelancesDues(await construire(), { organizationId, maintenant });
  } catch (erreur) {
    return {
      organizationId,
      raisonInactive: null,
      misEnFile: 0, dejaParti: 0, refuse: 0, indisponible: 0, erreur: 1,
      details: [{ reference: "(câblage)", resultat: { etat: "erreur", raison: messageDe(erreur) } }],
    };
  }
}
