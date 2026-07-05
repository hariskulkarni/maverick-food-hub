'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie, X } from 'lucide-react';

/**
 * CookieConsent — lightweight, self-contained consent banner.
 *
 * Flavrly currently sets only strictly-necessary cookies (auth session, cart,
 * CSRF) and loads NO third-party analytics/marketing scripts. This banner
 * captures the visitor's choice so that (a) we have a recorded consent signal
 * as required by India's DPDP Act, and (b) any future analytics/marketing
 * cookies can be gated on `hasConsent('analytics')`.
 *
 * Choice is stored in BOTH localStorage (for the client) and a 1-year cookie
 * named `flavrly_cookie_consent` (so the server can read it later if needed).
 * Values: 'all' (accepted non-essential) | 'essential' (declined non-essential).
 */
const KEY = 'flavrly_cookie_consent';

function persist(value: 'all' | 'essential') {
  try {
    localStorage.setItem(KEY, value);
    // 1-year, SameSite=Lax, path=/. Not HttpOnly on purpose — it's a UX signal,
    // not a secret.
    document.cookie = `${KEY}=${value}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax`;
  } catch {
    /* storage blocked (private mode) — banner simply reappears next visit */
  }
}

/** Read the stored analytics-consent decision anywhere in the app. */
export function hasAnalyticsConsent(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c === `${KEY}=all`);
}

export function CookieConsent() {
  // Render nothing until we've checked storage on the client, so SSR and the
  // first client paint match (no hydration mismatch).
  const [show, setShow] = useState(false);

  useEffect(() => {
    let decided = false;
    try { decided = !!localStorage.getItem(KEY); } catch { decided = false; }
    if (!decided) setShow(true);
  }, []);

  if (!show) return null;

  function choose(value: 'all' | 'essential') {
    persist(value);
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-3 md:px-4 md:pb-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card/95 backdrop-blur shadow-lg p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Cookie className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">We use cookies</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              We use strictly-necessary cookies to keep you signed in and remember your cart.
              With your consent we may also use optional cookies to understand usage and improve
              the app. See our{' '}
              <Link href="/cookies" className="text-primary underline underline-offset-2">Cookie Policy</Link>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => choose('all')}
                className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Accept all
              </button>
              <button
                type="button"
                onClick={() => choose('essential')}
                className="inline-flex items-center rounded-md border bg-card px-3.5 py-2 text-sm font-medium hover:bg-accent"
              >
                Essential only
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss (essential cookies only)"
            onClick={() => choose('essential')}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
