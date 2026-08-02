/**
 * Notification dispatcher with pluggable adapters.
 *
 * Resolution order for any send():
 *   1. If `restaurantId` is passed, consult `IntegrationCredential` for that
 *      tenant (TWILIO_SMS / TWILIO_WHATSAPP / SMTP).
 *   2. Else, fall back to env (NOTIFIER_SMS=twilio, NOTIFIER_EMAIL=smtp, etc.).
 *   3. Else, mock — body is journaled to NotificationLog only.
 *
 * Every send is journaled in `NotificationLog`.
 */

import { prisma } from './db';
import { log } from './log';
import { getConfig } from './integrations';
import { sendMsg91 } from './notifications/msg91';
import { sendMetaWhatsApp } from './notifications/meta-whatsapp';
import { sendFast2Sms } from './notifications/fast2sms';
import { sendTwoFactor } from './notifications/twofactor';
import { sendTextlocal } from './notifications/textlocal';
import { sendZohoSmtp } from './notifications/smtp-zoho';
import { sendBrevoSmtp } from './notifications/smtp-brevo';

/**
 * Safe wrapper around getConfig. The new India-friendly provider keys
 * (MSG91/FAST2SMS/TEXTLOCAL/ZOHO_SMTP/BREVO_SMTP) may not yet exist in the
 * generated Prisma IntegrationProvider enum, in which case the underlying
 * findUnique will throw an enum-validation error. Treat any throw as "not
 * configured" so the dispatcher can fall through to env / mock without
 * killing the order pipeline.
 */
async function safeGetConfig(restaurantId: string, provider: string): Promise<Record<string, string> | null> {
  try {
    return await getConfig(restaurantId, provider as any);
  } catch (e) {
    log.warn({ err: (e as Error).message, provider }, 'integration config lookup failed; treating as missing');
    return null;
  }
}

export type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'PUSH';

interface SendArgs {
  to: string;
  body: string;
  subject?: string;
  template?: string;
  userId?: string | null;
  meta?: Record<string, unknown>;
  /** When provided, prefer this restaurant's integration credentials. */
  restaurantId?: string;
}

type SendResult = { ok: boolean; providerId?: string; error?: string };

// ─── adapters ───────────────────────────────────────────────────────────────
async function sendMock(channel: Channel, args: SendArgs): Promise<SendResult> {
  log.info({ channel, to: args.to, template: args.template, body: args.body, subject: args.subject }, '[notify mock]');
  return { ok: true, providerId: `mock_${Date.now()}` };
}

