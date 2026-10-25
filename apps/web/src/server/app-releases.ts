/**
 * Native app releases (rider app today) — publish, activate, roll back, serve.
 *
 *   - Super-admin uploads an APK (streamed to PRIVATE storage, size/type/magic
 *     validated, SHA-256 computed server-side) or registers an external URL.
 *   - Exactly one release per (app, platform, channel) is active.
 *   - /download/rider-app streams the active stable Android APK (counted);
 *     /api/app/rider/latest answers the app's update check.
 */
import 'server-only';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs, createWriteStream } from 'node:fs';
import { nanoid } from 'nanoid';
import type { AppRelease } from '@prisma/client';
import { prisma } from './db';
import { privateUploadsRoot, storage } from './storage';

export const APK_MIME = 'application/vnd.android.package-archive';
export const MAX_APK_BYTES = 200 * 1024 * 1024; // 200 MB
export const RIDER_APP = 'rider';

export type ReleasePlatform = 'ANDROID' | 'IOS';
export type ReleaseChannel = 'STABLE' | 'BETA';

export function parsePlatform(v: string | null | undefined): ReleasePlatform | null {
  const k = (v ?? 'android').toUpperCase();
  return k === 'ANDROID' || k === 'IOS' ? k : null;
}
export function parseChannel(v: string | null | undefined): ReleaseChannel | null {
  const k = (v ?? 'stable').toUpperCase();
  return k === 'STABLE' || k === 'BETA' ? k : null;
}

export function publicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in').replace(/\/+$/, '');
}

/** Path of the public download route for a platform/channel. */
export function downloadPath(platform: ReleasePlatform, channel: ReleaseChannel): string {
  const q = new URLSearchParams();
  if (platform !== 'ANDROID') q.set('platform', platform.toLowerCase());
  if (channel !== 'STABLE') q.set('channel', channel.toLowerCase());
  const qs = q.toString();
  return `/download/rider-app${qs ? `?${qs}` : ''}`;
}

export async function getActiveRelease(platform: ReleasePlatform, channel: ReleaseChannel = 'STABLE', app = RIDER_APP) {
  return prisma.appRelease.findFirst({
    where: { app, platform, channel, isActive: true },
    orderBy: { versionCode: 'desc' },
  });
}

export interface PublicReleaseDto {
  id: string;
  platform: ReleasePlatform;
  channel: ReleaseChannel;
  versionName: string;
  versionCode: number;
  minSupportedVersionCode: number;
  fileSize: number | null;
  sha256: string | null;
  releaseNotes: string | null;
  publishedAt: string;
  /** Absolute URL of our counted download route (streams the file or redirects). */
  downloadUrl: string;
  /** Optional store listing (Play Store / App Store). */
  storeUrl: string | null;
  /** True when the download is an APK file we host (vs an external link). */
  hostedFile: boolean;
}

export function toPublicDto(r: AppRelease): PublicReleaseDto {
  const platform = r.platform as ReleasePlatform;
  const channel = r.channel as ReleaseChannel;
  return {
    id: r.id,
    platform,
    channel,
    versionName: r.versionName,
    versionCode: r.versionCode,
    minSupportedVersionCode: r.minSupportedVersionCode,
    fileSize: r.fileSize,
    sha256: r.sha256,
    releaseNotes: r.releaseNotes,
    publishedAt: r.publishedAt.toISOString(),
    downloadUrl: `${publicBaseUrl()}${downloadPath(platform, channel)}`,
    storeUrl: r.storeUrl,
    hostedFile: !!r.fileRef,
  };
}

/** Admin DTO — everything except the private storage ref. */
export function toAdminDto(r: AppRelease) {
  return {
    ...toPublicDto(r),
    app: r.app,
    fileName: r.fileName,
    externalUrl: r.downloadUrl,
    isActive: r.isActive,
    downloadCount: r.downloadCount,
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Update-check answer for a running build. */
export function updateStatus(
  currentVersionCode: number | null,
  latest: { versionCode: number; minSupportedVersionCode: number } | null,
): { updateAvailable: boolean; updateRequired: boolean } {
  if (!latest || currentVersionCode == null || !Number.isFinite(currentVersionCode)) {
    return { updateAvailable: false, updateRequired: false };
  }
  return {
    updateAvailable: latest.versionCode > currentVersionCode,
    updateRequired: currentVersionCode < latest.minSupportedVersionCode,
  };
}

// ─── Activation / rollback ──────────────────────────────────────────────────

export class ReleaseError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Make `id` the single active release of its (app, platform, channel). */
export async function activateRelease(id: string): Promise<{ release: AppRelease; previous: AppRelease | null }> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.appRelease.findUnique({ where: { id } });
    if (!target) throw new ReleaseError('Release not found.', 404);
    const scope = { app: target.app, platform: target.platform, channel: target.channel, isActive: true, NOT: { id } };
    const previous = await tx.appRelease.findFirst({ where: scope });
    await tx.appRelease.updateMany({ where: scope, data: { isActive: false } });
    const release = await tx.appRelease.update({ where: { id }, data: { isActive: true } });
    return { release, previous };
  });
}

export async function deactivateRelease(id: string): Promise<AppRelease> {
  const r = await prisma.appRelease.findUnique({ where: { id } });
  if (!r) throw new ReleaseError('Release not found.', 404);
  return prisma.appRelease.update({ where: { id }, data: { isActive: false } });
}

