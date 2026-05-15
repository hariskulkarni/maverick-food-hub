import Link from 'next/link';
import { Wallet, Bike, BarChart3, ArrowRight, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * "Why Reshee Tech" value-prop cards for restaurant owners.
 *
 * Rendered as a three-up row on desktop, single column on mobile. Each card is
 * an icon tile + headline + body + a small inline "Learn more" anchor link to
 * the `#`-section listed in `learnMoreHref`.
 */
export function RestaurantAcquisitionCard({
  icon: Icon,
  title,
  body,
  learnMoreHref,
  learnMoreLabel = 'Learn more'
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  learnMoreHref: string;
  learnMoreLabel?: string;
}) {
  return (
    <Card className="card-lift border-border/70 h-full">
      <CardContent className="p-7">
        <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary ring-saffron">
          <Icon className="size-6" />
        </div>
        <h3 className="display mt-5 text-xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
        <Link
          href={learnMoreHref}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 group"
        >
          {learnMoreLabel}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Pre-baked trio for the platform home. Keeping the data here means the page
 * file stays a thin compositional layer.
 */
export function RestaurantAcquisitionGrid() {
  const cards: {
    icon: LucideIcon;
    title: string;
    body: string;
    learnMoreHref: string;
  }[] = [
    {
      icon: Wallet,
      title: 'Zero setup cost',
      body: 'Sign up free, no monthly fee, no hidden charges. You only pay a small commission when we bring you an order.',
      learnMoreHref: '#how-it-works'
    },
    {
      icon: Bike,
      title: 'Built-in rider network',
      body: 'No need to hire delivery staff or run your own logistics. Our rider pool picks up from your kitchen the moment food is ready.',
      learnMoreHref: '#how-it-works'
    },
    {
      icon: BarChart3,
      title: 'Real-time dashboard',
      body: 'Track orders, kitchen status, payouts and customer feedback live. Pause orders, edit menus or run offers in seconds.',
      learnMoreHref: '#faq'
    }
  ];

  return (
    <div className="grid gap-5 md:grid-cols-3 reveal-stagger">
      {cards.map((c) => (
        <RestaurantAcquisitionCard key={c.title} {...c} />
      ))}
    </div>
  );
}
