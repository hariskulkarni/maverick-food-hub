import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Privacy Policy',
  description: `How ${brand.name} collects, uses and protects your personal data.`
};

const UPDATED = '22 October 2026';

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
        Digital Personal Data Protection Act, 2023 (DPDP Act), the Digital Personal Data Protection
        Rules, 2025 (DPDP Rules) and other applicable law. By using
        the platform, you agree to the practices described here.
      </p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-foreground/90">
        <section>
          <h2 className="display text-xl font-semibold">1. Data we collect</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Account data</span> — your name,
              mobile number and email address, used to sign you in with a one-time password (OTP)
              sent on WhatsApp, and, where applicable, a password (stored hashed).
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
              <span className="font-medium text-foreground">Payment data</span> — the payment
              status and reference for each order, and the UPI transaction reference (UTR) if you
              choose to enter it. For direct UPI payments, the bank&apos;s credit alert may show the
              payer&apos;s UPI ID or name; we store these in masked form. Where online payments
              through Razorpay are enabled, Razorpay processes them and we receive a transaction
              reference and status, not your full card details.
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
            <li>
              To confirm and reconcile UPI payments by matching the bank&apos;s credit alert to your
              order (see section 4).
            </li>
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
          <h2 className="display text-xl font-semibold">4. UPI payments and how we confirm them</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              When you pay by UPI, the money goes directly from your UPI app to the UPI ID of{' '}
              {brand.name} or the restaurant shown at checkout, by QR code or by opening your UPI
              app.
            </li>
            <li>
              Our self-hosted payment software (&ldquo;{brand.name} PG&rdquo;) confirms the payment
              by matching the bank&apos;s credit alert, received on the merchant&apos;s own phone or
              bank-alert mailbox, to your order using the amount, the bank reference (UTR) and the
              time.
            </li>
            <li>
              {brand.name} PG does not access your phone, your SMS or any of your other
              messages.
            </li>
            <li>
              Payments flagged by our risk checks may be held for review before the order is
              confirmed. Screenshots are not accepted as proof of payment.
            </li>
            <li>
              We never ask for your UPI PIN and never send UPI &ldquo;collect&rdquo; requests to
              receive payment. Never share your UPI PIN or OTP with anyone.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">5. How we share data</h2>
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
              processors (such as Razorpay, where enabled), mapping, messaging and hosting
              providers, bound by confidentiality.
            </li>
            <li>
              <span className="font-medium text-foreground">Banks</span> — UPI payments move
              between your bank and the payee&apos;s bank over the UPI network; for refunds and
              disputes we share the transaction reference with the banks involved.
            </li>
            <li>
              <span className="font-medium text-foreground">Legal authorities</span> — where
              required by law, court order or to protect rights and safety.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">6. Data retention</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We keep your personal data only as long as needed for the purposes above. Your data
            is stored on servers located in India.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Bank alert text used to confirm UPI payments is redacted and kept for 30 days.
            </li>
            <li>
              Order and matched payment records are kept as required by law (for example, tax and
              accounting rules) and to resolve disputes.
            </li>
            <li>Payment records that could not be matched to an order are kept for 90 days.</li>
            <li>
              Account data is kept while your account is active. If you delete your account, we
              remove or anonymise your data within a reasonable period, except where we must
              retain it to meet a legal obligation or resolve disputes.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">7. Your rights</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Under the DPDP Act and DPDP Rules you have the right to:
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
            below. We will respond within the timeframes required by the DPDP Act and DPDP
            Rules. If you are not satisfied with our response, you may escalate your complaint to
            the Data Protection Board of India.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">8. Data security</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We use encryption in transit, hashed passwords, access controls and monitoring to
            protect your data. No system is perfectly secure, but we work to limit risk and will
            notify you and the relevant authority of any breach as required by law.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">9. Cookies</h2>
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
          <h2 className="display text-xl font-semibold">10. Children</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The platform is not intended for anyone under 18. We do not knowingly collect data
            from children. If you believe a child has provided us data, contact us and we will
            remove it.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">11. Changes to this policy</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We may update this policy from time to time. We will post the revised version here
            with a new &ldquo;last updated&rdquo; date, and notify you of material changes.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">12. Contact &amp; Grievance Officer</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            For any privacy question or to exercise your rights, contact our Grievance Officer
            at{' '}
            <a href={`mailto:${brand.privacyEmail}`} className="text-primary underline">
              {brand.privacyEmail}
            </a>{' '}
            or call {brand.supportPhone}. {brand.name} is operated from Andhra Pradesh, India.
          </p>
        </section>
      </div>
    </div>
  );
}
