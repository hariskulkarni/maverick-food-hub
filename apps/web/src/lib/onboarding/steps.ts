/**
 * Step catalogue for the restaurant-side "Get your restaurant live" wizard
 * (/admin/onboarding). Pure data — shared by the wizard, the dashboard
 * checklist widget and the server-side progress sanitiser.
 *
 * `skippable` steps can be marked "skipped" (do it later). Required steps can
 * only be completed; the readiness checks behind them gate "Go live".
 */

export const ONBOARDING_STEP_KEYS = [
  'profile',
  'legal',
  'branches',
  'menu',
  'delivery',
  'staff',
  'payments',
  'notifications',
  'storefront',
  'golive',
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];
export type StepState = 'todo' | 'done' | 'skipped';

export interface StepDef {
  key: OnboardingStepKey;
  title: string;
  /** One-line summary for the checklist widget. */
  summary: string;
  skippable: boolean;
}

export const ONBOARDING_STEPS: readonly StepDef[] = [
  { key: 'profile',       title: 'Business profile & branding', summary: 'Name, contact, logo and colours customers will see.', skippable: false },
  { key: 'legal',         title: 'Legal & compliance',          summary: 'FSSAI licence (required), GSTIN and PAN.',          skippable: false },
  { key: 'branches',      title: 'Branch & opening hours',      summary: 'Address, map pin and weekly hours.',                skippable: false },
  { key: 'menu',          title: 'Menu',                        summary: 'Start from a template, import a CSV, or add dishes.', skippable: false },
  { key: 'delivery',      title: 'Delivery zones & fees',       summary: 'Where you deliver and what it costs.',              skippable: false },
  { key: 'staff',         title: 'Staff & roles',               summary: 'Invite kitchen staff and managers.',                skippable: true },
  { key: 'payments',      title: 'Payments',                    summary: 'Review how customers pay you.',                     skippable: true },
  { key: 'notifications', title: 'Notification channels',       summary: 'SMS, WhatsApp and email for order updates.',        skippable: true },
  { key: 'storefront',    title: 'Storefront & QR',             summary: 'Preview your page and print your QR code.',         skippable: true },
  { key: 'golive',        title: 'Readiness check & go live',   summary: 'Final checks, then open for orders.',               skippable: false },
];

export function isStepKey(v: unknown): v is OnboardingStepKey {
  return typeof v === 'string' && (ONBOARDING_STEP_KEYS as readonly string[]).includes(v);
}

export function stepDef(key: OnboardingStepKey): StepDef {
  return ONBOARDING_STEPS.find((s) => s.key === key)!;
}

/** Deep link into the wizard at a given step. */
export function onboardingHref(key: OnboardingStepKey): string {
  return `/admin/onboarding?step=${key}`;
}
