'use client';
/**
 * Reusable address picker — Leaflet map (vanilla, no react-leaflet) + a search
 * box, "Use my location" button, and editable address fields. All Nominatim
 * traffic goes through our server routes so the 1 req/sec rate-limit holds.
 *
 * Owner: customer profile (`/profile/addresses`). Other surfaces may reuse it
 * later — keep the API simple: `initial` + `onChange`.
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, MapPin, Search, Crosshair } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export interface PickedAddress {
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  initial?: Partial<PickedAddress>;
  onChange: (addr: PickedAddress) => void;
}

interface SearchHit {
  lat: number;
  lng: number;
  displayName: string;
  address: {
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

// Guntur as a sensible default — most of the platform's launch users.
const DEFAULT_CENTER = { lat: 16.3067, lng: 80.4365 };

function pinIcon() {
  return L.divIcon({
    html:
      '<div style="font-size:22px;line-height:1;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#ea5b1f;box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid white">📍</div>',
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 32]
  });
}

export function AddressPicker({ initial, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const startLat = initial?.latitude ?? DEFAULT_CENTER.lat;
  const startLng = initial?.longitude ?? DEFAULT_CENTER.lng;

  const [form, setForm] = useState<PickedAddress>({
    label: initial?.label || 'Home',
    line1: initial?.line1 || '',
    line2: initial?.line2 || '',
    city: initial?.city || '',
    state: initial?.state || '',
    postalCode: initial?.postalCode || '',
    country: initial?.country || 'IN',
    latitude: initial?.latitude ?? null,
    longitude: initial?.longitude ?? null
  });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Bubble form changes up to the parent.
  useEffect(() => {
    onChange(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // Mount the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [startLat, startLng],
      zoom: initial?.latitude ? 16 : 12,
      scrollWheelZoom: true
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    const marker = L.marker([startLat, startLng], { icon: pinIcon(), draggable: true }).addTo(map);
    markerRef.current = marker;

    marker.on('dragend', async () => {
      const { lat, lng } = marker.getLatLng();
      await reverseFill(lat, lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reverseFill(lat: number, lng: number) {
    setReverseLoading(true);
    try {
      const res = await fetch('/api/customer/addresses/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng })
      });
      const data = res.ok
        ? ((await res.json()) as { line1: string; city: string; state: string; postalCode: string; country: string })
        : null;
      setForm((f) => ({
        ...f,
        latitude: lat,
        longitude: lng,
        line1: data?.line1 || f.line1,
        city: data?.city || f.city,
        state: data?.state || f.state,
        postalCode: data?.postalCode || f.postalCode,
        country: data?.country || f.country
      }));
    } finally {
      setReverseLoading(false);
    }
  }

  function flyToAndPin(lat: number, lng: number) {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    map.flyTo([lat, lng], 16, { duration: 0.8 });
    marker.setLatLng([lat, lng]);
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setShowResults(true);
    try {
      const res = await fetch('/api/customer/addresses/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query })
      });
      const data = res.ok ? ((await res.json()) as SearchHit[]) : [];
      setResults(data);
    } finally {
      setSearching(false);
    }
  }

  function pickResult(hit: SearchHit) {
    flyToAndPin(hit.lat, hit.lng);
    setForm((f) => ({
      ...f,
      latitude: hit.lat,
      longitude: hit.lng,
      line1: hit.address.line1 || f.line1,
      city: hit.address.city || f.city,
      state: hit.address.state || f.state,
      postalCode: hit.address.postalCode || f.postalCode,
      country: hit.address.country || f.country
    }));
    setShowResults(false);
    setQuery(hit.displayName);
  }

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        flyToAndPin(latitude, longitude);
        await reverseFill(latitude, longitude);
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Search address, area or landmark"
              className="pl-9"
            />
          </div>
          <Button type="button" variant="secondary" onClick={() => void runSearch()} disabled={searching}>
            {searching ? <Loader2 className="size-4 animate-spin" /> : 'Search'}
          </Button>
        </div>
        {showResults && results.length > 0 && (
          <div className="glass absolute z-[1000] mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickResult(r)}
                className="tap-press flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{r.displayName}</span>
              </button>
            ))}
          </div>
        )}
        {showResults && !searching && results.length === 0 && (
          <div className="absolute z-[1000] mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
            No matches.
          </div>
        )}
      </div>

      {/* Map */}
      <div className="relative overflow-hidden rounded-xl border" style={{ height: 320 }}>
        <div ref={containerRef} className="h-full w-full" />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={useMyLocation}
          disabled={geoLoading}
          className="tap-press absolute right-3 top-3 z-[1000] shadow"
        >
          {geoLoading ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          <span className="ml-1">Use my location</span>
        </Button>
        {reverseLoading && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 to-transparent p-2 text-center text-xs text-muted-foreground">
            Looking up address…
          </div>
        )}
      </div>

      {/* Editable fields */}
      <Card className="card-lift">
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Label</Label>
              <Select value={form.label} onValueChange={(v) => setForm((f) => ({ ...f, label: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Home">Home</SelectItem>
                  <SelectItem value="Work">Work</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PIN code</Label>
              <Input
                className="mt-1"
                value={form.postalCode}
                onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Address line 1</Label>
            <Input
              className="mt-1"
              value={form.line1}
              onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
              placeholder="House number, street"
            />
          </div>
          <div>
            <Label>Address line 2</Label>
            <Input
              className="mt-1"
              value={form.line2}
              onChange={(e) => setForm((f) => ({ ...f, line2: e.target.value }))}
              placeholder="Apartment, landmark (optional)"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>City</Label>
              <Input
                className="mt-1"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div>
              <Label>State</Label>
              <Input
                className="mt-1"
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AddressPicker;
