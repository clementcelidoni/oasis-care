import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { OasisTabs } from "../OasisTabs";
import { Assistant } from "../Assistant";

/**
 * §11V — ASK OASIS. L'assistant de la phase 11U, déplacé dans l'espace
 * de travail sans rien perdre en route.
 *
 * ─── CE QU'IL FAIT QUE LE BRIEFING NE FAIT PAS ───
 *
 * Le Daily et le centre de décision sont du SQL : des faits datés, des
 * sommes lues, un classement déterministe. Le modèle n'y sert à rien.
 * Ici, il sert : « quels végétaux commander pour les chantiers signés »
 * suppose de croiser chantiers, stock, réservations et commandes, et
 * aucune requête écrite d'avance ne couvre toutes les questions qu'un
 * chef d'entreprise pose.
 *
 * ─── ET CE QU'IL NE FAIT TOUJOURS PAS ───
 *
 * Il ne déclenche aucune écriture. Quinze écritures lui sont ouvertes
 * (0069) et il n'en lance aucune : il PROPOSE, l'écran met la
 * proposition en français à partir de paramètres typés, et
 * l'utilisateur clique. Ce qui engage juridiquement ou ne se rejoue pas
 * — envoyer, facturer, encaisser, supprimer, livrer, toucher aux droits
 * — n'a tout simplement pas d'outil.
 *
 * C'est la même frontière que le moteur d'actions du centre de
 * décision, tenue par un autre moyen : là-bas, une approbation
 * enregistrée ; ici, l'absence d'outil.
 */
export default async function AskOasisPage({ searchParams }: PageProps<"/oasis-ai/demander">) {
  const organization = await requireOrganization();
  const params = await searchParams;

  // La question amorcée depuis une décision. Bornée : un lien forgé ne
  // doit pas pouvoir remplir le champ d'un roman, et l'assistant refuse
  // de toute façon au-delà de 2 000 caractères.
  const initialQuestion =
    typeof params.q === "string" ? params.q.slice(0, 500) : undefined;

  const supabase = await createClient();
  const { data: usage } = await supabase
    .from("ai_pro_usage")
    .select("used")
    .eq("organization_id", organization.organizationId)
    .eq("period", new Date().toISOString().slice(0, 7))
    .maybeSingle();

  const { count: openDecisions } = await supabase
    .from("ai_decisions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization.organizationId)
    .in("status", ["new", "reviewed", "snoozed"]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Demander à Oasis"
        subtitle={`Une question sur les données de ${organization.name} — devis, chantiers, stock, factures. Il répond à partir d'elles, et prépare ce que vous lui demandez.`}
      />

      <OasisTabs current="/oasis-ai/demander" openDecisions={openDecisions ?? 0} />

      <div className="max-w-3xl">
        <Assistant permissions={organization.permissions} initialQuestion={initialQuestion} />

        {/* §32 : dire ce qu'il peut ET ce qu'il ne peut pas, au même
            endroit. Une liste de capacités sans sa limite laisse
            l'utilisateur découvrir la limite au moment où il compte
            dessus — c'est-à-dire au pire moment. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface-sunken px-4 py-3">
            <p className="text-[var(--text-secondary)] font-medium">Il peut préparer</p>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Un client ou un prospect, une opportunité, une note d&apos;échange, un
              brouillon de devis et ses lignes, un article de catalogue, un chantier
              avec ses phases et ses tâches, une intervention au planning, un lot de
              pépinière, un mouvement de stock, une commande fournisseur en brouillon.
              Chaque fois : une proposition, et votre clic.
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-surface-sunken px-4 py-3">
            <p className="text-[var(--text-secondary)] font-medium">Il ne peut pas</p>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Envoyer un devis, émettre une facture ou un avoir, encaisser un règlement,
              envoyer une commande, réceptionner une marchandise, valider un pointage,
              faire signer une intervention, livrer un jardin, supprimer ou archiver
              quoi que ce soit, ni modifier les droits d&apos;un membre. Ces gestes
              engagent, ou ne se rejouent pas.
            </p>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-ink-faint">
          {usage?.used ? `${usage.used} question(s) ce mois-ci. ` : ""}
          Les montants qu&apos;Oasis cite viennent de vos données, mais relisez-les avant
          de vous engager dessus. Chaque écriture qu&apos;il prépare est signée « Oasis
          AI » dans le journal des opérations, avec votre nom et l&apos;heure.
        </p>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
