/**
 * Textlocal adapter — India-friendly SMS provider.
 *
 * Docs: https://api.textlocal.in/docs/
 *
 * No external SDK — uses global fetch.
 */

export interface TextlocalConfig {
  apiKey: string;
  senderId: string;
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

/** Textlocal accepts comma-separated numbers in international (no +) form. */
function normalizeNumber(to: string): string {
  const digits = to.replace(/[^\d]/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export async function sendTextlocal(cfg: TextlocalConfig, args: SendArgs): Promise<SendResult> {
  try {
    const params = new URLSearchParams({
      apikey: cfg.apiKey,
      numbers: normalizeNumber(args.to),
      message: args.body,
      sender: cfg.senderId
    });
    const res = await fetch('https://api.textlocal.in/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.status !== 'success') {
      const err = Array.isArray(json?.errors) && json.errors[0]?.message
        ? json.errors[0].message
        : json?.status || `Textlocal HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    return { ok: true, providerId: json?.batch_id ? String(json.batch_id) : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function checkTextlocalBalance(cfg: TextlocalConfig): Promise<{ ok: boolean; balance?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://api.textlocal.in/balance/?apikey=${encodeURIComponent(cfg.apiKey)}`,
      { method: 'GET' }
    );
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.status !== 'success') {
      return { ok: false, error: json?.errors?.[0]?.message || `HTTP ${res.status}` };
    }
    const sms = json?.balance?.sms;
    return { ok: true, balance: sms != null ? String(sms) : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