async function sendTwilioSms(cfg: { accountSid: string; authToken: string; fromNumber: string }, args: SendArgs): Promise<SendResult> {
  try {
    const { default: twilio } = await import('twilio').catch(() => ({ default: null as any }));
    if (!twilio) return sendMock('SMS', args);
    const client = (twilio as any)(cfg.accountSid, cfg.authToken);
    const m = await client.messages.create({ from: cfg.fromNumber, to: args.to, body: args.body });
    return { ok: true, providerId: m.sid };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function sendTwilioWhatsApp(cfg: { accountSid: string; authToken: string; whatsappFrom: string }, args: SendArgs): Promise<SendResult> {
  try {
    const { default: twilio } = await import('twilio').catch(() => ({ default: null as any }));
    if (!twilio) return sendMock('WHATSAPP', args);
    const client = (twilio as any)(cfg.accountSid, cfg.authToken);
    const m = await client.messages.create({
      from: cfg.whatsappFrom.startsWith('whatsapp:') ? cfg.whatsappFrom : `whatsapp:${cfg.whatsappFrom}`,
      to: args.to.startsWith('whatsapp:') ? args.to : `whatsapp:${args.to}`,
      body: args.body
    });
    return { ok: true, providerId: m.sid };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function sendSmtp(cfg: { host: string; port: string; username: string; password: string; fromEmail: string; secure?: string }, args: SendArgs): Promise<SendResult> {
  try {
    const { default: nodemailer } = await import('nodemailer').catch(() => ({ default: null as any }));
    if (!nodemailer) return sendMock('EMAIL', args);
    const transporter = (nodemailer as any).createTransport({
      host: cfg.host,
      port: Number(cfg.port),
      secure: cfg.secure === 'true' || Number(cfg.port) === 465,
      auth: { user: cfg.username, pass: cfg.password }
    });
    const info = await transporter.sendMail({
      from: cfg.fromEmail,
      to: args.to,
      subject: args.subject || 'Notification',
      text: args.body
    });
    return { ok: true, providerId: info.messageId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─── resolution ─────────────────────────────────────────────────────────────
async function sendOnChannel(channel: Channel, args: SendArgs): Promise<SendResult> {
  // 1. Per-restaurant integration credentials.
  //    SMS priority order: MSG91 → FAST2SMS → TEXTLOCAL → TWILIO_SMS.
  //    EMAIL priority order: ZOHO_SMTP → BREVO_SMTP → SMTP.
  if (args.restaurantId) {
    if (channel === 'SMS') {
      // 2Factor first — cheapest India SMS (~₹0.16). Per-tenant credentials
      // stored under the TWOFACTOR provider key. `safeGetConfig` swallows the
      // enum-validation error if TWOFACTOR isn't in the generated Prisma enum
      // yet (same pattern as the other India providers), so this is safe to
      // ship before the schema enum is updated.
      const tf = await safeGetConfig(args.restaurantId, 'TWOFACTOR');
      if (tf?.apiKey) {
        return sendTwoFactor({ apiKey: tf.apiKey, senderId: tf.senderId, templateName: tf.templateName }, args);
      }
      const msg91 = await safeGetConfig(args.restaurantId, 'MSG91');
      if (msg91?.authKey && msg91?.senderId) {
        return sendMsg91({ authKey: msg91.authKey, senderId: msg91.senderId, route: msg91.route, dltTemplateId: msg91.dltTemplateId }, args);
      }
      const f2s = await safeGetConfig(args.restaurantId, 'FAST2SMS');
      if (f2s?.apiKey) {
        return sendFast2Sms({ apiKey: f2s.apiKey, senderId: f2s.senderId, route: f2s.route, messageId: f2s.messageId }, args);
      }
      const tl = await safeGetConfig(args.restaurantId, 'TEXTLOCAL');
      if (tl?.apiKey && tl?.senderId) {
        return sendTextlocal({ apiKey: tl.apiKey, senderId: tl.senderId }, args);
      }
      const twilio = await safeGetConfig(args.restaurantId, 'TWILIO_SMS');
      if (twilio?.accountSid && twilio?.authToken && twilio?.fromNumber) return sendTwilioSms(twilio as any, args);
    }
    if (channel === 'WHATSAPP') {
      // WhatsApp priority: Meta Cloud API (canonical WhatsApp Business API) →
      // Twilio WhatsApp.
      const meta = await safeGetConfig(args.restaurantId, 'META_WHATSAPP');
      if (meta?.phoneNumberId && meta?.accessToken) {
        return sendMetaWhatsApp({
          phoneNumberId: meta.phoneNumberId,
          accessToken: meta.accessToken,
          templateName: meta.templateName,
          templateLang: meta.templateLang,
          apiVersion: meta.apiVersion,
          copyCodeButton: meta.copyCodeButton,
        }, args);
      }
      const cfg = await safeGetConfig(args.restaurantId, 'TWILIO_WHATSAPP');
      if (cfg?.accountSid && cfg?.authToken && cfg?.whatsappFrom) return sendTwilioWhatsApp(cfg as any, args);
    }
    if (channel === 'EMAIL') {
      const zoho = await safeGetConfig(args.restaurantId, 'ZOHO_SMTP');
      if (zoho?.username && zoho?.password && zoho?.fromEmail) {
        return sendZohoSmtp(zoho as any, args);
      }
      const brevo = await safeGetConfig(args.restaurantId, 'BREVO_SMTP');
      if (brevo?.username && brevo?.password && brevo?.fromEmail) {
        return sendBrevoSmtp(brevo as any, args);
      }
      const smtp = await safeGetConfig(args.restaurantId, 'SMTP');
      if (smtp?.host && smtp?.username && smtp?.password) return sendSmtp(smtp as any, args);
    }
  }

  // 2. Env fallback (legacy paths + new India-friendly env routes)
  if (channel === 'SMS') {
    const provider = process.env.NOTIFIER_SMS || process.env.SMS_PROVIDER;
    if (provider === '2factor' && process.env.TWOFACTOR_API_KEY) {
      return sendTwoFactor({
        apiKey: process.env.TWOFACTOR_API_KEY!,
        senderId: process.env.TWOFACTOR_SENDER_ID,
        templateName: process.env.TWOFACTOR_TEMPLATE_NAME
      }, args);
    }
    if (provider === 'msg91' && process.env.MSG91_AUTH_KEY) {
      return sendMsg91({
        authKey: process.env.MSG91_AUTH_KEY!,
        senderId: process.env.MSG91_SENDER_ID!,
        route: process.env.MSG91_ROUTE,
        dltTemplateId: process.env.MSG91_DLT_TEMPLATE_ID
      }, args);
    }
    if (provider === 'fast2sms' && process.env.FAST2SMS_API_KEY) {
      return sendFast2Sms({
        apiKey: process.env.FAST2SMS_API_KEY!,
        senderId: process.env.FAST2SMS_SENDER_ID,
        route: process.env.FAST2SMS_ROUTE,
        messageId: process.env.FAST2SMS_MESSAGE_ID
      }, args);
    }
    if (provider === 'textlocal' && process.env.TEXTLOCAL_API_KEY) {
      return sendTextlocal({
        apiKey: process.env.TEXTLOCAL_API_KEY!,
        senderId: process.env.TEXTLOCAL_SENDER_ID!
      }, args);
    }
    if (provider === 'twilio' && process.env.TWILIO_ACCOUNT_SID) {
      return sendTwilioSms({ accountSid: process.env.TWILIO_ACCOUNT_SID!, authToken: process.env.TWILIO_AUTH_TOKEN!, fromNumber: process.env.TWILIO_FROM! }, args);
    }
  }
  if (channel === 'WHATSAPP') {
    const wa = (process.env.NOTIFIER_WHATSAPP || '').toLowerCase();
    if ((wa === 'meta' || wa === 'meta_whatsapp' || wa === 'whatsapp_cloud') && process.env.META_WHATSAPP_ACCESS_TOKEN) {
      return sendMetaWhatsApp({
        phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID!,
        accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN!,
        templateName: process.env.META_WHATSAPP_TEMPLATE_NAME,
        templateLang: process.env.META_WHATSAPP_TEMPLATE_LANG,
        apiVersion: process.env.META_WHATSAPP_API_VERSION,
        copyCodeButton: process.env.META_WHATSAPP_COPY_CODE_BUTTON,
      }, args);
    }
    if (wa === 'twilio_whatsapp' && process.env.TWILIO_ACCOUNT_SID) {
      return sendTwilioWhatsApp({ accountSid: process.env.TWILIO_ACCOUNT_SID!, authToken: process.env.TWILIO_AUTH_TOKEN!, whatsappFrom: process.env.TWILIO_WHATSAPP_FROM! }, args);
    }
  }
  if (channel === 'EMAIL') {
    const provider = process.env.NOTIFIER_EMAIL || process.env.EMAIL_PROVIDER;
    if (provider === 'zoho_smtp' && process.env.SMTP_USER) {
      return sendZohoSmtp({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        username: process.env.SMTP_USER!,
        password: process.env.SMTP_PASS!,
        fromEmail: process.env.SMTP_FROM!,
        secure: process.env.SMTP_SECURE
      }, args);
    }
    if (provider === 'brevo_smtp' && process.env.SMTP_USER) {
      return sendBrevoSmtp({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        username: process.env.SMTP_USER!,
        password: process.env.SMTP_PASS!,
        fromEmail: process.env.SMTP_FROM!,
        secure: process.env.SMTP_SECURE
      }, args);
    }
    if ((provider === 'smtp' || !provider) && process.env.SMTP_HOST) {
      return sendSmtp({
        host: process.env.SMTP_HOST!,
        port: process.env.SMTP_PORT || '587',
        username: process.env.SMTP_USER!,
        password: process.env.SMTP_PASS!,
        fromEmail: process.env.SMTP_FROM!,
        secure: process.env.SMTP_SECURE || 'false'
      }, args);
    }
  }

  // 3. Mock
  return sendMock(channel, args);
}

async function dispatch(channel: Channel, args: SendArgs) {
  let result: SendResult;
  try {
    result = await sendOnChannel(channel, args);
  } catch (e) {
    // Provider misfires must never break the calling code path (order placement,
    // status transitions, etc). Journal the failure and return ok:false.
    log.error({ err: (e as Error).message, channel, to: args.to, template: args.template }, 'notify dispatcher threw');
    result = { ok: false, error: (e as Error).message };
  }
  await prisma.notificationLog.create({
    data: {
      userId: args.userId ?? null,
      channel,
      to: args.to,
      subject: args.subject,
      body: args.body,
      template: args.template,
      meta: args.meta as any,
      status: result.ok ? 'SENT' : 'FAILED',
      error: result.error,
      sentAt: result.ok ? new Date() : null
    }
  }).catch((e) => log.error({ err: e }, 'failed to journal notification'));
  return result;
}

export const notify = {
  sms:      (a: SendArgs) => dispatch('SMS', a),
  whatsapp: (a: SendArgs) => dispatch('WHATSAPP', a),
  email:    (a: SendArgs) => dispatch('EMAIL', a)
};
