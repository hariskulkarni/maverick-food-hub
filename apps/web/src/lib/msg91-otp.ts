'use client';
/**
 * Client-side MSG91 OTP Widget helper. Loads MSG91's browser SDK and drives it
 * "headless" (exposeMethods) so we keep our own login UI. Multi-channel
 * (SMS/WhatsApp/Voice/Email) send + verify is handled by MSG91; on a correct
 * code the widget returns a signed access-token we hand to the server.
 *
 * Enabled only when the widget env is present; otherwise the app uses its
 * built-in phone OTP flow.
 */
const WIDGET_ID = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID || '';
const WIDGET_TOKEN = process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN || '';

export const msg91Enabled = !!(WIDGET_ID && WIDGET_TOKEN);

/** Normalise a typed phone to MSG91's identifier: digits incl. country code. */
export function toMsg91Identifier(phone: string): string {
  const d = String(phone).replace(/[^\d]/g, '');
  return d.length === 10 ? '91' + d : d;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function win(): any {
  return window as any;
}

/**
 * Pull the signed access-token out of whatever shape MSG91 hands back on a
 * successful verify. Documented as `data.message`, but shapes vary by SDK
 * build, so we check the common keys.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractToken(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return String(data.message || data['access-token'] || data.accessToken || data.token || '');
}

// MSG91's headless SDK frequently delivers the verify result to the GLOBAL
// success/failure handlers registered in initSendOTP rather than the per-call
// callback, so we bridge those through this pending resolver.
type PendingVerify = { resolve: (token: string) => void; reject: (err: Error) => void };
let pendingVerify: PendingVerify | null = null;

function resolveVerify(data: unknown) {
  const p = pendingVerify;
  if (!p) return;
  const token = extractToken(data);
  pendingVerify = null;
  if (token) p.resolve(token);
  else p.reject(new Error('The OTP widget did not return an access token.'));
}

function rejectVerify(err: unknown) {
  const p = pendingVerify;
  if (!p) return;
  pendingVerify = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = (err as any)?.message || (typeof err === 'string' ? err : '') || 'That code is invalid or expired.';
  p.reject(new Error(String(msg)));
}

let loading: Promise<void> | null = null;

/**
 * Inject the SDK once and init the widget in headless mode. `initSendOTP`
 * exposes window.sendOtp / verifyOtp / retryOtp ASYNCHRONOUSLY, so we poll for
 * them before resolving. On failure we clear the cache so a later attempt can
 * retry cleanly.
 */
export function loadMsg91Widget(): Promise<void> {
  if (!msg91Enabled) return Promise.reject(new Error('OTP widget is not configured.'));
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser context.'));
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const fail = (msg: string) => { loading = null; reject(new Error(msg)); };
    const waitForMethods = (tries = 0) => {
      if (typeof win().sendOtp === 'function' && typeof win().verifyOtp === 'function') return resolve();
      if (tries > 100) return fail('The OTP widget did not finish loading. Please retry.');
      setTimeout(() => waitForMethods(tries + 1), 50);
    };
    const init = () => {
      try {
        win().initSendOTP({
          widgetId: WIDGET_ID,
          tokenAuth: WIDGET_TOKEN,
          exposeMethods: true,
          // Global handlers: MSG91's headless SDK routes the verify result here.
          success: (data: unknown) => resolveVerify(data),
          failure: (err: unknown) => rejectVerify(err),
        });
        waitForMethods();
      } catch (e) {
        fail((e as Error)?.message || 'Could not initialise the OTP widget.');
      }
    };
    if (win().initSendOTP) return init();
    const existing = document.getElementById('msg91-otp-provider') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', init);
      existing.addEventListener('error', () => fail('Could not load the OTP widget.'));
      return;
    }
    const s = document.createElement('script');
    s.id = 'msg91-otp-provider';
    s.src = 'https://verify.msg91.com/otp-provider.js';
    s.async = true;
    s.onload = init;
    s.onerror = () => fail('Could not load the OTP widget.');
    document.body.appendChild(s);
  });
  return loading;
}

/**
 * Send an OTP to `identifier` (digits incl. country code). MSG91's headless
 * SDK dispatches the SMS synchronously but often does NOT fire the per-call
 * success callback, which would leave our UI stuck on the phone step. So we
 * resolve optimistically after a short grace period (advancing to the code
 * step), while still rejecting fast if the SDK reports an explicit failure or
 * throws synchronously.
 */
export function sendWidgetOtp(identifier: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof win().sendOtp !== 'function') return reject(new Error('OTP widget not ready. Please retry.'));
    let settled = false;
    const ok = () => { if (!settled) { settled = true; resolve(); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (e: any) => {
      if (settled) return;
      settled = true;
      reject(new Error(String(e?.message || e || 'Could not send the code.')));
    };
    try {
      const r = win().sendOtp(identifier, ok, bad);
      if (r && typeof r.then === 'function') r.then(ok).catch(bad);
    } catch (e) {
      return bad(e);
    }
    // Grace period: if neither callback fired, assume the SMS went out.
    setTimeout(ok, 2000);
  });
}

/**
 * Verify the entered code; resolves with the JWT access-token. Accepts the
 * token from either the per-call callback OR the global success handler
 * (whichever the SDK build uses).
 */
export function verifyWidgetOtp(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof win().verifyOtp !== 'function') return reject(new Error('OTP widget not ready. Please retry.'));
    pendingVerify = { resolve, reject };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = (data: any) => resolveVerify(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (e: any) => rejectVerify(e);
    try {
      const r = win().verifyOtp(code, ok, bad);
      if (r && typeof r.then === 'function') r.then(ok).catch(bad);
    } catch (e) {
      return rejectVerify(e);
    }
    // Safety timeout so the button never hangs forever.
    setTimeout(() => {
      if (pendingVerify) {
        pendingVerify = null;
        reject(new Error('Verification timed out. Please try again.'));
      }
    }, 20000);
  });
}
