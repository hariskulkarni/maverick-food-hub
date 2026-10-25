'use client';
/** Minimal Leaflet map for the public trip page: rider pin + optional restaurant pin. */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LatLng = { lat: number; lng: number };

function pin(emoji: string, color: string) {
  return L.divIcon({
    html: `<div style="font-size:20px;line-height:1;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:${color};box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid white">${emoji}</div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

export default function TripMap({ rider, restaurant }: { rider: LatLng; restaurant: LatLng | null }) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const riderMarker = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: [rider.lat, rider.lng], zoom: 15, scrollWheelZoom: false });
    map.current = m;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(m);
    riderMarker.current = L.marker([rider.lat, rider.lng], { icon: pin('🛵', '#16a34a') }).addTo(m);
    if (restaurant) {
      L.marker([restaurant.lat, restaurant.lng], { icon: pin('🍽️', '#f23e5c') }).addTo(m);
      m.fitBounds(L.latLngBounds([[rider.lat, rider.lng], [restaurant.lat, restaurant.lng]]), { padding: [40, 40], maxZoom: 16 });
    }
    return () => {
      m.remove();
      map.current = null;
      riderMarker.current = null;
    };
    // init once; rider moves are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    riderMarker.current?.setLatLng([rider.lat, rider.lng]);
  }, [rider.lat, rider.lng]);

  return <div ref={el} className="h-64 w-full rounded-xl border" />;
}
