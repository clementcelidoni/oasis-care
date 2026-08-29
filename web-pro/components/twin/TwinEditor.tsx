"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  worldToScreen, screenToWorld, distance, perimeter, polygonArea,
  snapPoint, snapAngle, pointInPolygon, pointInRotatedRect, rotatedRectCorners,
  boundsOf, centroid, formatMeters, formatArea, DEFAULT_SNAP,
  type Point, type Camera, type SnapSettings,
} from "@/lib/twin/geometry";
import {
  OBJECT_TYPES, AREA_TYPES, OBJECT_TYPE_LABELS, AREA_TYPE_LABELS,
  AREA_COLORS, ROUND_OBJECTS, VEGETATION, colorForObject, defaultSizeFor,
  MAP_MODE_LABELS,
  type TwinDocument, type TwinObject, type TwinArea, type ObjectType,
  type AreaType, type MapMode,
} from "@/lib/twin/types";
import { saveTwin } from "@/lib/twin/actions";

type Tool =
  | { kind: "select" }
  | { kind: "boundary" }
  | { kind: "area"; areaType: AreaType }
  | { kind: "object"; objectType: ObjectType };

type Selection = { kind: "object" | "area"; id: string };
type SaveState = "idle" | "saving" | "saved" | "conflict" | "offline" | "error";

/** Un état complet du document — l'unité de l'undo/redo. */
type Snapshot = {
  boundaryPoints: Point[];
  areas: TwinArea[];
  objects: TwinObject[];
};

const MAX_HISTORY = 60;

