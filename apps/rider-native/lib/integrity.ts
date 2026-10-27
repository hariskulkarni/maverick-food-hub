/**
 * Device attestation (Google Play Integrity, Android). Requests an integrity
 * token at sign-in and at shift start and posts it to the server, which keeps
 * only the device/app *verdict* (MEETS_DEVICE_INTEGRITY, …) for anti-fraud —
 * never personal data, never a list of installed apps.
 *
 * The native Play Integrity provider is OPTIONAL: it is wired into a dedicated
 * app build (a config plugin / native module that registers itself on
 * `globalThis.FlavrlyPlayIntegrity`). When it is not bundled, this is a no-op
 * and the server records UNEVALUATED — nothing is blocked. This keeps the JS
 * app dependency-free and lets the feature degrade cleanly before the attested
 * build + PLAY_INTEGRITY_* server credentials are in place.
 */
import { Platform } from 'react-native';
import { api } from './api';

interface IntegrityProvider {
  /** Returns a short-lived Play Integrity token for this device/app. */
  requestIntegrityToken: (nonce?: string) => Promise<string>;
}

function getProvider(): IntegrityProvider | null {
  const g = globalThis as { FlavrlyPlayIntegrity?: IntegrityProvider };
  return g.FlavrlyPlayIntegrity ?? null;
}

/** True when a native Play Integrity provider is available in this build. */
export function hasIntegrityProvider(): boolean {
  return Platform.OS === 'android' && !!getProvider();
}

/**
 * Best-effort device attestation. Never throws and never blocks the caller —
 * a failure just means the server keeps the previous (or UNEVALUATED) verdict.
 */
export async function attestDeviceIntegrity(): Promise<void> {
  if (Platform.OS !== 'android') return; // Play Integrity is Android-only
  const provider = getProvider();
  if (!provider) return; // not bundled in this build — server degrades cleanly
  try {
    const token = await provider.requestIntegrityToken();
    if (token) await api.verifyIntegrity(token).catch(() => {});
  } catch {
    // best-effort
  }
}
