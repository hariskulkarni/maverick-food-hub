import { ImageWithFallback } from '@/components/image-with-fallback';
import { CheckCircle2, ChefHat, Bike, MapPin } from 'lucide-react';

/**
 * HeroStage — the right-hand "showpiece" of the landing hero.
 *
 * It is a layered, depth-y composition that looks great on its own (no asset
 * required) and gracefully upgrades if a `/hero.mp4` is dropped into /public:
 *
 *   • a tilted glass "device" frame showing a live order-flow card,
 *   • an OPTIONAL autoplay/muted/loop/playsInline <video> (source /hero.mp4)
 *     painted behind a real food photo so a MISSING file never shows broken —
 *     the food <ImageWithFallback> always covers the frame underneath,
 *   • drifting food/ingredient "chips" that float around the frame,
 *   • soft parallax glow blobs.
 *
 * All motion is CSS-only and disabled under prefers-reduced-motion (handled in
 * globals.css). No layout shift: the stage reserves a fixed aspect ratio.
 */

const CHIP_IMG =
  'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=200&auto=format&fit=crop&q=80';

export function HeroStage() {
  return (
    <div className="hero-stage relative mx-auto w-full max-w-md select-none lg:max-w-lg">
      {/* Parallax glow behind the device */}
      <div
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-primary/30 via-pop/20 to-berry/20 blur-2xl float-soft"
        style={{ animationDelay: '0.6s' }}
        aria-hidden
      />

      {/* The tilted device frame */}
      <div className="hero-device card-lift relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-white/40 bg-card shadow-2xl ring-1 ring-black/5">
        {/* Hero food photo — the always-present fallback BENEATH the video, so
            if /hero.mp4 is ever missing or blocked the device still shows a
            real visual instead of an empty box. */}
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=900&auto=format&fit=crop&q=80"
          alt="A steaming plate of biryani, fresh from a Flavrly kitchen"
          fill
          priority
          sizes="(min-width: 1024px) 32rem, 90vw"
          className="object-cover"
        />

        {/* Branded Flavrly motion loop — plays ON TOP of the photo. The poster
            paints instantly; a missing/blocked file just reveals the photo. */}
        <video
          className="absolute inset-0 size-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/hero-poster.jpg"
          aria-hidden
          tabIndex={-1}
        >
          <source src="/hero.mp4" type="video/mp4" />
        </video>

        {/* Cinematic gradient so overlaid UI stays legible */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="hero-sheen pointer-events-none absolute inset-0" aria-hidden />

        {/* Floating "order status" glass card — the order-flow moment */}
        <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-white/85 p-3.5 backdrop-blur-md ring-1 ring-black/5">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex size-2.5 shrink-0">
              <span className="absolute inset-0 rounded-full bg-success pulse-soft" />
              <span className="size-2.5 rounded-full bg-success" />
            </span>
            <span className="text-xs font-semibold text-foreground">Order #F-2048 · on the way</span>
            <span className="ml-auto text-xs font-medium text-muted-foreground">8 min</span>
          </div>

          {/* Animated progress rail: cook → ready → riding → delivered */}
          <div className="mt-3 flex items-center gap-1.5">
            <Step icon={ChefHat} done label="Cooked" />
            <Rail filled />
            <Step icon={CheckCircle2} done label="Ready" />
            <Rail filled />
            <Step icon={Bike} active label="Riding" />
            <Rail />
            <Step icon={MapPin} label="You" />
          </div>
        </div>
      </div>

      {/* Drifting food chips around the frame */}
      <FloatingChip className="-left-5 top-8" delay="0s" emoji="🍛" label="Biryani" />
      <FloatingChip className="-right-6 top-1/3" delay="1.1s" emoji="🍕" label="Pizza" />
      <FloatingChip className="-left-3 bottom-16" delay="2.2s" emoji="🥡" label="Rolls" />
      <FloatingChip className="-right-4 bottom-6" delay="0.7s" emoji="⭐" label="4.8 rating" />

      {/* A real photo chip for richness (degrades to gradient if URL dies) */}
      <div
        className="hero-photo-chip float-soft absolute -right-7 top-2 size-16 overflow-hidden rounded-2xl border-2 border-white shadow-xl"
        style={{ animationDelay: '1.6s' }}
        aria-hidden
      >
        <ImageWithFallback
          src={CHIP_IMG}
          alt=""
          fill
          sizes="64px"
          className="object-cover"
        />
      </div>
    </div>
  );
}

function FloatingChip({
  className,
  delay,
  emoji,
  label
}: {
  className: string;
  delay: string;
  emoji: string;
  label: string;
}) {
  return (
    <span
      className={
        'float-soft absolute inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-lg backdrop-blur ' +
        className
      }
      style={{ animationDelay: delay }}
      aria-hidden
    >
      <span className="text-sm leading-none">{emoji}</span>
      {label}
    </span>
  );
}

function Step({
  icon: Icon,
  label,
  done,
  active
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <span className="flex flex-col items-center gap-1" title={label}>
      <span
        className={
          'grid size-7 place-items-center rounded-full ' +
          (done
            ? 'bg-success text-white'
            : active
              ? 'bg-primary text-white ring-brand'
              : 'bg-muted text-muted-foreground')
        }
      >
        <Icon className="size-3.5" />
      </span>
    </span>
  );
}

function Rail({ filled }: { filled?: boolean }) {
  return (
    <span className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
      <span
        className={
          'absolute inset-y-0 left-0 rounded-full ' +
          (filled ? 'right-0 bg-success' : 'hero-rail-crawl w-1/3 bg-primary')
        }
      />
    </span>
  );
}
