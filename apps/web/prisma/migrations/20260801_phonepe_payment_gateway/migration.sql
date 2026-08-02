-- PhonePe Payment Gateway (Standard Checkout V2)
--
-- Adds PHONEPE to the two enums the integration needs:
--   PaymentMethod       — so an Order/Payment can be placed on the PhonePe rail
--   IntegrationProvider — so per-restaurant PhonePe credentials can be stored
--                         in IntegrationCredential (AES-GCM encrypted blob)
--
-- Everything else reuses existing columns:
--   Payment.providerName  = 'phonepe'
--   Payment.providerRef   = our merchantOrderId  (<orderId>-<attempt>)
--   Payment.providerData  = PhonePe pay/status payloads + our _ prefixed metadata
--   Refund.providerRef    = our merchantRefundId
--   PaymentWebhookEvent.provider = 'phonepe'
--
-- Postgres cannot add an enum value inside a transaction block that also uses
-- it, but adding alone is safe and non-blocking. IF NOT EXISTS makes the
-- migration re-runnable against a database where `prisma db push` already
-- applied the enum during development.

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PHONEPE';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'PHONEPE';