export function TwinEditor({ initial }: { initial: TwinDocument }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [boundaryId] = useState(() => initial.boundary?.id ?? crypto.randomUUID());
  const [doc, setDoc] = useState<Snapshot>(() => ({
    boundaryPoints: initial.boundary?.points ?? [],
    areas: initial.areas,
    objects: initial.objects,
  }));

  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [selection, setSelection] = useState<Selection[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("oasisPlan");
  const [snap, setSnap] = useState<SnapSettings>(DEFAULT_SNAP);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const [camera, setCamera] = useState<Camera>({ centerX: 0, centerY: 0, pixelsPerMeter: 14 });
  const [view, setView] = useState({ width: 800, height: 600 });

  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const deleted = useRef<{ areas: string[]; objects: string[] }>({ areas: [], objects: [] });
  const dirty = useRef(false);
  const drag = useRef<
    | { mode: "pan"; startX: number; startY: number; camX: number; camY: number }
    | { mode: "move"; last: Point }
    | { mode: "vertex"; areaId: string | "boundary"; index: number }
    | null
  >(null);

  // ---------- historique ----------
  const commit = useCallback((next: Snapshot | ((s: Snapshot) => Snapshot)) => {
    setDoc((current) => {
      history.current.push(current);
      if (history.current.length > MAX_HISTORY) history.current.shift();
      future.current = [];
      dirty.current = true;
      return typeof next === "function" ? next(current) : next;
    });
  }, []);

  const undo = useCallback(() => {
    setDoc((current) => {
      const previous = history.current.pop();
      if (!previous) return current;
      future.current.push(current);
      dirty.current = true;
      return previous;
    });
    setSelection([]);
  }, []);

  const redo = useCallback(() => {
    setDoc((current) => {
      const next = future.current.pop();
      if (!next) return current;
      history.current.push(current);
      dirty.current = true;
      return next;
    });
    setSelection([]);
  }, []);

  // ---------- sauvegarde automatique, avec anti-rebond ----------
  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    try {
      const result = await saveTwin({
        gardenId: initial.gardenId,
        boundary: doc.boundaryPoints.length > 0 ? { id: boundaryId, points: doc.boundaryPoints } : null,
        areas: doc.areas,
        objects: doc.objects,
        deletedAreaIds: deleted.current.areas,
        deletedObjectIds: deleted.current.objects,
      });
      if (result.ok) {
        deleted.current = { areas: [], objects: [] };
        setSaveState("saved");
      } else {
        dirty.current = true;
        setSaveState("error");
      }
    } catch {
      // Hors ligne : on garde `dirty` pour retenter, et on le dit.
      dirty.current = true;
      setSaveState(navigator.onLine ? "error" : "offline");
    }
  }, [doc, initial.gardenId, boundaryId]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(save, 1200);
    return () => clearTimeout(timer);
  }, [doc, save]);

  // ---------- taille du canvas ----------
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setView({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---------- cadrage initial sur le contenu existant ----------
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || view.width < 50) return;
    const all = [
      ...doc.boundaryPoints,
      ...doc.areas.flatMap((a) => a.points),
      ...doc.objects.map((o) => o.position),
    ];
    didFit.current = true;
    const b = boundsOf(all);
    if (!b) return;
    const w = Math.max(b.maxX - b.minX, 10);
    const h = Math.max(b.maxY - b.minY, 10);
    setCamera({
      centerX: (b.minX + b.maxX) / 2,
      centerY: (b.minY + b.maxY) / 2,
      pixelsPerMeter: Math.min(view.width / (w * 1.3), view.height / (h * 1.3)),
    });
  }, [view, doc]);

  const allVertices = useMemo(
    () => [...doc.boundaryPoints, ...doc.areas.flatMap((a) => a.points)],
    [doc.boundaryPoints, doc.areas],
  );

  // ---------- rendu ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = view.width * dpr;
    canvas.height = view.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);

    const toScreen = (p: Point) => worldToScreen(p, camera, view);

    // Fond
    ctx.fillStyle = mapMode === "oasisPlan" ? "#fbfcfa" : "#e8ece7";
    ctx.fillRect(0, 0, view.width, view.height);

    if (mapMode !== "oasisPlan") {
      ctx.fillStyle = "#5d6b64";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `Fond « ${MAP_MODE_LABELS[mapMode]} » : aucun fournisseur de tuiles configuré.`,
        view.width / 2, 28,
      );
      ctx.textAlign = "left";
    }

    // Grille — seulement si elle reste lisible.
    if (mapMode === "oasisPlan") {
      const step = camera.pixelsPerMeter * snap.gridMeters;
      if (step > 6) {
        ctx.strokeStyle = "#e8ece7";
        ctx.lineWidth = 1;
        const origin = toScreen({ xMeters: 0, yMeters: 0 });
        const startX = origin.x % step;
        const startY = origin.y % step;
        ctx.beginPath();
        for (let x = startX; x < view.width; x += step) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, view.height);
        }
        for (let y = startY; y < view.height; y += step) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(view.width, Math.round(y) + 0.5);
        }
        ctx.stroke();
      }
    }

    const drawPolygon = (points: Point[], fill: string, stroke: string, dashed = false) => {
      if (points.length < 2) return;
      ctx.beginPath();
      points.forEach((p, i) => {
        const s = toScreen(p);
        i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      if (points.length > 2) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Limite de propriété
    if (doc.boundaryPoints.length >= 2) {
      drawPolygon(doc.boundaryPoints, "rgba(21,101,74,0.05)", "#15654a", true);
    }

    // Zones
    for (const area of doc.areas) {
      const colors = AREA_COLORS[area.areaType] ?? AREA_COLORS.custom;
      const isSelected = selection.some((s) => s.kind === "area" && s.id === area.id);
      drawPolygon(area.points, colors.fill, isSelected ? "#15654a" : colors.stroke);
      if (area.points.length >= 3) {
        const c = toScreen(centroid(area.points));
        ctx.fillStyle = "#10201a";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(area.name || AREA_TYPE_LABELS[area.areaType], c.x, c.y);
        ctx.fillStyle = "#46584f";
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(formatArea(polygonArea(area.points)), c.x, c.y + 12);
        ctx.textAlign = "left";
      }
      if (isSelected) {
        for (const p of area.points) {
          const s = toScreen(p);
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#15654a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Objets
    for (const object of [...doc.objects].sort((a, b) => a.zIndex - b.zIndex)) {
      const colors = colorForObject(object.objectType);
      const isSelected = selection.some((s) => s.kind === "object" && s.id === object.id);
      const s = toScreen(object.position);

      if (ROUND_OBJECTS.has(object.objectType)) {
        // §"TREE SCALE" — le diamètre graphique suit canopyDiameter
        // quand il existe, plutôt qu'une taille arbitraire.
        const diameter = VEGETATION.has(object.objectType)
          ? (object.canopyDiameterMeters ?? object.widthMeters)
          : object.widthMeters;
        const r = Math.max((diameter / 2) * camera.pixelsPerMeter, 3);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.fill;
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#15654a" : colors.stroke;
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.stroke();
      } else {
        const corners = rotatedRectCorners(
          object.position, object.widthMeters, object.heightMeters, object.rotationRadians,
        ).map(toScreen);
        ctx.beginPath();
        corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
        ctx.closePath();
        ctx.fillStyle = colors.fill;
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#15654a" : colors.stroke;
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.stroke();
      }

      if (camera.pixelsPerMeter > 8 && object.label) {
        ctx.fillStyle = "#10201a";
        ctx.font = "10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(object.label, s.x, s.y - 8);
        ctx.textAlign = "left";
      }
    }

    // Tracé en cours
    if (draft.length > 0) {
      const points = cursor ? [...draft, cursor] : draft;
      ctx.beginPath();
      points.forEach((p, i) => {
        const s = toScreen(p);
        i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
      });
      ctx.strokeStyle = "#15654a";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of draft) {
        const s = toScreen(p);
        ctx.fillStyle = "#15654a";
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // §"MESURES : afficher en direct".
      if (cursor && draft.length > 0) {
        const last = draft[draft.length - 1];
        const d = distance(last, cursor);
        const mid = toScreen({
          xMeters: (last.xMeters + cursor.xMeters) / 2,
          yMeters: (last.yMeters + cursor.yMeters) / 2,
        });
        const text = formatMeters(d);
        ctx.font = "11px system-ui, sans-serif";
        const w = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(mid.x - w / 2 - 4, mid.y - 16, w + 8, 16);
        ctx.fillStyle = "#10201a";
        ctx.textAlign = "center";
        ctx.fillText(text, mid.x, mid.y - 4);
        ctx.textAlign = "left";
      }
    }

    // Échelle
    const targets = [1, 2, 5, 10, 20, 50, 100];
    const meters = targets.find((t) => t * camera.pixelsPerMeter > 60) ?? 100;
    const px = meters * camera.pixelsPerMeter;
    ctx.strokeStyle = "#46584f";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(16, view.height - 20);
    ctx.lineTo(16 + px, view.height - 20);
    ctx.moveTo(16, view.height - 24);
    ctx.lineTo(16, view.height - 16);
    ctx.moveTo(16 + px, view.height - 24);
    ctx.lineTo(16 + px, view.height - 16);
    ctx.stroke();
    ctx.fillStyle = "#46584f";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`${meters} m`, 16, view.height - 28);
  }, [doc, camera, view, selection, draft, cursor, snap, mapMode]);

  // ---------- interaction ----------
  const pointerWorld = (event: React.PointerEvent | React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top }, camera, view,
    );
  };

  const hitTest = (p: Point): Selection | null => {
    for (const o of [...doc.objects].sort((a, b) => b.zIndex - a.zIndex)) {
      const w = ROUND_OBJECTS.has(o.objectType)
        ? (VEGETATION.has(o.objectType) ? (o.canopyDiameterMeters ?? o.widthMeters) : o.widthMeters)
        : o.widthMeters;
      const h = ROUND_OBJECTS.has(o.objectType) ? w : o.heightMeters;
      if (pointInRotatedRect(p, o.position, w, h, o.rotationRadians)) {
        return { kind: "object", id: o.id };
      }
    }
    for (const a of doc.areas) {
      if (pointInPolygon(p, a.points)) return { kind: "area", id: a.id };
    }
    return null;
  };

  function onPointerDown(event: React.PointerEvent) {
    canvasRef.current?.setPointerCapture(event.pointerId);
    const raw = pointerWorld(event);

    // Bouton du milieu, ou espace : déplacement de la vue.
    if (event.button === 1 || event.altKey) {
      drag.current = {
        mode: "pan", startX: event.clientX, startY: event.clientY,
        camX: camera.centerX, camY: camera.centerY,
      };
      return;
    }

    if (tool.kind === "boundary" || tool.kind === "area") {
      let p = snapPoint(raw, allVertices, snap);
      if (snap.toAngles && event.shiftKey && draft.length > 0) {
        p = snapAngle(draft[draft.length - 1], p);
      }
      setDraft((d) => [...d, p]);
      return;
    }

    if (tool.kind === "object") {
      const p = snapPoint(raw, allVertices, snap);
      const size = defaultSizeFor(tool.objectType);
      const created: TwinObject = {
        id: crypto.randomUUID(),
        objectType: tool.objectType,
        position: p,
        rotationRadians: 0,
        widthMeters: size.w,
        heightMeters: size.h,
        zIndex: doc.objects.length,
        label: null,
        canopyDiameterMeters: VEGETATION.has(tool.objectType) ? size.w : null,
      };
      commit((s) => ({ ...s, objects: [...s.objects, created] }));
      setSelection([{ kind: "object", id: created.id }]);
      setTool({ kind: "select" });
      return;
    }

    // Outil sélection
    const hit = hitTest(raw);
    if (!hit) {
      if (!event.shiftKey) setSelection([]);
      drag.current = {
        mode: "pan", startX: event.clientX, startY: event.clientY,
        camX: camera.centerX, camY: camera.centerY,
      };
      return;
    }

    setSelection((current) => {
      if (event.shiftKey) {
        const exists = current.some((s) => s.kind === hit.kind && s.id === hit.id);
        return exists
          ? current.filter((s) => !(s.kind === hit.kind && s.id === hit.id))
          : [...current, hit];
      }
      return [hit];
    });
    drag.current = { mode: "move", last: raw };
  }

  function onPointerMove(event: React.PointerEvent) {
    const raw = pointerWorld(event);

    if (tool.kind === "boundary" || tool.kind === "area") {
      let p = snapPoint(raw, allVertices, snap);
      if (snap.toAngles && event.shiftKey && draft.length > 0) {
        p = snapAngle(draft[draft.length - 1], p);
      }
      setCursor(p);
      return;
    }
    setCursor(raw);

    const d = drag.current;
    if (!d) return;

    if (d.mode === "pan") {
      setCamera((c) => ({
        ...c,
        centerX: d.camX - (event.clientX - d.startX) / c.pixelsPerMeter,
        centerY: d.camY + (event.clientY - d.startY) / c.pixelsPerMeter,
      }));
      return;
    }

    if (d.mode === "move" && selection.length > 0) {
      const dx = raw.xMeters - d.last.xMeters;
      const dy = raw.yMeters - d.last.yMeters;
      d.last = raw;
      const objectIds = new Set(selection.filter((s) => s.kind === "object").map((s) => s.id));
      const areaIds = new Set(selection.filter((s) => s.kind === "area").map((s) => s.id));
      // Pas de `commit` ici : un point d'historique par pixel parcouru
      // rendrait l'undo inutilisable. Le point est posé au relâchement.
      setDoc((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          objectIds.has(o.id)
            ? { ...o, position: { xMeters: o.position.xMeters + dx, yMeters: o.position.yMeters + dy } }
            : o,
        ),
        areas: s.areas.map((a) =>
          areaIds.has(a.id)
            ? { ...a, points: a.points.map((p) => ({ xMeters: p.xMeters + dx, yMeters: p.yMeters + dy })) }
            : a,
        ),
      }));
      dirty.current = true;
    }
  }

  const movedFrom = useRef<Snapshot | null>(null);
  function onPointerDownCapture() {
    movedFrom.current = doc;
  }
  function onPointerUp(event: React.PointerEvent) {
    canvasRef.current?.releasePointerCapture(event.pointerId);
    if (drag.current?.mode === "move" && movedFrom.current) {
      // Un seul point d'historique pour tout le déplacement.
      history.current.push(movedFrom.current);
      if (history.current.length > MAX_HISTORY) history.current.shift();
      future.current = [];
    }
    drag.current = null;
    movedFrom.current = null;
  }

  function onWheel(event: React.WheelEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const before = screenToWorld(screen, camera, view);
    const factor = Math.exp(-event.deltaY * 0.0015);
    const ppm = Math.min(400, Math.max(0.5, camera.pixelsPerMeter * factor));
    const after = screenToWorld(screen, { ...camera, pixelsPerMeter: ppm }, view);
    // Zoom centré sur le curseur : le point sous la souris ne bouge pas.
    setCamera({
      pixelsPerMeter: ppm,
      centerX: camera.centerX + (before.xMeters - after.xMeters),
      centerY: camera.centerY + (before.yMeters - after.yMeters),
    });
  }

  const finishDraft = useCallback(() => {
    if (draft.length < 3) {
      setDraft([]);
      return;
    }
    if (tool.kind === "boundary") {
      commit((s) => ({ ...s, boundaryPoints: draft }));
    } else if (tool.kind === "area") {
      const area: TwinArea = {
        id: crypto.randomUUID(),
        areaType: tool.areaType,
        name: AREA_TYPE_LABELS[tool.areaType],
        points: draft,
      };
      commit((s) => ({ ...s, areas: [...s.areas, area] }));
      setSelection([{ kind: "area", id: area.id }]);
    }
    setDraft([]);
    setTool({ kind: "select" });
  }, [draft, tool, commit]);

  const deleteSelection = useCallback(() => {
    if (selection.length === 0) return;
    const objectIds = selection.filter((s) => s.kind === "object").map((s) => s.id);
    const areaIds = selection.filter((s) => s.kind === "area").map((s) => s.id);
    deleted.current.objects.push(...objectIds);
    deleted.current.areas.push(...areaIds);
    commit((s) => ({
      ...s,
      objects: s.objects.filter((o) => !objectIds.includes(o.id)),
      areas: s.areas.filter((a) => !areaIds.includes(a.id)),
    }));
    setSelection([]);
  }, [selection, commit]);

  const duplicateSelection = useCallback(() => {
    const ids = new Set(selection.filter((s) => s.kind === "object").map((s) => s.id));
    if (ids.size === 0) return;
    const copies = doc.objects
      .filter((o) => ids.has(o.id))
      .map((o) => ({
        ...o,
        id: crypto.randomUUID(),
        position: { xMeters: o.position.xMeters + 1, yMeters: o.position.yMeters - 1 },
      }));
    commit((s) => ({ ...s, objects: [...s.objects, ...copies] }));
    setSelection(copies.map((c) => ({ kind: "object" as const, id: c.id })));
  }, [selection, doc.objects, commit]);

  // ---------- raccourcis ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        setDraft([]);
        setSelection([]);
        setTool({ kind: "select" });
      } else if (e.key === "Enter") {
        finishDraft();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelection, duplicateSelection, finishDraft]);

  const selectedObject =
    selection.length === 1 && selection[0].kind === "object"
      ? doc.objects.find((o) => o.id === selection[0].id) ?? null
      : null;
  const selectedArea =
    selection.length === 1 && selection[0].kind === "area"
      ? doc.areas.find((a) => a.id === selection[0].id) ?? null
      : null;

  const patchObject = (id: string, patch: Partial<TwinObject>) =>
    commit((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        tool={tool} setTool={setTool}
        mapMode={mapMode} setMapMode={setMapMode}
        snap={snap} setSnap={setSnap}
        onUndo={undo} onRedo={redo}
        onFinish={finishDraft} drafting={draft.length > 0}
        saveState={saveState} gardenName={initial.gardenName}
      />

      <div className="flex min-h-0 flex-1">
        <Library tool={tool} setTool={setTool} />

        <div ref={wrapRef} className="relative min-w-0 flex-1 bg-canvas">
          <canvas
            ref={canvasRef}
            style={{ width: view.width, height: view.height, touchAction: "none" }}
            className={tool.kind === "select" ? "cursor-default" : "cursor-crosshair"}
            onPointerDownCapture={onPointerDownCapture}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={finishDraft}
          />
          {draft.length > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-xs text-white">
              {draft.length} point{draft.length > 1 ? "s" : ""} ·{" "}
              {formatMeters(perimeter(draft, false))}
              {draft.length >= 3 && ` · ${formatArea(polygonArea(draft))}`} — double-clic ou
              Entrée pour fermer
            </div>
          )}
        </div>

        <Properties
          object={selectedObject}
          area={selectedArea}
          count={selection.length}
          boundaryPoints={doc.boundaryPoints}
          onPatchObject={patchObject}
          onPatchArea={(id, patch) =>
            commit((s) => ({ ...s, areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
          }
          onDelete={deleteSelection}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------

function Toolbar({
  tool, setTool, mapMode, setMapMode, snap, setSnap,
  onUndo, onRedo, onFinish, drafting, saveState, gardenName,
}: {
  tool: Tool; setTool: (t: Tool) => void;
  mapMode: MapMode; setMapMode: (m: MapMode) => void;
  snap: SnapSettings; setSnap: (s: SnapSettings) => void;
  onUndo: () => void; onRedo: () => void; onFinish: () => void;
  drafting: boolean; saveState: SaveState; gardenName: string;
}) {
  const SAVE_LABEL: Record<SaveState, string> = {
    idle: "", saving: "Enregistrement…", saved: "Enregistré",
    conflict: "Conflit", offline: "Hors ligne", error: "Échec de l'enregistrement",
  };
  const saveTone =
    saveState === "error" || saveState === "conflict" ? "text-critical"
      : saveState === "offline" ? "text-warning" : "text-ink-faint";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
      <span className="mr-1 text-sm font-semibold">{gardenName}</span>

      <button onClick={() => setTool({ kind: "select" })}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${tool.kind === "select" ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"}`}>
        Sélection
      </button>
      <button onClick={() => setTool({ kind: "boundary" })}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${tool.kind === "boundary" ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"}`}>
        Limite du terrain
      </button>

      {drafting && (
        <button onClick={onFinish}
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink">
          Fermer le tracé
        </button>
      )}

      <span className="mx-1 h-5 w-px bg-line" />

      <button onClick={onUndo} className="rounded-md px-2.5 py-1.5 text-xs text-ink-soft hover:bg-canvas" title="Ctrl+Z">
        Annuler
      </button>
      <button onClick={onRedo} className="rounded-md px-2.5 py-1.5 text-xs text-ink-soft hover:bg-canvas" title="Ctrl+Shift+Z">
        Rétablir
      </button>

      <span className="mx-1 h-5 w-px bg-line" />

      <label className="flex items-center gap-1.5 text-xs text-ink-soft">
        <input type="checkbox" checked={snap.enabled}
          onChange={(e) => setSnap({ ...snap, enabled: e.target.checked })} />
        Aimant
      </label>
      <select value={snap.gridMeters}
        onChange={(e) => setSnap({ ...snap, gridMeters: Number(e.target.value) })}
        className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs">
        {[0.1, 0.25, 0.5, 1].map((g) => <option key={g} value={g}>{g} m</option>)}
      </select>

      <div className="ml-auto flex items-center gap-2">
        <span className={`text-xs ${saveTone}`}>{SAVE_LABEL[saveState]}</span>
        <select value={mapMode} onChange={(e) => setMapMode(e.target.value as MapMode)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
          {(Object.keys(MAP_MODE_LABELS) as MapMode[]).map((m) => (
            <option key={m} value={m}>{MAP_MODE_LABELS[m]}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Library({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const GROUPS: { title: string; types: ObjectType[] }[] = [
    { title: "Végétaux", types: ["tree", "palm", "shrub", "plant"] },
    { title: "Structures", types: ["house", "terrace", "wall", "fence", "path", "stairs", "greenhouse"] },
    { title: "Eau", types: ["pool", "pond", "waterSource"] },
    { title: "Irrigation", types: ["sprinkler", "dripEmitter", "valve", "pump", "filter"] },
    { title: "Éclairage", types: ["light", "electricalPoint"] },
    { title: "Divers", types: ["rock", "decorativeObject", "sensor", "birdhouse", "custom"] },
  ];

  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-3">
      <p className="mb-2 px-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Bibliothèque
      </p>

      <p className="mb-1 mt-3 px-1.5 text-[11px] font-medium text-ink-faint">Zones</p>
      <div className="flex flex-wrap gap-1 px-1">
        {AREA_TYPES.filter((t) => t !== "custom").map((t) => (
          <button key={t} onClick={() => setTool({ kind: "area", areaType: t })}
            className={`rounded border px-1.5 py-1 text-[11px] ${
              tool.kind === "area" && tool.areaType === t
                ? "border-accent bg-accent-wash text-accent"
                : "border-line text-ink-soft hover:border-line-strong"}`}>
            {AREA_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-1 mt-3 px-1.5 text-[11px] font-medium text-ink-faint">{group.title}</p>
          <div className="flex flex-wrap gap-1 px-1">
            {group.types.map((t) => (
              <button key={t} onClick={() => setTool({ kind: "object", objectType: t })}
                className={`rounded border px-1.5 py-1 text-[11px] ${
                  tool.kind === "object" && tool.objectType === t
                    ? "border-accent bg-accent-wash text-accent"
                    : "border-line text-ink-soft hover:border-line-strong"}`}>
                {OBJECT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

function Properties({
  object, area, count, boundaryPoints, onPatchObject, onPatchArea, onDelete,
}: {
  object: TwinObject | null;
  area: TwinArea | null;
  count: number;
  boundaryPoints: Point[];
  onPatchObject: (id: string, patch: Partial<TwinObject>) => void;
  onPatchArea: (id: string, patch: Partial<TwinArea>) => void;
  onDelete: () => void;
}) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-line bg-surface px-3 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Propriétés
      </p>

      {count > 1 && (
        <div>
          <p className="text-sm">{count} éléments sélectionnés</p>
          <button onClick={onDelete} className="mt-3 w-full rounded-md bg-critical-wash px-2 py-1.5 text-xs font-medium text-critical">
            Supprimer
          </button>
        </div>
      )}

      {object && (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-medium">{OBJECT_TYPE_LABELS[object.objectType]}</p>
          <NumberRow label="X (m)" value={object.position.xMeters}
            onChange={(v) => onPatchObject(object.id, { position: { ...object.position, xMeters: v } })} />
          <NumberRow label="Y (m)" value={object.position.yMeters}
            onChange={(v) => onPatchObject(object.id, { position: { ...object.position, yMeters: v } })} />
          <NumberRow label="Largeur (m)" value={object.widthMeters} min={0.05}
            onChange={(v) => onPatchObject(object.id, { widthMeters: v })} />
          <NumberRow label="Hauteur (m)" value={object.heightMeters} min={0.05}
            onChange={(v) => onPatchObject(object.id, { heightMeters: v })} />
          <NumberRow label="Rotation (°)" value={(object.rotationRadians * 180) / Math.PI}
            onChange={(v) => onPatchObject(object.id, { rotationRadians: (v * Math.PI) / 180 })} />
          {VEGETATION.has(object.objectType) && (
            <NumberRow label="Couronne (m)" value={object.canopyDiameterMeters ?? object.widthMeters} min={0.1}
              onChange={(v) => onPatchObject(object.id, { canopyDiameterMeters: v })} />
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">Étiquette</span>
            <input value={object.label ?? ""} onChange={(e) => onPatchObject(object.id, { label: e.target.value || null })}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent" />
          </label>
          <button onClick={onDelete} className="mt-1 w-full rounded-md bg-critical-wash px-2 py-1.5 text-xs font-medium text-critical">
            Supprimer
          </button>
        </div>
      )}

      {area && (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-medium">{AREA_TYPE_LABELS[area.areaType]}</p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">Nom</span>
            <input value={area.name} onChange={(e) => onPatchArea(area.id, { name: e.target.value })}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent" />
          </label>
          <Readout label="Surface" value={formatArea(polygonArea(area.points))} />
          <Readout label="Périmètre" value={formatMeters(perimeter(area.points))} />
          <Readout label="Sommets" value={String(area.points.length)} />
          <button onClick={onDelete} className="mt-1 w-full rounded-md bg-critical-wash px-2 py-1.5 text-xs font-medium text-critical">
            Supprimer
          </button>
        </div>
      )}

      {!object && !area && count === 0 && (
        <div>
          <p className="text-xs text-ink-soft">
            Sélectionnez un élément, ou choisissez un outil dans la bibliothèque.
          </p>
          {boundaryPoints.length >= 3 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Terrain
              </p>
              <Readout label="Surface" value={formatArea(polygonArea(boundaryPoints))} />
              <Readout label="Périmètre" value={formatMeters(perimeter(boundaryPoints))} />
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            <p className="mb-1 font-medium">Raccourcis</p>
            <p>Molette : zoom · Alt+glisser : déplacer</p>
            <p>Maj+clic : sélection multiple</p>
            <p>Maj pendant le tracé : angles à 45°</p>
            <p>Ctrl+Z / Ctrl+Maj+Z · Ctrl+D · Suppr</p>
          </div>
        </div>
      )}
    </aside>
  );
}

function NumberRow({
  label, value, onChange, min,
}: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <input
        type="number" step="0.1" min={min}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="tabular w-24 rounded-md border border-line-strong bg-surface px-2 py-1 text-right text-xs outline-none focus:border-accent"
      />
    </label>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span className="tabular text-xs font-medium">{value}</span>
    </div>
  );
}
