'use client';
/**
 * Leaflet map for the rider insights page: an optional travelled path
 * (polyline), a moving playback cursor, pickup/drop pins and the rider's last
 * known position. Vanilla Leaflet + the shared map widgets (tile style
 * toggle), same as the other maps; loaded with next/dynamic (ssr: false).
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { StyleToggle, getStoredMapStyle, useTileLayer } from '@/components/map';

export interface LatLng { lat: number; lng: number }

export interface InsightsMapProps {
  path?: LatLng[];
  cursor?: LatLng | null;
  pickup?: LatLng | null;
  drop?: LatLng | null;
  /** Rider's last known position (shown when there is no playback cursor). */
  rider?: LatLng | null;
  height?: number;
}

const DEFAULT_CENTER: LatLng = { lat: 16.3067, lng: 80.4365 }; // Guntur

function pin(emoji: string, bg: string, size = 30) {
  return L.divIcon({
    html: `<div style="font-size:${Math.round(size * 0.55)}px;display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${emoji}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function InsightsMap({ path, cursor, pickup, drop, rider, height = 320 }: InsightsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const cursorRef = useRef<L.Marker | null>(null);
  const { setStyle } = useTileLayer(mapRef);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = rider ?? pickup ?? path?.[0] ?? DEFAULT_CENTER;
    // No scroll-wheel zoom: the map sits in a long page that scrolls (buttons + pinch still zoom).
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([start.lat, start.lng], 14);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    // StyleToggle's mount callback ran before the map existed: add tiles now.
    const s = getStoredMapStyle();
    setStyle(s.url, s.attribution);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      cursorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Static layers: path + pins. Refit when the path changes.
  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    cursorRef.current = null;
    const bounds: L.LatLngExpression[] = [];
    if (path && path.length > 1) {
      const ll = path.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(ll, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(group);
      L.circleMarker(ll[0], { radius: 5, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip('Start').addTo(group);
      L.circleMarker(ll[ll.length - 1], { radius: 5, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }).bindTooltip('End').addTo(group);
      bounds.push(...ll);
    }
    if (pickup) { L.marker([pickup.lat, pickup.lng], { icon: pin('🍽️', '#fff7ed') }).bindTooltip('Pickup').addTo(group); bounds.push([pickup.lat, pickup.lng]); }
    if (drop) { L.marker([drop.lat, drop.lng], { icon: pin('🏠', '#eff6ff') }).bindTooltip('Drop').addTo(group); bounds.push([drop.lat, drop.lng]); }
    if (rider && !(path && path.length > 1)) {
      L.marker([rider.lat, rider.lng], { icon: pin('🛵', '#16a34a', 34) }).bindTooltip('Last known location').addTo(group);
      bounds.push([rider.lat, rider.lng]);
    }
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 17 });
    else if (bounds.length === 1) map.setView(bounds[0], 15);
  }, [path, pickup, drop, rider]);

  // Playback cursor moves without redrawing the path.
  useEffect(() => {
    const group = layerRef.current;
    if (!group) return;
    if (!cursor) {
      if (cursorRef.current) { group.removeLayer(cursorRef.current); cursorRef.current = null; }
      return;
    }
    if (!cursorRef.current) cursorRef.current = L.marker([cursor.lat, cursor.lng], { icon: pin('🛵', '#f59e0b', 34), zIndexOffset: 1000 }).addTo(group);
    else cursorRef.current.setLatLng([cursor.lat, cursor.lng]);
  }, [cursor]);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border" style={{ height }}>
      {/* z-0 gives Leaflet's panes their own stacking context so the toggle sits above them. */}
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <StyleToggle onChange={setStyle} />
    </div>
  );
}
