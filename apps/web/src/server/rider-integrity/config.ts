/**
 * Rider anti-fraud policy (RiderIntegrityConfig singleton). Enforcement actions
 * default OFF: a suspect rider is always flagged for ops review, never silently
 * hard-blocked. Reads never throw — a missing row returns the safe defaults.
 */
import { prisma } from '../db';

export interface RiderIntegrityConfigDTO {
  mockPingThreshold: number;
  autoPauseOffers: boolean;
  gateOnlineOnFailed: boolean;
}

export const INTEGRITY_CONFIG_DEFAULTS: RiderIntegrityConfigDTO = {
  mockPingThreshold: 3,
  autoPauseOffers: false,
  gateOnlineOnFailed: false,
};

export async function getIntegrityConfig(): Promise<RiderIntegrityConfigDTO> {
  try {
    const row = await prisma.riderIntegrityConfig.findUnique({ where: { id: 'singleton' } });
    if (!row) return { ...INTEGRITY_CONFIG_DEFAULTS };
    return {
      mockPingThreshold: row.mockPingThreshold,
      autoPauseOffers: row.autoPauseOffers,
      gateOnlineOnFailed: row.gateOnlineOnFailed,
    };
  } catch {
    return { ...INTEGRITY_CONFIG_DEFAULTS };
  }
}

export async function updateIntegrityConfig(
  patch: Partial<RiderIntegrityConfigDTO>,
  updatedById: string | null,
): Promise<RiderIntegrityConfigDTO> {
  const data = {
    ...(patch.mockPingThreshold !== undefined ? { mockPingThreshold: patch.mockPingThreshold } : {}),
    ...(patch.autoPauseOffers !== undefined ? { autoPauseOffers: patch.autoPauseOffers } : {}),
    ...(patch.gateOnlineOnFailed !== undefined ? { gateOnlineOnFailed: patch.gateOnlineOnFailed } : {}),
    updatedById,
  };
  const row = await prisma.riderIntegrityConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...INTEGRITY_CONFIG_DEFAULTS, ...data },
    update: data,
  });
  return {
    mockPingThreshold: row.mockPingThreshold,
    autoPauseOffers: row.autoPauseOffers,
    gateOnlineOnFailed: row.gateOnlineOnFailed,
  };
}
