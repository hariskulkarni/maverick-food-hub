import { Shield } from 'lucide-react';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { getPlatformSecurity } from '@/server/2fa';
import {
  getDiscoveryRadiusKm,
  MIN_DISCOVERY_RADIUS_KM,
  MAX_DISCOVERY_RADIUS_KM,
  DEFAULT_DISCOVERY_RADIUS_KM
} from '@/server/platform-settings';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SecurityClient } from './security-client';
import { DiscoveryRadiusClient } from './discovery-radius-client';

export const metadata = { title: 'Platform · Security' };
export const dynamic = 'force-dynamic';

export default async function PlatformSecurityPage() {
  await requireSuperAdmin();
  const sec = await getPlatformSecurity();
  const discoveryRadiusKm = await getDiscoveryRadiusKm();
  const recentFailures = await prisma.auditLog.findMany({
    where: { action: { in: ['auth.login.failed', 'auth.login.locked'] } },
    orderBy: { createdAt: 'desc' },
    take: 25
  });

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2">
          <Shield className="size-7 text-primary" /> Platform security
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Two-factor authentication, IP allowlist, and login-lockout policy for the super-admin account.
        </p>
      </header>

      <SecurityClient
        initial={{
          totpEnabled: Boolean(sec.totpSecret),
          allowlist: sec.allowlist ?? [],
          lockoutMinutes: sec.lockoutMinutes ?? 15
        }}
      />

      <DiscoveryRadiusClient
        initial={{
          radiusKm: discoveryRadiusKm,
          min: MIN_DISCOVERY_RADIUS_KM,
          max: MAX_DISCOVERY_RADIUS_KM,
          default: DEFAULT_DISCOVERY_RADIUS_KM
        }}
      />

      <section>
        <h3 className="font-semibold mb-3">Recent failed logins</h3>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">When</th>
                  <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Reason</th>
                  <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Actor</th>
                  <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentFailures.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No failed logins recorded.</td></tr>
                )}
                {recentFailures.map((row) => {
                  const after = (row.after ?? {}) as Record<string, unknown>;
                  const reason = String(after.reason ?? (row.action === 'auth.login.locked' ? 'locked_out' : 'unknown'));
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={reason === 'locked_out' ? 'destructive' : 'muted'}>{reason}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{row.actorId ?? String(after.email ?? '—')}</td>
                      <td className="px-4 py-3 text-xs font-mono">{row.ipAddress ?? String(after.ip ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
