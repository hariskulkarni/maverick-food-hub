import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';

/**
 * Shared shell for the full-page status surfaces — 404 and the error
 * boundaries. One component so the storefront 404 and the portal 404 can't
 * drift apart visually, and so the brand lockup/spacing is defined once.
 *
 * `hero` gives the storefront's animated gradient backdrop. The portal
 * consoles pass `plain`, since they render inside existing chrome and a
 * gradient behind a dashboard looks like a bug.
 */
export function StatusPage({
  code,
  title,
  description,
  icon,
  actions,
  variant = 'hero',
  showBrand = true,
}: {
  /** Big dimmed numeral (e.g. '404'). Omit for pages without an HTTP code. */
  code?: string;
  title: string;
  description: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  variant?: 'hero' | 'plain';
  showBrand?: boolean;
}) {
  return (
    <main
      className={cn(
        'flex items-center justify-center px-6',
        variant === 'hero' ? 'gradient-hero min-h-screen py-16' : 'min-h-[60vh] py-12',
      )}
    >
      <div className="w-full max-w-lg text-center">
        {showBrand ? <BrandMark className="text-xl" /> : null}

        {code ? (
          <div
            className="display mt-6 select-none text-7xl font-extrabold leading-none text-foreground/10 md:text-8xl"
            aria-hidden
          >
            {code}
          </div>
        ) : null}

        {icon ? (
          <div className="mx-auto mt-4 grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary">
            {icon}
          </div>
        ) : null}

        <h1 className={cn('display font-semibold tracking-tight', code ? 'mt-4' : 'mt-6', 'text-2xl md:text-3xl')}>
          {title}
        </h1>

        <div className="mt-3 text-balance text-sm text-muted-foreground md:text-base">{description}</div>

        {actions ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
      </div>
    </main>
  );
}

/** Primary pill link, styled like the app's primary button. */
export function StatusAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {children}
    </Link>
  );
}

/** Secondary/ghost link. */
export function StatusActionSecondary({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center rounded-md border border-border/70 px-4 text-sm font-medium transition-colors hover:bg-muted"
    >
      {children}
    </Link>
  );
}
