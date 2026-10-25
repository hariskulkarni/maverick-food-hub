'use client';
/**
 * Live rider fleet map — listens to a rider-position SSE channel and renders
 * every active rider as a moving 🛵 pin with their name label.
 *
 *   channel="platform:riders"             →  super-admin firehose
 *   channel={`branch:${branchId}:riders`} →  restaurant ops view
 *
 * Rider rows are kept in a Map<riderId, FleetRider>. Every row carries the
 * real GPS-fix time (`at`) and the last time the app was heard from
 * (`seenAt`); riders silent for longer than the auto-offline window are drawn
 * grey ("signal lost") instead of looking live. With `pollUrl` the poll is the
 * authority on who is on the map and what leg they are on; SSE only moves
 * known pins forward in time.
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
import { isStale, mergePolled, mergeSse, type FleetRider } from '@/lib/live-fleet';

/** A rider pin. Workflow status / leg are derived server-side (lib/live-fleet.ts). */
export type RiderPosition = FleetRider;

/** Without a poll (restaurant view) a rider silent this long leaves the map. */
const NO_POLL_DROP_MS = 10 * 60 * 1000;

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

export type StatusFilter = 'ALL' | 'IDLE' | 'ON_DELIVERY' | 'AWAITING_PICKUP' | 'SIGNAL_LOST';

export interface VisibleLayers {
  branches: boolean;
  customers: boolean;
  trails: boolean;
}

