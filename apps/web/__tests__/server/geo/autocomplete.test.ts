import { describe, it, expect, vi, afterEach } from 'vitest';
import { autocomplete } from '@/server/geo/autocomplete';

const photon = {
  features: [
    {
      geometry: { type: 'Point', coordinates: [80.4365, 16.3067] },
      properties: { name: 'Brodipet', street: '2nd Lane', city: 'Guntur', state: 'Andhra Pradesh', postcode: '522002', country: 'India' }
    },
    {
      geometry: { type: 'Point', coordinates: [77.59, 12.97] },
      properties: { name: 'MG Road', city: 'Bengaluru', country: 'India' }
    }
  ]
};

afterEach(() => vi.unstubAllGlobals());

describe('autocomplete', () => {
  it('parses Photon features and biases to India by default', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => photon });
    vi.stubGlobal('fetch', f);
    const out = await autocomplete('brod');
    expect(out).toEqual([
      { label: 'Brodipet, 2nd Lane, Guntur, Andhra Pradesh, India', lat: 16.3067, lng: 80.4365, pincode: '522002' },
      { label: 'MG Road, Bengaluru, India', lat: 12.97, lng: 77.59 }
    ]);
    const url = new URL(f.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/api/');
    expect(url.searchParams.get('q')).toBe('brod');
    expect(url.searchParams.get('lat')).toBe('20.5937');
    expect(url.searchParams.get('lon')).toBe('78.9629');
  });

  it('uses a provided bias', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    vi.stubGlobal('fetch', f);
    await autocomplete('x', { lat: 1.5, lng: 2.5 });
    const url = new URL(f.mock.calls[0][0] as string);
    expect(url.searchParams.get('lat')).toBe('1.5');
    expect(url.searchParams.get('lon')).toBe('2.5');
  });

  it('returns [] for blank query without fetching, and on upstream error', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', f);
    expect(await autocomplete('  ')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(await autocomplete('abc')).toEqual([]);
  });
});
