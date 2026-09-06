import type { LecteurEmail } from "./lecteur.ts";
import type { DemandeEnvoi, PortEmail, ResultatEnvoi } from "./port.ts";

/**
 * §EMAILS — LES DEUX ENVOIS QUI PARTENT SUR UN CHANGEMENT D'ÉTAT.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA FRONTIÈRE QUE CE FICHIER EXISTE POUR TENIR
 * ══════════════════════════════════════════════════════════════════
 *
 * UN CHANGEMENT D'ÉTAT DÉCLENCHE. UN MODÈLE, JAMAIS.
 *
 * Ce n'est pas une nuance de vocabulaire, c'est la règle du produit.
 * « La facture vient d'être émise, on l'expédie » est légitime : un
 * humain a cliqué sur « Émettre », un fait daté a été posé, et l'envoi
 * n'est que la conséquence mécanique de ce fait. « L'assistant pense
 * qu'il faudrait relancer ce client » ne l'est pas : personne n'a
 * décidé, et le destinataire recevrait un courrier qu'aucun humain n'a
 * voulu.
 *
 * TROIS CHOSES RENDENT CETTE FRONTIÈRE STRUCTURELLE PLUTÔT QUE
 * DÉCLARATIVE :
 *
 *   • le catalogue `email_templates` (0084) n'a pas de valeur `'ia'`
 *     dans `trigger_kind`. Un envoi décidé par un modèle ne peut pas
 *     être déclaré, donc ne peut pas exister ;
 *
 *   • ce module ne prend AUCUN texte en paramètre. Il prend un
 *     identifiant de devis et un identifiant de facture, relit les
 *     faits en base et n'invente rien. Un agent qui l'atteindrait ne
 *     pourrait toujours pas choisir ce qui est écrit ;
 *
 *   • `frontiere-ia.test.ts` vérifie sur les FICHIERS qu'aucun outil
 *     d'agent ne mène ici — la seule preuve qui survit à un
 *     copier-coller distrait.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET LA RÈGLE QUI COMPTE AUTANT : L'ENVOI NE FAIT JAMAIS ÉCHOUER LE
 * GESTE MÉTIER
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucune fonction de ce fichier ne lève. Jamais, quoi qu'il arrive :
 * transporteur absent, base injoignable, devis effacé entre deux
 * requêtes, réponse inattendue. Une facture qui refuserait de s'émettre
 * parce qu'un courriel a échoué serait un défaut grave — le paysagiste
 * perdrait son numéro de facture pour une raison qu'il ne comprendrait
 * pas, et il recommencerait, et la séquence aurait un trou.
 *
 * Le prix de cette garantie est que l'appelant doit LIRE le résultat au
 * lieu de compter sur une exception. C'est ce que font les deux actions
 * accrochées : elles affichent la phrase de `refuse` et laissent passer
 * le reste.
 */

export type Dependances = {
  lecteur: LecteurEmail;
  port: PortEmail;
};

/**
 * Le garde-fou commun aux quatre gabarits.
 *
 * Il ne fait qu'une chose : refuser proprement quand le port n'est pas
 * branché, sans même construire la demande. Sans lui, chaque appelant
 * aurait à se souvenir de tester `raisonIndisponible`, et l'un d'eux
 * l'oublierait.
 */
async function expedier(deps: Dependances, demande: DemandeEnvoi): Promise<ResultatEnvoi> {
  if (deps.port.raisonIndisponible !== null) {
    return { etat: "indisponible", raison: deps.port.raisonIndisponible };
  }
  return deps.port.mettreEnFile(demande);
}

/**
 * LES VARIABLES DU MESSAGE NE SONT PLUS FABRIQUÉES ICI.
 *
 * Elles l'étaient, et sous des noms que le gabarit ne connaissait pas :
 * `totalTtcCents` là où le catalogue attend `totalTtcCentimes`. La
 * facture partait donc SANS SON MONTANT et sans le nom du client, et
 * rien ne le signalait — les gabarits omettent proprement une ligne
 * dont la valeur manque, choix par ailleurs juste, qui rendait l'erreur
 * invisible jusqu'à ce qu'un client le dise.
 *
 * Elles se fabriquent maintenant dans la machine, à partir du document
 * qu'elle RELIT en base. Deux défauts se referment d'un coup : les noms
 * ne peuvent plus diverger, et le contenu d'un message ne traverse plus
 * le réseau depuis un appelant.
 */

