'use client';
/**
 * Branch location picker — vanilla Leaflet (the project intentionally avoids
 * react-leaflet so we own the lifecycle directly).
 *
 *  - Draggable saffron 🏠 pin, matching the rider-fleet branch-pin styling.
 *  - Nominatim search box (proxied via /api/admin/addresses/search) on top-left.
 *  - "Use my current location" button → geolocation API → flies the pin.
 *  - Click the map OR drag the pin → reverse-geocode + fire onChange.
 *  - Lat/lng chip overlay at bottom-right.
 *
 * `onChange` fires on EVERY change: drag-end, search-pick, geolocate, map click.
 * Parents who need address fields should read `line1/city/state/postalCode`
 * from the payload (only populated when reverse-geocoding succeeds).
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, LocateFixed, Search } from 'lucide-react';

export interface BranchLocationChange {
  lat: number;
  lng: number;
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

interface Props {
  initial?: { lat: number; lng: number; address?: string };
  onChange: (v: BranchLocationChange) => void;
  height?: string;
}

interface SearchHit { lat: number; lng: number; displayName: string }

// Saffron 🏠 branch pin (matches the rider map's branch-pin treatment).
const branchIcon = L.divIcon({
  html: `
    <div style="display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#f97316;color:white;font-size:18px;box-shadow:0 6px 14px rgba(249,115,22,.45);border:2px solid white;cursor:grab">🏠</div>
  `,
  className: '',
  iconSize: [38, 38],
  iconAnchor: [19, 19]
});

const DEFAULT_CENTER = { lat: 12.97, lng: 77.64 }; // Bangalore

export function BranchLocationPicker({ initial, onChange, height = '360px' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial && Number.isFinite(initial.lat) && Number.isFinite(initial.lng)
      ? { lat: initial.lat, lng: initial.lng }
      : null
  );
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);

  // ------------------- Map init -------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = coords ?? DEFAULT_CENTER;
    const map = L.map(containerRef.current, {
      center: [start.lat, start.lng],
      zoom: coords ? 16 : 12,
      scrollWheelZoom: true
    });
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map);

    const m = L.marker([start.lat, start.lng], { icon: branchIcon, draggable: true }).addTo(map);
    markerRef.current = m;
    if (!coords) m.setOpacity(0.6); // ghosted until the user actually picks a spot

    m.on('dragend', () => {
      const ll = m.getLatLng();
      m.setOpacity(1);
      handleMove(ll.lat, ll.lng, true);
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      m.setLatLng(e.latlng);
      m.setOpacity(1);
      handleMove(e.latlng.lat, e.latlng.lng, true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin in sync if `initial` later becomes available (rare, e.g. parent
  // hydrates async). Only run when we still don't have coords locally.
  useEffect(() => {
    if (!initial || coords) return;
    if (!Number.isFinite(initial.lat) || !Number.isFinite(initial.lng)) return;
    flyTo(initial.lat, initial.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.lat, initial?.lng]);

  function flyTo(lat: number, lng: number, zoom = 16) {
    const map = mapRef.current;
    const m = markerRef.current;
    if (!map || !m) return;
    m.setLatLng([lat, lng]);
    m.setOpacity(1);
    map.flyTo([lat, lng], zoom, { duration: 0.6 });
  }

  // ------------------- onChange path -------------------
  async function handleMove(lat: number, lng: number, doReverse: boolean) {
    setCoords({ lat, lng });
    if (!doReverse) {
      onChangeRef.current({ lat, lng });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/addresses/reverse?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const j = (await res.json()) as { line1?: string; city?: string; state?: string; postalCode?: string };
        onChangeRef.current({ lat, lng, line1: j.line1, city: j.city, state: j.state, postalCode: j.postalCode });
      } else {
        onChangeRef.current({ lat, lng });
      }
    } catch {
      onChangeRef.current({ lat, lng });
    } finally {
      setBusy(false);
    }
  }

  // ------------------- Search -------------------
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      searchAbort.current?.abort();
      const ctrl = new AbortController();
      searchAbort.current = ctrl;
      try {
        const r = await fetch(`/api/admin/addresses/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!r.ok) return;
        setHits((await r.json()) as SearchHit[]);
        setShowHits(true);
      } catch { /* aborted */ }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  function pickHit(h: SearchHit) {
    setShowHits(false);
    setQ(h.displayName);
    flyTo(h.lat, h.lng);
    handleMove(h.lat, h.lng, true);
  }

  // ------------------- Geolocation -------------------
  function useMyLocation() {
    if (!('geolocation' in navigator)) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        flyTo(latitude, longitude, 17);
        handleMove(latitude, longitude, true);
      },
      () => setBusy(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Search box + geolocate button — top-left */}
      <div className="absolute top-3 left-3 z-[400] w-[min(360px,calc(100%-24px))] glass rounded-lg p-2 shadow-md">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => hits.length && setShowHits(true)}
              onBlur={() => setTimeout(() => setShowHits(false), 150)}
              placeholder="Search a place or address…"
              className="h-9 pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={useMyLocation}
            className="tap-press h-9 shrink-0"
            title="Use my current location"
          >
            <LocateFixed className="size-4" />
            <span className="hidden sm:inline">My location</span>
          </Button>
        </div>
        {showHits && hits.length > 0 && (
          <ul className="mt-2 max-h-56 overflow-auto rounded-md border bg-card text-sm shadow-sm">
            {hits.map((h, i) => (
              <li key={`${h.lat}-${h.lng}-${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pickHit(h); }}
                  className="card-lift block w-full px-2.5 py-1.5 text-left hover:bg-muted/60"
                >
                  {h.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Coords chip — bottom-right */}
      <div className="absolute bottom-3 right-3 z-[400] inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-3 py-1 text-[11px] font-medium shadow">
        {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        {coords
          ? <span>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</span>
          : <span className="text-muted-foreground">Click on the map to drop a pin</span>}
      </div>
    </div>
  );
}
