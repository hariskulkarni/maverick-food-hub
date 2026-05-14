/**
 * Karza KYC verifier adapter.
 *
 * Docs: https://karza.in (real endpoint paths are publicly documented):
 *   - PAN: POST https://api.karza.in/v3/pan         body { pan, name?, dob? }
 *   - DL:  POST https://api.karza.in/v3/driving-license body { dlNumber, dob? }
 *   - Auth header: `x-karza-key: <key>`
 *
 * Credentials are read from an IntegrationCredential row stored under the
 * synthetic provider key `kyc.karza` (decrypted via the same AES-256-GCM helper
 * the rest of the integration stack uses), with env-var fallback for one-box
 * deployments. Missing credentials never throw — they short-circuit to an
 * `ERROR` outcome so the upload flow keeps moving.
 *
 * All fetch calls run behind a 6-second AbortController timeout. Mapping from
 * vendor payload → VerifyOutcome is funnelled through a single function so the
 * outcome shape is not leaked anywhere else.
 */

import type { KycVerifier, VerifyInput, VerifyOutcome } from './types';
import { prisma } from '../db';
import { decryptJSON } from '../crypto';

const KARZA_BASE = 'https://api.karza.in/v3';
const TIMEOUT_MS = 6_000;

interface KarzaCreds {
  apiKey: string;
}

async function loadCreds(): Promise<KarzaCreds | null> {
  // Prefer encrypted row if present. Schema's IntegrationProvider enum doesn't
  // include KYC providers yet — we read via raw queryRawUnsafe so this works
  // without an enum migration; missing/decrypt errors fall through to env vars.
  try {
    const rows = (await (prisma as any).$queryRawUnsafe(
      `SELECT "configEncrypted" FROM "IntegrationCredential" WHERE "provider"::text = 'kyc.karza' LIMIT 1`
    )) as Array<{ configEncrypted: string }> | null;
    if (rows && rows[0]?.configEncrypted) {
      const cfg = decryptJSON<Record<string, string>>(rows[0].configEncrypted);
      if (cfg?.apiKey) return { apiKey: cfg.apiKey };
    }
  } catch {
    // Provider enum doesn't have kyc.karza yet — fall through to env.
  }

  const envKey = process.env.KARZA_API_KEY;
  if (envKey) return { apiKey: envKey };
  return null;
}

interface KarzaResp {
  // The real Karza payload nests under `result`; we keep this loose.
  statusCode?: number;
  status?: string;
  result?: any;
  'request-id'?: string;
  requestId?: string;
  message?: string;
}

/** Single funnel: Karza payload → VerifyOutcome. */
function mapKarzaResponse(httpStatus: number, body: KarzaResp | null): VerifyOutcome {
  const externalRef = body?.['request-id'] ?? body?.requestId;
  if (httpStatus >= 500) {
    return { status: 'ERROR', reason: `Karza upstream ${httpStatus}` };
  }
  if (httpStatus >= 400) {
    return {
      status: 'FAIL',
      reason: body?.message ?? `Karza rejected: HTTP ${httpStatus}`,
      externalRef
    };
  }
  // 2xx — inspect `statusCode` / `status`. Karza convention: 101 = valid match.
  const code = body?.statusCode;
  const ok = code === 101 || body?.status === 'success' || body?.status === 'SUCCESS';
  if (ok) {
    return {
      status: 'PASS',
      nameMatch: body?.result?.nameMatch ?? body?.result?.name_match,
      details: body?.result ?? body,
      externalRef
    };
  }
  return {
    status: 'FAIL',
    reason: body?.message ?? `Karza returned status code ${code ?? 'unknown'}`,
    externalRef
  };
}

async function callKarza(path: string, body: Record<string, unknown>, apiKey: string): Promise<VerifyOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${KARZA_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-karza-key': apiKey
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    let parsed: KarzaResp | null = null;
    try {
      parsed = (await res.json()) as KarzaResp;
    } catch {
      parsed = null;
    }
    return mapKarzaResponse(res.status, parsed);
  } catch (e: any) {
    if (e?.name === 'AbortError') return { status: 'ERROR', reason: 'Karza request timed out after 6s' };
    return { status: 'ERROR', reason: e?.message ?? 'Karza network error' };
  } finally {
    clearTimeout(timer);
  }
}

export const karzaVerifier: KycVerifier = {
  name: 'karza',
  async verify(input: VerifyInput): Promise<VerifyOutcome> {
    const creds = await loadCreds();
    if (!creds) return { status: 'ERROR', reason: 'Karza credentials not configured' };

    if (input.type === 'PAN_CARD') {
      return callKarza(
        '/pan',
        {
          pan: input.rawNumber,
          name: input.fullName,
          dob: input.dateOfBirth
        },
        creds.apiKey
      );
    }
    if (input.type === 'DRIVING_LICENSE') {
      return callKarza(
        '/driving-license',
        {
          dlNumber: input.rawNumber,
          dob: input.dateOfBirth
        },
        creds.apiKey
      );
    }
    return { status: 'UNSUPPORTED' };
  }
};
