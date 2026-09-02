import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getActiveOrganization,
  getUserOrganizations,
  requireOrganization,
} from "@/lib/auth/organization";
import { hasPortalAccess } from "@/lib/portal/access";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  ROLES,
  ROLE_LABELS,
  type BusinessType,
  type Role,
} from "@/lib/auth/permissions";
import { MODULE_LABELS, TOGGLEABLE_MODULES, type ModuleKey } from "@/lib/navigation";
import { updateCompanyProfile, updateModules } from "@/lib/company/actions";
import { inviteMember } from "@/lib/company/teamActions";
import { flash } from "@/lib/ui/flash";
import { Badge, Field, Panel, SelectField, SubmitButton } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { LogoUploader } from "@/app/(app)/entreprise/LogoUploader";

/**
 * §44 ONBOARDING PRO — « 1 Nom entreprise · 2 Activité · 3 Logo ·
 * 4 Informations légales · 5 Nombre de salariés · 6 Modules souhaités ·
 * 7 Inviter équipe · 8 Terminer. Étapes facultatives passables. »
 *
 * UNE ÉTAPE = UNE URL (`/bienvenue?etape=4`), et l'avancement s'écrit en
 * base (`onboarding_step`, migration 0060). Ce n'est pas un détail
 * d'implémentation : la personne qui installe le logiciel part chercher
 * son numéro de TVA dans un classeur, ferme l'onglet, revient le
 * lendemain. Un état React aurait tout perdu ; ici elle retombe sur
 * l'étape où elle s'était arrêtée, avec ce qu'elle avait déjà saisi.
 *
 * CE QUI NE CHANGE PAS. La création passe toujours par la fonction
 * Postgres `create_professional_organization()`, qui fabrique l'espace
 * de travail, l'organisation et l'appartenance du propriétaire en une
 * seule transaction. Trois appels séparés laisseraient, au premier
 * échec, une organisation sans propriétaire — c'est-à-dire une
 * organisation dont plus personne ne peut ouvrir la porte.
 *
 * LES ÉTAPES 3 À 7 NE SONT PAS DES FORMULAIRES NEUFS : elles appellent
 * `updateCompanyProfile`, `uploadCompanyLogo`, `updateModules` et
 * `inviteMember`, les mêmes actions que les écrans de `/entreprise`. Un
 * deuxième chemin d'écriture aurait fini par diverger du premier, et
 * l'onboarding aurait enregistré des champs que la fiche société ne
 * relit pas.
 */

const LAST_STEP = 8;

const STEPS = [
  { n: 1, label: "Entreprise" },
  { n: 2, label: "Activité" },
  { n: 3, label: "Logo" },
  { n: 4, label: "Informations légales" },
  { n: 5, label: "Salariés" },
  { n: 6, label: "Modules" },
  { n: 7, label: "Équipe" },
  { n: 8, label: "Terminer" },
] as const;

/** Les étapes qu'on peut laisser en blanc — §« Étapes facultatives passables. » */
const OPTIONAL_STEPS = [3, 4, 5, 6, 7];

function clampStep(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), LAST_STEP);
}

/**
 * Les champs que `updateCompanyProfile` écrit — TOUS, à chaque appel.
 *
 * L'action enregistre la fiche entière : un champ absent du formulaire
 * repart à `null`. Une étape qui n'affiche que le SIRET effacerait donc
 * l'effectif saisi à l'étape suivante dès qu'on reviendrait la
 * corriger. Les valeurs déjà en base repartent en champs cachés, et
 * chaque étape ne modifie que ce qu'elle montre.
 */
const PROFILE_KEYS = [
  "name", "business_type", "legal_name", "trade_name", "legal_form",
  "siren", "siret", "vat_number", "rcs_city", "share_capital",
  "address_line1", "address_line2", "postal_code", "city", "country",
  "email", "phone", "website", "currency", "locale", "timezone",
  "employee_count_override",
] as const;

