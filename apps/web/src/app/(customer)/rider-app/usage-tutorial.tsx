'use client';

import { useState, useEffect } from 'react';
import { LogIn, Wifi, BellRing, Package, Navigation, KeyRound, Check } from 'lucide-react';

/**
 * 5-step rider-flow tutorial. Auto-advances every 4 s, but pauses the moment
 * the user taps a tab (or hovers on desktop) so they can read at their own
 * pace. Each step swaps in a small phone-screen mockup illustrating that
 * specific moment in the rider experience.
 */

const STEPS = [
  {
    n: 1, icon: LogIn,
    title: 'Sign in with your phone',
    body: 'Open the app, enter your mobile number, type the 6-digit OTP we send. That\'s it — no passwords.',
  },
  {
    n: 2, icon: Wifi,
    title: 'Toggle online',
    body: 'On the home screen, flip the big toggle at the top. You\'re now visible to the dispatch engine.',
  },
  {
    n: 3, icon: BellRing,
    title: 'Accept an order',
    body: 'A popup pings with the restaurant, distance, and your payout. You have 30 seconds to tap "Accept".',
  },
  {
    n: 4, icon: Package,
    title: 'Pickup at the restaurant',
    body: 'Show the 4-digit pickup OTP to the kitchen. They confirm, app marks the order PICKED UP.',
  },
  {
    n: 5, icon: KeyRound,
    title: 'Deliver + get paid',
    body: 'At the customer\'s door, enter the 4-digit delivery OTP. The instant you tap DELIVERED, your earnings hit your wallet.',
  },
] as const;

