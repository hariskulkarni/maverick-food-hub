export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Flavrly',
  /** Canonical public site URL (https). Used for SEO canonicals, webhook URLs shown to admins, etc. */
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in').replace(/\/$/, ''),
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE || 'Every flavour in town — delivered.',
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || '+919999999999',
  supportWhatsapp: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '+919999999999',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@flavrly.in',
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || 'privacy@flavrly.in',
  careersEmail: process.env.NEXT_PUBLIC_CAREERS_EMAIL || 'careers@flavrly.in',
  currency: process.env.NEXT_PUBLIC_CURRENCY || 'INR'
} as const;
