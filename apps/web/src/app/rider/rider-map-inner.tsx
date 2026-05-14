'use client';
/**
 * Rider's in-app map — vanilla Leaflet + OSM tiles (no react-leaflet).
 * Three pins:
 *   🍽️  pickup (restaurant branch)
 *   🏠  destination (customer address)
 *   🛵  rider's own live GPS (updated locally as the device moves)
 *
 * Works inside the Capacitor WebView — no native plugin needed; Leaflet uses
 * navigator.geolocation which Capacitor pipes through to the OS automatically.
 *
 * Control surface (rebuilt for touch, May 2026):
 *   • Leaflet's default zoom control is disabled.
 *   • Right side, bottom-anchored FAB stack (44×44 tap targets):
 *       Recenter on me  → flyTo(rider, 16) + 60s auto-follow window.
 *       Fit to leg      → fitBounds(rider, active target) with 60px padding.
 *       Layer style     → OSM ↔ Carto Voyager ↔ Esri Satellite (localStorage).
 *       Fullscreen      → Fullscreen API on the container's parent.
 *   • Top-left stage chip — current leg label, with a pulse dot once PICKED_UP.
 *   • Top-right Speed/ETA chip — minutes + km, hidden when distance is unknown.
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, Crosshair, Layers, Maximize2, Minimize2 } from 'lucide-react';

interface LatLng { lat: number; lng: number }
interface Props {
  branch:    LatLng | null;
  delivery:  LatLng | null;
  stage:     'ACCEPTED' | 'PICKED_UP' | string;
}

type TileStyle = 'osm' | 'voyager' | 'esri';

const TILE_DEFS: Record<TileStyle, { url: string; attribution: string; label: string }> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    label: 'Map'
  },
  voyager: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    label: 'Bright'
  },
  esri: {
    // NOTE: Esri uses y/x order, not the usual x/y.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    label: 'Satellite'
  }
};

function animateMarker(marker: L.Marker, target: { lat: number; lng: number }, ms: number) {
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

/**
 * 44×44 emoji pin. `pulse` adds a green halo around the rider when they're
 * close to the drop-off, so the next move (handing the bag over) is obvious.
 */
