// Oasis Care — Chantier Stripe. SUR QUELLE FACTURE TOMBE L'ARGENT.
//
// Module PUR, sans entrée-sortie : `index.ts` lit les factures, ce
// fichier choisit. C'est la partie qui peut faire du mal en silence —
// poser un encaissement sur la mauvaise facture solde une dette qui
// n'était pas due et en laisse une autre impayée — donc elle est isolée
// et éprouvée à part.
//
// ==================================================================
// POURQUOI UN RAPPROCHEMENT, ET PAS UN SIMPLE IDENTIFIANT
// ==================================================================
// STRIPE ENCAISSE, OASIS CARE FACTURE. Les deux systèmes tiennent donc
// chacun leur propre objet, et rien ne les relie d'office :
//
//   • au PREMIER paiement, le tunnel connaît notre facture et peut
//     poser son identifiant dans les métadonnées de la session — c'est
//     le chemin sûr, et c'est celui qu'on essaie d'abord ;
//   • à chaque RENOUVELLEMENT, en revanche, c'est Stripe qui déclenche
//     seul. Il ne connaît pas le numéro de la facture que
//     `saas_generate_invoices()` produira pour cette période-là. Il ne
//     reste que l'entreprise (portée par les métadonnées de
//     l'abonnement, recopiées sur chaque facture) et le montant.
//
// LA RÈGLE, ALORS : on ne rapproche que s'il n'y a AUCUNE ambiguïté
// possible — une seule facture émise de cette entreprise, dans cette
// devise, dont le reste à payer vaut EXACTEMENT le montant reçu. Zéro
// candidate ou deux, on refuse et on le consigne.
//
// Refuser n'est pas perdre l'argent : l'événement reste au journal avec
// son motif, et un administrateur peut poser l'encaissement à la main
// avec la MÊME référence Stripe. L'index d'unicité de 0083 § 5.a
// empêchera alors le doublon si le webhook finit par y arriver aussi.
// Deviner, en revanche, se répare beaucoup plus mal.

export interface FactureCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly devise: string;
  readonly statut: string;
  /** Le reste à payer, tel que le rend `saas_invoice_balance`. */
  readonly resteCentimes: number | null;
}

export interface DemandeRapprochement {
  readonly organisationResolue: string | null;
  readonly factureDemandee: string | null;
  readonly montantCentimes: number;
  readonly devise: string;
  readonly candidates: readonly FactureCandidate[];
}

export type Rapprochement =
  | { readonly trouve: true; readonly factureId: string; readonly voie: "metadonnee" | "montantUnique" }
  | { readonly trouve: false; readonly motif: string };

export function rapprocher(demande: DemandeRapprochement): Rapprochement {
  // ----------------------------------------------------------------
  // VOIE 1 — L'IDENTIFIANT ANNONCÉ DANS LES MÉTADONNÉES
  // ----------------------------------------------------------------
  // On ne le croit pas sur parole pour autant. Les métadonnées d'un
  // objet Stripe sont modifiables depuis le tableau de bord et depuis
  // l'API ; elles sont une commodité, pas une preuve. On vérifie donc
  // que la facture désignée existe bien, appartient bien à l'entreprise
  // résolue, et est dans le bon état.
  if (demande.factureDemandee !== null) {
    const visee = demande.candidates.find((f) => f.id === demande.factureDemandee);
    if (visee === undefined) {
      return {
        trouve: false,
        motif:
          `La facture ${demande.factureDemandee} annoncée dans les métadonnées n'est pas une facture émise et encaissable `
          + "de cette entreprise.",
      };
    }
    if (demande.organisationResolue !== null && visee.organizationId !== demande.organisationResolue) {
      // CE CAS-LÀ MÉRITE DE HURLER. Une facture d'une autre entreprise
      // désignée par les métadonnées, c'est soit une erreur du tunnel,
      // soit une tentative de solder la dette d'autrui.
      return {
        trouve: false,
        motif:
          `Incohérence : la facture ${visee.id} appartient à l'entreprise ${visee.organizationId}, `
          + `l'encaissement se présente pour ${demande.organisationResolue}.`,
      };
    }
    if (visee.devise !== demande.devise) {
      return {
        trouve: false,
        motif: `Devise discordante : la facture ${visee.id} est en ${visee.devise}, l'encaissement en ${demande.devise}.`,
      };
    }
    // ON N'ENCAISSE PAS PLUS QUE CE QUI RESTE DÛ.
    //
    // Un paiement PARTIEL est légitime — `saas_invoice_payments` est une
    // table, précisément pour qu'un acompte et un solde puissent
    // coexister — donc un montant inférieur au reste passe.
    // Un montant SUPÉRIEUR, non : il rendrait `outstanding_cents`
    // négatif dans `saas_invoice_balance`, et un reste à payer négatif
    // est le symptôme que rien ne rattrape ensuite tout seul. Quand la
    // facture désignée est déjà soldée, c'est presque toujours qu'on
    // vise la mauvaise. On refuse, on consigne, un humain tranche.
    //
    // Un reste INCONNU (`null`) ne déclenche pas ce refus : on ne
    // compare pas un montant à ce qu'on ne connaît pas. (Le cas ne
    // devrait pas exister sur une facture émise — `saas_issue_invoice`
    // refuse un prix indécidé — mais la vue peut rendre `null`, et le
    // code ne suppose pas ce qu'il n'a pas vérifié.)
    if (visee.resteCentimes !== null && demande.montantCentimes > visee.resteCentimes) {
      return {
        trouve: false,
        motif:
          `Trop-perçu refusé : la facture ${visee.id} ne présente plus que ${visee.resteCentimes} centimes à payer, `
          + `l'encaissement en porte ${demande.montantCentimes}.`,
      };
    }
    return { trouve: true, factureId: visee.id, voie: "metadonnee" };
  }

  // ----------------------------------------------------------------
  // VOIE 2 — LE MONTANT, ET SEULEMENT S'IL EST SANS AMBIGUÏTÉ
  // ----------------------------------------------------------------
  if (demande.organisationResolue === null) {
    return {
      trouve: false,
      motif:
        "Entreprise inconnue : ni métadonnée d'organisation sur l'événement, ni client rattaché. "
        + "Rien n'est inventé pour un client qu'on ne connaît pas.",
    };
  }

  const eligibles = demande.candidates.filter(
    (f) =>
      f.organizationId === demande.organisationResolue
      && f.devise === demande.devise
      // Un reste à payer INCONNU (`null`) écarte la facture. La vue le
      // rend `null` quand un prix reste indécidé, et « inconnu » ne
      // devient pas « égal au montant reçu » parce que ça arrangerait.
      && f.resteCentimes !== null
      && f.resteCentimes === demande.montantCentimes,
  );

  if (eligibles.length === 1) {
    return { trouve: true, factureId: eligibles[0].id, voie: "montantUnique" };
  }

  if (eligibles.length === 0) {
    return {
      trouve: false,
      motif:
        `Aucune facture émise de l'entreprise ${demande.organisationResolue} ne présente un reste à payer de `
        + `${demande.montantCentimes} centimes en ${demande.devise}. `
        + "L'encaissement est réel mais sans facture à laquelle l'attacher : à rapprocher à la main.",
    };
  }

  return {
    trouve: false,
    motif:
      `${eligibles.length} factures de l'entreprise ${demande.organisationResolue} présentent le même reste à payer `
      + `(${demande.montantCentimes} centimes) : le rapprochement est ambigu, on ne devine pas.`,
  };
}
