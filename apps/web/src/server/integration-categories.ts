/**
 * Human-readable category label for an integration provider key.
 *
 * The provider enum in `prisma/schema.prisma` uses upper-snake tokens
 * (RAZORPAY, TWILIO_SMS, …). Callers also occasionally pass dot-style
 * keys ('smtp.sendgrid', 'webhook.delivery'), so we normalise to lower
 * before matching.
 *
 * Anything we don't recognise falls back to 'Integration' so the alert
 * email never reads "undefined".
 */
export function categoryFromProvider(provider: string | null | undefined): string {
  if (!provider) return 'Integration';
  const p = String(provider).toLowerCase();

  // Payment gateways
  if (p === 'razorpay' || p === 'stripe' || p === 'mock') return 'Payment gateway';

  // SMS providers
  if (p === 'twilio' || p === 'twilio_sms' || p === 'msg91' || p === 'fast2sms' || p === 'textlocal') {
    return 'SMS provider';
  }

  // WhatsApp providers
  if (p === 'twilio_whatsapp' || p === 'gupshup' || p === 'whatsapp-cloud' || p === 'whatsapp_cloud') {
    return 'WhatsApp provider';
  }

  // Email / SMTP
  if (p === 'smtp' || p.startsWith('smtp.') || p === 'zoho_smtp' || p === 'brevo_smtp' ||
      p === 'smtp.sendgrid' || p === 'smtp.mailgun') {
    return 'Email SMTP';
  }

  // Storage
  if (p === 's3' || p === 'local' || p === 'r2') return 'Storage provider';

  // Maps
  if (p === 'google-maps' || p === 'google_maps' || p === 'osm') return 'Maps provider';

  // Webhook URLs (allow webhook.<anything>)
  if (p.startsWith('webhook.') || p === 'webhook') return 'Webhook URL';

  return 'Integration';
}
