import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Privacy Policy',
  description: `How ${brand.name} collects, uses and protects your personal data.`
};

const UPDATED = '15 May 2026';

export default function PrivacyPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Legal</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-foreground/90">
        This Privacy Policy explains how {brand.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects,
        uses, shares and protects your personal data when you use our website, apps and
        services. We are committed to handling your data responsibly and in line with India&apos;s
        Digital Personal Data Protection Act, 2023 (DPDP Act) and other applicable law. By using
        the platform, you agree to the practices described here.
      </p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-foreground/90">
        <section>
          <h2 className="display text-xl font-semibold">1. Data we collect</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Account data</span> — your name,
              phone number, email address and password (stored hashed).
            </li>
            <li>
              <span className="font-medium text-foreground">Order data</span> — the items you
              order, delivery addresses, order notes, and order history.
            </li>
            <li>
              <span className="font-medium text-foreground">Location data</span> — your delivery
              address and, where you allow it, your device location, so riders can find you and
              you can track your order on a live map.
            </li>
            <li>
              <span className="font-medium text-foreground">Payment data</span> — payments are
              processed by our payment partners; we receive a transaction reference and status,
              not your full card details.
            </li>
            <li>
              <span className="font-medium text-foreground">Device &amp; usage data</span> — IP
              address, device and browser type, and how you interact with the platform, used for
              security and to improve the service.
            </li>
            <li>
              <span className="font-medium text-foreground">Communications</span> — messages you
              send to support, ratings and reviews you leave.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">2. How we use your data</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>To create and manage your account and authenticate you.</li>
            <li>To process orders, route them to restaurants, and dispatch riders.</li>
            <li>To enable live order tracking and accurate delivery estimates.</li>
            <li>To process payments, refunds and payouts.</li>
            <li>To provide customer support and respond to your requests.</li>
            <li>To send service messages about your orders and account.</li>
            <li>
              To send promotional messages where you have opted in — you can opt out at any
              time.
            </li>
            <li>To detect, prevent and investigate fraud, abuse and security incidents.</li>
            <li>To comply with our legal and tax obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">3. Location data for delivery</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Location data is central to a delivery service. We use your saved delivery address
            to route orders, and — only with your permission — your live device location to
            place you accurately on the map and give the rider precise directions. Riders see
            only the information needed to complete your delivery. You can withdraw location
            permission in your device settings at any time, though some features (such as
            live tracking) may not work without it.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">4. How we share data</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We do not sell your personal data. We share it only as needed to run the service:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Restaurants</span> — receive your
              order details and the name and contact needed to prepare and confirm it.
            </li>
            <li>
              <span className="font-medium text-foreground">Riders</span> — receive your
              delivery address, contact number and live location during an active delivery.
            </li>
            <li>
              <span className="font-medium text-foreground">Service providers</span> — payment
              processors, mapping, SMS/email and hosting providers, bound by confidentiality.
            </li>
            <li>
              <span className="font-medium text-foreground">Legal authorities</span> — where
              required by law, court order or to protect rights and safety.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">5. Data retention</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We keep your personal data only as long as needed for the purposes above. Order and
            transaction records are retained for as long as required by tax and accounting law
            (typically up to eight years). Account data is kept while your account is active; if
            you delete your account, we remove or anonymise your data within a reasonable period,
            except where we must retain it to meet a legal obligation or resolve disputes.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">6. Your rights</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Under the DPDP Act you have the right to:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Access a summary of the personal data we hold about you.</li>
            <li>Request correction of inaccurate or incomplete data.</li>
            <li>Request erasure of your data where it is no longer needed.</li>
            <li>Withdraw consent you have previously given.</li>
            <li>Nominate another person to exercise your rights in the event of incapacity.</li>
            <li>Raise a grievance with us, and escalate to the Data Protection Board of India.</li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            To exercise any of these rights, contact our Grievance Officer using the details
            below. We will respond within the timeframes required by law.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">7. Data security</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We use encryption in transit, hashed passwords, access controls and monitoring to
            protect your data. No system is perfectly secure, but we work to limit risk and will
            notify you and the relevant authority of any breach as required by law.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">8. Cookies</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We use cookies and similar technologies to keep you signed in, remember your
            preferences and understand how the platform is used. For details, see our{' '}
            <a href="/cookies" className="text-primary underline">
              Cookie Policy
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">9. Children</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The platform is not intended for anyone under 18. We do not knowingly collect data
            from children. If you believe a child has provided us data, contact us and we will
            remove it.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">10. Changes to this policy</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We may update this policy from time to time. We will post the revised version here
            with a new &ldquo;last updated&rdquo; date, and notify you of material changes.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">11. Contact &amp; Grievance Officer</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            For any privacy question or to exercise your rights, contact our Grievance Officer
            at{' '}
            <a href="mailto:privacy@oakandsizzler.in" className="text-primary underline">
              privacy@oakandsizzler.in
            </a>{' '}
            or call {brand.supportPhone}. {brand.name} is operated from Andhra Pradesh, India.
          </p>
        </section>
      </div>
    </div>
  );
}
