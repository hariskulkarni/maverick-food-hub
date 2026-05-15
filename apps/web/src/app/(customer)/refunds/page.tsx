import { brand } from '@/lib/brand';

export const metadata = {
  title: 'Refund & Cancellation Policy',
  description: `How cancellations and refunds work on ${brand.name}.`
};

const UPDATED = '15 May 2026';

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
        . Because food is prepared fresh to order, the windows below are necessarily tight —
        please read them before placing an order.
      </p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-foreground/90">
        <section>
          <h2 className="display text-xl font-semibold">1. Cancelling an order</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Before the kitchen accepts</span> —
              you can cancel free of charge for a full refund.
            </li>
            <li>
              <span className="font-medium text-foreground">After acceptance, before cooking
              starts</span> — cancellation is usually still possible; a small charge may apply if
              the kitchen has begun preparation.
            </li>
            <li>
              <span className="font-medium text-foreground">Once cooking has started</span> —
              the order generally cannot be cancelled, as the food has been made specifically for
              you.
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            You can cancel from your order screen, or contact support if you need help.
          </p>
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
              We review the request with the restaurant where needed and confirm the outcome,
              usually within 1–2 business days.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">5. How refunds are paid</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Online payments</span> — refunded to
              your original payment method, typically within 5–7 business days, depending on your
              bank or payment provider.
            </li>
            <li>
              <span className="font-medium text-foreground">Cash on delivery</span> — refunded as
              platform credit or to a bank account / UPI ID you provide.
            </li>
            <li>
              <span className="font-medium text-foreground">Platform credit</span> — applied to
              your account immediately and used automatically on your next order.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">6. Coupons &amp; credits</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Where a discount or coupon was applied, refunds are calculated on the amount you
            actually paid. Promotional credits used on a cancelled order are returned as
            credit, not cash.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-semibold">7. Need help?</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            For any refund or cancellation question, contact{' '}
            <a href="mailto:support@oakandsizzler.in" className="text-primary underline">
              support@oakandsizzler.in
            </a>{' '}
            or call {brand.supportPhone}. You can also reach us through the{' '}
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
