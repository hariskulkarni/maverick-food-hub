/**
 * Pure helpers for the customer phone-OTP sign-in screens (no React, no I/O),
 * so the input behaviour is unit-testable.
 *
 * Phone numbers are Indian mobiles: the screen shows a fixed "+91" prefix and
 * the customer types the 10-digit national number. The value handed to the
 * auth calls is the same E.164 form the old free-text field asked people to
 * type ("+919876500001"), which is also how customer accounts are stored.
 */

export const OTP_LENGTH = 6;

/**
 * Reduce whatever was typed or pasted to at most 10 national digits.
 * Accepts "98765 43210", "+91 98765-43210", "919876543210", "09876543210".
 */
export function toNationalDigits(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

/** Canonical value for the auth calls: "+91" + 10 digits, or "" while empty. */
export function toIndianE164(input: string): string {
  const d = toNationalDigits(input);
  return d ? `+91${d}` : '';
}

/**
 * National digits back out of a stored "+91…" value (for the input box).
 * Strips the "+91" prefix itself: a partial value like "+91987" must show
 * "987" while typing, not "91987" (toNationalDigits only drops a leading 91
 * once there are more than 10 digits).
 */
export function nationalFromE164(value: string): string {
  if (value.startsWith('+91')) return value.slice(3).replace(/\D/g, '').slice(0, 10);
  return toNationalDigits(value);
}

/** A complete Indian mobile number (10 digits, starting 6–9). */
export function isValidIndianMobile(input: string): boolean {
  return /^[6-9]\d{9}$/.test(toNationalDigits(input));
}

/** "+91 98765 43210" for "we sent a code to …" copy. */
export function formatIndianMobile(input: string): string {
  const d = toNationalDigits(input);
  if (d.length !== 10) return input;
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/** Keep only digits, capped at the OTP length. */
export function sanitizeOtp(input: string): string {
  return input.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

/**
 * Apply one keystroke or paste into the segmented OTP field.
 * `index` is the box the input landed in; `raw` is what that box received
 * (one character, or a whole pasted / autofilled code).
 * Returns the new code and which box should take focus next.
 */
export function applyOtpInput(code: string, index: number, raw: string): { code: string; focus: number } {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { code, focus: index };
  // A multi-digit value (paste, SMS autofill) fills from the box it landed in.
  const chars = code.padEnd(OTP_LENGTH, ' ').split('');
  let i = Math.max(0, Math.min(index, OTP_LENGTH - 1));
  for (const ch of digits) {
    if (i >= OTP_LENGTH) break;
    chars[i] = ch;
    i += 1;
  }
  const next = chars.join('').replace(/\s+$/, '');
  return { code: next, focus: Math.min(i, OTP_LENGTH - 1) };
}

/** Backspace in box `index`: clear it, or step back and clear the previous one. */
export function applyOtpBackspace(code: string, index: number): { code: string; focus: number } {
  const chars = code.padEnd(OTP_LENGTH, ' ').split('');
  if (chars[index] && chars[index] !== ' ') {
    chars[index] = ' ';
    return { code: chars.join('').replace(/\s+$/, ''), focus: index };
  }
  const prev = Math.max(0, index - 1);
  chars[prev] = ' ';
  return { code: chars.join('').replace(/\s+$/, ''), focus: prev };
}

/** True once every box holds a digit. */
export function isCompleteOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}
