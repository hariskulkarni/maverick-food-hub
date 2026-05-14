/**
 * Begin TOTP enrolment: generate a new secret, store it as `totpPending`,
 * return the otpauth URL + base32 for the QR. The secret is NOT yet active —
 * the caller must POST `/totp/verify` with a valid code to activate it.
 */

import { requireSuperAdmin } from '@/server/tenancy';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  getPlatformSecurity,
  setPlatformSecurity
} from '@/server/2fa';
import { audit } from '@/server/audit';

export async function POST() {
  const session = await requireSuperAdmin();
  const secret = generateTotpSecret();
  const account = session.user.email ?? session.user.id;
  const otpauthUrl = buildOtpAuthUrl(secret, account);

  // Store as pending only; keep any active secret intact until /verify confirms.
  const current = await getPlatformSecurity();
  await setPlatformSecurity({ ...current, totpPending: secret });

  // Render the QR server-side so we don't ship qrcode to the browser bundle.
  const QR = await import('qrcode').then((m) => m.default ?? m);
  const qrDataUrl: string = await QR.toDataURL(otpauthUrl, { width: 240, margin: 1 });

  await audit('platform.security.totp.setup', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSecurity'
  });

  return Response.json({ otpauthUrl, secret, qrDataUrl });
}
