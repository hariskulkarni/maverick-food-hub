import { describe, it, expect, vi } from 'vitest';
import { AssignmentStatus, OrderStatus } from '@prisma/client';
import { releaseAssignmentOnOrderClose, releaseAssignmentBeforePickup } from '@/server/rider-assignment-release';

function fakeTx(status: AssignmentStatus | null) {
  return {
    riderAssignment: {
      findUnique: vi.fn().mockResolvedValue(status ? { id: 'a1', riderId: 'r1', status } : null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    riderProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    codCollection: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as any;
}

describe('releaseAssignmentOnOrderClose', () => {
  it.each([OrderStatus.DELIVERY_FAILED, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED])(
    'closes a picked-up assignment and frees the load slot on %s',
    async (next) => {
      const tx = fakeTx(AssignmentStatus.PICKED_UP);
      await expect(releaseAssignmentOnOrderClose(tx, 'o1', next)).resolves.toBe('r1');
      expect(tx.riderAssignment.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', status: AssignmentStatus.PICKED_UP },
        data: { status: AssignmentStatus.CANCELLED },
      });
      expect(tx.riderProfile.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', currentLoad: { gt: 0 } },
        data: { currentLoad: { decrement: 1 } },
      });
      // No hand-over will happen → a pending COD record is waived.
      expect(tx.codCollection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderId: 'o1', status: 'PENDING_COLLECTION' }, data: expect.objectContaining({ status: 'WAIVED' }) }),
      );
    },
  );

  it('ignores non-closing transitions', async () => {
    const tx = fakeTx(AssignmentStatus.PICKED_UP);
    await expect(releaseAssignmentOnOrderClose(tx, 'o1', OrderStatus.CUSTOMER_UNREACHABLE)).resolves.toBeNull();
    expect(tx.riderAssignment.findUnique).not.toHaveBeenCalled();
  });

  it('leaves delivered, rejected or missing assignments alone', async () => {
    for (const st of [AssignmentStatus.DELIVERED, AssignmentStatus.REJECTED, AssignmentStatus.CANCELLED, null]) {
      const tx = fakeTx(st);
      await expect(releaseAssignmentOnOrderClose(tx, 'o1', OrderStatus.DELIVERY_FAILED)).resolves.toBeNull();
      expect(tx.riderProfile.updateMany).not.toHaveBeenCalled();
    }
  });

  it('does not double-release when the assignment changed concurrently', async () => {
    const tx = fakeTx(AssignmentStatus.ACCEPTED);
    tx.riderAssignment.updateMany.mockResolvedValue({ count: 0 });
    await expect(releaseAssignmentOnOrderClose(tx, 'o1', OrderStatus.CANCELLED_BY_RESTAURANT)).resolves.toBeNull();
    expect(tx.riderProfile.updateMany).not.toHaveBeenCalled();
  });
});

describe('releaseAssignmentBeforePickup (P2-21)', () => {
  function tx(status: AssignmentStatus | null, deleted = 1) {
    return {
      riderAssignment: {
        findUnique: vi.fn().mockResolvedValue(status ? { id: 'a1', riderId: 'r1', status } : null),
        deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
      },
      riderProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as any;
  }
  it('removes an ACCEPTED assignment and frees the load slot so the order re-enters the pool', async () => {
    const t = tx(AssignmentStatus.ACCEPTED);
    await expect(releaseAssignmentBeforePickup(t, 'a1')).resolves.toBe(true);
    expect(t.riderAssignment.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', status: AssignmentStatus.ACCEPTED } });
    expect(t.riderProfile.updateMany).toHaveBeenCalledWith({ where: { id: 'r1', currentLoad: { gt: 0 } }, data: { currentLoad: { decrement: 1 } } });
  });
  it('refuses once picked up / closed, and when a concurrent change won', async () => {
    for (const st of [AssignmentStatus.PICKED_UP, AssignmentStatus.DELIVERED, null]) {
      const t = tx(st);
      await expect(releaseAssignmentBeforePickup(t, 'a1')).resolves.toBe(false);
      expect(t.riderProfile.updateMany).not.toHaveBeenCalled();
    }
    const raced = tx(AssignmentStatus.ACCEPTED, 0);
    await expect(releaseAssignmentBeforePickup(raced, 'a1')).resolves.toBe(false);
    expect(raced.riderProfile.updateMany).not.toHaveBeenCalled();
  });
});