/**
 * LE DEVIS VIENT D'ÊTRE MARQUÉ « ENVOYÉ ».
 *
 * Le déclencheur le plus propre du lot : un geste humain explicite,
 * déjà daté par `quotes.sent_at`, déjà inscrit au journal d'audit sous
 * `quoteSent`. On ne déduit rien — quelqu'un a cliqué.
 *
 * ON RELIT LE DEVIS PLUTÔT QUE DE CROIRE L'APPELANT. L'action qui nous
 * appelle vient d'écrire `sent_at` ; on pourrait s'en contenter. Mais
 * relire coûte une requête et ferme trois portes d'un coup : un devis
 * d'une AUTRE organisation (RLS le rendrait introuvable), un devis
 * archivé, et un devis dont l'écriture a échoué sans qu'on le sache.
 */
export async function surDevisEnvoye(
  deps: Dependances,
  args: { organizationId: string; quoteId: string },
): Promise<ResultatEnvoi> {
  try {
    const devis = await deps.lecteur.lireDevis(args.quoteId);
    if (!devis) {
      return { etat: "erreur", raison: "Ce devis est introuvable." };
    }

    // LE CLOISONNEMENT, VÉRIFIÉ ICI AUSSI. RLS refuserait déjà, et
    // `email_enqueue` refuserait une troisième fois. Trois verrous pour
    // la même porte : celui-ci est le seul qui produise une phrase
    // lisible plutôt qu'une ligne vide, et il coûte une comparaison.
    if (devis.organizationId !== args.organizationId) {
      return { etat: "erreur", raison: "Ce devis n'appartient pas à votre entreprise." };
    }

    // LE FAIT DATÉ, PAS LE STATUT. Sans `sent_at`, l'écriture n'a pas
    // eu lieu : on n'envoie pas un devis que la base ne dit pas envoyé.
    if (!devis.envoyeLe) {
      return {
        etat: "erreur",
        raison: "Ce devis n'est pas marqué comme envoyé : aucun message ne part.",
      };
    }

    if (devis.archiveLe) {
      return { etat: "refuse", raison: "Ce devis est archivé.", avertissements: [] };
    }

    // `return await`, ET LE `await` EST PORTEUR. Un `return promesse`
    // dans un `try` ne passe PAS par le `catch` : la promesse est rendue
    // avant d'être résolue, et son rejet remonte donc jusqu'à
    // l'action métier — exactement l'exception qu'on croyait avoir
    // couverte. C'est une épreuve qui l'a trouvée, pas une relecture.
    return await expedier(deps, {
      organizationId: args.organizationId,
      gabarit: "devisEnvoye",
      typeObjet: "quote",
      objetId: devis.id,
      // Rang 1 : l'original. Les relances portent un autre gabarit et
      // leur propre suite de rangs, donc aucune collision possible.
      occurrence: 1,
    });
  } catch (erreur) {
    return { etat: "erreur", raison: messageDe(erreur) };
  }
}

/**
 * LA FACTURE VIENT D'ÊTRE ÉMISE.
 *
 * `issue_invoice()` attribue le numéro et pose `issued_at` dans la même
 * instruction. C'est ce fait daté qu'on regarde, et pas le statut :
 * 0054 le dit, « un statut se change, un fait daté non ». Une facture
 * qu'on repasserait en brouillon puis qu'on ré-émettrait garderait son
 * `issued_at` d'origine et son message d'origine — elle ne repart pas.
 *
 * L'IDENTITÉ LÉGALE EST VÉRIFIÉE EN BASE, PAS ICI. Le catalogue marque
 * `factureEmise` avec `requires_legal_identity`, et
 * `email_sender_identity` refuse alors sans SIRET ni adresse complète
 * (art. 242 nonies A du CGI). Le refus revient sous la forme d'une
 * phrase adressée au paysagiste — « Renseignez le SIRET de votre
 * entreprise » — et LA FACTURE RESTE ÉMISE. C'est exactement la
 * distinction que ce module doit tenir : le document est opposable, le
 * courrier attend.
 */