interface Props {
  channel: string;
  /** initial set of rider positions to seed the map before SSE catches up */
  initial?: RiderPosition[];
  /** Optional map center; default to the average of initial positions or Guntur. */
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
  /** Optional REST endpoint returning `{ riders: [...] }`. When set, the map
   *  polls it (~4s) as a reliable backstop to the SSE stream so every online
   *  rider stays plotted with their freshest stored position even if an SSE
   *  frame never arrives. */
  pollUrl?: string;
  /** Fires whenever the live position map mutates. */
  onPositionsChange?: (positions: RiderPosition[]) => void;
  /** Fires with the drop pins from each poll (orders the fleet is working). */
  onCustomersChange?: (customers: CustomerPin[]) => void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function riderIcon(name?: string, selected = false, stale = false) {
  const label = escapeHtml((name ?? '').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '🛵');
  const bg = stale ? '#9ca3af' : '#16a34a';
  const glow = stale ? 'rgba(107,114,128,.35)' : 'rgba(22,163,74,.45)';
  const ring = selected ? `box-shadow:0 0 0 4px #fbbf24,0 4px 10px ${glow}` : `box-shadow:0 4px 10px ${glow}`;
  const caption = name ? escapeHtml(name) + (stale ? ' · signal lost' : '') : stale ? 'signal lost' : '';
  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;${stale ? 'opacity:.75' : ''}">
        <div style="font-size:14px;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:${bg};color:white;font-weight:700;${ring};border:2px solid white">${label}</div>
        ${caption ? `<div style="background:rgba(255,255,255,0.95);border-radius:6px;padding:1px 6px;font-size:10px;font-weight:600;color:#1f2937;box-shadow:0 1px 3px rgba(0,0,0,.15);white-space:nowrap">${caption}</div>` : ''}
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

export function matchesStatus(pos: RiderPosition, filter: StatusFilter): boolean {
  if (filter === 'ALL') return true;
  const s = pos.status ?? 'IDLE';
  if (filter === 'IDLE') return s === 'IDLE';
  // "On delivery" = has the food; "Awaiting pickup" = heading to the restaurant
  // (accepted) or an offer still waiting for the rider to accept.
  if (filter === 'ON_DELIVERY') return s === 'PICKED_UP';
  if (filter === 'AWAITING_PICKUP') return s === 'ACCEPTED' || s === 'PENDING';
  if (filter === 'SIGNAL_LOST') return Boolean(pos.stale);
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
  pollUrl,
  onPositionsChange,
  onCustomersChange
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
  // Poll backstop state: surfaces a quiet banner if the REST endpoint fails,
  // and tracks whether the very first poll has resolved (so the empty-state
  // copy doesn't flash before we know the fleet is genuinely empty).
  const [pollError, setPollError] = useState(false);
  const [polledOnce, setPolledOnce] = useState(false);
  // Keep the latest selectedId reachable from the polling closure without
  // re-subscribing the interval every time the selection changes.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const seedCenter = center
      ?? (initial[0] ? { lat: initial[0].lat, lng: initial[0].lng } : { lat: 16.3067, lng: 80.4365 });
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
      const m = L.marker([p.lat, p.lng], { icon: riderIcon(p.name, false, p.stale) }).addTo(map);
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
      m.setIcon(riderIcon(pos?.name, id === selectedId, pos?.stale));
    }
  }, [selectedId]);

  // Signal sweep (every 5 s): a rider whose app has been silent longer than
  // the auto-offline window turns grey ("signal lost") instead of looking
  // live. Without a poll (restaurant view) nobody else prunes, so riders silent
  // for NO_POLL_DROP_MS leave the map; with a poll, membership is the poll's job.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const map = mapRef.current;
      let changed = false;
      for (const [id, p] of Array.from(positions.current)) {
        const seen = p.seenAt ?? p.at;
        if (!pollUrl && now - new Date(seen).getTime() > NO_POLL_DROP_MS) {
          markers.current.get(id)?.remove();
          markers.current.delete(id);
          positions.current.delete(id);
          if (id === selectedIdRef.current) setSelectedId(null);
          changed = true;
          continue;
        }
        const stale = isStale(seen, now);
        if (stale !== Boolean(p.stale)) {
          const next = { ...p, stale };
          positions.current.set(id, next);
          const m = markers.current.get(id);
          if (m) {
            m.setIcon(riderIcon(next.name, id === selectedIdRef.current, stale));
            const show = matchesStatus(next, statusFilter);
            if (map && show && !map.hasLayer(m)) m.addTo(map);
            if (map && !show && map.hasLayer(m)) m.remove();
          }
          changed = true;
        }
      }
      if (changed) {
        setCount(positions.current.size);
        onPositionsChange?.(Array.from(positions.current.values()));
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [onPositionsChange, pollUrl, statusFilter]);

  useSSE(channel, {
    onMessage: (e: any) => {
      if (e?.kind !== 'rider:position') return;
      const map = mapRef.current;
      if (!map) return;
      const prev = positions.current.get(e.riderId);
      // With a poll, the poll decides who is on the map (it knows who is
      // online and what they are doing); an SSE frame for an unknown rider
      // waits for the next poll instead of creating a status-less ghost pin.
      if (!prev && pollUrl) return;
      const next = mergeSse(prev, e);
      if (!next) return; // out-of-order frame: never rewind a pin
      positions.current.set(next.riderId, next);
      let m = markers.current.get(next.riderId);
      const show = matchesStatus(next, statusFilter);
      if (m) {
        animateMarker(m, { lat: next.lat, lng: next.lng });
        if (prev?.stale) m.setIcon(riderIcon(next.name, next.riderId === selectedId, false));
        if (!show && map.hasLayer(m)) m.remove();
        if (show && !map.hasLayer(m)) m.addTo(map);
      } else if (show) {
        m = L.marker([next.lat, next.lng], { icon: riderIcon(next.name, next.riderId === selectedId, next.stale) }).addTo(map);
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

  // REST poll backstop — every ~4s, pull the authoritative list of online
  // riders + their stored positions and reconcile the map. This guarantees a
  // rider stays plotted even if their SSE frames are dropped, and prunes pins
  // for riders who have gone offline. SSE still drives sub-second motion; the
  // poll just keeps the picture honest.
  useEffect(() => {
    if (!pollUrl) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(pollUrl!, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const map = mapRef.current;
        if (!map) return;
        const rows: RiderPosition[] = Array.isArray(data?.riders) ? data.riders : [];
        if (Array.isArray(data?.customers)) onCustomersChange?.(data.customers);
        const seen = new Set<string>();
        let changed = false;

        for (const row of rows) {
          if (typeof row?.lat !== 'number' || typeof row?.lng !== 'number' || !row.riderId) continue;
          seen.add(row.riderId);
          const prev = positions.current.get(row.riderId);
          // Status / leg / signal come from the poll (authoritative); the
          // position never rewinds behind a newer SSE fix.
          const next = mergePolled(prev, row);
          const moved = !prev || prev.lat !== next.lat || prev.lng !== next.lng;
          const restyled = !prev || prev.stale !== next.stale || prev.name !== next.name;
          const sameState = prev && !moved && !restyled && prev.status === next.status
            && prev.orderId === next.orderId && prev.activeOrders === next.activeOrders
            && prev.at === next.at && prev.seenAt === next.seenAt
            && prev.dest?.lat === next.dest?.lat && prev.dest?.lng === next.dest?.lng;
          if (sameState) continue;
          positions.current.set(row.riderId, next);
          let m = markers.current.get(row.riderId);
          const show = matchesStatus(next, statusFilter);
          if (m) {
            if (moved) animateMarker(m, { lat: next.lat, lng: next.lng });
            if (restyled) m.setIcon(riderIcon(next.name, row.riderId === selectedIdRef.current, next.stale));
            if (!show && map.hasLayer(m)) m.remove();
            if (show && !map.hasLayer(m)) m.addTo(map);
          } else if (show) {
            m = L.marker([next.lat, next.lng], { icon: riderIcon(next.name, row.riderId === selectedIdRef.current, next.stale) }).addTo(map);
            const id = row.riderId;
            m.on('click', () => setSelectedId(id));
            markers.current.set(row.riderId, m);
          }
          changed = true;
        }

        // Prune riders the endpoint no longer reports as online.
        for (const id of Array.from(positions.current.keys())) {
          if (seen.has(id)) continue;
          markers.current.get(id)?.remove();
          markers.current.delete(id);
          positions.current.delete(id);
          if (id === selectedIdRef.current) setSelectedId(null);
          changed = true;
        }

        setPollError(false);
        setPolledOnce(true);
        if (changed) {
          setCount(positions.current.size);
          setLastUpdateAt(Date.now());
          onPositionsChange?.(Array.from(positions.current.values()));
        }
      } catch {
        if (!cancelled) {
          setPollError(true);
          setPolledOnce(true);
        }
      }
    }

    tick();
    const t = setInterval(tick, 4_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollUrl, statusFilter, onPositionsChange, onCustomersChange]);

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
        <div className="flex items-center gap-2">
          {pollError && (
            <div className="rounded-full bg-warning/95 text-warning-foreground px-2.5 py-1 text-[11px] font-medium shadow">
              Reconnecting…
            </div>
          )}
          {lastUpdateAt && (
            <div className="rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] text-muted-foreground shadow">
              Updated <UpdatedAgo at={lastUpdateAt} />
            </div>
          )}
        </div>
      </div>
      {count === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-card/60 backdrop-blur-sm pointer-events-none">
          <div className="text-center">
            {pollUrl && !polledOnce ? (
              <>
                <div className="text-sm font-medium text-muted-foreground">Loading live riders…</div>
                <div className="text-xs text-muted-foreground mt-1">Fetching the fleet's latest positions.</div>
              </>
            ) : pollError ? (
              <>
                <div className="text-sm font-medium text-muted-foreground">Can't reach the live feed</div>
                <div className="text-xs text-muted-foreground mt-1">Retrying automatically — positions will reappear shortly.</div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-muted-foreground">Waiting for riders to go online…</div>
                <div className="text-xs text-muted-foreground mt-1">Pins appear in real-time as the app reports GPS.</div>
              </>
            )}
          </div>
        </div>
      )}

      {selectedPos && (
        <RiderPanel
          rider={{
            riderId: selectedPos.riderId,
            name: selectedPos.name ?? 'Rider',
            lat: selectedPos.lat,
            lng: selectedPos.lng,
            at: selectedPos.at,
            seenAt: selectedPos.seenAt,
            stale: selectedPos.stale,
            status: selectedPos.status,
            orderId: selectedPos.orderId
          }}
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
