/**
 * Google Play Integrity device attestation (Android). The rider app requests an
 * integrity token at sign-in / shift start; the server decodes it against
 * Google's Play Integrity API and keeps only the device/app *verdict*
 * (MEETS_DEVICE_INTEGRITY, …) — NOT personal data, NOT a list of installed
 * apps. A FAILED verdict flags the rider for review and, behind a default-off
 * platform setting, can gate going online.
 *
 * Degrades cleanly: when PLAY_INTEGRITY_* env is absent the feature reports
 * `configured: false` and verdict UNEVALUATED, so nothing ever blocks. Network
 * / decode errors against a configured project are also UNEVALUATED (never
 * punish a rider for a transient Google error). Only a successful decode whose
 * device-recognition verdict is empty counts as FAILED.
 *
 * The Google call is isolated behind `DecodeClient` so tests inject a fake and
 * never hit the network or need credentials.
 */
import { createSign } from 'node:crypto';

export type IntegrityVerdict =
  | 'MEETS_DEVICE_INTEGRITY'
  | 'MEETS_BASIC_INTEGRITY'
  | 'FAILED'
  | 'UNEVALUATED';

export interface IntegrityResult {
  configured: boolean;
  verdict: IntegrityVerdict;
  /** Short, non-personal detail for the ops UI (e.g. the raw verdict labels). */
  detail?: string;
}

/** The decoded Play Integrity verdict payload we care about (no personal data). */
export interface DecodedIntegrity {
  deviceRecognitionVerdict: string[];
  appRecognitionVerdict?: string;
}

export interface DecodeClient {
  decode(token: string): Promise<DecodedIntegrity>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    // Accept either raw JSON or base64-encoded JSON.
    const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(json) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}

/** True when the Play Integrity project + credentials are configured. */
export function isPlayIntegrityConfigured(): boolean {
  return !!process.env.PLAY_INTEGRITY_PACKAGE_NAME && !!loadServiceAccount();
}

/**
 * Map Google's deviceRecognitionVerdict labels to our stored verdict. A device
 * that meets strong or standard device integrity passes; basic-only is a weaker
 * pass; an empty verdict (or virtual-only, i.e. an emulator) is a FAILURE.
 */
export function mapVerdict(labels: string[], appVerdict?: string): IntegrityVerdict {
  const set = new Set(labels);
  if (set.has('MEETS_STRONG_INTEGRITY') || set.has('MEETS_DEVICE_INTEGRITY')) return 'MEETS_DEVICE_INTEGRITY';
  if (set.has('MEETS_BASIC_INTEGRITY')) return 'MEETS_BASIC_INTEGRITY';
  // Empty, or only MEETS_VIRTUAL_INTEGRITY (emulator / unrecognised device), or
  // an app that is not the genuine Play-installed binary.
  void appVerdict;
  return 'FAILED';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Exchange the service-account JWT for a short-lived Google OAuth access token. */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('no access_token');
  return body.access_token;
}

/** Default client: decodes the integrity token through Google's REST API. */
function defaultClient(): DecodeClient | null {
  const packageName = process.env.PLAY_INTEGRITY_PACKAGE_NAME;
  const sa = loadServiceAccount();
  if (!packageName || !sa) return null;
  return {
    async decode(token: string): Promise<DecodedIntegrity> {
      const accessToken = await getAccessToken(sa);
      const res = await fetch(
        `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ integrity_token: token }),
        },
      );
      if (!res.ok) throw new Error(`decode failed: ${res.status}`);
      const body = (await res.json()) as {
        tokenPayloadExternal?: {
          deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
          appIntegrity?: { appRecognitionVerdict?: string };
        };
      };
      const payload = body.tokenPayloadExternal;
      return {
        deviceRecognitionVerdict: payload?.deviceIntegrity?.deviceRecognitionVerdict ?? [],
        appRecognitionVerdict: payload?.appIntegrity?.appRecognitionVerdict,
      };
    },
  };
}

/**
 * Verify a Play Integrity token. Pass a `client` in tests; in production the
 * default REST client is used when credentials are configured.
 */
export async function verifyIntegrityToken(
  token: string,
  client?: DecodeClient,
): Promise<IntegrityResult> {
  const c = client ?? defaultClient();
  if (!c) return { configured: false, verdict: 'UNEVALUATED', detail: 'not_configured' };
  try {
    const decoded = await c.decode(token);
    const verdict = mapVerdict(decoded.deviceRecognitionVerdict, decoded.appRecognitionVerdict);
    const detail =
      decoded.deviceRecognitionVerdict.length > 0 ? decoded.deviceRecognitionVerdict.join(',') : 'no_device_verdict';
    return { configured: true, verdict, detail };
  } catch {
    // Transient / decode error against a configured project — never punish.
    return { configured: true, verdict: 'UNEVALUATED', detail: 'decode_error' };
  }
}
