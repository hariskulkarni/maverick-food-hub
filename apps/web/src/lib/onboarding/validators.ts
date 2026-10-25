/**
 * Format validators for the onboarding wizards (pure — safe on client + server).
 *
 * Each returns `null` when the value is valid, or a plain-language error that
 * names the expected shape with an example, so the UI can show it inline.
 */

const GST_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** FSSAI licence / registration number: exactly 14 digits (e.g. 10020042007183). */
export function validateFssai(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/\s+/g, '');
  if (!v) return 'FSSAI number is required — it is printed on your licence (14 digits, e.g. 10020042007183).';
  if (!/^\d{14}$/.test(v)) return `FSSAI numbers are exactly 14 digits (you entered ${v.length} characters). Example: 10020042007183.`;
  if (!/^[12]/.test(v)) return 'FSSAI numbers start with 1 (licence) or 2 (registration). Check the number on your certificate.';
  return null;
}

/** Mod-36 check character used by GSTIN (15th character). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GST_CHARSET.indexOf(first14[i]!);
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARSET[(36 - (sum % 36)) % 36]!;
}

/** GSTIN: 2-digit state + 10-char PAN + entity digit + 'Z' + check char (e.g. 27AAPFU0939F1ZV). Optional. */
export function validateGstin(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (!v) return null;
  if (v.length !== 15) return `GSTIN is 15 characters (you entered ${v.length}). Example: 27AAPFU0939F1ZV.`;
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) {
    return 'That does not look like a GSTIN. Format: 2-digit state code + PAN + 1 digit + Z + 1 check character (e.g. 27AAPFU0939F1ZV).';
  }
  const state = Number(v.slice(0, 2));
  if (state < 1 || state > 38) return `State code ${v.slice(0, 2)} is not a valid Indian GST state code (01–38).`;
  if (gstinCheckChar(v.slice(0, 14)) !== v[14]) return 'The last character of this GSTIN does not match its checksum — please re-check for typos.';
  return null;
}

/** PAN: 5 letters + 4 digits + 1 letter (e.g. AAPFU0939F). Optional. */
export function validatePan(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (!v) return null;
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) return 'PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. AAPFU0939F).';
  return null;
}

/** When both are given, the GSTIN embeds the PAN at characters 3–12. */
export function validateGstinMatchesPan(gstin: string | null | undefined, pan: string | null | undefined): string | null {
  const g = (gstin ?? '').trim().toUpperCase();
  const p = (pan ?? '').trim().toUpperCase();
  if (!g || !p || validateGstin(g) || validatePan(p)) return null;
  return g.slice(2, 12) === p ? null : `Your GSTIN contains PAN ${g.slice(2, 12)}, which differs from the PAN you entered.`;
}

/** Indian mobile/landline-ish phone: optional +91, 10 digits starting 6–9 for mobiles. */
export function validateIndianPhone(raw: string | null | undefined, { required = false } = {}): string | null {
  const v = (raw ?? '').replace(/[\s()-]/g, '');
  if (!v) return required ? 'A phone number is required so customers and riders can reach you (e.g. +91 98765 43210).' : null;
  if (!/^(\+91|0)?[6-9]\d{9}$/.test(v)) return 'Enter a 10-digit Indian mobile number, optionally with +91 (e.g. +91 98765 43210).';
  return null;
}

/** Indian PIN code: 6 digits, first digit 1–9 (e.g. 560034). */
export function validatePinCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return 'PIN code is required (6 digits, e.g. 560034).';
  if (!/^[1-9]\d{5}$/.test(v)) return 'PIN codes are 6 digits and do not start with 0 (e.g. 560034).';
  return null;
}

/** Email (lenient RFC-lite, matches the server's optionalEmail). */
export function validateEmail(raw: string | null | undefined, { required = false } = {}): string | null {
  const v = (raw ?? '').trim();
  if (!v) return required ? 'Email is required (e.g. orders@spicegarden.in).' : null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'That email looks incomplete (e.g. orders@spicegarden.in).';
}

/** #RRGGBB colour. */
export function validateHexColor(raw: string | null | undefined): string | null {
  return /^#[0-9a-fA-F]{6}$/.test((raw ?? '').trim()) ? null : 'Use a 6-digit hex colour like #E23744.';
}

/** Latitude/longitude pair inside India's rough bounding box (sanity, not geofencing). */
export function validateIndiaLatLng(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'Map location is required so we can measure delivery distance (e.g. 12.9352, 77.6245).';
  }
  if (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5) {
    return 'Those coordinates are outside India — did you swap latitude and longitude? (Bengaluru is 12.97, 77.59.)';
  }
  return null;
}

/**
 * Pull "lat, lng" out of whatever the owner pastes: "12.9352, 77.6245",
 * "12.9352 77.6245", or a Google Maps URL containing "@12.9352,77.6245" / "q=12.93,77.62".
 */
export function parseLatLngInput(raw: string): { lat: number; lng: number } | null {
  const s = (raw ?? '').trim();
  const m = s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) ?? s.match(/(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
