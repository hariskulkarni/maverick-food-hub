/**
 * Inline-SVG, food-themed illustrations for each onboarding step. Brand colours
 * come from the theme tokens via Tailwind fill/stroke utilities (berry, coral
 * primary, lime pop), so they follow light/dark mode. Purely decorative
 * (aria-hidden). Motion is CSS (`ob-*` in globals.css) and switches off under
 * prefers-reduced-motion. Each sits in a fixed-height box → no layout shift.
 */
import type { ComponentType, ReactNode } from 'react';
import type { OnboardingStep } from '@/lib/onboarding';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="mx-auto h-32 w-full max-w-[240px] sm:h-40">
      <svg viewBox="0 0 200 140" className="h-full w-full overflow-visible" focusable="false">
        <ellipse cx="100" cy="128" rx="62" ry="7" className="fill-berry/10" />
        {children}
      </svg>
    </div>
  );
}

function Sparkle({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <path
      d={`M${x} ${y - 7 * s} L${x + 2 * s} ${y - 2 * s} L${x + 7 * s} ${y} L${x + 2 * s} ${y + 2 * s} L${x} ${y + 7 * s} L${x - 2 * s} ${y + 2 * s} L${x - 7 * s} ${y} L${x - 2 * s} ${y - 2 * s} Z`}
      className="ob-twinkle fill-pop"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

/** Welcome: a steaming biryani bowl with a wiggling chilli. */
export function WelcomeArt() {
  return (
    <Frame>
      <g className="ob-bob">
        <path d="M44 74 h112 a56 46 0 0 1 -112 0 Z" className="fill-primary" />
        <path d="M52 74 h96 a48 6 0 0 1 -96 0 Z" className="fill-berry/25" />
        <path d="M58 74 c4 -22 22 -32 42 -32 s38 10 42 32 Z" className="fill-[#FBE7B5] dark:fill-[#F3D891]" />
        <circle cx="82" cy="60" r="4" className="fill-pop" />
        <circle cx="108" cy="54" r="3.5" className="fill-pop" />
        <circle cx="122" cy="64" r="3" className="fill-primary" />
        <circle cx="94" cy="66" r="2.5" className="fill-[#E9A23B]" />
        <path d="M60 96 q40 14 80 0" className="fill-none stroke-white/40" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="stroke-berry/45 fill-none" strokeWidth="3.5" strokeLinecap="round">
        <path d="M82 34 q-6 -8 0 -16 t0 -16" className="ob-steam" />
        <path d="M100 30 q-6 -8 0 -16 t0 -16" className="ob-steam ob-steam-2" />
        <path d="M118 34 q-6 -8 0 -16 t0 -16" className="ob-steam ob-steam-3" />
      </g>
      <g className="ob-wiggle">
        <path d="M156 38 c10 4 16 16 12 30 c-2 6 -8 6 -9 0 c-2 -10 -6 -18 -10 -22 Z" className="fill-primary" />
        <path d="M152 40 c0 -6 4 -10 9 -10" className="fill-none stroke-pop" strokeWidth="3" strokeLinecap="round" />
      </g>
      <Sparkle x={34} y={42} />
      <Sparkle x={172} y={104} s={0.8} delay={0.7} />
    </Frame>
  );
}

/** Phone: a phone with a bouncing "code on its way" bubble. */
export function PhoneArt() {
  return (
    <Frame>
      <rect x="70" y="14" width="60" height="112" rx="12" className="fill-berry" />
      <rect x="76" y="24" width="48" height="90" rx="6" className="fill-background" />
      <rect x="92" y="18" width="16" height="3" rx="1.5" className="fill-white/40" />
      <rect x="82" y="36" width="30" height="5" rx="2.5" className="fill-muted-foreground/30" />
      <rect x="82" y="46" width="22" height="5" rx="2.5" className="fill-muted-foreground/20" />
      <rect x="82" y="96" width="36" height="10" rx="5" className="fill-primary/80" />
      <g className="ob-bob">
        <path d="M118 46 h52 a8 8 0 0 1 8 8 v20 a8 8 0 0 1 -8 8 h-38 l-10 9 v-9 h-4 a8 8 0 0 1 -8 -8 v-20 a8 8 0 0 1 8 -8 Z" className="fill-primary" />
        <circle cx="134" cy="64" r="3.5" className="fill-white" />
        <circle cx="146" cy="64" r="3.5" className="fill-white/80" />
        <circle cx="158" cy="64" r="3.5" className="fill-white/60" />
      </g>
      <g className="ob-wiggle">
        <circle cx="42" cy="58" r="16" className="fill-pop" />
        <path d="M34 58 h16 M42 50 v16" className="stroke-berry" strokeWidth="4" strokeLinecap="round" />
      </g>
      <Sparkle x={52} y={102} s={0.8} delay={0.4} />
    </Frame>
  );
}

/** Verify: a shield with a tick, six code dots and sparkles. */
export function VerifyArt() {
  return (
    <Frame>
      <g className="ob-bob">
        <path d="M100 12 l44 16 v30 c0 30 -20 52 -44 62 c-24 -10 -44 -32 -44 -62 v-30 Z" className="fill-primary" />
        <path d="M100 24 l32 12 v22 c0 22 -14 39 -32 47 c-18 -8 -32 -25 -32 -47 v-22 Z" className="fill-white/15" />
        <path d="M82 66 l12 12 l24 -26" className="fill-none stroke-white" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={22 + i * 7} cy={112} r="2.6" className="ob-twinkle fill-berry/60" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
      <Sparkle x={160} y={30} delay={0.2} />
      <Sparkle x={40} y={36} s={0.8} delay={0.9} />
      <Sparkle x={168} y={98} s={0.7} delay={1.3} />
    </Frame>
  );
}

/** About you: a chef hat over a plate with a beating heart. */
export function AboutArt() {
  return (
    <Frame>
      <ellipse cx="100" cy="104" rx="58" ry="16" className="fill-muted" />
      <ellipse cx="100" cy="100" rx="44" ry="11" className="fill-background" />
      <g className="ob-bob">
        <path d="M70 70 c-14 0 -18 -22 -2 -26 c2 -16 26 -18 32 -6 c8 -12 30 -8 30 8 c14 4 10 24 -4 24 Z" className="fill-white stroke-berry/30" strokeWidth="2" />
        <rect x="72" y="66" width="56" height="18" rx="4" className="fill-white stroke-berry/30" strokeWidth="2" />
        <path d="M80 75 h40" className="stroke-primary/60" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="ob-wiggle">
        <path d="M156 34 c-6 -10 -22 -4 -16 8 l16 16 l16 -16 c6 -12 -10 -18 -16 -8 Z" className="fill-primary" />
      </g>
      <g className="stroke-berry/50" strokeWidth="4" strokeLinecap="round">
        <path d="M30 70 v40 M24 70 v12 a6 6 0 0 0 12 0 v-12" className="fill-none" />
        <path d="M172 72 c8 0 8 16 0 20 v18" className="fill-none" />
      </g>
      <Sparkle x={44} y={34} delay={0.5} />
    </Frame>
  );
}

/** Address: a home with a map pin dropping onto it along a dotted route. */
export function AddressArt() {
  return (
    <Frame>
      <path d="M24 118 C60 96 70 128 104 112 S160 92 180 104" className="fill-none stroke-berry/30" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 9" />
      <g>
        <path d="M70 70 l30 -26 l30 26 v44 h-60 Z" className="fill-berry" />
        <path d="M62 74 l38 -34 l38 34" className="fill-none stroke-primary" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="92" y="88" width="16" height="26" rx="3" className="fill-pop" />
        <rect x="76" y="80" width="10" height="10" rx="2" className="fill-white/80" />
        <rect x="114" y="80" width="10" height="10" rx="2" className="fill-white/80" />
      </g>
      <g className="ob-drop">
        <path d="M152 14 c-12 0 -20 9 -20 20 c0 15 20 34 20 34 s20 -19 20 -34 c0 -11 -8 -20 -20 -20 Z" className="fill-primary" />
        <circle cx="152" cy="34" r="7" className="fill-white" />
      </g>
      <Sparkle x={36} y={44} s={0.9} delay={0.3} />
    </Frame>
  );
}

/** Done: a lifted cloche revealing stars — dinner is served. */
export function DoneArt() {
  return (
    <Frame>
      <ellipse cx="100" cy="112" rx="66" ry="10" className="fill-muted" />
      <rect x="40" y="104" width="120" height="8" rx="4" className="fill-berry" />
      <g className="ob-bob">
        <path d="M54 92 a46 46 0 0 1 92 0 Z" className="fill-primary" transform="rotate(-14 54 92)" />
        <circle cx="96" cy="36" r="6" className="fill-primary" transform="rotate(-14 54 92)" />
      </g>
      <Sparkle x={104} y={78} s={1.4} />
      <Sparkle x={70} y={60} s={0.9} delay={0.4} />
      <Sparkle x={140} y={52} s={1.1} delay={0.8} />
      <Sparkle x={172} y={86} s={0.7} delay={1.2} />
      <Sparkle x={30} y={80} s={0.7} delay={1.5} />
    </Frame>
  );
}

const ART: Record<OnboardingStep, ComponentType> = {
  welcome: WelcomeArt,
  phone: PhoneArt,
  verify: VerifyArt,
  about: AboutArt,
  address: AddressArt,
  done: DoneArt,
};

export function StepArt({ step }: { step: OnboardingStep }) {
  const Art = ART[step];
  return <Art />;
}
