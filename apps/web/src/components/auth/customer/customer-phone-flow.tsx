'use client';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Loader2, MessageSquareText, ShieldCheck, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhoneField } from './phone-field';
import { OtpField } from './otp-field';
import { GoogleButton } from './google-button';
import { formatIndianMobile, isCompleteOtp } from '@/lib/customer-auth';

/**
 * Presentational two-step customer sign-in: (1) mobile number, (2) 6-digit
 * code. All sending/verifying/routing stays in the caller — this component
 * only renders state and reports intents, so the auth logic of each login
 * page is unchanged.
 */
export function CustomerPhoneFlow({
  step,
  phone,
  onPhoneChange,
  code,
  onCodeChange,
  busy,
  error,
  devCode,
  resendIn,
  onSendOtp,
  onVerify,
  onResend,
  onChangeNumber,
  googleEnabled,
  onGoogle,
}: {
  step: 'phone' | 'otp';
  phone: string;
  onPhoneChange: (e164: string) => void;
  code: string;
  onCodeChange: (code: string) => void;
  busy: boolean;
  /** Inline error for the current step (also announced to screen readers). */
  error: string | null;
  /** Pre-launch test account code shown on screen instead of an SMS. */
  devCode: string | null;
  /** Seconds until "Resend" is allowed; 0 = allowed now. */
  resendIn: number;
  onSendOtp: () => void;
  onVerify: () => void;
  onResend: () => void;
  onChangeNumber: () => void;
  googleEnabled?: boolean;
  onGoogle?: () => void;
}) {
  const codeOk = isCompleteOtp(code);

  if (step === 'phone') {
    return (
      <div className="space-y-5">
        {googleEnabled && onGoogle && (
          <>
            <GoogleButton onClick={onGoogle} disabled={busy} />
            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or use your mobile
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onSendOtp();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="phone" className="block text-sm font-semibold text-foreground">
              Mobile number
            </label>
            <PhoneField
              id="phone"
              value={phone}
              onChange={onPhoneChange}
              disabled={busy}
              invalid={!!error}
              describedBy="phone-help phone-error"
            />
            <p id="phone-help" className="text-sm text-muted-foreground">
              We&apos;ll send a 6-digit code to verify it&apos;s you.
            </p>
          </div>
          <InlineError id="phone-error" message={error} />
          <Button type="submit" size="lg" className="h-14 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/25" disabled={busy}>
            {busy ? (
              <><Loader2 className="animate-spin" aria-hidden="true" /> Sending code…</>
            ) : (
              <>Get OTP <ArrowRight aria-hidden="true" /></>
            )}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && codeOk) onVerify();
      }}
    >
      <div>
        <button
          type="button"
          onClick={onChangeNumber}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Change number
        </button>
        <h2 className="mt-1 text-xl font-bold tracking-tight">Enter the 6-digit code</h2>
        <p id="otp-help" className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {devCode ? 'Test account: no SMS is sent for this number.' : <>Sent by SMS to <span className="font-semibold text-foreground">{formatIndianMobile(phone)}</span></>}
        </p>
      </div>

      {devCode && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-warning/60 bg-warning/10 p-3.5" role="status">
          <FlaskConical className="size-5 shrink-0 text-warning-foreground dark:text-warning" aria-hidden="true" />
          <div className="text-sm">
            Test account — your code is{' '}
            <span className="font-mono text-base font-bold tracking-[0.2em] text-foreground">{devCode}</span>
          </div>
        </div>
      )}

      <OtpField
        value={code}
        onChange={onCodeChange}
        onComplete={() => { if (!busy) onVerify(); }}
        disabled={busy}
        invalid={!!error}
        describedBy="otp-help otp-error"
      />
      <InlineError id="otp-error" message={error} />

      <Button type="submit" size="lg" className="h-14 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/25" disabled={busy || !codeOk}>
        {busy ? (
          <><Loader2 className="animate-spin" aria-hidden="true" /> Verifying…</>
        ) : (
          <><ShieldCheck aria-hidden="true" /> Verify &amp; continue</>
        )}
      </Button>

      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <MessageSquareText className="size-4" aria-hidden="true" />
        {resendIn > 0 ? (
          <span aria-live="polite">Didn&apos;t get it? Resend in <span className="font-semibold tabular-nums text-foreground">{resendIn}s</span></span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Resend code
          </button>
        )}
      </div>
    </form>
  );
}

function InlineError({ id, message }: { id: string; message: string | null }) {
  return (
    <p id={id} role="alert" aria-live="assertive" className={message ? 'rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive' : 'sr-only'}>
      {message ?? ''}
    </p>
  );
}

/** Small legal/trust footer shared by the customer login screens. */
export function CustomerAuthLegal() {
  return (
    <p className="text-center text-xs leading-relaxed text-muted-foreground">
      By continuing you agree to our{' '}
      <Link href="/terms" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">Terms</Link>{' '}
      and{' '}
      <Link href="/privacy" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">Privacy Policy</Link>.
    </p>
  );
}
