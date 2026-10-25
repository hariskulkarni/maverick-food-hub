import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Refund & Cancellation Policy',
  description: `How cancellations and refunds work on ${brand.name}.`
};

const UPDATED = '24 October 2026';

export default function RefundsPage() {
  return (
    <div className="container py-12 md:py-16 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Legal</div>
      <h1 className="display mt-2 text-3xl md:text-4xl font-semibold">
        Refund &amp; Cancellation Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-foreground/90">
        This policy explains when you can cancel an order on {brand.name} and when you are
        entitled to a refund. It forms part of our{' '}
        <a href="/terms" className="text-primary underline">
          Terms of Service
        </a>
        . Because food is prepared fresh to order, please read it before placing an order.
      </p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-foreground/90">
        <section>
          <h2 className="display text-xl font-semibold">1. Cancelling an order</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              There is no cancel button in the app or on the website. To cancel, contact support
              as soon as possible with your order number.
            </li>
            <li>
              <span className="font-medium text-foreground">Before the restaurant accepts</span> —
              we can cancel the order for you.
            </li>
            <li>
              <span className="font-medium text-foreground">After the restaurant accepts</span> —
              whether the order can still be cancelled is decided case by case, because the food
              may already be in preparation.
            </li>
            <li>
              The restaurant may also decline or cancel an order (for example, if an item is
              unavailable). You will be notified when this happens.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">2. When you are entitled to a refund</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We will arrange a full or partial refund (or, at your choice, platform credit) in
            cases such as:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>The order was never delivered.</li>
            <li>The restaurant cancelled the order after you paid.</li>
            <li>Items were missing from your order.</li>
            <li>
              You received the wrong items, or items that were materially different from what
              was ordered.
            </li>
            <li>
              The food arrived in an unacceptable condition — for example spilled, spoiled or
              clearly unsafe.
            </li>
            <li>You were charged incorrectly.</li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">3. When a refund may not apply</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              The order could not be delivered because the address was wrong or you were
              unreachable.
            </li>
            <li>You changed your mind after the food was already prepared.</li>
            <li>
              Concerns about taste or preference where the item matches its menu description.
            </li>
            <li>Claims raised long after delivery without enough detail to investigate.</li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            These are guidelines, not a blanket rule — we look at each case fairly and in line
            with applicable consumer-protection law.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">4. How to raise a refund request</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Contact support as soon as possible — ideally within 24 hours of delivery — with
              your order number.
            </li>
            <li>
              Tell us what went wrong. Photos of incorrect or damaged items help us resolve
              things faster.
            </li>
            <li>
              We review the request with the restaurant where needed and tell you the outcome.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">5. How refunds are paid</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Refunds are not automatic, including when an order is cancelled. The {brand.name}{' '}
              support team reviews each case and issues the refund.
            </li>
            <li>
              <span className="font-medium text-foreground">{brand.name} wallet (default)</span> —
              approved refunds are normally credited to your {brand.name} wallet. The credit is
              available as soon as it is issued and can be used on your next orders.
            </li>
            <li>
              <span className="font-medium text-foreground">Original payment method</span> — in
              some cases we refund an online payment back to the method you paid with instead. How
              long it takes to reach you then depends on your bank or payment provider.
            </li>
            <li>
              <span className="font-medium text-foreground">Cash on delivery</span> — refunds are
              credited to your {brand.name} wallet.
            </li>
            <li>A refund is never more than the amount you paid for the order.</li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">
            6. Wrong amounts, late payments &amp; UPI disputes
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              If you pay a different amount from the one shown, or pay after the payment window
              has expired, the payment is still recorded and reconciled. Any amount due back to
              you is reviewed and refunded by our support team (see section 5).
            </li>
            <li>
              Payments flagged by our risk checks may be held for review. Screenshots are not
              accepted as proof of payment; we confirm payments against the bank&apos;s credit
              record.
            </li>
            <li>
              For a UPI transaction problem (for example, money debited but not received), you can
              also raise a dispute through your UPI app or bank, which follow the NPCI
              dispute-resolution process (UDIR).
            </li>
            <li>
              We never ask for your UPI PIN and never send UPI &ldquo;collect&rdquo; requests to
              receive payment. Never share your UPI PIN or OTP with anyone.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">7. Coupons &amp; credits</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Where a discount or coupon was applied, refunds are calculated on the amount you
            actually paid. Sign-up bonus credit used on a cancelled order is restored to your
            account automatically; it is returned as credit, not cash.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">8. Need help?</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            For any refund or cancellation question, contact{' '}
            <a href={`mailto:${brand.supportEmail}`} className="text-primary underline">
              {brand.supportEmail}
            </a>
            {brand.supportPhone ? <> or call {brand.supportPhone}.</> : '.'} Or{' '}
            <a href="/help" className="text-primary underline">
              report a problem with an order
            </a>{' '}
            directly. You can also reach us through the{' '}
            <a href="/contact" className="text-primary underline">
              contact page
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
