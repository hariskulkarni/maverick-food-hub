/**
 * MSG91 SMS adapter — India-friendly transactional SMS provider.
 *
 * We use the simpler `sendhttp.php` endpoint for plain transactional sends.
 * If a `dltTemplateId` is supplied we forward it as the DLT_TE_ID query param,
 * which MSG91 requires for Indian DLT-registered templates.
 *
 * Docs: https://docs.msg91.com/sms/
 *
 * No external SDK — uses global fetch.
 */

export interface Msg91Config {
  authKey: string;
  senderId: string;
  /** MSG91 route: '4' = transactional, '1' = promotional. Default '4'. */
  route?: string;
  /** DLT template ID (mandatory for India transactional SMS). */
  dltTemplateId?: string;
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

/** Strip leading + and non-digits — MSG91 wants plain country-code + number. */
function normalizeNumber(to: string): string {
  return to.replace(/[^\d]/g, '');
}

export async function sendMsg91(cfg: Msg91Config, args: SendArgs): Promise<SendResult> {
  try {
    const params = new URLSearchParams({
      authkey: cfg.authKey,
      mobiles: normalizeNumber(args.to),
      message: args.body,
      sender: cfg.senderId,
      route: cfg.route || '4',
      country: '91',
      response: 'json'
    });
    if (cfg.dltTemplateId) params.set('DLT_TE_ID', cfg.dltTemplateId);

    const res = await fetch(`https://api.msg91.com/api/sendhttp.php?${params.toString()}`, {
      method: 'GET'
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `MSG91 HTTP ${res.status}: ${text.slice(0, 200)}` };

    // MSG91 sendhttp.php returns a plain request-id string on success, or an
    // error message starting with "ERROR" or containing "fail".
    const trimmed = text.trim();
    if (/^(error|fail)/i.test(trimmed) || trimmed.length === 0) {
      return { ok: false, error: trimmed || 'Empty response' };
    }
    return { ok: true, providerId: trimmed };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Account balance check — used by the integration test() path. */
export async function checkMsg91Balance(cfg: Msg91Config): Promise<SendResult & { balance?: string }> {
  try {
    const res = await fetch(
      `https://api.msg91.com/api/balance.php?authkey=${encodeURIComponent(cfg.authKey)}&type=${cfg.route || '4'}`,
      { method: 'GET' }
    );
    const text = (await res.text()).trim();
    if (!res.ok) return { ok: false, error: `MSG91 HTTP ${res.status}: ${text.slice(0, 200)}` };
    // Returns balance as a number string, or an error message
    if (/^\d+(\.\d+)?$/.test(text)) return { ok: true, balance: text };
    return { ok: false, error: text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
