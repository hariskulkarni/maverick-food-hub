/**
 * GET /api/rider/kyc/[id]/file — stream a KYC document (P1-14).
 *
 * Access: a valid short-lived signature (`?exp&sig`, minted in toPublicDoc),
 * OR the owning rider's session, OR a SUPER_ADMIN session. Never cached by
 * shared caches. Legacy S3 rows (absolute public URLs) redirect.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { readKycFile, verifyKycFileSig } from '@/server/kyc-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INLINE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.riderKycDocument.findUnique({
    where: { id },
    select: { id: true, fileUrl: true, fileMimeType: true, fileName: true, rider: { select: { userId: true } } }
  });
  if (!doc) return new Response('Not found', { status: 404 });

  const sp = req.nextUrl.searchParams;
  let allowed = verifyKycFileSig(doc.id, sp.get('exp'), sp.get('sig'));
  if (!allowed) {
    const session = await auth();
    allowed =
      !!session &&
      ((session.user.role === 'RIDER' && session.user.id === doc.rider.userId) || session.user.role === 'SUPER_ADMIN');
  }
  if (!allowed) return new Response('Forbidden', { status: 403 });

  if (/^https:\/\//i.test(doc.fileUrl)) return Response.redirect(doc.fileUrl, 302);

  const data = await readKycFile(doc.fileUrl);
  if (!data) return new Response('File not found', { status: 404 });
  const type = doc.fileMimeType && INLINE_TYPES.has(doc.fileMimeType) ? doc.fileMimeType : 'application/octet-stream';
  const safeName = (doc.fileName ?? 'document').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    }
  });
}
