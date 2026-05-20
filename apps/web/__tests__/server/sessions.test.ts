/**
 * Unit tests for single-active-session enforcement (server/sessions.ts).
 * The safety-critical property: a token whose sid is no longer the user's
 * current session must be rejected (→ forced logout), while a matching sid and
 * a grandfathered (missing) sid are accepted, and DB errors fail OPEN so a blip
 * never locks out a legitimate user.
 *
 * sessions.ts uses prisma.user / prisma.userSession + $transaction, so we mock
 * the prisma singleton (same pattern as the other server tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userUpdateMany = vi.fn();
const sessFindMany = vi.fn();
const sessCreate = vi.fn();
const sessUpdate = vi.fn();
const sessUpdateMany = vi.fn();
const txFn = vi.fn();

vi.mock('@/server/db', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      updateMany: (...a: unknown[]) => userUpdateMany(...a),
    },
    userSession: {
      findMany: (...a: unknown[]) => sessFindMany(...a),
      create: (...a: unknown[]) => sessCreate(...a),
      update: (...a: unknown[]) => sessUpdate(...a),
      updateMany: (...a: unknown[]) => sessUpdateMany(...a),
    },
    $transaction: (cb: any) => txFn(cb),
  },
}));

import { startSession, isSessionActive, revokeSession } from '@/server/sessions';

beforeEach(() => {
  userFindUnique.mockReset();
  userUpdate.mockReset();
  userUpdateMany.mockReset();
  sessFindMany.mockReset();
  sessCreate.mockReset();
  sessUpdate.mockReset();
  sessUpdateMany.mockReset();
  txFn.mockReset();
  // Default: run the transaction callback against a tx that proxies to the mocks.
  txFn.mockImplementation((cb: any) =>
    cb({
      user: { update: (...a: unknown[]) => userUpdate(...a), updateMany: (...a: unknown[]) => userUpdateMany(...a) },
      userSession: {
        create: (...a: unknown[]) => sessCreate(...a),
        update: (...a: unknown[]) => sessUpdate(...a),
        updateMany: (...a: unknown[]) => sessUpdateMany(...a),
      },
    })
  );
});

describe('startSession', () => {
  it('revokes prior sessions, creates a new one, and points the user at it', async () => {
    sessUpdateMany.mockResolvedValue({ count: 2 });
    sessCreate.mockResolvedValue({ id: 'sess-new' });
    userUpdate.mockResolvedValue({});
    const sid = await startSession('user-1', { userAgent: 'UA', ipAddress: '1.2.3.4' });
    expect(sid).toBe('sess-new');
    // prior active sessions revoked as "superseded"
    expect(sessUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', revokedAt: null },
        data: expect.objectContaining({ revokedReason: 'superseded' }),
      })
    );
    // user.currentSessionId repointed to the new session
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { currentSessionId: 'sess-new' } })
    );
  });

  it('returns null on DB failure (login still proceeds without enforcement)', async () => {
    txFn.mockRejectedValue(new Error('db down'));
    const sid = await startSession('user-1');
    expect(sid).toBeNull();
  });
});

describe('isSessionActive', () => {
  it('grandfathers a missing sid (pre-rollout token) as valid', async () => {
    expect(await isSessionActive('user-1', undefined)).toBe(true);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('accepts a sid that matches the user current session', async () => {
    userFindUnique.mockResolvedValue({ currentSessionId: 'sess-A' });
    sessUpdate.mockResolvedValue({});
    expect(await isSessionActive('user-1', 'sess-A')).toBe(true);
  });

  it('rejects a sid that was superseded by a newer login', async () => {
    userFindUnique.mockResolvedValue({ currentSessionId: 'sess-B' });
    expect(await isSessionActive('user-1', 'sess-A')).toBe(false);
  });

  it('rejects when the user no longer exists', async () => {
    userFindUnique.mockResolvedValue(null);
    expect(await isSessionActive('ghost', 'sess-A')).toBe(false);
  });

  it('fails OPEN on a transient DB error (no lockout over a blip)', async () => {
    userFindUnique.mockRejectedValue(new Error('timeout'));
    expect(await isSessionActive('user-1', 'sess-A')).toBe(true);
  });
});

describe('revokeSession', () => {
  it('marks the session revoked and clears the user pointer', async () => {
    sessUpdate.mockResolvedValue({});
    userUpdateMany.mockResolvedValue({ count: 1 });
    await revokeSession('sess-A', 'user_terminated');
    expect(sessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-A' },
        data: expect.objectContaining({ revokedReason: 'user_terminated' }),
      })
    );
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currentSessionId: 'sess-A' }, data: { currentSessionId: null } })
    );
  });
});
