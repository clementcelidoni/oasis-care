import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  Badge,
  EmptyState,
  InfoCard,
  PageHeader,
  Panel,
  SectionHeader,
  StatusBadge,
  type Tone,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  getAccountEntitlementSummary,
  getBillingProvider,
  type BillingProviderId,
  type SubscriptionStatus,
} from "@/lib/billing/provider";
import { lireCatalogue, type OffreAffichable } from "@/app/inscription/catalogue";
import { formaterHt } from "@/app/inscription/grille";
import { manquePourFacturer, zoneFiscale, type IdentiteSaisie } from "@/app/inscription/identite";
import { formaterJour, phraseResiliation } from "@/app/inscription/engagement";
import {
  lireDerniereAcceptation,
  lireEngagementEnCours,
} from "@/app/inscription/engagement-lecture";
import { jourDeReference } from "@/lib/billing/composition";
import { CompanyTabs } from "../CompanyTabs";

/**
 * §15 ABONNEMENT — « Votre forfait / Oasis Care Pro ».
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI A CHANGÉ, ET POURQUOI IL LE FALLAIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Cet écran affichait « 79,90 € / mois ». SANS LA MENTION « HT ». À un
 * professionnel, un prix hors taxes présenté sans sa mention est une
 * pratique commerciale trompeuse — et la grille du dirigeant est en
 * hors taxes de bout en bout. Une entreprise française règle 95,88 €
 * pour un prix affiché 79,90 € ; découvrir l'écart au relevé bancaire
 * est la première cause de contestation.
 *
 * Les montants viennent désormais de `formaterHt()`, qui rend TOUJOURS
 * « 79,90 € HT ». La mention voyage avec le montant, dans la même
 * chaîne : il n'existe aucun chemin par lequel ce gabarit pourrait
 * l'oublier.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE TUNNEL N'EST PLUS « ANNONCÉ » : IL EXISTE, ET IL EST AILLEURS
 * ══════════════════════════════════════════════════════════════════
 *
 * L'ancienne version décrivait « Choisir → Résumé → Paiement →
 * Confirmation » en quatre puces, dont la troisième disait « l'étape
 * qui manque ». Elle ne manque plus. Cet écran renvoie donc au parcours
 * qui la joue (`/inscription?etape=offre`) plutôt que de dupliquer un
 * second tunnel qui divergerait du premier au deuxième changement.
 *
 * MAIS LE LIEN N'APPARAÎT QUE SI LE PAIEMENT PEUT RÉELLEMENT ABOUTIR.
 * Trois conditions, vérifiées ici, et chacune dit ce qui manque quand
 * elle ne tient pas :
 *   1. le fournisseur d'encaissement est configuré (`unavailableReason`) ;
 *   2. la fiche de l'entreprise permet d'ÉMETTRE LA FACTURE ;
 *   3. au moins une offre porte un prix.
 * Un bouton qui promet un paiement impossible est pire qu'un bouton
 * absent : le premier fait perdre du temps et de la confiance, le second
 * ne fait rien perdre du tout.
 */

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: "Période d'essai",
  active: "Actif",
  pastDue: "Paiement en retard",
  cancelled: "Résilié",
};

const STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  trialing: "info",
  active: "positive",
  pastDue: "critical",
  cancelled: "neutral",
};

/**
 * Comment l'abonnement est payé. « Aucun » n'est pas une case vide :
 * c'est une information, et pour une entreprise sans ligne de paiement
 * c'est la plus utile de l'écran.
 */
