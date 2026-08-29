"use client";

import { archiveLocation } from "@/lib/nursery/actions";

/**
 * Archiver, jamais supprimer : les mouvements citent cet emplacement,
 * et le faire disparaitre effacerait d ou venaient les plantes.
 */
export function ArchiveButton({ locationId }: { locationId: string }) {
  return (
    <form action={archiveLocation}>
      <input type="hidden" name="location_id" value={locationId} />
      <button
        type="submit"
        title="Archiver. Les mouvements qui le citent restent lisibles."
        className="px-1 text-xs text-ink-faint hover:text-critical"
      >
        &#10005;
      </button>
    </form>
  );
}
