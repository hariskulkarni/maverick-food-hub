/** Minimal signed partner client for simulator tests and for probing a real Novaryq API. */
import { signRequest } from './signing';

export interface NqCreds { baseUrl: string; clientId: string; secret: string }

export async function nqFetch(
  c: NqCreds,
  method: string,
  path: string,
  body?: unknown,
  o: { nowSec?: number; headers?: Record<string, string>; timeoutMs?: number } = {},
) {
  const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = {
    ...signRequest(c.clientId, c.secret, raw, o.nowSec),
    ...(raw ? { 'content-type': 'application/json' } : {}),
    ...o.headers,
  };
  const res = await fetch(`${c.baseUrl}${path}`, { method, headers, body: raw || undefined, signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json };
}
