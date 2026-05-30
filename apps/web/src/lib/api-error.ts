/**
 * Client-side helper that turns a non-2xx `fetch` Response into a single
 * toast call with the right action button.
 *
 * Why this exists:
 *   Admin write endpoints return STRUCTURED errors as
 *     { error: "...", code: "auth/unauthenticated" | ... , reason: "..." }
 *   so the UI can react usefully — redirect to /login on expired session,
 *   send the user to /admin/branches when no active branch is configured,
 *   etc. Without this helper, every callsite did
 *     toast.error('Failed: ' + await r.text())
 *   which surfaced unhelpful bare strings ("Forbidden", "Not found") and
 *   gave the user no path forward.
 *
 * Stay framework-light: depends only on `sonner` so this is safe to import
 * from any client component.
 */
'use client';

import { toast } from 'sonner';

/** Stable error codes the server emits. Mirrors `ApiAuthError` server-side. */
export type ApiErrorCode =
  | 'auth/unauthenticated'
  | 'auth/forbidden'
  // Generic catch-all so callsites don't have to enumerate every value.
  | (string & {});

/**
 * Legacy "reason" strings emitted by the menu-import surface. We treat code
 * and reason as the same key-space for the switch below — whichever the
 * server set, the right toast renders.
 */
type ErrorBody = {
  error?: string;
  code?: ApiErrorCode;
  reason?: string;
};

/**
 * Report a failed Response with the most useful toast we can render. Returns
 * the parsed body so the caller can branch further if it needs to.
 *
 *   const r = await fetch(url, init);
 *   if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
 */
export async function reportApiError(response: Response, prefix: string): Promise<ErrorBody> {
  let body: ErrorBody = {};
  // `.clone()` so a caller that later wants `.text()` itself isn't broken
  // by us having consumed the body here.
  try { body = await response.clone().json(); } catch { /* not JSON */ }

  const key = body.code ?? body.reason ?? '';
  const description = body.error ?? undefined;
  let title = prefix;
  let action: { label: string; onClick: () => void } | undefined;

  switch (key) {
    case 'auth/unauthenticated':
    case 'session_expired':
      title = 'Sign in again to continue';
      action = {
        label: 'Sign in',
        onClick: () => {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}&mode=admin`);
        },
      };
      break;
    case 'auth/forbidden':
    case 'role':
      title = 'You don\'t have permission to do that';
      break;
    case 'no_restaurant':
      title = 'No restaurant linked';
      break;
    case 'no_active_branch':
      action = {
        label: 'Open Branches',
        onClick: () => window.location.assign('/admin/branches'),
      };
      break;
    case 'cross_tenant':
      title = 'Some items aren\'t yours to edit';
      break;
    case 'in_use':
      title = 'Still in use';
      break;
    case 'too_large':
    case 'wrong_type':
    case 'no_file':
    case 'empty_file':
    case 'parse':
    case 'bad_form':
    case 'bad_body':
    case 'apply_failed':
      // These are upload/parse specifics — the server's message is the right
      // toast text; keep the prefix as a discreet header.
      title = `${prefix}${description ? ': ' + description : ''}`;
      break;
    default:
      // Unknown error shape. Use the raw text if there's no JSON body so we
      // never swallow a meaningful server message silently.
      if (!description) {
        try {
          const text = (await response.text()).slice(0, 200);
          if (text) body.error = text;
        } catch { /* ignore */ }
      }
  }

  toast.error(title, { description: body.error, action });
  return body;
}
