// Oasis Care — Les relances. L'ORCHESTRATION.
//
// ==================================================================
// LA RÉPARTITION DES RÔLES, ET POURQUOI ELLE EST TRANCHÉE AINSI
// ==================================================================
//
//   pg_cron        appelle `relances_calculer()` à heure fixe.
//   la base        CALCULE ce qui est dû et le DÉPOSE dans
//                  `relances_planifiees`. Elle n'appelle personne.
//   CE FICHIER     PUISE dans la file et fait EXPÉDIER.
//   `envoi-email`  rend le gabarit, met au journal, transporte.
//
// Deux raisons à la coupure, et elles ne sont pas de style : une tâche
// qui échoue au milieu d'un appel réseau laisse un état indéterminé,
// alors qu'une insertion est atomique ; et c'est la FILE qui porte la
// contrainte d'unicité, donc l'idempotence.
//
// ==================================================================
// CE FICHIER NE DÉCIDE DE RIEN, ET C'EST UNE CONTRAINTE, PAS UN STYLE
// ==================================================================
//
// Il ne recalcule aucune échéance, ne choisit aucun rang, ne lit aucun
// devis. Il prend ce que la base a déposé et le porte. La seule chose
// qu'il refuse est une ligne dont le GABARIT n'est pas un gabarit de
// relance — et ce n'est pas une décision, c'est un garde-fou : une
// ligne portant `devisEnvoye` ferait partir un PREMIER envoi déguisé en
// relance, avec le rang d'une relance.
//
// ==================================================================
// L'IDEMPOTENCE, À TROIS ÉTAGES, ET AUCUN N'EST DE LA POLITESSE
// ==================================================================
//
//   1. LE DÉPÔT. `relances_planifiees` porte un index unique sur
//      (entreprise, objet, gabarit, rang). Rejouer `relances_calculer`
//      ne dépose rien de plus.
//   2. LA RÉSERVATION. `for update skip locked` : deux passages
//      simultanés ne prennent jamais la même ligne.
//   3. LA MISE AU JOURNAL. `email_messages.idempotency_key` est une
//      colonne GÉNÉRÉE sous contrainte unique (0084). Même si ce
//      fichier expédiait deux fois la même ligne, la seconde
//      ressortirait en « déjà » sans qu'aucun message ne parte.
//
// C'est le troisième étage qui compte : les deux premiers peuvent être
// contournés par un bogue d'ici, le troisième non — il est en base.

import type { Issue, OrdreEnvoi } from "../envoi-email/traitement.ts";
import type { PorteFile, RelanceReservee } from "./file.ts";

/**
 * LES DEUX SEULS GABARITS QU'UNE FILE DE RELANCES PEUT PORTER.
 *
 * 0084 en sème huit ; deux seulement sont des relances. Les six autres
 * n'ont rien à faire ici, et une ligne qui en porterait un serait le
 * signe d'une écriture directe en base — donc quelque chose à regarder,
 * pas à exécuter.
 */
const GABARITS_DE_RELANCE: Record<string, "quote" | "invoice"> = {
  devisRelance: "quote",
  factureRelance: "invoice",
};

/**
 * L'EXPÉDITEUR, VU COMME UNE FONCTION ET RIEN DE PLUS.
 *
 * Derrière, en production, c'est `envoi-email` — qui relit le document,
 * fabrique les variables, rend le gabarit, appelle `email_enqueue()` et
 * transporte. Rien de tout cela n'est refait ici : DEUX moteurs de rendu
 * pour un même message finiraient par écrire deux messages différents,
 * et personne ne saurait lequel le client a reçu.
 *
 * Ce type est aussi ce qui rend les tests possibles sans réseau.
 */
export type Expediteur = (ordre: OrdreEnvoi) => Promise<Issue>;

export type Bilan = {
  /** Lignes réservées puis traitées, quelle qu'en soit l'issue. */
  traitees: number;
  envoyees: number;
  /** Déjà au journal : la contrainte d'unicité a tranché. Ce n'est pas un échec. */
  deja: number;
  /** Refus motivés, écrits dans la file pour qu'un humain les lise. */
  abandonnees: number;
  /** Parties peut-être : le journal d'envoi en porte l'état exact. */
  incertaines: number;
  /** Non nul quand le passage s'est arrêté avant d'avoir vidé la file. */
  arret: string | null;
};

