/**
 * Customer delivery-location cookie.
 *   POST   { lat, lng, label } → set the active discovery location.
 *   DELETE                      → clear it (back to the "set your location" gate).
 *
 * No auth required: guests choose a location too (the whole storefront is
 * location-gated). The cookie is readable by the client header so it can show
 * "deliver to <label>" without an extra round-trip, and is NOT httpOnly for
 * that reason — it holds only a coarse location the user picked themselves.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LOCATION_COOKIE, serializeDeliveryLocation } from '@/server/discovery';
import { parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

const Body = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  label: z.string().min(1).max(160),
});

const COOKIE_OPTS = {
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 90, // 90 days
};

export async function POST(req: NextRequest) {
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const loc = parsed;
  const res = NextResponse.json({ ok: true, location: loc });
  res.cookies.set(LOCATION_COOKIE, serializeDeliveryLocation(loc), COOKIE_OPTS);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCATION_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
