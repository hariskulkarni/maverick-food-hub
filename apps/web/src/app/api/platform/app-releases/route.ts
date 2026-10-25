/**
 * /api/platform/app-releases — super-admin only.
 *
 * GET  → every rider app release, newest first (admin DTOs, no storage refs).
 * POST → publish a release. Either `uploadToken` (from POST ./upload, which
 *        already streamed the APK to private storage and computed SHA-256
 *        server-side) or an external `downloadUrl` / `storeUrl` (https only).
 *        `activate: true` makes it the live release for its platform/channel.
 * Audited: app_release.publish (+ app_release.activate).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { audit } from '@/server/audit';
import { RIDER_APP, activateRelease, toAdminDto, verifyUploadToken } from '@/server/app-releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => u.startsWith('https://'), 'must be an https:// URL');

const Body = z
  .object({
    platform: z.enum(['ANDROID', 'IOS']),
    channel: z.enum(['STABLE', 'BETA']).default('STABLE'),
    versionName: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z._+-]+$/, 'letters, digits, . _ + - only'),
    versionCode: z.number().int().min(1).max(2_100_000_000),
    minSupportedVersionCode: z.number().int().min(0).max(2_100_000_000).default(0),
    releaseNotes: z.string().trim().max(4000).optional().nullable(),
    uploadToken: z.string().max(4000).optional().nullable(),
    downloadUrl: httpsUrl.optional().nullable(),
    storeUrl: httpsUrl.optional().nullable(),
    sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, 'must be 64 hex characters').optional().nullable(),
    fileSize: z.number().int().min(1).max(2_000_000_000).optional().nullable(),
    activate: z.boolean().default(false),
  })
  .refine((b) => !!(b.uploadToken || b.downloadUrl || b.storeUrl), {
    message: 'Upload an APK or provide a download / store URL.',
    path: ['uploadToken'],
  })
  .refine((b) => b.minSupportedVersionCode <= b.versionCode, {
    message: 'Minimum supported version code cannot be higher than this release.',
    path: ['minSupportedVersionCode'],
  });

export async function GET() {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const rows = await prisma.appRelease.findMany({
    where: { app: RIDER_APP },
    orderBy: [{ platform: 'asc' }, { channel: 'asc' }, { versionCode: 'desc' }],
    take: 200,
  });
  return Response.json({ releases: rows.map(toAdminDto) });
}

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const actorId = gate.user.id;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const b = parsed;

  let file: { fileRef: string; fileName: string; sha256: string; fileSize: number } | null = null;
  if (b.uploadToken) {
    if (b.platform !== 'ANDROID') return Response.json({ error: 'APK uploads are Android-only.' }, { status: 400 });
    const claims = verifyUploadToken(b.uploadToken, actorId);
    if (!claims) return Response.json({ error: 'The upload has expired or is invalid — upload the APK again.' }, { status: 400 });
    file = { fileRef: claims.ref, fileName: claims.fileName, sha256: claims.sha256, fileSize: claims.size };
  }

  try {
    const created = await prisma.appRelease.create({
      data: {
        app: RIDER_APP,
        platform: b.platform,
        channel: b.channel,
        versionName: b.versionName,
        versionCode: b.versionCode,
        minSupportedVersionCode: b.minSupportedVersionCode,
        releaseNotes: b.releaseNotes || null,
        fileRef: file?.fileRef ?? null,
        fileName: file?.fileName ?? null,
        sha256: file?.sha256 ?? (b.sha256 ? b.sha256.toLowerCase() : null),
        fileSize: file?.fileSize ?? b.fileSize ?? null,
        downloadUrl: file ? null : b.downloadUrl || null,
        storeUrl: b.storeUrl || null,
        createdById: actorId,
      },
    });
    await audit('app_release.publish', {
      actorId,
      actorRole: 'SUPER_ADMIN',
      entityType: 'AppRelease',
      entityId: created.id,
      after: {
        platform: created.platform,
        channel: created.channel,
        versionName: created.versionName,
        versionCode: created.versionCode,
        sha256: created.sha256,
        source: file ? 'upload' : 'external',
      },
    });
    let release = created;
    if (b.activate) {
      const r = await activateRelease(created.id);
      release = r.release;
      await audit('app_release.activate', {
        actorId,
        actorRole: 'SUPER_ADMIN',
        entityType: 'AppRelease',
        entityId: created.id,
        before: r.previous ? { activeReleaseId: r.previous.id, versionCode: r.previous.versionCode } : null,
        after: { activeReleaseId: created.id, versionCode: created.versionCode },
      });
    }
    return Response.json({ release: toAdminDto(release) }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return Response.json({ error: `Version code ${b.versionCode} is already published on this platform/channel.` }, { status: 409 });
    }
    throw e;
  }
}
