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
import { log } from './log';
import { targetRidersForNewOrder } from './rider-sourcing';

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
 * Ping the riders who should be told about a new order in the pool.
 *
 * Targeting is delegated to `targetRidersForNewOrder`, which applies the
 * restaurant's `riderDispatchMode`: FLEET_ONLY pings the fleet, DEDICATED_ONLY
 * and DEDICATED_FIRST ping only that restaurant's dedicated riders (fleet
 * riders discover DEDICATED_FIRST orders later via pool polling). Best-effort
 * — never throws.
 */
export async function notifyRidersOfNewOrder(orderId: string): Promise<void> {
  try {
    const riders = await targetRidersForNewOrder(orderId);
    const messages: PushMessage[] = riders
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

/**
 * Ping a single rider that they've been invited to batch a new order onto
 * their current delivery. Carries the invitation id + the extra-earnings ₹
 * so the rider's app can render the in-app modal immediately when it picks
 * up the data payload (alongside the SSE event on `rider:<id>:batch-invitation`).
 *
 * Best-effort — every send is wrapped, a push failure must never block the
 * dispatch engine.
 */
export async function sendBatchInvitationPush(args: {
  expoPushToken: string;
  invitationId: string;
  orderId: string;
  extraEarnings: number;
}): Promise<void> {
  try {
    await sendExpoPush([
      {
        to: args.expoPushToken,
        title: 'Add this delivery to your route?',
        body: `Earn an extra ₹${args.extraEarnings} — tap to view.`,
        data: {
          kind: 'batch:invitation',
          invitationId: args.invitationId,
          orderId: args.orderId,
          extraEarnings: args.extraEarnings,
        },
      },
    ]);
  } catch (err) {
    log.error({ err, invitationId: args.invitationId }, 'sendBatchInvitationPush failed');
  }
}
