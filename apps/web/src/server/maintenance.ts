/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Maintenance / under-construction mode
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  One switch closes the WHOLE platform — flavrly.in and portal.flavrly.in,
 *  customers and staff alike, up to and including SUPER_ADMIN. There is
 *  deliberately NO user interface for it anywhere in the product: it is
 *  flipped from a shell on the server with
 *
 *      npm run maintenance:on  --prefix apps/web
 *      npm run maintenance:off --prefix apps/web
 *
 *  Why no UI: the point of this switch is to hold the door shut during a
 *  migration or an incident. A control that a signed-in admin can toggle is a
 *  control that can be toggled by anyone who gets hold of an admin session,
 *  which is exactly the situation it exists to contain.
 *
 *  Storage is the standalone `PlatformFlag` table — NOT the encrypted
 *  platform-config blob that the discovery radius and rider-ops flags use.
 *  That blob is written through `setPlatformSecurity`, which bootstraps a
 *  sentinel Restaurant row and so requires a SUPER_ADMIN user to exist. The
 *  switch you reach for during an incident must not depend on other rows
 *  being present, on a foreign key, or on the encryption key being readable.
 *
 *  Read uncached and straight from the row: Edge middleware polls
 *  `/api/system/maintenance` about once every 10 seconds, so a direct query at
 *  that rate costs nothing and keeps a flip visible immediately rather than
 *  after a cache TTL.
 *
 *  NODE ONLY. Reaches the database, so it must never be imported from Edge
 *  middleware — the pure path policy lives in `./maintenance-paths`.
 */

import { prisma } from './db';

/** Primary key of the row holding maintenance state. */
export const MAINTENANCE_FLAG_KEY = 'maintenance';

export interface MaintenanceState {
  on: boolean;
  /** Shown on the holding page under the headline. Null → the default copy. */
  message: string | null;
  /** ISO timestamp the window was opened. */
  since: string | null;
  /** Who turned it on, for the audit trail (e.g. 'cli:deploy@flavrly-vps'). */
  by: string | null;
}

export const MAINTENANCE_OFF: MaintenanceState = { on: false, message: null, since: null, by: null };

/** Longest message the holding page renders without looking broken. */
export const MAX_MAINTENANCE_MESSAGE = 280;

/** Collapse whitespace, trim, cap length. Anything non-string or blank → null. */
export function normalizeMaintenanceMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_MAINTENANCE_MESSAGE);
}

/**
 * Current state.
 *
 * Fails OPEN: if the config blob can't be read (database down, decryption
 * failure) we report "not in maintenance". A read error must not be able to
 * close the site — that would turn a transient database blip into a
 * self-inflicted outage, and one you couldn't switch off, because the switch
 * itself lives in the database.
 */
export async function getMaintenance(): Promise<MaintenanceState> {
  const row = await prisma.platformFlag
    .findUnique({ where: { key: MAINTENANCE_FLAG_KEY } })
    .catch(() => null);
  const v = (row?.value ?? null) as { on?: unknown; message?: unknown; since?: unknown } | null;
  if (!v || v.on !== true) return MAINTENANCE_OFF;
  return {
    on: true,
    message: normalizeMaintenanceMessage(v.message),
    since: typeof v.since === 'string' && v.since ? v.since : (row?.updatedAt?.toISOString() ?? null),
    by: row?.updatedBy ?? null,
  };
}

/**
 * Open or close the window. Returns the resulting state.
 *
 * The row's `value` is replaced wholesale on every write, so turning
 * maintenance off leaves no stale message behind for a later window to
 * resurface.
 */
export async function setMaintenance(
  on: boolean,
  opts: { message?: string | null; by?: string | null } = {},
): Promise<MaintenanceState> {
  const by = typeof opts.by === 'string' && opts.by.trim() ? opts.by.trim().slice(0, 120) : null;

  if (!on) {
    // Write the row rather than deleting it, so `updatedBy`/`updatedAt` keep a
    // record of who reopened the site and when.
    await prisma.platformFlag.upsert({
      where: { key: MAINTENANCE_FLAG_KEY },
      update: { value: { on: false }, updatedBy: by },
      create: { key: MAINTENANCE_FLAG_KEY, value: { on: false }, updatedBy: by },
    });
    return MAINTENANCE_OFF;
  }

  const current = await getMaintenance();
  const message = normalizeMaintenanceMessage(opts.message);
  // Keep the original start time across a re-enable so "since" stays honest.
  const since = current.on && current.since ? current.since : new Date().toISOString();
  const value = { on: true, since, ...(message ? { message } : {}) };

  await prisma.platformFlag.upsert({
    where: { key: MAINTENANCE_FLAG_KEY },
    update: { value, updatedBy: by },
    create: { key: MAINTENANCE_FLAG_KEY, value, updatedBy: by },
  });

  return { on: true, message, since, by };
}
