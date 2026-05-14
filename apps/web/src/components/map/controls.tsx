'use client';
/**
 * MapControls — floating control cluster (top-right) for a vanilla Leaflet map.
 *
 * The parent owns the L.Map instance and passes it in via a ref. We render
 * absolute-positioned pill buttons over the map container; the parent's map
 * <div> must be `position: relative` for these to land correctly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type L from 'leaflet';
import { Plus, Minus, LocateFixed, Maximize2, Layers } from 'lucide-react';

export interface MapLayerToggle {
  id: string;
  label: string;
  visible: boolean;
  onToggle: (next: boolean) => void;
}

export interface MapControlsProps {
  mapRef: React.RefObject<L.Map | null>;
  /** Optional bounds for the "fit bounds" button. */
  bounds?: L.LatLngBoundsExpression;
  /** Optional layer toggles, rendered inside the Layers popover. */
  layers?: MapLayerToggle[];
  /** Override the recenter zoom level (default 15). */
  recenterZoom?: number;
}

function PillButton({
  onClick,
  title,
  children
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-9 w-9 place-items-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/5 transition hover:bg-gray-50 active:scale-95"
    >
      {children}
    </button>
  );
}

export function MapControls({ mapRef, bounds, layers, recenterZoom = 15 }: MapControlsProps) {
  const [layersOpen, setLayersOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const zoomIn = useCallback(() => mapRef.current?.zoomIn(), [mapRef]);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut(), [mapRef]);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo([pos.coords.latitude, pos.coords.longitude], recenterZoom, { duration: 0.8 });
      },
      () => {
        /* user denied / unavailable — no-op */
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
    );
  }, [mapRef, recenterZoom]);

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [mapRef, bounds]);

  const toggleFullscreen = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (!document.fullscreenElement) {
      void container.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  }, [mapRef]);

  // Track fullscreen state + force Leaflet to recompute its size on transitions.
  useEffect(() => {
    function onChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
      // Leaflet caches the container size; invalidateSize repaints tiles.
      requestAnimationFrame(() => mapRef.current?.invalidateSize());
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [mapRef]);

  // Close the layers popover on outside click.
  useEffect(() => {
    if (!layersOpen) return;
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setLayersOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [layersOpen]);

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[400] flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex flex-col gap-1.5">
        <PillButton onClick={zoomIn} title="Zoom in">
          <Plus className="size-4" />
        </PillButton>
        <PillButton onClick={zoomOut} title="Zoom out">
          <Minus className="size-4" />
        </PillButton>
        <PillButton onClick={recenter} title="Recenter on me">
          <LocateFixed className="size-4" />
        </PillButton>
        {bounds && (
          <PillButton onClick={fitBounds} title="Fit bounds">
            <span className="text-[10px] font-bold leading-none">FIT</span>
          </PillButton>
        )}
        <PillButton onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <Maximize2 className="size-4" />
        </PillButton>
        {layers && layers.length > 0 && (
          <div className="relative" ref={popoverRef}>
            <PillButton onClick={() => setLayersOpen((v) => !v)} title="Layers">
              <Layers className="size-4" />
            </PillButton>
            {layersOpen && (
              <div className="absolute right-11 top-0 min-w-[160px] rounded-lg bg-white p-2 shadow-lg ring-1 ring-black/5">
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Layers
                </div>
                {layers.map((layer) => (
                  <label
                    key={layer.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(e) => layer.onToggle(e.target.checked)}
                      className="size-3.5 accent-emerald-600"
                    />
                    <span className="text-gray-700">{layer.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
