/**
 * Rider push notifications via Expo's hosted push service.
 *
 * The native rider app registers an Expo push token (expo-notifications) and
 * stores it on RiderProfile.expoPushToken via POST /api/rider/push-token. This
 * helper delivers to those tokens through Expo's push API — no FCM server-key
 * wrangling, Expo brokers it.
 *
 * Every send is best-effort: a failure here must never break the order flow.
 */
import { prisma } from './db';
import { log } from './log';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

async function sendExpoPush(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      log.error({ status: res.status }, 'expo push send returned non-OK');
    }
  } catch (err) {
    log.error({ err }, 'expo push send threw');
  }
}

/**
 * Ping every online rider who has a registered push token. Called when a new
 * order lands in the pool. Best-effort — never throws.
 */
export async function notifyRidersOfNewOrder(orderId: string): Promise<void> {
  try {
    const riders = await prisma.riderProfile.findMany({
      where: { isOnline: true, expoPushToken: { not: null } },
      select: { expoPushToken: true },
    });
    const messages: PushMessage[] = riders
      .filter((r): r is { expoPushToken: string } => !!r.expoPushToken)
      .map((r) => ({
        to: r.expoPushToken,
        title: 'New order in the pool',
        body: 'A delivery is available to claim.',
        data: { kind: 'order:new', orderId },
      }));
    await sendExpoPush(messages);
  } catch (err) {
    log.error({ err, orderId }, 'notifyRidersOfNewOrder failed');
  }
}
