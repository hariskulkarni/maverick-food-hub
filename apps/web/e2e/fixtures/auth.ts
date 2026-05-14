/**
 * Auth helpers for E2E specs.
 *
 * Each helper drives a real sign-in through the UI, but for OTP flows we read
 * the dev OTP straight out of `/api/auth/otp` JSON instead of scraping logs.
 * In dev the route returns `{ ok: true, devCode: '123456' }`.
 *
 * The seed (`prisma/seed.ts`) creates:
 *   - super-admin:      super@platform.local       / Super@12345
 *   - restaurant admin: admin@restaurant.local     / Admin@12345
 *   - kitchen:          kitchen@restaurant.local   / Kitchen@12345
 *   - customer:         phone +919876500001        (OTP via dev path)
 *   - rider:            phone +919876500011        (OTP via dev path)
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const SEEDED = {
  superAdmin: { email: 'super@platform.local', password: 'Super@12345' },
  admin: { email: 'admin@restaurant.local', password: 'Admin@12345' },
  kitchen: { email: 'kitchen@restaurant.local', password: 'Kitchen@12345' },
  customer: { phone: '+919876500001' },
  rider: { phone: '+919876500011' }
} as const;

/**
 * Hits `/api/auth/otp` to request a code. In dev the response body carries
 * `devCode` so tests can avoid scraping logs. If the body is missing the code
 * the function throws — callers can fall back to a hard-coded value if needed,
 * but seeing the throw usually means the OTP rate-limit kicked in.
 *
 * Phones are bound to a single OTP per 45s — uses a random phone suffix for
 * scenarios where the seeded phone is being hit repeatedly. Pass `phone` to
 * stick to a specific number.
 */
export async function requestOtp(
  request: APIRequestContext,
  phone: string,
  purpose: 'login' | 'phone_verify' = 'login'
): Promise<string> {
  const r = await request.post('/api/auth/otp', { data: { phone, purpose } });
  if (!r.ok()) {
    const body = await r.text();
    throw new Error(`OTP request failed (${r.status()}): ${body}`);
  }
  const data = (await r.json()) as { ok?: boolean; devCode?: string };
  if (!data.devCode) {
    throw new Error('No devCode in OTP response — is the server running with NODE_ENV=development?');
  }
  return data.devCode;
}

/**
 * Phone+OTP sign-in via the UI. Lands on whichever page the app routes to
 * for the given role (see `routeByRole` in login-client.tsx).
 */
async function signInWithOtp(page: Page, phone: string, expectedLanding: RegExp) {
  await page.goto('/login');
  // Use the request context attached to the page so cookies (e.g. CSRF) are shared.
  const devCode = await requestOtp(page.request, phone);

  // Fill phone, submit, then fill OTP, submit.
  // The page state-machines on `otpSent`; once the field for OTP appears we're past step 1.
  await page.getByRole('tab', { name: /customer.*rider/i }).click().catch(() => {
    /* Already on the phone tab — fine. */
  });
  await page.locator('#phone').fill(phone);
  await page.getByRole('button', { name: /send otp/i }).click();

  // Wait for the 6-digit code input to appear (it's #otp).
  // We "Send OTP" via the UI for full realism; the server happens to return
  // the same code on a second request inside the 45s window only if the
  // existing token is still valid. To be safe we use the code we fetched in
  // the API call above (it's the latest unconsumed token).
  await page.locator('#otp').waitFor({ state: 'visible' });
  await page.locator('#otp').fill(devCode);
  await page.getByRole('button', { name: /verify.*sign in/i }).click();

  await page.waitForURL(expectedLanding, { timeout: 15_000 });
}

/**
 * Email+password sign-in (admin / super-admin / kitchen all share this path).
 */
async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
  expectedLanding: RegExp
) {
  await page.goto('/login');
  await page.getByRole('tab', { name: /staff/i }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(expectedLanding, { timeout: 15_000 });
}

export async function signInAsCustomer(page: Page): Promise<void> {
  // Customers land on `/` after login (routeByRole's fallback).
  await signInWithOtp(page, SEEDED.customer.phone, /\/(?:$|profile|orders|menu|r\/)/);
}

export async function signInAsRider(page: Page): Promise<void> {
  await signInWithOtp(page, SEEDED.rider.phone, /\/rider/);
}

export async function signInAsAdmin(page: Page): Promise<void> {
  await signInWithPassword(page, SEEDED.admin.email, SEEDED.admin.password, /\/admin/);
}

export async function signInAsSuperAdmin(page: Page): Promise<void> {
  await signInWithPassword(page, SEEDED.superAdmin.email, SEEDED.superAdmin.password, /\/platform/);
}

export async function signInAsKitchen(page: Page): Promise<void> {
  await signInWithPassword(page, SEEDED.kitchen.email, SEEDED.kitchen.password, /\/kitchen/);
}

/**
 * Convenience matcher — verifies the user is signed in by hitting `/api/me`.
 * Throws (via expect) when the call returns no user / wrong role.
 */
export async function expectMeRole(
  page: Page,
  role: 'CUSTOMER' | 'RIDER' | 'ADMIN' | 'SUPER_ADMIN' | 'KITCHEN'
): Promise<void> {
  const r = await page.request.get('/api/me');
  expect(r.ok()).toBeTruthy();
  const j = (await r.json()) as { role?: string };
  expect(j.role).toBe(role);
}
