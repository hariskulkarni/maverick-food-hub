import { ExternalLink, Zap } from 'lucide-react';
import { requireSuperAdmin } from '@/server/tenancy';

export const metadata = { title: 'Platform · Flavrly PG Admin' };
export const dynamic = 'force-dynamic';

// The self-hosted Flavrly PG Merchant Admin hub, already branded Flavrly, runs behind
// Authelia (password + TOTP) on its own subdomain. Rather than reimplement its
// settings screens, we surface the real hub inside this SUPER_ADMIN-gated page
// via an iframe. Override the URL per-deployment with NEXT_PUBLIC_YOUPI_ADMIN_URL.
// NOTE: framing requires the Flavrly PG admin + Authelia to send
//   Content-Security-Policy: frame-ancestors https://portal.flavrly.in
// (and NOT X-Frame-Options: DENY) — see deploy/youpi-embed-nginx.md.
const YOUPI_ADMIN_URL = process.env.NEXT_PUBLIC_YOUPI_ADMIN_URL || 'https://pay-admin.flavrly.in';

/** SUPER_ADMIN only: embeds the self-hosted Flavrly PG Merchant Admin hub (behind Authelia). */
export default async function PlatformYoupiAdminPage() {
  await requireSuperAdmin();

  return (
    <div className="flex h-dvh flex-col pb-16 md:pb-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Zap className="size-5 text-primary" />
        <div className="min-w-0">
          <h1 className="display text-lg font-semibold leading-tight">Flavrly PG Admin</h1>
          <p className="truncate text-xs text-muted-foreground">
            Self-hosted gateway admin · secured by Authelia (password + authenticator)
          </p>
        </div>
        <a
          href={YOUPI_ADMIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
        >
          Open in new tab <ExternalLink className="size-4" />
        </a>
      </div>
      <iframe
        src={YOUPI_ADMIN_URL}
        title="Flavrly PG Admin"
        className="w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
