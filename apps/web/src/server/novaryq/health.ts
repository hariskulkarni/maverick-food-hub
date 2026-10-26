/** Integration health shared by the restaurant admin badge and the platform console (no heavy imports). */
import { novaryqFlagOn } from './config';

export type Health = 'off' | 'not_connected' | 'healthy' | 'degraded' | 'failing';

/** One health rule for the admin badge and the platform list. */
export function computeHealth(i: { hasCred: boolean; connected: boolean; enabled: boolean; dead: number; failed: number; retrying: number }): Health {
  if (!novaryqFlagOn() || (i.hasCred && !i.enabled)) return 'off';
  if (!i.hasCred) return 'not_connected';
  if (!i.connected || i.dead > 0) return 'failing';
  if (i.failed > 0 || i.retrying > 0) return 'degraded';
  return 'healthy';
}

