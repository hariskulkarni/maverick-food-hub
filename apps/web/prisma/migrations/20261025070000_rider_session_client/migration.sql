-- Rider multi-session (2026-10-25): tag rider sessions by surface so a rider
-- can hold one native-app session and one web-portal session at once.
-- Additive, nullable; existing rows stay NULL (NextAuth / legacy semantics).
ALTER TABLE "UserSession" ADD COLUMN "client" TEXT;
