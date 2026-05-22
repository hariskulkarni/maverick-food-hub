import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { nanoid } from 'nanoid';
import { brand } from '@/lib/brand';
import { CopyButton } from './copy-button';

export const metadata = { title: 'Referrals' };

export default async function ReferralsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=/profile/referrals');
  let referral = await prisma.referral.findFirst({ where: { referrerId: session.user.id, referredId: null } });
  if (!referral) {
    referral = await prisma.referral.create({ data: { referrerId: session.user.id, code: 'REF-' + nanoid(6).toUpperCase() } });
  }
  const fulfilled = await prisma.referral.count({ where: { referrerId: session.user.id, fulfilledAt: { not: null } } });

  const link = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/?ref=${referral.code}`;

  return (
    <div className="container py-8 max-w-2xl">
      <h1 className="display text-2xl font-semibold mb-4">Refer & earn</h1>
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Share this code. When a friend places their first paid order, you get ₹{Number(referral.rewardForReferrer)} in your wallet, and they get ₹{Number(referral.rewardForReferred)} off.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="font-mono text-xl sm:text-2xl tracking-widest rounded-md border bg-muted/40 px-4 py-2 min-w-0 break-all">{referral.code}</div>
            <CopyButton text={referral.code} label="Copy code" />
            <CopyButton text={link} label="Copy link" />
          </div>
          <p className="mt-3 text-sm">Friends who joined: <span className="font-semibold">{fulfilled}</span></p>
        </CardContent>
      </Card>
    </div>
  );
}
