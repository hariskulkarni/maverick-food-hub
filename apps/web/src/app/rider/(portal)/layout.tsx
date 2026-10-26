/**
 * Rider web portal shell (/rider/*). Server gate: the rider cookie must resolve
 * to an active, non-suspended, non-deleted RIDER with a live session; anything
 * else goes to /rider/login with a reason banner.
 */
import { redirect } from 'next/navigation';
import { getRiderPortalState } from '@/server/rider-portal';
import { PortalShell } from '../_components/portal-shell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Rider portal · Flavrly',
  robots: { index: false, follow: false },
};

export default async function RiderPortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getRiderPortalState();
  if (s.state !== 'ok') {
    redirect(s.state === 'signed_out' ? '/rider/login' : `/rider/login?reason=${s.state}`);
  }
  return (
    <PortalShell riderName={s.rider.name ?? 'Rider'} avatarUrl={s.rider.avatarUrl} expiresAt={s.expiresAt}>
      {children}
    </PortalShell>
  );
}
