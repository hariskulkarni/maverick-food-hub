/**
 * Welcome onboarding UI: each step renders its heading, illustration and
 * controls; the progress indicator marks the current step; inputs are
 * labelled; motion is switched off under prefers-reduced-motion.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-auth/react', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

import { WelcomeClient, type WelcomeUser } from '@/app/(customer)/welcome/welcome-client';
import { StepProgress } from '@/components/auth/customer/onboarding/step-progress';
import { VerifyPhoneFlow } from '@/components/auth/customer/onboarding/verify-phone-flow';
import { EditProfile } from '@/app/(customer)/profile/edit-profile';
import InviteOnlyPage from '@/app/(customer)/login/invite-only/page';
import type { OnboardingStep } from '@/lib/onboarding';

const user: WelcomeUser = { name: 'Priya Iyer', favoriteCuisines: ['Biryani'], addressCount: 0, onboarded: false };
const render = (initialStep: OnboardingStep, u: WelcomeUser | null = user, googleEnabled = true) =>
  renderToStaticMarkup(createElement(WelcomeClient, { initialStep, next: '/restaurants', googleEnabled, selfSignupOpen: true, user: u }));

describe('welcome steps', () => {
  it('welcome: Google is the primary choice, mobile is the alternative, legal + sign-in link shown', () => {
    const html = render('welcome', null);
    expect(html).toContain('Hungry? Let’s get you in.');
    expect(html.indexOf('Continue with Google')).toBeLessThan(html.indexOf('Use my mobile number'));
    expect(html).toContain('Terms');
    expect(html).toContain('href="/login?next=%2Frestaurants"');
  });
  it('welcome without Google configured offers only the mobile path', () => {
    const html = render('welcome', null, false);
    expect(html).not.toContain('Continue with Google');
    expect(html).toContain('Use my mobile number');
  });
  it('phone (signed in via Google): labelled +91 input and a Send code action', () => {
    const html = render('phone');
    expect(html).toContain('Add your mobile number');
    expect(html).toMatch(/<label[^>]*for="vp-phone"/);
    expect(html).toContain('+91');
    expect(html).toContain('Send code');
    expect(html).toContain('aria-live="assertive"');
  });
  it('about: optional name + cuisine chips as toggle buttons, skippable', () => {
    const html = render('about');
    expect(html).toMatch(/<label[^>]*for="ob-name"/);
    expect(html).toContain('value="Priya Iyer"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Biryani/);
    expect(html).toContain('Skip for now');
    expect(html).toContain('<legend');
  });
  it('address: add-or-skip choice; existing addresses short-circuit', () => {
    expect(render('address')).toContain('Add delivery address');
    expect(render('address')).toContain('add it at checkout');
    expect(render('address', { ...user, addressCount: 2 })).toContain('2 saved addresses');
  });
  it('done: personalised celebration with confetti', () => {
    const html = render('done');
    expect(html).toContain('You’re in, Priya!');
    expect(html).toContain('ob-confetti');
  });
  it('every step has an aria-hidden inline SVG illustration (no images to load)', () => {
    for (const s of ['welcome', 'phone', 'about', 'address', 'done'] as const) {
      const html = render(s, s === 'welcome' ? null : user);
      expect(html).toMatch(/<div aria-hidden="true" class="mx-auto h-32[^"]*"><svg/);
      expect(html).not.toContain('<img');
    }
  });
});

describe('progress indicator', () => {
  it('marks the current step and announces "Step n of 5"', () => {
    const html = renderToStaticMarkup(createElement(StepProgress, { step: 'verify' }));
    expect(html).toContain('Step 2 of 5: Phone');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });
});

describe('verify phone flow + profile', () => {
  it('change mode renders the new-number field and a cancel action', () => {
    const html = renderToStaticMarkup(createElement(VerifyPhoneFlow, { mode: 'change', onVerified: () => {}, onCancel: () => {} }));
    expect(html).toContain('New mobile number');
    expect(html).toContain('Cancel');
  });
  it('profile offers an OTP-verified "Change number" and shows the verified badge', () => {
    const html = renderToStaticMarkup(createElement(EditProfile, { name: 'Asha', email: null, phone: '+919876543210', phoneVerified: true }));
    expect(html).toContain('Change number');
    expect(html).toContain('aria-label="Verified"');
  });
  it('invite-only screen explains and offers the phone sign-in', () => {
    const html = renderToStaticMarkup(InviteOnlyPage());
    expect(html).toContain('invite-only right now');
    expect(html).toContain('href="/login"');
  });
});

describe('motion is accessible', () => {
  it('every onboarding animation is disabled under prefers-reduced-motion', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/styles/globals.css'), 'utf8');
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of ['.ob-enter-fwd', '.ob-enter-back', '.ob-bob', '.ob-steam', '.ob-wiggle', '.ob-drop', '.ob-twinkle', '.ob-digit-pop', '.ob-shake', '.ob-confetti']) {
      expect(reduced).toContain(cls);
    }
  });
});
