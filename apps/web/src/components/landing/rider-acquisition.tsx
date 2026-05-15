import Link from 'next/link';
import { ArrowRight, CalendarClock, Wallet, ShieldCheck, HandCoins } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * "For riders" strip — a green-tinted gradient panel with the rider value
 * proposition and the primary "Become a rider" CTA.
 *
 * Lives on the platform home only; this is purely an acquisition surface.
 */
export function RiderAcquisition() {
  const bullets = [
    { icon: CalendarClock, label: 'Flexible hours — work when you want' },
    { icon: Wallet, label: 'Same-day payout, straight to your bank' },
    { icon: ShieldCheck, label: 'Insurance cover on every active shift' },
    { icon: HandCoins, label: '100% of tips go to you, no cuts' }
  ] as const;

  return (
    <section className="border-y bg-muted/20">
      <div className="container py-20">
        <div className="overflow-hidden rounded-3xl border-0 shadow-xl">
          <div className="relative bg-gradient-to-br from-success via-success/85 to-primary/60 p-8 md:p-12 text-white">
            <div className="pointer-events-none absolute -top-16 -right-16 size-72 rounded-full bg-white/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 -left-16 size-72 rounded-full bg-white/10 blur-3xl" />

            <div className="relative grid gap-10 md:grid-cols-2 md:items-center">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-white/80">
                  For riders
                </div>
                <h2 className="display mt-2 text-3xl md:text-5xl font-bold leading-tight">
                  Earn on your schedule
                </h2>
                <p className="mt-4 text-white/90 max-w-md">
                  Join the platform rider pool. Pick up orders from any kitchen on Reshee Tech,
                  set your own hours, and get paid the same day.
                </p>

                <div className="mt-6">
                  <Button
                    size="lg"
                    asChild
                    className="bg-white text-success hover:bg-white/90 group/btn"
                  >
                    <Link href="/signup/rider">
                      Become a rider
                      <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
                    </Link>
                  </Button>
                </div>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2">
                {bullets.map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="flex items-start gap-3 rounded-2xl bg-white/10 backdrop-blur p-4 ring-1 ring-white/15"
                  >
                    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20">
                      <Icon className="size-4.5" />
                    </div>
                    <span className="text-sm text-white/95 leading-snug">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
