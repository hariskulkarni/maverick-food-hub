/**
 * Meta WhatsApp Cloud API adapter — the canonical WhatsApp Business API.
 *
 * Business-initiated WhatsApp messages (like an OTP) must use a pre-approved
 * *template*. For OTP the correct template category is "Authentication", which
 * renders the code plus a one-tap copy-code button. So when a `templateName` is
 * configured we send a template message with the code as the body parameter
 * (and, by default, the copy-code button parameter that Authentication
 * templates require). With no template configured we fall back to a plain text
 * message — that only reaches users inside the 24-hour customer-initiated
 * window, so it's really only useful for testing.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * No SDK — global fetch against graph.facebook.com.
 */

export interface MetaWhatsAppConfig {
  /** WhatsApp phone number ID (from the Meta app → WhatsApp → API setup). */
  phoneNumberId: string;
  /** Permanent (system-user) access token. */
  accessToken: string;
  /** Approved template name to use for OTP. Omit → plain text (testing only). */
  templateName?: string;
  /** Template language code, e.g. 'en_US'. Default 'en_US'. */
  templateLang?: string;
  /** Graph API version, e.g. 'v21.0'. Default 'v21.0'. */
  apiVersion?: string;
  /**
   * Whether the template carries the Authentication copy-code button (which
   * Meta requires for Authentication-category templates). 'true' (default)
   * sends the button parameter; set 'false' for a plain body-only template.
   */
  copyCodeButton?: string;
}

interface SendArgs {
  to: string;
  body: string;
  meta?: Record<string, unknown>;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

/** Meta wants the number in E.164 digits (country code included), no '+'. */
function normalizeNumber(to: string): string {
  return to.replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');
}

/** Pull the OTP code: explicit meta.otpCode wins, else first 4–8 digit run. */
function resolveCode(args: SendArgs): string | null {
  const explicit = args.meta?.otpCode;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const m = args.body.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

export async function sendMetaWhatsApp(cfg: MetaWhatsAppConfig, args: SendArgs): Promise<SendResult> {
  try {
    const version = cfg.apiVersion?.trim() || 'v21.0';
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
    const to = normalizeNumber(args.to);

    let payload: Record<string, unknown>;
    if (cfg.templateName?.trim()) {
      const code = resolveCode(args);
      const components: Record<string, unknown>[] = [];
      if (code) {
        components.push({ type: 'body', parameters: [{ type: 'text', text: code }] });
        // Authentication-category templates require the copy-code button param.
        if ((cfg.copyCodeButton ?? 'true') !== 'false') {
          components.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          });
        }
      }
      payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: cfg.templateName.trim(),
          language: { code: cfg.templateLang?.trim() || 'en_US' },
          ...(components.length ? { components } : {}),
        },
      };
    } else {
      // Plain text — only delivers inside the 24h customer-initiated window.
      payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: args.body } };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

    if (!res.ok) {
      const errMsg = json?.error?.message || `HTTP ${res.status}: ${text.slice(0, 200)}`;
      return { ok: false, error: `Meta WhatsApp ${errMsg}` };
    }
    const id = json?.messages?.[0]?.id;
    return { ok: true, providerId: id ?? `meta_${Date.now()}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Credential health check for the integration test() path: read the WhatsApp
 * phone-number node. A 200 proves the token + phone number id are valid without
 * sending anything.
 */
export async function verifyMetaWhatsApp(
  cfg: MetaWhatsAppConfig
): Promise<SendResult & { displayName?: string; number?: string }> {
  try {
    const version = cfg.apiVersion?.trim() || 'v21.0';
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, displayName: json?.verified_name, number: json?.display_phone_number };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
