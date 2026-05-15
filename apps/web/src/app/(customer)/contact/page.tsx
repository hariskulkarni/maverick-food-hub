import Link from 'next/link';
import { brand } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { prisma } from '@/server/db';
import {
  Phone,
  MessageCircle,
  Clock,
  MapPin,
  Mail,
  ShoppingBag,
  ChefHat,
  Bike,
  ArrowRight
} from 'lucide-react';

export const metadata = {
  title: 'Contact',
  description: `Get in touch with ${brand.name} — support hours, channels and help for customers, restaurants and riders.`
};

export default async function ContactPage() {
  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  const waNumber = brand.supportWhatsapp.replace(/\D/g, '');

  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Contact</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">We&apos;d love to hear from you</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        Whether you&apos;re tracking an order, running a kitchen or riding with us, here&apos;s
        how to reach the right team.
      </p>

      {/* Channels */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <Phone className="size-4" /> Call us
            </h3>
            <a href={`tel:${brand.supportPhone}`} className="mt-2 block text-lg hover:text-primary">
              {brand.supportPhone}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">For urgent help with a live order.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <MessageCircle className="size-4" /> WhatsApp
            </h3>
            <a href={`https://wa.me/${waNumber}`} className="mt-2 block text-lg hover:text-primary">
              {brand.supportWhatsapp}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              Fastest for order updates and quick questions.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <Mail className="size-4" /> Email
            </h3>
            <a href="mailto:support@oakandsizzler.in" className="mt-2 block text-lg hover:text-primary">
              support@oakandsizzler.in
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              For refunds, billing and anything non-urgent.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="size-4" /> Support hours
            </h3>
            <p className="mt-2 text-sm text-foreground/90">Customer support: 9:00 — 23:00, every day</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Partner &amp; rider support: 8:00 — 22:00, Mon–Sat
            </p>
          </CardContent>
        </Card>
      </div>

      {branch && (
        <Card className="mt-4">
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <MapPin className="size-4" /> Registered office
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {branch.line1}, {branch.city} {branch.postalCode}, Andhra Pradesh, India
            </p>
          </CardContent>
        </Card>
      )}

      {/* Routing block */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Who are you contacting us as?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick the path that fits — it gets you to the right place faster.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ShoppingBag,
              t: "I'm a customer",
              d: 'Order issues, refunds, delivery problems or account help.',
              href: '/faq',
              cta: 'Help & FAQ'
            },
            {
              icon: ChefHat,
              t: 'I run a restaurant',
              d: 'Onboarding, menu, payouts or partner support.',
              href: '/signup/restaurant',
              cta: 'Partner with us'
            },
            {
              icon: Bike,
              t: 'I want to ride',
              d: 'Sign-up, shifts, earnings and rider support.',
              href: '/signup/rider',
              cta: 'Become a rider'
            }
          ].map(({ icon: Icon, t, d, href, cta }) => (
            <Card key={t} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground leading-relaxed">{d}</p>
                <Link
                  href={href}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 group"
                >
                  {cta}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Simple form */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Send us a message</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Fill this in and our support team will get back to you, usually within one business
          day.
        </p>
        <form className="mt-4 space-y-4" aria-label="Contact form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-name" className="text-sm font-medium">
                Your name
              </label>
              <input
                id="contact-name"
                name="name"
                type="text"
                autoComplete="name"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="contact-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="contact-topic" className="text-sm font-medium">
              Topic
            </label>
            <select
              id="contact-topic"
              name="topic"
              defaultValue="order"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="order">Help with an order</option>
              <option value="refund">Refund or payment</option>
              <option value="account">My account</option>
              <option value="restaurant">Restaurant partnership</option>
              <option value="rider">Riding with us</option>
              <option value="other">Something else</option>
            </select>
          </div>
          <div>
            <label htmlFor="contact-message" className="text-sm font-medium">
              Message
            </label>
            <textarea
              id="contact-message"
              name="message"
              rows={4}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit">Send message</Button>
        </form>
      </section>
    </div>
  );
}
