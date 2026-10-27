/**
 * POST /api/telephony/exotel/status?cl=<callLogId>&sig=<hmac>
 *
 * Exotel StatusCallback for masked rider → customer calls.
 * Docs: https://developer.exotel.com/docs/voice-v1/api-reference/status-callback
 *
 * Authenticity: Exotel documents no callback signature, so:
 *   1. the URL we gave Exotel carries `sig` = HMAC-SHA256(callLogId) with a
 *      server-only key (exotel.ts → callbackSignature); verified in constant time;
 *   2. optional source-IP allow-list (EXOTEL_CALLBACK_IP_ALLOWLIST);
 *   3. the payload's CallSid must match the SID stored on that CallLog row.
 * Failures answer 401/403 and are counted (webhook_sig/exotel); nothing is applied.
 *
 * Exotel retries up to 2× on non-2xx and expects a 200 within 15s; processing
 * is a single row update, idempotent across duplicate deliveries. The body may
 * be JSON (we request StatusCallbackContentType=application/json) or form data.
 * Phone numbers in the payload (From/To) are ignored and never stored.
 */
import { NextRequest } from 'next/server';
import { clientIp } from '@/server/http/client-ip';
import { log } from '@/server/log';
import { recordWebhookSignatureFailure } from '@/server/observability/hooks';
import { callbackIpAllowed, parseStatusCallback, verifyCallbackSignature } from '@/server/telephony/exotel';
import { applyCallStatusEvent } from '@/server/telephony/masked-call';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  try {
    if (type.includes('application/json')) {
      const j = await req.json();
      return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
    }
    const form = await req.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
    // Form encodings flatten Legs; JSON-in-a-field is the only nested shape we accept.
    if (typeof out.Legs === 'string') {
      try {
        out.Legs = JSON.parse(out.Legs as string);
      } catch {
        delete out.Legs;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const callLogId = req.nextUrl.searchParams.get('cl') ?? '';
  const sig = req.nextUrl.searchParams.get('sig');

  if (!callbackIpAllowed(clientIp(req.headers))) {
    recordWebhookSignatureFailure('exotel', 'ip');
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!/^[a-z0-9]{10,40}$/i.test(callLogId) || !verifyCallbackSignature(callLogId, sig)) {
    recordWebhookSignatureFailure('exotel', 'token');
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const ev = parseStatusCallback(await readBody(req));
  const r = await applyCallStatusEvent(callLogId, ev);
  if (!r.applied && r.reason === 'sid_mismatch') {
    recordWebhookSignatureFailure('exotel', 'sid_mismatch');
    log.warn({ callLogId, source: 'exotel-status' }, 'exotel status callback CallSid mismatch');
  }
  // 200 for every authenticated delivery (incl. stale / unknown) so Exotel stops retrying.
  return Response.json({ ok: true, applied: r.applied });
}
