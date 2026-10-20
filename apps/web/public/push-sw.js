// Web-push service worker. Registered ONLY by the opt-in toggle (see
// src/components/push/push-toggle.tsx) under its own scope so it coexists with
// the legacy kill-switch /sw.js (scope "/"). No fetch handler: never intercepts requests.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Flavrly';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // Only ever open same-origin URLs.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          try {
            if ('navigate' in c && c.url !== url) await c.navigate(url);
          } catch {
            /* ignore */
          }
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