function divIcon(emoji: string, bg: string, opts: { pulse?: boolean } = {}) {
  const pulseRing = opts.pulse
    ? `<span style="position:absolute;inset:-6px;border-radius:50%;border:3px solid #16a34a;opacity:.85;animation:rider-pulse 1.4s ease-out infinite"></span>`
    : '';
  return L.divIcon({
    html: `<div style="position:relative;width:44px;height:44px">${pulseRing}<div style="position:relative;font-size:22px;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:${bg};box-shadow:0 4px 12px rgba(0,0,0,.3);border:3px solid white">${emoji}</div></div>`,
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

// Haversine distance in km between two lat/lng points.
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function etaMinutes(km: number): number {
  return Math.max(1, Math.round((km / 25) * 60)); // 25 km/h average
}

export default function RiderMapInner({ branch, delivery, stage }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const branchMarkerRef = useRef<L.Marker | null>(null);
  const deliveryMarkerRef = useRef<L.Marker | null>(null);
  const riderMarkerRef = useRef<L.Marker | null>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const followUntilRef = useRef<number>(0);
  const [rider, setRider] = useState<LatLng | null>(null);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const [tileStyle, setTileStyle] = useState<TileStyle>('osm');
  const [, setFollowing] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Load persisted tile style preference once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('map:style:rider') as TileStyle | null;
    if (saved && (saved === 'osm' || saved === 'voyager' || saved === 'esri')) {
      setTileStyle(saved);
    }
  }, []);

  // Initialise map once on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center = branch ?? delivery ?? { lat: 12.97, lng: 77.64 };

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 14,
      scrollWheelZoom: false,
      // Default +/- buttons are 26px — too small for touch. We render our own
      // 44×44 FABs in the bottom-right stack below.
      zoomControl: false,
      attributionControl: true
    });
    mapRef.current = map;

    const initialStyle = (typeof window !== 'undefined' &&
      (window.localStorage.getItem('map:style:rider') as TileStyle | null)) || 'osm';
    const def = TILE_DEFS[initialStyle in TILE_DEFS ? (initialStyle as TileStyle) : 'osm'];
    tileLayerRef.current = L.tileLayer(def.url, { attribution: def.attribution, maxZoom: 19 }).addTo(map);

    if (branch) branchMarkerRef.current = L.marker([branch.lat, branch.lng], { icon: divIcon('🍽️', '#ea5b1f') }).addTo(map);
    if (delivery) deliveryMarkerRef.current = L.marker([delivery.lat, delivery.lng], { icon: divIcon('🏠', '#3a73c1') }).addTo(map);

    // If user pans the map manually, drop them out of follow mode immediately.
    const cancelFollow = () => { followUntilRef.current = 0; setFollowing(false); };
    map.on('dragstart', cancelFollow);

    return () => {
      map.off('dragstart', cancelFollow);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      branchMarkerRef.current = null;
      deliveryMarkerRef.current = null;
      riderMarkerRef.current = null;
      trailLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap tile layer whenever the style preference changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const def = TILE_DEFS[tileStyle];
    tileLayerRef.current = L.tileLayer(def.url, { attribution: def.attribution, maxZoom: 19 }).addTo(map);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('map:style:rider', tileStyle);
    }
  }, [tileStyle]);

  // Track rider's own position via geolocation (local — instant updates)
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setRider(here);
        setTrail((t) => {
          if (t.length && Math.abs(t[t.length - 1].lat - here.lat) < 1e-6 && Math.abs(t[t.length - 1].lng - here.lng) < 1e-6) return t;
          return [...t.slice(-200), here];
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Tick the auto-follow window off once the 60s elapses.
  useEffect(() => {
    const i = setInterval(() => {
      if (followUntilRef.current && Date.now() > followUntilRef.current) {
        followUntilRef.current = 0;
        setFollowing(false);
      }
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Compute active target + distance for chips & rider-pin pulse.
  const target: LatLng | null = stage === 'PICKED_UP' ? delivery : branch;
  const distanceKm = rider && target ? haversineKm(rider, target) : null;
  // Pulse the rider pin once they're within 200m of the drop AND post-pickup.
  const dropPulse = stage === 'PICKED_UP' && distanceKm != null && distanceKm < 0.2;

  // Reconcile rider marker + trail; auto-fit to active leg (unless following).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (rider) {
      if (riderMarkerRef.current) {
        animateMarker(riderMarkerRef.current, rider, 600);
        // Swap icon if pulse state changed (cheap — divIcon is just innerHTML).
        riderMarkerRef.current.setIcon(divIcon('🛵', '#16a34a', { pulse: dropPulse }));
      } else {
        riderMarkerRef.current = L.marker([rider.lat, rider.lng], { icon: divIcon('🛵', '#16a34a', { pulse: dropPulse }) }).addTo(map);
      }
    }

    if (trail.length >= 2) {
      const pts = trail.map((p) => [p.lat, p.lng] as [number, number]);
      if (trailLineRef.current) trailLineRef.current.setLatLngs(pts);
      else trailLineRef.current = L.polyline(pts, { color: '#16a34a', weight: 4, opacity: 0.75, dashArray: '6 6' }).addTo(map);
    }

    // While auto-follow is active, keep recentring on every GPS tick.
    if (rider && Date.now() < followUntilRef.current) {
      map.panTo([rider.lat, rider.lng], { animate: true });
      return;
    }

    // Active leg = restaurant before pickup, customer after pickup
    const legTarget: LatLng | null = stage === 'PICKED_UP' ? delivery : branch;
    const pts = [rider, legTarget].filter(Boolean) as LatLng[];
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lng], 15, { animate: true });
    } else if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [60, 60], maxZoom: 16, animate: true });
    }
  }, [rider, trail, stage, branch, delivery, dropPulse]);

  // Fullscreen API — keep React state in sync with browser fullscreen changes
  // (user can press Esc to exit, so we listen to `fullscreenchange` rather than
  // assume our toggle is the only way out).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current?.parentElement);
      // After the resize transition settles, ask Leaflet to recompute size.
      setTimeout(() => mapRef.current?.invalidateSize(), 220);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function handleRecenter() {
    const map = mapRef.current;
    if (!map || !rider) return;
    map.flyTo([rider.lat, rider.lng], 16, { animate: true, duration: 0.8 });
    followUntilRef.current = Date.now() + 60_000;
    setFollowing(true);
  }

  function handleFitLeg() {
    const map = mapRef.current;
    if (!map) return;
    // Drop out of follow mode when the user manually re-frames.
    followUntilRef.current = 0;
    setFollowing(false);
    const pts = [rider, target].filter(Boolean) as LatLng[];
    if (pts.length === 1) {
      map.flyTo([pts[0].lat, pts[0].lng], 15, { animate: true, duration: 0.8 });
    } else if (pts.length >= 2) {
      map.flyToBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [60, 60], maxZoom: 16, duration: 0.8 });
    }
  }

  async function handleFullscreen() {
    if (typeof document === 'undefined') return;
    const el = containerRef.current?.parentElement;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
      // Leaflet needs a kick after the container resizes.
      setTimeout(() => mapRef.current?.invalidateSize(), 220);
    } catch {
      // No-op — fullscreen blocked or unsupported (e.g. iOS Safari WebView).
    }
  }

  function cycleTileStyle() {
    setTileStyle((s) => (s === 'osm' ? 'voyager' : s === 'voyager' ? 'esri' : 'osm'));
  }

  const nextStyle: TileStyle = tileStyle === 'osm' ? 'voyager' : tileStyle === 'voyager' ? 'esri' : 'osm';

  // Shared classes for the FAB stack on the right. 44×44 is the smallest
  // recommended touch target; the ring shows on hover/press for feedback.
  const fabCls =
    'tap-press grid h-11 w-11 place-items-center rounded-full bg-white shadow-md text-slate-700 ' +
    'ring-1 ring-black/5 hover:bg-white hover:ring-black/10 active:ring-2 active:ring-black/15 ' +
    'disabled:opacity-50 disabled:active:ring-1';

  return (
    <div
      role="region"
      aria-label="Delivery map"
      className={`relative w-full overflow-hidden rounded-lg border ${isFullscreen ? 'h-screen' : 'h-full'}`}
    >
      {/* Local keyframes for the rider pulse-halo — keeps CSS scoped to this
          component without needing to plumb it through Tailwind config. */}
      <style>{`
        @keyframes rider-pulse {
          0%   { transform: scale(0.85); opacity: 0.9; }
          70%  { transform: scale(1.35); opacity: 0;   }
          100% { transform: scale(1.35); opacity: 0;   }
        }
      `}</style>

      <div ref={containerRef} className="h-full w-full" />

      {!rider && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 to-transparent p-2 text-center text-[11px] text-muted-foreground">
          Waiting for GPS… make sure location permission is granted.
        </div>
      )}

      {/* Top-left: stage banner chip */}
      <div className="pointer-events-none absolute top-3 left-3 z-[400]">
        <div className="flex items-center gap-1.5 rounded-full border border-black/10 bg-card/95 px-3 py-1.5 text-[12px] font-medium text-card-foreground shadow-sm backdrop-blur">
          {stage === 'PICKED_UP' && (
            <span className="relative inline-flex h-2 w-2 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          )}
          <span>{stage === 'PICKED_UP' ? '🏠 Heading to customer' : '🍽️ Heading to restaurant'}</span>
        </div>
      </div>

      {/* Top-right: ETA / distance chip (saffron pill) */}
      {distanceKm != null && (
        <div className="pointer-events-none absolute top-3 right-3 z-[400]">
          <div className="flex flex-col items-center rounded-full bg-[#ea5b1f] px-3 py-1.5 text-white shadow-lg ring-1 ring-white/40">
            <span className="text-base font-bold leading-none">{etaMinutes(distanceKm)} min</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-90">{formatDistance(distanceKm)} away</span>
          </div>
        </div>
      )}

      {/* Bottom-right: control FAB stack — recenter / fit / layers / fullscreen */}
      <div className="absolute bottom-3 right-3 z-[400] flex flex-col gap-2">
        <button
          type="button"
          onClick={handleRecenter}
          disabled={!rider}
          aria-label="Recenter on my location"
          title="Recenter on me"
          className={fabCls}
        >
          <Navigation className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleFitLeg}
          aria-label="Fit map to current leg"
          title="Fit to current leg"
          className={fabCls}
        >
          <Crosshair className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={cycleTileStyle}
          aria-label={`Map style: ${TILE_DEFS[tileStyle].label}. Tap to switch to ${TILE_DEFS[nextStyle].label}.`}
          title={`Style: ${TILE_DEFS[tileStyle].label} → ${TILE_DEFS[nextStyle].label}`}
          className={fabCls}
        >
          <Layers className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen map' : 'Enter fullscreen map'}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className={fabCls}
        >
          {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
