/**
 * Play Integrity verdict handling. The Google client is injected (never a real
 * network call or credentials): we assert the label→verdict mapping and the
 * degrade paths (not configured, decode error).
 */
import { describe, it, expect } from 'vitest';
import { mapVerdict, verifyIntegrityToken, type DecodeClient } from '@/server/rider-integrity/play-integrity';

const client = (labels: string[]): DecodeClient => ({
  async decode() {
    return { deviceRecognitionVerdict: labels };
  },
});
const throwingClient: DecodeClient = {
  async decode() {
    throw new Error('400 from Google');
  },
};

describe('mapVerdict', () => {
  it('device / strong integrity passes', () => {
    expect(mapVerdict(['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'])).toBe('MEETS_DEVICE_INTEGRITY');
    expect(mapVerdict(['MEETS_STRONG_INTEGRITY'])).toBe('MEETS_DEVICE_INTEGRITY');
  });
  it('basic-only is a weaker pass', () => {
    expect(mapVerdict(['MEETS_BASIC_INTEGRITY'])).toBe('MEETS_BASIC_INTEGRITY');
  });
  it('empty or emulator-only fails', () => {
    expect(mapVerdict([])).toBe('FAILED');
    expect(mapVerdict(['MEETS_VIRTUAL_INTEGRITY'])).toBe('FAILED');
  });
});

describe('verifyIntegrityToken (injected client)', () => {
  it('maps a genuine device to a pass verdict', async () => {
    const r = await verifyIntegrityToken('tok', client(['MEETS_DEVICE_INTEGRITY']));
    expect(r).toMatchObject({ configured: true, verdict: 'MEETS_DEVICE_INTEGRITY' });
  });
  it('maps an empty verdict to FAILED', async () => {
    const r = await verifyIntegrityToken('tok', client([]));
    expect(r.verdict).toBe('FAILED');
    expect(r.detail).toBe('no_device_verdict');
  });
  it('a decode error degrades to UNEVALUATED (never punishes)', async () => {
    const r = await verifyIntegrityToken('tok', throwingClient);
    expect(r).toMatchObject({ configured: true, verdict: 'UNEVALUATED', detail: 'decode_error' });
  });
  it('not configured (no client, no env) → configured:false / UNEVALUATED', async () => {
    delete process.env.PLAY_INTEGRITY_PACKAGE_NAME;
    delete process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT;
    const r = await verifyIntegrityToken('tok');
    expect(r).toMatchObject({ configured: false, verdict: 'UNEVALUATED' });
  });
});
