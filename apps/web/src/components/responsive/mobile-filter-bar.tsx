'use client';

import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

/**
 * MobileFilterBar — list-page toolbar that adapts to phone screens.
 *
 * Behaviour:
 *   • md+: renders inline as a horizontal row of controls (search, status pills,
 *     date picker, etc.) — the usual desktop pattern.
 *   • Phones (< md): renders a single sticky bottom button "Filters" + an
 *     optional always-visible search slot. Tapping "Filters" opens a bottom
 *     sheet containing the same controls vertically. This collapses dense
 *     toolbar rows that overflow on 360px viewports.
 *
 * Usage:
 *   <MobileFilterBar
 *     search={<SearchInput value={q} onChange={setQ} />}
 *     activeCount={3}
 *   >
 *     <StatusPills value={status} onChange={setStatus} />
 *     <DateRangePicker value={range} onChange={setRange} />
 *     <SortSelect value={sort} onChange={setSort} />
 *   </MobileFilterBar>
 *
 * The component is layout-only — it doesn't own filter state. The page renders
 * its filter controls as children; we just choose where to put them.
 */
export function MobileFilterBar({
  search,
  children,
  /** Shown as a small badge on the mobile "Filters" trigger if > 0. */
  activeCount = 0,
  /** Optional extra actions to render to the right on desktop (e.g. "New order"). */
  rightSlot,
  /** Title in the mobile sheet header. */
  sheetTitle = 'Filters',
  className,
}: {
  search?: React.ReactNode;
  children?: React.ReactNode;
  activeCount?: number;
  rightSlot?: React.ReactNode;
  sheetTitle?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* DESKTOP toolbar: single flex row, wraps gracefully. */}
      <div className={`hidden md:flex items-center gap-2 flex-wrap ${className ?? ''}`}>
        {search && <div className="flex-1 min-w-[240px] max-w-md">{search}</div>}
        <div className="flex items-center gap-2 flex-wrap">{children}</div>
        {rightSlot && <div className="ml-auto flex items-center gap-2">{rightSlot}</div>}
      </div>

      {/* MOBILE search (always visible) + Filters button. */}
      <div className={`md:hidden flex items-center gap-2 ${className ?? ''}`}>
        {search && <div className="flex-1 min-w-0">{search}</div>}
        {children && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-accent"
            aria-label="Open filters"
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {activeCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </button>
        )}
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>

      {/* MOBILE bottom sheet with the filter controls. */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
          <div className="flex-1 bg-black/45 animate-fade-in" onClick={() => setOpen(false)} />
          <div className="bg-card border-t rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col animate-slide-up">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <header className="flex items-center justify-between px-4 pt-3 pb-3 border-b">
              <div className="display text-base font-bold">{sheetTitle}</div>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
                className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {children}
            </div>
            <div className="border-t bg-card/95 backdrop-blur p-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                Show results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
