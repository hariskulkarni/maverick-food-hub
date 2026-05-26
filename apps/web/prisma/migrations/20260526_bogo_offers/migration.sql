-- BOGO / rich offer support: image, fulfillment targeting, recurring schedules.
ALTER TABLE "Offer" ADD COLUMN     "imageUrl" TEXT;
ALTER TABLE "Offer" ADD COLUMN     "fulfillmentScope" "FulfillmentType"[] DEFAULT ARRAY[]::"FulfillmentType"[];

CREATE TABLE "OfferSchedule" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "OfferSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfferSchedule_offerId_idx" ON "OfferSchedule"("offerId");
CREATE INDEX "OfferSchedule_offerId_dayOfWeek_idx" ON "OfferSchedule"("offerId", "dayOfWeek");

ALTER TABLE "OfferSchedule" ADD CONSTRAINT "OfferSchedule_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
