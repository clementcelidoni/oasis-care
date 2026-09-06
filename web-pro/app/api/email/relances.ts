import type { FaitDevis, FaitFacture, LecteurEmail, ReglagesRelances } from "./lecteur.ts";
import type { CleGabarit, PortEmail, ResultatEnvoi, TypeObjet } from "./port.ts";
import { messageDe } from "./declencheurs.ts";

/**
 * §EMAILS — LES RELANCES, ET CE QU'ELLES N'ONT PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * À LIRE AVANT DE CROIRE QUE ÇA TOURNE : RIEN NE LES DÉCLENCHE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce fichier CALCULE et EXPÉDIE les relances dues. Il ne les
 * PLANIFIE pas, et il ne peut pas : ce projet n'a aucun ordonnanceur.
 * `pg_cron` est absent, `pg_net` est absent, il n'y a ni cron Supabase
 * ni cron chez l'hébergeur — le commentaire de
 * `refresh_overdue_invoices` (0054) le dit lui-même : « Oasis n'en a
 * pas encore. »
 *
 * Tant que ce choix d'infrastructure n'est pas tranché, appeler
 * `envoyerRelancesDues` reste un geste manuel (la route POST
 * `app/api/email/relances`, que personne n'appelle aujourd'hui). C'est
 * écrit ici plutôt que dans un compte rendu qu'on ne relira pas :
 * quiconque ouvre ce fichier doit apprendre en dix lignes que la moitié
 * temporelle du besoin est prête mais pas branchée.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES CINQ RÈGLES DE CADENCE, ET POURQUOI CHACUNE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. DÉSACTIVÉES PAR DÉFAUT, activées entreprise par entreprise.
 *      Voir `email_organization_settings.reminders_enabled`. Un
 *      paysagiste relancé à son insu perd confiance d'un coup.
 *
 *   2. LE DÉLAI N'EST PAS CODÉ EN DUR. Il se lit sur l'entreprise
 *      (`reminder_delay_days`, 1 à 90 jours) et retombe sur le défaut
 *      de la colonne quand aucune ligne n'existe.
 *
 *   3. UN PLAFOND, lui aussi par entreprise (`reminder_max`, 0 à 3).
 *      Trois relances sur un devis, c'est du harcèlement commercial.
 *
 *   4. UNE SEULE RELANCE PAR PASSAGE ET PAR OBJET. Si personne n'a
 *      appelé cette fonction pendant un mois, on n'expédie pas trois
 *      relances d'un coup au même client : on envoie le rang suivant,
 *      et le passage d'après enverra le suivant. Un rattrapage en
 *      rafale est indéfendable devant le destinataire.
 *
 *   5. ON S'ARRÊTE DÈS QU'IL N'Y A PLUS LIEU DE RELANCER : une
 *      décision est tombée, le devis a dépassé sa validité, la facture
 *      est soldée ou créditée.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON LIT `due_on`, JAMAIS LE STATUT « overdue »
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est le piège que ce fichier doit éviter. `refresh_overdue_invoices`
 * ne bascule une facture en « overdue » que lorsque QUELQU'UN OUVRE
 * L'ÉCRAN DES FACTURES. Une facture peut donc être en retard depuis
 * trois semaines sans que la base le sache. Brancher la relance sur ce
 * basculement, ce serait la brancher sur « le patron a ouvert son
 * écran » — ce qui n'est pas un déclencheur, et ce qui relancerait les
 * clients des entreprises actives en épargnant ceux des autres.
 */

const MS_PAR_JOUR = 86_400_000;

export type RelanceDue = {
  typeObjet: TypeObjet;
  objetId: string;
  organizationId: string;
  customerId: string;
  gabarit: CleGabarit;
  /** Le rang de CETTE relance : 1 pour la première, 2 pour la seconde. */
  occurrence: number;
  /** Le repère lisible affiché dans le bilan (« DEV-2026-0007 »). */
  reference: string;
};

export type BilanRelances = {
  organizationId: string;
  /** La phrase à montrer quand rien n'a pu être calculé du tout. */
  raisonInactive: string | null;
  misEnFile: number;
  dejaParti: number;
  refuse: number;
  indisponible: number;
  erreur: number;
  details: { reference: string; resultat: ResultatEnvoi }[];
};

/**
 * LE CŒUR DE LA CADENCE, ET IL EST PUR.
 *
 * Aucune base, aucune horloge implicite, aucun port : on lui donne une
 * date de départ, un instant, un réglage et les rangs déjà partis, il
 * rend le rang à envoyer maintenant — ou `null`. C'est ce qui permet de
 * l'éprouver sur une trentaine de cas sans un seul appel réseau.
 *
 * LE COMPTE SE FAIT EN JOURS ENTIERS ÉCOULÉS, en UTC. Une relance est
 * une échéance à la journée, pas à l'heure : un décalage de deux heures
 * déplace la frontière de minuit, il ne change rien à la règle. Prendre
 * un fuseau ici donnerait l'illusion d'une précision que la donnée n'a
 * pas.
 *
 * `rangsDejaEnvoyes` vient du journal. Il ne GARANTIT rien — la
 * garantie est la contrainte d'unicité en base — il évite seulement de
 * rendre un gabarit et d'appeler le transporteur pour rien.
 */