export function UsageTutorial() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % STEPS.length), 4500);
    return () => window.clearInterval(id);
  }, [paused]);

  return (
    <div
      className="grid gap-8 lg:grid-cols-[440px_1fr] items-start"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      {/* Phone preview */}
      <div className="lg:sticky lg:top-24">
        <div className="relative mx-auto max-w-[360px]">
          <div className="relative aspect-[9/19.5] rounded-[2.5rem] border-[8px] border-foreground/80 bg-card shadow-2xl overflow-hidden">
            <div className="absolute top-2 left-1/2 -translate-x-1/2 h-5 w-24 rounded-full bg-foreground/80 z-10" />
            <div key={active} className="absolute inset-0 slide-in-r">
              {active === 0 && <LoginMockup />}
              {active === 1 && <OnlineMockup />}
              {active === 2 && <AcceptMockup />}
              {active === 3 && <PickupMockup />}
              {active === 4 && <DeliveredMockup />}
            </div>
          </div>
        </div>
      </div>

      {/* Steps list */}
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const isActive = i === active;
          const isDone = i < active;
          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => { setActive(i); setPaused(true); }}
                className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${
                  isActive
                    ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                    : 'border-border hover:border-primary/40 bg-card'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`grid size-12 place-items-center rounded-xl shrink-0 transition-all ${
                    isDone ? 'bg-success text-white pop-in' : isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {isDone ? <Check className="size-6" /> : <s.icon className="size-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {s.n}</div>
                    <h3 className="display text-lg font-bold mt-0.5">{s.title}</h3>
                    {isActive && <p className="mt-2 text-sm text-muted-foreground leading-relaxed slide-in-r">{s.body}</p>}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {/* Auto-advance progress bar */}
        <li>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              key={`${active}-${paused}`}
              className="h-full bg-primary"
              style={{ width: paused ? '100%' : '0%', animation: paused ? 'none' : 'fill-bar 4.5s linear forwards' }}
            />
          </div>
          <style>{`@keyframes fill-bar { from { width: 0% } to { width: 100% } }`}</style>
        </li>
      </ol>
    </div>
  );
}

// ─────────────────────────── Phone screen mockups ───────────────────────────
function PhoneFrame({ children, accent = 'from-primary to-berry' }: { children: React.ReactNode; accent?: string }) {
  return <div className={`absolute inset-0 bg-gradient-to-br ${accent} text-white p-6 pt-12 flex flex-col items-center justify-center text-center`}>{children}</div>;
}

function LoginMockup() {
  return (
    <PhoneFrame accent="from-primary via-primary to-berry">
      <div className="display text-2xl font-extrabold">Welcome 👋</div>
      <p className="mt-1 text-xs text-white/85 max-w-[200px]">Enter your phone to get started</p>
      <div className="mt-6 w-full rounded-2xl bg-white/15 backdrop-blur p-4 text-left">
        <div className="text-[10px] uppercase tracking-wider text-white/70">Mobile number</div>
        <div className="display text-xl font-bold tracking-wider mt-1">+91 98765 43210</div>
      </div>
      <button className="mt-4 w-full rounded-xl bg-white text-primary font-bold text-sm py-3 shadow-lg">
        Send OTP
      </button>
    </PhoneFrame>
  );
}

function OnlineMockup() {
  return (
    <PhoneFrame accent="from-success via-success to-pop">
      <div className="text-[11px] text-white/80 uppercase tracking-wider">Today</div>
      <div className="display text-4xl font-extrabold mt-1">₹0</div>
      <div className="text-xs text-white/85 mt-1">0 deliveries · Ready to start</div>
      <div className="mt-8 w-full rounded-2xl bg-white/15 backdrop-blur p-5 flex items-center justify-between">
        <div>
          <div className="display font-bold text-lg">You&apos;re online</div>
          <div className="text-[11px] text-white/80 flex items-center gap-1.5 mt-0.5">
            <span className="size-2 rounded-full bg-white pulse-soft" /> Looking for orders
          </div>
        </div>
        <div className="w-12 h-7 rounded-full bg-white/30 relative">
          <div className="absolute top-0.5 right-0.5 size-6 rounded-full bg-white shadow" />
        </div>
      </div>
    </PhoneFrame>
  );
}

function AcceptMockup() {
  return (
    <PhoneFrame accent="from-warning via-warning to-primary">
      <div className="text-[11px] uppercase tracking-wider text-white/80">New order</div>
      <div className="display text-3xl font-extrabold mt-1">₹78</div>
      <div className="text-xs text-white/85 mt-0.5">Includes ₹12 surge bonus</div>
      <div className="mt-5 w-full rounded-2xl bg-white/15 backdrop-blur p-4 text-left text-xs space-y-1.5">
        <div className="flex justify-between"><span className="opacity-80">Restaurant</span><span className="font-bold">Bowl &amp; Barbeque</span></div>
        <div className="flex justify-between"><span className="opacity-80">Drop-off area</span><span className="font-bold">Brodipet</span></div>
        <div className="flex justify-between"><span className="opacity-80">Total trip</span><span className="font-bold">2.4 km · ~12 min</span></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 w-full">
        <button className="rounded-xl bg-white/20 text-white text-sm font-semibold py-3">Skip</button>
        <button className="rounded-xl bg-white text-warning text-sm font-bold py-3 shadow-lg">Accept</button>
      </div>
      <div className="text-[10px] text-white/70 mt-2">0:24 remaining</div>
    </PhoneFrame>
  );
}

function PickupMockup() {
  return (
    <PhoneFrame accent="from-berry via-primary to-warning">
      <div className="text-[11px] uppercase tracking-wider text-white/80">Pickup OTP</div>
      <div className="display text-5xl font-extrabold tracking-[0.3em] mt-2 pop-in">4218</div>
      <div className="text-xs text-white/85 mt-2 max-w-[220px]">Show this code to the kitchen — they confirm and you&apos;re off.</div>
      <div className="mt-5 w-full rounded-xl bg-white/15 backdrop-blur p-3 text-left text-xs">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-warning pulse-soft" />
          <span className="font-semibold">Picking up at Bowl &amp; Barbeque</span>
        </div>
        <div className="opacity-80 mt-0.5 pl-4">Arriving 14 Sept Plaza · 0.0 km</div>
      </div>
    </PhoneFrame>
  );
}

function DeliveredMockup() {
  return (
    <PhoneFrame accent="from-success via-success to-pop">
      <div className="grid size-20 place-items-center rounded-full bg-white/20 backdrop-blur burst">
        <Check className="size-10" />
      </div>
      <div className="display text-2xl font-extrabold mt-4">Delivered ✨</div>
      <div className="mt-2 text-xs text-white/85">+₹78 added to your wallet</div>
      <div className="mt-6 w-full rounded-2xl bg-white/15 backdrop-blur p-4 text-left">
        <div className="text-[10px] uppercase tracking-wider text-white/70">Today</div>
        <div className="display text-2xl font-extrabold">₹78</div>
        <div className="text-[11px] text-white/85 mt-0.5">1 delivery · 4.9 ★</div>
      </div>
    </PhoneFrame>
  );
}
