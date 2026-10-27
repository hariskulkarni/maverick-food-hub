import { redirect } from 'next/navigation';
import { auth, allowCustomerSelfSignup } from '@/server/auth';
import { prisma } from '@/server/db';
import { resolveStartStep, safeNextPath } from '@/lib/onboarding';
import { WelcomeClient } from './welcome-client';
import { RefreshThenGo } from './refresh-then-go';

export const metadata = { title: 'Welcome', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * /welcome — customer sign-up + onboarding. Picks the starting step from the
 * live account: signed out → welcome; no verified phone → the mandatory phone
 * step; not onboarded → the optional "about you" steps; otherwise straight on
 * to `next` (a safe, same-origin path; default /restaurants).
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; gate?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next) ?? '/restaurants';
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const selfSignupOpen = allowCustomerSelfSignup();

  const session = await auth();
  if (!session?.user) {
    return <WelcomeClient initialStep="welcome" next={next} googleEnabled={googleEnabled} selfSignupOpen={selfSignupOpen} user={null} />;
  }
  if (session.user.role !== 'CUSTOMER') redirect(session.user.role === 'RIDER' ? '/rider-app' : next);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phoneVerifiedAt: true, onboardedAt: true, favoriteCuisines: true, _count: { select: { addresses: true } } },
  });
  if (!user) redirect('/login');

  const start = resolveStartStep({ signedIn: true, phoneVerified: !!user.phoneVerifiedAt, onboarded: !!user.onboardedAt });
  if (!start) {
    // Sent here by the middleware phone gate with a stale cookie: refresh the
    // session first so the gate sees the verified phone (no redirect loop).
    if (sp.gate) return <RefreshThenGo to={next} />;
    redirect(next);
  }

  return (
    <WelcomeClient
      initialStep={start}
      next={next}
      googleEnabled={googleEnabled}
      selfSignupOpen={selfSignupOpen}
      user={{
        name: user.name,
        favoriteCuisines: user.favoriteCuisines,
        addressCount: user._count.addresses,
        onboarded: !!user.onboardedAt,
      }}
    />
  );
}
