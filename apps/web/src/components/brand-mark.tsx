import { brand } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { LogoMark } from '@/components/brand/logo';

/**
 * Platform brand lockup for Flavrly — the icon mark + wordmark.
 *
 * The icon carries the coral→magenta brand colour; the wordmark inherits the
 * surrounding text colour so it stays legible on light chrome, dark panels and
 * the hero alike. The `hero` variant renders large with a coral gradient
 * wordmark for marketing surfaces. Sizing is em-based, so callers control scale
 * purely via the font-size in `className` (e.g. `text-xl`, `text-7xl`).
 */
export function BrandMark({
  className,
  variant = 'default',
}: {
  className?: string;
  /** `default` is for chrome (header/footer). `hero` is the giant display version. */
  variant?: 'default' | 'hero';
}) {
  if (variant === 'hero') {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center gap-3 font-display font-extrabold tracking-tight leading-none',
          className,
        )}
      >
        <LogoMark className="h-[0.92em] w-[0.92em] shrink-0 drop-shadow-sm" />
        <span className="text-gradient-brand">{brand.name}</span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2 font-display font-bold tracking-tight', className)}>
      <LogoMark className="h-[1.35em] w-[1.35em] shrink-0" />
      <span>{brand.name}</span>
    </span>
  );
}
