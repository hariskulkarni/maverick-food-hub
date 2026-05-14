/**
 * Pure-resolver tests for the alert dispatcher.
 *
 * - `maskSecret` / `maskCredentials` are the security boundary: an admin email
 *   must never accidentally leak a full API key. We pin the behaviour with
 *   a handful of representative shapes.
 * - `isDebouncedNow` controls how aggressively the helper coalesces repeated
 *   toggles. We verify the boundary conditions.
 * - The email formatters are pure given a context, so we assert that the
 *   required fields (restaurant, branch, actor, role, item, old/new status,
 *   timestamp, reason) all surface in the output. Doing this with snapshot
 *   asserts would be brittle — instead we just check for substrings.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  maskSecret, maskCredentials, isDebouncedNow,
  formatAvailabilityEmail, formatIntegrationEmail,
  DEBOUNCE_WINDOW_MIN
} from '@/server/alerts';

// ── maskSecret ────────────────────────────────────────────────────────────

describe('maskSecret', () => {
  it('keeps only the last 4 chars by default', () => {
    expect(maskSecret('sk_live_abcdefghij1234')).toMatch(/^•+1234$/);
  });
  it('fully masks short values to at least 6 bullets', () => {
    expect(maskSecret('whsec_q')).toBe('•••••••');
    expect(maskSecret('abc')).toBe('••••••');
  });
  it('returns (not set) for null/undefined', () => {
    expect(maskSecret(null)).toBe('(not set)');
    expect(maskSecret(undefined)).toBe('(not set)');
  });
  it('returns (empty) for empty string', () => {
    expect(maskSecret('')).toBe('(empty)');
  });
  it('respects custom keep length', () => {
    expect(maskSecret('email@example.com', 4)).toMatch(/^•+\.com$/);
  });
});

describe('maskCredentials', () => {
  it('masks sensitive-looking keys, passes through innocent ones', () => {
    const out = maskCredentials({
      apiKey: 'sk_live_abcdefghij1234',
      secretKey: 'whsec_supersecretvalue',
      authToken: 'AC...zzzz',
      webhookUrl: 'https://hooks.maverick.app/payments',
      mode: 'live'
    });
    expect(out.apiKey).toMatch(/1234$/);
    expect(out.apiKey).not.toContain('sk_live');
    expect(out.secretKey).not.toContain('secret');
    expect(out.authToken).not.toContain('AC');
    expect(out.webhookUrl).toBe('https://hooks.maverick.app/payments');
    expect(out.mode).toBe('live');
  });
  it('handles password and credential keys', () => {
    const out = maskCredentials({ smtpPassword: 'p4ssword!', credentialJson: '{"x":1}' });
    expect(out.smtpPassword).not.toContain('p4ss');
    expect(out.credentialJson).not.toContain('"x":1');
  });
  it('handles a plain string input safely', () => {
    const out = maskCredentials('sk_live_xxxx_visible');
    expect(out.value).toMatch(/ible$/);
  });
  it('returns empty object for falsy input', () => {
    expect(maskCredentials(null)).toEqual({});
    expect(maskCredentials(undefined)).toEqual({});
  });
});

// ── isDebouncedNow ───────────────────────────────────────────────────────

describe('isDebouncedNow', () => {
  it('returns false when no prior send', () => {
    expect(isDebouncedNow(null)).toBe(false);
  });
  it('returns true when within the debounce window', () => {
    const now = new Date('2026-05-13T12:00:00');
    const prior = new Date(now.getTime() - 2 * 60_000); // 2 mins ago
    expect(isDebouncedNow(prior, now)).toBe(true);
  });
  it('returns false when outside the debounce window', () => {
    const now = new Date('2026-05-13T12:00:00');
    const prior = new Date(now.getTime() - (DEBOUNCE_WINDOW_MIN + 1) * 60_000);
    expect(isDebouncedNow(prior, now)).toBe(false);
  });
  it('honours a custom window', () => {
    const now = new Date('2026-05-13T12:00:00');
    const prior = new Date(now.getTime() - 8 * 60_000); // 8 mins ago
    expect(isDebouncedNow(prior, now, 10)).toBe(true);
    expect(isDebouncedNow(prior, now, 5)).toBe(false);
  });
});

// ── formatAvailabilityEmail ──────────────────────────────────────────────

describe('formatAvailabilityEmail', () => {
  const ctx = {
    entityType: 'MenuItem' as const,
    entityId: 'item-margherita',
    entityName: 'Margherita Pizza',
    restaurantName: 'Italia Pizza',
    branchName: 'Koramangala',
    actorName: 'Anita Sharma',
    actorEmail: 'anita@example.com',
    actorRole: 'KITCHEN',
    oldStatus: 'Enabled',
    newStatus: 'Disabled',
    reason: 'Out of stock',
    timestamp: new Date('2026-05-13T13:30:00Z'),
    detailUrl: 'https://maverick.app/admin/menu#item-margherita'
  };

  it('subject carries the restaurant + the entity name', () => {
    const { subject } = formatAvailabilityEmail(ctx);
    expect(subject).toContain('Italia Pizza');
    expect(subject).toContain('Margherita Pizza');
  });

  it('plain text includes every required field', () => {
    const { text } = formatAvailabilityEmail(ctx);
    for (const expected of [
      'Italia Pizza', 'Koramangala', 'Margherita Pizza',
      'Enabled', 'Disabled', 'Anita Sharma', 'KITCHEN', 'Out of stock',
      ctx.timestamp.toISOString()
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('renders bulk verb when entityType is Bulk', () => {
    const out = formatAvailabilityEmail({ ...ctx, entityType: 'Bulk', newStatus: '10 items disabled' });
    expect(out.subject).toMatch(/Bulk availability change/);
    expect(out.html).toContain('10 items disabled');
  });

  it('omits reason rows when no reason is given', () => {
    const out = formatAvailabilityEmail({ ...ctx, reason: null });
    expect(out.text).not.toMatch(/Reason:/);
  });

  it('escapes HTML in the entity name', () => {
    const out = formatAvailabilityEmail({ ...ctx, entityName: '<script>alert(1)</script>' });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

// ── formatIntegrationEmail ───────────────────────────────────────────────

describe('formatIntegrationEmail', () => {
  const base = {
    provider: 'razorpay',
    category: 'Payment gateway',
    restaurantName: 'Italia Pizza',
    actorName: 'Anita Sharma',
    actorEmail: 'anita@example.com',
    actorRole: 'ADMIN',
    timestamp: new Date('2026-05-13T13:30:00Z'),
    changedFields: {
      keyId: { from: '(not set)', to: '•••••••••••5678' },
      keySecret: { from: '•••••••••••aaaa', to: '•••••••••••bbbb' }
    },
    testStatus: null as 'pass' | 'fail' | null,
    testError: null,
    detailUrl: 'https://maverick.app/admin/settings#integrations'
  };

  it('subject reflects the test outcome when present', () => {
    expect(formatIntegrationEmail(base).subject).toMatch(/Settings changed/);
    expect(formatIntegrationEmail({ ...base, testStatus: 'pass' }).subject).toMatch(/tested OK/);
    expect(formatIntegrationEmail({ ...base, testStatus: 'fail' }).subject).toMatch(/Test failed/);
  });

  it('plain text includes the changed-field diff in masked form', () => {
    const { text } = formatIntegrationEmail(base);
    expect(text).toContain('•••••••••••5678');
    expect(text).toContain('•••••••••••aaaa → •••••••••••bbbb');
    // Never contain the raw "to" tail of more than 4 chars
    expect(text).not.toMatch(/rzp_live_/);
  });

  it('warning banner appears only on fail', () => {
    expect(formatIntegrationEmail(base).html).not.toContain('WARNING');
    const failed = formatIntegrationEmail({ ...base, testStatus: 'fail', testError: 'Auth failed' });
    expect(failed.html).toContain('WARNING');
    expect(failed.text).toContain('Test error: Auth failed');
  });

  it('every required field shows up in plain text', () => {
    const { text } = formatIntegrationEmail(base);
    for (const expected of [
      'Italia Pizza', 'razorpay', 'Payment gateway',
      'Anita Sharma', 'ADMIN', base.timestamp.toISOString()
    ]) {
      expect(text).toContain(expected);
    }
  });
});
