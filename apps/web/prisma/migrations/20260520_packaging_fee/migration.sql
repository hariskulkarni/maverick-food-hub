-- Restaurant packaging fee.
-- Branch-level configurable flat charge (₹20 default) added to delivery + pickup
-- orders; Order keeps a per-order snapshot (default 0 so historical rows are unchanged).

ALTER TABLE "Branch" ADD COLUMN "packagingFee" DECIMAL(10,2) NOT NULL DEFAULT 20.00;

ALTER TABLE "Order" ADD COLUMN "packagingFee" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
