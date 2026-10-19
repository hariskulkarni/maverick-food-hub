import { createHmac, timingSafeEqual } from 'crypto';

export function signState(restaurantId: string): string {
  const nonce = Date.now().toString(36);
  const mac = createHmac('sha256', process.env.INTEGRATION_ENCRYPTION_KEY || 'dev')
    .update(`${restaurantId}:${nonce}`).digest('hex').slice(0, 32);
  return Buffer.from(`${restaurantId}:${nonce}:${mac}`).toString('base64url');
}

export function verifyState(state: string, restaurantId: string): boolean {
  try {
    const [rid, nonce, mac] = Buffer.from(state, 'base64url').toString().split(':');
    if (!rid || !nonce || !mac || rid !== restaurantId) return false;
    const want = createHmac('sha256', process.env.INTEGRATION_ENCRYPTION_KEY || 'dev')
      .update(`${rid}:${nonce}`).digest('hex').slice(0, 32);
    const a = Buffer.from(mac); const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
