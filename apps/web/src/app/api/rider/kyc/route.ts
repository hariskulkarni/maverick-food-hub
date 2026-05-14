/**
 * /api/rider/kyc
 *
 *   GET  — list the rider's own KYC docs (masked numbers only) + status summary
 *   POST — multipart upload of a single KYC document; overwrites the existing
 *          row of the same type (per @@unique([riderId, type]))
 *
 * Multipart fields:
 *   type        — KycDocumentType
 *   number      — raw document number (validated + encrypted server-side)
 *   issuedOn    — ISO date, optional
 *   expiresOn   — ISO date, optional (must be future for license/insurance/RC)
 *   file        — Blob (jpg/png/webp/pdf, ≤ 8 MB)
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { storage } from '@/server/storage';
import { audit } from '@/server/audit';
import { notify } from '@/server/notifications';
import {
  encryptDocNumber,
  getStatusSummary,
  liveVerifyAndPersist,
  toPublicDoc,
  validateExpiry,
  validateForType,
  ALL_KYC_TYPES
} from '@/server/kyc';
import { log } from '@/server/log';
import { KycDocumentType } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}

async function resolveRider(userId: string) {
  return prisma.riderProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      user: { select: { name: true } }
    }
  });
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await resolveRider(session.user.id);
  if (!profile) return new Response('No rider profile', { status: 404 });

  const docs = await prisma.riderKycDocument.findMany({
    where: { riderId: profile.id },
    orderBy: { submittedAt: 'desc' }
  });
  const summary = await getStatusSummary(profile.id);
  return Response.json({
    documents: docs.map(toPublicDoc),
    summary
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await resolveRider(session.user.id);
  if (!profile) return new Response('No rider profile', { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('Expected multipart/form-data', { status: 400 });
  }

  const typeRaw = String(form.get('type') ?? '').trim();
  if (!ALL_KYC_TYPES.includes(typeRaw as KycDocumentType)) {
    return new Response('Invalid or missing document type', { status: 400 });
  }
  const type = typeRaw as KycDocumentType;

  const numberRaw = String(form.get('number') ?? '').trim();
  if (!numberRaw) return new Response('Document number is required', { status: 400 });

  const v = validateForType(type, numberRaw);
  if (!v.ok) return new Response(v.error, { status: 400 });

  const issuedOnStr = form.get('issuedOn');
  const expiresOnStr = form.get('expiresOn');
  const issuedOn = issuedOnStr ? new Date(String(issuedOnStr)) : null;
  const expiresOn = expiresOnStr ? new Date(String(expiresOnStr)) : null;
  if (issuedOn && Number.isNaN(issuedOn.getTime())) return new Response('Invalid issuedOn', { status: 400 });
  if (expiresOn && Number.isNaN(expiresOn.getTime())) return new Response('Invalid expiresOn', { status: 400 });

  // Expiry-on-future required for license/insurance/RC. Aadhaar/PAN are
  // effectively permanent — allow null/past for those.
  if (expiresOn && (type === 'DRIVING_LICENSE' || type === 'VEHICLE_INSURANCE' || type === 'VEHICLE_RC')) {
    const ev = validateExpiry(expiresOn);
    if (!ev.ok) return new Response(ev.error, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) return new Response('Missing file', { status: 400 });
  if (file.size > MAX_BYTES) return new Response('File too large (max 8 MB)', { status: 413 });
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) return new Response('Unsupported file type (jpg/png/webp/pdf only)', { status: 415 });

  const buf = Buffer.from(await file.arrayBuffer());
  const name = (file as File).name || `${type.toLowerCase()}.bin`;

  const { url } = await storage().put(
    { name, type: mime, data: buf },
    { folder: `rider-kyc/${profile.id}/${type}` }
  );

  const { numberEncrypted, numberLast4 } = encryptDocNumber(v.normalized);
  const ip = clientIp(req);

  // Look up any existing row so we know whether this is upload or replace, and
  // so the audit captures the before-state.
  const existing = await prisma.riderKycDocument.findUnique({
    where: { riderId_type: { riderId: profile.id, type } }
  });

  const saved = await prisma.riderKycDocument.upsert({
    where: { riderId_type: { riderId: profile.id, type } },
    create: {
      riderId: profile.id,
      type,
      status: 'PENDING',
      numberEncrypted,
      numberLast4,
      fileUrl: url,
      fileName: name,
      fileSize: buf.length,
      fileMimeType: mime,
      issuedOn,
      expiresOn,
      submittedAt: new Date(),
      uploadedFromIp: ip
    },
    update: {
      status: 'PENDING',
      numberEncrypted,
      numberLast4,
      fileUrl: url,
      fileName: name,
      fileSize: buf.length,
      fileMimeType: mime,
      issuedOn,
      expiresOn,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      uploadedFromIp: ip
    }
  });

  await audit(existing ? 'kyc.replace' : 'kyc.upload', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderKycDocument',
    entityId: saved.id,
    before: existing
      ? {
          status: existing.status,
          numberLast4: existing.numberLast4,
          fileUrl: existing.fileUrl,
          expiresOn: existing.expiresOn
        }
      : undefined,
    after: {
      type,
      status: saved.status,
      numberLast4,
      fileUrl: url,
      expiresOn,
      issuedOn
    },
    ipAddress: ip
  });

  // Notify super-admins: email + NotificationLog row (live-ops dashboard
  // listens on template: 'kyc.submitted').
  const admins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', email: { not: null } },
    select: { id: true, email: true }
  });
  for (const a of admins) {
    if (!a.email) continue;
    await notify.email({
      to: a.email,
      userId: a.id,
      template: 'kyc.submitted',
      subject: `New KYC submission: ${type}`,
      body: `Rider ${profile.id} submitted a ${type} document for review.`,
      meta: { riderId: profile.id, documentId: saved.id, type }
    }).catch(() => {});
  }
  // Always journal one canonical row keyed on the rider — independent of
  // whether admin email delivery actually fires — so the live-ops feed can
  // pick it up even in mock-notify mode.
  await prisma.notificationLog.create({
    data: {
      userId: profile.userId,
      channel: 'PUSH',
      to: 'super-admin-feed',
      subject: `KYC submitted: ${type}`,
      body: `Rider ${profile.id} submitted ${type} (doc ${saved.id})`,
      template: 'kyc.submitted',
      status: 'SENT',
      sentAt: new Date(),
      meta: { riderId: profile.id, documentId: saved.id, type }
    }
  }).catch(() => {});

  // Fire live verification for PAN / DL only — these have an authoritative
  // source (NSDL / Sarathi via Karza / Surepass). Insurance and RC stay
  // PENDING for human review because the photo on the certificate is what an
  // admin actually inspects (no public registry to query).
  //
  // Run after the row commits so a verifier failure can never roll back the
  // upload. `.catch(log.error)` keeps the request fast even if the network
  // call is in-flight when we return.
  if (type === 'PAN_CARD' || type === 'DRIVING_LICENSE') {
    liveVerifyAndPersist(saved.id, {
      type,
      rawNumber: v.normalized,
      fullName: profile.user?.name ?? undefined
    }).catch((err) => log.error({ err, documentId: saved.id, type }, 'kyc live verification failed'));
  }

  return Response.json({ document: toPublicDoc(saved) }, { status: existing ? 200 : 201 });
}
