import Link from 'next/link';
import { brand } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Rocket, HeartHandshake, GraduationCap, Scale, MapPin, ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'Careers',
  description: `Build the food marketplace for India with ${brand.name}. See open roles and how to apply.`
};

const VALUES = [
  {
    icon: Rocket,
    t: 'We ship, then improve',
    d: 'Small teams, short cycles, real users. You see the impact of your work in days, not quarters.'
  },
  {
    icon: HeartHandshake,
    t: 'Fair to all three sides',
    d: 'Customers, restaurants and riders all have to win. We make decisions with all of them in the room.'
  },
  {
    icon: GraduationCap,
    t: 'Learn on the job',
    d: 'Ownership from day one, mentorship when you need it, and room to grow into the next role.'
  },
  {
    icon: Scale,
    t: 'Honest by default',
    d: 'Clear numbers, clear feedback, no theatre. We would rather hear the hard truth early.'
  }
];

const ROLES = [
  { team: 'Engineering', title: 'Full-stack Engineer', type: 'Full-time', loc: 'Andhra Pradesh / Remote' },
  { team: 'Engineering', title: 'Mobile Engineer', type: 'Full-time', loc: 'Andhra Pradesh / Remote' },
  { team: 'Operations', title: 'City Launcher', type: 'Full-time', loc: 'Andhra Pradesh' },
  { team: 'Partner Success', title: 'Restaurant Onboarding Lead', type: 'Full-time', loc: 'Andhra Pradesh' },
  { team: 'Support', title: 'Customer Support Associate', type: 'Full-time', loc: 'Andhra Pradesh' },
  { team: 'Design', title: 'Product Designer', type: 'Full-time', loc: 'Remote (India)' }
];

export default function CareersPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Careers</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">
        Build the food marketplace for India
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">
        We&apos;re a small team in Andhra Pradesh putting every neighbourhood kitchen online and
        getting their food delivered fairly. If that sounds like work worth doing, we&apos;d
        love to hear from you.
      </p>

      {/* Why work here */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Why work here</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {VALUES.map(({ icon: Icon, t, d }) => (
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

      {/* Life at the company */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Life at {brand.name}</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
          We&apos;re small enough that everyone knows what everyone else is working on, and big
          enough that you&apos;re never the only person who can fix something. Expect real
          ownership, a flat structure, and teammates who care about the craft. We work in
          person where it helps — launching a city, onboarding kitchens — and remotely where it
          doesn&apos;t.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Competitive salary and meaningful equity for full-time roles.</li>
          <li>Health cover for you and your immediate family.</li>
          <li>A learning budget and time set aside to use it.</li>
          <li>Meal credits on the platform — eat from the kitchens you help grow.</li>
          <li>Flexible hours built around outcomes, not clock-watching.</li>
        </ul>
      </section>

      {/* Open roles */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">Open roles</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A snapshot of what we&apos;re hiring for. Don&apos;t see your exact role? Send us an
          open application anyway.
        </p>
        <div className="mt-4 divide-y rounded-2xl border">
          {ROLES.map((r) => (
            <div
              key={r.title}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {r.team}
                </div>
                <div className="mt-0.5 font-medium">{r.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" />
                  {r.loc} · {r.type}
                </div>
              </div>
              <Button size="sm" variant="outline" asChild>
                <a href="mailto:careers@oakandsizzler.in?subject=Application">Apply</a>
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* How to apply */}
      <section className="mt-12">
        <h2 className="display text-2xl font-semibold">How to apply</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
          Email{' '}
          <a href="mailto:careers@oakandsizzler.in" className="text-primary underline">
            careers@oakandsizzler.in
          </a>{' '}
          with the role in the subject line, a short note on why you&apos;re a fit, and your CV
          or a link to your work. We read every application and aim to reply within a week. Our
          process is usually a screening call, a practical task or portfolio review, and a
          conversation with the team you&apos;d join.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="group">
            <a href="mailto:careers@oakandsizzler.in?subject=Open%20application">
              Send an open application
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/about">Learn about us</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
