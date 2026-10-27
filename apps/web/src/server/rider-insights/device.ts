/**
 * Rider device context — sent by the rider app with its heartbeat and
 * background location batches while the rider is online.
 *
 * The schema is strict: only these fields are accepted. Anything else (IMEI,
 * installed/running apps, call state, …) makes the whole `device` object
 * invalid and it is dropped — the heartbeat / location post itself still
 * succeeds. Stored as one latest row per rider (RiderDeviceSnapshot) plus a
 * thinned history (RiderDeviceSample) pruned by the retention job.
 */
import { z } from 'zod';
import { prisma } from '../db';

export const NETWORK_TYPES = ['WIFI', 'CELLULAR', 'ETHERNET', 'NONE', 'OTHER', 'UNKNOWN'] as const;
export const CELL_GENERATIONS = ['2g', '3g', '4g', '5g'] as const;

export const DeviceContext = z
  .object({
    model: z.string().trim().min(1).max(80).optional(),
    osName: z.string().trim().min(1).max(24).optional(),
    osVersion: z.string().trim().min(1).max(24).optional(),
    appVersion: z.string().trim().min(1).max(32).optional(),
    appBuild: z.string().trim().min(1).max(32).optional(),
    network: z.enum(NETWORK_TYPES).optional(),
    cellGen: z.enum(CELL_GENERATIONS).optional(),
    battery: z.number().int().min(0).max(100).optional(),
    charging: z.boolean().optional(),
  })
  .strict();
export type DeviceContext = z.infer<typeof DeviceContext>;

/** Validate an untrusted `device` value; null when absent, invalid or empty. */
export function parseDevice(raw: unknown): DeviceContext | null {
  if (raw === undefined || raw === null) return null;
  const r = DeviceContext.safeParse(raw);
  if (!r.success) return null;
  return Object.keys(r.data).length > 0 ? r.data : null;
}

/** History is thinned to one row per SAMPLE_INTERVAL_MS unless something notable changed. */
export const SAMPLE_INTERVAL_MS = 5 * 60_000;

type SnapshotFields = {
  deviceModel: string | null;
  osName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  appBuild: string | null;
  networkType: string | null;
  cellularGeneration: string | null;
  batteryLevel: number | null;
  charging: boolean | null;
};

export function toSnapshotFields(d: DeviceContext, prev?: Partial<SnapshotFields> | null): SnapshotFields {
  // Fields the app didn't send this time keep their previous value (the static
  // ones — model, OS — may be sent less often than battery/network).
  const keep = <K extends keyof SnapshotFields>(k: K, v: SnapshotFields[K] | undefined) =>
    (v !== undefined ? v : (prev?.[k] ?? null)) as SnapshotFields[K];
  return {
    deviceModel: keep('deviceModel', d.model),
    osName: keep('osName', d.osName),
    osVersion: keep('osVersion', d.osVersion),
    appVersion: keep('appVersion', d.appVersion),
    appBuild: keep('appBuild', d.appBuild),
    networkType: keep('networkType', d.network),
    cellularGeneration: d.network !== undefined && d.network !== 'CELLULAR' ? null : keep('cellularGeneration', d.cellGen),
    batteryLevel: keep('batteryLevel', d.battery),
    charging: keep('charging', d.charging),
  };
}

export function shouldWriteSample(
  prev: (Partial<SnapshotFields> & { historyAt?: Date | null }) | null,
  next: SnapshotFields,
  now: number
): boolean {
  if (!prev || !prev.historyAt) return true;
  if (now - prev.historyAt.getTime() >= SAMPLE_INTERVAL_MS) return true;
  return (
    prev.networkType !== next.networkType ||
    prev.cellularGeneration !== next.cellularGeneration ||
    prev.charging !== next.charging ||
    prev.appVersion !== next.appVersion
  );
}

/**
 * Store device context for an online rider. Never throws (best-effort
 * telemetry must never fail a heartbeat or location post). `online` lets the
 * caller pass what it already knows; otherwise the profile is read.
 */
export async function recordDeviceContext(
  riderId: string,
  device: DeviceContext,
  opts: { online?: boolean; now?: Date } = {}
): Promise<void> {
  try {
    const now = opts.now ?? new Date();
    const [profile, prev] = await Promise.all([
      opts.online === undefined
        ? prisma.riderProfile.findUnique({ where: { id: riderId }, select: { isOnline: true } })
        : Promise.resolve({ isOnline: opts.online }),
      prisma.riderDeviceSnapshot.findUnique({ where: { riderId } }),
    ]);
    // Collected only while on duty: an offline rider's posts never store it.
    if (!profile?.isOnline) return;

    const fields = toSnapshotFields(device, prev);
    const sample = shouldWriteSample(prev, fields, now.getTime());
    await prisma.riderDeviceSnapshot.upsert({
      where: { riderId },
      create: { riderId, ...fields, capturedAt: now, historyAt: now },
      update: { ...fields, capturedAt: now, ...(sample ? { historyAt: now } : {}) },
    });
    if (sample) await prisma.riderDeviceSample.create({ data: { riderId, ...fields, capturedAt: now } });
  } catch {
    // best-effort
  }
}
