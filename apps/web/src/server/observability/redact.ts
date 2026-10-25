/**
 * Redaction for anything the observability system persists (error messages,
 * stacks, job summaries, client beacons). Pure — safe to import anywhere.
 *
 * Goal: an operator can read an error and act on it, but no secret or PII is
 * ever stored. We redact:
 *   • bearer / basic auth headers, JWTs, long opaque tokens (hex/base64 ≥ 24)
 *   • key=value secrets (password, secret, token, otp, code, apiKey, signature …)
 *   • OTP-looking codes next to the words otp / code / pin
 *   • e-mail addresses and phone numbers (Indian +91 and generic 10–13 digits)
 *   • card-like 13–19 digit runs
 */

const RULES: Array<[RegExp, string]> = [
  // Authorization headers
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  // JWT / JWE (three or five base64url segments)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[JWT]'],
  // key=value / "key":"value" secrets
  [
    /((?:pass(?:word)?|passwd|secret|token|api[_-]?key|apikey|auth|authorization|otp|pin|signature|x-internal-secret|client[_-]?secret|cookie|session)["']?\s*[:=]\s*["']?)([^"'\s,;&}]+)/gi,
    '$1[REDACTED]',
  ],
  // URLs with userinfo (scheme://user:pass@host)
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@'],
  // E-mail
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  // OTP-ish: "otp 123456", "code: 1234", "pin is 0000"
  [/\b(otp|code|pin)(\s*(?:is|:|=)?\s*)\d{4,8}\b/gi, '$1$2[OTP]'],
  // Card-like digit runs (13–19 digits, optional spaces/dashes)
  [/\b(?:\d[ -]?){13,19}\b/g, '[NUMBER]'],
  // Phone numbers: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX (10–13 digits)
  [/(?<![\w])(?:\+?\d{1,3}[ -]?)?[6-9]\d{9}(?!\d)/g, '[PHONE]'],
  // Long opaque tokens (hex ≥ 32, or base64-ish ≥ 32 containing a digit)
  [/\b[a-f0-9]{32,}\b/gi, '[TOKEN]'],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, '[TOKEN]'],
];

/** Redact secrets + PII from free text. Never throws. */
export function redactText(input: string | null | undefined, max = 2000): string {
  if (!input) return '';
  let s = String(input);
  if (s.length > max * 2) s = s.slice(0, max * 2);
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Normalise a message for fingerprinting: strip ids, numbers, quoted values so
 * "Order cabc123… not found" and "Order cdef456… not found" collapse into one
 * error group. Applied AFTER redaction.
 */
export function normalizeForFingerprint(message: string): string {
  return message
    .replace(/\b[a-z0-9]{20,}\b/gi, '<id>') // cuid / uuid-ish
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * The top in-app stack frames, normalised (no line/column numbers, no absolute
 * paths, no chunk hashes) — so a fingerprint survives a redeploy.
 */
export function stackSignature(stack: string | null | undefined, frames = 3): string {
  if (!stack) return '';
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('at ')) continue;
    if (/node_modules|node:internal|<anonymous>/.test(t)) continue;
    const fn = t
      .replace(/^at\s+/, '')
      .replace(/\(.*?([^/\\()]+?)(?::\d+)+\)$/, '($1)')
      .replace(/(?:[A-Za-z]:)?[/\\][^\s()]*[/\\]/g, '')
      .replace(/:\d+(:\d+)?/g, '')
      .replace(/\b[0-9a-f]{8,}\b/gi, '');
    out.push(fn);
    if (out.length >= frames) break;
  }
  return out.join(' | ');
}
