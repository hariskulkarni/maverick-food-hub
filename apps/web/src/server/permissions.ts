/**
 * ─────────────────────────────────────────────────────────────────────────
 *  IAM · Capability model (single source of truth)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  Flavrly has a single global `Role` per user plus per-restaurant grants
 *  (RestaurantUser). This module layers a capability matrix on top of the
 *  PLATFORM-team roles so the /platform console can be delegated safely:
 *
 *    SUPER_ADMIN   — the platform owner. Holds every capability, incl. IAM
 *                    (create users, assign/revoke roles) across all restaurants.
 *    ADMIN_ASSIST  — runs day-to-day ops + riders and can build most things.
 *                    CONFIDENTIAL capabilities (iam:manage, finance:write,
 *                    restaurants:write) are withheld — in Stage 3 those become
 *                    approval requests routed to a SUPER_ADMIN.
 *    DEVELOPER     — full CMS access (discovery + storefront content). Nothing
 *                    operational or financial.
 *    QA            — read-everything-they-can-build-in-CMS + a test/preview
 *                    capability. No write, no finance.
 *    GUEST         — pure read-only across the surfaces it can reach.
 *
 *  This file is intentionally PURE (type-only Prisma import) so it is safe to
 *  import from the Edge middleware as well as server components / route
 *  handlers. Do NOT add node-only or `@/server/db` imports here.
 */
import type { Role } from '@prisma/client';

export type Capability =
  | 'platform:view' // may load the /platform console at all
  | 'platform:admin' // SUPER_ADMIN-only surfaces (analytics, users, audit, security, monitoring)
  | 'iam:manage' // create users, assign / revoke roles  (CONFIDENTIAL)
  | 'cms:read'
  | 'cms:write'
  | 'ops:read'
  | 'ops:write'
  | 'riders:read'
  | 'riders:write'
  | 'finance:read'
  | 'finance:write' // payouts / settlements / COD  (CONFIDENTIAL)
  | 'restaurants:read'
  | 'restaurants:write' // suspend / archive / delete restaurants  (CONFIDENTIAL)
  | 'qa:test' // exercise preview / test surfaces built via the CMS
  | 'approvals:review'; // approve/reject confidential requests (SUPER_ADMIN)

/** Every capability that exists — handy for SUPER_ADMIN and for tests. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  'platform:view',
  'platform:admin',
  'iam:manage',
  'cms:read',
  'cms:write',
  'ops:read',
  'ops:write',
  'riders:read',
  'riders:write',
  'finance:read',
  'finance:write',
  'restaurants:read',
  'restaurants:write',
  'qa:test',
  'approvals:review',
] as const;

/**
 * Capabilities that ADMIN_ASSIST may *request* but not perform directly — a
 * SUPER_ADMIN must approve. Enforced by the Stage-3 approval workflow; kept
 * here so the matrix and the workflow never drift.
 */
export const CONFIDENTIAL_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'iam:manage',
  'finance:write',
  'restaurants:write',
]);

/**
 * The role → capability matrix. Only PLATFORM-team roles appear with grants;
 * the restaurant-scoped roles (ADMIN, KITCHEN) and end-user roles (CUSTOMER,
 * RIDER) hold NO platform capabilities — their access flows through the
 * existing tenancy helpers, untouched.
 */
export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  SUPER_ADMIN: new Set(ALL_CAPABILITIES),

  ADMIN_ASSIST: new Set<Capability>([
    'platform:view',
    'cms:read',
    'cms:write',
    'ops:read',
    'ops:write',
    'riders:read',
    'riders:write',
    'restaurants:read',
    'qa:test',
    // withheld (confidential → Stage-3 approval): iam:manage, finance:*, restaurants:write, platform:admin
  ]),

  DEVELOPER: new Set<Capability>([
    'platform:view',
    'cms:read',
    'cms:write',
    'restaurants:read', // to pick which restaurant's storefront CMS to edit
  ]),

  QA: new Set<Capability>([
    'platform:view',
    'qa:test',
    'cms:read',
    'ops:read',
    'riders:read',
    'restaurants:read',
  ]),

  GUEST: new Set<Capability>([
    'platform:view',
    'cms:read',
    'ops:read',
    'riders:read',
    'restaurants:read',
  ]),

  // Non-platform roles — deliberately empty. Their access is enforced by the
  // existing per-restaurant tenancy layer, not by this matrix.
  ADMIN: new Set<Capability>(),
  KITCHEN: new Set<Capability>(),
  CUSTOMER: new Set<Capability>(),
  RIDER: new Set<Capability>(),
};

/** The platform-team roles a SUPER_ADMIN can assign via /platform/iam. */
export const ASSIGNABLE_PLATFORM_ROLES: readonly Role[] = [
  'ADMIN_ASSIST',
  'DEVELOPER',
  'QA',
  'GUEST',
] as unknown as Role[];

/** Roles allowed to load the /platform console (hold `platform:view`). */
export const PLATFORM_ROLES: readonly Role[] = (
  Object.keys(ROLE_CAPABILITIES) as Role[]
).filter((r) => ROLE_CAPABILITIES[r].has('platform:view'));

/** True when `role` holds `capability`. Unknown roles → false (deny by default). */
export function can(role: Role | string | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  const caps = ROLE_CAPABILITIES[role as Role];
  return caps ? caps.has(capability) : false;
}

