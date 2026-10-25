/**
 * Defect 4 — rider incident photos: upload route (size/type limits, rider-only)
 * and the incident report only accepts the rider's own uploaded photo URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
const puts: any[] = [];
const created: any[] = [];
vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 1 }) }));
vi.mock('@/server/storage', () => ({
  storage: () => ({
    put: async (file: any, opts: any) => { puts.push({ file, opts }); return { url: `/uploads/${opts.folder}/abc.jpg`, key: 'k' }; }
  })
}));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async () => ({ id: 'rp1' }) },
    riderIncidentReport: { create: async ({ data }: any) => { created.push(data); return { id: 'i1', createdAt: new Date(), updatedAt: new Date(), resolution: null, ...data }; } }
  }
}));

import { POST as uploadPhoto } from '@/app/api/rider/incidents/photo/route';
import { POST as reportIncident } from '@/app/api/rider/incidents/route';

function formReq(blob: Blob | null) {
  const fd = new FormData();
  if (blob) fd.append('photo', blob, 'p.jpg');
  return { formData: async () => fd } as any;
}
const jsonReq = (body: unknown) => ({ json: async () => body }) as any;

beforeEach(() => { session = { user: { id: 'u1', role: 'RIDER' } }; puts.length = 0; created.length = 0; });

describe('POST /api/rider/incidents/photo', () => {
  it('stores a JPEG under the rider incident folder and returns its url', async () => {
    const r = await uploadPhoto(formReq(new Blob([new Uint8Array(10)], { type: 'image/jpeg' })));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ url: '/uploads/rider-incidents/rp1/abc.jpg' });
    expect(puts[0].opts.folder).toBe('rider-incidents/rp1');
  });
  it('rejects non-images, oversize files, missing file and non-riders', async () => {
    expect((await uploadPhoto(formReq(new Blob(['x'], { type: 'application/pdf' })))).status).toBe(400);
    expect((await uploadPhoto(formReq(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' })))).status).toBe(400);
    expect((await uploadPhoto(formReq(null))).status).toBe(400);
    session = { user: { id: 'u2', role: 'CUSTOMER' } };
    expect((await uploadPhoto(formReq(new Blob(['x'], { type: 'image/jpeg' })))).status).toBe(403);
    expect(puts).toHaveLength(0);
  });
});

describe('POST /api/rider/incidents photoUrl', () => {
  it('saves the rider own uploaded photo', async () => {
    const r = await reportIncident(jsonReq({ type: 'ACCIDENT', description: 'Hit a pothole', photoUrl: '/uploads/rider-incidents/rp1/abc.jpg' }));
    expect(r.status).toBe(201);
    expect(created[0].photoUrl).toBe('/uploads/rider-incidents/rp1/abc.jpg');
  });
  it('rejects external or other-rider photo urls', async () => {
    for (const photoUrl of ['https://evil.example/x.jpg', '/uploads/rider-incidents/rp2/abc.jpg', '/uploads/rider-incidents/rp1/../rp2/a.jpg']) {
      expect((await reportIncident(jsonReq({ type: 'ACCIDENT', description: 'x', photoUrl }))).status).toBe(400);
    }
    expect(created).toHaveLength(0);
  });
});