/**
 * Le plafond de lignes traitées en un passage.
 *
 * Une fonction Edge a un temps d'exécution borné. Le dépasser au milieu
 * d'une expédition laisse une ligne réservée que rien ne libère — voir
 * la note sur la réservation orpheline juste en dessous. On s'arrête
 * donc de nous-mêmes, et le passage suivant reprend.
 */
const PLAFOND_PAR_PASSAGE = 100;

/**
 * ON RÉSERVE UNE LIGNE À LA FOIS, ET CE N'EST PAS UNE MALADRESSE.
 *
 * La tentation est d'en réserver cinquante d'un coup, comme le fait la
 * file des courriels. Ici ce serait une faute, pour une raison qui tient
 * à ce que la base propose — et surtout à ce qu'elle NE propose PAS.
 *
 * `relance_marquer_faite()` (0089 § 9.b) TERMINE une ligne : elle pose
 * `done_at` ou `cancelled_at`. IL N'EXISTE AUCUNE FONCTION POUR RENDRE
 * UNE LIGNE RÉSERVÉE SANS LA TERMINER. Or `relances_a_expedier` ne
 * choisit que des lignes dont `claimed_at is null` : une ligne réservée
 * par un passage qui meurt ensuite n'est plus jamais reprise, par
 * personne, et rien ne le signale.
 *
 * Réserver cinquante lignes puis mourir à la troisième, c'est donc
 * perdre quarante-sept relances en silence. En réserver une à la fois
 * borne la casse à UNE ligne, celle qu'on avait en main.
 *
 * LE COÛT EST UN ALLER-RETOUR PAR RELANCE, et il est négligeable devant
 * l'appel d'expédition qui suit de toute façon. LE VRAI REMÈDE est en
 * base et n'appartient pas à ce fichier : soit une fonction de
 * libération, soit une péremption de réservation dans la clause `where`
 * de `relances_a_expedier` (`or claimed_at < now() - interval '1 hour'`).
 * C'est signalé à l'intégration.
 */
const LIGNES_PAR_RESERVATION = 1;

