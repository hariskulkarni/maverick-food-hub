/**
 * Pluggable file storage. Dev: writes to /public/uploads. Prod: S3.
 *
 * URL layout: every uploaded file is keyed `uploads/<folder>/<file>` so the
 * resulting URL is ALWAYS `/uploads/<folder>/<file>`. This:
 *   • lands files inside the already-gitignored `public/uploads/` directory
 *     (so deploys never clean them out and they never get accidentally
 *     committed by a `git add .`),
 *   • can never collide with any current or future App Router route, since no
 *     `/uploads/*` route exists,
 *   • is a single, predictable static-asset namespace the middleware can
 *     exempt from the demo gate.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

export interface StorageDriver {
  put(file: { name: string; type: string; data: Buffer }, opts?: { folder?: string }): Promise<{ url: string; key: string }>;
  /**
   * Store a file that must NOT be publicly reachable (KYC documents). Returns
   * an opaque `private:<key>` reference to persist; serve it only through an
   * authenticated route via `getPrivate`.
   */
  putPrivate(file: { name: string; type: string; data: Buffer }, opts?: { folder?: string }): Promise<{ ref: string; key: string }>;
  getPrivate(ref: string): Promise<Buffer | null>;
}

/** Root for private files on local disk — outside public/, never served by nginx. */
export function privateUploadsRoot(): string {
  return process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), 'private-uploads');
}

const PRIVATE_PREFIX = 'private:';

export function isPrivateRef(ref: string): boolean {
  return ref.startsWith(PRIVATE_PREFIX);
}

/** Resolve a private ref to its key, refusing traversal. */
function privateKey(ref: string): string | null {
  if (!isPrivateRef(ref)) return null;
  const key = ref.slice(PRIVATE_PREFIX.length);
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) return null;
  return key;
}

/** Build the storage key. ALWAYS prefixed with `uploads/` to land under the
 *  gitignored public/uploads/ tree (matches the .gitignore rule and keeps the
 *  static-asset URL namespace single-rooted). Trims any duplicate `uploads/`
 *  prefix a caller may have already added. */
// H5: the stored extension used to come verbatim from the attacker-controlled
// filename, so `evil.html` was written to disk and nginx (which serves /uploads
// from disk by extension, bypassing the app's CSP/nosniff) returned it as
// text/html → stored XSS on the app origin against staff. Whitelist the stored
// extension to known-safe media types; anything else (.html, .svg, .php, …)
// collapses to .bin so it can never be served as an executable/renderable doc.
// .pdf is inert (no script execution from a nosniff/attachment response) and is
// needed so KYC PDFs keep their type instead of downloading as .bin (P1-14).
const SAFE_UPLOAD_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.pdf']);
export function buildKey(name: string, folder: string | undefined): string {
  const raw = path.extname(name).toLowerCase();
  const ext = SAFE_UPLOAD_EXT.has(raw) ? (raw === '.jpeg' ? '.jpg' : raw) : '.bin';
  const sub = (folder ?? 'misc').replace(/^uploads\/?/, '').replace(/^\/+|\/+$/g, '') || 'misc';
  return `uploads/${sub}/${Date.now()}-${nanoid(8)}${ext}`;
}

class LocalStorage implements StorageDriver {
  async put(file: { name: string; type: string; data: Buffer }, opts: { folder?: string } = {}) {
    const key = buildKey(file.name, opts.folder);
    const root = path.join(process.cwd(), 'public');
    const full = path.join(root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.data);
    return { url: `/${key}`, key };
  }

