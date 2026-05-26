'use client';

import { useState } from 'react';
import { Store, ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import type { AccessibleGroup } from '@/server/tenancy';

/**
 * CMS-scoped restaurant picker. Lets a group / umbrella admin choose WHICH
 * outlet's storefront they're editing — so the Storefront CMS covers every
 * restaurant they can access, not just the active one.
 *
 * Selecting an outlet POSTs to /api/admin/active-restaurant (the only writer of
 * the active-restaurant cookie, which re-validates membership server-side) and
 * then hard-navigates back to /admin/storefront so every server component
 * re-reads the new active restaurant and the editor loads that outlet's config.
 *
 * Rendered only when the admin can reach more than one restaurant.
 */
export function CmsRestaurantPicker({
  groups,
  activeId,
}: {
  groups: AccessibleGroup[];
  activeId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const flat = groups.flatMap((g) => [...(g.parent ? [g.parent] : []), ...g.members]);
  const active = flat.find((r) => r.id === activeId) ?? flat[0] ?? null;

  async function switchTo(id: string) {
    if (id === activeId || pendingId) { setOpen(false); return; }
    setPendingId(id);
    try {
      const res = await fetch('/api/admin/active-restaurant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: id }),
      });
      if (!res.ok) { setPendingId(null); return; }
      window.location.assign('/admin/storefront');
    } catch {
      setPendingId(null);
    }
  }

  return (
    <div className="relative">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Editing storefront for</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full max-w-md items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-left hover:bg-accent transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Store className="size-4 shrink-0 text-primary" />
          <span className="font-medium truncate">{active?.name ?? 'Select restaurant'}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="listbox" className="absolute left-0 z-50 mt-2 w-full max-w-md max-h-[60vh] overflow-auto rounded-lg border bg-card p-1 shadow-xl">
            {groups.map((group, gi) => {
              const items = group.parent ? [group.parent, ...group.members] : group.members;
              if (items.length === 0) return null;
              return (
                <div key={group.parent?.id ?? `ungrouped-${gi}`} className="py-1">
                  {group.parent && (
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.parent.name}</div>
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
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60 ${isChild ? 'pl-5' : ''} ${isActive ? 'font-semibold text-primary' : ''}`}
                      >
                        <span className="truncate">
                          {r.name}
                          {r.status !== 'ACTIVE' && <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">{r.status.toLowerCase()}</span>}
                        </span>
                        {isPending ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : isActive ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
