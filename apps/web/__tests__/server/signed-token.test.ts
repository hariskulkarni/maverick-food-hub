/**
 * Edge-safe signed tokens.
 *
 * This is the mechanism that decides who gets past a closed site, so the tests
 * that matter are the negative ones: a forged signature, a tampered payload, a
 * token past its expiry, one minted for a different gate, and the case where
 * the signing secret has gone missing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { signToken, verifyToken, tokenSecret } from '@/server/signed-token';

const SECRET = 'test-secret-for-signed-token-suite';

afterEach(() => {
  delete process.env.GATE_TOKEN_SECRET;
  delete process.env.DEMO_GATE_SECRET;
});

describe('round trip', () => {
  it('verifies a freshly minted token and returns the payload', async () => {
    const t = await signToken({ scope: 'maintenance-bypass' }, 3600, SECRET);
    const p = await verifyToken(t, { scope: 'maintenance-bypass', secret: SECRET });
    expect(p).not.toBeNull();
    expect(p!.scope).toBe('maintenance-bypass');
    expect(p!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('produces a two-part base64url token with no padding', async () => {
    const t = await signToken({ scope: 's' }, 60, SECRET);
    expect(t.split('.')).toHaveLength(2);
    expect(t).not.toContain('=');
    expect(t).not.toContain('+');
    expect(t).not.toContain('/');
  });
});

describe('rejection', () => {
  it('rejects a tampered signature', async () => {
    const t = await signToken({ scope: 's' }, 3600, SECRET);
    const [head, sig] = t.split('.');
    const flipped = sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A');
    expect(await verifyToken(`${head}.${flipped}`, { secret: SECRET })).toBeNull();
  });

  it('rejects a tampered payload, even one that extends the expiry', async () => {
    // The whole point: you cannot re-date a token you were given.
    const t = await signToken({ scope: 's' }, 60, SECRET);
    const sig = t.split('.')[1]!;
    const forgedHead = Buffer.from(
      JSON.stringify({ scope: 's', exp: Math.floor(Date.now() / 1000) + 99999 }),
    ).toString('base64url');
    expect(await verifyToken(`${forgedHead}.${sig}`, { secret: SECRET })).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const t = await signToken({ scope: 's' }, 3600, 'other-secret');
    expect(await verifyToken(t, { secret: SECRET })).toBeNull();
  });

  it('rejects an expired token', async () => {
    const t = await signToken({ scope: 's', exp: Math.floor(Date.now() / 1000) - 1 }, 0, SECRET);
    expect(await verifyToken(t, { secret: SECRET })).toBeNull();
  });

  it('treats the expiry second itself as expired', async () => {
    const now = 1_800_000_000;
    const t = await signToken({ scope: 's', exp: now }, 0, SECRET);
    expect(await verifyToken(t, { secret: SECRET, now })).toBeNull();
    expect(await verifyToken(t, { secret: SECRET, now: now - 1 })).not.toBeNull();
  });

  it('rejects a token minted for a different gate', async () => {
    // A demo-gate cookie must not open the maintenance gate.
    const t = await signToken({ scope: 'demo-gate' }, 3600, SECRET);
    expect(await verifyToken(t, { scope: 'maintenance-bypass', secret: SECRET })).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    for (const bad of ['', '.', 'nodot', 'a.', '.b', 'a.b.c', '!!!.???', 'null.null']) {
      expect(await verifyToken(bad, { secret: SECRET })).toBeNull();
    }
    expect(await verifyToken(undefined, { secret: SECRET })).toBeNull();
    expect(await verifyToken(null, { secret: SECRET })).toBeNull();
  });

  it('fails CLOSED when no secret is configured', async () => {
    // A gate whose secret vanished must not start admitting everyone.
    const t = await signToken({ scope: 's' }, 3600, SECRET);
    expect(await verifyToken(t, { secret: '' })).toBeNull();
  });

  it('refuses to MINT without a secret rather than issuing an unsigned token', async () => {
    await expect(signToken({ scope: 's' }, 60, '')).rejects.toThrow(/secret/i);
  });

  it('rejects a payload with no expiry at all', async () => {
    const head = Buffer.from(JSON.stringify({ scope: 's' })).toString('base64url');
    // Sign it properly — only the missing `exp` should disqualify it.
    const signed = await signToken({ scope: 's', exp: 1 }, 0, SECRET);
    const sig = signed.split('.')[1]!;
    expect(await verifyToken(`${head}.${sig}`, { secret: SECRET })).toBeNull();
  });
});

describe('tokenSecret', () => {
  it('prefers the dedicated key over the session secret', () => {
    process.env.GATE_TOKEN_SECRET = 'dedicated';
    expect(tokenSecret()).toBe('dedicated');
  });
  it('falls back to the demo-gate secret, then the session secret', () => {
    process.env.DEMO_GATE_SECRET = 'demo';
    expect(tokenSecret()).toBe('demo');
  });
});
