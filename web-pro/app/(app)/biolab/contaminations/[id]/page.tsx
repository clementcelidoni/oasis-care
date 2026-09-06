import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InfoCard, PageHeader, Panel, StatusBadge } from "@/components/ui";
import {
  perimetreBioLab,
  CONTAMINATION_LABELS,
  CONTAMINATION_TON,
  SEVERITE_LABELS,
  SEVERITE_TON,
  formatAnciennete,
  formatDateHeure,
  formatNombre,
  libelle,
  tonDe,
} from "@/lib/biolab/cultures";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import { lirePhotos, lireInspection, signerPhotos, type PhotoAffichable } from "@/lib/biolab/contaminations";
import { LIBELLE_CATEGORIE_PHOTO } from "@/lib/biolab/referentiel";

/**
 * §7 « contaminations » et « photos » — UN RELEVÉ.
 *
 * Un relevé d'inspection est un CONSTAT DATÉ, pas un état courant : il
 * dit ce que quelqu'un a vu ce jour-là, devant le bocal. La page
 * l'affiche donc avec sa date en évidence et son ancienneté — un
 * constat de mars ne se lit pas comme un constat d'hier.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES PHOTOS PASSENT PAR LE SEAU DU TÉLÉPHONE, PAS PAR UN SECOND
 * ══════════════════════════════════════════════════════════════════
 *
 * `plant-photos`, au chemin `{espace}/biolab/{inspection}/{photo}.jpg`.
 * C'est là que `SyncEngine.pushBioLabInspectionPhotos` les dépose. Un
 * second chemin de stockage côté web rendrait invisible tout ce qui a
 * déjà été photographié — et §6 interdit exactement ce doublon.
 *
 * Le seau est privé : chaque image est servie par une URL signée d'une
 * heure, jamais par un lien permanent.
 */

