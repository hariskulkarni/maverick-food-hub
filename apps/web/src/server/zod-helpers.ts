/**
 * Shared zod field helpers + a structured error responder.
 *
 * Why this file exists:
 *
 *   The branding-save bug ("Save failed" with no detail) had two stacked
 *   causes — both repeat across the codebase if you look hard enough.
 *
 *     1. Image fields validated with `z.string().url()`. When the upload
 *        driver is local storage (the default), the ImageUploader stores a
 *        RELATIVE path like `/uploads/restaurants/<slug>/logo/<file>.png`.
 *        `.url()` rejects relative paths. Result: a fresh upload silently
 *        breaks save.
 *
 *     2. Optional text/email fields validated as required when the user
 *        leaves them BLANK. `z.string().email().optional()` rejects the
 *        empty string instead of treating it as "no value". Same toast,
 *        different field.
 *
 *     3. Routes throwing on zod parse errors instead of returning a
 *        structured `{ error, reason }` body — so the panel can't tell the
 *        user WHICH field is wrong.
 *
 *   This module is the canonical fix for all three. Use these schemas at
 *   every callsite that takes user-typed text, an email, a phone, or an
 *   image reference.
 *
 * Public API:
 *
 *   - imageRef        — accepts URL OR relative path; '' → undefined.
 *   - optionalString  — max-bounded; '' → undefined; trim.
 *   - optionalEmail   — '' → undefined; otherwise validates as an email.
 *   - optionalUrl     — '' → undefined; otherwise validates as an http(s) URL.
 *   - optionalPhone   — '' → undefined; otherwise trims + caps at 40 chars.
 *   - parseOrJsonError — wrap `Body.parse(await req.json())` once.
 *
 * Style note: every helper TRIMS first, then collapses empty to undefined.
 * If a field is genuinely required, declare it with `z.string().min(1)` —
 * don't reach for these helpers there.
 */

import { z } from 'zod';

/* ─── Field schemas ───────────────────────────────────────────────────────── */

/**
 * Either a full URL (http/https) OR an in-app relative path beginning with "/".
 * Empty string is normalised to `undefined` so the route can persist NULL.
 * Bounded at 2048 chars (a generous URL limit; covers any reasonable S3 key).
 */
export const imageRef = z
  .string()
  .max(2048)
  .transform((v) => v.trim())
  .refine(
    (v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v),
    'Must be a URL or a path starting with /'
  )
  .transform((v) => (v === '' ? undefined : v));

/**
 * A capped optional text field. Trims whitespace, then collapses empty to
 * undefined so the persistence layer writes NULL instead of "".
 */
export const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? undefined : v))
    .optional();

/**
 * Optional email. Same empty-collapse semantics as optionalString, then a
 * cheap RFC-lite check. We deliberately avoid `z.string().email()` because
 * its compiled regex requires a TLD and won't accept `test@localhost`,
 * which a few legitimate test/dev addresses are.
 */
export const optionalEmail = z
  .string()
  .max(254)
  .transform((v) => v.trim())
  .transform((v) => (v === '' ? undefined : v))
  .optional()
  .refine(
    (v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'Invalid email'
  );

/**
 * Optional URL (must be http or https when set). Empty → undefined. Use this
 * for fields like contactWebsite, ogImage, etc. — anything that ISN'T an
 * uploaded asset (those use imageRef so relative paths are accepted).
 */
export const optionalUrl = z
  .string()
  .max(2048)
  .transform((v) => v.trim())
  .transform((v) => (v === '' ? undefined : v))
  .optional()
  .refine(
    (v) => v === undefined || /^https?:\/\/[^\s]+$/i.test(v),
    'Must be a full http(s) URL'
  );

/** Optional phone (free-form, capped at 40 chars; '' → undefined). */
export const optionalPhone = optionalString(40);

/* ─── Error responder ─────────────────────────────────────────────────────── */

/**
 * Parse `body` against `schema`, or return a structured 400 Response so the
 * client toast can render an actionable message. Returns the parsed payload
 * on success.
 *
 * Use it like this in a route:
 *
 *     const parsed = parseOrJsonError(Body, await req.json());
 *     if (parsed instanceof Response) return parsed;
 *     // parsed is now typed as z.infer<typeof Body>
 *
 * The error body matches the rest of the structured-error contract:
 *
 *     { error: "contactEmail: Invalid email", reason: "bad_body" }
 *
 * Only the FIRST issue is surfaced in `error` — a toast can't display ten
 * issues anyway. The full issue list is included as `issues` so the panel
 * can render a verbose breakdown if it ever wants to.
 *
 * Generic: we accept any zod schema via `T extends z.ZodTypeAny` and derive
 * the return type with `z.infer<T>`. The naive `z.ZodType<T>` form breaks
 * when the schema contains `.transform()` (e.g. a `string` → `Date` coerce)
 * because the schema's `_input` and `_output` types diverge and TypeScript
 * can no longer unify them through a single `T`.
 */
export function parseOrJsonError<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.infer<T> | Response {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.infer<T>;
  const issue = result.error.issues[0];
  const message = issue
    ? `${issue.path.join('.') || 'field'}: ${issue.message}`
    : 'Invalid request body';
  return Response.json(
    { error: message, reason: 'bad_body', issues: result.error.issues },
    { status: 400 }
  );
}
