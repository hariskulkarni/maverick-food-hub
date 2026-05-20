import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth';
import { listSessions } from '@/server/sessions';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { describeUserAgent } from './ua';
import { SessionsClient, type SessionRow } from './sessions-client';

export const metadata = { title: 'Security & sessions' };
// Live data — never cache the session list.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/profile/security');

  const raw = await listSessions(session.user.id);

  // Convert Date objects to strings before handing off to the client component.
  const sessions: SessionRow[] = raw.map((s) => ({
    id: s.id,
    label: describeUserAgent(s.userAgent),
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    active: s.active,
    revoked: s.revokedAt !== null,
  }));

  return (
    <div className="container py-6 md:py-8 max-w-2xl">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="size-4" /> Back to profile
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary shrink-0">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <h1 className="display text-xl md:text-2xl font-semibold">Security &amp; sessions</h1>
          <p className="text-sm text-muted-foreground">Your recent logins and active devices.</p>
        </div>
      </div>

      <Card className="mb-4 border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-sm text-muted-foreground">
          For your security, your account allows only{' '}
          <span className="font-medium text-foreground">one active device at a time</span>. Signing in
          on a new device automatically signs you out everywhere else. Below is your recent login
          history — you can terminate any session to sign that device out immediately.
        </CardContent>
      </Card>

      <SessionsClient sessions={sessions} />
    </div>
  );
}
