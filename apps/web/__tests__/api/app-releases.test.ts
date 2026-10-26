/**
 * Rider app releases — publish / activate / rollback (super-admin only, audited),
 * the public update check, the counted APK download and version comparison.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

type Row = Record<string, any>;
const m = vi.hoisted(() => ({
  rows: [] as Row[],
  session: null as null | { user: { id: string; role: string } },
  audits: [] as { action: string; opts: any }[],
  seq: 0,
}));

function match(r: Row, where: Row = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'NOT') { if (match(r, v)) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lt' in v && !(r[k] < v.lt)) return false;
      continue;
    }
    if (r[k] !== v) return false;
  }
  return true;
}
function order(rows: Row[], orderBy: any): Row[] {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of list) {
      const [k, dir] = Object.entries(o)[0] as [string, string];
      if (a[k] === b[k]) continue;
      return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

vi.mock('@/server/db', () => {
  const appRelease = {
    findFirst: async ({ where, orderBy }: any) => order(m.rows.filter((r) => match(r, where)), orderBy)[0] ?? null,
    findUnique: async ({ where }: any) => m.rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, orderBy }: any) => order(m.rows.filter((r) => match(r, where)), orderBy),
    updateMany: async ({ where, data }: any) => {
      const hit = m.rows.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }: any) => {
      const r = m.rows.find((x) => x.id === where.id)!;
      if (data.downloadCount?.increment) r.downloadCount += data.downloadCount.increment;
      else Object.assign(r, data);
      return r;
    },
    create: async ({ data }: any) => {
      if (m.rows.some((r) => r.app === data.app && r.platform === data.platform && r.channel === data.channel && r.versionCode === data.versionCode)) {
        const { Prisma } = await import('@prisma/client');
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
      }
      const now = new Date();
      const r = { id: `rel${++m.seq}`, isActive: false, downloadCount: 0, publishedAt: now, createdAt: now, updatedAt: now, fileRef: null, fileName: null, downloadUrl: null, storeUrl: null, sha256: null, fileSize: null, releaseNotes: null, minSupportedVersionCode: 0, ...data };
      m.rows.push(r);
      return r;
    },
  };
  const prisma: any = { appRelease };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma };
});
vi.mock('@/server/auth', () => ({ auth: async () => m.session }));
vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { m.audits.push({ action, opts }); } }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('server-only', () => ({}));

import { NextRequest } from 'next/server';
import { GET as listReleases, POST as publish } from '@/app/api/platform/app-releases/route';
import { POST as activate } from '@/app/api/platform/app-releases/[id]/activate/route';
import { POST as deactivate } from '@/app/api/platform/app-releases/[id]/deactivate/route';
import { POST as rollback } from '@/app/api/platform/app-releases/rollback/route';
import { POST as upload } from '@/app/api/platform/app-releases/upload/route';
import { GET as latest } from '@/app/api/app/rider/latest/route';
import { GET as download } from '@/app/download/rider-app/route';
import { updateStatus, signUploadToken, MAX_APK_BYTES } from '@/server/app-releases';

const SUPER = { user: { id: 'sa1', role: 'SUPER_ADMIN' } };
const json = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://portal.flavrly.in${p}`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'portal.flavrly.in', ...headers }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const base = { platform: 'ANDROID', channel: 'STABLE', versionName: '1.0.0', versionCode: 1, downloadUrl: 'https://expo.dev/artifacts/eas/abc.apk' };

let privDir = '';
beforeEach(async () => {
  m.rows = []; m.audits = []; m.seq = 0; m.session = SUPER;
  process.env.NEXTAUTH_SECRET = 'unit-test-nextauth-secret-0123456789abcdef';
  privDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flavrly-rel-'));
  process.env.PRIVATE_UPLOADS_DIR = privDir;
  delete process.env.STORAGE_DRIVER;
});

describe('version comparison (update check)', () => {
  it('flags newer builds and builds below the minimum supported', () => {
    const rel = { versionCode: 12, minSupportedVersionCode: 10 };
    expect(updateStatus(12, rel)).toEqual({ updateAvailable: false, updateRequired: false });
    expect(updateStatus(11, rel)).toEqual({ updateAvailable: true, updateRequired: false });
    expect(updateStatus(9, rel)).toEqual({ updateAvailable: true, updateRequired: true });
    expect(updateStatus(13, rel)).toEqual({ updateAvailable: false, updateRequired: false });
    expect(updateStatus(null, rel)).toEqual({ updateAvailable: false, updateRequired: false });
    expect(updateStatus(5, null)).toEqual({ updateAvailable: false, updateRequired: false });
  });
});

describe('publishing is super-admin only', () => {
  it.each([null, { user: { id: 'g', role: 'ADMIN_ASSIST' } }, { user: { id: 'r', role: 'RIDER' } }])('rejects %o', async (s) => {
    m.session = s as any;
    expect((await publish(json('/api/platform/app-releases', base))).status).toBeGreaterThanOrEqual(401);
    expect((await listReleases()).status).toBeGreaterThanOrEqual(401);
    expect((await activate(new Request('https://x'), params('rel1'))).status).toBeGreaterThanOrEqual(401);
    expect((await rollback(json('/api/platform/app-releases/rollback', { platform: 'ANDROID', channel: 'STABLE' }))).status).toBeGreaterThanOrEqual(401);
    expect(m.rows).toHaveLength(0);
  });
});

describe('publish / activate / rollback', () => {
  it('publishes an external-URL release (https only) and audits it', async () => {
    expect((await publish(json('/api/platform/app-releases', { ...base, downloadUrl: 'http://insecure.example/a.apk' }))).status).toBe(400);
    expect((await publish(json('/api/platform/app-releases', { ...base, downloadUrl: undefined }))).status).toBe(400);
    const res = await publish(json('/api/platform/app-releases', { ...base, activate: true }));
    expect(res.status).toBe(201);
    const { release } = await res.json();
    expect(release).toMatchObject({ versionCode: 1, isActive: true, hostedFile: false });
    expect(release.fileRef).toBeUndefined();
    expect(m.audits.map((a) => a.action)).toEqual(['app_release.publish', 'app_release.activate']);
    expect((await publish(json('/api/platform/app-releases', base))).status).toBe(409);
  });

  it('keeps exactly one active release per platform/channel and rolls back to the previous one', async () => {
    for (const v of [1, 2, 3]) await publish(json('/api/platform/app-releases', { ...base, versionCode: v, versionName: `1.0.${v}`, activate: true }));
    const active = () => m.rows.filter((r) => r.isActive).map((r) => r.versionCode);
    expect(active()).toEqual([3]);
    const rb = await rollback(json('/api/platform/app-releases/rollback', { platform: 'ANDROID', channel: 'STABLE' }));
    expect(rb.status).toBe(200);
    expect(active()).toEqual([2]);
    expect(m.audits.at(-1)).toMatchObject({ action: 'app_release.rollback', opts: { before: { versionCode: 3 }, after: { versionCode: 2 } } });
    // Re-activate v3 explicitly, then deactivate it.
    expect((await activate(new Request('https://x'), params('rel3'))).status).toBe(200);
    expect(active()).toEqual([3]);
    expect((await deactivate(new Request('https://x'), params('rel3'))).status).toBe(200);
    expect(active()).toEqual([]);
    expect((await rollback(json('/api/platform/app-releases/rollback', { platform: 'ANDROID', channel: 'STABLE' }))).status).toBe(409);
  });

  it('rejects a min supported version above the release and a forged upload token', async () => {
    expect((await publish(json('/api/platform/app-releases', { ...base, minSupportedVersionCode: 5 }))).status).toBe(400);
    const forged = signUploadToken({ ref: 'private:app-releases/x.apk', sha256: 'a'.repeat(64), size: 10, fileName: 'x.apk', uid: 'someone-else' });
    const res = await publish(json('/api/platform/app-releases', { ...base, downloadUrl: undefined, uploadToken: forged }));
    expect(res.status).toBe(400);
  });
});

function apkBytes(n = 4096): Buffer {
  const b = crypto.randomBytes(n);
  b[0] = 0x50; b[1] = 0x4b; b[2] = 0x03; b[3] = 0x04;
  return b;
}
const apkReq = (body: Buffer, headers: Record<string, string> = {}) =>
  new NextRequest('https://portal.flavrly.in/api/platform/app-releases/upload', {
    method: 'POST',
    headers: { host: 'portal.flavrly.in', origin: 'https://portal.flavrly.in', 'content-type': 'application/vnd.android.package-archive', 'x-file-name': 'rider.apk', ...headers },
    body: new Uint8Array(body),
  });

describe('APK upload → publish → download', () => {
  it('validates type, name, size and magic bytes', async () => {
    expect((await upload(apkReq(apkBytes(), { 'content-type': 'application/zip' }))).status).toBe(415);
    expect((await upload(apkReq(apkBytes(), { 'x-file-name': 'rider.exe' }))).status).toBe(415);
    expect((await upload(apkReq(apkBytes(), { 'content-length': String(MAX_APK_BYTES + 1) }))).status).toBe(413);
    expect((await upload(apkReq(Buffer.from('<html>not an apk</html>')))).status).toBe(415);
    expect((await upload(apkReq(apkBytes(), { origin: 'https://evil.example' }))).status).toBe(403);
    m.session = { user: { id: 'k', role: 'KITCHEN' } };
    expect((await upload(apkReq(apkBytes()))).status).toBe(403);
  });

  it('streams to private storage with a server-side SHA-256, then serves it with download headers + count', async () => {
    const bytes = apkBytes(64 * 1024);
    const up = await upload(apkReq(bytes));
    expect(up.status).toBe(200);
    const u = await up.json();
    expect(u.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(u.fileSize).toBe(bytes.length);
    // The file sits under the PRIVATE root, not public/.
    const files = await fs.readdir(path.join(privDir, 'app-releases'));
    expect(files.filter((f) => f.endsWith('.apk'))).toHaveLength(1);

    const pub = await publish(json('/api/platform/app-releases', { ...base, downloadUrl: undefined, uploadToken: u.uploadToken, versionName: '1.2.0', versionCode: 7, minSupportedVersionCode: 5, activate: true }));
    expect(pub.status).toBe(201);
    expect((await pub.json()).release).toMatchObject({ sha256: u.sha256, fileSize: bytes.length, hostedFile: true });

    const dl = await download(new NextRequest('https://flavrly.in/download/rider-app'));
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(dl.headers.get('content-disposition')).toBe('attachment; filename="flavrly-rider-1.2.0.apk"');
    expect(dl.headers.get('content-length')).toBe(String(bytes.length));
    expect(dl.headers.get('x-checksum-sha256')).toBe(u.sha256);
    expect(Buffer.from(await dl.arrayBuffer()).equals(bytes)).toBe(true);
    expect(m.rows[0].downloadCount).toBe(1);

    const lt = await latest(new NextRequest('https://flavrly.in/api/app/rider/latest?platform=android&versionCode=4'));
    const body = await lt.json();
    expect(body).toMatchObject({ updateAvailable: true, updateRequired: true, latest: { versionCode: 7, versionName: '1.2.0', sha256: u.sha256 } });
    expect(body.latest.downloadUrl).toMatch(/\/download\/rider-app$/);
    expect(JSON.stringify(body)).not.toContain('private:');
  });

  it('redirects to an external URL (counted) and to the install page when nothing is active', async () => {
    const none = await download(new NextRequest('https://flavrly.in/download/rider-app'));
    expect(none.status).toBe(302);
    expect(none.headers.get('location')).toContain('/rider-app?download=unavailable');
    await publish(json('/api/platform/app-releases', { ...base, activate: true }));
    const ext = await download(new NextRequest('https://flavrly.in/download/rider-app'));
    expect(ext.status).toBe(302);
    expect(ext.headers.get('location')).toBe(base.downloadUrl);
    expect(m.rows[0].downloadCount).toBe(1);
    expect((await latest(new NextRequest('https://flavrly.in/api/app/rider/latest?platform=windows'))).status).toBe(400);
    const beta = await (await latest(new NextRequest('https://flavrly.in/api/app/rider/latest?channel=beta&versionCode=1'))).json();
    expect(beta).toEqual({ latest: null, updateAvailable: false, updateRequired: false });
  });
});
