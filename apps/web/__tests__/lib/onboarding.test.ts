import { describe, it, expect, vi } from 'vitest';
import {
  resolveStartStep, nextStep, progressIndex, safeNextPath, welcomeUrl, validateDisplayName, toggleCuisine,
  CUISINES, MAX_CUISINES, PROGRESS_STEPS,
} from '@/lib/onboarding';

vi.mock('next-auth/react', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
import { phoneInputError } from '@/components/auth/customer/onboarding/verify-phone-flow';
import { addressError } from '@/app/(customer)/welcome/welcome-client';

describe('onboarding step logic', () => {
  it('starts signed-out visitors at welcome', () => {
    expect(resolveStartStep({ signedIn: false, phoneVerified: false, onboarded: false })).toBe('welcome');
  });
  it('sends a signed-in customer without a verified phone to the mandatory phone step', () => {
    expect(resolveStartStep({ signedIn: true, phoneVerified: false, onboarded: true })).toBe('phone');
    expect(resolveStartStep({ signedIn: true, phoneVerified: false, onboarded: false })).toBe('phone');
  });
  it('continues a verified, new customer to the optional steps, and skips onboarded ones', () => {
    expect(resolveStartStep({ signedIn: true, phoneVerified: true, onboarded: false })).toBe('about');
    expect(resolveStartStep({ signedIn: true, phoneVerified: true, onboarded: true })).toBeNull();
  });
  it('walks the happy path in order and stops at done', () => {
    const seen = ['welcome'];
    let s = 'welcome' as Parameters<typeof nextStep>[0];
    while (s !== 'done') { s = nextStep(s); seen.push(s); }
    expect(seen).toEqual(['welcome', 'phone', 'verify', 'about', 'address', 'done']);
    expect(nextStep('done')).toBe('done');
  });
  it('maps verify onto the phone dot of the progress indicator', () => {
    expect(progressIndex('verify')).toBe(progressIndex('phone'));
    expect(progressIndex('done')).toBe(PROGRESS_STEPS.length - 1);
  });
});

describe('safe return path (no open redirect)', () => {
  it('accepts same-origin paths with query strings', () => {
    expect(safeNextPath('/checkout?branchId=b1')).toBe('/checkout?branchId=b1');
    expect(safeNextPath('/r/spice-hub')).toBe('/r/spice-hub');
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 'checkout', '', '/welcome', '/welcome?next=/x', '/api/auth/signout', '/ok\nbad'])(
    'rejects %j', (v) => { expect(safeNextPath(v)).toBeNull(); },
  );
  it('builds the welcome URL with the return path and gate flag', () => {
    expect(welcomeUrl('/orders')).toBe('/welcome?next=%2Forders');
    expect(welcomeUrl('/orders', { gate: true })).toBe('/welcome?next=%2Forders&gate=1');
    expect(welcomeUrl('https://evil.test')).toBe('/welcome');
  });
});

describe('inline validations', () => {
  it('phone: friendly countdown, then the 6–9 rule', () => {
    expect(phoneInputError('')).toMatch(/10-digit/);
    expect(phoneInputError('+9198765')).toMatch(/5 more digits/);
    expect(phoneInputError('+91919')).toMatch(/7 more digits/);
    expect(phoneInputError('+91987654321')).toMatch(/1 more digit to go/);
    expect(phoneInputError('+915876543210')).toMatch(/start with 6, 7, 8 or 9/);
    expect(phoneInputError('+919876543210')).toBeNull();
  });
  it('name: optional, but sensible when given', () => {
    expect(validateDisplayName('')).toBeNull();
    expect(validateDisplayName('Priya')).toBeNull();
    expect(validateDisplayName('P')).toMatch(/at least 2/);
    expect(validateDisplayName('1234')).toMatch(/letters/);
    expect(validateDisplayName('<b>Hi</b>')).toMatch(/symbols/);
    expect(validateDisplayName('x'.repeat(81))).toMatch(/under 80/);
  });
  it('cuisines: toggles, ignores unknown values and caps at the max', () => {
    let s: string[] = [];
    s = toggleCuisine(s, 'Biryani');
    expect(s).toEqual(['Biryani']);
    s = toggleCuisine(s, 'Biryani');
    expect(s).toEqual([]);
    expect(toggleCuisine([], 'Not A Cuisine')).toEqual([]);
    const full = CUISINES.slice(0, MAX_CUISINES) as unknown as string[];
    expect(toggleCuisine(full, CUISINES[MAX_CUISINES])).toEqual(full);
  });
  it('address: needs line 1, city and a 6-digit PIN', () => {
    const base = { label: 'Home', line1: '12 MG Road', line2: '', city: 'Guntur', state: 'AP', postalCode: '522002', country: 'IN', latitude: null, longitude: null };
    expect(addressError(base)).toBeNull();
    expect(addressError({ ...base, line1: '' })).toMatch(/line 1/);
    expect(addressError({ ...base, city: ' ' })).toMatch(/city/);
    expect(addressError({ ...base, postalCode: '5220' })).toMatch(/6 digits/);
  });
});
