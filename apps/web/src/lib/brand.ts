/** A support number only counts once it is really configured (not unset, not the 9999999999 placeholder). */
function realPhone(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t || /^\+?(91)?9{10}$/.test(t.replace(/[\s-]/g, ''))) return null;
  return t;
}

export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Flavrly',
  /** Canonical public site URL (https). Used for SEO canonicals, webhook URLs shown to admins, etc. */
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in').replace(/\/$/, ''),
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE || 'Every flavour in town — delivered.',
  /** null until NEXT_PUBLIC_SUPPORT_PHONE is set to a real number — callers hide phone UI. */
  supportPhone: realPhone(process.env.NEXT_PUBLIC_SUPPORT_PHONE),
  /** null until NEXT_PUBLIC_SUPPORT_WHATSAPP is set to a real number — callers hide WhatsApp UI. */
  supportWhatsapp: realPhone(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP),
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@flavrly.in',
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || 'privacy@flavrly.in',
  careersEmail: process.env.NEXT_PUBLIC_CAREERS_EMAIL || 'careers@flavrly.in',
  currency: process.env.NEXT_PUBLIC_CURRENCY || 'INR'
} as const;
