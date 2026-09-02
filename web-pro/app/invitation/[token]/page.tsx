import Link from "next/link";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui";
import { acceptInvitation } from "@/lib/portal/actions";

/**
 * §11S — la porte d'entrée du client.
 *
 * Route PUBLIQUE : `proxy.ts` laisse passer `/invitation` sans session,
 * parce que la personne qui arrive ici n'a souvent pas encore de compte
 * du tout. C'est le seul endroit du produit où un inconnu peut atterrir
 * avec un jeton et repartir avec un accès.
 *
 * D'où deux règles tenues à l'écran :
 *
 *  1. On dit QUI invite avant de proposer d'accepter. Un bouton
 *     « Accepter » sans nom d'entreprise, c'est ce qu'on apprend à
 *     tout le monde à ne pas cliquer.
 *  2. Le détail de l'invitation ne s'affiche qu'une fois connecté —
 *     `client_invitation_preview` refuse de répondre à un compte
 *     anonyme. Un porteur de jeton qui n'est pas le destinataire
 *     n'apprend donc rien en ouvrant le lien.
 */
export default async function InvitationPage({
  params,
}: PageProps<"/invitation/[token]">) {
  const { token } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Shell title="Vous êtes invité">
        <p className="text-sm text-ink-soft">
          Un professionnel vous invite à consulter vos devis, vos factures et
          l&apos;avancement de votre chantier dans Oasis Care.
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Connectez-vous — ou créez votre compte Oasis Care, c&apos;est
          gratuit — pour voir de qui vient cette invitation.
        </p>
        <Link
          href={`/login?next=/invitation/${encodeURIComponent(token)}`}
          className="mt-6 inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
        >
          Se connecter
        </Link>
      </Shell>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("client_invitation_preview", { p_token: token });
  const invitation = (data ?? [])[0] as
    | { company_name: string; expires_at: string; accepted: boolean }
    | undefined;

  if (!invitation) {
    return (
      <Shell title="Ce lien ne mène nulle part">
        <p className="text-sm text-ink-soft">
          Cette invitation n&apos;existe pas, ou elle a été annulée. Demandez un
          nouveau lien à votre professionnel.
        </p>
      </Shell>
    );
  }

  const expired = new Date(invitation.expires_at) < new Date();

  if (invitation.accepted) {
    return (
      <Shell title="Invitation déjà utilisée">
        <p className="text-sm text-ink-soft">
          Cette invitation a déjà servi. Si c&apos;est vous qui l&apos;avez
          acceptée, votre espace est là.
        </p>
        <Link
          href="/portail"
          className="mt-6 inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
        >
          Ouvrir mon espace
        </Link>
      </Shell>
    );
  }

  if (expired) {
    return (
      <Shell title="Invitation expirée">
        <p className="text-sm text-ink-soft">
          Les invitations sont valables 30 jours. Celle-ci a dépassé sa date —
          demandez-en une nouvelle à {invitation.company_name}.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={`${invitation.company_name} vous invite`}>
      <p className="text-sm text-ink-soft">
        En acceptant, vous accédez à vos devis, vos factures et
        l&apos;avancement de vos chantiers chez{" "}
        <strong className="text-ink">{invitation.company_name}</strong>.
      </p>
      <p className="mt-3 text-sm text-ink-soft">
        Vous serez connecté avec <strong className="text-ink">{user.email}</strong>.
        C&apos;est ce compte qui recevra l&apos;accès.
      </p>

      <form action={acceptInvitation} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Accepter l&apos;invitation</SubmitButton>
      </form>

      <p className="mt-4 text-xs text-ink-faint">
        Vous pourrez fermer cet accès à tout moment. Accepter ne donne à{" "}
        {invitation.company_name} aucun droit nouveau sur vos données
        personnelles.
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 h-10 w-10 rounded-lg bg-accent" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-3">{children}</div>
      </div>
    </main>
  );
}
