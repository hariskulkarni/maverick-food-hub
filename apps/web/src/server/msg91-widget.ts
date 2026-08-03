/**
 * MSG91 OTP Widget — server-side verification.
 *
 * Model: the browser widget (SecureOTPWidgetJOG7) sends the OTP across
 * SMS/WhatsApp/Voice/Email and, once the user enters the correct code, hands the
 * frontend a signed JWT "access-token". Our server confirms that token with
 * MSG91 and derives the verified phone from it — the client's claimed phone is
 * never trusted on its own.
 *
 * Enabled only when the widget env is present, so the app safely falls back to
 * the built-in OTP flow until you configure it.
 *   NEXT_PUBLIC_MSG91_WIDGET_ID     — widget id (public, used by the browser SDK)
 *   NEXT_PUBLIC_MSG91_WIDGET_TOKEN  — widget tokenAuth (public, used by the SDK)
 *   MSG91_AUTHKEY                   — account AuthKey (SECRET, server-only)
 */
const VERIFY_URL = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';

export function msg91WidgetEnabled(): boolean {
  return !!(process.env.NEXT_PUBLIC_MSG91_WIDGET_ID && process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN);
}

/** Normalise to +<countrycode><number>. Bare 10-digit numbers get +91. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.length === 10) d = '91' + d;
  return '+' + d;
}

/** Best-effort read of the verified identifier from the widget JWT payload. */
function identifierFromToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const p = JSON.parse(json) as Record<string, unknown>;
    for (const k of ['identifier', 'mobile', 'phone', 'number', 'mobileNumber', 'sub']) {
      const v = p[k];
      if (typeof v === 'string' && /\d{6,}/.test(v)) return v;
    }
  } catch { /* not a decodable JWT */ }
  return null;
}

/**
 * Verify a widget access-token. Returns the verified phone (from the token) on
 * success. `claimedPhone` is only used as a fallback if the token carries no
 * decodable identifier, and even then only after MSG91 confirms the token.
 *
 * MSG91's verifyAccessToken expects the AuthKey in the request HEADER; some SDK
 * builds also read it from the body. We send both to be robust, and log the
 * exact response (status + type + message, never the token/authkey) so a failed
 * verify is diagnosable from the server logs.
 */
export async function verifyWidgetAccessToken(
  token: string,
  claimedPhone?: string | null
): Promise<{ ok: boolean; phone: string | null }> {
  const authkey = process.env.MSG91_AUTHKEY;
  if (!authkey || !token) {
    console.warn(`[msg91-widget] verify skipped: authkey=${authkey ? 'set' : 'MISSING'} tokenLen=${token ? token.length : 0}`);
    return { ok: false, phone: null };
  }
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey },
      body: JSON.stringify({ authkey, 'access-token': token }),
    });
    const rawText = await res.text().catch(() => '');
    let data: { type?: string; message?: string } | null = null;
    try { data = rawText ? (JSON.parse(rawText) as { type?: string; message?: string }) : null; } catch { data = null; }
    const ok = res.ok && data?.type === 'success';
    console.warn(
      `[msg91-widget] verify status=${res.status} ok=${ok} type=${data?.type ?? 'n/a'} ` +
      `msg=${String(data?.message ?? rawText).slice(0, 160)} tokenLen=${token.length}`,
    );
    if (!ok) return { ok: false, phone: null };
    const phone = normalizePhone(identifierFromToken(token)) ?? normalizePhone(claimedPhone);
    return { ok: true, phone };
  } catch (e) {
    console.warn(`[msg91-widget] verify error: ${(e as Error)?.message || String(e)}`);
    return { ok: false, phone: null };
  }
}
