/**
 * POST /api/_demo-gate
 *   body: { email: string }
 *   → signs a 24h token, emails the visitor a `/_demo-gate/<token>` magic
 *     link. Same email send path the rest of the platform uses (configured
 *     via NOTIFIER_EMAIL + SMTP_* envs).
 *
 * Refuses to run when DEMO_MODE is off (no-op on prod).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { isDemoMode, siteUrl } from '@/lib/demo';
import { signDemoToken } from '@/server/demo-token';
import { notify } from '@/server/notifications';
import { log } from '@/server/log';
import { brand } from '@/lib/brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().email().max(200) });

export async function POST(req: NextRequest) {
  if (!isDemoMode()) {
    return new Response('Not found', { status: 404 });
  }

  let email: string;
  try {
    const parsed = Body.parse(await req.json());
    email = parsed.email.trim().toLowerCase();
  } catch {
    return Response.json({ error: 'Invalid email' }, { status: 400 });
  }

  const token = signDemoToken(email);
  const link = `${siteUrl()}/_demo-gate/${token}`;

  try {
    await notify.email({
      to: email,
      subject: `Your ${brand.name} demo access link`,
      body:
        `Hi,\n\n` +
        `Here's your access to the ${brand.name} demo. It's valid for 24 hours; click to enter:\n\n` +
        `${link}\n\n` +
        `If you didn't request this, you can ignore the email — no account was created.\n\n` +
        `— Team ${brand.name}`,
    });
  } catch (e) {
    log.error({ err: e }, 'demo gate: email send failed');
    // We deliberately tell the caller success even on email failure so we don't
    // leak which emails exist anywhere. If the email never arrives, the user
    // can retry. (Visit logs would catch repeat failures for an env-level
    // misconfiguration anyway.)
  }

  return Response.json({ ok: true });
}
