/**
 * Rider Profile + KYC page — `/rider/profile`.
 *
 * Server component. Auth + role gate, then loads everything the client tab UI
 * needs in a single round trip:
 *   - User row (name, phone, email)
 *   - RiderProfile (vehicle, stats, approval state)
 *   - All 5 RiderKycDocument rows (one per type — or fewer if not uploaded)
 *   - `getStatusSummary` for the top progress bar
 *
 * Everything is JSON-serialized (Decimal → number, Date → ISO string) before
 * being handed to <ProfileClient/> so the wire payload is plain JSON and the
 * client can `JSON.parse(JSON.stringify(...))` it safely if it ever needs to.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { getStatusSummary, toPublicDoc } from '@/server/kyc';
import { ProfileClient } from './profile-client';

export const metadata = { title: 'Rider · Profile · KYC' };
export const dynamic = 'force-dynamic';

export default async function RiderProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/rider/profile');
  if (session.user.role !== 'RIDER') redirect('/login?mode=rider&next=/rider/profile');

  const { tab } = await searchParams;

  // Pull the rider's row + their User in one shot so we don't double-query.
  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      user: {
        select: { id: true, name: true, phone: true, email: true, avatarUrl: true },
      },
    },
  });
  if (!profile) {
    // Defensive: a rider account without a RiderProfile row is impossible in
    // happy-path signup, but show a soft redirect rather than 500.
    redirect('/login?mode=rider');
  }

  // Documents — we ask for all 5 types and let the client decide what's
  // "not uploaded" by absence from the list.
  const docs = await (prisma as any).riderKycDocument.findMany({
    where: { riderId: profile.id },
    orderBy: { submittedAt: 'desc' },
  });
  const summary = await getStatusSummary(profile.id);

  // Serialize: Decimal / Date are not JSON-safe over the React server boundary
  // unless we coerce them first.
  const initialTab: 'personal' | 'vehicle' | 'documents' | 'payouts' =
    tab === 'personal' || tab === 'vehicle' || tab === 'payouts' ? tab : 'documents';

  const serialized = {
    user: {
      id: profile.user.id,
      name: profile.user.name,
      phone: profile.user.phone,
      email: profile.user.email,
      avatarUrl: profile.user.avatarUrl,
    },
    profile: {
      id: profile.id,
      vehicleType: profile.vehicleType,
      vehicleNumber: profile.vehicleNumber,
      isOnline: profile.isOnline,
      currentLat: profile.currentLat,
      currentLng: profile.currentLng,
      rating: profile.rating,
      totalDeliveries: profile.totalDeliveries,
      totalEarnings: Number(profile.totalEarnings),
      totalTips: Number(profile.totalTips),
      approvedAt: profile.approvedAt?.toISOString() ?? null,
    },
    documents: (docs as any[]).map((d: any) => {
      const pub = toPublicDoc(d);
      return {
        ...pub,
        // toPublicDoc returns Date — convert for the wire so the client never
        // has to think about Date instance vs string.
        issuedOn: pub.issuedOn ? pub.issuedOn.toISOString() : null,
        expiresOn: pub.expiresOn ? pub.expiresOn.toISOString() : null,
        submittedAt: pub.submittedAt.toISOString(),
        reviewedAt: pub.reviewedAt ? pub.reviewedAt.toISOString() : null,
        updatedAt: pub.updatedAt.toISOString(),
        // Verifier fields — exposed for the rider so we can render
        // "Verified by Karza · 2h ago" and the retry button.
        verifierProvider: d.verifierProvider ?? null,
        verifierStatus: d.verifierStatus ?? null,
        verifierMessage: d.verifierMessage ?? null,
        verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
      };
    }),
    summary: {
      counts: summary.counts,
      fullyApproved: summary.fullyApproved,
    },
    initialTab,
  };

  return <ProfileClient data={serialized} />;
}
