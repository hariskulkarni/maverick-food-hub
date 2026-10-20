/**
 * Photon (komoot) address autocomplete, India-biased. Server-only: outbound calls
 * share the Nominatim throttle queue from `@/server/geocoding`. Never call from the browser.
 */
import { enqueue } from '@/server/geocoding';

export interface AutocompleteResult {
  label: string;
  lat: number;
  lng: number;
  pincode?: string;
}

const INDIA_CENTROID = { lat: 20.5937, lng: 78.9629 };
const UA = 'RestaurantManager/0.1 (contact: harish.adobearchitect@gmail.com)';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

export async function autocomplete(
  query: string,
  bias?: { lat: number; lng: number }
): Promise<AutocompleteResult[]> {
  const q = query.trim();
  if (!q) return [];
  const base = (process.env.PHOTON_URL || 'https://photon.komoot.io').replace(/\/+$/, '');
  const b = bias ?? INDIA_CENTROID;
  const params = new URLSearchParams({
    q,
    limit: '5',
    lang: 'en',
    lat: String(b.lat),
    lon: String(b.lng)
  });
  const url = `${base}/api/?${params.toString()}`;

  return enqueue(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: PhotonFeature[] };
    const out: AutocompleteResult[] = [];
    for (const f of data.features ?? []) {
      const c = f.geometry?.coordinates;
      const p = f.properties ?? {};
      if (!c || c.length < 2) continue;
      const street = [p.housenumber, p.street].filter(Boolean).join(' ');
      const label = [p.name, street, p.district, p.city, p.state, p.country]
        .filter((v, i, a): v is string => !!v && a.indexOf(v) === i)
        .join(', ');
      if (!label) continue;
      const r: AutocompleteResult = { label, lat: c[1], lng: c[0] };
      if (p.postcode) r.pincode = p.postcode;
      out.push(r);
    }
    return out;
  });
}
