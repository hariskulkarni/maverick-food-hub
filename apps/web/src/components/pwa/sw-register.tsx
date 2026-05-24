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

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failures are non-fatal — silently no-op */
      });
    };

    // Register after `load` so the SW doesn't compete with the initial paint.
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