/** True when `role` holds ANY of the given capabilities. */
export function canAny(role: Role | string | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

/** Sorted list of a role's capabilities (for UIs / debugging). */
export function capabilitiesFor(role: Role | string | null | undefined): Capability[] {
  if (!role) return [];
  const caps = ROLE_CAPABILITIES[role as Role];
  return caps ? Array.from(caps).sort() : [];
}

/** True when `role` may load the platform console at all. */
export function isPlatformRole(role: Role | string | null | undefined): boolean {
  return can(role, 'platform:view');
}

/** True when a capability is confidential (needs SUPER_ADMIN approval for ADMIN_ASSIST). */
export function isConfidential(capability: Capability): boolean {
  return CONFIDENTIAL_CAPABILITIES.has(capability);
}

/** Roles that may REQUEST a confidential action (routed for SUPER_ADMIN approval). */
export const APPROVAL_REQUESTER_ROLES: readonly Role[] = ['ADMIN_ASSIST'] as unknown as Role[];

/**
 * True when `role` cannot perform `capability` directly but is allowed to
 * submit it as an approval request (maker-checker). Today: ADMIN_ASSIST on any
 * confidential capability.
 */
export function canRequestApproval(role: Role | string | null | undefined, capability: Capability): boolean {
  if (!role || can(role, capability)) return false;
  return isConfidential(capability) && (APPROVAL_REQUESTER_ROLES as unknown as string[]).includes(role);
}

/**
 * Page-level capability gates for the middleware. Longest-prefix wins; any
 * /platform path not matched here falls back to `platform:view` (i.e. every
 * platform role may see it). Keep in sync with the API guards on each surface.
 */
const RAW_PAGE_GATES: ReadonlyArray<{ prefix: string; capability: Capability }> = [
  { prefix: '/platform/iam', capability: 'iam:manage' },
  // SUPER_ADMIN-only surfaces
  { prefix: '/platform/users', capability: 'platform:admin' },
  { prefix: '/platform/analytics', capability: 'platform:admin' },
  { prefix: '/platform/reports', capability: 'platform:admin' },
  { prefix: '/platform/audit-log', capability: 'platform:admin' },
  { prefix: '/platform/observability', capability: 'platform:admin' },
  { prefix: '/platform/system-health', capability: 'platform:admin' },
  { prefix: '/platform/security', capability: 'platform:admin' },
  { prefix: '/platform/brands', capability: 'platform:admin' },
  { prefix: '/platform/kyc', capability: 'platform:admin' },
  { prefix: '/platform/qr', capability: 'platform:admin' },
  // Finance (confidential) — SUPER_ADMIN only until Stage-3 approvals
  { prefix: '/platform/payouts', capability: 'finance:read' },
  { prefix: '/platform/settlements', capability: 'finance:read' },
  { prefix: '/platform/cod', capability: 'finance:read' },
  { prefix: '/platform/rider-payouts', capability: 'finance:read' },
  { prefix: '/platform/rider-incentives', capability: 'finance:read' },
  { prefix: '/platform/signup-bonus', capability: 'finance:read' },
  // CMS
  { prefix: '/platform/discovery-cms', capability: 'cms:read' },
  { prefix: '/platform/training-modules', capability: 'cms:read' },
  // Restaurants
  { prefix: '/platform/restaurants', capability: 'restaurants:read' },
  // Riders
  { prefix: '/platform/rider-shifts', capability: 'riders:read' },
  { prefix: '/platform/rider-tiers', capability: 'riders:read' },
  { prefix: '/platform/rider-referrals', capability: 'riders:read' },
  { prefix: '/platform/rider-support', capability: 'riders:read' },
  { prefix: '/platform/rider-sos', capability: 'riders:read' },
  { prefix: '/platform/rider-incidents', capability: 'riders:read' },
  { prefix: '/platform/riders', capability: 'riders:read' },
  // Ops
  { prefix: '/platform/orders', capability: 'ops:read' },
  { prefix: '/platform/live', capability: 'ops:read' }, // /live and /live-ops
  { prefix: '/platform/support', capability: 'ops:read' },
  { prefix: '/platform/surge-zones', capability: 'ops:read' },
  { prefix: '/platform/messages', capability: 'ops:read' },
  { prefix: '/platform/feedback', capability: 'ops:read' },
];

/** Page gates, longest-prefix first (so the most specific match wins). */
export const PLATFORM_PAGE_GATES: ReadonlyArray<{ prefix: string; capability: Capability }> =
  RAW_PAGE_GATES.slice().sort((a, b) => b.prefix.length - a.prefix.length);

/** Resolve the capability required to VIEW a /platform path (longest-prefix match). */
export function pageGateFor(path: string): Capability {
  const hit = PLATFORM_PAGE_GATES.find((g) => path === g.prefix || path.startsWith(g.prefix + '/') || path.startsWith(g.prefix));
  return hit ? hit.capability : 'platform:view';
}

/** Human-friendly role names for the IAM console. */
export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN_ASSIST: 'Admin Assist',
  DEVELOPER: 'Developer',
  QA: 'QA',
  GUEST: 'Guest',
  ADMIN: 'Restaurant Admin',
  KITCHEN: 'Kitchen',
  CUSTOMER: 'Customer',
  RIDER: 'Rider',
};

/** Short plain-English description of each capability, for tooltips / chips. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'platform:view': 'Open the platform console',
  'platform:admin': 'Super-admin surfaces (analytics, users, audit, security)',
  'iam:manage': 'Create users & assign roles',
  'cms:read': 'View the CMS',
  'cms:write': 'Edit the CMS (content)',
  'ops:read': 'View operations (orders, live-ops, support)',
  'ops:write': 'Run operations',
  'riders:read': 'View riders',
  'riders:write': 'Manage riders',
  'finance:read': 'View finance (payouts, settlements)',
  'finance:write': 'Move money (payouts, settlements)',
  'restaurants:read': 'View restaurants',
  'restaurants:write': 'Suspend / archive / delete restaurants',
  'qa:test': 'Exercise test / preview surfaces',
  'approvals:review': 'Approve/reject confidential requests',
};