/**
 * Roll back: re-activate the newest release with a LOWER versionCode than the
 * currently active one (same app/platform/channel).
 */
export async function rollbackRelease(platform: ReleasePlatform, channel: ReleaseChannel, app = RIDER_APP) {
  const current = await getActiveRelease(platform, channel, app);
  if (!current) throw new ReleaseError('There is no active release to roll back from.', 409);
  const prior = await prisma.appRelease.findFirst({
    where: { app, platform, channel, versionCode: { lt: current.versionCode } },
    orderBy: { versionCode: 'desc' },
  });
  if (!prior) throw new ReleaseError('There is no earlier release to roll back to.', 409);
  const { release } = await activateRelease(prior.id);
  return { release, from: current };
}

// ─── Upload (streamed to private storage) ──────────────────────────────────

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // APKs are ZIP archives

/**
 * Stream an APK request body to private storage, enforcing the size cap and
 * the ZIP magic bytes while computing SHA-256 on the fly. Never buffers the
 * whole file for the local driver.
 */
export async function storeApkStream(
  body: ReadableStream<Uint8Array>,
  fileName: string,
): Promise<{ ref: string; sha256: string; size: number }> {
  const useS3 = process.env.STORAGE_DRIVER === 's3';
  const key = `app-releases/${Date.now()}-${nanoid(8)}.apk`;
  const finalPath = useS3 ? path.join(os.tmpdir(), `flavrly-apk-${nanoid(10)}.apk`) : path.join(privateUploadsRoot(), key);
  const partPath = `${finalPath}.part`;
  await fs.mkdir(path.dirname(finalPath), { recursive: true });

  const hash = crypto.createHash('sha256');
  const out = createWriteStream(partPath, { mode: 0o600 });
  let size = 0;
  let head = Buffer.alloc(0);
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > MAX_APK_BYTES) throw new ReleaseError('The APK is larger than 200 MB.', 413);
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (head.length < 4) {
        head = Buffer.concat([head, chunk.subarray(0, 4 - head.length)]);
        if (head.length >= 4 && !head.equals(ZIP_MAGIC)) throw new ReleaseError('That file is not a valid APK.', 415);
      }
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((res) => out.once('drain', () => res()));
    }
    if (size < 4 || !head.equals(ZIP_MAGIC)) throw new ReleaseError('That file is not a valid APK.', 415);
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
  } catch (e) {
    await reader.cancel().catch(() => {});
    out.destroy();
    await fs.unlink(partPath).catch(() => {});
    throw e;
  }
  const sha256 = hash.digest('hex');
  await fs.rename(partPath, finalPath);

  if (!useS3) return { ref: `private:${key}`, sha256, size };
  // S3: push the finished temp file to the private bucket prefix, then drop it.
  try {
    const data = await fs.readFile(finalPath);
    const { ref } = await storage().putPrivate({ name: fileName, type: APK_MIME, data }, { folder: 'app-releases' });
    return { ref, sha256, size };
  } finally {
    await fs.unlink(finalPath).catch(() => {});
  }
}

// ─── Signed upload tokens (upload step → publish step) ─────────────────────

function uploadKey(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is required');
  return crypto.createHmac('sha256', s).update('flavrly:app-release-upload:v1').digest('hex');
}

export interface UploadClaims {
  ref: string;
  sha256: string;
  size: number;
  fileName: string;
  uid: string;
  exp: number;
}

export function signUploadToken(c: Omit<UploadClaims, 'exp'>, ttlSeconds = 6 * 60 * 60): string {
  const payload = Buffer.from(JSON.stringify({ ...c, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const sig = crypto.createHmac('sha256', uploadKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyUploadToken(token: string, uid: string): UploadClaims | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', uploadKey()).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadClaims;
    if (c.uid !== uid || typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof c.ref !== 'string' || !c.ref.startsWith('private:')) return null;
    return c;
  } catch {
    return null;
  }
}

/** Safe download filename: flavrly-rider-<versionName>.apk */
export function downloadFileName(r: Pick<AppRelease, 'versionName'>): string {
  const v = r.versionName.replace(/[^0-9A-Za-z._-]/g, '').slice(0, 40) || 'latest';
  return `flavrly-rider-${v}.apk`;
}

/** "84.3 MB" */
export function formatBytes(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Download card data (rider-app page, portal, help) ──────────────────────

/** Legacy pre-AppRelease APK path some deployments still serve from /public. */
export const LEGACY_APK_PATH = '/downloads/flavrly-rider.apk';

export interface RiderAppDownloadInfo {
  android: PublicReleaseDto | null;
  ios: PublicReleaseDto | null;
  /** Only when no Android release is published but the legacy file is on disk. */
  legacy: { url: string; fileSize: number } | null;
}

export async function getRiderAppDownloadInfo(): Promise<RiderAppDownloadInfo> {
  const [android, ios] = await Promise.all([
    getActiveRelease('ANDROID', 'STABLE').catch(() => null),
    getActiveRelease('IOS', 'STABLE').catch(() => null),
  ]);
  let legacy: RiderAppDownloadInfo['legacy'] = null;
  if (!android) {
    const st = await fs.stat(path.join(process.cwd(), 'public', LEGACY_APK_PATH)).catch(() => null);
    if (st?.isFile()) legacy = { url: LEGACY_APK_PATH, fileSize: st.size };
  }
  return { android: android ? toPublicDto(android) : null, ios: ios ? toPublicDto(ios) : null, legacy };
}