export async function surFactureEmise(
  deps: Dependances,
  args: { organizationId: string; invoiceId: string },
): Promise<ResultatEnvoi> {
  try {
    const facture = await deps.lecteur.lireFacture(args.invoiceId);
    if (!facture) {
      return { etat: "erreur", raison: "Cette facture est introuvable." };
    }

    if (facture.organizationId !== args.organizationId) {
      return { etat: "erreur", raison: "Cette facture n'appartient pas à votre entreprise." };
    }

    if (!facture.emiseLe) {
      return {
        etat: "erreur",
        raison: "Cette facture n'est pas émise : aucun message ne part.",
      };
    }

    if (facture.archiveLe) {
      return { etat: "refuse", raison: "Cette facture est archivée.", avertissements: [] };
    }

    // `return await`, ET LE `await` EST PORTEUR. Un `return promesse`
    // dans un `try` ne passe PAS par le `catch` : la promesse est rendue
    // avant d'être résolue, et son rejet remonte donc jusqu'à
    // l'action métier — exactement l'exception qu'on croyait avoir
    // couverte. C'est une épreuve qui l'a trouvée, pas une relecture.
    return await expedier(deps, {
      organizationId: args.organizationId,
      gabarit: "factureEmise",
      typeObjet: "invoice",
      objetId: facture.id,
      occurrence: 1,
    });
  } catch (erreur) {
    return { etat: "erreur", raison: messageDe(erreur) };
  }
}

/**
 * La phrase d'un imprévu, sans jamais laisser fuir une pile d'appels
 * dans un écran de paysagiste.
 */
export function messageDe(erreur: unknown): string {
  if (erreur instanceof Error && erreur.message) return erreur.message;
  return "Le message n'a pas pu être préparé.";
}

/**
 * CE QUE L'APPELANT DOIT MONTRER, EN UNE PHRASE — OU RIEN.
 *
 * `null` veut dire « il n'y a rien à dire à l'utilisateur » : le
 * message est parti, ou il était déjà parti. Les trois autres états
 * méritent un mot, et ils ne méritent pas le même :
 *
 *   • `refuse` — le paysagiste peut agir, et la phrase lui dit comment ;
 *   • `indisponible` — il ne peut rien y faire, mais il doit savoir que
 *     le courrier n'est pas parti, sinon il attend une réponse à un
 *     message qui n'existe pas. Le produit mentirait par omission ;
 *   • `erreur` — l'imprévu, dit sobrement.
 *
 * Le geste métier, lui, a réussi dans les cinq cas. C'est pourquoi la
 * tonalité n'est jamais « erreur » : la facture EST émise.
 */
export function phrasePourEcran(resultat: ResultatEnvoi): string | null {
  switch (resultat.etat) {
    case "misEnFile":
      return null;
    case "dejaParti":
      // LE SILENCE ÉTAIT UN DÉFAUT, ET UN DÉFAUT DIFFICILE À VOIR.
      //
      // L'écran offre « Repasser en brouillon → corriger → Marquer comme
      // envoyé ». Au second passage, la clé d'idempotence est déjà
      // prise : rien ne repart — ce qui est correct — mais rien ne
      // s'affichait non plus. Pendant ce temps `sent_at` est reposé,
      // l'audit réinscrit l'envoi, et la liste affiche « envoyé
      // aujourd'hui ». Le paysagiste croit avoir transmis la version
      // corrigée ; son client a l'ancienne.
      //
      // C'est le revers exact de « un message ne part jamais deux
      // fois », et il est plus coûteux qu'un doublon : personne ne le
      // signale.
      return "Ce document a déjà été envoyé à votre client : le message ne repart pas. Pour lui transmettre une version corrigée, créez une révision.";
    case "refuse":
      return resultat.raison;
    case "indisponible":
      return resultat.raison;
    case "incertain":
      return resultat.raison;
    case "erreur":
      return `Le courriel n'a pas pu être préparé : ${resultat.raison}`;
  }
}