  async putPrivate(file: { name: string; type: string; data: Buffer }, opts: { folder?: string } = {}) {
    const key = buildKey(file.name, opts.folder).replace(/^uploads\//, '');
    const full = path.join(privateUploadsRoot(), key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.data, { mode: 0o600 });
    return { ref: `${PRIVATE_PREFIX}${key}`, key };
  }

  async getPrivate(ref: string) {
    const key = privateKey(ref);
    if (!key) return null;
    return fs.readFile(path.join(privateUploadsRoot(), key)).catch(() => null);
  }
}

class S3Storage implements StorageDriver {
  async put(file: { name: string; type: string; data: Buffer }, opts: { folder?: string } = {}) {
    // @ts-expect-error optional dependency — installed only when STORAGE_DRIVER=s3.
    // webpackIgnore keeps `next build` from trying to resolve/bundle the SDK when
    // it isn't installed (local-storage deployments). The .catch() below handles
    // the runtime case where STORAGE_DRIVER=s3 but the package is genuinely missing.
    const { S3Client, PutObjectCommand } = await import(/* webpackIgnore: true */ '@aws-sdk/client-s3').catch(() => ({ S3Client: null, PutObjectCommand: null }) as any);
    if (!S3Client) throw new Error('@aws-sdk/client-s3 not installed; run npm i @aws-sdk/client-s3 or set STORAGE_DRIVER=local');
    const client = new S3Client({
      region: process.env.S3_REGION!,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! }
    });
    const key = buildKey(file.name, opts.folder);
    await client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: file.data,
      ContentType: file.type
    }));
    const url = `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
    return { url, key };
  }

  private async client() {
    // @ts-expect-error optional dependency — see put().
    const mod = await import(/* webpackIgnore: true */ '@aws-sdk/client-s3').catch(() => null as any);
    if (!mod?.S3Client) throw new Error('@aws-sdk/client-s3 not installed; run npm i @aws-sdk/client-s3 or set STORAGE_DRIVER=local');
    const client = new mod.S3Client({
      region: process.env.S3_REGION!,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! }
    });
    return { client, mod };
  }

  async putPrivate(file: { name: string; type: string; data: Buffer }, opts: { folder?: string } = {}) {
    // Private objects live under `private/` and are written with an explicit
    // private ACL; they are only ever read server-side (getPrivate).
    const key = `private/${buildKey(file.name, opts.folder).replace(/^uploads\//, '')}`;
    const { client, mod } = await this.client();
    await client.send(new mod.PutObjectCommand({
      Bucket: process.env.S3_BUCKET!, Key: key, Body: file.data, ContentType: file.type, ACL: 'private'
    }));
    return { ref: `${PRIVATE_PREFIX}${key}`, key };
  }

  async getPrivate(ref: string) {
    const key = privateKey(ref);
    if (!key) return null;
    try {
      const { client, mod } = await this.client();
      const out = await client.send(new mod.GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      const bytes = await out.Body?.transformToByteArray?.();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
}

export function storage(): StorageDriver {
  return process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
}

/**
 * Open a private file for STREAMING (large downloads such as rider APKs, where
 * buffering 200 MB per request via getPrivate would be wasteful). Local driver:
 * a file stream from the private uploads root. S3: the object body stream.
 * Returns null when the ref is invalid or the object is missing.
 */
export async function openPrivateStream(ref: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const key = privateKey(ref);
  if (!key) return null;
  if (process.env.STORAGE_DRIVER === 's3') {
    try {
      // @ts-expect-error optional dependency — see S3Storage.put().
      const mod = await import(/* webpackIgnore: true */ '@aws-sdk/client-s3').catch(() => null as any);
      if (!mod?.S3Client) return null;
      const client = new mod.S3Client({
        region: process.env.S3_REGION!,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! }
      });
      const out = await client.send(new mod.GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      const stream = out.Body?.transformToWebStream?.();
      if (!stream || typeof out.ContentLength !== 'number') return null;
      return { stream, size: out.ContentLength };
    } catch {
      return null;
    }
  }
  const full = path.join(privateUploadsRoot(), key);
  try {
    const st = await fs.stat(full);
    if (!st.isFile()) return null;
    const { createReadStream } = await import('node:fs');
    const { Readable } = await import('node:stream');
    const stream = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream<Uint8Array>;
    return { stream, size: st.size };
  } catch {
    return null;
  }
}
