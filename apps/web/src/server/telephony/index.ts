/**
 * Telephony entry point. Returns the configured masked-calling provider, or
 * null when none is configured (the call API then answers 503 and the rider
 * falls back to "Customer unreachable" → Flavrly support).
 *
 * To add a provider: implement `TelephonyProvider` (./types) in its own file
 * and choose it here (e.g. by a TELEPHONY_PROVIDER env value).
 */
import { createExotelProvider, readExotelConfig } from './exotel';
import type { TelephonyProvider } from './types';

export type { TelephonyProvider, ConnectCallRequest, ConnectCallResult } from './types';

export function getTelephonyProvider(env: Record<string, string | undefined> = process.env): TelephonyProvider | null {
  const exotel = readExotelConfig(env);
  if (exotel) return createExotelProvider(exotel);
  return null;
}
