import { notFound } from "next/navigation";

import { PageHeader, Badge } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

import { dupliquerModele } from "../../actions.ts";
import { adresseEtiquettes } from "../../adresse.ts";
import { droitsEtiquettes } from "../../droits.ts";
import { LIBELLE_FAMILLE } from "../../familles.ts";
import { lireModele } from "../../lecture.ts";
import { Editeur } from "../Editeur";

/**
 * § 18 — L'ÉDITEUR D'UN MODÈLE.
 *
 * Le même écran sert à REGARDER un modèle d'Oasis et à MODIFIER celui
 * de l'entreprise. Deux écrans distincts se seraient mis à diverger :
 * on aurait corrigé un avertissement d'un côté et pas de l'autre, et
 * l'aperçu du modèle Oasis n'aurait plus dit la même chose que celui de
 * sa copie. Ici c'est le même composant, avec les champs désactivés.
 *
 * `modifiable` recoupe deux choses qu'il ne faut pas confondre :
 *   • le modèle est-il celui d'une entreprise ? (0090 § 8.c refuse
 *     explicitement d'écrire sur un modèle Oasis) ;
 *   • le porteur a-t-il le droit de gérer les étiquettes ?
 * Les deux doivent être vrais. Et aucun des deux ne protège quoi que
 * ce soit : la fonction `security definer` refait le second contrôle.
 */

export const metadata = { title: "Modèle d'étiquette" };

export default async function ModelePage({
  params,
}: PageProps<"/etiquettes/modeles/[id]">) {
  const { id } = await params;
  const organization = await requireOrganization();
  const droits = droitsEtiquettes(organization);
  const supabase = await createClient();
  const adresse = adresseEtiquettes();

  const modele = await lireModele(supabase, id);
  if (!modele) notFound();

  const modifiable = modele.modifiable && droits.peutGerer;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title={modele.nom}
        eyebrow={LIBELLE_FAMILLE[modele.famille]}
        breadcrumb={{ label: "Modèles d'étiquette", href: "/etiquettes/modeles" }}
        subtitle={
          modele.modifiable
            ? "Les cotes sont en millimètres et l'aperçu est à la taille réelle : ce que vous voyez est ce qui sortira."
            : "Modèle fourni par Oasis. Il se lit et se duplique ; il ne se modifie pas."
        }
        action={
          <>
            {!modele.modifiable && <Badge tone="info">Oasis</Badge>}
            {droits.peutGerer && (
              <form action={dupliquerModele}>
                <input type="hidden" name="modele_id" value={modele.id} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:bg-canvas"
                >
                  Dupliquer
                </button>
              </form>
            )}
          </>
        }
      />

      <Editeur
        modeleId={modele.id}
        baseAdresse={adresse.base}
        estDefaut={modele.estDefaut}
        modifiable={modifiable}
        initial={{
          famille: modele.famille,
          nom: modele.nom,
          largeurMm: modele.largeurMm,
          hauteurMm: modele.hauteurMm,
          margeMm: modele.margeMm,
          champs: modele.champs,
        }}
      />
    </div>
  );
}
