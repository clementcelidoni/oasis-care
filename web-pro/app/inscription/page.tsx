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
 * CE PARCOURS ET `/bienvenue` NE FONT PAS LA MÊME CHOSE
 * ══════════════════════════════════════════════════════════════════
 *
 * `/bienvenue` est l'installation du LOGICIEL : logo, effectif, modules
 * du menu, invitation de l'équipe. Ses étapes sont facultatives et c'est
 * très bien ainsi — personne ne doit être bloqué par un logo.
 *
 * Celui-ci est l'installation du CONTRAT : ce qui est facturé, à qui, et
 * sur quelle identité légale. Les exigences n'y sont pas les mêmes,
 * parce que la conséquence d'un champ vide n'y est pas la même : un logo
 * manquant ne fait rien, un SIRET manquant empêche d'émettre la facture
 * d'un paiement déjà encaissé.
 *
 * Les deux écrivent par la MÊME action (`updateCompanyProfile`) : un
 * second chemin d'écriture aurait fini par diverger, et l'inscription
 * aurait enregistré des champs que la fiche société ne relit pas.
 * (Le compte rendu propose à l'intégration de relier les deux — l'étape
 * 4 de `/bienvenue` menant ici. Ce fichier-là ne m'appartient pas.)
 */

type Etape = "societe" | "offre";

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

  // L'étape par défaut suit l'état réel : pas d'entreprise, on commence
  // par la créer ; elle existe, on va droit aux offres. Un `?etape=`
  // explicite prime — c'est ainsi qu'on revient corriger la fiche.
  const demandee = chaine(params?.etape);
  const etape: Etape =
    demandee === "societe" || demandee === "offre"
      ? demandee
      : organisation === null
        ? "societe"
        : "offre";

  // La fiche telle qu'elle est enregistrée, pour préremplir.
  let fiche: LigneEntreprise = {};
  if (organisation !== null) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("business_organizations")
      .select("*")
      .eq("id", organisation.organizationId)
      .maybeSingle();
    fiche = (data ?? {}) as LigneEntreprise;
  }

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
  ];

  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Care Pro"
        title={etape === "societe" ? "Votre société" : "Votre offre"}
        subtitle={
          etape === "societe"
            ? "Ces informations figureront sur vos factures. Elles décident aussi de la TVA qui vous sera appliquée."
            : "Choisissez votre offre et son rythme. Tous les prix sont hors taxes."
        }
      />

      {/* ---------------- Le fil des étapes ---------------- */}
      <nav aria-label="Étapes de l'inscription" className="mb-8 flex flex-wrap gap-2">
        {etapes.map((e) => {
          const active = e.cle === etape;
          // On ne laisse aller aux offres que si l'entreprise existe :
          // il n'y a rien à souscrire tant qu'il n'y a personne à
          // facturer.
          const accessible = e.cle === "societe" || organisation !== null;
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
          organisationExiste={organisation !== null}
          fiche={fiche}
          nomParDefaut={chaine(fiche.name) || organisation?.name || ""}
          metierParDefaut={
            BUSINESS_TYPES.includes(chaine(fiche.business_type) as BusinessType)
              ? (chaine(fiche.business_type) as BusinessType)
              : "landscaper"
          }
          champEnFaute={chaine(params?.champ) || null}
          messageEnFaute={chaine(params?.erreur) || null}
          valeursRejetees={params}
        />
      ) : (
        <EtapeOffre organisationId={organisation?.organizationId ?? null} identite={identite} metier={organisation?.businessType ?? null} />
      )}
    </main>
  );
}

// ------------------------------------------------------------------
// Étape 1 — la société
// ------------------------------------------------------------------

async function EtapeSociete({
  organisationExiste,
  fiche,
  nomParDefaut,
  metierParDefaut,
  champEnFaute,
  messageEnFaute,
  valeursRejetees,
}: {
  organisationExiste: boolean;
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
