import { cn } from '@/lib/utils';

/**
 * Flavrly brand logo.
 *
 * <LogoMark/>  — the standalone squircle "F" icon (coral→magenta + lime pop).
 * <Logo/>      — the mark plus the "Flavrly" wordmark in the display face.
 *
 * Pure presentational, safe in both server and client components. The gradient
 * id is fixed; duplicate instances on a page all resolve to the first (identical)
 * definition, which renders correctly in every browser.
 */

export function LogoMark({ className, title = 'Flavrly' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn('h-8 w-8', className)}>
      <defs>
        <linearGradient id="flv-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f23e5c" />
          <stop offset="0.55" stopColor="#e0286f" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#flv-mark-grad)" />
      <rect x="23" y="17" width="8" height="30" rx="4" fill="#fff" />
      <rect x="23" y="17" width="21" height="8" rx="4" fill="#fff" />
      <rect x="23" y="29" width="15" height="7" rx="3.5" fill="#fff" />
      <circle cx="43.5" cy="43.5" r="5.5" fill="#c7f250" />
    </svg>
  );
}

type LogoProps = {
  /** Hide the wordmark and show only the icon mark. */
  markOnly?: boolean;
  /** Wordmark color treatment. */
  tone?: 'default' | 'gradient' | 'onDark';
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
};

export function Logo({
  markOnly = false,
  tone = 'default',
  className,
  markClassName,
  wordmarkClassName,
}: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={markClassName} />
      {!markOnly && (
        <span
          className={cn(
            'font-display font-extrabold tracking-tight text-[1.35em] leading-none',
            tone === 'gradient' && 'text-gradient-brand',
            tone === 'onDark' && 'text-white',
            tone === 'default' && 'text-foreground',
            wordmarkClassName,
          )}
        >
          Flavrly
        </span>
      )}
    </span>
  );
}

export default Logo;
