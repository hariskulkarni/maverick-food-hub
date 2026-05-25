-- Food License Management (FSSAI), branch-scoped.
-- All columns nullable so existing branches are unchanged until a licence is captured.
ALTER TABLE "Branch" ADD COLUMN     "fssaiLicenseNumber" TEXT;
ALTER TABLE "Branch" ADD COLUMN     "fssaiLicenseHolder" TEXT;
ALTER TABLE "Branch" ADD COLUMN     "fssaiLicenseType" TEXT;
ALTER TABLE "Branch" ADD COLUMN     "fssaiLicenseAddress" TEXT;
ALTER TABLE "Branch" ADD COLUMN     "fssaiIssuedOn" TIMESTAMP(3);
ALTER TABLE "Branch" ADD COLUMN     "fssaiRenewedOn" TIMESTAMP(3);
ALTER TABLE "Branch" ADD COLUMN     "fssaiExpiresOn" TIMESTAMP(3);
ALTER TABLE "Branch" ADD COLUMN     "fssaiLicenseImageUrl" TEXT;
ALTER TABLE "Branch" ADD COLUMN     "fssaiLicenseNotes" TEXT;
