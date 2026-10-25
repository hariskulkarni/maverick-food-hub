/**
 * Defect 11 — /refunds must match the code: there is no customer self-cancel
 * route, refunds are issued manually by support (default: wallet), and there is
 * no promised bank timeline.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const page = readFileSync(path.resolve(__dirname, '../../src/app/(customer)/refunds/page.tsx'), 'utf8');

describe('/refunds policy copy', () => {
  it('does not promise self-service cancellation (no customer cancel route exists)', () => {
    expect(existsSync(path.resolve(__dirname, '../../src/app/api/orders/[id]/cancel/route.ts'))).toBe(false);
    expect(page).not.toMatch(/cancel from your order screen/i);
    expect(page).toMatch(/no cancel button/i);
  });
  it('does not promise a 5–7 day refund timeline', () => {
    expect(page).not.toMatch(/5\s*[–-]\s*7/);
  });
  it('says refunds are reviewed and default to the wallet', () => {
    expect(page).toMatch(/Refunds are not automatic/);
    expect(page).toMatch(/wallet \(default\)/);
  });
});
