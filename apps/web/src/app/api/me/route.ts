import { auth } from '@/server/auth';

export async function GET() {
  const s = await auth();
  if (!s?.user) return Response.json({ role: null });
  return Response.json({ id: s.user.id, name: s.user.name, role: s.user.role, phone: s.user.phone, email: s.user.email });
}
