'use client';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { OTP_LENGTH, applyOtpBackspace, applyOtpInput } from '@/lib/customer-auth';

/**
 * Six one-digit boxes that behave like a single field: typing advances,
 * backspace steps back, arrow keys move, and a paste or the SMS "one-time
 * code" autofill fills every box at once. The first box carries
 * autocomplete="one-time-code" so iOS/Android offer the code from the SMS.
 */
export function OtpField({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  describedBy,
  autoFocus = true,
}: {
  value: string;
  onChange: (code: string) => void;
  /** Fired once all six digits are present. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function commit(next: { code: string; focus: number }) {
    onChange(next.code);
    refs.current[next.focus]?.focus();
    if (next.code.length === OTP_LENGTH && /^\d+$/.test(next.code)) onComplete?.(next.code);
  }

  return (
    <div
      role="group"
      aria-label="6-digit verification code"
      aria-describedby={describedBy}
      className="flex justify-between gap-2 sm:gap-3"
    >
      {Array.from({ length: OTP_LENGTH }, (_, i) => {
        const ch = value[i] && value[i] !== ' ' ? value[i] : '';
        return (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={ch}
            disabled={disabled}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
            aria-invalid={invalid || undefined}
            // Let the first box accept a full pasted / autofilled code.
            maxLength={i === 0 ? OTP_LENGTH : 1}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => commit(applyOtpInput(value, i, e.currentTarget.value.replace(ch, '') || e.currentTarget.value))}
            onPaste={(e) => {
              e.preventDefault();
              commit(applyOtpInput(value, i, e.clipboardData.getData('text')));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace') {
                e.preventDefault();
                commit(applyOtpBackspace(value, i));
              } else if (e.key === 'ArrowLeft' && i > 0) {
                e.preventDefault();
                refs.current[i - 1]?.focus();
              } else if (e.key === 'ArrowRight' && i < OTP_LENGTH - 1) {
                e.preventDefault();
                refs.current[i + 1]?.focus();
              }
            }}
            className={cn(
              'h-14 w-full min-w-0 max-w-14 rounded-xl border-2 bg-background text-center font-display text-2xl font-bold tabular-nums',
              'transition-[border-color,box-shadow] duration-150 caret-primary',
              'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15',
              'disabled:cursor-not-allowed disabled:opacity-50',
              ch ? 'border-primary/50' : 'border-input',
              invalid && 'border-destructive focus:border-destructive focus:ring-destructive/15',
            )}
          />
        );
      })}
    </div>
  );
}
