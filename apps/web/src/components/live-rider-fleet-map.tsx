'use client';
/**
 * Live rider fleet map — listens to a rider-position SSE channel and renders
 * every active rider as a moving 🛵 pin with their name label.
 *
 *   channel="platform:riders"             →  super-admin firehose
 *   channel={`branch:${branchId}:riders`} →  restaurant ops view
 *
 * Rider rows are kept in a Map<riderId, { lat, lng, at }>. Stale entries
 * (> 60s old) auto-fade out so the view doesn't show riders who've gone
 * offline.
 *
 * Interactive surface:
 *   - clicking a pin opens a 360px <RiderPanel/> over the map
 *   - branch + customer + trail layers can be toggled on/off
 *   - status filter (idle / on-delivery / awaiting-pickup) hides pins
 *   - flyTo() keeps the selected rider centered as their pin moves
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSSE } from '@/hooks/use-sse';
import { RiderPanel } from '@/components/live-tracking/rider-panel';

export interface RiderPosition {
  riderId: string;
  lat: number;
  lng: number;
  speedKph?: number;
  orderId?: string;
  at: string;
  name?: string;
  /** workflow-status — derived server-side from RiderAssignment.status */
  status?: 'IDLE' | 'PENDING' | 'ACCEPTED' | 'PICKED_UP';
}

export interface BranchPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CustomerPin {
  id: string;
  name?: string;
  lat: number;
  lng: number;
}

export type StatusFilter = 'ALL' | 'IDLE' | 'ON_DELIVERY' | 'AWAITING_PICKUP';

export interface VisibleLayers {
  branches: boolean;
  customers: boolean;
  trails: boolean;
}

interface Props {
  channel: string;
  /** initial set of rider positions to seed the map before SSE catches up */
  initial?: RiderPosition[];
  /** Optional map center; default to the average of initial positions or Bangalore. */
  center?: { lat: number; lng: number };
  /** Map height in px or any CSS length. */
  height?: string;
  /** Branches to overlay when `visibleLayers.branches` is true. */
  branches?: BranchPin[];
  /** Customer drop points (typically the destination of in-flight orders). */
  customers?: CustomerPin[];
  /** Status filter; pins outside the active set are hidden. */
  statusFilter?: StatusFilter;
  /** Visible-layer toggles. Default: { branches: true, customers: false, trails: false }. */
  visibleLayers?: VisibleLayers;
  /** Whether the user has super-admin powers (drives the panel's CTAs). */
  isSuperAdmin?: boolean;
  /** Fires whenever the live position map mutates. */
  onPositionsChange?: (positions: RiderPosition[]) => void;
}

