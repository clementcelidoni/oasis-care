"use client";

import { useState } from "react";
import { uploadProjectPhoto } from "@/lib/projects/actions";
import { formatDate } from "@/lib/crm/types";
import { PHOTO_MOMENTS, PHOTO_MOMENT_LABELS, type ProjectPhase } from "@/lib/projects/types";

type Photo = {
  id: string;
  url: string | null;
  caption: string | null;
  moment: string;
  takenOn: string;
  phaseId: string | null;
};

/**
 * Les photos du chantier, groupées avant / pendant / après.
 *
 * C'est le groupement utile en paysage : la comparaison avant/après est
 * ce qu'on montre au client à la réception, et ce qu'on ressort deux ans
 * plus tard pour vendre le chantier suivant. Un simple ordre
 * chronologique les mélangerait.
 */
export function Photos({
  projectId, photos, phases,
}: {
  projectId: string;
  photos: Photo[];
  phases: ProjectPhase[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await uploadProjectPhoto(formData);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Envoi impossible.");
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Photos
      </h2>

      {PHOTO_MOMENTS.map((moment) => {
        const group = photos.filter((p) => p.moment === moment);
        if (group.length === 0) return null;
        return (
          <div key={moment} className="mb-4">
            <h3 className="mb-1.5 text-xs font-medium text-ink-soft">
              {PHOTO_MOMENT_LABELS[moment]}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {group.map((photo) => (
                <figure key={photo.id} className="overflow-hidden rounded-lg border border-line bg-surface">
                  {photo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL signée
                    // d'un bucket privé, valable une heure : `next/image`
                    // la mettrait en cache côté serveur bien après son
                    // expiration, et l'image se briserait.
                    <img
                      src={photo.url}
                      alt={photo.caption ?? "Photo de chantier"}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-canvas text-xs text-ink-faint">
                      Image indisponible
                    </div>
                  )}
                  <figcaption className="px-2 py-1.5 text-[11px] text-ink-soft">
                    {photo.caption || "Sans légende"}
                    <span className="block text-ink-faint">{formatDate(photo.takenOn)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        );
      })}

      {photos.length === 0 && (
        <p className="mb-3 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-soft">
          Aucune photo. Les vues avant / pendant / après sont ce qu&apos;on
          montre au client à la réception.
        </p>
      )}

      <form
        action={onSubmit}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5"
      >
        <input type="hidden" name="project_id" value={projectId} />
        <input
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp"
          required
          className="max-w-56 text-xs text-ink-soft file:mr-2 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-2 file:py-1 file:text-xs file:text-ink-soft"
        />
        <select
          name="moment"
          defaultValue="during"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          {PHOTO_MOMENTS.map((m) => (
            <option key={m} value={m}>{PHOTO_MOMENT_LABELS[m]}</option>
          ))}
        </select>
        {phases.length > 0 && (
          <select
            name="phase_id"
            defaultValue=""
            className="max-w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="">Sans phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        )}
        <input
          name="caption"
          placeholder="Légende"
          className="min-w-32 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-40"
        >
          {busy ? "Envoi…" : "Ajouter"}
        </button>
      </form>

      {error && (
        <p className="mt-2 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">{error}</p>
      )}
    </section>
  );
}
