/**
 * ─────────────────────────────────────────────────────────────────────────
 *  IAM · Maker-checker approvals (Stage 3)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  When an ADMIN_ASSIST triggers a CONFIDENTIAL action, it is recorded as a
 *  PENDING ApprovalRequest instead of executing. A SUPER_ADMIN approves (which
 *  runs the registered executor) or rejects it. A SUPER_ADMIN performing the
 *  same action runs it directly — the route calls confidentialAction() and the
 *  branch is chosen by capability.
 *
 *  Executors are the SINGLE implementation of each action, so the direct path
 *  and the approved path run identical code (no drift).
 */
import { prisma } from './db';
import { auth } from './auth';
import { audit } from './audit';
import { can, canRequestApproval, type Capability } from './permissions';
import { revalidateRestaurantSurfaces } from './revalidate';
import { unauthenticated, forbidden } from './api-auth';

type ExecCtx = { actorId?: string | null; actorRole?: string | null };

interface ApprovalActionDef {
  capability: Capability;
  resourceType?: string;
  resourceId?: (p: any) => string | undefined;
  summarize: (p: any) => Promise<string>;
  execute: (p: any, ctx: ExecCtx) => Promise<unknown>;
}

async function restaurantName(id: string): Promise<string> {
  const r = await prisma.restaurant.findUnique({ where: { id }, select: { name: true } });
  return r?.name ?? id;
}

/**
 * The registry: every confidential action that can be requested/approved. Keep
 * the executor idempotent-friendly — it may run once (direct) or later (on
 * approval), and executing a suspend twice is harmless.
 */
export const APPROVAL_ACTIONS: Record<string, ApprovalActionDef> = {
  'restaurant.suspend': {
    capability: 'restaurants:write',
    resourceType: 'Restaurant',
    resourceId: (p) => p.restaurantId,
    summarize: async (p) => `Suspend restaurant “${await restaurantName(p.restaurantId)}”`,
    execute: async (p, ctx) => {
      const r = await prisma.restaurant.update({ where: { id: p.restaurantId }, data: { status: 'SUSPENDED' } });
      revalidateRestaurantSurfaces(r.slug);
      await audit('restaurant.suspend', {
        actorId: ctx.actorId, actorRole: ctx.actorRole,
        entityType: 'Restaurant', entityId: r.id, after: { status: 'SUSPENDED' },
      }).catch(() => {});
      return { id: r.id, status: r.status };
    },
  },
  'restaurant.archive': {
    capability: 'restaurants:write',
    resourceType: 'Restaurant',
    resourceId: (p) => p.restaurantId,
    summarize: async (p) => `Archive (soft-delete) restaurant “${await restaurantName(p.restaurantId)}”`,
    execute: async (p, ctx) => {
      const cur = await prisma.restaurant.findUnique({ where: { id: p.restaurantId }, select: { slug: true, deletedAt: true } });
      if (!cur) throw new Error('Restaurant not found');
      if (cur.deletedAt) return { id: p.restaurantId, alreadyArchived: true };
      const freedSlug = `${cur.slug}--del-${Date.now().toString(36)}`.slice(0, 190);
      const r = await prisma.restaurant.update({
        where: { id: p.restaurantId },
        data: { deletedAt: new Date(), status: 'SUSPENDED', slug: freedSlug },
      });
      revalidateRestaurantSurfaces(cur.slug, r.slug);
      await audit('restaurant.suspend', {
        actorId: ctx.actorId, actorRole: ctx.actorRole,
        entityType: 'Restaurant', entityId: r.id, after: { archived: true },
      }).catch(() => {});
      return { id: r.id, status: r.status, archived: true };
    },
  },
};

export function isApprovalAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(APPROVAL_ACTIONS, action);
}

/**
 * Maker-checker gate. Called by a confidential action's route handler:
 *   return confidentialAction(req, 'restaurant.suspend', { restaurantId: id });
 *
 * - Actor holds the capability (SUPER_ADMIN) → execute now (200).
 * - Actor may request it (ADMIN_ASSIST)      → record PENDING request (202).
 * - Otherwise                                → 401 / 403.
 */
export async function confidentialAction(
  _req: Request,
  action: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const def = APPROVAL_ACTIONS[action];
  if (!def) return new Response('Unknown approval action', { status: 500 });

  const session = await auth();
  if (!session?.user) return unauthenticated();
  const role = (session.user as { role?: string }).role;

  // Direct execution for holders of the capability (super-admin).
  if (can(role, def.capability)) {
    try {
      const result = await def.execute(payload, { actorId: session.user.id, actorRole: role });
      return Response.json({ ok: true, executed: true, result });
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
    }
  }

  // Requesters (admin assist) → pending approval.
  if (canRequestApproval(role, def.capability)) {
    const summary = await def.summarize(payload);
    const ar = await prisma.approvalRequest.create({
      data: {
        action,
        capability: def.capability,
        status: 'PENDING',
        summary,
        resourceType: def.resourceType ?? null,
        resourceId: def.resourceId?.(payload) ?? null,
        payload: payload as any,
        requestedById: session.user.id!,
      },
    });
    await audit('approval.request', {
      actorId: session.user.id, actorRole: role,
      entityType: 'ApprovalRequest', entityId: ar.id, after: { action, summary },
    }).catch(() => {});
    return Response.json({ ok: true, pending: true, approvalId: ar.id, summary }, { status: 202 });
  }

  return forbidden(`This action requires the “${def.capability}” capability.`);
}

/** Approve a PENDING request: run its executor, then mark APPROVED (atomic-enough). */
export async function approveRequest(id: string, reviewer: { id: string; role?: string | null }) {
  const ar = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!ar) return { ok: false as const, error: 'not_found' };
  if (ar.status !== 'PENDING') return { ok: false as const, error: 'not_pending' };
  const def = APPROVAL_ACTIONS[ar.action];
  if (!def) return { ok: false as const, error: 'unknown_action' };

  try {
    const result = await def.execute(ar.payload as any, { actorId: ar.requestedById, actorRole: 'ADMIN_ASSIST' });
    const request = await prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewer.id, reviewedAt: new Date(), executedAt: new Date(), executionError: null },
    });
    await audit('approval.approve', {
      actorId: reviewer.id, actorRole: reviewer.role,
      entityType: 'ApprovalRequest', entityId: id, after: { action: ar.action },
    }).catch(() => {});
    return { ok: true as const, request, result };
  } catch (e) {
    // Execution failed — leave PENDING, record the error so the reviewer can retry.
    await prisma.approvalRequest.update({ where: { id }, data: { executionError: (e as Error).message } }).catch(() => {});
    return { ok: false as const, error: 'execution_failed', detail: (e as Error).message };
  }
}

/** Reject a PENDING request with an optional note. */
export async function rejectRequest(id: string, reviewer: { id: string; role?: string | null }, note?: string) {
  const ar = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!ar) return { ok: false as const, error: 'not_found' };
  if (ar.status !== 'PENDING') return { ok: false as const, error: 'not_pending' };
  const request = await prisma.approvalRequest.update({
    where: { id },
    data: { status: 'REJECTED', reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: note ?? null },
  });
  await audit('approval.reject', {
    actorId: reviewer.id, actorRole: reviewer.role,
    entityType: 'ApprovalRequest', entityId: id, after: { note: note ?? null },
  }).catch(() => {});
  return { ok: true as const, request };
}
