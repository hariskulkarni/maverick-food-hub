/**
 * Brevo (formerly Sendinblue) SMTP adapter.
 *
 * Defaults to smtp-relay.brevo.com:587 with STARTTLS. The `username` is the
 * SMTP login (usually your Brevo account email) and `password` is the SMTP
 * key generated in the Brevo dashboard.
 *
 * Uses dynamic import of nodemailer so the package stays optional.
 */

export interface BrevoSmtpConfig {
  host?: string;
  port?: string;
  username: string;
  password: string;
  fromEmail: string;
  secure?: string;
}

interface SendArgs {
  to: string;
  body: string;
  subject?: string;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

const DEFAULTS = {
  host: 'smtp-relay.brevo.com',
  port: '587',
  secure: 'false'
} as const;

async function createTransport(cfg: BrevoSmtpConfig) {
  const { default: nodemailer } = await import('nodemailer').catch(() => ({ default: null as any }));
  if (!nodemailer) return null;
  const host = cfg.host || DEFAULTS.host;
  const port = Number(cfg.port || DEFAULTS.port);
  return (nodemailer as any).createTransport({
    host,
    port,
    secure: cfg.secure === 'true' || port === 465,
    auth: { user: cfg.username, pass: cfg.password }
  });
}

export async function sendBrevoSmtp(cfg: BrevoSmtpConfig, args: SendArgs): Promise<SendResult> {
  try {
    const transporter = await createTransport(cfg);
    if (!transporter) return { ok: false, error: 'nodemailer not installed' };
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

export async function verifyBrevoSmtp(cfg: BrevoSmtpConfig): Promise<SendResult> {
  try {
    const transporter = await createTransport(cfg);
    if (!transporter) return { ok: false, error: 'nodemailer not installed' };
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
