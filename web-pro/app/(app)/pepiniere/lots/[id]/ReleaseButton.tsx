"use client";

import { releaseReservation } from "@/lib/nursery/actions";

/** Libérer une réservation : le stock redevient disponible à la vente. */
export function ReleaseButton({
  reservationId, lotId,
}: {
  reservationId: string;
  lotId: string;
}) {
  return (
    <form action={releaseReservation}>
      <input type="hidden" name="reservation_id" value={reservationId} />
      <input type="hidden" name="lot_id" value={lotId} />
      <button
        type="submit"
        title="Libérer : ces plantes redeviennent disponibles à la vente."
        className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-ink-soft hover:border-accent hover:text-accent"
      >
        Libérer
      </button>
    </form>
  );
}
