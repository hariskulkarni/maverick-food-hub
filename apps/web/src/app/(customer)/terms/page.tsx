import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Terms of Service',
  description: `The terms governing your use of the ${brand.name} platform.`
};

const UPDATED = '15 May 2026';

export default function TermsPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Legal</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-foreground/90">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the{' '}
        {brand.name} website, apps and services (the &ldquo;Platform&rdquo;). By creating an
        account or placing an order, you agree to these Terms. Please read them carefully.
      </p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-foreground/90">
        <section>
          <h2 className="display text-xl font-semibold">1. About the Platform</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {brand.name} operates a marketplace that connects customers with independent
            restaurants and delivery riders. Restaurants prepare the food and are responsible
            for its quality, packaging and food-safety compliance; riders carry out delivery. We
            provide the technology that brings the three sides together and facilitates orders
            and payments.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">2. Eligibility &amp; accounts</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>You must be at least 18 years old to create an account and place orders.</li>
            <li>
              You agree to provide accurate information and to keep your account details and
              password secure.
            </li>
            <li>You are responsible for all activity that takes place under your account.</li>
            <li>
              Notify us immediately if you suspect unauthorised use. We may suspend or close
              accounts that breach these Terms or are used for fraud or abuse.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">3. Orders</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              When you place an order, you make an offer to purchase. The order is confirmed
              once the restaurant accepts it.
            </li>
            <li>
              Menu items, prices, photos and availability are set by restaurants and may change
              without notice. Occasional errors may occur; if an item is mispriced or
              unavailable, the restaurant or we may cancel the affected order and refund you.
            </li>
            <li>
              You are responsible for providing a correct delivery address and a reachable
              contact number, and for being available to receive the order.
            </li>
            <li>
              Estimated delivery times are estimates, not guarantees, and depend on traffic,
              weather and kitchen load.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">4. Pricing &amp; payments</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              The total shown at checkout includes the item price, applicable taxes, delivery
              fee and any other charges, less any discount or coupon applied.
            </li>
            <li>
              You may pay online through our payment partners or, where offered, by cash on
              delivery.
            </li>
            <li>
              Coupons and promotional credits are subject to their own terms and may be
              withdrawn or limited at any time.
            </li>
            <li>
              You agree to pay all charges incurred under your account. Failure of cash-on-
              delivery payment may lead to that option being disabled for your account.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">5. Cancellations &amp; refunds</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            You may cancel an order before the restaurant begins preparing it. Once preparation
            has started, cancellation may not be possible or may incur a charge. Refunds for
            cancelled, undelivered or materially incorrect orders are handled as set out in our{' '}
            <a href="/refunds" className="text-primary underline">
              Refund &amp; Cancellation Policy
            </a>
            , which forms part of these Terms.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">6. Your conduct</h2>
          <p className="mt-3 text-sm text-muted-foreground">You agree not to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Use the Platform for any unlawful, fraudulent or abusive purpose.</li>
            <li>Place orders you do not intend to receive or pay for.</li>
            <li>Harass, threaten or mistreat restaurant staff or riders.</li>
            <li>Post false, defamatory or misleading reviews.</li>
            <li>
              Attempt to interfere with, reverse-engineer or gain unauthorised access to the
              Platform.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">7. Food safety &amp; allergens</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Restaurants are responsible for the preparation, quality and safety of the food and
            for the accuracy of allergen and dietary information. If you have allergies or
            specific dietary needs, contact the restaurant before ordering. {brand.name} does
            not prepare food and cannot guarantee a kitchen is free of any allergen.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">8. Intellectual property</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The Platform, including its software, branding and content we create, belongs to{' '}
            {brand.name} or its licensors. You may use the Platform only as permitted by these
            Terms. Restaurant names, logos and menu content belong to the respective
            restaurants.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">9. Liability</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The Platform is provided on an &ldquo;as is&rdquo; basis. To the extent permitted by
            law, {brand.name} is not liable for indirect or consequential loss, and our total
            liability for any order is limited to the amount you paid for that order. Nothing in
            these Terms limits liability that cannot be limited under applicable law, including
            for death or personal injury caused by negligence.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">10. Suspension &amp; termination</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We may suspend or terminate your access to the Platform if you breach these Terms,
            if required by law, or to protect the Platform and its users. You may stop using the
            Platform and close your account at any time.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">11. Changes to these Terms</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We may update these Terms from time to time. The current version will always be
            posted here with its &ldquo;last updated&rdquo; date. Your continued use of the
            Platform after changes take effect means you accept the revised Terms.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">12. Governing law &amp; disputes</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            These Terms are governed by the laws of India. Subject to applicable consumer-
            protection law, the courts at Andhra Pradesh, India shall have exclusive
            jurisdiction over any dispute arising out of or in connection with these Terms or
            your use of the Platform.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">13. Contact</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Questions about these Terms? Email{' '}
            <a href="mailto:support@oakandsizzler.in" className="text-primary underline">
              support@oakandsizzler.in
            </a>{' '}
            or call {brand.supportPhone}.
          </p>
        </section>
      </div>
    </div>
  );
}
