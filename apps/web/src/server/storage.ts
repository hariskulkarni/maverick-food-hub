/**
 * Pluggable file storage. Dev: writes to /public/uploads. Prod: S3.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

export interface StorageDriver {
  put(file: { name: string; type: string; data: Buffer }, opts?: { folder?: string }): Promise<{ url: string; key: string }>;
}

class LocalStorage implements StorageDriver {
  async put(file: { name: string; type: string; data: Buffer }, opts: { folder?: string } = {}) {
    const folder = opts.folder ?? 'uploads';
    const ext = path.extname(file.name) || '.bin';
    const key = `${folder}/${Date.now()}-${nanoid(8)}${ext}`;
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
    const ext = path.extname(file.name) || '.bin';
    const key = `${opts.folder ?? 'uploads'}/${Date.now()}-${nanoid(8)}${ext}`;
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
