import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Cookie Policy',
  description: `How ${brand.name} uses cookies and similar technologies.`
};

const UPDATED = '15 May 2026';

const COOKIE_TYPES = [
  {
    t: 'Strictly necessary',
    d: 'Keep you signed in, remember the contents of your cart, secure your session and let core pages load. The platform cannot work without these, so they cannot be switched off.'
  },
  {
    t: 'Preferences',
    d: 'Remember choices such as your selected currency, saved addresses and display settings, so you do not have to set them again each visit.'
  },
  {
    t: 'Analytics',
    d: 'Help us understand how the platform is used — which pages are visited, where people run into trouble — so we can fix and improve it. This data is aggregated.'
  },
  {
    t: 'Marketing',
    d: 'Used only where you have opted in, to measure the performance of our campaigns and show you more relevant offers. We do not sell this data.'
  }
];

export default function CookiesPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Legal</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">Cookie Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-foreground/90">
        This Cookie Policy explains how {brand.name} uses cookies and similar technologies when
        you use our website and apps. It should be read alongside our{' '}
        <a href="/privacy" className="text-primary underline">
          Privacy Policy
        </a>
        .
      </p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-foreground/90">
        <section>
          <h2 className="display text-xl font-semibold">1. What are cookies?</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Cookies are small text files stored on your device when you visit a website. They
            let the site remember your actions and preferences over time. We also use related
            technologies such as local storage and pixels — we refer to all of these as
            &ldquo;cookies&rdquo; in this policy.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">2. Types of cookies we use</h2>
          <div className="mt-4 divide-y rounded-2xl border">
            {COOKIE_TYPES.map((c) => (
              <div key={c.t} className="p-4">
                <h3 className="font-semibold">{c.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{c.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">3. Third-party cookies</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Some cookies are set by trusted third parties who provide services on our behalf —
            for example payment processing, mapping for live order tracking, and analytics.
            These providers may set their own cookies, governed by their own privacy policies.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">4. Managing your cookies</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Where required, we ask for your consent to non-essential cookies and you can change
            your choice at any time. You can also control or delete cookies through your browser
            settings. Please note that blocking strictly necessary cookies will stop parts of
            the platform — such as signing in and checking out — from working.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">5. Changes to this policy</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We may update this Cookie Policy as our use of cookies changes. The latest version
            will always be posted here with its &ldquo;last updated&rdquo; date.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">6. Contact</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Questions about our use of cookies? Email{' '}
            <a href="mailto:privacy@oakandsizzler.in" className="text-primary underline">
              privacy@oakandsizzler.in
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
