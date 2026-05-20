/**
 * 2Factor.in adapter — cheapest India SMS/OTP gateway (~₹0.16/SMS, no monthly fee).
 *
 * 2Factor is purpose-built for OTP. Its simplest, most reliable endpoint lets
 * you send YOUR OWN otp value through a DLT-approved template:
 *
 *   GET https://2factor.in/API/V1/{apiKey}/SMS/{phone}/{otpValue}/{templateName}
 *
 * Our app already generates its own OTP codes (server/otp.ts) and passes a full
 * message `body` to notify.sms(). So this adapter:
 *   1. Pulls the numeric code out of the body (the OTP).
 *   2. Sends it via 2Factor's OTP-template endpoint when a templateName is set
 *      and a code is present (the OTP path — the dominant use case).
 *   3. Falls back to 2Factor's transactional bulk endpoint (TSMS) for non-OTP
 *      messages (order notifications etc.), which also needs a DLT template.
 *
 * INDIA DLT NOTE: All transactional/OTP SMS in India must use a DLT-registered
 * template + header (TRAI mandate) — this is true of EVERY provider, not a
 * 2Factor quirk. You register a template in your 2Factor dashboard (they help
 * with DLT onboarding), then put its name in TWOFACTOR_TEMPLATE_NAME. Until a
 * template is approved, use the demo console mode (OTP_DEBUG_LOG=true).
 *
 * No external SDK — uses global fetch.
 */

export interface TwoFactorConfig {
  apiKey: string;
  /** DLT-registered sender/header, e.g. "RESHEE". Optional for the OTP endpoint. */
  senderId?: string;
  /** DLT-approved template name created in the 2Factor dashboard. */
  templateName?: string;
}

interface SendArgs {
  to: string;
  body: string;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

/** 2Factor wants a plain 10-digit number OR +91-prefixed; we normalise to 10-digit. */
function normalizeNumber(to: string): string {
  const digits = to.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** Pull the first 4-8 digit run out of a message body — that's the OTP. */
function extractOtp(body: string): string | null {
  const m = body.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

export async function sendTwoFactor(cfg: TwoFactorConfig, args: SendArgs): Promise<SendResult> {
  try {
    const phone = normalizeNumber(args.to);
    const otp = extractOtp(args.body);

    // ── OTP path (preferred) — send our own code through the named template ──
    if (otp && cfg.templateName) {
      const url =
        `https://2factor.in/API/V1/${encodeURIComponent(cfg.apiKey)}` +
        `/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(otp)}/${encodeURIComponent(cfg.templateName)}`;
      const res = await fetch(url, { method: 'GET' });
      const json = (await res.json().catch(() => ({}))) as any;
      // 2Factor returns { Status: "Success" | "Error", Details: "<session-id or message>" }
      if (!res.ok || String(json?.Status).toLowerCase() !== 'success') {
        return { ok: false, error: json?.Details || `2Factor HTTP ${res.status}` };
      }
      return { ok: true, providerId: json?.Details ? String(json.Details) : undefined };
    }

    // ── Transactional bulk path (non-OTP messages, or no template configured) ──
    // POST .../ADDON_SERVICES/SEND/TSMS with From + To + Msg (+ TemplateName for DLT).
    const form = new URLSearchParams();
    form.set('To', phone);
    form.set('Msg', args.body);
    if (cfg.senderId) form.set('From', cfg.senderId);
    if (cfg.templateName) form.set('TemplateName', cfg.templateName);
    const url = `https://2factor.in/API/V1/${encodeURIComponent(cfg.apiKey)}/ADDON_SERVICES/SEND/TSMS`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || String(json?.Status).toLowerCase() !== 'success') {
      return { ok: false, error: json?.Details || `2Factor HTTP ${res.status}` };
    }
    return { ok: true, providerId: json?.Details ? String(json.Details) : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Check remaining 2Factor balance — handy for an admin "SMS credits" widget. */
export async function checkTwoFactorBalance(cfg: TwoFactorConfig): Promise<{ ok: boolean; balance?: string; error?: string }> {
  try {
    const url = `https://2factor.in/API/V1/${encodeURIComponent(cfg.apiKey)}/ADDON_SERVICES/BAL/TRANSACTIONAL_SMS`;
    const res = await fetch(url, { method: 'GET' });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || String(json?.Status).toLowerCase() !== 'success') {
      return { ok: false, error: json?.Details || `HTTP ${res.status}` };
    }
    const bal = Array.isArray(json?.Details) ? String(json.Details[0]) : String(json?.Details ?? '');
    return { ok: true, balance: bal };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
