'use client';
/**
 * Branded "Install Flavrly" PWA prompt.
 *
 * Two paths:
 *   - Android / Chromium: captures the `beforeinstallprompt` event, suppresses
 *     the browser's mini-infobar, and surfaces our own branded card with an
 *     Install button that triggers the native prompt.
 *   - iOS Safari: never fires `beforeinstallprompt`, so we detect it and show
 *     "tap Share → Add to Home Screen" instructions instead.
 *
 * Self-hides when:
 *   - already running standalone (installed), or
 *   - the user dismissed it within the last ~14 days (localStorage flag).
 *
 * Placement avoids the fixed MobileBottomNav (~56px + safe-area) on mobile and
 * floats bottom-right on desktop. SSR-safe: all window/navigator/localStorage
 * access happens inside effects.
 */
import { useEffect, useState } from 'react';
import { Download, Share, X, Smartphone, Plus } from 'lucide-react';

/** Minimal type for the non-standard `beforeinstallprompt` event. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'flavrly_pwa_dismissed';
const DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // ~14 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS exposes legacy `navigator.standalone`.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mql) || iosStandalone;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac but is touch-capable.
    (/macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  if (!isIos) return false;
  // Exclude in-app browsers (Chrome/Firefox/etc. on iOS can't "Add to Home Screen").
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opt\//i.test(ua);
  return isSafari;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Bail entirely if installed or recently dismissed.
    if (isStandalone() || wasRecentlyDismissed()) return;

    // iOS Safari: no event to wait for — decide immediately.
    if (isIosSafari()) {
      setShowIos(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // suppress the browser's default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShowIos(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function persistDismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable (private mode / quota) — dismiss for this session only */
    }
    setDismissed(true);
  }

  async function onInstall() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user aborted or prompt unavailable */
    } finally {
      // Whatever the outcome, the event can only be used once — clear it.
      setDeferred(null);
    }
  }

  if (dismissed) return null;
  const visible = Boolean(deferred) || showIos;
  if (!visible) return null;

  return (
    <div
      // Mobile: sit above the 56px bottom-nav + safe area. Desktop: bottom-right.
      className="fixed inset-x-0 z-50 md:inset-x-auto md:right-5 md:bottom-5"
      style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
      role="dialog"
      aria-label="Install Flavrly app"
    >
      <div className="mx-auto max-w-md px-3 md:mx-0 md:max-w-sm md:px-0">
        <div className="reveal relative overflow-hidden rounded-2xl border border-primary/15 bg-background/90 p-4 shadow-xl shadow-primary/15 backdrop-blur-md">
          {/* Coral accent wash */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-px h-1 bg-gradient-to-r from-primary via-primary/70 to-transparent"
          />

          <button
            type="button"
            onClick={persistDismiss}
            aria-label="Dismiss install prompt"
            className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-muted-foreground tap-press hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>

          <div className="flex items-start gap-3 pr-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Smartphone className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="display text-base font-semibold leading-tight">Install Flavrly</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Add to your home screen for faster ordering, offline browsing &amp; order tracking.
              </p>
            </div>
          </div>

          {showIos ? (
            // iOS Safari can't be triggered programmatically — guide the gesture.
            <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-foreground">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Tap
                <span className="inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 font-medium shadow-sm">
                  <Share className="size-3.5 text-primary" aria-hidden="true" />
                  Share
                </span>
                then
                <span className="inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 font-medium shadow-sm">
                  <Plus className="size-3.5 text-primary" aria-hidden="true" />
                  Add to Home Screen
                </span>
              </span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onInstall}
                aria-label="Install Flavrly to your home screen"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/90 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 tap-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Download className="size-4" aria-hidden="true" />
                Install
              </button>
              <button
                type="button"
                onClick={persistDismiss}
                aria-label="Not now"
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground tap-press hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Not now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
