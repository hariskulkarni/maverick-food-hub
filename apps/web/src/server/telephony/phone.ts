/**
 * Phone helpers for masked calling. Pure functions — no I/O.
 */

/** A dialable E.164 number (what Exotel's `To` requires). */
export function isE164(phone: string | null | undefined): phone is string {
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Rider-facing masked form: "+91 ******12". Only the last two digits survive.
 * Returns null when there is no number (the UI then shows nothing).
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return null;
  const last2 = digits.slice(-2);
  const indian = phone.startsWith('+91') || (digits.length === 12 && digits.startsWith('91'));
  return indian ? `+91 ******${last2}` : `******${last2}`;
}

/**
 * Strip anything that could be a phone number from free text (provider error
 * messages may echo the dialled number). Every run of 5+ digits — optionally
 * with spaces / dashes / a leading + — becomes "[redacted]".
 */
export function redactPhones(text: string | null | undefined, max = 300): string {
  if (!text) return '';
  return String(text)
    .replace(/\+?\d[\d\s-]{3,}\d/g, (m) => (m.replace(/\D/g, '').length >= 5 ? '[redacted]' : m))
    .slice(0, max);
}
