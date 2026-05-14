'use client';
/**
 * StyleToggle — bottom-right floating tile-style picker (Map / Bright / Satellite).
 * Persists the user's choice to localStorage under `map:style` and calls
 * onChange(url, attribution) so the parent's useTileLayer can swap tiles.
 */

import { useEffect, useState } from 'react';

export type MapStyleId = 'osm' | 'bright' | 'satellite';

export interface MapStyleSpec {
  id: MapStyleId;
  label: string;
  url: string;
  attribution: string;
  /** A tiny static preview tile from the same source (zoom 2, tile 1/1). */
  preview: string;
}

export const MAP_STYLES: MapStyleSpec[] = [
  {
    id: 'osm',
    label: 'Map',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    preview: 'https://a.tile.openstreetmap.org/3/5/3.png'
  },
  {
    id: 'bright',
    label: 'Bright',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    preview: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/3/5/3.png'
  },
  {
    id: 'satellite',
    label: 'Satellite',
    // NB: Esri uses {z}/{y}/{x} ordering (y before x) — not the OSM convention.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; World Imagery',
    preview: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/3/5'
  }
];

const STORAGE_KEY = 'map:style';

export function getStoredMapStyle(): MapStyleSpec {
  if (typeof window === 'undefined') return MAP_STYLES[0];
  const id = window.localStorage.getItem(STORAGE_KEY) as MapStyleId | null;
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
}

export interface StyleToggleProps {
  /** Called when the user picks a new style. */
  onChange: (url: string, attribution: string) => void;
  /** Optionally control the initially-selected style (otherwise restored from localStorage). */
  initial?: MapStyleId;
}

export function StyleToggle({ onChange, initial }: StyleToggleProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MapStyleId>(() => {
    if (initial) return initial;
    if (typeof window === 'undefined') return 'osm';
    const stored = window.localStorage.getItem(STORAGE_KEY) as MapStyleId | null;
    return stored && MAP_STYLES.some((s) => s.id === stored) ? stored : 'osm';
  });

  // Notify the parent of the persisted style on mount, so the initial tile
  // layer matches what's stored without the parent needing to read localStorage.
  useEffect(() => {
    const spec = MAP_STYLES.find((s) => s.id === selected) ?? MAP_STYLES[0];
    onChange(spec.url, spec.attribution);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(id: MapStyleId) {
    const spec = MAP_STYLES.find((s) => s.id === id);
    if (!spec) return;
    setSelected(id);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
    onChange(spec.url, spec.attribution);
    setOpen(false);
  }

  const current = MAP_STYLES.find((s) => s.id === selected) ?? MAP_STYLES[0];

  return (
    <div className="absolute bottom-3 right-3 z-[400]">
      {open && (
        <div className="mb-2 flex gap-2 rounded-xl bg-white p-2 shadow-lg ring-1 ring-black/5">
          {MAP_STYLES.map((s) => {
            const active = s.id === selected;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s.id)}
                className={`group flex flex-col items-center gap-1 rounded-lg p-1.5 transition ${
                  active ? 'bg-emerald-50 ring-2 ring-emerald-500' : 'hover:bg-gray-50'
                }`}
                title={s.label}
              >
                <span
                  className="block size-12 rounded-md bg-gray-100 bg-cover bg-center ring-1 ring-black/5"
                  style={{ backgroundImage: `url(${s.preview})` }}
                />
                <span className="text-[10px] font-semibold text-gray-700">{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-md ring-1 ring-black/5 transition hover:bg-gray-50"
      >
        <span
          className="block size-5 rounded bg-cover bg-center ring-1 ring-black/10"
          style={{ backgroundImage: `url(${current.preview})` }}
        />
        {current.label}
      </button>
    </div>
  );
}
