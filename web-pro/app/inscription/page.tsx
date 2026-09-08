import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { getBillingProvider } from "@/lib/billing/provider";
import { lireAbonnement } from "@/lib/billing/abonnement";
import { jourDeReference } from "@/lib/billing/composition";
import { essaiDisponible, formaterJourFr, planifierEssai } from "@/lib/billing/essai";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, type BusinessType } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui";
import { BandeauTva } from "@/lib/tva/BandeauTva";
import { lireEtatValidationTva } from "@/lib/tva/file";
import { lireCatalogue } from "./catalogue.ts";
import { etapeParDefaut, installationARappeler, type Etape } from "./aiguillage.ts";
import { relirePaiementEnCours } from "./paiement-en-cours.ts";
import { EtapeConfirmation } from "./EtapeConfirmation.tsx";
import {
  manquePourFacturer,
  PAYS_PROPOSES,
  zoneFiscale,
  type IdentiteSaisie,
} from "./identite.ts";
import { enregistrerSociete } from "./actions.ts";
import {
  annoncesParOffre,
  lireOffresEngageantes,
  lireTexteEngagement,
} from "./engagement-lecture.ts";
import { FormulaireSociete, type ValeursSociete } from "./FormulaireSociete.tsx";
import { ChoixOffre } from "./ChoixOffre.tsx";

/**
 * §INSCRIPTION PRO — « le client ajoute sa société, puis choisit son
 * plan en fonction de son métier ».
 *
 * ══════════════════════════════════════════════════════════════════
 * OÙ CE PARCOURS COMMENCE, ET POURQUOI IL NE CRÉE PAS DE COMPTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le COMPTE se crée à `/login`, par lien de connexion ou par Apple /
 * Google — l'application iOS n'a jamais eu de mot de passe, et en
 * inventer un ici donnerait aux gens quelque chose qu'ils n'ont pas.
 * Un visiteur non connecté qui ouvre cette adresse est renvoyé vers
 * `/login?next=/inscription` par `proxy.ts`, et il revient ici une fois
 * son lien ouvert.
 *
 * Ce parcours-ci commence donc APRÈS le compte, et il fait les deux
 * choses que le dirigeant a demandées, dans cet ordre :
 *
 *   1. LA SOCIÉTÉ — dénomination, forme juridique, SIRET, numéro de TVA,
 *      adresse complète. C'est de là que sortira la facturation.
 *   2. L'OFFRE — la grille lue en base, mensuel ou annuel, les modules
 *      en option à leur prix réel selon la matrice, et l'offre conseillée
 *      d'après le métier.
 *
 * ══════════════════════════════════════════════════════════════════
 * C'EST DÉSORMAIS LA PORTE, ET C'EST UN CHANGEMENT D'ORDRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un compte neuf sans entreprise arrivait sur `/bienvenue` —
 * l'installation du LOGICIEL — traversait huit étapes, entrait dans
 * l'application, et personne ne lui avait jamais parlé d'argent. Les
 * deux seuls liens vers ce parcours-ci étaient enfouis DANS
 * l'application, derrière la garde qu'il faut déjà avoir franchie pour
 * les voir : il fallait être entré pour trouver la porte du péage.
 *
 * C'est cette page qui reçoit maintenant les comptes sans entreprise
 * (`app/(app)/layout.tsx`), et l'ordre n'est pas une question de goût :
 * la règle du dirigeant — « essai gratuit un mois AVEC CARTE
 * OBLIGATOIREMENT » — impose que LE CONTRAT PRÉCÈDE L'ACCÈS.
 *
 * Le PORTAIL garde sa priorité, avant tout le reste : un particulier
 * invité par son paysagiste n'a pas d'organisation et n'en veut pas.
 * L'envoyer sur « créez votre société » lui demanderait de fonder une
 * entreprise pour lire sa facture.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS ÉTAPES, ET LA TROISIÈME EST CELLE QUI MANQUAIT
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. LA SOCIÉTÉ — dénomination, forme juridique, SIRET, TVA, adresse.
 *   2. L'OFFRE — la grille, le rythme, les modules, l'essai.
 *   3. LA CONFIRMATION — ce qui vient d'être souscrit, à partir de
 *      quand, et ce qui se passera à la fin de l'essai.
 *
 * La troisième n'existait pas : le prestataire nous renvoyait avec
 * `?souscription=confirmee` et personne ne lisait ce paramètre. On
 * donnait sa carte, et l'écran restait muet.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE PARCOURS ET `/bienvenue` NE FONT PAS LA MÊME CHOSE
 * ══════════════════════════════════════════════════════════════════
 *
 * `/bienvenue` est l'installation du LOGICIEL : logo, effectif, modules
 * du menu, invitation de l'équipe. Ses étapes sont facultatives et c'est
 * très bien ainsi — personne ne doit être bloqué par un logo. Elle vient
 * désormais APRÈS le contrat, et l'étape 3 y renvoie.
 *
 * Celui-ci est l'installation du CONTRAT : ce qui est facturé, à qui, et
 * sur quelle identité légale. Les exigences n'y sont pas les mêmes,
 * parce que la conséquence d'un champ vide n'y est pas la même : un logo
 * manquant ne fait rien, un SIRET manquant empêche d'émettre la facture
 * d'un paiement déjà encaissé.
 *
 * ET C'EST LE SEUL À CRÉER UNE ENTREPRISE. `/bienvenue` en créait une
 * aussi, sans fiche légale et sans dossier fiscal : deux chemins de
 * création pour une même chose finissent toujours par diverger, et
 * celui-là avait déjà divergé — l'entreprise qu'il fabriquait n'était
 * pas facturable. Il n'en reste qu'un, et c'est celui qui sait
 * facturer.
 *
 * Les deux écrivent la fiche par la MÊME action (`updateCompanyProfile`).
 */

