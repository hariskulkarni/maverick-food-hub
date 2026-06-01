'use client';
/**
 * Service worker registration island.
 *
 * Registers `/sw.js` once the window has loaded. The offline-shell SW in
 * `public/sw.js` is otherwise never activated, which also means
 * `beforeinstallprompt` won't fire reliably — so this is a prerequisite for the
 * <InstallPrompt> banner working at all.
 *
 * Renders nothing. SSR-safe: every navigator/window access is inside useEffect.
 */
import { useEffect } from 'react';

export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // PWA kill switch — the previous SW was caching stale HTML and serving
    // inconsistent layouts across routes. We now register the new sw.js
    // which exists solely to unregister itself and purge every cache.
    // After this runs once on each device, the SW is gone.
    //
    // We also belt-and-braces unregister any already-registered SW from this
    // origin from the client side, in case the new sw.js hasn't activated
    // yet. The browser will fetch fresh on the next navigation.
    const purge = async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); } catch { /* ignore */ }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch { /* ignore — non-fatal */ }
      // Finally register the kill-switch SW so any new tab also picks it up
      // and exits cleanly. The new sw.js's activate step then unregisters
      // itself, so this is self-terminating.
      navigator.serviceWorker.register('/sw.js').catch(() => { /* no-op */ });
    };

    if (document.readyState === 'complete') {
      purge();
    } else {
      window.addEventListener('load', purge, { once: true });
      return () => window.removeEventListener('load', purge);
    }
  }, []);

  return null;
}