function riderIcon(name?: string, selected = false) {
  const label = (name ?? '').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '🛵';
  const ring = selected ? 'box-shadow:0 0 0 4px #fbbf24,0 4px 10px rgba(22,163,74,.45)' : 'box-shadow:0 4px 10px rgba(22,163,74,.45)';
  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer">
        <div style="font-size:14px;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#16a34a;color:white;font-weight:700;${ring};border:2px solid white">${label}</div>
        ${name ? `<div style="background:rgba(255,255,255,0.95);border-radius:6px;padding:1px 6px;font-size:10px;font-weight:600;color:#1f2937;box-shadow:0 1px 3px rgba(0,0,0,.15);white-space:nowrap">${name}</div>` : ''}
      </div>
    `,
    className: '',
    iconSize: [60, 50],
    iconAnchor: [30, 17]
  });
}

function branchIcon() {
  return L.divIcon({
    html: `<div style="font-size:18px;background:#fff;border:2px solid #ea580c;border-radius:50%;width:30px;height:30px;display:grid;place-items:center;box-shadow:0 2px 6px rgba(234,88,12,.4)">🍽️</div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function customerIcon() {
  return L.divIcon({
    html: `<div style="font-size:16px;background:#fff;border:2px solid #2563eb;border-radius:50%;width:26px;height:26px;display:grid;place-items:center;box-shadow:0 2px 5px rgba(37,99,235,.35)">🏠</div>`,
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function animateMarker(marker: L.Marker, target: { lat: number; lng: number }, ms = 600) {
  const start = marker.getLatLng();
  const t0 = performance.now();
  const lat0 = start.lat, lng0 = start.lng;
  const dlat = target.lat - lat0, dlng = target.lng - lng0;
  if (Math.abs(dlat) < 1e-7 && Math.abs(dlng) < 1e-7) return;
  function step(now: number) {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    marker.setLatLng([lat0 + dlat * e, lng0 + dlng * e]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function matchesStatus(pos: RiderPosition, filter: StatusFilter): boolean {
  if (filter === 'ALL') return true;
  const s = pos.status ?? 'IDLE';
  if (filter === 'IDLE') return s === 'IDLE';
  if (filter === 'ON_DELIVERY') return s === 'PICKED_UP' || s === 'ACCEPTED';
  if (filter === 'AWAITING_PICKUP') return s === 'PENDING';
  return true;
}

export function LiveRiderFleetMap({
  channel,
  initial = [],
  center,
  height = '420px',
  branches = [],
  customers = [],
  statusFilter = 'ALL',
  visibleLayers = { branches: true, customers: false, trails: false },
  isSuperAdmin = false,
  onPositionsChange
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const branchMarkers = useRef<L.Marker[]>([]);
  const customerMarkers = useRef<L.Marker[]>([]);
  const positions = useRef<Map<string, RiderPosition>>(new Map(initial.map((r) => [r.riderId, r])));
  const [count, setCount] = useState(initial.length);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(initial.length ? Date.now() : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trailPings, setTrailPings] = useState<{ lat: number; lng: number; at: string }[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const seedCenter = center
      ?? (initial[0] ? { lat: initial[0].lat, lng: initial[0].lng } : { lat: 12.97, lng: 77.64 });
    const map = L.map(containerRef.current, {
      center: [seedCenter.lat, seedCenter.lng],
      zoom: 12,
      scrollWheelZoom: true
    });
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map);

    // Seed initial markers
    for (const p of initial) {
      if (!matchesStatus(p, statusFilter)) continue;
      const m = L.marker([p.lat, p.lng], { icon: riderIcon(p.name) }).addTo(map);
      m.on('click', () => setSelectedId(p.riderId));
      markers.current.set(p.riderId, m);
    }
    if (initial.length >= 2) {
      const bounds = L.latLngBounds(initial.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markers.current.clear();
      positions.current.clear();
      branchMarkers.current = [];
      customerMarkers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Branches layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    branchMarkers.current.forEach((m) => m.remove());
    branchMarkers.current = [];
    if (!visibleLayers.branches) return;
    for (const b of branches) {
      if (typeof b.lat !== 'number' || typeof b.lng !== 'number') continue;
      const m = L.marker([b.lat, b.lng], { icon: branchIcon() })
        .bindTooltip(b.name, { direction: 'top', offset: [0, -10] })
        .addTo(map);
      branchMarkers.current.push(m);
    }
  }, [branches, visibleLayers.branches]);

  // Customers layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    customerMarkers.current.forEach((m) => m.remove());
    customerMarkers.current = [];
    if (!visibleLayers.customers) return;
    for (const c of customers) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      const m = L.marker([c.lat, c.lng], { icon: customerIcon() })
        .bindTooltip(c.name ?? 'Customer', { direction: 'top', offset: [0, -8] })
        .addTo(map);
      customerMarkers.current.push(m);
    }
  }, [customers, visibleLayers.customers]);

  // Re-apply status filter (show/hide markers) when filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, p] of positions.current) {
      const m = markers.current.get(id);
      if (!m) continue;
      const show = matchesStatus(p, statusFilter);
      if (show && !map.hasLayer(m)) m.addTo(map);
      if (!show && map.hasLayer(m)) m.remove();
    }
  }, [statusFilter]);

  // Auto-pan when a rider is selected (or moves while selected)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const p = positions.current.get(selectedId);
    if (!p) return;
    map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { animate: true, duration: 0.6 });
  }, [selectedId]);

  // Refresh "selected" marker styling
  useEffect(() => {
    for (const [id, m] of markers.current) {
      const pos = positions.current.get(id);
      m.setIcon(riderIcon(pos?.name, id === selectedId));
    }
  }, [selectedId]);

  // Stale-rider sweep — fade out anyone we haven't heard from in 60s
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, p] of positions.current) {
        if (now - new Date(p.at).getTime() > 60_000) {
          markers.current.get(id)?.remove();
          markers.current.delete(id);
          positions.current.delete(id);
          if (id === selectedId) setSelectedId(null);
          changed = true;
        }
      }
      if (changed) {
        setCount(positions.current.size);
        onPositionsChange?.(Array.from(positions.current.values()));
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [selectedId, onPositionsChange]);

  useSSE(channel, {
    onMessage: (e: any) => {
      if (e?.kind !== 'rider:position') return;
      const map = mapRef.current;
      if (!map) return;
      const prev = positions.current.get(e.riderId);
      const next: RiderPosition = {
        riderId: e.riderId,
        lat: e.lat,
        lng: e.lng,
        speedKph: e.speedKph,
        orderId: e.orderId,
        at: e.at,
        name: e.name ?? prev?.name,
        status: e.status ?? prev?.status
      };
      positions.current.set(next.riderId, { ...prev, ...next });
      let m = markers.current.get(next.riderId);
      const show = matchesStatus(next, statusFilter);
      if (m) {
        animateMarker(m, { lat: next.lat, lng: next.lng });
        if (!show && map.hasLayer(m)) m.remove();
        if (show && !map.hasLayer(m)) m.addTo(map);
      } else if (show) {
        m = L.marker([next.lat, next.lng], { icon: riderIcon(next.name, next.riderId === selectedId) }).addTo(map);
        m.on('click', () => setSelectedId(next.riderId));
        markers.current.set(next.riderId, m);
      }
      // Pan with the rider if they're the one we're watching
      if (next.riderId === selectedId) {
        map.panTo([next.lat, next.lng], { animate: true, duration: 0.4 });
      }
      setCount(positions.current.size);
      setLastUpdateAt(Date.now());
      onPositionsChange?.(Array.from(positions.current.values()));
    }
  });

  const selectedPos = selectedId ? positions.current.get(selectedId) : null;

  // Toggling the trail switch lives in the panel header; expose a handler.
  const [panelTrailOn, setPanelTrailOn] = useState(visibleLayers.trails);
  useEffect(() => { setPanelTrailOn(visibleLayers.trails); }, [visibleLayers.trails]);

  return (
    <div className="relative overflow-hidden rounded-xl border" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/95 backdrop-blur px-3 py-1 text-xs font-medium shadow">
          <span className="relative inline-flex">
            <span className="size-2 rounded-full bg-success" />
            <span className="absolute inset-0 size-2 rounded-full bg-success pulse-soft" />
          </span>
          {count} {count === 1 ? 'rider' : 'riders'} live
        </div>
        {lastUpdateAt && (
          <div className="rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] text-muted-foreground shadow">
            Updated <UpdatedAgo at={lastUpdateAt} />
          </div>
        )}
      </div>
      {count === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-card/60 backdrop-blur-sm pointer-events-none">
          <div className="text-center">
            <div className="text-sm font-medium text-muted-foreground">Waiting for riders to go online…</div>
            <div className="text-xs text-muted-foreground mt-1">Pins appear in real-time as the app reports GPS.</div>
          </div>
        </div>
      )}

      {selectedPos && (
        <RiderPanel
          rider={{ riderId: selectedPos.riderId, name: selectedPos.name ?? 'Rider', lat: selectedPos.lat, lng: selectedPos.lng }}
          isSuperAdmin={isSuperAdmin}
          trailVisible={panelTrailOn}
          onToggleTrail={(next) => setPanelTrailOn(next)}
          onClose={() => { setSelectedId(null); setTrailPings([]); }}
          onPings={(pings) => setTrailPings(pings)}
        />
      )}

      {/* When the user toggles trail from the panel, swap visibility. Note: the
          panel only flips its local switch; we also have to drive `visibleLayers.trails`
          for the polyline render effect. We piggyback on panelTrailOn to gate. */}
      <TrailGate
        active={panelTrailOn && Boolean(selectedId) && trailPings.length >= 2}
        map={mapRef}
        pings={trailPings}
      />
    </div>
  );
}

function UpdatedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return <>{s < 2 ? 'just now' : `${s}s ago`}</>;
}

/**
 * Pure-effect helper: draws a saffron polyline of the latest pings when
 * `active`, removes it otherwise. Kept as a child component so the parent's
 * `visibleLayers.trails` prop can compose with the panel's own toggle.
 */
function TrailGate({ active, map, pings }: { active: boolean; map: React.MutableRefObject<L.Map | null>; pings: { lat: number; lng: number }[] }) {
  const layer = useRef<L.Polyline | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layer.current) { layer.current.remove(); layer.current = null; }
    if (!active || pings.length < 2) return;
    layer.current = L.polyline(pings.map((p) => [p.lat, p.lng] as [number, number]), {
      color: '#ea580c',
      weight: 4,
      opacity: 0.85,
      dashArray: '6 8',
      lineCap: 'round'
    }).addTo(m);
    return () => { layer.current?.remove(); layer.current = null; };
  }, [active, pings, map]);
  return null;
}
