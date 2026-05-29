/**
 * /rider-app — Flavrly Rider app install + onboarding landing page.
 *
 * Riders (and the curious) land here from links broadcast in WhatsApp groups
 * or referral codes. The page has 3 jobs:
 *   1. Make downloading the APK trivially easy — big CTA, file size, version,
 *      and a server-rendered QR code so desktop visitors can scan with phone.
 *   2. Walk a first-timer through the 3-step install (Download → Allow install
 *      from Chrome → Open).
 *   3. Teach them the 5-step rider flow (Sign in → Online → Accept → Pickup →
 *      Deliver) so the first delivery isn't scary.
 *
 * SEO: full metadata + Open Graph so the link shares cleanly on WhatsApp / FB.
 * Mobile-first (riders are on phones); a desktop layout shows the QR alongside.
 */
import { brand } from '@/lib/brand';
import { qrPngDataUrl } from '@/server/qr-image';
import { promises as fs } from 'fs';
import path from 'path';
import { Download, Smartphone, MapPin, Wallet, ShieldCheck, Phone, MessageCircle, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { InstallGuide } from './install-guide';
import { UsageTutorial } from './usage-tutorial';
import { EarningsCalculator } from './earnings-calculator';
import { Faq } from './faq';
import { Reveal } from './reveal';
import { StatsCounter } from './stats-counter';
import { CopyLinkButton } from './copy-link-button';

export const dynamic = 'force-dynamic';

const APK_PATH = '/downloads/flavrly-rider.apk';

export async function generateMetadata() {
  const title = `Become a ${brand.name} rider — download the app`;
  const description = `Earn flexibly delivering with ${brand.name}. Set your own hours, get paid per delivery + tips + surge bonuses. Install the Android app in under a minute.`;
  return {
    title,
    description,
    keywords: ['rider app', 'delivery rider', 'food delivery jobs', 'flexible income', 'Guntur rider', brand.name],
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: '/icon-180.png', width: 180, height: 180 }],
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

async function getApkInfo() {
  // Try to read the on-disk APK size so we show riders the real file size.
  // Falls back gracefully if the file isn't deployed yet (CI / first-deploy).
  try {
    const p = path.join(process.cwd(), 'public', APK_PATH);
    const stat = await fs.stat(p);
    const sizeMb = Math.round((stat.size / (1024 * 1024)) * 10) / 10;
    return { sizeMb, available: true };
  } catch {
    return { sizeMb: 85, available: false };
  }
}

export default async function RiderAppPage() {
  const [{ sizeMb, available }, qrPng] = await Promise.all([
    getApkInfo(),
    qrPngDataUrl(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in'}${APK_PATH}`, 320),
  ]);
  const fullUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in'}${APK_PATH}`;

  return (
    <main className="min-h-dvh overflow-x-hidden">
      {/* ─── HERO ────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Decorative gradient blobs */}
        <div aria-hidden className="pointer-events-none absolute -top-32 -left-32 size-[480px] rounded-full bg-primary/20 blur-3xl float-soft-slow" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-32 size-[480px] rounded-full bg-secondary/30 blur-3xl float-soft" />

        <div className="container relative grid gap-10 py-12 md:py-20 lg:grid-cols-2 lg:gap-16 items-center">
          {/* Left: copy + CTA */}
          <div className="reveal-stagger">
            <div>
              <BrandMark className="text-xl mb-6" />
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" /> Android app · v1.0
              </div>
            </div>
            <h1 className="display mt-4 text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight">
              Deliver on your own time.<br />
              <span className="text-primary">Get paid daily.</span>
            </h1>
            <p className="mt-5 text-base md:text-lg text-muted-foreground max-w-xl">
              Join hundreds of riders earning with {brand.name}. Set your own hours, get paid for every delivery
              plus tips and surge bonuses — straight to your wallet, daily payouts to your bank.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <a
                href={APK_PATH}
                download
                className="group inline-flex items-center justify-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-bold text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-shadow"
              >
                <Download className="size-5 group-hover:animate-bounce" />
                Download the Rider app
                <span className="hidden sm:inline text-xs font-medium opacity-80">· {sizeMb} MB · Android</span>
              </a>
              <CopyLinkButton url={fullUrl} />
            </div>
            {!available && (
              <p className="mt-2 text-xs text-warning flex items-center gap-1.5">
                <span className="inline-block size-1.5 rounded-full bg-warning animate-pulse" />
                APK build pending — link will go live shortly.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground sm:hidden">{sizeMb} MB · Android only · Free</p>
          </div>

          {/* Right: phone mockup + QR */}
          <div>
            <div className="grid gap-6 sm:grid-cols-[1fr_240px] items-center">
              {/* Phone mockup */}
              <div className="relative mx-auto max-w-[280px] phone-tilt">
                <div className="relative aspect-[9/19.5] w-full rounded-[2.5rem] border-[8px] border-foreground/80 bg-gradient-to-br from-primary via-primary to-berry shadow-2xl overflow-hidden">
                  {/* Notch */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 h-5 w-24 rounded-full bg-foreground/80 z-10" />
                  {/* Screen */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-6 text-center">
                    <div className="grid size-16 place-items-center rounded-2xl bg-white/15 backdrop-blur mb-4 burst">
                      <Smartphone className="size-8" />
                    </div>
                    <div className="display text-xl font-bold leading-tight">You&apos;re online</div>
                    <div className="mt-1 text-xs text-white/80 inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-pop pulse-soft" /> Looking for orders
                    </div>
                    <div className="mt-8 w-full rounded-2xl bg-white/10 backdrop-blur p-4 text-left">
                      <div className="text-[10px] uppercase tracking-wider text-white/70">Today</div>
                      <div className="display text-2xl font-bold">₹1,247</div>
                      <div className="mt-1 text-[11px] text-white/80">12 deliveries · 4.9 ★</div>
                    </div>
                    <div className="mt-3 w-full rounded-2xl border border-white/30 p-3 text-left animate-pulse">
                      <div className="text-[10px] uppercase tracking-wider text-white/80">New order · 0.4 km</div>
                      <div className="text-xs font-semibold mt-0.5">Bowl &amp; Barbeque → Brodipet</div>
                      <div className="text-[10px] text-white/70 mt-0.5">~12 min · ₹78</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* QR for desktop visitors */}
              <div className="text-center sm:text-left">
                <div className="hidden sm:block">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Scan to install</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrPng} alt={`QR code to download the ${brand.name} Rider app`} width={200} height={200} className="rounded-2xl border bg-white p-2 shadow-md" />
                  <p className="mt-2 text-[11px] text-muted-foreground max-w-[200px]">Point your Android phone&apos;s camera at this code.</p>
                </div>
                <div className="sm:hidden inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="size-3.5" /> You&apos;re on a phone — tap the download button.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── STATS ─────────────────────────────────────────────────────────── */}
      <Reveal>
        <section className="border-y bg-muted/30">
          <div className="container py-10">
            <div className="grid grid-cols-3 gap-6 text-center">
              <StatsCounter end={4.9} label="Avg rider rating" decimals={1} suffix=" ★" />
              <StatsCounter end={45000} label="Monthly deliveries" prefix="" />
              <StatsCounter end={1500} label="Active riders this week" prefix="" suffix="+" />
            </div>
          </div>
        </section>
      </Reveal>

      {/* ─── INSTALL GUIDE ─────────────────────────────────────────────────── */}
      <section id="install" className="container py-16 md:py-20">
        <Reveal>
          <div className="max-w-2xl mb-10">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Get set up</div>
            <h2 className="display mt-1 text-3xl md:text-4xl font-bold">Install in under a minute</h2>
            <p className="mt-3 text-muted-foreground">
              Three taps. No Play Store required. Your data and progress carry over if you reinstall.
            </p>
          </div>
        </Reveal>
        <InstallGuide apkUrl={APK_PATH} sizeMb={sizeMb} />
      </section>

      {/* ─── USAGE TUTORIAL ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-y bg-muted/20">
        <div className="container py-16 md:py-20">
          <Reveal>
            <div className="max-w-2xl mb-10">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Your first delivery</div>
              <h2 className="display mt-1 text-3xl md:text-4xl font-bold">From login to paid in 5 steps</h2>
              <p className="mt-3 text-muted-foreground">
                Tap through the steps below — each one shows you exactly what to expect on your phone.
              </p>
            </div>
          </Reveal>
          <UsageTutorial />
        </div>
      </section>

      {/* ─── EARNINGS ──────────────────────────────────────────────────────── */}
      <section id="earnings" className="container py-16 md:py-20">
        <Reveal>
          <div className="max-w-2xl mb-10">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">What you earn</div>
            <h2 className="display mt-1 text-3xl md:text-4xl font-bold">Real numbers, real riders</h2>
            <p className="mt-3 text-muted-foreground">
              Drag the slider to see how distance, surge, and tier add up. These are real per-delivery figures
              — exactly the maths used inside the app.
            </p>
          </div>
        </Reveal>
        <EarningsCalculator />
      </section>

      {/* ─── SAFETY ────────────────────────────────────────────────────────── */}
      <Reveal>
        <section className="border-y bg-gradient-to-br from-primary/5 via-background to-secondary/10">
          <div className="container py-16 md:py-20">
            <div className="max-w-2xl mb-10">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Safety, built in</div>
              <h2 className="display mt-1 text-3xl md:text-4xl font-bold">You&apos;re never riding alone</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3 reveal-stagger">
              <Pillar icon={ShieldCheck} title="One-tap SOS" body="A red SOS button on every active order. Press and hold for 2 seconds — we ping your emergency contact and our ops team within 30 seconds." />
              <Pillar icon={MapPin} title="Share my trip" body="Your live location can be shared with a family member via WhatsApp every time you're online. Set it once in Profile → Safety." />
              <Pillar icon={Wallet} title="Insurance included" body="₹2 lakh personal accident cover + ₹1 lakh medical reimbursement on every active delivery. No extra cost." />
            </div>
          </div>
        </section>
      </Reveal>

      {/* ─── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="container py-16 md:py-20">
        <Reveal>
          <div className="max-w-2xl mb-10">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">FAQ</div>
            <h2 className="display mt-1 text-3xl md:text-4xl font-bold">Questions, answered</h2>
          </div>
        </Reveal>
        <Faq />
      </section>

      {/* ─── FINAL CTA ─────────────────────────────────────────────────────── */}
      <section className="border-t bg-gradient-to-br from-primary via-primary to-berry text-primary-foreground">
        <div className="container py-16 md:py-20 text-center">
          <Reveal>
            <h2 className="display text-3xl md:text-4xl font-bold">Ready when you are.</h2>
            <p className="mt-3 text-base md:text-lg text-primary-foreground/85 max-w-xl mx-auto">
              Download the app, finish KYC in 24h, and you&apos;re on the road. Have a question? Our rider support
              team is on WhatsApp + phone 24×7.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href={APK_PATH}
                download
                className="inline-flex items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-base font-bold text-primary shadow-xl hover:scale-[1.02] transition-transform"
              >
                <Download className="size-5" /> Download the Rider app · {sizeMb} MB
              </a>
              <a
                href="tel:+919213995005"
                className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-white/60 px-7 py-4 text-base font-semibold hover:bg-white/10 transition-colors"
              >
                <Phone className="size-5" /> +91 92139 95005
              </a>
              <a
                href="https://wa.me/919213995005"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-white/60 px-7 py-4 text-base font-semibold hover:bg-white/10 transition-colors"
              >
                <MessageCircle className="size-5" /> WhatsApp
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}

function Pillar({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary mb-4">
        <Icon className="size-6" />
      </div>
      <h3 className="display text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
