'use client';
/**
 * "Review us on Google" call-to-action.
 *
 * Compliance by construction: this component takes NO rating input, so every
 * surface that renders it shows the identical button at every rating, before
 * and after feedback (no review gating). Click tracking is fire-and-forget and
 * never delays or blocks the navigation.
 */
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GoogleReviewButton({ href, trackUrl, className }: { href: string; trackUrl?: string; className?: string }) {
  function track() {
    if (!trackUrl) return;
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(trackUrl);
      else void fetch(trackUrl, { method: 'POST', keepalive: true });
    } catch {
      /* tracking is best-effort */
    }
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={track}
      data-testid="google-review-button"
      className={cn(
        'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold shadow-sm transition hover:bg-muted sm:w-auto',
        className,
      )}
    >
      <GoogleG className="size-5" />
      Review us on Google
      <ExternalLink className="size-4 text-muted-foreground" />
    </a>
  );
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** The shared "public review" block used on the feedback page and order tracker. */
export function GoogleReviewBlock({ href, trackUrl }: { href: string | null; trackUrl?: string }) {
  if (!href) return null;
  return (
    <div className="rounded-2xl border bg-muted/30 p-4 sm:p-5" data-testid="google-review-block">
      <div className="font-semibold">Share your experience on Google</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Whatever your rating, a public review helps other diners and helps the restaurant improve.
      </p>
      <div className="mt-3">
        <GoogleReviewButton href={href} trackUrl={trackUrl} />
      </div>
    </div>
  );
}
