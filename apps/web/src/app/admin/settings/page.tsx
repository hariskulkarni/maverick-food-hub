import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, MapPin, Bell, Plug, Workflow, ChevronRight } from 'lucide-react';
import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { BrandingForm } from './branding-form';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { BranchesAccordion } from './branches-accordion';
import { SettingsShell } from './settings-shell';
import { ReviewsSettings } from './reviews-settings';
import { NotificationsTable } from './notifications-table';
import { IntegrationsSection } from './integrations-section';
import { LicenseExpiryBanner } from './license-expiry-banner';
import { HelpButton } from '@/components/help/help-button';

export const metadata = { title: 'Admin · Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const restaurant = await requireRestaurant();
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
    include: { hours: { orderBy: { dayOfWeek: 'asc' } } }
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header>
        <div className="flex items-center justify-between gap-3">
          <h1 className="display text-3xl font-semibold">Settings</h1>
          <HelpButton appArea="admin.settings" />
        </div>
        <p className="text-sm text-muted-foreground mt-1">Manage your storefront, branches, integrations, and notifications.</p>
      </header>

      {/* FSSAI licence expiry warning — only renders when a branch needs attention. */}
      <LicenseExpiryBanner branches={JSON.parse(JSON.stringify(branches))} />

      <SettingsShell
        branding={
          <section className="space-y-3">
            <SectionHeader icon={Building2} title="Storefront branding" subtitle="What customers see on your restaurant page." />
            <Card><CardContent className="p-4 sm:p-6"><BrandingForm restaurant={JSON.parse(JSON.stringify(restaurant))} initialConfig={parseStorefrontConfig((restaurant as { storefrontConfig?: unknown }).storefrontConfig)} /></CardContent></Card>
          </section>
        }
        orderFlow={
          <section className="space-y-3">
            <SectionHeader icon={Workflow} title="Order flow" subtitle="Auto-accept, scheduled orders, self-pickup, and dine-in reservations." />
            <Link href="/admin/settings/order-flow">
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center justify-between p-6">
                  <span className="text-sm">Configure how orders are accepted, scheduled, picked up, and dined-in.</span>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          </section>
        }
        branches={
          <section className="space-y-3">
            <SectionHeader
              icon={MapPin}
              title={`Branches (${branches.length})`}
              subtitle="Address, delivery zone, tax rate, fees, and operating hours per location."
            />
            <BranchesAccordion branches={JSON.parse(JSON.stringify(branches))} />
          </section>
        }
        integrations={
          <section className="space-y-3">
            <SectionHeader icon={Plug} title="Integrations" subtitle="Connect payments, messaging, and storage providers with a wizard. Secrets stay encrypted in the database." />
            <IntegrationsSection />
          </section>
        }
        reviews={
          <section className="space-y-3">
            {/* ReviewsSettings renders its own branded header */}
            <ReviewsSettings restaurantId={restaurant.id} />
          </section>
        }
        notifications={
          <section className="space-y-3">
            <SectionHeader icon={Bell} title="Notifications log" subtitle="Every SMS, WhatsApp, email, and push sent to your customers, riders, and staff." />
            <Card><CardContent className="p-0"><NotificationsTable /></CardContent></Card>
          </section>
        }
      />
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div>
        <h2 className="display text-xl font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
