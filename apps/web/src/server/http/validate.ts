/**
 * Shared request-validation helpers for API route handlers.
 *
 * Goals:
 *   - One consistent way to validate JSON bodies / query params with Zod.
 *   - Structured 400 responses (`{ error, fields }`) — field-level messages the
 *     client can use, with NO internal leakage (no stack traces, no Zod issue
 *     `path`/`code` internals beyond the field name, no raw input echoed back).
 *   - safeParse only (never `.parse`, which throws and can surface internals via
 *     an unhandled 500).
 *
 * Usage in a route:
 *
 *   const Body = z.object({ phone: z.string().min(8), code: z.string().length(6) });
 *   const parsed = await parseJsonBody(req, Body);
 *   if (!parsed.ok) return parsed.response;   // 400 with structured field errors
 *   const { phone, code } = parsed.data;       // fully typed
 */
import { z } from 'zod';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Structured 400 from a ZodError — field messages only, no internals. */
export function validationErrorResponse(error: z.ZodError): Response {
  const flat = error.flatten();
  return Response.json(
    {
      error: 'Validation failed',
      // fieldErrors: { phone: ['Required'], ... } — safe, user-facing strings.
      fields: flat.fieldErrors,
      // formErrors: top-level (non-field) messages, e.g. from refinements.
      formErrors: flat.formErrors,
    },
    { status: 400 }
  );
}

/** Generic, internals-free JSON error helper. */
export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Parse + validate a JSON request body against a Zod schema.
 * Returns a discriminated result: `{ ok: true, data }` or `{ ok: false, response }`
 * where `response` is a ready-to-return 400 (bad JSON or validation failure).
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<ParseResult<z.infer<T>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError('Request body must be valid JSON', 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: validationErrorResponse(result.error) };
  }
  return { ok: true, data: result.data };
}

/**
 * Validate an already-parsed value (e.g. query params, route params) against a
 * Zod schema. Same discriminated result shape as `parseJsonBody`.
 */
export function validateValue<T extends z.ZodTypeAny>(schema: T, value: unknown): ParseResult<z.infer<T>> {
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, response: validationErrorResponse(result.error) };
  }
  return { ok: true, data: result.data };
}

/** Validate URLSearchParams as a plain object against a schema. */
export function parseSearchParams<T extends z.ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: T
): ParseResult<z.infer<T>> {
  return validateValue(schema, Object.fromEntries(searchParams.entries()));
}