export default async function RelevePage({ params }: PageProps<"/biolab/contaminations/[id]">) {
  const { id } = await params;
  const contexte = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(contexte, "Le détail d'un relevé");

  const entete = (titre: string) => (
    <PageHeader
      eyebrow="BioLab · relevé d'inspection"
      title={titre}
      breadcrumb={{ label: "Contaminations", href: "/biolab/contaminations" }}
    />
  );

  if (refus) {
    return (
      <>
        {entete("Relevé d'inspection")}
        {refus}
      </>
    );
  }

  const supabase = await createClient();
  const inspection = await lireInspection(supabase, contexte.workspaceId, id);

  if (inspection.erreur) {
    return (
      <>
        {entete("Relevé d'inspection")}
        <LectureImpossible sujet="Ce relevé" erreur={inspection.erreur} />
      </>
    );
  }
  if (!inspection.donnees) notFound();

  const releve = inspection.donnees;

  // Le code du lot est lu séparément plutôt que joint : un relevé peut
  // n'avoir aucun lot (`culture_batch_id` est nullable), et une jointure
  // interne le ferait disparaître de la liste comme de cette page.
  const lot = releve.culture_batch_id
    ? (
        await supabase
          .from("culture_batches")
          .select("batch_code, species_name, culture_stage")
          .eq("id", releve.culture_batch_id)
          .maybeSingle()
      ).data as { batch_code: string; species_name: string; culture_stage: string } | null
    : null;

  const photos = await lirePhotos(supabase, releve.id);
  const affichables = photos.erreur ? [] : await signerPhotos(supabase, photos.donnees);

  return (
    <>
      {entete(lot ? `Lot ${lot.batch_code}` : "Relevé sans lot rattaché")}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <InfoCard
          label="Relevé le"
          value={formatDateHeure(releve.date)}
          hint={formatAnciennete(releve.date) ?? undefined}
        />
        <InfoCard label="Espèce" value={lot?.species_name || "—"} />
        <InfoCard
          label="Effectif estimé"
          value={
            releve.estimated_count === null ? (
              // Un comptage non fait n'est pas un comptage à zéro : le
              // dire est la seule façon de ne pas laisser croire à une
              // culture perdue.
              <span className="text-ink-faint">Non compté</span>
            ) : (
              formatNombre(releve.estimated_count)
            )
          }
        />
      </div>

      <Panel
        title="Les observations"
        description="Quatre jugements distincts. Ils ne se remplacent pas : un lot indemne de contamination peut être sévèrement hyperhydrique, et l'un ne console pas de l'autre."
        className="mb-6"
      >
        <ul className="divide-y divide-line">
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <span className="font-medium">Contamination</span>
            <StatusBadge tone={tonDe(CONTAMINATION_TON, releve.contamination_status)}>
              {libelle(CONTAMINATION_LABELS, releve.contamination_status)}
            </StatusBadge>
          </li>
          {(
            [
              ["Hyperhydricité", releve.hyperhydricity_status],
              ["Nécrose", releve.necrosis_status],
              ["Brunissement", releve.browning_status],
            ] as const
          ).map(([intitule, valeur]) => (
            <li key={intitule} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="font-medium">{intitule}</span>
              <StatusBadge tone={tonDe(SEVERITE_TON, valeur)}>{libelle(SEVERITE_LABELS, valeur)}</StatusBadge>
            </li>
          ))}
        </ul>
        {releve.contamination_status === "suspected" && (
          <div className="border-t border-line px-5 py-3">
            <p className="text-[var(--text-secondary)] text-ink-soft">
              Une suspicion n&apos;entre dans aucun taux de contamination du module : seule une confirmation par un
              humain y entre. C&apos;est délibéré — un taux gonflé de suspicions ferait jeter des lots sains.
            </p>
          </div>
        )}
      </Panel>

      {(releve.culture_appearance || releve.growth_status || releve.notes) && (
        <Panel title="Ce qui a été noté" className="mb-6">
          <dl className="divide-y divide-line">
            {releve.culture_appearance && (
              <div className="px-5 py-3">
                <dt className="eyebrow">Aspect de la culture</dt>
                <dd className="mt-1 whitespace-pre-wrap text-[var(--text-body)]">{releve.culture_appearance}</dd>
              </div>
            )}
            {releve.growth_status && (
              <div className="px-5 py-3">
                <dt className="eyebrow">Croissance</dt>
                <dd className="mt-1 whitespace-pre-wrap text-[var(--text-body)]">{releve.growth_status}</dd>
              </div>
            )}
            {releve.notes && (
              <div className="px-5 py-3">
                <dt className="eyebrow">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-[var(--text-body)]">{releve.notes}</dd>
              </div>
            )}
          </dl>
        </Panel>
      )}

      {photos.erreur ? (
        <LectureImpossible sujet="Les photos de ce relevé" erreur={photos.erreur} />
      ) : (
        <Galerie photos={affichables} />
      )}
    </>
  );
}

function Galerie({ photos }: { photos: PhotoAffichable[] }) {
  if (photos.length === 0) {
    return (
      <Panel title="Photos">
        <p className="px-5 py-4 text-[var(--text-body)] text-ink-soft">
          Aucune photo n&apos;accompagne ce relevé. Les clichés se prennent depuis l&apos;application mobile, devant le
          bocal, et se rangent par vue globale, détail des tissus, milieu, bocal ou équipement.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Photos" count={photos.length}>
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photo) => (
          <figure key={photo.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line">
            {photo.urlVignette ? (
              // `next/image` demande une configuration de domaine
              // distante que ce projet n'a pas : l'URL est signée et
              // change à chaque rendu, donc l'optimiseur ne pourrait rien
              // en mettre en cache de toute façon.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.urlVignette}
                alt={`${libelle(LIBELLE_CATEGORIE_PHOTO, photo.category)} — ${formatDateHeure(photo.date)}`}
                className="aspect-square w-full bg-surface-sunken object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-surface-sunken px-4 text-center text-[var(--text-secondary)] text-ink-soft">
                Image indisponible. La ligne existe en base, le fichier n&apos;a pas pu être ouvert.
              </div>
            )}
            <figcaption className="flex items-baseline justify-between gap-2 border-t border-line px-3 py-2">
              <span className="font-medium">{libelle(LIBELLE_CATEGORIE_PHOTO, photo.category)}</span>
              <span className="text-[var(--text-secondary)] text-ink-faint">{formatDateHeure(photo.date)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Panel>
  );
}
