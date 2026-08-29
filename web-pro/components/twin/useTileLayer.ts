"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeProvider, bestZoom, buildTileUrl,
  lonToTileX, latToTileY, tileXToLon, tileYToLat,
  localToGeographic, geographicToLocal,
  type GeoOrigin,
} from "@/lib/twin/tiles";
import { worldToScreen, screenToWorld, type Camera, type Viewport } from "@/lib/twin/geometry";

/**
 * Charge les tuiles satellite visibles et les garde en cache mémoire.
 *
 * Le rendu lui-même reste dans le canvas de l'éditeur : ce hook ne fait
 * que fournir les images prêtes à dessiner, pour que le fond ne soit
 * jamais l'affaire du moteur de dessin des objets.
 */

/**
 * Une tuile visible, désignée par ses seules coordonnées.
 *
 * L'image n'y figure pas : elle vit dans le cache, dont la clé est
 * justement ce triplet. Séparer les deux permet de DÉDUIRE la liste des
 * tuiles visibles pendant le rendu, sans la stocker dans un état.
 */
export type VisibleTile = {
  key: string;
  x: number;
  y: number;
  z: number;
};

export function useTileLayer(
  enabled: boolean,
  origin: GeoOrigin | null,
  camera: Camera,
  view: Viewport,
) {
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [, forceRender] = useState(0);
  const provider = activeProvider();

  // Quelles tuiles sont visibles ne dépend que de la caméra et de
  // l'emprise : c'est un calcul, pas un état. Le déduire pendant le
  // rendu évite un rendu de plus à chaque déplacement de la carte.
  const tiles = useMemo<VisibleTile[]>(() => {
    if (!enabled || !origin || view.width < 10) return [];

    const z = bestZoom(camera.pixelsPerMeter, origin.latitude, provider.maxZoom);

    // Emprise visible, convertie en latitude/longitude puis en tuiles.
    const corners = [
      screenToWorld({ x: 0, y: 0 }, camera, view),
      screenToWorld({ x: view.width, y: 0 }, camera, view),
      screenToWorld({ x: 0, y: view.height }, camera, view),
      screenToWorld({ x: view.width, y: view.height }, camera, view),
    ].map((p) => localToGeographic(p, origin));

    const lats = corners.map((c) => c.latitude);
    const lons = corners.map((c) => c.longitude);

    const minX = Math.floor(lonToTileX(Math.min(...lons), z));
    const maxX = Math.floor(lonToTileX(Math.max(...lons), z));
    const minY = Math.floor(latToTileY(Math.max(...lats), z));
    const maxY = Math.floor(latToTileY(Math.min(...lats), z));

    // Garde-fou : à un zoom inadapté l'emprise peut couvrir des milliers
    // de tuiles. Mieux vaut ne rien afficher qu'inonder le fournisseur.
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count > 120) return [];

    const next: VisibleTile[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        next.push({ key: `${z}/${x}/${y}`, x, y, z });
      }
    }
    return next;
  }, [enabled, origin, camera, view, provider]);

  // Le téléchargement, lui, est bien une synchronisation avec
  // l'extérieur : on lance les requêtes manquantes, et c'est l'arrivée
  // de l'image qui redemande un rendu.
  useEffect(() => {
    for (const tile of tiles) {
      if (cache.current.has(tile.key)) continue;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = buildTileUrl(provider, tile.x, tile.y, tile.z);
      image.onload = () => forceRender((n) => n + 1);
      // Une tuile manquante (bord de couverture) ne doit pas
      // réessayer en boucle : on la garde en cache, vide.
      image.onerror = () => {};
      cache.current.set(tile.key, image);
    }
  }, [tiles, provider]);

  /** Dessine le fond. Appelé par le canvas avant tout le reste. */
  function draw(ctx: CanvasRenderingContext2D) {
    if (!origin) return;
    for (const tile of tiles) {
      // Absente du cache : le rendu précède le premier passage de
      // l'effet de chargement. La tuile arrivera au rendu suivant.
      const image = cache.current.get(tile.key);
      if (!image || !image.complete || image.naturalWidth === 0) continue;

      // Coins de la tuile en géographique, puis en mètres locaux, puis
      // à l'écran. La tuile n'est pas rigoureusement un rectangle dans
      // le repère local (projection Mercator), mais à l'échelle d'un
      // jardin l'écart est très inférieur au pixel.
      const nw = geographicToLocal(
        { latitude: tileYToLat(tile.y, tile.z), longitude: tileXToLon(tile.x, tile.z) },
        origin,
      );
      const se = geographicToLocal(
        { latitude: tileYToLat(tile.y + 1, tile.z), longitude: tileXToLon(tile.x + 1, tile.z) },
        origin,
      );
      const a = worldToScreen(nw, camera, view);
      const b = worldToScreen(se, camera, view);

      // +1 px : sans cela un liseré du fond apparaît entre les tuiles
      // dès que les bords tombent sur des demi-pixels.
      ctx.drawImage(image, a.x, a.y, b.x - a.x + 1, b.y - a.y + 1);
    }
  }

  return { draw, attribution: provider.attribution, providerLabel: provider.label, tileCount: tiles.length };
}
