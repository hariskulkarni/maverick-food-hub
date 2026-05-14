/**
 * Integration provider registry.
 *
 * For each provider we define:
 *   - the editable fields (used to generate the wizard form)
 *   - which fields are secrets (masked + write-only in API responses)
 *   - a `test()` function that performs a real round-trip with the credentials
 *     (and never sends anything destructive — e.g. validates account, lists bucket).
 */

import { maskSecret } from '../crypto';
import { checkMsg91Balance, sendMsg91 } from '../notifications/msg91';
import { checkFast2SmsBalance, sendFast2Sms } from '../notifications/fast2sms';
import { checkTextlocalBalance, sendTextlocal } from '../notifications/textlocal';
import { verifyZohoSmtp } from '../notifications/smtp-zoho';
import { verifyBrevoSmtp } from '../notifications/smtp-brevo';

export type ProviderKey =
  | 'RAZORPAY'
  | 'TWILIO_SMS'
  | 'TWILIO_WHATSAPP'
  | 'SMTP'
  | 'S3'
  | 'MSG91'
  | 'FAST2SMS'
  | 'TEXTLOCAL'
  | 'ZOHO_SMTP'
  | 'BREVO_SMTP';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'email';
  placeholder?: string;
  required?: boolean;
  hint?: string;
  secret?: boolean;
}

export interface ProviderDef {
  key: ProviderKey;
  title: string;
  vendor: string;
  description: string;
  docsUrl: string;
  fields: FieldDef[];
  buildSummary: (config: Record<string, string>) => Record<string, unknown>;
  test: (config: Record<string, string>) => Promise<{ ok: boolean; detail?: string; error?: string }>;
}

// ─── Razorpay ───────────────────────────────────────────────────────────────
const Razorpay: ProviderDef = {
  key: 'RAZORPAY',
  title: 'Razorpay payments',
  vendor: 'Razorpay',
  description: 'Accept UPI, cards, netbanking, and wallets. Settlement to your registered bank.',
  docsUrl: 'https://dashboard.razorpay.com/app/keys',
  fields: [
    { key: 'keyId',     label: 'Key ID',     type: 'text',     required: true, placeholder: 'rzp_live_xxxxxxxx', hint: 'From Settings → API Keys in your Razorpay dashboard.' },
    { key: 'keySecret', label: 'Key secret', type: 'password', required: true, secret: true },
    { key: 'webhookSecret', label: 'Webhook secret', type: 'password', secret: true, hint: 'Optional. Required to verify payment webhooks.' }
  ],
  buildSummary: (c) => ({ keyId: c.keyId, keySecret: maskSecret(c.keySecret) }),
  async test(c) {
    try {
      const Razorpay = (await import('razorpay')).default as any;
      const instance = new Razorpay({ key_id: c.keyId, key_secret: c.keySecret });
      // List a single order — fastest read-only call that exercises auth.
      const res = await instance.orders.all({ count: 1 });
      return { ok: true, detail: `Authenticated. Account has ${res.count ?? 0} recent orders.` };
    } catch (e: any) {
      const msg = e?.error?.description || e?.message || String(e);
      return { ok: false, error: msg };
    }
  }
};

