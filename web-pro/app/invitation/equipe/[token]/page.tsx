import Link from "next/link";
import type { ReactNode } from "react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { acceptTeamInvitation } from "@/lib/company/teamActions";

/**
 * §14 — l'autre bout du lien « Inviter un membre ».
 *
 * Route PUBLIQUE (`proxy.ts` laisse passer tout `/invitation`), parce
 * que la personne invitée n'a souvent pas encore de compte du tout.
 *
 * Un chemin distinct de `/invitation/[token]`, qui appartient au
 * PORTAIL CLIENT : ce sont deux tables, deux fonctions d'acceptation et
 * deux natures d'accès — un client qui consulte ses factures, contre un
 * collègue qui entre dans l'ERP. Les confondre donnerait à l'un des
 * deux un « lien invalide » sans explication.
 *
 * CE QUE CETTE PAGE NE PEUT PAS DIRE, ET POURQUOI. Le portail client
 * annonce le nom de l'entreprise avant de proposer d'accepter, ce qui
 * est la bonne façon de faire. Ici, c'est impossible : tant qu'on n'est
 * pas membre, RLS refuse la lecture de `business_organizations`, et il
 * n'existe pas de fonction d'aperçu équivalente à
 * `client_invitation_preview`. Plutôt que d'afficher un nom que la page
 * aurait dû recevoir du lien — donc un nom que n'importe qui pourrait
 * écrire — elle affiche ce qu'elle sait vraiment : à quelle adresse
 * l'invitation a été émise, pour quel rôle, et jusqu'à quand. Le nom de
 * l'entreprise, c'est la personne qui a transmis le lien qui le dit.
 *
 * Ce que la page ne dit pas, la base le vérifie : l'invitation est
 * NOMINATIVE. `accept_organization_invitation()` refuse un jeton dont
 * l'adresse ne correspond pas au compte connecté, et la politique de
 * lecture applique la même règle — un porteur de jeton qui n'est pas le
 * destinataire n'apprend rien en ouvrant cette page.
 */
export default async function TeamInvitationPage({
  params,
}: PageProps<"/invitation/equipe/[token]">) {
  const { token } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Shell title="Vous êtes invité à rejoindre une équipe">
        <p className="text-[var(--text-body)] text-ink-soft">
          Un professionnel vous invite à travailler avec lui dans Oasis Care Pro :
          chantiers, devis, planning et pointages.
        </p>
        <p className="mt-3 text-[var(--text-body)] text-ink-soft">
          Connectez-vous — ou créez votre compte — avec l&apos;adresse à laquelle
          ce lien vous a été transmis. L&apos;invitation est nominative : une
          autre adresse ne l&apos;ouvrira pas.
        </p>
        <Link
          href={`/login?next=/invitation/equipe/${encodeURIComponent(token)}`}
          className="mt-6 inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink"
        >
          Se connecter
        </Link>
      </Shell>
    );
  }

  const supabase = await createClient();
  // La politique « Invitees can read their own invitation » (0043) filtre
  // sur l'adresse du compte connecté. Une réponse vide veut donc dire
  // « ce jeton n'existe pas » OU « il n'a pas été émis pour vous », et
  // c'est très bien ainsi : distinguer les deux cas renseignerait un
  // porteur de jeton qui n'est pas le destinataire.
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select("role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!invitation) {
    return (
      <Shell title="Ce lien ne mène nulle part">
        <p className="text-[var(--text-body)] text-ink-soft">
          Cette invitation n&apos;existe pas, elle a été annulée, ou elle a été
          émise pour une autre adresse que{" "}
          <strong className="text-ink">{user.email}</strong>. Demandez un nouveau
          lien à la personne qui vous a invité.
        </p>
      </Shell>
    );
  }

  if (invitation.status === "accepted") {
    return (
      <Shell title="Invitation déjà utilisée">
        <p className="text-[var(--text-body)] text-ink-soft">
          Cette invitation a déjà servi. Si c&apos;est vous qui l&apos;avez
          acceptée, votre espace de travail est là.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink"
        >
          Ouvrir Oasis Care Pro
        </Link>
      </Shell>
    );
  }

  if (invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
    return (
      <Shell title="Invitation expirée">
        <p className="text-[var(--text-body)] text-ink-soft">
          Les invitations d&apos;équipe sont valables quatorze jours. Celle-ci a
          dépassé sa date — demandez-en une nouvelle.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Rejoindre l'équipe">
      <p className="text-[var(--text-body)] text-ink-soft">
        Vous avez été invité à rejoindre une entreprise sur Oasis Care Pro avec le
        rôle de{" "}
        <strong className="text-ink">
          {ROLE_LABELS[invitation.role as Role] ?? invitation.role}
        </strong>
        .
      </p>
      <p className="mt-3 text-[var(--text-body)] text-ink-soft">
        Vous rejoindrez avec <strong className="text-ink">{user.email}</strong> :
        c&apos;est ce compte qui recevra l&apos;accès.
      </p>

      <form action={acceptTeamInvitation} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Rejoindre l&apos;équipe</SubmitButton>
      </form>

      <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
        Le nom de l&apos;entreprise ne s&apos;affiche qu&apos;une fois entré : tant
        que vous n&apos;êtes pas membre, Oasis ne vous laisse rien lire de ses
        données — pas même son nom. Si vous ne savez pas qui vous invite,
        demandez-le avant d&apos;accepter.
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 h-10 w-10 rounded-[var(--radius-control)] bg-accent" aria-hidden />
        <h1 className="text-[length:var(--text-page)] font-semibold tracking-tight">{title}</h1>
        <div className="mt-3">{children}</div>
      </div>
    </main>
  );
}
