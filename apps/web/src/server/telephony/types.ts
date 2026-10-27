/**
 * Telephony provider contract for masked calling.
 *
 * A provider bridges two real phones through a virtual number so neither party
 * sees the other's number. Exotel is the first implementation
 * (src/server/telephony/exotel.ts); another provider only has to implement
 * `TelephonyProvider` and be returned from `getTelephonyProvider()`.
 *
 * Phone numbers only ever travel INTO a provider call. Nothing a provider
 * returns may contain a phone number — results carry ids and statuses only.
 */
import type { CallLogStatus } from '@prisma/client';

export interface ConnectCallRequest {
  /** First leg — the number rung first (the rider). E.164, e.g. +9198XXXXXXXX. */
  from: string;
  /** Second leg — connected once `from` answers (the customer). E.164. */
  to: string;
  /** Where the provider should POST call-status updates (may be omitted). */
  statusCallbackUrl?: string | null;
  /** Opaque correlation value echoed back by the provider (our CallLog id). */
  correlationId?: string;
}

export type ConnectCallResult =
  | { ok: true; providerCallSid: string; status: CallLogStatus }
  | {
      ok: false;
      /** Sanitised, number-free reason for logs / the CallLog row. */
      reason: string;
      /** HTTP status the provider returned (0 = network / timeout). */
      httpStatus: number;
    };

export interface TelephonyProvider {
  /** Stable provider key stored on CallLog.provider (e.g. "exotel"). */
  readonly name: string;
  connectCall(req: ConnectCallRequest): Promise<ConnectCallResult>;
}
