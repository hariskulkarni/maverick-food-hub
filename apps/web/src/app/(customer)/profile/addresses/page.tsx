/**
 * Saved addresses page. Server-renders the list (so first paint is correct
 * and SEO/back-button work), then hands off to the client component for
 * the interactive add / edit / delete / set-default + map picker flow.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { AddressesClient, type AddressRow } from './addresses-client';

export const metadata = { title: 'Saved addresses' };
// Always render live from the database. Without this a cached render can be
// served to a second device after an edit, so the two devices disagree about
// the saved address — the DB is the single source of truth and must be re-read
// on every request. (Matches the other profile pages.)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AddressesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=/profile/addresses');

  const rows = await prisma.address.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
  });

  const addresses: AddressRow[] = rows.map((a) => ({
    id: a.id,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
    latitude: a.latitude,
    longitude: a.longitude,
    isDefault: a.isDefault
  }));

  return (
    <div className="container py-8">
      <AddressesClient addresses={addresses} />
    </div>
  );
}
