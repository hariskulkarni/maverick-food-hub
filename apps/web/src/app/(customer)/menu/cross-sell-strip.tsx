'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { useCart } from '../cart-context';

export interface CrossSellSuggestion {
  id: string;
  name: string;
  price: number | string;
  imageUrl?: string | null;
  isVeg?: boolean;
}

// The cross-sell row as returned by /api/customer/cross-sell. The customer
// endpoint wraps each suggestion in a row with its kind so we can group.
type ApiRow = {
  id: string;
  sortOrder: number;
  surface: string;
  kind?: string;
  note?: string | null;
  source?: string;
  suggestedItem: {
    id: string;
    name: string;
    price: number | string;
    imageUrl?: string | null;
    isVeg?: boolean;
  };
};

type Surface = 'pdp' | 'cart';
type Kind = 'frequently_together' | 'complete_meal' | 'add_drink' | 'add_dessert' | 'add_side';

const KIND_TITLE: Record<string, string> = {
  frequently_together: 'Frequently ordered together',
  complete_meal:       'Complete your meal',
  add_drink:           'Add a drink',
  add_dessert:         'Add a dessert',
  add_side:            'Add a side'
};

// Order in which the grouped strips render on the PDP / cart surfaces.
const KIND_ORDER: Kind[] = ['frequently_together', 'complete_meal', 'add_drink', 'add_dessert', 'add_side'];

interface PdpProps {
  surface: 'pdp';
  parentItemId: string;
  branchId?: string;
  /**
   * When provided, fetch + render only this kind as a single strip.
   * When omitted, the component fetches every kind for the parent and renders
   * one labelled strip per non-empty kind (frequently_together, complete_meal,
   * add_drink, add_dessert, add_side) in canonical order. Back-compatible with
   * existing call-sites that pass no `kind`.
   */
  kind?: Kind;
}
interface CartProps {
  surface: 'cart';
  branchId: string;
  itemIds: string[];
  kind?: Kind;
}

export type CrossSellStripProps = PdpProps | CartProps;

export function CrossSellStrip(props: CrossSellStripProps) {
  // We hold the raw API rows so we can group them by kind in render.
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const { add, lines } = useCart();

  const explicitKind = props.kind;

  const key =
    props.surface === 'pdp'
      ? `pdp:${props.parentItemId}:${explicitKind ?? 'all'}`
      : `cart:${props.branchId}:${props.itemIds.slice().sort().join(',')}:${explicitKind ?? 'all'}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const kindQs = explicitKind ? `&kind=${encodeURIComponent(explicitKind)}` : '';
    const url =
      props.surface === 'pdp'
        ? `/api/customer/cross-sell?parent=${encodeURIComponent(props.parentItemId)}&surface=pdp${kindQs}`
        : `/api/customer/cross-sell/cart?branchId=${encodeURIComponent(props.branchId)}&items=${encodeURIComponent(
            props.itemIds.join(',')
          )}&surface=cart${kindQs}`;

    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((data: any) => {
        if (cancelled) return;
        // Server returns { suggestions: ApiRow[] }. Tolerate the legacy bare
        // array shape too — older endpoints might still respond that way.
        const arr: ApiRow[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.suggestions)
            ? data.suggestions
            : [];
        setRows(arr);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Group rows by kind. When `explicitKind` was passed, we still build groups
  // so the render path is uniform — there will just be a single bucket.
  const grouped = useMemo(() => {
    if (!rows) return [];
    const buckets = new Map<string, ApiRow[]>();
    for (const r of rows) {
      const k = r.kind ?? 'frequently_together';
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    // Render kinds in canonical order, then any unknown kinds last.
    const known = KIND_ORDER.filter((k) => buckets.has(k));
    const unknown = Array.from(buckets.keys()).filter((k) => !KIND_ORDER.includes(k as Kind));
    return [...known, ...unknown].map((k) => ({ kind: k, items: buckets.get(k)! }));
  }, [rows]);

  // Deliberately render NOTHING while the first fetch is in flight.
  //
  // This used to render a skeleton under a hardcoded "Frequently ordered
  // together" heading. Cross-sell is supplementary — plenty of items have no
  // rules configured — so on those items the heading appeared for the length of
  // the request and then vanished when the empty response arrived, which reads
  // as a glitch. A placeholder is only honest when we know something is coming,
  // and here we don't. Reserving no space also avoids the layout shift that the
  // skeleton caused when it collapsed.
  if (loading && rows === null) return null;


  if (!rows || rows.length === 0) return null;

  return (
    <div className="mt-4 space-y-4">
      {grouped.map((g) => (
        <StripSection
          key={g.kind}
          title={KIND_TITLE[g.kind] ?? 'You may also like'}
          rows={g.items}
          linesInCart={lines}
          onAdd={(s) =>
            add({
              id: s.id,
              refId: s.id,
              kind: 'item',
              branchId: props.branchId ?? null,
              name: s.name,
              unitPrice: Number(s.price),
              imageUrl: s.imageUrl ?? undefined,
              isVeg: s.isVeg
            })
          }
        />
      ))}
    </div>
  );
}

function StripSection({
  title, rows, linesInCart, onAdd
}: {
  title: string;
  rows: ApiRow[];
  linesInCart: { kind: string; refId: string }[];
  onAdd: (s: ApiRow['suggestedItem']) => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5 mb-2">
        <Sparkles className="size-3.5" /> {title}
      </div>
      <div className="-mx-2 overflow-x-auto no-scrollbar">
        <div className="flex gap-3 px-2 snap-x">
          {rows.map((row) => {
            const s = row.suggestedItem;
            const inCart = linesInCart.some((l) => l.kind === 'item' && l.refId === s.id);
            return (
              // Vertical card matching MenuItemCard pattern: image banner on
              // top, content below. w-full max-w-full overflow-hidden so the
              // 144-px fixed-width tile can never overflow inside its horizontal
              // scroll rail; min-w-0 inside so the title truncates cleanly.
              <div
                key={row.id}
                className="shrink-0 snap-start w-36 max-w-full rounded-xl border bg-card overflow-hidden flex flex-col tap-press card-lift"
              >
                <div className="relative h-20 w-full bg-muted overflow-hidden">
                  <Image
                    src={s.imageUrl || FOOD_FALLBACK}
                    alt={s.name}
                    fill
                    sizes="144px"
                    className="object-cover"
                  />
                  {s.isVeg !== undefined && (
                    <span
                      className={`absolute top-1.5 left-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border-[1.5px] bg-background/90 ${
                        s.isVeg ? 'border-success' : 'border-destructive'
                      }`}
                      title={s.isVeg ? 'Veg' : 'Non-veg'}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${s.isVeg ? 'bg-success' : 'bg-destructive'}`}
                      />
                    </span>
                  )}
                </div>
                <div className="p-2 flex flex-col flex-1 min-w-0">
                  <div className="text-xs font-medium leading-snug line-clamp-2 flex-1 break-words">{s.name}</div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <div className="text-xs font-semibold">{money(s.price)}</div>
                    {/* White "sticker" Add button matching MenuItemCard — primary
                        border, primary text on background, uppercase bold so
                        every Add button on the storefront reads the same. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="tap-press h-7 px-2 rounded-md border-2 border-primary bg-background text-primary font-bold uppercase tracking-wider text-[10px] shadow-sm hover:bg-primary/5"
                      onClick={() => onAdd(s)}
                      aria-label={`Add ${s.name} to cart`}
                    >
                      <Plus className="size-3 mr-0.5" /> {inCart ? 'Added' : 'Add'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
