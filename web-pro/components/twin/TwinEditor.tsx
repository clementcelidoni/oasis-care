"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  worldToScreen, screenToWorld, distance, perimeter, polygonArea,
  snapPoint, snapAngle, pointInPolygon, pointInRotatedRect, rotatedRectCorners,
  boundsOf, centroid, formatMeters, formatArea, distanceToPolyline, DEFAULT_SNAP,
  type Point, type Camera, type SnapSettings,
} from "@/lib/twin/geometry";
import {
  OBJECT_TYPES, AREA_TYPES, OBJECT_TYPE_LABELS, AREA_TYPE_LABELS,
  AREA_COLORS, ROUND_OBJECTS, VEGETATION, colorForObject, defaultSizeFor,
  MAP_MODE_LABELS,
  REVISION_STATE_LABELS,
  type TwinDocument, type TwinObject, type TwinArea, type ObjectType,
  planScale,
  type AreaType, type MapMode, type RevisionState, type RevisionSummary,
  type PlanImage, type LinkablePlant,
  PIPE_LINE_TYPES, PIPE_MATERIALS, PIPE_LINE_TYPE_LABELS, PIPE_MATERIAL_LABELS,
  PIPE_STYLE, CABLE_TYPES, CABLE_TYPE_LABELS, CABLE_STYLE,
  MAP_LAYERS, LAYER_LABELS, LAYER_PROFILES, DEFAULT_LAYERS, layerForObjectType,
  type TwinPipe, type TwinCable, type PipeLineType, type PipeMaterial,
  type CableType, type MapLayer, type LayerProfile,
} from "@/lib/twin/types";
import {
  saveTwin, saveRevision, listRevisions, loadRevision, listLinkablePlants,
} from "@/lib/twin/actions";
import { computeQuantities } from "@/lib/twin/quantities";
import { useTileLayer } from "./useTileLayer";
import { PlanPanel } from "./PlanPanel";
import { listPlanImages, updatePlanImage } from "@/lib/twin/planActions";

type Tool =
  | { kind: "select" }
  | { kind: "boundary" }
  | { kind: "area"; areaType: AreaType }
  | { kind: "object"; objectType: ObjectType }
  | { kind: "pipe"; lineType: PipeLineType }
  | { kind: "cable"; cableType: CableType };

/** Les outils qui se dessinent point par point plutôt qu'en un clic. */
const DRAWING_TOOLS = new Set(["boundary", "area", "pipe", "cable"]);

/** Ceux dont le tracé reste OUVERT — un tuyau ne revient pas à son départ. */
const OPEN_TOOLS = new Set(["pipe", "cable"]);

type Selection = { kind: "object" | "area" | "pipe" | "cable"; id: string };
type SaveState = "idle" | "saving" | "saved" | "conflict" | "offline" | "error";

/** Un état complet du document — l'unité de l'undo/redo. */
type Snapshot = {
  boundaryPoints: Point[];
  areas: TwinArea[];
  objects: TwinObject[];
  pipes: TwinPipe[];
  cables: TwinCable[];
};

const MAX_HISTORY = 60;

