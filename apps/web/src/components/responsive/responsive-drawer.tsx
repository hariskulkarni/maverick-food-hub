'use client';

import { useEffect } from 'react';
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';

/**
 * ResponsiveDrawer — replaces the hardcoded-width (`width="680px"`, 900px etc.)
 * detail drawers used across admin + platform list pages. On phones, the
 * drawer is full-width and slides up from the bottom (Apple-style sheet);
 * on md+ it's a right-side panel with a configurable max width.
 *
 * Behaviour:
 *   • Phones (< md): full-width, 92vh tall, slides up from the bottom.
 *     A grab handle hints at swipe-to-dismiss (handled by tap-outside +
 *     X button — full swipe gestures aren't worth the bundle weight yet).
 *   • md+: right side panel, width = `desktopWidth` (default 680px),
 *     full height.
 *   • ESC + scrim tap dismiss it on both breakpoints.
 *   • Body scroll-lock while open.
 *
 * Use this for any "detail drawer" — orders / restaurants / riders / users /
 * audit-log etc. — anywhere a drilldown is appropriate.
 */
export function ResponsiveDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  badge,
  footer,
  desktopWidth = '680px',
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  /** Optional sticky footer (action buttons, links). */
  footer?: React.ReactNode;
  /** CSS width on md+. Default 680px. Use 'min(900px, 90vw)' for wider data. */
  desktopWidth?: string;
  children: React.ReactNode;
}) {
  // Body scroll lock — Radix's Dialog already does this on its own portal,
  // but we add a backup so the underlying page can't move on phones.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className={
            // Phones: bottom sheet — full width, 92vh tall, slide-up.
            'fixed left-0 right-0 bottom-0 z-50 mx-auto w-full max-h-[92vh] rounded-t-3xl border-t border-x bg-card p-0 shadow-2xl outline-none flex flex-col data-[state=open]:animate-slide-up ' +
            // md+: right side panel, full height, configurable width.
            'md:left-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:h-full md:rounded-none md:border-l md:border-t-0 md:border-x-0 md:max-w-full'
          }
          style={{
            // Width is responsive: full on phones, desktopWidth on md+.
            // The inline style + a media-query-friendly fallback below let us
            // pass any CSS length string (e.g. 'min(900px, 90vw)') without
            // pre-building every Tailwind permutation.
            ['--rdrawer-width' as any]: desktopWidth,
          }}
        >
          <style>{`@media (min-width: 768px) { [data-rdrawer="1"] { width: var(--rdrawer-width); } }`}</style>
          <div data-rdrawer="1" className="flex h-full flex-col">
            {/* Grab handle on phones. */}
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30 md:hidden" />

            <DialogTitle asChild>
              <header className="flex items-start justify-between gap-3 px-4 md:px-5 pt-4 md:pt-5 pb-3 border-b">
                <div className="min-w-0">
                  <div className="display text-lg md:text-xl font-bold truncate">{title}</div>
                  {subtitle && <div className="mt-0.5 text-xs md:text-sm text-muted-foreground truncate">{subtitle}</div>}
                </div>
                {badge && <div className="shrink-0">{badge}</div>}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" />
                </button>
              </header>
            </DialogTitle>

            <div className="flex-1 overflow-y-auto">{children}</div>

            {footer && <div className="border-t bg-card/95 backdrop-blur p-3 md:p-4">{footer}</div>}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
