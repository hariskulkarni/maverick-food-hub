'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import type { AccessibleGroup } from '@/server/tenancy';

/**
 * Sidebar restaurant switcher. Rendered only when the admin can reach more than
 * one restaurant. Shows the accessible restaurants grouped parent → children
 * (the `groups` shape from accessibleRestaurants()): each group with a parent
 * renders the parent as a header and its children indented; the ungrouped
 * bucket (parent === null) lists standalone restaurants flat.
 *
 * Selecting a different restaurant POSTs to /api/admin/active-restaurant (the
 * only writer of the active cookie) and, on success, refreshes the router so
 * every server component re-reads currentRestaurant() and re-renders scoped to
 * the new active restaurant.
 */
export function RestaurantSwitcher({
  groups,
  activeId,
}: {
  groups: AccessibleGroup[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Resolve the currently-active restaurant for the button label.
  const flat = groups.flatMap((g) => [
    ...(g.parent ? [g.parent] : []),
    ...g.members,
  ]);
  const active = flat.find((r) => r.id === activeId) ?? flat[0] ?? null;

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function switchTo(id: string) {
    if (id === activeId || pendingId) {
      setOpen(false);
      return;
    }
    setPendingId(id);
    try {
      const res = await fetch('/api/admin/active-restaurant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: id }),
      });
      if (!res.ok) {
        setPendingId(null);
        return;
      }
      setOpen(false);
      // Re-read the active restaurant everywhere, then land on the dashboard.
      router.push('/admin');
      router.refresh();
    } catch {
      setPendingId(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md text-left -mx-1 px-1 py-0.5 hover:bg-accent transition-colors"
      >
        <span className="display text-lg font-bold text-primary truncate">
          {active?.name ?? 'Select restaurant'}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-2 max-h-[60vh] overflow-auto rounded-md border bg-card p-1 shadow-lg"
        >
          {groups.map((group, gi) => {
            const items = group.parent ? [group.parent, ...group.members] : group.members;
            if (items.length === 0) return null;
            return (
              <div key={group.parent?.id ?? `ungrouped-${gi}`} className="py-1">
                {group.parent && (
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.parent.name}
                  </div>
                )}
                {items.map((r) => {
                  const isChild = group.parent != null && r.id !== group.parent.id;
                  const isActive = r.id === activeId;
                  const isPending = r.id === pendingId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      disabled={isPending}
                      onClick={() => switchTo(r.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60 ${
                        isChild ? 'pl-5' : ''
                      } ${isActive ? 'font-semibold text-primary' : ''}`}
                    >
                      <span className="truncate">
                        {r.name}
                        {r.status !== 'ACTIVE' && (
                          <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                            {r.status.toLowerCase()}
                          </span>
                        )}
                      </span>
                      {isPending ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : isActive ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
