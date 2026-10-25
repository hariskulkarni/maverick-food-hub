import { redirect } from 'next/navigation';
import { getRiderPortalState } from '@/server/rider-portal';
import { ProfileView } from './profile-view';

export const dynamic = 'force-dynamic';

export default async function RiderProfilePage() {
  const s = await getRiderPortalState();
  if (s.state !== 'ok') redirect('/rider/login');
  return (
    <ProfileView
      initial={{
        name: s.rider.name,
        email: s.rider.email,
        phone: s.rider.phone,
        avatarUrl: s.rider.avatarUrl,
        riderType: s.rider.riderType,
        dedicatedRestaurant: s.rider.dedicatedRestaurant,
      }}
    />
  );
}