export function rangRelanceDu(args: {
  depuis: string | null;
  maintenant: Date;
  delaiJours: number;
  nombreMaximum: number;
  rangsDejaEnvoyes: number[];
}): number | null {
  if (!args.depuis) return null;
  if (args.nombreMaximum <= 0) return null;
  if (args.delaiJours <= 0) return null;

  const depart = Date.parse(args.depuis);
  if (Number.isNaN(depart)) return null;

  const joursEcoules = Math.floor((args.maintenant.getTime() - depart) / MS_PAR_JOUR);
  if (joursEcoules < args.delaiJours) return null;

  // Combien de relances le temps a rendues légitimes, plafond compris.
  const dues = Math.min(Math.floor(joursEcoules / args.delaiJours), args.nombreMaximum);

  // LA PLUS PETITE QUI MANQUE, ET ELLE SEULE. Voir la règle 4 : on
  // rattrape un rang par passage, jamais la pile.
  const dejaEnvoyes = new Set(args.rangsDejaEnvoyes);
  for (let rang = 1; rang <= dues; rang += 1) {
    if (!dejaEnvoyes.has(rang)) return rang;
  }
  return null;
}

/** La date du jour, en `YYYY-MM-DD`, pour comparer à une colonne `date`. */
function jour(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Un devis mérite-t-il encore d'être relancé ?
 *
 * Séparé du calcul de cadence pour être lisible : ce sont deux
 * questions distinctes, « y a-t-il encore lieu » et « est-ce le
 * moment ».
 */
export function devisEncoreRelancable(devis: FaitDevis, maintenant: Date): boolean {
  if (!devis.envoyeLe) return false;
  if (devis.decideLe) return false;
  if (devis.archiveLe) return false;
  // Seuls ces deux états décrivent un devis chez le client sans réponse.
  // 'expired' et 'cancelled' ont déjà tranché ; 'draft' n'est pas parti.
  if (devis.statut !== "sent" && devis.statut !== "viewed") return false;
  // PASSÉE LA DATE DE VALIDITÉ, ON SE TAIT. Relancer sur une offre qui
  // n'est plus valable oblige à refaire le devis de toute façon, et
  // donne au client l'impression qu'on ne suit pas ses dossiers.
  if (devis.valableJusquau && devis.valableJusquau < jour(maintenant)) return false;
  return true;
}

/**
 * Une facture mérite-t-elle encore d'être relancée ?
 *
 * `resteDuCents` vient de `invoice_balance`, qui déduit les paiements ET
 * les avoirs. Un `total - payé` calculé ici relancerait un client pour
 * une facture qu'on lui a créditée.
 */
export function factureEncoreRelancable(facture: FaitFacture, maintenant: Date): boolean {
  if (!facture.emiseLe) return false;
  if (facture.archiveLe) return false;
  if (!facture.echeanceLe) return false;
  if (facture.echeanceLe >= jour(maintenant)) return false;
  if (facture.resteDuCents === null || facture.resteDuCents <= 0) return false;
  // On lit `due_on` et le solde, pas le basculement en « overdue » —
  // voir l'en-tête. Ces trois états sont ceux d'une facture vivante ;
  // 'paid', 'cancelled' et 'credited' n'attendent plus rien.
  const vivante = facture.statut === "issued"
    || facture.statut === "partiallyPaid"
    || facture.statut === "overdue";
  return vivante;
}

/**
 * CE QUI EST DÛ, MAINTENANT, POUR UNE ENTREPRISE.
 *
 * Ne rend rien quand les relances sont éteintes, et ne rend rien quand
 * l'entreprise est suspendue — inutile de préparer des messages que la
 * porte refusera un à un. Le motif remonte dans `raisonInactive`.
 */
export async function calculerRelancesDues(
  deps: { lecteur: LecteurEmail },
  args: { organizationId: string; maintenant?: Date },
): Promise<{ relances: RelanceDue[]; reglages: ReglagesRelances; raisonInactive: string | null }> {
  const maintenant = args.maintenant ?? new Date();
  const reglages = await deps.lecteur.lireReglages(args.organizationId);

  if (reglages.suspendueLe) {
    return {
      relances: [],
      reglages,
      raisonInactive: reglages.motifSuspension
        ? `L'expédition de courrier est suspendue pour cette entreprise. Motif : ${reglages.motifSuspension}`
        : "L'expédition de courrier est suspendue pour cette entreprise.",
    };
  }

  if (!reglages.actives) {
    return {
      relances: [],
      reglages,
      raisonInactive: "Les relances automatiques ne sont pas activées pour cette entreprise.",
    };
  }

  const relances: RelanceDue[] = [];

  // ---- Les devis ---------------------------------------------------
  const devis = (await deps.lecteur.listerDevisRelancables(args.organizationId))
    .filter((d) => devisEncoreRelancable(d, maintenant));

  if (devis.length > 0) {
    const rangs = await deps.lecteur.lireRangsEnvoyes(
      "quote", devis.map((d) => d.id), "devisRelance",
    );
    const parId = new Map(rangs.map((r) => [r.objetId, r.rangs]));

    for (const d of devis) {
      const rang = rangRelanceDu({
        depuis: d.envoyeLe,
        maintenant,
        delaiJours: reglages.delaiJours,
        nombreMaximum: reglages.nombreMaximum,
        rangsDejaEnvoyes: parId.get(d.id) ?? [],
      });
      if (rang === null) continue;
      relances.push({
        typeObjet: "quote",
        objetId: d.id,
        organizationId: args.organizationId,
        customerId: d.customerId,
        gabarit: "devisRelance",
        occurrence: rang,
        reference: d.numero,
      });
    }
  }

  // ---- Les factures ------------------------------------------------
  const factures = (await deps.lecteur.listerFacturesRelancables(args.organizationId))
    .filter((f) => factureEncoreRelancable(f, maintenant));

  if (factures.length > 0) {
    const rangs = await deps.lecteur.lireRangsEnvoyes(
      "invoice", factures.map((f) => f.id), "factureRelance",
    );
    const parId = new Map(rangs.map((r) => [r.objetId, r.rangs]));

    for (const f of factures) {
      // LA CADENCE PART DE L'ÉCHÉANCE, pas de l'émission. Une facture à
      // soixante jours ne se relance pas le septième jour : elle n'est
      // pas en retard.
      const rang = rangRelanceDu({
        depuis: f.echeanceLe,
        maintenant,
        delaiJours: reglages.delaiJours,
        nombreMaximum: reglages.nombreMaximum,
        rangsDejaEnvoyes: parId.get(f.id) ?? [],
      });
      if (rang === null) continue;
      relances.push({
        typeObjet: "invoice",
        objetId: f.id,
        organizationId: args.organizationId,
        customerId: f.customerId,
        gabarit: "factureRelance",
        occurrence: rang,
        reference: f.numero ?? f.id,
      });
    }
  }

  return { relances, reglages, raisonInactive: null };
}

/**
 * CALCULER, PUIS EXPÉDIER.
 *
 * Séquentiel et non parallèle, volontairement : trente relances lancées
 * ensemble, c'est une pointe qui ressemble à un envoi de masse, et
 * c'est exactement ce qu'un transporteur mutualisé compte contre la
 * réputation du domaine — celle que TOUT LE PARC partage.
 *
 * Ne lève jamais, pour la même raison que les déclencheurs : un
 * passage de relances qui casse en son milieu doit rendre le compte de
 * ce qui est parti, pas une pile d'appels.
 */
export async function envoyerRelancesDues(
  deps: { lecteur: LecteurEmail; port: PortEmail },
  args: { organizationId: string; maintenant?: Date },
): Promise<BilanRelances> {
  const bilan: BilanRelances = {
    organizationId: args.organizationId,
    raisonInactive: null,
    misEnFile: 0, dejaParti: 0, refuse: 0, indisponible: 0, erreur: 0,
    details: [],
  };

  let dues: RelanceDue[] = [];
  try {
    const calcul = await calculerRelancesDues(deps, args);
    bilan.raisonInactive = calcul.raisonInactive;
    dues = calcul.relances;
  } catch (erreur) {
    bilan.erreur += 1;
    bilan.details.push({
      reference: "(calcul)",
      resultat: { etat: "erreur", raison: messageDe(erreur) },
    });
    return bilan;
  }

  for (const due of dues) {
    let resultat: ResultatEnvoi;
    if (deps.port.raisonIndisponible !== null) {
      resultat = { etat: "indisponible", raison: deps.port.raisonIndisponible };
    } else {
      try {
        resultat = await deps.port.mettreEnFile({
          organizationId: due.organizationId,
          gabarit: due.gabarit,
          typeObjet: due.typeObjet,
          objetId: due.objetId,
          occurrence: due.occurrence,
        });
      } catch (erreur) {
        resultat = { etat: "erreur", raison: messageDe(erreur) };
      }
    }

    // « incertain » compte comme une ERREUR dans le bilan, et pas comme
    // un envoi : le bilan sert à dire ce qui est sûr. Le détail, lui,
    // porte la phrase exacte, qui réclame un œil humain.
    bilan[resultat.etat === "misEnFile" ? "misEnFile"
      : resultat.etat === "dejaParti" ? "dejaParti"
      : resultat.etat === "refuse" ? "refuse"
      : resultat.etat === "indisponible" ? "indisponible"
      : "erreur"] += 1;
    bilan.details.push({ reference: due.reference, resultat });
  }

  return bilan;
}
