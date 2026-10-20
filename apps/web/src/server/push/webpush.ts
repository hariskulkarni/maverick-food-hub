import webpush from 'web-push';
import { prisma } from '@/server/db';

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

function configure(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

/** Fan a notification out to every subscription of a user; prune dead (404/410) endpoints. */
export async function sendWebPush(userId: string, payload: PushPayload): Promise<void> {
  if (!configure()) return;
  const subs = await prisma.webPushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else console.error('[webpush] send failed', code, (e as Error).message);
      }
    })
  );
  if (dead.length) await prisma.webPushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
}
