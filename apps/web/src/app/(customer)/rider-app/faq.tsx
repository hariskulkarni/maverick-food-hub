'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const QUESTIONS = [
  {
    q: 'Is the app free?',
    a: 'Yes. The app is free to download and there\'s no subscription or signup fee. We earn a commission on each completed delivery — the rider always sees their full payout in the app.',
  },
  {
    q: 'Why isn\'t the app on the Play Store?',
    a: 'It is — but our latest builds ship a few days before the Play Store version is approved. Installing directly from this page is the fastest way to start riding today. Either source gives you exactly the same app.',
  },
  {
    q: 'How quickly do I get paid?',
    a: 'Earnings credit your in-app wallet the second you tap DELIVERED on each order. From your wallet, request a payout to your bank account anytime — typically T+1 on bank business days.',
  },
  {
    q: 'What documents do I need?',
    a: 'Aadhaar (front + back), PAN, valid driving licence, vehicle RC, vehicle insurance, and a clear selfie. You can upload everything from Profile → KYC inside the app. KYC verification takes under 24 hours.',
  },
  {
    q: 'What do I do if I have an accident?',
    a: 'Press SOS (long-press the red button on the active-order screen). It pings our 24×7 ops team AND your emergency contact, and shares your live location. Then call 112 if anyone is injured. Every active delivery is covered by ₹2 lakh personal accident + ₹1 lakh medical insurance.',
  },
  {
    q: 'Can I work part-time, e.g. only evenings?',
    a: 'Absolutely. You decide when to go online. Most part-time riders go online from 18:00–22:00 (dinner rush) and do 8–15 deliveries in that window. No minimum hours, no penalty for going offline.',
  },
  {
    q: 'I\'m installing the APK — is it safe?',
    a: 'Yes. The APK is built and signed by Flavrly and served from our own servers (https://flavrly.in). Android\'s "install from unknown source" warning is a standard step for any app not from the Play Store; it doesn\'t mean anything is wrong.',
  },
  {
    q: 'My phone won\'t install the APK',
    a: 'Two things to check: (1) your Android version — you need 7.0 or newer, (2) free storage — you need ~200 MB. If both check out, restart your phone and try again. Still stuck? Call us on +91 92139 95005.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3 max-w-3xl">
      {QUESTIONS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className={`rounded-2xl border-2 transition-colors ${isOpen ? 'border-primary' : 'border-border'}`}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-4 p-4 md:p-5 text-left"
              aria-expanded={isOpen}
            >
              <span className="font-semibold text-sm md:text-base">{item.q}</span>
              <ChevronDown className={`size-5 text-primary shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <div
              className="overflow-hidden transition-[max-height] duration-300 ease-out"
              style={{ maxHeight: isOpen ? '500px' : '0px' }}
            >
              <div className="px-4 md:px-5 pb-4 md:pb-5 text-sm text-muted-foreground leading-relaxed">{item.a}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