/** Les champs de la fiche que l'étape « société » n'affiche pas mais réécrit. */
const CHAMPS_NON_AFFICHES = [
  "trade_name", "share_capital", "website", "currency", "locale", "timezone",
  "employee_count_override",
] as const;

type LigneEntreprise = Record<string, unknown>;

function chaine(valeur: unknown): string {
  return valeur === null || valeur === undefined ? "" : String(valeur);
}

export default async function InscriptionPage({ searchParams }: PageProps<"/inscription">) {
  const params = await searchParams;

  // `proxy.ts` a déjà renvoyé les visiteurs non connectés vers `/login`.
  // On revérifie ici parce que ce contrôle-là est OPTIMISTE et faillit
  // ouvert : la vraie autorisation est celle du composant serveur.
  const utilisateur = await getCurrentUser();
  if (!utilisateur) {
    return (
      <main className="mx-auto max-w-2xl px-8 py-16">
        <PageHeader
          eyebrow="Oasis Care Pro"
          title="Connectez-vous pour continuer"
          subtitle="La création de votre entreprise se fait depuis votre compte."
        />
        <Link
          href="/login?next=/inscription"
          className="inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink"
        >
          Aller à la connexion
        </Link>
      </main>
    );
  }

  const organisation = await getActiveOrganization();

  /**
   * LA DEUXIÈME ENTREPRISE, DEMANDÉE EXPLICITEMENT.
   *
   * Sans ce drapeau, arriver ici avec une entreprise active veut dire
   * « je viens corriger ma fiche ». Le produit est pourtant
   * multi-entreprises (§13), et fonder la seconde doit avoir un chemin.
   * `?nouvelle=1` est ce chemin, et il est explicite — jamais déduit.
   */
  const nouvelle = chaine(params?.nouvelle) === "1";

  // La fiche telle qu'elle est enregistrée, pour préremplir. Une
  // NOUVELLE entreprise part d'une page blanche : reprendre la fiche de
  // la précédente y recopierait son SIRET, c'est-à-dire l'identité
  // légale d'une autre société.
  let fiche: LigneEntreprise = {};
  const supabase = await createClient();
  if (organisation !== null && !nouvelle) {
    const { data } = await supabase
      .from("business_organizations")
      .select("*")
      .eq("id", organisation.organizationId)
      .maybeSingle();
    fiche = (data ?? {}) as LigneEntreprise;
  }

  /**
   * L'ÉTAPE PAR DÉFAUT SUIT L'ÉTAT RÉEL, et la règle est écrite —
   * et testée — dans `aiguillage.ts`. Trois faits l'alimentent :
   *
   *   • une entreprise existe-t-elle ? (sinon il n'y a personne à
   *     facturer) ;
   *   • UNE LIGNE d'abonnement existe-t-elle ? On lit son EXISTENCE et
   *     non son statut : la clé primaire de `organization_subscriptions`
   *     est l'organisation seule, il y a donc au plus une ligne, et son
   *     absence — pas un statut — distingue « jamais souscrit » de
   *     « souscrit ». La lecture détaillée, elle, appartient à l'étape
   *     de confirmation : cette page dit OÙ aller, pas QUOI dire ;
   *   • un paiement vient-il d'être ouvert depuis ce navigateur ? C'est
   *     ce qui permet d'atterrir sur la confirmation même quand le
   *     prestataire nous renvoie AVANT son événement signé.
   */
  let abonnementExiste = false;
  if (organisation !== null && !nouvelle) {
    const { data } = await supabase
      .from("organization_subscriptions")
      .select("organization_id")
      .eq("organization_id", organisation.organizationId)
      .maybeSingle();
    abonnementExiste = data !== null;
  }

  const paiement = await relirePaiementEnCours();

  const etape: Etape = etapeParDefaut({
    demandee: chaine(params?.etape) || null,
    // Une création explicitement demandée remet le parcours à son
    // début : l'entreprise active ne compte pas, on en fonde une autre.
    organisationExiste: organisation !== null && !nouvelle,
    abonnementExiste,
    paiementEnCours: paiement !== null,
  });

  const identite: IdentiteSaisie = {
    legalName: chaine(fiche.legal_name) || null,
    legalForm: chaine(fiche.legal_form) || null,
    siren: chaine(fiche.siren) || null,
    siret: chaine(fiche.siret) || null,
    vatNumber: chaine(fiche.vat_number) || null,
    addressLine1: chaine(fiche.address_line1) || null,
    postalCode: chaine(fiche.postal_code) || null,
    city: chaine(fiche.city) || null,
    country: chaine(fiche.country) || "FR",
  };

  const etapes = [
    { cle: "societe" as const, numero: 1, label: "Votre société" },
    { cle: "offre" as const, numero: 2, label: "Votre offre" },
    { cle: "confirmation" as const, numero: 3, label: "Confirmation" },
  ];

  const TITRES: Record<Etape, string> = {
    societe: nouvelle ? "Votre nouvelle société" : "Votre société",
    offre: "Votre offre",
    confirmation: "Confirmation",
  };
  const SOUS_TITRES: Record<Etape, string> = {
    societe:
      "Ces informations figureront sur vos factures. Elles décident aussi de la TVA qui vous sera appliquée.",
    offre: "Choisissez votre offre et son rythme. Tous les prix sont hors taxes.",
    confirmation: "Où en est votre souscription, et ce qui se passe ensuite.",
  };

  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Care Pro"
        title={TITRES[etape]}
        subtitle={SOUS_TITRES[etape]}
      />

      {/* ---------------- Le fil des étapes ---------------- */}
      <nav aria-label="Étapes de l'inscription" className="mb-8 flex flex-wrap gap-2">
        {etapes.map((e) => {
          const active = e.cle === etape;
          // On ne laisse aller aux offres que si l'entreprise existe :
          // il n'y a rien à souscrire tant qu'il n'y a personne à
          // facturer. Et pas à la confirmation avant qu'il y ait quelque
          // chose à confirmer — un abonnement, ou un paiement en route.
          const accessible =
            e.cle === "societe"
              ? true
              : e.cle === "offre"
                ? organisation !== null && !nouvelle
                : abonnementExiste || paiement !== null;
          const contenu = (
            <span
              className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-[var(--text-secondary)] font-medium ${
                active
                  ? "border-accent bg-accent-wash text-accent"
                  : accessible
                    ? "border-line-strong bg-surface text-ink-soft"
                    : "border-line bg-surface-sunken text-ink-faint"
              }`}
            >
              <span className="tabular">{e.numero}</span>
              {e.label}
            </span>
          );
          return accessible && !active ? (
            <Link key={e.cle} href={`/inscription?etape=${e.cle}`}>
              {contenu}
            </Link>
          ) : (
            <span key={e.cle} aria-current={active ? "step" : undefined}>
              {contenu}
            </span>
          );
        })}
      </nav>

      {etape === "societe" ? (
        <EtapeSociete
          // Une création explicitement demandée déverrouille le métier :
          // la nouvelle société n'a pas à hériter de celui de l'ancienne.
          organisationExiste={organisation !== null && !nouvelle}
          nouvelle={nouvelle}
          fiche={fiche}
          nomParDefaut={chaine(fiche.name) || (nouvelle ? "" : (organisation?.name ?? ""))}
          metierParDefaut={
            BUSINESS_TYPES.includes(chaine(fiche.business_type) as BusinessType)
              ? (chaine(fiche.business_type) as BusinessType)
              : "landscaper"
          }
          champEnFaute={chaine(params?.champ) || null}
          messageEnFaute={chaine(params?.erreur) || null}
          valeursRejetees={params}
        />
      ) : etape === "offre" ? (
        <EtapeOffre organisationId={organisation?.organizationId ?? null} identite={identite} metier={organisation?.businessType ?? null} />
      ) : (
        <EtapeTroisieme
          organisationId={organisation?.organizationId ?? null}
          nomEntreprise={organisation?.name ?? ""}
          metier={organisation?.businessType ?? null}
          fiche={fiche}
        />
      )}
    </main>
  );
}

// ------------------------------------------------------------------
// Étape 3 — la confirmation
// ------------------------------------------------------------------

/**
 * L'enveloppe de l'étape 3 : elle rassemble ce dont la confirmation a
 * besoin, et le composant dit ce qu'il y a à dire.
 *
 * Le catalogue est lu ICI pour une seule chose : le NOM de l'offre.
 * `organization_subscriptions.plan` porte une clé (« team »), et
 * afficher une clé à un paysagiste au moment où il vient de payer
 * serait de la paresse. La grille est en base précisément pour que ces
 * noms se changent sans toucher à l'application.
 */
async function EtapeTroisieme({
  organisationId,
  nomEntreprise,
  metier,
  fiche,
}: {
  organisationId: string | null;
  nomEntreprise: string;
  metier: BusinessType | null;
  fiche: LigneEntreprise;
}) {
  if (organisationId === null) {
    return (
      <p className="text-[var(--text-body)] text-ink-soft">
        Créez d&apos;abord votre entreprise : il n&apos;y a rien à confirmer tant qu&apos;elle
        n&apos;existe pas.
      </p>
    );
  }

  const supabase = await createClient();
  const [catalogue, paiement] = await Promise.all([
    lireCatalogue({ metier: metier ?? undefined, supabase }),
    relirePaiementEnCours(),
  ]);

  return (
    <EtapeConfirmation
      supabase={supabase}
      organisationId={organisationId}
      nomEntreprise={nomEntreprise}
      nomsDesOffres={new Map(catalogue.offres.map((a) => [a.offre.key, a.offre.name]))}
      paiement={paiement}
      installationARappeler={installationARappeler({
        onboardingStep:
          typeof fiche.onboarding_step === "number" ? fiche.onboarding_step : null,
        onboardingCompletedAt:
          typeof fiche.onboarding_completed_at === "string"
            ? fiche.onboarding_completed_at
            : null,
      })}
    />
  );
}

// ------------------------------------------------------------------
// Étape 1 — la société
// ------------------------------------------------------------------

async function EtapeSociete({
  organisationExiste,
  nouvelle,
  fiche,
  nomParDefaut,
  metierParDefaut,
  champEnFaute,
  messageEnFaute,
  valeursRejetees,
}: {
  organisationExiste: boolean;
  nouvelle: boolean;
  fiche: LigneEntreprise;
  nomParDefaut: string;
  metierParDefaut: BusinessType;
  champEnFaute: string | null;
  messageEnFaute: string | null;
  valeursRejetees: Record<string, string | string[] | undefined> | undefined;
}) {
  /**
   * Une saisie refusée revient par l'URL (`v_siret=…`) et PRIME sur ce
   * qui est en base : sinon la personne verrait réapparaître l'ancienne
   * valeur à la place de celle qu'elle vient de corriger, sans
   * comprendre pourquoi sa frappe a disparu.
   */
  function valeur(cle: string, depuisLaFiche: string): string {
    const rejetee = valeursRejetees?.[`v_${cle}`];
    if (typeof rejetee === "string") return rejetee;
    return depuisLaFiche;
  }

  const valeurs: ValeursSociete = {
    name: valeur("name", nomParDefaut),
    business_type: valeur("business_type", metierParDefaut),
    legal_name: valeur("legal_name", chaine(fiche.legal_name)),
    legal_form: valeur("legal_form", chaine(fiche.legal_form)),
    siren: valeur("siren", chaine(fiche.siren)),
    siret: valeur("siret", chaine(fiche.siret)),
    vat_number: valeur("vat_number", chaine(fiche.vat_number)),
    rcs_city: valeur("rcs_city", chaine(fiche.rcs_city)),
    address_line1: valeur("address_line1", chaine(fiche.address_line1)),
    address_line2: valeur("address_line2", chaine(fiche.address_line2)),
    postal_code: valeur("postal_code", chaine(fiche.postal_code)),
    city: valeur("city", chaine(fiche.city)),
    country: valeur("country", chaine(fiche.country) || "FR"),
    email: valeur("email", chaine(fiche.email)),
    phone: valeur("phone", chaine(fiche.phone)),
  };

  /**
   * Les champs que l'action réécrit sans que cette étape les montre.
   * `updateCompanyProfile` enregistre la fiche ENTIÈRE : sans eux, le
   * capital social saisi ailleurs repartirait à null en passant par ici.
   */
  const portees: Record<string, string> = {};
  for (const cle of CHAMPS_NON_AFFICHES) {
    // Le capital est stocké en centimes et saisi en euros : on le
    // reconvertit pour le renvoyer tel que l'action l'attend, sinon un
    // capital de 10 000 € reviendrait à 1 000 000 € au tour suivant.
    if (cle === "share_capital") {
      const centimes = fiche.share_capital_cents;
      portees[cle] = typeof centimes === "number" ? String(centimes / 100) : "";
      continue;
    }
    portees[cle] = valeur(cle, chaine(fiche[cle]));
  }

  return (
    <FormulaireSociete
      action={enregistrerSociete}
      valeurs={valeurs}
      portees={portees}
      metiers={BUSINESS_TYPES.map((cle) => ({ value: cle, label: BUSINESS_TYPE_LABELS[cle] }))}
      pays={PAYS_PROPOSES.map((p) => ({ value: p.code, label: p.nom }))}
      champEnFaute={champEnFaute}
      messageEnFaute={messageEnFaute}
      entrepriseExiste={organisationExiste}
      nouvelle={nouvelle}
    />
  );
}

// ------------------------------------------------------------------
// Étape 2 — l'offre
// ------------------------------------------------------------------

async function EtapeOffre({
  organisationId,
  identite,
  metier,
}: {
  organisationId: string | null;
  identite: IdentiteSaisie;
  metier: BusinessType | null;
}) {
  if (organisationId === null) {
    return (
      <p className="text-[var(--text-body)] text-ink-soft">
        Créez d&apos;abord votre entreprise à l&apos;étape précédente : il n&apos;y a personne à
        facturer tant qu&apos;elle n&apos;existe pas.
      </p>
    );
  }

  const supabase = await createClient();
  // §16 — l'écran ne connaît aucun fournisseur en particulier ; il
  // demande celui qui est actif et se règle sur ce qu'il sait faire.
  const facturation = getBillingProvider();

  // Le jour de référence est celui de Paris : à 23 h 30 en France,
  // l'UTC est déjà le lendemain l'été, et une offre « ouverte jusqu'au
  // 31 » disparaîtrait une soirée trop tôt.
  const leJour = jourDeReference();

  /**
   * OÙ EN EST LA VÉRIFICATION DU NUMÉRO DE TVA.
   *
   * Elle s'affiche ICI et pas à l'étape précédente, pour une raison de
   * moment : à l'étape « société », la personne vient tout juste de
   * saisir son numéro et la réponse du registre européen n'a pas eu le
   * temps d'arriver — le bandeau dirait « en cours » à tout le monde et
   * n'apprendrait rien. À l'étape « offre », il répond à la question
   * qu'on se pose vraiment avant de payer : est-ce que ma facture va
   * pouvoir être émise ?
   *
   * La zone vient de `zoneFiscale()`, seule source sur les vingt-sept ;
   * `lib/tva` n'en tient pas de copie.
   */
  const [catalogue, abonnement, texteEngagement, offresEngageantes, etatTva] = await Promise.all([
    lireCatalogue({
      metier: metier ?? undefined,
      libelleMetier: metier === null ? undefined : BUSINESS_TYPE_LABELS[metier],
      supabase,
    }),
    lireAbonnement(supabase, organisationId),
    lireTexteEngagement(supabase),
    lireOffresEngageantes(supabase, leJour),
    // Lue avec les autres et non après : une requête de plus en série
    // ferait attendre l'écran sans rien apprendre de plus.
    lireEtatValidationTva(supabase, {
      organizationId: organisationId,
      zone: zoneFiscale(identite.country),
      numero: identite.vatNumber,
    }),
  ]);

  /**
   * L'ESSAI EST RÉSERVÉ AU PREMIER ABONNEMENT DE L'ENTREPRISE.
   *
   * C'est la règle de la base : `saas_start_subscription()` refuse
   * toute entreprise portant déjà une ligne d'abonnement, RÉSILIÉE
   * COMPRISE. Offrir un second mois gratuit à qui revient serait, en
   * plus, un mois offert par résiliation.
   */
  const essaiPossible = essaiDisponible(abonnement);

  /**
   * DEUX CALENDRIERS, CALCULÉS AU SERVEUR, ET C'EST VOULU.
   *
   * La date de fin d'engagement dépend du chemin choisi : avec essai,
   * l'engagement démarre au premier prélèvement, un mois plus tard ;
   * sans essai, il démarre aujourd'hui. Le client bascule d'un chemin à
   * l'autre à l'écran, et l'écran doit afficher la bonne date SANS la
   * calculer lui-même — un « ajouter un mois » écrit dans le navigateur
   * dirait le 3 mars pour un 31 janvier.
   *
   * On envoie donc les deux annonces déjà faites, et le navigateur
   * choisit celle qui correspond à la case cochée. Il ne calcule rien.
   *
   * Le RYTHME ne change pas ces dates : le premier prélèvement tombe au
   * même jour au mois et à l'année. On planifie donc au mois, et
   * `resumerSouscription` recalcule le vrai calendrier complet avec le
   * cycle réellement demandé.
   */
  const departAvecEssai = planifierEssai({
    souscritLe: leJour,
    avecEssai: true,
    cycle: "monthly",
  }).premierPrelevementLe;
  const departSansEssai = planifierEssai({
    souscritLe: leJour,
    avecEssai: false,
    cycle: "monthly",
  }).premierPrelevementLe;

  /**
   * Le prix d'APRÈS l'engagement vient du tarif public de l'offre
   * visée — celui-là même que la carte affiche juste à côté. Une
   * seconde requête aurait pu en donner un autre ; on réemploie donc
   * le catalogue déjà lu, ce qui rend la contradiction impossible.
   */
  const prixPublics = new Map(
    catalogue.offres.map((a) => [a.offre.key, a.offre.monthlyPriceCents]),
  );
  const engagements = {
    avecEssai: [
      ...annoncesParOffre(offresEngageantes, prixPublics, { debutLe: departAvecEssai }).values(),
    ],
    sansEssai: [
      ...annoncesParOffre(offresEngageantes, prixPublics, { debutLe: departSansEssai }).values(),
    ],
  };

  if (catalogue.offres.length === 0) {
    return (
      <p className="text-[var(--text-body)] text-ink-soft">
        Aucune offre n&apos;est publiée pour le moment. Les forfaits d&apos;Oasis Care Pro sont
        enregistrés en base pour pouvoir être renommés sans mise à jour de l&apos;application.
      </p>
    );
  }

  return (
    <>
      {/* Ce que le registre européen a répondu, ou n'a pas encore
          répondu. Quatre situations, quatre phrases : « en cours »,
          « vérifié le … », « pas reconnu », « registre indisponible ».
          Le composant s'efface de lui-même quand il n'a rien à dire. */}
      <BandeauTva etat={etatTva} className="mb-6" />

      {catalogue.aucunPrix && (
        <p className="mb-6 rounded-[var(--radius-control)] border border-line bg-surface-sunken px-4 py-3 text-[var(--text-body)] text-ink-soft">
          Les tarifs ne sont pas encore publiés : aucun montant n&apos;est enregistré pour ces
          offres, et aucune souscription n&apos;est donc possible aujourd&apos;hui.
        </p>
      )}

      <ChoixOffre
        catalogue={catalogue}
        planActuel={abonnement?.planKey ?? null}
        peutSouscrire={facturation.unavailableReason === null}
        raisonNonSouscription={facturation.unavailableReason}
        identiteManquante={manquePourFacturer(identite).map((manque) => ({
          libelle: manque.libelle,
          raison: manque.raison,
        }))}
        lienIdentite="/inscription?etape=societe"
        engagements={engagements}
        texteEngagement={texteEngagement}
        essaiPossible={essaiPossible}
        datesPremierPrelevement={{
          avecEssai: formaterJourFr(departAvecEssai),
          sansEssai: formaterJourFr(departSansEssai),
        }}
      />
    </>
  );
}
