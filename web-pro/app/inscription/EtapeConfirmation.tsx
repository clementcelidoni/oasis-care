import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, InfoCard, Panel, StatusBadge, SubmitButton, type Tone } from "@/components/ui";
import { lireAbonnement, type SubscriptionStatus } from "@/lib/billing/abonnement";
import { formaterJourFr } from "@/lib/billing/essai";
import { installerMonEspace, entrerDansLApplication } from "./actions.ts";
import type { PaiementEnCours } from "./paiement-partage.ts";

/**
 * §15 « Choisir → Résumé → Paiement → CONFIRMATION ». La quatrième, qui
 * n'existait pas.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CET ÉCRAN REMPLACE : RIEN. C'ÉTAIT DU SILENCE.
 * ══════════════════════════════════════════════════════════════════
 *
 * Le prestataire nous renvoyait sur `/entreprise/abonnement?souscription=
 * confirmee`, et cette page-là ne déclarait même pas `searchParams` :
 * le paramètre était ignoré, l'écran affichait exactement ce qu'il
 * affichait avant. On donnait sa carte, et personne ne disait merci —
 * ni « c'est enregistré », ni « nous confirmons », ni rien.
 *
 * C'est le pire moment possible pour se taire.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA DIFFICULTÉ RÉELLE : LE NAVIGATEUR REVIENT AVANT L'ÉVÉNEMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Le retour du navigateur et l'événement signé du prestataire sont deux
 * courses indépendantes, et le navigateur gagne presque toujours. À la
 * seconde du retour, `organization_subscriptions` est encore VIDE.
 *
 * Trois états sont donc possibles, et l'écran doit être juste dans les
 * trois — sans mentir, et sans faire peur :
 *
 *   1. LA LIGNE EXISTE. On dit ce qui est souscrit, à partir de quand,
 *      et ce qui se passera à la fin de l'essai. Tout vient de la base.
 *
 *   2. PAS DE LIGNE, MAIS UN PAIEMENT VIENT D'ÊTRE OUVERT depuis ce
 *      navigateur (l'aide-mémoire de `paiement-partage.ts`). On dit ce
 *      qui a été DEMANDÉ — au passé et au conditionnel, jamais comme un
 *      droit acquis — et qu'on attend la confirmation. Et l'on ajoute
 *      l'autre lecture, qui est vraie en même temps : si la page de
 *      paiement a été quittée sans régler, rien n'a été prélevé.
 *
 *   3. NI L'UN NI L'AUTRE. On le dit, et on renvoie aux offres.
 *
 * AUCUN DROIT N'EST OUVERT ICI. Cet écran lit ; il n'écrit pas une
 * ligne d'abonnement, et il n'en fabrique pas une à partir d'un cookie.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET IL RACCROCHE `/bienvenue`
 * ══════════════════════════════════════════════════════════════════
 *
 * L'installation du logiciel — logo, mentions, modules du menu, équipe
 * — n'est plus la porte d'entrée : le contrat passe avant l'accès,
 * puisque la carte est exigée avant l'essai. Elle n'a pas disparu pour
 * autant, et c'est ICI qu'elle se rattache : au moment exact où la
 * personne vient d'entrer, et où « installons votre espace » est la
 * suite naturelle. Elle reste facultative — le second bouton entre dans
 * l'application sans rien installer du tout.
 */

const LIBELLE_STATUT: Record<SubscriptionStatus, string> = {
  trialing: "Période d'essai",
  active: "Actif",
  pastDue: "Paiement en retard",
  cancelled: "Résilié",
};

const TON_STATUT: Record<SubscriptionStatus, Tone> = {
  trialing: "info",
  active: "positive",
  pastDue: "critical",
  cancelled: "neutral",
};

const LIBELLE_CYCLE: Record<"monthly" | "yearly", string> = {
  monthly: "Au mois",
  yearly: "À l'année",
};

/**
 * Une date de la base, écrite comme un paysagiste la lit.
 *
 * `Europe/Paris` explicitement : `trial_ends_at` est un horodatage, et
 * une fin d'essai enregistrée à 22 h 00 UTC est le LENDEMAIN en France
 * l'été. Laisser le fuseau du serveur décider ferait annoncer une date
 * à Paris et une autre à Francfort, pour le même abonnement.
 */
