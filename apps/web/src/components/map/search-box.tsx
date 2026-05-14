'use client';
/**
 * SearchBox — debounced Nominatim (OpenStreetMap) place search.
 *
 * Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - Maximum 1 request per second, absolute hard limit.
 *   - Identifying User-Agent / Referer required.
 *   - No heavy/bulk usage on the public endpoint.
 *
 * We enforce the rate limit on the client with a tiny serial queue. Note that
 * browsers strip the User-Agent header on fetch — the Referer (set by the
 * browser automatically from window.location) is what Nominatim actually sees
 * for our identification; we still pass a UA-style header for completeness in
 * case this code is ever reused server-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

export interface SearchPick {
  lat: number;
  lng: number;
  displayName: string;
}

export interface SearchBoxProps {
  onPick: (pick: SearchPick) => void;
  /** Restrict results to country codes (default 'in'). Pass '' to disable. */
  countryCodes?: string;
  /** Placeholder text. */
  placeholder?: string;
  className?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  place_id: number;
}

// --- Rate limiter: 1 req/sec, serial queue --------------------------------
let lastRequestAt = 0;
const PENDING: Array<() => void> = [];
let draining = false;

function scheduleRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    PENDING.push(() => {
      fn().then(resolve, reject);
    });
    drain();
  });
}

function drain() {
  if (draining) return;
  draining = true;
  const tick = () => {
    if (PENDING.length === 0) {
      draining = false;
      return;
    }
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - lastRequestAt));
    setTimeout(() => {
      const task = PENDING.shift();
      lastRequestAt = Date.now();
      task?.();
      tick();
    }, wait);
  };
  tick();
}

export function SearchBox({
  onPick,
  countryCodes = 'in',
  placeholder = 'Search a place…',
  className
}: SearchBoxProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Debounce 350ms
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      const params = new URLSearchParams({
        format: 'json',
        q,
        limit: '5'
      });
      if (countryCodes) params.set('countrycodes', countryCodes);
      const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
      scheduleRequest(() =>
        fetch(url, {
          headers: {
            // Browsers ignore User-Agent on fetch; included for parity if reused server-side.
            'User-Agent': 'FoodHub Admin (foodhub@example.com)',
            'Accept-Language': 'en'
          }
        }).then((r) => r.json() as Promise<NominatimResult[]>)
      )
        .then((data) => {
          setResults(Array.isArray(data) ? data : []);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [q, countryCodes]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = useCallback(
    (r: NominatimResult) => {
      onPick({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), displayName: r.display_name });
      setQ(r.display_name);
      setOpen(false);
    },
    [onPick]
  );

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-full border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-sm shadow-sm outline-none ring-emerald-500 focus:ring-2"
        />
        {loading && (
          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-gray-400" />
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 z-[500] mt-1 max-h-72 overflow-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-black/5">
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="block w-full truncate px-3 py-1.5 text-left hover:bg-gray-50"
                title={r.display_name}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
