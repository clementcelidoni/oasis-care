import type { ReactNode } from "react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getActiveOrganization, getUserOrganizations } from "@/lib/auth/organization";
import { switchOrganization } from "@/lib/auth/organizationActions";
import { signOut } from "@/lib/auth/session";
import { updateDisplayName } from "@/lib/auth/profileActions";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/crm/types";
import {
  PageHeader, Panel, Field, SubmitButton, Badge, ButtonLink, EmptyState,
  ConfirmDialog, UserAvatar, CompanyAvatar,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";

/**
 * §17 MON PROFIL — le compte de la PERSONNE, pas celui de l'entreprise.
 *
 * La distinction est tout l'intérêt de cette page. « Ma société » (§11)
 * répond à « qui facturons-nous, et sous quel SIRET » ; celle-ci répond
 * à « qui suis-je, comment j'entre, et chez qui ». Un même compte peut
 * appartenir à plusieurs entreprises avec un rôle différent dans
 * chacune — c'est écrit ici, et nulle part ailleurs.
 *
 * §1 : quatre panneaux, quatre questions, de l'air. Il n'y a qu'un seul
 * champ modifiable sur tout l'écran ; le reste est un état de fait, et
 * un état de fait n'est pas un formulaire.
 */

/**
 * Les fournisseurs d'identité, en français.
 *
 * `email` ne veut pas dire « mot de passe » : dans ce produit,
 * l'authentification par e-mail est un LIEN MAGIQUE. Écrire « E-mail »
 * laisserait croire à un couple identifiant/mot de passe qui n'existe
 * pas.
 */
const PROVIDER_LABELS: Record<string, string> = {
  email: "Lien magique par e-mail",
  apple: "Apple",
  google: "Google",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  // La mise en page a déjà renvoyé les visiteurs déconnectés ; ce
  // garde-fou n'existe que pour le typage.
  if (!user) return null;

  const supabase = await createClient();
  const [{ data: profile }, organizations, active] = await Promise.all([
    // `profiles` (migration 0001) : lecture et écriture réservées à sa
    // propre ligne par RLS. Rien à filtrer de plus ici — demander la
    // ligne d'un autre ne renverrait rien.
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
    getUserOrganizations(),
    getActiveOrganization(),
  ]);

  const metadata = user.user_metadata ?? {};

  // Le header lit `full_name` : c'est donc lui qui fait foi à l'écran,
  // et `profiles.display_name` ne sert que de repli pour les comptes
  // dont les métadonnées n'ont jamais été renseignées.
  const displayName =
    (metadata.full_name as string | undefined)?.trim() ||
    profile?.display_name?.trim() ||
    "";

  // Apple et Google fournissent une photo ; le lien magique, non. On ne
  // propose pas d'en téléverser une : il n'existe pas de seau de
  // stockage pour les avatars, et un bouton qui échoue vaut moins que
  // des initiales assumées.
  const avatarUrl =
    (metadata.avatar_url as string | undefined) ||
    (metadata.picture as string | undefined) ||
    profile?.avatar_url ||
    null;

  // `identities` liste ce qui est réellement rattaché au compte. Une
  // même adresse peut être arrivée par Apple ET par Google ; les deux
  // ouvrent la même session, et le dire évite le « pourquoi ça marche
  // aussi comme ça ».
  const providers = (user.identities ?? [])
    .map((identity) => identity.provider)
    .filter((value, index, all) => all.indexOf(value) === index);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Mon profil"
        subtitle="Votre compte personnel. Il vous suit d'une entreprise à l'autre, et c'est le même que dans l'application Oasis Care sur votre téléphone."
      />

      {/* §17 — le seul champ modifiable de la page. */}
      <form action={updateDisplayName}>
        <Panel
          title="Identité"
          description="Le nom sous lequel vos collègues vous voient."
          className="mb-4"
          footer={<SubmitButton variant="secondary">Enregistrer</SubmitButton>}
        >
          <div className="flex flex-wrap items-start gap-5 px-5 py-5">
            <div className="flex w-32 shrink-0 flex-col items-center gap-2 text-center">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-14 w-14 rounded-full border border-line object-cover"
                />
              ) : (
                <UserAvatar name={displayName || user.email || "?"} size="lg" />
              )}
              <span className="text-[var(--text-secondary)] text-ink-faint">
                {avatarUrl
                  ? "Photo issue de votre compte Apple ou Google."
                  : "Vos initiales tiennent lieu d'avatar."}
              </span>
            </div>

            <div className="min-w-56 flex-1">
              <Field
                label="Nom affiché"
                name="display_name"
                defaultValue={displayName}
                placeholder="Prénom Nom"
                hint="Il apparaît en haut à droite, dans l'historique des modifications, et à côté des interventions que vous réalisez."
              />
            </div>
          </div>
        </Panel>
      </form>

      {/* §17 — comment on entre. Aucune action ici : rien de tout cela
          ne se change depuis l'application, et l'écran le dit plutôt que
          d'offrir des boutons qui échoueraient. */}
      <Panel title="Connexion" description="Comment vous accédez à votre compte." className="mb-4">
        <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Row label="Adresse e-mail" value={user.email ?? "—"} />
          <Row
            label="Méthode de connexion"
            value={
              providers.length === 0 ? (
                "—"
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {providers.map((provider) => (
                    <Badge key={provider} tone="accent">
                      {PROVIDER_LABELS[provider] ?? provider}
                    </Badge>
                  ))}
                </span>
              )
            }
          />
          <Row label="Compte créé le" value={formatDate(user.created_at)} />
          <Row label="Dernière connexion" value={formatDate(user.last_sign_in_at)} />
        </dl>

        <div className="border-t border-line px-5 py-4">
          <p className="text-[var(--text-body)] text-ink-soft">
            <strong className="font-medium text-ink">
              Il n&apos;y a pas de mot de passe à changer.
            </strong>{" "}
            Oasis Care ne connaît que trois façons d&apos;entrer : un lien envoyé
            à votre adresse, Apple, ou Google. Personne ne peut donc deviner un
            mot de passe que vous n&apos;avez jamais créé — mais gardez votre
            boîte mail bien protégée : c&apos;est elle qui tient la clé.
          </p>
          <p className="mt-3 text-[var(--text-secondary)] text-ink-faint">
            Changer d&apos;adresse e-mail n&apos;est pas encore possible ici : la
            nouvelle devrait être vérifiée avant que l&apos;ancienne cesse de
            fonctionner, et ce parcours n&apos;existe pas.
          </p>
        </div>
      </Panel>

      {/* §13 MULTI-ENTREPRISES — un compte, plusieurs employeurs. Le
          rôle change d'une entreprise à l'autre, et c'est le rôle qui
          décide de ce qui s'affiche : le voir écrit répond à la moitié
          des « pourquoi je n'ai pas ce menu ». */}
      <Panel
        title="Mes entreprises"
        description="Les organisations auxquelles ce compte appartient, et votre rôle dans chacune."
        count={organizations.length}
        className="mb-4"
      >
        {organizations.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="Aucune entreprise pour le moment"
              description="Créez votre entreprise pour commencer à saisir vos clients, vos devis et vos chantiers."
              icon={<Icon name="company" className="h-5 w-5" />}
              action={<ButtonLink href="/bienvenue">Créer mon entreprise</ButtonLink>}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {organizations.map((organization) => {
              const isActive = organization.organizationId === active?.organizationId;
              return (
                <li
                  key={organization.organizationId}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <CompanyAvatar name={organization.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[var(--text-body)] font-medium">
                      {organization.name}
                    </p>
                    <p className="truncate text-[var(--text-secondary)] text-ink-soft">
                      {ROLE_LABELS[organization.role]}
                    </p>
                  </div>
                  {isActive ? (
                    <Badge tone="accent">Entreprise active</Badge>
                  ) : (
                    <form action={switchOrganization}>
                      <input
                        type="hidden"
                        name="organization_id"
                        value={organization.organizationId}
                      />
                      <SubmitButton variant="secondary">Basculer</SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* §18 DÉCONNEXION — avec sa confirmation, parce qu'on clique
          dessus en visant autre chose. */}
      <Panel title="Session">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <p className="min-w-56 flex-1 text-[var(--text-body)] text-ink-soft">
            Se déconnecter ferme cette session sur cet ordinateur. Vos données
            restent enregistrées : vous les retrouverez à la prochaine connexion,
            ici comme sur votre téléphone.
          </p>
          <ConfirmDialog
            triggerLabel={
              <>
                <Icon name="logout" className="h-4 w-4" />
                Se déconnecter
              </>
            }
            triggerVariant="secondary"
            title="Se déconnecter ?"
            message="Vos données restent enregistrées. Vous les retrouverez à la prochaine connexion, ici comme dans l'application Oasis Care."
            confirmLabel="Se déconnecter"
            action={signOut}
          />
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[var(--text-secondary)] font-medium text-ink-soft">{label}</dt>
      <dd className="mt-1 text-[var(--text-body)]">{value}</dd>
    </div>
  );
}
