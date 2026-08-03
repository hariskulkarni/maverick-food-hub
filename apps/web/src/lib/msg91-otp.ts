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

let loading: Promise<void> | null = null;

/** Inject the SDK once and init the widget in headless mode. */
export function loadMsg91Widget(): Promise<void> {
  if (!msg91Enabled) return Promise.reject(new Error('OTP widget is not configured.'));
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser context.'));
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const init = () => {
      try {
        win().initSendOTP({
          widgetId: WIDGET_ID,
          tokenAuth: WIDGET_TOKEN,
          exposeMethods: true,
          success: () => {},
          failure: () => {},
        });
        resolve();
      } catch (e) {
        reject(e as Error);
      }
    };
    if (win().initSendOTP) return init();
    const existing = document.getElementById('msg91-otp-provider') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', init);
      existing.addEventListener('error', () => reject(new Error('Could not load the OTP widget.')));
      return;
    }
    const s = document.createElement('script');
    s.id = 'msg91-otp-provider';
    s.src = 'https://verify.msg91.com/otp-provider.js';
    s.async = true;
    s.onload = init;
    s.onerror = () => reject(new Error('Could not load the OTP widget.'));
    document.body.appendChild(s);
  });
  return loading;
}

/** Send an OTP to `identifier` (digits incl. country code). */
export function sendWidgetOtp(identifier: string): Promise<void> {
  return new Promise((resolve, reject) => {
    win().sendOtp(
      identifier,
      () => resolve(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => reject(new Error(String(e?.message || e || 'Could not send the code.'))),
    );
  });
}

/** Verify the entered code; resolves with the JWT access-token. */
export function verifyWidgetOtp(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    win().verifyOtp(
      code,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data: any) => resolve(String(data?.message || '')),
      () => reject(new Error('That code is invalid or expired.')),
    );
  });
}
