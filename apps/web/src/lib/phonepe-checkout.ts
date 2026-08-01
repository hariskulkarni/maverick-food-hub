/**
 * PhonePe PayPage launcher (browser only).
 *
 * PhonePe ships a `checkout.js` bundle from mercury that can open the PayPage
 * either inside an iframe over the current page or as a full-page redirect. We
 * prefer the iframe — the customer never leaves Flavrly, so the cart, the
 * session and the order-tracking page survive — and fall back to a redirect
 * whenever the iframe route is not viable:
 *
 *   • the bundle fails to load (CSP, ad-blocker, offline, CDN blip)
 *   • the page is itself framed (our CSP sets frame-ancestors 'none', so a
 *     nested iframe would be blocked)
 *
 * Redirect is a genuine fallback, not a degraded one: PhonePe returns the
 * browser to our `/api/payments/phonepe/return` handler either way, and the
 * outcome is reconciled server-side against the Order Status API, so the two
 * paths converge on identical state.
 */

export type PhonePeCheckoutResult = 'CONCLUDED' | 'USER_CANCEL' | 'REDIRECTED' | 'LOAD_FAILED';

interface PhonePeCheckoutApi {
  transact(opts: { tokenUrl: string; callback?: (response: string) => void; type?: 'IFRAME' }): void;
  closePage(): void;
}

declare global {
  interface Window {
    PhonePeCheckout?: PhonePeCheckoutApi;
  }
}

const SCRIPT_ID = 'phonepe-checkout-js';
const LOAD_TIMEOUT_MS = 8000;

/** Load mercury's checkout bundle once per page. Resolves null if it can't. */
export function loadPhonePeCheckout(scriptUrl: string): Promise<PhonePeCheckoutApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.PhonePeCheckout) return Promise.resolve(window.PhonePeCheckout);

  return new Promise((resolve) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    let settled = false;
    const done = (v: PhonePeCheckoutApi | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    // Never hang the checkout button on a script that will not arrive.
    const timer = setTimeout(() => done(window.PhonePeCheckout ?? null), LOAD_TIMEOUT_MS);
    const onLoad = () => {
      clearTimeout(timer);
      done(window.PhonePeCheckout ?? null);
    };
    const onError = () => {
      clearTimeout(timer);
      done(null);
    };

    if (existing) {
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      // Already finished loading before we attached listeners.
      if (window.PhonePeCheckout) onLoad();
      return;
    }

    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = scriptUrl;
    s.async = true;
    // PhonePe's troubleshooting guide calls this out explicitly: a stricter
    // referrer policy makes the PayPage drop the UPI QR.
    s.referrerPolicy = 'strict-origin-when-cross-origin';
    s.addEventListener('load', onLoad, { once: true });
    s.addEventListener('error', onError, { once: true });
    document.head.appendChild(s);
  });
}

/** True when this document is nested — our CSP would block a PayPage iframe. */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent — treat as framed
  }
}

/**
 * Open the PayPage.
 *
 * Resolves `CONCLUDED` when PhonePe reports the transaction reached a terminal
 * state (which is *not* the same as "succeeded" — the caller still asks our
 * server), `USER_CANCEL` when the customer closed it, and `REDIRECTED` when we
 * navigated away (in which case the promise never really matters).
 */
export function openPhonePeCheckout(opts: {
  tokenUrl: string;
  scriptUrl?: string;
  preferIframe?: boolean;
}): Promise<PhonePeCheckoutResult> {
  const { tokenUrl, scriptUrl, preferIframe = true } = opts;

  const redirect = (): PhonePeCheckoutResult => {
    window.location.href = tokenUrl;
    return 'REDIRECTED';
  };

  if (!preferIframe || !scriptUrl || isFramed()) {
    return Promise.resolve(redirect());
  }

  return loadPhonePeCheckout(scriptUrl).then(
    (api) =>
      new Promise<PhonePeCheckoutResult>((resolve) => {
        if (!api?.transact) return resolve(redirect());
        try {
          api.transact({
            tokenUrl,
            type: 'IFRAME',
            callback: (response: string) => {
              resolve(response === 'USER_CANCEL' ? 'USER_CANCEL' : 'CONCLUDED');
            },
          });
        } catch {
          resolve(redirect());
        }
      }),
  );
}

/** Force-close the PayPage iframe. Rarely needed; PhonePe closes it itself. */
export function closePhonePeCheckout(): void {
  try {
    window.PhonePeCheckout?.closePage();
  } catch {
    /* already closed */
  }
}
