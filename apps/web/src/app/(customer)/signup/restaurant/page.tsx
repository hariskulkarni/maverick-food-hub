import { RestaurantSignupForm } from './form';
import { brand } from '@/lib/brand';
import { Sparkles, ChefHat, Truck, ShieldCheck, MonitorSmartphone } from 'lucide-react';
import { novaryqFlagOn } from '@/server/novaryq/config';

export const metadata = { title: 'Open your restaurant' };
// Reads NOVARYQ_INTEGRATION_ENABLED at request time (the POS-partner section follows the live flag).
export const dynamic = 'force-dynamic';

export default function RestaurantSignupPage() {
  return (
    <div className="gradient-hero">
      <div className="container py-10 md:py-16 max-w-3xl">
        {/* Hero */}
        <div className="text-center mb-10 reveal">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold tracking-wider uppercase mb-4 float-soft">
            <Sparkles className="size-3.5" /> For restaurant owners
          </div>
          <h1 className="display text-4xl md:text-5xl font-semibold tracking-tight">
            Open your kitchen on <span className="text-gradient-saffron">{brand.name}</span>
          </h1>
          <p className="mt-3 max-w-xl mx-auto text-muted-foreground">
            Set up your storefront in under 10 minutes. We'll review your application and have you live in about a day.
          </p>

          {/* Trust badges */}
          <div className="mt-6 grid grid-cols-3 gap-3 max-w-lg mx-auto text-xs">
            <Badge icon={ChefHat} label="Curated kitchens" />
            <Badge icon={Truck} label="Platform riders" />
            <Badge icon={ShieldCheck} label="Approved in ~1 day" />
          </div>
        </div>

        <RestaurantSignupForm />

        {/* POS partner (ADR-FNI-001 §4.4). Shown only while the integration is switched on, so it never promises what isn't live. */}
        {novaryqFlagOn() && (
          <section aria-labelledby="pos-partner" className="mt-8 rounded-2xl border bg-card/60 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <MonitorSmartphone className="size-5" />
              </div>
              <div className="space-y-2 text-sm">
                <h2 id="pos-partner" className="font-semibold text-base">POS partner: powered by Novaryq</h2>
                <p className="text-muted-foreground">
                  Already run your counter on Novaryq India? Connect it to {brand.name} from your admin. {brand.name} orders print as
                  tickets in your Novaryq kitchen at {brand.name} prices, marked prepaid or cash to collect. Kitchen progress comes back
                  to {brand.name}, and items you mark sold out in Novaryq are hidden on {brand.name} automatically. {brand.name} riders
                  deliver; your Novaryq menu stays the one you edit.
                </p>
                <p className="text-muted-foreground">
                  Only Novaryq India (INR) accounts can be connected. Learn about Novaryq at{' '}
                  <a href="https://novaryq.in" target="_blank" rel="noopener noreferrer" className="text-primary underline">novaryq.in</a>.
                </p>
              </div>
            </div>
          </section>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          Already approved? <a href="/login?mode=admin&next=/admin" className="text-primary underline">Sign in here</a>.
          Want to ride deliveries instead? <a href="/signup/rider" className="text-primary underline">Become a rider</a>.
        </p>
      </div>
    </div>
  );
}

function Badge({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border bg-card/60 backdrop-blur p-3">
      <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <span className="font-medium text-foreground">{label}</span>
    </div>
  );
}
