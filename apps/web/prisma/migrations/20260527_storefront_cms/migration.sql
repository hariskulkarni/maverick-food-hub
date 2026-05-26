-- Storefront CMS: per-restaurant flexible config (hero/carousel, branding, layout).
ALTER TABLE "Restaurant" ADD COLUMN     "storefrontConfig" JSONB;
