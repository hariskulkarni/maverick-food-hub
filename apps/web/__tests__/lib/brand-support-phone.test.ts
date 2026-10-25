import { describe, it, expect, vi, afterEach } from 'vitest';

async function load(phone: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPPORT_PHONE', phone);
  return (await import('@/lib/brand')).brand;
}

afterEach(() => vi.unstubAllEnvs());

describe('brand.supportPhone', () => {
  it('is null when unset', async () => {
    expect((await load('')).supportPhone).toBeNull();
  });
  it.each(['+919999999999', '9999999999', '+91 99999 99999', '+91-9999999999'])('is null for the placeholder %s', async (v) => {
    expect((await load(v)).supportPhone).toBeNull();
  });
  it('keeps a real number', async () => {
    expect((await load('+91 98765 43210')).supportPhone).toBe('+91 98765 43210');
  });
});
