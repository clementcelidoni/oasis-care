import type { Metadata } from "next";

import { GapList } from "@/components/customers/facts";
import { ActionCard, EmptyState, Notice, PageHeader, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { MOBILE_GAPS } from "@/lib/customers/gaps";

/**
 * ==================================================================
 * OASIS CARE MOBILE — un écran qui explique au lieu de lister
 * ==================================================================
 *
 * Spec p.5 (barre latérale) et p.8-9 (la fiche mobile). Cet écran ne
 * peut pas être une liste, et le dire est plus utile que de faire
 * semblant.
 *
 * ------------------------------------------------------------------
 * LE FAIT, VÉRIFIÉ SUR LA VRAIE BASE
 * ------------------------------------------------------------------
 * RIEN n'enregistre par quelle application un compte est entré. Le seul
 * proxy imaginable — « posséder un espace personnel » — est faux : le
 * trigger `on_auth_user_created` (migration 0001) crée « Mon espace »
 * pour TOUT nouveau compte, y compris celui qui n'ouvrira jamais
 * l'iPhone. Le comptage le confirme : autant d'espaces personnels que
 * de comptes, exactement.
 *
 * `admin_list_users(p_filter => 'mobile')` LÈVE donc une exception.
 * Cette page ne l'appelle pas — ni avec ce filtre, ni avec un autre :
 * afficher ici la liste complète des comptes sous le titre « Oasis Care
 * Mobile » serait la seule chose pire que de n'afficher personne.
 *
 * ------------------------------------------------------------------
 * POURQUOI L'ENTRÉE RESTE DANS LA BARRE LATÉRALE
 * ------------------------------------------------------------------
 * Parce que la question est légitime, et que « nous ne le mesurons pas,
 * voici ce qu'il faudrait enregistrer » est une vraie réponse — la
 * seule qui puisse se transformer en décision. Une entrée retirée
 * aurait fait croire que la question ne s'était jamais posée.
 */

export const metadata: Metadata = {
  title: "Oasis Care Mobile — Oasis Care Control Center",
};

export default async function UtilisateursMobilePage() {
  await requireAdmin("platform.users.read");

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Oasis Care Mobile"
        subtitle="Qui utilise l'application iPhone. La plateforme ne l'enregistre nulle part — et cet écran explique ce qu'il faudrait pour le savoir."
      />

      <Notice tone="unknown" title="Cette liste n'existe pas, et ce n'est pas un écran en retard">
        Aucune colonne de cette base ne dit par quelle application un compte est entré. La liste
        des « utilisateurs Mobile » ne peut donc pas être construite — ni ici, ni ailleurs, ni en
        cherchant mieux.
      </Notice>

      <EmptyState
        tone="unknown"
        title="Le proxy évident est faux, et il est important de savoir pourquoi"
        description="On pourrait croire qu'un utilisateur Mobile est un compte qui possède un espace personnel. C'est faux : le trigger on_auth_user_created crée « Mon espace » pour tout nouveau compte, y compris celui qui n'ouvrira jamais l'iPhone. Vérifié sur la base — il y a exactement autant d'espaces personnels que de comptes. Ce filtre-là rendrait donc la plateforme entière sous une étiquette qui ne serait vraie pour personne."
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Ce qu'il faudrait enregistrer"
          description="Deux chemins, l'un exact et lent, l'autre approximatif et immédiat."
        >
          <div className="flex flex-col gap-3 px-4 py-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
            <p>
              <strong className="font-medium text-ink">Le chemin exact.</strong> Une colonne
              d&apos;origine sur <code className="font-mono text-[12px]">profiles</code>, renseignée
              à l&apos;inscription par l&apos;application qui crée le compte. Elle ne dira la vérité
              que pour les comptes créés APRÈS sa mise en place : ce qui n&apos;a pas été
              enregistré hier ne le sera jamais.
            </p>
            <p>
              <strong className="font-medium text-ink">Le chemin approximatif.</strong> Un compteur
              d&apos;activité réellement mobile — jardins ou plantes créés, dernière
              synchronisation. Il fonctionnerait rétroactivement, mais il mesurerait l&apos;usage,
              pas l&apos;origine : un professionnel qui soigne ses plantes le week-end y
              apparaîtrait comme un particulier.
            </p>
          </div>
        </Panel>

        <Panel
          title="La fiche mobile de la spec (p.9)"
          description="Ce que la spec veut afficher pour un utilisateur mobile, et où chaque champ en est."
        >
          <GapList gaps={MOBILE_GAPS} />
        </Panel>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <ActionCard
          title="Tous les utilisateurs"
          description="La liste complète des comptes, sans prétendre savoir lesquels sont mobiles."
          href="/utilisateurs"
        />
        <ActionCard
          title="Oasis Care Pro"
          description="Les comptes rattachés à une entreprise. Celle-là, la base sait la calculer."
          href="/utilisateurs/pro"
        />
      </div>
    </>
  );
}
