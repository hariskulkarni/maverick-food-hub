import { auth } from '@/server/auth';

export async function GET() {
  const s = await auth();
  if (!s?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return Response.json({ error: 'push not configured' }, { status: 503 });
  return Response.json({ publicKey });
}
