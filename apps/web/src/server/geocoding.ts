/**
 * Nominatim wrapper for the customer address picker.
 *
 * The OSM Nominatim usage policy caps anonymous traffic at 1 request/second.
 * To honour that across concurrent callers we serialise every outbound call
 * through a module-scoped promise chain — each request waits for the previous
 * one to settle plus a 1-second cooldown. This holds only if these helpers are
 * ALWAYS called from the server (route handlers / server actions); never call
 * them directly from the browser.
 */

interface SearchResult {
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

interface ReverseResult {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const UA = 'RestaurantManager/0.1 (contact: harish.adobearchitect@gmail.com)';
const MIN_GAP_MS = 1000;

let queueTail: Promise<unknown> = Promise.resolve();
let lastDispatchedAt = 0;

/** Queue `task` so it runs at least `MIN_GAP_MS` after the previous queued task. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastDispatchedAt + MIN_GAP_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDispatchedAt = Date.now();
    return task();
  });
  // Keep the chain alive even if a task rejects.
  queueTail = run.catch(() => undefined);
  return run;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  neighbourhood?: string;
  suburb?: string;
  village?: string;
  town?: string;
  city?: string;
  state_district?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

function pickCity(a: NominatimAddress): string {
  return a.city || a.town || a.village || a.suburb || a.neighbourhood || '';
}

function pickLine1(a: NominatimAddress, fallback: string): string {
  const street = [a.house_number, a.road || a.pedestrian].filter(Boolean).join(' ').trim();
  if (street) return street;
  // If Nominatim couldn't parse a street, fall back to the leading chunk of the display name.
  return fallback.split(',').slice(0, 2).join(',').trim();
}

export async function searchAddresses(q: string, countryCode = 'in'): Promise<SearchResult[]> {
  const query = q.trim();
  if (!query) return [];
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1` +
    `&countrycodes=${encodeURIComponent(countryCode)}` +
    `&q=${encodeURIComponent(query)}&limit=5`;

  return enqueue(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      address?: NominatimAddress;
    }>;
    return rows.map((r) => {
      const a = r.address ?? {};
      return {
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        displayName: r.display_name,
        address: {
          line1: pickLine1(a, r.display_name),
          city: pickCity(a),
          state: a.state || a.state_district || '',
          postalCode: a.postcode || '',
          country: (a.country_code || countryCode).toUpperCase()
        }
      } satisfies SearchResult;
    });
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseResult> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1` +
    `&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`;

  return enqueue(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) {
      return { line1: '', city: '', state: '', postalCode: '', country: 'IN' };
    }
    const data = (await res.json()) as { display_name?: string; address?: NominatimAddress };
    const a = data.address ?? {};
    return {
      line1: pickLine1(a, data.display_name ?? ''),
      city: pickCity(a),
      state: a.state || a.state_district || '',
      postalCode: a.postcode || '',
      country: (a.country_code || 'in').toUpperCase()
    };
  });
}
