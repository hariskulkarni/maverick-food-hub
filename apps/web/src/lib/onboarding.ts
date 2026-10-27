/**
 * Pure helpers for the customer welcome onboarding (/welcome): step order,
 * where a visitor starts, the safe return path, and the optional taste-profile
 * fields. No React, no I/O — shared by the page, the client stepper, the API
 * route and the unit tests.
 *
 * Steps:  welcome → phone → verify → about → address → done
 *   - welcome: anonymous visitor picks "Continue with Google" or mobile OTP
 *   - phone / verify: mandatory — a CUSTOMER must have an OTP-verified phone
 *   - about (name + favourite cuisines) and address: optional, skippable
 *   - done: the "You're in!" celebration
 */

export const ONBOARDING_STEPS = ['welcome', 'phone', 'verify', 'about', 'address', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps shown in the progress indicator (verify is a sub-step of phone). */
export const PROGRESS_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'welcome', label: 'Hello' },
  { id: 'phone', label: 'Phone' },
  { id: 'about', label: 'You' },
  { id: 'address', label: 'Address' },
  { id: 'done', label: 'Done' },
];

/** Index of a step in the progress indicator (verify counts as phone). */
export function progressIndex(step: OnboardingStep): number {
  const s = step === 'verify' ? 'phone' : step;
  return PROGRESS_STEPS.findIndex((p) => p.id === s);
}

/** Where the onboarding starts for this visitor, or null = nothing to do. */
export function resolveStartStep(v: {
  signedIn: boolean;
  phoneVerified: boolean;
  onboarded: boolean;
}): OnboardingStep | null {
  if (!v.signedIn) return 'welcome';
  if (!v.phoneVerified) return 'phone';
  if (!v.onboarded) return 'about';
  return null;
}

/** The step after `step` in the happy path. */
export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)];
}

/**
 * A same-origin path to return to after onboarding, or null. Rejects absolute
 * URLs, protocol-relative ("//evil") and backslash tricks so `next` can never
 * become an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.includes('\\')) return null;
  if ([...v].some((ch) => ch.charCodeAt(0) < 32)) return null;
  if (v.length > 512) return null;
  // Never bounce back into the onboarding itself or the auth API.
  if (v === '/welcome' || v.startsWith('/welcome?') || v.startsWith('/api/')) return null;
  return v;
}

/** The onboarding URL that returns to `next` afterwards. */
export function welcomeUrl(next?: string | null, opts: { gate?: boolean } = {}): string {
  const params = new URLSearchParams();
  const safe = safeNextPath(next);
  if (safe) params.set('next', safe);
  if (opts.gate) params.set('gate', '1');
  const qs = params.toString();
  return `/welcome${qs ? `?${qs}` : ''}`;
}

// ── Optional "about you" step ────────────────────────────────────────────────

export const NAME_MAX = 80;

/** Friendly validation for the first-name field; null = valid. Empty is allowed (skip). */
export function validateDisplayName(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length < 2) return 'A little longer, please — at least 2 letters.';
  if (v.length > NAME_MAX) return `That's a big name! Keep it under ${NAME_MAX} characters.`;
  if (!/\p{L}/u.test(v)) return 'Use letters for your name.';
  if (/[<>{}\\]/.test(v)) return 'Please leave out symbols like < > { }.';
  return null;
}

/** Cuisine choices for the taste profile (stored verbatim on User.favoriteCuisines). */
export const CUISINES = [
  'Biryani',
  'North Indian',
  'South Indian',
  'Chinese',
  'Pizza',
  'Burgers',
  'Street Food',
  'Desserts',
  'Healthy',
  'Café & Bakes',
] as const;
export type Cuisine = (typeof CUISINES)[number];
export const MAX_CUISINES = 5;

export function isCuisine(v: string): v is Cuisine {
  return (CUISINES as readonly string[]).includes(v);
}

/** Toggle a cuisine; refuses (returns the same list) beyond MAX_CUISINES. */
export function toggleCuisine(selected: readonly string[], c: string): string[] {
  if (selected.includes(c)) return selected.filter((x) => x !== c);
  if (!isCuisine(c) || selected.length >= MAX_CUISINES) return [...selected];
  return [...selected, c];
}
