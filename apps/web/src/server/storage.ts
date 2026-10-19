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
const SAFE_UPLOAD_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov']);
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
}

export function storage(): StorageDriver {
  return process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
}
