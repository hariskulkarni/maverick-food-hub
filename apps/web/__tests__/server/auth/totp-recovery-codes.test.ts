/**
 * Lead item 5: TOTP recovery codes — generated at enrolment, shown once,
 * stored hashed, single use; a lost authenticator has a self-service path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { id: string; userId: string; codeHash: string; usedAt: Date | null };
const rows: Row[] = [];
const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn() },
    totpRecoveryCode: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/crypto', () => ({ encryptJSON: (v: unknown) => JSON.stringify(v), decryptJSON: (b: string) => JSON.parse(b) }));

import { generateRecoveryCodes, consumeRecoveryCode, isRecoveryCodeFormat } from '@/server/user-totp';

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.totpRecoveryCode.deleteMany.mockImplementation(async ({ where }: any) => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].userId === where.userId) rows.splice(i, 1);
    return { count: 0 };
  });
  db.totpRecoveryCode.createMany.mockImplementation(async ({ data }: any) => {
    for (const d of data) rows.push({ id: String(rows.length), usedAt: null, ...d });
    return { count: data.length };
  });
  db.totpRecoveryCode.updateMany.mockImplementation(async ({ where, data }: any) => {
    const r = rows.find((x) => x.userId === where.userId && x.codeHash === where.codeHash && x.usedAt === null);
    if (!r) return { count: 0 };
    r.usedAt = data.usedAt;
    return { count: 1 };
  });
});

describe('recovery codes', () => {
  it('generates 10 distinct codes, stores only hashes, replaces old ones', async () => {
    const first = await generateRecoveryCodes('u1');
    const codes = await generateRecoveryCodes('u1');
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(rows).toHaveLength(10);
    for (const c of codes) {
      expect(isRecoveryCodeFormat(c)).toBe(true);
      expect(rows.some((r) => r.codeHash === c)).toBe(false); // hashed, never plaintext
    }
    expect(first.some((c) => codes.includes(c))).toBe(false);
  });
  it('a code works once (case/space-insensitive), then never again', async () => {
    const [c] = await generateRecoveryCodes('u1');
    expect(await consumeRecoveryCode('u1', ` ${c.toLowerCase()} `)).toBe(true);
    expect(await consumeRecoveryCode('u1', c)).toBe(false);
  });
  it("another user's code or garbage is refused", async () => {
    const [c] = await generateRecoveryCodes('u1');
    expect(await consumeRecoveryCode('u2', c)).toBe(false);
    expect(await consumeRecoveryCode('u1', 'nope')).toBe(false);
  });
  it('6-digit TOTP codes are not recovery-code format', () => {
    expect(isRecoveryCodeFormat('123456')).toBe(false);
  });
});
