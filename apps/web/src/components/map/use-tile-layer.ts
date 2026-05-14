'use client';
/**
 * useTileLayer — manage a single L.tileLayer on a vanilla Leaflet map.
 *
 * The parent owns the L.Map instance (via mapRef) and calls setStyle to swap
 * tile sources. We add the new layer first, then remove the old one within
 * the same microtask so there's no flicker of grey between tilesets.
 */

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';

export interface UseTileLayerOptions {
  /** Initial tile URL template. */
  initialUrl?: string;
  /** Initial attribution HTML. */
  initialAttribution?: string;
  /** Max zoom for the tile layer (default 19). */
  maxZoom?: number;
}

export interface UseTileLayerResult {
  /** Swap the active tile layer without a visible flicker. */
  setStyle: (url: string, attribution: string) => void;
  /** Ref to the currently-active tile layer (or null). */
  layerRef: React.RefObject<L.TileLayer | null>;
}

export function useTileLayer(
  mapRef: React.RefObject<L.Map | null>,
  opts: UseTileLayerOptions = {}
): UseTileLayerResult {
  const { initialUrl, initialAttribution, maxZoom = 19 } = opts;
  const layerRef = useRef<L.TileLayer | null>(null);

  // Add the initial layer once the map is mounted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || layerRef.current || !initialUrl) return;
    const layer = L.tileLayer(initialUrl, {
      attribution: initialAttribution,
      maxZoom
    }).addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      if (layerRef.current === layer) layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef]);

  const setStyle = useCallback(
    (url: string, attribution: string) => {
      const map = mapRef.current;
      if (!map) return;
      const old = layerRef.current;
      // Add new first so tiles can begin loading; remove old in the same tick
      // so the user never sees the grey background.
      const next = L.tileLayer(url, { attribution, maxZoom }).addTo(map);
      layerRef.current = next;
      if (old) old.remove();
    },
    [mapRef, maxZoom]
  );

  return { setStyle, layerRef };
}
