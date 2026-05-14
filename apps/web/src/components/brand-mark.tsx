import { brand } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Platform wordmark for Maverick's Food Hub.
 *
 * Splits `brand.name` so the first token renders with the saffron gradient
 * and the remaining tokens render as muted-foreground at medium weight. This
 * is the canonical brand mark used in the header, footer and hero.
 */
export function BrandMark({
  className,
  variant = 'default'
}: {
  className?: string;
  /** `default` is for chrome (header/footer). `hero` is the giant display version. */
  variant?: 'default' | 'hero';
}) {
  const parts = brand.name.split(' ');
  const head = parts[0];
  const tail = parts.slice(1).join(' ');

  if (variant === 'hero') {
    return (
      <span className={cn('display font-bold tracking-tight leading-[1.02]', className)}>
        <span className="block text-foreground/85">{tail.split(' ').slice(0, -1).join(' ') || head}</span>
        <span className="block text-gradient-saffron">
          {tail ? tail.split(' ').slice(-1)[0] : head}
        </span>
      </span>
    );
  }

  return (
    <span className={cn('display font-bold tracking-tight', className)}>
      <span className="text-gradient-saffron">{head}</span>
      {tail ? (
        <>
          {' '}
          <span className="font-medium text-muted-foreground">{tail}</span>
        </>
      ) : null}
    </span>
  );
}
