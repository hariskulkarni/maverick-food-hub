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

/**
 * Verify a widget access-token. Returns the phone taken ONLY from the
 * MSG91-verified response.
 *
 * H23: previously the phone was read from the widget JWT payload (which is
 * parsed, never signature-checked, so attacker-controlled) and fell back to the
 * client-supplied `claimedPhone`. An attacker could complete the widget with
 * their own number then call signIn('msg91-widget', { accessToken, phone:
 * '<victim>' }) and be logged in as the victim. The phone now comes solely from
 * MSG91's verify response; `claimedPhone` is at most a cross-check that must
 * equal the verified phone, and we fail closed otherwise.
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
  // H26: canonical credential is MSG91_AUTH_KEY; fall back to the legacy
  // MSG91_AUTHKEY so an existing deploy on the old name keeps working.
  const authkey = process.env.MSG91_AUTH_KEY ?? process.env.MSG91_AUTHKEY;
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
    let data: { type?: string; message?: string; mobile?: string; identifier?: string } | null = null;
    try { data = rawText ? (JSON.parse(rawText) as typeof data) : null; } catch { data = null; }
    const ok = res.ok && data?.type === 'success';
    console.warn(
      `[msg91-widget] verify status=${res.status} ok=${ok} type=${data?.type ?? 'n/a'} ` +
      `msg=${String(data?.message ?? rawText).slice(0, 160)} tokenLen=${token.length}`,
    );
    if (!ok) return { ok: false, phone: null };
    // H23: phone comes ONLY from MSG91's verified response. For verifyAccessToken
    // the mobile is returned as `mobile`/`identifier`, or as `message` when that
    // is itself a bare number. Never the token payload, never claimedPhone.
    const msg = String(data?.message ?? '').trim();
    const fromResponse = data?.mobile ?? data?.identifier ?? (/^\+?\d{6,}$/.test(msg) ? msg : null);
    const verified = normalizePhone(fromResponse);
    if (!verified) {
      console.warn('[msg91-widget] verified token but no phone in response body — refusing');
      return { ok: false, phone: null };
    }
    // If the client sent a phone, it must equal the verified one (mismatch = takeover attempt).
    if (claimedPhone && normalizePhone(claimedPhone) !== verified) {
      console.warn('[msg91-widget] claimedPhone does not match the verified phone — refusing');
      return { ok: false, phone: null };
    }
    return { ok: true, phone: verified };
  } catch (e) {
    console.warn(`[msg91-widget] verify error: ${(e as Error)?.message || String(e)}`);
    return { ok: false, phone: null };
  }
}