export function TwinEditor({
  initial,
  baseModifiedAt,
}: {
  initial: TwinDocument;
  baseModifiedAt: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [boundaryId] = useState(() => initial.boundary?.id ?? crypto.randomUUID());
  const [doc, setDoc] = useState<Snapshot>(() => ({
    boundaryPoints: initial.boundary?.points ?? [],
    areas: initial.areas,
    objects: initial.objects,
    pipes: initial.pipes,
    cables: initial.cables,
  }));

  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [selection, setSelection] = useState<Selection[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("oasisPlan");
  const [snap, setSnap] = useState<SnapSettings>(DEFAULT_SNAP);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [plans, setPlans] = useState<PlanImage[]>([]);
  const [showPlans, setShowPlans] = useState(false);
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const planImages = useRef(new Map<string, HTMLImageElement>());
  const [plants, setPlants] = useState<LinkablePlant[]>([]);
  const [layers, setLayers] = useState<Record<MapLayer, boolean>>(DEFAULT_LAYERS);
  const [showLayers, setShowLayers] = useState(false);
  const [showQuantities, setShowQuantities] = useState(false);
  const modifiedAt = useRef<string | null>(baseModifiedAt);

  const [camera, setCamera] = useState<Camera>({ centerX: 0, centerY: 0, pixelsPerMeter: 14 });
  const [view, setView] = useState({ width: 800, height: 600 });

  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const deleted = useRef<{ areas: string[]; objects: string[]; pipes: string[]; cables: string[] }>(
    { areas: [], objects: [], pipes: [], cables: [] },
  );
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
        pipes: doc.pipes,
        cables: doc.cables,
        deletedAreaIds: deleted.current.areas,
        deletedObjectIds: deleted.current.objects,
        deletedPipeIds: deleted.current.pipes,
        deletedCableIds: deleted.current.cables,
        baseModifiedAt: modifiedAt.current,
      });
      if (result.ok) {
        deleted.current = { areas: [], objects: [], pipes: [], cables: [] };
        modifiedAt.current = result.modifiedAt ?? modifiedAt.current;
        setSaveState("saved");
      } else if (result.conflict) {
        // On garde le travail local intact et on cesse d'enregistrer
        // automatiquement : réessayer en boucle finirait par écraser
        // l'autre version dès qu'il aurait le dos tourné.
        dirty.current = false;
        setSaveState("conflict");
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
    if (!dirty.current || saveState === "conflict") return;
    const timer = setTimeout(save, 1200);
    return () => clearTimeout(timer);
  }, [doc, save, saveState]);

  // ---------- révisions ----------
  const refreshRevisions = useCallback(async () => {
    setRevisions(await listRevisions(initial.gardenId));
  }, [initial.gardenId]);

  const captureRevision = useCallback(
    async (label: string, state: RevisionState) => {
      await saveRevision({
        gardenId: initial.gardenId,
        label,
        state,
        snapshot: {
          boundary: doc.boundaryPoints,
          areas: doc.areas,
          objects: doc.objects,
          pipes: doc.pipes,
          cables: doc.cables,
        },
      });
      await refreshRevisions();
    },
    [doc, initial.gardenId, refreshRevisions],
  );

  const restoreRevision = useCallback(
    async (revisionId: string) => {
      const revision = await loadRevision(revisionId);
      if (!revision) return;
      const snapshot = revision.snapshot as {
        boundary?: Point[]; areas?: TwinArea[]; objects?: TwinObject[];
        pipes?: TwinPipe[]; cables?: TwinCable[];
      };
      // Passe par `commit` : restaurer une révision est annulable comme
      // n'importe quelle autre modification.
      //
      // Les réseaux manquent des révisions prises avant le Milestone 4 :
      // `?? []` les restaure alors vides, ce qui est exact — à cette
      // date-là le plan n'en avait effectivement aucun.
      commit({
        boundaryPoints: snapshot.boundary ?? [],
        areas: snapshot.areas ?? [],
        objects: snapshot.objects ?? [],
        pipes: snapshot.pipes ?? [],
        cables: snapshot.cables ?? [],
      });
      setSelection([]);
      setShowRevisions(false);
    },
    [commit],
  );

  // ---------- carnet de plantes, pour le rattachement ----------
  useEffect(() => {
    void listLinkablePlants(initial.gardenId).then(setPlants);
  }, [initial.gardenId]);

  // ---------- plans importés ----------
  // Le préchargement des images est une affaire de cache, pas d'état :
  // il remplit la ref que le canvas consulte au dessin, et rend la liste
  // telle quelle pour que l'appelant la pose ensuite dans l'état.
  const cachePlanImages = useCallback((list: PlanImage[]) => {
    for (const plan of list) {
      if (!plan.url || planImages.current.has(plan.id)) continue;
      const image = new Image();
      image.src = plan.url;
      image.onload = () => setPlans((p) => [...p]); // redessine une fois chargée
      planImages.current.set(plan.id, image);
    }
    return list;
  }, []);

  const reloadPlans = useCallback(
    () => listPlanImages(initial.gardenId).then(cachePlanImages).then(setPlans),
    [initial.gardenId, cachePlanImages],
  );

  // Chargement initial. L'état n'est posé qu'au retour du serveur, dans
  // la continuation de la promesse — comme pour le carnet de plantes
  // juste au-dessus.
  useEffect(() => {
    void reloadPlans();
  }, [reloadPlans]);

  /**
   * Termine le calibrage : deux points cliqués dans le monde, une
   * distance réelle saisie.
   *
   * Les points sont reconvertis en PIXELS de l'image avant d'être
   * stockés, parce que c'est ce qu'ils désignent vraiment — deux repères
   * sur le document. La conversion utilise l'échelle actuelle, même
   * fausse : le rapport entre les deux points, lui, est juste, et c'est
   * tout ce dont le calcul a besoin.
   */
  const finishCalibration = useCallback(
    async (points: Point[]) => {
      const plan = plans.find((p) => p.id === calibratingId);
      const image = calibratingId ? planImages.current.get(calibratingId) : null;
      if (!plan || !image || points.length !== 2) return;

      const answer = window.prompt(
        "Quelle est la distance réelle entre ces deux points, en mètres ?",
        "10",
      );
      const realDistance = Number((answer ?? "").replace(",", "."));
      if (!Number.isFinite(realDistance) || realDistance <= 0) {
        setCalibratingId(null);
        setCalibrationPoints([]);
        return;
      }

      const currentScale = planScale(plan.calibration) ?? 0.01;
      const toImagePixels = (p: Point) => {
        const dx = p.xMeters - plan.positionX;
        const dy = p.yMeters - plan.positionY;
        const cos = Math.cos(plan.rotationRadians);
        const sin = Math.sin(plan.rotationRadians);
        // Rotation inverse pour revenir dans le repère de l'image, puis
        // division par l'échelle. y est inversé : l'image descend.
        return {
          x: (dx * cos + dy * sin) / currentScale,
          y: -(-dx * sin + dy * cos) / currentScale,
        };
      };

      const a = toImagePixels(points[0]);
      const b = toImagePixels(points[1]);

      await updatePlanImage({
        id: plan.id,
        gardenId: initial.gardenId,
        calibration: {
          ax: a.x, ay: a.y, bx: b.x, by: b.y,
          realDistanceMeters: realDistance,
        },
      });
      setCalibratingId(null);
      setCalibrationPoints([]);
      await reloadPlans();
    },
    // `reloadPlans` est défini juste après ; la référence est résolue au
    // moment de l'appel, pas de la définition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, calibratingId, initial.gardenId],
  );

  // ---------- taille du canvas, et cadrage initial ----------
  // Les bornes du cadrage viennent de `initial` et non de `doc` : le
  // cadrage n'a lieu qu'une fois, au montage, où les deux coïncident.
  // S'appuyer sur `initial` évite en prime de recadrer sur un plan déjà
  // modifié si la première mesure arrivait tard.
  const initialBounds = useMemo(
    () =>
      boundsOf([
        ...(initial.boundary?.points ?? []),
        ...initial.areas.flatMap((a) => a.points),
        ...initial.objects.map((o) => o.position),
      ]),
    [initial],
  );

  const didFit = useRef(false);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    // Mesure et cadrage tiennent dans le même observateur : la taille
    // réelle du canvas n'existe qu'au moment où celui-ci la rapporte, et
    // c'est ce même signal qui doit fixer le premier zoom. Séparer les
    // deux imposait un rendu intermédiaire, mal cadré.
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setView(next);

      if (didFit.current || next.width < 50) return;
      // Posé avant le test des bornes : sur un plan vide il n'y a rien à
      // cadrer, et il ne faut pas réessayer à chaque redimensionnement.
      didFit.current = true;
      if (!initialBounds) return;
      const w = Math.max(initialBounds.maxX - initialBounds.minX, 10);
      const h = Math.max(initialBounds.maxY - initialBounds.minY, 10);
      setCamera({
        centerX: (initialBounds.minX + initialBounds.maxX) / 2,
        centerY: (initialBounds.minY + initialBounds.maxY) / 2,
        pixelsPerMeter: Math.min(next.width / (w * 1.3), next.height / (h * 1.3)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialBounds]);

  // Fond satellite. L'origine géographique vient du jardin : sans
  // latitude/longitude, aucun géoréférencement n'est possible et on le
  // dit plutôt que d'afficher un fond faux.
  const geoOrigin = useMemo(
    () =>
      initial.latitude != null && initial.longitude != null
        ? { latitude: initial.latitude, longitude: initial.longitude }
        : null,
    [initial.latitude, initial.longitude],
  );
  const showTiles = (mapMode === "satellite" || mapMode === "hybrid") && geoOrigin !== null;
  const tileLayer = useTileLayer(showTiles, geoOrigin, camera, view);

  /**
   * Ce sur quoi le curseur s'accroche pendant un tracé.
   *
   * Les objets ponctuels en font partie depuis le Milestone 4 : brancher
   * un tuyau sur une vanne demande de tomber exactement dessus, et viser
   * un point à 30 cm près à la souris n'est pas un travail raisonnable.
   */
  const allVertices = useMemo(
    () => [
      ...doc.boundaryPoints,
      ...doc.areas.flatMap((a) => a.points),
      ...doc.pipes.flatMap((x) => x.points),
      ...doc.cables.flatMap((x) => x.points),
      ...doc.objects.map((o) => o.position),
    ],
    [doc.boundaryPoints, doc.areas, doc.pipes, doc.cables, doc.objects],
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

    if (showTiles) {
      tileLayer.draw(ctx);
      // En mode hybride, on voile légèrement la photo : sans cela les
      // traits du plan se perdent dans le feuillage.
      if (mapMode === "hybrid") {
        ctx.fillStyle = "rgba(251,252,250,0.55)";
        ctx.fillRect(0, 0, view.width, view.height);
      }
    } else if (mapMode !== "oasisPlan") {
      ctx.fillStyle = "#5d6b64";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        geoOrigin === null
          ? "Ce jardin n’a pas de coordonnées : impossible de caler une photo aérienne."
          : "Fond indisponible à ce niveau de zoom.",
        view.width / 2, 28,
      );
      ctx.textAlign = "left";
    }

    // Plans importés, sous tout le reste : c'est un calque de fond,
    // le dessin doit rester lisible par-dessus.
    for (const plan of plans) {
      if (!plan.isVisible) continue;
      const image = planImages.current.get(plan.id);
      if (!image || !image.complete || image.naturalWidth === 0) continue;

      // Sans calibrage on ne connaît pas l'échelle. Plutôt que d'en
      // inventer une — ce qui ferait mesurer un terrain sur un plan
      // faux — on affiche 1 pixel = 1 cm, valeur ouvertement provisoire
      // que le panneau signale comme non calibrée.
      const metersPerPixel = planScale(plan.calibration) ?? 0.01;
      const widthMeters = image.naturalWidth * metersPerPixel;
      const heightMeters = image.naturalHeight * metersPerPixel;

      const topLeft = toScreen({ xMeters: plan.positionX, yMeters: plan.positionY });
      ctx.save();
      ctx.globalAlpha = plan.opacity;
      ctx.translate(topLeft.x, topLeft.y);
      // Rotation inversée : l'écran a son y vers le bas, le monde vers
      // le haut — voir worldToScreen.
      ctx.rotate(-plan.rotationRadians);
      ctx.drawImage(
        image, 0, 0,
        widthMeters * camera.pixelsPerMeter,
        heightMeters * camera.pixelsPerMeter,
      );
      ctx.restore();
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
    for (const area of layers.areas ? doc.areas : []) {
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

    // Réseaux, SOUS les objets : un tuyau passe derrière la vanne qu'il
    // alimente, sinon le trait barre le symbole.
    const drawPolyline = (
      points: Point[], style: { color: string; width: number; dash: number[] },
      selected: boolean, lengthLabel: boolean,
    ) => {
      if (points.length < 2) return;
      ctx.beginPath();
      points.forEach((pt, i) => {
        const sp = toScreen(pt);
        i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y);
      });
      ctx.setLineDash(style.dash);
      ctx.strokeStyle = selected ? "#15654a" : style.color;
      ctx.lineWidth = selected ? style.width + 1.5 : style.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.setLineDash([]);

      if (selected) {
        for (const pt of points) {
          const sp = toScreen(pt);
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#15654a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // « La longueur est calculée automatiquement » — affichée au
      // milieu du tracé, et seulement quand elle est lisible.
      if (lengthLabel && camera.pixelsPerMeter > 4) {
        const mid = toScreen(points[Math.floor(points.length / 2)]);
        const text = formatMeters(perimeter(points, false));
        ctx.font = "10px system-ui, sans-serif";
        const w = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(mid.x - w / 2 - 3, mid.y - 15, w + 6, 14);
        ctx.fillStyle = style.color;
        ctx.textAlign = "center";
        ctx.fillText(text, mid.x, mid.y - 4);
        ctx.textAlign = "left";
      }
    };

    if (layers.irrigation) {
      for (const pipe of doc.pipes) {
        drawPolyline(
          pipe.points, PIPE_STYLE[pipe.lineType],
          selection.some((sel) => sel.kind === "pipe" && sel.id === pipe.id),
          true,
        );
      }
    }
    if (layers.devices) {
      for (const cable of doc.cables) {
        drawPolyline(
          cable.points, CABLE_STYLE[cable.cableType],
          selection.some((sel) => sel.kind === "cable" && sel.id === cable.id),
          true,
        );
      }
    }

    // §COVERAGE — la portée des arroseurs, sous les objets eux-mêmes.
    //
    // Ce que ce dessin dit exactement : le disque qu'un arroseur réglé
    // ainsi peut atteindre. Il ne dit RIEN de la pluviométrie réelle,
    // qui dépend de la pression, du vent et du modèle. C'est
    // « estimated », jamais « measured », et le panneau le répète.
    if (layers.coverage) {
      for (const object of doc.objects) {
        if (object.objectType !== "sprinkler") continue;
        const radius = object.sprinklerRadiusMeters;
        if (!radius || radius <= 0) continue;
        const start = object.sprinklerStartAngleDegrees ?? 0;
        const end = object.sprinklerEndAngleDegrees ?? 360;
        const center = toScreen(object.position);
        const r = radius * camera.pixelsPerMeter;

        // Les angles sont donnés dans le repère du monde (0 = est,
        // sens trigonométrique). Le canvas tourne dans l'autre sens
        // parce que son axe y descend : d'où les signes inversés.
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.arc(center.x, center.y, r, (-end * Math.PI) / 180, (-start * Math.PI) / 180);
        ctx.closePath();
        ctx.fillStyle = "rgba(90,150,200,0.18)";
        ctx.fill();
        ctx.strokeStyle = "rgba(56,103,143,0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Objets
    for (const object of [...doc.objects].sort((a, b) => a.zIndex - b.zIndex)) {
      // §CALQUES — un objet dont le calque est éteint n'est pas dessiné.
      const layer = layerForObjectType(object.objectType);
      if (layer && !layers[layer]) continue;
      const colors = colorForObject(object.objectType);
      const isSelected = selection.some((s) => s.kind === "object" && s.id === object.id);
      const s = toScreen(object.position);

      if (ROUND_OBJECTS.has(object.objectType)) {
        // §"TREE SCALE" — le diamètre graphique suit canopyDiameter
        // quand il existe, plutôt qu'une taille arbitraire.
        const diameter = VEGETATION.has(object.objectType) && layers.canopies
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
        // (la longueur cumulée du tracé est affichée dans le bandeau)
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

    // Points de calibrage en cours de saisie.
    if (calibratingId && calibrationPoints.length > 0) {
      ctx.strokeStyle = "#a03b31";
      ctx.fillStyle = "#a03b31";
      ctx.lineWidth = 2;
      if (calibrationPoints.length === 2) {
        const a = toScreen(calibrationPoints[0]);
        const b = toScreen(calibrationPoints[1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const p of calibrationPoints) {
        const s2 = toScreen(p);
        ctx.beginPath();
        ctx.arc(s2.x, s2.y, 5, 0, Math.PI * 2);
        ctx.fill();
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

    // Attribution du fournisseur : obligatoire pour les fonds gratuits.
    if (showTiles && tileLayer.attribution) {
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "right";
      const w = ctx.measureText(tileLayer.attribution).width;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(view.width - w - 12, view.height - 20, w + 8, 14);
      ctx.fillStyle = "#46584f";
      ctx.fillText(tileLayer.attribution, view.width - 8, view.height - 10);
      ctx.textAlign = "left";
    }
  }, [doc, camera, view, selection, draft, cursor, snap, mapMode, showTiles, tileLayer,
      geoOrigin, plans, calibratingId, calibrationPoints, layers]);

  // ---------- interaction ----------
  const pointerWorld = (event: React.PointerEvent | React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top }, camera, view,
    );
  };

  const hitTest = (p: Point): Selection | null => {
    // Un calque éteint rend ses éléments insélectionnables : attraper
    // par mégarde quelque chose qu'on a délibérément masqué est la
    // façon la plus sûre de casser un plan sans s'en apercevoir.
    for (const o of [...doc.objects].sort((a, b) => b.zIndex - a.zIndex)) {
      const layer = layerForObjectType(o.objectType);
      if (layer && !layers[layer]) continue;
      const w = ROUND_OBJECTS.has(o.objectType)
        ? (VEGETATION.has(o.objectType) ? (o.canopyDiameterMeters ?? o.widthMeters) : o.widthMeters)
        : o.widthMeters;
      const h = ROUND_OBJECTS.has(o.objectType) ? w : o.heightMeters;
      if (pointInRotatedRect(p, o.position, w, h, o.rotationRadians)) {
        return { kind: "object", id: o.id };
      }
    }

    // Les réseaux avant les zones : un trait posé sur un massif doit
    // rester attrapable, alors que le massif occupe toute la surface.
    // La tolérance est en PIXELS puis convertie, pour rester constante
    // à l'écran quel que soit le zoom — un tuyau de 25 mm dessiné à
    // faible zoom serait autrement impossible à viser.
    const tolerance = 6 / camera.pixelsPerMeter;
    if (layers.irrigation) {
      for (const pipe of doc.pipes) {
        if (distanceToPolyline(p, pipe.points) <= tolerance) return { kind: "pipe", id: pipe.id };
      }
    }
    if (layers.devices) {
      for (const cable of doc.cables) {
        if (distanceToPolyline(p, cable.points) <= tolerance) return { kind: "cable", id: cable.id };
      }
    }

    if (layers.areas) {
      for (const a of doc.areas) {
        if (pointInPolygon(p, a.points)) return { kind: "area", id: a.id };
      }
    }
    return null;
  };

  function onPointerDown(event: React.PointerEvent) {
    canvasRef.current?.setPointerCapture(event.pointerId);
    const raw = pointerWorld(event);

    // Calibrage : deux clics, puis la distance réelle.
    if (calibratingId) {
      const next = [...calibrationPoints, raw].slice(-2);
      setCalibrationPoints(next);
      if (next.length === 2) void finishCalibration(next);
      return;
    }

    // Bouton du milieu, ou espace : déplacement de la vue.
    if (event.button === 1 || event.altKey) {
      drag.current = {
        mode: "pan", startX: event.clientX, startY: event.clientY,
        camX: camera.centerX, camY: camera.centerY,
      };
      return;
    }

    if (DRAWING_TOOLS.has(tool.kind)) {
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
        linkedEntityId: null,
        linkedEntityKind: null,
        // Un arroseur posé sans portée serait un point sans signification.
        // 4 m sur 360° : un tuyau d'arrosage ordinaire, à corriger dans le
        // panneau — une valeur de départ visible vaut mieux qu'un vide.
        sprinklerRadiusMeters: tool.objectType === "sprinkler" ? 4 : null,
        sprinklerStartAngleDegrees: tool.objectType === "sprinkler" ? 0 : null,
        sprinklerEndAngleDegrees: tool.objectType === "sprinkler" ? 360 : null,
        sprinklerFlowRateLitersPerHour: null,
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

    if (DRAWING_TOOLS.has(tool.kind)) {
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
      const pipeIds = new Set(selection.filter((s) => s.kind === "pipe").map((s) => s.id));
      const cableIds = new Set(selection.filter((s) => s.kind === "cable").map((s) => s.id));
      const shift = (pts: Point[]) =>
        pts.map((pt) => ({ xMeters: pt.xMeters + dx, yMeters: pt.yMeters + dy }));
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
          areaIds.has(a.id) ? { ...a, points: shift(a.points) } : a,
        ),
        pipes: s.pipes.map((x) => (pipeIds.has(x.id) ? { ...x, points: shift(x.points) } : x)),
        cables: s.cables.map((x) => (cableIds.has(x.id) ? { ...x, points: shift(x.points) } : x)),
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
    // Un tuyau se contente de deux points ; une surface en exige trois,
    // sinon elle n'a pas d'aire.
    const minimum = OPEN_TOOLS.has(tool.kind) ? 2 : 3;
    if (draft.length < minimum) {
      setDraft([]);
      return;
    }
    if (tool.kind === "pipe") {
      const pipe: TwinPipe = {
        id: crypto.randomUUID(),
        points: draft,
        // Les diamètres courants du réseau d'arrosage domestique. Le
        // panneau permet de corriger ; ces valeurs évitent d'avoir à le
        // faire à chaque tracé.
        diameterMM: tool.lineType === "mainSupply" ? 32 : tool.lineType === "secondary" ? 25 : 16,
        material: "pe",
        lineType: tool.lineType,
        startNodeObjectId: null,
        endNodeObjectId: null,
      };
      commit((s) => ({ ...s, pipes: [...s.pipes, pipe] }));
      setSelection([{ kind: "pipe", id: pipe.id }]);
      setDraft([]);
      setTool({ kind: "select" });
      return;
    }
    if (tool.kind === "cable") {
      const cable: TwinCable = {
        id: crypto.randomUUID(),
        points: draft,
        cableType: tool.cableType,
        sectionMM2: tool.cableType === "lowVoltage" ? 2.5 : null,
        startNodeObjectId: null,
        endNodeObjectId: null,
      };
      commit((s) => ({ ...s, cables: [...s.cables, cable] }));
      setSelection([{ kind: "cable", id: cable.id }]);
      setDraft([]);
      setTool({ kind: "select" });
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
    const pipeIds = selection.filter((s) => s.kind === "pipe").map((s) => s.id);
    const cableIds = selection.filter((s) => s.kind === "cable").map((s) => s.id);
    deleted.current.objects.push(...objectIds);
    deleted.current.areas.push(...areaIds);
    deleted.current.pipes.push(...pipeIds);
    deleted.current.cables.push(...cableIds);
    commit((s) => ({
      ...s,
      objects: s.objects.filter((o) => !objectIds.includes(o.id)),
      areas: s.areas.filter((a) => !areaIds.includes(a.id)),
      pipes: s.pipes.filter((x) => !pipeIds.includes(x.id)),
      cables: s.cables.filter((x) => !cableIds.includes(x.id)),
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
  const selectedPipe =
    selection.length === 1 && selection[0].kind === "pipe"
      ? doc.pipes.find((x) => x.id === selection[0].id) ?? null
      : null;
  const selectedCable =
    selection.length === 1 && selection[0].kind === "cable"
      ? doc.cables.find((x) => x.id === selection[0].id) ?? null
      : null;

  const patchObject = (id: string, patch: Partial<TwinObject>) =>
    commit((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const patchPipe = (id: string, patch: Partial<TwinPipe>) =>
    commit((s) => ({ ...s, pipes: s.pipes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const patchCable = (id: string, patch: Partial<TwinCable>) =>
    commit((s) => ({ ...s, cables: s.cables.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  // §"QUANTITÉS AUTOMATIQUES" — recalculé à chaque changement du plan,
  // jamais stocké : un métré enregistré à côté du dessin le contredit
  // dès la première modification.
  const quantities = useMemo(
    () => computeQuantities({
      boundaryPoints: doc.boundaryPoints,
      areas: doc.areas, objects: doc.objects, pipes: doc.pipes, cables: doc.cables,
    }),
    [doc],
  );

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        tool={tool} setTool={setTool}
        mapMode={mapMode} setMapMode={setMapMode}
        snap={snap} setSnap={setSnap}
        onUndo={undo} onRedo={redo}
        onFinish={finishDraft} drafting={draft.length > 0}
        saveState={saveState} gardenName={initial.gardenName}
        onToggleRevisions={() => {
          // Le rechargement appartient au clic, pas à un effet : c'est
          // l'ouverture du panneau qui demande la liste, et rien d'autre
          // ne la rend obsolète.
          const opening = !showRevisions;
          setShowRevisions(opening);
          setShowPlans(false); setShowLayers(false); setShowQuantities(false);
          if (opening) void refreshRevisions();
        }}
        revisionsOpen={showRevisions}
        onTogglePlans={() => { setShowPlans((v) => !v); setShowRevisions(false); setShowLayers(false); setShowQuantities(false); }}
        plansOpen={showPlans}
        onToggleLayers={() => { setShowLayers((v) => !v); setShowPlans(false); setShowRevisions(false); setShowQuantities(false); }}
        layersOpen={showLayers}
        onToggleQuantities={() => { setShowQuantities((v) => !v); setShowPlans(false); setShowRevisions(false); setShowLayers(false); }}
        quantitiesOpen={showQuantities}
      />

      {saveState === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-critical-wash px-3 py-2 text-sm text-critical">
          <span>
            <strong>Ce plan a été modifié ailleurs</strong> — depuis un autre onglet,
            un collègue ou l&apos;iPhone. Vos changements ne sont pas enregistrés,
            et rien n&apos;a été écrasé.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-critical px-2.5 py-1 text-xs font-medium text-white"
          >
            Recharger la version du serveur
          </button>
          <span className="text-xs">
            Pour ne rien perdre : enregistrez d&apos;abord une révision de votre
            travail, puis rechargez.
          </span>
        </div>
      )}

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
              {/* Une aire n'a de sens que pour une surface fermée : un
                  tuyau en L n'en a pas, et en afficher une tromperait. */}
              {!OPEN_TOOLS.has(tool.kind) && draft.length >= 3 && ` · ${formatArea(polygonArea(draft))}`}
              {OPEN_TOOLS.has(tool.kind)
                ? " — double-clic ou Entrée pour terminer"
                : " — double-clic ou Entrée pour fermer"}
            </div>
          )}
        </div>

        {showPlans ? (
          <PlanPanel
            gardenId={initial.gardenId}
            plans={plans}
            onReload={reloadPlans}
            calibratingId={calibratingId}
            onStartCalibration={(id) => {
              setCalibratingId(id);
              setCalibrationPoints([]);
              setTool({ kind: "select" });
            }}
            onCancelCalibration={() => {
              setCalibratingId(null);
              setCalibrationPoints([]);
            }}
            onClose={() => setShowPlans(false)}
          />
        ) : showRevisions ? (
          <Revisions
            revisions={revisions}
            onCapture={captureRevision}
            onRestore={restoreRevision}
            onClose={() => setShowRevisions(false)}
          />
        ) : showLayers ? (
          <Layers
            layers={layers}
            setLayers={setLayers}
            onClose={() => setShowLayers(false)}
          />
        ) : showQuantities ? (
          <Quantities
            report={quantities}
            gardenId={initial.gardenId}
            onClose={() => setShowQuantities(false)}
          />
        ) : (
          <Properties
            plants={plants}
            object={selectedObject}
            area={selectedArea}
            pipe={selectedPipe}
            cable={selectedCable}
            count={selection.length}
            boundaryPoints={doc.boundaryPoints}
            onPatchObject={patchObject}
            onPatchPipe={patchPipe}
            onPatchCable={patchCable}
            onPatchArea={(id, patch) =>
              commit((s) => ({ ...s, areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
            }
            onDelete={deleteSelection}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------

function Toolbar({
  tool, setTool, mapMode, setMapMode, snap, setSnap,
  onUndo, onRedo, onFinish, drafting, saveState, gardenName,
  onToggleRevisions, revisionsOpen, onTogglePlans, plansOpen,
  onToggleLayers, layersOpen, onToggleQuantities, quantitiesOpen,
}: {
  tool: Tool; setTool: (t: Tool) => void;
  mapMode: MapMode; setMapMode: (m: MapMode) => void;
  snap: SnapSettings; setSnap: (s: SnapSettings) => void;
  onUndo: () => void; onRedo: () => void; onFinish: () => void;
  drafting: boolean; saveState: SaveState; gardenName: string;
  onToggleRevisions: () => void; revisionsOpen: boolean;
  onTogglePlans: () => void; plansOpen: boolean;
  onToggleLayers: () => void; layersOpen: boolean;
  onToggleQuantities: () => void; quantitiesOpen: boolean;
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

      <span className="mx-1 h-5 w-px bg-line" />

      <button onClick={onTogglePlans}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${plansOpen ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"}`}>
        Plan importé
      </button>
      <button onClick={onToggleRevisions}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${revisionsOpen ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"}`}>
        Versions
      </button>
      <button onClick={onToggleLayers}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${layersOpen ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"}`}>
        Calques
      </button>
      <button onClick={onToggleQuantities}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${quantitiesOpen ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"}`}>
        Métré
      </button>

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

      {/*
        Les réseaux ne sont pas des objets ponctuels : on les TRACE, comme
        une zone. D'où leur place à part, au-dessus de la bibliothèque
        d'objets, et non parmi les vannes et les arroseurs.
      */}
      <p className="mb-1 mt-3 px-1.5 text-[11px] font-medium text-ink-faint">
        Réseau d&apos;irrigation
      </p>
      <div className="flex flex-wrap gap-1 px-1">
        {PIPE_LINE_TYPES.map((t) => (
          <button key={t} onClick={() => setTool({ kind: "pipe", lineType: t })}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] ${
              tool.kind === "pipe" && tool.lineType === t
                ? "border-accent bg-accent-wash text-accent"
                : "border-line text-ink-soft hover:border-line-strong"}`}>
            <span className="inline-block h-0.5 w-3.5 shrink-0"
              style={{ backgroundColor: PIPE_STYLE[t].color }} />
            {PIPE_LINE_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <p className="mb-1 mt-3 px-1.5 text-[11px] font-medium text-ink-faint">
        Câbles
      </p>
      <div className="flex flex-wrap gap-1 px-1">
        {CABLE_TYPES.filter((t) => t !== "other").map((t) => (
          <button key={t} onClick={() => setTool({ kind: "cable", cableType: t })}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] ${
              tool.kind === "cable" && tool.cableType === t
                ? "border-accent bg-accent-wash text-accent"
                : "border-line text-ink-soft hover:border-line-strong"}`}>
            <span className="inline-block h-0.5 w-3.5 shrink-0"
              style={{ backgroundColor: CABLE_STYLE[t].color }} />
            {CABLE_TYPE_LABELS[t]}
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
  plants, object, area, pipe, cable, count, boundaryPoints,
  onPatchObject, onPatchArea, onPatchPipe, onPatchCable, onDelete,
}: {
  plants: LinkablePlant[];
  object: TwinObject | null;
  area: TwinArea | null;
  pipe: TwinPipe | null;
  cable: TwinCable | null;
  count: number;
  boundaryPoints: Point[];
  onPatchObject: (id: string, patch: Partial<TwinObject>) => void;
  onPatchArea: (id: string, patch: Partial<TwinArea>) => void;
  onPatchPipe: (id: string, patch: Partial<TwinPipe>) => void;
  onPatchCable: (id: string, patch: Partial<TwinCable>) => void;
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

          {object.objectType === "sprinkler" && (
            <SprinklerFields object={object} onPatchObject={onPatchObject} />
          )}

          <PlantLink plants={plants} object={object} onPatchObject={onPatchObject} />
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

      {pipe && <PipeProperties pipe={pipe} onPatch={onPatchPipe} onDelete={onDelete} />}
      {cable && <CableProperties cable={cable} onPatch={onPatchCable} onDelete={onDelete} />}

      {!object && !area && !pipe && !cable && count === 0 && (
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

/**
 * §PIPE — « un tuyau n'est PAS une simple ligne graphique. »
 *
 * Diamètre, matériau, nature de la conduite : de quoi chiffrer, pas
 * seulement de quoi dessiner. La longueur est en lecture seule et le
 * restera : elle se lit sur le tracé, et un champ modifiable inviterait
 * à écrire un chiffre qui contredirait le dessin dès le premier coude
 * déplacé.
 */
function PipeProperties({
  pipe, onPatch, onDelete,
}: {
  pipe: TwinPipe;
  onPatch: (id: string, patch: Partial<TwinPipe>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-medium">{PIPE_LINE_TYPE_LABELS[pipe.lineType]}</p>

      <Readout label="Longueur mesurée" value={formatMeters(perimeter(pipe.points, false))} />
      <Readout label="Points" value={String(pipe.points.length)} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Nature</span>
        <select value={pipe.lineType}
          onChange={(e) => onPatch(pipe.id, { lineType: e.target.value as PipeLineType })}
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent">
          {PIPE_LINE_TYPES.map((t) => (
            <option key={t} value={t}>{PIPE_LINE_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>

      <NumberRow label="Diamètre (mm)" value={pipe.diameterMM} min={1}
        onChange={(v) => onPatch(pipe.id, { diameterMM: v })} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Matériau</span>
        <select value={pipe.material}
          onChange={(e) => onPatch(pipe.id, { material: e.target.value as PipeMaterial })}
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent">
          {PIPE_MATERIALS.map((m) => (
            <option key={m} value={m}>{PIPE_MATERIAL_LABELS[m]}</option>
          ))}
        </select>
      </label>

      <button onClick={onDelete} className="mt-1 w-full rounded-md bg-critical-wash px-2 py-1.5 text-xs font-medium text-critical">
        Supprimer
      </button>
    </div>
  );
}

/**
 * §LIGHTING. Même forme que le tuyau, à ceci près qu'il n'y a
 * délibérément ni calcul de chute de tension ni dimensionnement :
 * « Pas d'ingénierie électrique certifiée automatique. » On mesure un
 * linéaire pour le chiffrer, c'est tout.
 */
function CableProperties({
  cable, onPatch, onDelete,
}: {
  cable: TwinCable;
  onPatch: (id: string, patch: Partial<TwinCable>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-medium">Câble — {CABLE_TYPE_LABELS[cable.cableType]}</p>

      <Readout label="Longueur mesurée" value={formatMeters(perimeter(cable.points, false))} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Type</span>
        <select value={cable.cableType}
          onChange={(e) => onPatch(cable.id, { cableType: e.target.value as CableType })}
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent">
          {CABLE_TYPES.map((t) => (
            <option key={t} value={t}>{CABLE_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>

      <NumberRow label="Section (mm²)" value={cable.sectionMM2 ?? 0} min={0}
        onChange={(v) => onPatch(cable.id, { sectionMM2: v > 0 ? v : null })} />

      <p className="text-[11px] text-ink-faint">
        Métré uniquement. Le dimensionnement électrique reste à la charge
        d&apos;un professionnel qualifié.
      </p>

      <button onClick={onDelete} className="mt-1 w-full rounded-md bg-critical-wash px-2 py-1.5 text-xs font-medium text-critical">
        Supprimer
      </button>
    </div>
  );
}

/**
 * §SPRINKLER — rayon et secteur arrosé.
 *
 * Les angles sont ceux du plan : 0° à l'est, croissant vers le nord.
 * Les valeurs usuelles sont proposées en un clic parce qu'un arroseur
 * de jardin se règle presque toujours sur un quart, un demi ou un tour
 * complet, et que saisir « 90 » puis « 180 » à la main pour chaque tête
 * est un travail inutile.
 */
function SprinklerFields({
  object, onPatchObject,
}: {
  object: TwinObject;
  onPatchObject: (id: string, patch: Partial<TwinObject>) => void;
}) {
  const start = object.sprinklerStartAngleDegrees ?? 0;
  const end = object.sprinklerEndAngleDegrees ?? 360;
  const sector = Math.abs(end - start);

  const PRESETS = [90, 180, 270, 360];

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
      <span className="text-[11px] font-medium text-ink-faint">Arrosage</span>

      <NumberRow label="Portée (m)" value={object.sprinklerRadiusMeters ?? 0} min={0}
        onChange={(v) => onPatchObject(object.id, { sprinklerRadiusMeters: v > 0 ? v : null })} />

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Secteur</span>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((deg) => (
            <button key={deg}
              onClick={() => onPatchObject(object.id, {
                sprinklerStartAngleDegrees: start,
                sprinklerEndAngleDegrees: start + deg,
              })}
              className={`rounded border px-1.5 py-1 text-[11px] ${
                Math.round(sector) === deg
                  ? "border-accent bg-accent-wash text-accent"
                  : "border-line text-ink-soft hover:border-line-strong"}`}>
              {deg}°
            </button>
          ))}
        </div>
      </div>

      <NumberRow label="Orientation (°)" value={start}
        onChange={(v) => onPatchObject(object.id, {
          sprinklerStartAngleDegrees: v,
          sprinklerEndAngleDegrees: v + sector,
        })} />

      <NumberRow label="Débit (L/h)" value={object.sprinklerFlowRateLitersPerHour ?? 0} min={0}
        onChange={(v) => onPatchObject(object.id, {
          sprinklerFlowRateLitersPerHour: v > 0 ? v : null,
        })} />

      <p className="text-[11px] text-ink-faint">
        Portée <strong>estimée</strong> d&apos;après ce réglage. La pluviométrie
        réelle dépend de la pression, du vent et du modèle — activez le
        calque « Couverture d&apos;arrosage » pour la visualiser.
      </p>
    </div>
  );
}

function Layers({
  layers, setLayers, onClose,
}: {
  layers: Record<MapLayer, boolean>;
  setLayers: (l: Record<MapLayer, boolean>) => void;
  onClose: () => void;
}) {
  const applyProfile = (key: LayerProfile) => {
    const wanted = new Set<string>(LAYER_PROFILES[key].layers);
    setLayers(
      Object.fromEntries(MAP_LAYERS.map((l) => [l, wanted.has(l)])) as Record<MapLayer, boolean>,
    );
  };

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-line bg-surface px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Calques</p>
        <button onClick={onClose} className="text-xs text-ink-faint hover:text-ink">Fermer</button>
      </div>

      <p className="mb-1 text-[11px] text-ink-faint">Profils</p>
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(LAYER_PROFILES) as LayerProfile[]).map((key) => (
          <button key={key} onClick={() => applyProfile(key)}
            className="rounded border border-line px-1.5 py-1 text-[11px] text-ink-soft hover:border-line-strong">
            {LAYER_PROFILES[key].label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        {MAP_LAYERS.map((layer) => (
          <label key={layer} className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={layers[layer]}
              onChange={(e) => setLayers({ ...layers, [layer]: e.target.checked })} />
            {LAYER_LABELS[layer]}
          </label>
        ))}
      </div>

      <p className="mt-3 border-t border-line pt-2.5 text-[11px] text-ink-faint">
        Les calques ne changent que l&apos;affichage. Rien n&apos;est supprimé,
        et ces réglages ne sont pas enregistrés avec le plan.
      </p>
    </aside>
  );
}

/**
 * §"QUANTITÉS AUTOMATIQUES".
 *
 * Trois listes séparées et jamais un total : additionner des m², des m
 * et des unités ne veut rien dire, et un grand nombre en bas de panneau
 * serait lu comme un résultat.
 */
function Quantities({
  report, gardenId, onClose,
}: {
  report: ReturnType<typeof computeQuantities>;
  gardenId: string;
  onClose: () => void;
}) {
  const SECTIONS: { title: string; lines: typeof report.surfaces }[] = [
    { title: "Surfaces", lines: report.surfaces },
    { title: "Linéaires", lines: report.lengths },
    { title: "Quantités", lines: report.counts },
  ];

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-line bg-surface px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Métré</p>
        <button onClick={onClose} className="text-xs text-ink-faint hover:text-ink">Fermer</button>
      </div>

      {report.isEmpty ? (
        <p className="text-[11px] text-ink-faint">
          Rien à mesurer pour l&apos;instant. Tracez une zone, un réseau ou
          placez des végétaux.
        </p>
      ) : (
        SECTIONS.filter((s) => s.lines.length > 0).map((section) => (
          <div key={section.title} className="mb-3">
            <p className="mb-1 text-[11px] font-medium text-ink-faint">{section.title}</p>
            <table className="w-full text-xs">
              <tbody>
                {section.lines.map((line) => (
                  <tr key={line.key} className="border-b border-line last:border-0">
                    <td className="py-1 pr-2 text-ink-soft">{line.label}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{line.formatted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/*
        §"DIGITAL TWIN → DEVIS". Un lien, et non un bouton qui écrirait
        directement : « NE PAS ajouter silencieusement des coûts. » La
        page d'après montre chaque ligne proposée avant d'en créer une.
      */}
      {!report.isEmpty && (
        <a
          href={`/devis/depuis-plan/${gardenId}`}
          className="mt-2 block rounded-md bg-accent px-2.5 py-2 text-center text-xs font-medium text-accent-ink"
        >
          Verser dans un devis
        </a>
      )}

      <p className="mt-2 border-t border-line pt-2.5 text-[11px] text-ink-faint">
        Mesuré sur le plan, jamais saisi. Recalculé à chaque modification.
        {!report.isEmpty && " Rien n’est ajouté à un devis sans votre relecture."}
      </p>
    </aside>
  );
}

/** §"VERSIONS DU PROJET" — figer, comparer, restaurer. */
function Revisions({
  revisions, onCapture, onRestore, onClose,
}: {
  revisions: RevisionSummary[];
  onCapture: (label: string, state: RevisionState) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [state, setState] = useState<RevisionState>("proposal");
  const [busy, setBusy] = useState(false);

  const STATE_TONE: Record<RevisionState, string> = {
    existing: "bg-canvas text-ink-soft",
    proposal: "bg-info-wash text-info",
    approved: "bg-accent-wash text-accent",
    asBuilt: "bg-warning-wash text-warning",
  };

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface px-3 py-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Versions</p>
        <button onClick={onClose} className="text-xs text-ink-soft hover:text-ink">Fermer</button>
      </div>

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom de la version"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <select
          value={state}
          onChange={(e) => setState(e.target.value as RevisionState)}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          {(Object.keys(REVISION_STATE_LABELS) as RevisionState[]).map((s) => (
            <option key={s} value={s}>{REVISION_STATE_LABELS[s]}</option>
          ))}
        </select>
        <button
          disabled={busy || label.trim() === ""}
          onClick={async () => {
            setBusy(true);
            await onCapture(label.trim(), state);
            setLabel("");
            setBusy(false);
          }}
          className="rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {busy ? "Enregistrement…" : "Figer l'état actuel"}
        </button>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Une version est une copie complète du plan à cet instant. Elle ne
          bouge plus, même si le plan courant change entièrement.
        </p>
      </div>

      {revisions.length === 0 ? (
        <p className="text-xs text-ink-faint">Aucune version enregistrée.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {revisions.map((r) => (
            <li key={r.id} className="rounded-lg border border-line p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{r.label}</p>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_TONE[r.state]}`}>
                  {REVISION_STATE_LABELS[r.state]}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {new Date(r.createdAt).toLocaleString("fr-FR", {
                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                })}
                {" · "}
                {r.objectCount} objet{r.objectCount > 1 ? "s" : ""}, {r.areaCount} zone
                {r.areaCount > 1 ? "s" : ""}
              </p>
              <button
                onClick={() => onRestore(r.id)}
                className="mt-2 w-full rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium hover:bg-canvas"
              >
                Restaurer dans le plan
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Restaurer remplace le plan courant, mais reste annulable par Ctrl+Z.
      </p>
    </aside>
  );
}

/**
 * §11C : rattacher l'objet du plan à une vraie plante de ce jardin.
 *
 * Écrit `linkedEntityId` + `linkedEntityKind`, les deux colonnes que
 * l'iPhone lit déjà depuis la Phase 6 — toucher l'objet y ouvre la
 * fiche de la plante. `linkedEntityKind` ne peut valoir que `plant` ou
 * `sensor` : ce sont les seuls cas de l'enum Swift.
 *
 * Le choix se limite aux plantes de CE jardin — voir
 * `listLinkablePlants`. D'où le cas ci-dessous : un objet peut porter un
 * lien vers une plante absente de cette liste, posé depuis l'iPhone ou
 * avant que la liste ne soit bornée. On l'affiche pour ce qu'il est au
 * lieu de laisser le menu dire « Aucune », ce qui serait un mensonge :
 * le lien existe bel et bien en base et l'utilisateur doit pouvoir le
 * voir avant de décider de le retirer.
 */
function PlantLink({
  plants, object, onPatchObject,
}: {
  plants: LinkablePlant[];
  object: TwinObject;
  onPatchObject: (id: string, patch: Partial<TwinObject>) => void;
}) {
  const linkedId = object.linkedEntityKind === "plant" ? object.linkedEntityId : null;
  const linked = linkedId ? plants.find((p) => p.id === linkedId) ?? null : null;
  const linkedElsewhere = linkedId !== null && linked === null;

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2.5">
      <span className="text-[11px] text-ink-faint">Plante rattachée</span>

      {plants.length === 0 && !linkedElsewhere ? (
        <p className="text-[11px] text-ink-faint">
          Aucune plante dans ce jardin. Ajoutez-en depuis l&apos;application
          iPhone, elles apparaîtront ici.
        </p>
      ) : (
        <select
          value={linkedId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            const plant = plants.find((p) => p.id === id) ?? null;
            onPatchObject(object.id, {
              linkedEntityId: id || null,
              linkedEntityKind: id ? "plant" : null,
              // Reprend le nom de la plante comme étiquette, sauf si
              // l'utilisateur en a déjà saisi une : son texte l'emporte.
              label: object.label ?? plant?.customName ?? null,
            });
          }}
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        >
          <option value="">— Aucune —</option>
          {linkedElsewhere && (
            <option value={linkedId}>Plante d&apos;un autre jardin</option>
          )}
          {plants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.customName}
              {p.commonName ? ` · ${p.commonName}` : ""}
            </option>
          ))}
        </select>
      )}

      {linked && (
        <p className="text-[11px] text-ink-faint">
          {linked.scientificName ?? linked.commonName ?? ""}
        </p>
      )}

      {linkedElsewhere && (
        <p className="text-[11px] text-warning">
          Cette plante n&apos;appartient pas à ce jardin. Choisissez
          « Aucune » pour retirer le lien.
        </p>
      )}
    </div>
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
