'use client';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { nationalFromE164, toIndianE164 } from '@/lib/customer-auth';

/**
 * Indian mobile number input with a fixed "+91" prefix. Holds the canonical
 * "+91XXXXXXXXXX" value for the caller and shows only the 10 national digits.
 * Paste "+91 98765 43210" or "098765…" and it is normalised.
 */
export const PhoneField = forwardRef<HTMLInputElement, {
  id: string;
  value: string;
  onChange: (e164: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}>(function PhoneField({ id, value, onChange, disabled, invalid, describedBy, autoFocus }, ref) {
  return (
    <div
      className={cn(
        'flex h-14 items-center overflow-hidden rounded-xl border-2 bg-background',
        'transition-[border-color,box-shadow] duration-150',
        'focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15',
        invalid ? 'border-destructive focus-within:border-destructive focus-within:ring-destructive/15' : 'border-input',
        disabled && 'opacity-50',
      )}
    >
      <span
        className="flex h-full select-none items-center gap-1.5 border-r border-border bg-muted/60 px-3.5 text-base font-semibold text-foreground"
        aria-hidden="true"
      >
        <IndiaFlag />
        +91
      </span>
      <input
        ref={ref}
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        enterKeyHint="send"
        placeholder="98765 43210"
        value={nationalFromE164(value)}
        onChange={(e) => onChange(toIndianE164(e.currentTarget.value))}
        onPaste={(e) => {
          e.preventDefault();
          onChange(toIndianE164(e.clipboardData.getData('text')));
        }}
        maxLength={14}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-lg font-semibold tracking-wide tabular-nums placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
});

/** Tiny flag glyph (decorative; the "+91" text carries the meaning). */
function IndiaFlag() {
  return (
    <svg viewBox="0 0 21 15" className="h-3.5 w-5 rounded-[2px] shadow-[0_0_0_1px_hsl(var(--border))]" aria-hidden="true">
      <rect width="21" height="5" fill="#FF9933" />
      <rect y="5" width="21" height="5" fill="#FFFFFF" />
      <rect y="10" width="21" height="5" fill="#138808" />
      <circle cx="10.5" cy="7.5" r="1.6" fill="none" stroke="#000080" strokeWidth="0.6" />
    </svg>
  );
}
