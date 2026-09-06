import Link from "next/link";

import { PageHeader, Panel, Badge, EmptyState, ButtonLink } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

import { dupliquerModele, archiverModele } from "../actions.ts";
import { droitsEtiquettes } from "../droits.ts";
import { FAMILLES, LIBELLE_FAMILLE } from "../familles.ts";
import { lireModeles, SocleManquant } from "../lecture.ts";
import { LIBELLE_CHAMP } from "../modeles.ts";
import { SocleAbsent } from "../SocleAbsent";

/**
 * § 18 — LES MODÈLES, RANGÉS PAR FAMILLE.
 *
 * « BioLab, Nursery et Jardins doivent pouvoir avoir leurs propres
 *   modèles. »
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX SORTES DE MODÈLES, ET LA DIFFÉRENCE EST VISIBLE
 * ══════════════════════════════════════════════════════════════════
 *
 *   • CEUX D'OASIS — semés par la migration 0090 § 8.b, un par
 *     famille, avec `organization_id` à NULL. Lisibles par tous,
 *     modifiables par personne : c'est ce qui garantit qu'un éditeur ne
 *     s'ouvre jamais vide, sans avoir à semer trois lignes dans chaque
 *     entreprise créée.
 *   • CEUX DE L'ENTREPRISE — nés d'une duplication, et c'est le seul
 *     chemin de création. Partir d'un modèle juste et le retoucher vaut
 *     mieux que de poser douze champs sur une étiquette vide avant de
 *     voir quoi que ce soit.
 */

export const metadata = { title: "Modèles d'étiquette" };

export default async function ModelesPage() {
  const organization = await requireOrganization();
  const droits = droitsEtiquettes(organization);
  const supabase = await createClient();

  let modeles: Awaited<ReturnType<typeof lireModeles>>;
  try {
    modeles = await lireModeles(supabase);
  } catch (erreur) {
    // Sans la migration 0090, la table des modèles n'existe pas. On le
    // dit plutôt que de laisser Next afficher une trace d'exception.
    if (!(erreur instanceof SocleManquant)) throw erreur;
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader
          title="Modèles d'étiquette"
          breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }}
        />
        <SocleAbsent detail={erreur.detail} />
      </div>
    );
  }

  if (!droits.peutLire) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader
          title="Modèles d'étiquette"
          breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }}
        />
        <EmptyState
          title="Pas d'accès aux étiquettes"
          description="Consulter les modèles demande le droit « étiquettes »."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <PageHeader
        title="Modèles d'étiquette"
        subtitle="Ce qui est imprimé, et où. Chaque monde a ses champs utiles : un lot de culture n'a pas de cultivar de jardin, une plante de jardin n'a pas de numéro de lot."
        breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }}
      />

      {FAMILLES.map((famille) => {
        const deLaFamille = modeles.filter((m) => m.famille === famille);
        return (
          <section key={famille} className="mt-6">
            <Panel title={LIBELLE_FAMILLE[famille]} count={deLaFamille.length}>
              {deLaFamille.length === 0 ? (
                <p className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
                  Aucun modèle pour cette famille — pas même celui d&apos;Oasis, ce qui est
                  anormal : la migration en sème un par famille. Prévenez votre administrateur.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {deLaFamille.map((modele) => (
                    <li key={modele.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/etiquettes/modeles/${modele.id}`}
                              className="text-[var(--text-body)] font-medium hover:underline"
                            >
                              {modele.nom}
                            </Link>
                            {modele.organizationId === null && <Badge tone="info">Oasis</Badge>}
                            {modele.estDefaut && <Badge tone="accent">par défaut</Badge>}
                          </div>
                          <p className="tabular mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                            {modele.largeurMm} × {modele.hauteurMm} mm — marge {modele.margeMm} mm
                            — {modele.champs.length} champ
                            {modele.champs.length > 1 ? "s" : ""}
                          </p>
                          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
                            {modele.champs.length === 0
                              ? "Aucun champ : ce modèle imprimerait une étiquette blanche."
                              : modele.champs
                                  .map((champ) => LIBELLE_CHAMP[champ.champ])
                                  .join(" · ")}
                          </p>
                        </div>

                        {droits.peutGerer && (
                          <div className="flex shrink-0 items-center gap-3">
                            <form action={dupliquerModele}>
                              <input type="hidden" name="modele_id" value={modele.id} />
                              <button
                                type="submit"
                                className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
                              >
                                Dupliquer
                              </button>
                            </form>
                            {modele.organizationId !== null && (
                              <form action={archiverModele}>
                                <input type="hidden" name="modele_id" value={modele.id} />
                                <button
                                  type="submit"
                                  className="text-[var(--text-secondary)] text-critical hover:underline"
                                  title="Le modèle disparaît des listes. Les étiquettes déjà imprimées ne changent pas — elles sont sur du papier."
                                >
                                  Archiver
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        );
      })}

      {!droits.peutGerer && (
        <p className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface-sunken px-5 py-4 text-[var(--text-body)] text-ink-soft">
          Votre rôle permet de consulter les modèles, pas de les modifier. Composer une étiquette
          engage un rouleau et peut ouvrir une porte publique : c&apos;est un droit à part, à
          demander à un responsable.
        </p>
      )}

      <div className="mt-8">
        <ButtonLink href="/etiquettes" variant="secondary">
          Revenir aux étiquettes
        </ButtonLink>
      </div>
    </div>
  );
}
