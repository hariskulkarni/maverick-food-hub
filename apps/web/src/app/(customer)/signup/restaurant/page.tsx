import { RestaurantSignupForm } from './form';
import { brand } from '@/lib/brand';
import { Sparkles, ChefHat, Truck, ShieldCheck } from 'lucide-react';

export const metadata = { title: 'Open your restaurant' };

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
