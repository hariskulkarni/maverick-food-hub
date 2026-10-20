/** Browser-side web-push helpers. All functions are safe to call only in the browser. */
export const PUSH_SW_URL = '/push-sw.js';
export const PUSH_SW_SCOPE = '/push-sw-scope/';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getReg(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
  await navigator.serviceWorker.ready.catch(() => undefined);
  return reg;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export type SubscribeResult = 'subscribed' | 'denied' | 'unsupported' | 'unavailable' | 'error';

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const keyRes = await fetch('/api/push/vapid-public-key');
  if (!keyRes.ok) return 'unavailable';
  const { publicKey: key } = (await keyRes.json()) as { publicKey?: string };
  if (!key) return 'unavailable';
  const reg = await getReg();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource
    }));
  const json = sub.toJSON();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
  });
  return res.ok ? 'subscribed' : 'error';
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint })
  }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
