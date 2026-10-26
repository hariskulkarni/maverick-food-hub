# deletedAt fix report
- A: deletedAt enforced in password-reset request/consume, auth.ts password authorize, phone-OTP (+msg91 widget), Google signIn, jwt callback, staff precheck, staff enroll.
- B: per-email bucket (pw-reset-email, 5/15min, key=normalized email) via new rateLimit option `ignoreIp` (the existing key was always IP-scoped, so IP rotation would have bypassed it). Trip returns 200 {ok:true}, no send.
- C: removed prisma/migrations/20261019_password_reset_tokens.
- Tests: 116 files / 1105 tests pass; tsc clean; next lint clean (warnings only).
