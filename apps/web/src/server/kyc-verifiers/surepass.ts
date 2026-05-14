/**
 * Surepass KYC verifier adapter.
 *
 * Docs: https://surepass.io  (real endpoint paths from public docs):
 *   - PAN: POST https://kyc-api.surepass.io/api/v1/pan/pan
 *          body { id_number }
 *   - DL:  POST https://kyc-api.surepass.io/api/v1/driving-license/driving-license
 *          body { id_number, dob }
 *   - Auth header: `Authorization: Bearer <token>`
 *
 * Same patterns as karza.ts — single response-mapping function, 6s timeout,
 * encrypted-row credential lookup with env-var fallback, never throws on
 * missing creds.
 */

import type { KycVerifier, VerifyInput, VerifyOutcome } from './types';
import { prisma } from '../db';
import { decryptJSON } from '../crypto';

const SUREPASS_BASE = 'https://kyc-api.surepass.io/api/v1';
const TIMEOUT_MS = 6_000;

interface SurepassCreds {
  token: string;
}

async function loadCreds(): Promise<SurepassCreds | null> {
  try {
    const rows = (await (prisma as any).$queryRawUnsafe(
      `SELECT "configEncrypted" FROM "IntegrationCredential" WHERE "provider"::text = 'kyc.surepass' LIMIT 1`
    )) as Array<{ configEncrypted: string }> | null;
    if (rows && rows[0]?.configEncrypted) {
      const cfg = decryptJSON<Record<string, string>>(rows[0].configEncrypted);
      if (cfg?.token) return { token: cfg.token };
    }
  } catch {
    // Fall through to env.
  }
  const envToken = process.env.SUREPASS_TOKEN;
  if (envToken) return { token: envToken };
  return null;
}

interface SurepassResp {
  success?: boolean;
  status_code?: number;
  message?: string;
  message_code?: string;
  data?: any;
  request_id?: string;
}

/** Single funnel: Surepass payload → VerifyOutcome. */
function mapSurepassResponse(httpStatus: number, body: SurepassResp | null): VerifyOutcome {
  const externalRef = body?.request_id;
  if (httpStatus >= 500) {
    return { status: 'ERROR', reason: `Surepass upstream ${httpStatus}` };
  }
  if (httpStatus >= 400) {
    return {
      status: 'FAIL',
      reason: body?.message ?? `Surepass rejected: HTTP ${httpStatus}`,
      externalRef
    };
  }
  if (body?.success === true) {
    return {
      status: 'PASS',
      nameMatch: body?.data?.name_match ?? body?.data?.full_name_match,
      details: body?.data ?? body,
      externalRef
    };
  }
  return {
    status: 'FAIL',
    reason: body?.message ?? 'Surepass returned success=false',
    externalRef
  };
}

async function callSurepass(path: string, body: Record<string, unknown>, token: string): Promise<VerifyOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUREPASS_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    let parsed: SurepassResp | null = null;
    try {
      parsed = (await res.json()) as SurepassResp;
    } catch {
      parsed = null;
    }
    return mapSurepassResponse(res.status, parsed);
  } catch (e: any) {
    if (e?.name === 'AbortError') return { status: 'ERROR', reason: 'Surepass request timed out after 6s' };
    return { status: 'ERROR', reason: e?.message ?? 'Surepass network error' };
  } finally {
    clearTimeout(timer);
  }
}

export const surepassVerifier: KycVerifier = {
  name: 'surepass',
  async verify(input: VerifyInput): Promise<VerifyOutcome> {
    const creds = await loadCreds();
    if (!creds) return { status: 'ERROR', reason: 'Surepass credentials not configured' };

    if (input.type === 'PAN_CARD') {
      return callSurepass('/pan/pan', { id_number: input.rawNumber }, creds.token);
    }
    if (input.type === 'DRIVING_LICENSE') {
      return callSurepass(
        '/driving-license/driving-license',
        { id_number: input.rawNumber, dob: input.dateOfBirth },
        creds.token
      );
    }
    return { status: 'UNSUPPORTED' };
  }
};
