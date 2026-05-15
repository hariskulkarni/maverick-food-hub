import Link from 'next/link';
import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Help & FAQ',
  description: `Answers to common questions about ordering, payment, delivery, refunds and partnering with ${brand.name}.`
};

type QA = { q: string; a: string };
type Group = { id: string; title: string; items: QA[] };

const GROUPS: Group[] = [
  {
    id: 'ordering',
    title: 'Ordering',
    items: [
      {
        q: 'How do I place an order?',
        a: 'Browse restaurants near you, open a kitchen, add dishes to your cart and check out. You can also open a restaurant directly by scanning its QR code. No app download is required — the whole flow works in your browser.'
      },
      {
        q: 'Do I need an account to order?',
        a: 'You can browse freely, but you will need a quick account (just a phone number and name) to place an order so we can keep you updated and let you track delivery.'
      },
      {
        q: 'Can I order from more than one restaurant at once?',
        a: 'Each order is placed with a single kitchen so it can be cooked and delivered as one batch. To order from two restaurants, place two separate orders.'
      },
      {
        q: 'How do I change or cancel an order?',
        a: 'You can cancel from your order screen before the restaurant starts preparing it. Once cooking has begun, cancellation may not be possible — see our Refund & Cancellation Policy for details.'
      }
    ]
  },
  {
    id: 'payment',
    title: 'Payment & pricing',
    items: [
      {
        q: 'What payment methods can I use?',
        a: 'You can pay online through our secure payment partners, or choose cash on delivery where the restaurant offers it. The full breakdown — item price, taxes and delivery fee — is always shown at checkout.'
      },
      {
        q: 'Is my payment information safe?',
        a: 'Yes. Online payments are handled by our payment partners; we never see or store your full card details, only a transaction reference and status.'
      },
      {
        q: 'How do coupons and discounts work?',
        a: 'Enter a valid coupon code at checkout and the discount is applied to your total before payment. Coupons have their own terms and may have minimum-order or expiry conditions.'
      }
    ]
  },
  {
    id: 'delivery',
    title: 'Delivery & tracking',
    items: [
      {
        q: 'How long will my order take?',
        a: 'Most orders arrive in around 35 minutes, but the exact time depends on the kitchen, distance, traffic and weather. You will see a live ETA that updates as your order progresses.'
      },
      {
        q: 'Can I track my order?',
        a: 'Yes. Once your order is placed you can follow it from the kitchen to the rider to your door on a live map. You can also open the tracker any time from "Track an order".'
      },
      {
        q: 'What if no one is home when the rider arrives?',
        a: 'Please be reachable on the contact number you provide. If the rider cannot reach you or deliver after reasonable attempts, the order may be marked undelivered — see our Refund & Cancellation Policy for what happens next.'
      },
      {
        q: 'Do you deliver to my area?',
        a: 'We are expanding city by city. Enter your address at checkout to see whether kitchens currently deliver to you.'
      }
    ]
  },
  {
    id: 'refunds',
    title: 'Refunds & order issues',
    items: [
      {
        q: 'My order was wrong or missing items — what do I do?',
        a: 'Contact support straight away with your order number. For materially incorrect, missing or undelivered orders we will arrange a refund or credit as set out in our Refund & Cancellation Policy.'
      },
      {
        q: 'How long do refunds take?',
        a: 'Approved refunds are returned to your original payment method, typically within 5–7 business days, depending on your bank or payment provider.'
      }
    ]
  },
  {
    id: 'accounts',
    title: 'Accounts & privacy',
    items: [
      {
        q: 'How do I update my details or addresses?',
        a: 'Go to your profile to update your name, contact details and saved delivery addresses at any time.'
      },
      {
        q: 'How do I delete my account?',
        a: 'Contact support to request account deletion. We will remove or anonymise your data within a reasonable period, except where we must retain certain records to meet legal obligations. See our Privacy Policy for details.'
      },
      {
        q: 'What data do you collect about me?',
        a: 'Only what we need to run the service — your account details, orders, delivery location and usage data. Our Privacy Policy explains exactly what we collect and how we use it.'
      }
    ]
  },
  {
    id: 'partners',
    title: 'Restaurants & riders',
    items: [
      {
        q: 'How do I list my restaurant?',
        a: 'Start a partner application from "Add your restaurant". Listing is free — there is no monthly fee or setup cost, and we charge a small commission only on orders we successfully deliver. Most kitchens go live within a day.'
      },
      {
        q: 'How do I become a rider?',
        a: 'Sign up from "Become a rider". You choose your own hours, get same-day payouts straight to your bank, and keep 100% of your tips.'
      },
      {
        q: 'I am a partner — how do I sign in?',
        a: 'Use the restaurant login to reach your dashboard, where you manage your menu, orders and payouts.'
      }
    ]
  }
];

export default function FaqPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Support</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">Help &amp; FAQ</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        Answers to the questions we hear most. Still stuck?{' '}
        <Link href="/contact" className="text-primary underline">
          Contact our support team
        </Link>
        .
      </p>

      {/* Quick jump */}
      <nav className="mt-8 flex flex-wrap gap-2" aria-label="FAQ sections">
        {GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            {g.title}
          </a>
        ))}
      </nav>

      <div className="mt-10 space-y-12">
        {GROUPS.map((group) => (
          <section key={group.id} id={group.id} className="scroll-mt-24">
            <h2 className="display text-2xl font-semibold">{group.title}</h2>
            <div className="mt-3">
              {group.items.map((item) => (
                <details
                  key={item.q}
                  className="group border-b border-border/80 py-5 transition-colors hover:border-primary/40"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-4 list-none">
                    <span className="display text-lg font-medium pr-4">{item.q}</span>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground transition-all group-open:bg-primary group-open:text-primary-foreground group-open:rotate-45">
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-2xl">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border bg-secondary/40 p-6 text-center">
        <h2 className="display text-xl font-semibold">Didn&apos;t find your answer?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Our support team is available 9:00 — 23:00 every day.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/contact" className="text-primary font-medium underline">
            Contact support
          </Link>{' '}
          ·{' '}
          <Link href="/track" className="text-primary font-medium underline">
            Track an order
          </Link>
        </p>
      </div>
    </div>
  );
}