// ─── Twilio SMS ─────────────────────────────────────────────────────────────
const TwilioSMS: ProviderDef = {
  key: 'TWILIO_SMS',
  title: 'SMS via Twilio',
  vendor: 'Twilio',
  description: 'Send order confirmations and OTPs to customers and riders.',
  docsUrl: 'https://console.twilio.com',
  fields: [
    { key: 'accountSid', label: 'Account SID', type: 'text',     required: true, placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    { key: 'authToken',  label: 'Auth token',  type: 'password', required: true, secret: true },
    { key: 'fromNumber', label: 'From number', type: 'text',     required: true, placeholder: '+1xxxxxxxxxx', hint: 'Your Twilio number, with country code.' }
  ],
  buildSummary: (c) => ({ accountSid: c.accountSid, fromNumber: c.fromNumber, authToken: maskSecret(c.authToken) }),
  async test(c) {
    try {
      const { default: twilio } = await import('twilio');
      const client = (twilio as any)(c.accountSid, c.authToken);
      const account = await client.api.accounts(c.accountSid).fetch();
      return { ok: true, detail: `Account "${account.friendlyName}" — status: ${account.status}.` };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

// ─── Twilio WhatsApp ────────────────────────────────────────────────────────
const TwilioWhatsApp: ProviderDef = {
  key: 'TWILIO_WHATSAPP',
  title: 'WhatsApp via Twilio',
  vendor: 'Twilio',
  description: 'Send rich order updates over WhatsApp. Requires a registered WhatsApp Business sender.',
  docsUrl: 'https://www.twilio.com/console/sms/whatsapp/senders',
  fields: [
    { key: 'accountSid',     label: 'Account SID',    type: 'text',     required: true, placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    { key: 'authToken',      label: 'Auth token',     type: 'password', required: true, secret: true },
    { key: 'whatsappFrom',   label: 'WhatsApp sender', type: 'text',    required: true, placeholder: 'whatsapp:+14155238886', hint: 'Use whatsapp:+<number>. Sandbox or approved sender.' }
  ],
  buildSummary: (c) => ({ accountSid: c.accountSid, whatsappFrom: c.whatsappFrom, authToken: maskSecret(c.authToken) }),
  async test(c) {
    try {
      const { default: twilio } = await import('twilio');
      const client = (twilio as any)(c.accountSid, c.authToken);
      const account = await client.api.accounts(c.accountSid).fetch();
      // Also verify the sender exists in the messaging service or registered numbers
      return { ok: true, detail: `Authenticated as "${account.friendlyName}". Sender ${c.whatsappFrom} will be used.` };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

// ─── SMTP ───────────────────────────────────────────────────────────────────
const SMTP: ProviderDef = {
  key: 'SMTP',
  title: 'Email via SMTP',
  vendor: 'SMTP',
  description: 'Order receipts, password resets, and platform notifications. Works with any SMTP relay (SendGrid, AWS SES, Postmark, etc.).',
  docsUrl: 'https://nodemailer.com/smtp/',
  fields: [
    { key: 'host',     label: 'SMTP host',  type: 'text',     required: true, placeholder: 'smtp.sendgrid.net' },
    { key: 'port',     label: 'Port',       type: 'number',   required: true, placeholder: '587', hint: 'Common ports: 587 (STARTTLS), 465 (SSL).' },
    { key: 'username', label: 'Username',   type: 'text',     required: true },
    { key: 'password', label: 'Password',   type: 'password', required: true, secret: true },
    { key: 'fromEmail',label: 'From email', type: 'email',    required: true, placeholder: 'orders@yourrestaurant.com' },
    { key: 'secure',   label: 'Use SSL',    type: 'text',     placeholder: 'false', hint: 'Set to "true" for port 465 (SSL); leave blank otherwise.' }
  ],
  buildSummary: (c) => ({ host: c.host, port: c.port, username: c.username, fromEmail: c.fromEmail, password: maskSecret(c.password) }),
  async test(c) {
    try {
      const { default: nodemailer } = await import('nodemailer');
      const transporter = (nodemailer as any).createTransport({
        host: c.host,
        port: Number(c.port),
        secure: c.secure === 'true' || Number(c.port) === 465,
        auth: { user: c.username, pass: c.password }
      });
      await transporter.verify();
      return { ok: true, detail: `Connected and authenticated to ${c.host}:${c.port}.` };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

// ─── S3 ─────────────────────────────────────────────────────────────────────
const S3: ProviderDef = {
  key: 'S3',
  title: 'File storage — S3',
  vendor: 'AWS S3 (or compatible)',
  description: 'Stores proof-of-delivery photos, menu item images, and logos. Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2.',
  docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
  fields: [
    { key: 'bucket',    label: 'Bucket name',   type: 'text',     required: true, placeholder: 'my-restaurant-uploads' },
    { key: 'region',    label: 'Region',        type: 'text',     required: true, placeholder: 'ap-south-1' },
    { key: 'endpoint',  label: 'Endpoint URL',  type: 'text',     hint: 'Only for non-AWS (R2, MinIO). Leave blank for AWS S3.' },
    { key: 'accessKey', label: 'Access key ID', type: 'text',     required: true, placeholder: 'AKIA…' },
    { key: 'secretKey', label: 'Secret access key', type: 'password', required: true, secret: true }
  ],
  buildSummary: (c) => ({ bucket: c.bucket, region: c.region, endpoint: c.endpoint || 'AWS S3', accessKey: maskSecret(c.accessKey) }),
  async test(c) {
    try {
      // @ts-expect-error optional dependency — only resolves when STORAGE_DRIVER=s3.
      // webpackIgnore stops `next build` from trying to resolve the SDK when it
      // isn't installed; the surrounding try/catch handles the runtime case.
      const { S3Client, HeadBucketCommand } = await import(/* webpackIgnore: true */ '@aws-sdk/client-s3');
      const client = new (S3Client as any)({
        region: c.region,
        endpoint: c.endpoint || undefined,
        credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey }
      });
      await client.send(new (HeadBucketCommand as any)({ Bucket: c.bucket }));
      return { ok: true, detail: `Bucket "${c.bucket}" reachable in ${c.region}.` };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

// ─── MSG91 (India SMS) ──────────────────────────────────────────────────────
const Msg91: ProviderDef = {
  key: 'MSG91',
  title: 'SMS via MSG91',
  vendor: 'MSG91',
  description: 'India-friendly transactional SMS with DLT template support. Cheap per-SMS pricing and dependable delivery to Indian carriers.',
  docsUrl: 'https://docs.msg91.com/sms/',
  fields: [
    { key: 'authKey',       label: 'Auth key',        type: 'password', required: true, secret: true, hint: 'From MSG91 dashboard → API.' },
    { key: 'senderId',      label: 'Sender ID',       type: 'text',     required: true, placeholder: 'YOURBR', hint: '6-char DLT-approved header.' },
    { key: 'route',         label: 'Route',           type: 'text',     placeholder: '4', hint: '4 = transactional (default), 1 = promotional.' },
    { key: 'dltTemplateId', label: 'DLT template ID', type: 'text',     hint: 'Required for Indian DLT-registered transactional templates.' }
  ],
  buildSummary: (c) => ({ senderId: c.senderId, route: c.route || '4', authKey: maskSecret(c.authKey) }),
  async test(c) {
    const res = await checkMsg91Balance({ authKey: c.authKey, senderId: c.senderId, route: c.route });
    if (res.ok) return { ok: true, detail: `Wallet balance: ${res.balance} credits.` };
    return { ok: false, error: res.error };
  }
};

// ─── Fast2SMS (India SMS) ───────────────────────────────────────────────────
const Fast2Sms: ProviderDef = {
  key: 'FAST2SMS',
  title: 'SMS via Fast2SMS',
  vendor: 'Fast2SMS',
  description: 'Pay-as-you-go Indian SMS. The "quick" route works without DLT for basic OTPs.',
  docsUrl: 'https://docs.fast2sms.com/',
  fields: [
    { key: 'apiKey',    label: 'API key',     type: 'password', required: true, secret: true, hint: 'From Fast2SMS dashboard → Dev API.' },
    { key: 'senderId',  label: 'Sender ID',   type: 'text',     hint: 'Optional. Only used on the DLT route.' },
    { key: 'route',     label: 'Route',       type: 'text',     placeholder: 'q', hint: 'q = quick, dlt = DLT-registered.' },
    { key: 'messageId', label: 'DLT msg ID',  type: 'text',     hint: 'Required when route=dlt.' }
  ],
  buildSummary: (c) => ({ senderId: c.senderId || null, route: c.route || 'q', apiKey: maskSecret(c.apiKey) }),
  async test(c) {
    const res = await checkFast2SmsBalance({ apiKey: c.apiKey, senderId: c.senderId, route: c.route });
    if (res.ok) return { ok: true, detail: `Wallet balance: ₹${res.wallet}.` };
    return { ok: false, error: res.error };
  }
};

// ─── Textlocal (India SMS) ──────────────────────────────────────────────────
const TextLocal: ProviderDef = {
  key: 'TEXTLOCAL',
  title: 'SMS via Textlocal',
  vendor: 'Textlocal (IMImobile)',
  description: 'Long-running India SMS provider. Per-credit pricing, sender-ID branded sends.',
  docsUrl: 'https://api.textlocal.in/docs/',
  fields: [
    { key: 'apiKey',   label: 'API key',   type: 'password', required: true, secret: true },
    { key: 'senderId', label: 'Sender ID', type: 'text',     required: true, placeholder: 'TXTLCL', hint: '6-char sender header.' }
  ],
  buildSummary: (c) => ({ senderId: c.senderId, apiKey: maskSecret(c.apiKey) }),
  async test(c) {
    const res = await checkTextlocalBalance({ apiKey: c.apiKey, senderId: c.senderId });
    if (res.ok) return { ok: true, detail: `SMS credits remaining: ${res.balance ?? 'unknown'}.` };
    return { ok: false, error: res.error };
  }
};

// ─── Zoho SMTP ──────────────────────────────────────────────────────────────
const ZohoSmtp: ProviderDef = {
  key: 'ZOHO_SMTP',
  title: 'Email via Zoho Mail SMTP',
  vendor: 'Zoho',
  description: 'Affordable transactional email. Defaults tuned for the Zoho India SMTP relay.',
  docsUrl: 'https://www.zoho.com/mail/help/zoho-smtp.html',
  fields: [
    { key: 'host',      label: 'SMTP host',  type: 'text',     placeholder: 'smtp.zoho.in', hint: 'Default smtp.zoho.in (India). Use smtp.zoho.com for global.' },
    { key: 'port',      label: 'Port',       type: 'number',   placeholder: '587', hint: 'Default 587 (STARTTLS).' },
    { key: 'username',  label: 'Username',   type: 'text',     required: true, placeholder: 'orders@yourdomain.in' },
    { key: 'password',  label: 'App password', type: 'password', required: true, secret: true, hint: 'Generate from Zoho → Security → App Passwords.' },
    { key: 'fromEmail', label: 'From email', type: 'email',    required: true, placeholder: 'orders@yourdomain.in' },
    { key: 'secure',    label: 'Use SSL',    type: 'text',     placeholder: 'false', hint: 'Set "true" only for port 465.' }
  ],
  buildSummary: (c) => ({ host: c.host || 'smtp.zoho.in', port: c.port || '587', username: c.username, fromEmail: c.fromEmail, password: maskSecret(c.password) }),
  async test(c) {
    const res = await verifyZohoSmtp({ host: c.host, port: c.port, username: c.username, password: c.password, fromEmail: c.fromEmail, secure: c.secure });
    if (res.ok) return { ok: true, detail: `Connected to ${c.host || 'smtp.zoho.in'}:${c.port || '587'}.` };
    return { ok: false, error: res.error };
  }
};

// ─── Brevo SMTP ─────────────────────────────────────────────────────────────
const BrevoSmtp: ProviderDef = {
  key: 'BREVO_SMTP',
  title: 'Email via Brevo SMTP',
  vendor: 'Brevo (formerly Sendinblue)',
  description: 'Generous free tier (300 emails/day) with SMTP relay. Good fit for low-volume launches.',
  docsUrl: 'https://help.brevo.com/hc/en-us/articles/7924908994450',
  fields: [
    { key: 'host',      label: 'SMTP host',  type: 'text',     placeholder: 'smtp-relay.brevo.com' },
    { key: 'port',      label: 'Port',       type: 'number',   placeholder: '587' },
    { key: 'username',  label: 'SMTP login', type: 'text',     required: true, placeholder: 'your-account@example.com' },
    { key: 'password',  label: 'SMTP key',   type: 'password', required: true, secret: true, hint: 'From Brevo → SMTP & API → SMTP.' },
    { key: 'fromEmail', label: 'From email', type: 'email',    required: true, placeholder: 'orders@yourdomain.in' },
    { key: 'secure',    label: 'Use SSL',    type: 'text',     placeholder: 'false' }
  ],
  buildSummary: (c) => ({ host: c.host || 'smtp-relay.brevo.com', port: c.port || '587', username: c.username, fromEmail: c.fromEmail, password: maskSecret(c.password) }),
  async test(c) {
    const res = await verifyBrevoSmtp({ host: c.host, port: c.port, username: c.username, password: c.password, fromEmail: c.fromEmail, secure: c.secure });
    if (res.ok) return { ok: true, detail: `Connected to ${c.host || 'smtp-relay.brevo.com'}:${c.port || '587'}.` };
    return { ok: false, error: res.error };
  }
};

export const PROVIDERS: Record<ProviderKey, ProviderDef> = {
  RAZORPAY: Razorpay,
  TWILIO_SMS: TwilioSMS,
  TWILIO_WHATSAPP: TwilioWhatsApp,
  SMTP,
  S3,
  MSG91: Msg91,
  FAST2SMS: Fast2Sms,
  TEXTLOCAL: TextLocal,
  ZOHO_SMTP: ZohoSmtp,
  BREVO_SMTP: BrevoSmtp
};

export const PROVIDER_LIST: ProviderDef[] = [
  Razorpay,
  Msg91, Fast2Sms, TextLocal, TwilioSMS,
  TwilioWhatsApp,
  ZohoSmtp, BrevoSmtp, SMTP,
  S3
];