export async function viderFileRelances(
  porte: PorteFile,
  expedier: Expediteur,
  options: { plafond?: number; raisonIndisponibilite?: string | null } = {},
): Promise<Bilan> {
  const bilan: Bilan = {
    traitees: 0,
    envoyees: 0,
    deja: 0,
    abandonnees: 0,
    incertaines: 0,
    arret: null,
  };

  // ---- 0. LE TRANSPORTEUR, AVANT DE RÉSERVER QUOI QUE CE SOIT ------
  //
  // L'ORDRE EST TOUT LE SUJET DE CE BLOC. Découvrir l'absence de
  // transporteur APRÈS avoir réservé une ligne laisserait cette ligne
  // sans issue honnête : la terminer serait mentir, la laisser serait la
  // perdre. On regarde donc d'abord, et on ne réserve rien.
  //
  // « Aucun transporteur configuré » n'est PAS une panne : c'est l'état
  // normal d'un projet où la clé n'a pas encore été posée. On le dit et
  // on rend la main.
  const indisponible = options.raisonIndisponibilite ?? null;
  if (indisponible !== null) {
    bilan.arret = indisponible;
    return bilan;
  }

  const plafond = Math.max(
    1,
    Math.min(options.plafond ?? PLAFOND_PAR_PASSAGE, PLAFOND_PAR_PASSAGE),
  );

  while (bilan.traitees < plafond) {
    let lot: RelanceReservee[];
    try {
      lot = await porte.reserver(LIGNES_PAR_RESERVATION);
    } catch (erreur) {
      // Une réservation qui échoue n'a rien réservé : on s'arrête sans
      // rien laisser derrière.
      bilan.arret = "La file n'a pas pu être lue : " + messageDe(erreur);
      return bilan;
    }
    if (lot.length === 0) return bilan;

    for (const relance of lot) {
      bilan.traitees += 1;

      // ---- LE GARDE-FOU DU GABARIT ------------------------------
      const objetAttendu = GABARITS_DE_RELANCE[relance.templateKey];
      if (objetAttendu === undefined) {
        await abandonner(
          porte,
          bilan,
          relance,
          "Ce type de message n'est pas une relance : rien n'a été envoyé.",
        );
        continue;
      }
      if (objetAttendu !== relance.entityType) {
        // Une relance de devis rattachée à une facture : la ligne est
        // incohérente, et l'expédier enverrait au client un message qui
        // parle d'un document qu'il n'a pas.
        await abandonner(
          porte,
          bilan,
          relance,
          "Cette relance ne correspond pas au document auquel elle se rattache : rien n'a été envoyé.",
        );
        continue;
      }
      if (!Number.isInteger(relance.occurrence) || relance.occurrence < 2) {
        // Le rang 1 est le PREMIER envoi. Une relance de rang 1 ferait
        // repartir le devis initial sous le texte d'une relance.
        await abandonner(
          porte,
          bilan,
          relance,
          "Le rang de cette relance est incohérent : rien n'a été envoyé.",
        );
        continue;
      }

      const ordre: OrdreEnvoi = {
        organizationId: relance.organizationId,
        // Le gabarit est celui de la file, et il vient d'être vérifié.
        gabarit: relance.templateKey as OrdreEnvoi["gabarit"],
        entityType: relance.entityType,
        entityId: relance.entityId,
        occurrence: relance.occurrence,
      };

      let issue: Issue;
      try {
        issue = await expedier(ordre);
      } catch (erreur) {
        // ON ARRÊTE LE PASSAGE, ET ON NE TERMINE PAS LA LIGNE.
        //
        // Une exception ici — réseau coupé, expéditeur injoignable — ne
        // dit RIEN de ce qui est arrivé au message. L'abandonner
        // fermerait définitivement ce rang de relance (l'index unique du
        // dépôt empêche qu'il soit recalculé) pour une panne de trente
        // secondes. La marquer faite serait un mensonge.
        //
        // La ligne reste donc réservée, ce qui est le moindre mal
        // CONNU : c'est exactement la réservation orpheline décrite plus
        // haut, elle est bornée à UNE ligne, et elle est dite dans le
        // bilan que l'ordonnanceur journalise.
        bilan.arret =
          "Expédition interrompue sur la relance " +
          relance.id +
          " : " +
          messageDe(erreur) +
          ". Cette ligne reste réservée et devra être reprise.";
        return bilan;
      }

      switch (issue.etat) {
        case "envoye":
          await porte.marquerFaite(relance.id, issue.messageId);
          bilan.envoyees += 1;
          break;

        case "deja":
          // LE CAS QUI PROUVE L'IDEMPOTENCE. Le journal d'envoi portait
          // déjà ce message : la contrainte d'unicité de 0084 l'a
          // constaté et rien n'est reparti. La ligne de file a bien fait
          // son travail — elle a mené au journal.
          await porte.marquerFaite(relance.id, issue.messageId);
          bilan.deja += 1;
          break;

        case "incertain":
          // NI PARTI NI PERDU, ET ON NE TRANCHE PAS À SA PLACE.
          //
          // `done_at` sur cette file ne veut pas dire « le client l'a
          // reçu » : il veut dire « cette ligne a atteint le journal
          // d'envoi ». C'est le cas, et `email_message_id` pointe vers
          // la ligne de `email_messages` qui porte, elle, l'état exact —
          // « sort inconnu ». Le paysagiste qui ouvre son journal y lit
          // la vérité ; réécrire ici un verdict plus net serait mentir
          // dans le seul endroit qu'il consulte quand son client dit
          // n'avoir rien reçu.
          await porte.marquerFaite(relance.id, issue.messageId);
          bilan.incertaines += 1;
          break;

        case "refuse":
          // Un refus est DÉFINITIF pour cette ligne : la porte
          // `email_gate()` a dit non, l'adresse est en liste de
          // suppression, le document a été archivé depuis le dépôt. La
          // raison est écrite en français dans la file, où un membre de
          // l'entreprise la lira.
          await abandonner(porte, bilan, relance, issue.raison);
          break;

        case "indisponible":
          // Le transporteur a disparu ENTRE le contrôle du § 0 et
          // maintenant. On n'abandonne pas la ligne pour ça — ce serait
          // fermer un rang de relance à cause d'une variable
          // d'environnement — et on arrête le passage.
          bilan.arret = issue.raison;
          return bilan;
      }
    }
  }

  bilan.arret =
    "Plafond du passage atteint : la file n'est pas vide, le passage suivant la reprendra.";
  return bilan;
}

async function abandonner(
  porte: PorteFile,
  bilan: Bilan,
  relance: RelanceReservee,
  motif: string,
): Promise<void> {
  // `ai_clean_text(motif, 300)` tronque déjà en base ; on tronque aussi
  // ici pour que le double des tests voie exactement ce que la base
  // verra.
  await porte.marquerAbandonnee(relance.id, motif.slice(0, 300));
  bilan.abandonnees += 1;
}

function messageDe(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message;
  return String(erreur);
}
