import { brand } from '@/lib/brand';
export const metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <div className="container py-12 max-w-3xl space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">About</div>
      <h1 className="display text-4xl font-semibold">{brand.name}</h1>
      <p className="text-lg text-muted-foreground">{brand.tagline}</p>
      <p>
        We started in a tiny kitchen with one rule: cook everything fresh, season it generously, and don't compromise on the basics.
        Today, that same kitchen serves hundreds of orders a day across the city — biryanis on dum, kebabs on charcoal, and dals that simmer overnight.
      </p>
      <p>
        Every order is cooked from scratch, tracked in real time, and sent out hot. We work with local farmers for vegetables, hand-pick spices monthly,
        and refuse to ship anything we wouldn't eat ourselves.
      </p>
    </div>
  );
}
