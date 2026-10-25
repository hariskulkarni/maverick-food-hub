/**
 * Delivery of a single review ask / reminder over SMS, WhatsApp or email.
 *
 * SMS + email go through the shared `notify` dispatcher (journaled to
 * NotificationLog). WhatsApp does NOT: the shared Meta adapter turns any
 * configured template into an OTP-style send, which would be wrong here. Review
 * asks need their own approved *Utility* template, so we call the Cloud API
 * directly with the restaurant's review template and journal the result.
 *
 * Expected WhatsApp Utility template body parameters, in order:
 *   {{1}} restaurant name, {{2}} order code, {{3}} rating link, {{4}} STOP link.
 */
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { notify } from '@/server/notifications';
import { getConfig } from '@/server/integrations';
import { buildAskMessage, trackedLink, stopLink, type AcquisitionConfig, type SendChannel } from './acquisition';

type Result = { ok: boolean; error?: string };

interface MetaCreds { phoneNumberId: string; accessToken: string; apiVersion?: string }

async function metaCreds(restaurantId: string): Promise<MetaCreds | null> {
  const cfg = await getConfig(restaurantId, 'META_WHATSAPP').catch(() => null);
  if (cfg?.phoneNumberId && cfg?.accessToken) return { phoneNumberId: cfg.phoneNumberId, accessToken: cfg.accessToken, apiVersion: cfg.apiVersion };
  if (process.env.META_WHATSAPP_PHONE_NUMBER_ID && process.env.META_WHATSAPP_ACCESS_TOKEN) {
    return {
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
      accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN,
      apiVersion: process.env.META_WHATSAPP_API_VERSION,
    };
  }
  return null;
}

export async function whatsappCredsConfigured(restaurantId: string): Promise<boolean> {
  return !!(await metaCreds(restaurantId));
}

/** WhatsApp is usable only with an approved review template AND Cloud API credentials. */
export async function whatsappReady(restaurantId: string, cfg: Pick<AcquisitionConfig, 'whatsappTemplateName'>): Promise<boolean> {
  if (!cfg.whatsappTemplateName) return false;
  return !!(await metaCreds(restaurantId));
}

async function sendWhatsAppTemplate(a: {
  restaurantId: string;
  to: string;
  userId: string | null;
  template: string;
  lang: string;
  params: string[];
  journalBody: string;
}): Promise<Result> {
  const creds = await metaCreds(a.restaurantId);
  let result: Result;
  if (!creds) {
    result = { ok: false, error: 'WhatsApp Cloud API not configured' };
  } else {
    try {
      const url = `https://graph.facebook.com/${creds.apiVersion?.trim() || 'v21.0'}/${encodeURIComponent(creds.phoneNumberId)}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: a.to.replace(/[^\d]/g, ''),
          type: 'template',
          template: {
            name: a.template,
            language: { code: a.lang },
            components: [{ type: 'body', parameters: a.params.map((text) => ({ type: 'text', text })) }],
          },
        }),
      });
      const body = await res.text();
      result = res.ok ? { ok: true } : { ok: false, error: `Meta WhatsApp HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
  }
  await prisma.notificationLog
    .create({
      data: {
        userId: a.userId,
        channel: 'WHATSAPP',
        to: a.to,
        body: a.journalBody,
        template: 'review.request',
        status: result.ok ? 'SENT' : 'FAILED',
        error: result.error,
        sentAt: result.ok ? new Date() : null,
      },
    })
    .catch((e) => log.error({ err: (e as Error).message }, 'review whatsapp journal failed'));
  return result;
}

export async function sendReviewAsk(a: {
  kind: 'ask' | 'reminder';
  channel: SendChannel;
  token: string;
  restaurantId: string;
  restaurantName: string;
  orderCode: string;
  customer: { id: string; phone: string | null; email: string | null };
  cfg: Pick<AcquisitionConfig, 'whatsappTemplateName' | 'whatsappTemplateLang'>;
}): Promise<Result> {
  const link = trackedLink(a.token);
  const stop = stopLink(a.token);
  const msg = buildAskMessage({ kind: a.kind, restaurantName: a.restaurantName, orderCode: a.orderCode, link, stop });
  const template = a.kind === 'reminder' ? 'review.request.reminder' : 'review.request';
  const meta = { orderCode: a.orderCode, kind: a.kind };
  try {
    if (a.channel === 'SMS' && a.customer.phone) {
      return await notify.sms({ to: a.customer.phone, body: msg.sms, template, userId: a.customer.id, restaurantId: a.restaurantId, meta });
    }
    if (a.channel === 'EMAIL' && a.customer.email) {
      return await notify.email({
        to: a.customer.email, subject: msg.subject, body: msg.text, html: msg.html,
        template, userId: a.customer.id, restaurantId: a.restaurantId, meta,
      });
    }
    if (a.channel === 'WHATSAPP' && a.customer.phone && a.cfg.whatsappTemplateName) {
      return await sendWhatsAppTemplate({
        restaurantId: a.restaurantId,
        to: a.customer.phone,
        userId: a.customer.id,
        template: a.cfg.whatsappTemplateName,
        lang: a.cfg.whatsappTemplateLang || 'en',
        params: [a.restaurantName, a.orderCode, link, stop],
        journalBody: msg.sms,
      });
    }
    return { ok: false, error: `no ${a.channel} contact` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
