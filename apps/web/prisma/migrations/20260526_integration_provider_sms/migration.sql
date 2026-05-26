-- Add the India SMS gateways + extra SMTP relays the notification layer probes
-- (TWOFACTOR/MSG91/FAST2SMS/TEXTLOCAL/ZOHO_SMTP/BREVO_SMTP). Without these enum
-- values, prisma.integrationCredential.findUnique({ where:{ provider }}) throws
-- "Invalid value for argument `provider`" on every SMS/email config lookup, so
-- OTP silently falls back to the mock/demo gateway. IF NOT EXISTS keeps this
-- idempotent across db push / migrate deploy.
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'TWOFACTOR';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'MSG91';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'FAST2SMS';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'TEXTLOCAL';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'ZOHO_SMTP';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'BREVO_SMTP';
