/**
 * Discovery-page CMS — platform-wide content for `/restaurants`.
 *   GET   — current parsed config.
 *   PATCH — { config } → validate, persist, revalidate the discovery page.
 *
 * Guarded by requireSuperAdmin(). Validation is total (parseDiscoveryConfig
 * never throws and always returns a complete object), so a malformed payload
 * is sanitised rather than rejected. Responses are no-store.
 */

import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { getDiscoveryConfig, saveDiscoveryConfig } from '@/server/discovery-cms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const config = await getDiscoveryConfig();
  return Response.json({ config }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
  }
  const incoming = body?.config ?? body;

  const config = await saveDiscoveryConfig(incoming, session.user.id);
  await audit('platform.discovery_cms.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'SiteContent',
    entityId: 'discovery',
  });

  revalidatePath('/restaurants');
  return Response.json({ config }, { headers: NO_STORE });
}
