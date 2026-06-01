// SERVICE WORKER KILL SWITCH
// =============================================================================
// This SW used to cache pages for offline. In practice it was caching stale
// HTML/CSS across different restaurant routes and serving inconsistent
// builds — different routes saw different card layouts depending on when
// each was last visited.
//
// This version:
//   1. Deletes every existing cache (purges stale shells)
//   2. Unregisters itself
//   3. Forces every open client tab to reload from the network
//
// After one visit from any phone/browser that had the old SW, the SW is
// gone and the browser is back to a normal no-cache state. The next page
// load is fresh HTML from the server.
//
// To re-enable PWA offline caching later, restore the previous handler
// and increment the cache name.
// =============================================================================

self.addEventListener('install', () => {
  // Don't wait for the existing SW to release — take over immediately.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Nuke every cache the old SW created.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));

      // 2. Unregister this SW so it stops intercepting fetches forever.
      await self.registration.unregister();

      // 3. Force every open tab pointing at this origin to reload from
      //    the network — bypasses the stale shell they're currently
      //    displaying. clients.claim() first so we can talk to them.
      await self.clients.claim();
      const all = await self.clients.matchAll({ type: 'window' });
      for (const client of all) {
        try {
          // navigate() is preferred where supported because it does a
          // proper top-level navigation. Fall back to postMessage if not.
          if ('navigate' in client) await client.navigate(client.url);
        } catch {
          /* ignore */
        }
      }
    })(),
  );
});

// No fetch handler — let the browser handle every request as if no SW
// existed. This SW exists only to unregister itself; it never intercepts
// anything.
