/**
 * Fast2SMS adapter — India-friendly SMS provider.
 *
 * Uses the bulkV2 endpoint with the "q" (quick) route by default.
 *
 * Docs: https://docs.fast2sms.com/
 *
 * No external SDK — uses global fetch.
 */

export interface Fast2SmsConfig {
  apiKey: string;
  /** Optional sender ID (only used on DLT route). */
  senderId?: string;
  /** Route: 'q' = quick/promotional, 'dlt' = DLT transactional. Default 'q'. */
  route?: string;
  /** DLT message ID — required for route=dlt. */
  messageId?: string;
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

/** Fast2SMS wants comma-separated 10-digit numbers (no +91 prefix). */
function normalizeNumber(to: string): string {
  const digits = to.replace(/[^\d]/g, '');
  // Drop leading country code if present
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export async function sendFast2Sms(cfg: Fast2SmsConfig, args: SendArgs): Promise<SendResult> {
  try {
    const body: Record<string, string> = {
      message: args.body,
      language: 'english',
      route: cfg.route || 'q',
      numbers: normalizeNumber(args.to)
    };
    if (cfg.senderId) body.sender_id = cfg.senderId;
    if (cfg.messageId) body.message_id = cfg.messageId;

    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': cfg.apiKey,
        'cache-control': 'no-cache'
      },
      body: JSON.stringify(body)
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.return === false) {
      return { ok: false, error: json?.message || `Fast2SMS HTTP ${res.status}` };
    }
    const providerId = Array.isArray(json?.request_id)
      ? String(json.request_id[0])
      : json?.request_id
        ? String(json.request_id)
        : undefined;
    return { ok: true, providerId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function checkFast2SmsBalance(cfg: Fast2SmsConfig): Promise<{ ok: boolean; wallet?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://www.fast2sms.com/dev/wallet?authorization=${encodeURIComponent(cfg.apiKey)}`,
      { method: 'GET' }
    );
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.return === false) return { ok: false, error: json?.message || `HTTP ${res.status}` };
    return { ok: true, wallet: String(json?.wallet ?? '') };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
