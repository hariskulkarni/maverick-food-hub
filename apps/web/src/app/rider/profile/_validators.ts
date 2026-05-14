/**
 * Client-side mirrors of the format regexes from `@/server/kyc`.
 *
 * These are sync, no-IO, and used purely to drive instant UI feedback while
 * the rider types a document number. The server is ALWAYS the source of truth
 * — see `validateForType` in `src/server/kyc.ts`. The shapes here MUST match
 * those validators or we'll show the rider a green tick on input the server
 * subsequently rejects.
 *
 * If you change a regex here, mirror it in `src/server/kyc.ts` and vice versa.
 */

export type ClientDocType = 'AADHAAR' | 'DRIVING_LICENSE' | 'VEHICLE_INSURANCE' | 'PAN_CARD' | 'VEHICLE_RC';

export interface FormatRule {
  /** Tested against the *normalized* (uppercased, stripped-whitespace) value. */
  regex: RegExp;
  placeholder: string;
  hint: string;
  /** Soft cap for the <input maxLength>. */
  maxLength: number;
  /** Numeric-only? Drives `inputMode` on the field. */
  numeric: boolean;
}

/**
 * Per-type normalisation: strip whitespace + hyphens; uppercase for everything
 * except Aadhaar (digit-only). Mirrors the `.replace(...).toUpperCase()` logic
 * used in the server validators.
 */
export function normalizeNumber(type: ClientDocType, raw: string): string {
  if (type === 'AADHAAR') return raw.replace(/\D/g, '');
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

export const CLIENT_RULES: Record<ClientDocType, FormatRule> = {
  AADHAAR: {
    regex: /^\d{12}$/,
    placeholder: '12-digit Aadhaar number',
    hint: '12 digits, no spaces',
    maxLength: 12,
    numeric: true,
  },
  DRIVING_LICENSE: {
    // Mirrors server: 2 alpha state code + 2 digits + 11-13 alphanum
    regex: /^[A-Z]{2}\d{2}[A-Z0-9]{11,13}$/,
    placeholder: 'e.g. MH1420110012345',
    hint: 'State code + RTO code + serial',
    maxLength: 17,
    numeric: false,
  },
  VEHICLE_INSURANCE: {
    regex: /^[A-Z0-9/\-]{6,40}$/,
    placeholder: 'Policy number',
    hint: '6-40 alphanumeric characters',
    maxLength: 40,
    numeric: false,
  },
  PAN_CARD: {
    regex: /^[A-Z]{5}\d{4}[A-Z]$/,
    placeholder: 'e.g. ABCDE1234F',
    hint: '5 letters, 4 digits, 1 letter',
    maxLength: 10,
    numeric: false,
  },
  VEHICLE_RC: {
    regex: /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/,
    placeholder: 'e.g. MH12AB1234',
    hint: 'Vehicle registration number',
    maxLength: 13,
    numeric: false,
  },
};

/** Returns `true` when the *normalized* input matches the type's regex. */
export function isFormatValid(type: ClientDocType, raw: string): boolean {
  const rule = CLIENT_RULES[type];
  if (!rule) return false;
  return rule.regex.test(normalizeNumber(type, raw));
}

/**
 * Mask helper — formats a "last 4 chars" string into a presentational bullet
 * group. `••••  ••••  1234` for 4-group masks, falls back to `•••• 1234`.
 *
 * Used everywhere the rider sees a previously-submitted number so we never
 * leak the un-redacted digits client-side.
 */
export function mask(value: string | null | undefined, keepLast = 4): string {
  const last4 = (value ?? '').slice(-keepLast).padStart(keepLast, '•');
  // Aadhaar visual: "••••  ••••  1234". For everything else: "•••• 1234".
  return `••••  ••••  ${last4}`;
}

/** Short label used by upload dialog titles + chips. */
export const TYPE_LABEL: Record<ClientDocType, string> = {
  AADHAAR: 'Aadhaar Card',
  DRIVING_LICENSE: 'Driving License',
  VEHICLE_INSURANCE: 'Vehicle Insurance',
  VEHICLE_RC: 'Vehicle RC',
  PAN_CARD: 'PAN Card',
};

/** Hint shown above the upload tile so the rider knows what they're picking. */
export const TYPE_HELPER: Record<ClientDocType, string> = {
  AADHAAR: 'Tap to upload your Aadhaar',
  DRIVING_LICENSE: 'Tap to upload your driving license',
  VEHICLE_INSURANCE: 'Tap to upload your insurance certificate',
  VEHICLE_RC: 'Tap to upload your vehicle RC',
  PAN_CARD: 'Tap to upload your PAN card',
};
