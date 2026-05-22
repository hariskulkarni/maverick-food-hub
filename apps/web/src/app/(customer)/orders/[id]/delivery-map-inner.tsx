'use client';
/**
 * Live delivery map — free, no API key.
 * Tiles: OpenStreetMap (per OSM tile usage policy).
 * Library: vanilla Leaflet (no react-leaflet) — avoids React 18/19 peer-dep
 * mismatch and Next 15 ESM resolution flakiness.
 *
 * Listens to SSE on `order:{orderId}`; each `kind:'location'` event moves the
 * rider marker and extends the polyline trail.
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { useSSE } from '@/hooks/use-sse';

// Quick haversine in metres for the client-side "rider arriving" check. We
// also fire on the server `rider:nearby` event, but we belt-and-braces it
// locally so the toast still happens even if SSE drops between the rider's
// 200m crossing and the next ping.
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface LatLng { lat: number; lng: number }
interface Props {
  orderId: string;
  branch: LatLng | null;
  delivery: LatLng | null;
  initialRider?: LatLng | null;
  initialTrail?: LatLng[];
}

/**
 * Smoothly tween a Leaflet marker from its current latlng to a target over
 * `ms` milliseconds. Cheaper than rebuilding the marker, and the animation
 * makes a noisy 1-2 Hz feed feel buttery.
 */
function animateMarker(marker: L.Marker, target: { lat: number; lng: number }, ms: number) {
  const start = marker.getLatLng();
  const t0 = performance.now();
  const lat0 = start.lat, lng0 = start.lng;
  const dlat = target.lat - lat0, dlng = target.lng - lng0;
  if (Math.abs(dlat) < 1e-7 && Math.abs(dlng) < 1e-7) return;
  function step(now: number) {
    const t = Math.min(1, (now - t0) / ms);
    // ease-out-cubic
    const e = 1 - Math.pow(1 - t, 3);
    marker.setLatLng([lat0 + dlat * e, lng0 + dlng * e]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function makeIcon(emoji: string, color: string) {
  return L.divIcon({
    html: `<div style="font-size:22px;line-height:1;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:${color};box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid white">${emoji}</div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

export default function DeliveryMapInner({ orderId, branch, delivery, initialRider, initialTrail = [] }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const branchMarkerRef = useRef<L.Marker | null>(null);
  const deliveryMarkerRef = useRef<L.Marker | null>(null);
  const riderMarkerRef = useRef<L.Marker | null>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const [rider, setRider] = useState<LatLng | null>(initialRider ?? null);
  const [trail, setTrail] = useState<LatLng[]>(initialTrail);
  // One-shot per-order arrival toast. Stored in a ref so the toast doesn't
  // re-fire on every state change after the rider crosses 200m.
  const arrivalFiredRef = useRef<boolean>(false);

  // Initialise map once on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const seedRider = initialRider ?? null;
    const center = seedRider ?? delivery ?? branch ?? { lat: 12.97, lng: 77.64 };

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 13,
      scrollWheelZoom: false
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    if (branch) branchMarkerRef.current = L.marker([branch.lat, branch.lng], { icon: makeIcon('🍽️', '#f23e5c') }).bindPopup('Restaurant kitchen').addTo(map);
    if (delivery) deliveryMarkerRef.current = L.marker([delivery.lat, delivery.lng], { icon: makeIcon('🏠', '#3a73c1') }).bindPopup('Delivery to you').addTo(map);
    if (seedRider) riderMarkerRef.current = L.marker([seedRider.lat, seedRider.lng], { icon: makeIcon('🛵', '#16a34a') }).bindPopup('Your rider').addTo(map);

    if (initialTrail.length >= 2) {
      trailLineRef.current = L.polyline(initialTrail.map((p) => [p.lat, p.lng] as [number, number]), {
        color: '#f23e5c', weight: 4, opacity: 0.7, dashArray: '6 6'
      }).addTo(map);
    }

    // Fit bounds to known points
    const pts = [branch, delivery, seedRider].filter(Boolean) as LatLng[];
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 16 });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      branchMarkerRef.current = null;
      deliveryMarkerRef.current = null;
      riderMarkerRef.current = null;
      trailLineRef.current = null;
    };
    // We intentionally only init once; subsequent changes are reconciled in the
    // useEffects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rider marker + trail follow SSE updates. We animate the marker between
  // pings so it glides instead of jumping — feels much more responsive even
  // at 1-2Hz update rate.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !rider) return;
    if (riderMarkerRef.current) {
      animateMarker(riderMarkerRef.current, rider, 600);
    } else {
      riderMarkerRef.current = L.marker([rider.lat, rider.lng], { icon: makeIcon('🛵', '#16a34a') }).bindPopup('Your rider').addTo(map);
    }
    if (trail.length >= 2) {
      const pos = trail.map((p) => [p.lat, p.lng] as [number, number]);
      if (trailLineRef.current) {
        trailLineRef.current.setLatLngs(pos);
      } else {
        trailLineRef.current = L.polyline(pos, { color: '#f23e5c', weight: 4, opacity: 0.7, dashArray: '6 6' }).addTo(map);
      }
    }
  }, [rider, trail]);

  // Push GPS pings from SSE
  useSSE(`order:${orderId}`, {
    onMessage: (evt: any) => {
      if (evt?.kind === 'location' && typeof evt.lat === 'number' && typeof evt.lng === 'number') {
        const next = { lat: evt.lat, lng: evt.lng };
        setRider(next);
        setTrail((t) => [...t.slice(-200), next]);
        // Local 200m proximity check — fires the arrival toast as soon as the
        // rider crosses the threshold, independent of the server-side dedupe.
        if (!arrivalFiredRef.current && delivery) {
          if (metersBetween(next, delivery) <= 200) {
            arrivalFiredRef.current = true;
            toast.info('Rider arriving — please head out');
          }
        }
      }
      // Server-driven proximity event — same one-shot guard so we don't toast
      // twice when both the local check and the server cross simultaneously.
      if (evt?.kind === 'rider:nearby' && !arrivalFiredRef.current) {
        arrivalFiredRef.current = true;
        toast.info('Rider arriving — please head out');
      }
    }
  });

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl border">
      <div ref={containerRef} className="h-full w-full" />
      {!rider && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 to-transparent p-3 text-center text-xs text-muted-foreground">
          Waiting for rider's GPS… map updates the moment they go online.
        </div>
      )}
    </div>
  );
}