function jourLisible(horodatage: string): string {
  return new Date(horodatage).toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function EtapeConfirmation({
  supabase,
  organisationId,
  nomEntreprise,
  nomsDesOffres,
  paiement,
  installationARappeler,
}: {
  supabase: SupabaseClient;
  organisationId: string;
  nomEntreprise: string;
  /** Clé d'offre → nom affichable, lu du catalogue par l'appelant. */
  nomsDesOffres: Map<string, string>;
  /** L'aide-mémoire du paiement, s'il y en a un. Voir `paiement-partage.ts`. */
  paiement: PaiementEnCours | null;
  installationARappeler: boolean;
}) {
  // UN SEUL LECTEUR DU CONTRAT. Cet écran lisait `organization_
  // subscriptions` une SECONDE fois pour trois colonnes que le lecteur
  // commun n'exposait pas (le cycle, la fin d'essai, la fin de
  // période) ; elles y sont désormais, et la seconde requête a disparu.
  // Deux lectures d'un même contrat finissent toujours par ne plus dire
  // la même chose.
  const abonnement = await lireAbonnement(supabase, organisationId);

  // ================================================================
  // CAS 3 — NI LIGNE NI PAIEMENT OUVERT
  // ================================================================
  if (abonnement === null && paiement === null) {
    return (
      <Panel
        title="Aucune souscription en cours"
        description="Rien n'a été demandé depuis ce navigateur, et aucun abonnement n'est enregistré."
      >
        <div className="px-5 py-5">
          <p className="text-[var(--text-body)] text-ink-soft">
            {/* On ne dit pas « erreur » : arriver ici sans rien en cours
                est un état parfaitement normal — un signet, un retour en
                arrière, une page rouverte le lendemain. */}
            Vous êtes peut-être arrivé ici par un lien enregistré. Pour souscrire, choisissez
            votre offre : rien n&apos;est prélevé avant que vous ne l&apos;ayez confirmé.
          </p>
          <Link
            href="/inscription?etape=offre"
            className="mt-4 inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink hover:bg-accent-hover"
          >
            Voir les offres
          </Link>
        </div>
      </Panel>
    );
  }

  // ================================================================
  // CAS 2 — LE PRESTATAIRE N'A PAS ENCORE PARLÉ
  // ================================================================
  if (abonnement === null && paiement !== null) {
    const nomOffre = nomsDesOffres.get(paiement.planKey) ?? paiement.planKey;

    return (
      <div className="flex flex-col gap-4">
        <Panel
          title="Nous confirmons votre paiement"
          description="Quelques secondes, le temps que notre prestataire nous réponde."
          action={<StatusBadge tone="info">En attente</StatusBadge>}
        >
          <div className="px-5 py-5">
            <p className="text-[var(--text-body)]">
              {/* CE QUI EST VRAI, ET RIEN DE PLUS. La demande est
                  certaine — elle vient de ce navigateur ; la
                  souscription ne l'est pas encore. Les deux phrases
                  disent laquelle est laquelle. */}
              Votre demande est bien partie. Nous attendons la confirmation de notre prestataire
              de paiement avant d&apos;enregistrer votre abonnement : c&apos;est lui qui fait foi,
              pas le retour de votre navigateur.
            </p>
            <p className="mt-2 text-[var(--text-body)] text-ink-soft">
              Cela prend en général quelques secondes. Vous pouvez fermer cette page : rien ne se
              perd, et votre abonnement apparaîtra dans{" "}
              <span className="font-medium text-ink">Entreprise › Votre forfait</span>.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoCard
                label="Ce que vous avez demandé"
                value={nomOffre}
                hint={LIBELLE_CYCLE[paiement.cycle]}
              />
              <InfoCard
                label={paiement.avecEssai ? "Fin de l'essai annoncée" : "Premier prélèvement"}
                value={formaterJourFr(paiement.premierPrelevementLe)}
                hint={
                  paiement.avecEssai
                    ? "Rien n'est prélevé avant cette date."
                    : "Le règlement du jour même, comme annoncé."
                }
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {/* Un lien vers la même adresse : cliquer refait la
                  requête au serveur, qui relit la base. Un bouton
                  « actualiser » en JavaScript ne ferait rien de plus, et
                  demanderait un composant client. */}
              <Link
                href="/inscription?etape=confirmation"
                className="inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink hover:bg-accent-hover"
              >
                Actualiser
              </Link>
              <span className="text-[var(--text-secondary)] text-ink-faint">
                Cette page ne se met pas à jour toute seule.
              </span>
            </div>
          </div>
        </Panel>

        {/* L'AUTRE LECTURE, VRAIE EN MÊME TEMPS.
            Le retour d'abandon du prestataire est une simple page : elle
            ne peut pas effacer l'aide-mémoire posé à l'aller. Quelqu'un
            qui a renoncé au paiement voit donc cet écran, lui aussi — et
            il doit y trouver sa propre réponse, pas seulement celle de
            l'autre. */}
        <Panel title="Et si vous avez renoncé ?">
          <div className="px-5 py-5">
            <p className="text-[var(--text-body)] text-ink-soft">
              Si vous avez quitté la page de paiement sans régler,{" "}
              <span className="font-medium text-ink">rien n&apos;a été prélevé</span> et rien
              n&apos;a été souscrit. Votre entreprise et tout ce que vous avez saisi sont
              conservés : vous reprenez quand vous voulez.
            </p>
            <Link
              href="/inscription?etape=offre"
              className="mt-4 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium hover:bg-canvas"
            >
              Revenir aux offres
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  // ================================================================
  // CAS 1 — LA LIGNE EXISTE : ON DIT CE QU'ELLE DIT
  // ================================================================
  // (Le typage ne le déduit pas des deux retours ci-dessus.)
  if (abonnement === null) return null;

  const nomOffre = nomsDesOffres.get(abonnement.planKey) ?? abonnement.planKey;
  const enEssai = abonnement.status === "trialing";
  const rythme = LIBELLE_CYCLE[abonnement.billingCycle];
  const chaqueEcheance = abonnement.billingCycle === "yearly" ? "chaque année" : "chaque mois";

  /**
   * LA PHRASE DE SUITE — « et ensuite ? ».
   *
   * Un par statut, parce qu'ils ne racontent pas la même histoire.
   * Elles ne portent AUCUN montant : le tarif négocié d'un contrat
   * Enterprise n'est pas le tarif public de la grille, et afficher l'un
   * pour l'autre serait annoncer un prix qui ne sera pas prélevé. Le
   * détail chiffré est sur la facture, qui, elle, ne peut pas se
   * tromper.
   */
  let suite: string;
  if (enEssai) {
    suite =
      abonnement.trialEndsAt === null
        ? "Votre essai est en cours. Rien n'est prélevé tant qu'il dure."
        : `Rien n'est prélevé jusqu'au ${jourLisible(abonnement.trialEndsAt)}. Ce jour-là, votre première facture est émise et votre carte débitée, puis ${chaqueEcheance} à la même date. D'ici là, vous pouvez arrêter à tout moment sans rien payer.`;
  } else if (abonnement.status === "active") {
    const fin = abonnement.currentPeriodEndOn ?? abonnement.currentPeriodEnd;
    suite =
      fin === null
        ? `Votre abonnement est en cours et se renouvelle ${chaqueEcheance}.`
        : `La période en cours court jusqu'au ${jourLisible(fin)}, puis se renouvelle ${chaqueEcheance} sans que vous ayez rien à faire.`;
  } else if (abonnement.status === "pastDue") {
    suite =
      "Un prélèvement n'a pas abouti. Vos données restent les vôtres : vous pouvez toujours les consulter, les exporter et régulariser. Le détail de ce qui est dû est sur votre forfait.";
  } else {
    suite = `Cet abonnement a été résilié${
      abonnement.cancelledAt ? ` le ${jourLisible(abonnement.cancelledAt)}` : ""
    }. Vos données restent les vôtres. Pour reprendre, écrivez-nous : un réabonnement reprend le dossier existant, il ne se refait pas comme une première souscription.`;
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={
          enEssai
            ? "Votre essai a commencé"
            : abonnement.status === "active"
              ? "C'est souscrit"
              : "Votre abonnement"
        }
        description={`Pour ${nomEntreprise}.`}
        action={
          <StatusBadge tone={TON_STATUT[abonnement.status]}>
            {LIBELLE_STATUT[abonnement.status]}
          </StatusBadge>
        }
      >
        <div className="px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard
              label="Votre offre"
              value={nomOffre}
              hint={rythme}
              badge={
                /* UN CONTRAT POSÉ À LA MAIN N'EST PAS UNE ANOMALIE.
                   Enterprise se construit sur devis : la grille le dit
                   (`is_quote_only`), la caisse en libre-service le
                   refuse, et c'est un administrateur qui pose le
                   contrat. Cet écran doit savoir l'accueillir — il n'y
                   a alors ni session de paiement, ni référence chez le
                   prestataire, et tout va bien. */
                abonnement.provider === "manual"
                  ? { label: "Contrat établi avec nous", tone: "neutral" as Tone }
                  : undefined
              }
            />
            <InfoCard
              label={enEssai ? "Fin de l'essai" : "Depuis le"}
              value={
                enEssai && abonnement.trialEndsAt !== null
                  ? jourLisible(abonnement.trialEndsAt)
                  : jourLisible(abonnement.startedAt)
              }
              hint={
                enEssai
                  ? "Votre carte est enregistrée ; rien n'est débité avant."
                  : "Date d'ouverture de votre abonnement."
              }
            />
          </div>

          <p className="mt-4 text-[var(--text-body)]">{suite}</p>

          <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
            Le détail de ce qui est facturé — offre, modules, taxes — figure sur votre forfait et
            sur votre facture.
          </p>
        </div>
      </Panel>

      {/* ---------- LA SUITE : INSTALLER, OU ENTRER ---------- */}
      <Panel
        title={installationARappeler ? "Installons votre espace" : "Vous pouvez y aller"}
        description={
          installationARappeler
            ? "Logo, mentions légales, modules du menu, équipe. Rien d'obligatoire."
            : "Votre espace est prêt."
        }
      >
        <div className="px-5 py-5">
          {installationARappeler ? (
            <p className="text-[var(--text-body)] text-ink-soft">
              Cinq réglages qui rendent vos devis et vos factures présentables : votre logo, vos
              mentions légales, votre effectif, les modules que vous voulez voir dans le menu, et
              les collègues à inviter.{" "}
              <span className="font-medium text-ink">Chacun est passable</span>, et tout se
              modifie plus tard dans Entreprise › Ma société.
            </p>
          ) : (
            <p className="text-[var(--text-body)] text-ink-soft">
              Vos clients, vos devis, vos chantiers et vos factures vous attendent.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {installationARappeler ? (
              <>
                {/* DEUX FORMULAIRES, PAS DEUX LIENS : un lien ne peut
                    pas effacer l'aide-mémoire du paiement, et le
                    laisser traîner deux heures ferait retomber sur
                    l'écran d'attente quelqu'un qui est déjà entré. */}
                <form action={installerMonEspace}>
                  <SubmitButton>Installer mon espace</SubmitButton>
                </form>
                <form action={entrerDansLApplication}>
                  <SubmitButton variant="ghost">Plus tard, entrer directement</SubmitButton>
                </form>
              </>
            ) : (
              <form action={entrerDansLApplication}>
                <SubmitButton>Entrer dans Oasis Care Pro</SubmitButton>
              </form>
            )}
            <Link
              href="/entreprise/abonnement"
              className="text-[var(--text-secondary)] text-ink-soft underline-offset-2 hover:underline"
            >
              Voir le détail de mon abonnement
            </Link>
          </div>
        </div>
      </Panel>

      {abonnement.status === "cancelled" && (
        <p className="text-[var(--text-secondary)] text-ink-faint">
          <Badge tone="neutral">À savoir</Badge> Une organisation dont l&apos;abonnement s&apos;est
          arrêté ne perd jamais ses données : vos clients, vos devis et vos factures restent
          consultables et exportables.
        </p>
      )}
    </div>
  );
}
