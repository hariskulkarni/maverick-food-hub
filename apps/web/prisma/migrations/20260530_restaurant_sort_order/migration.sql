-- Curated display sequence for restaurants (a.k.a. "outlets") on both the
-- super-admin /platform/restaurants list and the customer-facing /restaurants
-- list. Lower numbers float to the top; ties fall back to createdAt DESC.
ALTER TABLE "Restaurant" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Restaurant_sortOrder_idx" ON "Restaurant"("sortOrder");

-- Seed: give every existing restaurant a unique position so the first drag in
-- the UI doesn't have to break a giant tie. Newest first → smallest sortOrder.
WITH ranked AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY "createdAt" DESC) - 1) * 10 AS pos
  FROM "Restaurant"
)
UPDATE "Restaurant" r
SET "sortOrder" = ranked.pos
FROM ranked
WHERE r.id = ranked.id;
