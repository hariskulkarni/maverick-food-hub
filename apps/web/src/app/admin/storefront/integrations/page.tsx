import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Plug, Bell, Workflow, Building2, ChevronRight } from 'lucide-react';
import { IntegrationsSection } from '../../settings/integrations-section';
import { NotificationsTable } from '../../settings/notifications-table';

export const metadata = { title: 'Admin · Storefront CMS · Integrations' };
export const dynamic = 'force-dynamic';

/**
 * CMS hub Integrations tab. Reuses the real, encrypted-secret integration
 * wizard (payment gateways like Razorpay, WhatsApp providers, SMS, SMTP,
 * storage, maps) and the live notifications log — plus quick links to the
 * order-flow and branding settings. No duplicated logic; these are the same
 * components powering /admin/settings.
 */
export default async function CmsIntegrationsTab() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeader icon={Plug} title="Integrations" subtitle="Connect payment gateways, WhatsApp & SMS messaging, email (SMTP), storage and maps with a guided wizard. Secrets stay encrypted in the database." />
        <IntegrationsSection />
      </section>

      <section className="space-y-3">
        <SectionHeader icon={Bell} title="Notifications log" subtitle="Every SMS, WhatsApp, email, and push sent to your customers, riders, and staff." />
        <Card><CardContent className="p-0"><NotificationsTable /></CardContent></Card>
      </section>

      <section className="space-y-3">
        <SectionHeader icon={Workflow} title="Order flow & branding" subtitle="Auto-accept, scheduled orders, pickup, dine-in — and your logo, cover image and brand colours." />
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLink href="/admin/settings/order-flow" icon={Workflow} title="Order flow" desc="Accept, schedule, pickup, dine-in." />
          <QuickLink href="/admin/settings" icon={Building2} title="Branding & branches" desc="Logo, cover, hours, fees, tax." />
        </div>
      </section>
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

function QuickLink({ href, icon: Icon, title, desc }: { href: string; icon: any; title: string; desc: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-accent h-full">
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <span className="flex items-center gap-3 min-w-0">
            <Icon className="size-5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block font-medium text-sm">{title}</span>
              <span className="block text-xs text-muted-foreground truncate">{desc}</span>
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
