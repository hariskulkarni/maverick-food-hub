import Link from 'next/link';
import { brand } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChefHat, Bike, ShoppingBag, ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'About',
  description: `The story behind ${brand.name} — the food marketplace connecting kitchens, customers and riders.`
};

export default function AboutPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">About us</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">About {brand.name}</h1>
      <p className="mt-3 text-lg text-muted-foreground">{brand.tagline}</p>

      <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-foreground/90">
        <p>
          {brand.name} started with a simple frustration: great neighbourhood kitchens were
          hard to find online, and the ones that were listed lost most of their margin to
          delivery apps that treated them as an afterthought. We thought a food marketplace
          could be fairer than that — for everyone in it.
        </p>
        <p>
          So we built one. Today {brand.name} connects home-style kitchens and full-service
          restaurants with hungry customers across the city, and a pool of independent riders
          who get every order to the door hot. No middlemen taking a cut at every step — just a
          platform that the three sides of the marketplace actually share.
        </p>
      </div>

      {/* Mission */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Our mission</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
          Make it effortless for any kitchen to sell online, give customers an honest, reliable
          way to order from them, and pay riders fairly for the work they do. We measure
          ourselves on three numbers: how quickly a restaurant can go live, how often an order
          arrives on time, and how much of every rupee ends up with the people who cooked and
          delivered your food.
        </p>
      </section>

      {/* How it works */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">How it works</h2>
        <ol className="mt-4 space-y-4">
          {[
            {
              n: '1',
              t: 'A kitchen lists its menu',
              d: 'Restaurants sign up, get verified, and publish their dishes, prices and photos — usually live within a day.'
            },
            {
              n: '2',
              t: 'A customer places an order',
              d: 'You browse kitchens near you, build a cart, pay online or choose cash on delivery, and check out in a few taps.'
            },
            {
              n: '3',
              t: 'A rider delivers it',
              d: 'The moment the kitchen marks an order ready, the nearest available rider is dispatched and tracked to your door.'
            }
          ].map(({ n, t, d }) => (
            <li key={n} className="flex gap-4">
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {n}
              </div>
              <div>
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Three sides */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">The three sides of the marketplace</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ShoppingBag,
              t: 'Customers',
              d: 'Every kitchen in town in one place, with live tracking and honest ETAs.'
            },
            {
              icon: ChefHat,
              t: 'Restaurants',
              d: 'A storefront, payments and a rider network — without the overhead of running them.'
            },
            {
              icon: Bike,
              t: 'Riders',
              d: 'Flexible hours, same-day payouts, and 100% of tips kept by the rider.'
            }
          ].map(({ icon: Icon, t, d }) => (
            <Card key={t}>
              <CardContent className="p-5">
                <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Where we are */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Where we are</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
          {brand.name} is built and operated from Andhra Pradesh, India, and we are growing
          city by city — onboarding kitchens and riders in each new area before we open
          ordering to customers there. If your favourite restaurant isn&apos;t on the platform
          yet, tell them about us.
        </p>
      </section>

      {/* CTA */}
      <div className="mt-12 flex flex-wrap gap-3">
        <Button asChild className="group">
          <Link href="/signup/restaurant">
            List your restaurant
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/careers">See open roles</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/contact">Get in touch</Link>
        </Button>
      </div>
    </div>
  );
}
