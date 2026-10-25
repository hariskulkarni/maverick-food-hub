/**
 * POST /api/rider/auth/verify-otp
 *
 * Native rider app — step 2 of login. Confirms the account is a RIDER, verifies
 * the OTP, starts a rider app session (supersedes older APP sessions only — a
 * web-portal session stays signed in) and issues a 7-day
 * session-bound Bearer JWT the app stores in secure storage and sends on every
 * subsequent /api/rider/* request (P1-11; refresh via /api/rider/auth/refresh).
 *
 * Body: { phone: string, code: string }
 * 200:  { token: string, expiresAt: string, rider: { id, name, phone } }
 * 401:  { error: 'invalid_code' }
 * 403:  { error: 'not_a_rider' | 'suspended' }
 */
import { NextRequest } from 'next/server';
import { verifyRiderOtp } from '@/server/rider-otp-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return verifyRiderOtp(req, 'rider-app');
}