const PROVIDER_LABEL: Record<BillingProviderId, string> = {
  none: "Aucun — rien n'est prélevé",
  web: "Paiement en ligne",
  apple: "Achat In-App (Apple)",
  manual: "Facturation manuelle",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function chaine(valeur: unknown): string {
  return valeur === null || valeur === undefined ? "" : String(valeur);
}

/**
 * §15 — LE RETOUR DU PRESTATAIRE, QUE PERSONNE NE LISAIT.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE PASSAIT, MESURÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * `lib/billing/stripe.ts` renvoie le client ICI, avec
 * `?souscription=confirmee&session=…` en cas de succès et
 * `?souscription=abandonnee` en cas de renoncement. Cette page ne
 * déclarait AUCUN paramètre : les deux étaient ignorés. On donnait sa
 * carte, et l'écran affichait exactement ce qu'il affichait avant — au
 * mieux le nouvel abonnement si le webhook avait été plus rapide que le
 * navigateur, ce qui n'arrive presque jamais. Ni « merci », ni « nous
 * confirmons », ni rien.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE PASSE MAINTENANT, ET POURQUOI AILLEURS
 * ══════════════════════════════════════════════════════════════════
 *
 * SUCCÈS → on renvoie à l'étape « confirmation » du tunnel
 * (`/inscription?etape=confirmation`), qui dit ce qui vient d'être
 * souscrit, à partir de quand, et ce qui se passera à la fin de
 * l'essai — y compris quand l'événement signé n'est pas encore arrivé.
 *
 * Pourquoi là-bas plutôt qu'ici, en trois raisons :
 *   1. le tunnel a une quatrième étape depuis toujours dans son propre
 *      cahier des charges (« Choisir → Résumé → Paiement →
 *      Confirmation ») ; c'est sa place ;
 *   2. cet écran-ci est une page de RÉFÉRENCE — ce que couvre mon
 *      forfait, quelles offres existent — pas une page de MOMENT. Un
 *      bandeau de félicitations en haut d'un tableau de bord se lit une
 *      fois et gêne ensuite ;
 *   3. et surtout : `/inscription` vit HORS du groupe `(app)`. Au
 *      retour du paiement, la ligne d'abonnement n'existe pas encore ;
 *      une page située derrière la garde de l'application est
 *      précisément celle qu'un contrôle d'accès peut renvoyer ailleurs,
 *      à la seconde même où il faut parler au client.
 *
 * ABANDON → on reste ici, et on le dit calmement. Rien n'a été prélevé,
 * l'entreprise et sa fiche sont intactes, et le chemin pour reprendre
 * est juste en dessous. C'est la bonne page pour ça : celle des offres.
 *
 * Le paramètre `session=…` n'est pas lu, volontairement. Il SERT À
 * AFFICHER, PAS À OUVRIR UN DROIT — et ici il n'affiche rien de plus
 * que ce que la base sait déjà dire.
 */
export default async function SubscriptionPage({
  searchParams,
}: PageProps<"/entreprise/abonnement">) {
  const params = await searchParams;
  const retour = typeof params?.souscription === "string" ? params.souscription : null;
  if (retour === "confirmee") redirect("/inscription?etape=confirmation");

  const organization = await getActiveOrganization();
  if (!organization) return null;

  // §16 — l'écran ne connaît aucun fournisseur en particulier ; il
  // demande celui qui est actif et se règle sur ce qu'il sait faire.
  const billing = getBillingProvider();
  const supabase = await createClient();

  // Le jour de référence est celui de Paris : un engagement qui court
  // « jusqu'au 1er mars » ne doit pas se lever la veille au soir parce
  // que l'UTC a changé de jour avant nous.
  const leJour = jourDeReference();

  const [
    catalogue,
    subscription,
    entitlements,
    { data: memberCount },
    { data: fiche },
    engagement,
    acceptation,
  ] = await Promise.all([
      lireCatalogue({
        metier: organization.businessType,
        supabase,
      }),
      billing.getSubscription(organization.organizationId),
      getAccountEntitlementSummary(organization.workspaceId),
      supabase.rpc("organization_employee_count", {
        p_organization_id: organization.organizationId,
      }),
      supabase
        .from("business_organizations")
        .select("legal_name, legal_form, siren, siret, vat_number, address_line1, postal_code, city, country")
        .eq("id", organization.organizationId)
        .maybeSingle(),
      lireEngagementEnCours(supabase, organization.organizationId, leJour),
      lireDerniereAcceptation(supabase, organization.organizationId),
    ]);

  const plans = catalogue.offres;

  // Un forfait désactivé après souscription disparaît du catalogue mais
  // reste celui de l'entreprise : on garde alors sa clé brute plutôt que
  // d'afficher « aucun forfait » à quelqu'un qui en a bien un.
  const current = subscription
    ? plans.find((plan) => plan.offre.key === subscription.planKey)
    : undefined;
  const currentPlanName = current?.offre.name ?? subscription?.planKey ?? null;

  // LES MÊMES STATUTS QUE `STATUTS_DEJA_ABONNE` du tunnel, et il faut
  // que ce soit les mêmes : un abonnement RÉSILIÉ peut se réabonner en
  // libre-service, un abonnement en cours non. Si les deux listes
  // divergeaient, l'écran proposerait un bouton que la caisse refuse —
  // ou cacherait un bouton qui aurait marché.
  const abonnementEnCours =
    subscription !== null
    && (subscription.status === "trialing"
      || subscription.status === "active"
      || subscription.status === "pastDue");

  // Le plafond d'utilisateurs du forfait en cours, quand il en a un.
  const members = (memberCount as number | null) ?? 0;
  const maxUsers = current?.offre.maxUsers ?? null;
  const overCapacity = maxUsers !== null && members > maxUsers;

  // ---- CE QUI MANQUE POUR POUVOIR PAYER ---------------------------
  const ligne = (fiche ?? {}) as Record<string, unknown>;
  const identite: IdentiteSaisie = {
    legalName: chaine(ligne.legal_name) || null,
    legalForm: chaine(ligne.legal_form) || null,
    siren: chaine(ligne.siren) || null,
    siret: chaine(ligne.siret) || null,
    vatNumber: chaine(ligne.vat_number) || null,
    addressLine1: chaine(ligne.address_line1) || null,
    postalCode: chaine(ligne.postal_code) || null,
    city: chaine(ligne.city) || null,
    country: chaine(ligne.country) || "FR",
  };
  const manque = manquePourFacturer(identite);
  const zone = zoneFiscale(identite.country);

  const caisseOuverte = billing.unavailableReason === null;
  const desOffresVendables = plans.some((plan) => plan.souscriptibleEnLigne);
  const paiementPossible = caisseOuverte && manque.length === 0 && desOffresVendables;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Care Pro"
        title="Votre forfait"
        subtitle="Ce que couvre votre abonnement, et les offres disponibles."
        action={
          subscription ? (
            <StatusBadge tone={STATUS_TONE[subscription.status]}>
              {STATUS_LABEL[subscription.status]}
            </StatusBadge>
          ) : (
            <Badge tone="neutral">Aucun abonnement</Badge>
          )
        }
      />

      <CompanyTabs current="/entreprise/abonnement" />

      {/* ---------- LE PAIEMENT ABANDONNÉ ----------
          Ni faute, ni panne : on ferme une page de paiement pour mille
          raisons, et la plus fréquente est qu'on voulait juste voir le
          montant. Le ton est celui-là, et l'information qui compte tient
          en trois mots : rien n'a été prélevé. */}
      {retour === "abandonnee" && (
        <Panel title="Vous avez quitté le paiement" className="mb-4">
          <div className="px-5 py-5">
            <p className="text-[var(--text-body)]">
              <span className="font-medium">Rien n&apos;a été prélevé</span>, et aucun abonnement
              n&apos;a été souscrit. Votre entreprise et tout ce que vous avez saisi sont
              conservés.
            </p>
            <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
              Vous reprenez quand vous voulez, à l&apos;offre de votre choix — les prix et les
              dates seront recalculés à ce moment-là.
            </p>
          </div>
        </Panel>
      )}

      {/* ---------- Plan actuel ---------- */}
      <Panel
        title="Plan actuel"
        description="L'abonnement enregistré pour cette entreprise."
        className="mb-4"
      >
        {subscription ? (
          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
            <InfoCard
              label="Forfait"
              value={currentPlanName}
              hint={current?.offre.tagline ?? undefined}
              badge={overCapacity ? { label: "Plafond dépassé", tone: "warning" } : undefined}
            />
            <InfoCard
              label="Statut"
              value={STATUS_LABEL[subscription.status]}
              hint={
                subscription.cancelledAt
                  ? `Résilié le ${formatDate(subscription.cancelledAt)}.`
                  : `Depuis le ${formatDate(subscription.startedAt)}.`
              }
            />
            <InfoCard
              label="Utilisateurs"
              value={members === 1 ? "1 utilisateur" : `${members} utilisateurs`}
              hint={
                maxUsers === null
                  ? "Aucun plafond sur ce forfait."
                  : overCapacity
                    ? `Ce forfait en prévoit ${maxUsers}.`
                    : `Jusqu'à ${maxUsers} sur ce forfait.`
              }
            />
            <InfoCard
              label="Mode de facturation"
              value={PROVIDER_LABEL[subscription.provider]}
              hint={
                subscription.currentPeriodEnd
                  ? `Période en cours jusqu'au ${formatDate(subscription.currentPeriodEnd)}.`
                  : "Aucune échéance enregistrée."
              }
            />
          </div>
        ) : (
          /* §32 — pas de ligne d'abonnement, et c'est un état normal :
             le produit n'a encore encaissé personne. On l'écrit, plutôt
             que de laisser un panneau vide qui ressemble à une panne. */
          <div className="px-5 py-5">
            <p className="text-[var(--text-body)] text-ink-soft">
              Aucun abonnement n&apos;est enregistré pour{" "}
              <span className="font-medium text-ink">{organization.name}</span>. Rien
              n&apos;est prélevé et aucune fonctionnalité n&apos;est bridée : la ligne
              d&apos;abonnement sera créée le jour où un forfait sera souscrit.
            </p>
          </div>
        )}
      </Panel>

      {/* ---------- L'ENGAGEMENT EN COURS ---------- */}
      {engagement !== null && (
        <Panel
          title="Votre engagement"
          description="Ce à quoi vous avez souscrit, et jusqu'à quand."
          className="mb-4"
        >
          <div className="px-5 py-5">
            {/* LA DATE, LE PRIX, ET CE QUE L'ENGAGEMENT INTERDIT — dans
                cet ordre. Un client qui découvre son engagement au
                moment de résilier est une réclamation certaine, et il
                aura raison. */}
            <p className="text-[var(--text-body)]">{phraseResiliation(engagement)}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoCard
                label="Fin de l'engagement"
                value={formaterJour(engagement.finLe)}
                hint="Jusqu'à cette date incluse, l'abonnement ne peut pas être résilié depuis cet écran."
              />
              <InfoCard
                label="Fin du tarif remisé"
                value={formaterJour(engagement.finRemiseLe)}
                hint={
                  /* DEUX DATES, ET ELLES NE DISENT PAS LA MÊME CHOSE :
                     l'une libère, l'autre change le prix. Sur le tarif
                     fondateur elles tombent le même jour ; rien ne
                     garantit qu'une remise future fera de même. */
                  engagement.finRemiseLe === engagement.finLe
                    ? "Le tarif public reprend le même jour que la fin de l'engagement."
                    : "À partir de cette date, le tarif public de votre offre reprend."
                }
              />
            </div>

            {/* LA PREUVE, RELUE PAR CELUI QUI L'A ACCEPTÉE. C'est la
                contrepartie de l'engagement : un contrat qu'on ne peut
                pas relire n'engage personne de bonne foi. */}
            {acceptation !== null && (
              <details className="mt-4 rounded-[var(--radius-control)] border border-line bg-surface-sunken p-4">
                <summary className="cursor-pointer text-[var(--text-body)] font-medium">
                  Relire le texte que vous avez accepté
                </summary>
                <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
                  Accepté le {formatDate(acceptation.accepteLe)} — version {acceptation.version}.
                </p>
                <p className="mt-2 whitespace-pre-line text-[var(--text-body)] text-ink-soft">
                  {acceptation.texte}
                </p>
              </details>
            )}

            <Link
              href="/aide#contact"
              className="mt-4 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium hover:bg-canvas"
            >
              Nous contacter
            </Link>
          </div>
        </Panel>
      )}

      {/* ---------- CE QUI MANQUE AVANT DE POUVOIR PAYER ---------- */}
      {manque.length > 0 && (
        <Panel
          title="Avant de pouvoir souscrire"
          description="Ce que votre facture devra porter, et qui manque encore."
          className="mb-4"
        >
          <div className="px-5 py-5">
            <p className="text-[var(--text-body)] text-ink-soft">
              {/* On dit la RÈGLE avant la liste : sans elle, la liste
                  ressemble à des champs obligatoires arbitraires. */}
              {zone === "france"
                ? "Une facture émise en France doit porter la dénomination sociale, le SIRET et l'adresse de votre entreprise. Sans eux, nous ne pouvons pas l'émettre — et encaisser un paiement dont la facture ne peut pas sortir serait un problème pour vous comme pour nous."
                : zone === "unionEuropeenne"
                  ? "Votre entreprise est dans l'Union européenne hors de France : la facture s'établit en autoliquidation et doit porter votre numéro de TVA intracommunautaire."
                  : "Votre entreprise est hors de l'Union européenne : la facture sera établie hors champ de la TVA française."}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {manque.map((item) => (
                <li key={item.champ} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 shrink-0 text-warning">
                    !
                  </span>
                  <span className="min-w-0 text-[var(--text-body)]">
                    <span className="font-medium">{item.libelle}</span>
                    <span className="block text-[var(--text-secondary)] text-ink-soft">
                      {item.raison}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/inscription?etape=societe"
              className="mt-4 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium hover:bg-canvas"
            >
              Compléter la fiche de l&apos;entreprise
            </Link>
          </div>
        </Panel>
      )}

      {/* ---------- Les forfaits ---------- */}
      <div className="mt-8">
        <SectionHeader
          title="Les offres"
          description={
            catalogue.aucunPrix
              ? "Les tarifs ne sont pas encore fixés : aucun montant n'est enregistré pour ces offres."
              : "Tous les prix sont indiqués hors taxes."
          }
        />

        {plans.length === 0 ? (
          /* §32 — un catalogue vide veut dire que la table
             `organization_plans` n'a pas été alimentée. Inventer quatre
             cartes ici ferait exactement ce que §"Noms configurables"
             interdit. */
          <EmptyState
            icon={<Icon name="subscription" className="h-6 w-6" />}
            title="Aucune offre publiée pour le moment"
            description="Les offres d'Oasis Care Pro sont enregistrées en base pour pouvoir être renommées sans mise à jour de l'application. Aucune n'est active actuellement."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((plan) => (
              <CarteForfait
                key={plan.offre.key}
                plan={plan}
                actuel={plan.offre.key === subscription?.planKey}
                recommande={catalogue.recommandation?.planKey === plan.offre.key}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---------- Changer de forfait ---------- */}
      {plans.length > 0 && (
        <Panel title="Changer de forfait" description="Comment cela se passe." className="mt-8">
          <div className="px-5 py-5">
            {/* CHANGER D'OFFRE PENDANT UN ENGAGEMENT N'EST PAS ANODIN :
                le tarif remisé est réservé à UNE offre précise
                (`applies_to_plan`), et la base refuse de le déplacer.
                Partir sur une autre offre, c'est perdre la remise —
                autant le dire avant le clic, pas après. */}
            {engagement !== null && (
              <p className="mb-3 rounded-[var(--radius-control)] border border-warning/30 bg-warning-wash px-3.5 py-2.5 text-[var(--text-body)] text-ink-soft">
                Vous êtes engagé jusqu&apos;au {formaterJour(engagement.finLe)} au titre de «{" "}
                {engagement.label} ». Ce tarif est réservé à votre offre actuelle : changer
                d&apos;offre y mettrait fin. Parlons-en avant.
              </p>
            )}
            {paiementPossible ? (
              abonnementEnCours ? (
                /* PAS DE BOUTON QUI MÈNE À UN REFUS CERTAIN.
                   Le changement d'offre n'a pas encore son chemin : le
                   tunnel refuse une entreprise déjà abonnée, et il a
                   raison — une seconde souscription créerait un second
                   dossier chez le prestataire, donc deux historiques de
                   paiement et un remboursement qui partirait du mauvais.
                   Un bouton qui mène à un refus use la confiance plus
                   vite qu'un bouton absent : on dit la vérité et on
                   donne la marche à suivre. */
                <div className="flex flex-col gap-2">
                  <p className="text-[var(--text-body)] text-ink-soft">
                    Vous avez déjà un abonnement en cours. Le changement d&apos;offre se fait sur cet
                    abonnement — pas par une nouvelle souscription — et il n&apos;est pas encore en
                    libre-service : écrivez-nous et nous le faisons avec vous, en conservant votre
                    historique de paiement.
                  </p>
                  <p className="text-[var(--text-secondary)] text-ink-faint">
                    Rien ne change et rien n&apos;est prélevé tant que vous n&apos;avez pas confirmé.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-[var(--text-body)] text-ink-soft">
                    Choisissez votre offre et son rythme, vérifiez le détail de ce qui sera prélevé,
                    puis réglez auprès de notre prestataire de paiement. Votre forfait ne prendra
                    effet qu&apos;une fois le règlement confirmé.
                  </p>
                  <Link
                    href="/inscription?etape=offre"
                    className="mt-4 inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink hover:bg-accent-hover"
                  >
                    Choisir une offre
                  </Link>
                </>
              )
            ) : (
              /* CHAQUE EMPÊCHEMENT A SA PHRASE, et elle dit quoi faire.
                 Une seule phrase générique enverrait tout le monde
                 écrire au support. */
              <div className="flex flex-col gap-2">
                {!caisseOuverte && (
                  <p className="text-[var(--text-body)] text-ink-soft">
                    {billing.unavailableReason}
                  </p>
                )}
                {caisseOuverte && !desOffresVendables && (
                  <p className="text-[var(--text-body)] text-ink-soft">
                    Aucune offre ne porte encore de tarif publié : il n&apos;y a rien à souscrire
                    aujourd&apos;hui.
                  </p>
                )}
                {caisseOuverte && desOffresVendables && manque.length > 0 && (
                  <p className="text-[var(--text-body)] text-ink-soft">
                    Complétez d&apos;abord la fiche de votre entreprise ci-dessus : sans ces
                    informations, la facture de votre abonnement ne pourrait pas être émise.
                  </p>
                )}
                <p className="text-[var(--text-secondary)] text-ink-faint">
                  Aucun bouton de souscription n&apos;est affiché tant que le paiement
                  n&apos;aboutit pas réellement — mieux vaut un écran qui ne propose rien
                  qu&apos;un écran qui confirme une transaction qui n&apos;a pas eu lieu.
                </p>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* ---------- §16 les entitlements de la Phase 12 ---------- */}
      <Panel
        title="Votre abonnement sur l'app iPhone"
        description="Les droits validés par Apple pour votre compte."
        className="mt-8"
      >
        <div className="px-5 py-5">
          {entitlements ? (
            <>
              <p className="text-[var(--text-body)]">
                <span className="font-medium">{entitlements.plans.join(", ")}</span> —{" "}
                {entitlements.count === 1
                  ? "1 droit accordé"
                  : `${entitlements.count} droits accordés`}
                {entitlements.expiresAt
                  ? `, jusqu'au ${formatDate(entitlements.expiresAt)}.`
                  : ", sans échéance enregistrée."}
              </p>
              <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
                Cet abonnement-là couvre l&apos;application Oasis Care sur votre iPhone. Il
                est rattaché à votre compte Apple, pas à l&apos;entreprise, et il ne
                remplace pas un forfait Oasis Care Pro.
              </p>
            </>
          ) : (
            <p className="text-[var(--text-body)] text-ink-soft">
              Aucun droit n&apos;est enregistré pour votre compte sur l&apos;application
              iPhone. Un abonnement souscrit depuis l&apos;App Store apparaîtrait ici — il
              reste distinct du forfait de l&apos;entreprise.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------
// Une carte de forfait
// ------------------------------------------------------------------

/**
 * POURQUOI PAS `PlanCard` DU SYSTÈME DE DESIGN.
 *
 * `PlanCard` prend un `price: string` et rien d'autre. Cet écran doit
 * montrer le mensuel ET l'annuel, le plancher d'une offre sur devis, les
 * modules compris et ceux en option avec leur prix — c'est-à-dire cinq
 * informations de prix là où le composant en accepte une. L'élargir
 * changerait un composant partagé par d'autres écrans, hors de ce
 * chantier ; le compte rendu le propose à l'intégration.
 */
function CarteForfait({
  plan,
  actuel,
  recommande,
}: {
  plan: OffreAffichable;
  actuel: boolean;
  recommande: boolean;
}) {
  const enOption = plan.optionsParCycle.monthly.filter(
    (option) => option.cochable && option.prix !== null,
  );

  return (
    <div
      className={`flex flex-col rounded-[var(--radius-card)] border p-5 ${
        actuel
          ? "border-accent bg-accent-wash/40 shadow-[var(--shadow-raised)]"
          : "border-line bg-surface shadow-[var(--shadow-card)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[length:var(--text-card)] font-semibold">{plan.offre.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          {actuel && <Badge tone="accent">Votre forfait</Badge>}
          {plan.badge === "bestSeller" && <Badge tone="positive">Le plus choisi</Badge>}
          {plan.badge === "new" && <Badge tone="info">Nouveau</Badge>}
          {plan.offre.isQuoteOnly && <Badge tone="neutral">Sur devis</Badge>}
          {recommande && !actuel && <Badge tone="info">Conseillé</Badge>}
        </div>
      </div>

      {plan.offre.tagline && (
        <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{plan.offre.tagline}</p>
      )}

      {/* LE PRIX PORTE SA MENTION « HT ». La chaîne arrive formée de
          `formaterHt()` : ce gabarit ne peut pas l'oublier. */}
      <p className="tabular mt-3 text-[1.5rem] font-semibold leading-none">
        {plan.offre.isQuoteOnly
          ? (plan.prixPlancher ?? "Sur devis")
          : (plan.prixMensuel ?? "Tarif non publié")}
      </p>
      {plan.prixAnnuel !== null && (
        <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
          ou {plan.prixAnnuel}
          {plan.economieAnnuelle !== null && (
            <span className="text-positive"> — {plan.economieAnnuelle}</span>
          )}
        </p>
      )}

      <ul className="mt-4 flex flex-1 flex-col gap-1.5">
        {plan.offre.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-[var(--text-body)]">
            <span aria-hidden className="mt-0.5 shrink-0 text-accent">
              ✓
            </span>
            <span className="text-ink-soft">{feature}</span>
          </li>
        ))}
      </ul>

      {plan.modulesCompris.length > 0 && (
        <p className="mt-3 text-[var(--text-secondary)] text-positive">
          Modules compris : {plan.modulesCompris.map((module) => module.name).join(", ")}.
        </p>
      )}

      {enOption.length > 0 && (
        <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
          {/* Le prix RÉEL de chaque option, selon la matrice offre ×
              module — le même module coûte 20 € sur une offre et rien
              du tout sur une autre. */}
          En option :{" "}
          {enOption.map((option) => `${option.module.name} (${option.prix})`).join(", ")}.
        </p>
      )}

      {plan.offre.extraSeatMonthlyPriceCents !== null && (
        <p className="mt-1.5 text-[var(--text-secondary)] text-ink-faint">
          Utilisateur supplémentaire : {formaterHt(plan.offre.extraSeatMonthlyPriceCents)} / mois.
        </p>
      )}
    </div>
  );
}
