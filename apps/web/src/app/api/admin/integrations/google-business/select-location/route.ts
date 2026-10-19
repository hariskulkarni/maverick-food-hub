import { NextRequest, NextResponse } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getConfig, saveConfig } from '@/server/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const body = await req.json().catch(() => null);
  const locationId = typeof body?.locationId === 'string' ? body.locationId : '';

  const existing = await getConfig(restaurant.id, 'GOOGLE_BUSINESS' as any);
  if (!existing) return NextResponse.json({ error: 'Google Business not connected' }, { status: 409 });

  let locations: Array<{ id: string }> = [];
  try {
    const parsed = JSON.parse(existing.locations || '[]');
    if (Array.isArray(parsed)) locations = parsed;
  } catch { /* treat as empty */ }

  if (!locationId || !locations.some((l) => l?.id === locationId)) {
    return NextResponse.json({ error: 'Unknown location' }, { status: 400 });
  }

  await saveConfig(
    restaurant.id, 'GOOGLE_BUSINESS' as any,
    { ...existing, locationId },
    { status: 'CONNECTED' },
  );
  return NextResponse.json({ ok: true });
}
