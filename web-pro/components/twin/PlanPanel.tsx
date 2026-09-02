"use client";

import { useRef, useState } from "react";
import { planScale, type PlanImage } from "@/lib/twin/types";
import { uploadPlanImage, updatePlanImage, deletePlanImage } from "@/lib/twin/planActions";
import { formatMeters } from "@/lib/twin/geometry";

/**
 * §"IMPORT DE PLAN" : importer → placer → rotation → opacité → calibrer.
 *
 * Le calibrage se fait dans le canvas (deux clics), pas ici : demander
 * des coordonnées en pixels à un paysagiste n'aurait aucun sens. Ce
 * panneau ne gère que l'import et les réglages.
 */
export function PlanPanel({
  gardenId,
  plans,
  onReload,
  calibratingId,
  onStartCalibration,
  onCancelCalibration,
  onClose,
}: {
  gardenId: string;
  plans: PlanImage[];
  onReload: () => Promise<void>;
  calibratingId: string | null;
  onStartCalibration: (id: string) => void;
  onCancelCalibration: () => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const formData = new FormData();
    formData.set("garden_id", gardenId);
    formData.set("file", file);
    const result = await uploadPlanImage(formData);
    if (!result.ok) setError(result.error ?? "Import impossible.");
    await onReload();
    setBusy(false);
  }

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface px-3 py-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Plan importé
        </p>
        <button onClick={onClose} className="text-xs text-ink-soft hover:text-ink">
          Fermer
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <button
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        {busy ? "Import…" : "Importer un plan"}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        PNG, JPEG ou WebP. Pour un PDF ou un plan d&apos;architecte,
        exportez-le d&apos;abord en image.
      </p>

      {error && (
        <p className="mt-2 rounded-md bg-critical-wash px-2 py-1.5 text-[11px] text-critical">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {plans.length === 0 && (
          <p className="text-xs text-ink-faint">Aucun plan importé.</p>
        )}

        {plans.map((plan) => {
          const scale = planScale(plan.calibration);
          const calibrating = calibratingId === plan.id;
          return (
            <div key={plan.id} className="rounded-lg border border-line p-2.5">
              <p className="truncate text-xs font-medium" title={plan.originalFilename ?? ""}>
                {plan.originalFilename ?? "Plan"}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-ink-faint">Visible</span>
                <input
                  type="checkbox"
                  checked={plan.isVisible}
                  onChange={async (e) => {
                    await updatePlanImage({ id: plan.id, gardenId, isVisible: e.target.checked });
                    await onReload();
                  }}
                />
              </div>

              <label className="mt-2 flex flex-col gap-1">
                <span className="text-[11px] text-ink-faint">
                  Opacité {Math.round(plan.opacity * 100)} %
                </span>
                <input
                  type="range" min={0.1} max={1} step={0.05}
                  defaultValue={plan.opacity}
                  onMouseUp={async (e) => {
                    await updatePlanImage({
                      id: plan.id, gardenId,
                      opacity: Number((e.target as HTMLInputElement).value),
                    });
                    await onReload();
                  }}
                />
              </label>

              <label className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-faint">Rotation (°)</span>
                <input
                  type="number" step="1"
                  defaultValue={Math.round((plan.rotationRadians * 180) / Math.PI)}
                  onBlur={async (e) => {
                    await updatePlanImage({
                      id: plan.id, gardenId,
                      rotationRadians: (Number(e.target.value) * Math.PI) / 180,
                    });
                    await onReload();
                  }}
                  className="tabular w-20 rounded-md border border-line-strong bg-surface px-2 py-1 text-right text-xs outline-none focus:border-accent"
                />
              </label>

              <div className="mt-2.5 border-t border-line pt-2">
                {scale ? (
                  <p className="text-[11px] text-positive">
                    Calibré : 1 px = {formatMeters(scale)}
                  </p>
                ) : (
                  <p className="text-[11px] text-warning">
                    Non calibré — le plan est affiché à une échelle arbitraire et
                    ne doit pas servir à mesurer.
                  </p>
                )}
                {calibrating ? (
                  <button
                    onClick={onCancelCalibration}
                    className="mt-1.5 w-full rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium"
                  >
                    Annuler le calibrage
                  </button>
                ) : (
                  <button
                    onClick={() => onStartCalibration(plan.id)}
                    className="mt-1.5 w-full rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium hover:bg-canvas"
                  >
                    {scale ? "Recalibrer" : "Calibrer"}
                  </button>
                )}
              </div>

              <button
                onClick={async () => {
                  await deletePlanImage(plan.id, gardenId);
                  await onReload();
                }}
                className="mt-2 w-full rounded-md bg-critical-wash px-2 py-1 text-[11px] font-medium text-critical"
              >
                Retirer
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
        Pour caler un plan : cliquez deux points dont vous connaissez la
        distance réelle — une façade, une clôture — puis saisissez cette
        distance. Le plan est mis à l&apos;échelle à partir d&apos;elle.
      </p>
    </aside>
  );
}