function CarriedProfile({
  values,
  except,
}: {
  values: Record<string, string>;
  except: string[];
}) {
  return (
    <>
      {PROFILE_KEYS.filter((key) => !except.includes(key)).map((key) => (
        <input key={key} type="hidden" name={key} defaultValue={values[key] ?? ""} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Les Server Actions du parcours
// ---------------------------------------------------------------

/**
 * L'avancement, retenu en base.
 *
 * Le compteur ne RECULE jamais : revenir corriger l'étape 4 alors qu'on
 * en était à la septième ne doit pas faire redémarrer le parcours
 * quatre étapes plus tôt à la prochaine visite.
 */
async function rememberStep(organizationId: string, step: number) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_organizations")
    .select("onboarding_step")
    .eq("id", organizationId)
    .maybeSingle();

  const reached = Math.max(Number(data?.onboarding_step ?? 0), step);
  await supabase
    .from("business_organizations")
    .update({ onboarding_step: reached, updated_at: new Date().toISOString() })
    .eq("id", organizationId);
}

/** Étape 2 — la création proprement dite. */
async function createOrganizationAction(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const requested = String(formData.get("business_type") ?? "");
  const businessType = BUSINESS_TYPES.includes(requested as BusinessType)
    ? requested
    : "landscaper";

  // Sans nom il n'y a rien à créer : on renvoie au champ, pas à une
  // page d'erreur. Le nom voyage dans l'URL entre les étapes 1 et 2 —
  // tant que l'organisation n'existe pas, il n'y a aucune ligne où le
  // poser.
  if (!name) redirect("/bienvenue?etape=1");

  const supabase = await createClient();
  const { data: organizationId, error } = await supabase.rpc(
    "create_professional_organization",
    { org_name: name, org_business_type: businessType },
  );
  if (error) throw new Error(error.message);

  if (organizationId) await rememberStep(String(organizationId), 3);

  revalidatePath("/", "layout");
  redirect("/bienvenue?etape=3");
}

/** « Continuer » et « Passer cette étape » : le même geste, deux mots. */
async function goToStep(formData: FormData) {
  "use server";

  const organization = await requireOrganization();
  const step = clampStep(Number.parseInt(String(formData.get("etape") ?? ""), 10), 3);
  await rememberStep(organization.organizationId, step);
  redirect(`/bienvenue?etape=${step}`);
}

/** Étapes 4 et 5 — la fiche société, par petits morceaux. */
async function saveProfileStep(formData: FormData) {
  "use server";

  await updateCompanyProfile(formData);

  const organization = await requireOrganization();
  const next = clampStep(Number.parseInt(String(formData.get("etape") ?? ""), 10), 3);
  await rememberStep(organization.organizationId, next);
  redirect(`/bienvenue?etape=${next}`);
}

/** Étape 6 — §43, du rangement de menu. */
async function saveModulesStep(formData: FormData) {
  "use server";

  await updateModules(formData);

  const organization = await requireOrganization();
  await rememberStep(organization.organizationId, 7);
  redirect("/bienvenue?etape=7");
}

/**
 * Étape 7 — une invitation, puis on reste sur place.
 *
 * On invite rarement une seule personne : filer aussitôt à l'étape 8
 * obligerait à revenir en arrière pour la deuxième. Le retour passe par
 * un code dans l'URL et jamais par l'adresse e-mail — une adresse n'a
 * rien à faire dans un historique de navigation.
 */
async function inviteStep(formData: FormData) {
  "use server";

  const result = await inviteMember({ status: "idle" }, formData);

  const organization = await requireOrganization();
  await rememberStep(organization.organizationId, 7);

  if (result.status === "error") {
    redirect(`/bienvenue?etape=7&erreur=${encodeURIComponent(result.message)}`);
  }
  redirect("/bienvenue?etape=7&invitation=creee");
}

/** Étape 8 — la porte de sortie. */
async function finishOnboarding() {
  "use server";

  const organization = await requireOrganization();
  const supabase = await createClient();

  const { error } = await supabase
    .from("business_organizations")
    .update({
      onboarding_step: LAST_STEP,
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", organization.organizationId);
  if (error) throw new Error(error.message);

  // Écrase au passage le « Fiche de l'entreprise enregistrée » laissé
  // par la dernière étape : ce qu'on veut lire en arrivant sur le
  // tableau de bord, c'est la fin du parcours, pas son avant-dernier
  // pas.
  await flash("success", `Votre espace est prêt, ${organization.name}.`);
  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------
// Les morceaux d'écran
// ---------------------------------------------------------------

function Stepper({ step, reachable }: { step: number; reachable: boolean }) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">
          Étape {step} sur {LAST_STEP}
        </p>
        {OPTIONAL_STEPS.includes(step) && <Badge tone="neutral">Facultative</Badge>}
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-[var(--radius-pill)] bg-surface-sunken">
        <div
          className="h-full rounded-[var(--radius-pill)] bg-accent"
          style={{ width: `${(step / LAST_STEP) * 100}%` }}
        />
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {STEPS.map((entry) => {
          const done = entry.n < step;
          const current = entry.n === step;

          const content = (
            <>
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-[11px] font-semibold ${
                  done
                    ? "bg-accent text-accent-ink"
                    : current
                      ? "bg-accent-wash text-accent"
                      : "bg-surface-sunken text-ink-faint"
                }`}
              >
                {done ? <Icon name="check" className="h-3 w-3" /> : entry.n}
              </span>
              {entry.label}
            </>
          );

          const shell = `flex items-center gap-2 rounded-[var(--radius-pill)] px-2.5 py-1 text-[var(--text-secondary)] ${
            current ? "bg-accent-wash font-medium text-accent" : "text-ink-faint"
          }`;

          return (
            <li key={entry.n}>
              {/* Une étape déjà franchie redevient cliquable : on corrige
                  une coquille sans refaire le parcours. Les deux
                  premières, non — l'entreprise existe, son nom se change
                  désormais dans sa fiche. */}
              {done && reachable && entry.n >= 3 ? (
                <Link
                  href={`/bienvenue?etape=${entry.n}`}
                  className={`${shell} transition-colors hover:text-ink`}
                >
                  {content}
                </Link>
              ) : (
                <span className={shell} aria-current={current ? "step" : undefined}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Le pied d'étape : reculer, et passer.
 *
 * §« Étapes facultatives passables. » Le bouton est ÉCRIT, à sa place,
 * sous le formulaire — un parcours d'installation qu'on ne peut pas
 * traverser est un parcours qu'on abandonne. Il vit hors du formulaire
 * de l'étape parce qu'un formulaire ne s'imbrique pas dans un autre :
 * passer, c'est enregistrer l'avancement sans enregistrer la saisie.
 */
function StepFooter({
  back,
  next,
  skipLabel,
  skipVariant = "ghost",
}: {
  back?: string;
  next?: number;
  skipLabel?: string;
  skipVariant?: "ghost" | "secondary";
}) {
  const skippable = next !== undefined && skipLabel !== undefined;
  // Ni retour ni passage : pas de barre vide sous le panneau.
  if (!back && !skippable) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {back ? (
        <Link
          href={back}
          className="text-[var(--text-secondary)] text-ink-soft transition-colors hover:text-ink"
        >
          ← Étape précédente
        </Link>
      ) : (
        <span />
      )}

      {skippable && (
        <form action={goToStep}>
          <input type="hidden" name="etape" defaultValue={next} />
          <SubmitButton variant={skipVariant}>{skipLabel}</SubmitButton>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------

export default async function WelcomePage({ searchParams }: PageProps<"/bienvenue">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const organizations = await getUserOrganizations();

  // Un client invité arrive ici par le chemin le plus court : connexion,
  // pas d'organisation, redirection. Lui demander de créer une
  // entreprise pour lire sa facture serait absurde.
  if (organizations.length === 0 && (await hasPortalAccess())) redirect("/portail");

  const organization = organizations.length > 0 ? await getActiveOrganization() : null;
  const supabase = await createClient();

  const { data: company } = organization
    ? await supabase
        .from("business_organizations")
        .select("*")
        .eq("id", organization.organizationId)
        .maybeSingle()
    : { data: null };

  /**
   * Qui n'a rien à faire ici.
   *
   * `onboarding_completed_at` renseigné, c'est terminé.
   * `onboarding_step` en dessous de 3, c'est une entreprise créée AVANT
   * ce parcours : la colonne vaut zéro par défaut (migration 0060), et
   * traîner dans un formulaire de bienvenue quelqu'un qui travaille
   * depuis six mois serait pire qu'inutile. Le parcours pose 3 dès la
   * création ; en dessous, il n'a jamais commencé.
   */
  if (company && (company.onboarding_completed_at !== null || company.onboarding_step < 3)) {
    redirect("/");
  }

  // Une appartenance sans fiche lisible : la ligne existe forcément
  // puisqu'on est membre. Plutôt que de proposer d'en créer une
  // deuxième — ce que ferait l'étape 1 —, on renvoie à l'accueil.
  if (organization && !company) redirect("/");

  const draftName = typeof params.nom === "string" ? params.nom.trim().slice(0, 120) : "";

  const requestedStep = Number.parseInt(
    typeof params.etape === "string" ? params.etape : "",
    10,
  );

  // Sans `?etape=`, on reprend là où la base dit qu'on s'est arrêté.
  let step = Number.isFinite(requestedStep)
    ? company
      ? clampStep(requestedStep, 3)
      : Math.min(clampStep(requestedStep, 1), 2)
    : company
      ? clampStep(company.onboarding_step, 3)
      : 1;

  // L'étape 2 n'a de sens qu'avec un nom à confirmer.
  if (!company && step === 2 && !draftName) step = 1;

  const logoUrl = company?.logo_path
    ? supabase.storage.from("organization-logos").getPublicUrl(company.logo_path).data
        .publicUrl
    : null;

  // §12 — l'effectif calculé depuis les comptes actifs : la valeur par
  // défaut de l'étape 5, et le repère de l'étape 8.
  const { data: memberCount } = company
    ? await supabase.rpc("organization_employee_count", { p_organization_id: company.id })
    : { data: null };

  const { data: invitations } =
    company && step >= 7
      ? await supabase
          .from("organization_invitations")
          .select("id, email, role, created_at")
          .eq("organization_id", company.id)
          .eq("status", "pending")
          .order("created_at")
      : { data: null };

  const pending: { id: string; email: string; role: string }[] = invitations ?? [];

  // Ce que la base contient déjà, prêt à repartir en champs cachés.
  const profileValues: Record<string, string> = company
    ? {
        name: company.name ?? "",
        business_type: company.business_type ?? "landscaper",
        legal_name: company.legal_name ?? "",
        trade_name: company.trade_name ?? "",
        legal_form: company.legal_form ?? "",
        siren: company.siren ?? "",
        siret: company.siret ?? "",
        vat_number: company.vat_number ?? "",
        rcs_city: company.rcs_city ?? "",
        share_capital:
          company.share_capital_cents === null || company.share_capital_cents === undefined
            ? ""
            : (company.share_capital_cents / 100).toFixed(2),
        address_line1: company.address_line1 ?? "",
        address_line2: company.address_line2 ?? "",
        postal_code: company.postal_code ?? "",
        city: company.city ?? "",
        country: company.country ?? "FR",
        email: company.email ?? "",
        phone: company.phone ?? "",
        website: company.website ?? "",
        currency: company.currency ?? "EUR",
        locale: company.locale ?? "fr",
        timezone: company.timezone ?? "Europe/Paris",
        employee_count_override:
          company.employee_count_override === null ||
          company.employee_count_override === undefined
            ? ""
            : String(company.employee_count_override),
      }
    : {};

  const disabledModules: string[] = company?.disabled_modules ?? [];
  const inviteError = typeof params.erreur === "string" ? params.erreur : null;
  const invited = params.invitation === "creee";

  return (
    <main className="flex min-h-full flex-1 justify-center px-6 py-12">
      <div className="w-full max-w-2xl">
        <header className="mb-10">
          <div className="mb-6 flex items-center gap-2.5">
            <Image
              src="/oasis-logo.png"
              alt=""
              width={32}
              height={32}
              priority
              className="shrink-0 rounded-md"
            />
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">
              Oasis Care Pro
            </span>
          </div>

          <h1 className="text-[length:var(--text-page)] font-semibold leading-tight tracking-tight text-balance">
            {company ? `Installons ${company.name}` : "Bienvenue dans Oasis Care Pro"}
          </h1>
          <p className="mt-2 max-w-xl text-[var(--text-body)] text-ink-soft">
            Huit étapes, dont cinq facultatives. Vous pouvez fermer cette page et
            reprendre plus tard : ce qui est enregistré reste enregistré.
          </p>
        </header>

        <Stepper step={step} reachable={company !== null} />

        {/* ---------------- 1. Nom de l'entreprise ---------------- */}
        {step === 1 && (
          /* Un formulaire GET : le nom part dans l'URL, et l'étape 2
             survit à un rechargement sans qu'aucune ligne n'ait encore
             été écrite en base. */
          <form action="/bienvenue">
            <input type="hidden" name="etape" defaultValue={2} />
            <Panel
              title="Le nom de votre entreprise"
              description="Celui que vos clients liront en haut de vos devis."
              footer={<SubmitButton>Continuer</SubmitButton>}
            >
              <div className="px-5 py-5">
                <Field
                  label="Nom de l'entreprise"
                  name="nom"
                  required
                  defaultValue={draftName}
                  placeholder="Paysages Martin"
                  hint="Modifiable à tout moment dans la fiche de votre société."
                />
              </div>
            </Panel>
          </form>
        )}

        {/* ---------------- 2. Activité ---------------- */}
        {step === 2 && (
          <>
            <form action={createOrganizationAction}>
              <input type="hidden" name="name" defaultValue={draftName} />
              <Panel
                title="Votre activité"
                description={`${draftName} — paysage, pépinière, ou les deux ?`}
                footer={<SubmitButton>Créer mon espace</SubmitButton>}
              >
                <div className="px-5 py-5">
                  <SelectField
                    label="Activité"
                    name="business_type"
                    defaultValue="landscaper"
                    options={BUSINESS_TYPES.map((type) => ({
                      value: type,
                      label: BUSINESS_TYPE_LABELS[type],
                    }))}
                    hint="Détermine les modules affichés dans le menu. Modifiable à tout moment."
                  />
                </div>
              </Panel>
            </form>
            <StepFooter back={`/bienvenue?etape=1&nom=${encodeURIComponent(draftName)}`} />
          </>
        )}

        {/* ---------------- 3. Logo ---------------- */}
        {step === 3 && company && (
          <>
            <Panel
              title="Votre logo"
              description="Il apparaîtra sur vos devis, vos factures et dans le portail de vos clients."
              footer={
                <form action={goToStep}>
                  <input type="hidden" name="etape" defaultValue={4} />
                  <SubmitButton>Continuer</SubmitButton>
                </form>
              }
            >
              <div className="px-5 py-5">
                {/* Le même téléverseur que la fiche société : il réduit
                    l'image dans le navigateur avant l'envoi. En écrire un
                    second ici aurait produit deux compressions
                    différentes pour un même logo. */}
                <LogoUploader organizationName={company.name} logoUrl={logoUrl} />
              </div>
            </Panel>
            {/* Passer n'a plus de sens une fois le logo posé. */}
            <StepFooter next={4} skipLabel={logoUrl ? undefined : "Passer cette étape"} />
          </>
        )}

        {/* ---------------- 4. Informations légales ---------------- */}
        {step === 4 && company && (
          <>
            <form action={saveProfileStep}>
              <input type="hidden" name="etape" defaultValue={5} />
              <CarriedProfile
                values={profileValues}
                except={[
                  "legal_name",
                  "legal_form",
                  "siren",
                  "siret",
                  "vat_number",
                  "rcs_city",
                  "share_capital",
                ]}
              />
              <Panel
                title="Vos mentions légales"
                description="Ce que la loi vous demande d'imprimer sur un devis et sur une facture."
                footer={<SubmitButton>Continuer</SubmitButton>}
              >
                <fieldset className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                  <Field
                    label="Raison sociale"
                    name="legal_name"
                    defaultValue={profileValues.legal_name}
                    placeholder={company.name}
                  />
                  <Field
                    label="Forme juridique"
                    name="legal_form"
                    defaultValue={profileValues.legal_form}
                    placeholder="SARL, SAS, EI…"
                  />
                  <Field
                    label="SIREN"
                    name="siren"
                    defaultValue={profileValues.siren}
                    placeholder="123 456 789"
                  />
                  <Field
                    label="SIRET"
                    name="siret"
                    defaultValue={profileValues.siret}
                    placeholder="123 456 789 00012"
                    hint="Mention obligatoire sur vos devis et vos factures."
                  />
                  <Field
                    label="TVA intracommunautaire"
                    name="vat_number"
                    defaultValue={profileValues.vat_number}
                  />
                  <Field
                    label="RCS"
                    name="rcs_city"
                    defaultValue={profileValues.rcs_city}
                    placeholder="Nice"
                  />
                  <Field
                    label="Capital social (€)"
                    name="share_capital"
                    defaultValue={profileValues.share_capital}
                    hint="Sans objet pour une entreprise individuelle."
                  />
                </fieldset>
              </Panel>
            </form>
            <StepFooter back="/bienvenue?etape=3" next={5} skipLabel="Passer cette étape" />
          </>
        )}

        {/* ---------------- 5. Nombre de salariés ---------------- */}
        {step === 5 && company && (
          <>
            <form action={saveProfileStep}>
              <input type="hidden" name="etape" defaultValue={6} />
              <CarriedProfile values={profileValues} except={["employee_count_override"]} />
              <Panel
                title="Combien êtes-vous ?"
                description="Sert aux statistiques de charge et aux exports. Rien d'autre n'en dépend."
                footer={<SubmitButton>Continuer</SubmitButton>}
              >
                <div className="px-5 py-5">
                  {/* §12 — « calculer automatiquement depuis les membres
                      actifs. Permettre override manuel. » Le champ vide
                      ne veut donc pas dire « zéro salarié », mais
                      « comptez-les vous-même ». */}
                  <Field
                    label="Nombre de salariés"
                    name="employee_count_override"
                    type="number"
                    defaultValue={profileValues.employee_count_override}
                    placeholder={String(memberCount ?? 1)}
                    hint={`Laissé vide, l'effectif est celui des comptes actifs — ${
                      memberCount ?? 1
                    } aujourd'hui, vous compris. Renseignez-le si votre effectif réel est différent.`}
                  />
                </div>
              </Panel>
            </form>
            <StepFooter back="/bienvenue?etape=4" next={6} skipLabel="Passer cette étape" />
          </>
        )}

        {/* ---------------- 6. Modules souhaités ---------------- */}
        {step === 6 && company && (
          <>
            <form action={saveModulesStep}>
              <Panel
                title="Ce que votre menu affiche"
                description="Éteignez ce dont vous ne vous servez pas. C'est du rangement, pas un droit."
                footer={<SubmitButton>Continuer</SubmitButton>}
              >
                <fieldset className="divide-y divide-line">
                  {TOGGLEABLE_MODULES.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-canvas"
                    >
                      {/* La case cochée vaut « module affiché ».
                          `updateModules` enregistre l'inverse — une case
                          décochée n'envoie rien en HTML, et sans ce
                          renversement éteindre un module serait
                          indiscernable d'un formulaire non soumis. */}
                      <input
                        type="checkbox"
                        name="module"
                        value={key}
                        defaultChecked={!disabledModules.includes(key)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className="flex h-6 w-10 shrink-0 items-center rounded-[var(--radius-pill)] border border-line-strong bg-surface-sunken p-[3px] transition-colors after:h-4 after:w-4 after:rounded-[var(--radius-pill)] after:bg-ink-faint after:transition-transform peer-checked:border-accent peer-checked:bg-accent-wash peer-checked:after:translate-x-4 peer-checked:after:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
                      />
                      <span className="text-[var(--text-body)] font-medium">
                        {MODULE_LABELS[key]}
                      </span>
                    </label>
                  ))}
                </fieldset>

                <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
                  Masquer un module ne supprime rien et ne ferme aucun accès : les
                  droits se donnent par les rôles, et votre abonnement ne bouge
                  pas. Tout se rallume dans les paramètres.
                </p>
              </Panel>
            </form>
            <StepFooter back="/bienvenue?etape=5" next={7} skipLabel="Passer cette étape" />
          </>
        )}

        {/* ---------------- 7. Inviter l'équipe ---------------- */}
        {step === 7 && company && (
          <>
            <form action={inviteStep}>
              <Panel
                title="Invitez votre équipe"
                description="Chacun ne voit que ce que son rôle autorise. Vous pouvez en inviter plusieurs de suite."
                count={pending.length > 0 ? pending.length : undefined}
                footer={<SubmitButton variant="secondary">Créer l&apos;invitation</SubmitButton>}
              >
                <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                  <Field
                    label="Adresse e-mail"
                    name="email"
                    type="email"
                    placeholder="prenom@entreprise.fr"
                  />
                  <SelectField
                    label="Rôle"
                    name="role"
                    defaultValue="fieldWorker"
                    options={ROLES.filter((role) => role !== "custom").map((role) => ({
                      value: role,
                      label: ROLE_LABELS[role],
                    }))}
                    hint="Modifiable à tout moment dans l'équipe."
                  />
                </div>

                {invited && (
                  <p className="mx-5 mb-5 rounded-[var(--radius-control)] bg-positive-wash px-3.5 py-2.5 text-[var(--text-secondary)] text-positive">
                    Invitation créée.
                  </p>
                )}
                {inviteError && (
                  <p className="mx-5 mb-5 rounded-[var(--radius-control)] bg-critical-wash px-3.5 py-2.5 text-[var(--text-secondary)] text-critical">
                    {inviteError}
                  </p>
                )}

                {pending.length > 0 && (
                  <ul className="divide-y divide-line border-t border-line">
                    {pending.map((invitation) => (
                      <li
                        key={invitation.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                      >
                        <span className="min-w-0 truncate text-[var(--text-body)]">
                          {invitation.email}
                        </span>
                        <Badge tone="neutral">
                          {ROLE_LABELS[invitation.role as Role] ?? invitation.role}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}

                {/* L'honnêteté du §14 : la ligne existe, le message n'est
                    pas parti. Le produit n'a aucun service d'envoi, et un
                    « invitation envoyée » serait un mensonge que personne
                    ne rattraperait. */}
                <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
                  Oasis Care Pro n&apos;envoie pas d&apos;e-mail : l&apos;invitation crée un
                  lien, à copier depuis Entreprise › Équipe et à transmettre
                  vous-même.
                </p>
              </Panel>
            </form>
            <StepFooter
              back="/bienvenue?etape=6"
              next={8}
              skipLabel={pending.length > 0 ? "Continuer" : "Passer cette étape"}
              skipVariant={pending.length > 0 ? "secondary" : "ghost"}
            />
          </>
        )}

        {/* ---------------- 8. Terminer ---------------- */}
        {step === 8 && company && (
          <>
            <form action={finishOnboarding}>
              <Panel
                title="Tout est prêt"
                description="Voici ce qui est enregistré. Le reste se complétera quand vous en aurez besoin."
                footer={<SubmitButton>Entrer dans Oasis Care Pro</SubmitButton>}
              >
                <dl className="divide-y divide-line">
                  {[
                    { label: "Entreprise", value: company.name as string },
                    {
                      label: "Activité",
                      value: BUSINESS_TYPE_LABELS[company.business_type as BusinessType] ?? null,
                    },
                    { label: "Logo", value: logoUrl ? "Enregistré" : null },
                    { label: "SIRET", value: profileValues.siret || null },
                    {
                      label: "Salariés",
                      value:
                        profileValues.employee_count_override ||
                        `${memberCount ?? 1} — comptés depuis les comptes actifs`,
                    },
                    {
                      label: "Modules masqués",
                      value:
                        disabledModules.length === 0
                          ? "Aucun"
                          : disabledModules
                              .map((key) => MODULE_LABELS[key as ModuleKey] ?? key)
                              .join(" · "),
                    },
                    {
                      label: "Invitations en attente",
                      value: pending.length > 0 ? String(pending.length) : null,
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3"
                    >
                      <dt className="text-[var(--text-secondary)] text-ink-soft">{row.label}</dt>
                      {/* Un tiret plutôt qu'un zéro ou qu'un « non
                          renseigné » alarmant : ces champs sont
                          facultatifs, et ne pas les avoir remplis n'est
                          pas une faute. */}
                      <dd
                        className={`text-[var(--text-body)] ${
                          row.value ? "font-medium" : "text-ink-faint"
                        }`}
                      >
                        {row.value ?? "—"}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
                  Tout cela se modifie dans Entreprise › Ma société. Vous
                  n&apos;aurez plus à repasser par cette page.
                </p>
              </Panel>
            </form>
            <StepFooter back="/bienvenue?etape=7" />
          </>
        )}
      </div>
    </main>
  );
}
